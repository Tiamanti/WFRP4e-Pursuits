import { WAIT_TIMEOUT } from "./timeouts.mjs"

// WFRP4e SL: sl = floor(effectiveSkill/10) - floor(roll/10)
// effectiveSkill = skill + moveModifier (from WFRP4E.difficultyModifiers)
// targetSL=0 must be a +0 pass (roll ≤ skill). Using tens*10+5 overshoots when skill%10 < 5,
// producing a −0 fail instead. Return tens*10 for the zero case — always ≤ skill.
export function rollForSL(effectiveSkill, targetSL) {
    const tens = Math.floor(effectiveSkill / 10) - targetSL
    if (targetSL === 0) return Math.max(1, tens * 10)
    return Math.max(1, tens * 10 + 5)
}

/**
 * Get token UUID, skill value, and characteristics for a named token on the active scene.
 * @param {import("../../src/framework.mjs").FoundryTestFramework} fw
 * @param {string} name - token display name
 * @param {string} skillName - skill to look up (default "Athletics")
 * @returns {Promise<{ tokenUuid: string, skill: number, characteristics: Record<string, number> }>}
 */
export async function getTokenData(fw, name, skillName = "Athletics") {
    const actor = await fw.getActorFromTokenByName(name)
    const skillItem = actor.items.find(i => i.type === "skill" && i.name === skillName)
    if (!skillItem) throw new Error(`getTokenData: actor "${name}" has no skill "${skillName}"`)
    const skill = skillItem.system?.total?.value
    if (skill == null) throw new Error(`getTokenData: skill "${skillName}" on "${name}" has no total value`)
    console.log(skillName, skill)
    const characteristics = Object.fromEntries(
        Object.entries(actor.system?.characteristics ?? {}).map(([k, v]) => [k, v?.value ?? 0])
    )
    return { tokenUuid: actor.tokenUuid, skill, characteristics }
}

// Maps actor move to the difficulty modifier applied by complex _onRollSkill.
// average=+20, challenging=0, hard=-30, veryHard=-40
function _moveModifier(move) {
    if (move <= 1) return -40
    if (move <= 2) return -30
    if (move <= 3) return 0
    return 20
}

/**
 * Like getTokenData but also includes moveModifier for complex pursuit rolls.
 * @param {import("../../src/framework.mjs").FoundryTestFramework} fw
 * @param {string} name
 * @param {string} [skillName]
 * @returns {Promise<{ tokenUuid: string, name: string, skill: number, moveModifier: number, characteristics: Record<string, number> }>}
 */
export async function getComplexTokenData(fw, name, skillName = "Athletics") {
    const actor = await fw.getActorFromTokenByName(name)
    const skillItem = actor.items.find(i => i.type === "skill" && i.name === skillName)
    if (!skillItem) throw new Error(`getComplexTokenData: actor "${name}" has no skill "${skillName}"`)
    const skill = skillItem.system?.total?.value
    if (skill == null) throw new Error(`getComplexTokenData: skill "${skillName}" on "${name}" has no total value`)
    const move = actor.system?.details?.move?.value
    if (move == null) throw new Error(`getComplexTokenData: actor "${name}" has no move value`)
    const characteristics = Object.fromEntries(
        Object.entries(actor.system?.characteristics ?? {}).map(([k, v]) => [k, v?.value ?? 0])
    )
    return { tokenUuid: actor.tokenUuid, name, skill, moveModifier: _moveModifier(move), characteristics }
}

/**
 * Select tokens by name, click to join the pursuit in the given role, and wait for each name to appear.
 * @param {import("../../src/framework.mjs").FoundryTestFramework} fw
 * @param {string[]} names
 * @param {"Quarry" | "Pursuers"} role
 */
export async function joinPursuit(fw, names, role) {
    await fw.selectTokensByName(names)
    await fw.clickInLastChatMessageByText(`Join as ${role}`)
    for (const name of names) {
        await fw.waitForTextInLastChatMessage(name)
    }
}

export async function selectTestType(fw, tokenUuid, type){
    await fw.executeInFoundry((uuid, type) => {
        const card   = document.querySelector(".pursuit-card.pursuit-setup")
        const li     = card.querySelector(`li.participant[data-uuid="${uuid}"]`)
        const select = li.querySelector(".participant-skill-select")
        select.value = type
        select.dispatchEvent(new Event("change", { bubbles: true }))
    }, tokenUuid, type)
    if (type !== "Athletics") {
        await fw.executeInFoundry((uuid) => {
            const card   = document.querySelector(".pursuit-card.pursuit-setup")
            const li     = card.querySelector(`li.participant[data-uuid="${uuid}"]`)
            const input = li.querySelector(".participant-move-rating")
            if (!input) throw new Error(`selectTestType: input not found`)
            input.value = 4
            input.dispatchEvent(new Event("change", { bubbles: true }))
        }, tokenUuid)
    }
}

