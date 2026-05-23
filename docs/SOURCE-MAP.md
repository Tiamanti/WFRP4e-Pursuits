# Source Map

All files under `src/`, their exports, and the import graph. Use this to locate any symbol without re-reading files.

---

## Entry point

### `src/wfrp4e-pursuits.mjs`
No exports. Registers three hooks:
- `setup` → `handlePursuitCommand`
- `ready` → GM socket listener on `REROLL_SOCKET` (handles `reroll`, `deleteMessages`)
- `renderChatMessageHTML` → strips `.gm-only` for non-GMs; routes `flags.pursuitType` to `simpleOnRenderHTML` / `complexOnRenderHTML` (catch dialogs use `flags.type === "catch"` → complex handler)
- `wfrp4e:rollTest` → `onTestRolled`

---

## Apps

### `src/apps/pursuit-type-dialog.mjs`
`PursuitTypeDialog` — ApplicationV2 dialog, prompts user to pick simple vs complex. Used when `/pursuit` is run with no argument.

### `src/apps/obstacle-dialog.mjs`
`openObstacleDialog(maxQuarryPosition)` → `{ obstacleEntry, relativeDistance } | null`

### `src/static/obstacles.mjs`
`OBSTACLE_TABLE` — 15-entry array. Each entry: `{ name, perceivedText, isAutoPerceived, perceptionDifficulty, testToNavigate, testToNavigateUnperceived, navigateSkill, consequencesText, blocksProgress }`.

---

## Commands

### `src/commands/pursuit-command.mjs`
`handlePursuitCommand(type)` — GM-only entry. Routes `"simple"` → `createSimpleSetupMessage`, `"complex"` → `createComplexSetupMessage` (guarded by `wfrp4e-up-in-arms`), else opens `PursuitTypeDialog`.

---

## Chat — shared

### `src/chat/pursuit-shared.mjs`
- `REROLL_SOCKET` = `"module.wfrp4e-pursuits"`
- `updateMessage(id, updateData)` — GM: `message.update()`; non-GM: `warhammer.apps.SocketHandlers.call("updateMessage", …, "GM")`
- `deleteMessages(ids)` — GM: direct delete; non-GM: emit on `REROLL_SOCKET`
- `_getSelectedTokens()` → `canvas.tokens.controlled ∪ game.user.targets`, deduped
- `_tokensToParticipants(tokens)` → participant objects with `name, tokenUuid, actorUuid, move, skill, moveRating, actionsTaken, lastSl, lastActionType, lastActionMessageIds, pronedThisAction`
- `_mergeParticipants(existing, incoming)` — concat + dedup by `tokenUuid`; stamps monotonic `joinOrder` on new entries
- `_readParticipantOverrides(card)` → `{ [tokenUuid]: { skill, moveRating } }` read from rendered setup card DOM

---

## Chat — simple pursuit

### `src/chat/pursuit-simple-setup.mjs`
- `renderSimpleSetupContent({ pursuitType, quarry, pursuers, distance, escapeDistance })`
- `createSimpleSetupMessage()` — creates the setup chat message
- `_onJoinQuarry`, `_onJoinPursuers`, `_onRemoveParticipant`, `_onStart` — setup-phase action handlers

### `src/chat/pursuit-round-simple.mjs`
- `renderSimpleRoundContent({ pursuitType, round, distance, escapeDistance, quarry, pursuers, roundLog, pursuitSkill, slResults, skippedUuids, caught })`
- `resolveSimpleRound(message, data)` — applies SL delta, posts catchup card or advances round
- `_simpleRoundResolvable(quarry, pursuers)` → `bool` — all participants have rolled or skipped
- `_simpleResolutionDelta({ quarry, pursuers, slResults, distance, escapeDistance })` → `{ newDistance, delta, effectivePursuerSl, effectiveQuarrySl }`
- `_postSimpleCatchupMessage(pursuitMessageId, { quarry, pursuers, slResults, distance, escapeDistance })`

### `src/chat/pursuit-simple-capture.mjs`
- `_onAbandonQuarry` — sacrifice one quarry member, remove from pursuit
- `_onIgnoreCaptured` — delete the captured card, resume
- `_onCapturedBySome` — open pursuer-selection card
- `_onDoneCaptureSelect` — remove checked pursuers, resume
- `_onEndSimplePursuit` — set `state: complete`

### `src/chat/pursuit-message-simple.mjs`
- `applySimpleReroll({ pursuitMsgId, entryTokenUuid, newSl, newMessageId })` — replaces SL entry, re-renders
- `onRenderHTML(message, html)` — attaches click handler + skill-select change handler
- Internal: `_onRollSkill`, `_onRemoveCondition`, `_onResolveRound`
- Actions map: `joinQuarry, joinPursuers, removeParticipant, start, resolveRound, rollSkill, removeCondition, abandonQuarry, ignoreCaptured, capturedBySome, doneCaptureSelect, endSimplePursuit`

---

## Chat — complex pursuit

### `src/chat/pursuit-complex-math.mjs`
Pure math and turn-order utilities (no rendering, no Foundry IO beyond `deleteMessages`):
- `_compareTurnOrder(a, b)` — initiative-desc comparator (stable, uses `joinOrder` as tiebreak)
- `_isActiveComplexTurn(data, tokenUuid)` → `bool` — server-side turn enforcement
- `_getMovePenalty(move)` → display string `"(−20)"` etc. or `null`
- `_pursuerStatusText(pursuer, quarry, ignoredPairs)` → human-readable status string
- `_complexDistanceMoved(sl, move)` → yards (Character Progress Table: `floor(move*4/10)` ± SL band)
- `_applyPositionDelta(participants, tokenUuid, newSl, prevSl)` → updated participants array (delta-based, supports rerolls)
- `_matchPursuerToQuarry(quarryMember, pursuers, ignoredPairs)` → closest pursuer at-or-ahead, excluding `ignoredPairs`
- `_finalizePendingAction(participant)` → participant with `lastActionType: null` (clears pending state)

