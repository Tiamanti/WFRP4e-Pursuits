import { describe, it, expect } from "vitest"
import { rollForSL } from "./e2e/helpers.mjs"

// WFRP4e SL formula: sl = floor(skill/10) - floor(roll/10)
// A roll <= skill is a pass; a roll > skill is a fail (the +0 / -0 boundary).

describe("rollForSL", () => {
    it("targetSL=0 returns a roll that is a pass (roll <= skill)", () => {
        // skill=60: tens=6, midpoint 65 > 60 → would be -0 fail without the fix
        const roll = rollForSL(60, 0)
        expect(roll).toBeLessThanOrEqual(60)
        expect(Math.floor(60 / 10) - Math.floor(roll / 10)).toBe(0)
    })

    it("targetSL=0 works when skill%10 >= 5", () => {
        // skill=65: tens*10+5=65 <= 65 → would pass accidentally; fix should still be correct
        const roll = rollForSL(65, 0)
        expect(roll).toBeLessThanOrEqual(65)
        expect(Math.floor(65 / 10) - Math.floor(roll / 10)).toBe(0)
    })

    it("targetSL=1 returns a roll one SL better than skill", () => {
        const roll = rollForSL(60, 1)
        expect(Math.floor(60 / 10) - Math.floor(roll / 10)).toBe(1)
    })

    it("targetSL=-1 returns a roll that is a fail with SL -1", () => {
        const roll = rollForSL(60, -1)
        expect(roll).toBeGreaterThan(60)
        expect(Math.floor(60 / 10) - Math.floor(roll / 10)).toBe(-1)
    })

    it("targetSL=4 (high positive SL) produces correct roll", () => {
        const roll = rollForSL(60, 4)
        expect(Math.floor(60 / 10) - Math.floor(roll / 10)).toBe(4)
    })

    it("never returns 0 or below (invalid d100 value)", () => {
        for (const sl of [-2, -1, 0, 1, 2]) {
            expect(rollForSL(10, sl)).toBeGreaterThanOrEqual(1)
        }
    })
})
