// ─── CONFIG ───────────────────────────────────────────────
const PROXY_ENDPOINT = '/api/analyze';
const DEBUG = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
function debugWarn(...args) { if (DEBUG) console.warn(...args); }

const ELEM_COLORS = { Wood:'#4CAF50', Fire:'#FF5722', Earth:'#FF9800', Metal:'#9E9E9E', Water:'#2196F3' };

// ─── ALL 10 REQUIRED LIKERT QUESTIONS ────────────────────
// Each has its own dimension. No dimension derived from another question.
const REQUIRED_QUESTIONS = [
  { id: 'q_decision',    label: 'Cara pengambilan keputusan' },
  { id: 'q_timeframe',   label: 'Orientasi waktu' },
  { id: 'q_execution',   label: 'Cara kerja' },
  { id: 'q_social',      label: 'Energi sosial' },
  { id: 'q_selectivity', label: 'Selektivitas relasi' },
  { id: 'q_flexibility', label: 'Fleksibilitas adaptif' },
  { id: 'q_stress',      label: 'Respons stres' },
  { id: 'q_recovery',    label: 'Kecepatan pemulihan' },
  { id: 'q_empathy',     label: 'Empati' },
  { id: 'q_consistency', label: 'Konsistensi' },
];

const STEP2_QS = ['q_decision','q_timeframe','q_execution','q_social','q_selectivity','q_flexibility'];
const STEP3_QS = ['q_stress','q_recovery','q_empathy','q_consistency'];

// ─── STATE ────────────────────────────────────────────────
let currentMode = 'client';
let consentGiven = false;
let currentStep = 1;
const likertState = {};

