import { test } from "../fw.mjs"
import { getTokenData, joinPursuit, rollSkill } from "../helpers.mjs"

test.describe("simple pursuit: catch scenario", () => {
    test("Knight (move 5) catches Thief (move 3) after 2 rounds", async ({ fw }) => {
        const clickInRoundCard = (sel) => fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-round", sel)

        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Thief"], "Quarry")
        await joinPursuit(fw, ["Knight"], "Pursuers")

        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "4")

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        const thief  = await getTokenData(fw, "Thief")
        const knight = await getTokenData(fw, "Knight")

        // Round 1: Thief raw SL=1, Knight raw SL=1
        // minQuarryMove=3, minPursuerMove=5
        // Thief eSL = 1 + max(0, 3−5) = 1, Knight eSL = 1 + max(0, 5−3) = 3
        // quarryBest=1, pursuerBest=3 → distance = 4+(1−3) = 2
        await rollSkill(fw, thief, 1)
        await rollSkill(fw, knight, 1)

        await clickInRoundCard('[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Distance: 2 / 10")

        // Round 2: Thief raw SL=0, Knight raw SL=1
        // Thief eSL=0, Knight eSL=1+2=3 → distance = 2+(0−3) = −1 → clamped to 0 → caught
        await rollSkill(fw, thief, 0)
        await rollSkill(fw, knight, 1)

        await clickInRoundCard('[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Distance: 0 / 10")
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "The Quarry has been caught!")
    })

    test("two pursuers: best pursuer SL determines advance (3-round flow)", async ({ fw }) => {
        const clickInRoundCard = (sel) => fw.clickInLastChatMessageContaining(".pursuit-card.pursuit-round", sel)

        await fw.sendChatCommand("/pursuit simple")
        await fw.waitForTextInLastChatMessage("Simple Pursuit")

        await joinPursuit(fw, ["Scout"], "Quarry")
        await joinPursuit(fw, ["Guard 1", "Guard 2"], "Pursuers")

        await fw.writeInLastChatMessageContaining(".pursuit-card", ".start-distance-input", "7")

        await fw.clickInLastChatMessage('[data-action="start"]')
        await fw.waitForTextInLastChatMessage("Resolve Round")

        const scout  = await getTokenData(fw, "Scout")
        const guard1 = await getTokenData(fw, "Guard 1")
        const guard2 = await getTokenData(fw, "Guard 2")

        // All move=4, no move bonuses. pursuerBest = max(Guard1 eSL, Guard2 eSL).
        //
        // Round 1: Scout=+1, Guard1=−1, Guard2=+3 → pursuerBest=3, distance 7+(1−3)=5
        await rollSkill(fw, scout, 1)
        await rollSkill(fw, guard1, -1)
        await rollSkill(fw, guard2, 3)

        await clickInRoundCard('[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Distance: 5 / 10")

        // Round 2: Scout=0, Guard1=+2, Guard2=+1 → pursuerBest=2, distance 5+(0−2)=3
        await rollSkill(fw, scout, 0)
        await rollSkill(fw, guard1, 2)
        await rollSkill(fw, guard2, 1)

        await clickInRoundCard('[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Distance: 3 / 10")

        // Round 3: Scout=−1, Guard1=0, Guard2=+2 → pursuerBest=2, distance 3+(−1−2)=0 → caught
        await rollSkill(fw, scout, -1)
        await rollSkill(fw, guard1, 0)
        await rollSkill(fw, guard2, 2)

        await clickInRoundCard('[data-action="resolveRound"]')
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "Distance: 0 / 10")
        await fw.waitForTextInLastChatMessageContaining(".pursuit-card.pursuit-round", "The Quarry has been caught!")
    })
})
