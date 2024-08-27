const PeerModule = (function() {
    let peer, connections = [];
    let isServer = false;
    let contentCallback = null;

    function initPeerJS(statusCallback, peerCountCallback) {
        const hash = window.location.hash;

        peer = new Peer();

        peer.on('open', (id) => {
            statusCallback(true);
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
            statusCallback(false);
            alert('An error occurred with the P2P connection: ' + err.message);
        });

         function handleNewConnection(connection) {
        connections.push(connection);
        setupConnectionListeners(connection);
        peerCountCallback(connections.length);

        if (isServer) {
            connection.on('open', () => {
                if (contentCallback) {
                    const content = contentCallback();
                    connection.send({ type: 'content', data: content });
                }
            });
        }
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
        });

        conn.on('data', handleIncomingData);

        conn.on('close', () => {
            console.log('Connection closed, attempting to reconnect...');
            connections = connections.filter(c => c !== conn);
            if (!isServer) {
                setTimeout(() => connectToPeer(conn.peer), 3000);
            }
        });
    }

    function handleIncomingData(data) {
        if (data.type === 'content' && contentCallback) {
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

    function setContentCallback(callback) {
        contentCallback = callback;
    }

    return {
        init: initPeerJS,
        broadcastData: broadcastData,
        setContentCallback: setContentCallback
    };
})();

// Uncomment the following line if using ES6 modules
// export default PeerModule;
