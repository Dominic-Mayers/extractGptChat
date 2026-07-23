import { MAX_SLAB_GAP } from "./constants.js";
import { areaAhead } from "./geometry.js";
import { selectNextSlabRoom } from "./supplyWorker.js";

export function getNextSlabRoomIn(slabRoom, deckRoom) {
    return selectNextSlabRoom(
        areaAhead(slabRoom, MAX_SLAB_GAP),
        deckRoom
    );
}
