import { updateMessage } from "./pursuit-shared.mjs";

export async function renderSimpleRoundContent({
    pursuitType, round, distance, escapeDistance,
    quarry = [], pursuers = [],
    roundLog = [], pursuitSkill = "Athletics",
    slResults = [], skippedUuids = [],
    escaped: escapedOverride = null, caught: caughtOverride = null,
}) {
    const minQuarryMove  = quarry.length   ? Math.min(...quarry.map(q => q.move))   : 4;
    const minPursuerMove = pursuers.length ? Math.min(...pursuers.map(p => p.move)) : 4;
    const slArray = Array.isArray(slResults) ? slResults : [];

    const quarryWithBonus = await Promise.all(quarry.map(async q => {
        const actor = q.actorUuid ? await fromUuid(q.actorUuid) : null;
        return {
            ...q,
            moveBonus:   Math.max(0, q.move - minPursuerMove),
            movePenalty: null,
            statusText:  null,
            sl:          slArray.find(r => r.tokenUuid === q.tokenUuid)?.sl ?? null,
            hasResult:   slArray.some(r => r.tokenUuid === q.tokenUuid),
            isProne:     !!(actor?.hasCondition?.("prone")),
            isEntangled: !!(actor?.hasCondition?.("entangled")),
            skipsRoll:   skippedUuids.includes(q.tokenUuid),
        };
    }));
    const pursuersWithBonus = await Promise.all(pursuers.map(async p => {
        const actor = p.actorUuid ? await fromUuid(p.actorUuid) : null;
        return {
            ...p,
            moveBonus:   Math.max(0, p.move - minQuarryMove),
            movePenalty: null,
            statusText:  null,
            sl:          slArray.find(r => r.tokenUuid === p.tokenUuid)?.sl ?? null,
            hasResult:   slArray.some(r => r.tokenUuid === p.tokenUuid),
            isProne:     !!(actor?.hasCondition?.("prone")),
            isEntangled: !!(actor?.hasCondition?.("entangled")),
            skipsRoll:   skippedUuids.includes(p.tokenUuid),
        };
    }));

    const caught  = caughtOverride  !== null ? caughtOverride  : (distance <= 0);
    const escaped = escapedOverride !== null ? escapedOverride : (distance >= escapeDistance);
    const pct     = Math.min(100, Math.max(0, (distance / escapeDistance) * 100));
    const distanceClass = pct >= 70 ? "distance-high" : pct >= 30 ? "distance-mid" : "distance-low";
    const canResolve = _simpleRoundResolvable(quarryWithBonus, pursuersWithBonus);

    return foundry.applications.handlebars.renderTemplate(
        "modules/wfrp4e-pursuits/templates/chat/pursuit-round.hbs",
        {
            pursuitType, isSimple: true, isComplex: false,
            round, distance, escapeDistance,
            distancePct:  pct,
            distanceClass,
            quarry:       quarryWithBonus,
            pursuers:     pursuersWithBonus,
            caught,
            escaped,
            outcome:      caught || escaped,
            canResolve,
            roundLog,
            pursuitSkill,
        }
    );
}

export function _simpleRoundResolvable(quarry, pursuers) {
    const all = [...quarry, ...pursuers];
    if (!all.length) return false;
    return all.every(p => p.hasResult || p.skipsRoll);
}

export function _simpleResolutionDelta({ quarry, pursuers, slResults, distance, escapeDistance }) {
    const slArray        = Array.isArray(slResults) ? slResults : [];
    const slByUuid       = Object.fromEntries(slArray.map(r => [r.tokenUuid, r.sl]));
    const minQuarryMove  = quarry.length   ? Math.min(...quarry.map(q => q.move))   : 4;
    const minPursuerMove = pursuers.length ? Math.min(...pursuers.map(p => p.move)) : 4;
    const effectiveQuarrySLs  = quarry.map(q => (slByUuid[q.tokenUuid] ?? 0) + Math.max(0, q.move - minPursuerMove));
    const effectivePursuerSLs = pursuers.map(p => (slByUuid[p.tokenUuid] ?? 0) + Math.max(0, p.move - minQuarryMove));
    const quarryBest  = effectiveQuarrySLs.length  ? Math.min(...effectiveQuarrySLs)  : 0;
    const pursuerBest = effectivePursuerSLs.length ? Math.max(...effectivePursuerSLs) : 0;
    const newDistance = Math.max(0, Math.min(escapeDistance, distance + (quarryBest - pursuerBest)));
    return { newDistance, effectiveQuarrySLs, effectivePursuerSLs, slByUuid, minQuarryMove, minPursuerMove };
}

