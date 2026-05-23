import { renderComplexRoundContent } from "./pursuit-complex-render.mjs";
import { updateMessage } from "./pursuit-shared.mjs";
import { _finalizePendingAction } from "./pursuit-complex-math.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Chat message helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function postCatchMessage(pursuitMessageId, quarryMember, pursuer, pursuersCount) {
    const html = await foundry.applications.handlebars.renderTemplate(
        "modules/wfrp4e-pursuits/templates/chat/pursuit-caught.hbs",
        {
            quarryName:  quarryMember.name,
            pursuerName: pursuer.name,
            canExclude:  pursuersCount > 1,
        }
    );
    const msg = await ChatMessage.create({
        content: html,
        flags: {
            "wfrp4e-pursuits": {
                type:             "catch",
                pursuitMessageId,
                quarryTokenUuid:  quarryMember.tokenUuid,
                quarryName:       quarryMember.name,
                pursuerTokenUuid: pursuer.tokenUuid,
                pursuerName:      pursuer.name,
            },
        },
    });
    return msg?.id ?? null;
}

export async function postEscapeMessage(quarryMember) {
    await ChatMessage.create({
        content: `<div class="pursuit-card pursuit-notification"><p><strong>${quarryMember.name}</strong> ${game.i18n.localize("PURSUITS.DisappearsInDistance")}.</p></div>`,
    });
}

