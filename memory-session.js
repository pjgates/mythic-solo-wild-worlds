import { publishPending } from "./memory-publisher.js";
export class MemorySession {
    busy = false;
    message = '';
    draft;
    operation;
    epoch = 0;
    uncertain = false;
    controller;
    adapter;
    ready;
    changed;
    constructor(controller, adapter, ready, changed) {
        this.controller = controller;
        this.adapter = adapter;
        this.ready = ready;
        this.changed = changed;
    }
    get reviewing() { return !!this.draft; }
    get review() { return this.draft ? structuredClone(this.draft) : undefined; }
    get conflict() { return this.controller.publicationConflict; }
    get hasConflict() { return !!this.conflict; }
    get canPublish() { return !this.busy && !this.draft && this.ready() && this.controller.hasCampaign; }
    get canReview() { return this.canPublish && this.hasConflict; }
    get canReplace() {
        const draft = this.draft;
        return !this.busy && this.ready() && !!draft && this.controller.matchesMemoryContext(draft);
    }
    get status() {
        if (this.hasConflict)
            return 'Memory needs conflict review. A newer correction may be waiting for this version.';
        if (this.controller.playerView?.memoryPublications.some(item => item.status === 'pending')) {
            return 'Memory is pending. Publish or retry after checking destination setup.';
        }
        return 'Accepted memory is published.';
    }
    beginReview() {
        if (!this.canReview)
            return;
        const work = this.controller.publicationWork, job = this.conflict;
        this.draft = { binding: work.binding, campaignId: work.campaignId, branchId: work.branchId, revision: work.revision,
            ref: { documentKey: job.document.key, acceptedOperationId: job.document.acceptedOperationId },
            destination: structuredClone(job.destination), desired: structuredClone(job.document), actual: structuredClone(job.conflict.actual) };
        this.operation = undefined;
        this.message = '';
        this.changed();
    }
    reset() { this.epoch++; this.draft = undefined; this.operation = undefined; this.busy = false; this.message = ''; this.uncertain = false; }
    cancel() { if (!this.busy) {
        this.reset();
        this.changed();
    } }
    reconcile() {
        const draft = this.draft;
        if (this.uncertain && !this.busy && this.controller.state.available && !this.controller.state.busy) {
            this.uncertain = false;
            this.message = '';
        }
        if (!draft)
            return;
        const view = this.controller.playerView;
        if (!view || this.controller.state.binding !== draft.binding || view.context.campaignId !== draft.campaignId
            || view.context.branchId !== draft.branchId) {
            this.reset();
            return;
        }
        if (this.busy || !this.controller.state.available || this.controller.state.busy)
            return;
        if (this.operation && view.history.some(entry => entry.operationId === this.operation.operationId)) {
            this.draft = undefined;
            this.operation = undefined;
            this.message = 'Replacement approval saved. Publish or retry to finish.';
        }
        else if (view.context.revision !== draft.revision)
            this.message = 'Campaign changed. Close this comparison and review the current conflict.';
    }
    async publish() {
        if (!this.canPublish)
            return;
        await this.run(() => publishPending(this.controller, this.adapter));
    }
    async replace() {
        const draft = this.draft;
        if (!draft || !this.canReplace)
            return;
        const operation = this.operation ??= { operationId: crypto.randomUUID(), campaignId: draft.campaignId,
            branchId: draft.branchId, expectedRevision: draft.revision,
            source: { messageId: draft.ref.documentKey, messageRevision: draft.ref.acceptedOperationId } };
        await this.run(async () => {
            await this.controller.reviewMemoryConflict(operation, draft.ref, draft.destination, draft.actual);
            if (this.draft !== draft)
                return;
            this.draft = undefined;
            this.operation = undefined;
            await publishPending(this.controller, this.adapter);
        });
    }
    async run(operation) {
        const epoch = this.epoch;
        this.busy = true;
        this.message = 'Publishing accepted memory…';
        this.changed();
        try {
            await operation();
            if (epoch === this.epoch) {
                this.message = '';
                this.uncertain = false;
            }
        }
        catch {
            if (epoch === this.epoch) {
                this.uncertain = !this.controller.state.available;
                this.message = this.uncertain ? 'Save outcome uncertain. Reopen saved campaign before retrying.'
                    : 'Memory operation could not finish. Review the current status and retry.';
            }
        }
        finally {
            if (epoch === this.epoch) {
                this.busy = false;
                this.changed();
            }
        }
    }
}
