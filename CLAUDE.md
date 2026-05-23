# CLAUDE.md

Module: WFRP4e Simple+Complex pursuit chat cards. Single ESM bundle (`src/wfrp4e-pursuits.mjs`).

## Commands

```bash
npm run build    # rollup --watch → foundry-path.js target
npm run release  # production bundle
npm test         # vitest unit tests (Node, stubs in tests/setup.mjs)
npm run test:e2e # playwright, workers=1 (sequential), boots real Foundry
```

E2E: requires `tests/e2e/config.mjs` (copy from `config.example.mjs`) and named tokens; see `tests/e2e/SETUP.md`.

## Invariants

- State lives in `ChatMessage.flags["wfrp4e-pursuits"]`. No other persistence.
- Always re-read live flags via `game.messages.get(id)?.flags` before rendering — handler args go stale.
- Every mutation: re-render → `updateMessage(id, { content, "flags.wfrp4e-pursuits.X": … })`
- Non-GM updates relay via `pursuit-shared.mjs#updateMessage` (SocketHandlers → GM applies).
- Complex requires `wfrp4e-up-in-arms` module. Foundry min v13; uses ApplicationV2 API.

## Entry point dispatch

`src/wfrp4e-pursuits.mjs` → `renderChatMessageHTML` strips `.gm-only` for non-GMs, then:
- `flags.pursuitType === "simple"` → `pursuit-message-simple.mjs#onRenderHTML`
- `"complex"` or `flags.type === "catch"` → `pursuit-message-complex.mjs#onRenderHTML`
- `wfrp4e:rollTest` → `onTestRolled` (reroll capture — one-shot `createChatMessage` hook pattern)
- `ready` → GM socket listener on `REROLL_SOCKET`

## Docs

| File | Contents |
|------|----------|
| `docs/SOURCE-MAP.md` | All src files, exports, import graph |
| `docs/COMPLEX_FLOW.md` | Flag schema, state machine, round processing, side effects |
| `docs/GAP-ANALYSIS.md` | Implemented vs SPEC (all complete as of 2026-05-24) |
| `docs/TESTING.md` | E2E test catalog — scenarios, code surface, helpers |
| `docs/SPEC.md` | Rules text source of truth (gitignored) |
