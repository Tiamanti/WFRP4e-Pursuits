import { describe, it, expect, vi, beforeEach } from "vitest";
import { OBSTACLE_TABLE } from "../../src/static/obstacles.mjs";
import { applyComplexAction } from "../../src/chat/pursuit-round-complex.mjs";
import { updateMessage } from "../../src/chat/pursuit-shared.mjs";

vi.mock("../../src/chat/pursuit-shared.mjs", async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, updateMessage: vi.fn().mockResolvedValue(undefined) };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers shared between consequence-function tests and dispatch tests
// ─────────────────────────────────────────────────────────────────────────────

function makeActor(tbBonus = 2) {
    return {
        addCondition:            vi.fn().mockResolvedValue(undefined),
        removeCondition:         vi.fn().mockResolvedValue(undefined),
        applyBasicDamage:        vi.fn().mockResolvedValue(undefined),
        createEmbeddedDocuments: vi.fn().mockResolvedValue(undefined),
        setupSkill:              vi.fn(),
        setupCharacteristic:     vi.fn(),
        system: {
            characteristics: { t: { bonus: tbBonus } },
        },
    };
}

function obstacleByName(name) {
    return OBSTACLE_TABLE.find(e => e.name === name);
}

// Minimal test helpers mirroring apply-complex-action.test.mjs
const mkP = (tokenUuid, opts = {}) => ({
    tokenUuid,
    name:                 tokenUuid,
    initiative:           opts.initiative ?? 10,
    position:             opts.position   ?? 0,
    move:                 opts.move       ?? 5,
    actorUuid:            opts.actorUuid  ?? null,
    skill:                "Athletics",
    moveRating:           null,
    actionsTaken:         opts.actionsTaken ?? 0,
    lastSl:               opts.lastSl       ?? null,
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
    const calls = updateMessage.mock.calls;
    const [, payload] = calls[calls.length - 1];
    return payload;
};

// ─────────────────────────────────────────────────────────────────────────────
// Consequence function unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("OBSTACLE_TABLE consequence functions", () => {
    let actor;

    beforeEach(() => {
        actor = makeActor();
        fromUuid.mockReset();
        fromUuid.mockImplementation(async () => actor);
        ChatMessage.create.mockReset();
        ChatMessage.create.mockResolvedValue(undefined);
    });

    describe("Large Log", () => {
        it("adds prone condition on failed Athletics", async () => {
            const entry = obstacleByName("Large Log");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(actor.addCondition).toHaveBeenCalledWith("prone");
        });
    });

    describe("Haystack", () => {
        it("adds entangled condition on failed Climb", async () => {
            const entry = obstacleByName("Haystack");
            await entry.consequences["Climb"]("Actor.test", -1, entry, "Hero");
            expect(actor.addCondition).toHaveBeenCalledWith("entangled");
        });

        it("returns participantFields.entangledThreshold equal to entry.entangleThreshold", async () => {
            const entry = obstacleByName("Haystack");
            const result = await entry.consequences["Climb"]("Actor.test", -1, entry, "Hero");
            expect(result?.participantFields?.entangledThreshold).toBe(entry.entangleThreshold);
        });
    });

    describe("Crates of Merchandise", () => {
        it("adds prone on failed Athletics", async () => {
            const entry = obstacleByName("Crates of Merchandise");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(actor.addCondition).toHaveBeenCalledWith("prone");
        });

        it("posts a notification naming the actor and mentioning broken merchandise", async () => {
            const entry = obstacleByName("Crates of Merchandise");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(ChatMessage.create).toHaveBeenCalledOnce();
            const { content } = ChatMessage.create.mock.calls[0][0];
            expect(content).toContain("Hero");
            expect(content).toContain("broken");
        });
    });

    describe("Closed Gate", () => {
        it("does not apply fall damage when navSl = -2 (not an impressive failure)", async () => {
            const entry = obstacleByName("Closed Gate");
            await entry.consequences["Climb"]("Actor.test", -2, entry, "Hero");
            expect(actor.applyBasicDamage).not.toHaveBeenCalled();
            expect(ChatMessage.create).not.toHaveBeenCalled();
        });

        it("does not apply fall damage when navSl = 0", async () => {
            const entry = obstacleByName("Closed Gate");
            await entry.consequences["Climb"]("Actor.test", 0, entry, "Hero");
            expect(actor.applyBasicDamage).not.toHaveBeenCalled();
        });

        it("applies a 2-yard fall when navSl = -3 (impressive failure boundary)", async () => {
            const entry = obstacleByName("Closed Gate");
            await entry.consequences["Climb"]("Actor.test", -3, entry, "Hero");
            expect(actor.applyBasicDamage).toHaveBeenCalledOnce();
            const { content } = ChatMessage.create.mock.calls[0][0];
            expect(content).toContain("falls 2 yard");
            expect(content).toContain("Hero");
        });

        it("applies a 2-yard fall when navSl = -5", async () => {
            const entry = obstacleByName("Closed Gate");
            await entry.consequences["Climb"]("Actor.test", -5, entry, "Hero");
            expect(actor.applyBasicDamage).toHaveBeenCalledOnce();
        });
    });

    describe("Pothole", () => {
        it("creates the Twisted Ankle critical injury on the actor", async () => {
            const critItemStub = { toObject: () => ({ type: "critical", name: "Twisted Ankle" }) };
            fromUuid.mockImplementation(async (uuid) =>
                uuid === "Compendium.wfrp4e-core.items.Item.9j0KwH1Je1RiuZX2" ? critItemStub : actor
            );
            const entry = obstacleByName("Pothole");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [critItemStub.toObject()]);
        });

        it("does not throw when crit item UUID resolves to null", async () => {
            fromUuid.mockImplementation(async (uuid) =>
                uuid === "Compendium.wfrp4e-core.items.Item.9j0KwH1Je1RiuZX2" ? null : actor
            );
            const entry = obstacleByName("Pothole");
            await expect(entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero")).resolves.toBeUndefined();
            expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
        });
    });

    describe("Passing Goat Herd", () => {
        it("applies 6 base damage with NORMAL damage type", async () => {
            const entry = obstacleByName("Passing Goat Herd");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(actor.applyBasicDamage).toHaveBeenCalledWith(6, {
                damageType: game.wfrp4e.config.DAMAGE_TYPE.NORMAL,
                minimumOne: true,
                suppressMsg: true,
            });
        });

        it("posts a goat notification naming the actor", async () => {
            const entry = obstacleByName("Passing Goat Herd");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(ChatMessage.create).toHaveBeenCalledOnce();
            const { content } = ChatMessage.create.mock.calls[0][0];
            expect(content).toContain("Hero");
        });
    });

    describe("Bucket Full of Fish Guts", () => {
        it("adds prone on failed Athletics", async () => {
            const entry = obstacleByName("Bucket Full of Fish Guts");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(actor.addCondition).toHaveBeenCalledWith("prone");
        });

        it("posts a slick notification", async () => {
            const entry = obstacleByName("Bucket Full of Fish Guts");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(ChatMessage.create).toHaveBeenCalledOnce();
        });
    });

    describe("Slick of Fish Guts", () => {
        it("adds prone on failed Athletics", async () => {
            const entry = obstacleByName("Slick of Fish Guts");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(actor.addCondition).toHaveBeenCalledWith("prone");
        });

        it("posts a Fellowship-penalty notification", async () => {
            const entry = obstacleByName("Slick of Fish Guts");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(ChatMessage.create).toHaveBeenCalledOnce();
        });
    });

    describe("Rotten Floorboards", () => {
        it("applies a 3-yard fall", async () => {
            const entry = obstacleByName("Rotten Floorboards");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(actor.applyBasicDamage).toHaveBeenCalledOnce();
            const { content } = ChatMessage.create.mock.calls[0][0];
            expect(content).toContain("falls 3 yard");
        });
    });

    describe("Workman on Ladder", () => {
        it("adds prone on failed Athletics", async () => {
            const entry = obstacleByName("Workman on Ladder");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(actor.addCondition).toHaveBeenCalledWith("prone");
        });

        it("posts a notification mentioning the labourer", async () => {
            const entry = obstacleByName("Workman on Ladder");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(ChatMessage.create).toHaveBeenCalledOnce();
            const { content } = ChatMessage.create.mock.calls[0][0];
            expect(content).toContain("labourer");
        });
    });

    describe("Unattended Cart Full of Cabbages", () => {
        it("adds surprised condition when Initiative roll fails (SL < 0)", async () => {
            actor.setupCharacteristic = vi.fn().mockResolvedValue({
                roll:   vi.fn().mockResolvedValue(undefined),
                result: { SL: "-1" },
            });
            const entry = obstacleByName("Unattended Cart Full of Cabbages");
            await entry.consequences["Climb"]("Actor.test", -1, entry, "Hero");
            expect(actor.addCondition).toHaveBeenCalledWith("surprised");
            expect(ChatMessage.create).toHaveBeenCalledOnce();
        });

        it("does not add surprised when Initiative roll passes (SL = 0)", async () => {
            actor.setupCharacteristic = vi.fn().mockResolvedValue({
                roll:   vi.fn().mockResolvedValue(undefined),
                result: { SL: "0" },
            });
            const entry = obstacleByName("Unattended Cart Full of Cabbages");
            await entry.consequences["Climb"]("Actor.test", -1, entry, "Hero");
            expect(actor.addCondition).not.toHaveBeenCalled();
            expect(ChatMessage.create).not.toHaveBeenCalled();
        });

        it("rolls an average Initiative test", async () => {
            actor.setupCharacteristic = vi.fn().mockResolvedValue({
                roll:   vi.fn().mockResolvedValue(undefined),
                result: { SL: "1" },
            });
            const entry = obstacleByName("Unattended Cart Full of Cabbages");
            await entry.consequences["Climb"]("Actor.test", -1, entry, "Hero");
            expect(actor.setupCharacteristic).toHaveBeenCalledWith(
                "i",
                expect.objectContaining({ fields: { difficulty: "average" } })
            );
        });
    });

    describe("Scattered Mound of Cabbages", () => {
        it("adds prone on failed Athletics", async () => {
            const entry = obstacleByName("Scattered Mound of Cabbages");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(actor.addCondition).toHaveBeenCalledWith("prone");
        });

        it("applies a 1-yard fall", async () => {
            const entry = obstacleByName("Scattered Mound of Cabbages");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");
            expect(actor.applyBasicDamage).toHaveBeenCalledOnce();
            const fallNotif = ChatMessage.create.mock.calls.find(c =>
                c[0]?.content?.includes("falls 1 yard")
            );
            expect(fallNotif).toBeTruthy();
        });
    });

    describe("fall damage calculation (_applyFallDamage)", () => {
        it("passes rawDamage = d10 + yards*3 to applyBasicDamage with IGNORE_AP and minimumOne=false", async () => {
            // Rotten Floorboards: 3 yards → rawDamage ∈ [10, 19]
            const entry = obstacleByName("Rotten Floorboards");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");

            const [rawDmg, opts] = actor.applyBasicDamage.mock.calls[0];
            expect(rawDmg).toBeGreaterThanOrEqual(10); // d10(1) + 3*3
            expect(rawDmg).toBeLessThanOrEqual(19);    // d10(10) + 3*3
            expect(opts.damageType).toBe(game.wfrp4e.config.DAMAGE_TYPE.IGNORE_AP);
            expect(opts.minimumOne).toBe(false);
            expect(opts.suppressMsg).toBe(true);
        });

        it("chat message shows correct yards and formula components", async () => {
            actor.system.characteristics.t.bonus = 3;
            const entry = obstacleByName("Rotten Floorboards");
            await entry.consequences["Athletics"]("Actor.test", -1, entry, "Hero");

            const { content } = ChatMessage.create.mock.calls[0][0];
            expect(content).toContain("falls 3 yard");
            expect(content).toContain("TB 3");
            expect(content).toContain("Hero");
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch integration tests — consequence fires via applyComplexAction
// ─────────────────────────────────────────────────────────────────────────────

describe("applyComplexAction — obstacle consequence dispatch", () => {
    let message;
    let actorStub;

    beforeEach(() => {
        message = { id: "msg-001", update: vi.fn().mockResolvedValue(undefined) };
        actorStub = makeActor(2);
        fromUuid.mockReset();
        fromUuid.mockImplementation(async () => actorStub);
        ChatMessage.create.mockReset();
        ChatMessage.create.mockResolvedValue(undefined);
        game.messages.get.mockImplementation(() => ({ id: "stub-msg", delete: vi.fn(), flags: {} }));
        updateMessage.mockClear();
    });

    // Returns a live obstacle stub for the given name that the participant hasn't navigated.
    function liveObs(name, overrides = {}) {
        const entry = obstacleByName(name);
        return {
            id:                  `obs-${name.replace(/\s/g, "-")}`,
            name,
            position:            1,
            navigateSkill:       entry.navigateSkill,
            navigateDifficulty:  entry.navigateDifficulty,
            navigateDifficultyUnperceived: entry.navigateDifficultyUnperceived ?? null,
            perceivedBy:         ["p1"],   // p1 already perceived it
            navigatedBy:         ["q1"],   // quarry already navigated
            perceptionTests:     [],
            blocksProgress:      entry.blocksProgress,
            ...overrides,
        };
    }

    it("Haystack: failed Climb consequence fires and entangledThreshold is merged into participant", async () => {
        actorStub.setupSkill = vi.fn().mockResolvedValue({
            roll:   vi.fn().mockResolvedValue(undefined),
            result: { SL: "-1" },
        });

        const data = baseData({
            quarry:   [mkP("q1", { initiative: 5,  position: 10, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 20, position: 0,  joinOrder: 2, actorUuid: "Actor.p1" })],
            obstacles: [liveObs("Haystack")],
        });

        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "roll-001" });

        // Consequence fired: actor gained entangled.
        expect(actorStub.addCondition).toHaveBeenCalledWith("entangled");

        // entangledThreshold propagated into pursuer participant flags.
        const payload = captureUpdatePayload();
        const p1 = payload["flags.wfrp4e-pursuits.pursuers"].find(p => p.tokenUuid === "p1");
        const haystackEntry = obstacleByName("Haystack");
        expect(p1.entangledThreshold).toBe(haystackEntry.entangleThreshold);
    });

    it("Closed Gate: navSl = -2 does not trigger fall damage", async () => {
        actorStub.setupSkill = vi.fn().mockResolvedValue({
            roll:   vi.fn().mockResolvedValue(undefined),
            result: { SL: "-2" },
        });

        const data = baseData({
            quarry:   [mkP("q1", { initiative: 5,  position: 10, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 20, position: 0,  joinOrder: 2, actorUuid: "Actor.p1" })],
            obstacles: [liveObs("Closed Gate")],
        });

        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "roll-001" });

        expect(actorStub.applyBasicDamage).not.toHaveBeenCalled();
    });

    it("Closed Gate: impressive failure (navSl = -3) triggers a 2-yard fall", async () => {
        actorStub.setupSkill = vi.fn().mockResolvedValue({
            roll:   vi.fn().mockResolvedValue(undefined),
            result: { SL: "-3" },
        });

        const data = baseData({
            quarry:   [mkP("q1", { initiative: 5,  position: 10, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 20, position: 0,  joinOrder: 2, actorUuid: "Actor.p1" })],
            obstacles: [liveObs("Closed Gate")],
        });

        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "roll-001" });

        expect(actorStub.applyBasicDamage).toHaveBeenCalledOnce();
        const fallMsg = ChatMessage.create.mock.calls.find(c =>
            c[0]?.content?.includes("falls 2 yard")
        );
        expect(fallMsg).toBeTruthy();
    });

    it("Large Log: navigation SL='-0' (marginal fail) is treated as failure and fires consequence", async () => {
        // Number("-0") === -0, and -0 >= 0 is true in JS.
        // Without the Object.is(-0) fix, this would skip the consequence.
        actorStub.setupSkill = vi.fn().mockResolvedValue({
            roll:   vi.fn().mockResolvedValue(undefined),
            result: { SL: "-0" },
        });

        const data = baseData({
            quarry:   [mkP("q1", { initiative: 5,  position: 10, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 20, position: 0,  joinOrder: 2, actorUuid: "Actor.p1" })],
            obstacles: [liveObs("Large Log")],
        });

        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "roll-001" });

        expect(actorStub.addCondition).toHaveBeenCalledWith("prone");
    });

    it("obstacle with automaticConsequences=false uses text-fallback notification instead of a function", async () => {
        actorStub.setupSkill = vi.fn().mockResolvedValue({
            roll:   vi.fn().mockResolvedValue(undefined),
            result: { SL: "-1" },
        });

        // Filthy Puddle: automaticConsequences=false — no consequence function.
        const data = baseData({
            quarry:   [mkP("q1", { initiative: 5,  position: 10, joinOrder: 1 })],
            pursuers: [mkP("p1", { initiative: 20, position: 0,  joinOrder: 2, actorUuid: "Actor.p1" })],
            obstacles: [liveObs("Filthy Puddle", {
                perceivedBy: ["p1"],
                navigateDifficulty: "average",
            })],
        });

        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "roll-001" });

        // No condition added (no consequence function).
        expect(actorStub.addCondition).not.toHaveBeenCalled();
        // Text-fallback notification was posted (PURSUITS.ObstacleNavFailed key).
        const fallbackMsg = ChatMessage.create.mock.calls.find(c =>
            c[0]?.content?.includes("PURSUITS.ObstacleNavFailed")
        );
        expect(fallbackMsg).toBeTruthy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom obstacle dispatch tests
