/* ============================================================
   TrailMate — Service Worker
   
   CACHE BUSTING:
   BUILD_TS below is replaced at deploy time by the GitHub
   Actions workflow. Every push → new timestamp → new cache
   name → old cache auto-deleted → no manual clearing needed.
   ============================================================ */

const BUILD_TS = '{{BUILD_TS}}';
const CACHE    = `trailmate-${BUILD_TS}`;
const TILES    = 'trailmate-tiles';

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
  './js/app.js',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== TILES).map(k => {
          console.log('[SW] Purging old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Map tiles: network-first, tile cache fallback (offline hiking)
  if (url.hostname.includes('tile.') || url.hostname.includes('arcgisonline')) {
    e.respondWith(
      fetch(e.request)
        .then(r => { caches.open(TILES).then(c => c.put(e.request, r.clone())); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Never cache API/external calls
  if (url.hostname === 'www.strava.com' ||
      url.hostname.includes('workers.dev') ||
      url.hostname === 'nominatim.openstreetmap.org' ||
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com' ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname === 'www.gstatic.com') return;

  // App shell: cache-first
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});

// Allow app to trigger immediate update
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
