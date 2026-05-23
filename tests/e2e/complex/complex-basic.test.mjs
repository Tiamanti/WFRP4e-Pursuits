import { test } from "../fw.mjs"
import { WAIT_TIMEOUT } from "../timeouts.mjs"
import { getComplexTokenData, getTokenData, joinPursuit, rollAllInitiative, rollNextActive, rollSkill } from "../helpers.mjs"

// Requires the wfrp4e-up-in-arms module to be active in the test world.
//
// Key mechanics (move=4 participants, base=max(1,floor(16/10))=1):
//   SL >= 4  → 2 yards    SL 0–3 → 1 yard    SL -1,-2 → 0 yards    SL <= -3 → 0 yards
// Positions: quarry starts at startDistance, pursuers at 0.
// Turn order: sorted by initiative (descending), one participant acts at a time.
// Auto-advance: fires when every participant has rolled or been skipped —
//               no manual "Resolve Round" needed for normal flow.

test.describe("complex pursuit: basic flow", () => {
    test("two participants roll in initiative order; positions update; round auto-advances", async ({ fw }) => {
        // Setup: Quarry 1 (move=4) + Guard 1 (move=4), startDistance=5, escapeDistance=7 (Village default)
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await rollAllInitiative(fw)

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")
        const tokens = [quarry, guard]

        // Round 1: first SL=1 → +1 yard, second SL=2 → +1 yard
        // gap=5 < 7 → no escape; no catch. In continuous-turn flow, "Round 2"
        // appears as soon as both have completed action 1 — the displayRound
        // derives from the next-to-act participant's actionsTaken+1.
        await rollNextActive(fw, tokens, 1)
        await rollNextActive(fw, tokens, 2)

        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 2")

        // Lockout invariant: at most one participant (the latest roller) has
        // a visible SL badge at any time. We don't assert "no SL results" —
        // that was the round-flip-clears-slResults check from the old model,
        // which doesn't apply in continuous flow.

        // Round 2: first SL=3 → +1 yard, second SL=0 → +1 yard; gap stays 5 → no escape
        await rollNextActive(fw, tokens, 3)
        await rollNextActive(fw, tokens, 0)

        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 3")
    })

    test("only the active-turn participant can roll; others' buttons are inactive", async ({ fw }) => {
        // Setup: Quarry 1 + Guard 1, startDistance=5, escapeDistance=7
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await rollAllInitiative(fw)

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")

        // Exactly one rollSkill button visible; the active-turn participant owns it
        const activeUuid = await fw.waitFor(() => {
            const btns = document.querySelectorAll(".pursuit-card.pursuit-round [data-action='rollSkill']")
            return btns.length === 1 ? btns[0].dataset.tokenUuid : null
        })

        const activeToken   = activeUuid === quarry.tokenUuid ? quarry : guard
        const inactiveToken = activeUuid === quarry.tokenUuid ? guard : quarry

        // Roll the active participant
        await rollSkill(fw, activeToken, 1)

        // Exactly one .sl-result is rendered, and it lives in the active token's row
        await fw.waitFor((activeName) => {
            const results = document.querySelectorAll(".pursuit-card.pursuit-round .sl-result")
            if (results.length !== 1) return null
            const rows = [...document.querySelectorAll(".pursuit-card.pursuit-round .pursuit-sl-row")]
            const activeRow = rows.find(r => r.querySelector(".participant-name")?.textContent.trim() === activeName)
            return activeRow?.querySelector(".sl-result") ? true : null
        }, WAIT_TIMEOUT, activeToken.name)

        // Inactive participant's rollSkill button is now the only visible one
        await fw.waitFor((inactive) => {
            const btns = document.querySelectorAll(".pursuit-card.pursuit-round [data-action='rollSkill']")
            return btns.length === 1 && btns[0].dataset.tokenUuid === inactive ? true : null
        }, WAIT_TIMEOUT, inactiveToken.tokenUuid)
    })

    test("round log records per-round distances and movements after each auto-advance", async ({ fw }) => {
        // Setup: Quarry 1 (move=4) + Guard 1 (move=4), startDistance=5, escapeDistance=7
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")
        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await rollAllInitiative(fw)

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")
        const tokens = [quarry, guard]

        // Round 1: first SL=1 → +1 yd, second SL=2 → +1 yd → distance 5→5 (+0)
        await rollNextActive(fw, tokens, 1)
        await rollNextActive(fw, tokens, 2)
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 2")

        // Round 2: first SL=2 → +1 yd, second SL=1 → +1 yd → distance 5→5 (+0)
        await rollNextActive(fw, tokens, 2)
        await rollNextActive(fw, tokens, 1)
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 3")

        // Round log has entries for both completed rounds
        await fw.waitFor(() => {
            const logEl = document.querySelector(".pursuit-round .pursuit-round-log")
            const text = logEl?.textContent ?? ""
            return text.includes("Round 1:") && text.includes("Round 2:") ? true : null
        })

        // Both log entry summaries show "+0" distance change (5 → 5 each round)
        await fw.waitFor(() => {
            const summaries = [...document.querySelectorAll(".pursuit-round .round-log-entry summary")]
            return summaries.length >= 2 && summaries.every(s => s.textContent.includes("+0"))
                ? true : null
        })

        // Open all log entries so their SL detail rows are in the visible DOM
        await fw.waitFor(() => {
            const entries = [...document.querySelectorAll(".pursuit-round .round-log-entry")]
            if (entries.length < 2) return null
            entries.forEach(e => e.open = true)
            return true
        })

        // Log rows include the SL values and yards-moved values from both rounds
        // (SL 1 → +1 and SL 2 → +1 each appear at least once across the two rounds)
        await fw.waitFor(() => {
            const logEl = document.querySelector(".pursuit-round .pursuit-round-log")
            const text = logEl?.textContent ?? ""
            return text.includes("SL 1 → +1") && text.includes("SL 2 → +1") ? true : null
        })
    })

    test("removeParticipant strips a joined token from the setup card", async ({ fw }) => {
        // _onRemoveParticipant in both pursuit-message-{simple,complex}.mjs.
        // Same template handler in both flows; covered here from the complex
        // setup card. Asserts both the [data-group="quarry"] and
        // [data-group="pursuers"] branches and the empty-list fallback.
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1", "Thief"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")

        const thief = await getComplexTokenData(fw, "Thief")
        const guard = await getComplexTokenData(fw, "Guard 1")

        // Remove Thief from quarry; Quarry 1 remains.
        await fw.clickInLastChatMessage(
            `[data-action="removeParticipant"][data-group="quarry"][data-uuid="${thief.tokenUuid}"]`
        )
        await fw.waitFor((thiefName, q1Name) => {
            const names = [...document.querySelectorAll(".pursuit-card.pursuit-setup .quarry-group .participant-name")]
                .map(n => n.textContent.trim())
            return !names.includes(thiefName) && names.includes(q1Name) ? true : null
        }, WAIT_TIMEOUT, "Thief", "Quarry 1")

        // Remove Guard 1 from pursuers; the empty-state placeholder appears.
        await fw.clickInLastChatMessage(
            `[data-action="removeParticipant"][data-group="pursuers"][data-uuid="${guard.tokenUuid}"]`
        )
        await fw.waitForSelector(".pursuit-card.pursuit-setup .pursuers-group .participant-empty")
    })

    test("Ride skill selection applies moveRating override at start", async ({ fw }) => {
        // Setup-card UI lets the GM override a participant's Move by picking
        // Ride/Drive and entering a Move Rating (mount or vehicle stat).
        // _onStart's applyOverrides branch substitutes moveRating for p.move
        // when the chosen skill is Ride or Drive.
        //
        // The test world's tokens all use Athletics + Move=4, so this test
        // injects the override via DOM (the same path the GM clicks through)
        // and then verifies the round card reflects the boosted Move via the
        // moveBonus chip — Quarry 1 with overridden move=7 vs Guard 1 (move=4)
        // yields a +3 moveBonus in the simple-flow rendering.
        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")

        const quarry = await getTokenData(fw, "Quarry 1")

        // Switch Quarry 1's skill to Ride and type a Move Rating of 7.
        // The change event on the skill select toggles the move-rating row's
        // display (see pursuit-message-simple.mjs#onRenderHTML).
        await fw.executeInFoundry((quarryUuid, moveRating) => {
            const card   = document.querySelector(".pursuit-card.pursuit-setup")
            const li     = card.querySelector(`li.participant[data-uuid="${quarryUuid}"]`)
            const select = li.querySelector(".participant-skill-select")
            select.value = "Ride"
            select.dispatchEvent(new Event("change", { bubbles: true }))
            const input = li.querySelector(".participant-move-rating")
            input.value = String(moveRating)
        }, quarry.tokenUuid, 7)

        // Verify the move-rating row is now visible (display !== "none")
        await fw.waitFor((quarryUuid) => {
            const li  = document.querySelector(`.pursuit-card.pursuit-setup li.participant[data-uuid="${quarryUuid}"]`)
            const row = li?.querySelector(".participant-move-rating-row")
            return row && row.style.display !== "none" ? true : null
        }, WAIT_TIMEOUT, quarry.tokenUuid)

        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        // Round card: Quarry 1 row shows a +3 moveBonus chip (move=7 − 4 = 3).
        // Without the override the chip would be absent (Quarry 1 default move=4
        // matches Guard 1's, so moveBonus would be 0 → no .participant-bonus rendered).
        await fw.waitFor((name) => {
            const rows = [...document.querySelectorAll(".pursuit-card.pursuit-round .pursuit-sl-row")]
            const row  = rows.find(r => r.querySelector(".participant-name")?.textContent.trim() === name)
            const bonus = row?.querySelector(".participant-bonus")?.textContent.trim()
            return bonus === "+3" ? true : null
        }, WAIT_TIMEOUT, "Quarry 1")
    })

    test("ties in initiative roll fall back to join order (stable sort)", async ({ fw }) => {
        // Both _isActiveComplexTurn (pursuit-round-complex.mjs:564) and
        // renderComplexRoundContent (pursuit-round-complex.mjs:48) sort with
        // `(b.initiative ?? 0) - (a.initiative ?? 0)`. V8's sort is stable
        // since ES2019, so ties preserve the original array order
        // (`[...quarry, ...pursuers]`, each group in join order). Effect: a
        // quarry joined before a pursuer wins a tie and gets initiativeOrder=1.
        //
        // The wfrp4e initiative formula uses each actor's `i + ag/100`, so
        // equal d10 rolls don't guarantee equal totals across different stat
        // blocks. To make the test independent of the test world's actor
        // characteristics, roll initiative normally first (so the re-render
        // clears `data-start-blocked` on the start button) and then overwrite
        // both initiatives to the same value via the message flags before
        // clicking start.
        await fw.sendChatCommand("/pursuit complex")
        await fw.waitForTextInLastChatMessage("Complex Pursuit")

        await joinPursuit(fw, ["Quarry 1"], "Quarry")
        await joinPursuit(fw, ["Guard 1"], "Pursuers")

        const quarry = await getComplexTokenData(fw, "Quarry 1")
        const guard  = await getComplexTokenData(fw, "Guard 1")

        await rollAllInitiative(fw)

        // Force both to the same initiative value. The start button is already
        // enabled (both rolled), so the flag-only update doesn't need to trigger
        // a re-render to clear data-start-blocked.
        await fw.executeInFoundry(async (qUuid, gUuid) => {
            const msg = game.messages.contents
                .filter(m => m.flags?.["wfrp4e-pursuits"]?.state === "setup")
                .at(-1)
            if (!msg) throw new Error("setup message not found")
            const data = msg.flags["wfrp4e-pursuits"]
            const newQuarry   = (data.quarry   ?? []).map(p => p.tokenUuid === qUuid ? { ...p, initiative: 50 } : p)
            const newPursuers = (data.pursuers ?? []).map(p => p.tokenUuid === gUuid ? { ...p, initiative: 50 } : p)
            await msg.update({
                "flags.wfrp4e-pursuits.quarry":   newQuarry,
                "flags.wfrp4e-pursuits.pursuers": newPursuers,
            })
        }, quarry.tokenUuid, guard.tokenUuid)

        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "5")
        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Round 1")

        // Quarry 1 owns the only rollSkill button (joined before Guard 1 →
        // wins the tie via stable sort).
        await fw.waitFor((quarryUuid) => {
            const btns = document.querySelectorAll(".pursuit-card.pursuit-round [data-action='rollSkill']")
            return btns.length === 1 && btns[0].dataset.tokenUuid === quarryUuid ? true : null
        }, WAIT_TIMEOUT, quarry.tokenUuid)

        // initiative-badge on Quarry 1's row reads "1"; Guard 1's reads "2"
        await fw.waitFor(() => {
            const rows = [...document.querySelectorAll(".pursuit-card.pursuit-round .pursuit-sl-row")]
            const qRow = rows.find(r => r.querySelector(".participant-name")?.textContent.trim() === "Quarry 1")
            const gRow = rows.find(r => r.querySelector(".participant-name")?.textContent.trim() === "Guard 1")
            return qRow?.querySelector(".initiative-badge")?.textContent.trim() === "1"
                && gRow?.querySelector(".initiative-badge")?.textContent.trim() === "2"
                ? true : null
        })
    })
})