export async function resolveSimpleRound(message, data) {
    const slArray        = Array.isArray(data.slResults) ? data.slResults : [];
    const quarry         = data.quarry        ?? [];
    const pursuers       = data.pursuers      ?? [];
    const distance       = data.distance      ?? 5;
    const escapeDistance = data.escapeDistance ?? 10;
    const round          = data.round         ?? 1;
    const newRound       = round + 1;

    const { newDistance, effectiveQuarrySLs, effectivePursuerSLs, slByUuid, minQuarryMove, minPursuerMove } =
        _simpleResolutionDelta({ quarry, pursuers, slResults: slArray, distance, escapeDistance });

    const multiQuarryCatch  = newDistance <= 0 && quarry.length > 1;
    const isComplete        = (newDistance <= 0 && quarry.length <= 1) || newDistance >= escapeDistance;

    const distanceChange = newDistance - distance;
    const logEntry = {
        round,
        isComplex:         false,
        prevDistance:      distance,
        newDistance,
        distanceChangeStr: distanceChange >= 0 ? `+${distanceChange}` : String(distanceChange),
        quarry: quarry.map((q, i) => ({
            name:        q.name,
            sl:          slByUuid[q.tokenUuid] ?? 0,
            moveBonus:   Math.max(0, q.move - minPursuerMove),
            effectiveSl: effectiveQuarrySLs[i],
        })),
        pursuers: pursuers.map((p, i) => ({
            name:        p.name,
            sl:          slByUuid[p.tokenUuid] ?? 0,
            moveBonus:   Math.max(0, p.move - minQuarryMove),
            effectiveSl: effectivePursuerSLs[i],
        })),
    };
    const newRoundLog = [...(data.roundLog ?? []), logEntry];

    const content = await renderSimpleRoundContent({
        pursuitType:    data.pursuitType,
        round:          newRound,
        distance:       newDistance,
        escapeDistance,
        quarry,
        pursuers,
        roundLog:       newRoundLog,
        pursuitSkill:   data.pursuitSkill ?? "Athletics",
        slResults:      [],
        caught:         multiQuarryCatch ? false : undefined,
    });

    const updateData = {
        content,
        "flags.wfrp4e-pursuits.distance":             newDistance,
        "flags.wfrp4e-pursuits.round":                newRound,
        "flags.wfrp4e-pursuits.roundLog":             newRoundLog,
        "flags.wfrp4e-pursuits.slResults":            [],
        "flags.wfrp4e-pursuits.skippedUuids":         [],
        "flags.wfrp4e-pursuits.simpleCatchupPending": multiQuarryCatch,
    };
    if (isComplete) updateData["flags.wfrp4e-pursuits.state"] = "complete";
    await message.update(updateData);

    const rollMessageIds = (data.slResults ?? []).flatMap(r => r.messageIds ?? []).filter(Boolean);
    for (const id of rollMessageIds) {
        game.messages.get(id)?.delete();
    }

    if (multiQuarryCatch) {
        await _postSimpleCatchupMessage(message.id, {
            quarry, pursuers,
            slResults: slArray,
            distance, escapeDistance,
        });
    }
}

export async function _postSimpleCatchupMessage(pursuitMessageId, { quarry, pursuers, slResults, distance, escapeDistance }) {
    const candidates = quarry.map(q => {
        const remainingQuarry = quarry.filter(other => other.tokenUuid !== q.tokenUuid);
        const remainingSL     = (slResults ?? []).filter(r => r.tokenUuid !== q.tokenUuid);
        const recalc          = _simpleResolutionDelta({
            quarry: remainingQuarry, pursuers,
            slResults: remainingSL,
            distance, escapeDistance,
        });
        return {
            tokenUuid:   q.tokenUuid,
            name:        q.name,
            newDistance: Math.max(1, recalc.newDistance),
        };
    });

    const html = await foundry.applications.handlebars.renderTemplate(
        "modules/wfrp4e-pursuits/templates/chat/pursuit-simple-catchup.hbs",
        { candidates }
    );
    await ChatMessage.create({
        content: html,
        flags: {
            "wfrp4e-pursuits": {
                pursuitType: "simple",
                type:        "simpleCatchup",
                pursuitMessageId,
                candidates,
            },
        },
    });
}
