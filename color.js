window.Color = {
    init: async function (config = {}) {
        const {
            planet = 'planet-r0.00,0.98,0.69g-0.85,-0.49,0.69b0.85,-0.49,0.69',
            color = 'ffffff', // Store owner's hex
            action = 'store_ops',
            targetDiv
        } = config;

        // Room ID
        const RoomId = "color-" + color;

        // Trystero P2P connection module
        const Trystero = await import('https://cdn.jsdelivr.net/npm/trystero@0.16.0/+esm');

        // SDK State
        let room = null;
        let send = null;
        let get = null;
        let pendingGetCallbacks = [];

        // Inject Iframe
        const iframe = document.createElement('iframe');
        iframe.id = 'color-widget';
        iframe.src = 'https://colorlog.in';
        iframe.allow = 'storage-access';

        let container = document.body;
        if (targetDiv) {
            const el = document.getElementById(targetDiv);
            if (el) container = el;
        }

        // Full Screen Styles
        if (!document.getElementById('color-widget-styles')) {
            const style = document.createElement('style');
            style.id = 'color-widget-styles';
            style.textContent = `
                #color-widget {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    border: none;
                    z-index: 1;
                    background: transparent;
                }
                .hidden { display: none !important; }
            `;
            document.head.appendChild(style);
        }

        container.appendChild(iframe);

        // Listen for Color Messages from Iframe
        window.addEventListener('message', (event) => {
            if (event.origin !== "https://colorlog.in") return;

            // Handle Color Detection (User has a color)
            if (typeof event.data === 'string' && event.data.startsWith('#')) {
                // Determine user color (visitor)
                const userColor = event.data;

                // Trigger P2P Connection to Store Owner's Room
                if (!room) {
                    console.log("Connecting to Room:", RoomId);
                    room = Trystero.joinRoom({ appId: planet }, RoomId);
                    const actions = room.makeAction(action);
                    send = actions[0];
                    get = actions[1];

                    // Process pending listeners
                    if (pendingGetCallbacks.length > 0) {
                        pendingGetCallbacks.forEach(cb => get(cb));
                        pendingGetCallbacks = [];
                    }
                }
            }

            // Handle Zoom Finished
            if (event.data && event.data.type === 'zoom-finished') {
                window.dispatchEvent(new Event('color-zoom-finished'));
            }
        });

        // Return Proxy Interface
        return {
            iframe,
            send: (data) => { if (send) send(data); },
            get: (cb) => {
                if (get) get(cb);
                else pendingGetCallbacks.push(cb);
            },
            get room() { return room; }
        };
    }
};
