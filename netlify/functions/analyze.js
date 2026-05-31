// ─── Vitrace — Netlify Function: /api/analyze ─────────────
// Handles both psychographic profile AND bazi reading
// Route: POST /api/analyze
// Env var required: ANTHROPIC_API_KEY

const Anthropic = require('@anthropic-ai/sdk');

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // CORS headers — adjust origin if you want to restrict to your domain
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { prompt, mode } = body;

  if (!prompt) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt is required' }) };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Set it in Netlify environment variables.' })
    };
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = msg.content?.[0]?.text || '';
    const clean = raw.replace(/```json\n?|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (_) {
      // If JSON parse fails, return error so client falls back to local engine
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Parse failed', raw })
      };
    }

    // Return in the format the client expects based on mode
    if (mode === 'bazi') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ baziReading: parsed })
      };
    }

    // Default: psychographic profile
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ profile: parsed })
    };

  } catch (err) {
    console.error('Anthropic API error:', err.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Upstream API error', message: err.message })
    };
  }
};
