import { element, button, select, input, checkbox, form, details } from "./card-controls.js";
import { HARM_MARKS, HARM_OVERFLOW, harmTargets } from "./declaration-form.js";
import { prepareAction } from "./action.js";
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
/** A proposal awaiting the player: the reading, the mechanics, editable stakes, then Accept & roll or Cancel. */
export function renderProposal(view, proposal, card) {
    const article = element('article');
    article.className = 'mc-proposal';
    article.dataset.proposalId = proposal.id;
    // Phone first: reading, why it paused and the stakes, then the decision; mechanics and edits sit behind disclosures.
    // The player's own words are the latest chat message, so they are not repeated here.
    article.append(element('p', proposal.reading));
    if (proposal.reasons.length) {
        const reasons = document.createElement('ul');
        for (const reason of proposal.reasons)
            reasons.append(element('li', reason));
        article.append(reasons);
    }
    const stakesLine = element('p', describeStakes(view, proposal.declaration.stakes));
    stakesLine.className = 'mc-proposal-stakes-line';
    article.append(stakesLine);
    const mechanics = details('mc-proposal-mechanics', 'Mechanics', 'proposal:mechanics');
    for (const line of describeDeclaration(view, proposal.declaration))
        mechanics.append(element('p', line));
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
    const precision = checkbox(stakesForm, 'Voluntary Precision · Cut 1 to target a part or deny an ability', 'proposal:precision');
    precision.checked = !!proposal.declaration.cuts?.precision;
    const impact = checkbox(stakesForm, 'Voluntary Impact · Cut 1 to raise impact one step', 'proposal:impact');
    impact.checked = !!proposal.declaration.cuts?.impact;
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
        const cuts = base.cuts !== undefined || precision.checked || impact.checked ? { ...(base.cuts ?? {}),
            ...(precision.checked || base.cuts?.precision !== undefined ? { precision: precision.checked } : {}),
            ...(impact.checked || base.cuts?.impact !== undefined ? { impact: impact.checked } : {}) } : undefined;
        const ruling = permission.value.trim();
        return projectDeclaration({ ...base,
            ...(cuts === undefined ? {} : { cuts }),
            ...(ruling || base.permission !== undefined ? { permission: ruling } : {}),
            ...(stakesText || harm || base.stakes !== undefined ? { stakes: { narrative: stakesText, harm } } : {}) });
    };
    const actions = element('div');
    actions.className = 'mc-actions';
    const accept = button('Accept & roll');
    accept.disabled = !card.ready();
    const cancel = button('Cancel');
    cancel.disabled = !card.ready();
    actions.append(accept, cancel);
    const cancelForm = form('mc-proposal-cancel');
    const cancelNote = input(cancelForm, 'Why cancel? (optional, recorded)', false, 'proposal:cancelNote');
    if (unstated)
        article.append(change, actions, mechanics, cancelForm);
    else
        article.append(actions, mechanics, change, cancelForm);
    accept.onclick = async () => {
        if (!stakesForm.reportValidity())
            return;
        accept.disabled = cancel.disabled = true;
        try {
            const declaration = revised();
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
