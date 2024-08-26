const display = document.getElementById('notes-display');
const container = document.getElementById('notes-container');
const toolbar = document.getElementById('toolbar');
const lineHeight = 21; // Approximate line height in pixels
let lastScrollTop = 0;

function saveContentToStorage(peerId, content) {
    const lines = content.split('<br>');
    localStorage.setItem(`notes_${peerId}`, JSON.stringify(lines));
}

function getContentFromStorage(peerId) {
    const storedContent = localStorage.getItem(`notes_${peerId}`);
    if (storedContent) {
        return JSON.parse(storedContent).join('<br>');
    }
    return null;
}

function initNotes() {
    const peerId = window.location.hash.slice(1);
    const storedContent = getContentFromStorage(peerId);

    if (storedContent) {
        display.innerHTML = storedContent;
    } else {
        const viewportHeight = window.innerHeight;
        const totalLines = Math.floor(viewportHeight / lineHeight) * 3;
        display.innerHTML = '<br>'.repeat(totalLines);
    }

    container.scrollTop = container.scrollHeight / 3;
    display.focus();
}

function interpretHTML() {
    const content = display.innerHTML;
    const interpretedContent = content.replace(
        /&lt;(img|b|i|u|a)(\s+[^&]*)?&gt;(.*?)&lt;\/\1&gt;|&lt;(img|b|i|u|a)(\s+[^&]*)?(?:\/)?&gt;/gi,
        (match, tag1, attributes1, innerContent, tag2, attributes2) => {
            const tag = tag1 || tag2;
            const attributes = attributes1 || attributes2 || '';
            
            if (tag !== 'img' && !match.includes(`&lt;/${tag}&gt;`)) {
                return match;
            }

            switch (tag) {
                case 'img':
                    return `<img ${attributes.replace(/&quot;/g, '"')} alt="User inserted image">`;
                case 'a':
                    return `<a ${attributes.replace(/&quot;/g, '"')}>${innerContent}</a>`;
                case 'b':
                case 'i':
                case 'u':
                    return `<${tag}>${innerContent}</${tag}>`;
                default:
                    return match;
            }
        }
    );

    if (content !== interpretedContent) {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const startContainer = range.startContainer;
        const startOffset = range.startOffset;

        display.innerHTML = interpretedContent;

        const newRange = document.createRange();
        newRange.setStart(startContainer, startOffset);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
    }
}

function handleEnterKey(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const br = document.createElement('br');
        
        range.deleteContents();
        range.insertNode(br);
        
        range.setStartAfter(br);
        range.setEndAfter(br);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

function handleScroll() {
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    if (scrollTop < clientHeight) {
        const linesToAdd = Math.floor(clientHeight / lineHeight);
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < linesToAdd; i++) {
            fragment.appendChild(document.createElement('br'));
        }
        display.insertBefore(fragment, display.firstChild);
        container.scrollTop += linesToAdd * lineHeight;
    }

    if (scrollHeight - scrollTop - clientHeight < clientHeight) {
        const linesToAdd = Math.floor(clientHeight / lineHeight);
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < linesToAdd; i++) {
            fragment.appendChild(document.createElement('br'));
        }
        display.appendChild(fragment);
    }

    lastScrollTop = scrollTop;
}

function maintainEmptyLines() {
    const content = display.innerHTML;
    if (!content.endsWith('<br>')) {
        display.innerHTML = content + '<br>';
    }
}

function broadcastData() {
    const content = display.innerHTML;
    if (content !== lastSyncedContent) {
        lastSyncedContent = content;
        const peerId = window.location.hash.slice(1);
        saveContentToStorage(peerId, content);
        connections.forEach(conn => {
            if (conn.open) {
                conn.send({ type: 'content', data: content });
            }
        });
    }
}

function showToolbar() {
    toolbar.classList.add('visible');
}

function hideToolbar() {
    toolbar.classList.remove('visible');
}

function formatText(style) {
    document.execCommand(style, false, null);
    display.focus();
}

function insertLink() {
    const url = prompt('Enter the URL:');
    if (url) {
        document.execCommand('createLink', false, url);
    }
    display.focus();
}

function insertImage() {
    const url = prompt('Enter the image URL:');
    if (url) {
        document.execCommand('insertImage', false, url);
    }
    display.focus();
}

function handleSelection() {
    if (window.getSelection().toString().trim()) {
        showToolbar();
    } else {
        hideToolbar();
    }
}

window.addEventListener('resize', () => {
    const scrollPercentage = container.scrollTop / container.scrollHeight;
    requestAnimationFrame(() => {
        container.scrollTop = scrollPercentage * container.scrollHeight;
    });
});
display.addEventListener('keydown', handleEnterKey);
display.addEventListener('input', () => {
    interpretHTML();
    maintainEmptyLines();
    broadcastData();
});
display.addEventListener('mouseup', handleSelection);
display.addEventListener('keyup', handleSelection);
container.addEventListener('scroll', handleScroll);
toolbar.addEventListener('click', (e) => {
    const buttonId = e.target.id;
    switch (buttonId) {
        case 'bold':
            formatText('bold');
            break;
        case 'italic':
            formatText('italic');
            break;
        case 'underline':
            formatText('underline');
            break;
        case 'link':
            insertLink();
            break;
        case 'image':
            insertImage();
            break;
    }
    hideToolbar();
});
