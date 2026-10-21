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
function row(root, owner, id, tag = 'article') {
    const entry = document.createElement(tag);
    entry.dataset.owner = owner;
    entry.dataset.entityId = id;
    root.append(entry);
    return entry;
}
function namedList(root, entries, owner, empty, view, editor, parentIds) {
    if (!entries.length) {
        root.append(text('p', empty));
        return;
    }
    const list = document.createElement('ul');
    for (const entry of entries) {
        const item = row(list, owner, entry.id, 'li');
        item.append(text('span', entry.name));
        appendFieldEditors(item, view, editor, owner, [...parentIds, entry.id]);
    }
    root.append(list);
}
export function renderLife(root, view, editor) {
    root.replaceChildren();
    root.classList.add('mc-life');
    root.dataset.characterId = view.character.id;
    const character = view.character;
    namedList(section(root, 'Drives'), character.impulses.filter(entry => entry.type === 'text'), 'impulse', 'No Drives recorded.', view, editor, [character.id]);
    const mires = section(root, 'Mires');
    const tracked = character.impulses.filter(entry => entry.type === 'tracked');
    if (!tracked.length)
        mires.append(text('p', 'No Mires recorded.'));
    for (const mire of tracked) {
        const entry = row(mires, 'impulse', mire.id);
        entry.dataset.trackId = mire.track.id;
        renderEditableTrack(entry, mire.name, { boxes: mire.track.boxes, full: mire.full }, mire.track.id, view, editor);
        appendFieldEditors(entry, view, editor, 'impulse', [character.id, mire.id]);
        entry.append(text('p', mire.effect));
    }
    const resources = section(root, 'Resources');
    if (!character.resources.length)
        resources.append(text('p', 'No resources recorded.'));
    for (const resource of character.resources) {
        const entry = row(resources, 'resource', resource.id);
        entry.append(text('h4', resource.name), text('p', `Kind: ${resource.kind}`));
        appendFieldEditors(entry, view, editor, 'resource', [character.id, resource.id]);
        namedList(entry, resource.tags, 'resource-tag', 'No tags recorded.', view, editor, [character.id, resource.id]);
        entry.append(text('p', `Source: ${resource.source}`));
    }
    namedList(section(root, 'Ordinary gear · not Aspects'), character.possessions, 'possession', 'No ordinary gear recorded.', view, editor, [character.id]);
    const milestones = section(root, 'Milestones');
    const earned = character.advancement.filter(entry => entry.type === 'milestone');
    if (!earned.length)
        milestones.append(text('p', 'No milestones recorded.'));
    for (const milestone of earned) {
        const entry = row(milestones, 'advancement', milestone.id);
        entry.append(text('h4', milestone.name), text('p', `${milestone.kind} · ${milestone.spentOn === null ? 'Unspent' : `Spent on: ${milestone.spentOn}`}`));
        appendFieldEditors(entry, view, editor, 'advancement', [character.id, milestone.id]);
    }
}
function mythicThreads(root, mythic) {
    root.dataset.mythicThreads = String(mythic.threads.length);
    if (!mythic.threads.length)
        root.append(text('p', 'No threads on the Mythic list yet.'));
    else {
        const list = document.createElement('ul');
        for (const entry of mythic.threads) {
            const item = document.createElement('li');
            item.dataset.owner = 'mythic-thread';
            item.dataset.entityId = entry.id;
            item.append(text('span', entry.weight > 1 ? `${entry.name} ×${entry.weight}` : entry.name));
            list.append(item);
        }
        root.append(list);
    }
    root.append(text('small', 'Kept by Mythic GME’s Threads list for this chat; edit it from the Mythic drawer.'));
}
export function renderCampaignDetails(root, view, editor, mythic) {
    root.replaceChildren();
    root.classList.add('mc-campaign-details');
    const details = document.createElement('details');
    details.append(text('summary', 'Campaign details'));
    root.append(details);
    const world = view.campaignDetails;
    const mysteries = section(details, 'Mysteries');
    if (!world.mysteries.length)
        mysteries.append(text('p', 'No mysteries recorded.'));
    for (const mystery of world.mysteries) {
        const entry = row(mysteries, 'mystery', mystery.id);
        entry.append(text('h4', mystery.question));
        appendFieldEditors(entry, view, editor, 'mystery', [mystery.id]);
        namedList(entry, mystery.discoveries, 'discovery', 'No small discoveries recorded.', view, editor, [mystery.id]);
        entry.append(text('p', mystery.truth === null ? 'No accepted Truth.' : `Accepted Truth: ${mystery.truth}`));
    }
    const threads = section(details, 'Threads');
    if (mythic)
        mythicThreads(threads, mythic);
    else
        namedList(threads, world.threads, 'thread', 'No threads recorded.', view, editor, []);
    namedList(section(details, 'Cast'), world.characters, 'cast', 'No cast members recorded.', view, editor, []);
    const recollections = section(details, 'Canon recollections · not established facts');
    if (!world.knives.length)
        recollections.append(text('p', 'No Canon recollections recorded.'));
    for (const recollection of world.knives) {
        const entry = row(recollections, 'knife', recollection.id);
        entry.append(text('p', `${recollection.beat}. ${recollection.name} · ${recollection.status}`));
        appendFieldEditors(entry, view, editor, 'knife', [recollection.id]);
    }
    section(details, 'Established opening · already happened').append(text('p', view.opening));
}
