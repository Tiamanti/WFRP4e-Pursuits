import { renderSimpleRoundContent } from "./pursuit-round-simple.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Simple pursuit capture / end handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function _onAbandonQuarry(message, ev, target) {
    if (!game.user.isGM) return;
    const tokenUuid = target.dataset.uuid;
    const { pursuitMessageId, candidates } = message.flags?.["wfrp4e-pursuits"] ?? {};
    const chosen = (candidates ?? []).find(c => c.tokenUuid === tokenUuid);
    if (!chosen) return;
    const pursuitMsg = game.messages.get(pursuitMessageId);
    if (!pursuitMsg) return;
    const data = pursuitMsg.flags?.["wfrp4e-pursuits"] ?? {};

    const newQuarry   = (data.quarry ?? []).filter(q => q.tokenUuid !== tokenUuid);
    const newDistance = chosen.newDistance;

    const content = await renderSimpleRoundContent({
        pursuitType:    data.pursuitType,
        round:          data.round,
        distance:       newDistance,
        escapeDistance: data.escapeDistance ?? 10,
        quarry:         newQuarry,
        pursuers:       data.pursuers ?? [],
        roundLog:       data.roundLog ?? [],
        pursuitSkill:   data.pursuitSkill ?? "Athletics",
        slResults:      [],
        caught:         false,
    });
    await pursuitMsg.update({
        content,
        "flags.wfrp4e-pursuits.quarry":               newQuarry,
        "flags.wfrp4e-pursuits.distance":             newDistance,
        "flags.wfrp4e-pursuits.simpleCatchupPending": false,
    });

    const capturedHtml = await foundry.applications.handlebars.renderTemplate(
        "modules/wfrp4e-pursuits/templates/chat/pursuit-simple-captured.hbs",
        { capturedName: chosen.name }
    );
    await ChatMessage.create({
        content: capturedHtml,
        flags: {
            "wfrp4e-pursuits": {
                pursuitType:    "simple",
                type:           "simpleCaptured",
                pursuitMessageId,
                capturedQuarry: { tokenUuid: chosen.tokenUuid, name: chosen.name },
            },
        },
    });
    await message.delete();
}

export async function _onIgnoreCaptured(message, ev, target) {
    if (!game.user.isGM) return;
    await message.delete();
}

export async function _onCapturedBySome(message, ev, target) {
    if (!game.user.isGM) return;
    const { pursuitMessageId, capturedQuarry } = message.flags?.["wfrp4e-pursuits"] ?? {};
    const pursuitMsg = game.messages.get(pursuitMessageId);
    if (!pursuitMsg) return;
    const data = pursuitMsg.flags?.["wfrp4e-pursuits"] ?? {};

    const selectHtml = await foundry.applications.handlebars.renderTemplate(
        "modules/wfrp4e-pursuits/templates/chat/pursuit-simple-capture-select.hbs",
        { capturedName: capturedQuarry.name, pursuers: data.pursuers ?? [] }
    );
    await ChatMessage.create({
        content: selectHtml,
        flags: {
            "wfrp4e-pursuits": {
                pursuitType:    "simple",
                type:           "simpleCaptureSelect",
                pursuitMessageId,
                capturedQuarry,
            },
        },
    });
    await message.delete();
}

export async function _onDoneCaptureSelect(message, ev, target) {
    if (!game.user.isGM) return;
    const { pursuitMessageId } = message.flags?.["wfrp4e-pursuits"] ?? {};
    const pursuitMsg = game.messages.get(pursuitMessageId);
    if (!pursuitMsg) return;
    const data = pursuitMsg.flags?.["wfrp4e-pursuits"] ?? {};

    const card = target.closest(".pursuit-card");
    const checked = new Set(
        [...(card?.querySelectorAll("input[name='pursuer']:checked") ?? [])].map(el => el.value)
    );
    const newPursuers = (data.pursuers ?? []).filter(p => !checked.has(p.tokenUuid));

    const content = await renderSimpleRoundContent({
        pursuitType:    data.pursuitType,
        round:          data.round,
        distance:       data.distance ?? 1,
        escapeDistance: data.escapeDistance ?? 10,
        quarry:         data.quarry ?? [],
        pursuers:       newPursuers,
        roundLog:       data.roundLog ?? [],
        pursuitSkill:   data.pursuitSkill ?? "Athletics",
        slResults:      [],
        caught:         false,
    });
    await pursuitMsg.update({
        content,
        "flags.wfrp4e-pursuits.pursuers": newPursuers,
    });
    await message.delete();
}

export async function _onEndSimplePursuit(message, ev, target) {
    if (!game.user.isGM) return;
    const { pursuitMessageId } = message.flags?.["wfrp4e-pursuits"] ?? {};
    const pursuitMsg = game.messages.get(pursuitMessageId);
    if (!pursuitMsg) return;
    const data = pursuitMsg.flags?.["wfrp4e-pursuits"] ?? {};

    const content = await renderSimpleRoundContent({
        pursuitType:    data.pursuitType,
        round:          data.round,
        distance:       0,
        escapeDistance: data.escapeDistance ?? 10,
        quarry:         data.quarry ?? [],
        pursuers:       data.pursuers ?? [],
        roundLog:       data.roundLog ?? [],
        pursuitSkill:   data.pursuitSkill ?? "Athletics",
        slResults:      [],
        caught:         true,
    });
    await pursuitMsg.update({
        content,
        "flags.wfrp4e-pursuits.state":                "complete",
        "flags.wfrp4e-pursuits.distance":             0,
        "flags.wfrp4e-pursuits.simpleCatchupPending": false,
    });
    await message.delete();
}
