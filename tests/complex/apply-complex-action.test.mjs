import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyComplexAction } from "../../src/chat/pursuit-round-complex.mjs";
import { updateMessage } from "../../src/chat/pursuit-shared.mjs";

vi.mock("../../src/chat/pursuit-shared.mjs", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        updateMessage: vi.fn().mockResolvedValue(undefined),
    };
});

const mkP = (tokenUuid, opts = {}) => ({
    tokenUuid,
    name:       tokenUuid,
    initiative: opts.initiative ?? 10,
    position:   opts.position  ?? 0,
    move:       opts.move      ?? 5,
    actorUuid:  opts.actorUuid ?? null,
    skill:      "Athletics",
    moveRating: null,
    actionsTaken:         opts.actionsTaken ?? 0,
    lastSl:               opts.lastSl ?? null,
    lastActionType:       opts.lastActionType ?? null,
    lastActionMessageIds: opts.lastActionMessageIds ?? [],
    pronedThisAction:     opts.pronedThisAction ?? false,
    joinOrder:            opts.joinOrder ?? 0,
});

const baseData = (overrides = {}) => ({
    pursuitType:    "complex",
    state:          "active",
    distance:       5,
    escapeDistance: 10,
    caughtPending:  [],
    ignoredPairs:   [],
    roundLog:       [],
    quarry:         [],
    pursuers:       [],
    ...overrides,
});

const captureUpdatePayload = () => {
    const [, payload] = updateMessage.mock.calls[updateMessage.mock.calls.length - 1];
    return payload;
};

