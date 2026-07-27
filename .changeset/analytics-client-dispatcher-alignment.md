---
"@objectstack/client": patch
"@objectstack/runtime": patch
---

fix(client,runtime): analytics.meta/explain now call routes that actually exist (#3584)

The route audit (#3563) ledgered four dispatcher↔client shape mismatches.
Re-verification showed the two analytics shapes the client spoke —
`GET /analytics/meta/:cube` and `POST /analytics/explain` — were served by
**nothing**: not the dispatcher, not `@objectstack/rest`, not
`service-analytics`. Both methods 404ed against every deployment.

- `analytics.meta(cube?)` — FROM `GET /analytics/meta/:cube` TO
  `GET /analytics/meta[?cube=<name>]`. The cube argument is now optional; when
  given, the dispatcher threads it into `AnalyticsService.getMeta(cubeName?)`,
  which always supported the filter. Responses now use the dispatcher envelope
  (`{ success, data }`).
- `analytics.explain(payload)` — FROM `POST /analytics/explain` TO
  `POST /analytics/sql` (the dispatcher's SQL dry-run route, backed by
  `generateSql`). Method name unchanged.

No migration is expected in practice: a method that unconditionally 404ed can
have no working callers (none exist in objectstack or objectui). Anyone who
had hand-rolled fetches against the imaginary shapes should switch to the
routes above.

The two storage rows from the same audit are deliberately NOT reshaped: the
presigned/chunked protocol the SDK speaks is registered autonomously by
`service-storage` on any http-server and stays canonical; the dispatcher's
bare `POST /storage/upload` / `GET /storage/file/:id` are reclassified in the
route ledger as a `server-only` low-level compat surface.
