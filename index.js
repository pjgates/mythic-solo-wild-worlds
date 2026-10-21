import { InjuryModel } from "./injury-model.js";
import { InjurySession } from "./injury-session.js";
import { NarrationMemory, MEMORY_PROMPT_KEY } from "./narration-memory.js";
import { NarratorProjection, NARRATOR_PROMPT_KEY } from "./narrator-projection.js";
import { renderNarrationMemory } from "./narration-memory-view.js";
import { EventCorrectionSession } from "./event-correction-session.js";
import { MemorySession } from "./memory-session.js";
import { journalMemoryAdapter } from "./memory-adapter.js";
import { renderMemory } from "./memory-view.js";
import { CastSession } from "./cast-session.js";
import { renderCast } from "./cast-view.js";
import { ProfileSession } from "./profile-session.js";
import { SceneReviewSession } from "./scene-review-session.js";
import { renderSceneReview } from "./scene-review-view.js";
import { renderPlayControls } from "./play-controls.js";
import { CorrectionSession } from "./correction-view.js";
import { renderActions, expandActionCard } from "./action-view.js";
import { CampaignController } from "./game/minor-character/controller.js";
import { hostStore } from "./game/minor-character/host-store.js";
import { renderSheet } from "./sheet.js";
import { createSheetShell } from "./sheet-shell.js";
import { createExtensionSettings, mountLauncher } from "./host-layout.js";
import { SceneSource } from "./scene-source.js";
import { SceneModel } from "./scene-model.js";
import { DecideModel } from "./decide-model.js";
import { JevClient } from "./jev-client.js";
import { TriageModel } from "./turn-triage.js";
import { TurnFlow } from "./turn-flow.js";
import { PlaySettingsStore, createPlaySettingsControls } from "./play-settings.js";
import { TriageSecret } from "./triage-secret.js";
import { SceneSession } from "./scene-session.js";
import { createSceneControls } from "./scene-controls.js";
import { MythicBridge, MYTHIC_READY_EVENT } from "./mythic-bridge.js";
import { renderMythicPanel, seedNames } from "./mythic-view.js";
import { renderCampaign } from "./campaign-view.js";
import { AgentAdmission } from "./agent-admission.js";
import { GitHubCheckpointSync } from "./github-sync.js";
let admitGeneration = async (_type) => false;
window.minorCharacterActionGuard = async (_chat, _size, abort, type = 'normal') => {
    try {
        if (!await admitGeneration(type))
            abort(true);
    }
    catch {
        abort(true);
    }
};
const launcher = document.createElement('button');
launcher.id = 'minor-character-launch';
launcher.className = 'menu_button mc-launcher';
launcher.textContent = 'Character';
launcher.setAttribute('aria-label', 'Character sheet');
const continueButton = document.createElement('button');
continueButton.id = 'minor-character-continue';
continueButton.className = 'menu_button mc-launcher';
continueButton.textContent = 'Continue Campaign';
continueButton.setAttribute('aria-label', 'Continue Campaign');
continueButton.hidden = true;
let destinationChanged = () => { };
const extensionSettings = createExtensionSettings('minor-character-settings', 'Return to Origin');
extensionSettings.mount();
const shell = createSheetShell(launcher, () => destinationChanged());
shell.content.innerHTML = `<p role="status" aria-live="polite" class="mc-panel-status">Starting…</p>
  <div class="mc-actions mc-campaign-setup">
    <button class="menu_button mc-primary" data-continue hidden disabled>Continue Campaign</button>
    <button class="menu_button mc-primary" data-create disabled>Create Return to Origin campaign</button>
    <button class="menu_button" data-reopen disabled>Reopen saved campaign</button>
  </div><div class="mc-sheet-body"></div>`;
