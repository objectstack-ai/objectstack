---
"@objectstack/cli": minor
---

fix(cli): `os serve` defaults `NODE_ENV` to `production` when unset, exactly as `os start` already does (#11113)

**BREAKING for a deployment that runs `os serve` with `NODE_ENV` unset and
relies on a development-class convenience surviving into a real boot.**
Shipped as `minor` under the repo's launch-window convention for breaking
changes, not `patch` — this is a deliberate default flip, not a bugfix that
restores previously-intended behaviour.

`os start` has forced `NODE_ENV='production'` on the unset case since #5673,
but it does so on the child environment it assembles for its **spawn**
(`start.ts:347`). `os serve` runs **in-process** — there was no equivalent
write, so the whole family of `NODE_ENV !== 'production'` gates across the
tree read the raw `undefined` and took the non-production branch on a boot
that never declared itself anything else. Filed as #11113, the declared
residual of #10366 (which closed the same gate's *set-but-wrong* case and
left this one for its own card, per the disposition precedent on #11035).

One line: `serve.ts` now defaults `process.env.NODE_ENV` to `'production'`
when unset, at the same point it already defaults it to `'development'` under
`--dev` — before any of the runtime modules it dynamically imports, and before
every gate downstream reads the variable. An explicitly-set `NODE_ENV`
(`development`, `test`, anything else) is never overridden.

The full behaviour-flip survey — every `NODE_ENV`-reading predicate in the
tree, which ones flip and which don't, and why — is in the PR body (#11113),
not repeated here. Highlights of what an unset-`NODE_ENV` `os serve` boot now
gets, that it did not before:

- plugin-auth's localhost trusted-origin CSRF substitution closes (the
  regression this card pins).
- plugin-auth's CSRF Origin/Referer synthesis for headerless requests closes.
- plugin-auth's missing-`OS_AUTH_SECRET` fallback to a forgeable
  `dev-secret-<timestamp>` becomes a refusal to boot instead.
- plugin-auth stops printing invitation / magic-link URLs and OTP codes to
  logs.
- plugin-dev's ADR-0115 D6 boot guard now refuses to initialize the dev
  assembly (well-known auth secret, seeded dev admin) instead of loading it.
- the SQL driver's auto-DDL guard stops silently applying `safe` schema drift.
- the seed loader stops seeding dev-scoped datasets into what it previously
  could not tell apart from production.
- service-settings' local crypto provider now requires a stable key instead
  of tolerating an auto-generated / ephemeral one.

Every one of those is the intended tightening this card exists to make: an
operator (or an AI-authored deploy script) that never exported `NODE_ENV` is
running a real deployment, and the safe direction is to treat it as one, loud
failures included, rather than silently keep a development-class door open.
`NODE_ENV=development` / `NODE_ENV=test` — including the flows `os dev` and
`os serve --dev` already carry — are unaffected; only the unset case moves.

<!-- adr-0087: not-required (no-migration-prescription) — this changes a CLI
runtime DEFAULT, not an authorable metadata contract. There is no
`packages/spec` schema key, no declared shape, and no spelling for
`objectstack migrate meta` to rewrite: an operator's config and metadata are
byte-identical before and after. The only actionable step for anyone who is
relying on the previous default is operational (set `NODE_ENV` explicitly),
not a metadata migration, so there is nothing for the ADR-0087 ledger to
register. -->
