# Pages & Docs

- [Pages — Lightning-Style Page Layouts](#pages--lightning-style-page-layouts) · [Page Types](#page-types) · [Templates & Regions](#templates--regions)
- [Component Catalogue](#component-catalogue-selection) · [Print pages](#print-pages)
- [AI-authored source pages](#ai-authored-source-pages--kindhtml-and-kindreact-adr-00800081) · [Styling a page](#styling-a-page-adr-0065--responsivestyles-not-classname)
- [Docs — Package Documentation](#docs--package-documentation-adr-0046) · [Authoring rules](#authoring-rules-each-enforced-by-os-build)
- [Routing model](#routing-model--platform-level-viewer-opt-in-entry) · [Inline metadata views](#inline-metadata-views--the-metadata-fence-adr-0051) · [Example](#example)

## Pages — Lightning-Style Page Layouts

A **Page** is a Salesforce-Lightning-style layout composed of **regions**
populated with **components**.

Register under `defineStack({ pages: [...] })`.

### Page Types

`PageTypeSchema` has exactly **five** values — only types with a dedicated
renderer are authorizable (ADR-0049 enforce-or-remove):

| `type`    | Purpose |
|:----------|:--------|
| `record`  | Component-based record layout with regions (overrides the default record detail) |
| `home`    | App home / landing page |
| `app`     | App-level page with navigation context |
| `utility` | Floating utility panel (e.g. notes, phone dialer) |
| `list`    | Record list/grid interface page — configured via `interfaceConfig` |

Disambiguation: there is **no** `record_detail`, `app_launcher`, or
`utility_bar` type — a record layout is `type: 'record'`, an app-level page is
`type: 'app'`, a utility panel is `type: 'utility'`. Likewise
grid/kanban/calendar/gallery/timeline are NOT page types — they are
*visualizations* of a `list` page
(`interfaceConfig.appearance.allowedVisualizations`). Former roadmap-only types
(`dashboard`, `form`, `record_detail`, `record_review`, `overview`, `blank`)
were removed from the enum because they never shipped a renderer.

### Templates & Regions

`template` controls the column layout (e.g. `'three-column'`,
`'two-column'`, `'single-column'`). Each template exposes named
**regions** (`header`, `left_sidebar`, `main`, `right_sidebar`, `footer`)
which contain components.

### Component Catalogue (selection)

| `type`               | Use |
|:---------------------|:----|
| `page:header`        | `title` / `subtitle` templates + `actions: string[]` — ids of the bound object's actions, never a sibling action node |
| `page:card`          | Bordered/un-bordered card with `children: Component[]` (plus an optional `footer: Component[]` slot) |
| `flex`               | Generic styleable box (`properties.children`) — the workhorse for custom layout; style via `responsiveStyles` (see Styling below) |
| `element:text`       | Text node — `properties.content`; style via `responsiveStyles` |
| `element:button`     | Button — `properties.label` + `variant`/`size` + optional `action` |
| `record:highlights`  | Salesforce highlights panel — strip of key fields (`properties.fields`) |
| `record:path`        | Stage progress bar — `statusField` + `stages: [{ value, label }]` |
| `record:related_list` | Related-list (child records via lookup) |
| `nav:menu`           | Quick-create / nav menu bound to current context |
| `object-metric`      | Single KPI widget (count/sum/avg) |
| `object-chart`       | Embedded chart |

> **Variable substitution** — `{first_name}`, `{current_user.first_name}`,
> `{current_quarter_start}` etc. resolve from the page's `variables` block,
> the bound record, and the runtime context. Declare `variables: [...]` at
> the page root for any non-record value; relative-date placeholders:
> [Date Macros](../SKILL.md#date-macros--filter-placeholders).

### Print pages

An invoice, a delivery order, a letter or a report is an ordinary page with a
**`print`** declaration — there is no template type; the page's own blocks are
the document. Only a `kind: 'full'` page of `type: 'record'`, `'home'` or
`'app'` with its blocks in `regions` may declare it: the parse refuses `print`
on a `list` page (its switch is `interfaceConfig.allowPrinting`), a `utility`
panel, a `slotted` / `html` / `react` page and a `full` page with no regions.

`print` keys, each mapped to print CSS: `paperSize` (`'A4'` default, `'A5'`,
`'Letter'`, `'Legal'`) and `orientation` (`'portrait'` default, `'landscape'`);
`margins: { top, right, bottom, left }` in **millimetres**; `repeatHeader` /
`repeatFooter` repeat the page's own `header` / `footer` region on every sheet
(refused without that region; off = printed once); `pageNumbers` prints sheet
number and count; the page-break hints `repeatTableHeaders` (on by default)
and `avoidBreakInside` (keep each block whole).

Every block, at any depth, must draw all it declares, in full, the same at
any width: the containers `page:section` / `page:card` /
`page:footer`, the field blocks `record:details` / `record:highlights`, the
all-lines child table `record:line_items`, `element:text` / `element:image` /
`element:divider` / `element:definition-list` / `element:repeater`, and the
single values `element:number` / `object-metric`. `os validate` / `os build`
and the page save door refuse any other block (`print-page-block-unprintable`)
with its reason: it **draws a window of its rows** (`record:related_list`,
`object-grid` — use `record:line_items`), it **lays itself out to the screen**
(`page:header`, sidebars, kanban / calendar / gantt / map), it has **nothing
to print** (`record:path`, tabs, buttons, inputs, forms — values print through
`record:details`), or it is **outside the vocabulary** (`flex`, `object-chart`,
a plugin widget), so nothing answers for how it prints.

Validated today; the console's print rendering that applies it follows, so
`os validate` warns the layout is not yet applied. List export has no `'pdf'`;
a list prints as shown via the view's `allowPrinting`.

<!-- os:check -->
```typescript
import { definePage } from '@objectstack/spec/ui';

export const InvoicePrintPage = definePage({
  name: 'invoice_print', label: 'Invoice', type: 'record', object: 'invoice',
  print: { paperSize: 'A4', margins: { top: 15, right: 12, bottom: 15, left: 12 },
           repeatHeader: true, repeatFooter: true, pageNumbers: true },
  regions: [
    { name: 'header', components: [
      { type: 'element:text', properties: { content: 'ACME Ltd' } },
    ] },
    { name: 'main', components: [
      { type: 'record:details' },
      { type: 'record:line_items', properties: { childObject: 'invoice_line', relationshipField: 'invoice',
          columns: [{ name: 'product' }, { name: 'quantity' }, { name: 'unit_price' }, { name: 'amount' }] } },
    ] },
    { name: 'footer', components: [
      { type: 'element:text', properties: { content: 'Due within 30 days.' } },
    ] },
  ],
});
```

### AI-authored *source* pages — `kind:'html'` and `kind:'react'` (ADR-0080/0081)

Besides the structured `regions` model above, a page's whole body can be written
as a *source string* in `source`, with `kind` choosing the authoring tier. Pick
by what the page needs:

| `kind` | Author writes | JS runs? | Use when |
|:--|:--|:--|:--|
| `full` / `slotted` | structured `regions` / `slots` (no `source`) | — | record/detail/home layouts from the component catalogue |
| `html` | constrained JSX = registered components + safe native HTML, **parsed, never executed** | no | free-form layout / landing / dashboard that just *composes* blocks — no interactivity |
| `react` | **real React** (hooks, `.map`, `onClick`, expressions) | yes (main React tree) | complex interactive business UIs — master/detail, wizards, state-driven filters |

`source` is the source-of-truth in both source tiers; `regions` is ignored. A
`kind:'html'`/`'react'` page with no `source` fails the build (ADR-0078). The legacy
value `kind:'jsx'` is a deprecated alias for `kind:'html'`.

#### `kind:'html'` — constrained JSX, parsed (safe by construction)

Tags are the **registered components** (bare names: `<flex>`, `<grid>`, `<card>`,
`<object-grid>`, `<object-form>`, `<object-metric>`, …) **plus the safe native HTML
set** (`<h1>`–`<h6>`, `<p>`, `<a>`, `<ul>/<ol>/<li>`, `<img>`, `<blockquote>`, `<strong>`,
…). Props come from each component's registry `inputs` (e.g. `<text content=…>`,
`<badge label=…>`). **No JavaScript** — `onClick`, `{expr}` logic and `.map()` are NOT
available; use `kind:'react'` for those. `os build` parses the source and fails loudly
on unknown tags / missing required props / forbidden constructs (event handlers,
`dangerouslySetInnerHTML`).

```typescript
export const ReleaseNotesPage = definePage({
  name: 'release_notes', label: 'Release Notes', type: 'home', kind: 'html',
  source: `
<flex direction="col" gap={6} style={{"maxWidth":"768px","margin":"0 auto","padding":"40px"}}>
  <h1 style={{"fontSize":"32px","fontWeight":700,"color":"hsl(var(--foreground))"}}>Release Notes</h1>
  <object-metric objectName="ticket" aggregate={{"function":"count"}} label="Open tickets" />
</flex>`,
});
```

#### `kind:'react'` — real React, executed (trusted tier)

The source is real React executed at render by the runtime. The injected scope are
**closure variables (NOT props)** — reference them directly:

- `React` — hooks (`React.useState`, `React.useEffect`, …)
- `useAdapter()` — live data: `adapter.find('obj', {…})` / `.findOne` / `.create` / `.update`
- `useDataInvalidation('obj')` — the data-invalidation bus nonce (a number): name it in the
  deps of the effect that reads through `useAdapter`, so a page action elsewhere that writes
  `obj` re-runs that read in place, with no remount
- the public **data blocks as PascalCase components** — `<ObjectForm>`, `<ListView>`,
  `<ObjectMetric>`, `<ObjectChart>`, `<ObjectKanban>`, … The scope is built at
  runtime from the public block registry (every non-container public block gets a
  PascalCase wrapper), so blocks like `<ObjectMetric>` / `<ObjectKanban>` exist
  even though the written contract below documents only the curated core set;
  `<Block type="…" …/>` is the escape hatch for any other registered type.
  **Exception — the `record:*` family is NOT usable here** (`<RecordDetails>`,
  `<RecordHighlights>`, `<RecordRelatedList>`, `<RecordPath>`, `<RecordActivity>`,
  …): the registry injects a wrapper for each, but every one of them renders from
  the record context a **record page** mounts, which a react page never does — so
  they come back empty. `os validate` rejects them here
  (`react-block-needs-record-context`), by tag and via `<Block type="record:…">`.
  On a react page the parent record is ordinary React state, so use the blocks
  that read their own props: `<ListView data={{ provider: 'object', object:
  '<child>' }} filters={['<lookup>', '=', parentId]}>` for a related list,
  `<ObjectForm mode="view" recordId={…}>` for a field panel, plain JSX over
  `useAdapter().findOne` for a highlights strip or a stage bar. Need the family
  itself? Author the page as `type:'record'`, where the context exists
- `data` / `variables` / `page`

> **Do not guess props — read the contract.** Each injected block's full prop set
> (name, type, `data`/`controlled`/`callback` kind, required, description) is the
> **[React-tier component contract](../references/react-blocks.md)**, generated from
> the block→schema index in `@objectstack/spec`.
> The `data` props are sourced from the platform's spec schemas (FormView,
> ListView, Chart, …) — the same protocol the server validates;
> `binding`/`controlled`/`callback` are the React overlay.

Master/detail (click a row → edit it → save refreshes the list):

<!-- os:check -->
```tsx
import { definePage } from '@objectstack/spec/ui';

export const CrmWorkbenchPage = definePage({
  name: 'crm_workbench', label: 'CRM Workbench', type: 'home', kind: 'react',
  source: `
function Page() {
  const [sel, setSel] = React.useState(null);
  const [reload, setReload] = React.useState(0);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24, padding: 32, alignItems: 'start' }}>
      <ListView key={reload} data={{ provider: 'object', object: 'project' }}
        fields={['name','status','owner']} navigation={{ mode: 'none' }}
        onRowClick={(r) => setSel(r)} />
      {sel
        ? <ObjectForm objectName="project" mode="edit" recordId={sel.id}
            onSuccess={() => { setSel(null); setReload((k) => k + 1); }} />
        : <p style={{ color: 'hsl(var(--muted-foreground))' }}>Select a project to edit.</p>}
    </div>
  );
}`,
});
```

**Safety / availability.** `kind:'react'` executes author code in the app, so it is gated
by the host capability `react-pages` — **ON by default** (the platform trusts reviewed,
draft-gated authors). A deployment that does not trust its authors turns it off server-side
with `OS_PAGE_REACT=off`; the page then shows a "disabled" notice instead of executing.
`os build` does NOT lint react source (it is real JS, not constrained JSX) — errors surface
at render behind an error boundary, so always test a react page in the browser.

### Styling a page (ADR-0065) — `responsiveStyles`, NOT `className`

To style a metadata-authored block, give it a **`responsiveStyles`** object — a
per-breakpoint map of CSS properties. The renderer compiles each styled node to
**id-scoped CSS** at render time. **Do NOT put Tailwind classes in `className`**
expecting them to render: Tailwind is compiled at the *renderer's* build over the
*renderer's* source, never over your metadata, so a class only happens to work if
objectui already uses it — arbitrary classes (`text-[27px]`, `bg-[#1a2b3c]`,
`grid-cols-7`) silently do nothing. `responsiveStyles` has no such trap (values
are compiled from your data at render).

Rules:
- **`responsiveStyles` and `id` are top-level** envelope fields; **child nodes go
  in `properties.children`** (the renderer hoists `properties` to schema level).
- Every styled node **needs a stable `id`** (the CSS is scoped to it).
- **Values should be design tokens** for consistency: spacing `var(--space-1..12)`,
  radius `var(--radius)` / `var(--radius-xl)`, shadow `var(--shadow-sm|md|lg)`,
  colors `var(--surface)` / `var(--surface-sunken)` / `var(--text-strong)` /
  `var(--text-muted)` / `var(--brand)` / `var(--brand-foreground)` /
  `var(--hairline)`, or `hsl(var(--primary))` etc. (theme tokens track light/dark).
- **Responsive lives in the breakpoint maps** — `large` (base, desktop-first),
  then `medium` / `small` / `xsmall` as `max-width` overrides. **Never** author
  `md:`-style variant classes.
- **Compose from generic styleable blocks** — `flex`, `element:text`,
  `element:button` — and style each block's root. (`page:card` etc. are fine for
  structure but style what you control.)

