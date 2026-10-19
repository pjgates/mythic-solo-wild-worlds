/** The names the wrapper installs itself under; `startRunWithPromptSnapshot` is reached only through the interceptor. */
const WRAPPED = ['resume', 'submitGuidance'];
const ACTION = { resume: 'resume', submitGuidance: 'guidance' };
const abortError = (reason) => {
    const error = new Error(reason);
    error.name = 'AbortError';
    return error;
};
const runIdOf = (input) => {
    const value = typeof input === 'object' && input !== null ? input.runId : undefined;
    return typeof value === 'string' ? value.trim() : '';
};
export class AgentAdmission {
    status = { mode: 'unguarded', detail: 'Not installed.' };
    /** Runs that reached `GENERATION_STARTED` as an Agent resume without passing through this guard. */
    bypassed = [];
    seen = new Set();
    admit;
    identity;
    constructor(admit, identity) { this.admit = admit; this.identity = identity; }
    install(agent) {
        if (!agent || typeof agent !== 'object')
            return this.set('unguarded', 'The host exposes no Agent API; Agent mode cannot run here.');
        if (typeof agent.registerBeforeRunAction === 'function') {
            try {
                agent.registerBeforeRunAction(target => this.decide({ ...target, action: target.action ?? 'resume' }));
                return this.set('hook', 'Agent resume and guidance are admitted through the host hook.');
            }
            catch (error) {
                return this.set('unguarded', `The host hook could not be registered: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return this.wrap(agent);
    }
    /** `GENERATION_STARTED` options for an Agent resume name the run; one the guard never saw means the gate was bypassed. */
    observeStarted(options) {
        if (typeof options !== 'object' || options === null || !options.agentResume)
            return;
        const runId = runIdOf(options);
        if (!runId || this.seen.has(runId) || this.bypassed.includes(runId))
            return;
        this.bypassed.push(runId);
    }
    wrap(agent) {
        const missing = WRAPPED.filter(name => typeof agent[name] !== 'function');
        if (missing.length)
            return this.set('unguarded', `The host Agent API has no ${missing.join(' or ')} to guard; Agent mode cannot run here.`);
        const originals = Object.fromEntries(WRAPPED.map(name => [name, agent[name]]));
        const wrappers = {};
        for (const name of WRAPPED) {
            const original = originals[name];
            wrappers[name] = async (input) => {
                const runId = runIdOf(input);
                const identity = await this.identity();
                if (!identity || !runId)
                    throw abortError('Sera’s sheet denied the Agent action: no bound chat.');
                if (!await this.decide({ ...identity, runId, action: ACTION[name] }))
                    throw abortError('Sera’s sheet denied the Agent action.');
                return original.call(agent, input);
            };
        }
        try {
            for (const name of WRAPPED) {
                const descriptor = Object.getOwnPropertyDescriptor(agent, name);
                if (!descriptor || !descriptor.writable || !descriptor.configurable)
                    throw new Error(`${name} is not a writable property`);
                agent[name] = wrappers[name];
            }
            for (const name of WRAPPED)
                if (agent[name] !== wrappers[name])
                    throw new Error(`${name} did not take the wrapper`);
        }
        catch (error) {
            for (const name of WRAPPED) {
                try {
                    agent[name] = originals[name];
                }
                catch { /* already unchanged */ }
            }
            return this.set('unguarded', `The host Agent API cannot be wrapped (${error instanceof Error ? error.message : String(error)}); Agent resume and guidance are unguarded on this host.`);
        }
        return this.set('wrapped', 'Agent resume and guidance are admitted by wrapping the host Agent API (unpatched host).');
    }
    async decide(target) {
        this.seen.add(target.runId);
        try {
            return await this.admit(target);
        }
        catch {
            return false;
        }
    }
    set(mode, detail) {
        this.status = { mode, detail };
        return this.status;
    }
}