### `src/chat/pursuit-complex-render.mjs`
- `renderComplexRoundContent({ pursuitType, distance, escapeDistance, quarry, pursuers, roundLog, ignoredPairs, caughtPending, obstacles, ...overrides })` → HTML string
- `_buildPositionDiagram(combined, obstacles, maxPursuerPos)` → HTML string for the position diagram
- `_isPerceptionPending(obstacles, tokenUuid)` → `bool` — whether the token has an unresolved perception test

### `src/chat/pursuit-complex-catch.mjs`
- `postCatchMessage(message, quarryEntry, pursuerEntry)` — posts `pursuit-caught.hbs` decision card
- `postEscapeMessage(quarryEntry)` — posts narration chat message
- `postLeftBehindMessage(quarryEntry)` — posts narration chat message
- `onExcludePair(message, ev, target)` — removes pursuer+quarry from pursuit
- `onIgnoreQuarry(message, ev, target)` — releases quarry from `caughtPending`, records `ignoredPairs`
- `onEndPursuit(message, ev, target)` — sets `state: complete`

### `src/chat/pursuit-complex-setup.mjs`
- `renderComplexSetupContent({ pursuitType, quarry, pursuers, distance, escapeDistance, environmentOptions, needsInitiativeRoll })`
- `createComplexSetupMessage()` — creates the setup chat message
- `_rollParticipantInitiative(actor)` → `number` — rolls `CONFIG.Combat.initiative.formula`
- `_onJoinQuarry`, `_onJoinPursuers`, `_onRemoveParticipant`, `_onRollInitiative`, `_onStart` — setup-phase action handlers

### `src/chat/pursuit-round-complex.mjs`
Primary export: `applyComplexAction(message, liveData, tokenUuid, { sl, messageId, isReroll, isSkip })` — the unified roll/skip/reroll handler. Handles turn check, prone toggle, position delta, obstacle navigation, catch detection, round advance.

Re-exports for test compatibility (the actual implementations are in the split files above):
- From `pursuit-complex-math.mjs`: `_isActiveComplexTurn, _complexDistanceMoved, _applyPositionDelta, _matchPursuerToQuarry, _pursuerStatusText, _finalizePendingAction`
- From `pursuit-complex-render.mjs`: `_buildPositionDiagram, _isPerceptionPending, renderComplexRoundContent`
- From `pursuit-complex-catch.mjs`: `onExcludePair, onIgnoreQuarry, onEndPursuit, postCatchMessage`

### `src/chat/pursuit-message-complex.mjs`
- `REROLL_SOCKET` (re-export from `pursuit-shared.mjs`)
- `onRenderHTML(message, html)` — attaches click handler + skill-select change handler
- `dispatchReroll(payload)` — routes to `handlePerceptionReroll`, `applyComplexAction` (reroll), or `applySimpleReroll`
- `onTestRolled(test)` — `wfrp4e:rollTest` hook; captures rerolls via one-shot `createChatMessage` hook
- Internal: `_onRollSkill`, `_onRemoveCondition`, `_onCreateObstacle`, `_onRollPerception`
- Actions map: `joinQuarry, joinPursuers, removeParticipant, rollInitiative, start, rollSkill, removeCondition, createObstacle, rollPerception, excludePair, ignoreQuarry, endPursuit`

---

## Chat — utilities

### `src/chat/exhaustion.mjs`
`checkExhaustion(actor, participant, actionsTaken)` — checks `actionsTaken` against the threshold table (rounds 10/15/18/20–26). Athletics: opens Endurance dialog, applies `fatigued` on failure. Ride/Drive: posts notification + Charm Animal reminder. Called from `_onRollSkill` in `pursuit-message-complex.mjs`.

### `src/chat/obstacles.mjs`
`handlePerceptionReroll(message, liveData, tokenUuid, obstacleId, newMessageId, passed)` — updates the obstacle's `perceptionTests` and `perceivedBy` after a reroll, re-renders. Called from `dispatchReroll`.

---

## Dependency graph (simplified)

```
wfrp4e-pursuits.mjs
├── pursuit-command.mjs → pursuit-simple-setup, pursuit-complex-setup, PursuitTypeDialog
├── pursuit-message-simple.mjs → pursuit-simple-setup, pursuit-simple-capture, pursuit-round-simple, pursuit-shared
└── pursuit-message-complex.mjs → pursuit-complex-setup, pursuit-complex-render, pursuit-complex-catch,
                                   pursuit-round-complex, pursuit-shared, exhaustion, obstacles, obstacle-dialog,
                                   pursuit-message-simple (applySimpleReroll)

pursuit-round-complex.mjs → pursuit-complex-math, pursuit-complex-render, pursuit-complex-catch, pursuit-shared
pursuit-complex-render.mjs → pursuit-complex-math
pursuit-complex-catch.mjs → pursuit-complex-render, pursuit-complex-math, pursuit-shared
pursuit-complex-setup.mjs → pursuit-complex-render, pursuit-shared
pursuit-simple-setup.mjs → pursuit-round-simple, pursuit-shared
pursuit-simple-capture.mjs → pursuit-round-simple
```
