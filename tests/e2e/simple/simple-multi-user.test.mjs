import { test } from "../fw.mjs"
import { getTokenData, joinPursuit, rollForSL, waitForRowSL } from "../helpers.mjs"
import { WAIT_TIMEOUT } from "../timeouts.mjs"

test.describe("simple pursuit: multi-user flows", () => {
    test("non-owner player cannot roll for another player's token", async ({ fw }) => {
        // Guard 1 (pursuer, owned by Player) + Scout (quarry, owned by Player2).
        // Player does not own Scout — clicking Scout's rollSkill must emit
        // PURSUITS.NotYourTurn ("It is not your turn in initiative order.").
        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Scout"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        const scout = await getTokenData(fw, "Scout")

        const playerFw = await fw.openAsUser(fw.config.playerUser ?? "Player")
        try {
            await playerFw.openChat()
            await playerFw.clickInLastChatMessageContaining(
                ".pursuit-card.pursuit-round",
                `[data-action="rollSkill"][data-token-uuid="${scout.tokenUuid}"]`
            )
            await playerFw.waitFor(() =>
                [...document.querySelectorAll("#notifications .notification")]
                    .some(n => n.textContent.includes("It is not your button to press.")) ? true : null
            , WAIT_TIMEOUT)
        } finally {
            await playerFw.close()
        }
    })

    test("two players reroll and GM resolves round: quarry caught", async ({ fw }) => {
        // Guard 1 (pursuer, owned by Player) + Scout (quarry, owned by Player2).
        // startDistance=5, escapeDistance=10.
        //
        // Player rolls Guard 1: SL=0 → reroll SL=4 → pursuerBestSL=4
        // Player2 rolls Scout:  SL=−1 → reroll SL=−3 → quarryBestSL=−3
        //
        // Both move=4 (no move bonus for simple pursuits).
        // newDistance = clamp(5 + (−3 − 4), 0, 10) = clamp(−2, 0, 10) = 0 → caught
        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Scout"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        const scout  = await getTokenData(fw, "Scout")
        const guard1 = await getTokenData(fw, "Guard 1")

        // Player session: roll Guard 1 SL=0, then reroll to SL=4.
        const playerFw = await fw.openAsUser(fw.config.playerUser ?? "Player")
        try {
            await playerFw.openChat()
            await playerFw.queueDiceOverride(100, 1, rollForSL(guard1.skill, 0))
            await playerFw.clickInLastChatMessageContaining(
                ".pursuit-card.pursuit-round",
                `[data-action="rollSkill"][data-token-uuid="${guard1.tokenUuid}"]`
            )
            await playerFw.submitDialog()
            await waitForRowSL(fw, "Guard 1", 0)

            await playerFw.queueDiceOverride(100, 1, rollForSL(guard1.skill, 4))
            await playerFw.rightClickLastChatMessage("Use a Fortune point to reroll")
            await waitForRowSL(fw, "Guard 1", 4)
        } finally {
            await playerFw.close()
        }

        // Player2 session: roll Scout SL=−1, then reroll to SL=−3.
        const player2Fw = await fw.openAsUser(fw.config.playerUser2 ?? "Player2")
        try {
            await player2Fw.openChat()
            await player2Fw.queueDiceOverride(100, 1, rollForSL(scout.skill, -1))
            await player2Fw.clickInLastChatMessageContaining(
                ".pursuit-card.pursuit-round",
                `[data-action="rollSkill"][data-token-uuid="${scout.tokenUuid}"]`
            )
            await player2Fw.submitDialog()
            await waitForRowSL(fw, "Scout", -1)

            await player2Fw.queueDiceOverride(100, 1, rollForSL(scout.skill, -3))
            await player2Fw.rightClickLastChatMessage("Use a Fortune point to reroll")
            await waitForRowSL(fw, "Scout", -3)
        } finally {
            await player2Fw.close()
        }

        // GM resolves round → distance 0, quarry caught.
        await fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-round", '[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "The Quarry has been caught!")
    })
})
