import DisplayManager from './display.js';

const statusIndicator = document.querySelector('.status-indicator');
const statusText = document.getElementById('status-text');
const peerCountElement = document.getElementById('peer-count');

let peer, connections = [];
let isServer = false;
let displayManager;

function initPeerJS() {
    const hash = window.location.hash;

    peer = new Peer();

    peer.on('open', (id) => {
        updateConnectionStatus(true);
        console.log(`Peer ID: ${id}`);

        if (!hash) {
            // Server Code
            isServer = true;
            window.location.hash = id;
            displayManager.initNotes(); // Only initialize notes for the server
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

function handleNewConnection(connection) {
    connections.push(connection);
    setupConnectionListeners(connection);
    updatePeerCount();

    if (isServer) {
        // Send current content to the new peer
        connection.on('open', () => {
            connection.send({ type: 'content', data: displayManager.getContent() });
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
        displayManager.setContent(data.data);
        const peerId = window.location.hash.slice(1);
        displayManager.saveContentToStorage(peerId, data.data);
    }
}

function updateConnectionStatus(connected) {
    statusIndicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
    statusText.textContent = connected ? 'Connected' : 'Disconnected';
}

function updatePeerCount() {
    peerCountElement.textContent = `Connected Peers: ${connections.length}`;
}

function broadcastData(content) {
    const peerId = window.location.hash.slice(1);
    displayManager.saveContentToStorage(peerId, content);
    connections.forEach(conn => {
        if (conn.open) {
            conn.send({ type: 'content', data: content });
        }
    });
}

window.addEventListener('load', () => {
    displayManager = new DisplayManager();
    displayManager.onContentChange(broadcastData);
    initPeerJS();
});
