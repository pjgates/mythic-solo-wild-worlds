import { rollPool } from "./engine/dice.js";
import { activeClassBonuses } from "./game/minor-character/sheet.js";
export function resolveAction(sheet, action, die, injuryCut = 0) {
    if (!action || typeof action.description !== 'string' || !action.description.trim()
        || (action.edge !== null && !sheet.edges.includes(action.edge))
        || !Array.isArray(action.advantageSources) || action.advantageSources.length > 2
        || action.advantageSources.some(s => typeof s !== 'string' || !s.trim())
        || new Set(action.advantageSources).size !== action.advantageSources.length
        || (action.skill !== null && (!['skill', 'lore'].includes(action.skill.kind)
            || typeof action.skill.name !== 'string' || !action.skill.name.trim()))) {
        throw new Error('Invalid action declaration. Choose one Edge, one Skill or Lore and at most two distinct Advantages.');
    }
    const ranks = action.skill?.kind === 'lore' ? sheet.lores : sheet.skills;
    const rank = action.skill && Object.hasOwn(ranks, action.skill.name) ? ranks[action.skill.name] : 0;
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
    const mire = sheet.mires.filter(m => mires.includes(m.id))
        .reduce((sum, m) => sum + m.track.boxes.filter(box => box === 'marked').length, 0);
    const mandatoryCuts = difficulty + rankGap + mire + injuryCut;
    const voluntaryCuts = Number(precision) + Number(impact);
    const remainingMandatoryCuts = Math.max(0, mandatoryCuts - overflow);
    const cuts = { difficulty, rankGap, mire, injury: injuryCut, precision: Number(precision), impact: Number(impact),
        total: remainingMandatoryCuts + voluntaryCuts };
    const origin = { classBonus, uncappedPool, overflow, mandatoryCuts, remainingMandatoryCuts, voluntaryCuts };
    const declaredTotal = mandatoryCuts + voluntaryCuts;
    if (action.permission !== undefined && typeof action.permission !== 'string')
        throw new Error('Invalid permission.');
    const impacts = ['Low', 'Normal', 'High', 'Massive'];
    const base = action.baseImpact ?? 'Normal';
    if (!impacts.includes(base))
        throw new Error('Invalid impact.');
    const finalImpact = impacts[Math.max(0, Math.min(3, impacts.indexOf(base) + Number(impact) - Number(rankGap === 2)))];
    if ((declaredTotal >= 3 || base === 'Massive' || finalImpact === 'Massive') && !action.permission?.trim()) {
        throw new Error('Three or more Cuts or Massive impact require a manual permission ruling before rolling.');
    }
    return { origin, ...rollPool(pool, cuts.total, die), cuts, impact: finalImpact };
}
