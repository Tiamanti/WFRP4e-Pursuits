import { test } from "../fw.mjs"
import { WAIT_TIMEOUT } from "../timeouts.mjs"
import {
    applyActorCondition, getComplexTokenData, joinPursuit, removeActorCondition,
    rollForSL, rollInitiativeOrdered, rollNextActive,
    waitForOutcome,
} from "../helpers.mjs"

// Requires the wfrp4e-up-in-arms module to be active in the test world.
//
// Condition mechanics:
//   SL <= -5 at end of round → _advanceComplexRound adds "prone" condition to actor
//   In next round, isProne=true → card shows [data-action="removeCondition"][data-condition="prone"]
//   Clicking removeCondition: removes prone from actor, calls processComplexSkip
//   processComplexSkip: adds token to skippedUuids, counts as SL=-3 for movement (0 yards moved)
//   Entangled condition: shows [data-action="rollStrengthEscape"] — fires a Strength test,
//     turn is always skipped (isSkip=true); condition removed only if actor's SL beats the
//     opposed threshold SL (computed from a Math.random() roll against stored entangledThreshold)
//
// Note: prone/entangled actors persist on the Foundry actor document across tests.
//       Conditions are removed in afterEach to prevent test bleed.

test.afterEach(async ({ fw }) => {
    await removeActorCondition(fw, "Quarry 1", "prone")
    await removeActorCondition(fw, "Quarry 1", "entangled")
    await removeActorCondition(fw, "Guard 1", "prone")
    await removeActorCondition(fw, "Thief", "prone")
})

