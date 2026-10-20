import { sameValue } from "./events.js";
import { memoryDestination } from "./memory-bindings.js";
import { projectProfileFacts, projectSceneEvents } from "./profile-views.js";
// The basis is private correction provenance, not an external document or narrator projection.
export function memoryContent(basis) {
    const lines = basis.profiles.flatMap(profile => [profile.name, ...profile.entries.map(entry => `[${entry.status}] ${entry.section}: ${entry.text}\nSources: ${JSON.stringify(entry.sources)}`)]);
    lines.push(...basis.events.map(event => `[established] ${event.text}\nSources: ${JSON.stringify(event.sources)}`));
    return lines.join('\n\n');
}
// Called only while preparing acceptance, against its private post-edit profiles and recorded scene.
export function prepareMemoryPublications(state, context, record) {
    const people = [...new Set([...record.draft.profileChanges.map(change => change.personId),
            ...record.draft.events.flatMap(event => event.personIds)])];
    const learnedBy = [...record.draft.profileChanges.flatMap(change => change.replacement?.playerVisible ? change.replacement.knownBy : []),
        ...record.draft.events.flatMap(event => event.playerVisible ? event.knownBy : [])];
    // Canonical already serves Sera; retain her person copy only for explicit ownership/association.
    const recipients = [...new Set([...people, ...learnedBy.filter(personId => personId !== state.playerCharacterId)])];
    const visibleEvents = new Set(projectSceneEvents(state, record, 'player').map(event => event.id));
    return [null, ...recipients].map(targetPersonId => {
        const audience = { characterId: targetPersonId ?? state.playerCharacterId };
        const subjects = [...new Set([...people, audience.characterId])];
        const views = subjects.map(personId => {
            const view = projectProfileFacts(state, personId, audience);
            const visible = new Set(projectProfileFacts(state, personId, 'player').entries.map(entry => entry.id));
            return { ...view, entries: view.entries.filter(entry => visible.has(entry.id)) };
        });
        const profiles = views.filter(view => view.entries.length > 0);
        // Learning an event grants memory, not a separately authored entry in an uninvolved person's timeline.
        const events = projectSceneEvents(state, record, audience).filter(event => visibleEvents.has(event.id));
        const basis = {
            profiles: profiles.map(view => ({ personId: view.personId, name: view.name,
                entries: view.entries.map(({ id, section, text, status, sources }) => ({ id, section, text, status,
                    sources: structuredClone(sources) })) })),
            events: events.map(({ id, text, sources }) => ({ id, text, sources: structuredClone(sources) })),
        };
        return {
            document: {
                key: JSON.stringify(['memory', context.campaignId, context.branchId, context.operationId,
                    targetPersonId === null ? 'canonical' : 'person', targetPersonId]),
                campaignId: context.campaignId, branchId: context.branchId, acceptedOperationId: context.operationId,
                acceptedRevision: record.revision, sceneRecordId: record.id, targetPersonId, audience,
                profileRevisions: views.filter(view => view.entries.length > 0 || view.personId === targetPersonId)
                    .map(view => ({ personId: view.personId,
                    revision: state.profiles.find(profile => profile.personId === view.personId).revision })),
                source: { snapshotId: record.source.id, fingerprint: record.source.fingerprint }, content: memoryContent(basis),
            },
            basis, predecessor: null, destination: structuredClone(memoryDestination(state, targetPersonId)), status: 'pending',
            acknowledgement: null, conflict: null, resolution: null, failure: null,
        };
    });
}
// Retrying publication reads accepted bytes; later renames, edits and retirement cannot regenerate them.
export function projectMemoryDocuments(state, acceptedOperationId) {
    return state.memoryPublications.filter(job => job.document.acceptedOperationId === acceptedOperationId)
        .map(job => structuredClone(job.document));
}
// First resolution runs against historical bindings; it never regenerates accepted content.
export function resolveMemoryDestinationEvent(state, documentKey) {
    const job = state.memoryPublications.find(job => job.document.key === documentKey);
    if (!job)
        throw new Error('Unknown memory publication.');
    if (job.destination !== null)
        throw new Error('Memory destination already resolved.');
    const destination = memoryDestination(state, job.document.targetPersonId);
    if (!destination)
        throw new Error('Memory destination missing. Configure this destination before retrying.');
    return { kind: 'memory-destination-resolved', documentKey, destination: structuredClone(destination) };
}
export function memoryOutcomeEvent(state, ref, destination, outcome) {
    const job = state.memoryPublications.find(job => job.document.key === ref.documentKey
        && job.document.acceptedOperationId === ref.acceptedOperationId);
    if (!job || !job.destination || !sameValue(destination, job.destination)
        || !sameValue(ref, { documentKey: job.document.key, acceptedOperationId: job.document.acceptedOperationId })) {
        throw new Error('Memory outcome does not identify a recorded destination and publication.');
    }
    if (outcome.kind === 'verified' && job.predecessor && !state.memoryPublications.some(previous => previous.document.key === job.predecessor.documentKey && previous.document.acceptedOperationId === job.predecessor.acceptedOperationId
        && previous.acknowledgement !== null))
        throw new Error('Memory predecessor must be acknowledged first.');
    const conflict = outcome.kind === 'conflict'
        && sameValue(outcome, { kind: 'conflict', actual: outcome.actual });
    if (conflict && outcome.actual !== null)
        admitMemoryDocument(outcome.actual, job.document.key);
    if (!conflict && !sameValue(outcome, { kind: 'verified', document: job.document })
        && !sameValue(outcome, { kind: 'failed', reason: 'Delivery could not be verified.' })) {
        throw new Error('Memory acknowledgement must match the complete accepted document.');
    }
    return structuredClone({ kind: 'memory-outcome-recorded', ref, destination, outcome });
}
// Shared admission for actual external reads and saved observations; no unknown fields escape.
export function admitMemoryDocument(doc, key) {
    function fields(value, names) {
        const keys = names.split(' ');
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
    }
    const id = (value) => typeof value === 'string' && value.length > 0;
    const revision = (value) => Number.isSafeInteger(value) && value >= 0;
    const invalid = () => new Error('Invalid memory envelope at the recorded destination');
    if (!fields(doc, 'key campaignId branchId acceptedOperationId acceptedRevision sceneRecordId targetPersonId audience profileRevisions source content')
        || doc.key !== key || !id(doc.campaignId) || !id(doc.branchId) || !id(doc.acceptedOperationId)
        || !revision(doc.acceptedRevision) || !id(doc.sceneRecordId)
        || !(doc.targetPersonId === null || id(doc.targetPersonId))
        || !fields(doc.audience, 'characterId') || !id(doc.audience.characterId)
        || (doc.targetPersonId !== null && doc.audience.characterId !== doc.targetPersonId)
        || !fields(doc.source, 'snapshotId fingerprint') || !id(doc.source.snapshotId) || !id(doc.source.fingerprint)
        || typeof doc.content !== 'string' || !Array.isArray(doc.profileRevisions)
        || !doc.profileRevisions.every(pin => fields(pin, 'personId revision') && id(pin.personId) && revision(pin.revision))
        || new Set(doc.profileRevisions.map(pin => pin.personId)).size !== doc.profileRevisions.length)
        throw invalid();
    let root;
    try {
        root = JSON.parse(key);
    }
    catch {
        throw invalid();
    }
    // A correction retains its original root key; its own acceptance operation may differ.
    if (!Array.isArray(root) || root.length !== 6 || root[0] !== 'memory' || root[1] !== doc.campaignId
        || root[2] !== doc.branchId || !id(root[3]) || root[4] !== (doc.targetPersonId === null ? 'canonical' : 'person')
        || root[5] !== doc.targetPersonId)
        throw invalid();
    return doc;
}
export function currentMemoryPublications(state) {
    const replaced = new Set(state.memoryPublications.flatMap(job => job.predecessor
        ? [JSON.stringify([job.predecessor.documentKey, job.predecessor.acceptedOperationId])] : []));
    return state.memoryPublications.filter(job => !replaced.has(JSON.stringify([job.document.key, job.document.acceptedOperationId])));
}
function memorySuccessor(job, basis, operationId, revision) {
    return { document: { ...structuredClone(job.document), acceptedOperationId: operationId, acceptedRevision: revision,
            content: memoryContent(basis) }, basis,
        predecessor: { documentKey: job.document.key, acceptedOperationId: job.document.acceptedOperationId },
        destination: structuredClone(job.destination), status: 'pending', acknowledgement: null, conflict: null, resolution: null, failure: null };
}
export function correctEventMemory(state, correction, revision) {
    return currentMemoryPublications(state).filter(job => job.document.sceneRecordId === correction.sceneRecordId
        && job.basis.events.some(event => event.id === correction.eventId)).map(job => {
        const basis = structuredClone(job.basis);
        basis.events.find(event => event.id === correction.eventId).text = correction.after;
        return memorySuccessor(job, basis, correction.operationId, revision);
    });
}
export function correctProfileMemory(state, commandOrPersonId, operationId, revision) {
    if (typeof commandOrPersonId === 'string') {
        const personId = commandOrPersonId;
        const nextProfile = state.profiles.find(profile => profile.personId === personId);
        if (!nextProfile)
            return [];
        return currentMemoryPublications(state)
            .filter(job => job.basis.profiles.some(profile => profile.personId === personId) ||
            job.document.profileRevisions.some(pin => pin.personId === personId))
            .flatMap(job => {
            const view = projectProfileFacts(state, personId, job.document.audience);
            const visible = new Set(projectProfileFacts(state, personId, 'player').entries.map(entry => entry.id));
            const nextEntries = view.entries
                .filter(entry => visible.has(entry.id))
                .map(({ id, section, text, status, sources }) => ({
                id,
                section,
                text,
                status,
                sources: structuredClone(sources),
            }));
            const existingProfile = job.basis.profiles.find(profile => profile.personId === personId);
            const existingEntries = existingProfile?.entries ?? [];
            if (sameValue(existingEntries, nextEntries))
                return [];
            const basis = structuredClone(job.basis);
            const targetProfile = basis.profiles.find(profile => profile.personId === personId);
            if (nextEntries.length === 0) {
                basis.profiles = basis.profiles.filter(profile => profile.personId !== personId);
            }
            else if (targetProfile) {
                targetProfile.entries = nextEntries;
            }
            else {
                basis.profiles.push({ personId: view.personId, name: view.name, entries: nextEntries });
            }
            const successor = memorySuccessor(job, basis, operationId, revision);
            const pin = successor.document.profileRevisions.find(entry => entry.personId === personId);
            if (pin) {
                pin.revision = nextProfile.revision;
            }
            else {
                successor.document.profileRevisions.push({ personId, revision: nextProfile.revision });
            }
            return [successor];
        });
    }
    const command = commandOrPersonId;
    const changes = new Map(command.changes.map(change => [change.entryId, change]));
    return currentMemoryPublications(state).filter(job => job.basis.profiles.some(profile => profile.personId === command.personId
        && profile.entries.some(entry => changes.has(entry.id)))).map(job => {
        const basis = structuredClone(job.basis), profile = basis.profiles.find(profile => profile.personId === command.personId);
        profile.entries = profile.entries.flatMap(entry => {
            const change = changes.get(entry.id);
            if (!change)
                return [entry];
            return change.replacement === null ? [] : [{ ...entry, ...change.replacement,
                    sources: [{ kind: 'operation', operationId }] }];
        });
        basis.profiles = basis.profiles.filter(profile => profile.entries.length > 0);
        const successor = memorySuccessor(job, basis, operationId, revision);
        successor.document.profileRevisions.find(pin => pin.personId === command.personId).revision
            = state.profiles.find(profile => profile.personId === command.personId).revision + 1;
        return successor;
    });
}
export function memoryConflictReviewEvent(state, ref, destination, actual) {
    memoryOutcomeEvent(state, ref, destination, { kind: 'conflict', actual });
    const job = state.memoryPublications.find(job => job.document.key === ref.documentKey
        && job.document.acceptedOperationId === ref.acceptedOperationId);
    if (state.memoryPublications.some(later => later.document.key === ref.documentKey
        && later.document.acceptedRevision > job.document.acceptedRevision && later.acknowledgement !== null)) {
        throw new Error('This memory version is superseded by an acknowledged successor.');
    }
    if (!job.conflict || !sameValue(actual, job.conflict.actual))
        throw new Error('Review the exact recorded external version first.');
    return structuredClone({ kind: 'memory-conflict-reviewed', ref, destination, actual });
}