```typescript
// A styled pricing card — every block carries responsiveStyles + tokens.
{
  id: 'plan_solo', type: 'flex',
  responsiveStyles: {
    large: {
      display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
      padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)',
      backgroundColor: 'var(--surface)', border: '1px solid hsl(var(--primary))',
      boxShadow: '0 0 0 3px hsl(var(--primary) / 0.25), var(--shadow-lg)',
    },
    small: { padding: 'var(--space-4)', gap: 'var(--space-3)' },  // responsive via the model
  },
  properties: {
    children: [
      { id: 'plan_solo_price', type: 'element:text',
        responsiveStyles: { large: { fontSize: '40px', fontWeight: '700', color: 'var(--text-strong)' }, small: { fontSize: '32px' } },
        properties: { content: '$29' } },
      { id: 'cta_solo', type: 'element:button',
        responsiveStyles: { large: { marginTop: 'auto', width: '100%' } },  // pin CTA to card bottom
        properties: { label: 'Upgrade', variant: 'primary', size: 'large' } },
    ],
  },
}
```

The spec field is `PageComponentSchema.responsiveStyles` (`ResponsiveStylesSchema` —
see `node_modules/@objectstack/spec/src/ui/responsive.zod.ts`).

**In the source tiers (`kind:'html'` / `kind:'react'`) the same rule holds — no
Tailwind `className` — but the primitive differs:**

