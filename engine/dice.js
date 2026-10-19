export function rollD6() {
    const bytes = new Uint8Array(1);
    do {
        crypto.getRandomValues(bytes);
    } while (bytes[0] >= 252);
    return bytes[0] % 6 + 1;
}
const validDie = (die) => Number.isInteger(die) && die >= 1 && die <= 6;
// Both fresh and recorded rolls use the same Cut, fallback and interpretation rules.
function interpret(pool, cuts, draws) {
    const survivors = draws.slice(0, pool).sort((a, b) => b - a);
    const removed = survivors.splice(0, cuts);
    const fallback = survivors.length === 0;
    if (fallback)
        survivors.push(draws[pool]);
    const highest = survivors[0];
    return { pool, draws, survivors, removed, fallback,
        outcome: highest === 6 && !fallback ? 'Triumph' : highest >= 4 ? 'Conflict' : 'Disaster',
        twist: !fallback && new Set(survivors).size < survivors.length };
}
// The caller prepares a nonnegative integer pool and Cut count, including game caps.
export function rollPool(pool, cuts, die) {
    const draws = Array.from({ length: pool }, die);
    if (pool <= cuts)
        draws.push(die());
    if (!draws.every(validDie))
        throw new Error('Invalid die source.');
    return interpret(pool, cuts, draws);
}
export function assertRecordedDice(result, cuts) {
    const validCount = (value) => Number.isInteger(value) && value >= 0;
    if (!result || !validCount(result.pool) || !validCount(cuts)
        || !Array.isArray(result.draws) || !Array.from(result.draws).every(validDie)
        || result.draws.length !== result.pool + Number(result.pool <= cuts)) {
        throw new Error('Invalid recorded dice.');
    }
    const expected = interpret(result.pool, cuts, result.draws);
    const sameDice = (actual, dice) => Array.isArray(actual)
        && actual.length === dice.length && dice.every((die, index) => actual[index] === die);
    if (!sameDice(result.removed, expected.removed) || !sameDice(result.survivors, expected.survivors)
        || result.fallback !== expected.fallback || result.outcome !== expected.outcome || result.twist !== expected.twist) {
        throw new Error('Invalid recorded dice.');
    }
}
