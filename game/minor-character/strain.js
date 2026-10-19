export function manaStrainCut(state, skill) {
    if (skill?.kind !== 'skill' || !['Channel', 'Weave'].includes(skill.name))
        return 0;
    const play = state.classState.find(entry => entry.characterId === state.playerCharacterId);
    if (play.manaStrainId === null)
        return 0;
    const character = state.characters.find(entry => entry.id === state.playerCharacterId);
    const injury = character.conditions.find(entry => entry.id === play.manaStrainId);
    return injury.track.boxes.every(box => box === 'marked') ? 0 : 1;
}
export function reopenedManaStrain(before, id) {
    if (before)
        return { ...structuredClone(before), track: { ...before.track, boxes: ['clear', 'clear'] } };
    return { id, name: 'Mana Strain', kind: 'injuries', policy: 'minor-character/injuries',
        full: 'Healed', effect: 'Cut 1 on Channel and Weave while open.',
        track: { id: JSON.stringify([id, 'healing']), boxes: ['clear', 'clear'] } };
}
