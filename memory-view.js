export function renderMemory(root, view, session) {
    if (!view.memoryPublications.length)
        return;
    const text = (tag, value) => {
        const element = document.createElement(tag);
        element.textContent = value;
        return element;
    };
    const section = document.createElement('section');
    section.className = 'mc-scene-publication';
    section.dataset.profileSection = 'memory-publication';
    section.setAttribute('aria-label', 'Memory publication');
    section.append(text('h3', 'Memory publication'));
    const status = text('p', session.message || session.status);
    status.setAttribute('role', 'status');
    status.dataset.profileFocus = 'memory-status';
    status.tabIndex = -1;
    section.append(status);
    const button = (label, key, enabled, action) => {
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'menu_button';
        control.textContent = label;
        control.dataset.profileFocus = key;
        control.disabled = !enabled;
        control.onclick = action;
        section.append(control);
    };
    const review = session.review;
    if (review) {
        const heading = text('h4', 'Review memory conflict');
        heading.tabIndex = -1;
        heading.dataset.profileFocus = 'memory-review';
        section.append(heading, text('p', `Recorded destination: ${review.destination.id}`), text('p', `Accepted version: revision ${review.desired.acceptedRevision} · ${review.ref.acceptedOperationId}`), text('p', 'Both versions below are plain text. External text is not added to the campaign or narration.'), text('p', 'Replacement is allowed only while the exact external version shown here remains unchanged.'));
        const version = (label, document) => {
            const group = text('article', '');
            group.append(text('h5', label));
            if (document === null)
                group.append(text('p', 'No document exists at this recorded destination and key.'));
            else {
                group.append(text('pre', document.content));
                const { content: _content, ...identity } = document;
                const details = text('details', '');
                details.append(text('summary', 'Version details'), text('pre', JSON.stringify(identity, null, 2)));
                group.append(details);
            }
            section.append(group);
        };
        version('Accepted memory to publish', review.desired);
        version('External version observed', review.actual);
        button('Replace shown external version', 'memory-replace', session.canReplace, () => { void session.replace(); });
        button('Close comparison', 'memory-close', !session.busy, () => session.cancel());
    }
    else {
        button('Publish / Retry memory', 'memory-publish', session.canPublish, () => { void session.publish(); });
        if (session.hasConflict)
            button('Review memory conflict', 'memory-review', session.canReview, () => session.beginReview());
        section.append(text('p', 'Accepted scenes and corrections are saved first. Publication runs only when you request it.'));
    }
    root.append(section);
}
