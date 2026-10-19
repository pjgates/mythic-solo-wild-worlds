// Track owners supply limits and legal states; completion belongs to their rules.
export function validateTrack(track, policy) {
    if (!track || typeof track.id !== 'string' || !track.id.trim()) {
        throw new Error('A track must have an ID.');
    }
    if (!Array.isArray(track.boxes) || track.boxes.length < policy.min || track.boxes.length > policy.max) {
        throw new Error(`A track must have between ${policy.min} and ${policy.max} boxes.`);
    }
    if (!Array.from(track.boxes).every(box => policy.allowed.includes(box))) {
        throw new Error('A track contains a box state its owner does not allow.');
    }
}
