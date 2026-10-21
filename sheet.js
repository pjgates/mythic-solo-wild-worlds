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
/** A small labelled meter for the header: a track's boxes, or a short value. */
function vital(root, label, boxes, value) {
    const cell = document.createElement('div');
    cell.className = 'mc-vital';
    cell.append(text('span', label));
    if (boxes) {
        const row = document.createElement('span');
        row.className = 'mc-boxes mc-boxes-small';
        row.setAttribute('role', 'img');
        const marked = boxes.filter(box => box === 'marked').length, burned = boxes.filter(box => box === 'burned').length;
        row.setAttribute('aria-label', `${label}: ${marked} marked${burned ? `, ${burned} burned` : ''} of ${boxes.length}`);
        for (const box of boxes) {
            const pip = document.createElement('span');
            pip.className = `mc-pip mc-${box}`;
            row.append(pip);
        }
        cell.append(row);
    }
    else
        cell.append(text('strong', value ?? ''));
    root.append(cell);
}
/** Sera's sheet, read first: a compact header with the vitals, then one section per tab. */
export function renderSheet(root, view, editor, profileCallbacks = {}, mythic) {
    root.replaceChildren();
    const s = view.sheet;
    const identity = document.createElement('header');
    identity.className = 'mc-identity';
    const titleRow = document.createElement('div');
    titleRow.className = 'mc-identity-title';
    const names = document.createElement('div');
    names.append(text('h3', s.name));
    const subtitle = [s.identity.age, s.identity.homeroom].filter(Boolean).join(' · ');
    if (subtitle) {
        const line = text('p', subtitle);
        line.className = 'mc-identity-subtitle';
        names.append(line);
    }
    const actions = document.createElement('div');
    actions.className = 'mc-identity-actions';
    titleRow.append(names, actions);
    identity.append(titleRow);
    root.append(identity);
    appendFieldEditors(identity, view, editor, 'character', [view.characterId]);
    appendFieldEditors(identity, view, editor, 'class-state', [view.characterId], ['expressedRank', 'displayedRank']);
    const pills = document.createElement('p');
    pills.className = 'mc-identity-pills';
    const classPill = text('span', s.activeClass);
    classPill.className = 'mc-pill mc-class-pill';
    classPill.setAttribute('aria-label', `Active class: ${s.activeClass}`);
    const elementPill = text('span', view.play.manifestedElement ?? 'Element unknown');
    elementPill.className = 'mc-pill mc-element-pill';
    elementPill.dataset.element = view.play.manifestedElement ?? '';
    elementPill.setAttribute('aria-label', `Manifested element: ${view.play.manifestedElement ?? 'not yet chosen'}`);
    const rankPill = text('span', `Rank ${s.expressedRank} · reads ${s.displayedRank}`);
    rankPill.className = 'mc-pill mc-rank-pill';
    pills.append(classPill, elementPill, rankPill);
    identity.append(pills);
    const vitals = document.createElement('div');
    vitals.className = 'mc-vitals';
    const core = s.aspects.find(aspect => aspect.id === 'core');
    if (core)
        vital(vitals, 'Origin Core', core.track.boxes);
    vital(vitals, 'Exposure', s.tracks.exposure.boxes);
    vital(vitals, 'System rescues', undefined, `${s.rescues.remaining} of ${s.rescues.total} left`);
    identity.append(vitals);
    const capabilities = document.createElement('div');
    capabilities.dataset.sheetTab = 'capabilities';
    const aspectCollections = document.createElement('div');
    aspectCollections.dataset.sheetTab = 'aspects';
    const life = document.createElement('div');
    life.dataset.sheetTab = 'life';
    const story = document.createElement('div');
    story.dataset.sheetTab = 'background-history';
    root.append(capabilities, aspectCollections, life, story);
    renderLife(life, view, editor);
    renderCapabilities(capabilities, view, editor, mythic, life);
    renderAspects(aspectCollections, view, editor);
    const campaign = document.createElement('div');
    life.append(campaign);
    renderCampaignDetails(campaign, view, editor, mythic);
    const facts = document.createElement('dl');
    facts.className = 'mc-facts';
    for (const [key, value] of Object.entries(s.identity)) {
        const detail = text('dd', value);
        appendFieldEditors(detail, view, editor, 'identity', [view.characterId, key]);
        facts.append(text('dt', key), detail);
    }
    story.append(facts);
    const profile = view.profiles.find(profile => profile.personId === view.characterId);
    if (profile) {
        const narrative = document.createElement('div');
        narrative.className = 'mc-story-profile';
        story.append(narrative);
        renderProfile(narrative, profile, profileCallbacks);
    }
    const history = document.createElement('section');
    history.dataset.mechanicalHistory = '';
    story.append(history);
}
