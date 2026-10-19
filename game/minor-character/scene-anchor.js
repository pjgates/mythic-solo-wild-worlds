export function emptySceneStartAnchor(binding) {
    // SHA-256 of the empty selected-message array, JSON.stringify([]).
    return { binding, nextMessageIndex: 0,
        prefixFingerprint: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' };
}
export function validSceneStartAnchor(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const anchor = value;
    return Object.keys(anchor).length === 3
        && typeof anchor.binding === 'string' && !!anchor.binding.trim()
        && Number.isSafeInteger(anchor.nextMessageIndex) && anchor.nextMessageIndex >= 0
        && typeof anchor.prefixFingerprint === 'string' && /^[a-f0-9]{64}$/.test(anchor.prefixFingerprint);
}
