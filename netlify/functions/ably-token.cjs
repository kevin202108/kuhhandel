// Netlify Function: Ably Token Auth endpoint (CommonJS)
// Issues short-lived tokens bound to clientId (and optionally roomId capability)

const Ably = require('ably');

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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: 'Missing ABLY_API_KEY' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const clientId = normalizeId(body.clientId);
    const roomId = normalizeId(body.roomId);

    if (!clientId) {
      return { statusCode: 400, headers: CORS, body: 'Invalid clientId' };
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
    return { statusCode: 500, headers: CORS, body: 'Token create failed' };
  }
};

