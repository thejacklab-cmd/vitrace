'use strict';

// Vitrace — Production-hardened Netlify Function
// Route: POST /api/analyze
// Required env: DEEPSEEK_API_KEY
// Recommended env: ALLOWED_ORIGINS=https://your-domain.com, DEEPSEEK_MODEL=deepseek-reasoner

const OpenAI = require('openai');
const crypto = require('crypto');

const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 12000);
const MAX_TEXT_FIELD = Number(process.env.MAX_TEXT_FIELD || 1200);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 12);
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-reasoner';
const MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS || 2000);

const ALLOWED_MODELS = new Set([
  'deepseek-reasoner',
  'deepseek-chat'
]);

// Best-effort in-memory rate limit for warm Netlify instances.
// For high-traffic production, put Cloudflare/Netlify Edge/Upstash in front of this.
const buckets = new Map();

function json(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(payload)
  };
}

function getConfiguredOrigins() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getRequestOrigin(event) {
  return event.headers?.origin || event.headers?.Origin || '';
}

function isOriginAllowed(event) {
  const configured = getConfiguredOrigins();
  const origin = getRequestOrigin(event);
  if (configured.length === 0) return true;
  if (!origin) return true;
  return configured.includes(origin);
}

function buildCorsHeaders(event) {
  const configured = getConfiguredOrigins();
  const origin = getRequestOrigin(event);
  const allowedOrigin = configured.length === 0
    ? '*'
    : (configured.includes(origin) ? origin : 'null');

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Request-Id',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  };
}

function getClientIp(event) {
  const h = event.headers || {};
  const forwarded = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
  return forwarded.split(',')[0].trim() || h['client-ip'] || h['x-real-ip'] || 'unknown';
}

function rateLimit(ip) {
  const now = Date.now();
  const current = buckets.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  current.count += 1;
  buckets.set(ip, current);

  return {
    ok: current.count <= RATE_LIMIT_MAX,
    retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  };
}

function sanitizeText(value, max) {
  if (max === undefined) max = MAX_TEXT_FIELD;
  if (value === null || value === undefined) return '';
  // Strip control characters (U+0000-U+001F and U+007F), collapse whitespace
  var s = String(value);
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var code = s.charCodeAt(i);
    if (code <= 0x1F || code === 0x7F) { out += ' '; } else { out += s[i]; }
  }
  return out.replace(/s+/g, ' ').trim().slice(0, max);
}

function sanitizeArray(value, maxItems = 20, maxItemLen = 160) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => sanitizeText(item, maxItemLen)).filter(Boolean);
}

function validateQuestionnaire(q) {
  const required = ['q_decision', 'q_timeframe', 'q_execution', 'q_social', 'q_selectivity', 'q_flexibility', 'q_stress', 'q_recovery', 'q_empathy', 'q_consistency'];
  if (!q || typeof q !== 'object') throw new Error('questionnaire is required');

  const clean = {};
  for (const key of required) {
    const n = Number(q[key]);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error(`invalid questionnaire value: ${key}`);
    clean[key] = n;
  }
  return clean;
}

function validateMode(mode) {
  if (mode === 'bazi') return 'bazi';
  if (mode === 'client' || mode === 'consultant' || mode === 'psychographic') return mode;
  return 'client';
}

function compactJson(value, max = 7000) {
  try {
    return JSON.stringify(value).slice(0, max);
  } catch (_) {
    return '{}';
  }
}

