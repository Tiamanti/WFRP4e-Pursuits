import { describe, it, expect } from "vitest";
import { _buildPositionDiagram } from "../../src/chat/pursuit-round-complex.mjs";

const mkP = (tokenUuid, opts = {}) => ({
    tokenUuid,
    name:         opts.name ?? tokenUuid,
    position:     opts.position ?? 0,
    actionsTaken: opts.actionsTaken ?? 0,
    initiative:   opts.initiative ?? 10,
});

describe("_buildPositionDiagram", () => {
    it("returns null when there are no participants", () => {
        expect(_buildPositionDiagram([], [], [], 7, null)).toBeNull();
    });

    it("sorts nodes by position ascending (pursuers left → quarry right)", () => {
        const quarry   = [mkP("q1", { position: 5 })];
        const pursuers = [mkP("p1", { position: 1 }), mkP("p2", { position: 3 })];
        const diagram  = _buildPositionDiagram(quarry, pursuers, [], 7, null);

        const names = diagram.nodes.map(n => n.tokenUuid);
        expect(names).toEqual(["p1", "p2", "q1"]);
    });

    it("assigns role 'quarry' / 'pursuer' correctly", () => {
        const quarry   = [mkP("q1", { position: 5 })];
        const pursuers = [mkP("p1", { position: 0 })];
        const diagram  = _buildPositionDiagram(quarry, pursuers, [], 7, null);

        const byUuid = Object.fromEntries(diagram.nodes.map(n => [n.tokenUuid, n.role]));
        expect(byUuid.q1).toBe("quarry");
        expect(byUuid.p1).toBe("pursuer");
    });

    it("derives gap labels from consecutive node positions", () => {
        const quarry   = [mkP("q1", { position: 6 })];
        const pursuers = [mkP("p1", { position: 1 }), mkP("p2", { position: 3 })];
        const diagram  = _buildPositionDiagram(quarry, pursuers, [], 7, null);

        // Order: p1(1), p2(3), q1(6). Gaps: 2, 3.
        expect(diagram.gapLabels.map(g => g.value)).toEqual([2, 3]);
    });

    it("escapeRemaining = escapeDistance - current gap, clamped at 0", () => {
        const quarry   = [mkP("q1", { position: 5 })];
        const pursuers = [mkP("p1", { position: 1 })];
        const diagram  = _buildPositionDiagram(quarry, pursuers, [], 7, null);
        // gap = 5 - 1 = 4; escapeRemaining = 7 - 4 = 3
        expect(diagram.escapeRemaining).toBe(3);
    });

    it("escapeRemaining is 0 when gap meets or exceeds escapeDistance (escape already achieved)", () => {
        const quarry   = [mkP("q1", { position: 8 })];
        const pursuers = [mkP("p1", { position: 1 })];
        const diagram  = _buildPositionDiagram(quarry, pursuers, [], 7, null);
        expect(diagram.escapeRemaining).toBe(0);
        expect(diagram.escapeMarker).toBeNull();
    });

    it("includes the escape marker with value and pixel width when escapeRemaining > 0", () => {
        const quarry   = [mkP("q1", { position: 4 })];
        const pursuers = [mkP("p1", { position: 0 })];
        const diagram  = _buildPositionDiagram(quarry, pursuers, [], 7, null);
        // gap=4, escapeRemaining=3
        expect(diagram.escapeMarker).toBeTruthy();
        expect(diagram.escapeMarker.value).toBe(3);
        expect(diagram.escapeMarker.width).toBeGreaterThan(0);
    });

    it("escape marker width scales with escapeRemaining", () => {
        const narrow = _buildPositionDiagram([mkP("q1", { position: 6 })], [mkP("p1", { position: 0 })], [], 7, null);
        const wide   = _buildPositionDiagram([mkP("q1", { position: 3 })], [mkP("p1", { position: 0 })], [], 7, null);
        // narrow: gap=6, escapeRemaining=1 → smaller width
        // wide:   gap=3, escapeRemaining=4 → larger width
        expect(wide.escapeMarker.width).toBeGreaterThan(narrow.escapeMarker.width);
    });

    it("flags the active-turn participant", () => {
        const quarry   = [mkP("q1", { position: 5 })];
        const pursuers = [mkP("p1", { position: 0 })];
        const diagram  = _buildPositionDiagram(quarry, pursuers, [], 7, "q1");

        const q1Node = diagram.nodes.find(n => n.tokenUuid === "q1");
        const p1Node = diagram.nodes.find(n => n.tokenUuid === "p1");
        expect(q1Node.isActive).toBe(true);
        expect(p1Node.isActive).toBe(false);
    });

    it("flags caughtPending participants", () => {
        const quarry   = [mkP("q1", { position: 5 }), mkP("q2", { position: 5 })];
        const pursuers = [mkP("p1", { position: 5 })];
        const caughtPending = [{ tokenUuid: "q1" }];
        const diagram  = _buildPositionDiagram(quarry, pursuers, caughtPending, 7, null);

        const q1Node = diagram.nodes.find(n => n.tokenUuid === "q1");
        const q2Node = diagram.nodes.find(n => n.tokenUuid === "q2");
        expect(q1Node.isCaughtPending).toBe(true);
        expect(q2Node.isCaughtPending).toBe(false);
    });

    it("ties on position keep both participants but their order is stable", () => {
        // Two nodes at the same position should both appear; gap label is 0.
        const quarry   = [mkP("q1", { position: 5 })];
        const pursuers = [mkP("p1", { position: 5 })];
        const diagram  = _buildPositionDiagram(quarry, pursuers, [], 7, null);
        expect(diagram.nodes).toHaveLength(2);
        expect(diagram.gapLabels).toEqual([
            expect.objectContaining({ value: 0 }),
        ]);
    });
});
