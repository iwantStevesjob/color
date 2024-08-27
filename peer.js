document.addEventListener('DOMContentLoaded', () => {
    let peer, connections = [];
    let isServer = false;

    function updateConnectionStatus(connected) {
        const statusIndicator = document.querySelector('.status-indicator');
        const statusText = document.getElementById('status-text');
        
        statusIndicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
        statusText.textContent = connected ? 'Connected' : 'Disconnected';
    }

    function handleNewConnection(connection) {
        connections.push(connection);
        setupConnectionListeners(connection);
        updatePeerCount();

        if (isServer) {
            // Send current content to the new peer
            connection.on('open', () => {
                connection.send({ type: 'content', data: document.getElementById('notes-display').innerHTML });
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
            const display = document.getElementById('notes-display');
            display.innerHTML = data.data;
            window.lastSyncedContent = data.data;
            const peerId = window.location.hash.slice(1);
            localStorage.setItem(`notes_${peerId}`, JSON.stringify(data.data.split('<br>')));
        }
    }

    function updatePeerCount() {
        const peerCountElement = document.getElementById('peer-count');
        peerCountElement.textContent = `Connected Peers: ${connections.length}`;
    }

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
                document.getElementById('status-text').textContent = 'Waiting for peers to connect...';

                peer.on('connection', handleNewConnection);
            } else {
                // Client Code
                connectToPeer(hash.slice(1));
            }
        });

        peer.on('error', (err) => {
            console.error('PeerJS Error:', err);
        });

        peer.on('disconnected', () => {
            console.log('Disconnected from PeerJS server');
            updateConnectionStatus(false);
        });
    }

    window.initPeerJS = initPeerJS;
});
