import { MAX_SLAB_GAP } from './constants-no-diag.js';
import { areaAhead } from "./geometry-no-diag.js";
import { selectNextSlabRoom } from "./supplyWorker-no-diag.js";

export function getNextSlabRoomIn(slabRoom, deckRoom) {
    return selectNextSlabRoom(
        areaAhead(slabRoom, MAX_SLAB_GAP),
        deckRoom
    );
}
