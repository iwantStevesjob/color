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
        if (block && !/^(?:page|[a-z0-9][a-z0-9-]*)(?:-[1-9]\d*)?$/.test(String(block).toLowerCase())) throw new Error('Color.init block must be page or an installed block selector.');
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
            const charSet = '0123456789AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz';
            const genId = n => Array(n).fill().map(() => charSet[Math.floor(Math.random() * charSet.length)]).join('');
            const encoder = new TextEncoder();
            async function sha1Hash(str) {
                const hashBuffer = await crypto.subtle.digest('SHA-1', encoder.encode(str));
                return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(36)).join('').slice(0, 20);
            }
            function waitForIce(pc, fallbackDescription) {
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
                ]).then(() => {
                    const description = pc.localDescription || fallbackDescription;
                    if (!description?.sdp) throw new Error('WebRTC could not create a local session description.');
                    return { type: description.type, sdp: description.sdp.replace(/a=ice-options:trickle\s\n/g, '') };
                });
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
                        const localOffer = await pc.createOffer();
                        await pc.setLocalDescription(localOffer);
                        const offer = await waitForIce(pc, localOffer);
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
                                const localAnswer = await pc.createAnswer();
                                await pc.setLocalDescription(localAnswer);
                                const answer = await waitForIce(pc, localAnswer);
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

        // Generic SDK bridge. Block UI and behavior arrive from the owner as signed block documents.
        let room = null
        let send = null
        let get = null
        let sendSdk = null
        let sendIdentity = null
        let visitorColor = '#ffffff'
        let ownerPeer = null
        let verifiedOwnerKey = null
        let verifiedOwnerFingerprint = null
        let activeBlock = null
        let liveBlockLoaded = false
        let snapshot = null
        let retryTimer = null
        let offlineTimer = null
        let visitorPublicKey = null
        let visitorProof = null
        const storageRequests = new Map()
        const pendingGetCallbacks = []
        const uuid = () => crypto.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, char => (char ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> char / 4).toString(16))
        const blockRequestId = uuid()
        const iframe = document.createElement('iframe')
        iframe.id = 'color-widget'
        iframe.src = 'https://colorlog.in/'
        iframe.allow = 'storage-access'
        iframe.addEventListener('load', () => iframe.contentWindow?.postMessage('getSphereColor', 'https://colorlog.in'))
        if (block) iframe.className = 'color-sdk-identity'
        let container = targetDiv ? document.getElementById(targetDiv) || document.body : document.body
        if (!document.getElementById('color-widget-styles')) {
            const style = document.createElement('style')
            style.id = 'color-widget-styles'
            style.textContent = '#color-widget{position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:9999;background:transparent}#color-widget.color-sdk-identity{width:1px;height:1px;opacity:0;pointer-events:none}.color-sdk-notice{padding:16px;border-radius:10px;background:#eee;color:#555;font:800 13px/1.4 system-ui,sans-serif;text-align:center}.color-sdk-snapshot{display:block;width:100%;min-height:600px;border:0;background:transparent}.color-sdk-color-link{position:fixed;top:12px;left:12px;z-index:10000;width:18px;height:18px;padding:0;border:1px solid #aaa;border-radius:2px;background:#fff;cursor:pointer}'
            document.head.appendChild(style)
        }
        const colorLink = document.createElement('button')
        colorLink.type = 'button'
        colorLink.className = 'color-sdk-color-link'
        colorLink.addEventListener('click', () => window.open('https://colorlog.in/#' + visitorColor.slice(1), '_blank', 'noopener'))
        if (block) document.body.appendChild(colorLink)
        const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }))
        const showStatus = message => {
            if (!block) return
            let notice = container.querySelector('.color-sdk-notice')
            if (!notice) {
                notice = document.createElement('div')
                notice.className = 'color-sdk-notice'
                container.prepend(notice)
            }
            notice.textContent = message
        }
        const storageRequest = (action, records) => new Promise((resolve, reject) => {
            const id = uuid()
            storageRequests.set(id, { resolve, reject })
            iframe.contentWindow?.postMessage({ type: 'color-sdk-record-request', id, action, color: visitorColor, ownerColor: '#' + ownerColor, blockInstanceId: 'sdk-cache', collection: 'documents', records }, 'https://colorlog.in')
            setTimeout(() => { if (storageRequests.delete(id)) reject(new Error('Color storage unavailable.')) }, 10000)
        })
        const keyId = key => JSON.stringify([key?.kty, key?.crv, key?.x, key?.y])
        const digest = async value => {
            const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))))
            return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
        }
        const fingerprint = key => digest(keyId(key))
        const verifyWithKey = async (publicKey, signature, content) => {
            const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: publicKey.crv || 'P-256' }, false, ['verify'])
            return crypto.subtle.verify({ name: 'ECDSA', hash: publicKey.crv === 'P-521' ? 'SHA-512' : 'SHA-256' }, key, Uint8Array.from(atob(signature), char => char.charCodeAt(0)), new TextEncoder().encode(content))
        }
        const trustOwner = async (publicKey, peerId) => {
            const receivedFingerprint = await fingerprint(publicKey)
            if (ownerKey && typeof ownerKey === 'object' && keyId(ownerKey) !== keyId(publicKey)) throw new Error('The response is not signed by the configured Color owner.')
            if (typeof ownerKey === 'string' && ownerKey.trim().replace(/^sha256[:-]/i, '').toLowerCase() !== receivedFingerprint) throw new Error('The response is not signed by the configured Color owner.')
            const first = verifiedOwnerFingerprint !== receivedFingerprint
            verifiedOwnerKey = publicKey
            verifiedOwnerFingerprint = receivedFingerprint
            if (peerId) ownerPeer = peerId
            if (first) {
                const detail = { color: '#' + ownerColor, publicKey, fingerprint: receivedFingerprint, configured: !!ownerKey }
                emit('color-owner-verified', detail)
                if (typeof onOwner === 'function') onOwner(detail)
            }
        }
        const verify = async (message, peerId) => {
            try {
                await trustOwner(message.publicKey, peerId)
                if (!await verifyWithKey(message.publicKey, message.signature, JSON.stringify(message.payload))) throw new Error('The Color signature is invalid.')
                return true
            } catch (error) {
                showStatus('COLOR OFFLINE')
                emit('color-error', { error: error.message })
                return false
            }
        }
        const mineProof = async () => {
            const hourStamp = Math.floor(Date.now() / 3600000)
            for (let nonce = 1; ; nonce++) {
                if ((await digest(ownerColor + hourStamp + nonce)).startsWith('0000')) return hourStamp + '_' + nonce
                if (nonce % 1000 === 0) await new Promise(resolve => setTimeout(resolve, 0))
            }
        }
        const sendVisitorIdentity = async peerId => {
            if (!visitorPublicKey) {
                const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
                visitorPublicKey = await crypto.subtle.exportKey('jwk', pair.publicKey)
            }
            sendIdentity({ color: visitorColor, pubKey: visitorPublicKey, minedToken: 'PENDING', cursor: 0, sdkOrigin: location.origin, sdkBlock: block }, peerId)
            visitorProof ||= await mineProof()
            sendIdentity({ color: visitorColor, pubKey: visitorPublicKey, minedToken: visitorProof, cursor: 0, sdkOrigin: location.origin, sdkBlock: block }, peerId)
        }
        const renderSnapshot = documentHtml => {
            clearTimeout(offlineTimer)
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
            if (!message || payload?.kind !== 'block' || !payload.document || !await verify(message, null) || await digest(payload.document) !== payload.documentHash) return
            activeBlock = payload.block
            renderSnapshot(payload.document)
            snapshot?.addEventListener('load', () => snapshot?.contentWindow?.postMessage({ type: 'color-sdk-owner-status', online: false }, '*'), { once: true })
            emit('color-block-ready', { block: payload.block, verified: true, cached: true })
        }
        const requestBlock = peerId => sendSdk?.({ type: 'GET_BLOCK', requestId: blockRequestId, origin: location.origin, block, visitorColor }, peerId)
        const connect = () => {
            if (room) return
            room = Spectrum.joinRoom({ appId: planet }, storeRoomId)
            ;[send, get] = room.makeAction(action)
            pendingGetCallbacks.splice(0).forEach(callback => get(callback))
            ;[sendIdentity] = room.makeAction('identity')
            room.makeAction('identity')[1]((data, peerId) => {
                if (!data?.pubKey || String(data.color || '').replace('#', '').toLowerCase() !== ownerColor) return
                trustOwner(data.pubKey, peerId).catch(error => emit('color-error', { error: error.message }))
            })
            if (block) {
                ;[sendSdk] = room.makeAction('sdk_ops')
                room.makeAction('sdk_ops')[1](async (message, peerId) => {
                    if (message?.type !== 'SDK_RESPONSE' || !await verify(message, peerId)) return
                    const payload = message.payload || {}
                    if (payload.origin !== location.origin) return
                    if (payload.kind === 'source' && payload.requestId === blockRequestId) {
                        showStatus('WAITING FOR OWNER CONFIRMATION')
                        emit('color-source-pending', { origin: location.origin, color: '#' + ownerColor })
                    } else if (payload.kind === 'block' && payload.requestId === blockRequestId) {
                        if (!payload.block) return showStatus(payload.error || 'BLOCK NOT FOUND')
                        if (!payload.document || await digest(payload.document) !== payload.documentHash) return emit('color-error', { error: 'The signed block document does not match its fingerprint.' })
                        clearInterval(retryTimer)
                        liveBlockLoaded = true
                        activeBlock = payload.block
                        renderSnapshot(payload.document)
                        cacheBlock(message).catch(() => {})
                        emit('color-block-ready', { block: payload.block, verified: true })
                    } else if (payload.kind === 'action' && (activeBlock?.blockId === 'page' || payload.blockInstanceId === activeBlock?.instanceId) && payload.namespace) {
                        snapshot?.contentWindow?.postMessage({ type: 'color-sdk-block-message', namespace: payload.namespace, message: payload.message }, '*')
                    }
                })
            }
            room.onPeerJoin(peerId => {
                emit('color-connected', { peerId, color: '#' + ownerColor })
                sendVisitorIdentity(peerId).then(() => block && requestBlock(peerId)).catch(error => emit('color-error', { error: error.message }))
            })
            room.onPeerLeave(peerId => {
                emit('color-disconnected', { peerId, color: '#' + ownerColor })
                if (peerId === ownerPeer) {
                    ownerPeer = null
                    snapshot?.contentWindow?.postMessage({ type: 'color-sdk-owner-status', online: false }, '*')
                    showStatus('COLOR OFFLINE')
                }
            })
            room.onPeerError((peerId, error) => emit('color-error', { peerId, error: error?.message || 'Color connection failed.' }))
            if (block) retryTimer = setInterval(() => { if (!liveBlockLoaded) requestBlock() }, 10000)
        }
        const handleMessage = event => {
            if (event.source === iframe.contentWindow && event.origin === 'https://colorlog.in') {
                if (event.data?.type === 'color-sdk-record-response') {
                    const task = storageRequests.get(event.data.id)
                    if (task) {
                        storageRequests.delete(event.data.id)
                        event.data.error ? task.reject(new Error(event.data.error)) : task.resolve(event.data.records)
                        return
                    }
                    snapshot?.contentWindow?.postMessage(event.data, '*')
                    return
                }
                const detected = typeof event.data === 'string' ? event.data : event.data?.color
                if (typeof detected === 'string' && /^#[0-9a-f]{6}$/i.test(detected)) {
                    visitorColor = detected.toLowerCase()
                    colorLink.style.backgroundColor = visitorColor
                    colorLink.title = visitorColor.toUpperCase()
                    emit('color-change', { color: visitorColor })
                    if (block && !activeBlock) loadCachedBlock().catch(() => {})
                    connect()
                }
                if (event.data && ['zoom-complete', 'zoom-finished', 'zoom-done'].includes(event.data.type)) window.dispatchEvent(new Event('color-zoom-finished'))
                return
            }
            if (event.source !== snapshot?.contentWindow) return
            if (event.data?.type === 'color-sdk-block-action' && ownerPeer) {
                const message = event.data.message && typeof event.data.message === 'object' ? { ...event.data.message, origin: location.origin, visitorColor } : event.data.message
                sendSdk?.({ type: 'BLOCK_ACTION', origin: location.origin, visitorColor, blockInstanceId: event.data.blockInstanceId, namespace: event.data.namespace, message }, ownerPeer)
            } else if (event.data?.type === 'color-sdk-record-request') {
                iframe.contentWindow?.postMessage({ ...event.data, color: visitorColor, ownerColor: '#' + ownerColor }, 'https://colorlog.in')
            }
        }
        window.addEventListener('message', handleMessage)
        if (block) {
            showStatus('CONNECTING TO COLOR…')
            offlineTimer = setTimeout(() => { if (!activeBlock && !ownerPeer) showStatus('COLOR OFFLINE') }, 15000)
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
                window.removeEventListener('message', handleMessage)
                room?.leave()
                snapshot?.remove()
                iframe.remove()
                colorLink.remove()
                container.querySelector('.color-sdk-notice')?.remove()
            },
            resetTrust: () => { verifiedOwnerKey = null; verifiedOwnerFingerprint = null },
            get connected() { return Object.values(room?.getPeers?.() || {}).some(peer => peer.dc?.readyState === 'open') },
            get color() { return visitorColor },
            get ownerKey() { return verifiedOwnerKey },
            get ownerFingerprint() { return verifiedOwnerFingerprint },
            get block() { return activeBlock },
            get room() { return room }
        }
    }
}
