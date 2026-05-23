import { describe, it, expect } from "vitest";
import { _complexDistanceMoved } from "../../src/chat/pursuit-round-complex.mjs";

// Character Progress Table (Up in Arms p.119):
//   runYards = move * 4   (WFRP4e Run = Move × 4 yards)
//   base     = max(1, floor(runYards / 10))
//   SL ≥ 4   → base + 1
//   SL 0–3   → base
//   SL -1–-2 → max(0, base - 1)
//   SL ≤ -3  → 0 (halts or falls prone at -5)

describe("_complexDistanceMoved", () => {
    describe("move 5 (runYards=20, base=2)", () => {
        it("SL >= 4  → 3", () => expect(_complexDistanceMoved(4,  5)).toBe(3));
        it("SL 5     → 3", () => expect(_complexDistanceMoved(5,  5)).toBe(3));
        it("SL 3     → 2", () => expect(_complexDistanceMoved(3,  5)).toBe(2));
        it("SL 0     → 2", () => expect(_complexDistanceMoved(0,  5)).toBe(2));
        it("SL -1    → 1", () => expect(_complexDistanceMoved(-1, 5)).toBe(1));
        it("SL -2    → 1", () => expect(_complexDistanceMoved(-2, 5)).toBe(1));
        it("SL -3    → 0", () => expect(_complexDistanceMoved(-3, 5)).toBe(0));
        it("SL -5    → 0", () => expect(_complexDistanceMoved(-5, 5)).toBe(0));
    });

    describe("move 10 (runYards=40, base=4)", () => {
        it("SL >= 4  → 5", () => expect(_complexDistanceMoved(4,  10)).toBe(5));
        it("SL 0–3   → 4", () => expect(_complexDistanceMoved(0,  10)).toBe(4));
        it("SL -1–-2 → 3", () => expect(_complexDistanceMoved(-1, 10)).toBe(3));
        it("SL -2    → 3", () => expect(_complexDistanceMoved(-2, 10)).toBe(3));
        it("SL <= -3 → 0", () => expect(_complexDistanceMoved(-3, 10)).toBe(0));
    });

    describe("move 3 (runYards=12, base=1)", () => {
        it("SL >= 4  → 2", () => expect(_complexDistanceMoved(4,  3)).toBe(2));
        it("SL 0–3   → 1", () => expect(_complexDistanceMoved(1,  3)).toBe(1));
        it("SL -1–-2 → 0", () => expect(_complexDistanceMoved(-1, 3)).toBe(0));
        it("SL <= -3 → 0", () => expect(_complexDistanceMoved(-3, 3)).toBe(0));
    });

    describe("move 15 (runYards=60, base=6)", () => {
        it("SL >= 4  → 7", () => expect(_complexDistanceMoved(4,  15)).toBe(7));
        it("SL 0–3   → 6", () => expect(_complexDistanceMoved(2,  15)).toBe(6));
        it("SL -1–-2 → 5", () => expect(_complexDistanceMoved(-2, 15)).toBe(5));
        it("SL <= -3 → 0", () => expect(_complexDistanceMoved(-4, 15)).toBe(0));
    });

    // JavaScript: Number("-0") === -0, and -0 >= 0 is true, so a naive `sl >= 0` check
    // would place a marginal fail in the base-yards band instead of the base-1 band.
    describe("-0 (marginal fail, same tens bracket as skill)", () => {
        it("move 5:  -0 → 1 (same as SL -1)", () => expect(_complexDistanceMoved(-0, 5)).toBe(1));
        it("move 10: -0 → 3 (same as SL -1)", () => expect(_complexDistanceMoved(-0, 10)).toBe(3));
        it("move 3:  -0 → 0 (base-1 clamped to 0)", () => expect(_complexDistanceMoved(-0, 3)).toBe(0));
    });
});
