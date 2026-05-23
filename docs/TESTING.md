# E2E Test Catalog

End-to-end suite for the WFRP4e Pursuits module. Tests drive a real Foundry
instance via `foundryvtt-test-framework` (Puppeteer-based) and assert on chat
card DOM rather than module flags.

- Runner config: `vitest.e2e.config.mjs` (forks pool, `singleFork: true`,
  60 s per-test / 120 s hook timeouts).
- Token table & prerequisites: `tests/e2e/SETUP.md`. Requires a populated
  `tests/e2e/config.mjs` (copy from `config.example.mjs`), a running Foundry
  install, the wfrp4e system, the `wfrp4e-pursuits` module, and (for complex
  flows) the `wfrp4e-up-in-arms` module.

## File map

| File | Scenarios | Code surface |
|------|-----------|--------------|
| `tests/e2e/simple/simple-catch.test.mjs` | 2 | `_simpleResolutionDelta`, multi-pursuer best-SL advance |
| `tests/e2e/simple/simple-escape.test.mjs` | 1 | distance clamping at `escapeDistance` |
| `tests/e2e/simple/simple-reroll.test.mjs` | 1 | `applySimpleReroll`, test-message cleanup on resolve |
| `tests/e2e/simple/simple-catchup-dialog.test.mjs` | 4 | `_postSimpleCatchupMessage`, `_onAbandonQuarry`, captured-by-some flow, captured-card `endSimplePursuit` |
| `tests/e2e/simple/simple-resolve-guard.test.mjs` | 3 | `_simpleRoundResolvable`, prone + entangled count as acted |
| `tests/e2e/complex/complex-basic.test.mjs` | 6 | initiative gating, auto-advance, round log, `removeParticipant`, Ride moveRating override, tied-initiative stable sort |
| `tests/e2e/complex/complex-catch.test.mjs` | 6 | mid-round catch, dialog branching (exclude / ignore / end), multi-quarry simultaneous catch |
| `tests/e2e/complex/complex-escape.test.mjs` | 3 | end-of-round escape, off-by-one boundary, multi-quarry split outcome |
| `tests/e2e/complex/complex-prone.test.mjs` | 4 | SL ≤ -5 applies prone, removeCondition → skip → auto-advance, prone blocks movement |
| `tests/e2e/complex/complex-reroll.test.mjs` | 5 | `_applyPositionDelta`, mid- and end-of-round reroll-triggered catches, last-actor reroll auto-advances |

Shared infrastructure:

- `tests/e2e/fw.mjs` — singleton `FoundryTestFramework` started in `beforeAll`.
- `tests/e2e/setup.mjs` — one-shot setup script (`npm run setup:e2e`).
- `tests/e2e/timeouts.mjs` — centralised timeout constants (`BOOT_TIMEOUT`,
  `TEST_TIMEOUT`, `WAIT_TIMEOUT`). `vitest.e2e.config.mjs` and every test
  file import from here; bump values in one place.
- `tests/e2e/helpers.mjs` — module-specific helpers: `rollForSL`,
  `getTokenData` / `getComplexTokenData`, `joinPursuit`,
  `rollAllInitiative`, `rollInitiativeOrdered`, `rollNextActive`,
  `rollSkill`, `setEscapeDistance`, `applyActorCondition` /
  `removeActorCondition`, `waitForOutcome`, `waitForNoOutcome`,
  `waitForNoCatchDialog`, `waitForRowSL`, `waitForRowStatus`,
  `waitForParticipants`. The `_moveModifier` helper mirrors the difficulty
  band applied in `pursuit-message-complex.mjs#_onRollSkill`.

---

## Simple Flow

### `simple-catch.test.mjs`

#### 1. Knight (move 5) catches Thief (move 3) after 2 rounds
Setup: Thief quarry, Knight pursuer, `startDistance=4`, `escapeDistance=10`.
- Round 1: Thief raw SL=1, Knight raw SL=1. With `minQuarryMove=3` /
  `minPursuerMove=5`, Knight's moveBonus is `+2` → eSL 3 vs Thief's eSL 1 →
  distance `4 + (1 − 3) = 2`.
- Round 2: Thief raw SL=0, Knight raw SL=1 → eSL 3 vs 0 → distance
  `2 + (0 − 3) = −1` clamped to 0 → caught banner.

Verifies: per-side `moveBonus`, `clamp(0, escapeDistance)`, caught render.

