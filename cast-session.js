export class CastSession {
    draft;
    busy = false;
    message = '';
    prepared;
    controller;
    capture;
    ready;
    changed;
    selected;
    constructor(controller, capture, ready, changed, selected) {
        this.controller = controller;
        this.capture = capture;
        this.ready = ready;
        this.changed = changed;
        this.selected = selected;
    }
    get editing() { return !!this.draft; }
    get editable() { return this.current && !this.busy && !this.prepared; }
    get canBegin() { return this.ready() && !this.editing; }
    get canSave() {
        return this.current && !this.busy && !!this.draft
            && (this.draft.command.kind === 'retire' || (this.draft.command.kind === 'bind-memory'
                ? !!this.draft.command.bookId.trim() : !!this.draft.command.name.trim()));
    }
    get current() {
        const current = this.controller.playerView?.context, expected = this.draft?.context;
        return this.ready() && !!current && !!expected && current.campaignId === expected.campaignId
            && current.branchId === expected.branchId && current.revision === expected.revision;
    }
    begin(view, command) {
        if (!this.canBegin)
            return;
        this.draft = { context: { ...view.context }, command: { ...command } };
        this.message = '';
        this.changed();
    }
    update(name) {
        if (this.editable && (this.draft.command.kind === 'add' || this.draft.command.kind === 'rename'))
            this.draft.command.name = name;
    }
    updateMemoryDestination(bookId) {
        if (this.editable && this.draft.command.kind === 'bind-memory')
            this.draft.command.bookId = bookId;
    }
    reset() { this.draft = undefined; this.prepared = undefined; this.busy = false; this.message = ''; }
    cancel() { if (!this.busy) {
        this.reset();
        this.changed();
    } }
    finish(prepared) {
        if (prepared.command.kind === 'bind-memory') {
            this.reset();
            return;
        }
        const personId = prepared.command.kind === 'add' ? JSON.stringify([prepared.operationId, 'person'])
            : prepared.command.personId;
        this.reset();
        this.selected(personId);
    }
    reconcile(view) {
        const draft = this.draft;
        if (!draft)
            return;
        const command = draft.command;
        if (draft.context.campaignId !== view.context.campaignId || draft.context.branchId !== view.context.branchId
            || command.kind !== 'add' && command.personId !== null && !view.profiles.some(profile => profile.personId === command.personId)) {
            this.reset();
            return;
        }
        if (!this.controller.state.available || this.controller.state.busy)
            return;
        if (this.prepared && view.history.some(entry => entry.operationId === this.prepared.operationId))
            this.finish(this.prepared);
        else if (draft.context.revision !== view.context.revision)
            this.message = 'The campaign revision changed. Cancel and reopen the person.';
        else if (this.prepared && !this.busy)
            this.message = 'Change was not recorded. Retry the retained change or Cancel.';
    }
    async save() {
        const draft = this.draft;
        if (!draft || !this.canSave)
            return;
        const prepared = this.prepared ??= { operationId: crypto.randomUUID(), command: { ...draft.command } };
        this.busy = true;
        this.message = prepared.command.kind === 'bind-memory' ? 'Saving memory destination…' : 'Saving person…';
        this.changed();
        try {
            const captured = await this.capture(draft.context);
            if (this.draft !== draft)
                return;
            prepared.context ??= { ...captured, operationId: prepared.operationId };
            const command = prepared.command;
            if (command.kind === 'add')
                await this.controller.addPerson(prepared.context, command.name);
            else if (command.kind === 'rename')
                await this.controller.renamePerson(prepared.context, command.personId, command.name);
            else if (command.kind === 'retire')
                await this.controller.retirePerson(prepared.context, command.personId, command.retired);
            else if (command.personId === null)
                await this.controller.bindCanonicalMemory(prepared.context, command.bookId);
            else
                await this.controller.bindPersonMemory(prepared.context, command.personId, command.bookId);
            if (this.draft === draft)
                this.finish(prepared);
        }
        catch (error) {
            if (this.draft !== draft)
                return;
            this.message = error instanceof Error ? error.message : 'Person change failed.';
            if (this.controller.state.available)
                this.prepared = undefined;
            else
                this.message += ' Change retained. Reopen saved campaign before retrying.';
        }
        finally {
            if (this.draft === draft || !this.draft) {
                this.busy = false;
                this.changed();
            }
        }
    }
}
