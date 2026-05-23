# Complex Pursuit — Current Flow & Side Effects

Snapshot of how the **complex** pursuit flow is implemented today, written as a reference before re-engineering. The simple flow is parallel but separate (`pursuit-message-simple.mjs` / `pursuit-round-simple.mjs`) and is **not** described here.

Primary files (post-refactor; see `docs/SOURCE-MAP.md` for full export list):
- `src/wfrp4e-pursuits.mjs` — entry point: hook registration, dispatch
- `src/chat/pursuit-complex-setup.mjs` — setup card rendering and setup-phase action handlers
- `src/chat/pursuit-complex-math.mjs` — turn order, distance math (`_complexDistanceMoved`, `_applyPositionDelta`, `_isActiveComplexTurn`, etc.)
- `src/chat/pursuit-complex-render.mjs` — round card rendering, position diagram
- `src/chat/pursuit-complex-catch.mjs` — catch dialog handlers (`onExcludePair`, `onIgnoreQuarry`, `onEndPursuit`, `postCatchMessage`, etc.)
- `src/chat/pursuit-round-complex.mjs` — `applyComplexAction` (unified roll/skip/reroll handler + round advance); re-exports the above for test compatibility
- `src/chat/pursuit-message-complex.mjs` — action dispatch, reroll capture (`onRenderHTML`, `dispatchReroll`, `onTestRolled`)
- `src/chat/pursuit-shared.mjs` — `updateMessage`, token/participant helpers
- `templates/chat/pursuit-setup.hbs` — setup card (shared with simple)
- `templates/chat/pursuit-round-complex.hbs` — round card
- `templates/chat/pursuit-caught.hbs` — per-catch decision dialog

---

## 1. State model

The entire pursuit state lives in **one** `ChatMessage.flags["wfrp4e-pursuits"]` object on the setup/round message. Every state-mutating handler reads the live flags via `game.messages.get(message.id)?.flags`, recomputes everything, rebuilds the HTML, and writes both `content` and the changed flag paths in one `message.update()` (`pursuit-message-complex.mjs:278`, `pursuit-round-complex.mjs:203`, etc).

### Flag fields (top-level keys under `wfrp4e-pursuits`)

| Field              | Shape                                                                                                          | Set by                                                              | Notes |
|--------------------|----------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------|-------|
| `pursuitType`      | `"complex"`                                                                                                    | `createComplexSetupMessage` (`:63`)                                 | Drives `wfrp4e-pursuits.mjs:30` dispatch. |
| `state`            | `"setup"` / `"active"` / `"complete"`                                                                          | `createComplexSetupMessage` (`:65`); `_onStart` (`:280`); various   | `"complete"` is set in three places: `_advanceComplexRound` (`:217`), `processComplexRoll`/`applyComplexReroll` (when last quarry caught), `onEndPursuit` (`:541`), `onExcludePair` when nothing remains (`:473`). |
| `round`            | int ≥ 0                                                                                                        | starts 0 setup, 1 on start, +1 per `_advanceComplexRound`           | |
| `distance`         | int ≥ 0                                                                                                        | recomputed every roll/advance from `min(quarry.position) - max(pursuer.position)`, clamped at 0 | Round card header "Distance: X" reads this. |
| `escapeDistance`   | int (3/5/7/10/13)                                                                                              | environment select on setup; default 7                              | Compared per-render and per-round-end against the same `position` gap. |
| `quarry`           | `Array<Participant>`                                                                                           | `_onJoinQuarry`, `_onRemoveParticipant`, `_onStart`, `_applyPositionDelta`, `_advanceComplexRound` | Holds active quarry only. Escaped/left-behind quarry are removed; **caught** quarry stay here until the catch dialog resolves (then exit via `onExcludePair`) or `onIgnoreQuarry` releases them. |
| `pursuers`         | `Array<Participant>`                                                                                           | `_onJoinPursuers`, `_onRemoveParticipant`, `_onStart`, `_applyPositionDelta`, `_advanceComplexRound`, `onExcludePair` | `onExcludePair` is the only way a pursuer leaves. |
| `roundLog`         | `Array<LogEntry>` (one per completed round)                                                                    | appended in `_advanceComplexRound` (`:184`)                          | Rendered as `<details>` accordion. Contains per-round SL + distMoved per participant; never read back by logic. |
| `slResults`        | `Array<{ tokenUuid, sl, messageIds: string[] }>`                                                              | added in `processComplexRoll` (`:269`); cleared in `_advanceComplexRound` (`:208`); pruned in catch flows | Tracks rolls within the current round. `messageIds` accumulates initial roll + each reroll's chat message id (used for cleanup at round advance and to detect rerolls in `onTestRolled`). |
| `skippedUuids`     | `string[]` (tokenUuids)                                                                                        | `processComplexSkip` (`:366`); cleared in `_advanceComplexRound` (`:209`) | A skipped participant counts as acted *and* as SL = −3 for movement (`slFor` in `_advanceComplexRound:114`). |
| `lastRolledUuid`   | string \| null                                                                                                 | set on every `processComplexRoll`; cleared in `_advanceComplexRound` (`:210`) | Used to delete the previous roll's chat message when a different participant rolls (`pursuit-round-complex.mjs:261-266`). |
| `caughtPending`    | `Array<{...quarry, pursuerTokenUuid, pursuerName}>`                                                            | populated by `processComplexRoll` (`:307`), `applyComplexReroll` (`:373`), `_advanceComplexRound` (`:154`); cleared per quarry by `onExcludePair`/`onIgnoreQuarry` | "Active catch dialog" queue. A quarry in `caughtPending` is **not** counted toward distance or escape checks; it stays in `quarry` too. |
| `ignoredPairs`     | `Array<{ pursuerTokenUuid, quarryTokenUuid }>`                                                                 | appended by `onIgnoreQuarry` (`:488`); pruned in `_advanceComplexRound` (`:187`) when the quarry leaves; pruned in `onExcludePair` (`:449`) | A pursuer doesn't re-catch a quarry it chose to ignore. Read by `_matchPursuerToQuarry` and `_pursuerStatusText`. |
| `awaitingNewRound` | bool                                                                                                           | `processComplexRoll` (`:319`), `applyComplexReroll` (`:419`); reset by `_advanceComplexRound` (`:215`) | All participants acted but the round is **not** advanced yet; the first-by-initiative participant gets a Roll button whose click triggers `_advanceComplexRound` *and then* runs the new round's roll. See §5.4. |

