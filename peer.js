const PeerModule = (function() {
    let peer, connections = [];
    let isServer = false;
    let contentCallback = null;
    let statusCallback = null;
    let peerCountCallback = null;

    function init(options) {
        statusCallback = options.onStatusChange;
        peerCountCallback = options.onPeerCountChange;
        contentCallback = options.onContentChange;

        const hash = window.location.hash;

        peer = new Peer();

        peer.on('open', (id) => {
            updateStatus(true);
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
            updateStatus(false);
            alert('An error occurred with the P2P connection: ' + err.message);
        });
    }

    function handleNewConnection(connection) {
        connections.push(connection);
        setupConnectionListeners(connection);
        updatePeerCount();

        if (isServer) {
            connection.on('open', () => {
                const content = contentCallback();
                connection.send({ type: 'content', data: content });
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
            updateStatus(true);
        });

        conn.on('data', handleIncomingData);

        conn.on('close', () => {
            console.log('Connection closed, attempting to reconnect...');
            updateStatus(false);
            connections = connections.filter(c => c !== conn);
            updatePeerCount();
            if (!isServer) {
                setTimeout(() => connectToPeer(conn.peer), 3000);
            }
        });
    }

    function handleIncomingData(data) {
        if (data.type === 'content') {
            contentCallback(data.data);
        }
    }

    function broadcastData(content) {
        connections.forEach(conn => {
            if (conn.open) {
                conn.send({ type: 'content', data: content });
            }
        });
    }

    function updateStatus(connected) {
        if (statusCallback) {
            statusCallback(connected);
        }
    }

    function updatePeerCount() {
        if (peerCountCallback) {
            peerCountCallback(connections.length);
        }
    }

    return {
        init: init,
        broadcastData: broadcastData
    };
})();
