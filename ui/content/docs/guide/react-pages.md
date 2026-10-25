---
title: React Pages
description: Author a page body as real React (kind:'react') or as constrained JSX that is parsed and never executed (kind:'html') — and how to choose between them.
---

# React Pages

Most pages in ObjectUI are a **schema tree** — `regions[].components[]` of JSON
nodes. Two page kinds let you write the body as **source** instead, for layouts
that are awkward to express as nested JSON:

| `kind` | Source is | Executed? | Author trust |
|---|---|---|---|
| `"html"` | Constrained JSX/HTML | **No** — parsed into a schema tree | Untrusted OK |
| `"react"` | Real React (hooks, handlers, arbitrary JS) | **Yes** — in the main React tree | Trusted only |

Both set `source` and leave `regions` unused. The former alias `"jsx"` was retired
in `@objectstack/spec` 18 and is refused; author `"html"`.

> Page `kind` also carries the record-page override values `"full"` (default)
> and `"slotted"` — a different axis, covered in [Slotted Pages](./slotted-pages.md).

## Choosing between them

Reach for **`kind:'html'`** by default. It is parsed, whitelisted against the
public block manifest, and never executed, so it is safe for AI-generated and
customer-authored pages. It covers layout, blocks, and styling — styling through
the blocks' own structured props plus a JSON `style` object, **not** Tailwind
(see *Styling*, below; the rule holds on both tiers).

Reach for **`kind:'react'`** only when you need real behaviour the schema tree
cannot express — local state, computed lists, event handlers wiring one block to
another, custom data fetching. It runs **without a sandbox**.

## `kind:'react'`

```json
{
  "type": "home",
  "name": "project_console",
  "kind": "react",
  "source": "function Page() {\n  const [selected, setSelected] = React.useState(null);\n  return (\n    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>\n      <ListView data={{ provider: 'object', object: 'showcase_project' }} fields={['name', 'status']} onRowClick={(r) => setSelected(r._id)} />\n      {selected && <ObjectForm objectName=\"showcase_project\" mode=\"edit\" recordId={selected} />}\n    </div>\n  );\n}"
}
```

Written out, that `source` is:

```jsx
function Page() {
  const [selected, setSelected] = React.useState(null);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <ListView
        data={{ provider: 'object', object: 'showcase_project' }}
        fields={['name', 'status']}
        onRowClick={(r) => setSelected(r._id)}
      />
      {selected && <ObjectForm objectName="showcase_project" mode="edit" recordId={selected} />}
    </div>
  );
}
```

### The security gate

A react page's source is transpiled and evaluated directly in the application —
no isolation, full access to the page's React tree. The platform assumes page
authors are reviewed and draft-gated, so the host capability `react-pages`
defaults **ON**.

A deployment that does not trust its authors turns it off server-side with
`OS_PAGE_REACT=off` (or `disableCapability('react-pages')` in the host). Pages
then render an explanatory notice instead of executing. Existing `kind:'html'`
pages are unaffected.

### What is in scope

Nothing is imported. These identifiers are injected as closure variables:

| In scope | What it is |
|---|---|
| `React` | The host's React — call hooks with it (`React.useState`). |
| The public data blocks | Every public non-container block, as a PascalCase tag *on this tier* — but *what resolves* and *what you author against* are two different sets, below. |
| `Block` | Escape hatch for anything not injected. |
| `useAdapter` | The live data source — query/create/update. |
| `useDataInvalidation` | The data-invalidation bus reader: `useDataInvalidation('object')` returns a number that moves when a write to that object is reported. Name it in the dependencies of an effect that reads through `useAdapter` — see *Live data*, below. |
| `data`, `variables`, `page` | The page's own data, local variables, and schema. |

#### Two tiers: what resolves, and what you author against

**The runtime scope** is every block in the curated public contract
(`PUBLIC_BLOCKS`) that is not a layout container. **On this tier** tags are
derived by splitting the registry type on `-`, `_` and `:` and PascalCasing each
part: `object-grid` → `<ObjectGrid>`, `record:details` → `<RecordDetails>`. A
`kind:'html'` page writes the registry type itself instead — `<object-grid>`,
`<record:details>`. Blocks registered lazily are in scope too — you never wait
on a plugin chunk to reference one. The intrinsic HTML elements the `html` tier
declares (`h1`, `p`, `a`, the sectioning tags, … — `HTML_TIER_INTRINSICS`, carried
in `sdui.manifest.json` as `tier: 'html'`) are **not** injected here: on this tier
a lowercase `<p>` is React's own element, and no `<P>` wrapper exists.

