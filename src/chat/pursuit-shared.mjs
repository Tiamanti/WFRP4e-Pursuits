export const REROLL_SOCKET = "module.wfrp4e-pursuits";

export async function updateMessage(id, updateData) {
    if (game.user.isGM) {
        await game.messages.get(id)?.update(updateData);
    } else {
        await warhammer.apps.SocketHandlers.call("updateMessage", { id, updateData }, "GM");
    }
}

export function deleteMessages(ids) {
    if (!ids?.length) return;
    if (game.user.isGM) {
        for (const id of ids) game.messages.get(id)?.delete();
    } else {
        game.socket.emit(REROLL_SOCKET, { action: "deleteMessages", ids });
    }
}

export function _getSelectedTokens() {
    const controlled = canvas.tokens.controlled;
    const targeted   = Array.from(game.user.targets).filter(t => !controlled.includes(t));
    return [...controlled, ...targeted];
}

export function _tokensToParticipants(tokens) {
    return tokens.map(t => ({
        name:                 t.document.name,
        tokenUuid:            t.document.uuid,
        actorUuid:            t.actor?.uuid ?? "",
        move:                 t.actor?.system?.details?.move?.value ?? 4,
        skill:                "Athletics",
        moveRating:           null,
        // Continuous-turn state fields. Stamped at join time; advanced by
        // applyComplexAction in the round flow.
        actionsTaken:         0,
        lastSl:               null,
        lastActionType:       null,
        lastActionMessageIds: [],
        pronedThisAction:     false,
    }));
}

/**
 * Merge incoming tokens onto an existing list, dedup by tokenUuid, and stamp
 * monotonic `joinOrder` on newly-added participants. Existing participants
 * keep their joinOrder so initiative ties are stable across re-renders.
 */
export function _mergeParticipants(existing, incoming) {
    const existingUuids = new Set(existing.map(p => p.tokenUuid));
    let nextJoinOrder = Math.max(0, ...existing.map(p => p.joinOrder ?? 0)) + 1;
    const stampedIncoming = incoming
        .filter(p => !existingUuids.has(p.tokenUuid))
        .map(p => ({ ...p, joinOrder: nextJoinOrder++ }));
    return [...existing, ...stampedIncoming];
}

export function _readParticipantOverrides(card) {
    const overrides = {};
    for (const li of card?.querySelectorAll(".participant[data-uuid]") ?? []) {
        const uuid       = li.dataset.uuid;
        const skill      = li.querySelector(".participant-skill-select")?.value ?? "Athletics";
        const ratingVal  = li.querySelector(".participant-move-rating")?.value;
        const moveRating = ratingVal ? (parseInt(ratingVal) || null) : null;
        overrides[uuid]  = { skill, moveRating };
    }
    return overrides;
}
