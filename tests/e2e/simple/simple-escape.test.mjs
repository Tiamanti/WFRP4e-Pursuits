import { test } from "../fw.mjs"
import { getTokenData, joinPursuit, rollSkill } from "../helpers.mjs"

test.describe("simple pursuit: escape scenario", () => {
    test("Quarry 1 escapes Guard 1 after 2 rounds (equal move)", async ({ fw }) => {
        const clickInRoundCard = (sel) => fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-round", sel)

        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")

        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        const quarry = await getTokenData(fw, "Quarry 1")
        const guard  = await getTokenData(fw, "Guard 1")

        // Round 1: Quarry +3 SL, Guard 0 SL → distance 5+(3-0)=8
        await rollSkill(fw, quarry, 3)
        await rollSkill(fw, guard, 0)

        await clickInRoundCard('[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Distance: 8 / 10")

        // Round 2: Quarry +2 SL, Guard -1 SL → distance 8+(2-(-1))=11 → clamped to 10, escaped
        await rollSkill(fw, quarry, 2)
        await rollSkill(fw, guard, -1)

        await clickInRoundCard('[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Distance: 10 / 10")
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "The Quarry has escaped!")
    })
})
