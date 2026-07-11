// scrollContainer.js
//
// Locates the actual scrolling ancestor and provides small
// accessors that work uniformly whether that ancestor is
// document.documentElement or a nested element — see
// ASSUMPTIONS.md A6.
//
// Borrowed from extractor-app.js's findScrollContainer().

/**
 * Walk up from the first message element to find the scrolling
 * ancestor. Falls back to document.documentElement if nothing
 * suitable is found.
 */
export function findScrollContainer() {

    const messageEl = document.querySelector("[data-message-author-role]");

    if (messageEl) {

        let el = messageEl.parentElement;

        while (el && el !== document.body) {

            const { overflowY } = getComputedStyle(el);

            if (
                (overflowY === "auto" || overflowY === "scroll") &&
                el.scrollHeight > el.clientHeight
            ) {
                return el;
            }

            el = el.parentElement;
        }
    }

    return document.documentElement;
}

export function scrollY(container) {

    return container === document.documentElement
        ? window.scrollY
        : container.scrollTop;
}

export function scrollHeight(container) {

    return container === document.documentElement
        ? document.body.scrollHeight
        : container.scrollHeight;
}

export function containerClientHeight(container) {

    return container === document.documentElement
        ? document.documentElement.clientHeight
        : container.clientHeight;
}

export function containerScrollBy(container, top) {

    const target = container === document.documentElement ? window : container;
    target.scrollBy({ top, behavior: "instant" });
}

export function containerScrollTo(container, top) {

    const target = container === document.documentElement ? window : container;
    target.scrollTo({ top, behavior: "instant" });
}
