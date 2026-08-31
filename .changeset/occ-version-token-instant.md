---
"@objectstack/metadata-protocol": patch
---

Fix optimistic concurrency raising a false `409 CONCURRENT_UPDATE` on every guarded save against a `Date`-returning driver (Postgres, MySQL, MongoDB).

The OCC gate read the record's `updated_at` through `String(v)`. On Postgres that value is a JS `Date`, so the comparison ran against `"Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard Time)"` — milliseconds dropped, process timezone baked in — while the client echoed back the `"2026-08-30T10:19:25.947Z"` its own GET had served. One instant, two spellings, strict string compare: every guarded `PATCH` / `DELETE` conflicted, including on records nobody had ever touched, which made the Console's record-edit dialog unusable on the production default driver. SQLite stores and returns canonical ISO text, so both sides matched by accident and development environments never saw it.

Both tokens are now normalised to one representation — a canonical absolute instant — before they are compared, and the `currentVersion` a 409 publishes is that same canonical instant, which is what `content/docs/api/wire-format.mdx` documents the field to be and what the conflict dialog echoes back as its next `If-Match`.

The change is strictly widening: a token accepted before is still accepted (a pair whose verbatim spellings were equal still compares equal, and when either side is not an instant the verbatim comparison is what runs), so a client mid-upgrade still holding a pre-fix 409's token is not locked out. Only two spellings of the same instant change verdict — from conflict to match. Conflicts between genuinely different versions are unchanged, down to the millisecond, and the verdict no longer depends on the process `TZ`.
