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
export function areaAhead(
    referenceTop,
    maxGap
) {

    return {
        top: referenceTop - maxGap,
        bottom: referenceTop
    };
}
