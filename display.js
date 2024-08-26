// display.js

export function initNotes() {
    const display = document.getElementById('notes-display');
    const container = document.getElementById('notes-container');
    const lineHeight = 21;  // Approximate line height in pixels

    const viewportHeight = window.innerHeight - 40;  // Subtract status bar height
    const totalLines = Math.floor(viewportHeight / lineHeight) * 3;  // Triple the viewport height

    if (display.innerHTML.trim() === '') {
        display.innerHTML = '<br>'.repeat(totalLines);
    }

    // Position the scroll at 1/3 of the container height
    container.scrollTop = container.scrollHeight / 3;

    display.focus();
}

export function handleScroll() {
    const container = document.getElementById('notes-container');
    const display = document.getElementById('notes-display');
    const lineHeight = 21;

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

// The rest of the functions (handleClick, interpretHTML, etc.) remain the same