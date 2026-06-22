---
"@objectstack/driver-sql": minor
"@objectstack/cli": minor
"@objectstack/rest": patch
---

Schema drift detection + `os migrate` for non-additive metadata changes (#2186).

The metadata→DB schema sync was additive-only: it created tables and added
columns but never altered/dropped existing ones, so relaxing `required`,
changing a type/length, or dropping a field silently diverged from an existing
database. The physical column won at write time, surfacing a misleading
`organization_id is required` 400 even though `/meta` reported the field
optional.

- **driver-sql** — the SQL driver now detects managed-schema drift (metadata is
  the source of truth) and categorises each divergence `safe` / `needs_confirm`
  / `destructive`. `initObjects` warns once per divergence with an actionable
  hint. A new opt-in `SqlDriverConfig.autoMigrate: 'safe'` auto-applies the
  *loosening* subset (relax `NOT NULL`, widen varchar) so an existing dev DB
  self-heals on restart — never destructive, force-disabled under
  `NODE_ENV=production`. New public methods `detectManagedDrift()` /
  `applyMigrationEntries()`. SQLite reconciles via the official table-rebuild
  (copy → swap), preserving data; Postgres/MySQL alter in place.
- **cli** — new `os migrate plan` (dry-run, categorised diff) and
  `os migrate apply` (`--allow-destructive` for drops/tightenings, confirm gate,
  `--json`). `os dev`/`serve` now pass `autoMigrate: 'safe'` in dev only.
- **rest** — a `NOT NULL` violation that reaches the driver (metadata validation
  already passed) now carries a drift-aware `hint` pointing at `os migrate`,
  instead of only the misleading "field is required" message. The
  `VALIDATION_FAILED` / `fields` envelope is unchanged for back-compat.
