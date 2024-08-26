// peer.js

let peer;
let connections = [];
let isServer = false;
let lastSyncedContent = '';

export function initPeerJS() {
    const hash = window.location.hash;

    peer = new Peer();

    peer.on('open', (id) => {
        updateConnectionStatus(true);
        console.log(`Peer ID: ${id}`);

        if (!hash) {
            // Server Code
            isServer = true;
            window.location.hash = id;
            initNotes(); // Only initialize notes for the server
        } else {
            // Client Code
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

export function connectToPeer(peerId) {
    const conn = peer.connect(peerId);
    connections.push(conn);
    setupConnectionListeners(conn);
}

function handleNewConnection(connection) {
    connections.push(connection);
    setupConnectionListeners(connection);
    updatePeerCount();

    if (isServer) {
        // Send current content to the new peer
        connection.on('open', () => {
            connection.send({ type: 'content', data: display.innerHTML });
        });
    }
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
        const peerId = window.location.hash.slice(1);
        saveContentToStorage(peerId, data.data);
    }
}

function updateConnectionStatus(connected) {
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.getElementById('status-text');
    statusIndicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
    statusText.textContent = connected ? 'Connected' : 'Disconnected';
}

function updatePeerCount() {
    const peerCountElement = document.getElementById('peer-count');
    peerCountElement.textContent = `Connected Peers: ${connections.length}`;
}

export function broadcastData(display) {
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

// Add any additional helper functions related to PeerJS if needed

// You might need to include these functions from main.js
export function saveContentToStorage(peerId, content) {
    const lines = content.split('<br>');
    localStorage.setItem(`notes_${peerId}`, JSON.stringify(lines));
}

export function getContentFromStorage(peerId) {
    const storedContent = localStorage.getItem(`notes_${peerId}`);
    if (storedContent) {
        return JSON.parse(storedContent).join('<br>');
    }
    return null;
}

