
/*-------------------------------------------
PEERJS CONNECTION AND COMMUNICATION

This section handles everything related to PeerJS connections and communication between peers. 
It includes functions like `updateConnectionStatus()`, `updatePeerCount()`, and `broadcastData()` 
to manage the connection status, update the peer count, and send data between peers.

-----------------------------------------------------------*/

function updateConnectionStatus(connected) {
    if (connected) {
        statusIndicator.classList.remove('disconnected');
        statusIndicator.classList.add('connected');
        statusText.textContent = 'Connected';
    } else {
        statusIndicator.classList.remove('connected');
        statusIndicator.classList.add('disconnected');
        statusText.textContent = 'Disconnected';
    }
}

function updatePeerCount() {
    peerCountElement.textContent = connections.length;
}

// Broadcast data to connected peers (you should insert the `broadcastData()` function here)

// Initialize PeerJS (you should insert the `initPeerJS()` function here)

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

/*-------------------------------------------
DISPLAY AND CONTENT MANAGEMENT

This section is responsible for managing the content displayed in the content-editable area, 
including loading content from localStorage, saving it, and handling scrolling and user input. 
Key functions are `initNotes()`, `saveContentToStorage()`, `getContentFromStorage()`, 
`handleEnterKey()`, and `handleScroll()`.

-----------------------------------------------------------*/

function saveContentToStorage(peerId, content) {
    const lines = content.split('<br>');
    localStorage.setItem(`notes_${peerId}`, JSON.stringify(lines));
}

function getContentFromStorage(peerId) {
    const storedContent = localStorage.getItem(`notes_${peerId}`);
    if (storedContent) {
        return JSON.parse(storedContent).join('<br>');
    }
    return null;
}

function initNotes() {
    const peerId = window.location.hash.slice(1);
    const storedContent = getContentFromStorage(peerId);

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

function handleEnterKey(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.execCommand('insertHTML', false, '<br>');
        broadcastData();
    }
}

function handleScroll() {
    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;
    const contentHeight = container.scrollHeight;

    if (scrollTop < lastScrollTop && scrollTop < viewportHeight) {
        display.innerHTML = '<br>'.repeat(5) + display.innerHTML;
        container.scrollTop = scrollTop + lineHeight * 5;
    } else if (scrollTop > lastScrollTop && scrollTop + viewportHeight >= contentHeight) {
        display.innerHTML += '<br>'.repeat(5);
    }

    lastScrollTop = container.scrollTop;
}

// Event listeners for display and content management
window.addEventListener('resize', () => {
    lastScrollTop = container.scrollTop;
    initNotes();
});

display.addEventListener('keydown', handleEnterKey);
display.addEventListener('input', interpretHTML);
container.addEventListener('scroll', handleScroll);


/*-------------------------------------------
TOOLBAR FUNCTIONALITY

This section manages the toolbar used for formatting text within the content-editable area. 
It includes functions like `showToolbar()`, `hideToolbar()`, `formatText()`, `insertLink()`, 
and `insertImage()` to handle text formatting, link insertion, and image insertion.

-----------------------------------------------------------*/

function showToolbar() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        toolbar.style.top = `${rect.top - 40}px`;
        toolbar.style.left = `${rect.left}px`;
        toolbar.style.display = 'block';
    } else {
        hideToolbar();
    }
}

function hideToolbar() {
    toolbar.style.display = 'none';
}

function formatText(style) {
    document.execCommand(style);
    broadcastData();
}

function insertLink() {
    const url = prompt('Enter the URL:', 'http://');
    if (url) {
        document.execCommand('createLink', false, url);
        broadcastData();
    }
}

function insertImage() {
    const imageUrl = prompt('Enter the image URL:', 'http://');
    if (imageUrl) {
        document.execCommand('insertImage', false, imageUrl);
        broadcastData();
    }
}

// Event listeners for toolbar functionality
display.addEventListener('mouseup', showToolbar);
toolbar.addEventListener('click', hideToolbar);
document.getElementById('bold-btn').addEventListener('click', () => formatText('bold'));
document.getElementById('italic-btn').addEventListener('click', () => formatText('italic'));
document.getElementById('underline-btn').addEventListener('click', () => formatText('underline'));
document.getElementById('link-btn').addEventListener('click', insertLink);
document.getElementById('image-btn').addEventListener('click', insertImage);

// Initialization code
window.addEventListener('load', () => {
    window.initPeerJS();
    initNotes();
});