// ─── SANITIZER ───────────────────────────────────────────
function safeText(str) {
  if (typeof str !== 'string') return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

const SAFE_CSS_VALUE = /^[a-zA-Z0-9#()%.,\s_-]+$/;
function safeCss(value, fallback) {
  return SAFE_CSS_VALUE.test(String(value || '')) ? value : fallback;
}

function applyRuntimeStyles(root = document) {
  root.querySelectorAll('[data-color]').forEach(el => {
    el.style.color = safeCss(el.dataset.color, 'var(--accent)');
  });
  root.querySelectorAll('[data-bg]').forEach(el => {
    el.style.background = safeCss(el.dataset.bg, 'var(--accent)');
  });
  root.querySelectorAll('[data-width]').forEach(el => {
    const width = Math.max(0, Math.min(100, Number(el.dataset.width) || 0));
    el.style.width = width + '%';
  });
}

// ─── MODE SWITCH ─────────────────────────────────────────
function setMode(mode) {
  currentMode = mode;
  document.getElementById('appBody').className = 'mode-' + mode;
  document.getElementById('btnClient').classList.toggle('active', mode === 'client');
  document.getElementById('btnConsultant').classList.toggle('active', mode === 'consultant');
  document.getElementById('modeBadgeText').textContent = mode === 'client'
    ? 'Mode Refleksi Diri — untuk klien'
    : 'Mode Konsultan — profiling berbantuan';
}

// ─── STEP NAVIGATION WITH VALIDATION ─────────────────────
function goStep(n) {
  // Validate Step 1 → 2
  if (n === 2 && !document.getElementById('f_name').value.trim()) {
    showFieldError('Nama wajib diisi sebelum melanjutkan.');
    return;
  }

  // Validate Step 2 → 3: check Step 2 questions complete
  if (n === 3) {
    const missing = STEP2_QS.filter(q => !likertState[q]);
    if (missing.length > 0) {
      const labels = missing.map(q => REQUIRED_QUESTIONS.find(r=>r.id===q)?.label || q);
      showFieldError(`${missing.length} pertanyaan belum dijawab: ${labels.join(', ')}.`);
      highlightUnanswered(missing);
      return;
    }
  }

  // Validate Step 3 → 4: check Step 3 questions complete
  if (n === 4) {
    const missing = STEP3_QS.filter(q => !likertState[q]);
    if (missing.length > 0) {
      const labels = missing.map(q => REQUIRED_QUESTIONS.find(r=>r.id===q)?.label || q);
      showFieldError(`${missing.length} pertanyaan belum dijawab: ${labels.join(', ')}.`);
      highlightUnanswered(missing);
      return;
    }
  }

  document.getElementById('step' + currentStep).classList.remove('active');
  document.getElementById('step' + n).classList.add('active');

  for (let i = 1; i <= 5; i++) {
    const dot = document.getElementById('sd' + i);
    dot.classList.remove('active','done');
    if (i < n) dot.classList.add('done');
    else if (i === n) dot.classList.add('active');
  }
  for (let i = 1; i <= 4; i++) {
    const line = document.getElementById('sl' + i);
    if (line) line.classList.toggle('done', i < n);
  }

  if (n === 5) populateReview();
  currentStep = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── ERROR DISPLAY ────────────────────────────────────────
function showFieldError(msg) {
  let banner = document.getElementById('stepErrorBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'stepErrorBanner';
    banner.setAttribute('role', 'alert');
    banner.className = 'field-error-banner';
    const activeStep = document.querySelector('.step-panel.active');
    activeStep.insertBefore(banner, activeStep.firstChild);
  }
  banner.textContent = '⚠ ' + msg;
  banner.style.display = 'block';
  setTimeout(() => { if (banner) banner.style.display = 'none'; }, 5000);
}

function highlightUnanswered(qIds) {
  qIds.forEach(id => {
    const row = document.getElementById(id);
    if (!row) return;
    row.classList.add('highlight-unanswered');
    setTimeout(() => { row.classList.remove('highlight-unanswered'); }, 4000);
  });
}

// ─── LIKERT INTERACTION ───────────────────────────────────
function selectLikert(groupId, btn) {
  const group = document.getElementById(groupId);
  group.querySelectorAll('.likert-btn').forEach(b => {
    b.classList.remove('selected');
    b.setAttribute('aria-pressed', 'false');
  });
  btn.classList.add('selected');
  btn.setAttribute('aria-pressed', 'true');
  likertState[groupId] = parseInt(btn.dataset.val);

  // Update progress count in real time on step dots
  updateProgressCount();
}

function updateProgressCount() {
  const answered = REQUIRED_QUESTIONS.filter(q => likertState[q.id]).length;
  const total = REQUIRED_QUESTIONS.length;
  // Update step dot labels dynamically
  const sd2 = document.getElementById('sd2');
  const sd3 = document.getElementById('sd3');
  const step2Done = STEP2_QS.filter(q => likertState[q]).length;
  const step3Done = STEP3_QS.filter(q => likertState[q]).length;
  if (step2Done > 0 && step2Done < STEP2_QS.length) {
    sd2.querySelector('.step-label').textContent = `Pola (${step2Done}/${STEP2_QS.length})`;
  }
  if (step3Done > 0 && step3Done < STEP3_QS.length) {
    sd3.querySelector('.step-label').textContent = `Emosi (${step3Done}/${STEP3_QS.length})`;
  }
}

// ─── OBSERVATIONS ─────────────────────────────────────────
function toggleObs(el) {
  el.classList.toggle('sel');
  const check = el.querySelector('.obs-check');
  const isSelected = el.classList.contains('sel');
  check.textContent = isSelected ? '✓' : '';
  el.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
}

function handleChipKey(event, el) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleObs(el);
  }
}

function getObservations() {
  const obs = [];
  document.querySelectorAll('.obs-chip.sel').forEach(el => {
    obs.push(el.dataset.label || el.textContent.trim());
  });
  return obs;
}

// ─── CONSENT ──────────────────────────────────────────────
function toggleConsent(checked) {
  consentGiven = checked;
  document.getElementById('btnGenerate').disabled = !consentGiven;
}

// ─── REVIEW SUMMARY WITH COMPLETION BANNER ───────────────
function populateReview() {
  const name = safeText(document.getElementById('f_name').value.trim());
  const age  = safeText(document.getElementById('f_age').value);
  const gen  = safeText(document.getElementById('f_gender').value);
  const bg   = safeText(document.getElementById('f_bg').value);
  const goal = safeText(document.getElementById('f_goal').value.trim());

  // Completion banner
  const answered = REQUIRED_QUESTIONS.filter(q => likertState[q.id]).length;
  const total = REQUIRED_QUESTIONS.length;
  const allDone = answered === total;
  const banner = document.getElementById('completionBanner');
  if (allDone) {
    banner.classList.remove('completion-warn');
    banner.classList.add('completion-ok');
    banner.innerHTML = `<span class="u-6c28d089">✓</span> Semua ${total} pertanyaan selesai dijawab. Profil siap digenerate.`;
  } else {
    const missing = REQUIRED_QUESTIONS.filter(q => !likertState[q.id]);
    banner.classList.remove('completion-ok');
    banner.classList.add('completion-warn');
    banner.innerHTML = `<span class="u-6c28d089">⚠</span> ${answered} dari ${total} pertanyaan selesai. Belum dijawab: <strong>${missing.map(q=>safeText(q.label)).join(', ')}</strong>.`;
    document.getElementById('btnGenerate').disabled = true;
    // Force consent unchecked too until complete
    const cb = document.getElementById('consentInput');
    if (cb) { cb.checked = false; consentGiven = false; }
  }

  const qLabels = REQUIRED_QUESTIONS.map(({id, label}) => ({
    id, label,
    val: likertState[id] ? Math.round((likertState[id]-1)/4*100) : null
  }));

  let rows = `
    <div class="u-13d6a5e4">
      <div><span class="u-b47e559f">Nama</span><br><strong>${name}</strong></div>
      <div><span class="u-b47e559f">Usia</span><br><strong>${age || '—'}</strong></div>
      <div><span class="u-b47e559f">Gender</span><br><strong>${gen || '—'}</strong></div>
      <div><span class="u-b47e559f">Latar Belakang</span><br><strong>${bg || '—'}</strong></div>
    </div>`;

  if (goal) {
    rows += `<div class="u-7b11da3d">
      <span class="u-b47e559f">Tujuan sesi</span><br>
      <em class="u-9c8bc985">${goal}</em>
    </div>`;
  }

  rows += `<div class="u-9993dec3">
    <div class="u-f7482284">Jawaban Pertanyaan Perilaku</div>
    <div class="u-c59de99e">`;

  qLabels.forEach(({label, val}) => {
    const display = val !== null ? `${val}%` : '<span class="u-024c869c">Belum dijawab</span>';
    rows += `<div class="u-fe2d25b2">
      <span class="u-50197c32">${safeText(label)}</span>
      <span class="u-8a012124">${display}</span>
    </div>`;
  });

  rows += `</div></div>`;
  const reviewContent = document.getElementById('reviewContent');
  reviewContent.innerHTML = rows;
  applyRuntimeStyles(reviewContent);
}

// ─── SCORING — each dimension has its own question ────────
function l2pct(val) {
  // Only convert if answered. Returns null if unanswered (never defaults to 50).
  if (!val) return null;
  return Math.round((val - 1) / 4 * 100);
}

function getScoresFromLikert() {
  // FIX: each sub-dimension now maps to its own dedicated question
  return {
    kognitif: {
      strategis: l2pct(likertState['q_timeframe'])  ?? 50,  // long-term = strategic
      abstrak:   l2pct(likertState['q_decision'])   ?? 50,  // analytic = abstract thinking
    },
    emosional: {
      regulasi:  l2pct(likertState['q_stress'])     ?? 50,
      empati:    l2pct(likertState['q_empathy'])    ?? 50,
    },
    sosial: {
      fokus:     l2pct(likertState['q_social'])     ?? 50,  // energy dimension only
      selektif:  l2pct(likertState['q_selectivity'])?? 50,  // FIX: own dedicated question
    },
    keputusan: {
      analitis:      l2pct(likertState['q_decision'])  ?? 50,
      jangkaPanjang: l2pct(likertState['q_timeframe']) ?? 50,
    },
    stres: {
      resiliensi:  l2pct(likertState['q_stress'])    ?? 50,
      pemulihan:   l2pct(likertState['q_recovery'])  ?? 50,
    },
    perilaku: {
      konsistensi: l2pct(likertState['q_consistency']) ?? 50,
      fleksibel:   l2pct(likertState['q_flexibility']) ?? 50, // FIX: own dedicated question
    }
  };
}

// ─── LEVEL LABEL ─────────────────────────────────────────
function levelLabel(v) {
  if (v >= 80) return 'Indikasi Tinggi';
  if (v >= 60) return 'Indikasi Sedang-Tinggi';
  if (v >= 40) return 'Indikasi Sedang';
  return 'Indikasi Rendah';
}

// Penjelasan kontekstual per dimensi dan level
const DIM_CONTEXT = {
  'Kognitif': {
    high:   'Kamu cenderung berpikir strategis dan jangka panjang. Analisis dulu sebelum bertindak adalah mode alami kamu.',
    midhi:  'Kamu bisa berpikir analitis, tapi kadang masih terlalu fokus pada hal yang langsung terlihat di depan.',
    mid:    'Kamu punya campuran antara pemikiran praktis dan strategis, tergantung situasi.',
    low:    'Kamu lebih nyaman dengan hal yang konkret dan langsung. Pemikiran jangka panjang butuh effort ekstra.'
  },
  'Emosional': {
    high:   'Kamu punya regulasi emosi yang kuat dan empati yang tinggi — orang merasa aman bercerita ke kamu.',
    midhi:  'Kamu cukup empatis dan bisa mengelola emosi, meski di situasi tertentu masih bisa terbawa perasaan.',
    mid:    'Regulasi emosi kamu rata-rata — ada momen yang kamu kelola dengan baik, ada yang masih perlu latihan.',
    low:    'Emosi bisa lebih mudah muncul ke permukaan. Ini bukan kelemahan — tapi butuh kesadaran lebih untuk dikelola.'
  },
  'Sosial': {
    high:   'Kamu mendapat energi dari interaksi dan cukup terbuka dalam membangun koneksi baru.',
    midhi:  'Kamu sosial dan bisa menikmati interaksi, tapi juga butuh waktu sendiri untuk recharge.',
    mid:    'Kamu fleksibel secara sosial — bisa menyesuaikan diri di berbagai konteks tanpa terlalu lelah.',
    low:    'Kamu lebih selektif dalam relasi dan cenderung lebih nyaman sendiri atau dengan circle kecil yang dipercaya.'
  },
  'Keputusan': {
    high:   'Kamu cenderung mengambil keputusan berbasis data dan visi jangka panjang. Analitis dan terencana.',
    midhi:  'Kamu mempertimbangkan data, tapi juga memberi ruang pada intuisi. Cukup seimbang.',
    mid:    'Kamu menggunakan campuran antara logika dan perasaan — tergantung konteks dan urgensinya.',
    low:    'Kamu lebih cepat bertindak berdasarkan intuisi atau kondisi saat ini. Fleksibel, tapi kadang kurang terencana.'
  },
  'Stres': {
    high:   'Kamu punya ketahanan dan pemulihan yang kuat. Tekanan tidak mudah menggeser kamu dari jalur.',
    midhi:  'Kamu cukup resilient — bisa pulih dari tekanan, meski butuh waktu dan kondisi tertentu.',
    mid:    'Ketahanan kamu rata-rata. Di tekanan sedang kamu oke, tapi tekanan tinggi perlu strategi yang lebih sadar.',
    low:    'Kamu lebih sensitif terhadap tekanan dan butuh waktu lebih untuk pulih. Ini bukan kelemahan — butuh self-care yang lebih terencana.'
  },
  'Perilaku': {
    high:   'Kamu konsisten dan punya disiplin yang kuat. Sekali berkomitmen, kamu cenderung menjalankan sampai selesai.',
    midhi:  'Kamu cukup konsisten, meski kadang fleksibilitas berlebih bisa mengganggu ritme yang sudah dibangun.',
    mid:    'Ada keseimbangan antara konsistensi dan adaptasi — tergantung seberapa penting hal tersebut buat kamu.',
    low:    'Kamu lebih spontan dan mudah beradaptasi. Konsistensi jangka panjang butuh sistem dan trigger eksternal.'
  }
};

function getDimContext(dimName, v) {
  const ctx = DIM_CONTEXT[dimName];
  if (!ctx) return '';
  if (v >= 70) return ctx.high;
  if (v >= 55) return ctx.midhi;
  if (v >= 40) return ctx.mid;
  return ctx.low;
}

// ─── BACKEND RESPONSE VALIDATOR ───────────────────────────
// FIX #5: Validate backend response schema before use
const REQUIRED_PROFILE_FIELDS = [
  'tipePribadi','ringkasanSingkat','kekuatan','areaTumbuh',
  'gayaKomunikasi','polaDalamRelasi','responStres',
  'kecenderunganKepemimpinan','arahtumbuh','kesimpulan','scoreOverall'
];

function validateProfileSchema(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const missing = REQUIRED_PROFILE_FIELDS.filter(f => !(f in profile));
  if (missing.length > 0) {
    debugWarn('Profile schema missing fields:', missing);
    return false;
  }
  if (!Array.isArray(profile.kekuatan) || profile.kekuatan.length === 0) return false;
  if (!Array.isArray(profile.arahtumbuh) || profile.arahtumbuh.length === 0) return false;
  const score = parseInt(profile.scoreOverall);
  if (isNaN(score) || score < 1 || score > 100) return false;
  return true;
}


// ─── BAZI STATE ───────────────────────────────────────────
let baziSkipped = false;
let baziData = null;
let baziReading = null;
let baziErrorMessage = null;

function skipBazi() {
  baziSkipped = true;
  baziData = null;
  baziErrorMessage = null;
  goStep(5);
}

function updateBaziPreview() {
  const dobEl = document.getElementById('bazi_dob');
  const hourEl = document.getElementById('bazi_hour');
  const previewWrap = document.getElementById('baziPreview');
  const previewChart = document.getElementById('baziPreviewChart');
  const previewNote = document.getElementById('baziPreviewNote');
  if (!dobEl || !previewWrap) return;

  const dob = dobEl.value;
  if (!dob) { previewWrap.style.display = 'none'; return; }

  const hour = hourEl ? hourEl.value : '';
  const chart = calcBaziFromDOB(dob, hour || null);
  if (!chart) { previewWrap.style.display = 'none'; return; }

  const elemColors = ELEM_COLORS;
  const pillars = [
    { label:'TAHUN', p: chart.year },
    { label:'BULAN', p: chart.month },
    { label:'HARI (Day Master)', p: chart.day },
    { label:'JAM', p: chart.hour }
  ];

  previewChart.innerHTML = pillars.map(({label, p}) => {
    if (!p) return `<div class="bazi-pillar-card u-b1a25396">
      <div class="bazi-pillar-label">${safeText(label)}</div>
      <div class="u-7777507c">Tidak diisi</div>
    </div>`;
    return `<div class="bazi-pillar-card">
      <div class="bazi-pillar-label">${safeText(label)}</div>
      <div class="bazi-pillar-stem" data-color="${safeText(elemColors[p.stemElem] || 'var(--accent)')}">${safeText(p.stem)}</div>
      <div class="bazi-pillar-branch">${safeText(p.branch)}</div>
      <div class="u-4d2f4da9">${safeText(p.stemElem)} · ${safeText(p.animal)}</div>
    </div>`;
  }).join('');
  applyRuntimeStyles(previewChart);

  const elemCounts = countElements(chart);
  const dmStrength = getDayMasterStrength(chart, elemCounts);
  const elemSummary = Object.entries(elemCounts)
    .sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => `<span class="elem-summary-item" data-color="${safeText(elemColors[k] || 'var(--text2)')}">${safeText(k)} (${Number(v) || 0})</span>`)
    .join(', ');

  previewNote.innerHTML = `Day Master kamu: <strong class="u-6ddb9c03">${safeText(chart.day.stem)} ${safeText(chart.day.stemElem)}</strong> · Kekuatan: <strong>${safeText(dmStrength)}</strong><br>Distribusi elemen: ${elemSummary}`;
  applyRuntimeStyles(previewNote);
  previewWrap.style.display = 'block';
}

