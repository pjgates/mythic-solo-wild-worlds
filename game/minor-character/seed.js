import { createInitialProfiles } from "./profiles.js";
import { SKILLS, LORES } from "./catalogue.js";
import { STARTING_CLASS_TIERS } from "./sheet.js";
import { createSeedContent } from "../../seed.js";
export function createInitialState(campaignId, startAnchor) {
    const { sheet: s, opening } = createSeedContent();
    const id = (kind, position) => JSON.stringify([campaignId, kind, position]);
    const characterId = id('character', 0);
    const named = (kind, values) => values.map((name, index) => ({ id: id(kind, index), name }));
    const meter = (kind, ownerId, name, track) => ({
        id: ownerId, name, policy: `minor-character/${kind}`, full: track.full,
        track: { id: JSON.stringify([characterId, kind, ownerId, 'track']), boxes: track.boxes },
    });
    const skills = SKILLS.map((name, index) => ({
        id: id('skill', index), name, category: 'skill', rank: s.skills[name] ?? 0,
    }));
    skills.push(...LORES.map((name, index) => ({
        id: id('lore', index), name, category: 'lore', rank: s.lores[name] ?? 0,
    })));
    const classes = Object.entries(s.classCompetence).map(([name, package_], index) => ({
        id: id('class', index), name,
        competence: Object.entries(package_).map(([skill, bonus]) => ({
            skillId: skills.find(entry => entry.category === 'skill' && entry.name === skill).id, bonus,
        })),
        tier: STARTING_CLASS_TIERS[name] ?? 'advanced',
    }));
    const placed = [
        ...s.aspects.map(aspect => ({ aspect, location: aspect.card === null ? 'personal' : 'card' })),
        ...s.archive.map(aspect => ({ aspect, location: 'archive' })),
    ];
    const definitions = placed.map(({ aspect }) => ({
        id: JSON.stringify([characterId, 'aspect-definition', aspect.id]), revision: 1,
        name: aspect.name, type: aspect.type, description: '', restrictions: [],
        effects: [{ kind: 'manual', text: aspect.rule }], full: aspect.track.full,
    }));
    const cast = named('cast', s.characters);
    return {
        profiles: createInitialProfiles(characterId, cast),
        retiredPersonIds: [], sceneRecords: [], sceneEventCorrections: [], sceneReview: null, memoryPublications: [],
        memoryBindings: { canonical: null, people: [] },
        playerCharacterId: characterId,
        characters: [{
                id: characterId, name: s.name, identity: s.identity, backgrounds: [],
                edges: named('edge', s.edges), skills,
                aspects: placed.map(({ aspect }, index) => ({
                    id: aspect.id, name: aspect.name,
                    definition: { id: definitions[index].id, revision: 1 },
                    track: meter('aspect', aspect.id, aspect.name, aspect.track).track,
                    status: 'owned', acquisition: { source: 'established-opening' },
                })),
                resources: s.resources.map(resource => ({ ...resource,
                    tags: named(`resource-${resource.id}-tag`, resource.tags),
                })),
                impulses: [
                    ...named('drive', s.drives).map(entry => ({ ...entry, type: 'text' })),
                    ...s.mires.map(entry => ({ ...meter('mire', entry.id, entry.name, entry.track), type: 'tracked', effect: entry.effect })),
                ],
                meters: Object.entries(s.tracks).map(([name, track], index) => meter(name, id('meter', index), name, track)),
                advancement: s.projects.map(entry => ({ ...meter('project', entry.id, entry.name, entry.track),
                    type: 'project', earned: entry.earned, rule: entry.rule })),
                conditions: [],
                possessions: named('gear', s.gear),
            }],
        definitions,
        classState: [{
                characterId, classes, activeClassId: classes.find(entry => entry.name === s.activeClass).id,
                manifestedElement: null, switchesThisScene: 0, manaStrainId: null,
                placements: placed.map(({ aspect, location }) => ({
                    aspectId: aspect.id,
                    location,
                    classId: aspect.card === null ? null : classes.find(entry => entry.name === aspect.card).id,
                })),
                expressedRank: s.expressedRank, displayedRank: s.displayedRank,
                divergenceLevel: s.divergenceLevel, rescues: s.rescues,
            }],
        world: {
            scene: { id: id('scene', 0), number: 1, startAnchor: structuredClone(startAnchor) },
            chaos: s.chaos, threads: named('thread', s.threads), characters: cast,
            knives: s.knives.map((entry, index) => ({ ...entry, id: id('knife', index) })),
            mysteries: s.mysteries.map((entry, index) => ({
                ...entry, id: id('mystery', index), discoveries: named(`mystery-${index}-discovery`, entry.discoveries),
            })),
            opening,
        },
        pending: null,
    };
}
