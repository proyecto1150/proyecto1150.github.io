/* netlify/functions/strava-token.js
   Proxies Strava OAuth token exchange to avoid CORS.
   Deploy to Netlify — this runs server-side automatically.
*/

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { code, client_id, client_secret, grant_type, refresh_token } = body;

  // Validate required fields
  if (!client_id || !client_secret || !grant_type) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  try {
    const payload = { client_id, client_secret, grant_type };
    if (grant_type === 'authorization_code') payload.code = code;
    if (grant_type === 'refresh_token') payload.refresh_token = refresh_token;

    const resp = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();
    return { statusCode: resp.status, headers, body: JSON.stringify(data) };

  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Upstream request failed', detail: err.message }),
    };
  }
};