/**
 * Click the rollInitiative button for every participant currently in the setup card.
 * @param {import("../../src/framework.mjs").FoundryTestFramework} fw
 */
export async function rollAllInitiative(fw) {
    const uuids = await fw.waitFor(() => {
        const btns = [...document.querySelectorAll(".pursuit-card [data-action='rollInitiative']")]
        return btns.length > 0 ? btns.map(b => b.dataset.uuid) : null
    })
    for (const uuid of uuids) {
        await fw.clickInLastChatMessage(`[data-action="rollInitiative"][data-uuid="${uuid}"]`)
    }
}

/**
 * Wait for the active-turn rollSkill button, identify the token, roll it, and return the token.
 * @param {import("../../src/framework.mjs").FoundryTestFramework} fw
 * @param {{ tokenUuid: string, skill: number }[]} tokens
 * @param {number} targetSL
 * @returns {Promise<{ tokenUuid: string, skill: number }>}
 */
export async function rollNextActive(fw, tokens, targetSL) {
    const uuid = await fw.waitFor(() => {
        const btns = document.querySelectorAll(".pursuit-card.pursuit-round [data-action='rollSkill']")
        return btns.length === 1 ? btns[0].dataset.tokenUuid : null
    })
    const token = tokens.find(t => t.tokenUuid === uuid)
    await rollSkill(fw, token, targetSL)
    return token
}

/**
 * Queue a dice override, click the rollSkill button in the round card, and submit the dialog.
 * @param {import("../../src/framework.mjs").FoundryTestFramework} fw
 * @param {{ tokenUuid: string, skill: number }} token
 * @param {number} targetSL
 */
export async function rollSkill(fw, token, targetSL) {
    await fw.queueDiceOverride(100, 1, rollForSL(token.skill + (token.moveModifier ?? 0), targetSL))
    await fw.clickInLastChatMessageContaining(
        ".pursuit-card.pursuit-round",
        `[data-action="rollSkill"][data-token-uuid="${token.tokenUuid}"]`
    )
    await fw.submitDialog()
}

/**
 * Roll initiative in a controlled order so orderedTokens[0] acts first.
 * Queues d10 overrides before each click: rank 0 gets the highest die value.
 * @param {import("../../src/framework.mjs").FoundryTestFramework} fw
 * @param {{ tokenUuid: string }[]} orderedTokens - tokens in desired turn order (first = highest initiative)
 */
export async function rollInitiativeOrdered(fw, orderedTokens) {
    const uuids = await fw.waitFor(() => {
        const btns = [...document.querySelectorAll(".pursuit-card [data-action='rollInitiative']")]
        return btns.length > 0 ? btns.map(b => b.dataset.uuid) : null
    })
    const total = uuids.length
    for (let i = 0; i < uuids.length; i++) {
        const uuid = uuids[i]
        const rank = orderedTokens.findIndex(t => t.tokenUuid === uuid)
        const dieValue = rank === -1 ? 1 : total - rank
        await fw.queueDiceOverride(10, 1, dieValue)
        await fw.clickInLastChatMessage(`[data-action="rollInitiative"][data-uuid="${uuid}"]`)
    }
}

/**
 * Set the escape distance environment via the setup card select.
 * @param {import("../../src/framework.mjs").FoundryTestFramework} fw
 * @param {number} value - numeric escape distance (3=BusyCity, 5=Woodland, 7=Village, 10=Meadow, 13=Desert)
 */
export async function setEscapeDistance(fw, value) {
    await fw.executeInFoundry((val) => {
        const select = document.querySelector(".pursuit-card .pursuit-environment-select")
        if (select) {
            select.value = String(val)
            select.dispatchEvent(new Event("change", { bubbles: true }))
        }
    }, value)
}

/**
 * Apply a condition to a named actor via the Foundry API.
 * @param {import("../../src/framework.mjs").FoundryTestFramework} fw
 * @param {string} actorName
 * @param {string} condition
 */
export async function applyActorCondition(fw, actorName, condition) {
    await fw.executeInFoundry(async (name, cond) => {
        const actor = game.actors.getName(name)
        await actor?.addCondition(cond)
    }, actorName, condition)
}

