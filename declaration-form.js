import { element, button, input, form, choiceGroup, toggle, diceMeter, details } from "./card-controls.js";
import { activeClassBonuses } from "./game/minor-character/sheet.js";
import { prepareAction } from "./action.js";
export const HARM_MARKS = [
    ['0', 'No Harm · 0 marks'], ['1', 'Low · 1 mark'], ['2', 'Normal · 2 marks'],
    ['3', 'High · 3 marks'], ['4', 'Extreme · 4 marks'],
];
export function harmTargets(view) {
    return [['', 'Direct injury (no aspect absorption)'],
        ...view.sheet.aspects.map(a => [a.id, `Absorb on ${a.name} (${a.type})`])];
}
export const HARM_OVERFLOW = [['injury', 'Overflow becomes injury'], ['burn', 'Burn 1 box to absorb overflow']];
export const DIFFICULTY_CHOICES = [
    { value: '0', label: 'Ordinary', hint: 'no Cut' }, { value: '1', label: 'Hard', hint: 'Cut 1' }, { value: '2', label: 'Desperate', hint: 'Cut 2' },
];
export const RANK_GAP_CHOICES = [
    { value: '0', label: 'Equal', hint: 'no Cut' }, { value: '1', label: 'One above', hint: 'Cut 1' },
    { value: '2', label: 'Two above', hint: 'Cut 2 · impact down' },
];
export const BASE_IMPACT_CHOICES = [
    { value: 'Low', label: 'Low' }, { value: 'Normal', label: 'Normal' }, { value: 'High', label: 'High' }, { value: 'Massive', label: 'Massive' },
];
export const BATTERY_CHOICES = [
    { value: '', label: 'None' }, { value: 'massive', label: 'Massive impact' }, { value: 'bypass-rank-gap', label: 'Bypass rank gap' },
];
export function edgeChoices(view) {
    return [{ value: '', label: 'None' }, ...view.sheet.edges.map(name => ({ value: name, label: name }))];
}
export function renderSkillChoice(parent, view, initial = '') {
    const bonuses = activeClassBonuses(view.sheet);
    const trained = [], untrained = [];
    for (const [kind, values] of [['skill', view.sheet.skills], ['lore', view.sheet.lores]]) {
        for (const [name, rank] of Object.entries(values)) {
            const bonus = kind === 'skill' && Object.hasOwn(bonuses, name) ? bonuses[name] : 0;
            const choice = { value: JSON.stringify({ kind, name }), label: name,
                hint: `${kind === 'lore' ? 'Lore' : 'Skill'} · ${rank + bonus}d${bonus ? ` · ${view.sheet.activeClass} +${bonus}` : ''}` };
            (rank + bonus > 0 ? trained : untrained).push(choice);
        }
    }
    const skill = choiceGroup(parent, 'Skill or Lore · pick one', 'skill', [...trained, ...untrained, { value: '', label: 'None', hint: 'no Skill or Lore' }], 'chips', initial);
    const untrainedValues = new Set(untrained.map(choice => choice.value));
    skill.inputs.forEach(control => { if (untrainedValues.has(control.value))
        control.parentElement.classList.add('mc-choice-untrained'); });
    let more;
    const syncButton = () => {
        if (!more)
            return;
        const open = skill.root.classList.contains('mc-show-untrained');
        more.textContent = open ? 'Hide untrained' : `Show ${untrained.length} untrained`;
        more.setAttribute('aria-expanded', String(open));
    };
    const revealUntrainedIfSelected = () => {
        if (untrainedValues.has(skill.value)) {
            skill.root.classList.add('mc-show-untrained');
            syncButton();
        }
    };
    if (untrained.length) {
        more = button(`Show ${untrained.length} untrained`, 'mc-link-button');
        more.setAttribute('aria-expanded', 'false');
        more.onclick = () => {
            skill.root.classList.toggle('mc-show-untrained');
            syncButton();
        };
        skill.root.append(more);
    }
    revealUntrainedIfSelected();
    return {
        root: skill.root, inputs: skill.inputs,
        get value() { return skill.value; },
        set value(next) { skill.value = next; },
        revealUntrainedIfSelected,
    };
}
const dice = (n) => `${n} ${n === 1 ? 'die' : 'dice'}`;
/** Edge, Skill and Advantage as chips, Cuts as segmented controls and toggles, and a live dice count above Roll. */
export function renderDeclarationForm(view, card) {
    const root = form('mc-action-declaration');
    const body = element('div');
    body.className = 'mc-declare-body';
    root.append(body);
    const description = input(body, 'What does Sera attempt?', true, 'description');
    description.classList.add('mc-prose-input');
    const edge = choiceGroup(body, 'Edge · +1 die when the approach fits', 'edge', edgeChoices(view), 'chips', '');
    const skill = renderSkillChoice(body, view, '');
    const advantages = document.createElement('fieldset');
    advantages.className = 'mc-choice mc-advantages';
    advantages.append(element('legend', 'Advantage · up to 2, +1 die each'));
    const advantage1 = input(advantages, 'First Advantage source (optional)', false, 'advantage1');
    const advantage2 = input(advantages, 'Second distinct Advantage source (optional)', false, 'advantage2');
    body.append(advantages);
    const cuts = element('section');
    cuts.className = 'mc-declare-cuts';
    cuts.append(element('h4', 'Cuts · declare before rolling'));
    body.append(cuts);
    const difficulty = choiceGroup(cuts, 'Difficulty', 'difficulty', DIFFICULTY_CHOICES, 'segmented', '0');
    const rankGap = choiceGroup(cuts, 'Opposed rank gap', 'rankGap', RANK_GAP_CHOICES, 'segmented', '0');
    const gapNote = element('p', 'Three or more ranks above: no direct harm until a real vulnerability or asset changes the matchup. Escape, protection and preparation remain possible.');
    gapNote.className = 'mc-hint';
    cuts.append(gapNote);
    const extras = element('div');
    extras.className = 'mc-toggles';
    extras.append(element('p', 'Acting against a Mire, or choosing extra Cuts'));
    const mires = view.sheet.mires.map(mire => {
        const marks = mire.track.boxes.filter(box => box === 'marked').length;
        return { id: mire.id, control: toggle(extras, `Act against ${mire.name}`, marks ? `Cut ${marks}` : 'no marks', `mire:${mire.id}`) };
    });
    const precision = toggle(extras, 'Voluntary Precision · target a part or deny an ability', 'Cut 1', 'precision');
    const impactCut = toggle(extras, 'Voluntary Impact · raise impact one step', 'Cut 1', 'impact');
    cuts.append(extras);
    const baseImpact = choiceGroup(cuts, 'Base impact', 'baseImpact', BASE_IMPACT_CHOICES, 'segmented', 'Normal');
    const batteryBox = details('mc-declare-battery', 'Origin Core Battery · 2 Core Fatigue', 'battery:open');
    const battery = choiceGroup(batteryBox, 'Origin Core Battery', 'battery', BATTERY_CHOICES, 'segmented', '');
    cuts.append(batteryBox);
    const footer = element('div');
    footer.className = 'mc-declare-footer';
    const permissionLabel = element('label', 'Permission ruling (required for 3+ Cuts or Massive)');
    permissionLabel.className = 'mc-permission';
    const permission = document.createElement('input');
    permission.className = 'text_pole';
    permission.dataset.draft = 'permission';
    permission.placeholder = 'Why this is feasible';
    permissionLabel.append(permission);
    const meterLine = element('div');
    meterLine.className = 'mc-meter-line';
    const meterText = element('div');
    meterText.className = 'mc-meter-text';
    const meterTitle = element('strong');
    const meterSub = element('span');
    meterText.append(meterTitle, meterSub);
    const roll = button('Roll', 'menu_button mc-primary');
    roll.dataset.roll = '';
    footer.append(permissionLabel, meterLine, roll);
    root.append(footer);
    const read = () => {
        const skillValue = skill.value;
        return { description: description.value, edge: edge.value || null,
            skill: skillValue ? JSON.parse(skillValue) : null,
            advantageSources: [advantage1.value.trim(), advantage2.value.trim()].filter(Boolean),
            cuts: { difficulty: Number(difficulty.value || 0), rankGap: Number(rankGap.value || 0),
                mires: mires.filter(mire => mire.control.checked).map(mire => mire.id),
                precision: precision.checked, impact: impactCut.checked },
            baseImpact: (baseImpact.value || 'Normal'), permission: permission.value.trim(),
            ...(battery.value ? { battery: battery.value } : {}) };
    };
    /** The live count above Roll: the same validation the resolver runs, without dice. */
    const update = () => {
        skill.revealUntrainedIfSelected();
        let title = '', sub = '', pool = 0, cut = 0, needs = false;
        try {
            const prepared = prepareAction(view.sheet, { ...read(), description: description.value.trim() || 'pending' });
            pool = prepared.pool;
            cut = Math.min(prepared.pool, prepared.cuts.total);
            needs = prepared.needsPermission;
            const left = pool - cut;
            title = pool === 0 ? 'No dice: one fallback die' : `${dice(pool)}, Cut ${prepared.cuts.total}`;
            sub = pool === 0 ? 'A 6 counts as Conflict. No Twist.'
                : left <= 0 ? 'Every die is cut: one fallback die, no Twist'
                    : `${cut ? `Highest ${cut} removed, ` : ''}${left} left to read${prepared.origin.overflow ? ` · ${prepared.origin.overflow} over the cap cancels Cuts` : ''}`;
        }
        catch (error) {
            title = 'Check the declaration';
            sub = error instanceof Error ? error.message : String(error);
        }
        meterTitle.textContent = title;
        meterSub.textContent = sub;
        meterLine.replaceChildren(diceMeter(pool, cut, `${title}. ${sub}`), meterText);
        permissionLabel.hidden = !needs && !permission.value.trim();
        roll.textContent = pool === 0 ? 'Roll the fallback die' : `Roll ${dice(pool)}`;
    };
    root.addEventListener('change', update);
    root.addEventListener('input', update);
    root.addEventListener('mc-restored', update);
    update();
    roll.disabled = !card.ready();
    roll.onclick = async () => {
        update();
        if (!root.reportValidity())
            return;
        roll.disabled = true;
        try {
            await card.controller.submitAction({ ...await card.capture(view.context), action: read() });
        }
        catch (error) {
            card.report(String(error));
            roll.disabled = !card.ready();
        }
    };
    return root;
}
/** Direct injury has no Aspect boxes to burn. Preserve an invalid saved selection until explicitly edited. */
export function bindHarmOverflow(target, overflow) {
    const sync = () => { if (!target.value)
        overflow.value = 'injury'; overflow.disabled = !target.value; };
    target.onchange = sync;
    overflow.dataset.harmOverflow = '';
    const restore = () => { overflow.disabled = !target.value && overflow.value === 'injury'; };
    overflow.addEventListener('mc-restored', restore);
    restore();
}
