import { memoryConflictReviewEvent, memoryOutcomeEvent, resolveMemoryDestinationEvent } from "./memory-publication.js";
import { bindMemoryEvent } from "./memory-bindings.js";
import { acceptSceneReviewEvent } from "./scene-acceptance.js";
import { saveSceneReviewEvent, reviseSceneReviewEvent, cancelSceneReviewEvent } from "./scene-review.js";
import { createInitialState } from "./seed.js";
import { applyMinorEvent, applyOwnedMinorEvent, sameValue } from "./events.js";
import { correctField } from "./editing.js";
import { correctFields } from "./batch-editing.js";
import { resolveMinorAction } from "./rules.js";
import { readMinorCampaign } from "./read.js";
import { manifestElement, switchClass } from "./play.js";
import { MINOR_RULES } from "./state.js";
import { sceneEventCorrectionEvent, profileEvent } from "./profiles.js";
import { emptySceneStartAnchor, validSceneStartAnchor } from "./scene-anchor.js";
export function createMinorCampaign(binding, startAnchor = emptySceneStartAnchor(binding)) {
    if (!validSceneStartAnchor(startAnchor) || startAnchor.binding !== binding)
        throw new Error('Invalid scene start anchor.');
    const id = crypto.randomUUID();
    const branchId = 'main';
    const initialState = createInitialState(id, startAnchor);
    const event = { kind: 'created' };
    return {
        schemaVersion: 2, id, binding, branchId, revision: 0,
        rules: { ...MINOR_RULES }, initialState,
        snapshot: { revision: 0, state: applyMinorEvent(initialState, event) },
        journal: [{ operationId: crypto.randomUUID(), revision: 0, branchId,
                at: new Date().toISOString(), context: null, rulesRevision: MINOR_RULES.revision,
                summary: minorCharacterGame.describe(event), event }],
    };
}
export const minorCharacterGame = {
    id: MINOR_RULES.gameId,
    rulesRevision: MINOR_RULES.revision,
    create: createMinorCampaign,
    read: readMinorCampaign,
    transition(state, command, die) {
        // Versioned history is immutable; publication updates replace their job objects.
        // Only the mutable current state needs a deep private copy before decide/apply.
        const { definitions, sceneRecords, sceneEventCorrections, memoryPublications, ...current } = state;
        const working = { ...structuredClone(current), definitions: [...definitions], sceneRecords: [...sceneRecords],
            sceneEventCorrections: [...sceneEventCorrections], memoryPublications: [...memoryPublications] };
        const event = this.decide(working, command, die);
        return { event, state: applyOwnedMinorEvent(working, event, {
                sceneRecords: new WeakSet(sceneRecords), publications: new WeakSet(memoryPublications),
            }) };
    },
    decide(state, command, die) {
        const { body, ...context } = command;
        if (state.sceneReview && ['action', 'switch-class'].includes(body.kind)) {
            throw new Error('Finish the pending scene review first.');
        }
        if (body.kind === 'correct-scene-event')
            return sceneEventCorrectionEvent(state, context.operationId, body.sceneRecordId, body.eventId, body.text, body.reason, context.expectedRevision + 1);
        if (body.kind === 'record-memory-outcome' || body.kind === 'review-memory-conflict') {
            if (context.source.messageId !== body.ref.documentKey || context.source.messageRevision !== body.ref.acceptedOperationId) {
                throw new Error('Memory outcome source must identify its accepted publication.');
            }
            return body.kind === 'record-memory-outcome' ? memoryOutcomeEvent(state, body.ref, body.destination, body.outcome)
                : memoryConflictReviewEvent(state, body.ref, body.destination, body.actual);
        }
        if (body.kind === 'resolve-memory-destination')
            return resolveMemoryDestinationEvent(state, body.documentKey);
        if (body.kind === 'bind-memory')
            return bindMemoryEvent(state, body.personId, body.bookId);
        if (body.kind === 'accept-scene-review')
            return acceptSceneReviewEvent(state, context, body.reviewId, body.reviewRevision, body.fingerprint);
        if (body.kind === 'save-scene-review')
            return saveSceneReviewEvent(state, context, body.source, body.proposal);
        if (body.kind === 'revise-scene-review')
            return reviseSceneReviewEvent(state, context, body.reviewId, body.reviewRevision, body.proposal);
        if (body.kind === 'cancel-scene-review')
            return cancelSceneReviewEvent(state, body.reviewId);
        if (body.kind === 'add-person' || body.kind === 'rename-person' || body.kind === 'retire-person'
            || body.kind === 'save-profile-details' || body.kind === 'save-profile')
            return profileEvent(state, body, context.operationId, context.expectedRevision + 1);
        if (body.kind === 'action') {
            const { action, ...originalContext } = body.originalActionCommand;
            if (!sameValue(context, originalContext))
                throw new Error('Action provenance disagrees with its captured command.');
            return resolveMinorAction(state, body, die);
        }
        if (body.kind === 'manual-handled') {
            const event = { kind: 'manual-handled', command: structuredClone(body), pending: null };
            applyMinorEvent(state, event);
            return event;
        }
        if (body.kind === 'switch-class')
            return switchClass(state, body.classId, JSON.stringify([context.operationId, 'mana-strain']));
        if (body.kind === 'manifest-element')
            return manifestElement(state, body.element);
        if (body.kind === 'correction')
            return correctField(state, body.ref, body.value, body.reason);
        if (body.kind === 'corrections')
            return correctFields(state, body.changes, body.reason);
        throw new Error('Unsupported Minor Character command.');
    },
    apply: applyMinorEvent,
    describe(event) {
        if (event.kind === 'scene-review-accepted')
            return `Scene ${event.record.sceneNumber} accepted; scene ${event.boundary.after.number} begins.`;
        if (event.kind === 'scene-review-saved')
            return 'Scene proposal saved for review.';
        if (event.kind === 'scene-review-revised')
            return 'Scene review revised.';
        if (event.kind === 'scene-review-cancelled')
            return 'Scene review cancelled; scene remains open.';
        if (event.kind === 'scene-event-corrected')
            return 'Narrative scene event corrected.';
        if (event.kind === 'memory-conflict-reviewed')
            return 'Exact external memory replacement approved.';
        if (event.kind === 'memory-outcome-recorded')
            return 'Memory publication result recorded.';
        if (event.kind === 'memory-destination-resolved')
            return 'Pending memory destination recorded.';
        if (event.kind === 'memory-bound')
            return 'Memory destination saved; existing publications keep their recorded destinations.';
        if (event.kind === 'created')
            return 'Campaign begins after the established Thornhall opening.';
        if (event.kind === 'profile-updated') {
            const command = event.command;
            if (command.kind === 'add-person')
                return `Added person: ${command.name}`;
            if (command.kind === 'rename-person')
                return `Renamed person: ${command.name}`;
            if (command.kind === 'retire-person')
                return command.retired ? 'Retired person.' : 'Restored person.';
            if (command.kind === 'save-profile')
                return `Edited ${command.changes.length} profile entries.`;
            return 'Updated profile aliases and portrait.';
        }
        if (event.kind === 'action-resolved') {
            return `${event.command.originalActionCommand.action.description}: ${event.result.outcome}${event.result.twist ? ' + Twist' : ''}`;
        }
        if (event.kind === 'class-switched')
            return `Class switched; paid ${event.paidBoxes.length} Core Fatigue${event.strain ? '; Mana Strain reopened' : ''}.`;
        if (event.kind === 'scene-advanced')
            return `Scene ${event.before.number} ended; scene ${event.after.number} begins.`;
        if (event.kind === 'element-manifested')
            return `Manifested element: ${event.after}`;
        if (event.kind === 'manual-handled')
            return `Handled manually: ${event.command.note}`;
        if (event.kind === 'fields-corrected')
            return `Sheet correction: ${event.reason}`;
        return `Sheet correction: ${event.command.reason}`;
    },
    hasPending: state => state.pending !== null || state.sceneReview !== null,
};
