import { sameValue } from "./events.js";
import { reopenedManaStrain } from "./strain.js";
const IMPACTS = ['Low', 'Normal', 'High', 'Massive'];
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
export function isAspectOperational(aspect) {
    return !!aspect && aspect.status === 'owned'
        && Array.isArray(aspect.track?.boxes) && aspect.track.boxes.includes('clear');
}
export function applyActionBattery(state, event, strainId = JSON.stringify([event.command.originalActionCommand.operationId, 'mana-strain'])) {
    if (!event.command.originalActionCommand.action.battery) {
        return { paidBoxes: [], strain: undefined };
    }
    const character = state.characters.find(entry => entry.id === event.command.refs.characterId);
    const play = state.classState.find(entry => entry.characterId === character.id);
    const core = character.aspects.find(entry => entry.id === 'core');
    if (!core)
        throw new Error('Origin Core aspect not found.');
    const costEntry = event.costs?.[0];
    const match = typeof costEntry === 'string' ? /^core-battery:(\d+),(\d+)$/.exec(costEntry) : null;
    if (!match)
        throw new Error('Invalid recorded Origin Core battery cost.');
    const paidBoxes = [Number(match[1]), Number(match[2])];
    if (paidBoxes[0] === paidBoxes[1] || paidBoxes.some(index => core.track.boxes[index] !== 'clear')) {
        throw new Error('Recorded Origin Core battery boxes are not clear.');
    }
    for (const index of paidBoxes) {
        core.track.boxes[index] = 'marked';
    }
    if (!core.track.boxes.includes('clear')) {
        const before = play.manaStrainId === null
            ? null
            : character.conditions.find(entry => entry.id === play.manaStrainId) ?? null;
        const resolvedStrainId = isNonEmptyString(strainId)
            ? strainId
            : (before?.id ?? JSON.stringify([event.command.originalActionCommand.operationId, 'mana-strain']));
        const after = reopenedManaStrain(before, resolvedStrainId);
        if (before) {
            const existingIndex = character.conditions.findIndex(entry => entry.id === before.id);
            character.conditions[existingIndex] = structuredClone(after);
        }
        else {
            character.conditions.push(structuredClone(after));
        }
        play.manaStrainId = after.id;
        return { paidBoxes, strain: { before: structuredClone(before), after: structuredClone(after) } };
    }
    return { paidBoxes, strain: null };
}
function buildInjuryCondition(character, boxes, injuryId, injuryName, injuryEffect) {
    if (!Number.isInteger(boxes) || boxes < 1 || boxes > 8) {
        throw new Error('Injury track must have between 1 and 8 boxes.');
    }
    if (injuryId !== undefined && !isNonEmptyString(injuryId)) {
        throw new Error('Injury ID must be a non-empty string.');
    }
    if (injuryName !== undefined && !isNonEmptyString(injuryName)) {
        throw new Error('Injury name must be a non-empty string.');
    }
    if (injuryEffect !== undefined && !isNonEmptyString(injuryEffect)) {
        throw new Error('Injury effect must be a non-empty string.');
    }
    const id = injuryId ?? JSON.stringify([character.id, 'injury', character.conditions.length]);
    if (character.conditions.some(entry => entry.id === id)) {
        throw new Error(`Duplicate condition ID: ${id}.`);
    }
    const name = injuryName ?? 'Injury';
    const effect = injuryEffect ?? 'Ongoing injury penalty.';
    return {
        id,
        name,
        kind: 'injuries',
        policy: 'minor-character/injuries',
        full: 'Healed',
        effect,
        track: {
            id: JSON.stringify([id, 'healing']),
            boxes: Array(boxes).fill('clear'),
        },
    };
}
export function decideHarm(state, command) {
    if (!command || command.kind !== 'apply-harm' || !Number.isInteger(command.marks) || command.marks < 1) {
        throw new Error('Harm requires a positive integer number of marks.');
    }
    const character = state.characters.find(entry => entry.id === state.playerCharacterId);
    const play = state.classState.find(entry => entry.characterId === character.id);
    if (command.targetAspectId === null) {
        if (command.overflowChoice !== undefined && command.overflowChoice !== 'injury') {
            throw new Error('Direct harm without a target aspect cannot burn aspect boxes.');
        }
        const createdInjury = buildInjuryCondition(character, command.marks, command.injuryId, command.injuryName, command.injuryEffect);
        return {
            kind: 'harm-applied',
            characterId: character.id,
            command: structuredClone(command),
            markedBoxes: [],
            burnedBoxes: [],
            createdInjury,
            strain: null,
        };
    }
    if (!isNonEmptyString(command.targetAspectId)) {
        throw new Error('Target aspect ID must be null or a non-empty string.');
    }
    const aspect = character.aspects.find(entry => entry.id === command.targetAspectId);
    const placement = play.placements.find(entry => entry.aspectId === command.targetAspectId);
    if (!aspect
        || aspect.status !== 'owned'
        || !placement
        || placement.location === 'archive'
        || (placement.location === 'card' && placement.classId !== play.activeClassId)) {
        throw new Error('Target aspect must be an active owned aspect.');
    }
    const clearIndices = aspect.track.boxes.flatMap((box, index) => box === 'clear' ? [index] : []);
    const markedBoxes = clearIndices.slice(0, command.marks);
    const overflow = Math.max(0, command.marks - clearIndices.length);
    let burnedBoxes = [];
    let createdInjury = null;
    const simulatedBoxes = [...aspect.track.boxes];
    for (const index of markedBoxes) {
        simulatedBoxes[index] = 'marked';
    }
    if (overflow > 0) {
        if (command.overflowChoice !== 'injury' && command.overflowChoice !== 'burn') {
            throw new Error('Overflow harm requires choosing injury or burn.');
        }
        if (command.overflowChoice === 'injury') {
            createdInjury = buildInjuryCondition(character, overflow, command.injuryId, command.injuryName, command.injuryEffect);
        }
        else {
            const markedCandidates = simulatedBoxes.flatMap((box, index) => box === 'marked' ? [index] : []);
            if (overflow > markedCandidates.length) {
                throw new Error('Target aspect does not have enough marked boxes to burn for overflow.');
            }
            burnedBoxes = markedCandidates.slice(0, overflow);
            for (const index of burnedBoxes) {
                simulatedBoxes[index] = 'burned';
            }
        }
    }
    let strain = null;
    if (command.targetAspectId === 'core' && !simulatedBoxes.includes('clear')) {
        const before = play.manaStrainId === null
            ? null
            : character.conditions.find(entry => entry.id === play.manaStrainId) ?? null;
        const resolvedStrainId = isNonEmptyString(command.strainId)
            ? command.strainId
            : (before?.id ?? JSON.stringify([character.id, 'strain', character.conditions.length + (createdInjury ? 1 : 0)]));
        strain = {
            before: structuredClone(before),
            after: reopenedManaStrain(before, resolvedStrainId),
        };
    }
    return {
        kind: 'harm-applied',
        characterId: character.id,
        command: structuredClone(command),
        markedBoxes,
        burnedBoxes,
        createdInjury,
        strain,
    };
}
export function applyHarmEvent(state, event) {
    const expected = decideHarm(state, event?.command);
    if (!sameValue(event, expected)) {
        throw new Error('Recorded harm event disagrees with state.');
    }
    const character = state.characters.find(entry => entry.id === event.characterId);
    const play = state.classState.find(entry => entry.characterId === event.characterId);
    if (event.command.targetAspectId !== null) {
        const aspect = character.aspects.find(entry => entry.id === event.command.targetAspectId);
        for (const index of event.markedBoxes) {
            aspect.track.boxes[index] = 'marked';
        }
        for (const index of event.burnedBoxes) {
            aspect.track.boxes[index] = 'burned';
        }
    }
    if (event.createdInjury) {
        character.conditions.push(structuredClone(event.createdInjury));
    }
    if (event.strain) {
        const after = structuredClone(event.strain.after);
        if (event.strain.before) {
            const existingIndex = character.conditions.findIndex(entry => entry.id === after.id);
            character.conditions[existingIndex] = after;
        }
        else {
            character.conditions.push(after);
        }
        play.manaStrainId = after.id;
    }
    return state;
}
function validateAndNormalizeTwist(state, twist) {
    const s = state;
    if (!twist || typeof twist !== 'object') {
        throw new Error('Invalid Twist choice.');
    }
    if (twist.kind === 'note') {
        if (!isNonEmptyString(twist.text)) {
            throw new Error('Twist note requires non-empty text.');
        }
        return { kind: 'note', text: twist.text };
    }
    if (twist.kind === 'bank') {
        if (!isNonEmptyString(twist.twistId) || !isNonEmptyString(twist.description)) {
            throw new Error('Banking a Twist requires a twistId and description.');
        }
        if (s.bankedTwists?.some(entry => entry.id === twist.twistId)) {
            throw new Error(`Duplicate banked Twist ID: ${twist.twistId}.`);
        }
        return { kind: 'bank', twistId: twist.twistId, description: twist.description };
    }
    if (twist.kind === 'critical') {
        const raw = twist;
        const elevatedImpact = raw.elevatedImpact ?? 'High';
        if (!IMPACTS.includes(elevatedImpact) || elevatedImpact === 'Low') {
            throw new Error('Critical Twist requires a valid elevated impact (Normal, High, or Massive).');
        }
        return { kind: 'critical', elevatedImpact };
    }
    if (twist.kind === 'counter') {
        if (!isNonEmptyString(twist.targetName) || twist.marks !== 1) {
            throw new Error('Counter Twist requires a targetName and marks: 1.');
        }
        if (twist.hazardId !== undefined) {
            if (!isNonEmptyString(twist.hazardId)) {
                throw new Error('Counter Twist hazardId must be a non-empty string.');
            }
            const hazard = (s.encounters?.hazards ?? s.hazards ?? []).find(entry => entry.id === twist.hazardId);
            if (!hazard || hazard.status === 'defeated') {
                throw new Error('Unknown or defeated hazard for Counter Twist.');
            }
            return { kind: 'counter', targetName: twist.targetName, marks: 1, hazardId: twist.hazardId };
        }
        return { kind: 'counter', targetName: twist.targetName, marks: 1 };
    }
    if (twist.kind === 'mystery-discovery') {
        if (!isNonEmptyString(twist.mysteryId) || !isNonEmptyString(twist.discoveryId) || !isNonEmptyString(twist.name)) {
            throw new Error('Mystery discovery Twist requires mysteryId, discoveryId, and name.');
        }
        const mystery = state.world.mysteries.find(entry => entry.id === twist.mysteryId);
        if (!mystery || mystery.truth !== null) {
            throw new Error('Mystery discovery Twist must target an open mystery.');
        }
        if (mystery.discoveries.length >= 3) {
            throw new Error('Mystery already has three small discoveries.');
        }
        if (mystery.discoveries.some(entry => entry.id === twist.discoveryId)) {
            throw new Error(`Duplicate mystery discovery ID: ${twist.discoveryId}.`);
        }
        return {
            kind: 'mystery-discovery',
            mysteryId: twist.mysteryId,
            discoveryId: twist.discoveryId,
            name: twist.name,
        };
    }
    throw new Error('Unsupported Twist choice.');
}
export function decideStakesAdjudication(state, command) {
    if (!command
        || command.kind !== 'adjudicate-stakes'
        || !state.pending
        || command.targetOperationId !== state.pending.operationId
        || !isNonEmptyString(command.note)) {
        throw new Error('Stakes adjudication must target the pending manual action and include a note.');
    }
    const harmEvent = command.harm !== undefined ? decideHarm(state, command.harm) : null;
    const twist = command.twist !== undefined ? validateAndNormalizeTwist(state, command.twist) : null;
    return {
        kind: 'stakes-adjudicated',
        command: structuredClone(command),
        harmEvent,
        twist,
        pending: null,
    };
}
export function applyStakesAdjudication(state, event) {
    const expected = decideStakesAdjudication(state, event?.command);
    if (!sameValue(event, expected)) {
        throw new Error('Recorded stakes adjudication disagrees with state.');
    }
    if (event.harmEvent !== null) {
        applyHarmEvent(state, event.harmEvent);
    }
    const s = state;
    const twist = event.twist;
    if (twist !== null) {
        if (twist.kind === 'bank') {
            s.bankedTwists ??= [];
            s.bankedTwists.push({
                id: twist.twistId,
                sceneId: state.world.scene.id,
                operationId: event.command.targetOperationId,
                description: twist.description,
                spent: false,
            });
        }
        else if (twist.kind === 'mystery-discovery') {
            const mystery = state.world.mysteries.find(entry => entry.id === twist.mysteryId);
            mystery.discoveries.push({ id: twist.discoveryId, name: twist.name });
        }
        else if (twist.kind === 'counter' && twist.hazardId) {
            const hazard = (s.encounters?.hazards ?? s.hazards ?? []).find(entry => entry.id === twist.hazardId);
            if (hazard) {
                hazard.marks = Math.min(hazard.limit, hazard.marks + 1);
                if (hazard.marks >= hazard.limit)
                    hazard.status = 'defeated';
            }
        }
    }
    state.pending = null;
    return state;
}
export function decideSpendBankedTwist(state, command) {
    if (!command
        || command.kind !== 'spend-banked-twist'
        || !isNonEmptyString(command.twistId)
        || !isNonEmptyString(command.note)) {
        throw new Error('Spending a banked Twist requires a twistId and note.');
    }
    const s = state;
    const twist = s.bankedTwists?.find(entry => entry.id === command.twistId);
    if (!twist) {
        throw new Error('Unknown banked Twist.');
    }
    if (twist.sceneId !== state.world.scene.id) {
        throw new Error('Banked Twist can only be spent in the scene where it was banked.');
    }
    if (twist.spent) {
        throw new Error('Banked Twist has already been spent.');
    }
    return {
        kind: 'banked-twist-spent',
        twistId: command.twistId,
        sceneId: state.world.scene.id,
        note: command.note,
    };
}
export function applySpendBankedTwist(state, event) {
    const expected = decideSpendBankedTwist(state, {
        kind: 'spend-banked-twist',
        twistId: event?.twistId,
        note: event?.note,
    });
    if (!sameValue(event, expected)) {
        throw new Error('Recorded banked Twist spend disagrees with state.');
    }
    const s = state;
    const twist = s.bankedTwists.find(entry => entry.id === event.twistId);
    twist.spent = true;
    twist.spentNote = event.note;
    return state;
}
export function spendBankedTwist(state, input) {
    const note = input.note ?? input.effectNote ?? '';
    const event = decideSpendBankedTwist(state, { kind: 'spend-banked-twist', twistId: input.twistId, note });
    applySpendBankedTwist(state, event);
    return event;
}
export function decideSystemRescue(state, command) {
    if (!command
        || command.kind !== 'spend-rescue'
        || !isNonEmptyString(command.catastropheAverted)
        || !isNonEmptyString(command.storyPrice)) {
        throw new Error('System Rescue requires catastropheAverted and storyPrice.');
    }
    const character = state.characters.find(entry => entry.id === state.playerCharacterId);
    const play = state.classState.find(entry => entry.characterId === character.id);
    if (play.rescues.remaining <= 0) {
        throw new Error('No System Rescues remaining.');
    }
    let clearedPending = false;
    if (command.targetOperationId !== undefined) {
        if (!isNonEmptyString(command.targetOperationId) || !state.pending || state.pending.operationId !== command.targetOperationId) {
            throw new Error('System Rescue targetOperationId must match the pending action.');
        }
        clearedPending = true;
    }
    let createdInjury = null;
    if (command.injury !== undefined) {
        if (!command.injury
            || typeof command.injury !== 'object'
            || !isNonEmptyString(command.injury.id)
            || !isNonEmptyString(command.injury.name)
            || !Number.isInteger(command.injury.boxes)
            || command.injury.boxes < 1
            || command.injury.boxes > 8
            || !isNonEmptyString(command.injury.effect)) {
            throw new Error('Invalid System Rescue injury.');
        }
        createdInjury = buildInjuryCondition(character, command.injury.boxes, command.injury.id, command.injury.name, command.injury.effect);
    }
    let markedExposureBox = null;
    if (command.markExposure !== undefined) {
        if (typeof command.markExposure !== 'boolean') {
            throw new Error('Invalid markExposure flag.');
        }
        if (command.markExposure) {
            const exposure = character.meters.find(entry => entry.policy === 'minor-character/exposure');
            const clearIndex = exposure.track.boxes.indexOf('clear');
            if (clearIndex === -1) {
                throw new Error('Exposure track has no clear boxes to mark.');
            }
            markedExposureBox = clearIndex;
        }
    }
    return {
        kind: 'rescue-spent',
        characterId: character.id,
        command: structuredClone(command),
        remainingBefore: play.rescues.remaining,
        remainingAfter: play.rescues.remaining - 1,
        createdInjury,
        markedExposureBox,
        clearedPending,
    };
}
export function applySystemRescue(state, event) {
    const expected = decideSystemRescue(state, event?.command);
    if (!sameValue(event, expected)) {
        throw new Error('Recorded System Rescue disagrees with state.');
    }
    const character = state.characters.find(entry => entry.id === event.characterId);
    const play = state.classState.find(entry => entry.characterId === event.characterId);
    play.rescues.remaining = event.remainingAfter;
    if (event.createdInjury) {
        character.conditions.push(structuredClone(event.createdInjury));
    }
    if (event.markedExposureBox !== null) {
        const exposure = character.meters.find(entry => entry.policy === 'minor-character/exposure');
        exposure.track.boxes[event.markedExposureBox] = 'marked';
    }
    if (event.clearedPending) {
        state.pending = null;
    }
    return state;
}
