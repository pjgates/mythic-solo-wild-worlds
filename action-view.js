import { element, button, form, select, captureDrafts, restoreDrafts } from "./card-controls.js";
import { renderDeclarationForm } from "./declaration-form.js";
import { renderPendingStakes, renderBankedTwists } from "./stakes-view.js";
import { renderProposal } from "./proposal-view.js";
import { renderReceipt } from "./history-view.js";
import { describeTriage } from "./game/minor-character/proposals.js";
const ODDS_LABELS = { certain: 'Certain', 'nearly-certain': 'Nearly certain', 'very-likely': 'Very likely',
    likely: 'Likely', 'fifty-fifty': '50/50', unlikely: 'Unlikely', 'very-unlikely': 'Very unlikely', 'nearly-impossible': 'Nearly impossible', impossible: 'Impossible' };
const latestTriage = (view) => view.proposal ? view.proposal.triage : view.turns.at(-1)?.triage;
// Draft state lives beside the card element so a rebuild never loses what the player typed.
const cards = new WeakMap();
/** Opens the manual declaration form on the next render (the flow's Declare an action); a card never rendered has no state to open. */
export function expandActionCard(root) {
    const state = cards.get(root);
    if (state)
        state.expanded = true;
}
function describeHarm(view, harm) {
    const target = harm.command.targetAspectId ? view.sheet.aspects.find(a => a.id === harm.command.targetAspectId)?.name ?? harm.command.targetAspectId : null;
    const parts = [`Harm ${harm.command.marks}`];
    if (harm.markedBoxes.length)
        parts.push(`${harm.markedBoxes.length} box${harm.markedBoxes.length === 1 ? '' : 'es'} marked${target ? ` on ${target}` : ''}`);
    if (harm.burnedBoxes.length)
        parts.push(`${harm.burnedBoxes.length} burned`);
    if (harm.createdInjury)
        parts.push(`injury: ${harm.createdInjury.name}`);
    return `${parts.join(' · ')}.`;
}
/** The one line a phone sees while nothing is pending: the latest result, or what the card is for. */
function summarize(view, latest) {
    if (view.proposal)
        return `Proposed roll: ${view.proposal.declaration.description} — review`;
    if (view.pendingManual)
        return 'Roll saved · consequences to record';
    if (!latest?.receipt)
        return 'No rolls this scene';
    const r = latest.receipt;
    return `${r.command.action.description} — ${r.result.outcome}${r.result.twist ? ' + Twist' : ''}`;
}
export function renderActions(root, controller, capture, ready, flow = {}) {
    const previous = cards.get(root);
    const typed = previous ? captureDrafts(root) : {};
    root.replaceChildren();
    const view = controller.playerView;
    if (!view) {
        cards.delete(root);
        return;
    }
    const latest = view.history.slice().reverse().find(entry => entry.receipt);
    const scope = JSON.stringify([view.context.campaignId, view.context.branchId, view.play.scene.id,
        view.proposal?.id ?? null, view.pendingManual, latest?.operationId ?? null]);
    // Collapsed by default, even before the first roll: on a phone the transcript and composer come first.
    const state = previous?.scope === scope ? { ...previous, values: { ...previous.values, ...typed } }
        : { scope, expanded: false, values: {} };
    cards.set(root, state);
    const status = element('p', flow.message ?? '');
    status.className = 'mc-card-status';
    status.setAttribute('role', 'status');
    const card = { controller, capture, ready: () => ready() && !flow.busy, report: message => { status.textContent = message; } };
    const settled = !view.pendingManual && !view.proposal;
    const showForm = settled && state.expanded;
    // Live choices (oracle, scene check, narrate) count as expanded so the primary button is never clipped.
    const expanded = showForm || !settled || !!flow.choices?.length || !!flow.fate;
    const header = element('header');
    header.className = 'mc-card-header';
    const summary = element('p', summarize(view, latest));
    summary.className = 'mc-card-summary';
    header.append(summary);
    // A flow choice that already says Declare… is the one way into the form; a second Declare button beside it would only confuse.
    const declareOffered = !!flow.choices?.some(choice => choice.label.startsWith('Declare'));
    if (settled && (showForm || !declareOffered)) {
        const toggle = button(showForm ? 'Hide' : 'Declare an action');
        toggle.setAttribute('aria-expanded', String(showForm));
        toggle.onclick = () => { state.expanded = !showForm; renderActions(root, controller, capture, ready, flow); };
        header.append(toggle);
    }
    root.append(header, status);
    if (flow.fate) {
        const fate = flow.fate;
        const oracle = form('mc-oracle');
        const odds = select(oracle, 'Odds', fate.options.map(option => [option, ODDS_LABELS[option] ?? option]));
        odds.value = fate.odds;
        odds.onchange = () => fate.select(odds.value);
        root.append(oracle);
    }
    const choiceList = (list, className) => {
        const choices = element('div');
        choices.className = `mc-actions ${className}`;
        for (const choice of list) {
            const control = button(choice.label);
            control.disabled = !!flow.busy;
            control.onclick = async () => {
                control.disabled = true;
                try {
                    await choice.run();
                }
                catch (error) {
                    card.report(String(error));
                    control.disabled = !!flow.busy;
                }
            };
            choices.append(control);
        }
        return choices;
    };
    if (flow.choices?.length)
        root.append(choiceList(flow.choices, 'mc-flow-choices'));
    if (view.proposal)
        root.append(renderProposal(view, view.proposal, card));
    // While a turn is live on the card (status, choices, odds), the last recorded reading belongs to an earlier message.
    const live = !!flow.message || !!flow.choices?.length || !!flow.fate;
    const triage = expanded && (view.proposal || !live) ? latestTriage(view) : undefined;
    if (triage) {
        const reader = element('p', describeTriage(triage));
        reader.className = 'mc-triage-reading';
        root.append(reader);
    }
    // Collapsed, the card is its header line plus any live choice (pending consequences, banked Twists, flow choices).
    for (const entry of view.history) {
        if (!entry.receipt)
            continue;
        const pending = view.pendingManual === entry.operationId;
        if (!pending && (entry !== latest || !expanded))
            continue;
        const receipt = renderReceipt(entry.receipt);
        receipt.classList.toggle('mc-pending', pending);
        if (entry.harm)
            receipt.append(element('p', describeHarm(view, entry.harm)));
        const handled = view.history.find(j => j.manualTarget === entry.operationId);
        if (handled)
            receipt.append(element('p', handled.manualNote));
        if (pending)
            receipt.append(renderPendingStakes(view, entry, card));
        root.append(receipt);
    }
    const twists = renderBankedTwists(view, card);
    if (twists)
        root.append(twists);
    if (showForm)
        root.append(renderDeclarationForm(view, card));
    if (showForm && flow.expandedChoices?.length)
        root.append(choiceList(flow.expandedChoices, 'mc-flow-secondary'));
    root.classList.toggle('mc-card-expanded', expanded);
    restoreDrafts(root, state.values);
}
