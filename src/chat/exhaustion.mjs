// ─────────────────────────────────────────────────────────────────────────────
// Exhaustion
// ─────────────────────────────────────────────────────────────────────────────

const _EXHAUSTION_TABLE = {
    10: { Athletics: 60 },
    15: { Athletics: 40, Ride: 60 },
    18: { Athletics: 20, Drive: 60 },
    20: { Athletics: 0,  Ride: 40 },
    21: { Athletics: -10 },
    22: { Athletics: -20, Ride: 20, Drive: 40 },
    23: { Athletics: -30 },
    24: { Athletics: -40, Ride: 0 },
    25: { Athletics: -50, Drive: 20 },
    26: { Athletics: -60, Ride: -10 },
};

const _MODIFIER_LABEL_KEYS = {
    "60":  "PURSUITS.DiffVeryEasy",
    "40":  "PURSUITS.DiffEasy",
    "20":  "PURSUITS.DiffAverage",
    "0":   "PURSUITS.DiffChallenging",
    "-10": "PURSUITS.DiffDifficult",
    "-20": "PURSUITS.DiffHard",
    "-30": "PURSUITS.DiffVeryHard",
    "-40": "PURSUITS.DiffFutile",
    "-50": "PURSUITS.DiffImpossible",
    "-60": "PURSUITS.DiffEvenMoreImpossible",
};

function _modifierLabel(modifier) {
    return game.i18n.localize(_MODIFIER_LABEL_KEYS[String(modifier)] ?? String(modifier));
}

function _enduranceDifficultyFields(modifier) {
    const namedMap = { 60: "veryEasy", 40: "easy", 20: "average", 0: "challenging", "-10": "difficult", "-20": "hard", "-30": "veryHard" };
    const name = namedMap[String(modifier)];
    return name ? { difficulty: name } : { difficulty: "challenging", modifier };
}

export async function checkExhaustion(actor, participant, actionsTaken) {
    if (!actor) return;
    const tableEntry = _EXHAUSTION_TABLE[actionsTaken];
    if (!tableEntry) return;
    const skill = participant.skill ?? "Athletics";
    const modifier = tableEntry[skill];
    if (modifier === undefined) return;

    const modLabel = _modifierLabel(modifier);

    if (skill === "Athletics") {
        const test = await actor.setupSkill("Endurance", { appendTitle: " -  Pursuit Exhaustion", skipTargets: true, fields: _enduranceDifficultyFields(modifier) });
        if (!test) return;
        await test.roll();
        const sl = Number(test.result?.SL ?? 0);
        if (sl < 0) await actor.addCondition("fatigued");
    } else {
        const msgKey = skill === "Ride" ? "PURSUITS.ExhaustionMountMessage" : "PURSUITS.ExhaustionVehicleMessage";
        const content = `<div class="pursuit-card pursuit-notification"><p>${game.i18n.format(msgKey, { name: `<strong>${participant.name}</strong>`, modifier: `<strong>${modLabel}</strong>` })}</p><p>${game.i18n.localize("PURSUITS.ExhaustionCharmAnimalNote")}</p></div>`;
        await ChatMessage.create({ content });
    }
}