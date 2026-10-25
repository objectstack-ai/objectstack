# Audit: `ObjectViewSchema` / `DetailViewSchema` vs `@objectstack/spec` (2026-07)

**Scope**: the two view schemas #2231 never touched — `ObjectViewSchema`
(`packages/types/src/zod/objectql.zod.ts:189-208`) and `DetailViewSchema`
(`packages/types/src/zod/views.zod.ts:89-122`).
**Method**: full field dump of both schemas (zod ∪ TS interface), a read-site sweep of
every field across `packages/` and `apps/`, and a field-by-field mapping against
`@objectstack/spec` at `16.1.0`.
**Deliverable**: a per-field verdict — **promote-to-spec** / **keep-local** / **drop** —
and an answer to the question #2890 scope B actually asks: *is a spec derivation even the
right shape for these two?*

For `ListViewSchema` the answer was yes, and #2231 phases 1–3 executed it. For these two
the answer is **no for both, for different reasons**. Neither should be derived.

---

## Summary

| | `ObjectViewSchema` | `DetailViewSchema` |
| --- | --- | --- |
| Declared fields (zod ∪ TS) | 25 | 37 |
| Declared in zod | 13 | 23 |
| Declared in TS only | 12 | 14 |
| **READ** by a renderer | 22 | 33 |
| **WRITTEN-ONLY** (produced, never read) | 2 | 1 |
| **DEAD** (neither) | 1 | 2 |
| Read but declared **nowhere** | **28** | 2 |
| Fields with a first-party runtime producer | 13 | 11 |
| Nearest spec counterpart | `ViewSchema` (the ADR-0047 **container**) — *not* `ObjectListViewSchema` | the `record:*` page-component family — *not* `FormViewSchema` |
| Verdict | **Restructure, don't derive** | **Freeze and retire, don't derive** |

Two facts sit under everything below and are worth stating once:

1. **Neither schema is parsed at runtime, anywhere.** `DetailViewSchema.safeParse` appears
   only in `packages/types/src/__tests__/phase2-schemas.test.ts:527`; `ObjectViewSchema`
   is never parsed at all. `ObjectQLComponentSchema` and `ViewComponentSchema` are
   re-exported but never consumed. This is the same finding that redirected #2890 scope A
   away from a `z.preprocess` fold.
2. **`BaseSchema` is `.passthrough()`** (`packages/types/src/zod/base.zod.ts:141`), so
   undeclared keys survive validation untouched. Combined with (1), the zod shapes are
   **documentation, not a contract** — and nothing catches drift between zod, the TS
   interface, and what the renderer actually reads. There is no equivalent of
   `list-view-spec-parity.test.ts` for either schema.

The measurable consequence: **the zod shape is a strict subset of the TS interface in both
cases, and the TS interface is a strict subset of what the renderer reads.** Every drift
has gone the same direction — the renderer grew, the declarations did not.

---

## 1. `ObjectViewSchema`

### 1.1 The counterpart is the container, not the list view

#2890 nominates spec `ObjectListViewSchema` (`view.zod.ts:1114`) as the nearest
counterpart and notes it is "not 1:1". It is not 1:1 because it is not the counterpart.

`ObjectViewSchema` is a **composite shell**: a list surface (`table`), a create/edit form
surface (`form`), named-view state (`listViews` / `defaultListView`), and toolbar chrome.
`ObjectListViewSchema` covers only the first of those four.

The structurally matching spec schema already exists — `ViewSchema`
(`framework/packages/spec/src/ui/view.zod.ts:1135-1155`), the ADR-0047 container:

```ts
{ list: ObjectListViewSchema, form: FormViewSchema,
  listViews: Record<string, ObjectListViewSchema>,
  formViews: Record<string, FormViewSchema>, protection }
```

That maps onto objectui's `table` / `form` / `listViews` cluster essentially 1:1. The
identity fields objectui folds into `listViews` and `defaultListView` also already have a
spec home in `ViewItemSchema` (`view.zod.ts:1319-1332`), where the default is marked
**on each view** (`isDefault`) rather than pointed at from the container.

