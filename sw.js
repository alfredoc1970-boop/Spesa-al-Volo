/* Spesa al Volo – service worker
   - l'app si apre subito dalla copia salvata e si aggiorna da sola in sottofondo
   - i componenti (lettura cartellino, Excel, icone) restano sul telefono per l'uso senza rete */
const VERSION = 'v1';
const SHELL = 'sav-shell-' + VERSION;
const OCR = 'sav-ocr-v1';
const RUNTIME = 'sav-runtime-v1';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
              'icons/icon-maskable-512.png', 'icons/icon-180.png', 'icons/favicon-64.png', 'lib/xlsx.full.min.js'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    for (const url of CORE) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) await cache.put(url === './' ? 'index.html' : url, await clean(res));
      } catch (e) { /* senza rete: si completa al prossimo avvio */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL, OCR, RUNTIME];
    for (const k of await caches.keys()) if (k.startsWith('sav-') && !keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// copia "pulita" della risposta: niente redirect, si può riusare per qualsiasi richiesta
async function clean(res) {
  const headers = new Headers(res.headers);
  return new Response(await res.arrayBuffer(), { status: res.status, statusText: res.statusText, headers });
}

async function page(event) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match('index.html');
  const update = (async () => {
    const res = await fetch(new URL('index.html', self.registration.scope).href, { cache: 'no-cache' });
    if (!res.ok) return null;
    const copy = await clean(res);
    let changed = false;
    if (cached) {
      const a = cached.headers.get('etag'), b = copy.headers.get('etag');
      changed = a && b ? a !== b : (await cached.clone().text()) !== (await copy.clone().text());
    }
    await cache.put('index.html', copy.clone());
    if (changed) {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      setTimeout(() => list.forEach(c => c.postMessage({ type: 'update-ready' })), 1500);
    }
    return copy;
  })();
  if (cached) {
    event.waitUntil(update.catch(() => null));
    return cached;
  }
  try {
    const fresh = await update;
    if (fresh) return fresh;
  } catch (e) {}
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><p style="font-family:sans-serif;padding:24px">Spesa al Volo non è ancora salvata su questo telefono. Aprila una volta con la rete attiva.</p>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {}); return res; });
  return hit || net;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === location.origin) { event.respondWith(page(event)); return; }
  if (url.origin === location.origin) {
    if (url.pathname.includes('/ocr/')) { event.respondWith(cacheFirst(req, OCR)); return; }
    if (url.pathname.endsWith('/sw.js')) return;
    event.respondWith(cacheFirst(req, SHELL).catch(() => caches.match(req)));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, RUNTIME)); return;
  }
  // mappa negozi e nomi prodotti: sempre dalla rete (se manca, l'app lo gestisce)
});
