import {

    isAnchorAtBottom,
    moveAnchorToBottom
} from "./moveAnchorToBottom-dev.js";
import {
    deckRoom,
    selectAnchor,
    slabRoom,
    viewportHeight
} from "./supplyWorker-dev.js";

export async function moveSlabTopToBottom(initialSlabRoom) {
    const height = viewportHeight();
    let room = initialSlabRoom;

    while (!isAnchorAtBottom(height, room)) {
        const previousRoom = room;
        const selectedAnchorRoom = await selectAnchor(room);

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
