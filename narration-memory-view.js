export function renderNarrationMemory(root, profiles, session) {
    const focused = document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement)
        ? document.activeElement.value : null;
    root.replaceChildren();
    root.className = 'mc-narration-memory';
    const fields = document.createElement('fieldset');
    fields.dataset.narrationRecipients = '';
    const legend = document.createElement('legend');
    legend.textContent = 'Actual narration recipients';
    fields.append(legend);
    for (const profile of profiles) {
        const label = document.createElement('label');
        label.className = 'mc-narration-person';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = profile.personId;
        input.checked = session.recipientIds.includes(profile.personId);
        const duplicate = profiles.some(other => other.personId !== profile.personId && other.name === profile.name);
        const name = `${profile.name}${profile.retired ? ' (retired)' : ''}${duplicate ? ` · ${profile.personId}` : ''}`;
        input.setAttribute('aria-label', `Narrate for ${name}`);
        input.onchange = () => session.select(input.checked ? [...session.recipientIds, profile.personId]
            : session.recipientIds.filter(id => id !== profile.personId));
        label.append(input, document.createTextNode(name));
        fields.append(label);
    }
    const note = document.createElement('p');
    note.textContent = 'One request uses only knowledge shared by every selected recipient. Selection never grants knowledge.';
    const status = document.createElement('p');
    status.dataset.narrationStatus = '';
    status.setAttribute('role', 'status');
    status.textContent = session.message;
    root.append(fields, note, status);
    if (focused)
        [...fields.querySelectorAll('input')].find(input => input.value === focused)?.focus({ preventScroll: true });
}