**So the spec does not need to grow a composite-view schema — it has one.** The gap is
that objectui's composite predates it and encodes the same structure differently.

### 1.2 The declared surface is a fiction

The strongest argument against deriving this schema today: **28 keys are read off the
`object-view` node that are declared in neither the zod schema nor the TS interface.**
All are read through `(schema as any).X` in the `renderListView` pass-through
(`packages/plugin-view/src/ObjectView.tsx:1019-1060`):

```
showHideFields, showGroup, showColor, showDensity, compactToolbar, allowExport,
striped, bordered, color, inlineEdit, wrapHeaders, clickIntoRecordDetails,
addRecordViaForm, addDeleteRecordsInline, collapseAllByDefault, fieldTextColor,
prefixField, showDescription, selection, pagination, resizable, hiddenFields,
rowActions, rowActionDefs, bulkActions, sharing, addRecord, conditionalFormatting
```

Every one of these is a `ListViewSchema` key that `ObjectView` relays to the list view it
renders. The node is, in practice, *`ListViewSchema` plus a form slot plus toolbar
chrome* — but its declaration admits to about a third of that.

There is nested drift too: `ObjectView.tsx:858` reads `schema.table?.title` and `:430`
reads `schema.table?.operations`, but the zod `ObjectGridSchema`
(`objectql.zod.ts:112-144`) declares neither. Only `.passthrough()` keeps them alive.

**Deriving a schema whose declared surface is a third of its real surface would encode the
wrong thing.** The prerequisite is to make the declaration match the reads.

### 1.3 Field-level verdicts

**Drop (3)**

| Field | Evidence | Verdict |
| --- | --- | --- |
| `viewTabBar` | Repo-wide grep across `packages/`, `apps/`, `examples/` (tests included) returns exactly one line: its own declaration at `objectql.ts:1365`. | **Drop.** Dead since introduction. |
| `showRefresh` | Three producers (`app-shell/src/views/ObjectView.tsx:1624`, `ViewPreview.tsx:136`, `plugin-view/src/index.tsx:94`) and a designer input at `plugin-view/src/index.tsx:81`; **zero readers** in `ObjectView.tsx`. | **Drop the local field.** The affordance is real and the spec already has it — `UserActionsConfigSchema.refresh` (`view.zod.ts:353`). If the refresh button is wanted, wire it to `userActions.refresh` rather than resurrecting a key nothing reads. |
| `className` | Declared on the node (`objectql.ts:1359`, redeclaring `BaseSchema`), and `SchemaRenderer` does pass it (`packages/react/src/SchemaRenderer.tsx:453`) — but `ObjectViewRenderer` (`plugin-view/src/index.tsx:58-64`) forwards only `schema` and `dataSource`, dropping it on the floor. | **Fix or drop.** Forwarding it is a one-line change and restores Commandment #3 (`className` overridable via JSON); leaving it declared-but-discarded is the worst of both. |

**Promote / align — exact or near-exact spec matches already sitting in `ListViewSchema` (3)**

| Field | Spec counterpart | Verdict |
| --- | --- | --- |
| `searchableFields` | `ListViewSchema.searchableFields` (`view.zod.ts:681`) — identical `string[]` | **Re-export by reference**, as `ListViewSchema` already does for its spec fields. |
| `filterableFields` | `ListViewSchema.filterableFields` (`:682`) — identical | **Re-export by reference.** Note the spec marks it "legacy shorthand for `userFilters.fields`", so it inherits that deprecation. |
| `navigation` | `ListViewSchema.navigation` (`:698`) → `NavigationConfigSchema` (`:584-612`) | **Re-export by reference.** objectui's `ViewNavigationConfig` (`objectql.ts:1604-1636`) has the same six keys *and* the same `#2578` deprecation note — it is a hand-copied duplicate, the exact class of fork #2231 phase 2 retired. |

**Rename to the spec vocabulary — the scope-A migration, extended to this node (7)**

