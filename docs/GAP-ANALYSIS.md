# Pursuit Module — Gap Analysis

Comparison of `docs/SPEC.md` rules against the current implementation (`src/`, `templates/`, `languages/`).

Last audited: 2026-05-24.

---

## Implemented

### Simple Pursuits (SPEC §"Simple Pursuits")
- Distance 0–10 with GM-configurable head start (default 4) — `pursuit-message-simple.mjs`
- Athletics / Ride / Drive skill selection per participant; Move Rating override for mounts/vehicles — setup card
- Lowest-Q vs. highest-P SL comparison, Movement bonus SL applied — `_simpleResolutionDelta` in `pursuit-round-simple.mjs`
- Caught at Distance ≤ 0 with multi-quarry catchup flow: catchup card lists every quarry member with the distance that would result if that member is sacrificed (recomputed without their SL, floored at 1), plus an **All captured** button to end the pursuit (`pursuit-simple-catchup.hbs`); pursuers can then pick who stops via capture-select card (`pursuit-simple-capture-select.hbs`)
- Escaped at Distance ≥ escapeDistance
- Round log with per-round breakdown of SL + move bonus + effective SL

### Complex Pursuits (SPEC §"Complex Pursuits")
- Per-participant position tracking; environment-table escape distance (3 / 5 / 7 / 10 / 13) — setup card environment select
- Initiative-ordered turns, enforced server-side (`_isActiveComplexTurn`) and client-side (active-turn highlighting + only the active row shows a roll button)
- Auto-rolled or per-participant manual initiative depending on `wfrp4e.initiativeRule`
- Character Progress Table encoded in `_complexDistanceMoved(sl, move)`:
  `floor(move*4/10)` adjusted by SL band (≥4: +1; 0..3: base; −2..−1: −1; −4..−3: 0; ≤−5: 0 + Prone applied)
- Move-based difficulty applied to rolls in `_onRollSkill`: Move ≤1 → very hard, ≤2 → hard, ≤3 → challenging, else average — matches SPEC §"Complex Pursuits" penalty rules
- Mid-round catch detection: pursuer crossing a quarry's position triggers a catch dialog; multiple simultaneous catches or other-quarry-still-active situations produce a `caughtPending` queue
- Post-catch decision dialog (`pursuit-caught.hbs`): **Exclude pair** (engage in combat, remove both), **Ignore quarry** (run past, recorded in `ignoredPairs` so the same pursuer won't auto-match that quarry next round; status text on subsequent rounds reflects the pursuer's closest *non-ignored* quarry via `_pursuerStatusText`), **End pursuit**
- Quarry escape: individual quarry that opens a gap ≥ escapeDistance gets its own "disappears in the distance" notification and is removed from the pursuit
- Quarry left behind: any quarry behind every pursuer is removed with "is left behind" notification
- Round auto-advances when every active participant has rolled or been skipped (`_allComplexActed` → `_advanceComplexRound`)

### Exhaustion (SPEC §"Exhaustion")
- `checkExhaustion(actor, participant, actionsTaken)` in `pursuit-round-complex.mjs` checks `actionsTaken` after each roll against the full 10-round SPEC threshold table (rounds 10/15/18/20/21/22/23/24/25/26)
- **Athletics**: automatically opens an Endurance test dialog at the matching modifier (Very Easy +60 down to Even More Impossible −60); on failure (SL < 0) applies the `fatigued` condition via `actor.addCondition("fatigued")`
- **Ride / Drive**: posts a chat notification (`pursuit-notification`) naming the participant and the required modifier so the GM can prompt the mount/draft-animal Endurance test manually; a second paragraph reminds the GM of the Challenging (+0) Charm Animal Test the rider can attempt to keep a failing mount running
- Difficulty modifier labels localised via `PURSUITS.Diff*` keys; difficulty fields mapped to WFRP4e named difficulties where possible, raw modifier fallback for unlabelled values
- Bug fix: `_onRollInitiative` now calls `_readParticipantOverrides` before updating flags, so changing the skill select before rolling initiative no longer reverts on re-render

### Impeded Movement (SPEC §"Impeded Movement")
- Prone / Entangled conditions render Stand Up / Untangle buttons in place of the roll button
- Clicking the condition button calls `actor.removeCondition` and adds the participant to `skippedUuids`; in complex resolution they're treated as SL −3 (halts) for that round
- SL ≤ −5 automatically applies the Prone condition via `actor.addCondition("prone")` during `_advanceComplexRound`

