---
'@objectstack/spec': patch
---

liveness gate: a citation must name the property it is evidence for

Two checks already bounded a `live` entry's citation, and both bounded it from the
outside — the cited file must exist (#5623), and a cited line must be inside it
(#11210). Between them sat a gap neither could see: a consumer that moves *within*
the file it is cited to, or a citation written with no line at all, leaves the file
present and every named line in range. The pointer is wrong and the gate is green.

Measured over the whole ledger before anything was switched on: 403 (entry, cited
local file) pairs, **11** where the cited file never mentions the property's own key,
and **7 of those 11 were real rot** — repaired here:

- `permission.objects.allowExport` — `annotateEffectiveApiOperations` moved to
  `current-user-endpoints.ts`; the same repos-internal movement that had already
  rotted `permission.systemPermissions` and `permission.tabPermissions`.
- `object.tenancy.organizationField` — the resolver was promoted into
  `@objectstack/metadata-core`; the cited `audit-writers.ts` says so itself, in the
  re-export comment left behind.
- `action.target` / `action.requiredPermissions` — the actions domain was extracted
  out of `http-dispatcher.ts`, which retains 0 occurrences of either key.
- `action.bodyShape` / `action.bodyExtra` — client-dispatched keys whose only
  consumer has always been the renderer; the in-repo citation could not have been
  right at any point. Now attributed to `objectui` with the commit pinned.
- `field.requiredWhen` — cited its *sibling* `record-validator.ts`, which enforces the
  static `required` contract; the CEL predicate is evaluated one file over in
  `rule-validator.ts`. Both files exist, so nothing could see it.

The remaining 4 are the `camelCase` → `snake_case` convention this platform mandates
(Prime Directive #3): a property persisted as a column is read as `body_html`,
`managed_by`, never as the authoring key. Three are handled **structurally** — the
matcher folds the key across the naming convention rather than exempting them — and
the match is word-bounded so a prefix cannot satisfy the key (`required` is not
`requiredWhen`, which is precisely how that rot stayed hidden). The one residual is a
compound *child*-key remap (`fromOverride.address` → `from_address`) that no fold of
the parent key reaches, and it is a single explicit row in the shrink-only
`scripts/liveness/key-mention.baseline.json`, which fails in **both** directions: a
row whose pair later anchors must be deleted.

So the check ships red-capable at zero unexplained hits, which is the whole reason the
census came first — `evidence.mts`'s header records what the alternative costs, when
48 of 227 entries were flagged, every one was a false positive, and the single genuine
rot inside that list sat unread.

The check asks `evidence` only, never `producer`: a producer cites *who supplies a
second input* (#4837), which is by definition a call site and need not name the key at
all.
