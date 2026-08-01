import {
    isAtBottom,
    moveAnchorToBottom
} from "./moveAnchorToBottom.js";
import {
    deckRoom,
    selectAnchor,
    slabRoom,
    viewportHeight
} from "./supplyWorker.js";

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
