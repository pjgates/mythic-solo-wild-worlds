const text = (tag, value) => {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
};
/** Cast members still in play plus the stored threads: what an empty pair of Mythic lists starts from. */
export function seedNames(view) {
    const retired = new Set(view.profiles.filter(profile => profile.retired).map(profile => profile.personId));
    return {
        characters: view.campaignDetails.characters.filter(entry => !retired.has(entry.id)).map(entry => entry.name),
        threads: view.campaignDetails.threads.map(entry => entry.name),
    };
}
export function renderMythicPanel(root, view, mythic, ready) {
    const panel = document.createElement('section');
    panel.className = 'mc-mythic';
    panel.setAttribute('aria-label', 'Mythic GME');
    panel.append(text('h4', 'Mythic GME'));
    const state = mythic.state;
    if (!mythic.present)
        panel.append(text('p', 'Mythic GME extension not detected. Chaos and threads come from the sheet.'));
    else if (!state)
        panel.append(text('p', 'Mythic GME has no state for this chat yet. Open its drawer once to create it.'));
    else {
        panel.append(text('p', `Chaos Factor ${state.chaosFactor} · scene ${state.sceneCount} · ${state.lists.characters.length} characters, ${state.lists.threads.length} threads on the lists.`));
        if (mythic.canSeed || mythic.busy) {
            const names = seedNames(view);
            const seed = document.createElement('button');
            seed.type = 'button';
            seed.className = 'menu_button';
            seed.dataset.mythicSeed = '';
            seed.textContent = `Seed Mythic lists from the campaign (${names.characters.length} characters, ${names.threads.length} threads)`;
            seed.disabled = !ready() || !mythic.canSeed;
            seed.onclick = () => { void mythic.seed(seedNames(view)); };
            panel.append(seed, text('small', 'Adds the cast still in play and the recorded threads to Mythic’s empty Adventure Lists. Nothing is written to Sera’s journal.'));
        }
    }
    if (mythic.message) {
        const status = text('p', mythic.message);
        status.setAttribute('role', 'status');
        status.dataset.mythicStatus = '';
        panel.append(status);
    }
    root.append(panel);
}
