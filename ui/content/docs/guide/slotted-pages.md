---
title: Slotted Pages
description: Customize record detail pages by overriding only the slots you care about — let the default synthesizer handle the rest.
---

# Slotted Pages

Every record detail page in ObjectUI is **synthesized from the object
definition by default** (see `buildDefaultPageSchema`). You get a
Lightning-style page — header, highlights, tabs, related lists,
history — without writing a single line of page schema.

When you want to customize part of that page, you have two options:

1. **Full page** (`kind: "full"`, the default): author the entire
   `regions[].components[]` tree. Total control, total responsibility
   — you re-author every region.
2. **Slotted page** (`kind: "slotted"`): provide overrides for only
   the slots you care about. The default-page synthesizer fills in
   every slot you didn't override.

For "I love the default page but want to customize just the header,"
slotted pages are the right tool.

## Slot menu (v1)

| Slot | Replaces |
|---|---|
| `header` | `page:header` |
| `actions` | `record:quick_actions` (the action bar) |
| `highlights` | The chips + chevron path strip |
| `details` | The Details tab body (other tabs stay synthesized) |
| `tabs` | The entire `page:tabs` node — use to add or reorder tabs (wins over `details`) |
| `discussion` | `record:discussion` (the inline conversation footer) |

Objects with `enable.files: true` also get a synthesized **Attachments** tab
(`record:attachments`, with a count badge) beside Details/Related. It is not a
slot of its own — override `tabs` to reshape it, or pass
`hideAttachments: true` to the synthesizer to drop it.

Each slot accepts a single component schema or an array (arrays are
flattened in place). Each slot is a **full replacement at the slot
boundary** — there is no deep-merge or JSON-Patch in v1.

## The discussion panel is composed, never appended

A record page shows a discussion panel **if and only if the page composes a
`record:discussion` node** — or its `record:chatter` alias, which is the same
renderer under a Salesforce-familiar name. There is no automatic panel, and
therefore no negative flag to switch one off.

- **Synthesized** and **slotted** pages compose the node for you (it is the
  `discussion` slot in the table above), so the out-of-the-box record page is
  unchanged.
- **Full pages** (`kind: "full"`) author every region, so a full page places the
  node itself — exactly like every other component it wants:

<!-- doc-snippet: fragment — a metadata excerpt: one region's components[] is one fragment of a page schema, shown without the document that would contain it -->
```ts
regions: [
  {
    name: 'main',
    components: [
      { type: 'page:header', properties: { title: '{name}' } },
      { type: 'record:details' },
      { type: 'record:discussion' },   // ← the panel is here because you put it here
    ],
  },
]
```

The node's own config is honoured as authored, so the panel a page composes is
the panel it asked for: `{ type: 'record:discussion', properties: { feed: {
showCommentInput: false } } }` renders the conversation without a composer.

**Precedence — the object outranks the page.** `enable.feeds: false` on the
object definition suppresses the discussion panel whether or not the page
composes the node; the view also skips the `sys_comment` read for such an
object, and the server rejects comment writes against it with
`403 FEEDS_DISABLED`. `enable.feeds` is opt-**out**: absent means on.

