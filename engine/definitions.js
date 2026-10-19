export function resolveAspect(definitions, ref) {
    if (!ref || typeof ref.id !== 'string' || !ref.id.trim()
        || !Number.isSafeInteger(ref.revision) || ref.revision < 1) {
        throw new Error('An Aspect reference requires an ID and a positive integer revision.');
    }
    const matches = definitions.filter(item => item.id === ref.id && item.revision === ref.revision);
    if (matches.length > 1)
        throw new Error(`Duplicate Aspect definition ${ref.id} at revision ${ref.revision}.`);
    const definition = matches[0];
    if (!definition)
        throw new Error(`Missing Aspect definition ${ref.id} at revision ${ref.revision}.`);
    return definition;
}