export async function postLeftBehindMessage(quarryMember) {
    await ChatMessage.create({
        content: `<div class="pursuit-card pursuit-notification"><p><strong>${quarryMember.name}</strong> ${game.i18n.localize("PURSUITS.IsLeftBehind")}.</p></div>`,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Catch dialog action handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function onExcludePair(message, ev, target) {
    if (!game.user.isGM) return;
    const { pursuitMessageId, quarryTokenUuid, pursuerTokenUuid, quarryName, pursuerName } = message.flags?.["wfrp4e-pursuits"] ?? {};
    const pursuitMsg = game.messages.get(pursuitMessageId);
    if (!pursuitMsg) return;
    const data = pursuitMsg.flags?.["wfrp4e-pursuits"] ?? {};
    if (data.state === "complete") return;
    if ((data.pursuers ?? []).length <= 1) return;

    // Finalize the removed pursuer's pending action (delete their roll messages, if any).
    const removedPursuer = (data.pursuers ?? []).find(p => p.tokenUuid === pursuerTokenUuid);
    if (removedPursuer) _finalizePendingAction(removedPursuer);

    const newPursuers      = (data.pursuers      ?? []).filter(p => p.tokenUuid !== pursuerTokenUuid);
    const newCaughtPending = (data.caughtPending ?? []).filter(q => q.tokenUuid !== quarryTokenUuid);
    const newQuarry        = (data.quarry        ?? []).filter(q => q.tokenUuid !== quarryTokenUuid);
    const allPendingUuids  = new Set(newCaughtPending.map(q => q.tokenUuid));
    const freeQuarry       = newQuarry.filter(q => !allPendingUuids.has(q.tokenUuid));
    const isComplete       = freeQuarry.length === 0 && newCaughtPending.length === 0;
    const distance         = isComplete ? 0 : (data.distance ?? 0);

    const remainingPursuerUuids = new Set(newPursuers.map(p => p.tokenUuid));
    const remainingQuarryUuids  = new Set(newQuarry.map(q => q.tokenUuid));
    const cleanedIgnoredPairs   = (data.ignoredPairs ?? []).filter(pair =>
        remainingPursuerUuids.has(pair.pursuerTokenUuid)
        && remainingQuarryUuids.has(pair.quarryTokenUuid)
    );
    const content = await renderComplexRoundContent({
        pursuitType:    data.pursuitType,
        distance,
        escapeDistance: data.escapeDistance ?? 7,
        quarry:         freeQuarry,
        pursuers:       newPursuers,
        roundLog:       data.roundLog ?? [],
        pursuitSkill:   data.pursuitSkill ?? "Athletics",
        ignoredPairs:   cleanedIgnoredPairs,
        caughtPending:  newCaughtPending,
        obstacles:      data.obstacles ?? [],
        caught:         false,
    });
    const updateData = {
        content,
        "flags.wfrp4e-pursuits.quarry":        newQuarry,
        "flags.wfrp4e-pursuits.pursuers":      newPursuers,
        "flags.wfrp4e-pursuits.caughtPending": newCaughtPending,
        "flags.wfrp4e-pursuits.ignoredPairs":  cleanedIgnoredPairs,
    };
    if (isComplete) updateData["flags.wfrp4e-pursuits.state"] = "complete";
    await pursuitMsg.update(updateData);
    await message.delete();
    await ChatMessage.create({ content: `<p>${game.i18n.format("PURSUITS.CaughtNarration", { quarryName: `<strong>${quarryName}</strong>`, pursuerName: `<strong>${pursuerName}</strong>` })}</p>` });
}

export async function onIgnoreQuarry(message, ev, target) {
    if (!game.user.isGM) return;
    const { pursuitMessageId, quarryTokenUuid, quarryName, pursuerTokenUuid, pursuerName } = message.flags?.["wfrp4e-pursuits"] ?? {};
    const pursuitMsg = game.messages.get(pursuitMessageId);
    if (!pursuitMsg) return;
    const data = pursuitMsg.flags?.["wfrp4e-pursuits"] ?? {};

    const newCaughtPending = (data.caughtPending ?? []).filter(q => q.tokenUuid !== quarryTokenUuid);
    const newIgnoredPairs  = [...(data.ignoredPairs ?? []), { quarryTokenUuid, pursuerTokenUuid }];
    const quarry           = data.quarry ?? [];
    const allPendingUuids  = new Set(newCaughtPending.map(q => q.tokenUuid));
    const freeQuarry       = quarry.filter(q => !allPendingUuids.has(q.tokenUuid));
    const pursuers         = data.pursuers ?? [];
    const maxPursuerPos    = pursuers.length ? Math.max(...pursuers.map(p => p.position ?? 0)) : 0;
    const minQuarryPos     = freeQuarry.length ? Math.min(...freeQuarry.map(q => q.position ?? 0)) : 0;
    const newDistance      = Math.max(0, minQuarryPos - maxPursuerPos);

    const content = await renderComplexRoundContent({
        pursuitType:    data.pursuitType,
        distance:       newDistance,
        escapeDistance: data.escapeDistance ?? 7,
        quarry:         freeQuarry,
        pursuers,
        roundLog:       data.roundLog ?? [],
        pursuitSkill:   data.pursuitSkill ?? "Athletics",
        ignoredPairs:   newIgnoredPairs,
        caughtPending:  newCaughtPending,
        obstacles:      data.obstacles ?? [],
        caught:         false,
    });
    await pursuitMsg.update({
        content,
        "flags.wfrp4e-pursuits.caughtPending": newCaughtPending,
        "flags.wfrp4e-pursuits.ignoredPairs":  newIgnoredPairs,
        "flags.wfrp4e-pursuits.distance":      newDistance,
    });
    await message.delete();
    await ChatMessage.create({ content: `<p>${game.i18n.format("PURSUITS.PursuerPastQuarry", { pursuerName: `<strong>${pursuerName}</strong>`, quarryName: `<strong>${quarryName}</strong>` })}</p>` });
}

export async function onEndPursuit(message, ev, target) {
    if (!game.user.isGM) return;
    const { pursuitMessageId } = message.flags?.["wfrp4e-pursuits"] ?? {};
    const pursuitMsg = game.messages.get(pursuitMessageId);
    if (!pursuitMsg) return;
    const data = pursuitMsg.flags?.["wfrp4e-pursuits"] ?? {};
    if (data.state === "complete") return;

    // Finalize every participant's pending action — deletes any lingering roll chat messages.
    const finalizedQuarry   = (data.quarry   ?? []).map(_finalizePendingAction);
    const finalizedPursuers = (data.pursuers ?? []).map(_finalizePendingAction);

    const content = await renderComplexRoundContent({
        pursuitType:    data.pursuitType,
        distance:       0,
        escapeDistance: data.escapeDistance ?? 7,
        quarry:         finalizedQuarry,
        pursuers:       finalizedPursuers,
        roundLog:       data.roundLog ?? [],
        pursuitSkill:   data.pursuitSkill ?? "Athletics",
        ignoredPairs:   data.ignoredPairs ?? [],
        caughtPending:  [],
        obstacles:      data.obstacles ?? [],
    });
    await pursuitMsg.update({
        content,
        "flags.wfrp4e-pursuits.state":    "complete",
        "flags.wfrp4e-pursuits.distance": 0,
        "flags.wfrp4e-pursuits.quarry":   finalizedQuarry,
        "flags.wfrp4e-pursuits.pursuers": finalizedPursuers,
    });
    await message.delete();
}
