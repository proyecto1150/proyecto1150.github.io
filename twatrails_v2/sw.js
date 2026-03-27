/* ============================================================
   P-11.50 — Service Worker v2

   CACHE BUSTING: Update BUILD_TS to any new number before
   each git push. This forces all clients to download fresh
   files — no manual cache clearing needed.

   Quick way: replace the number below with current unix time
   e.g. from https://www.unixtimestamp.com/
   ============================================================ */

const BUILD_TS = '1774643365';
const CACHE    = `p1150-${BUILD_TS}`;
const TILES    = 'p1150-tiles';

const STATIC = [
  './',
  './index.html',
  './js/routes.js',
  './js/strava.js',
  './js/elevation.js',
  './js/recorder.js',
  './js/waypoints.js',
  './js/geocoder.js',
  './js/livetrack.js',
  './js/photos.js',
  './js/app.js',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

// ── Install: pre-cache app shell ──────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: delete ALL old caches ───────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== TILES)
            .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for app shell, cache-first for tiles ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Map tiles: cache-first (offline hiking)
  if (url.hostname.includes('tile.') || url.hostname.includes('arcgisonline')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(r => {
          caches.open(TILES).then(c => c.put(e.request, r.clone()));
          return r;
        });
        return cached || network;
      })
    );
    return;
  }

  // Never cache live API calls
  if (url.hostname === 'www.strava.com'              ||
      url.hostname.includes('workers.dev')           ||
      url.hostname === 'nominatim.openstreetmap.org' ||
      url.hostname === 'fonts.googleapis.com'        ||
      url.hostname === 'fonts.gstatic.com'           ||
      url.hostname.includes('firebaseio.com')        ||
      url.hostname === 'www.gstatic.com') return;

  // App shell: NETWORK-FIRST → always gets latest when online,
  // falls back to cache when offline
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Force update from app code ─────────────────────────────────
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
