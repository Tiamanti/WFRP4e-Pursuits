# Development

How to build, test, and release this module locally.

## First-time setup

```bash
npm install

cp foundry-path.example.js foundry-path.js
# edit foundry-path.js to point at <FoundryData>/Data/modules/wfrp4e-pursuits
```

`foundry-path.js` is gitignored — it tells the rollup config where to write the built module so Foundry picks it up.

## Watch mode (dev loop)

```bash
npm run build
```

Rollup watches `src/`, `module.json`, `languages/`, `styles/`, and `templates/` and re-syncs the bundle plus assets to the path returned by `foundry-path.js`. Reload Foundry to pick up the new bundle.

## Production release

```bash
npm run release
```

One-shot production bundle (no watch).

The rollup config (`rollup.config.mjs`) bundles `src/wfrp4e-pursuits.mjs` into `${modulePath}/scripts/wfrp4e-pursuits.mjs` and copies `module.json`, `languages/`, `styles/`, and `templates/` alongside it.

## Tests

### Unit tests

Vitest, Node environment, Foundry globals stubbed in `tests/setup.mjs`. The e2e folder is excluded here.

```bash
npm test                                      # run all
npm run test:watch                            # watch mode
npx vitest run tests/simple/flow.test.mjs     # one file
```

### End-to-end tests

E2E tests use [`foundryvtt-test-framework`](https://github.com/Tiamanti/foundryvtt-test-framework) (sibling repo) to boot a real Foundry instance against a copied test world. Prerequisites and the required token table live in `tests/e2e/SETUP.md`.

```bash
cp tests/e2e/config.example.mjs tests/e2e/config.mjs
# edit paths to match your environment

npm run setup:e2e                                                                          # one-time: copies world + system + module + license
npm run test:e2e                                                                           # runs the full e2e suite
npx vitest run --config vitest.e2e.config.mjs tests/e2e/simple/simple-catch.test.mjs       # one file
```

E2E tests run sequentially in a single Foundry instance (`pool: "forks", singleFork: true` in `vitest.e2e.config.mjs`) — do not run them in parallel.

## Project layout

```
src/
  wfrp4e-pursuits.mjs        # entry point: registers /pursuit, the chat-message render hook, and the reroll socket listener
  chat/                      # state machines for the two pursuit modes
    pursuit-shared.mjs       # token selection, participant merging, socket-delegated updateMessage
    pursuit-message-simple.mjs   pursuit-round-simple.mjs
    pursuit-message-complex.mjs  pursuit-round-complex.mjs
  commands/                  # /pursuit slash command + type dialog wiring
  apps/                      # ApplicationV2 / HandlebarsApplicationMixin dialogs

templates/                   # Handlebars: setup card, round cards, catchup / catch / captured notifications
languages/en.json            # i18n
styles/wfrp4e-pursuits.css   # all module CSS

tests/
  setup.mjs                  # global stubs for vitest unit tests
  simple/  complex/          # unit tests, one file per concern
  e2e/                       # foundryvtt-test-framework scenarios + helpers

docs/
  SPEC.md                    # rules text (gitignored — obtain from publisher)
  GAP-ANALYSIS.md            # implementation vs. SPEC
```

## State model (quick reference)

All pursuit state lives in `ChatMessage.flags["wfrp4e-pursuits"]` on the active pursuit message — there is no separate datastore. Every user action re-renders the card HTML from the new state and writes `content` plus the changed flag paths in a single `message.update()`. Non-GM clients route updates through `pursuit-shared.mjs#updateMessage`, which dispatches via `warhammer.apps.SocketHandlers` when `isGM` is false.

Reroll capture (`onTestRolled` in `pursuit-message-complex.mjs`) fires on every client. The rolling client registers a one-shot `createChatMessage` hook (needed because `test.context.messageId` is empty when `wfrp4e:rollTest` first fires), then either calls `dispatchReroll` directly (GM) or emits on `game.socket` channel `module.wfrp4e-pursuits` (non-GM). The GM listens in `Hooks.once("ready")` and applies `applyComplexReroll` / `applySimpleReroll`.

## Further reading

- [`docs/GAP-ANALYSIS.md`](docs/GAP-ANALYSIS.md) — what's implemented vs. SPEC, accepted simplifications, and remaining gaps
- [`docs/SPEC.md`](docs/SPEC.md) — the WFRP4e pursuit rules text (gitignored)
- [`CLAUDE.md`](CLAUDE.md) — guidance for AI-assisted edits in this repo
