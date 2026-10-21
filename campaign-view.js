import { ICONS } from "./sheet-shell.js";
const text = (tag, value) => {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
};
const marked = (boxes) => boxes.filter(box => box !== 'clear').length;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const TOOL_TITLES = {
    scene: 'End scene and review', class: 'Class and element', origin: 'Origin growth', world: 'Exposure, Canon and Mysteries',
    downtime: 'Downtime and advancement', encounters: 'Encounters', checkpoints: 'Saves and branches', mythic: 'Mythic oracle',
    narration: 'Narration recipients',
};
function statusLine(view, tool, recipients) {
    const { sheet, play } = view;
    switch (tool) {
        case 'class': return `${sheet.activeClass} active · ${play.manifestedElement ?? 'no element manifested'} · next switch ${play.nextSwitchCost} Fatigue`;
        case 'origin': return `${plural(play.cards.length, 'Class Card')} · ${plural(sheet.archive.length, 'archived Aspect')}`;
        case 'world': return `Exposure ${marked(sheet.tracks.exposure.boxes)} of ${sheet.tracks.exposure.boxes.length} · Canon ${marked(sheet.tracks.canon.boxes)} of ${sheet.tracks.canon.boxes.length} · Divergence level ${sheet.divergenceLevel}`;
        case 'downtime': return `Breakthrough ${marked(sheet.tracks.breakthrough.boxes)} of ${sheet.tracks.breakthrough.boxes.length} · ${plural(sheet.projects.length, 'project')}`;
        case 'encounters': {
            const { hazards, dungeonRuns, tournaments } = view.encounters;
            const parts = [hazards.length && plural(hazards.length, 'hazard'), dungeonRuns.length && plural(dungeonRuns.length, 'dungeon run'),
                tournaments.length && plural(tournaments.length, 'tournament')].filter(Boolean);
            return `${parts.join(' · ') || 'Hazards, Mayfly rolls, dungeon runs and tournaments'} · Keeper drawer inside`;
        }
        case 'checkpoints': return `Branch ${view.context.branchId} · revision ${view.context.revision}`;
        case 'mythic': return 'Chaos, Fate Checks and the Adventure Lists';
        case 'narration': return recipients ? `${plural(recipients, 'recipient')} selected` : 'Choose who hears the next narration';
        default: return '';
    }
}
/** Campaign tools: the scene first, then one row per group; a row opens that group alone on its own screen. */
export function renderCampaign(root, view, callbacks) {
    root.replaceChildren();
    const hub = document.createElement('div');
    hub.className = 'mc-campaign';
    root.append(hub);
    if (callbacks.tool) {
        const header = document.createElement('header');
        header.className = 'mc-tool-header';
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'menu_button mc-icon-button';
        back.innerHTML = ICONS.back;
        back.setAttribute('aria-label', 'Back to Campaign');
        back.dataset.campaignBack = '';
        back.onclick = () => callbacks.open(null);
        const title = text('h3', TOOL_TITLES[callbacks.tool]);
        title.tabIndex = -1;
        title.dataset.campaignTitle = '';
        header.append(back, title);
        const body = document.createElement('div');
        body.className = `mc-tool mc-tool-${callbacks.tool}`;
        hub.append(header, body);
        callbacks.renderTool(callbacks.tool, body);
        return;
    }
    const scene = document.createElement('section');
    scene.className = 'mc-scene-card';
    const twists = view.bankedTwists.filter(twist => !twist.spent && twist.sceneId === view.play.scene.id).length;
    const head = document.createElement('div');
    head.className = 'mc-scene-head';
    head.append(text('h3', `Scene ${view.play.scene.number}`), text('span', `Chaos ${callbacks.chaos ?? view.sheet.chaos} · ${plural(twists, 'banked Twist')}`));
    const end = document.createElement('button');
    end.type = 'button';
    end.className = 'menu_button mc-primary';
    end.dataset.campaignTool = 'scene';
    end.textContent = view.sceneReview ? 'Continue the scene review' : 'End scene and review';
    end.onclick = () => callbacks.open('scene');
    scene.append(head, end);
    if (view.pendingManual) {
        const hold = text('p', 'Finish the pending roll on the card before switching class or ending the scene.');
        hold.className = 'mc-notice';
        scene.append(hold);
    }
    hub.append(scene);
    const group = (title, tools, className = '') => {
        const section = document.createElement('section');
        section.className = `mc-tool-group ${className}`.trim();
        section.append(text('h3', title));
        const list = document.createElement('ul');
        list.className = 'mc-tool-list';
        for (const tool of tools) {
            const item = document.createElement('li');
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'mc-tool-row';
            row.dataset.campaignTool = tool;
            const label = document.createElement('span');
            label.className = 'mc-tool-label';
            label.append(text('strong', TOOL_TITLES[tool]), text('span', statusLine(view, tool, callbacks.recipients)));
            const chevron = document.createElement('span');
            chevron.className = 'mc-chevron';
            chevron.innerHTML = ICONS.chevron;
            row.append(label, chevron);
            row.onclick = () => callbacks.open(tool);
            item.append(row);
            list.append(item);
        }
        section.append(list);
        hub.append(section);
    };
    group('Record something that happened', ['class', 'origin', 'world', 'downtime']);
    group('Run an encounter', ['encounters']);
    group('Behind the screen', ['narration', 'mythic', 'checkpoints']);
}
