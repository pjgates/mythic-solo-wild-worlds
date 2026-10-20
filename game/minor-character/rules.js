import { assertRecordedDice } from "../../engine/dice.js";
import { resolveAction, stakedHarmMarks, validActionStakes } from "../../action.js";
import { activeClassBonuses, projectSheet } from "./sheet.js";
import { applyActionBattery, decideHarm } from "./stakes.js";
import { manaStrainCut } from "./strain.js";
/** Accepted stakes settle Conflict and Disaster in code; only a Twist still waits for the player. */
export function expectedActionPending(event) {
    const { action, operationId } = event.command.originalActionCommand;
    const waits = action.stakes !== undefined ? event.result.twist : event.result.outcome !== 'Triumph' || event.result.twist;
    return waits ? { kind: 'manual-action', operationId } : null;
}
/** The harm command an accepted stake owes for this outcome, or null when nothing is owed. */
export function stakedHarmCommand(event) {
    const { action } = event.command.originalActionCommand;
    const marks = stakedHarmMarks(action.stakes, event.result.outcome);
    if (marks === 0)
        return null;
    const harm = action.stakes.harm;
    return { kind: 'apply-harm', marks, targetAspectId: harm.targetAspectId, overflowChoice: harm.overflowChoice };
}
// Staked harm is decided on the state the roll leaves behind: battery boxes are already paid.
export function decideStakedHarm(state, event) {
    const command = stakedHarmCommand(event);
    if (!command)
        return null;
    const after = structuredClone(state);
    if (event.command.originalActionCommand.action.battery !== undefined) {
        applyActionBattery(after, { ...event, kind: 'action-resolved', effects: [], pending: null, harm: null });
    }
    return decideHarm(after, command);
}
export function prepareMinorAction(state, original, proposalId) {
    const originalActionCommand = structuredClone(original);
    const { action } = originalActionCommand;
    const character = state.characters.find(entry => entry.id === state.playerCharacterId);
    const edge = character.edges.find(entry => entry.name === action.edge);
    if (action.edge !== null && !edge)
        throw new Error('Choose an existing Edge.');
    const skill = action.skill === null ? undefined : character.skills.find(entry => entry.category === action.skill.kind && entry.name === action.skill.name);
    const mireIds = action.cuts?.mires ?? [];
    if (!Array.isArray(mireIds) || mireIds.some(id => !character.impulses.some(entry => entry.id === id && entry.type === 'tracked'))) {
        throw new Error('Choose existing Mires.');
    }
    return { kind: 'action', originalActionCommand,
        refs: { characterId: character.id, edgeId: edge?.id ?? null, skillId: skill?.id ?? null, mireIds },
        ...(proposalId === undefined ? {} : { proposalId }) };
}
export function assertActionReferences(state, body) {
    const expected = prepareMinorAction(state, body.originalActionCommand).refs;
    const refs = body.refs;
    if (body.kind !== 'action' || !refs || refs.characterId !== expected.characterId || refs.edgeId !== expected.edgeId
        || refs.skillId !== expected.skillId || !Array.isArray(refs.mireIds) || refs.mireIds.length !== expected.mireIds.length
        || Array.from(refs.mireIds).some((id, index) => id !== expected.mireIds[index]))
        throw new Error('Action selections disagree with their stable references.');
}
export function resolveMinorAction(state, body, die) {
    if (state.pending)
        throw new Error('Finish the pending manual adjudication first.');
    assertActionReferences(state, body);
    const command = structuredClone(body);
    const character = state.characters.find(entry => entry.id === command.refs.characterId);
    const action = structuredClone(command.originalActionCommand.action);
    if (command.refs.edgeId !== null)
        action.edge = character.edges.find(entry => entry.id === command.refs.edgeId).name;
    if (command.refs.skillId !== null)
        action.skill.name = character.skills.find(entry => entry.id === command.refs.skillId).name;
    if (action.cuts)
        action.cuts.mires = command.refs.mireIds;
    const awakeningActive = state.coreDevelopments?.awakeningActiveSceneId === state.world.scene.id;
    if (awakeningActive) {
        action.baseImpact = 'Massive';
        if (!action.permission?.trim()) {
            action.permission = 'Origin Awakening active';
        }
    }
    if (command.proposalId !== undefined && (typeof command.proposalId !== 'string' || state.proposal?.id !== command.proposalId)) {
        throw new Error('This action resolves a proposal that is no longer pending.');
    }
    const result = resolveAction(projectSheet(state), action, die, manaStrainCut(state, action.skill));
    let costs = [];
    if (action.battery !== undefined) {
        const core = character.aspects.find(entry => entry.id === 'core');
        const paidBoxes = core.track.boxes.flatMap((box, index) => box === 'clear' ? [index] : []).slice(0, 2);
        costs = [`core-battery:${paidBoxes[0]},${paidBoxes[1]}`];
    }
    const partial = { command, result, costs };
    const harm = decideStakedHarm(state, partial);
    return { kind: 'action-resolved', command, result, costs, effects: [], pending: expectedActionPending(partial), harm };
}
// Validate this rules revision against the state before the event; never resolve or replace its roll.
export function assertRecordedAction(state, event) {
    const { action, operationId } = event.command.originalActionCommand;
    const result = event.result;
    const cuts = result?.cuts;
    const origin = result?.origin;
    const declared = action.cuts ?? {};
    const integer = (value) => Number.isInteger(value) && value >= 0;
    const text = (value) => typeof value === 'string' && !!value.trim();
    const impacts = ['Low', 'Normal', 'High', 'Massive'];
    const validBattery = action.battery === undefined || action.battery === 'massive' || action.battery === 'bypass-rank-gap';
    const expectedRankGap = action.battery === 'bypass-rank-gap' ? 0 : (declared.rankGap ?? 0);
    const awakeningActive = state.coreDevelopments?.awakeningActiveSceneId === state.world.scene.id;
    const effectiveBase = (action.battery === 'massive' || awakeningActive) ? 'Massive' : (action.baseImpact ?? 'Normal');
    const effectivePermission = action.permission?.trim() || (awakeningActive ? 'Origin Awakening active' : '');
    const character = state.characters.find(entry => entry.id === state.playerCharacterId);
    const core = character.aspects.find(entry => entry.id === 'core');
    const clearCore = core ? core.track.boxes.flatMap((box, index) => box === 'clear' ? [index] : []) : [];
    const validCosts = action.battery === undefined
        ? Array.isArray(event.costs) && event.costs.length === 0
        : clearCore.length >= 2 && Array.isArray(event.costs) && event.costs.length === 1
            && event.costs[0] === `core-battery:${clearCore[0]},${clearCore[1]}`;
    const expectedHarm = stakedHarmCommand(event);
    const validHarm = expectedHarm === null
        ? event.harm === null || event.harm === undefined
        : !!event.harm && event.harm.kind === 'harm-applied' && event.harm.command.kind === 'apply-harm'
            && event.harm.command.marks === expectedHarm.marks && event.harm.command.targetAspectId === expectedHarm.targetAspectId
            && event.harm.command.overflowChoice === expectedHarm.overflowChoice;
    if (!validBattery || !text(operationId) || !text(action.description)
        || (action.stakes !== undefined && !validActionStakes(action.stakes)) || !validHarm
        || (event.command.proposalId !== undefined && !text(event.command.proposalId))
        || (action.skill !== null && (!['skill', 'lore'].includes(action.skill.kind) || !text(action.skill.name)))
        || !Array.isArray(action.advantageSources) || action.advantageSources.length > 2
        || !Array.from(action.advantageSources).every(text) || new Set(action.advantageSources).size !== action.advantageSources.length
        || (action.permission !== undefined && typeof action.permission !== 'string')
        || (action.cuts !== undefined && (!action.cuts || typeof action.cuts !== 'object'))
        || ![undefined, 0, 1, 2].includes(declared.difficulty) || ![undefined, 0, 1, 2].includes(declared.rankGap)
        || (declared.precision !== undefined && typeof declared.precision !== 'boolean')
        || (declared.impact !== undefined && typeof declared.impact !== 'boolean')
        || (declared.mires !== undefined && !Array.isArray(declared.mires)) || !Array.from(declared.mires ?? []).every(text)
        || new Set(declared.mires ?? []).size !== (declared.mires ?? []).length
        || !cuts || !origin
        || ![cuts.difficulty, cuts.rankGap, cuts.mire, cuts.injury, cuts.precision, cuts.impact, cuts.total,
            origin.classBonus, origin.uncappedPool, origin.overflow, origin.mandatoryCuts,
            origin.remainingMandatoryCuts, origin.voluntaryCuts].every(integer)
        || cuts.difficulty !== (declared.difficulty ?? 0) || cuts.rankGap !== expectedRankGap
        || cuts.precision !== Number(declared.precision ?? false) || cuts.impact !== Number(declared.impact ?? false)
        || origin.uncappedPool < origin.classBonus || origin.uncappedPool - origin.classBonus > 6
        || result.pool !== Math.min(6, origin.uncappedPool) || origin.overflow !== Math.max(0, origin.uncappedPool - 6)
        || origin.mandatoryCuts !== cuts.difficulty + cuts.rankGap + cuts.mire + cuts.injury
        || origin.remainingMandatoryCuts !== Math.max(0, origin.mandatoryCuts - origin.overflow)
        || origin.voluntaryCuts !== cuts.precision + cuts.impact || cuts.total !== origin.remainingMandatoryCuts + origin.voluntaryCuts
        || (action.baseImpact !== undefined && !impacts.includes(action.baseImpact))
        || result.impact !== impacts[Math.max(0, Math.min(3, impacts.indexOf(effectiveBase)
            + cuts.impact - Number(cuts.rankGap === 2)))]
        || ((origin.mandatoryCuts + origin.voluntaryCuts >= 3 || effectiveBase === 'Massive' || result.impact === 'Massive')
            && !effectivePermission)
        || !validCosts || !Array.isArray(event.effects) || event.effects.length !== 0) {
        throw new Error('Invalid recorded action.');
    }
    const sheet = projectSheet(state);
    const ranks = action.skill?.kind === 'lore' ? sheet.lores : sheet.skills;
    const rank = action.skill && Object.hasOwn(ranks, action.skill.name) ? ranks[action.skill.name] : 0;
    const bonuses = activeClassBonuses(sheet);
    const classBonus = action.skill?.kind === 'skill' && Object.hasOwn(bonuses, action.skill.name)
        ? bonuses[action.skill.name] : 0;
    const uncappedPool = Number(action.edge !== null) + rank + classBonus + action.advantageSources.length;
    const mire = sheet.mires.filter(entry => (declared.mires ?? []).includes(entry.id))
        .reduce((sum, entry) => sum + entry.track.boxes.filter(box => box === 'marked').length, 0);
    if (origin.classBonus !== classBonus || origin.uncappedPool !== uncappedPool || cuts.mire !== mire
        || cuts.injury !== manaStrainCut(state, action.skill)) {
        throw new Error('Recorded contributions disagree with historical selections and state.');
    }
    assertRecordedDice(result, cuts.total);
}
