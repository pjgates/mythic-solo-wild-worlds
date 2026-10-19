import { sameValue } from "./game/minor-character/events.js";
// Retrieval never publishes. An acknowledged local job is not proof of the current external version.
export async function prepareMemoryContext(controller, adapter, recipientIds, current) {
    const plan = controller.prepareMemoryContext(recipientIds);
    if (plan.kind === 'held')
        return plan;
    for (const job of plan.candidates) {
        if (!current() || !controller.matchesMemoryContext(plan.scope)) {
            return { kind: 'held', reason: 'Narration selection or campaign changed. Prepare again.' };
        }
        try {
            const actual = await adapter(job.destination).read(job.document.key);
            if (!current() || !controller.matchesMemoryContext(plan.scope)) {
                return { kind: 'held', reason: 'Narration selection or campaign changed. Prepare again.' };
            }
            if (!sameValue(actual, job.document)) {
                await controller.recordMemoryOutcome({ operationId: crypto.randomUUID(), campaignId: plan.scope.campaignId,
                    branchId: plan.scope.branchId, expectedRevision: plan.scope.revision,
                    source: { messageId: job.document.key, messageRevision: job.document.acceptedOperationId } }, { documentKey: job.document.key, acceptedOperationId: job.document.acceptedOperationId }, job.destination, { kind: 'conflict', actual });
                return { kind: 'held', reason: 'Required external memory changed. Review the conflict before narration.' };
            }
        }
        catch {
            return { kind: 'held', reason: 'Required memory could not be read and verified. Reopen or repair its destination.' };
        }
    }
    if (!current() || !controller.matchesMemoryContext(plan.scope)) {
        return { kind: 'held', reason: 'Narration selection or campaign changed. Prepare again.' };
    }
    return plan;
}