describe("applyComplexAction — fresh actions", () => {
    let message;

    beforeEach(() => {
        message = { id: "msg-001", update: vi.fn().mockResolvedValue(undefined) };
        game.messages.get.mockImplementation(() => ({ id: "stub-msg", delete: vi.fn(), flags: {} }));
    });

    it("warns and does not update when it is not the token's turn", async () => {
        const data = baseData({
            quarry:   [mkP("q1", { initiative: 20, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 5,  joinOrder: 2 })],
        });
        await applyComplexAction(message, data, "p1", { sl: 3, messageId: "roll-001" });
        expect(ui.notifications.warn).toHaveBeenCalledOnce();
        expect(updateMessage).not.toHaveBeenCalled();
    });

    it("records the sl, advances the participant, and increments actionsTaken on a fresh roll", async () => {
        // q1(init=20, pos=5, move=5) is active; SL=2 → dist=2 → newPos=7
        const data = baseData({
            quarry:   [mkP("q1", { initiative: 20, position: 5, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 5,  position: 0, joinOrder: 2 })],
        });
        await applyComplexAction(message, data, "q1", { sl: 2, messageId: "roll-001" });
        const payload = captureUpdatePayload();

        const updatedQuarry = payload["flags.wfrp4e-pursuits.quarry"];
        const q1            = updatedQuarry.find(q => q.tokenUuid === "q1");
        expect(q1.position).toBe(7);
        expect(q1.actionsTaken).toBe(1);
        expect(q1.lastSl).toBe(2);
        expect(q1.lastActionType).toBe("roll");
        expect(q1.lastActionMessageIds).toEqual(["roll-001"]);

        expect(payload["flags.wfrp4e-pursuits.caughtPending"]).toEqual([]);
    });

    it("posts a plain notification when a pursuer catches the only quarry mid-action", async () => {
        // p1(init=20, pos=3, move=5) catches q1(pos=5); SL=4 → dist=2 → newPos=5 ≥ q1.pos
        // Single quarry → needsDialog=false → plain narration
        const data = baseData({
            quarry:   [mkP("q1", { initiative: 5,  position: 5, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 20, position: 3, joinOrder: 2 })],
        });
        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "roll-001" });

        const calls = ChatMessage.create.mock.calls;
        const catchDialogPosts = calls.filter(c => c[0]?.flags?.["wfrp4e-pursuits"]?.type === "catch");
        expect(catchDialogPosts).toHaveLength(0);

        const payload = captureUpdatePayload();
        expect(payload["flags.wfrp4e-pursuits.caughtPending"]).toEqual([]);
        expect(payload["flags.wfrp4e-pursuits.state"]).toBe("complete");
    });

    it("opens a catch dialog when a pursuer catches one quarry while another remains active", async () => {
        // p1(init=20, pos=3) catches q1(pos=5) but not q2(pos=8)
        // otherActiveQuarry=[q2] → needsDialog=true → catch dialog with type="catch"
        ChatMessage.create.mockReset();
        ChatMessage.create.mockResolvedValue({ id: "catch-msg-id" });
        const data = baseData({
            quarry:   [
                mkP("q1", { initiative: 10, position: 5, joinOrder: 1 }),
                mkP("q2", { initiative: 5,  position: 8, joinOrder: 2 }),
            ],
            pursuers: [mkP("p1", { initiative: 20, position: 3, joinOrder: 3 })],
        });
        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "roll-001" });

        const catchDialogArg = ChatMessage.create.mock.calls
            .map(c => c[0])
            .find(arg => arg?.flags?.["wfrp4e-pursuits"]?.type === "catch");
        expect(catchDialogArg).toBeTruthy();
        expect(catchDialogArg.flags["wfrp4e-pursuits"].quarryTokenUuid).toBe("q1");
        expect(catchDialogArg.flags["wfrp4e-pursuits"].pursuerTokenUuid).toBe("p1");

        const payload = captureUpdatePayload();
        const pending = payload["flags.wfrp4e-pursuits.caughtPending"];
        expect(pending).toHaveLength(1);
        expect(pending[0]).toMatchObject({
            tokenUuid:        "q1",
            pursuerTokenUuid: "p1",
            catchMessageId:   "catch-msg-id",
        });
    });

    it("does not advance a participant whose action would not cross any quarry", async () => {
        // p1(pos=0) moves to pos=1; quarry q1 at pos=10. No catch.
        const data = baseData({
            quarry:   [mkP("q1", { initiative: 5,  position: 10, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 20, position: 0,  joinOrder: 2 })],
        });
        await applyComplexAction(message, data, "p1", { sl: 2, messageId: "roll-001" });
        const payload = captureUpdatePayload();
        expect(payload["flags.wfrp4e-pursuits.caughtPending"]).toEqual([]);
        expect(payload["flags.wfrp4e-pursuits.state"]).toBeUndefined();
    });
});

describe("applyComplexAction — finalize previous pending actor (lockout)", () => {
    let message;

    beforeEach(() => {
        message = { id: "msg-001", update: vi.fn().mockResolvedValue(undefined) };
        ChatMessage.create.mockReset();
    });

    it("clears the previous pending actor's chat messages and state when next person rolls", async () => {
        const data = baseData({
            quarry:   [mkP("q1", {
                initiative: 20, position: 7, actionsTaken: 1, joinOrder: 1,
                lastSl: 2, lastActionType: "roll", lastActionMessageIds: ["q1-roll"],
            })],
            pursuers: [mkP("p1", { initiative: 5, position: 0, joinOrder: 2 })],
        });
        const deleted = [];
        game.messages.get.mockImplementation(id => ({ id, delete: vi.fn(() => deleted.push(id)), flags: {} }));

        await applyComplexAction(message, data, "p1", { sl: 1, messageId: "p1-roll" });

        expect(deleted).toContain("q1-roll");

        const payload = captureUpdatePayload();
        const q1 = payload["flags.wfrp4e-pursuits.quarry"].find(q => q.tokenUuid === "q1");
        expect(q1.lastSl).toBeNull();
        expect(q1.lastActionType).toBeNull();
        expect(q1.lastActionMessageIds).toEqual([]);
        expect(q1.actionsTaken).toBe(1); // not reset

        const p1 = payload["flags.wfrp4e-pursuits.pursuers"].find(p => p.tokenUuid === "p1");
        expect(p1.lastActionMessageIds).toEqual(["p1-roll"]);
        expect(p1.actionsTaken).toBe(1);
    });

    it("does not finalize previous actor on a reroll (rerolls don't lock anyone out)", async () => {
        // q1 is the current pending actor; q1 rerolls. q1's own state should update.
        const data = baseData({
            quarry:   [mkP("q1", {
                initiative: 20, position: 7, actionsTaken: 1, joinOrder: 1,
                lastSl: 2, lastActionType: "roll", lastActionMessageIds: ["q1-roll-1"],
            })],
            pursuers: [mkP("p1", { initiative: 5, position: 0, joinOrder: 2 })],
        });
        game.messages.get.mockImplementation(() => ({ id: "stub-msg", delete: vi.fn(), flags: {} }));

        await applyComplexAction(message, data, "q1", {
            sl: 4, messageId: "q1-reroll-1", isReroll: true,
        });

        const payload = captureUpdatePayload();
        const q1 = payload["flags.wfrp4e-pursuits.quarry"].find(q => q.tokenUuid === "q1");
        // SL went 2 → 4: dist 2→3, delta +1; position 7+1=8
        expect(q1.position).toBe(8);
        expect(q1.lastSl).toBe(4);
        expect(q1.lastActionMessageIds).toEqual(["q1-roll-1", "q1-reroll-1"]);
        expect(q1.actionsTaken).toBe(1); // not incremented on reroll
    });
});

