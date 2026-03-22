/* TrailMate — Service Worker (GitHub Pages edition) */
const CACHE = 'trailmate-v4-gh';
const STATIC = [
  './', './index.html', './css/style.css',
  './js/routes.js', './js/strava.js', './js/elevation.js',
  './js/recorder.js', './js/waypoints.js', './js/geocoder.js', './js/app.js',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE && k !== CACHE+'-tiles').map(k => caches.delete(k)))
  ));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Cache map tiles (network first, cache fallback for offline)
  if (url.hostname.includes('tile.') || url.hostname.includes('arcgisonline')) {
    e.respondWith(fetch(e.request).then(r => {
      caches.open(CACHE+'-tiles').then(c => c.put(e.request, r.clone()));
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // Never cache Strava API, Cloudflare Worker, or Nominatim
  if (url.hostname === 'www.strava.com' ||
      url.hostname.includes('workers.dev') ||
      url.hostname === 'nominatim.openstreetmap.org') return;
  // App shell — cache first
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});
