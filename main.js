// main.js

const MainModule = (function() {
    const display = document.getElementById('notes-display');
    const container = document.getElementById('notes-container');
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.getElementById('status-text');
    const peerCountElement = document.getElementById('peer-count');
    const toolbar = document.getElementById('toolbar');
    const lineHeight = 21; // Approximate line height in pixels
    let lastSyncedContent = '';
    let lastScrollTop = 0;
    let currentPeerId = '';
    let isReady = false;

    function init() {
        currentPeerId = window.location.hash.slice(1);
        initNotes();
        setupEventListeners();
        PeerModule.init(updateConnectionStatus, updatePeerCount, onPeerReady);
        PeerModule.setContentCallback(handleIncomingContent);
    }

    function initNotes() {
        const storedContent = getContentFromStorage();
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

    function setupEventListeners() {
        window.addEventListener('resize', handleResize);
        display.addEventListener('keydown', handleEnterKey);
        display.addEventListener('input', handleInput);
        display.addEventListener('mouseup', handleSelection);
        display.addEventListener('keyup', handleSelection);
        container.addEventListener('scroll', handleScroll);
        toolbar.addEventListener('click', handleToolbarClick);
    }

    function handleResize() {
        const scrollPercentage = container.scrollTop / container.scrollHeight;
        requestAnimationFrame(() => {
            container.scrollTop = scrollPercentage * container.scrollHeight;
        });
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
            handleInput();
        }
    }

    function handleInput() {
        interpretHTML();
        maintainEmptyLines();
        saveContentToStorage();
        broadcastData();
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

    function interpretHTML() {
        // ... (keep the existing implementation)
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
            PeerModule.broadcast(content);
        }
    }

    function handleIncomingContent(content) {
        console.log("Received content:", content);
        if (content && content.trim() !== '') {
            display.innerHTML = content;
            lastSyncedContent = content;
            saveContentToStorage();
        }
    }

    function updateConnectionStatus(connected) {
        statusIndicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
        statusText.textContent = connected ? 'Connected' : 'Disconnected';
    }

    function updatePeerCount(count) {
        peerCountElement.textContent = `Connected Peers: ${count}`;
    }

    function handleSelection() {
        if (window.getSelection().toString().trim()) {
            showToolbar();
        } else {
            hideToolbar();
        }
    }

    function showToolbar() {
        toolbar.classList.add('visible');
    }

    function hideToolbar() {
        toolbar.classList.remove('visible');
    }

    function handleToolbarClick(e) {
        const buttonId = e.target.id;
        switch (buttonId) {
            case 'bold-button': formatText('bold'); break;
            case 'italic-button': formatText('italic'); break;
            case 'underline-button': formatText('underline'); break;
            case 'link-button': insertLink(); break;
            case 'image-button': insertImage(); break;
        }
    }

    function formatText(style) {
        document.execCommand(style, false, null);
        display.focus();
        handleInput();
    }

    function insertLink() {
        const url = prompt('Enter the URL:');
        if (url) {
            document.execCommand('createLink', false, url);
        }
        display.focus();
        handleInput();
    }

    function insertImage() {
        const url = prompt('Enter the image URL:');
        if (url) {
            document.execCommand('insertImage', false, url);
        }
        display.focus();
        handleInput();
    }

    function saveContentToStorage() {
        const lines = display.innerHTML.split('<br>');
        let lineNumber = 0;
        let consecutiveEmptyLines = 0;

        lines.forEach((line, index) => {
            if (line.trim() === '') {
                consecutiveEmptyLines++;
                if (consecutiveEmptyLines === 1 || index === lines.length - 1) {
                    localStorage.setItem(`#${currentPeerId}_${lineNumber}`, '');
                    lineNumber++;
                }
            } else {
                localStorage.setItem(`#${currentPeerId}_${lineNumber}`, line);
                lineNumber++;
                consecutiveEmptyLines = 0;
            }
        });

        // Remove any extra lines that might have been deleted
        let nextLine = localStorage.getItem(`#${currentPeerId}_${lineNumber}`);
        while (nextLine !== null) {
            localStorage.removeItem(`#${currentPeerId}_${lineNumber}`);
            lineNumber++;
            nextLine = localStorage.getItem(`#${currentPeerId}_${lineNumber}`);
        }
    }

    function getContentFromStorage() {
        let content = '';
        let lineNumber = 0;
        let line = localStorage.getItem(`#${currentPeerId}_${lineNumber}`);

        while (line !== null) {
            content += line + '<br>';
            lineNumber++;
            line = localStorage.getItem(`#${currentPeerId}_${lineNumber}`);
        }

        return content;
    }

    function onPeerReady() {
        console.log("Peer is ready");
        isReady = true;
        const storedContent = getContentFromStorage();
        if (storedContent && storedContent.trim() !== '') {
            PeerModule.broadcast(storedContent);
        } else {
            PeerModule.requestContent();
        }
    }

    return {
        init: init,
        handleIncomingContent: handleIncomingContent
    };
})();

window.addEventListener('load', MainModule.init);
