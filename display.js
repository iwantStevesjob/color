const display = document.getElementById('notes-display');
const container = document.getElementById('notes-container');
const lineHeight = 21; // Approximate line height in pixels

export function initNotes() {
    const viewportHeight = window.innerHeight - 40; // Subtract status bar height
    const totalLines = Math.floor(viewportHeight / lineHeight) * 3; // Triple the viewport height
    if (display.innerHTML.trim() === '') {
        display.innerHTML = '<br>'.repeat(totalLines);
    }
    container.scrollTop = container.scrollHeight / 3; // Position the scroll at 1/3 of the container height
    display.focus();
}

export function handleClick(e) {
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (range) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

export function handleEnterKey(e) {
    if (e.key === 'Enter') {
        e.preventDefault();

        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const br = document.createElement('br');

        range.deleteContents();
        range.insertNode(br);

        // Move the cursor after the newly inserted <br>
        range.setStartAfter(br);
        range.setEndAfter(br);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

export function interpretHTML() {
    const content = display.innerHTML;
    const interpretedContent = content.replace(/&lt;img\s+src=['"](.+?)['"]\s*\/?&gt;/gi, '<img src="$1" alt="User inserted image">');
    if (content !== interpretedContent) {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const startContainer = range.startContainer;
        const startOffset = range.startOffset;

        display.innerHTML = interpretedContent;

        // Restore cursor position
        const newRange = document.createRange();
        newRange.setStart(startContainer, startOffset);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
    }
}

export function handleScroll() {
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    // Add more lines at the top if needed
    if (scrollTop < clientHeight) {
        const linesToAdd = Math.floor(clientHeight / lineHeight);
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < linesToAdd; i++) {
            fragment.appendChild(document.createElement('br'));
        }
        display.insertBefore(fragment, display.firstChild);
        container.scrollTop += linesToAdd * lineHeight;
    }

    // Add more lines at the bottom if needed
    if (scrollHeight - scrollTop - clientHeight < clientHeight) {
        const linesToAdd = Math.floor(clientHeight / lineHeight);
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < linesToAdd; i++) {
            fragment.appendChild(document.createElement('br'));
        }
        display.appendChild(fragment);
    }
}

export function maintainEmptyLines() {
    const content = display.innerHTML;
    if (!content.endsWith('<br>')) {
        display.innerHTML = content + '<br>';
    }
}

export function broadcastData() {
    const content = display.innerHTML;
    if (content !== lastSyncedContent) {
        lastSyncedContent = content;
        connections.forEach(conn => {
            if (conn.open) {
                conn.send({ type: 'content', data: content });
            }
        });
    }
}