import { test, expect } from "../fw.mjs"
import { WAIT_TIMEOUT } from "../timeouts.mjs"
import {
    getTokenData, joinPursuit, rollSkill,
    waitForOutcome, waitForNoOutcome, waitForParticipants,
} from "../helpers.mjs"

// Common round-1 setup for all three tests:
//   Quarry: Thief (move=3) + Scout (move=4), distance=3
//   Rolls: Thief raw SL=-4, Scout raw SL=+1, every pursuer raw SL=0
//
// With Guard (move=4) alone:                                  With Guard (move=4) + Knight (move=5):
//   minQuarryMove=3, minPursuerMove=4                           minQuarryMove=3, minPursuerMove=4
//   Thief eSL=-4+max(0,3-4)=-4, Scout eSL=+1+0=+1               Thief eSL=-4, Scout eSL=+1
//   Guard eSL=0+max(0,4-3)=+1                                   Guard eSL=+1, Knight eSL=0+max(0,5-3)=+2
//   quarryBest=-4, pursuerBest=+1 → dist = clamp(3-5) = 0       quarryBest=-4, pursuerBest=+2 → dist = clamp(3-6) = 0
//
// Both → multi-quarry catch → catchup card. Each candidate's `newDistance` is the
// distance that would result if THAT member is sacrificed (recomputed without their
// roll, floored at 1):
//
//   Guard alone:        sacrifice Thief → 4 (Scout vs Guard with no move bonus → 1−0=+1, 3+1=4)
//                       sacrifice Scout → 1 (Thief vs Guard with Guard +1 from move → −4−1=−5, clamp 0, floor 1)
//   Guard + Knight:     sacrifice Thief → 3 (Scout vs both with Knight +1 → 1−1=0, 3+0=3)
//                       sacrifice Scout → 1 (Thief vs both → −4−2=−6, clamp 0, floor 1)

