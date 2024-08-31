// Collaborative Notes Application with P2P Synchronization
// Summary: This script creates a collaborative notes application using PeerJS for peer-to-peer communication. 
// The notes are displayed in a scrollable container and synchronized between connected peers. 
// Users can format text, insert links and images, and the content is saved locally for persistence.
// Sections: 
// 1. Display and Content Management: Manages content display, local storage, and user input.
// 2. PeerJS Connection and Communication: Handles P2P connections and content synchronization.
// 3. Toolbar Functionality: Manages text formatting and user interactions via the toolbar.

const display = document.getElementById('notes-display');
const container = document.getElementById('notes-container');
const statusIndicator = document.querySelector('.status-indicator');
const statusText = document.getElementById('status-text');
const peerCountElement = document.getElementById('peer-count');
const toolbar = document.getElementById('toolbar');
const lineHeight = 21; // Approximate line height in pixels
let peer, connections = [];
let isServer = false;

// Configuration object to store shared variables and settings
const appConfig = {
    lastSyncedContent: '',
    peerId: window.location.hash.slice(1)
};

/*-------------------------------------------
DISPLAY AND CONTENT MANAGEMENT

This section is responsible for managing the content displayed in the content-editable area, 
including loading content from localStorage, saving it, and handling scrolling and user input. 
Key functions are `initNotes()`, `saveContentToStorage()`, `getContentFromStorage()`, 
`handleEnterKey()`, and `handleScroll()`.

-----------------------------------------------------------*/

// Initialize the notes display based on stored content or create a placeholder
function initNotes() {
    const storedContent = getContentFromStorage(appConfig.peerId);

    if (storedContent) {
        display.innerHTML = storedContent;
    } else {
        const viewportHeight = window.innerHeight;
        const totalLines = Math.floor(viewportHeight / lineHeight) * 3;
        display.innerHTML = '<br>'.repeat(totalLines);
    }

    container.scrollTop = container.scrollHeight / 3;
    display.focus();
}

// Save the content to localStorage based on the peer ID
function saveContentToStorage(peerId, content) {
    const lines = content.split('<br>');
    localStorage.setItem(`notes_${peerId}`, JSON.stringify(lines));
}

// Retrieve the content from localStorage for a given peer ID
function getContentFromStorage(peerId) {
    const storedContent = localStorage.getItem(`notes_${peerId}`);
    if (storedContent) {
        return JSON.parse(storedContent).join('<br>');
    }
    return null;
}

// Interpret HTML content and convert it from encoded format
function interpretHTML() {
    const content = display.innerHTML;
    const interpretedContent = content.replace(
        /&lt;(img|b|i|u|a)(\s+[^&]*)?&gt;(.*?)&lt;\/\1&gt;|&lt;(img|b|i|u|a)(\s+[^&]*)?(?:\/)?&gt;/gi,
        (match, tag1, attributes1, innerContent, tag2, attributes2) => {
            const tag = tag1 || tag2;
            const attributes = attributes1 || attributes2 || '';
            
            if (tag !== 'img' && !match.includes(`&lt;/${tag}&gt;`)) {
                return match;
            }

            switch (tag) {
                case 'img':
                    return `<img ${attributes.replace(/&quot;/g, '"')} alt="User inserted image">`;
                case 'a':
                    return `<a ${attributes.replace(/&quot;/g, '"')}>${innerContent}</a>`;
                case 'b':
                case 'i':
                case 'u':
                    return `<${tag}>${innerContent}</${tag}>`;
                default:
                    return match;
            }
        }
    );

    if (content !== interpretedContent) {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const startContainer = range.startContainer;
        const startOffset = range.startOffset;

        display.innerHTML = interpretedContent;

        const newRange = document.createRange();
        newRange.setStart(startContainer, startOffset);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
    }

    return interpretedContent; // Ensure interpretHTML returns the interpreted content
}

// Handle Enter key to insert a new line without causing double line breaks or adding <div>
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

// Handle scroll to dynamically add empty lines at the top and bottom
function handleScroll() {
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    if (scrollTop < clientHeight) {
        const linesToAdd = Math.floor(clientHeight / lineHeight);
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < linesToAdd; i++) {
            fragment.appendChild(document.createElement('br'));
        }
        display.insertBefore(fragment, display.firstChild);
        container.scrollTop += linesToAdd * lineHeight;
    }

    if (scrollHeight - scrollTop - clientHeight < clientHeight) {
        const linesToAdd = Math.floor(clientHeight / lineHeight);
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < linesToAdd; i++) {
            fragment.appendChild(document.createElement('br'));
        }
        display.appendChild(fragment);
    }
}

