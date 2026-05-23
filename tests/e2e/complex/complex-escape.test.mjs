import { test } from "../fw.mjs"
import {
    getComplexTokenData, joinPursuit, rollInitiativeOrdered, rollNextActive, setEscapeDistance,
    waitForOutcome, waitForNoOutcome, waitForParticipants,
} from "../helpers.mjs"

// Requires the wfrp4e-up-in-arms module to be active in the test world.
//
// Escape mechanics (checked in _advanceComplexRound after everyone acts):
//   escapedQuarry:    quarryPos > maxPursuerPos  AND  (quarryPos − maxPursuerPos) >= escapeDistance
//   leftBehindQuarry: ALL pursuers' positions strictly > quarryPos
//     (left-behind can occur after multiple ignoreQuarry decisions push all pursuers past quarry,
//      or after a reroll reduces quarry position below all pursuers)
//   After escape: postEscapeMessage posted; quarry removed from active
//   After left-behind: postLeftBehindMessage posted; quarry removed from active
//
// Environment / escapeDistance values: Busy City=3, Woodland=5, Village=7, Meadow=10, Desert=13

test.describe("complex pursuit: escape scenarios", () => {
    test("quarry escapes when gap reaches escapeDistance at round end", async ({ fw }) => {
        // Setup: Quarry 1 (move=4) + Guard 1 (move=4), startDistance=4, escapeDistance=5 (Woodland)
        // Initiative: Guard 1 acts before Quarry 1.
        //
        // Escape is checked per-roll (renderComplexRoundContent). Guard 1 must act first so
        // their position (1) is already factored in when Quarry 1 rolls and the gap is evaluated.
        // With startDistance=5 (= escapeDistance) the initial render would already show escaped.
        //
        // Round 1:
        //   Guard 1  SL=0 → moves 1 → pos=1; gap=4−1=3 < 5
        //   Quarry 1 SL=4 → moves 2 → pos=6; gap=6−1=5 >= 5 → escape
        //   postEscapeMessage: "disappears in the distance"
        //   All quarry escaped → state=complete
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "4")
        await setEscapeDistance(fw, 5)  // Woodland

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")
        const tokens = [quarry, guard]

        await rollInitiativeOrdered(fw, [guard, quarry])  // Guard 1 acts first

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        await rollNextActive(fw, tokens, 0)   // Guard 1 SL=0 → pos=1; gap=4−1=3 < 5
        await rollNextActive(fw, tokens, 4)   // Quarry 1 SL=4 → pos=6; gap=6−1=5 → escape

        // Escape notification in chat + escaped outcome banner replaces the round badge on the round card
        await fw.waitForTextInLastChatMessage("Quarry 1 disappears in the distance.")
        await waitForOutcome(fw, "escaped")
        await fw.waitForNoSelector('[data-action="rollSkill"]')
    })

    test("quarry does not escape if gap is exactly one short of escapeDistance", async ({ fw }) => {
        // Setup: Quarry 1 + Guard 1, startDistance=5, escapeDistance=7 (Village, default)
        // Initiative: Guard 1 acts before Quarry 1.
        //
        // Guard 1 must act first so their updated position is factored into the per-roll
        // escape check when Quarry 1 rolls. If Quarry 1 acted first from pos=5, the check
        // would see gap=7−0=7 >= 7 and fire immediately in Round 1.
        //
        // Round 1:
        //   Guard 1  SL=0 → moves 1 → pos=1
        //   Quarry 1 SL=4 → moves 2 → pos=7; gap=7−1=6 < 7 → no escape
        //
        // Round 2:
        //   Guard 1  SL=0 → moves 1 → pos=2
        //   Quarry 1 SL=4 → moves 2 → pos=9; gap=9−2=7 >= 7 → escaped
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        // Village (7) is the default; no need to change escapeDistance

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")
        const tokens = [quarry, guard]

        await rollInitiativeOrdered(fw, [guard, quarry])  // Guard 1 acts first

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // Round 1: gap = 7 − 1 = 6 < 7 → no escape
        await rollNextActive(fw, tokens, 0)   // Guard 1 SL=0 → pos=1
        await rollNextActive(fw, tokens, 4)   // Quarry 1 SL=4 → pos=7; gap=6 < 7

        // Round 2 badge appears — no outcome banner yet → pursuit is still active
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 2")
        await waitForNoOutcome(fw)

        // Round 2: gap = 9 − 2 = 7 >= 7 → escaped
        await rollNextActive(fw, tokens, 0)   // Guard 1 SL=0 → pos=2
        await rollNextActive(fw, tokens, 4)   // Quarry 1 SL=4 → pos=9; gap=7 → escape

        await fw.waitForTextInLastChatMessage("Quarry 1 disappears in the distance.")
        await waitForOutcome(fw, "escaped")
    })

    // Removed "left-behind quarry" scenario: with one quarry + one pursuer at startDistance=1,
    // the pursuer's roll always crosses the quarry's position first, firing a mid-round catch
    // (needsDialog=false → state=complete) before the left-behind branch in
    // _advanceComplexRound can run. The left-behind path is only reachable via ignoreQuarry
    // (multi-quarry) or a position-reducing reroll — neither was set up here. Re-add a test
    // for that branch only with a setup that actually drives those code paths.

    test("multi-quarry: one escapes while the other continues", async ({ fw }) => {
        // Setup: Thief (move=3) + Scout (move=4) as quarry, Guard 1 (move=4) as pursuer
        //        startDistance=4, escapeDistance=5 (Woodland)
        //
        // Initiative: Scout > Guard 1 > Thief
        //
        // Round 1:
        //   Scout   SL=4 → moves 2 → pos=6
        //   Guard 1 SL=0 → moves 1 → pos=1
        //   Thief   SL=0 → moves 1 → pos=5
        //   Auto-advance: Scout gap=6−1=5 >= 5 → escaped; Thief gap=5−1=4 < 5 → continues
        //   postEscapeMessage for Scout; Scout removed
        //
        // Pursuit continues with only Thief + Guard 1
        //   distance = Thief.pos − Guard1.pos = 5 − 1 = 4, state=active
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Thief", "Scout"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "4")
        await setEscapeDistance(fw, 5)  // Woodland

        const thief = await getComplexTokenData(fw, "Thief")
        const scout = await getComplexTokenData(fw, "Scout")
        const guard = await getComplexTokenData(fw, "Guard 1")
        const tokens = [thief, scout, guard]

        // Initiative: Scout > Guard 1 > Thief
        await rollInitiativeOrdered(fw, [scout, guard, thief])

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        await rollNextActive(fw, tokens, 4)   // Scout SL=4 → pos=6
        // Scout escape notification posted;
        await fw.waitForTextInLastChatMessage("Scout disappears in the distance.")
        await rollNextActive(fw, tokens, 0)   // Guard 1 SL=0 → pos=1
        await rollNextActive(fw, tokens, 0)   // Thief SL=0 (move=3 → base=1 → +1) → pos=5

        // Round 2 starts with only Thief + Guard 1 left
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 2")
        await waitForNoOutcome(fw)
        await waitForParticipants(fw, { includes: ["Thief", "Guard 1"], excludes: ["Scout"] })
    })

})
