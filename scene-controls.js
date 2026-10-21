export function createSceneControls(model, session, connections, available, ready, start, persist = () => { }) {
    const element = document.createElement('section');
    element.setAttribute('aria-label', 'Scene GM');
    const settingsElement = document.createElement('section');
    settingsElement.setAttribute('aria-label', 'Scene GM connection');
    settingsElement.innerHTML = `<h3>Scene GM connection</h3>
    <label>Scene GM connection <select data-gm-connection><option value="">Choose a connection…</option></select></label>
    <label>Scene GM model ID <input class="text_pole" data-gm-model placeholder="Enter the model ID" autocomplete="off"></label>
    <label>Scene GM Anthropic workspace ID <input class="text_pole" data-gm-workspace placeholder="wrkspc_… (optional, for unscoped Claude keys)" autocomplete="off" inputmode="text"></label>
    <div class="mc-actions"><button type="button" class="menu_button" data-gm-refresh>Refresh connections</button></div>
    <p data-gm-setup-status role="status" aria-live="polite"></p>`;
    element.innerHTML = `<h3>End scene</h3>
    <p class="mc-hint" data-gm-hint>Configure the scene GM in Extensions → Minor Character. You can also draft the scene manually.</p>
    <div class="mc-actions">
      <button type="button" class="menu_button" data-gm-request>End scene</button>
      <button type="button" class="menu_button" data-gm-manual>Draft scene manually</button>
      <button type="button" class="menu_button" data-gm-cancel>Cancel request</button></div>
    <p data-gm-status role="status" aria-live="polite"></p>`;
    const connection = settingsElement.querySelector('[data-gm-connection]');
    const modelId = settingsElement.querySelector('[data-gm-model]');
    const workspaceId = settingsElement.querySelector('[data-gm-workspace]');
    const refreshButton = settingsElement.querySelector('[data-gm-refresh]');
    const setupStatus = settingsElement.querySelector('[data-gm-setup-status]');
    const request = element.querySelector('[data-gm-request]');
    const cancel = element.querySelector('[data-gm-cancel]');
    const status = element.querySelector('[data-gm-status]');
    const manual = element.querySelector('[data-gm-manual]');
    let setup = available ? 'Choose a saved connection and enter a model ID.' : 'GM setup unavailable in this host. Sheet and manual play remain available.';
    let listing = 0;
    function render() {
        element.querySelector('[data-gm-hint]').hidden = !!model.selection.connectionId && !!model.selection.modelId.trim();
        request.disabled = !available || !ready() || session.busy || !model.selection.connectionId || !model.selection.modelId.trim();
        manual.disabled = !ready() || session.busy;
        cancel.hidden = !session.busy;
        refreshButton.disabled = !available;
        setupStatus.textContent = setup;
        status.textContent = session.message || (!model.selection.connectionId || !model.selection.modelId.trim()
            ? 'No scene GM configured. Draft manually, or choose a connection in Extensions → Minor Character.' : '');
    }
    function select() {
        const trimmedWorkspace = workspaceId.value.trim();
        const selection = { connectionId: connection.value, modelId: modelId.value,
            ...(trimmedWorkspace ? { workspaceId: trimmedWorkspace } : {}) };
        model.select(selection);
        session.invalidate();
        persist(selection);
        render();
    }
    /** Reflects a selection restored from saved settings; the model already holds it. */
    function sync() {
        const selected = model.selection;
        if (selected.connectionId && ![...connection.querySelectorAll('option')].some(option => option.value === selected.connectionId)) {
            connection.add(new Option('Selected connection unavailable', selected.connectionId));
        }
        connection.value = selected.connectionId;
        modelId.value = selected.modelId;
        workspaceId.value = selected.workspaceId ?? '';
        render();
    }
    connection.onchange = select;
    modelId.oninput = select;
    workspaceId.oninput = select;
    request.onclick = () => { void start(false); };
    manual.onclick = () => { void start(true); };
    cancel.onclick = () => session.invalidate();
    async function refresh() {
        if (!available || !connections)
            return;
        const epoch = ++listing;
        setup = 'Loading saved connections…';
        render();
        try {
            const result = await connections.list();
            if (epoch !== listing)
                return;
            const selected = model.selection.connectionId;
            connection.replaceChildren(new Option('Choose a connection…', ''));
            for (const entry of result.connections)
                connection.add(new Option(`${entry.displayName} (${entry.chatCompletionSource})`, entry.id));
            if (selected && !result.connections.some(entry => entry.id === selected))
                connection.add(new Option('Selected connection unavailable', selected));
            connection.value = selected;
            setup = result.connections.length ? 'Choose a saved connection and enter a model ID.' : 'No saved connections. Add a supported connection in host settings, then refresh.';
        }
        catch {
            if (epoch === listing)
                setup = 'Saved GM connections could not be loaded. Sheet and manual play remain available.';
        }
        render();
    }
    refreshButton.onclick = () => { session.invalidate(); void refresh(); };
    render();
    return { element, settingsElement, render, refresh, sync };
}
