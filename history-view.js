const element = (tag, text = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
};
const MEANING = { Triumph: 'Full success.', Conflict: 'It works, at a cost.', Disaster: 'It fails, and something gets worse.' };
/** The dice as rolled: Cut dice struck through, the highest survivor and any repeated values named under each die. */
export function renderDice(r) {
    const row = element('div');
    row.className = 'mc-dice-row';
    const { removed, survivors, fallback } = r.result;
    const counts = new Map();
    for (const die of survivors)
        counts.set(die, (counts.get(die) ?? 0) + 1);
    const label = [`Rolled ${r.result.draws.slice(0, r.result.pool).join(', ') || 'no pool dice'}.`,
        removed.length ? `Cut ${removed.join(', ')}.` : '', fallback ? `Fallback die ${survivors[0]}.` : `Highest surviving die ${survivors[0]}.`,
        r.result.twist ? 'Repeated values make a Twist.' : ''].filter(Boolean).join(' ');
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', label);
    const die = (value, kind, caption) => {
        const cell = element('span');
        cell.className = 'mc-die-cell';
        cell.setAttribute('aria-hidden', 'true');
        const face = element('span', String(value));
        face.className = `mc-die-face mc-die-${kind}`;
        cell.append(face, element('small', caption));
        row.append(cell);
    };
    for (const value of removed)
        die(value, 'cut', 'Cut');
    let first = true;
    let pairShown = false;
    for (const value of survivors) {
        const repeated = (counts.get(value) ?? 0) > 1;
        if (fallback)
            die(value, 'highest', 'Fallback');
        else if (first)
            die(value, 'highest', 'Highest');
        else if (repeated && !pairShown) {
            die(value, 'pair', 'Pair');
            pairShown = true;
        }
        else
            die(value, repeated ? 'pair' : 'plain', '');
        first = false;
    }
    return row;
}
export function renderReceipt(r) {
    const card = element('article');
    card.dataset.operationId = r.command.operationId;
    card.classList.add('mc-receipt');
    const head = element('p');
    head.className = 'mc-receipt-head';
    head.append(element('span', r.command.action.description), element('span', 'Saved'));
    const outcome = element('div');
    outcome.className = 'mc-outcome';
    const title = element('h4', r.result.outcome);
    title.className = `mc-outcome-${r.result.outcome.toLowerCase()}`;
    outcome.append(title);
    if (r.result.twist) {
        const twist = element('span', '+ Twist');
        twist.className = 'mc-pill mc-pill-twist';
        outcome.append(twist);
    }
    const meaning = element('span', MEANING[r.result.outcome]);
    meaning.className = 'mc-outcome-meaning';
    outcome.append(meaning);
    card.append(head, outcome, renderDice(r));
    const details = element('details');
    details.append(element('summary', 'Dice and mechanics'));
    details.append(element('p', `Pool ${r.result.pool}: ${r.command.action.edge ?? 'No Edge'}; ${r.command.action.skill?.name ?? 'no Skill or Lore'}; Advantage: ${r.command.action.advantageSources.join(', ') || 'none'}.`), element('p', `Rolled ${r.result.draws.join(', ')}. Surviving dice ${r.result.survivors.join(', ')}.${r.result.fallback ? ' Uncut fallback: a six counts as Conflict; no Twist.' : ''}`), element('p', `Costs: ${r.costs.join('; ') || 'none'}. Sheet changes: ${r.effects.join('; ') || 'none'}.`));
    const cuts = r.result.cuts;
    const origin = r.result.origin;
    details.append(element('p', `Uncapped pool ${origin.uncappedPool} · active class bonus +${origin.classBonus} · Origin Overflow ${origin.overflow}. Rolled pool ${r.result.pool} (cap 6).`), element('p', `Mandatory Cuts: before Overflow ${origin.mandatoryCuts}, remaining ${origin.remainingMandatoryCuts}. Voluntary Cuts: ${origin.voluntaryCuts}, unchanged. Effective total ${cuts.total}. Unused overflow is lost; conditions, permissions and rank-gap impact remain.`));
    details.append(element('p', `Cut sources: difficulty ${cuts.difficulty}, rank gap ${cuts.rankGap}, Mire ${cuts.mire}, Mana Strain ${cuts.injury}, voluntary Precision ${cuts.precision}, voluntary Impact ${cuts.impact}. Effective Cuts ${cuts.total}. Removed: ${r.result.removed.join(', ') || 'none'}.`), element('p', `Impact: ${r.result.impact} (base ${r.command.action.baseImpact ?? 'Normal'}). Low: one fewer box; Normal: one; High: one extra; Massive: whole track.`));
    if (r.command.action.permission)
        details.append(element('p', `Permission: ${r.command.action.permission}`));
    const record = element('small', `Revision ${r.revision} · operation ${r.command.operationId} · source ${r.command.source.messageId}`);
    record.className = 'mc-record-ids';
    details.append(record);
    card.append(details);
    return card;
}
export function renderHistory(root, view, visibleCount) {
    root.replaceChildren();
    root.append(element('h3', 'Mechanical history'), element('p', `Rules ${view.rules.revision} · revision ${view.context.revision} · branch ${view.context.branchId}`), element('p', `Campaign ${view.context.campaignId}`));
    const entries = view.history.slice(-visibleCount).reverse();
    const status = element('p', `Showing ${entries.length} of ${view.history.length} operations, newest first.`);
    status.setAttribute('role', 'status');
    root.append(status);
    const notes = new Map(view.history.filter(entry => entry.manualTarget).map(entry => [entry.manualTarget, entry.manualNote]));
    const list = document.createElement('ol');
    for (const entry of entries) {
        const item = element('li');
        item.dataset.historyEntry = entry.operationId;
        item.tabIndex = -1;
        item.append(element('p', `${entry.at} · ${entry.summary}`));
        if (entry.receipt) {
            item.append(renderReceipt(entry.receipt));
            const note = notes.get(entry.operationId);
            if (note)
                item.append(element('p', note));
        }
        const changes = entry.correction ? [entry.correction] : entry.corrections ?? [];
        for (const change of changes)
            item.append(element('p', `${change.label}: ${change.before ?? 'None'} → ${change.after ?? 'None'}.`));
        const reason = entry.correction?.reason ?? entry.reason;
        if (reason)
            item.append(element('p', `Correction reason: ${reason}`));
        if (entry.manualNote)
            item.append(element('p', entry.manualNote));
        list.append(item);
    }
    root.append(list);
    if (entries.length < view.history.length) {
        const older = document.createElement('button');
        older.type = 'button';
        older.className = 'menu_button';
        older.textContent = 'Load older';
        older.dataset.loadOlder = '';
        root.append(older);
    }
}