### `Participant` shape

```text
{
    name,            // string — token display name
    tokenUuid,       // string — Token document UUID; primary key
    actorUuid,       // string — Actor UUID for skill/condition lookups
    move,            // number — base Move characteristic OR moveRating override if Ride/Drive
    skill,           // "Athletics" | "Ride" | "Drive"
    moveRating,      // number | null — only meaningful for Ride/Drive
    initiative,      // number — set at start (or on demand) via `_rollParticipantInitiative`
    position,        // number — set in `_onStart`: quarry at startDistance, pursuers at 0
}
```

A `caughtPending` entry is a participant object with two extra keys: `pursuerTokenUuid`, `pursuerName`.

---

## 2. Entry point dispatch

`src/wfrp4e-pursuits.mjs` registers three hooks:

1. **`setup`** — registers the `/pursuit` slash command (`:5-14`). `complex` arg goes to `handlePursuitCommand("complex")` → `createComplexSetupMessage()`.
2. **`ready`** — listens on `game.socket` for `module.wfrp4e-pursuits` reroll messages. Only the GM acts on them (`:17-22`).
3. **`renderChatMessageHTML`** — strips `.gm-only` from non-GMs (`:27`), then dispatches to `simpleOnRenderHTML` / `complexOnRenderHTML` by `flags.pursuitType`. The catch dialog (`pursuit-caught.hbs`) uses `flags.type === "catch"` and is routed to the complex handler (`:30`).
4. **`wfrp4e:rollTest`** — every WFRP test fires this; `onTestRolled` filters to rerolls of pursuit rolls (§6).

`complexOnRenderHTML(message, html)` attaches **one** delegated click listener that resolves `[data-action]` → handler from the `_actions` map (`pursuit-message-complex.mjs:99-110`). There's also a `change` listener that toggles the move-rating row on Ride/Drive selection.

---

## 3. Setup phase (`state === "setup"`)

### 3.1 Card creation
`createComplexSetupMessage()` (`pursuit-message-complex.mjs:53`) posts a new chat message with `state: "setup"` and empty `quarry`/`pursuers`. Initial `distance = 2`, `escapeDistance = 7` (Village).

### 3.2 Setup actions

