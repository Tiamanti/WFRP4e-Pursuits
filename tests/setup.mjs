import { vi } from "vitest";

// Minimal Foundry VTT global stubs so source modules can be imported and called.
// Tests that need specific return values should override these per-test.

globalThis.foundry = {
    applications: {
        handlebars: {
            renderTemplate: vi.fn(async () => "<rendered>"),
        },
    },
};

globalThis.game = {
    user: { isGM: true },
    i18n: {
        localize: key => key,
        format:   (key, data) => `${key}:${JSON.stringify(data)}`,
    },
    messages: {
        get: vi.fn(() => ({ id: "stub-msg", delete: vi.fn(), flags: {} })),
    },
    wfrp4e: {
        config: {
            DAMAGE_TYPE: { IGNORE_AP: "ignoreAp", NORMAL: "normal" },
        },
    },
};

globalThis.ChatMessage = { create: vi.fn().mockResolvedValue(undefined) };
globalThis.fromUuid    = vi.fn(async (uuid) => null);
globalThis.ui          = { notifications: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } };
globalThis.CONFIG      = { Combat: { initiative: { formula: "1d10 + @i" } } };
