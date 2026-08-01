import {

    isAtDestination,
    moveAnchorToBottom
} from "./moveAnchorToBottom-diag.js";
import { MIN_INTERSECT } from "./constants-diag.js";
import {
    deckRoom,
    selectAnchor,
    slabRoom,
    viewportHeight
} from "./supplyWorker-diag.js";

export async function moveSlabTopToBottom(initialSlabRoom) {
    const height = viewportHeight();
    const destination = -MIN_INTERSECT;
    let room = initialSlabRoom;

    while (!isAtDestination(destination, room)) {
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
