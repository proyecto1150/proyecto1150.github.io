/* ============================================================
   TrailMate — app.js (GitHub Pages edition)
   ============================================================ */

'use strict';

const OFF_ROUTE_THRESHOLD = 100; // metres

const state = {
  map: null,
  layers: { topo:null, osm:null, satellite:null },
  currentLayer: 'topo',
  loadedRoutes: [],
  activePreloaded: null,
  stravaPolyline: null,
  stravaStats: null,
  stravaActivities: [],   // all fetched — used by Stats tab
  stravaSharedIds: new Set(), // activity IDs currently shared with observers
  sharedActivities: [],      // activities currently shared — used by Stats+Compare
  userMarker: null,
  userCircle: null,
  gpsWatchId: null,
  gpsActive: false,
  gpsFixes: 0,
  lastPos: null,
  offRoute: false,
  wakeLock: null,         // Screen Wake Lock — keeps screen on while sharing
};

const $ = id => document.getElementById(id);

// ── Init ─────────────────────────────────────────────────────
(async function init() {
  const callbackResult = await handleStravaCallback();

  $('splashEnter').addEventListener('click', () => {
    $('splash').classList.add('hidden');
    $('app').classList.remove('hidden');
    initMap();
    initDragPanel();
    initFABs();
    initSearch();
    renderPreloadedRoutes();
    initStravaUI(callbackResult);
    restoreStravaConfig();
    initWaypointsUI();
    ElevationChart.init($('elevCanvas'));
    initLiveTrack();
    initPhotosUI();
  });
})();

// ── Map ──────────────────────────────────────────────────────
function initMap() {
  // Default view: GR11 start area — Pyrenees, Zuriza trailhead
  state.map = L.map('map', { zoomControl: true, attributionControl: true })
    .setView([42.73, 0.75], 8);

  state.layers.topo = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { attribution:'© OpenTopoMap (CC-BY-SA)', maxZoom:17 }
  );
  state.layers.osm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution:'© OpenStreetMap contributors', maxZoom:19 }
  );
  state.layers.satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution:'© Esri', maxZoom:18 }
  );
  state.layers.topo.addTo(state.map);

  Waypoints.init(state.map);
  Geocoder.init(state.map);
  Photos.init(state.map);
}

// ── Drag panel ───────────────────────────────────────────────
function initDragPanel() {
  const panel = $('bottomPanel'), handle = $('dragHandle');
  let startY, startH;
  const onMove = e => {
    e.preventDefault();
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    panel.style.height = Math.min(Math.max(80, startH + (startY - y)), window.innerHeight * 0.85) + 'px';
    state.map.invalidateSize(); positionFABs();
  };
  const onEnd = () => {
    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd);
  };
  const onStart = e => {
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startH = panel.offsetHeight;
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive:false }); document.addEventListener('touchend', onEnd);
  };
  handle.addEventListener('mousedown', onStart);
  handle.addEventListener('touchstart', onStart, { passive:true });
}

// ── FABs ─────────────────────────────────────────────────────
function initFABs() {
  positionFABs(); window.addEventListener('resize', positionFABs);
  $('btnLayer').addEventListener('click', cycleLayer);
  $('btnCenter').addEventListener('click', centerOnUser);
  $('btnElev').addEventListener('click', toggleElevPanel);
  $('btnTogglePhotos').addEventListener('click', togglePhotosVisibility);
  $('btnCloseElev').addEventListener('click', () => {
    $('elevPanel').classList.add('hidden'); state.map.invalidateSize(); positionFABs();
  });
}

function positionFABs() {
  const panelH = $('bottomPanel').offsetHeight;
  const elevH  = $('elevPanel').classList.contains('hidden') ? 0 : $('elevPanel').offsetHeight;
  const bottom = panelH + elevH + 10;
  $('fabGroup').style.bottom = bottom + 'px';
  $('toast').style.bottom    = (bottom + 52) + 'px';
}

function cycleLayer() {
  const order  = ['topo','osm','satellite'];
  const emojis = { topo:'🗻', osm:'🗺', satellite:'🛰' };
  const labels = { topo:'Topographic', osm:'OpenStreetMap', satellite:'Satellite' };
  const next   = order[(order.indexOf(state.currentLayer) + 1) % order.length];
  state.map.removeLayer(state.layers[state.currentLayer]);
  state.layers[next].addTo(state.map);
  state.currentLayer = next;
  $('btnLayer').textContent = emojis[next];
  showToast(labels[next]);
}

function centerOnUser() {
  if (state.lastPos) state.map.setView([state.lastPos.lat, state.lastPos.lon], Math.max(state.map.getZoom(), 15), { animate:true });
  else showToast('Enable GPS tracking first');
}

function toggleElevPanel() {
  $('elevPanel').classList.toggle('hidden');
  state.map.invalidateSize(); positionFABs();
  if (!$('elevPanel').classList.contains('hidden')) ElevationChart.draw();
}

// ── Search ───────────────────────────────────────────────────
function initSearch() {
  const input = $('searchInput'), results = $('searchResults');
  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (!q || q.length < 3) { results.classList.add('hidden'); return; }
    debounce = setTimeout(() => runSearch(q), 400);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { results.classList.add('hidden'); input.blur(); } });
  document.addEventListener('click', e => { if (!$('searchWrap').contains(e.target)) results.classList.add('hidden'); });
}

async function runSearch(q) {
  const results = $('searchResults');
  results.innerHTML = '<div class="search-result-item" style="color:var(--text2)">Searching…</div>';
  results.classList.remove('hidden');
  try {
    const hits = await Geocoder.search(q);
    results.innerHTML = '';
    if (!hits.length) { results.innerHTML = '<div class="search-result-item" style="color:var(--text2)">No results</div>'; return; }
    hits.forEach(hit => {
      const parts = hit.display_name.split(',');
      const item  = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `<div class="search-result-name">${parts[0]}</div><div class="search-result-sub">${parts.slice(1,3).join(',').trim()}</div>`;
      item.addEventListener('click', () => {
        Geocoder.flyTo(hit); results.classList.add('hidden');
        $('searchInput').value = parts[0]; $('searchInput').blur();
      });
      results.appendChild(item);
    });
  } catch { results.innerHTML = '<div class="search-result-item" style="color:var(--red)">Search unavailable</div>'; }
}

// ── Tabs ─────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'compare') updateCompareTab();
    if (btn.dataset.tab === 'stats')   updateStatsTab();
  });
});

// ── Pre-loaded Routes ─────────────────────────────────────────
function renderPreloadedRoutes() {
  const list = $('preloadedList');
  list.innerHTML = '';
  PRELOADED_ROUTES.forEach(route => {
    const item = document.createElement('div');
    item.className = 'preloaded-item'; item.dataset.id = route.id;
    const diffColor = DIFFICULTY_COLORS[route.difficulty] || '#fff';
    item.innerHTML = `
      <div class="preloaded-color" style="background:${route.color}"></div>
      <div class="preloaded-info">
        <div class="preloaded-name">${route.name}
          <span style="font-family:var(--mono);font-size:.6rem;margin-left:4px;color:${diffColor}">${route.difficulty}</span>
        </div>
        <div class="preloaded-meta">${route.region} · ${fmtDist(route.distance)} · ↑${route.elevation}m</div>
      </div>
      <div class="preloaded-badge" id="badge-${route.id}">Show</div>
    `;
    item.addEventListener('click', () => togglePreloadedRoute(route, item));
    list.appendChild(item);
  });
}

