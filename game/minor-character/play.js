import { ELEMENTS } from "./state.js";
import { reopenedManaStrain } from "./strain.js";
import { validSceneStartAnchor } from "./scene-anchor.js";
export function reanchorScene(state, startAnchor) {
    if (state.pending)
        throw new Error('Finish the pending manual adjudication first.');
    if (!validSceneStartAnchor(startAnchor) || startAnchor.binding !== state.world.scene.startAnchor.binding) {
        throw new Error('Invalid scene start anchor.');
    }
    return {
        kind: 'scene-reanchored',
        before: structuredClone(state.world.scene.startAnchor),
        after: structuredClone(startAnchor),
        cancelledReviewId: state.sceneReview?.id ?? null,
    };
}
export function manifestElement(state, element) {
    if (!ELEMENTS.includes(element))
        throw new Error('Choose a canonical element.');
    const play = state.classState.find(entry => entry.characterId === state.playerCharacterId);
    if (play.manifestedElement === element)
        throw new Error('That element is already selected.');
    return { kind: 'element-manifested', characterId: state.playerCharacterId,
        before: play.manifestedElement, after: element };
}
export function sceneBoundary(state, sceneId, nextId, startAnchor = state.world.scene.startAnchor) {
    if (state.pending)
        throw new Error('Finish the pending manual adjudication first.');
    if (sceneId !== state.world.scene.id)
        throw new Error('Scene has changed; reopen its confirmation.');
    const number = state.world.scene.number + 1;
    if (typeof nextId !== 'string' || !nextId.trim() || nextId === sceneId || !Number.isSafeInteger(number)) {
        throw new Error('Invalid next scene identity.');
    }
    const previous = state.world.scene.startAnchor;
    if (!validSceneStartAnchor(startAnchor) || startAnchor.binding !== previous.binding
        || startAnchor.nextMessageIndex < previous.nextMessageIndex
        || (startAnchor.nextMessageIndex === previous.nextMessageIndex
            && startAnchor.prefixFingerprint !== previous.prefixFingerprint))
        throw new Error('Invalid scene boundary anchor.');
    return { kind: 'scene-advanced', before: structuredClone(state.world.scene),
        after: { id: nextId, number, startAnchor: structuredClone(startAnchor) } };
}
export function switchClass(state, classId, strainId) {
    if (state.pending)
        throw new Error('Finish the pending manual adjudication first.');
    const play = state.classState.find(entry => entry.characterId === state.playerCharacterId);
    if (!play.classes.some(entry => entry.id === classId))
        throw new Error('Choose a learned Class Card.');
    if (play.activeClassId === classId)
        throw new Error('That class is already active.');
    const character = state.characters.find(entry => entry.id === state.playerCharacterId);
    const core = character.aspects.find(entry => entry.id === 'core');
    const clear = core.track.boxes.flatMap((box, index) => box === 'clear' ? [index] : []);
    const cost = play.switchesThisScene + 1;
    if (cost > clear.length)
        throw new Error('Origin Core cannot afford that Fatigue cost.');
    const before = play.manaStrainId === null ? null
        : character.conditions.find(entry => entry.id === play.manaStrainId);
    return { kind: 'class-switched', characterId: character.id, sceneId: state.world.scene.id,
        beforeClassId: play.activeClassId, afterClassId: classId, switchesBefore: play.switchesThisScene,
        paidBoxes: clear.slice(0, cost), strain: cost === clear.length
            ? { before: structuredClone(before), after: reopenedManaStrain(before, strainId) } : null };
}
