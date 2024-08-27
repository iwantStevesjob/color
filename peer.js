// peer.js
const PeerModule = (function() {
    let peer, connections = [];
    let isServer = false;
    let broadcastCallback, onConnectionStatusChange, onPeerCountChange, onInitialSync;

    function initPeerJS(connectionStatusCallback, peerCountCallback, initialSyncCallback) {
        onConnectionStatusChange = connectionStatusCallback;
        onPeerCountChange = peerCountCallback;
        onInitialSync = initialSyncCallback;

        const hash = window.location.hash;

        peer = new Peer();

        peer.on('open', (id) => {
            onConnectionStatusChange(true);
            console.log(`Peer ID: ${id}`);

            if (!hash) {
                isServer = true;
                window.location.hash = id;
            } else {
                const remotePeerId = hash.slice(1);
                connectToPeer(remotePeerId);
            }
        });

        peer.on('connection', handleNewConnection);

        peer.on('error', (err) => {
            console.error('PeerJS Error:', err);
            onConnectionStatusChange(false);
            alert('An error occurred with the P2P connection: ' + err.message);
        });
    }

    function handleNewConnection(connection) {
        connections.push(connection);
        setupConnectionListeners(connection);
        updatePeerCount();

        if (isServer) {
            connection.on('open', () => {
                broadcastData();
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
            onConnectionStatusChange(true);
            onInitialSync();
        });

        conn.on('data', handleIncomingData);

        conn.on('close', () => {
            console.log('Connection closed, attempting to reconnect...');
            onConnectionStatusChange(false);
            connections = connections.filter(c => c !== conn);
            updatePeerCount();
            if (!isServer) {
                setTimeout(() => connectToPeer(conn.peer), 3000);
            }
        });
    }

    function handleIncomingData(data) {
        if (data.type === 'content' && typeof broadcastCallback === 'function') {
            broadcastCallback(data.data);
        } else if (data.type === 'request_content') {
            broadcastData();
        }
    }

    function updatePeerCount() {
        if (typeof onPeerCountChange === 'function') {
            onPeerCountChange(connections.length);
        }
    }

    function broadcastData(content) {
        connections.forEach(conn => {
            if (conn.open) {
                conn.send({ type: 'content', data: content });
            }
        });
    }

    function requestContent() {
        connections.forEach(conn => {
            if (conn.open) {
                conn.send({ type: 'request_content' });
            }
        });
    }

    return {
        init: initPeerJS,
        broadcast: broadcastData,
        requestContent: requestContent,
        setContentCallback: (callback) => { broadcastCallback = callback; }
    };
})();

// Export the module if using ES6 modules
// export default PeerModule;
