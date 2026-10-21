/** Small DOM builders shared by the inline action card and its sub-cards. Controls tagged `draft` survive re-renders. */
export const element = (tag, text = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
};
export const button = (text, className = 'menu_button') => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = text;
    return node;
};
export function select(form, label, values, draft) {
    const wrapper = element('label', label);
    const control = document.createElement('select');
    values.forEach(([value, text]) => control.add(new Option(text, value)));
    if (draft)
        control.dataset.draft = draft;
    wrapper.append(control);
    form.append(wrapper);
    return control;
}
export function input(form, label, required = false, draft) {
    const wrapper = element('label', label);
    const control = document.createElement('input');
    control.className = 'text_pole';
    control.required = required;
    if (draft)
        control.dataset.draft = draft;
    wrapper.append(control);
    form.append(wrapper);
    return control;
}
export function checkbox(form, label, draft) {
    const wrapper = element('label', label);
    wrapper.className = 'mc-checkbox';
    const control = document.createElement('input');
    control.type = 'checkbox';
    if (draft)
        control.dataset.draft = draft;
    wrapper.prepend(control);
    form.append(wrapper);
    return control;
}
export function form(className) {
    const node = document.createElement('form');
    node.className = className;
    node.onsubmit = event => event.preventDefault();
    return node;
}
export function details(className, summary, draft) {
    const node = document.createElement('details');
    node.className = className;
    if (draft)
        node.dataset.draft = draft;
    node.append(element('summary', summary));
    return node;
}
/**
 * A radio group drawn as chips (`mc-chips`) or a segmented control (`mc-segmented`). Each option is a real
 * radio inside its own label, so keyboard, focus and screen-reader behaviour come from the browser.
 */
export function choiceGroup(parent, legend, name, choices, style, initial = '', draft = name) {
    const root = document.createElement('fieldset');
    root.className = `mc-choice mc-${style}`;
    root.dataset.choice = name;
    root.append(element('legend', legend));
    const row = element('div');
    row.className = 'mc-choice-options';
    const inputs = [];
    for (const choice of choices) {
        const label = document.createElement('label');
        label.className = 'mc-choice-option';
        const control = document.createElement('input');
        control.type = 'radio';
        control.name = `mc-${name}`;
        control.value = choice.value;
        control.checked = choice.value === initial;
        control.dataset.draft = draft;
        const text = element('span', choice.label);
        text.className = 'mc-choice-label';
        label.append(control, text);
        if (choice.hint) {
            const hint = element('span', choice.hint);
            hint.className = 'mc-choice-hint';
            label.append(hint);
        }
        inputs.push(control);
        row.append(label);
    }
    root.append(row);
    parent.append(root);
    return { root, inputs,
        get value() { return inputs.find(control => control.checked)?.value ?? ''; },
        set value(next) { for (const control of inputs)
            control.checked = control.value === next; } };
}
/** A checkbox drawn as a full-width toggle row with a quieter cost on the right. */
export function toggle(parent, label, hint, draft) {
    const wrapper = element('label');
    wrapper.className = 'mc-toggle';
    const control = document.createElement('input');
    control.type = 'checkbox';
    if (draft)
        control.dataset.draft = draft;
    const text = element('span', label);
    text.className = 'mc-toggle-label';
    const cost = element('span', hint);
    cost.className = 'mc-toggle-hint';
    wrapper.append(control, text, cost);
    parent.append(wrapper);
    return control;
}
/** A row of die outlines: `count` dice, the last `cut` of them dashed as removed before reading. */
export function diceMeter(count, cut, label) {
    const row = element('span');
    row.className = 'mc-dice-meter';
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', label);
    for (let index = 0; index < Math.max(count, 1); index++) {
        const die = element('span');
        die.className = count === 0 ? 'mc-die mc-die-fallback' : index >= count - cut ? 'mc-die mc-die-cut' : 'mc-die';
        row.append(die);
    }
    return row;
}
/** A small pill; `tone` picks the accent. */
export function pill(text, tone = 'plain') {
    const node = element('span', text);
    node.className = `mc-pill mc-pill-${tone}`;
    return node;
}
const isToggle = (control) => {
    const type = control.type;
    return type === 'checkbox' || type === 'radio';
};
// A radio shares its draft name with its siblings, so each option is remembered under name=value.
const draftKey = (control) => control.type === 'radio'
    ? `${control.dataset.draft}=${control.value}` : control.dataset.draft;
/** Snapshot every tagged control (and open disclosure) before the card is rebuilt. */
export function captureDrafts(root) {
    const values = {};
    for (const control of root.querySelectorAll('[data-draft]')) {
        values[draftKey(control)] = control.tagName === 'DETAILS' ? control.open
            : isToggle(control) ? control.checked : control.value;
    }
    return values;
}
/** Re-apply a snapshot; controls that no longer exist are ignored, untouched controls keep their rendered defaults. */
export function restoreDrafts(root, values) {
    for (const control of root.querySelectorAll('[data-draft]')) {
        const value = values[draftKey(control)];
        if (value === undefined)
            continue;
        if (control.tagName === 'DETAILS')
            control.open = value === true;
        else if (isToggle(control))
            control.checked = value === true;
        else
            control.value = String(value);
    }
}