describe("applyComplexAction — skips", () => {
    let message;

    beforeEach(() => {
        message = { id: "msg-001", update: vi.fn().mockResolvedValue(undefined) };
        ChatMessage.create.mockReset();
        game.messages.get.mockImplementation(() => ({ id: "stub-msg", delete: vi.fn(), flags: {} }));
    });

    it("a skip increments actionsTaken and marks lastActionType=skip with no message id", async () => {
        const data = baseData({
            quarry:   [mkP("q1", { initiative: 20, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 5,  joinOrder: 2 })],
        });
        await applyComplexAction(message, data, "q1", { isSkip: true, messageId: null });

        const payload = captureUpdatePayload();
        const q1 = payload["flags.wfrp4e-pursuits.quarry"].find(q => q.tokenUuid === "q1");
        expect(q1.actionsTaken).toBe(1);
        expect(q1.lastActionType).toBe("skip");
        expect(q1.lastSl).toBe(-3);
        expect(q1.lastActionMessageIds).toEqual([]);
    });
});

describe("applyComplexAction — prone toggle on reroll", () => {
    let message;
    let actorStub;

    beforeEach(() => {
        message = { id: "msg-001", update: vi.fn().mockResolvedValue(undefined) };
        actorStub = {
            addCondition:    vi.fn().mockResolvedValue(undefined),
            removeCondition: vi.fn().mockResolvedValue(undefined),
        };
        fromUuid.mockReset();
        fromUuid.mockImplementation(async () => actorStub);
        ChatMessage.create.mockReset();
        game.messages.get.mockImplementation(() => ({ id: "stub-msg", delete: vi.fn(), flags: {} }));
    });

    it("applies prone when fresh SL ≤ -5 and sets pronedThisAction", async () => {
        const data = baseData({
            quarry:   [mkP("q1", { initiative: 20, joinOrder: 1, actorUuid: "Actor.q1" })],
            pursuers: [mkP("p1", { initiative: 5,  joinOrder: 2 })],
        });
        await applyComplexAction(message, data, "q1", { sl: -5, messageId: "r1" });

        expect(actorStub.addCondition).toHaveBeenCalledWith("prone");

        const payload = captureUpdatePayload();
        const q1 = payload["flags.wfrp4e-pursuits.quarry"].find(q => q.tokenUuid === "q1");
        expect(q1.pronedThisAction).toBe(true);
    });

    it("removes prone on reroll back above -5 threshold", async () => {
        const data = baseData({
            quarry:   [mkP("q1", {
                initiative: 20, joinOrder: 1, actorUuid: "Actor.q1",
                actionsTaken: 1, lastSl: -5, lastActionType: "roll",
                lastActionMessageIds: ["r1"], pronedThisAction: true,
            })],
            pursuers: [mkP("p1", { initiative: 5, joinOrder: 2 })],
        });
        await applyComplexAction(message, data, "q1", {
            sl: 2, messageId: "r2", isReroll: true,
        });

        expect(actorStub.removeCondition).toHaveBeenCalledWith("prone");

        const payload = captureUpdatePayload();
        const q1 = payload["flags.wfrp4e-pursuits.quarry"].find(q => q.tokenUuid === "q1");
        expect(q1.pronedThisAction).toBe(false);
    });

    it("re-applies prone on a reroll back into ≤ -5 if it was cleared mid-action", async () => {
        // Started at SL -5, rerolled to +2 (prone removed), now rerolling back to -6.
        // Give q1 a high starting position so the negative-delta reroll doesn't
        // drop them below all pursuers (which would left-behind them).
        const data = baseData({
            quarry:   [mkP("q1", {
                initiative: 20, joinOrder: 1, actorUuid: "Actor.q1", position: 10,
                actionsTaken: 1, lastSl: 2, lastActionType: "roll",
                lastActionMessageIds: ["r1", "r2"], pronedThisAction: false,
            })],
            pursuers: [mkP("p1", { initiative: 5, joinOrder: 2, position: 0 })],
        });
        await applyComplexAction(message, data, "q1", {
            sl: -6, messageId: "r3", isReroll: true,
        });

        expect(actorStub.addCondition).toHaveBeenCalledWith("prone");

        const payload = captureUpdatePayload();
        const q1 = payload["flags.wfrp4e-pursuits.quarry"].find(q => q.tokenUuid === "q1");
        expect(q1.pronedThisAction).toBe(true);
    });
});