test.describe("complex pursuit: prone and condition handling", () => {
    test("SL -5 or worse applies prone condition after round resolves", async ({ fw }) => {
        // Setup: Thief (move=3, effectiveSkill=40) + Guard 1 (move=4), startDistance=5, escapeDistance=7
        // Thief is used here because move=3 gives effectiveSkill=40, making SL=-5 achievable (roll=95).
        // Quarry 1 has move=4 (effectiveSkill=60); its minimum achievable SL is -4.
        //
        // Round 1:
        //   Thief   SL=-5 → moves 0 → pos=5 (no movement, prone applied)
        //   Guard 1 SL=0  → moves 1 → pos=1
        //   Auto-advance fires
        //   _advanceComplexRound: slFor(Thief)=-5 → actor.addCondition("prone")
        //
        // In Round 2 card:
        //   Thief has isProne=true → "Remove Prone" button visible
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

        await rollNextActive(fw, tokens, -5)  // Thief SL=-5 → 0 yards, prone applied after round
        await rollNextActive(fw, tokens, 0)   // Guard 1 SL=0 → pos=1; auto-advance → Round 2

        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 2")

        // Round 2 card shows prone button for Thief
        await fw.waitForSelector(`[data-action="removeCondition"][data-condition="prone"]`)

        // Foundry actor has prone condition
        await fw.waitFor((name) => {
            const actor = game.actors.getName(name)
            return actor?.hasCondition?.("prone") ? true : null
        }, WAIT_TIMEOUT, "Thief")
    })

    test("prone participant: click removeCondition skips their roll and allows round to advance", async ({ fw }) => {
        // Setup: Quarry 1 already has prone (pre-applied via applyActorCondition)
        //        + Guard 1, startDistance=5, escapeDistance=7
        // Initiative: Guard 1 acts first
        //
        // Guard 1 rolls first (SL=0 → pos=1).
        // Quarry 1 has prone → "Remove Prone" button visible in round card.
        // Click removeCondition → Quarry 1 skipped → allComplexActed=true → auto-advance
        await applyActorCondition(fw, "Quarry 1", "prone")

        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")
        const tokens = [quarry, guard]

        // Guard 1 acts first
        await rollInitiativeOrdered(fw, [guard, quarry])

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        await rollNextActive(fw, tokens, 0)   // Guard 1 SL=0 → pos=1

        // Quarry 1 prone button is now the only action available
        await fw.waitForSelector(
            `[data-action="removeCondition"][data-condition="prone"][data-token-uuid="${quarry.tokenUuid}"]`
        )

        // Click the prone removal button (Stand Up)
        await fw.clickInLastChatMessageContaining(
            ".pursuit-card.pursuit-round",
            `[data-action="removeCondition"][data-condition="prone"][data-token-uuid="${quarry.tokenUuid}"]`
        )

        // Quarry 1 skipped → auto-advance fires
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 2")

        // Quarry 1 actor no longer has prone condition
        await fw.waitFor((uuid) => {
            const actor = game.actors.find(a => a.getActiveTokens().some(t => t.document.uuid === uuid))
            return actor && !actor.hasCondition?.("prone") ? true : null
        }, WAIT_TIMEOUT, quarry.tokenUuid)
    })

    test("entangled participant: rollStrengthEscape wastes their turn and round auto-advances", async ({ fw }) => {
        // Setup: Quarry 1 has "entangled" condition (pre-applied via applyActorCondition)
        //        + Guard 1, startDistance=5, escapeDistance=7
        //
        // With the Untangle mechanic, Quarry 1's turn shows [data-action="rollStrengthEscape"]
        // instead of a simple removeCondition button. Clicking it opens a Strength characteristic
        // dialog; the turn is always treated as a skip (isSkip=true) regardless of whether the
        // actor escapes. Whether entangled is removed depends on the opposed roll outcome.
        await applyActorCondition(fw, "Quarry 1", "entangled")

        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")
        const tokens = [quarry, guard]

        await rollInitiativeOrdered(fw, [guard, quarry])

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        await rollNextActive(fw, tokens, 0)   // Guard 1 SL=0 → pos=1

        // Entangled → Untangle (rollStrengthEscape) button shown; normal Roll button absent.
        await fw.waitForSelector(
            `[data-action="rollStrengthEscape"][data-token-uuid="${quarry.tokenUuid}"]`
        )
        await fw.waitForNoSelector(
            `[data-action="rollSkill"][data-token-uuid="${quarry.tokenUuid}"]`
        )

        // Queue d100 for the Strength test (SL=0 → borderline pass) then submit the dialog.
        await fw.queueDiceOverride(100, 1, rollForSL(quarry.characteristics.s, 0))
        await fw.clickInLastChatMessageContaining(
            ".pursuit-card.pursuit-round",
            `[data-action="rollStrengthEscape"][data-token-uuid="${quarry.tokenUuid}"]`
        )
        await fw.submitDialog()

        // Turn always skipped → round auto-advances.
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 2")
    })

    test("participant who falls prone cannot escape or catch: moves 0 yards that round", async ({ fw }) => {
        // Setup: Quarry 1 (move=4) + Thief (move=3, effectiveSkill=40), startDistance=5, escapeDistance=7 (Village default)
        // Thief is the pursuer because move=3 allows SL=-5 (roll=95); Guard 1 (move=4) cannot reach SL=-5.
        // Initiative: Thief acts before Quarry 1.
        //
        // Round 1:
        //   Thief    SL=-5 → 0 yards → pos=0; gap=5 < 7 (no escape yet)
        //   Quarry 1 SL=4  → moves 2 → pos=7; gap=7 >= 7 → Quarry 1 escapes
        //
        // Thief must act first so that after their roll the gap (5) is still below the
        // escape distance (7). If Quarry 1 acted first (pos→7, gap=7) the escape would
        // fire before Thief ever gets a rollSkill button.
        //
        // Assert:
        //   - state=complete
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Thief"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const thief  = await getComplexTokenData(fw, "Thief")
        const tokens = [quarry, thief]

        await rollInitiativeOrdered(fw, [thief, quarry])  // Thief acts first

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        await rollNextActive(fw, tokens, -5)  // Thief SL=-5 → 0 yards; gap=5 < 7
        await rollNextActive(fw, tokens, 4)   // Quarry 1 SL=4 → pos=7; gap=7 → escape

        await waitForOutcome(fw, "escaped")
    })
})
