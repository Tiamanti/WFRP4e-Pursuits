// ─────────────────────────────────────────────────────────────────────────────
// Obstacles
// ─────────────────────────────────────────────────────────────────────────────

export async function handlePerceptionReroll(message, liveData, tokenUuid, obstacleId, newMessageId, passed) {
    const obstacles = structuredClone(liveData.obstacles ?? []);
    const obs = obstacles.find(o => o.id === obstacleId);
    if (!obs) return;

    const testData = (obs.perceptionTests ?? []).find(t => t.tokenUuid === tokenUuid);
    if (testData) {
        testData.perceived = passed;
        if (newMessageId) testData.messageIds = [...testData.messageIds, newMessageId];
    }

    if (passed && !obs.perceivedBy.includes(tokenUuid)) {
        obs.perceivedBy = [...obs.perceivedBy, tokenUuid];
    } else if (!passed) {
        obs.perceivedBy = obs.perceivedBy.filter(uuid => uuid !== tokenUuid);
    }

    const content = await renderComplexRoundContent({
        pursuitType:    liveData.pursuitType,
        distance:       liveData.distance ?? 0,
        escapeDistance: liveData.escapeDistance ?? 7,
        quarry:         liveData.quarry ?? [],
        pursuers:       liveData.pursuers ?? [],
        roundLog:       liveData.roundLog ?? [],
        pursuitSkill:   liveData.pursuitSkill ?? "Athletics",
        ignoredPairs:   liveData.ignoredPairs ?? [],
        caughtPending:  liveData.caughtPending ?? [],
        obstacles,
    });
    await updateMessage(message.id, {
        content,
        "flags.wfrp4e-pursuits.obstacles": obstacles,
    });
}