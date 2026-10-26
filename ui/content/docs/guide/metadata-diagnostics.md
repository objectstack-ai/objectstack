---
title: Metadata Diagnostics
description: How ObjectStack surfaces load-time validation problems in Studio.
---

# Metadata Diagnostics

Every metadata item shipped by a package — `object`, `view`, `report`,
`dashboard`, `flow`, `app`, … — is validated against its Zod schema when
the framework loads it. The validation result travels alongside the
item as a `_diagnostics` envelope, and Studio surfaces it at four levels
so authors and operators can fix problems without grepping logs.

> **Backend agnostic.** The shape and the REST endpoint described below
> are part of the ObjectStack protocol. Studio is one consumer; any
> custom UI built on `@object-ui/data-objectstack` can render the same
> envelope.

## The `_diagnostics` envelope

```ts
interface MetadataDiagnostics {
  valid: boolean;
  errors?:   Array<{ path: string; message: string; code?: string }>;
  warnings?: Array<{ path: string; message: string; code?: string }>;
}
```

* `valid === false` means **at least one error** — features that depend
  on the item (rendering, queries, automation) are unsafe to use.
* `warnings[]` is advisory — items remain `valid: true` but operators
  should review (deprecations, performance hints, missing-but-defaultable
  fields).
* `path` is dot-delimited, matching the same convention Zod uses
  (`fields.email.type`, `columns.0.bind`).

The envelope is attached to:

| Endpoint                               | Where the envelope lives          |
|:---------------------------------------|:----------------------------------|
| `GET /api/v1/meta/items/:type`         | Each list entry (`item._diagnostics`) |
| `GET /api/v1/meta/items/:type/:name`   | Top-level (`item._diagnostics`)   |
| `GET /api/v1/meta/items/:type/:name?layered=true` | `effective._diagnostics`    |
| `GET /api/v1/meta/diagnostics`         | Sweep — see next section          |

## The diagnostics sweep endpoint

`GET /api/v1/meta/diagnostics` runs validation across **every metadata
type and item** in one round-trip. It powers the governance overview
page and the per-type tile badges.

```http
GET /api/v1/meta/diagnostics?severity=error
```

| Query        | Default   | Effect                                          |
|:-------------|:----------|:------------------------------------------------|
| `severity`   | `error`   | `error` returns invalid items only; `warning` also returns items with only warnings. |
| `type`       | —         | Limit to a single metadata type.                 |
| `package`    | —         | Limit to one package id.                         |

Response:

```ts
import type { MetadataDiagnostics } from '@object-ui/data-objectstack';

interface MetadataDiagnosticsSummary {
  entries: Array<{
    type: string;
    name: string;
    diagnostics: MetadataDiagnostics;
  }>;
  total: number;          // entries.length
  scannedTypes: number;   // how many metadata types were checked
  scannedItems: number;   // how many items were checked in total
  /**
   * Per-type aggregate stats — count of items and the list of
   * packages contributing to each type. Computed in the same sweep so
   * directory tiles render counts and a package filter without
   * additional round-trips. Empty `{}` on framework versions older
   * than the 7.x line.
   */
  stats: Record<string, { count: number; packages: string[] }>;
}
```

Use this as a CI gate too — `total === 0` is the green-build condition.

## Studio UI surfaces

### 1. Directory page badges

`/apps/<app>/metadata` — the directory is **scoped to the active project
software package** (the sidebar `active_package` selector, published as
`?package=`). Only metadata types that the selected project package
contributes are listed — system/cloud types never appear, and there is no
in-page "All packages" dropdown. If the URL holds no valid project
package the page repairs it to the first available one. Each visible type
tile shows:

* A neutral count badge with the total items of that type. (Note: this
  total spans all packages — the per-type *list* page it links to is
  strictly scoped to the active project package.)
* A red ⚠ + count when any items fail validation (errors).
* An amber ⚠ + count when items have warnings but no errors.

Tiles deep-link into the list page carrying the active `?package=`, so the
scope survives navigation.

The "View all issues (N)" link in the filter row jumps straight to the
governance page.

### 2. Resource list rows

`/apps/<app>/metadata/<type>` — invalid rows get a red ⚠ icon next to
the name and a destructive-tinted background; warning-only rows get an
amber ⚠ and amber tint. The list header shows aggregate "Invalid N" and
"Warnings N" chips. Hover the ⚠ for the first three messages.

The list page is **always scoped to a single project software package**.
Studio's sidebar exposes a mandatory **Package** scope selector (the app's
`active_package` context selector) whose options are the installed
*project* packages — system/cloud packages are never offered and there is
no "All" choice. The selection is published as the `?package=` URL
parameter, which every metadata list reads to filter rows by their
`_packageId`. If the URL holds no valid project package the list repairs
it to the first available one, so system metadata never leaks into the
view. (The page no longer renders its own per-type package dropdown —
scope is owned solely by the sidebar selector.)

