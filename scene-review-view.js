import { appendSceneReviewEditor } from "./scene-review-editor.js";
const text = (tag, value) => {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
};
const statuses = { established: 'Established fact', recollection: 'Nathan’s recollection', unconfirmed: 'Unconfirmed claim' };
const sections = { overview: 'Overview', personality: 'Personality', background: 'Background',
    'nathan-background': 'Nathan’s background', relationships: 'Relationships', concerns: 'Current concerns' };
const sceneEnds = [['in', 'In control · Chaos Factor −1'], ['out', 'Out of control · Chaos Factor +1'],
    ['open', 'Leave the Mythic scene open']];
function mythicStatus(root, mythic) {
    if (!mythic?.message)
        return;
    const status = text('p', mythic.message);
    status.setAttribute('role', 'status');
    status.dataset.mythicStatus = '';
    root.append(status);
}
/** Only while Mythic holds state for this chat: the acceptance also ends the Mythic scene unless the player opts out. */
function mythicSceneEnd(region, mythic) {
    const state = mythic?.state;
    if (!mythic || !state)
        return;
    const group = document.createElement('fieldset');
    group.className = 'mc-mythic-scene-end';
    group.append(text('legend', `Mythic GME · Chaos Factor ${state.chaosFactor}, scene ${state.sceneCount}`));
    for (const [value, label] of sceneEnds) {
        const option = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'mc-mythic-scene-end';
        radio.value = value;
        radio.checked = mythic.sceneEnd === value;
        radio.dataset.reviewField = `mythic-${value}`;
        radio.onchange = () => { mythic.sceneEnd = value; };
        option.append(radio, document.createTextNode(` ${label}`));
        group.append(option);
    }
    group.append(text('small', 'Accepting the scene records it in Sera’s journal first, then ends the Mythic scene.'));
    region.append(group);
}
export function renderSceneReview(root, view, session, mythic) {
    const review = session.draft?.review ?? view.sceneReview;
    if (!review) {
        if (!session.message) {
            mythicStatus(root, mythic);
            return;
        }
        const status = text('p', session.message);
        status.setAttribute('role', 'status');
        status.dataset.reviewField = 'review-status';
        status.tabIndex = -1;
        root.append(status);
        mythicStatus(root, mythic);
        if (session.pendingOperation) {
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'menu_button';
            retry.textContent = 'Retry saved scene operation';
            retry.disabled = !session.canRetry;
            retry.onclick = () => { void session.retry(); };
            root.append(retry);
        }
        return;
    }
    const region = document.createElement('section');
    region.className = 'mc-scene-review';
    region.setAttribute('aria-label', 'Scene review');
    region.tabIndex = -1;
    region.dataset.reviewField = 'review-region';
    const names = (ids) => ids.map(id => view.profiles.find(profile => profile.personId === id).name).join(', ') || 'None';
    const evidence = (indices) => text('p', `Supporting sources: ${indices.map(index => `#${index + 1}`).join(', ')}`);
    const prose = (entry) => {
        const group = document.createElement('div');
        group.append(text('p', `${statuses[entry.status]} · ${sections[entry.section] ?? entry.section}`), text('p', entry.text), text('p', `Related people: ${names(entry.relatedPersonIds)}`));
        return group;
    };
    region.append(text('h3', `Review scene ${view.play.scene.number}`), text('p', 'Pending review. The scene stays open until you accept it.'), text('h4', 'Summary'), text('p', review.proposal.summary || 'No summary yet.'), text('h4', 'Participants'), text('p', names(review.proposal.participants)), text('p', 'Presence does not establish what a person knows.'), text('h4', 'Events'));
    if (!review.proposal.events.length)
        region.append(text('p', 'No event suggestions.'));
    for (const event of review.proposal.events) {
        const row = document.createElement('article');
        row.append(text('p', event.text), text('p', `People involved: ${names(event.personIds)}`), text('p', `Proposed knowledge additions: ${names(event.knownByAdditions)}`), evidence(event.sourceIndices));
        region.append(row);
    }
    region.append(text('h4', 'Profile changes'));
    if (!review.proposal.profileChanges.length)
        region.append(text('p', 'No profile change suggestions.'));
    review.proposal.profileChanges.forEach((change, index) => {
        const row = document.createElement('article');
        row.append(text('h5', names([change.personId])), text('h6', 'Before'));
        const before = review.profileBefore[index];
        row.append(before ? prose(before) : text('p', 'New profile entry.'), text('h6', 'Proposed change'));
        if (change.replacement)
            row.append(prose(change.replacement), evidence(change.replacement.sourceIndices));
        else
            row.append(text('p', 'Delete this profile entry.'));
        row.append(text('p', `Proposed knowledge additions: ${names(change.knownByAdditions)}`));
        region.append(row);
    });
    const sources = document.createElement('details');
    sources.append(text('summary', `Supporting scene sources (${review.source.messages.length})`));
    if (!review.source.messages.length)
        sources.append(text('p', 'This scene has no source messages.'));
    review.source.messages.forEach((message, index) => {
        sources.append(text('h4', `#${index + 1} · ${message.speaker}`), text('blockquote', message.text));
    });
    region.append(sources);
    if (review.profilesChanged) {
        const warning = text('p', 'Affected profiles changed. This review cannot be saved or accepted; regenerate or cancel it.');
        warning.setAttribute('role', 'status');
        region.append(warning);
    }
    if (session.draft)
        appendSceneReviewEditor(region, view, session.draft, session);
    mythicSceneEnd(region, mythic);
    const actions = document.createElement('div');
    actions.className = 'mc-actions';
    let accept;
    for (const [label, enabled, action] of [
        ['Accept scene', session.canAccept, () => session.act('accept')],
        ['Cancel review · keep scene open', session.canCancel, () => session.act('cancel')],
        ['Regenerate scene proposal', session.canCancel && session.regenerationAvailable, () => session.act('cancel', true)],
        ['Retry saved scene operation', session.canRetry, () => session.retry()],
    ]) {
        if (label === 'Retry saved scene operation' && !session.pendingOperation)
            continue;
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'menu_button';
        if (label === 'Accept scene')
            accept = control;
        control.dataset.reviewField = label;
        control.textContent = label;
        control.disabled = !enabled;
        control.onclick = () => { void action(); };
        actions.append(control);
    }
    const advice = text('p', 'Save review changes before accepting. A changed source or affected profile requires regeneration or cancellation.');
    const update = () => { accept.disabled = !session.canAccept; advice.hidden = session.canAccept; };
    region.oninput = update;
    region.onchange = update;
    update();
    region.append(advice);
    region.append(actions);
    if (!session.regenerationAvailable)
        region.append(text('p', 'Choose a GM connection and model to regenerate, or cancel and draft manually.'));
    root.append(region);
}
