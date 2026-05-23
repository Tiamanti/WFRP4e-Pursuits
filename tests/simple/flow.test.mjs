import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveSimpleRound } from "../../src/chat/pursuit-round-simple.mjs";

// ─── Builders ────────────────────────────────────────────────────────────────

const mkParticipant = (tokenUuid, { name = tokenUuid, move = 4, skill = "Athletics" } = {}) => ({
    tokenUuid,
    name,
    move,
    skill,
    actorUuid:  null,
    moveRating: null,
});

function mkState({
    quarry         = [],
    pursuers       = [],
    distance       = 5,
    escapeDistance = 10,
    round          = 1,
    state          = "active",
    roundLog       = [],
} = {}) {
    return {
        pursuitType:          "simple",
        state,
        round,
        distance,
        escapeDistance,
        quarry,
        pursuers,
        roundLog,
        slResults:            [],
        skippedUuids:         [],
        simpleCatchupPending: false,
    };
}

function createMessage(data) {
    return {
        id:     "pursuit-msg",
        update: vi.fn().mockResolvedValue(undefined),
        flags:  { "wfrp4e-pursuits": data },
    };
}

function extractFlags(message) {
    const payload = message.update.mock.calls.at(-1)?.[0] ?? {};
    const flags = {};
    for (const [k, v] of Object.entries(payload)) {
        const m = k.match(/^flags\.wfrp4e-pursuits\.(.+)$/);
        if (m) flags[m[1]] = v;
    }
    return flags;
}

// ─── Scenario runner ─────────────────────────────────────────────────────────

/**
 * Runs one round of simple pursuit resolution.
 *
 * @param {object} state  Current pursuit state (flags schema)
 * @param {Array}  rolls  [{ tokenUuid, sl, messageIds?, note? }]
 *                        `note` is purely documentary — use it to describe rerolls.
 *
 * @returns {{ distance, round, state, catchupPending, createdMessages, nextState }}
 */
async function resolveRound(state, rolls) {
    const message   = createMessage(state);
    const slResults = rolls.map(({ tokenUuid, sl, messageIds = [] }) => ({
        tokenUuid, sl, messageIds,
    }));
    await resolveSimpleRound(message, { ...state, slResults });

    const flags     = extractFlags(message);
    const nextState = {
        ...state,
        distance:             flags.distance,
        round:                flags.round,
        roundLog:             flags.roundLog,
        slResults:            [],
        skippedUuids:         [],
        simpleCatchupPending: flags.simpleCatchupPending ?? false,
        ...(flags.state ? { state: flags.state } : {}),
    };

    return {
        distance:        flags.distance,
        round:           flags.round,
        state:           flags.state ?? state.state,
        catchupPending:  !!flags.simpleCatchupPending,
        createdMessages: ChatMessage.create.mock.calls.map(c => c[0]),
        nextState,
    };
}

/**
 * Applies the "Sacrifice <member>" catch-dialog choice.
 * The identified quarry member is removed; distance comes from the candidate
 * entry the catchup card published (recomputed without that member's roll).
 */
