import { defineConfig } from "@playwright/test"
import { BOOT_TIMEOUT, TEST_TIMEOUT } from "./tests/e2e/timeouts.mjs"

/**
 * Playwright config.
 *
 * Tests share a single Foundry server + browser context across the whole run
 * (worker-scoped fw fixture in tests/e2e/fw.mjs). Run sequentially: each test
 * mutates the active scene's chat log, so parallelism would corrupt state.
 *
 * Debugging:
 *   npm run test:e2e             # run all tests headed
 *   npm run test:e2e -- --ui     # interactive UI mode (recommended for diagnosis)
 *   npm run test:e2e:show-trace  # open the most recent trace.zip in the trace viewer
 */
export default defineConfig({
    testDir: "./tests/e2e",
    testMatch: /.*\.test\.mjs/,

    // Foundry is spawned once for the whole run in globalSetup (and killed by
    // the function it returns). This keeps Foundry alive across worker
    // restarts, which Playwright performs after any test failure.
    globalSetup: "./tests/e2e/global-setup.mjs",

    // One worker, sequential order. Each worker still launches its own
    // browser via the fw fixture, but reuses the already-running Foundry.
    workers: 1,
    fullyParallel: false,
    retries: 1,

    // Test execution timeouts.
    timeout: TEST_TIMEOUT,
    globalTimeout: 0,
    expect: { timeout: 10_000 },

    // Reporters: list for the terminal, html for clickable failures with trace links.
    reporter: [
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
    ],

    // Tracing is managed on the framework's persistent context inside
    // tests/e2e/fw.mjs (the runner-default `page` fixture is unused).
    use: {
        actionTimeout: 10_000,
        navigationTimeout: 30_000,
    },

    // The Foundry server is spawned inside the worker fixture (not here)
    // because it requires Foundry to be installed at config.foundryNodePath
    // and the same boot sequence as the puppeteer-era framework.
    projects: [
        {
            name: "foundry-wfrp4e",
            // No `use.baseURL` — the fixture navigates to the Foundry URL itself
            // after spawning the server and loading the dice-override extension.
            // Keep the boot timeout for the worker setup.
            metadata: { bootTimeout: BOOT_TIMEOUT },
        },
    ],
})
