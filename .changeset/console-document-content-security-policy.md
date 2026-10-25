---
'@objectstack/cli': patch
---

feat: the Console document is served with a nonce-based content-security-policy

Clause-②: no
Metadata-protocol: none

Every HTML answer under `/_console/` (`os serve`, and so `os dev`, `os start` and the Docker image, which all run it) now carries a `content-security-policy` header. Each response draws a fresh nonce, and every `<script>` the Console build ships, plus the server's own react-pages disable script, is stamped with it. Other scripts may load only from the server's own origin.

The policy, and why each part is there:

- `script-src 'self' 'nonce-…' 'wasm-unsafe-eval'`. WebAssembly compilation is for the AI chat's code highlighter. `'unsafe-eval'` is added only while the `kind:'react'` page tier is on (ADR-0081, on unless `OS_PAGE_REACT=off`), because that runtime evaluates page source.
- `style-src 'self' 'unsafe-inline'`, for inline styles written by the UI libraries at run time.
- `img-src 'self' data: blob: https:`, for branding, avatars and image fields hosted elsewhere.
- `connect-src 'self'`, plus the default map style's host, plus the error-reporting endpoint's origin when the runtime serves a DSN.
- `object-src 'none'`, `base-uri 'self'`, and `frame-ancestors 'self'`. The public form page (`/_console/f/<slug>`) is the exception to `frame-ancestors`, because authors embed it on other sites.

What an operator may notice:

- **A map view whose `mapStyle` names another host** is refused that host until the operator lists it. Name it in the new `OS_CONSOLE_CSP_CONNECT_SRC`, a space-separated list of sources such as `https://tiles.example.com`. A malformed entry stops the server at boot with a message naming it.
- **Framing the Console from another origin is refused.** The public form page is the exception.
- **The Studio's code editor** loads its editor core from a public CDN, which the policy does not list. It shows its built-in plain-text editor instead.
