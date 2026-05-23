import { onRenderHTML as simpleOnRenderHTML } from "./chat/pursuit-message-simple.mjs";
import { onRenderHTML as complexOnRenderHTML, onTestRolled, dispatchReroll, REROLL_SOCKET } from "./chat/pursuit-message-complex.mjs";
import { handlePursuitCommand } from "./commands/pursuit-command.mjs";

Hooks.once("setup", () => {
    game.wfrp4e.commands.add({
        pursuit: {
            description: game.i18n.localize("PURSUITS.CommandDescription"),
            args: ["type"],
            defaultArg: "type",
            callback: (type) => handlePursuitCommand(type),
        }
    });
});

Hooks.once("ready", () => {
    if (!game.user.isGM) return;
    game.socket.on(REROLL_SOCKET, async (msg) => {
        if (msg?.action === "reroll") {
            await dispatchReroll(msg);
        } else if (msg?.action === "deleteMessages") {
            for (const id of msg.ids ?? []) game.messages.get(id)?.delete();
        }
    });
});

Hooks.on("renderChatMessageHTML", (message, html) => {
    if (!message.flags?.["wfrp4e-pursuits"]) return;
    if (!game.user.isGM) {
        html.querySelectorAll(".gm-only").forEach(el => el.remove());
    }
    const flags = message.flags["wfrp4e-pursuits"];
    const pursuitType = flags.pursuitType ?? (flags.type === "catch" ? "complex" : null);
    if (pursuitType === "simple")       simpleOnRenderHTML(message, html);
    else if (pursuitType === "complex") complexOnRenderHTML(message, html);
});

Hooks.on("wfrp4e:rollTest", (test) => onTestRolled(test));
