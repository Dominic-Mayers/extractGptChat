let previousCycle = null;
let currentCycle = null;

const SLOW_JUMP_MS = 1000;

export function resetCycleDiagnostics() {
    previousCycle = null;
    currentCycle = null;
}

export function beginCycleDiagnostics(data) {
    previousCycle = currentCycle;
    currentCycle = {
        ...data,
        stages: [],
        jumps: []
    };
}

export function beginJumpDiagnostics(data) {
    if (!currentCycle) return;
    currentCycle.jumps.push({
        ...data,
        status: "pending",
        startedAtDiagnostics: performance.now()
    });
}

export function updateJumpDiagnostics(data) {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics) return;
    Object.assign(jumpDiagnostics, data);
}

export function finishJumpDiagnostics(data = {}) {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics) return null;

    const elapsedMs = performance.now() - jumpDiagnostics.startedAtDiagnostics;
    delete jumpDiagnostics.startedAtDiagnostics;

    Object.assign(jumpDiagnostics, data, {
        elapsedMs,
        status: data.status ?? "complete"
    });

    return jumpDiagnostics.elapsedMs;
}

export function logSlowJumpDiagnosticsIfNeeded() {
    const jumpDiagnostics = currentJumpDiagnostics();
    if (!jumpDiagnostics || jumpDiagnostics.elapsedMs < SLOW_JUMP_MS) return;
    logCycleContextDiagnostics();
}

function currentJumpDiagnostics() {
    return currentCycle?.jumps[currentCycle.jumps.length - 1] ?? null;
}

export function recordCycleStageDiagnostics(stage, data = {}) {
    if (!currentCycle) return;
    currentCycle.stages.push({ stage, ...data });
}

export function snapshotElementDiagnostics(element) {
    if (!element?.getBoundingClientRect) return null;

    const rect = element.getBoundingClientRect();

    return {
        id: element.getAttribute?.("data-message-id") ??
            element.getAttribute?.("data-turn-id-container") ??
            element.id ??
            "synthetic",
        top: roundDiagnostics(rect.top),
        bottom: roundDiagnostics(rect.bottom),
        height: roundDiagnostics(rect.height),
        connected: element.isConnected ?? null
    };
}

function logCycleContextDiagnostics() {
    console.log([
        "[traverseConversation]",
        formatSlabDiagnostics("PREVIOUS", previousCycle),
        "",
        formatSlabDiagnostics("CURRENT", currentCycle)
    ].join("\n"));
}

function formatJumpsDiagnostics(jumps) {
    return [
        "──── JUMPS IN SLAB ────",
        ...jumps.map((jump, index) =>
            `${String(index + 1).padStart(2, "0")}  ${formatValueDiagnostics(jump)}`
        ),
        "──── END JUMPS ────"
    ].join("\n");
}

function formatSlabDiagnostics(label, cycle) {
    if (!cycle) return `════ ${label} SLAB: NONE ════`;

    const state = Object.entries(cycle)
        .filter(([key]) => key !== "stages" && key !== "jumps" && key !== "cycle")
        .map(([key, value]) => `${key}=${formatValueDiagnostics(value)}`)
        .join(" │ ");

    const stages = cycle.stages.flatMap(({ stage, ...data }, index) => [
        `${String(index + 1).padStart(2, "0")} → ${stage.toUpperCase().replace(/-/g, " ")}`,
        `     ${formatFieldsDiagnostics(data)}`
    ]);

    return [
        `════ ${label} SLAB ${cycle.slabCount} ════`,
        `START  ${state}`,
        formatJumpsDiagnostics(cycle.jumps),
        ...stages,
        `════ END ${label} SLAB ${cycle.slabCount} ════`
    ].join("\n");
}

function formatFieldsDiagnostics(value) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "-";

    return entries
        .map(([key, item]) => `${key}=${formatValueDiagnostics(item)}`)
        .join(" │ ");
}

function formatValueDiagnostics(value) {
    if (value instanceof Error) {
        return JSON.stringify({
            name: value.name,
            message: value.message,
            stack: value.stack
        });
    }

    if (typeof value === "number") return String(roundDiagnostics(value));
    if (typeof value === "string") return value;
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (Array.isArray(value)) {
        return `[${value.map(formatValueDiagnostics).join(", ")}]`;
    }
    if (typeof value === "object") {
        return `{${formatFieldsDiagnostics(value)}}`;
    }

    return JSON.stringify(value);
}

function roundDiagnostics(value) {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
}
