/**
 * Centralised timeouts for the Playwright e2e suite.
 *
 * Imported by `playwright.config.mjs` (for `timeout`) and `tests/e2e/fw.mjs`
 * (for the worker fixture's Foundry boot window).
 */

/** Worker-fixture boot timeout — must cover Foundry server start + browser launch + login. */
export const BOOT_TIMEOUT = 180_000

/** Per-test timeout — accommodates a full pursuit flow with multiple rolls. */
export const TEST_TIMEOUT = 60_000

/** Default polling timeout for waitFor / waitForSelector inside a single test. */
export const WAIT_TIMEOUT = 10_000
