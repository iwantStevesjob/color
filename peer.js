let peer, connections = [];
let isServer = false;

const statusIndicator = document.querySelector('.status-indicator');
const statusText = document.getElementById('status-text');
const peerCountElement = document.getElementById('peer-count');

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
    }
}

function updateConnectionStatus(connected) {
    statusIndicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
    statusText.textContent = connected ? 'Connected' : 'Disconnected';
}

function updatePeerCount() {
    peerCountElement.textContent = `Connected Peers: ${connections.length}`;
}

export { initPeerJS, handleNewConnection, connectToPeer, setupConnectionListeners, handleIncomingData, updateConnectionStatus, updatePeerCount };