| objectui | Spec | Note |
| --- | --- | --- |
| `objectName` | `data: { provider: 'object', object }` (`ViewDataSchema`, `:29`) | Same divergence as scope A step 6 — and the same upstream blocker (`react-blocks.ts` sanctions `objectName` as a React-tier prop). Move together, or not at all. |
| `defaultViewType` | `ListViewSchema.type` (`:646`) | Spec is a superset (adds `chart`, `tree`). objectui's own `ListViewSchema` **already imports this enum by reference** (`objectql.zod.ts:368`) — this schema should use the same import instead of restating a narrower copy. |
| `showSearch` / `showFilters` / `showSort` | `UserActionsConfigSchema.{search,filter,sort}` (`:350-352`) | Scope A step 3, same fold. |
| `showCreate` | `AddRecordConfigSchema.enabled` (`:448`) | Spec's config also carries `position` / `mode` / `formView`; the boolean is a lossy shorthand for it. |
| `title` | `label` (`:642`) | Type differs: objectui `z.string()`, spec `I18nLabelSchema`. Promoting means accepting the i18n envelope. |
| `description` | `description` (`:713`) | Same name, same i18n type difference. |
| `layout` (`drawer\|modal\|page`) | `NavigationConfigSchema.mode` (`:585`) | Spec is a superset (`split`, `popover`, `new_window`, `none`). Fold into `navigation`, don't keep a parallel three-value enum. |

**Restructure — the container shape (4)**

`table`, `form`, `listViews`, `defaultListView` are one decision, not four: adopt spec
`ViewSchema`'s `{ list, form, listViews, formViews }` and let `isDefault` live on each
view item. Splitting them across separate PRs would leave the node in a shape that is
neither vocabulary.

**Keep local (7)**

| Field | Why it stays |
| --- | --- |
| `type: 'object-view'` | Component discriminator, load-bearing for the component union. Spec's `ListViewSchema.type` is the *view kind*, a different axis — the same collision `viewType` already documents. |
| `onNavigate` | A function. Non-serializable; cannot live in a JSON protocol. |
| `operations` | CRUD affordance at the view layer. Spec expresses this at the object/permission layer, and `resolveCrudAffordances` is already the runtime authority — so this is arguably **also a drop candidate**, but it is READ at `ObjectView.tsx:430` and `:1140` and removing it needs its own permission-semantics review. Flagged, not decided. |
| `allowCreateView`, `viewActions` | View-management chrome (`ViewSwitcher.tsx:256,258,278`). No spec counterpart; `UserActionsConfigSchema.buttons` is a `string[]` of action ids, a different shape. |
| `showViewSwitcher` | Derivable — `appearance.allowedVisualizations.length > 1` is exactly how `ObjectDataPage.tsx:227` and `InterfaceListPage.tsx:386` already compute it. **Keep local only until those two are the single source**; then drop. |
| `id`, `visible*`, `hidden*`, `disabled*`, `ariaLabel`, … | `BaseSchema` envelope, owned by the renderer, out of scope for a view protocol. |

Three envelope near-misses are worth recording because they will bite any future
derivation: `data` — objectui `z.any()` payload vs spec `ViewDataSchema` *source
descriptor*; `name` — objectui free string vs spec `SnakeCaseIdentifierSchema`;
`visibleWhen` — objectui `z.string()` vs spec `ExpressionInputSchema` (which since #2661
may be a `{dialect, source}` envelope, not a bare string).

### 1.4 Verdict

**Restructure, don't derive — and in this order:**

1. Make the declaration match the reads (the 28 undeclared keys). Until then any
   derivation encodes a third of the node.
2. Add a drift guard modelled on `list-view-spec-parity.test.ts`. Without one, step 1
   decays immediately — that test is the only reason `ListViewSchema` stayed honest.
3. Then adopt spec `ViewSchema` as the container shape and re-export the three exact
   matches by reference.

Steps 1–2 are worth doing on their own even if step 3 never happens.

---

## 2. `DetailViewSchema`