- **`kind:'html'`** — lay out with the registered components' own structured props
  (`<flex direction="col" gap={6}>`, `<grid columns={4}>` compile their *own*,
  already-shipped classes) and add CSS with a **`style` object written as JSON**
  (quoted keys/values): `style={{"padding":"40px","color":"hsl(var(--foreground))"}}`.
  A JS-style object (`{{padding: 40}}`) is parsed as a deferred expression and will
  NOT apply — keys and string values must be double-quoted.
- **`kind:'react'`** — it's real React, so style with an ordinary inline
  **`style={{}}`** object using `hsl(var(--token))` theme colors:
  `color: 'hsl(var(--foreground))'`, `background: 'hsl(var(--card))'`,
  `border: '1px solid hsl(var(--border))'`, `borderRadius: 'var(--radius)'`. Tokens
  are HSL **triplets**, so always wrap them: `hsl(var(--card))`, never bare
  `var(--card)`; a translucent scrim is `hsl(0 0% 0% / 0.5)`. For a **drawer/modal**,
  render `<ObjectForm formType="drawer"|"modal" open onOpenChange={…}>` — it ships a
  pre-styled Sheet/Dialog with backdrop + animation (`open`/`onOpenChange` are
  read by the component at runtime; they sit outside the contract's `data` prop
  tables); never hand-roll a `fixed inset-0` overlay (its utility classes won't
  compile, so it renders as unstyled boxes with no backdrop).

