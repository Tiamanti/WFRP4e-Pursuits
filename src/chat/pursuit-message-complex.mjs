import { updateMessage, REROLL_SOCKET } from "./pursuit-shared.mjs";
import { renderComplexRoundContent } from "./pursuit-complex-render.mjs";
import { onExcludePair, onIgnoreQuarry, onEndPursuit } from "./pursuit-complex-catch.mjs";
import { applyComplexAction } from "./pursuit-round-complex.mjs";
import {
    _onJoinQuarry, _onJoinPursuers, _onRemoveParticipant,
    _onRollInitiative, _onStart,
} from "./pursuit-complex-setup.mjs";
import { checkExhaustion } from "./exhaustion.mjs";
import { handlePerceptionReroll } from "./obstacles.mjs";
import { applySimpleReroll } from "./pursuit-message-simple.mjs";
import { openObstacleDialog } from "../apps/obstacle-dialog.mjs";

export { REROLL_SOCKET };

// ─────────────────────────────────────────────────────────────────────────────
// HTML render hook
// ─────────────────────────────────────────────────────────────────────────────

export function onRenderHTML(message, html) {
    html.addEventListener("click", async (ev) => {
        const target = ev.target.closest("[data-action]");
        if (!target) return;
        const handler = _actions[target.dataset.action];
        if (handler) {
            ev.preventDefault();
            await handler(message, ev, target);
        }
    });
    html.addEventListener("change", (ev) => {
        const select = ev.target.closest(".participant-skill-select");
        if (!select) return;
        const li = select.closest(".participant");
        const moveRatingRow = li?.querySelector(".participant-move-rating-row");
        if (!moveRatingRow) return;
        moveRatingRow.style.display = (select.value === "Ride" || select.value === "Drive") ? "" : "none";
    });
}

const _actions = {
    joinQuarry:        _onJoinQuarry,
    joinPursuers:      _onJoinPursuers,
    removeParticipant: _onRemoveParticipant,
    rollInitiative:    _onRollInitiative,
    start:             _onStart,
    rollSkill:         _onRollSkill,
    removeCondition:   _onRemoveCondition,
    rollStrengthEscape: _onRollStrengthEscape,
    createObstacle:    _onCreateObstacle,
    rollPerception:    _onRollPerception,
    excludePair:       onExcludePair,
    ignoreQuarry:      onIgnoreQuarry,
    endPursuit:        onEndPursuit,
};

// ─────────────────────────────────────────────────────────────────────────────
// Active-phase action handlers
// ─────────────────────────────────────────────────────────────────────────────

async function _onRollSkill(message, ev, target) {
    const { actorUuid, tokenUuid } = target.dataset;
    const actor = actorUuid ? await fromUuid(actorUuid) : null;
    if (!actor) {
        ui.notifications.warn("No actor found for this participant.");
        return;
    }
    if (!game.user.isGM && !actor.isOwner) {
        ui.notifications.warn(game.i18n.localize("PURSUITS.NotYourTurn"));
        return;
    }
    const flags          = message.flags?.["wfrp4e-pursuits"] ?? {};
    const allParticipants = [...(flags.quarry ?? []), ...(flags.pursuers ?? [])];
    const participant    = allParticipants.find(p => p.tokenUuid === tokenUuid);
    const skillName      = participant?.skill ?? "Athletics";
    const move           = participant?.move ?? 4;

    let difficulty;
    if      (move <= 1) difficulty = "veryHard";
    else if (move <= 2) difficulty = "hard";
    else if (move <= 3) difficulty = "challenging";
    else                difficulty = "average";

    const test = await actor.setupSkill(skillName, { appendTitle: "  - Pursuit", skipTargets: true, fields: { difficulty } });
    if (!test) return;
    await test.roll();
    const sl = Number(test.result?.SL ?? 0);

    const liveData        = game.messages.get(message.id)?.flags?.["wfrp4e-pursuits"] ?? {};
    const messageId       = test.context?.messageId;
    const newActionsTaken = (participant.actionsTaken ?? 0) + 1;
    await applyComplexAction(message, liveData, tokenUuid, { sl, messageId, isReroll: false, isSkip: false });
    await checkExhaustion(actor, participant, newActionsTaken);
}

