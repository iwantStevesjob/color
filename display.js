const display = document.getElementById('notes-display');
const container = document.getElementById('notes-container');
const toolbar = document.getElementById('toolbar');
const lineHeight = 21; // Approximate line height in pixels
let lastScrollTop = 0;

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
        selection.removeAllRanges();
        selection.addRange(newRange);
    }

    broadcastData();
}

function handleEnterKey(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.execCommand('insertHTML', false, '<br>');
        broadcastData();
    }
}

function handleScroll() {
    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;
    const contentHeight = container.scrollHeight;

    if (scrollTop < lastScrollTop && scrollTop < viewportHeight) {
        display.innerHTML = '<br>'.repeat(5) + display.innerHTML;
        container.scrollTop = scrollTop + lineHeight * 5;
    } else if (scrollTop > lastScrollTop && scrollTop + viewportHeight >= contentHeight) {
        display.innerHTML += '<br>'.repeat(5);
    }

    lastScrollTop = container.scrollTop;
}

function showToolbar() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        toolbar.style.top = `${rect.top - 40}px`;
        toolbar.style.left = `${rect.left}px`;
        toolbar.style.display = 'block';
    } else {
        hideToolbar();
    }
}

function hideToolbar() {
    toolbar.style.display = 'none';
}

function formatText(style) {
    document.execCommand(style);
    broadcastData();
}

function insertLink() {
    const url = prompt('Enter the URL:', 'http://');
    if (url) {
        document.execCommand('createLink', false, url);
        broadcastData();
    }
}

function insertImage() {
    const imageUrl = prompt('Enter the image URL:', 'http://');
    if (imageUrl) {
        document.execCommand('insertImage', false, imageUrl);
        broadcastData();
    }
}

display.addEventListener('keydown', handleEnterKey);
display.addEventListener('input', interpretHTML);
container.addEventListener('scroll', handleScroll);
display.addEventListener('mouseup', showToolbar);
toolbar.addEventListener('click', hideToolbar);
document.getElementById('bold-btn').addEventListener('click', () => formatText('bold'));
document.getElementById('italic-btn').addEventListener('click', () => formatText('italic'));
document.getElementById('underline-btn').addEventListener('click', () => formatText('underline'));
document.getElementById('link-btn').addEventListener('click', insertLink);
document.getElementById('image-btn').addEventListener('click', insertImage);
