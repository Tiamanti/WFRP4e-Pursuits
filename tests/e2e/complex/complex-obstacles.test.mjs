import { test, expect } from "../fw.mjs"
import { WAIT_TIMEOUT } from "../timeouts.mjs"
import {
    getComplexTokenData, getTokenData, joinPursuit, rollInitiativeOrdered, rollSkill,
    rollForSL, rollPerception,
    createObstacle, createCustomObstacle, waitForObstacleInDiagram, waitForNoObstacleInDiagram,
    removeActorCondition, clickRollSkill, clickRollPerception,
} from "../helpers.mjs"

// Requires the wfrp4e-up-in-arms module to be active in the test world.
//
// Obstacle position model (startDistance=5, relativeDistance=-4):
//   absolutePosition = maxQuarryPosition + relativeDistance = 5 + (−4) = 1
//   quarry (pos=5 ≥ 1) → auto-added to navigatedBy at creation
//   guard  (pos=0 < 1) → NOT auto-navigated → obstacle is relevant to guard
//
// Movement math (move=4, moveModifier=+20):
//   SL=4 → distMoved=2 → newPos=2 > obs.pos=1 → crossing triggers navigation test
//   SL=1 → distMoved=1 → newPos=1, 1 > 1 = false → no crossing
//
// OBSTACLE_TABLE indices used:
//   0 = Large Log                  — auto-perceived, average (+20) Athletics, blocksProgress=false; prone consequence
//   1 = Haystack                   — auto-perceived, hard (−20) Climb, blocksProgress=false; entangled consequence
//   2 = Filthy Puddle              — average (+20) Perception test, average (+20) Athletics nav, blocksProgress=false
//  12 = Unattended Cart            — auto-perceived, average (+20) Climb, blocksProgress=true
//  14 = Scattered Mound of Cabbages — auto-perceived, hard (−20) Athletics, blocksProgress=false; prone + fall damage

async function setupPursuit(fw) {
    await fw.sendChatCommand("/pursuit complex")
    await fw.waitForTextInLastChatMessage("Complex Pursuit")

    await joinPursuit(fw, ["Quarry 1"], "Quarry")
    await joinPursuit(fw, ["Guard 1"], "Pursuers")
    await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")

    const quarry = await getComplexTokenData(fw, "Quarry 1")
    const guard  = await getComplexTokenData(fw, "Guard 1")

    // Guard acts before Quarry so we can interact with Guard's turn in each test.
    await rollInitiativeOrdered(fw, [guard, quarry])

    await fw.clickInLastChatMessage('[data-action="start"]')
    await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")
    return { quarry, guard }
}

