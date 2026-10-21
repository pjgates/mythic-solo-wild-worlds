import { element, button, form, select, captureDrafts, restoreDrafts } from "./card-controls.js";
import { renderDeclarationForm } from "./declaration-form.js";
import { renderPendingStakes, renderBankedTwists } from "./stakes-view.js";
import { renderProposal } from "./proposal-view.js";
import { renderReceipt } from "./history-view.js";
import { describeTriage } from "./game/minor-character/proposals.js";
import { renderInjurySuggestions } from "./injury-view.js";
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
        parts.push(`injury: ${view.character.conditions.find(c => c.id === harm.createdInjury.id)?.name ?? harm.createdInjury.name}`);
    return `${parts.join(' · ')}.`;
}
/** Harm as it landed: the sentence and, when an Aspect absorbed it, that Aspect's track as it stands now. */
function renderHarmLine(view, harm) {
    const line = element('div');
    line.className = 'mc-harm-line';
    line.append(element('p', describeHarm(view, harm)));
    const aspect = harm.command.targetAspectId ? view.sheet.aspects.find(a => a.id === harm.command.targetAspectId) : undefined;
    if (aspect) {
        const boxes = element('span');
        boxes.className = 'mc-boxes mc-boxes-small';
        boxes.setAttribute('role', 'img');
        const marked = aspect.track.boxes.filter(box => box === 'marked').length, burned = aspect.track.boxes.filter(box => box === 'burned').length;
        boxes.setAttribute('aria-label', `${aspect.name}: ${marked} marked, ${burned} burned of ${aspect.track.boxes.length}`);
        for (const box of aspect.track.boxes) {
            const pip = element('span');
            pip.className = `mc-pip mc-${box}`;
            boxes.append(pip);
        }
        line.append(boxes);
    }
    return line;
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
    return `${r.result.outcome}${r.result.twist ? ' + Twist' : ''} · ${r.command.action.description}`;
}
/** The quieter second line: where the campaign stands, so a phone sees Scene, Chaos and Exposure without the sheet. */
function standing(view, chaos) {
    const exposure = view.sheet.tracks.exposure.boxes;
    const marked = exposure.filter(box => box !== 'clear').length;
    return `Scene ${view.play.scene.number} · Chaos ${chaos ?? view.sheet.chaos} · Exposure ${marked} of ${exposure.length}`;
}
/** The dot beside the summary: the latest outcome's colour, gold while something waits. */
function tone(view, latest) {
    if (view.proposal || view.pendingManual)
        return 'waiting';
    return latest?.receipt ? latest.receipt.result.outcome.toLowerCase() : 'idle';
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
    const latest = view.history.slice().reverse().find(entry => entry.receipt && entry.sceneId === view.play.scene.id);
    const scope = JSON.stringify([view.context.campaignId, view.context.branchId, view.play.scene.id,
        view.proposal?.id ?? null, view.pendingManual, latest?.operationId ?? null]);
    // Collapsed by default, even before the first roll: on a phone the transcript and composer come first.
    const state = previous?.scope === scope ? { ...previous, values: { ...previous.values, ...typed } }
        : { scope, expanded: false, receiptOpen: false, values: {} };
    cards.set(root, state);
    const status = element('p', flow.message ?? '');
    status.className = 'mc-card-status';
    status.setAttribute('role', 'status');
    const card = { controller, capture, ready: () => ready() && !flow.busy, report: message => { status.textContent = message; } };
    const settled = !view.pendingManual && !view.proposal;
    const showForm = settled && state.expanded;
    // Live choices (oracle, scene check, narrate) count as expanded so the primary button is never clipped.
    const liveDecision = !!view.proposal || !!view.pendingManual || !!flow.choices?.length || !!flow.fate;
    if (liveDecision || showForm)
        state.receiptOpen = false;
    const expanded = state.receiptOpen || showForm || !settled || !!flow.choices?.length || !!flow.fate || !!flow.injuries?.item;
    const header = element('header');
    header.className = 'mc-card-header';
    const dot = element('span');
    dot.className = `mc-card-dot mc-tone-${tone(view, latest)}`;
    dot.setAttribute('aria-hidden', 'true');
    const lines = element('div');
    lines.className = 'mc-card-lines';
    const summary = element('p', summarize(view, latest));
    summary.className = 'mc-card-summary';
    const where = element('p', standing(view, flow.chaos));
    where.className = 'mc-card-standing';
    lines.append(summary, where);
    header.append(dot, lines);
    if (settled && latest && !liveDecision && !showForm) {
        const inspect = button(state.receiptOpen ? 'Close result' : 'Last roll', 'menu_button mc-card-toggle');
        inspect.setAttribute('aria-expanded', String(state.receiptOpen));
        inspect.onclick = () => { state.receiptOpen = !state.receiptOpen; renderActions(root, controller, capture, ready, flow); };
        header.append(inspect);
    }
    // A flow choice that already says Declare… is the one way into the form; a second Declare button beside it would only confuse.
    const declareOffered = !!flow.choices?.some(choice => choice.label.startsWith('Declare'));
    if (settled && (showForm || !declareOffered)) {
        const toggle = button(showForm ? 'Close' : 'Declare', 'menu_button mc-card-toggle');
        toggle.setAttribute('aria-expanded', String(showForm));
        toggle.setAttribute('aria-label', showForm ? 'Close the declaration' : 'Declare an action');
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
        if (!pending && (entry !== latest || !state.receiptOpen))
            continue;
        const receipt = renderReceipt(entry.receipt);
        receipt.classList.toggle('mc-pending', pending);
        if (entry.harm)
            receipt.append(renderHarmLine(view, entry.harm));
        const handled = view.history.find(j => j.manualTarget === entry.operationId);
        if (handled)
            receipt.append(element('p', handled.manualNote));
        if (pending)
            receipt.append(renderPendingStakes(view, entry, card));
        root.append(receipt);
    }
    const twists = renderBankedTwists(view, card);
    if (twists) {
        const disclosure = element('details');
        disclosure.className = 'mc-banked-disclosure';
        disclosure.dataset.draft = 'banked:open';
        const count = view.bankedTwists.filter(twist => !twist.spent && twist.sceneId === view.play.scene.id).length;
        disclosure.append(element('summary', `${count} banked Twist${count === 1 ? '' : 's'}`), twists);
        root.append(disclosure);
    }
    if (showForm)
        root.append(renderDeclarationForm(view, card));
    if (showForm && flow.expandedChoices?.length)
        root.append(choiceList(flow.expandedChoices, 'mc-flow-secondary'));
    if (flow.injuries)
        root.append(renderInjurySuggestions(flow.injuries));
    root.classList.toggle('mc-card-expanded', expanded);
    // Something to decide (a proposal, a pending result, the declaration) lifts the card over the dimmed chat on a phone.
    root.classList.toggle('mc-card-modal', !!view.proposal || !!view.pendingManual || showForm);
    restoreDrafts(root, state.values);
    for (const control of root.querySelectorAll('[data-harm-overflow]'))
        control.dispatchEvent(new Event('mc-restored'));
    root.querySelector('form.mc-action-declaration')?.dispatchEvent(new Event('mc-restored'));
}
