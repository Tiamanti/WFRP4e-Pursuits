import { updateMessage, _getSelectedTokens, _tokensToParticipants, _mergeParticipants, _readParticipantOverrides } from "./pursuit-shared.mjs";
import { renderComplexRoundContent } from "./pursuit-complex-render.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Setup card rendering
// ─────────────────────────────────────────────────────────────────────────────

export async function renderComplexSetupContent({ pursuitType, quarry, pursuers, distance = 2, escapeDistance = 7 }) {
    const initiativeRule      = game.settings.get("wfrp4e", "initiativeRule") ?? "default";
    const needsInitiativeRoll = initiativeRule !== "default";
    const allHaveInitiative   = !needsInitiativeRoll
        || (quarry.every(p => p.initiative != null) && pursuers.every(p => p.initiative != null));
    const environmentOptions = [
        { value: 3,  label: game.i18n.localize("PURSUITS.EnvBusyCity"),  selected: escapeDistance === 3  },
        { value: 5,  label: game.i18n.localize("PURSUITS.EnvWoodland"),  selected: escapeDistance === 5  },
        { value: 7,  label: game.i18n.localize("PURSUITS.EnvVillage"),   selected: escapeDistance === 7  },
        { value: 10, label: game.i18n.localize("PURSUITS.EnvMeadow"),    selected: escapeDistance === 10 },
        { value: 13, label: game.i18n.localize("PURSUITS.EnvDesert"),    selected: escapeDistance === 13 },
    ];
    const enrichParticipant = p => ({
        ...p,
        skill:             p.skill ?? "Athletics",
        moveRating:        p.moveRating ?? "",
        showMoveRating:    p.skill === "Ride" || p.skill === "Drive",
        skillAthletics:    !p.skill || p.skill === "Athletics",
        skillRide:         p.skill === "Ride",
        skillDrive:        p.skill === "Drive",
        hasInitiative:     p.initiative != null,
        showInitiativeBtn: needsInitiativeRoll,
    });
    return foundry.applications.handlebars.renderTemplate(
        "modules/wfrp4e-pursuits/templates/chat/pursuit-setup.hbs",
        {
            pursuitType,
            isSimple:  false,
            isComplex: true,
            quarry:    quarry.map(enrichParticipant),
            pursuers:  pursuers.map(enrichParticipant),
            canStart:  quarry.length > 0 && pursuers.length > 0 && allHaveInitiative,
            distance,
            escapeDistance,
            environmentOptions,
            needsInitiativeRoll,
        }
    );
}