### 2.1 `FormViewSchema` is the wrong counterpart

By field *names* the nomination is defensible — `title`, `description`, `layout`,
`columns`, `sections`, `fields`, `data` and `defaultTab` all appear in both. By
*semantics* it is wrong: `FormViewSchema` is the **create/edit** surface;
`DetailViewSchema` is a **read-only record** surface.

The name overlap is actively misleading. Three examples from the mapping:

- **`data`** — objectui's is the record *payload* (`z.any()`, read at
  `DetailView.tsx:384`); spec's is a data-*source descriptor* (`ViewDataSchema`). Same
  key, opposite direction of dataflow. Deriving would silently invert its meaning.
- **`columns`** — objectui `z.number()`; spec `FormViewSchema.columns`
  `z.number().int().min(1)`; spec `RecordDetailsProps.columns`
  `z.enum(['1','2','3','4'])` — a **string** enum. Three encodings of one concept.
- **`layout`** — objectui `vertical|horizontal|grid`; `FormViewSchema.layout`
  `vertical|horizontal|inline|grid`; `RecordDetailsProps.layout` `auto|custom`. Two
  different spec fields share the name with two different meanings.

The spec's actual read-only record surface is the **`record:*` page-component family**:
`RecordDetailsProps` (`component.zod.ts:75-82`), `RecordHighlightsProps` (`:147-152`),
`RecordRelatedListProps` (`:84-145`), `RecordActivityProps` (`:154-179`),
`RecordChatterProps` (`:181-194`), composed under `PageSchema`. Those are declarative
components that name what to render; `DetailViewSchema` inlines *pre-fetched payloads*
(`history.entries[]`, `comments[]`, `activities[]`) alongside callbacks. The mismatch is
structural, not cosmetic.

### 2.2 objectui already migrated — this schema is the surface left behind

The decisive evidence is in the producer count. Only **two** first-party call sites emit a
`detail-view` node:

- `packages/plugin-detail/src/renderers/record-details.tsx:243-257`
- `packages/plugin-detail/src/RecordDetailDrawer.tsx:299-332`

Everything else that shows a record — `packages/plugin-detail/src/synth/buildDefaultPageSchema.ts`,
`packages/app-shell/src/views/RecordDetailView.tsx` — builds a **page schema out of
`record:*` components**, i.e. the spec shape, and does not touch `DetailViewSchema` at all.

The consequence shows up as dead weight: of the 33 fields the renderer READS, only **11**
are ever produced by first-party runtime code (`type`, `objectName`, `resourceId`, `data`,
`columns`, `sections`, `fields`, `actions`, `showBack`, `showDelete`, plus the undeclared
`showHeader`). The other 22 — `history`, `comments`, `activities`, `recordNavigation`,
`sectionGroups`, `highlightFields`, `summaryFields`, `tabs`, `related`, `header`, `footer`,
`primaryField`, … — are read by `DetailView.tsx` but written only by tests, the package
README, and the designer-input list. They are capability the product reaches through the
page path instead.

### 2.3 Field-level verdicts

**Drop (3)**

| Field | Evidence |
| --- | --- |
| `onBack` | Never read. The `onBack` at `DetailView.tsx:144/194/493` is the React **prop** (`() => void`) — a different channel and a different type from the schema's `string`. |
| `autoDiscoverRelated` | Repo-wide grep returns exactly one line: its declaration at `views.ts:615`. |
| `layout` | **WRITTEN-ONLY.** Produced by `record-details.tsx:248` and exposed as a designer input (`plugin-detail/src/index.tsx:141`), read nowhere in `DetailView.tsx`. A user can set it in the designer and nothing happens. |

**Keep local, do not promote (the runtime-state cluster)**

`loading`, `data`, `history`, `comments`, `activities`, `recordNavigation`, `onNavigate`,
`onTabChange`, `onAddComment` are **live state and callbacks**, not metadata. They are
correctly local and must never enter a serializable protocol. Their existence on a schema
is itself the smell: they are why this "schema" cannot be validated, persisted, or
authored — it is a props bag wearing a schema's clothes.

