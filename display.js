class DisplayManager {
    constructor() {
        this.display = document.getElementById('notes-display');
        this.container = document.getElementById('notes-container');
        this.toolbar = document.getElementById('toolbar');
        this.lineHeight = 21;
        this.lastSyncedContent = '';

        this.initEventListeners();
    }

    initNotes() {
        const peerId = window.location.hash.slice(1);
        const storedContent = this.getContentFromStorage(peerId);

        if (storedContent) {
            this.display.innerHTML = storedContent;
        } else {
            const viewportHeight = window.innerHeight;
            const totalLines = Math.floor(viewportHeight / this.lineHeight) * 3;
            this.display.innerHTML = '<br>'.repeat(totalLines);
        }

        this.container.scrollTop = this.container.scrollHeight / 3;
        this.display.focus();
    }

    interpretHTML() {
        // ... (same as before)
    }

    handleEnterKey(e) {
        // ... (same as before)
    }

    handleScroll() {
        // ... (same as before)
    }

    maintainEmptyLines() {
        // ... (same as before)
    }

    showToolbar() {
        this.toolbar.classList.add('visible');
    }

    hideToolbar() {
        this.toolbar.classList.remove('visible');
    }

    formatText(style) {
        document.execCommand(style, false, null);
        this.display.focus();
    }

    insertLink() {
        // ... (same as before)
    }

    insertImage() {
        // ... (same as before)
    }

    handleSelection() {
        if (window.getSelection().toString().trim()) {
            this.showToolbar();
        } else {
            this.hideToolbar();
        }
    }

    handleToolbarClick(e) {
        // ... (same as before)
    }

    initEventListeners() {
        this.display.addEventListener('keydown', this.handleEnterKey.bind(this));
        this.display.addEventListener('input', () => {
            this.interpretHTML();
            this.maintainEmptyLines();
            this.onContentChange(this.display.innerHTML);
        });
        this.display.addEventListener('mouseup', this.handleSelection.bind(this));
        this.display.addEventListener('keyup', this.handleSelection.bind(this));
        this.container.addEventListener('scroll', this.handleScroll.bind(this));
        this.toolbar.addEventListener('click', this.handleToolbarClick.bind(this));
        window.addEventListener('resize', () => {
            const scrollPercentage = this.container.scrollTop / this.container.scrollHeight;
            requestAnimationFrame(() => {
                this.container.scrollTop = scrollPercentage * this.container.scrollHeight;
            });
        });
    }

    setContent(content) {
        this.display.innerHTML = content;
    }

    getContent() {
        return this.display.innerHTML;
    }

    onContentChange(callback) {
        this.contentChangeCallback = callback;
    }

    saveContentToStorage(peerId, content) {
        const lines = content.split('<br>');
        localStorage.setItem(`notes_${peerId}`, JSON.stringify(lines));
    }

    getContentFromStorage(peerId) {
        const storedContent = localStorage.getItem(`notes_${peerId}`);
        if (storedContent) {
            return JSON.parse(storedContent).join('<br>');
        }
        return null;
    }
}

export default DisplayManager;
