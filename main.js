
// Collaborative data Application with P2P Synchronization
// Summary: This script creates a collaborative data application using PeerJS for peer-to-peer communication. 
// The data are displayed in a scrollable container and synchronized between connected peers. 
// Users can format text, insert links and images, and the content is saved locally for persistence.
// Sections: 
// 1. Display and Content Management: Manages content display, local storage, and user input.
// 2. PeerJS Connection and Communication: Handles P2P connections and content synchronization.
// 3. Tools Functionality: Manages text formatting and user interactions via the tools.

const display = document.getElementById('display');
const container = document.getElementById('container');
const statusIndicator = document.querySelector('.status-indicator');
const statusText = document.getElementById('status-text');
const peerCountElement = document.getElementById('peer-count');
const tools = document.getElementById('tools');
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
Key functions are `initData()`, `saveContentToStorage()`, `getContentFromStorage()`, 
`handleEnterKey()`, and `handleScroll()`.

-----------------------------------------------------------*/

// Initialize the data display based on stored content or create a placeholder
function initData() {
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
    localStorage.setItem(`#${peerId}`, JSON.stringify(lines));
}

// Retrieve the content from localStorage for a given peer ID
function getContentFromStorage(peerId) {
    const storedContent = localStorage.getItem(`#${peerId}`);
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

// Handle Enter key press for new line behavior
display.addEventListener('keydown', handleEnterKey);

// Handle scroll for infinite scroll functionality
container.addEventListener('scroll', handleScroll);




/*-------------------------------------------

COLOR LOGIN

This section handles everything related to the color login form 

-----------------------------------------------------------*/

const colorInput = document.getElementById('color');
        const loginButton = document.querySelector('button[type="submit"]');

        function isLightColor(color) {
            const hex = color.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            return brightness > 155;
        }

        function updateButtonColor(color) {
            loginButton.style.backgroundColor = color;
            if (isLightColor(color)) {
                loginButton.style.color = 'rgba(0, 0, 0, 0.8)';
            } else {
                loginButton.style.color = 'white';
            }
        }

        function getSuggestion(value) {
            switch (value.length) {
                case 1: return value.repeat(6);
                case 2: return value.repeat(3);
                case 3: return value.repeat(2);
                default: return '';
            }
        }

        colorInput.addEventListener('input', function() {
            this.value = this.value.replace(/[^0-9a-f]/gi, '').toLowerCase();

            const color = this.value;
            const suggestion = getSuggestion(color);

            if (color.length <= 3) {
                updateButtonColor('#' + suggestion);
            } else if (color.length === 6) {
                updateButtonColor('#' + color);
            }
        });
        

/*-------------------------------------------
PEERJS CONNECTION AND COMMUNICATION

This section handles everything related to PeerJS connections and communication between peers. 
It includes functions like initPeerJS(), updateConnectionStatus(), updatePeerCount(), and broadcastData() 
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
    const form = document.getElementById('login');

    if (!hash) {
        // No hash in the URL, this user will act as the server (or initial peer)
        console.log('No hash found, setting up as server.');
        form.style.display = 'block'; // Show the form for server
        setupServer(form);
    } else {
        // Hash exists, try to reconnect as a client
        const remotePeerId = hash.slice(1);
        appConfig.peerId = remotePeerId; // Set the peerId from the hash
        console.log(`Hash found: ${remotePeerId}, attempting to reconnect as client.`);
        form.style.display = 'none'; // Hide the form for client
        attemptClientReconnection(remotePeerId);
    }
}

function setupServer(form) {
    isServer = true;

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const userPeerId = document.getElementById('color').value.trim();
        if (userPeerId) {
            initializePeer(userPeerId, form, true);
        }
    });
}

function attemptClientReconnection(remotePeerId) {
    peer = new Peer(); // Create a new peer without specifying an ID

    peer.on('open', (id) => {
        console.log(`Client Peer ID: ${id}`);
        connectToPeer(remotePeerId); // Connect to the server peer
    });

    peer.on('connection', handleNewConnection);

    peer.on('error', (err) => {
        console.error('PeerJS Error:', err);
        // If connection fails, treat it as a new connection attempt using the hash
        console.log('Client connection failed, attempting to reconnect using the hash.');
        initializePeer(remotePeerId, document.getElementById('login'), false); // Attempt to reconnect
    });

    // Check if data exists in localStorage for this peer ID
    const storedData = localStorage.getItem(`#${remotePeerId}`); // Ensure the key includes '#'
    if (storedData) {
        console.log('Local data found, loading content from storage.');
        loadContentFromStorage(remotePeerId); // Load local data if connection fails
    } else {
        console.log('No local data found for this peer ID.');
    }
}

function initializePeer(peerId, form, isServer) {
    // Close any existing peer connection before creating a new one
    if (peer) {
        peer.destroy(); // Clean up the previous peer connection
    }

    peer = new Peer(peerId);

    peer.on('open', (id) => {
        console.log(`${isServer ? 'Server' : 'Client'} Peer ID: ${id}`);
        window.location.hash = id; // Append peer ID to URL
        appConfig.peerId = id; // Set peerId in config
        if (isServer) {
            document.body.removeChild(form); // Remove the form from the document
            initData(); // Initialize data for the server
            updateConnectionStatus(true); // Update connection status to connected
        }
    });

    peer.on('connection', handleNewConnection);

    peer.on('error', (err) => {
        console.error('PeerJS Error:', err);
        alert('An error occurred with the P2P connection: ' + err.message);
    });
}

// Handle new incoming connections and send current content if server
function handleNewConnection(connection) {
    connections.push(connection);
    setupConnectionListeners(connection);
    updatePeerCount();

    // Send current content to the new peer
    connection.on('open', () => {
        connection.send({ type: 'content', data: display.innerHTML });
        broadcastPeerCount(); // Broadcast peer count to all peers
    });
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
        broadcastPeerCount(); // Broadcast peer count to all peers
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
    } else if (data.type === 'peerCount') {
        updatePeerCountDisplay(data.count);
    }
}

// Update the connection status indicator
function updateConnectionStatus(connected) {
    statusIndicator.style.backgroundColor = connected ? '#00FF00' : '#FF0000';
    statusText.textContent = connected ? 'Connected' : 'Disconnected';
}

// Update the displayed peer count and broadcast it to others
function updatePeerCount() {
    const peerCount = connections.length;
    peerCountElement.textContent = `Peers: ${peerCount}`;

    // Broadcast updated peer count to all connections
    connections.forEach(conn => {
        if (conn.open) {
            conn.send({ type: 'peerCount', count: peerCount });
        }
    });
}

// Update the peer count display only (for incoming peer count updates)
function updatePeerCountDisplay(count) {
    peerCountElement.textContent = `Peers: ${count}`;
}

// Function to broadcast the peer count to all connected peers
function broadcastPeerCount() {
    const peerCount = connections.length;
    connections.forEach(conn => {
        if (conn.open) {
            conn.send({ type: 'peerCount', count: peerCount });
        }
    });
}

// Function to load content from localStorage
function loadContentFromStorage(peerId) {
    const storedContent = localStorage.getItem(`#${peerId}`);
    if (storedContent) {
        display.innerHTML = JSON.parse(storedContent).join('<br>');
    }
}

/*-------------------------------------------
TOOLS FUNCTIONALITY

This section manages the tools used for formatting text within the content-editable area. 
It includes functions like `showTools()`, `hideTools()`, `formatText()`, `insertLink()`, 
and `insertImage()` to handle text formatting, link insertion, and image insertion.

-----------------------------------------------------------*/

// Show the formatting tools
function showTools() {
    tools.classList.add('visible');
}

// Hide the formatting tools
function hideTools() {
    tools.classList.remove('visible');
}

// Apply formatting to selected text
function formatText(style) {
    document.execCommand(style, false, null);
    display.focus();
}

// Insert a hyperlink at the current cursor position
function insertLink() {
    const url = prompt('Enter the URL:');
    if (url) {
        document.execCommand('createLink', false, url);
    }
    display.focus();
}

// Insert an image at the current cursor position
function insertImage() {
    const url = prompt('Enter the image URL:');
    if (url) {
        document.execCommand('insertImage', false, url);
    }
    display.focus();
}
// Change the font size of the selected text
function changeFontSize(increment) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const selectedText = range.toString();
        
        if (selectedText) {
            const span = document.createElement('span');
            const currentSize = parseInt(window.getComputedStyle(display).fontSize);
            span.style.fontSize = `${currentSize + increment}px`;
            span.textContent = selectedText;

            range.deleteContents(); // Remove the selected text
            range.insertNode(span); // Insert the new span with updated font size
            display.focus();
        }
    }
}

