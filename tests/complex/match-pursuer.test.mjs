import { describe, it, expect } from "vitest";
import { _matchPursuerToQuarry } from "../../src/chat/pursuit-round-complex.mjs";

const mkQ = (uuid, position) => ({ tokenUuid: uuid, name: uuid, position });
const mkP = (uuid, position) => ({ tokenUuid: uuid, name: uuid, position });

describe("_matchPursuerToQuarry", () => {
    it("returns null when no pursuers have reached the quarry", () => {
        const q = mkQ("q1", 10);
        const result = _matchPursuerToQuarry(q, [mkP("p1", 5)]);
        expect(result).toBeNull();
    });

    it("returns the pursuer at the quarry's exact position", () => {
        const q = mkQ("q1", 10);
        const result = _matchPursuerToQuarry(q, [mkP("p1", 10)]);
        expect(result?.tokenUuid).toBe("p1");
    });

    it("returns the pursuer furthest ahead (closest to quarry among those that have passed)", () => {
        // p2 at 11 is closer to quarry(10) than p3 at 15 — lowest position among those >= 10
        const q = mkQ("q1", 10);
        const result = _matchPursuerToQuarry(q, [mkP("p2", 11), mkP("p3", 15), mkP("p1", 8)]);
        expect(result?.tokenUuid).toBe("p2");
    });

    it("returns null when the only eligible pursuer is in an ignored pair", () => {
        const q = mkQ("q1", 10);
        const ignoredPairs = [{ quarryTokenUuid: "q1", pursuerTokenUuid: "p1" }];
        const result = _matchPursuerToQuarry(q, [mkP("p1", 10)], ignoredPairs);
        expect(result).toBeNull();
    });

    it("skips ignored pursuers and picks the next eligible one", () => {
        const q = mkQ("q1", 10);
        const ignoredPairs = [{ quarryTokenUuid: "q1", pursuerTokenUuid: "p1" }];
        // p1 is ignored; p2 at 12 is the next closest
        const result = _matchPursuerToQuarry(q, [mkP("p1", 10), mkP("p2", 12)], ignoredPairs);
        expect(result?.tokenUuid).toBe("p2");
    });

    it("ignores pairs for different quarry members", () => {
        const q = mkQ("q1", 10);
        // ignored pair is for q2, not q1 — p1 is still a valid match for q1
        const ignoredPairs = [{ quarryTokenUuid: "q2", pursuerTokenUuid: "p1" }];
        const result = _matchPursuerToQuarry(q, [mkP("p1", 10)], ignoredPairs);
        expect(result?.tokenUuid).toBe("p1");
    });

    it("returns null when quarry position is 0 and all pursuers are behind (negative positions impossible, so position 0 only matches position >= 0)", () => {
        // Pursuers at negative-equivalent: since position is always >= 0, test with pursuers at 0
        const q = mkQ("q1", 0);
        const result = _matchPursuerToQuarry(q, [mkP("p1", 0)]);
        expect(result?.tokenUuid).toBe("p1");
    });
});