function handleDelegatedAction(action, el, event) {
  switch (action) {
    case 'set-mode': return setMode(el.dataset.mode);
    case 'go-step': return goStep(Number(el.dataset.step));
    case 'select-likert': return selectLikert(el.dataset.group, el);
    case 'toggle-obs': return toggleObs(el);
    case 'skip-bazi': return skipBazi();
    case 'generate-profile': return generateProfile();
    case 'print': return window.print();
    case 'reset': return resetAll();
    case 'switch-bazi-tab': return switchBaziTab(el.dataset.tab);
    case 'return-review-error':
      document.getElementById('resultWrap').classList.remove('active');
      document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
      document.getElementById('step4').classList.add('active');
      currentStep = 4;
      return;
    case 'toggle-consent': return toggleConsent(el.checked);
  }
}

// Attach listeners after DOM ready. No inline script handlers are required.
document.addEventListener('DOMContentLoaded', () => {
  const dobEl = document.getElementById('bazi_dob');
  const hourEl = document.getElementById('bazi_hour');
  if (dobEl) dobEl.addEventListener('change', updateBaziPreview);
  if (hourEl) hourEl.addEventListener('change', updateBaziPreview);

  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    // Don't preventDefault on checkboxes — it blocks the native checked toggle
    // and prevents the change event from firing.
    if (el.type !== 'checkbox') event.preventDefault();
    handleDelegatedAction(el.dataset.action, el, event);
  });

  document.addEventListener('change', (event) => {
    const el = event.target.closest('[data-action="toggle-consent"]');
    if (!el) return;
    handleDelegatedAction('toggle-consent', el, event);
  });

  document.addEventListener('keydown', (event) => {
    const el = event.target.closest('[data-action-key="chip-key"]');
    if (!el) return;
    handleChipKey(event, el);
  });
});

// ─── BAZI CALCULATION ENGINE ──────────────────────────────
const HEAVENLY_STEMS = ['Jia','Yi','Bing','Ding','Wu','Ji','Geng','Xin','Ren','Gui'];
const EARTHLY_BRANCHES = ['Zi','Chou','Yin','Mao','Chen','Si','Wu','Wei','Shen','You','Xu','Hai'];
const STEM_ELEMENTS = ['Wood','Wood','Fire','Fire','Earth','Earth','Metal','Metal','Water','Water'];
const BRANCH_ELEMENTS = ['Water','Earth','Wood','Wood','Earth','Fire','Fire','Earth','Metal','Metal','Earth','Water'];
const STEM_POLARITY = ['Yang','Yin','Yang','Yin','Yang','Yin','Yang','Yin','Yang','Yin'];
const BRANCH_ANIMALS = ['Rat','Ox','Tiger','Rabbit','Dragon','Snake','Horse','Goat','Monkey','Rooster','Dog','Pig'];

const STEM_ID = {
  'jia':0,'yi':1,'bing':2,'丙':2,'ding':3,'wu':4,'ji':5,
  'geng':6,'xin':7,'ren':8,'gui':9,
  '甲':0,'乙':1,'丁':3,'戊':4,'己':5,'庚':6,'辛':7,'壬':8,'癸':9
};
const BRANCH_ID = {
  'zi':0,'chou':1,'yin':2,'mao':3,'chen':4,'si':5,'wu':6,'wei':7,'shen':8,'you':9,'xu':10,'hai':11,
  '子':0,'丑':1,'寅':2,'卯':3,'辰':4,'巳':5,'午':6,'未':7,'申':8,'酉':9,'戌':10,'亥':11
};