#### 2. Two pursuers — best pursuer SL wins (3-round flow)
Setup: Scout quarry, Guard 1 + Guard 2 pursuers, `startDistance=7`, all
move=4 (so `moveBonus=0` for everyone).
- Round 1: SLs 1 / −1 / 3 → pursuerBest=3 → distance 5.
- Round 2: 0 / 2 / 1 → pursuerBest=2 → distance 3.
- Round 3: −1 / 0 / 2 → pursuerBest=2 → distance 0 → caught.

Verifies: `pursuerBest = max(effectivePursuerSLs)` in `_simpleResolutionDelta`.

### `simple-escape.test.mjs`

#### 1. Equal-move escape after 2 rounds
Quarry 1 + Guard 1 (both move=4), `startDistance=5`.
- Round 1: Q+3 vs P+0 → distance 8.
- Round 2: Q+2 vs P−1 → 8+3 = 11, clamped to `escapeDistance=10`, escaped
  banner.

Verifies: upper clamp and escaped render.

### `simple-reroll.test.mjs`

#### 1. Reroll updates SL; resolveRound deletes every test message
Quarry 1 initial SL=0, rerolled to SL=2; Guard 1 SL=−1.
- Asserts the round card flips from `SL 0` → `SL 2` after the WFRP4e context
  menu's "Reroll" option is taken.
- After resolveRound: distance becomes `5 + (2 − (−1)) = 8`. The test then
  asserts that *no* `ChatMessage` with `system.test` remains, exercising the
  cleanup loop in `resolveSimpleRound` that walks `slResults[…].messageIds`
  and deletes each.

Verifies: `applySimpleReroll` extends `messageIds`; resolve cleanup.

### `simple-catchup-dialog.test.mjs`

Round 1 in all three sub-tests is contrived so the resolution puts the
quarry at distance 0 with more than one quarry member — `resolveSimpleRound`
posts a catchup card from `_postSimpleCatchupMessage` (one Sacrifice button
per quarry, plus an All Captured button). The candidates' `newDistance`
values come from re-running `_simpleResolutionDelta` with each candidate
removed, floored at 1.

#### 1. All Captured → ends pursuit
Single pursuer (Guard). Expected button labels:
`Sacrifice Thief (Distance 4)`, `Sacrifice Scout (Distance 1)`,
`All captured`. Clicking *All captured* (`endSimplePursuit`) sets
`state=complete`, removes the round card's roll/resolve buttons, and shows
the caught outcome.

#### 2. Sacrifice Thief → Ignore Captured
Two pursuers (Guard + Knight). After clicking *Sacrifice Thief*, the
captured card ("Thief falls into the Pursuers' hands") appears; clicking
*Ignore* deletes the captured card and the pursuit resumes with Scout as
sole quarry at the precomputed distance (3 for the Guard+Knight setup), no
outcome banner.

#### 3. Sacrifice Thief → Captured by Some
After picking Thief, click *They are captured by some*, which opens a
checkbox card listing each pursuer (`pursuit-simple-capture-select.hbs`).
Check Guard's box, click *Done* → Guard is removed from pursuers; Knight +
Scout continue at distance 3.

#### 4. Sacrifice Thief → End pursuit (from captured card)
Same flow as test 2 through the *Sacrifice Thief* click, then click
`endSimplePursuit` on the captured card (`pursuit-simple-captured.hbs`).
Covers the second `[data-action="endSimplePursuit"]` button — the catchup
card's *All captured* button (test 1) and the captured card's *End pursuit*
button both route to `_onEndSimplePursuit`. Asserts caught banner, captured
card removed, and no roll/resolve buttons remain.

### `simple-resolve-guard.test.mjs`

#### 1. Resolve Round button gated by `_simpleRoundResolvable`
After start: button disabled. After only quarry rolls: still disabled.
After both roll: enabled. Clicking it advances to Round 2.

#### 2. Stand Up counts as "acted"
Pre-applies `prone` to Quarry 1's actor → the row renders a `Stand Up`
button (`data-action="removeCondition" data-condition="prone"`). Clicking
it adds Quarry 1 to `skippedUuids`; once Guard 1 rolls, the resolve button
is enabled even though Quarry 1 never rolled. The afterEach removes the
condition.

#### 3. Untangle counts as "acted"
Parallel to test 2 for the `entangled` branch of `pursuit-round.hbs`. The
condition swaps Roll for an Untangle button; clicking it skips the
participant, and once Guard 1 rolls the resolve button is enabled.

---

## Complex Flow

