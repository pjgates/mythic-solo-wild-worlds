export const NARRATOR_PROMPT_KEY = 'minor-character-narrator';
/** Keeps the narrator's rules-state prompt equal to the open campaign; an empty value clears it when nothing is open. */
export class NarratorProjection {
    last = '';
    controller;
    host;
    constructor(controller, host) { this.controller = controller; this.host = host; }
    get text() { return this.last; }
    reconcile() {
        const text = this.controller.projectNarrator(this.host.mythic(), this.host.pacing?.() ?? 'auto')?.text ?? '';
        if (text !== this.last) {
            this.last = text;
            this.host.install(text);
        }
        return text;
    }
    clear() { this.last = ''; this.host.install(''); }
}
