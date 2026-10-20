const ROLL_KINDS = new Set(['fate', 'scene-check', 'meaning', 'dice']);
const SCENE_LABELS = { expected: 'Expected Scene', altered: 'Altered Scene', interrupt: 'Interrupt Scene' };
const FATE_LABELS = { 'exceptional-yes': 'Exceptional Yes', yes: 'Yes', no: 'No', 'exceptional-no': 'Exceptional No' };
/** Dispatched on `window` by `mythic-gme` right after it assigns `window.MythicGME`. */
export const MYTHIC_READY_EVENT = 'mythic-gme-ready';
const isApi = (value) => typeof value === 'object' && value !== null
    && typeof value.state === 'function' && typeof value.submit === 'function'
    && typeof value.subscribe === 'function';
const isRefusal = (value) => typeof value === 'object' && value !== null
    && value.refused === true;
const reason = (error) => error instanceof Error ? error.message : String(error);
export class MythicBridge {
    sceneEnd = 'in';
    message = '';
    busy = false;
    api;
    host;
    constructor(host) { this.host = host; }
    /** Idempotent and cheap, so callers can retry it on every render until Mythic has booted. */
    attach() {
        if (this.api)
            return true;
        let api;
        try {
            api = this.host.resolve();
        }
        catch {
            return false;
        }
        if (!isApi(api))
            return false;
        try {
            api.subscribe(() => this.host.changed());
        }
        catch {
            return false;
        }
        this.api = api;
        return true;
    }
    get present() { return !!this.api; }
    /** Mythic state for the open campaign's chat only; another chat's state, or none, reads as absent. */
    get state() {
        if (!this.api)
            return undefined;
        try {
            const state = this.api.state(), binding = this.host.binding();
            return state && state.available && binding !== '' && state.binding === binding ? state : undefined;
        }
        catch {
            return undefined;
        }
    }
    get sheet() {
        const state = this.state;
        return state && { chaosFactor: state.chaosFactor, sceneCount: state.sceneCount,
            characters: state.lists.characters, threads: state.lists.threads };
    }
    /** This scene's Fate, Scene, Meaning and dice rolls; Mythic injects only human-made rolls itself, so agent calls need this. */
    get narratorFacts() {
        const state = this.state;
        if (!state || !this.api)
            return undefined;
        let rolls = [];
        try {
            const receipts = this.api.receipts?.() ?? [];
            rolls = receipts.filter(receipt => receipt && typeof receipt.summary === 'string'
                && receipt.sceneCount === state.sceneCount && ROLL_KINDS.has(receipt.result?.kind)).map(receipt => receipt.summary);
        }
        catch {
            rolls = [];
        }
        return { chaosFactor: state.chaosFactor, sceneCount: state.sceneCount,
            threads: state.lists.threads, characters: state.lists.characters, rolls };
    }
    get canSeed() {
        const state = this.state;
        return !!state && !this.busy && state.lists.characters.length === 0 && state.lists.threads.length === 0;
    }
    reset() { this.sceneEnd = 'in'; this.message = ''; }
    /** Adds the campaign's cast and threads to empty Mythic lists, one entry at a time, stopping at the first refusal. */
    async seed(names) {
        if (!this.canSeed)
            return;
        const binding = this.host.binding();
        const entries = [...names.characters.map(name => ({ list: 'characters', name })), ...names.threads.map(name => ({ list: 'threads', name }))];
        this.busy = true;
        this.message = 'Seeding Mythic lists…';
        this.host.changed();
        let added = 0;
        try {
            for (const { list, name } of entries) {
                if (this.host.binding() !== binding)
                    throw new Error('Chat changed while seeding.');
                const result = await this.submit('list', { list, action: { kind: 'add', name } });
                if (isRefusal(result))
                    throw new Error(result.reason);
                added++;
            }
            this.message = `Seeded ${added} ${added === 1 ? 'entry' : 'entries'} into the Mythic lists.`;
        }
        catch (error) {
            this.message = `Seeded ${added} of ${entries.length} before Mythic GME refused: ${reason(error)}`;
        }
        finally {
            this.busy = false;
            this.host.changed();
        }
    }
    /** Ends the Mythic scene with the chosen control; the caller runs this only after the journal accepted the scene. */
    async endScene() {
        const control = this.sceneEnd;
        if (control === 'open' || !this.state)
            return;
        this.busy = true;
        this.host.changed();
        try {
            const result = await this.submit('endScene', { control });
            if (isRefusal(result))
                throw new Error(result.reason);
            const end = result.endScene;
            const scene = end ? `Mythic scene ${end.endedScene}` : 'Mythic scene';
            const chaos = !end ? `Chaos Factor ${result.chaosFactor}`
                : end.clamped ? `Chaos Factor stays at ${end.after}` : `Chaos Factor ${end.before} → ${end.after}`;
            this.message = `${scene} ended ${control === 'in' ? 'in control' : 'out of control'}; ${chaos}.`;
        }
        catch (error) {
            this.message = `Scene accepted, but Mythic GME did not end its scene: ${reason(error)} End it from the Mythic drawer.`;
        }
        finally {
            this.busy = false;
            this.host.changed();
        }
    }
    /** Mythic's current scene opened (after an end-scene) without its Scene Check yet; the first scene needs none. */
    get sceneUnchecked() {
        const state = this.state;
        if (!state || !this.api || state.sceneCount <= 1)
            return false;
        try {
            return !(this.api.receipts?.() ?? []).some(receipt => receipt?.sceneCount === state.sceneCount && receipt.result?.kind === 'scene-check');
        }
        catch {
            return false;
        }
    }
    /** The Scene Check that opens the next scene (design §6): one d10 against Chaos, in Mythic's own words for the narrator. */
    async sceneCheck() {
        if (!this.state)
            throw new Error('Mythic GME is not loaded for this chat.');
        const binding = this.host.binding();
        const scene = this.state.sceneCount;
        this.busy = true;
        this.host.changed();
        try {
            const result = await this.submit('scene', {});
            if (isRefusal(result))
                throw new Error(result.reason);
            if (this.host.binding() !== binding)
                throw new Error('Chat changed while checking the scene.');
            const check = result.scene;
            const outcome = check?.outcome ? SCENE_LABELS[check.outcome] ?? check.outcome : 'checked';
            const detail = check?.outcome === 'altered' && check.adjustments?.length ? ` — ${check.adjustments.map(a => a.label ?? '').filter(Boolean).join(' and ')}`
                : check?.randomEvent ? ' — Random Event (see Mythic)' : '';
            const summary = `Scene ${scene} check @ Chaos ${result.chaosFactor}: ${check?.draw ?? '?'} → ${outcome}${detail}.`;
            this.message = summary;
            return summary;
        }
        finally {
            this.busy = false;
            this.host.changed();
        }
    }
    /** A Fate Check asked from the action card; the answer is Mythic's own summary, carried to the narrator by the projection. */
    async fate(odds, question) {
        if (!this.state)
            throw new Error('Mythic GME is not loaded for this chat.');
        const binding = this.host.binding();
        this.busy = true;
        this.host.changed();
        try {
            const result = await this.submit('fate', { odds, ...(question.trim() ? { question: question.trim() } : {}) });
            if (isRefusal(result))
                throw new Error(result.reason);
            if (this.host.binding() !== binding)
                throw new Error('Chat changed while asking the oracle.');
            const fate = result.fate;
            const outcome = fate?.outcome ? FATE_LABELS[fate.outcome] ?? fate.outcome : 'answered';
            const summary = `Fate Check (${odds}): ${outcome}${fate?.draw !== undefined ? ` on ${fate.draw}` : ''}${fate?.randomEvent ? ' · Random Event' : ''}.`;
            this.message = summary;
            return summary;
        }
        finally {
            this.busy = false;
            this.host.changed();
        }
    }
    async submit(kind, args) {
        if (!this.api)
            return { refused: true, reason: 'Mythic GME is not loaded.' };
        try {
            return await this.api.submit(kind, args);
        }
        catch (error) {
            return { refused: true, reason: reason(error) };
        }
    }
}