All complex tests depend on `wfrp4e-up-in-arms`.

`_complexDistanceMoved(sl, move)` with `move=4` gives base=1 → SL≥4 → 2,
SL 0..3 → 1, SL −1/−2 → 0, SL ≤ −3 → 0. For `move=3` base=1 as well, but
the `_onRollSkill` difficulty bumps to `challenging` (modifier +0); for
`move=4` difficulty is `average` (modifier +20). `helpers.mjs#_moveModifier`
mirrors that table when building the dice override.

### `complex-basic.test.mjs`

#### 1. Two participants roll in initiative order; positions update; round auto-advances
Quarry 1 + Guard 1, `startDistance=5`. After both roll, `_allComplexActed`
fires, `_advanceComplexRound` clears `slResults` and bumps the round badge
to Round 2. Repeat for Round 2 → Round 3. Verifies auto-advance,
`slResults` clearing, and that `.sl-result` chips disappear at round
boundary.

#### 2. Only the active-turn participant has a roll button
Initial render: exactly one `[data-action='rollSkill']`. After that roll
the button moves to the other participant — confirms
`_isActiveComplexTurn` and the template's `isActiveTurn` branch.

#### 3. Round log records prevDistance → newDistance and SL → yards mapping
Two rounds with all-`+1`-yard rolls keep distance constant (5 → 5 each
round). Test opens each `<details>` to force the SL detail rows into the
DOM and asserts `SL 1 → +1` and `SL 2 → +1` appear.

#### 4. `removeParticipant` strips a joined token from the setup card
`_onRemoveParticipant` (shared shape across simple + complex). Joins
Quarry 1 + Thief as quarry and Guard 1 as pursuer, clicks the per-row `&times;`
button for Thief (`[data-group="quarry"]`) and again for Guard 1
(`[data-group="pursuers"]`); asserts each disappears and the pursuers
list ends in the `participant-empty` placeholder.

