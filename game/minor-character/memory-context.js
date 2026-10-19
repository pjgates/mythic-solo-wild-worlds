import { sameValue } from "./events.js";
import { currentMemoryPublications, memoryContent } from "./memory-publication.js";
import { projectProfileFacts, projectSceneEvents } from "./profile-views.js";
// Trusted game projection: every selected recipient AND the player must be permitted the exact current claim.
export function planMemoryContext(state, input, scope) {
    const recipientIds = [...new Set(input)];
    if (!recipientIds.length || recipientIds.some(id => !state.profiles.some(profile => profile.personId === id))) {
        return { kind: 'held', reason: 'Select known narration recipients.' };
    }
    const soleSera = recipientIds.length === 1 && recipientIds[0] === state.playerCharacterId;
    const jobs = currentMemoryPublications(state).filter(job => job.document.targetPersonId === null
        ? soleSera : recipientIds.includes(job.document.targetPersonId));
    const views = new Map();
    const events = new Map();
    const selected = new Map();
    for (const job of jobs) {
        const owner = job.document.targetPersonId ?? state.playerCharacterId;
        for (const profile of job.basis.profiles) {
            let permitted = views.get(profile.personId);
            if (!permitted) {
                permitted = [projectProfileFacts(state, profile.personId, 'player'),
                    ...recipientIds.map(characterId => projectProfileFacts(state, profile.personId, { characterId }))];
                views.set(profile.personId, permitted);
            }
            for (const entry of profile.entries) {
                if (!permitted.every(view => view.entries.some(current => sameValue(entry, {
                    id: current.id, section: current.section, text: current.text, status: current.status, sources: current.sources,
                }))))
                    continue;
                const identity = JSON.stringify(['profile', profile.personId, entry.id]), key = JSON.stringify([owner, identity]);
                const prior = selected.get(key);
                if (!prior || prior.job.document.acceptedRevision < job.document.acceptedRevision) {
                    selected.set(key, { identity, job, personId: profile.personId, name: profile.name, entry });
                }
            }
        }
        let permitted = events.get(job.document.sceneRecordId);
        if (!permitted) {
            const record = state.sceneRecords.find(record => record.id === job.document.sceneRecordId);
            permitted = [projectSceneEvents(state, record, 'player'),
                ...recipientIds.map(characterId => projectSceneEvents(state, record, { characterId }))];
            events.set(record.id, permitted);
        }
        for (const event of job.basis.events) {
            if (!permitted.every(view => view.some(current => sameValue(event, { id: current.id, text: current.text, sources: current.sources }))))
                continue;
            const identity = JSON.stringify(['event', job.document.sceneRecordId, event.id]), key = JSON.stringify([owner, identity]);
            const prior = selected.get(key);
            if (!prior || prior.job.document.acceptedRevision < job.document.acceptedRevision)
                selected.set(key, { identity, job, event });
        }
    }
    const candidates = [...new Set([...selected.values()].map(fragment => fragment.job))];
    if (candidates.some(job => !job.destination || job.status !== 'published' || !sameValue(job.acknowledgement, job.document))) {
        return { kind: 'held', reason: 'Required memory is pending or conflicted. Publish or repair it before narration.' };
    }
    const basis = { profiles: [], events: [] }, included = new Set();
    for (const fragment of selected.values()) {
        if (included.has(fragment.identity))
            continue;
        included.add(fragment.identity);
        if (fragment.entry) {
            let profile = basis.profiles.find(profile => profile.personId === fragment.personId);
            if (!profile) {
                profile = { personId: fragment.personId, name: fragment.name, entries: [] };
                basis.profiles.push(profile);
            }
            profile.entries.push(fragment.entry);
        }
        else
            basis.events.push(fragment.event);
    }
    return structuredClone({ kind: 'ready', scope, recipientIds, content: memoryContent(basis), candidates });
}
