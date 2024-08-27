
      const display = document.getElementById('notes-display');
const container = document.getElementById('notes-container');
const statusIndicator = document.querySelector('.status-indicator');
const statusText = document.getElementById('status-text');
const peerCountElement = document.getElementById('peer-count');
const toolbar = document.getElementById('toolbar');
const lineHeight = 21; // Approximate line height in pixels
let peer, connections = [];
let isServer = false;
let lastSyncedContent = '';
let lastScrollTop = 0;
let userColors = {}; // Store user colors by peer ID

// Function to generate a random hex color
function getRandomColor() {
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
}

// Function to assign color to user if not already assigned
function getUserColor(peerId) {
    if (!userColors[peerId]) {
        userColors[peerId] = Object.keys(userColors).length === 0 ? '#000000' : getRandomColor();
    }
    return userColors[peerId];
}

// Save content to localStorage in key-value pair format
function saveContentToStorage(peerId, content) {
    const lines = content.split('<br>').filter(line => line.trim() !== '');
    const jsonData = {};
    
    lines.forEach(line => {
        const color = getUserColor(peerId);
        jsonData[color] = jsonData[color] ? jsonData[color] + line + '<br>' : line + '<br>';
    });

    localStorage.setItem(`notes_${peerId}`, JSON.stringify(jsonData));
}

// Get content from localStorage in key-value pair format
function getContentFromStorage(peerId) {
    const storedContent = localStorage.getItem(`notes_${peerId}`);
    if (storedContent) {
        const jsonData = JSON.parse(storedContent);
        return Object.entries(jsonData).map(([color, text]) => {
            return `<span style="color:${color};">${text}</span>`;
        }).join('');
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

        // Move the cursor after the newly inserted <br>
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
                conn.send({ type: 'content', data: content, peerId });
            }
        });
    }
}

function initPeerJS() {
    const hash = window.location.hash;

    peer = new Peer();

    peer.on('open', (id) => {
        updateConnectionStatus(true);
        console.log(`Peer ID: ${id}`);

        if (!hash) {
            isServer = true;
            window.location.hash = id;
            initNotes();
        } else {
            const remotePeerId = hash.slice(1);
            connectToPeer(remotePeerId);
        }
    });

    peer.on('connection', handleNewConnection);

    peer.on('error', (err) => {
        console.error('PeerJS Error:', err);
        updateConnectionStatus(false);
        alert('An error occurred with the P2P connection: ' + err.message);
    });
}

function handleNewConnection(connection) {
    connections.push(connection);
    setupConnectionListeners(connection);
    updatePeerCount();

    if (isServer) {
        connection.on('open', () => {
            connection.send({ type: 'content', data: display.innerHTML, peerId: peer.id });
        });
    }
}

function connectToPeer(peerId) {
    const conn = peer.connect(peerId);
    connections.push(conn);
    setupConnectionListeners(conn);
}

function setupConnectionListeners(conn) {
    conn.on('open', () => {
        console.log('Connected to peer');
        updateConnectionStatus(true);
    });

    conn.on('data', handleIncomingData);

    conn.on('close', () => {
        console.log('Connection closed, attempting to reconnect...');
        updateConnectionStatus(false);
        connections = connections.filter(c => c !== conn);
        updatePeerCount();
        if (!isServer) {
            setTimeout(() => connectToPeer(conn.peer), 3000);
        }
    });
}

function handleIncomingData(data) {
    if (data.type === 'content') {
        display.innerHTML = data.data;
        lastSyncedContent = data.data;
        saveContentToStorage(data.peerId, data.data);
    }
}

function updateConnectionStatus(connected) {
    statusIndicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
    statusText.textContent = connected ? 'Connected' : 'Disconnected';
}

function updatePeerCount() {
    peerCountElement.textContent = `Connected Peers: ${connections.length}`;
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
        function handleToolbarClick(e) {
            const buttonId = e.target.id;
            switch (buttonId) {
                case 'bold-button':
                    formatText('bold');
                    break;
                case 'italic-button':
                    formatText('italic');
                    break;
                case 'underline-button':
                    formatText('underline');
                    break;
                case 'link-button':
                    insertLink();
                    break;
                case 'image-button':
                    insertImage();
                    break;
            }
        }

        window.addEventListener('load', () => {
            initPeerJS();
            initNotes();
        });
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
        toolbar.addEventListener('click', handleToolbarClick);
