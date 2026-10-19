import { prepareMemoryPublications } from "./memory-publication.js";
import { sceneBoundary } from "./play.js";
import { assertSceneSource } from "./scene-review.js";
export function acceptSceneReviewEvent(state, context, reviewId, reviewRevision, fingerprint) {
    const review = state.sceneReview;
    if (!review || review.id !== reviewId || review.revision !== reviewRevision) {
        throw new Error('Scene review changed; reopen its controls.');
    }
    assertSceneSource(state, review.source);
    if (fingerprint !== review.source.fingerprint)
        throw new Error('Scene source changed; capture it again.');
    if (context.source.messageId !== review.source.id || context.source.messageRevision !== fingerprint) {
        throw new Error('Scene acceptance provenance disagrees with its snapshot.');
    }
    const profiles = review.profileRevisions.map(pin => {
        const before = state.profiles.find(profile => profile.personId === pin.personId);
        if (before.revision !== pin.revision)
            throw new Error('Affected profiles changed; cancel the review and capture again.');
        const after = structuredClone(before);
        for (const change of review.draft.profileChanges.filter(change => change.personId === pin.personId)) {
            const index = after.entries.findIndex(entry => entry.id === change.entryId);
            if (change.replacement === null)
                after.entries.splice(index, 1);
            else if (index < 0)
                after.entries.push(structuredClone(change.replacement));
            else
                after.entries[index] = structuredClone(change.replacement);
        }
        after.revision++;
        return { before: structuredClone(before), after };
    });
    const record = { id: JSON.stringify([context.operationId, 'scene-record']), sceneId: review.sceneId,
        sceneNumber: state.world.scene.number, source: structuredClone(review.source), draft: structuredClone(review.draft),
        operationId: context.operationId, revision: context.expectedRevision + 1, branchId: context.branchId };
    const accepted = { ...state, sceneRecords: [...state.sceneRecords, record],
        profiles: state.profiles.map(profile => profiles.find(change => change.after.personId === profile.personId)?.after ?? profile) };
    return { kind: 'scene-review-accepted', context: structuredClone(context), reviewId, reviewRevision, profiles, record,
        memoryPublications: prepareMemoryPublications(accepted, context, record),
        boundary: sceneBoundary(state, review.sceneId, JSON.stringify([context.operationId, 'scene']), review.source.endAnchor) };
}
