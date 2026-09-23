window.Color = {
    init: async function (config = {}) {
        const {
            planet = 'planet-r0.00,0.98,0.69g-0.85,-0.49,0.69b0.85,-0.49,0.69',
            color = 'ffffff', // Store owner's hex
            action = 'store_ops',
            targetDiv,
            block = null,
            iceServers = null,
            ownerKey = null,
            onOwner = null
        } = config;

        // Store Owner Room ID
        const ownerColor = String(color).replace('#', '').toLowerCase();
        if (!/^[0-9a-f]{6}$/.test(ownerColor)) throw new Error('Color.init requires a six-digit target color.');
        if (block && !/^form(?:-[1-9]\d*)?$/.test(String(block).toLowerCase())) throw new Error('Color.init block must be form, form-2, form-3, and so on.');
        if (typeof ownerKey === 'string' && ownerKey.trim() && !/^(?:sha256[:-])?[0-9a-f]{64}$/i.test(ownerKey.trim())) throw new Error('Color.init ownerKey must be a SHA-256 fingerprint.');
        if (ownerKey && typeof ownerKey === 'object' && (ownerKey.kty !== 'EC' || ownerKey.crv !== 'P-256' || !ownerKey.x || !ownerKey.y)) throw new Error('Color.init ownerKey must be a P-256 public JWK.');
        const storeRoomId = "color-" + ownerColor;


        const Spectrum = (() => {
            const TRACKERS = [
                'wss://relay.rollcall.network',
                'wss://tracker.webtorrent.dev',
                'wss://tracker.openwebtorrent.com',
                'wss://tracker.btorrent.xyz'
            ];
            const OFFER_POOL_SIZE = 12;
            const OFFER_TTL = 57333;
            const ANNOUNCE_INTERVAL = 33333;
            const ICE_TIMEOUT = 5000;
            const RTC_CONFIG = {
                iceServers: Array.isArray(iceServers) && iceServers.length ? iceServers : [
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
                    let offerPoolFill = null;
                    let isLeaving = false;
                    const messageHandlers = {}; // namespace -> [handler]
                    const listeners = { peerJoin: [], peerLeave: [], peerError: [] };
                    const announceIntervals = [];
                    let offerPoolTimer = null;

                    async function init() {
                        infoHash = await sha1Hash(config.appId + roomId);
                        TRACKERS.forEach(url => connectToTracker(url));
                        fillOfferPool();
                        offerPoolTimer = setInterval(fillOfferPool, OFFER_TTL);
                    }
                    init().catch(error => listeners.peerError.forEach(cb => cb(null, error)));

                    function connectToTracker(url) {
                        if (isLeaving) return;
                        const ws = new WebSocket(url);
                        trackerSockets[url] = ws;
                        ws.onopen = () => startAnnouncing(ws);
                        ws.onmessage = e => {
                            try {
                                const data = typeof e.data === 'string' ? JSON.parse(e.data) : null;
                                if (data) handleTrackerMessage(ws, data);
                            } catch (err) { }
                        };
                        ws.onclose = () => {
                            clearInterval(ws.__colorAnnounceInterval);
                            delete trackerSockets[url];
                            if (!isLeaving) setTimeout(() => connectToTracker(url), 5000);
                        };
                        ws.onerror = () => { };
                    }
                    async function startAnnouncing(ws) {
                        const announce = async () => {
                            if (ws.readyState !== WebSocket.OPEN || isLeaving) return;
                            const offers = await getOffersFromPool(3);
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
                        ws.__colorAnnounceInterval = setInterval(announce, ANNOUNCE_INTERVAL);
                        announceIntervals.push(ws.__colorAnnounceInterval);
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
                            if (['failed', 'closed'].includes(pc.connectionState)) {
                                for (const [peerId, peer] of Object.entries(connectedPeers)) {
                                    if (peer.pc === pc) {
                                        delete connectedPeers[peerId];
                                        listeners.peerLeave.forEach(cb => cb(peerId));
                                        if (pc.connectionState === 'failed') listeners.peerError.forEach(cb => cb(peerId));
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
                        if (isLeaving || offerPoolFill) return offerPoolFill;
                        const now = Date.now();
                        offerPool = offerPool.filter(o => { if (now - o.created > OFFER_TTL) { o.pc.close(); return false; } return true; });
                        const needed = OFFER_POOL_SIZE - offerPool.length;
                        if (needed <= 0) return;
                        offerPoolFill = Promise.allSettled(Array(needed).fill().map(() => createOffer()))
                            .then(results => {
                                const offers = results.filter(result => result.status === 'fulfilled').map(result => result.value);
                                if (isLeaving) offers.forEach(offer => offer.pc.close()); else offerPool.push(...offers);
                                results.filter(result => result.status === 'rejected').forEach(result => listeners.peerError.forEach(cb => cb(null, result.reason)));
                            })
                            .finally(() => { offerPoolFill = null; });
                        return offerPoolFill;
                    }
                    async function getOffersFromPool(n) {
                        const now = Date.now();
                        offerPool = offerPool.filter(o => { if (now - o.created > OFFER_TTL) { o.pc.close(); return false; } return true; });
                        if (!offerPool.length) await fillOfferPool();
                        const taken = offerPool.splice(0, n);
                        fillOfferPool();
                        return taken;
                    }
                    function setupDataChannel(dc, peerId) {
                        const opened = () => listeners.peerJoin.forEach(cb => cb(peerId));
                        if (dc.readyState === 'open') opened(); else dc.onopen = opened;
                        dc.onclose = () => { delete connectedPeers[peerId]; listeners.peerLeave.forEach(cb => cb(peerId)); };
                        dc.onmessage = e => {
                            try {
                                const payload = JSON.parse(e.data);
                                const handlers = messageHandlers[payload.action || payload.ns];
                                if (handlers) handlers.forEach(cb => cb(payload.data, peerId));
                            } catch (err) { }
                        };
                    }
                    async function handleTrackerMessage(ws, data) {
                        if (data.info_hash !== infoHash || data.peer_id === selfId) return;
                        if (Array.isArray(data.offers)) {
                            for (const offer of data.offers) await handleTrackerMessage(ws, { ...data, offers: null, offer_id: offer.offer_id, offer: offer.offer });
                            return;
                        }
                        if (data.offer && data.offer_id) {
                            if (handledOffers.has(data.offer_id) || connectedPeers[data.peer_id]) return;
                            handledOffers.add(data.offer_id);
                            const hasPending = Object.values(pendingOffers).some(p => p.peerId === data.peer_id);
                            if (hasPending && selfId > data.peer_id) return;
                            try {
                                const peerEntry = { pc: null, dc: null };
                                connectedPeers[data.peer_id] = peerEntry;
                                const { pc } = createPeerConnection(false, channel => {
                                    setupDataChannel(channel, data.peer_id);
                                    if (connectedPeers[data.peer_id]) connectedPeers[data.peer_id].dc = channel;
                                    else connectedPeers[data.peer_id] = { pc, dc: channel };
                                });
                                peerEntry.pc = pc;
                                await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                                await pc.setLocalDescription(await pc.createAnswer());
                                const answer = await waitForIce(pc);
                                ws.send(JSON.stringify({ action: 'announce', info_hash: infoHash, peer_id: selfId, to_peer_id: data.peer_id, offer_id: data.offer_id, answer: { type: answer.type, sdp: answer.sdp } }));
                            } catch (err) { delete connectedPeers[data.peer_id]; }
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
                                    const msg = JSON.stringify({ action: namespace, ns: namespace, data });
                                    if (targetPeer) {
                                        const p = connectedPeers[targetPeer];
                                        if (p && p.dc && p.dc.readyState === 'open') try { p.dc.send(msg); } catch (_) { }
                                    } else {
                                        Object.values(connectedPeers).forEach(p => { if (p.dc && p.dc.readyState === 'open') try { p.dc.send(msg); } catch (_) { } });
                                    }
                                },
                                (cb) => messageHandlers[namespace].push(cb)
                            ];
                        },
                        onPeerJoin: cb => listeners.peerJoin.push(cb),
                        onPeerLeave: cb => listeners.peerLeave.push(cb),
                        onPeerError: cb => listeners.peerError.push(cb),
                        getPeers: () => connectedPeers,
                        leave: () => {
                            isLeaving = true;
                            announceIntervals.forEach(clearInterval);
                            clearInterval(offerPoolTimer);
                            Object.values(trackerSockets).forEach(ws => ws.close());
                            Object.values(connectedPeers).forEach(peer => peer.pc.close());
                            Object.values(pendingOffers).forEach(peer => peer.pc.close());
                            offerPool.forEach(offer => offer.pc.close());
                        }
                    };
                }
            };
        })();

        // SDK State
        let room = null;
        let send = null;
        let get = null;
        let pendingGetCallbacks = [];
        let sendSdk = null;
        let visitorColor = '#ffffff';
        let ownerPeer = null;
        let verifiedOwnerKey = null;
        let verifiedOwnerFingerprint = null;
        let activeBlock = null;
        let activeSchemaHash = null;
        let colorSwatch = null;
        let blockRetryTimer = null;
        let submissionTimer = null;
        const blockRequestId = crypto.randomUUID();

        // Inject Iframe
        const iframe = document.createElement('iframe');
        iframe.id = 'color-widget';
        iframe.src = block ? 'https://colorlog.in?sdk=1' : 'https://colorlog.in';
        iframe.allow = 'storage-access';
        if (block) iframe.className = 'color-sdk-identity';

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
                #color-widget.color-sdk-identity {
                    width: 1px;
                    height: 1px;
                    opacity: 0;
                    pointer-events: none;
                }
            `;
            document.head.appendChild(style);
        }

        const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
        const keyId = key => JSON.stringify([key?.kty, key?.crv, key?.x, key?.y]);
        const digest = async value => {
            const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
            return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        };
        const fingerprint = key => digest(keyId(key));
        const verify = async message => {
            try {
                const receivedKeyId = keyId(message.publicKey);
                const receivedFingerprint = await fingerprint(message.publicKey);
                const pinKey = 'color-sdk-owner:' + String(color).replace('#', '').toLowerCase();
                let pinned = null;
                try { pinned = localStorage.getItem(pinKey); } catch (_) { }
                if (ownerKey && typeof ownerKey === 'object' && keyId(ownerKey) !== receivedKeyId) throw new Error('The response is not signed by the configured Color owner.');
                if (typeof ownerKey === 'string' && ownerKey.trim() && ownerKey.trim().replace(/^sha256[:-]/i, '').toLowerCase() !== receivedFingerprint) throw new Error('The response is not signed by the configured Color owner.');
                if (!ownerKey && pinned && pinned !== receivedKeyId) throw new Error('The Color owner identity changed.');
                const key = await crypto.subtle.importKey('jwk', message.publicKey, { name: 'ECDSA', namedCurve: message.publicKey.crv || 'P-256' }, false, ['verify']);
                const signature = Uint8Array.from(atob(message.signature), char => char.charCodeAt(0));
                const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: message.publicKey.crv === 'P-521' ? 'SHA-512' : 'SHA-256' }, key, signature, new TextEncoder().encode(JSON.stringify(message.payload)));
                if (!ok) throw new Error('The Color signature is invalid.');
                try { localStorage.setItem(pinKey, receivedKeyId); } catch (_) { }
                const firstVerification = verifiedOwnerFingerprint !== receivedFingerprint;
                verifiedOwnerKey = message.publicKey;
                verifiedOwnerFingerprint = receivedFingerprint;
                const detail = { color: '#' + ownerColor, publicKey: verifiedOwnerKey, fingerprint: verifiedOwnerFingerprint, configured: !!ownerKey };
                if (firstVerification) {
                    emit('color-owner-verified', detail);
                    if (typeof onOwner === 'function') onOwner(detail);
                }
                return true;
            } catch (error) {
                emit('color-error', { error: error.message });
                return false;
            }
        };
        const renderForm = payload => {
            let schema = [];
            try { schema = JSON.parse(payload.data?.schema || '[]'); } catch (_) { }
            container.querySelectorAll('.color-sdk-form').forEach(el => el.remove());
            const wrapper = document.createElement('section');
            wrapper.className = 'color-sdk-form';
            const title = document.createElement('h2');
            title.textContent = payload.data?.formTitle || 'FORM';
            const form = document.createElement('form');
            const status = document.createElement('div');
            status.className = 'color-sdk-status';
            const addControl = (field, index) => {
                if (!field?.type || ['page', 'button', 'output'].includes(field.type)) return;
                const label = document.createElement('label');
                label.className = 'color-sdk-field';
                const caption = document.createElement('span');
                caption.textContent = field.label || field.name || 'FIELD';
                label.appendChild(caption);
                let input, datalist;
                if (field.type === 'textarea') input = document.createElement('textarea');
                else if (field.type === 'select') {
                    input = document.createElement('select');
                    input.appendChild(new Option('SELECT', ''));
                    (field.options || []).forEach(option => input.appendChild(new Option(String(option), String(option))));
                } else if (field.type === 'datalist') {
                    input = document.createElement('input');
                    datalist = document.createElement('datalist');
                    datalist.id = 'color-sdk-list-' + index;
                    input.setAttribute('list', datalist.id);
                    (field.options || []).forEach(option => datalist.appendChild(new Option(String(option), String(option))));
                } else if (field.type === 'radio' || field.type === 'checkbox') {
                    const choices = document.createElement('div');
                    choices.className = 'color-sdk-options';
                    (field.options || []).forEach((option, optionIndex) => {
                        const choice = document.createElement('label');
                        input = document.createElement('input');
                        input.type = field.type;
                        input.name = field.name || 'field_' + index;
                        input.value = String(option);
                        input.required = !!field.required && optionIndex === 0;
                        choice.append(input, document.createTextNode(String(option)));
                        choices.appendChild(choice);
                    });
                    label.appendChild(choices);
                    form.appendChild(label);
                    return;
                } else {
                    input = document.createElement('input');
                    input.type = field.type === 'file' ? 'file' : (field.type || 'text');
                    if (field.type === 'file') input.disabled = true;
                }
                input.name = field.name || 'field_' + index;
                input.placeholder = field.placeholder || '';
                input.required = !!field.required;
                label.appendChild(input);
                if (datalist) label.appendChild(datalist);
                form.appendChild(label);
            };
            schema.forEach(addControl);
            const actions = document.createElement('div');
            actions.className = 'color-sdk-actions';
            const submit = document.createElement('button');
            submit.type = 'submit';
            submit.textContent = payload.data?.formAction || 'SUBMIT';
            colorSwatch = document.createElement('span');
            colorSwatch.className = 'color-sdk-swatch';
            colorSwatch.title = visitorColor.toUpperCase();
            colorSwatch.style.backgroundColor = visitorColor;
            actions.append(submit, colorSwatch);
            form.append(actions, status);
            form.addEventListener('submit', event => {
                event.preventDefault();
                if (!ownerPeer || !sendSdk) { status.textContent = 'FORM OWNER IS OFFLINE'; return; }
                const values = {};
                schema.filter(field => field?.name && !['page', 'button', 'output', 'file'].includes(field.type)).forEach(field => {
                    const controls = [...form.elements].filter(input => input.name === field.name);
                    values[field.name] = field.type === 'checkbox' ? controls.filter(input => input.checked).map(input => input.value) : field.type === 'radio' ? controls.find(input => input.checked)?.value || '' : controls[0]?.value || '';
                });
                const requestId = crypto.randomUUID();
                form.dataset.requestId = requestId;
                status.textContent = 'SENDING...';
                submit.disabled = true;
                sendSdk({ type: 'SUBMIT_FORM', requestId, origin: location.origin, blockInstanceId: payload.instanceId, schemaHash: activeSchemaHash, visitorColor, values }, ownerPeer);
                clearTimeout(submissionTimer);
                submissionTimer = setTimeout(() => {
                    if (form.dataset.requestId !== requestId) return;
                    submit.disabled = false;
                    status.textContent = 'FORM OWNER IS OFFLINE';
                }, 15000);
            });
            wrapper.append(title, form);
            container.insertBefore(wrapper, iframe);
            emit('color-block-ready', { block: payload, verified: true });
        };
        const connect = () => {
            if (room) return;
            room = Spectrum.joinRoom({ appId: planet }, storeRoomId);
            [send, get] = room.makeAction(action);
            pendingGetCallbacks.forEach(cb => get(cb));
            pendingGetCallbacks = [];
            room.onPeerJoin(peerId => emit('color-connected', { peerId, color: '#' + ownerColor }));
            room.onPeerLeave(peerId => emit('color-disconnected', { peerId, color: '#' + ownerColor }));
            room.onPeerError((peerId, error) => emit('color-error', { peerId, error: error?.message || 'Color connection failed.' }));
            if (block) {
                const sdk = room.makeAction('sdk_ops');
                sendSdk = sdk[0];
                sdk[1](async (message, peerId) => {
                    if (message?.type !== 'SDK_RESPONSE') return;
                    const isRequestedBlock = message.payload?.kind === 'block' && message.payload.requestId === blockRequestId && message.payload.origin === location.origin && message.payload.ownerColor?.replace('#', '').toLowerCase() === ownerColor;
                    const isPendingSource = message.payload?.kind === 'source' && message.payload.requestId === blockRequestId && message.payload.origin === location.origin && message.payload.ownerColor?.replace('#', '').toLowerCase() === ownerColor;
                    const form = container.querySelector('.color-sdk-form form');
                    const isRequestedSubmission = message.payload?.kind === 'submission' && message.payload.origin === location.origin && form?.dataset.requestId === message.payload.requestId && peerId === ownerPeer;
                    if ((!isRequestedBlock && !isPendingSource && !isRequestedSubmission) || !await verify(message)) return;
                    if (isPendingSource) {
                        ownerPeer = peerId;
                        emit('color-source-pending', { origin: location.origin, color: '#' + ownerColor });
                        return;
                    }
                    if (isRequestedBlock) {
                        ownerPeer = peerId;
                        if (message.payload.block && await digest(message.payload.block.data?.schema || '[]') !== message.payload.schemaHash) return emit('color-error', { error: 'The signed form schema does not match its fingerprint.' });
                        if (message.payload.block) { activeBlock = message.payload.block; activeSchemaHash = message.payload.schemaHash; clearInterval(blockRetryTimer); renderForm(activeBlock); }
                        else emit('color-error', { error: message.payload.error || 'Form not found.' });
                    } else if (isRequestedSubmission) {
                        clearTimeout(submissionTimer);
                        form.querySelector('button[type="submit"]').disabled = false;
                        form.querySelector('.color-sdk-status').textContent = message.payload.ok ? 'FORM RECEIVED' : (message.payload.error || 'NOT SAVED');
                        if (message.payload.ok) form.reset();
                    }
                });
                const requestBlock = peerId => sendSdk({ type: 'GET_BLOCK', requestId: blockRequestId, origin: location.origin, block, visitorColor }, peerId);
                room.onPeerJoin(requestBlock);
                room.onPeerLeave(peerId => { if (peerId === ownerPeer) ownerPeer = null; });
                blockRetryTimer = setInterval(() => { if (!activeBlock) requestBlock(); }, 10000);
            }
        };

        // Listen for Color Messages from Iframe
        const handleColorMessage = event => {
            if (event.origin !== "https://colorlog.in" || event.source !== iframe.contentWindow) return;

            // Handle Color Detection (User has a color)
            const detectedColor = typeof event.data === 'string' ? event.data : event.data?.color;
            if (typeof detectedColor === 'string' && detectedColor.startsWith('#')) {
                // Determine user color (visitor)
                visitorColor = /^#[0-9a-f]{6}$/i.test(detectedColor) ? detectedColor.toLowerCase() : '#ffffff';
                if (colorSwatch) { colorSwatch.style.backgroundColor = visitorColor; colorSwatch.title = visitorColor.toUpperCase(); }
                emit('color-change', { color: visitorColor });

                // Trigger P2P Connection to Store Owner's Room
                connect();
            }

            // Handle Zoom Finished
            if (event.data && ['zoom-complete', 'zoom-finished', 'zoom-done'].includes(event.data.type)) {
                window.dispatchEvent(new Event('color-zoom-finished'));
            }
        };
        window.addEventListener('message', handleColorMessage);

        container.appendChild(iframe);
        connect();

        // Return Proxy Interface
        return {
            iframe,
            send: (data, target) => { if (send) send(data, target); },
            get: (cb) => {
                if (get) get(cb);
                else pendingGetCallbacks.push(cb);
            },
            destroy: () => { clearInterval(blockRetryTimer); clearTimeout(submissionTimer); window.removeEventListener('message', handleColorMessage); room?.leave(); iframe.remove(); },
            resetTrust: () => localStorage.removeItem('color-sdk-owner:' + ownerColor),
            get connected() { return Object.values(room?.getPeers?.() || {}).some(peer => peer.dc?.readyState === 'open'); },
            get color() { return visitorColor; },
            get ownerKey() { return verifiedOwnerKey; },
            get ownerFingerprint() { return verifiedOwnerFingerprint; },
            get block() { return activeBlock; },
            get room() { return room; }
        };
    }
};
