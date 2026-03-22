/* ============================================================
   livetrack.js — Live position sharing via Firebase Realtime DB
   Config is hardcoded — auto-connects for all users on load.
   ============================================================ */

'use strict';

const LiveTrack = (() => {

  // ── Hardcoded Firebase config ─────────────────────────────
  const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyDFvgSXtvHheMgyTjNR34HGqRJYIGt7Lhw',
    authDomain:        'twatrails.firebaseapp.com',
    projectId:         'twatrails',
    storageBucket:     'twatrails.firebasestorage.app',
    messagingSenderId: '132893790640',
    appId:             '1:132893790640:web:f11a84c750a270fa87c675',
    databaseURL:       'https://twatrails-default-rtdb.europe-west1.firebasedatabase.app/',
  };

  const SK_HIKER = 'tm_fb_is_hiker';

  let db           = null;
  let posRef       = null;
  let isSharing    = false;
  let viewerListener = null;
  let statusCb     = null;

  // ── Auto-init on load ─────────────────────────────────────
  // Called once the Firebase SDK script tags have loaded
  function init() {
    if (typeof firebase === 'undefined') {
      console.error('[LiveTrack] Firebase SDK not available');
      return false;
    }
    try {
      // Avoid duplicate app initialisation on hot reload
      if (firebase.apps && firebase.apps.length > 0) {
        firebase.app(); // use existing app
      } else {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      db     = firebase.database();
      posRef = db.ref('/hiker/position');
      return true;
    } catch (e) {
      console.error('[LiveTrack] Init failed:', e.message);
      return false;
    }
  }

  // ── Hiker flag (persisted so share button state survives reload) ──
  function setIsHiker(v) { localStorage.setItem(SK_HIKER, v ? '1' : '0'); }
  function getIsHiker()  { return localStorage.getItem(SK_HIKER) === '1'; }

  // ── Hiker: start / stop sharing ───────────────────────────
  function startSharing() {
    if (!posRef) return false;
    isSharing = true;
    if (statusCb) statusCb('sharing');
    return true;
  }

  async function stopSharing() {
    isSharing = false;
    if (posRef) {
      try { await posRef.update({ sharing: false }); } catch (_) {}
    }
    if (statusCb) statusCb('stopped');
  }

  // Called on every GPS fix — writes to Firebase only if sharing
  async function pushPosition(pos) {
    if (!posRef || !isSharing) return;
    const { latitude: lat, longitude: lon, altitude, accuracy, speed, heading } = pos.coords;
    try {
      await posRef.set({
        lat:      parseFloat(lat.toFixed(6)),
        lon:      parseFloat(lon.toFixed(6)),
        alt:      altitude  != null ? Math.round(altitude)               : null,
        accuracy: Math.round(accuracy),
        speed:    speed     != null ? parseFloat((speed * 3.6).toFixed(1)) : null,
        heading:  heading   != null ? Math.round(heading)                : null,
        ts:       Date.now(),
        sharing:  true,
      });
    } catch (e) {
      console.warn('[LiveTrack] Push failed:', e.message);
    }
  }

  // ── Viewer: real-time subscription ────────────────────────
  // Fires immediately with current value, then on every change (~500ms)
  function subscribeViewer(cb) {
    if (!posRef) return;
    viewerListener = posRef.on('value', snap => cb(snap.val()), err => {
      console.warn('[LiveTrack] Listener error:', err.message);
    });
  }

  function unsubscribeViewer() {
    if (posRef && viewerListener !== null) {
      posRef.off('value', viewerListener);
      viewerListener = null;
    }
  }

  // ── Callbacks / state ─────────────────────────────────────
  function onStatus(cb)   { statusCb = cb; }
  function isReady()      { return !!db; }
  function isSharingNow() { return isSharing; }

  return {
    init,
    setIsHiker, getIsHiker,
    startSharing, stopSharing, pushPosition,
    subscribeViewer, unsubscribeViewer,
    onStatus, isReady, isSharingNow,
  };

})();
