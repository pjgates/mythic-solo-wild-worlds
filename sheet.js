import { renderProfile } from "./profile-view.js";
import { appendFieldEditors } from "./field-editor.js";
import { renderAspects } from "./sheet-aspects.js";
import { renderLife, renderCampaignDetails } from "./sheet-life.js";
import { renderCapabilities } from "./sheet-capabilities.js";
function text(tag, value) {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
}
export function renderSheet(root, view, editor, profileCallbacks = {}, mythic) {
    root.replaceChildren();
    const s = view.sheet;
    const identity = document.createElement('header');
    identity.className = 'mc-identity';
    identity.append(text('h3', s.name));
    root.append(identity);
    appendFieldEditors(identity, view, editor, 'character', [view.characterId]);
    appendFieldEditors(identity, view, editor, 'class-state', [view.characterId], ['expressedRank', 'displayedRank']);
    const classLabel = text('p', 'Active class: ');
    const classPill = text('span', s.activeClass);
    classPill.className = 'mc-pill mc-class-pill';
    classLabel.append(classPill, ` · expressed rank ${s.expressedRank} · displayed rank ${s.displayedRank}`);
    identity.append(classLabel);
    const facts = document.createElement('dl');
    for (const [key, value] of Object.entries(s.identity)) {
        const detail = text('dd', value);
        appendFieldEditors(detail, view, editor, 'identity', [view.characterId, key]);
        facts.append(text('dt', key), detail);
    }
    const elementLabel = text('p', 'Manifested element: ');
    const elementPill = text('span', view.play.manifestedElement ?? 'Not yet chosen');
    elementPill.className = 'mc-pill mc-element-pill';
    elementPill.dataset.element = view.play.manifestedElement ?? '';
    elementLabel.append(elementPill);
    identity.append(elementLabel);
    const capabilities = document.createElement('div');
    capabilities.dataset.sheetTab = 'capabilities';
    root.append(capabilities);
    renderCapabilities(capabilities, view, editor, mythic);
    const aspectCollections = document.createElement('div');
    aspectCollections.dataset.sheetTab = 'aspects';
    root.append(aspectCollections);
    renderAspects(aspectCollections, view, editor);
    const life = document.createElement('div');
    life.dataset.sheetTab = 'life';
    root.insertBefore(life, capabilities);
    renderLife(life, view, editor);
    life.prepend(facts);
    const campaign = document.createElement('div');
    life.append(campaign);
    renderCampaignDetails(campaign, view, editor, mythic);
    const profile = view.profiles.find(profile => profile.personId === view.characterId);
    if (profile) {
        const narrative = document.createElement('div');
        narrative.dataset.sheetTab = 'background-history';
        root.append(narrative);
        renderProfile(narrative, profile, profileCallbacks);
    }
    const history = document.createElement('section');
    history.dataset.mechanicalHistory = '';
    life.append(history);
}