// Handle selection changes to show or hide the tools
function handleSelection() {
    if (window.getSelection().toString().trim()) {
        showTools();
    } else {
        hideTools();
    }
}

// Handle tools button clicks for text formatting
function handleToolsClick(e) {
    const buttonId = e.target.id;
    switch (buttonId) {
        case 'bold-button':
            formatText('bold');
            break;
        case 'italic-button':
            formatText('italic');
            break;
        case 'underline-button':
            formatText('underline');
            break;
        case 'link-button':
            insertLink();
            break;
        case 'image-button':
            insertImage();
            break;
        case 'increase-heading':
            changeFontSize(1); // Increase font size by 1px
            break;
        case 'decrease-heading':
            changeFontSize(-1); // Decrease font size by 1px
            break;
    }
}

/*-------------------------------------------
INITIALIZATION AND EVENT BINDINGS

This section is responsible for initializing the application, setting up event listeners 
for user interactions, and binding the tools buttons to their respective functions.

-----------------------------------------------------------*/

// Initialize the application
window.addEventListener('load', () => {
    initPeerJS();
    initData();
});

// Maintain scroll position during window resize
window.addEventListener('resize', () => {
    const scrollPercentage = container.scrollTop / container.scrollHeight;
    requestAnimationFrame(() => {
        container.scrollTop = scrollPercentage * container.scrollHeight;
    });
});

// Bind the tools buttons to the corresponding formatting functions
tools.addEventListener('click', handleToolsClick);

// Handle input, keydown, mouseup, and keyup events for content manipulation and tools interaction
display.addEventListener('keydown', handleEnterKey);
display.addEventListener('input', () => {
    const content = interpretHTML();
    maintainEmptyLines();
    broadcastData(content, connections, appConfig);
});
display.addEventListener('mouseup', handleSelection);
display.addEventListener('keyup', handleSelection);
container.addEventListener('scroll', handleScroll);

// Handle paste event to embed images
display.addEventListener('paste', (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            const reader = new FileReader();
            reader.onload = function(event) {
                const img = document.createElement('img');
                img.src = event.target.result; // Base64 string
                insertImageAtCursor(img);
            };
            reader.readAsDataURL(file); // Convert to Base64
            e.preventDefault(); // Prevent default paste behavior
            break; // Only handle the first image
        }
    }
});

// Function to insert an image at the current cursor position
function insertImageAtCursor(img) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents(); // Remove any selected text
        range.insertNode(img); // Insert the image
        range.collapse(false); // Move the cursor after the inserted image
        selection.removeAllRanges();
        selection.addRange(range);
    }
}
