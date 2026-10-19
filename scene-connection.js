const text = (value) => typeof value === 'string' && !!value.trim();
const keys = (value, allowed) => !!value && typeof value === 'object'
    && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
function requireConnection(valid) {
    if (!valid)
        throw new Error('Unsupported GM connection: choose direct OpenAI, Claude or Custom OpenAI-compatible with a saved secret and supported settings.');
}
// The pinned host switches these exact model IDs to its legacy text-completion route.
const legacyModels = new Set([
    'gpt-3.5-turbo-instruct', 'gpt-3.5-turbo-instruct-0914', 'text-davinci-003', 'text-davinci-002', 'text-davinci-001',
    'text-curie-001', 'text-babbage-001', 'text-ada-001', 'code-davinci-002', 'code-davinci-001',
    'code-cushman-002', 'code-cushman-001', 'text-davinci-edit-001', 'code-davinci-edit-001', 'text-embedding-ada-002',
    'text-similarity-davinci-001', 'text-similarity-curie-001', 'text-similarity-babbage-001', 'text-similarity-ada-001',
    'text-search-davinci-doc-001', 'text-search-curie-doc-001', 'text-search-babbage-doc-001', 'text-search-ada-doc-001',
    'code-search-babbage-code-001', 'code-search-ada-code-001',
]);
export function mapSceneConnection(selection, value) {
    if (!selection.connectionId.trim() || !selection.modelId.trim())
        throw new Error('Choose an explicit GM connection and model.');
    if (!value || typeof value !== 'object')
        throw new Error('Selected GM connection is unavailable.');
    const connection = value;
    requireConnection(keys(connection, ['schemaVersion', 'kind', 'id', 'displayName', 'description',
        'provider', 'endpoint', 'auth', 'routing', 'adapterHints', 'capabilities'])
        && connection.schemaVersion === 1 && connection.kind === 'tauritavern.llmConnection'
        && connection.id === selection.connectionId && text(connection.displayName)
        && (connection.description === undefined || typeof connection.description === 'string')
        && keys(connection.provider, ['chatCompletionSource', 'customApiFormat']) && text(connection.provider.chatCompletionSource)
        && keys(connection.auth, ['secretRef']));
    const source = connection.provider.chatCompletionSource.trim().toLowerCase();
    requireConnection(source === 'openai' || source === 'custom' || source === 'claude');
    for (const options of [connection.routing, connection.capabilities]) {
        requireConnection(options === undefined || keys(options, []));
    }
    const hints = connection.adapterHints;
    requireConnection(hints === undefined || keys(hints, source === 'claude' ? ['customIncludeHeaders'] : []));
    let headers;
    if (hints && Object.hasOwn(hints, 'customIncludeHeaders')) {
        const raw = hints.customIncludeHeaders;
        // One JSON member only; no escapes, duplicate headers or general override language.
        const match = typeof raw === 'string'
            ? raw.match(/^[ \t\r\n]*\{[ \t\r\n]*"anthropic-workspace-id"[ \t\r\n]*:[ \t\r\n]*"(wrkspc_[A-Za-z0-9]+)"[ \t\r\n]*\}[ \t\r\n]*$/) : null;
        requireConnection(match !== null && match[0] === raw);
        headers = JSON.stringify({ 'anthropic-workspace-id': match[1] });
    }
    const endpoint = connection.endpoint === undefined ? {} : connection.endpoint;
    requireConnection(keys(endpoint, ['baseUrl', 'sourceSpecific'])
        && (endpoint.sourceSpecific === undefined || keys(endpoint.sourceSpecific, [])));
    const secret = connection.auth.secretRef;
    requireConnection(keys(secret, ['key', 'id', 'labelSnapshot']) && !!secret && text(secret.id)
        && text(secret.key) && secret.key.trim() === `api_key_${source}`
        && (secret.labelSnapshot === undefined || typeof secret.labelSnapshot === 'string'));
    const model = selection.modelId.trim();
    if (legacyModels.has(model))
        throw new Error('Choose a chat-completion model for the GM connection.');
    if (source !== 'custom')
        requireConnection(endpoint.baseUrl === undefined && connection.provider.customApiFormat === undefined);
    else {
        const format = connection.provider.customApiFormat;
        requireConnection((format === undefined || typeof format === 'string')
            && (!format?.trim() || format.trim().toLowerCase() === 'openai_compat') && text(endpoint.baseUrl));
        try {
            const url = new URL(endpoint.baseUrl);
            requireConnection(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash);
        }
        catch {
            requireConnection(false);
        }
    }
    return { chat_completion_source: source, model, secret_id: secret.id.trim(),
        ...(headers === undefined ? {} : { custom_include_headers: headers }),
        ...(source === 'openai' ? { max_completion_tokens: 4096 }
            : source === 'claude' ? { max_tokens: 4096, use_sysprompt: true } : { max_tokens: 4096,
                custom_api_format: 'openai_compat', custom_url: endpoint.baseUrl.trim() }) };
}
