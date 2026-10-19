import { planMemoryContext } from "./memory-context.js";
import { sameValue } from "./events.js";
import { resolveProfileSource } from "./profile-views.js";
import { CampaignController as EngineController } from "../../engine/controller.js";
import { rollD6 } from "../../engine/dice.js";
import { createMinorCampaign, minorCharacterGame } from "./module.js";
import { prepareMinorAction } from "./rules.js";
import { projectActionReceipt, projectPlayer } from "./views.js";
export class CampaignController {
    #engine;
    constructor(store, changed = () => { }, die = rollD6) {
        this.#engine = new EngineController(store, minorCharacterGame, changed, die);
    }
    get state() {
        const { binding, busy, status, available } = this.#engine.state;
        return { binding, busy, status, available };
    }
    get hasCampaign() { return !!this.#engine.state.campaign; }
    // Confirmed conflicts remain observable during saves/uncertainty; review admission is separate.
    get publicationConflict() {
        const jobs = this.#engine.state.campaign?.snapshot.state.memoryPublications;
        if (!jobs)
            return undefined;
        const acknowledged = new Map();
        for (const job of jobs)
            if (job.acknowledgement)
                acknowledged.set(job.document.key, Math.max(acknowledged.get(job.document.key) ?? -1, job.document.acceptedRevision));
        const job = jobs.find(job => job.conflict
            && (acknowledged.get(job.document.key) ?? -1) <= job.document.acceptedRevision);
        return job ? structuredClone(job) : undefined;
    }
    get playerView() {
        const campaign = this.#engine.state.campaign;
        return campaign ? projectPlayer(campaign) : undefined;
    }
    // Trusted delivery projection only; never expose raw campaign, transcript or knowledge metadata.
    get publicationWork() {
        const { campaign, available, busy, binding } = this.#engine.state;
        if (!campaign || !available || busy)
            return undefined;
        return structuredClone({ binding, campaignId: campaign.id, branchId: campaign.branchId,
            revision: campaign.revision, jobs: campaign.snapshot.state.memoryPublications });
    }
    prepareMemoryContext(recipientIds) {
        const { campaign, available, busy, binding } = this.#engine.state;
        if (!campaign || !available || busy)
            return { kind: 'held', reason: 'Campaign unavailable or saving.' };
        return planMemoryContext(campaign.snapshot.state, recipientIds, { binding, campaignId: campaign.id, branchId: campaign.branchId, revision: campaign.revision });
    }
    matchesMemoryContext(scope) {
        const { campaign, available, busy, binding } = this.#engine.state;
        return !!campaign && available && !busy && binding === scope.binding && campaign.id === scope.campaignId
            && campaign.branchId === scope.branchId && campaign.revision === scope.revision;
    }
    async recordMemoryOutcome(context, ref, destination, outcome) {
        const entry = this.#recorded(context)
            ?? await this.#engine.submit({ ...context, body: { kind: 'record-memory-outcome', ref, destination, outcome } });
        if (!sameValue(entry.event, { kind: 'memory-outcome-recorded', ref, destination, outcome })) {
            throw new Error('This ID belongs to another memory outcome operation.');
        }
    }
    async reviewMemoryConflict(context, ref, destination, actual) {
        const entry = this.#recorded(context)
            ?? await this.#engine.submit({ ...context, body: { kind: 'review-memory-conflict', ref, destination, actual } });
        if (!sameValue(entry.event, { kind: 'memory-conflict-reviewed', ref, destination, actual })) {
            throw new Error('This ID belongs to another memory conflict review.');
        }
    }
    resolveProfileSource(expected, personId, source) {
        const { campaign, available, busy } = this.#engine.state;
        if (!campaign || !available || busy || campaign.id !== expected.campaignId
            || campaign.branchId !== expected.branchId || campaign.revision !== expected.revision
            || !campaign.snapshot.state.profiles.some(profile => profile.personId === personId))
            return null;
        return resolveProfileSource(campaign.snapshot.state, personId, 'player', source);
    }
    get canGenerate() { return this.#engine.canGenerate; }
    open(binding) { return this.#engine.open(binding); }
    create(startAnchor) {
        return this.#engine.create(binding => createMinorCampaign(binding, startAnchor));
    }
    // A retry must not resolve an already recorded selection against subsequently renamed entries.
    #recorded(context) {
        const { campaign, busy, available } = this.#engine.state;
        if (context.campaignId !== campaign?.id || context.branchId !== campaign.branchId) {
            throw new Error('Operation belongs to another campaign or branch.');
        }
        const entry = campaign.journal.find(entry => entry.operationId === context.operationId);
        if (entry && (!available || busy))
            throw new Error('Campaign unavailable or saving.');
        return entry;
    }
    async submitAction(command) {
        const existing = this.#recorded(command);
        const { action, ...context } = command;
        const entry = existing ?? await this.#engine.submit({ ...context,
            body: prepareMinorAction(this.#engine.state.campaign.snapshot.state, command) });
        if (entry.event.kind !== 'action-resolved')
            throw new Error('This ID belongs to another operation kind.');
        return projectActionReceipt(entry);
    }
    async correctSheet(command) {
        const existing = this.#recorded(command);
        const { ref, value, reason, ...context } = command;
        const entry = existing ?? await this.#engine.submit({ ...context, body: { kind: 'correction', ref, value, reason } });
        if (entry.event.kind !== 'field-corrected')
            throw new Error('This ID belongs to another operation kind.');
        return structuredClone({ command: { ...entry.context, ...entry.event.command },
            before: entry.event.before, revision: entry.revision });
    }
    async correctSheetBatch(command) {
        const existing = this.#recorded(command);
        const { changes, reason, ...context } = command;
        const entry = existing ?? await this.#engine.submit({ ...context, body: { kind: 'corrections', changes, reason } });
        if (entry.event.kind !== 'fields-corrected')
            throw new Error('This ID belongs to another operation kind.');
        return structuredClone(entry);
    }
    async manifestElement(context, element) {
        const entry = this.#recorded(context)
            ?? await this.#engine.submit({ ...context, body: { kind: 'manifest-element', element } });
        if (entry.event.kind !== 'element-manifested')
            throw new Error('This ID belongs to another operation kind.');
    }
    async resolveMemoryDestination(context, documentKey) {
        const entry = this.#recorded(context)
            ?? await this.#engine.submit({ ...context, body: { kind: 'resolve-memory-destination', documentKey } });
        if (entry.event.kind !== 'memory-destination-resolved' || entry.event.documentKey !== documentKey) {
            throw new Error('This ID belongs to another memory resolution operation.');
        }
    }
    async #bindMemory(context, personId, bookId) {
        const entry = this.#recorded(context)
            ?? await this.#engine.submit({ ...context, body: { kind: 'bind-memory', personId, bookId } });
        if (entry.event.kind !== 'memory-bound' || entry.event.personId !== personId
            || !sameValue(entry.event.after, { backend: 'journal', id: bookId })) {
            throw new Error('This ID belongs to another memory binding operation.');
        }
    }
    bindPersonMemory(context, personId, bookId) {
        return this.#bindMemory(context, personId, bookId);
    }
    bindCanonicalMemory(context, bookId) {
        return this.#bindMemory(context, null, bookId);
    }
    async #profile(context, body) {
        const entry = this.#recorded(context) ?? await this.#engine.submit({ ...context, body });
        if (entry.event.kind !== 'profile-updated' || entry.event.command.kind !== body.kind) {
            throw new Error('This ID belongs to another operation kind.');
        }
    }
    addPerson(context, name) {
        return this.#profile(context, { kind: 'add-person', name });
    }
    renamePerson(context, personId, name) {
        return this.#profile(context, { kind: 'rename-person', personId, name });
    }
    retirePerson(context, personId, retired) {
        return this.#profile(context, { kind: 'retire-person', personId, retired });
    }
    saveProfileDetails(context, personId, details) {
        return this.#profile(context, { kind: 'save-profile-details', personId, details });
    }
    saveProfile(context, personId, changes) {
        return this.#profile(context, { kind: 'save-profile', personId, changes });
    }
    async correctSceneEvent(context, sceneRecordId, eventId, text, reason) {
        const entry = this.#recorded(context)
            ?? await this.#engine.submit({ ...context, body: { kind: 'correct-scene-event', sceneRecordId, eventId, text, reason } });
        if (entry.event.kind !== 'scene-event-corrected' || entry.event.correction.sceneRecordId !== sceneRecordId
            || entry.event.correction.eventId !== eventId || entry.event.correction.after !== text || entry.event.correction.reason !== reason) {
            throw new Error('This ID belongs to another scene correction operation.');
        }
    }
    async saveSceneReview(context, source, proposal) {
        const entry = this.#recorded(context)
            ?? await this.#engine.submit({ ...context, body: { kind: 'save-scene-review', source, proposal } });
        if (entry.event.kind !== 'scene-review-saved')
            throw new Error('This ID belongs to another operation kind.');
    }
    async reviseSceneReview(context, reviewId, reviewRevision, proposal) {
        const entry = this.#recorded(context)
            ?? await this.#engine.submit({ ...context, body: { kind: 'revise-scene-review', reviewId, reviewRevision, proposal } });
        if (entry.event.kind !== 'scene-review-revised')
            throw new Error('This ID belongs to another operation kind.');
    }
    async acceptSceneReview(context, reviewId, reviewRevision, fingerprint) {
        const entry = this.#recorded(context)
            ?? await this.#engine.submit({ ...context, body: { kind: 'accept-scene-review', reviewId, reviewRevision, fingerprint } });
        if (entry.event.kind !== 'scene-review-accepted')
            throw new Error('This ID belongs to another operation kind.');
    }
    async cancelSceneReview(context, reviewId) {
        const entry = this.#recorded(context)
            ?? await this.#engine.submit({ ...context, body: { kind: 'cancel-scene-review', reviewId } });
        if (entry.event.kind !== 'scene-review-cancelled')
            throw new Error('This ID belongs to another operation kind.');
    }
    async switchClass(context, classId) {
        const entry = this.#recorded(context)
            ?? await this.#engine.submit({ ...context, body: { kind: 'switch-class', classId } });
        if (entry.event.kind !== 'class-switched')
            throw new Error('This ID belongs to another operation kind.');
    }
    async acknowledgeManual(context, target, note) {
        const entry = this.#recorded(context)
            ?? await this.#engine.submit({ ...context, body: { kind: 'manual-handled', target, note } });
        if (entry.event.kind !== 'manual-handled')
            throw new Error('This ID belongs to another operation kind.');
    }
}