describe("applyComplexAction — outcome banners (no double-banner regression)", () => {
    let message;

    beforeEach(() => {
        message = { id: "msg-001", update: vi.fn().mockResolvedValue(undefined) };
        ChatMessage.create.mockReset();
        game.messages.get.mockImplementation(() => ({ id: "stub-msg", delete: vi.fn(), flags: {} }));
    });

    it("full escape passes caught=false to render even though distance is 0", async () => {
        // The only quarry escapes → updatedQuarry becomes empty → newDistance=0.
        // Render must NOT fall back to (distance<=0)=>caught: when escape removes
        // the last quarry, distance=0 is a side effect, not a catch.
        //
        // Capture render args by hooking renderTemplate (called inside renderComplexRoundContent).
        const renderCalls = [];
        foundry.applications.handlebars.renderTemplate.mockImplementation(async (_path, data) => {
            renderCalls.push(data);
            return "<rendered>";
        });

        // q1 at pos=5 (startDistance), p1 at pos=0. escapeDistance=5 (so SL+4 makes the gap 7>=5).
        const data = baseData({
            escapeDistance: 5,
            quarry:   [mkP("q1", {
                initiative: 5, position: 5, joinOrder: 1,
                actionsTaken: 0,
            })],
            pursuers: [mkP("p1", {
                initiative: 20, position: 0, joinOrder: 2,
                actionsTaken: 1, lastSl: 0, lastActionType: "roll",
                lastActionMessageIds: ["p1-roll"],
            })],
        });

        await applyComplexAction(message, data, "q1", { sl: 4, messageId: "q1-roll" });

        // updateMessage was called with state=complete.
        const payload = captureUpdatePayload();
        expect(payload["flags.wfrp4e-pursuits.state"]).toBe("complete");

        // postEscapeMessage was called for q1.
        const escapeNarrations = ChatMessage.create.mock.calls
            .map(c => c[0])
            .filter(arg => typeof arg?.content === "string" && arg.content.includes("DisappearsInDistance"));
        expect(escapeNarrations.length).toBeGreaterThanOrEqual(1);

        // Render received caught:false explicitly (not null/undefined).
        // We assert the LAST render call (the post-action one).
        const lastRender = renderCalls[renderCalls.length - 1];
        expect(lastRender.caught).toBe(false);
        expect(lastRender.escaped).toBe(true);
    });

    it("multi-catch with open dialogs passes caught=false (banner deferred until dialog resolves)", async () => {
        // 2 quarry both at pos=2, single pursuer rolls SL=4 → catches both.
        // newlyCaught.length=2 → needsDialog=true → both go to caughtPending.
        // Distance = 0 (all quarry pending), but we should NOT show the caught
        // banner — the pursuit isn't complete and the dialog is the right UI.
        const renderCalls = [];
        foundry.applications.handlebars.renderTemplate.mockImplementation(async (_path, data) => {
            renderCalls.push(data);
            return "<rendered>";
        });
        ChatMessage.create.mockResolvedValue({ id: "catch-msg-id" });

        const data = baseData({
            quarry: [
                mkP("q1", { initiative: 10, position: 2, joinOrder: 1 }),
                mkP("q2", { initiative: 5,  position: 2, joinOrder: 2 }),
            ],
            pursuers: [mkP("p1", { initiative: 20, position: 0, joinOrder: 3 })],
        });

        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "p1-roll" });

        const payload = captureUpdatePayload();
        expect(payload["flags.wfrp4e-pursuits.state"]).toBeUndefined(); // not complete
        expect(payload["flags.wfrp4e-pursuits.caughtPending"]).toHaveLength(2);

        const lastRender = renderCalls[renderCalls.length - 1];
        expect(lastRender.caught).toBe(false);
        expect(lastRender.escaped).toBe(false);
    });
});

