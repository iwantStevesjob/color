/**
 * ColorLog SDK (color.js)
 * Bridges third-party sites with the ColorLog Identity Provider.
 */
class ColorLogSDK {
    constructor() {
        this.providerOrigin = 'https://www.colorlog.in'; // Default
        this.ownerHex = null;
        this.callbacks = {};
        this.p2pRoom = null;
        this.identity = null;
    }

    /**
     * Initialize the SDK
     * @param {Object} config - { ownerHex, providerUrl? }
     */
    init(config) {
        this.ownerHex = config.ownerHex;
        if (config.providerUrl) this.providerOrigin = config.providerUrl;

        window.addEventListener('message', (e) => this._handleMessage(e));

        // Initialize Trystero or P2P equivalent here if needed, 
        // but typically we wait for authentication to broadcast.
        console.log('ColorLog SDK Initialized for Owner:', this.ownerHex);
    }

    /**
     * Check for silent authentication (existing session)
     * @returns {Promise<string|null>} Resolves with color hex if logged in, null otherwise
     */
    checkAuth() {
        return new Promise((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = `${this.providerOrigin}`;
            document.body.appendChild(iframe);

            const timeout = setTimeout(() => {
                document.body.removeChild(iframe);
                resolve(null);
            }, 3000);

            this.callbacks['COLOR_CHECK_RESULT'] = (data) => {
                clearTimeout(timeout);
                document.body.removeChild(iframe);
                if (data.color) {
                    this.identity = data.color;
                    this._connectToStoreP2P();
                    resolve(data.color);
                } else {
                    resolve(null);
                }
            };
        });
    }

    /**
     * Trigger visual 3D Login
     * @param {string} containerId - Element ID to mount the login frame
     */
    requestLogin(containerId) {
        const container = document.getElementById(containerId);
        if (!container) throw new Error(`Container ${containerId} not found`);

        container.innerHTML = '';
        const iframe = document.createElement('iframe');
        iframe.src = `${this.providerOrigin}#embed&owner=${this.ownerHex.replace('#', '')}`;
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        // WebGPU runs in the iframe's own context, no special permissions needed
        container.appendChild(iframe);

        return new Promise((resolve) => {
            this.callbacks['LOGIN_SUCCESS'] = (data) => {
                this.identity = data.color;
                this._connectToStoreP2P();
                resolve(data.color);
                // Optional: Remove iframe or keep it for customization?
                // For now, we leave it as user might want to customize.
            };
        });
    }

    _handleMessage(event) {
        if (event.origin !== this.providerOrigin) return; // Security check

        const { type, ...data } = event.data;
        if (this.callbacks[type]) {
            this.callbacks[type](data);
        }
    }

    async _connectToStoreP2P() {
        if (!this.identity || !this.ownerHex) return;

        console.log(`Joining P2P Room: store-${this.ownerHex.replace('#', '')} as ${this.identity}`);

        // Dynamic import of Trystero (served by provider or bundled?)
        // Assuming Trystero is available globally or we load it. 
        // For this implementation, we'll try to load it from CDN if not present.
        if (!window.trystero) {
            await this._loadScript('https://cdn.jsdelivr.net/npm/trystero@0.16.0/dist/trystero-torrent.min.js');
        }

        const config = { appId: 'colorlog-store' };
        this.p2pRoom = window.trystero.joinRoom(config, `store-${this.ownerHex.replace('#', '')}`);

        const [sendLogin, getLogin] = this.p2pRoom.makeAction('customer_login');

        // Broadcast presence
        // We defer slightly to ensure connection
        setTimeout(() => {
            sendLogin({
                color: this.identity,
                timestamp: Date.now(),
                lookingAt: window.location.href
            });
        }, 1000);
    }

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }
}

window.ColorSDK = new ColorLogSDK();
