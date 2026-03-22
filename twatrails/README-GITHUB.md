# TrailMate — GitHub Pages Deployment Guide

## 1. Publish to GitHub Pages

```bash
# Create a new repo (or push to existing)
git init
git add .
git commit -m "TrailMate PWA"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main

# Enable GitHub Pages:
# Repo → Settings → Pages → Source: Deploy from branch → Branch: main / root
```

Your app will be live at:
```
https://YOUR_USERNAME.github.io/YOUR_REPO/
```

> **GPS and PWA install require HTTPS** — GitHub Pages provides this automatically. ✓

---

## 2. Set up Strava OAuth

### Step 2a — Create a Strava API Application

1. Go to **[strava.com/settings/api](https://www.strava.com/settings/api)**
2. Fill in:
   - **Application Name**: TrailMate
   - **Category**: Navigation
   - **Website**: `https://YOUR_USERNAME.github.io/YOUR_REPO/`
   - **Authorization Callback Domain**: `YOUR_USERNAME.github.io`
3. Click **Create** → note your **Client ID** and **Client Secret**

---

### Step 2b — Deploy the Cloudflare Worker proxy

GitHub Pages is static-only, so Strava's token exchange (which requires `client_secret`) must go through a server-side proxy. Cloudflare Workers provides this for free.

**Why a proxy?** Strava's `/oauth/token` endpoint blocks direct browser requests (CORS). The worker runs server-side and forwards the request.

#### Deploy in ~2 minutes:

1. Sign up free at **[workers.cloudflare.com](https://workers.cloudflare.com)**
2. Click **Create Worker**
3. Delete all default code in the editor
4. Open `cloudflare-worker.js` from this project and paste the entire contents
5. **Optional but recommended**: change line 1 from:
   ```js
   const ALLOWED_ORIGIN = '*';
   ```
   to:
   ```js
   const ALLOWED_ORIGIN = 'https://YOUR_USERNAME.github.io';
   ```
   This restricts the proxy to only accept requests from your site.
6. Click **Save and Deploy**
7. Copy the worker URL — it looks like:
   ```
   https://strava-proxy.YOUR_NAME.workers.dev
   ```

---

### Step 2c — Configure TrailMate

1. Open your app at `https://YOUR_USERNAME.github.io/YOUR_REPO/`
2. Go to the **Strava tab** → **⚙️ API Configuration**
3. Fill in all four fields:

| Field | Value |
|---|---|
| **Client ID** | From Strava API settings |
| **Client Secret** | From Strava API settings |
| **Redirect URI** | `https://YOUR_USERNAME.github.io/YOUR_REPO/index.html` |
| **Proxy URL** | Your Cloudflare Worker URL |

4. Click **Save & Connect →**
5. You'll be redirected to Strava to approve access
6. After approving, you're redirected back — activities load automatically

Credentials are stored in your browser's `localStorage` and never sent anywhere except to Strava via the proxy.

---

## 3. Install as PWA on your phone

### Android (Chrome)
1. Open your GitHub Pages URL in Chrome
2. Tap the three-dot menu → **"Add to Home screen"**
3. Tap **Install**

### iOS (Safari)
1. Open your GitHub Pages URL in Safari
2. Tap the **Share** button (box with arrow)
3. Scroll down → **"Add to Home Screen"**
4. Tap **Add**

The app icon will appear on your home screen. It opens full-screen without the browser UI.

---

## 4. Offline map tiles

The service worker automatically caches map tiles as you browse them. To pre-cache an area:
1. Open the app and navigate the map to your planned trail area
2. Zoom in to levels 12–15 to cache detailed tiles
3. The next time you open the app without internet, those tiles will still show

---

## File reference

```
trailpwa-gh/
├── index.html              Main app
├── manifest.json           PWA install manifest
├── sw.js                   Service worker (offline caching)
├── cloudflare-worker.js    ← Deploy this to Cloudflare Workers
├── css/
│   └── style.css
├── js/
│   ├── routes.js           Pre-loaded Norwegian trails
│   ├── strava.js           Strava OAuth2 (GitHub Pages edition)
│   ├── elevation.js        Elevation profile chart
│   ├── recorder.js         Live track recording → GPX export
│   ├── waypoints.js        Map pins + route waypoints
│   ├── geocoder.js         Place search (Nominatim)
│   └── app.js              Main app logic
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## Troubleshooting

**"Proxy URL not set" error**
→ Open ⚙️ API Configuration and fill in the Cloudflare Worker URL.

**Strava shows "redirect_uri_mismatch"**
→ The Redirect URI in the app must exactly match what's registered in Strava's API settings. Copy-paste it — don't type manually.

**GPS not working**
→ GPS requires HTTPS, which GitHub Pages provides. Make sure you're using the `github.io` URL, not a local file.

**Map tiles missing offline**
→ Browse the map area while online first. The service worker caches tiles as you view them.

**"Strava session expired"**
→ Tokens last 6 hours. The app auto-refreshes them as long as the Cloudflare Worker proxy is running. If refresh fails, tap Disconnect and reconnect.
