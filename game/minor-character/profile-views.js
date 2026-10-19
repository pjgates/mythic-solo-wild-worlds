import { createSeedContent } from "../../seed.js";
import { correctedSceneEventText, createInitialProfiles, personName } from "./profiles.js";
// Citation identity comes from the original publication, never the mutable current cast.
const curatedSources = createInitialProfiles('source-player', createSeedContent().sheet.characters
    .map((name, index) => ({ id: `source-person-${index}`, name })))
    .flatMap(profile => profile.entries.flatMap(entry => entry.sources))
    .filter(source => source.kind === 'content');
function permitted(claim, audience) {
    return audience === 'player' ? claim.playerVisible : claim.knownBy.includes(audience.characterId);
}
function sceneText(state, source, capture) {
    if (!Number.isSafeInteger(source.messageIndex) || source.messageIndex < 0)
        return undefined;
    const selected = capture?.id === source.snapshotId ? capture
        : state.sceneRecords.find(record => record.source.id === source.snapshotId)?.source;
    return selected?.messages[source.messageIndex]?.text;
}
function projectSources(state, sources, text, capture) {
    return sources.flatMap((source) => {
        // The native reader checks operation references against the journal. Do not resolve its payload.
        if (source.kind === 'operation')
            return [{ kind: 'operation', operationId: source.operationId }];
        if (source.kind === 'scene')
            return sceneText(state, source, capture) === undefined ? []
                : [{ kind: 'scene', snapshotId: source.snapshotId, messageIndex: source.messageIndex }];
        if (source.kind !== 'content' || !curatedSources.some(allowed => allowed.documentId === source.documentId && allowed.revision === source.revision
            && allowed.section === source.section) || !text.includes(source.excerpt))
            return [];
        return [{ kind: 'content', documentId: source.documentId, revision: source.revision,
                section: source.section, excerpt: source.excerpt }];
    });
}
export function projectSceneEvents(state, record, audience) {
    return record.draft.events.filter(event => permitted(event, audience)).map(event => {
        const text = correctedSceneEventText(state, record.id, event.id, event.text);
        const corrections = audience === 'player' ? state.sceneEventCorrections
            .filter(correction => correction.sceneRecordId === record.id && correction.eventId === event.id)
            .map(({ operationId, before, after, reason }) => ({ operationId, before, after, reason })) : [];
        return { id: event.id, text, sources: projectSources(state, event.sources, text, record.source),
            ...(corrections.length ? { corrections } : {}) };
    });
}
// Input is admitted game state. View objects select fields and never retain authoritative references.
export function projectProfileFacts(state, personId, audience) {
    const profile = state.profiles.find(profile => profile.personId === personId);
    const allowedPeople = new Set(state.profiles.filter(candidate => candidate.entries.some(entry => permitted(entry, audience)))
        .map(candidate => candidate.personId));
    for (const record of state.sceneRecords)
        for (const event of record.draft.events) {
            if (permitted(event, audience))
                for (const id of event.personIds)
                    allowedPeople.add(id);
        }
    allowedPeople.add(personId);
    if (audience !== 'player')
        allowedPeople.add(audience.characterId);
    return {
        personId, name: personName(state, personId),
        // Directory details are player-only; learned aliases belong in reviewed profile entries.
        aliases: audience === 'player' ? [...profile.aliases] : [],
        portrait: audience === 'player' ? profile.portrait : null,
        retired: state.retiredPersonIds.includes(personId),
        entries: profile.entries.filter(entry => permitted(entry, audience)).map(entry => ({
            id: entry.id, section: entry.section, text: entry.text, status: entry.status,
            relatedPersonIds: entry.relatedPersonIds.filter(id => allowedPeople.has(id)),
            sources: projectSources(state, entry.sources, entry.text),
        })),
    };
}
export function projectProfile(state, personId, audience) {
    return {
        ...projectProfileFacts(state, personId, audience),
        timeline: state.sceneRecords.flatMap(record => {
            const associated = new Set(record.draft.events.filter(event => event.personIds.includes(personId)).map(event => event.id));
            if (!associated.size)
                return [];
            const events = projectSceneEvents(state, record, audience).filter(event => associated.has(event.id));
            return events.length ? [{ sceneRecordId: record.id, sceneNumber: record.sceneNumber, events }] : [];
        }),
    };
}
// A citation is not permission to read its transcript or journal. Unavailable excerpts stay unavailable.
export function resolveProfileSource(state, personId, audience, source) {
    const claims = [...projectProfileFacts(state, personId, audience).entries];
    for (const record of state.sceneRecords) {
        if (source.kind === 'scene' && record.source.id !== source.snapshotId)
            continue;
        const associated = new Set(record.draft.events.filter(event => event.personIds.includes(personId)).map(event => event.id));
        if (associated.size)
            claims.push(...projectSceneEvents(state, record, audience).filter(event => associated.has(event.id)));
    }
    for (const claim of claims)
        for (const allowed of claim.sources) {
            if (source.kind === 'content' && allowed.kind === 'content'
                && source.documentId === allowed.documentId && source.revision === allowed.revision
                && source.section === allowed.section && source.excerpt === allowed.excerpt)
                return allowed.excerpt;
            if (source.kind === 'scene' && allowed.kind === 'scene'
                && source.snapshotId === allowed.snapshotId && source.messageIndex === allowed.messageIndex) {
                const text = sceneText(state, allowed);
                if (claim.text.includes(text))
                    return text;
            }
        }
    return null;
}
