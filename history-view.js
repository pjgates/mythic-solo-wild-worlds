const element = (tag, text = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
};
export function renderReceipt(r) {
    const card = element('article');
    card.dataset.operationId = r.command.operationId;
    card.append(element('p', `${r.command.action.description} — ${r.result.outcome}${r.result.twist ? ' + Twist' : ''} · saved`));
    const details = element('details');
    details.append(element('summary', 'Dice and mechanics'));
    details.append(element('p', `Pool ${r.result.pool}: ${r.command.action.edge ?? 'No Edge'}; ${r.command.action.skill?.name ?? 'no Skill or Lore'}; Advantage: ${r.command.action.advantageSources.join(', ') || 'none'}.`), element('p', `Rolled ${r.result.draws.join(', ')}. Surviving dice ${r.result.survivors.join(', ')}.${r.result.fallback ? ' Uncut fallback: a six counts as Conflict; no Twist.' : ''}`), element('p', `Costs: ${r.costs.join('; ') || 'none'}. Sheet changes: ${r.effects.join('; ') || 'none'}.`), element('p', `Revision ${r.revision} · operation ${r.command.operationId} · source ${r.command.source.messageId}`));
    const cuts = r.result.cuts;
    const origin = r.result.origin;
    details.append(element('p', `Uncapped pool ${origin.uncappedPool} · active class bonus +${origin.classBonus} · Origin Overflow ${origin.overflow}. Rolled pool ${r.result.pool} (cap 6).`), element('p', `Mandatory Cuts: before Overflow ${origin.mandatoryCuts}, remaining ${origin.remainingMandatoryCuts}. Voluntary Cuts: ${origin.voluntaryCuts}, unchanged. Effective total ${cuts.total}. Unused overflow is lost; conditions, permissions and rank-gap impact remain.`));
    details.append(element('p', `Cut sources: difficulty ${cuts.difficulty}, rank gap ${cuts.rankGap}, Mire ${cuts.mire}, Mana Strain ${cuts.injury}, voluntary Precision ${cuts.precision}, voluntary Impact ${cuts.impact}. Effective Cuts ${cuts.total}. Removed: ${r.result.removed.join(', ') || 'none'}.`), element('p', `Impact: ${r.result.impact} (base ${r.command.action.baseImpact ?? 'Normal'}). Low: one fewer box; Normal: one; High: one extra; Massive: whole track. Apply consequences manually.`));
    if (r.command.action.permission)
        details.append(element('p', `Permission: ${r.command.action.permission}`));
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
