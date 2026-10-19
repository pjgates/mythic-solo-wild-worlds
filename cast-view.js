import { appendMemoryBinding } from "./memory-binding-view.js";
import { renderProfile } from "./profile-view.js";
function text(tag, value) {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
}
function button(label, key, action) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'menu_button';
    control.textContent = label;
    control.dataset.profileFocus = key;
    control.onclick = action;
    return control;
}
function personLabel(personId, profiles) {
    const hash = (id) => {
        let value = 2166136261;
        for (const char of id)
            value = Math.imul(value ^ char.codePointAt(0), 16777619);
        return (value >>> 0).toString(36).toUpperCase().padStart(7, '0');
    };
    const code = hash(personId);
    const collision = profiles.some(profile => profile.personId !== personId && hash(profile.personId) === code);
    return `Person ${code}${collision ? ` · ${encodeURIComponent(personId)}` : ''}`;
}
function portrait(root, profile) {
    if (!profile.portrait)
        return;
    try {
        const url = new URL(profile.portrait);
        if (!['https:', 'http:'].includes(url.protocol)
            && !/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(profile.portrait))
            return;
    }
    catch {
        return;
    }
    const image = document.createElement('img');
    image.src = profile.portrait;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    root.append(image);
}
export function renderCast(root, profiles, selectedPersonId, callbacks) {
    root.replaceChildren();
    const cast = document.createElement('div');
    cast.className = 'mc-cast';
    root.append(cast);
    const selected = profiles.find(profile => profile.personId === selectedPersonId);
    const navigation = callbacks.cast;
    cast.dataset.showDetail = String(navigation.detail && !!selected);
    const session = navigation.session;
    if (session) {
        const commands = document.createElement('header');
        commands.className = 'mc-cast-commands';
        const add = button('Add person', 'cast-add', () => navigation.add());
        add.disabled = !session.canBegin;
        commands.append(add);
        const draft = session.draft;
        if (draft && draft.command.kind !== 'bind-memory') {
            const form = document.createElement('form');
            form.className = 'mc-field-editor';
            form.onsubmit = event => { event.preventDefault(); void session.save(); };
            const save = button('Save person', 'cast-save', () => { });
            save.type = 'submit';
            save.disabled = !session.canSave;
            const cancel = button('Cancel person edit', 'cast-cancel', () => session.cancel());
            cancel.disabled = session.busy;
            if (draft.command.kind !== 'retire') {
                const label = text('label', draft.command.kind === 'add' ? 'New person name' : 'Person name');
                const name = document.createElement('input');
                name.className = 'text_pole';
                name.required = true;
                name.dataset.profileFocus = 'cast-name';
                name.value = draft.command.name;
                name.disabled = !session.editable;
                name.oninput = () => { session.update(name.value); save.disabled = !session.canSave; };
                label.append(name);
                form.append(label);
            }
            const status = text('p', session.message);
            status.setAttribute('role', 'status');
            form.append(save, cancel, status);
            commands.append(form);
        }
        if (navigation.canonicalMemory)
            appendMemoryBinding(commands, navigation.canonicalMemory);
        cast.append(commands);
    }
    const list = document.createElement('section');
    list.dataset.castList = '';
    const heading = text('h3', 'Campaign cast');
    heading.tabIndex = -1;
    list.append(heading);
    const label = text('label', 'Search names and aliases');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'text_pole';
    search.dataset.profileFocus = 'cast-search';
    search.value = navigation.query;
    search.oninput = () => navigation.search(search.value);
    label.append(search);
    list.append(label);
    const retiredLabel = text('label', 'Show retired');
    const retired = document.createElement('input');
    retired.type = 'checkbox';
    retired.checked = navigation.showRetired;
    retired.dataset.profileFocus = 'cast-retired';
    retired.onchange = () => navigation.filterRetired(retired.checked);
    retiredLabel.prepend(retired);
    list.append(retiredLabel);
    const query = navigation.query.trim().toLocaleLowerCase();
    const visible = profiles.filter(profile => (navigation.showRetired || !profile.retired)
        && [profile.name, ...profile.aliases].some(value => value.toLocaleLowerCase().includes(query)));
    if (!visible.length)
        list.append(text('p', 'No people match this view.'));
    for (const profile of visible) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'menu_button mc-cast-person';
        row.dataset.personId = profile.personId;
        row.dataset.profileFocus = `cast-person:${profile.personId}`;
        row.setAttribute('aria-pressed', String(profile.personId === selectedPersonId));
        portrait(row, profile);
        row.append(text('strong', profile.name));
        if (profile.retired)
            row.append(text('small', 'Retired'));
        if (profiles.filter(person => person.name === profile.name).length > 1) {
            row.append(text('small', personLabel(profile.personId, profiles)));
        }
        if (profile.aliases.length)
            row.append(text('small', profile.aliases.join(' · ')));
        const overview = profile.entries.find(entry => entry.section === 'overview' && entry.status === 'established');
        if (overview)
            row.append(text('small', overview.text));
        row.onclick = () => callbacks.cast?.selectPerson(profile.personId);
        list.append(row);
    }
    cast.append(list);
    if (!selected)
        return;
    const detail = document.createElement('section');
    detail.dataset.castDetail = '';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'menu_button';
    back.textContent = 'Back to cast';
    back.onclick = navigation.backToList;
    detail.append(back);
    portrait(detail, selected);
    const name = text('h3', selected.name);
    name.tabIndex = -1;
    name.dataset.profileFocus = 'cast-heading';
    detail.append(name);
    if (profiles.filter(person => person.name === selected.name).length > 1)
        detail.append(text('p', personLabel(selected.personId, profiles)));
    if (selected.retired)
        detail.append(text('p', 'Retired'));
    if (selected.aliases.length)
        detail.append(text('p', selected.aliases.join(' · ')));
    if (session) {
        const rename = button('Rename person', 'cast-rename', () => navigation.rename());
        const retire = button(selected.retired ? 'Restore person' : 'Retire person', 'cast-retire', () => navigation.retire());
        rename.disabled = retire.disabled = !session.canBegin;
        detail.append(rename, retire);
    }
    const prose = document.createElement('div');
    detail.append(prose);
    renderProfile(prose, selected, { ...callbacks, npc: true });
    cast.append(detail);
}
