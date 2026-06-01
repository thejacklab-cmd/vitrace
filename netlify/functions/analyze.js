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
const MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS || 4000);

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

  return `Kamu adalah konsultan psikografis senior yang membantu klien memahami pola perilaku mereka secara mendalam, reflektif, dan memberdayakan. Output kamu akan langsung diberikan kepada klien sebagai laporan konsultasi premium — harus terasa seperti hasil kerja konsultan berpengalaman, bukan output AI generik.

STANDAR KUALITAS OUTPUT:
- Setiap insight harus mengikuti pola: Temuan → Makna sederhananya → Dampak bagi klien → Saran praktis.
- Jangan hanya menyebut label tanpa penjelasan. Setiap kalimat harus berguna dan dapat dipahami orang awam.
- Bahasa: hangat, sopan, profesional, natural, dan memberdayakan. Hindari nada menggurui atau kaku.
- Hindari klaim definitif. Gunakan: "cenderung", "tampak", "mengindikasikan", "bisa jadi", "tampaknya".
- Ini alat refleksi, bukan diagnosis klinis. Jangan memberi nasihat medis, hukum, atau investasi yang absolut.
- Setiap insight harus terasa personal dan spesifik untuk klien ini — bukan template umum.

MODE: ${mode === 'consultant' ? 'Consultant-Assisted — tulis dengan gaya profesional analitis, padat, dan berbasis data perilaku. Cocok untuk konsultan yang akan membahas hasil ini bersama klien.' : 'Client Self-Reflection — tulis dengan gaya hangat, personal, dan mudah dipahami. Pembaca langsung adalah klien itu sendiri, tanpa perantara konsultan.'}

PROFIL KLIEN:
Nama: ${name || 'tidak disebutkan'}
Usia: ${age || 'tidak disebutkan'}
Gender: ${gender || 'tidak disebutkan'}
Latar belakang: ${background || 'tidak disebutkan'}
Tujuan sesi: ${goal || 'tidak disebutkan'}

JAWABAN PERILAKU SELF-REPORT (skala 1=sangat rendah, 5=sangat tinggi):
${qSummary}

CATATAN PENTING INTERPRETASI:
- q_social mengukur energi sosial (1=introvert kuat, 5=ekstrovert kuat) — bukan tentang kemampuan bersosialisasi.
- q_selectivity mengukur selektivitas dalam memilih relasi dekat — BERBEDA dari energi sosial.
- q_flexibility mengukur adaptasi terhadap perubahan mendadak — BERBEDA dari q_execution yang mengukur preferensi struktur kerja.
- Integrasikan keduanya secara nuansif: seseorang bisa introvert tapi tidak selektif, atau ekstrovert tapi sangat selektif.

OBSERVASI SESI (dicatat oleh konsultan selama sesi):
${observations.length ? observations.map((o) => '- ' + o).join('\n') : 'Tidak ada observasi tambahan.'}

CATATAN INTERPRETATIF KONSULTAN:
${intuitiveNote || 'Tidak ada.'}

INSTRUKSI PENULISAN PER FIELD:

tipePribadi: Buat arketype reflektif 3-5 kata yang spesifik dan puitis, bukan label diagnosis. Contoh: "Pemikir Strategis yang Hangat", "Pemimpin Empatik Berbasis Data". Hindari: "Introvert Analitis" (terlalu generik).

ringkasanSingkat: 2 kalimat. Kalimat pertama: apa yang paling menonjol dari pola klien ini. Kalimat kedua: potensi terbesar yang bisa dikembangkan. Gunakan nama klien jika tersedia. Hangat dan memberdayakan.

pengantar: Paragraf pembuka 3 kalimat yang menyapa klien secara personal. Akui tujuan sesi mereka, refleksikan apa yang tampak dari jawaban mereka, dan berikan framing positif untuk hasil yang akan mereka baca. Gunakan nama klien.

kekuatan: Array 4-5 item. SETIAP item harus berupa 1 kalimat lengkap yang berisi: (a) nama kecenderungan, (b) apa artinya secara sederhana, dan (c) dampak positifnya dalam kehidupan nyata. Contoh baik: "Kemampuan analisis yang tajam — kamu cenderung mempertimbangkan berbagai sudut pandang sebelum memutuskan, yang membuat keputusanmu lebih matang dan terukur." Hindari label satu kata saja.

areaTumbuh: Array 3-4 item. SETIAP item harus berupa 1-2 kalimat yang berisi: (a) apa area tumbuhnya, (b) mengapa ini muncul dan apa dampaknya jika dibiarkan, dan (c) satu langkah konkret yang bisa dilakukan. Contoh baik: "Kesulitan mendelegasikan tanggung jawab — kecenderungan perfeksionisme bisa membuat kamu kelelahan jika semua hal ditangani sendiri. Cobalah secara bertahap mempercayakan satu tugas kecil kepada orang lain setiap minggu."

gayaKomunikasi: 3-4 kalimat mengikuti pola: (1) Temuan utama gaya komunikasi. (2) Apa artinya dalam praktik sehari-hari. (3) Bagaimana ini memengaruhi hubungan atau kolaborasi. (4) Satu saran praktis untuk mengoptimalkan gaya komunikasi ini.

polaDalamRelasi: 3-4 kalimat. Integrasikan q_social (energi sosial) DAN q_selectivity (selektivitas relasi) sebagai dua dimensi berbeda. Jelaskan: bagaimana klien mendapatkan energi dari interaksi sosial, bagaimana mereka memilih orang-orang dekat, dan apa yang mereka butuhkan dari relasi yang sehat.

responStres: 3-4 kalimat mengikuti pola: (1) Bagaimana klien cenderung merespons tekanan. (2) Apa yang biasanya membantu mereka pulih. (3) Tanda peringatan dini yang perlu diwaspadai. (4) Strategi pemulihan yang cocok untuk profil ini.

kecenderunganKepemimpinan: 2-3 kalimat. Jelaskan: gaya kepemimpinan yang paling natural untuk profil ini, konteks di mana mereka paling efektif sebagai pemimpin, dan satu area kepemimpinan yang bisa dikembangkan lebih lanjut.

arahtumbuh: Array 3-4 item. SETIAP item harus berupa 1-2 kalimat langkah konkret dan spesifik — bukan saran generik seperti "belajar lebih banyak". Tulis dengan format: "Apa yang dilakukan + mengapa ini relevan untuk profil ini + bagaimana memulainya." Contoh baik: "Latih kebiasaan refleksi harian 10 menit sebelum tidur — profil analitis seperti kamu cenderung memproses kejadian lebih dalam saat ada waktu tenang, dan kebiasaan ini bisa menjadi alat self-awareness yang kuat."

kesimpulan: 4-5 kalimat penutup yang: (1) merangkum tema utama profil ini dalam 1-2 kalimat hangat. (2) Menghubungkan dengan tujuan sesi klien jika disebutkan. (3) Memberikan reframing positif terhadap area tumbuh. (4) Mengakhiri dengan kalimat memberdayakan yang mendorong aksi atau refleksi lanjutan.

hipotesisReflektif: ${intuitiveNote ? '2-3 kalimat berbasis catatan konsultan. Gunakan bahasa tentatif: mungkin, bisa jadi, tampaknya, ada kemungkinan. Hipotesis ini adalah perspektif tambahan dari konsultan yang mengobservasi sesi, bukan kesimpulan definitif.' : 'null'}

scoreOverall: Angka integer 45-88 yang mencerminkan keseimbangan profil secara keseluruhan. Pertimbangkan: konsistensi jawaban, keseimbangan antar dimensi, dan potensi tumbuh. Bukan penilaian baik-buruk, melainkan indikasi keseimbangan internal.

Kembalikan HANYA JSON valid, tanpa markdown, tanpa code fence, dengan format persis ini:
{
  "tipePribadi": "...",
  "ringkasanSingkat": "...",
  "pengantar": "...",
  "kekuatan": ["kalimat lengkap 1", "kalimat lengkap 2", "kalimat lengkap 3", "kalimat lengkap 4"],
  "areaTumbuh": ["kalimat lengkap 1-2 kalimat 1", "kalimat lengkap 1-2 kalimat 2", "kalimat lengkap 1-2 kalimat 3"],
  "gayaKomunikasi": "...",
  "polaDalamRelasi": "...",
  "responStres": "...",
  "kecenderunganKepemimpinan": "...",
  "arahtumbuh": ["langkah spesifik 1", "langkah spesifik 2", "langkah spesifik 3"],
  "kesimpulan": "...",
  "hipotesisReflektif": ${intuitiveNote ? '"..."' : 'null'},
  "scoreOverall": 65
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

  return `Kamu adalah pakar pembacaan Bazi (八字) yang menyajikan analisis dengan cara yang dapat dipahami orang awam — hangat, jelas, dan memberdayakan. Output kamu akan menjadi bagian dari laporan konsultasi premium yang langsung dibaca oleh klien.

