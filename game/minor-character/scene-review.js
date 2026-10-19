import { projectProfileFacts } from "./profile-views.js";
import { readSceneProposal } from "./scene-proposal.js";
import { validSceneStartAnchor } from "./scene-anchor.js";
const keys = (value, expected) => !!value && typeof value === 'object'
    && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const id = (value) => typeof value === 'string' && !!value.trim();
const fingerprint = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// Structural provenance admission is pure. Only the host can assert equality with the active transcript.
export function assertSceneSource(state, source) {
    const scene = state.world.scene, start = scene.startAnchor;
    if (!keys(source, ['id', 'sceneId', 'binding', 'fingerprint', 'startAnchor', 'endAnchor', 'messages'])
        || !id(source.id) || source.sceneId !== scene.id || source.binding !== start.binding || !fingerprint(source.fingerprint)
        || !validSceneStartAnchor(source.startAnchor) || !validSceneStartAnchor(source.endAnchor)
        || source.startAnchor.binding !== start.binding || source.startAnchor.nextMessageIndex !== start.nextMessageIndex
        || source.startAnchor.prefixFingerprint !== start.prefixFingerprint || source.endAnchor.binding !== start.binding
        || source.endAnchor.nextMessageIndex < start.nextMessageIndex
        || (source.endAnchor.nextMessageIndex === start.nextMessageIndex && source.endAnchor.prefixFingerprint !== start.prefixFingerprint)
        || !Array.isArray(source.messages) || !Array.from(source.messages).every((message, index) => keys(message, ['position', 'speaker', 'text', 'swipeId', 'revision'])
        && typeof message.speaker === 'string' && id(message.text) && fingerprint(message.revision)
        && (message.swipeId === null || (Number.isSafeInteger(message.swipeId) && message.swipeId >= 0))
        && Number.isSafeInteger(message.position) && message.position >= start.nextMessageIndex
        && message.position < source.endAnchor.nextMessageIndex
        && (index === 0 || message.position > source.messages[index - 1].position))) {
        throw new Error('Invalid scene source; capture it again.');
    }
}
export function assembleSceneReview(state, context, source, input) {
    assertSceneSource(state, source);
    if (!id(context.operationId) || context.source?.messageId !== source.id
        || context.source.messageRevision !== source.fingerprint)
        throw new Error('Scene operation provenance disagrees with its snapshot.');
    const profiles = state.profiles.map(profile => projectProfileFacts(state, profile.personId, 'player'));
    const proposal = readSceneProposal(input, source, profiles);
    const sources = (indices) => indices.map(messageIndex => ({ kind: 'scene', snapshotId: source.id, messageIndex }));
    const profileChanges = proposal.profileChanges.map((change, index) => {
        const profile = state.profiles.find(profile => profile.personId === change.personId);
        const entry = profile.entries.find(entry => entry.id === change.entryId);
        const entryId = change.entryId ?? JSON.stringify([context.operationId, 'profile-entry', index]);
        if (change.entryId === null && profile.entries.some(entry => entry.id === entryId)) {
            throw new Error('Scene proposal collides with an existing profile entry.');
        }
        if (change.replacement === null)
            return { personId: change.personId, entryId, replacement: null };
        const visibleLinks = profiles.find(profile => profile.personId === change.personId).entries
            .find(candidate => candidate.id === change.entryId)?.relatedPersonIds ?? [];
        const { section, text, status, relatedPersonIds, sourceIndices } = change.replacement;
        return { personId: change.personId, entryId, replacement: {
                ...entry, id: entryId, section, text, status, playerVisible: entry?.playerVisible ?? true,
                relatedPersonIds: [...new Set([...(entry?.relatedPersonIds.filter(id => !visibleLinks.includes(id)) ?? []), ...relatedPersonIds])],
                knownBy: [...new Set([...(entry?.knownBy ?? []), ...change.knownByAdditions])], sources: sources(sourceIndices),
            } };
    });
    return structuredClone({ id: JSON.stringify([context.operationId, 'scene-review']), sceneId: source.sceneId,
        source, proposal, revision: 0,
        profileBefore: proposal.profileChanges.map(change => {
            const entry = profiles.find(profile => profile.personId === change.personId).entries.find(entry => entry.id === change.entryId);
            return entry ? { section: entry.section, text: entry.text, status: entry.status, relatedPersonIds: entry.relatedPersonIds } : null;
        }),
        profileRevisions: [...new Set(proposal.profileChanges.map(change => change.personId))].map(personId => ({ personId, revision: state.profiles.find(profile => profile.personId === personId).revision })),
        draft: { summary: proposal.summary, participants: proposal.participants, profileChanges,
            events: proposal.events.map((event, index) => ({ id: JSON.stringify([context.operationId, 'scene-event', index]),
                text: event.text, personIds: event.personIds, sources: sources(event.sourceIndices),
                playerVisible: true, knownBy: event.knownByAdditions })),
        }, });
}
export function saveSceneReviewEvent(state, context, source, proposal) {
    if (state.pending)
        throw new Error('Finish the pending manual adjudication first.');
    if (state.sceneReview)
        throw new Error('Finish the pending scene review first.');
    return { kind: 'scene-review-saved', operationId: context.operationId,
        review: assembleSceneReview(state, context, source, proposal) };
}
export function reviseSceneReviewEvent(state, context, reviewId, reviewRevision, proposal) {
    const previous = state.sceneReview;
    if (!previous || previous.id !== reviewId || previous.revision !== reviewRevision) {
        throw new Error('Scene review changed; reopen its controls.');
    }
    if (previous.profileRevisions.some(pin => state.profiles.find(profile => profile.personId === pin.personId)?.revision !== pin.revision)) {
        throw new Error('Affected profiles changed; cancel the review and capture again.');
    }
    const review = assembleSceneReview(state, context, previous.source, proposal);
    review.id = previous.id;
    review.revision = previous.revision + 1;
    return { kind: 'scene-review-revised', operationId: context.operationId, reviewRevision, review };
}
export function cancelSceneReviewEvent(state, reviewId) {
    if (!state.sceneReview || state.sceneReview.id !== reviewId)
        throw new Error('Scene review changed; reopen its controls.');
    return { kind: 'scene-review-cancelled', reviewId, reviewRevision: state.sceneReview.revision };
}
// Current owners may have been edited since capture. Historical replay authenticates the full draft/proposal.
export function assertPendingSceneReview(state) {
    const review = state.sceneReview;
    if (review === null)
        return;
    if (!keys(review, ['id', 'sceneId', 'source', 'proposal', 'draft', 'revision', 'profileRevisions', 'profileBefore'])
        || !id(review.id) || review.sceneId !== state.world.scene.id || !Number.isSafeInteger(review.revision) || review.revision < 0
        || !keys(review.draft, ['summary', 'participants', 'events', 'profileChanges'])
        || !keys(review.proposal, ['summary', 'participants', 'events', 'profileChanges'])
        || !Array.isArray(review.profileBefore) || !Array.isArray(review.proposal.profileChanges)
        || review.profileBefore.length !== review.proposal.profileChanges.length
        || !Array.from(review.profileBefore).every(entry => entry === null ||
            (keys(entry, ['section', 'text', 'status', 'relatedPersonIds']) && typeof entry.section === 'string'
                && typeof entry.text === 'string' && ['established', 'recollection', 'unconfirmed'].includes(entry.status)
                && Array.isArray(entry.relatedPersonIds) && Array.from(entry.relatedPersonIds).every(id)))
        || !Array.isArray(review.profileRevisions) || !Array.from(review.profileRevisions).every(pin => keys(pin, ['personId', 'revision']) && Number.isSafeInteger(pin.revision) && pin.revision >= 0
        && state.profiles.some(profile => profile.personId === pin.personId && profile.revision >= pin.revision))
        || new Set(review.profileRevisions.map(pin => pin.personId)).size !== review.profileRevisions.length) {
        throw new Error('Invalid pending scene review.');
    }
    assertSceneSource(state, review.source);
}
