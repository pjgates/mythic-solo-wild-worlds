import { appendFieldEditors, renderEditableTrack } from "./field-editor.js";
import { EDGES } from "./game/minor-character/sheet.js";
function text(tag, value) {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
}
function section(root, title) {
    const group = document.createElement('section');
    group.append(text('h3', title));
    root.append(group);
    return group;
}
export function renderCapabilities(root, view, editor, mythic) {
    root.replaceChildren();
    root.classList.add('mc-capabilities');
    const { character, play, sheet } = view;
    root.dataset.characterId = character.id;
    const edges = section(root, 'Edges');
    edges.append(text('p', 'A selected Edge adds one die when its approach fits. Only one Edge per roll.'));
    const edgeList = document.createElement('ul');
    edgeList.className = 'mc-edge-list';
    for (const name of EDGES) {
        const selected = character.edges.find(edge => edge.name === name);
        const row = text('li', `${name} · ${selected ? 'Selected' : 'Unselected'}`);
        row.dataset.edge = name;
        if (selected)
            row.dataset.entityId = selected.id;
        if (selected)
            appendFieldEditors(row, view, editor, 'edge', [character.id, selected.id]);
        edgeList.append(row);
    }
    edges.append(edgeList);
    const active = play.cards.find(card => card.id === play.activeClassId);
    const available = sheet.aspects.find(aspect => aspect.id === 'core')?.track.boxes.includes('clear') ?? false;
    const skills = section(root, 'Skills');
    skills.append(text('p', `Active class: ${active.name}. ${available
        ? 'Origin is available; active class competence adds Skill dice.'
        : 'Class competence unavailable: Origin Core is full or absent.'}`));
    skills.append(text('p', 'Trained ranks stay separate from class competence. Total is this Skill’s contribution before an Edge, advantages, the six-die cap and Cuts.'));
    if (editor)
        skills.append(text('p', 'Dice totals and class availability show the saved sheet until you save corrections.'));
    const lores = section(root, 'Lores');
    lores.append(text('p', 'Use one Skill or Lore per roll. Class competence never adds to Lore rolls.'));
    for (const [category, group] of [['skill', skills], ['lore', lores]]) {
        const table = document.createElement('table');
        table.className = 'mc-capability-table';
        const caption = text('caption', category === 'skill' ? 'Skill dice by source' : 'Trained Lore ranks');
        table.append(caption);
        const head = document.createElement('thead');
        const headings = document.createElement('tr');
        for (const label of category === 'skill' ? ['Skill', 'Trained', 'Class', editor ? 'Saved total' : 'Total'] : ['Lore', 'Trained']) {
            const cell = text('th', label);
            cell.setAttribute('scope', 'col');
            headings.append(cell);
        }
        head.append(headings);
        table.append(head);
        const body = document.createElement('tbody');
        for (const skill of character.skills.filter(entry => entry.category === category)) {
            const row = document.createElement('tr');
            row.dataset.entityId = skill.id;
            row.dataset.owner = 'skill';
            const name = text('th', skill.name);
            name.setAttribute('scope', 'row');
            const trained = text('td', editor ? '' : `${skill.rank} / 3`);
            appendFieldEditors(trained, view, editor, 'skill', [character.id, skill.id]);
            row.append(name, trained);
            if (category === 'skill') {
                const bonus = active.competence.find(entry => entry.skillId === skill.id)?.bonus ?? 0;
                const classDice = text('td', `+${bonus}`);
                if (bonus && !available)
                    classDice.append(text('small', 'Unavailable'));
                row.append(classDice, text('td', `${skill.rank + (available ? bonus : 0)}`));
            }
            body.append(row);
        }
        table.append(body);
        group.append(table);
    }
    skills.append(text('small', 'Origin Overflow: dice above six cancel mandatory Cuts only. Voluntary Precision/Impact Cuts remain; unused overflow is lost.'));
    const stored = document.createElement('details');
    stored.className = 'mc-stored-competence';
    stored.append(text('summary', 'Stored class competence · unavailable'));
    stored.append(text('p', 'Stored classes grant no dice. These recorded packages are not added to the active class.'));
    const cards = play.cards.filter(card => card.id !== play.activeClassId);
    for (const card of cards) {
        const row = document.createElement('p');
        row.dataset.entityId = card.id;
        row.append(text('strong', `${card.name}: `));
        row.append(document.createTextNode(card.competence.map(entry => `${character.skills.find(skill => skill.id === entry.skillId).name} +${entry.bonus}`).join(', ') || 'No recorded bonus.'));
        stored.append(row);
    }
    if (!cards.length)
        stored.append(text('p', 'No stored classes.'));
    skills.append(stored);
    const tracks = section(root, 'Campaign tracks');
    for (const [policy, label] of [
        ['exposure', 'Exposure'], ['canon', 'Canon'],
        ['divergence', `Divergence · level ${sheet.divergenceLevel}`],
        ['breakthrough', `Breakthrough · ${sheet.expressedRank}→next rank`],
    ]) {
        const meter = character.meters.find(entry => entry.policy === `minor-character/${policy}`);
        const row = document.createElement('div');
        row.className = 'mc-campaign-track';
        row.dataset.entityId = meter.id;
        row.dataset.owner = 'meter';
        renderEditableTrack(row, label, { boxes: meter.track.boxes, full: meter.full }, meter.track.id, view, editor);
        appendFieldEditors(row, view, editor, 'meter', [character.id, meter.id]);
        if (policy === 'divergence')
            appendFieldEditors(row, view, editor, 'class-state', [character.id], ['divergenceLevel']);
        tracks.append(row);
    }
    const reserve = section(root, 'Chaos and System rescues');
    if (mythic) {
        const chaos = text('p', `Chaos Factor: ${mythic.chaosFactor} · Mythic scene ${mythic.sceneCount}`);
        chaos.dataset.mythicChaos = String(mythic.chaosFactor);
        reserve.append(chaos, text('small', 'Kept by Mythic GME for this chat; adjust it from the Mythic drawer.'));
    }
    else {
        reserve.append(text('p', `Chaos: ${sheet.chaos}`));
        appendFieldEditors(reserve, view, editor, 'world', []);
    }
    reserve.append(text('p', `System rescues: ${sheet.rescues.remaining} of ${sheet.rescues.total} remaining.`));
    reserve.append(text('p', 'Player knowledge only: Sera does not know this reserve. One was spent in the Thornhall. A rescue may avert catastrophic defeat at an agreed story price; it is not automatic healing or a reroll.'));
}
