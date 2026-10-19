import { editableSlots } from "./editable-fields.js";
import { applyMinorEvent, sameValue } from "./events.js";
export function listEditableFields(state) {
    return editableSlots(state).map(slot => slot.field);
}
export function correctField(state, ref, value, reason) {
    const event = createFieldCorrection(state, ref, value, reason);
    applyMinorEvent(state, event);
    return event;
}
export function createFieldCorrection(state, ref, value, reason) {
    const slot = editableSlots(state).find(slot => sameValue(slot.field.ref, ref));
    if (!slot)
        throw new Error('Select an existing editable field by its stable identity.');
    const event = { kind: 'field-corrected', command: { ref: structuredClone(ref), value, reason },
        label: slot.field.label, before: slot.field.value, after: value };
    if (slot.definition) {
        slot.write(value);
        const { instance, draft } = slot.definition;
        const revision = Math.max(...state.definitions.filter(entry => entry.id === draft.id).map(entry => entry.revision)) + 1;
        event.definition = { before: structuredClone(instance.definition), after: { ...draft, revision } };
    }
    if (slot.classBinding) {
        const after = value === null ? null : slot.classBinding.classes.find(entry => entry.name === value)?.id;
        if (after === undefined)
            throw new Error('Select an existing class.');
        event.classBinding = { before: slot.classBinding.before, after };
    }
    return event;
}
