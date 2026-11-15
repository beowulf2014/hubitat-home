importScripts('/version.js?v=1.0.0');
const VERSION = '1.0.0';
const CACHE = 'hh-' + VERSION;
const SHELL = ['/', '/app.css?v=1.0.0', '/app.js?v=1.0.0', '/voice.js?v=1.0.0', '/version.js?v=1.0.0', '/icons/icon-192.png', '/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'skip-waiting') self.skipWaiting();
  if (e.data && e.data.type === 'get-version') { const m = { type: 'sw-version', version: VERSION }; if (e.ports && e.ports[0]) e.ports[0].postMessage(m); else if (e.source) e.source.postMessage(m); }
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // Network first so updates show up right away; cached shell when offline.
  if (u.pathname.startsWith('/setup')) return; // the setup wizard is always fetched live, never cached
  const key = e.request.mode === 'navigate' ? '/' : e.request;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); if (r.ok && !r.redirected) caches.open(CACHE).then((x) => x.put(key, c)); return r; })
    .catch(() => caches.match(key)));
});
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: 'Hubitat Home', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Hubitat Home', {
    body: d.body || '', tag: d.tag, renotify: true, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png',
    data: { url: d.url || '/', deviceId: d.deviceId || null },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { url, deviceId } = e.notification.data || {};
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if (new URL(w.url).origin === location.origin) { await w.focus(); if (deviceId) w.postMessage({ type: 'open-device', id: deviceId }); return; } }
    await clients.openWindow(url || '/');
  })());
});
