import { MIN_INTERSECT, MAX_DRIFT } from "./constants-no-diag.js";
import { clientHeight } from "./scrollContainer-no-diag.js";
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
    container = document.documentElement,
    direction = -1
) {
    const type = slabType(slab);

    if (type === "image" || type === "empty") return [slab];
    if (type === "message" || type === "canvas") {
        return getTextAnchorsIn(slab, container, direction);
    }
    throw new Error("Cannot select anchors in an unknown slab type.");
}

function getTextAnchorsIn(slab, container, direction) {
    const viewportTop = container === document.documentElement
        ? 0
        : container.getBoundingClientRect().top;
    const viewportHeight = clientHeight(container);
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
        viewportTop,
        viewportHeight,
        targetRoom,
        direction
    );
    if (descendantAnchors.length > 0) return descendantAnchors;

    const slabAnchors = normalBoundaryAnchors(
        [slab],
        viewportTop,
        viewportHeight,
        targetRoom,
        direction
    );
    if (slabAnchors.length > 0) {

        return slabAnchors;
    }

    const coveringAnchors = [];
    for (const candidate of [...descendants, slab]) {
        const rect = candidate.getBoundingClientRect();
        const anchor = makeBoundaryAnchor(candidate, "top");
        const topRoom = measureBoundaryRoom(
            anchor,
            viewportTop,
            viewportHeight,
            direction
        );
        const bottomRoom = direction < 0
            ? rect.bottom - viewportTop
            : viewportTop + viewportHeight - rect.bottom;
        if (topRoom < 0 && bottomRoom >= targetRoom - MAX_DRIFT) {

            coveringAnchors.push(anchor);
        }
    }

    return coveringAnchors.sort((a, b) => {
        const aRoom = measureBoundaryRoom(a, viewportTop, viewportHeight, direction);
        const bRoom = measureBoundaryRoom(b, viewportTop, viewportHeight, direction);
        return bRoom - aRoom;
    });
}

function normalBoundaryAnchors(
    elements,
    viewportTop,
    viewportHeight,
    targetRoom,
    direction
) {
    const anchors = [];
    for (const element of elements) {
        for (const edge of ["top", "bottom"]) {
            const anchor = makeBoundaryAnchor(element, edge);
            const room = measureBoundaryRoom(
                anchor,
                viewportTop,
                viewportHeight,
                direction
            );
            if (room >= 0 && room < targetRoom - MAX_DRIFT) {
                anchors.push(anchor);
            }
        }
    }

    return anchors.sort((a, b) => {
        const aRoom = measureBoundaryRoom(a, viewportTop, viewportHeight, direction);
        const bRoom = measureBoundaryRoom(b, viewportTop, viewportHeight, direction);
        if (aRoom !== bRoom) return aRoom - bRoom;
        return a.edge === "bottom" ? -1 : 1;
    });
}

function makeBoundaryAnchor(element, edge) {
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

function measureBoundaryRoom(anchor, viewportTop, viewportHeight, direction) {
    const rect = anchor.element.getBoundingClientRect();
    const boundary = rect[anchor.edge];
    return direction < 0
        ? boundary - viewportTop
        : viewportTop + viewportHeight - boundary;
}
