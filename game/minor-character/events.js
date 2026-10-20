import { memoryConflictReviewEvent, memoryOutcomeEvent, resolveMemoryDestinationEvent } from "./memory-publication.js";
import { bindMemoryEvent, applyMemoryBinding } from "./memory-bindings.js";
import { acceptSceneReviewEvent } from "./scene-acceptance.js";
import { saveSceneReviewEvent, reviseSceneReviewEvent, cancelSceneReviewEvent } from "./scene-review.js";
import { assertActionReferences, assertRecordedAction } from "./rules.js";
import { editableSlots } from "./editable-fields.js";
import { validateMinorState } from "./validate-state.js";
import { manifestElement, sceneBoundary, switchClass } from "./play.js";
import { sceneEventCorrectionEvent, applyProfileEvent, profileEvent } from "./profiles.js";
import { applyActionBattery, applyHarmEvent, applySpendBankedTwist, applyStakesAdjudication, applySystemRescue, } from "./stakes.js";
import { applyCardArrangement, applyConfirmCanonBeat, applyExposure, applyExposureCoverStory, applyGrandDiscovery, applyMarkDivergence, applyMysteryDiscovery, applyRecallTheDraft, applyWitnessAndLearn, } from "./origin-world.js";
import { applyAwakening, applyAwakeningSceneEnd, applyBreakthroughMark, applyBurnRecovery, applyCreateBenefit, applyDisplayedRank, applyDriveAdvance, applyMilestoneBoundary, applyMilestoneSpend, applyProjectCreation, applyProjectEffect, applyRankTrial, applyResourceAcquireTrade, applyResourceRecovery, } from "./downtime-advancement.js";
import { applyAddKeeperSecret, applyDungeonLeg, applyMarkHazard, applyMayflyRoll, applyRevealKeeperSecret, applyRiftPressure, applyStartDungeonRun, applyStartHazard, applyStartTournament, applyTournamentBout, applyTournamentInterlude, } from "./encounters-keeper.js";
// JSON object property order is not meaningful; array order and absent fields are.
export function sameValue(left, right) {
    if (left === right)
        return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
        return false;
    if (Array.isArray(left) !== Array.isArray(right))
        return false;
    if (Array.isArray(left) && left.length !== right.length)
        return false;
    const a = left;
    const b = right;
    return Object.keys(a).length === Object.keys(b).length
        && Object.keys(a).every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}
