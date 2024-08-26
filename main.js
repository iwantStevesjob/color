const display = document.getElementById('notes-display');
        const container = document.getElementById('notes-container');
        const statusIndicator = document.querySelector('.status-indicator');
        const statusText = document.getElementById('status-text');
        const peerCountElement = document.getElementById('peer-count');
        const lineHeight = 21; // Approximate line height in pixels
        let peer, connections = [];
        let isServer = false;
        let lastSyncedContent = '';

        function initNotes() {
            const viewportHeight = window.innerHeight - 40; // Subtract status bar height
            const totalLines = Math.floor(viewportHeight / lineHeight) * 3; // Triple the viewport height
            if (display.innerHTML.trim() === '') {
                display.innerHTML = '<br>'.repeat(totalLines);
            }
            container.scrollTop = container.scrollHeight / 3; // Position the scroll at 1/3 of the container height
            display.focus();
        }

        function handleClick(e) {
            const range = document.caretRangeFromPoint(e.clientX, e.clientY);
            if (range) {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }

        function interpretHTML() {
            const content = display.innerHTML;
            const interpretedContent = content.replace(/&lt;img\s+src=['"](.+?)['"]\s*\/?&gt;/gi, '<img src="$1" alt="User inserted image">');
            if (content !== interpretedContent) {
                const selection = window.getSelection();
                const range = selection.getRangeAt(0);
                const startContainer = range.startContainer;
                const startOffset = range.startOffset;

                display.innerHTML = interpretedContent;

                // Restore cursor position
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

            // Add more lines at the top if needed
            if (scrollTop < clientHeight) {
                const linesToAdd = Math.floor(clientHeight / lineHeight);
                const fragment = document.createDocumentFragment();
                for (let i = 0; i < linesToAdd; i++) {
                    fragment.appendChild(document.createElement('br'));
                }
                display.insertBefore(fragment, display.firstChild);
                container.scrollTop += linesToAdd * lineHeight;
            }

            // Add more lines at the bottom if needed
            if (scrollHeight - scrollTop - clientHeight < clientHeight) {
                const linesToAdd = Math.floor(clientHeight / lineHeight);
                const fragment = document.createDocumentFragment();
                for (let i = 0; i < linesToAdd; i++) {
                    fragment.appendChild(document.createElement('br'));
                }
                display.appendChild(fragment);
            }
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
                connections.forEach(conn => {
                    if (conn.open) {
                        conn.send({ type: 'content', data: content });
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

        window.addEventListener('load', () => {
            initPeerJS();
            initNotes();
        });
        window.addEventListener('resize', () => {
            if (isServer) initNotes();
        });
        display.addEventListener('click', handleClick);
        display.addEventListener('keydown', handleEnterKey);
        display.addEventListener('input', () => {
            interpretHTML();
            maintainEmptyLines();
            broadcastData();
        });
        container.addEventListener('scroll', handleScroll);