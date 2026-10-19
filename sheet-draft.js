export function createDraft(view) {
    return { context: { ...view.context }, characterId: view.characterId, changes: [], reason: '' };
}
export function setDraftValue(draft, ref, value, original) {
    const index = draft.changes.findIndex(change => change.ref.owner === ref.owner
        && change.ref.entityId === ref.entityId && change.ref.field === ref.field && change.ref.box === ref.box);
    if (value === original) {
        if (index !== -1)
            draft.changes.splice(index, 1);
    }
    else if (index === -1) {
        draft.changes.push({ ref: { ...ref }, value });
    }
    else {
        draft.changes[index].value = value;
    }
}
export function draftMatches(draft, view) {
    return draft.characterId === view.characterId
        && draft.context.campaignId === view.context.campaignId
        && draft.context.branchId === view.context.branchId
        && draft.context.revision === view.context.revision;
}
