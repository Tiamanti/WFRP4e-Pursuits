import { test } from "../fw.mjs"
import {
    getComplexTokenData, joinPursuit, rollInitiativeOrdered, rollNextActive, rollSkill,
    waitForOutcome, waitForNoOutcome, waitForNoCatchDialog, waitForParticipants, waitForRowStatus,
} from "../helpers.mjs"

// Requires the wfrp4e-up-in-arms module to be active in the test world.
//
// Catch mechanics:
//   Mid-round catch: fires inside processComplexRoll when the rolling pursuer's position
//     crosses a quarry member's position (prevPursuerPos < quarryPos <= newPursuerPos).
//   End-of-round catch: fires inside _advanceComplexRound when quarryPos <= maxPursuerPos.
//   needsDialog = true when:  otherActiveQuarry.length > 0 || newlyCaught.length > 1
//                              || caughtPending.length > 0
//   Catch dialog actions (type:"catch" message):
//     excludePair  → pursuer + quarry both removed; remainder continues
//     ignoreQuarry → quarry released back to active; (pursuer,quarry) added to ignoredPairs
//     endPursuit   → GM ends entire pursuit; state=complete

test.describe("complex pursuit: catch scenarios", () => {
    test("single pursuer crosses single quarry mid-round: direct notification, state=complete", async ({ fw }) => {
        // Setup: Quarry 1 (move=4) + Guard 1 (move=4), startDistance=2, escapeDistance=7 (Village)
        // Initiative: Guard 1 acts before Quarry 1.
        //
        // Guard 1 SL=4 → moves 2 → pos=2
        //   prevPos=0 < quarryPos=2 <= newPos=2 → mid-round catch fires
        //   Single quarry, single pursuer → needsDialog=false
        //   Direct notification posted: "Quarry 1 was caught by Guard 1"
        //   state set to complete immediately (Quarry 1's roll is not needed)
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "2")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")

        await rollInitiativeOrdered(fw, [guard, quarry])

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // Guard 1 SL=4 → moves 2 → pos=2 → catches Quarry 1 (at pos=2)
        await rollNextActive(fw, [quarry, guard], 4)

        // Direct notification + caught outcome banner closes the round card
        await fw.waitForTextInLastChatMessage("Quarry 1 was caught by Guard 1.")
        await waitForOutcome(fw, "caught")
        // No catch dialog rendered (single quarry → needsDialog=false → plain notification only)
        await waitForNoCatchDialog(fw)
    })

    test("mid-round catch with other active quarry: catch dialog posted", async ({ fw }) => {
        // Setup: Thief (move=3) + Scout (move=4) as quarry, Guard 1 (move=4) as sole pursuer
        //        startDistance=2, escapeDistance=7
        // Initiative order: Thief > Guard 1 > Scout
        //   (Thief rolls first, then Guard 1 crosses Scout's position, Scout hasn't acted yet)
        //
        // Thief SL=4 → moves 2 → pos=4
        // Guard 1 SL=4 → moves 2 → pos=2
        //   prevPos=0 < scoutPos=2 <= newPos=2 → Scout caught mid-round
        //   otherActiveQuarry=[Thief] → needsDialog=true
        //   catch dialog posted for Scout
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Thief", "Scout"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "2")

        const thief = await getComplexTokenData(fw, "Thief")
        const scout = await getComplexTokenData(fw, "Scout")
        const guard = await getComplexTokenData(fw, "Guard 1")
        const tokens = [thief, scout, guard]

        // Initiative: Thief > Guard 1 > Scout
        await rollInitiativeOrdered(fw, [thief, guard, scout])

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // Thief SL=4 → pos=4
        await rollNextActive(fw, tokens, 4)
        // Guard 1 SL=4 → pos=2 → catches Scout (at pos=2); Thief still active → needsDialog=true
        await rollNextActive(fw, tokens, 4)

        // Catch dialog rendered — both Ignore and End pursuit buttons present in the notification card
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-notification", "End pursuit")
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-notification", "Ignore")
        await fw.waitForSelector('.pursuit-card.pursuit-notification [data-action="ignoreQuarry"]')

        // Round card still active — no outcome banner
        await waitForNoOutcome(fw)
    })

    test("catch dialog excludePair: matching pursuer and quarry removed, remainder continues", async ({ fw }) => {
        // Setup: Thief + Scout as quarry, Guard 1 + Knight as pursuers
        //        startDistance=2, escapeDistance=7
        // Initiative: Thief > Guard 1 > Scout > Knight
        //
        // Thief SL=4 → pos=4
        // Guard 1 SL=4 → pos=2 → catches Scout (at pos=2)
        //   otherActiveQuarry=[Thief], Knight unacted → needsDialog=true
        //
        // Click excludePair → Guard 1 + Scout removed, Thief + Knight continue
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Thief", "Scout"], "Quarry")
        await joinPursuit(fw, ["Guard 1", "Knight"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "2")

        const thief  = await getComplexTokenData(fw, "Thief")
        const scout  = await getComplexTokenData(fw, "Scout")
        const guard  = await getComplexTokenData(fw, "Guard 1")
        const knight = await getComplexTokenData(fw, "Knight")
        const tokens = [thief, scout, guard, knight]

        await rollInitiativeOrdered(fw, [thief, guard, scout, knight])

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        await rollNextActive(fw, tokens, 4)   // Thief SL=4 → pos=4
        await rollNextActive(fw, tokens, 4)   // Guard 1 SL=4 → pos=2 → catches Scout

        // Wait for catch dialog
        await fw.waitForTextInLastChatMessage("Exclude pair from pursuit")

        // Click excludePair
        await fw.clickInLastChatMessage('[data-action="excludePair"]')

        await waitForNoCatchDialog(fw)
        await waitForNoOutcome(fw)
        // Knight's turn (the only remaining unacted pursuer) → roll button visible on the round card
        await fw.waitForSelector('.pursuit-card.pursuit-round [data-action="rollSkill"]')
        // Only Thief + Knight remain in the participant list (Guard 1 and Scout removed)
        await waitForParticipants(fw, { includes: ["Thief", "Knight"], excludes: ["Scout", "Guard 1"] })
    })

    test("catch dialog ignoreQuarry: quarry released to active play, ignoredPairs updated", async ({ fw }) => {
        // Setup: Thief + Scout as quarry, Guard 1 + Knight as pursuers
        //        startDistance=2, escapeDistance=7
        // Same initiative/roll setup → Guard 1 catches Scout mid-round
        //
        // Click ignoreQuarry → Scout released, ignoredPairs gets (Guard 1, Scout) entry
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Thief", "Scout"], "Quarry")
        await joinPursuit(fw, ["Guard 1", "Knight"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "2")

        const thief  = await getComplexTokenData(fw, "Thief")
        const scout  = await getComplexTokenData(fw, "Scout")
        const guard  = await getComplexTokenData(fw, "Guard 1")
        const knight = await getComplexTokenData(fw, "Knight")
        const tokens = [thief, scout, guard, knight]

        await rollInitiativeOrdered(fw, [thief, guard, scout, knight])

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        await rollNextActive(fw, tokens, 4)   // Thief SL=4 → pos=4
        await rollNextActive(fw, tokens, 4)   // Guard 1 SL=4 → pos=2 → catches Scout

        await fw.waitForTextInLastChatMessage("Ignore")
        await fw.clickInLastChatMessage('[data-action="ignoreQuarry"]')

        await waitForNoCatchDialog(fw)
        await waitForNoOutcome(fw)
        // All four participants still visible (Scout is released back to active play)
        await waitForParticipants(fw, { includes: ["Thief", "Scout", "Guard 1", "Knight"] })

        // ignoredPairs effect is visible in Guard 1's status text: before Ignore it showed
        // "has caught up to quarry" (Guard at pos=2 == Scout at pos=2); after Ignore, Scout is
        // filtered out of Guard's relevant quarry → closest non-ignored is Thief (pos=4) →
        // "is 2 behind quarry"
        await waitForRowStatus(fw, "Guard 1", "is 2 behind quarry")
    })

    test("catch dialog endPursuit: pursuit state set to complete, catch message deleted", async ({ fw }) => {
        // Setup: Thief + Scout as quarry, Guard 1 as sole pursuer
        //        same as mid-round catch test → catch dialog produced
        //
        // Click endPursuit → state=complete, catch message deleted
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Thief", "Scout"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "2")

        const thief = await getComplexTokenData(fw, "Thief")
        const scout = await getComplexTokenData(fw, "Scout")
        const guard = await getComplexTokenData(fw, "Guard 1")
        const tokens = [thief, scout, guard]

        await rollInitiativeOrdered(fw, [thief, guard, scout])

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        await rollNextActive(fw, tokens, 4)   // Thief SL=4 → pos=4
        await rollNextActive(fw, tokens, 4)   // Guard 1 SL=4 → pos=2 → catches Scout; Thief active → dialog

        await fw.waitForTextInLastChatMessage("End pursuit")

        await fw.clickInLastChatMessage('[data-action="endPursuit"]')

        // Catch dialog dismissed + caught outcome banner; no roll buttons on the closed pursuit
        await waitForNoCatchDialog(fw)
        await waitForOutcome(fw, "caught")
        await fw.waitForNoSelector('[data-action="rollSkill"], [data-action="resolveRound"]')
    })

    test("multiple quarry caught simultaneously: all go to caughtPending, individual dialogs posted", async ({ fw }) => {
        // Setup: Thief + Scout both at pos=2 (startDistance=2), Guard 1 as sole pursuer
        // Initiative: Guard 1 acts first (before either quarry member has moved)
        //
        // Guard 1 SL=4 → moves 2 → pos=2
        //   Both Thief (pos=2) and Scout (pos=2) are crossed simultaneously
        //   newlyCaught=[Thief, Scout], needsDialog=true (newlyCaught.length > 1)
        //   Two catch messages posted (one per quarry member)
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Thief", "Scout"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "2")

        const thief = await getComplexTokenData(fw, "Thief")
        const scout = await getComplexTokenData(fw, "Scout")
        const guard = await getComplexTokenData(fw, "Guard 1")
        const tokens = [thief, scout, guard]

        // Guard 1 acts first before any quarry
        await rollInitiativeOrdered(fw, [guard, thief, scout])

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // Guard 1 SL=4 → pos=2 → catches both Thief (pos=2) and Scout (pos=2)
        await rollNextActive(fw, tokens, 4)

        // Two catch notification cards render side by side, each with its own dialog buttons
        // (templates/chat/pursuit-caught.hbs has [data-action="ignoreQuarry"] per quarry caught)
        await fw.waitForSelectorCount('.pursuit-card.pursuit-notification [data-action="ignoreQuarry"]', 2)

        // Both names appear inside catch notification cards
        await fw.waitFor(() => {
            const cards = [...document.querySelectorAll(".pursuit-card.pursuit-notification")]
            const text  = cards.map(c => c.textContent).join(" ")
            return text.includes("Thief") && text.includes("Scout") ? true : null
        })
    })
})
