export class EventCorrectionSession {
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
    get current() {
        const view = this.controller.playerView, draft = this.draft;
        return this.ready() && !!view && !!draft && this.controller.state.binding === draft.binding
            && view.context.campaignId === draft.context.campaignId && view.context.branchId === draft.context.branchId
            && view.context.revision === draft.context.revision;
    }
    get canBegin() { return this.ready() && !this.editing; }
    get editable() { return this.current && !this.busy && !this.prepared; }
    get canSave() {
        return this.current && !this.busy && !!this.draft?.text.trim()
            && this.draft.text !== this.draft.before && !!this.draft.reason.trim();
    }
    begin(view, personId, sceneRecordId, eventId) {
        if (!this.canBegin)
            return;
        const event = view.profiles.find(profile => profile.personId === personId)?.timeline
            .find(scene => scene.sceneRecordId === sceneRecordId)?.events.find(event => event.id === eventId);
        if (!event)
            return;
        this.draft = { context: { ...view.context }, binding: this.controller.state.binding, personId,
            sceneRecordId, eventId, before: event.text, text: event.text, reason: '' };
        this.message = '';
        this.changed();
    }
    update(field, value) { if (this.editable)
        this.draft[field] = value; }
    reset() { this.draft = undefined; this.prepared = undefined; this.busy = false; this.message = ''; }
    cancel() { if (!this.busy) {
        this.reset();
        this.changed();
    } }
    reconcile(view) {
        const draft = this.draft;
        if (!draft)
            return;
        if (this.controller.state.binding !== draft.binding || draft.context.campaignId !== view.context.campaignId
            || draft.context.branchId !== view.context.branchId) {
            this.reset();
            return;
        }
        if (!this.controller.state.available || this.controller.state.busy)
            return;
        if (this.prepared && view.history.some(entry => entry.operationId === this.prepared.operationId))
            this.reset();
        else if (draft.context.revision !== view.context.revision) {
            this.message = 'The campaign revision changed. Cancel and correct the current event.';
        }
        else if (this.prepared && !this.busy)
            this.message = 'Save was not recorded. Retry the retained correction or Cancel.';
    }
    async save() {
        const draft = this.draft;
        if (!draft || !this.canSave)
            return;
        const prepared = this.prepared ??= { operationId: crypto.randomUUID(), text: draft.text, reason: draft.reason };
        this.busy = true;
        this.message = 'Saving event correction…';
        this.changed();
        try {
            const context = await this.capture(draft.context);
            if (this.draft !== draft)
                return;
            if (!this.current)
                throw new Error('Campaign changed; reopen the event before correcting it.');
            prepared.context ??= { ...context, operationId: prepared.operationId };
            await this.controller.correctSceneEvent(prepared.context, draft.sceneRecordId, draft.eventId, prepared.text, prepared.reason);
            if (this.draft === draft)
                this.reset();
        }
        catch (error) {
            if (this.draft !== draft)
                return;
            this.message = error instanceof Error ? error.message : 'Event correction failed.';
            if (this.controller.state.available)
                this.prepared = undefined;
            else
                this.message += ' Correction retained. Reopen saved campaign before retrying.';
        }
        finally {
            if (this.draft === draft || !this.draft) {
                this.busy = false;
                this.changed();
            }
        }
    }
}
