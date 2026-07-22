import { MIN_INTERSECT, MAX_DRIFT } from "./constants-no-diag.js";
import { slabType } from "./slabType-no-diag.js";

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

export function getAnchorsIn(
    slab,
    workZone
) {
    const type = slabType(slab);

    if (type === "image" || type === "empty") return [slab];
    if (type === "message" || type === "canvas") {
        return getTextAnchorsIn(slab, workZone);
    }
    throw new Error("Cannot select anchors in an unknown slab type.");
}

function getTextAnchorsIn(slab, workZone) {
    const viewportTop = workZone.top;
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
    if (descendantAnchors.length > 0) return descendantAnchors;

    const slabAnchors = normalBoundaryAnchors(
        [slab],
        targetRoom,
        workZone
    );
    if (slabAnchors.length > 0) {

        return slabAnchors;
    }

    const coveringAnchors = [];
    for (const candidate of [...descendants, slab]) {
        const rect = candidate.getBoundingClientRect();
        const anchor = boundaryAnchor(candidate, "top");
        const topRoom = workZone.roomAheadOf(anchor);
        const bottomRoom = rect.bottom - viewportTop;
        if (topRoom < 0 && bottomRoom >= targetRoom - MAX_DRIFT) {

            coveringAnchors.push(anchor);
        }
    }

    return coveringAnchors.sort((a, b) => {
        const aRoom = workZone.roomAheadOf(a);
        const bRoom = workZone.roomAheadOf(b);
        return bRoom - aRoom;
    });
}

function normalBoundaryAnchors(
    elements,
    targetRoom,
    workZone
) {
    const anchors = [];
    for (const element of elements) {
        for (const edge of ["top", "bottom"]) {
            const anchor = boundaryAnchor(element, edge);
            const room = workZone.roomAheadOf(anchor);
            if (room >= 0 && room < targetRoom - MAX_DRIFT) {
                anchors.push(anchor);
            }
        }
    }

    return anchors.sort((a, b) => {
        const aRoom = workZone.roomAheadOf(a);
        const bRoom = workZone.roomAheadOf(b);
        if (aRoom !== bRoom) return aRoom - bRoom;
        return a.edge === "bottom" ? -1 : 1;
    });
}

export function boundaryAnchor(element, edge) {
    return {
        element,
        edge,
        get isConnected() {
            return element.isConnected;
        },
        getBoundingClientRect() {
            const rect = element.getBoundingClientRect();
            const boundary = rect[edge];
            return {
                top: boundary,
                bottom: boundary,
                left: rect.left,
                right: rect.right,
                width: rect.width,
                height: 0
            };
        }
    };
}
