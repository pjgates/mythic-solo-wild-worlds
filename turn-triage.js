import { FATE_ODDS, KIND_DEFINITIONS, RULES_TEXT, readTurnDecision, TurnDecisionError, turnDecisionPrompt, unusableReason } from "./turn-decision.js";
import { activeClassBonuses } from "./game/minor-character/sheet.js";
const KINDS = Object.keys(KIND_DEFINITIONS);
const SUM_TOLERANCE = 0.02;
const invalid = (reason) => new TurnDecisionError(`Jev returned an unusable triage reading: ${reason}`);
const isKind = (value) => KINDS.includes(value);
const isUnit = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const ODDS_PHRASES = {
    certain: 'a yes is all but guaranteed',
    'nearly-certain': 'a yes with only a sliver of doubt',
    'very-likely': 'a yes most of the time',
    likely: 'a yes more often than not',
    'fifty-fifty': 'as likely yes as no',
    unlikely: 'a no more often than not',
    'very-unlikely': 'a no most of the time',
    'nearly-impossible': 'a no with only a sliver of hope',
    impossible: 'a no is all but guaranteed',
};
/** The fixed triage questions (spec §5.1); the kind criteria are the prompt's own definitions. */
export function triageQuestions() {
    return {
        kind: { type: 'choice', instructions: 'Which kind best describes the player message?', criteria: { ...KIND_DEFINITIONS } },
        odds: { type: 'choice', instructions: 'If the message is a question to the world, how likely is a yes?',
            criteria: Object.fromEntries(FATE_ODDS.map(odds => [odds, ODDS_PHRASES[odds]])) },
    };
}
/** Strict reading of the two answers (spec §5.1): anything off-shape is a triage failure, never repaired. */
export function readTriage(answers) {
    const kind = answers.kind, odds = answers.odds;
    if (kind?.type !== 'choice')
        throw invalid('no kind choice.');
    if (!isKind(kind.choice))
        throw invalid(`unknown kind ${JSON.stringify(kind.choice)}.`);
    if (!isUnit(kind.confidence))
        throw invalid('confidence must be between 0 and 1.');
    const given = Object.keys(kind.probabilities);
    if (given.length !== KINDS.length || !KINDS.every(name => isUnit(kind.probabilities[name])))
        throw invalid('probabilities must cover exactly the five kinds.');
    const probabilities = Object.fromEntries(KINDS.map(name => [name, kind.probabilities[name]]));
    const sum = KINDS.reduce((total, name) => total + probabilities[name], 0);
    if (Math.abs(sum - 1) > SUM_TOLERANCE)
        throw invalid('probabilities must sum to 1.');
    if (odds?.type !== 'choice')
        throw invalid('no odds choice.');
    if (!FATE_ODDS.includes(odds.choice))
        throw invalid(`odds must be one of ${FATE_ODDS.join(', ')}.`);
    return { kind: kind.choice, confidence: kind.confidence, probabilities, odds: odds.choice };
}
/**
 * Spec §5.2 thresholds on the top kind probability. Confirmed by the 20 October 2026 calibration run (Jev 1.14, 23/23
 * twice): `docs/references/2026-10-20-jev-1.14-decide-bench.md` (§Results, "top p") is the table they are checked against.
 */