**The authored contract** is the much smaller set that has *published props* —
checked by `os validate` and generated into the reference an author, human or AI,
writes against: **`<ObjectForm>`, `<ListView>`, `<ObjectChart>`, `<Block>`**.
That set is `REACT_BLOCKS` in `@objectstack/spec`, and the generated per-prop
table is `skills/objectstack-ui/references/react-blocks.md` in the framework
repo. **Treat that table as the prop authority, not this page.**

Everything in the runtime scope but outside the contract still resolves and
renders — its props simply are not part of the react-tier contract. Reach those
through the contract instead: a kanban / calendar / gantt / timeline / map of an
object is `<ListView type="kanban" …>`, or `<Block type="object-kanban" …>`.

#### The `record:*` family is excluded from this tier

The tag derivation above is real — `<RecordDetails>` and `<RecordHighlights>`
*are* defined in the scope — but every `record:*` block reads its record from the
record context a **record page** mounts, and a `kind:'react'` page never mounts
one. The block renders empty however you bind it: its `objectName`/`recordId` are
not read by the renderer. `os validate` rejects them at publish time:

```
  ✗ Author-time rules failed (1 issue)
  • page "showcase_renewals_pipeline" › RecordHighlights: RecordHighlights renders
    "record:highlights", which reads its record from the record context a record page
    mounts — a kind:'react' page never mounts one, so the block renders empty no matter
    how it is bound (its objectName/recordId are not read by the renderer).
      rule: react-block-needs-record-context
```

The rule matches by **type**, so `<Block type="record:details" />` is rejected
the same way. On a react page, bind the record yourself:

| Instead of | Write |
|---|---|
| `<RecordDetails>` | `<ObjectForm objectName="…" mode="view" recordId={…} fields={[…]} />` — it binds by its own props. |
| `<RecordHighlights>` | `<ObjectForm … mode="view" />`, or read the record with `useAdapter().findOne` and lay the strip out in JSX. |
| `<RecordRelatedList>` | `<ListView data={{ provider: 'object', object: 'child_object' }} filters={['lookup_field', '=', parentId]} />` — the parent binding is an ordinary filter here. |
| `<RecordPath>` | Read the record with `useAdapter().findOne` and render the stage bar in JSX. |

If you want the whole record-page composition, author the page as `type:'record'`
instead — that is the page kind that mounts the context these blocks render from.

**Layout containers are deliberately not injected.** The scope builder skips
every container and every html-tier entry
(`if (!tag || cfg.isContainer || cfg.tier === 'html') continue;`), so `<flex>`, `<grid>`,
`<card>` and friends have no injected wrapper. In react mode you compose layout
with real HTML, which React is better at than a schema-children renderer — styled
inline, not with Tailwind: `<div style={{ display: 'flex', gap: 16 }}>`.

`isContainer` means exactly this: *layout containment*, the reason a block is
kept out of the JSX scope. It does not mean "accepts children". Whether a block
renders an authored child list is declared on its registration as
`{ name: 'children', type: 'slot' }` in `inputs`, and that declaration is what
the html tier's `not-a-container` diagnostic reads — so `<Button>` and `<Badge>`
stay injected here (they are not layout) while still accepting `children` on the
html tier.

### Styling — page source is metadata, not build input

**Do not author Tailwind utility classes in page source** — on either tier. A
page's `source` is *runtime metadata*. The console's Tailwind is compiled at
**build** time by scanning the console's own `src`, and there is no safelist, so
it never sees your page. A utility class in page source produces CSS only if that
exact class happens to already appear in objectui's own source, and otherwise
produces **nothing, with no error anywhere**.

This is the most expensive mistake on this tier: the page still renders — correct
structure, correct data, no styling — and nothing reports it. It is recorded as a
2026-06-30 amendment to ADR-0080 under ADR-0065, after a modal's `bg-black/50`
backdrop rendered fully transparent in production. `os validate` reports it as
`page-source-className-tailwind` (a warning, on both tiers).

Each tier has its own styling primitive:

