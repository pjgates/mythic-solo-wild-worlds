const id = (value) => typeof value === 'string' && !!value.trim();
export function validMemoryDestination(value) {
    const destination = value;
    return !!destination && Object.keys(destination).length === 2
        && destination.backend === 'journal' && id(destination.id);
}
export function memoryDestination(state, personId) {
    if (personId === null)
        return state.memoryBindings.canonical;
    const binding = state.memoryBindings.people.find(binding => binding.personId === personId);
    return binding ? { backend: binding.backend, id: binding.bookId } : null;
}
export function assertMemoryBindings(state) {
    const bindings = state.memoryBindings;
    if (!bindings || Object.keys(bindings).length !== 2 || !Array.isArray(bindings.people)
        || !(bindings.canonical === null || validMemoryDestination(bindings.canonical))
        || !bindings.people.every(binding => binding && Object.keys(binding).length === 3
            && state.profiles.some(profile => profile.personId === binding.personId)
            && validMemoryDestination({ backend: binding.backend, id: binding.bookId }))
        || new Set(bindings.people.map(binding => binding.personId)).size !== bindings.people.length) {
        throw new Error('Invalid memory bindings.');
    }
    const destinations = [...(bindings.canonical ? [bindings.canonical] : []),
        ...bindings.people.map(binding => ({ backend: binding.backend, id: binding.bookId }))];
    if (new Set(destinations.map(destination => JSON.stringify([destination.backend, destination.id]))).size !== destinations.length) {
        throw new Error('Memory destination already belongs to another person or canonical memory.');
    }
}
export function bindMemoryEvent(state, personId, bookId) {
    if (personId !== null && !state.profiles.some(profile => profile.personId === personId))
        throw new Error('Unknown memory person.');
    const event = { kind: 'memory-bound', personId,
        before: structuredClone(memoryDestination(state, personId)), after: { backend: 'journal', id: bookId } };
    if (!validMemoryDestination(event.after))
        throw new Error('Memory destination is required.');
    const next = { ...state, memoryBindings: structuredClone(state.memoryBindings) };
    applyMemoryBinding(next, event);
    assertMemoryBindings(next);
    return event;
}
export function applyMemoryBinding(state, event) {
    if (event.personId === null)
        state.memoryBindings.canonical = structuredClone(event.after);
    else {
        const binding = { personId: event.personId, backend: event.after.backend, bookId: event.after.id };
        const index = state.memoryBindings.people.findIndex(binding => binding.personId === event.personId);
        if (index === -1)
            state.memoryBindings.people.push(binding);
        else
            state.memoryBindings.people[index] = binding;
    }
}