// Ensure that the content always ends with an empty line
function maintainEmptyLines() {
    const content = display.innerHTML;
    if (!content.endsWith('<br>')) {
        display.innerHTML = content + '<br>';
    }
}

/*-------------------------------------------
PEERJS CONNECTION AND COMMUNICATION

This section handles everything related to PeerJS connections and communication between peers. 
It includes functions like `initPeerJS()`, `updateConnectionStatus()`, `updatePeerCount()`, and `broadcastData()` 
to manage the connection status, update the peer count, and send data between peers.

-----------------------------------------------------------*/

// Function to broadcast the content to connected peers
function broadcastData(content, connections, config) {
    // Only broadcast if the content has changed
    if (content !== config.lastSyncedContent) {
        config.lastSyncedContent = content;

        // Save the content locally (abstracted to a separate function)
        saveContentToStorage(config.peerId, content);

        // Send content to all connected peers
        connections.forEach(conn => {
            if (conn.open) {
                conn.send({ type: 'content', data: content });
            }
        });
    }
}

// Initialize PeerJS for P2P communication
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
            appConfig.peerId = id; // Set the peerId when a new peer is created
            initNotes(); // Only initialize notes for the server
        } else {
            // Client Code
            const remotePeerId = hash.slice(1);
            appConfig.peerId = remotePeerId; // Set the peerId from the hash for the client
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

// Handle new incoming connections and send current content if server
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

// Connect to a remote peer by ID
function connectToPeer(peerId) {
    const conn = peer.connect(peerId);
    connections.push(conn);
    setupConnectionListeners(conn);
}

// Setup event listeners for the connection
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

// Handle incoming data from peers and update the content
function handleIncomingData(data) {
    if (data.type === 'content') {
        display.innerHTML = data.data;
        maintainEmptyLines();
        saveContentToStorage(appConfig.peerId, data.data); // Save new content to storage
    }
}

// Update the connection status indicator
function updateConnectionStatus(connected) {
    statusIndicator.style.backgroundColor = connected ? '#00FF00' : '#FF0000';
    statusText.textContent = connected ? 'Connected' : 'Disconnected';
}

// Update the displayed peer count
function updatePeerCount() {
    peerCountElement.textContent = `Peers: ${connections.length}`;
}

// Broadcast the data on input change
display.addEventListener('input', () => {
    const content = interpretHTML(); // Assuming interpretHTML returns the updated content
    maintainEmptyLines();  // Ensure content integrity
    broadcastData(content, connections, appConfig); // Pass connections and config as parameters
});

// Handle Enter key press for new line behavior
display.addEventListener('keydown', handleEnterKey);

// Handle scroll for infinite scroll functionality
container.addEventListener('scroll', handleScroll);

/*-------------------------------------------
TOOLBAR FUNCTIONALITY

This section manages the toolbar functionality for formatting text and inserting content 
like links or images. It includes functions like `execCommand()` for executing text 
formatting commands and `insertImage()` for inserting images into the content.

-----------------------------------------------------------*/

// Execute a formatting command on the selected text
function execCommand(command, value = null) {
    document.execCommand(command, false, value);
}

// Insert an image into the content at the current cursor position
function insertImage() {
    const imageUrl = prompt('Enter image URL:');
    if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = 'User inserted image';
        img.style.maxWidth = '100%';

        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        range.insertNode(img);

        // Place cursor after the image
        range.setStartAfter(img);
        range.setEndAfter(img);
        selection.removeAllRanges();
        selection.addRange(range);

        const content = interpretHTML(); // Interpret new content after inserting image
        maintainEmptyLines();  // Ensure content integrity
        broadcastData(content, connections, appConfig); // Broadcast the updated content
    }
}

// Bind toolbar buttons to their respective commands
document.querySelectorAll('#toolbar button').forEach(button => {
    button.addEventListener('click', () => {
        const command = button.getAttribute('data-command');
        if (command === 'insertImage') {
            insertImage();
        } else {
            execCommand(command);
        }
    });
});

// Initialize the application
initPeerJS();
initNotes();
