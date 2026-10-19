import { EDGES, RANKS } from "./sheet.js";
const fieldChoices = {
    'class-state.expressedRank': RANKS,
    'class-state.displayedRank': ['Blank', ...RANKS],
    'class-state.divergenceLevel': ['0', '1', '2', '3'],
    'aspect-definition.type': ['trait', 'gear', 'companion'],
    'knife.status': ['diverged', 'armed', 'sheathed', 'drawn', 'resolved'],
    'advancement.kind': ['minor', 'major'],
};
const title = (key) => key.replace(/([a-z])([A-Z])/g, '$1 $2');
// Explicit game fields only. Composite identities contain owner/entity IDs, never collection positions.
export function editableSlots(state) {
    const slots = [];
    function fields(owner, ids, name, target, keys, definition) {
        const record = target;
        for (const key of keys) {
            const choices = typeof record[key] === 'boolean' ? ['false', 'true'] : fieldChoices[`${owner}.${key}`];
            slots.push({
                field: { ref: { owner, entityId: JSON.stringify(ids), field: key }, label: `${name} · ${title(key)}`,
                    value: record[key], ...(choices ? { choices: [...choices] } : {}) },
                nullable: ['truth', 'spentOn'].includes(key), definition,
                write: value => { record[key] = value; },
            });
        }
    }
    function boxes(characterId, name, track) {
        track.boxes.forEach((value, box) => slots.push({
            field: { ref: { owner: 'track', entityId: JSON.stringify([characterId, track.id]), field: 'box', box },
                label: `${name} · Box ${box + 1}`, value, choices: ['clear', 'marked', 'burned'] },
            nullable: false, write: value => { track.boxes[box] = value; },
        }));
    }
    function binding(owner, ids, field, name, classes, before, write) {
        slots.push({
            field: { ref: { owner, entityId: JSON.stringify(ids), field }, label: `${name} · ${title(field)}`,
                value: before === null ? null : classes.find(entry => entry.id === before).name,
                choices: classes.map(entry => entry.name) },
            nullable: field === 'card', classBinding: { before, classes, write },
        });
    }
    for (const c of state.characters) {
        fields('character', [c.id], c.name, c, ['name']);
        for (const key of Object.keys(c.identity))
            slots.push({
                field: { ref: { owner: 'identity', entityId: JSON.stringify([c.id, key]), field: 'text' },
                    label: `${c.name} · ${title(key)}`, value: c.identity[key] },
                nullable: false, write: value => { c.identity[key] = value; },
            });
        for (const edge of c.edges)
            slots.push({
                field: { ref: { owner: 'edge', entityId: JSON.stringify([c.id, edge.id]), field: 'name' },
                    label: `${edge.name} · name`, value: edge.name,
                    choices: EDGES.filter(name => name === edge.name || !c.edges.some(other => other.name === name)) },
                nullable: false, write: value => { edge.name = value; },
            });
        const classes = state.classState.find(entry => entry.characterId === c.id);
        fields('class-state', [c.id], c.name, classes, ['expressedRank', 'displayedRank', 'divergenceLevel']);
        fields('rescues', [c.id], `${c.name} · Rescues`, classes.rescues, ['remaining', 'total']);
        binding('class-state', [c.id], 'activeClass', c.name, classes.classes, classes.activeClassId, id => { classes.activeClassId = id; });
        for (const entry of classes.classes)
            for (const bonus of entry.competence) {
                const skill = c.skills.find(skill => skill.id === bonus.skillId);
                fields('competence', [c.id, entry.id, skill.id], `${entry.name} · ${skill.name}`, bonus, ['bonus']);
            }
        for (const skill of c.skills) {
            fields('skill', [c.id, skill.id], `${skill.category} · ${skill.name}`, skill, ['rank']);
        }
        for (const aspect of c.aspects) {
            fields('aspect', [c.id, aspect.id], aspect.name, aspect, ['name']);
            boxes(c.id, aspect.name, aspect.track);
            const definition = { instance: aspect, draft: structuredClone(state.definitions.find(entry => entry.id === aspect.definition.id && entry.revision === aspect.definition.revision)) };
            fields('aspect-definition', [c.id, aspect.id], aspect.name, definition.draft, ['type', 'full'], definition);
            slots.push({
                field: { ref: { owner: 'aspect-definition', entityId: JSON.stringify([c.id, aspect.id]), field: 'rule' },
                    label: `${aspect.name} · Rule`, value: definition.draft.effects.map(effect => effect.text).join('\n') },
                nullable: false, definition,
                write: value => { definition.draft.effects = [{ kind: 'manual', text: value }]; },
            });
            const placement = classes.placements.find(entry => entry.aspectId === aspect.id);
            binding('placement', [c.id, aspect.id], 'card', aspect.name, classes.classes, placement.classId, id => {
                placement.classId = id;
                if (placement.location !== 'archive')
                    placement.location = id === null ? 'personal' : 'card';
            });
        }
        for (const resource of c.resources) {
            fields('resource', [c.id, resource.id], resource.name, resource, ['name', 'kind', 'source']);
            for (const tag of resource.tags)
                fields('resource-tag', [c.id, resource.id, tag.id], `${resource.name} · Tag`, tag, ['name']);
        }
        for (const impulse of c.impulses) {
            fields('impulse', [c.id, impulse.id], impulse.name, impulse, impulse.type === 'text' ? ['name'] : ['name', 'effect', 'full']);
            if (impulse.type === 'tracked')
                boxes(c.id, impulse.name, impulse.track);
        }
        for (const meter of c.meters) {
            fields('meter', [c.id, meter.id], meter.name, meter, ['full']);
            boxes(c.id, meter.name, meter.track);
        }
        for (const entry of c.advancement) {
            fields('advancement', [c.id, entry.id], entry.name, entry, entry.type === 'project' ? ['name', 'earned', 'rule', 'full'] : ['name', 'kind', 'spentOn']);
            if (entry.type === 'project')
                boxes(c.id, entry.name, entry.track);
        }
        for (const entry of c.conditions) {
            fields('condition', [c.id, entry.id], `${entry.kind} · ${entry.name}`, entry, ['name', 'effect', 'full']);
            boxes(c.id, entry.name, entry.track);
        }
        for (const entry of c.possessions)
            fields('possession', [c.id, entry.id], entry.name, entry, ['name']);
    }
    fields('world', [], 'World', state.world, ['chaos']);
    for (const entry of state.world.threads)
        fields('thread', [entry.id], 'Thread', entry, ['name']);
    for (const entry of state.world.characters)
        fields('cast', [entry.id], 'Cast', entry, ['name']);
    for (const entry of state.world.knives)
        fields('knife', [entry.id], entry.name, entry, ['name', 'beat', 'status']);
    for (const entry of state.world.mysteries) {
        fields('mystery', [entry.id], entry.question, entry, ['question', 'truth']);
        for (const discovery of entry.discoveries)
            fields('discovery', [entry.id, discovery.id], entry.question, discovery, ['name']);
    }
    return slots;
}
