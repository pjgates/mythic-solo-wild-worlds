import { sameValue } from "./game/minor-character/events.js";
import { ModelFailure } from "./scene-model.js";
export class SceneSession {
    busy = false;
    message = '';
    result;
    epoch = 0;
    model;
    source;
    controller;
    capture;
    ready;
    changed;
    constructor(model, source, controller, capture, ready, changed) {
        this.model = model;
        this.source = source;
        this.controller = controller;
        this.capture = capture;
        this.ready = ready;
        this.changed = changed;
    }
    invalidate() {
        this.epoch++;
        this.model.invalidate();
        this.result = undefined;
        this.message = this.busy ? 'Scene request cancelled.' : '';
        this.changed();
    }
    async request(manual = false) {
        if (this.busy || !this.ready())
            return;
        const view = this.controller.playerView;
        if (!view)
            return;
        const epoch = this.epoch, sourceEpoch = this.source.epoch;
        this.busy = true;
        this.result = undefined;
        this.message = 'Preparing scene proposal…';
        this.changed();
        const check = () => {
            if (!this.ready() || epoch !== this.epoch || sourceEpoch !== this.source.epoch
                || !sameValue(view.context, this.controller.playerView?.context))
                throw new Error('Scene or campaign changed; request cancelled.');
        };
        try {
            const operation = await this.capture(view.context);
            check();
            const source = await this.source.captureScene(view.play.scene.id);
            check();
            const captured = { ...operation, source: { messageId: source.id, messageRevision: source.fingerprint } };
            const proposal = manual ? { summary: '', participants: [], events: [], profileChanges: [] }
                : await this.model.proposeScene(source, view.profiles);
            check();
            this.result = { operation: captured, source, proposal };
            this.message = 'Scene proposal captured for review.';
        }
        catch (error) {
            this.message = error instanceof ModelFailure ? error.message : 'Scene capture changed or failed. Try again; no changes saved.';
        }
        finally {
            this.busy = false;
            this.changed();
        }
    }
}
