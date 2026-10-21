import { element, button, select, input, checkbox, form, details, choiceGroup, toggle, diceMeter, pill } from "./card-controls.js";
import { HARM_MARKS, HARM_OVERFLOW, DIFFICULTY_CHOICES, RANK_GAP_CHOICES, BASE_IMPACT_CHOICES, BATTERY_CHOICES, harmTargets, edgeChoices, renderSkillChoice, bindHarmOverflow, } from "./declaration-form.js";
import { prepareAction, assertActionHarm } from "./action.js";
import { activeClassBonuses } from "./game/minor-character/sheet.js";
import { sameValue } from "./game/minor-character/events.js";
import { projectDeclaration } from "./game/minor-character/proposals.js";
const DIFFICULTY = ['Ordinary', 'Hard', 'Desperate'];
const RANK_GAP = ['equal rank', 'one rank above', 'two ranks above'];
export function describeDeclaration(view, declaration) {
    const cuts = declaration.cuts ?? {};
    const lines = [
        `Edge: ${declaration.edge ?? 'none'} · ${declaration.skill ? `${declaration.skill.name} (${declaration.skill.kind})` : 'no Skill or Lore'}`
            + ` · Advantage: ${declaration.advantageSources.join(', ') || 'none'}`,
        `${DIFFICULTY[cuts.difficulty ?? 0]} difficulty · ${RANK_GAP[cuts.rankGap ?? 0]}`
            + `${cuts.mires?.length ? ` · against ${cuts.mires.map(id => view.sheet.mires.find(m => m.id === id)?.name ?? id).join(', ')}` : ''}`
            + ` · base impact ${declaration.baseImpact ?? 'Normal'}${declaration.battery ? ` · Origin Core battery: ${declaration.battery}` : ''}`,
    ];
    try {
        assertActionHarm(declaration);
        const prepared = prepareAction(view.sheet, declaration);
        lines.push(`Pool ${prepared.pool} · Cuts ${prepared.cuts.total}${prepared.cuts.total > prepared.cuts.precision + prepared.cuts.impact ? ' (mandatory before Overflow)' : ''}`
            + ` · impact ${prepared.impact}${prepared.needsPermission ? ' · permission ruling required' : ''}`);
    }
    catch (error) {
        lines.push(String(error instanceof Error ? error.message : error));
    }
    return lines;
}
export function describeStakes(view, stakes) {
    if (!stakes)
        return 'Stakes: narrative only, no harm agreed.';
    const harm = stakes.harm;
    const target = harm?.targetAspectId ? view.sheet.aspects.find(a => a.id === harm.targetAspectId)?.name ?? harm.targetAspectId : 'Sera directly';
    return `Stakes: ${stakes.narrative.replace(/\.$/, '') || 'as narrated'}.${harm ? ` Harm ${harm.onConflict} on Conflict, ${harm.onDisaster} on Disaster, absorbed by ${target}; overflow ${harm.overflowChoice === 'burn' ? 'burns a box' : 'becomes injury'}.` : ' No harm agreed.'}`;
}
/** Pool and Cut chips for a declaration: where each die comes from, and what is cut before reading. */
export function renderDicePreview(view, declaration) {
    const box = element('div');
    box.className = 'mc-dice-preview';
    let pool = 0, cut = 0, title = '';
    try {
        assertActionHarm(declaration);
        const prepared = prepareAction(view.sheet, declaration);
        pool = prepared.pool;
        cut = Math.min(pool, prepared.cuts.total);
        title = pool === 0 ? 'No dice: one fallback die' : `${pool} ${pool === 1 ? 'die' : 'dice'}, Cut ${prepared.cuts.total}`;
    }
    catch (error) {
        title = error instanceof Error ? error.message : String(error);
    }
    const line = element('div');
    line.className = 'mc-meter-line';
    line.append(diceMeter(pool, cut, title), element('strong', title));
    const chips = element('div');
    chips.className = 'mc-chip-row';
    if (declaration.edge)
        chips.append(pill(`${declaration.edge} +1`));
    const skill = declaration.skill;
    if (skill) {
        const ranks = skill.kind === 'lore' ? view.sheet.lores : view.sheet.skills;
        chips.append(pill(`${skill.name} ${Object.hasOwn(ranks, skill.name) ? ranks[skill.name] : 0}`));
        const bonus = skill.kind === 'skill' ? activeClassBonuses(view.sheet)[skill.name] ?? 0 : 0;
        if (bonus)
            chips.append(pill(`${view.sheet.activeClass} +${bonus}`, 'class'));
    }
    for (const source of declaration.advantageSources)
        chips.append(pill(`${source} +1`));
    const cuts = declaration.cuts ?? {};
    if (cuts.difficulty)
        chips.append(pill(`${DIFFICULTY[cuts.difficulty]} · Cut ${cuts.difficulty}`, 'cut'));
    if (cuts.rankGap)
        chips.append(pill(`Opposed ${RANK_GAP[cuts.rankGap]} · Cut ${cuts.rankGap}`, 'cut'));
    for (const id of cuts.mires ?? []) {
        const mire = view.sheet.mires.find(entry => entry.id === id);
        const marks = mire?.track.boxes.filter(box => box === 'marked').length ?? 0;
        chips.append(pill(`Against ${mire?.name ?? id}${marks ? ` · Cut ${marks}` : ''}`, 'cut'));
    }
    if (cuts.precision)
        chips.append(pill('Precision · Cut 1', 'cut'));
    if (cuts.impact)
        chips.append(pill('Impact · Cut 1', 'cut'));
    if (declaration.battery)
        chips.append(pill(declaration.battery === 'massive' ? 'Battery: Massive' : 'Battery: bypass rank gap', 'class'));
    box.append(line, chips);
    return box;
}
/** The stakes as the player will read them: the sentence, then what Conflict and Disaster each cost. */
function renderStakesSummary(view, stakes) {
    const box = element('div');
    box.className = 'mc-proposal-stakes-line';
    box.append(element('h5', 'If it goes wrong'));
    const narrative = stakes?.narrative.trim();
    const sentence = element('p', narrative || 'No stakes stated yet.');
    sentence.className = narrative ? 'mc-prose' : 'mc-hint';
    box.append(sentence);
    const harm = stakes?.harm;
    if (harm) {
        const target = harm.targetAspectId ? view.sheet.aspects.find(a => a.id === harm.targetAspectId)?.name ?? harm.targetAspectId : 'Sera directly';
        const grid = element('div');
        grid.className = 'mc-harm-grid';
        for (const [outcome, marks] of [['Conflict', harm.onConflict], ['Disaster', harm.onDisaster]]) {
            const cell = element('div');
            const name = element('strong', outcome);
            name.className = `mc-outcome-${outcome.toLowerCase()}`;
            cell.append(name, element('span', marks ? `${marks} mark${marks === 1 ? '' : 's'} on ${target}` : 'no harm'));
            grid.append(cell);
        }
        box.append(grid);
        // The full sentence stays available to assistive tech and to the history wording.
        const full = element('small', describeStakes(view, stakes));
        full.className = 'mc-visually-hidden';
        box.append(full);
    }
    else if (stakes) {
        const none = element('small', 'No harm agreed.');
        none.className = 'mc-hint';
        box.append(none);
    }
    return box;
}
/** A proposal awaiting the player: what Sera attempts, the dice, what goes wrong, then Accept and roll. */
export function renderProposal(view, proposal, card) {
    const article = element('article');
    article.className = 'mc-proposal';
    article.dataset.proposalId = proposal.id;
    const eyebrow = element('p', 'Proposed roll · waiting for you');
    eyebrow.className = 'mc-eyebrow';
    const title = element('h4', proposal.declaration.description);
    title.className = 'mc-proposal-title';
    let previewNode = renderDicePreview(view, proposal.declaration);
    let stakesNode = renderStakesSummary(view, proposal.declaration.stakes);
    article.append(eyebrow, title, previewNode, stakesNode);
    const mechanics = details('mc-proposal-mechanics', 'How this was read', 'proposal:mechanics');
    mechanics.append(element('p', proposal.reading));
    if (proposal.reasons.length) {
        const reasons = document.createElement('ul');
        reasons.className = 'mc-proposal-reasons';
        for (const reason of proposal.reasons)
            reasons.append(element('li', reason));
        mechanics.append(reasons);
    }
    const mechanicsLines = element('div');
    mechanicsLines.className = 'mc-proposal-mechanics-lines';
    mechanics.append(mechanicsLines);
    const current = proposal.declaration.stakes;
    // Spec §10: a Jev-only proposal arrives without stakes, so the stakes controls open first and the text takes focus.
    const unstated = current !== undefined && !current.narrative.trim();
    const change = details('mc-change-stakes', unstated ? 'Stakes' : 'Change stakes', 'proposal:change');
    change.open = unstated;
    const stakesForm = form('mc-proposal-stakes');
    const narrative = input(stakesForm, 'What is at stake if this goes wrong?', false, 'proposal:narrative');
    narrative.value = current?.narrative ?? '';
    // The host focuses [data-autofocus] once per proposal after the render; the HTML attribute does nothing on a re-rendered node.
    if (unstated)
        narrative.dataset.autofocus = 'true';
    const onConflict = select(stakesForm, 'Harm on Conflict', HARM_MARKS, 'proposal:onConflict');
    onConflict.value = String(current?.harm?.onConflict ?? 0);
    const onDisaster = select(stakesForm, 'Harm on Disaster', HARM_MARKS, 'proposal:onDisaster');
    onDisaster.value = String(current?.harm?.onDisaster ?? 0);
    const target = select(stakesForm, 'Harm target', harmTargets(view), 'proposal:target');
    target.value = current?.harm?.targetAspectId ?? '';
    const overflow = select(stakesForm, 'Harm overflow choice', HARM_OVERFLOW, 'proposal:overflow');
    overflow.value = current?.harm?.overflowChoice ?? 'injury';
    bindHarmOverflow(target, overflow);
    const description = input(stakesForm, 'What does Sera attempt?', true, 'proposal:description');
    description.classList.add('mc-prose-input');
    description.value = proposal.declaration.description;
    const edge = choiceGroup(stakesForm, 'Edge · +1 die when the approach fits', 'edge', edgeChoices(view), 'chips', proposal.declaration.edge ?? '');
    const initialSkill = proposal.declaration.skill
        ? JSON.stringify({ kind: proposal.declaration.skill.kind, name: proposal.declaration.skill.name }) : '';
    const skill = renderSkillChoice(stakesForm, view, initialSkill);
    const advantages = document.createElement('fieldset');
    advantages.className = 'mc-choice mc-advantages';
    advantages.append(element('legend', 'Advantage · up to 2, +1 die each'));
    const advantage1 = input(advantages, 'First Advantage source (optional)', false, 'proposal:advantage1');
    advantage1.value = proposal.declaration.advantageSources[0] ?? '';
    const advantage2 = input(advantages, 'Second distinct Advantage source (optional)', false, 'proposal:advantage2');
    advantage2.value = proposal.declaration.advantageSources[1] ?? '';
    stakesForm.append(advantages);
    const difficulty = choiceGroup(stakesForm, 'Difficulty', 'difficulty', DIFFICULTY_CHOICES, 'segmented', String(proposal.declaration.cuts?.difficulty ?? 0));
    const rankGap = choiceGroup(stakesForm, 'Opposed rank gap', 'rankGap', RANK_GAP_CHOICES, 'segmented', String(proposal.declaration.cuts?.rankGap ?? 0));
    const activeMires = new Set(proposal.declaration.cuts?.mires ?? []);
    const mires = view.sheet.mires.map(mire => {
        const marks = mire.track.boxes.filter(box => box === 'marked').length;
        const control = toggle(stakesForm, `Act against ${mire.name}`, marks ? `Cut ${marks}` : 'no marks', `proposal:mire:${mire.id}`);
        control.checked = activeMires.has(mire.id);
        return { id: mire.id, control };
    });
    const precision = checkbox(stakesForm, 'Voluntary Precision · Cut 1 to target a part or deny an ability', 'proposal:precision');
    precision.checked = !!proposal.declaration.cuts?.precision;
    const impact = checkbox(stakesForm, 'Voluntary Impact · Cut 1 to raise impact one step', 'proposal:impact');
    impact.checked = !!proposal.declaration.cuts?.impact;
    const baseImpact = choiceGroup(stakesForm, 'Base impact', 'baseImpact', BASE_IMPACT_CHOICES, 'segmented', proposal.declaration.baseImpact ?? 'Normal');
    const battery = choiceGroup(stakesForm, 'Origin Core Battery', 'battery', BATTERY_CHOICES, 'segmented', proposal.declaration.battery ?? '');
    const permission = input(stakesForm, 'Permission ruling (required for 3+ Cuts or Massive)', false, 'proposal:permission');
    permission.value = proposal.declaration.permission ?? '';
    change.append(stakesForm);
    const revised = () => {
        const conflict = Number(onConflict.value), disaster = Number(onDisaster.value);
        const stakesText = narrative.value.trim();
        const harm = conflict > 0 || disaster > 0
            ? { onConflict: conflict, onDisaster: disaster, targetAspectId: target.value || null, overflowChoice: overflow.value }
            : null;
        // Untouched optional fields stay absent so an unchanged proposal is not recorded as a revision.
        const base = projectDeclaration(proposal.declaration);
        const nextDescription = description.value === base.description ? base.description : (description.value.trim() || base.description);
        const nextEdge = (edge.value || null);
        const nextSkill = skill.value ? JSON.parse(skill.value) : null;
        const nextAdvantages = [advantage1.value.trim(), advantage2.value.trim()].filter(Boolean);
        const diffVal = Number(difficulty.value || 0);
        const gapVal = Number(rankGap.value || 0);
        const miresVal = mires.filter(mire => mire.control.checked).map(mire => mire.id);
        const includeDifficulty = diffVal !== (base.cuts?.difficulty ?? 0) || base.cuts?.difficulty !== undefined;
        const includeRankGap = gapVal !== (base.cuts?.rankGap ?? 0) || base.cuts?.rankGap !== undefined;
        const includeMires = !sameValue(miresVal, base.cuts?.mires ?? []) || base.cuts?.mires !== undefined;
        const includePrecision = precision.checked !== (base.cuts?.precision ?? false) || base.cuts?.precision !== undefined;
        const includeImpact = impact.checked !== (base.cuts?.impact ?? false) || base.cuts?.impact !== undefined;
        const hasCuts = base.cuts !== undefined || includeDifficulty || includeRankGap || includeMires || includePrecision || includeImpact;
        const cuts = hasCuts ? {
            ...(includeDifficulty ? { difficulty: diffVal } : {}),
            ...(includeRankGap ? { rankGap: gapVal } : {}),
            ...(includeMires ? { mires: miresVal } : {}),
            ...(includePrecision ? { precision: precision.checked } : {}),
            ...(includeImpact ? { impact: impact.checked } : {}),
        } : undefined;
        const impactVal = (baseImpact.value || 'Normal');
        const includeBaseImpact = impactVal !== (base.baseImpact ?? 'Normal') || base.baseImpact !== undefined;
        const batteryVal = battery.value;
        const ruling = permission.value.trim();
        const includePermission = ruling !== (base.permission ?? '') || base.permission !== undefined;
        const includeStakes = stakesText !== (base.stakes?.narrative ?? '') || !sameValue(harm, base.stakes?.harm ?? null) || base.stakes !== undefined;
        const next = {
            description: nextDescription,
            edge: nextEdge,
            skill: nextSkill,
            advantageSources: nextAdvantages,
            ...(cuts === undefined ? {} : { cuts }),
            ...(includeBaseImpact ? { baseImpact: impactVal } : {}),
            ...(batteryVal ? { battery: batteryVal } : {}),
            ...(includePermission ? { permission: ruling } : {}),
            ...(includeStakes ? { stakes: { narrative: stakesText, harm } } : {}),
        };
        return projectDeclaration(next);
    };
    const actions = element('div');
    actions.className = 'mc-actions';
    const accept = button('', 'menu_button mc-primary');
    accept.disabled = !card.ready();
    const secondary = element('div');
    secondary.className = 'mc-actions-secondary';
    const changeToggle = button(unstated ? 'Hide stakes' : 'Change stakes');
    const syncToggle = () => {
        changeToggle.setAttribute('aria-expanded', String(change.open));
        changeToggle.textContent = change.open ? 'Hide stakes' : 'Change stakes';
    };
    syncToggle();
    changeToggle.onclick = () => {
        change.open = !change.open;
        syncToggle();
        if (change.open)
            narrative.focus();
    };
    const dontRoll = button('Don’t roll');
    dontRoll.disabled = !card.ready();
    secondary.append(changeToggle, dontRoll);
    actions.append(accept, secondary);
    const cancelForm = form('mc-proposal-cancel');
    cancelForm.hidden = true;
    const cancelNote = input(cancelForm, 'Why not roll? (optional, recorded)', false, 'proposal:cancelNote');
    const cancel = button('Cancel this roll');
    cancel.disabled = !card.ready();
    cancelForm.append(cancel);
    dontRoll.onclick = () => { cancelForm.hidden = !cancelForm.hidden; if (!cancelForm.hidden)
        cancelNote.focus(); };
    if (unstated)
        article.append(change, actions, cancelForm, mechanics);
    else
        article.append(actions, cancelForm, mechanics, change);
    const update = () => {
        skill.revealUntrainedIfSelected();
        syncToggle();
        const declaration = revised();
        title.textContent = declaration.description;
        const nextPreview = renderDicePreview(view, declaration);
        previewNode.replaceChildren(...nextPreview.children);
        const nextStakes = renderStakesSummary(view, declaration.stakes);
        stakesNode.replaceChildren(...nextStakes.children);
        mechanicsLines.replaceChildren(...describeDeclaration(view, declaration).map(line => element('p', line)));
        let pool = 0;
        try {
            pool = prepareAction(view.sheet, declaration).pool;
        }
        catch {
            pool = 0;
        }
        accept.textContent = pool === 0 ? 'Accept and roll the fallback die' : `Accept and roll ${pool} ${pool === 1 ? 'die' : 'dice'}`;
    };
    stakesForm.addEventListener('change', update);
    stakesForm.addEventListener('input', update);
    stakesForm.addEventListener('mc-restored', update);
    update();
    accept.onclick = async () => {
        update();
        if (!stakesForm.reportValidity())
            return;
        accept.disabled = cancel.disabled = true;
        try {
            const declaration = revised();
            assertActionHarm(declaration);
            const original = projectDeclaration(proposal.declaration);
            if (!sameValue(declaration, original)) {
                await card.controller.reviseProposal(await card.capture(view.context), proposal.id, declaration);
            }
            const latest = card.controller.playerView;
            if (!latest || latest.proposal?.id !== proposal.id)
                throw new Error('The proposal changed; review it again.');
            await card.controller.submitAction({ ...await card.capture(latest.context), action: declaration }, proposal.id);
        }
        catch (error) {
            card.report(String(error));
            accept.disabled = cancel.disabled = !card.ready();
        }
    };
    cancel.onclick = async () => {
        accept.disabled = cancel.disabled = true;
        try {
            await card.controller.cancelProposal(await card.capture(view.context), proposal.id, cancelNote.value.trim());
        }
        catch (error) {
            card.report(String(error));
            accept.disabled = cancel.disabled = !card.ready();
        }
    };
    return article;
}
