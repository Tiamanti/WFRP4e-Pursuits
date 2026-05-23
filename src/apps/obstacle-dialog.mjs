import { OBSTACLE_TABLE } from "../static/obstacles.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const DIFFICULTIES = [
    { key: "veasy",               labelKey: "PURSUITS.DiffVeryEasy" },
    { key: "easy",               labelKey: "PURSUITS.DiffEasy" },
    { key: "average",            labelKey: "PURSUITS.DiffAverage" },
    { key: "challenging",        labelKey: "PURSUITS.DiffChallenging" },
    { key: "difficult",          labelKey: "PURSUITS.DiffDifficult" },
    { key: "hard",               labelKey: "PURSUITS.DiffHard" },
    { key: "vhard",               labelKey: "PURSUITS.DiffVeryHard" },
];

const NAVIGATE_SKILLS = [
    "Athletics", "Charm", "Charm Animal", "Climb", "Cool",
    "Dodge", "Drive", "Endurance", "Intimidate", "Melee",
    "Navigation", "Perception", "Ride (Horse)", "Stealth", "Swim",
];

class ObstacleDialog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        classes: ["obstacle-dialog", "warhammer"],
        window: {
            title: "PURSUITS.ObstacleDialogTitle",
            resizable: false,
        },
        position: {
            width: 500,
            height: "auto",
        },
        tag: "dialog",
    };

    static PARTS = {
        main: {
            template: "modules/wfrp4e-pursuits/templates/apps/obstacle-dialog.hbs",
        },
    };

    constructor(maxQuarryPosition, options) {
        super(options);
        this._maxQuarryPosition = maxQuarryPosition;
        this._resolve = options.resolve ?? null;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.obstacles      = OBSTACLE_TABLE;
        context.maxQuarryPosition = this._maxQuarryPosition;
        context.difficulties   = DIFFICULTIES.map(d => ({ key: d.key, label: game.i18n.localize(d.labelKey) }));
        context.navigateSkills = NAVIGATE_SKILLS;
        return context;
    }

    _onRender(context, options) {
        const html = this.element;
        const select       = html.querySelector(".obstacle-select");
        const preview      = html.querySelector(".obstacle-preview");
        const customForm   = html.querySelector(".custom-obstacle-form");
        const perceivedSel = html.querySelector(".custom-perceived-select");
        const navSingle    = html.querySelector(".custom-nav-single");
        const navPerceived = html.querySelector(".custom-nav-perceived");
        const navUnperc    = html.querySelector(".custom-nav-unperceived");

        // default nav difficulty selects to "average"
        for (const cls of [".custom-nav-diff", ".custom-navp-diff", ".custom-navu-diff"]) {
            const el = html.querySelector(cls);
            if (el) el.value = "average";
        }

        const updatePreview = () => {
            const idx   = Number(select?.value ?? 0);
            const entry = OBSTACLE_TABLE[idx];
            if (!entry || !preview) return;
            preview.querySelector(".obs-perceived-value").textContent    = entry.perceivedText;
            preview.querySelector(".obs-test-value").textContent         = entry.testToNavigate;
            preview.querySelector(".obs-consequences-value").textContent = entry.consequencesText;
            preview.hidden = false;
        };

        const updatePerceivedFields = () => {
            const isAuto         = perceivedSel.value === "auto";
            navSingle.hidden    = !isAuto;
            navPerceived.hidden = isAuto;
            navUnperc.hidden    = isAuto;
        };

        const updateMainSelect = () => {
            const isCustom    = select.value === "custom";
            customForm.hidden = !isCustom;
            if (isCustom) {
                preview.hidden = true;
            } else {
                updatePreview();
            }
        };

        select?.addEventListener("change", updateMainSelect);
        perceivedSel?.addEventListener("change", updatePerceivedFields);

        updatePreview();

        html.querySelector(".obstacle-confirm")?.addEventListener("click", () => {
            let obstacleEntry;
            const distInput        = html.querySelector(".obstacle-distance-input");
            const relativeDistance = distInput ? (parseInt(distInput.value) || 0) : 0;

            if (select.value === "custom") {
                const isAuto    = perceivedSel.value === "auto";
                const navDiff   = html.querySelector(".custom-nav-diff");
                const navSkill  = html.querySelector(".custom-nav-skill");
                const navpDiff  = html.querySelector(".custom-navp-diff");
                const navpSkill = html.querySelector(".custom-navp-skill");
                const navuDiff  = html.querySelector(".custom-navu-diff");
                const navuSkill = html.querySelector(".custom-navu-skill");
                const consInput  = html.querySelector(".custom-consequences-input");
                const nameInput  = html.querySelector(".custom-name-input");

                const getDiffLabel = sel => sel?.options[sel.selectedIndex]?.text ?? "";

                const navigateDiff  = isAuto ? navDiff.value  : navpDiff.value;
                const navigateSkill = isAuto ? navSkill.value : navpSkill.value;

                obstacleEntry = {
                    name:                          nameInput?.value.trim() || game.i18n.localize("PURSUITS.ObstacleCustom"),
                    perceivedText:                 isAuto
                                                       ? game.i18n.localize("PURSUITS.ObstacleAutoPerceived")
                                                       : perceivedSel.options[perceivedSel.selectedIndex].text,
                    isAutoPerceived:               isAuto,
                    perceptionDifficulty:          isAuto ? null : perceivedSel.value,
                    testToNavigate:                `${getDiffLabel(isAuto ? navDiff : navpDiff)} ${navigateSkill} Test`,
                    testToNavigateUnperceived:     isAuto ? null : `${getDiffLabel(navuDiff)} ${navuSkill.value} Test`,
                    navigateSkill:                 navigateSkill,
                    navigateDifficulty:            navigateDiff,
                    navigateSkillUnperceived:      isAuto ? null : navuSkill.value,
                    navigateDifficultyUnperceived: isAuto ? null : navuDiff.value,
                    consequencesText:              consInput?.value.trim() || "—",
                    automaticConsequences:         false,
                    consequences:                  {},
                    blocksProgress:                html.querySelector(".obstacle-blocks-progress")?.checked ?? false,
                };
            } else {
                const idx   = Number(select?.value ?? 0);
                obstacleEntry = OBSTACLE_TABLE[idx];
            }

            this._resolve?.({ obstacleEntry, relativeDistance });
            this._resolve = null;
            this.close({ force: true });
        });

        html.querySelector(".obstacle-cancel")?.addEventListener("click", () => {
            this.close({ force: true });
        });
    }

    async close(options) {
        this._resolve?.(null);
        this._resolve = null;
        return super.close(options);
    }
}

export function openObstacleDialog(maxQuarryPosition) {
    return new Promise((resolve) => {
        const dialog = new ObstacleDialog(maxQuarryPosition, { resolve });
        dialog.render(true);
    });
}