describe("applyComplexAction — perception message cleanup", () => {
    let message;

    beforeEach(() => {
        message = { id: "msg-001", update: vi.fn().mockResolvedValue(undefined) };
        ChatMessage.create.mockReset();
    });

    it("deletes perception test messages when the participant makes their movement roll", async () => {
        const deleted = [];
        game.messages.get.mockImplementation(id => ({ id, delete: vi.fn(() => deleted.push(id)), flags: {} }));

        const data = baseData({
            quarry:   [mkP("q1", { initiative: 20, position: 3, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 5,  position: 0, joinOrder: 2 })],
            obstacles: [{
                id:               "obs-1",
                position:         10,
                perceivedBy:      [],
                navigatedBy:      [],
                perceptionTests:  [{ tokenUuid: "q1", messageIds: ["perc-msg-1"], perceived: false }],
                blocksProgress:   false,
            }],
        });

        await applyComplexAction(message, data, "q1", { sl: 2, messageId: "roll-001" });

        expect(deleted).toContain("perc-msg-1");
    });

    it("does not delete perception messages on a reroll", async () => {
        const deleted = [];
        game.messages.get.mockImplementation(id => ({ id, delete: vi.fn(() => deleted.push(id)), flags: {} }));

        const data = baseData({
            quarry:   [mkP("q1", {
                initiative: 20, position: 3, joinOrder: 1,
                actionsTaken: 1, lastSl: 0, lastActionType: "roll",
                lastActionMessageIds: ["roll-001"],
            })],
            pursuers: [mkP("p1", { initiative: 5, position: 0, joinOrder: 2 })],
            obstacles: [{
                id:               "obs-1",
                position:         10,
                perceivedBy:      [],
                navigatedBy:      [],
                perceptionTests:  [{ tokenUuid: "q1", messageIds: ["perc-msg-1"], perceived: false }],
                blocksProgress:   false,
            }],
        });

        await applyComplexAction(message, data, "q1", { sl: 2, messageId: "reroll-001", isReroll: true });

        expect(deleted).not.toContain("perc-msg-1");
    });

    it("deletes multiple perception messages across multiple obstacles", async () => {
        const deleted = [];
        game.messages.get.mockImplementation(id => ({ id, delete: vi.fn(() => deleted.push(id)), flags: {} }));

        const data = baseData({
            quarry:   [mkP("q1", { initiative: 20, position: 3, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 5,  position: 0, joinOrder: 2 })],
            obstacles: [
                {
                    id: "obs-1", position: 10,
                    perceivedBy: [], navigatedBy: [],
                    perceptionTests: [{ tokenUuid: "q1", messageIds: ["perc-msg-1", "perc-msg-2"], perceived: false }],
                    blocksProgress: false,
                },
                {
                    id: "obs-2", position: 15,
                    perceivedBy: [], navigatedBy: [],
                    perceptionTests: [{ tokenUuid: "q1", messageIds: ["perc-msg-3"], perceived: true }],
                    blocksProgress: false,
                },
            ],
        });

        await applyComplexAction(message, data, "q1", { sl: 2, messageId: "roll-001" });

        expect(deleted).toContain("perc-msg-1");
        expect(deleted).toContain("perc-msg-2");
        expect(deleted).toContain("perc-msg-3");
    });

    it("does not delete other participants' perception messages", async () => {
        const deleted = [];
        game.messages.get.mockImplementation(id => ({ id, delete: vi.fn(() => deleted.push(id)), flags: {} }));

        const data = baseData({
            quarry:   [mkP("q1", { initiative: 20, position: 3, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 5,  position: 0, joinOrder: 2 })],
            obstacles: [{
                id: "obs-1", position: 10,
                perceivedBy: [], navigatedBy: [],
                perceptionTests: [
                    { tokenUuid: "q1", messageIds: ["q1-perc-msg"], perceived: false },
                    { tokenUuid: "p1", messageIds: ["p1-perc-msg"], perceived: false },
                ],
                blocksProgress: false,
            }],
        });

        await applyComplexAction(message, data, "q1", { sl: 2, messageId: "roll-001" });

        expect(deleted).toContain("q1-perc-msg");
        expect(deleted).not.toContain("p1-perc-msg");
    });
});

