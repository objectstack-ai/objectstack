---
"@objectstack/rest": patch
---

fix(rest): serve canonical ISO-8601 for the import-job DTO's four timestamps on Postgres/MySQL (#13994)

`importJobToProgress` — the mapper behind `GET /data/import/jobs/:jobId`,
`/results` and the history list — rendered `created_at`, `started_at`,
`completed_at` and `reverted_at` through `String(value)`. On Postgres and
MySQL, the production default driver materialises those columns as JS `Date`s,
so `String` ran `Date.prototype.toString` and the REST contract served

```
Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard Time)   <- what the API served
2026-08-30T10:19:25.947Z                                  <- what it promises
```

Milliseconds were dropped, the **server's** timezone was baked into the value,
there was no `Z`, and the result is not `Date.parse`-safe for a client doing
strict ISO parsing. `ImportJobProgressSchema` / `ImportJobSummarySchema`
declare all four as `z.string()` documented "(ISO 8601)", and the client SDK
and objectui's `ImportJobProgressInfo` both restate that as `string` — the
declaration was right, the emitted value was wrong.

Nothing upstream repaired it: `formatOutput`'s two timestamp repairs — the
`AUDIT_TIMESTAMP_COLUMNS` pass and the `normalizeSqliteDatetimeOutput` pass
over `datetimeFields` — both sit inside its `if (this.isSqlite)` arm, so a
declared `Field.datetime` is **not** protected on Postgres/MySQL. SQLite
returns canonical ISO text, where `String()` was an identity — which is why
every SQLite-backed test stayed green for the whole life of the defect.

The four sites now go through the same three-branch normaliser this repo
already landed in `@objectstack/metadata-protocol` (string passthrough →
`instanceof Date` → `toISOString()` → last-resort `String(v ?? '')`): one
spelling repo-wide, no tolerant `??` fallback, and no change to the presence
semantics — a job that has not started still omits `startedAt` entirely.

Values that were already canonical (every SQLite deployment) are returned
byte-identical, so this changes nothing for them; on Postgres and MySQL a
client that parsed the old string leniently now receives the same instant
spelled correctly, with the milliseconds it previously lost.
