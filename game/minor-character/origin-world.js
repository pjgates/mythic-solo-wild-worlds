import { assertRecordedDice, rollPool } from "../../engine/dice.js";
import { sameValue } from "./events.js";
import { CLASS_ACQUISITION_BONUSES } from "./sheet.js";
import { validateMinorState } from "./validate-state.js";
const PERSONAL_ASPECT_IDS = new Set(['core', 'system', 'cub', 'marginalia']);
const VALID_ASPECT_TYPES = new Set(['trait', 'gear', 'companion']);
const VALID_KNIFE_STATUSES = new Set(['armed', 'sheathed', 'drawn', 'resolved', 'diverged']);
function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function playerContext(state) {
    const character = state.characters.find(entry => entry.id === state.playerCharacterId);
    const classState = state.classState.find(entry => entry.characterId === state.playerCharacterId);
    if (!character || !classState)
        throw new Error('Player character state is missing.');
    return { character, classState };
}
function campaignMeter(character, name) {
    const meter = character.meters.find(entry => entry.policy === `minor-character/${name}`);
    if (!meter)
        throw new Error(`Missing ${name} meter on character.`);
    return meter;
}
export function decideWitnessAndLearn(state, command) {
    if (!command || command.kind !== 'witness-and-learn') {
        throw new Error('Invalid witness-and-learn command.');
    }
    if (!command.newClass && !command.aspect) {
        throw new Error('Witness & Learn requires a new Class Card, a new Aspect, or both.');
    }
    const { character, classState } = playerContext(state);
    let addedClass = null;
    if (command.newClass) {
        const { id, name, tier, skillIds } = command.newClass;
        if (!nonEmpty(id) || !nonEmpty(name)) {
            throw new Error('Learned Class Card requires a non-empty id and name.');
        }
        if (classState.classes.some(entry => entry.id === id || entry.name === name)) {
            throw new Error('Learned Class Card id and name must be unique.');
        }
        if (!Object.hasOwn(CLASS_ACQUISITION_BONUSES, tier)) {
            throw new Error('Learned Class Card tier must be base, advanced, master, or rare.');
        }
        const bonuses = CLASS_ACQUISITION_BONUSES[tier];
        if (!Array.isArray(skillIds) || skillIds.length !== bonuses.length) {
            throw new Error(`A ${tier} class requires exactly ${bonuses.length} competence skill(s).`);
        }
        if (new Set(skillIds).size !== skillIds.length) {
            throw new Error('Class competence skills must be distinct.');
        }
        for (const skillId of skillIds) {
            const skill = character.skills.find(entry => entry.id === skillId);
            if (!skill || skill.category !== 'skill') {
                throw new Error('Class competence must reference canonical character skills, never Lores.');
            }
        }
        addedClass = {
            id,
            name,
            tier,
            competence: skillIds.map((skillId, index) => ({ skillId, bonus: bonuses[index] })),
        };
    }
    let addedDefinition = null;
    let addedAspect = null;
    let addedPlacement = null;
    if (command.aspect) {
        const { id, definitionId, name, type, boxes, rule, full, classId, operationId } = command.aspect;
        if (!nonEmpty(id) || !nonEmpty(definitionId) || !nonEmpty(name) || !nonEmpty(rule) || !nonEmpty(full)) {
            throw new Error('Learned Aspect requires non-empty id, definitionId, name, rule, and full text.');
        }
        if (!VALID_ASPECT_TYPES.has(type)) {
            throw new Error('Learned Aspect type must be trait, gear, or companion.');
        }
        if (!Number.isInteger(boxes) || boxes < 1 || boxes > 8) {
            throw new Error('Learned Aspect track boxes must be an integer between 1 and 8.');
        }
        if (PERSONAL_ASPECT_IDS.has(id) || character.aspects.some(entry => entry.id === id)) {
            throw new Error('Learned Aspect id must be unique.');
        }
        if (state.definitions.some(entry => entry.id === definitionId && entry.revision === 1)) {
            throw new Error('Learned Aspect definitionId already exists.');
        }
        if (operationId !== undefined && !nonEmpty(operationId)) {
            throw new Error('Learned Aspect operationId must be a non-empty string when provided.');
        }
        if (classId !== null) {
            const knownClass = classState.classes.some(entry => entry.id === classId) || addedClass?.id === classId;
            if (!knownClass) {
                throw new Error('Learned Aspect classId must reference an existing or newly learned Class Card.');
            }
        }
        addedDefinition = {
            id: definitionId,
            revision: 1,
            name,
            type,
            description: '',
            restrictions: [],
            effects: [{ kind: 'manual', text: rule }],
            full,
        };
        addedAspect = {
            id,
            name,
            definition: { id: definitionId, revision: 1 },
            track: {
                id: JSON.stringify([character.id, 'aspect', id, 'track']),
                boxes: Array.from({ length: boxes }, () => 'clear'),
            },
            status: 'owned',
            acquisition: {
                source: 'witness-and-learn',
                ...(operationId !== undefined ? { operationId } : {}),
            },
        };
        addedPlacement = {
            aspectId: id,
            location: 'archive',
            classId,
        };
    }
    return {
        kind: 'witness-and-learn-recorded',
        characterId: character.id,
        command: structuredClone(command),
        addedClass,
        addedDefinition,
        addedAspect,
        addedPlacement,
    };
}
export function applyWitnessAndLearn(state, event) {
    if (!event || event.kind !== 'witness-and-learn-recorded'
        || !sameValue(event, decideWitnessAndLearn(state, event.command))) {
        throw new Error('Recorded witness-and-learn event disagrees with history.');
    }
    const next = structuredClone(state);
    const { character, classState } = playerContext(next);
    if (event.addedClass) {
        classState.classes.push(structuredClone(event.addedClass));
    }
    if (event.addedDefinition && event.addedAspect && event.addedPlacement) {
        next.definitions.push(structuredClone(event.addedDefinition));
        character.aspects.push(structuredClone(event.addedAspect));
        classState.placements.push(structuredClone(event.addedPlacement));
    }
    validateMinorState(next);
    return next;
}
export function decideCardArrangement(state, command) {
    if (!command || command.kind !== 'arrange-cards') {
        throw new Error('Invalid card arrangement command.');
    }
    const hasCreate = command.createCard !== undefined;
    const hasPlacements = Array.isArray(command.placements) && command.placements.length > 0;
    const hasRetire = command.retireCardId !== undefined;
    if (!hasCreate && !hasPlacements && !hasRetire) {
        throw new Error('Card arrangement requires creating a card, moving placements, or retiring a card.');
    }
    const { character, classState } = playerContext(state);
    const beforeClasses = structuredClone(classState.classes);
    const beforePlacements = structuredClone(classState.placements);
    const afterClasses = structuredClone(classState.classes);
    const afterPlacements = structuredClone(classState.placements);
    if (command.createCard) {
        const { id, name } = command.createCard;
        if (!nonEmpty(id) || !nonEmpty(name)) {
            throw new Error('New Class Card requires a non-empty id and name.');
        }
        if (afterClasses.some(entry => entry.id === id || entry.name === name)) {
            throw new Error('Class Card id and name must be unique.');
        }
        afterClasses.push({
            id,
            name,
            tier: 'unknown',
            competence: [],
        });
    }
    if (command.placements !== undefined) {
        if (!Array.isArray(command.placements)) {
            throw new Error('Card arrangement placements must be an array.');
        }
        if (new Set(command.placements.map(entry => entry.aspectId)).size !== command.placements.length) {
            throw new Error('Duplicate aspectId in card arrangement placements.');
        }
        for (const move of command.placements) {
            if (!move || !nonEmpty(move.aspectId)) {
                throw new Error('Each placement update requires a non-empty aspectId.');
            }
            if (PERSONAL_ASPECT_IDS.has(move.aspectId)) {
                throw new Error('Personal aspects cannot be moved from personal.');
            }
            const existing = afterPlacements.find(entry => entry.aspectId === move.aspectId);
            const aspect = character.aspects.find(entry => entry.id === move.aspectId);
            if (!existing || !aspect) {
                throw new Error(`Unknown aspect ${move.aspectId}.`);
            }
            if (existing.location === 'personal') {
                throw new Error('Personal aspects cannot be moved from personal.');
            }
            if (move.location !== 'card' && move.location !== 'archive') {
                throw new Error('Aspect placement location must be card or archive.');
            }
            if (move.location === 'card') {
                if (aspect.status === 'retired') {
                    throw new Error('Retired aspects cannot be placed on a Class Card.');
                }
                if (move.classId === null || !afterClasses.some(entry => entry.id === move.classId)) {
                    throw new Error('Card placement requires a valid Class Card id.');
                }
            }
            else if (move.classId !== null && !afterClasses.some(entry => entry.id === move.classId)) {
                throw new Error('Archive placement classId must be null or a valid Class Card id.');
            }
            existing.location = move.location;
            existing.classId = move.classId;
        }
    }
    if (command.retireCardId !== undefined) {
        const retireId = command.retireCardId;
        if (!nonEmpty(retireId)) {
            throw new Error('retireCardId must be a non-empty string.');
        }
        const cardIndex = afterClasses.findIndex(entry => entry.id === retireId);
        if (cardIndex === -1) {
            throw new Error('Cannot retire an unknown Class Card.');
        }
        if (retireId === classState.activeClassId) {
            throw new Error('Cannot retire the active Class Card.');
        }
        if (afterPlacements.some(entry => entry.classId === retireId)) {
            throw new Error('Cannot retire a Class Card that still has aspects referencing it.');
        }
        if (afterClasses.some(entry => entry.sourceClassIds?.includes(retireId))) {
            throw new Error('Cannot retire a Class Card referenced in sourceClassIds.');
        }
        afterClasses.splice(cardIndex, 1);
    }
    for (const card of afterClasses) {
        const cardCount = afterPlacements.filter(entry => entry.location === 'card' && entry.classId === card.id).length;
        if (cardCount > 3) {
            throw new Error(`Class Card "${card.name}" cannot hold more than 3 aspects.`);
        }
    }
    const activeCount = afterPlacements.filter(placement => {
        const aspect = character.aspects.find(entry => entry.id === placement.aspectId);
        if (!aspect || aspect.status !== 'owned')
            return false;
        return placement.location === 'personal'
            || (placement.location === 'card' && placement.classId === classState.activeClassId);
    }).length;
    if (activeCount > 7) {
        throw new Error('Total active owned aspects across personal and the active Class Card cannot exceed 7.');
    }
    return {
        kind: 'cards-arranged',
        characterId: character.id,
        command: structuredClone(command),
        beforeClasses,
        afterClasses,
        beforePlacements,
        afterPlacements,
    };
}
export function applyCardArrangement(state, event) {
    if (!event || event.kind !== 'cards-arranged'
        || !sameValue(event, decideCardArrangement(state, event.command))) {
        throw new Error('Recorded card arrangement disagrees with history.');
    }
    const next = structuredClone(state);
    const { classState } = playerContext(next);
    classState.classes = structuredClone(event.afterClasses);
    classState.placements = structuredClone(event.afterPlacements);
    validateMinorState(next);
    return next;
}
export function decideExposure(state, command) {
    if (!command || command.kind !== 'record-exposure') {
        throw new Error('Invalid record-exposure command.');
    }
    if (!nonEmpty(command.witness) || !nonEmpty(command.description)) {
        throw new Error('Exposure incident requires a non-empty witness and description.');
    }
    const existingLog = state.exposureLog ?? [];
    const rawId = command.incidentId;
    const incidentId = rawId === undefined
        ? JSON.stringify(['exposure', existingLog.length + 1])
        : rawId;
    if (!nonEmpty(incidentId) || existingLog.some(entry => entry.id === incidentId)) {
        throw new Error('Exposure incident requires a unique non-empty incidentId.');
    }
    const { character } = playerContext(state);
    if (command.absorbWithCub) {
        const cub = character.aspects.find(entry => entry.id === 'cub' && entry.status === 'owned');
        if (!cub)
            throw new Error('The Cub aspect is not available to absorb Exposure.');
        const clearIndex = cub.track.boxes.findIndex(box => box === 'clear');
        if (clearIndex === -1) {
            throw new Error('The Cub has no clear boxes remaining to absorb Exposure.');
        }
        return {
            kind: 'exposure-recorded',
            characterId: character.id,
            incident: {
                id: incidentId,
                witness: command.witness,
                description: command.description,
                absorbedByCub: true,
                threshold: null,
                learnedFact: null,
            },
            markedCubBox: clearIndex,
            markedExposureBox: null,
            resetExposureTrack: false,
        };
    }
    const exposure = campaignMeter(character, 'exposure');
    const clearIndex = exposure.track.boxes.findIndex(box => box === 'clear');
    if (clearIndex === -1) {
        throw new Error('Exposure track has no clear boxes.');
    }
    const markedAfter = exposure.track.boxes.filter(box => box === 'marked').length + 1;
    const threshold = markedAfter === 2 ? 'rumour'
        : markedAfter === 4 ? 'suspicion'
            : markedAfter === 6 ? 'fact'
                : null;
    let learnedFact = null;
    let resetExposureTrack = false;
    if (threshold === 'fact') {
        if (!nonEmpty(command.learnedFact)) {
            throw new Error('Reaching 6 Exposure requires a non-empty learnedFact.');
        }
        learnedFact = command.learnedFact;
        resetExposureTrack = true;
    }
    return {
        kind: 'exposure-recorded',
        characterId: character.id,
        incident: {
            id: incidentId,
            witness: command.witness,
            description: command.description,
            absorbedByCub: false,
            threshold,
            learnedFact,
        },
        markedCubBox: null,
        markedExposureBox: clearIndex,
        resetExposureTrack,
    };
}
export function applyExposure(state, event) {
    if (!event || event.kind !== 'exposure-recorded' || !event.incident) {
        throw new Error('Invalid recorded exposure event.');
    }
    const reconstructed = {
        kind: 'record-exposure',
        incidentId: event.incident.id,
        witness: event.incident.witness,
        description: event.incident.description,
        ...(event.incident.absorbedByCub ? { absorbWithCub: true } : {}),
        ...(event.incident.learnedFact !== null ? { learnedFact: event.incident.learnedFact } : {}),
    };
    if (!sameValue(event, decideExposure(state, reconstructed))) {
        throw new Error('Recorded exposure event disagrees with history.');
    }
    const next = structuredClone(state);
    const { character } = playerContext(next);
    if (event.markedCubBox !== null) {
        const cub = character.aspects.find(entry => entry.id === 'cub');
        cub.track.boxes[event.markedCubBox] = 'marked';
    }
    if (event.markedExposureBox !== null) {
        const exposure = campaignMeter(character, 'exposure');
        if (event.resetExposureTrack) {
            exposure.track.boxes = exposure.track.boxes.map(() => 'clear');
        }
        else {
            exposure.track.boxes[event.markedExposureBox] = 'marked';
        }
    }
    next.exposureLog = [...(next.exposureLog ?? []), structuredClone(event.incident)];
    validateMinorState(next);
    return next;
}
function isRumorOrMarginNote(resource) {
    const kind = resource.kind.toLowerCase();
    return kind === 'rumor'
        || kind === 'margin note'
        || kind.includes('rumor')
        || resource.id === 'margin-note'
        || resource.name.toLowerCase().startsWith('margin note');
}
export function decideExposureCoverStory(state, command) {
    if (!command || command.kind !== 'clear-exposure') {
        throw new Error('Invalid clear-exposure command.');
    }
    if (!nonEmpty(command.resourceId) || !nonEmpty(command.story)) {
        throw new Error('Clearing Exposure requires a non-empty resourceId and cover story.');
    }
    const { character } = playerContext(state);
    const exposure = campaignMeter(character, 'exposure');
    const clearedBox = exposure.track.boxes.findIndex(box => box === 'marked');
    if (clearedBox === -1) {
        throw new Error('Exposure track has no marked boxes to clear.');
    }
    const resource = character.resources.find(entry => entry.id === command.resourceId);
    if (!resource || !isRumorOrMarginNote(resource)) {
        throw new Error('Clearing Exposure requires a Rumor or Margin Note resource.');
    }
    const retainedEchoingResource = resource.tags.some(tag => tag.name.toLowerCase() === 'echoing');
    return {
        kind: 'exposure-cleared',
        characterId: character.id,
        resourceId: command.resourceId,
        story: command.story,
        clearedBox,
        retainedEchoingResource,
    };
}
export function applyExposureCoverStory(state, event) {
    if (!event || event.kind !== 'exposure-cleared'
        || !sameValue(event, decideExposureCoverStory(state, {
            kind: 'clear-exposure',
            resourceId: event.resourceId,
            story: event.story,
        }))) {
        throw new Error('Recorded exposure cover story disagrees with history.');
    }
    const next = structuredClone(state);
    const { character } = playerContext(next);
    const exposure = campaignMeter(character, 'exposure');
    exposure.track.boxes[event.clearedBox] = 'clear';
    const resourceIndex = character.resources.findIndex(entry => entry.id === event.resourceId);
    const resource = character.resources[resourceIndex];
    if (event.retainedEchoingResource) {
        const tagIndex = resource.tags.findIndex(tag => tag.name.toLowerCase() === 'echoing');
        resource.tags.splice(tagIndex, 1);
    }
    else {
        character.resources.splice(resourceIndex, 1);
    }
    validateMinorState(next);
    return next;
}
export function decideRecallTheDraft(state, command, die) {
    if (!command || command.kind !== 'recall-draft') {
        throw new Error('Invalid recall-draft command.');
    }
    if (!nonEmpty(command.question)) {
        throw new Error('Recall the Draft requires a non-empty question.');
    }
    if (command.knifeId !== undefined) {
        if (!nonEmpty(command.knifeId) || !state.world.knives.some(knife => knife.id === command.knifeId)) {
            throw new Error('Unknown canon knife reference.');
        }
    }
    const { character, classState } = playerContext(state);
    if (classState.divergenceLevel >= 3) {
        throw new Error('Recall the Draft is unavailable at Divergence level 3.');
    }
    const canon = campaignMeter(character, 'canon');
    const markedCanonBox = canon.track.boxes.findIndex(box => box === 'clear');
    if (markedCanonBox === -1) {
        throw new Error('Canon track has no clear boxes remaining for Recall the Draft.');
    }
    const intermediateState = structuredClone(state);
    const intermediateCharacter = intermediateState.characters.find(entry => entry.id === character.id);
    const intermediateCanon = campaignMeter(intermediateCharacter, 'canon');
    intermediateCanon.track.boxes[markedCanonBox] = 'marked';
    const pool = intermediateCanon.track.boxes.filter(box => box === 'clear').length;
    const cut = classState.divergenceLevel;
    const roll = rollPool(pool, cut, die);
    const disasterDivergence = roll.outcome === 'Disaster'
        ? decideMarkDivergence(intermediateState, {
            kind: 'mark-divergence',
            severity: 1,
            reason: `Recall the Draft disaster: ${command.question}`,
            ...(command.knifeId !== undefined ? { knifeId: command.knifeId } : {}),
        })
        : null;
    return {
        kind: 'recall-draft-resolved',
        characterId: character.id,
        command: structuredClone(command),
        markedCanonBox,
        pool,
        cut,
        roll,
        disasterDivergence,
    };
}
export function applyRecallTheDraft(state, event) {
    if (!event || event.kind !== 'recall-draft-resolved') {
        throw new Error('Invalid recorded Recall the Draft event.');
    }
    assertRecordedDice(event.roll, event.cut);
    let drawIndex = 0;
    const expected = decideRecallTheDraft(state, event.command, () => event.roll.draws[drawIndex++] ?? 0);
    if (drawIndex !== event.roll.draws.length || !sameValue(event, expected)) {
        throw new Error('Recorded Recall the Draft event disagrees with history.');
    }
    let next = structuredClone(state);
    const { character } = playerContext(next);
    const canon = campaignMeter(character, 'canon');
    canon.track.boxes[event.markedCanonBox] = 'marked';
    if (event.disasterDivergence !== null) {
        next = applyMarkDivergence(next, event.disasterDivergence);
    }
    else {
        validateMinorState(next);
    }
    return next;
}
export function decideConfirmCanonBeat(state, command) {
    if (!command || command.kind !== 'confirm-canon-beat') {
        throw new Error('Invalid confirm-canon-beat command.');
    }
    if (!nonEmpty(command.knifeId) || !VALID_KNIFE_STATUSES.has(command.status)) {
        throw new Error('Confirming a canon beat requires a knifeId and valid status.');
    }
    const knife = state.world.knives.find(entry => entry.id === command.knifeId);
    if (!knife) {
        throw new Error('Unknown canon knife.');
    }
    const { character } = playerContext(state);
    let clearedCanonBox = null;
    if (command.status === 'resolved' && command.clearCanonMark !== false) {
        const canon = campaignMeter(character, 'canon');
        const markedIndex = canon.track.boxes.findIndex(box => box === 'marked');
        if (markedIndex !== -1) {
            clearedCanonBox = markedIndex;
        }
    }
    return {
        kind: 'canon-beat-confirmed',
        knifeId: command.knifeId,
        beforeStatus: knife.status,
        afterStatus: command.status,
        clearedCanonBox,
    };
}
export function applyConfirmCanonBeat(state, event) {
    if (!event || event.kind !== 'canon-beat-confirmed') {
        throw new Error('Invalid recorded canon-beat-confirmed event.');
    }
    const expected = decideConfirmCanonBeat(state, {
        kind: 'confirm-canon-beat',
        knifeId: event.knifeId,
        status: event.afterStatus,
        clearCanonMark: event.clearedCanonBox !== null,
    });
    if (event.clearedCanonBox === null && event.afterStatus === 'resolved') {
        // Allow explicit clearCanonMark: false OR no marked canon boxes to clear
        const { character } = playerContext(state);
        const canon = campaignMeter(character, 'canon');
        const hasMarked = canon.track.boxes.some(box => box === 'marked');
        if (hasMarked) {
            const explicitSkip = decideConfirmCanonBeat(state, {
                kind: 'confirm-canon-beat',
                knifeId: event.knifeId,
                status: event.afterStatus,
                clearCanonMark: false,
            });
            if (!sameValue(event, explicitSkip)) {
                throw new Error('Recorded canon beat confirmation disagrees with history.');
            }
        }
        else if (!sameValue(event, expected)) {
            throw new Error('Recorded canon beat confirmation disagrees with history.');
        }
    }
    else if (!sameValue(event, expected)) {
        throw new Error('Recorded canon beat confirmation disagrees with history.');
    }
    const next = structuredClone(state);
    const knife = next.world.knives.find(entry => entry.id === event.knifeId);
    knife.status = event.afterStatus;
    if (event.clearedCanonBox !== null) {
        const { character } = playerContext(next);
        const canon = campaignMeter(character, 'canon');
        canon.track.boxes[event.clearedCanonBox] = 'clear';
    }
    validateMinorState(next);
    return next;
}
export function decideMarkDivergence(state, command) {
    if (!command || command.kind !== 'mark-divergence') {
        throw new Error('Invalid mark-divergence command.');
    }
    if ((command.severity !== 1 && command.severity !== 2) || !nonEmpty(command.reason)) {
        throw new Error('Marking Divergence requires severity 1 or 2 and a non-empty reason.');
    }
    let knifeBeforeStatus;
    if (command.knifeId !== undefined) {
        if (!nonEmpty(command.knifeId))
            throw new Error('Invalid knifeId on mark-divergence command.');
        const knife = state.world.knives.find(entry => entry.id === command.knifeId);
        if (!knife)
            throw new Error('Unknown canon knife.');
        knifeBeforeStatus = knife.status;
    }
    const { character, classState } = playerContext(state);
    const divergence = campaignMeter(character, 'divergence');
    const canon = campaignMeter(character, 'canon');
    const beforeBoxes = structuredClone(divergence.track.boxes);
    const afterBoxes = structuredClone(divergence.track.boxes);
    const canonBoxes = structuredClone(canon.track.boxes);
    const beforeLevel = classState.divergenceLevel;
    let afterLevel = beforeLevel;
    let burnedCanonBox = null;
    for (let step = 0; step < command.severity; step++) {
        const clearIndex = afterBoxes.findIndex(box => box === 'clear');
        if (clearIndex === -1) {
            throw new Error('Divergence track has no clear boxes.');
        }
        afterBoxes[clearIndex] = 'marked';
        if (!afterBoxes.some(box => box !== 'marked')) {
            for (let i = 0; i < afterBoxes.length; i++)
                afterBoxes[i] = 'clear';
            afterLevel = Math.min(3, afterLevel + 1);
            let burnIndex = canonBoxes.findIndex(box => box === 'clear');
            if (burnIndex === -1) {
                burnIndex = canonBoxes.findIndex(box => box === 'marked');
            }
            if (burnIndex !== -1) {
                canonBoxes[burnIndex] = 'burned';
                burnedCanonBox = burnIndex;
            }
        }
    }
    return {
        kind: 'divergence-marked',
        characterId: character.id,
        command: structuredClone(command),
        beforeBoxes,
        afterBoxes,
        beforeLevel,
        afterLevel,
        burnedCanonBox,
        ...(knifeBeforeStatus !== undefined ? { knifeBeforeStatus } : {}),
    };
}
export function applyMarkDivergence(state, event) {
    if (!event || event.kind !== 'divergence-marked'
        || !sameValue(event, decideMarkDivergence(state, event.command))) {
        throw new Error('Recorded divergence event disagrees with history.');
    }
    const next = structuredClone(state);
    const { character, classState } = playerContext(next);
    const divergence = campaignMeter(character, 'divergence');
    const canon = campaignMeter(character, 'canon');
    divergence.track.boxes = structuredClone(event.afterBoxes);
    classState.divergenceLevel = event.afterLevel;
    if (event.burnedCanonBox !== null) {
        canon.track.boxes[event.burnedCanonBox] = 'burned';
    }
    if (event.command.knifeId !== undefined) {
        const knife = next.world.knives.find(entry => entry.id === event.command.knifeId);
        knife.status = 'diverged';
    }
    validateMinorState(next);
    return next;
}
export function decideMysteryDiscovery(state, command) {
    if (!command || command.kind !== 'record-mystery-discovery') {
        throw new Error('Invalid record-mystery-discovery command.');
    }
    if (!nonEmpty(command.mysteryId) || !nonEmpty(command.discoveryId) || !nonEmpty(command.name)) {
        throw new Error('Mystery discovery requires non-empty mysteryId, discoveryId, and name.');
    }
    const mystery = state.world.mysteries.find(entry => entry.id === command.mysteryId);
    if (!mystery) {
        throw new Error('Unknown mystery.');
    }
    if (mystery.truth !== null) {
        throw new Error('Mystery already has an accepted Grand Discovery.');
    }
    if (mystery.discoveries.length >= 3) {
        throw new Error('Mystery already has 3 small discoveries.');
    }
    if (mystery.discoveries.some(entry => entry.id === command.discoveryId)) {
        throw new Error('Duplicate discoveryId in mystery.');
    }
    return {
        kind: 'mystery-discovery-recorded',
        mysteryId: command.mysteryId,
        discovery: { id: command.discoveryId, name: command.name },
    };
}
export function applyMysteryDiscovery(state, event) {
    if (!event || event.kind !== 'mystery-discovery-recorded' || !event.discovery
        || !sameValue(event, decideMysteryDiscovery(state, {
            kind: 'record-mystery-discovery',
            mysteryId: event.mysteryId,
            discoveryId: event.discovery.id,
            name: event.discovery.name,
        }))) {
        throw new Error('Recorded mystery discovery disagrees with history.');
    }
    const next = structuredClone(state);
    const mystery = next.world.mysteries.find(entry => entry.id === event.mysteryId);
    mystery.discoveries.push(structuredClone(event.discovery));
    validateMinorState(next);
    return next;
}
export function decideGrandDiscovery(state, command) {
    if (!command || command.kind !== 'accept-grand-discovery') {
        throw new Error('Invalid accept-grand-discovery command.');
    }
    if (!nonEmpty(command.mysteryId) || !nonEmpty(command.truth)) {
        throw new Error('Accepting a Grand Discovery requires a non-empty mysteryId and truth.');
    }
    const mystery = state.world.mysteries.find(entry => entry.id === command.mysteryId);
    if (!mystery) {
        throw new Error('Unknown mystery.');
    }
    if (mystery.discoveries.length !== 3) {
        throw new Error('Accepting a Grand Discovery requires 3 small discoveries first.');
    }
    return {
        kind: 'grand-discovery-accepted',
        mysteryId: command.mysteryId,
        beforeTruth: mystery.truth,
        truth: command.truth,
    };
}
export function applyGrandDiscovery(state, event) {
    if (!event || event.kind !== 'grand-discovery-accepted'
        || !sameValue(event, decideGrandDiscovery(state, {
            kind: 'accept-grand-discovery',
            mysteryId: event.mysteryId,
            truth: event.truth,
        }))) {
        throw new Error('Recorded Grand Discovery disagrees with history.');
    }
    const next = structuredClone(state);
    const mystery = next.world.mysteries.find(entry => entry.id === event.mysteryId);
    mystery.truth = event.truth;
    validateMinorState(next);
    return next;
}