| Action button (`data-action`) | Handler                  | Effect                                                                                                                                                                                                |
|-------------------------------|--------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `joinQuarry`                  | `_onJoinQuarry`          | `_getSelectedTokens()` (controlled + targeted) → `_tokensToParticipants` → `_mergeParticipants` (dedup by tokenUuid) → re-render. Also reads existing `.participant-skill-select` / move-rating from the DOM so unsaved overrides aren't lost. |
| `joinPursuers`                | `_onJoinPursuers`        | Symmetric.                                                                                                                                                                                            |
| `removeParticipant`           | `_onRemoveParticipant`   | Removes by `data-uuid` + `data-group`.                                                                                                                                                                |
| `rollInitiative`              | `_onRollInitiative`      | GM-only. Rolls `CONFIG.Combat.initiative.formula` against the actor; writes `initiative` onto that participant. Only shown when `wfrp4e.initiativeRule !== "default"` (`renderComplexSetupContent:14-17`). |
| `start`                       | `_onStart`               | See §4.                                                                                                                                                                                               |

### 3.3 Setup-card invariants
- `canStart = quarry.length > 0 && pursuers.length > 0 && allHaveInitiative` (`pursuit-message-complex.mjs:44`).
- The Start button has `data-start-blocked="true"` until `canStart`; `_onStart` re-checks and emits a notification (`:231`).
- `wfrp4e.initiativeRule === "default"` (i.e. WFRP auto-init) means no per-participant init button shows; init is rolled at start time via `ensureInitiative` (`pursuit-message-complex.mjs:257`).

### 3.4 Side effects in setup
- **None outside the chat message.** No actor mutations, no scene effects.

---

## 4. Transition: setup → active (`_onStart`)

`_onStart` (`pursuit-message-complex.mjs:230-288`), GM-only:

1. Read DOM-side overrides (`_readParticipantOverrides`) so skill / move-rating choices the user made but didn't trigger a re-render with are honored.
2. `applyOverrides` — for any participant whose chosen skill is Ride or Drive **and** has a move-rating, replace `p.move` with the move-rating. The mount/vehicle's stat now drives distance.
3. `ensureInitiative` — any participant still missing `initiative` gets one rolled now.
4. Seed positions: every quarry → `position = startDistance`; every pursuer → `position = 0`.
5. Render the round card (`renderComplexRoundContent`) with `round = 1, distance = startDistance, slResults = []`.
6. `message.update()` writes the round HTML and sets `state: "active"`, `round: 1`, the seeded quarry/pursuers, `slResults: []`, plus `distance` and `escapeDistance` snapshotted from the setup card.

After this point the message **is** the round card; no new chat message is created for round transitions.

---

## 5. Active round flow

### 5.1 Render side (`renderComplexRoundContent`, `pursuit-round-complex.mjs:3-81`)

Build pipeline per render:

1. Compute `maxPursuerPos`, `minQuarryPos`.
2. For each quarry/pursuer, enrich with:
   - `moveBonus: 0` (unused in complex — kept for template parity with simple)
   - `movePenalty` — display-only annotation derived from `move` (`_getMovePenalty`: 3 → "(+0)", 2 → "(−20)", 1 → "(−30)", else null).
   - `statusText` — quarry shows "needs to escape X" (escapeDistance − gap), pursuer shows `_pursuerStatusText` (next non-ignored quarry distance, or "has caught up").
   - `sl` / `hasResult` — pulled from `slResults`.
   - `isProne` / `isEntangled` — live actor condition lookup (`actor.hasCondition`).
   - `skipsRoll` — in `skippedUuids`.
3. Merge into `combined[]`, sort by initiative descending. Stable JS sort means **ties preserve original order**, which is `[...quarry, ...pursuers]` in join order — quarry joined before a pursuer wins a tie. Number each row with `initiativeOrder = i + 1`.
4. `firstUnacted` = the first row with `!hasResult && !skipsRoll` **unless** `awaitingNewRound` is set, in which case it's `byInitiative[0]` regardless. That row gets `isActiveTurn = true`.
5. Compute outcome flags:
   - `caught = caughtOverride ?? (distance <= 0)` — only used by the catch-banner template branch; the **authoritative** complete state is the `state` flag.
   - `escaped = escapedOverride ?? (minQuarryPos − maxPursuerPos) >= escapeDistance` — same: display-only.
6. Render the template. The template (`pursuit-round-complex.hbs`):
   - Shows `Round N` badge unless an outcome banner is shown.
   - Renders `combined` rows. Only the `isActiveTurn` row gets a footer with a button. The button text depends on `isProne` → "Stand Up" → `removeCondition[prone]`; `isEntangled` → "Untangle" → `removeCondition[entangled]`; otherwise "Roll" → `rollSkill`.
   - Renders the round log under the rows.

Notably the template **only shows one button at a time** — the active-turn row's. Inactive rows have no buttons in the DOM, so out-of-turn rolls are also a server-side check (§5.3).

