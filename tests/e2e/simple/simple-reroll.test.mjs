import { test } from "../fw.mjs"
import { getTokenData, joinPursuit, rollForSL, rollSkill } from "../helpers.mjs"

test.describe("simple pursuit: reroll tracking", () => {
    test("reroll updates SL and messageIds; resolveRound deletes all test messages", async ({ fw }) => {
        // Setup: Quarry 1 (move=4) + Guard 1 (move=4), distance=5, no move bonus
        // Quarry 1 initial SL=0 → rerolled to SL=2; Guard 1 SL=−1
        // newDistance = clamp(5 + (2 − (−1)), 0, 10) = 8
        // After resolveRound: initial + reroll test messages for Quarry 1, plus Guard 1 test message — all deleted

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

        // Roll Quarry 1 with SL=0
        await rollSkill(fw, quarry, 0)

        // Assert round card shows the rolled SL
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "SL 0")

        // Reroll: queue SL=2 then right-click the test message and select "Reroll"
        await fw.queueDiceOverride(100, 1, rollForSL(quarry.skill, 2))
        await fw.rightClickLastChatMessage("Reroll")

        // Assert round card reflects the updated SL
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "SL 2")

        // Roll Guard 1 with SL=−1
        await rollSkill(fw, guard, -1)

        // Resolve round → distance 8, all test messages cleaned up
        await clickInRoundCard('[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Distance: 8 / 10")

        await fw.waitFor(() =>
            game.messages.contents.filter(m => m.system?.test).length === 0 ? true : null
        )
    })
})