async function _onRemoveCondition(message, ev, target) {
    const { actorUuid, tokenUuid, condition } = target.dataset;
    const actor = actorUuid ? await fromUuid(actorUuid) : null;
    if (!actor) return;
    await actor.removeCondition(condition);

    const liveData = game.messages.get(message.id)?.flags?.["wfrp4e-pursuits"] ?? {};
    await applyComplexAction(message, liveData, tokenUuid, { isReroll: false, isSkip: true, messageId: null });
}

async function _onRollStrengthEscape(message, ev, target) {
    const { actorUuid, tokenUuid } = target.dataset;
    const threshold = Number(target.dataset.entangledThreshold ?? 30);
    const actor = actorUuid ? await fromUuid(actorUuid) : null;
    if (!actor) return;
    if (!game.user.isGM && !actor.isOwner) {
        ui.notifications.warn(game.i18n.localize("PURSUITS.NotYourTurn"));
        return;
    }
    const flags = message.flags?.["wfrp4e-pursuits"] ?? {};
    const participant = [...(flags.quarry ?? []), ...(flags.pursuers ?? [])]
        .find(p => p.tokenUuid === tokenUuid);

    const test = await actor.setupCharacteristic("s", {
        appendTitle: " - Escape Entanglement",
        skipTargets: true,
    });
    if (!test) return;
    await test.roll();
    const actorSl = Number(test.result?.SL ?? 0);

    const thresholdRoll = Math.floor(Math.random() * 100) + 1;
    const thresholdSl   = Math.floor((thresholdRoll - threshold) / 10);

    const freed = actorSl > thresholdSl;
    if (freed) await actor.removeCondition("entangled");

    const pName = participant?.name ?? actor.name;
    const resultMsg = freed
        ? `<strong>${pName}</strong> breaks free from entanglement!`
        : `<strong>${pName}</strong> fails to break free (SL ${actorSl} vs. ${thresholdSl}) and remains entangled.`;
    await ChatMessage.create({
        content: `<div class="pursuit-card pursuit-notification"><p>${resultMsg}</p></div>`,
    });

    const liveData = game.messages.get(message.id)?.flags?.["wfrp4e-pursuits"] ?? {};
    await applyComplexAction(message, liveData, tokenUuid, {
        isReroll:             false,
        isSkip:               true,
        messageId:            null,
        extraParticipantFields: freed ? { entangledThreshold: null } : {},
    });
}

