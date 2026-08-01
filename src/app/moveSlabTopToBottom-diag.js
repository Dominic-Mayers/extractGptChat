import {

    isAtBottom,
    moveAnchorToBottom
} from "./moveAnchorToBottom-diag.js";
import {
    deckRoom,
    selectAnchor,
    slabRoom,
    viewportHeight
} from "./supplyWorker-diag.js";

export async function moveSlabTopToBottom(initialSlabRoom) {
    const height = viewportHeight();
    let room = initialSlabRoom;

    while (!isAtBottom(height, room)) {
        const previousRoom = room;
        const selectedAnchorRoom = await selectAnchor();

        await moveAnchorToBottom(
            selectedAnchorRoom,
            height
        );

        room = slabRoom();

        if (room === previousRoom) break;
    }

    return {
        slabRoom: room,
        deckRoom: deckRoom()
    };
}