describe("applyComplexAction — caught-pending rollback on reroll", () => {
    let message;

    beforeEach(() => {
        message = { id: "msg-001", update: vi.fn().mockResolvedValue(undefined) };
        ChatMessage.create.mockReset();
    });

    it("releases a caught quarry when the pinned pursuer rerolls behind them", async () => {
        // p1 caught q1 at pos=5; q2 still active so a catch dialog was posted.
        // Now p1 rerolls down: their new position is 4, behind q1 (at 5). Catch should roll back.
        const deleted = [];
        game.messages.get.mockImplementation(id => ({ id, delete: vi.fn(() => deleted.push(id)), flags: {} }));

        const data = baseData({
            quarry: [
                mkP("q1", { initiative: 10, position: 5, joinOrder: 1 }),
                mkP("q2", { initiative: 5,  position: 8, joinOrder: 2 }),
            ],
            pursuers: [mkP("p1", {
                initiative: 20, position: 5, joinOrder: 3,
                actionsTaken: 1, lastSl: 4, lastActionType: "roll",
                lastActionMessageIds: ["p1-roll-1"],
            })],
            caughtPending: [{
                tokenUuid: "q1", name: "q1", position: 5,
                pursuerTokenUuid: "p1", pursuerName: "p1",
                catchMessageId: "catch-msg-1",
            }],
        });

        await applyComplexAction(message, data, "p1", {
            sl: 0, messageId: "p1-reroll-1", isReroll: true,
        });

        // SL 0 = base (1); prev dist for SL 4 = base+1 (2); delta = -1; pos 5→4
        expect(deleted).toContain("catch-msg-1");

        const payload = captureUpdatePayload();
        expect(payload["flags.wfrp4e-pursuits.caughtPending"]).toEqual([]);
        const p1 = payload["flags.wfrp4e-pursuits.pursuers"].find(p => p.tokenUuid === "p1");
        expect(p1.position).toBe(4);
    });
});
