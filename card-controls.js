/** Small DOM builders shared by the inline action card and its sub-cards. Controls tagged `draft` survive re-renders. */
export const element = (tag, text = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
};
export const button = (text) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'menu_button';
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
/** Snapshot every tagged control (and open disclosure) before the card is rebuilt. */
export function captureDrafts(root) {
    const values = {};
    for (const control of root.querySelectorAll('[data-draft]')) {
        const name = control.dataset.draft;
        values[name] = control.tagName === 'DETAILS' ? control.open
            : control.type === 'checkbox' ? control.checked : control.value;
    }
    return values;
}
/** Re-apply a snapshot; controls that no longer exist are ignored, untouched controls keep their rendered defaults. */
export function restoreDrafts(root, values) {
    for (const control of root.querySelectorAll('[data-draft]')) {
        const value = values[control.dataset.draft];
        if (value === undefined)
            continue;
        if (control.tagName === 'DETAILS')
            control.open = value === true;
        else if (control.type === 'checkbox')
            control.checked = value === true;
        else
            control.value = String(value);
    }
}
