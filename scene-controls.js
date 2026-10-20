export function createSceneControls(model, session, connections, available, ready, start, persist = () => { }) {
    const element = document.createElement('section');
    element.setAttribute('aria-label', 'Scene GM');
    element.innerHTML = `<h3>End scene</h3>
    <label>Scene GM connection <select data-gm-connection><option value="">Choose a connection…</option></select></label>
    <label>Scene GM model ID <input class="text_pole" data-gm-model placeholder="Enter the model ID" autocomplete="off"></label>
    <div class="mc-actions"><button type="button" class="menu_button" data-gm-refresh>Refresh connections</button>
      <button type="button" class="menu_button" data-gm-request>End scene</button>
      <button type="button" class="menu_button" data-gm-manual>Draft scene manually</button>
      <button type="button" class="menu_button" data-gm-cancel>Cancel request</button></div>
    <p data-gm-status role="status" aria-live="polite"></p>`;
    const connection = element.querySelector('[data-gm-connection]');
    const modelId = element.querySelector('[data-gm-model]');
    const refreshButton = element.querySelector('[data-gm-refresh]');
    const request = element.querySelector('[data-gm-request]');
    const cancel = element.querySelector('[data-gm-cancel]');
    const status = element.querySelector('[data-gm-status]');
    const manual = element.querySelector('[data-gm-manual]');
    let setup = available ? 'Choose a saved connection and enter a model ID.' : 'GM setup unavailable in this host. Sheet and manual play remain available.';
    let listing = 0;
    function render() {
        request.disabled = !available || !ready() || session.busy || !model.selection.connectionId || !model.selection.modelId.trim();
        manual.disabled = !ready() || session.busy;
        cancel.hidden = !session.busy;
        refreshButton.disabled = !available;
        status.textContent = session.message || setup;
    }
    function select() {
        const selection = { connectionId: connection.value, modelId: modelId.value };
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
        render();
    }
    connection.onchange = select;
    modelId.oninput = select;
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
    return { element, render, refresh, sync };
}
