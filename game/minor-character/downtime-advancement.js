import { resolveAspect } from "../../engine/definitions.js";
import { sameValue } from "./events.js";
import { RANKS } from "./sheet.js";
import { reopenedManaStrain } from "./strain.js";
export const BREAKTHROUGH_BOXES = {
    E: 4,
    D: 5,
    C: 6,
    B: 6,
    A: 7,
    S: 8,
    SS: 8,
};
function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function getPlayer(state) {
    const character = state.characters.find(entry => entry.id === state.playerCharacterId);
    const classState = state.classState.find(entry => entry.characterId === state.playerCharacterId);
    if (!character || !classState)
        throw new Error('Player character state not found.');
    return { character, classState };
}
function isRumorOrMarginNote(resource) {
    return (resource.kind === 'Rumor' ||
        resource.kind === 'Margin Note' ||
        resource.kind === 'Rumor or Intel, once' ||
        resource.id === 'margin-note' ||
        resource.name.startsWith('Margin Note'));
}
function isAspectCompatibleWithResource(state, aspect, resource) {
    const def = resolveAspect(state.definitions, aspect.definition);
    if (aspect.id === 'system' || def.type === 'gear') {
        return resource.kind === 'Loot';
    }
    if (def.type === 'trait' || def.type === 'companion') {
        return resource.kind === 'Reagent';
    }
    return false;
}
export function decideResourceRecovery(state, command) {
    if (!command || command.kind !== 'recover-with-resource') {
        throw new Error('Invalid resource recovery command.');
    }
    const { character, classState } = getPlayer(state);
    const resource = character.resources.find(entry => entry.id === command.resourceId);
    if (!resource)
        throw new Error(`Resource ${command.resourceId} not found.`);
    const hasPure = resource.kind === 'Reagent' && resource.tags.some(tag => tag.name === 'Pure');
    const hasSturdy = resource.kind === 'Loot' && resource.tags.some(tag => tag.name === 'Sturdy');
    const amount = hasPure || hasSturdy ? 2 : 1;
    if (command.targetKind === 'aspect') {
        const aspect = character.aspects.find(entry => entry.id === command.targetId && entry.status === 'owned');
        if (!aspect)
            throw new Error(`Owned aspect ${command.targetId} not found.`);
        if (!isAspectCompatibleWithResource(state, aspect, resource)) {
            throw new Error(`Resource ${resource.kind} is not compatible with aspect ${aspect.id}.`);
        }
        const markedIndices = aspect.track.boxes.flatMap((box, index) => (box === 'marked' ? [index] : []));
        if (markedIndices.length === 0) {
            throw new Error('Aspect has no recoverable marked boxes (burned boxes cannot be cleared by ordinary recovery).');
        }
        return {
            kind: 'resource-recovered',
            characterId: character.id,
            command: structuredClone(command),
            boxesChanged: markedIndices.slice(0, amount),
            retainedEchoing: false,
            injuryRemoved: false,
        };
    }
    if (command.targetKind === 'injury') {
        if (resource.kind !== 'Reagent' && resource.kind !== 'Loot') {
            throw new Error('Only Reagent or Loot can mark healing boxes on an injury.');
        }
        const injury = character.conditions.find(entry => entry.id === command.targetId && entry.kind === 'injuries');
        if (!injury)
            throw new Error(`Injury ${command.targetId} not found.`);
        const clearIndices = injury.track.boxes.flatMap((box, index) => (box === 'clear' ? [index] : []));
        if (clearIndices.length === 0) {
            throw new Error('Injury has no clear healing boxes remaining.');
        }
        const boxesChanged = clearIndices.slice(0, amount);
        const afterBoxes = injury.track.boxes.map((box, index) => boxesChanged.includes(index) ? 'marked' : box);
        const allMarked = afterBoxes.every(box => box === 'marked');
        const injuryRemoved = allMarked && injury.id !== classState.manaStrainId;
        return {
            kind: 'resource-recovered',
            characterId: character.id,
            command: structuredClone(command),
            boxesChanged,
            retainedEchoing: false,
            injuryRemoved,
        };
    }
    if (command.targetKind === 'mire') {
        if (!isRumorOrMarginNote(resource)) {
            throw new Error('Only a Rumor or Margin Note can clear a Mire box.');
        }
        const mire = character.impulses.find(entry => entry.id === command.targetId && entry.type === 'tracked');
        if (!mire || mire.type !== 'tracked')
            throw new Error(`Mire ${command.targetId} not found.`);
        const markedIndices = mire.track.boxes.flatMap((box, index) => (box === 'marked' ? [index] : []));
        if (markedIndices.length === 0) {
            throw new Error('Mire has no marked boxes to clear.');
        }
        const retainedEchoing = resource.kind === 'Rumor' && resource.tags.some(tag => tag.name === 'Echoing');
        return {
            kind: 'resource-recovered',
            characterId: character.id,
            command: structuredClone(command),
            boxesChanged: [markedIndices[0]],
            retainedEchoing,
            injuryRemoved: false,
        };
    }
    throw new Error('Unsupported recovery target kind.');
}
export function applyResourceRecovery(state, event) {
    const expected = decideResourceRecovery(state, event.command);
    if (!sameValue(event, expected)) {
        throw new Error('Recorded resource recovery disagrees with state.');
    }
    const next = structuredClone(state);
    const { character } = getPlayer(next);
    const { resourceId, targetKind, targetId } = event.command;
    if (targetKind === 'aspect') {
        const aspect = character.aspects.find(entry => entry.id === targetId);
        for (const index of event.boxesChanged) {
            aspect.track.boxes[index] = 'clear';
        }
    }
    else if (targetKind === 'injury') {
        const injuryIndex = character.conditions.findIndex(entry => entry.id === targetId && entry.kind === 'injuries');
        const injury = character.conditions[injuryIndex];
        for (const index of event.boxesChanged) {
            injury.track.boxes[index] = 'marked';
        }
        if (event.injuryRemoved) {
            character.conditions.splice(injuryIndex, 1);
        }
    }
    else if (targetKind === 'mire') {
        const mire = character.impulses.find(entry => entry.id === targetId && entry.type === 'tracked');
        if (mire && mire.type === 'tracked') {
            for (const index of event.boxesChanged) {
                mire.track.boxes[index] = 'clear';
            }
        }
    }
    if (event.retainedEchoing) {
        const resource = character.resources.find(entry => entry.id === resourceId);
        const echoIndex = resource.tags.findIndex(tag => tag.name === 'Echoing');
        if (echoIndex >= 0)
            resource.tags.splice(echoIndex, 1);
    }
    else {
        character.resources = character.resources.filter(entry => entry.id !== resourceId);
    }
    return next;
}
export function decideCreateBenefit(state, command) {
    if (!command || command.kind !== 'create-benefit') {
        throw new Error('Invalid create-benefit command.');
    }
    if (!Array.isArray(command.resourceIds) ||
        command.resourceIds.length !== 2 ||
        !nonEmpty(command.resourceIds[0]) ||
        !nonEmpty(command.resourceIds[1]) ||
        command.resourceIds[0] === command.resourceIds[1]) {
        throw new Error('Create benefit requires 2 distinct resource IDs.');
    }
    if (!nonEmpty(command.benefitId) || !nonEmpty(command.name) || !nonEmpty(command.effect)) {
        throw new Error('Benefit requires a non-empty ID, name, and effect.');
    }
    const { character } = getPlayer(state);
    for (const resId of command.resourceIds) {
        if (!character.resources.some(entry => entry.id === resId)) {
            throw new Error(`Resource ${resId} not found.`);
        }
    }
    if (character.conditions.some(entry => entry.id === command.benefitId)) {
        throw new Error(`Condition ${command.benefitId} already exists.`);
    }
    const benefit = {
        id: command.benefitId,
        name: command.name,
        kind: 'benefits',
        policy: 'minor-character/benefits',
        full: 'Benefit spent.',
        effect: command.effect,
        track: {
            id: JSON.stringify([character.id, 'benefits', command.benefitId, 'track']),
            boxes: ['clear', 'clear'],
        },
    };
    return {
        kind: 'benefit-created',
        characterId: character.id,
        resourceIds: [command.resourceIds[0], command.resourceIds[1]],
        benefit,
    };
}
export function applyCreateBenefit(state, event) {
    const expected = decideCreateBenefit(state, {
        kind: 'create-benefit',
        resourceIds: event.resourceIds,
        benefitId: event.benefit.id,
        name: event.benefit.name,
        effect: event.benefit.effect,
    });
    if (!sameValue(event, expected)) {
        throw new Error('Recorded benefit creation disagrees with state.');
    }
    const next = structuredClone(state);
    const { character } = getPlayer(next);
    character.resources = character.resources.filter(entry => !event.resourceIds.includes(entry.id));
    character.conditions.push(structuredClone(event.benefit));
    return next;
}
export function decideResourceAcquireTrade(state, command) {
    if (!command || command.kind !== 'acquire-trade-resource') {
        throw new Error('Invalid acquire-trade-resource command.');
    }
    const { character } = getPlayer(state);
    const resourcePayload = command.resource ?? command.gainedResource;
    const targetResourceId = command.targetResourceId ?? command.resourceId;
    if (command.action === 'acquire') {
        if (!resourcePayload ||
            !nonEmpty(resourcePayload.id) ||
            !nonEmpty(resourcePayload.name) ||
            !nonEmpty(resourcePayload.kind) ||
            !nonEmpty(resourcePayload.source) ||
            !Array.isArray(resourcePayload.tags) ||
            !resourcePayload.tags.every(tag => nonEmpty(tag.id) && nonEmpty(tag.name))) {
            throw new Error('Invalid acquired resource payload.');
        }
        if (character.resources.some(entry => entry.id === resourcePayload.id)) {
            throw new Error(`Resource ${resourcePayload.id} already exists.`);
        }
        return {
            kind: 'resource-acquired-traded',
            characterId: character.id,
            command: structuredClone(command),
        };
    }
    if (command.action === 'trade') {
        if (!nonEmpty(command.spendResourceId)) {
            throw new Error('Trade requires spendResourceId.');
        }
        if (!character.resources.some(entry => entry.id === command.spendResourceId)) {
            throw new Error(`Spent resource ${command.spendResourceId} not found.`);
        }
        if (!resourcePayload ||
            !nonEmpty(resourcePayload.id) ||
            !nonEmpty(resourcePayload.name) ||
            !nonEmpty(resourcePayload.kind) ||
            !nonEmpty(resourcePayload.source) ||
            !Array.isArray(resourcePayload.tags) ||
            !resourcePayload.tags.every(tag => nonEmpty(tag.id) && nonEmpty(tag.name))) {
            throw new Error('Invalid traded resource payload.');
        }
        if (resourcePayload.id !== command.spendResourceId &&
            character.resources.some(entry => entry.id === resourcePayload.id)) {
            throw new Error(`Resource ${resourcePayload.id} already exists.`);
        }
        return {
            kind: 'resource-acquired-traded',
            characterId: character.id,
            command: structuredClone(command),
        };
    }
    if (command.action === 'add-tag') {
        if (!nonEmpty(targetResourceId)) {
            throw new Error('Adding a tag requires targetResourceId.');
        }
        const target = character.resources.find(entry => entry.id === targetResourceId);
        if (!target)
            throw new Error(`Target resource ${targetResourceId} not found.`);
        if (!command.tag || !nonEmpty(command.tag.id) || !nonEmpty(command.tag.name)) {
            throw new Error('Adding a tag requires a valid tag ID and name.');
        }
        if (target.tags.some(tag => tag.id === command.tag.id || tag.name === command.tag.name)) {
            throw new Error(`Tag ${command.tag.name} already exists on resource ${targetResourceId}.`);
        }
        return {
            kind: 'resource-acquired-traded',
            characterId: character.id,
            command: structuredClone(command),
        };
    }
    throw new Error('Unsupported resource acquire/trade action.');
}
export function applyResourceAcquireTrade(state, event) {
    const expected = decideResourceAcquireTrade(state, event.command);
    if (!sameValue(event, expected)) {
        throw new Error('Recorded resource acquire/trade disagrees with state.');
    }
    const next = structuredClone(state);
    const { character } = getPlayer(next);
    const cmd = event.command;
    const resourcePayload = cmd.resource ?? cmd.gainedResource;
    const targetResourceId = cmd.targetResourceId ?? cmd.resourceId;
    if (cmd.action === 'acquire') {
        character.resources.push(structuredClone(resourcePayload));
    }
    else if (cmd.action === 'trade') {
        const idx = character.resources.findIndex(entry => entry.id === cmd.spendResourceId);
        character.resources.splice(idx, 1, structuredClone(resourcePayload));
    }
    else if (cmd.action === 'add-tag') {
        const target = character.resources.find(entry => entry.id === targetResourceId);
        target.tags.push(structuredClone(cmd.tag));
    }
    return next;
}
export function decideBurnRecovery(state, command) {
    if (!command || command.kind !== 'complete-burn-recovery') {
        throw new Error('Invalid burn recovery command.');
    }
    const { character } = getPlayer(state);
    const project = character.advancement.find(entry => entry.type === 'project' && entry.id === command.projectId);
    if (!project || project.type !== 'project') {
        throw new Error(`Project ${command.projectId} not found.`);
    }
    if (!project.earned || project.track.boxes.length !== 3) {
        throw new Error('Burn recovery requires an earned 3-box project.');
    }
    const aspect = character.aspects.find(entry => entry.id === command.aspectId && entry.status === 'owned');
    if (!aspect)
        throw new Error(`Owned aspect ${command.aspectId} not found.`);
    const resource = character.resources.find(entry => entry.id === command.resourceId);
    if (!resource)
        throw new Error(`Resource ${command.resourceId} not found.`);
    if (!isAspectCompatibleWithResource(state, aspect, resource)) {
        throw new Error(`Resource ${resource.kind} is not compatible with aspect ${aspect.id} for burn recovery.`);
    }
    const clearedBurnBoxes = aspect.track.boxes.flatMap((box, index) => box === 'burned' ? [index] : []);
    if (clearedBurnBoxes.length === 0) {
        throw new Error('Aspect has no burned boxes to recover.');
    }
    return {
        kind: 'burn-recovered',
        characterId: character.id,
        command: structuredClone(command),
        clearedBurnBoxes,
    };
}
export function applyBurnRecovery(state, event) {
    const expected = decideBurnRecovery(state, event.command);
    if (!sameValue(event, expected)) {
        throw new Error('Recorded burn recovery disagrees with state.');
    }
    const next = structuredClone(state);
    const { character } = getPlayer(next);
    const project = character.advancement.find(entry => entry.type === 'project' && entry.id === event.command.projectId);
    if (project && project.type === 'project') {
        project.earned = false;
    }
    const aspect = character.aspects.find(entry => entry.id === event.command.aspectId);
    for (const index of event.clearedBurnBoxes) {
        aspect.track.boxes[index] = 'clear';
    }
    character.resources = character.resources.filter(entry => entry.id !== event.command.resourceId);
    return next;
}
export function decideDriveAdvance(state, command) {
    if (!command || command.kind !== 'advance-drive') {
        throw new Error('Invalid advance-drive command.');
    }
    const ext = state;
    const { character } = getPlayer(state);
    const drive = character.impulses.find(entry => entry.type === 'text' && entry.id === command.driveId);
    if (!drive || drive.type !== 'text') {
        throw new Error(`Drive ${command.driveId} not found.`);
    }
    const allowance = ext.milestoneAllowance ?? { minorThisSession: 0, majorThisArc: 0 };
    const reward = command.reward;
    if (reward.kind === 'rumor') {
        if (!nonEmpty(reward.resourceId) || !nonEmpty(reward.name) || !nonEmpty(reward.source)) {
            throw new Error('Rumor reward requires a non-empty resourceId, name, and source.');
        }
        if (character.resources.some(entry => entry.id === reward.resourceId)) {
            throw new Error(`Resource ${reward.resourceId} already exists.`);
        }
        if (reward.tags && !reward.tags.every(tag => nonEmpty(tag.id) && nonEmpty(tag.name))) {
            throw new Error('Invalid rumor reward tags.');
        }
        return {
            kind: 'drive-advanced',
            characterId: character.id,
            command: structuredClone(command),
            beforeDriveName: drive.name,
        };
    }
    if (reward.kind === 'clear-mire') {
        const mire = character.impulses.find(entry => entry.type === 'tracked' && entry.id === reward.mireId);
        if (!mire || mire.type !== 'tracked') {
            throw new Error(`Mire ${reward.mireId} not found.`);
        }
        const markedBox = mire.track.boxes.findIndex(box => box === 'marked');
        if (markedBox < 0) {
            throw new Error('Mire has no marked boxes to clear.');
        }
        return {
            kind: 'drive-advanced',
            characterId: character.id,
            command: structuredClone(command),
            clearedMireBox: markedBox,
            beforeDriveName: drive.name,
        };
    }
    if (reward.kind === 'minor-milestone') {
        if (allowance.minorThisSession >= 1) {
            throw new Error('At most 1 minor milestone may be earned per session.');
        }
        if (!nonEmpty(reward.milestoneId) || !nonEmpty(reward.name)) {
            throw new Error('Minor milestone requires a non-empty milestoneId and name.');
        }
        if (character.advancement.some(entry => entry.id === reward.milestoneId)) {
            throw new Error(`Advancement entry ${reward.milestoneId} already exists.`);
        }
        return {
            kind: 'drive-advanced',
            characterId: character.id,
            command: structuredClone(command),
            beforeDriveName: drive.name,
        };
    }
    if (reward.kind === 'major-milestone') {
        if (allowance.majorThisArc >= 1) {
            throw new Error('At most 1 major milestone may be earned per arc.');
        }
        if (!nonEmpty(reward.milestoneId) ||
            !nonEmpty(reward.name) ||
            !nonEmpty(reward.newDriveName) ||
            reward.newDriveName === drive.name) {
            throw new Error('Major milestone requires a new Drive name and non-empty milestone identity.');
        }
        if (character.advancement.some(entry => entry.id === reward.milestoneId)) {
            throw new Error(`Advancement entry ${reward.milestoneId} already exists.`);
        }
        return {
            kind: 'drive-advanced',
            characterId: character.id,
            command: structuredClone(command),
            beforeDriveName: drive.name,
        };
    }
    throw new Error('Unsupported drive advancement reward.');
}
export function applyDriveAdvance(state, event) {
    const expected = decideDriveAdvance(state, event.command);
    if (!sameValue(event, expected)) {
        throw new Error('Recorded drive advancement disagrees with state.');
    }
    const next = structuredClone(state);
    const { character } = getPlayer(next);
    const drive = character.impulses.find(entry => entry.type === 'text' && entry.id === event.command.driveId);
    const reward = event.command.reward;
    if (reward.kind === 'rumor') {
        character.resources.push({
            id: reward.resourceId,
            name: reward.name,
            kind: 'Rumor',
            tags: structuredClone(reward.tags ?? []),
            source: reward.source,
        });
    }
    else if (reward.kind === 'clear-mire') {
        const mire = character.impulses.find(entry => entry.type === 'tracked' && entry.id === reward.mireId);
        if (mire && mire.type === 'tracked') {
            mire.track.boxes[event.clearedMireBox] = 'clear';
        }
    }
    else if (reward.kind === 'minor-milestone') {
        const allowance = next.milestoneAllowance ?? { minorThisSession: 0, majorThisArc: 0 };
        next.milestoneAllowance = {
            minorThisSession: allowance.minorThisSession + 1,
            majorThisArc: allowance.majorThisArc,
        };
        character.advancement.push({
            id: reward.milestoneId,
            name: reward.name,
            type: 'milestone',
            kind: 'minor',
            spentOn: null,
        });
    }
    else if (reward.kind === 'major-milestone') {
        const allowance = next.milestoneAllowance ?? { minorThisSession: 0, majorThisArc: 0 };
        next.milestoneAllowance = {
            minorThisSession: allowance.minorThisSession,
            majorThisArc: allowance.majorThisArc + 1,
        };
        drive.name = reward.newDriveName;
        character.advancement.push({
            id: reward.milestoneId,
            name: reward.name,
            type: 'milestone',
            kind: 'major',
            spentOn: null,
        });
    }
    return next;
}
export function decideMilestoneBoundary(state, command) {
    if (!command || command.kind !== 'milestone-boundary' || !['session', 'arc'].includes(command.boundary)) {
        throw new Error('Invalid milestone boundary command.');
    }
    const ext = state;
    const beforeAllowance = structuredClone(ext.milestoneAllowance ?? { minorThisSession: 0, majorThisArc: 0 });
    const afterAllowance = command.boundary === 'arc'
        ? { minorThisSession: 0, majorThisArc: 0 }
        : { minorThisSession: 0, majorThisArc: beforeAllowance.majorThisArc };
    return {
        kind: 'milestone-boundary-reset',
        boundary: command.boundary,
        beforeAllowance,
        afterAllowance,
    };
}
export function applyMilestoneBoundary(state, event) {
    const expected = decideMilestoneBoundary(state, {
        kind: 'milestone-boundary',
        boundary: event.boundary,
    });
    if (!sameValue(event, expected)) {
        throw new Error('Recorded milestone boundary disagrees with state.');
    }
    const next = structuredClone(state);
    next.milestoneAllowance = structuredClone(event.afterAllowance);
    if (event.boundary === 'arc' && next.coreDevelopments) {
        next.coreDevelopments.awakeningUsedThisArc = false;
    }
    return next;
}
export function decideProjectCreation(state, command) {
    if (!command ||
        command.kind !== 'start-project' ||
        !nonEmpty(command.id) ||
        !nonEmpty(command.name) ||
        !nonEmpty(command.rule) ||
        (command.boxes !== 3 && command.boxes !== 6)) {
        throw new Error('Invalid start-project command.');
    }
    const { character } = getPlayer(state);
    if (character.advancement.some(entry => entry.id === command.id)) {
        throw new Error(`Advancement entry ${command.id} already exists.`);
    }
    const project = {
        id: command.id,
        name: command.name,
        policy: 'minor-character/project',
        full: 'Project earned.',
        type: 'project',
        earned: false,
        rule: command.rule,
        track: {
            id: JSON.stringify([character.id, 'project', command.id, 'track']),
            boxes: Array(command.boxes).fill('clear'),
        },
    };
    return {
        kind: 'project-started',
        characterId: character.id,
        project,
    };
}
export function applyProjectCreation(state, event) {
    const expected = decideProjectCreation(state, {
        kind: 'start-project',
        id: event.project.id,
        name: event.project.name,
        boxes: event.project.track.boxes.length,
        rule: event.project.rule,
    });
    if (!sameValue(event, expected)) {
        throw new Error('Recorded project creation disagrees with state.');
    }
    const next = structuredClone(state);
    const { character } = getPlayer(next);
    character.advancement.push(structuredClone(event.project));
    return next;
}
export function decideMilestoneSpend(state, command) {
    if (!command ||
        command.kind !== 'spend-milestones' ||
        !Array.isArray(command.milestoneIds) ||
        command.milestoneIds.length === 0 ||
        new Set(command.milestoneIds).size !== command.milestoneIds.length) {
        throw new Error('Spend milestones requires a non-empty list of distinct milestone IDs.');
    }
    const { character } = getPlayer(state);
    const project = character.advancement.find(entry => entry.type === 'project' && entry.id === command.projectId);
    if (!project || project.type !== 'project') {
        throw new Error(`Project ${command.projectId} not found.`);
    }
    if (project.earned) {
        throw new Error(`Project ${command.projectId} is already earned.`);
    }
    let minorCount = 0;
    let totalProgress = 0;
    for (const msId of command.milestoneIds) {
        const milestone = character.advancement.find(entry => entry.type === 'milestone' && entry.id === msId);
        if (!milestone || milestone.type !== 'milestone') {
            throw new Error(`Milestone ${msId} not found.`);
        }
        if (milestone.spentOn !== null) {
            throw new Error(`Milestone ${msId} has already been spent.`);
        }
        if (milestone.kind === 'minor') {
            minorCount += 1;
            totalProgress += 1;
        }
        else if (milestone.kind === 'major') {
            totalProgress += 3;
        }
        else {
            throw new Error(`Invalid milestone kind on ${msId}.`);
        }
    }
    if (minorCount > 3) {
        throw new Error('At most 3 minor milestones can be spent in one task.');
    }
    const clearIndices = project.track.boxes.flatMap((box, index) => (box === 'clear' ? [index] : []));
    if (clearIndices.length === 0) {
        throw new Error('Project has no clear boxes remaining.');
    }
    const markedBoxes = clearIndices.slice(0, totalProgress);
    const earnedAfter = markedBoxes.length === clearIndices.length;
    return {
        kind: 'milestones-spent',
        characterId: character.id,
        command: structuredClone(command),
        markedBoxes,
        earnedAfter,
    };
}
export function applyMilestoneSpend(state, event) {
    const expected = decideMilestoneSpend(state, event.command);
    if (!sameValue(event, expected)) {
        throw new Error('Recorded milestone spend disagrees with state.');
    }
    const next = structuredClone(state);
    const { character } = getPlayer(next);
    const project = character.advancement.find(entry => entry.type === 'project' && entry.id === event.command.projectId);
    if (!project || project.type !== 'project') {
        throw new Error(`Project ${event.command.projectId} not found.`);
    }
    for (const msId of event.command.milestoneIds) {
        const milestone = character.advancement.find(entry => entry.type === 'milestone' && entry.id === msId);
        if (milestone && milestone.type === 'milestone') {
            milestone.spentOn = project.name;
        }
    }
    for (const boxIndex of event.markedBoxes) {
        project.track.boxes[boxIndex] = 'marked';
    }
    project.earned = event.earnedAfter;
    return next;
}
export function decideProjectEffect(state, command) {
    if (!command || command.kind !== 'complete-project' || !command.effect) {
        throw new Error('Invalid complete-project command.');
    }
    const ext = state;
    const { character, classState } = getPlayer(state);
    const project = character.advancement.find(entry => entry.type === 'project' && entry.id === command.projectId);
    if (!project || project.type !== 'project' || !project.earned) {
        throw new Error(`Earned project ${command.projectId} not found.`);
    }
    const projectBoxes = project.track.boxes.length;
    const effect = command.effect;
    if (effect.kind === 'add-aspect-box') {
        if (projectBoxes !== 3)
            throw new Error('Adding an aspect box requires a 3-box earned project.');
        const aspect = character.aspects.find(entry => entry.id === effect.aspectId && entry.status === 'owned');
        if (!aspect)
            throw new Error(`Owned aspect ${effect.aspectId} not found.`);
        if (aspect.track.boxes.length >= 8) {
            throw new Error('Aspect already has the maximum of 8 boxes.');
        }
        return { kind: 'project-completed', characterId: character.id, command: structuredClone(command) };
    }
    if (effect.kind === 'develop-aspect') {
        if (projectBoxes !== 3)
            throw new Error('Developing an aspect requires a 3-box earned project.');
        const aspect = character.aspects.find(entry => entry.id === effect.aspectId && entry.status === 'owned');
        if (!aspect)
            throw new Error(`Owned aspect ${effect.aspectId} not found.`);
        if (!nonEmpty(effect.rule))
            throw new Error('Developing an aspect requires a non-empty rule.');
        if (effect.boxes !== undefined &&
            (!Number.isSafeInteger(effect.boxes) || effect.boxes < 1 || effect.boxes > 8)) {
            throw new Error('Developed aspect boxes must be between 1 and 8.');
        }
        return { kind: 'project-completed', characterId: character.id, command: structuredClone(command) };
    }
    if (effect.kind === 'gain-skill-rank') {
        if (projectBoxes !== 3)
            throw new Error('Gaining a skill rank requires a 3-box earned project.');
        const skill = character.skills.find(entry => entry.id === effect.skillId || entry.name === effect.skillId);
        if (!skill)
            throw new Error(`Skill ${effect.skillId} not found.`);
        if (skill.rank >= 3)
            throw new Error(`Skill ${skill.name} is already at maximum rank 3.`);
        return { kind: 'project-completed', characterId: character.id, command: structuredClone(command) };
    }
    if (effect.kind === 'gain-aspect') {
        if (projectBoxes !== 6)
            throw new Error('Gaining a new aspect requires a 6-box earned project.');
        if (!nonEmpty(effect.aspectId) ||
            !nonEmpty(effect.definitionId) ||
            !nonEmpty(effect.name) ||
            !nonEmpty(effect.rule) ||
            !nonEmpty(effect.full) ||
            !['trait', 'gear', 'companion'].includes(effect.type) ||
            !Number.isSafeInteger(effect.boxes) ||
            effect.boxes < 1 ||
            effect.boxes > 8) {
            throw new Error('Invalid gain-aspect parameters.');
        }
        if (character.aspects.some(entry => entry.id === effect.aspectId)) {
            throw new Error(`Aspect ${effect.aspectId} already exists.`);
        }
        if (state.definitions.some(def => def.id === effect.definitionId)) {
            throw new Error(`Definition ${effect.definitionId} already exists.`);
        }
        if (['core', 'system', 'cub', 'marginalia'].includes(effect.aspectId)) {
            if (effect.location !== 'personal' || effect.classId !== null) {
                throw new Error(`Personal aspect ${effect.aspectId} must be placed in personal with null classId.`);
            }
        }
        if (effect.location === 'personal' || effect.location === 'archive') {
            if (effect.classId !== null) {
                throw new Error(`Aspect placed in ${effect.location} must have classId null.`);
            }
        }
        else if (effect.location === 'card') {
            if (!effect.classId || !classState.classes.some(entry => entry.id === effect.classId)) {
                throw new Error('Card-placed aspect must reference a learned Class Card.');
            }
        }
        return { kind: 'project-completed', characterId: character.id, command: structuredClone(command) };
    }
    if (effect.kind === 'combine-aspects') {
        const allowedByConfluence = ext.coreDevelopments?.confluence === true && projectBoxes === 3;
        if (projectBoxes !== 6 && !allowedByConfluence) {
            throw new Error('Combining aspects requires a 6-box earned project (or 3-box with Origin Core Confluence).');
        }
        if (effect.aspectIdA === effect.aspectIdB) {
            throw new Error('Combine aspects requires two distinct source aspects.');
        }
        if (['core', 'system', 'cub', 'marginalia'].includes(effect.aspectIdA) ||
            ['core', 'system', 'cub', 'marginalia'].includes(effect.aspectIdB)) {
            throw new Error('Personal signature aspects cannot be retired into a combined aspect.');
        }
        const aspectA = character.aspects.find(entry => entry.id === effect.aspectIdA && entry.status === 'owned');
        const aspectB = character.aspects.find(entry => entry.id === effect.aspectIdB && entry.status === 'owned');
        if (!aspectA || !aspectB) {
            throw new Error('Both source aspects must be owned.');
        }
        const na = effect.newAspect;
        if (!na ||
            !nonEmpty(na.id) ||
            !nonEmpty(na.definitionId) ||
            !nonEmpty(na.name) ||
            !nonEmpty(na.rule) ||
            !nonEmpty(na.full) ||
            !['trait', 'gear', 'companion'].includes(na.type) ||
            !['card', 'archive'].includes(na.location)) {
            throw new Error('Invalid combined aspect specification.');
        }
        if (character.aspects.some(entry => entry.id === na.id)) {
            throw new Error(`Aspect ${na.id} already exists.`);
        }
        if (state.definitions.some(def => def.id === na.definitionId)) {
            throw new Error(`Definition ${na.definitionId} already exists.`);
        }
        if (effect.combineClasses) {
            const cc = effect.combineClasses;
            if (!nonEmpty(cc.classIdA) ||
                !nonEmpty(cc.classIdB) ||
                cc.classIdA === cc.classIdB ||
                !nonEmpty(cc.newClassId) ||
                !nonEmpty(cc.newClassName)) {
                throw new Error('Invalid combineClasses specification.');
            }
            if (!classState.classes.some(c => c.id === cc.classIdA) ||
                !classState.classes.some(c => c.id === cc.classIdB)) {
                throw new Error('Both parent classes must exist.');
            }
            if (classState.classes.some(c => c.id === cc.newClassId || c.name === cc.newClassName)) {
                throw new Error('Combined class ID or name already exists.');
            }
        }
        const validClassIds = new Set(classState.classes.map(c => c.id));
        if (effect.combineClasses)
            validClassIds.add(effect.combineClasses.newClassId);
        if (na.location === 'archive' && na.classId !== null) {
            throw new Error('Archived combined aspect must have classId null.');
        }
        if (na.location === 'card' && (!na.classId || !validClassIds.has(na.classId))) {
            throw new Error('Card-placed combined aspect must reference a valid classId.');
        }
        return { kind: 'project-completed', characterId: character.id, command: structuredClone(command) };
    }
    if (effect.kind === 'core-confluence') {
        if (projectBoxes !== 3)
            throw new Error('Origin Core Confluence requires a 3-box earned project.');
        if (ext.coreDevelopments?.confluence) {
            throw new Error('Origin Core Confluence is already earned.');
        }
        const core = character.aspects.find(entry => entry.id === 'core');
        if (!core || core.track.boxes.length < 2) {
            throw new Error('Origin Core cannot shrink for Confluence.');
        }
        return { kind: 'project-completed', characterId: character.id, command: structuredClone(command) };
    }
    if (effect.kind === 'core-awakening') {
        if (projectBoxes !== 3)
            throw new Error('Origin Core Awakening requires a 3-box earned project.');
        if (!ext.coreDevelopments?.confluence) {
            throw new Error('Origin Core Awakening requires Confluence first.');
        }
        if (ext.coreDevelopments?.awakening) {
            throw new Error('Origin Core Awakening is already earned.');
        }
        const core = character.aspects.find(entry => entry.id === 'core');
        if (!core || core.track.boxes.length >= 8) {
            throw new Error('Origin Core cannot grow for Awakening.');
        }
        return { kind: 'project-completed', characterId: character.id, command: structuredClone(command) };
    }
    throw new Error('Unsupported project completion effect.');
}
export function applyProjectEffect(state, event) {
    const expected = decideProjectEffect(state, event.command);
    if (!sameValue(event, expected)) {
        throw new Error('Recorded project completion disagrees with state.');
    }
    const next = structuredClone(state);
    const { character, classState } = getPlayer(next);
    const project = character.advancement.find(entry => entry.type === 'project' && entry.id === event.command.projectId);
    if (project && project.type === 'project') {
        project.earned = false;
    }
    const effect = event.command.effect;
    if (effect.kind === 'add-aspect-box') {
        const aspect = character.aspects.find(entry => entry.id === effect.aspectId);
        aspect.track.boxes.push('clear');
        return next;
    }
    if (effect.kind === 'develop-aspect') {
        const aspect = character.aspects.find(entry => entry.id === effect.aspectId);
        const currentDef = resolveAspect(next.definitions, aspect.definition);
        const maxRev = next.definitions
            .filter(def => def.id === currentDef.id)
            .reduce((max, def) => Math.max(max, def.revision), 0);
        const nextRevision = maxRev + 1;
        const nextName = effect.name ?? aspect.name;
        const nextDef = {
            ...structuredClone(currentDef),
            revision: nextRevision,
            name: nextName,
            full: effect.full ?? currentDef.full,
            effects: [{ kind: 'manual', text: effect.rule }],
        };
        next.definitions.push(nextDef);
        aspect.name = nextName;
        aspect.definition = { id: nextDef.id, revision: nextRevision };
        if (effect.boxes !== undefined) {
            while (aspect.track.boxes.length < effect.boxes)
                aspect.track.boxes.push('clear');
            if (aspect.track.boxes.length > effect.boxes) {
                aspect.track.boxes = aspect.track.boxes.slice(0, effect.boxes);
            }
        }
        return next;
    }
    if (effect.kind === 'gain-skill-rank') {
        const skill = character.skills.find(entry => entry.id === effect.skillId || entry.name === effect.skillId);
        skill.rank += 1;
        return next;
    }
    if (effect.kind === 'gain-aspect') {
        const def = {
            id: effect.definitionId,
            revision: 1,
            name: effect.name,
            type: effect.type,
            description: '',
            restrictions: [],
            effects: [{ kind: 'manual', text: effect.rule }],
            full: effect.full,
        };
        next.definitions.push(def);
        character.aspects.push({
            id: effect.aspectId,
            name: effect.name,
            definition: { id: effect.definitionId, revision: 1 },
            track: {
                id: JSON.stringify([character.id, 'aspect', effect.aspectId, 'track']),
                boxes: Array(effect.boxes).fill('clear'),
            },
            status: 'owned',
            acquisition: {
                source: `project:${event.command.projectId}`,
                ...(effect.operationId ? { operationId: effect.operationId } : {}),
            },
        });
        classState.placements.push({
            aspectId: effect.aspectId,
            location: effect.location,
            classId: effect.classId,
        });
        return next;
    }
    if (effect.kind === 'combine-aspects') {
        const aspectA = character.aspects.find(entry => entry.id === effect.aspectIdA);
        const aspectB = character.aspects.find(entry => entry.id === effect.aspectIdB);
        const combinedLength = Math.min(8, aspectA.track.boxes.length + aspectB.track.boxes.length);
        aspectA.status = 'retired';
        aspectB.status = 'retired';
        const placementA = classState.placements.find(p => p.aspectId === aspectA.id);
        const placementB = classState.placements.find(p => p.aspectId === aspectB.id);
        placementA.location = 'archive';
        placementA.classId = null;
        placementB.location = 'archive';
        placementB.classId = null;
        if (effect.combineClasses) {
            const cc = effect.combineClasses;
            const classA = classState.classes.find(c => c.id === cc.classIdA);
            const classB = classState.classes.find(c => c.id === cc.classIdB);
            const bonusBySkill = new Map();
            for (const entry of [...classA.competence, ...classB.competence]) {
                bonusBySkill.set(entry.skillId, (bonusBySkill.get(entry.skillId) ?? 0) + entry.bonus);
            }
            const tierOrder = [
                'base',
                'advanced',
                'master',
                'rare',
                'unknown',
            ];
            const tier = tierOrder.indexOf(classA.tier) >= tierOrder.indexOf(classB.tier)
                ? classA.tier
                : classB.tier;
            classState.classes.push({
                id: cc.newClassId,
                name: cc.newClassName,
                tier: tier === 'base' ? 'advanced' : tier,
                sourceClassIds: [cc.classIdA, cc.classIdB],
                competence: Array.from(bonusBySkill.entries()).map(([skillId, bonus]) => ({
                    skillId,
                    bonus,
                })),
            });
        }
        const na = effect.newAspect;
        next.definitions.push({
            id: na.definitionId,
            revision: 1,
            name: na.name,
            type: na.type,
            description: '',
            restrictions: [],
            effects: [{ kind: 'manual', text: na.rule }],
            full: na.full,
        });
        character.aspects.push({
            id: na.id,
            name: na.name,
            definition: { id: na.definitionId, revision: 1 },
            track: {
                id: JSON.stringify([character.id, 'aspect', na.id, 'track']),
                boxes: Array(combinedLength).fill('clear'),
            },
            status: 'owned',
            acquisition: {
                source: `project:${event.command.projectId}`,
                ...(na.operationId ? { operationId: na.operationId } : {}),
            },
        });
        classState.placements.push({
            aspectId: na.id,
            location: na.location,
            classId: na.classId,
        });
        return next;
    }
    if (effect.kind === 'core-confluence') {
        const core = character.aspects.find(entry => entry.id === 'core');
        core.track.boxes = core.track.boxes.slice(0, core.track.boxes.length - 1);
        const prev = next.coreDevelopments ?? {
            confluence: false,
            awakening: false,
            awakeningUsedThisArc: false,
            awakeningActiveSceneId: null,
        };
        next.coreDevelopments = {
            ...prev,
            confluence: true,
        };
        return next;
    }
    if (effect.kind === 'core-awakening') {
        const core = character.aspects.find(entry => entry.id === 'core');
        core.track.boxes.push('clear');
        const prev = next.coreDevelopments;
        next.coreDevelopments = {
            ...prev,
            confluence: true,
            awakening: true,
        };
        return next;
    }
    return next;
}
export function decideAwakening(state, command) {
    if (!command || command.kind !== 'activate-awakening') {
        throw new Error('Invalid activate-awakening command.');
    }
    const ext = state;
    if (!ext.coreDevelopments?.awakening) {
        throw new Error('Origin Core Awakening has not been earned.');
    }
    if (ext.coreDevelopments.awakeningUsedThisArc || ext.coreDevelopments.awakeningActiveSceneId !== null) {
        throw new Error('Origin Core Awakening has already been used this arc.');
    }
    return {
        kind: 'awakening-activated',
        characterId: state.playerCharacterId,
        sceneId: state.world.scene.id,
    };
}
export function applyAwakening(state, event) {
    const expected = decideAwakening(state, { kind: 'activate-awakening' });
    if (!sameValue(event, expected)) {
        throw new Error('Recorded Awakening activation disagrees with state.');
    }
    const next = structuredClone(state);
    next.coreDevelopments = {
        ...next.coreDevelopments,
        awakeningUsedThisArc: true,
        awakeningActiveSceneId: event.sceneId,
    };
    return next;
}
export function applyAwakeningSceneEnd(state, strainId) {
    const ext = state;
    if (!ext.coreDevelopments?.awakeningActiveSceneId) {
        return structuredClone(state);
    }
    const next = structuredClone(state);
    const { character, classState } = getPlayer(next);
    next.coreDevelopments = {
        ...next.coreDevelopments,
        awakeningActiveSceneId: null,
    };
    const core = character.aspects.find(entry => entry.id === 'core');
    if (core) {
        core.track.boxes = core.track.boxes.map(box => (box === 'clear' ? 'marked' : box));
    }
    const resolvedStrainId = classState.manaStrainId ?? strainId;
    const before = classState.manaStrainId === null
        ? null
        : (character.conditions.find(entry => entry.id === classState.manaStrainId) ?? null);
    const after = reopenedManaStrain(before, resolvedStrainId);
    if (before) {
        const idx = character.conditions.findIndex(entry => entry.id === before.id);
        character.conditions[idx] = after;
    }
    else {
        character.conditions.push(after);
        classState.manaStrainId = after.id;
    }
    const exposure = character.meters.find(entry => entry.policy === 'minor-character/exposure');
    if (exposure) {
        const clearIndex = exposure.track.boxes.findIndex(box => box === 'clear');
        if (clearIndex >= 0) {
            exposure.track.boxes[clearIndex] = 'marked';
            const markedCount = exposure.track.boxes.filter(box => box === 'marked').length;
            const threshold = markedCount === 2
                ? 'rumour'
                : markedCount === 4
                    ? 'suspicion'
                    : markedCount === 6
                        ? 'fact'
                        : null;
            if (markedCount >= 6) {
                exposure.track.boxes = exposure.track.boxes.map(() => 'clear');
            }
            const existingLog = next.exposureLog ?? [];
            const incidentId = JSON.stringify([
                'exposure',
                'awakening',
                state.coreDevelopments?.awakeningActiveSceneId ?? 'scene',
                existingLog.length + 1,
            ]);
            next.exposureLog = [
                ...existingLog,
                {
                    id: incidentId,
                    witness: 'Scene witnesses',
                    description: 'Origin Core Awakening backlash at scene end.',
                    absorbedByCub: false,
                    threshold,
                    learnedFact: threshold === 'fact'
                        ? 'Origin Core Awakening backlash witnessed at scene end.'
                        : null,
                },
            ];
        }
    }
    return next;
}
export function decideBreakthroughMark(state, command) {
    if (!command || command.kind !== 'mark-breakthrough' || !nonEmpty(command.reason)) {
        throw new Error('Breakthrough mark requires a non-empty reason.');
    }
    const { character } = getPlayer(state);
    const meter = character.meters.find(entry => entry.policy === 'minor-character/breakthrough');
    if (!meter)
        throw new Error('Breakthrough meter not found.');
    const markedBox = meter.track.boxes.findIndex(box => box === 'clear');
    if (markedBox < 0) {
        throw new Error('Breakthrough track is already full; resolve the Rank Trial.');
    }
    return {
        kind: 'breakthrough-marked',
        characterId: character.id,
        reason: command.reason,
        markedBox,
    };
}
export function applyBreakthroughMark(state, event) {
    const expected = decideBreakthroughMark(state, {
        kind: 'mark-breakthrough',
        reason: event.reason,
    });
    if (!sameValue(event, expected)) {
        throw new Error('Recorded breakthrough mark disagrees with state.');
    }
    const next = structuredClone(state);
    const { character } = getPlayer(next);
    const meter = character.meters.find(entry => entry.policy === 'minor-character/breakthrough');
    meter.track.boxes[event.markedBox] = 'marked';
    return next;
}
export function decideRankTrial(state, command) {
    if (!command ||
        command.kind !== 'resolve-rank-trial' ||
        typeof command.passed !== 'boolean' ||
        !nonEmpty(command.note)) {
        throw new Error('Rank trial requires passed boolean and non-empty note.');
    }
    const { character, classState } = getPlayer(state);
    const meter = character.meters.find(entry => entry.policy === 'minor-character/breakthrough');
    if (!meter)
        throw new Error('Breakthrough meter not found.');
    if (!meter.track.boxes.every(box => box === 'marked')) {
        throw new Error('Breakthrough track must be completely marked before resolving a Rank Trial.');
    }
    const rankIndex = RANKS.indexOf(classState.expressedRank);
    if (rankIndex < 0 || rankIndex >= RANKS.length - 1) {
        throw new Error(`Expressed rank ${classState.expressedRank} cannot advance further.`);
    }
    const beforeRank = classState.expressedRank;
    if (!command.passed) {
        return {
            kind: 'rank-trial-resolved',
            characterId: character.id,
            command: structuredClone(command),
            beforeRank,
            afterRank: beforeRank,
            resetBoxes: structuredClone(meter.track.boxes),
        };
    }
    const afterRank = RANKS[rankIndex + 1];
    const nextBoxCount = BREAKTHROUGH_BOXES[afterRank] ?? 8;
    return {
        kind: 'rank-trial-resolved',
        characterId: character.id,
        command: structuredClone(command),
        beforeRank,
        afterRank,
        resetBoxes: Array(nextBoxCount).fill('clear'),
    };
}
export function applyRankTrial(state, event) {
    const expected = decideRankTrial(state, event.command);
    if (!sameValue(event, expected)) {
        throw new Error('Recorded rank trial resolution disagrees with state.');
    }
    const next = structuredClone(state);
    const { character, classState } = getPlayer(next);
    const meter = character.meters.find(entry => entry.policy === 'minor-character/breakthrough');
    classState.expressedRank = event.afterRank;
    meter.track.boxes = structuredClone(event.resetBoxes);
    return next;
}
export function decideDisplayedRank(state, command) {
    if (!command ||
        command.kind !== 'update-displayed-rank' ||
        !['assessment', 'evidence', 'spoof'].includes(command.method) ||
        !nonEmpty(command.note) ||
        (command.displayedRank !== 'Blank' && !RANKS.includes(command.displayedRank))) {
        throw new Error('Invalid update-displayed-rank command.');
    }
    const { character, classState } = getPlayer(state);
    return {
        kind: 'displayed-rank-updated',
        characterId: character.id,
        command: structuredClone(command),
        beforeRank: classState.displayedRank,
        afterRank: command.displayedRank,
    };
}
export function applyDisplayedRank(state, event) {
    const expected = decideDisplayedRank(state, event.command);
    if (!sameValue(event, expected)) {
        throw new Error('Recorded displayed rank update disagrees with state.');
    }
    const next = structuredClone(state);
    const { classState } = getPlayer(next);
    classState.displayedRank = event.afterRank;
    return next;
}