| `kind` | Style with |
|---|---|
| `"react"` | Inline `style={{ … }}`, with `hsl(var(--token))` for colour. |
| `"html"` | The blocks' own structured props (`<flex direction gap>`, `<grid columns>`) plus a JSON `style` object. |

Colours come from the active theme, so the page follows light/dark and whatever
theme the deployment installs:

```jsx
<div
  style={{
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 'var(--radius)',
    padding: 12,
    color: 'hsl(var(--foreground))',
  }}
>
  …
</div>
```

Common tokens: `--background`, `--foreground`, `--card`, `--muted`,
`--muted-foreground`, `--border`, `--primary`, `--destructive`, plus the
spacing/radius tokens `--space-*` and `--radius`.

For overlays, do not hand-roll a `position: fixed; inset: 0` backdrop — render
the form in its built-in Sheet or Dialog, which arrives already styled:
`<ObjectForm … formType="drawer" drawerSide="right" />`.

### Blocks take flat props

An injected block folds its JSX props into the block's schema, so you write
flat props rather than a nested `schema` object:

```jsx
<ListView data={{ provider: 'object', object: 'showcase_project' }} fields={['name', 'status']} pagination={{ pageSize: 25 }} />
```

Use the **canonical** spelling of each prop — the one the contract publishes.
Several blocks still read older flat spellings as back-compat fallbacks but do
not declare them, so they are not authoring surface: on `<ObjectGrid>`, for
instance, `pageSize` and `fields` are deprecated aliases of `pagination` and
`columns`.

Function props (`onRowClick`, `onSelect`) are passed through as real callbacks —
that is how you wire one block to another.

One collision to know about: `type` is both the schema's component
discriminator and a legitimate prop name on some blocks (a chart's family, for
instance). The discriminator wins the `type` slot, and your value is preserved
next to it as `specType` for the block to read.

### `Block` — the escape hatch

Any registered component, including ones outside the public contract:

```jsx
<Block type="object-tree" objectName="showcase_category" />
```

### Live data

```jsx
function Page() {
  const adapter = useAdapter();
  const changed = useDataInvalidation('showcase_project');
  const [rows, setRows] = React.useState([]);

  React.useEffect(() => {
    adapter
      .find('showcase_project', { $filter: ['status', '=', 'open'] })
      .then((res) => setRows(res.data ?? []));
  }, [adapter, changed]);

  return <ul>{rows.map((r) => <li key={r._id}>{r.name}</li>)}</ul>;
}
```

`changed` is in the dependency array so the page's own read follows the data:
the nonce moves each time the data-invalidation bus reports a write to
`showcase_project` (the same bus `<ListView>` refreshes from), and the effect
reads again in place, without remounting the page, so the page keeps its own
state.

Two things in the `find` call are easy to get wrong, and neither one errors:

**The `$` prefixes are load-bearing.** Every query key starts with `$` —
`$select`, `$filter`, `$orderby`, `$skip`, `$top`, `$expand`, `$search`,
`$searchFields`, `$count`. An unprefixed `filters:` or `top:` is not a query option — the adapter
reads only the `$`-prefixed keys, so anything else is dropped and the call comes
back **unfiltered**, or with the default page size, with no error. `$filter`
takes an ObjectQL filter array — `['field', 'op', value]`, with `and`/`or`
compounds spelled `['and', [...], [...]]`.

**`find` resolves to a `QueryResult`, not an array.** It is
`{ data, total, page, pageSize, hasMore }`; the rows are `res.data`. Passing the
result straight to `setRows` and then calling `.map` on it throws.

### Source shapes

The page renders the source's **default export**. An implicit `export default`
is added when the source *starts with* JSX, a `function` declaration, `()`, or
`class`:

```jsx
function Page() { return <p/>; }     // ✅
<p>hi</p>                            // ✅
() => <p>hi</p>                      // ✅

const Page = () => <p/>;             // ❌ exports nothing
const Page = () => <p/>;
export default Page;                 // ✅
```

The `const Page = …` form does **not** get the implicit export — export it
explicitly. Getting this wrong reports an error in the page error panel; it does
not silently render blank.

### When something throws

Transpile errors, evaluation errors, and errors thrown while rendering all
surface in a **React page error** panel with the message. The error is held
until the page source or its data changes, so it does not flicker or escape to
the generic renderer error.

