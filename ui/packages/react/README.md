# @object-ui/react

React bindings and SchemaRenderer component for Object UI.

## Features

- ⚛️ **SchemaRenderer** - Main component for rendering Object UI schemas
- 🪝 **React Hooks** - Hooks for accessing renderer context
- 🔄 **Context Providers** - React Context for state management
- 📦 **Tree-Shakable** - Import only what you need

## Installation

```bash
npm install @object-ui/react @object-ui/core
```

**Peer Dependencies:**
- `react` ^18.0.0 || ^19.0.0
- `react-dom` ^18.0.0 || ^19.0.0

## Usage

### Basic Example

```tsx
import { SchemaRenderer } from '@object-ui/react'
import type { DeclaredNode } from '@object-ui/types'

const schema: DeclaredNode = {
  type: 'text',
  content: 'Hello, Object UI!'
}

function App() {
  return <SchemaRenderer schema={schema} />
}
```

`schema` takes a `DeclaredNode` from `@object-ui/types`, a bare string, or nothing. A
`DeclaredNode` is a node of a declared type, keyed by its `type`: a component schema that
package declares, a spec page block such as `element:text` with its typed `properties` bag, a
stored page document under its page kind, or a type your application registers and declares
in `CustomNodeRegistry`. Each node, nested ones included, is checked against its own type; a
`type` nothing declares is refused.

### With Data

Expression scope reaches the renderer through `PredicateScopeProvider`, never through a prop
on the element: `SchemaRenderer` declares only `schema`, so anything else is forwarded to the
component the schema names (see the open forwarding surface below). Every key of the `scope`
you publish becomes a root the evaluator can read.

⛔ `SchemaRendererProvider`'s `dataSource` is **not** an expression root. It carries the
host's `DataSource` adapter, and objectui#9308 removed the binding that used to publish that
adapter under the name `data` — an adapter answers no `data.*` path, so the root was constant
for every conformant host.

```tsx
import { SchemaRenderer, PredicateScopeProvider } from '@object-ui/react'
import type { DeclaredNode } from '@object-ui/types'

const schema: DeclaredNode = {
  type: 'form',
  children: [
    {
      // `content` is evaluated on every component type. `input` has no row in
      // the spec's expression carriage map, so a `${…}` in ITS `value` would be
      // rendered as those characters rather than resolved.
      type: 'text',
      content: 'Editing ${user.name}'
    },
    {
      type: 'input',
      name: 'name',
      label: 'Name'
    }
  ]
}

const scope = {
  user: { name: 'John Doe' }
}

function App() {
  return (
    <PredicateScopeProvider scope={scope}>
      <SchemaRenderer schema={schema} />
    </PredicateScopeProvider>
  )
}
```

### Handling Actions

```tsx
import { SchemaRenderer } from '@object-ui/react'
import type { DeclaredNode } from '@object-ui/types'

declare const formSchema: DeclaredNode

function App() {
  const handleSubmit = (data: Record<string, unknown>) => {
    console.log('Form submitted:', data)
  }

  // `onSubmit` is not a prop `SchemaRenderer` reads: it is forwarded to the
  // component the schema names, which is why the props type stays open.
  return (
    <SchemaRenderer
      schema={formSchema}
      onSubmit={handleSubmit}
    />
  )
}
```

### SchemaRendererProvider

Injects the host's data source (and optional capabilities) into every renderer
below it:

```tsx
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react'
import type { ApiFetch } from '@object-ui/react'
import type { DataSource, DeclaredNode } from '@object-ui/types'

declare const adapter: DataSource
declare const authenticatedFetch: ApiFetch
declare const schema: DeclaredNode

<SchemaRendererProvider
  dataSource={adapter}
  // Optional: host-authenticated fetch the renderers use for their own reads
  // of the host's API (chart metadata, dataset dimension labels, permission
  // probes), so they carry the same credentials (Authorization, tenant,
  // locale headers) as the native data channel. When omitted, those reads
  // fall back to the bare global fetch (cookies only).
  apiFetch={authenticatedFetch}
>
  <SchemaRenderer schema={schema} />
</SchemaRendererProvider>
```

