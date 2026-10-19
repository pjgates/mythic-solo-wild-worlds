// Explicit setup only: a saved route does not prove external availability or publication.
export function appendMemoryBinding(root, controls) {
    const { personId, destination, session } = controls;
    const section = document.createElement('section');
    section.dataset.memoryBinding = personId ?? 'canonical';
    const text = (tag, value) => {
        const element = document.createElement(tag);
        element.textContent = value;
        return element;
    };
    const button = (label, key, action) => {
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'menu_button';
        control.textContent = label;
        control.dataset.profileFocus = key;
        control.onclick = action;
        return control;
    };
    const key = `memory:${personId ?? 'canonical'}`;
    section.dataset.profileSection = key;
    section.append(text(personId === null ? 'h3' : 'h4', personId === null ? 'Campaign memory destination' : 'Person memory destination'), text('p', 'Entries are saved here after a reviewed scene is published.'), text('p', destination ? `Saved destination: ${destination.id}. External availability has not been checked.`
        : 'Destination missing. Accepted memory stays pending until a destination is configured and publication succeeds.'), text('p', 'Changing this destination affects future publications. Older publications keep their recorded destinations; history is not moved.'));
    if (!controls.conditionalStorage)
        section.append(text('p', 'This host does not support atomic conditional writing; memory writes verify the recorded expectation before saving via setJson.'));
    const draft = session.draft;
    if (draft?.command.kind !== 'bind-memory' || draft.command.personId !== personId) {
        const edit = button(destination ? 'Change memory destination' : 'Set memory destination', `${key}:edit`, controls.begin);
        edit.disabled = !session.canBegin;
        section.append(edit);
    }
    else {
        const form = document.createElement('form');
        form.className = 'mc-field-editor';
        form.onsubmit = event => { event.preventDefault(); void session.save(); };
        const label = text('label', 'Journal destination ID');
        const input = document.createElement('input');
        input.className = 'text_pole';
        input.required = true;
        input.dataset.profileFocus = `${key}:id`;
        input.value = draft.command.bookId;
        input.disabled = !session.editable;
        label.append(input);
        const save = button('Save memory destination', `${key}:save`, () => { });
        save.type = 'submit';
        save.disabled = !session.canSave;
        const cancel = button('Cancel destination edit', `${key}:cancel`, () => session.cancel());
        cancel.disabled = session.busy;
        input.oninput = () => { session.updateMemoryDestination(input.value); save.disabled = !session.canSave; };
        const status = text('p', session.message);
        status.setAttribute('role', 'status');
        form.append(label, save, cancel, status);
        section.append(form);
    }
    root.append(section);
}
