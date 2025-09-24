// Netlify Function: Ably Token Auth endpoint (CommonJS)
// Issues short-lived tokens bound to clientId (and optionally roomId capability)

// Use the promises variant so we can await createTokenRequest
const Ably = require('ably/promises');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
};

function normalizeId(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 24);
}

function parseBody(event) {
  try {
    const ct = String(event.headers?.['content-type'] || event.headers?.['Content-Type'] || '');
    const rawEncoded = event.body || '';
    const raw = event.isBase64Encoded ? Buffer.from(rawEncoded, 'base64').toString('utf8') : rawEncoded;
    if (ct.includes('application/json')) {
      return JSON.parse(raw || '{}');
    }
    // Ably authUrl + authMethod: 'POST' defaults to x-www-form-urlencoded
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  } catch {
    return {};
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  const apiKey = (process.env.ABLY_API_KEY || '').trim();
  if (!apiKey) {
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing ABLY_API_KEY' }) };
  }

  try {
    const body = parseBody(event);
    const clientId = normalizeId(body.clientId);
    const roomId = normalizeId(body.roomId);

    if (!clientId) {
      return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid clientId' }) };
    }

    const channel = roomId ? `game-v1-${roomId}` : 'game-v1-*';
    const capability = { [channel]: ['publish', 'subscribe', 'presence'] };

    const rest = new Ably.Rest({ key: apiKey });
    const tokenRequest = await rest.auth.createTokenRequest({
      clientId,
      ttl: 60 * 60 * 1000, // 1 hour
      capability: JSON.stringify(capability),
    });

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(tokenRequest),
    };
  } catch (err) {
    try { console.error('[ably-token] error:', err && (err.stack || err.message || err)); } catch {}
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Token create failed', detail: String(err && (err.message || err)) }) };
  }
};
