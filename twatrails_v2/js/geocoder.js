/* ============================================================
   geocoder.js — Place search via Nominatim (OpenStreetMap)
   No API key required. Respects usage policy (1 req/s max).
   ============================================================ */

'use strict';

const Geocoder = (() => {
  let map = null;
  let marker = null;
  let debounceTimer = null;
  let lastQuery = '';

  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

  function init(leafletMap) { map = leafletMap; }

  async function search(query) {
    if (!query || query.length < 3) return [];
    const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'TrailMate-PWA' }
    });
    if (!resp.ok) throw new Error('Geocoder unavailable');
    return resp.json();
  }

  // Fly map to a Nominatim result
  function flyTo(result) {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);
    const bbox = result.boundingbox; // [minLat, maxLat, minLon, maxLon]

    if (marker) map.removeLayer(marker);
    marker = L.marker([lat, lon]).addTo(map)
      .bindPopup(`<b>${result.display_name.split(',')[0]}</b>`)
      .openPopup();

    if (bbox) {
      map.fitBounds([[parseFloat(bbox[0]), parseFloat(bbox[2])],
                     [parseFloat(bbox[1]), parseFloat(bbox[3])]], { padding:[30,30] });
    } else {
      map.setView([lat, lon], 14);
    }
  }

  function clearMarker() {
    if (marker) { map.removeLayer(marker); marker = null; }
  }

  return { init, search, flyTo, clearMarker };
})();