/**
 * Remove a condition from a named actor via the Foundry API.
 * @param {import("../../src/framework.mjs").FoundryTestFramework} fw
 * @param {string} actorName
 * @param {string} condition
 */
export async function removeActorCondition(fw, actorName, condition) {
    await fw.executeInFoundry(async (name, cond) => {
        const actor = game.actors.getName(name)
        await actor?.removeCondition(cond)
    }, actorName, condition)
}

// ── Pursuit-card visual state helpers ───────────────────────────────────────
// All of these are project-specific: they encode the DOM markers produced by
// pursuit-round*.hbs, pursuit-caught.hbs etc.

const ROUND_CARD = ".pursuit-card.pursuit-round"

/**
 * Wait for the round card's outcome banner of the given kind.
 * @param {import("foundryvtt-test-framework").FoundryTestFramework} fw
 * @param {"caught" | "escaped"} kind
 */
export async function waitForOutcome(fw, kind) {
    await fw.waitForSelector(`${ROUND_CARD} .pursuit-outcome.pursuit-${kind}`)
}

/** Wait for the round card to show no outcome banner (pursuit is still in progress). */
export async function waitForNoOutcome(fw) {
    await fw.waitForNoSelector(`${ROUND_CARD} .pursuit-outcome`)
}

/**
 * Wait for the complex-pursuit catch decision card (excludePair / ignoreQuarry / endPursuit
 * buttons) to be dismissed.
 */
export async function waitForNoCatchDialog(fw) {
    await fw.waitForNoSelector(
        '[data-action="excludePair"], [data-action="ignoreQuarry"], [data-action="endPursuit"]'
    )
}

/**
 * Wait until the participant row in the round card whose name matches `name`
 * displays `SL <sl>` in its .sl-result span.
 * @param {string} name
 * @param {number} sl
 */
export async function waitForRowSL(fw, name, sl) {
    await fw.waitFor((n, expected) => {
        const rows = [...document.querySelectorAll(".pursuit-card.pursuit-round .pursuit-sl-row")]
        const row  = rows.find(r => r.querySelector(".participant-name")?.textContent.trim() === n)
        return row?.querySelector(".sl-result")?.textContent.trim() === expected ? true : null
    }, WAIT_TIMEOUT, name, `SL ${sl}`)
}

/**
 * Wait until the participant row in the round card whose name matches `name`
 * has its .participant-status text equal to `status`.
 * @param {string} name
 * @param {string} status - localized status text, e.g. "is 2 behind quarry"
 */
export async function waitForRowStatus(fw, name, status) {
    await fw.waitFor((n, expected) => {
        const rows = [...document.querySelectorAll(".pursuit-card.pursuit-round .pursuit-sl-row")]
        const row  = rows.find(r => r.querySelector(".participant-name")?.textContent.trim() === n)
        return row?.querySelector(".participant-status")?.textContent.trim() === expected ? true : null
    }, WAIT_TIMEOUT, name, status)
}

/**
 * Wait until the round card's participant-name list satisfies the given assertions.
 * @param {{ includes?: string[], excludes?: string[] }} opts
 */
export async function waitForParticipants(fw, { includes = [], excludes = [] } = {}) {
    await fw.waitFor((inc, exc) => {
        const names = [...document.querySelectorAll(".pursuit-card.pursuit-round .participant-name")]
            .map(n => n.textContent.trim())
        return inc.every(n => names.includes(n)) && exc.every(n => !names.includes(n)) ? true : null
    }, WAIT_TIMEOUT, includes, excludes)
}

// ── Obstacle helpers ─────────────────────────────────────────────────────────

/**
 * Queue a dice override, click the rollPerception button in the round card, and submit the dialog.
 * @param {{ tokenUuid: string }} token
 * @param {number} effectiveSkill - perceptionSkill + difficultyModifier
 * @param {number} targetSL
 */
export async function rollPerception(fw, token, effectiveSkill, targetSL) {
    await fw.queueDiceOverride(100, 1, rollForSL(effectiveSkill, targetSL))
    await fw.clickInLastChatMessageContaining(
        ".pursuit-card.pursuit-round",
        `[data-action="rollPerception"][data-token-uuid="${token.tokenUuid}"]`,
    )
    await fw.submitDialog()
}