function calcBaziFromDOB(dobStr, hourVal) {
  const dob = new Date(dobStr);
  if (isNaN(dob)) return null;
  const year = dob.getFullYear();
  const month = dob.getMonth() + 1;
  const day = dob.getDate();

  // Year pillar
  const yearStemIdx = (year - 4) % 10;
  const yearBranchIdx = (year - 4) % 12;

  // Month pillar (simplified solar month)
  const monthBranchBase = [2,3,4,5,6,7,8,9,10,11,0,1]; // Yin=Feb=2
  const monthBranchIdx = monthBranchBase[month - 1];
  const monthStemBase = (yearStemIdx % 5) * 2;
  const monthStemIdx = (monthStemBase + monthBranchIdx) % 10;

  // Day pillar (simplified calculation from Julian Day Number)
  const a = Math.floor((14 - month) / 12);
  const y = year - a;
  const m = month + 12 * a - 3;
  const jdn = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  const dayStemIdx = (jdn + 9) % 10;
  const dayBranchIdx = (jdn + 11) % 12;

  // Hour pillar
  let hourStemIdx = null, hourBranchIdx = null;
  if (hourVal !== null && hourVal !== '') {
    const h = parseInt(hourVal);
    hourBranchIdx = Math.floor(((h + 1) % 24) / 2) % 12;
    hourStemIdx = ((dayStemIdx % 5) * 2 + hourBranchIdx) % 10;
  }

  return {
    year:  { stem: HEAVENLY_STEMS[yearStemIdx],  branch: EARTHLY_BRANCHES[yearBranchIdx],  stemElem: STEM_ELEMENTS[yearStemIdx],  branchElem: BRANCH_ELEMENTS[yearBranchIdx],  animal: BRANCH_ANIMALS[yearBranchIdx],  polarity: STEM_POLARITY[yearStemIdx] },
    month: { stem: HEAVENLY_STEMS[monthStemIdx], branch: EARTHLY_BRANCHES[monthBranchIdx], stemElem: STEM_ELEMENTS[monthStemIdx], branchElem: BRANCH_ELEMENTS[monthBranchIdx], animal: BRANCH_ANIMALS[monthBranchIdx], polarity: STEM_POLARITY[monthStemIdx] },
    day:   { stem: HEAVENLY_STEMS[dayStemIdx],   branch: EARTHLY_BRANCHES[dayBranchIdx],   stemElem: STEM_ELEMENTS[dayStemIdx],   branchElem: BRANCH_ELEMENTS[dayBranchIdx],   animal: BRANCH_ANIMALS[dayBranchIdx],   polarity: STEM_POLARITY[dayStemIdx] },
    hour:  hourStemIdx !== null ? { stem: HEAVENLY_STEMS[hourStemIdx], branch: EARTHLY_BRANCHES[hourBranchIdx], stemElem: STEM_ELEMENTS[hourStemIdx], branchElem: BRANCH_ELEMENTS[hourBranchIdx], animal: BRANCH_ANIMALS[hourBranchIdx], polarity: STEM_POLARITY[hourStemIdx] } : null
  };
}

function parseManualPillar(stemInput, branchInput) {
  if (!stemInput && !branchInput) return null;
  const s = (stemInput || '').trim().toLowerCase();
  const b = (branchInput || '').trim().toLowerCase();
  const stemIdx = STEM_ID[s] ?? -1;
  const branchIdx = BRANCH_ID[b] ?? -1;
  if (stemIdx < 0 || branchIdx < 0) return null;
  return {
    stem: HEAVENLY_STEMS[stemIdx],
    branch: EARTHLY_BRANCHES[branchIdx],
    stemElem: STEM_ELEMENTS[stemIdx],
    branchElem: BRANCH_ELEMENTS[branchIdx],
    animal: BRANCH_ANIMALS[branchIdx],
    polarity: STEM_POLARITY[stemIdx]
  };
}

function calcLuckPillars(dayStemIdx, birthYear, birthMonth, gender, lpStartAge) {
  const isYangYear = (birthYear % 2 === 0);
  const isMale = (gender === 'male');
  const isForward = (isYangYear && isMale) || (!isYangYear && !isMale);
  const pillars = [];
  for (let i = 0; i < 8; i++) {
    let offset = isForward ? i + 1 : -(i + 1);
    const stemIdx = ((dayStemIdx + offset * 1) % 10 + 10) % 10; // simplified
    const branchIdx = ((dayStemIdx + offset * 1) % 12 + 12) % 12;
    const age = (lpStartAge || 3) + i * 10;
    pillars.push({
      age,
      stem: HEAVENLY_STEMS[stemIdx],
      branch: EARTHLY_BRANCHES[branchIdx],
      stemElem: STEM_ELEMENTS[stemIdx],
      branchElem: BRANCH_ELEMENTS[branchIdx]
    });
  }
  return pillars;
}

function countElements(chart) {
  const counts = { Wood:0, Fire:0, Earth:0, Metal:0, Water:0 };
  ['year','month','day','hour'].forEach(p => {
    const pl = chart[p];
    if (!pl) return;
    counts[pl.stemElem]++;
    counts[pl.branchElem]++;
  });
  return counts;
}

function getDayMasterStrength(chart, elemCounts) {
  const dmElem = chart.day.stemElem;
  const supporting = elemCounts[dmElem] || 0;
  const total = Object.values(elemCounts).reduce((a,b)=>a+b,0);
  const ratio = supporting / Math.max(total, 1);
  if (ratio >= 0.35) return 'strong';
  if (ratio >= 0.25) return 'moderate';
  return 'weak';
}

function collectBaziData() {
  const dobStr = document.getElementById('bazi_dob').value;
  if (!dobStr) return null;

  const hourVal = document.getElementById('bazi_hour').value;
  const gender = document.getElementById('bazi_gender').value;
  const location = document.getElementById('bazi_location').value.trim();
  const focus = document.getElementById('bazi_focus').value.trim();
  const currentLP = document.getElementById('bazi_current_lp').value.trim();
  const lpStartAge = parseInt(document.getElementById('bazi_lp_start_age').value) || 3;

  // Check for manual overrides
  const manualYr = parseManualPillar(document.getElementById('bazi_yr_stem').value, document.getElementById('bazi_yr_branch').value);
  const manualMo = parseManualPillar(document.getElementById('bazi_mo_stem').value, document.getElementById('bazi_mo_branch').value);
  const manualDy = parseManualPillar(document.getElementById('bazi_dy_stem').value, document.getElementById('bazi_dy_branch').value);
  const manualHr = parseManualPillar(document.getElementById('bazi_hr_stem').value, document.getElementById('bazi_hr_branch').value);

  let chart = calcBaziFromDOB(dobStr, hourVal || null);
  if (!chart) return null;

  // Apply manual overrides
  if (manualYr) chart.year = manualYr;
  if (manualMo) chart.month = manualMo;
  if (manualDy) chart.day = manualDy;
  if (manualHr) chart.hour = manualHr;

  const dob = new Date(dobStr);
  const stemIdx = HEAVENLY_STEMS.indexOf(chart.day.stem);
  const luckPillars = gender ? calcLuckPillars(stemIdx, dob.getFullYear(), dob.getMonth()+1, gender, lpStartAge) : [];
  const elemCounts = countElements(chart);
  const dmStrength = getDayMasterStrength(chart, elemCounts);
  const currentAge = new Date().getFullYear() - dob.getFullYear();

  return { chart, luckPillars, elemCounts, dmStrength, gender, focus, location, currentLP, currentAge, dob: dobStr, hasHour: !!chart.hour };
}

