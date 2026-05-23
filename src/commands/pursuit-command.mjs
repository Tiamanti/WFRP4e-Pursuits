import { createSimpleSetupMessage } from "../chat/pursuit-simple-setup.mjs";
import { createComplexSetupMessage } from "../chat/pursuit-complex-setup.mjs";
import PursuitTypeDialog from "../apps/pursuit-type-dialog.mjs";

export async function handlePursuitCommand(type) {
    if (!game.user.isGM) {
        ui.notifications.error(game.i18n.localize("PURSUITS.GMOnly"));
        return;
    }

    const normalizedType = type?.toLowerCase();

    if (normalizedType === "simple") {
        createSimpleSetupMessage();
    } else if (normalizedType === "complex") {
        if (!game.modules.get("wfrp4e-up-in-arms")?.active) {
            ui.notifications.warn(game.i18n.localize("PURSUITS.UpInArmsRequired"));
            return;
        }
        createComplexSetupMessage();
    } else {
        const selectedType = await PursuitTypeDialog.prompt();
        if (selectedType === "simple")       createSimpleSetupMessage();
        else if (selectedType === "complex") createComplexSetupMessage();
    }
}
