---
'@objectstack/spec': patch
---

fix(spec): the `/packages` list-door tombstone enumerates all three filters that door reads (#19407)

`limit` and `cursor` on `ListInstalledPackagesRequestSchema` both raise
`PACKAGES_LIST_PAGINATION_REMOVED`, and that prescription enumerated the serving
door's filters as `status` / `type`. The door reads a **third**, `enabled`
(`readEnabledFilter`, `packages/runtime/src/domains/packages.ts`), so the
prescription named two of three and pointed an upgrader at a narrower answer
than the route actually offers.

**Incomplete, not wrong — and only the enumeration moves.** The sentence's
load-bearing claim, *no page was ever withheld and no continuation token was
ever minted*, is untouched and stays true: `enabled` filters rows, it does not
paginate. The removability argument, the `.default(50)` passage and the
`hasMore` passage are byte-identical. Nor did the sentence ever assert that
`enabled` was unavailable — it enumerated, it did not exclude — so nothing here
reverses a claim.

```
FROM  … the serving door filters on `status` / `type` and then returns every
      remaining row …
      … Filter with `status` and `type` instead of asking for a window.

TO    … the serving door filters on `status` / `type` / `enabled` and then
      returns every remaining row …
      … Filter with `status`, `type` and `enabled` instead of asking for a window.
```

The same repair lands on every carrier of the sentence inside the spec: the
tombstone string, and the ADR-0087 D3 semantic entry
`packages-list-pagination-retired` in both its `replacement` (what to use
instead) and its `reason` (what the door reads). The generated migration
registry and the generated reference page follow from the repo's own
generators.

No accept set moves, no key is added or removed, and no type changes: `limit`
and `cursor` stay `retiredKey()` tombstones typed `never`, and `enabled` was
already declared and already published as a filter on this request.
