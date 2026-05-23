# [WFRP4e] Pursuits

[![GitHub release](https://img.shields.io/github/v/release/Tiamanti/WFRP4e-Pursuits)](https://github.com/Tiamanti/WFRP4e-Pursuits/releases/latest)

A [Foundry VTT](https://foundryvtt.com) module for the [Warhammer Fantasy Roleplay 4th Edition](https://github.com/moo-man/WFRP4e-FoundryVTT) system that runs Simple and Complex Pursuits as chat-based encounter cards.

Start a pursuit with `/pursuit [simple|complex]`. A chat card lets you populate Quarry and Pursuers from selected/targeted tokens, set the starting distance and (for complex) the environment, then play it out round by round with per-participant skill rolls.

## Features

### Simple Pursuits

A single Distance value tracks the chase from `0` (caught) to `10` (escaped).

- Quarry and Pursuers joined via selected/targeted tokens; per-participant skill (Athletics / Ride / Drive) and Move Rating override for mounts and vehicles
- Movement bonus SL applied automatically from the gap between the faster and slower sides
- Resolution compares the worst Quarry roll against the best Pursuer roll (per the SPEC)
- **Resolve Round** stays disabled until every participant has either rolled or been skipped via Stand Up / Untangle
- Multi-quarry catchup: when Distance hits `0` with more than one Quarry, the GM picks which member to sacrifice — each option shows the Distance that would result without that member's roll (always at least `1`), or **All captured** to end the pursuit
- After a sacrifice the Pursuers can decide who stops to catch the abandoned member (subset selection) or ignore them
- Player rerolls (Fate Points, etc.) flow back to the GM via socket and update the tracked SL automatically
- Round log shows per-round SL and movement bonuses

### Complex Pursuits

Per-character position tracking, initiative-ordered turns, individual catches.

- Each participant has their own `position`; Distance is the gap between the closest Quarry and the lead Pursuer
- Environment-driven escape distance: Busy city (`3`), Woodland (`5`), Village (`7`, default), Meadow (`10`), Desert (`13`)
- Initiative-ordered rolls; only the currently-active participant shows a roll button, and the server-side roll handler rejects out-of-turn attempts
- Character Progress Table encoded in `_complexDistanceMoved`: `floor(Move × 4 / 10)` adjusted by SL band, `+1` on a sprint, `-1` on a stumble, `0` on `−3..−4`, `0` plus auto-applied Prone on `−5` or worse
- Move-based difficulty applied at roll time: Move ≤1 Very Hard, ≤2 Hard, ≤3 Challenging, otherwise Average — matches the SPEC penalty table
- Mid-round catches: when a Pursuer rolls past a Quarry's position, a catch dialog posts with three options — **Exclude pair** (engage in combat, remove both), **Ignore quarry** (race past, recorded so the same Pursuer auto-ignores them next round), **End pursuit**
- Individual Quarry escape and "left behind" notifications when they pull beyond the escape distance or drop behind every Pursuer
- Per-pursuer status text reflects their closest *non-ignored* Quarry — so an Ignored pair stops showing "has caught up" once the GM resolves it
- Round auto-advances when every active participant has rolled or been skipped

### Both modes

- Prone / Entangled participants show **Stand Up** / **Untangle** in place of their roll button. Clicking it removes the condition and skips that participant's roll for the round.
- Reroll capture works for both GM and player rolls, in both modes.
- Setup, round, and catch cards localize via `languages/en.json`.

## Design notes

**Stand Up / Untangle is a single click, not a test.** SPEC §"Impeded Movement" says a Prone or Entangled character "potentially" needs to make a test to free themselves. The module skips the round (treating them as SL `−3` for resolution) and exposes a one-click condition-removal button. Rolling any required test is left to the GM to enforce outside the pursuit card — the wfrp4e system's own condition handling already covers the mechanics.

**Quarry are always tracked individually in complex mode.** SPEC permits collapsing a tight group into a single Distance until one member leads by more than 16 yards. The module skips that simplification — every Quarry has its own position. Collapsing a group on the card would mostly add visual noise to the per-participant view.

**Breaking-from-Combat head starts are entered manually.** SPEC lists method-specific starting distances (Using Advantage / Using Dodge / Fleeing, plus an optional Athletics test on the flee path). The module exposes a free-form starting-distance input on the setup card and trusts the GM to pick the right value, rather than embedding the entire combat-disengage flow.

## Requirements

| Dependency | Minimum version |
|---|---|
| Foundry VTT | 13 |
| WFRP4e system | — |
| Up in Arms (complex only) | — |

## Installation

**Via Foundry VTT module manager (recommended):**

Search for "[WFRP4e] Pursuits" in the Add-on Modules browser, or paste the manifest URL directly:

```
https://github.com/Tiamanti/WFRP4e-Pursuits/releases/latest/download/module.json
```

**Manual install:**

Download `module.zip` from the [latest release](https://github.com/Tiamanti/WFRP4e-Pursuits/releases/latest) and extract it into your `Data/modules/` directory.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for the build / test / release workflow, project layout, and pointers to the design docs in `docs/`.

## Contributing

Pull requests are welcome.

## License

This module is released under the [MIT License](LICENSE) and is free for anyone to use, modify, or maintain.
This work is licensed under Foundry Virtual Tabletop [EULA - Limited License for Package Development from March 2, 2023](https://foundryvtt.com/article/license/).