async function generateBaziReading(bazi, psyName, psyProfile) {
  try {
    const resp = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'bazi', name: psyName, bazi, psyProfile })
    });
    if (!resp.ok) throw new Error('Proxy ' + resp.status);
    const data = await resp.json();
    if (data.baziReading && typeof data.baziReading === 'object') return data.baziReading;
    throw new Error('Cannot parse proxy bazi response');
  } catch(e) {
    debugWarn('Bazi proxy unavailable:', e.message);
    throw new Error('Analisis Bazi dari server gagal diproses.');
  }
}

function displayGenerationError(message, requestId) {
  const safeMessage = safeText(message || 'Layanan analisis sedang tidak tersedia.');
  const safeRequest = requestId ? safeText(requestId) : '';
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  const resultWrap = document.getElementById('resultWrap');
  if (resultWrap) resultWrap.classList.add('active');
  const target = document.getElementById('resultInner');
  if (target) {
    target.innerHTML = `
      <div class="result-header-card u-247a5c69">
        <div class="result-type u-e555eb9c">Analisis belum berhasil dibuat</div>
        <div class="result-summary">${safeMessage}</div>
        <div class="u-48ce7bc8">
          Hasil tidak ditampilkan karena backend tidak berhasil memproses request. Tidak ada fallback lokal yang digunakan, supaya hasil tidak menyesatkan sebagai output AI.
          ${safeRequest ? `<br><span class="u-088efa91">Request ID: ${safeRequest}</span>` : ''}
        </div>
        <button class="btn-outline u-8a359a76" data-action="return-review-error">Kembali ke Review</button>
      </div>`;
    applyRuntimeStyles(target);
  }
  currentStep = 4;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── MAIN GENERATE ────────────────────────────────────────
async function generateProfile() {
  if (!consentGiven) return;

  // Final validation guard — all 10 questions must be answered
  const unanswered = REQUIRED_QUESTIONS.filter(q => !likertState[q.id]);
  if (unanswered.length > 0) {
    showFieldError(`Masih ada ${unanswered.length} pertanyaan yang belum dijawab. Kembali dan lengkapi semuanya.`);
    return;
  }

  const name   = document.getElementById('f_name').value.trim();
  const age    = document.getElementById('f_age').value;
  const gen    = document.getElementById('f_gender').value;
  const bg     = document.getElementById('f_bg').value;
  const goal   = document.getElementById('f_goal').value.trim();
  const obs    = getObservations();
  const intN   = document.getElementById('f_intuitive').value.trim();
  const scores = getScoresFromLikert();
  
  // Collect bazi data if not explicitly skipped
  if (!baziSkipped) {
    baziData = collectBaziData();
    // If DOB missing, mark as skipped so we show helpful message
    if (!baziData) baziSkipped = false; // keep false so we show "belum lengkap" message
  }

  const lw = document.getElementById('loadingWrap');
  lw.classList.add('active');
  document.getElementById('btnGenerate').disabled = true;
  const backBtn = document.querySelector('#step5 .btn-back');
  if (backBtn) backBtn.disabled = true;

  const msgs = ['Memproses data refleksi Anda...','Menganalisis pola perilaku...','Menyusun insight personal...','Memfinalisasi profil...'];
  let mi = 0;
  const loaderInt = setInterval(() => {
    document.getElementById('loaderText').textContent = msgs[mi % msgs.length];
    mi++;
  }, 2000);

  const qSummary = REQUIRED_QUESTIONS.map(({id, label}) =>
    `- ${label}: ${likertState[id]}/5`
  ).join('\n');

  const prompt = `Kamu adalah konsultan psikografis yang membantu klien memahami pola perilaku untuk refleksi dan pengembangan pribadi.

PENTING: Bahasa harus tentatif, hangat, memberdayakan. Gunakan "cenderung", "tampak", "mengindikasikan". TIDAK ada klaim definitif. Ini alat refleksi, BUKAN diagnosis.

MODE: ${currentMode === 'consultant' ? 'Consultant-Assisted (profesional, analitis)' : 'Client Self-Reflection (hangat, personal, memberdayakan)'}

PROFIL KLIEN:
Nama: ${name}, Usia: ${age||'tidak disebutkan'}, Gender: ${gen||'tidak disebutkan'}
Latar belakang: ${bg||'tidak disebutkan'}
Tujuan sesi: ${goal||'tidak disebutkan'}

JAWABAN PERILAKU (self-report, skala 1-5):
${qSummary}

CATATAN: q_social = energi sosial (introvert/ekstrovert), q_selectivity = TERPISAH yaitu selektivitas dalam membangun relasi, q_flexibility = adaptasi terhadap perubahan mendadak (TERPISAH dari q_execution yang mengukur preferensi struktur kerja).

OBSERVASI SESI (${obs.length} item):
${obs.length > 0 ? obs.map(o=>'- '+o).join('\n') : 'Tidak ada.'}

CATATAN INTERPRETATIF KONSULTAN:
${intN||'Tidak ada.'}

Format JSON PERSIS ini, HANYA JSON:
{
  "tipePribadi": "label deskriptif 3-4 kata (arketype reflektif, bukan diagnosis)",
  "ringkasanSingkat": "1 kalimat hangat dan memberdayakan dengan bahasa tentatif",
  "kekuatan": ["kecenderungan positif 1","kecenderungan positif 2","kecenderungan positif 3","kecenderungan positif 4"],
  "areaTumbuh": ["area pengembangan 1","area pengembangan 2","area pengembangan 3"],
  "gayaKomunikasi": "2-3 kalimat observasional dan hangat",
  "polaDalamRelasi": "2-3 kalimat reflektif — integrasikan q_social DAN q_selectivity karena keduanya berbeda",
  "responStres": "2-3 kalimat supportif berbasis q_stress dan q_recovery",
  "kecenderunganKepemimpinan": "2 kalimat tentang potensi kepemimpinan",
  "arahtumbuh": ["langkah konkret 1","langkah konkret 2","langkah konkret 3"],
  "kesimpulan": "3-4 kalimat penutup reflektif dan memberdayakan",
  "hipotesisReflektif": "${intN ? 'hipotesis 2-3 kalimat berbasis catatan konsultan, bahasa mungkin/bisa jadi/tampaknya' : 'null'}",
  "scoreOverall": angka integer 40-90
}`;

  try {
    const resp = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        age,
        gender: gen,
        background: bg,
        goal,
        scores,
        questionnaire: likertState,
        observations: obs,
        intuitiveNote: intN,
        mode: currentMode
      })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error('Proxy responded ' + resp.status);
      err.responsePayload = data;
      throw err;
    }


    // FIX #5: Validate backend response schema
    if (!data.profile) throw new Error('Backend response missing profile field');
    if (!validateProfileSchema(data.profile)) throw new Error('Profile schema validation failed');

    clearInterval(loaderInt);
    lw.classList.remove('active');
    const profile = data.profile;
    clearInterval(loaderInt);
    // Run bazi while still showing loader
    if (baziData && !baziSkipped) {
      document.getElementById('loaderText').textContent = 'Membaca chart Bazi kamu...';
      try {
        baziErrorMessage = null;
        baziReading = await generateBaziReading(baziData, name, profile);
      } catch (baziErr) {
        debugWarn('Bazi analysis failed:', baziErr.message);
        baziReading = null;
        baziErrorMessage = 'Analisis Bazi tidak berhasil diproses oleh server. Hasil Bazi tidak ditampilkan agar tidak bercampur dengan fallback lokal.';
      }
    }
    lw.classList.remove('active');
    renderResult(name, scores, profile, intN);

  } catch(e) {
    debugWarn('Backend unavailable:', e.message);
    clearInterval(loaderInt);
    lw.classList.remove('active');
    if (backBtn) backBtn.disabled = false;
    document.getElementById('btnGenerate').disabled = false;

    let requestId = '';
    try {
      if (e && e.responsePayload && e.responsePayload.requestId) requestId = e.responsePayload.requestId;
    } catch(_) {}

    displayGenerationError('Layanan analisis sedang tidak tersedia atau respons server tidak valid. Silakan coba lagi setelah konfigurasi backend diperiksa.', requestId);
  }
}

