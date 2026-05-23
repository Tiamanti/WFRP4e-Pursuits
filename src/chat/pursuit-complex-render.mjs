import { _compareTurnOrder, _getMovePenalty, _pursuerStatusText } from "./pursuit-complex-math.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Obstacle perception helpers
// ─────────────────────────────────────────────────────────────────────────────

export function _isPerceptionPending(tokenUuid, obstacles) {
    if (!tokenUuid) return false;
    return (obstacles ?? []).some(obs =>
        !obs.perceivedBy.includes(tokenUuid)
        && !obs.navigatedBy.includes(tokenUuid)
        && !(obs.perceptionTests ?? []).some(t => t.tokenUuid === tokenUuid)
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────────

export async function renderComplexRoundContent({
    pursuitType, distance, escapeDistance,
    quarry = [], pursuers = [],
    roundLog = [], pursuitSkill = "Athletics",
    ignoredPairs = [], caughtPending = [],
    obstacles = [],
    escaped: escapedOverride = null, caught: caughtOverride = null,
}) {
    const caughtPendingUuids = new Set((caughtPending ?? []).map(q => q.tokenUuid));

    // Compute the active-turn participant via the continuous sort:
    //   (actionsTaken asc, initiative desc, joinOrder asc), excluding caughtPending quarry.
    const allParticipants = [...quarry, ...pursuers];
    const sortedForTurn   = allParticipants
        .filter(p => !caughtPendingUuids.has(p.tokenUuid))
        .sort(_compareTurnOrder);
    const activeParticipant = sortedForTurn[0] ?? null;
    const activeTokenUuid   = activeParticipant?.tokenUuid ?? null;

    // Condition fetch — active-turn only (drops O(N) actor lookups to O(1)).
    let activeIsProne = false;
    let activeIsEntangled = false;
    if (activeParticipant?.actorUuid) {
        const actor = await fromUuid(activeParticipant.actorUuid);
        activeIsProne     = !!(actor?.hasCondition?.("prone"));
        activeIsEntangled = !!(actor?.hasCondition?.("entangled"));
    }

    const activeIsPerceptionPending  = _isPerceptionPending(activeTokenUuid, obstacles);
    const activeEntangledThreshold   = activeIsEntangled
        ? (activeParticipant?.entangledThreshold ?? 30)
        : 30;

    const maxPursuerPos = pursuers.length ? Math.max(...pursuers.map(p => p.position ?? 0)) : 0;
    const minQuarryPos  = quarry.length   ? Math.min(...quarry.map(q => q.position ?? 0))  : 0;

    const enrichQuarry = q => {
        const gap = (q.position ?? 0) - maxPursuerPos;
        const distToEscape = Math.max(0, escapeDistance - gap);
        const isActive = q.tokenUuid === activeTokenUuid;
        return {
            ...q,
            isQuarry:             true,
            isPursuer:            false,
            moveBonus:            0,
            movePenalty:          _getMovePenalty(q.move),
            statusText:           game.i18n.format("PURSUITS.NeedsToEscape", { distance: distToEscape }),
            sl:                   q.lastSl ?? null,
            hasResult:            q.lastSl !== null && q.lastSl !== undefined,
            isProne:              isActive ? activeIsProne              : false,
            isEntangled:          isActive ? activeIsEntangled          : false,
            entangledThreshold:   isActive ? activeEntangledThreshold   : 30,
            isPerceptionPending:  isActive ? activeIsPerceptionPending  : false,
            skipsRoll:            q.lastActionType === "skip",
            isCaughtPending:      caughtPendingUuids.has(q.tokenUuid),
        };
    };
    const enrichPursuer = p => {
        const isActive = p.tokenUuid === activeTokenUuid;
        return {
            ...p,
            isQuarry:             false,
            isPursuer:            true,
            moveBonus:            0,
            movePenalty:          _getMovePenalty(p.move),
            statusText:           _pursuerStatusText(p, quarry, ignoredPairs),
            sl:                   p.lastSl ?? null,
            hasResult:            p.lastSl !== null && p.lastSl !== undefined,
            isProne:              isActive ? activeIsProne              : false,
            isEntangled:          isActive ? activeIsEntangled          : false,
            entangledThreshold:   isActive ? activeEntangledThreshold   : 30,
            isPerceptionPending:  isActive ? activeIsPerceptionPending  : false,
            skipsRoll:            p.lastActionType === "skip",
            isCaughtPending:      false,
        };
    };

    const quarryRows   = quarry.map(enrichQuarry);
    const pursuerRows  = pursuers.map(enrichPursuer);
    const combinedRows = [...quarryRows, ...pursuerRows].sort(_compareTurnOrder);
    combinedRows.forEach((row, i) => {
        row.initiativeOrder = i + 1;
        row.isActiveTurn    = row.tokenUuid === activeTokenUuid;
    });
    quarryRows.sort(_compareTurnOrder);
    pursuerRows.sort(_compareTurnOrder);

    // "Round N" header = the round the about-to-act participant is on.
    const displayRound = (activeParticipant?.actionsTaken ?? 0) + 1;

    const roundLogGroups = _groupRoundLog(roundLog);

    const positionDiagram = _buildPositionDiagram(
        quarry, pursuers, caughtPending, escapeDistance, activeTokenUuid, obstacles
    );

    const caught  = caughtOverride  !== null ? caughtOverride  : (distance <= 0);
    const escaped = escapedOverride !== null ? escapedOverride : ((minQuarryPos - maxPursuerPos) >= escapeDistance);

    return foundry.applications.handlebars.renderTemplate(
        "modules/wfrp4e-pursuits/templates/chat/pursuit-round-complex.hbs",
        {
            pursuitType, isSimple: false, isComplex: true,
            round: displayRound, distance, escapeDistance,
            combined: combinedRows,
            quarry:   quarryRows,
            pursuers: pursuerRows,
            caught,
            escaped,
            outcome: caught || escaped,
            roundLog: roundLogGroups,
            pursuitSkill,
            positionDiagram,
            obstacles,
            isGM: game.user.isGM,
        }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Position diagram
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the SVG-ready position diagram data. Pure layout math — sorts active
 * participants by position ascending (pursuers behind → quarry ahead), computes
 * x-coordinates with even spacing, derives the dashed escape marker length from
 * `escapeDistance - (minQuarryPos - maxPursuerPos)`. Returns null when there are
 * no participants. Obstacles are interleaved as `role: "obstacle"` nodes.
 */
export function _buildPositionDiagram(quarry, pursuers, caughtPending, escapeDistance, activeTokenUuid, obstacles = []) {
    const ESCAPE_UNIT = 12;  // px per remaining-distance unit

    const quarryUuids        = new Set(quarry.map(q => q.tokenUuid));
    const caughtPendingUuids = new Set((caughtPending ?? []).map(q => q.tokenUuid));

    const participantEntries = [...quarry, ...pursuers].map(p => ({
        tokenUuid:       p.tokenUuid,
        name:            p.name,
        role:            quarryUuids.has(p.tokenUuid) ? "quarry" : "pursuer",
        actionsTaken:    p.actionsTaken ?? 0,
        position:        p.position ?? 0,
        isActive:        p.tokenUuid === activeTokenUuid,
        isCaughtPending: caughtPendingUuids.has(p.tokenUuid),
        isObstacle:      false,
    }));

    if (participantEntries.length === 0) return null;

    const obstacleEntries = (obstacles ?? []).map(obs => ({
        id:              obs.id,
        name:            obs.name,
        role:            "obstacle",
        position:        obs.position,
        actionsTaken:    0,
        isActive:        false,
        isCaughtPending: false,
        isObstacle:      true,
    }));

    const allEntries = [...participantEntries, ...obstacleEntries]
        .sort((a, b) => a.position - b.position);

    const nodes = allEntries.map((entry, i) => ({
        ...entry,
        gapBefore: i === 0 ? null : allEntries[i].position - allEntries[i - 1].position,
    }));

    const gapLabels = [];
    for (let i = 1; i < allEntries.length; i++) {
        gapLabels.push({ value: allEntries[i].position - allEntries[i - 1].position });
    }

    const maxPursuerPos   = pursuers.length ? Math.max(...pursuers.map(p => p.position ?? 0)) : 0;
    const minQuarryPos    = quarry.length   ? Math.min(...quarry.map(q => q.position ?? 0))  : 0;
    const currentGap      = Math.max(0, minQuarryPos - maxPursuerPos);
    const escapeRemaining = Math.max(0, escapeDistance - currentGap);

    let escapeMarker = null;
    if (escapeRemaining > 0) {
        escapeMarker = {
            value: escapeRemaining,
            width: escapeRemaining * ESCAPE_UNIT,
        };
    }

    return { nodes, gapLabels, escapeMarker, escapeRemaining };
}

// ─────────────────────────────────────────────────────────────────────────────
// Round-log grouping
// ─────────────────────────────────────────────────────────────────────────────

function _groupRoundLog(roundLog) {
    if (!Array.isArray(roundLog) || roundLog.length === 0) return [];
    const byRound = new Map();
    for (const entry of roundLog) {
        const round = entry.actionNumber ?? 0;
        if (!byRound.has(round)) byRound.set(round, []);
        byRound.get(round).push(entry);
    }
    return [...byRound.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([round, entries]) => {
            const first = entries[0];
            const last  = entries[entries.length - 1];
            const prevDistance = first?.distanceBefore ?? 0;
            const newDistance  = last?.distanceAfter  ?? prevDistance;
            const change       = newDistance - prevDistance;
            return {
                round,
                prevDistance, newDistance,
                distanceChangeStr: change >= 0 ? `+${change}` : String(change),
                quarry:   entries.filter(e => e.isQuarry),
                pursuers: entries.filter(e => !e.isQuarry),
            };
        });
}
