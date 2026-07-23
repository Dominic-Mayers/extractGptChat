import { MAX_DECK_GAP } from "./constants-no-diag.js";
import { areaAhead } from "./geometry-no-diag.js";
import { selectNextDeckRoom } from "./supplyWorker-no-diag.js";

export function getNextDeckRoomIn(deckRoom) {
    return selectNextDeckRoom(
        areaAhead(deckRoom, MAX_DECK_GAP)
    );
}

export {
    getDecks,
    waitDeckActive
} from "./supplyWorker-no-diag.js";
