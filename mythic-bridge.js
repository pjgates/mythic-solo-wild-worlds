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