STANDAR KUALITAS OUTPUT:
- Setiap penjelasan harus mudah dipahami orang yang belum pernah mendengar istilah Bazi sebelumnya.
- Jika menyebut istilah teknis (Day Master, Luck Pillar, Spouse Star, elemen, dll), SELALU jelaskan artinya dalam tanda kurung atau kalimat berikutnya.
- Gunakan bahasa tentatif: cenderung, tema yang tampak, mengindikasikan, bisa jadi.
- Jangan membuat klaim absolut tentang rezeki, jodoh, kesehatan, atau masa depan.
- Hindari nasihat finansial, medis, atau relasi yang deterministik.
- Bahasa Indonesia hangat, santai-profesional, dan memberdayakan.
- Setiap insight harus terasa relevan dan personal — bukan penjelasan ensiklopedia.

GLOSARIUM ISTILAH BAZI (untuk referensi interpretasimu):
- Day Master (Tuan Hari): elemen dan batang langit yang mewakili inti kepribadian dan identitas seseorang dalam sistem Bazi. Ini adalah "siapa kamu sebenarnya" dalam chart.
- Luck Pillar (Da Yun/大運): siklus energi 10 tahunan yang memengaruhi tema kehidupan seseorang. Berbeda dari tahun lahir — ini adalah fase perjalanan hidup yang sedang berjalan.
- Spouse Star (Bintang Pasangan): elemen atau bintang dalam chart yang mengindikasikan pola relasi romantis dan kecocokan dengan pasangan.
- Elemen Favorable: elemen yang mendukung keseimbangan chart dan cenderung membawa energi positif.
- Elemen Unfavorable: elemen yang dapat menciptakan ketegangan dalam chart jika terlalu dominan.
- Pilar Tahun (Year Pillar): mencerminkan warisan keluarga dan masa kecil.
- Pilar Bulan (Month Pillar): mencerminkan karir, ambisi, dan cara bekerja.
- Pilar Hari (Day Pillar): mencerminkan kepribadian inti dan cara berhubungan.
- Pilar Jam (Hour Pillar): mencerminkan aspirasi, kreativitas, dan anak atau warisan.

