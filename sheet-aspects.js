import { appendFieldEditors, renderEditableTrack } from "./field-editor.js";
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
function row(root, owner, id) {
    const entry = document.createElement('article');
    entry.dataset.owner = owner;
    entry.dataset.entityId = id;
    root.append(entry);
    return entry;
}
function aspects(root, values, view, editor) {
    if (!values.length)
        root.append(text('p', 'No Aspects recorded.'));
    for (const aspect of values) {
        const entry = row(root, 'aspect', aspect.id);
        const trackId = view.character.aspects.find(value => value.id === aspect.id).track.id;
        renderEditableTrack(entry, `${aspect.name} · ${aspect.type}`, aspect.track, trackId, view, editor);
        appendFieldEditors(entry, view, editor, 'aspect', [view.characterId, aspect.id]);
        entry.append(text('p', aspect.rule));
        entry.append(text('small', 'Manual effects: agree their outcome with the GM.'));
    }
}
function expandable(root, title) {
    const group = document.createElement('details');
    group.append(text('summary', title));
    root.append(group);
    return group;
}
export function renderAspects(root, view, editor) {
    root.replaceChildren();
    root.classList.add('mc-aspects');
    root.dataset.characterId = view.character.id;
    const { sheet, play } = view;
    aspects(section(root, 'Personal Aspects'), sheet.aspects.filter(aspect => aspect.cardId === null), view, editor);
    const active = play.cards.find(card => card.id === play.activeClassId);
    const activeGroup = section(root, `${active.name} · active Class Card`);
    activeGroup.dataset.cardId = active.id;
    aspects(activeGroup, sheet.aspects.filter(aspect => aspect.cardId === active.id), view, editor);
    const conditions = section(root, 'Temporary conditions');
    for (const [kind, title] of [['injuries', 'Injuries'], ['benefits', 'Benefits']]) {
        conditions.append(text('h4', title));
        if (!sheet[kind].length)
            conditions.append(text('p', `No ${kind} recorded.`));
        for (const condition of sheet[kind]) {
            const entry = row(conditions, 'condition', condition.id);
            const trackId = view.character.conditions.find(value => value.id === condition.id).track.id;
            renderEditableTrack(entry, condition.name, condition.track, trackId, view, editor);
            appendFieldEditors(entry, view, editor, 'condition', [view.characterId, condition.id]);
            entry.append(text('p', condition.effect));
        }
    }
    const projects = section(root, 'Projects');
    if (!sheet.projects.length)
        projects.append(text('p', 'No projects recorded.'));
    for (const project of sheet.projects) {
        const entry = row(projects, 'advancement', project.id);
        const record = view.character.advancement.find(value => value.id === project.id);
        if (record.type === 'project')
            renderEditableTrack(entry, `${project.name} · ${project.earned ? 'earned' : 'unearned'}`, project.track, record.track.id, view, editor);
        appendFieldEditors(entry, view, editor, 'advancement', [view.characterId, project.id]);
        entry.append(text('p', project.rule));
    }
    const cards = expandable(root, 'Other Class Cards · stored');
    cards.append(text('p', 'Stored cards grant no active Aspects. Marks and burns are retained.'));
    const stored = play.cards.filter(card => card.id !== play.activeClassId);
    if (!stored.length)
        cards.append(text('p', 'No other Class Cards learned.'));
    for (const card of stored) {
        const group = section(cards, `${card.name} · stored Class Card`);
        group.dataset.cardId = card.id;
        aspects(group, sheet.aspects.filter(aspect => aspect.cardId === card.id), view, editor);
    }
    const archive = expandable(root, `Archive · ${sheet.archive.length} ${sheet.archive.length === 1 ? 'Aspect' : 'Aspects'}`);
    archive.append(text('p', 'Archived Aspects grant no benefit. Marks, burns and rules are retained.'));
    aspects(archive, sheet.archive, view, editor);
}