function buildPsychographicPrompt(body) {
  const mode = validateMode(body.mode);
  const name = sanitizeText(body.name, 80);
  const age = sanitizeText(body.age, 20);
  const gender = sanitizeText(body.gender, 40);
  const background = sanitizeText(body.background, 240);
  const goal = sanitizeText(body.goal, 280);
  const intuitiveNote = sanitizeText(body.intuitiveNote, 700);
  const observations = sanitizeArray(body.observations, 20, 120);
  const questionnaire = validateQuestionnaire(body.questionnaire);

  const labels = {
    q_decision: 'Cara pengambilan keputusan',
    q_timeframe: 'Orientasi waktu',
    q_execution: 'Cara kerja',
    q_social: 'Energi sosial',
    q_selectivity: 'Selektivitas relasi',
    q_flexibility: 'Fleksibilitas adaptif',
    q_stress: 'Respons stres',
    q_recovery: 'Kecepatan pemulihan',
    q_empathy: 'Empati',
    q_consistency: 'Konsistensi'
  };

  const qSummary = Object.entries(questionnaire)
    .map(([key, val]) => `- ${labels[key]}: ${val}/5`)
    .join('\n');

  return `Kamu adalah konsultan psikografis. Bantu klien memahami pola perilaku untuk refleksi dan pengembangan pribadi.

BATASAN WAJIB:
- Ini alat refleksi, bukan diagnosis klinis.
- Hindari klaim definitif. Gunakan bahasa tentatif: cenderung, tampak, mengindikasikan, bisa jadi.
- Jangan memberi nasihat medis, hukum, investasi, atau keputusan hidup yang absolut.
- Bahasa Indonesia natural, profesional, hangat, dan memberdayakan.

MODE: ${mode === 'consultant' ? 'Consultant-Assisted: profesional dan analitis' : 'Client Self-Reflection: personal dan mudah dipahami'}

PROFIL KLIEN:
Nama: ${name || 'tidak disebutkan'}
Usia: ${age || 'tidak disebutkan'}
Gender: ${gender || 'tidak disebutkan'}
Latar belakang: ${background || 'tidak disebutkan'}
Tujuan sesi: ${goal || 'tidak disebutkan'}

JAWABAN PERILAKU SELF-REPORT:
${qSummary}

OBSERVASI SESI:
${observations.length ? observations.map((o) => '- ' + o).join('\n') : 'Tidak ada.'}

CATATAN INTERPRETATIF KONSULTAN:
${intuitiveNote || 'Tidak ada.'}

Kembalikan HANYA JSON valid, tanpa markdown, tanpa code fence, dengan format persis ini:
{
  "tipePribadi": "label deskriptif 3-4 kata, bukan diagnosis",
  "ringkasanSingkat": "1 kalimat tentatif dan memberdayakan",
  "kekuatan": ["kecenderungan positif 1", "kecenderungan positif 2", "kecenderungan positif 3", "kecenderungan positif 4"],
  "areaTumbuh": ["area pengembangan 1", "area pengembangan 2", "area pengembangan 3"],
  "gayaKomunikasi": "2-3 kalimat observasional",
  "polaDalamRelasi": "2-3 kalimat reflektif yang membedakan energi sosial dan selektivitas relasi",
  "responStres": "2-3 kalimat supportif berbasis respons stres dan pemulihan",
  "kecenderunganKepemimpinan": "2 kalimat tentang potensi kepemimpinan",
  "arahtumbuh": ["langkah konkret 1", "langkah konkret 2", "langkah konkret 3"],
  "kesimpulan": "3-4 kalimat penutup reflektif",
  "hipotesisReflektif": ${intuitiveNote ? '"2-3 kalimat berbasis catatan konsultan dengan bahasa mungkin/bisa jadi/tampaknya"' : 'null'},
  "scoreOverall": 40
}`;
}

function buildBaziPrompt(body) {
  const name = sanitizeText(body.name, 80);
  const bazi = body.bazi && typeof body.bazi === 'object' ? body.bazi : null;
  if (!bazi) throw new Error('bazi data is required');

  const psyProfile = body.psyProfile && typeof body.psyProfile === 'object'
    ? {
        tipePribadi: sanitizeText(body.psyProfile.tipePribadi, 120),
        ringkasanSingkat: sanitizeText(body.psyProfile.ringkasanSingkat, 260)
      }
    : null;

  return `Kamu membantu membaca Bazi sebagai refleksi budaya dan hiburan personal, bukan kepastian nasib.

BATASAN WAJIB:
- Jangan membuat klaim absolut tentang rezeki, jodoh, kesehatan, atau masa depan.
- Gunakan bahasa tentatif: cenderung, tema yang tampak, area yang perlu diperhatikan.
- Hindari nasihat finansial, medis, atau relasi yang deterministik.
- Bahasa Indonesia santai-profesional.

NAMA: ${name || 'tidak disebutkan'}
DATA BAZI JSON:
${compactJson(bazi)}

KONTEKS PSIKOGRAFIS OPSIONAL:
${psyProfile ? compactJson(psyProfile, 800) : 'Tidak ada.'}

Kembalikan HANYA JSON valid, tanpa markdown, tanpa code fence, dengan format persis ini:
{
  "chartSummary": "2-3 kalimat tentang struktur chart keseluruhan secara tentatif",
  "dayMasterProfile": "3-4 kalimat tentang Day Master, kekuatan, dan potensi self-sabotage secara reflektif",
  "elementBalance": {
    "favorable": ["elemen menguntungkan 1 dengan penjelasan singkat", "elemen menguntungkan 2"],
    "unfavorable": ["elemen tidak menguntungkan 1 dengan penjelasan", "elemen tidak menguntungkan 2"],
    "advice": "1-2 kalimat saran praktis non-deterministik"
  },
  "careerWealth": {
    "bestIndustries": ["bidang 1", "bidang 2", "bidang 3"],
    "workStyle": "gaya kerja yang mungkin cocok secara reflektif",
    "wealthPattern": "pola rezeki sebagai refleksi, bukan prediksi pasti",
    "blindspot": "1-2 kalimat blind spot finansial yang perlu diwaspadai secara umum"
  },
  "relationships": {
    "spouseStar": "penjelasan spouse star secara tentatif",
    "lovePattern": "2-3 kalimat pola relasi",
    "marriageTiming": "bahasa umum dan tidak absolut tentang timing relasi"
  },
  "luckPillarNow": "3-4 kalimat tema luck pillar saat ini secara reflektif",
  "upcomingYears": "3-4 kalimat peluang dan risiko secara non-deterministik",
  "actionableAdvice": ["saran praktis 1", "saran praktis 2", "saran praktis 3", "saran praktis 4"],
  "honestWarning": "1-2 kalimat tantangan terbesar dengan bahasa wajar dan tidak menakut-nakuti"
}`;
}

