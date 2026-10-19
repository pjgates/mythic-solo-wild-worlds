import { createFieldCorrection } from "./editing.js";
import { applyFieldCorrection, applyMinorEvent } from "./events.js";
export function correctFields(state, changes, reason) {
    const working = structuredClone(state);
    const event = { kind: 'fields-corrected', reason, changes: [] };
    for (const { ref, value } of changes) {
        const correction = createFieldCorrection(working, ref, value, reason);
        applyFieldCorrection(working, correction);
        event.changes.push(correction);
    }
    applyMinorEvent(state, event);
    return event;
}
