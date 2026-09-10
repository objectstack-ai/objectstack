---
"@objectstack/plugin-security": patch
---

fix(security): resolve `current_user.accessible_org_ids` into the RLS variable bag (#16518)

`patch` — a bug fix in a released package. No API signature changes, no exported
symbol added, no spec or ADR edit: the contract already promised this, and only
the line that delivers it was missing.

## What was wrong

`packages/spec/src/contracts/rls-membership-resolver.ts` does not merely reserve
the name `accessible_org_ids`. It declares the field's SHAPE (`:53`,
`accessible_org_ids?: string[]`), states at `:35` that the key is CORE-resolved
and not an app resolver, and lists it at `:70` in
`RESERVED_RLS_MEMBERSHIP_KEYS` — so an app's membership resolver is refused when
it tries to supply the set itself. `ExecutionContext.accessible_org_ids` goes
further and names the RLS spelling outright: *"RLS policies may reference it as
`organization_id IN (current_user.accessible_org_ids)`"*.

`RLSUserContext` declared `id`, `organization_id`, `positions`, `org_user_ids`
and `email`, and nothing copied `accessible_org_ids` out of the execution
context. So the key was reserved on the grounds that core resolves it, and core
did not resolve it — a slot with a declared shape and no filler, which is the
ADR-0049 "declared but unenforced" shape.

**The cost is the invisible one.** A predicate such as
`employer_org IN (current_user.accessible_org_ids)` compiled to an unresolved
variable, every applicable policy dropped out, and `RLS_DENY_FILTER` returned
**zero rows with no error raised**. Nothing failed. An empty list is
indistinguishable from "this user really has no data", which is how the shape
survived three green static gates and, in the reporting app, left ten policies
across six objects inert — the entire multi-tenant isolation model.

The failure direction is **closed**: zero rows, never a cross-tenant read. This
is a usability and declared-means-enforced defect on a security surface, not a
leak.

## What it does now

`RLSCompiler.compileFilter` copies `ExecutionContext.accessible_org_ids` into
`RLSUserContext`, following `org_user_ids`' precedent exactly — both are
core-resolved membership sets the runtime **pre-resolves**, precisely so this
compiler never has to issue a subquery. The compiler is unchanged otherwise; it
already handled the value correctly once present.

The producer already existed and is unconditional: `resolve-authz-context.ts`
types the set as required and `assemble-execution-context.ts` copies it on every
face, in every posture (*"in `single` posture the set is resolved but no wall
consumes it"*). Only the consuming line was missing.

One consequence worth naming: **reserved now means reserved at the compiler
too.** `stageRlsMembership` screens reserved keys out of a *resolver's* answer,
but a bag already present on the context was spread through unscreened, and
landed in the variable bag because nothing named the field. Now that the kernel
names it, the compiler's own "a membership key never clobbers a named field"
rule covers it and the kernel's value wins.

## Measured, end to end

A rig on real drivers (`driver-sql`, `driver-sqlite-wasm`), six rows across
three organizations, a caller holding membership in two of them:

| predicate | before | after |
|:--|--:|--:|
| `employer_org IN (current_user.accessible_org_ids)` | **0 of 6** | **4 of 6** — the rows of both orgs |
| same, caller scoped to ONE org | 0 of 6 | 2 of 6 — that org only |
| same, caller with no set / an empty set / an org with no rows | 0 of 6 | 0 of 6 — unchanged, still fails closed |
| a predicate naming a NON-EXISTENT variable | 0 of 6 | 0 of 6 — unchanged (#16119's face, untouched) |
| `org_user_ids`, `organization_id`, `email`, `id`, an app membership key | — | byte-identical |

An app **could** work around the defect by supplying the same set under its own
unreserved key through `rlsMembership` and rewriting its predicates to
`current_user.my_org_ids`; that reads 4 of 6 on the same rig, before and after.
The workaround costs every app a membership-resolver registration it should not
need and moves every predicate off the documented spelling — and it is no longer
necessary.