### 5.2 Whose turn is it (`_isActiveComplexTurn`, `:574`)

```text
acted = slResults.tokenUuids ∪ skippedUuids
sorted = [...quarry, ...pursuers] sorted by initiative desc (stable)
firstUnacted = first sorted not in acted
return firstUnacted?.tokenUuid === clickedTokenUuid
```

`processComplexRoll` rejects out-of-turn rolls with a UI notification (`:256-259`).

### 5.3 Roll handler (`_onRollSkill` → `processComplexRoll`)

`_onRollSkill` (`pursuit-message-complex.mjs:290-317`):

1. Look up actor by `actorUuid`. Bail with notification if missing.
2. Determine difficulty from participant move: Move ≤ 1 → veryHard; ≤ 2 → hard; ≤ 3 → challenging; else → average.
3. `actor.setupSkill(skillName, { skipTargets: true, fields: { difficulty } })` then `test.roll()`. This posts a WFRP test chat message as a side effect.
4. Extract `sl = Number(test.result?.SL ?? 0)` and `test.context?.messageId` (the new test message's id).
5. Read **live** flags off the pursuit message, then call `processComplexRoll(message, liveData, tokenUuid, sl, messageId)`.

`processComplexRoll` (`pursuit-round-complex.mjs:244-363`):

```text
if awaitingNewRound:
    if rolling participant is first-by-initiative:
        _advanceComplexRound(message, liveData)   ← advances round first
        liveData = re-read fresh flags
    // else: not their turn, falls through to the turn check below

if not _isActiveComplexTurn(liveData, tokenUuid):
    warn and return

if lastRolledUuid && lastRolledUuid !== tokenUuid:
    delete prev roller's test message(s) from chat   ← cleanup

prevSl = current slResults entry for this tokenUuid (null if first roll this round)
newSlResults = current with this token replaced by { tokenUuid, sl, messageIds: [messageId] }
updatedQuarry, updatedPursuers = _applyPositionDelta(...) on both lists
    delta = _complexDistanceMoved(newSl, move) - _complexDistanceMoved(prevSl ?? null, move)
    (when prevSl is null, prevDist = 0 — so the first roll's full distMoved is applied)

freeUpdatedQuarry = updatedQuarry without those already in caughtPending
if rolling participant is a pursuer:
    newlyCaught = freeUpdatedQuarry where prevPos < qPos ≤ newPos   (mid-round catch)

needsDialog = otherActiveQuarry.length > 0
           || newlyCaught.length > 1
           || caughtPending.length > 0

for each newlyCaught:
    drop its SL entry from newSlResults (and queue its test messages for deletion)
    if needsDialog: push to newCaughtPending with the rolling pursuer pinned

allCaughtPending = caughtPending + newCaughtPending
distanceQuarry   = freeUpdatedQuarry minus allCaughtPending minus directlyCaught
newDistance      = max(0, min(distanceQuarry.position) - max(updatedPursuers.position))
                   (0 when distanceQuarry empty)

isComplete             = distanceQuarry.empty && allCaughtPending.empty
waitingForCatchResolve = distanceQuarry.empty && allCaughtPending non-empty

allActed         = !isComplete && !waitingForCatchResolve
                && every participant in (freeUpdatedQuarry ∪ updatedPursuers) in slResults ∪ skipped
newRoundPending  = allActed                         ← sets awaitingNewRound

render round card
updateMessage(...) with:
    content, slResults, lastRolledUuid, quarry (updatedQuarry, includes caughtPending), pursuers,
    distance (newDistance), caughtPending (allCaughtPending), awaitingNewRound (newRoundPending),
    state: "complete" if isComplete

delete queued catch test messages
for each newlyCaught:
    if needsDialog: postCatchMessage(...) → posts pursuit-caught.hbs with type:"catch" flag
    else:           post a plain "{quarry} was caught by {pursuer}" chat message
```

Key invariants & gotchas:
- **Catch detection only fires for pursuers** (mid-round) — quarry rolling forward can never "catch" anyone.
- The "crossed" predicate is `prevPos < qPos && newPos >= qPos` — equality at the new position counts as a catch.
- A roll *modifies* `quarry`/`pursuers` (writes new `position`) and `slResults`. Multiple rolls of the same participant in a round are handled by the `prevSl` delta path (rerolls; see §6).
- `lastRolledUuid` is only used to clean up another participant's previous test message — a chrome-y "remove stale roll chat" detail that's brittle.
- When `isComplete && newlyCaught.length > 0`, the **render** passes `caught: true` so the round card shows the caught banner; but the `state: "complete"` flag is what actually ends the pursuit.

### 5.4 `awaitingNewRound`: the deferred advance

After every roll, `processComplexRoll` checks `allActed`. If true:
- `newRoundPending = allActed` (`:319`), persisted as `awaitingNewRound`.
- The current round card stays visible — `slResults` is **not** cleared.
- Render re-runs, but `firstUnacted` now picks `byInitiative[0]` (because `awaitingNewRound` is set, `:55`). That row gets the "Roll" button.
- When that first-by-initiative participant clicks Roll → `processComplexRoll` runs, sees `awaitingNewRound`, calls `_advanceComplexRound` synchronously, then re-reads `liveData` (now Round N+1 with empty `slResults`) and falls through to do their actual Round N+1 roll.

Reason this exists: it lets a player reroll *after* "everyone has acted" without triggering an immediate round flip. Without it, the last roll would advance and the reroll would land on a fresh round. The behavior in `applyComplexReroll` overrides `requiresImmediateAdvance` when the gap hits 0 or escapeDistance — see §6.

### 5.5 Skip handler (`processComplexSkip`)

Triggered by clicking "Stand Up" / "Untangle" (`_onRemoveCondition` calls `actor.removeCondition` then `processComplexSkip`).

`processComplexSkip` (`pursuit-round-complex.mjs:365-392`):

1. Add `tokenUuid` to `skippedUuids`.
2. Re-render with the updated `skippedUuids`. Render uses `skipFor(uuid) → -3` for movement, so the participant moves 0 yards (see `_complexDistanceMoved`).
3. Persist `skippedUuids`.
4. If `distanceQuarry.length === 0 && caughtPending.length > 0` → return (waiting for catch resolution).
5. If `_allComplexActed` → `_advanceComplexRound` with the fresh flags.

No `awaitingNewRound` path here. A skip can be the trigger that flips the round directly.

### 5.6 Mid-round catch dialog (`pursuit-caught.hbs`)

When `needsDialog` triggers, `postCatchMessage` posts a chat message with `flags.wfrp4e-pursuits.type: "catch"` and the IDs of the quarry, pursuer, and source pursuit message (`pursuit-round-complex.mjs:394-416`). The template shows three buttons:

| Button         | Handler           | Effect |
|----------------|-------------------|--------|
| `excludePair`  | `onExcludePair`   | Removes both the pursuer (from `pursuers`) and the quarry (from `quarry` and `caughtPending`). Cleans `ignoredPairs` of any entries referencing removed participants. Posts a "{quarry} is caught by {pursuer}" narration. Deletes the catch message. If nothing remains → `state: "complete"`. Only shown when `pursuers.length > 1` (`canExclude`). |
| `ignoreQuarry` | `onIgnoreQuarry`  | Removes the quarry from `caughtPending` (back to active play). Appends `{pursuerTokenUuid, quarryTokenUuid}` to `ignoredPairs`. Recomputes distance. Posts narration. Deletes the catch message. |
| `endPursuit`   | `onEndPursuit`    | Sets `state: "complete"`, `distance: 0`. Re-renders the pursuit message with `slResults: []`. Deletes the catch message. |

Important: multiple catch messages can be posted simultaneously (one per `newlyCaught`). They are independent — each has its own data and own decision. The pursuit message stays in `caughtPending` until **all** of them resolve.

---

## 6. End-of-round advance (`_advanceComplexRound`)

Triggered by `processComplexRoll` (via `awaitingNewRound` indirection) or `processComplexSkip` when all have acted.

`_advanceComplexRound` (`pursuit-round-complex.mjs:109-242`), GM-only:

1. Build `slFor(uuid)`: returns `slResults[uuid]` if rolled, else −3 if skipped, else 0.
2. **Apply prone for SL ≤ −5**: iterate quarry ∪ pursuers; if `slFor ≤ −5`, `await actor.addCondition("prone")`. **Side effect on the actor**, persists outside the pursuit message.
3. Compute `pursuableQuarry` (active quarry not in `caughtPending`).
4. **Left-behind**: any quarry with `position < every pursuer.position` → `leftBehindQuarry`. Removed from `quarry`, gets a "is left behind" narration.
5. **Catch**: remaining quarry with `position ≤ maxPursuerPos` → `caughtQuarry`.
6. **Escape**: remaining quarry with gap ≥ escapeDistance → `escapedQuarry`. Removed, gets a "disappears in the distance" narration.
7. `newActiveQuarry` = catchable quarry still in play.
8. `needsDialog = newActiveQuarry.length > 0 || caughtPending.length > 0 || caughtQuarry.length > 1`.
9. If `needsDialog`, every `caughtQuarry` becomes a `caughtPending` entry (matched to a pursuer via `_matchPursuerToQuarry` — closest non-ignored pursuer at or ahead of quarry position). Otherwise the single catch posts a plain narration only.
10. `savedQuarry` = `quarry` minus escaped/left-behind (caught quarry stay because they may still need the dialog).
11. `newDistance` = `max(0, min(freeQuarry.position) - maxPursuerPos)`, or 0 if no free quarry.
12. Build a round log entry with per-participant `{ name, sl, distMoved, newPosition, fell: sl ≤ -5 }`.
13. Render with `round: newRound = round + 1`, `slResults: []`, no catch banner.
14. **Single `message.update()`** writes: new content, `distance`, `round`, `roundLog`, cleared `slResults`/`skippedUuids`/`lastRolledUuid`, updated `quarry`/`pursuers`, `caughtPending`, cleaned `ignoredPairs`, `awaitingNewRound: false`, and `state: "complete"` if `isComplete`.
15. **Cleanup test messages**: every `messageId` from the just-cleared `slResults` is deleted from chat. This is what makes individual roll chat messages disappear when the round flips.
16. Post escape/left-behind narrations (one chat message each).
17. Post catch outcomes: either `postCatchMessage` (dialog) or a plain "was caught by" narration.

### 6.1 `_complexDistanceMoved` (Character Progress Table)

```text
runYards = move * 4
base     = max(1, floor(runYards / 10))     // move 1-3 → base 1; move 4-5 → base 1; move 6+ → 2+
sl ≥ 4   → base + 1
sl ≥ 0   → base
sl ≥ -2  → max(0, base - 1)
else     → 0   // -3, -4: halts; -5+: also gets Prone applied
```

(`pursuit-round-complex.mjs:556-563`.) Note `base` is 1 for all moves ≤ 5 — a Move-7 character with `base = floor(28/10) = 2` is the first tier with a higher base. The escape-distance comparison uses `position` directly, not yards moved.

### 6.2 `_matchPursuerToQuarry`

`pursuit-round-complex.mjs:565-572`: among pursuers at or ahead of the quarry's position, filter out those in `ignoredPairs` for this quarry, then pick the one with the **lowest** position. (Reads as: "closest pursuer behind/at the quarry that hasn't already ignored them".) Returns null if no candidate.

---

## 7. Rerolls

The Foundry test dialog can reroll any previously-rolled test. The module captures rerolls and propagates the new SL into pursuit state.

### 7.1 Capture (`onTestRolled`, `pursuit-message-complex.mjs:447-483`)

Hooked on `wfrp4e:rollTest`. Filters to `test.context?.reroll === true` with a `test.context.previousMessage` ID.

Scan all `game.messages` for an active pursuit (`state === "active"`, `pursuitType` simple or complex) whose `slResults` contains an entry with `previousMessageId` in its `messageIds`. That's the reroll source.

`test.context.messageId` is empty at this point because the new test chat message hasn't been created yet (`renderRollCard` hasn't run). So we register a **one-shot** `Hooks.on("createChatMessage")` that fires when the next test message appears, captures its id, deregisters itself, and dispatches:

