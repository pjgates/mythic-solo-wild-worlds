import { rollPool } from "./engine/dice.js";
import { activeClassBonuses } from "./game/minor-character/sheet.js";
export const IMPACTS = ['Low', 'Normal', 'High', 'Massive'];
const MAX_STAKES_MARKS = 8;
export function validActionStakes(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const stakes = value;
    if (Object.keys(stakes).some(key => !['narrative', 'harm'].includes(key)))
        return false;
    if (typeof stakes.narrative !== 'string')
        return false;
    if (stakes.harm === null)
        return true;
    const harm = stakes.harm;
    if (!harm || typeof harm !== 'object' || Array.isArray(harm))
        return false;
    if (Object.keys(harm).some(key => !['onConflict', 'onDisaster', 'targetAspectId', 'overflowChoice'].includes(key)))
        return false;
    const marks = (count) => Number.isInteger(count) && count >= 0 && count <= MAX_STAKES_MARKS;
    return marks(harm.onConflict) && marks(harm.onDisaster)
        && (harm.targetAspectId === null || (typeof harm.targetAspectId === 'string' && !!harm.targetAspectId.trim()))
        && (harm.overflowChoice === 'injury' || harm.overflowChoice === 'burn');
}
export function prepareAction(sheet, action, injuryCut = 0) {
    if (!action || typeof action.description !== 'string' || !action.description.trim()
        || (action.edge !== null && !sheet.edges.includes(action.edge))
        || !Array.isArray(action.advantageSources) || action.advantageSources.length > 2
        || action.advantageSources.some(s => typeof s !== 'string' || !s.trim())
        || new Set(action.advantageSources).size !== action.advantageSources.length
        || (action.skill !== null && (!['skill', 'lore'].includes(action.skill.kind)
            || typeof action.skill.name !== 'string' || !action.skill.name.trim()))) {
        throw new Error('Invalid action declaration. Choose one Edge, one Skill or Lore and at most two distinct Advantages.');
    }
    if (action.stakes !== undefined && !validActionStakes(action.stakes))
        throw new Error('Invalid accepted stakes.');
    if (action.stakes?.harm && action.stakes.harm.targetAspectId !== null
        && !sheet.aspects.some(aspect => aspect.id === action.stakes.harm.targetAspectId)) {
        throw new Error('Accepted stakes name an aspect that is not active.');
    }
    const ranks = action.skill?.kind === 'lore' ? sheet.lores : sheet.skills;
    const rank = action.skill && Object.hasOwn(ranks, action.skill.name) ? ranks[action.skill.name] : 0;
    if (action.battery !== undefined && action.battery !== 'massive' && action.battery !== 'bypass-rank-gap') {
        throw new Error('Invalid Origin Core battery option.');
    }
    if (action.battery !== undefined) {
        const core = sheet.aspects.find(aspect => aspect.id === 'core');
        const clearCount = core ? core.track.boxes.filter(box => box === 'clear').length : 0;
        if (clearCount < 2) {
            throw new Error('Origin Core requires at least two clear boxes to use as a battery.');
        }
    }
    const bonuses = activeClassBonuses(sheet);
    const classBonus = action.skill?.kind === 'skill' && Object.hasOwn(bonuses, action.skill.name) ? bonuses[action.skill.name] : 0;
    const uncappedPool = Number(action.edge !== null) + rank + classBonus + action.advantageSources.length;
    const pool = Math.min(6, uncappedPool);
    const overflow = Math.max(0, uncappedPool - 6);
    const declared = action.cuts ?? {};
    const { difficulty = 0, rankGap = 0, mires = [], precision = false, impact = false } = declared;
    if ((action.cuts !== undefined && (!action.cuts || typeof action.cuts !== 'object'))
        || ![0, 1, 2].includes(difficulty) || ![0, 1, 2].includes(rankGap)
        || typeof precision !== 'boolean' || typeof impact !== 'boolean'
        || !Array.isArray(mires) || new Set(mires).size !== mires.length
        || mires.some(id => !sheet.mires.some(mire => mire.id === id)))
        throw new Error('Invalid declared Cuts.');
    const effectiveRankGap = action.battery === 'bypass-rank-gap' ? 0 : rankGap;
    const mire = sheet.mires.filter(m => mires.includes(m.id))
        .reduce((sum, m) => sum + m.track.boxes.filter(box => box === 'marked').length, 0);
    const mandatoryCuts = difficulty + effectiveRankGap + mire + injuryCut;
    const voluntaryCuts = Number(precision) + Number(impact);
    const remainingMandatoryCuts = Math.max(0, mandatoryCuts - overflow);
    const cuts = { difficulty, rankGap: effectiveRankGap, mire, injury: injuryCut, precision: Number(precision), impact: Number(impact),
        total: remainingMandatoryCuts + voluntaryCuts };
    const origin = { classBonus, uncappedPool, overflow, mandatoryCuts, remainingMandatoryCuts, voluntaryCuts };
    const declaredTotal = mandatoryCuts + voluntaryCuts;
    if (action.permission !== undefined && typeof action.permission !== 'string')
        throw new Error('Invalid permission.');
    const declaredBase = action.baseImpact ?? 'Normal';
    if (!IMPACTS.includes(declaredBase))
        throw new Error('Invalid impact.');
    const base = action.battery === 'massive' ? 'Massive' : declaredBase;
    const finalImpact = IMPACTS[Math.max(0, Math.min(3, IMPACTS.indexOf(base) + Number(impact) - Number(effectiveRankGap === 2)))];
    const needsPermission = declaredTotal >= 3 || base === 'Massive' || finalImpact === 'Massive';
    return { pool, origin, cuts, impact: finalImpact, needsPermission };
}
/** Submission semantics; kept out of proposal replay so older drafts remain editable. */
export function assertActionHarm(action) {
    if (action.stakes?.harm?.targetAspectId === null && action.stakes.harm.overflowChoice === 'burn') {
        throw new Error('Direct injury requires injury handling. Choose an Aspect to burn its boxes, or choose injury.');
    }
}
export function resolveAction(sheet, action, die, injuryCut = 0) {
    const prepared = prepareAction(sheet, action, injuryCut);
    assertActionHarm(action);
    if (prepared.needsPermission && !action.permission?.trim()) {
        throw new Error('Three or more Cuts or Massive impact require a manual permission ruling before rolling.');
    }
    const { pool, origin, cuts, impact } = prepared;
    return { origin, ...rollPool(pool, cuts.total, die), cuts, impact };
}
/** The harm an accepted stake owes for a recorded outcome; zero marks means no harm event. */
export function stakedHarmMarks(stakes, outcome) {
    if (!stakes?.harm)
        return 0;
    if (outcome === 'Conflict')
        return stakes.harm.onConflict;
    if (outcome === 'Disaster')
        return stakes.harm.onDisaster;
    return 0;
}
