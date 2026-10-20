import { element, button, select, input, checkbox, form, details } from "./card-controls.js";
import { HARM_MARKS, HARM_OVERFLOW, harmTargets } from "./declaration-form.js";
/** A pending manual result: structured Stakes & Twist controls first, free-text handling and System Rescue as fallbacks. */
export function renderPendingStakes(view, entry, card) {
    const section = element('section');
    section.className = 'mc-pending-stakes';
    section.append(element('p', 'This roll is binding. Record its consequences here: harm, a banked or immediate Twist, or both. Nothing below rewrites the dice.'));
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
    stakesForm.append(element('h4', 'Stakes & Twist'));
    const stakesNote = input(stakesForm, 'Stakes adjudication note', true, 'stakes:note');
    const harmMarks = select(stakesForm, 'Harm marks', HARM_MARKS, 'stakes:marks');
    const harmTarget = select(stakesForm, 'Harm target', harmTargets(view), 'stakes:target');
    const harmOverflow = select(stakesForm, 'Harm overflow choice', HARM_OVERFLOW, 'stakes:overflow');
    const injuryName = input(stakesForm, 'Injury name (if injury created)', false, 'stakes:injury');
    const twistChoice = select(stakesForm, 'Twist adjudication', [
        ['', 'None'], ['note', 'Immediate narrative note'], ['bank', 'Bank Twist for this scene'],
        ['critical', 'Critical upgrade (+1 impact)'], ['counter', 'Immediate counter-impact'],
        ['mystery-discovery', 'Small Mystery discovery'],
    ], 'stakes:twist');
    const twistNote = input(stakesForm, 'Twist description or note', false, 'stakes:twistNote');
    const twistMystery = select(stakesForm, 'Mystery for Twist discovery', view.campaignDetails.mysteries.map(m => [m.id, m.question]), 'stakes:mystery');
    const adjudicateBtn = button('Adjudicate stakes');
    adjudicateBtn.disabled = !card.ready();
    stakesForm.append(adjudicateBtn);
    adjudicateBtn.onclick = async () => {
        if (!stakesForm.reportValidity())
            return;
        adjudicateBtn.disabled = true;
        const marks = Number(harmMarks.value);
        const harm = marks > 0 ? {
            kind: 'apply-harm',
            marks,
            targetAspectId: harmTarget.value || null,
            overflowChoice: harmOverflow.value,
            injuryId: `injury-${entry.operationId}`,
            injuryName: injuryName.value.trim() || 'Stakes injury',
            injuryEffect: stakesNote.value.trim(),
        } : undefined;
        const text = twistNote.value.trim() || stakesNote.value.trim();
        let twist;
        if (twistChoice.value === 'note')
            twist = { kind: 'note', text };
        else if (twistChoice.value === 'bank')
            twist = { kind: 'bank', twistId: `twist-${entry.operationId}`, description: text };
        else if (twistChoice.value === 'critical')
            twist = { kind: 'critical', elevatedImpact: 'High' };
        else if (twistChoice.value === 'counter')
            twist = { kind: 'counter', targetName: text, marks: 1 };
        else if (twistChoice.value === 'mystery-discovery') {
            twist = { kind: 'mystery-discovery', mysteryId: twistMystery.value, discoveryId: `disc-${entry.operationId}`, name: text };
        }
        try {
            await card.controller.adjudicateStakes(await card.capture(view.context), {
                targetOperationId: entry.operationId,
                note: stakesNote.value.trim(),
                ...(harm ? { harm } : {}),
                ...(twist ? { twist } : {}),
            });
        }
        catch (error) {
            card.report(String(error));
            adjudicateBtn.disabled = !card.ready();
        }
    };
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