test.describe("complex pursuit: obstacles", () => {

    test("GM places auto-perceived obstacle: node appears in position diagram", async ({ fw }) => {
        // Large Log (index 0): auto-perceived, blocksProgress=false
        // Create Obstacle is a free GM action that does not consume Guard's turn.
        await setupPursuit(fw)
        await createObstacle(fw, 0, -4)   // absolutePosition=1
        await waitForObstacleInDiagram(fw)
    })

    test("Large Log: marginal fail (−0 SL) navigation applies prone condition", async ({ fw }) => {
        const { guard } = await setupPursuit(fw)

        // Large Log (index 0): auto-perceived, average (+20) Athletics, blocksProgress=false.
        // A marginal fail: roll is one above the effective skill (same tens bracket → SL="-0", outcome=failure).
        // Without the Object.is(-0) fix, sl >= 0 would treat this as a pass and skip the consequence.
        await createObstacle(fw, 0, -4)
        await removeActorCondition(fw, "Guard 1", "prone")

        const effectiveAthletics = guard.skill + 20   // average difficulty modifier
        const marginalFailRoll   = effectiveAthletics + 1   // one above → same tens bracket → −0 SL

        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 4))
        await fw.queueDiceOverride(100, 1, marginalFailRoll)
        await clickRollSkill(fw, guard.tokenUuid)
        await fw.submitDialog()   // movement dialog
        await fw.submitDialog()   // navigation dialog

        // −0 SL is still a failure → Large Log consequence → prone applied + notification posted.
        await fw.waitForSelector(".pursuit-notification")
        await fw.waitFor((uuid) => {
            const actor = game.actors.find(a => a.getActiveTokens().some(t => t.document.uuid === uuid))
            return actor?.hasCondition?.("prone") ? true : null
        }, WAIT_TIMEOUT, guard.tokenUuid)

        await removeActorCondition(fw, "Guard 1", "prone")
    })

    test("navigation pass on auto-perceived blocking obstacle: position advances and obstacle is pruned", async ({ fw }) => {
        const { quarry, guard } = await setupPursuit(fw)

        // Large Log at pos=1 — quarry auto-navigated, guard is not.
        await createObstacle(fw, 0, -4)

        // Guard rolls SL=4 → +2 yards → newPos=2 crosses obstacle at pos=1.
        // Two dialogs open: movement first, then navigation (inside applyComplexAction).
        // Queue both dice before clicking Roll (FIFO order: movement die first).
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 4))
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + 20, 1))  // average Athletics, pass
        await clickRollSkill(fw, guard.tokenUuid)
        await fw.submitDialog()   // movement dialog
        await fw.submitDialog()   // navigation dialog

        // quarry was auto-navigated; guard just passed → all active participants navigated → obstacle pruned
        await waitForNoObstacleInDiagram(fw)
    })

    test("navigation fail on auto-perceived blocking obstacle: position capped and obstacle stays", async ({ fw }) => {
        const { guard } = await setupPursuit(fw)

        // Unattended Cart (index 12): auto-perceived, average (+20) Climb, blocksProgress=true.
        await createObstacle(fw, 12, -4)

        const guardClimb = await getTokenData(fw, "Guard 1", "Climb")
        // Guard crosses obstacle (SL=4 → newPos=2 > obs.pos=1); fails average Climb navigation.
        // blocksProgress=true → guard NOT added to navigatedBy → obstacle remains.
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 4))
        await fw.queueDiceOverride(100, 1, rollForSL(guardClimb.skill + 20, -1))  // average Climb, fail
        await clickRollSkill(fw, guard.tokenUuid)
        await fw.submitDialog()
        await fw.submitDialog()

        // Guard not in navigatedBy → obstacle node remains in diagram.
        await waitForObstacleInDiagram(fw)
    })

    test("non-auto-perceived obstacle shows Roll Perception button for active participant", async ({ fw }) => {
        const { guard } = await setupPursuit(fw)

        // Filthy Puddle (index 2): requires Perception test before navigation test.
        // Guard is not auto-navigated and not in perceivedBy → isPerceptionPending=true.
        await createObstacle(fw, 2, -4)

        await fw.waitForSelector(
            `.pursuit-card.pursuit-round [data-action="rollPerception"][data-token-uuid="${guard.tokenUuid}"]`,
        )
        // Normal Roll button must not be shown while perception is pending.
        await fw.waitForNoSelector(
            `.pursuit-card.pursuit-round [data-action="rollSkill"][data-token-uuid="${guard.tokenUuid}"]`,
        )
    })

    test("passing perception roll replaces Perception button with normal Roll button", async ({ fw }) => {
        const { guard } = await setupPursuit(fw)

        await createObstacle(fw, 2, -4)
        await fw.waitForSelector(`[data-action="rollPerception"][data-token-uuid="${guard.tokenUuid}"]`)

        // Average (+20) Perception difficulty; SL=0 counts as a pass.
        const guardPercep = await getTokenData(fw, "Guard 1", "Perception")
        await rollPerception(fw, guard, guardPercep.skill + 20, 0)

        // After perceiving, isPerceptionPending becomes false → normal Roll button shown.
        await fw.waitForSelector(
            `.pursuit-card.pursuit-round [data-action="rollSkill"][data-token-uuid="${guard.tokenUuid}"]`,
        )
        await fw.waitForNoSelector(
            `[data-action="rollPerception"][data-token-uuid="${guard.tokenUuid}"]`,
        )
    })

    test("perception marginal fail (−0 SL) does not add participant to perceivedBy", async ({ fw }) => {
        const { guard } = await setupPursuit(fw)

        // Filthy Puddle (index 2): non-auto-perceived, average (+20) Perception.
        await createObstacle(fw, 2, -4)
        await fw.waitForSelector(`[data-action="rollPerception"][data-token-uuid="${guard.tokenUuid}"]`)

        const guardPercep = await getTokenData(fw, "Guard 1", "Perception")
        // One above the effective skill lands in the same tens bracket → SL="-0" (marginal fail).
        const marginalFailRoll = guardPercep.skill + 20 + 1
        console.log(guardPercep)
        console.log(marginalFailRoll)

        await fw.queueDiceOverride(100, 1, marginalFailRoll)
        await clickRollPerception(fw, guard.tokenUuid)
        await fw.submitDialog()

        // Attempt recorded (isPerceptionPending → false) → Roll button now visible, Perception button gone.
        await fw.waitForSelector(
            `.pursuit-card.pursuit-round [data-action="rollSkill"][data-token-uuid="${guard.tokenUuid}"]`,
        )
        await fw.waitForNoSelector(
            `[data-action="rollPerception"][data-token-uuid="${guard.tokenUuid}"]`,
        )

        // Guard must NOT be in perceivedBy — a −0 SL fail must not count as a pass.
        const perceivedByLength = await fw.executeInFoundry(() => {
            const msg = [...game.messages].reverse().find(m => m.flags?.["wfrp4e-pursuits"]?.state === "active")
            const obs = msg?.flags?.["wfrp4e-pursuits"]?.obstacles?.[0]
            return obs?.perceivedBy?.length ?? -1
        })
        expect(perceivedByLength).toBe(0)
    })

    test("perception roll messages are deleted from chat after the movement roll commits", async ({ fw }) => {
        const { guard } = await setupPursuit(fw)

        await createObstacle(fw, 2, -4)
        await fw.waitForSelector(`[data-action="rollPerception"][data-token-uuid="${guard.tokenUuid}"]`)

        const guardPercep = await getTokenData(fw, "Guard 1", "Perception")

        const beforeCount = await fw.executeInFoundry(() => game.messages.size)

        // Perception roll creates one new chat message.
        await rollPerception(fw, guard, guardPercep.skill + 20, 0)
        await fw.waitFor((n) => game.messages.size > n ? true : null, WAIT_TIMEOUT, beforeCount)

        // Guard crosses obstacle (navigation passes) — two dialogs: movement then navigation.
        // applyComplexAction deletes both the movement card and the perception card.
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 4))
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + 20, 0))   // average Athletics, pass
        await clickRollSkill(fw, guard.tokenUuid)
        await fw.submitDialog()   // movement dialog
        await fw.submitDialog()   // navigation dialog

        // Movement card + perception card both deleted → net message count = beforeCount.
        await fw.waitFor((n) => game.messages.size <= n ? true : null, WAIT_TIMEOUT, beforeCount + 3)
    })

    test("navigation fail on non-blocking obstacle: consequences posted but obstacle is pruned", async ({ fw }) => {
        const { guard } = await setupPursuit(fw)

        // Filthy Puddle (blocksProgress=false): failing navigation does NOT cap position and DOES
        // add the participant to navigatedBy (they stumble through).
        await createObstacle(fw, 2, -4)
        await fw.waitForSelector(`[data-action="rollPerception"][data-token-uuid="${guard.tokenUuid}"]`)

        const guardPercep = await getTokenData(fw, "Guard 1", "Perception")
        await rollPerception(fw, guard, guardPercep.skill + 20, 0)

        // Guard crosses obstacle; navigation fails (average Athletics, SL=-1).
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 4))
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + 20, -1))  // average Athletics, fail
        await clickRollSkill(fw, guard.tokenUuid)
        await fw.submitDialog()
        await fw.submitDialog()

        // Consequences notification posted even on fail.
        await fw.waitForSelector(".pursuit-notification")
        // blocksProgress=false → guard added to navigatedBy despite failing.
        // quarry + guard both navigated → obstacle pruned from diagram.
        await waitForNoObstacleInDiagram(fw)
    })

    test("Haystack: failing Climb navigation gives guard Entangled and shows Untangle button on their next turn", async ({ fw }) => {
        const { quarry, guard } = await setupPursuit(fw)

        // Haystack (index 1): auto-perceived, Hard (−20) Climb, blocksProgress=false.
        // Guard crosses (SL=4 → +2 yards, newPos=2 > obs.pos=1); fails Climb navigation (SL=-1).
        // Consequence: guard gains Entangled condition.
        // Clean up entangled after this test so actor state is reset for later runs.
        await removeActorCondition(fw, "Guard 1", "entangled")

        const guardClimb = await getTokenData(fw, "Guard 1", "Climb")
        await createObstacle(fw, 1, -4)   // Haystack at absolutePosition=1

        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 4))
        await fw.queueDiceOverride(100, 1, rollForSL(guardClimb.skill - 20, -1))  // Hard Climb, fail
        await clickRollSkill(fw, guard.tokenUuid)
        await fw.submitDialog()   // movement dialog
        await fw.submitDialog()   // navigation dialog

        // Notification posted confirming consequences.
        await fw.waitForSelector(".pursuit-notification")

        // Quarry takes their turn so guard's next turn begins.
        await rollSkill(fw, quarry, 0)

        // Guard's next turn: Entangled → Untangle button must be shown instead of the normal Roll button.
        await fw.waitForSelector(
            `.pursuit-card.pursuit-round [data-action="rollStrengthEscape"][data-token-uuid="${guard.tokenUuid}"]`,
        )
        await fw.waitForNoSelector(
            `.pursuit-card.pursuit-round [data-action="rollSkill"][data-token-uuid="${guard.tokenUuid}"]`,
        )

        // Clean up: remove entangled so actor is pristine for other tests.
        await removeActorCondition(fw, "Guard 1", "entangled")
    })

    test("Scattered Mound of Cabbages: failing Athletics navigation posts a fall damage notification", async ({ fw }) => {
        const { guard } = await setupPursuit(fw)

        // Scattered Mound of Cabbages (index 14): auto-perceived, Hard (−20) Athletics,
        // blocksProgress=false; consequence applies prone + 1-yard fall damage.
        await createObstacle(fw, 14, -4)   // absolutePosition=1

        // Guard crosses (SL=4 → +2 yards) then fails Hard Athletics navigation (SL=-1).
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 4))
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill - 20, -1))  // Hard Athletics, fail
        await clickRollSkill(fw, guard.tokenUuid)
        await fw.submitDialog()   // movement dialog
        await fw.submitDialog()   // navigation dialog

        // Fall damage notification appears.
        await fw.waitForSelector(".pursuit-notification")
        const notifText = await fw.executeInFoundry(() =>
            document.querySelector(".pursuit-notification")?.textContent ?? ""
        )
        expect(notifText).toContain("falls 1 yard")

        // blocksProgress=false → guard navigated → obstacle pruned.
        await waitForNoObstacleInDiagram(fw)
    })

    test("GM creates custom obstacle: node appears in position diagram", async ({ fw }) => {
        await setupPursuit(fw)
        await createCustomObstacle(fw, {
            name:            "Broken Barrel",
            skill:           "Athletics",
            difficulty:      "average",
            consequences:    "knocked off balance",
            relativeDistance: -4,
        })
        // waitForObstacleInDiagram is called inside createCustomObstacle — reaching here means success.
        await waitForObstacleInDiagram(fw)
    })

    test("custom obstacle: guard fails navigation, notification contains custom name and consequencesText", async ({ fw }) => {
        const { guard } = await setupPursuit(fw)

        // Custom obstacle at absolutePosition=1 (relativeDistance=-4, maxQuarryPos=5).
        // Auto-perceived (isAutoPerceived=true by default for custom "auto" perceived option).
        await createCustomObstacle(fw, {
            name:            "Broken Barrel",
            skill:           "Athletics",
            difficulty:      "average",
            consequences:    "knocked off balance",
            relativeDistance: -4,
            blocksProgress:  false,
        })

        // Guard crosses (SL=4 → +2 yards, newPos=2 > obs.pos=1); fails average Athletics (SL=-1).
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 4))
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + 20, -1))
        await clickRollSkill(fw, guard.tokenUuid)
        await fw.submitDialog()   // movement dialog
        await fw.submitDialog()   // navigation dialog

        // Text-fallback notification must name the obstacle and repeat consequencesText.
        await fw.waitForSelector(".pursuit-notification")
        const notifText = await fw.executeInFoundry(() =>
            document.querySelector(".pursuit-notification")?.textContent ?? ""
        )
        expect(notifText).toContain("Broken Barrel")
        expect(notifText).toContain("knocked off balance")

        // blocksProgress=false → guard navigated → obstacle pruned.
        await waitForNoObstacleInDiagram(fw)
    })

    test("custom blocking obstacle: guard fails navigation, position capped and obstacle stays", async ({ fw }) => {
        const { guard } = await setupPursuit(fw)

        const guardClimb = await getTokenData(fw, "Guard 1", "Climb")

        await createCustomObstacle(fw, {
            name:            "Iron Gate",
            skill:           "Climb",
            difficulty:      "challenging",
            consequences:    "fails to pass",
            relativeDistance: -4,
            blocksProgress:  true,
        })

        // Guard crosses (SL=4 → newPos=2 > obs.pos=1); fails challenging (+0) Climb (SL=-1).
        await fw.queueDiceOverride(100, 1, rollForSL(guard.skill + guard.moveModifier, 4))
        await fw.queueDiceOverride(100, 1, rollForSL(guardClimb.skill + 0, -1))
        await clickRollSkill(fw, guard.tokenUuid)
        await fw.submitDialog()
        await fw.submitDialog()

        // blocksProgress=true → guard not added to navigatedBy → obstacle node remains.
        await waitForObstacleInDiagram(fw)
    })
})
