---
'@objectstack/spec': minor
---

feat(spec): a view that declares no page size now shows 50 per page — `PaginationConfigSchema.pageSize` defaults to 50 (was 25)

The platform display page size is 50 (maintainer ruling on objectui#9853,
「9853 默认页大小改为50」). It is declared in one place, the view contract's
`PaginationConfigSchema.pageSize`, and the renderer reads that spec default
rather than keeping a number of its own — so the change lands in the protocol
first.

**What changes for an author who omits the page size:**

- A view whose `pagination` block does not set `pageSize` now parses to
  `pageSize: 50` where it parsed to `25`: 50 rows per page on a paged view, and
  a fetch ceiling of 50 on a view with no pager (kanban, gallery, timeline).
- A view with no `pagination` block at all parses with none, before and after;
  its page size comes from the renderer, which takes this spec default (the
  Console does so once objectui#9853 lands).

**What does not change:** the accept set. `pageSize` is still a positive
integer; `0`, negatives and fractions are refused exactly as before, and every
page size an author wrote parses to the number they wrote.

### Migration: FROM → TO

| FROM | TO |
| :--- | :--- |
| a view that declares no page size and relied on 25 rows per page | write it: `pagination: { pageSize: 25 }` |
| a view that declares no page size and should follow the platform default | change nothing — it now shows 50 |
| reading `PaginationConfigParsed.pageSize` after parsing a `pagination` block without `pageSize` | it yields `50` where it yielded `25`; the type is unchanged |
| reading the published JSON Schema's `default` for `ui/PaginationConfig` `pageSize` | it is `50` |

The move is declared in `DEFAULT_CHANGES_BY_MAJOR`
(`packages/spec/scripts/lib/default-changes.ts`, `ui/PaginationConfig:pageSize`
25 → 50) and carried on the upgrade path as the semantic entry
`view-pagination-page-size-default-50`.
