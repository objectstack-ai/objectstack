---
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(spec,cli): enroll `view` in the liveness ledger (#2998 Track B)

`view` joins the `GOVERNED` set of the spec property-liveness gate — the
rollout gap that let the objectui#1763/#2545 class of renderer/spec key drift
survive undetected. New `packages/spec/liveness/view.json` classifies all 83
walkable properties (75 ledger entries + framework overlay fields): the `list`
and `form` containers are drilled one level via `children`.

Seeded from the 2026-06 viewschema audit and **re-verified against objectui
HEAD** — four audit-era DEAD findings had since gone live and are classified
from current reads (`form.submitBehavior`, `list.sharing.lockedBy`, list-path
`ViewData` providers, and the post-ADR-0021 `list.chart` dataset shape — the
audit's "chart renderers never migrated" headline is resolved). Final tally:
68 live, 2 experimental (`form.buttons`/`form.defaults`, #2998 Track A
awaiting objectui#2545), 5 dead (`list.responsive`, `list.performance`,
`form.data`, `form.defaultSort`, `form.aria`). All misleading dead props
carry `authorWarn` + `authorHint`.

The CLI's compile-time liveness lint gains `view` coverage
(`TYPE_COLLECTIONS` + view containers labelled by `object`), so authoring a
dead prop — e.g. a spec-valid `chart` list view that renders empty — now warns
at `os build` with a corrective hint.