---

## Docs — Package Documentation (ADR-0046)

A **Doc** is a page of package documentation shipped *as metadata*. You
author plain Markdown in a flat `src/docs/` directory; `os build`
compiles each `*.md` into a `doc` item that travels inside the package
artifact and renders in the console at `/docs/<name>`. Docs are also the
grounding the AI assistant reads about a package.

### Authoring rules (each enforced by `os build`)

1. **Flat directory.** Every `.md` lives directly in `src/docs/`;
   subdirectories are a build error. Flatness is what keeps links stable
   — a reference resolves by basename, never by path.
2. **Namespace-prefixed filename.** The filename stem becomes the doc
   `name` (`^[a-z][a-z0-9_]*$`) and must start with the package namespace
   (`crm_…`). `os build` refuses a bare `user_guide`
   (`docs/namespace-prefix`) — hygiene, not uniqueness: two packages
   coexist on one bare name (ADR-0048 §3.4).
3. **Title** resolves: frontmatter `title:` → first `#` heading → `name`.
   Optional frontmatter `description:` is a one-line summary the docs portal
   shows under the title — add it on index/overview docs.
4. **Pure Markdown.** CommonMark + GFM only, plus heading anchors, fenced
   code highlighting, and GitHub alerts (`> [!NOTE]`, `> [!WARNING]`, …).
   **MDX and image references are rejected at build time** — docs are
   publisher content rendered inside the platform (no authored code across
   the trust boundary; images await a content-addressed asset service).