test.describe("simple pursuit: multi-quarry catchup flow", () => {
    test("All Captured: catchup card lists every quarry member, GM ends pursuit", async ({ fw }) => {
        // Verifies the new catchup card layout: one Sacrifice button per quarry member
        // (each showing the resulting distance), plus an "All captured" button that
        // ends the pursuit immediately.

        const clickInRoundCard        = (sel) => fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-round", sel)
        const clickInNotificationCard = (sel) => fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-notification", sel)

        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Thief"],  "Quarry")
        await joinPursuit(fw, ["Scout"],  "Quarry")
        await joinPursuit(fw, ["Guard"],  "Pursuers")

        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "3")
        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        const thief = await getTokenData(fw, "Thief")
        const scout = await getTokenData(fw, "Scout")
        const guard = await getTokenData(fw, "Guard")

        await rollSkill(fw, thief, -4)
        await rollSkill(fw, scout, 1)
        await rollSkill(fw, guard, 0)

        await clickInRoundCard('[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Distance: 0 / 10")
        await fw.waitForTextInLastChatMessageContaining(
            ".pursuit-card.pursuit-notification",
            "The Quarry can sacrifice a member to gain some distance:",
        )

        // Catchup card has one Sacrifice button per quarry, plus the All captured button
        const candidates = await fw.waitFor((thiefUuid, scoutUuid) => {
            const card = document.querySelector(".pursuit-card.pursuit-notification")
            if (!card) return null
            const sacrificeBtns = [...card.querySelectorAll('[data-action="abandonQuarry"]')]
            const allBtn        = card.querySelector('[data-action="endSimplePursuit"]')
            if (sacrificeBtns.length !== 2 || !allBtn) return null
            return sacrificeBtns.map(b => b.dataset.uuid).sort().join(",") === [thiefUuid, scoutUuid].sort().join(",")
                ? sacrificeBtns.map(b => ({ uuid: b.dataset.uuid, text: b.textContent.trim() }))
                : null
        }, WAIT_TIMEOUT, thief.tokenUuid, scout.tokenUuid)

        // Each button shows the computed newDistance: Thief → 4, Scout → 1
        const byUuid = Object.fromEntries(candidates.map(c => [c.uuid, c.text]))
        expect(byUuid[thief.tokenUuid]).toMatch(/Distance 4/)
        expect(byUuid[scout.tokenUuid]).toMatch(/Distance 1/)

        await clickInNotificationCard('[data-action="endSimplePursuit"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "The Quarry has been caught!")

        // Caught outcome banner closes the round card (no roll/resolve buttons remain)
        await waitForOutcome(fw, "caught")
        await fw.waitForNoSelector('[data-action="rollSkill"], [data-action="resolveRound"]')
    })

    test("Sacrifice Thief → Ignore Captured: Scout continues from the computed distance", async ({ fw }) => {
        // GM picks Thief; pursuit resumes with Scout at the precomputed distance (3 with Guard+Knight).
        // Captured card then lets the pursuers ignore Thief and keep chasing Scout.

        const clickInRoundCard        = (sel) => fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-round", sel)
        const clickInNotificationCard = (sel) => fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-notification", sel)

        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Thief"], "Quarry")
        await joinPursuit(fw, ["Scout"], "Quarry")
        await joinPursuit(fw, ["Guard", "Knight"], "Pursuers")

        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "3")
        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        const thief  = await getTokenData(fw, "Thief")
        const scout  = await getTokenData(fw, "Scout")
        const guard  = await getTokenData(fw, "Guard")
        const knight = await getTokenData(fw, "Knight")

        await rollSkill(fw, thief,  -4)
        await rollSkill(fw, scout,   1)
        await rollSkill(fw, guard,   0)
        await rollSkill(fw, knight,  0)

        await clickInRoundCard('[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(
            ".pursuit-card.pursuit-notification",
            "The Quarry can sacrifice a member to gain some distance:",
        )

        // Click the Sacrifice button for Thief (specifically, via data-uuid)
        await clickInNotificationCard(`[data-action="abandonQuarry"][data-uuid="${thief.tokenUuid}"]`)
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-notification", "Thief falls into the Pursuers' hands")

        await clickInNotificationCard('[data-action="ignoreCaptured"]')

        // Captured + catchup cards are gone — no decision buttons left in chat
        await fw.waitForNoSelector(
            '[data-action="ignoreCaptured"], [data-action="capturedBySome"], [data-action="abandonQuarry"]'
        )

        // Round card shows the precomputed distance, no outcome banner, only Scout in quarry,
        // Guard + Knight still chasing
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Distance: 3 / 10")
        await waitForNoOutcome(fw)
        await waitForParticipants(fw, {
            includes: ["Scout", "Guard", "Knight"],
            excludes: ["Thief"],
        })
    })

    test("Sacrifice Thief → Captured by Some: only Guard stops, Knight continues with Scout", async ({ fw }) => {
        // GM picks Thief; captured card lets pursuers choose who stops to detain them.
        // Guard's checkbox is selected → Guard is removed from active pursuers, Knight continues.

        const clickInRoundCard        = (sel) => fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-round", sel)
        const clickInNotificationCard = (sel) => fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-notification", sel)

        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Thief"], "Quarry")
        await joinPursuit(fw, ["Scout"], "Quarry")
        await joinPursuit(fw, ["Guard", "Knight"], "Pursuers")

        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "3")
        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        const thief  = await getTokenData(fw, "Thief")
        const scout  = await getTokenData(fw, "Scout")
        const guard  = await getTokenData(fw, "Guard")
        const knight = await getTokenData(fw, "Knight")

        await rollSkill(fw, thief,  -4)
        await rollSkill(fw, scout,   1)
        await rollSkill(fw, guard,   0)
        await rollSkill(fw, knight,  0)

        await clickInRoundCard('[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(
            ".pursuit-card.pursuit-notification",
            "The Quarry can sacrifice a member to gain some distance:",
        )

        await clickInNotificationCard(`[data-action="abandonQuarry"][data-uuid="${thief.tokenUuid}"]`)
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-notification", "Thief falls into the Pursuers' hands")

        await clickInNotificationCard('[data-action="capturedBySome"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-notification", "Select those who stop to capture Thief")

        await clickInNotificationCard(`input[name="pursuer"][value="${guard.tokenUuid}"]`)
        await clickInNotificationCard('[data-action="doneCaptureSelect"]')

        // Capture-select card dismissed — no checkboxes or doneCaptureSelect button left
        await fw.waitForNoSelector('[data-action="doneCaptureSelect"]')

        // Round card: Scout sole quarry, Knight sole pursuer, distance=3
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Distance: 3 / 10")
        await waitForParticipants(fw, {
            includes: ["Scout", "Knight"],
            excludes: ["Thief", "Guard"],
        })
    })

    test("captured card endSimplePursuit ends the pursuit", async ({ fw }) => {
        // _onEndSimplePursuit (`pursuit-message-simple.mjs`) is reachable from
        // two cards: the catchup card (covered by test 1 "All Captured") and
        // the captured card (`pursuit-simple-captured.hbs`). This test covers
        // the second path.

        const clickInRoundCard        = (sel) => fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-round", sel)
        const clickInNotificationCard = (sel) => fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-notification", sel)

        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Thief"], "Quarry")
        await joinPursuit(fw, ["Scout"], "Quarry")
        await joinPursuit(fw, ["Guard", "Knight"], "Pursuers")

        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "3")
        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        const thief  = await getTokenData(fw, "Thief")
        const scout  = await getTokenData(fw, "Scout")
        const guard  = await getTokenData(fw, "Guard")
        const knight = await getTokenData(fw, "Knight")

        await rollSkill(fw, thief,  -4)
        await rollSkill(fw, scout,   1)
        await rollSkill(fw, guard,   0)
        await rollSkill(fw, knight,  0)

        await clickInRoundCard('[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(
            ".pursuit-card.pursuit-notification",
            "The Quarry can sacrifice a member to gain some distance:",
        )

        // Sacrifice Thief → captured card surfaces
        await clickInNotificationCard(`[data-action="abandonQuarry"][data-uuid="${thief.tokenUuid}"]`)
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-notification", "Thief falls into the Pursuers' hands")

        // Click endSimplePursuit on the captured card (the second of three buttons there)
        await clickInNotificationCard('[data-action="endSimplePursuit"]')

        // Captured card removed; round card shows caught banner; no roll/resolve left
        await fw.waitForNoSelector(
            '[data-action="ignoreCaptured"], [data-action="capturedBySome"], [data-action="endSimplePursuit"]'
        )
        await waitForOutcome(fw, "caught")
        await fw.waitForNoSelector('[data-action="rollSkill"], [data-action="resolveRound"]')
    })
})
