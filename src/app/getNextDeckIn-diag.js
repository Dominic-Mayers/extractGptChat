import { MAX_DECK_GAP } from './constants-diag.js';
import { areaAhead } from "./geometry-diag.js";
import { selectNextDeckRoom } from "./supplyWorker-diag.js";

export function getNextDeckRoomIn(deckRoom) {
    return selectNextDeckRoom(
        areaAhead(deckRoom, MAX_DECK_GAP)
    );
}

export {
    getDecks,
    waitDeckActive
} from "./supplyWorker-diag.js";
