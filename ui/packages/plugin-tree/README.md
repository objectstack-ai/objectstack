# @object-ui/plugin-tree

Tree / tree-grid view plugin for Object UI.

Renders a **self-referencing object** as an indented, expand/collapse tree-grid —
the right view for hierarchies of unbounded depth such as **business unit /
org chart**, category trees, menu trees, BOMs, or nested comments. (Grouping
handles *fixed-depth* hierarchies; a tree handles arbitrary depth.)

It registers one component type via the `ComponentRegistry`:

- `object-tree` — the object-bound renderer, and the one an author selects

The bare `tree` registry key (`view:tree`), a second key on the same renderer,
is RETIRED (objectui#10859 batch 8): `objectui validate` refused it at `type`,
and nothing authored it. `tree` survives as a host-composition VIEW type (see
below), which `ObjectView` and `ListView` compose into an `object-tree` node.

## Usage

Author an `object-tree` node. `ObjectQLComponentSchema` narrows on `type`, so
each key is checked against `ObjectTreeSchema`, which mirrors the `object-tree`
row of `@objectstack/spec` (17.5.0 and later):

```ts
import type { ObjectQLComponentSchema } from '@object-ui/types';

const schema: ObjectQLComponentSchema = {
  type: 'object-tree',
  objectName: 'business_unit',
  tree: {
    parentField: 'parent',        // single-parent pointer (auto-detected if omitted)
    labelField: 'name',           // indented first column
    fields: ['manager'],          // additional flat columns
    defaultExpandedDepth: 1,      // 0 = roots only; omit = expand all
  },
  filter: [{ field: 'status', operator: 'equals', value: 'active' }],
  navigation: { mode: 'drawer' },
};
```

### Keys

| Key | Description |
| --- | --- |
| `objectName` | The object to query. One of `data`, `staticData` and `objectName` is the record source, read in that order; `objectui validate` refuses a node with none of the three. |
| `data` | A `{ provider, … }` configuration, read first. `{ provider: 'value', items }` draws those records and `{ provider: 'object', object }` queries that object. The `api` and `schema` providers draw no rows on the tree. A bare array is not a record source (objectui#8348): inline rows go under `staticData`. |
| `staticData` | Inline records, read second: a `data` configuration wins, and a tree carrying both `staticData` and `objectName` draws these rows and never queries the object. |
| `tree` | The field configuration — the spec's `TreeConfig` (table below). |
| `filter` | Rule array `[{ field, operator, value }]`, lowered to `$filter` and applied to inline rows as well. Context tokens such as `{current_user_id}` are resolved first. A record whose parent the filter removed is drawn as a root. |
| `navigation` | What a row click opens (below). |

The node's `dataSource` binding is **not** a record source on this block: the
registration is not wrapped in `ElementDataSourceGate`, so nothing lands a
binding's object on `objectName`, and `objectui validate` does not count it.

### The `tree` block

| Key | Default | Description |
| --- | --- | --- |
| `parentField` | auto-detected | Field holding the parent reference. When omitted, the renderer picks the object's `tree` field (or a lookup/master_detail that references the same object). |
| `labelField` | `name` | Field rendered indented in the first column. |
| `fields` | `[]` | Additional fields rendered as flat columns after the label. |
| `defaultExpandedDepth` | _unset_ | Initial expansion depth. `0` = roots only; unset = expand everything. |

Records whose parent is missing (or points outside the result set) are kept as
roots, so nothing is silently dropped.

⚠️ The same four keys written **flat** on the node are still read, and a flat
key outranks the block's member of the same name. They are the form a host
composes; the spec row declares only the `tree` block, so author that.

### `navigation`

`navigation` takes the spec's `NavigationConfig` (`{ mode, size, width,
openNewTab, preventNavigation }`), the block a list view declares. On a tree no
parent view navigates for:

- **Absent**: a click opens nothing. This renderer supplies no drawer default.
- `drawer`, `modal` and `popover` open the row's record in that overlay; `split`
  opens it beside the tree, which stays drawn.
- `new_window` opens `/{objectName}/record/{id}` in a new tab; `none` opens
  nothing.
- `page`, and a block without `mode` (it takes the spec's `page` default), open
  a record page through the record navigator the host publishes (the console
  publishes one on its custom pages, record pages and list views). The object
  is `data.object` when `data` is the object provider, so it wins when both
  are written, and the tree's `objectName` otherwise. Under a host that
  publishes none, such as an embedded renderer, or on a tree that names neither
  (inline rows with no `objectName`), there is no record page to open and the
  click opens nothing.
- `preventNavigation: true` opens nothing whatever the mode. `openNewTab: true`
  opens the record page in a new tab and outranks every mode except `none`.
- `size` picks the overlay width bucket; the deprecated `width` wins over it.

A click handler from a parent view outranks the whole key.

### Expansion: the seed and the user's answer

`defaultExpandedDepth` **seeds** expansion; it does not own it. The seeded set is
derived from the forest during render rather than mirrored into component state,
so a tree that expands by default is painted expanded in the first commit that
has rows — there is no frame in which the forest is drawn collapsed
(objectui#8666).

When the record set changes — a refetch, a filter, a host that reallocates the
rows — the seed is recomputed for the new forest. A node the user opened or
closed by clicking its chevron, **and which is still in the forest**, keeps the
user's answer; every other node, a genuinely new one included, takes the seed.
Expansion is per-mount session state: it is not addressable and is not persisted.

### The `tree` view type is host composition, not authoring

`tree` is **not** an authorable view type. Neither `ObjectViewSchema.defaultViewType`
nor `NamedListView.type` admits it — both are the same seven-value union that stops
at `map` — so no authored document selects a tree view, and `ObjectViewSchema`
declares no `views` member at all. The `tree` branch runs only when a **host**
composes `ObjectView` with a `views` prop, whose entries carry `id` and `label`
and are typed `ViewType`. That was ruled deliberate on objectui#5321
(2026-08-20): `tree` and `chart` are recorded as host-composition-only surfaces
rather than added to the authored unions.

The live consumer is the console: it passes stored view records to `ObjectView`
as `views`, and its create-view dialog offers `tree` among the types a console
user can create. To render a tree from authored metadata, write the
`object-tree` node above.

#### The host config has a type — `TreeViewConfig`

Host config is **not** untyped config. A block a host stores and re-writes is a
contract, so the per-view `tree` block is exported from `@object-ui/types` and
the renderer imports it rather than keeping a private copy (objectui#8253,
ruled 2026-09-07).

⚠️ It is **not the single declaration of that shape**, and saying so was itself
the defect objectui#8841 fixed. `@objectstack/spec` owns this block — it
declares it as `TreeConfig` and hangs it on `ListView.tree` — and
`@object-ui/types` already publishes it a second way, derived, as
`ListViewSchema['tree']`. `TreeViewConfig` is now a **derivation of the
protocol's block** rather than a copy of it — in `packages/types/src/views.ts`
it is a one-line alias of `NonNullable<ListView['tree']>`, taken from
`@objectstack/spec/ui`. So the accurate claim is the narrower one: this is the
name a host writes against, and it tracks the protocol by construction rather
than by anyone remembering to update it.

```ts
import type { TreeViewConfig } from '@object-ui/types';

// The block a host writes as `tree` on a `views` entry, or as `options.tree`
// on a stored view record. Every key is optional; a host writes the subset it
// means.
const treeConfig: TreeViewConfig = {
  parentField: 'parent',        // single-parent pointer (auto-detected if omitted)
  labelField: 'name',           // indented first column
  fields: ['name', 'manager'],  // additional flat columns
  defaultExpandedDepth: 1,      // 0 = roots only; omit = expand all
};
```

Annotating the block is what turns a typo into a diagnostic: `parentFeild` used
to be stored, read by nobody and reported by nothing, because the `views` entry
admits any key. Against this type it is a compile error.

⛔ `titleField` is **not** part of this block. objectui#8253 declared it as a
legacy second rung for `labelField`; `@objectstack/spec@17.4.0` refuses
`tree.titleField` by name (`TreeConfigSchema` is strict since spec #15469), so
declaring it published a key the protocol rejects — an author who followed this
type was refused at publish. objectui#8841 removed it.

The renderers still *tolerate* a `titleField` already stored on a view record:
`plugin-view`, `plugin-list` and the console's own composition each fall back to
it when `labelField` is absent, so nothing that renders today stops rendering.
Those reads are untyped tolerance awaiting a follow-up, ⛔ not a declaration —
write `labelField`, which is the protocol's spelling and wins wherever both are
present.

⛔ This does not make `tree` an authorable view type. objectui#5321 is
unchanged: the block is written by a **host**, never by a document author, and
the authored node is the `object-tree` schema at the top of this file.

## License

MIT — see [LICENSE](./LICENSE).
