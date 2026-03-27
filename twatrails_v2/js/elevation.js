/* ============================================================
   elevation.js — Elevation profile chart
   Draws a canvas chart for any route. Shows position
   marker as you track live GPS.
   ============================================================ */

'use strict';

const ElevationChart = (() => {
  let canvas, ctx, currentProfile = null, markerPct = null;

  // CSS var helper
  const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resizeObserver();
    window.addEventListener('resize', () => draw());
  }

  function resizeObserver() {
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas.parentElement);
  }

  function setProfile(coords) {
    // coords: [{ele, dist}] where dist is cumulative metres
    if (!coords || coords.length < 2) { currentProfile = null; draw(); return; }
    currentProfile = coords;
    markerPct = null;
    draw();
  }

  // Build profile from an array of {lat, lon, ele}
  function buildProfileFromCoords(rawCoords) {
    if (!rawCoords || rawCoords.length < 2) return null;
    let cumDist = 0;
    const profile = rawCoords.map((c, i) => {
      if (i > 0) {
        const prev = rawCoords[i - 1];
        const dLat = (c.lat - prev.lat) * 111320;
        const dLon = (c.lon - prev.lon) * 111320 * Math.cos(prev.lat * Math.PI / 180);
        cumDist += Math.sqrt(dLat * dLat + dLon * dLon);
      }
      return { ele: c.ele || 0, dist: cumDist };
    });
    return profile;
  }

  // Build profile from a Leaflet polyline + elevation array
  function buildProfileFromPolylineAndElevations(latlngs, elevations) {
    if (!latlngs || latlngs.length < 2) return null;
    let cumDist = 0;
    return latlngs.map((ll, i) => {
      if (i > 0) {
        const prev = latlngs[i - 1];
        cumDist += L.latLng(prev).distanceTo(L.latLng(ll));
      }
      return { ele: elevations ? (elevations[i] || 0) : 0, dist: cumDist };
    });
  }

  function setPositionPct(pct) {
    markerPct = pct; // 0–1 along the route
    draw();
  }

  function clear() {
    currentProfile = null;
    markerPct = null;
    draw();
  }

  function draw() {
    if (!canvas || !ctx) return;

    // Match canvas to display size
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = rect.width  * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    canvas.style.width  = rect.width  + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    if (!currentProfile || currentProfile.length < 2) {
      ctx.fillStyle = cssVar('--text3') || '#4a6070';
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Load a route to see elevation profile', W / 2, H / 2);
      return;
    }

    const PAD = { top: 14, right: 12, bottom: 22, left: 36 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;

    const eles  = currentProfile.map(p => p.ele);
    const dists = currentProfile.map(p => p.dist);
    const minE = Math.min(...eles);
    const maxE = Math.max(...eles);
    const maxD = Math.max(...dists);
    const eRange = maxE - minE || 1;

    const xOf = d => PAD.left + (d / maxD) * chartW;
    const yOf = e => PAD.top  + chartH - ((e - minE) / eRange) * chartH;

    // Gradient fill
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
    grad.addColorStop(0,   'rgba(74,222,128,0.35)');
    grad.addColorStop(1,   'rgba(74,222,128,0.02)');

    ctx.beginPath();
    ctx.moveTo(xOf(dists[0]), yOf(eles[0]));
    for (let i = 1; i < currentProfile.length; i++) {
      ctx.lineTo(xOf(dists[i]), yOf(eles[i]));
    }
    ctx.lineTo(xOf(maxD), PAD.top + chartH);
    ctx.lineTo(PAD.left,  PAD.top + chartH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Profile line
    ctx.beginPath();
    ctx.moveTo(xOf(dists[0]), yOf(eles[0]));
    for (let i = 1; i < currentProfile.length; i++) {
      ctx.lineTo(xOf(dists[i]), yOf(eles[i]));
    }
    ctx.strokeStyle = cssVar('--green') || '#4ade80';
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Y-axis labels
    ctx.fillStyle  = cssVar('--text3') || '#4a6070';
    ctx.font       = `${9 * Math.min(1, W / 200)}px JetBrains Mono, monospace`;
    ctx.textAlign  = 'right';
    const ySteps   = 3;
    for (let i = 0; i <= ySteps; i++) {
      const e = minE + (eRange * i / ySteps);
      const y = yOf(e);
      ctx.fillText(`${Math.round(e)}m`, PAD.left - 4, y + 3);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    }

    // X-axis label (total distance)
    ctx.textAlign = 'center';
    ctx.fillText(fmtDist(maxD), W / 2, H - 4);

    // Position marker
    if (markerPct !== null) {
      const idx = Math.min(
        currentProfile.length - 1,
        Math.round(markerPct * (currentProfile.length - 1))
      );
      const px = xOf(currentProfile[idx].dist);
      const py = yOf(currentProfile[idx].ele);

      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = cssVar('--orange') || '#f97316';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  return { init, setProfile, buildProfileFromCoords, buildProfileFromPolylineAndElevations, setPositionPct, clear, draw };
})();
