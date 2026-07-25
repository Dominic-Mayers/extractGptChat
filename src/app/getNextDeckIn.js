import { MAX_DECK_GAP } from './constants.js';
import { areaAhead } from "./geometry.js";
import { selectNextDeckRoom } from "./supplyWorker.js";

export function getNextDeckRoomIn(deckRoom) {
    return selectNextDeckRoom(
        areaAhead(deckRoom, MAX_DECK_GAP)
    );
}

export {
    getDecks,
    waitDeckActive
} from "./supplyWorker.js";