NAMA KLIEN: ${name || 'tidak disebutkan'}
DATA CHART BAZI:
${compactJson(bazi)}

KONTEKS PSIKOGRAFIS (dari analisis perilaku sebelumnya):
${psyProfile ? compactJson(psyProfile, 800) : 'Tidak tersedia.'}

INSTRUKSI PENULISAN PER FIELD:

chartSummary: 3-4 kalimat. Jelaskan: (1) Gambaran umum chart ini — apakah seimbang atau didominasi elemen tertentu. (2) Apa artinya secara sederhana bagi kehidupan klien. (3) Tema besar yang tampak dari kombinasi pilar-pilar ini. Gunakan bahasa yang bisa dipahami orang yang baru pertama kali mendengar Bazi.

dayMasterProfile: 4-5 kalimat. Jelaskan: (1) Apa elemen Day Master ini — artikan dalam kata-kata sederhana (misal: "Kayu Yang — seperti pohon besar yang tumbuh ke atas"). (2) Kecenderungan kepribadian yang muncul dari Day Master ini. (3) Kekuatan utama yang datang dari Day Master ini. (4) Potensi blind spot atau self-sabotage yang perlu diwaspadai. (5) Satu kalimat memberdayakan.

elementBalance.favorable: Array 2-3 item. Setiap item: "Nama elemen — penjelasan singkat mengapa elemen ini mendukung chart ini dan dampak praktisnya dalam kehidupan sehari-hari."

