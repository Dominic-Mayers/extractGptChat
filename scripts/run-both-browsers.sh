#!/usr/bin/env bash
# Run the fixed-deck batch on Firefox and then on Chromium, same cycle count.
#
#   scripts/run-both-browsers.sh 30
#
# Extra arguments are passed through to run-fixed-deck-batch.py for both runs.
# The two batches run one after the other, never at the same time: the cycle
# timings are sensitive to CPU contention, so overlapping them would make the
# browsers uncomparable.

set -euo pipefail

URL="${EXTRACT_URL:-https://chatgpt.com/c/6a0a297f-e7d0-83ea-9f13-b113fd7a2555}"
FIREFOX_PROFILE="${FIREFOX_PROFILE:-$HOME/firefox-extract-profile}"
CHROMIUM_PROFILE="${CHROMIUM_PROFILE:-$HOME/snap/chromium/common/extract-gpt-batch-profile}"

if [ $# -lt 1 ]; then
    echo "usage: $0 <cycles> [extra args for run-fixed-deck-batch.py]" >&2
    exit 2
fi

CYCLES="$1"
shift

case "$CYCLES" in
    ''|*[!0-9]*) echo "cycles must be a positive integer, got '$CYCLES'" >&2; exit 2 ;;
esac

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$REPO/scripts/run-fixed-deck-batch.py"
RUNS="$REPO/fixed-deck-runs"

before="$(ls -1 "$RUNS" 2>/dev/null | sort || true)"

run_one() {
    local browser="$1" profile="$2"
    shift 2
    echo
    echo "=== $browser, $CYCLES cycles ==="
    python3 "$RUNNER" \
        --url "$URL" \
        --profile "$profile" \
        --browser "$browser" \
        --cycles "$CYCLES" \
        "$@"
}

run_one chromium "$CHROMIUM_PROFILE" "$@"
run_one firefox "$FIREFOX_PROFILE" "$@"

echo
echo "=== new batches ==="
comm -13 <(printf '%s\n' "$before") <(ls -1 "$RUNS" | sort) | sed "s#^#$RUNS/#"
