// stopControl.js
//
// Lets a separate Tampermonkey menu command interrupt an in-progress
// traversal at the next checkpoint, instead of only reloading the page.

let stopRequested = false;

export function requestStop() {
    stopRequested = true;
}

export function resetStop() {
    stopRequested = false;
}

export function isEarlyStopRequestedByUser() {
    return stopRequested;
}
