import { describe, it, expect } from "vitest";
import { _simpleResolutionDelta } from "../../src/chat/pursuit-round-simple.mjs";

const mkQ = (uuid, move, sl = null) => ({ tokenUuid: uuid, move });
const mkSl = (uuid, sl) => ({ tokenUuid: uuid, sl, messageIds: [] });

describe("_simpleResolutionDelta", () => {
    describe("distance changes", () => {
        it("quarry lead (positive SL delta) increases distance", () => {
            const quarry   = [mkQ("q1", 4)];
            const pursuers = [mkQ("p1", 4)];
            const slResults = [mkSl("q1", 3), mkSl("p1", 0)];
            const { newDistance } = _simpleResolutionDelta({ quarry, pursuers, slResults, distance: 5, escapeDistance: 10 });
            expect(newDistance).toBe(8); // +3
        });

        it("pursuer lead (negative SL delta) decreases distance", () => {
            const quarry   = [mkQ("q1", 4)];
            const pursuers = [mkQ("p1", 4)];
            const slResults = [mkSl("q1", 0), mkSl("p1", 3)];
            const { newDistance } = _simpleResolutionDelta({ quarry, pursuers, slResults, distance: 5, escapeDistance: 10 });
            expect(newDistance).toBe(2); // -3
        });

        it("equal SL results in no distance change", () => {
            const quarry   = [mkQ("q1", 4)];
            const pursuers = [mkQ("p1", 4)];
            const slResults = [mkSl("q1", 2), mkSl("p1", 2)];
            const { newDistance } = _simpleResolutionDelta({ quarry, pursuers, slResults, distance: 5, escapeDistance: 10 });
            expect(newDistance).toBe(5);
        });

        it("clamps distance to 0 (caught)", () => {
            const quarry   = [mkQ("q1", 4)];
            const pursuers = [mkQ("p1", 4)];
            const slResults = [mkSl("q1", 0), mkSl("p1", 6)];
            const { newDistance } = _simpleResolutionDelta({ quarry, pursuers, slResults, distance: 3, escapeDistance: 10 });
            expect(newDistance).toBe(0);
        });

        it("clamps distance to escapeDistance (escaped)", () => {
            const quarry   = [mkQ("q1", 4)];
            const pursuers = [mkQ("p1", 4)];
            const slResults = [mkSl("q1", 6), mkSl("p1", 0)];
            const { newDistance } = _simpleResolutionDelta({ quarry, pursuers, slResults, distance: 8, escapeDistance: 10 });
            expect(newDistance).toBe(10);
        });
    });

    describe("movement speed bonus (SL adjustment)", () => {
        it("faster quarry gets a speed bonus vs slower pursuers", () => {
            // quarry move=4, pursuers move=2 → quarry bonus = move(4) - minPursuerMove(2) = +2
            const quarry   = [mkQ("q1", 4)];
            const pursuers = [mkQ("p1", 2)];
            const slResults = [mkSl("q1", 0), mkSl("p1", 0)];
            const { effectiveQuarrySLs, effectivePursuerSLs, newDistance } =
                _simpleResolutionDelta({ quarry, pursuers, slResults, distance: 5, escapeDistance: 10 });
            expect(effectiveQuarrySLs[0]).toBe(2);  // 0 + 2
            expect(effectivePursuerSLs[0]).toBe(0); // 0 + 0
            expect(newDistance).toBe(7); // 5 + (2 - 0)
        });

        it("faster pursuers get a speed bonus vs slower quarry", () => {
            // quarry move=2, pursuers move=4 → pursuer bonus = move(4) - minQuarryMove(2) = +2
            const quarry   = [mkQ("q1", 2)];
            const pursuers = [mkQ("p1", 4)];
            const slResults = [mkSl("q1", 0), mkSl("p1", 0)];
            const { effectivePursuerSLs, newDistance } =
                _simpleResolutionDelta({ quarry, pursuers, slResults, distance: 5, escapeDistance: 10 });
            expect(effectivePursuerSLs[0]).toBe(2);
            expect(newDistance).toBe(3); // 5 + (0 - 2)
        });

        it("equal move ratings give no bonus to either side", () => {
            const quarry   = [mkQ("q1", 4)];
            const pursuers = [mkQ("p1", 4)];
            const slResults = [mkSl("q1", 1), mkSl("p1", 1)];
            const { effectiveQuarrySLs, effectivePursuerSLs } =
                _simpleResolutionDelta({ quarry, pursuers, slResults, distance: 5, escapeDistance: 10 });
            expect(effectiveQuarrySLs[0]).toBe(1);
            expect(effectivePursuerSLs[0]).toBe(1);
        });
    });

    describe("multiple participants", () => {
        it("uses the worst quarry effective SL (min) to determine outcome", () => {
            // q1 SL=4, q2 SL=0 → quarryBest = min(4, 0) = 0; pursuer SL=0 → no change
            const quarry   = [mkQ("q1", 4), mkQ("q2", 4)];
            const pursuers = [mkQ("p1", 4)];
            const slResults = [mkSl("q1", 4), mkSl("q2", 0), mkSl("p1", 0)];
            const { newDistance } = _simpleResolutionDelta({ quarry, pursuers, slResults, distance: 5, escapeDistance: 10 });
            expect(newDistance).toBe(5); // quarryBest=0, pursuerBest=0 → no change
        });

        it("uses the best pursuer effective SL (max) to determine outcome", () => {
            // p1 SL=-2, p2 SL=3 → pursuerBest = max(-2, 3) = 3; quarry SL=0 → distance -3
            const quarry   = [mkQ("q1", 4)];
            const pursuers = [mkQ("p1", 4), mkQ("p2", 4)];
            const slResults = [mkSl("q1", 0), mkSl("p1", -2), mkSl("p2", 3)];
            const { newDistance } = _simpleResolutionDelta({ quarry, pursuers, slResults, distance: 5, escapeDistance: 10 });
            expect(newDistance).toBe(2); // 5 + (0 - 3)
        });

        it("missing SL results default to 0", () => {
            const quarry   = [mkQ("q1", 4)];
            const pursuers = [mkQ("p1", 4)];
            // No slResults at all
            const { newDistance } = _simpleResolutionDelta({ quarry, pursuers, slResults: [], distance: 5, escapeDistance: 10 });
            expect(newDistance).toBe(5); // 0 - 0 = no change
        });
    });
});