function togglePreloadedRoute(route, item) {
  const isActive = state.activePreloaded === route.id;
  state.loadedRoutes = state.loadedRoutes.filter(r => { if (r.preloaded) { state.map.removeLayer(r.polyline); return false; } return true; });
  document.querySelectorAll('.preloaded-item').forEach(el => { el.classList.remove('active'); const b = el.querySelector('[id^="badge-"]'); if (b) b.textContent = 'Show'; });
  Waypoints.clearRouteWaypoints(); hideRouteWaypoints();
  if (isActive) { state.activePreloaded = null; ElevationChart.clear(); renderActiveRoutes(); return; }
  state.activePreloaded = route.id;
  item.classList.add('active');
  const badge = $(`badge-${route.id}`); if (badge) badge.textContent = 'Active';
  const polyline = L.polyline(route.latlngs, { color:route.color, weight:4, opacity:0.88, lineJoin:'round' }).addTo(state.map);
  polyline.bindPopup(`<b>${route.name}</b><br/>${route.region} · ${fmtDist(route.distance)} · ↑${route.elevation}m<br/><small style="color:#aaa">${route.description}</small>`);
  state.map.fitBounds(polyline.getBounds(), { padding:[40,40] });
  const rawCoords = route.latlngs.map((ll,i) => ({ lat:ll[0], lon:ll[1], ele: route.elevations ? route.elevations[i] : 0 }));
  const routeEntry = { id:route.id, name:route.name, color:route.color, polyline, bounds:polyline.getBounds(), preloaded:true, rawCoords, stats:{ distance:route.distance, elevation:route.elevation, points:route.latlngs.length } };
  state.loadedRoutes.push(routeEntry);
  if (route.waypoints) { Waypoints.addRouteWaypoints(route.waypoints, route.color); renderRouteWaypoints(route.waypoints); }
  renderActiveRoutes(); showElevationForRoute(routeEntry); showToast(`${route.name} loaded`);
}

function showElevationForRoute(r) {
  if (!r.rawCoords) return;
  ElevationChart.setProfile(ElevationChart.buildProfileFromCoords(r.rawCoords));
  $('elevPanel').classList.remove('hidden');
  $('elevStats').textContent = `↑${Math.round(r.stats.elevation)}m · ${fmtDist(r.stats.distance)}`;
  state.map.invalidateSize(); positionFABs();
}

$('gpxUpload').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => addGPXRoute(ev.target.result, file.name.replace(/\.gpx$/i,''));
  reader.readAsText(file); e.target.value = '';
});

function parseGPX(text) {
  const xml = new DOMParser().parseFromString(text,'application/xml');
  const name = xml.querySelector('name')?.textContent?.trim() || 'Unnamed';
  const points = [...xml.querySelectorAll('trkpt,rtept,wpt')]; if (!points.length) return null;
  const coords = points.map(pt => ({ lat:parseFloat(pt.getAttribute('lat')), lon:parseFloat(pt.getAttribute('lon')), ele:parseFloat(pt.querySelector('ele')?.textContent||'0')||0 })).filter(c=>!isNaN(c.lat)&&!isNaN(c.lon));
  if (!coords.length) return null;
  let dist=0, elev=0; const latlngs = coords.map(c=>[c.lat,c.lon]);
  for (let i=1;i<latlngs.length;i++) { dist+=L.latLng(latlngs[i-1]).distanceTo(L.latLng(latlngs[i])); const d=coords[i].ele-coords[i-1].ele; if(d>0) elev+=d; }
  return { name, coords, latlngs, distance:dist, elevation:elev };
}

function addGPXRoute(text, fallback) {
  const parsed = parseGPX(text); if (!parsed) { showToast('Could not parse GPX'); return; }
  const colors = ['#4ade80','#38bdf8','#a78bfa','#fbbf24','#fb7185'];
  const color  = colors[state.loadedRoutes.filter(r=>!r.preloaded).length % colors.length];
  const polyline = L.polyline(parsed.latlngs, { color, weight:4, opacity:0.88, lineJoin:'round' }).addTo(state.map);
  polyline.bindPopup(`<b>${parsed.name}</b><br/>${fmtDist(parsed.distance)}`);
  state.map.fitBounds(polyline.getBounds(), { padding:[40,40] });
  const r = { id:Date.now(), name:parsed.name||fallback, color, polyline, bounds:polyline.getBounds(), preloaded:false, rawCoords:parsed.coords, stats:{distance:parsed.distance,elevation:parsed.elevation,points:parsed.latlngs.length} };
  state.loadedRoutes.push(r); renderActiveRoutes(); showElevationForRoute(r); showToast(`Loaded: ${parsed.name}`);
}

function renderActiveRoutes() {
  const section = $('activeRoutesSection'), list = $('routeList'); list.innerHTML = '';
  if (!state.loadedRoutes.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  state.loadedRoutes.forEach(r => {
    const el = document.createElement('div'); el.className = 'route-item';
    el.innerHTML = `<div class="route-dot" style="background:${r.color}"></div><div class="route-info"><div class="route-name">${r.name}</div><div class="route-meta">${fmtDist(r.stats.distance)} · ↑${Math.round(r.stats.elevation)}m</div></div><div class="route-actions"><button data-id="${r.id}" data-action="elev">📈</button><button data-id="${r.id}" data-action="fly">🎯</button><button data-id="${r.id}" data-action="del">✕</button></div>`;
    list.appendChild(el);
  });
  list.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = state.loadedRoutes.find(x=>x.id==btn.dataset.id); if (!r) return;
      if (btn.dataset.action==='fly')  state.map.fitBounds(r.bounds,{padding:[40,40]});
      if (btn.dataset.action==='elev') showElevationForRoute(r);
      if (btn.dataset.action==='del') {
        state.map.removeLayer(r.polyline); state.loadedRoutes = state.loadedRoutes.filter(x=>x.id!==r.id);
        if (r.preloaded) { state.activePreloaded=null; Waypoints.clearRouteWaypoints(); hideRouteWaypoints(); document.querySelectorAll('.preloaded-item').forEach(el=>{el.classList.remove('active'); const b=el.querySelector('[id^="badge-"]'); if(b) b.textContent='Show';}); }
        if (!state.loadedRoutes.length) ElevationChart.clear();
        renderActiveRoutes();
      }
    });
  });
}

// ── Waypoints ─────────────────────────────────────────────────
function initWaypointsUI() {
  const btn = $('btnAddPin');
  btn.addEventListener('click', () => {
    const active = Waypoints.getAddMode(); Waypoints.setAddMode(!active);
    $('pinModeNote').classList.toggle('hidden', active);
    btn.textContent = active ? '📌 Drop Note' : '✕ Cancel';
    btn.style.borderColor = active ? '' : 'var(--blue)';
    btn.style.color       = active ? '' : 'var(--blue)';
  });
  Waypoints.onChange(pins => {
    renderCustomPins(pins);
    $('pinModeNote').classList.add('hidden');
    btn.textContent = '📌 Drop Note'; btn.style.borderColor=''; btn.style.color='';
  });
  $('btnExportPins').addEventListener('click', exportPinsExcel);
}

