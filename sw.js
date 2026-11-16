self.COLOR_RELEASE = null
// Line 1 is written by Color's release signer (Settings → APP RELEASE). A signed release pins this app's code: once a device
// has accepted one, it runs only code signed by the same release passkey. Changed files on GitHub are ignored until a newer
// signed release arrives, and an unsigned or wrongly signed new service worker trips the alarm below and erases the card
// vault on this device before that code can use it. Keep this line exactly one line long.
const BACKUP_CACHE = 'color-backups-v1', PIN_CACHE = 'color-release-pin'
const RELEASE = self.COLOR_RELEASE && typeof self.COLOR_RELEASE === 'object' ? self.COLOR_RELEASE : null
const CODE_CACHE = RELEASE ? 'color-release-' + RELEASE.version : ''
const VAULT_KEYS = ['local:vault-wallet:v1', 'local:vault-card:v2', 'local:vault-card:v1']

const iconResponse = async (color, size) => {
    const canvas = new OffscreenCanvas(size, size), context = canvas.getContext('2d')
    context.fillStyle = '#' + color
    context.fillRect(0, 0, size, size)
    return new Response(await canvas.convertToBlob({ type: 'image/png' }), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' } })
}

// ---- Release signatures ---------------------------------------------------------------------------------------------------
// A release is signed with a passkey: the WebAuthn challenge is the SHA-256 of the release manifest, so the signature can only
// come from the person holding that passkey (fingerprint or face), never from someone who only controls GitHub or the site.
const bytesOf = value => { const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(text.padEnd(Math.ceil(text.length / 4) * 4, '=')), char => char.charCodeAt(0)) }
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const hexOf = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
const sha256 = async data => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data))
// GitHub stores these files with LF line endings while a Windows checkout has CRLF; hashing the LF form makes both agree.
const textHash = async text => hexOf(await sha256(String(text).replace(/\r\n/g, '\n')))
const releaseDigest = release => JSON.stringify([release.v, release.version, release.origin, release.rpId, release.credentialId, release.publicKey, Object.keys(release.files || {}).sort().map(name => [name, release.files[name]]), release.sw, release.signedAt])
// WebAuthn signatures are DER encoded; WebCrypto verifies the raw 64-byte r||s form.
const derToRaw = der => {
    if (der[0] !== 0x30) throw new Error('Bad signature')
    let offset = 2
    const part = () => { if (der[offset] !== 0x02) throw new Error('Bad signature'); const length = der[offset + 1], value = der.slice(offset + 2, offset + 2 + length); offset += 2 + length; const trimmed = value.slice(Math.max(0, value.length - 32)); const out = new Uint8Array(32); out.set(trimmed, 32 - trimmed.length); return out }
    const r = part(), s = part(), raw = new Uint8Array(64)
    raw.set(r); raw.set(s, 32)
    return raw
}
async function verifyRelease(release, pin) {
    try {
        if (!release || release.v !== 1 || !Number.isSafeInteger(release.version) || release.origin !== self.location.origin || !release.files || typeof release.files !== 'object' || !/^[0-9a-f]{64}$/.test(release.sw || '')) return false
        if (pin && release.publicKey !== pin.publicKey) return false
        const host = new URL(release.origin).hostname
        if (host !== release.rpId && !host.endsWith('.' + release.rpId)) return false
        const clientDataBytes = bytesOf(release.signature.clientDataJSON), clientData = JSON.parse(new TextDecoder().decode(clientDataBytes))
        if (clientData.type !== 'webauthn.get' || clientData.origin !== release.origin || clientData.challenge !== base64url(await sha256(releaseDigest(release)))) return false
        const authData = bytesOf(release.signature.authenticatorData)
        // The relying party must match and the passkey must report both presence and verification (fingerprint, face or PIN).
        if (authData.length < 37 || hexOf(authData.slice(0, 32)) !== hexOf(await sha256(release.rpId)) || (authData[32] & 5) !== 5) return false
        const key = await crypto.subtle.importKey('spki', bytesOf(release.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
        const signed = new Uint8Array(authData.length + 32)
        signed.set(authData); signed.set(await sha256(clientDataBytes), authData.length)
        return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(bytesOf(release.signature.signature)), signed)
    } catch (_) { return false }
}

// The pin (the release passkey's public key and the newest accepted version) is kept twice on this device: with the code in
// this worker's cache and in the anonymous #FFFFFF store of the Color database, so clearing one of them does not reset it.
const openColorDatabase = () => new Promise(resolve => {
    const request = indexedDB.open('color')
    // Never create the database from here: Color itself owns its versions and stores.
    request.onupgradeneeded = () => request.transaction.abort()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
})
async function readPin() {
    const cached = await caches.open(PIN_CACHE).then(cache => cache.match('pin.json')).then(response => response?.json()).catch(() => null)
    if (cached?.publicKey) return cached
    const db = await openColorDatabase()
    if (!db) return null
    try {
        if (!db.objectStoreNames.contains('ffffff')) return null
        return await new Promise(resolve => { const request = db.transaction('ffffff', 'readonly').objectStore('ffffff').get('local:release-pin'); request.onsuccess = () => resolve(request.result?.value?.publicKey ? request.result.value : null); request.onerror = () => resolve(null) })
    } finally { db.close() }
}
async function writePin(pin) {
    await (await caches.open(PIN_CACHE)).put('pin.json', new Response(JSON.stringify(pin), { headers: { 'Content-Type': 'application/json' } }))
    const db = await openColorDatabase()
    if (!db) return
    try {
        if (!db.objectStoreNames.contains('ffffff')) return
        await new Promise(resolve => { const tx = db.transaction('ffffff', 'readwrite'); tx.objectStore('ffffff').put({ value: pin, updated: Date.now(), localOnly: true }, 'local:release-pin'); tx.oncomplete = tx.onerror = tx.onabort = resolve })
    } finally { db.close() }
}

// The alarm. Erases the sealed vault card in every Color on this device, records why, and tells every open Color page.
async function lockdown(reason) {
    const db = await openColorDatabase()
    if (db) try {
        const stores = [...db.objectStoreNames]
        if (stores.length) await new Promise(resolve => { const tx = db.transaction(stores, 'readwrite'); for (const store of stores) for (const key of VAULT_KEYS) tx.objectStore(store).delete(key); tx.oncomplete = tx.onerror = tx.onabort = resolve })
    } finally { db.close() }
    await (await caches.open(PIN_CACHE)).put('tamper.json', new Response(JSON.stringify({ at: Date.now(), reason }), { headers: { 'Content-Type': 'application/json' } }))
    for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage({ type: 'color-release-tamper', reason })
}

// Checks a new service worker before it can take over. Its first line must be a release signed by the pinned passkey, newer
// than this one, and the rest of the file must be exactly what that release signed. A stale copy of this same release (a
// cache that has not caught up yet) proves nothing either way, so it is retried and never raises the alarm.
let incomingCheck = null
function checkIncoming(scriptURL) {
    if (!RELEASE || incomingCheck) return incomingCheck
    incomingCheck = (async () => {
        const pin = await readPin()
        if (!pin) return
        for (let attempt = 0; attempt < 6; attempt++) {
            let text = ''
            try { const response = await fetch(scriptURL, { cache: 'no-store' }); if (!response.ok) throw new Error('unavailable'); text = await response.text() } catch (_) { return }
            const newline = text.indexOf('\n'), header = (newline < 0 ? text : text.slice(0, newline)).match(/^self\.COLOR_RELEASE = (.*?);?\s*$/)
            let release = null
            try { release = header ? JSON.parse(header[1]) : null } catch (_) { }
            const body = newline < 0 ? '' : text.slice(newline + 1)
            if (release && release.version === RELEASE.version && await textHash(body) === RELEASE.sw) { await new Promise(resolve => setTimeout(resolve, 5000)); continue }
            if (release && release.version > pin.version && await verifyRelease(release, pin) && await textHash(body) === release.sw) return
            await lockdown(release ? 'A new version of the app is not signed by your release passkey.' : 'A new version of the app has no release signature.')
            return
        }
    })().finally(() => { incomingCheck = null })
    return incomingCheck
}
self.registration.addEventListener('updatefound', () => { const incoming = self.registration.installing; if (incoming) checkIncoming(incoming.scriptURL) })
self.addEventListener('message', event => {
    if (event.data?.type !== 'color-release-check') return
    const incoming = self.registration.installing || self.registration.waiting
    if (incoming) event.waitUntil(checkIncoming(incoming.scriptURL) || Promise.resolve())
})

self.addEventListener('install', event => event.waitUntil((async () => {
    const pin = await readPin()
    if (!RELEASE) {
        // An unsigned worker never replaces a signed one on a device that has accepted a signed release.
        if (pin) throw new Error('Unsigned Color release refused')
        return self.skipWaiting()
    }
    if (!await verifyRelease(RELEASE, pin) || pin && RELEASE.version < pin.version) throw new Error('Color release signature refused')
    // Every file is fetched fresh and must match the signed hash; otherwise this release is not installed yet (a cache that
    // has not caught up is retried on the next visit) and the current code keeps running.
    const cache = await caches.open(CODE_CACHE)
    for (const [name, hash] of Object.entries(RELEASE.files)) {
        const url = new URL(name, self.registration.scope).href, response = await fetch(url, { cache: 'no-store' })
        if (!response.ok || await textHash(await response.clone().text()) !== hash) throw new Error('Color release file does not match its signature: ' + name)
        await cache.put(url, response)
    }
    await writePin({ publicKey: RELEASE.publicKey, credentialId: RELEASE.credentialId, rpId: RELEASE.rpId, origin: RELEASE.origin, version: RELEASE.version })
    // A properly signed release ends an earlier alarm.
    await (await caches.open(PIN_CACHE)).delete('tamper.json')
    await self.skipWaiting()
})()))
self.addEventListener('activate', event => event.waitUntil((async () => {
    const cache = await caches.open(BACKUP_CACHE)
    for (const request of await cache.keys()) {
        const url = new URL(request.url)
        if (url.hostname.endsWith('.metered.live') && url.pathname.includes('/turn/credentials')) await cache.delete(request)
    }
    if (RELEASE) for (const name of await caches.keys()) if (name.startsWith('color-release-') && name !== CODE_CACHE && name !== PIN_CACHE) await caches.delete(name)
    await self.clients.claim()
})()))
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url)
    if (url.origin === location.origin && url.pathname.endsWith('/backup.webmanifest')) {
        const color = /^[0-9a-f]{6}$/i.test(url.searchParams.get('color') || '') ? url.searchParams.get('color') : 'ffffff'
        const root = new URL('./', url).href
        event.respondWith(Promise.resolve(new Response(JSON.stringify({ id: root + 'color-' + color + '-backup.html', name: 'Color #' + color.toUpperCase(), short_name: '#' + color.toUpperCase(), start_url: root + 'color-' + color + '-backup.html', scope: root, display: 'standalone', background_color: '#ffffff', theme_color: '#' + color, icons: [{ src: root + 'backup-icon-192.png?color=' + color, sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: root + 'backup-icon-512.png?color=' + color, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }, { src: root + 'backup-icon.svg?color=' + color, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' } })))
        return
    }
    if (url.origin === location.origin && url.pathname.endsWith('/block.webmanifest')) {
        const color = /^[0-9a-f]{6}$/i.test(url.searchParams.get('color') || '') ? url.searchParams.get('color') : 'ffffff'
        const page = /^[a-z0-9_-]+\.html$/i.test(url.searchParams.get('page') || '') ? url.searchParams.get('page') : 'index.html'
        const name = (url.searchParams.get('name') || 'Color Block').slice(0, 60)
        const root = new URL('./', url).href
        event.respondWith(Promise.resolve(new Response(JSON.stringify({ id: root + page, name, short_name: name.slice(0, 24), start_url: root + page, scope: root, display: 'standalone', background_color: '#ffffff', theme_color: '#' + color, icons: [{ src: root + 'backup-icon-192.png?color=' + color, sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: root + 'backup-icon-512.png?color=' + color, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }, { src: root + 'backup-icon.svg?color=' + color, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' } })))
        return
    }
    if (url.origin === location.origin && url.pathname.endsWith('/backup-icon.svg')) {
        const color = /^[0-9a-f]{6}$/i.test(url.searchParams.get('color') || '') ? url.searchParams.get('color') : 'ffffff'
        event.respondWith(Promise.resolve(new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#${color}"/></svg>`, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } })))
        return
    }
    if (url.origin === location.origin && /\/backup-icon-(192|512)\.png$/.test(url.pathname)) {
        const color = /^[0-9a-f]{6}$/i.test(url.searchParams.get('color') || '') ? url.searchParams.get('color') : 'ffffff'
        event.respondWith(iconResponse(color, Number(url.pathname.match(/(192|512)\.png$/)[1])))
        return
    }
    // Installed documents are explicitly saved by Color. Runtime traffic, credentials and
    // updated SDK/block definitions must reach the network instead of a permanent old cache.
    if (event.request.method === 'GET' && url.origin === location.origin && /\/color-[a-z0-9_-]+\.html$/i.test(url.pathname) && !url.search) {
        event.respondWith(caches.open(BACKUP_CACHE).then(cache => cache.match(event.request).then(saved => saved || fetch(event.request))))
        return
    }
    const scope = new URL(self.registration.scope).pathname
    // With a signed release, its files are always served from the copy that matched the signature, whatever query or cache
    // mode the request uses. A missing copy is fetched again and used only if it still matches.
    const releasePath = RELEASE && event.request.method === 'GET' && url.origin === location.origin && url.pathname.startsWith(scope) ? (url.pathname.slice(scope.length) || 'index.html') : null
    if (releasePath && Object.prototype.hasOwnProperty.call(RELEASE.files, releasePath)) {
        const key = new URL(releasePath, self.registration.scope).href
        event.respondWith(caches.open(CODE_CACHE).then(async cache => {
            const saved = await cache.match(key)
            if (saved) return saved
            const response = await fetch(key, { cache: 'no-store' })
            if (response.ok && await textHash(await response.clone().text()) === RELEASE.files[releasePath]) { await cache.put(key, response.clone()); return response }
            return new Response('This file does not match the signed Color release on this device.', { status: 409, headers: { 'Content-Type': 'text/plain' } })
        }))
        return
    }
    const blockHost = url.pathname === scope + 'index.html' && url.searchParams.has('blockHost') && [...url.searchParams.keys()].every(key => key === 'blockHost')
    const staticAsset = url.pathname === scope || /\/(index\.html|color\.js|blocks\.json)$/.test(url.pathname) || url.pathname.startsWith(scope + 'libs/')
    if (event.request.method === 'GET' && url.origin === location.origin && url.pathname.startsWith(scope) && staticAsset && (!url.search || blockHost) && event.request.cache !== 'no-store') {
        const cacheKey = blockHost ? new URL(url.pathname, url.origin).href : event.request
        event.respondWith(caches.open(BACKUP_CACHE).then(async cache => {
            try {
                const response = await fetch(event.request)
                if (response.ok && !/no-store|private/i.test(response.headers.get('Cache-Control') || '')) await cache.put(cacheKey, response.clone())
                return response
            } catch (error) { const saved = await cache.match(cacheKey); if (saved) return saved; throw error }
        }))
    }
})
