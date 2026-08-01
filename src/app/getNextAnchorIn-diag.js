import { MIN_INTERSECT, MAX_DRIFT } from './constants-diag.js';
import { slabType } from "./slabType-diag.js";
import { roomAhead, workZoneTop } from "./scrollContainer-diag.js";

const TEXT_ANCHOR_SELECTOR = [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "blockquote",
    "pre",
    "figcaption",
    "td",
    "th"
].join(",");

export function getNextAnchorIn(
    slab,
    workZone
) {
    const type = slabType(slab);

    if (type === "image" || type === "empty") {
        return { element: slab, edge: "top" };
    }
    if (type === "message" || type === "canvas") {
        return getNextTextAnchorIn(slab, workZone);
    }
    throw new Error("Cannot select anchors in an unknown slab type.");
}

function getNextTextAnchorIn(slab, workZone) {
    const viewportTop = workZoneTop(workZone);
    const viewportHeight = workZone.height;
    const targetRoom = viewportHeight - MIN_INTERSECT;
    const descendants = [];

    for (const candidate of slab.querySelectorAll(TEXT_ANCHOR_SELECTOR)) {
        if (candidate.closest(".cm-editor, .monaco-editor")) continue;

        const rect = candidate.getBoundingClientRect();
        const ready = candidate.isConnected && rect.width > 0 && rect.height > 0;
        if (ready) descendants.push(candidate);
    }

    const descendantAnchors = normalBoundaryAnchors(
        descendants,
        targetRoom,
        workZone
    );
    if (descendantAnchors.length > 0) return descendantAnchors[0];

    const slabAnchors = normalBoundaryAnchors(
        [slab],
        targetRoom,
        workZone
    );
    if (slabAnchors.length > 0) {
        recordSlabFallbackDiagnostics(slabAnchors);
        return slabAnchors[0];
    }

    const coveringAnchors = [];
    for (const candidate of [...descendants, slab]) {
        const rect = candidate.getBoundingClientRect();
        const anchor = { element: candidate, edge: "top" };
        const topRoom = roomAhead(anchor, workZone);
        const bottomRoom = rect.bottom - viewportTop;
        if (topRoom < 0 && bottomRoom >= targetRoom - MAX_DRIFT) {
            recordNegativeAnchorDiagnostics(
                anchor,
                "covers-viewport-work-zone"
            );
            coveringAnchors.push(anchor);
        }
    }

    return coveringAnchors.sort((a, b) => {
        const aRoom = roomAhead(a, workZone);
        const bRoom = roomAhead(b, workZone);
        return bRoom - aRoom;
    })[0] ?? null;
}

function normalBoundaryAnchors(
    elements,
    targetRoom,
    workZone
) {
    const anchors = [];
    for (const element of elements) {
        for (const edge of ["top", "bottom"]) {
            const anchor = { element, edge };
            const room = roomAhead(anchor, workZone);
            if (room >= 0 && room < targetRoom - MAX_DRIFT) {
                anchors.push(anchor);
            }
        }
    }

    return anchors.sort((a, b) => {
        const aRoom = roomAhead(a, workZone);
        const bRoom = roomAhead(b, workZone);
        if (aRoom !== bRoom) return aRoom - bRoom;
        return a.edge === "bottom" ? -1 : 1;
    });
}

function recordNegativeAnchorDiagnostics(anchor, acceptanceReason) {
    anchor.acceptedNegative = true;
    anchor.acceptanceReason = acceptanceReason;
    anchor.fallbackKind = "negative-covering-anchor";
}

function recordSlabFallbackDiagnostics(anchors) {
    for (const anchor of anchors) {
        anchor.fallbackKind = "slab-boundary";
    }
}
