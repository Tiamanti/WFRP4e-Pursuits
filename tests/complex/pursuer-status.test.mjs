import { describe, it, expect } from "vitest";
import { _pursuerStatusText } from "../../src/chat/pursuit-round-complex.mjs";

const mkQ = (uuid, position) => ({ tokenUuid: uuid, position });
const mkP = (uuid, position) => ({ tokenUuid: uuid, position });

describe("_pursuerStatusText", () => {
    it("returns BehindQuarry with distance when pursuer is behind the closest quarry", () => {
        const pursuer = mkP("p1", 2);
        const quarry  = [mkQ("q1", 5), mkQ("q2", 9)];
        expect(_pursuerStatusText(pursuer, quarry, [])).toBe("PURSUITS.BehindQuarry:{\"distance\":3}");
    });

    it("returns HasCaughtUp when pursuer is at or past closest quarry", () => {
        const pursuer = mkP("p1", 5);
        const quarry  = [mkQ("q1", 5), mkQ("q2", 9)];
        expect(_pursuerStatusText(pursuer, quarry, [])).toBe("PURSUITS.HasCaughtUp");
    });

    it("skips quarry this pursuer has ignored when picking the closest", () => {
        // p1 has ignored q1, even though q1 is closer. Status should refer to q2.
        const pursuer = mkP("p1", 5);
        const quarry  = [mkQ("q1", 5), mkQ("q2", 9)];
        const pairs   = [{ pursuerTokenUuid: "p1", quarryTokenUuid: "q1" }];
        expect(_pursuerStatusText(pursuer, quarry, pairs)).toBe("PURSUITS.BehindQuarry:{\"distance\":4}");
    });

    it("returns NoActiveQuarry when every quarry is ignored by this pursuer", () => {
        const pursuer = mkP("p1", 5);
        const quarry  = [mkQ("q1", 5), mkQ("q2", 9)];
        const pairs   = [
            { pursuerTokenUuid: "p1", quarryTokenUuid: "q1" },
            { pursuerTokenUuid: "p1", quarryTokenUuid: "q2" },
        ];
        expect(_pursuerStatusText(pursuer, quarry, pairs)).toBe("PURSUITS.NoActiveQuarry");
    });

    it("ignores pairs that reference a different pursuer", () => {
        // p2 ignored q1; that should NOT affect p1's status.
        const pursuer = mkP("p1", 2);
        const quarry  = [mkQ("q1", 5)];
        const pairs   = [{ pursuerTokenUuid: "p2", quarryTokenUuid: "q1" }];
        expect(_pursuerStatusText(pursuer, quarry, pairs)).toBe("PURSUITS.BehindQuarry:{\"distance\":3}");
    });
});
