import {
    ACTIVATION_DISTANCE,
    TOLERATED_ROUNDING,
    MAX_FRAMES_FOR_STABILIZATION
} from "./constants.js";
import {
    anchorRoom,
    roomUntilFirstNotReadyDeck,
    supplyHeight,
    supplyRoom
} from "./supplyWorker.js";
import {
    beginStabilizationDiagnostics,
    finishStabilizationDiagnostics,
    beginRafDiagnostics,
    finishRafWaitDiagnostics,
    recordRafTelemetryDiagnostics,
    beginYieldDiagnostics,
    finishYieldDiagnostics,
    finishRafDiagnostics
} from "./cycleDiagnostics.js";

let longWaitDomDiagnostics = null;

export async function waitLayoutStable(
    {
        maxFrames = MAX_FRAMES_FOR_STABILIZATION,
        trackAnchor = false
    } = {}
) {
    const stableFrames = trackAnchor &&
        roomUntilFirstNotReadyDeck() > ACTIVATION_DISTANCE
        ? 1
        : 2;

    let previous = geometrySnapshot();
    let unchanged = 0;
    beginStabilizationDiagnostics({ stableFrames });
    beginLongWaitDomDiagnostics(previous.scrollHeight);

    for (let frame = 0; frame < maxFrames; frame++) {
        beginRafDiagnostics({ frame: frame + 1 });
        await nextAnimationFrame();
        finishRafWaitDiagnostics();

        const currentGeometry = geometrySnapshot();
        recordLongWaitDomDiagnostics(currentGeometry.scrollHeight, frame + 1);
        const scrollHeightChange = Math.abs(
            currentGeometry.scrollHeight - previous.scrollHeight
        );
        const scrollYChange = Math.abs(
            currentGeometry.scrollY - previous.scrollY
        );
        const effectiveScrollHeightChange =
            scrollHeightChange < TOLERATED_ROUNDING
                ? 0
                : scrollHeightChange;
        const geometryChangeMagnitude = Math.max(
            effectiveScrollHeightChange,
            scrollYChange
        );
        const geometryChanged = geometryChangeMagnitude !== 0;
        const positionAtFrame = trackAnchor
            ? anchorRoom()
            : null;
        recordRafTelemetryDiagnostics({
            geometryChangeMagnitude,
            scrollHeightChange,
            scrollHeightChangeIgnored:
                scrollHeightChange > 0 && effectiveScrollHeightChange === 0,
            scrollYChange,
            scrollHeight: currentGeometry.scrollHeight,
            scrollY: currentGeometry.scrollY,
            anchorPosition: positionAtFrame
        });

        if (geometryChanged) {
            finishRafDiagnostics({ status: "geometry-changed" });
            previous = currentGeometry;
            unchanged = 0;
            continue;
        }

        const anchorStable = await checkAnchorAcrossYields(
            trackAnchor,
            positionAtFrame
        );
        const positionNowDiagnostics = trackAnchor
            ? anchorRoom()
            : null;

        if (!anchorStable) {
            finishRafDiagnostics({ status: "anchor-changed" });
            previous = currentGeometry;
            unchanged = 0;
            continue;
        }

        unchanged++;
        finishRafDiagnostics({ status: "stable", unchanged });

        if (unchanged >= stableFrames) {
            finishStabilizationDiagnostics({
                status: "stable",
                frames: frame + 1,
                position: positionNowDiagnostics
            });
            finishLongWaitDomDiagnostics();
            return;
        }
    }
    finishStabilizationDiagnostics({
        status: "exceeded-max-frames",
        frames: maxFrames
    });
    finishLongWaitDomDiagnostics();
    throw new Error(
        `Exceeded ${maxFrames} frames waiting for layout stabilization.`
    );
}


/**
 * Return a fingerprint of the current geometry.
 *
 * Any geometric change that matters to traversal should
 * modify at least one of these quantities.
 */
function geometrySnapshot() {

    return {
        scrollHeight: supplyHeight(),
        scrollY: supplyRoom()
    };
}

async function checkAnchorAcrossYields(
    trackAnchor,
    positionAtFrame
) {
    let previousPosition = positionAtFrame;
    let stable = true;

    for (let yieldIndex = 1; yieldIndex <= 2; yieldIndex++) {
        beginYieldDiagnostics({
            index: yieldIndex,
            positionBefore: previousPosition
        });
        await yieldToScheduler();
        const position = trackAnchor
            ? anchorRoom()
            : null;
        const change = position == null || previousPosition == null
            ? 0
            : Math.abs(position - previousPosition);
        const changed = change !== 0;
        finishYieldDiagnostics({ positionAfter: position, change, changed });

        if (changed) stable = false;
        previousPosition = position;
    }

    return stable;
}

