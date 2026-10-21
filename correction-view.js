import { sameValue } from "./game/minor-character/events.js";
import { appendFieldEditors } from "./field-editor.js";
import { createDraft, draftMatches } from "./sheet-draft.js";
import { ICONS } from "./sheet-shell.js";
const text = (tag, value) => {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
};
export class CorrectionSession {
    controller;
    capture;
    ready;
    changed;
    session;
    updateSummary = () => { };
    constructor(controller, capture, ready, changed) {
        this.controller = controller;
        this.capture = capture;
        this.ready = ready;
        this.changed = changed;
    }
    get editing() { return !!this.session; }
    get view() { return this.session?.view; }
    get editor() {
        return this.session && { draft: this.session.draft, changed: () => this.updateSummary() };
    }
    clear() { this.session = undefined; }
    reconcile(view) {
        const session = this.session;
        if (!session)
            return;
        const expected = session.draft.context;
        if (expected.campaignId !== view.context.campaignId || expected.branchId !== view.context.branchId
            || session.draft.characterId !== view.characterId) {
            this.clear();
            return;
        }
        if (!this.controller.state.available || this.controller.state.busy)
            return;
        const prepared = session.prepared;
        const recorded = prepared && view.history.find(entry => entry.operationId === prepared.operationId);
        if (recorded) {
            if (recorded.corrections && recorded.reason === prepared.reason
                && sameValue(recorded.corrections.map(({ ref, after }) => ({ ref, value: after })), prepared.changes)) {
                this.clear();
            }
            else
                session.message = 'Recovered operation disagrees with this draft. Cancel and inspect the campaign record.';
        }
        else if (!draftMatches(session.draft, view)) {
            session.message = 'The sheet revision changed. This draft cannot overwrite it. Cancel, reopen and edit the current sheet.';
        }
        else if (prepared && !session.saving) {
            session.message = 'The save was not recorded. Retry Save with the retained changes and operation ID, or Cancel.';
        }
    }
    render(root) {
        const view = this.controller.playerView;
        if (!view)
            return;
        const button = (label, className = 'menu_button') => {
            const control = document.createElement('button');
            control.type = 'button';
            control.className = className;
            control.textContent = label;
            return control;
        };
        const session = this.session;
        root.classList.toggle('mc-editing', !!session);
        if (!session) {
            const edit = button('Edit', 'menu_button mc-icon-button mc-edit-button');
            edit.disabled = !this.ready();
            edit.innerHTML = ICONS.pencil;
            edit.setAttribute('aria-label', 'Correct a sheet entry');
            edit.onclick = () => {
                if (!this.ready())
                    return;
                this.session = { view, draft: createDraft(view), saving: false, message: '' };
                this.changed();
            };
            const slot = root.querySelector('.mc-identity-actions');
            if (slot)
                slot.append(edit);
            else {
                const bar = document.createElement('section');
                bar.className = 'mc-edit-bar';
                bar.setAttribute('aria-label', 'Sheet corrections');
                bar.append(edit);
                root.prepend(bar);
            }
            return;
        }
        // Editing: a gold bar on top says so and offers Cancel; the reason and Save sit together at the foot.
        const bar = document.createElement('section');
        bar.className = 'mc-edit-bar';
        bar.setAttribute('aria-label', 'Sheet corrections');
        root.prepend(bar);
        const cancel = button('Cancel');
        const heading = document.createElement('div');
        heading.className = 'mc-edit-heading';
        const count = text('p', '');
        heading.append(text('strong', 'Correcting the sheet'), count);
        bar.append(cancel, heading);
        const footer = document.createElement('section');
        footer.className = 'mc-edit-footer';
        footer.setAttribute('aria-label', 'Save corrections');
        const changes = document.createElement('ul');
        changes.className = 'mc-edit-changes';
        const reasonLabel = text('label', 'Reason for correction · required, saved with it');
        const reason = document.createElement('textarea');
        reason.className = 'text_pole';
        reason.required = true;
        reason.rows = 2;
        reason.value = session.draft.reason;
        reason.placeholder = 'For example: I forgot to mark Hearth Hex in scene 2';
        reason.setAttribute('aria-label', 'Reason for correction');
        reasonLabel.append(reason);
        reason.oninput = () => { session.draft.reason = reason.value; session.message = ''; this.updateSummary(); };
        const save = button('Save', 'menu_button mc-primary mc-save');
        const status = text('p', session.message);
        status.setAttribute('role', 'status');
        const note = text('small', 'Recorded in the journal. Corrections never reroll, award advancement or clear a pending decision.');
        const describe = (value) => value === null || value === undefined || value === '' ? 'None' : String(value);
        this.updateSummary = () => {
            const n = session.draft.changes.length;
            count.textContent = n ? `${n} unsaved ${n === 1 ? 'change' : 'changes'}` : 'No changes yet';
            changes.replaceChildren(...session.draft.changes.map(change => {
                const field = session.view.editableFields.find(entry => entry.ref.owner === change.ref.owner
                    && entry.ref.entityId === change.ref.entityId && entry.ref.field === change.ref.field && entry.ref.box === change.ref.box);
                const item = document.createElement('li');
                item.append(text('strong', field?.label ?? change.ref.field), text('span', ` ${describe(field?.value)} → `), text('em', describe(change.value)));
                return item;
            }));
            changes.hidden = !n;
            const ready = !session.saving && this.ready() && draftMatches(session.draft, view) && n > 0 && !!session.draft.reason.trim();
            save.disabled = !ready;
            save.textContent = session.saving ? 'Saving…' : n === 0 ? 'Nothing to save' : !session.draft.reason.trim()
                ? 'Add a reason to save' : `Save ${n} ${n === 1 ? 'correction' : 'corrections'}`;
        };
        this.updateSummary();
        cancel.disabled = session.saving;
        cancel.onclick = () => { if (!session.saving) {
            this.clear();
            this.changed();
        } };
        save.onclick = () => { void this.save(root, session); };
        const details = document.createElement('details');
        details.className = 'mc-exceptional';
        details.append(text('summary', 'Exceptional corrections · rule data and bindings'), text('p', 'Repair recorded competence, rescues, class bindings and Aspect definitions. These share the correction reason; definition repairs keep their revision history.'));
        const groups = new Set();
        for (const field of session.view.editableFields) {
            const { owner, entityId, field: key } = field.ref;
            if (!['rescues', 'competence', 'placement', 'aspect-definition'].includes(owner)
                && !(owner === 'class-state' && key === 'activeClass'))
                continue;
            const groupKey = JSON.stringify([owner, entityId]);
            if (groups.has(groupKey))
                continue;
            groups.add(groupKey);
            const group = document.createElement('section');
            group.append(text('h4', field.label));
            appendFieldEditors(group, session.view, this.editor, owner, JSON.parse(entityId), owner === 'class-state' ? ['activeClass'] : undefined);
            details.append(group);
        }
        footer.append(changes, reasonLabel, save, note, status);
        root.append(details, footer);
        const locked = session.saving || !!session.prepared;
        reason.disabled = locked;
        if (locked)
            root.querySelectorAll('.mc-field-editor input, .mc-field-editor select, .mc-field-editor textarea, .mc-field-editor button')
                .forEach(control => { control.disabled = true; });
    }
    async save(root, session) {
        if (this.session !== session || session.saving || !this.ready())
            return;
        const view = this.controller.playerView;
        if (!view || !draftMatches(session.draft, view))
            return;
        // Validate every contextual control, including invalid numbers absent from the draft.
        for (const control of root.querySelectorAll('.mc-field-editor input, .mc-field-editor select, .mc-field-editor textarea')) {
            if (!control.checkValidity()) {
                control.closest('details')?.setAttribute('open', '');
                control.reportValidity();
                return;
            }
        }
        if (!session.draft.changes.length || !session.draft.reason.trim())
            return;
        session.prepared ??= { operationId: crypto.randomUUID(), changes: structuredClone(session.draft.changes),
            reason: session.draft.reason };
        const prepared = session.prepared;
        session.saving = true;
        session.message = 'Saving corrections…';
        this.changed();
        try {
            const context = await this.capture(session.draft.context);
            if (this.session !== session)
                return;
            await this.controller.correctSheetBatch({ ...context, ...prepared });
            if (this.session === session)
                this.clear();
        }
        catch (error) {
            if (this.session !== session)
                return;
            session.message = `${error instanceof Error ? error.message : String(error)}${this.controller.state.available ? '' : ' Draft retained. Reopen saved campaign before retrying.'}`;
            if (this.controller.state.available)
                session.prepared = undefined;
        }
        finally {
            session.saving = false;
            if (this.session === session)
                this.changed();
        }
    }
}
