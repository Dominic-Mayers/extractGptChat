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


def trim(text, user_lines=2, assistant_lines=1):
    parts = re.split(r'(?m)^(### (?:USER|ASSISTANT|UNKNOWN))$', text)
    out = [parts[0]]

    i = 1
    while i + 1 < len(parts):
        header = parts[i]
        body   = parts[i + 1]
        role   = 'USER' if header == '### USER' else 'ASSISTANT'
        n      = user_lines if role == 'USER' else assistant_lines

        sep = '\n\n---\n\n'
        idx = body.find(sep)
        if idx >= 0:
            msg_text = body[2:idx]
            tail     = sep + body[idx + len(sep):]
        else:
            msg_text = body.strip()
            tail     = '\n'

        lines = [l for l in msg_text.split('\n') if l.strip()]
        if n > 0 and lines:
            kept   = [l[:MAX_CHARS] + ('…' if len(l) > MAX_CHARS else '')
                      for l in lines[:n]]
            suffix = f'\n[… {len(lines) - n} more lines]' if len(lines) > n else ''
            out.append(header + '\n\n' + '\n'.join(kept) + suffix + tail)
        else:
            out.append(header + tail)

        i += 2

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
    print(f'\nSaved: {out}')


if __name__ == '__main__':
    main()
