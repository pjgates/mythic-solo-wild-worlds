import { element, button, select, input, checkbox, form } from "./card-controls.js";
import { activeClassBonuses } from "./game/minor-character/sheet.js";
export const HARM_MARKS = [
    ['0', 'No Harm · 0 marks'], ['1', 'Low · 1 mark'], ['2', 'Normal · 2 marks'],
    ['3', 'High · 3 marks'], ['4', 'Extreme · 4 marks'],
];
export function harmTargets(view) {
    return [['', 'Direct injury (no aspect absorption)'],
        ...view.sheet.aspects.map(a => [a.id, `Absorb on ${a.name} (${a.type})`])];
}
export const HARM_OVERFLOW = [['injury', 'Overflow becomes injury'], ['burn', 'Burn 1 box to absorb overflow']];
/** The full manual declaration: every pool, Cut and impact choice the rules expose, rolled and saved in code. */
export function renderDeclarationForm(view, card) {
    const root = form('mc-action-declaration');
    root.append(element('h4', 'Declare a simple action'), element('p', 'Roll only for difficult, dangerous or dramatic actions. This basic roll has no automatic costs or sheet effects. Use manual adjudication for unsupported abilities.'));
    const description = input(root, 'What does Sera attempt?', true, 'description');
    const edge = select(root, 'Fitting Edge', [['', 'None'], ...view.sheet.edges.map(e => [e, e])], 'edge');
    const bonuses = activeClassBonuses(view.sheet);
    const ranks = [['', 'None / untrained (0)']];
    for (const [kind, values] of [['skill', view.sheet.skills], ['lore', view.sheet.lores]]) {
        for (const [name, rank] of Object.entries(values)) {
            const bonus = kind === 'skill' && Object.hasOwn(bonuses, name) ? bonuses[name] : 0;
            ranks.push([JSON.stringify({ kind, name }), `${name} · ${kind} trained ${rank}${bonus ? ` + class ${bonus}` : ''}`]);
        }
    }
    const skill = select(root, 'Skill or Lore', ranks, 'skill');
    const advantage1 = input(root, 'First Advantage source (optional)', false, 'advantage1');
    const advantage2 = input(root, 'Second distinct Advantage source (optional)', false, 'advantage2');
    root.append(element('p', 'Active class competence adds only to Skills while Origin is available. Dice above six cancel mandatory Cuts; voluntary Precision/Impact Cuts remain. Unused overflow is lost.'), element('h4', 'Declare Cuts before rolling'));
    const difficulty = select(root, 'Difficulty', [['0', 'Ordinary · Cut 0'], ['1', 'Hard · Cut 1'], ['2', 'Desperate · Cut 2']], 'difficulty');
    const rankGap = select(root, 'Opposed rank gap', [['0', 'None / equal · Cut 0'], ['1', 'One above · Cut 1'], ['2', 'Two above · Cut 2, impact down']], 'rankGap');
    root.append(element('p', 'Three or more ranks above: direct harm is impossible until a real vulnerability or asset changes the matchup. Escape, protection and preparation remain possible; adjudicate the matchup manually before declaring this roll.'));
    const mires = view.sheet.mires.map(mire => ({ id: mire.id,
        control: checkbox(root, `Act against ${mire.name} · Cut ${mire.track.boxes.filter(box => box === 'marked').length}`, `mire:${mire.id}`) }));
    const precision = checkbox(root, 'Voluntary Precision · Cut 1 to target a part or deny an ability', 'precision');
    const impactCut = checkbox(root, 'Voluntary Impact · Cut 1 to raise impact one step', 'impact');
    const baseImpact = select(root, 'Base impact', [['Normal', 'Normal · one box'], ['Low', 'Low · one fewer'], ['High', 'High · one extra'], ['Massive', 'Massive · whole track, siege-scale permission']], 'baseImpact');
    const battery = select(root, 'Origin Core Battery', [
        ['', 'None'],
        ['massive', 'Massive impact · 2 Core Fatigue'],
        ['bypass-rank-gap', 'Bypass rank gap · 2 Core Fatigue'],
    ], 'battery');
    root.append(element('p', 'Three or more Cuts, including automatic Mana Strain, require a feasible objective and a manual permission ruling. Overflow does not bypass permissions or restore reduced impact. Massive requires siege-scale permission. Unearned projects (including Marginalia) grant no Advantage.'));
    const permission = input(root, 'Permission ruling (required for 3+ Cuts or Massive)', false, 'permission');
    const roll = button('Roll and save');
    roll.disabled = !card.ready();
    root.append(roll);
    roll.onclick = async () => {
        if (!root.reportValidity())
            return;
        roll.disabled = true;
        const action = { description: description.value, edge: edge.value || null,
            skill: skill.value ? JSON.parse(skill.value) : null,
            advantageSources: [advantage1.value.trim(), advantage2.value.trim()].filter(Boolean),
            cuts: { difficulty: Number(difficulty.value), rankGap: Number(rankGap.value),
                mires: mires.filter(mire => mire.control.checked).map(mire => mire.id),
                precision: precision.checked, impact: impactCut.checked },
            baseImpact: baseImpact.value, permission: permission.value.trim(),
            ...(battery.value ? { battery: battery.value } : {}) };
        try {
            await card.controller.submitAction({ ...await card.capture(view.context), action });
        }
        catch (error) {
            card.report(String(error));
            roll.disabled = !card.ready();
        }
    };
    return root;
}
