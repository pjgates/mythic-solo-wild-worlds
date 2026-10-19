import { resolveAspect } from "./definitions.js";
import { validateTrack } from "./tracks.js";
export function validateCharacter(character, definitions) {
    const collections = [character.backgrounds, character.edges, character.skills, character.aspects,
        character.resources, character.impulses, character.meters, character.advancement,
        character.conditions, character.possessions];
    requireIds([character], 'character');
    // Entity IDs are scoped to their collection; definitions use (ID, revision) pairs.
    for (const entries of collections)
        requireIds(entries, 'collection');
    for (const resource of character.resources)
        requireIds(resource.tags, 'resource tag');
    for (const definition of definitions)
        resolveAspect(definitions, definition);
    for (const aspect of character.aspects) {
        resolveAspect(definitions, aspect.definition);
        if (aspect.status !== 'owned' && aspect.status !== 'retired') {
            throw new Error(`Aspect ${aspect.id} has an invalid status.`);
        }
        if (!aspect.acquisition || typeof aspect.acquisition.source !== 'string'
            || (aspect.acquisition.operationId !== undefined && typeof aspect.acquisition.operationId !== 'string')) {
            throw new Error(`Aspect ${aspect.id} must record acquisition provenance.`);
        }
    }
    const tracks = [
        ...character.aspects.map(aspect => aspect.track),
        ...character.impulses.flatMap(impulse => impulse.type === 'tracked' ? [impulse.track] : []),
        ...character.meters.map(meter => meter.track),
        ...character.advancement.flatMap(entry => entry.type === 'project' ? [entry.track] : []),
        ...character.conditions.map(condition => condition.track),
    ];
    requireIds(tracks, 'track');
    for (const track of tracks) {
        // Game validation supplies capacity and restricted box states for each owner.
        validateTrack(track, { min: 0, max: Infinity, allowed: ['clear', 'marked', 'burned'] });
    }
}
function requireIds(entries, label) {
    const ids = new Set();
    for (const entry of entries) {
        if (!entry || typeof entry.id !== 'string' || !entry.id.trim()) {
            throw new Error(`A ${label} entry must have an ID.`);
        }
        if (ids.has(entry.id))
            throw new Error(`Duplicate ${label} ID: ${entry.id}.`);
        ids.add(entry.id);
    }
}
