
window.Color = {
    init: async function (config = {}) {
        const {
            planet = 'planet-r0.00,0.98,0.69g-0.85,-0.49,0.69b0.85,-0.49,0.69',
            color = 'ffffff',
            action = 'store_ops',
            targetDiv
        } = config;

        // User requested: "the room id should be the hex code"
        // So we use roomId directly. default is #ffffff.
        const RoomId = "color-" + hex;

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

        // Basic styles to ensure visibility if not styled by host
        if (!document.getElementById('color-widget-styles')) {
            const style = document.createElement('style');
            style.id = 'color-widget-styles';
            style.textContent = `
                #color-widget {
                    width: 320px;
                    height: 160px;
                    border: 2px solid #000;
                    border-radius: 12px;
                    background: white;
                    display: block;
                    margin: 20px auto;
                }
                 .hidden { display: none!important; }`;
            document.head.appendChild(style);
        }

        container.appendChild(iframe);

        // Listen for Color Messages
        window.addEventListener('message', (event) => {
            if (event.origin !== "https://colorlog.in") return;
            if (typeof event.data === 'string' && event.data.startsWith('#')) {
                document.body.style.backgroundColor = event.data;
            }
        });

        // Initialize Trystero
        const { joinRoom } = await import('https://cdn.jsdelivr.net/npm/trystero@0.16.0/+esm');
        const room = joinRoom({ planet }, RoomId);
        const [send, get] = room.makeAction(action);

        return { room, send, get, iframe };
    }
};
