# Vitrace Production Notes

## What was hardened

- Fixed CORS preflight handling: `OPTIONS` is handled before method rejection.
- Hardened CORS fail-closed behavior: unmatched origins now receive `Access-Control-Allow-Origin: null`, and `POST` requests from disallowed origins are rejected with `403`.
- Added configurable CORS allowlist via `ALLOWED_ORIGINS`.
- Added payload-size guard and text-field sanitization.
- Moved final prompt construction to the Netlify function. The browser now sends structured data instead of a full prompt.
- Added backend validation for questionnaire values and response schema.
- Added best-effort IP rate limiting for warm Netlify function instances.
- Removed upstream error details from client responses.
- Added request IDs and structured logs for debugging.
- Removed silent local fallback for the main psychographic analysis. If the backend fails, the UI now shows a clear error instead of rendering a misleading non-AI result.
- Bazi no longer silently falls back to the local engine if the backend fails; it shows a visible Bazi-specific error while preserving the main profile if available.
- Moved frontend JavaScript to `assets/app.js` and removed inline event handlers, allowing `script-src 'self'` without `unsafe-inline`.
- Added Netlify security headers: CSP, frame blocking, no-sniff, HSTS, permissions policy, referrer policy.
- Added deployment scripts and pinned dependency version.

## Required Netlify environment variables

Set this in Netlify > Site configuration > Environment variables:

```bash
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

## Recommended production environment variables

```bash
ALLOWED_ORIGINS=https://your-domain.com
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ALLOWED_ANTHROPIC_MODELS=claude-sonnet-4-20250514,claude-3-7-sonnet-20250219,claude-3-5-sonnet-20241022,claude-3-5-haiku-20241022
RATE_LIMIT_MAX=12
RATE_LIMIT_WINDOW_MS=60000
MAX_BODY_BYTES=12000
```

## Deploy steps

1. Upload this folder/ZIP to a Git repository or Netlify drag-and-drop deploy.
2. Set `ANTHROPIC_API_KEY` in Netlify environment variables.
3. Set `ALLOWED_ORIGINS` to your real production domain.
4. Deploy.
5. Test `/api/analyze` from the UI.

## Remaining recommendations for 9+/10 at scale

The included rate limit is best-effort only because Netlify functions are stateless across cold starts and regions. For public/high-traffic production, add one of these:

- Cloudflare WAF/rate limiting in front of Netlify.
- Netlify Edge Function rate limiting.
- Upstash Redis-based distributed rate limiting.
- Bot protection such as Cloudflare Turnstile.

Also consider adding CI, browser E2E tests, and real monitoring for latency, error rate, and token usage.


## Security notes after second hardening pass

- `script-src` and `style-src` no longer use `unsafe-inline`. Static CSS is externalized in `assets/styles.css`; dynamic visual values are applied through controlled runtime DOM style assignment.
- The Netlify in-memory rate limiter remains best-effort. For serious public traffic, use Cloudflare/Netlify Edge/Upstash Redis because function memory is not shared across cold starts or regions.
- Browser console warnings are now gated behind localhost-only debug mode.
- The backend validates `ANTHROPIC_MODEL` against `ALLOWED_ANTHROPIC_MODELS` or the built-in allowlist before calling Anthropic.


## v3 Hardening Notes

- Schema validation failures now return HTTP 422 instead of HTTP 200, so frontend error handling follows normal `!resp.ok` flow.
- CSP no longer allows inline scripts or inline styles: `script-src 'self'` and `style-src 'self' https://fonts.googleapis.com`.
- Static inline styles were extracted into `assets/styles.css`; runtime dynamic values use controlled DOM style assignment through `data-*` attributes and `applyRuntimeStyles()`.
- Requests without an `Origin` header are intentionally treated as same-origin/server-to-server calls. For public deployments that should reject non-browser clients, add WAF/API-gateway rules or require an application-level token.
