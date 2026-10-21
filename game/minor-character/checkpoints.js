import { journalMemoryAdapter } from "../../memory-adapter.js";
import { applyMinorEvent, sameValue } from "./events.js";
import { admitMemoryDocument } from "./memory-publication.js";
import { reanchorScene } from "./play.js";
import { readMinorCampaign } from "./read.js";
import { MINOR_RULES } from "./state.js";
async function sha256Hex(input) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function rewriteDocumentKey(key, oldBranchId, newBranchId) {
    try {
        const parsed = JSON.parse(key);
        if (Array.isArray(parsed) &&
            parsed.length === 6 &&
            parsed[0] === 'memory' &&
            parsed[2] === oldBranchId) {
            parsed[2] = newBranchId;
            return JSON.stringify(parsed);
        }
    }
    catch {
        // Keep original key if not a JSON array key
    }
    return key;
}
function rewriteMemoryDocument(doc, oldBranchId, newBranchId) {
    doc.branchId = newBranchId;
    doc.key = rewriteDocumentKey(doc.key, oldBranchId, newBranchId);
}
function rewriteMemoryPublication(pub, oldBranchId, newBranchId) {
    rewriteMemoryDocument(pub.document, oldBranchId, newBranchId);
    if (pub.acknowledgement)
        rewriteMemoryDocument(pub.acknowledgement, oldBranchId, newBranchId);
    if (pub.predecessor) {
        pub.predecessor.documentKey = rewriteDocumentKey(pub.predecessor.documentKey, oldBranchId, newBranchId);
    }
    if (pub.conflict?.actual)
        rewriteMemoryDocument(pub.conflict.actual, oldBranchId, newBranchId);
    if (pub.resolution?.actual)
        rewriteMemoryDocument(pub.resolution.actual, oldBranchId, newBranchId);
}
export function branchCampaign(campaign, targetRevision, newBranchId) {
    const verifiedSource = readMinorCampaign(campaign, campaign.binding);
    if (typeof newBranchId !== 'string' || !newBranchId.trim() || newBranchId === verifiedSource.branchId) {
        throw new Error('A distinct non-empty branchId is required.');
    }
    if (!Number.isSafeInteger(targetRevision) ||
        targetRevision < 0 ||
        targetRevision > verifiedSource.revision) {
        throw new Error('Target revision must be an existing integer revision.');
    }
    const journalPrefix = structuredClone(verifiedSource.journal.slice(0, targetRevision + 1));
    let stateAtTarget = structuredClone(verifiedSource.initialState);
    for (const entry of journalPrefix) {
        stateAtTarget = applyMinorEvent(stateAtTarget, entry.event);
    }
    if (stateAtTarget.pending !== null || stateAtTarget.sceneReview !== null || stateAtTarget.proposal) {
        throw new Error('Cannot branch from an unsettled revision with pending adjudication, proposal or scene review.');
    }
    const oldBranchId = verifiedSource.branchId;
    for (const record of stateAtTarget.sceneRecords) {
        record.branchId = newBranchId;
    }
    for (const pub of stateAtTarget.memoryPublications) {
        rewriteMemoryPublication(pub, oldBranchId, newBranchId);
    }
    for (const entry of journalPrefix) {
        entry.branchId = newBranchId;
        if (entry.context) {
            entry.context.branchId = newBranchId;
        }
        const event = entry.event;
        if (event.kind === 'action-resolved') {
            event.command.originalActionCommand.branchId = newBranchId;
        }
        else if (event.kind === 'scene-review-accepted') {
            event.context.branchId = newBranchId;
            event.record.branchId = newBranchId;
            for (const pub of event.memoryPublications) {
                rewriteMemoryPublication(pub, oldBranchId, newBranchId);
            }
        }
        else if (event.kind === 'scene-event-corrected' ||
            event.kind === 'profile-updated' ||
            event.kind === 'keeper-secret-revealed') {
            for (const pub of event.memoryPublications ?? []) {
                rewriteMemoryPublication(pub, oldBranchId, newBranchId);
            }
        }
        else if (event.kind === 'memory-destination-resolved') {
            event.documentKey = rewriteDocumentKey(event.documentKey, oldBranchId, newBranchId);
        }
        else if (event.kind === 'memory-outcome-recorded') {
            event.ref.documentKey = rewriteDocumentKey(event.ref.documentKey, oldBranchId, newBranchId);
            if (entry.context)
                entry.context.source.messageId = event.ref.documentKey;
            if (event.outcome.kind === 'verified') {
                rewriteMemoryDocument(event.outcome.document, oldBranchId, newBranchId);
            }
            else if (event.outcome.kind === 'conflict' && event.outcome.actual) {
                rewriteMemoryDocument(event.outcome.actual, oldBranchId, newBranchId);
            }
        }
        else if (event.kind === 'memory-conflict-reviewed') {
            event.ref.documentKey = rewriteDocumentKey(event.ref.documentKey, oldBranchId, newBranchId);
            if (entry.context)
                entry.context.source.messageId = event.ref.documentKey;
            if (event.actual) {
                rewriteMemoryDocument(event.actual, oldBranchId, newBranchId);
            }
        }
    }
    const candidate = {
        schemaVersion: 2,
        id: verifiedSource.id,
        binding: verifiedSource.binding,
        branchId: newBranchId,
        revision: targetRevision,
        rules: structuredClone(verifiedSource.rules),
        initialState: structuredClone(verifiedSource.initialState),
        snapshot: {
            revision: targetRevision,
            state: stateAtTarget,
        },
        journal: journalPrefix,
    };
    const branched = readMinorCampaign(candidate, verifiedSource.binding);
    const lineage = {
        branchId: newBranchId,
        parentBranchId: verifiedSource.branchId,
        divergedAtRevision: targetRevision,
        divergedFromOperationId: verifiedSource.journal[targetRevision].operationId,
        createdAt: new Date().toISOString(),
    };
    return { campaign: branched, lineage };
}
export class BranchRegistry {
    #store;
    #metadata;
    constructor(store, metadata = () => ({ async setExtension() { } })) {
        this.#store = store;
        this.#metadata = metadata;
    }
    async #keys(binding) {
        const hash = await sha256Hex(binding);
        const base = `${hash}-m25`;
        return {
            active: { namespace: 'minor-character', key: base },
            branches: { namespace: 'minor-character', key: `${base}-branches` },
            branch: (branchId) => ({ namespace: 'minor-character', key: `${base}-branch-${branchId}` }),
        };
    }
    async listBranches(binding) {
        const keys = await this.#keys(binding);
        const [activeResult, indexResult] = await Promise.all([
            this.#store.tryGetJson(keys.active),
            this.#store.tryGetJson(keys.branches),
        ]);
        const list = Array.isArray(indexResult.value)
            ? structuredClone(indexResult.value)
            : [];
        if (activeResult.found) {
            const active = readMinorCampaign(activeResult.value, binding);
            if (!list.some(entry => entry.branchId === active.branchId)) {
                list.unshift({
                    branchId: active.branchId,
                    parentBranchId: null,
                    divergedAtRevision: 0,
                    divergedFromOperationId: active.journal[0]?.operationId ?? 'created',
                    createdAt: active.journal[0]?.at ?? new Date(0).toISOString(),
                });
            }
        }
        return list;
    }
    async createBranchFrom(binding, targetRevision, newBranchId) {
        const targetMeta = this.#metadata(binding);
        const keys = await this.#keys(binding);
        const activeResult = await this.#store.tryGetJson(keys.active);
        if (!activeResult.found) {
            throw new Error('No active campaign found at binding.');
        }
        const active = readMinorCampaign(activeResult.value, binding);
        const existingBranches = await this.listBranches(binding);
        if (existingBranches.some(b => b.branchId === newBranchId)) {
            throw new Error(`Branch "${newBranchId}" already exists.`);
        }
        const { campaign: branched, lineage } = branchCampaign(active, targetRevision, newBranchId);
        for (const job of branched.snapshot.state.memoryPublications) {
            if (job.acknowledgement === null)
                continue;
            const doc = job.acknowledgement;
            const oldKey = rewriteDocumentKey(doc.key, branched.branchId, active.branchId);
            if (job.destination?.backend === 'journal') {
                const adapter = journalMemoryAdapter(this.#store, job.destination);
                const current = await adapter.read(doc.key);
                await adapter.write(doc, current === null ? { kind: 'absent' } : { kind: 'value', document: current });
            }
            const rawOld = await this.#store.tryGetJson({ namespace: 'minor-character', key: oldKey });
            if (rawOld.found) {
                await this.#store.setJson({
                    namespace: 'minor-character',
                    key: doc.key,
                    value: structuredClone(doc),
                });
            }
        }
        // Preserve the parent branch snapshot before switching active branch
        await this.#store.setJson({ ...keys.branch(active.branchId), value: active });
        await this.#store.setJson({ ...keys.branch(branched.branchId), value: branched });
        await this.#store.setJson({ ...keys.branches, value: [...existingBranches, lineage] });
        await this.#store.setJson({ ...keys.active, value: branched });
        await targetMeta.setExtension({
            namespace: 'minor-character',
            value: {
                campaignId: branched.id,
                branchId: branched.branchId,
                revision: branched.revision,
                binding,
            },
        });
        return { campaign: branched, lineage };
    }
    async switchBranch(binding, targetBranchId) {
        const targetMeta = this.#metadata(binding);
        const keys = await this.#keys(binding);
        const activeResult = await this.#store.tryGetJson(keys.active);
        if (activeResult.found) {
            const current = readMinorCampaign(activeResult.value, binding);
            await this.#store.setJson({ ...keys.branch(current.branchId), value: current });
            if (current.branchId === targetBranchId) {
                return current;
            }
        }
        const targetResult = await this.#store.tryGetJson(keys.branch(targetBranchId));
        if (!targetResult.found) {
            throw new Error(`Unknown branch "${targetBranchId}".`);
        }
        const switched = readMinorCampaign(targetResult.value, binding);
        await this.#store.setJson({ ...keys.active, value: switched });
        await targetMeta.setExtension({
            namespace: 'minor-character',
            value: {
                campaignId: switched.id,
                branchId: switched.branchId,
                revision: switched.revision,
                binding,
            },
        });
        return switched;
    }
}
export async function exportCheckpoint(campaign, lineage = null) {
    const verified = readMinorCampaign(campaign, campaign.binding);
    const acknowledgedMemories = verified.snapshot.state.memoryPublications
        .filter(job => job.acknowledgement !== null)
        .map(job => structuredClone(job.acknowledgement));
    const [campaignSha256, memorySha256] = await Promise.all([
        sha256Hex(JSON.stringify(verified)),
        sha256Hex(JSON.stringify(acknowledgedMemories)),
    ]);
    return {
        format: 'minor-character-checkpoint',
        version: 1,
        manifest: {
            campaignId: verified.id,
            binding: verified.binding,
            branchId: verified.branchId,
            revision: verified.revision,
            rules: structuredClone(verified.rules),
            exportedAt: new Date().toISOString(),
            lineage: lineage ? structuredClone(lineage) : null,
            hashes: {
                campaignSha256,
                memorySha256,
            },
        },
        campaign: structuredClone(verified),
        acknowledgedMemories,
    };
}
function rebindSnapshot(source, targetBinding) {
    source.binding = targetBinding;
    source.startAnchor.binding = targetBinding;
    source.endAnchor.binding = targetBinding;
}
export function rebindCampaign(campaign, targetBinding, newStartAnchor) {
    const rebound = structuredClone(campaign);
    if (rebound.binding !== targetBinding) {
        rebound.binding = targetBinding;
        rebound.initialState.world.scene.startAnchor.binding = targetBinding;
        rebound.snapshot.state.world.scene.startAnchor.binding = targetBinding;
        for (const record of rebound.snapshot.state.sceneRecords) {
            rebindSnapshot(record.source, targetBinding);
        }
        if (rebound.snapshot.state.sceneReview) {
            rebindSnapshot(rebound.snapshot.state.sceneReview.source, targetBinding);
        }
        for (const entry of rebound.journal) {
            const event = entry.event;
            if (event.kind === 'scene-advanced') {
                event.before.startAnchor.binding = targetBinding;
                event.after.startAnchor.binding = targetBinding;
            }
            else if (event.kind === 'scene-reanchored') {
                event.before.binding = targetBinding;
                event.after.binding = targetBinding;
            }
            else if (event.kind === 'scene-review-saved' || event.kind === 'scene-review-revised') {
                rebindSnapshot(event.review.source, targetBinding);
            }
            else if (event.kind === 'scene-review-accepted') {
                rebindSnapshot(event.record.source, targetBinding);
                event.boundary.before.startAnchor.binding = targetBinding;
                event.boundary.after.startAnchor.binding = targetBinding;
            }
        }
    }
    if (newStartAnchor &&
        (!sameValue(rebound.snapshot.state.world.scene.startAnchor, newStartAnchor) ||
            rebound.snapshot.state.sceneReview !== null)) {
        const operationId = crypto.randomUUID();
        const context = {
            operationId,
            campaignId: rebound.id,
            branchId: rebound.branchId,
            expectedRevision: rebound.revision,
            source: {
                messageId: `${targetBinding}:reanchor`,
                messageRevision: newStartAnchor.prefixFingerprint,
            },
        };
        const event = reanchorScene(rebound.snapshot.state, newStartAnchor);
        const nextState = applyMinorEvent(rebound.snapshot.state, event);
        rebound.revision++;
        rebound.snapshot = { revision: rebound.revision, state: nextState };
        rebound.journal.push({
            operationId,
            revision: rebound.revision,
            branchId: rebound.branchId,
            at: new Date().toISOString(),
            context,
            rulesRevision: rebound.rules.revision,
            summary: `Scene ${event.cancelledReviewId ? 'review cleared and ' : ''}start anchor reset.`,
            event,
        });
    }
    return rebound;
}
export async function validateCheckpointEnvelope(raw, targetBinding) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Invalid checkpoint envelope.');
    }
    const candidate = structuredClone(raw);
    const manifest = candidate.manifest;
    if (candidate.format !== 'minor-character-checkpoint' ||
        candidate.version !== 1 ||
        !manifest ||
        typeof manifest !== 'object' ||
        typeof manifest.campaignId !== 'string' ||
        !manifest.campaignId ||
        typeof manifest.binding !== 'string' ||
        !manifest.binding ||
        typeof manifest.branchId !== 'string' ||
        !manifest.branchId ||
        !Number.isSafeInteger(manifest.revision) ||
        manifest.revision < 0 ||
        !sameValue(manifest.rules, MINOR_RULES) ||
        typeof manifest.exportedAt !== 'string' ||
        !manifest.hashes ||
        typeof manifest.hashes.campaignSha256 !== 'string' ||
        typeof manifest.hashes.memorySha256 !== 'string' ||
        !candidate.campaign ||
        !Array.isArray(candidate.acknowledgedMemories)) {
        throw new Error('Malformed checkpoint envelope or manifest.');
    }
    const [actualCampaignSha256, actualMemorySha256] = await Promise.all([
        sha256Hex(JSON.stringify(candidate.campaign)),
        sha256Hex(JSON.stringify(candidate.acknowledgedMemories)),
    ]);
    if (actualCampaignSha256 !== manifest.hashes.campaignSha256 ||
        actualMemorySha256 !== manifest.hashes.memorySha256) {
        throw new Error('Checkpoint SHA-256 digest mismatch; payload integrity check failed.');
    }
    // Verify the original campaign against its manifest binding first
    const verifiedOriginal = readMinorCampaign(candidate.campaign, manifest.binding);
    if (verifiedOriginal.id !== manifest.campaignId ||
        verifiedOriginal.branchId !== manifest.branchId ||
        verifiedOriginal.revision !== manifest.revision) {
        throw new Error('Checkpoint manifest disagrees with campaign metadata.');
    }
    const expectedAcknowledged = verifiedOriginal.snapshot.state.memoryPublications
        .filter(job => job.acknowledgement !== null)
        .map(job => job.acknowledgement);
    for (const doc of candidate.acknowledgedMemories) {
        admitMemoryDocument(doc, doc.key);
    }
    if (!sameValue(candidate.acknowledgedMemories, expectedAcknowledged)) {
        throw new Error('Checkpoint acknowledged memories disagree with campaign publication history.');
    }
    const effectiveBinding = targetBinding ?? manifest.binding;
    const rebound = effectiveBinding === manifest.binding
        ? verifiedOriginal
        : readMinorCampaign(rebindCampaign(verifiedOriginal, effectiveBinding), effectiveBinding);
    return { envelope: candidate, campaign: rebound };
}
export async function restoreCheckpoint(raw, store, metadata, targetBinding) {
    const { envelope, campaign } = await validateCheckpointEnvelope(raw, targetBinding);
    const binding = campaign.binding;
    const targetMeta = metadata(binding);
    const hash = await sha256Hex(binding);
    const primaryKey = `${hash}-m25`;
    const existing = await store.tryGetJson({ namespace: 'minor-character', key: primaryKey });
    let backupKey = null;
    if (existing.found) {
        const existingRevision = existing.value &&
            typeof existing.value === 'object' &&
            Number.isSafeInteger(existing.value.revision)
            ? existing.value.revision
            : 0;
        backupKey = `${primaryKey}-backup-${existingRevision}`;
        await store.setJson({
            namespace: 'minor-character',
            key: backupKey,
            value: existing.value,
        });
    }
    for (const doc of envelope.acknowledgedMemories) {
        const job = campaign.snapshot.state.memoryPublications.find(pub => pub.acknowledgement !== null && sameValue(pub.acknowledgement, doc));
        if (job?.destination?.backend === 'journal') {
            const adapter = journalMemoryAdapter(store, job.destination);
            const current = await adapter.read(doc.key);
            await adapter.write(doc, current === null ? { kind: 'absent' } : { kind: 'value', document: current });
        }
    }
    await store.setJson({
        namespace: 'minor-character',
        key: primaryKey,
        value: campaign,
    });
    await targetMeta.setExtension({
        namespace: 'minor-character',
        value: {
            campaignId: campaign.id,
            branchId: campaign.branchId,
            revision: campaign.revision,
            binding,
        },
    });
    return { campaign, backupKey };
}
