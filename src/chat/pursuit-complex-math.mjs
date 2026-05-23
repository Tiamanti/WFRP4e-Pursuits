import { deleteMessages } from "./pursuit-shared.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Turn order
// ─────────────────────────────────────────────────────────────────────────────

export function _compareTurnOrder(a, b) {
    if ((a.actionsTaken ?? 0) !== (b.actionsTaken ?? 0)) return (a.actionsTaken ?? 0) - (b.actionsTaken ?? 0);
    if ((b.initiative ?? 0) !== (a.initiative ?? 0))   return (b.initiative ?? 0)   - (a.initiative ?? 0);
    return (a.joinOrder ?? 0) - (b.joinOrder ?? 0);
}

/**
 * Returns true iff `tokenUuid` is the first-by-turn-order participant whose
 * action would be a fresh action (i.e. they haven't yet completed an action
 * at the current `actionsTaken` level). With the lockout invariant, the
 * pending actor (lastActionType !== null) is excluded from "next to act".
 */
export function _isActiveComplexTurn(data, tokenUuid) {
    const caughtPendingUuids = new Set((data.caughtPending ?? []).map(q => q.tokenUuid));
    const sorted = [
        ...(data.quarry   ?? []),
        ...(data.pursuers ?? []),
    ]
        .filter(p => !caughtPendingUuids.has(p.tokenUuid))
        .sort(_compareTurnOrder);
    return sorted[0]?.tokenUuid === tokenUuid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

export function _getMovePenalty(move) {
    if (move === 3) return "(+0)";
    if (move === 2) return "(-20)";
    if (move === 1) return "(-30)";
    return null;
}

export function _pursuerStatusText(pursuer, quarry, ignoredPairs = []) {
    const ignoredQuarryUuids = new Set(
        (ignoredPairs ?? [])
            .filter(pair => pair.pursuerTokenUuid === pursuer.tokenUuid)
            .map(pair => pair.quarryTokenUuid)
    );
    const relevantQuarry = (quarry ?? []).filter(q => !ignoredQuarryUuids.has(q.tokenUuid));
    if (!relevantQuarry.length) return game.i18n.localize("PURSUITS.NoActiveQuarry");
    const closestPos = Math.min(...relevantQuarry.map(q => q.position ?? 0));
    const dist       = closestPos - (pursuer.position ?? 0);
    return dist <= 0
        ? game.i18n.localize("PURSUITS.HasCaughtUp")
        : game.i18n.format("PURSUITS.BehindQuarry", { distance: dist });
}

// ─────────────────────────────────────────────────────────────────────────────
// Position math (Character Progress Table)
// ─────────────────────────────────────────────────────────────────────────────

export function _complexDistanceMoved(sl, move) {
    const runYards = move * 4;
    const base     = Math.max(1, Math.floor(runYards / 10));
    if (sl >= 4)  return base + 1;
    // sl >= 0 is insufficient: Number("-0") === -0, and -0 >= 0 is true in JS.
    if (sl > 0 || (sl === 0 && !Object.is(sl, -0)))  return base;
    if (sl >= -2) return Math.max(0, base - 1);
    return 0; // -3 to -4: halts; -5+: falls
}

export function _applyPositionDelta(participants, tokenUuid, newSl, prevSl) {
    return participants.map(p => {
        if (p.tokenUuid !== tokenUuid) return p;
        const prevDist = prevSl !== null && prevSl !== undefined ? _complexDistanceMoved(prevSl, p.move) : 0;
        const newDist  = _complexDistanceMoved(newSl, p.move);
        return { ...p, position: (p.position ?? 0) + newDist - prevDist };
    });
}

export function _matchPursuerToQuarry(quarryMember, pursuers, ignoredPairs = []) {
    const ignoredUuids = new Set(
        ignoredPairs.filter(pair => pair.quarryTokenUuid === quarryMember.tokenUuid).map(pair => pair.pursuerTokenUuid)
    );
    const candidates = pursuers.filter(p => p.position >= quarryMember.position && !ignoredUuids.has(p.tokenUuid));
    if (!candidates.length) return null;
    return candidates.reduce((a, b) => b.position < a.position ? b : a);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending-action state helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete the participant's pending action chat messages and return a copy of
 * the participant with `lastSl`, `lastActionType`, `lastActionMessageIds`
 * cleared. Used by applyComplexAction, onExcludePair, and onEndPursuit.
 */
export function _finalizePendingAction(participant) {
    if (!participant) return participant;
    deleteMessages(participant.lastActionMessageIds ?? []);
    return {
        ...participant,
        lastSl:               null,
        lastActionType:       null,
        lastActionMessageIds: [],
    };
}