export async function createComplexSetupMessage() {
    const html = await renderComplexSetupContent({
        pursuitType:    "complex",
        quarry:         [],
        pursuers:       [],
        distance:       2,
        escapeDistance: 7,
    });
    ChatMessage.create({
        content: html,
        flags: {
            "wfrp4e-pursuits": {
                pursuitType:    "complex",
                state:          "setup",
                distance:       2,
                escapeDistance: 7,
                quarry:         [],
                pursuers:       [],
                roundLog:       [],
                caughtPending:  [],
                ignoredPairs:   [],
            },
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Initiative helper
// ─────────────────────────────────────────────────────────────────────────────

export async function _rollParticipantInitiative(actorUuid) {
    const actor = actorUuid ? await fromUuid(actorUuid) : null;
    if (!actor) return 0;
    const formula = CONFIG.Combat.initiative?.formula
        ?? "@characteristics.i.value + @characteristics.ag.value/100";
    const roll = new Roll(formula, actor.getRollData());
    await roll.evaluate();
    return roll.total;
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
    const distInput = card?.querySelector(".start-distance-input");
    const envSelect = card?.querySelector(".pursuit-environment-select");
    const content   = await renderComplexSetupContent({
        pursuitType:    data.pursuitType,
        quarry:         newQuarry,
        pursuers:       pursuersWithOverrides,
        distance:       distInput ? (parseInt(distInput.value) || 2) : (data.distance ?? 2),
        escapeDistance: envSelect ? (parseInt(envSelect.value) || 7) : (data.escapeDistance ?? 7),
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
    const distInput   = card?.querySelector(".start-distance-input");
    const envSelect   = card?.querySelector(".pursuit-environment-select");
    const content     = await renderComplexSetupContent({
        pursuitType:    data.pursuitType,
        quarry:         quarryWithOverrides,
        pursuers:       newPursuers,
        distance:       distInput ? (parseInt(distInput.value) || 2) : (data.distance ?? 2),
        escapeDistance: envSelect ? (parseInt(envSelect.value) || 7) : (data.escapeDistance ?? 7),
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

    const distInput = card?.querySelector(".start-distance-input");
    const envSelect = card?.querySelector(".pursuit-environment-select");
    const content = await renderComplexSetupContent({
        pursuitType:    data.pursuitType,
        quarry:         newQuarry,
        pursuers:       newPursuers,
        distance:       distInput ? (parseInt(distInput.value) || 2) : (data.distance ?? 2),
        escapeDistance: envSelect ? (parseInt(envSelect.value) || 7) : (data.escapeDistance ?? 7),
    });
    await updateMessage(message.id, {
        content,
        "flags.wfrp4e-pursuits.quarry":   newQuarry,
        "flags.wfrp4e-pursuits.pursuers": newPursuers,
    });
}

export async function _onRollInitiative(message, ev, target) {
    const { uuid: tokenUuid, actorUuid } = target.dataset;
    const actor = actorUuid ? await fromUuid(actorUuid) : null;
    if (!game.user.isGM && !actor?.isOwner) {
        ui.notifications.warn(game.i18n.localize("PURSUITS.NotYourTurn"));
        return;
    }
    const data = message.flags?.["wfrp4e-pursuits"] ?? {};
    const card = target.closest(".pursuit-card");

    const initiativeValue = await _rollParticipantInitiative(actorUuid);

    const overrides   = _readParticipantOverrides(card);
    const updateGroup = group => group.map(p => ({
        ...p,
        ...overrides[p.tokenUuid],
        ...(p.tokenUuid === tokenUuid ? { initiative: initiativeValue } : {}),
    }));
    const newQuarry   = updateGroup(data.quarry   ?? []);
    const newPursuers = updateGroup(data.pursuers ?? []);
    const distInput = card?.querySelector(".start-distance-input");
    const envSelect = card?.querySelector(".pursuit-environment-select");
    const content = await renderComplexSetupContent({
        pursuitType:    data.pursuitType,
        quarry:         newQuarry,
        pursuers:       newPursuers,
        distance:       distInput ? (parseInt(distInput.value) || 2) : (data.distance ?? 2),
        escapeDistance: envSelect ? (parseInt(envSelect.value) || 7) : (data.escapeDistance ?? 7),
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
    const envSelect = card?.querySelector(".pursuit-environment-select");
    const overrides = _readParticipantOverrides(card);

    const startDistance  = distInput ? (parseInt(distInput.value) || 2) : (data.distance ?? 2);
    const escapeDistance = envSelect ? (parseInt(envSelect.value) || 7) : (data.escapeDistance ?? 7);

    const applyOverrides = participants => participants.map(p => {
        const o          = overrides[p.tokenUuid] ?? {};
        const skill      = o.skill ?? p.skill ?? "Athletics";
        const moveRating = o.moveRating ?? p.moveRating ?? null;
        const move       = (moveRating && (skill === "Ride" || skill === "Drive")) ? moveRating : p.move;
        return { ...p, skill, moveRating, move };
    });

    const ensureInitiative = async p =>
        p.initiative != null ? p : { ...p, initiative: await _rollParticipantInitiative(p.actorUuid) };

    let [quarry, pursuers] = await Promise.all([
        Promise.all(applyOverrides(data.quarry   ?? []).map(ensureInitiative)),
        Promise.all(applyOverrides(data.pursuers ?? []).map(ensureInitiative)),
    ]);
    const seedFresh = p => ({
        ...p,
        actionsTaken:         0,
        lastSl:               null,
        lastActionType:       null,
        lastActionMessageIds: [],
        pronedThisAction:     false,
    });
    quarry   = quarry  .map(q => seedFresh({ ...q, position: startDistance }));
    pursuers = pursuers.map(p => seedFresh({ ...p, position: 0 }));

    const content = await renderComplexRoundContent({
        pursuitType: data.pursuitType,
        distance:    startDistance,
        escapeDistance,
        quarry,
        pursuers,
        roundLog:    [],
        caughtPending: [],
    });

    await message.update({
        content,
        "flags.wfrp4e-pursuits.state":          "active",
        "flags.wfrp4e-pursuits.distance":       startDistance,
        "flags.wfrp4e-pursuits.escapeDistance": escapeDistance,
        "flags.wfrp4e-pursuits.quarry":         quarry,
        "flags.wfrp4e-pursuits.pursuers":       pursuers,
        "flags.wfrp4e-pursuits.caughtPending":  [],
        "flags.wfrp4e-pursuits.ignoredPairs":   [],
        "flags.wfrp4e-pursuits.roundLog":       [],
    });
}
