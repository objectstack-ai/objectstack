---
'@objectstack/platform-objects': patch
'@objectstack/plugin-security': patch
'@objectstack/studio': patch
'@objectstack/setup': patch
'@objectstack/spec': patch
'@objectstack/cli': patch
---

Point every runtime-emitted documentation URL at the canonical host, and retarget the
metadata-protection `docsUrl` at a page that actually exists.

Two defects, one string. The host half: `docs.objectstack.ai` is an alias that redirects
to `https://objectstack.ai` path-preservingly, so nothing here was a broken link — it was
the unratified spelling sitting in the places a user copies from. The CLI's spec-version
advisory, the Setup and Studio in-app overview pages (English and Chinese alike), and a
showcase demo action now all name the canonical host.

The path half is the real fix. All 29 `protection.docsUrl` values on the platform's
system objects and apps pointed at `/adr/0010-metadata-protection`, and `/adr/...` is not
a route on any host: the docs site mounts `content/docs` under `/docs`, `docs/adr/` is
not published, and no redirect source lives outside the `/docs` space. The slug was wrong
too — the record is `0010-metadata-protection-model.md`. Studio renders this URL as a
link in the lock banner, so an operator asking why an item is locked was being sent
nowhere. They now point at `https://objectstack.ai/docs/references/shared/protection`,
the published reference for the very schema that carries the field.
