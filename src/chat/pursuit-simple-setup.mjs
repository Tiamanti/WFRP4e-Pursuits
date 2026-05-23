import { updateMessage, _getSelectedTokens, _tokensToParticipants, _mergeParticipants, _readParticipantOverrides } from "./pursuit-shared.mjs";
import { renderSimpleRoundContent } from "./pursuit-round-simple.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Setup card rendering
// ─────────────────────────────────────────────────────────────────────────────

export async function renderSimpleSetupContent({ pursuitType, quarry, pursuers, distance = 4, escapeDistance = 10 }) {
    const enrichParticipant = p => ({
        ...p,
        skill:          p.skill ?? "Athletics",
        moveRating:     p.moveRating ?? "",
        showMoveRating: p.skill === "Ride" || p.skill === "Drive",
        skillAthletics: !p.skill || p.skill === "Athletics",
        skillRide:      p.skill === "Ride",
        skillDrive:     p.skill === "Drive",
        hasInitiative:  false,
        showInitiativeBtn: false,
    });
    return foundry.applications.handlebars.renderTemplate(
        "modules/wfrp4e-pursuits/templates/chat/pursuit-setup.hbs",
        {
            pursuitType,
            isSimple:            true,
            isComplex:           false,
            quarry:              quarry.map(enrichParticipant),
            pursuers:            pursuers.map(enrichParticipant),
            canStart:            quarry.length > 0 && pursuers.length > 0,
            distance,
            escapeDistance,
            environmentOptions:  [],
            needsInitiativeRoll: false,
        }
    );
}

