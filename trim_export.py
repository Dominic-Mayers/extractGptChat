#!/usr/bin/env python3
"""Trim a ChatGPT export for diagnostic uploading.

Keeps 2 lines of each USER block and 1 line of each ASSISTANT block,
each capped at 120 characters. The title header and the perf/diag block
at the end are always kept verbatim.

Usage:
    python3 trim_export.py export.md [user_lines=2] [assistant_lines=1] > trimmed.md
"""
import sys
import re

MAX_CHARS = 120


def main():
    if len(sys.argv) < 2:
        print(f'Usage: {sys.argv[0]} <export.md> [user_lines=2] [assistant_lines=1]',
              file=sys.stderr)
        sys.exit(1)

    path            = sys.argv[1]
    user_lines      = int(sys.argv[2]) if len(sys.argv) > 2 else 2
    assistant_lines = int(sys.argv[3]) if len(sys.argv) > 3 else 1

    with open(path, encoding='utf-8-sig') as f:
        text = f.read()

    # Split on role headers — these never appear in message content.
    # Result: [preamble, header1, body1, header2, body2, ...]
    parts = re.split(r'(?m)^(### (?:USER|ASSISTANT|UNKNOWN))$', text)

    out = [parts[0]]  # title block — kept verbatim

    i = 1
    while i + 1 < len(parts):
        header = parts[i]
        body   = parts[i + 1]  # \n\n{text}\n\n---\n\n[perf block if last]
        role   = 'USER' if header == '### USER' else 'ASSISTANT'
        n      = user_lines if role == 'USER' else assistant_lines

        # Separate message text from the trailing ---  separator.
        # Block separator is \n\n---\n\n; <hr> within content produces \n---\n\n
        # (single newline before), so \n\n---\n\n is a reliable boundary.
        sep = '\n\n---\n\n'
        idx = body.find(sep)
        if idx >= 0:
            msg_text = body[2:idx]          # skip leading \n\n
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

    sys.stdout.write(''.join(out))


if __name__ == '__main__':
    main()
