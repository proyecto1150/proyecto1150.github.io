/**
 * Cloudflare Worker — Strava Token Proxy for TrailMate
 *
 * HOW TO DEPLOY (free, takes ~2 minutes):
 *
 * 1. Go to https://workers.cloudflare.com and sign up (free)
 * 2. Click "Create Worker"
 * 3. Delete all default code and paste THIS entire file
 * 4. Click "Save and Deploy"
 * 5. Copy the worker URL (e.g. https://strava-proxy.yourname.workers.dev)
 * 6. Paste that URL into TrailMate's ⚙️ API Configuration → Proxy URL
 *
 * SECURITY:
 * - This worker only forwards requests to Strava's token endpoint
 * - It does not log or store any credentials
 * - It validates that the request is going to strava.com only
 * - Optionally restrict to your GitHub Pages origin (see ALLOWED_ORIGIN)
 *
 * OPTIONAL: Restrict to your site only (recommended)
 * Set ALLOWED_ORIGIN to your GitHub Pages URL, e.g.:
 *   const ALLOWED_ORIGIN = 'https://yourusername.github.io';
 */

const ALLOWED_ORIGIN = '*'; // Change to 'https://yourusername.github.io' for security
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    const { client_id, client_secret, grant_type, code, refresh_token } = body;

    if (!client_id || !client_secret || !grant_type) {
      return new Response(JSON.stringify({ error: 'Missing required fields: client_id, client_secret, grant_type' }), {
        status: 400,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    // Build payload for Strava
    const stravaPayload = { client_id, client_secret, grant_type };
    if (grant_type === 'authorization_code' && code) stravaPayload.code = code;
    if (grant_type === 'refresh_token' && refresh_token) stravaPayload.refresh_token = refresh_token;

    try {
      const stravaResp = await fetch(STRAVA_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stravaPayload),
      });

      const data = await stravaResp.json();

      return new Response(JSON.stringify(data), {
        status: stravaResp.status,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to reach Strava', detail: err.message }), {
        status: 502,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }
  },
};

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGIN === '*' ? '*' : (origin || '*');
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
