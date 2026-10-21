/** Wording only: the command has no way to change severity, healing, policy or a pending roll. */
export function describeInjury(state, command) {
    if (!command || Object.keys(command).some(key => !['kind', 'injuryId', 'before', 'name', 'description'].includes(key))
        || command.kind !== 'describe-injury' || typeof command.injuryId !== 'string'
        || typeof command.name !== 'string' || !command.name.trim() || command.name.trim().length > 100
        || typeof command.description !== 'string' || !command.description.trim() || command.description.trim().length > 600) {
        throw new Error('Invalid injury wording. Use a name and a short description.');
    }
    const injury = state.characters.find(c => c.id === state.playerCharacterId)?.conditions.find(c => c.id === command.injuryId && c.kind === 'injuries');
    if (!injury || !command.before || Object.keys(command.before).some(key => !['name', 'effect'].includes(key))
        || injury.name !== command.before.name || injury.effect !== command.before.effect) {
        throw new Error('The injury changed; reopen its wording before saving.');
    }
    const play = state.classState.find(c => c.characterId === state.playerCharacterId);
    if (play?.manaStrainId === injury.id)
        throw new Error('Mana Strain wording is owned by the rules.');
    return { kind: 'injury-described', command: { ...structuredClone(command), name: command.name.trim(), description: command.description.trim() } };
}
