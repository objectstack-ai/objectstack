---
"@objectstack/cli": patch
---

fix(cli): `os serve` / `os dev` / `os build` / `os migrate` resolve `packages[]` when a stack carries no flattened top level

The CLI holds four independent config-load boundaries, and every read of a
package-owned collection behind them was an inline expression against the
FLATTENED top level. A multi-package stack that carries each definition once
under `packages[]` — the shape ADR-0130 D4's option B produces — reached those
expressions with the key simply absent, and nothing threw:

- `os serve` / `os dev` auto-register the ObjectQL engine and the storage driver
  when the stack declares objects. Both gates read `config.objects`, so the app
  booted with **no query engine and no storage driver** and reported healthy.
  Nothing between the artifact and the gate could notice: the standalone stack
  omits the `objects` key entirely when the array is absent rather than setting
  `[]`, and the boot-config merge is a plain spread.
- `os serve` auto-registers the i18n service plugin when the stack carries
  translations. `translations` is package-owned while `i18n` is an envelope key a
  translations-only stack never sets, so the REST i18n routes silently did not
  exist.
- `os dev` diffs the artifact's object inventory across recompiles to name a
  newly added `*.object.ts`. It went permanently empty, so every recompile read
  as all-green.
- `os build` runs the author-time rule table twice — once over the union, once
  per package. The per-package run already read `packages[]`; the union run,
  which is the only one of the two that can see a finding spanning packages,
  judged an empty stack and published green.

All of them now resolve through one seam, in the dependency-topological order
`resolveArtifactPackageOrder` gives. Each answer starts from the expression it
replaced, so every stack that boots or builds today takes the identical branch —
including a stack declaring an empty `objects: []`, which stays a stack that gets
an engine — and `packages[]` is consulted only where the old read returned
nothing. A malformed `packages` list is refused with its ADR-0112 envelope on
that leg instead of resolving to the silent empty.

The predicate `os serve` and `os migrate` each carried their own copy of — "does
this config carry app metadata that needs an `AppPlugin` wrap" — is now one
function. Measured, it does not lose under the new shape; it is folded in because
it is the master gate for everything `AppPlugin` then reads.

No command emits anything different: the compiled artifact still carries both
copies, and the folded stack is a rule INPUT that reaches no writer.
