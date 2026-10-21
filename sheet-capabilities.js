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
const pips = (count, kind) => {
    const row = document.createElement('span');
    row.className = `mc-skill-pips mc-pips-${kind}`;
    row.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < count; index++)
        row.append(document.createElement('span'));
    return row;
};
export function renderCapabilities(root, view, editor, mythic, tracksRoot = root) {
    root.replaceChildren();
    root.classList.add('mc-capabilities');
    const { character, play, sheet } = view;
    root.dataset.characterId = character.id;
    const edges = section(root, 'Edges');
    const edgeList = document.createElement('ul');
    edgeList.className = 'mc-edge-list';
    const unchosen = [];
    for (const name of EDGES) {
        const selected = character.edges.find(edge => edge.name === name);
        if (!selected && !editor) {
            unchosen.push(name);
            continue;
        }
        const row = text('li', editor ? `${name} · ${selected ? 'Selected' : 'Unselected'}` : name);
        row.dataset.edge = name;
        row.classList.toggle('mc-edge-selected', !!selected);
        if (selected)
            row.dataset.entityId = selected.id;
        if (selected)
            appendFieldEditors(row, view, editor, 'edge', [character.id, selected.id]);
        edgeList.append(row);
    }
    edges.append(edgeList);
    if (unchosen.length) {
        const rest = text('p', `Not chosen: ${unchosen.join(', ')}`);
        rest.className = 'mc-hint';
        edges.append(rest);
    }
    const active = play.cards.find(card => card.id === play.activeClassId);
    const available = sheet.aspects.find(aspect => aspect.id === 'core')?.track.boxes.includes('clear') ?? false;
    const skills = section(root, 'Skills');
    const legend = document.createElement('p');
    legend.className = 'mc-pip-legend';
    legend.append(pips(1, 'trained'), document.createTextNode('Trained'), pips(1, 'class'), document.createTextNode(active.name));
    skills.append(legend);
    if (!available) {
        const off = text('p', 'Class competence unavailable: Origin Core is full or absent.');
        off.className = 'mc-notice';
        skills.append(off);
    }
    if (editor) {
        const note = text('p', 'Dice totals show the saved sheet until you save corrections.');
        note.className = 'mc-hint';
        skills.append(note);
    }
    const lores = section(root, 'Lores');
    for (const [category, group] of [['skill', skills], ['lore', lores]]) {
        const table = document.createElement('table');
        table.className = 'mc-capability-table';
        const caption = text('caption', category === 'skill' ? 'Skill dice by source' : 'Trained Lore ranks');
        caption.className = 'mc-visually-hidden';
        table.append(caption);
        const head = document.createElement('thead');
        head.className = 'mc-visually-hidden';
        const headings = document.createElement('tr');
        for (const label of category === 'skill' ? ['Skill', 'Trained', 'Class', editor ? 'Saved total' : 'Total'] : ['Lore', 'Trained', 'Total']) {
            const cell = text('th', label);
            cell.setAttribute('scope', 'col');
            headings.append(cell);
        }
        head.append(headings);
        table.append(head);
        const body = document.createElement('tbody');
        const hidden = document.createElement('tbody');
        hidden.className = 'mc-untrained';
        for (const skill of character.skills.filter(entry => entry.category === category)) {
            const row = document.createElement('tr');
            row.dataset.entityId = skill.id;
            row.dataset.owner = 'skill';
            const name = text('th', skill.name);
            name.setAttribute('scope', 'row');
            const trained = text('td', '');
            if (editor)
                appendFieldEditors(trained, view, editor, 'skill', [character.id, skill.id]);
            else {
                trained.append(pips(skill.rank, 'trained'), text('span', `${skill.rank} trained`));
                trained.lastElementChild.className = 'mc-visually-hidden';
            }
            row.append(name, trained);
            const bonus = category === 'skill' ? active.competence.find(entry => entry.skillId === skill.id)?.bonus ?? 0 : 0;
            if (category === 'skill') {
                const classDice = text('td', '');
                if (bonus) {
                    classDice.append(pips(available ? bonus : 0, 'class'), text('span', `+${bonus} ${active.name}`));
                    classDice.lastElementChild.className = available ? 'mc-visually-hidden' : 'mc-hint';
                    if (!available)
                        classDice.lastElementChild.textContent = `+${bonus} unavailable`;
                }
                row.append(classDice);
            }
            const total = skill.rank + (available ? bonus : 0);
            const totalCell = text('td', total ? `${total}d` : 'untrained');
            totalCell.className = total ? 'mc-total' : 'mc-total mc-hint';
            row.append(totalCell);
            (total || editor ? body : hidden).append(row);
        }
        table.append(body);
        if (hidden.children.length) {
            table.append(hidden);
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'mc-link-button';
            const count = hidden.children.length;
            const label = category === 'skill' ? `${count} untrained Skill${count === 1 ? '' : 's'}` : `${count} untrained Lore${count === 1 ? '' : 's'}`;
            more.textContent = `Show ${label}`;
            more.setAttribute('aria-expanded', 'false');
            more.onclick = () => {
                const open = table.classList.toggle('mc-show-untrained');
                more.textContent = open ? `Hide ${label}` : `Show ${label}`;
                more.setAttribute('aria-expanded', String(open));
            };
            group.append(table, more);
        }
        else
            group.append(table);
    }
    const help = document.createElement('details');
    help.className = 'mc-help';
    help.append(text('summary', 'How dice add up'), text('p', 'One Edge adds a die when its approach fits. Use one Skill or Lore per roll. Class competence adds only to Skills while Origin Core has a clear box, never to Lores.'));
    skills.append(help);
    help.append(text('p', 'Origin Overflow: dice above six cancel mandatory Cuts only. Voluntary Precision and Impact Cuts remain; unused overflow is lost.'));
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
    const tracks = section(tracksRoot, 'Campaign tracks');
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
    const reserve = section(tracksRoot, 'Chaos and System rescues');
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
