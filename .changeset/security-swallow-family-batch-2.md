---
"@objectstack/plugin-security": patch
---

fix(plugin-security): count and report the refused writes seven `catch {}` sites swallowed (#12981)

Batch 2 of the ruled `catch { return null; }` worklist. The census instrument
that landed with batch 1 (`scripts/measure-durability-swallow-family.mjs`)
named seven tier-1 DARK sites in this package; all seven are repaired here, and
a re-run moves tier 1 from **28 sites in 14 files to 21 in 11** while
`channelled` rises **19 → 26** — the seven, moved, nothing else touched.

Each site swallowed a refused write into a bare `catch`, so a pass in which the
store refused **everything** returned counts identical to a pass with nothing to
do — and in two of the three files the summary log is suppressed on exactly
those counts, so the one boot that needed a line printed none. The refusals are
now recorded through the in-package accumulator, reported **once** per pass with
the consequence and the remedy, and the `> 0` summary suppressors are widened.

- **`bootstrap-system-capabilities.ts`** — a refused `sys_capability` insert on
  the *derived* half reached no counter and no log at all, and a refused
  *update* was silent on both halves, while the boot went on logging "system
  capabilities seeded" at `info` over zero landed rows. Reported on the
  durability channel (`error`, falling back to `warn`), stating what is actually
  lost: registry state, not authorization — grants resolve capabilities by name,
  not by row.
- **`cleanup-package-permissions.ts`** — ADR-0090 D5 promises that uninstalling
  a package "revokes it everywhere at once. No ghost grants." A refused deletion
  left the grant live while the package door answered `success`, and the
  all-zero outcome was the same one an uninstall of a package that granted
  nothing returns.
- **`suggested-audience-bindings.ts`** ×4 — refused create / confirm / prune /
  reap. The insert site previously filed **every** failure under its documented
  "unique-index race — benign" rationale; the shared accumulator classifies with
  the shipped `isUniqueViolationError` predicate, so the genuine race is still
  treated as benign and excluded, while store outages are counted and reported.

`PackagePermissionCleanupOutcome`, `SuggestionSyncOutcome` and
`CapabilitySeedResult` gain a `refused` count (additive; they are returned, not
constructed by callers).

⚠️ Two of the three files keep their report at `warn` rather than `error`. Their
sinks ride on types exported from this package's `index.ts` that declare `warn`
optional, and adding `error?` would enrol them into
`check:optional-error-sink-contract`'s population, which requires a
non-optional `warn` — a published-shape break, and a contract call above this
repair. The **silence** is what is fixed here and it needed no contract; the
**level** is recorded on #12981.

⛔ No entry was added to `scripts/durability-degradation.baseline.json` and the
gate vocabulary is untouched in either direction, as the 2026-08-29 ruling
requires until the family is repaired.

⭐ One file outside the package changed, declared on #12981 before editing:
`scripts/measure-durability-swallow-family.mjs` (the census instrument, wired
into no workflow) pinned its `dark` positive control to
`bootstrap-system-capabilities.ts` — one of the seven — so repairing it turned
the instrument's own `--self-test` red. The control now names
`plugin-sharing`'s `share-link-service.ts`, which batch 1 judged permanently
OUT of the programme (a `use_count` telemetry stamp), because any tier-1 DARK
member still ON the worklist is a control the programme is designed to destroy.
No predicate, tier or vocabulary change; `--self-test` is green.