// Apply to a private working state; the caller validates final state invariants.
export function applyFieldCorrection(next, event) {
    const slot = editableSlots(next).find(slot => sameValue(slot.field.ref, event.command?.ref));
    if (!slot || typeof event.label !== 'string' || typeof event.command.reason !== 'string'
        || !event.command.reason.trim() || !sameValue(event.command.value, event.after)
        || event.before === event.after)
        throw new Error('Invalid recorded correction.');
    if (!sameValue(slot.field.value, event.before))
        throw new Error('Recorded before-values disagree with history.');
    const valid = slot.nullable ? event.after === null || typeof event.after === 'string'
        : typeof event.after === typeof slot.field.value;
    if (!valid || (typeof event.after === 'number' && !Number.isFinite(event.after))) {
        throw new Error('Invalid correction value.');
    }
    if (!!event.definition !== !!slot.definition || !!event.classBinding !== !!slot.classBinding) {
        throw new Error('Recorded correction is missing or adds an unrelated binding.');
    }
    if (slot.definition) {
        const recorded = event.definition;
        slot.write(event.after);
        const { instance, draft } = slot.definition;
        if (!sameValue(recorded.before, instance.definition)
            || !sameValue(recorded.after, { ...draft, revision: recorded.after.revision })
            || !Number.isSafeInteger(recorded.after.revision)
            || next.definitions.some(entry => entry.id === draft.id && entry.revision >= recorded.after.revision)) {
            throw new Error('Recorded definition correction disagrees with its pinned content.');
        }
        next.definitions.push(structuredClone(recorded.after));
        instance.definition = { id: recorded.after.id, revision: recorded.after.revision };
    }
    else if (slot.classBinding) {
        const recorded = event.classBinding;
        const name = recorded.after === null ? null : slot.classBinding.classes.find(entry => entry.id === recorded.after)?.name;
        if (recorded.before !== slot.classBinding.before || name !== event.after) {
            throw new Error('Recorded class binding disagrees with its correction.');
        }
        slot.classBinding.write(recorded.after);
    }
    else
        slot.write(event.after);
}
export function applyMinorEvent(state, event) {
    return applyOwnedMinorEvent(structuredClone(state), event);
}
// The native reader owns this private replay state. Keep the same event admission and validation,
// without copying all earlier records for every replay step.
export function applyOwnedMinorEvent(state, event, replay) {
    if (state.sceneReview && ['action-resolved', 'class-switched', 'scene-advanced', 'keeper-secret-revealed'].includes(event.kind)) {
        throw new Error('Finish the pending scene review first.');
    }
    const next = state;
    if (event.kind === 'scene-review-accepted') {
        const expected = acceptSceneReviewEvent(state, event.context, event.reviewId, event.reviewRevision, event.record.source.fingerprint);
        if (!sameValue(event, expected))
            throw new Error('Recorded scene acceptance disagrees with history.');
        next.sceneReview = null;
        next.sceneRecords.push(expected.record);
        next.memoryPublications.push(...expected.memoryPublications);
        for (const { after } of expected.profiles)
            next.profiles[next.profiles.findIndex(profile => profile.personId === after.personId)] = after;
        if (next.coreDevelopments?.awakeningActiveSceneId === event.boundary.before.id) {
            const ended = applyAwakeningSceneEnd(next, JSON.stringify([event.context.operationId, 'mana-strain']));
            next.characters = ended.characters;
            next.classState = ended.classState;
            next.coreDevelopments = ended.coreDevelopments;
            if (ended.exposureLog !== undefined)
                next.exposureLog = ended.exposureLog;
        }
        next.world.scene = expected.boundary.after;
        for (const entry of next.classState)
            entry.switchesThisScene = 0;
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'scene-review-saved') {
        const { source, proposal } = event.review;
        const expected = saveSceneReviewEvent(state, { operationId: event.operationId,
            source: { messageId: source.id, messageRevision: source.fingerprint } }, source, proposal);
        if (!sameValue(event, expected))
            throw new Error('Recorded scene review disagrees with history.');
        next.sceneReview = expected.review;
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'scene-review-revised') {
        const { source, proposal } = event.review;
        const expected = reviseSceneReviewEvent(state, { operationId: event.operationId,
            source: { messageId: source.id, messageRevision: source.fingerprint } }, event.review.id, event.reviewRevision, proposal);
        if (!sameValue(event, expected))
            throw new Error('Recorded scene revision disagrees with history.');
        next.sceneReview = expected.review;
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'scene-review-cancelled') {
        if (!sameValue(event, cancelSceneReviewEvent(state, event.reviewId)))
            throw new Error('Recorded scene cancellation disagrees with history.');
        next.sceneReview = null;
        return next;
    }
    if (event.kind === 'memory-conflict-reviewed') {
        if (!sameValue(event, memoryConflictReviewEvent(state, event.ref, event.destination, event.actual))) {
            throw new Error('Recorded memory conflict review disagrees with history.');
        }
        const index = next.memoryPublications.findIndex(job => job.document.key === event.ref.documentKey
            && job.document.acceptedOperationId === event.ref.acceptedOperationId);
        const job = { ...next.memoryPublications[index] };
        next.memoryPublications[index] = job;
        job.resolution = { actual: structuredClone(event.actual) };
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'memory-outcome-recorded') {
        const expected = memoryOutcomeEvent(state, event.ref, event.destination, event.outcome);
        if (!sameValue(event, expected))
            throw new Error('Recorded memory outcome disagrees with history.');
        const index = next.memoryPublications.findIndex(job => job.document.key === event.ref.documentKey
            && job.document.acceptedOperationId === event.ref.acceptedOperationId);
        const job = { ...next.memoryPublications[index] };
        next.memoryPublications[index] = job;
        if (event.outcome.kind === 'verified') {
            job.acknowledgement = structuredClone(event.outcome.document);
            job.failure = null;
            job.conflict = null;
            job.resolution = null;
            job.status = 'published';
        }
        else if (event.outcome.kind === 'conflict') {
            job.conflict = { actual: structuredClone(event.outcome.actual) };
            job.resolution = null;
            job.failure = null;
            job.status = 'conflict';
        }
        else {
            job.failure = event.outcome.reason;
            job.status = job.conflict ? 'conflict' : 'pending';
        }
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'memory-destination-resolved') {
        const expected = resolveMemoryDestinationEvent(state, event.documentKey);
        if (!sameValue(event, expected))
            throw new Error('Recorded memory resolution disagrees with history.');
        next.memoryPublications = next.memoryPublications.map(job => job.document.key === event.documentKey
            ? { ...job, destination: structuredClone(expected.destination) } : job);
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'memory-bound') {
        if (!sameValue(event, bindMemoryEvent(state, event.personId, event.after?.id))) {
            throw new Error('Recorded memory binding disagrees with history.');
        }
        applyMemoryBinding(next, event);
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'scene-event-corrected') {
        const c = event.correction;
        if (!sameValue(event, sceneEventCorrectionEvent(state, c.operationId, c.sceneRecordId, c.eventId, c.after, c.reason, event.revision))) {
            throw new Error('Recorded scene correction disagrees with history.');
        }
        next.sceneEventCorrections.push(structuredClone(c));
        next.memoryPublications.push(...structuredClone(event.memoryPublications));
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'profile-updated') {
        if (!sameValue(event, profileEvent(state, event.command, event.operationId, event.revision))) {
            throw new Error('Recorded profile edit disagrees with history.');
        }
        applyProfileEvent(next, event);
        next.memoryPublications.push(...structuredClone(event.memoryPublications));
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'created') {
        if (!sameValue(event, { kind: 'created' }) || next.pending !== null || next.sceneReview !== null)
            throw new Error('Invalid recorded creation.');
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'class-switched') {
        if (!sameValue(event, switchClass(state, event.afterClassId, event.strain?.after.id ?? ''))) {
            throw new Error('Recorded class switch disagrees with history.');
        }
        const play = next.classState.find(entry => entry.characterId === event.characterId);
        const character = next.characters.find(entry => entry.id === event.characterId);
        const core = character.aspects.find(entry => entry.id === 'core');
        play.activeClassId = event.afterClassId;
        play.switchesThisScene++;
        for (const box of event.paidBoxes)
            core.track.boxes[box] = 'marked';
        if (event.strain) {
            const after = structuredClone(event.strain.after);
            if (event.strain.before)
                character.conditions[character.conditions.findIndex(entry => entry.id === after.id)] = after;
            else
                character.conditions.push(after);
            play.manaStrainId = after.id;
        }
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'scene-advanced') {
        if (!sameValue(event, sceneBoundary(state, event.before.id, event.after.id, event.after.startAnchor))) {
            throw new Error('Recorded scene boundary disagrees with history.');
        }
        if (next.coreDevelopments?.awakeningActiveSceneId === event.before.id) {
            let opId = event.after.id;
            try {
                const parsed = JSON.parse(event.after.id);
                if (Array.isArray(parsed) && typeof parsed[0] === 'string')
                    opId = parsed[0];
            }
            catch { }
            const ended = applyAwakeningSceneEnd(next, JSON.stringify([opId, 'mana-strain']));
            next.characters = ended.characters;
            next.classState = ended.classState;
            next.coreDevelopments = ended.coreDevelopments;
            if (ended.exposureLog !== undefined)
                next.exposureLog = ended.exposureLog;
        }
        next.world.scene = structuredClone(event.after);
        for (const entry of next.classState)
            entry.switchesThisScene = 0;
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'element-manifested') {
        if (!sameValue(event, manifestElement(state, event.after))) {
            throw new Error('Recorded element character or before-value disagrees with history.');
        }
        next.classState.find(entry => entry.characterId === event.characterId).manifestedElement = event.after;
        return next;
    }
    if (event.kind === 'action-resolved') {
        assertActionReferences(state, event.command);
        assertRecordedAction(state, event);
        const expected = event.result.outcome !== 'Triumph' || event.result.twist
            ? { kind: 'manual-action', operationId: event.command.originalActionCommand.operationId } : null;
        if (!sameValue(event.pending, expected))
            throw new Error('Recorded pending outcome disagrees with the action.');
        if (state.pending)
            throw new Error('Finish the pending manual adjudication first.');
        if (event.command.originalActionCommand.action.battery !== undefined) {
            applyActionBattery(next, event, JSON.stringify([event.command.originalActionCommand.operationId, 'mana-strain']));
            validateMinorState(next, replay);
        }
        next.pending = structuredClone(event.pending);
        return next;
    }
    if (event.kind === 'manual-handled') {
        if (event.command.kind !== 'manual-handled' || !state.pending || event.command.target !== state.pending.operationId
            || typeof event.command.note !== 'string' || !event.command.note.trim() || event.pending !== null) {
            throw new Error('Manual acknowledgement must name the pending action and record how it was handled.');
        }
        next.pending = null;
        return next;
    }
    if (event.kind === 'fields-corrected') {
        if (typeof event.reason !== 'string' || !event.reason.trim()
            || !Array.isArray(event.changes) || !event.changes.length)
            throw new Error('Invalid recorded correction batch.');
        const refs = [];
        for (const change of event.changes) {
            if (change.kind !== 'field-corrected' || change.command?.reason !== event.reason) {
                throw new Error('Each correction must share the batch reason.');
            }
            if (refs.some(ref => sameValue(ref, change.command.ref)))
                throw new Error('Duplicate correction field.');
            applyFieldCorrection(next, change);
            refs.push(change.command.ref);
        }
        validateMinorState(next, replay);
        return next;
    }
    if (event.kind === 'field-corrected') {
        applyFieldCorrection(next, event);
        validateMinorState(next, replay);
        return next;
    }
    const finish = (updated) => {
        updated.sceneRecords = next.sceneRecords;
        updated.memoryPublications = next.memoryPublications;
        validateMinorState(updated, replay);
        return updated;
    };
    if (event.kind === 'harm-applied')
        return finish(applyHarmEvent(next, event));
    if (event.kind === 'stakes-adjudicated')
        return finish(applyStakesAdjudication(next, event));
    if (event.kind === 'banked-twist-spent')
        return finish(applySpendBankedTwist(next, event));
    if (event.kind === 'rescue-spent')
        return finish(applySystemRescue(next, event));
    if (event.kind === 'witness-and-learn-recorded')
        return finish(applyWitnessAndLearn(next, event));
    if (event.kind === 'cards-arranged')
        return finish(applyCardArrangement(next, event));
    if (event.kind === 'exposure-recorded')
        return finish(applyExposure(next, event));
    if (event.kind === 'exposure-cleared')
        return finish(applyExposureCoverStory(next, event));
    if (event.kind === 'recall-draft-resolved')
        return finish(applyRecallTheDraft(next, event));
    if (event.kind === 'canon-beat-confirmed')
        return finish(applyConfirmCanonBeat(next, event));
    if (event.kind === 'divergence-marked')
        return finish(applyMarkDivergence(next, event));
    if (event.kind === 'mystery-discovery-recorded')
        return finish(applyMysteryDiscovery(next, event));
    if (event.kind === 'grand-discovery-accepted')
        return finish(applyGrandDiscovery(next, event));
    if (event.kind === 'resource-recovered')
        return finish(applyResourceRecovery(next, event));
    if (event.kind === 'benefit-created')
        return finish(applyCreateBenefit(next, event));
    if (event.kind === 'resource-acquired-traded')
        return finish(applyResourceAcquireTrade(next, event));
    if (event.kind === 'burn-recovered')
        return finish(applyBurnRecovery(next, event));
    if (event.kind === 'drive-advanced')
        return finish(applyDriveAdvance(next, event));
    if (event.kind === 'milestone-boundary-reset')
        return finish(applyMilestoneBoundary(next, event));
    if (event.kind === 'project-started')
        return finish(applyProjectCreation(next, event));
    if (event.kind === 'milestones-spent')
        return finish(applyMilestoneSpend(next, event));
    if (event.kind === 'project-completed')
        return finish(applyProjectEffect(next, event));
    if (event.kind === 'awakening-activated')
        return finish(applyAwakening(next, event));
    if (event.kind === 'breakthrough-marked')
        return finish(applyBreakthroughMark(next, event));
    if (event.kind === 'rank-trial-resolved')
        return finish(applyRankTrial(next, event));
    if (event.kind === 'displayed-rank-updated')
        return finish(applyDisplayedRank(next, event));
    if (event.kind === 'keeper-secret-added')
        return finish(applyAddKeeperSecret(next, event));
    if (event.kind === 'keeper-secret-revealed')
        return finish(applyRevealKeeperSecret(next, event));
    if (event.kind === 'hazard-started')
        return finish(applyStartHazard(next, event));
    if (event.kind === 'hazard-marked')
        return finish(applyMarkHazard(next, event));
    if (event.kind === 'mayfly-rolled')
        return finish(applyMayflyRoll(next, event));
    if (event.kind === 'dungeon-run-started')
        return finish(applyStartDungeonRun(next, event));
    if (event.kind === 'dungeon-leg-resolved')
        return finish(applyDungeonLeg(next, event));
    if (event.kind === 'rift-pressure-marked')
        return finish(applyRiftPressure(next, event));
    if (event.kind === 'tournament-started')
        return finish(applyStartTournament(next, event));
    if (event.kind === 'tournament-bout-resolved')
        return finish(applyTournamentBout(next, event));
    if (event.kind === 'tournament-interlude-spent')
        return finish(applyTournamentInterlude(next, event));
    throw new Error('Unsupported recorded event.');
}
