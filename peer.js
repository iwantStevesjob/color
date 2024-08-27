// peer.js
const PeerModule = (function() {
    let peer, connections = [];
    let isServer = false;
    let broadcastCallback, onConnectionStatusChange, onPeerCountChange, onPeerReady;
    let isReady = false;

    function initPeerJS(connectionStatusCallback, peerCountCallback, peerReadyCallback) {
        onConnectionStatusChange = connectionStatusCallback;
        onPeerCountChange = peerCountCallback;
        onPeerReady = peerReadyCallback;

        const hash = window.location.hash;

        peer = new Peer();

        peer.on('open', (id) => {
            console.log(`Peer ID: ${id}`);
            onConnectionStatusChange(true);

            if (!hash) {
                isServer = true;
                window.location.hash = id;
                setReady();
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
        console.log("New connection:", connection);
        connections.push(connection);
        setupConnectionListeners(connection);
        updatePeerCount();

        if (isServer && isReady) {
            connection.on('open', () => {
                broadcastData();
            });
        }
    }

    function connectToPeer(peerId) {
        console.log("Connecting to peer:", peerId);
        const conn = peer.connect(peerId);
        connections.push(conn);
        setupConnectionListeners(conn);
    }

    function setupConnectionListeners(conn) {
        conn.on('open', () => {
            console.log('Connected to peer');
            onConnectionStatusChange(true);
            if (!isServer) {
                setReady();
            }
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
        console.log("Received data:", data);
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
        console.log("Broadcasting data:", content);
        connections.forEach(conn => {
            if (conn.open) {
                conn.send({ type: 'content', data: content });
            }
        });
    }

    function requestContent() {
        console.log("Requesting content");
        connections.forEach(conn => {
            if (conn.open) {
                conn.send({ type: 'request_content' });
            }
        });
    }

    function setReady() {
        isReady = true;
        if (typeof onPeerReady === 'function') {
            onPeerReady();
        }
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