```text
payload = { pursuitType, pursuitMsgId, entryTokenUuid, newSl, newMessageId }
if (game.user.isGM) dispatchReroll(payload)
else game.socket.emit(REROLL_SOCKET, { action: "reroll", ...payload })
```

The GM listens on `REROLL_SOCKET` in `Hooks.once("ready")` (`wfrp4e-pursuits.mjs:17-22`) and runs `dispatchReroll` which calls `applyComplexReroll` or `applySimpleReroll`.

### 7.2 `applyComplexReroll` (`pursuit-message-complex.mjs:329-440`)

Read live flags. Replace the matching `slResults` entry: same tokenUuid, new SL, **append** `newMessageId` to its `messageIds`. (Rerolls accumulate message ids so all can be cleaned up at round advance.)

Recompute positions via `_applyPositionDelta(quarry/pursuers, tokenUuid, newSl, prevSl)`. The delta math is `newDist - prevDist` — only the *change* is applied, so consecutive rerolls compose correctly.

Then run the same mid-round catch detection as `processComplexRoll` (§5.3). The reroll can:
- newly cross a quarry → catch fires (with dialog if `needsDialog`)
- move backward (lower SL) → a previously caught quarry could un-catch only if it's still in `quarry` (it is — caught quarry stay) and position is re-derived. **But** `caughtPending` is **not** rolled back when a reroll moves the pursuer back; the catch entry stays in `caughtPending`. (This is a known fragility — there's no test exercising "reroll un-catches".)