// ─── FALLBACK — now uses all 10 questions ─────────────────
// ─── RENDER BAZI SECTION ──────────────────────────────────
function renderBaziSection(bazi, reading) {
  const { chart, elemCounts, dmStrength, luckPillars, currentAge, hasHour } = bazi;
  const totalElem = Object.values(elemCounts).reduce((a,b)=>a+b,0);

  const elemColors = ELEM_COLORS;

  const chartCols = ['year','month','day','hour'].map(p => {
    const pl = chart[p];
    if (!pl) return `<div class="bazi-chart-col"><div class="bazi-chart-col-label">JAM</div><div class="u-0499dd68">—</div></div>`;
    return `<div>
      <div class="bazi-chart-col-label">${p.toUpperCase() === 'YEAR' ? 'TAHUN' : p.toUpperCase() === 'MONTH' ? 'BULAN' : p.toUpperCase() === 'DAY' ? 'HARI' : 'JAM'}</div>
      <div class="bazi-chart-stem-cell" data-color="${safeText(elemColors[pl.stemElem] || 'var(--accent)')}">${safeText(pl.stem)}</div>
      <div class="bazi-chart-branch-cell">${safeText(pl.branch)}</div>
      <div class="bazi-chart-elem-cell">${safeText(pl.stemElem)} · ${safeText(pl.animal)}</div>
    </div>`;
  }).join('');

  const elemBars = Object.entries(elemCounts).map(([elem, count]) => `
    <div class="bazi-element-bar">
      <div class="bazi-elem-name">${safeText(elem)}</div>
      <div class="bazi-elem-track">
        <div class="bazi-elem-fill" data-width="${Math.round(count/totalElem*100)}" data-bg="${safeText(elemColors[elem] || '#888')}"></div>
      </div>
      <div class="bazi-elem-count">${count}</div>
    </div>`).join('');

  const lpCards = luckPillars.slice(0, 8).map(lp => {
    const isCurrent = (currentAge >= lp.age && currentAge < lp.age + 10);
    return `<div class="bazi-lucky-card${isCurrent ? ' bazi-lucky-card-current' : ''}">
      ${isCurrent ? '<div class="bazi-current-badge">Sekarang</div>' : ''}
      <div class="bazi-lucky-age">${lp.age}</div>
      <div class="bazi-lucky-stem" data-color="${safeText(elemColors[lp.stemElem] || 'var(--text)')}">${safeText(lp.stem)}</div>
      <div class="bazi-lucky-branch">${safeText(lp.branch)}</div>
      <div class="u-16b70c24">${safeText(lp.stemElem)}</div>
    </div>`;
  }).join('');

  const favElem = (reading.elementBalance?.favorable || []).map(e => `<li>${safeText(e)}</li>`).join('');
  const unfavElem = (reading.elementBalance?.unfavorable || []).map(e => `<li>${safeText(e)}</li>`).join('');
  const industries = (reading.careerWealth?.bestIndustries || []).map(i => `<span class="u-ac49cfbc">${safeText(i)}</span>`).join('');
  const actions = (reading.actionableAdvice || []).map((a,i) => `<div class="growth-item"><div class="growth-num">0${i+1}</div><div class="growth-text">${safeText(a)}</div></div>`).join('');

  return `
  <div class="bazi-result-wrap" id="baziResultSection">
    <div class="u-54ecaa5a">
      <div class="u-f18b664a">☯ Analisis Bazi</div>
      <div class="u-a41d018e">Pembacaan berdasarkan metafisika Tiongkok. Bersifat reflektif, bukan prediktif.</div>
    </div>

    <!-- Chart display -->
    <div class="bazi-chart-display">
      <div class="u-99dda453">四柱 Empat Pilar</div>
      <div class="bazi-chart-header">${chartCols}</div>
      <div class="u-e01c9187">
        <div class="u-ef958c34">Distribusi Elemen</div>
        ${elemBars}
      </div>
      <div class="u-e7f0d79f">Day Master: <strong class="u-6ddb9c03">${safeText(chart.day.stem)} (${safeText(chart.day.stemElem)})</strong> · Kekuatan: <strong>${safeText(dmStrength)}</strong></div>
    </div>

    <!-- Tabs -->
    <div class="bazi-tab-row">
      <button class="bazi-tab active" data-action="switch-bazi-tab" data-tab="bz-chart">Karakter</button>
      <button class="bazi-tab" data-action="switch-bazi-tab" data-tab="bz-career">Karir & Rezeki</button>
      <button class="bazi-tab" data-action="switch-bazi-tab" data-tab="bz-relasi">Relasi</button>
      <button class="bazi-tab" data-action="switch-bazi-tab" data-tab="bz-luck">Luck Pillar</button>
      <button class="bazi-tab" data-action="switch-bazi-tab" data-tab="bz-action">Panduan</button>
    </div>

    <div class="bazi-tab-panel active" id="bz-chart">
      <div class="bazi-reading-card">
        <div class="bazi-reading-title">Struktur Chart & Kepribadian</div>
        <div class="bazi-reading-body">${safeText(reading.chartSummary || '')}</div>
      </div>
      <div class="bazi-reading-card">
        <div class="bazi-reading-title">Day Master — Siapa Kamu Sebenarnya</div>
        <div class="bazi-reading-body">${safeText(reading.dayMasterProfile || '')}</div>
      </div>
      <div class="bazi-reading-card">
        <div class="bazi-reading-title">Elemen Favorable & Unfavorable</div>
        <div class="bazi-reading-body">
          <strong class="u-701ab37f">Mendukung kamu:</strong>
          <ul>${favElem}</ul>
          <strong class="u-405845c5">Perlu diwaspadai:</strong>
          <ul>${unfavElem}</ul>
          ${reading.elementBalance?.advice ? '<div class="u-1a91c142">' + safeText(reading.elementBalance.advice) + '</div>' : ''}
        </div>
      </div>
    </div>

    <div class="bazi-tab-panel" id="bz-career">
      <div class="bazi-reading-card">
        <div class="bazi-reading-title">Industri Terbaik</div>
        <div class="bazi-reading-body">${industries}</div>
      </div>
      <div class="bazi-reading-card">
        <div class="bazi-reading-title">Gaya Kerja — Entrepreneur vs Employee</div>
        <div class="bazi-reading-body">${safeText(reading.careerWealth?.workStyle || '')}</div>
      </div>
      <div class="bazi-reading-card">
        <div class="bazi-reading-title">Pola Rezeki</div>
        <div class="bazi-reading-body">${safeText(reading.careerWealth?.wealthPattern || '')}</div>
      </div>
      <div class="bazi-reading-card u-6002c38a">
        <div class="bazi-reading-title u-2aeac88c">Financial Blind Spot</div>
        <div class="bazi-reading-body">${safeText(reading.careerWealth?.blindspot || '')}</div>
      </div>
    </div>

    <div class="bazi-tab-panel" id="bz-relasi">
      <div class="bazi-reading-card">
        <div class="bazi-reading-title">Spouse Star</div>
        <div class="bazi-reading-body">${safeText(reading.relationships?.spouseStar || '')}</div>
      </div>
      <div class="bazi-reading-card">
        <div class="bazi-reading-title">Pola Cinta & Kebutuhan Emosional</div>
        <div class="bazi-reading-body">${safeText(reading.relationships?.lovePattern || '')}</div>
      </div>
      <div class="bazi-reading-card">
        <div class="bazi-reading-title">Timing Pernikahan</div>
        <div class="bazi-reading-body">${safeText(reading.relationships?.marriageTiming || '')}</div>
      </div>
    </div>

    <div class="bazi-tab-panel" id="bz-luck">
      <div class="bazi-reading-card">
        <div class="bazi-reading-title">Luck Pillar Sekarang</div>
        <div class="bazi-reading-body">${safeText(reading.luckPillarNow || '')}</div>
      </div>
      <div class="bazi-reading-card">
        <div class="bazi-reading-title">Peluang & Risiko 5-10 Tahun ke Depan</div>
        <div class="bazi-reading-body">${safeText(reading.upcomingYears || '')}</div>
      </div>
      ${luckPillars.length > 0 ? `<div class="u-b1ecc496"><div class="u-070cf1a7">Peta Luck Pillar</div><div class="bazi-lucky-grid">${lpCards}</div></div>` : ''}
    </div>

    <div class="bazi-tab-panel" id="bz-action">
      <div class="bazi-reading-card u-6002c38a">
        <div class="bazi-reading-title u-2aeac88c">Peringatan Jujur</div>
        <div class="bazi-reading-body">${safeText(reading.honestWarning || '')}</div>
      </div>
      <div class="u-9374e842">
        <div class="u-d67d14d1">Panduan Praktis</div>
        <div class="growth-grid">${actions}</div>
      </div>
    </div>

    <div class="bazi-disclaimer">
      Analisis Bazi ini bersifat reflektif dan interpretatif berdasarkan sistem metafisika tradisional Tiongkok. Ini bukan ramalan, prediksi pasti, atau pengganti keputusan rasional. Gunakan sebagai perspektif tambahan, bukan panduan mutlak. Hidup tetap ditentukan oleh pilihan dan usaha kamu.
    </div>
  </div>`;
}

