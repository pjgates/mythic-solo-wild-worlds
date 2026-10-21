import { prepareMemoryContext } from "./memory-context.js";
export const MEMORY_PROMPT_KEY = 'minor-character-memory';
export function matchChatRecipients(profiles, playerCharacterId, activeNames) {
    const normalizedActive = new Set(activeNames.map(name => name.trim().toLowerCase()).filter(Boolean));
    const matched = new Set([playerCharacterId]);
    for (const profile of profiles) {
        if (profile.retired)
            continue;
        const candidates = [profile.name, ...(profile.aliases ?? [])]
            .map(value => value.trim().toLowerCase())
            .filter(Boolean);
        if (candidates.some(candidate => normalizedActive.has(candidate))) {
            matched.add(profile.personId);
        }
    }
    return [...matched].sort();
}
export class NarrationMemory {
    recipientIds = [];
    message = 'Select the actual narration recipients; presence does not grant knowledge.';
    busy = false;
    manualOverride = false;
    epoch = 0;
    request = 0;
    value = '';
    scope;
    controller;
    adapter;
    host;
    constructor(controller, adapter, host) {
        this.controller = controller;
        this.adapter = adapter;
        this.host = host;
    }
    /** The reason the latest verification held narration, until the selection changes or a verification succeeds. */
    held = null;
    select(ids) {
        this.manualOverride = true;
        this.recipientIds = [...new Set(ids)].sort();
        this.epoch++;
        this.request++;
        this.scope = undefined;
        this.value = '';
        this.host.install('');
        this.busy = false;
        this.held = null;
        this.message = 'Selection changed. Memory will be verified before narration.';
        this.host.changed();
    }
    reset() {
        this.select([]);
        this.manualOverride = false;
    }
    syncDefaultRecipients(profiles, playerCharacterId, activeNames) {
        if (this.manualOverride)
            return;
        const next = matchChatRecipients(profiles, playerCharacterId, activeNames);
        if (next.length === this.recipientIds.length && next.every((id, index) => id === this.recipientIds[index])) {
            return;
        }
        this.recipientIds = next;
        this.epoch++;
        this.request++;
        this.scope = undefined;
        this.value = '';
        this.host.install('');
        this.busy = false;
        this.held = null;
        this.message = 'Default recipients selected from active chat cards. Memory will be verified before narration.';
    }
    reconcile() {
        if (this.scope && !this.controller.matchesMemoryContext(this.scope)) {
            this.scope = undefined;
            this.value = '';
            this.host.install('');
            this.message = 'Campaign changed. Memory will be verified before narration.';
        }
    }
    async prepare() {
        const epoch = this.epoch, request = ++this.request, ids = [...this.recipientIds];
        const current = () => epoch === this.epoch && request === this.request && this.host.ready();
        this.scope = undefined;
        this.value = '';
        this.host.install('');
        this.busy = true;
        this.message = 'Verifying permitted narration memory…';
        this.host.changed();
        try {
            if (!await this.host.safe() || !current()) {
                if (current()) {
                    this.message = 'Unsupported memory activation. Disable independent Memory Books activation before narration.';
                    this.held = this.message;
                }
                return false;
            }
            const result = await prepareMemoryContext(this.controller, this.adapter, ids, current);
            if (!current())
                return false;
            if (result.kind === 'held') {
                this.message = result.reason;
                this.held = result.reason;
                return false;
            }
            this.held = null;
            // The explicit audience is also captured in the host's frozen extension prompt for continuation admission.
            this.value = `Minor Character narration recipients: ${JSON.stringify(result.recipientIds)}\n${result.content}`;
            this.scope = result.scope;
            this.host.install(this.value);
            this.message = 'Permitted memory verified for the selected recipients.';
            return true;
        }
        catch {
            if (current()) {
                this.message = 'Memory preparation failed. Narration is held; repair remains available.';
                this.held = this.message;
            }
            return false;
        }
        finally {
            if (request === this.request) {
                this.busy = false;
                this.host.changed();
            }
        }
    }
    async admitContinuation(snapshot) {
        if (!await this.prepare())
            return false;
        const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
        const frozen = object(snapshot) ? snapshot.frozenRunInputSnapshot : undefined;
        const inputs = object(frozen) ? frozen.promptInputs : undefined;
        const prompts = object(inputs) ? inputs.extensionPrompts : undefined;
        const prompt = object(prompts) ? prompts[MEMORY_PROMPT_KEY] : undefined;
        if (object(prompt) && prompt.value === this.value && prompt.position === 1 && prompt.depth === 0
            && prompt.scan === false && prompt.role === 0)
            return true;
        this.scope = undefined;
        this.value = '';
        this.host.install('');
        this.message = 'Agent memory scope is absent or outdated. Start a fresh generation with the selected recipients.';
        this.host.changed();
        return false;
    }
}