> **Upgrading (objectui#7298).** A record page used to get a discussion panel
> appended below its content whenever its tree placed no discussion node, and
> the only way out was an `assignedPage.disableDiscussion` flag that `PageSchema`
> — a `strictObject` — refuses, so no author could ever write it. Both are gone.
> If one of your **authored full pages** relied on that automatic panel, add one
> `record:discussion` node where you want it. Synthesized and slotted pages need
> no change.

## Example: customize only the header

The `header` slot takes one `page:header` node, and its `properties` are the
keys `PageHeaderProps` declares. The
[Page Header reference](/docs/layout/page-header) lists every one; the shape is
closed, so a key it does not declare is refused by name.

```ts
import type { Page } from '@objectstack/spec/ui';

export const AccountDetailPage: Page = {
  name: 'account_detail_page',
  label: 'Account Detail',
  type: 'record',
  object: 'account',
  kind: 'slotted',
  regions: [], // slotted pages don't author regions
  slots: {
    header: {
      type: 'page:header',
      id: 'account_header_slotted',
      properties: {
        title: '{name}',
        subtitle: '{industry} · {type}',
      },
    },
  },
};
```

Result: the account record page renders with your custom header, and
the synthesizer fills in the highlights, tabs, and discussion regions as
if you'd authored nothing else. The default tab strip is **Details** → one
tab per related list flagged `relatedList: 'primary'` on its relationship → a
shared **Related** tab for the rest → **History**; so promoting a child table to
its own tab is a one-word change on the relationship, not a page-authoring task.
`relatedLayout: 'tabs' | 'stack'` remains an app-level override (force
all-own-tabs / all-stacked).

Related lists are additionally gated on the current user's **object-level
read permission** for the child object: a relationship whose child the user
cannot read produces no section and no tab (and the `record:related_list`
renderer suppresses itself the same way on hand-authored pages). The server
always enforced data access — this keeps the UI from rendering an empty
grid with a "New" button that would be rejected on save.

Related lists **paginate by default**: when a `record:related_list` node
does not declare `limit`, the renderer applies the spec default of **5**
records per page (`RecordRelatedListProps.limit`), fetching one page at a
time from the server (`$top`/`$skip`) with the count badge showing the
full collection size. Authors can raise the page size per list
(`limit: 20`) and pin the initial order with `sort`
(`'-created_at'` or `[{ field, order }]`); a user's column sort is sent
to the server so ordering stays global across pages.

A related list that declares `columns` also narrows its row fetch: it
sends a `$select` of the declared columns the current user can read
(field-level security), plus `id`, the expanded lookup fields and, once the
object's schema has loaded, the fields its row-action predicates read and
the mobile card gallery's cover field (when declared and readable). A
column the user cannot read is dropped once their permissions have loaded;
a request sent before that can still carry it. A list without `columns`
picks its columns only after the rows arrive, so it still fetches whole
rows; there the column layer alone hides a field the user cannot read.

### Naming a related list's actions: `record:related_list.actions` holds IDS

By default a related list draws its child object's own actions: the ones
declared with `locations: ['list_toolbar']` as header buttons, and the ones
declared with `locations: ['list_item']` or `locations: ['record_related']`
in each row's menu. A list that declares no `actions` keeps that default.

`list_item` and `record_related` differ in scope. A `list_item` action shows
on the child's rows everywhere the child is listed, including the child's
own list view. A `record_related` action shows on them only in a related
list inside a parent record: use it for an action that makes sense in the
parent's context.

Declare `actions` to choose the set for one list. It is a list of **action
ids**, each the `name` of an action on the child object's own metadata. The
authored list replaces the default rather than adding to it, and it renders
in the order you wrote it:

```json
{
  "type": "record:related_list",
  "properties": {
    "objectName": "contact",
    "relationshipField": "account_id",
    "columns": ["name", "email"],
    "actions": ["export_contacts", "send_welcome"]
  }
}
```

The block's props go in its `properties` bag, the spec's
`ComponentPropsMap['record:related_list']` row: `objectui validate` and the
spec's page component both refuse them written flat on the node.

- Each action is still placed by its own `locations`: naming it here does
  not move it. An action that declares none of `list_toolbar`, `list_item`
  and `record_related` has nowhere to render on a related list.
- `"actions": []` shows no actions. **New**, **Edit**, **Delete** and
  opening a row are not actions: they follow the child object's
  `userActions` and the user's permissions, whatever this key says.
- An id that names no action of the child object, or one with no list
  location, is not dropped silently. The list shows a notice that names it
  and says why.

## Header actions: inline vs. overflow

`page:header` renders the record's `record_header` actions (authored
business actions plus the host-injected system set — Edit / Share /
Delete) as a button row. Up to **`maxVisible`** actions render inline,
side by side (default **3** on desktop, **`mobileMaxVisible`**, default
**1**, on mobile); the rest collapse into a `⋯` "More actions" menu.

### Naming the actions: `page:header.actions` holds IDS

`PageHeaderProps.actions` is a list of **action ids** — the `name` of an
action declared on the object's own metadata. The header resolves each id
against that object, which is the same lookup `record:quick_actions`
performs, and keeps the definitions in exactly one place: change an action
once on the object and every page that names it follows.

```ts
// on the object: the definitions
actions: [
  { name: 'convert_lead', label: 'Convert', locations: ['record_header'] },
  { name: 'export_pdf',   label: 'Export',  locations: ['record_more'] },
]
```

<!-- doc-snippet: fragment — a metadata excerpt: the bare slots: key is one fragment of a page schema, shown without the document that would contain it -->
```ts
// on the page: the header names them
slots: {
  header: {
    type: 'page:header',
    properties: {
      title: '{name}',
      actions: ['convert_lead', 'export_pdf'],
    },
  },
}
```

An id that names no action on the object renders nothing and says so once in
the console — a mistyped id is not a silently shorter header.

> Inline `ActionDef` objects in this array still render, so pages written
> before the ids contract are not stranded. That is renderer tolerance for the
> migration, not a second declared shape: the contract is
> `z.array(z.string())`, and only ids are validated. An array is **all ids or
> all inline objects** — a mixed `['convert_lead', { … }]` array is refused:
> nothing in it renders, and the console names the offending index. Convert a
> page's array whole, never one element at a time. `record:quick_actions`
> applies the same rule through the same function
> (`resolveDeclaredActionIds` from `@object-ui/types`).