// Custom obstacles have names not in OBSTACLE_TABLE → always use text-fallback.
// ─────────────────────────────────────────────────────────────────────────────

describe("applyComplexAction — custom obstacle dispatch", () => {
    let message;
    let actorStub;

    function customLiveObs(overrides = {}) {
        return {
            id:                            "obs-custom",
            name:                          "Broken Bridge",
            position:                      1,
            navigateSkill:                 "Athletics",
            navigateDifficulty:            "average",
            navigateSkillUnperceived:      null,
            navigateDifficultyUnperceived: null,
            perceivedBy:                   ["p1"],
            navigatedBy:                   ["q1"],
            perceptionTests:               [],
            blocksProgress:                false,
            consequencesText:              "You tumble into the river.",
            automaticConsequences:         false,
            ...overrides,
        };
    }

    beforeEach(() => {
        message   = { id: "msg-001", update: vi.fn().mockResolvedValue(undefined) };
        actorStub = makeActor(2);
        actorStub.setupSkill = vi.fn().mockResolvedValue({
            roll:   vi.fn().mockResolvedValue(undefined),
            result: { SL: "-1" },
        });
        fromUuid.mockReset();
        fromUuid.mockImplementation(async () => actorStub);
        ChatMessage.create.mockReset();
        ChatMessage.create.mockResolvedValue(undefined);
        game.messages.get.mockImplementation(() => ({ id: "stub-msg", delete: vi.fn(), flags: {} }));
        updateMessage.mockClear();
    });

    it("posts text-fallback notification containing the custom name and consequencesText on failure", async () => {
        const data = baseData({
            quarry:    [mkP("q1", { initiative: 5,  position: 10, joinOrder: 1 })],
            pursuers:  [mkP("p1", { initiative: 20, position: 0,  joinOrder: 2, actorUuid: "Actor.p1" })],
            obstacles: [customLiveObs()],
        });

        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "roll-001" });

        const fallbackMsg = ChatMessage.create.mock.calls.find(c =>
            c[0]?.content?.includes("Broken Bridge")
        );
        expect(fallbackMsg).toBeTruthy();
        expect(fallbackMsg[0].content).toContain("You tumble into the river.");
    });

    it("does not call any actor condition or damage methods (no automatic consequences)", async () => {
        const data = baseData({
            quarry:    [mkP("q1", { initiative: 5,  position: 10, joinOrder: 1 })],
            pursuers:  [mkP("p1", { initiative: 20, position: 0,  joinOrder: 2, actorUuid: "Actor.p1" })],
            obstacles: [customLiveObs()],
        });

        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "roll-001" });

        expect(actorStub.addCondition).not.toHaveBeenCalled();
        expect(actorStub.applyBasicDamage).not.toHaveBeenCalled();
    });

    it("blocksProgress=true: participant position is capped at obstacle position on failure", async () => {
        const data = baseData({
            quarry:    [mkP("q1", { initiative: 5,  position: 10, joinOrder: 1 })],
            pursuers:  [mkP("p1", { initiative: 20, position: 0,  joinOrder: 2, actorUuid: "Actor.p1" })],
            obstacles: [customLiveObs({ blocksProgress: true })],
        });

        // SL=4 → distMoved=2 → would move to pos 2, but blocked at obs.position=1
        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "roll-001" });

        const payload = captureUpdatePayload();
        const p1 = payload["flags.wfrp4e-pursuits.pursuers"].find(p => p.tokenUuid === "p1");
        expect(p1.position).toBe(1);
    });

    it("blocksProgress=false: participant position advances past the obstacle despite failing", async () => {
        // SL=4 with move=5 → distMoved=3 → newPos=3; obstacle at pos=1 must NOT cap progress
        const data = baseData({
            quarry:    [mkP("q1", { initiative: 5,  position: 10, joinOrder: 1 })],
            pursuers:  [mkP("p1", { initiative: 20, position: 0,  joinOrder: 2, actorUuid: "Actor.p1" })],
            obstacles: [customLiveObs({ blocksProgress: false })],
        });

        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "roll-001" });

        const payload = captureUpdatePayload();
        const p1 = payload["flags.wfrp4e-pursuits.pursuers"].find(p => p.tokenUuid === "p1");
        expect(p1.position).toBeGreaterThan(1);  // not capped at obstacle position
    });

    it("uses navigateSkillUnperceived and navigateDifficultyUnperceived when participant is not in perceivedBy", async () => {
        actorStub.setupSkill = vi.fn().mockResolvedValue({
            roll:   vi.fn().mockResolvedValue(undefined),
            result: { SL: "1" },
        });

        const data = baseData({
            quarry:    [mkP("q1", { initiative: 5,  position: 10, joinOrder: 1 })],
            pursuers:  [mkP("p1", { initiative: 20, position: 0,  joinOrder: 2, actorUuid: "Actor.p1" })],
            obstacles: [customLiveObs({
                perceivedBy:                   [],
                navigateSkillUnperceived:      "Dodge",
                navigateDifficultyUnperceived: "hard",
            })],
        });

        await applyComplexAction(message, data, "p1", { sl: 4, messageId: "roll-001" });

        expect(actorStub.setupSkill).toHaveBeenCalledWith(
            "Dodge",
            expect.objectContaining({ fields: expect.objectContaining({ difficulty: "hard" }) })
        );
    });
});