async function yieldToScheduler() {
    if (typeof globalThis.scheduler?.yield === "function") {
        await globalThis.scheduler.yield();
        return;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
}


/**
 * Wait for the next animation frame.
 */
export function nextAnimationFrame() {

    return new Promise(resolve =>
        requestAnimationFrame(resolve)
    );
}

function beginLongWaitDomDiagnostics(initialSupplyHeight) {
    finishLongWaitDomDiagnostics();

    const state = {
        active: false,
        initialSupplyHeight,
        lastSupplyHeight: initialSupplyHeight,
        snapshots: new Map(),
        transitions: new Set(),
        mutations: [],
        observer: null,
        timer: null
    };

    state.timer = setTimeout(() => {
        state.active = true;
        state.snapshots.set(
            state.lastSupplyHeight,
            captureDomGeometryDiagnostics()
        );
        state.observer = new MutationObserver(records => {
            for (const record of records) {
                state.mutations.push(describeMutationDiagnostics(record));
            }
            if (state.mutations.length > 100) {
                state.mutations.splice(0, state.mutations.length - 100);
            }
        });
        state.observer.observe(document.documentElement, {
            attributes: true,
            attributeOldValue: true,
            childList: true,
            characterData: true,
            subtree: true
        });
        console.log(
            "[diagnostics long stabilization] DOM investigation started.\n" +
            JSON.stringify({
                supplyHeight: state.lastSupplyHeight
            }, null, 2)
        );
    }, 5000);

    longWaitDomDiagnostics = state;
}

function recordLongWaitDomDiagnostics(supplyHeight, frame) {
    const state = longWaitDomDiagnostics;
    if (!state?.active || supplyHeight === state.lastSupplyHeight) return;

    const previousSupplyHeight = state.lastSupplyHeight;
    const transition = `${previousSupplyHeight}->${supplyHeight}`;
    let currentSnapshot = state.snapshots.get(supplyHeight);

    if (!currentSnapshot) {
        currentSnapshot = captureDomGeometryDiagnostics();
        state.snapshots.set(supplyHeight, currentSnapshot);
    }

    if (!state.transitions.has(transition)) {
        const previousSnapshot =
            state.snapshots.get(previousSupplyHeight) ?? new Map();
        const mutationsDiagnostics = state.mutations.splice(0);
        const reportDiagnostics = {
            frame,
            previousSupplyHeight,
            supplyHeight,
            difference: supplyHeight - previousSupplyHeight,
            sixteenPixelCandidates: findSixteenPixelElementsDiagnostics(
                previousSnapshot,
                currentSnapshot
            ),
            intersectionChanges: findIntersectionChangesDiagnostics(
                previousSnapshot,
                currentSnapshot
            ),
            mutations: mutationsDiagnostics.slice(-20),
            elements: compareDomGeometryDiagnostics(
                previousSnapshot,
                currentSnapshot
            ).slice(0, 10)
        };
        console.log(
            "[diagnostics long stabilization] DOM geometry changed.\n" +
            JSON.stringify(reportDiagnostics, null, 2)
        );
        state.transitions.add(transition);
    }

    state.lastSupplyHeight = supplyHeight;
}

function finishLongWaitDomDiagnostics() {
    const state = longWaitDomDiagnostics;
    if (!state) return;
    clearTimeout(state.timer);
    state.observer?.disconnect();
    longWaitDomDiagnostics = null;
}

function captureDomGeometryDiagnostics() {
    const snapshot = new Map();

    for (const element of document.querySelectorAll("*")) {
        const rect = element.getBoundingClientRect();
        snapshot.set(element, {
            selector: selectorForDomDiagnostics(element),
            depth: elementDepthDiagnostics(element),
            turnId: element.closest("[data-turn-id-container]")
                ?.getAttribute("data-turn-id-container") ?? null,
            messageId: element.closest("[data-message-id]")
                ?.getAttribute("data-message-id") ?? null,
            dataIsIntersecting:
                element.getAttribute("data-is-intersecting"),
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight
        });
    }

    return snapshot;
}

function compareDomGeometryDiagnostics(previous, current) {
    const changes = [];
    const elements = new Set([...previous.keys(), ...current.keys()]);

    for (const element of elements) {
        const before = previous.get(element);
        const after = current.get(element);

        if (!before || !after) {
            changes.push({
                selector: before?.selector ?? after?.selector,
                depth: before?.depth ?? after?.depth,
                connectedBefore: before != null,
                connectedAfter: after != null
            });
            continue;
        }

        const heightChange = after.height - before.height;
        const topChange = after.top - before.top;
        const bottomChange = after.bottom - before.bottom;
        const scrollHeightChange = after.scrollHeight - before.scrollHeight;
        const clientHeightChange = after.clientHeight - before.clientHeight;

        if (
            heightChange === 0 &&
            topChange === 0 &&
            bottomChange === 0 &&
            scrollHeightChange === 0 &&
            clientHeightChange === 0
        ) continue;

        changes.push({
            selector: after.selector,
            depth: after.depth,
            heightBefore: before.height,
            heightAfter: after.height,
            heightChange,
            topChange,
            bottomChange,
            scrollHeightChange,
            clientHeightChange
        });
    }

    return changes
        .sort((first, second) =>
            Math.abs(second.heightChange ?? 0) -
                Math.abs(first.heightChange ?? 0) ||
            second.depth - first.depth
        );
}

function findSixteenPixelElementsDiagnostics(previous, current) {
    const candidates = [];
    const elements = new Set([...previous.keys(), ...current.keys()]);

    for (const element of elements) {
        const before = previous.get(element);
        const after = current.get(element);
        const heightBefore = before?.height ?? 0;
        const heightAfter = after?.height ?? 0;
        const heightChange = heightAfter - heightBefore;
        const changedBySixteen =
            Math.abs(Math.abs(heightChange) - 16) <= TOLERATED_ROUNDING;
        const appearedOrCollapsed =
            Math.min(heightBefore, heightAfter) <= TOLERATED_ROUNDING;

        if (!changedBySixteen || !appearedOrCollapsed) continue;

        candidates.push({
            selector: before?.selector ?? after?.selector,
            depth: before?.depth ?? after?.depth,
            turnId: before?.turnId ?? after?.turnId,
            messageId: before?.messageId ?? after?.messageId,
            heightBefore,
            heightAfter,
            heightChange,
            presentBefore: before != null,
            presentAfter: after != null
        });
    }

    return candidates.sort((first, second) =>
        second.depth - first.depth
    );
}

function findIntersectionChangesDiagnostics(previous, current) {
    const changes = [];
    const elements = new Set([...previous.keys(), ...current.keys()]);

    for (const element of elements) {
        const before = previous.get(element);
        const after = current.get(element);
        const valueBefore = before?.dataIsIntersecting ?? null;
        const valueAfter = after?.dataIsIntersecting ?? null;

        if (
            valueBefore === valueAfter ||
            (valueBefore == null && valueAfter == null)
        ) continue;

        changes.push({
            selector: before?.selector ?? after?.selector,
            turnId: before?.turnId ?? after?.turnId,
            valueBefore,
            valueAfter,
            presentBefore: before != null,
            presentAfter: after != null
        });
    }

    return changes;
}

function describeMutationDiagnostics(record) {
    const target = record.target.nodeType === 1
        ? record.target
        : record.target.parentElement;
    return {
        type: record.type,
        target: selectorForDomDiagnostics(target),
        turnId: target.closest?.("[data-turn-id-container]")
            ?.getAttribute("data-turn-id-container") ?? null,
        messageId: target.closest?.("[data-message-id]")
            ?.getAttribute("data-message-id") ?? null,
        attribute: record.attributeName,
        valueBefore: record.oldValue,
        valueAfter: record.attributeName
            ? target.getAttribute?.(record.attributeName) ?? null
            : null,
        added: [...record.addedNodes].map(node =>
            selectorForDomDiagnostics(node)
        ),
        removed: [...record.removedNodes].map(node =>
            selectorForDomDiagnostics(node)
        )
    };
}

function selectorForDomDiagnostics(node) {
    if (node?.nodeType !== 1) return node?.nodeName ?? null;
    if (node.id) return `#${node.id}`;

    for (const attribute of [
        "data-message-id",
        "data-turn-id-container",
        "data-testid"
    ]) {
        const value = node.getAttribute(attribute);
        if (value != null) return `[${attribute}="${value}"]`;
    }

    const classes = [...node.classList].slice(0, 3);
    return `${node.tagName.toLowerCase()}${classes.length
        ? `.${classes.join(".")}`
        : ""}`;
}

function elementDepthDiagnostics(element) {
    let depth = 0;
    for (let current = element; current; current = current.parentElement) {
        depth++;
    }
    return depth;
}
