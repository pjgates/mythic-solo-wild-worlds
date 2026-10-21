export const EDGES = ['Grace', 'Iron', 'Instinct', 'Sharps', 'Teeth', 'Tides', 'Veils'];
export const RANKS = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
// Applied when a class is first acquired. Combined packages sum parents, without regrading.
export const CLASS_ACQUISITION_BONUSES = { base: [1], advanced: [1, 1], master: [2, 1], rare: [2, 1] };
export const STARTING_CLASS_COMPETENCE = {
    Witch: { Weave: CLASS_ACQUISITION_BONUSES.advanced[0], Mend: CLASS_ACQUISITION_BONUSES.advanced[1] },
    Mage: { Weave: CLASS_ACQUISITION_BONUSES.base[0] },
};
// Acquisition tier recorded per starting class; Witch advanced from the base Mage in the opening.
export const STARTING_CLASS_TIERS = {
    Witch: 'advanced',
    Mage: 'base',
};
export function activeClassBonuses(sheet) {
    const origin = sheet.aspects.find(aspect => aspect.id === 'core');
    return origin?.track.boxes.includes('clear') && Object.hasOwn(sheet.classCompetence, sheet.activeClass)
        ? sheet.classCompetence[sheet.activeClass] : {};
}
export function projectSheet(state) {
    const character = state.characters.find(entry => entry.id === state.playerCharacterId);
    const classState = state.classState.find(entry => entry.characterId === character.id);
    const track = (entry) => ({ boxes: entry.track.boxes, full: entry.full });
    const aspects = (archived) => classState.placements
        .filter(placement => (placement.location === 'archive') === archived)
        .map(placement => {
        const aspect = character.aspects.find(entry => entry.id === placement.aspectId);
        const definition = state.definitions.find(entry => entry.id === aspect.definition.id
            && entry.revision === aspect.definition.revision);
        return {
            id: aspect.id, name: aspect.name, type: definition.type, cardId: placement.classId,
            card: placement.classId === null ? null : classState.classes.find(entry => entry.id === placement.classId).name,
            track: { boxes: aspect.track.boxes, full: definition.full },
            rule: definition.effects.map(effect => effect.text).join('\n'), automation: 'manual',
        };
    });
    const ranks = (category) => Object.fromEntries(character.skills
        .filter(skill => skill.category === category)
        .map(skill => [skill.name, skill.rank]));
    const conditions = (kind) => character.conditions.filter(entry => entry.kind === kind)
        .map(entry => ({ id: entry.id, name: entry.name, track: track(entry), effect: entry.effect }));
    const campaignTrack = (name) => track(character.meters.find(entry => entry.policy === `minor-character/${name}`));
    return structuredClone({
        name: character.name, identity: character.identity, edges: character.edges.map(entry => entry.name),
        skills: ranks('skill'), lores: ranks('lore'),
        classCompetence: Object.fromEntries(classState.classes.map(entry => [entry.name,
            Object.fromEntries(entry.competence.map(competence => [
                character.skills.find(skill => skill.id === competence.skillId).name, competence.bonus,
            ])),
        ])),
        activeClass: classState.classes.find(entry => entry.id === classState.activeClassId).name,
        expressedRank: classState.expressedRank, displayedRank: classState.displayedRank,
        aspects: aspects(false), archive: aspects(true), gear: character.possessions.map(entry => entry.name),
        resources: character.resources.map(resource => ({ id: resource.id, name: resource.name, kind: resource.kind,
            tags: resource.tags.map(tag => tag.name), source: resource.source })),
        drives: character.impulses.filter(entry => entry.type === 'text').map(entry => entry.name),
        mires: character.impulses.filter(entry => entry.type === 'tracked')
            .map(entry => ({ id: entry.id, name: entry.name, track: track(entry), effect: entry.effect })),
        tracks: { exposure: campaignTrack('exposure'), canon: campaignTrack('canon'),
            divergence: campaignTrack('divergence'), breakthrough: campaignTrack('breakthrough') },
        divergenceLevel: classState.divergenceLevel,
        rescues: { remaining: classState.rescues.remaining, total: classState.rescues.total, visibility: classState.rescues.visibility },
        projects: character.advancement.filter(entry => entry.type === 'project')
            .map(entry => ({ id: entry.id, name: entry.name, track: track(entry), earned: entry.earned, rule: entry.rule })),
        milestones: character.advancement.filter(entry => entry.type === 'milestone')
            .map(entry => ({ name: entry.name, kind: entry.kind, spentOn: entry.spentOn })),
        injuries: conditions('injuries'), benefits: conditions('benefits'),
        mysteries: state.world.mysteries.map(entry => ({ question: entry.question,
            discoveries: entry.discoveries.map(discovery => discovery.name), truth: entry.truth })),
        chaos: state.world.chaos, threads: state.world.threads.map(entry => entry.name),
        characters: state.world.characters.map(entry => entry.name),
        knives: state.world.knives.map(entry => ({ name: entry.name, beat: entry.beat, status: entry.status })),
    });
}
