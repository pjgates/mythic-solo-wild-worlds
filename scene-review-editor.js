export function appendSceneReviewEditor(root, view, draft, session) {
    const form = document.createElement('fieldset');
    form.disabled = !session.editable;
    const legend = document.createElement('legend');
    legend.textContent = 'Edit review';
    form.append(legend);
    const proposal = draft.review.proposal;
    const sections = ['overview', 'personality', 'background', 'nathan-background', 'relationships', 'concerns'];
    const people = view.profiles.map(profile => [profile.personId, profile.name]);
    const sources = draft.review.source.messages.map((message, index) => [String(index), `#${index + 1} · ${message.speaker}`]);
    const write = (change) => { if (session.editable && session.draft === draft)
        change(); };
    function field(parent, label, key, input) {
        const wrapper = document.createElement('label');
        wrapper.textContent = label;
        input.dataset.reviewField = key;
        wrapper.append(input);
        parent.append(wrapper);
    }
    function prose(parent, label, key, value, change) {
        const input = document.createElement('textarea');
        input.value = value;
        input.rows = 3;
        input.oninput = () => write(() => change(input.value));
        field(parent, label, key, input);
    }
    function choice(parent, label, key, values, options, multiple, change) {
        const input = document.createElement('select');
        input.multiple = multiple;
        if (multiple)
            input.size = Math.min(4, Math.max(2, options.length));
        for (const [id, name] of options)
            input.add(new Option(name, id, false, values.includes(id)));
        input.onchange = () => write(() => change([...input.selectedOptions].map(option => option.value)));
        field(parent, label, key, input);
    }
    function peopleField(parent, label, key, values, change) {
        choice(parent, label, key, values, people, true, change);
    }
    function evidence(parent, key, values, change) {
        choice(parent, 'Supporting sources (required for claims)', key, values.map(String), sources, true, selected => change(selected.map(Number)));
    }
    function action(parent, label, run) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button';
        button.dataset.reviewField = `${parent.dataset.reviewRow ?? 'form'}:${label}`;
        button.textContent = label;
        button.onclick = () => session.edit(run);
        parent.append(button);
    }
    prose(form, 'Scene summary', 'summary', proposal.summary, value => { proposal.summary = value; });
    peopleField(form, 'Participants', 'participants', proposal.participants, value => { proposal.participants = value; });
    const hint = document.createElement('p');
    hint.textContent = 'Choose multiple people or sources with the standard multi-select controls. Knowledge additions are explicit suggestions.';
    form.append(hint);
    proposal.events.forEach((event, index) => {
        const row = document.createElement('fieldset'), legend = document.createElement('legend');
        row.dataset.reviewRow = `event-${index}`;
        legend.textContent = `Event ${index + 1}`;
        row.append(legend);
        prose(row, 'Event text', `event-${index}-text`, event.text, value => { event.text = value; });
        peopleField(row, 'People involved', `event-${index}-people`, event.personIds, value => { event.personIds = value; });
        peopleField(row, 'Proposed knowledge additions', `event-${index}-knowledge`, event.knownByAdditions, value => { event.knownByAdditions = value; });
        evidence(row, `event-${index}-sources`, event.sourceIndices, value => { event.sourceIndices = value; });
        action(row, `Reject event ${index + 1}`, () => { proposal.events.splice(index, 1); });
        form.append(row);
    });
    proposal.profileChanges.forEach((change, index) => {
        const row = document.createElement('fieldset'), legend = document.createElement('legend');
        row.dataset.reviewRow = `profile-${index}`;
        legend.textContent = `Profile suggestion ${index + 1} · ${people.find(([id]) => id === change.personId)[1]}`;
        row.append(legend);
        const entry = change.replacement, before = draft.review.profileBefore[index];
        if (before && !sections.some(section => section === before.section)) {
            const note = document.createElement('p');
            note.textContent = `Existing section “${before.section}” is outside the reviewed sections. Choose the proposed section explicitly.`;
            row.append(note);
        }
        if (entry) {
            prose(row, 'Proposed profile text', `profile-${index}-text`, entry.text, value => { entry.text = value; });
            choice(row, 'Profile section', `profile-${index}-section`, [entry.section], sections.map(value => [value, value]), false, values => { entry.section = values[0]; });
            choice(row, 'Claim status', `profile-${index}-status`, [entry.status], [['established', 'Established fact'], ['recollection', 'Nathan’s recollection'], ['unconfirmed', 'Unconfirmed claim']], false, values => { entry.status = values[0]; });
            peopleField(row, 'Related people', `profile-${index}-people`, entry.relatedPersonIds, value => { entry.relatedPersonIds = value; });
            peopleField(row, 'Proposed knowledge additions', `profile-${index}-knowledge`, change.knownByAdditions, value => { change.knownByAdditions = value; });
            evidence(row, `profile-${index}-sources`, entry.sourceIndices, value => { entry.sourceIndices = value; });
            if (change.entryId !== null)
                action(row, 'Propose deleting this entry instead', () => {
                    change.replacement = null;
                    change.knownByAdditions = [];
                });
        }
        else {
            const note = document.createElement('p');
            note.textContent = 'This suggestion deletes the existing entry.';
            row.append(note);
        }
        action(row, `Reject profile suggestion ${index + 1}`, () => {
            proposal.profileChanges.splice(index, 1);
            draft.review.profileBefore.splice(index, 1);
        });
        form.append(row);
    });
    action(form, 'Add event suggestion', () => {
        proposal.events.push({ text: '', personIds: [], sourceIndices: [], knownByAdditions: [] });
    });
    const owner = document.createElement('select'), target = document.createElement('select');
    for (const [id, name] of people)
        owner.add(new Option(name, id));
    const updateTargets = () => {
        target.replaceChildren(new Option('New profile entry', ''));
        for (const entry of view.profiles.find(profile => profile.personId === owner.value).entries) {
            target.add(new Option(entry.text, entry.id));
        }
    };
    owner.onchange = updateTargets;
    updateTargets();
    field(form, 'Person for a profile suggestion', 'new-profile-owner', owner);
    field(form, 'Profile entry to suggest changing', 'new-profile-target', target);
    action(form, 'Add profile suggestion', () => {
        const before = view.profiles.find(profile => profile.personId === owner.value).entries.find(entry => entry.id === target.value);
        proposal.profileChanges.push({ personId: owner.value, entryId: before?.id ?? null, knownByAdditions: [], replacement: {
                section: sections.find(section => section === before?.section) ?? 'overview',
                text: before?.text ?? '', status: before?.status ?? 'established',
                relatedPersonIds: [...(before?.relatedPersonIds ?? [])], sourceIndices: [],
            } });
        draft.review.profileBefore.push(before ? { section: before.section, text: before.text,
            status: before.status, relatedPersonIds: [...before.relatedPersonIds] } : null);
    });
    root.append(form);
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'menu_button';
    save.dataset.reviewField = 'save-review';
    save.textContent = 'Save review changes';
    save.disabled = !session.canSave;
    save.onclick = () => { void session.save(draft); };
    root.append(save);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = session.message || (!session.current ? 'This review changed. Reopen the current review before editing.' : 'Edits are not accepted scene facts.');
    root.append(status);
}
