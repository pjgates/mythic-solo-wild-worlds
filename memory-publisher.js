import { sameValue } from "./game/minor-character/events.js";
import { MemoryConflict } from "./memory-adapter.js";
const passes = new WeakMap();
export function publishPending(controller, adapter) {
    const running = passes.get(controller);
    if (running)
        return running;
    const pass = publish(controller, adapter).finally(() => passes.delete(controller));
    passes.set(controller, pass);
    return pass;
}
async function publish(controller, adapter) {
    const started = controller.publicationWork;
    if (!started)
        return;
    const active = (revision) => {
        const current = controller.publicationWork;
        return current?.campaignId === started.campaignId && current.branchId === started.branchId
            && current.binding === started.binding && (revision === undefined || current.revision === revision) ? current : undefined;
    };
    const context = (work, document) => ({
        operationId: crypto.randomUUID(), campaignId: work.campaignId, branchId: work.branchId,
        expectedRevision: work.revision, source: { messageId: document.key, messageRevision: document.acceptedOperationId },
    });
    for (const candidate of started.jobs) {
        let work = active();
        if (!work)
            return;
        let job = work.jobs.find(job => job.document.key === candidate.document.key
            && job.document.acceptedOperationId === candidate.document.acceptedOperationId);
        if (job.status === 'published' || work.jobs.some(later => later.document.key === job.document.key
            && later.document.acceptedRevision > job.document.acceptedRevision && later.acknowledgement !== null))
            continue;
        if (!job.destination) {
            try {
                await controller.resolveMemoryDestination(context(work, job.document), job.document.key);
            }
            catch (error) {
                if (!active(work.revision))
                    throw error;
                continue; // No configured route: the saved job and visible setup requirement remain pending.
            }
            work = active();
            if (!work)
                return;
            job = work.jobs.find(current => current.document.key === job.document.key
                && current.document.acceptedOperationId === job.document.acceptedOperationId);
        }
        const predecessor = job.predecessor === null ? undefined : work.jobs.find(previous => previous.document.key === job.predecessor.documentKey && previous.document.acceptedOperationId === job.predecessor.acceptedOperationId);
        if (job.predecessor && !predecessor?.acknowledgement)
            continue;
        const destination = job.destination;
        let outcome;
        try {
            const target = adapter(destination);
            let actual = await target.read(job.document.key);
            if (!active(work.revision))
                return;
            if (!sameValue(actual, job.document)) {
                if (predecessor && predecessor.status !== 'published')
                    continue;
                const prior = job.resolution ? job.resolution.actual : job.acknowledgement ?? predecessor?.acknowledgement;
                await target.write(job.document, prior ? { kind: 'value', document: prior } : { kind: 'absent' });
                actual = await target.read(job.document.key);
            }
            if (!sameValue(actual, job.document))
                throw new MemoryConflict(actual);
            outcome = { kind: 'verified', document: actual };
        }
        catch (error) {
            outcome = error instanceof MemoryConflict ? { kind: 'conflict', actual: error.actual }
                : { kind: 'failed', reason: 'Delivery could not be verified.' };
        }
        if (!active(work.revision))
            return;
        // Save failures must escape: an uncertain campaign cannot accept another outcome in this pass.
        await controller.recordMemoryOutcome(context(work, job.document), {
            documentKey: job.document.key, acceptedOperationId: job.document.acceptedOperationId,
        }, destination, outcome);
    }
}
