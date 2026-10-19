import { appendMemoryBinding } from "./memory-binding-view.js";
const sections = [
    ['overview', 'Overview'], ['personality', 'Personality'], ['background', 'Sera’s background'],
    ['nathan-background', 'Nathan’s background & recollections'], ['relationships', 'Relationships'],
    ['concerns', 'Current concerns'],
];
function text(tag, value) {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
}
export function renderProfile(root, profile, callbacks) {
    root.replaceChildren();
    root.classList.add('mc-profile');
    root.append(text('h3', 'Background & history'), text('p', profile.name));
    if (callbacks.memory)
        appendMemoryBinding(root, callbacks.memory);
    const labels = new Map(sections.filter(([id]) => !callbacks.npc || id !== 'nathan-background'));
    if (callbacks.npc)
        labels.set('background', 'Background');
    for (const entry of profile.entries)
        if (!labels.has(entry.section))
            labels.set(entry.section, entry.section);
    for (const [id, label] of labels) {
        const section = document.createElement('section');
        section.dataset.profileSection = id;
        section.append(text('h4', label));
        const entries = profile.entries.filter(entry => entry.section === id);
        if (!entries.length)
            section.append(text('p', 'Not yet recorded.'));
        for (const entry of entries) {
            const article = document.createElement('article');
            article.dataset.profileEntry = entry.id;
            const status = text('span', entry.status === 'established' ? 'Established'
                : entry.status === 'recollection' ? 'Nathan’s recollection' : 'Unconfirmed');
            status.className = 'mc-pill';
            article.append(status, text('p', entry.text));
            appendProfileSources(article, entry.id, entry.sources, callbacks);
            appendProfileEditor(article, id, label, entry.id, callbacks);
            section.append(article);
        }
        if (!entries.length)
            appendProfileEditor(section, id, label, undefined, callbacks);
        root.append(section);
    }
    appendProfileHistory(root, profile, callbacks);
}
export function appendProfileSources(root, claimId, sources, callbacks) {
    if (!callbacks.readSource)
        return;
    for (const source of sources) {
        if (source.kind === 'operation') {
            root.append(text('p', `Operation receipt: ${source.operationId} · see Mechanical history`));
            continue;
        }
        const key = JSON.stringify([claimId, source]);
        const details = document.createElement('details');
        details.dataset.profileSource = key;
        const summary = text('summary', source.kind === 'scene' ? `Captured message ${source.messageIndex + 1}`
            : `${source.documentId} · ${source.revision} · ${source.section}`);
        summary.dataset.profileFocus = key;
        const excerpt = document.createElement('blockquote');
        details.append(summary);
        const show = () => {
            if (details.open) {
                callbacks.openSources?.add(key);
                excerpt.textContent = callbacks.readSource(source) ?? 'Source excerpt unavailable.';
                details.append(excerpt);
            }
            else {
                callbacks.openSources?.delete(key);
                excerpt.remove();
            }
        };
        details.ontoggle = show;
        details.open = callbacks.openSources?.has(key) ?? false;
        if (details.open)
            show();
        root.append(details);
    }
}
function appendProfileEditor(root, section, label, entryId, callbacks) {
    const session = callbacks.session;
    if (!session || !callbacks.edit)
        return;
    const draft = session.draft;
    const editing = draft?.section === section && (entryId ? draft.entryId === entryId : true);
    const button = (label, key, action) => {
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'menu_button';
        control.textContent = label;
        control.dataset.profileFocus = key;
        control.onclick = action;
        return control;
    };
    if (!editing) {
        const edit = button(`${entryId ? 'Edit' : 'Add'} ${label}`, `edit:${entryId ?? section}`, () => callbacks.edit(section, entryId));
        edit.disabled = !session.canBegin;
        root.append(edit);
        return;
    }
    const form = document.createElement('div');
    form.className = 'mc-field-editor';
    const fieldLabel = text('label', `Edit ${label}`);
    const input = document.createElement('textarea');
    input.className = 'text_pole';
    input.rows = 4;
    input.setAttribute('aria-label', `Edit ${label}`);
    input.dataset.profileFocus = `prose:${draft.entryId}`;
    input.value = draft.text;
    input.required = true;
    input.disabled = !session.editable;
    fieldLabel.append(input);
    const save = button('Save profile', `save:${draft.entryId}`, () => { void session.save(); });
    const cancel = button('Cancel profile edit', `cancel:${draft.entryId}`, () => session.cancel());
    save.disabled = !session.canSave;
    cancel.disabled = session.busy;
    input.oninput = () => { session.update(input.value); save.disabled = !session.canSave; };
    const status = text('p', session.message);
    status.setAttribute('role', 'status');
    form.append(fieldLabel, save, cancel, status);
    root.append(form);
}
function appendProfileHistory(root, profile, callbacks) {
    const history = callbacks.history;
    if (!history)
        return;
    const section = document.createElement('section');
    section.dataset.profileHistory = '';
    section.dataset.profileSection = 'campaign-history';
    section.append(text('h4', 'Campaign history'));
    const total = profile.timeline.reduce((count, scene) => count + scene.events.length, 0);
    const status = text('p', total ? `Showing ${Math.min(history.visibleCount, total)} of ${total} accepted events, newest first.`
        : 'No accepted campaign events yet.');
    status.setAttribute('role', 'status');
    section.append(status);
    status.tabIndex = -1;
    status.dataset.profileFocus = 'history-status';
    let remaining = history.visibleCount;
    for (const scene of [...profile.timeline].reverse()) {
        if (!remaining)
            break;
        const events = scene.events.slice(-remaining).reverse();
        remaining -= events.length;
        const details = document.createElement('details');
        details.dataset.profileScene = scene.sceneRecordId;
        const summary = text('summary', `Scene ${scene.sceneNumber}`);
        summary.dataset.profileFocus = `scene:${scene.sceneRecordId}`;
        details.append(summary);
        details.open = history.openScenes.get(scene.sceneRecordId) ?? true;
        details.ontoggle = () => history.openScenes.set(scene.sceneRecordId, details.open);
        const list = document.createElement('ol');
        for (const event of events) {
            const item = document.createElement('li');
            item.tabIndex = -1;
            item.dataset.profileEvent = event.id;
            item.dataset.profileFocus = `event:${event.id}`;
            item.append(text('p', event.text));
            appendProfileSources(item, JSON.stringify([scene.sceneRecordId, event.id]), event.sources, callbacks);
            if (event.corrections?.length) {
                const audit = document.createElement('details');
                audit.append(text('summary', 'Correction history'));
                for (const correction of event.corrections)
                    audit.append(text('p', `Before: ${correction.before}`), text('p', `After: ${correction.after}`), text('p', `Reason: ${correction.reason}`), text('p', `Operation: ${correction.operationId}`));
                item.append(audit);
            }
            appendEventEditor(item, profile.personId, scene.sceneRecordId, event.id, callbacks);
            list.append(item);
        }
        details.append(list);
        section.append(details);
    }
    if (history.visibleCount < total) {
        const older = document.createElement('button');
        older.type = 'button';
        older.className = 'menu_button';
        older.dataset.profileLoadOlder = '';
        older.dataset.profileFocus = 'profile-older';
        older.textContent = 'Load older events';
        older.onclick = history.loadOlder;
        section.append(older);
    }
    root.append(section);
}
function appendEventEditor(root, personId, sceneRecordId, eventId, callbacks) {
    const session = callbacks.eventSession;
    if (!session || !callbacks.correctEvent)
        return;
    const draft = session.draft;
    const key = JSON.stringify([sceneRecordId, eventId]);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu_button';
    button.dataset.profileFocus = `edit:${key}`;
    if (!draft || draft.personId !== personId || draft.sceneRecordId !== sceneRecordId || draft.eventId !== eventId) {
        button.textContent = 'Correct event';
        button.dataset.eventCorrect = '';
        button.disabled = !session.canBegin;
        button.onclick = () => callbacks.correctEvent(sceneRecordId, eventId);
        root.append(button);
        return;
    }
    const form = document.createElement('div');
    form.className = 'mc-field-editor';
    form.dataset.eventEditor = '';
    for (const [field, label] of [['text', 'Corrected event'], ['reason', 'Correction reason']]) {
        const wrapper = text('label', label);
        const input = document.createElement('textarea');
        input.className = 'text_pole';
        input.rows = field === 'text' ? 4 : 2;
        input.setAttribute('aria-label', label);
        input.dataset.profileFocus = `event-${field}:${key}`;
        input.value = draft[field];
        input.required = true;
        input.disabled = !session.editable;
        input.oninput = () => { session.update(field, input.value); button.disabled = !session.canSave; };
        wrapper.append(input);
        form.append(wrapper);
    }
    button.textContent = 'Save event correction';
    button.disabled = !session.canSave;
    button.onclick = () => { void session.save(); };
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'menu_button';
    cancel.textContent = 'Cancel event correction';
    cancel.disabled = session.busy;
    cancel.dataset.profileFocus = `event-cancel:${key}`;
    cancel.onclick = () => session.cancel();
    const status = text('p', session.message);
    status.setAttribute('role', 'status');
    form.append(button, cancel, status);
    root.append(form);
}
