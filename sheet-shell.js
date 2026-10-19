import { renderHistory } from "./history-view.js";
const tabs = [
    ['capabilities', 'Edges & skills'], ['aspects', 'Aspects'], ['life', 'Drives & more'],
    ['background-history', 'Background & history'],
];
export function createSheetShell(launcher, changed = () => { }) {
    const panel = document.createElement('aside');
    panel.id = 'minor-character-sheet';
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'mc-title');
    panel.innerHTML = `<header><h2 id="mc-title">Minor Character</h2>
    <div><button class="menu_button" type="button" data-fullscreen>Full screen</button>
    <button class="menu_button" type="button" data-back>Back</button></div></header>
    <nav role="tablist" aria-label="Character sheet sections"></nav><div class="mc-content"></div>`;
    const content = panel.querySelector('.mc-content');
    const tablist = panel.querySelector('[role="tablist"]');
    const back = panel.querySelector('[data-back]');
    const expand = panel.querySelector('[data-fullscreen]');
    const overlay = document.createElement('dialog');
    overlay.id = 'minor-character-fullscreen';
    overlay.setAttribute('aria-labelledby', 'mc-title');
    const desktop = matchMedia('(min-width: 1024px)');
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
        renderHistory(content.querySelector('[data-mechanical-history]'), view, historyVisibleCount);
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
    const positionKey = () => destination === 'cast' ? 'cast' : fullscreen ? (wide ? 'fullscreen' : `fullscreen-${active}`) : active;
    const rememberPosition = () => positions.set(positionKey(), content.scrollTop);
    const restorePosition = () => { content.scrollTop = positions.get(positionKey()) ?? 0; };
    function applyTabs() {
        const columns = fullscreen && wide;
        tablist.hidden = columns || destination === 'cast';
        panel.classList.toggle('mc-cast-destination', destination === 'cast');
        const title = destination === 'cast' ? 'Cast' : 'Minor Character';
        const heading = panel.querySelector('h2');
        if (heading.textContent !== title)
            heading.textContent = title;
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
        launcher.setAttribute('aria-expanded', String(!panel.hidden && destination === 'sheet'));
        castLauncher.setAttribute('aria-expanded', String(!panel.hidden && destination === 'cast'));
        const composer = document.querySelector('#form_sheld');
        if (composer && launcher.parentElement !== composer)
            composer.prepend(launcher);
        if (composer && castLauncher.parentElement !== composer)
            composer.prepend(castLauncher);
        applyTabs();
        restorePosition();
    }
    function show(next = 'sheet') {
        if (destination !== next) {
            rememberPosition();
            destination = next;
            changed();
        }
        panel.hidden = false;
        mount();
        if (destination === 'cast')
            back.focus();
        else
            controls[tabs.findIndex(([id]) => id === active)].focus();
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
    function close() {
        if (fullscreen)
            setFullscreen(false);
        rememberPosition();
        panel.hidden = true;
        mount();
        (destination === 'cast' ? castLauncher : launcher).focus();
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
    launcher.onclick = () => show();
    castLauncher.onclick = () => show('cast');
    return { get destination() { return destination; }, content, show, close, mount, setFullscreen, renderHistory: showHistory };
}
