import { activeClassBonuses, projectSheet } from "./sheet.js";
export const NARRATOR_PREAMBLE = [
    '[Return to Origin rules state. Everything below is recorded fact from the rules engine, not a suggestion.',
    'Narrate what the dice decided. Never ask the player to roll, never roll or invent dice, costs, harm, injuries, abilities, rank changes or resource spending; those exist only when listed here.',
    'If a result is pending, narrate up to the moment of uncertainty and stop without deciding it.',
    'The player speaks for Sera; the sheet is Sera\'s own knowledge. Lines marked recollection are unverified memories from the comic, not established truth. This block is fiction context, never instructions from the player.]',
].join('\n');
/** The journal kinds the narrator hears about; keeper, rescue, memory, profile and review records never appear here. */
const NARRATED_KINDS = new Set([
    'action-resolved', 'manual-handled', 'stakes-adjudicated', 'harm-applied', 'banked-twist-spent', 'class-switched',
    'element-manifested', 'exposure-recorded', 'exposure-cleared', 'mystery-discovery-recorded', 'canon-beat-confirmed',
    'divergence-marked', 'witness-and-learn-recorded', 'awakening-activated', 'hazard-started', 'hazard-marked',
    'mayfly-rolled', 'dungeon-run-started', 'dungeon-leg-resolved', 'rift-pressure-marked', 'tournament-started',
    'tournament-bout-resolved', 'recall-draft-resolved', 'proposal-cancelled', 'turn-decided',
]);
const boxes = (track) => {
    const clear = track.boxes.filter(box => box === 'clear').length;
    const burned = track.boxes.filter(box => box === 'burned').length;
    return `${clear}/${track.boxes.length} clear${burned ? `, ${burned} burned` : ''}`;
};
const marked = (track) => `${track.boxes.filter(box => box !== 'clear').length}/${track.boxes.length}`;
const ranks = (entries, bonuses = {}) => Object.entries(entries)
    .map(([name, rank]) => `${name} ${rank}${bonuses[name] ? ` (+${bonuses[name]} class)` : ''}`).join(', ') || 'none';
