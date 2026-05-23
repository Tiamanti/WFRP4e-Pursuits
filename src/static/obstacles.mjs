async function _applyFallDamage(uuid, yards, name) {
    const actor = await fromUuid(uuid);
    if (!actor) return;
    const d10 = Math.floor(Math.random() * 10) + 1;
    const rawDamage = d10 + yards * 3;
    const tb = actor.system?.characteristics?.t?.bonus ?? 0;
    const finalDamage = Math.max(0, rawDamage - tb);
    await actor.applyBasicDamage(rawDamage, {
        damageType: game.wfrp4e.config.DAMAGE_TYPE.IGNORE_AP,
        minimumOne: false,
        suppressMsg: true,
    });
    await ChatMessage.create({
        content: `<div class="pursuit-card pursuit-notification"><p><strong>${name}</strong> falls ${yards} yard(s)! Suffers ${finalDamage} Wounds (d10 ${d10} + ${yards * 3} − TB ${tb}).</p></div>`,
    });
}

export const OBSTACLE_TABLE = [
    {
        name: "Large Log",
        perceivedText: "Automatically",
        isAutoPerceived: true,
        perceptionDifficulty: null,
        testToNavigate: "Average (+20) Athletics Test",
        testToNavigateUnperceived: null,
        navigateSkill: "Athletics",
        navigateDifficulty: "average",
        navigateDifficultyUnperceived: null,
        consequencesText: "The participant or their mount gains the Prone Condition.",
        automaticConsequences: true,
        consequences: {
            "Athletics": async (uuid, _sl, _entry, name) => {
                const actor = await fromUuid(uuid);
                await actor?.addCondition?.("prone");
                await ChatMessage.create({
                    content: `<div class="pursuit-card pursuit-notification"><p><strong>${name}</strong> trips over the log and gains the Prone Condition!</p></div>`,
                });
            },
        },
        blocksProgress: false,
    },
    {
        name: "Haystack",
        perceivedText: "Automatically",
        isAutoPerceived: true,
        perceptionDifficulty: null,
        testToNavigate: "Hard (−20) Climb Test",
        testToNavigateUnperceived: null,
        navigateSkill: "Climb",
        navigateDifficulty: "hard",
        navigateDifficultyUnperceived: null,
        consequencesText: "The participant becomes mired in the hay, counting as Entangled against an opponent with a Strength of 2D10+20.",
        automaticConsequences: true,
        entangleThreshold: 31,
        consequences: {
            "Climb": async (uuid, _sl, entry, name) => {
                const actor = await fromUuid(uuid);
                await actor?.addCondition?.("entangled");
                await ChatMessage.create({
                    content: `<div class="pursuit-card pursuit-notification"><p><strong>${name}</strong> becomes mired in the haystack and is Entangled (threshold ${entry?.entangleThreshold ?? 30})!</p></div>`,
                });
                return { participantFields: { entangledThreshold: entry?.entangleThreshold ?? 30 } };
            },
        },
        blocksProgress: false,
    },
    {
        name: "Filthy Puddle",
        perceivedText: "Average (+20) Perception Test",
        isAutoPerceived: false,
        perceptionDifficulty: "average",
        testToNavigate: "Average (+20) Athletics Test if perceived, Hard (−20) Athletics Test if not",
        testToNavigateUnperceived: "Hard (−20) Athletics Test",
        navigateSkill: "Athletics",
        navigateDifficulty: "average",
        navigateDifficultyUnperceived: "hard",
        consequencesText: "The participant showers themselves in filthy water. They suffer from −2 SL to all Fellowship based Tests until they can get themselves clean.",
        automaticConsequences: false,
        consequences: {},
        blocksProgress: false,
    },
    {
        name: "Crates of Merchandise",
        perceivedText: "Automatically",
        isAutoPerceived: true,
        perceptionDifficulty: null,
        testToNavigate: "Challenging (+0) Athletics Test",
        testToNavigateUnperceived: null,
        navigateSkill: "Athletics",
        navigateDifficulty: "challenging",
        navigateDifficultyUnperceived: null,
        consequencesText: "The participant or their mount gains the Prone Condition. 2D10 pieces of merchandise are broken.",
        automaticConsequences: true,
        consequences: {
            "Athletics": async (uuid, _sl, _entry, name) => {
                const actor = await fromUuid(uuid);
                await actor?.addCondition?.("prone");
                const broken = Math.floor(Math.random() * 10) + 1 + Math.floor(Math.random() * 10) + 1;
                await ChatMessage.create({
                    content: `<div class="pursuit-card pursuit-notification"><p><strong>${name}</strong> crashes into the merchandise — ${broken} pieces are broken!</p></div>`,
                });
            },
        },
        blocksProgress: false,
    },
    {
        name: "Closed Gate",
        perceivedText: "Automatically",
        isAutoPerceived: true,
        perceptionDifficulty: null,
        testToNavigate: "Hard (−20) Climb Test",
        testToNavigateUnperceived: null,
        navigateSkill: "Climb",
        navigateDifficulty: "hard",
        navigateDifficultyUnperceived: null,
        consequencesText: "The participant is prevented from moving this Round but can try again next Round. However, on an Impressive Failure, they suffer a 2-yard fall.",
        automaticConsequences: true,
        consequences: {
            "Climb": async (uuid, navSl, _entry, name) => {
                if (navSl > -3) return;
                await _applyFallDamage(uuid, 2, name);
            },
        },
        blocksProgress: true,
    },
    {
        name: "Pothole",
        perceivedText: "Challenging (+0) Perception Test",
        isAutoPerceived: false,
        perceptionDifficulty: "challenging",
        testToNavigate: "Easy (+40) Athletics Test if perceived, Hard (−20) Athletics Test if not",
        testToNavigateUnperceived: "Hard (−20) Athletics Test",
        navigateSkill: "Athletics",
        navigateDifficulty: "easy",
        navigateDifficultyUnperceived: "hard",
        consequencesText: "The participant suffers a Twisted Ankle Critical Injury.",
        automaticConsequences: true,
        consequences: {
            "Athletics": async (uuid) => {
                const actor = await fromUuid(uuid);
                if (!actor) return;
                const critItem = await fromUuid("Compendium.wfrp4e-core.items.Item.9j0KwH1Je1RiuZX2");
                if (critItem) await actor.createEmbeddedDocuments("Item", [critItem.toObject()]);
            },
        },
        blocksProgress: false,
    },
    {
        name: "Quicksand",
        perceivedText: "Challenging (+0) Perception Test",
        isAutoPerceived: false,
        perceptionDifficulty: "challenging",
        testToNavigate: "Easy (+40) Athletics Test if perceived, Hard (−20) Athletics Test if not",
        testToNavigateUnperceived: "Hard (−20) Athletics Test",
        navigateSkill: "Athletics",
        navigateDifficulty: "easy",
        navigateDifficultyUnperceived: "hard",
        consequencesText: "The participant becomes mired in the quicksand. They count as Entangled against an opponent with a Strength of D10+20. If they do not escape within 1 Round, they count as Entangled against an opponent with a Strength of 2D10+20, increasing by 1D10 each Round for 6 Rounds.",
        automaticConsequences: false,
        consequences: {},
        blocksProgress: false,
    },
    {
        name: "Passing Goat Herd",
        perceivedText: "Automatically",
        isAutoPerceived: true,
        perceptionDifficulty: null,
        testToNavigate: "Hard (−20) Athletics Test",
        testToNavigateUnperceived: null,
        navigateSkill: "Athletics",
        navigateDifficulty: "hard",
        navigateDifficultyUnperceived: null,
        consequencesText: "The participant takes a hit from Weapon (Horns) +6 as enraged goats buffet into the Character.",
        automaticConsequences: true,
        consequences: {
            "Athletics": async (uuid, _sl, _entry, name) => {
                const actor = await fromUuid(uuid);
                if (!actor) return;
                await actor.applyBasicDamage(6, {
                    damageType: game.wfrp4e.config.DAMAGE_TYPE.NORMAL,
                    minimumOne: true,
                    suppressMsg: true,
                });
                await ChatMessage.create({
                    content: `<div class="pursuit-card pursuit-notification"><p><strong>${name}</strong> is buffeted by enraged goats — takes a hit from Weapon (Horns) +6!</p></div>`,
                });
            },
        },
        blocksProgress: false,
    },
    {
        name: "Bucket Full of Fish Guts",
        perceivedText: "Automatically",
        isAutoPerceived: true,
        perceptionDifficulty: null,
        testToNavigate: "Easy (+40) Athletics Test",
        testToNavigateUnperceived: null,
        navigateSkill: "Athletics",
        navigateDifficulty: "easy",
        navigateDifficultyUnperceived: null,
        consequencesText: "If a participant trips over the bucket, they gain the Prone Condition. However, they leave a large slick of fermenting fish guts behind them.",
        automaticConsequences: true,
        consequences: {
            "Athletics": async (uuid, _sl, _entry, name) => {
                const actor = await fromUuid(uuid);
                await actor?.addCondition?.("prone");
                await ChatMessage.create({
                    content: `<div class="pursuit-card pursuit-notification"><p><strong>${name}</strong> trips over the bucket — fish guts everywhere! A slick is left behind.</p></div>`,
                });
            },
        },
        blocksProgress: false,
    },
    {
        name: "Slick of Fish Guts",
        perceivedText: "Automatically",
        isAutoPerceived: true,
        perceptionDifficulty: null,
        testToNavigate: "Hard (−20) Athletics Test",
        testToNavigateUnperceived: null,
        navigateSkill: "Athletics",
        navigateDifficulty: "hard",
        navigateDifficultyUnperceived: null,
        consequencesText: "The participant tumbles over on the slippery guts. They gain the Prone Condition and suffer from −2 SL to all Fellowship based Tests until they can get themselves clean.",
        automaticConsequences: true,
        consequences: {
            "Athletics": async (uuid, _sl, _entry, name) => {
                const actor = await fromUuid(uuid);
                await actor?.addCondition?.("prone");
                await ChatMessage.create({
                    content: `<div class="pursuit-card pursuit-notification"><p><strong>${name}</strong> tumbles on the fish guts! Prone, and suffers −2 SL to all Fellowship Tests until clean.</p></div>`,
                });
            },
        },
        blocksProgress: false,
    },
    {
        name: "Rotten Floorboards",
        perceivedText: "Hard (−20) Perception Test",
        isAutoPerceived: false,
        perceptionDifficulty: "hard",
        testToNavigate: "Average (+20) Athletics Test if perceived, Very Hard (−30) Athletics Test if not",
        testToNavigateUnperceived: "Very Hard (−30) Athletics Test",
        navigateSkill: "Athletics",
        navigateDifficulty: "average",
        navigateDifficultyUnperceived: "veryHard",
        consequencesText: "The participant tumbles through the floorboards. They suffer from a fall of 3 yards.",
        automaticConsequences: true,
        consequences: {
            "Athletics": async (uuid, _sl, _entry, name) => {
                await _applyFallDamage(uuid, 3, name);
            },
        },
        blocksProgress: false,
    },
    {
        name: "Workman on Ladder",
        perceivedText: "Automatically",
        isAutoPerceived: true,
        perceptionDifficulty: null,
        testToNavigate: "Easy (+40) Athletics Test",
        testToNavigateUnperceived: null,
        navigateSkill: "Athletics",
        navigateDifficulty: "easy",
        navigateDifficultyUnperceived: null,
        consequencesText: "If a participant trips over the ladder they gain the Prone Condition. The GM should make a Hard (−20) Athletics Test on behalf of the labourer — should they fail, they suffer a fall of 1D10 yards.",
        automaticConsequences: true,
        consequences: {
            "Athletics": async (uuid, _sl, _entry, name) => {
                const actor = await fromUuid(uuid);
                await actor?.addCondition?.("prone");
                await ChatMessage.create({
                    content: `<div class="pursuit-card pursuit-notification"><p><strong>${name}</strong> trips over the ladder! GM: roll Hard (−20) Athletics for the labourer — on failure, they fall 1D10 yards.</p></div>`,
                });
            },
        },
        blocksProgress: false,
    },
    {
        name: "Unattended Cart",
        perceivedText: "Automatically",
        isAutoPerceived: true,
        perceptionDifficulty: null,
        testToNavigate: "Average (+20) Climb Test",
        testToNavigateUnperceived: null,
        navigateSkill: "Climb",
        navigateDifficulty: "average",
        navigateDifficultyUnperceived: null,
        consequencesText: "The participant slides back down off the cart. They are stuck this Round, but can attempt to clear the obstacle again next Round.",
        automaticConsequences: false,
        consequences: {},
        blocksProgress: true,
    },
    {
        name: "Unattended Cart Full of Cabbages",
        perceivedText: "Automatically",
        isAutoPerceived: true,
        perceptionDifficulty: null,
        testToNavigate: "Challenging (+0) Climb Test",
        testToNavigateUnperceived: null,
        navigateSkill: "Climb",
        navigateDifficulty: "challenging",
        navigateDifficultyUnperceived: null,
        consequencesText: "The participant slides back down off the cart, causing a torrent of cabbages to spill down after them. They must make an Average (+20) Initiative Test or gain the Surprised Condition.",
        automaticConsequences: true,
        consequences: {
            "Climb": async (uuid, _sl, _entry, name) => {
                const actor = await fromUuid(uuid);
                if (!actor) return;
                const test = await actor.setupCharacteristic("i", {
                    appendTitle: " - Startled by cabbages",
                    skipTargets: true,
                    fields: { difficulty: "average" },
                });
                if (!test) return;
                await test.roll();
                const sl = Number(test.result?.SL ?? 0);
                if (sl < 0) {
                    await actor.addCondition("surprised");
                    await ChatMessage.create({
                        content: `<div class="pursuit-card pursuit-notification"><p><strong>${name}</strong> is startled by the torrent of cabbages and gains the Surprised Condition!</p></div>`,
                    });
                }
            },
        },
        blocksProgress: false,
    },
    {
        name: "Scattered Mound of Cabbages",
        perceivedText: "Automatically",
        isAutoPerceived: true,
        perceptionDifficulty: null,
        testToNavigate: "Hard (−20) Athletics Test",
        testToNavigateUnperceived: null,
        navigateSkill: "Athletics",
        navigateDifficulty: "hard",
        navigateDifficultyUnperceived: null,
        consequencesText: "The participant trips over on the cabbages. They suffer a fall as if from 1 yard and gain the Prone Condition.",
        automaticConsequences: true,
        consequences: {
            "Athletics": async (uuid, _sl, _entry, name) => {
                const actor = await fromUuid(uuid);
                await actor?.addCondition?.("prone");
                await _applyFallDamage(uuid, 1, name);
            },
        },
        blocksProgress: false,
    },
];