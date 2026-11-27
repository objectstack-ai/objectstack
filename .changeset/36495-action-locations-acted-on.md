---
'@objectstack/spec': major
'@object-ui/types': major
'@objectstack/lint': minor
'@objectstack/runtime': minor
'@objectstack/platform-objects': minor
'@object-ui/core': minor
'@object-ui/components': minor
'@object-ui/plugin-detail': minor
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
'@objectstack/cli': patch
'@objectstack/cloud-connection': patch
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/plugin-approvals': patch
'@objectstack/scenarios': patch
'@objectstack/service-datasource': patch
'@objectstack/service-messaging': patch
'@objectstack/verify': patch
'@object-ui/console': patch
'@object-ui/fields': patch
'@object-ui/layout': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/react': patch
---

feat(spec)!: an action's `locations` say what it acts on, not the part of the page it sits in

**BREAKING** (19.0.0): `ACTION_LOCATIONS` is `list`, `record`, `record_page`, `record_row`, `record_related`, `record_section`. The four words that named a part of a page are retired: `list_toolbar`, `list_item`, `record_header` and `record_more`. `record` is new: the action acts on one record, so it is drawn on the record page's header and in each list row's menu. Which actions are buttons and in what order stays the object's `actionLayout`.

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up #37895

<!-- adr-0087: registered action-locations-acted-on -->

FROM → TO (each action is drawn in exactly the places it was drawn before):

- `locations: ['list_toolbar']` → `locations: ['list']`.
- `locations: ['list_item']` → `locations: ['record_row']`.
- `locations: ['record_header']` or `['record_more']` → `locations: ['record_page']`.
- `record_header` or `record_more` beside `list_item` → `locations: ['record']`.
- `locations: ['record_more']` without `record_header` (the action lived only in the record header's ⋯ menu) → `locations: ['record_page'], component: 'action:menu'`. The fold is the action's `component`, the key that already sends an action into an action bar's overflow menu.
- A component's single `location` (`record:quick_actions`, `action:group`, `action:bar`): `list_toolbar` → `list`, `list_item` → `record_row`, `record_header` → `record_page`.

An old word is refused at authoring with the word to write instead. `os migrate meta --from 18 --write` rewrites sources (ADR-0087 conversion `action-locations-acted-on`, retired from the load path from day one, as every protocol-19 entry). Stored items (`applyConversionsToStoredItem`, `os migrate meta --stored`) and built artifacts replay the same conversion. It leaves a TODO, and changes nothing, where no lossless rewrite exists: a `record_more`-only action also on `list_toolbar` (the list toolbar folds `action:menu` too), a component whose `location` is `record_more`, and an `action:group` at `record_header` with a `record_more`-only member. The protocol-19 upgrade guide carries the same step as the semantic entry `action-locations-page-parts-retired`.

Also in this change:

- `@object-ui/types`: `actionRendersAt` reads `record` as covering `record_page` and `record_row`. The new `actionFoldedIntoMenu(action)` answers whether an action is folded into the ⋯ (`component: 'action:menu'`). `arrangedHeaderActions` pins and unpins through `component` and no longer writes locations.
- `@object-ui/components`: the record `page:header` routes every folded action to its ⋯ menu, and every other `record_page` action takes the inline budget, as `record_header` actions did.
- `@object-ui/plugin-detail`: `record:quick_actions` defaults to `record_page` and leaves folded actions out at that location, as it left out `record_more`-only ones. The related list reads `record` as a row action.
- `@object-ui/core`, `@objectstack/runtime`: the record-scoped checks (`isRecordScopedAction`, `requiresRecord`) accept `record`.
- `@objectstack/lint`: the record-page header, related-list and action-layout rules read the new words.
- Studio: the action inspector, the `record:quick_actions` location dropdown and the action preview offer `record` and draw the fold as "record_page · ⋯".
- `@objectstack/platform-objects`, the examples and every other package: declarations and prose rewritten to the new words. The packages listed as `patch` change comments, test fixtures or authoring copy only.

Not moved: #37895 (the `skills/**` teaching of the new words; Blocked-by this change).
