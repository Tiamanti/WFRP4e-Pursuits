import { test, expect } from "../fw.mjs"
import { WAIT_TIMEOUT } from "../timeouts.mjs"
import {
    getComplexTokenData, joinPursuit, rollForSL, rollInitiativeOrdered, rollNextActive,
    applyActorCondition, removeActorCondition,
} from "../helpers.mjs"

// Tests covering behaviors introduced by the PR1 continuous-turn refactor:
//
// 1. Catch rollback — a pursuer's reroll that puts them behind a previously-caught
//    quarry releases the catch and deletes the catch dialog.
// 2. Lockout — when the next person rolls, the previous actor's chat message is
//    deleted from chat and their SL badge clears (they can no longer reroll).
// 3. Prone-undo on reroll — a reroll that escapes the SL ≤ −5 band removes prone
//    from the actor (only the prone we applied this action — pre-existing
//    conditions aren't touched).
//
// Requires the wfrp4e-up-in-arms module to be active in the test world.

test.afterEach(async ({ fw }) => {
    await removeActorCondition(fw, "Thief", "prone")
    await removeActorCondition(fw, "Quarry 1", "prone")
})

test.describe("complex pursuit: continuous-flow behaviors", () => {
    test("catch rollback: reroll behind the caught quarry releases the catch", async ({ fw }) => {
        // Setup: Thief + Scout (both start at pos=2) + Guard (pos=0), distance=2.
        // Initiative: Guard > Thief > Scout (Guard acts first).
        //
        // Guard SL=4 → pos=2 → catches BOTH quarry (same position).
        //   newlyCaught.length = 2 → needsDialog=true → two catch messages posted.
        //
        // Guard rerolls to SL=0 → newDist=1, prevDist=2, delta=-1 → pos=1.
        //   Step 7 rollback: each caughtPending entry's pursuer (Guard at pos=1) is
        //   now strictly behind the quarry (at pos=2) → release; delete the catch
        //   message.
        //
        // Expected: both catch dialogs gone; quarry is back in play.
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Thief", "Scout"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "2")

        const thief = await getComplexTokenData(fw, "Thief")
        const scout = await getComplexTokenData(fw, "Scout")
        const guard = await getComplexTokenData(fw, "Guard 1")
        const tokens = [thief, scout, guard]

        await rollInitiativeOrdered(fw, [guard, thief, scout])

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // Guard SL=4 → catches both quarry → two catch dialogs.
        await rollNextActive(fw, tokens, 4)
        await fw.waitForSelectorCount(
            '.pursuit-card.pursuit-notification [data-action="ignoreQuarry"]', 2
        )

        // Guard rerolls to SL=0 → catches roll back.
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 0))
        await fw.rightClickLastChatMessageContaining("div.test-title", "Reroll")

        // Both catch dialogs deleted from chat.
        await fw.waitForNoSelector('.pursuit-card.pursuit-notification [data-action="ignoreQuarry"]')
        await fw.waitForNoSelector('.pursuit-card.pursuit-notification [data-action="endPursuit"]')
    })

    test("lockout: next person rolling clears prior actor's chat message + SL badge", async ({ fw }) => {
        // Single pursuer + single quarry, both act in initiative order.
        //   Quarry rolls (Quarry pending: SL badge visible, roll msg in chat).
        //   Guard rolls fresh action → step 8 finalizes Quarry: their chat roll
        //   message is deleted and SL badge clears.
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")
        const tokens = [quarry, guard]

        await rollInitiativeOrdered(fw, [quarry, guard])  // Quarry first

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // Quarry rolls SL=2 — SL badge visible, roll message in chat.
        await rollNextActive(fw, tokens, 2)

        // Capture Quarry's roll chat message id.
        const quarryRollMsgId = await fw.executeInFoundry(() => {
            const tests = [...game.messages.contents].reverse().filter(m => m.system?.test)
            return tests[0]?.id ?? null
        })
        expect(quarryRollMsgId).toBeTruthy()

        // Verify Quarry's SL badge is currently visible.
        const slVisibleBeforeNextRoll = await fw.executeInFoundry((qName) => {
            const rows = [...document.querySelectorAll(".pursuit-card.pursuit-round .pursuit-sl-row")]
            const qRow = rows.find(r => r.querySelector(".participant-name")?.textContent.trim() === qName)
            return !!qRow?.querySelector(".sl-result")
        }, "Quarry 1")
        expect(slVisibleBeforeNextRoll).toBe(true)

        // Guard rolls SL=1 — Quarry's pending state finalized.
        await rollNextActive(fw, tokens, 1)

        // Quarry's chat roll message is deleted.
        await fw.waitFor((id) => game.messages.get(id) ? null : true, WAIT_TIMEOUT, quarryRollMsgId)

        // Quarry's SL badge is gone (their row has no .sl-result).
        await fw.waitFor((qName) => {
            const rows = [...document.querySelectorAll(".pursuit-card.pursuit-round .pursuit-sl-row")]
            const qRow = rows.find(r => r.querySelector(".participant-name")?.textContent.trim() === qName)
            return qRow && !qRow.querySelector(".sl-result") ? true : null
        }, WAIT_TIMEOUT, "Quarry 1")
    })

    test("prone-undo on reroll: rerolling above -5 removes prone applied this action", async ({ fw }) => {
        // Thief has move=3 → effective skill 40 → SL=-5 achievable on a 95 roll.
        // Thief rolls SL=-5 → prone applied. Reroll to SL=2 → prone removed.
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Thief"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")

        const thief = await getComplexTokenData(fw, "Thief")
        const guard = await getComplexTokenData(fw, "Guard 1")
        const tokens = [thief, guard]

        await rollInitiativeOrdered(fw, [thief, guard])

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // Thief rolls SL=-5 → prone applied immediately (continuous-flow).
        await rollNextActive(fw, tokens, -5)
        await fw.waitFor(() => {
            const actor = game.actors.getName("Thief")
            return actor?.hasCondition?.("prone") ? true : null
        })

        // Thief rerolls to SL=2 → prone removed.
        await fw.queueDiceOverride(100, 1, rollForSL(thief.skill + thief.moveModifier, 2))
        await fw.rightClickLastChatMessage("Reroll")
        await fw.waitFor(() => {
            const actor = game.actors.getName("Thief")
            return actor && !actor.hasCondition?.("prone") ? true : null
        })
    })
})
