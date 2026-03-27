/* ============================================================
   recorder.js — GPS track recording with background support

   BACKGROUND GPS STRATEGY (screen off):

   Android Chrome: watchPosition continues in the background
   as long as GPS permission was granted. Key settings:
     - maximumAge: 0  → always get fresh GPS, never cached
     - timeout: 30000 → give GPS hardware 30s to respond
     - enableHighAccuracy: true → use GPS chip, not network

   iOS Safari PWA: Background geolocation is NOT supported.
   The watch pauses when the screen turns off. When the user
   returns, GPS resumes but there's a gap in the track.

   GAP HEALING: When the app becomes visible again after a
   gap (screen-off period), we detect how long the screen
   was off. If < 5 minutes, we mark the gap in the GPX with
   a track segment break (</trkseg><trkseg>) rather than
   drawing a straight line across the map.

   TELEPORT GUARD: Points implying speed > 50 m/s (180 km/h)
   are dropped. This catches both GPS drift and iOS resume jumps.

   ACCURACY FILTER: Points worse than 200m accuracy dropped.
   ============================================================ */

'use strict';

const Recorder = (() => {
  let segments    = [[]];   // array of point arrays — new segment on gap
  let polylines   = [];     // one Leaflet polyline per segment
  let map         = null;
  let startTime   = null;
  let intervalId  = null;
  let isRecording = false;
  let onUpdateCb  = null;
  let hiddenAt    = null;   // timestamp when page was hidden

  // ── Haversine ─────────────────────────────────────────────
  function hdist(a, b) {
    const R = 6371000;
    const f1 = a[0]*Math.PI/180, f2 = b[0]*Math.PI/180;
    const df = (b[0]-a[0])*Math.PI/180, dl = (b[1]-a[1])*Math.PI/180;
    const x = Math.sin(df/2)**2 + Math.cos(f1)*Math.cos(f2)*Math.sin(dl/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }

  // ── Visibility change: detect screen-off gaps ─────────────
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (document.visibilityState === 'visible' && isRecording && hiddenAt) {
      const gapMs = Date.now() - hiddenAt;
      hiddenAt = null;
      if (gapMs > 8000) {
        // Screen was off for >8 seconds — start a new track segment
        // This prevents a straight line being drawn across the gap
        startNewSegment();
        console.log(`[Recorder] Gap of ${(gapMs/1000).toFixed(0)}s — new track segment started`);
      }
    }
  });

  function startNewSegment() {
    segments.push([]);
    const pl = L.polyline([], {
      color: '#f87171', weight: 4, opacity: 0.9, lineJoin: 'round',
    }).addTo(map);
    polylines.push(pl);
  }

  function currentSegment() { return segments[segments.length - 1]; }
  function currentPolyline() { return polylines[polylines.length - 1]; }

  // ── Init ──────────────────────────────────────────────────
  function init(leafletMap) { map = leafletMap; }
  function onUpdate(cb)     { onUpdateCb = cb; }

  // ── Start ─────────────────────────────────────────────────
  function start() {
    if (isRecording) return;
    segments   = [[]];
    polylines  = [];
    startTime  = Date.now();
    isRecording = true;

    // First polyline for first segment
    const pl = L.polyline([], {
      color: '#f87171', weight: 4, opacity: 0.9, lineJoin: 'round',
    }).addTo(map);
    polylines.push(pl);

    intervalId = setInterval(() => {
      if (onUpdateCb) onUpdateCb(getStats());
    }, 1000);
  }

  // ── Add GPS point ─────────────────────────────────────────
  function addPoint(pos) {
    if (!isRecording) return;

    const { latitude: lat, longitude: lon, altitude, accuracy } = pos.coords;

    // 1. Accuracy filter — drop very noisy fixes
    if (accuracy > 200) return;

    // 2. Teleport guard — drop physics-impossible jumps
    const seg = currentSegment();
    if (seg.length > 0) {
      const prev     = seg[seg.length - 1];
      const dist     = hdist([prev.lat, prev.lon], [lat, lon]);
      const timeDiff = (Date.now() - prev.timestamp) / 1000;
      if (timeDiff > 0 && dist / timeDiff > 50) {
        // >50 m/s = >180 km/h — impossible while hiking
        console.warn(`[Recorder] Teleport dropped: ${dist.toFixed(0)}m in ${timeDiff.toFixed(0)}s`);
        return;
      }
    }

    const pt = {
      lat, lon,
      ele:       altitude  != null ? altitude  : 0,
      accuracy,
      time:      new Date().toISOString(),
      timestamp: Date.now(),
    };

    currentSegment().push(pt);
    currentPolyline().addLatLng([lat, lon]);

    if (onUpdateCb) onUpdateCb(getStats());
  }

  // ── Stop ──────────────────────────────────────────────────
  function stop() {
    if (!isRecording) return;
    isRecording = false;
    clearInterval(intervalId);
    intervalId  = null;
  }

  // ── Discard ───────────────────────────────────────────────
  function clear() {
    stop();
    segments  = [[]];
    polylines.forEach(pl => map.removeLayer(pl));
    polylines = [];
    startTime = null;
    if (onUpdateCb) onUpdateCb(null);
  }

  // ── Stats (across all segments) ───────────────────────────
  function getStats() {
    const allPts = segments.flat();
    if (!allPts.length) return { distance:0, elapsed:0, points:0, avgSpeed:0, elevGain:0, segments: 0 };

    let dist = 0;
    for (const seg of segments) {
      for (let i = 1; i < seg.length; i++) {
        dist += hdist([seg[i-1].lat, seg[i-1].lon], [seg[i].lat, seg[i].lon]);
      }
    }

    const elapsed  = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    const avgSpeed = elapsed > 0 ? (dist / elapsed) * 3.6 : 0;

    let elevGain = 0;
    for (const seg of segments) {
      for (let i = 1; i < seg.length; i++) {
        const diff = (seg[i].ele || 0) - (seg[i-1].ele || 0);
        if (diff > 0) elevGain += diff;
      }
    }

    return { distance: dist, elapsed, points: allPts.length, avgSpeed, elevGain, segments: segments.length };
  }

  // ── GPX export — multi-segment ────────────────────────────
  function exportGPX(name = 'TrailMate Recording') {
    const allPts = segments.flat();
    if (!allPts.length) return null;

    // Each segment becomes a <trkseg> — gaps appear as breaks in the track
    const segXml = segments
      .filter(seg => seg.length > 0)
      .map(seg => {
        const trkpts = seg.map(p =>
          `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">` +
          (p.ele ? `\n      <ele>${p.ele.toFixed(1)}</ele>` : '') +
          `\n      <time>${p.time}</time>\n    </trkpt>`
        ).join('\n');
        return `  <trkseg>\n${trkpts}\n  </trkseg>`;
      }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TrailMate" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${name}</name>
${segXml}
  </trk>
</gpx>`;
  }

  function downloadGPX() {
    const gpx = exportGPX(`TrailMate ${new Date().toLocaleDateString()}`);
    if (!gpx) return false;
    const a = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' })),
      download: `trailmate-${Date.now()}.gpx`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  }

  function getIsRecording() { return isRecording; }
  function getSegmentCount() { return segments.filter(s => s.length > 0).length; }

  function fitBounds() {
    if (!polylines.length) return;
    const group = L.featureGroup(polylines);
    if (group.getBounds().isValid()) map.fitBounds(group.getBounds(), { padding: [40, 40] });
  }

  return {
    init, start, addPoint, stop, clear,
    getStats, downloadGPX, getIsRecording, getSegmentCount,
    fitBounds, onUpdate,
  };
})();