5. **Cross-references** use plain relative links — `[overview](./crm_index.md)`.
   The console rewrites `*.md` → `/docs/<target>` (anchors preserved);
   broken same-package links fail the build.

**Write business concepts, not machine inventories.** A hand-copied table of
objects, fields or components has no producer and drifts; the self-describing
metadata is the one source. A doc answers *what is this, what business problem
does it solve, how do I use it*. Boundary: a fact the reader sees on screen
(the view list in an app's navigation) is documentable; the semantic layer
behind the screen is not.

### Routing model — platform-level viewer, opt-in entry

The viewer is **platform-level**: one global `/docs/<name>` route
resolves any doc regardless of which app you came from. The URL is
**single-coordinate** — no package or app prefix — so a doc has exactly
one URL. Do **not** design per-app or per-package doc URLs; that gives one
doc many addresses and breaks cross-references.

To surface a doc inside an app, add a navigation item that **links into**
that global URL. There is no dedicated `doc` nav-item type yet, so use a
`url` item pointing at `/docs/<name>`:

```typescript
navigation: [
  { id: 'nav_help', type: 'url', url: '/docs/crm_user_guide',
    label: 'User Guide', icon: 'book-open' },
]
```

> **Live instances.** For a *live, interactive
> instance* — a dashboard, a report, a record table — **don't embed it**:
> link to it by URL and let the platform render it (one source, never a
> stale copy).

### Inline metadata views — the `metadata` fence (ADR-0051)

A `metadata` fenced block embeds a **live, read-only** view of one metadata
item, resolved from the *current* metadata at render time — change the rule and
the diagram follows; it is never a screenshot. The body is flat `key: value`
**data, not code**, so it stays inside the §3.4 trust boundary.

Three view kinds:

| `type` | renders | required | optional |
| :--- | :--- | :--- | :--- |
| `state_machine` | a record's lifecycle transition graph (from a `state_machine` validation rule) | `object` + `name` (the rule) | `detail`, `mode` |
| `flow` | a flow's steps; `detail: business` (default) folds purely technical nodes | `name` | `detail` (`business`\|`technical`), `mode` |
| `permission` | a permission set's object-level C/R/U/D matrix | `name` | `mode` |

````md
Tasks move across the board only by these rules:

```metadata
type: state_machine
object: crm_task
name: crm_task_status_flow
```
````

`os build` lints every fence: `type` must be one of the three (typo →
did-you-mean), `name` is required, `state_machine` also needs `object`, and
the referenced object-rule / flow / permission set **must exist in this
package** — a dead same-package reference fails the build (same posture as
a broken link). At render time a missing or forbidden reference degrades to
a placeholder, never a crash.

Embedding an `object` (data model) or an arbitrary SDUI
component is **not** supported. **`permission` caveat:** the matrix is not
yet projected to the reader's own permissions (ADR-0051 P3) — do not place a
`permission` embed in a doc reachable by less-privileged or anonymous
readers until that lands.

### Example

```md
---
title: CRM Overview
description: Accounts, contacts, and opportunities — start here.
---

# CRM

Manages accounts, contacts, and opportunities.

> [!TIP]
> New here? Start with the [user guide](./crm_user_guide.md).

| Object | Purpose |
| :--- | :--- |
| `crm_account` | Companies and organizations |
| `crm_contact` | People at an account |
```
