# E2E Test Setup

## Prerequisites

- FoundryVTT running with the **wfrp4e** game system and **wfrp4e-pursuits** module active
- A world with an active scene

See `config.example.mjs` for connection configuration. Copy it to `config.mjs` and fill in paths.

## Required Tokens

All tokens must be placed on the active scene. Token names are matched exactly by `selectTokensByName`.

| Token Name | Move | Athletics |
|------------|------|-----------|
| Quarry 1   | 4    | 40        |
| Guard 1    | 4    | 40        |
| Guard 2    | 4    | 40        |
| Scout      | 4    | 40        |
| Thief      | 3    | 40        |
| Knight     | 5    | 40        |
| Guard      | 4    | 40        |

> **Note:** "Guard" is a separate token from "Guard 1" and "Guard 2".

## Actor Requirements

Each actor needs:

**Move** — set via `system.details.move.value` (the base move characteristic).

**Athletics skill** — a Skill item with `name = "Athletics"` and a total value (`system.total.value`).
If the item is missing the tests fall back to 40, so a skill item set to 40 is the simplest setup.

The easiest way to create actors is to use the NPC type, set move on the Characteristics tab, and add a single Athletics skill item manually.

## Required Users

The test world must have at least two Foundry users:

| Display Name | Role        | Password |
|--------------|-------------|----------|
| Gamemaster   | Gamemaster  | (none)   |
| Player       | Player      | (none)   |
| Player2      | Player      | (none)   |

`Gamemaster` is the primary session (`loginUser` in config). 
`Player` is used by the socket round-trip test (`playerUser` in config) and must own the **Guard 1** actor so the WFRP4e Reroll UI is available on their session.
`Player2` is used by somne test (`playerUser2` in config) and must own the **Scout** actor so the WFRP4e Reroll UI is available on their session.

## Running the Tests

```bash
npm run test:e2e                                       # run all tests
npx playwright test tests/e2e/simple/simple-catch.test.mjs   # single file
npx playwright test -g "catches Thief"                 # filter by test title

npm run test:e2e:ui                                    # interactive UI mode
npm run test:e2e:debug                                 # step through with Playwright inspector
```

Tests run sequentially in a single Foundry instance (`workers: 1, fullyParallel: false`).
Each worker starts and stops Foundry once for the whole run.

## Debugging a failed test

On any failed test, Playwright drops a `trace.zip` (full DOM/console/network timeline) and a final screenshot into `test-results/<test-name>/`. The HTML report (`npm run test:e2e:report`) links to both.

```bash
npm run test:e2e:report                          # open the HTML report
npm run test:e2e:show-trace test-results/.../trace.zip   # scrub through a specific trace
```

The trace viewer shows DOM snapshots before and after every action — hover/click to inspect the page exactly as it was when the assertion ran.
