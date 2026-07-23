import { isAnchorAtBottom } from "./moveAnchorToBottom.js";
import { pickAnchorAndMoveItToBottom } from "./pickAnchorAndMoveItToBottom.js";
import { viewportHeight } from "./supplyWorker.js";

export async function moveSlabTopToBottom(slabRoom, deckRoom) {
    const height = viewportHeight();
    let room = slabRoom;
    let anchorRoom = null;

    while (!isAnchorAtBottom(height, room)) {
        const previousRoom = room;
        const movement = await pickAnchorAndMoveItToBottom(room);

        anchorRoom = movement.anchorRoom;
        room = movement.slabRoom;
        deckRoom = movement.deckRoom;

        if (room === previousRoom) break;
    }

    return {
        anchorRoom,
        slabRoom: room,
        deckRoom
    };
}
