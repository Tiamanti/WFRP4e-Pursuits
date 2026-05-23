import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        setupFiles: ["./tests/setup.mjs"],
        clearMocks: true,
        exclude: ["**/node_modules/**", "tests/e2e/**"],
    },
});