function renderRouteWaypoints(waypoints) {
  const section = $('routeWaypointsSection'), list = $('routeWaypointList'); list.innerHTML = '';
  if (!waypoints?.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  waypoints.forEach(wp => {
    const el = document.createElement('div'); el.className = 'waypoint-item';
    el.innerHTML = `<div class="waypoint-icon">🏔</div><div class="waypoint-info"><div class="waypoint-name">${wp.name}</div>${wp.note?`<div class="waypoint-note">${wp.note}</div>`:''}</div>`;
    el.addEventListener('click', () => state.map.setView([wp.lat,wp.lon],15,{animate:true}));
    list.appendChild(el);
  });
}

function hideRouteWaypoints() { $('routeWaypointsSection').classList.add('hidden'); $('routeWaypointList').innerHTML=''; }

// Track which note IDs are shared
const _sharedNoteIds = new Set();

function renderCustomPins(pins) {
  const list=$('customPinList'), noMsg=$('noPinsMsg'), exp=$('pinExportRow');
  list.innerHTML='';
  if (!pins.length) { noMsg.classList.remove('hidden'); exp.classList.add('hidden'); return; }
  noMsg.classList.add('hidden'); exp.classList.remove('hidden');
  pins.forEach(pin => {
    const el=document.createElement('div'); el.className='waypoint-item';
    const dateStr = pin.date ? new Date(pin.date).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : '';
    const isShared = _sharedNoteIds.has(String(pin.id));
    const shareStyle = isShared
      ? 'background:rgba(4,55,242,.15);color:#0437F2;border:1px solid #0437F2;'
      : 'background:var(--bg4);color:var(--text2);border:1px solid var(--border2);';
    el.innerHTML=`
      <div class="waypoint-icon">📍</div>
      <div class="waypoint-info">
        <div class="waypoint-name">${pin.name}</div>
        ${pin.note ? `<div class="waypoint-note">${pin.note}</div>` : ''}
        <div class="waypoint-note" style="color:var(--text3)">${dateStr}</div>
      </div>
      <div class="waypoint-actions" style="display:flex;flex-direction:column;gap:3px">
        <button onclick="toggleNoteShare(${pin.id})"
          style="font-size:.65rem;padding:2px 6px;border-radius:5px;cursor:pointer;${shareStyle}font-family:var(--sans);font-weight:700">
          ${isShared ? '⏹' : '📡'}
        </button>
        <button onclick="Waypoints.remove(${pin.id});renderCustomPins(Waypoints.getCustom())" title="Remove" style="color:var(--text3)">✕</button>
      </div>`;
    el.addEventListener('click', e => { if(e.target.tagName==='BUTTON') return; state.map.setView([pin.lat,pin.lon],16,{animate:true}); });
    list.appendChild(el);
  });
}

async function toggleNoteShare(pinId) {
  const id = String(pinId);
  const pin = Waypoints.getCustom().find(p => String(p.id) === id);
  if (!pin) return;
  if (_sharedNoteIds.has(id)) {
    await LiveTrack.unpublishNote(id);
    _sharedNoteIds.delete(id);
    showToast('Note un-shared');
  } else {
    const ok = await LiveTrack.publishNote(pin);
    if (ok) { _sharedNoteIds.add(id); showToast('📡 Note shared'); }
    else showToast('Share failed');
  }
  renderCustomPins(Waypoints.getCustom());
}

function exportPinsExcel() {
  const pins = Waypoints.getCustom();
  if (!pins.length) { showToast('No notes to export'); return; }
  // Build CSV (opens in Excel)
  const rows = [['Date','Latitude','Longitude','Name','Notes']];
  pins.forEach(p => {
    const d = p.date ? new Date(p.date).toLocaleDateString() : '';
    rows.push([d, p.lat.toFixed(6), p.lon.toFixed(6), p.name, p.note||'']);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: 'notes.csv'
  });
  a.click(); URL.revokeObjectURL(a.href);
  showToast('Notes exported ✓');
}

// ── GPS + Off-route ───────────────────────────────────────────
$('btnGPS').addEventListener('click', () => state.gpsActive ? stopGPS() : startGPS());

async function startGPS() {
  if (!navigator.geolocation) { showToast('Geolocation not supported'); return; }
  setGPSStatus('searching');
  $('btnGPS').textContent='⏹ Stop Tracking'; $('btnGPS').classList.add('active');
  $('btnCenter').classList.remove('hidden');
  state.gpsWatchId = navigator.geolocation.watchPosition(onGPSSuccess, onGPSError, {
    enableHighAccuracy: true,
    maximumAge:         0,
    timeout:            30000,
  });
  state.gpsActive = true;

  // Request Wake Lock so screen stays on while GPS is active
  // This keeps watchPosition firing on both Android and iOS PWA
  await acquireWakeLock();
}

function stopGPS() {
  if (state.gpsWatchId!=null) navigator.geolocation.clearWatch(state.gpsWatchId);
  state.gpsWatchId=null; state.gpsActive=false;
  setGPSStatus('off');
  $('btnGPS').textContent='📍 Track My Position'; $('btnGPS').classList.remove('active');
  $('btnCenter').classList.add('hidden'); $('offRouteAlert').classList.add('hidden');
  if (Recorder.getIsRecording()) Recorder.stop();
  releaseWakeLock();
  showToast('GPS stopped');
}

function onGPSSuccess(pos) {
  setGPSStatus('on'); state.gpsFixes++;
  const { latitude:lat, longitude:lon, accuracy, altitude, speed, heading } = pos.coords;
  state.lastPos = { lat, lon };
  const icon = L.divIcon({ className:'', html:`<div class="user-marker"></div>`, iconSize:[20,20], iconAnchor:[10,10] });
  if (state.userMarker) { state.userMarker.setLatLng([lat,lon]); state.userCircle.setLatLng([lat,lon]).setRadius(accuracy); }
  else { state.userMarker=L.marker([lat,lon],{icon,zIndexOffset:1000}).addTo(state.map).bindPopup('You are here'); state.userCircle=L.circle([lat,lon],{radius:accuracy,color:'#f97316',fillColor:'#f97316',fillOpacity:0.08,weight:1}).addTo(state.map); state.map.setView([lat,lon],15); }
  if (Recorder.getIsRecording()) Recorder.addPoint(pos);
  LiveTrack.pushPosition(pos); // push to Firebase if sharing is active

  let offRouteDist = null;
  if (state.loadedRoutes.length) {
    const lls = state.loadedRoutes[0].polyline.getLatLngs();
    offRouteDist = distToRoute(lat, lon, lls.map(ll=>[ll.lat,ll.lng]));
    const nowOff = offRouteDist > OFF_ROUTE_THRESHOLD;
    if (nowOff !== state.offRoute) {
      state.offRoute = nowOff;
      $('offRouteAlert').classList.toggle('hidden', !nowOff);
      if (nowOff) showToast(`⚠ Off route — ${Math.round(offRouteDist)}m from path`);
    }
    let minD=Infinity, closestIdx=0;
    lls.forEach((ll,i)=>{ const d=haversineDist([lat,lon],[ll.lat,ll.lng]); if(d<minD){minD=d;closestIdx=i;} });
    ElevationChart.setPositionPct(closestIdx/(lls.length-1));
  }

  $('statSpeed').textContent    = speed!=null?(speed*3.6).toFixed(1):'—';
  $('statAlt').textContent      = altitude!=null?Math.round(altitude):'—';
  $('statAcc').textContent      = Math.round(accuracy);
  $('statOffRoute').textContent = offRouteDist!=null?Math.round(offRouteDist):'—';
  $('statCoords').textContent   = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  $('statHeadFixes').textContent= `${heading!=null?Math.round(heading)+'°':'—'} / ${state.gpsFixes} fixes`;
}

function onGPSError(err) {
  const msgs={1:'Permission denied',2:'Position unavailable',3:'Timeout'};
  showToast(`GPS: ${msgs[err.code]||err.message}`); setGPSStatus('off');
  $('btnGPS').textContent='📍 Track My Position'; $('btnGPS').classList.remove('active'); state.gpsActive=false;
}

function setGPSStatus(s) {
  $('gpsStatus').className=`gps-badge gps-${s}`;
  $('gpsStatus').querySelector('.gps-label').textContent=s==='off'?'GPS':s==='searching'?'Searching…':'Live';
}

// ── Recorder ─────────────────────────────────────────────────
function initRecorderUI() {
  $('btnRecStart').addEventListener('click', () => {
    if (!state.gpsActive) { showToast('Enable GPS first'); document.querySelector('[data-tab="routes"]').click(); return; }
    Recorder.start();
    $('recReady').classList.add('hidden');
    $('recActive').classList.remove('hidden');
    $('recDone').classList.add('hidden');
    $('recIndicator').classList.remove('hidden');
    showToast('Recording started');
  });
  $('btnRecStop').addEventListener('click', () => {
    Recorder.stop();
    $('recActive').classList.add('hidden');
    $('recIndicator').classList.add('hidden');
    renderRecSummary(Recorder.getStats());
    $('recDone').classList.remove('hidden');
    showToast('Recording stopped');
  });
  $('btnRecFit').addEventListener('click', () => Recorder.fitBounds());
  $('btnRecDownload').addEventListener('click', () => { if (Recorder.downloadGPX()) showToast('GPX exported ✓'); });
  $('btnRecDiscard').addEventListener('click', () => {
    Recorder.clear();
    $('recDone').classList.add('hidden');
    $('recReady').classList.remove('hidden');
    showToast('Recording discarded');
  });
  Recorder.onUpdate(stats => {
    if (!stats) return;
    const mm = String(Math.floor(stats.elapsed / 60)).padStart(1, '0');
    const ss = String(stats.elapsed % 60).padStart(2, '0');
    const t  = `${mm}:${ss}`;
    $('recDist').textContent  = (stats.distance / 1000).toFixed(2);
    $('recTime').textContent  = t;
    $('recSpeed').textContent = stats.avgSpeed.toFixed(1);
    $('recGain').textContent  = Math.round(stats.elevGain);
    $('recElapsedBadge').textContent = t;
    // Show segment count if there are gaps (screen was turned off on iOS)
    const segEl = $('recSegments');
    if (segEl) {
      if (stats.segments > 1) {
        segEl.textContent = `${stats.segments} segments (${stats.segments - 1} gap${stats.segments > 2 ? 's' : ''} detected)`;
        segEl.style.display = 'block';
      } else {
        segEl.style.display = 'none';
      }
    }
  });
}

function renderRecSummary(stats) {
  const mm=String(Math.floor(stats.elapsed/60)).padStart(1,'0'), ss=String(stats.elapsed%60).padStart(2,'0');
  $('recSummary').innerHTML=`
    <div class="rec-summary-item"><div class="rec-summary-val">${fmtDist(stats.distance)}</div><div class="rec-summary-lbl">Distance</div></div>
    <div class="rec-summary-item"><div class="rec-summary-val">${mm}:${ss}</div><div class="rec-summary-lbl">Duration</div></div>
    <div class="rec-summary-item"><div class="rec-summary-val">${stats.avgSpeed.toFixed(1)}</div><div class="rec-summary-lbl">Avg km/h</div></div>
    <div class="rec-summary-item"><div class="rec-summary-val">↑${Math.round(stats.elevGain)}m</div><div class="rec-summary-lbl">Elev gain</div></div>`;
}

// ── Strava UI ─────────────────────────────────────────────────
function restoreStravaConfig() {
  const cfg = StravaAuth.getConfig();
  if (cfg.clientId)     $('stravaClientId').value     = cfg.clientId;
  if (cfg.clientSecret) $('stravaClientSecret').value = cfg.clientSecret;
  if (cfg.proxyUrl)     $('stravaProxyUrl').value     = cfg.proxyUrl;
  // Redirect URI defaults to current page URL (correct for GitHub Pages)
  $('stravaRedirectUri').value = cfg.redirectUri || (window.location.origin + window.location.pathname);
}

function initStravaUI(callbackResult) {
  if (callbackResult?.error)   { showToast(`Strava: ${callbackResult.error}`); document.querySelector('[data-tab="strava"]').click(); $('stravaConfigDetails').open=true; }
  if (callbackResult?.denied)  showToast('Strava connection cancelled');
  if (callbackResult?.success) { showToast('Strava connected ✓'); document.querySelector('[data-tab="strava"]').click(); }
  if (StravaAuth.isConnected()) { showStravaConnected(); loadStravaActivities(); }

  $('btnStravaLogin').addEventListener('click', () => {
    try { StravaAuth.startOAuth(); }
    catch(e) { showToast(e.message); $('stravaConfigDetails').open=true; }
  });

  $('btnSaveStravaConfig').addEventListener('click', () => {
    const clientId     = $('stravaClientId').value.trim();
    const clientSecret = $('stravaClientSecret').value.trim();
    const redirectUri  = $('stravaRedirectUri').value.trim();
    const proxyUrl     = $('stravaProxyUrl').value.trim();
    if (!clientId || !clientSecret) { showToast('Enter Client ID and Secret first'); return; }
    if (!proxyUrl) { showToast('Enter your Cloudflare Worker proxy URL'); return; }
    StravaAuth.saveConfig({ clientId, clientSecret, redirectUri, proxyUrl });
    showToast('Config saved — connecting…');
    setTimeout(() => StravaAuth.startOAuth(), 700);
  });

  $('btnStravaRefresh').addEventListener('click', loadStravaActivities);
  $('btnStravaLogout').addEventListener('click', () => { StravaAuth.logout(); clearStravaOverlay(true); showStravaDisconnected(); showToast('Disconnected'); });
  $('btnClearStrava').addEventListener('click', () => clearStravaOverlay(true));
  $('btnFitBoth').addEventListener('click', fitBothRoutes);
}

function showStravaConnected() {
  $('stravaConnect').classList.add('hidden'); $('stravaConnected').classList.remove('hidden');
  const athlete = StravaAuth.getAthlete();
  if (athlete) { $('stravaAuthStatus').textContent=`${athlete.firstname} ${athlete.lastname}`; if(athlete.profile_medium){$('stravaAvatar').src=athlete.profile_medium;$('stravaAvatar').classList.remove('hidden');} }
  else $('stravaAuthStatus').textContent='Connected';
}

function showStravaDisconnected() {
  $('stravaConnect').classList.remove('hidden'); $('stravaConnected').classList.add('hidden');
  $('stravaAvatar').classList.add('hidden'); $('stravaAuthStatus').textContent='Not connected'; $('activityList').innerHTML='';
}

async function loadStravaActivities() {
  const list=$('activityList'); list.innerHTML='<div style="padding:10px;color:var(--text2);font-size:.8rem">Loading…</div>';
  try {
    const acts=await StravaAuth.fetchActivities(); if(!acts.length){list.innerHTML='<div style="padding:10px;color:var(--text2);font-size:.8rem">No activities found.</div>';return;}
    state.stravaActivities = acts;
    list.innerHTML='';
    acts.forEach(act=>{
      const item=document.createElement('div'); item.className='activity-item';
      const icon=ACTIVITY_ICONS[act.type]||ACTIVITY_ICONS.default;
      const date=new Date(act.start_date_local).toLocaleDateString(undefined,{month:'short',day:'numeric'});
      const isShared = state.stravaSharedIds.has(String(act.id));
      item.dataset.actId = act.id;
      item.innerHTML=`
        <div class="activity-type-icon">${icon}</div>
        <div class="activity-info">
          <div class="activity-name">${act.name}</div>
          <div class="activity-meta">${date} · ${fmtDist(act.distance)} · ↑${Math.round(act.total_elevation_gain||0)}m · ${fmtTime(act.moving_time)}</div>
        </div>
        <button class="activity-share-btn ${isShared ? 'shared' : ''}"
                data-act-id="${act.id}"
                title="${isShared ? 'Unshare' : 'Share with observers'}">
          ${isShared ? '⏹ Unshare' : '📡 Share'}
        </button>`;
      item.querySelector('.activity-share-btn').addEventListener('click', async e => {
        e.stopPropagation();
        await toggleActivityShare(act, item);
      });
      item.addEventListener('click', () => loadActivityOnMap(act, item));
      list.appendChild(item);
    });
  } catch(e) { list.innerHTML=`<div style="padding:10px;color:var(--red);font-size:.8rem">${e.message}</div>`; if(e.message.includes('session expired')) showStravaDisconnected(); }
}

function loadStreamsOnMap(activity, streams, itemEl) {
  // Draw streams onto map — shared by loadActivityOnMap and toggleActivityShare
  document.querySelectorAll('.activity-item').forEach(el => el.classList.remove('active'));
  if (itemEl) itemEl.classList.add('active');
  clearStravaOverlay(false); // don't unpublish already-shared activities
  const latlngs = streams.latlng.data;
  const alts    = streams.altitude?.data || [];
  state.stravaPolyline = L.polyline(latlngs, {
    color:'#0437F2', weight:4, opacity:0.88, dashArray:'7 4', lineJoin:'round'
  }).addTo(state.map);
  state.stravaPolyline.bindPopup(() => buildStravaPopup(state.stravaStats));
  state.stravaPolyline.on('click', () => {
    state.stravaPolyline.setPopupContent(buildStravaPopup(state.stravaStats));
  });
  state.map.fitBounds(state.stravaPolyline.getBounds(), { padding:[40,40] });
  setTimeout(() => state.stravaPolyline.openPopup(), 600);
  let elevGain = 0;
  for (let i=1; i<alts.length; i++) { const d=alts[i]-alts[i-1]; if(d>0) elevGain+=d; }
  state.stravaStats = {
    stravaId:  activity.id,
    name:      activity.name,
    distance:  activity.distance,
    elevation: activity.total_elevation_gain || elevGain,
    movingTime:activity.moving_time,
    points:    latlngs.length,
    latlngs,
  };
  $('stravaName').textContent = state.stravaStats.name;
  $('stravaDist').textContent = fmtDist(state.stravaStats.distance);
  $('stravaElev').textContent = `↑${Math.round(state.stravaStats.elevation)} m`;
  $('stravaTime').textContent = fmtTime(state.stravaStats.movingTime);
  $('stravaOverlayInfo').classList.remove('hidden');
  if (alts.length) {
    const rawCoords = latlngs.map((ll,i) => ({ lat:ll[0], lon:ll[1], ele:alts[i]||0 }));
    ElevationChart.setProfile(ElevationChart.buildProfileFromCoords(rawCoords));
    $('elevPanel').classList.remove('hidden');
    $('elevStats').textContent = `↑${Math.round(state.stravaStats.elevation)}m · ${fmtDist(state.stravaStats.distance)}`;
    state.map.invalidateSize(); positionFABs();
  }
}

async function loadActivityOnMap(activity, itemEl) {
  document.querySelectorAll('.activity-item').forEach(el => el.classList.remove('active'));
  if (itemEl) itemEl.classList.add('active');
  showToast('Loading GPS stream…');
  try {
    const streams = await StravaAuth.fetchActivityStreams(activity.id);
    if (!streams.latlng?.data?.length) { showToast('No GPS data'); return; }
    loadStreamsOnMap(activity, streams, itemEl);
    showToast(`${activity.name} on map`);
  } catch(e) { showToast(`Error: ${e.message}`); }
}

async function toggleActivityShare(act, itemEl) {
  const id  = String(act.id);
  const btn = itemEl.querySelector('.activity-share-btn');

  if (state.stravaSharedIds.has(id)) {
    // Currently shared → unshare
    btn.textContent = '⏳…'; btn.disabled = true;
    await LiveTrack.unpublishStrava(id);
    state.stravaSharedIds.delete(id);
    btn.textContent  = '📡 Share';
    btn.disabled     = false;
    btn.classList.remove('shared');
    btn.title        = 'Share with observers';
    showToast(`${act.name} un-shared`);
  } else {
    // Not shared → load streams then share
    btn.textContent = '⏳…'; btn.disabled = true;
    try {
      // Load streams if not already the active polyline for this activity
      let latlngs = null;
      if (state.stravaStats && state.stravaStats.stravaId === act.id && state.stravaStats.latlngs) {
        latlngs = state.stravaStats.latlngs;
      } else {
        const streams = await StravaAuth.fetchActivityStreams(act.id);
        if (!streams.latlng?.data?.length) { showToast('No GPS data'); btn.textContent='📡 Share'; btn.disabled=false; return; }
        latlngs = streams.latlng.data;
        // Also draw on map
        loadStreamsOnMap(act, streams, itemEl);
      }
      const stats = { stravaId: act.id, name: act.name, distance: act.distance,
                      elevation: act.total_elevation_gain||0, movingTime: act.moving_time, latlngs };
      const ok = await LiveTrack.publishStrava(latlngs, stats);
      if (ok) {
        state.stravaSharedIds.add(id);
        btn.textContent = '⏹ Unshare';
        btn.disabled    = false;
        btn.classList.add('shared');
        btn.title       = 'Unshare';
        showToast(`📡 ${act.name} shared`);
      } else {
        btn.textContent = '📡 Share'; btn.disabled = false;
        showToast('Share failed — check Firebase rules');
      }
    } catch(e) {
      btn.textContent = '📡 Share'; btn.disabled = false;
      showToast(`Error: ${e.message}`);
    }
  }
}

function clearStravaOverlay(unpublish=true) {
  if(state.stravaPolyline){state.map.removeLayer(state.stravaPolyline);state.stravaPolyline=null;state.stravaStats=null;}
  $('stravaOverlayInfo').classList.add('hidden');
  document.querySelectorAll('.activity-item').forEach(el=>el.classList.remove('active'));
  if(unpublish) LiveTrack.unpublishStrava();
}

// ── Compare ───────────────────────────────────────────────────
function updateCompareTab() {
  const shared = state.sharedActivities || [];
  const hasGPX    = state.loadedRoutes.length > 0;
  const hasShared = shared.length > 0;
  if (!hasGPX || !hasShared) {
    $('compareEmpty').classList.remove('hidden');
    $('comparePanel').classList.add('hidden');
    // Update empty message to reflect why
    const emptyEl = $('compareEmpty');
    if (emptyEl) emptyEl.querySelector('p').innerHTML =
      !hasGPX ? 'Load a <strong>pre-loaded route</strong> to compare.'
              : 'Share at least one <strong>Strava activity</strong> to compare.';
    return;
  }
  $('compareEmpty').classList.add('hidden');
  $('comparePanel').classList.remove('hidden');

  const gpx = state.loadedRoutes[0].stats;

  // Sum ALL shared activities
  const sumDist  = shared.reduce((s,a) => s + (a.distance||0), 0);
  const sumElev  = shared.reduce((s,a) => s + (a.elevation||a.total_elevation_gain||0), 0);
  const sumPts   = shared.reduce((s,a) => s + (a.points||0), 0);

  $('cmpGpxDist').textContent    = fmtDist(gpx.distance);
  $('cmpGpxElev').textContent    = `${Math.round(gpx.elevation)} m`;
  $('cmpGpxPts').textContent     = gpx.points;
  $('cmpStravaDist').textContent = fmtDist(sumDist);
  $('cmpStravaElev').textContent = `${Math.round(sumElev)} m`;
  $('cmpStravaPts').textContent  = `${sumPts} (${shared.length} activit${shared.length===1?'y':'ies'})`;

  const dD = sumDist - gpx.distance;
  const dE = sumElev - gpx.elevation;
  $('diffDist').textContent = `${dD>=0?'+':''}${fmtDist(Math.abs(dD))}`;
  $('diffElev').textContent = `${dE>=0?'+':''}${Math.round(dE)} m`;
}

function fitBothRoutes() {
  if(!state.loadedRoutes.length||!state.stravaPolyline) return;
  state.map.fitBounds(L.featureGroup([state.loadedRoutes[0].polyline,state.stravaPolyline]).getBounds(),{padding:[50,50]});
}


// ── Strava share to Firebase ─────────────────────────────────────
function buildStravaPopup(stats) {
  if (!stats) return '<b style="color:#0437F2">Strava Activity</b>';
  return `
    <div style="font-family:Syne,sans-serif;min-width:190px">
      <b style="font-size:.88rem;color:#0437F2">🏃 ${stats.name || stats.name}</b><br/>
      <div style="font-family:'JetBrains Mono',monospace;font-size:.72rem;color:#aaa;margin-top:5px">
        ${fmtDist(stats.distance || 0)} · ↑${Math.round(stats.elevation||0)}m · ${fmtTime(stats.movingTime || stats.time || 0)}
      </div>
    </div>`;
}

async function toggleStravaShare() {
  // State lives in window._stravaShared — the button is inside a Leaflet
  // popup string, not a real DOM element, so we never use $('btnStravaShare')
  const isShared = !!window._stravaShared;

  if (isShared) {
    await LiveTrack.unpublishStrava();
    showToast('Strava route un-shared');
  } else {
    if (!state.stravaStats || !state.stravaStats.latlngs) {
      showToast('No Strava route loaded'); return;
    }
    // Immediately rebuild popup with loading state
    window._stravaShared = 'pending';
    if (state.stravaPolyline && state.stravaPolyline.isPopupOpen()) {
      state.stravaPolyline.setPopupContent(buildStravaPopup(state.stravaStats, 'pending'));
    }
    const ok = await LiveTrack.publishStrava(state.stravaStats.latlngs, state.stravaStats);
    if (ok) {
      updateStravaShareBtn(true);
      showToast('📡 Strava route shared with observers');
    } else {
        showToast('Share failed — check Firebase rules');
    }
  }
}

// updateStravaShareBtn removed — share state handled by activity card buttons

// ── Observer: receive shared Strava route from Firebase ───────────
const sharedStravaState = { polylines: [] };

function startStravaObserver() {
  LiveTrack.subscribeStrava(activities => {
    // Remove old polylines
    sharedStravaState.polylines = sharedStravaState.polylines || [];
    sharedStravaState.polylines.forEach(p => state.map.removeLayer(p));
    sharedStravaState.polylines = [];

    // Store for Stats + Compare tabs (accessible by all users incl. observers)
    state.sharedActivities = activities || [];

    if (!activities || !activities.length) {
      updateStatsTab();
      updateCompareTab();
      return;
    }

    activities.forEach(data => {
      if (!data.latlngs || !data.latlngs.length) return;
      const pl = L.polyline(data.latlngs, {
        color: '#0437F2', weight: 4, opacity: 0.88, dashArray: '7 4', lineJoin: 'round',
      }).addTo(state.map);
      const name = data.name || 'Strava Activity';
      pl.bindPopup(buildStravaPopup({ name, distance: data.distance, elevation: data.elevation, movingTime: data.time }));
      sharedStravaState.polylines.push(pl);
    });

    // Toast only when list changes
    const newKey = activities.map(a => a.ts).sort().join(',');
    const prev   = localStorage.getItem('tm_strava_obs_key');
    if (prev !== newKey) {
      localStorage.setItem('tm_strava_obs_key', newKey);
      if (activities.length === 1) showToast(`📡 Hiker shared: ${activities[0].name}`);
      else if (activities.length > 1) showToast(`📡 Hiker shared ${activities.length} routes`);
    }

    // Refresh Stats + Compare with new data
    updateStatsTab();
    updateCompareTab();
  });
}

// ── Observer: receive shared photos from Firebase ────────────────
const sharedPhotoState = { markers: [] };

function startPhotoObserver() {
  LiveTrack.subscribePhotos(photos => {
    // Remove old observer markers
    sharedPhotoState.markers.forEach(m => state.map.removeLayer(m));
    sharedPhotoState.markers = [];
    if (!photos || !photos.length) return;
    photos.forEach(p => {
      const icon = L.divIcon({
        className: '',
        html: `<div class="photo-marker">
                 <div class="photo-marker-img" style="background-image:url('${p.thumb || p.shareThumb}')"></div>
                 <div class="photo-marker-tip"></div>
               </div>`,
        iconSize: [48, 56], iconAnchor: [24, 56], popupAnchor: [0, -58],
      });
      const marker = L.marker([p.lat, p.lon], { icon, zIndexOffset: 490 }).addTo(state.map);
      // Use note as title if set, otherwise filename
      const obsTitle = p.note || p.name;
      marker.bindPopup(`
        <div style="font-family:Syne,sans-serif;min-width:180px">
          <img src="${p.thumb}" style="width:100%;border-radius:6px;margin-bottom:6px;display:block"/>
          <b style="font-size:.85rem">${obsTitle}</b>
          <div style="font-family:'JetBrains Mono',monospace;font-size:.65rem;color:#666;margin-top:4px">
            ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}
          </div>
        </div>`);
      sharedPhotoState.markers.push(marker);
    });
  });
}

// ── Photos ────────────────────────────────────────────────────────
function initPhotosUI() {
  const dropZone  = $('photoDropZone');
  const input     = $('photoInput');
  const noteInput = $('photoNoteInput');
  const noGpsMsg  = $('photoNoGps');

  dropZone.addEventListener('click', () => input.click());
  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    handlePhotoFiles([...e.dataTransfer.files]);
  });
  input.addEventListener('change', e => { handlePhotoFiles([...e.target.files]); e.target.value = ''; });

  $('btnExportPhotoGpx').addEventListener('click', () => {
    const gpx = Photos.exportGPX();
    if (!gpx) { showToast('No photos to export'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
    a.download = 'photos.gpx'; a.click();
    showToast('Photos exported ✓');
  });

  Photos.onChange(photos => {
    renderPhotoList(photos);
    // Show/hide the photo FAB depending on whether photos exist
    const fab = $('btnTogglePhotos');
    if (fab) fab.classList.toggle('hidden', photos.length === 0);
    // Push to Firebase so observers see the photos too
    LiveTrack.publishPhotos(photos)
      .catch(e => console.error('[Photos] Firebase publish error:', e.message));
  });

  async function handlePhotoFiles(files) {
    noGpsMsg.style.display = 'none';
    const note = noteInput.value.trim();
    let successCount = 0, failCount = 0;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try { await Photos.processFile(file, note); successCount++; }
      catch (e) { failCount++; console.warn('[Photos]', e.message); }
    }
    if (successCount > 0) { noteInput.value = ''; showToast(`📷 ${successCount} photo${successCount > 1 ? 's' : ''} plotted on map`); }
    if (failCount > 0)    { noGpsMsg.style.display = 'block'; if (successCount === 0) showToast('No GPS data found in photo(s)'); }
  }
}