The key divergence from `processComplexRoll`:

```js
let requiresImmediateAdvance = false
if (allActed) {
    requiresImmediateAdvance =
        !liveData.awaitingNewRound
        || (distanceQuarry.length > 0 && (newDistance === 0 || newDistance >= escapeDistance))
}
```

Interpretation:
- If we *weren't* already awaiting a new round, the reroll filled in the last action → advance immediately.
- If we *were* awaiting a new round (last roll already filled everyone) **and** the new gap is at 0 or beyond escapeDistance, advance immediately so the outcome (catch / escape) gets resolved without needing a "first by initiative" button click.
- Otherwise stay in `awaitingNewRound`.

At end:
- Update the message with new flags (incl. `caughtPending`, `awaitingNewRound`, `state` if complete).
- Post catch messages for `newlyCaught`.
- If `requiresImmediateAdvance`, run `_advanceComplexRound` with the freshly updated data.

---

## 8. Catalog of side effects

Anything that mutates state *outside* the pursuit chat message:

| Where                                              | Side effect                                                                                           |
|----------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| `_onRollSkill`                                     | `actor.setupSkill` + `test.roll()` → posts a WFRP test chat message; consumes any queued dice override |
| `_onRemoveCondition`                               | `actor.removeCondition(condition)` — persists on the actor                                             |
| `_advanceComplexRound` SL ≤ −5 loop                | `actor.addCondition("prone")` per participant — persists on the actor                                  |
| `_advanceComplexRound` cleanup                     | `game.messages.get(id)?.delete()` for every `slResults.messageIds` entry                               |
| `_advanceComplexRound` escape/left-behind/catch    | `ChatMessage.create(...)` per outcome (narration or `postCatchMessage`)                                |
| `processComplexRoll` (prev roller change)          | `game.messages.get(id)?.delete()` for the previous roller's test message ids                           |
| `processComplexRoll` (caught quarry's own SL)      | `game.messages.get(id)?.delete()` for their already-posted roll, if any                                |
| `processComplexRoll` (catch outcome)               | `ChatMessage.create(...)` for the catch (dialog or narration)                                          |
| `applyComplexReroll` (catch outcome)               | `ChatMessage.create(...)` for the catch                                                                |
| `onExcludePair`                                    | Posts narration `ChatMessage`; deletes the catch dialog message                                        |
| `onIgnoreQuarry`                                   | Posts narration `ChatMessage`; deletes the catch dialog message                                        |
| `onEndPursuit`                                     | Deletes the catch dialog message                                                                       |
| `onTestRolled` reroll path                         | Registers a one-shot `Hooks.on("createChatMessage")` (deregistered inside the callback)                 |
| Reroll dispatch (non-GM)                           | `game.socket.emit(REROLL_SOCKET, ...)` — only the GM client mutates state                              |
| `updateMessage` (non-GM rollers)                   | `warhammer.apps.SocketHandlers.call("updateMessage", ..., "GM")` — GM applies the update remotely      |

Every flag mutation funnels through `message.update(...)` or `updateMessage(message.id, ...)`. The combined HTML+flags update is atomic from Foundry's perspective.

---

## 9. Helpers worth knowing

| Symbol                      | File                               | Purpose |
|-----------------------------|------------------------------------|---------|
| `updateMessage`             | `pursuit-shared.mjs`               | GM does `message.update` directly; others go through `warhammer.apps.SocketHandlers`. |
| `_getSelectedTokens`        | `pursuit-shared.mjs`               | `canvas.tokens.controlled` ∪ user targets (deduped). |
| `_mergeParticipants`        | `pursuit-shared.mjs`               | Concat + dedup by `tokenUuid`; stamps monotonic `joinOrder`. |
| `_readParticipantOverrides` | `pursuit-shared.mjs`               | Reads `.participant-skill-select` + `.participant-move-rating` from the rendered setup card so unsaved overrides survive a re-render. |
| `_isActiveComplexTurn`      | `pursuit-complex-math.mjs`         | Server-side turn enforcement. |
| `_applyPositionDelta`       | `pursuit-complex-math.mjs`         | Delta-based position update; supports rerolls because it computes `newDist − prevDist`. |
| `_complexDistanceMoved`     | `pursuit-complex-math.mjs`         | Character Progress Table. |
| `_matchPursuerToQuarry`     | `pursuit-complex-math.mjs`         | Closest pursuer at/ahead of quarry, excluding `ignoredPairs`. |
| `_pursuerStatusText`        | `pursuit-complex-math.mjs`         | Rendered status under a pursuer's row. |
| `applyComplexAction`        | `pursuit-round-complex.mjs`        | Unified roll/skip/reroll handler; calls `_advanceComplexRound` when all have acted. |
| `postCatchMessage`          | `pursuit-complex-catch.mjs`        | Posts the `pursuit-caught.hbs` decision card. |
| `postEscapeMessage` / `postLeftBehindMessage` | `pursuit-complex-catch.mjs` | Simple narration messages. |
| `renderComplexRoundContent` | `pursuit-complex-render.mjs`       | Builds the round card HTML from state. |
| `dispatchReroll`            | `pursuit-message-complex.mjs`      | Branches on `pursuitType` to `applyComplexAction` (isReroll=true) / `applySimpleReroll`. |

---

## 10. Known fragilities & smells (for the re-engineer)

These came up while documenting; not exhaustive but flagged for attention:

1. **`processComplexRoll` and `applyComplexReroll` duplicate ~70% of their logic** (catch detection, distance recompute, allActed). Drift between them is easy. The reroll path has an extra branch (`requiresImmediateAdvance`) that the initial-roll path doesn't need but the two are otherwise parallel.
2. **`caughtPending` doesn't roll back on a reroll that moves a pursuer back**. A pursuer who initially crossed a quarry, posted a catch dialog, then rerolled to a lower SL that puts them behind again still has the catch dialog open.
3. **`lastRolledUuid` + cross-participant chat-message deletion** is brittle. If two pursuers' rolls interleave (e.g. via socket from different clients), the cleanup target may be stale.
4. **Render-side outcome flags (`caught`, `escaped`) are display-only**. The authoritative completion signal is `state: "complete"`. But `caught`/`escaped` are computed from `position` inside `renderComplexRoundContent`, so a render call with stale data can show a banner that disagrees with `state`. Callers that pass `caughtOverride`/`escapedOverride` (`_advanceComplexRound`, the catch flows) avoid this.
5. **`awaitingNewRound` is a two-step round flip** disguised as a single flag. The first-by-initiative participant's button does *both* the advance and their new-round roll. This is invisible from the UI and surprising in tests.
6. **`postCatchMessage` references `message.id` of the pursuit message**, then `onExcludePair`/`onIgnoreQuarry` re-read it via `game.messages.get(pursuitMessageId)`. If the pursuit message is deleted while a catch dialog is open, the dialog handlers silently no-op.
7. **`_advanceComplexRound` applies `addCondition("prone")` before recomputing left-behind/catch/escape**. A pursuer who rolls SL ≤ −5 is marked prone, then potentially still catches a quarry that same round end. (Probably fine per-spec, but worth being explicit.)
8. **`_matchPursuerToQuarry` returns null when no pursuer is at-or-ahead**, which `_advanceComplexRound` handles by `[]`-flatMap dropping that catch entry entirely. So a catch in the rules-relevant "left behind by all pursuers" edge case silently drops on the floor instead of erroring or being narrated. (In practice this should never happen — `caughtQuarry` is filtered by `position ≤ maxPursuerPos`, so there's always some pursuer at-or-ahead — but the guard exists.)
9. **`renderComplexRoundContent` does N actor-fetches per render** (one per participant for condition lookups). With many participants and frequent rerenders this is wasteful; condition state should ideally be a flag.
10. **`_complexDistanceMoved` puts `base` at 1 for Move 1-5**, which collapses a big chunk of the Move characteristic to identical yardage. This is mathematically faithful to the rules-as-written but is a design wart worth confirming when re-engineering.

---

## 11. State transitions at a glance

```
                ┌─────────┐
   /pursuit ──▶ │  setup  │
                └────┬────┘
                     │ _onStart (canStart=true)
                     ▼
                ┌─────────┐  ──── processComplexRoll ────┐
                │ active  │                              │  (mid-round)
                └────┬────┘  ◀───────── awaitingNewRound ┘
                     │
                     │ _advanceComplexRound
                     │   (allActed && isComplete)
                     │ OR onEndPursuit
                     │ OR onExcludePair (nothing remains)
                     │ OR last quarry caught directly
                     ▼
                ┌──────────┐
                │ complete │
                └──────────┘
```

The catch dialog (`pursuit-caught.hbs`) is a **separate chat message** with `flags.wfrp4e-pursuits.type === "catch"`; it doesn't have a state of its own — it acts on the pursuit message it references.
