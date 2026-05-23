import { test } from "../fw.mjs"
import { WAIT_TIMEOUT } from "../timeouts.mjs"
import {
    getComplexTokenData, joinPursuit, rollForSL, rollInitiativeOrdered,
    removeActorCondition, setEscapeDistance, rollNextActive, selectTestType,
} from "../helpers.mjs"

// Tests that the Exhaustion system triggers at the correct actionsTaken threshold
// for each skill type.
//
// Exhaustion table (first threshold per skill):
//   Athletics — round 10 → modifier +60 → Endurance dialog opens automatically
//   Ride      — round 15 → modifier +60 → notification message ("… mount")
//   Drive     — round 18 → modifier +60 → notification message ("… draft animals")

test.afterEach(async ({ fw }) => {
    await removeActorCondition(fw, "Quarry 1", "fatigued")
})

async function rollParticipant(fw, tokenUuid, dieValue) {
    await fw.waitFor((uuid) => {
        const btns = document.querySelectorAll(".pursuit-card.pursuit-round [data-action='rollSkill']")
        return btns.length === 1 && btns[0].dataset.tokenUuid === uuid ? true : null
    }, WAIT_TIMEOUT, tokenUuid)
    await fw.queueDiceOverride(100, 1, dieValue)
    await fw.clickInLastChatMessageContaining(
        ".pursuit-card.pursuit-round",
        `[data-action="rollSkill"][data-token-uuid="${tokenUuid}"]`
    )
    await fw.submitDialog()
}

async function setLargeEscapeDistance(fw) {
    await fw.executeInFoundry(async () => {
        const msg = game.messages.contents
            .filter(m => m.flags?.["wfrp4e-pursuits"]?.state === "active")
            .at(-1)
        if (!msg) throw new Error("active pursuit message not found")
        await msg.update({ "flags.wfrp4e-pursuits.escapeDistance": 100 })
    })
}

test.describe("complex pursuit: exhaustion thresholds", () => {
    test("Athletics: Endurance dialog triggers automatically at round 10 threshold", async ({ fw }) => {
        test.setTimeout(90_000)

        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")

        // Both roll SL=0 each round → each moves 1 yard → gap stays at 5 < 13 (no escape/catch)
        await setEscapeDistance(fw, 13)
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await rollInitiativeOrdered(fw, [quarry, guard])  // Quarry 1 acts first

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // 9 complete rounds — quarry.actionsTaken reaches 9 after this loop
        for (let i = 0; i < 9; i++) {
            await rollNextActive(fw, [quarry, guard], 0)  // quarry rolls
            await rollNextActive(fw, [quarry, guard], 0)  // guard rolls
        }

        // Quarry's 10th roll brings actionsTaken to 10 → checkExhaustion triggers Endurance dialog
        await fw.queueDiceOverride(100, 1, rollForSL(quarry.skill + quarry.moveModifier, 0))
        await fw.clickInLastChatMessageContaining(
            ".pursuit-card.pursuit-round",
            `[data-action="rollSkill"][data-token-uuid="${quarry.tokenUuid}"]`
        )
        await fw.submitDialog()  // Resolve the Athletics pursuit roll

        await fw.queueDiceOverride(100, 1, 15)  // Passing Endurance result → no fatigued
        await fw.submitDialog()  // Resolve the Endurance dialog

        await fw.waitFor(() => {
            const msgs = [...document.querySelectorAll(".chat-message")]
            return msgs.some(m => m.textContent.includes("Endurance")) ? true : null
        }, WAIT_TIMEOUT)
    })

    test("Ride: mount exhaustion message triggers at round 15 threshold", async ({ fw }) => {
        test.setTimeout(120_000)

        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")

        await selectTestType(fw, quarry.tokenUuid, 'Ride')
        await selectTestType(fw, guard.tokenUuid, 'Ride')

        await setEscapeDistance(fw, 13)
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await rollInitiativeOrdered(fw, [quarry, guard])  // Quarry 1 acts first

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // Prevent escape regardless of Ride SL variance (die=5 → SL≥1 for any effective ≥10)
        await setLargeEscapeDistance(fw)

        // 14 complete rounds — quarry.actionsTaken reaches 14 after this loop
        for (let i = 0; i < 14; i++) {
            await rollParticipant(fw, quarry.tokenUuid, 5)
            await rollNextActive(fw, [guard], 0)
        }

        // Quarry's 15th roll brings actionsTaken to 15 → mount exhaustion message posted
        await rollParticipant(fw, quarry.tokenUuid, 5)

        await fw.waitFor(() => {
            const msgs = [...document.querySelectorAll(".chat-message .pursuit-notification")]
            return msgs.some(m => m.textContent.includes("mount")) ? true : null
        }, WAIT_TIMEOUT)
    })

    test("Drive: vehicle exhaustion message triggers at round 18 threshold", async ({ fw }) => {
        test.setTimeout(180_000)

        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")

        await selectTestType(fw, quarry.tokenUuid, 'Drive')
        await selectTestType(fw, guard.tokenUuid, 'Drive')

        await setEscapeDistance(fw, 13)
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await rollInitiativeOrdered(fw, [quarry, guard])  // Quarry 1 acts first

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // Prevent escape regardless of Drive SL variance (die=5 → SL≥1 for any effective ≥10)
        await setLargeEscapeDistance(fw)

        // 17 complete rounds — quarry.actionsTaken reaches 17 after this loop
        for (let i = 0; i < 17; i++) {
            await rollParticipant(fw, quarry.tokenUuid, 5)
            await rollNextActive(fw, [guard], 0)
        }

        // Quarry's 18th roll brings actionsTaken to 18 → vehicle exhaustion message posted
        await rollParticipant(fw, quarry.tokenUuid, 5)

        await fw.waitFor(() => {
            const msgs = [...document.querySelectorAll(".chat-message .pursuit-notification")]
            return msgs.some(m => m.textContent.includes("draft animals")) ? true : null
        }, WAIT_TIMEOUT)
    })
})