function renderPhotoList(photos) {
  const list   = $('photoList');
  const header = $('photoListHeader');
  list.innerHTML = '';
  if (!photos.length) { header.style.display = 'none'; return; }
  header.style.display = 'flex';
  photos.slice().reverse().forEach(p => {
    const el = document.createElement('div'); el.className = 'photo-item';
    const dtStr = p.datetime ? (() => {
      try {
        const [date, time] = p.datetime.split(' ');
        const [y, mo, d]   = date.split(':');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${parseInt(d)} ${months[parseInt(mo)-1]} ${y} ${time.slice(0,5)}`;
      } catch(_) { return ''; }
    })() : '';
    const coordStr = `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;
    el.innerHTML = `
      <img class="photo-thumb" src="${p.thumb}" alt="${p.name}" />
      <div class="photo-item-info">
        <div class="photo-item-name">${p.note || p.name}</div>
        <div class="photo-item-meta">${dtStr ? dtStr + ' · ' : ''}${coordStr}</div>
        ${p.note ? `<div class="photo-item-note">${p.note}</div>` : ''}
      </div>
      <div class="photo-item-actions">
        <button title="Jump to on map" onclick="Photos.flyTo(${p.id})">🎯</button>
        <button class="del-btn" title="Remove" onclick="Photos.remove(${p.id})">✕</button>
      </div>`;
    el.addEventListener('click', e => { if (e.target.tagName === 'BUTTON') return; Photos.flyTo(p.id); });
    list.appendChild(el);
  });
}

// ── Stats Tab — Strava averages + route completion estimate ───────
const HIKE_START = new Date(2026, 4, 9, 9, 0, 0); // 9 May 2026 09:00

function updateStatsTab() {
  // Use SHARED activities (visible to all — hiker + observers)
  const acts  = state.sharedActivities || [];
  const route = state.loadedRoutes.length ? state.loadedRoutes[0] : null;

  const statsBlock  = $('stravaStatsBlock');
  const noStravaMsg = $('statsNoStrava');

  if (!acts.length) {
    if (statsBlock)  statsBlock.classList.add('hidden');
    if (noStravaMsg) noStravaMsg.classList.remove('hidden');
    $('completionBlock').classList.add('hidden');
    return;
  }
  if (statsBlock)  statsBlock.classList.remove('hidden');
  if (noStravaMsg) noStravaMsg.classList.add('hidden');

  const n         = acts.length;
  // Shared activities from Firebase have: distance, elevation, time (movingTime)
  const totalDist = acts.reduce((s,a) => s + (a.distance||0), 0);
  const totalElev = acts.reduce((s,a) => s + (a.elevation||a.total_elevation_gain||0), 0);
  const totalTime = acts.reduce((s,a) => s + (a.time||a.moving_time||0), 0);

  const avgDist  = totalDist / n;
  const avgElev  = totalElev / n;
  const avgTime  = totalTime / n;
  const avgSpeed = avgDist > 0 && avgTime > 0 ? (avgDist / avgTime) * 3.6 : 0;
  const avgPace  = avgTime > 0 && avgDist > 0 ? (avgTime / 60) / (avgDist / 1000) : 0;

  $('sAvgDist').textContent       = fmtDist(avgDist);
  $('sAvgElev').textContent       = `↑${Math.round(avgElev)} m`;
  $('sAvgTime').textContent       = fmtTime(Math.round(avgTime));
  $('sAvgSpeed').textContent      = avgSpeed.toFixed(1);
  $('sAvgPace').textContent       = avgPace > 0
    ? `${Math.floor(avgPace)}:${String(Math.round((avgPace%1)*60)).padStart(2,'0')} /km` : '—';
  $('sActivityCount').textContent = `${n} shared activit${n===1?'y':'ies'}`;
  $('sTotalDist').textContent     = fmtDist(totalDist);
  $('sTotalElev').textContent     = `↑${Math.round(totalElev)} m`;
  $('sTotalTime').textContent     = fmtTime(totalTime);

  // ── Completion vs pre-loaded route ───────────────────────────
  const compBlock = $('completionBlock');
  if (!route) { compBlock.classList.add('hidden'); return; }
  compBlock.classList.remove('hidden');

  const routeDist = route.stats.distance;
  const routeElev = route.stats.elevation;
  const pctDist   = Math.min(100, (totalDist / routeDist) * 100);
  const pctElev   = Math.min(100, (totalElev / routeElev) * 100);
  const pctBlend  = pctDist * 0.6 + pctElev * 0.4;

  $('compRouteName').textContent = route.name;
  $('compPctDist').textContent   = pctDist.toFixed(1) + '%';
  $('compPctElev').textContent   = pctElev.toFixed(1) + '%';
  $('compPctBlend').textContent  = pctBlend.toFixed(1) + '%';
  const bar = $('compProgressBar');
  if (bar) bar.style.width = Math.min(100, pctBlend).toFixed(1) + '%';

  // Planned finish from last waypoint date
  const wps = (() => {
    const pr = (typeof PRELOADED_ROUTES !== 'undefined')
      ? PRELOADED_ROUTES.find(r => r.id === route.id) : null;
    return pr ? pr.waypoints : [];
  })();
  const lastWp      = [...wps].reverse().find(w => w.date);
  const planned     = lastWp ? new Date(lastWp.date + 'T12:00:00') : null;
  const remaining   = Math.max(0, routeDist - totalDist);

  if (remaining <= 0) {
    $('compFinishEst').textContent    = '🎉 Route complete!';
    $('compFinishDetail').textContent = '';
  } else if (planned) {
    $('compFinishEst').textContent = planned.toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' });
    const daysLeft = Math.max(0, (planned.getTime() - Date.now()) / 86400000);
    const remKm    = (remaining / 1000).toFixed(0);
    if (daysLeft < 1) {
      $('compFinishDetail').textContent = `${remKm} km remaining · finish day reached`;
    } else {
      $('compFinishDetail').textContent =
        `${remKm} km left · ${Math.ceil(daysLeft)} days · need ${(remaining/1000/daysLeft).toFixed(1)} km/day`;
    }
  } else {
    $('compFinishEst').textContent    = '—';
    $('compFinishDetail').textContent = 'No planned finish date';
  }
}

  const statsBlock  = $('stravaStatsBlock');
  const noStravaMsg = $('statsNoStrava');


// ── Wake Lock — keeps screen on while GPS/sharing is active ──────
// Supported: Chrome Android, Safari iOS 16.4+ PWA
// Falls back silently on unsupported browsers
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return; // not supported
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => {
      // Wake lock was released (e.g. tab hidden, battery saver)
      // Re-acquire when page becomes visible again
      state.wakeLock = null;
    });
    console.log('[WakeLock] Screen lock acquired');
  } catch (e) {
    console.warn('[WakeLock] Could not acquire:', e.message);
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release();
    state.wakeLock = null;
    console.log('[WakeLock] Released');
  }
}

