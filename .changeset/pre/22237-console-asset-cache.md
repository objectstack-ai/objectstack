---
"@objectstack/cli": patch
---

The Console served at `/_console/` now tells the browser how long it may keep each file, so a self-hosted console load stops downloading the whole SPA again on every visit.

Clause-②: no

- **Content-hashed build outputs** (a file directly under `assets/` named `name-hash.ext`, the hash being Vite's 8-character one) are sent with `cache-control: public, max-age=31536000, immutable`. A rebuild that changes the bytes emits a new name, so the browser never needs to ask again. Before this change, every non-HTML file was sent with a `content-type` and nothing else, so the browser could reuse none of the roughly 2,450 chunks.
- **Every other non-HTML file** gets `cache-control: public, max-age=300` and an `etag` computed from the file's bytes, and a matching `If-None-Match` is answered with `304` and no body. This covers the two stable-named maplibre files objectui copies into `assets/` (`maplibre-gl-worker.mjs`, `maplibre-gl-shared.mjs`) and the root files such as `favicon.svg` and `manifest.json`. These names can carry different bytes in the next console release, so they are never marked `immutable`. The `etag` is computed from the bytes, not the file's modification time, because a console dist extracted with `tar` gives every file the same fixed mtime.
- **HTML is unchanged**: the shell, a direct `index.html` and the SPA fallback are still rewritten per request and carry no lifetime.
