import { element, button, select, input, checkbox, form, details } from "./card-controls.js";
import { HARM_MARKS, HARM_OVERFLOW, harmTargets, bindHarmOverflow } from "./declaration-form.js";
/** A pending result: what it cost (when no stakes were agreed), the Twist as choices, then manual handling and System Rescue. */
export function renderPendingStakes(view, entry, card) {
    const section = element('section');
    section.className = 'mc-pending-stakes';
    const hint = element('p', 'This roll is binding. Record what follows from it; nothing here rewrites the dice.');
    hint.className = 'mc-hint';
    section.append(hint);
    section.append(renderStakesForm(view, entry, card));
    const fallback = details('mc-stakes-fallback', 'Handled manually or System Rescue', 'stakes:fallback');
    fallback.append(renderManualForm(view, entry, card));
    if (view.sheet.rescues.remaining > 0)
        fallback.append(renderRescueForm(view, entry, card));
    section.append(fallback);
    return section;
}
function renderStakesForm(view, entry, card) {
    const stakesForm = form('mc-stakes-adjudication');
    const receipt = entry.receipt;
    const twisted = receipt.result.twist;
    // Accepted stakes already settled the harm in code; only an unstaked Conflict or Disaster asks what it cost.
    const needsHarm = receipt.command.action.stakes === undefined && receipt.result.outcome !== 'Triumph';
    let stakesNote, harmMarks, harmTarget;
    let harmOverflow, injuryName;
    if (needsHarm || !twisted) {
        const cost = element('div');
        cost.className = 'mc-stakes-cost';
        cost.append(element('h4', 'What did it cost?'));
        stakesNote = input(cost, 'Stakes adjudication note', true, 'stakes:note');
        harmMarks = select(cost, 'Harm marks', HARM_MARKS, 'stakes:marks');
        harmTarget = select(cost, 'Harm target', harmTargets(view), 'stakes:target');
        harmOverflow = select(cost, 'Harm overflow choice', HARM_OVERFLOW, 'stakes:overflow');
        bindHarmOverflow(harmTarget, harmOverflow);
        injuryName = input(cost, 'Injury name (if injury created)', false, 'stakes:injury');
        stakesForm.append(cost);
    }
    const harm = () => {
        const marks = Number(harmMarks?.value ?? 0);
        return marks > 0 ? {
            kind: 'apply-harm', marks,
            targetAspectId: harmTarget.value || null,
            overflowChoice: harmOverflow.value,
            injuryId: `injury-${entry.operationId}`,
            injuryName: injuryName.value.trim() || 'Stakes injury',
            injuryEffect: stakesNote.value.trim(),
        } : undefined;
    };
    const buttons = [];
    const submit = async (control, twist, twistText) => {
        if (!stakesForm.reportValidity())
            return;
        const note = stakesNote?.value.trim() || twistText;
        if (!note) {
            card.report('Say what the Twist adds first.');
            return;
        }
        buttons.forEach(other => { other.disabled = true; });
        try {
            const harmCommand = harm();
            await card.controller.adjudicateStakes(await card.capture(view.context), {
                targetOperationId: entry.operationId, note,
                ...(harmCommand ? { harm: harmCommand } : {}),
                ...(twist ? { twist } : {}),
            });
        }
        catch (error) {
            card.report(String(error));
            buttons.forEach(other => { other.disabled = !card.ready(); });
        }
        void control;
    };
    const action = (parent, label, run, className = 'menu_button') => {
        const control = button(label, className);
        control.disabled = !card.ready();
        control.onclick = () => run(control);
        buttons.push(control);
        parent.append(control);
        return control;
    };
    if (!twisted) {
        const actions = element('div');
        actions.className = 'mc-actions';
        action(actions, 'Record consequences', control => submit(control, undefined, ''), 'menu_button mc-primary');
        stakesForm.append(actions);
        return stakesForm;
    }
    const box = element('div');
    box.className = 'mc-twist-box';
    box.append(element('h4', 'Your Twist'));
    const hint = element('p', 'A Twist adds something unexpected. It never changes the result.');
    hint.className = 'mc-hint';
    box.append(hint);
    const twistNote = input(box, 'What does the Twist add?', false, 'stakes:twistNote');
    twistNote.classList.add('mc-prose-input');
    const text = () => twistNote.value.trim();
    const needText = (run) => async (control) => {
        if (!text()) {
            twistNote.focus();
            card.report('Say what the Twist adds first.');
            return;
        }
        await submit(control, run(text()), text());
    };
    const choices = element('div');
    choices.className = 'mc-twist-choices';
    action(choices, 'Use as a note', needText(value => ({ kind: 'note', text: value })), 'menu_button mc-twist-primary');
    action(choices, 'Bank it', control => submit(control, { kind: 'bank', twistId: `twist-${entry.operationId}`, description: text() || 'Banked Twist' }, 'Twist banked for later in this scene.'));
    action(choices, 'Critical · impact up one step', control => submit(control, { kind: 'critical', elevatedImpact: 'High' }, text() || 'Critical: impact up one step.'));
    box.append(choices);
    const more = details('mc-twist-more', 'More Twist choices', 'stakes:twistMore');
    action(more, 'Counter-impact on the opposition', needText(value => ({ kind: 'counter', targetName: value, marks: 1 })));
    if (view.campaignDetails.mysteries.length) {
        const mystery = select(more, 'Mystery for Twist discovery', view.campaignDetails.mysteries.map(m => [m.id, m.question]), 'stakes:mystery');
        action(more, 'Record as a small discovery', needText(value => ({ kind: 'mystery-discovery', mysteryId: mystery.value,
            discoveryId: `disc-${entry.operationId}`, name: value })));
    }
    box.append(more);
    stakesForm.append(box);
    return stakesForm;
}
function renderManualForm(view, entry, card) {
    const manual = form('mc-manual-handling');
    manual.append(element('p', 'For abilities the structured controls cannot express: record how you handled the consequences. This applies no sheet changes and establishes no Twist as fact.'));
    const note = input(manual, 'Manual handling note', true, 'manual:note');
    const accept = button('Handled manually');
    accept.disabled = !card.ready();
    manual.append(accept);
    accept.onclick = async () => {
        if (!manual.reportValidity())
            return;
        accept.disabled = true;
        try {
            await card.controller.acknowledgeManual(await card.capture(view.context), entry.operationId, note.value);
        }
        catch (error) {
            card.report(String(error));
            accept.disabled = !card.ready();
        }
    };
    return manual;
}
function renderRescueForm(view, entry, card) {
    const rescueForm = form('mc-system-rescue');
    rescueForm.append(element('h4', `System Rescue (${view.sheet.rescues.remaining} remaining)`));
    const catastrophe = input(rescueForm, 'Catastrophe averted', true, 'rescue:catastrophe');
    const price = input(rescueForm, 'Story price', true, 'rescue:price');
    const markExposure = checkbox(rescueForm, 'Mark Exposure from rescue', 'rescue:exposure');
    const rescueBtn = button('Spend System Rescue');
    rescueBtn.disabled = !card.ready();
    rescueForm.append(rescueBtn);
    rescueBtn.onclick = async () => {
        if (!rescueForm.reportValidity())
            return;
        rescueBtn.disabled = true;
        try {
            await card.controller.spendRescue(await card.capture(view.context), {
                targetOperationId: entry.operationId,
                catastropheAverted: catastrophe.value.trim(),
                storyPrice: price.value.trim(),
                markExposure: markExposure.checked,
            });
        }
        catch (error) {
            card.report(String(error));
            rescueBtn.disabled = !card.ready();
        }
    };
    return rescueForm;
}
/** Unspent Twists banked this scene, each with its own spend control. */
export function renderBankedTwists(view, card) {
    const activeTwists = view.bankedTwists.filter(twist => !twist.spent && twist.sceneId === view.play.scene.id);
    if (activeTwists.length === 0)
        return null;
    const twistBox = document.createElement('div');
    twistBox.className = 'mc-banked-twists';
    twistBox.append(element('h4', 'Banked Twists (current scene)'));
    for (const twist of activeTwists) {
        const twistForm = form('mc-banked-twist');
        twistForm.append(element('p', `Banked Twist: ${twist.description}`));
        const effectInput = input(twistForm, 'How is the banked Twist spent?', true, `twist:${twist.id}`);
        const spendBtn = button('Spend banked Twist');
        spendBtn.disabled = !card.ready();
        twistForm.append(spendBtn);
        spendBtn.onclick = async () => {
            if (!twistForm.reportValidity())
                return;
            spendBtn.disabled = true;
            try {
                await card.controller.spendBankedTwist(await card.capture(view.context), { twistId: twist.id, note: effectInput.value.trim() });
            }
            catch (error) {
                card.report(String(error));
                spendBtn.disabled = !card.ready();
            }
        };
        twistBox.append(twistForm);
    }
    return twistBox;
}
