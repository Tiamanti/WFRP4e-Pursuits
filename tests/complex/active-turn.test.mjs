import { describe, it, expect } from "vitest";
import { _isActiveComplexTurn } from "../../src/chat/pursuit-round-complex.mjs";

const mkP = (tokenUuid, opts = {}) => ({
    name: tokenUuid, tokenUuid, actorUuid: null, move: 4,
    skill: "Athletics", moveRating: null,
    initiative: opts.initiative ?? 10,
    position:   opts.position   ?? 0,
    actionsTaken: opts.actionsTaken ?? 0,
    lastSl:       opts.lastSl       ?? null,
    lastActionType: opts.lastActionType ?? null,
    lastActionMessageIds: opts.lastActionMessageIds ?? [],
    pronedThisAction:     opts.pronedThisAction ?? false,
    joinOrder:    opts.joinOrder    ?? 0,
});

describe("_isActiveComplexTurn (continuous-turn order)", () => {
    it("first to act is the participant with highest initiative", () => {
        const data = {
            quarry:   [mkP("q1", { initiative: 20, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 5,  joinOrder: 2 })],
            caughtPending: [],
        };
        expect(_isActiveComplexTurn(data, "q1")).toBe(true);
        expect(_isActiveComplexTurn(data, "p1")).toBe(false);
    });

    it("after q1 acts (actionsTaken=1), p1 (still at 0) becomes active", () => {
        const data = {
            quarry:   [mkP("q1", { initiative: 20, actionsTaken: 1, lastActionType: "roll" })],
            pursuers: [mkP("p1", { initiative: 5,  actionsTaken: 0 })],
            caughtPending: [],
        };
        expect(_isActiveComplexTurn(data, "q1")).toBe(false);
        expect(_isActiveComplexTurn(data, "p1")).toBe(true);
    });

    it("skipped participant (lastActionType=skip) is treated as having acted", () => {
        const data = {
            quarry:   [mkP("q1", { initiative: 20, actionsTaken: 1, lastActionType: "skip" })],
            pursuers: [mkP("p1", { initiative: 5,  actionsTaken: 0 })],
            caughtPending: [],
        };
        expect(_isActiveComplexTurn(data, "q1")).toBe(false);
        expect(_isActiveComplexTurn(data, "p1")).toBe(true);
    });

    it("once everyone has the same actionsTaken, highest initiative is next (continuous wrap)", () => {
        const data = {
            quarry:   [mkP("q1", { initiative: 20, actionsTaken: 1, lastActionType: "roll" })],
            pursuers: [mkP("p1", { initiative: 5,  actionsTaken: 1, lastActionType: "roll" })],
            caughtPending: [],
        };
        // q1 acts at actionsTaken=1, p1 follows at 1, then q1 is back at top with the
        // lowest actionsTaken-tied (both at 1) but highest initiative.
        expect(_isActiveComplexTurn(data, "q1")).toBe(true);
        expect(_isActiveComplexTurn(data, "p1")).toBe(false);
    });

    it("orders by initiative descending across multiple participants", () => {
        // q2(30) > p2(25) > q1(20) > p1(5)
        const data = {
            quarry:   [mkP("q1", { initiative: 20, joinOrder: 1 }), mkP("q2", { initiative: 30, joinOrder: 3 })],
            pursuers: [mkP("p1", { initiative: 5,  joinOrder: 2 }), mkP("p2", { initiative: 25, joinOrder: 4 })],
            caughtPending: [],
        };
        expect(_isActiveComplexTurn(data, "q2")).toBe(true);
        expect(_isActiveComplexTurn(data, "p2")).toBe(false);
        expect(_isActiveComplexTurn(data, "q1")).toBe(false);
        expect(_isActiveComplexTurn(data, "p1")).toBe(false);
    });

    it("after q2 and p2 act, q1 is next", () => {
        const data = {
            quarry: [
                mkP("q1", { initiative: 20 }),
                mkP("q2", { initiative: 30, actionsTaken: 1, lastActionType: "roll" }),
            ],
            pursuers: [
                mkP("p1", { initiative: 5  }),
                mkP("p2", { initiative: 25, actionsTaken: 1, lastActionType: "roll" }),
            ],
            caughtPending: [],
        };
        expect(_isActiveComplexTurn(data, "q1")).toBe(true);
        expect(_isActiveComplexTurn(data, "p1")).toBe(false);
    });

    it("ties on initiative break by joinOrder ascending", () => {
        const data = {
            quarry:   [mkP("q1", { initiative: 10, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 10, joinOrder: 2 })],
            caughtPending: [],
        };
        expect(_isActiveComplexTurn(data, "q1")).toBe(true);
        expect(_isActiveComplexTurn(data, "p1")).toBe(false);
    });

    it("caughtPending quarry is excluded from turn order", () => {
        const data = {
            quarry:   [mkP("q1", { initiative: 30 }), mkP("q2", { initiative: 5 })],
            pursuers: [mkP("p1", { initiative: 10 })],
            caughtPending: [{ tokenUuid: "q1" }],
        };
        // q1 is in caughtPending → excluded. p1 (init 10) acts before q2 (init 5).
        expect(_isActiveComplexTurn(data, "q1")).toBe(false);
        expect(_isActiveComplexTurn(data, "p1")).toBe(true);
        expect(_isActiveComplexTurn(data, "q2")).toBe(false);
    });
});