export async function createSimpleSetupMessage() {
    const html = await renderSimpleSetupContent({
        pursuitType:    "simple",
        quarry:         [],
        pursuers:       [],
        distance:       4,
        escapeDistance: 10,
    });
    ChatMessage.create({
        content: html,
        flags: {
            "wfrp4e-pursuits": {
                pursuitType:    "simple",
                state:          "setup",
                round:          0,
                distance:       4,
                escapeDistance: 10,
                quarry:         [],
                pursuers:       [],
                roundLog:       [],
                slResults:      [],
            },
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup-phase action handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function _onJoinQuarry(message, ev, target) {
    const tokens = _getSelectedTokens();
    if (!tokens.length) {
        ui.notifications.warn(game.i18n.localize("PURSUITS.SelectTokens"));
        return;
    }
    const data      = message.flags?.["wfrp4e-pursuits"] ?? {};
    const card      = target.closest(".pursuit-card");
    const overrides = _readParticipantOverrides(card);
    const quarryWithOverrides   = (data.quarry   ?? []).map(p => ({ ...p, ...overrides[p.tokenUuid] }));
    const pursuersWithOverrides = (data.pursuers ?? []).map(p => ({ ...p, ...overrides[p.tokenUuid] }));
    const newQuarry = _mergeParticipants(quarryWithOverrides, _tokensToParticipants(tokens));
    const content   = await renderSimpleSetupContent({
        pursuitType:    data.pursuitType,
        quarry:         newQuarry,
        pursuers:       pursuersWithOverrides,
        distance:       data.distance ?? 4,
        escapeDistance: data.escapeDistance ?? 10,
    });
    await updateMessage(message.id, { content, "flags.wfrp4e-pursuits.quarry": newQuarry });
}

export async function _onJoinPursuers(message, ev, target) {
    const tokens = _getSelectedTokens();
    if (!tokens.length) {
        ui.notifications.warn(game.i18n.localize("PURSUITS.SelectTokens"));
        return;
    }
    const data      = message.flags?.["wfrp4e-pursuits"] ?? {};
    const card      = target.closest(".pursuit-card");
    const overrides = _readParticipantOverrides(card);
    const quarryWithOverrides   = (data.quarry   ?? []).map(p => ({ ...p, ...overrides[p.tokenUuid] }));
    const pursuersWithOverrides = (data.pursuers ?? []).map(p => ({ ...p, ...overrides[p.tokenUuid] }));
    const newPursuers = _mergeParticipants(pursuersWithOverrides, _tokensToParticipants(tokens));
    const content     = await renderSimpleSetupContent({
        pursuitType:    data.pursuitType,
        quarry:         quarryWithOverrides,
        pursuers:       newPursuers,
        distance:       data.distance ?? 4,
        escapeDistance: data.escapeDistance ?? 10,
    });
    await updateMessage(message.id, { content, "flags.wfrp4e-pursuits.pursuers": newPursuers });
}

export async function _onRemoveParticipant(message, ev, target) {
    const { group, uuid } = target.dataset;
    const data      = message.flags?.["wfrp4e-pursuits"] ?? {};
    const card      = target.closest(".pursuit-card");
    const overrides = _readParticipantOverrides(card);
    let newQuarry   = (data.quarry   ?? []).map(p => ({ ...p, ...overrides[p.tokenUuid] }));
    let newPursuers = (data.pursuers ?? []).map(p => ({ ...p, ...overrides[p.tokenUuid] }));

    if (group === "quarry") {
        newQuarry = newQuarry.filter(p => p.tokenUuid !== uuid);
    } else if (group === "pursuers") {
        newPursuers = newPursuers.filter(p => p.tokenUuid !== uuid);
    }

    const content = await renderSimpleSetupContent({
        pursuitType:    data.pursuitType,
        quarry:         newQuarry,
        pursuers:       newPursuers,
        distance:       data.distance ?? 4,
        escapeDistance: data.escapeDistance ?? 10,
    });
    await updateMessage(message.id, {
        content,
        "flags.wfrp4e-pursuits.quarry":   newQuarry,
        "flags.wfrp4e-pursuits.pursuers": newPursuers,
    });
}

export async function _onStart(message, ev, target) {
    if (target.dataset.startBlocked) {
        ui.notifications.info(game.i18n.localize("PURSUITS.NeedInitiativeRolls"));
        return;
    }
    if (!game.user.isGM) return;
    const data = message.flags?.["wfrp4e-pursuits"] ?? {};
    if (!(data.quarry ?? []).length || !(data.pursuers ?? []).length) {
        ui.notifications.warn(game.i18n.localize("PURSUITS.NeedBothSides"));
        return;
    }
    const card      = target.closest(".pursuit-card");
    const distInput = card?.querySelector(".start-distance-input");
    const overrides = _readParticipantOverrides(card);

    const startDistance  = distInput ? (parseInt(distInput.value) || 4) : (data.distance ?? 4);
    const escapeDistance = data.escapeDistance ?? 10;

    const applyOverrides = participants => participants.map(p => {
        const o          = overrides[p.tokenUuid] ?? {};
        const skill      = o.skill ?? p.skill ?? "Athletics";
        const moveRating = o.moveRating ?? p.moveRating ?? null;
        const move       = (moveRating && (skill === "Ride" || skill === "Drive")) ? moveRating : p.move;
        return { ...p, skill, moveRating, move };
    });

    const quarry   = applyOverrides(data.quarry   ?? []);
    const pursuers = applyOverrides(data.pursuers ?? []);

    const content = await renderSimpleRoundContent({
        pursuitType: data.pursuitType,
        round:       1,
        distance:    startDistance,
        escapeDistance,
        quarry,
        pursuers,
        roundLog:  [],
        slResults: [],
    });

    await message.update({
        content,
        "flags.wfrp4e-pursuits.state":          "active",
        "flags.wfrp4e-pursuits.round":          1,
        "flags.wfrp4e-pursuits.distance":       startDistance,
        "flags.wfrp4e-pursuits.escapeDistance": escapeDistance,
        "flags.wfrp4e-pursuits.slResults":      [],
        "flags.wfrp4e-pursuits.quarry":         quarry,
        "flags.wfrp4e-pursuits.pursuers":       pursuers,
    });
}
