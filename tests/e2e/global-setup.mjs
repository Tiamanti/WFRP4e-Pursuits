import { FoundryTestFramework } from "foundryvtt-test-framework"
import config from "./config.mjs"

/**
 * Playwright globalSetup. Runs once for the entire test run, before any
 * worker spawns. We spawn the Foundry node server here so it survives
 * Playwright's worker recycling (workers are torn down and recreated after
 * a test failure, and after each test file in some configurations — keeping
 * the server inside the worker fixture would mean a full Foundry restart
 * between files).
 *
 * The returned function is treated as a globalTeardown: it kills the server
 * when the run finishes.
 */
export default async () => {
    const handle = await FoundryTestFramework.startServer(config)
    return async () => {
        await FoundryTestFramework.stopServer(handle)
    }
}
