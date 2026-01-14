window.Color = {
    init: async function (config = {}) {
        const {
            planet = 'planet-r0.00,0.98,0.69g-0.85,-0.49,0.69b0.85,-0.49,0.69',
            color = 'ffffff', // Store owner's hex
            action = 'store_ops',
            targetDiv
        } = config;

        // Store Owner Room ID
        const storeRoomId = "color-" + color;


        const Spectrum = (() => {
            const TRACKERS = [
                'wss://tracker.webtorrent.dev',
                'wss://tracker.openwebtorrent.com',
                'wss://tracker.btorrent.xyz'
            ];
            const OFFER_POOL_SIZE = 5;
            const OFFER_TTL = 57333;
            const ANNOUNCE_INTERVAL = 33333;
            const ICE_TIMEOUT = 5000;
            const RTC_CONFIG = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun.cloudflare.com:3478' }
                ]
            };
            const charSet = '0123456789AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz';
            const genId = n => Array(n).fill().map(() => charSet[Math.floor(Math.random() * charSet.length)]).join('');
            const encoder = new TextEncoder();
            async function sha1Hash(str) {
                const hashBuffer = await crypto.subtle.digest('SHA-1', encoder.encode(str));
                return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(36)).join('').slice(0, 20);
            }
            function waitForIce(pc) {
                return Promise.race([
                    new Promise(resolve => {
                        const checkState = () => {
                            if (pc.iceGatheringState === 'complete') {
                                pc.removeEventListener('icegatheringstatechange', checkState);
                                resolve();
                            }
                        };
                        pc.addEventListener('icegatheringstatechange', checkState);
                        checkState();
                    }),
                    new Promise(resolve => setTimeout(resolve, ICE_TIMEOUT))
                ]).then(() => ({
                    type: pc.localDescription.type,
                    sdp: pc.localDescription.sdp.replace(/a=ice-options:trickle\s\n/g, '')
                }));
            }
            return {
                joinRoom: (config, roomId) => {
                    const selfId = genId(20);
                    let infoHash = null;
                    const connectedPeers = {};
                    const pendingOffers = {};
                    const handledOffers = new Set();
                    const trackerSockets = {};
                    let offerPool = [];
                    const messageHandlers = {}; // namespace -> [handler]
                    const listeners = { peerJoin: [], peerLeave: [] };

                    async function init() {
                        infoHash = await sha1Hash(roomId);
                        await fillOfferPool();
                        TRACKERS.forEach(url => connectToTracker(url));
                        setInterval(() => {
                            const now = Date.now();
                            offerPool = offerPool.filter(o => {
                                if (now - o.created > OFFER_TTL) { o.pc.close(); return false; }
                                return true;
                            });
                            fillOfferPool();
                        }, OFFER_TTL);
                    }
                    init();

                    function connectToTracker(url) {
                        const ws = new WebSocket(url);
                        trackerSockets[url] = ws;
                        ws.onopen = () => startAnnouncing(ws, url);
                        ws.onmessage = e => {
                            try {
                                const data = typeof e.data === 'string' ? JSON.parse(e.data) : null;
                                if (data) handleTrackerMessage(ws, data);
                            } catch (err) { }
                        };
                        ws.onclose = () => {
                            delete trackerSockets[url];
                            setTimeout(() => connectToTracker(url), 5000);
                        };
                        ws.onerror = () => { };
                    }
                    async function startAnnouncing(ws, url) {
                        const announce = async () => {
                            if (ws.readyState !== WebSocket.OPEN) return;
                            const offers = getOffersFromPool(3);
                            if (offers.length === 0) return;
                            for (const o of offers) {
                                pendingOffers[o.offerId] = { pc: o.pc, dc: o.dc, created: o.created };
                                setTimeout(() => {
                                    if (pendingOffers[o.offerId]) {
                                        pendingOffers[o.offerId].pc.close();
                                        delete pendingOffers[o.offerId];
                                    }
                                }, OFFER_TTL);
                            }
                            const msg = { action: 'announce', info_hash: infoHash, peer_id: selfId, numwant: OFFER_POOL_SIZE, offers: offers.map(o => ({ offer_id: o.offerId, offer: { type: o.offer.type, sdp: o.offer.sdp } })) };
                            ws.send(JSON.stringify(msg));
                        };
                        await announce();
                        setInterval(announce, ANNOUNCE_INTERVAL);
                    }
                    function createPeerConnection(isInitiator, onDataChannel) {
                        const pc = new RTCPeerConnection(RTC_CONFIG);
                        let dc = null;
                        if (isInitiator) {
                            dc = pc.createDataChannel('data');
                            dc.binaryType = 'arraybuffer';
                        } else {
                            pc.ondatachannel = e => {
                                dc = e.channel;
                                dc.binaryType = 'arraybuffer';
                                onDataChannel?.(dc);
                            };
                        }
                        pc.onconnectionstatechange = () => {
                            if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
                                for (const [peerId, peer] of Object.entries(connectedPeers)) {
                                    if (peer.pc === pc) {
                                        delete connectedPeers[peerId];
                                        listeners.peerLeave.forEach(cb => cb(peerId));
                                        break;
                                    }
                                }
                            }
                        };
                        return { pc, dc };
                    }
                    async function createOffer() {
                        const { pc, dc } = createPeerConnection(true);
                        const offerId = genId(20);
                        await pc.setLocalDescription(await pc.createOffer());
                        const offer = await waitForIce(pc);
                        return { pc, dc, offer, offerId, created: Date.now() };
                    }
                    async function fillOfferPool() {
                        const needed = OFFER_POOL_SIZE - offerPool.length;
                        if (needed > 0) offerPool.push(...(await Promise.all(Array(needed).fill().map(() => createOffer()))));
                    }
                    function getOffersFromPool(n) {
                        const now = Date.now();
                        offerPool = offerPool.filter(o => { if (now - o.created > OFFER_TTL) { o.pc.close(); return false; } return true; });
                        const taken = offerPool.splice(0, n);
                        fillOfferPool();
                        return taken;
                    }
                    function setupDataChannel(dc, peerId) {
                        dc.onopen = () => listeners.peerJoin.forEach(cb => cb(peerId));
                        dc.onclose = () => { delete connectedPeers[peerId]; listeners.peerLeave.forEach(cb => cb(peerId)); };
                        dc.onmessage = e => {
                            try {
                                const payload = JSON.parse(e.data);
                                const handlers = messageHandlers[payload.ns];
                                if (handlers) handlers.forEach(cb => cb(payload.data, peerId));
                            } catch (err) { }
                        };
                    }
                    async function handleTrackerMessage(ws, data) {
                        if (data.info_hash !== infoHash || data.peer_id === selfId) return;
                        if (data.offer && data.offer_id) {
                            if (handledOffers.has(data.offer_id) || connectedPeers[data.peer_id]) return;
                            handledOffers.add(data.offer_id);
                            const hasPending = Object.values(pendingOffers).some(p => p.peerId === data.peer_id);
                            if (hasPending && selfId > data.peer_id) return;
                            try {
                                const { pc, dc } = createPeerConnection(false, channel => { setupDataChannel(channel, data.peer_id); connectedPeers[data.peer_id].dc = channel; });
                                await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                                await pc.setLocalDescription(await pc.createAnswer());
                                const answer = await waitForIce(pc);
                                connectedPeers[data.peer_id] = { pc, dc: null };
                                ws.send(JSON.stringify({ action: 'announce', info_hash: infoHash, peer_id: selfId, to_peer_id: data.peer_id, offer_id: data.offer_id, answer: { type: answer.type, sdp: answer.sdp } }));
                            } catch (err) { }
                        }
                        if (data.answer && data.offer_id) {
                            const pending = pendingOffers[data.offer_id];
                            if (!pending || connectedPeers[data.peer_id]) { if (pending) { pending.pc.close(); delete pendingOffers[data.offer_id]; } return; }
                            try {
                                await pending.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                                connectedPeers[data.peer_id] = { pc: pending.pc, dc: pending.dc };
                                setupDataChannel(pending.dc, data.peer_id);
                                delete pendingOffers[data.offer_id];
                            } catch (err) { pending.pc.close(); delete pendingOffers[data.offer_id]; }
                        }
                    }
                    return {
                        makeAction: (namespace) => {
                            if (!messageHandlers[namespace]) messageHandlers[namespace] = [];
                            return [
                                (data, targetPeer) => {
                                    const msg = JSON.stringify({ ns: namespace, data });
                                    if (targetPeer) {
                                        const p = connectedPeers[targetPeer];
                                        if (p && p.dc && p.dc.readyState === 'open') p.dc.send(msg);
                                    } else {
                                        Object.values(connectedPeers).forEach(p => { if (p.dc && p.dc.readyState === 'open') p.dc.send(msg); });
                                    }
                                },
                                (cb) => messageHandlers[namespace].push(cb)
                            ];
                        },
                        onPeerJoin: cb => listeners.peerJoin.push(cb),
                        onPeerLeave: cb => listeners.peerLeave.push(cb),
                        getPeers: () => Object.keys(connectedPeers)
                    };
                }
            };
        })();

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
                    z-index: 9999;
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
                    console.log("Connecting to Store Room:", storeRoomId);
                    room = Spectrum.joinRoom({ appId: planet }, storeRoomId);
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
