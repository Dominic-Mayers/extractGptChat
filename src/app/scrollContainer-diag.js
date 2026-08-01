// scrollContainer.js

//
// Locates the actual scrolling ancestor and provides small
// accessors that work uniformly whether that ancestor is
// document.documentElement or a nested element — see
// ASSUMPTIONS.md A6.
//
/**
 * Walk up from the first message element to find the scrolling
 * ancestor. Falls back to document.documentElement if nothing
 * suitable is found.
 */
const containers = new WeakMap();

function findScrollContainer() {

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

export function observeSupplier() {
    return createSupplier(findScrollContainer());
}

export function createSupplier(container) {
    const supplyArea = {};
    const activeArea = {};
    const workZone = {
        get height() {
            return clientHeight(container);
        }
    };

    containers.set(supplyArea, container);
    containers.set(activeArea, container);
    containers.set(workZone, container);

    return { supplyArea, activeArea, workZone };
}

export function roomAhead(anchor, workZone) {
    return boundaryPosition(anchor) - workZoneTop(workZone);
}

export function viewportPosition(anchor, workZone) {
    return boundaryPosition(anchor) - workZoneTop(workZone);
}

export function workZonePosition(supplyArea, workZone) {
    const container = commonContainer(supplyArea, workZone);
    return scrollY(container);
}

export function supplyHeight(supplyArea) {
    return scrollHeight(containerFor(supplyArea));
}

export function moveWorkZone(distance, supplyArea, workZone) {
    const container = commonContainer(supplyArea, workZone);
    scrollBy(container, -distance);
}

export function nextAnimationFrame() {
    return new Promise(resolve =>
        requestAnimationFrame(resolve)
    );
}

export function moveWorkZoneToSupplyEnd(supplyArea, workZone) {
    const container = commonContainer(supplyArea, workZone);
    scrollTo(container, scrollHeight(container));
}

export function isAtSupplyBoundary(supplyArea, workZone) {
    return workZonePosition(supplyArea, workZone) <= 0;
}

export function elementsIn(area, selector) {
    return containerFor(area).querySelectorAll(selector);
}

export function contains(area, element) {
    return containerFor(area).contains(element);
}

export function workZoneTop(workZone) {
    const container = containerFor(workZone);
    return container === document.documentElement
        ? 0
        : container.getBoundingClientRect().top;
}

function boundaryPosition(anchor) {
    const rect = anchor.element.getBoundingClientRect();
    return rect[anchor.edge];
}

function commonContainer(first, second) {
    const container = containerFor(first);
    if (container !== containerFor(second)) {
        throw new Error("Supplier areas belong to different environments.");
    }
    return container;
}

function containerFor(area) {
    const container = containers.get(area);
    if (!container) throw new Error("Unknown Supplier area.");
    return container;
}

function scrollY(container) {

    return container === document.documentElement
        ? window.scrollY
        : container.scrollTop;
}

function scrollHeight(container) {

    return container === document.documentElement
        ? document.body.scrollHeight
        : container.scrollHeight;
}

function clientHeight(container) {

    return container === document.documentElement
        ? document.documentElement.clientHeight
        : container.clientHeight;
}

function scrollBy(container, top) {

    const target = container === document.documentElement
        ? window
        : container;
    target.scrollBy({ top, behavior: "instant" });
}

function scrollTo(container, top) {

    const target = container === document.documentElement ? window : container;
    target.scrollTo({ top, behavior: "instant" });
}
