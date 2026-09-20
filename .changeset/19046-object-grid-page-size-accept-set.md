---
'@objectstack/spec': minor
---

**BREAKING for authored metadata** — the `object-grid` page-component door now refuses a page size of `0`, a negative page size and a non-integer page size, at all three of its spellings: `pagination.pageSize`, every `pagination.pageSizeOptions[]` entry, and the flat `pageSize` shorthand (#19046).

Clause-②: yes (narrowing)

The accept set shrinks to the one the VIEW arm has ruled all along. `PaginationConfigSchema` (`view.zod.ts`) declares `pageSize: z.number().int().positive()` and pins its refusals by name; `MetadataQuery` and the two marketplace request schemas say `z.number().int().min(1)`, each with its own throwing pin. The `object-grid` door said `pagination: z.unknown()` and `pageSize: z.number()` — the only page-size declaration in the package that accepted `0`, and the one renderers read.

**It was not theoretical.** Measured at objectui#9853: an authored `pagination.pageSize: 0` reached `ObjectGrid`, went out on the wire as `$top: 0` and rendered ZERO ROWS, with no grouping needed to trigger it — through this arm, with a `success: true` receipt from this schema. The view arm would have refused the same value. objectui#9896 repaired the consumer half (a resolver at every read point, fail-soft, one loud diagnostic); this is the declaration half and is not a prerequisite for it.

```
✗ pagination.pageSize: Too small: expected number to be greater than 0
✗ pageSize: Invalid input: expected int, received number
```

### Migration — FROM → TO

| You wrote | Write instead |
| --- | --- |
| `pagination: { pageSize: 0 }` | `showPagination: false` and no `pagination` bag — the bag's PRESENCE is what enables paging, so `pageSize: 0` never meant "no paging" |
| `pagination: { pageSize: 0 }` (meaning "all rows on one page") | the page size you actually want (`{ pageSize: 100 }`); `0` reached the wire as `$top: 0` and returned nothing |
| `pagination: { pageSizeOptions: [0, 25, 50] }` | `{ pageSizeOptions: [25, 50] }` — drop the `0` entry; selecting it set the fetch window to zero rows |
| `pageSize: 25.5` | `pageSize: 25` — a fractional page size was truncated or forwarded verbatim, depending on the read point |

The one-line fix is always the same: **write a positive integer, or delete the key and take the renderer's default.**

<!-- adr-0087: registered ui-object-grid-page-size-positive-integer-refused -->

**⛔ What this deliberately does NOT narrow: the `pagination` bag stays OPEN.** The card's defect is that the two arms disagreed about a page SIZE — not that the bag should become a closed shape. `pagination` is now a `z.looseObject` that validates the two members whose value is a page size and passes every other key through unvalidated, so a sibling key that parsed before still parses and still survives the parse byte-identically (pinned in `component-object-grid-pagination-accept-set.pin.test.ts` §3). Reusing the view arm's `PaginationConfigSchema` here would have refused every sibling key this door has accepted since it was written — the `…` in its own describe says authors write them — which is a wider narrowing than the measured defect and a different decision. `PaginationConfigSchema` itself is unchanged and stays closed; §4 of that pin states both the agreement and the deliberate asymmetry.

**One second axis, named rather than left to be discovered.** `pagination` moves from `z.unknown()` to an object type, so a non-object value (`pagination: true`) is refused where it used to parse. Measured before narrowing: zero non-object `pagination` values exist on an `object-grid` node in either repository's corpus, the objectui registry has published this input as `type: 'object'` all along (`plugin-grid/src/index.tsx`), so the html tier already answered `type-mismatch` on one, and the renderer reads the key for PRESENCE (`schema.pagination !== undefined`) — which means an authored `pagination: false` used to turn paging ON. That value now gets a located refusal instead of the opposite of what it says.
