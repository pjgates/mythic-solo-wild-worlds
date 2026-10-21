import { prepareAction, validActionStakes } from "../../action.js";
import { TRIAGE_THRESHOLDS } from "../../turn-triage.js";
import { sameValue } from "./events.js";
import { projectSheet } from "./sheet.js";
import { manaStrainCut } from "./strain.js";
const text = (value) => typeof value === 'string' && !!value.trim();
const TURN_KINDS = ['narrative', 'question', 'rules', 'unclear'];
const TRIAGE_KINDS = [...TURN_KINDS, 'action'];
const isUnit = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export function proposalId(operationId) {
    return JSON.stringify([operationId, 'proposal']);
}
const validProbabilities = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === TRIAGE_KINDS.length && TRIAGE_KINDS.every(kind => isUnit(value[kind]));
const validTriage = (value) => {
    if (!value || typeof value !== 'object')
        return false;
    const { model, kind, confidence, probabilities, ...rest } = value;
    return Object.keys(rest).length === 0 && text(model) && TRIAGE_KINDS.includes(kind) && isUnit(confidence)
        && (probabilities === undefined ? !Object.hasOwn(value, 'probabilities') : validProbabilities(probabilities));
};
/** A triage record as the journal keeps it; absent fields stay absent so older saves replay byte for byte. */
export function projectTriage(triage) {
    if (triage === undefined)
        return {};
    const { probabilities } = triage;
    return { triage: { model: triage.model, kind: triage.kind, confidence: triage.confidence,
            ...(probabilities === undefined ? {} : { probabilities: Object.fromEntries(TRIAGE_KINDS.map(kind => [kind, probabilities[kind]])) }) } };
}
function readTriageRecord(value) {
    if (value === undefined)
        return {};
    if (!validTriage(value))
        throw new Error('Invalid triage reading.');
    return projectTriage(value);
}
function assertSettled(state) {
    if (state.pending)
        throw new Error('Finish the pending manual adjudication first.');
    if (state.sceneReview)
        throw new Error('Finish the pending scene review first.');
}
// A proposal and any revision to it must be a legal declaration for the current sheet.
function assertDeclaration(state, declaration) {
    if (!declaration || typeof declaration !== 'object')
        throw new Error('Invalid proposed declaration.');
    if (declaration.stakes !== undefined && !validActionStakes(declaration.stakes))
        throw new Error('Invalid proposed stakes.');
    prepareAction(projectSheet(state), declaration, manaStrainCut(state, declaration.skill));
}
function messageHandled(state, source) {
    return (state.turnDecisions ?? []).some(record => record.messageId === source.messageId && record.messageRevision === source.messageRevision)
        || state.proposal?.source.messageId === source.messageId && state.proposal.source.messageRevision === source.messageRevision;
}
export function decideSaveProposal(state, context, command) {
    assertSettled(state);
    if (state.proposal)
        throw new Error('Accept or cancel the pending proposal first.');
    const input = command.proposal;
    if (!input || typeof input !== 'object' || typeof input.playerText !== 'string' || typeof input.reading !== 'string'
        || !Array.isArray(input.reasons) || !input.reasons.every(text))
        throw new Error('Invalid proposal.');
    const triage = readTriageRecord(input.triage);
    if (messageHandled(state, context.source))
        throw new Error('This message already has a recorded decision.');
    assertDeclaration(state, input.declaration);
    return { kind: 'proposal-saved', proposal: {
            id: proposalId(context.operationId), operationId: context.operationId, sceneId: state.world.scene.id,
            source: { messageId: context.source.messageId, messageRevision: context.source.messageRevision },
            playerText: input.playerText, reading: input.reading, reasons: [...input.reasons],
            declaration: structuredClone(input.declaration), status: 'pending', ...triage,
        } };
}
export function decideReviseProposal(state, command) {
    const proposal = state.proposal;
    if (!proposal || !text(command.proposalId) || proposal.id !== command.proposalId)
        throw new Error('No such pending proposal.');
    assertDeclaration(state, command.declaration);
    if (sameValue(proposal.declaration, command.declaration))
        throw new Error('The revision changes nothing.');
    return { kind: 'proposal-revised', proposalId: proposal.id, before: structuredClone(proposal.declaration),
        after: structuredClone(command.declaration) };
}
export function decideCancelProposal(state, context, command) {
    const proposal = state.proposal;
    if (!proposal || !text(command.proposalId) || proposal.id !== command.proposalId)
        throw new Error('No such pending proposal.');
    if (typeof command.note !== 'string')
        throw new Error('Invalid cancellation note.');
    return { kind: 'proposal-cancelled', proposalId: proposal.id, source: structuredClone(proposal.source),
        operationId: context.operationId, note: command.note };
}
export function decideRecordTurn(state, context, command) {
    if (!TURN_KINDS.includes(command.decision) || typeof command.note !== 'string')
        throw new Error('Invalid turn decision.');
    const triage = readTriageRecord(command.triage);
    if (state.proposal)
        throw new Error('Accept or cancel the pending proposal first.');
    if (messageHandled(state, context.source))
        throw new Error('This message already has a recorded decision.');
    return { kind: 'turn-decided', record: { messageId: context.source.messageId, messageRevision: context.source.messageRevision,
            kind: command.decision, operationId: context.operationId, note: command.note, ...triage } };
}
/** The operation identity a proposal event carries, so replay needs no journal context. */
export function proposalEventProvenance(event) {
    switch (event.kind) {
        case 'proposal-saved': return { operationId: event.proposal.operationId, source: event.proposal.source };
        case 'proposal-revised': return null;
        case 'proposal-cancelled': return { operationId: event.operationId, source: event.source };
        case 'turn-decided': return { operationId: event.record.operationId,
            source: { messageId: event.record.messageId, messageRevision: event.record.messageRevision } };
        default: {
            const exhaustive = event;
            throw new Error(`Unsupported proposal event: ${String(exhaustive)}`);
        }
    }
}
export function applyProposalEvent(state, event) {
    const provenance = proposalEventProvenance(event);
    const context = provenance ?? { operationId: '', source: { messageId: '', messageRevision: '' } };
    if (event.kind === 'proposal-saved') {
        const expected = decideSaveProposal(state, context, { kind: 'save-proposal', proposal: event.proposal });
        if (!sameValue(event, expected))
            throw new Error('Recorded proposal disagrees with history.');
        state.proposal = structuredClone(event.proposal);
        return state;
    }
    if (event.kind === 'proposal-revised') {
        const expected = decideReviseProposal(state, { kind: 'revise-proposal', proposalId: event.proposalId, declaration: event.after });
        if (!sameValue(event, expected))
            throw new Error('Recorded proposal revision disagrees with history.');
        state.proposal.declaration = structuredClone(event.after);
        return state;
    }
    if (event.kind === 'proposal-cancelled') {
        const expected = decideCancelProposal(state, context, { kind: 'cancel-proposal', proposalId: event.proposalId, note: event.note });
        if (!sameValue(event, expected))
            throw new Error('Recorded proposal cancellation disagrees with history.');
        state.turnDecisions = [...(state.turnDecisions ?? []), { ...event.source, kind: 'cancelled', operationId: event.operationId, note: event.note }];
        state.proposal = null;
        return state;
    }
    if (event.kind === 'turn-decided') {
        const expected = decideRecordTurn(state, context, { kind: 'record-turn', decision: event.record.kind, note: event.record.note,
            ...(event.record.triage === undefined ? {} : { triage: event.record.triage }) });
        if (!sameValue(event, expected))
            throw new Error('Recorded turn decision disagrees with history.');
        state.turnDecisions = [...(state.turnDecisions ?? []), structuredClone(event.record)];
        return state;
    }
    const exhaustive = event;
    throw new Error(`Unsupported proposal event: ${String(exhaustive)}`);
}
/** Acceptance is an `action-resolved` event naming the proposal; it clears the proposal and records the message as handled. */
export function applyProposalAcceptance(state, proposalId, operationId) {
    const proposal = state.proposal;
    if (!proposal || proposal.id !== proposalId)
        throw new Error('This action resolves a proposal that is no longer pending.');
    state.turnDecisions = [...(state.turnDecisions ?? []), { ...proposal.source, kind: 'proposed', operationId, note: proposal.reading }];
    state.proposal = null;
}
/** `an action`, `a rules question`, `narrative`: a kind as it reads inside a sentence. */
export function describeKind(kind) {
    switch (kind) {
        case 'narrative': return 'narrative';
        case 'action': return 'an action';
        case 'question': return 'a question';
        case 'rules': return 'a rules question';
        case 'unclear': return 'unclear';
        default: {
            const exhaustive = kind;
            throw new Error(`Unknown kind ${String(exhaustive)}`);
        }
    }
}
/**
 * `Jev 1.14 read this as an action (0.99)`, or `Jev 1.14 was unsure: narrative 0.68, action 0.32` when the spread is
 * kept and Jev chose `unclear` or no kind reached the threshold triage routes on by itself: the reader behind a
 * decision, for the card's expanded details and the history alike (spec §6). The narrator projection never carries it.
 */
