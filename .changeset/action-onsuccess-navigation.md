---
"@objectstack/spec": minor
---

feat(spec): `ActionSchema.onSuccess` — post-success navigation for `api`/`script` actions, with `${result.*}` joining the navigate template's interpolation scope (#9566, #9474)

<!-- adr-0087: not-required (accept-set expansion) One new CLOSED optional key
on an existing shape; nothing authorable is renamed, retired or tombstoned, so
there is no conversion to register. Previously-refused spellings stay refused —
three of them now carry guidance pointing at the new key. -->

The maintainer's 2026-08-18 ruling (recorded on #9566, mirrored on #9474)
declares ONE post-success navigation contract for both server-executing action
types instead of two per-type conventions:

- `onSuccess: { navigate, openIn? }` — a strict object, read for
  `type: 'api'` and `type: 'script'` only (a refinement refuses it on
  `url`/`modal`/`flow`/`form`, where no success event exists for it to ride —
  the ADR-0078 posture, same enforcement shape as the `body`-on-non-script
  refinement).
- `navigate` is a route/URL template. Its documented interpolation scope is
  `${param.*}` + `${ctx.*}` (existing) + **`${result.*}` — NEW: the action's
  server response payload** (an `api` action's response body, a `script`
  handler's return value), which is what makes "server clones a record → jump
  to the new record" declarable: `navigate: '/apps/crm/tasks/${result.id}'`.
  The interpolation ENGINE stays the renderer's (objectui `interpolateTarget`);
  the spec records the contract.
- `openIn` is the closed enum `'self' | 'newTab'`, defaulting **`'self'`**
  (materialized, the file's default convention) — no general navigation DSL.
- The shipped handler-return convention (`{ redirectUrl, openIn? }`,
  objectui#2967/#2904) keeps its 17.0.0 semantics: absent `openIn` still means
  new-tab (no silent behavior flip for existing handlers); a handler may return
  `openIn: 'self'` explicitly.

The console consumer is the downstream objectui half (SPA navigation branch,
`executeAPI` navigation handling, `${result.*}` interpolation), filed
Blocked-by these cards; the liveness ledger records the key at `planned`
strength with the amend-on-landing instruction.
