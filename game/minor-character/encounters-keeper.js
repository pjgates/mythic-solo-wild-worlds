import { rollD6 } from "../../engine/dice.js";
import { sameValue } from "./events.js";
import { correctProfileMemory } from "./memory-publication.js";
import { ELEMENTS } from "./state.js";
export const MINOR_PROFILE_SECTIONS = [
    'overview',
    'personality',
    'background',
    'nathan-background',
    'relationships',
    'concerns',
];
function ext(state) {
    return state;
}
function getEncounters(state) {
    const s = ext(state);
    return {
        hazards: s.encounters?.hazards ?? [],
        dungeonRuns: s.encounters?.dungeonRuns ?? [],
        tournaments: s.encounters?.tournaments ?? [],
    };
}
function ensureEncounters(state) {
    const s = ext(state);
    if (!s.encounters) {
        s.encounters = { hazards: [], dungeonRuns: [], tournaments: [] };
    }
    else {
        s.encounters.hazards ??= [];
        s.encounters.dungeonRuns ??= [];
        s.encounters.tournaments ??= [];
    }
    return s.encounters;
}
function nonEmptyText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function isKnownPerson(state, personId) {
    return state.characters.some(c => c.id === personId)
        || state.world.characters.some(c => c.id === personId);
}
function rollValidD6(die) {
    const value = die();
    if (!Number.isInteger(value) || value < 1 || value > 6) {
        throw new Error('Invalid die roll; expected integer 1..6.');
    }
    return value;
}
function predeterminesCentralMystery(state, command) {
    if (command.mysteryId !== undefined)
        return true;
    const combined = `${command.title} ${command.secret} ${command.clues.map(c => c.text).join(' ')}`.toLowerCase();
    for (const mystery of state.world.mysteries) {
        if (mystery.truth !== null)
            continue;
        const questionNorm = mystery.question.replace(/\?+$/, '').trim().toLowerCase();
        if (combined.includes(mystery.id.toLowerCase()) || (questionNorm.length > 0 && combined.includes(questionNorm))) {
            return true;
        }
        if (/rifts?\s+open/i.test(mystery.question)) {
            if (/\b(why (?:did )?the rifts? open(?:ed)?|rifts? opened because|(?:true )?cause of the rifts?|rift truth)\b/i.test(combined)) {
                return true;
            }
        }
        if (/system/i.test(mystery.question)) {
            if (/\b(what (?:is )?the system and what (?:does it )?want|(?:true )?nature of the system|system(?:'s|s)? (?:true )?nature|what the system (?:really |truly )?(?:is|wants)|the system was (?:created|built|made) by)\b/i.test(combined)) {
                return true;
            }
        }
        if (/origin/i.test(mystery.question)) {
            if (/\b(where (?:did )?(?:the )?origin (?:come|came) from|(?:true )?source of (?:the )?origin|origin(?:'s|s)? (?:true )?source|(?:the )?origin came from)\b/i.test(combined)) {
                return true;
            }
        }
    }
    return false;
}
// ---------------------------------------------------------------------------
// 1. Private Keeper Secrets & Revelation
// ---------------------------------------------------------------------------
export function decideAddKeeperSecret(state, command) {
    if (!command || command.kind !== 'add-keeper-secret') {
        throw new Error('Invalid add-keeper-secret command.');
    }
    if (!nonEmptyText(command.id) || !nonEmptyText(command.title) || !nonEmptyText(command.secret)) {
        throw new Error('Keeper secret requires non-empty id, title, and secret.');
    }
    const existing = ext(state).keeperSecrets ?? [];
    if (existing.some(secret => secret.id === command.id)) {
        throw new Error(`Duplicate keeper secret ID: ${command.id}.`);
    }
    if (command.personId !== null && (!nonEmptyText(command.personId) || !isKnownPerson(state, command.personId))) {
        throw new Error('Keeper secret personId must be null or an existing character/cast member.');
    }
    if (!Array.isArray(command.clues)) {
        throw new Error('Keeper secret clues must be an array.');
    }
    const clueIds = new Set();
    for (const clue of command.clues) {
        if (!clue || !nonEmptyText(clue.id) || !nonEmptyText(clue.text)) {
            throw new Error('Each keeper clue requires a non-empty id and text.');
        }
        if (clueIds.has(clue.id)) {
            throw new Error(`Duplicate keeper clue ID: ${clue.id}.`);
        }
        clueIds.add(clue.id);
    }
    if (predeterminesCentralMystery(state, command)) {
        throw new Error('Keeper secrets cannot predetermine an open central mystery.');
    }
    return {
        kind: 'keeper-secret-added',
        secret: {
            id: command.id,
            personId: command.personId,
            title: command.title,
            secret: command.secret,
            clues: command.clues.map(clue => ({ id: clue.id, text: clue.text, revealed: false })),
            status: 'hidden',
        },
    };
}
export function applyAddKeeperSecret(state, event) {
    if (!event || event.kind !== 'keeper-secret-added' || !event.secret) {
        throw new Error('Invalid keeper-secret-added event.');
    }
    const expected = decideAddKeeperSecret(state, {
        kind: 'add-keeper-secret',
        id: event.secret.id,
        personId: event.secret.personId,
        title: event.secret.title,
        secret: event.secret.secret,
        clues: (event.secret.clues ?? []).map(({ id, text }) => ({ id, text })),
    });
    if (!sameValue(event, expected)) {
        throw new Error('Recorded keeper-secret-added event disagrees with state.');
    }
    const s = ext(state);
    s.keeperSecrets ??= [];
    s.keeperSecrets.push(structuredClone(event.secret));
    return state;
}
export function decideRevealKeeperSecret(state, command, operationId, revision) {
    if (!command || command.kind !== 'reveal-keeper-secret' || !nonEmptyText(command.secretId)) {
        throw new Error('Invalid reveal-keeper-secret command.');
    }
    if (state.sceneReview) {
        throw new Error('Finish the pending scene review first.');
    }
    if (!nonEmptyText(operationId) || !Number.isSafeInteger(revision) || revision < 0) {
        throw new Error('Reveal keeper secret requires a valid operationId and revision.');
    }
    const secret = (ext(state).keeperSecrets ?? []).find(entry => entry.id === command.secretId);
    if (!secret) {
        throw new Error(`Keeper secret not found: ${command.secretId}.`);
    }
    let revealedText;
    if (command.clueId !== undefined) {
        const clue = secret.clues.find(entry => entry.id === command.clueId);
        if (!clue) {
            throw new Error(`Keeper clue not found: ${command.clueId}.`);
        }
        revealedText = clue.text;
    }
    else if (command.revealAll === true) {
        revealedText = secret.secret;
    }
    else {
        throw new Error('Specify a clueId or revealAll: true to reveal a keeper secret.');
    }
    let memoryPublications = [];
    if (command.publishToProfile !== undefined) {
        const pub = command.publishToProfile;
        if (!pub || !nonEmptyText(pub.personId) || !isKnownPerson(state, pub.personId)
            || !state.profiles.some(profile => profile.personId === pub.personId)) {
            throw new Error('publishToProfile must target an existing person profile.');
        }
        if (!nonEmptyText(pub.entryId) || !MINOR_PROFILE_SECTIONS.includes(pub.section)
            || !['established', 'unconfirmed'].includes(pub.status)) {
            throw new Error('publishToProfile requires valid entryId, section, and status.');
        }
        if (!Array.isArray(pub.knownBy)
            || !pub.knownBy.every(id => nonEmptyText(id) && isKnownPerson(state, id))
            || new Set(pub.knownBy).size !== pub.knownBy.length) {
            throw new Error('publishToProfile knownBy must list distinct existing people.');
        }
        const next = structuredClone(state);
        const profile = next.profiles.find(entry => entry.personId === pub.personId);
        const existingEntry = profile.entries.find(entry => entry.id === pub.entryId);
        const sources = [{ kind: 'operation', operationId }];
        if (existingEntry) {
            existingEntry.section = pub.section;
            existingEntry.text = revealedText;
            existingEntry.status = pub.status;
            existingEntry.playerVisible = true;
            existingEntry.knownBy = [...pub.knownBy];
            existingEntry.sources = sources;
        }
        else {
            profile.entries.push({
                id: pub.entryId,
                section: pub.section,
                text: revealedText,
                status: pub.status,
                playerVisible: true,
                knownBy: [...pub.knownBy],
                relatedPersonIds: [],
                sources,
            });
        }
        profile.revision += 1;
        memoryPublications = correctProfileMemory(next, pub.personId, operationId, revision);
    }
    return {
        kind: 'keeper-secret-revealed',
        command: structuredClone(command),
        operationId,
        revision,
        revealedText,
        ...(memoryPublications.length > 0 ? { memoryPublications } : {}),
    };
}
export function applyRevealKeeperSecret(state, event) {
    if (!event || event.kind !== 'keeper-secret-revealed') {
        throw new Error('Invalid keeper-secret-revealed event.');
    }
    const expected = decideRevealKeeperSecret(state, event.command, event.operationId, event.revision);
    const normalizedEvent = event.memoryPublications === undefined && expected.memoryPublications !== undefined
        ? { ...event, memoryPublications: expected.memoryPublications }
        : event;
    if (!sameValue(normalizedEvent, expected)) {
        throw new Error('Recorded keeper-secret-revealed event disagrees with state.');
    }
    const secret = (ext(state).keeperSecrets ?? []).find(entry => entry.id === event.command.secretId);
    if (event.command.clueId !== undefined) {
        const clue = secret.clues.find(entry => entry.id === event.command.clueId);
        clue.revealed = true;
        clue.revealedOperationId = event.operationId;
    }
    if (event.command.revealAll === true) {
        secret.status = 'revealed';
        secret.revealedOperationId = event.operationId;
        for (const clue of secret.clues) {
            clue.revealed = true;
            clue.revealedOperationId ??= event.operationId;
        }
    }
    if (event.command.publishToProfile !== undefined) {
        const pub = event.command.publishToProfile;
        const profile = state.profiles.find(entry => entry.personId === pub.personId);
        const existingEntry = profile.entries.find(entry => entry.id === pub.entryId);
        const sources = [{ kind: 'operation', operationId: event.operationId }];
        if (existingEntry) {
            existingEntry.section = pub.section;
            existingEntry.text = event.revealedText;
            existingEntry.status = pub.status;
            existingEntry.playerVisible = true;
            existingEntry.knownBy = [...pub.knownBy];
            existingEntry.sources = sources;
        }
        else {
            profile.entries.push({
                id: pub.entryId,
                section: pub.section,
                text: event.revealedText,
                status: pub.status,
                playerVisible: true,
                knownBy: [...pub.knownBy],
                relatedPersonIds: [],
                sources,
            });
        }
        profile.revision += 1;
        if (normalizedEvent.memoryPublications?.length) {
            state.memoryPublications.push(...structuredClone(normalizedEvent.memoryPublications));
        }
    }
    return state;
}
export function projectKeeperSecrets(state) {
    return structuredClone(ext(state).keeperSecrets ?? []);
}
// ---------------------------------------------------------------------------
// 2. Fights, Hazards & Mayfly Fight Rolls
// ---------------------------------------------------------------------------
function validateElementList(list, label) {
    if (list === undefined)
        return [];
    if (!Array.isArray(list) || !list.every(el => ELEMENTS.includes(el)) || new Set(list).size !== list.length) {
        throw new Error(`Hazard ${label} must be a list of distinct canonical elements.`);
    }
    return [...list];
}
export function decideStartHazard(state, command) {
    if (!command || command.kind !== 'start-hazard') {
        throw new Error('Invalid start-hazard command.');
    }
    if (!nonEmptyText(command.id) || !nonEmptyText(command.name)) {
        throw new Error('Hazard requires a non-empty id and name.');
    }
    if (getEncounters(state).hazards.some(h => h.id === command.id)) {
        throw new Error(`Duplicate hazard ID: ${command.id}.`);
    }
    if (!Number.isInteger(command.limit) || command.limit < 3 || command.limit > 20) {
        throw new Error('Hazard limit must be an integer between 3 and 20.');
    }
    const weaknesses = validateElementList(command.weaknesses, 'weaknesses');
    const resistances = validateElementList(command.resistances, 'resistances');
    const immunities = validateElementList(command.immunities, 'immunities');
    const allElements = [...weaknesses, ...resistances, ...immunities];
    if (new Set(allElements).size !== allElements.length) {
        throw new Error('Hazard weaknesses, resistances, and immunities must be disjoint.');
    }
    const rawAspects = command.aspects ?? [];
    if (!Array.isArray(rawAspects)) {
        throw new Error('Hazard aspects must be an array.');
    }
    const aspectIds = new Set();
    const aspects = rawAspects.map(aspect => {
        if (!aspect || !nonEmptyText(aspect.id) || !nonEmptyText(aspect.name)
            || !Number.isInteger(aspect.boxes) || aspect.boxes < 1 || aspect.boxes > 20) {
            throw new Error('Each hazard aspect requires non-empty id, name, and boxes (1..20).');
        }
        if (aspectIds.has(aspect.id)) {
            throw new Error(`Duplicate hazard aspect ID: ${aspect.id}.`);
        }
        aspectIds.add(aspect.id);
        return {
            id: aspect.id,
            name: aspect.name,
            boxes: Array(aspect.boxes).fill('clear'),
        };
    });
    const quirks = command.quirks ?? [];
    if (!Array.isArray(quirks) || !quirks.every(nonEmptyText)) {
        throw new Error('Hazard quirks must be non-empty strings.');
    }
    return {
        kind: 'hazard-started',
        hazard: {
            id: command.id,
            name: command.name,
            limit: command.limit,
            marks: 0,
            status: 'active',
            weaknesses,
            resistances,
            immunities,
            aspects,
            quirks: [...quirks],
        },
    };
}
export function applyStartHazard(state, event) {
    if (!event || event.kind !== 'hazard-started' || !event.hazard) {
        throw new Error('Invalid hazard-started event.');
    }
    const expected = decideStartHazard(state, {
        kind: 'start-hazard',
        id: event.hazard.id,
        name: event.hazard.name,
        limit: event.hazard.limit,
        weaknesses: event.hazard.weaknesses,
        resistances: event.hazard.resistances,
        immunities: event.hazard.immunities,
        aspects: (event.hazard.aspects ?? []).map(a => ({ id: a.id, name: a.name, boxes: a.boxes?.length ?? 0 })),
        quirks: event.hazard.quirks,
    });
    if (!sameValue(event, expected)) {
        throw new Error('Recorded hazard-started event disagrees with state.');
    }
    ensureEncounters(state).hazards.push(structuredClone(event.hazard));
    return state;
}
export function decideMarkHazard(state, command) {
    if (!command || command.kind !== 'mark-hazard' || !nonEmptyText(command.hazardId)) {
        throw new Error('Invalid mark-hazard command.');
    }
    const hazard = getEncounters(state).hazards.find(h => h.id === command.hazardId);
    if (!hazard) {
        throw new Error(`Hazard not found: ${command.hazardId}.`);
    }
    if (hazard.status !== 'active') {
        throw new Error('Hazard is already defeated.');
    }
    if (!Number.isInteger(command.baseMarks) || command.baseMarks < 0) {
        throw new Error('baseMarks must be a non-negative integer.');
    }
    const element = command.element ?? null;
    if (element !== null && !ELEMENTS.includes(element)) {
        throw new Error('Invalid element for hazard mark.');
    }
    let effectiveMarks;
    if (element !== null && hazard.immunities.includes(element)) {
        effectiveMarks = 0;
    }
    else {
        const bonus = element !== null && hazard.weaknesses.includes(element) ? 2 : 0;
        const penalty = element !== null && hazard.resistances.includes(element) ? 2 : 0;
        effectiveMarks = Math.max(0, command.baseMarks + bonus - penalty);
    }
    let markedAspectBoxes = [];
    if (command.aspectId !== undefined) {
        const aspect = hazard.aspects.find(a => a.id === command.aspectId);
        if (!aspect) {
            throw new Error(`Hazard aspect not found: ${command.aspectId}.`);
        }
        const clearIndices = aspect.boxes.flatMap((box, idx) => box === 'clear' ? [idx] : []);
        markedAspectBoxes = clearIndices.slice(0, effectiveMarks);
    }
    const marksBefore = hazard.marks;
    const marksAfter = Math.min(hazard.limit, marksBefore + effectiveMarks);
    const defeated = marksAfter >= hazard.limit;
    return {
        kind: 'hazard-marked',
        command: structuredClone(command),
        effectiveMarks,
        marksBefore,
        marksAfter,
        defeated,
        markedAspectBoxes,
    };
}
export function applyMarkHazard(state, event) {
    if (!event || event.kind !== 'hazard-marked') {
        throw new Error('Invalid hazard-marked event.');
    }
    const expected = decideMarkHazard(state, event.command);
    if (!sameValue(event, expected)) {
        throw new Error('Recorded hazard-marked event disagrees with state.');
    }
    const hazard = ensureEncounters(state).hazards.find(h => h.id === event.command.hazardId);
    if (event.command.aspectId !== undefined) {
        const aspect = hazard.aspects.find(a => a.id === event.command.aspectId);
        for (const boxIndex of event.markedAspectBoxes) {
            aspect.boxes[boxIndex] = 'marked';
        }
    }
    hazard.marks = event.marksAfter;
    if (event.defeated) {
        hazard.status = 'defeated';
    }
    return state;
}
export function decideMayflyRoll(state, command, die = rollD6) {
    if (!command || command.kind !== 'roll-mayfly' || !nonEmptyText(command.hazardId)) {
        throw new Error('Invalid roll-mayfly command.');
    }
    const hazard = getEncounters(state).hazards.find(h => h.id === command.hazardId);
    if (!hazard) {
        throw new Error(`Hazard not found: ${command.hazardId}.`);
    }
    if (hazard.status !== 'active') {
        throw new Error('Cannot roll Mayfly focus for a defeated hazard.');
    }
    if (![1, 2, 3].includes(command.diceCount)) {
        throw new Error('Mayfly diceCount must be 1, 2, or 3.');
    }
    const cut = command.cut ?? 0;
    if (![0, 1, 2].includes(cut)) {
        throw new Error('Mayfly cut must be 0, 1, or 2.');
    }
    const draws = Array.from({ length: command.diceCount }, () => rollValidD6(die));
    const sorted = [...draws].sort((a, b) => b - a);
    const remaining = sorted.slice(cut);
    let fallback = null;
    let survivors;
    if (remaining.length === 0) {
        fallback = rollValidD6(die);
        survivors = [fallback];
    }
    else {
        survivors = remaining;
    }
    const highest = survivors[0];
    const tier = highest === 6
        ? 'tentative'
        : highest >= 4
            ? 'normal'
            : 'devastating';
    const marksRange = tier === 'tentative'
        ? [1, 2]
        : tier === 'normal'
            ? [3, 4]
            : [5, 6];
    return {
        kind: 'mayfly-rolled',
        command: structuredClone(command),
        roll: {
            draws,
            survivors,
            fallback,
            highest,
            tier,
            marksRange,
        },
    };
}
export function applyMayflyRoll(state, event) {
    if (!event || event.kind !== 'mayfly-rolled' || !event.roll) {
        throw new Error('Invalid mayfly-rolled event.');
    }
    const sequence = [
        ...(event.roll.draws ?? []),
        ...(event.roll.fallback !== null && event.roll.fallback !== undefined ? [event.roll.fallback] : []),
    ];
    let idx = 0;
    const expected = decideMayflyRoll(state, event.command, () => sequence[idx++]);
    if (idx !== sequence.length || !sameValue(event, expected)) {
        throw new Error('Recorded mayfly-rolled event disagrees with state.');
    }
    const hazard = ensureEncounters(state).hazards.find(h => h.id === event.command.hazardId);
    hazard.lastMayflyRoll = structuredClone(event.roll);
    return state;
}
// ---------------------------------------------------------------------------
// 3. Dungeon Runs
// ---------------------------------------------------------------------------
function isIntelResource(resource) {
    return resource.kind === 'Intel'
        || resource.kind === 'Margin Note'
        || resource.kind.includes('Intel');
}
function isRumorResource(resource) {
    return resource.kind === 'Rumor'
        || resource.kind === 'Rumors'
        || resource.kind === 'Margin Note'
        || resource.kind.includes('Rumor');
}
function hasEchoingTag(resource) {
    return resource.tags.some(tag => tag.name === 'Echoing');
}
export function decideStartDungeonRun(state, command) {
    if (!command || command.kind !== 'start-dungeon-run') {
        throw new Error('Invalid start-dungeon-run command.');
    }
    if (!nonEmptyText(command.id) || !nonEmptyText(command.name) || !nonEmptyText(command.grade)
        || !nonEmptyText(command.objective) || !nonEmptyText(command.law)) {
        throw new Error('Dungeon run requires non-empty id, name, grade, objective, and law.');
    }
    if (getEncounters(state).dungeonRuns.some(r => r.id === command.id)) {
        throw new Error(`Duplicate dungeon run ID: ${command.id}.`);
    }
    if (!Number.isInteger(command.progressBoxes) || command.progressBoxes < 2 || command.progressBoxes > 12) {
        throw new Error('Dungeon run progressBoxes must be an integer between 2 and 12.');
    }
    return {
        kind: 'dungeon-run-started',
        run: {
            id: command.id,
            name: command.name,
            grade: command.grade,
            objective: command.objective,
            law: command.law,
            progress: Array(command.progressBoxes).fill('clear'),
            supply: command.trackSupply ? ['clear', 'clear', 'clear'] : null,
            riftPressure: ['clear', 'clear', 'clear', 'clear', 'clear', 'clear'],
            status: 'active',
            legs: [],
        },
    };
}
export function applyStartDungeonRun(state, event) {
    if (!event || event.kind !== 'dungeon-run-started' || !event.run) {
        throw new Error('Invalid dungeon-run-started event.');
    }
    const expected = decideStartDungeonRun(state, {
        kind: 'start-dungeon-run',
        id: event.run.id,
        name: event.run.name,
        grade: event.run.grade,
        objective: event.run.objective,
        law: event.run.law,
        progressBoxes: event.run.progress?.length ?? 0,
        ...(event.run.supply !== null ? { trackSupply: true } : {}),
    });
    if (!sameValue(event, expected)) {
        throw new Error('Recorded dungeon-run-started event disagrees with state.');
    }
    ensureEncounters(state).dungeonRuns.push(structuredClone(event.run));
    return state;
}
export function decideDungeonLeg(state, command, die = rollD6) {
    if (!command || command.kind !== 'resolve-dungeon-leg' || !nonEmptyText(command.runId)) {
        throw new Error('Invalid resolve-dungeon-leg command.');
    }
    const run = getEncounters(state).dungeonRuns.find(r => r.id === command.runId);
    if (!run) {
        throw new Error(`Dungeon run not found: ${command.runId}.`);
    }
    if (run.status === 'arrived') {
        throw new Error('Dungeon run has already arrived at its objective.');
    }
    if (run.status !== 'active') {
        throw new Error('Dungeon run is no longer active.');
    }
    if (!['careful', 'swift', 'camp'].includes(command.pace)) {
        throw new Error('Dungeon leg pace must be careful, swift, or camp.');
    }
    if (command.spendIntelId !== undefined && command.authorWithResources !== undefined) {
        throw new Error('Cannot combine spendIntelId and authorWithResources on the same leg.');
    }
    const clearProgress = run.progress.flatMap((box, idx) => box === 'clear' ? [idx] : []);
    const clearRift = run.riftPressure.flatMap((box, idx) => box === 'clear' ? [idx] : []);
    let progressMarked = [];
    let supplyMarked = null;
    let riftMarked = null;
    if (command.pace === 'careful') {
        progressMarked = clearProgress.slice(0, 1);
    }
    else if (command.pace === 'swift') {
        progressMarked = clearProgress.slice(0, 2);
        riftMarked = clearRift[0] ?? null;
    }
    else {
        if (run.supply !== null) {
            const clearSupplyIndex = run.supply.findIndex(box => box === 'clear');
            if (clearSupplyIndex === -1) {
                throw new Error('Supply is exhausted; cannot camp without Supply.');
            }
            supplyMarked = clearSupplyIndex;
        }
    }
    const character = state.characters.find(c => c.id === state.playerCharacterId);
    const consumedResourceIds = [];
    const retainedEchoingIds = [];
    const recordResourceUse = (resource) => {
        if (hasEchoingTag(resource)) {
            retainedEchoingIds.push(resource.id);
        }
        else {
            consumedResourceIds.push(resource.id);
        }
    };
    let scoutDie = null;
    let scoutDomain = null;
    let threatDice = [];
    let threatKept = null;
    let threatTier = null;
    let note = command.note?.trim() ?? '';
    if (command.authorWithResources !== undefined) {
        const { intelId, rumorId, locationNote } = command.authorWithResources;
        if (!nonEmptyText(intelId) || !nonEmptyText(rumorId) || !nonEmptyText(locationNote) || intelId === rumorId) {
            throw new Error('authorWithResources requires distinct intelId, rumorId, and a non-empty locationNote.');
        }
        const intelRes = character.resources.find(r => r.id === intelId);
        const rumorRes = character.resources.find(r => r.id === rumorId);
        if (!intelRes || !isIntelResource(intelRes)) {
            throw new Error(`Intel resource not found or incompatible: ${intelId}.`);
        }
        if (!rumorRes || !isRumorResource(rumorRes)) {
            throw new Error(`Rumor resource not found or incompatible: ${rumorId}.`);
        }
        recordResourceUse(intelRes);
        recordResourceUse(rumorRes);
        threatTier = 'authored';
        if (!note)
            note = locationNote;
    }
    else {
        if (command.spendIntelId !== undefined) {
            const intelRes = character.resources.find(r => r.id === command.spendIntelId);
            if (!intelRes || !isIntelResource(intelRes)) {
                throw new Error(`Intel resource not found or incompatible: ${command.spendIntelId}.`);
            }
            recordResourceUse(intelRes);
        }
        scoutDie = rollValidD6(die);
        scoutDomain = scoutDie === 6 ? 'Peace' : scoutDie >= 4 ? 'Order' : 'Nature';
        if (command.spendIntelId !== undefined) {
            const d1 = rollValidD6(die);
            const d2 = rollValidD6(die);
            threatDice = [d1, d2];
            threatKept = Math.max(d1, d2);
        }
        else {
            const d1 = rollValidD6(die);
            threatDice = [d1];
            threatKept = d1;
        }
        threatTier = threatKept === 6 ? 'opportunity' : threatKept >= 4 ? 'hazard-payoff' : 'danger';
    }
    const nextProgress = [...run.progress];
    for (const idx of progressMarked)
        nextProgress[idx] = 'marked';
    const nextRift = [...run.riftPressure];
    if (riftMarked !== null)
        nextRift[riftMarked] = 'marked';
    const allProgressMarked = nextProgress.every(box => box === 'marked');
    const allRiftMarked = nextRift.every(box => box === 'marked');
    const riftReset = allRiftMarked;
    const statusAfter = allRiftMarked
        ? 'broken'
        : allProgressMarked
            ? 'arrived'
            : 'active';
    const leg = {
        legNumber: run.legs.length + 1,
        pace: command.pace,
        scoutDie,
        scoutDomain,
        threatDice,
        threatKept,
        threatTier,
        note,
    };
    return {
        kind: 'dungeon-leg-resolved',
        command: structuredClone(command),
        leg,
        progressMarked,
        supplyMarked,
        riftMarked,
        statusAfter,
        riftReset,
        consumedResourceIds,
        retainedEchoingIds,
    };
}
export function applyDungeonLeg(state, event) {
    if (!event || event.kind !== 'dungeon-leg-resolved' || !event.leg) {
        throw new Error('Invalid dungeon-leg-resolved event.');
    }
    const sequence = [
        ...(event.leg.scoutDie !== null ? [event.leg.scoutDie] : []),
        ...(event.leg.threatDice ?? []),
    ];
    let idx = 0;
    const expected = decideDungeonLeg(state, event.command, () => sequence[idx++]);
    if (idx !== sequence.length || !sameValue(event, expected)) {
        throw new Error('Recorded dungeon-leg-resolved event disagrees with state.');
    }
    const run = ensureEncounters(state).dungeonRuns.find(r => r.id === event.command.runId);
    for (const boxIndex of event.progressMarked) {
        run.progress[boxIndex] = 'marked';
    }
    if (event.supplyMarked !== null && run.supply !== null) {
        run.supply[event.supplyMarked] = 'marked';
    }
    if (event.riftReset) {
        run.riftPressure = ['clear', 'clear', 'clear', 'clear', 'clear', 'clear'];
    }
    else if (event.riftMarked !== null) {
        run.riftPressure[event.riftMarked] = 'marked';
    }
    run.status = event.statusAfter;
    run.legs.push(structuredClone(event.leg));
    const character = state.characters.find(c => c.id === state.playerCharacterId);
    if (event.consumedResourceIds.length > 0) {
        character.resources = character.resources.filter(r => !event.consumedResourceIds.includes(r.id));
    }
    for (const resourceId of event.retainedEchoingIds) {
        const resource = character.resources.find(r => r.id === resourceId);
        if (resource) {
            resource.tags = resource.tags.filter(tag => tag.name !== 'Echoing');
        }
    }
    return state;
}
export function decideRiftPressure(state, command) {
    if (!command || command.kind !== 'mark-rift-pressure' || !nonEmptyText(command.runId)) {
        throw new Error('Invalid mark-rift-pressure command.');
    }
    const run = getEncounters(state).dungeonRuns.find(r => r.id === command.runId);
    if (!run) {
        throw new Error(`Dungeon run not found: ${command.runId}.`);
    }
    if (!Number.isInteger(command.marks) || command.marks < 1) {
        throw new Error('Rift pressure marks must be a positive integer.');
    }
    const boxes = [...run.riftPressure];
    let remaining = command.marks;
    for (let i = 0; i < boxes.length && remaining > 0; i++) {
        if (boxes[i] === 'clear') {
            boxes[i] = 'marked';
            remaining--;
        }
    }
    const broken = boxes.every(box => box === 'marked');
    const afterBoxes = broken
        ? ['clear', 'clear', 'clear', 'clear', 'clear', 'clear']
        : boxes;
    return {
        kind: 'rift-pressure-marked',
        runId: command.runId,
        marks: command.marks,
        broken,
        afterBoxes,
    };
}
export function applyRiftPressure(state, event) {
    if (!event || event.kind !== 'rift-pressure-marked') {
        throw new Error('Invalid rift-pressure-marked event.');
    }
    const expected = decideRiftPressure(state, {
        kind: 'mark-rift-pressure',
        runId: event.runId,
        marks: event.marks,
    });
    if (!sameValue(event, expected)) {
        throw new Error('Recorded rift-pressure-marked event disagrees with state.');
    }
    const run = ensureEncounters(state).dungeonRuns.find(r => r.id === event.runId);
    run.riftPressure = [...event.afterBoxes];
    if (event.broken) {
        run.status = 'broken';
    }
    return state;
}
// ---------------------------------------------------------------------------
// 4. Tournaments
// ---------------------------------------------------------------------------
function isSeraEntrant(state, entrant) {
    const player = state.characters.find(c => c.id === state.playerCharacterId);
    const playerName = (player?.name ?? 'Sera Brooke').trim().toLowerCase();
    const normalized = entrant.trim().toLowerCase();
    return normalized === 'sera' || normalized === playerName || normalized.startsWith('sera ');
}
export function decideStartTournament(state, command) {
    if (!command || command.kind !== 'start-tournament') {
        throw new Error('Invalid start-tournament command.');
    }
    if (!nonEmptyText(command.id) || !nonEmptyText(command.name)) {
        throw new Error('Tournament requires non-empty id and name.');
    }
    if (getEncounters(state).tournaments.some(t => t.id === command.id)) {
        throw new Error(`Duplicate tournament ID: ${command.id}.`);
    }
    const terms = command.terms;
    if (!terms || !nonEmptyText(terms.victoryCondition) || !nonEmptyText(terms.arenaLimits)
        || !nonEmptyText(terms.surrenderSignal) || !nonEmptyText(terms.injuryStakes)) {
        throw new Error('Tournament terms require victoryCondition, arenaLimits, surrenderSignal, and injuryStakes.');
    }
    if (!Array.isArray(command.entrants) || command.entrants.length !== 8
        || !command.entrants.every(nonEmptyText)
        || new Set(command.entrants.map(e => e.trim())).size !== 8) {
        throw new Error('Tournament requires exactly 8 distinct non-empty entrant names.');
    }
    if (!command.entrants.some(entrant => isSeraEntrant(state, entrant))) {
        throw new Error('Tournament entrants must include Sera.');
    }
    const bouts = [];
    for (let i = 0; i < 4; i++) {
        bouts.push({
            id: `r1-b${i + 1}`,
            round: 1,
            entrantA: command.entrants[i * 2],
            entrantB: command.entrants[i * 2 + 1],
            winner: null,
            method: null,
            note: '',
        });
    }
    return {
        kind: 'tournament-started',
        tournament: {
            id: command.id,
            name: command.name,
            terms: structuredClone(terms),
            round: 1,
            interludeTasksRemaining: 0,
            status: 'active',
            entrants: [...command.entrants],
            bouts,
        },
    };
}
export function applyStartTournament(state, event) {
    if (!event || event.kind !== 'tournament-started' || !event.tournament) {
        throw new Error('Invalid tournament-started event.');
    }
    const expected = decideStartTournament(state, {
        kind: 'start-tournament',
        id: event.tournament.id,
        name: event.tournament.name,
        terms: event.tournament.terms,
        entrants: event.tournament.entrants,
    });
    if (!sameValue(event, expected)) {
        throw new Error('Recorded tournament-started event disagrees with state.');
    }
    ensureEncounters(state).tournaments.push(structuredClone(event.tournament));
    return state;
}
export function decideTournamentBout(state, command, die = rollD6) {
    if (!command || command.kind !== 'resolve-tournament-bout'
        || !nonEmptyText(command.tournamentId) || !nonEmptyText(command.boutId) || !nonEmptyText(command.note)) {
        throw new Error('Invalid resolve-tournament-bout command.');
    }
    const tournament = getEncounters(state).tournaments.find(t => t.id === command.tournamentId);
    if (!tournament) {
        throw new Error(`Tournament not found: ${command.tournamentId}.`);
    }
    if (tournament.status !== 'active') {
        throw new Error(`Tournament ${command.tournamentId} is not active.`);
    }
    const bout = tournament.bouts.find(b => b.id === command.boutId && b.round === tournament.round);
    if (!bout) {
        throw new Error(`Bout ${command.boutId} not found in round ${tournament.round}.`);
    }
    if (bout.winner !== null) {
        throw new Error(`Bout ${command.boutId} is already resolved.`);
    }
    if (!['victory', 'yield', 'offscreen'].includes(command.method)) {
        throw new Error('Bout method must be victory, yield, or offscreen.');
    }
    const seraEntrant = isSeraEntrant(state, bout.entrantA)
        ? bout.entrantA
        : isSeraEntrant(state, bout.entrantB)
            ? bout.entrantB
            : null;
    const opponentEntrant = seraEntrant === bout.entrantA
        ? bout.entrantB
        : seraEntrant === bout.entrantB
            ? bout.entrantA
            : null;
    let winner;
    let offscreenRoll = null;
    if (command.method === 'yield') {
        if (command.yieldDriveReward !== undefined) {
            const reward = command.yieldDriveReward;
            if (reward.kind === 'major-milestone') {
                throw new Error('Yielding a tournament bout never grants a major milestone.');
            }
            if (seraEntrant === null) {
                throw new Error('yieldDriveReward is only valid when Sera yields a bout.');
            }
            const character = state.characters.find(c => c.id === state.playerCharacterId);
            if (!character.impulses.some(imp => imp.id === reward.driveId && imp.type === 'text')) {
                throw new Error(`Drive not found: ${reward.driveId}.`);
            }
            if (reward.kind === 'clear-mire') {
                const mire = character.impulses.find((imp) => imp.id === reward.mireId && imp.type === 'tracked');
                if (!mire || !mire.track.boxes.includes('marked')) {
                    throw new Error('clear-mire reward requires a tracked mire with at least one marked box.');
                }
            }
            else if (reward.kind === 'minor-milestone') {
                const allowance = ext(state).milestoneAllowance ?? { minorThisSession: 0, majorThisArc: 0 };
                if (allowance.minorThisSession >= 1) {
                    throw new Error('Minor milestone session limit already reached.');
                }
                const milestoneId = reward.milestoneId ?? `${command.tournamentId}-${command.boutId}-milestone`;
                if (character.advancement.some(entry => entry.id === milestoneId)) {
                    throw new Error(`Duplicate milestone ID: ${milestoneId}.`);
                }
            }
            else if (reward.kind === 'rumor') {
                const resourceId = reward.resourceId ?? `${command.tournamentId}-${command.boutId}-rumor`;
                if (character.resources.some(r => r.id === resourceId)) {
                    throw new Error(`Duplicate resource ID: ${resourceId}.`);
                }
            }
            else {
                throw new Error('Unsupported yieldDriveReward kind.');
            }
        }
        if (seraEntrant !== null) {
            if (command.winner !== undefined && command.winner !== opponentEntrant) {
                throw new Error('When Sera yields a bout, her opponent is the winner.');
            }
            winner = opponentEntrant;
        }
        else {
            if (command.winner !== bout.entrantA && command.winner !== bout.entrantB) {
                throw new Error('Specify a valid entrant as winner.');
            }
            winner = command.winner;
        }
    }
    else if (command.method === 'offscreen') {
        if (command.yieldDriveReward !== undefined) {
            throw new Error('yieldDriveReward is only allowed when method is yield.');
        }
        if (command.winner !== undefined) {
            if (command.winner !== bout.entrantA && command.winner !== bout.entrantB) {
                throw new Error('Winner must be one of the bout entrants.');
            }
            winner = command.winner;
        }
        else {
            offscreenRoll = rollValidD6(die);
            winner = offscreenRoll >= 4 ? bout.entrantA : bout.entrantB;
        }
    }
    else {
        if (command.yieldDriveReward !== undefined) {
            throw new Error('yieldDriveReward is only allowed when method is yield.');
        }
        if (command.winner !== undefined) {
            if (command.winner !== bout.entrantA && command.winner !== bout.entrantB) {
                throw new Error('Winner must be one of the bout entrants.');
            }
            winner = command.winner;
        }
        else if (seraEntrant !== null) {
            winner = seraEntrant;
        }
        else {
            throw new Error('Specify the winner of the bout.');
        }
    }
    const seraLostThisBout = seraEntrant !== null && winner !== seraEntrant;
    const roundBouts = tournament.bouts
        .filter(b => b.round === tournament.round)
        .map(b => b.id === bout.id ? { ...b, winner } : b);
    const roundComplete = roundBouts.every(b => b.winner !== null);
    const seraStillInBracket = !seraLostThisBout
        && (!roundComplete || roundBouts.some(b => b.winner !== null && isSeraEntrant(state, b.winner)));
    let nextRound = tournament.round;
    const nextRoundBouts = [];
    let statusAfter = seraLostThisBout ? 'eliminated' : 'active';
    let interludeTasksAfter = seraLostThisBout ? 0 : tournament.interludeTasksRemaining;
    if (roundComplete) {
        if (tournament.round === 3) {
            statusAfter = seraStillInBracket ? 'completed' : 'eliminated';
            interludeTasksAfter = 0;
        }
        else {
            nextRound = (tournament.round + 1);
            for (let i = 0; i < roundBouts.length; i += 2) {
                nextRoundBouts.push({
                    id: `r${nextRound}-b${i / 2 + 1}`,
                    round: nextRound,
                    entrantA: roundBouts[i].winner,
                    entrantB: roundBouts[i + 1].winner,
                    winner: null,
                    method: null,
                    note: '',
                });
            }
            if (seraStillInBracket) {
                statusAfter = 'active';
                interludeTasksAfter = 2;
            }
            else {
                statusAfter = 'eliminated';
                interludeTasksAfter = 0;
            }
        }
    }
    return {
        kind: 'tournament-bout-resolved',
        command: structuredClone(command),
        winner,
        offscreenRoll,
        nextRound,
        nextRoundBouts,
        statusAfter,
        interludeTasksAfter,
    };
}
export function applyTournamentBout(state, event) {
    if (!event || event.kind !== 'tournament-bout-resolved') {
        throw new Error('Invalid tournament-bout-resolved event.');
    }
    const sequence = event.offscreenRoll !== null && event.offscreenRoll !== undefined ? [event.offscreenRoll] : [];
    let idx = 0;
    const expected = decideTournamentBout(state, event.command, () => sequence[idx++]);
    if (idx !== sequence.length || !sameValue(event, expected)) {
        throw new Error('Recorded tournament-bout-resolved event disagrees with state.');
    }
    const tournament = ensureEncounters(state).tournaments.find(t => t.id === event.command.tournamentId);
    const bout = tournament.bouts.find(b => b.id === event.command.boutId && b.round === tournament.round);
    bout.winner = event.winner;
    bout.method = event.command.method;
    bout.note = event.command.note;
    tournament.round = event.nextRound;
    if (event.nextRoundBouts.length > 0) {
        tournament.bouts.push(...structuredClone(event.nextRoundBouts));
    }
    tournament.status = event.statusAfter;
    tournament.interludeTasksRemaining = event.interludeTasksAfter;
    if (event.command.yieldDriveReward !== undefined) {
        const reward = event.command.yieldDriveReward;
        const character = state.characters.find(c => c.id === state.playerCharacterId);
        if (reward.kind === 'rumor') {
            character.resources.push({
                id: reward.resourceId ?? `${event.command.tournamentId}-${event.command.boutId}-rumor`,
                name: reward.resourceName ?? `Tournament rumor (${event.command.note})`,
                kind: 'Rumor',
                tags: [],
                source: `Tournament yield (${tournament.name})`,
            });
        }
        else if (reward.kind === 'clear-mire') {
            const mire = character.impulses.find((imp) => imp.id === reward.mireId && imp.type === 'tracked');
            const markedIndex = mire.track.boxes.lastIndexOf('marked');
            if (markedIndex !== -1)
                mire.track.boxes[markedIndex] = 'clear';
        }
        else if (reward.kind === 'minor-milestone') {
            character.advancement.push({
                id: reward.milestoneId ?? `${event.command.tournamentId}-${event.command.boutId}-milestone`,
                name: reward.milestoneName ?? event.command.note,
                type: 'milestone',
                kind: 'minor',
                spentOn: null,
            });
            const s = ext(state);
            s.milestoneAllowance ??= { minorThisSession: 0, majorThisArc: 0 };
            s.milestoneAllowance.minorThisSession += 1;
        }
    }
    return state;
}
export function decideTournamentInterlude(state, command) {
    if (!command || command.kind !== 'spend-tournament-interlude'
        || !nonEmptyText(command.tournamentId) || !nonEmptyText(command.note)) {
        throw new Error('Invalid spend-tournament-interlude command.');
    }
    const tournament = getEncounters(state).tournaments.find(t => t.id === command.tournamentId);
    if (!tournament) {
        throw new Error(`Tournament not found: ${command.tournamentId}.`);
    }
    if (tournament.status !== 'active') {
        throw new Error(`Tournament ${command.tournamentId} is not active.`);
    }
    if (tournament.interludeTasksRemaining <= 0) {
        throw new Error('No tournament interlude tasks remaining.');
    }
    return {
        kind: 'tournament-interlude-spent',
        tournamentId: command.tournamentId,
        note: command.note,
        remainingAfter: tournament.interludeTasksRemaining - 1,
    };
}
export function applyTournamentInterlude(state, event) {
    if (!event || event.kind !== 'tournament-interlude-spent') {
        throw new Error('Invalid tournament-interlude-spent event.');
    }
    const expected = decideTournamentInterlude(state, {
        kind: 'spend-tournament-interlude',
        tournamentId: event.tournamentId,
        note: event.note,
    });
    if (!sameValue(event, expected)) {
        throw new Error('Recorded tournament-interlude-spent event disagrees with state.');
    }
    const tournament = ensureEncounters(state).tournaments.find(t => t.id === event.tournamentId);
    tournament.interludeTasksRemaining = event.remainingAfter;
    return state;
}
export function projectEncounters(state) {
    return structuredClone(getEncounters(state));
}
export { decideAddKeeperSecret as addKeeperSecret, decideRevealKeeperSecret as revealKeeperSecret, projectKeeperSecrets as projectKeeper, decideStartHazard as startHazard, decideMarkHazard as markHazard, decideMayflyRoll as rollMayflyFight, decideStartDungeonRun as startDungeonRun, decideDungeonLeg as resolveDungeonLeg, decideRiftPressure as markRiftPressure, decideStartTournament as startTournament, decideTournamentBout as resolveTournamentBout, decideTournamentInterlude as spendTournamentInterlude, };
