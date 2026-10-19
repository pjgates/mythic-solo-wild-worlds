function text(tag, value) {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
}
export function renderTrack(root, name, value, renderBox) {
    const line = document.createElement(renderBox ? 'div' : 'p');
    line.append(text('strong', name));
    const boxes = document.createElement('span');
    boxes.setAttribute('role', renderBox ? 'group' : 'img');
    const states = [...value.boxes];
    const summary = text('small', '');
    function summarize() {
        const counts = `${states.filter(b => b === 'marked').length} marked, ${states.filter(b => b === 'burned').length} burned, ${states.filter(b => b === 'clear').length} clear of ${states.length} boxes`;
        boxes.setAttribute('aria-label', `${name}: ${counts}`);
        summary.textContent = counts;
    }
    for (const [index, box] of states.entries()) {
        if (renderBox) {
            renderBox(boxes, index, next => { states[index] = next; summarize(); });
            continue;
        }
        const pip = text('span', box === 'marked' ? '/' : box === 'burned' ? '×' : '');
        pip.className = `mc-pip mc-${box}`;
        pip.setAttribute('aria-hidden', 'true');
        boxes.append(pip);
    }
    boxes.className = 'mc-boxes';
    summarize();
    line.append(boxes, summary, text('small', `When full: ${value.full}`));
    root.append(line);
}
