import { applyOwnedMinorEvent, sameValue } from "./events.js";
import { MINOR_RULES } from "./state.js";
import { validateMinorState } from "./validate-state.js";
import { proposalEventProvenance } from "./proposals.js";
const text = (value) => typeof value === 'string';
const id = (value) => text(value) && value.length > 0;
function requireHistory(valid) {
    if (!valid)
        throw new Error('Unsupported or contradictory saved history; original data retained.');
}
const VALID_EVENT_KINDS = new Set([
    'injury-described',
    'memory-conflict-reviewed',
    'scene-event-corrected',
    'memory-outcome-recorded',
    'created',
    'memory-bound',
    'memory-destination-resolved',
    'field-corrected',
    'scene-review-accepted',
    'scene-review-revised',
    'profile-updated',
    'scene-review-saved',
    'scene-review-cancelled',
    'class-switched',
    'scene-advanced',
    'scene-reanchored',
    'element-manifested',
    'fields-corrected',
    'action-resolved',
    'manual-handled',
    'harm-applied',
    'stakes-adjudicated',
    'banked-twist-spent',
    'rescue-spent',
    'witness-and-learn-recorded',
    'cards-arranged',
    'exposure-recorded',
    'exposure-cleared',
    'recall-draft-resolved',
    'canon-beat-confirmed',
    'divergence-marked',
    'mystery-discovery-recorded',
    'grand-discovery-accepted',
    'resource-recovered',
    'benefit-created',
    'resource-acquired-traded',
    'burn-recovered',
    'drive-advanced',
    'milestone-boundary-reset',
    'project-started',
    'milestones-spent',
    'project-completed',
    'awakening-activated',
    'breakthrough-marked',
    'rank-trial-resolved',
    'displayed-rank-updated',
    'keeper-secret-added',
    'keeper-secret-revealed',
    'hazard-started',
    'hazard-marked',
    'mayfly-rolled',
    'dungeon-run-started',
    'dungeon-leg-resolved',
    'rift-pressure-marked',
    'tournament-started',
    'tournament-bout-resolved',
    'tournament-interlude-spent',
    'proposal-saved',
    'proposal-revised',
    'proposal-cancelled',
    'turn-decided',
]);
export function readMinorCampaign(value, binding) {
    const c = structuredClone(value);
    requireHistory(!!c && c.schemaVersion === 2 && c.binding === binding && sameValue(c.rules, MINOR_RULES)
        && id(c.id) && id(c.branchId) && Number.isSafeInteger(c.revision) && c.revision >= 0
        && !!c.snapshot && c.snapshot.revision === c.revision && Array.isArray(c.journal)
        && c.journal.length === c.revision + 1 && Array.from(c.journal).every(entry => !!entry
        && VALID_EVENT_KINDS.has(entry.event?.kind)));
    validateMinorState(c.initialState);
    validateMinorState(c.snapshot.state);
    requireHistory(c.initialState.pending === null && c.initialState.sceneReview === null && c.initialState.sceneRecords.length === 0 && c.initialState.sceneEventCorrections.length === 0
        && c.initialState.memoryPublications.length === 0
        && sameValue(c.initialState.memoryBindings, { canonical: null, people: [] }));
    requireHistory(new Set(c.journal.map(entry => entry.operationId)).size === c.journal.length);
    for (const state of [c.initialState, c.snapshot.state]) {
        requireHistory(state.world.scene.startAnchor.binding === binding);
        for (const profile of state.profiles)
            for (const entry of profile.entries)
                for (const source of entry.sources) {
                    requireHistory(source.kind !== 'operation' || c.journal.some(record => record.operationId === source.operationId));
                }
    }
    let state = structuredClone(c.initialState);
    const replay = { sceneRecords: new WeakSet(), publications: new WeakSet() };
    for (const [index, entry] of c.journal.entries()) {
        requireHistory(entry.revision === index && entry.branchId === c.branchId
            && id(entry.operationId) && text(entry.at) && text(entry.summary));
        if (entry.event.kind === 'created') {
            requireHistory(index === 0 && entry.context === null && entry.rulesRevision === c.rules.revision);
            state = applyOwnedMinorEvent(state, entry.event, replay);
            continue;
        }
        const context = entry.context;
        requireHistory(index > 0 && entry.rulesRevision === c.rules.revision && !!context
            && context.operationId === entry.operationId && context.campaignId === c.id
            && context.branchId === c.branchId && context.expectedRevision === index - 1
            && id(context.source?.messageId) && id(context.source?.messageRevision));
        if (entry.event.kind === 'class-switched' && entry.event.strain?.before === null) {
            requireHistory(entry.event.strain.after?.id === JSON.stringify([context.operationId, 'mana-strain']));
        }
        if (entry.event.kind === 'scene-advanced') {
            requireHistory(entry.event.after?.id === JSON.stringify([context.operationId, 'scene']));
        }
        if (entry.event.kind === 'scene-review-saved' || entry.event.kind === 'scene-review-revised') {
            requireHistory(entry.event.operationId === context.operationId
                && context.source.messageId === entry.event.review?.source?.id
                && context.source.messageRevision === entry.event.review?.source?.fingerprint);
        }
        if (entry.event.kind === 'memory-outcome-recorded' || entry.event.kind === 'memory-conflict-reviewed')
            requireHistory(context.source.messageId === entry.event.ref?.documentKey
                && context.source.messageRevision === entry.event.ref?.acceptedOperationId);
        if (entry.event.kind === 'scene-review-accepted')
            requireHistory(sameValue(context, entry.event.context));
        if (entry.event.kind === 'scene-event-corrected')
            requireHistory(entry.event.correction?.operationId === context.operationId
                && entry.event.revision === entry.revision);
        if (entry.event.kind === 'profile-updated')
            requireHistory(entry.event.operationId === context.operationId
                && entry.event.revision === entry.revision);
        if (entry.event.kind === 'keeper-secret-revealed')
            requireHistory(entry.event.operationId === context.operationId
                && entry.event.revision === entry.revision);
        if (entry.event.kind === 'action-resolved') {
            const { action, ...originalContext } = entry.event.command.originalActionCommand;
            requireHistory(sameValue(context, originalContext));
        }
        // A cancellation names the proposal's message, not the later message it was cancelled from.
        if (entry.event.kind === 'proposal-saved' || entry.event.kind === 'proposal-cancelled' || entry.event.kind === 'turn-decided') {
            const provenance = proposalEventProvenance(entry.event);
            requireHistory(provenance.operationId === context.operationId
                && (entry.event.kind === 'proposal-cancelled' || sameValue(provenance.source, context.source)));
        }
        state = applyOwnedMinorEvent(state, entry.event, replay);
    }
    requireHistory(sameValue(state, c.snapshot.state));
    return c;
}
