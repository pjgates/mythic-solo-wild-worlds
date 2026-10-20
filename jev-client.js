/** Every failure the card can show; the key never appears in the message. */
export class JevFailure extends Error {
}
const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const DEFAULT_TIMEOUT = 10_000;
/** One non-streaming request to the OpenRouter decisions endpoint, no retry (spec §5.1, §7). */
export class JevClient {
    #apiKey;
    #model;
    #fetch;
    #timeoutMs;
    constructor(options) {
        this.#apiKey = options.apiKey;
        const { model } = options;
        this.#model = typeof model === 'string' ? () => model : model;
        this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
        this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
    }
    async decide(state, questions, signal) {
        const key = this.#apiKey().trim();
        if (!key)
            throw new JevFailure('Enter the OpenRouter key for Jev in Play settings.');
        const abort = new AbortController();
        const cancel = () => abort.abort();
        const timer = setTimeout(cancel, this.#timeoutMs);
        if (signal?.aborted)
            cancel();
        else
            signal?.addEventListener('abort', cancel, { once: true });
        try {
            let response;
            try {
                response = await this.#fetch(ENDPOINT, {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${key}`,
                        'content-type': 'application/json',
                        'HTTP-Referer': 'https://github.com/pjgates/codex-athenaeum',
                        'X-Title': 'Minor Character',
                    },
                    body: JSON.stringify({ model: this.#model(), state, questions }),
                    signal: abort.signal,
                });
            }
            catch {
                throw abort.signal.aborted ? notInTime() : new JevFailure('Jev could not be reached.');
            }
            if (!response.ok)
                throw statusFailure(response.status);
            let body;
            try {
                body = await response.json();
            }
            catch {
                throw abort.signal.aborted ? notInTime() : unreadable();
            }
            return readResult(body, questions);
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
        }
    }
}
const notInTime = () => new JevFailure('Jev did not answer in time.');
const unreadable = () => new JevFailure('Jev returned an unreadable answer.');
/** The status alone decides the message: the response body is never read into it, so neither the key nor OpenRouter's text can reach the card. */
function statusFailure(status) {
    if (status === 401 || status === 403)
        return new JevFailure('OpenRouter rejected the Jev key.');
    if (status === 400)
        return new JevFailure('OpenRouter rejected the Jev request.');
    if (status === 429)
        return new JevFailure('OpenRouter is rate-limiting Jev; wait a moment and retry.');
    if (status >= 500)
        return new JevFailure('OpenRouter is unavailable.');
    return new JevFailure(`OpenRouter answered the Jev request with HTTP ${status}.`);
}
const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isUnit = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
/** Strict reading: every asked question must be answered with its own type; nothing is repaired. */
function readResult(raw, questions) {
    if (!isRecord(raw) || typeof raw.model !== 'string' || !isRecord(raw.answers))
        throw unreadable();
    const answers = {};
    for (const [id, question] of Object.entries(questions))
        answers[id] = readAnswer(raw.answers[id], question);
    const result = { model: raw.model, answers };
    if (raw.usage !== undefined)
        result.usage = readUsage(raw.usage);
    return result;
}
function readAnswer(raw, question) {
    if (!isRecord(raw) || raw.type !== question.type)
        throw unreadable();
    switch (question.type) {
        case 'choice': {
            const { choice, probabilities, confidence } = raw;
            if (typeof choice !== 'string' || !(choice in question.criteria) || !isRecord(probabilities) || !isUnit(confidence))
                throw unreadable();
            const read = {};
            for (const [option, p] of Object.entries(probabilities)) {
                if (!isUnit(p))
                    throw unreadable();
                read[option] = p;
            }
            return { type: 'choice', choice, probabilities: read, confidence };
        }
        case 'noul':
            if (!isUnit(raw.noul))
                throw unreadable();
            return { type: 'noul', noul: raw.noul };
        case 'score':
            if (typeof raw.score !== 'number' || !Number.isFinite(raw.score))
                throw unreadable();
            return { type: 'score', score: raw.score };
        default: {
            const exhaustive = question;
            throw new JevFailure(`Unknown question type: ${String(exhaustive.type)}`);
        }
    }
}
function readUsage(raw) {
    if (!isRecord(raw))
        throw unreadable();
    const { input_tokens: inputTokens, output_tokens: outputTokens, cost } = raw;
    if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number')
        throw unreadable();
    return { inputTokens, outputTokens, cost: typeof cost === 'number' ? cost : null };
}