/**
 * Open the ObstacleDialog (GM action), select the obstacle by OBSTACLE_TABLE index, set a
 * relative distance from the lead quarry, confirm, and wait for the obstacle node to appear in
 * the position diagram.
 *
 * Assumes the active participant's turn is visible (Create Obstacle button present) and that at
 * least one active participant is NOT yet in navigatedBy (so the node appears in the diagram).
 *
 * @param {number} obstacleIndex - index into OBSTACLE_TABLE
 * @param {number} relativeDistance - yards from lead quarry; negative = closer to pursuers
 */
export async function createObstacle(fw, obstacleIndex, relativeDistance) {
    await fw.waitFor(() =>
        document.querySelector('.pursuit-card.pursuit-round [data-action="createObstacle"]') ? true : null
    )
    await fw.clickInLastChatMessage('[data-action="createObstacle"]')
    await fw.waitFor(() =>
        document.querySelector(".obstacle-dialog .obstacle-select") ? true : null
    )
    await fw.executeInFoundry((idx, dist) => {
        const dialog   = document.querySelector(".obstacle-dialog")
        const select   = dialog.querySelector(".obstacle-select")
        select.value   = String(idx)
        select.dispatchEvent(new Event("change", { bubbles: true }))
        const distInput = dialog.querySelector(".obstacle-distance-input")
        distInput.value = String(dist)
        dialog.querySelector(".obstacle-confirm").click()
    }, obstacleIndex, relativeDistance)
    await waitForObstacleInDiagram(fw)
}

/**
 * Open the ObstacleDialog, select "custom", fill in all fields and confirm.
 * Waits for the obstacle node to appear in the position diagram.
 *
 * @param {{ name?: string, skill?: string, difficulty?: string, consequences?: string, relativeDistance?: number, blocksProgress?: boolean }} opts
 */
export async function createCustomObstacle(fw, {
    name             = "Custom Obstacle",
    skill            = "Athletics",
    difficulty       = "average",
    consequences     = "You stumble.",
    relativeDistance = -4,
    blocksProgress   = false,
} = {}) {
    await fw.waitFor(() =>
        document.querySelector('.pursuit-card.pursuit-round [data-action="createObstacle"]') ? true : null
    )
    await fw.clickInLastChatMessage('[data-action="createObstacle"]')
    await fw.waitFor(() =>
        document.querySelector(".obstacle-dialog .obstacle-select") ? true : null
    )
    await fw.executeInFoundry((opts) => {
        const dialog = document.querySelector(".obstacle-dialog")
        const select = dialog.querySelector(".obstacle-select")
        select.value = "custom"
        select.dispatchEvent(new Event("change", { bubbles: true }))

        const nameInput = dialog.querySelector(".custom-name-input")
        if (nameInput) nameInput.value = opts.name

        const navSkill = dialog.querySelector(".custom-nav-skill")
        if (navSkill) navSkill.value = opts.skill

        const navDiff = dialog.querySelector(".custom-nav-diff")
        if (navDiff) navDiff.value = opts.difficulty

        const cons = dialog.querySelector(".custom-consequences-input")
        if (cons) cons.value = opts.consequences

        const cbx = dialog.querySelector(".obstacle-blocks-progress")
        if (cbx) cbx.checked = opts.blocksProgress

        const distInput = dialog.querySelector(".obstacle-distance-input")
        if (distInput) distInput.value = String(opts.relativeDistance)

        dialog.querySelector(".obstacle-confirm").click()
    }, { name, skill, difficulty, consequences, blocksProgress, relativeDistance })
    await waitForObstacleInDiagram(fw)
}

/** Wait until a `.diagram-node.role-obstacle` node is visible in the round card. */
export async function waitForObstacleInDiagram(fw) {
    await fw.waitForSelector(".pursuit-card.pursuit-round .diagram-node.role-obstacle")
}

/** Wait until no `.diagram-node.role-obstacle` node is visible in the round card. */
export async function waitForNoObstacleInDiagram(fw) {
    await fw.waitForNoSelector(".pursuit-card.pursuit-round .diagram-node.role-obstacle")
}

/** Click the rollSkill button for a participant in the active round card. */
export function clickRollSkill(fw, tokenUuid) {
    return fw.clickInLastChatMessageContaining(
        ".pursuit-card.pursuit-round",
        `[data-action="rollSkill"][data-token-uuid="${tokenUuid}"]`,
    )
}

/** Click the rollPerception button for a participant in the active round card. */
export function clickRollPerception(fw, tokenUuid) {
    return fw.clickInLastChatMessageContaining(
        ".pursuit-card.pursuit-round",
        `[data-action="rollPerception"][data-token-uuid="${tokenUuid}"]`,
    )
}