// Re-acquire wake lock when page becomes visible again
// (it's auto-released when screen turns off or tab is hidden)
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    // Re-acquire wake lock if GPS is still active
    if (state.gpsActive && !state.wakeLock) {
      await acquireWakeLock();
    }
    // Force an immediate GPS re-poll after screen-off gap
    // This gets a fresh position as soon as user unlocks phone
    if (state.gpsActive && state.gpsWatchId != null) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          onGPSSuccess(pos);
          // If sharing live, push the fresh position immediately
          if (typeof LiveTrack !== 'undefined') LiveTrack.pushPosition(pos);
        },
        err => console.warn('[GPS resume]', err.message),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    }
  }
});

// ── Service Worker update check on every page load ───────────────
// Tells a waiting SW to activate immediately so new deploys
// take effect without the user needing to clear cache
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // New SW took control — reload to get fresh files
    window.location.reload();
  });
  // Poll for SW updates every 60 seconds while app is open
  setInterval(() => {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg) reg.update();
    });
  }, 60000);
}


// ── Photo visibility toggle ───────────────────────────────────────
let photosVisible = true;
function togglePhotosVisibility() {
  photosVisible = !photosVisible;
  const fab = $('btnTogglePhotos');
  if (fab) {
    fab.style.opacity  = photosVisible ? '1' : '0.45';
    fab.title          = photosVisible ? 'Hide photos on map' : 'Show photos on map';
  }
  // Toggle all local photo markers
  Photos.getAll().forEach(p => {
    const el = p.marker.getElement();
    if (el) el.style.display = photosVisible ? '' : 'none';
  });
  // Toggle observer photo markers
  if (sharedPhotoState && sharedPhotoState.markers) {
    sharedPhotoState.markers.forEach(m => {
      const el = m.getElement();
      if (el) el.style.display = photosVisible ? '' : 'none';
    });
  }
  showToast(photosVisible ? '📷 Photos shown' : '📷 Photos hidden');
}


