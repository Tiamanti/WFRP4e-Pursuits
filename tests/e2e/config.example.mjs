import { fileURLToPath } from "node:url"

export default {
    // Existing Foundry data folder to copy test assets from.
    // license.json is copied automatically from sourceDataPath/Config/.
    sourceDataPath: "C:\\Users\\YourName\\AppData\\Local\\FoundryVTT",

    // System, module, and world IDs to copy from sourceDataPath into the test data folder
    systemsToCopy: ["wfrp4e"],
    modulesToCopy: ["wfrp4e-pursuits"],
    worldsToCopy:  ["your-wfrp4e-test-world"],

    // Paths — auto-derived relative to this config file; override if needed
    testDataPath:              fileURLToPath(new URL("../../test-data", import.meta.url)),
    foundryNodePath:           fileURLToPath(new URL("../../../foundryvtt-test-framework/FoundryVTT-Node", import.meta.url)),
    diceOverrideExtensionPath: fileURLToPath(new URL("../../../foundryvtt-test-framework/dice-override", import.meta.url)),

    // Server and browser settings
    foundryServerPort: 30000,
    world:             "your-wfrp4e-test-world",  // passed as --world= to the Foundry server
    loginUser:         "Gamemaster",               // display name of the GM user (primary browser)
    playerUser:        "Player",                   // display name of a non-GM user (used by socket round-trip tests)
    playerUser2:       "Player2",                  // display name of a non-GM user
    headless:          false,

    // Timeouts in milliseconds
    serverReadyTimeout:  30000,
    foundryReadyTimeout: 60000,
}