#### 5. Ride skill selection applies `moveRating` override at start
Covers `_onStart`'s `applyOverrides` branch in `pursuit-message-simple.mjs`.
The test world has only Athletics-based tokens, so the test sets Quarry 1's
skill select to "Ride" and types `7` into the move-rating input via DOM,
then starts the pursuit. Quarry 1's round-card row carries a `+3`
`participant-bonus` chip (override move 7 vs Guard's 4), proving the
override was picked up by `_readParticipantOverrides` and applied to
`p.move`.

#### 6. Ties in initiative roll fall back to join order (stable sort)
Both `_isActiveComplexTurn` and `renderComplexRoundContent` sort by
`(b.initiative ?? 0) - (a.initiative ?? 0)`; V8's `Array.prototype.sort`
has been stable since ES2019, so ties keep the original
`[...quarry, ...pursuers]` order. The test joins Quarry 1 + Guard 1,
rolls initiative normally (to clear `data-start-blocked`), then overwrites
both initiatives to `50` via the message flags. After start: Quarry 1
owns the only `rollSkill` button and its initiative-badge reads `1` while
Guard 1's reads `2`.

### `complex-catch.test.mjs`

Catch detection lives in `processComplexRoll`: `newlyCaught` is the subset
of free quarry whose position satisfies `prevPos < qPos ≤ newPos` for the
rolling pursuer. `needsDialog = otherActiveQuarry.length > 0 ||
newlyCaught.length > 1 || caughtPending.length > 0`. When false, a plain
"X was caught by Y" notification posts and the pursuit completes;
otherwise a `pursuit-caught.hbs` card with `excludePair` / `ignoreQuarry` /
`endPursuit` is posted per caught quarry (and `excludePair` is hidden when
there is only one pursuer — `canExclude = pursuersCount > 1`).

#### 1. Single pursuer + single quarry mid-round catch → direct notification
Guard 1 acts before Quarry 1; SL=4 → pos 2 catches Quarry at pos 2. Plain
notification posts, caught outcome banner shows, no catch dialog.

#### 2. Mid-round catch with another active quarry → dialog appears
Thief + Scout quarry, Guard 1 sole pursuer. Thief acts first (pos 4),
Guard SL=4 catches Scout at pos 2 while Thief is still active → catch
dialog posts; round card remains active.

#### 3. excludePair removes both members; remaining pair continues
Four-participant variant. Clicking `excludePair` strips Guard + Scout; the
round card now expects Knight (the remaining unacted pursuer) to roll.

#### 4. ignoreQuarry returns the caught quarry to play, records ignoredPair
Same setup as test 3 but `ignoreQuarry` is clicked. Verifies Scout
reappears in the participant list and Guard 1's status text becomes
`"is 2 behind quarry"` — i.e., `_pursuerStatusText` filters out Scout (now
in `ignoredPairs`) and falls back to Thief at pos 4.

#### 5. endPursuit closes the pursuit
After the catch dialog appears, `endPursuit` clears `caughtPending`, sets
`state=complete`, and shows the caught banner.

#### 6. Multiple quarry caught simultaneously → individual dialogs
Guard 1 acts first; SL=4 moves to pos 2, catching both Thief and Scout
(start pos 2). `newlyCaught.length > 1` ⇒ two `pursuit-caught.hbs` cards
appear side-by-side.

### `complex-escape.test.mjs`

Per-roll: `renderComplexRoundContent` shows escaped when
`minQuarryPos − maxPursuerPos ≥ escapeDistance`. End-of-round:
`_advanceComplexRound` removes escaped quarry, posts the escape
notification, and clears them from the participant list.

#### 1. Quarry escapes when gap reaches `escapeDistance` at round end
Quarry 1 + Guard 1, `startDistance=4`, `escapeDistance=5` (Woodland). Guard
must act first (gap evaluated per roll) so the per-roll check doesn't fire
before Quarry's move bumps gap to 5.

#### 2. Off-by-one — no escape if gap is exactly one short
`startDistance=5`, `escapeDistance=7`. Round 1 ends at gap 6 (no escape),
Round 2 ends at gap 7 (escape).

#### 3. Multi-quarry — Scout escapes, Thief stays in pursuit
Initiative order Scout > Guard > Thief; `startDistance=4`,
`escapeDistance=5`. Scout SL=4 → pos 6, Guard SL=0 → pos 1, Thief SL=0
(with move=3, base=1) → pos 5. End of round: Scout's gap = 5 (escape),
Thief's gap = 4 (continues). Round 2 starts with Thief + Guard only.

### `complex-prone.test.mjs`

Reset hook removes `prone` / `entangled` from Quarry 1, Guard 1, and Thief
in `afterEach` to prevent test-bleed via the persistent actor document.

#### 1. SL ≤ −5 applies the `prone` condition after round resolves
Uses Thief (move=3) because `effectiveSkill = 40` allows SL = −5
(roll = 95). With move=4 (`effectiveSkill = 60`), the minimum achievable SL
on the 1–100 scale is −4. Asserts the prone button appears in Round 2 and
the actor document carries the condition.

#### 2. Prone participant — clicking "Stand Up" skips and advances
Pre-applies prone to Quarry 1. Guard rolls; Quarry 1's only available
button is `removeCondition[prone]`. Clicking it adds Quarry 1 to
`skippedUuids` (slFor → −3 → 0 yards in the log), `_allComplexActed`
becomes true, and the round auto-advances.

#### 3. Entangled participant — same flow with `entangled` condition

#### 4. Prone participant cannot escape or catch
Thief (pursuer, move=3) SL=−5 → 0 yards, then Quarry 1 SL=4 → pos 7
triggers per-roll escape (gap 7 ≥ 7). Round log shows
`SL -5 → +0 — trips and falls!` for Thief — covers the `fell: sl <= -5`
flag in the log entry.

### `complex-reroll.test.mjs`

`applyComplexReroll` (`pursuit-message-complex.mjs`) is invoked via the
`createChatMessage` capture in `onTestRolled`: it computes
`_applyPositionDelta(token, newSl, prevSl)`, then re-runs mid-round catch
detection.

#### 1. Pursuer rerolls to higher SL → position advances further
Reroll Guard 1 from SL 0 → SL 4: delta = `2 − 1 = +1`, Guard's position
moves from 1 → 2. After Quarry's SL=0 (pos 6) auto-advance, Round 2's gap
is 6 − 2 = 4 (asserted via `waitForRowStatus`).

#### 2. Quarry rerolls to lower SL → position decreases
Reroll Quarry 1 from SL 4 → SL −1: delta = `0 − 2 = −2`, position 7 → 5.
Guard SL=0 → pos 1 auto-advances; Guard's status reads "is 4 behind".

#### 3. Reroll mid-round triggers catch re-evaluation
`startDistance=2`. Initial SL=0 → pos 1 (no catch). Reroll to SL=4 → pos 2
catches Quarry at pos 2, plain notification, `state=complete`.

#### 4. Reroll by the last unacted participant auto-advances
Guard 1 rolls first; Quarry 1 (the last unacted participant) rolls SL=0
(pos 6), then rerolls to SL=2 (newDist=1, prevDist=1, delta=0). All have
acted ⇒ auto-advance fires. Confirms `_allComplexActed` re-evaluates after
`applyComplexReroll` and that the position is preserved when newDist
equals prevDist.

#### 5. Quarry reroll down to pursuer's position triggers end-of-round catch dialog
Multi-quarry setup (Quarry 1 + Thief, Guard 1) at `startDistance=2`. After
all three rolled (with Guard 1 ending at pos 2, no mid-round catch),
Quarry 1 rerolls SL 4 → SL −1 (delta −2 → pos 2). `applyComplexReroll`
sees `isRollingPursuer=false` and skips mid-round detection, but the
all-acted check fires `_advanceComplexRound`, whose `caughtQuarry` filter
(`pursuit-round-complex.mjs:139`) detects Quarry 1 (pos = `maxPursuerPos`).
With Thief still active, `needsDialog=true` → `postCatchMessage` posts the
catch dialog for Quarry 1 + Guard 1. Round 2 begins with Thief + Guard 1.

---

## Planned coverage (test.todo stubs)

The suite carries `test.todo` placeholders for branches that are reachable
but not yet exercised. Each stub has a header comment describing the
scenario; pick one up by implementing the body and removing `.todo`.

| File | Stub | Code path |
|------|------|-----------|
| `complex-reroll.test.mjs` | non-GM reroll emits `REROLL_SOCKET` and GM applies it | `onTestRolled` / `dispatchReroll` socket branch (`pursuit-message-complex.mjs:472`) |

## Coverage gaps deliberately left out

- **State-only invariants during reroll-induced escape.** The visible
  banner flips per-roll whenever `(minQuarryPos − maxPursuerPos) ≥
  escapeDistance`, so any test that asserts "reroll does not trigger
  premature escape" via DOM has to instead probe message flags, which the
  rest of the suite deliberately avoids.

## Things to verify when running the suite

These weren't reachable from a static review, so the descriptions match
the code but the wall-clock timing assumptions may bite:

- **Escape notification text assertions** in `complex-escape` and
  `complex-prone` test 4 (`"<Name> disappears in the distance."`) assume
  the escape notification is created *after* the round card update in
  `_advanceComplexRound` — which the source confirms
  (`pursuit-round-complex.mjs:221-223`). Note that `waitForTextInLastChatMessage`
  matches on exact trimmed `textContent`, so the full string (with the
  quarry name and trailing period) is required — substrings like
  `"disappears in the distance"` won't match any element.
- **`fw.waitForSelectorCount('… [data-action="ignoreQuarry"]', 2)`** in
  `complex-catch` test 6 depends on both `postCatchMessage` calls
  completing before the assertion; both are serial `await`s in the
  current code path so this should be deterministic.
- **Reroll right-click → "Reroll" context menu item** in `simple-reroll`
  and `complex-reroll`. The framework's `rightClickLastChatMessage` looks
  for the localized text — if the wfrp4e system renames "Reroll" in a
  future release, every reroll test fails together.

## How to add a new e2e test

1. If a new named token is needed, add it to the table in
   `tests/e2e/SETUP.md` and to the test world.
2. Prefer the helpers in `tests/e2e/helpers.mjs` over ad-hoc selectors —
   the project-specific ones (`waitForOutcome`, `waitForRowStatus`,
   `waitForParticipants`, …) encode the round card's DOM shape and will
   pick up template changes the next time `pursuit-round*.hbs` is
   touched.
3. Compute target SLs from the public formulas in this doc rather than
   hard-coding distances; that's how recent test fixes (`33ff786`) caught
   the per-roll escape ordering issue.
4. End every test in a *visible* outcome assertion (banner, notification
   text) rather than poking flags — this is the convention enforced in
   `866598c test(e2e): align with current code, prefer DOM checks over
   flag inspection`.

## Running

```bash
cp tests/e2e/config.example.mjs tests/e2e/config.mjs   # fill in paths
npm run setup:e2e                                       # one-shot copy
npm run test:e2e                                        # full suite
npx vitest run --config vitest.e2e.config.mjs tests/e2e/simple/simple-catch.test.mjs
```

Sequential execution is mandatory (`pool: "forks", singleFork: true`) —
Foundry's UI state and the persisted actor conditions don't survive
parallel runs.