Referencing an identifier that is not in scope is the common case, and reads as
`ReferenceError: <Name> is not defined` — usually a layout container (not
injected — use HTML) or a block outside the public contract (use `Block`).

### Page state

A react page keeps its own `useState` across re-renders and across lazy plugin
loads. Three things reset it, all intentional: a change to `source`, a change to
the page's data/variables, and a **new data source** — the page is genuinely a
different page then.

That last one is a requirement on the **host**, not the author. The page is
recompiled when the adapter's *identity* changes, because recompiling is the
only way the new adapter reaches the blocks inside the page. So a host that
constructs a new adapter on every render resets every react page on every
render. Provide it from state or a module constant:

<!-- doc-snippet: fragment — a bad/good contrast of two bare JSX opening tags: neither half is a closed element, and showing them closed would hide the difference the section is about -->
```tsx
// ❌ new adapter object every render — every react page below loses its state
<AdapterCtx.Provider value={new ObjectStackAdapter(config)}>

// ✅
const [adapter, setAdapter] = useState<ObjectStackAdapter | null>(null);
<AdapterCtx.Provider value={adapter}>
```

`@object-ui/app-shell`'s `AdapterProvider` already does this correctly; the rule
matters for custom hosts and preview surfaces.

## `kind:'html'`

The constrained tier. Same JSX-looking syntax, but the source is **parsed**
into a schema tree and rendered through the normal renderer — never executed.
Only tags in the public block manifest are allowed, props are validated against
each block's declared inputs, and unknown tags are a hard error at save time.

Those tags are the **registered type names, written verbatim** — whatever the
registry spells, character for character, including a `record:` / `page:` /
`element:` / `action:` namespace prefix and any underscore inside the name:
`<list-view>`, `<object-form>`, `<record:related_list>`, `<record:quick_actions>`.
The whitelist is an exact string comparison, so nothing is normalised for you:
the **PascalCase** tags this page shows for `kind:'react'` are the other tier's
convention and are not registered names (`<ListView>` is rejected with
`<ListView> is not an allowed component`), and neither is a name re-spelled to
look uniform — `<record:related-list>` is not registered, only
`<record:related_list>` is.

The plain wrapper on this tier is `<box>`. `<div>` is deprecated here as it is in
JSON, and the page is refused at compile time with an error that names `box`.

There is no raw-HTML block on this tier, or on any other. The `html` node type,
which wrote an authored HTML string into the page unsanitised, is retired, so an
`<html>` tag is refused at compile time as an unknown component. Rich text a user
edits belongs in an `html` or `richtext` field, whose value renders through the
sanitised fields path.

Use it for anything author- or AI-generated. Expressions are limited to what the
schema supports (`${data.x}`), and there is no local state or event handling
beyond the action system.

Styling works the same way as on the react tier — *page source is never scanned
by the build* — but with this tier's own primitive: lay out with the blocks'
structured props (`<flex direction gap>`, `<grid columns>`) and add CSS as a JSON
`style` object. See *Styling*, above.

## List blocks in a narrow region

Region pages (the schema-tree pages above, built from `regions[].components[]`)
size each block to the region it sits in. A `list-view` block in a region
narrower than half the page, such as an `aside` rail beside `main`, renders a
compact list: a header with the title and record count, then two-line rows
built from the view's first two visible columns. It renders no toolbar, no view
tabs and no row-number column. A region half the page or wider renders the full
list.

The posture is measured from the region's rendered width, never authored, and
no page or block key sets it. `kind:'html'` and `kind:'react'` pages have no
regions, so their list blocks always render the full list.

Under its rows the compact list draws a "View all" link. A block bound to a
saved view (`dataSource.view`) links to that view's page in the console
(`/apps/APP/OBJECT/view/VIEW`); any other block links to the object's list
(`/apps/APP/OBJECT`). The block's own filter, columns and sort are not carried
into the link, so a block that narrows the list inline opens the object's whole
list. To link to exactly what the block shows, bind the block to a saved view.
The console's page supplies the destination through
`RelatedRecordActionsContext`'s `listHref`; a host that does not supply it draws
no link.

## Related

- [Slotted Pages](./slotted-pages.md) — `kind:'full'` / `kind:'slotted'` record pages.
- [Schema Rendering](./schema-rendering.md) — the schema tree the other kinds compile to.
- [Component Registry](./component-registry.md) — how blocks are registered and what makes one public.