elementBalance.unfavorable: Array 2-3 item. Setiap item: "Nama elemen — penjelasan mengapa elemen ini perlu diwaspadai dan bagaimana dampaknya jika terlalu dominan, dengan satu tips sederhana."

elementBalance.advice: 2 kalimat saran praktis non-deterministik tentang cara menjaga keseimbangan elemen dalam kehidupan sehari-hari.

careerWealth.bestIndustries: Array 3-4 item spesifik dengan penjelasan singkat mengapa cocok. Format: "Nama bidang — alasan singkat berbasis chart."

careerWealth.workStyle: 2-3 kalimat. Jelaskan gaya kerja yang paling natural dan efektif untuk chart ini — apakah lebih cocok sebagai entrepreneur, profesional, atau di struktur tertentu, dan mengapa.

careerWealth.wealthPattern: 3-4 kalimat. Jelaskan: tema rezeki yang tampak dari chart, bagaimana kecenderungan menghasilkan vs mempertahankan kekayaan, dan pola umum yang perlu diperhatikan. Gunakan bahasa non-deterministik.

careerWealth.blindspot: 2-3 kalimat tentang blind spot finansial yang perlu diwaspadai — apa yang sering menjadi jebakan bagi profil chart seperti ini, dan bagaimana mengantisipasinya.

relationships.spouseStar: 2-3 kalimat. Jelaskan terlebih dahulu apa itu Spouse Star secara sederhana, lalu bagaimana Spouse Star dalam chart ini mengindikasikan pola relasi romantis klien. Gunakan bahasa tentatif.

relationships.lovePattern: 3-4 kalimat tentang pola cinta dan kebutuhan emosional berdasarkan chart — apa yang klien cari dalam relasi, bagaimana mereka mencintai, dan apa yang mereka butuhkan agar relasi berkembang sehat.

relationships.marriageTiming: 2-3 kalimat tentang tema waktu dan kondisi yang mengindikasikan kesiapan relasi serius — gunakan bahasa umum dan tidak absolut, lebih ke kondisi internal daripada tanggal spesifik.

luckPillarNow: 4-5 kalimat. Jelaskan: (1) Apa Luck Pillar saat ini — dalam bahasa sederhana. (2) Tema energi yang sedang aktif selama periode ini. (3) Peluang yang cenderung hadir. (4) Tantangan yang perlu diwaspadai. (5) Saran menghadapi periode ini.

upcomingYears: 4-5 kalimat tentang tema 5-10 tahun ke depan berdasarkan transisi Luck Pillar — peluang, pergeseran energi, dan area yang perlu dipersiapkan. Gunakan bahasa non-deterministik dan memberdayakan.

actionableAdvice: Array 4-5 item. Setiap item: saran praktis spesifik yang bisa langsung diterapkan, berbasis insight dari chart. Format: "Apa yang dilakukan + mengapa relevan untuk chart ini." Bukan saran generik.

honestWarning: 2-3 kalimat. Tantangan terbesar yang perlu diperhatikan dari chart ini — disampaikan dengan bahasa jujur namun tidak menakut-nakuti, disertai reframing positif.

Kembalikan HANYA JSON valid, tanpa markdown, tanpa code fence, dengan format persis ini:
{
  "chartSummary": "...",
  "dayMasterProfile": "...",
  "elementBalance": {
    "favorable": ["elemen 1 — penjelasan", "elemen 2 — penjelasan"],
    "unfavorable": ["elemen 1 — penjelasan", "elemen 2 — penjelasan"],
    "advice": "..."
  },
  "careerWealth": {
    "bestIndustries": ["bidang 1 — alasan", "bidang 2 — alasan", "bidang 3 — alasan"],
    "workStyle": "...",
    "wealthPattern": "...",
    "blindspot": "..."
  },
  "relationships": {
    "spouseStar": "...",
    "lovePattern": "...",
    "marriageTiming": "..."
  },
  "luckPillarNow": "...",
  "upcomingYears": "...",
  "actionableAdvice": ["saran 1", "saran 2", "saran 3", "saran 4"],
  "honestWarning": "..."
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