const status = shell.content.querySelector('[role="status"]');
const agentNotice = document.createElement('p');
agentNotice.className = 'mc-hint';
agentNotice.setAttribute('role', 'status');
agentNotice.hidden = true;
extensionSettings.body.append(agentNotice);
const content = shell.content.querySelector('.mc-sheet-body');
const continueSetupButton = shell.content.querySelector('[data-continue]');
const create = shell.content.querySelector('[data-create]');
const reopen = shell.content.querySelector('[data-reopen]');
const setup = shell.content.querySelector('.mc-campaign-setup');
shell.mount();
mountLauncher(document.querySelector('#form_sheld'), continueButton);
const refKey = (ref) => JSON.stringify(ref.kind === 'group' ? ['group', ref.chatId] : ['character', ref.characterId, ref.fileName]);
try {
    await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
    const api = window.__TAURITAVERN__?.api;
    if (!api?.chat?.current?.handle || !api.extension?.store?.tryGetJson || !api.extension.store.setJson) {
        throw new Error('Required TauriTavern chat identity and extension storage are unavailable.');
    }
    const conditionalMemoryStorage = 'setJsonIf' in api.extension.store && typeof api.extension.store.setJsonIf === 'function';
    let boundRef = '';
    let stableId = '';
    const inline = document.createElement('section');
    inline.id = 'minor-character-actions';
    const context = window.SillyTavern.getContext();
    let request = 0;
    let writerActive = false;
    const handles = new Map();
    const resolveMetadata = (binding) => {
        const target = handles.get(binding);
        if (!target)
            throw new Error('Campaign chat handle is unavailable.');
        return target;
    };
    const controller = new CampaignController(hostStore(api.extension.store, resolveMetadata), render);
    const githubSync = new GitHubCheckpointSync(fetch, render);
    // Mythic GME loads after this extension (loading order 110 vs 100), so the API is looked up until it appears.
    const mythic = new MythicBridge({ resolve: () => window.MythicGME, binding: campaignBinding, changed: render });
    window.addEventListener(MYTHIC_READY_EVENT, () => { if (mythic.attach())
        render(); });
    const mythicPoll = setInterval(() => { if (mythic.attach()) {
        clearInterval(mythicPoll);
        render();
    } }, 1000);
    setTimeout(() => clearInterval(mythicPoll), 120_000);
    const corrections = new CorrectionSession(controller, capture, () => ready() && !eventSession.editing && !memorySession.busy && !sceneSession.busy && !sceneReview.busy && !writerActive && !profileSession.editing && !castSession.editing, render);
    const sceneSource = new SceneSource({
        read: () => {
            if (!ready())
                throw new Error('Chat changed or campaign unavailable.');
            return { binding: controller.state.binding, reference: refKey(api.chat.current.ref()), stableChatId: stableId,
                scene: controller.playerView?.play.scene, messages: window.SillyTavern.getContext().chat };
        },
        stableId: () => api.chat.current.handle().stableId(),
    });
    const gmAvailable = typeof api.llmConnections?.list === 'function' && typeof api.llmConnections?.load === 'function'
        && typeof context.ChatCompletionService?.sendRequest === 'function';
    const sceneModel = new SceneModel({
        current: () => {
            const view = controller.playerView;
            return gmReady() && view ? { binding: controller.state.binding, ...view.context, sceneId: view.play.scene.id } : undefined;
        },
        loadConnection: async (id) => (await api.llmConnections.load(id)).connection,
        sendRequest: (payload, extract, signal) => window.SillyTavern.getContext().ChatCompletionService.sendRequest(payload, extract, signal),
    }, sceneSource);
    const decideModel = new DecideModel({
        current: () => {
            const view = controller.playerView;
            return view && ready() ? { binding: controller.state.binding, ...view.context, sceneId: view.play.scene.id } : undefined;
        },
        loadConnection: async (id) => (await api.llmConnections.load(id)).connection,
        sendRequest: (payload, extract, signal) => window.SillyTavern.getContext().ChatCompletionService.sendRequest(payload, extract, signal),
    });
    const injuryModel = new InjuryModel({
        current: () => {
            const view = controller.playerView;
            return view && ready() ? { binding: controller.state.binding, ...view.context, sceneId: view.play.scene.id } : undefined;
        },
        loadConnection: async (id) => (await api.llmConnections.load(id)).connection,
        sendRequest: (payload, extract, signal) => window.SillyTavern.getContext().ChatCompletionService.sendRequest(payload, extract, signal),
    });
    const injurySession = new InjurySession(controller, injuryModel, capturePlay, playReady, render);
    const playSettings = new PlaySettingsStore(api.extension.store, () => render());
    // The triage key lives in memory for the session (spec §7); the store holds it only while Remember is on.
    const triageSecret = new TriageSecret(api.extension.store);
    // The key and model id are read on each call, so a Play settings change reaches the next message without rewiring.
    const triageModel = new TriageModel(new JevClient({ apiKey: () => triageSecret.value, model: () => playSettings.settings.triage.modelId }));
    const applyRoles = () => {
        const settings = playSettings.settings;
        decideModel.select(settings.decide);
        injuryModel.select(settings.decide);
        const scene = sceneModel.selection;
        if (scene.connectionId !== settings.scene.connectionId || scene.modelId !== settings.scene.modelId
            || (scene.workspaceId ?? '') !== (settings.scene.workspaceId ?? '')) {
            sceneModel.select(settings.scene);
            sceneSession.invalidate();
        }
    };
    const sceneSession = new SceneSession(sceneModel, sceneSource, controller, capture, sceneDraftReady, render);
    const sceneReview = new SceneReviewSession(controller, captureSceneOperation, reviewReady, render, () => startScene(false), () => gmAvailable && !!sceneModel.selection.connectionId && !!sceneModel.selection.modelId.trim());
    const profileSession = new ProfileSession(controller, capture, () => ready() && !eventSession.editing && !memorySession.busy && !castSession.editing && !corrections.editing && !sceneSession.busy && !sceneReview.busy && !writerActive, render);
    const castSession = new CastSession(controller, async (expected) => {
        const captured = await capture(expected);
        if (!castReady())
            throw new Error('Finish the current operation before changing the cast.');
        return captured;
    }, castReady, render, personId => { selectedPersonId = personId; castDetail = true; focusCastResult = true; });
    const memorySession = new MemorySession(controller, destination => journalMemoryAdapter(api.extension.store, destination), () => ready() && !eventSession.editing && !writerActive && !castSession.editing && !profileSession.editing && !corrections.editing
        && !sceneSession.busy && !sceneReview.busy && !sceneReview.draft && !sceneReview.pendingOperation, render);
    const eventSession = new EventCorrectionSession(controller, capture, () => ready() && !memorySession.busy && !memorySession.reviewing && !writerActive && !castSession.editing
        && !profileSession.editing && !corrections.editing && !sceneSession.busy && !sceneReview.busy, render);
    const narrationRoot = document.createElement('section');
    const narrationMemory = new NarrationMemory(controller, destination => journalMemoryAdapter(api.extension.store, destination), {
        ready: () => writerReady() && controller.canGenerate,
        install: value => context.setExtensionPrompt(MEMORY_PROMPT_KEY, value, 1, 0, false, 0),
        changed: render,
        safe: async () => {
            const response = await fetch('/api/extensions/discover');
            if (!response.ok)
                return false;
            const extensions = await response.json();
            const disabled = context.extensionSettings?.disabledExtensions ?? [];
            return Array.isArray(extensions) && extensions.every(extension => extension && typeof extension.name === 'string'
                && (!extension.name.includes('SillyTavern-MemoryBooks') || disabled.includes(extension.name)));
        },
    });
    // The narrator always reads the current public sheet and this scene's recorded results, whatever starts generation.
    const narratorProjection = new NarratorProjection(controller, {
        mythic: () => mythic.narratorFacts,
        pacing: () => playSettings.settings.pacing ?? 'auto',
        install: value => context.setExtensionPrompt(NARRATOR_PROMPT_KEY, value, 1, 0, false, 0),
    });
    function castReady() {
        return ready() && !eventSession.editing && !memorySession.busy && !profileSession.editing && !corrections.editing
            && !sceneSession.busy && !sceneReview.busy && !writerActive;
    }
    const gmControls = createSceneControls(sceneModel, sceneSession, api.llmConnections, gmAvailable, sceneDraftReady, startScene, selection => { void playSettings.update({ scene: selection }); });
    const settingsControls = createPlaySettingsControls({ store: playSettings, connections: api.llmConnections, available: gmAvailable,
        applied: () => { applyRoles(); render(); }, secret: triageSecret });
    const campaignFile = document.createElement('section');
    campaignFile.className = 'mc-settings-file';
    const campaignInfo = document.createElement('p');
    campaignFile.append(Object.assign(document.createElement('h3'), { textContent: 'Campaign file' }), campaignInfo);
    extensionSettings.body.prepend(settingsControls.element, gmControls.settingsElement, campaignFile);
    // Turn flow operations run inside the host's interceptor, after GENERATION_STARTED, so they must not deny themselves via writerActive.
    async function captureTurn(expected) {
        if (!writerReady())
            throw new Error('Finish or cancel sheet corrections before playing.');
        return capture(expected);
    }
    const turnFlow = new TurnFlow({
        controller, decide: decideModel,
        // Jev is reached with fetch, not through the host's saved connections, so their availability does not gate it.
        triage: { get configured() { return playSettings.settings.triage.enabled && !!triageSecret.value.trim(); },
            read: (input, signal) => triageModel.read(input, signal), propose: (input, triage, signal) => triageModel.propose(input, triage, signal) },
        settings: () => { const s = playSettings.settings; return { assisted: s.assisted && gmAvailable, confirmAlways: s.confirmAlways }; },
        capture: captureTurn,
        messages: () => window.SillyTavern.getContext().chat,
        project: () => { narratorProjection.reconcile(); },
        mythic: { get present() { return mythic.present && !!mythic.state; }, get sceneUnchecked() { return mythic.sceneUnchecked; },
            fate: (odds, question) => mythic.fate(odds, question), sceneCheck: () => mythic.sceneCheck() },
        endScene: () => {
            campaignTool = 'scene';
            shell.show('campaign');
            render();
            gmControls.element.scrollIntoView({ block: 'start' });
            // Without a scene connection the GM request is disabled; the manual draft is the live way to end the scene.
            gmControls.element.querySelector('[data-gm-request]:enabled, [data-gm-manual]:enabled')?.focus();
        },
        declare: () => { expandActionCard(inline); render(); inline.scrollIntoView({ block: 'start' }); },
        openSheet: () => { shell.show('sheet'); },
        generate: typeof context.generate === 'function' ? () => window.SillyTavern.getContext().generate('normal') : undefined,
        changed: render,
    });
    sceneReview.accepted = () => mythic.endScene();
    function activeChatSpeakerNames() {
        try {
            const st = window.SillyTavern?.getContext?.();
            if (!st)
                return [];
            const names = new Set();
            if (typeof st.name2 === 'string' && st.name2.trim())
                names.add(st.name2.trim());
            const chars = Array.isArray(st.characters) ? st.characters : [];
            if (st.characterId !== undefined && st.characterId !== null) {
                const currentChar = chars[Number(st.characterId)];
                if (typeof currentChar?.name === 'string' && currentChar.name.trim())
                    names.add(currentChar.name.trim());
            }
            if (st.groupId && Array.isArray(st.groups)) {
                const group = st.groups.find(entry => entry?.id === st.groupId);
                const disabled = new Set(Array.isArray(group?.disabled_members) ? group.disabled_members : []);
                const members = Array.isArray(group?.members) ? group.members : [];
                for (const avatar of members) {
                    if (disabled.has(avatar))
                        continue;
                    const char = chars.find(entry => entry?.avatar === avatar || entry?.name === avatar);
                    if (typeof char?.name === 'string' && char.name.trim())
                        names.add(char.name.trim());
                    else if (typeof avatar === 'string' && avatar.trim())
                        names.add(avatar.replace(/\.png$/i, '').trim());
                }
            }
            if (Array.isArray(st.chat)) {
                for (const msg of st.chat.slice(-10)) {
                    if (msg && !msg.is_user && !msg.is_system && typeof msg.name === 'string' && msg.name.trim()) {
                        names.add(msg.name.trim());
                    }
                }
            }
            return [...names];
        }
        catch {
            return [];
        }
    }
    // The card is what a phone sees; a hold that lives in the sheet must still be named here, before Send fails silently.
    function cardFlow() {
        const flow = turnFlow.card;
        if (flow.message || flow.choices?.length || !controller.playerView || narrationMemory.busy)
            return flow;
        if (!narrationMemory.recipientIds.length)
            return { ...flow, message: 'Before narrating, choose who hears it: Sera’s sheet › Campaign › Narration recipients.' };
        return narrationMemory.held ? { ...flow, message: `Narration is held: ${narrationMemory.held}` } : flow;
    }
    function writerReady() { return !eventSession.editing && !memorySession.busy && !memorySession.reviewing && !castSession.editing && !profileSession.editing && !corrections.editing && !sceneSession.busy && !sceneReview.busy && ready(); }
    function playReady() { return writerReady() && !writerActive; }
    function sceneDraftReady() {
        return !eventSession.editing && !memorySession.busy && !memorySession.reviewing && !!controller.playerView && !castSession.editing && !profileSession.editing && !corrections.editing && !writerActive
            && !sceneReview.busy && !sceneReview.pendingSave && ready() && controller.canGenerate;
    }
    async function startScene(manual) {
        await sceneSession.request(manual);
        const result = sceneSession.result;
        if (result) {
            await sceneReview.create(result);
            const active = document.activeElement;
            const ownedFocus = active === document.body || active instanceof HTMLElement
                && active.matches('[data-gm-request], [data-gm-manual], [data-review-field="review-status"]');
            if (ownedFocus && controller.playerView?.sceneReview?.source.id === result.source.id) {
                content.querySelector('[data-review-field="summary"]')?.focus();
            }
        }
    }
    function gmReady() { return gmAvailable && sceneDraftReady(); }
    async function capturePlay(expected) {
        if (!playReady())
            throw new Error('Finish or cancel sheet corrections before playing.');
        const captured = await capture(expected);
        if (!playReady())
            throw new Error('Finish or cancel sheet corrections before playing.');
        return captured;
    }
    function reviewReady() { return !eventSession.editing && !memorySession.busy && !memorySession.reviewing && !castSession.editing && !profileSession.editing && !corrections.editing && !sceneSession.busy && !writerActive && ready(); }
    async function captureSceneOperation(expected, source, retained) {
        const epoch = sceneSource.epoch;
        if (!reviewReady())
            throw new Error('Finish the current operation before reviewing the scene.');
        const operation = retained ?? await capture(expected);
        if (source)
            await sceneSource.assertSceneCurrent(source);
        const current = controller.playerView?.context;
        if (!reviewReady() || (source && epoch !== sceneSource.epoch) || current?.campaignId !== expected.campaignId
            || current.branchId !== expected.branchId || current.revision !== expected.revision)
            throw new Error('Scene or campaign changed; reopen the review.');
        return retained ?? (source ? { ...operation, source: { messageId: source.id, messageRevision: source.fingerprint } } : operation);
    }
    let selectedPersonId = null;
    let campaignTool = null, focusCampaign = false;
    let castOwner = '', castQuery = '', castDetail = false, showRetired = false, castPosition = 0, focusCastResult = false;
    destinationChanged = () => { eventSession.reset(); profileSession.reset(); castSession.reset(); render(); };
    let profileOwner = '';
    const openProfileSources = new Set();
    const openProfileScenes = new Map();
    let profileVisibleCount = 50;
    let profileFocus;
    let reviewFocus;
    let focusedProposal = '';
    function render() {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.dataset.reviewField && focused.dataset.reviewField !== 'review-region') {
            reviewFocus = { key: focused.dataset.reviewField,
                start: focused instanceof HTMLTextAreaElement ? focused.selectionStart : null,
                end: focused instanceof HTMLTextAreaElement ? focused.selectionEnd : null };
        }
        else if (focused !== document.body && !(focused instanceof HTMLElement && focused.closest('.mc-scene-review')))
            reviewFocus = undefined;
        if (focused instanceof HTMLElement && focused.dataset.profileFocus && focused.dataset.profileFocus !== 'history-status')
            profileFocus = {
                key: focused.dataset.profileFocus, section: focused.closest('[data-profile-section]')?.dataset.profileSection,
                start: focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement ? focused.selectionStart : null,
                end: focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement ? focused.selectionEnd : null,
            };
        else if (focused !== document.body && !(focused instanceof HTMLElement && focused.dataset.profileFocus === 'history-status'))
            profileFocus = undefined;
        const view = controller.playerView;
        const directoryOwner = view ? JSON.stringify([view.context.campaignId, view.context.branchId]) : castOwner;
        if (directoryOwner !== castOwner) {
            selectedPersonId = null;
            castQuery = '';
            castDetail = false;
            showRetired = false;
            castPosition = 0;
            castOwner = directoryOwner;
            castSession.reset();
        }
        if (view)
            castSession.reconcile(view);
        const personId = shell.destination === 'cast' ? selectedPersonId : view?.characterId;
        const owner = view ? JSON.stringify([view.context.campaignId, view.context.branchId, personId]) : profileOwner;
        if (owner !== profileOwner) {
            eventSession.reset();
            profileSession.reset();
            openProfileSources.clear();
            openProfileScenes.clear();
            profileVisibleCount = 50;
            profileFocus = undefined;
            profileOwner = owner;
        }
        status.textContent = controller.state.status;
        status.hidden = !!view && controller.state.status === 'Saved campaign reopened.';
        const canContinue = !view && controller.state.available && controller.state.hasSavedCampaign;
        continueButton.hidden = !canContinue;
        continueButton.disabled = controller.state.busy || !canContinue;
        continueSetupButton.hidden = !canContinue;
        continueSetupButton.disabled = controller.state.busy || !canContinue;
        create.disabled = controller.state.busy || !controller.state.available || !!view;
        create.hidden = !!view;
        reopen.disabled = controller.state.busy;
        // Reopening is for recovery: shown before a campaign is open, or when a save outcome needs reconciling.
        const needsReopen = !view || !controller.state.available || /uncertain|cannot|reopen before/i.test(controller.state.status);
        setup.hidden = false;
        campaignInfo.textContent = view
            ? `Campaign ${view.context.campaignId} · branch ${view.context.branchId} · revision ${view.context.revision} · rules ${view.rules.revision}`
            : 'Open a saved chat to create or reopen its campaign.';
        const setupHome = view && !needsReopen ? campaignFile : shell.content;
        if (setup.parentElement !== setupHome) {
            if (setupHome === shell.content)
                content.before(setup);
            else
                setupHome.append(setup);
        }
        launcher.textContent = 'Character';
        launcher.setAttribute('aria-label', view ? `${view.sheet.name}’s character sheet` : 'Character sheet');
        if (view) {
            narrationMemory.syncDefaultRecipients(view.profiles, view.characterId, activeChatSpeakerNames());
            corrections.reconcile(view);
            sceneReview.reconcile(view);
            profileSession.reconcile(view);
            eventSession.reconcile(view);
            memorySession.reconcile();
            const memoryControls = (target) => {
                const binding = target === null ? null : view.memoryBindings.people.find(entry => entry.personId === target);
                const destination = target === null ? view.memoryBindings.canonical
                    : binding ? { backend: binding.backend, id: binding.bookId } : null;
                return { personId: target, destination, session: castSession,
                    conditionalStorage: conditionalMemoryStorage,
                    begin: () => {
                        castSession.begin(view, { kind: 'bind-memory', personId: target, bookId: destination?.id ?? '' });
                        [...content.querySelectorAll('[data-profile-focus]')]
                            .find(control => control.dataset.profileFocus === `memory:${target ?? 'canonical'}:id`)?.focus();
                    } };
            };
            const profileCallbacks = {
                npc: shell.destination === 'cast',
                memory: personId ? memoryControls(personId) : undefined,
                openSources: openProfileSources, session: profileSession,
                eventSession,
                correctEvent: (sceneRecordId, eventId) => eventSession.begin(view, personId, sceneRecordId, eventId),
                history: { visibleCount: profileVisibleCount, openScenes: openProfileScenes, loadOlder: () => {
                        if (profileOwner !== owner)
                            return;
                        const previousCount = profileVisibleCount, position = shell.content.scrollTop;
                        profileVisibleCount += 50;
                        render();
                        const target = content.querySelectorAll('[data-profile-event]')[previousCount];
                        const scene = target?.closest('[data-profile-scene]');
                        if (scene)
                            scene.open = true;
                        shell.content.scrollTop = position;
                        target?.focus({ preventScroll: true });
                    } },
                edit: (section, entryId) => profileSession.begin(view, personId, section, entryId),
                readSource: (source) => ready() && personId ? controller.resolveProfileSource(view.context, personId, source) : null,
            };
            if (shell.destination === 'cast') {
                renderCast(content, view.profiles.filter(profile => profile.personId !== view.characterId), selectedPersonId, {
                    ...profileCallbacks, cast: {
                        canonicalMemory: memoryControls(null),
                        session: castSession,
                        add: () => {
                            castSession.begin(view, { kind: 'add', name: '' });
                            content.querySelector('[data-profile-focus="cast-name"]')?.focus();
                        },
                        rename: () => {
                            const profile = view.profiles.find(profile => profile.personId === personId);
                            castSession.begin(view, { kind: 'rename', personId: profile.personId, name: profile.name });
                            content.querySelector('[data-profile-focus="cast-name"]')?.focus();
                        },
                        retire: () => {
                            const profile = view.profiles.find(profile => profile.personId === personId);
                            castSession.begin(view, { kind: 'retire', personId: profile.personId, retired: !profile.retired });
                            void castSession.save();
                        },
                        detail: castDetail, query: castQuery, showRetired,
                        search: query => { castQuery = query; render(); },
                        filterRetired: show => { showRetired = show; render(); },
                        selectPerson: id => {
                            castPosition = shell.content.scrollTop;
                            if (selectedPersonId !== id) {
                                eventSession.reset();
                                profileSession.reset();
                                castSession.reset();
                            }
                            selectedPersonId = id;
                            castDetail = true;
                            render();
                            content.querySelector('[data-cast-detail] h3')?.focus();
                        },
                        backToList: () => {
                            castDetail = false;
                            render();
                            shell.content.scrollTop = castPosition;
                            const row = [...content.querySelectorAll('[data-person-id]')].find(row => row.dataset.personId === selectedPersonId);
                            (row ?? content.querySelector('[data-profile-focus="cast-search"]'))?.focus({ preventScroll: true });
                        },
                    },
                });
            }
            else if (shell.destination === 'sheet') {
                mythic.attach();
                renderSheet(content, corrections.view ?? view, corrections.editor, profileCallbacks, mythic.sheet);
                shell.renderHistory(view);
                corrections.render(content);
            }
            else if (shell.destination === 'campaign') {
                mythic.attach();
                const tools = { store: api.extension.store, metadata: resolveMetadata, github: githubSync, onRestored: () => refresh(true) };
                renderCampaign(content, view, {
                    tool: campaignTool, chaos: mythic.state?.chaosFactor, recipients: narrationMemory.recipientIds.length,
                    open: tool => { campaignTool = tool; focusCampaign = true; render(); },
                    renderTool: (tool, container) => {
                        if (tool === 'scene') {
                            gmControls.element.hidden = !!view.sceneReview || !!sceneReview.draft;
                            container.append(gmControls.element);
                            renderSceneReview(container, view, sceneReview, mythic);
                        }
                        else if (tool === 'mythic')
                            renderMythicPanel(container, view, mythic, playReady);
                        else if (tool === 'narration')
                            container.append(narrationRoot);
                        else
                            renderPlayControls(container, controller, capturePlay, playReady, tools, tool);
                    },
                });
            }
            if (shell.destination === 'campaign')
                renderMemory(content, view, memorySession);
        }
        else
            content.replaceChildren();
        injurySession.reconcile();
        const pacingMode = playSettings.settings.pacing ?? 'auto';
        const resolvedPacing = controller.resolvePacing(pacingMode);
        renderActions(inline, controller, capturePlay, playReady, {
            ...cardFlow(),
            chaos: mythic.state?.chaosFactor,
            injuries: injurySession,
            pacing: resolvedPacing
                ? {
                    mode: pacingMode,
                    resolved: resolvedPacing,
                    select: async (next) => { await playSettings.update({ pacing: next }); },
                }
                : undefined,
        });
        document.querySelector('#sheld')?.classList.toggle('mc-card-modal', inline.classList.contains('mc-card-modal'));
        // Spec §10: a proposal that arrives without stakes puts the caret in the stakes text once, when it first appears.
        const proposalId = view?.proposal?.id ?? '';
        if (proposalId && proposalId !== focusedProposal)
            inline.querySelector('[data-autofocus]')?.focus();
        focusedProposal = proposalId;
        narrationRoot.hidden = !view;
        narrationMemory.reconcile();
        narratorProjection.reconcile();
        if (view)
            renderNarrationMemory(narrationRoot, view.profiles, narrationMemory);
        gmControls.render();
        settingsControls.render();
        if (reviewFocus) {
            const controls = [...content.querySelectorAll('[data-review-field]')];
            const target = controls.find(control => control.dataset.reviewField === reviewFocus.key && !control.matches(':disabled'))
                ?? controls.find(control => control.dataset.reviewField === 'review-region' && !control.matches(':disabled'))
                ?? controls.find(control => control.dataset.reviewField === 'review-status');
            target?.focus({ preventScroll: true });
            if (target instanceof HTMLTextAreaElement && reviewFocus.start !== null)
                target.setSelectionRange(reviewFocus.start, reviewFocus.end);
        }
        if (profileFocus) {
            const controls = [...content.querySelectorAll('[data-profile-focus]')].filter(control => !control.matches(':disabled'));
            const inSection = controls.filter(control => control.closest('[data-profile-section]')?.dataset.profileSection === profileFocus.section);
            const target = controls.find(control => control.dataset.profileFocus === profileFocus.key)
                ?? controls.find(control => control.dataset.profileFocus === `edit:${profileFocus.key.slice(profileFocus.key.indexOf(':') + 1)}`)
                ?? (eventSession.busy ? inSection.find(control => control.dataset.profileFocus === 'history-status') : undefined)
                ?? inSection.find(control => control instanceof HTMLTextAreaElement)
                ?? inSection.find(control => control instanceof HTMLButtonElement)
                ?? inSection.find(control => control.dataset.profileFocus === 'memory-status');
            target?.focus({ preventScroll: true });
            if ((target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) && profileFocus.start !== null)
                target.setSelectionRange(profileFocus.start, profileFocus.end);
        }
        if (corrections.editing)
            inline.querySelectorAll('input, select, button').forEach(control => { control.disabled = true; });
        mount();
        if (focusCampaign) {
            focusCampaign = false;
            (campaignTool ? content.querySelector('[data-campaign-title]')
                : content.querySelector('[data-campaign-tool]'))?.focus({ preventScroll: true });
        }
        if (focusCastResult) {
            content.querySelector('[data-cast-detail] h3')?.focus();
            focusCastResult = false;
        }
    }
    function ready() {
        try {
            return boundRef === refKey(api.chat.current.ref()) && controller.state.available && !controller.state.busy;
        }
        catch {
            return false;
        }
    }
    // Busy or not, the open campaign's chat identity; Mythic state is read only for this same binding.
    function campaignBinding() {
        try {
            return boundRef === refKey(api.chat.current.ref()) && controller.state.available ? controller.state.binding : '';
        }
        catch {
            return '';
        }
    }
    // The card sits once between the transcript and the composer; it is re-attached only when the host drops it.
    function mount() {
        const chat = document.querySelector('#chat');
        if (chat && inline.previousElementSibling !== chat)
            chat.after(inline);
        shell.mount();
        mountLauncher(document.querySelector('#form_sheld'), continueButton);
        extensionSettings.mount();
        document.querySelector('#sheld')?.classList.add('mc-play-layout');
    }
    new ResizeObserver(() => {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement) || !focused.closest('.mc-cast') || focused.getClientRects().length)
            return;
        const headings = [...content.querySelectorAll('.mc-cast h3')];
        headings.find(heading => heading.getClientRects().length)?.focus({ preventScroll: true });
    }).observe(content);
    new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
    async function capture(expected) {
        const view = controller.playerView;
        if (!ready() || !view)
            throw new Error('Chat changed or campaign unavailable.');
        if (view.context.campaignId !== expected.campaignId || view.context.branchId !== expected.branchId
            || view.context.revision !== expected.revision)
            throw new Error('The sheet changed; reopen the controls.');
        const epoch = request;
        const binding = controller.state.binding;
        const reference = boundRef;
        const chatId = stableId;
        const messages = window.SillyTavern.getContext().chat;
        const length = messages.length;
        const index = length - 1;
        const source = JSON.stringify(messages[index] ?? { opening: view.opening });
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
        const current = controller.playerView;
        const latestMessages = window.SillyTavern.getContext().chat;
        if (!ready() || request !== epoch || controller.state.binding !== binding || boundRef !== reference || stableId !== chatId
            || !current || current.context.campaignId !== expected.campaignId || current.context.branchId !== expected.branchId
            || current.context.revision !== expected.revision || latestMessages.length !== length
            || source !== JSON.stringify(latestMessages[index] ?? { opening: current.opening })) {
            throw new Error('Context changed; try again.');
        }
        return { operationId: crypto.randomUUID(), campaignId: expected.campaignId, branchId: expected.branchId,
            expectedRevision: expected.revision, source: { messageId: `${binding}:${index < 0 ? 'opening' : index}`,
                messageRevision: Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('') } };
    }
    // STARTED precedes writer interception: a writer must not deny itself via writerActive.
    admitGeneration = async (type) => writerReady() && controller.canGenerate
        && (!controller.playerView || await narrationMemory.prepare())
        && await turnFlow.intercept(type);
    // Admission only: a newly pending decision does not suspend an already-running Agent.
    const admission = new AgentAdmission(async (target) => {
        try {
            if (target.stableChatId !== stableId || refKey(target.chatRef) !== boundRef || !writerReady() || !controller.canGenerate)
                return false;
            if (!controller.playerView)
                return true;
            if (!api.agent?.readWorkspaceFile || !target.runId)
                return narrationMemory.admitContinuation({});
            const original = await api.agent.readWorkspaceFile({ runId: target.runId, path: 'input/prompt_snapshot.json' });
            if (target.stableChatId !== stableId || refKey(target.chatRef) !== boundRef)
                return false;
            return await narrationMemory.admitContinuation(JSON.parse(original.text));
        }
        catch {
            return await narrationMemory.admitContinuation({});
        }
    }, async () => {
        // The wrapper resolves the chat the way the host's own resume() does, so both sides name the same chat.
        try {
            const handle = api.chat.current.handle();
            const id = await handle.stableId();
            return id ? { stableChatId: id, chatRef: handle.ref } : undefined;
        }
        catch {
            return undefined;
        }
    });
    admission.install(api.agent);
    agentNotice.hidden = admission.status.mode === 'hook';
    agentNotice.textContent = admission.status.mode === 'hook' ? '' : `Agent mode: ${admission.status.detail}`;
    async function refresh(preserveDraft = false) {
        sceneSource.invalidate();
        sceneSession.invalidate();
        narrationMemory.reset();
        mythic.reset();
        turnFlow.reset();
        decideModel.invalidate();
        injuryModel.invalidate();
        if (!preserveDraft) {
            corrections.clear();
            sceneReview.reset();
            profileSession.reset();
            castSession.reset();
            memorySession.reset();
            eventSession.reset();
            selectedPersonId = null;
            openProfileSources.clear();
            openProfileScenes.clear();
            profileVisibleCount = 50;
            profileFocus = undefined;
            profileOwner = '';
            castOwner = '';
            castQuery = '';
            castDetail = false;
            showRetired = false;
        }
        else
            sceneReview.reopen();
        const current = ++request;
        boundRef = '';
        stableId = '';
        await controller.open('');
        try {
            const handle = api.chat.current.handle();
            const ref = refKey(handle.ref);
            const id = await handle.stableId();
            if (current !== request || ref !== refKey(api.chat.current.ref()))
                return;
            if (!id)
                throw new Error('Select a saved chat first.');
            boundRef = ref;
            stableId = id;
            const binding = `${handle.ref.kind}:${id}`;
            handles.set(binding, handle.metadata);
            await controller.open(binding);
        }
        catch (error) {
            if (current !== request)
                return;
            status.textContent = error instanceof Error ? error.message : String(error);
        }
    }
    const runContinue = async () => {
        continueButton.disabled = true;
        continueSetupButton.disabled = true;
        try {
            const epoch = sceneSource.epoch;
            const anchor = await sceneSource.captureStartAnchor();
            if (!ready() || epoch !== sceneSource.epoch)
                throw new Error('Chat changed; try again.');
            await controller.continueCampaign(controller.state.binding, anchor);
            const opened = controller.playerView;
            if (opened && mythic.attach() && mythic.canSeed) {
                await mythic.seed(seedNames(opened));
            }
        }
        catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
        }
        finally {
            const canContinue = !controller.playerView && controller.state.available && controller.state.hasSavedCampaign;
            continueButton.disabled = controller.state.busy || !canContinue;
            continueSetupButton.disabled = controller.state.busy || !canContinue;
        }
    };
    continueButton.onclick = runContinue;
    continueSetupButton.onclick = runContinue;
    create.onclick = async () => {
        create.disabled = true;
        try {
            const epoch = sceneSource.epoch;
            const anchor = await sceneSource.captureStartAnchor();
            if (!ready() || epoch !== sceneSource.epoch)
                throw new Error('Chat changed; try again.');
            await controller.create(anchor);
        }
        catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
        }
        finally {
            create.disabled = controller.state.busy || !controller.state.available || !!controller.playerView;
        }
    };
    reopen.onclick = () => { void refresh(true); };
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => { void refresh(); });
    for (const name of ['CHAT_LOADED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED',
        'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED', 'MESSAGE_DELETED', 'MORE_MESSAGES_LOADED']) {
        const event = context.eventTypes[name];
        if (event)
            context.eventSource.on(event, () => { sceneSource.invalidate(); sceneSession.invalidate(); });
    }
    window.addEventListener('tauritavern-llm-connections-changed', () => { sceneSession.invalidate(); decideModel.invalidate(); injuryModel.invalidate(); void gmControls.refresh(); void settingsControls.refresh(); });
    const started = context.eventTypes.GENERATION_STARTED, ended = context.eventTypes.GENERATION_ENDED;
    if (started)
        context.eventSource.on(started, async (_type, options, dryRun) => {
            const before = admission.bypassed.length;
            admission.observeStarted(options);
            if (admission.bypassed.length !== before) {
                agentNotice.hidden = false;
                agentNotice.textContent = `Agent mode: an Agent resume (${admission.bypassed.at(-1)}) reached the host without passing Sera’s admission check. This host bypasses the guard; treat its narration as unreviewed.`;
            }
            narratorProjection.reconcile();
            const admitted = !controller.playerView || await narrationMemory.prepare();
            // Dry runs prepare the actual context but skip the host's manifest interceptors.
            if (admitted && !dryRun && !sceneSession.busy) {
                writerActive = true;
                render();
            }
        });
    if (ended)
        context.eventSource.on(ended, () => { writerActive = false; render(); });
    window.addEventListener('beforeunload', () => {
        context.setExtensionPrompt(MEMORY_PROMPT_KEY, '', 1, 0, false, 0);
        narratorProjection.clear();
    });
    await Promise.all([playSettings.load(), triageSecret.load()]);
    applyRoles();
    gmControls.sync();
    settingsControls.render();
    void gmControls.refresh();
    void settingsControls.refresh();
    await refresh();
}
catch (error) {
    status.textContent = `Sheet unavailable: ${error instanceof Error ? error.message : String(error)}`;
}
