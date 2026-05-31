# Vitrace — Deploy Guide

## Struktur Folder

```
vitrace/
├── index.html                    ← app utama
├── netlify.toml                  ← konfigurasi Netlify
├── package.json                  ← dependencies
├── netlify/
│   └── functions/
│       └── analyze.js            ← proxy ke Anthropic API
└── README.md
```

---

## Cara Deploy ke Netlify

### Opsi A — Via GitHub (Rekomendasi)

1. **Buat repo GitHub baru** (private atau public)

2. **Push semua file ini ke repo:**
   ```bash
   git init
   git add .
   git commit -m "init vitrace"
   git remote add origin https://github.com/USERNAME/vitrace.git
   git push -u origin main
   ```

3. **Connect ke Netlify:**
   - Buka [netlify.com](https://netlify.com) → Add new site → Import from Git
   - Pilih repo yang baru dibuat
   - Build command: *(kosongkan)*
   - Publish directory: `.`
   - Klik **Deploy site**

4. **Set API Key:**
   - Di Netlify dashboard → Site configuration → Environment variables
   - Klik **Add variable**
   - Key: `ANTHROPIC_API_KEY`
   - Value: *(isi dengan API key dari [console.anthropic.com](https://console.anthropic.com))*
   - Klik **Save** → lalu **Trigger deploy** agar env var aktif

---

### Opsi B — Netlify CLI (Langsung dari Terminal)

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Install dependencies
npm install

# Login ke Netlify
netlify login

# Deploy ke production
netlify deploy --prod
```

Lalu set env var:
```bash
netlify env:set ANTHROPIC_API_KEY sk-ant-xxxxxxxxxxxxx
netlify deploy --prod
```

---

## Cara Dapat API Key Anthropic

1. Buka [console.anthropic.com](https://console.anthropic.com)
2. Login atau buat akun
3. Masuk ke **API Keys** → **Create Key**
4. Copy key-nya (hanya tampil sekali)
5. Paste ke Netlify environment variable

---

## Testing Lokal

```bash
npm install
netlify dev
```

Buka `http://localhost:8888` — Netlify CLI otomatis menjalankan function lokal juga.

Untuk testing dengan API key lokal, buat file `.env`:
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
```

---

## Catatan

- Aplikasi tetap berjalan tanpa backend (mode fallback lokal untuk bazi)
- API key **tidak pernah** terekspos ke client/browser — hanya ada di server function
- Setiap request ke `/api/analyze` diproses di server Netlify, bukan di browser user
