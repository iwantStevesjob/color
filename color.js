window.Color = {
    // The rainbow planet: the cone positions every Color loads with; rooms on it are the ones everybody can reach.
    rainbowPlanet: 'planet-r0.00,0.98,0.69g-0.85,-0.49,0.69b0.85,-0.49,0.69',
    // The Color app this copy of the SDK belongs to: the origin it was loaded from (https, or a localhost development
    // server), so a page using a local color.js picks its Color on that same local app. Anything else: colorlog.in.
    origin: (() => {
        try { const url = new URL(document.currentScript?.src || ''); if (url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) return url.origin } catch (_) { }
        return 'https://colorlog.in'
    })(),
    // The serverless transport (WebTorrent trackers plus MQTT brokers, offers and answers sealed with the room key).
    // Each call makes its own instance; init and room both use it.
    spectrum: function (iceServers = null) {
            const TRACKERS = [
                'wss://relay.rollcall.network',
                'wss://tracker.webtorrent.dev',
                'wss://tracker.openwebtorrent.com',
                'wss://tracker.btorrent.xyz'
            ];
            const OFFER_POOL_SIZE = 3;
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
        function sendChannelMessage(peer, message, onError) {
            peer.sendQueue = (peer.sendQueue || Promise.resolve()).then(async () => {
                if (peer.dc?.readyState !== 'open') return false
                const limit = Math.min(peer.pc?.sctp?.maxMessageSize || 65536, 48000), deadline = Date.now() + 60000
                let frames = [message]
                if (typeof message === 'string' && new TextEncoder().encode(message).length > limit) {
                    if (message.length > 8388608) throw new Error('Color message exceeds 8 MB.')
                    const width = Math.max(256, Math.min(12000, Math.floor((limit - 512) / 6))), id = crypto.randomUUID(), total = Math.ceil(message.length / width)
                    if (total > 2048) throw new Error('The negotiated channel message size is too small.')
                    frames = Array.from({ length: total }, (_, part) => JSON.stringify({ __colorFrame: 1, id, part, total, text: message.slice(part * width, (part + 1) * width) }))
                }
                for (const frame of frames) {
                    while (peer.dc.readyState === 'open' && peer.dc.bufferedAmount > 262144 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
                    if (peer.dc.readyState !== 'open' || Date.now() >= deadline) throw new Error('Color channel closed or remained congested.')
                    peer.dc.send(frame)
                }
                return true
            }).catch(error => { onError?.(error); return false })
            return peer.sendQueue
        }

        function readChannelMessage(dc, text) {
            if (typeof text !== 'string' || text.length > 8388608) return null
            const message = JSON.parse(text)
            if (message?.__colorFrame !== 1) return message
            if (typeof message.id !== 'string' || message.id.length > 64 || !Number.isInteger(message.part) || !Number.isInteger(message.total) || message.total < 1 || message.total > 2048 || message.part < 0 || message.part >= message.total || typeof message.text !== 'string' || message.text.length > 12000) return null
            const frames = dc.colorFrames ||= new Map(), now = Date.now()
            for (const [id, item] of frames) if (now - item.updated > 30000) frames.delete(id)
            if (!frames.has(message.id) && frames.size >= 8) return null
            const item = frames.get(message.id) || { total: message.total, pieces: new Map(), size: 0 }
            if (item.total !== message.total) return null
            item.size += message.text.length - (item.pieces.get(message.part)?.length || 0)
            if (item.size > 8388608) { frames.delete(message.id); return null }
            // Several large messages arriving at once may not hold more than 16 MB between them; the oldest partial one gives way.
            let buffered = item.size
            for (const [id, other] of frames) if (id !== message.id) buffered += other.size
            if (buffered > 16777216) for (const [id, other] of frames) { if (id === message.id) continue; frames.delete(id); buffered -= other.size; if (buffered <= 16777216) break }
            item.updated = now; item.pieces.set(message.part, message.text); frames.set(message.id, item)
            if (item.pieces.size !== item.total) return null
            frames.delete(message.id)
            return JSON.parse(Array.from({ length: item.total }, (_, part) => item.pieces.get(part)).join(''))
        }

            const charSet = '0123456789AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz';
            const genId = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), byte => charSet[byte % charSet.length]).join('');
            const encoder = new TextEncoder();
            async function sha1Hash(str) {
                const hashBuffer = await crypto.subtle.digest('SHA-1', encoder.encode(str));
                return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(36)).join('').slice(0, 20);
            }
            // Offers and answers cross the trackers sealed with the room's key (same scheme as the Color page).
            const SIGNAL_PREFIX = 'color-sealed-v1.';
            const signalBase64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const signalBytes = text => Uint8Array.from(atob(String(text || '').replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
            async function deriveSignalKey(appId, roomId, secret = '') {
                const material = await crypto.subtle.importKey('raw', encoder.encode(roomId + '\n' + secret), 'HKDF', false, ['deriveKey']);
                return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(appId), info: encoder.encode('color-signal-v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
            }
            async function sealSignal(key, description, senderId, offerId) {
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(senderId + ':' + offerId + ':' + description.type) }, key, encoder.encode(description.sdp));
                return { type: description.type, sdp: SIGNAL_PREFIX + signalBase64(iv) + '.' + signalBase64(new Uint8Array(data)) };
            }
            async function openSignal(key, description, senderId, offerId, type) {
                if (description?.type !== type || typeof description.sdp !== 'string' || !description.sdp.startsWith(SIGNAL_PREFIX) || description.sdp.length > 65536) throw new Error('Unsealed signaling refused.');
                const [iv, data] = description.sdp.slice(SIGNAL_PREFIX.length).split('.');
                const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: signalBytes(iv), additionalData: encoder.encode(senderId + ':' + offerId + ':' + type) }, key, signalBytes(data));
                return { type, sdp: new TextDecoder().decode(plain) };
            }
        function waitForIce(pc) {
            return new Promise((resolve, reject) => {
                const finish = () => {
                    clearTimeout(timer)
                    pc.removeEventListener('icegatheringstatechange', check)
                    const description = pc.localDescription
                    if (pc.signalingState === 'closed' || !description?.sdp) reject(new Error('WebRTC negotiation closed before ICE completed.'))
                    else resolve({ type: description.type, sdp: description.sdp.replace(/a=ice-options:trickle[^\r\n]*\r?\n/g, '') })
                }
                const check = () => { if (pc.iceGatheringState === 'complete') finish() }, timer = setTimeout(finish, ICE_TIMEOUT)
                pc.addEventListener('icegatheringstatechange', check)
                check()
            })
        }

            // Second rendezvous network (same scheme as the Color page): public MQTT brokers carry presence and sealed offers,
            // so an embed still reaches its owner when the WebTorrent trackers are down. Brokers only see ciphertext.
            const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
            const brokerHub = (() => {
                const sockets = new Map(), topics = new Map(), decoder = new TextDecoder();
                const text = value => { const bytes = encoder.encode(value); return [bytes.length >> 8, bytes.length & 255, ...bytes] };
                const packet = (type, body) => { const head = [type]; let length = body.length; do { let digit = length % 128; length = Math.floor(length / 128); if (length > 0) digit |= 128; head.push(digit) } while (length > 0); const out = new Uint8Array(head.length + body.length); out.set(head); out.set(body, head.length); return out };
                const subscribePacket = topic => packet(0x82, [0, 1, ...text(topic), 0]);
                const publishPacket = (topic, payload) => { const name = text(topic), data = encoder.encode(payload), body = new Uint8Array(name.length + data.length); body.set(name); body.set(data, name.length); return packet(0x30, body) };
                function connect(url) {
                    if (sockets.has(url)) return;
                    let ws;
                    try { ws = new WebSocket(url, 'mqtt') } catch (error) { return }
                    ws.binaryType = 'arraybuffer';
                    let buffer = new Uint8Array(0), ready = false;
                    const entry = { ws, isReady: () => ready && ws.readyState === WebSocket.OPEN };
                    sockets.set(url, entry);
                    ws.onopen = () => ws.send(packet(0x10, [...text('MQTT'), 4, 2, 0, 60, ...text('color' + genId(16))]));
                    ws.onerror = () => { };
                    ws.onclose = () => { clearInterval(ping); if (sockets.get(url) === entry) sockets.delete(url); if (topics.size) setTimeout(() => { if (topics.size) connect(url) }, 8000 + Math.random() * 4000) };
                    ws.onmessage = event => {
                        if (!(event.data instanceof ArrayBuffer)) return;
                        const chunk = new Uint8Array(event.data), joined = new Uint8Array(buffer.length + chunk.length);
                        joined.set(buffer); joined.set(chunk, buffer.length); buffer = joined;
                        if (buffer.length > 1048576) { ws.close(); return }
                        for (;;) {
                            if (buffer.length < 2) return;
                            let multiplier = 1, length = 0, index = 1, digit;
                            do { if (index >= buffer.length) return; digit = buffer[index++]; length += (digit & 127) * multiplier; multiplier *= 128 } while (digit & 128);
                            if (buffer.length < index + length) return;
                            const type = buffer[0] >> 4, body = buffer.subarray(index, index + length);
                            buffer = buffer.slice(index + length);
                            if (type === 2) { ready = body[1] === 0; if (!ready) { ws.close(); return } for (const topic of topics.keys()) ws.send(subscribePacket(topic)); for (const handlers of topics.values()) handlers.forEach(handler => handler.ready?.()) }
                            else if (type === 3 && body.length >= 2) {
                                const size = (body[0] << 8) | body[1], topic = decoder.decode(body.subarray(2, 2 + size)), payload = decoder.decode(body.subarray(2 + size));
                                topics.get(topic)?.forEach(handler => { try { handler(payload) } catch (error) { } });
                            }
                        }
                    };
                    const ping = setInterval(() => { if (entry.isReady()) ws.send(new Uint8Array([0xC0, 0])) }, 30000);
                }
                return {
                    subscribe(topic, handler) { if (!topics.has(topic)) topics.set(topic, new Set()); topics.get(topic).add(handler); BROKERS.forEach(connect); for (const entry of sockets.values()) if (entry.isReady()) entry.ws.send(subscribePacket(topic)) },
                    unsubscribe(topic, handler) { const handlers = topics.get(topic); if (!handlers) return; handlers.delete(handler); if (!handlers.size) { topics.delete(topic); for (const entry of sockets.values()) if (entry.isReady()) entry.ws.send(packet(0xA2, [0, 2, ...text(topic)])) } if (!topics.size) for (const entry of [...sockets.values()]) entry.ws.close() },
                    publish(topic, payload) { let sent = false; for (const entry of sockets.values()) if (entry.isReady()) { try { entry.ws.send(publishPacket(topic, payload)); sent = true } catch (error) { } } return sent }
                };
            })();

            return {
                joinRoom: (config, roomId) => {
                    const selfId = genId(20);
                    let infoHash = null, signalKey = null, brokerTopic = null, brokerTimer = null, lastBrokerHello = 0;
                    const brokerOffered = new Map();
                    const connectedPeers = {};
                    const pendingOffers = {};
                    const handledOffers = new Set();
                    const trackerSockets = {};
                    let offerPool = [];
                    let offerPoolFill = null;
                    let isLeaving = false;
                    const messageHandlers = {}; // namespace -> [handler]
                    const listeners = { peerJoin: [], peerLeave: [], peerError: [] };
                    const announceIntervals = new Set();
                    let offerPoolTimer = null;

                    async function init() {
                        infoHash = await sha1Hash(config.appId + roomId);
                        signalKey = await deriveSignalKey(config.appId, roomId, config.secret || '');
                        TRACKERS.forEach(url => connectToTracker(url));
                        if (!isLeaving) {
                            brokerTopic = 'color/' + infoHash;
                            brokerHub.subscribe(brokerTopic + '/all', onBrokerPresence);
                            brokerHub.subscribe(brokerTopic + '/to/' + selfId, onBrokerDirect);
                            brokerHello();
                            brokerTimer = setInterval(brokerHello, 20000 + Math.random() * 5000);
                        }
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
                            announceIntervals.delete(ws.__colorAnnounceInterval);
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
                            const msg = { action: 'announce', info_hash: infoHash, peer_id: selfId, numwant: OFFER_POOL_SIZE, offers: await Promise.all(offers.map(async o => ({ offer_id: o.offerId, offer: await sealSignal(signalKey, o.offer, selfId, o.offerId) }))) };
                            if (ws.readyState !== WebSocket.OPEN || isLeaving) return;
                            ws.send(JSON.stringify(msg));
                        };
                        await announce();
                        if (isLeaving || ws.readyState !== WebSocket.OPEN) return;
                        ws.__colorAnnounceInterval = setInterval(() => announce().catch(error => listeners.peerError.forEach(cb => cb(null, error))), ANNOUNCE_INTERVAL);
                        announceIntervals.add(ws.__colorAnnounceInterval);
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
                        try {
                            const localOffer = await pc.createOffer();
                            await pc.setLocalDescription(localOffer);
                            const offer = await waitForIce(pc);
                            return { pc, dc, offer, offerId, created: Date.now() };
                        } catch (error) { pc.close(); throw error }
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
                        const opened = () => setTimeout(() => listeners.peerJoin.forEach(cb => cb(peerId)), 0);
                        if (dc.readyState === 'open') opened(); else dc.onopen = opened;
                        dc.onclose = () => { if (connectedPeers[peerId]?.dc !== dc) return; const pc = connectedPeers[peerId].pc; delete connectedPeers[peerId]; pc?.close(); listeners.peerLeave.forEach(cb => cb(peerId)); };
                        dc.onmessage = e => {
                            try {
                                const payload = readChannelMessage(dc, e.data);
                                const handlers = messageHandlers[payload?.action || payload?.ns];
                                if (handlers) handlers.forEach(cb => cb(payload.data, peerId));
                            } catch (err) { }
                        };
                    }
                    // Broker rendezvous: presence says "I am in this room"; the lower peer id answers with one sealed offer and the
                    // answer returns the same way. The tracker handler below processes both.
                    const brokerPublish = (target, message) => brokerTopic && brokerHub.publish(brokerTopic + (target ? '/to/' + target : '/all'), JSON.stringify(message));
                    const brokerSocket = { readyState: WebSocket.OPEN, send(text) { const message = JSON.parse(text); if (message.to_peer_id && message.answer) brokerPublish(message.to_peer_id, { peer_id: message.peer_id, offer_id: message.offer_id, answer: message.answer }) } };
                    const brokerHello = () => { if (!isLeaving && brokerTopic) { lastBrokerHello = Date.now(); brokerPublish(null, { peer_id: selfId }) } };
                    const onBrokerPresence = async text => {
                        let data;
                        try { data = JSON.parse(text) } catch (error) { return }
                        const peer = data?.peer_id;
                        if (isLeaving || typeof peer !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(peer) || peer === selfId || connectedPeers[peer]) return;
                        if (selfId > peer) { if (Date.now() - lastBrokerHello > 3000) brokerHello(); return }
                        if (Date.now() - (brokerOffered.get(peer) || 0) < 15000) return;
                        // Presences cost nothing to fake and each offer is a live connection: at most 20 a minute, record pruned.
                        for (const [id, time] of brokerOffered) if (Date.now() - time > 60000) brokerOffered.delete(id);
                        if ([...brokerOffered.values()].filter(time => Date.now() - time < 60000).length >= 20) return;
                        brokerOffered.set(peer, Date.now());
                        const [offer] = await getOffersFromPool(1);
                        if (!offer) return;
                        if (isLeaving || connectedPeers[peer]) { offer.pc.close(); return }
                        pendingOffers[offer.offerId] = { pc: offer.pc, dc: offer.dc, created: offer.created };
                        setTimeout(() => { if (pendingOffers[offer.offerId]) { pendingOffers[offer.offerId].pc.close(); delete pendingOffers[offer.offerId] } }, OFFER_TTL);
                        brokerPublish(peer, { peer_id: selfId, offer_id: offer.offerId, offer: await sealSignal(signalKey, offer.offer, selfId, offer.offerId) });
                    };
                    onBrokerPresence.ready = () => brokerHello();
                    const onBrokerDirect = text => {
                        let data;
                        try { data = JSON.parse(text) } catch (error) { return }
                        if (isLeaving || typeof data?.peer_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(data.peer_id) || data.peer_id in Object.prototype || data.peer_id === selfId || typeof data.offer_id !== 'string') return;
                        handleTrackerMessage(brokerSocket, { info_hash: infoHash, peer_id: data.peer_id, offer_id: data.offer_id, offer: data.offer, answer: data.answer }).catch(() => { });
                    };
                    async function handleTrackerMessage(ws, data) {
                        if (data.info_hash !== infoHash || data.peer_id === selfId) return;
                        // Peer ids are remote input: plain characters only, and never a name every object already has.
                        if (data.peer_id != null && (typeof data.peer_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(data.peer_id) || data.peer_id in Object.prototype)) return;
                        if (Array.isArray(data.offers)) {
                            for (const offer of data.offers) await handleTrackerMessage(ws, { ...data, offers: null, offer_id: offer.offer_id, offer: offer.offer });
                            return;
                        }
                        if (isLeaving || !data.peer_id) return
                        if (data.offer && data.offer_id) {
                            const offerKey = data.peer_id + ':' + data.offer_id
                            if (handledOffers.has(offerKey) || connectedPeers[data.peer_id]) return
                            // Anything that does not open with this room's key is ignored.
                            const offer = await openSignal(signalKey, data.offer, data.peer_id, data.offer_id, 'offer').catch(() => null)
                            if (!offer || isLeaving || handledOffers.has(offerKey) || connectedPeers[data.peer_id]) return
                            handledOffers.add(offerKey); setTimeout(() => handledOffers.delete(offerKey), OFFER_TTL)
                            const peerEntry = { pc: null, dc: null, direction: 'incoming' }
                            connectedPeers[data.peer_id] = peerEntry
                            try {
                                const { pc } = createPeerConnection(false, channel => {
                                    if (isLeaving || connectedPeers[data.peer_id] !== peerEntry) { channel.close(); return }
                                    peerEntry.dc = channel; setupDataChannel(channel, data.peer_id)
                                })
                                peerEntry.pc = pc
                                setTimeout(() => { if (connectedPeers[data.peer_id] === peerEntry && peerEntry.dc?.readyState !== 'open') pc.close() }, 30000)
                                await pc.setRemoteDescription(new RTCSessionDescription(offer))
                                await pc.setLocalDescription(await pc.createAnswer())
                                const answer = await sealSignal(signalKey, await waitForIce(pc), selfId, data.offer_id)
                                if (isLeaving || connectedPeers[data.peer_id] !== peerEntry || ws.readyState !== WebSocket.OPEN) { pc.close(); return }
                                ws.send(JSON.stringify({ action: 'announce', info_hash: infoHash, peer_id: selfId, to_peer_id: data.peer_id, offer_id: data.offer_id, answer }))
                            } catch (err) { if (connectedPeers[data.peer_id] === peerEntry) delete connectedPeers[data.peer_id]; peerEntry.pc?.close() }
                        }
                        if (data.answer && data.offer_id) {
                            if (!pendingOffers[data.offer_id]) return
                            const answer = await openSignal(signalKey, data.answer, data.peer_id, data.offer_id, 'answer').catch(() => null)
                            if (!answer) return
                            data = { ...data, answer }
                            const pending = pendingOffers[data.offer_id]
                            if (!pending) return
                            const existing = connectedPeers[data.peer_id]
                            if (existing && (existing.dc?.readyState === 'open' || existing.direction === 'outgoing' || selfId > data.peer_id)) { pending.pc.close(); delete pendingOffers[data.offer_id]; return }
                            if (existing) { delete connectedPeers[data.peer_id]; existing.pc?.close() }
                            const entry = { pc: pending.pc, dc: pending.dc, direction: 'outgoing' }
                            connectedPeers[data.peer_id] = entry; delete pendingOffers[data.offer_id]
                            try {
                                setupDataChannel(pending.dc, data.peer_id)
                                await pending.pc.setRemoteDescription(new RTCSessionDescription(data.answer))
                                if (isLeaving || connectedPeers[data.peer_id] !== entry) { pending.pc.close(); return }
                                setTimeout(() => { if (connectedPeers[data.peer_id] === entry && entry.dc?.readyState !== 'open') pending.pc.close() }, 30000)
                            } catch (err) { if (connectedPeers[data.peer_id] === entry) delete connectedPeers[data.peer_id]; pending.pc.close() }
                        }
                    }
                    return {
                        makeAction: (namespace) => {
                            if (!messageHandlers[namespace]) messageHandlers[namespace] = [];
                            return [
                                (data, targetPeer) => {
                                    let msg
                                    if (namespace === 'file' && data?.type === 'chunk' && data.bytes) {
                                        const id = new TextEncoder().encode(data.fileId), bytes = data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes), packet = new Uint8Array(10 + id.length + bytes.length), view = new DataView(packet.buffer)
                                        packet.set([0x51, 0x46, 0x43, 0x31]); view.setUint32(4, data.index); view.setUint16(8, id.length); packet.set(id, 10); packet.set(bytes, 10 + id.length); msg = packet.buffer
                                    } else msg = JSON.stringify({ action: namespace, ns: namespace, data })
                                    return Promise.all(Object.entries(connectedPeers).filter(([pid]) => !targetPeer || pid === targetPeer).map(([pid, peer]) => sendChannelMessage(peer, msg, error => listeners.peerError.forEach(callback => callback(pid, error)))))
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
                            clearInterval(brokerTimer);
                            if (brokerTopic) { brokerHub.unsubscribe(brokerTopic + '/all', onBrokerPresence); brokerHub.unsubscribe(brokerTopic + '/to/' + selfId, onBrokerDirect) }
                            announceIntervals.forEach(clearInterval);
                            clearInterval(offerPoolTimer);
                            Object.values(trackerSockets).forEach(ws => ws.close());
                            Object.values(connectedPeers).forEach(peer => peer.pc?.close());
                            Object.values(pendingOffers).forEach(peer => peer.pc.close());
                            offerPool.forEach(offer => offer.pc.close());
                        }
                    };
                }
            };
    },
    // A generic shared room for a site's own app (a game world, a lobby): everyone who joins the same app and room name
    // meets peer to peer. Its id never starts with "color-", so it can never be a Color's own room. Returns the transport's
    // room: makeAction(namespace) -> [send, onMessage], onPeerJoin, onPeerLeave, getPeers, leave.
    room: function (app, name, options = {}) {
        const id = value => String(value || '').toLowerCase()
        const appId = id(app), roomName = id(name)
        if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(appId) || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(roomName)) throw new Error('Color.room needs an app and a room name of letters, digits and dashes.')
        const config = { appId: options.planet || window.Color.rainbowPlanet }
        if (options.secret) config.secret = String(options.secret)
        return window.Color.spectrum(options.iceServers || null).joinRoom(config, 'app-' + appId + '-' + roomName)
    },
    // Asks the visitor to choose a Color on the Color sphere (in a window of the Color app) and to log into it there.
    // Resolves with that Color's "#rrggbb" once they have; the Color's keys never leave the Color app.
    // A Color's plain name, for things named by it ("Crimson Cab", "Teal T-shirt"): the nearest of the web's named colours, measured in
    // CIELAB (distance there follows the eye; in RGB a mid blue came out nearest a purple).
    NAMES: 'Black:000000,Navy:000080,Dark Blue:00008b,Medium Blue:0000cd,Blue:0000ff,Dark Green:006400,Green:008000,Teal:008080,Dark Cyan:008b8b,Deep Sky Blue:00bfff,Dark Turquoise:00ced1,Medium Spring Green:00fa9a,Lime:00ff00,Spring Green:00ff7f,Cyan:00ffff,Midnight Blue:191970,Dodger Blue:1e90ff,Light Sea Green:20b2aa,Forest Green:228b22,Sea Green:2e8b57,Dark Slate Gray:2f4f4f,Lime Green:32cd32,Medium Sea Green:3cb371,Turquoise:40e0d0,Royal Blue:4169e1,Steel Blue:4682b4,Dark Slate Blue:483d8b,Medium Turquoise:48d1cc,Indigo:4b0082,Dark Olive Green:556b2f,Cadet Blue:5f9ea0,Cornflower Blue:6495ed,Rebecca Purple:663399,Medium Aquamarine:66cdaa,Dim Gray:696969,Slate Blue:6a5acd,Olive Drab:6b8e23,Slate Gray:708090,Light Slate Gray:778899,Medium Slate Blue:7b68ee,Lawn Green:7cfc00,Chartreuse:7fff00,Aquamarine:7fffd4,Maroon:800000,Purple:800080,Olive:808000,Gray:808080,Sky Blue:87ceeb,Light Sky Blue:87cefa,Blue Violet:8a2be2,Dark Red:8b0000,Dark Magenta:8b008b,Saddle Brown:8b4513,Dark Sea Green:8fbc8f,Light Green:90ee90,Medium Purple:9370db,Dark Violet:9400d3,Pale Green:98fb98,Dark Orchid:9932cc,Yellow Green:9acd32,Sienna:a0522d,Brown:a52a2a,Dark Gray:a9a9a9,Light Blue:add8e6,Green Yellow:adff2f,Pale Turquoise:afeeee,Light Steel Blue:b0c4de,Powder Blue:b0e0e6,Firebrick:b22222,Dark Goldenrod:b8860b,Medium Orchid:ba55d3,Rosy Brown:bc8f8f,Dark Khaki:bdb76b,Silver:c0c0c0,Medium Violet Red:c71585,Indian Red:cd5c5c,Peru:cd853f,Chocolate:d2691e,Tan:d2b48c,Light Gray:d3d3d3,Thistle:d8bfd8,Orchid:da70d6,Goldenrod:daa520,Pale Violet Red:db7093,Crimson:dc143c,Gainsboro:dcdcdc,Plum:dda0dd,Burlywood:deb887,Light Cyan:e0ffff,Lavender:e6e6fa,Dark Salmon:e9967a,Violet:ee82ee,Pale Goldenrod:eee8aa,Light Coral:f08080,Khaki:f0e68c,Alice Blue:f0f8ff,Honeydew:f0fff0,Azure:f0ffff,Sandy Brown:f4a460,Wheat:f5deb3,Beige:f5f5dc,White Smoke:f5f5f5,Mint Cream:f5fffa,Ghost White:f8f8ff,Salmon:fa8072,Antique White:faebd7,Linen:faf0e6,Light Goldenrod:fafad2,Old Lace:fdf5e6,Red:ff0000,Magenta:ff00ff,Deep Pink:ff1493,Orange Red:ff4500,Tomato:ff6347,Hot Pink:ff69b4,Coral:ff7f50,Dark Orange:ff8c00,Light Salmon:ffa07a,Orange:ffa500,Light Pink:ffb6c1,Pink:ffc0cb,Gold:ffd700,Peach Puff:ffdab9,Navajo White:ffdead,Moccasin:ffe4b5,Bisque:ffe4c4,Misty Rose:ffe4e1,Blanched Almond:ffebcd,Papaya Whip:ffefd5,Lavender Blush:fff0f5,Seashell:fff5ee,Cornsilk:fff8dc,Lemon Chiffon:fffacd,Floral White:fffaf0,Snow:fffafa,Yellow:ffff00,Light Yellow:ffffe0,Ivory:fffff0,White:ffffff',
    name: function (hex) {
        const h = String(hex || '').replace('#', '').toLowerCase(); if (!/^[0-9a-f]{6}$/.test(h)) return ''
        const lab = s => {
            const [r, g, b] = [0, 2, 4].map(i => { const c = parseInt(s.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
            const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
            const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
            return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
        }
        if (!window.Color._names) window.Color._names = window.Color.NAMES.split(',').map(e => { const [n, x] = e.split(':'); return [n, lab(x)] })
        const [L, A, B] = lab(h); let best = '', bd = Infinity
        for (const [n, [l, a, b]] of window.Color._names) { const d = (L - l) ** 2 + (A - a) ** 2 + (B - b) ** 2; if (d < bd) { bd = d; best = n } }
        return best
    },
    // The Color sphere in the page (as color.clothing shows it): the Color app in an iframe over the page, faded in and out.
    // options: container, zIndex, fade (seconds), background (behind the sphere; transparent unless given, so the page shows through).
    // known: the Color this visitor already has (null if none). onPick(fn): the Color they land on (#rrggbb). onCancel(fn): they closed it.
    // read(color, app) / write(color, app, value): this site's small data for an app, kept local-only in that visitor's Color (the one
    // they are in, or just landed on here), in their own Color database.
    sphere: function (options = {}) {
        const origin = window.Color.origin, frame = document.createElement('iframe'), picks = [], cancels = [], waiting = new Map()
        frame.src = origin + '/'; frame.allow = 'storage-access'
        frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:' + (options.zIndex || 9999) + ';background:' + (options.background || 'transparent') + ';opacity:0;pointer-events:none;transition:opacity ' + (options.fade || .8) + 's ease'
        let knownDone, asked = false; const known = new Promise(resolve => { knownDone = resolve })
        const listen = event => {
            if (event.source !== frame.contentWindow || event.origin !== origin) return
            const d = event.data
            if (typeof d === 'string' && /^#[0-9a-f]{6}$/i.test(d) && asked) { asked = false; knownDone(d.toLowerCase() === '#ffffff' ? null : d.toLowerCase()); return }
            if (d?.type === 'zoom-complete' && /^#?[0-9a-f]{6}$/i.test(String(d.color || ''))) { const c = '#' + String(d.color).replace('#', '').toLowerCase(); picks.forEach(fn => fn(c)); return }
            if (d?.type === 'cancel-color') { cancels.forEach(fn => fn()); return }
            if (d?.type === 'color-sdk-app-response') { const task = waiting.get(d.id); if (task) { waiting.delete(d.id); d.error ? task.reject(new Error(d.error)) : task.resolve(d.value) } }
        }
        window.addEventListener('message', listen)
        frame.addEventListener('load', () => { asked = true; frame.contentWindow.postMessage({ type: 'getSphereColor', title: document.title }, origin) })
        ;(options.container || document.body).appendChild(frame)
        const ask = (action, color, app, value) => new Promise((resolve, reject) => {
            const id = crypto.randomUUID(); waiting.set(id, { resolve, reject })
            frame.contentWindow.postMessage({ type: 'color-sdk-app-request', id, action, color: String(color || '').replace('#', '').toLowerCase(), app, value }, origin)
            setTimeout(() => { if (waiting.delete(id)) reject(new Error('The Color app did not answer.')) }, 15000)
        })
        return {
            el: frame, known,
            show() { frame.style.pointerEvents = 'auto'; frame.style.opacity = '1' },
            hide() { frame.style.pointerEvents = 'none'; frame.style.opacity = '0' },
            onPick(fn) { picks.push(fn) }, onCancel(fn) { cancels.push(fn) },
            read: (color, app) => ask('read', color, app),
            write: (color, app, value) => ask('write', color, app, value),
            close() { window.removeEventListener('message', listen); frame.remove() }
        }
    },
    pick: function () {
        return new Promise((resolve, reject) => {
            const origin = window.Color.origin, nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
            const popup = window.open(origin + '/?color-pick=' + nonce + '&pick-origin=' + encodeURIComponent(location.origin), '_blank')
            if (!popup) { reject(new Error('Allow pop-ups for this site to pick a Color.')); return }
            let timer = null
            const done = (error, color) => { window.removeEventListener('message', listen); clearInterval(timer); if (error) reject(error); else resolve(color) }
            const listen = event => {
                if (event.source !== popup || event.origin !== origin || event.data?.type !== 'color-pick' || event.data.nonce !== nonce) return
                const color = String(event.data.color || '').replace('#', '').toLowerCase()
                if (/^[0-9a-f]{6}$/.test(color)) done(null, '#' + color); else done(new Error('No Color was picked.'))
            }
            window.addEventListener('message', listen)
            timer = setInterval(() => { if (popup.closed) done(new Error('The Color window was closed.')) }, 500)
        })
    },
    init: async function (config = {}) {
        const {
            planet = window.Color.rainbowPlanet,
            color = 'ffffff', // Store owner's hex
            action = 'store_ops',
            targetDiv,
            block = null,
            iceServers = null,
            ownerKey = null,
            page = '',
            onOwner = null
        } = config;

        // Store Owner Room ID
        const ownerColor = String(color).replace('#', '').toLowerCase();
        if (!/^[0-9a-f]{6}$/.test(ownerColor)) throw new Error('Color.init requires a six-digit target color.');
        if (block && !/^(?:page|[a-z0-9][a-z0-9-]*)(?:-[1-9]\d*)?$/.test(String(block).toLowerCase())) throw new Error('Color.init block must be page or an installed block selector.');
        if (typeof ownerKey === 'string' && ownerKey.trim() && !/^(?:sha256[:-])?[0-9a-f]{64}$/i.test(ownerKey.trim())) throw new Error('Color.init ownerKey must be a SHA-256 fingerprint.');
        // Without ownerKey the first peer that proves the Color is trusted for this page view. The embed code that Color
        // generates always includes it; then nobody but the real owner can receive this block's forms or orders.
        if (!ownerKey) console.warn('[Color] Color.init has no ownerKey: copy the embed code from Color so that only the real owner of #' + ownerColor.toUpperCase() + ' can receive this block\'s submissions.');
        if (ownerKey && typeof ownerKey === 'object' && (ownerKey.kty !== 'EC' || !['P-256', 'P-521'].includes(ownerKey.crv) || !ownerKey.x || !ownerKey.y)) throw new Error('Color.init ownerKey must be a P-256 or P-521 public JWK.');
        // A private page meets in its own room; its name also seals the signaling so trackers cannot read or find it.
        const pageName = String(page || '').normalize('NFKC').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 48);
        const storeRoomId = "color-" + ownerColor + (pageName ? '~' + pageName : '');


        const Spectrum = window.Color.spectrum(iceServers);

        // Generic SDK bridge. Block UI and behavior arrive from the owner as signed block documents.
        let room = null
        let send = null
        let get = null
        let sendSdk = null
        let sendFile = null
        let sendIdentity = null
        let visitorColor = '#ffffff'
        let ownerPeer = null
        const ownerPeers = new Set()
        let verifiedOwnerKey = null
        let verifiedOwnerFingerprint = null
        let activeBlock = null
        let activeDocumentHash = null
        let liveBlockLoaded = false
        let snapshot = null
        let retryTimer = null
        let offlineTimer = null
        let statusTimer = null
        let visitorPublicKey = null
        let visitorKeys = null
        let visitorProof = null
        let visitorProofTask = null
        let standbyRoom = null
        let sendStandby = null
        const standbyCandidates = new Map()
        let standbyVisitPending = false
        const standbyWrites = new Map()
        const deliveryAddresses = new Map()
        const deliveryResponses = new Map()
        const storageRequests = new Map()
        const pendingGetCallbacks = []
        const uuid = () => crypto.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, char => (char ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> char / 4).toString(16))
        const blockRequestId = uuid()
        const visitId = uuid()
        const bridgeNonce = uuid()
        let storagePort = null, storagePopup = null
        const postStorage = message => storagePort ? storagePort.postMessage(message) : iframe.contentWindow?.postMessage(message, 'https://colorlog.in')
        let visitConfirmed = false
        const iframe = document.createElement('iframe')
        iframe.id = 'color-widget'
        iframe.src = 'https://colorlog.in/'
        iframe.allow = 'storage-access'
        iframe.addEventListener('load', () => postStorage({ type: 'getSphereColor', title: document.title }))
        if (block) iframe.className = 'color-sdk-identity'
        let container = targetDiv ? document.getElementById(targetDiv) || document.body : document.body
        if (!document.getElementById('color-widget-styles')) {
            const style = document.createElement('style')
            style.id = 'color-widget-styles'
            style.textContent = '#color-widget{position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:9999;background:transparent}#color-widget.color-sdk-identity{width:1px;height:1px;opacity:0;pointer-events:none}.color-sdk-notice{display:grid;justify-items:center;gap:12px;padding:22px;border-radius:12px;background:#f3f3f3;color:#555;font:800 13px/1.4 system-ui,sans-serif;text-align:center}.color-sdk-notice.loading::before{content:"";width:22px;height:22px;border:3px solid #d7d7d7;border-top-color:#555;border-radius:50%;animation:color-sdk-spin .75s linear infinite}.color-sdk-notice a{display:inline-block;padding:10px 16px;border-radius:999px;background:#111;color:#fff!important;text-decoration:none!important}@keyframes color-sdk-spin{to{transform:rotate(360deg)}}.color-sdk-snapshot{display:block;width:100%;min-height:600px;border:0;background:transparent}.color-sdk-color-link{position:fixed;top:12px;left:12px;z-index:10000;width:18px;height:18px;padding:0;border:1px solid #aaa;border-radius:2px;background:#fff;cursor:pointer}'
            document.head.appendChild(style)
        }
        const colorLink = document.createElement('button')
        colorLink.type = 'button'
        colorLink.className = 'color-sdk-color-link'
        colorLink.addEventListener('click', () => { storagePopup = window.open('https://colorlog.in/?color-bridge=' + encodeURIComponent(bridgeNonce) + '&bridge-origin=' + encodeURIComponent(location.origin) + '#' + visitorColor.slice(1), '_blank') })
        if (block) document.body.appendChild(colorLink)
        const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }))
        const showStatus = message => {
            if (!block) return
            if (liveBlockLoaded) { container.querySelector('.color-sdk-notice')?.remove(); return }
            let notice = container.querySelector('.color-sdk-notice')
            if (!notice) {
                notice = document.createElement('div')
                notice.className = 'color-sdk-notice'
                container.prepend(notice)
            }
            notice.textContent = message
            notice.classList.toggle('loading', message !== 'COLOR OFFLINE')
            if (message === 'COLOR OFFLINE' && block) {
                const standbyKey = verifiedOwnerFingerprint || (typeof ownerKey === 'string' ? ownerKey.trim().replace(/^sha256[:-]/i, '').toLowerCase() : '')
                const link = document.createElement('a')
                link.href = 'https://colorlog.in/?standby=' + ownerColor + '&block=' + encodeURIComponent(String(block).toLowerCase()) + (standbyKey ? '&ownerKey=' + standbyKey : '')
                link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'STAND WITH THIS ' + String(block).replace(/-\d+$/, '').replaceAll('-', ' ').toUpperCase()
                link.style.backgroundColor = '#' + ownerColor
                notice.appendChild(link)
            }
        }
        const checkConnection = () => {
            clearTimeout(offlineTimer); clearInterval(statusTimer)
            if (liveBlockLoaded || ownerPeer || standbyCandidates.size) { container.querySelector('.color-sdk-notice')?.remove(); return }
            const messages = ['CHECKING CONNECTION…', 'OPENING SECURE TUNNEL…', 'VERIFYING FORM OWNER…']; let index = 0
            showStatus(messages[0])
            statusTimer = setInterval(() => showStatus(messages[++index % messages.length]), 1400)
            offlineTimer = setTimeout(() => { clearInterval(statusTimer); if (liveBlockLoaded || ownerPeer) return; showStatus('COLOR OFFLINE'); ensureStandby() }, 5000)
        }
        const getReturnAddress = instanceId => {
            if (!deliveryAddresses.has(instanceId)) {
                const promise = new Promise((resolve, reject) => {
                    const publicKey = verifiedOwnerKey || ownerKey
                    if (!publicKey) { reject(new Error('Verify the Color owner before opening block storage.')); return }
                    const id = uuid()
                    storageRequests.set(id, { resolve, reject })
                    postStorage({ type: 'color-sdk-context-request', id, ownerColor: '#' + ownerColor, blockInstanceId: instanceId, ownerPublicKey: publicKey })
                    setTimeout(() => { if (storageRequests.delete(id)) reject(new Error('First-party Color storage is unavailable.')) }, 10000)
                }).catch(error => { deliveryAddresses.delete(instanceId); emit('color-storage-required', { error: error.message, color: visitorColor }); throw error })
                deliveryAddresses.set(instanceId, promise)
            }
            return deliveryAddresses.get(instanceId)
        }
        const storageRequest = async (action, records) => {
            await getReturnAddress('sdk-cache')
            return new Promise((resolve, reject) => {
            const id = uuid()
            storageRequests.set(id, { resolve, reject })
            postStorage({ type: 'color-sdk-record-request', id, action, color: visitorColor, ownerColor: '#' + ownerColor, blockInstanceId: 'sdk-cache', collection: 'documents', records })
            setTimeout(() => { if (storageRequests.delete(id)) reject(new Error('Color storage unavailable.')) }, 10000)
            })
        }
        const keyId = key => JSON.stringify([key?.kty, key?.crv, key?.x, key?.y])
        const digest = async value => {
            const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))))
            return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
        }
        const fingerprint = key => digest(keyId(key))
        const verifyWithKey = async (publicKey, signature, content) => {
            const key = await crypto.subtle.importKey('jwk', { kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, y: publicKey.y }, { name: 'ECDSA', namedCurve: publicKey.crv || 'P-256' }, false, ['verify'])
            return crypto.subtle.verify({ name: 'ECDSA', hash: publicKey.crv === 'P-521' ? 'SHA-512' : 'SHA-256' }, key, Uint8Array.from(atob(signature), char => char.charCodeAt(0)), new TextEncoder().encode(content))
        }
        const trustOwner = async (publicKey, peerId) => {
            const receivedFingerprint = await fingerprint(publicKey)
            if (ownerKey && typeof ownerKey === 'object' && keyId(ownerKey) !== keyId(publicKey)) throw new Error('The response is not signed by the configured Color owner.')
            if (typeof ownerKey === 'string' && ownerKey.trim().replace(/^sha256[:-]/i, '').toLowerCase() !== receivedFingerprint) throw new Error('The response is not signed by the configured Color owner.')
            if (verifiedOwnerFingerprint && verifiedOwnerFingerprint !== receivedFingerprint) throw new Error('The Color owner key changed during this session.')
            const first = verifiedOwnerFingerprint !== receivedFingerprint
            verifiedOwnerKey = publicKey
            verifiedOwnerFingerprint = receivedFingerprint
            if (peerId) { ownerPeers.add(peerId); if (!ownerPeer || room?.getPeers()[ownerPeer]?.dc?.readyState !== 'open') ownerPeer = peerId }
            clearTimeout(offlineTimer); clearInterval(statusTimer)
            if (first) {
                const detail = { color: '#' + ownerColor, publicKey, fingerprint: receivedFingerprint, configured: !!ownerKey }
                emit('color-owner-verified', detail)
                if (typeof onOwner === 'function') onOwner(detail)
            }
        }
        const verify = async (message, peerId) => {
            try {
                if (!await verifyWithKey(message.publicKey, message.signature, JSON.stringify(message.payload))) throw new Error('The Color signature is invalid.')
                await trustOwner(message.publicKey, peerId)
                return true
            } catch (error) {
                showStatus('COLOR OFFLINE')
                emit('color-error', { error: error.message })
                return false
            }
        }
        const encryptFor = async (publicJwk, value) => {
            const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: publicJwk.crv }, true, ['deriveKey', 'deriveBits']),remote = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }, { name: 'ECDH', namedCurve: publicJwk.crv }, false, []), ephemeral = await crypto.subtle.exportKey('jwk', pair.publicKey)
            // Version 2 envelope: the shared secret goes through HKDF with the one-time key as context (same scheme as the Color page).
            const secret = await crypto.subtle.deriveKey({ name: 'ECDH', public: remote }, pair.privateKey, 'HKDF', false, ['deriveKey']), key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('color-envelope-v2:' + ephemeral.x + ':' + ephemeral.y) }, secret, { name: 'AES-GCM', length: 256 }, false, ['encrypt']), iv = crypto.getRandomValues(new Uint8Array(12)), data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)))
            return { v: 2, ephemeral, iv: Array.from(iv), data: Array.from(new Uint8Array(data)) }
        }
        const ensureStandby = () => {
            if (standbyRoom || !block) return
            standbyRoom = Spectrum.joinRoom({ appId: planet }, 'color-standby-' + ownerColor + '-' + String(block).toLowerCase())
            ;[sendStandby] = standbyRoom.makeAction('standby')
            standbyRoom.makeAction('standby')[1](async (message, pid) => {
                if (message?.type === 'STORED') {
                    const task = standbyWrites.get(message.id)
                    if (task && task.pid === pid && await verifyWithKey(task.publicKey, message.signature, JSON.stringify(['color-standby-stored-v1', task.nonce, message.id])) && standbyWrites.get(message.id) === task) { standbyWrites.delete(message.id); clearTimeout(task.timer); task.resolve() }
                    return
                }
                if (message?.type !== 'CAPABILITY' || !message.capability || !message.signature || !message.ownerPublicKey) return
                const body = JSON.stringify(message.capability)
                if (message.capability.ownerColor !== ownerColor || message.capability.block !== String(block).toLowerCase() || message.capability.expires < Date.now() || !await verifyWithKey(message.ownerPublicKey, message.signature, body)) return
                const published = message.snapshot
                if (!published || published.ownerColor !== ownerColor || published.block !== String(block).toLowerCase() || published.blockInstanceId !== message.capability.blockInstanceId || published.expires < Date.now() || !Array.isArray(published.sources) || published.sources.length && !published.sources.includes(location.origin) || !await verifyWithKey(message.ownerPublicKey, message.snapshotSignature, JSON.stringify(published)) || await digest(published.document) !== published.documentHash) return
                try { await trustOwner(message.ownerPublicKey) } catch (_) { return }
                standbyCandidates.set(pid, message)
                if (!liveBlockLoaded && !ownerPeer) {
                    activeBlock = { instanceId: published.blockInstanceId, blockId: published.blockId }
                    if (activeDocumentHash !== published.documentHash) { activeDocumentHash = published.documentHash; renderSnapshot(published.document); emit('color-block-ready', { block: activeBlock, verified: true, standby: true }) }
                    sendVisit(null).catch(() => {})
                }
            })
            standbyRoom.onPeerJoin(pid => sendStandby({ type: 'WHO_STANDS', ownerColor, block: String(block).toLowerCase() }, pid))
            standbyRoom.onPeerLeave(pid => { standbyCandidates.delete(pid); if (!ownerPeer && !standbyCandidates.size) checkConnection() })
        }
        const sendStandbyAction = async envelope => {
            ensureStandby()
            sendStandby?.({ type: 'WHO_STANDS', ownerColor, block: String(block).toLowerCase() })
            await new Promise(resolve => setTimeout(resolve, 700))
            const candidates = [...standbyCandidates].filter(([pid, grant]) => grant.capability.expires > Date.now() && grant.capability.blockInstanceId === envelope.blockInstanceId && standbyRoom.getPeers()[pid]?.dc?.readyState === 'open')
            if (!candidates.length || !verifiedOwnerKey) throw new Error('No approved standby is online.')
            const ownerEnvelope = await encryptFor(verifiedOwnerKey, envelope), id = await digest(JSON.stringify([envelope.returnAddress?.id || visitorColor, envelope.namespace || 'visit', envelope.message?.requestId || envelope.visitId || uuid()]))
            let failure
            for (const [pid, grant] of candidates) {
                const adminEnvelope = grant.capability.role === 'admin' ? await encryptFor(grant.capability.candidatePublicKey, envelope) : null
                try {
                    if (standbyWrites.has(id)) return standbyWrites.get(id).promise
                    const promise = new Promise((resolve, reject) => {
                        const timer = setTimeout(() => { standbyWrites.delete(id); reject(new Error('Standby did not acknowledge durable storage.')) }, 15000)
                        standbyWrites.set(id, { resolve, reject, timer, pid, nonce: grant.capability.nonce, publicKey: grant.capability.candidatePublicKey })
                        sendStandby({ type: 'ENVELOPE', id, capability: grant.capability, signature: grant.signature, ownerPublicKey: grant.ownerPublicKey, ownerEnvelope, adminEnvelope }, pid)
                    })
                    standbyWrites.get(id).promise = promise
                    await promise
                    return
                } catch (error) { failure = error; standbyCandidates.delete(pid) }
            }
            throw failure
        }

        const mineProof = async (targetColor = ownerColor) => {
            const hourStamp = Math.floor(Date.now() / 3600000)
            for (let nonce = 1; ; nonce++) {
                if ((await digest(targetColor + hourStamp + ':' + visitorPublicKey.x + ':' + nonce)).startsWith('0000')) return hourStamp + '_' + nonce
                if (nonce % 1000 === 0) await new Promise(resolve => setTimeout(resolve, 0))
            }
        }
        const sendVisitorIdentity = async (peerId, nonce = null) => {
            visitorKeys ||= crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
            const pair = await visitorKeys
            visitorPublicKey ||= await crypto.subtle.exportKey('jwk', pair.publicKey)
            if (!visitorProof || Number(visitorProof.split('_')[0]) !== Math.floor(Date.now() / 3600000)) visitorProofTask ||= mineProof().then(proof => { visitorProof = proof; return proof }).finally(() => { visitorProofTask = null })
            if (!nonce && visitorProofTask) await visitorProofTask
            if (!visitorProof) return
            // v is the wire-format version shared with the Color page; a mismatch is reported there instead of hanging.
            const claim = { v: 3, color: visitorColor, pubKey: visitorPublicKey, minedToken: visitorProof, cursor: 0, sdkOrigin: location.origin, sdkBlock: block }
            if (nonce) {
                const pc = room?.getPeers()[peerId]?.pc, fingerprint = description => description?.sdp?.match(/a=fingerprint:sha-256 ([^\r\n]+)/i)?.[1]?.toUpperCase()
                const local = fingerprint(pc?.localDescription), remote = fingerprint(pc?.remoteDescription)
                if (!local || !remote) return
                const transcript = JSON.stringify(['color-peer-v1', ownerColor, nonce, local, remote, claim])
                claim.proof = { nonce, signature: btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(transcript))))) }
                if (room?.getPeers()[peerId]?.pc !== pc) return
                sendIdentity(claim, peerId)
                return
            }
            sendIdentity(claim, peerId)
        }
        const renderSnapshot = documentHtml => {
            clearTimeout(offlineTimer)
            clearInterval(statusTimer)
            container.querySelector('.color-sdk-notice')?.remove()
            snapshot?.remove()
            snapshot = document.createElement('iframe')
            snapshot.className = 'color-sdk-snapshot'
            snapshot.title = 'Color content'
            snapshot.sandbox = 'allow-scripts allow-forms allow-popups allow-modals allow-downloads'
            snapshot.srcdoc = documentHtml
            container.insertBefore(snapshot, iframe)
        }
        const cacheBlock = async message => {
            const records = await storageRequest('read')
            const next = (Array.isArray(records) ? records : []).filter(item => item?.selector !== String(block).toLowerCase())
            next.unshift({ selector: String(block).toLowerCase(), message, savedAt: Date.now() })
            await storageRequest('write', next.slice(0, 20))
        }
        const loadCachedBlock = async () => {
            const records = await storageRequest('read'), cached = (Array.isArray(records) ? records : []).find(item => item?.selector === String(block).toLowerCase())
            const message = cached?.message, payload = message?.payload
            if (!message || payload?.kind !== 'block' || payload.origin !== location.origin || payload.ownerColor !== '#' + ownerColor || !payload.document || !await verify(message, null) || await digest(payload.document) !== payload.documentHash) return
            if (liveBlockLoaded) return
            activeBlock = payload.block
            activeDocumentHash = payload.documentHash
            renderSnapshot(payload.document)
            snapshot?.addEventListener('load', () => { if (!liveBlockLoaded && !ownerPeer) checkConnection() }, { once: true })
            emit('color-block-ready', { block: payload.block, verified: true, cached: true })
        }
        const authorizeRequest = request => new Promise((resolve, reject) => {
            if (!request.returnAddress) { resolve(request); return }
            const id = uuid()
            storageRequests.set(id, { resolve: requestProof => resolve({ ...request, requestProof }), reject })
            postStorage({ type: 'color-sdk-authorize-request', id, request })
            setTimeout(() => { if (storageRequests.delete(id)) reject(new Error('Color request authorization is unavailable.')) }, 10000)
        })
        const sendVisit = async peerId => {
            if (visitConfirmed || !activeBlock || standbyVisitPending || !peerId && !standbyCandidates.size) return
            standbyVisitPending = true
            try {
                const returnAddress = await getReturnAddress(activeBlock.instanceId), request = await authorizeRequest({ type: 'SDK_VISIT', origin: location.origin, blockInstanceId: activeBlock.instanceId, visitorColor, visitId, returnAddress })
                if (peerId) sendSdk?.(request, peerId)
                else { await sendStandbyAction(request); visitConfirmed = true }
            } finally { standbyVisitPending = false }
        }
        const requestBlock = peerId => sendSdk?.({ type: block ? 'GET_BLOCK' : 'GET_CONTEXT', requestId: blockRequestId, origin: location.origin, block, visitorColor, ownerView: visitorColor.slice(1) === ownerColor }, peerId)
        const connect = () => {
            if (room) return
            room = Spectrum.joinRoom({ appId: planet, ...(pageName ? { secret: pageName } : {}) }, storeRoomId)
            ;[send, get] = room.makeAction(action)
            pendingGetCallbacks.splice(0).forEach(callback => get(callback))
            ;[sendIdentity] = room.makeAction('identity')
            room.makeAction('identity')[1]((data, peerId) => {
                if (data?.type === 'IDENTITY_CHALLENGE' && /^[a-f0-9]{64}$/.test(data.nonce || '')) sendVisitorIdentity(peerId, data.nonce).catch(error => emit('color-error', { error: error.message }))
            })
            ;[sendFile] = room.makeAction('file')
            {
                ;[sendSdk] = room.makeAction('sdk_ops')
                room.makeAction('sdk_ops')[1](async (message, peerId) => {
                    const payload = message?.payload
                    if (message?.type !== 'SDK_RESPONSE' || payload?.origin !== location.origin || (['block', 'context'].includes(payload.kind) && payload.ownerColor !== '#' + ownerColor) || (['block', 'source', 'context'].includes(payload.kind) && payload.requestId !== blockRequestId) || !await verify(message, peerId)) return
                    if (['block', 'context', 'source'].includes(payload.kind) && peerId !== ownerPeer) return
                    if (payload.kind === 'context' && !block) {
                        activeBlock = payload.block
                        sendVisit(peerId).catch(() => {})
                    } else if (payload.kind === 'source' && payload.requestId === blockRequestId) {
                        showStatus('WAITING FOR OWNER CONFIRMATION')
                        emit('color-source-pending', { origin: location.origin, color: '#' + ownerColor })
                    } else if (payload.kind === 'block' && payload.requestId === blockRequestId) {
                        if (!payload.block) return showStatus(payload.error || 'BLOCK NOT FOUND')
                        if (!payload.document || await digest(payload.document) !== payload.documentHash) return emit('color-error', { error: 'The signed block document does not match its fingerprint.' })
                        liveBlockLoaded = true
                        if (activeDocumentHash === payload.documentHash && activeBlock?.instanceId === payload.block.instanceId) { clearTimeout(offlineTimer); clearInterval(statusTimer); container.querySelector('.color-sdk-notice')?.remove(); return }
                        activeBlock = payload.block
                        activeDocumentHash = payload.documentHash
                        sendVisit(peerId).catch(() => {})
                        renderSnapshot(payload.document)
                        if (!payload.ownerView) cacheBlock(message).catch(() => {})
                        emit('color-block-ready', { block: payload.block, verified: true })
                    } else if (payload.kind === 'visit' && payload.visitId === visitId && payload.blockInstanceId === activeBlock?.instanceId) {
                        visitConfirmed = true
                    } else if (payload.kind === 'delivery' && payload.envelope?.packet?.header?.address?.origin === location.origin) {
                        const id = uuid(); deliveryResponses.set(id, peerId)
                        postStorage({ type: 'color-sdk-delivery', id, envelope: payload.envelope })
                        setTimeout(() => deliveryResponses.delete(id), 15000)
                    } else if (payload.kind === 'action' && (activeBlock?.blockId === 'page' || payload.blockInstanceId === activeBlock?.instanceId) && payload.namespace) {
                        snapshot?.contentWindow?.postMessage({ type: 'color-sdk-block-message', namespace: payload.namespace, message: payload.message }, '*')
                    }
                })
            }
            room.onPeerJoin(peerId => {
                emit('color-connected', { peerId, color: '#' + ownerColor })
                requestBlock(peerId)
                sendVisitorIdentity(peerId).then(() => requestBlock(peerId)).catch(error => emit('color-error', { error: error.message }))
                if (block) { setTimeout(() => requestBlock(peerId), 750); setTimeout(() => requestBlock(peerId), 2500) }
            })
            room.onPeerLeave(peerId => {
                emit('color-disconnected', { peerId, color: '#' + ownerColor })
                ownerPeers.delete(peerId)
                if (peerId === ownerPeer) {
                    ownerPeer = [...ownerPeers].find(pid => room?.getPeers?.()[pid]?.dc?.readyState === 'open') || null
                    if (ownerPeer) { requestBlock(ownerPeer); sendVisitorIdentity(ownerPeer).then(() => sendVisit(ownerPeer)).catch(error => emit('color-error', { error: error.message })) }
                    if (!ownerPeer) {
                        liveBlockLoaded = false
                        requestBlock()
                        ensureStandby()
                        checkConnection()
                    }
                }
            })
            room.onPeerError((peerId, error) => emit('color-error', { peerId, error: error?.message || 'Color connection failed.' }))
            retryTimer = setInterval(() => { if (!activeBlock || block && !liveBlockLoaded) requestBlock(); if (ownerPeer) sendVisitorIdentity(ownerPeer).catch(() => {}); sendVisit(ownerPeer).catch(() => {}); if (standbyRoom) sendStandby({ type: 'WHO_STANDS', ownerColor, block: String(block).toLowerCase() }) }, 10000)
        }
        const handleMessage = async event => {
            if (event.source === storagePopup && event.origin === 'https://colorlog.in' && event.data?.type === 'color-sdk-connect-ready' && event.data.nonce === bridgeNonce) {
                const channel = new MessageChannel()
                storagePort?.close(); storagePort = channel.port1
                storagePort.onmessage = message => handleMessage({ source: storagePort, origin: 'https://colorlog.in', data: message.data }).catch(error => emit('color-error', { error: error.message }))
                storagePopup.postMessage({ type: 'color-sdk-connect', nonce: bridgeNonce }, 'https://colorlog.in', [channel.port2])
                deliveryAddresses.clear(); visitConfirmed = false
                postStorage({ type: 'getSphereColor', title: document.title })
                sendVisit(ownerPeer).catch(() => {})
                return
            }
            if ((event.source === iframe.contentWindow || storagePort && event.source === storagePort) && event.origin === 'https://colorlog.in') {
                if (event.data?.type === 'color-sdk-storage-closed' && event.source === storagePort) { storagePort.close(); storagePort = null; deliveryAddresses.clear(); return }
                if (event.data?.type === 'color-sdk-delivery-response') {
                    const peerId = deliveryResponses.get(event.data.id)
                    deliveryResponses.delete(event.data.id)
                    if (peerId && event.data.response) { sendSdk?.({ type: 'DELIVERY_ACK', response: event.data.response }, peerId); emit('color-delivery-stored', { id: event.data.response.ack.id, color: '#' + event.data.response.ack.color }) }
                    else if (event.data.error) emit('color-storage-required', { error: event.data.error, color: visitorColor })
                    return
                }
                if (['color-sdk-record-response', 'color-sdk-context-response', 'color-sdk-authorize-response', 'color-sdk-local-blocks-response'].includes(event.data?.type)) {
                    const task = storageRequests.get(event.data.id)
                    if (task) {
                        storageRequests.delete(event.data.id)
                        event.data.error ? task.reject(new Error(event.data.error)) : task.resolve(event.data.proof || event.data.address || event.data.records)
                        return
                    }
                    snapshot?.contentWindow?.postMessage(event.data, '*')
                    return
                }
                if (storagePort && event.source !== storagePort) return
                const detected = typeof event.data === 'string' ? event.data : event.data?.color
                if (typeof detected === 'string' && /^#[0-9a-f]{6}$/i.test(detected)) {
                    if (visitorColor !== detected.toLowerCase()) { deliveryAddresses.clear(); visitConfirmed = false }
                    visitorColor = detected.toLowerCase()
                    colorLink.style.backgroundColor = visitorColor
                    colorLink.title = visitorColor.toUpperCase()
                    emit('color-change', { color: visitorColor })
                    if (block && !activeBlock) loadCachedBlock().catch(() => {})
                    connect()
                    if (room) requestBlock()
                }
                if (event.data && ['zoom-complete', 'zoom-finished', 'zoom-done'].includes(event.data.type)) window.dispatchEvent(new Event('color-zoom-finished'))
                return
            }
            if (event.source !== snapshot?.contentWindow) return
            if (event.data?.type === 'color-sdk-file-upload' && ownerPeer) {
                const meta = event.data.meta, bytes = event.data.bytes instanceof ArrayBuffer ? new Uint8Array(event.data.bytes) : null
                if (!meta?.id || !bytes || bytes.length !== Number(meta.size) || bytes.length > 64 * 1024 * 1024) return
                await sendFile?.({ type: 'start', fileId: meta.id, name: meta.name, size: bytes.length, mime: meta.type, ownerColor: visitorColor, hash: meta.hash, chunks: Math.ceil(bytes.length / 32768) }, ownerPeer)
                for (let offset = 0, index = 0; offset < bytes.length; offset += 32768, index++) await sendFile?.({ type: 'chunk', fileId: meta.id, index, bytes: bytes.slice(offset, offset + 32768) }, ownerPeer)
                await sendFile?.({ type: 'end', fileId: meta.id }, ownerPeer)
            } else if (event.data?.type === 'color-sdk-block-action' && ownerPeer && room?.getPeers?.()[ownerPeer]?.dc?.readyState === 'open') {
                const message = event.data.message && typeof event.data.message === 'object' ? { ...event.data.message, origin: location.origin, visitorColor } : event.data.message
                if (activeBlock?.blockId !== 'page' && event.data.blockInstanceId !== activeBlock?.instanceId) return
                const returnAddress = await getReturnAddress(event.data.blockInstanceId).catch(() => null)
                try { sendSdk?.(await authorizeRequest({ type: 'BLOCK_ACTION', origin: location.origin, visitorColor, blockInstanceId: event.data.blockInstanceId, namespace: event.data.namespace, message, returnAddress }), ownerPeer) } catch (error) { emit('color-storage-required', { error: error.message, color: visitorColor }) }
            } else if (event.data?.type === 'color-sdk-block-action') {
                const message = event.data.message && typeof event.data.message === 'object' ? { ...event.data.message, origin: location.origin, visitorColor } : event.data.message
                if (activeBlock?.blockId !== 'page' && event.data.blockInstanceId !== activeBlock?.instanceId) return
                const returnAddress = await getReturnAddress(event.data.blockInstanceId).catch(() => null)
                authorizeRequest({ type: 'BLOCK_ACTION', origin: location.origin, visitorColor, blockInstanceId: event.data.blockInstanceId, namespace: event.data.namespace, message, returnAddress }).then(sendStandbyAction).then(() => snapshot?.contentWindow?.postMessage({ type: 'color-sdk-block-message', message: { type: 'QUEUED', ok: true } }, '*')).catch(error => emit('color-error', { error: error.message }))
            } else if (event.data?.type === 'color-sdk-local-blocks-request') {
                // Which local-only blocks the visitor shares with sites; answered by the visitor's own Color frame.
                postStorage({ type: 'color-sdk-local-blocks-request', id: String(event.data.id || '').slice(0, 160) })
            } else if (event.data?.type === 'color-sdk-record-request') {
                if (activeBlock?.blockId !== 'page' && event.data.blockInstanceId !== activeBlock?.instanceId) return
                try {
                    await getReturnAddress(event.data.blockInstanceId)
                    postStorage({ ...event.data, color: visitorColor, ownerColor: '#' + ownerColor })
                } catch (error) { snapshot?.contentWindow?.postMessage({ type: 'color-sdk-record-response', id: event.data.id, error: error.message }, '*') }
            }
        }
        window.addEventListener('message', handleMessage)
        if (block) {
            checkConnection()
        }
        container.appendChild(iframe)
        connect()
        return {
            iframe,
            send: (data, target) => send?.(data, target),
            get: callback => get ? get(callback) : pendingGetCallbacks.push(callback),
            destroy: () => {
                clearInterval(retryTimer)
                clearTimeout(offlineTimer)
                clearInterval(statusTimer)
                window.removeEventListener('message', handleMessage)
                storagePort?.close()
                room?.leave()
                deliveryAddresses.clear()
                deliveryResponses.clear()
                storageRequests.forEach(task => task.reject(new Error('Color SDK closed.')))
                storageRequests.clear()
                standbyWrites.forEach(task => { clearTimeout(task.timer); task.reject(new Error('Color SDK closed.')) }); standbyWrites.clear()
                standbyRoom?.leave()
                snapshot?.remove()
                iframe.remove()
                colorLink.remove()
                container.querySelector('.color-sdk-notice')?.remove()
            },
            resetTrust: () => { verifiedOwnerKey = null; verifiedOwnerFingerprint = null; deliveryAddresses.clear(); visitConfirmed = false },
            connectStorage: () => colorLink.click(),
            get connected() { return Object.values(room?.getPeers?.() || {}).some(peer => peer.dc?.readyState === 'open') },
            get color() { return visitorColor },
            get ownerKey() { return verifiedOwnerKey },
            get ownerFingerprint() { return verifiedOwnerFingerprint },
            get block() { return activeBlock },
            get room() { return room }
        }
    }
}
