---
"@objectstack/cli": minor
"@objectstack/spec": patch
---

feat(cli): liveness author-warning lint — close the spec-liveness loop on the author side.

The liveness ledgers already classify every authorable property live/experimental/dead with evidence, and the CI gate enforces classification *completeness* — but that knowledge never reached the person (very often an AI) writing the metadata. The new `compile` lint (`lint-liveness-properties.ts`) reads the ledgers and emits an advisory **warning** when an authored object/field sets a property that is misleading at runtime — e.g. `object.enable.feeds` (no feed runtime; comments live on sys_comment), `object.versioning` (no versioning engine), `field.columnName` (driver ignores it; column == field key), `field.maxRating`/`vectorConfig` (renderer reads a different key) — each with a corrective hint toward the supported alternative. Never fails the build (advisory only), consistent with the existing flow anti-pattern lint.

Signal-over-noise by design: warnings are **opt-in per ledger entry** via a new `authorWarn`/`authorHint` annotation (plus `experimental` entries warn by default). Booleans warn only when set truthy, and only `default(false)` flags are marked, so schema defaults (`enable.trash`, `enable.searchable`) never trip it. Coverage grows by annotating more ledger entries, not by changing lint code; today it covers `object` (incl. `enable.*`) and `field`.

- `@objectstack/spec`: ledger entries gain optional `authorWarn`/`authorHint`; `liveness/` is now shipped in the package `files` so the CLI can read it. Seeded annotations on the misleading object capability flags + aspirational blocks and the misleading dead field props. No schema/runtime change.
