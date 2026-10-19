import { correctProfileMemory, correctEventMemory } from "./memory-publication.js";
export function correctedSceneEventText(state, sceneRecordId, eventId, original) {
    return state.sceneEventCorrections.filter(correction => correction.sceneRecordId === sceneRecordId && correction.eventId === eventId)
        .at(-1)?.after ?? original;
}
export function sceneEventCorrectionEvent(state, operationId, sceneRecordId, eventId, text, reason, revision) {
    const event = state.sceneRecords.find(record => record.id === sceneRecordId)?.draft.events.find(event => event.id === eventId);
    if (!event?.playerVisible || typeof text !== 'string' || !text.trim() || typeof reason !== 'string' || !reason.trim()) {
        throw new Error('A visible scene event, corrected text and reason are required.');
    }
    const before = correctedSceneEventText(state, sceneRecordId, eventId, event.text);
    if (before === text)
        throw new Error('The scene event is unchanged.');
    const correction = { operationId, sceneRecordId, eventId, before, after: text, reason };
    return { kind: 'scene-event-corrected', correction, revision, memoryPublications: correctEventMemory(state, correction, revision) };
}
function targetPerson(command, operationId) {
    return command.kind === 'add-person' ? JSON.stringify([operationId, 'person']) : command.personId;
}
export function profileEvent(state, command, operationId, revision) {
    const profile = state.profiles.find(profile => profile.personId === targetPerson(command, operationId));
    return { kind: 'profile-updated', operationId, command: structuredClone(command), beforeRevision: profile?.revision ?? null, revision,
        memoryPublications: command.kind === 'save-profile' ? correctProfileMemory(state, command, operationId, revision) : [] };
}
function requireProfile(valid) {
    if (!valid)
        throw new Error('Invalid narrative profile edit.');
}
function keys(value, expected) {
    return !!value && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
// Public commands and persisted events share one narrow mutation boundary.
export function applyProfileEvent(state, event) {
    const command = event.command;
    const personId = targetPerson(command, event.operationId);
    if (command.kind === 'add-person') {
        requireProfile(keys(command, ['kind', 'name']) && typeof command.name === 'string' && !!command.name.trim()
            && ![...state.characters, ...state.world.characters].some(person => person.id === personId));
        state.world.characters.push({ id: personId, name: command.name });
        state.profiles.push({ personId, aliases: [], portrait: null, entries: [], revision: 1 });
        return;
    }
    const profile = state.profiles.find(profile => profile.personId === personId);
    requireProfile(!!profile);
    if (command.kind === 'rename-person') {
        requireProfile(keys(command, ['kind', 'personId', 'name']) && typeof command.name === 'string' && !!command.name.trim());
        const person = [...state.characters, ...state.world.characters].find(person => person.id === personId);
        person.name = command.name;
    }
    else if (command.kind === 'retire-person') {
        requireProfile(keys(command, ['kind', 'personId', 'retired']) && typeof command.retired === 'boolean'
            && state.world.characters.some(person => person.id === personId));
        state.retiredPersonIds = state.retiredPersonIds.filter(id => id !== personId);
        if (command.retired)
            state.retiredPersonIds.push(personId);
    }
    else if (command.kind === 'save-profile') {
        requireProfile(keys(command, ['kind', 'personId', 'changes']) && Array.isArray(command.changes) && command.changes.length > 0);
        const edited = new Set();
        for (const change of command.changes) {
            requireProfile(keys(change, ['personId', 'entryId', 'replacement']) && change.personId === personId && !edited.has(change.entryId));
            edited.add(change.entryId);
            const entry = profile.entries.find(entry => entry.id === change.entryId);
            requireProfile(!entry || entry.playerVisible);
            if (change.replacement === null) {
                requireProfile(!!entry);
                profile.entries = profile.entries.filter(entry => entry.id !== change.entryId);
            }
            else {
                requireProfile(keys(change.replacement, ['section', 'text']));
                const sources = [{ kind: 'operation', operationId: event.operationId }];
                if (entry)
                    Object.assign(entry, change.replacement, { sources });
                else
                    profile.entries.push({ id: change.entryId, ...change.replacement, sources,
                        status: 'established', playerVisible: true, knownBy: [], relatedPersonIds: [] });
            }
        }
    }
    else if (command.kind === 'save-profile-details') {
        requireProfile(keys(command, ['kind', 'personId', 'details']) && keys(command.details, ['aliases', 'portrait'])
            && Array.isArray(command.details.aliases) && command.details.aliases.every(alias => typeof alias === 'string')
            && (command.details.portrait === null || typeof command.details.portrait === 'string'));
        profile.aliases = [...command.details.aliases];
        profile.portrait = command.details.portrait;
    }
    else
        throw new Error('Unsupported narrative profile edit.');
    profile.revision++;
}
export function personName(state, personId) {
    return (state.characters.find(person => person.id === personId)
        ?? state.world.characters.find(person => person.id === personId)).name;
}
export function createInitialProfiles(playerId, cast) {
    const entry = (id, section, text, knownBy, sourceSection, status = 'established', relatedPersonIds = []) => ({
        id, section, text, relatedPersonIds, status, playerVisible: true, knownBy,
        sources: [{ kind: 'content', documentId: 'docs/minor-character/setting-guide.md',
                revision: 'Edition 0.2, 7 October 2026', section: sourceSection, excerpt: text }],
    });
    const castId = (name) => cast.find(person => person.name === name).id;
    const publicDescriptions = {
        'Castor Lane': 'A cheerful commoner who inspires hope and makes people follow him.',
        'Ren Thessaly': 'A calm prodigy from a great house of Aurelle, aligned with Ocean',
        'Instructor Oakhollow': 'Homeroom instructor, wounded veteran.',
        'Wren Halloway': 'Quiet and observant.',
        'Pip Ferrand': 'A comic-relief goofball with a quiet loyal streak.',
        'Dorian Brooke': 'B-rank hunter in a small local guild.',
    };
    // Curate individual public excerpts; the Guide's cast rows also contain unrevealed secrets.
    const profiles = cast.map(person => ({
        personId: person.id, aliases: [], portrait: null, revision: 0,
        entries: publicDescriptions[person.name]
            ? [entry('public-description', 'overview', publicDescriptions[person.name], [person.id], '5. The cast')] : [],
    }));
    profiles.unshift({ personId: playerId, aliases: [], portrait: null, revision: 0, entries: [
            entry('sera-before', 'background', 'Sixteen, a first-year cadet, timid and quiet', [], '4. Nathan and Sera'),
            entry('sera-family', 'background', 'A commoner. Her parents are gone; her older brother, a hunter, is her guardian. Her place depends on a scholarship.', [], '4. Nathan and Sera'),
            entry('nathan-before', 'nathan-background', 'Thirty-eight, an astrophysicist, ordinary and a bit stuck.', [playerId], '4. Nathan and Sera', 'recollection'),
            entry('nathan-comic', 'nathan-background', 'In his early twenties he wrote a webcomic about this world and never finished it, because he never decided what it was about or how it ended.', [playerId], '4. Nathan and Sera', 'recollection'),
            entry('opening-allies', 'relationships', 'Wren Halloway and Pip Ferrand arrived and fought beside her.', [playerId], '8. The opening, as it happened', 'established', [castId('Wren Halloway'), castId('Pip Ferrand')]),
            entry('opening-assessment', 'concerns', 'The triage scan came up blank, and the instructor said "delayed awakening" before Sera had to say anything.', [playerId], '8. The opening, as it happened', 'established', [castId('Instructor Oakhollow')]),
        ] });
    profiles.find(profile => profile.personId === castId('The Cub')).entries.push(entry('opening-appearance', 'overview', 'The cub took the shape of a black cat.', [playerId], '8. The opening, as it happened'));
    return profiles;
}
