import { ROLES_NAMESPACE } from "./play-settings.js";
export const TRIAGE_SECRET_KEY = 'triage-secret';
/**
 * The OpenRouter key for the triage reader (spec §7). Held in memory for the session; written to the roles namespace
 * only while Remember is on. The store has no per-key delete, so forgetting writes `null`, which reads as absent.
 * The value is never part of `PlaySettings`, events, prompts or messages; callers read it through `value`.
 */
export class TriageSecret {
    #store;
    #value = '';
    #remembered = false;
    constructor(store) { this.#store = store; }
    get value() { return this.#value; }
    get remembered() { return this.#remembered; }
    async load() {
        try {
            const stored = await this.#store.tryGetJson({ namespace: ROLES_NAMESPACE, key: TRIAGE_SECRET_KEY });
            const value = stored.found && typeof stored.value === 'string' ? stored.value.trim() : '';
            if (value) {
                this.#value = value;
                this.#remembered = true;
            }
        }
        catch { /* the session starts without a key */ }
    }
    /** Replaces the key in memory; a remembered key is rewritten so the store never holds a stale one. */
    async set(value) {
        this.#value = value.trim();
        if (this.#remembered)
            await this.#write(this.#value || null);
    }
    async remember(on) {
        this.#remembered = on;
        await this.#write(on ? this.#value || null : null);
    }
    async clear() {
        this.#value = '';
        this.#remembered = false;
        await this.#write(null);
    }
    #write(value) {
        return this.#store.setJson({ namespace: ROLES_NAMESPACE, key: TRIAGE_SECRET_KEY, value });
    }
}
