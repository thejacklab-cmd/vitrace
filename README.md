# Vitrace

Vitrace is a static Netlify app with one serverless API endpoint for AI-assisted psychographic reflection and Bazi-style reflective reading.

## Local check

```bash
npm install
npm run check
```

## Run locally with Netlify

```bash
npm install
cp .env.example .env
# Fill ANTHROPIC_API_KEY in .env
npm run dev
```

## Production deploy

Required environment variable:

```bash
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

Recommended:

```bash
ALLOWED_ORIGINS=https://your-domain.com
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ALLOWED_ANTHROPIC_MODELS=claude-sonnet-4-20250514,claude-3-7-sonnet-20250219,claude-3-5-sonnet-20241022,claude-3-5-haiku-20241022
```

The public route is:

```text
/api/analyze
```

Netlify redirects it to:

```text
/.netlify/functions/analyze
```

## Security notes

This bundle includes fail-closed CORS handling, origin rejection, request validation, payload limits, best-effort rate limiting, model allowlisting, output schema validation, sanitized upstream errors, structured logs, no silent frontend fallback, externalized frontend JavaScript, and Netlify security headers.

For a fully public high-traffic site, add distributed rate limiting or WAF protection.
