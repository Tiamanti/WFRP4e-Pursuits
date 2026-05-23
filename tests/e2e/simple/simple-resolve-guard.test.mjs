import { test } from "../fw.mjs"
import { getTokenData, joinPursuit, rollSkill } from "../helpers.mjs"

test.describe("simple pursuit: Resolve Round is gated on all participants acting", () => {
    test("button is disabled until every participant rolls, then enabled", async ({ fw }) => {
        // pursuit-round.hbs renders the Resolve Round button with `disabled` whenever
        // _simpleRoundResolvable returns false. The flag is recomputed on every render,
        // so the disabled attribute disappears once every participant has acted.

        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"],  "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        // Initially: nobody has rolled → button is disabled
        await fw.waitFor(() => {
            const btn = document.querySelector('.pursuit-card.pursuit-round [data-action="resolveRound"]')
            return btn && btn.disabled ? true : null
        })

        const quarry = await getTokenData(fw, "Quarry 1")
        const guard  = await getTokenData(fw, "Guard 1")

        // After only quarry rolls: still disabled (guard hasn't acted)
        await rollSkill(fw, quarry, 1)
        await fw.waitFor(() => {
            const btn = document.querySelector('.pursuit-card.pursuit-round [data-action="resolveRound"]')
            return btn && btn.disabled ? true : null
        })

        // After both roll: button is enabled
        await rollSkill(fw, guard, 0)
        await fw.waitFor(() => {
            const btn = document.querySelector('.pursuit-card.pursuit-round [data-action="resolveRound"]')
            return btn && !btn.disabled ? true : null
        })

        // Clicking through resolves the round (distance changes; round badge advances)
        await fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-round", '[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 2")
    })

    test("Stand Up counts as 'acted': a skipped participant doesn't block Resolve Round", async ({ fw }) => {
        // Apply prone to Quarry 1 first so the round card renders a Stand Up button in
        // place of the roll button. Clicking it adds the participant to skippedUuids,
        // which _simpleRoundResolvable treats as acted.

        // Apply prone via the wfrp4e API
        await fw.executeInFoundry(async () => {
            const actor = game.actors.getName("Quarry 1")
            await actor?.addCondition("prone")
        })

        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"],  "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        // Quarry 1 shows Stand Up in place of Roll; resolve button still disabled (Guard pending)
        await fw.waitForSelector('.pursuit-card.pursuit-round [data-action="removeCondition"][data-condition="prone"]')
        await fw.waitFor(() => {
            const btn = document.querySelector('.pursuit-card.pursuit-round [data-action="resolveRound"]')
            return btn && btn.disabled ? true : null
        })

        // Click Stand Up — Quarry 1 is now "skipped" rather than rolled. Resolve is still
        // disabled because Guard hasn't acted.
        await fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-round",
            '[data-action="removeCondition"][data-condition="prone"]'
        )

        const guard = await getTokenData(fw, "Guard 1")
        await rollSkill(fw, guard, 0)

        // Both have acted (Quarry skipped, Guard rolled) → resolve enabled
        await fw.waitFor(() => {
            const btn = document.querySelector('.pursuit-card.pursuit-round [data-action="resolveRound"]')
            return btn && !btn.disabled ? true : null
        })

        // Cleanup: ensure Quarry 1 is no longer prone if something downstream depends on it
        await fw.executeInFoundry(async () => {
            const actor = game.actors.getName("Quarry 1")
            await actor?.removeCondition("prone")
        })
    })

    test("Untangle button on simple round card counts as 'acted'", async ({ fw }) => {
        // Mirror of the Stand-Up test above for the `isEntangled` branch of
        // pursuit-round.hbs. Same flow as prone: condition swaps the Roll
        // button for an Untangle button, clicking it adds the participant to
        // skippedUuids, and skipped counts as acted in _simpleRoundResolvable.

        await fw.executeInFoundry(async () => {
            const actor = game.actors.getName("Quarry 1")
            await actor?.addCondition("entangled")
        })

        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"],  "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        await fw.waitForSelector('.pursuit-card.pursuit-round [data-action="removeCondition"][data-condition="entangled"]')
        await fw.waitFor(() => {
            const btn = document.querySelector('.pursuit-card.pursuit-round [data-action="resolveRound"]')
            return btn && btn.disabled ? true : null
        })

        // Click Untangle — Quarry 1 becomes skipped
        await fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-round",
            '[data-action="removeCondition"][data-condition="entangled"]'
        )

        const guard = await getTokenData(fw, "Guard 1")
        await rollSkill(fw, guard, 0)

        // Both have acted (Quarry skipped, Guard rolled) → resolve enabled
        await fw.waitFor(() => {
            const btn = document.querySelector('.pursuit-card.pursuit-round [data-action="resolveRound"]')
            return btn && !btn.disabled ? true : null
        })

        // Cleanup — actor would otherwise carry the condition between tests.
        await fw.executeInFoundry(async () => {
            const actor = game.actors.getName("Quarry 1")
            await actor?.removeCondition("entangled")
        })
    })
})
