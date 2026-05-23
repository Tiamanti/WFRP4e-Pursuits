import { updateMessage } from "./pursuit-shared.mjs";
import { renderSimpleRoundContent, resolveSimpleRound, _simpleRoundResolvable } from "./pursuit-round-simple.mjs";
import { _onJoinQuarry, _onJoinPursuers, _onRemoveParticipant, _onStart } from "./pursuit-simple-setup.mjs";
import { _onAbandonQuarry, _onIgnoreCaptured, _onCapturedBySome, _onDoneCaptureSelect, _onEndSimplePursuit } from "./pursuit-simple-capture.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Reroll handler (called by pursuit-message-complex dispatchReroll)
// ─────────────────────────────────────────────────────────────────────────────

export async function applySimpleReroll({ pursuitMsgId, entryTokenUuid, newSl, newMessageId }) {
    if (!game.user.isGM) return;
    const pursuitMsg    = game.messages.get(pursuitMsgId);
    const liveData      = pursuitMsg?.flags?.["wfrp4e-pursuits"] ?? {};
    if (liveData.state !== "active" || liveData.pursuitType !== "simple") return;
    const liveSlResults = Array.isArray(liveData.slResults) ? liveData.slResults : [];

    const updatedSlResults = liveSlResults.map(r =>
        r.tokenUuid === entryTokenUuid
            ? { ...r, sl: newSl, messageIds: [...(r.messageIds ?? []), newMessageId] }
            : r
    );

    const content = await renderSimpleRoundContent({
        pursuitType:    liveData.pursuitType,
        round:          liveData.round,
        distance:       liveData.distance,
        escapeDistance: liveData.escapeDistance ?? 10,
        quarry:         liveData.quarry   ?? [],
        pursuers:       liveData.pursuers ?? [],
        roundLog:       liveData.roundLog ?? [],
        pursuitSkill:   liveData.pursuitSkill ?? "Athletics",
        slResults:      updatedSlResults,
        skippedUuids:   liveData.skippedUuids ?? [],
        caught:         false,
    });
    await updateMessage(pursuitMsgId, {
        content,
        "flags.wfrp4e-pursuits.slResults": updatedSlResults,
    });
}

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
    start:             _onStart,
    resolveRound:      _onResolveRound,
    rollSkill:         _onRollSkill,
    removeCondition:   _onRemoveCondition,
    abandonQuarry:     _onAbandonQuarry,
    ignoreCaptured:    _onIgnoreCaptured,
    capturedBySome:    _onCapturedBySome,
    doneCaptureSelect: _onDoneCaptureSelect,
    endSimplePursuit:  _onEndSimplePursuit,
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
        ui.notifications.warn(game.i18n.localize("PURSUITS.NotYourToken"));
        return;
    }
    const flags          = message.flags?.["wfrp4e-pursuits"] ?? {};
    const allParticipants = [...(flags.quarry ?? []), ...(flags.pursuers ?? [])];
    const participant    = allParticipants.find(p => p.tokenUuid === tokenUuid);
    const skillName      = participant?.skill ?? "Athletics";

    const test = await actor.setupSkill(skillName, { appendTitle: " - Pursuit", skipTargets: true });
    if (!test) return;
    await test.roll();
    const sl = Number(test.result?.SL ?? 0);

    const liveData         = game.messages.get(message.id)?.flags?.["wfrp4e-pursuits"] ?? {};
    const messageId        = test.context?.messageId;
    const currentSlResults = Array.isArray(liveData.slResults) ? liveData.slResults : [];
    const newSlResults     = [
        ...currentSlResults.filter(r => r.tokenUuid !== tokenUuid),
        { tokenUuid, sl, messageIds: messageId ? [messageId] : [] },
    ];
    const content = await renderSimpleRoundContent({
        pursuitType:    liveData.pursuitType,
        round:          liveData.round,
        distance:       liveData.distance,
        escapeDistance: liveData.escapeDistance ?? 10,
        quarry:         liveData.quarry   ?? [],
        pursuers:       liveData.pursuers ?? [],
        roundLog:       liveData.roundLog ?? [],
        pursuitSkill:   skillName,
        slResults:      newSlResults,
        skippedUuids:   liveData.skippedUuids ?? [],
        caught:         false,
    });
    await updateMessage(message.id, {
        content,
        "flags.wfrp4e-pursuits.slResults": newSlResults,
    });
}

async function _onRemoveCondition(message, ev, target) {
    const { actorUuid, tokenUuid, condition } = target.dataset;
    const actor = actorUuid ? await fromUuid(actorUuid) : null;
    if (!actor) return;
    await actor.removeCondition(condition);

    const liveData     = game.messages.get(message.id)?.flags?.["wfrp4e-pursuits"] ?? {};
    const skippedUuids = [...(liveData.skippedUuids ?? []), tokenUuid].filter(Boolean);
    const content      = await renderSimpleRoundContent({
        pursuitType:    liveData.pursuitType,
        round:          liveData.round,
        distance:       liveData.distance,
        escapeDistance: liveData.escapeDistance ?? 10,
        quarry:         liveData.quarry   ?? [],
        pursuers:       liveData.pursuers ?? [],
        roundLog:       liveData.roundLog ?? [],
        pursuitSkill:   liveData.pursuitSkill ?? "Athletics",
        slResults:      liveData.slResults ?? [],
        skippedUuids,
        caught:         false,
    });
    await updateMessage(message.id, {
        content,
        "flags.wfrp4e-pursuits.skippedUuids": skippedUuids,
    });
}

async function _onResolveRound(message, ev, target) {
    if (!game.user.isGM) return;
    const data = game.messages.get(message.id)?.flags?.["wfrp4e-pursuits"] ?? {};
    if (data.simpleCatchupPending) {
        ui.notifications.warn(game.i18n.localize("PURSUITS.ResolveCatchFirst"));
        return;
    }
    const slArray  = Array.isArray(data.slResults)    ? data.slResults    : [];
    const skipped  = Array.isArray(data.skippedUuids) ? data.skippedUuids : [];
    const decorate = p => ({
        ...p,
        hasResult: slArray.some(r => r.tokenUuid === p.tokenUuid),
        skipsRoll: skipped.includes(p.tokenUuid),
    });
    if (!_simpleRoundResolvable((data.quarry ?? []).map(decorate), (data.pursuers ?? []).map(decorate))) {
        ui.notifications.warn(game.i18n.localize("PURSUITS.NeedAllRolls"));
        return;
    }
    await resolveSimpleRound(message, data);
}
