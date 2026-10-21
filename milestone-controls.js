import { ELEMENTS } from "./game/minor-character/state.js";
import { BranchRegistry, restoreCheckpoint, } from "./game/minor-character/checkpoints.js";
const el = (tag, textContent = '') => {
    const node = document.createElement(tag);
    node.textContent = textContent;
    return node;
};
const btn = (label) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'menu_button';
    node.textContent = label;
    return node;
};
function select(form, label, values) {
    const wrapper = el('label', label);
    const control = document.createElement('select');
    values.forEach(([value, text]) => control.add(new Option(text, value)));
    wrapper.append(control);
    form.append(wrapper);
    return control;
}
function input(form, label, required = false, defaultValue = '') {
    const wrapper = el('label', label);
    const control = document.createElement('input');
    control.className = 'text_pole';
    control.required = required;
    if (defaultValue)
        control.value = defaultValue;
    wrapper.append(control);
    form.append(wrapper);
    return control;
}
function textarea(form, label, required = false) {
    const wrapper = el('label', label);
    const control = document.createElement('textarea');
    control.className = 'text_pole';
    control.required = required;
    wrapper.append(control);
    form.append(wrapper);
    return control;
}
function checkbox(form, label) {
    const wrapper = el('label', label);
    wrapper.className = 'mc-checkbox';
    const control = document.createElement('input');
    control.type = 'checkbox';
    wrapper.prepend(control);
    form.append(wrapper);
    return control;
}
const slug = (value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
export function renderMilestoneControls(root, controller, capture, ready, checkpointTools, only) {
    const view = controller.playerView;
    if (!view)
        return;
    // Campaign tools open one group at a time: the chosen group renders open, without its disclosure line.
    const place = (group, name) => {
        if (only && only !== name)
            return;
        if (only) {
            group.open = true;
            group.classList.add('mc-milestone-solo');
        }
        root.append(group);
    };
    const status = el('p', '');
    status.setAttribute('role', 'status');
    async function runOp(buttonEl, action) {
        buttonEl.disabled = true;
        const expected = { ...view.context };
        try {
            await action(await capture(expected));
        }
        catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
            buttonEl.disabled = !ready();
        }
    }
    // 1. Origin Growth (Witness & Learn, Card Arrangement, Awakening)
    const originDetails = document.createElement('details');
    originDetails.className = 'mc-milestone-origin';
    originDetails.append(el('summary', 'Origin Growth (Witness & Learn, Card Arrangement, Awakening)'));
    const witnessForm = document.createElement('form');
    witnessForm.append(el('h4', 'Witness & Learn'));
    const cardName = input(witnessForm, 'New Class Card name');
    const cardTier = select(witnessForm, 'New Class Card tier', [
        ['base', 'Base Class (+1)'],
        ['advanced', 'Advanced Class (+1 / +1)'],
        ['master', 'Master Class (+2 / +1)'],
        ['rare', 'Rare Class (+2 / +1)'],
    ]);
    const skillOptions = view.character.skills
        .filter(s => s.category === 'skill')
        .map(s => [s.id, s.name]);
    const primarySkill = select(witnessForm, 'Primary competence skill', skillOptions);
    const secondarySkill = select(witnessForm, 'Secondary competence skill (optional)', [['', 'None'], ...skillOptions]);
    const aspectName = input(witnessForm, 'Learned Aspect name');
    const aspectType = select(witnessForm, 'Learned Aspect type', [
        ['trait', 'Trait'],
        ['gear', 'Gear'],
        ['companion', 'Companion'],
    ]);
    const aspectBoxes = select(witnessForm, 'Learned Aspect boxes', [
        ['2', '2 boxes'],
        ['3', '3 boxes'],
        ['4', '4 boxes'],
        ['5', '5 boxes'],
        ['6', '6 boxes'],
    ]);
    const aspectRule = input(witnessForm, 'Learned Aspect rule');
    const witnessBtn = btn('Record Witness & Learn');
    witnessBtn.disabled = !ready();
    witnessForm.append(witnessBtn);
    witnessForm.onsubmit = event => event.preventDefault();
    witnessBtn.onclick = () => {
        const newCardName = cardName.value.trim();
        const newAspectName = aspectName.value.trim();
        const tier = cardTier.value;
        const skillIds = [];
        if (primarySkill.value)
            skillIds.push(primarySkill.value);
        if (tier !== 'base') {
            const second = secondarySkill.value && secondarySkill.value !== primarySkill.value
                ? secondarySkill.value
                : skillOptions.find(([id]) => id !== primarySkill.value)?.[0];
            if (second)
                skillIds.push(second);
        }
        return runOp(witnessBtn, context => controller.witnessAndLearn(context, {
            ...(newCardName ? {
                newClass: {
                    id: `card-${slug(newCardName)}`,
                    name: newCardName,
                    tier,
                    skillIds,
                },
            } : {}),
            ...(newAspectName ? {
                aspect: {
                    id: `aspect-${slug(newAspectName)}`,
                    definitionId: `def-${slug(newAspectName)}`,
                    name: newAspectName,
                    type: aspectType.value,
                    boxes: Number(aspectBoxes.value),
                    rule: aspectRule.value.trim() || newAspectName,
                    full: 'Exhausted or damaged until recovered.',
                    classId: null,
                },
            } : {}),
        }));
    };
    originDetails.append(witnessForm);
    const arrangeForm = document.createElement('form');
    arrangeForm.append(el('h4', 'Arrange Class Cards'));
    const personalIds = new Set(['core', 'system', 'cub', 'marginalia']);
    const movableAspects = [
        ...view.sheet.aspects.filter(a => !personalIds.has(a.id)),
        ...view.sheet.archive,
    ].map(a => [a.id, `${a.name} (${a.type})`]);
    const aspectToMove = select(arrangeForm, 'Aspect to move', movableAspects.length ? movableAspects : [['', 'None']]);
    const destinationLoc = select(arrangeForm, 'Destination location', [
        ['card', 'Equip on Class Card'],
        ['archive', 'Move to Archive'],
    ]);
    const targetCard = select(arrangeForm, 'Target Class Card', view.play.cards.map(c => [c.id, c.name]));
    const arrangeBtn = btn('Arrange Class Cards');
    arrangeBtn.disabled = !ready() || movableAspects.length === 0;
    arrangeForm.append(arrangeBtn);
    arrangeForm.onsubmit = event => event.preventDefault();
    arrangeBtn.onclick = () => {
        const loc = destinationLoc.value;
        return runOp(arrangeBtn, context => controller.arrangeCards(context, {
            placements: [{
                    aspectId: aspectToMove.value,
                    location: loc,
                    classId: loc === 'card' ? targetCard.value : null,
                }],
        }));
    };
    originDetails.append(arrangeForm);
    if (view.coreDevelopments?.awakening && !view.coreDevelopments.awakeningUsedThisArc) {
        const awakeningBtn = btn('Activate Origin Awakening');
        awakeningBtn.disabled = !ready();
        awakeningBtn.onclick = () => runOp(awakeningBtn, context => controller.activateAwakening(context));
        originDetails.append(el('p', 'Origin Awakening available once this arc.'), awakeningBtn);
    }
    place(originDetails, 'origin');
    // 2. Exposure, Canon & Mysteries
    const worldDetails = document.createElement('details');
    worldDetails.className = 'mc-milestone-world';
    worldDetails.append(el('summary', 'Exposure, Canon & Mysteries'));
    const exposureForm = document.createElement('form');
    exposureForm.append(el('h4', 'Record Exposure'));
    const expWitness = input(exposureForm, 'Exposure witness', true);
    const expDesc = input(exposureForm, 'Exposure description', true);
    const expCub = checkbox(exposureForm, 'Absorb with The Cub');
    const expFact = input(exposureForm, 'Learned fact (required at 6 Exposure)');
    const expBtn = btn('Record Exposure');
    expBtn.disabled = !ready();
    exposureForm.append(expBtn);
    exposureForm.onsubmit = event => event.preventDefault();
    expBtn.onclick = () => {
        if (!exposureForm.reportValidity())
            return Promise.resolve();
        return runOp(expBtn, context => controller.recordExposure(context, {
            incidentId: `exp-${context.operationId}`,
            witness: expWitness.value.trim(),
            description: expDesc.value.trim(),
            absorbWithCub: expCub.checked,
            ...(expFact.value.trim() ? { learnedFact: expFact.value.trim() } : {}),
        }));
    };
    worldDetails.append(exposureForm);
    const clearExpForm = document.createElement('form');
    clearExpForm.append(el('h4', 'Clear Exposure with Rumor'));
    const resourceOptions = view.character.resources.map(r => [r.id, `${r.name} (${r.kind})`]);
    const coverResource = select(clearExpForm, 'Cover resource', resourceOptions.length ? resourceOptions : [['', 'None']]);
    const coverStory = input(clearExpForm, 'Cover story', true);
    const clearExpBtn = btn('Clear Exposure with Rumor');
    clearExpBtn.disabled = !ready();
    clearExpForm.append(clearExpBtn);
    clearExpForm.onsubmit = event => event.preventDefault();
    clearExpBtn.onclick = () => {
        if (!clearExpForm.reportValidity())
            return Promise.resolve();
        return runOp(clearExpBtn, context => controller.clearExposure(context, {
            resourceId: coverResource.value,
            story: coverStory.value.trim(),
        }));
    };
    worldDetails.append(clearExpForm);
    const canonForm = document.createElement('form');
    canonForm.append(el('h4', 'Recall the Draft & Canon / Divergence'));
    const draftQuestion = input(canonForm, 'Recall the Draft question', true);
    const knifeOptions = view.campaignDetails.knives.map(k => [k.id, `${k.name} (${k.status})`]);
    const draftKnife = select(canonForm, 'Attach knife / complication (optional)', [['', 'None'], ...knifeOptions]);
    const recallBtn = btn('Recall the Draft');
    recallBtn.disabled = !ready();
    const confirmKnife = select(canonForm, 'Knife for Canon Beat', knifeOptions.length ? knifeOptions : [['', 'None']]);
    const confirmCanonBtn = btn('Confirm Canon Beat');
    confirmCanonBtn.disabled = !ready();
    canonForm.append(recallBtn, confirmCanonBtn);
    canonForm.onsubmit = event => event.preventDefault();
    recallBtn.onclick = () => {
        if (!canonForm.reportValidity())
            return Promise.resolve();
        return runOp(recallBtn, context => controller.recallTheDraft(context, {
            question: draftQuestion.value.trim(),
            ...(draftKnife.value ? { knifeId: draftKnife.value } : {}),
        }));
    };
    confirmCanonBtn.onclick = () => {
        const targetKnifeId = confirmKnife.value || view.campaignDetails.knives[0]?.id || '';
        return runOp(confirmCanonBtn, context => controller.confirmCanonBeat(context, {
            knifeId: targetKnifeId,
            status: 'resolved',
            clearCanonMark: true,
        }));
    };
    worldDetails.append(canonForm);
    const divForm = document.createElement('form');
    const divSeverity = select(divForm, 'Divergence severity', [
        ['1', 'Minor deviation · 1 box'],
        ['2', 'Major derailment · 2 boxes'],
    ]);
    const divReason = input(divForm, 'Divergence reason', true);
    const divBtn = btn('Mark Divergence');
    divBtn.disabled = !ready();
    divForm.append(divBtn);
    divForm.onsubmit = event => event.preventDefault();
    divBtn.onclick = () => {
        if (!divForm.reportValidity())
            return Promise.resolve();
        return runOp(divBtn, context => controller.markDivergence(context, {
            severity: Number(divSeverity.value),
            reason: divReason.value.trim(),
        }));
    };
    worldDetails.append(divForm);
    const mysteryForm = document.createElement('form');
    mysteryForm.append(el('h4', 'Mysteries & Grand Discovery'));
    const mysteryOptions = view.campaignDetails.mysteries.map(m => [m.id, `${m.question} (${m.discoveries.length}/3)`]);
    const mysterySelect = select(mysteryForm, 'Mystery for discovery', mysteryOptions.length ? mysteryOptions : [['', 'None']]);
    const discoverySummary = input(mysteryForm, 'Small discovery summary', true);
    const discoveryBtn = btn('Record Small Mystery Discovery');
    discoveryBtn.disabled = !ready();
    mysteryForm.append(discoveryBtn);
    mysteryForm.onsubmit = event => event.preventDefault();
    discoveryBtn.onclick = () => {
        if (!mysteryForm.reportValidity())
            return Promise.resolve();
        const summary = discoverySummary.value.trim();
        return runOp(discoveryBtn, context => controller.recordMysteryDiscovery(context, {
            mysteryId: mysterySelect.value,
            discoveryId: `disc-${context.operationId}`,
            name: summary,
        }));
    };
    worldDetails.append(mysteryForm);
    const grandForm = document.createElement('form');
    const grandMystery = select(grandForm, 'Mystery for Grand Discovery', mysteryOptions.length ? mysteryOptions : [['', 'None']]);
    const grandTruth = input(grandForm, 'Grand Discovery truth', true);
    const grandBtn = btn('Accept Grand Discovery Truth');
    grandBtn.disabled = !ready();
    grandForm.append(grandBtn);
    grandForm.onsubmit = event => event.preventDefault();
    grandBtn.onclick = () => {
        if (!grandForm.reportValidity())
            return Promise.resolve();
        return runOp(grandBtn, context => controller.acceptGrandDiscovery(context, {
            mysteryId: grandMystery.value,
            truth: grandTruth.value.trim(),
        }));
    };
    worldDetails.append(grandForm);
    place(worldDetails, 'world');
    // 3. Downtime, Drives, Milestones, Projects & Breakthrough
    const downtimeDetails = document.createElement('details');
    downtimeDetails.className = 'mc-milestone-downtime';
    downtimeDetails.append(el('summary', 'Downtime, Drives, Milestones, Projects & Breakthrough'));
    const recoverForm = document.createElement('form');
    recoverForm.append(el('h4', 'Recover with Resource'));
    const recResource = select(recoverForm, 'Recovery resource', resourceOptions.length ? resourceOptions : [['', 'None']]);
    const recTargetKind = select(recoverForm, 'Recovery target kind', [
        ['aspect', 'Aspect (clear 2 marks)'],
        ['injury', 'Injury (clear 2 marks)'],
        ['mire', 'Mire (clear 2 marks)'],
    ]);
    const recTargetId = input(recoverForm, 'Recovery target ID', true, 'core');
    const recBtn = btn('Recover with Resource');
    recBtn.disabled = !ready();
    recoverForm.append(recBtn);
    recoverForm.onsubmit = event => event.preventDefault();
    recBtn.onclick = () => {
        if (!recoverForm.reportValidity())
            return Promise.resolve();
        return runOp(recBtn, context => controller.recoverWithResource(context, {
            resourceId: recResource.value,
            targetKind: recTargetKind.value,
            targetId: recTargetId.value.trim(),
        }));
    };
    downtimeDetails.append(recoverForm);
    const benefitForm = document.createElement('form');
    benefitForm.append(el('h4', 'Create 2-box Benefit'));
    const benRes1 = select(benefitForm, 'First resource for Benefit', resourceOptions.length ? resourceOptions : [['', 'None']]);
    const benRes2 = select(benefitForm, 'Second resource for Benefit', resourceOptions.length ? resourceOptions : [['', 'None']]);
    const benName = input(benefitForm, 'Benefit name', true);
    const benRule = input(benefitForm, 'Benefit rule', true);
    const benBtn = btn('Create 2-box Benefit');
    benBtn.disabled = !ready();
    benefitForm.append(benBtn);
    benefitForm.onsubmit = event => event.preventDefault();
    benBtn.onclick = () => {
        if (!benefitForm.reportValidity())
            return Promise.resolve();
        return runOp(benBtn, context => controller.createBenefit(context, {
            resourceIds: [benRes1.value, benRes2.value],
            benefitId: `benefit-${slug(benName.value)}`,
            name: benName.value.trim(),
            effect: benRule.value.trim(),
        }));
    };
    downtimeDetails.append(benefitForm);
    const driveForm = document.createElement('form');
    driveForm.append(el('h4', 'Advance Drive'));
    const driveOptions = view.character.impulses
        .filter(i => i.type === 'text')
        .map(d => [d.id, d.name]);
    const driveSelect = select(driveForm, 'Drive to advance', driveOptions.length ? driveOptions : [['', 'None']]);
    const driveRewardKind = select(driveForm, 'Drive reward kind', [
        ['rumor', 'Gain a Rumor'],
        ['clear-mire', 'Clear 2 marks on a Mire'],
        ['minor-milestone', 'Record Minor Milestone'],
        ['major-milestone', 'Record Major Milestone & rewrite Drive'],
    ]);
    const driveRewardName = input(driveForm, 'Reward or milestone name', true);
    const mireOptions = view.sheet.mires.map(m => [m.id, m.name]);
    const driveMire = select(driveForm, 'Target Mire for Drive recovery', mireOptions.length ? mireOptions : [['', 'None']]);
    const driveRewrite = input(driveForm, 'Rewritten Drive text (for Major Milestone)');
    const driveBtn = btn('Advance Drive');
    driveBtn.disabled = !ready();
    driveForm.append(driveBtn);
    driveForm.onsubmit = event => event.preventDefault();
    driveBtn.onclick = () => {
        if (!driveForm.reportValidity())
            return Promise.resolve();
        const kind = driveRewardKind.value;
        const name = driveRewardName.value.trim();
        return runOp(driveBtn, context => {
            if (kind === 'rumor') {
                return controller.advanceDrive(context, {
                    driveId: driveSelect.value,
                    reward: {
                        kind: 'rumor',
                        resourceId: `rumor-${slug(name)}`,
                        name,
                        source: 'Drive advancement',
                    },
                });
            }
            if (kind === 'clear-mire') {
                return controller.advanceDrive(context, {
                    driveId: driveSelect.value,
                    reward: { kind: 'clear-mire', mireId: driveMire.value },
                });
            }
            if (kind === 'major-milestone') {
                return controller.advanceDrive(context, {
                    driveId: driveSelect.value,
                    reward: {
                        kind: 'major-milestone',
                        milestoneId: `milestone-${slug(name)}`,
                        name,
                        newDriveName: driveRewrite.value.trim() || name,
                    },
                });
            }
            return controller.advanceDrive(context, {
                driveId: driveSelect.value,
                reward: {
                    kind: 'minor-milestone',
                    milestoneId: `milestone-${slug(name)}`,
                    name,
                },
            });
        });
    };
    downtimeDetails.append(driveForm);
    const projectForm = document.createElement('form');
    projectForm.append(el('h4', 'Projects & Milestones'));
    const projName = input(projectForm, 'New Project name', true);
    const projBoxes = select(projectForm, 'New Project boxes', [
        ['3', '3 boxes (short)'],
        ['6', '6 boxes (major)'],
    ]);
    const projNotes = input(projectForm, 'New Project notes', true);
    const startProjBtn = btn('Start Project');
    startProjBtn.disabled = !ready();
    projectForm.append(startProjBtn);
    projectForm.onsubmit = event => event.preventDefault();
    startProjBtn.onclick = () => {
        if (!projectForm.reportValidity())
            return Promise.resolve();
        return runOp(startProjBtn, context => controller.startProject(context, {
            id: `project-${slug(projName.value)}`,
            name: projName.value.trim(),
            boxes: Number(projBoxes.value),
            rule: projNotes.value.trim(),
        }));
    };
    downtimeDetails.append(projectForm);
    const spendProjForm = document.createElement('form');
    const projectOptions = view.sheet.projects.map(p => [p.id, `${p.name} (${p.earned ? 'earned' : 'in progress'})`]);
    const milestoneOptions = view.character.advancement
        .filter((a) => a.type === 'milestone' && !a.spentOn)
        .map(a => [a.id, `${a.name} (${a.kind})`]);
    const targetProject = select(spendProjForm, 'Project to advance', projectOptions.length ? projectOptions : [['', 'None']]);
    const targetMilestone = select(spendProjForm, 'Milestone to spend', milestoneOptions.length ? milestoneOptions : [['', 'None']]);
    const spendMilestoneBtn = btn('Spend Milestone on Project');
    spendMilestoneBtn.disabled = !ready() || milestoneOptions.length === 0;
    const completeProjBtn = btn('Complete Earned Project');
    completeProjBtn.disabled = !ready() || projectOptions.length === 0;
    spendProjForm.append(spendMilestoneBtn, completeProjBtn);
    spendProjForm.onsubmit = event => event.preventDefault();
    spendMilestoneBtn.onclick = () => runOp(spendMilestoneBtn, context => controller.spendMilestones(context, {
        projectId: targetProject.value,
        milestoneIds: [targetMilestone.value],
    }));
    completeProjBtn.onclick = () => runOp(completeProjBtn, context => controller.completeProject(context, {
        projectId: targetProject.value,
        effect: { kind: 'add-aspect-box', aspectId: 'core' },
    }));
    downtimeDetails.append(spendProjForm);
    const breakForm = document.createElement('form');
    breakForm.append(el('h4', 'Breakthrough, Rank Trial & Displayed Rank'));
    const breakReason = input(breakForm, 'Breakthrough reason', true);
    const breakBtn = btn('Mark Breakthrough');
    breakBtn.disabled = !ready();
    breakForm.append(breakBtn);
    breakForm.onsubmit = event => event.preventDefault();
    breakBtn.onclick = () => {
        if (!breakForm.reportValidity())
            return Promise.resolve();
        return runOp(breakBtn, context => controller.markBreakthrough(context, {
            reason: breakReason.value.trim(),
        }));
    };
    downtimeDetails.append(breakForm);
    const trialForm = document.createElement('form');
    const trialNarrative = input(trialForm, 'Rank Trial narrative', true);
    const trialPassed = checkbox(trialForm, 'Rank Trial passed');
    trialPassed.checked = true;
    const trialBtn = btn('Resolve Rank Trial');
    trialBtn.disabled = !ready();
    trialForm.append(trialBtn);
    trialForm.onsubmit = event => event.preventDefault();
    trialBtn.onclick = () => {
        if (!trialForm.reportValidity())
            return Promise.resolve();
        return runOp(trialBtn, context => controller.resolveRankTrial(context, {
            passed: trialPassed.checked,
            note: trialNarrative.value.trim(),
        }));
    };
    downtimeDetails.append(trialForm);
    const rankForm = document.createElement('form');
    const displayedRankInput = input(rankForm, 'Displayed Rank reading', true);
    const displayedMethod = select(rankForm, 'Displayed Rank method', [
        ['assessment', 'Assessment plate'],
        ['evidence', 'Demonstrated evidence'],
        ['spoof', 'Spoofed or concealed'],
    ]);
    const displayedNote = input(rankForm, 'Displayed Rank note', true);
    const displayedBtn = btn('Update Displayed Rank');
    displayedBtn.disabled = !ready();
    rankForm.append(displayedBtn);
    rankForm.onsubmit = event => event.preventDefault();
    displayedBtn.onclick = () => {
        if (!rankForm.reportValidity())
            return Promise.resolve();
        return runOp(displayedBtn, context => controller.updateDisplayedRank(context, {
            displayedRank: displayedRankInput.value.trim(),
            method: displayedMethod.value,
            note: displayedNote.value.trim(),
        }));
    };
    downtimeDetails.append(rankForm);
    place(downtimeDetails, 'downtime');
    // 4. Encounters (Hazards & Mayfly Roll, Dungeon Runs, Tournaments) & Private Keeper Drawer
    const encounterDetails = document.createElement('details');
    encounterDetails.className = 'mc-milestone-encounters';
    encounterDetails.append(el('summary', 'Encounters (Hazards, Dungeon Runs, Tournaments) & Keeper Drawer'));
    const hazardForm = document.createElement('form');
    hazardForm.append(el('h4', 'Hazards & Mayfly Roll'));
    const hazardName = input(hazardForm, 'Hazard name', true);
    const hazardLimit = input(hazardForm, 'Hazard limit', true, '6');
    const elementOptions = [['', 'None'], ...ELEMENTS.map(e => [e, e])];
    const hazardVuln = select(hazardForm, 'Hazard vulnerable element', elementOptions);
    const hazardResist = select(hazardForm, 'Hazard resistant element', elementOptions);
    const startHazardBtn = btn('Start Hazard');
    startHazardBtn.disabled = !ready();
    hazardForm.append(startHazardBtn);
    hazardForm.onsubmit = event => event.preventDefault();
    startHazardBtn.onclick = () => {
        if (!hazardForm.reportValidity())
            return Promise.resolve();
        return runOp(startHazardBtn, context => controller.startHazard(context, {
            id: `hazard-${slug(hazardName.value)}`,
            name: hazardName.value.trim(),
            limit: Number(hazardLimit.value),
            weaknesses: hazardVuln.value ? [hazardVuln.value] : [],
            resistances: hazardResist.value ? [hazardResist.value] : [],
        }));
    };
    encounterDetails.append(hazardForm);
    if (view.encounters.hazards.length > 0) {
        const activeHazardForm = document.createElement('form');
        const hazardSelect = select(activeHazardForm, 'Active Hazard', view.encounters.hazards.map(h => [h.id, `${h.name} (${h.marks}/${h.limit})`]));
        const hazardBaseMarks = input(activeHazardForm, 'Hazard base marks', true, '1');
        const hazardElem = select(activeHazardForm, 'Hazard element used', elementOptions);
        const markHazardBtn = btn('Mark Hazard');
        markHazardBtn.disabled = !ready();
        const mayflyPool = select(activeHazardForm, 'Mayfly dice pool', [
            ['2', '2d6 (standard)'],
            ['1', '1d6 (single)'],
            ['3', '3d6 (assisted)'],
        ]);
        const mayflyCut = select(activeHazardForm, 'Mayfly Cut', [
            ['0', 'Cut 0'],
            ['1', 'Cut 1'],
            ['2', 'Cut 2'],
        ]);
        const rollMayflyBtn = btn('Roll Mayfly');
        rollMayflyBtn.disabled = !ready();
        activeHazardForm.append(markHazardBtn, rollMayflyBtn);
        activeHazardForm.onsubmit = event => event.preventDefault();
        markHazardBtn.onclick = () => runOp(markHazardBtn, context => controller.markHazard(context, {
            hazardId: hazardSelect.value,
            baseMarks: Number(hazardBaseMarks.value),
            element: (hazardElem.value || null),
        }));
        rollMayflyBtn.onclick = () => runOp(rollMayflyBtn, context => controller.rollMayfly(context, {
            hazardId: hazardSelect.value,
            diceCount: Number(mayflyPool.value),
            cut: Number(mayflyCut.value),
        }));
        encounterDetails.append(activeHazardForm);
    }
    const dungeonForm = document.createElement('form');
    dungeonForm.append(el('h4', 'Dungeon Runs'));
    const dungeonName = input(dungeonForm, 'Dungeon run name', true);
    const rankOptions = [['F', 'F'], ['E', 'E'], ['D', 'D'], ['C', 'C'], ['B', 'B'], ['A', 'A'], ['S', 'S']];
    const dungeonGrade = select(dungeonForm, 'Dungeon grade', rankOptions);
    const dungeonObj = input(dungeonForm, 'Dungeon objective', true);
    const dungeonLaw = input(dungeonForm, 'Dungeon law', true);
    const dungeonBoxes = select(dungeonForm, 'Dungeon progress boxes', [
        ['3', '3 boxes (short)'],
        ['4', '4 boxes (standard)'],
        ['6', '6 boxes (deep)'],
    ]);
    const startDungeonBtn = btn('Start Dungeon Run');
    startDungeonBtn.disabled = !ready();
    dungeonForm.append(startDungeonBtn);
    dungeonForm.onsubmit = event => event.preventDefault();
    startDungeonBtn.onclick = () => {
        if (!dungeonForm.reportValidity())
            return Promise.resolve();
        return runOp(startDungeonBtn, context => controller.startDungeonRun(context, {
            id: `dungeon-${slug(dungeonName.value)}`,
            name: dungeonName.value.trim(),
            grade: dungeonGrade.value,
            objective: dungeonObj.value.trim(),
            law: dungeonLaw.value.trim(),
            progressBoxes: Number(dungeonBoxes.value),
        }));
    };
    encounterDetails.append(dungeonForm);
    if (view.encounters.dungeonRuns.length > 0) {
        const activeDungeonForm = document.createElement('form');
        const dungeonSelect = select(activeDungeonForm, 'Active Dungeon Run', view.encounters.dungeonRuns.map(r => [r.id, `${r.name} (${r.status})`]));
        const legApproach = select(activeDungeonForm, 'Leg approach', [
            ['careful', 'Careful (+1 progress)'],
            ['swift', 'Swift (+2 progress, +1 Rift Pressure)'],
            ['camp', 'Camp (0 progress, uses 1 Supply if tracked)'],
        ]);
        const legNote = input(activeDungeonForm, 'Leg note', true, 'Advanced through the leg');
        const resolveLegBtn = btn('Resolve Leg');
        resolveLegBtn.disabled = !ready();
        const markPressureBtn = btn('Mark Rift Pressure');
        markPressureBtn.disabled = !ready();
        activeDungeonForm.append(resolveLegBtn, markPressureBtn);
        activeDungeonForm.onsubmit = event => event.preventDefault();
        resolveLegBtn.onclick = () => runOp(resolveLegBtn, context => controller.resolveDungeonLeg(context, {
            runId: dungeonSelect.value,
            pace: legApproach.value,
            note: legNote.value.trim(),
        }));
        markPressureBtn.onclick = () => runOp(markPressureBtn, context => controller.markRiftPressure(context, {
            runId: dungeonSelect.value,
            marks: 1,
        }));
        encounterDetails.append(activeDungeonForm);
    }
    const tournamentForm = document.createElement('form');
    tournamentForm.append(el('h4', 'Tournaments'));
    const tournName = input(tournamentForm, 'Tournament name', true);
    const tournEntrants = input(tournamentForm, 'Tournament entrants (comma-separated)', true, 'Sera Brooke, Rival Duelist, Contender A, Contender B, Contender C, Contender D, Contender E, Contender F');
    const startTournBtn = btn('Start Tournament');
    startTournBtn.disabled = !ready();
    tournamentForm.append(startTournBtn);
    tournamentForm.onsubmit = event => event.preventDefault();
    startTournBtn.onclick = () => {
        if (!tournamentForm.reportValidity())
            return Promise.resolve();
        return runOp(startTournBtn, context => controller.startTournament(context, {
            id: `tournament-${slug(tournName.value)}`,
            name: tournName.value.trim(),
            terms: {
                victoryCondition: 'Ring-out or yield',
                arenaLimits: 'Marked ward circle',
                surrenderSignal: 'Raised hand',
                injuryStakes: 'Non-lethal exhibition',
            },
            entrants: tournEntrants.value.split(',').map(s => s.trim()).filter(Boolean),
        }));
    };
    encounterDetails.append(tournamentForm);
    if (view.encounters.tournaments.length > 0) {
        const activeTournForm = document.createElement('form');
        const tournSelect = select(activeTournForm, 'Active Tournament', view.encounters.tournaments.map(t => [t.id, `${t.name} (${t.status})`]));
        const boutMode = select(activeTournForm, 'Bout resolution mode', [
            ['victory', 'Victory'],
            ['yield', 'Dramatic Yield (gain Drive reward)'],
            ['offscreen', 'Summarize Off-screen'],
        ]);
        const boutWinner = input(activeTournForm, 'Bout winner', true, 'Sera Brooke');
        const boutNote = input(activeTournForm, 'Bout note', true);
        const resolveBoutBtn = btn('Resolve Bout');
        resolveBoutBtn.disabled = !ready();
        activeTournForm.append(resolveBoutBtn);
        activeTournForm.onsubmit = event => event.preventDefault();
        resolveBoutBtn.onclick = () => {
            if (!activeTournForm.reportValidity())
                return Promise.resolve();
            const mode = boutMode.value;
            const note = boutNote.value.trim();
            const activeTourn = view.encounters.tournaments.find(t => t.id === tournSelect.value)
                ?? view.encounters.tournaments[0];
            const pendingBout = activeTourn?.bouts.find(b => b.winner === null) ?? activeTourn?.bouts[0];
            const defaultDrive = view.character.impulses.find(i => i.type === 'text');
            return runOp(resolveBoutBtn, context => controller.resolveTournamentBout(context, {
                tournamentId: tournSelect.value,
                boutId: pendingBout?.id ?? 'r1-b1',
                method: mode,
                winner: boutWinner.value.trim(),
                note,
                ...(mode === 'yield' && defaultDrive ? {
                    yieldDriveReward: {
                        driveId: defaultDrive.id,
                        kind: 'rumor',
                        resourceId: `rumor-${slug(note)}`,
                        resourceName: `Yield rumor: ${note}`,
                    },
                } : {}),
            }));
        };
        encounterDetails.append(activeTournForm);
    }
    // Private Keeper Drawer: only renders keeperView when opened!
    const keeperDrawer = document.createElement('details');
    keeperDrawer.setAttribute('data-keeper-drawer', 'true');
    keeperDrawer.append(el('summary', 'Keeper preparation (private)'));
    const keeperBody = document.createElement('div');
    keeperDrawer.append(keeperBody);
    const renderKeeperBody = () => {
        keeperBody.replaceChildren();
        if (!keeperDrawer.open)
            return;
        const keeper = controller.keeperView;
        if (!keeper)
            return;
        for (const secret of keeper) {
            const item = document.createElement('div');
            item.append(el('h5', secret.title), el('p', secret.secret), el('p', `Clues: ${secret.clues.map(c => `${c.text} (${c.revealed ? 'revealed' : 'unrevealed'})`).join('; ')}`));
            if (secret.status !== 'revealed') {
                const revealBtn = btn(`Reveal ${secret.title}`);
                revealBtn.disabled = !ready();
                revealBtn.onclick = () => runOp(revealBtn, context => controller.revealKeeperSecret(context, {
                    secretId: secret.id,
                    revealAll: true,
                }));
                item.append(revealBtn);
            }
            keeperBody.append(item);
        }
        const secretForm = document.createElement('form');
        secretForm.append(el('h5', 'Add Keeper Secret'));
        const secretTitle = input(secretForm, 'Keeper Secret title', true);
        const secretText = input(secretForm, 'Keeper Secret truth', true);
        const secretClue = input(secretForm, 'Initial clue text', true);
        const addSecretBtn = btn('Add Keeper Secret');
        addSecretBtn.disabled = !ready();
        secretForm.append(addSecretBtn);
        secretForm.onsubmit = event => event.preventDefault();
        addSecretBtn.onclick = () => {
            if (!secretForm.reportValidity())
                return Promise.resolve();
            return runOp(addSecretBtn, context => controller.addKeeperSecret(context, {
                id: `secret-${slug(secretTitle.value)}`,
                personId: null,
                title: secretTitle.value.trim(),
                secret: secretText.value.trim(),
                clues: [{ id: `clue-${slug(secretTitle.value)}-1`, text: secretClue.value.trim() }],
            }));
        };
        keeperBody.append(secretForm);
    };
    keeperDrawer.addEventListener('toggle', renderKeeperBody);
    encounterDetails.append(keeperDrawer);
    place(encounterDetails, 'encounters');
    // 5. Branches, Portable Checkpoints & GitHub Sync
    const checkpointDetails = document.createElement('details');
    checkpointDetails.className = 'mc-milestone-checkpoints';
    checkpointDetails.append(el('summary', 'Branches, Portable Checkpoints & GitHub Sync'));
    const cpForm = document.createElement('form');
    const exportBtn = btn('Export Portable Checkpoint JSON');
    const cpTextarea = textarea(cpForm, 'Portable Checkpoint JSON');
    const restoreBtn = btn('Restore Checkpoint JSON');
    cpForm.append(exportBtn, restoreBtn);
    cpForm.onsubmit = event => event.preventDefault();
    exportBtn.onclick = async () => {
        try {
            const checkpoint = await controller.exportCheckpoint();
            cpTextarea.value = JSON.stringify(checkpoint, null, 2);
        }
        catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
        }
    };
    restoreBtn.onclick = async () => {
        if (!checkpointTools)
            return;
        try {
            const parsed = JSON.parse(cpTextarea.value);
            await restoreCheckpoint(parsed, checkpointTools.store, checkpointTools.metadata, controller.state.binding);
            if (checkpointTools.onRestored)
                await checkpointTools.onRestored();
            else
                await controller.open(controller.state.binding);
        }
        catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
        }
    };
    checkpointDetails.append(cpForm);
    const branchForm = document.createElement('form');
    const newBranchInput = input(branchForm, 'New branch ID', true);
    const branchBtn = btn('Branch from Revision');
    branchForm.append(branchBtn);
    branchForm.onsubmit = event => event.preventDefault();
    branchBtn.onclick = async () => {
        if (!checkpointTools || !branchForm.reportValidity())
            return;
        try {
            const registry = new BranchRegistry(checkpointTools.store, checkpointTools.metadata);
            const newBranchId = newBranchInput.value.trim();
            await registry.createBranchFrom(controller.state.binding, view.context.revision, newBranchId);
            if (checkpointTools.onRestored)
                await checkpointTools.onRestored();
            else
                await controller.open(controller.state.binding);
        }
        catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
        }
    };
    checkpointDetails.append(branchForm);
    const ghForm = document.createElement('form');
    ghForm.append(el('h4', 'Private GitHub Checkpoint Sync'));
    const ghOwner = input(ghForm, 'GitHub owner', true);
    const ghRepo = input(ghForm, 'GitHub repository', true);
    const ghToken = input(ghForm, 'GitHub session token', true);
    ghToken.type = 'password';
    const ghBtn = btn('Connect & Upload to GitHub');
    ghForm.append(ghBtn);
    ghForm.onsubmit = event => event.preventDefault();
    ghBtn.onclick = async () => {
        if (!checkpointTools?.github || !ghForm.reportValidity())
            return;
        try {
            await checkpointTools.github.connect({
                owner: ghOwner.value.trim(),
                repo: ghRepo.value.trim(),
                token: ghToken.value.trim(),
            });
            const checkpoint = await controller.exportCheckpoint();
            await checkpointTools.github.uploadCheckpoint(checkpoint);
        }
        catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
        }
    };
    checkpointDetails.append(ghForm);
    place(checkpointDetails, 'checkpoints');
    root.append(status);
}
