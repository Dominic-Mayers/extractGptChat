import { MAX_DECK_GAP } from './constants-dev.js';
import { areaAhead } from "./geometry-dev.js";
import { selectNextDeckRoom } from "./supplyWorker-dev.js";

export function getNextDeckRoomIn(deckRoom) {
    return selectNextDeckRoom(
        areaAhead(deckRoom, MAX_DECK_GAP)
    );
}

export {
    getDecks,
    waitDeckActive
} from "./supplyWorker-dev.js";
