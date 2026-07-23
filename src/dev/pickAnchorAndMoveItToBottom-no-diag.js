import { moveAnchorToBottom } from "./moveAnchorToBottom-no-diag.js";
import {
    movementGeometry,
    pickAnchor,
    viewportHeight
} from "./supplyWorker-no-diag.js";

export async function pickAnchorAndMoveItToBottom(room) {
    const anchorRoom = await pickAnchor(room);

    await moveAnchorToBottom(
        anchorRoom,
        viewportHeight()
    );

    const geometry = movementGeometry();
    return {
        anchorRoom,
        slabRoom: geometry.slabRoom,
        deckRoom: geometry.deckRoom
    };
}