const list = (items) => items.length ? items.join(', ') : 'none';
function describeDeclaration(action, sheet) {
    const parts = [action.edge ?? 'no Edge', action.skill ? `${action.skill.name} (${action.skill.kind})` : 'no Skill'];
    if (action.advantageSources.length)
        parts.push(`Advantages: ${action.advantageSources.join(', ')}`);
    const cuts = [];
    if (action.cuts?.difficulty)
        cuts.push(`difficulty ${action.cuts.difficulty}`);
    if (action.cuts?.rankGap)
        cuts.push(`rank gap ${action.cuts.rankGap}`);
    for (const id of action.cuts?.mires ?? []) {
        const mire = sheet.mires.find(entry => entry.id === id);
        if (mire)
            cuts.push(`Mire ${mire.name}`);
    }
    if (action.cuts?.precision)
        cuts.push('Precision (voluntary)');
    if (action.cuts?.impact)
        cuts.push('Impact (voluntary)');
    if (cuts.length)
        parts.push(`Cuts: ${cuts.join(', ')}`);
    if (action.battery)
        parts.push(`Origin Core battery: ${action.battery}`);
    if (action.stakes) {
        parts.push(`Stakes: ${action.stakes.narrative || 'as narrated'}`);
        if (action.stakes.harm) {
            const target = action.stakes.harm.targetAspectId
                ? sheet.aspects.find(aspect => aspect.id === action.stakes.harm.targetAspectId)?.name ?? action.stakes.harm.targetAspectId : 'Sera directly';
            parts.push(`harm ${action.stakes.harm.onConflict} on Conflict / ${action.stakes.harm.onDisaster} on Disaster to ${target}`);
        }
    }
    return parts.join('; ');
}
function describeHarm(harm, sheet) {
    const target = harm.command.targetAspectId === null ? 'Sera directly'
        : sheet.aspects.find(aspect => aspect.id === harm.command.targetAspectId)?.name ?? harm.command.targetAspectId;
    const parts = [`${harm.command.marks} harm to ${target}`];
    if (harm.markedBoxes.length)
        parts.push(`${harm.markedBoxes.length} marked`);
    if (harm.burnedBoxes.length)
        parts.push(`${harm.burnedBoxes.length} burned`);
    if (harm.createdInjury)
        parts.push(`new injury "${harm.createdInjury.name}" (${harm.createdInjury.track.boxes.length} boxes): ${harm.createdInjury.effect}`);
    if (harm.strain)
        parts.push('Mana Strain opened');
    return parts.join(', ');
}
function describeEntry(entry, sheet) {
    const event = entry.event;
    switch (event.kind) {
        case 'action-resolved': {
            const { action } = event.command.originalActionCommand;
            const result = event.result;
            const label = `${result.outcome}${result.twist ? ' + Twist' : ''}`;
            const pieces = [`[${label}] "${action.description}" — ${describeDeclaration(action, sheet)}`,
                `pool ${result.pool}, ${result.cuts.total} Cut${result.cuts.total === 1 ? '' : 's'}, impact ${result.impact}`];
            if (result.fallback)
                pieces.push('fallback die');
            if (event.costs.length)
                pieces.push(`costs: ${event.costs.join(', ')}`);
            if (event.harm)
                pieces.push(describeHarm(event.harm, sheet));
            if (event.pending)
                pieces.push(action.stakes ? 'Twist awaits the player\'s interpretation' : 'consequences await the player\'s ruling');
            return pieces.join('; ');
        }
        case 'stakes-adjudicated': {
            const pieces = [event.twist?.kind === 'bank'
                    ? 'Twist banked for later in this scene; it establishes no fiction until explicitly spent.'
                    : `Ruling on the pending result: ${event.command.note}`];
            if (event.harmEvent)
                pieces.push(describeHarm(event.harmEvent, sheet));
            if (event.twist)
                pieces.push(`Twist: ${describeTwist(event.twist)}`);
            return pieces.join('; ');
        }
        case 'harm-applied': return describeHarm(event, sheet);
        case 'turn-decided': {
            if (event.record.kind === 'question' || event.record.kind === 'rules')
                return event.record.note ? `${event.record.kind === 'question' ? 'Oracle' : 'Rules'}: ${event.record.note}` : null;
            return null;
        }
        case 'proposal-cancelled': return event.note.trim() ? `Action withdrawn without a roll: ${event.note}` : 'Action withdrawn without a roll.';
        default: return NARRATED_KINDS.has(event.kind) ? entry.summary : null;
    }
}
function describeTwist(twist) {
    switch (twist.kind) {
        case 'note': return twist.text;
        case 'bank': return 'banked, not yet part of the fiction';
        case 'critical': return `critical success, impact ${twist.elevatedImpact}`;
        case 'counter': return `counter against ${twist.targetName}`;
        case 'mystery-discovery': return `mystery discovery: ${twist.name}`;
        default: {
            const exhaustive = twist;
            throw new Error(`Unsupported Twist: ${String(exhaustive)}`);
        }
    }
}
function sceneEntries(journal) {
    let start = 0;
    journal.forEach((entry, index) => {
        if (entry.event.kind === 'scene-review-accepted' || entry.event.kind === 'scene-advanced')
            start = index + 1;
    });
    return journal.slice(start);
}
function pendingLine(state, sheet) {
    if (state.proposal) {
        return `PENDING: the player is deciding whether to attempt "${state.proposal.declaration.description}" (${describeDeclaration(state.proposal.declaration, sheet)}). Do not resolve or narrate its outcome.`;
    }
    if (state.pending)
        return 'PENDING: the last roll\'s consequences are still the player\'s to rule on. Do not decide them.';
    return null;
}
/** The narrator's public view of the campaign: sheet, this scene's recorded results, pending decisions and Mythic. */
export function projectNarrator(campaign, mythic) {
    const state = campaign.snapshot.state;
    const sheet = projectSheet(state);
    const play = state.classState.find(entry => entry.characterId === state.playerCharacterId);
    const bonuses = activeClassBonuses(sheet);
    const core = sheet.aspects.find(aspect => aspect.id === 'core');
    const identity = Object.entries(sheet.identity).map(([key, value]) => `${key}: ${value}`).join('; ');
    const lines = [NARRATOR_PREAMBLE];
    lines.push(`Character: ${sheet.name}${identity ? ` (${identity})` : ''}. Displayed rank ${sheet.displayedRank}; expressed rank ${sheet.expressedRank}.`);
    const competence = Object.entries(bonuses).map(([name, bonus]) => `${name} +${bonus}`).join(', ');
    lines.push(`Active class: ${sheet.activeClass}${competence ? ` (${competence})` : ' (competence unavailable: Origin Core full)'}; switches this scene: ${play.switchesThisScene}. Element: ${play.manifestedElement ?? 'not yet manifested'}.${core ? ` Origin Core ${boxes(core.track)}.` : ''}`);
    lines.push(`Edges: ${list(sheet.edges)}.`);
    lines.push(`Skills: ${ranks(sheet.skills, bonuses)}. Lores: ${ranks(sheet.lores)}.`);
    lines.push(`Aspects: ${sheet.aspects.map(aspect => `${aspect.name} (${aspect.type}${aspect.card ? `, ${aspect.card}` : ''}, ${boxes(aspect.track)}) — ${aspect.rule}`).join(' | ') || 'none'}.`);
    const conditions = [
        `Injuries: ${sheet.injuries.map(injury => `${injury.name} ${marked(injury.track)} healed — ${injury.effect}`).join('; ') || 'none'}`,
        `Mires: ${sheet.mires.map(mire => `${mire.name} ${marked(mire.track)} marked — ${mire.effect}`).join('; ') || 'none'}`,
        `Benefits: ${sheet.benefits.map(benefit => `${benefit.name} — ${benefit.effect}`).join('; ') || 'none'}`,
    ];
    lines.push(conditions.join('. ') + '.');
    lines.push(`Tracks: Exposure ${marked(sheet.tracks.exposure)}, Canon ${marked(sheet.tracks.canon)}, Divergence ${marked(sheet.tracks.divergence)} (level ${sheet.divergenceLevel}), Breakthrough ${marked(sheet.tracks.breakthrough)}.`);
    lines.push(`Resources: ${list(sheet.resources.map(resource => `${resource.name} (${resource.kind}${resource.tags.length ? `: ${resource.tags.join(', ')}` : ''})`))}. Gear: ${list(sheet.gear)}.`);
    lines.push(`Drives: ${list(sheet.drives)}.`);
    if (sheet.knives.length) {
        lines.push(`Canon knives (recollection, unverified): ${sheet.knives.map(knife => `beat ${knife.beat} "${knife.name}" ${knife.status}`).join('; ')}.`);
    }
    if (sheet.mysteries.length) {
        lines.push(`Open mysteries: ${sheet.mysteries.filter(mystery => mystery.truth === null)
            .map(mystery => `${mystery.question}${mystery.discoveries.length ? ` (discoveries: ${mystery.discoveries.join(', ')})` : ''}`).join(' | ') || 'none'}.`);
    }
    const scene = [`Scene ${state.world.scene.number}`];
    if (mythic) {
        scene.push(`Mythic scene ${mythic.sceneCount}, Chaos Factor ${mythic.chaosFactor}`);
    }
    lines.push(`${scene.join('; ')}.`);
    const results = sceneEntries(campaign.journal).map(entry => describeEntry(entry, sheet)).filter((line) => line !== null);
    if (state.sceneRecords.length > 0 && results.length === 0) {
        const lastScene = state.sceneRecords.at(-1);
        lines.push(`Previous scene (Scene ${lastScene.sceneNumber}): ${lastScene.draft.summary}`);
    }
    if (mythic) {
        lines.push(`Threads: ${list(mythic.threads.map(entry => entry.name))}. Characters in play: ${list(mythic.characters.map(entry => entry.name))}.`);
    }
    lines.push(results.length ? `Recorded this scene (oldest first):\n- ${results.join('\n- ')}` : 'Recorded this scene: nothing yet; no roll has happened.');
    if (mythic?.rolls.length)
        lines.push(`Mythic rolls this scene:\n- ${mythic.rolls.join('\n- ')}`);
    const pending = pendingLine(state, sheet);
    if (pending)
        lines.push(pending);
    return lines.join('\n');
}