### 3. Resource edit banners

`/apps/<app>/metadata/<type>/<name>` — a destructive banner at the top
of the edit page lists the first three errors with their paths; the
same errors are also threaded into the form so the offending fields
get inline messages **without** the user having to click Save first.
Warnings, when present, render as a parallel amber banner.

Edits clear the matching diagnostic immediately — the inline error on a
field disappears as soon as you start typing in it, then re-validates
on save.

For **object** drafts the live validation goes beyond the Zod shape check:
every field conditional rule (`visibleWhen` / `readonlyWhen` / `requiredWhen`)
is linted as a CEL predicate with the same `@objectstack/formula` validators
the server uses. A predicate
that parses but references an unknown field, or references a field bare
instead of as `record.<field>`, surfaces under its `fields.<field>.<rule>`
path in the banner. The field inspector's *Conditional rules* editors give
the same verdict inline as you type — with autocomplete for the object's
fields (after `record.` / `previous.`), the runtime-bound scope roots
(`record`, `previous`, `parent`), and the CEL stdlib.

Formula fields get the same treatment for their value `expression`: the
inline editor lints it in `role: 'value'` mode and shows the **inferred
result type** (only a proven-Number formula is offered as a dataset
measure), while the draft-wide pass surfaces a broken formula on any field
under its `fields.<field>.expression` path.

A predicate that slips past authoring is still not silent at **runtime**:
when a conditional rule (`visibleWhen` / `readonlyWhen` / `requiredWhen`,
view-level `visibleOn`, per-option `visibleWhen`, list conditional
formatting) fails to evaluate, the renderer applies the rule's safe default
(fail-open — a broken predicate never hides a field) and
logs **one `console.warn` per predicate** with the predicate source, the
engine's failure reason, and the field it was attached to. A rule that never
fires while its field stays visible is the classic symptom — open the
browser console and the broken predicate identifies itself (most often a
bare field name where `record.<field>` was meant).

