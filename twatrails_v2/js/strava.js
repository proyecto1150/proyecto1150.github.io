/* ============================================================
   strava.js — Strava OAuth2 for GitHub Pages

   GitHub Pages is static-only, so the token exchange
   (which needs client_secret) must go through an external proxy.

   Supported proxy options:
     1. Cloudflare Worker  (recommended — free, 2-min setup)
     2. Any other CORS-enabled proxy URL

   The proxy URL is saved in localStorage so users only
   configure it once. See README-GITHUB.md for setup steps.
   ============================================================ */

'use strict';

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

const SK = {
  clientId:    'tm_strava_client_id',
  clientSecret:'tm_strava_client_secret',
  redirectUri: 'tm_strava_redirect_uri',
  proxyUrl:    'tm_strava_proxy_url',
  accessToken: 'tm_strava_access_token',
  refreshToken:'tm_strava_refresh_token',
  expiresAt:   'tm_strava_expires_at',
  athlete:     'tm_strava_athlete',
};

const StravaAuth = {

  getConfig() {
    return {
      clientId:    localStorage.getItem(SK.clientId)    || '',
      clientSecret:localStorage.getItem(SK.clientSecret)|| '',
      redirectUri: localStorage.getItem(SK.redirectUri) || (window.location.origin + window.location.pathname),
      proxyUrl:    localStorage.getItem(SK.proxyUrl)    || '',
    };
  },

  saveConfig({ clientId, clientSecret, redirectUri, proxyUrl }) {
    if (clientId     !== undefined) localStorage.setItem(SK.clientId,     clientId);
    if (clientSecret !== undefined) localStorage.setItem(SK.clientSecret, clientSecret);
    if (redirectUri  !== undefined) localStorage.setItem(SK.redirectUri,  redirectUri);
    if (proxyUrl     !== undefined) localStorage.setItem(SK.proxyUrl,     proxyUrl);
  },

  getToken()     { return localStorage.getItem(SK.accessToken); },
  getRefresh()   { return localStorage.getItem(SK.refreshToken); },
  getExpiresAt() { return parseInt(localStorage.getItem(SK.expiresAt) || '0', 10); },
  isTokenValid() { return !!this.getToken() && Date.now()/1000 < this.getExpiresAt() - 60; },
  isConnected()  { return !!this.getToken(); },

  saveTokens(data) {
    if (!data.access_token) throw new Error('No access_token in response — check proxy logs.');
    localStorage.setItem(SK.accessToken,  data.access_token);
    localStorage.setItem(SK.refreshToken, data.refresh_token || '');
    localStorage.setItem(SK.expiresAt,    String(data.expires_at || 0));
    if (data.athlete) localStorage.setItem(SK.athlete, JSON.stringify(data.athlete));
  },

  getAthlete() {
    const raw = localStorage.getItem(SK.athlete);
    return raw ? JSON.parse(raw) : null;
  },

  logout() {
    [SK.accessToken, SK.refreshToken, SK.expiresAt, SK.athlete]
      .forEach(k => localStorage.removeItem(k));
  },

  startOAuth() {
    const { clientId, redirectUri } = this.getConfig();
    if (!clientId) throw new Error('Enter your Strava Client ID first.');
    const params = new URLSearchParams({
      client_id:       clientId,
      redirect_uri:    redirectUri,
      response_type:   'code',
      approval_prompt: 'auto',
      scope:           'read,activity:read_all',
    });
    window.location.href = `${STRAVA_AUTH_URL}?${params}`;
  },

  async _tokenPost(payload) {
    const { proxyUrl, clientId, clientSecret } = this.getConfig();

    if (!proxyUrl) {
      throw new Error(
        'Proxy URL not set. Open ⚙️ API Configuration, deploy a free Cloudflare Worker, and paste its URL.'
      );
    }

    const body = { ...payload, client_id: clientId, client_secret: clientSecret };
    const r = await fetch(proxyUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    let json;
    try { json = await r.json(); } catch { throw new Error(`Proxy returned non-JSON (status ${r.status})`); }
    if (!r.ok) throw new Error(json.error || json.message || `Proxy error ${r.status}`);
    return json;
  },

  async exchangeCode(code) {
    const data = await this._tokenPost({ code, grant_type: 'authorization_code' });
    this.saveTokens(data);
    return data;
  },

  async refreshAccessToken() {
    const refreshToken = this.getRefresh();
    if (!refreshToken) throw new Error('No refresh token — please reconnect.');
    const data = await this._tokenPost({ refresh_token: refreshToken, grant_type: 'refresh_token' });
    this.saveTokens(data);
    return data.access_token;
  },

  async apiFetch(path) {
    let token = this.getToken();
    if (!token) throw new Error('Not connected to Strava.');
    if (!this.isTokenValid()) token = await this.refreshAccessToken();
    const resp = await fetch(`${STRAVA_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401) { this.logout(); throw new Error('Strava session expired. Please reconnect.'); }
    if (!resp.ok) throw new Error(`Strava API error: ${resp.status}`);
    return resp.json();
  },

  fetchActivities(page=1, perPage=30) {
    return this.apiFetch(`/athlete/activities?page=${page}&per_page=${perPage}`);
  },
  fetchActivityStreams(id) {
    return this.apiFetch(`/activities/${id}/streams?keys=latlng,altitude,time&key_by_type=true`);
  },
  fetchAthlete() { return this.apiFetch('/athlete'); },
};

async function handleStravaCallback() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  const error  = params.get('error');

  if (error) {
    window.history.replaceState({}, '', window.location.pathname);
    return { denied: true };
  }
  if (!code) return null;
  window.history.replaceState({}, '', window.location.pathname);

  try {
    const data = await StravaAuth.exchangeCode(code);
    return { success: true, athlete: data.athlete };
  } catch (e) {
    return { error: e.message };
  }
}
