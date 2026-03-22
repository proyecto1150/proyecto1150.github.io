/* ============================================================
   waypoints.js — Map waypoint / POI system
   - Tap map to drop a custom pin
   - Show route waypoints from pre-loaded trails
   - Each pin has a name, note, icon
   ============================================================ */

'use strict';

const Waypoints = (() => {
  let map = null;
  const markers = [];     // { id, marker, type:'custom'|'route', name, note }
  let addMode   = false;
  let onChangeCb = null;

  const ROUTE_ICON_HTML = (color) => `
    <div style="
      width:22px;height:22px;border-radius:50% 50% 50% 0;
      background:${color};border:2px solid #fff;
      transform:rotate(-45deg);
      box-shadow:0 2px 6px rgba(0,0,0,.5);
    "></div>`;

  const CUSTOM_ICON_HTML = `
    <div style="
      width:22px;height:22px;border-radius:50% 50% 50% 0;
      background:#38bdf8;border:2px solid #fff;
      transform:rotate(-45deg);
      box-shadow:0 2px 6px rgba(0,0,0,.5);
    "></div>`;

  function makeIcon(html) {
    return L.divIcon({ className:'', html, iconSize:[22,22], iconAnchor:[11,22], popupAnchor:[0,-22] });
  }

  function init(leafletMap) {
    map = leafletMap;

    map.on('click', e => {
      if (!addMode) return;
      const name = prompt('Pin name:', 'My waypoint');
      if (name === null) return; // cancelled
      const note = prompt('Note (optional):', '') || '';
      addCustomPin(e.latlng.lat, e.latlng.lng, name || 'Pin', note);
      setAddMode(false);
    });
  }

  function setAddMode(active) {
    addMode = active;
    map.getContainer().style.cursor = active ? 'crosshair' : '';
  }

  function getAddMode() { return addMode; }

  function addCustomPin(lat, lon, name, note) {
    const id     = Date.now();
    const marker = L.marker([lat, lon], { icon: makeIcon(CUSTOM_ICON_HTML) }).addTo(map);
    marker.bindPopup(`
      <div style="font-family:Syne,sans-serif;min-width:140px">
        <b style="font-size:.88rem">${name}</b><br/>
        ${note ? `<span style="font-size:.75rem;color:#888">${note}</span><br/>` : ''}
        <small style="color:#aaa">${lat.toFixed(5)}, ${lon.toFixed(5)}</small><br/>
        <button onclick="Waypoints.remove(${id})" style="margin-top:6px;font-size:.72rem;background:#f87171;color:#fff;border:none;border-radius:4px;padding:3px 8px;cursor:pointer">Remove</button>
      </div>
    `).openPopup();

    markers.push({ id, marker, type:'custom', name, note, lat, lon });
    if (onChangeCb) onChangeCb(markers.filter(m => m.type==='custom'));
    return id;
  }

  function addRouteWaypoints(waypoints, color) {
    // Remove old route waypoints
    markers.filter(m => m.type==='route').forEach(m => { map.removeLayer(m.marker); });
    markers.splice(0, markers.length, ...markers.filter(m => m.type==='custom'));

    waypoints.forEach((wp, i) => {
      const marker = L.marker([wp.lat, wp.lon], { icon: makeIcon(ROUTE_ICON_HTML(color)) }).addTo(map);
      marker.bindPopup(`
        <div style="font-family:Syne,sans-serif;min-width:140px">
          <b style="font-size:.88rem">${wp.name}</b><br/>
          ${wp.note ? `<span style="font-size:.75rem;color:#aaa">${wp.note}</span>` : ''}
        </div>
      `);
      markers.push({ id:`route-${i}`, marker, type:'route', name:wp.name, note:wp.note, lat:wp.lat, lon:wp.lon });
    });
  }

  function clearRouteWaypoints() {
    markers.filter(m => m.type==='route').forEach(m => map.removeLayer(m.marker));
    markers.splice(0, markers.length, ...markers.filter(m => m.type==='custom'));
  }

  function remove(id) {
    const idx = markers.findIndex(m => m.id === id);
    if (idx === -1) return;
    map.removeLayer(markers[idx].marker);
    markers.splice(idx, 1);
    if (onChangeCb) onChangeCb(markers.filter(m => m.type==='custom'));
  }

  function clearAll() {
    markers.forEach(m => map.removeLayer(m.marker));
    markers.length = 0;
    if (onChangeCb) onChangeCb([]);
  }

  function getCustom() { return markers.filter(m => m.type==='custom'); }

  function exportGPX() {
    const custom = getCustom();
    if (!custom.length) return null;
    const wpts = custom.map(m =>
      `  <wpt lat="${m.lat.toFixed(7)}" lon="${m.lon.toFixed(7)}">\n    <name>${m.name}</name>${m.note ? `\n    <desc>${m.note}</desc>` : ''}\n  </wpt>`
    ).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="TrailMate">\n${wpts}\n</gpx>`;
  }

  function onChange(cb) { onChangeCb = cb; }

  return { init, setAddMode, getAddMode, addCustomPin, addRouteWaypoints, clearRouteWaypoints, remove, clearAll, getCustom, exportGPX, onChange };
})();
