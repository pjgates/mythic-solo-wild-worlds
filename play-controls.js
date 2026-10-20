import { ELEMENTS } from "./game/minor-character/state.js";
import { renderMilestoneControls } from "./milestone-controls.js";
const text = (tag, value) => {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
};
const button = (label) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'menu_button';
    node.textContent = label;
    return node;
};
export function renderPlayControls(root, controller, capture, ready, checkpointTools) {
    const view = controller.playerView;
    if (!view)
        return;
    const section = document.createElement('section');
    section.className = 'mc-play-controls';
    section.setAttribute('aria-label', 'Play controls');
    const status = text('p', '');
    status.setAttribute('role', 'status');
    const confirmation = document.createElement('div');
    async function save(control, operation) {
        control.disabled = true;
        const expected = { ...view.context };
        try {
            await operation(await capture(expected));
        }
        catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
            control.disabled = !ready();
        }
    }
    function confirm(message, label, operation) {
        const accept = button(label), cancel = button('Cancel');
        accept.disabled = !ready();
        accept.onclick = () => { void save(accept, operation); };
        cancel.onclick = () => { confirmation.replaceChildren(); };
        confirmation.replaceChildren(text('p', message), accept, cancel);
        accept.focus();
    }
    section.append(text('h3', 'Play controls'), text('h4', 'Manifested element'), text('p', `Current manifestation: ${view.play.manifestedElement ?? 'Not yet chosen'}. All seven elements are free to select.`));
    const elements = document.createElement('div');
    elements.className = 'mc-actions';
    for (const element of ELEMENTS) {
        const choose = button(element);
        choose.setAttribute('aria-label', `Manifest ${element}`);
        choose.setAttribute('aria-pressed', String(view.play.manifestedElement === element));
        choose.disabled = !ready() || view.play.manifestedElement === element;
        choose.onclick = () => { void save(choose, context => controller.manifestElement(context, element)); };
        elements.append(choose);
    }
    section.append(elements, text('p', 'Selection changes only the manifestation. It grants no unlearned technique; visible elemental use still needs manual adjudication.'), text('h4', 'Active Class Card'));
    const cards = document.createElement('div');
    cards.className = 'mc-actions';
    const clear = view.sheet.aspects.find(aspect => aspect.id === 'core').track.boxes.filter(box => box === 'clear').length;
    const cost = view.play.nextSwitchCost;
    for (const card of view.play.cards) {
        const active = card.id === view.play.activeClassId;
        const choose = button(active ? `${card.name} · active` : `Preview ${card.name}`);
        choose.disabled = !ready() || active || !!view.pendingManual;
        choose.onclick = () => {
            const competence = Object.entries(view.sheet.classCompetence[card.name])
                .map(([skill, bonus]) => `${skill} +${bonus}`).join(', ') || 'none';
            const preview = `${card.name} competence: ${competence}. Exact cost: ${cost} Fatigue on Origin Core; ${clear} clear boxes available. Marks and burns remain.`;
            if (cost > clear) {
                confirmation.replaceChildren(text('p', `${preview} This switch is unaffordable.`));
                return;
            }
            confirm(`${preview}${cost === clear ? ' This fills Core, disables its competence and applies Mana Strain.' : ''}`, `Confirm switch to ${card.name} · ${cost} Fatigue`, context => controller.switchClass(context, card.id));
        };
        cards.append(choose);
    }
    section.append(cards);
    if (view.play.cards.length === 1)
        section.append(text('p', `Only ${view.play.cards[0].name} is learned. No alternative Class Card is available.`));
    section.append(text('h4', `Scene ${view.play.scene.number}`), text('p', `${view.play.switchesThisScene} class switches this scene. Next switch: ${cost} Fatigue.`));
    if (view.pendingManual)
        section.append(text('p', 'Finish the pending manual adjudication before switching class or ending the scene.'));
    renderMilestoneControls(section, controller, capture, ready, checkpointTools);
    section.append(confirmation, status);
    root.prepend(section);
}