// ── Observer: receive shared notes from Firebase ─────────────────
const sharedNotesState = { markers: [] };

function startNotesObserver() {
  LiveTrack.subscribeNotes(notes => {
    sharedNotesState.markers.forEach(m => state.map.removeLayer(m));
    sharedNotesState.markers = [];
    if (!notes || !notes.length) return;
    notes.forEach(n => {
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:#0437F2;color:#fff;border-radius:50% 50% 50% 0;
                width:22px;height:22px;transform:rotate(-45deg);border:2px solid #fff;
                box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;
                justify-content:center;font-size:10px">📍</div>`,
        iconSize:[22,22], iconAnchor:[11,22], popupAnchor:[0,-24],
      });
      const title = n.note || n.name;
      const marker = L.marker([n.lat, n.lon], { icon, zIndexOffset: 480 }).addTo(state.map);
      marker.bindPopup(`<div style="font-family:Syne,sans-serif;min-width:160px">
        <b style="color:#0437F2">📍 ${title}</b><br/>
        <div style="font-family:'JetBrains Mono',monospace;font-size:.65rem;color:#666;margin-top:4px">
          ${n.lat.toFixed(5)}, ${n.lon.toFixed(5)}
        </div></div>`);
      sharedNotesState.markers.push(marker);
    });
  });
}

