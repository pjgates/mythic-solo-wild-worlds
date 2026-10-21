import { DecideFailure } from "./decide-model.js";
import { JevFailure } from "./jev-client.js";
import { classifyProposal, FATE_ODDS, TurnDecisionError } from "./turn-decision.js";
import { routeTriage } from "./turn-triage.js";
import { describeKind } from "./game/minor-character/proposals.js";
const RECENT_MESSAGES = 6, RECENT_CHARS = 600;
const NARRATE_HINT = 'Send an empty message to narrate.';
const UNREAD_AFTER_DRAFT_FAILURE = 'Narrated without mechanics after the draft role failed.';
const UNREAD_AFTER_TRIAGE_FAILURE = 'Narrated without mechanics after the triage role failed.';
const confidenceOf = (reading) => reading.confidence.toFixed(2);
const journalTriage = (reading) => ({ model: reading.model, kind: reading.kind, confidence: reading.confidence, probabilities: { ...reading.probabilities } });
/** The narrative/action split (§5.2) is never clear-cut, whichever role fills in the shape, so the policy always pauses. */
const neverClear = (decision, clear) => clear ? decision : { ...decision, clear: false };
/**
 * Spec §4: one player message, read once. Clear rulings roll in code and let generation proceed with the receipt in the
 * narrator's prompt; everything else pauses on the card with explicit choices. Regenerate, continue, swipes and quiet
 * generations never reach the decide role.
 */