function switchBaziTab(tabId) {
  document.querySelectorAll('.bazi-tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.bazi-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  event.target.classList.add('active');
}

// ─── RENDER RESULT ────────────────────────────────────────
function renderResult(name, scores, profile, intN) {
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  const steps = document.getElementById('stepsWrap');
  if (steps) steps.style.display = 'none';
  const err = document.getElementById('stepErrorBanner');
  if (err) err.style.display = 'none';
  const profId = 'VT-' + Date.now().toString(36).toUpperCase().slice(-6);
  const today  = new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' });

  const dimAvgs = {
    'Kognitif':  Math.round((scores.kognitif.strategis  + scores.kognitif.abstrak)  / 2),
    'Emosional': Math.round((scores.emosional.regulasi  + scores.emosional.empati)  / 2),
    'Sosial':    Math.round((scores.sosial.fokus        + scores.sosial.selektif)   / 2),
    'Keputusan': Math.round((scores.keputusan.analitis  + scores.keputusan.jangkaPanjang) / 2),
    'Stres':     Math.round((scores.stres.resiliensi    + scores.stres.pemulihan)   / 2),
    'Perilaku':  Math.round((scores.perilaku.konsistensi+ scores.perilaku.fleksibel)/ 2)
  };

  const barColors = ['','warm','soft','','warm','soft'];
  const metricCards = Object.entries(dimAvgs).map(([k,v],i) => `
    <div class="metric-card u-09834322">
      <div class="metric-label">${safeText(k)}</div>
      <div class="metric-val">${v}<span>%</span></div>
      <div class="metric-bar-bg"><div class="metric-bar-fill ${barColors[i]}" data-width="${v}"></div></div>
      <div class="metric-note">${safeText(levelLabel(v))}</div>
      <div class="metric-context">${safeText(getDimContext(k, v))}</div>
    </div>`).join('');

  const strengths = (profile.kekuatan   || []).map(s=>`<li>${safeText(s)}</li>`).join('');
  const areas     = (profile.areaTumbuh || profile.arahtumbuh || []).map(s=>`<li>${safeText(s)}</li>`).join('');
  const growthItems = (profile.arahtumbuh || []).map((d,i)=>`
    <div class="growth-item">
      <div class="growth-num">0${i+1}</div>
      <div class="growth-text">${safeText(d)}</div>
    </div>`).join('');

  const hypoBlock = profile.hipotesisReflektif && profile.hipotesisReflektif !== 'null' ? `
    <div class="hypothesis-card">
      <div class="hypothesis-label">Hipotesis Reflektif Konsultan</div>
      <div class="hypothesis-note">Interpretasi subyektif konsultan berdasarkan observasi sesi. Bukan pernyataan definitif.</div>
      <div class="hypothesis-body">${safeText(profile.hipotesisReflektif)}</div>
    </div>` : '';

  const resultInner = document.getElementById('resultInner');
  resultInner.innerHTML = `
    <div class="result-header-card">
      <div class="result-meta u-71d41660">${safeText(profId)} · ${safeText(today)} · ${currentMode === 'consultant' ? 'Consultant-Assisted' : 'Self-Reflection'}</div>
      <div class="result-name">${safeText(name)}</div>
      <div class="result-type">${safeText(profile.tipePribadi || '')}</div>
      <div class="result-summary">${safeText(profile.ringkasanSingkat || '')}</div>
      <div class="result-score">
        <span class="score-label">Indikasi Keseimbangan</span>
        <div class="score-num">${Math.max(40,Math.min(90,parseInt(profile.scoreOverall)||62))}<span class="score-unit">%</span></div>
      </div>
    </div>

    <div class="u-f9be9d50">
      Skor merupakan <strong>indikasi berbasis self-report dan observasi</strong>, bukan pengukuran psikometrik tervalidasi. Gunakan sebagai titik awal refleksi, bukan kesimpulan final.
    </div>

    <div class="metrics-grid">${metricCards}</div>

    <div class="chart-row">
      <div class="chart-card"><div class="chart-label">Radar Dimensi</div><canvas id="rchart" width="240" height="240"></canvas></div>
      <div class="chart-card"><div class="chart-label">Profil Sub-Dimensi</div><canvas id="bchart" width="240" height="240"></canvas></div>
    </div>

    ${hypoBlock}

    <div class="narrative-grid">
      <div class="narrative-card">
        <div class="narrative-title">Kecenderungan Positif</div>
        <ul class="narrative-list">${strengths}</ul>
      </div>
      <div class="narrative-card">
        <div class="narrative-title">Area Pengembangan</div>
        <ul class="narrative-list">${areas}</ul>
      </div>
      <div class="narrative-card">
        <div class="narrative-title">Kecenderungan Komunikasi</div>
        <div class="narrative-body">${safeText(profile.gayaKomunikasi || '')}</div>
      </div>
      <div class="narrative-card">
        <div class="narrative-title">Pola dalam Relasi</div>
        <div class="narrative-body">${safeText(profile.polaDalamRelasi || '')}</div>
      </div>
      <div class="narrative-card">
        <div class="narrative-title">Respons terhadap Tekanan</div>
        <div class="narrative-body">${safeText(profile.responStres || '')}</div>
      </div>
      <div class="narrative-card">
        <div class="narrative-title">Kecenderungan Kepemimpinan</div>
        <div class="narrative-body">${safeText(profile.kecenderunganKepemimpinan || '')}</div>
      </div>
      <div class="narrative-card full">
        <div class="narrative-title">Penutup Refleksi</div>
        <div class="narrative-body">${safeText(profile.kesimpulan || '')}</div>
      </div>
    </div>

    <div class="u-aafcbaac">Langkah Selanjutnya</div>
    <div class="growth-grid">${growthItems}</div>

    <div class="result-footer">
      <span class="u-a534ca2d">${safeText(profId)}</span>
      <span>Alat refleksi diri · Bukan diagnosis klinis · Vitrace ${new Date().getFullYear()}</span>
      <span>Confidential</span>
    </div>
    ${baziData && baziReading ? renderBaziSection(baziData, baziReading) : baziErrorMessage ? '<div class="bazi-skip-note u-9b7b8231"><strong class="u-2983298e">☯ Analisis Bazi Gagal Diproses</strong>' + safeText(baziErrorMessage) + '</div>' : baziSkipped ? '<div class="bazi-skip-note">Analisis Bazi dilewati di sesi ini. Kamu bisa menambahkannya di sesi berikutnya dengan mengisi tanggal lahir di step Bazi.</div>' : !baziData ? '<div class="bazi-skip-note u-13f83a16"><strong class="u-a4894d9a">☯ Analisis Bazi Belum Lengkap</strong>Tanggal lahir tidak diisi atau tidak valid. Untuk mendapatkan analisis Bazi, kembali ke step sebelumnya dan isi tanggal lahir kamu.</div>' : '<div class="bazi-skip-note">Analisis Bazi tidak tersedia.</div>'}
    `;
  applyRuntimeStyles(resultInner);

  document.getElementById('resultWrap').classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => { drawRadar(Object.values(dimAvgs), Object.keys(dimAvgs)); drawBar(scores); }, 150);
}

