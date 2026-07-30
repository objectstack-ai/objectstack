---
"@objectstack/cli": patch
---

fix(cli): the boot merge no longer discards the authored `api` block (#4002)

`objectstack serve` (and `dev`, which spawns it) assembled the effective config as
`{ ...authored, ...bootResult }`. `createStandaloneStack()` /
`createDefaultHostConfig()` return an `api` block carrying only the
environment-scoping decision — `{ enableProjectScoping: false, projectResolution:
'none' }` — and under a shallow spread that object REPLACED the author's entire
`api`, silently dropping every key it did not itself set.

Two of those keys are live knobs the CLI reads a few lines later:

- **`api.requireAuth`** — the documented one-line opt-out for serving data
  publicly (ADR-0056 D2; the v12 migration note presents it as the whole
  migration). Authoring it did nothing: the value never reached the REST or
  dispatcher plugin, so anonymous requests kept getting `401` **and** the boot
  warning that exists to make a fail-open posture visible never fired either.
- **`api.enforceProjectMembership`** — the ADR-0024 D9 opt-out from the
  `sys_environment_member` 403 gate. Silently fell back to the dispatcher default.

`api` now merges per key, via a small pure `mergeBootConfig` helper: the author's
declarations survive, and the boot builder still wins on the keys it actually
decides (environment scoping is not the author's call on a standalone host).
Every other top-level key keeps the previous whole-value semantics — the
artifact-serve path deliberately serves the boot result's `objects` /
`permissions` / `manifest` / `plugins`, so those are untouched.

The auth-less carve-out was never affected and is unchanged: it lives in the
`?? ((tierEnabled('auth') || hasAuthPlugin) ? true : false)` fallback, which fired
precisely *because* the authored value had gone missing. Only an explicitly
authored value was lost.

Verified end to end: with `api: { requireAuth: false }` on the CRM example, an
anonymous `POST /data/crm_account/query` returned `401` before and returns records
after. Worth knowing what the working flag does — the same anonymous caller can
then read `sys_user` — which is the flag's documented meaning ("serve data
publicly"), and the argument for retiring it (#3963).
