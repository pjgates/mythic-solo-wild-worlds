import { admitMemoryDocument } from "./game/minor-character/memory-publication.js";
export class MemoryConflict extends Error {
    actual;
    constructor(actual) {
        super('Memory changed at the recorded destination');
        this.name = 'MemoryConflict';
        this.actual = structuredClone(actual);
    }
}
function fields(value, names) {
    const keys = names.split(' ');
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
const id = (value) => typeof value === 'string' && value.length > 0;
function admitEnvelope(value, destination, key) {
    const invalid = () => new Error('Invalid memory envelope at the recorded destination');
    if (!fields(value, 'destination document') || !fields(value.destination, 'backend id')
        || value.destination.backend !== destination.backend || value.destination.id !== destination.id)
        throw invalid();
    admitMemoryDocument(value.document, key);
    return value;
}
function sameDocument(a, b) {
    return a.key === b.key && a.campaignId === b.campaignId && a.branchId === b.branchId
        && a.acceptedOperationId === b.acceptedOperationId && a.acceptedRevision === b.acceptedRevision
        && a.sceneRecordId === b.sceneRecordId && a.targetPersonId === b.targetPersonId
        && a.audience.characterId === b.audience.characterId && a.content === b.content
        && a.source.snapshotId === b.source.snapshotId && a.source.fingerprint === b.source.fingerprint
        && a.profileRevisions.length === b.profileRevisions.length
        && a.profileRevisions.every((pin, index) => pin.personId === b.profileRevisions[index].personId
            && pin.revision === b.profileRevisions[index].revision);
}
// The caller supplies the job's recorded destination, never today's person mapping.
export function journalMemoryAdapter(store, recordedDestination) {
    if (recordedDestination.backend !== 'journal')
        throw new Error('Unsupported memory backend');
    if (!id(recordedDestination.id))
        throw new Error('Memory destination is required');
    const destination = structuredClone(recordedDestination);
    async function entry(key) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([destination.backend, destination.id, key])));
        return { namespace: 'minor-character-memory', key: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') };
    }
    async function readEnvelope(key) {
        if (typeof store?.tryGetJson !== 'function')
            throw new Error('Memory storage read capability unavailable');
        const result = await store.tryGetJson(await entry(key));
        if (!result.found)
            return null;
        return admitEnvelope(result.value, destination, key);
    }
    return {
        async read(key) {
            const envelope = await readEnvelope(key);
            return envelope === null ? null : structuredClone(envelope.document);
        },
        async write(document, expected) {
            const hasConditional = typeof store?.setJsonIf === 'function';
            const hasUnconditional = typeof store?.setJson === 'function';
            if (!hasConditional && !hasUnconditional)
                throw new Error('Memory storage write capability unavailable');
            const desired = structuredClone(document), expectation = structuredClone(expected);
            const previous = await readEnvelope(desired.key);
            if (previous && sameDocument(previous.document, desired))
                return structuredClone(previous.document);
            // Only the recorded prior acknowledgement authorizes replacing an external document.
            const matches = expectation.kind === 'absent' ? previous === null
                : previous !== null && sameDocument(previous.document, expectation.document);
            if (!matches)
                throw new MemoryConflict(previous?.document ?? null);
            const target = await entry(desired.key), value = { destination, document: desired };
            try {
                if (hasConditional) {
                    await store.setJsonIf({ ...target, value,
                        expected: previous === null ? { kind: 'absent' } : { kind: 'value', value: previous } });
                }
                else {
                    await store.setJson({ ...target, value });
                }
            }
            catch (error) {
                if (error instanceof Error && typeof error.cause === 'object' && error.cause !== null
                    && 'Conflict' in error.cause) {
                    throw new MemoryConflict((await readEnvelope(desired.key))?.document ?? null);
                }
                throw error;
            }
            const verified = await readEnvelope(desired.key);
            if (!verified || !sameDocument(verified.document, desired))
                throw new MemoryConflict(verified?.document ?? null);
            return structuredClone(verified.document);
        },
    };
}
