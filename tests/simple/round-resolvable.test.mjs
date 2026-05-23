import { describe, it, expect } from "vitest";
import { _simpleRoundResolvable } from "../../src/chat/pursuit-round-simple.mjs";

const mk = (uuid, { hasResult = false, skipsRoll = false } = {}) => ({ tokenUuid: uuid, hasResult, skipsRoll });

describe("_simpleRoundResolvable", () => {
    it("is false with no participants", () => {
        expect(_simpleRoundResolvable([], [])).toBe(false);
    });

    it("is false when any participant has neither rolled nor skipped", () => {
        const quarry   = [mk("q1", { hasResult: true })];
        const pursuers = [mk("p1"), mk("p2", { hasResult: true })];
        expect(_simpleRoundResolvable(quarry, pursuers)).toBe(false);
    });

    it("is true once every participant has a result", () => {
        const quarry   = [mk("q1", { hasResult: true })];
        const pursuers = [mk("p1", { hasResult: true })];
        expect(_simpleRoundResolvable(quarry, pursuers)).toBe(true);
    });

    it("treats skipped (prone / entangled) participants as ready", () => {
        const quarry   = [mk("q1", { skipsRoll: true })];
        const pursuers = [mk("p1", { hasResult: true })];
        expect(_simpleRoundResolvable(quarry, pursuers)).toBe(true);
    });
});