export class TurnFlow {
    #host;
    #turn;
    /** Cancels the Jev requests of the turn being read; a turn that is forgotten takes its requests with it. */
    #abort;
    constructor(host) { this.#host = host; }
    /** The chat changed or reloaded: nothing shown belongs to the new latest message. */
    reset() { this.#forget(); }
    /** What the card shows for the current latest message. */
    get card() {
        if (this.#turn && this.#turn.anchor !== this.#anchor())
            this.#forget();
        const turn = this.#turn;
        if (!turn)
            return this.#idle();
        const { controller } = this.#host;
        switch (turn.stage) {
            case 'reading': return { message: 'Reading your message…', busy: true };
            case 'asking': return { message: 'Asking the oracle…', busy: true };
            case 'checking': return { message: 'Checking the scene…', busy: true };
            case 'failed': {
                const triaged = turn.failed === 'triage';
                return { message: turn.message, choices: [
                        { label: 'Retry', run: () => this.#retry() },
                        // Spec §5.5: the player may send the message to the draft instead; the flow never does so on its own.
                        ...(triaged && this.#host.decide.configured ? [{ label: 'Read with the draft connection', run: () => this.#readWithDraft(turn) }] : []),
                        ...(triaged ? [{ label: 'Declare manually', run: () => this.#declare() }] : []),
                        { label: 'Narrate without mechanics', run: () => this.#narrateUnread() },
                    ] };
            }
            case 'question': {
                const fate = turn.fate;
                const choices = [];
                if (this.#host.mythic.present)
                    choices.push({ label: 'Ask the oracle', run: () => this.#askOracle(turn) });
                choices.push({ label: this.#host.mythic.present ? 'Narrate without the oracle' : 'Narrate', run: () => this.#narrate() });
                return { message: turn.message, choices: controller.canGenerate ? choices : [],
                    fate: { question: fate.question, odds: fate.odds, options: FATE_ODDS,
                        select: (odds, question) => { fate.odds = odds; if (question !== undefined)
                            fate.question = question; } } };
            }
            case 'handled': return controller.canGenerate
                ? { message: turn.message, choices: [...this.#sheetChoice(turn), { label: turn.narrateLabel, run: () => turn.unreadNote ? this.#narrateUnread() : this.#narrate() }],
                    ...this.#sceneEntry() }
                : { message: turn.pendingMessage ?? turn.message, choices: [] };
            case 'disagreement': return { message: turn.message, choices: [
                    { label: 'Declare an action', run: () => this.#declare() },
                    { label: 'Narrate as written', run: () => this.#narrateUnread() },
                    { label: 'Retry', run: () => this.#retry() },
                ] };
            case 'unsure': {
                const choices = [{ label: 'Declare an action', run: () => this.#declare() }];
                if (this.#host.mythic.present)
                    choices.push({ label: 'Ask the oracle', run: () => this.#askUnsure(turn) });
                choices.push({ label: 'Narrate as written', run: () => this.#narrateUnread() });
                return { message: turn.message, choices };
            }
            default: {
                const exhaustive = turn.stage;
                throw new Error(`Unknown turn stage ${String(exhaustive)}`);
            }
        }
    }
    /** Called from the generation interceptor after the ordinary admission checks; false aborts this generation. */
    async intercept(type) {
        const { controller } = this.#host;
        const view = controller.playerView;
        if (!view || type !== 'normal')
            return true;
        const messages = this.#host.messages();
        const index = messages.length - 1, last = messages[index];
        const anchor = this.#anchor();
        if (this.#turn && this.#turn.anchor !== anchor)
            this.#forget();
        if (!last?.is_user || last.is_system)
            return true;
        const { triage, decide } = this.#host;
        const triaged = triage.configured;
        if (!this.#host.settings().assisted || (!triaged && !decide.configured))
            return true;
        let context;
        try {
            context = await this.#host.capture(view.context);
        }
        catch {
            return true;
        }
        if (this.#turn?.stage === 'question' || this.#turn?.stage === 'asking')
            return false;
        if (this.#recorded(view, context)) {
            // Narrating a settled turn: the narrator must read what the card recorded since the last projection.
            this.#host.project();
            this.#turn = undefined;
            this.#host.changed();
            return true;
        }
        const input = { playerText: last.mes ?? '', recent: recent(messages, index), sheet: view.sheet, scene: { id: view.play.scene.id } };
        this.#turn = { anchor, stage: 'reading', message: '', narrateLabel: 'Narrate' };
        this.#host.changed();
        return triaged ? this.#triage(anchor, input, this.#begin()) : this.#draft(anchor, input);
    }
    /** Spec §5.2: one triage call, then route; only `rules` and `action` reach the draft, and then with the kind settled. */
    async #triage(anchor, input, signal) {
        let reading;
        try {
            reading = await this.#host.triage.read(input, signal);
        }
        catch (error) {
            if (signal.aborted)
                return false;
            return this.#fail(anchor, roleFailure('triage', error), { failed: 'triage', input, unreadNote: UNREAD_AFTER_TRIAGE_FAILURE });
        }
        const fresh = this.#current(anchor);
        if (!fresh)
            return false;
        const route = routeTriage(reading);
        try {
            switch (route.kind) {
                case 'narrative':
                    await this.#record(fresh, 'narrative', `Jev read this as narrative (${confidenceOf(reading)}).`, reading);
                    this.#turn = undefined;
                    this.#host.changed();
                    return true;
                case 'question':
                    await this.#record(fresh, 'question', input.playerText, reading);
                    return this.#askQuestion(anchor, input.playerText, route.odds);
                case 'rules':
                    if (this.#host.decide.configured)
                        return this.#draft(anchor, input, { reading, kind: 'rules', clear: true });
                    await this.#record(fresh, 'rules', 'Jev read this as a rules question.', reading);
                    return this.#pause(anchor, 'Rules question. Open the sheet for ranks and boxes, or send it to the narrator.', 'Send to the narrator anyway', { openSheet: true });
                case 'action':
                    if (this.#host.decide.configured)
                        return this.#draft(anchor, input, { reading, kind: 'action', clear: route.clear });
                    return this.#propose(anchor, input, reading, route.clear, signal);
                case 'unclear': {
                    const spread = topTwo(route.probabilities);
                    this.#turn = { anchor, stage: 'unsure', message: `I can't tell whether that needs a roll. Jev read ${spread}.`, narrateLabel: 'Narrate as written',
                        input, reading, unreadNote: `Narrated as written: Jev could not tell whether it needed a roll (${spread}).`,
                        declareNote: `Jev was unsure (${spread}); declared manually.` };
                    this.#host.changed();
                    return false;
                }
                default: {
                    const exhaustive = route;
                    throw new Error(`Unknown route ${String(exhaustive)}`);
                }
            }
        }
        catch (error) {
            return this.#fail(anchor, `The decision could not be recorded: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /** Today's draft path (the spec's draft role). With `settled`, the kind comes from triage and a different kind back is a disagreement (§5.3). */
    async #draft(anchor, input, settled) {
        let decision;
        try {
            decision = await this.#host.decide.decide(settled ? { ...input, triage: { kind: settled.kind, confidence: settled.reading.confidence } } : input);
        }
        catch (error) {
            return this.#fail(anchor, roleFailure('draft', error), { failed: 'draft' });
        }
        const fresh = this.#current(anchor);
        if (!fresh)
            return false;
        const reading = settled?.reading;
        if (settled && decision.kind !== settled.kind) {
            // Spec §5.3: neither model overrides the other into an automatic resolution; disagreement is ambiguity.
            const message = `Jev read this as ${describeKind(settled.kind)}; the draft connection read it as ${describeKind(decision.kind)}.`;
            this.#turn = { anchor, stage: 'disagreement', message, narrateLabel: 'Narrate as written', input, reading, unreadNote: `Narrated as written: ${message}`,
                declareNote: `Jev read this as ${describeKind(settled.kind)} (${confidenceOf(settled.reading)}); declared manually after a disagreement.` };
            this.#host.changed();
            return false;
        }
        try {
            switch (decision.kind) {
                case 'narrative':
                    await this.#record(fresh, 'narrative', decision.note, reading);
                    this.#turn = undefined;
                    this.#host.changed();
                    return true;
                case 'rules':
                    await this.#record(fresh, 'rules', decision.answer, reading);
                    return this.#pause(anchor, decision.answer, 'Narrate anyway');
                case 'unclear':
                    await this.#record(fresh, 'unclear', decision.note, reading);
                    return this.#pause(anchor, `Not read as a roll${decision.note.trim() ? `: ${decision.note.trim()}` : ''}. Narrate without mechanics, or declare an action.`, 'Narrate without mechanics');
                case 'question':
                    await this.#record(fresh, 'question', decision.question, reading);
                    return this.#askQuestion(anchor, decision.question, decision.odds);
                case 'action': return this.#settleAction(anchor, fresh, input, neverClear(decision, settled?.clear ?? true), reading);
                default: {
                    const exhaustive = decision;
                    throw new Error(`Unknown decision ${String(exhaustive)}`);
                }
            }
        }
        catch (error) {
            return this.#fail(anchor, `The decision could not be recorded: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /** Spec §10: no draft connection, so Jev proposes the mechanics; the empty stakes make the policy pause every time. */
    async #propose(anchor, input, reading, clear, signal) {
        let decision;
        try {
            decision = await this.#host.triage.propose(input, reading, signal);
        }
        catch (error) {
            if (signal.aborted)
                return false;
            const read = `Jev read this as ${clear ? 'an action' : 'a possible action'} (${confidenceOf(reading)}) but could not propose the mechanics`;
            return this.#fail(anchor, roleFailure('triage', error), { failed: 'triage', input, reading,
                unreadNote: `Narrated without mechanics: ${read}.`, declareNote: `${read}; declared manually.` });
        }
        const fresh = this.#current(anchor);
        if (!fresh)
            return false;
        try {
            return await this.#settleAction(anchor, fresh, input, neverClear(decision, clear), reading);
        }
        catch (error) {
            return this.#fail(anchor, `The decision could not be recorded: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /** Spec §4: a clear ruling rolls in code; anything else is saved as a proposal the card shows with its reasons. */
    async #settleAction(anchor, fresh, input, decision, reading) {
        const { controller } = this.#host;
        const policy = classifyProposal(decision, fresh.sheet, { confirmAlways: this.#host.settings().confirmAlways,
            injuryCut: controller.manaStrainCut(decision.declaration.skill) });
        if (policy.verdict === 'auto') {
            await controller.submitAction({ ...await this.#host.capture(fresh.context), action: decision.declaration });
            this.#host.project();
            if (controller.canGenerate) {
                this.#turn = undefined;
                this.#host.changed();
                return true;
            }
            return this.#pause(anchor, '', 'Narrate', { pendingMessage: 'Record the consequences, then narrate.' });
        }
        await controller.saveProposal(await this.#host.capture(fresh.context), { playerText: input.playerText, reading: decision.reading,
            reasons: [...decision.reasons, ...policy.reasons], declaration: decision.declaration, ...(reading ? { triage: journalTriage(reading) } : {}) });
        return this.#pause(anchor, '', 'Narrate');
    }
    /** The player turns an unsure reading into a Fate Check: the message itself is the question, at the odds Jev already gave. */
    async #askUnsure(turn) {
        const view = this.#host.controller.playerView;
        if (!view || !turn.input || !turn.reading || this.#turn !== turn)
            return;
        await this.#record(view, 'question', turn.input.playerText, turn.reading);
        this.#askQuestion(turn.anchor, turn.input.playerText, turn.reading.odds);
    }
    #askQuestion(anchor, question, odds) {
        this.#turn = { anchor, stage: 'question', narrateLabel: 'Narrate', fate: { question, odds },
            message: this.#host.mythic.present ? `Oracle question: ${question}` : `Oracle question: ${question} Mythic GME is not loaded, so the narrator answers it.` };
        this.#host.changed();
        return false;
    }
    async #record(view, kind, note, reading) {
        await this.#host.controller.recordTurn(await this.#host.capture(view.context), kind, note, reading && journalTriage(reading));
    }
    /** Nothing pending for the latest message: the scene boundary is the only live choice (design §6). */
    #idle() {
        const { controller, mythic } = this.#host;
        if (!controller.playerView || !controller.canGenerate)
            return {};
        const flow = this.#sceneEntry();
        if (mythic.present && mythic.sceneUnchecked) {
            flow.message = 'A new Mythic scene opens: roll its Scene Check before narrating.';
            flow.choices = [{ label: 'Scene check', run: () => this.#checkScene() }];
        }
        return flow;
    }
    /** The manual way out a handled rules reading offers first: the sheet, when the host can show it. */
    #sheetChoice(turn) {
        const openSheet = this.#host.openSheet;
        return turn.openSheet && openSheet ? [{ label: 'Open the sheet', run: async () => { openSheet(); } }] : [];
    }
    #sceneEntry() {
        const endScene = this.#host.endScene;
        return endScene ? { expandedChoices: [{ label: 'End scene…', run: async () => { endScene(); } }] } : {};
    }
    async #checkScene() {
        const anchor = this.#anchor();
        this.#turn = { anchor, stage: 'checking', message: '', narrateLabel: 'Narrate the new scene' };
        this.#host.changed();
        try {
            const summary = await this.#host.mythic.sceneCheck();
            this.#host.project();
            if (this.#anchor() !== anchor) {
                this.#turn = undefined;
                this.#host.changed();
                return;
            }
            this.#turn = { anchor, stage: 'handled', message: summary, narrateLabel: 'Narrate the new scene' };
            this.#host.changed();
        }
        catch (error) {
            this.#turn = undefined;
            this.#host.changed();
            throw error;
        }
    }
    #anchor() {
        const messages = this.#host.messages();
        return `${this.#host.controller.state.binding}:${messages.length - 1}`;
    }
    /** Nothing shown belongs to the latest message any more: drop the turn and cancel the Jev request it was waiting on. */
    #forget() {
        this.#abort?.abort();
        this.#abort = undefined;
        this.#turn = undefined;
    }
    /** A new read starts: whatever the previous one was still waiting on is no longer wanted. */
    #begin() {
        this.#abort?.abort();
        this.#abort = new AbortController();
        return this.#abort.signal;
    }
    /** The message is settled: the card shows what was recorded and waits for the player to narrate. */
    #pause(anchor, message, narrateLabel, extra = {}) {
        this.#turn = { anchor, stage: 'handled', message, narrateLabel, ...extra };
        this.#host.changed();
        return false;
    }
    /** The view the turn was read against, if the chat still ends on the same message; otherwise the turn is dropped. */
    #current(anchor) {
        const fresh = this.#host.controller.playerView;
        if (fresh && this.#anchor() === anchor)
            return fresh;
        if (this.#turn?.anchor === anchor) {
            this.#turn = undefined;
            this.#host.changed();
        }
        return undefined;
    }
    #fail(anchor, message, extra = {}) {
        this.#turn = { anchor, stage: 'failed', message, narrateLabel: 'Narrate', ...extra };
        this.#host.changed();
        return false;
    }
    /** Narrates now; a host without generate() gets a handled card telling the player to send an empty message instead. */
    async #generate(turn) {
        if (this.#host.generate) {
            await this.#host.generate();
            return;
        }
        if (this.#turn !== turn)
            this.#turn = { anchor: turn.anchor, stage: 'handled', message: '', narrateLabel: 'Narrate' };
        this.#turn.message = NARRATE_HINT;
        this.#host.changed();
    }
    async #retry() {
        const turn = this.#turn;
        if (!turn)
            return;
        this.#turn = undefined;
        this.#host.changed();
        await this.#generate(turn);
    }
    /** After a triage failure the player chose the draft: today's path for the same message, then narrate if it settled the turn. */
    async #readWithDraft(turn) {
        if (!turn.input || this.#turn !== turn)
            return;
        turn.stage = 'reading';
        this.#host.changed();
        if (await this.#draft(turn.anchor, turn.input))
            await this.#generate(turn);
    }
    /**
     * The player declares by hand. An unrecorded reading is recorded first as `unclear`, so the message is not read again
     * and the card and history keep what Jev said; a failed triage has no reading and records nothing. Then the form opens.
     */
    async #declare() {
        const turn = this.#turn;
        if (!turn)
            return;
        if (turn.reading && turn.declareNote) {
            const view = this.#host.controller.playerView;
            if (view && !this.#recorded(view, await this.#host.capture(view.context)))
                await this.#record(view, 'unclear', turn.declareNote, turn.reading);
        }
        this.#host.declare?.();
        this.#turn = undefined;
        this.#host.changed();
    }
    #recorded(view, context) {
        return view.turns.some(t => t.messageId === context.source.messageId && t.messageRevision === context.source.messageRevision);
    }
    /** The message has no decision yet (a failure, or a reading the player chose not to act on): narrate it as plain fiction and say so in the journal. */
    async #narrateUnread() {
        const turn = this.#turn;
        if (!turn)
            return;
        const view = this.#host.controller.playerView;
        if (!view)
            return;
        const context = await this.#host.capture(view.context);
        if (!this.#recorded(view, context)) {
            await this.#host.controller.recordTurn(context, 'narrative', turn.unreadNote ?? UNREAD_AFTER_DRAFT_FAILURE, turn.reading && journalTriage(turn.reading));
        }
        turn.stage = 'handled';
        turn.message = '';
        turn.unreadNote = undefined;
        turn.openSheet = undefined;
        this.#host.changed();
        await this.#generate(turn);
    }
    async #narrate() {
        const turn = this.#turn;
        if (!turn)
            return;
        if (turn.stage === 'question')
            turn.stage = 'handled';
        await this.#generate(turn);
        // Once narration has been requested the message is settled; whatever the guard says next speaks for itself.
        if (this.#host.generate && this.#turn === turn) {
            this.#turn = undefined;
            this.#host.changed();
        }
    }
    async #askOracle(turn) {
        if (this.#turn !== turn || turn.stage !== 'question' || !turn.fate)
            return;
        const fate = turn.fate;
        const current = () => this.#turn === turn && this.#anchor() === turn.anchor;
        turn.stage = 'asking';
        this.#host.changed();
        let summary;
        try {
            summary = await this.#host.mythic.fate(fate.odds, fate.question);
        }
        catch (error) {
            if (!current())
                return;
            turn.stage = 'question';
            turn.message = `The oracle did not answer: ${error instanceof Error ? error.message : String(error)}`;
            this.#host.changed();
            return;
        }
        if (!current())
            return;
        this.#host.project();
        turn.stage = 'handled';
        turn.fate = undefined;
        turn.message = summary;
        turn.narrateLabel = 'Narrate';
        this.#host.changed();
        try {
            await this.#generate(turn);
        }
        catch (error) {
            if (!current())
                return;
            turn.message = `Oracle result saved. Retry narration: ${error instanceof Error ? error.message : String(error)}`;
            this.#host.changed();
        }
    }
}
/** A role's own failures are shown as they are; anything else names the role, since the player chooses what happens next. */
function roleFailure(role, error) {
    if (error instanceof JevFailure || error instanceof DecideFailure || error instanceof TurnDecisionError)
        return error.message;
    return `The ${role} role failed: ${String(error)}`;
}
/** `narrative 0.52, action 0.41`: the two kinds Jev weighed most, so the player sees why the card asks. */
function topTwo(probabilities) {
    return Object.entries(probabilities).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([kind, p]) => `${kind} ${p.toFixed(2)}`).join(', ');
}
function recent(messages, before) {
    const out = [];
    for (let i = before - 1; i >= 0 && out.length < RECENT_MESSAGES; i--) {
        const message = messages[i];
        const text = message.mes ?? '';
        if (message.is_system || message.role === 'tool' || !text.trim())
            continue;
        out.unshift({ speaker: message.name ?? (message.is_user ? 'Player' : 'Narrator'), text: text.length > RECENT_CHARS ? `${text.slice(0, RECENT_CHARS)}…` : text });
    }
    return out;
}
