const BACKUP_CACHE = 'color-backups-v1'

const iconResponse = async (color, size) => {
    const canvas = new OffscreenCanvas(size, size), context = canvas.getContext('2d')
    context.fillStyle = '#' + color
    context.fillRect(0, 0, size, size)
    return new Response(await canvas.convertToBlob({ type: 'image/png' }), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' } })
}

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil((async () => {
    const cache = await caches.open(BACKUP_CACHE)
    for (const request of await cache.keys()) {
        const url = new URL(request.url)
        if (url.hostname.endsWith('.metered.live') && url.pathname.includes('/turn/credentials')) await cache.delete(request)
    }
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
