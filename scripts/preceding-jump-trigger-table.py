#!/usr/bin/env python3
"""
Reproduce the "outcome of J vs what J-1 triggers" table from the 5.83 study,
on the 6.22 / 6.23 batches, to check whether the "preceding jump never
triggers a geometric activation before an erasure" result replicates.
"""
import json
import sys
from pathlib import Path
from collections import defaultdict

MIN_ACTIVATION_DISTANCE = 1000


def geometrically_activates(before, after):
    """Port of geometricallyActivatesDeckDiagnostics in supplyWorker-diag.js
    (lines ~1316-1331): true when the JUMP COMMAND ITSELF (beforeJump ->
    afterCommand) carries a deck's activation distance across the
    MIN_ACTIVATION_DISTANCE band, in whichever direction the jump moves."""
    if before is None or after is None:
        return False
    if before.get("scrollY") is None or after.get("scrollY") is None:
        return False
    scroll_delta = after["scrollY"] - before["scrollY"]
    above = before.get("activationDistanceAbove")
    below = before.get("activationDistanceBelow")
    if (
        scroll_delta < 0
        and above is not None
        and above >= MIN_ACTIVATION_DISTANCE
        and above + scroll_delta < MIN_ACTIVATION_DISTANCE
    ):
        return True
    if (
        scroll_delta > 0
        and below is not None
        and below >= MIN_ACTIVATION_DISTANCE
        and below - scroll_delta < MIN_ACTIVATION_DISTANCE
    ):
        return True
    return False


def analyze_cycle(path):
    with open(path) as f:
        d = json.load(f)
    if d.get("status") != "complete":
        return None
    rds = d["rafDeckStudy"]

    act_jumps = set()
    for j in rds["jumps"]:
        n = j.get("jumpNumber")
        geom = j.get("geometry")
        if n is None or geom is None:
            continue
        if geometrically_activates(geom.get("beforeJump"), geom.get("afterCommand")):
            act_jumps.add(n)

    deact_jumps = set(e["geometricDeactivationJumpNumber"] for e in rds["episodes"]
                       if e["geometricDeactivationJumpNumber"] is not None)

    jumps_by_number = {j["jumpNumber"]: j for j in rds["jumps"] if j["jumpNumber"] is not None}

    rows = defaultdict(lambda: defaultdict(int))
    detail = []  # for erased jumps: (cycle, jumpNumber, category)

    for j in rds["jumps"]:
        n = j.get("jumpNumber")
        outcome = j.get("outcome")
        if n is None or outcome is None:
            continue
        prev = n - 1
        prev_act = prev in act_jumps
        prev_deact = prev in deact_jumps
        if prev_act and prev_deact:
            cat = "both"
        elif prev_act:
            cat = "activation only"
        elif prev_deact:
            cat = "deactivation only"
        else:
            cat = "neither"
        rows[outcome][cat] += 1
        if outcome == "erased":
            detail.append((f"{path.parent.name}/{path.name}", n, cat, j))

    return rows, detail, act_jumps, deact_jumps, jumps_by_number


def pool(batch_dirs, label):
    total = defaultdict(lambda: defaultdict(int))
    all_detail = []
    n_cycles = 0
    for bd in batch_dirs:
        bd = Path(bd)
        for cyc in sorted(bd.glob("cycle-*.json")):
            r = analyze_cycle(cyc)
            if r is None:
                continue
            rows, detail, *_ = r
            n_cycles += 1
            for outcome, cats in rows.items():
                for cat, cnt in cats.items():
                    total[outcome][cat] += cnt
            all_detail.extend(detail)

    print(f"=== {label} ({n_cycles} complete cycles) ===")
    cats_order = ["deactivation only", "activation only", "both", "neither"]
    header = f"{'outcome':<18}{'jumps':>8}" + "".join(f"{c:>20}" for c in cats_order)
    print(header)
    for outcome in ["survived", "erased", "retry-succeeded"]:
        cats = total[outcome]
        jumps = sum(cats.values())
        line = f"{outcome:<18}{jumps:>8}"
        for c in cats_order:
            line += f"{cats.get(c,0):>20}"
        print(line)
    erased_total = sum(total["erased"].values())
    erased_with_act = total["erased"].get("activation only", 0) + total["erased"].get("both", 0)
    survived_total = sum(total["survived"].values())
    survived_with_act = total["survived"].get("activation only", 0) + total["survived"].get("both", 0)
    print(f"\nErasures whose J-1 triggered ANY activation: {erased_with_act} / {erased_total}")
    print(f"Survived whose J-1 triggered ANY activation:  {survived_with_act} / {survived_total}")
    exceptions = [(cyc, n, cat, j) for cyc, n, cat, j in all_detail if cat in ("activation only", "both")]
    if exceptions:
        print("Exceptions (cycle, jumpNumber, category, selectedDeckId):")
        for cyc, n, cat, j in exceptions:
            print(f"  {cyc}  jump {n}  {cat}  deck={j.get('selectedDeckId')}")
    print()
    return total, exceptions


if __name__ == "__main__":
    base = Path("fixed-deck-runs")
    batch_622 = [base / "20260810-011029", base / "20260810-020321"]
    batch_623 = [base / "20260810-075546"]

    pool(batch_622, "6.22 (split enabled), 872px")
    pool(batch_623, "6.23 (split disabled), 872px")

def check_split(batch_dirs):
    from collections import Counter
    split_counts = Counter()
    total = 0
    for bd in batch_dirs:
        bd = Path(bd)
        for cyc in sorted(bd.glob("cycle-*.json")):
            with open(cyc) as f:
                d = json.load(f)
            if d.get("status") != "complete":
                continue
            rds = d["rafDeckStudy"]
            jumps = {j["jumpNumber"]: j for j in rds["jumps"] if j.get("jumpNumber") is not None}
            act_jumps = set()
            for j in rds["jumps"]:
                n = j.get("jumpNumber")
                geom = j.get("geometry")
                if n is None or geom is None:
                    continue
                if geometrically_activates(geom.get("beforeJump"), geom.get("afterCommand")):
                    act_jumps.add(n)
            for j in rds["jumps"]:
                n = j.get("jumpNumber")
                if n is None or j.get("outcome") != "erased":
                    continue
                prev = n - 1
                if prev in act_jumps:
                    total += 1
                    prev_j = jumps.get(prev)
                    has_split = prev_j is not None and "split" in prev_j
                    split_counts[has_split] += 1
                    print(f"{cyc.parent.name}/{cyc.name} erased={n} J-1={prev} J-1 has split field: {has_split}")
    print("split_counts among exceptions:", dict(split_counts), "total", total)

if len(sys.argv) > 1 and sys.argv[1] == "split-check":
    base = Path("fixed-deck-runs")
    check_split([base / "20260810-011029", base / "20260810-020321"])