// ── Toast ─────────────────────────────────────────────────────
let toastTimer=null;
function showToast(msg) {
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2800);
}

// Register service worker (update logic handled above)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    // If there's already a waiting worker, activate it now
    if (reg.waiting) reg.waiting.postMessage('skipWaiting');
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version ready — activate immediately
          newWorker.postMessage('skipWaiting');
        }
      });
    });
  }).catch(() => {});
}

// ════════════════════════════════════════════════════════════
// LIVE TRACKING — Firebase Realtime DB (hardcoded config)
// ════════════════════════════════════════════════════════════

const liveState = {
  hikerMarker:  null,
  hikerData:    null,
  seenInterval: null,
  isSharing:    false,
};

function initLiveTrack() {
  // Auto-connect — no config needed
  const ok = LiveTrack.init();
  if (!ok) {
    console.warn('[App] Firebase init failed');
    return;
  }

  // Share / stop sharing button (hiker only)
  $('btnLiveShare').addEventListener('click', async () => {
    if (liveState.isSharing) {
      await LiveTrack.stopSharing();
      liveState.isSharing = false;
      LiveTrack.setIsHiker(false);
      updateHikerControls(false);
      showToast('Location sharing stopped');
    } else {
      if (!state.gpsActive) {
        showToast('Enable GPS tracking first');
        document.querySelector('[data-tab="routes"]').click();
        return;
      }
      const ok = LiveTrack.startSharing();
      if (ok) {
        liveState.isSharing = true;
        LiveTrack.setIsHiker(true);
        updateHikerControls(true);
        showToast('📡 Sharing live location');
      }
    }
  });

  // Jump to hiker buttons
  $('btnJumpToHiker').addEventListener('click', jumpToHiker);
  $('btnJumpHikerFab').addEventListener('click', jumpToHiker);

  // Subscribe — all visitors (hiker + viewers) see the live dot
  startViewerSubscription();
  // Subscribe — all visitors see any shared Strava route
  startStravaObserver();
  // Subscribe — all visitors see shared photos
  startPhotoObserver();
  // Subscribe — all visitors see shared notes
  startNotesObserver();

  // Restore hiker sharing state if page was reloaded mid-share
  if (LiveTrack.getIsHiker()) {
    updateHikerControls(false); // show "ready to share" state, don't auto-resume
  }
}

