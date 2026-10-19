import { rollD6 } from "./dice.js";
export class CampaignController {
    state = {
        binding: '', busy: false, status: 'Select a saved chat.', available: false,
    };
    epoch = 0;
    operations = new Map();
    writes = new Map();
    store;
    game;
    changed;
    die;
    constructor(store, game, changed = () => { }, die = rollD6) {
        this.store = store;
        this.game = game;
        this.changed = changed;
        this.die = die;
    }
    async open(binding) {
        const epoch = ++this.epoch;
        this.state = { binding, busy: true, status: 'Opening campaign…', available: false };
        this.changed();
        try {
            await this.writes.get(binding)?.catch(() => { });
            if (epoch !== this.epoch)
                return;
            const saved = binding ? await this.store.load(binding) : undefined;
            const campaign = saved === undefined ? undefined : this.game.read(saved, binding);
            if (epoch !== this.epoch)
                return;
            this.state = { binding, campaign, busy: false, available: !!binding,
                status: campaign ? 'Saved campaign reopened.' : binding ? 'No campaign in this chat.' : 'Select a saved chat.' };
        }
        catch (error) {
            if (epoch !== this.epoch)
                return;
            this.state.busy = false;
            this.state.status = `Cannot open campaign: ${error instanceof Error ? error.message : String(error)}`;
        }
        this.changed();
    }
    get canGenerate() {
        return this.state.available && !this.state.busy
            && (!this.state.campaign || !this.game.hasPending(this.state.campaign.snapshot.state));
    }
    submit(command) {
        const campaign = this.state.campaign;
        if (command.campaignId !== campaign?.id || command.branchId !== campaign.branchId) {
            return Promise.reject(new Error('Operation belongs to another campaign or branch.'));
        }
        const key = `${command.campaignId}:${command.branchId}:${command.operationId}`;
        const existing = this.operations.get(key);
        if (existing)
            return existing.then(record => structuredClone(record));
        const operation = this.resolveAndSave(command);
        this.operations.set(key, operation);
        const clear = () => { this.operations.delete(key); };
        void operation.then(clear, clear);
        return operation.then(record => structuredClone(record));
    }
    async resolveAndSave(command) {
        const campaign = this.state.campaign;
        if (!campaign || !this.state.available || this.state.busy)
            throw new Error('Campaign unavailable or saving.');
        const recorded = campaign.journal.find(entry => entry.operationId === command.operationId);
        if (recorded)
            return recorded;
        if (command.expectedRevision !== campaign.revision)
            throw new Error('Operation is stale; reopen its controls.');
        if (!command.operationId || !command.source?.messageId || !command.source.messageRevision) {
            throw new Error('Operation provenance is required.');
        }
        const captured = structuredClone(command);
        const next = { ...campaign, journal: [...campaign.journal] };
        const { event, state } = this.game.transition(campaign.snapshot.state, captured, this.die);
        const { body, ...context } = captured;
        next.revision++;
        const record = { operationId: context.operationId, revision: next.revision,
            branchId: context.branchId, at: new Date().toISOString(), context,
            rulesRevision: campaign.rules.revision, summary: this.game.describe(event), event };
        next.snapshot = { revision: next.revision, state };
        next.journal.push(record);
        await this.commit(next);
        return record;
    }
    async commit(campaign) {
        const epoch = this.epoch;
        const { binding } = campaign;
        this.state.busy = true;
        this.state.status = 'Saving mechanics…';
        this.changed();
        try {
            const write = this.store.save(binding, campaign);
            this.writes.set(binding, write);
            await write;
            if (epoch !== this.epoch)
                throw new Error('Chat changed; result saved to its original campaign.');
            this.state.campaign = campaign;
            this.state.status = 'Mechanics saved locally.';
        }
        catch (error) {
            if (epoch === this.epoch) {
                this.state.available = false;
                this.state.status = `Save outcome uncertain; reopen before retrying: ${error instanceof Error ? error.message : String(error)}`;
            }
            throw error;
        }
        finally {
            this.writes.delete(binding);
            if (epoch === this.epoch) {
                this.state.busy = false;
                this.changed();
            }
        }
    }
    async create(factory = binding => this.game.create(binding)) {
        if (this.state.busy || !this.state.available || this.state.campaign)
            return;
        const { binding } = this.state;
        const epoch = this.epoch;
        const campaign = factory(binding);
        this.state.busy = true;
        this.state.status = 'Saving new campaign…';
        this.changed();
        try {
            const write = this.store.save(binding, campaign);
            this.writes.set(binding, write);
            await write;
            if (epoch !== this.epoch)
                return;
            this.state.campaign = campaign;
            this.state.status = 'Saved locally.';
        }
        catch (error) {
            if (epoch !== this.epoch)
                return;
            this.state.available = false;
            this.state.status = `Save outcome uncertain; reopen before retrying: ${error instanceof Error ? error.message : String(error)}`;
        }
        finally {
            this.writes.delete(binding);
        }
        this.state.busy = false;
        this.changed();
    }
}
