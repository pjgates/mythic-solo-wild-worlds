import { renderHistory } from "./history-view.js";
import { mountLauncher } from "./host-layout.js";
/** The sheet's own sections, as short tabs that fit a phone. */
const tabs = [
    ['capabilities', 'Skills'], ['aspects', 'Aspects'], ['life', 'Drives'], ['background-history', 'Story'],
];
const destinations = [['sheet', 'Sheet'], ['cast', 'Cast'], ['campaign', 'Campaign']];
const titles = { sheet: 'Sera’s sheet', cast: 'Cast', campaign: 'Campaign' };
const svg = (paths) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const ICONS = {
    back: svg('<path d="M15 5l-7 7 7 7"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
    expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
    chevron: svg('<path d="M9 5l7 7-7 7"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
};
export function createSheetShell(launcher, changed = () => { }) {
    const panel = document.createElement('aside');
    panel.id = 'minor-character-sheet';
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'mc-title');
    panel.innerHTML = `<header class="mc-panel-bar"><h2 id="mc-title" class="mc-visually-hidden">Sera’s sheet</h2>
    <button class="menu_button mc-icon-button" type="button" data-back aria-label="Back to chat">${ICONS.back}</button>
    <nav class="mc-destinations" aria-label="Sera’s panels"></nav>
    <button class="menu_button mc-icon-button" type="button" data-fullscreen aria-label="Full screen">${ICONS.expand}</button></header>
    <nav role="tablist" aria-label="Character sheet sections"></nav><div class="mc-content"></div>`;
    const content = panel.querySelector('.mc-content');
    const tablist = panel.querySelector('[role="tablist"]');
    const nav = panel.querySelector('.mc-destinations');
    const back = panel.querySelector('[data-back]');
    const expand = panel.querySelector('[data-fullscreen]');
    const overlay = document.createElement('dialog');
    overlay.id = 'minor-character-fullscreen';
    overlay.setAttribute('aria-labelledby', 'mc-title');
    const desktop = matchMedia('(min-width: 1024px)');
    // The Cast stays reachable from the panel's own switch; the composer keeps one launcher.
    const castLauncher = document.createElement('button');
    castLauncher.id = 'minor-character-cast-launch';
    castLauncher.className = 'menu_button';
    castLauncher.textContent = 'Cast';
    let destination = 'sheet';
    let fullscreen = false;
    let wide = desktop.matches;
    let active = 'capabilities';
    const positions = new Map();
    let historyVisibleCount = 50;
    let historyView;
    function showHistory(view) {
        if (view.context.campaignId !== historyView?.context.campaignId
            || view.context.branchId !== historyView?.context.branchId)
            historyVisibleCount = 50;
        historyView = view;
        const target = content.querySelector('[data-mechanical-history]');
        if (target)
            renderHistory(target, view, historyVisibleCount);
    }
    content.addEventListener('click', event => {
        if (!event.target.closest('[data-load-older]') || !historyView)
            return;
        rememberPosition();
        const previousCount = historyVisibleCount;
        historyVisibleCount += 50;
        showHistory(historyView);
        restorePosition();
        content.querySelectorAll('[data-history-entry]')[previousCount].focus({ preventScroll: true });
    });
    const destinationButtons = destinations.map(([id, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button';
        button.textContent = label;
        button.dataset.destination = id;
        button.onclick = () => show(id);
        nav.append(button);
        return button;
    });
    const controls = tabs.map(([id, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `mc-tab-${id}`;
        button.textContent = label;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', `mc-panel-${id}`);
        button.onclick = () => select(id);
        tablist.append(button);
        return button;
    });
    const positionKey = () => destination !== 'sheet' ? destination : fullscreen ? (wide ? 'fullscreen' : `fullscreen-${active}`) : active;
    const rememberPosition = () => positions.set(positionKey(), content.scrollTop);
    const restorePosition = () => { content.scrollTop = positions.get(positionKey()) ?? 0; };
    function applyTabs() {
        const columns = fullscreen && wide;
        tablist.hidden = columns || destination !== 'sheet';
        panel.classList.toggle('mc-cast-destination', destination === 'cast');
        panel.dataset.destination = destination;
        const heading = panel.querySelector('h2');
        if (heading.textContent !== titles[destination])
            heading.textContent = titles[destination];
        for (const button of destinationButtons) {
            const current = button.dataset.destination === destination;
            if (current)
                button.setAttribute('aria-current', 'page');
            else
                button.removeAttribute('aria-current');
        }
        const identity = content.querySelector('.mc-identity');
        if (identity && identity.nextElementSibling !== tablist)
            identity.after(tablist);
        controls.forEach((button, index) => {
            const selected = tabs[index][0] === active;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
        });
        content.querySelectorAll('[data-sheet-tab]').forEach(section => {
            const id = section.dataset.sheetTab;
            section.id = `mc-panel-${id}`;
            section.setAttribute('role', columns ? 'region' : 'tabpanel');
            section.setAttribute('aria-labelledby', `mc-tab-${id}`);
            section.tabIndex = 0;
            section.hidden = !columns && id !== active;
        });
    }
    function select(id) {
        rememberPosition();
        active = id;
        applyTabs();
        restorePosition();
    }
    content.addEventListener('scroll', () => { if (!panel.hidden)
        rememberPosition(); });
    desktop.addEventListener('change', () => {
        rememberPosition();
        wide = desktop.matches;
        applyTabs();
        restorePosition();
        if (fullscreen && (tablist.hidden && tablist.contains(document.activeElement)
            || document.activeElement?.closest('[data-sheet-tab][hidden]')))
            back.focus();
    });
    // Constraint validation must reveal the invalid field before the browser focuses it.
    content.addEventListener('invalid', event => {
        const section = event.target.closest('[data-sheet-tab]');
        if (section?.hidden)
            select(section.dataset.sheetTab);
    }, true);
    tablist.onkeydown = event => {
        const index = controls.indexOf(document.activeElement);
        if (index < 0)
            return;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % controls.length
                : event.key === 'ArrowLeft' ? (index + controls.length - 1) % controls.length : -1;
        if (next < 0)
            return;
        event.preventDefault();
        select(tabs[next][0]);
        controls[next].focus();
    };
    for (const control of [launcher, castLauncher]) {
        control.setAttribute('aria-controls', panel.id);
        control.setAttribute('aria-expanded', 'false');
    }
    function mount() {
        const host = document.querySelector('#sheld');
        if (!fullscreen && host && panel.parentElement !== host) {
            panel.parentElement?.classList.remove('mc-sheet-open');
            host.append(panel);
        }
        host?.classList.toggle('mc-sheet-open', !panel.hidden && !fullscreen);
        launcher.setAttribute('aria-expanded', String(!panel.hidden));
        castLauncher.setAttribute('aria-expanded', String(!panel.hidden && destination === 'cast'));
        const composer = document.querySelector('#form_sheld');
        mountLauncher(composer, launcher);
        applyTabs();
        restorePosition();
    }
    function show(next = 'sheet') {
        window.dispatchEvent(new CustomEvent('solo-play-panel-open', { detail: 'minor-character' }));
        if (destination !== next) {
            rememberPosition();
            destination = next;
            changed();
        }
        panel.hidden = false;
        mount();
        if (destination === 'sheet')
            controls[tabs.findIndex(([id]) => id === active)].focus();
        else
            destinationButtons.find(button => button.dataset.destination === destination).focus();
    }
    function setFullscreen(enabled) {
        if (enabled === fullscreen)
            return;
        rememberPosition();
        fullscreen = enabled;
        panel.classList.toggle('mc-fullscreen', enabled);
        expand.hidden = enabled;
        back.setAttribute('aria-label', enabled ? 'Back to tabbed sheet' : 'Back to chat');
        if (enabled) {
            panel.hidden = false;
            document.body.append(overlay);
            overlay.append(panel);
            overlay.showModal();
        }
        else {
            overlay.close();
        }
        mount();
        if (enabled)
            back.focus();
        else {
            overlay.remove();
            expand.focus({ preventScroll: true });
        }
    }
    overlay.addEventListener('cancel', event => { event.preventDefault(); setFullscreen(false); });
    expand.onclick = () => setFullscreen(true);
    function close(restoreFocus = true) {
        if (fullscreen)
            setFullscreen(false);
        rememberPosition();
        panel.hidden = true;
        mount();
        if (restoreFocus)
            launcher.focus();
    }
    const backToSheet = () => { if (fullscreen)
        setFullscreen(false);
    else
        close(); };
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            backToSheet();
        }
    });
    back.onclick = backToSheet;
    launcher.onclick = () => { if (!panel.hidden && !fullscreen)
        close();
    else
        show(destination); };
    window.addEventListener('solo-play-panel-open', event => {
        if (event.detail !== 'minor-character' && !panel.hidden)
            close(false);
    });
    castLauncher.onclick = () => show('cast');
    return { get destination() { return destination; }, content, show, close, mount, setFullscreen, renderHistory: showHistory };
}
