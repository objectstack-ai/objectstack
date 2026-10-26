# ADR-0055: Parameterized bare data surface — the third list context

**Status**: Accepted (2026-07-05)
**Author**: ObjectUI app-shell team
**Consumers**: `@object-ui/app-shell` (`ObjectDataPage`, console routes), `@object-ui/layout` (`resolveHref`), `@object-ui/types` (`NavigationItem.filters`)
**Amends**: **ADR-0053** (adds a third context to its two-mode table)
**Tracking**: objectstack-ai/objectui#2251

---

## TL;DR

ADR-0053 gave a list surface exactly one navigation mode decided by context:
**views** mode on the object route, **filters** mode inside a page. Neither
context can express "show me this object's data filtered by conditions in the
URL, bound to no saved view" — the object route always anchors to a view
(URL `filter[...]` conditions stack **on top of** the default view's own
filter and can never escape it), and a page requires authoring a page.

**Decision:** add a third, URL-addressed context — purely additive, existing
routes untouched:

| Context | Route | Mode | Single control | Anchor |
| --- | --- | --- | --- | --- |
| Object default list (`ObjectView`) | `/:objectName` (+ `/view/:viewId`) | **views** | `ViewTabBar` | saved view |
| List in a page (`InterfaceListPage`) | `/page/:pageName` | **filters** | `userFilters` | page config |
| **Bare data surface (`ObjectDataPage`)** | `/:objectName/data` | **filters** | `userFilters` (auto-derived) + URL chips | **the URL itself** |

`data` joins `new` / `view` / `record` as a reserved route segment.

## The surface's contract

1. **The URL is the view.** `filter[<field>]=<value>` params (equality) apply
   over everything row-level security permits; no saved-view filter is baked
   in. Conditions render as visible, removable chips — deliberately unlike
   Odoo's invisible action `domain`, whose opacity is its most-complained
   trait.
2. **No saved-view chrome, no write-back.** The saved-view tab bar is absent;
   nothing on this surface persists to any view. "Save as view" is the one
   exit: it materializes the current conditions as a new view and navigates
   to `/view/:viewId`.
3. **Presentation is orthogonal to data scope.** The visualization switcher
   (grid/kanban/calendar/gallery, bindings auto-derived from the object) is
   ListView-internal, so switching presentation never rewrites the URL —
   filter state survives by construction (Odoo view-mode semantics).
4. **The filter bar is auto-derived.** ADR-0053 puts `userFilters` on views
   and pages; this surface has neither, so the bar derives from the object's
   enum-ish fields, and selections persist via ADR-0047 `uf_*` params.
5. **Nav entries target it declaratively.** `NavigationItem.filters`
   (`Record<string, string>`, `{current_user_id}`/`{current_org_id}`
   templates) serializes through `resolveHref` to `/data?filter[...]`.
   Precedence within `type:'object'`: `recordId` → `filters` → `viewName`.
   Composition rule: URL filters for one-off / parameterized slices; a slice
   graduates to a named view only when curated and reused (see the
   app-composition guide).

   **Amended 2026-09-13:** superseded by `@objectstack/spec`'s
   `objectNavTargetExclusivity` (17.4.0; objectui#8563 chains it on
   `NavigationItemSchema`): `filters` is refused with `recordId` or
   `viewName`, `runAction` with `recordId`; `recordId` + `viewName` is
   tolerated. The precedence above no longer applies.

## Security model

A view was never a security boundary, and neither is this surface. It shows
**what row-level permissions allow, nothing more**:

- the route gates on object `read` permission (explicit 403, never an empty
  list);
- auto-derived columns, filter-bar fields, and URL predicates are trimmed to
  readable fields client-side — as UX honesty only;
- the **server** is the enforcement point: it must inject the row-level
  permission filter and drop predicates on unreadable fields (filter-oracle
  probing), independent of anything the client sends.

## Rejected alternatives

- **Re-anchor the bare object route** (`/:objectName` = bare surface): breaks
  every existing menu, bookmark, and `resolveHref` output. Rejected for a
  reserved segment that is purely additive.
- **A reserved view id** (`_all` in the views-mode tab bar): in-band
  signalling, collides with user view ids, and inherits views-mode chrome the
  surface must suppress.
- **Making URL filters a picker on the default view**: conditions still stack
  on the view's own filter — the "can never escape the default view" problem
  this ADR exists to solve.

## Follow-ups

- `@objectstack/spec` sync for `NavigationItem.filters` (framework repo).
- Server-side predicate trimming + row filter injection (framework repo).
- Rich operator syntax (`filter[<field>][gte]=…`) — additive; the equality
  shorthand stays.
