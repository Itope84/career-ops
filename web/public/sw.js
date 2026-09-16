// Minimal service worker — exists to make the app INSTALLABLE on Android.
//
// Chrome will not offer "Install app" without a registered service worker that
// has a fetch handler and can answer a navigation while offline. The manifest
// and icons were already correct; this was the missing piece. (iOS Safari has
// no such requirement, which is why Add to Home Screen already worked there.)
//
// DELIBERATELY DOES NOT CACHE APP CONTENT. These instances sit behind
// Cloudflare Access, so caching pages or API responses would mean a signed-out
// device — or a different person on a shared device — could be served content
// out of the cache that Access should have gated. The only thing precached is
// a static offline page that contains nothing personal.
//
// Net effect: every request goes to the network exactly as before; the sole
// added behaviour is serving offline.html when a NAVIGATION fails.

const CACHE = 'career-ops-shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only navigations get the offline fallback. Everything else — API calls,
  // assets, the NDJSON job streams — is left completely untouched, so a long
  // scan/evaluate stream is never intercepted or buffered by this worker.
  if (request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(CACHE);
      const offline = await cache.match(OFFLINE_URL);
      return (
        offline ??
        new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
      );
    }),
  );
});