export const TRIAGE_THRESHOLDS = { act: 0.85, unsure: 0.60 };
/** Spec §5.2: a kind at or above `act` routes by itself; a narrative/action split at or above `unsure` is an unclear action; the rest asks. */
export function routeTriage(reading) {
    const ranked = KINDS.map(kind => ({ kind, p: reading.probabilities[kind] })).sort((a, b) => b.p - a.p);
    const [top, second] = ranked;
    const unclear = { kind: 'unclear', probabilities: reading.probabilities };
    if (top.p >= TRIAGE_THRESHOLDS.act) {
        switch (top.kind) {
            case 'narrative': return { kind: 'narrative' };
            case 'question': return { kind: 'question', odds: reading.odds };
            case 'rules': return { kind: 'rules' };
            case 'action': return { kind: 'action', clear: true };
            case 'unclear': return unclear;
            default: {
                const exhaustive = top.kind;
                throw new Error(`Unknown kind ${String(exhaustive)}`);
            }
        }
    }
    const pair = [top.kind, second.kind];
    if (top.p >= TRIAGE_THRESHOLDS.unsure && pair.includes('narrative') && pair.includes('action'))
        return { kind: 'action', clear: false };
    return unclear;
}
export const DECLARATION_FIELDS = ['edge', 'skill', 'difficulty', 'rankGap', 'baseImpact', 'harmOnConflict', 'harmOnDisaster', 'recipient'];
/** The Edge table of `docs/minor-character/rulebook.md` (Wild Words p.80); an Edge not in it is described by its name. */
const EDGE_APPROACHES = {
    Grace: 'elegance, precision, agility: dodging, balance, light weapons',
    Iron: 'force and will: enduring, staying calm, imposing yourself, heavy blows',
    Instinct: 'sense and reaction: surprises, reading surroundings, the uncanny',
    Sharps: 'logic and wit: solving, designing, arguing',
    Teeth: 'savagery and passion: fear, breaking things, brutal attacks',
    Tides: 'exploration and lore: secrets, stories, navigation',
    Veils: 'shadows and secrecy: stealth, deceit, manipulation',
};
const DIFFICULTY_NAMES = ['ordinary', 'hard', 'desperate'];
const DIFFICULTY_LADDER = { 0: DIFFICULTY_NAMES[0], 1: `${DIFFICULTY_NAMES[1]} (unusual approach, bad environment, impaired by injury)`, 2: DIFFICULTY_NAMES[2] };
const RANK_GAP_LADDER = { 0: 'none, or equal rank', 1: 'one rank above', 2: 'two ranks above' };
const IMPACT_LADDER = { Low: 'one fewer box', Normal: 'one box', High: 'one extra box', Massive: 'the whole track; siege-scale permission' };
const HARM_LADDER = { 0: 'no harm: the fiction does not threaten the character', 1: 'Low: 1 mark', 2: 'Normal: 2 marks', 3: 'High: 3 marks', 4: 'Extreme: 4 marks' };
const stringKeys = (ladder) => Object.fromEntries(Object.entries(ladder).map(([key, phrase]) => [String(key), phrase]));
const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
/** The second decisions request of spec §10: one choice per part, every option list taken from the live sheet. */
export function declarationQuestions(sheet) {
    const bonuses = activeClassBonuses(sheet);
    const ranks = {};
    for (const [name, rank] of Object.entries(sheet.skills))
        ranks[`skill:${name}`] = `${name}, skill rank ${rank}${bonuses[name] ? ` (+${bonuses[name]} class competence)` : ''}`;
    for (const [name, rank] of Object.entries(sheet.lores))
        ranks[`lore:${name}`] = `${name}, lore rank ${rank}`;
    const harm = stringKeys(HARM_LADDER);
    return {
        edge: choice('Which Edge fits how the character approaches this? One Edge per roll, or none.', { ...Object.fromEntries(sheet.edges.map(edge => [edge, EDGE_APPROACHES[edge] ?? edge])), none: 'no Edge fits the approach' }),
        skill: choice(`Which Skill or Lore does the attempt use? ${RULES_TEXT.names}`, { ...ranks, none: 'untrained: no Skill or Lore fits' }),
        difficulty: choice(RULES_TEXT.difficulty, stringKeys(DIFFICULTY_LADDER)),
        rankGap: choice(RULES_TEXT.rankGap, stringKeys(RANK_GAP_LADDER)),
        baseImpact: choice('Base impact of success: how much of the target track a Triumph marks.', { ...IMPACT_LADDER }),
        harmOnConflict: choice(`Harm the character takes on a Conflict. ${RULES_TEXT.harm}`, harm),
        harmOnDisaster: choice(`Harm the character takes on a Disaster. ${RULES_TEXT.harm}`, harm),
        recipient: choice(RULES_TEXT.recipient, {
            ...Object.fromEntries(sheet.aspects.map(aspect => [aspect.id, `${aspect.name} (${aspect.type}), ${aspect.track.boxes.filter(box => box === 'clear').length} clear boxes`])),
            direct: 'direct injury: no aspect absorbs the harm'
        }),
    };
}
const PROPOSED_READING = 'Jev proposed the mechanics; describe the stakes.';
const DESCRIPTION_CHARS = 200;
const invalidDeclaration = (reason) => new TurnDecisionError(`Jev returned an unusable declaration: ${reason}`);
/** `Edge Veils`, `Lore Academy Code`, `Harm to The Cub`: the chosen option in the card's own words. */
function describeChoice(field, choice, sheet) {
    switch (field) {
        case 'edge': return choice === 'none' ? 'No Edge' : `Edge ${choice}`;
        case 'skill': {
            if (choice === 'none')
                return 'Untrained';
            const [kind, ...name] = choice.split(':');
            return `${kind === 'lore' ? 'Lore' : 'Skill'} ${name.join(':')}`;
        }
        case 'difficulty': return `Difficulty ${DIFFICULTY_NAMES[Number(choice)] ?? choice}`;
        case 'rankGap': return `Rank gap ${choice}`;
        case 'baseImpact': return `Impact ${choice}`;
        case 'harmOnConflict': return `Harm ${choice} on Conflict`;
        case 'harmOnDisaster': return `Harm ${choice} on Disaster`;
        case 'recipient': return choice === 'direct' ? `Harm to ${sheet.name} directly` : `Harm to ${sheet.aspects.find(aspect => aspect.id === choice)?.name ?? choice}`;
        default: {
            const exhaustive = field;
            throw new Error(`Unknown declaration field ${String(exhaustive)}`);
        }
    }
}
/**
 * Spec §10: Jev's choices become an `action` decision with the player's own text and empty stakes, validated by the
 * same strict reader as a draft so one validator rules. Clear only when Jev was sure of every part and of the kind.
 */
