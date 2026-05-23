const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export default class PursuitTypeDialog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        classes: ["pursuit-type-dialog", "warhammer"],
        window: {
            title: "PURSUITS.SelectType",
            resizable: false,
        },
        position: {
            width: 300,
            height: "auto",
        },
        actions: {
            selectSimple: PursuitTypeDialog._onSelectSimple,
            selectComplex: PursuitTypeDialog._onSelectComplex,
        }
    };

    static PARTS = {
        form: {
            template: "modules/wfrp4e-pursuits/templates/apps/pursuit-type.hbs"
        }
    };

    /** Resolves with "simple", "complex", or null if closed. */
    static prompt() {
        return new Promise((resolve) => {
            const dialog = new this({}, { resolve });
            dialog.render(true);
        });
    }

    constructor(data, options) {
        super(options);
        this._resolve = options.resolve ?? null;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.upInArmsActive = game.modules.get("wfrp4e-up-in-arms")?.active ?? false;
        return context;
    }

    async close(options) {
        this._resolve?.(null);
        return super.close(options);
    }

    static _onSelectSimple() {
        this._resolve?.("simple");
        this._resolve = null;
        this.close({ force: true });
    }

    static _onSelectComplex() {
        if (!game.modules.get("wfrp4e-up-in-arms")?.active) return;
        this._resolve?.("complex");
        this._resolve = null;
        this.close({ force: true });
    }
}
