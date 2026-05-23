import { test as base, expect } from "@playwright/test"
import { FoundryTestFramework } from "foundryvtt-test-framework"
import config from "./config.mjs"

/**
 * Worker-scoped `fw` fixture. The Foundry server is spawned once for the
 * whole run in `tests/e2e/global-setup.mjs` (so it survives Playwright's
 * worker-recycling-on-failure behaviour). This fixture only launches a
 * browser context and connects to the already-running server.
 *
 * Tracing is managed per-test in the auto fixture below (NOT here) — chunks
 * would otherwise get out of sync when downstream fixtures error and skip
 * the worker teardown, producing "Tracing already started" / "Must start
 * tracing before stopping" errors on subsequent runs.
 */
export const test = base.extend({
    fw: [
        async ({}, use) => {
            const fw = new FoundryTestFramework({ ...config, serverAlreadyRunning: true })
            await fw.start()

            // Mirror browser errors into Node stdout — also visible in the trace.
            fw.page.on("console", (msg) => {
                if (msg.type() === "error") console.error(`[browser:error] ${msg.text()}`)
            })
            fw.page.on("pageerror", (err) => {
                console.error(`[browser:pageerror] ${err.message}`)
            })

            await use(fw)

            await fw.stop()
        },
        { scope: "worker", timeout: 180_000 },
    ],

    /**
     * Per-test tracing. Each test gets its own start/stop pair, so a previous
     * test's failed stop can't leave the next test in an inconsistent state.
     * All tracing calls are guarded — tracing must never fail the test itself.
     */
    autoTrace: [
        async ({ fw }, use, testInfo) => {
            await startTracingSafe(fw.context, {
                title: testInfo.title,
                screenshots: true,
                snapshots: true,
                sources: true,
            })

            await use()

            const failed = testInfo.status && testInfo.status !== testInfo.expectedStatus
            if (failed) {
                const tracePath = testInfo.outputPath("trace.zip")
                const ok = await stopTracingSafe(fw.context, tracePath)
                if (ok) await testInfo.attach("trace", { path: tracePath, contentType: "application/zip" })

                // Also attach a final-state screenshot for the report's failure card.
                const shotPath = testInfo.outputPath("failure.png")
                const shot = await fw.page.screenshot({ path: shotPath, fullPage: true }).then(() => true, () => false)
                if (shot) await testInfo.attach("screenshot", { path: shotPath, contentType: "image/png" })
            } else {
                await stopTracingSafe(fw.context)
            }
        },
        { auto: true },
    ],

    /**
     * Clear chat before every test so each starts with a known state.
     * Implemented as an auto fixture rather than test.beforeEach so it runs
     * reliably across all test files — beforeEach in a shared module is only
     * registered once (ES module cache) and may not apply to every file.
     */
    autoClearChat: [
        async ({ fw }, use) => {
            await fw.clearChat()
            await use()
        },
        { auto: true },
    ],
})

/**
 * Start tracing. If tracing is already active (previous stop was skipped),
 * stop first before restarting. Guards via tracingActive so we never call
 * stop() when nothing is running — Playwright logs the error before our
 * catch can suppress it. Never throws.
 */
async function startTracingSafe(context, options) {
    if (tracingActive) {
        try { await context.tracing.stop() } catch {}
        tracingActive = false
    }
    try {
        await context.tracing.start(options)
        tracingActive = true
        return true
    } catch (err) {
        console.warn(`[trace] start failed: ${err.message}`)
        return false
    }
}

/**
 * Stop tracing and save to path (if provided). Returns true if the trace
 * was written. Never throws. No-ops if tracing was never started.
 */
async function stopTracingSafe(context, path) {
    if (!tracingActive) return false
    tracingActive = false
    try {
        await context.tracing.stop(path ? { path } : undefined)
        return Boolean(path)
    } catch (err) {
        return false
    }
}

export { expect }

// Playwright's _wrapApiCall logs the "Must start tracing before stopping" error
// before our catch can suppress it. A module-level flag prevents the call entirely.
let tracingActive = false
