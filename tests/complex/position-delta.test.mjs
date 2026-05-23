import { describe, it, expect } from "vitest";
import { _applyPositionDelta } from "../../src/chat/pursuit-round-complex.mjs";

const mkP = (tokenUuid, move, position = 0) => ({
    name: tokenUuid, tokenUuid, actorUuid: null, move,
    skill: "Athletics", moveRating: null, initiative: 10, position,
});

describe("_applyPositionDelta", () => {
    it("first roll (prevSl=null) adds distance moved from zero", () => {
        // move=5, base=2; SL=3 (0–3 range) → 2 yards; prevSl=null → no subtraction
        const result = _applyPositionDelta([mkP("p1", 5, 0)], "p1", 3, null);
        expect(result[0].position).toBe(2);
    });

    it("first roll with SL>=4 adds base+1", () => {
        // move=5, base=2; SL=4 → 3; prevSl=null
        const result = _applyPositionDelta([mkP("p1", 5, 0)], "p1", 4, null);
        expect(result[0].position).toBe(3);
    });

    it("reroll that improves SL adds the positive delta", () => {
        // move=10, base=4; prevSl=0 → dist=4; newSl=4 → dist=5; delta = +1
        const result = _applyPositionDelta([mkP("p1", 10, 10)], "p1", 4, 0);
        expect(result[0].position).toBe(11);
    });

    it("reroll that worsens SL subtracts the negative delta", () => {
        // move=10, base=4; prevSl=4 → dist=5; newSl=0 → dist=4; delta = -1
        const result = _applyPositionDelta([mkP("p1", 10, 10)], "p1", 0, 4);
        expect(result[0].position).toBe(9);
    });

    it("reroll from SL 0 to SL -2 reduces position", () => {
        // move=10, base=4; prevSl=0 → dist=4; newSl=-2 → dist=3; delta = -1
        const result = _applyPositionDelta([mkP("p1", 10, 5)], "p1", -2, 0);
        expect(result[0].position).toBe(4);
    });

    it("does not modify participants with a different tokenUuid", () => {
        const participants = [mkP("p1", 5, 10), mkP("p2", 5, 8)];
        const result = _applyPositionDelta(participants, "p1", 4, null);
        expect(result.find(p => p.tokenUuid === "p2").position).toBe(8);
    });

    it("returns all participants unchanged when tokenUuid not found", () => {
        const participants = [mkP("p1", 5, 5)];
        const result = _applyPositionDelta(participants, "unknown", 3, null);
        expect(result[0].position).toBe(5);
    });

    it("handles position starting at non-zero correctly", () => {
        // move=5, base=2; SL=0 → dist=2; prevSl=null; start=7 → position=9
        const result = _applyPositionDelta([mkP("p1", 5, 7)], "p1", 0, null);
        expect(result[0].position).toBe(9);
    });
});