### Misc
- `/pursuit [simple|complex]` slash command, GM-only; type dialog (`PursuitTypeDialog`) when no argument given
- Complex pursuit gated on `wfrp4e-up-in-arms` module
- Reroll capture for both modes (GM and player rolls): `wfrp4e:rollTest` hook + one-shot `createChatMessage` hook updates the tracked SL, recomputes positions, and re-runs mid-round catch detection. Non-GM clients emit on `game.socket` (`module.wfrp4e-pursuits`); the GM listens in `Hooks.once("ready")` and runs `dispatchReroll` → `applyComplexReroll` / `applySimpleReroll`
- Socket delegation (`pursuit-shared.mjs#updateMessage`) so non-GM rolls can update the GM's pursuit message via `warhammer.apps.SocketHandlers`
- Round log (collapsible) on both round cards
- Simple **Resolve Round** button is disabled (and `_onResolveRound` rejects) until every participant has rolled or been skipped via Stand Up / Untangle — `_simpleRoundResolvable` in `pursuit-round-simple.mjs`

---

### Obstacles (SPEC §"Obstacles" and §"Creating Obstacles")
- 15-entry `OBSTACLE_TABLE` constant in `pursuit-round-complex.mjs`; each entry carries name, perceived text, navigation test (perceived + optional harder unperceived variant), consequences, `blocksProgress` flag, and the navigation skill
- `obstacles[]` array in `flags["wfrp4e-pursuits"]`; seeded at creation time with `navigatedBy` (participants at or ahead of the position) and `perceivedBy` (all non-navigated if auto-perceived)
- GM-only "Create Obstacle" button in the active-turn footer (`gm-only` CSS class); opens `ObstacleDialog` (ApplicationV2), select + preview + relative-distance input
- Obstacle nodes interleaved in the position diagram (`role-obstacle`) at their fixed position
- Perception button replaces Roll for the active participant when any obstacle has their UUID pending; perception test outcome tracked in `obstacle.perceptionTests[tokenUuid]`
- Navigation test triggered inside `applyComplexAction` when a participant crosses an obstacle; fail caps position at `obstacle.position` (if `blocksProgress`) and posts consequences to chat; pass or `blocksProgress: false` adds participant to `navigatedBy`
- Obstacles pruned from flags when all active participants have navigated
- Perception test rerolls tracked and handled via `_handlePerceptionReroll` (extends existing reroll hook in `onTestRolled` and `dispatchReroll`)

---

## Accepted simplifications

These are SPEC concepts the module deliberately does not implement. They're documented in [`README.md`](../README.md#design-notes) so users aren't surprised, but are not considered gaps.

- **Breaking-from-Combat head-start automation** (SPEC §"When does Breaking from Combat become a Pursuit?") — the setup card exposes a free-form starting Distance and trusts the GM to pick the right value. SPEC's method-specific head starts (Using Advantage / Using Dodge / Fleeing) are not automated, and there's no embedded Athletics test for the flee path.
- **Tight-group collapse, 16-yard rule** (SPEC §"Complex Pursuits") — complex pursuits always track each Quarry individually. Folding a group into one Distance would mostly add visual noise to the per-participant view.
- **Condition-removal test** (SPEC §"Impeded Movement") — Stand Up / Untangle is a single click. The participant skips their round (treated as SL `−3` for resolution), and any test to free themselves is the GM's call outside the pursuit card. The wfrp4e system's own condition handling covers the underlying mechanics.

---

## Improvement opportunities

_All known improvement items have been addressed._ Add new ones here as they surface.

---

## Summary table

| Area | Status |
|------|--------|
| Simple pursuit core loop | ✅ |
| Complex pursuit core loop | ✅ |
| Character Progress Table | ✅ |
| Movement bonus (simple) | ✅ |
| Movement penalty display (complex) | ✅ |
| Move-based difficulty applied to roll (complex) | ✅ |
| Environment escape distance table | ✅ |
| Initiative-order enforcement (complex) | ✅ |
| Per-participant skill selection (Athletics / Ride / Drive) | ✅ |
| Mounts/vehicles via Move Rating override | ✅ |
| Per-participant catching mid-round (complex) | ✅ |
| Catch dialog: Exclude / Ignore / End (complex) | ✅ |
| Individual quarry escape notification | ✅ |
| Individual quarry "left behind" removal | ✅ |
| Simple multi-quarry catchup flow | ✅ |
| Pursuer "captured by some" subset selection | ✅ |
| Prone on SL ≤ −5 auto-applied | ✅ |
| Impeded movement (Prone / Entangled skip + button) | ✅ |
| Round log (both modes) | ✅ |
| Reroll tracking (GM and player rerolls) | ✅ |
| Auto-advance round when all acted (complex) | ✅ |
| Simple "all rolled" resolve guard | ✅ |
| Obstacles system | ✅ |
| Creating Obstacles (GM action, no turn cost) | ✅ |
| Exhaustion / Endurance Tests (Athletics auto-dialog; Ride/Drive notification + Charm Animal reminder) | ✅ |
| Breaking-from-Combat head-start automation | ➖ Accepted simplification (manual) |
| Tight-group collapse (16-yard rule) | ➖ Accepted simplification (always individual) |
| Condition-removal test enforcement | ➖ Accepted simplification (GM call outside the card) |
