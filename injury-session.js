/** Optional wording never becomes a pending rules operation and never holds up the next turn. */
export class InjurySession {
    item;
    wording;
    editing = false;
    busy = false;
    saving = false;
    message = '';
    #scope = '';
    #epoch = 0;
    #scheduled = false;
    #controller;
    #model;
    #capture;
    #ready;
    #changed;
    constructor(controller, model, capture, ready, changed) {
        this.#controller = controller;
        this.#model = model;
        this.#capture = capture;
        this.#ready = ready;
        this.#changed = changed;
    }
    get configured() { return this.#model.configured; }
    get ready() { return this.#ready() && !this.saving; }
    reconcile() {
        if (this.saving)
            return;
        const view = this.#controller.playerView;
        const item = view?.injurySuggestions[0];
        const scope = item && view ? JSON.stringify([this.#controller.state.binding, view.context.campaignId, view.context.branchId, item]) : '';
        if (scope !== this.#scope) {
            this.#epoch++;
            this.#model.invalidate();
            this.#scope = scope;
            this.#scheduled = false;
            this.item = item;
            this.wording = undefined;
            this.busy = false;
            this.editing = false;
            this.message = '';
        }
        // A roll can land while the host is still narrating. Start once play becomes ready, without repeated requests.
        if (item && this.configured && this.ready && !this.#scheduled && !this.busy && !this.editing && !this.wording && !this.message) {
            this.#scheduled = true;
            const epoch = this.#epoch;
            queueMicrotask(() => {
                if (epoch !== this.#epoch)
                    return;
                this.#scheduled = false;
                void this.suggest();
            });
        }
    }
    async suggest() {
        if (!this.item || this.busy || !this.ready)
            return;
        const epoch = ++this.#epoch, item = structuredClone(this.item);
        this.busy = true;
        this.message = '';
        this.#changed();
        try {
            const wording = await this.#model.suggest(item);
            if (epoch === this.#epoch)
                this.wording = wording;
        }
        catch (error) {
            if (epoch === this.#epoch)
                this.message = error instanceof Error ? error.message : 'Suggestion unavailable. Rewrite it or keep generic.';
        }
        finally {
            if (epoch === this.#epoch) {
                this.busy = false;
                this.#changed();
            }
        }
    }
    rewrite() {
        if (!this.item || !this.ready)
            return;
        this.#epoch++;
        this.#model.invalidate();
        this.busy = false;
        this.editing = true;
        this.message = '';
        this.wording ??= { name: '', description: '' };
        this.#changed();
    }
    async save(generic = false) {
        const view = this.#controller.playerView, item = this.item;
        if (!view || !item || !this.ready || (!generic && !this.wording))
            return;
        const wording = generic ? { name: item.injury.name, description: item.injury.effect } : this.wording;
        if (!wording.name.trim() || !wording.description.trim()) {
            this.message = 'Add an injury name and description.';
            this.#changed();
            return;
        }
        this.#epoch++;
        this.#model.invalidate();
        this.busy = false;
        this.saving = true;
        this.message = '';
        this.#changed();
        try {
            await this.#controller.describeInjury(await this.#capture(view.context), {
                injuryId: item.injury.id, before: { name: item.injury.name, effect: item.injury.effect }, ...wording,
            });
        }
        catch (error) {
            this.message = error instanceof Error ? error.message : 'Could not save injury wording.';
        }
        finally {
            this.saving = false;
            this.reconcile();
            this.#changed();
        }
    }
}