One slot is the opposite: an object **field group**'s `visibleWhen` is
fail-CLOSED, as `@objectstack/spec` declares for
`ObjectFieldGroupSchema.visibleWhen`. A group whose predicate cannot be
evaluated is hidden whole, header and members, on the form and on the
record detail page. The same one-time warning names `safe default (false)`
and "the group is hidden". A form-view section's own `visibleWhen` keeps
failing open (objectui#13055).

At **submit**, a broken field rule is refused rather than passed (ADR-0137
D2). A field-level `visibleWhen` that cannot be evaluated refuses the submit
on the client — the record form, the `/forms/:name` and `/f/:slug` page, and a
wizard's final step — with a message naming the field and the rule, because no
server evaluates `visibleWhen` and its fail-open render would otherwise be a
silent grant. A broken `requiredWhen` / `readonlyWhen` is refused by the server,
and the form shows that refusal beside the input. A `visibleWhen` that reads
`previous` cannot be evaluated on a create form, so such a form is always
refused (and on an edit wizard too, whose final cross-step check binds no
`previous`).

A **blank** field rule (`''`, whitespace, or an envelope whose `source` is
blank) is not "no rule" — it is refused, at the first place that can see it
(ADR-0137 D1 / D2). A new one is refused at authoring: the form schema's
`visibleWhen` / `readonlyWhen` / `requiredWhen` reject a blank predicate at
parse, as the protocol's field schema does. One already stored is refused at
submit, like any rule that cannot be evaluated: the client refuses a blank
`visibleWhen`, the server a blank `requiredWhen` / `readonlyWhen`. A blank
**gate** is different: at runtime it is read as "no gate" and never refused —
a blank `visible`, `hidden` or `disabled`, a page node's `visibleWhen`, or a
form view's own field `visibleWhen` — but it is not silent either: it is
reported once in the console with the `[blank]` reason (ADR-0137 D4). Where the
protocol already refuses a blank gate at authoring, the form schema does too: a
form field's view-level `visibleOn` and a select option's `visibleWhen` reject
a blank predicate at parse, as their protocol counterparts do. `visible`,
`hidden` and `disabled` have no protocol counterpart, so a blank there parses
and is only diagnosed.

The same is now true of a **component node's own gate** — `visibleWhen` on a
page component (and its `visible` / `visibleOn` / `hidden` / `hiddenOn`
siblings; the page component's old `visibility` spelling is retired and not
read), plus a `page:tabs` item's `visibleWhen`. These used to
report in a development build only, so a gate that stopped biting in
production left nothing on the console at all. They now warn in **both**
builds, with the node type, the node id, the gate key, the predicate source
and the engine's reason:

```text
[ObjectUI] A visibility predicate could not be evaluated - node "record:alert" (id: "a1")
  visibleWhen: "nosuchroot.status == 'draft'"
  Reason: Failed to evaluate expression "nosuchroot.status == 'draft'": nosuchroot is not defined
...
```

The rest of the line says what the fault did to the node: on `visibleWhen`,
`visible` and `visibleOn` the node was **withheld**, on `hidden` and `hiddenOn`
it was removed (see below).

The line is **rate limited to one per distinct predicate source**, so a broken
predicate rendered down two hundred rows of a list is one line, not two
hundred — while a second, differently-broken predicate still gets its own.

Page visibility gates fail **closed**: a page node's `visibleWhen` (and its
`visible` / `visibleOn` / `hidden` / `hiddenOn` siblings, objectui#13299) and a
`page:tabs` item's `visibleWhen` (objectui#13286). A declared predicate that
cannot be evaluated — over the CEL engine's AST bound, a type error, an unbound
root such as `record` on a surface with no row, a missing function — withholds
what it gates rather than drawing it for a viewer the predicate was written to
exclude: the node is not rendered, and a tab is not drawn, header and panel. A
related list withheld this way is not counted in its tab's badge either. The
console line says the node or tab was **withheld**. If a withheld tab was the
active one, the strip falls back to the first visible tab. A node or item with
no gate, or a blank one (`''`, whitespace, an envelope whose `source` is blank),
declares nothing and is still shown; a predicate that evaluates decides as it
always did. Form field rules (`visibleWhen` / `readonlyWhen` on a field, and
the other rules listed above) are not page visibility gates and keep their
fail-open.

The **app shell's own `visible` gate** joins the same reporter and the same
rate limit: a `visible` predicate on a navigation item, on an area's
navigation, or on an object field rendered by the record form page. This one
was silent in **both** builds before — including the bare-string dialect,
which printed nothing at all — so a menu entry whose role gate had stopped
working rendered for everyone, silently, with nothing to grep for. It now
reports under the surface label `app-shell:visible`:

```text
[ObjectUI] A visibility predicate could not be evaluated - node "app-shell:visible"
  visible: "'org_admin' in current_user.postions"
  Reason: ...
```

The dedupe key is the predicate **source**, not the menu entry — one broken
role gate copy-pasted across eight entries is one authoring mistake and prints
one line, while a second, differently-broken predicate still gets its own.
Fail-open is unchanged here too: the item still renders for everyone,
including the role the predicate was written to exclude. That is what the line
exists to tell you.

### 4. Governance overview page

`/apps/<app>/metadata/_diagnostics` — a single sortable table of every
invalid item across every type, grouped by type, with deep-links to the
offending edit page. Toggle the severity tab to include
warning-only items. This is the page to open during a release readiness
review.

## Authoring metadata that validates cleanly

Validation rules are defined by the Zod schemas in `@objectstack/spec`.
A few high-leverage patterns:

* **Use `defineObject`, `defineView`, … helpers** from `@objectstack/spec` —
  TypeScript catches most shape issues at compile time before they ever
  reach the diagnostics path.
* **Run `os check`** locally before publishing. It calls the same
  validators the server uses on load.
* **Treat warnings like errors in CI.** Pass `severity=warning` to the
  sweep endpoint and assert `total === 0`.
* **Layered overlays merge first, then validate.** If only your runtime
  overlay fails, the source artifact is fine — the bad value is in the
  overlay. The edit banner reflects the *effective* item, so what you
  see is what features will get.

## Client SDK

```ts
import { MetadataClient } from '@object-ui/data-objectstack';

const client = new MetadataClient({ baseUrl: 'https://api.example.com' });
const summary = await client.diagnostics({ severity: 'error' });
console.log(summary.total, 'invalid item(s)');
```

The hook used by the Studio surfaces:

```ts
import { useGlobalDiagnostics, useMetadataClient } from '@object-ui/app-shell';

const client = useMetadataClient();
const {
  loading,
  error,
  summary,
  byType,         // Record<type, invalid-item-count>
  warnByType,     // Record<type, warn-only-item-count> (severity='warning' only)
  countsByType,   // Record<type, total-item-count>
  packagesByType, // Record<type, packageId[]>
  allPackages,    // packageId[] — deduped union for filter dropdowns
  reload,
} = useGlobalDiagnostics(client, 'warning');
```

Pass `severity: 'warning'` when you need `warnByType` populated — the
server omits warning-only entries when the default `'error'` severity
is in effect.