async function _onCreateObstacle(message, ev, target) {
    if (!game.user.isGM) return;
    const liveData = game.messages.get(message.id)?.flags?.["wfrp4e-pursuits"] ?? {};
    const quarry   = liveData.quarry   ?? [];
    const pursuers = liveData.pursuers ?? [];
    const allParticipants    = [...quarry, ...pursuers];
    const maxQuarryPosition  = quarry.length > 0 ? Math.max(...quarry.map(q => q.position ?? 0)) : 0;

    const result = await openObstacleDialog(maxQuarryPosition);
    if (!result) return;

    const { obstacleEntry, relativeDistance } = result;
    const absolutePosition = maxQuarryPosition + relativeDistance;

    const navigatedBy = allParticipants
        .filter(p => (p.position ?? 0) >= absolutePosition)
        .map(p => p.tokenUuid);

    const perceivedBy = obstacleEntry.isAutoPerceived
        ? allParticipants.filter(p => !navigatedBy.includes(p.tokenUuid)).map(p => p.tokenUuid)
        : [];

    const obstacle = {
        id:                            foundry.utils.randomID(),
        name:                          obstacleEntry.name,
        position:                      absolutePosition,
        perceivedText:                 obstacleEntry.perceivedText,
        isAutoPerceived:               obstacleEntry.isAutoPerceived,
        perceptionDifficulty:          obstacleEntry.perceptionDifficulty,
        testToNavigate:                obstacleEntry.testToNavigate,
        testToNavigateUnperceived:     obstacleEntry.testToNavigateUnperceived,
        navigateSkill:                 obstacleEntry.navigateSkill,
        navigateDifficulty:            obstacleEntry.navigateDifficulty,
        navigateSkillUnperceived:      obstacleEntry.navigateSkillUnperceived ?? null,
        navigateDifficultyUnperceived: obstacleEntry.navigateDifficultyUnperceived,
        consequencesText:              obstacleEntry.consequencesText,
        blocksProgress:                obstacleEntry.blocksProgress,
        perceivedBy,
        navigatedBy,
        perceptionTests:               [],
    };

    const freshData = game.messages.get(message.id)?.flags?.["wfrp4e-pursuits"] ?? {};
    const obstacles = [...(freshData.obstacles ?? []), obstacle];
    const content   = await renderComplexRoundContent({
        pursuitType:    freshData.pursuitType,
        distance:       freshData.distance,
        escapeDistance: freshData.escapeDistance,
        quarry:         freshData.quarry   ?? [],
        pursuers:       freshData.pursuers ?? [],
        roundLog:       freshData.roundLog ?? [],
        ignoredPairs:   freshData.ignoredPairs  ?? [],
        caughtPending:  freshData.caughtPending ?? [],
        obstacles,
    });
    await updateMessage(message.id, { content, "flags.wfrp4e-pursuits.obstacles": obstacles });
}

async function _onRollPerception(message, ev, target) {
    const { actorUuid, tokenUuid } = target.dataset;
    const actor = actorUuid ? await fromUuid(actorUuid) : null;
    if (!actor) return;
    if (!game.user.isGM && !actor.isOwner) {
        ui.notifications.warn(game.i18n.localize("PURSUITS.NotYourTurn"));
        return;
    }

    const liveData  = game.messages.get(message.id)?.flags?.["wfrp4e-pursuits"] ?? {};
    const obstacles = structuredClone(liveData.obstacles ?? []);
    const obs = obstacles.find(o =>
        !o.perceivedBy.includes(tokenUuid)
        && !o.navigatedBy.includes(tokenUuid)
        && !(o.perceptionTests ?? []).some(t => t.tokenUuid === tokenUuid)
    );
    if (!obs) return;

    const difficulty = obs.perceptionDifficulty ?? "average";
    const test = await actor.setupSkill("Perception", { appendTitle: " - Obstacle detection", skipTargets: true, fields: { difficulty } });
    if (!test) return;
    await test.roll();

    const sl        = Number(test.result?.SL ?? 0);
    // sl >= 0 is insufficient: Number("-0") === -0, and -0 >= 0 is true in JS.
    const passed    = sl > 0 || (sl === 0 && !Object.is(sl, -0));
    const messageId = test.context?.messageId;

    if (passed) obs.perceivedBy = [...obs.perceivedBy, tokenUuid];
    obs.perceptionTests = [
        ...(obs.perceptionTests ?? []).filter(t => t.tokenUuid !== tokenUuid),
        { tokenUuid, messageIds: [messageId].filter(Boolean), perceived: passed },
    ];

    const freshData      = game.messages.get(message.id)?.flags?.["wfrp4e-pursuits"] ?? {};
    const freshObstacles = (freshData.obstacles ?? []).map(o => o.id === obs.id ? obs : o);
    const content        = await renderComplexRoundContent({
        pursuitType:    freshData.pursuitType,
        distance:       freshData.distance,
        escapeDistance: freshData.escapeDistance,
        quarry:         freshData.quarry   ?? [],
        pursuers:       freshData.pursuers ?? [],
        roundLog:       freshData.roundLog ?? [],
        ignoredPairs:   freshData.ignoredPairs  ?? [],
        caughtPending:  freshData.caughtPending ?? [],
        obstacles:      freshObstacles,
    });
    await updateMessage(message.id, { content, "flags.wfrp4e-pursuits.obstacles": freshObstacles });
}

