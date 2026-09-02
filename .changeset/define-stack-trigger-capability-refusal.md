---
'@objectstack/spec': minor
'@objectstack/lint': patch
---

`defineStack` now refuses a stack that declares an auto-launched flow while `requires` omits `'triggers'` (#14153) — **BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes.

A `record_change`, `schedule`, `time_relative` or `api` flow fires only when its trigger is mounted, and every one of those triggers ships in `@objectstack/trigger-*` behind ONE capability token, `requires: ['triggers']`. `defineStack` already hard-errors the same declared-capability class for the hierarchy scopes (`unit` / `unit_and_below` / `own_and_reports` need `'hierarchy-security'`), which fail CLOSED when the capability is missing — a user notices the missing rows. The trigger half failed SILENT: the flow registered, `validate` / `typecheck` / `test` / `build` all exited 0, and the automation simply never happened. Measured downstream: an app shipped four correctly-authored flows, zero bound, across five merged rounds, and the only diagnostic was a boot-banner line printed after deploy.

The refusal lands in the same throw-site family as its sibling (`defineStack trigger capability validation failed (N issue(s)):` with one `✗` line per flow) and reuses the boot audit's own wording — the flow name, the resolved trigger kind, and the exact remedy (`Add requires: ['triggers'] (record_change/schedule/time_relative/api ship in @objectstack/trigger-*)`). An absent `requires` counts as omitting the token: the CLI reads it as `[]` and appends only the always-on slate, which mounts neither `automation` nor `triggers`, so a stack that declares nothing gets no trigger either. Flows whose `status` disables them (`obsolete` / `invalid`) are skipped, exactly as the engine's boot audit skips them. A stack whose flows are all `screen` or hand-launched `autolaunched` owes nothing. The fix for a refused stack is the one line the message names; a flow that was genuinely meant to be launched only by hand declares `type: 'autolaunched'` (or `'screen'`) instead of a trigger it never intended to bind.

The kind a flow asks for is now one shared derivation, `resolveFlowTriggerKind` (`@objectstack/spec/automation`), the authoring-time mirror of the automation engine's binding chain — same start-node reads, same precedence (a `timeRelative` descriptor outranks its sibling `schedule` cadence). `@objectstack/lint`'s `validate-flow-trigger-readiness` reads it as the auto-triggered predicate behind its draft-status rule, so the two authoring surfaces cannot disagree on which flows auto-launch; its findings are unchanged.

In-tree corpus: `examples/app-todo` declared two `schedule` flows and a `record_change` flow with no `requires` at all and now declares `requires: ['automation', 'triggers']`.

<!-- adr-0087: not-required (no-migration-prescription) the refusal message itself names the one-line fix (declare the `triggers` token), and nothing is renamed or removed — no authorable key changes spelling and no export moves, so the ledger has no rewrite to carry. -->
