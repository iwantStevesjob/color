window.Color = {
    init: async function (config = {}) {
        const { appId = 'red_tshirt_v2_secure', roomId = 'main_hall', action = 'store_ops' } = config;

        // Inject Iframe
        const iframe = document.createElement('iframe');
        iframe.id = 'color-widget';
        iframe.src = 'https://colorlog.in';
        iframe.allow = 'storage-access';

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
                 .hidden { display: none !important; }
             `;
            document.head.appendChild(style);
        }

        document.body.appendChild(iframe);

        // Listen for Color Messages
        window.addEventListener('message', (event) => {
            if (event.origin !== "https://colorlog.in") return;
            if (typeof event.data === 'string' && event.data.startsWith('#')) {
                document.body.style.backgroundColor = event.data;
            }
        });

        // Initialize Trystero
        const { joinRoom } = await import('https://cdn.jsdelivr.net/npm/trystero@0.16.0/+esm');
        const room = joinRoom({ appId }, roomId);
        const [send, get] = room.makeAction(action);

        return { room, send, get, iframe };
    }
};
