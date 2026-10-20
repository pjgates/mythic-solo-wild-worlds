import { sameValue } from "./game/minor-character/events.js";
import { mapSceneConnection } from "./scene-connection.js";
import { readTurnDecision, turnDecisionPrompt, TurnDecisionError } from "./turn-decision.js";
/** Every failure the card can show: the player chooses retry, manual declaration or narration; nothing retries itself. */
export class DecideFailure extends Error {
}
const changed = () => new DecideFailure('Scene, campaign or draft connection changed; the message was not interpreted.');
const DEFAULT_TIMEOUT = 45_000;
/** The draft role (the code keeps the name `decide`): one quiet, non-streaming request to the selected saved connection, no retry, no fallback connection. */
export class DecideModel {
    #host;
    #selection = { connectionId: '', modelId: '' };
    #epoch = 0;
    #active;
    constructor(host) { this.#host = host; }
    get busy() { return !!this.#active; }
    get selection() { return { ...this.#selection }; }
    get configured() { return !!this.#selection.connectionId.trim() && !!this.#selection.modelId.trim(); }
    select(selection) { this.#selection = { ...selection }; this.invalidate(); }
    invalidate() { this.#epoch++; this.#active?.abort(); }
    async decide(input) {
        if (this.busy)
            throw new DecideFailure('The draft role is already reading a message.');
        const selection = { ...this.#selection };
        if (!selection.connectionId.trim() || !selection.modelId.trim())
            throw new DecideFailure('Choose a draft connection and model in Play settings, or play manually.');
        const context = structuredClone(this.#host.current());
        if (!context)
            throw new DecideFailure('No open campaign scene to interpret for.');
        const epoch = this.#epoch;
        const active = new AbortController();
        this.#active = active;
        const timer = setTimeout(() => active.abort(), this.#host.timeoutMs ?? DEFAULT_TIMEOUT);
        const check = () => {
            if (epoch !== this.#epoch || active.signal.aborted || !sameValue(context, this.#host.current()))
                throw changed();
        };
        try {
            check();
            const connection = structuredClone(await this.#host.loadConnection(selection.connectionId));
            check();
            let mapped;
            try {
                mapped = mapSceneConnection(selection, connection);
            }
            catch {
                throw new DecideFailure('The selected draft connection is unavailable or unsupported.');
            }
            const response = await this.#host.sendRequest({ ...mapped, stream: false, type: 'quiet', messages: turnDecisionPrompt(input) }, true, active.signal);
            check();
            const afterReply = await this.#host.loadConnection(selection.connectionId);
            check();
            if (!sameValue(connection, afterReply))
                throw changed();
            if (!response || typeof response !== 'object' || typeof response.content !== 'string') {
                throw new DecideFailure('The draft role returned no readable reply.');
            }
            const rawReply = response.content;
            const rawContent = stripFences(rawReply);
            if (!rawContent)
                throw new DecideFailure('The draft role returned an empty reply.');
            let parsed;
            try {
                parsed = parseJsonObject(rawContent);
            }
            catch {
                throw new DecideFailure(`The draft role did not return JSON (${previewReply(rawReply)}).`);
            }
            return readTurnDecision(parsed, input.sheet);
        }
        catch (error) {
            if (error instanceof DecideFailure)
                throw error;
            if (error instanceof TurnDecisionError)
                throw new DecideFailure(error.message);
            if (active.signal.aborted && epoch === this.#epoch)
                throw new DecideFailure('The draft role timed out or was cancelled.');
            const detail = error instanceof Error ? error.message : String(error);
            if (/Secret id not found for api_key_/i.test(detail)) {
                throw new DecideFailure('The draft connection’s saved API key was replaced or deleted. In Connection Profile, select the Model Target and tap Update (or save a new Model Only profile), then tap Refresh connections.');
            }
            throw new DecideFailure(`The draft request failed: ${detail}`);
        }
        finally {
            clearTimeout(timer);
            this.#active = undefined;
        }
    }
}
/** Some chat models wrap JSON in a code fence despite instructions; returns the last fenced block or trimmed content. */
export function stripFences(content) {
    const trimmed = content.trim();
    const full = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (full)
        return full[1].trim();
    const blocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)];
    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i][1].trim();
        if (block.includes('{'))
            return block;
    }
    return blocks.length ? blocks[blocks.length - 1][1].trim() : trimmed;
}
/** Parses a JSON string, falling back to any balanced `{...}` object in the reply (from the end) if a chat model added prose. */
export function parseJsonObject(content) {
    try {
        return JSON.parse(content);
    }
    catch (firstError) {
        const candidates = extractBalancedJsonObjects(content);
        for (let i = candidates.length - 1; i >= 0; i--) {
            try {
                return JSON.parse(candidates[i]);
            }
            catch { /* try earlier candidate */ }
        }
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        if (start >= 0 && end > start)
            return JSON.parse(content.slice(start, end + 1));
        throw firstError;
    }
}
function extractBalancedJsonObjects(text) {
    const results = [];
    let depth = 0, start = -1, inString = false, escape = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (inString) {
            if (ch === '\\')
                escape = true;
            else if (ch === '"')
                inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            if (depth === 0)
                start = i;
            depth++;
        }
        else if (ch === '}' && depth > 0) {
            depth--;
            if (depth === 0 && start >= 0) {
                results.push(text.slice(start, i + 1));
                start = -1;
            }
        }
    }
    return results;
}
function previewReply(content) {
    const flat = content.replace(/\s+/g, ' ').trim();
    return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat;
}
