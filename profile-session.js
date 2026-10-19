export class ProfileSession {
    draft;
    busy = false;
    message = '';
    prepared;
    controller;
    capture;
    ready;
    changed;
    constructor(controller, capture, ready, changed) {
        this.controller = controller;
        this.capture = capture;
        this.ready = ready;
        this.changed = changed;
    }
    get editing() { return !!this.draft; }
    get editable() { return this.current && !this.busy && !this.prepared; }
    get canBegin() { return this.ready() && !this.editing; }
    get canSave() { return this.current && !this.busy && !!this.draft?.text.trim(); }
    get current() {
        const current = this.controller.playerView?.context, expected = this.draft?.context;
        return this.ready() && !!current && !!expected && current.campaignId === expected.campaignId
            && current.branchId === expected.branchId && current.revision === expected.revision;
    }
    begin(view, personId, section, entryId) {
        if (!this.canBegin)
            return;
        const profile = view.profiles.find(profile => profile.personId === personId);
        if (!profile)
            return;
        const entry = entryId ? profile.entries.find(entry => entry.id === entryId) : undefined;
        if (entryId && !entry)
            return;
        this.draft = { context: { ...view.context }, personId, entryId: entry?.id ?? crypto.randomUUID(),
            section: entry?.section ?? section, text: entry?.text ?? '' };
        this.message = '';
        this.changed();
    }
    update(text) { if (this.editable)
        this.draft.text = text; }
    reset() { this.draft = undefined; this.prepared = undefined; this.busy = false; this.message = ''; }
    cancel() { if (!this.busy) {
        this.reset();
        this.changed();
    } }
    reconcile(view) {
        const draft = this.draft;
        if (!draft)
            return;
        if (draft.context.campaignId !== view.context.campaignId || draft.context.branchId !== view.context.branchId
            || !view.profiles.some(profile => profile.personId === draft.personId)) {
            this.reset();
            return;
        }
        if (!this.controller.state.available || this.controller.state.busy)
            return;
        if (this.prepared && view.history.some(entry => entry.operationId === this.prepared.operationId))
            this.reset();
        else if (draft.context.revision !== view.context.revision) {
            this.message = 'The campaign revision changed. Cancel and edit the current profile.';
        }
        else if (this.prepared && !this.busy)
            this.message = 'Save was not recorded. Retry the retained prose or Cancel.';
    }
    async save() {
        const draft = this.draft;
        if (!draft || !this.canSave)
            return;
        // Freeze both the operation identity and submitted prose before asynchronous capture.
        const prepared = this.prepared ??= { operationId: crypto.randomUUID(), changes: [{
                    personId: draft.personId, entryId: draft.entryId, replacement: { section: draft.section, text: draft.text },
                }] };
        this.busy = true;
        this.message = 'Saving profile…';
        this.changed();
        try {
            const context = await this.capture(draft.context);
            if (this.draft !== draft)
                return;
            prepared.context ??= { ...context, operationId: prepared.operationId };
            await this.controller.saveProfile(prepared.context, draft.personId, prepared.changes);
            if (this.draft === draft)
                this.reset();
        }
        catch (error) {
            if (this.draft !== draft)
                return;
            this.message = error instanceof Error ? error.message : 'Profile save failed.';
            if (this.controller.state.available)
                this.prepared = undefined;
            else
                this.message += ' Prose retained. Reopen saved campaign before retrying.';
        }
        finally {
            if (this.draft === draft || !this.draft) {
                this.busy = false;
                this.changed();
            }
        }
    }
}
