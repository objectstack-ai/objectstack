# Build & Test — the explanations behind the rules

Companion to [`AGENTS.md` › Build & Test](../../AGENTS.md#build--test). Every paragraph below moved here
verbatim out of that section (ruling record 6417533492, letter A: the mechanism prose moves, each rule stays in
`AGENTS.md` as one executable sentence plus a pointer here). `AGENTS.md` is the authority: it carries every rule,
and where a paragraph below reads as a rule, the sentence in `AGENTS.md` is the binding spelling. To pull a
paragraph back, edit `AGENTS.md` (a governed surface, Tier H) and delete it here in the same PR, so the text
exists in exactly one place.

## Why a test the `tsconfig.json` misses is hidden

← [`AGENTS.md` › Build & Test](../../AGENTS.md#build--test)

`tsc --noEmit` reads that config, so a test it misses is hidden from the very check
  the `typecheck` script advertises. `check:type-check-coverage` fails both spellings
  per file: an `exclude` naming it, an `include` that never does.

## TS7006 piles: the missing `.js` extension

← [`AGENTS.md` › Build & Test](../../AGENTS.md#build--test)

under `moduleResolution: NodeNext` a relative import
  missing its `.js` extension does not resolve and every symbol it names becomes
  `any`.

## Why the cross-package gate needs a spelling it knows

← [`AGENTS.md` › Build & Test](../../AGENTS.md#build--test)

`pnpm check:cross-package-test-inputs` keeps CI's idea of a test's inputs equal to its
real inputs: a test whose reads escape its package is invisible to both
`turbo ls --affected` and the `test` task's input hashing, so a pin written to catch
cross-package drift sits green through exactly the drift it exists to catch. The gate
finds those tests by scanning source text, so it sees only the spellings it knows, and an
unrecognised one produces no flag — no declaration, silently.

## What the cross-package gate deliberately does not flag

← [`AGENTS.md` › Build & Test](../../AGENTS.md#build--test)

Two things it deliberately does not flag: a path that climbs out and lands in
`node_modules` (an installed dependency is not a repo source input), and a path that
climbs out and comes straight back in. What it does flag is judged on the **shallowest**
point a path reaches, not where it ends.

## What the fresh flag seeds

← [`AGENTS.md` › Build & Test](../../AGENTS.md#build--test)

`--fresh`: ephemeral tempdir (auto-deleted on exit) + `--seed-admin` (POSTs sign-up, prints creds — default
`admin@objectos.ai` / `admin123`, override via `--admin-email`/`--admin-password`). The seeded admin is auto-promoted to
**platform admin** (the system seed identity `usr_system` is skipped), so Setup/Studio are reachable on first login.

## Why the separator works for dev scripts and not for vitest

← [`AGENTS.md` › Build & Test](../../AGENTS.md#build--test)

pnpm forwards the `--` separator itself into the child's argv, so this spelling only works
where the receiving CLI tolerates a leading `--`.

## The SDUI manifest in CI

← [`AGENTS.md` › Build & Test](../../AGENTS.md#build--test)

CI's `Build & E2E UI` runs it too and fails
when the committed `sdui.manifest.json` differs, the merge queue's combined tree included, and the console build
ships that same tracked file in `packages/console/dist/`.

## Which console `:3001/_console` serves

← [`AGENTS.md` › Build & Test](../../AGENTS.md#build--test)

Note `:3001/_console` (or whatever the backend serves) is the **built** console, not
your `ui/` src — only `:5180` reflects local UI edits.
