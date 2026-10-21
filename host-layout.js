const LAUNCHER_ORDER = ['minor-character-launch', 'mythic-gme-launch', 'minor-character-continue'];
/** Small DOM convention shared by independently installable solo-play extensions. No cross-package imports. */
export function mountLauncher(composer, launcher) {
    if (!composer)
        return;
    const home = composer.querySelector('#send_form') ?? composer.querySelector('#leftSendForm') ?? composer;
    let group = home.querySelector('[data-solo-launchers]');
    if (!group) {
        group = document.createElement('div');
        group.dataset.soloLaunchers = '';
        group.className = 'solo-play-launchers';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'Solo play');
        home.prepend(group);
    }
    if (launcher.parentElement !== group) {
        const rank = (id) => {
            const idx = LAUNCHER_ORDER.indexOf(id);
            return idx === -1 ? LAUNCHER_ORDER.length : idx;
        };
        const myRank = rank(launcher.id);
        const before = Array.from(group.children).find(child => rank(child.id) > myRank);
        if (before)
            before.before(launcher);
        else
            group.append(launcher);
    }
}
/** Reattach the same controls after host remounts, preserving unsubmitted input. */
export function createExtensionSettings(id, title) {
    const element = document.createElement('details');
    element.id = id;
    element.className = 'solo-extension-settings';
    const summary = document.createElement('summary');
    summary.textContent = title;
    const body = document.createElement('div');
    body.className = 'solo-settings-body';
    element.append(summary, body);
    function mount() {
        const home = document.querySelector('#extensions_settings');
        if (!home)
            return false;
        if (element.parentElement !== home)
            home.append(element);
        return true;
    }
    return { element, body, mount };
}
