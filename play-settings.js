import { JevClient, JevFailure } from "./jev-client.js";
export const ROLES_NAMESPACE = 'minor-character-roles';
export const DEFAULT_TRIAGE_MODEL = 'typesafe/jev-1.14';
export const DEFAULT_PLAY_SETTINGS = { assisted: true, confirmAlways: false,
    decide: { connectionId: '', modelId: '' }, scene: { connectionId: '', modelId: '' },
    triage: { enabled: false, modelId: DEFAULT_TRIAGE_MODEL } };
const text = (value) => typeof value === 'string' ? value : '';
function readSelection(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const workspaceId = text(raw.workspaceId).trim();
    return { connectionId: text(raw.connectionId).trim(), modelId: text(raw.modelId).trim(),
        ...(workspaceId ? { workspaceId } : {}) };
}
function readTriageSettings(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return { enabled: raw.enabled === true, modelId: text(raw.modelId).trim() || DEFAULT_TRIAGE_MODEL };
}
/** Reads and writes `minor-character-roles`; unreadable or absent values fall back to defaults, never to another connection. */
export class PlaySettingsStore {
    #store;
    #settings = structuredClone(DEFAULT_PLAY_SETTINGS);
    #changed;
    constructor(store, changed = () => { }) { this.#store = store; this.#changed = changed; }
    get settings() { return structuredClone(this.#settings); }
    async load() {
        const next = structuredClone(DEFAULT_PLAY_SETTINGS);
        try {
            const [play, decide, scene, triage] = await Promise.all(['play', 'decide', 'scene', 'triage'].map(key => this.#store.tryGetJson({ namespace: ROLES_NAMESPACE, key })));
            if (play.found && play.value && typeof play.value === 'object') {
                const raw = play.value;
                if (typeof raw.assisted === 'boolean')
                    next.assisted = raw.assisted;
                if (typeof raw.confirmAlways === 'boolean')
                    next.confirmAlways = raw.confirmAlways;
            }
            if (decide.found)
                next.decide = readSelection(decide.value);
            if (scene.found)
                next.scene = readSelection(scene.value);
            if (triage.found)
                next.triage = readTriageSettings(triage.value);
        }
        catch { /* defaults stand */ }
        this.#settings = next;
        this.#changed();
        return this.settings;
    }
    async update(patch) {
        const next = { ...this.#settings, ...structuredClone(patch) };
        if (patch.decide)
            next.decide = readSelection(next.decide);
        if (patch.scene)
            next.scene = readSelection(next.scene);
        if (patch.triage)
            next.triage = readTriageSettings(next.triage);
        this.#settings = next;
        this.#changed();
        const writes = [];
        if (patch.assisted !== undefined || patch.confirmAlways !== undefined) {
            writes.push(this.#store.setJson({ namespace: ROLES_NAMESPACE, key: 'play', value: { assisted: next.assisted, confirmAlways: next.confirmAlways } }));
        }
        if (patch.decide)
            writes.push(this.#store.setJson({ namespace: ROLES_NAMESPACE, key: 'decide', value: readSelection(next.decide) }));
        if (patch.scene)
            writes.push(this.#store.setJson({ namespace: ROLES_NAMESPACE, key: 'scene', value: readSelection(next.scene) }));
        if (patch.triage)
            writes.push(this.#store.setJson({ namespace: ROLES_NAMESPACE, key: 'triage', value: next.triage }));
        await Promise.all(writes);
    }
}
/** What Test sends: no campaign content, one question Jev can answer about the request itself. */
const TEST_STATE = { system: 'Reply to a connection test.', user: 'ping' };
const TEST_QUESTIONS = { ok: { type: 'choice', instructions: 'Is this a connection test?', criteria: { yes: 'it is', no: 'it is not' } } };
/** The Play settings section: assisted play toggles, the triage reader and the draft role. Phone first: one stacked column, 48px rows. */
export function createPlaySettingsControls(host) {
    const element = document.createElement('section');
    element.className = 'mc-play-settings';
    element.setAttribute('aria-label', 'Play settings');
    element.innerHTML = `<h3>Play settings</h3>
    <label class="mc-checkbox"><input type="checkbox" data-play-assisted> Assisted play: read my messages and propose rolls</label>
    <label class="mc-checkbox"><input type="checkbox" data-play-confirm> Always confirm before rolling</label>
    <section class="mc-triage" aria-label="Triage (Jev)">
      <h4>Triage (Jev)</h4>
      <label>OpenRouter key <input type="password" class="text_pole" data-triage-key placeholder="Enter the OpenRouter key for this session" autocomplete="off" inputmode="text"></label>
      <div class="mc-triage-key-actions"><button type="button" class="menu_button" data-triage-show>Show</button><button type="button" class="menu_button" data-triage-clear>Clear</button></div>
      <label class="mc-checkbox"><input type="checkbox" data-triage-remember> Remember on this device</label>
      <p class="mc-role-note">The key is stored on this device in the extension store; use a dedicated OpenRouter key with a credit limit.</p>
      <label>Jev model ID <input class="text_pole" data-triage-model placeholder="typesafe/jev-1.14 or ~typesafe/jev-latest" autocomplete="off" inputmode="text"></label>
      <label class="mc-checkbox"><input type="checkbox" data-triage-enabled> Read messages with Jev first</label>
      <div class="mc-actions"><button type="button" class="menu_button" data-triage-test>Test</button></div>
      <p data-triage-status role="status" aria-live="polite"></p>
    </section>
    <label>Draft connection <select data-decide-connection><option value="">Manual play (no draft connection)</option></select></label>
    <label>Draft model ID <input class="text_pole" data-decide-model placeholder="Enter the model ID" autocomplete="off" inputmode="text"></label>
    <label>Draft Anthropic workspace ID <input class="text_pole" data-decide-workspace placeholder="wrkspc_… (optional, for unscoped Claude keys)" autocomplete="off" inputmode="text"></label>
    <div class="mc-actions"><button type="button" class="menu_button" data-roles-refresh>Refresh connections</button></div>
    <p data-roles-status role="status" aria-live="polite"></p>
    <p class="mc-role-note">Triage: Jev decides what each message is. Draft: the saved connection proposes the mechanics. Narrate: this chat’s own connection, chosen in the host’s API settings.</p>`;
    const assisted = element.querySelector('[data-play-assisted]');
    const confirm = element.querySelector('[data-play-confirm]');
    const connection = element.querySelector('[data-decide-connection]');
    const modelId = element.querySelector('[data-decide-model]');
    const workspaceId = element.querySelector('[data-decide-workspace]');
    const refreshButton = element.querySelector('[data-roles-refresh]');
    const status = element.querySelector('[data-roles-status]');
    const triageModel = element.querySelector('[data-triage-model]');
    const triageKey = element.querySelector('[data-triage-key]');
    const triageTest = element.querySelector('[data-triage-test]');
    const triageStatus = element.querySelector('[data-triage-status]');
    const triageShow = element.querySelector('[data-triage-show]');
    const triageClear = element.querySelector('[data-triage-clear]');
    const triageRemember = element.querySelector('[data-triage-remember]');
    const triageEnabled = element.querySelector('[data-triage-enabled]');
    const jev = host.jev ?? (options => new JevClient(options));
    let testing = false;
    let tested = '';
    let setup = host.available ? '' : 'Saved connections are unavailable in this host. Assisted play is off; manual play remains available.';
    let listing = 0;
    function describe(settings) {
        if (!host.available)
            return setup;
        if (!settings.assisted)
            return 'Assisted play is off: declare rolls from the card.';
        if (!settings.decide.connectionId || !settings.decide.modelId) {
            // Spec §10: triage alone is a supported mode, not a half-configured one.
            return settings.triage.enabled ? 'Jev reads each message first; without a draft connection, actions pause on a Jev-only proposal.'
                : 'Choose a draft connection and model, or play manually from the card.';
        }
        return setup || `Assisted play on${settings.confirmAlways ? ', confirming every roll' : ''}.`;
    }
    function render() {
        const settings = host.store.settings;
        assisted.checked = settings.assisted;
        confirm.checked = settings.confirmAlways;
        assisted.disabled = confirm.disabled = !host.available;
        connection.disabled = modelId.disabled = workspaceId.disabled = !host.available || !settings.assisted;
        if (![...connection.querySelectorAll('option')].some(option => option.value === settings.decide.connectionId)) {
            connection.add(new Option(settings.decide.connectionId ? 'Selected connection unavailable' : 'Manual play (no draft connection)', settings.decide.connectionId));
        }
        connection.value = settings.decide.connectionId;
        if (modelId.value !== settings.decide.modelId)
            modelId.value = settings.decide.modelId;
        if (workspaceId.value !== (settings.decide.workspaceId ?? ''))
            workspaceId.value = settings.decide.workspaceId ?? '';
        if (triageModel.value !== settings.triage.modelId)
            triageModel.value = settings.triage.modelId;
        if (triageKey.value !== host.secret.value)
            triageKey.value = host.secret.value;
        triageRemember.checked = host.secret.remembered;
        triageEnabled.checked = settings.triage.enabled;
        triageTest.disabled = testing;
        triageStatus.textContent = describeTriage();
        refreshButton.disabled = !host.available;
        status.textContent = describe(settings);
    }
    function describeTriage() {
        if (testing)
            return 'Testing…';
        if (tested)
            return tested;
        if (!host.secret.value)
            return 'Enter the OpenRouter key for this session.';
        return host.secret.remembered ? 'Key remembered on this device.' : 'Key held for this session.';
    }
    /** Commits whatever is in the key field; the value only ever travels through the secret. */
    const commitKey = () => host.secret.set(triageKey.value);
    async function runTest() {
        await commitKey();
        testing = true;
        tested = '';
        render();
        const started = performance.now();
        try {
            await jev({ apiKey: () => host.secret.value, model: host.store.settings.triage.modelId }).decide(TEST_STATE, TEST_QUESTIONS);
            tested = `Jev answered in ${Math.round(performance.now() - started)} ms`;
        }
        catch (error) {
            tested = error instanceof JevFailure ? error.message : 'Jev could not be tested.';
        }
        finally {
            testing = false;
            render();
        }
    }
    const save = (patch) => { void host.store.update(patch).then(() => host.applied(host.store.settings)).finally(render); };
    triageKey.onchange = () => { tested = ''; void commitKey().finally(render); };
    triageShow.onclick = () => {
        const shown = triageKey.type === 'password';
        triageKey.type = shown ? 'text' : 'password';
        triageShow.textContent = shown ? 'Hide' : 'Show';
    };
    triageClear.onclick = () => { tested = ''; return host.secret.clear().finally(render); };
    triageRemember.onchange = () => commitKey().then(() => host.secret.remember(triageRemember.checked)).finally(render);
    const saveTriage = () => save({ triage: { enabled: triageEnabled.checked, modelId: triageModel.value } });
    triageModel.onchange = saveTriage;
    triageEnabled.onchange = saveTriage;
    triageTest.onclick = () => runTest();
    assisted.onchange = () => save({ assisted: assisted.checked });
    confirm.onchange = () => save({ confirmAlways: confirm.checked });
    const saveDecide = () => save({ decide: { connectionId: connection.value, modelId: modelId.value, workspaceId: workspaceId.value } });
    connection.onchange = saveDecide;
    modelId.onchange = saveDecide;
    workspaceId.onchange = saveDecide;
    async function refresh() {
        if (!host.available || !host.connections)
            return;
        const epoch = ++listing;
        setup = 'Loading saved connections…';
        render();
        try {
            const result = await host.connections.list();
            if (epoch !== listing)
                return;
            connection.replaceChildren(new Option('Manual play (no draft connection)', ''));
            for (const entry of result.connections)
                connection.add(new Option(`${entry.displayName} (${entry.chatCompletionSource})`, entry.id));
            setup = result.connections.length ? '' : 'No saved connections. Add a supported connection in host settings, then refresh.';
        }
        catch {
            if (epoch === listing)
                setup = 'Saved connections could not be loaded. Manual play remains available.';
        }
        render();
    }
    refreshButton.onclick = () => { void refresh(); };
    render();
    return { element, render, refresh };
}
