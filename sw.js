const BACKUP_CACHE = 'color-backups-v1'

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url)
    if (url.origin === location.origin && url.pathname.endsWith('/backup.webmanifest')) {
        const color = /^[0-9a-f]{6}$/i.test(url.searchParams.get('color') || '') ? url.searchParams.get('color') : 'ffffff'
        const root = new URL('./', url).href
        event.respondWith(Promise.resolve(new Response(JSON.stringify({ id: '/color-' + color + '-backup', name: 'Color #' + color.toUpperCase(), short_name: '#' + color.toUpperCase(), start_url: root + 'color-' + color + '-backup.html', scope: root, display: 'standalone', background_color: '#ffffff', theme_color: '#' + color, icons: [{ src: root + 'backup-icon.svg?color=' + color, sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' }, { src: root + 'backup-icon.svg?color=' + color, sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }] }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' } })))
        return
    }
    if (url.origin === location.origin && url.pathname.endsWith('/block.webmanifest')) {
        const color = /^[0-9a-f]{6}$/i.test(url.searchParams.get('color') || '') ? url.searchParams.get('color') : 'ffffff'
        const page = /^[a-z0-9_-]+\.html$/i.test(url.searchParams.get('page') || '') ? url.searchParams.get('page') : 'index.html'
        const name = (url.searchParams.get('name') || 'Color Block').slice(0, 60)
        const root = new URL('./', url).href
        event.respondWith(Promise.resolve(new Response(JSON.stringify({ id: root + page, name, short_name: name.slice(0, 24), start_url: root + page, scope: root, display: 'standalone', background_color: '#ffffff', theme_color: '#' + color, icons: [{ src: root + 'backup-icon.svg?color=' + color, sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' }, { src: root + 'backup-icon.svg?color=' + color, sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }] }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' } })))
        return
    }
    if (url.origin === location.origin && url.pathname.endsWith('/backup-icon.svg')) {
        const color = /^[0-9a-f]{6}$/i.test(url.searchParams.get('color') || '') ? url.searchParams.get('color') : 'ffffff'
        event.respondWith(Promise.resolve(new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#${color}"/></svg>`, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } })))
        return
    }
    if (event.request.method === 'GET') event.respondWith(caches.open(BACKUP_CACHE).then(cache => cache.match(event.request).then(saved => saved || fetch(event.request).then(response => { if (response.ok || response.type === 'opaque') cache.put(event.request, response.clone()); return response }))))
})
