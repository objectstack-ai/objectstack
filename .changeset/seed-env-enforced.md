---
'@objectstack/metadata-protocol': patch
---

fix(seed): enforce `Seed.env` — environment-scoped datasets no longer seed everywhere

`Seed.env` was authorable, defaulted and type-checked, but inert. `SeedLoaderService`
filtered on the **loader config's** `env`, and none of the six call sites that build a
`SeedLoaderRequest` (app boot, per-org replay, hot reload, package apply, draft publish,
marketplace install) ever passed one — so `config.env` was always `undefined`, the filter
short-circuited, and `dataset.env` was never read. A dataset marked `env: ['dev']` seeded
into production exactly as if it were marked `['prod']`, which is the dangerous direction:
the rows most likely to carry that marking are demo users, fake customers and seeded
credentials.

The loader now resolves the environment itself, at the one funnel every seeding path goes
through:

- **Source is `NODE_ENV`** — the environment source this repo already uses everywhere
  (`os start` defaults it to `production`, `os dev` / `serve --dev` set `development`,
  vitest sets `test`). No new environment variable and no new authorable key. `production`
  / `development` / `test` and the seed-enum spellings `prod` / `dev` are accepted,
  case-insensitively.
- **An explicit `config.env` still wins**, so a host can seed "as" another environment.
- **A dataset that declares no `env`** (the schema default `['prod','dev','test']`) seeds
  in every environment, exactly as before — no existing deployment loses rows.
- **When the environment cannot be determined** (NODE_ENV unset, or a value like
  `staging`), the loader stays permissive and seeds everything — but logs a **warning**
  naming each environment-scoped dataset, the accepted `NODE_ENV` values and the
  `config.env` escape hatch. Fail-open is deliberate: fail-closed would also drop an
  `env: ['prod']` dataset on a production host that merely forgot to export `NODE_ENV`,
  a silent data-loss regression worse than the over-seeding it prevents.
- **Skipped datasets are always named** in an `info` log, so "my demo rows are missing" is
  one log line to answer rather than a mystery.

The resolved environment is also what seed CEL expressions now bind `env` to, so a seed's
`env` and the loader's filter can no longer disagree.

No API or schema change: `Seed.env` and `SeedLoaderConfig.env` are unchanged, and no
package export was added.
