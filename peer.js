// Global variables shared with main.js
let peer, connections = [];
let isServer = false;
let lastSyncedContent = '';

function updateConnectionStatus(connected) {
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.getElementById('status-text');
    
    if (statusIndicator && statusText) {
        statusIndicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
        statusText.textContent = connected ? 'Connected' : 'Disconnected';
    } else {
        console.error('Status indicator elements not found in the DOM.');
    }
}

function updatePeerCount() {
    const peerCountElement = document.getElementById('peer-count');
    peerCountElement.textContent = `Connected Peers: ${connections.length}`;
}

function handleIncomingData(data) {
    const display = document.getElementById('notes-display');
    if (data.type === 'content') {
        display.innerHTML = data.data;
        lastSyncedContent = data.data;
        const peerId = window.location.hash.slice(1);
        saveContentToStorage(peerId, data.data);
    }
}

function handleNewConnection(connection) {
    connections.push(connection);
    setupConnectionListeners(connection);
    updatePeerCount();

    if (isServer) {
        connection.on('open', () => {
            const display = document.getElementById('notes-display');
            connection.send({ type: 'content', data: display.innerHTML });
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
