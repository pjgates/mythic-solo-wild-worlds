import { element, button, input } from "./card-controls.js";
export function renderInjurySuggestions(session) {
    const section = element('section');
    section.className = 'mc-injury-wording';
    if (!session.item) {
        section.hidden = true;
        return section;
    }
    section.setAttribute('aria-label', 'Injury wording');
    section.append(element('h4', session.editing ? 'Describe the injury' : 'Suggested injury'));
    const hint = element('p', `Harm saved · ${session.item.injury.boxes} healing boxes. Wording adds no mechanical penalty.`);
    hint.className = 'mc-hint';
    section.append(hint);
    if (session.editing) {
        const name = input(section, 'Injury name', true);
        name.maxLength = 100;
        name.value = session.wording?.name ?? '';
        name.disabled = !session.ready;
        const label = element('label', 'Description');
        const description = document.createElement('textarea');
        description.className = 'text_pole';
        description.required = true;
        description.maxLength = 600;
        description.rows = 3;
        description.value = session.wording?.description ?? '';
        description.disabled = !session.ready;
        label.append(description);
        section.append(label);
        const update = () => { session.wording = { name: name.value, description: description.value }; };
        name.oninput = update;
        description.oninput = update;
    }
    else if (session.wording) {
        section.append(element('h5', session.wording.name));
        const prose = element('p', session.wording.description);
        prose.className = 'mc-prose';
        section.append(prose);
    }
    const status = element('p', session.busy ? 'Finding wording for the injury…' : session.message
        || (!session.configured && !session.wording ? 'Write a description, or keep the generic injury. AI suggestions use your draft connection in Extensions → Minor Character.' : ''));
    status.className = 'mc-hint';
    status.setAttribute('role', 'status');
    section.append(status);
    const actions = element('div');
    actions.className = 'mc-actions';
    const action = (label, run, primary = false) => {
        const control = button(label, primary ? 'menu_button mc-primary' : 'menu_button');
        control.disabled = !session.ready;
        control.onclick = run;
        actions.append(control);
        return control;
    };
    if (session.wording)
        action(session.editing ? 'Save wording' : 'Use this', async () => {
            // Read the current controls as well as input events (autofill and assistive technology may set values directly).
            if (session.editing) {
                const name = section.querySelector('input'), description = section.querySelector('textarea');
                session.wording = { name: name.value, description: description.value };
            }
            await session.save();
        }, true);
    if (!session.editing)
        action('Rewrite', () => {
            const parent = section.parentElement;
            session.rewrite();
            parent?.querySelector('.mc-injury-wording input')?.focus();
        });
    action('Keep generic', () => session.save(true));
    if (!session.busy && !session.wording && session.configured)
        action('Suggest wording', () => session.suggest());
    section.append(actions);
    return section;
}