export function describeTriage(triage) {
    const version = /jev-(\d+\.\d+)/i.exec(triage.model);
    const reader = version ? `Jev ${version[1]}` : triage.model;
    const { probabilities } = triage;
    if (probabilities && (triage.kind === 'unclear' || Math.max(...TRIAGE_KINDS.map(kind => probabilities[kind])) < TRIAGE_THRESHOLDS.act)) {
        const spread = TRIAGE_KINDS.map(kind => [kind, probabilities[kind]]).sort((a, b) => b[1] - a[1]).slice(0, 2);
        return `${reader} was unsure: ${spread.map(([kind, p]) => `${kind} ${p.toFixed(2)}`).join(', ')}`;
    }
    return `${reader} read this as ${describeKind(triage.kind)} (${triage.confidence.toFixed(2)})`;
}
const readBy = (triage) => triage ? ` — ${describeTriage(triage)}` : '';
export function describeProposalEvent(event) {
    switch (event.kind) {
        case 'proposal-saved': return `Proposed: ${event.proposal.declaration.description}${readBy(event.proposal.triage)}`;
        case 'proposal-revised': return 'Proposal stakes changed.';
        case 'proposal-cancelled': return event.note.trim() ? `Proposal cancelled: ${event.note}` : 'Proposal cancelled.';
        case 'turn-decided': {
            const { record } = event;
            // An unclear record's note says what the player did instead (narrated, or declared by hand) when there is one.
            const unclear = record.note.trim() ? `Intent unclear: ${record.note.trim()}` : 'Intent unclear; narrated without mechanics.';
            const label = { narrative: 'Narrated without mechanics.', question: 'Asked the oracle.',
                rules: 'Answered from the sheet.', unclear, proposed: 'Proposal accepted.', cancelled: 'Proposal cancelled.' };
            return `${label[record.kind]}${readBy(record.triage)}`;
        }
        default: {
            const exhaustive = event;
            throw new Error(`Unsupported proposal event: ${String(exhaustive)}`);
        }
    }
}
export function validProposalState(state) {
    const source = (value) => !!value && typeof value === 'object'
        && text(value.messageId) && text(value.messageRevision);
    const proposal = state.proposal;
    const validProposal = proposal === undefined || proposal === null || (!!proposal && typeof proposal === 'object'
        && text(proposal.id) && text(proposal.operationId) && proposal.id === proposalId(proposal.operationId)
        && text(proposal.sceneId) && source(proposal.source) && typeof proposal.playerText === 'string'
        && typeof proposal.reading === 'string' && Array.isArray(proposal.reasons) && proposal.reasons.every(text)
        && !!proposal.declaration && typeof proposal.declaration === 'object' && proposal.status === 'pending'
        && (proposal.triage === undefined || validTriage(proposal.triage)));
    const kinds = [...TURN_KINDS, 'proposed', 'cancelled'];
    const decisions = state.turnDecisions;
    const validDecisions = decisions === undefined || (Array.isArray(decisions) && decisions.every(record => source(record)
        && kinds.includes(record.kind) && text(record.operationId) && typeof record.note === 'string'
        && (record.triage === undefined || validTriage(record.triage))));
    return validProposal && validDecisions;
}
export function projectProposal(proposal) {
    const declaration = proposal.declaration;
    return {
        id: proposal.id, operationId: proposal.operationId, sceneId: proposal.sceneId,
        source: { messageId: proposal.source.messageId, messageRevision: proposal.source.messageRevision },
        playerText: proposal.playerText, reading: proposal.reading, reasons: [...proposal.reasons], status: 'pending',
        declaration: projectDeclaration(declaration), ...projectTriage(proposal.triage),
    };
}
export function projectDeclaration(a) {
    return {
        description: a.description, edge: a.edge,
        skill: a.skill === null ? null : { kind: a.skill.kind, name: a.skill.name },
        advantageSources: [...a.advantageSources],
        ...(a.permission === undefined ? {} : { permission: a.permission }),
        ...(a.baseImpact === undefined ? {} : { baseImpact: a.baseImpact }),
        ...(a.battery === undefined ? {} : { battery: a.battery }),
        ...(a.cuts === undefined ? {} : { cuts: {
                ...(a.cuts.difficulty === undefined ? {} : { difficulty: a.cuts.difficulty }),
                ...(a.cuts.rankGap === undefined ? {} : { rankGap: a.cuts.rankGap }),
                ...(a.cuts.mires === undefined ? {} : { mires: [...a.cuts.mires] }),
                ...(a.cuts.precision === undefined ? {} : { precision: a.cuts.precision }),
                ...(a.cuts.impact === undefined ? {} : { impact: a.cuts.impact }),
            } }),
        ...(a.stakes === undefined ? {} : { stakes: { narrative: a.stakes.narrative, harm: a.stakes.harm === null ? null : {
                    onConflict: a.stakes.harm.onConflict, onDisaster: a.stakes.harm.onDisaster,
                    targetAspectId: a.stakes.harm.targetAspectId, overflowChoice: a.stakes.harm.overflowChoice
                } } }),
    };
}
