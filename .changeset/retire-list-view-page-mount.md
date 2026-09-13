---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/metadata-protocol': minor
---

**BREAKING** — retire the `type: 'page'` list-view mount and its `pageName` binding.

A list view could declare `type: 'page'` and name a published page in `pageName`,
and the view was to render nothing of its own and delegate to the page renderer.
Only the spec half of that was ever built. **No renderer ever routed the member**:
objectui's list-view switch shares its `default:` arm with `case 'grid'`, so a page
view has always drawn an empty table where the page was supposed to be, and the
three parse refusals that policed the binding policed a mount that never mounted
anything. ADR-0049 enforce-or-remove; maintainer ruling 2026-09-09.

## FROM → TO

| you wrote (17.4 and earlier) | write instead |
| --- | --- |
| `{ type: 'page', pageName: 'sales_home', columns: [] }` on a list view | nothing on the view. Delete it, and reach the page from the app's `navigation`: `{ id: 'nav_sales_home', type: 'page', pageName: 'sales_home', label: 'Sales' }` |
| `pageName` beside any other list-view `type` | delete the key — it was refused already, and is now a tombstone |
| a list view that wanted rows | pick a row-drawing `type` — `grid` and its siblings, all unchanged |

**The one-line fix:** delete `type: 'page'` and `pageName` from the list view; put
the page behind an app navigation item, which is a different key on a different
surface (`PageNavItem.pageName`) and is the page mount that has always rendered.

`os migrate meta --from 17` lists the mechanical edits for existing sources; apply
them by hand.

## The retirement kit

- **`pageName`** — a `retiredKey()` tombstone on `ListViewSchema` and
  `ObjectListViewSchema`. `tsc` types the key `never`, and a value reaching a parse
  raises the prescription rather than a bare unrecognized-key report.
- **`'page'`** — an enum VALUE, so there is no tombstone to hang a prescription on
  (the def survives, one value lighter, and the four generated-surface ratchets are
  blind to that by construction). The `type` enum's own `error` map carries it,
  keyed on `issue.input` so only the value that used to be legal gets the
  "was removed" message; every other invalid `type` keeps zod's default text.
- **`checkListViewPageMount`** — the exported object-level refinement existed only
  to police this mount, so it is removed with it, along with its three refusal
  messages. A downstream mirror that re-attached it (the reason it was exported)
  should drop the `.superRefine` line; the compiler delivers this one. It held no
  `ERROR_CODE_LEDGER` row — the three refusals were message constants, not codes.
- **`validateViewPageRefs` / `VIEW_PAGE_UNRESOLVED`** (`@objectstack/lint`) — the
  `os validate` and publish-gate rule that resolved a mount against `stack.pages`.
  Removed: there is no reference left to resolve. Its nav twin
  (`validateNavTargetRefs`, on the app navigation item) is **untouched**.
- **`RuntimeStackContext.pages`** (`@objectstack/lint`) and the `page` row of
  `CLOSURE_CONTEXT_KEY_BY_TYPE` (`@objectstack/metadata-protocol`) — the live page
  universe joined the per-write snapshot for that one rule, and leaves with it. A
  `PUT /api/v1/meta/view` publish no longer pays a `sys_metadata` round trip for a
  collection nothing consults. Hosts calling `runRuntimeAuthoringRules` /
  `evaluateRuntimeAuthoringGate` with an explicit `context.pages` drop that key.
- **`defineStack`** — the `validateCrossReferences` branch that resolved a mount's
  `pageName` against `stack.pages` is gone. The surviving three page references in
  that function (an app nav item's `pageName`, a modal action's `target` at two
  rungs) keep their own policy.
- **The metadata form** — `view.form.ts`'s `page` section, whose one input was
  `pageName`, is removed. A form input for an unwritable key is the false-compliant
  UI half of a retirement.

## What an operator with a STORED page view sees

A `sys_metadata` `view` row written before this release can carry `type: 'page'` and
a `pageName`. Nothing breaks at read: the ADR-0087 conversion
`view-page-mount-removed` (protocol 18) replays on rehydration and strips both keys,
so the row is served canonical. `type` is **stripped, not rewritten** — it defaults
to `grid` in the schema, so the row lands on exactly what it already rendered
without the platform guessing a view type.

The strip is announced once per row per process, on whichever seam served it.
Grep for `carries a pre-protocol shape` — there are **three** emitters, one per
rehydration seam, and they differ:

- `[DatabaseLoader] stored view/<name> carries a pre-protocol shape; <notice>`
- `[ObjectQLPlugin] stored view/<name> carries a pre-protocol shape; <notice>`
- `[Protocol] stored view/<name> carries a pre-protocol shape; <notice> The row
  itself is unchanged — re-save it (Studio edit -> save, or run
  "os migrate meta --stored --apply") to persist the canonical shape.`

`os migrate meta --from 17` lists the same edits for authored sources;
`os migrate meta --stored --apply` rewrites the stored rows so the warn stops, and
the next save through `PUT /api/v1/meta/view` heals one row the way it heals any
pre-protocol shape.

⚠️ The conversion walks `stack.views[]` in all three persisted spellings; it does
**not** reach `objects[].listViews.*`, which no conversion in the registry reaches.
An object body still carrying a page mount is refused at its own door with the
prescription rather than converted. Measured population for both at the ruling:
**zero** authored `type: 'page'` list views in this repository or any consuming app
the seats can read — the in-tree `type: 'page'` hits are all app nav items.

<!-- adr-0087: registered view-page-mount-removed -->
