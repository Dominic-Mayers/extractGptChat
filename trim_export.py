#!/usr/bin/env python3
"""Trim a ChatGPT export for diagnostic uploading.

Keeps 2 lines of each USER block and 1 line of each ASSISTANT block,
each capped at 120 characters. The title header and the perf/diag block
at the end are always kept verbatim.

Usage:
    python3 trim_export.py                           # pick from .md files in current dir
    python3 trim_export.py export.md                 # use a specific file
    python3 trim_export.py [export.md] [user=2] [asst=1]
Output is always saved to <stem>_trim.md next to the source file.
"""
import os
import re
import sys
from datetime import datetime

MAX_CHARS = 120

# Trimmed output is meant to be uploaded back into a chat — a trim that
# silently fails to shrink the file (e.g. the rfind/find bug above) still
# writes a file and prints "Saved", and an oversized upload either gets
# rejected or burns the conversation's context, discovered only after the
# original (untrimmed) source is already gone. Catch that here instead.
MAX_OUTPUT_BYTES = 200 * 1024


# Anchor and header are captured together: the anchor line for block N+1 sits
# at the tail of block N's raw text (right before "### USER"/"### ASSISTANT"),
# so splitting on the header alone left it stranded in the previous block's
# body — a separate hack was needed to fish it back out. Capturing both as one
# match keeps each anchor permanently attached to its own block.
_BLOCK_RE = re.compile(r'(?m)^(<a id="[^"]*"></a>\n\n)?(### (?:USER|ASSISTANT|UNKNOWN))$')


def trim(text, user_lines=2, assistant_lines=1):
    parts = _BLOCK_RE.split(text)
    out = [parts[0]]

    i = 1
    while i + 2 < len(parts):
        anchor = parts[i] or ''
        header = parts[i + 1]
        body   = parts[i + 2]
        role   = 'USER' if header == '### USER' else 'ASSISTANT' if header == '### ASSISTANT' else None
        n      = user_lines if role == 'USER' else assistant_lines if role == 'ASSISTANT' else None

        if n is None:
            # Unknown role — not part of the USER/ASSISTANT trim spec, leave verbatim.
            out.append(anchor + header + body)
            i += 3
            continue

        # A message can itself contain a standalone "---" line (an <hr>, or the
        # model using it as a section divider) — find() would stop at that one
        # instead of the real block terminator that exportMarkdown appends after
        # every message, silently dumping the rest of the message into "tail"
        # untrimmed. The appended terminator is always the *last* such sequence
        # in body (anything after it is the next block's own anchor/header, now
        # split off separately, or the trailing diag block) — so rfind is exact.
        sep = '\n\n---\n\n'
        idx = body.rfind(sep)
        if idx >= 0:
            msg_text = body[2:idx]   # body always starts with the leading '\n\n'
            tail     = body[idx:]    # sep + anything after it (e.g. diag block)
        else:
            msg_text = body.strip()
            tail     = '\n'

        lines = [l for l in msg_text.split('\n') if l.strip()]
        if n > 0 and lines:
            kept   = [l[:MAX_CHARS] + ('…' if len(l) > MAX_CHARS else '')
                      for l in lines[:n]]
            suffix = f'\n[… {len(lines) - n} more lines]' if len(lines) > n else ''
            out.append(anchor + header + '\n\n' + '\n'.join(kept) + suffix + tail)
        else:
            out.append(anchor + header + tail)

        i += 3

    return ''.join(out)


_EXPORT_HEADER = re.compile(r'^_\d+ user prompts —')


def _is_export(path):
    """Return (is_export, prompt_count_or_None) by peeking at the first few lines."""
    try:
        with open(path, encoding='utf-8-sig') as f:
            for i, line in enumerate(f):
                if i > 6:
                    break
                m = _EXPORT_HEADER.match(line.strip())
                if m:
                    n = re.search(r'(\d+) user prompts', line)
                    return True, (int(n.group(1)) if n else None)
    except Exception:
        pass
    return False, None


def find_exports(directory='.'):
    results = []
    for fname in os.listdir(directory):
        if not fname.endswith('.md') or fname.endswith('_trim.md'):
            continue
        path = os.path.join(directory, fname)
        if not os.path.isfile(path):
            continue
        ok, n = _is_export(path)
        if ok:
            results.append((path, os.path.getmtime(path), n))
    results.sort(key=lambda x: x[1], reverse=True)
    return results


def prompt_count(path):
    _, n = _is_export(path)
    return n


def pick_file(files):
    print(f'Found {len(files)} export file(s):\n')
    for i, (path, mtime, n) in enumerate(files, 1):
        dt   = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M')
        name = os.path.basename(path)
        info = f'  [{n} prompts]' if n else ''
        print(f'  {i}.  {name}\n      {dt}{info}')
    print()
    while True:
        try:
            raw = input(f'Pick a file [1–{len(files)}]: ').strip()
            idx = int(raw) - 1
            if 0 <= idx < len(files):
                return files[idx][0]
        except (ValueError, EOFError):
            pass
        print(f'  Please enter a number between 1 and {len(files)}.')


def output_path(input_path):
    stem = input_path[:-3] if input_path.endswith('.md') else input_path
    return stem + '_trim.md'


def main():
    user_lines      = 2
    assistant_lines = 1

    args = sys.argv[1:]
    if args and args[0].endswith('.md'):
        path = args[0]
        if len(args) > 1: user_lines      = int(args[1])
        if len(args) > 2: assistant_lines = int(args[2])
    else:
        if len(args) > 0: user_lines      = int(args[0])
        if len(args) > 1: assistant_lines = int(args[1])
        files = find_exports('.')
        if not files:
            print('No export .md files found in the current directory.', file=sys.stderr)
            sys.exit(1)
        path = pick_file(files)

    with open(path, encoding='utf-8-sig') as f:
        text = f.read()

    result = trim(text, user_lines, assistant_lines)

    out = output_path(path)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(result)

    size = os.path.getsize(out)
    if size > MAX_OUTPUT_BYTES:
        print(
            f'\n!!! NOT SAFE TO UPLOAD !!!\n'
            f'{out} is {size/1024:.0f}KB — over the {MAX_OUTPUT_BYTES // 1024}KB limit.\n'
            f'The trim did not actually shrink this file enough; saved anyway for inspection, '
            f'but do not upload it as-is.',
            file=sys.stderr,
        )
        sys.exit(1)

    print(f'\nSaved: {out} ({size/1024:.0f}KB)')


if __name__ == '__main__':
    main()
