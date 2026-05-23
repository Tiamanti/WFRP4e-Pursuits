import { runSetup } from "foundryvtt-test-framework/setup"
import config from "./config.mjs"

try {
    await runSetup(config)
} catch (err) {
    console.error(`\nSetup failed: ${err.message}`)
    process.exit(1)
}
