import { sameValue } from "./game/minor-character/events.js";
export class SceneReviewSession {
    draft;
    busy = false;
    message = '';
    /** Runs once the journal has recorded an acceptance (direct or retried); never after a failure or a cancel. */
    accepted;
    prepared;
    epoch = 0;
    regenerate;
    gmConfigured;
    controller;
    capture;
    ready;
    changed;
    constructor(controller, capture, ready, changed, regenerate, gmConfigured) {
        this.controller = controller;
        this.capture = capture;
        this.ready = ready;
        this.changed = changed;
        this.regenerate = regenerate;
        this.gmConfigured = gmConfigured;
    }
    reconcile(view) {
        if (!this.controller.state.available || this.controller.state.busy)
            return;
        const owner = this.prepared?.context ?? this.draft?.context;
        if (owner && (owner.campaignId !== view.context.campaignId || owner.branchId !== view.context.branchId))
            this.reset();
        if (this.prepared && view.history.some(entry => entry.operationId === this.prepared.context.operationId)) {
            const recovered = this.prepared.kind;
            this.prepared = undefined;
            this.message = 'Scene operation recovered.';
            // A recovered acceptance was durably recorded, so it follows through like a direct one.
            if (recovered === 'accept')
                void this.accepted?.();
        }
        const previous = this.draft;
        if (!view.sceneReview) {
            this.draft = undefined;
            return;
        }
        if (!previous || previous.context.campaignId !== view.context.campaignId || previous.context.branchId !== view.context.branchId
            || previous.review.id !== view.sceneReview.id || previous.review.revision !== view.sceneReview.revision) {
            this.draft = structuredClone({ context: view.context, review: view.sceneReview });
        }
    }
    reopen() {
        this.epoch++;
        this.busy = false;
        if (this.prepared?.kind === 'revise' && this.draft)
            this.draft.review.proposal = structuredClone(this.prepared.proposal);
        else
            this.draft = undefined;
    }
    reset() { this.prepared = undefined; this.reopen(); this.message = ''; }
    get pendingOperation() { return !!this.prepared; }
    get regenerationAvailable() { return this.ready() && this.gmConfigured(); }
    get canRetry() { return !!this.prepared && !this.busy && this.ready(); }
    get canSave() { return !this.busy && this.current && (!this.prepared || this.prepared.kind === 'revise'); }
    get canCancel() { return this.ready() && !this.busy && !this.prepared && !!this.controller.playerView?.sceneReview; }
    get canAccept() {
        return this.canCancel && this.current && sameValue(this.draft.review.proposal, this.controller.playerView.sceneReview.proposal);
    }
    async retry() {
        if (this.prepared?.kind === 'save')
            await this.retryCreate();
        else if (this.prepared?.kind === 'revise')
            await this.save();
        else if (this.prepared)
            await this.act(this.prepared.kind);
    }
    async act(kind, regenerate = false) {
        const view = this.controller.playerView, review = view?.sceneReview, retained = this.prepared;
        if (!view || !review || this.busy || !this.ready() || (retained && retained.kind !== kind))
            return;
        if (!retained && !(kind === 'accept' ? this.canAccept : this.canCancel))
            return;
        if ((retained?.kind === 'cancel' ? retained.regenerate : regenerate) && !this.regenerationAvailable) {
            this.message = 'Choose an available GM connection and model before regenerating.';
            this.changed();
            return;
        }
        const expected = retained ? { campaignId: retained.context.campaignId, branchId: retained.context.branchId,
            revision: retained.context.expectedRevision } : { ...view.context };
        const epoch = this.epoch;
        let generate = false, accepted = false;
        this.busy = true;
        this.message = kind === 'accept' ? 'Accepting scene…' : 'Cancelling review…';
        this.changed();
        try {
            const context = await this.capture(expected, kind === 'accept' ? retained?.source ?? review.source : undefined, retained?.context);
            if (epoch !== this.epoch)
                return;
            const prepared = this.prepared ??= kind === 'accept'
                ? { kind, context, source: review.source, id: review.id, revision: review.revision }
                : { kind, context, source: review.source, id: review.id, regenerate };
            if (prepared.kind === 'accept')
                await this.controller.acceptSceneReview(prepared.context, prepared.id, prepared.revision, prepared.source.fingerprint);
            else if (prepared.kind === 'cancel')
                await this.controller.cancelSceneReview(prepared.context, prepared.id);
            if (epoch !== this.epoch)
                return;
            generate = prepared.kind === 'cancel' && prepared.regenerate;
            accepted = prepared.kind === 'accept';
            this.prepared = undefined;
            this.draft = undefined;
            this.message = kind === 'accept' ? 'Scene accepted.' : 'Review cancelled. The scene remains open.';
        }
        catch (error) {
            if (epoch !== this.epoch)
                return;
            this.message = error instanceof Error ? error.message : 'Scene operation failed.';
            if (this.controller.state.available)
                this.prepared = undefined;
            else
                this.message += ' Operation retained. Reopen saved campaign before retrying.';
        }
        finally {
            if (epoch === this.epoch) {
                this.busy = false;
                this.changed();
            }
        }
        if (accepted)
            await this.accepted?.();
        if (generate)
            await this.regenerate();
    }
    get pendingSave() { return this.prepared?.kind === 'save'; }
    async create(result) {
        if (this.busy || this.prepared || !this.ready())
            return;
        this.prepared = { kind: 'save', context: structuredClone(result.operation),
            source: structuredClone(result.source), proposal: structuredClone(result.proposal) };
        await this.retryCreate();
    }
    async retryCreate() {
        const prepared = this.prepared;
        if (!prepared || prepared.kind !== 'save' || this.busy || !this.ready())
            return;
        const epoch = this.epoch;
        this.busy = true;
        this.message = 'Saving scene draft…';
        this.changed();
        try {
            const { campaignId, branchId, expectedRevision: revision } = prepared.context;
            await this.capture({ campaignId, branchId, revision }, prepared.source, prepared.context);
            if (epoch !== this.epoch)
                return;
            await this.controller.saveSceneReview(prepared.context, prepared.source, prepared.proposal);
            if (epoch !== this.epoch)
                return;
            this.prepared = undefined;
            this.message = 'Scene draft saved. Review it before acceptance.';
            this.reconcile(this.controller.playerView);
        }
        catch (error) {
            if (epoch !== this.epoch)
                return;
            this.message = error instanceof Error ? error.message : 'Scene draft could not be saved.';
            if (this.controller.state.available)
                this.prepared = undefined;
            else
                this.message += ' Captured draft retained. Reopen saved campaign before retrying.';
        }
        finally {
            if (epoch === this.epoch) {
                this.busy = false;
                this.changed();
            }
        }
    }
    get editable() { return !this.busy && !this.prepared && this.current; }
    get current() {
        const view = this.controller.playerView, draft = this.draft;
        return !!view && !!draft && this.ready() && sameValue(view.context, draft.context)
            && view.sceneReview?.id === draft.review.id && view.sceneReview.revision === draft.review.revision
            && !view.sceneReview.profilesChanged;
    }
    edit(update) {
        if (!this.editable)
            return;
        update(this.draft);
        this.changed();
    }
    async save(draft = this.draft) {
        if (!draft || draft !== this.draft || !this.canSave)
            return;
        const input = structuredClone(draft), epoch = this.epoch;
        this.busy = true;
        this.message = 'Saving review…';
        this.changed();
        try {
            const context = await this.capture(input.context, input.review.source, this.prepared?.context);
            if (epoch !== this.epoch || draft !== this.draft)
                return;
            this.prepared ??= { kind: 'revise', context, source: input.review.source, id: input.review.id,
                revision: input.review.revision, proposal: input.review.proposal };
            const prepared = this.prepared;
            if (prepared.kind !== 'revise')
                return;
            await this.controller.reviseSceneReview(prepared.context, prepared.id, prepared.revision, prepared.proposal);
            if (epoch !== this.epoch)
                return;
            this.prepared = undefined;
            this.message = 'Review saved. The scene remains open.';
            this.reconcile(this.controller.playerView);
        }
        catch (error) {
            if (epoch !== this.epoch)
                return;
            this.message = error instanceof Error ? error.message : 'Review could not be saved.';
            if (this.controller.state.available)
                this.prepared = undefined;
            else
                this.message += ' Draft retained. Reopen saved campaign before retrying.';
        }
        finally {
            if (epoch === this.epoch) {
                this.busy = false;
                this.changed();
            }
        }
    }
}