function parseModelJson(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) throw new Error('model did not return JSON object');
  return JSON.parse(text.slice(first, last + 1));
}

function isStringArray(value, min, max) {
  return Array.isArray(value) && value.length >= min && value.length <= max && value.every((x) => typeof x === 'string' && x.trim().length > 0);
}

function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') return false;
  return typeof profile.tipePribadi === 'string'
    && typeof profile.ringkasanSingkat === 'string'
    && isStringArray(profile.kekuatan, 3, 6)
    && isStringArray(profile.areaTumbuh, 2, 5)
    && typeof profile.gayaKomunikasi === 'string'
    && typeof profile.polaDalamRelasi === 'string'
    && typeof profile.responStres === 'string'
    && typeof profile.kecenderunganKepemimpinan === 'string'
    && isStringArray(profile.arahtumbuh, 2, 5)
    && typeof profile.kesimpulan === 'string'
    && Number.isFinite(Number(profile.scoreOverall));
}

function validateBazi(reading) {
  if (!reading || typeof reading !== 'object') return false;
  return typeof reading.chartSummary === 'string'
    && typeof reading.dayMasterProfile === 'string'
    && reading.elementBalance && typeof reading.elementBalance === 'object'
    && isStringArray(reading.elementBalance.favorable, 1, 4)
    && isStringArray(reading.elementBalance.unfavorable, 1, 4)
    && reading.careerWealth && typeof reading.careerWealth === 'object'
    && isStringArray(reading.careerWealth.bestIndustries, 1, 5)
    && reading.relationships && typeof reading.relationships === 'object'
    && isStringArray(reading.actionableAdvice, 2, 6)
    && typeof reading.honestWarning === 'string';
}

exports.handler = async (event) => {
  const requestId = crypto.randomUUID();
  const corsHeaders = buildCorsHeaders(event);
  const baseHeaders = { ...corsHeaders, 'X-Request-Id': requestId };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: baseHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed', requestId }, baseHeaders);
  }

  if (!isOriginAllowed(event)) {
    console.warn(JSON.stringify({ requestId, level: 'warn', msg: 'blocked origin', origin: getRequestOrigin(event) }));
    return json(403, { error: 'Forbidden origin', requestId }, baseHeaders);
  }

  if (!ALLOWED_MODELS.has(MODEL)) {
    console.error(JSON.stringify({ requestId, level: 'error', msg: 'disallowed model configured', model: MODEL }));
    return json(500, { error: 'Server model is not configured correctly', requestId }, baseHeaders);
  }

  const rawBody = event.body || '';
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return json(413, { error: 'Payload too large', requestId }, baseHeaders);
  }

  const ip = getClientIp(event);
  const limit = rateLimit(ip);
  if (!limit.ok) {
    return json(429, { error: 'Too many requests', retryAfter: limit.retryAfter, requestId }, { ...baseHeaders, 'Retry-After': String(limit.retryAfter) });
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    console.error(JSON.stringify({ requestId, level: 'error', msg: 'missing DEEPSEEK_API_KEY' }));
    return json(500, { error: 'Server is not configured', requestId }, baseHeaders);
  }

  let body;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch (_) {
    return json(400, { error: 'Invalid JSON', requestId }, baseHeaders);
  }

  let prompt;
  let responseKey;
  try {
    if (body.mode === 'bazi') {
      prompt = buildBaziPrompt(body);
      responseKey = 'baziReading';
    } else {
      prompt = buildPsychographicPrompt(body);
      responseKey = 'profile';
    }
  } catch (err) {
    return json(400, { error: err.message || 'Invalid request payload', requestId }, baseHeaders);
  }

  try {
    const started = Date.now();
    const client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com'
    });

    // deepseek-reasoner does not support temperature parameter
    const createParams = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }]
    };

    if (MODEL === 'deepseek-chat') {
      createParams.temperature = 0.3;
    }

    const response = await client.chat.completions.create(createParams);
    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = parseModelJson(raw);
    const valid = responseKey === 'profile' ? validateProfile(parsed) : validateBazi(parsed);

    if (!valid) {
      console.warn(JSON.stringify({ requestId, level: 'warn', msg: 'schema validation failed', responseKey }));
      return json(422, { error: 'Schema validation failed', requestId }, baseHeaders);
    }

    console.log(JSON.stringify({ requestId, level: 'info', mode: responseKey, latencyMs: Date.now() - started, model: MODEL }));
    return json(200, { [responseKey]: parsed, requestId }, baseHeaders);
  } catch (err) {
    console.error(JSON.stringify({ requestId, level: 'error', msg: 'upstream failure', detail: err?.message }));
    return json(502, { error: 'Analysis service unavailable', requestId }, baseHeaders);
  }
};