function applyAbandonQuarry(state, abandonedUuid, newDistance) {
    return {
        ...state,
        quarry:               state.quarry.filter(q => q.tokenUuid !== abandonedUuid),
        distance:             newDistance,
        simpleCatchupPending: false,
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("simple pursuit — full-scenario flow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        game.messages.get.mockImplementation(() => ({ id: "stub", delete: vi.fn(), flags: {} }));
    });

    // ── Escape ────────────────────────────────────────────────────────────────

    it("scenario: quarry escapes after 2 rounds with a steady lead", async () => {
        /*
         * Quarry:   Thief (move 4, Athletics)
         * Pursuer:  Guard (move 4, Athletics)
         * Start distance: 5 | Escape: 10
         *
         * Same move on both sides → no move bonus either way.
         */
        const state = mkState({
            quarry:   [mkParticipant("q1", { name: "Thief", move: 4 })],
            pursuers: [mkParticipant("p1", { name: "Guard", move: 4 })],
            distance: 5,
        });

        // Round 1 — Thief rolls well, Guard rolls poorly
        // effectiveSL: q1=3, p1=0  →  distance: 5 + (3 − 0) = 8
        const r1 = await resolveRound(state, [
            { tokenUuid: "q1", sl: 3 },
            { tokenUuid: "p1", sl: 0 },
        ]);
        expect(r1.distance).toBe(8);
        expect(r1.state).toBe("active");

        // Round 2 — Thief still ahead; Guard rolls negative
        // effectiveSL: q1=2, p1=−1  →  distance: 8 + (2 − (−1)) = 11  →  clamped to 10 → escaped
        const r2 = await resolveRound(r1.nextState, [
            { tokenUuid: "q1", sl: 2 },
            { tokenUuid: "p1", sl: -1 },
        ]);
        expect(r2.distance).toBe(10);
        expect(r2.state).toBe("complete");
    });

    // ── Catch ────────────────────────────────────────────────────────────────

    it("scenario: faster pursuer catches quarry in 2 rounds (move bonus applied)", async () => {
        /*
         * Quarry:   Thief  (move 3, Athletics)
         * Pursuer:  Knight (move 5, Athletics)  ← move bonus: 5 − 3 = +2
         * Start distance: 4
         *
         * The Knight's higher move adds +2 to every effective pursuer SL.
         */
        const state = mkState({
            quarry:   [mkParticipant("q1", { name: "Thief",  move: 3 })],
            pursuers: [mkParticipant("p1", { name: "Knight", move: 5 })],
            distance: 4,
        });

        // Round 1 — equal raw SL but Knight gets +2 from move bonus
        // effectiveSL: q1=1+0=1, p1=1+2=3  →  distance: 4 + (1 − 3) = 2
        const r1 = await resolveRound(state, [
            { tokenUuid: "q1", sl: 1 },
            { tokenUuid: "p1", sl: 1 },
        ]);
        expect(r1.distance).toBe(2);
        expect(r1.state).toBe("active");

        // Round 2 — Knight closes the gap
        // effectiveSL: q1=0, p1=1+2=3  →  distance: 2 + (0 − 3) = −1  →  clamped to 0 → caught
        const r2 = await resolveRound(r1.nextState, [
            { tokenUuid: "q1", sl: 0 },
            { tokenUuid: "p1", sl: 1 },
        ]);
        expect(r2.distance).toBe(0);
        expect(r2.state).toBe("complete");
    });

    // ── Reroll ────────────────────────────────────────────────────────────────

    it("scenario: rerolled SL replaces the original; both roll messages are scheduled for deletion", async () => {
        /*
         * Quarry rerolled from SL −3 to SL +1 (e.g. spent a Fate Point).
         * The pursuit card stores the final SL per token, so resolution sees +1.
         * Both the original and reroll chat messages are in messageIds → both deleted.
         */
        const state = mkState({
            quarry:   [mkParticipant("q1", { move: 4 })],
            pursuers: [mkParticipant("p1", { move: 4 })],
            distance: 5,
        });

        // effectiveSL: q1=1, p1=0  →  distance: 5 + (1 − 0) = 6  (not −3 from the original roll)
        const r1 = await resolveRound(state, [
            {
                tokenUuid:  "q1",
                sl:         1,
                messageIds: ["original-roll", "reroll-msg"],
                note:       "rerolled from SL=−3",
            },
            { tokenUuid: "p1", sl: 0 },
        ]);
        expect(r1.distance).toBe(6);
        expect(game.messages.get).toHaveBeenCalledWith("original-roll");
        expect(game.messages.get).toHaveBeenCalledWith("reroll-msg");
    });

    // ── Multiple participants ─────────────────────────────────────────────────

    it("scenario: 3-round pursuit with two pursuers — best pursuer SL wins each round", async () => {
        /*
         * Quarry:   Scout  (move 4)
         * Pursuers: Guard1 (move 4), Guard2 (move 4)
         * Start distance: 7
         *
         * Each round the fastest-rolling pursuer determines the group's advance.
         * One slow pursuer cannot drag down the group.
         */
        const state = mkState({
            quarry:   [mkParticipant("q1", { name: "Scout",  move: 4 })],
            pursuers: [
                mkParticipant("p1", { name: "Guard1", move: 4 }),
                mkParticipant("p2", { name: "Guard2", move: 4 }),
            ],
            distance: 7,
        });

        // Round 1 — Guard2 rolls great; Guard1 rolls poorly (Guard2's result is used)
        // quarryBest=1; pursuerBest=max(−1,3)=3  →  distance: 7 + (1 − 3) = 5
        const r1 = await resolveRound(state, [
            { tokenUuid: "q1", sl:  1 },
            { tokenUuid: "p1", sl: -1 },
            { tokenUuid: "p2", sl:  3 },
        ]);
        expect(r1.distance).toBe(5);
        expect(r1.state).toBe("active");

        // Round 2 — both guards close in
        // quarryBest=0; pursuerBest=max(2,1)=2  →  distance: 5 + (0 − 2) = 3
        const r2 = await resolveRound(r1.nextState, [
            { tokenUuid: "q1", sl: 0 },
            { tokenUuid: "p1", sl: 2 },
            { tokenUuid: "p2", sl: 1 },
        ]);
        expect(r2.distance).toBe(3);

        // Round 3 — Scout rerolled a very bad result, Guard2 presses hard
        // quarryBest=−1; pursuerBest=max(0,2)=2  →  distance: 3 + (−1 − 2) = 0 → caught
        const r3 = await resolveRound(r2.nextState, [
            { tokenUuid: "q1", sl: -1, note: "rerolled from SL=−4" },
            { tokenUuid: "p1", sl:  0 },
            { tokenUuid: "p2", sl:  2 },
        ]);
        expect(r3.distance).toBe(0);
        expect(r3.state).toBe("complete");
    });

    // ── Multi-quarry catch dialog ─────────────────────────────────────────────

    it("scenario: two quarry — sacrifice slowest, fastest escapes", async () => {
        /*
         * Quarry:   Thief (q1, move 4), Scout (q2, move 4)
         * Pursuer:  Guard (p1, move 4)
         * Start distance: 3 | Escape: 10
         *
         * Round 1 drops distance to 0 with both quarry still active → catchup
         * card listing every quarry member with the distance that would result
         * if THAT member is sacrificed. GM picks q1 (recomputed distance: 2).
         */
        const state = mkState({
            quarry: [
                mkParticipant("q1", { name: "Thief", move: 4 }),
                mkParticipant("q2", { name: "Scout", move: 4 }),
            ],
            pursuers: [mkParticipant("p1", { name: "Guard", move: 4 })],
            distance: 3,
        });

        // Round 1 — Thief rolls badly; Scout and Guard cancel out
        // effectiveQuarrySLs: q1=−3, q2=1; quarryBest=min(−3,1)=−3
        // effectivePursuerSLs: p1=2;         pursuerBest=2
        // distance: clamp(3 + (−3 − 2), 0, 10) = 0  →  multi-quarry catch (quarry.length=2)
        const r1 = await resolveRound(state, [
            { tokenUuid: "q1", sl: -3 },
            { tokenUuid: "q2", sl:  1 },
            { tokenUuid: "p1", sl:  2 },
        ]);
        expect(r1.distance).toBe(0);
        expect(r1.catchupPending).toBe(true);
        expect(r1.state).toBe("active"); // not complete — dialog still pending

        // Catchup card lists both members, each with the distance that would
        // result if that one is sacrificed:
        //   sacrifice q1 → remaining quarryBest=1, distance = clamp(3 + (1−2)) = 2
        //   sacrifice q2 → remaining quarryBest=−3, distance = clamp(3 + (−3−2)) = 0 → floor 1
        expect(r1.createdMessages).toHaveLength(1);
        const dialogMsg = r1.createdMessages[0];
        expect(dialogMsg.flags["wfrp4e-pursuits"].type).toBe("simpleCatchup");
        const candidates = dialogMsg.flags["wfrp4e-pursuits"].candidates;
        expect(candidates).toEqual([
            { tokenUuid: "q1", name: "Thief", newDistance: 2 },
            { tokenUuid: "q2", name: "Scout", newDistance: 1 },
        ]);

        // GM picks q1 → Thief is removed; Scout continues from distance 2
        const chosen = candidates.find(c => c.tokenUuid === "q1");
        const stateAfterDialog = applyAbandonQuarry(r1.nextState, "q1", chosen.newDistance);
        expect(stateAfterDialog.quarry.map(q => q.tokenUuid)).toEqual(["q2"]);
        expect(stateAfterDialog.distance).toBe(2);

        // Round 2 — Scout pulls ahead
        // distance: 2 + (3 − 0) = 5
        const r2 = await resolveRound(stateAfterDialog, [
            { tokenUuid: "q2", sl: 3 },
            { tokenUuid: "p1", sl: 0 },
        ]);
        expect(r2.distance).toBe(5);
        expect(r2.state).toBe("active");

        // Round 3 — Guard stumbles
        // distance: 5 + (3 − (−1)) = 9
        const r3 = await resolveRound(r2.nextState, [
            { tokenUuid: "q2", sl:  3 },
            { tokenUuid: "p1", sl: -1 },
        ]);
        expect(r3.distance).toBe(9);

        // Round 4 — Scout reaches escape distance
        // distance: 9 + (2 − 0) = 11 → clamped to 10 → escaped
        const r4 = await resolveRound(r3.nextState, [
            { tokenUuid: "q2", sl: 2 },
            { tokenUuid: "p1", sl: 0 },
        ]);
        expect(r4.distance).toBe(10);
        expect(r4.state).toBe("complete");
    });
});
