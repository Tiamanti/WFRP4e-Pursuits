import { updateMessage, deleteMessages } from "./pursuit-shared.mjs";
import { renderComplexRoundContent, _isPerceptionPending } from "./pursuit-complex-render.mjs";
import {
    _complexDistanceMoved, _matchPursuerToQuarry,
    _isActiveComplexTurn, _finalizePendingAction,
} from "./pursuit-complex-math.mjs";
import { postCatchMessage, postEscapeMessage, postLeftBehindMessage } from "./pursuit-complex-catch.mjs";
import { OBSTACLE_TABLE } from "../static/obstacles.mjs";

// Re-export everything tests and message-complex currently import from here.
export {
    _isActiveComplexTurn, _complexDistanceMoved, _applyPositionDelta,
    _matchPursuerToQuarry, _pursuerStatusText, _finalizePendingAction,
} from "./pursuit-complex-math.mjs";
export { _buildPositionDiagram, _isPerceptionPending, renderComplexRoundContent } from "./pursuit-complex-render.mjs";
export { onExcludePair, onIgnoreQuarry, onEndPursuit, postCatchMessage } from "./pursuit-complex-catch.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Obstacle navigation
// ─────────────────────────────────────────────────────────────────────────────

async function _handleObstacleNavigation(actor, obstacle, perceived) {
    const skill = perceived
        ? (obstacle.navigateSkill ?? "Athletics")
        : (obstacle.navigateSkillUnperceived ?? obstacle.navigateSkill ?? "Athletics");
    const difficulty = perceived
        ? (obstacle.navigateDifficulty ?? "average")
        : (obstacle.navigateDifficultyUnperceived ?? obstacle.navigateDifficulty ?? "average");
    const test = await actor.setupSkill(skill, { appendTitle: " - Navigate Obstacle", skipTargets: true, fields: { difficulty } });
    if (!test) return { passed: false };
    await test.roll();
    const sl = Number(test.result?.SL ?? 0);
    // sl >= 0 is insufficient: Number("-0") === -0, and -0 >= 0 is true in JS.
    // A marginal fail (roll > skill, same tens bracket) produces SL="-0" which must be a fail.
    const passed = sl > 0 || (sl === 0 && !Object.is(sl, -0));
    return { passed, sl };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending-actor scan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the unique other participant with pending state (`lastActionType !== null`).
 * Lockout invariant guarantees zero or one match — caller should assert.
 */
function _findPendingActor(quarry, pursuers, excludeUuid) {
    const all = [...(quarry ?? []), ...(pursuers ?? [])];
    const pending = all.filter(p =>
        p.tokenUuid !== excludeUuid
        && p.lastActionType !== null
        && p.lastActionType !== undefined
    );
    if (pending.length > 1) {
        console.warn(
            `[wfrp4e-pursuits] lockout invariant broken: ${pending.length} participants have pending action; expected ≤1`
        );
    }
    return pending[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified action handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {ChatMessage} message
 * @param {object} liveData  - fresh `flags["wfrp4e-pursuits"]` from the pursuit message
 * @param {string} tokenUuid - the actor performing the action
 * @param {{sl?: number, messageId?: string|null, isReroll?: boolean, isSkip?: boolean}} opts
 */
export async function applyComplexAction(message, liveData, tokenUuid, opts = {}) {
    const { sl, messageId = null, isReroll = false, isSkip = false, extraParticipantFields: callerParticipantFields = {} } = opts;

    const quarryIn   = liveData.quarry   ?? [];
    const pursuersIn = liveData.pursuers ?? [];
    const participant = [...quarryIn, ...pursuersIn].find(p => p.tokenUuid === tokenUuid);
    if (!participant) return;
    const isQuarry = quarryIn.some(p => p.tokenUuid === tokenUuid);

    // step 1: turn check (fresh actions only; rerolls bypass — they target an already-acted participant).
    if (!isReroll && !_isActiveComplexTurn(liveData, tokenUuid)) {
        ui.notifications.warn(game.i18n.localize("PURSUITS.NotYourTurn"));
        return;
    }

    // step 2: SL inputs. For skips, effective SL is fixed at -3 (the "halts" band in _complexDistanceMoved).
    const prevSl      = isReroll ? participant.lastSl : null;
    const effectiveSl = isSkip ? -3 : Number(sl ?? 0);

    // step 3: prone toggle (covers fresh + reroll). Tracked via pronedThisAction so a reroll
    //         can undo prone we applied this action without disturbing pre-existing conditions.
    //         Fresh actions start with the flag cleared — only the current action's SL governs.
    let pronedThisAction = isReroll ? (participant.pronedThisAction ?? false) : false;
    if (effectiveSl <= -5 && !pronedThisAction) {
        const actor = participant.actorUuid ? await fromUuid(participant.actorUuid) : null;
        await actor?.addCondition?.("prone");
        pronedThisAction = true;
    } else if (isReroll && effectiveSl > -5 && pronedThisAction) {
        const actor = participant.actorUuid ? await fromUuid(participant.actorUuid) : null;
        await actor?.removeCondition?.("prone");
        pronedThisAction = false;
    }

    // step 4: position delta. _complexDistanceMoved(null) is undefined-behavior, so guard with prevSl null check.
    const prevDist = prevSl !== null && prevSl !== undefined ? _complexDistanceMoved(prevSl, participant.move) : 0;
    const newDist  = _complexDistanceMoved(effectiveSl, participant.move);
    const positionDelta = newDist - prevDist;

    let newPos = (participant.position ?? 0) + positionDelta;
    const prevPos = participant.position ?? 0;

    // Obstacle encounter check: has the participant crossed an obstacle they haven't navigated?
    const liveObstacles = structuredClone(liveData.obstacles ?? []);
    let obstacleParticipantFields = {};
    if (liveObstacles.length > 0 && newPos > prevPos) {
        const actor = participant.actorUuid ? await fromUuid(participant.actorUuid) : null;
        for (const obs of liveObstacles) {
            if (obs.navigatedBy.includes(tokenUuid)) continue;
            if (newPos <= obs.position) continue;
            const perceived = obs.perceivedBy.includes(tokenUuid);
            const { passed, sl: navSl } = actor
                ? await _handleObstacleNavigation(actor, obs, perceived)
                : { passed: false, sl: 0 };
            if (!passed) {
                if (obs.blocksProgress) newPos = obs.position;
                const obstacleEntry = OBSTACLE_TABLE.find(e => e.name === obs.name);
                const skillFn = obstacleEntry?.automaticConsequences
                    ? obstacleEntry.consequences?.[obs.navigateSkill]
                    : undefined;
                if (skillFn) {
                    const result = await skillFn(participant.actorUuid, navSl, obstacleEntry, participant.name);
                    if (result?.participantFields) {
                        Object.assign(obstacleParticipantFields, result.participantFields);
                    }
                } else {
                    const failMsg = game.i18n.format("PURSUITS.ObstacleNavFailed", {
                        name:         `<strong>${participant.name}</strong>`,
                        obstacle:     `<strong>${obs.name}</strong>`,
                        consequences: obs.consequencesText,
                    });
                    await ChatMessage.create({ content: `<div class="pursuit-card pursuit-notification"><p>${failMsg}</p></div>` });
                }
                if (!obs.blocksProgress) obs.navigatedBy = [...obs.navigatedBy, tokenUuid];
            } else {
                obs.navigatedBy = [...obs.navigatedBy, tokenUuid];
            }
        }
    }

    // Apply the position update + pronedThisAction to the rolling participant in both arrays.
    const applySelfUpdate = list => list.map(p =>
        p.tokenUuid === tokenUuid
            ? { ...p, position: newPos, pronedThisAction }
            : p
    );
    let updatedQuarry   = applySelfUpdate(quarryIn);
    let updatedPursuers = applySelfUpdate(pursuersIn);

    const existingCaughtPending     = liveData.caughtPending ?? [];
    const existingCaughtPendingUuids = new Set(existingCaughtPending.map(q => q.tokenUuid));

    // step 5: catch recompute. Two branches by actor role.
    let newlyCaught = [];
    let catchAttribution = null;
    if (!isQuarry) {
        // Pursuer acted: did they cross any free quarry's position this action?
        const ignoredQuarryUuids = new Set(
            (liveData.ignoredPairs ?? [])
                .filter(pair => pair.pursuerTokenUuid === tokenUuid)
                .map(pair => pair.quarryTokenUuid)
        );
        const freeQuarry = updatedQuarry.filter(q => !existingCaughtPendingUuids.has(q.tokenUuid));
        newlyCaught = freeQuarry.filter(q => {
            if (ignoredQuarryUuids.has(q.tokenUuid)) return false;
            const qPos = q.position ?? 0;
            return prevPos < qPos && newPos >= qPos;
        });
        catchAttribution = updatedPursuers.find(p => p.tokenUuid === tokenUuid);
    } else {
        // Quarry acted: did they drop at-or-below a pursuer's position?
        if (positionDelta < 0 && !existingCaughtPendingUuids.has(tokenUuid)) {
            const maxPursuerPos = updatedPursuers.length ? Math.max(...updatedPursuers.map(p => p.position ?? 0)) : 0;
            if (prevPos > maxPursuerPos && newPos <= maxPursuerPos) {
                const selfUpdated = updatedQuarry.find(q => q.tokenUuid === tokenUuid);
                if (selfUpdated) {
                    newlyCaught = [selfUpdated];
                    catchAttribution = _matchPursuerToQuarry(selfUpdated, updatedPursuers, liveData.ignoredPairs ?? []);
                }
            }
        }
    }

    // step 6: escape / left-behind recompute.
    const escapeDistance = liveData.escapeDistance ?? 7;
    const maxPursuerPos  = updatedPursuers.length ? Math.max(...updatedPursuers.map(p => p.position ?? 0)) : 0;
    const newlyCaughtUuids = new Set(newlyCaught.map(q => q.tokenUuid));
    const scanForOutcome = updatedQuarry.filter(q =>
        !existingCaughtPendingUuids.has(q.tokenUuid) && !newlyCaughtUuids.has(q.tokenUuid)
    );
    const escapedQuarry    = scanForOutcome.filter(q =>
        (q.position ?? 0) > maxPursuerPos
        && ((q.position ?? 0) - maxPursuerPos) >= escapeDistance
    );
    const leftBehindQuarry = updatedPursuers.length > 0
        ? scanForOutcome.filter(q =>
            !escapedQuarry.some(e => e.tokenUuid === q.tokenUuid)
            && updatedPursuers.every(p => (p.position ?? 0) > (q.position ?? 0))
          )
        : [];

    // step 7: caughtPending rollback — release catches where the pursuer is now behind the quarry.
    const rolledBackUuids = new Set();
    for (const pending of existingCaughtPending) {
        const pinnedPursuer = updatedPursuers.find(p => p.tokenUuid === pending.pursuerTokenUuid);
        const quarryEntry   = updatedQuarry.find(q => q.tokenUuid === pending.tokenUuid);
        if (!pinnedPursuer || !quarryEntry) continue;
        if ((pinnedPursuer.position ?? 0) < (quarryEntry.position ?? 0)) {
            if (pending.catchMessageId) deleteMessages([pending.catchMessageId]);
            rolledBackUuids.add(pending.tokenUuid);
        }
    }

    // step 8: finalize previous pending action (fresh actions only).
    if (!isReroll) {
        const previousActor = _findPendingActor(updatedQuarry, updatedPursuers, tokenUuid);
        if (previousActor) {
            const cleared = _finalizePendingAction(previousActor);
            updatedQuarry   = updatedQuarry  .map(p => p.tokenUuid === previousActor.tokenUuid ? cleared : p);
            updatedPursuers = updatedPursuers.map(p => p.tokenUuid === previousActor.tokenUuid ? cleared : p);
        }
    }

    // Remove escaped / left-behind from active quarry.
    const escapedUuids    = new Set(escapedQuarry.map(q => q.tokenUuid));
    const leftBehindUuids = new Set(leftBehindQuarry.map(q => q.tokenUuid));
    updatedQuarry = updatedQuarry.filter(q => !escapedUuids.has(q.tokenUuid) && !leftBehindUuids.has(q.tokenUuid));

    // step 9: own state update.
    if (!isReroll) {
        const perceptionMsgIds = liveObstacles.flatMap(obs =>
            (obs.perceptionTests ?? []).find(t => t.tokenUuid === tokenUuid)?.messageIds ?? []
        );
        if (perceptionMsgIds.length > 0) deleteMessages(perceptionMsgIds);
    }
    const mergedExtraFields = { ...obstacleParticipantFields, ...callerParticipantFields };
    const newOwnFields = isReroll
        ? {
            lastSl:               effectiveSl,
            lastActionMessageIds: [...(participant.lastActionMessageIds ?? []), ...(messageId ? [messageId] : [])],
            ...mergedExtraFields,
          }
        : {
            lastSl:               effectiveSl,
            lastActionType:       isSkip ? "skip" : "roll",
            lastActionMessageIds: messageId ? [messageId] : [],
            actionsTaken:         (participant.actionsTaken ?? 0) + 1,
            ...mergedExtraFields,
          };
    const applyOwnUpdate = list => list.map(p =>
        p.tokenUuid === tokenUuid
            ? { ...p, ...newOwnFields, pronedThisAction }
            : p
    );
    updatedQuarry   = applyOwnUpdate(updatedQuarry);
    updatedPursuers = applyOwnUpdate(updatedPursuers);

    // Recompute distance (gap from leading pursuer to nearest free quarry).
    const remainingCaughtPending = existingCaughtPending.filter(p => !rolledBackUuids.has(p.tokenUuid));
    const allInactiveUuids = new Set([
        ...remainingCaughtPending.map(q => q.tokenUuid),
        ...newlyCaught.map(q => q.tokenUuid),
    ]);
    const freeForDistance = updatedQuarry.filter(q => !allInactiveUuids.has(q.tokenUuid));
    const newDistance     = freeForDistance.length
        ? Math.max(0, Math.min(...freeForDistance.map(q => q.position ?? 0)) - maxPursuerPos)
        : 0;

    // Mirror today's needsDialog rule.
    const needsDialog = freeForDistance.length > 0
        || newlyCaught.length > 1
        || remainingCaughtPending.length > 0;

    // Post catch chat messages and capture message ids for rollback.
    const newCaughtPending = [];
    if (catchAttribution) {
        for (const caughtQ of newlyCaught) {
            if (needsDialog) {
                const catchMessageId = await postCatchMessage(
                    message.id, caughtQ, catchAttribution, updatedPursuers.length
                );
                newCaughtPending.push({
                    ...caughtQ,
                    pursuerTokenUuid: catchAttribution.tokenUuid,
                    pursuerName:      catchAttribution.name,
                    catchMessageId,
                });
            } else {
                await ChatMessage.create({
                    content: `<div class="pursuit-card pursuit-notification"><p><strong>${caughtQ.name}</strong> ${game.i18n.localize("PURSUITS.WasCaughtBy")} <strong>${catchAttribution.name}</strong>.</p></div>`,
                });
            }
        }
    }

    const allCaughtPending = [...remainingCaughtPending, ...newCaughtPending];

    // Escape / left-behind narration messages.
    for (const q of escapedQuarry)    await postEscapeMessage(q);
    for (const q of leftBehindQuarry) await postLeftBehindMessage(q);

    // Prune ignoredPairs whose quarry left the pursuit.
    const remainingQuarryUuids = new Set(updatedQuarry.map(q => q.tokenUuid));
    const cleanedIgnoredPairs  = (liveData.ignoredPairs ?? []).filter(pair =>
        remainingQuarryUuids.has(pair.quarryTokenUuid)
    );

    // step 10: round-log upsert.
    const actionNumber = newOwnFields.actionsTaken ?? participant.actionsTaken ?? 1;
    const distanceBefore = liveData.distance ?? 0;
    const newLogEntry = {
        tokenUuid,
        name:           participant.name,
        isQuarry,
        action:         isReroll ? "reroll" : (isSkip ? "skip" : "roll"),
        sl:             effectiveSl,
        distMoved:      newDist,
        newPosition:    newPos,
        fell:           effectiveSl <= -5,
        actionNumber,
        distanceBefore,
        distanceAfter:  newDistance,
    };
    const existingLog = Array.isArray(liveData.roundLog) ? liveData.roundLog : [];
    const existingIdx = existingLog.findIndex(e => e.tokenUuid === tokenUuid && e.actionNumber === actionNumber);
    const newRoundLog = existingIdx >= 0
        ? existingLog.map((e, i) => i === existingIdx ? newLogEntry : e)
        : [...existingLog, newLogEntry];

    // step 11: completion + banner decisions.
    //
    // We MUST pass explicit booleans for caught/escaped here to avoid the
    // render fallback of (distance <= 0) → caught = true, which incorrectly
    // fires when distance is 0 mid-pursuit because all quarry are pinned.
    const isComplete       = freeForDistance.length === 0 && allCaughtPending.length === 0;
    const showCaughtBanner  = isComplete && newlyCaught.length > 0 && !needsDialog;
    const showEscapedBanner = isComplete && (escapedQuarry.length > 0 || leftBehindQuarry.length > 0) && !showCaughtBanner;

    // Prune obstacles that every active participant has navigated past.
    const activeUuids = new Set([...updatedQuarry, ...updatedPursuers].map(p => p.tokenUuid));
    const cleanedObstacles = liveObstacles.filter(obs =>
        [...activeUuids].some(uuid => !obs.navigatedBy.includes(uuid))
    );

    const content = await renderComplexRoundContent({
        pursuitType:    liveData.pursuitType,
        distance:       newDistance,
        escapeDistance,
        quarry:         updatedQuarry,
        pursuers:       updatedPursuers,
        roundLog:       newRoundLog,
        pursuitSkill:   liveData.pursuitSkill ?? "Athletics",
        ignoredPairs:   cleanedIgnoredPairs,
        caughtPending:  allCaughtPending,
        obstacles:      cleanedObstacles,
        caught:         showCaughtBanner,
        escaped:        showEscapedBanner,
    });

    // step 12: single atomic write.
    const updatePayload = {
        content,
        "flags.wfrp4e-pursuits.quarry":        updatedQuarry,
        "flags.wfrp4e-pursuits.pursuers":      updatedPursuers,
        "flags.wfrp4e-pursuits.distance":      newDistance,
        "flags.wfrp4e-pursuits.caughtPending": allCaughtPending,
        "flags.wfrp4e-pursuits.ignoredPairs":  cleanedIgnoredPairs,
        "flags.wfrp4e-pursuits.roundLog":      newRoundLog,
        "flags.wfrp4e-pursuits.obstacles":     cleanedObstacles,
    };
    if (isComplete) updatePayload["flags.wfrp4e-pursuits.state"] = "complete";
    await updateMessage(message.id, updatePayload);
}
