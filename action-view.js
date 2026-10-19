import { renderReceipt } from "./history-view.js";
import { activeClassBonuses } from "./game/minor-character/sheet.js";
const element = (tag, text = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
};
const button = (text) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'menu_button';
    node.textContent = text;
    return node;
};
function select(form, label, values) {
    const wrapper = element('label', label);
    const control = document.createElement('select');
    values.forEach(([value, text]) => control.add(new Option(text, value)));
    wrapper.append(control);
    form.append(wrapper);
    return control;
}
function input(form, label, required = false) {
    const wrapper = element('label', label);
    const control = document.createElement('input');
    control.className = 'text_pole';
    control.required = required;
    wrapper.append(control);
    form.append(wrapper);
    return control;
}
function checkbox(form, label) {
    const wrapper = element('label', label);
    wrapper.className = 'mc-checkbox';
    const control = document.createElement('input');
    control.type = 'checkbox';
    wrapper.prepend(control);
    form.append(wrapper);
    return control;
}
export function renderActions(root, controller, capture, ready) {
    root.replaceChildren();
    const view = controller.playerView;
    if (!view)
        return;
    const title = element('h3', 'Minor Character · manual play');
    const status = element('p', controller.state.status);
    status.setAttribute('role', 'status');
    root.append(title, status);
    const latest = view.history.slice().reverse().find(entry => entry.receipt);
    for (const entry of view.history.filter(entry => entry === latest || entry.operationId === view.pendingManual)) {
        if (!entry.receipt)
            continue;
        const card = renderReceipt(entry.receipt);
        card.classList.toggle('mc-pending', view.pendingManual === entry.operationId);
        const handled = view.history.find(j => j.manualTarget === entry.operationId);
        if (handled)
            card.append(element('p', handled.manualNote));
        if (view.pendingManual === entry.operationId) {
            card.append(element('p', 'Manual adjudication required. Automatic harm, stakes and Twist review are not implemented. The roll is binding; record how you handled the consequences or banked the Twist. This does not apply sheet changes or establish a Twist as fact.'));
            const form = document.createElement('form');
            const note = input(form, 'Manual handling note', true);
            const accept = button('Handled manually');
            accept.disabled = !ready();
            form.append(accept);
            form.onsubmit = event => event.preventDefault();
            accept.onclick = async () => {
                if (!form.reportValidity())
                    return;
                accept.disabled = true;
                const handlingNote = note.value;
                try {
                    await controller.acknowledgeManual(await capture(view.context), entry.operationId, handlingNote);
                }
                catch (error) {
                    status.textContent = String(error);
                    accept.disabled = !ready();
                }
            };
            card.append(form);
        }
        root.append(card);
    }
    if (view.pendingManual)
        return;
    const form = document.createElement('form');
    form.className = 'mc-action-declaration';
    form.append(element('h4', 'Declare a simple action'), element('p', 'Roll only for difficult, dangerous or dramatic actions. This basic roll has no automatic costs or sheet effects. Use manual adjudication for unsupported abilities.'));
    const description = input(form, 'What does Sera attempt?', true);
    const edge = select(form, 'Fitting Edge', [['', 'None'], ...view.sheet.edges.map(e => [e, e])]);
    const bonuses = activeClassBonuses(view.sheet);
    const ranks = [['', 'None / untrained (0)']];
    for (const [kind, values] of [['skill', view.sheet.skills], ['lore', view.sheet.lores]]) {
        for (const [name, rank] of Object.entries(values)) {
            const bonus = kind === 'skill' && Object.hasOwn(bonuses, name) ? bonuses[name] : 0;
            ranks.push([JSON.stringify({ kind, name }), `${name} · ${kind} trained ${rank}${bonus ? ` + class ${bonus}` : ''}`]);
        }
    }
    const skill = select(form, 'Skill or Lore', ranks);
    const advantage1 = input(form, 'First Advantage source (optional)');
    const advantage2 = input(form, 'Second distinct Advantage source (optional)');
    form.append(element('p', 'Active class competence adds only to Skills while Origin is available. Dice above six cancel mandatory Cuts; voluntary Precision/Impact Cuts remain. Unused overflow is lost.'), element('h4', 'Declare Cuts before rolling'));
    const difficulty = select(form, 'Difficulty', [['0', 'Ordinary · Cut 0'], ['1', 'Hard · Cut 1'], ['2', 'Desperate · Cut 2']]);
    const rankGap = select(form, 'Opposed rank gap', [['0', 'None / equal · Cut 0'], ['1', 'One above · Cut 1'], ['2', 'Two above · Cut 2, impact down']]);
    form.append(element('p', 'Three or more ranks above: direct harm is impossible until a real vulnerability or asset changes the matchup. Escape, protection and preparation remain possible; adjudicate the matchup manually before declaring this roll.'));
    const mires = view.sheet.mires.map(mire => ({ id: mire.id,
        control: checkbox(form, `Act against ${mire.name} · Cut ${mire.track.boxes.filter(box => box === 'marked').length}`) }));
    const precision = checkbox(form, 'Voluntary Precision · Cut 1 to target a part or deny an ability');
    const impactCut = checkbox(form, 'Voluntary Impact · Cut 1 to raise impact one step');
    const baseImpact = select(form, 'Base impact', [['Normal', 'Normal · one box'], ['Low', 'Low · one fewer'], ['High', 'High · one extra'], ['Massive', 'Massive · whole track, siege-scale permission']]);
    form.append(element('p', 'Three or more Cuts, including automatic Mana Strain, require a feasible objective and a manual permission ruling. Overflow does not bypass permissions or restore reduced impact. Massive requires siege-scale permission. Unearned projects (including Marginalia) grant no Advantage.'));
    const permission = input(form, 'Permission ruling (required for 3+ Cuts or Massive)');
    const roll = button('Roll and save');
    roll.disabled = !ready();
    form.append(roll);
    form.onsubmit = event => event.preventDefault();
    roll.onclick = async () => {
        if (!form.reportValidity())
            return;
        roll.disabled = true;
        const action = { description: description.value, edge: edge.value || null,
            skill: skill.value ? JSON.parse(skill.value) : null,
            advantageSources: [advantage1.value.trim(), advantage2.value.trim()].filter(Boolean),
            cuts: { difficulty: Number(difficulty.value), rankGap: Number(rankGap.value),
                mires: mires.filter(mire => mire.control.checked).map(mire => mire.id),
                precision: precision.checked, impact: impactCut.checked },
            baseImpact: baseImpact.value, permission: permission.value.trim() };
        try {
            await controller.submitAction({ ...await capture(view.context), action });
        }
        catch (error) {
            status.textContent = String(error);
            roll.disabled = !ready();
        }
    };
    root.append(form);
}
