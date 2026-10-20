import { validateCheckpointEnvelope } from "./game/minor-character/checkpoints.js";
function assertGitSha(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) {
        throw new Error('Invalid Git object SHA.');
    }
    return value;
}
function decodeBase64Utf8(b64) {
    const normalized = b64.replace(/\s+/g, '');
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}
export class GitHubCheckpointSync {
    #credentials = null;
    #fetch;
    #changed;
    state = {
        busy: false,
        connected: false,
        owner: '',
        repo: '',
        branch: 'minor-character-checkpoints',
        syncStatus: 'Saved locally',
        detail: '',
        lastCommitSha: '',
    };
    constructor(request = fetch, changed = () => { }) {
        this.#fetch = request;
        this.#changed = changed;
    }
    async #requestWith(creds, path, method = 'GET', body, allow404 = false) {
        const response = await this.#fetch(`https://api.github.com/repos/${creds.owner}/${creds.repo}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${creds.token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            redirect: 'error',
            credentials: 'omit',
            cache: 'no-store',
            signal: AbortSignal.timeout(30000),
        });
        if (allow404 && response.status === 404) {
            return { status: 404, data: null };
        }
        if (!response.ok) {
            throw new Error(`GitHub request ${method} ${path || '/'} failed with HTTP ${response.status}.`);
        }
        const data = (await response.json());
        return { status: response.status, data };
    }
    async connect(options) {
        const owner = options.owner?.trim() ?? '';
        const repo = options.repo?.trim() ?? '';
        const token = options.token?.trim() ?? '';
        const branch = options.branch?.trim() || 'minor-character-checkpoints';
        if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || !token) {
            throw new Error('Enter a valid GitHub owner, repository, and session token.');
        }
        this.state.busy = true;
        this.state.detail = 'Checking private repository…';
        this.#changed();
        try {
            const tempCreds = { owner, repo, token, branch };
            const { data: metadata } = await this.#requestWith(tempCreds, '');
            if (!metadata ||
                metadata.private !== true ||
                typeof metadata.full_name !== 'string' ||
                metadata.full_name.toLowerCase() !== `${owner}/${repo}`.toLowerCase()) {
                throw new Error('Destination must be an explicitly selected private repository.');
            }
            this.#credentials = tempCreds;
            this.state.connected = true;
            this.state.owner = owner;
            this.state.repo = repo;
            this.state.branch = branch;
            this.state.detail = `Connected to private repository ${owner}/${repo} (${branch}).`;
        }
        catch (error) {
            this.#credentials = null;
            this.state.connected = false;
            this.state.detail = error instanceof Error ? error.message : 'GitHub connection failed.';
            throw error;
        }
        finally {
            this.state.busy = false;
            this.#changed();
        }
    }
    disconnect() {
        this.#credentials = null;
        this.state.connected = false;
        this.state.owner = '';
        this.state.repo = '';
        this.state.syncStatus = 'Saved locally';
        this.state.detail = 'Disconnected from GitHub.';
        this.#changed();
    }
    markSavedLocally() {
        this.state.syncStatus = this.state.connected ? 'Upload pending' : 'Saved locally';
        this.state.detail = this.state.connected
            ? 'Saved locally; checkpoint upload pending.'
            : 'Saved locally.';
        this.#changed();
    }
    async uploadCheckpoint(envelope) {
        if (!this.#credentials || !this.state.connected) {
            throw new Error('Connect a private GitHub repository before uploading a checkpoint.');
        }
        const { envelope: validated } = await validateCheckpointEnvelope(envelope);
        const creds = this.#credentials;
        this.state.busy = true;
        this.state.syncStatus = 'Upload pending';
        this.state.detail = 'Uploading checkpoint to private GitHub repository…';
        this.#changed();
        try {
            const branchRefPath = `/git/ref/heads/${encodeURIComponent(creds.branch)}`;
            const existingRef = await this.#requestWith(creds, branchRefPath, 'GET', undefined, true);
            let baseCommitSha;
            if (existingRef.status === 404 || !existingRef.data) {
                const { data: repoMeta } = await this.#requestWith(creds, '');
                if (!repoMeta || repoMeta.private !== true || typeof repoMeta.default_branch !== 'string') {
                    throw new Error('Repository must remain private with a readable default branch.');
                }
                const { data: defaultHead } = await this.#requestWith(creds, `/git/ref/heads/${encodeURIComponent(repoMeta.default_branch)}`);
                baseCommitSha = assertGitSha(defaultHead?.object?.sha);
                await this.#requestWith(creds, '/git/refs', 'POST', {
                    ref: `refs/heads/${creds.branch}`,
                    sha: baseCommitSha,
                });
            }
            else {
                baseCommitSha = assertGitSha(existingRef.data.object?.sha);
            }
            const { data: baseCommit } = await this.#requestWith(creds, `/git/commits/${baseCommitSha}`);
            const baseTreeSha = assertGitSha(baseCommit?.tree?.sha);
            const serialized = JSON.stringify(validated, null, 2);
            const { data: blob } = await this.#requestWith(creds, '/git/blobs', 'POST', {
                content: serialized,
                encoding: 'utf-8',
            });
            const blobSha = assertGitSha(blob?.sha);
            const { campaignId, branchId, revision } = validated.manifest;
            const revPath = `minor-character/checkpoints/${campaignId}/${branchId}/rev-${revision}.json`;
            const latestPath = `minor-character/checkpoints/${campaignId}/${branchId}/latest.json`;
            const paths = [revPath, latestPath];
            const { data: tree } = await this.#requestWith(creds, '/git/trees', 'POST', {
                base_tree: baseTreeSha,
                tree: paths.map(path => ({
                    path,
                    mode: '100644',
                    type: 'blob',
                    sha: blobSha,
                })),
            });
            const treeSha = assertGitSha(tree?.sha);
            const { data: commit } = await this.#requestWith(creds, '/git/commits', 'POST', {
                message: `Checkpoint ${campaignId} (${branchId} rev ${revision})`,
                tree: treeSha,
                parents: [baseCommitSha],
            });
            const commitSha = assertGitSha(commit?.sha);
            await this.#requestWith(creds, `/git/refs/heads/${encodeURIComponent(creds.branch)}`, 'PATCH', { sha: commitSha, force: false });
            const { data: publishedRef } = await this.#requestWith(creds, branchRefPath);
            if (assertGitSha(publishedRef?.object?.sha) !== commitSha) {
                throw new Error('Checkpoint branch moved unexpectedly during readback verification.');
            }
            this.state.syncStatus = 'Uploaded';
            this.state.lastCommitSha = commitSha;
            this.state.detail = `Uploaded rev ${revision} (${commitSha.slice(0, 7)}).`;
            return { commitSha, paths };
        }
        catch (error) {
            this.state.syncStatus = 'Upload failed';
            this.state.detail =
                error instanceof Error
                    ? `Checkpoint upload failed (local save retained): ${error.message}`
                    : 'Checkpoint upload failed (local save retained).';
            throw error;
        }
        finally {
            this.state.busy = false;
            this.#changed();
        }
    }
    async downloadCheckpoint(campaignId, branchId, revision) {
        if (!this.#credentials || !this.state.connected) {
            throw new Error('Connect a private GitHub repository before downloading a checkpoint.');
        }
        const creds = this.#credentials;
        const fileName = revision !== undefined ? `rev-${revision}.json` : 'latest.json';
        const filePath = `/contents/minor-character/checkpoints/${campaignId}/${branchId}/${fileName}?ref=${encodeURIComponent(creds.branch)}`;
        this.state.busy = true;
        this.#changed();
        try {
            const { data } = await this.#requestWith(creds, filePath);
            if (!data || data.encoding !== 'base64' || typeof data.content !== 'string') {
                throw new Error('Unexpected GitHub contents payload.');
            }
            const parsed = JSON.parse(decodeBase64Utf8(data.content));
            const { envelope } = await validateCheckpointEnvelope(parsed);
            return envelope;
        }
        finally {
            this.state.busy = false;
            this.#changed();
        }
    }
}
