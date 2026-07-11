// geometry.js
//
// Pure geometric primitives.
//
// These functions know nothing about decks or slabs.
// They operate only on geometric values and DOM elements.

/**
 * Return the search area immediately above a reference position.
 *
 * @param {number} referenceTop
 * @param {number} maxGap
 */
export function areaAhead(referenceTop, maxGap) {

    return {
        top: referenceTop - maxGap,
        bottom: referenceTop
    };
}


/**
 * Return all elements intersecting the search area.
 *
 * @param {Object} area
 * @param {HTMLElement[]} elements
 */
export function intersecting(area, elements) {

    return elements.filter(element => {

        const rect = element.getBoundingClientRect();

        return (
            rect.bottom >= area.top &&
            rect.top <= area.bottom
        );
    });
}


/**
 * Return the candidate having the smallest gap with the
 * reference position (gap = referenceTop - candidate.bottom).
 *
 * tolerance allows a small negative gap — see ASSUMPTIONS.md A7.
 *
 * @param {number} referenceTop
 * @param {HTMLElement[]} candidates
 * @param {number} tolerance
 */
export function closest(referenceTop, candidates, tolerance = 0) {

    let closest = null;
    let smallestGap = Infinity;

    for (const candidate of candidates) {

        const rect = candidate.getBoundingClientRect();

        const gap = referenceTop - rect.bottom;

        if (gap < -tolerance) {
            continue;
        }

        if (gap < smallestGap) {
            smallestGap = gap;
            closest = candidate;
        }
    }

    return closest;
}
