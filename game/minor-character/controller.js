import { planMemoryContext } from "./memory-context.js";
import { sameValue } from "./events.js";
import { resolveProfileSource } from "./profile-views.js";
import { CampaignController as EngineController } from "../../engine/controller.js";
import { rollD6 } from "../../engine/dice.js";
import { createMinorCampaign, minorCharacterGame } from "./module.js";
import { prepareMinorAction } from "./rules.js";
import { manaStrainCut } from "./strain.js";
import { projectActionReceipt, projectPlayer } from "./views.js";
import { projectNarrator, resolveNarrativePacing, } from "./narrator-projection.js";
import { exportCheckpoint, rebindCampaign } from "./checkpoints.js";
import { projectKeeperSecrets, } from "./encounters-keeper.js";
export class CampaignController {
    #engine;
    #store;
    #changed;
    #hasSavedCampaign = false;
    constructor(store, changed = () => { }, die = rollD6) {
        this.#store = store;
        this.#changed = changed;
        this.#engine = new EngineController(store, minorCharacterGame, changed, die);
    }
    get state() {
        const { binding, busy, status, available } = this.#engine.state;
        return { binding, busy, status, available, hasSavedCampaign: this.#hasSavedCampaign };
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
    /** The automatic Mana Strain Cut a declaration would carry right now, so proposals are classified as they will roll. */
    manaStrainCut(skill) {
        const campaign = this.#engine.state.campaign;
        return campaign ? manaStrainCut(campaign.snapshot.state, skill) : 0;
    }
    /** The narrator's public projection for the open campaign; absent while nothing is open or readable. */
    projectNarrator(mythic, pacing = 'auto') {
        const { campaign, available } = this.#engine.state;
        if (!campaign || !available)
            return undefined;
        return {
            text: projectNarrator(campaign, mythic, pacing),
            revision: campaign.revision,
            pacing: { mode: pacing, resolved: resolveNarrativePacing(campaign, pacing) },
        };
    }
    resolvePacing(pacing = 'auto') {
        const { campaign, available } = this.#engine.state;
        return campaign && available ? resolveNarrativePacing(campaign, pacing) : undefined;
    }
    get keeperView() {
        const campaign = this.#engine.state.campaign;
        return campaign ? projectKeeperSecrets(campaign.snapshot.state) : undefined;
    }
    exportCheckpoint(lineage = null) {
        const campaign = this.#engine.state.campaign;
        if (!campaign)
            throw new Error('No open campaign to export.');
        return exportCheckpoint(campaign, lineage);
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
    async open(binding) {
        this.#hasSavedCampaign = false;
        await this.#engine.open(binding);
        if (this.#engine.state.campaign) {
            this.#hasSavedCampaign = true;
        }
        else if (binding && this.#engine.state.available && this.#store.loadLatest) {
            try {
                const latest = await this.#store.loadLatest();
                if (this.#engine.state.binding === binding && !this.#engine.state.campaign) {
                    this.#hasSavedCampaign = !!latest;
                    this.#changed();
                }
            }
            catch {
                // Ignore unreadable latest pointer; current chat stays unbound
            }
        }
    }
    async create(startAnchor) {
        await this.#engine.create(binding => createMinorCampaign(binding, startAnchor));
        if (this.#engine.state.campaign)
            this.#hasSavedCampaign = true;
    }
    async continueCampaign(binding, startAnchor) {
        const { busy, available, campaign: existing } = this.#engine.state;
        if (busy || !available || existing)
            return;
        const raw = await this.#store.loadLatest?.();
        const source = raw && 'schemaVersion' in raw ? raw : raw?.campaign;
        if (!source)
            throw new Error('No saved campaign available to continue.');
        const rebound = rebindCampaign(source, binding);
        await this.#store.save(binding, rebound);
        await this.open(binding);
        const { campaign: current, available: ready } = this.#engine.state;
        if (!current || !ready)
            return;
        if (!sameValue(current.snapshot.state.world.scene.startAnchor, startAnchor) || current.snapshot.state.sceneReview !== null) {
            await this.#submitEvent({
                operationId: crypto.randomUUID(),
                campaignId: current.id,
                branchId: current.branchId,
                expectedRevision: current.revision,
                source: {
                    messageId: `${binding}:reanchor`,
                    messageRevision: startAnchor.prefixFingerprint,
                },
            }, { kind: 'reanchor-scene', startAnchor }, 'scene-reanchored');
        }
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
    async submitAction(command, proposalId) {
        const existing = this.#recorded(command);
        const { action, ...context } = command;
        const entry = existing ?? await this.#engine.submit({ ...context,
            body: prepareMinorAction(this.#engine.state.campaign.snapshot.state, command, proposalId) });
        if (entry.event.kind !== 'action-resolved')
            throw new Error('This ID belongs to another operation kind.');
        return projectActionReceipt(entry);
    }
    saveProposal(context, proposal) {
        return this.#submitEvent(context, { kind: 'save-proposal', proposal }, 'proposal-saved');
    }
    reviseProposal(context, proposalId, declaration) {
        return this.#submitEvent(context, { kind: 'revise-proposal', proposalId, declaration }, 'proposal-revised');
    }
    cancelProposal(context, proposalId, note) {
        return this.#submitEvent(context, { kind: 'cancel-proposal', proposalId, note }, 'proposal-cancelled');
    }
    recordTurn(context, decision, note, triage) {
        return this.#submitEvent(context, { kind: 'record-turn', decision, note, ...(triage === undefined ? {} : { triage }) }, 'turn-decided');
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
    async #submitEvent(context, body, expectedKind) {
        const entry = this.#recorded(context) ?? await this.#engine.submit({ ...context, body });
        if (entry.event.kind !== expectedKind)
            throw new Error('This ID belongs to another operation kind.');
        return structuredClone(entry.event);
    }
    describeInjury(context, input) {
        return this.#submitEvent(context, { kind: 'describe-injury', ...input }, 'injury-described');
    }
    applyHarm(context, input) {
        return this.#submitEvent(context, { kind: 'apply-harm', ...input }, 'harm-applied');
    }
    adjudicateStakes(context, input) {
        return this.#submitEvent(context, { kind: 'adjudicate-stakes', ...input }, 'stakes-adjudicated');
    }
    spendBankedTwist(context, input) {
        return this.#submitEvent(context, { kind: 'spend-banked-twist', ...input }, 'banked-twist-spent');
    }
    spendRescue(context, input) {
        return this.#submitEvent(context, { kind: 'spend-rescue', ...input }, 'rescue-spent');
    }
    witnessAndLearn(context, input) {
        return this.#submitEvent(context, { kind: 'witness-and-learn', ...input }, 'witness-and-learn-recorded');
    }
    arrangeCards(context, input) {
        return this.#submitEvent(context, { kind: 'arrange-cards', ...input }, 'cards-arranged');
    }
    recordExposure(context, input) {
        return this.#submitEvent(context, { kind: 'record-exposure', ...input }, 'exposure-recorded');
    }
    clearExposure(context, input) {
        return this.#submitEvent(context, { kind: 'clear-exposure', ...input }, 'exposure-cleared');
    }
    recallTheDraft(context, input) {
        return this.#submitEvent(context, { kind: 'recall-draft', ...input }, 'recall-draft-resolved');
    }
    confirmCanonBeat(context, input) {
        return this.#submitEvent(context, { kind: 'confirm-canon-beat', ...input }, 'canon-beat-confirmed');
    }
    markDivergence(context, input) {
        return this.#submitEvent(context, { kind: 'mark-divergence', ...input }, 'divergence-marked');
    }
    recordMysteryDiscovery(context, input) {
        return this.#submitEvent(context, { kind: 'record-mystery-discovery', ...input }, 'mystery-discovery-recorded');
    }
    acceptGrandDiscovery(context, input) {
        return this.#submitEvent(context, { kind: 'accept-grand-discovery', ...input }, 'grand-discovery-accepted');
    }
    recoverWithResource(context, input) {
        return this.#submitEvent(context, { kind: 'recover-with-resource', ...input }, 'resource-recovered');
    }
    createBenefit(context, input) {
        return this.#submitEvent(context, { kind: 'create-benefit', ...input }, 'benefit-created');
    }
    acquireOrTradeResource(context, input) {
        return this.#submitEvent(context, { kind: 'acquire-trade-resource', ...input }, 'resource-acquired-traded');
    }
    completeBurnRecovery(context, input) {
        return this.#submitEvent(context, { kind: 'complete-burn-recovery', ...input }, 'burn-recovered');
    }
    advanceDrive(context, input) {
        return this.#submitEvent(context, { kind: 'advance-drive', ...input }, 'drive-advanced');
    }
    milestoneBoundary(context, input) {
        return this.#submitEvent(context, { kind: 'milestone-boundary', ...input }, 'milestone-boundary-reset');
    }
    startProject(context, input) {
        return this.#submitEvent(context, { kind: 'start-project', ...input }, 'project-started');
    }
    spendMilestones(context, input) {
        return this.#submitEvent(context, { kind: 'spend-milestones', ...input }, 'milestones-spent');
    }
    completeProject(context, input) {
        return this.#submitEvent(context, { kind: 'complete-project', ...input }, 'project-completed');
    }
    activateAwakening(context) {
        return this.#submitEvent(context, { kind: 'activate-awakening' }, 'awakening-activated');
    }
    markBreakthrough(context, input) {
        return this.#submitEvent(context, { kind: 'mark-breakthrough', ...input }, 'breakthrough-marked');
    }
    resolveRankTrial(context, input) {
        return this.#submitEvent(context, { kind: 'resolve-rank-trial', ...input }, 'rank-trial-resolved');
    }
    updateDisplayedRank(context, input) {
        return this.#submitEvent(context, { kind: 'update-displayed-rank', ...input }, 'displayed-rank-updated');
    }
    addKeeperSecret(context, input) {
        return this.#submitEvent(context, { kind: 'add-keeper-secret', ...input }, 'keeper-secret-added');
    }
    revealKeeperSecret(context, input) {
        return this.#submitEvent(context, { kind: 'reveal-keeper-secret', ...input }, 'keeper-secret-revealed');
    }
    startHazard(context, input) {
        return this.#submitEvent(context, { kind: 'start-hazard', ...input }, 'hazard-started');
    }
    markHazard(context, input) {
        return this.#submitEvent(context, { kind: 'mark-hazard', ...input }, 'hazard-marked');
    }
    rollMayfly(context, input) {
        return this.#submitEvent(context, { kind: 'roll-mayfly', ...input }, 'mayfly-rolled');
    }
    startDungeonRun(context, input) {
        return this.#submitEvent(context, { kind: 'start-dungeon-run', ...input }, 'dungeon-run-started');
    }
    resolveDungeonLeg(context, input) {
        return this.#submitEvent(context, { kind: 'resolve-dungeon-leg', ...input }, 'dungeon-leg-resolved');
    }
    markRiftPressure(context, input) {
        return this.#submitEvent(context, { kind: 'mark-rift-pressure', ...input }, 'rift-pressure-marked');
    }
    startTournament(context, input) {
        return this.#submitEvent(context, { kind: 'start-tournament', ...input }, 'tournament-started');
    }
    resolveTournamentBout(context, input) {
        return this.#submitEvent(context, { kind: 'resolve-tournament-bout', ...input }, 'tournament-bout-resolved');
    }
    spendTournamentInterlude(context, input) {
        return this.#submitEvent(context, { kind: 'spend-tournament-interlude', ...input }, 'tournament-interlude-spent');
    }
}
