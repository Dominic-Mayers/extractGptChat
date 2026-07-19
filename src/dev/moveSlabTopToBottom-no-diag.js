import { clientHeight } from "./scrollContainer-no-diag.js";
import { moveAnchorToBottom } from "./moveAnchorToBottom-no-diag.js";
import { slabType } from "./slabType-no-diag.js";
import { getAnchorsIn } from "./getAnchorsIn-no-diag.js";
export async function moveSlabTopToBottom(current, container, direction = -1) {
    const type = slabType(current);

    if (type === "unknown") {
        throw new Error("Cannot move an unknown slab type.");
    }

    if (type === "image" || type === "empty") {

        await waitImageReady(current);

        return moveAnchorToBottom(
            current,
            container,
            direction,
            measureRoom,
            Infinity
        );
    }

    let room = measureRoom(current, container, direction);

    while (room < 0) {
        const anchors = getAnchorsIn(current, container, direction);
        const anchor = anchors[0];
        if (!anchor) {
            throw new Error("No ready visible anchor found in current slab.");
        }

        await moveAnchorToBottom(
            anchor,
            container,
            direction,
            measureAnchorRoom
        );
        room = measureRoom(current, container, direction);
    }

    const anchors = getAnchorsIn(current, container, direction);
    const currentRect = current.getBoundingClientRect();
    const anchor = anchors.find(candidate => {
        const boundary = candidate.getBoundingClientRect().top;
        return boundary >= currentRect.top && boundary <= currentRect.bottom;
    });
    if (!anchor) {
        throw new Error(
            "No ready visible anchor found for final slab movement."
        );
    }

    await moveAnchorToBottom(
        anchor,
        container,
        direction,
        measureAnchorRoom
    );
    return measureRoom(current, container, direction);
}

export function measureRoom(current, container, direction) {
    const viewportHeight = clientHeight(container);
    const rect = current.getBoundingClientRect();
    return direction < 0
        ? rect.top
        : viewportHeight - rect.bottom;
}

export function measureAnchorRoom(anchor, container, direction) {
    const viewportHeight = clientHeight(container);
    const viewportTop = container === document.documentElement
        ? 0
        : container.getBoundingClientRect().top;
    const rect = anchor.element.getBoundingClientRect();
    const boundary = rect[anchor.edge];
    return direction < 0
        ? boundary - viewportTop
        : viewportTop + viewportHeight - boundary;
}

async function waitImageReady(current) {
    const images = current.matches?.("img")
        ? [current]
        : current.querySelectorAll
            ? [...current.querySelectorAll("img")]
            : [];

    for (const image of images) {
        if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) {
            await new Promise((resolve, reject) => {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", reject, { once: true });
            });
        }
        if (typeof image.decode === "function") await image.decode();
    }
}