export function readDeclarationAnswers(answers, playerText, sheet, triage) {
    const chosen = {};
    for (const field of DECLARATION_FIELDS) {
        const answer = answers[field];
        if (answer?.type !== 'choice')
            throw invalidDeclaration(`no ${field} choice.`);
        chosen[field] = { choice: answer.choice, p: answer.probabilities[answer.choice] ?? answer.confidence };
    }
    const route = routeTriage(triage);
    const clear = route.kind === 'action' && route.clear && DECLARATION_FIELDS.every(field => chosen[field].p >= TRIAGE_THRESHOLDS.act);
    const [skillKind, ...skillName] = chosen.skill.choice.split(':');
    const raw = {
        kind: 'action', reading: PROPOSED_READING, clear,
        reasons: DECLARATION_FIELDS.map(field => `${describeChoice(field, chosen[field].choice, sheet)} (${chosen[field].p.toFixed(2)})`),
        action: {
            description: playerText.trim().slice(0, DESCRIPTION_CHARS).trim(),
            edge: chosen.edge.choice === 'none' ? null : chosen.edge.choice,
            skill: chosen.skill.choice === 'none' ? null : { kind: skillKind, name: skillName.join(':') },
            advantageSources: [], difficulty: Number(chosen.difficulty.choice), rankGap: Number(chosen.rankGap.choice), mires: [],
            baseImpact: chosen.baseImpact.choice,
            stakes: { narrative: '', harm: { onConflict: Number(chosen.harmOnConflict.choice), onDisaster: Number(chosen.harmOnDisaster.choice),
                    targetAspectId: chosen.recipient.choice === 'direct' ? null : chosen.recipient.choice, overflowChoice: 'injury' } },
        },
    };
    let decision;
    try {
        decision = readTurnDecision(raw, sheet);
    }
    catch (error) {
        throw error instanceof TurnDecisionError ? invalidDeclaration(unusableReason(error)) : error;
    }
    if (decision.kind !== 'action')
        throw invalidDeclaration('not an action.');
    return decision;
}
/** The decide prompt's two messages, verbatim, as the decisions `state`. */
export function triageState(input) {
    const [system, user] = turnDecisionPrompt(input);
    return { system: system.content, user: user.content };
}
/** One triage call per turn: transport failures surface as `JevFailure`, unreadable answers as `TurnDecisionError`. */
export class TriageModel {
    #client;
    constructor(client) {
        this.#client = client;
    }
    async read(input, signal) {
        const result = await this.#client.decide(triageState(input), triageQuestions(), signal);
        return { model: result.model, ...readTriage(result.answers) };
    }
    /** Spec §10: the second call for an action with no draft connection; the state carries the settled kind as the draft's would. */
    async propose(input, triage, signal) {
        const settled = { ...input, triage: { kind: 'action', confidence: triage.confidence } };
        const result = await this.#client.decide(triageState(settled), declarationQuestions(input.sheet), signal);
        return readDeclarationAnswers(result.answers, input.playerText, input.sheet, triage);
    }
}