### Declaring placement

A named action renders here only if its **`locations`** declares
`record_header` (inline) or `record_more` (straight into the `⋯` menu).
There is no default: an action that declares no location renders in **no**
located surface — not here, not the list toolbar, not the row menu. That
one rule is shared by every surface that places actions by location
(`action:bar`, `action:group`, `record:quick_actions`, related lists, the
metadata-admin toolbars and the action engine), so an action behaves the
same wherever it is drawn.

Two placements come from somewhere other than `locations`, and neither
needs an entry here:

- **Host chrome** — the Edit / Share / Delete set the host injects is
  placed by the host, not authored, so it is never location-filtered.
- **Selection actions** — an action named in a list view's `bulkActions`
  or `bulkActionDefs` is placed by that declaration. An action that only
  makes sense over a selection (an aggregate export, say) can therefore
  declare no `locations` at all and still be reachable from the
  selection bar.

Which actions claim the inline slots is declared in metadata, using the
same rules as `action:bar`:

- **`order`** (number, default `0`) — actions are stable-sorted
  ascending before the split, so a lower `order` promotes an action
  into the inline slots and a higher `order` pushes it toward the `⋯`
  menu. The synthesized system actions use `order: 100+`, so authored
  business actions outrank them by default.
- **`variant: 'primary'`** — tie-break within equal `order`: a primary
  action outranks its unordered siblings without needing an explicit
  `order`.
- **`variant: 'danger'`** — the spec's destructive variant. A danger
  action is never the filled primary button: shown inline it is a
  destructive (red) button, and folded into the `⋯` menu it is a red row
  in the destructive band at the bottom, below a separator, beside the
  host's Delete.
- **`component: 'action:menu'`** — pins the action inside the `⋯` menu
  regardless of how few actions exist (the synthesized Share / Delete
  use this).

<!-- doc-snippet: fragment — a metadata excerpt: the bare slots: key is one fragment of a page schema, shown without the document that would contain it -->
```ts
slots: {
  header: {
    type: 'page:header',
    properties: {
      title: '{name}',
      maxVisible: 4, // allow four inline buttons on this page
    },
  },
},
```

### The refresh button is chrome, not an action

Past the `⋯` menu, at the far end of the row, a record page shows a **⟳
refresh** button. It is deliberately *not* part of the action row:

- **Nothing to author.** It appears when the page **host** supplies
  `RecordContext.refresh` — the standalone record route does, so every
  record page has it, in the same place, whatever actions the object
  declares. There is no metadata key for it and no `locations` to write.
- **Never collapsed.** Because it is outside the action list, it is not
  part of the `maxVisible` budget and can never be pushed into the `⋯`
  menu by an object that declares many actions.
- **Not permission-gated.** Re-reading a record already on screen is not
  a privileged operation, so it skips the `requiredPermissions` gate the
  action pipeline applies.

Clicking it invalidates data on the client bus (`notifyDataChanged` from
`@object-ui/react`) with the wildcard scope `'*'`: the record, every
related list and the tab-count badges refetch **in place**. Nothing
remounts, so the open tab, the scroll position and any in-progress
inline edit survive the refresh — the point of the button is to see
another user's writes without an F5.

A host that supplies no `refresh` (an embedded drawer, a designer
preview, a non-record page) renders no button.

## Composing default + custom

When you want "the default actions plus one custom button," you have
to replace the whole `actions` slot — there's no append/insert
operation in v1. To avoid copying the synthesizer's internals,
`@object-ui/plugin-detail` exports the **sub-builders** the
synthesizer uses internally:

```ts
import {
  buildDefaultHeader,
  buildDefaultActions,
  buildDefaultHighlights,
  buildDefaultDetails,
  buildDefaultTabs,
  buildDefaultDiscussion,
} from '@object-ui/plugin-detail';
```

You can call them with the object definition (and any options you'd
normally pass to `buildDefaultPageSchema`) and spread the result into
your slot override.

## When to use slotted vs full

- **Slotted** — customizing 1–2 regions of an otherwise standard
  detail page. Most "I want a fancier header" / "add a banner" /
  "swap the Details layout" requests.
- **Full** — building a record page that doesn't look like the
  default at all (e.g. a multi-column dashboard-style record). Author
  every region yourself.

The two modes are mutually exclusive: a page either has `kind: "full"`
(default) and uses `regions[]`, or `kind: "slotted"` and uses
`slots`.

> **Note:** the default-page synthesizer is the only render path for
> record detail pages. The legacy monolithic DetailView fallback and its
> `renderViaSchema` kill-switch (`objectDef.detail.renderViaSchema`,
> `?renderViaSchema=0`) were removed by ADR-0085 PR4.
