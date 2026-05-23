import { test } from "../fw.mjs"
import {
    getComplexTokenData, joinPursuit, rollForSL, rollInitiativeOrdered, rollNextActive,
    waitForOutcome, waitForRowSL, waitForRowStatus,
} from "../helpers.mjs"

// Requires the wfrp4e-up-in-arms module to be active in the test world.
//
// Reroll mechanics (complex pursuit) — continuous-turn model:
//   onTestRolled hook fires when the actor rerolls via WFRP4e test dialog.
//   _applyPositionDelta(token, newSL, prevSL):
//     newDist  = _complexDistanceMoved(newSL, move)
//     prevDist = _complexDistanceMoved(prevSL, move)
//     position += newDist - prevDist     (delta applied to current position)
//   Reroll detection: hook checks flags.slResults[tokenUuid] exists to identify "already rolled" actors.
//   A reroll while others have not yet acted does NOT auto-advance; _allComplexActed() is still false
//     unless the rerolling actor was the last unacted participant.

test.describe("complex pursuit: reroll tracking", () => {
    test("pursuer rerolls to higher SL: position advances further, card shows updated position", async ({ fw }) => {
        // Setup: Guard 1 (move=4) + Quarry 1 (move=4), startDistance=5, escapeDistance=7 (Village)
        // Initiative: Guard 1 acts before Quarry 1.
        //
        // Round 1:
        //   Guard 1 initial roll SL=0 → moves 1 → pos=1
        //   Guard 1 rerolls → SL=4 → newDist=2, prevDist=1 → delta=+1 → pos=2
        //   Card for Guard 1 now shows pos=2 (not pos=1)
        //
        // Quarry 1 SL=0 → moves 1 → pos=6
        // Auto-advance: distance = 6 − 2 = 4
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

        // Guard 1 initial roll SL=0 → row shows "SL 0"
        await rollNextActive(fw, tokens, 0)
        await waitForRowSL(fw, "Guard 1", 0)

        // Reroll Guard 1 to SL=4 → row updates to "SL 4"
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 4))
        await fw.rightClickLastChatMessage("Reroll")
        await waitForRowSL(fw, "Guard 1", 4)

        // Quarry 1 SL=0 → pos=6; all acted → awaitingNewRound=true (Guard 1 gets Roll button).
        // The reroll added +1 to Guard's position; gap is 6-2 = 4 (without reroll, 6-1=5).
        await rollNextActive(fw, tokens, 0)

        // awaitingNewRound: Guard 1 (first initiative) rolls to trigger Round 2 advance.
        await rollNextActive(fw, tokens, -2)  // SL=-2 → 0 yards → Guard stays at pos=2
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 2")
        await waitForRowStatus(fw, "Guard 1", "is 4 behind quarry")
    })

    test("quarry rerolls to lower SL: position decreases, card reflects change", async ({ fw }) => {
        // Setup: Quarry 1 (move=4) + Guard 1 (move=4), startDistance=5, escapeDistance=7
        // Initiative: Guard 1 acts before Quarry 1.
        //
        // Guard 1 must act first so their pos=1 is factored into the per-roll escape check
        // when Quarry 1 rolls SL=4. If Quarry 1 acted first, gap=7−0=7 >= 7 → escape fires.
        //
        // Round 1:
        //   Guard 1  SL=0 → moves 1 → pos=1
        //   Quarry 1 initial roll SL=4 → moves 2 → pos=7; gap=7−1=6 < 7 → no escape
        //   Quarry 1 rerolls → SL=-1 → newDist=0, prevDist=2 → delta=-2 → pos=5
        //   Card shows Quarry 1 at pos=5; all acted → auto-advance
        // Auto-advance: distance = 5 − 1 = 4
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")
        const tokens = [quarry, guard]

        await rollInitiativeOrdered(fw, [guard, quarry])  // Guard 1 acts first

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // Guard 1 SL=0 → pos=1
        await rollNextActive(fw, tokens, 0)

        // Quarry 1 initial roll SL=4 → row shows "SL 4"; gap=7−1=6 < 7 → no escape
        await rollNextActive(fw, tokens, 4)
        await waitForRowSL(fw, "Quarry 1", 4)

        // Reroll Quarry 1 to SL=-1 → row updates to "SL -1"; Quarry 1 is last → auto-advance
        await fw.queueDiceOverride(100, 1, rollForSL(quarry.skill + quarry.moveModifier, -1))
        await fw.rightClickLastChatMessage("Reroll")
        await waitForRowSL(fw, "Quarry 1", -1)

        // awaitingNewRound: Guard 1 (first initiative) rolls to trigger Round 2 advance.
        await rollNextActive(fw, tokens, -2)  // SL=-2 → 0 yards → Guard stays at pos=1
        // Round 2: gap = 5 − 1 = 4 (without reroll it would be 7-1=6)
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 2")
        await waitForRowStatus(fw, "Guard 1", "is 4 behind quarry")
    })

    test("reroll mid-round triggers catch re-evaluation if delta closes gap", async ({ fw }) => {
        // Setup: Guard 1 (move=4) + Quarry 1 (move=4), startDistance=2, escapeDistance=7
        // Initiative: Guard 1 acts before Quarry 1.
        //
        // Round 1:
        //   Guard 1 initial roll SL=0 → moves 1 → pos=1
        //     (prevPos=0 < quarryPos=2, newPos=1 < quarryPos=2 → no catch yet)
        //   Guard 1 rerolls → SL=4 → newDist=2, prevDist=1 → delta=+1 → pos=2
        //     After delta: prevPos=1 < quarryPos=2 <= newPos=2 → mid-round catch fires
        //     Single quarry + single pursuer → needsDialog=false → direct notification
        //     state=complete
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "2")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")
        const tokens = [quarry, guard]

        await rollInitiativeOrdered(fw, [guard, quarry])

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // Guard 1 initial roll SL=0 → pos=1 (no catch)
        await rollNextActive(fw, tokens, 0)

        // Reroll Guard 1 to SL=4 → pos=2 → catches Quarry 1 (at pos=2)
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 4))
        await fw.rightClickLastChatMessage("Reroll")

        // Catch notification + caught outcome banner closes the round card
        await fw.waitForTextInLastChatMessage("Quarry 1 was caught by Guard 1.")
        await waitForOutcome(fw, "caught")

        // Quarry 1's rollSkill button no longer exists (pursuit ended)
        await fw.waitForNoSelector('[data-action="rollSkill"]')
    })

    // Removed "escape check is end-of-round only" scenario: the premise contradicts the
    // current code. renderComplexRoundContent computes `escaped` from positions on every
    // render (pursuit-round-complex.mjs:61), so as soon as a quarry's position satisfies
    // (minQuarryPos − maxPursuerPos) >= escapeDistance the round card shows the escaped
    // banner — including after a reroll. Because maxPursuerPos can only grow within a
    // round, there is no setup that keeps the gap below escapeDistance after every
    // individual roll but reaches escapeDistance at end-of-round. The intended assertion
    // would need to test a different invariant (e.g., that the WRITTEN state stays active
    // until _advanceComplexRound runs) rather than the visible banner.

    test("reroll by last unacted participant: auto-advance fires after reroll completes", async ({ fw }) => {
        // Setup: Guard 1 (move=4) + Quarry 1 (move=4), startDistance=5, escapeDistance=7
        // Initiative: Guard 1 acts before Quarry 1.
        //
        // Round 1:
        //   Guard 1 SL=0 → pos=1
        //   Quarry 1 is last to act: SL=0 → pos=6, then rerolls → SL=2 → newDist=1, prevDist=1
        //     delta=0 → pos remains 6
        //   _allComplexActed() → true → awaitingNewRound=true (Guard 1 gets Roll button)
        //   Guard 1 rolls SL=-2 in awaitingNewRound → advance fires → Round 2, distance = 5
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

        // Guard 1 SL=0 → pos=1
        await rollNextActive(fw, tokens, 0)

        // Quarry 1 (last to act) SL=0 → pos=6
        await rollNextActive(fw, tokens, 0)

        // Reroll Quarry 1 to SL=2 → newDist=1, prevDist=1 → delta=0 → pos=6 unchanged.
        // All acted → awaitingNewRound=true; Guard 1 (first initiative) gets Roll button.
        await fw.queueDiceOverride(100, 1, rollForSL(quarry.skill + quarry.moveModifier, 2))
        await fw.rightClickLastChatMessage("Reroll")
        await waitForRowSL(fw, "Quarry 1", 2)  // SL visible while awaitingNewRound

        // Guard 1 (first initiative) rolls to trigger Round 2 advance.
        await rollNextActive(fw, tokens, -2)  // SL=-2 → 0 yards → Guard stays at pos=1
        // Round 2: gap=5 (Quarry pos=6 - Guard pos=1)
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 2")
        await waitForRowStatus(fw, "Guard 1", "is 5 behind quarry")
    })

    test("non-GM reroll emits REROLL_SOCKET and GM applies it", async ({ fw }) => {
        // Exercises the socket path in wfrp4e-pursuits.mjs:
        //   game.socket.on(REROLL_SOCKET, async (msg) => { ... await dispatchReroll(msg) })
        //
        // Strategy: after Guard 1's initial roll (SL=0), open a second browser context
        // logged in as the configured playerUser (who owns Guard 1). The Player uses the
        // actual WFRP4e Reroll UI (right-click → Reroll → submit dialog with controlled
        // dice). Because that page has a distinct socket connection, onTestRolled emits
        // REROLL_SOCKET which the Foundry server broadcasts to the GM page, where the
        // socket handler calls dispatchReroll → applyComplexAction(isReroll=true).
        //
        // Requires: Guard 1 actor owned by the Player user in the test world.
        //
        // Setup: Guard 1 (move=4) + Quarry 1 (move=4), startDistance=5, escapeDistance=7
        // Guard 1 acts first. Reroll SL: 0 → 4.
        //   prevDist = _complexDistanceMoved(0, 4) = 1
        //   newDist  = _complexDistanceMoved(4, 4) = 2
        //   delta = +1 → Guard pos: 1 → 2
        // Quarry 1 SL=0 → pos=6. Distance = 6 − 2 = 4 → Round 2 "is 4 behind quarry".
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

        // Guard 1 initial roll SL=0 → pos=1
        await rollNextActive(fw, tokens, 0)
        await waitForRowSL(fw, "Guard 1", 0)

        // Open a Player browser context (distinct socket connection, dice extension loaded).
        // Player owns Guard 1, so they can right-click → Reroll on Guard 1's test card.
        // onTestRolled on the Player page emits REROLL_SOCKET; the GM's socket handler
        // calls dispatchReroll → applyComplexAction(isReroll=true, newSl=4).
        const playerFw = await fw.openAsUser(fw.config.playerUser ?? "Player")
        try {
            await playerFw.openChat()
            await playerFw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 4))
            await playerFw.rightClickLastChatMessage("Use a Fortune point to reroll")
            // Wait for the GM page to reflect the updated SL before closing the Player context.
            await waitForRowSL(fw, "Guard 1", 4)
        } finally {
            await playerFw.close()
        }

        // Verify the position delta was correctly applied through the round.
        await rollNextActive(fw, tokens, 0)       // Quarry 1 SL=0 → pos=6
        await rollNextActive(fw, tokens, -2)      // awaitingNewRound: Guard 1 → Round 2
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 2")
        await waitForRowStatus(fw, "Guard 1", "is 4 behind quarry")  // 6 − 2 = 4
    })
})
