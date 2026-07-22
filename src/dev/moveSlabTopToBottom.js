import {
    moveNextAnchorToBottom,
    moveSlabBoundaryToBottom
} from "./slabBrowser.js";

export async function moveSlabTopToBottom(state) {
    let geometry = state;

    while (geometry.slabRoom < 0) {
        geometry = await moveNextAnchorToBottom(
            geometry.slabRoom,
            geometry.deckRoom
        );
    }

    return moveSlabBoundaryToBottom(
        geometry.slabRoom,
        geometry.deckRoom
    );
}