**Already-solved-upstream (do not re-promote)**

| objectui | Spec home |
| --- | --- |
| `primaryField` | `Object.nameField` — title resolution belongs to the object |
| `summaryFields` / `highlightFields` | `Object.highlightFields` (`data/object.zod.ts:1051`, ADR-0085) and `RecordHighlightsProps.fields` (`:148`, capped `.min(1).max(7)`) |
| `related[]` | `RecordRelatedListProps` (`:84-145`) — a **superset**: it adds `relationshipValueField`, `sort`, `limit`, `filter`, `showViewAll`, `actions`, `add{picker,linkField,label}` that objectui's inline shape has no room for |
| `tabs` / `autoTabs` / `defaultTab` | `PageTabsProps` (`:32-55`) |
| `sectionGroups` | `PageAccordionProps` (`:206-216`) |
| `header` / `footer` | `PageCardProps.body` / `.footer` (`:63-65`) |
| `title` / `actions` | `PageHeaderProps` (`:22-30`) |

Every one of these already has a better spec home **that objectui already renders**. There
is nothing to promote; there is a caller to migrate.

**No spec counterpart, and shouldn't get one**

`showBack` / `backUrl`, `showEdit` / `editUrl`, `showDelete` / `deleteConfirmation`,
`api`, `resourceId`, `showHeader`. These are navigation chrome and imperative fetch
plumbing. The spec's answer to "show a back button" is that the *page* owns navigation
chrome; the answer to `api`/`resourceId` is that the record is bound by page/route
context. Promoting them would import objectui's fetch model into the protocol.

### 2.4 Verdict

**Freeze and retire, don't derive.**

1. **Freeze.** Add no fields. Every capability request already has a `record:*` home.
2. **Drop** the three dead/written-only fields (`onBack`, `autoDiscoverRelated`, `layout`)
   and the `layout` designer input that advertises a no-op.
3. **Migrate the two producers.** `record-details.tsx` and `RecordDetailDrawer.tsx` are
   the only things keeping the node alive; `buildDefaultPageSchema.ts` is the pattern to
   follow.
4. **Then delete** `DetailViewSchema`, `DetailViewFieldSchema`, `DetailViewSectionSchema`,
   `DetailViewTabSchema` and `DetailView.tsx`.

Deriving it from `FormViewSchema` would spend the effort of a migration to make a
superseded surface look canonical — and would bake in the `data` / `columns` / `layout`
collisions above while doing it.

---

## 3. Cross-cutting: the missing guard

`ListViewSchema` stayed honest through three migration phases because
`packages/types/src/__tests__/list-view-spec-parity.test.ts` fails when the spec grows a
field objectui ignores, when an anchor objectui aliases disappears upstream, or when
someone adds a local field without a sanctioned rationale.

Neither schema in this audit has one, and the 28-undeclared-keys number is the cost. Any
work on `ObjectViewSchema` should land a guard **first**: it is what converts "we cleaned
this up once" into "it cannot re-drift."

---

## Appendix — counts

`ObjectViewSchema`: 25 declared (13 zod / 12 TS-only) — 22 READ, 2 WRITTEN-ONLY
(`showRefresh`, `className`), 1 DEAD (`viewTabBar`), plus 28 read-but-undeclared.

`DetailViewSchema`: 37 declared (23 zod / 14 TS-only) — 33 READ, 1 WRITTEN-ONLY
(`layout`), 2 DEAD (`onBack`, `autoDiscoverRelated`), plus 2 read-but-undeclared
(`showHeader` READ, `inlineEdit` WRITTEN-ONLY). Of the 33 READ, 11 have a first-party
runtime producer.

Type-level drift, both schemas: zod ⊂ TS, with no field going the other way.
`DetailViewSchema` additionally disagrees with itself on two types — `actions`
(zod `z.array(z.any())` vs TS `ActionSchema[]`) and `related[].columns`
(zod `z.array(z.any())` vs TS `TableColumn[]`).
