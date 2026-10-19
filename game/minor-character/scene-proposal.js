function requireProposal(valid) {
    if (!valid)
        throw new Error('Invalid scene proposal; no changes accepted.');
}
function keys(value, expected) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
const text = (value) => typeof value === 'string' && !!value.trim();
const all = (values, check) => Array.isArray(values) && Array.from(values).every(check);
const unique = (values) => new Set(values).size === values.length;
// Shared model and game-command boundary. Contexts are admitted views, never raw campaign state.
export function readSceneProposal(value, source, profiles) {
    const proposal = value;
    const people = new Set(profiles.map(profile => profile.personId));
    const peopleList = (ids) => all(ids, id => people.has(id)) && unique(ids);
    const evidence = (indices) => all(indices, index => Number.isSafeInteger(index)
        && index >= 0 && index < source.messages.length) && indices.length > 0 && unique(indices);
    requireProposal(keys(proposal, ['summary', 'participants', 'events', 'profileChanges'])
        && typeof proposal.summary === 'string' && peopleList(proposal.participants)
        && Array.isArray(proposal.events) && Array.isArray(proposal.profileChanges));
    for (const event of proposal.events) {
        requireProposal(keys(event, ['text', 'personIds', 'sourceIndices', 'knownByAdditions'])
            && text(event.text) && peopleList(event.personIds) && evidence(event.sourceIndices)
            && peopleList(event.knownByAdditions));
    }
    const targets = new Set();
    for (const change of proposal.profileChanges) {
        requireProposal(keys(change, ['personId', 'entryId', 'replacement', 'knownByAdditions'])
            && peopleList(change.knownByAdditions));
        const profile = profiles.find(profile => profile.personId === change.personId);
        requireProposal(!!profile);
        if (change.entryId !== null) {
            const target = JSON.stringify([change.personId, change.entryId]);
            requireProposal(profile.entries.some(entry => entry.id === change.entryId) && !targets.has(target));
            targets.add(target);
        }
        if (change.replacement === null) {
            requireProposal(change.entryId !== null && change.knownByAdditions.length === 0);
            continue;
        }
        const entry = change.replacement;
        requireProposal(keys(entry, ['section', 'text', 'status', 'relatedPersonIds', 'sourceIndices'])
            && ['overview', 'personality', 'background', 'nathan-background', 'relationships', 'concerns'].includes(entry.section)
            && text(entry.text) && ['established', 'recollection', 'unconfirmed'].includes(entry.status)
            && peopleList(entry.relatedPersonIds) && evidence(entry.sourceIndices));
    }
    // Knowledge additions stay explicit suggestions. Canonical assembly preserves existing private metadata.
    return structuredClone(proposal);
}