function jumpToHiker() {
  if (liveState.hikerData) {
    state.map.setView([liveState.hikerData.lat, liveState.hikerData.lon], 15, { animate: true });
  }
}

function updateHikerControls(sharing) {
  const btn     = $('btnLiveShare');
  const dot     = $('liveHikerStatus').querySelector('.live-status-dot');
  const txt     = $('liveHikerStatusText');
  const hint    = $('liveHikerHint');
  const tabDot  = $('tabLiveDot');

  if (sharing) {
    btn.textContent = '⏹ Stop Sharing';
    btn.classList.add('sharing');
    dot.className = 'live-status-dot live-dot-live';
    txt.textContent = 'Sharing live — position updating';
    hint.textContent = 'Your position is visible to everyone watching the app.';
    tabDot.classList.remove('hidden');
  } else {
    btn.textContent = '📡 Start Sharing Location';
    btn.classList.remove('sharing');
    dot.className = 'live-status-dot live-dot-off';
    txt.textContent = 'Not sharing';
    hint.textContent = 'Enable GPS tracking first, then start sharing.';
    tabDot.classList.add('hidden');
  }
}

function startViewerSubscription() {
  LiveTrack.subscribeViewer(data => {
    liveState.hikerData = data;
    updateViewerUI(data);
    if (data && data.lat && data.lon) {
      updateHikerMarker(data);
    }
  });

  // Refresh "X min ago" every 30s
  clearInterval(liveState.seenInterval);
  liveState.seenInterval = setInterval(() => {
    if (liveState.hikerData) updateViewerUI(liveState.hikerData);
  }, 30000);
}

function updateViewerUI(data) {
  const statusEl  = $('liveStatus');
  const updateEl  = $('liveLastUpdate');
  const altEl     = $('liveAlt');
  const speedEl   = $('liveSpeed');
  const accEl     = $('liveAcc');
  const jumpBtn   = $('btnJumpToHiker');

  if (!data || !data.lat) {
    statusEl.textContent  = 'No position yet';
    updateEl.textContent  = '—';
    altEl.textContent     = '—';
    speedEl.textContent   = '—';
    accEl.textContent     = '—';
    jumpBtn.disabled      = true;
    $('btnJumpHikerFab').classList.add('hidden');
    $('liveViewerBadge').classList.add('hidden');
    return;
  }

  jumpBtn.disabled = false;
  $('btnJumpHikerFab').classList.remove('hidden');

  // Show the topbar LIVE badge only when actively sharing
  if (data.sharing) {
    $('liveViewerBadge').classList.remove('hidden');
  } else {
    $('liveViewerBadge').classList.add('hidden');
  }

  // Status
  if (data.sharing) {
    statusEl.innerHTML = '<span style="color:var(--green)">● Live</span>';
  } else {
    statusEl.innerHTML = '<span style="color:var(--yellow)">◎ Last known</span>';
  }

  // Age of last update
  if (data.ts) {
    const ageMs  = Date.now() - data.ts;
    const ageSec = Math.floor(ageMs / 1000);
    let ageStr;
    if (ageSec < 60)         ageStr = `${ageSec}s ago`;
    else if (ageSec < 3600)  ageStr = `${Math.floor(ageSec/60)}m ago`;
    else                     ageStr = `${Math.floor(ageSec/3600)}h ago`;
    updateEl.textContent = ageStr;
  }

  altEl.textContent   = data.alt    != null ? `${data.alt} m`           : '—';
  speedEl.textContent = data.speed  != null ? `${data.speed} km/h`      : '—';
  accEl.textContent   = data.accuracy != null ? `±${data.accuracy} m`   : '—';
}

function updateHikerMarker(data) {
  const latlng = [data.lat, data.lon];
  const isLive = !!data.sharing;

  if (!liveState.hikerMarker) {
    // Create marker
    const icon = L.divIcon({
      className: '',
      html: `<div class="hiker-dot"><div class="hiker-dot-pulse"></div><div class="hiker-dot-inner"></div></div>`,
      iconSize:   [30, 30],
      iconAnchor: [15, 15],
      popupAnchor:[0, -15],
    });
    liveState.hikerMarker = L.marker(latlng, { icon, zIndexOffset: 2000 })
      .addTo(state.map)
      .bindPopup(() => buildHikerPopup(liveState.hikerData));
  } else {
    liveState.hikerMarker.setLatLng(latlng);
  }

  // Update popup if open
  if (liveState.hikerMarker.isPopupOpen()) {
    liveState.hikerMarker.setPopupContent(buildHikerPopup(data));
  }

  // Dim dot if last-known (not live)
  const inner = liveState.hikerMarker.getElement()?.querySelector('.hiker-dot-inner');
  const pulse = liveState.hikerMarker.getElement()?.querySelector('.hiker-dot-pulse');
  if (inner) inner.style.background = isLive ? 'var(--green)' : 'var(--yellow)';
  if (pulse) pulse.style.display    = isLive ? '' : 'none';
}

function buildHikerPopup(data) {
  if (!data) return 'No data';
  const ageMs  = data.ts ? Date.now() - data.ts : null;
  const ageSec = ageMs != null ? Math.floor(ageMs / 1000) : null;
  const ageStr = ageSec == null ? '' :
    ageSec < 60 ? `${ageSec}s ago` :
    ageSec < 3600 ? `${Math.floor(ageSec/60)}m ago` :
    `${Math.floor(ageSec/3600)}h ago`;

  const statusColor = data.sharing ? 'var(--green)' : 'var(--yellow)';
  const statusText  = data.sharing ? '● Live'        : '◎ Last known';

  return `
    <div style="font-family:Syne,sans-serif;min-width:160px">
      <b style="font-size:.9rem">Hiker Position</b><br/>
      <span style="color:${statusColor};font-size:.75rem">${statusText}</span>
      ${ageStr ? `<span style="color:#888;font-size:.72rem"> · ${ageStr}</span>` : ''}
      <div style="margin-top:6px;font-family:'JetBrains Mono',monospace;font-size:.72rem;color:#aaa">
        ${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}<br/>
        ${data.alt != null ? `Alt: ${data.alt}m` : ''}
        ${data.speed != null ? ` · ${data.speed} km/h` : ''}
      </div>
    </div>`;
}

