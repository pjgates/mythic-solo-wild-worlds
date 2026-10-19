import { sameValue } from "./game/minor-character/events.js";
import { validSceneStartAnchor } from "./game/minor-character/scene-anchor.js";
const hash = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
const changed = () => new Error('Scene source changed; capture it again.');
// Host adapters supply selected chat state. No viewport, inactive-swipe or host message UUID claim.
export class SceneSource {
    #host;
    #epoch = 0;
    constructor(host) { this.#host = host; }
    get epoch() { return this.#epoch; }
    invalidate() { this.#epoch++; }
    #read() {
        const state = this.#host.read();
        if (!state.binding || !state.reference || !state.stableChatId)
            throw changed();
        return { binding: state.binding, reference: state.reference, stableChatId: state.stableChatId,
            scene: state.scene ? { id: state.scene.id, startAnchor: structuredClone(state.scene.startAnchor) } : null,
            messages: state.messages.map((message, position) => {
                const speaker = message.name ?? (message.is_user ? 'User' : 'Assistant');
                const text = message.mes ?? '';
                const swipeId = message.swipe_id ?? null;
                if (typeof speaker !== 'string' || typeof text !== 'string'
                    || (swipeId !== null && (!Number.isSafeInteger(swipeId) || swipeId < 0)))
                    throw changed();
                return { position, speaker, text, swipeId,
                    eligible: !message.is_system && message.role !== 'tool' && !!text.trim() };
            }) };
    }
    async #scan() {
        const data = this.#read();
        const epoch = this.#epoch;
        const serialized = JSON.stringify(data);
        if (await this.#host.stableId() !== data.stableChatId)
            throw changed();
        const endAnchor = { binding: data.binding, nextMessageIndex: data.messages.length,
            prefixFingerprint: await hash(data.messages) };
        this.#assertCurrent(serialized, epoch);
        return { data, epoch, serialized, endAnchor };
    }
    #assertCurrent(serialized, epoch) {
        if (epoch !== this.#epoch || serialized !== JSON.stringify(this.#read()))
            throw changed();
    }
    async captureStartAnchor() {
        const captured = await this.#scan();
        this.#assertCurrent(captured.serialized, captured.epoch);
        return captured.endAnchor;
    }
    async captureScene(sceneId) {
        const { data, epoch, serialized, endAnchor } = await this.#scan();
        if (data.scene?.id !== sceneId)
            throw changed();
        const startAnchor = data.scene.startAnchor;
        if (!validSceneStartAnchor(startAnchor) || startAnchor.binding !== data.binding
            || startAnchor.nextMessageIndex > data.messages.length
            || startAnchor.prefixFingerprint !== await hash(data.messages.slice(0, startAnchor.nextMessageIndex)))
            throw changed();
        const messages = await Promise.all(data.messages.slice(startAnchor.nextMessageIndex).filter(message => message.eligible)
            .map(async ({ position, speaker, text, swipeId }) => {
            const selected = { position, speaker, text, swipeId };
            return { ...selected, revision: await hash(selected) };
        }));
        const content = { sceneId, binding: data.binding, startAnchor, endAnchor, messages };
        const fingerprint = await hash(content);
        this.#assertCurrent(serialized, epoch);
        return { id: crypto.randomUUID(), ...content, fingerprint };
    }
    // A persisted review may survive reload or revision changes; compare sources, not campaign revision.
    async assertSceneCurrent(source) {
        const current = await this.captureScene(source.sceneId);
        const { id: _capturedId, ...captured } = source;
        const { id: _currentId, ...latest } = current;
        if (!sameValue(captured, latest))
            throw changed();
    }
}
