import { describeInjury } from "./injury-description.js";
import { memoryConflictReviewEvent, memoryOutcomeEvent, resolveMemoryDestinationEvent } from "./memory-publication.js";
import { bindMemoryEvent } from "./memory-bindings.js";
import { acceptSceneReviewEvent } from "./scene-acceptance.js";
import { saveSceneReviewEvent, reviseSceneReviewEvent, cancelSceneReviewEvent } from "./scene-review.js";
import { createInitialState } from "./seed.js";
import { applyMinorEvent, applyOwnedMinorEvent, sameValue } from "./events.js";
import { correctField } from "./editing.js";
import { correctFields } from "./batch-editing.js";
import { resolveMinorAction } from "./rules.js";
import { decideCancelProposal, decideRecordTurn, decideReviseProposal, decideSaveProposal, describeProposalEvent, } from "./proposals.js";
import { readMinorCampaign } from "./read.js";
import { manifestElement, switchClass } from "./play.js";
import { MINOR_RULES } from "./state.js";
import { sceneEventCorrectionEvent, profileEvent } from "./profiles.js";
import { emptySceneStartAnchor, validSceneStartAnchor } from "./scene-anchor.js";
import { decideHarm, decideSpendBankedTwist, decideStakesAdjudication, decideSystemRescue, } from "./stakes.js";
import { decideCardArrangement, decideConfirmCanonBeat, decideExposure, decideExposureCoverStory, decideGrandDiscovery, decideMarkDivergence, decideMysteryDiscovery, decideRecallTheDraft, decideWitnessAndLearn, } from "./origin-world.js";
import { decideAwakening, decideBreakthroughMark, decideBurnRecovery, decideCreateBenefit, decideDisplayedRank, decideDriveAdvance, decideMilestoneBoundary, decideMilestoneSpend, decideProjectCreation, decideProjectEffect, decideRankTrial, decideResourceAcquireTrade, decideResourceRecovery, } from "./downtime-advancement.js";
import { decideAddKeeperSecret, decideDungeonLeg, decideMarkHazard, decideMayflyRoll, decideRevealKeeperSecret, decideRiftPressure, decideStartDungeonRun, decideStartHazard, decideStartTournament, decideTournamentBout, decideTournamentInterlude, } from "./encounters-keeper.js";
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
        if (state.sceneReview && ['action', 'switch-class', 'reveal-keeper-secret'].includes(body.kind)) {
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
            if (state.proposal && body.proposalId === undefined)
                throw new Error('Accept or cancel the pending proposal first.');
            return resolveMinorAction(state, body, die);
        }
        if (body.kind === 'save-proposal')
            return decideSaveProposal(state, context, body);
        if (body.kind === 'revise-proposal')
            return decideReviseProposal(state, body);
        if (body.kind === 'cancel-proposal')
            return decideCancelProposal(state, context, body);
        if (body.kind === 'record-turn')
            return decideRecordTurn(state, context, body);
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
        if (body.kind === 'describe-injury')
            return describeInjury(state, body);
        if (body.kind === 'apply-harm')
            return decideHarm(state, body);
        if (body.kind === 'adjudicate-stakes')
            return decideStakesAdjudication(state, body);
        if (body.kind === 'spend-banked-twist')
            return decideSpendBankedTwist(state, body);
        if (body.kind === 'spend-rescue')
            return decideSystemRescue(state, body);
        if (body.kind === 'witness-and-learn')
            return decideWitnessAndLearn(state, body);
        if (body.kind === 'arrange-cards')
            return decideCardArrangement(state, body);
        if (body.kind === 'record-exposure')
            return decideExposure(state, body);
        if (body.kind === 'clear-exposure')
            return decideExposureCoverStory(state, body);
        if (body.kind === 'recall-draft')
            return decideRecallTheDraft(state, body, die);
        if (body.kind === 'confirm-canon-beat')
            return decideConfirmCanonBeat(state, body);
        if (body.kind === 'mark-divergence')
            return decideMarkDivergence(state, body);
        if (body.kind === 'record-mystery-discovery')
            return decideMysteryDiscovery(state, body);
        if (body.kind === 'accept-grand-discovery')
            return decideGrandDiscovery(state, body);
        if (body.kind === 'recover-with-resource')
            return decideResourceRecovery(state, body);
        if (body.kind === 'create-benefit')
            return decideCreateBenefit(state, body);
        if (body.kind === 'acquire-trade-resource')
            return decideResourceAcquireTrade(state, body);
        if (body.kind === 'complete-burn-recovery')
            return decideBurnRecovery(state, body);
        if (body.kind === 'advance-drive')
            return decideDriveAdvance(state, body);
        if (body.kind === 'milestone-boundary')
            return decideMilestoneBoundary(state, body);
        if (body.kind === 'start-project')
            return decideProjectCreation(state, body);
        if (body.kind === 'spend-milestones')
            return decideMilestoneSpend(state, body);
        if (body.kind === 'complete-project')
            return decideProjectEffect(state, body);
        if (body.kind === 'activate-awakening')
            return decideAwakening(state, body);
        if (body.kind === 'mark-breakthrough')
            return decideBreakthroughMark(state, body);
        if (body.kind === 'resolve-rank-trial')
            return decideRankTrial(state, body);
        if (body.kind === 'update-displayed-rank')
            return decideDisplayedRank(state, body);
        if (body.kind === 'add-keeper-secret')
            return decideAddKeeperSecret(state, body);
        if (body.kind === 'reveal-keeper-secret')
            return decideRevealKeeperSecret(state, body, context.operationId, context.expectedRevision + 1);
        if (body.kind === 'start-hazard')
            return decideStartHazard(state, body);
        if (body.kind === 'mark-hazard')
            return decideMarkHazard(state, body);
        if (body.kind === 'roll-mayfly')
            return decideMayflyRoll(state, body, die);
        if (body.kind === 'start-dungeon-run')
            return decideStartDungeonRun(state, body);
        if (body.kind === 'resolve-dungeon-leg')
            return decideDungeonLeg(state, body, die);
        if (body.kind === 'mark-rift-pressure')
            return decideRiftPressure(state, body);
        if (body.kind === 'start-tournament')
            return decideStartTournament(state, body);
        if (body.kind === 'resolve-tournament-bout')
            return decideTournamentBout(state, body, die);
        if (body.kind === 'spend-tournament-interlude')
            return decideTournamentInterlude(state, body);
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
        if (event.kind === 'field-corrected')
            return `Sheet correction: ${event.command.reason}`;
        if (event.kind === 'injury-described')
            return `Injury wording saved: ${event.command.name}`;
        if (event.kind === 'harm-applied')
            return `Harm applied: ${event.command.marks} mark(s).`;
        if (event.kind === 'stakes-adjudicated')
            return `Stakes adjudicated: ${event.command.note}`;
        if (event.kind === 'banked-twist-spent')
            return `Banked Twist spent: ${event.note}`;
        if (event.kind === 'rescue-spent')
            return `System Rescue spent: ${event.command.catastropheAverted}`;
        if (event.kind === 'witness-and-learn-recorded')
            return 'Witness & Learn recorded.';
        if (event.kind === 'cards-arranged')
            return 'Class Cards arranged.';
        if (event.kind === 'exposure-recorded')
            return `Exposure recorded: ${event.incident.description}`;
        if (event.kind === 'exposure-cleared')
            return `Exposure cleared via cover story: ${event.story}`;
        if (event.kind === 'recall-draft-resolved')
            return `Recall the Draft (${event.command.question}): ${event.roll.outcome}`;
        if (event.kind === 'canon-beat-confirmed')
            return `Canon beat ${event.knifeId} updated to ${event.afterStatus}.`;
        if (event.kind === 'divergence-marked')
            return `Divergence marked (${event.command.severity}): ${event.command.reason}`;
        if (event.kind === 'mystery-discovery-recorded')
            return `Mystery discovery recorded: ${event.discovery.name}`;
        if (event.kind === 'grand-discovery-accepted')
            return `Grand Discovery accepted for ${event.mysteryId}.`;
        if (event.kind === 'resource-recovered')
            return `Downtime recovery with resource ${event.command.resourceId}.`;
        if (event.kind === 'benefit-created')
            return `Created benefit: ${event.benefit.name}`;
        if (event.kind === 'resource-acquired-traded')
            return `Resource ${event.command.action} completed.`;
        if (event.kind === 'burn-recovered')
            return `Recovered burned boxes on ${event.command.aspectId}.`;
        if (event.kind === 'drive-advanced')
            return `Drive advanced: ${event.beforeDriveName}`;
        if (event.kind === 'milestone-boundary-reset')
            return `Milestone ${event.boundary} boundary reset.`;
        if (event.kind === 'project-started')
            return `Started project: ${event.project.name}`;
        if (event.kind === 'milestones-spent')
            return `Spent ${event.command.milestoneIds.length} milestone(s) on project ${event.command.projectId}.`;
        if (event.kind === 'project-completed')
            return `Completed project ${event.command.projectId}: ${event.command.effect.kind}.`;
        if (event.kind === 'awakening-activated')
            return 'Origin Core Awakening activated for the scene.';
        if (event.kind === 'breakthrough-marked')
            return `Breakthrough marked: ${event.reason}`;
        if (event.kind === 'rank-trial-resolved')
            return `Rank Trial ${event.command.passed ? 'passed' : 'failed'}: ${event.beforeRank} -> ${event.afterRank}.`;
        if (event.kind === 'displayed-rank-updated')
            return `Displayed rank updated: ${event.beforeRank} -> ${event.afterRank}.`;
        if (event.kind === 'keeper-secret-added')
            return 'Keeper preparation recorded.';
        if (event.kind === 'keeper-secret-revealed')
            return 'Keeper secret revealed.';
        if (event.kind === 'hazard-started')
            return `Hazard started: ${event.hazard.name}`;
        if (event.kind === 'hazard-marked')
            return `Hazard ${event.command.hazardId} marked (${event.marksBefore} -> ${event.marksAfter}).`;
        if (event.kind === 'mayfly-rolled')
            return `Mayfly roll for ${event.command.hazardId}: ${event.roll.tier} (${event.roll.highest}).`;
        if (event.kind === 'dungeon-run-started')
            return `Dungeon run started: ${event.run.name}`;
        if (event.kind === 'dungeon-leg-resolved')
            return `Dungeon leg ${event.leg.legNumber} resolved (${event.leg.pace}).`;
        if (event.kind === 'rift-pressure-marked')
            return `Rift pressure marked on ${event.runId}.`;
        if (event.kind === 'tournament-started')
            return `Tournament started: ${event.tournament.name}`;
        if (event.kind === 'tournament-bout-resolved')
            return `Tournament bout ${event.command.boutId} resolved: ${event.winner} wins.`;
        if (event.kind === 'tournament-interlude-spent')
            return `Tournament interlude task spent: ${event.note}`;
        if (event.kind === 'proposal-saved' || event.kind === 'proposal-revised' || event.kind === 'proposal-cancelled'
            || event.kind === 'turn-decided')
            return describeProposalEvent(event);
        throw new Error('Unsupported Minor Character event.');
    },
    hasPending: state => state.pending !== null || state.sceneReview !== null || !!state.proposal,
};
