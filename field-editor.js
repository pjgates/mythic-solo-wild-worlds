import { setDraftValue } from "./sheet-draft.js";
import { renderTrack } from "./sheet-track.js";
export function renderFieldEditor(root, field, value, changed) {
    const group = document.createElement('div');
    group.className = 'mc-field-editor';
    group.dataset.owner = field.ref.owner;
    group.dataset.entityId = field.ref.entityId;
    group.dataset.field = field.ref.field;
    if (field.ref.box !== undefined)
        group.dataset.box = String(field.ref.box);
    root.append(group);
    if (field.ref.owner === 'track') {
        const button = document.createElement('button');
        button.type = 'button';
        const choices = field.choices;
        const original = String(field.value);
        // A 44px tap target around a drawn box: clear, marked (/) or burned (×); a changed box carries a gold ring.
        function show() {
            const next = choices[(choices.indexOf(String(value)) + 1) % choices.length];
            button.className = `mc-track-editor mc-${value}${String(value) === original ? '' : ' mc-changed'}`;
            button.textContent = value === 'marked' ? '/' : value === 'burned' ? '×' : '';
            button.setAttribute('aria-label', `${field.label}: ${value}. Change to ${next}`);
        }
        button.onclick = () => {
            value = choices[(choices.indexOf(String(value)) + 1) % choices.length];
            show();
            changed(value);
        };
        show();
        group.append(button);
        return;
    }
    const label = document.createElement('label');
    label.textContent = field.ref.field.replace(/([a-z])([A-Z])/g, '$1 $2');
    let input;
    if (field.choices) {
        input = document.createElement('select');
        for (const choice of field.choices)
            input.add(new Option(choice, choice));
    }
    else if (typeof field.value === 'number') {
        input = document.createElement('input');
        input.type = 'number';
        input.step = '1';
        input.min = '0';
        input.required = true;
        if (field.ref.owner === 'skill' && field.ref.field === 'rank')
            input.max = '3';
    }
    else {
        input = document.createElement('textarea');
        input.rows = 2;
    }
    input.className = 'text_pole';
    input.setAttribute('aria-label', field.label);
    input.value = String(value ?? '');
    const readValue = () => typeof field.value === 'number' ? Number(input.value)
        : typeof field.value === 'boolean' ? input.value === 'true' : input.value;
    input.oninput = () => { if (input.checkValidity())
        changed(readValue()); };
    if (input instanceof HTMLInputElement && input.type === 'number') {
        // Ranks and counts change one step at a time; the number field stays for typing and validation.
        const stepper = document.createElement('span');
        stepper.className = 'mc-stepper';
        const step = (delta, text, name) => {
            const control = document.createElement('button');
            control.type = 'button';
            control.className = 'menu_button mc-step';
            control.textContent = text;
            control.setAttribute('aria-label', `${name} ${field.label}`);
            control.onclick = () => {
                const field = input;
                const min = field.min === '' ? -Infinity : Number(field.min), max = field.max === '' ? Infinity : Number(field.max);
                const next = Math.min(max, Math.max(min, Number(field.value || 0) + delta));
                field.value = String(next);
                field.oninput?.call(field, new Event('input'));
            };
            return control;
        };
        stepper.append(step(-1, '−', 'Lower'), input, step(1, '+', 'Raise'));
        label.append(stepper);
    }
    else
        label.append(input);
    group.append(label);
    if (['truth', 'spentOn', 'card'].includes(field.ref.field)) {
        const absentLabel = document.createElement('label');
        absentLabel.className = 'mc-field-absent';
        const absent = document.createElement('input');
        absent.type = 'checkbox';
        absent.setAttribute('aria-label', `${field.label} · No value`);
        absent.checked = value === null;
        input.disabled = absent.checked;
        absent.onchange = () => { input.disabled = absent.checked; changed(absent.checked ? null : readValue()); };
        absentLabel.append(absent, document.createTextNode('No value'));
        group.append(absentLabel);
    }
}
function draftValue(editor, field) {
    const change = editor.draft.changes.find(({ ref }) => ref.owner === field.ref.owner
        && ref.entityId === field.ref.entityId && ref.field === field.ref.field && ref.box === field.ref.box);
    return change ? change.value : field.value;
}
function changeField(editor, field, value) {
    setDraftValue(editor.draft, field.ref, value, field.value);
    editor.changed();
}
export function appendFieldEditors(root, view, editor, owner, ids, keys) {
    if (!editor)
        return;
    for (const field of view.editableFields.filter(field => field.ref.owner === owner
        && field.ref.entityId === JSON.stringify(ids) && (!keys || keys.includes(field.ref.field)))) {
        renderFieldEditor(root, field, draftValue(editor, field), value => changeField(editor, field, value));
    }
}
export function renderEditableTrack(root, name, track, trackId, view, editor) {
    if (!editor) {
        renderTrack(root, name, track);
        return;
    }
    const fields = view.editableFields.filter(field => field.ref.owner === 'track'
        && field.ref.entityId === JSON.stringify([view.characterId, trackId]));
    const value = { ...track, boxes: track.boxes.map((box, index) => {
            const field = fields.find(field => field.ref.box === index);
            return draftValue(editor, field);
        }) };
    renderTrack(root, name, value, (parent, index, updated) => {
        const field = fields.find(field => field.ref.box === index);
        renderFieldEditor(parent, field, draftValue(editor, field), next => {
            updated(next);
            changeField(editor, field, next);
        });
    });
}