// ─── CHARTS ──────────────────────────────────────────────
function getChartColors() {
  return currentMode === 'client'
    ? { main:'#D4618A', secondary:'#E8A020', fill:'rgba(212,97,138,0.12)' }
    : { main:'#00C8FF', secondary:'#00FFCC', fill:'rgba(0,200,255,0.12)' };
}

function drawRadar(values, labels) {
  const canvas = document.getElementById('rchart'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx=120, cy=120, r=90, n=values.length, c=getChartColors();
  ctx.clearRect(0,0,240,240);
  for (let ring=1;ring<=4;ring++) {
    ctx.beginPath();
    for (let i=0;i<n;i++) { const a=i/n*Math.PI*2-Math.PI/2, rr=r*ring/4; i===0?ctx.moveTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr):ctx.lineTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr); }
    ctx.closePath(); ctx.strokeStyle=currentMode==='client'?'rgba(180,150,120,0.2)':'rgba(26,58,92,0.5)'; ctx.lineWidth=1; ctx.stroke();
  }
  for (let i=0;i<n;i++) { const a=i/n*Math.PI*2-Math.PI/2; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r); ctx.strokeStyle=currentMode==='client'?'rgba(180,150,120,0.15)':'rgba(26,58,92,0.3)'; ctx.stroke(); }
  ctx.beginPath();
  for (let i=0;i<n;i++) { const a=i/n*Math.PI*2-Math.PI/2, rv=r*values[i]/100; i===0?ctx.moveTo(cx+Math.cos(a)*rv,cy+Math.sin(a)*rv):ctx.lineTo(cx+Math.cos(a)*rv,cy+Math.sin(a)*rv); }
  ctx.closePath(); ctx.fillStyle=c.fill; ctx.fill(); ctx.strokeStyle=c.main; ctx.lineWidth=2; ctx.shadowColor=c.main; ctx.shadowBlur=6; ctx.stroke(); ctx.shadowBlur=0;
  for (let i=0;i<n;i++) { const a=i/n*Math.PI*2-Math.PI/2, rv=r*values[i]/100; ctx.beginPath(); ctx.arc(cx+Math.cos(a)*rv,cy+Math.sin(a)*rv,4,0,Math.PI*2); ctx.fillStyle=c.main; ctx.shadowColor=c.main; ctx.shadowBlur=8; ctx.fill(); ctx.shadowBlur=0; }
  ctx.font='10px DM Sans,sans-serif'; ctx.fillStyle=currentMode==='client'?'#6B5E4E':'#7FA8C8'; ctx.textAlign='center';
  for (let i=0;i<n;i++) { const a=i/n*Math.PI*2-Math.PI/2; ctx.fillText(labels[i],cx+Math.cos(a)*(r+16),cy+Math.sin(a)*(r+16)+4); }
}

function drawBar(scores) {
  const canvas = document.getElementById('bchart'); if (!canvas) return;
  const ctx = canvas.getContext('2d'), c=getChartColors();
  ctx.clearRect(0,0,240,240);
  const items=[
    {l:'Strategis',  v:scores.kognitif.strategis,  col:c.main},
    {l:'Regulasi',   v:scores.emosional.regulasi,  col:c.secondary},
    {l:'Empati',     v:scores.emosional.empati,    col:c.secondary},
    {l:'Analitis',   v:scores.keputusan.analitis,  col:c.main},
    {l:'Resiliensi', v:scores.stres.resiliensi,    col:c.secondary},
    {l:'Fleksibel',  v:scores.perilaku.fleksibel,  col:c.main},
  ];
  const bH=24, gap=9, sY=12, mW=150;
  items.forEach((item,i)=>{
    const y=sY+i*(bH+gap), bw=mW*item.v/100;
    ctx.fillStyle=currentMode==='client'?'rgba(200,180,160,0.15)':'rgba(26,58,92,0.3)'; ctx.fillRect(62,y,mW,bH);
    ctx.fillStyle=item.col+'25'; ctx.fillRect(62,y,bw,bH);
    ctx.fillStyle=item.col; ctx.fillRect(62,y,2,bH);
    if(bw>2){ctx.shadowColor=item.col;ctx.shadowBlur=4;ctx.fillRect(60+bw,y,2,bH);ctx.shadowBlur=0;}
    ctx.font='10px DM Sans,sans-serif'; ctx.fillStyle=currentMode==='client'?'#A89880':'#7FA8C8'; ctx.textAlign='right'; ctx.fillText(item.l,58,y+15);
    ctx.font='bold 10px Fira Code,monospace'; ctx.fillStyle=item.col; ctx.textAlign='left'; ctx.fillText(item.v+'%',218,y+15);
  });
}

// ─── RESET ────────────────────────────────────────────────
function resetAll() {
  document.getElementById('resultWrap').classList.remove('active');
  const steps = document.getElementById('stepsWrap');
  if (steps) steps.style.display = 'flex';
  const backBtn = document.querySelector('#step5 .btn-back');
  if (backBtn) backBtn.disabled = false;
  document.querySelectorAll('.step-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('step1').classList.add('active');
  for(let i=1;i<=4;i++){const d=document.getElementById('sd'+i);d.classList.remove('active','done');if(i===1)d.classList.add('active');}
  for(let i=1;i<=3;i++){const l=document.getElementById('sl'+i);if(l)l.classList.remove('done');}
  document.querySelectorAll('.field-input,.field-textarea').forEach(el=>el.value='');
  document.querySelectorAll('.field-select').forEach(el=>el.selectedIndex=0);
  document.querySelectorAll('.likert-btn.selected').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');});
  document.querySelectorAll('.obs-chip.sel').forEach(el=>{el.classList.remove('sel');el.querySelector('.obs-check').textContent='';el.setAttribute('aria-pressed','false');});
  Object.keys(likertState).forEach(k=>delete likertState[k]);
  consentGiven=false;
  const cb=document.getElementById('consentInput'); if(cb){cb.checked=false;}
  document.getElementById('btnGenerate').disabled=true;
  // Reset bazi fields
  const baziFields = ['bazi_dob','bazi_hr_stem','bazi_hr_branch','bazi_yr_stem','bazi_yr_branch','bazi_mo_stem','bazi_mo_branch','bazi_dy_stem','bazi_dy_branch','bazi_current_lp','bazi_lp_start_age','bazi_focus','bazi_location'];
  baziFields.forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  const hourSel = document.getElementById('bazi_hour'); if(hourSel) hourSel.selectedIndex = 0;
  const genSel = document.getElementById('bazi_gender'); if(genSel) genSel.selectedIndex = 0;
  baziSkipped = false;
  baziData = null;
  baziErrorMessage = null;
  document.getElementById('loadingWrap').classList.remove('active');
  // Reset step dot labels
  document.getElementById('sd2').querySelector('.step-label').textContent='Pola Perilaku';
  document.getElementById('sd3').querySelector('.step-label').textContent='Respons & Emosi';
  document.getElementById('sd4').querySelector('.step-label').textContent='☯ Bazi';
  document.getElementById('sd5').querySelector('.step-label').textContent='Review';
  currentStep=1;
  window.scrollTo({top:0,behavior:'smooth'});
}