`dataSource` carries the host's adapter as the published `DataSource` contract
(`@object-ui/types`), typed `DataSource | null | undefined`: a host either hands
over an adapter or states that it has none — a Studio preview, a page rendered
before the host's adapter has connected, or a widget probe driving `apiFetch`
alone. Both spellings of "none" are accepted because every reader in the tree
guards for it. The prop used to be typed `any`, so a string passed where the
adapter belongs — the shape of a config value read from the wrong place —
raised nothing until the first `find()` at runtime (objectui#7912).
`useSchemaContext()` hands the same type back to every consumer.

Nested providers inherit `apiFetch` from their parent when they don't supply
their own, so re-wrapped subtrees (embedded pages, preview surfaces) keep the
host's authentication.

## Hooks

### useSchemaContext

Access what `SchemaRendererProvider` injected — `dataSource`, `debug`,
`debugFlags` and `apiFetch`. It does **not** carry the page's values: read those
with `useDataScope`, which addresses the ambient expression scope by path. The
two are different channels on purpose — `dataSource` is the adapter a renderer
queries, `useDataScope` is what a node's `bind` resolves against
(objectui#9308).

```tsx
import { useDataScope, useSchemaContext } from '@object-ui/react'

function MyComponent() {
  const { dataSource, debug } = useSchemaContext()
  // Resolves `scope.value` from the nearest PredicateScopeProvider above.
  const value = useDataScope('value')

  if (!dataSource) return null
  return <div data-debug={debug}>{String(value)}</div>
}
```

### useElementDataSourceSchema / ElementDataSourceGate

Consume `PageComponentSchema.dataSource` — the spec's per-element data binding
(`{ object, view?, filter?, sort?, limit? }`) — in a block that has its own key
names. `useElementDataSource` resolves the binding (fetching the object's saved
views so `view` can be matched); these two apply the composed result to the
block's schema and render the two non-final states.

```tsx
import type { FC } from 'react'
import { ElementDataSourceGate } from '@object-ui/react'
import type { ElementDataSourceMapping } from '@object-ui/react'
// The seam is imported from CORE, not from here — see the note below.
import { elementDataSourceBlock } from '@object-ui/core'
import type { BaseSchema } from '@object-ui/types'

// The block this renderer wraps — whatever the registry resolves for its type.
declare const ObjectGrid: FC<{ schema: BaseSchema }>

// `mapping` names ONLY the keys this block reads. A composed value written onto
// a key the block ignores would be accepted and silently dropped — the defect
// the binding exists to remove.
const OBJECT_GRID_BINDING: ElementDataSourceMapping = {
  columns: true,          // the view's FIELD list may fill `schema.columns`
  filter: true,           // AND-combined, never replaced ("additional criteria")
  sort: true,
  limit: 'pagination.pageSize' as const,
}

// `elementDataSourceBlock` is not optional decoration — see below.
const ObjectGridRenderer = elementDataSourceBlock<FC<{ schema: BaseSchema }>>(({ schema, ...props }) => (
  <ElementDataSourceGate schema={schema} mapping={OBJECT_GRID_BINDING} testId="object-grid">
    {(bound) => <ObjectGrid schema={bound} {...props} />}
  </ElementDataSourceGate>
))
```

**Say when the placement cannot draw anything.** Two boolean props let the call
site, which knows its block's other record sources, ask the gate to answer instead
of mounting an empty block. `requiresDataSource` draws a "no data source" panel
when no adapter resolves. `requiresObject` draws a short "No object named: set
objectName or dataSource.object." hint when the node names its object in neither
place, read after the binding lands on the mapping's object key, so a node bound
by `dataSource.object` never sees it (objectui#11605). Leave either one false for
a placement that draws from inline rows or another source the block reads.

**Wrap the registered renderer in `elementDataSourceBlock`.** It is what makes
`ComponentRegistry.register` emit the `dataSource` input on that block's
authoring surface, so the key the gate READS is also the key the manifest, the
save gate, the generated JSX types and the designer DECLARE. Skip it and the
binding still works at runtime while the html tier reports `dataSource` as a prop
that does not exist — the one spelling that resolves a saved view, reported
exactly like the spellings that do nothing (objectui#6678). The declaration is
emitted from this one seam, so never hand-write a `dataSource` entry in a block's
`inputs`. `pnpm check:element-data-source-declaration` fails any source that
consumes the gate without reaching the seam.

⚠️ **Import the seam from `@object-ui/core`, not from this package** — it is one
function under one name, re-exported here for discoverability, and the check
above enforces the core import at call sites. The reason is measured, not
stylistic: a registration runs at MODULE SCOPE, 101 suites in this repo partially
mock `@object-ui/react` by hand-listing the exports they return, and a
module-scope read of a name absent from such a list throws at COLLECTION time —
the importing test file dies before running a single assertion. Taking the seam
from `@object-ui/react` reddened 17 files across all four CI shards with zero
failed assertions among them. Nothing mocks `@object-ui/core`, and every
registration module already imports `ComponentRegistry` from it.

`object` lands on `objectName` by default (pass `object: 'apiName'` for another
key, or `object: false` for a block that reads the composed binding itself).
Precedence: binding keys beat the component's own, view-sourced values are only a
baseline the component's own key overrides, and `filter` AND-combines all three.
A `view` name that does not resolve renders a configuration error rather than
falling back to the object's full scope. Use `useElementDataSourceSchema` (plus
the exported `ElementDataSourceErrorPanel` / `ElementDataSourceLoadingPanel`) when
a block cannot be wrapped — a renderer whose hooks must run before the panels.
That form still reads `dataSource`, so it still owes the seam: mark the renderer
at its registration, `register('x', elementDataSourceBlock(XRenderer), { … })` —
again importing `elementDataSourceBlock` from `@object-ui/core`.

### useElementApiDataSource — the API binding

`SchemaRenderer` honours the spec's API binding of a page element,
`dataSource: { provider: 'api', read: { url }, path? }`, on every node: it reads
the same-origin `url` with `GET` through the provider's `apiFetch` (the global
`fetch` when none is given), selects `path` from the answer, and binds the value
as `data` in the node's `${…}` holes and `visibleWhen` — and in its subtree's.
A binding the spec refuses (a cross-origin `url`, a credential key) is refused
with the spec's message and nothing is read; a failed read or an empty `path`
draws an error panel in place of the node.

`useElementApiDataSource(schema)` is the hook behind it, exported for renderers
that need the same reading; `selectElementApiPath` and `readElementApi` are its
pure halves.

Elements reading the same URL at the same time share one request. To share one
answer across readers that mount at different times, mount
`<ElementApiOpenScope open={name}>` around them: a read that has answered under
the same `open` is answered again with no request, while a failed read, a read
under another `open`, and any read after a `notifyDataChanged` ask again. The
host names the open (the console names each visit of a history entry); `readElementApi`
takes it as its third argument (`useElementApiOpen()` reads it).

```tsx
import type { ReactNode } from 'react'
import { ElementApiOpenScope } from '@object-ui/react'

// `visit` names the host's open: a new value for each visit of a page.
function PageOpen({ visit, children }: { visit: string; children: ReactNode }) {
  return <ElementApiOpenScope open={visit}>{children}</ElementApiOpenScope>
}
```

### useSettledSchema

The settled-schema RESOLUTION half, shared by every view that gates a record
query on its object definition — `ObjectKanban`, `ObjectView`,
`ObjectCalendar`, `ObjectTree` and `ObjectGantt` (objectui#6482, converged in
objectui#7225). Tracks whether an object's definition has finished resolving
FOR THE KEY THE CURRENT RENDER IS ASKING ABOUT — `ready` and `def` are two views of one piece of state, so a
stale key can never read as ready. GATE PLACEMENT — which effect actually
waits on `ready` — stays a per-component decision; this hook only owns the
resolution.

```tsx
import { useEffect } from 'react'
import { useSettledSchema } from '@object-ui/react'
import type { DataSource } from '@object-ui/types'

function ObjectSomething({
  schema,
  dataSource,
}: {
  schema: { objectName?: string }
  dataSource: DataSource
}) {
  const key = schema.objectName ?? ''
  const { ready, def } = useSettledSchema(key, dataSource)

  useEffect(() => {
    if (!ready) return // gate placement is local to this component
    // issue the record query, e.g. buildExpandFields(def?.fields)
  }, [ready, def])
}
```

Pass `dataSource: undefined` for a render that should settle immediately with
no definition (e.g. a provider that issues no metadata read at all) instead of
adding a separate enable flag.

### useFilterScope / useResolvedFilter

A data node that sends its own authored `filter` into a query resolves the
spec's context tokens in it first: `{current_user_id}`, `{current_org_id}`,
`{record_id}` and the date macros such as `{today}` (objectui#10666).
`useFilterScope()` reads the session scope a host mounts with
`FilterScopeProvider`, plus the id of the record in view when a
`RecordContextProvider` is mounted above the node (objectui#7297);
`useResolvedFilter(filter, scope)` resolves the filter through
`@object-ui/core`'s `resolveFilterPlaceholders` and HOLDS the result.

`{record_id}` is the id of the record a `type: 'record'` page shows, taken from
that page's mounted record context and never from a URL parameter or a page
variable: on a person's record page, `{ assignee: '{record_id}' }` counts that
person's tasks. With no record in context (a list view, a dashboard, a page
that is not a record page) it is refused by name, with the same warning an
unresolved `{current_user_id}` gets, and left as written, so the filter never
widens. It scopes what a component shows; it is not access control, which
stays with the server's row-level security. `FilterScopeProvider` carries the
session values only.

```tsx
import { useEffect } from 'react'
import { useFilterScope, useResolvedFilter } from '@object-ui/react'
import type { DataSource, QueryParams } from '@object-ui/types'

function ObjectSomething({
  schema,
  dataSource,
}: {
  schema: { objectName: string; filter?: QueryParams['$filter'] }
  dataSource: DataSource
}) {
  const filterScope = useFilterScope()
  const filter = useResolvedFilter(schema.filter, filterScope)

  useEffect(() => {
    // Query with the held value and key the effect on it, never on schema.filter.
    void dataSource.find(schema.objectName, { $filter: filter })
  }, [dataSource, schema.objectName, filter])
}
```

The held value keeps its reference while the authored filter is structurally
equal (a filter rebuilt inline on every render included) and the scope's user,
organization, record and `onUnresolved` are unchanged, so the effect above runs
once. A structurally different filter, a new signed-in user or organization, or
another record in view resolves again. A filter with no token to resolve is handed back as the value
passed in. A token the scope cannot resolve is left in place, and the resolver
logs one warning naming it.

### NON_GRID_ROW_CEILING

The platform's hard row ceiling for a NON-GRID visualisation — gantt, calendar,
map and tree (objectui#7210). Those four fetch the whole FILTERED result set,
because a truthful range or layout needs all of it, but the fetch is bounded:
past the ceiling they draw the first N rows and say so.

The mechanism lives in `@object-ui/core` (objectui#7508): `NON_GRID_ROW_CEILING`,
`nonGridRowCeilingQuery` and `applyNonGridRowCeiling`, with the result type
`NonGridCeilingResult`. This package re-exports `NON_GRID_ROW_CEILING`,
`applyNonGridRowCeiling` and `NonGridCeilingResult`, and owns the React half —
the footnote, `NonGridRowCeilingNote`.

```tsx
import { NonGridRowCeilingNote, applyNonGridRowCeiling } from '@object-ui/react'
import { nonGridRowCeilingQuery } from '@object-ui/core'
import type { DataSource, QueryParams } from '@object-ui/types'

declare const dataSource: DataSource
declare const objectName: string
declare const schema: { filter?: QueryParams['$filter'] }

const result = await dataSource.find(objectName, {
  $filter: schema.filter,
  ...nonGridRowCeilingQuery(), // `$top`: the ceiling plus ONE probe row
})
// The semicolon is load-bearing: the next statement opens with `<`, so without
// it the call above is parsed as the left side of a relational expression.
const capped = applyNonGridRowCeiling(result);
// …draw `capped.rows`, then hand the note the whole result:
<NonGridRowCeilingNote result={capped} />
```

`nonGridRowCeilingQuery()` is the one place the probe row is written: `$top` is
the ceiling plus one, because the extra row is what makes truncation a fact about
the rows in hand — `QueryResult.total` is optional and a bare-array response
carries none. Spread it into the query; never spell the `+ 1` at a call site.

`NonGridRowCeilingNote` takes the `NonGridCeilingResult` and nothing else. The
count it prints is `result.rows.length` and the total is `result.total`, so the
footnote cannot name numbers that disagree with the rows drawn. It renders `null`
when nothing was truncated, so it can be mounted whenever a result is in hand.

⛔ The ceiling is not authorable and must not become so. Silent truncation is
the failure it exists to prevent — a cut-off schedule still looks like a
schedule — so a view that caps rows without rendering the note is a defect, not
an optimisation.

### resolveInlineAriaProps

Maps the spec's nested `aria` bag (`AriaPropsSchema`, the `aria` prop a block
such as `element:text` declares) to the DOM attributes it names
(objectui#11051):

- `ariaLabel` → `aria-label`. A plain string is used as written; an inline
  locale map (`{ en: 'Order total', 'zh-CN': '订单合计' }`) gives the entry for
  `locale`, through the spec's own `resolveI18nLabel`.
- `ariaDescribedBy` → `aria-describedby`.
- `role` → `role`.

Only attributes that have a value are returned, so the result can be spread
onto an element directly. It is a pure function: pass the locale yourself, in
React from `useDisplayLocale()`.

```tsx
import { resolveInlineAriaProps } from '@object-ui/react'
import { useDisplayLocale } from '@object-ui/i18n'
import type { AriaProps } from '@object-ui/types'

function CloseButton({ aria, onClose }: { aria?: AriaProps; onClose: () => void }) {
  const locale = useDisplayLocale()
  return (
    <button type="button" onClick={onClose} {...resolveInlineAriaProps(aria, locale)}>
      ×
    </button>
  )
}
```

This is not the reader `SchemaRenderer` applies to a node's FLAT `ariaLabel`,
which is objectui's keyed `{ key, defaultValue }` form. Each resolver returns
nothing useful for the other's shape, so the two stay separate (objectui#4580).

### usePrintPage / PrintPageProvider

`usePrintPage()` returns the `print` declaration of the page the component
renders in, or `null` outside a print page (objectui#11958). `PageRenderer` in
`@object-ui/components` mounts `PrintPageProvider` for a page whose `print` is
an object. A block that draws only part of its data on screen reads it so that
a printed copy does not drop data in silence:

```tsx
import type { ReactNode } from 'react'
import { usePrintPage } from '@object-ui/react'

function Section({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  // A collapsed section never reaches paper, so a print page draws it open.
  const open = usePrintPage() !== null || !collapsed
  return open ? <section>{children}</section> : null
}
```

### RelatedRecordActionsProvider / useRelatedRecordActions

The host's navigation seam for low-level renderers that have no router. The
host (the console's record, list and custom pages) publishes a
`RelatedRecordActionsValue`; renderers read it with `useRelatedRecordActions()`,
which returns `null` when no host provides one.

- `resolve(input)` returns the CRUD and action handlers for a related list.
- `recordHref(objectName, recordId)` / `openRecord(...)` address one record's
  page: a document href for a real anchor, and the SPA navigation a plain left
  click uses.
- `listHref(objectName, viewName?)` / `openList(...)` address an object's list
  page, or one of its saved views when `viewName` is given. The compact list a
  page draws in a narrow region links "View all" through them. They take an
  object and a view name only: a caller cannot hand them a filter, columns or a
  sort to encode.

Every member but `resolve` is optional. An absent member, or one that answers
`null`, means the host cannot route there, and the renderer draws no link.

```tsx
import type { ReactNode } from 'react'
import { RelatedRecordActionsProvider } from '@object-ui/react'
import type { RelatedRecordActionsValue } from '@object-ui/react'

declare const navigate: (to: string) => void

const listPath = (objectName: string, viewName?: string): string =>
  viewName ? `/apps/crm/${objectName}/view/${encodeURIComponent(viewName)}` : `/apps/crm/${objectName}`

const host: RelatedRecordActionsValue = {
  resolve: () => ({}),
  listHref: (objectName: string, viewName?: string) => listPath(objectName, viewName),
  openList: (objectName: string, viewName?: string) => navigate(listPath(objectName, viewName)),
}

export function PageHost({ children }: { children: ReactNode }) {
  return <RelatedRecordActionsProvider value={host}>{children}</RelatedRecordActionsProvider>
}
```

### ComponentRegistry

There is no registry hook: the registry is a process-level singleton exported
by `@object-ui/core`, so read it directly. Subscribe to it only when a lazily
registered plugin must trigger a re-render.

```tsx
import { ComponentRegistry } from '@object-ui/core'

function MyComponent(props: Record<string, unknown>) {
  const Component = ComponentRegistry.get('button')

  return Component ? <Component {...props} /> : null
}
```

### useDiscovery

Access server discovery information — service availability and server identity:

```tsx
import { useDiscovery } from '@object-ui/react'

function MyComponent() {
  const { discovery, isLoading, isAuthEnabled, isAiEnabled } = useDiscovery()
  
  // Check if AI service is available
  if (isAiEnabled) {
    console.log('AI service route:', discovery?.services?.ai?.route)
  }

  return <div>Server: {discovery?.name}</div>
}
```

#### DiscoveryInfo

| Property | Type | Description |
| --- | --- | --- |
| `name` | `string` | Server name |
| `version` | `string` | Server version |
| `mode` | `string` | Runtime mode the server reports (`RuntimeMode` in `@objectstack/spec`) |
| `services` | `object` | Service availability status (auth, data, metadata, ai) |
| `capabilities` | `string[]` | API capabilities |

> The `previewMode` block and the `'preview'` runtime mode were retired in
> objectui#6654, following their retirement in `@objectstack/spec`
> (objectstack#11846). A server that still sends them is read as any other
> payload: authentication follows `services.auth` alone, so a preview
> deployment requires login rather than silently running with auth off.
> `AuthProvider`'s `previewMode` **prop** in `@object-ui/auth` is a separate,
> host-supplied capability and is unaffected.

### useNotifications / useNotificationsByPresentation

`NotificationProvider` implements the spec `NotificationSchema`. A notification's
`severity` picks its icon and tone; its `displayType` picks the **surface** that
renders it — and each of the five spec types has a distinct one:

| `displayType` | Presentation | Rendered by | Auto-dismiss |
| --- | --- | --- | --- |
| `toast` | transient overlay | the `onToast` delegate | yes |
| `snackbar` | bottom-anchored bar, one at a time, one action | `<NotificationSnackbar />` | yes |
| `banner` | page-width strip in the content flow | `<NotificationBanners />` | no |
| `alert` | blocking acknowledgement dialog (FIFO) | `<NotificationAlerts />` | no |
| `inline` | in place, at the raising surface | `<NotificationInline />` | no |

The surface components ship in `@object-ui/components`; mount them where they
belong (a banner is in flow, an inline notification sits next to its raiser).
`onToast` receives **only** `toast` items — it used to receive all five, which is
why every type looked like a toast.

```tsx
import { useNotifications } from '@object-ui/react'

const { notify } = useNotifications()

notify({ title: 'Saved', severity: 'success' })                     // toast (spec default)
notify({ title: 'Viewing a draft', severity: 'warning', displayType: 'banner' })
notify({ title: 'Fix 2 fields', severity: 'error', displayType: 'inline', scope: 'contact-form' })
```

A surface component subscribes with `useNotificationsByPresentation(type, scope?)`,
which also registers the surface — raising a `banner` with no banner surface
mounted warns in dev instead of vanishing.

`config` is the spec `NotificationConfigSchema` (`defaultPosition`,
`defaultDuration`, `maxVisible`, `stackDirection`, `pauseOnHover`); the legacy
`position` / `stacking` spellings still resolve through
`resolveNotificationConfig`. Three helpers apply it so every surface agrees:
`resolveNotificationPosition` (a declared position always wins; nothing declared
leaves the surface on its own anchor), `visibleNotificationStack` (`maxVisible` +
`stackDirection`), and the context's `pauseAutoDismiss` / `resumeAutoDismiss`
(`pauseOnHover`). See the
[notifications guide](https://objectui.org/docs/guide/notifications).

## API Reference

See [full documentation](https://objectui.org/docs/core/schema-renderer) for detailed API reference.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/core/schema-renderer)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/react)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