// ─────────────────────────────────────────────────────────────────────────────
// Reroll dispatch
// ─────────────────────────────────────────────────────────────────────────────

export async function dispatchReroll(payload) {
    if (payload.isPerceptionReroll) {
        const message = game.messages.get(payload.pursuitMsgId);
        if (!message) return;
        const liveData = message.flags?.["wfrp4e-pursuits"] ?? {};
        if (liveData.state !== "active" || liveData.pursuitType !== "complex") return;
        await handlePerceptionReroll(
            message, liveData,
            payload.entryTokenUuid, payload.obstacleId,
            payload.newMessageId, payload.passed,
        );
    } else if (payload.pursuitType === "complex") {
        const message = game.messages.get(payload.pursuitMsgId);
        if (!message) return;
        const liveData = message.flags?.["wfrp4e-pursuits"] ?? {};
        if (liveData.state !== "active" || liveData.pursuitType !== "complex") return;
        await applyComplexAction(message, liveData, payload.entryTokenUuid, {
            sl:        payload.newSl,
            messageId: payload.newMessageId,
            isReroll:  true,
            isSkip:    false,
        });
    } else if (payload.pursuitType === "simple") {
        await applySimpleReroll(payload);
    }
}

export async function onTestRolled(test) {
    if (!test.context?.reroll) return;
    const previousMessageId = test.context.previousMessage;
    if (!previousMessageId) return;

    for (const message of game.messages) {
        const data = message.flags?.["wfrp4e-pursuits"];
        if (data?.state !== "active") continue;
        const pursuitType = data.pursuitType;

        let entryTokenUuid     = null;
        let isPerceptionReroll = false;
        let perceptionObsId    = null;

        if (pursuitType === "complex") {
            const allParticipants = [...(data.quarry ?? []), ...(data.pursuers ?? [])];
            const participant = allParticipants.find(p =>
                (p.lastActionMessageIds ?? []).includes(previousMessageId)
            );
            if (participant) {
                entryTokenUuid = participant.tokenUuid;
            } else {
                outer: for (const obs of (data.obstacles ?? [])) {
                    for (const testData of (obs.perceptionTests ?? [])) {
                        if ((testData.messageIds ?? []).includes(previousMessageId)) {
                            entryTokenUuid     = testData.tokenUuid;
                            isPerceptionReroll = true;
                            perceptionObsId    = obs.id;
                            break outer;
                        }
                    }
                }
            }
            if (!entryTokenUuid) continue;
        } else if (pursuitType === "simple") {
            const slResults = Array.isArray(data.slResults) ? data.slResults : [];
            const entry     = slResults.find(r => (r.messageIds ?? []).includes(previousMessageId));
            if (!entry) continue;
            entryTokenUuid = entry.tokenUuid;
        } else {
            continue;
        }

        const pursuitMsgId = message.id;
        const newSl        = Number(test.result?.SL ?? 0);

        let captureId;
        captureId = Hooks.on("createChatMessage", async (newMsg) => {
            if (newMsg.type !== "test") return;
            Hooks.off("createChatMessage", captureId);
            const payload = isPerceptionReroll
                ? { isPerceptionReroll: true, pursuitMsgId, entryTokenUuid, obstacleId: perceptionObsId, newSl, passed: newSl >= 0, newMessageId: newMsg.id }
                : { pursuitType, pursuitMsgId, entryTokenUuid, newSl, newMessageId: newMsg.id };
            if (game.user.isGM) {
                await dispatchReroll(payload);
            } else {
                game.socket.emit(REROLL_SOCKET, { action: "reroll", ...payload });
            }
        });
        return;
    }
}
