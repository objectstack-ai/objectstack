# @object-ui/cli

## 18.1.0

### Patch Changes

- 7e9708e: The console home blocks `hero`, `stat`, `usage-bar`, `checklist` and `tile-grid` register under the `app-shell` namespace, so the console no longer logs a "without a namespace is deprecated" warning for each on every boot (objectui#13301).
  
  Pages keep writing the bare key: `type: 'hero'` still draws the block through the registry's bare fallback. `objectui check` now knows the five `app-shell:` keys as registered, and `objectui validate` refuses them at `type`, so the bare spelling stays the one authorable key.
- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [8701f1e]
- Updated dependencies [7c405b7]
- Updated dependencies [3aafc0d]
- Updated dependencies [601c406]
- Updated dependencies [b911ebb]
- Updated dependencies [8e90779]
- Updated dependencies [f1a4b08]
- Updated dependencies [d9aff15]
- Updated dependencies [a78608f]
- Updated dependencies [1d178e0]
- Updated dependencies [6fb31dc]
- Updated dependencies [fbb4b23]
- Updated dependencies [c8f8b10]
  - @object-ui/types@18.1.0
  - @object-ui/components@18.1.0
  - @object-ui/react@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- c4c506b: **Clause-②: yes (narrowing)**
  
  One declaration of the per-type NODE SLOTS — the keys other than `children` through which a renderer hands authored nodes back to `SchemaRenderer` — and three readers that walk it instead of stopping at `children` (objectui#11170, the follow-up PR #11126's Acceptance notes filed).
  
  New on `@object-ui/types`, beside `BaseSchema.children`: `NODE_SLOT_DECLARATIONS` (one row per renderer, under every registry spelling that resolves to it), `nodeSlotsFor(type)`, `nodeSlotPathSegments(path)` and `nodeSlotValues(node, path)`, with the types `NodeSlotDeclaration`, `NodeSlotRow`, `NodeSlotSegment` and `NodeSlotValue`. A position is spelled as a key path — `trigger`, `items[].content`, `regions[].components`, `items[]`, `report.sections[].content` — and the value at its end is one node or a list of nodes. The `page:*` rows are `@objectstack/spec`'s `pageComponentSlotPositions()` placed on the type whose renderer reads each position, pinned against that export in both directions; every other row is objectui's own, pinned against the live renderer. `body` stays retired as the generic child-list key (objectui#6771): it appears only on the four `page:*` types whose renderer still paints it for stored documents, marked `retired`.
  
  Accept sets that narrow, each reader FROM → TO:
  
  - `@object-ui/cli` — `objectui check`'s unevaluated-expression refusal (`findUnbindableTextExpressions`). FROM: the document root and every node its `children` hold. TO: those, and every node under a slot its type declares — so a `${…}` on `title` / `label` / `value` / `description` of a node under a dialog's `content`, a tab item's `content`, a page's `regions[].components`, a carousel item, a detail view's `tabs[].content` is now refused with the slot path (`items → 0 → content → value`). The false-refusal rows of PR #11126's ablation 2 stay green: a form's `fields[]`, a grid's `columns[]` and `{ "type": "multiple" }` are not slots. Measured over this repository's own JSON corpus and docs fences: no new finding.
  - `@object-ui/core` — `validateSchema`. FROM: `validateChildren` recursed through `children` only. TO: it also recurses through the declared slots, so an invalid node under one (a retired `crud` spelling under `dialog.content`, an `INVALID_SCHEMA` member) is reported with its own path, spelled as `schema.items[0].content`. Measured over the same corpus: no new finding.
  - `@object-ui/sdui-parser` — `validateTree`. FROM: the walk descended `children` alone, and a manifest entry carried no slot. TO: `ManifestComponent` gains `slots?: readonly string[]`, `manifestFromConfigs` gains `opts.slotsFor` (hand it `nodeSlotsFor`) and projects each entry's non-retired positions, and `validateTree` descends them — an unknown component, an unknown or mis-typed prop or an illegal enum under a slot now draws its diagnostic. A manifest built without the option serialises byte-identically and keeps the `children`-only reach. The `RETIRED_CHILD_LIST_KEY` refusals are unchanged.
  - `@object-ui/components` — the `kind:'html'` page's compile manifest (`getJsxManifest`) is built with `slotsFor`, so an html-tier page whose slot-held node fails validation now fails to compile the way one under `children` does. Narrowing: a page that compiled with an unknown tag under a `dialog`'s `content` no longer does.
  
  Docs: `content/docs/utilities/cli.mdx`'s "Component nodes only" rule, the gate's own docblock, `validateChildren`'s comment and the parser's header now say the walk follows `children` and the declared slots; the declaration's header is where the slot list is explained.
- 45d5853: New SDUI widget `cloud:workspace-timezone-notice`: one line on the Cloud welcome page naming the timezone a workspace was seeded with at creation (objectui#11930, the objectui half of objectstack-ai/cloud#2676).
  
  **Clause-②: yes** — four published surfaces widen, and nothing that parsed or rendered before changes:
  
  - the accept set of `AnyComponentSchema`, and so of `safeValidateSchema` and `objectui validate`, widens by one `type` literal, `cloud:workspace-timezone-notice`. `@object-ui/types/zod` exports one new schema, `CloudWorkspaceTimezoneNoticeSchema`, and `@object-ui/types` exports its TypeScript twin of the same name, a member of `AnySchema`;
  - `@object-ui/i18n` adds one key, `cloudWorkspaceTimezoneNotice.seeded`, to all ten locale packs;
  - `@object-ui/cli`: `objectui check` knows `cloud:workspace-timezone-notice` as a registered type;
  - `@object-ui/app-shell` registers the widget, and its `sideEffects` array names the new module in its source and published spellings.
  
  **Why.** The welcome page is static metadata, and nothing in a page's expression scope carries a per-organization value, so the page could not say which timezone the workspace was created with. The seed is available only from the org-scoped `GET /cloud/environment-entitlements` summary, as the additive `workspaceTimezoneSeed` string.
  
  **What changed, in observable terms.**
  
  - A page places the node with no props: `{ "type": "cloud:workspace-timezone-notice" }`. The widget reads the summary through the hook the environment list already uses, and when the summary carries `workspaceTimezoneSeed` it renders one muted line naming that zone, verbatim. In English: "The environment timezone was set to Asia/Shanghai from your browser when the environment was created. You can change it in Settings → Localization."
  - It renders nothing when the summary carries no seed (workspaces created before the seed existed, and control planes that do not send it yet), while the summary loads, when the request fails or rejects, and when the body is not the `{ success, data }` envelope. A failed request does not throw.
  - The line is text only: no link and no dismissal state.
  - The node's `className` and `responsiveStyles` reach the line.
  - The widget is registered under one key, `cloud:workspace-timezone-notice`. There is no bare `workspace-timezone-notice` fallback and no `app-shell:`-prefixed twin.
  - `CloudWorkspaceTimezoneNoticeSchema` takes no prop: `properties` is optional and may only be `{}`, so any key in the bag, the zone included, is refused at `properties`. `body` and `children` are refused by name, because the widget reads neither.
- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
- 82e5f53: `record:details`, `record:highlights` and `record:quick_actions` honour the per-element `dataSource` binding the spec already declares on every page component (objectui#12294). A product `app` page can now compose a record's surfaces from these blocks, with no record page around them:
  
  ```json
  {
    "type": "record:highlights",
    "properties": { "fields": ["name", "environment_type"] },
    "dataSource": {
      "object": "sys_environment",
      "filter": [{ "field": "environment_type", "operator": "equals", "value": "production" }],
      "limit": 1
    }
  }
  ```
  
  - **One record per block.** A record block shows the FIRST row of the bound set by the binding's `sort`, read as one row and under the caller's own identity; the server decides what the caller may read, exactly as on any other read. When no row matches, each block draws what it draws for a record that is not there: `record:details` its "record not found" state, `record:highlights` nothing, `record:quick_actions` its empty bar. A read the server refuses draws the same, so a record the caller may not read looks absent. A read that fails for any other reason is reported in the block's place, with the family's data-source error panel.
  - **`record:quick_actions` runs against the bound row.** The object's declared actions (`actionNames`) run with the bound row's id.
  - **The binding resolves as on every bound block.** A named `view`, the binding's `filter` (with `{current_user_id}`-style tokens), and its `sort` mean what they mean on a list block, and an unresolvable view or a refused filter draws the same configuration panel. Reference fields come back expanded, limited to the fields the caller may read, as on the record page.
  - **The bound record stays fresh.** It re-reads in place whenever a write to its object is announced — by the data source's mutation events or on the data-invalidation bus — so a save or an action elsewhere on the page refreshes it.
  - **The record page is unchanged.** A block with no `dataSource` reads the record page's record exactly as before. A bound block placed on a record page shows its bound record instead, as the spec says the binding does, and is kept out of that page's inline-edit session and highlight-field registry: it is read-only there, and it does not hide fields from the page record's details.
  - **The registrations declare the key.** The three blocks publish the injected `dataSource` input, so the page authoring diagnostics no longer report it as an unknown prop.
  - **`@object-ui/types`: the strict authoring face accepts the binding on the three blocks.** Each arm declares `dataSource` as the spec's `ElementDataSourceSchema`, by reference, as `record:line_items` does; the TypeScript authoring face follows. `objectui validate` refused it as an undeclared key before.
  - **`@object-ui/cli`: `objectui validate` warns on a record block whose binding has no `limit: 1`.** The document still validates; the warning names the block's path and asks the author to say which record the block shows. `record:related_list` is not warned about: its binding is the binding of its child rows.
  
  `record:related_list` is unchanged: its `dataSource` still binds the rows it lists.
- d81e460: `record:related_list` reads its parent record from `parentDataSource` (objectui#12294, ruling B on objectui#12296). The key is a member of the spec's `record:related_list` row and takes the object binding `dataSource` takes, so a product `app` page can list a record's children with no record page around the block:
  
  ```json
  {
    "type": "record:related_list",
    "properties": {
      "objectName": "sys_member",
      "relationshipField": "environment_id",
      "parentDataSource": {
        "object": "sys_environment",
        "filter": [{ "field": "environment_type", "operator": "equals", "value": "production" }],
        "limit": 1
      }
    }
  }
  ```
  
  - **The parent is read the way the other record blocks read their record.** The FIRST row of the binding by its `sort` is the parent, read as one row under the caller's own identity and re-read when a write to its object is announced. The list draws that record's children through `relationshipField`, and `relationshipValueField` is read on that row.
  - **No row is said out loud.** When no row matches, or the server refuses the read, the block draws a notice naming the object in its place, and no list: an empty list would read as "this record has no related records". A read that fails any other way draws the data-source error panel.
  - **Without the key, the parent is the record page's record, as before**, and a related list rendered on a record page draws the same markup it drew. With the key, the binding wins over the page record.
  - **`dataSource` keeps its meaning.** On this block it binds the CHILD rows the list draws, and it is never read as the parent.
  - **Authoring.** `RecordRelatedListComponentProps` declares `parentDataSource` as the spec's `ElementDataSource`, by reference, and the registration publishes it as an input, so the html tier no longer reports it as an unknown prop. `objectui validate` already accepted it in `properties`, where the spec row puts it, and refuses it written on the node; it now also warns on a parent binding without `limit: 1`, as it warns on the one-record blocks' bindings.
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.
- 35244b6: The separate Installed Apps view is retired (objectui#12733, ruling B on objectstack#23892). Setup → Packages filtered to Marketplace is the one list of what is installed (objectui#12675), and objectstack#23933 points the install-local plugin's Installed Apps entry straight at it. This is breaking for a host that used one of the retired names; it is marked `minor` under this repository's version policy.
  
  - **Export `MarketplaceInstalledPage`.** FROM: `@object-ui/app-shell` exported it, and it redirected to Packages filtered to Marketplace. TO: there is no such export, and importing it fails to compile.
  - **SDUI widget `marketplace:installed-list`** (also registered as `app-shell:marketplace:installed-list`). FROM: registered, and it redirected to the same URL. TO: not registered. A page that still names it draws the unknown-component panel, and `objectui check` no longer counts it among the known component types.
  - **Routes `system/marketplace/installed`**, in the no-active-app branch and the app branch. FROM: both redirected to the same URL. TO: neither exists. The path now matches `system/marketplace/:packageId`, so an old bookmark opens the package page for a package id `installed`, which the catalog does not have.
  - **The Marketplace page's "Installed (N)" button** opens `/apps/APP/component/developer/packages?source=marketplace` directly, with no redirect hop. APP is the app the page was opened under, and `setup` when there is none.
  
  The widget's module also leaves the `sideEffects` array of `@object-ui/app-shell`.
  
  Fix for each retired name: link to `/apps/APP/component/developer/packages?source=marketplace` (Setup → Packages, Source = Marketplace) instead.
  
  Clause-②: no (narrowing)
- 30083da: Two Cloud SDUI widgets are retired: `cloud:onboarding-next`, the Welcome page's next-step block, and `cloud:plan-status`, the pricing page's current-plan marker (objectui#12954). The Cloud control plane was their one consumer, and objectstack-ai/cloud#3010 replaced both: the home's next step is declared `element:button` nodes over `GET /api/v1/cloud/home`, and the pricing page marks the current plan with a `visibleWhen` on the same summary. At retirement, hotcrm `main` (`3b05ae7`) and objectstack `main` (`0b44840dfd`) registered and authored neither type. They are retired at once, with no deprecation alias. This is breaking for a page or host that still names one of them; it is marked `minor` under this repository's version policy.
  
  - **SDUI widget `cloud:onboarding-next`**, also registered as `app-shell:cloud:onboarding-next`. FROM: `@object-ui/app-shell` registered both keys. TO: neither is registered. A page that still names one draws the unknown-component panel, and `objectui check` no longer counts either key among the known component types.
  - **SDUI widget `cloud:plan-status`**. FROM: `@object-ui/app-shell` registered it. TO: not registered, with the same two consequences.
  - **Schema `CloudPlanStatusSchema`** in `@object-ui/types`: the TypeScript interface from the package entry, and the zod arm from `@object-ui/types/zod`, which was also a member of `AnyComponentSchema`. FROM: exported, and a `cloud:plan-status` node validated against the arm. TO: there is no such export, so importing it fails to compile. `AnyComponentSchema` keeps a refusal arm for the literal, which is not exported, so `objectui validate` refuses a `cloud:plan-status` node BY NAME at `type`, and the message names the remedy: a `visibleWhen` on the page's summary. `CloudWorkspaceTimezoneNoticeSchema` stays.
  - **Locale keys `cloudOnboarding.*`** (`hintCreate`, `hintReady`, `createEnvironment`, `openWorkspace`, `manageEnvironments`) **and `cloudPlanStatus.current`** leave all ten built-in packs of `@object-ui/i18n`.
  
  The two widget modules also leave the `sideEffects` array of `@object-ui/app-shell`. `useEnvironmentEntitlements` stays: the environment list and `cloud:workspace-timezone-notice` still read it.
  
  Fix for a page that still names either widget: compose it from generic blocks, as objectstack-ai/cloud#3010 did — declared `element:button` nodes over the home summary in place of `cloud:onboarding-next`, and a `visibleWhen` on the same summary in place of `cloud:plan-status`.
  
  Clause-②: no (narrowing)
- e4c0b54: `objectui validate` and `objectui check` judge a document through the strict authoring face (objectui#5250)
  
  Both commands parsed an authored document with `safeValidateSchema`, whose node schemas are
  `.passthrough()`: a key no schema declares was kept and never judged, so a misspelled or invented
  key read `✓ Schema is valid!`. They now parse through `StrictAnyComponentSchema`, the strict twin
  of the same declarations (objectui#8345), under the objectui#5250 ruling: the authoring verdict is
  strict, while the rendering face keeps its passthrough.
  
  **Breaking for documents that carry an undeclared key.** `objectui validate` now exits 1 on such a
  document, on the root node and on every nested node, and names each key, the path of the object
  carrying it, and the fix:
  
      Undeclared key "validation" at (root) (type "input"): no schema declares it there. Remove it, or check its spelling against the keys declared at that position.
  
  A nested child's key is named at the child's path, and so is one inside a union the node fits
  more than one arm of (a dashboard widget), where the issue list reports only an `Invalid input`
  that names no key. For an undeclared key `objectui check` stays advisory — it does not change the
  exit code, which is non-zero on unreadable JSON and on a `${…}` refused on a text key its node never
  evaluates (objectui#4795) — but such a file is no longer counted as validated: it is listed by name
  among the files that did not validate, with the same line under it. Its `${…}` expressions are still
  judged, so a listed file can fail the run for an expression. There is no flag to opt out.
  
  Where another entry in this release says `objectui validate` or `objectui check` runs
  `safeValidateSchema`, the tolerant face, this entry supersedes it: both commands run the strict face.
  
  Declared `minor` rather than `major` because this release group follows the `@objectstack` major;
  the breaking semantics are stated here instead.
- 78b07f4: The object-page special cases for the retired permission-set catalog object are removed (objectui#7611, after objectstack's ADR-0131 stage 8 retired `sys_position`, `sys_permission_set`, `sys_position_permission_set` and `sys_capability`). A permission set is edited on its Setup metadata page, which reads the registry; none of the removed code ran anywhere else.
  
  **Breaking (narrowing; scored `minor` per the fixed group's version policy).** Each removal below shrinks a published face:
  
  - **`@object-ui/core`: `recordDelete.confirmText`.** FROM `recordDelete.confirmText({ objectName, t }, record)` TO `recordDelete.confirmText({ t })`. A package-owned `sys_permission_set` row no longer gets the reset question or the "reset" toast: every record gets the delete question and the delete toast. Fix: drop `objectName` and the second argument.
  - **`@object-ui/i18n`: pack keys.** FROM `perm.facet.*` (`none`, `more`, `objects`, `fields`, `rls`, `tabs` with their plural slots, `adminScope`, `designInStudio`, `designInStudioHint`) and `objectActions.resetPackageSetConfirm` / `objectActions.resetPackageSetSuccess` in all ten packs TO absent. Fix: a consumer that still asks for one keeps its own copy (inline `defaultValue` or its own bundle).
  - **`@object-ui/plugin-detail`: the `field:permission-facet-link` registry key.** FROM a registered field widget (the read-only facet summary with a "Design in Studio" link, also special-cased in the detail section and inline edit) TO unregistered. A field still carrying `widget: 'permission-facet-link'` renders with its declared type, like any unregistered widget. Fix: drop the `widget` hint, or register an own widget under that key.
  - **`@object-ui/cli`: `objectui check`'s known schema types.** FROM `field:permission-facet-link` known TO unknown, so `objectui check` reports a node of that type. Fix: as above.
  
  **Behaviour changes, not narrowings:**
  
  - **`@object-ui/data-objectstack`:** `getObjectSchema` no longer stamps `widget: 'permission-facet-link'` onto the six `sys_permission_set` facet fields (that object is no longer served).
  - **`@object-ui/app-shell`:** the `sys_permission_set` record page no longer appends the assigned-users panel. The panel itself, `AssignedUsersSection`, stays on the permission-set metadata page.
  - **`@object-ui/app-shell`: a permission set created from the Setup catalog is created live.** "New" on the permission-set page used to save a draft, while the set's editor edits the live set and reads no draft: the editor opened an empty set without the label, its Save wrote the grants live, and the draft stayed pending, so publishing it from Home replaced the grants with the empty create body. Outside a package binding the create now writes live (with the same first-write pin); under `?package=` it stays a package draft.
  
  **Widenings:**
  
  - **`@object-ui/core`:** the data source `recordDelete.run` is injected with needs only `delete` (it no longer calls `findOne`).
  - **`@object-ui/app-shell`:** the metadata-resource registry entry gains an optional `createLive`, which a type sets when its edit page writes the live item.
  
  Internal, not reachable from a published entry: the `PermissionFacetLink` component (never exported from `@object-ui/plugin-detail`), `RecordPermissionAssignmentsRenderer` (never exported from `@object-ui/app-shell`), and `ObjectStackAdapter`'s private `applyFieldWidgetOverrides`.

### Patch Changes

- c4dd707: feat(app-shell): five generic product-page blocks — `hero`, `stat`, `usage-bar`, `checklist`, `tile-grid` (objectui#12197)
  
  Clause-②: yes
  
  `@object-ui/app-shell` registers five product-neutral SDUI blocks for pages a product composes as metadata, each with declared `inputs` that state their defaults, and each accepting the spec's API binding as `dataSource`:
  
  - `hero` — `title`, `subtitle?`, `meta?` (drawn with a copy-to-clipboard button), `status?`, `statusTone?` (`neutral` when omitted), `primary?` / `secondary?` (`element:button` or `action:button` nodes).
  - `stat` — `label`, `value` (a number is formatted in the viewer's locale), `hint?`.
  - `usage-bar` — `label`, `used`, `limit?`, `unit?`; the bar's width is `used / limit` clamped to 0–100, and an absent or `0` limit is unlimited: the amount used and no bar.
  - `checklist` — `items: [{ label, done, action? }]`, `collapsedWhenDone?` (`false` when omitted; when set, the block draws nothing once every step is done).
  - `tile-grid` — `items: [{ label, href, icon?, caption? }]` or a `${…}` hole naming such a list, `addTile?: { label, href }`; the console home's launcher tile, now shared with the home's apps strip, which draws as before.
  
  `@object-ui/types` gains each block's strict arm in `AnyComponentSchema` (`HeroBlockSchema`, `StatBlockSchema`, `UsageBarBlockSchema`, `ChecklistBlockSchema`, `ChecklistBlockItemSchema`, `TileGridBlockSchema`, `TileGridBlockItemSchema`, `TileGridBlockAddTileSchema`, the union `ProductBlockComponentSchema`) and their TypeScript twins, so `objectui validate` accepts the five types. A value the bound answer may supply also accepts one whole-string `${…}` hole. The `dataSource` descriptions on the object-bound arms now name the object binding as one of `PageComponentSchema.dataSource`'s two shapes. `@object-ui/cli`'s known component types gain the five names. The console's preview gallery draws every block at `?only=product_blocks`.
- 52d6194: The page block `record:approval_decision` renders (objectui#12342). `@objectstack/spec` 18 declares it, and until now a page naming it passed the spec and drew nothing, because no registration mounted the decision panel.
  
  - **Registered (`@object-ui/app-shell`).** The package entry registers `ApprovalDecisionRenderer` as `record:approval_decision` (no bare twin), from the new side-effect leaf `views/record-approval-decision-renderer.tsx`, which joins the package's `sideEffects` array. On an approval request's record page the node draws the request's decision progress above its declared decision actions; off a request page it draws the localized notice it already drew. The renderer is still not exported from the package entry: a page reaches it by type.
  - **Armed (`@object-ui/types`).** `RecordApprovalDecisionBlockSchema` (zod, from `@object-ui/types/zod`) and its TypeScript twin of the same name (from `@object-ui/types`) are new, and `AnyComponentSchema` gains the arm, so `safeValidateSchema` and the strict face accept a `record:approval_decision` node. Its `properties` bag is the spec's empty strict row, restated because the spec exports the row under no name: the only bag it accepts is `{}`, and a node-level `children` or `body` is refused by name.
  - **`objectui check` and `objectui validate` (`@object-ui/cli`).** The generated list of registered types gains `record:approval_decision`, and `objectui validate` no longer refuses the type at `type`.
  
  Studio's block palette still does not offer the block; its exclusion reason now says it renders.
- 1f1c4b5: The `objectui doctor` check-result types are declared as `DoctorDiagnostic` and `DoctorDiagnosticLevel` instead of `Diagnostic` and `DiagnosticLevel` (objectui#6349, batch 6), because `@object-ui/sdui-parser` publishes `Diagnostic` for a parser finding, a different shape. Both types are internal to the command: this package's entry exports `serve` and `init` only, so no import changes.
  
  No runtime behaviour changes; `objectui doctor` prints the same output.
- 088e0f7: A record-form field can name one item of a metadata registry by its machine name: a `text` field that declares `widget: 'position-ref'` lists the position registry, and one that declares `widget: 'permission-ref'` lists the permission-set registry. It stores the name only (objectui#7611, ruling B2 on objectstack#22865). This is the mechanism the metadata forms' `ref-multi:permission` picker brought in (objectui#12126), now reachable from an ObjectQL object field. A grant table's name field (`sys_user_position`'s position, `sys_user_permission_set.permission_set`) can now offer the declared items instead of a box for a typed name.
  
  - **The widget (`@object-ui/fields`).** `field:position-ref` and `field:permission-ref`, one key per registry type, with the type in the key, as `object-ref` carries `object`. Like every `widget` value, the name is looked up as `field:<widget>`. Each item reads as its label beside its name, and a pick writes the name: no label, no id. A stored name the loaded registry does not list stays on screen as its own option, flagged *not found*. The four catalog arms follow the metadata forms' `ref:dataset` / `ref-multi:<type>` pickers. With no data source that can list a registry, the field is a text box for the typed name. While the list loads, the stored name sits in a disabled box. When the load fails, a notice names the failure and its cause, and the text box stays enabled. A loaded but empty registry gives the same text box. Neither key is a declarable field type: both are widget hints, like `object-ref`.
  - **The catalog (`@object-ui/types`, `@object-ui/data-objectstack`).** `DataSource` gains an optional `listMetadataItems(type)`, answering `{ name, label }` headers for one registry type. An empty array is authoritative ("this registry has no item of this type"), so a failed load must reject, never resolve `[]`. `ObjectStackAdapter` implements it over `GET /api/v1/meta/:type` (the client's `meta.getItems`). It rejects with the transport's error, and refuses an answer that carries no `items` list. It is uncached, so an item authored in Studio shows on the next form.
  - **Locale keys (`@object-ui/i18n`).** `fields.registryRef.loadFailed` and `fields.registryRef.notFound`, in all ten packs.
  - **Wiring.** The form renderer threads `dataSource` to both keys, as it does for the other widget-hint pickers (`@object-ui/components`). The inline-grid exclusion set and the action-param value-shape table list both keys as widget-hint-only (`@object-ui/fields`, `@object-ui/app-shell`). The CLI's generated `KNOWN_SCHEMA_TYPES` gains `field:position-ref` and `field:permission-ref` (`@object-ui/cli`). A comment in `@object-ui/core` stops counting the picker names.
  
  **Clause-②: yes (widening)**: one optional `DataSource` member, two registered `field:` keys (the `RegisteredFieldWidgetType` union and `FORM_FIELD_TYPES` gain two members), and two locale keys. Nothing narrows: a field without the hint renders exactly as before.
- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [c096f03]
- Updated dependencies [92f4e2b]
- Updated dependencies [b10c68e]
- Updated dependencies [bdc9049]
- Updated dependencies [2e818d0]
- Updated dependencies [fd060f0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [c000398]
- Updated dependencies [73b5d77]
- Updated dependencies [e6dcd85]
- Updated dependencies [96fcf30]
- Updated dependencies [7a2c60b]
- Updated dependencies [9fc68aa]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [e06365c]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
- Updated dependencies [f34e877]
- Updated dependencies [9844bbf]
- Updated dependencies [cef0eee]
- Updated dependencies [7241a81]
- Updated dependencies [74add0c]
- Updated dependencies [aaba865]
- Updated dependencies [45d5853]
- Updated dependencies [4f4fc03]
- Updated dependencies [2312bd9]
- Updated dependencies [c5406c2]
- Updated dependencies [2a48bd4]
- Updated dependencies [c7b30bd]
- Updated dependencies [69bca0a]
- Updated dependencies [ce991bd]
- Updated dependencies [b7cd5c8]
- Updated dependencies [5330038]
- Updated dependencies [c9fc10b]
- Updated dependencies [dc6d28e]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [e723f58]
- Updated dependencies [f3d5408]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [c08c933]
- Updated dependencies [92f979d]
- Updated dependencies [c4dd707]
- Updated dependencies [c4dd707]
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [97e7d4e]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [7af0ab3]
- Updated dependencies [b434f5f]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [8106db1]
- Updated dependencies [093d55b]
- Updated dependencies [a8051d6]
- Updated dependencies [72594f2]
- Updated dependencies [524136e]
- Updated dependencies [6f3299f]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [ff9df88]
- Updated dependencies [70e843f]
- Updated dependencies [a2225f9]
- Updated dependencies [5c4deb5]
- Updated dependencies [c950345]
- Updated dependencies [21f9577]
- Updated dependencies [044f231]
- Updated dependencies [f8267df]
- Updated dependencies [3eb3ec1]
- Updated dependencies [1ffd6a2]
- Updated dependencies [5f8ecf6]
- Updated dependencies [726d8c9]
- Updated dependencies [ef71a09]
- Updated dependencies [619e3f7]
- Updated dependencies [c9e6742]
- Updated dependencies [f62b6ff]
- Updated dependencies [608033b]
- Updated dependencies [611566b]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [71243db]
- Updated dependencies [a8add5c]
- Updated dependencies [33ee9de]
- Updated dependencies [4839f5c]
- Updated dependencies [c7462e7]
- Updated dependencies [e058d76]
- Updated dependencies [c999d4c]
- Updated dependencies [8df2608]
- Updated dependencies [5483297]
- Updated dependencies [ed43c79]
- Updated dependencies [655e897]
- Updated dependencies [655e897]
- Updated dependencies [69a408f]
- Updated dependencies [d2b21a1]
- Updated dependencies [5ff64ef]
- Updated dependencies [26323c4]
- Updated dependencies [9753811]
- Updated dependencies [bc281f4]
- Updated dependencies [d637be3]
- Updated dependencies [2cfdc99]
- Updated dependencies [1e6d83b]
- Updated dependencies [c219165]
- Updated dependencies [a7ae252]
- Updated dependencies [30083da]
- Updated dependencies [8aa8e3e]
- Updated dependencies [024b7b6]
- Updated dependencies [909c64e]
- Updated dependencies [9e7e1a5]
- Updated dependencies [d0b9648]
- Updated dependencies [46dbf32]
- Updated dependencies [a928aaa]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [988aa9f]
- Updated dependencies [fb85637]
- Updated dependencies [df71568]
- Updated dependencies [d11174a]
- Updated dependencies [2d8a8b7]
- Updated dependencies [cbac9d7]
- Updated dependencies [4b92c5a]
- Updated dependencies [3650d94]
- Updated dependencies [8cd4db4]
- Updated dependencies [daeb77f]
- Updated dependencies [eb4552e]
- Updated dependencies [55e90fd]
- Updated dependencies [9b75509]
- Updated dependencies [b13ea3c]
- Updated dependencies [d7e9e9a]
- Updated dependencies [cf62edf]
- Updated dependencies [0253416]
- Updated dependencies [5d77c09]
- Updated dependencies [3fd8625]
- Updated dependencies [1473757]
- Updated dependencies [d73d987]
- Updated dependencies [12ff256]
- Updated dependencies [26b0bd2]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [088e0f7]
- Updated dependencies [b403bb3]
- Updated dependencies [4016370]
  - @object-ui/types@18.0.0
  - @object-ui/components@18.0.0
  - @object-ui/react@18.0.0

## 17.7.0

### Minor Changes

- 29b45f6: feat(core,components): the html tier registers and declares `code` — `<code>inline</code>` on a `kind:'html'` page renders its text instead of the `field:code` editor
  
  `renderers/basic/html-elements.tsx` called `code` "registered elsewhere", but the
  only bare `code` registration was the `field:code` widget's namespace fallback: a
  code editor reading `value`, with no declared inputs and no child slot. The
  console's html-tier compile whitelists `ComponentRegistry.getKnownTypes()`, so
  `<code>inline</code>` on an html page compiled, resolved to the editor, and the
  authored text was dropped — while `pre`, `strong` and `em` rendered their
  children through the passthrough, and `span` through its own renderer. The
  published manifest (objectui#10735) left `code` undeclared for the same reason,
  so the objectstack gate refused the tag the renderer mis-drew.
  
  **What moves for a consumer.**
  
  - `@object-ui/components` — `code` joins the `TAGS` loop of `html-elements.tsx`:
    registered `ui:code`, sanitised like its siblings, declaring `className` and the
    `children` slot. An html author's `<code>` now renders a real `code` element with
    its text.
  - `@object-ui/fields` — **BREAKING (authoring): the bare `code` key no longer
    resolves to the code-editor widget.** `code` joins `FIELD_TYPES_SKIP_FALLBACK`,
    so the widget is registered `field:code` only. A node authored as bare
    `{ "type": "code", "value": … }` now renders the html tier's `code` element (it
    draws `children`, not `value`); in a registry without `@object-ui/components`
    the bare key resolves to nothing. Migration: `{ "type": "code" }` becomes
    `{ "type": "field:code" }`. Form fields of type `code` resolve through the
    `field:` namespace and render the same editor as before. Released as `minor`
    under objectui's version policy; a breaking change never declares `major`.
  - `@object-ui/core` — `code` joins `HTML_TIER_INTRINSICS`, so `getPublicConfigs()`
    projects it stamped `tier: 'html'` and the regenerated `sdui.manifest.json`
    grows by one entry (the html tier declares 48 tags where objectui#10735
    declared 47); `div` and `kbd` stay undeclared.
  - `@object-ui/types` — `HtmlElementSchema` (zod and TS) names `code`, keeping the
    JSON-surface declaration equal to the registration, as the objectui#8499 pin
    requires — so `AnyComponentSchema` (and `objectui validate`) now accepts
    `{ "type": "code" }`, which it refused before.
  - `@object-ui/cli` — `packages/cli/src/utils/known-schema-types.ts` regenerates
    from the registrations and gains `ui:code`, so `objectui validate` and
    `objectui check` recognise it as a known schema type (the objectui#9533 and
    objectui#6416 precedent).
  
  The `kind:'react'` scope skips stamped entries, so no `Code` wrapper is injected
  on react pages. The framework's tracked manifest regenerates at its next
  `.objectui-sha` bump (objectstack#20112's port list); nothing there changes here.
- 37140f4: chore(cli)!: the generated known-types list drops the twelve node type keys objectui#10859 batch 8 phase 2b retired
  
  **BREAKING (authoring):** `KNOWN_SCHEMA_TYPES` (regenerated from the registration calls) no longer lists `scatter-chart`, `dashboard-grid`, `form-analytics`, `import-wizard`, `shared-view-link`, `app-creation-wizard`, `branding-editor`, `dashboard-editor`, `navigation-designer` or `related-list`, nor their namespaced twins, and no longer lists the bare `metric` / `metric-card` (their `plugin-dashboard:` keys stay). `objectui check` now reports a root document of one of those types as an unknown type, and `objectui validate` keeps refusing it at `type`, as it already did.
  
  Migration:
  
  - `scatter-chart` → `chart` with `chartType: "scatter"`;
  - `dashboard-grid` → `dashboard`;
  - `related-list` → `record:related_list`;
  - `metric` / `metric-card` as a standalone node → `plugin-dashboard:metric` / `plugin-dashboard:metric-card` (inside a dashboard, keep the widget spelling);
  - `form-analytics`, `import-wizard`, `shared-view-link`, `app-creation-wizard`, `branding-editor`, `dashboard-editor`, `navigation-designer` → mount the exported React component directly.
  
  The registered-types ratchet (`REFUSED_AT_TYPE`) falls from 36 to 24, and its namespaced twin from 389 to 379.
  
  **Clause-②: yes**, released as `minor` with this banner.
- ad1785c: chore(cli)!: the generated known-types list drops the four node type keys objectui#10859 batch 8 phase 2c retired
  
  **BREAKING (authoring):** `KNOWN_SCHEMA_TYPES` (regenerated from the registration calls) no longer lists `pie-chart`, `donut-chart`, `radar-chart` or `page-header`, nor their namespaced twins (`plugin-charts:pie-chart`, `plugin-charts:donut-chart`, `plugin-charts:radar-chart`, `layout:page-header`, `protocol-placeholder:page-header`). `objectui check` now reports a root document of one of those types as an unknown type, and `objectui validate` keeps refusing it at `type`, as it already did.
  
  Migration:
  
  - `pie-chart` / `donut-chart` / `radar-chart` → `chart` with `chartType: "pie"` / `"donut"` / `"radar"`;
  - `page-header` → `page:header`, with `title` / `subtitle` / `actions` in `properties`.
  
  The registered-types ratchet (`REFUSED_AT_TYPE`) falls from 24 to 20, and its namespaced twin from 379 to 374.
  
  **Clause-②: yes**, released as `minor` with this banner.
- 1c84036: chore(cli)!: the generated known-types list drops the ten `sidebar-*` node type keys objectui#10859 batch 8 phase 2d retired
  
  **BREAKING (authoring):** `KNOWN_SCHEMA_TYPES` (regenerated from the registration calls) no longer lists `sidebar-provider`, `sidebar-header`, `sidebar-content`, `sidebar-group`, `sidebar-menu`, `sidebar-menu-item`, `sidebar-menu-button`, `sidebar-footer`, `sidebar-inset` or `sidebar-trigger`, nor their `ui:` twins. `objectui check` now reports a root document of one of those types as an unknown type, and `objectui validate` keeps refusing it at `type`, as it already did.
  
  Migration: author the `sidebar` node, which now mounts its own provider when its host has none, and put the parts' content in its `children`. `@object-ui/components`' changeset for this phase lists the move per spelling.
  
  objectui#11441 retired its two layout keys first, so on that base this change takes the registered-types ratchet (`REFUSED_AT_TYPE`) from 18 to 8, and its namespaced twin from 372 to 362.
  
  **Clause-②: yes**, released as `minor` with this banner.
- 990a2d6: chore(cli)!: the generated known-types list drops the thirty node type keys objectui#10859 batch 8 retired
  
  **BREAKING (authoring):** `KNOWN_SCHEMA_TYPES` (`packages/cli/src/utils/known-schema-types.ts`, regenerated from the registration calls) no longer lists the 28 bare field-widget fallbacks retired in `@object-ui/fields`, nor `tree` / `view:tree` (`@object-ui/plugin-tree`) or `view` / `plugin-view:view` (`@object-ui/plugin-view`). `objectui check` now reports a root document of one of those types as an unknown type, and `objectui validate` keeps refusing it at `type`, as it already did.
  
  Migration:
  
  - a root `type` naming one of the 28 field types → write the field inside a form's `fields[]`; the widget is `field:<type>`;
  - `tree` → `object-tree`;
  - `view` → `object-view`.
  
  The registered-types ratchet (`REFUSED_AT_TYPE`) falls from 66 to 36, and its namespaced twin from 391 to 389.
  
  **Clause-②: yes**, released as `minor` with this banner.
- 9d9ed54: chore(cli)!: the generated known-types list drops `spec-report`, which objectui#11440 retired
  
  **BREAKING (authoring):** `KNOWN_SCHEMA_TYPES` (regenerated from the registration calls) no longer lists `spec-report` or its twin `plugin-report:spec-report`. `objectui check` now reports a root document of either type as an unknown type, and `objectui validate` keeps refusing it at `type`, as it already did.
  
  Migration: `{ "type": "spec-report", "report": { … } }` → `{ "type": "report", "report": { … } }`, with the same `report` member. `@object-ui/plugin-report`'s changeset for this change states what each face accepts.
  
  This change takes the registered-types ratchet (`REFUSED_AT_TYPE`) from 1 to 0, and its namespaced twin from 362 to 361.
  
  **Clause-②: yes**, released as `minor` with this banner.
- 9d1c0bf: chore(cli)!: the generated known-types list drops the two node type keys objectui#11441 retired
  
  **BREAKING (authoring):** `KNOWN_SCHEMA_TYPES` (regenerated from the registration calls) no longer lists `navigation-renderer` or `responsive-grid`, nor their namespaced twins `layout:navigation-renderer` and `layout:responsive-grid`. `objectui check` now reports a root document of one of those types as an unknown type, and `objectui validate` keeps refusing it at `type`, as it already did.
  
  Migration:
  
  - `responsive-grid` → `grid`, with the same breakpoint `columns` object and `gap`;
  - `navigation-renderer` → the app document's `navigation` items (`{ "type": "app", "name": N, "navigation": [...] }`), drawn by the shell.
  
  The registered-types ratchet (`REFUSED_AT_TYPE`) falls from 20 to 18, and its namespaced twin from 374 to 372.
  
  **Clause-②: yes**, released as `minor` with this banner.
  
  ⚠️ **Dated note, 2026-10-02 — `grid` takes column counts 1 to 12, not any number — objectui#11491.** At this change "the same breakpoint `columns` object" carried any count; now each count in a `grid`'s `columns` is one of 1 to 12, the counts the `grid` renderer maps, and `objectui validate` refuses any other with that set named. Every count `ResponsiveGrid` drew (1, 2, 3, 4, 6 and 12) is one of them, so the migration above holds for every `responsive-grid` that drew its columns. `.changeset/11491-grid-columns-set.md` states what ships. The rest of this entry is kept as the reading of this change.
  
  ⚠️ **Dated note, 2026-10-02 — `grid` takes one of ten `gap` steps, not any number — objectui#11474.** At this change "the same breakpoint `columns` object and `gap`" carried any `gap` number; now `grid`'s `gap` is one of 0, 1, 2, 3, 4, 5, 6, 8, 10 and 12, the steps the `grid` renderer maps, and `objectui validate` refuses any other with that set named. Every step `ResponsiveGrid`'s own class map drew (0 to 6 and 8) is one of them, so the migration above holds for every `responsive-grid` whose `gap` drew a class. `.changeset/11474-layout-spacing-sets.md` states what ships. The rest of this entry is kept as the reading of this change.
- 9de0b34: **BREAKING (`@object-ui/cli`):** `objectui generate` no longer accepts `--output`. The flag is retired, with no alias window, and the CLI now refuses it as an unknown option (objectui#11476).
  
  (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  - FROM `objectui generate TYPE NAME --output DIR` TO `objectui generate TYPE NAME`: drop the flag. Files are written in the generator's per-type layout under the current directory, e.g. `pages/NAME.json`.
  
  **Why.** The flag was declared (documented default `schemas/`) and documented, but nothing read it. The action called `generate(type, name)` without it, so a run with `--output custom/` exited 0, wrote `pages/NAME.json`, and created no `custom/` directory. Its documented default was not even where the generator writes. Honouring it would have meant inventing and testing an output layout for every resource type, with no measured user, so the flag goes instead.
  
  **What changes at the command line.** `objectui generate page NAME --output DIR` now exits non-zero with commander's unknown-option error and writes nothing. Without the flag, `generate` writes exactly where it wrote before. `objectui generate --help` no longer lists `--output`, and the `generate` flag table in the CLI docs drops its row.
  
  **Clause-②: yes.** The published CLI's accept set narrows: an option `generate` used to accept (and ignore) is now refused. No exported symbol moves.
- 1fe05ff: **BREAKING (`@object-ui/cli`):** `objectui generate` no longer accepts `--from`. The flag is retired, with no alias window and no placeholder, and the CLI now refuses it as an unknown option (objectui#11488).
  
  (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  - FROM `objectui generate TYPE NAME --from SOURCE` TO `objectui generate TYPE NAME`: drop the flag. No import from an external source (OpenAPI, Prisma) exists, so there is nothing to replace it with; `generate` scaffolds the resource in the generator's per-type layout under the current directory, e.g. `pages/NAME.json`.
  
  **Why.** The flag was declared ("Generate schema from external source (openapi.yaml, prisma.schema)") and documented as *experimental*, but no importer was ever built. A run with `--from openapi.yaml` printed "not yet implemented", exited 0 and wrote nothing, so a script or CI step read the no-op as success. No producer of the flag was measured, and building an OpenAPI or Prisma importer would be a new capability with no pull, so the flag goes instead.
  
  **What changes at the command line.** `objectui generate page NAME --from SOURCE` now exits non-zero with commander's unknown-option error and writes nothing. Without the flag, `generate` behaves exactly as before. `objectui generate --help` no longer lists `--from`, and the `generate` section of the CLI docs drops its flag table, which `--from` was the last row of.
  
  **Clause-②: yes.** The published CLI's accept set narrows: an option `generate` used to accept (and answer with a no-op that exited 0) is now refused. No exported symbol moves.
- ea39141: **BREAKING (`@object-ui/cli`):** the `objectui add` command is retired, and so are `objectui analyze`'s two flags, `--render-performance` and `--bundle-size`. There is no alias window and no placeholder: the CLI now refuses `add` as an unknown command and each flag as an unknown option (objectui#11496).
  
  (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  - FROM `objectui add COMPONENT` TO nothing: drop the call. No renderer download or scaffold exists, so there is nothing to replace it with.
  - FROM `objectui analyze --render-performance` TO nothing: drop the call. It analysed nothing; it printed the same fixed list of tips in every directory.
  - FROM `objectui analyze --bundle-size` TO `objectui analyze`: drop the flag. The bundle-size report is now all `analyze` does.
  
  **Why.** `add` was declared ("Add a new component renderer to your project") and documented with an example, but its action printed "Feature not implemented yet.", wrote nothing and exited 0, so a script or CI step read the no-op as success. No producer of the command was measured, and downloading renderer source into a project would be a new capability with no pull, so the command goes instead. Checking every other command and flag the CLI declares turned up one more no-op: `analyze --render-performance` printed fixed text, byte for byte the same in an empty directory and in a built project, and exited 0. It goes the same way. `--bundle-size` only chose between that section and the bundle report; with one analysis left it would be read by nothing, which is why `generate --output` was retired, so it goes too.
  
  **What changes at the command line.** `objectui add Input` now exits non-zero with commander's unknown-command error and writes nothing. `objectui analyze --render-performance` and `objectui analyze --bundle-size` exit non-zero with the unknown-option error. `objectui analyze` with no flag prints the bundle-size report of `dist/` exactly as before, without the fixed render-performance section. `objectui --help` no longer lists `add`, `objectui analyze --help` lists no flags, and the CLI docs and the package README drop the `add` section and the `analyze` flag table.
  
  **Clause-②: yes.** The published CLI's accept set narrows: a command and two options it used to accept are now refused. No exported symbol moves; `analyze` is not part of the package's exports.
- 37268aa: **BREAKING (`@object-ui/cli`):** four commands are retired: `objectui create`, `objectui lint`, `objectui test` and `objectui studio`. There is no alias window and no placeholder: the CLI now refuses each as an unknown command (objectui#11500).
  
  (The bump is `minor` by this repo's release model: objectui's major follows the `@objectstack` family major, and its own breaking changes ship as `minor` with the breaking semantics stated here.)
  
  - FROM `objectui create plugin NAME` TO `npm create @object-ui/plugin NAME`, the package's own initializer (`@object-ui/create-plugin`). `plugin` was the only type `create` accepted, so `create` itself goes.
  - FROM `objectui lint` and `objectui test` TO your project's own ESLint and Vitest (or whichever linter and test runner it declares), run directly.
  - FROM `objectui studio` TO nothing published. Contributors to the objectui monorepo run `pnpm --filter console dev`.
  
  **Why.** Each of the four could only fail. `create plugin` looked for its generator one directory too high, so it exited 1 with a "Cannot find module" error in a checkout and in an installed copy alike, and wrote nothing. `lint` and `test` ran ESLint and Vitest inside the temp app `objectui dev` generates, which declares neither tool and has no lint config and no tests, so they failed on every run, and they reported the setup error as lint findings or failed tests. `studio` started this monorepo's console app rather than the local project its documentation promised, and outside the monorepo it exited 1 with "Console app not found in workspace".
  
  **Corrected alongside, each to what the command does:**
  
  - `objectui analyze` with no `dist/` directory now exits non-zero with an error naming the missing `dist/`. It used to print a warning, then "Analysis complete", and exit 0.
  - `objectui init NAME --template UNKNOWN` now refuses the template before it creates the `NAME` directory. It used to exit 1 and leave an empty `NAME` directory behind, which the next `init NAME` then refused as already existing.
  - `objectui doctor`'s help no longer says it fixes issues. It reports and changes no file. The CLI docs no longer promise a Node version check it never ran.
  - The CLI docs no longer say `objectui serve` lacks `--no-open`. It has always accepted it, as `dev` does.
  
  **What changes at the command line.** `objectui create plugin my-widget`, `objectui lint`, `objectui test` and `objectui studio` now exit non-zero with commander's unknown-command error and write nothing. `objectui --help` no longer lists them. The CLI docs and the package README drop their sections, and the docs name the plugin initializer.
  
  **Clause-②: yes.** The published CLI's accept set narrows: four commands it used to accept are now refused, and `analyze` without `dist/` now exits non-zero. No exported symbol moves; none of these commands is part of the package's exports.
- 33da643: feat(cli): `objectui check` refuses a `${…}` on a text key its node never evaluates
  
  `SchemaRenderer` evaluates an expression on the closed text keys `title`,
  `label`, `value` and `description` only where `@objectstack/spec`'s
  `expressionBindableTextKeysFor(type)` lists that key for the node's type.
  Anywhere else the expression is never resolved, so the user sees
  `${data.total}` as literal text, or nothing at all — and no step before the
  browser said so.
  
  `objectui check` now refuses such an expression in every file it recognises as
  an ObjectUI schema, and the run exits non-zero. The refusal names the key, the
  path to it (spelled as `objectui validate` spells paths), the keys that type
  does evaluate, and the channels `SchemaRenderer` evaluates. Types with no row in
  the carriage map are refused too: `text.value` and `action:button.label` are
  never evaluated.
  
  - **Component nodes only**: the file's root node and every node its `children`
    hold. Objects under other keys, such as a form's `fields` entries, are
    definitions rather than nodes and are not judged. A root of type `page` keeps
    its own `title`, which is a page key; its `children` are still judged.
  - **The type is matched as written**, as the runtime matches it: `ui:card` has
    no row, and is not read as `card`.
  - **A type no registered component answers to** gets a warning instead of a
    refusal, because a custom renderer may evaluate its own keys.
  - **There is no escape spelling**: a `${…}` meant as literal text on one of
    these keys, such as a code sample in a `code-editor`'s `value`, is refused
    too. Write it without `${`.
  
  The key vocabulary and the per-type carriage map are read from
  `@objectstack/spec`, now a declared dependency of `@object-ui/cli`, so a row
  added upstream moves this check and the runtime together.
- 7dc08a3: `objectui check` recognises a schema by validating it, and reports broken ObjectUI files instead of filing them as foreign ones.
  
  A file with a root `type` was judged only when its root carried an ObjectUI
  structural key (`children`, `body`, `className`, …). Leaf schemas carry only
  their own vocabulary, so nothing checked them: measured on this repository, 475
  files were eligible, 166 were judged and 309 were skipped.
  
  The command now has a second recogniser arm — the document validates as an
  ObjectUI component schema under `@object-ui/types`' own Zod union — which the
  maintainer's 2026-08-25 ruling selected over shipping a JSON Schema artifact to
  point a `$schema` URL at. It admits 209 of those 309 files. The structural arm
  still runs first, so recognition costs nothing for files that already had a
  marker, and `package.json` is still never judged: `"type": "module"` names no
  component the protocol models.
  
  Validity alone would have answered two different questions with one word.
  A broken ObjectUI schema fails validation exactly as a foreign file does, so a
  two-bucket report would have filed it as "not ObjectUI" — and the symptom of
  that is an absence: the file simply stops being mentioned. Measured, that bucket
  is not empty: 54 files land in it and 53 of them are real corpus content.
  
  So files the recogniser refuses are split. When the root `type` names a
  component this build registers, the file is **listed by name** as ObjectUI
  content that did not validate, pointing at `objectui validate <file>` for the
  reason — either the document is off-spec or its component type is not modelled
  by `@object-ui/types`. Everything else is counted as skipped, as before. The
  printed explanation now describes both arms, and only unreadable JSON still
  makes the command exit non-zero.
- 2acd8e1: **BREAKING (authoring surface): `body` is no longer a child-list key. Author `children`.**
  
  `BaseSchema` declared two spellings of one concept — `body` and `children` — and left the
  choice per component. **Thirteen** registrations read `body` and nothing else, so it was
  their ONLY door — the twelve the ruling enumerated plus `tooltip`, which it did not, and
  which is the count the committed instrument carries (`BODY_ONLY` plus
  `BODY_ONLY_UNRULED` in `scripts/body-dialect-census.mjs`). `div`, `card`, `page`,
  `button`, `aspect-ratio`, the seven sectioning tags and the safe-HTML tag factory read
  `children || body` and took either. The authoring tier only ever knew `children`, so
  an author writing the one spelling that resolved got `unknown-prop` — the same warning a
  typo draws, on the tier built to accept AI-authored pages, where the diagnostic **is** the
  contract (objectui#6771).
  
  Ruled 2026-09-01: one concept, one spelling, and the spelling is `children`.
  
  ## What changed
  
  - **Renderers.** `alert`, `badge`, `tooltip` and the `sidebar-*` family read `children`.
    Every `children || body` fallback drops its `body` arm **except the four `page:*`
    reads named below** — `div`, `card`, `button`, `aspect-ratio`, the sectioning tags,
    the safe-HTML tag factory behind ~36 tags, `page`'s flat content list, and
    `@object-ui/core`'s recursive `validateSchema`.
  - **Item-level `body` is a DIFFERENT key and is untouched.** At this change, `list`
    draws each entry as `item.content || renderChildren(item.body)` and `tabs` as
    `item.content || item.body`, both filed under the ITEM type rather than the node,
    and `tabs` still ships `body` inside its own `defaultProps`. ⛔ Neither is this
    spelling and neither is refused here: the node-level retirement does not reach a
    member of a declared `items` array. Retiring the item-level dialect is
    objectui#9590's card, and the two named above are recorded on it.
    ⚠️ **Dated note, 2026-09-25 — neither half of this bullet holds any longer — objectui#9590.**
    objectui#9941 respelled the `tabs` `defaultProps` items to `content`, and
    objectui#9590 retired both item-level reads: a `list` item and a `tabs` item draw
    `content` and nothing else, and both item faces now refuse `body` by name,
    pointing at `content`. The rest of this bullet is kept as the reading of this change.
  - **What still reads `body` at NODE level, and why.** Four renderer reads, all `page:*`: `page:card`
    (renderer and Studio canvas) and the three thin `page:section` / `page:footer` /
    `page:sidebar` containers. ⛔ Authoring the key is refused on them as it is
    everywhere else; only the READ survives, for documents already STORED under it.
    `@objectstack/spec` states the ground on `PageContainerProps` itself: «The renderers
    keep reading `body` as a back-compat fallback for stored documents; that fallback is
    objectui's to retire on its own schedule, and it is not a second authorable
    spelling.» ⚠️ What separates the two halves is a CONVERSION, not a ground: the spec's
    registry carries `page-card-body-to-children` (`toMajor: 17`, surface
    `page.component.page:card.body`, shipped `retiredFromLoadPath: true` in spec 17.0.0)
    and carries none for the other three — so a stored row under their key has no
    migration path at all. Nothing in this repository authors any of them, and the
    committed census over those keys is how to see that rather than take it on trust:
    `node scripts/body-dialect-census.mjs --keys page:section,page:footer,page:sidebar,page:card,card`.
    ⚠️ This sentence used to restate that table's answer instead of pointing at it, and
    the very commit that edited the sentence moved the figure — a count copied into prose
    is what AGENTS.md #9 forbids, so the instrument replaces the number. Read the table
    for three things: `card` + `body` is a control that FIRES on the head that ships (so
    a zero elsewhere is a reading, not a blind spot), every node still carrying `body`
    under these keys falls in the `test` bucket, and `page:section` is a LIT zero — 6
    nodes resolved, 0 `body`, 4 `children` — rather than a key nobody asked about.
    Retiring the THREE THIN reads is objectui#9916,
    which asks for the stored-corpus reading they turn on; `page:card`'s read is not
    that card's either — it is objectui's own, grounded by objectstack#5775 /
    ADR-0087 D2 rather than owned by it, and it ends when the stored rows have been
    replayed through the conversion that already shipped for it.
  - **The published type.** `BaseSchema.body` is `never` on the TypeScript face and an
    alias refusal naming `children` on the Zod mirror, as are the four per-component
    redeclarations (`CardSchema`, `AspectRatioSchema`, `PageNodeSchema`, `TooltipSchema`).
    ⚠️ Refused **by name**, not deleted: `BaseSchema` carries an index signature and the
    mirror ends `.passthrough()`, so a deleted member would be accepted silently and
    rendered by nothing — the exact silence this retirement ends.
  - **The VS Code extension (`object-ui`) changes behaviour, not just teaching.** Its
    preview no longer draws a `body`-spelled document — the node renders empty, the way
    the runtime renders it — and its validator now emits a warning naming `children` at
    the key's own position. That warning is skipped for node types that declare their
    own `body` input (`record:alert`), so a declared translation-map `body` is not
    reported as the retired spelling.
  - **Two new `@object-ui/sdui-parser` exports.** `RETIRED_CHILD_LIST_KEY` (the retired
    spelling, so a consumer names it once) and `checkRetiredBodyDialect` (the diagnostic
    the tier substitutes for `unknown-prop` on that key).
  - **The authoring tier.** `sdui-parser` answers an authored `body` with the replacement
    named, instead of the bare "has no prop" every typo gets — and a `body` child list
    under a non-container draws the same containment code the `children` spelling draws.
  - **Corpus and teaching, in the same change.** 114 authored nodes across the docs site,
    the schema catalog, five package READMEs and the VS Code extension's snippets, JSON
    schema, syntax map, hovers and completions. The platform does not refuse a spelling it
    still ships.
  
  ## Migrating
  
  Rename the key. `{ "type": "card", "body": [...] }` becomes
  `{ "type": "card", "children": [...] }`; both faces now name `children` in the refusal,
  and `pnpm census:body-dialect` reports where the dialect still lives in a tree.
  
  ⚠️ **Four renderer reads are deliberately untouched, all in the `page:*` namespace** —
  `page:card` and the three thin `page:section` / `page:footer` / `page:sidebar`
  containers. They are read-only back-compat paths for STORED documents, not a second
  authoring face: `@objectstack/spec`'s `PageContainerProps` says so itself — `children`
  is canonical, `body` is deliberately not declared, and «the renderers keep reading
  `body` as a back-compat fallback for stored documents; that fallback is objectui's to
  retire on its own schedule».
  
  ⛔ **Authoring `body` on them is still refused**, on both published faces and at the
  authoring tier, exactly as everywhere else. What survives is the READ.
  
  ⚠️ The two halves are not in the same state. `page:card` has a migration path — the
  spec's conversions registry carries `page-card-body-to-children` (`toMajor: 17`,
  surface `page.component.page:card.body`), which shipped with `retiredFromLoadPath: true`
  in spec 17.0.0. The other three have **no conversion at all**, so a stored row under
  their key has nowhere to be migrated to. ⇒ the two halves are tracked separately, and
  the pointer is not one card: retiring the three thin reads is objectui#9916, whose
  question is the stored corpus; retiring `page:card`'s read was **grounded by**
  objectstack#5775 / ADR-0087 D2, whose conversion has already shipped and whose
  remaining condition is replayed rows. ⚠️ Grounded by, not owned by — the distinction
  is the point. objectstack#5775 is CLOSED and its body is a props-declaration audit
  that carries no such step, so a reader sent there for the action finds none. The
  action is objectui's, on the spec's own terms quoted above: «that fallback is
  objectui's to retire on its own schedule.»
  
  **Non-rendering readers keep their arm on the same rule**, and none of them renders
  anything: while a renderer still reaches stored `body` content, a reader that must see
  the SAME content keeps its arm, or the renderer draws what the reader cannot find.
  Those are the two tab-subtree walkers in `renderers/layout/containers.tsx`,
  `app-shell`'s `pageSchemaIntrospect` (`CONTAINER_KEYS`) and `PageBlockInspector`
  (`STRUCTURAL_PROP_KEYS`, the inspector half of a stored `properties.body`), and the
  CLI's `OBJECTUI_STRUCTURAL_KEYS` — a file-IDENTIFICATION marker, where keeping `body` is
  what lets an old file still be recognised as an ObjectUI node and therefore refused,
  instead of silently not judged.
  
  ⚠️ **Dated note, 2026-10-02 — the `sidebar-*` parts are retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 (phase 2d) unregistered the ten `sidebar-*` part keys. Of the
  family the **Renderers** line names, only `sidebar` remains, and it reads `children`. The rest of this entry is
  kept as the reading of this change.
- a5d5547: `objectui validate` now prints the failing union arm the document selected, instead of a
  bare "Invalid input" (maintainer ruling 2026-09-02 — option B).
  
  `safeValidateSchema` checks a document against `AnyComponentSchema`, a `z.union`. When a
  document matches no arm, Zod reports ONE top-level issue — `invalid_union` · `Invalid
  input` · path `(root)` — and hangs every arm's real diagnosis off that issue's `errors`
  array, which nothing read. So a menu whose item used the divider spelling retired in
  objectui#6523 printed a bare verdict on the whole document, while the remediation text
  `8063bcbdc` wrote into that arm sat one level down, unreachable.
  
  **What is printed now.** When the top-level issue is a failing union:
  
  - the document's `type` selects exactly one arm ⇒ that arm's issues are printed beneath
    the entry as `1.1`, `1.2` … with their real paths (`Path: items → 0 → type`) and codes,
    and **nothing** from the other arms;
  - no arm accepts the `type` ⇒ `No arm accepts type "dropdwn-menu".` plus the nearest few
    of the accepted values, ranked by edit distance and **capped** at five
    (`MAX_UNION_ARMS_REPORTED`);
  - the document declares no `type` at all ⇒ the note says so and offers no candidates —
    "nearest" needs something to be near, and an alphabetical slice of 108 arm names
    presented as guidance would be a bogus suggestion;
  - a union with no `type` discriminator to select on — `MenuItemSchema`, whose two arms
    both declare `type` as an ADR-0049 retirement tombstone — reports every arm, labelled
    and capped by the same constant. This is the path that finally delivers the
    objectui#6523 text to the author.
  
  Printing EVERY arm was rejected in the ruling: `AnyComponentSchema` resolves to 108 leaf
  arms, so one mistyped `type` would have produced hundreds of lines.
  
  `objectui check` is unchanged and deliberately so: it has no zod-issue printer, using
  `safeValidateSchema(...).success` as a boolean recogniser. Printing issues behind a
  *negative* recognition would flood its report with diagnoses of non-ObjectUI files, the
  failure objectui#5127 and objectui#6075 exist to prevent.
  
  ⚠️ **Dated note, 2026-09-29 — objectui#11007.** `check` now prints one line under each file in
  its "did not validate" list: the first issue's path, spelled by the formatter behind `validate`'s
  `Path:` line, and its message, with no arm selection. That list is the only place it prints
  one. Files counted as skipped, the foreign files the paragraph above guards against, still get
  no diagnosis.
  
  Nothing about which documents are ACCEPTED changes — this is diagnostic output only.
- 4b5bb95: The VS Code extension no longer ignores a child list spelled `children`, and everything
  the platform scaffolds now emits that spelling (objectui#7181).
  
  ## The defect, and who it hit
  
  `children` is the spelling ObjectUI declares on four faces: the `BaseSchema` TypeScript
  declaration and its zod mirror in `@object-ui/types`, `validateSchema` in
  `@object-ui/core`, and the authoring tier's `BASE_PROPS` in `@object-ui/sdui-parser`
  (which accepts `children` and does **not** list `body`).
  
  Both readers in the VS Code extension honoured only `body`. So an author who wrote the
  spelling the platform blesses got, from the tool meant to be teaching them the format:
  
  - **a blank preview** — `Object UI: Open Preview` rendered the node as an empty card or
    container, with no error and no diagnostic; and
  - **children that were never validated** — the validator's recursion never reached them,
    so a child missing its required `type` drew no warning at all.
  
  Both failures were silent in both directions: nothing told the author their file was
  being skipped, and nothing told them it was fine. Metadata written to a file by one
  party and re-authored by another was simply dropped by the reader.
  
  Both readers now read `children` first and **keep** `body`, so every existing
  `body`-spelled document behaves exactly as it did. Nothing is removed and no accepted
  spelling is narrowed. The extension's validator also reports diagnostics at the key the
  document actually used, instead of addressing them to `.body[...]` in a file that
  contains no such key.
  
  ## Scaffolders and shipped defaults now emit `children`
  
  The same dialect was being *produced* into files users own, and into components' own
  declared defaults:
  
  - `objectui init` — the `app.json` written for every template
  - `Object UI: Create New Schema` — every template the VS Code extension writes
  - `carousel`, `resizable` and `scroll-area` — the child lists inside their shipped
    `defaultProps`
  - the runner's "no index page found" fallback page
  
  Every node type involved already read `children`, so rendering is unchanged; what moves
  is the spelling users are handed as their starting point.
  
  ⚠️ This is a change to what those tools *emit*, not to what ObjectUI accepts: `body`
  remains readable everywhere it was readable before, and a project scaffolded by an
  earlier version needs no edit. Retiring the `body` arm is a separate, already-ruled
  step and is not part of this release. `pnpm census:body-dialect` is the instrument that
  reports where the dialect still lives.
  
  Scaffolded output and shipped defaults are now pinned by tests that discover the
  template population from the code, so a template added later is covered without anyone
  remembering to extend them.
- 67749c7: Discriminate `AnyComponentSchema` on `type` (objectui#8498).
  
  The union was flat, so a refusal carried EVERY arm's issue list, and Zod's
  `$ZodError` initializer stringifies that whole tree into `.message` eagerly — in the
  constructor, not behind a getter. The cost was paid whether or not anyone read the
  message, and it compounded per level of nesting: measured on zod 4.4.3, a root
  refusal cost 14,624 chars, growing until `RangeError: Invalid string length`, thrown
  out of `safeValidateSchema` — documented as validating "without throwing errors".
  Discriminated, the same document costs 164. `ObjectQLComponentSchema` and
  `CRUDComponentSchema` follow for the same reason: zod refuses a plain `z.union` as a
  discriminated member.
  
  **No document changes verdict.** The 13 arms declare 107 `type` literals with zero
  collisions, so the arm a literal selects was already the only arm that could accept
  it; across 440 example documents, flat and discriminated agree on every one.
  
  **What moves is diagnostics.** A refused document whose `type` selects an arm now
  reports that arm's issues as top-level issues at absolute paths, rather than one
  `invalid_union` at the root with them nested inside; a `type` no arm claims is
  reported at `type` rather than at the root. `objectui validate` prints the same
  2026-09-02 ruling output — the selected arm alone, or a note plus a capped candidate
  list — read off the new issue shape.
  
  ⚠️ **Dated note, 2026-09-28 — a fourteenth arm — objectui#10859.** Later in this same release
  `AnyComponentSchema` gains a fourteenth top-level arm, `AIComponentSchema` (the three AI node types),
  and still no `type` literal is claimed by two arms — the property this entry's "no document changes
  verdict" rests on. The counts above are this change's reading; the objectui#10859 entry states what
  that arm accepts.
- 6a4680b: Retire `line-chart`, `area-chart` and `advanced-chart` — three chart component keys the
  console registered as lazy stubs that `@object-ui/plugin-charts` never fulfilled
  (objectui#8760).
  
  **The defect, and why it outlived the checks.** `apps/console` registered ten chart
  variants as `registerLazy` stubs pointing at `@object-ui/plugin-charts`. That package
  registers eight keys; three of the ten were not among them. An unfulfilled stub does not
  fail — it succeeds at being useless, in both of the places that decide whether a defect
  is ever seen:
  
  - **At render.** `SchemaRenderer`'s lazy branch re-checks `hasLazy(type)` on every pass
    and returns the `Loading <type>…` placeholder. `Registry.register()` deletes a lazy
    entry only for keys the loaded module actually registers, so for an unfulfilled key the
    entry SURVIVES the load and every later pass takes the same branch. Measured on
    `b775500af` through the real chain: `{ "type": "line-chart" }` painted
    `role="status"` / `data-lazy-loading="line-chart"` / `Loading line-chart…`,
    permanently. **Not** the `OBJUI-001` panel the card expected — no alert, no error, no
    console warning. A skeleton that never resolves reads to a user as a slow network.
  - **At authoring.** A stub is enough to put a key into `getKnownTypes()`, so
    `check:doc-types` and the CLI's generated `KNOWN_SCHEMA_TYPES` snapshot both blessed
    all three. `content/docs/plugins/plugin-dashboard.mdx` taught `"type": "line-chart"`
    inside a `card` body, and every gate was green on it.
  
  So the failure was strictly worse than an unknown key: an unknown key is refused loudly at
  authoring time, while these passed every check, were taught by the documentation, and
  failed only at render in front of a user.
  
  **Why removal rather than implementation.** Both repairs were available and they are not
  equivalent. Fulfilment would mint three new pieces of authorable surface: `line-chart` and
  `area-chart` duplicate, under a second spelling, families the plugin already draws as
  `{ "type": "chart", "chartType": "line" | "area" }`, and `advanced-chart` was never a
  family at all — it named `AdvancedChartImpl`, an internal module. Measured demand for all
  three is zero: a sweep of both repositories for authored nodes of these types returns
  exactly one hit, the doc snippet corrected here, against lit controls in the same
  commands (`"type": "bar-chart"` 5, `"type": "chart"` 12, `object-chart` 1 in the sibling
  repo). No example app, fixture, seed document or deployment authors any of them. Under
  声明即强制, a declaration with no delivery and no demand comes off rather than growing an
  implementation to match it.
  
  **Breaking, for anyone who authored a retired key.** A document with
  `{ "type": "line-chart" }` used to resolve in the registry and then draw nothing; it is
  now refused by name — `SchemaRenderer` paints the `OBJUI-001` panel instead of an endless
  skeleton. `objectui validate` refuses the document at `type` (`invalid_union`). That is a
  louder failure for the same broken document, not a new one: no document that previously
  DREW is affected. Migrate to `{ "type": "chart", "chartType": "line" | "area" }`, which
  `CHART_TYPE_KEYWORD_FAMILIES` resolves. Scored `minor`, not `major`, per
  AGENTS.md §版本号策略.
  
  ⚠️ **Dated note, 2026-09-25 — `objectui check` warns only in a file it recognises —
  objectui#10606.** This entry first said `objectui check` reports `Unknown schema type
  "line-chart"` for that document. `check` checks the `type` of each file it recognises, and a
  file whose root carries an ObjectUI structural key (`children`, `className`, `body`, …) is
  recognised by that key alone. A file with none of those keys is parsed against the schema
  and recognised only if it validates; one that does not validate is listed by name when its
  root `type` is on the known-type list `check` reads, and is otherwise counted as skipped.
  `line-chart` is no longer on that list, so `{ "type": "line-chart" }` is counted as skipped
  ("no ObjectUI recogniser admitted") and gets no unknown-type line, while
  `{ "type": "line-chart", "className": "h-64" }` gets one. `check` exits non-zero on
  unreadable JSON only; the verdict is `objectui validate`'s.
  
  **What moved.** The stub lists in `apps/console/src/register-plugins.ts` and
  `apps/console/src/preview-gallery.tsx` (both loops, because the doc gate's key universe is
  their union — retiring one alone would have changed nothing observable); the dashboard doc
  snippet plus a note on how chart families are actually spelled; the regenerated
  `KNOWN_SCHEMA_TYPES` snapshot (six entries, three bare and three namespaced); and the
  `line-chart` leg of `node-slot-registered-arms-8499.test.ts`, whose premise this
  retirement changed and which reads the stub list rather than the file so the ⛔ comment
  left behind cannot satisfy it.
- e356c39: Converge the bare `dashboard` key on `plugin-dashboard`, and retire
  `view:dashboard` with a by-name tombstone (objectui#9533).
  
  **Breaking for authored metadata.** `{ "type": "view:dashboard" }` no longer
  renders a dashboard. It now resolves to a refusal that names the spelling and
  names its replacement. `objectui validate` refuses the document at `type`
  (`invalid_union`). `{ "type": "dashboard" }` and
  `{ "type": "plugin-dashboard:dashboard" }` both render `DashboardRenderer`,
  unchanged and newly-working respectively.
  
  ⚠️ **Dated note, 2026-09-25 — `objectui check` names the spelling only in a
  file it recognises — objectui#10606.** This entry first said `objectui check`
  reports `{ "type": "view:dashboard" }` as an unknown schema type, and **What
  changed** below said, unscoped, that `check` names the spelling. `check` checks
  the `type` of each file it recognises, and a file whose root carries an ObjectUI
  structural key (`children`, `className`, `body`, …) is recognised by that key
  alone. A file with none of those keys is parsed against the schema and
  recognised only if it validates; one that does not validate is listed by name
  when its root `type` is on the known-type list `check` reads, and is otherwise
  counted as skipped. `view:dashboard` is withheld from that list, so the document
  above is counted as skipped ("no ObjectUI recogniser admitted") and gets no
  unknown-type line, while `{ "type": "view:dashboard", "className": "h-64" }` gets one.
  `check` exits non-zero on unreadable JSON only; the verdict is
  `objectui validate`'s.
  
  **What was wrong.** `apps/console` declares the lazy stub for bare `dashboard`
  under `plugin-dashboard` — twice, in `preview-gallery.tsx` and
  `register-plugins.ts` — while this package registered the renderer as
  `view:dashboard`. Neither site passed `skipFallback`, so both also claimed the
  bare key (`Registry.register` and `Registry.registerLazy` share the
  `meta?.namespace && !meta?.skipFallback` branch, and `registerLazy` has no
  collision check at all, so nothing warned). Two consequences followed, and both
  were reproduced against a real `Registry` before anything here was written:
  
  1. **The bare key was double-claimed, phase-dependently.** After the stub step
     bare `dashboard` declared namespace `plugin-dashboard`; after the chunk
     loaded the same key declared `view`. Which answer a host got depended on when
     it asked — the objectui#6416 shape, which converged `plugin-report` off it.
  2. **The namespaced stub was never cleared.** `register()` clears the lazy stub
     of the type IT registers, and that type was `view:dashboard`. So
     `hasLazy('dashboard', 'plugin-dashboard')` read `true` after the package had
     fully loaded and `get('dashboard', 'plugin-dashboard')` read `undefined`,
     while the generated CLI whitelist listed that spelling as renderable. A node
     authored with it could only ever paint `Loading plugin-dashboard:dashboard…`
     forever: `Registry.loadLazy` resolves whether or not the loaded module
     registered the expected type, and `SchemaRenderer` re-checks `hasLazy` on
     every pass. That is the objectui#8760 shape — a key that passes every
     authoring check and fails only in front of a user.
  
  **What changed.** The renderer registers as `plugin-dashboard:dashboard`, the
  namespace every sibling plugin, both console stubs and the CLI whitelist already
  use, so the console stubs are cleared on load and all three claimants of the bare
  key name ONE full type. The retired `view:dashboard` key answers
  `RetiredDashboardNodeTombstone` — an inline refusal, plus a `console.error`
  carrying the same text — registered with `skipFallback: true` so it claims no
  bare key. Its spelling is withheld from the derived key universe by declaration
  in `scripts/check-doc-component-types.mjs`, the same disposition the
  `RETIRED_FIELD_TYPES` tombstones take, so `objectui check` names it in a file it
  recognises rather than blessing it; `packages/cli/src/utils/known-schema-types.ts`
  regenerates and loses that one entry.
  
  **Also published: four new symbols on the package entry.** `src/index.tsx`
  re-exports `RETIRED_DASHBOARD_NODE_TYPES`, `RetiredDashboardNodeTombstone`,
  `reportRetiredDashboardNodeType` and `resetRetiredDashboardNodeTypeReports` from
  `./retired-node-types`, and `exports["."]` is what publishes them — so these are
  **published** surface, not an internal one, and removing or renaming one later is
  a breaking change like any other export. They exist for the same reason
  `@object-ui/fields` publishes its tombstone: the pin has to import the refusal
  text it asserts rather than restate it.
  
  **Also visible in the DOM: the `data-obj-type` value on a dashboard grid.** That
  attribute carries the type the node was AUTHORED with, so the spelling that puts
  a dashboard grid on the page moves with the registration.
  `[data-obj-type="view:dashboard"]` no longer selects one — that node now renders
  the tombstone, which publishes `data-retired-node-type` and no `data-obj-type` at
  all — while `[data-obj-type="plugin-dashboard:dashboard"]` now does.
  `{ "type": "dashboard" }` is unchanged and still reads `dashboard`. A stylesheet,
  a selector or a DOM assertion keyed on the retired value stops matching, and
  stops matching silently, so it is declared here rather than left to be found.
  
  **Ruled, not chosen.** Director seat summon #24, batch #152 item 5 letter 1,
  maintainer 「其他同意」 2026-09-18. The two rejected routes are on the record:
  converging on `view` would leave the whitelist advertising a dead
  `plugin-dashboard:dashboard`, and standing one side down resolves the naming
  contest but not the unsatisfiable stub.
  
  **`Clause-②: yes`**, declared by that ruling: the published full name moves. Note
  the shape, because it is unusual — the accept set **narrows** (an authored
  `view:dashboard` stops resolving) and the clause is `yes` anyway, on the
  published-name move rather than on a widened surface. `minor` per AGENTS.md's
  版本号策略: objectui's own breaking changes take `minor`, with the breaking
  semantics written out here.
  
  `packages/plugin-dashboard/src/__tests__/dashboardBareKeyOwnership.test.tsx` is
  the half that outlives the fix. It reads the package's real declared metadata
  back out of the registry and replays it into a fresh `Registry` in **both**
  orders — eager-then-lazy and lazy-then-eager — checking the bare key's declared
  namespace after every step, so order- and phase-independence are properties under
  test rather than properties of the file it imports. It also asserts `hasLazy` is
  false after the load, and asserts the `view:dashboard` refusal **together with**
  the tombstone's own migration text, because a pin that asserts only "no dashboard
  rendered" passes identically against a registration that was simply deleted —
  the one outcome the ruling refuses. `objectui#9264`'s shrink-only bare-name
  collision ledger loses its row: it is now empty.
- d2f723f: `objectui generate page` scaffolds its child list as `children` (objectui#9847).
  
  ## What changed
  
  `objectui generate page NAME` writes a `pages/NAME.json` into a project directory the
  user then owns and re-authors. Its child list was spelled `body` — the dialect
  objectui#6771 retires.
  
  The asymmetry that makes the spelling matter is in the authoring tier: `BASE_PROPS` in
  `@object-ui/sdui-parser` accepts `children` and does **not** list `body`. `BaseSchema`
  and its zod mirror in `@object-ui/types` declare *both* keys today, and `validateSchema`
  in `@object-ui/core` reads `children` first and falls back to `body`; retiring that
  fallback is objectui#6771's own later step and no part of this release.
  
  The scaffolded page now spells it `children`. Nothing else about the file moves.
  
  ⚠️ This changes what the tool *emits*, not what ObjectUI accepts. `body` remains
  readable everywhere it was readable before, and a page scaffolded by an earlier version
  needs no edit. Retiring the `body` arm is a separate, already-ruled step and is not part
  of this release.
  
  ## Why it was missed
  
  objectui#7181 moved the `body` dialect off the platform's producers, working from a
  table of six files. `generatePage` is a seventh producer of exactly the same shape —
  code that emits `body`-spelled metadata into a file a user then owns — and that table
  never named it, so a migration round aimed at its own family passed it over.
  
  The ordering constraint it sits under is the family's own: once the authoring tier
  teaches `children` only, a scaffolder still emitting `body` hands a new user a project
  that their very next `objectui validate` rejects.
  
  ## What now re-derives this instead of remembering it
  
  - A new pin runs `objectui generate` into a throwaway directory and reads the bytes back
    out, rather than reading this repo's source text — a source-text assertion over a file
    that documents the construct it asserts on passes off the comment, measured elsewhere
    in this family. Its type population is discovered from the line `generate` prints for
    an unknown type, so a type added later is covered without anyone extending the pin.
  - `pnpm census:body-dialect` remains the instrument that reports where the dialect still
    lives. The census pins keep their named-producer list — it is the drift guard — and now
    assert over the instrument's *population* beside it, so a producer arriving in a file
    nobody listed fails the suite without anyone remembering to extend that list.
  
  ⛔ This does not clear objectui#6771's step 4. The census's own stated limits keep two
  producer-shaped sites out of its reach, and both are still live; the census pins name
  them, and objectui#9847's delivery reports them.
- 94021dd: `objectui check` judges a file's `type` only when the file is recognisable as an ObjectUI schema, and reports how many it declined to judge.
  
  A root `type` was treated as a component key wherever it appeared. `type` heads at
  least seven unrelated JSON vocabularies, and the most common of them is
  `package.json`'s `"type": "module"` — so the first line a user saw running
  `objectui check` in their own project was a warning about their own package
  manifest. Measured at this repository's root: 46 warnings, 45 of them
  `package.json` (objectui#5127).
  
  A file now enters type judgement only when its root carries a structural key
  declared on `BaseSchema` — `children`, `body`, `className`, `placeholder`,
  `style`, the `visible`/`hidden`/`disabled` predicate family, `testId`,
  `ariaLabel`. Every other root-`type` vocabulary — JSON Schema's `"array"`, an
  `.eslintrc.json`'s `"commonjs"`, a package manifest's `"module"` — is simply
  never judged. The key set is read out of the node contract rather than invented,
  and it is closed: it grows only when `BaseSchema` grows.
  
  A list of filenames to exclude was the alternative and was rejected: it is a
  second hand-maintained list of the shape objectui#5115 had just finished
  deleting, and it can only ever enumerate the foreign vocabularies someone already
  thought of. This is a positive marker instead.
  
  Because the marker narrows what is checked, the command now also reports the
  count of files that had a root `type` and no marker, together with the marker
  keys that opt one back in. That number is the coverage this gate gives up until
  schema files are recognisable, and printing it is what keeps the loss visible
  rather than silent. The `.yaml`/`.yml` half of the scan is unchanged — it was
  never type-judged, before this change or after it. Exit codes are untouched: a
  JSON parse failure remains the only thing that fails the run.
  
  No public `$schema` URL is introduced. An earlier revision also admitted a file
  whose root `$schema` had an `objectui.org` host; the maintainer ruled against
  minting that identifier (2026-08-20, objectui#5127), so the structural key is the
  only marker. Because the matching was host-based rather than literal, that arm
  can be added later without invalidating a single file.

### Patch Changes

- 64563a9: **BREAKING (node type key):** `@object-ui/plugin-map` no longer registers the bare
  `map` node type key, and its namespaced twin `view:map` goes with it. A node
  authored `"type": "map"` no longer resolves a renderer. Write
  `"type": "object-map"` — the one spelling the plugin serves (objectui#10393,
  executing the objectui#8008 family ruling of 2026-09-09 that retired the bare
  `gantt` and `kanban` keys).
  
  **Why.** The registry mounted a `map` node while the published declaration refused
  it: `ObjectMapSchema.type` is the literal `'object-map'` and `AnyComponentSchema`
  has no `map` arm, so `safeValidateSchema` answered a `map` node with
  `invalid_union` while the html tier accepted it. Two faces, opposite verdicts.
  No schema face ever declared `map` as a component node type, so there is no arm
  to turn into a named refusal: unregistering is the whole retirement, exactly as
  it was for `gantt`. After it, the html tier (`validateTree` over the live
  registry) reports a `map` node as `unknown-component`, matching the Zod face.
  
  **⛔ No stored document moves.** The string `map` names two different things at
  two different layers, and only one of them is retiring:
  
  | layer | value | who writes it | retired? |
  | --- | --- | --- | --- |
  | stored `NamedListView.type` / `defaultViewType` | `"map"` | `CreateViewDialog`, persisted per tenant | **no — untouched** |
  | node type key | `map`, `view:map` | hand-authored JSON | **yes** |
  
  `ObjectView` and `ListView` map a stored `map` view onto the node type they
  render, and both already emit `object-map`, so every map view created through
  the console keeps rendering. Nothing in a tenant database changes, and ⛔ nothing
  should be migrated there.
  
  **What moved with it.**
  
  - `@object-ui/console` drops its lazy `map` / `view:map` registration stub; the
    lazy `object-map` stub is unchanged.
  - `@object-ui/core`: `recordSourceDataArmForType` no longer lists the `map` and
    `view:map` rows, since no block is registered under either key.
  - `@object-ui/cli`: the generated known-type list that `objectui check` reads no
    longer contains bare `map`, so the check now reports `map` as an unknown
    schema type in a file it recognises. ⚠️ `view:map` stays on
    that list, because the opt-in protocol placeholder (`registerPlaceholders()`
    in `@object-ui/components`) registers it — in the console a `view:map` node
    renders that placeholder panel, not a map, and `objectui check` does not report
    it as an unknown schema type in a file it recognises. A bare
    `{ "type": "view:map" }` with no structural key is listed in `check`'s advisory
    did-not-validate list instead, because `view:map` is on the known-type list and
    `AnyComponentSchema` has no arm for it; that line does not say the node renders
    a placeholder. Search documents for `view:map` directly.
  
  ⚠️ **Dated note, 2026-09-25 — `objectui check` flags `map` only in a file it
  recognises — objectui#10606.** This entry first said, unscoped, that the check now
  flags bare `map`. `check` checks the `type` of each file it recognises, and a file
  whose root carries an ObjectUI structural key (`children`, `className`, `body`, …)
  is recognised by that key alone. A file with none of those keys is parsed against
  the schema and recognised only if it validates; one that does not validate is
  listed by name when its root `type` is on that known-type list, and is otherwise
  counted as skipped. `map` is no longer on it, so `{ "type": "map" }` is
  counted as skipped ("no ObjectUI recogniser admitted") and gets no unknown-type
  line, while `{ "type": "map", "className": "h-64" }` gets one. `check` exits
  non-zero on unreadable JSON only; the verdict is `objectui validate`'s: it refuses
  `{ "type": "map" }` at `type` (`invalid_union`) and exits non-zero.
  
  The `@object-ui/plugin-map` README now describes one registered type, and its
  sentence claiming a bare array under `data` reaches the in-memory adapter is
  corrected: a bare array under `data` is not a record source on the map
  (objectui#8348), so inline rows belong under `staticData`. The same false claim
  is corrected on the two docs pages that carried it, `plugins/plugin-map.mdx`
  and `fields/location.mdx`.
  
  **One pending entry in this same release is superseded in part.** The
  objectui#10392 / #10394 entry (`10392-registration-record-source-inputs.md`)
  says `object-map`, `map` and `object-gantt` gained `data` / `staticData`
  inputs. It now reads as of its own change and carries a dated note naming this
  card: `map` declares nothing after this retirement, while `object-map` and
  `object-gantt` keep both inputs.
- c2d8659: `objectui check`'s help line and six `@object-ui/types` comments no longer present `check` as a
  validator (objectui#10524).
  
  - `@object-ui/cli`: `objectui --help` and `objectui check --help` described `check` as
    "Validate schema files". It now reads "Advisory JSON file sweep; run objectui validate for a
    verdict". `check` itself is unchanged. It sweeps the project's JSON files and recognises a
    file whose root carries a structural key (`children`, `className`, `body`, …) by that key
    alone, without parsing it against the schema. It parses against the schema only a file with
    none of those keys, and lists it by name when its root `type` names a registered component but
    the document does not validate. That list is advisory: `check` exits non-zero on unreadable
    JSON only. The verdict is `objectui validate`'s: it parses one document against the published
    schema, prints the schema's own errors and exits non-zero.
  - `@object-ui/types`: the `ChatbotSchema.body` docblock said the retired key's refusal comes from
    "a root parse (`objectui validate` / `objectui check`, …)". `body` is itself one of the
    structural keys, so `check` never parses a `chatbot` document that authors it against the
    schema. The docblock now names `objectui validate` alone and says why `check` does not deliver
    the refusal. The two
    `SemanticElementSchema` docblocks (the interface and its zod mirror) said a document was
    refused by `objectui check`; they now name `objectui validate`, whose refusal it was. The
    `ObjectGanttSchema.gantt` comments (the interface and its zod mirror) and the
    `ObjectCalendarSchema` `sort` comment in the zod mirror said the refusal reaches the CLI's
    `validate` / `check`; they now name `validate` alone.
  
  A help string and comments only: no command's behaviour, export, type or schema moves.
- 24d3e65: New SDUI widget `cloud:plan-status`: a "Current plan" badge for one plan card on the Cloud pricing page, shown when that card's plan is the organization's plan (objectui#10919).
  
  **Clause-②: yes** — the accept set of `AnyComponentSchema`, and so of `safeValidateSchema` and `objectui validate`, widens by one `type` literal, `cloud:plan-status`, and `@object-ui/types/zod` exports one new schema, `CloudPlanStatusSchema`. Nothing that parsed before is refused now.
  
  **Why.** The pricing page is static metadata, and nothing in a page's expression scope carries the organization's plan, so the page could not tell which of its cards the organization is already on. The plan is available only from the org-scoped `GET /cloud/environment-entitlements` summary.
  
  **What changed, in observable terms.**
  
  - `@object-ui/app-shell` registers `cloud:plan-status`. A page places one node on each plan card and names that card's plan code in `properties.plan`: `{ "type": "cloud:plan-status", "properties": { "plan": "free" } }`. The widget reads the summary through the hook the environment list already uses, and renders the badge when the summary's `plan` equals `properties.plan`. The comparison is exact, so `Free` does not match `free`.
  - The widget renders nothing on every other card, while the summary loads, when the request fails, and when the body is not the `{ success, data }` envelope. It never guesses a plan.
  - The node's `className` and `responsiveStyles` reach the badge. Each node reads the summary itself, so a page with three cards makes three requests.
  - The widget is registered under one key, `cloud:plan-status`. There is no bare `plan-status` fallback and no `app-shell:`-prefixed twin.
  - `@object-ui/types/zod` exports `CloudPlanStatusSchema`, a member of `AnyComponentSchema`. `properties` is required and must be exactly `{ plan }`, with `plan` a non-empty string. A missing bag, a missing or empty `plan`, and any other key in the bag are each refused at that path.
  - `body` and `children` are refused by name on this node, because the widget reads neither.
  - `plan` is not an enum: the plan catalog belongs to the control plane, and ObjectUI does not list its codes.
  - `@object-ui/i18n` adds `cloudPlanStatus.current` ("Current plan") to all ten locale packs.
  - `@object-ui/cli`: `objectui check` knows `cloud:plan-status` as a registered type.
- 37a19d4: `objectui check` prints the key and path a file was refused for, and no longer ends with 「✓ All checks passed」 over files it never validated (objectui#11007).
  
  `check` recognises a JSON file in one of two ways: by a structural root key (`children`,
  `className`, …), which admits the file without parsing it, or by the whole document
  validating.
  
  - **A file that did not validate now carries its reason.** Each entry in the "did not validate"
    list gets one indented line: the validator's first issue, its path spelled the way
    `objectui validate` prints it, and its message, with the issue count when there is more than
    one. A root `object-map` whose `map` block carries the typo `latitudeFieId` was listed by file
    and type only. It now reads `Issue at map: Unrecognized key: "latitudeFieId"`. The issue comes
    from the parse `check` already ran to recognise the file. Skipped files, which are foreign,
    still get no diagnosis.
  - **The closing line is a tally, not a pass.** A run with no parse errors used to end on
    「✓ All checks passed」, including over a page whose nested node carries a refused key: that
    page is admitted on `children` and never parsed. The line now counts the recognised files
    that validated, those recognised by a structural key and not validated, and those that did
    not validate, and points to `objectui validate <file>` for a verdict.
  
  `check` still does not parse a file its structural key admits. The verdict on a document stays
  `objectui validate`'s, and `check` still exits non-zero on unreadable JSON only, so no exit code
  changes. `objectui validate`'s output is unchanged: its path spelling moved into a helper both
  commands share.
- 3c3ce15: Small reader sites stop riding `BaseSchema`'s index signature (objectui#11355, part of the preparation for objectui#8347's removal of that signature). Each key was measured on its own.
  
  **Two keys are now declared, each with a spec row's type, by reference.**
  
  - `ObjectKanbanSchema.swimlaneField`. The installed `@objectstack/spec` declares it on the `object-kanban` row as an optional string, `ObjectKanban` reads it, and the registration publishes it as an input. The TypeScript member takes the row's type, and the zod mirror now refuses a non-string `swimlaneField` where `.passthrough()` used to keep it unjudged. `grouping`, the read's fallback, is still undeclared; aligning it with the spec's typed row is objectui#11216.
  - `DetailViewSchema.showHeader`. `detail-view` has no spec row. `DetailView` reads the key, and its producer is `record:details`, which writes its own spec-declared `showHeader` onto the `detail-view` node it builds. So the member takes the `record:details` row's type, and the two cannot drift apart. The zod mirror declares it too. The defaults are unchanged: a bare `detail-view` draws its heading unless `showHeader` is `false`, and `record:details` keeps its own default of off.
  
  **Two reads are typed where they stand, with no behaviour change.**
  
  - `@object-ui/cli`: `objectui validate` reads a parsed node's `title` only where the node carries one. The read used to span every arm of the parsed union. The printed output is unchanged.
  - `@object-ui/plugin-map`: the dev warning about flat map keys that a `map` block shadows reads those keys through their own type, not through a `Record` conversion.
  
  **minor, not patch, for `@object-ui/types`.** Both members are new in the shipped `.d.ts` and in the zod mirror's `.shape`, and the mirror now refuses a wrongly typed value for each, where it used to keep one unjudged.
  
  ⚠️ **Dated note, 2026-10-03 — `ObjectKanbanSchema.grouping` is now declared — objectui#11216.**
  At this change `grouping`, the fallback `ObjectKanban` reads for `swimlaneField`,
  was undeclared on both faces, as the first bullet above says. objectui#11216
  declares it on both faces in this release, by reference: the TypeScript member is
  the spec's `GroupingConfig`, and the zod mirror takes the spec's
  `GroupingConfigSchema`, the type the `object-kanban` row gives the key. So the
  sentence above that calls `grouping` "still undeclared" does not hold in this
  release. The rest of this entry is kept as the reading of this change.
- 5429e6c: `objectui generate page NAME` writes a page that draws its title (objectui#11450).
  
  The generated `pages/NAME.json` had a `title` and no `pageType`. A page with no `pageType` is a `record` page, and a record page draws neither `title` nor `description`: it leaves its `h1` to a `page:header` block. So the generated title never showed. The generator now writes `"pageType": "app"`, which draws `title` as the page's `h1`.
  
  The markdown child under it now reads `Welcome to NAME` instead of `# Welcome to NAME`. With the title drawn, a `#` heading in the markdown would draw a second `h1` beneath it. A page you generated before this release keeps its old shape; add `"pageType": "app"` to it, and drop the `# ` from its markdown, to get the same result.
- 05474af: Fix `objectui check` scanning build output because its ignore list only excluded a
  root-level `dist/` / `node_modules/` (objectui#6320).
  
  `packages/cli/src/commands/check.ts` passed `ignore: ['node_modules/**', 'dist/**',
  '.git/**']` to `globSync`. `glob` matches `ignore` patterns against the path relative to
  `cwd`, so an unanchored `dist/**` / `node_modules/**` excludes only a directory of that
  name at the scan root — every nested `packages/<name>/dist/`, `examples/<name>/dist/`,
  `apps/<name>/dist/` (and their `node_modules/`) was still scanned. In a built workspace
  this means `objectui check` re-reads the author's own schemas a second time from build
  output, roughly doubling every count it reports (measured on this repository: 617 → 1047
  files globbed after a full build) with nothing in the output explaining why.
  
  The ignore patterns are now anchored at every depth (`'**/dist/**'`, `'**/node_modules/**'`),
  matching the fix's stated intent: exclude build output and installed dependencies wherever
  they live, not only at the project root. A root-level `dist/` / `node_modules/` remains
  excluded, unchanged.
  
  Confirmed before widening: no example, template, or docs fixture in this repository
  authors a schema under a directory literally named `dist` — the widened pattern excludes
  only generated content.
- 854222c: `@object-ui/plugin-report` now registers its three components under namespace
  **`plugin-report`**, the spelling its consumers already declare (objectui#6416).
  
  It used to register `report`, `spec-report` and `report-viewer` under namespace
  `report`, while `apps/console` declared the lazy stubs for the same three short
  names under `plugin-report` and the CLI's known-type whitelist shipped the
  `plugin-report:*` spellings as renderable. Two things followed from the
  disagreement:
  
  - **`plugin-report:report`, `plugin-report:report-viewer` and
    `plugin-report:spec-report` could never be satisfied.** `Registry.register`
    clears the lazy stub for the type IT registers, and that type was
    `report:report`, so those three stubs were never cleared and no component was
    ever stored under them: `get('report', 'plugin-report')` returned `undefined`
    and `hasLazy('report', 'plugin-report')` stayed `true` forever. A schema
    authored with any of the three whitelisted keys resolved to nothing — the
    gate handed authors a green light for a key the runtime could not satisfy.
  - **The bare `report` key was claimed twice under two different namespaces.**
    `Registry.register` and `Registry.registerLazy` share the
    `meta?.namespace && !meta?.skipFallback` branch, so what bare `report`
    *declared* depended on whether the plugin chunk had loaded yet — the
    objectui#6353 shape.
  
  **No authored metadata changes.** The direction was chosen by measurement:
  nothing in this repository, and nothing in the sibling `objectstack` checkout,
  authors a `report:*` spelling (0 hits), while the bare spellings are authored in
  48 places. `type: 'report'`, `type: 'spec-report'` and `type: 'report-viewer'`
  resolve exactly as before; the three unreachable `report:*` keys are retired and
  the three `plugin-report:*` keys now name real components for the first time.
  
  `packages/cli/src/utils/known-schema-types.ts` is regenerated from the
  registrations, dropping `report:report`, `report:report-viewer` and
  `report:spec-report`.
  
  Two pins are the half that outlives the fix:
  `packages/plugin-report/src/__tests__/report-bare-key-ownership.test.ts` replays
  this package's real declared metadata and a console-shaped lazy stub into a
  fresh `Registry` in **both** registration orders, checking the bare key's
  declared namespace after every step, so order- and phase-independence are
  properties under test rather than properties of the file the test imports.
  `scripts/__tests__/report-namespace-agreement-6416.test.ts` re-derives both
  sites from source and fails if the plugin, the console stubs and the generated
  whitelist ever disagree again.
  
  ⚠️ **Dated note, 2026-10-02 — `spec-report` is retired — objectui#11440.**
  Later in this same release `@object-ui/plugin-report` stopped registering `spec-report`, and with it
  `plugin-report:spec-report`; the console dropped its lazy stub, and `known-schema-types.ts` no longer
  lists either key. So the package registers two components under `plugin-report`, not three, and
  "`type: 'spec-report'` … resolve exactly as before" and "the three `plugin-report:*` keys now name
  real components" above no longer hold for `spec-report`: a node of that type resolves to nothing.
  `report` and `report-viewer` resolve as this entry says. `.changeset/11440-retire-spec-report.md`
  states what ships. The rest of this entry is kept as the reading of this change.
- 85b4957: `objectui validate` now says when a validation issue sits at the document root.
  
  The printer guarded its Path line with `issue.path.length > 0`, so an issue at
  `path: []` printed no Path line at all — silent in exactly the case a reader
  most needs oriented. That case is the common one, not an edge: the CLI validates
  against `AnyComponentSchema`, a union over every component arm, so any document
  matching no arm reports a single top-level issue (`invalid_union` · `Invalid
  input` · root path). Authors saw a bare verdict on a whole document with nothing
  saying which node had been judged:
  
  ```
  1. Invalid input
     Code: invalid_union
  ```
  
  Every reported issue now carries a Path line; a root-level one reads
  `Path: (root)`, parenthesised so it cannot be mistaken for a real key named
  `root`. Non-root issues print their authored path exactly as before.
  
  Scope: the printer still reads only top-level issues. Whether a failing union
  should also surface its per-arm diagnoses — and if so which arm's — is an
  author-facing diagnostic contract left open for a maintainer
  ruling, and is deliberately not decided here.
- 639114c: Reconcile the declared surface with `@objectstack/spec` 17.3.0 (objectui#7122).
  
  ⚠️ **`@object-ui/types` is graded `minor` for a breaking surface change.**
  The exported `ObjectSchemaClientExtensions` narrows from
  
  ```ts
  export interface ObjectSchemaClientExtensions { editMode?: 'modal' | 'page' }
  ```
  
  to
  
  ```ts
  export type ObjectSchemaClientExtensions = Record<never, never>;
  ```
  
  Two breaking consequences for a consumer that names the type directly. **(1)** It
  no longer declares `editMode`; the key is now carried by the spec's
  `ServiceObject`, so `ObjectSchemaMetadata` still has it, but code written against
  the extension type ALONE loses it. **(2)** `interface` → type alias also ends
  **declaration merging**: a consumer that reopened
  `declare module '@object-ui/types' { interface ObjectSchemaClientExtensions { … } }`
  to add its own client-side member no longer compiles, because an alias cannot be
  reopened. `minor` rather than `major` per `AGENTS.md`'s version-alignment rule —
  objectui's own breaking changes are graded `minor` with the semantics stated in
  the body, since any `major` in the fixed group would push all 39 packages off
  `@objectstack`'s major.
  
  **`ObjectSchema.editMode` is now the spec's.** 17.3.0 adopted the key (measured:
  the accept set went 42 → 43, gained set exactly `['editMode']`, lost set empty,
  declared as the same `'page' | 'modal'` union objectui carried). Its local copy
  is retired from `ObjectSchemaClientExtensions`, which is what that type's own pin
  prescribed for this event, leaving the client delta empty. Nothing is removed
  from the product: `editMode` stays authorable and stays typed on
  `ObjectSchemaMetadata`, carried by the spec's `ServiceObject` instead of by a
  local member — and a published, spec-validated object document may now carry it,
  which at 17.2.0 was refused by name.
  
  **`user:profile` is retired across all three sites.** 17.3.0 dropped it from
  `PageComponentType` (measured: the enum went 34 → 32 options, lost set exactly
  `['user:profile', 'element:form']`, gained set empty). objectui went on knowing
  it in three places, so all three moved together: the Studio palette exclusion
  ledger, `PROTOCOL_COMPONENTS` in `renderers/placeholders.tsx`, and the
  regenerated `known-schema-types.ts` the CLI checks schemas against. Nothing
  user-reachable went with it — neither type had a renderer, `user:profile` had
  only the dashed "Component Placeholder" scaffold, and the app shell's own
  profile affordance is a React slot, never this block type. A page schema still
  naming it now draws the loud "Unknown component type" panel rather than a silent
  grey box, which is this repo's standing treatment for a type outside the
  supported surface.
  
  **`record:details` sections document the eight keys 17.3.0 added.**
  `group`, `hideEmpty`, `collapsible`, `showBorder`, `defaultCollapsed`, `icon`,
  `description` and `headerColor` are now declared on a section entry (4 → 12
  members). Six of the eight are already honoured by `DetailSection`, so the
  `sections` input description now teaches all of them, and says plainly which two
  are not read here. Designer controls for them are a separate feature and are
  deliberately not added.
  
  **`@object-ui/types` raises its declared `@objectstack/spec` floor `^17.0.0` →
  `^17.3.0`, and this is the second half of its `minor`.** The package's emitted
  `dist/spec-report.d.ts` names `FilterCondition` from `@objectstack/spec`, which
  `17.0.0` does not export, so the old range was a claim the artifact did not
  support — `scripts/check-spec-range-floors.mjs` reports it as `[floor-too-low]`
  and names `^17.3.0` as the lowest version carrying every symbol the package
  references. Breaking for a consumer pinned below 17.3.0: it can no longer
  resolve this package. That is the range stating the truth rather than a new
  restriction — the artifact already required those symbols — and it is the
  remedy the gate itself prescribes ("Raise that package's range to the lowest
  version that exports the symbol… Do not add a tolerant re-declaration on this
  side: the range is the claim, and the claim is what is wrong", `111741454`).
  `@object-ui/core` and `@object-ui/data-objectstack` already declare `^17.2.0`
  and `@object-ui/plugin-detail` `^17.1.0`, so a floor above the family minimum is
  this repo's normal state, not an exception.
  
  ⚠️ **Measured on both sides, because it is bump-caused rather than pre-existing
  and the card that filed the `[floor-too-low]` finding recorded the opposite.** The gate is a scheduled / push-to-main
  workflow that cannot red a pull request, and `main` is green on it — the last
  eight runs, most recently at `c2e3cee2c`. On this branch's built tree it exits 1
  with CI's own `--cross-check` invocation, and exits 0 with this raise, judging
  278 (subpath, symbol) pairs across 19 published packages either way. Its blocking
  copy runs on the publish path, so leaving it would have surfaced as a cancelled
  release rather than as a red check. The correction is recorded in `639114c4d`, the commit that landed this entry.
- fb4ec65: Route the generated app layout's icon lookup through the platform seam (objectui#7472).
  
  `objectui dev`/`init` emit a `src/Layout.tsx` into the user's application, and that
  template carried its own lucide resolver: `import * as LucideIcons from 'lucide-react'`
  feeding `lucideIcons[name]`, with **zero** normalisation. It was the last container in
  the platform still resolving icon names for itself, which objectui#5935's ruling
  forbids — and because the file is generated, the vocabulary it accepted became an
  authoring contract that held inside a generated app and nowhere else.
  
  The layout now imports `LazyIcon` and `isLucideIconName` from `@object-ui/components`
  (already one of its declared dependencies, so nothing new is installed) and asks the
  predicate first, preserving the old "render no glyph for an unresolvable name"
  behaviour rather than falling back to the seam's stray database icon. The four
  statically-referenced icons move from the namespace object to named imports, so the
  wildcard import — the pattern that used to pull ~1500 icons into a bundle — is gone
  from generated apps entirely.
  
  **Migration, measured rather than assumed.** Icon names are now normalised, so the
  accepted vocabulary changes in both directions:
  
  - Canonical `PascalCase` names (`Flame`, `House`, `ChevronsUpDown`) keep working —
    converting exactly those is what the seam's tokeniser is for. 1,882 of them.
  - `kebab-case` names now work too. Every other container in the platform already
    accepted them; a generated app silently rendered nothing. 2,039 names gained.
  - lucide's **alias** spellings no longer resolve: the `HouseIcon` suffix form (2,037),
    the `LucideHouse` prefix form (2,036), and digit-suffixed spellings such as
    `Building2` (147). These were never `icons` keys, so they resolved only inside a
    generated app. An `app.json` using one should switch to the canonical spelling —
    `House`, or `building-2`.
- adf5812: Four node type keys retire, and the kanban and gantt families converge on their
  `object-*` spellings: `kanban` (objectui#8802), `kanban-ui` and `kanban-enhanced`
  (objectui#8257), and `gantt` (objectui#8008). All four were ruled by the
  maintainer in one batch on 2026-09-09.
  
  **⛔ No stored document moves.** The strings `kanban` and `gantt` name two
  different things at two different layers, and only one of them is retiring:
  
  | layer | value | who writes it | retired? |
  | --- | --- | --- | --- |
  | stored `NamedListView.type` | `"kanban"`, `"gantt"` | `CreateViewDialog`, persisted per tenant | **no — untouched** |
  | node type key | `kanban`, `gantt` | hand-authored JSON | **yes** |
  
  `ObjectView`'s `switch (viewType)` maps a stored view type onto the node type it
  renders, and it already emitted `object-kanban` and `object-gantt` — as it does
  for all twelve stored view types. So every kanban and gantt view any user ever
  created through the console already renders through the surviving spelling.
  Nothing in a tenant database changes, and ⛔ nothing should be migrated there.
  
  **What each retirement was, measured.** Three of the four were
  registration-only: no schema face in `@object-ui/types` ever declared
  `kanban-ui`, `kanban-enhanced` or `gantt` as a component node type, so
  unregistering is the whole retirement. The bare `kanban` key was the exception —
  it had a declared arm on both faces (`KanbanSchema` in `complex.ts` and its Zod
  mirror), and a plain deletion there would have been the objectui#7664 failure:
  `BaseSchema` is `.passthrough()`, so a document naming a dropped key validates
  green and renders nothing. It therefore retires as a **named refusal**: the Zod
  union keeps an arm claiming the literal and answers a `{ "type": "kanban" }`
  document with a message naming `object-kanban` as the remedy, while the
  TypeScript half is the absence of the arm from `ComplexSchema` and of the key
  from `SchemaRegistry`, so `tsc` refuses it at the authoring site.
  
  **⭐ This closes objectui#8818's `objectFields` hole — for that ENTRY, not for
  the class.** `SchemaRenderer` strips a fixed enumerated metadata list and
  spreads the rest as React props; `objectFields` is not on that list, and
  `KanbanRenderer` — the component the `kanban-ui` key resolved to — declares
  `objectFields` as a real prop, so an authored value reached the predicate layer
  with no schema face judging it. With the registration gone, no authored node
  reaches that component through the registry. ⚠️ The **class** is still open: the
  hole returns the moment another registered renderer declares an `objectFields`
  prop. objectui#8818's option (a) — stripping at the `SchemaRenderer` boundary —
  is what would close the class.
  
  Superseded in this release by objectui#8818: option (a) landed, so the class
  is closed as well. `objectFields` is now on `SchemaRenderer`'s stripped-metadata
  list, and the legacy `props` alias bag drops it too, so an authored
  `objectFields` reaches no component prop on any type key. The paragraph above
  describes the tree this entry was written against.
  
  **⚠️ What the `kanban` arm took with it, stated because it is the cost of this
  change.** That arm was the only schema face that ever declared `columns`,
  `cardTitle`, `swimlaneField`, `grouping` and `navigation`, the only one that
  refused `allowCollapse` / `cardTemplates` / `columnWidths` / `titleField` /
  `draggable` / `onColumnAdd` / `onCardAdd` by name, and — through
  `columns: KanbanColumn[]` — the only one that judged a lane's `cards`
  (`240b80f31`).
  
  ⭐ **The sentence that stood here — «The surviving `ObjectKanbanSchema` face
  declares none of them» — is retired, and the two reasons it failed are DIFFERENT
  defects (objectui#9713).** It is replaced by a dated reading rather than silently
  overwritten, because half of it was true when written and erasing that would be a
  false record of its own:
  
  | key named just above | on `ObjectKanbanSchema` when this entry was written (`adf581278`, 2026-09-10) | on `main`, 2026-09-17 | what moved |
  | --- | --- | --- | --- |
  | `columns` | not declared | **declared** | objectui#8913 (PR objectui#8989), six hours after this entry was written |
  | `cardTitle` | not declared | **declared** | objectui#9606 (PR objectui#9709) |
  | `titleField` | **declared** | **declared** | nothing — the sentence was never true of this key |
  | `allowCollapse` | **declared**, a live `z.boolean().optional()` | **declared**, as a `retirementTombstone()` | objectui#8801 retired it; it was declared on this face throughout |
  | `swimlaneField`, `grouping`, `navigation`, `cardTemplates`, `columnWidths`, `draggable`, `onColumnAdd`, `onCardAdd`, and a lane's `cards` | not declared | not declared | nothing |
  
  ⇒ For `columns` and `cardTitle` the claim **ROTTED**: it was true on 2026-09-10 and
  was falsified afterwards by cards that had no reason to read this file. For
  `titleField` and `allowCollapse` it was **BORN FALSE**: those two are named above as
  keys the `kanban` arm refused BY NAME — which the surviving face indeed does not do
  — but the surviving face declared both of them the whole time, and «declares none of
  them» said otherwise. ⛔ Do not restate any of this in the present tense: a pending
  entry publishes verbatim into the CHANGELOG, and an undated present-tense claim
  about another file is the construction that failed here.
  
  ⛔ Nothing about an `object-kanban` document changes: it was never judged by the
  `kanban` arm, so all of those keys have always ridden `BaseSchema`'s index
  signature there. What is gone is the `kanban` document that had them. Declaring
  them on `ObjectKanbanSchema` would WIDEN a published accept set, which is a
  maintainer ruling and not part of this one; every one of these readings is
  pinned where it can be seen rather than left to be rediscovered.
  
  **Migrating.** Replace `"type": "kanban"` with `"type": "object-kanban"` and
  `"type": "gantt"` with `"type": "object-gantt"` in hand-authored documents. The
  `object-kanban` face requires `groupBy` and one of `bind` / `data` /
  `objectName`; a purely static board (lanes carrying their own cards, no record
  source) adds `"groupBy"` and `"data": []`. `kanban-ui` and `kanban-enhanced`
  have no authored documents anywhere in this repository to migrate.
  
  **⚠️ The namespaced spellings retire with the registrations — `view:kanban` and
  `view:gantt` are the same two keys.** `ComponentRegistry.register(type, C,
  { namespace })` stores BOTH `namespace:type` and a bare-`type` fallback, so
  every one of these keys had a namespaced twin that goes with it:
  
  | retired spelling | namespaced twin | author instead |
  | --- | --- | --- |
  | `kanban` | `view:kanban` | `object-kanban` |
  | `gantt` | `view:gantt` | `object-gantt` |
  | `kanban-ui` | `plugin-kanban:kanban-ui` | `object-kanban` |
  | `kanban-enhanced` | `plugin-kanban:kanban-enhanced` | `object-kanban` |
  
  Both spellings are pinned as gone, each against a firing control on the
  surviving key, in `plugin-kanban/src/__tests__/kanban-family-registry-keys-retired-8257.test.ts`
  and `plugin-gantt/src/__tests__/bare-gantt-node-key-retired-8008.test.ts`.
  
  **What an unmigrated `view:kanban` / `view:gantt` node now renders depends on
  the host.** In `apps/console` it renders the protocol **placeholder** panel, not
  the OBJUI-001 "Unknown component type" error: the console calls the opt-in
  `registerPlaceholders()` (`@object-ui/components`, `renderers/placeholders.tsx`)
  *after* its plugin registrations, `view:kanban` and `view:gantt` are both in
  that file's `PROTOCOL_COMPONENTS` list, and the placeholder only claims a key
  nothing else has taken — which, until this change, `@object-ui/plugin-kanban`
  and `@object-ui/plugin-gantt` had. In every other host, which does not call that
  bootstrap, the same node renders OBJUI-001.
  
  **⚠️ `objectui check` will NOT flag either namespaced spelling.** The CLI's
  `known-schema-types.ts` is generated from the repository's real registration
  calls, and the placeholder registration is a real one — so `view:kanban` and
  `view:gantt` are still on that list and still validate green, while the node
  renders a placeholder rather than a board. The bare `kanban` / `gantt` entries
  DID leave the generated list; only the namespaced pair survives, and only
  because of the placeholder. Grep your documents for the namespaced spellings
  directly; do not rely on `objectui check` to find them.
  
  `KanbanRenderer` is still exported from this package's entry point
  (`@object-ui/plugin-kanban`); only its registry key is gone. ⚠️ `KanbanEnhanced`
  is a different case, and the earlier draft of this note stated it wrongly: this
  package's `exports` map has exactly two entries — `.` and `./style.css` — and
  the barrel never re-exported the component, so
  `@object-ui/plugin-kanban/KanbanEnhanced` has never been a resolvable specifier
  for a consumer. At this change, with `kanban-enhanced` unregistered,
  `KanbanEnhanced.tsx` had zero non-test importers, and the file was deliberately
  left in place: deleting published-but-unreachable source is a further narrowing
  and needed its own maintainer ruling, which this change did not have.
  
  ⚠️ **Dated note, 2026-09-25 — that ruling came, and the file has since been
  deleted — objectui#8932.** Later in this same release
  `packages/plugin-kanban/src/KanbanEnhanced.tsx` was deleted, and with it the
  `dist/KanbanEnhanced.d.ts` typings this package shipped for it. The rest of this
  entry is kept as the reading of this change; the objectui#8932 entry states what
  ships.
  
  **⚠️ `@object-ui/sdui-parser`: `QUICK_ADD_HOST_TYPES` loses `kanban` with the
  registration.** The `inert-quick-add` diagnostic (objectui#8285) named the two
  tags `ObjectKanbanRenderer` answered to; one of them retires here, so the set is
  now `{ 'object-kanban' }`. ⛔ Nothing is silently dropped by that narrowing, and
  this is measured rather than argued: `checkKanbanQuickAdd` has exactly one call
  site — `validate.ts`'s per-prop walk — and that walk runs only in the branch
  where the manifest RESOLVED the tag. A tag no registration produces is answered
  one level up by `unknown-component`, an **error**, and its props are never
  walked, so on a manifest built from the live registry a `<kanban quickAdd>` node
  draws `error/unknown-component` and nothing else, against a firing control on
  `<object-kanban quickAdd>` that still draws `warning/inert-quick-add`. Keeping
  `kanban` in the set would have been reachable only through a hand-built manifest
  declaring a component of that name — which, after this retirement, is somebody
  else's component, and the message asserts things about `ObjectKanban` that would
  be false of it. This supersedes the `kanban` half of the objectui#8285 entry.
  
  **The diagnostic's remedy text moves from a tag to a component.** It used to end
  "render `<kanban-ui>` from a React host that passes `onQuickAdd`". That sentence
  is falsified by this change: `kanban-ui` is no longer a node type key, so a page
  written to the old advice draws `unknown-component`. It now names
  `KanbanRenderer` from `@object-ui/plugin-kanban` — still exported, still
  forwarding both halves by identity — which is the surviving way to get the pair.
  `content/docs/plugins/plugin-kanban.mdx` says the same thing the same way.
- 2923cea: Stop `objectui check` reporting five real page types as unknown.
  
  `ui:page`, `ui:app`, `ui:utility`, `ui:home` and `ui:record` are registry keys the platform stores and the renderer paints, and `objectui check` called every document that spelled one of them an unknown schema type. The list the check judges against is generated from this repository's registration calls, and the generator could not see a `namespace` that arrives through a reference: the page kinds declare their options once and register from that object — one call passing it whole, four spreading it to vary a label — so there is no `namespace:` inside any of those call spans. The derivation read the bare half of each registration, produced no finding, and shipped a list short by exactly the namespaced half.
  
  The derivation now reads an options object passed by identifier or by top-level spread. It does so from an allowlist of ARGUMENT shapes: an object literal whose top-level entries are all key-value pairs or plain-identifier spreads, or an identifier resolving to one such literal. Every other options ARGUMENT — a cast, a member expression, a call, a spread of any of those, a conditional spread, a computed `namespace` or `skipFallback` — is now reported instead of read as namespace-free, and so is an identifier the derivation declines to follow: one it counts as bound more than once or with `let`, an imported name, or one whose `namespace` or `skipFallback` the file assigns, deletes or `Object.assign`-es in a spelling the guard matches. A validator that refuses what the platform renders is the expensive direction — it teaches authors to stop reading the validator, which costs the opposite direction (a type the check blesses and the runtime rejects) its only reader.
  
  Within a literal the derivation reads, entries are applied in source order and an entry that sets `namespace` or `skipFallback` replaces what an earlier one set — including a base spread twice around an intervening entry, and including an explicit `skipFallback: false` arriving by spread after an explicit `true`. Both of those were read wrongly, in silence, by the first draft of this change.
  
  Refusing a name whose options this file is SEEN to write is the sharper half of that, because its failure direction is a phantom rather than a miss. A `let` may hold a different object by the time the call runs, and a `const` cannot be rebound but its `namespace` can be deleted after declaration — either way the derivation would publish a key the runtime never stores, and the check would bless a spelling that renders nothing. A miss refuses something that renders; a phantom green-lights a spelling that renders nothing.
  
  ⚠️ What the instrument does NOT see is stated rather than implied, because a comment claiming more than the code does is the defect this card was filed about. Two rules bound it, and both are narrower than "the object is not rebound or written":
  
  - A name counts as a binding only where it IMMEDIATELY follows `const` / `let` / `var`, or sits in an import clause. A function parameter, a destructuring pattern, a later declarator of the same statement and a `catch` binding are invisible to the count, so a module-level object answers while the call passes a different one.
  - A write counts only in three spellings: an assignment or a `delete` whose target is the name spelled exactly followed by `namespace` / `skipFallback` written out, dotted or in a quoted bracket; or an `Object.assign` whose first argument is that name. A write through an alias, inside a callee, with a computed key, as a destructuring-assignment target, or through `Reflect.set` / `Reflect.deleteProperty` / `Object.defineProperty` / `Object.setPrototypeOf` is invisible.
  
  Closing either needs scope and aliasing analysis this regex-level derivation does not do, and a regex approximation of those semantics has no finishing line — so the end state chosen for this card is an accurate declaration instead. Every shape above is pinned as a KNOWN GAP reading that asserts today's silent answer, so closing one later fails a test instead of passing unnoticed.
  
  ⛔ Nothing in this repository is KNOWN to hit one of them, and that is a weaker statement than "none is hit" — the whole point of a silent reading is that a clean run does not rule it out. What is re-derived every run is the size of the population a gap could reach: `counters.metaViaReference`, the number of call sites whose options arrive by reference at all. Today that is five sites in one file, all reading the same declaration, the derivation reports zero findings, and the generated list moved by exactly the five namespaced halves and nothing else.
  
  The registration calls themselves are unchanged; so is every key that was already derived. Five keys are added to the generated list and none is removed or renamed.
  
  ⚠️ Read against a census, not a guess: every `ComponentRegistry.register` / `registerLazy` call in the tree was classified by how its options argument arrives, because "are these five all of them?" was explicitly unmeasured when this was filed. ⚠️ That census is about CALL SITES and their arguments; it says nothing about the 132 keys whose namespace comes from a hand-kept indirect table rather than from a call, which is a different population with its own failure mode. The five page kinds were the only registrations losing a namespace this way; the one other site reaching its options by reference registers a third-party plugin's own key and is already declared unresolvable-by-design. `deriveRegistryKeys`' `metaViaReference` counter re-derives that population on every run — the number is not written down anywhere, here included.
- 100547e: `objectui validate` now refuses a form field whose widget id names a namespace
  other than `field:`, matching the verdict `@object-ui/core`'s `validateSchema`
  has given since objectui#5375 (objectui#5449).
  
  The CLI reaches `FormFieldSchema` through `safeValidateSchema`, and that schema
  declared `type` and `widget` as bare optional strings — so a field typed
  `ui:password` validated clean while the runtime validator rejected the same
  document with `UNRESOLVABLE_FIELD_WIDGET_NAMESPACE`. The CLI is the surface an
  author actually runs before shipping, so it was the one handing out the false
  green: an author did exactly the diligence objectui#5375 asks for and still
  shipped metadata that renders a secret into a plain text box.
  
  A `superRefine` on `FormFieldSchema` now states the rule, mirroring core's
  precedence (`widget` before `type`), the key it blames, its error code and its
  message verbatim, so the two entry points cannot describe one defect two ways.
  
  **This rejects documents that previously validated.** Only colon-qualified
  field widget ids outside the `field:` namespace are affected — `field:`-prefixed
  ids and bare names such as `password` still pass, registered or not. A field
  carrying, say, `type: 'ui:password'` must be rewritten as `password` or
  `field:password`; it never rendered as a password box in any case.
  
  Which of the repo's authoring-time validators is canonical remains open
  (objectui#4631) — this states the rule on the zod side rather than unifying
  them.
- fb336df: Move `lucide-react` from `^1.31.0` to `^1.43.0` in every package that declares it, and
  repair what the jump breaks, so icons resolved from a STRING keep drawing a glyph.
  
  Measured once against the installed 1.43.0 artifact when this change was made; nothing in
  the repository re-derives these readings. Across the jump lucide removes no runtime export,
  no public type name and no `lucide-react/dynamic.mjs` name, and every name this repository
  imports from `lucide-react` resolves. Exactly one key leaves the runtime `icons` record:
  `Trash2`, retired in favour of `trash`.
  
  What a user sees change:
  
  - Icons the lazy icon seam draws (`resolveIcon`, objectui#9251) get their path data again.
    lucide 1.43.0 icon modules export their path data inside `__iconData` and no longer
    export `__iconNode`; the seam now reads both. Reading only `__iconNode` against 1.43.0
    leaves every such glyph an empty box, with nothing thrown or logged.
  - `DetailView`'s delete action and three schema-catalog examples spell their icon
    `trash`, not `trash-2`, so they keep resolving. The glyph is unchanged: 1.43.0's `trash`
    path data is byte-identical to the `trash-2` path data of 1.31.0 and 1.35.0. Anything
    that already authored `trash` now draws that same artwork, because lucide moved it under
    the `trash` name; a few other glyphs were also redrawn upstream.
  - Icons imported as COMPONENTS carry lucide 1.43.0's own classes: one class per declared
    alias (a spinner renders `class="lucide lucide-loader-circle lucide-loader-2 ..."`), and
    no longer the class lucide used to derive from the PascalCase key where that differs
    (`ArrowDown01` no longer carries `lucide-arrow-down01`). The canonical
    `lucide-<icon name>` class is still there, so a `.lucide-loader-circle` selector still
    matches.
  - Icons resolved from a STRING through the seam keep the classes they had: `lucide`, the
    canonical `lucide-<icon name>` class and the key-derived class. They do not carry
    lucide's per-alias classes. That is a maintainer ruling (objectui#8941, option C): the
    alias list lives only inside each lazily loaded icon module, and it was not moved into
    the eager name list. A selector that targets an alias class matches a component-imported
    icon and not a string-resolved one. This also dates the example in the objectui#9251
    entry: `trash-2` no longer resolves as a string, so no seam-drawn glyph carries
    `lucide-trash2 lucide-trash-2`; a digit-bearing name that still resolves, such as
    `arrow-down-0-1`, carries `lucide-arrow-down01 lucide-arrow-down-0-1`.
- d91aed9: Name the case-only spelling when a component type misses the registry.
  
  Registry lookup is exactly case-sensitive, so a node typed `Page` misses a registered `page` and falls through to the OBJUI-001 "Unknown component type" panel. Because the mistake is usually uniform across a document, the symptom is not one broken widget — it is the whole page rendering as error panels, with nothing in the message pointing at the cause.
  
  Both surfaces that report the miss now name the spelling that would have resolved. `SchemaRenderer`'s panel reads `Unknown component type: Page — did you mean 'page'?`, and `objectui check` reports `Unknown schema type "Page" in <file> — did you mean "page"?`. When no known type differs by case alone, neither says anything extra — `zzz` gains no bogus suggestion, and this is case matching, not an edit distance, so `pge` suggests nothing either.
  
  **Lookup itself does not change.** `Page` still misses, still fails, and still renders the panel; only the message teaches. Normalising the lookup was considered and rejected (objectui#5247, maintainer ruling 2026-08-19): it would make two spellings valid everywhere, permanently, and legalise the typo class (`PAGE`, `pAge`) along with the PascalCase convention.
  
  Each surface reads its candidates from the set it can actually trust — the renderer from the live `ComponentRegistry` (including pending lazy stubs), the CLI from the registration-derived `KNOWN_SCHEMA_TYPES` snapshot — so neither can suggest a type nothing registers.
- Updated dependencies [7b10bef]
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [0aacecc]
- Updated dependencies [777fca2]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [162621b]
- Updated dependencies [4c6f549]
- Updated dependencies [2dd4d3f]
- Updated dependencies [4ab4f1b]
- Updated dependencies [e3ea4f9]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [cff4b77]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [2b5f509]
- Updated dependencies [808f339]
- Updated dependencies [6cf5999]
- Updated dependencies [274e14a]
- Updated dependencies [8c10f4f]
- Updated dependencies [90dac98]
- Updated dependencies [6096f20]
- Updated dependencies [ea02938]
- Updated dependencies [a14fb23]
- Updated dependencies [ae98f1d]
- Updated dependencies [f98eddf]
- Updated dependencies [ce6bd99]
- Updated dependencies [a5b08c9]
- Updated dependencies [cdefa2a]
- Updated dependencies [0961d5e]
- Updated dependencies [6276478]
- Updated dependencies [9b28151]
- Updated dependencies [1a5003f]
- Updated dependencies [09ab32b]
- Updated dependencies [93a689d]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [3d614ea]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [9fbbb17]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [02e6d36]
- Updated dependencies [4758b33]
- Updated dependencies [9c78ebe]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [7afc81d]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [26ca2ad]
- Updated dependencies [41ae65b]
- Updated dependencies [baac95a]
- Updated dependencies [13220af]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [b956e69]
- Updated dependencies [256b4c9]
- Updated dependencies [c5ec15c]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
- Updated dependencies [4aebea0]
- Updated dependencies [f976774]
- Updated dependencies [25cb364]
- Updated dependencies [a60539b]
- Updated dependencies [de1b879]
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [ad1785c]
- Updated dependencies [3b469c8]
- Updated dependencies [1c84036]
- Updated dependencies [1c84036]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [f6ae5e2]
- Updated dependencies [7343376]
- Updated dependencies [b2683a2]
- Updated dependencies [dded788]
- Updated dependencies [b45d463]
- Updated dependencies [54a7830]
- Updated dependencies [f3135a4]
- Updated dependencies [b5696d3]
- Updated dependencies [3f9d926]
- Updated dependencies [e978ed5]
- Updated dependencies [6a7f24e]
- Updated dependencies [b3c96d6]
- Updated dependencies [8d0ca91]
- Updated dependencies [c30c8dd]
- Updated dependencies [deca847]
- Updated dependencies [328abeb]
- Updated dependencies [dd0d78f]
- Updated dependencies [24d3e65]
- Updated dependencies [95a7c8d]
- Updated dependencies [cc4e476]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [4b742f4]
- Updated dependencies [42687ba]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [0eb9f36]
- Updated dependencies [ae582b7]
- Updated dependencies [a4b017e]
- Updated dependencies [559a2e2]
- Updated dependencies [db11afd]
- Updated dependencies [154075a]
- Updated dependencies [582edef]
- Updated dependencies [19f484f]
- Updated dependencies [0a78a20]
- Updated dependencies [615346d]
- Updated dependencies [75dcc81]
- Updated dependencies [55a12a8]
- Updated dependencies [edfcf5a]
- Updated dependencies [0a3e540]
- Updated dependencies [c021b35]
- Updated dependencies [f61dab1]
- Updated dependencies [b0a05dd]
- Updated dependencies [dd5ff19]
- Updated dependencies [81f8498]
- Updated dependencies [0645133]
- Updated dependencies [0ecaa7d]
- Updated dependencies [b24f93a]
- Updated dependencies [c27b575]
- Updated dependencies [84b275c]
- Updated dependencies [0e6e76b]
- Updated dependencies [0ffc423]
- Updated dependencies [3cc4fe5]
- Updated dependencies [cd5b19a]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
- Updated dependencies [20d23be]
- Updated dependencies [20d23be]
- Updated dependencies [2e3da72]
- Updated dependencies [1263e40]
- Updated dependencies [e6bc087]
- Updated dependencies [8bab157]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [18d1a0a]
- Updated dependencies [7fed09d]
- Updated dependencies [58da8ae]
- Updated dependencies [a8b9889]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [2124d04]
- Updated dependencies [be52115]
- Updated dependencies [770cc5b]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
- Updated dependencies [c476be0]
- Updated dependencies [c82ff39]
- Updated dependencies [6c3da53]
- Updated dependencies [31987bd]
- Updated dependencies [3c3ce15]
- Updated dependencies [e100589]
- Updated dependencies [304f611]
- Updated dependencies [e46ee77]
- Updated dependencies [6e9c8d2]
- Updated dependencies [9547063]
- Updated dependencies [3f6efd6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [5988b6b]
- Updated dependencies [6158e4c]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [4a1adb7]
- Updated dependencies [50c73fe]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [2b188fa]
- Updated dependencies [b654d4e]
- Updated dependencies [f68e0a0]
- Updated dependencies [aea682a]
- Updated dependencies [fcdc8ec]
- Updated dependencies [2d576e4]
- Updated dependencies [8366acc]
- Updated dependencies [95e58a3]
- Updated dependencies [9d7419b]
- Updated dependencies [fc7db05]
- Updated dependencies [9ed8d0f]
- Updated dependencies [c73cdb5]
- Updated dependencies [6f5719e]
- Updated dependencies [06a8af5]
- Updated dependencies [6a91586]
- Updated dependencies [a04d7c6]
- Updated dependencies [5ccc500]
- Updated dependencies [f3c2bb0]
- Updated dependencies [978507b]
- Updated dependencies [778138e]
- Updated dependencies [460575f]
- Updated dependencies [d796c8d]
- Updated dependencies [1b1d772]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [636b236]
- Updated dependencies [4172589]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [39f4309]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [7cd3987]
- Updated dependencies [ee3b878]
- Updated dependencies [e304a4e]
- Updated dependencies [fda49e5]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [f8cdbf2]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [e176053]
- Updated dependencies [e30ed15]
- Updated dependencies [90665e0]
- Updated dependencies [194fae1]
- Updated dependencies [7e19d03]
- Updated dependencies [1e946c9]
- Updated dependencies [546ddf7]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
- Updated dependencies [40c479a]
- Updated dependencies [971d387]
- Updated dependencies [ee851c3]
- Updated dependencies [6414dfd]
- Updated dependencies [a8d5c71]
- Updated dependencies [905b21f]
- Updated dependencies [88e9109]
- Updated dependencies [2c45966]
- Updated dependencies [db3a600]
- Updated dependencies [3a3db76]
- Updated dependencies [0d723a3]
- Updated dependencies [0c95d3d]
- Updated dependencies [3e4fa2c]
- Updated dependencies [b5b928a]
- Updated dependencies [6fd2cf7]
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [129bcc5]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [8ec11e1]
- Updated dependencies [6f81384]
- Updated dependencies [22ba927]
- Updated dependencies [f8c70f4]
- Updated dependencies [8f1d995]
- Updated dependencies [f9c34df]
- Updated dependencies [dddb942]
- Updated dependencies [29754cf]
- Updated dependencies [d7de534]
- Updated dependencies [6e88630]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [f24de8b]
- Updated dependencies [c8ea8af]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [30c73cd]
- Updated dependencies [830ed58]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [c71e14d]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [748494b]
- Updated dependencies [5967be0]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [12402a9]
- Updated dependencies [aff3d7a]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [2c1c967]
- Updated dependencies [9486ac6]
- Updated dependencies [9486ac6]
- Updated dependencies [d6ceb8d]
- Updated dependencies [dc4365c]
- Updated dependencies [e321d52]
- Updated dependencies [4c68077]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [06b8c42]
- Updated dependencies [46b9bc9]
- Updated dependencies [b97790a]
- Updated dependencies [7c9b044]
- Updated dependencies [d47de51]
- Updated dependencies [3fe6463]
- Updated dependencies [31ab372]
- Updated dependencies [846889b]
- Updated dependencies [2acd8e1]
- Updated dependencies [26896c6]
- Updated dependencies [67fc3b0]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
- Updated dependencies [c18d099]
- Updated dependencies [adb2a86]
- Updated dependencies [03380aa]
- Updated dependencies [4562ea5]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [b0d308d]
- Updated dependencies [40f34b4]
- Updated dependencies [8063bcb]
- Updated dependencies [b74a859]
- Updated dependencies [d4493fd]
- Updated dependencies [240b80f]
- Updated dependencies [77cb489]
- Updated dependencies [bfaa158]
- Updated dependencies [777e5c6]
- Updated dependencies [0c386dd]
- Updated dependencies [9e37d9b]
- Updated dependencies [5ad86dd]
- Updated dependencies [16a725f]
- Updated dependencies [4dfdcc3]
- Updated dependencies [6a449fc]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [00d3f09]
- Updated dependencies [4388f71]
- Updated dependencies [0b1ac58]
- Updated dependencies [c93b4d5]
- Updated dependencies [c1fe272]
- Updated dependencies [3cab570]
- Updated dependencies [8ad218d]
- Updated dependencies [3e41187]
- Updated dependencies [5f78953]
- Updated dependencies [639114c]
- Updated dependencies [1f31d3a]
- Updated dependencies [d1842ab]
- Updated dependencies [78ca238]
- Updated dependencies [351eb31]
- Updated dependencies [20c04b2]
- Updated dependencies [4b5bb95]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [adbda1b]
- Updated dependencies [e2b3826]
- Updated dependencies [2e32ed4]
- Updated dependencies [3ed3eec]
- Updated dependencies [7c3df8f]
- Updated dependencies [b9f5ff1]
- Updated dependencies [4704aa4]
- Updated dependencies [1bee5d0]
- Updated dependencies [858cd72]
- Updated dependencies [cfc9b6d]
- Updated dependencies [554f2b6]
- Updated dependencies [72f55c9]
- Updated dependencies [26e06d7]
- Updated dependencies [669d71b]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [71a4a53]
- Updated dependencies [7bf244b]
- Updated dependencies [f0bb9fa]
- Updated dependencies [81a2eb1]
- Updated dependencies [caa0cd3]
- Updated dependencies [caa0cd3]
- Updated dependencies [25c7d58]
- Updated dependencies [c6198c2]
- Updated dependencies [1237ae4]
- Updated dependencies [2f61238]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [9ae871d]
- Updated dependencies [efbd566]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [daf9d57]
- Updated dependencies [c15d7ec]
- Updated dependencies [5d0876c]
- Updated dependencies [f7ace0a]
- Updated dependencies [b041b9c]
- Updated dependencies [544ecba]
- Updated dependencies [2ce2612]
- Updated dependencies [bc640ec]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [2af1fa7]
- Updated dependencies [c14d3a0]
- Updated dependencies [a137d0c]
- Updated dependencies [caf477f]
- Updated dependencies [f6375da]
- Updated dependencies [967e5d8]
- Updated dependencies [a4611b3]
- Updated dependencies [20316ba]
- Updated dependencies [d3499b3]
- Updated dependencies [309c75e]
- Updated dependencies [c9f9bae]
- Updated dependencies [18897a4]
- Updated dependencies [8b7ea39]
- Updated dependencies [dcbf0b2]
- Updated dependencies [1422a92]
- Updated dependencies [d05fe17]
- Updated dependencies [a480f79]
- Updated dependencies [f08d1a8]
- Updated dependencies [64a252d]
- Updated dependencies [786bc91]
- Updated dependencies [75fca96]
- Updated dependencies [7ca6ddd]
- Updated dependencies [f1cd290]
- Updated dependencies [5a41ce7]
- Updated dependencies [8d50bc2]
- Updated dependencies [604476d]
- Updated dependencies [d1bebb0]
- Updated dependencies [95bf128]
- Updated dependencies [335abea]
- Updated dependencies [edea22a]
- Updated dependencies [0f5cadf]
- Updated dependencies [4f9f1ee]
- Updated dependencies [66e8b2a]
- Updated dependencies [aa083cd]
- Updated dependencies [12b5992]
- Updated dependencies [b93e245]
- Updated dependencies [c842594]
- Updated dependencies [290de37]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [cf1d29e]
- Updated dependencies [af9e957]
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [7fb22a1]
- Updated dependencies [ad66d79]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [0ea7054]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [4eaa835]
- Updated dependencies [b1777ae]
- Updated dependencies [24845c4]
- Updated dependencies [6f864cf]
- Updated dependencies [24d1edd]
- Updated dependencies [645087c]
- Updated dependencies [33f4a19]
- Updated dependencies [4a292d2]
- Updated dependencies [5323168]
- Updated dependencies [841dd2b]
- Updated dependencies [3014fc0]
- Updated dependencies [dacb402]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [a407bd6]
- Updated dependencies [3a43a15]
- Updated dependencies [868e825]
- Updated dependencies [421544b]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [81a51db]
- Updated dependencies [67749c7]
- Updated dependencies [507b61b]
- Updated dependencies [512c84b]
- Updated dependencies [c300267]
- Updated dependencies [d4733f2]
- Updated dependencies [1570eac]
- Updated dependencies [8b532cb]
- Updated dependencies [c42554e]
- Updated dependencies [555b4ec]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [f1190b0]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [e36acd4]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [152f0a7]
- Updated dependencies [8693b85]
- Updated dependencies [e82dad1]
- Updated dependencies [58b7b3d]
- Updated dependencies [681d3f1]
- Updated dependencies [f3bc481]
- Updated dependencies [93fc0e7]
- Updated dependencies [a4b723f]
- Updated dependencies [2b10ca0]
- Updated dependencies [7db4a81]
- Updated dependencies [526fc11]
- Updated dependencies [b9d47ec]
- Updated dependencies [6214db6]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [689953a]
- Updated dependencies [30443fb]
- Updated dependencies [8d3dbb2]
- Updated dependencies [efc1c9c]
- Updated dependencies [7533465]
- Updated dependencies [a9d97be]
- Updated dependencies [9ba7e9c]
- Updated dependencies [96919a4]
- Updated dependencies [345e24a]
- Updated dependencies [2e471dc]
- Updated dependencies [6748587]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [7cbc724]
- Updated dependencies [7098eed]
- Updated dependencies [3df7c5c]
- Updated dependencies [fb91ac9]
- Updated dependencies [fb91ac9]
- Updated dependencies [641fb55]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [0ce32d5]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [1ef89c0]
- Updated dependencies [ba0b61a]
- Updated dependencies [ac716ff]
- Updated dependencies [f0f3cd5]
- Updated dependencies [20f3e65]
- Updated dependencies [bbba098]
- Updated dependencies [87af769]
- Updated dependencies [3be720e]
- Updated dependencies [43c0d17]
- Updated dependencies [c3df43a]
- Updated dependencies [d16d0e9]
- Updated dependencies [bbe57fd]
- Updated dependencies [272a530]
- Updated dependencies [1779e8d]
- Updated dependencies [f7fcc2c]
- Updated dependencies [f0f4d6c]
- Updated dependencies [4128188]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [4a7ef0d]
- Updated dependencies [4598f6d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [3939545]
- Updated dependencies [66abbde]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [7649f43]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [a8198de]
- Updated dependencies [0c789a4]
- Updated dependencies [b234a84]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [ff0c384]
- Updated dependencies [af4fb29]
- Updated dependencies [befd40c]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [3c76801]
- Updated dependencies [2fcefb9]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [dd19463]
- Updated dependencies [100547e]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [2c8474c]
- Updated dependencies [0e05aac]
- Updated dependencies [ae61ad4]
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [e719ebd]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [fe76ece]
- Updated dependencies [8b446f5]
- Updated dependencies [7102b20]
- Updated dependencies [58770f3]
- Updated dependencies [aefe428]
- Updated dependencies [485f096]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [b655a9d]
- Updated dependencies [3e01cb5]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [c70f865]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [d7bd274]
- Updated dependencies [98c3a74]
- Updated dependencies [ebce5a3]
- Updated dependencies [fb336df]
- Updated dependencies [9d9040d]
- Updated dependencies [0fce2ef]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [9850c6e]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [ab92940]
- Updated dependencies [a691c0b]
- Updated dependencies [0b1326d]
- Updated dependencies [515f171]
- Updated dependencies [4f14ad7]
- Updated dependencies [258d264]
- Updated dependencies [cac64b3]
- Updated dependencies [8033ad1]
- Updated dependencies [fa140b8]
- Updated dependencies [71cba28]
- Updated dependencies [190fbd0]
- Updated dependencies [93127bd]
- Updated dependencies [759606e]
- Updated dependencies [72ffc34]
- Updated dependencies [51f3d8d]
- Updated dependencies [bf28341]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [6c6cee7]
- Updated dependencies [42887e0]
- Updated dependencies [83fe6e7]
- Updated dependencies [d1ab06f]
- Updated dependencies [f90b8fb]
- Updated dependencies [91783c4]
- Updated dependencies [982885d]
- Updated dependencies [dba7d84]
- Updated dependencies [ca39427]
- Updated dependencies [bd09957]
- Updated dependencies [5a07e67]
- Updated dependencies [45d8288]
- Updated dependencies [490f482]
- Updated dependencies [27308c5]
- Updated dependencies [8689166]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [9101be5]
- Updated dependencies [f53a8d0]
- Updated dependencies [968dc1e]
- Updated dependencies [57f9b07]
- Updated dependencies [3c73d99]
- Updated dependencies [d91aed9]
- Updated dependencies [c86185e]
- Updated dependencies [1170ed1]
- Updated dependencies [4d73b07]
  - @object-ui/react@17.7.0
  - @object-ui/types@17.7.0
  - @object-ui/components@17.7.0

## 17.6.0

### Patch Changes

- 195b9e4: The routed temp app's generated manifest now asks for the same `lucide-react` range this repo installs.
  
  `utils/app-generator.ts` writes the routed variant's `dependencies` with two
  quoted third-party ranges, and `lucide-react` had fossilised a minor behind the
  22 sibling manifests that declare it: the generated manifest said `^1.29.0`
  while the repo had moved to `^1.31.0`. A generated app therefore asked npm for
  an icon library older than the one every `@object-ui/*` package it installs
  alongside was built against.
  
  The drift was not silent — `app-generator.test.ts` derives its expectation from
  the in-repo range precisely so a bump on one side and not the other fails a
  test, and both of its pins were red. What went wrong is that they went red too
  late to stop anything: the dependency PR that moved the repo range merged while
  those shards were still running, so the failure surfaced on `main` and then on
  the merge ref of every unrelated open PR. The range is now caught up; the
  reporting hole and the merge-ordering hole are filed separately (objectui#4968).
  
  The remaining eleven anchored ranges were swept against the same dependabot
  batch and are all in sync, so this is the batch's only consumer-side follow-up.
  Deriving the value from the workspace instead of quoting it was considered and
  rejected: nine of the thirteen anchored ranges quote the repo root manifest,
  which is not published with this CLI, so no single derivation can serve the
  table and a bespoke one for this one name would leave the class untouched.
- 68d9e28: `objectui check`: the known-type list is now derived from the component registry instead of being a hand-written copy, which had drifted in both directions at once.
  
  The command judged a schema's `type` against a seventeen-entry array typed by
  hand into `packages/cli/src/commands/check.ts`. Nothing held that array against
  the registry, and measured on `origin/main` @ `8378e9954` it was wrong in both
  directions simultaneously:
  
  - **Two phantoms.** `crud` and `gallery` were on the list and are registered by
    nothing. `objectui check` passed `{ "type": "crud" }` in silence while
    `SchemaRenderer` painted the OBJUI-001 "Unknown component type" panel for the
    very same file — measured, both halves. `CRUDSchema` still has its interface,
    zod mirror, validator branch and builder; what it has never had is a
    registration. For `gallery`, the registered spelling is `object-gallery`.
  - **221 bare keys missing, plus every namespaced spelling.** `object-grid`,
    `object-form`, `card`, `div` and `view:grid` were all reported as
    `⚠️ Unknown schema type`. False warnings at that volume are not a cosmetic
    problem: they train authors to skip the output, which costs the phantom
    direction its only reader.
  
  The list now lives in `packages/cli/src/utils/known-schema-types.ts`, generated
  by `node scripts/regenerate-known-schema-types.mjs` from the same
  `deriveRegistryKeys` derivation that judges documentation snippets, and held to
  it by a bidirectional pin in
  `scripts/__tests__/known-schema-types-derivation-5115.test.ts` — a key the
  registry has and the list lacks fails, and so does a key the list has and the
  registry lacks. Bare and namespaced spellings are both carried, because
  `register('grid', C, { namespace: 'view' })` really does store both.
  
  A runtime lookup through `ComponentRegistry` was measured and rejected: eleven
  of the fifteen genuinely-registered entries come from plugin packages the CLI
  does not depend on, and a published CLI runs against a user project whose plugin
  set this repository cannot know either way.
  
  **Behaviour change, in both directions.** `{ "type": "crud" }` and
  `{ "type": "gallery" }` now produce the `Unknown schema type` warning they
  always should have, and a large number of real component types stop producing
  one. The warning remains advisory — it never changes the command's exit code,
  which is still driven only by files that fail to parse — so no run that passed
  before fails now.
  
  `check()` additionally takes the directory to scan as an optional argument
  (defaulting, as before, to `process.cwd()`), so the behaviour can be tested
  against a fixture tree.
- e6a8960: `objectui check` reads `.json` as JSONC, so a `tsconfig.json` no longer fails the run.
  
  `check` globbed every `**/*.{json,yaml,yml}` and handed each `.json` straight to
  `JSON.parse`. A throw there is the only thing that increments the error count, and
  a non-zero error count is the only thing that calls `process.exit(1)` — so a `//`
  comment or a trailing comma, which is how TypeScript documents `tsconfig.json`,
  was reported as a malformed file and **failed the command**. Every TypeScript
  project hit this: `objectui check` exited 1 for anyone who ran it, and at this
  repository's own root it reported 64 errors, all of them `tsconfig*.json`
  (objectui#5237).
  
  `.json` on disk means JSONC in practice — `tsconfig.json`, `.eslintrc.json`,
  `devcontainer.json` and VS Code's own settings are all written that way — so the
  file is now read with `jsonc-parser`, which permits comments and trailing commas.
  No new package enters what users install: `jsonc-parser` is already a runtime
  dependency of `@object-ui/app-shell`, it is already at the version the lockfile
  resolves, and it declares no dependencies of its own.
  
  The reader is a real JSONC parser and **not** a comment-stripping regex, because
  a `//` inside a string value — a URL, say — is not a comment, and a stripper that
  cannot tell the difference corrupts valid files instead of reading them.
  
  Genuinely malformed JSON still errors and still exits 1. That needed saying in
  code as well as in tests: `jsonc-parser`'s reader is error-tolerant and returns a
  best-effort value rather than throwing, so the command consults its reported-error
  array instead of inferring success from the absence of a throw. Error output now
  names the reason and the line and column.
  
  The unknown-schema-type warning arm is deliberately untouched: it still warns, and
  it still does not affect the exit code. Files that previously died at the parse
  step now reach it, so a JSONC file carrying an unrecognised root `type` warns
  where it used to error — the verdict and the exit-code neutrality are unchanged.
- 51e65d4: `dev`, `serve` and `build` accept the documented directory argument from anywhere, and refuse a non-project directory in plain language.
  
  `content/docs/utilities/cli.mdx` has recorded the positional argument as "Path
  to JSON/YAML schema file or `pages/` directory" and printed `objectui dev
  pages/` as the file-system-routing example. That promise had never actually been
  parsed. Detection's first step required `statSync(...).isFile()`, so a directory
  argument fell straight through it; the one spelling that worked — `objectui dev
  pages/` from inside the project — worked by coincidence of position, caught by
  the working-directory fallback rather than read as an argument. Every pathful
  spelling reached single-schema mode and handed a directory to `readFileSync`:
  
  ```
  $ objectui dev my-app/pages
  Error: Invalid schema file: EISDIR: illegal operation on a directory, read
  ```
  
  A directory argument now resolves through file-system routing in the shared
  resolution step the three commands were centralized on (objectui#4923), in
  either of the two shapes a user can mean: the directory **is** a `pages`
  directory, or it **contains** one. Both produce the same routed answer as naming
  the app config beside them — same project root, same routes, same app config —
  so `objectui dev my-app/pages`, `objectui dev my-app` and `objectui dev
  my-app/app.json` agree, from any working directory, across all three commands.
  The limb lives in the shared resolver, not in three command branches.
  
  The remaining directory-shaped miss is now diagnosed instead of leaking a
  `readFileSync` errno: a directory that is neither shape is refused by name,
  saying what would have been accepted. The refusal sits **after** the
  working-directory fallback, so nothing that resolves today stops resolving: this
  change accepts strictly more than before and rejects nothing that worked.
- bbfbc54: `objectui serve` and `objectui build` now locate the project the way `dev` does, instead of looking only in the current directory.
  
  For a project with an app config and a `pages/` directory beside it, the three
  commands answered one invocation two different ways. `dev` anchored on the
  schema argument — `dirname(<schema>)` is the project root, `pages/` beside it
  means file-system routing, the named file is the app config. `serve` and `build`
  looked for a `pages/` directory in the current working directory and nowhere
  else, so from any directory above the project they fell through to single-schema
  mode and handed the app config to the renderer as if it were a page.
  
  Measured on the reported fixture (`<root>/app.json` + `<root>/pages/index.json`,
  invoked from the directory above): `dev` reported the project and one route,
  `serve` reported `Loading schema: <root>/app.json`, and `build` did the same and
  **exited 0** — the emitted bundle embedded the app config as the page schema and
  contained no page from `pages/` at all. A wrong artifact, produced silently.
  
  The detection now lives in one helper the three commands share
  (`utils/project-source.ts`), resolving in a fixed order: a `pages/` directory
  beside the schema argument, else one under the current directory, else
  single-schema mode. `serve` and `build` also pass the resolved app config to the
  routed app generator, which they never did, so a routed project keeps its layout
  under all three commands.
  
  A lone schema file with no `pages/` beside it is unchanged — that is the
  fallback, and it is still a supported way to run.
- 82fbc09: `objectui serve` gains `--no-open`, matching the flag `objectui dev` already ships, and no
  longer prints a bare `Error: spawn xdg-open ENOENT` stack after its success banner in a
  headless environment.
  
  **`--no-open`.** `serve` hardcoded Vite's `open: true` and its only options were
  `--port`/`--host` — `dev` already had `--no-open` (`options.open !== false`), so the same
  invocation behaved inconsistently across the two commands. `serve` now threads the same
  flag the same way; the default is unchanged — with the flag omitted, `serve` still opens a
  browser exactly as it always has (objectui#4924).
  
  **The headless spawn failure.** Vite's own browser-open step already catches a failed
  `open(url)`, but reports it via `logger.error(err.stack || err.message)` with no
  `{ timestamp: true }`, so the default logger prints the bare Node `ChildProcess` stack with
  no `[vite]` prefix and no context — and because that promise chain is fire-and-forget from
  `server.listen()`, it lands *after* the "✓ Server started successfully!" banner, reading
  like a crash even though the server is fine. There's nothing in `serve.ts` to try/catch —
  the error never leaves Vite. `serve` now supplies a `customLogger` that wraps Vite's default
  logger and replaces exactly that message with a short, contextual line naming the missing
  opener binary (`(could not open the browser automatically — 'xdg-open' is not available in
  this environment; open the URL above manually)`); every other log call — including
  unrelated errors — passes through unchanged.
  
  Sibling card objectui#4923 (project-root detection on the same command) is intentionally
  untouched here; it is a separate defect with a separate PR.
- 4102bfc: Inside a pnpm workspace, `objectui dev` / `serve` / `build` now resolve every platform package
  from workspace source (objectui#3890).
  
  The temp app these commands generate installs nothing inside a workspace — it resolves by
  hoisting, and the repo root declares no `@object-ui/*` — so a Vite alias table is the only thing
  that resolves a platform package there. That table was a hand-kept list of eleven names in
  `dev`, which is not a list of what the app imports but of what it imports *transitively*:
  measured on the reported commit, the generated entry closes over 21 packages, ten were unlisted,
  and every module whose transform hit one of them answered 500 with a blank page behind it. Vite's
  dependency scan named only four of the ten, because a scan stops at the first layer it cannot
  resolve.
  
  The table is now derived from `pnpm-workspace.yaml` — every scoped workspace package that exposes
  a source barrel, targeting its `src` directory — and a test reconciles it against the manifest so
  it cannot drift again. `serve` and `build` had no workspace branch at all (no aliases, and an
  unconditional `npm install` against a manifest that is empty here); all three commands now share
  one helper. The `lucide-react` entry moved from a resolved entry file to the package root, so
  subpath imports of it stop being rewritten into a path that cannot exist.
  
  Measured with the reported repro, from the repo root: 8 of the first 400 modules a browser walk
  reaches answered 500 before, 0 of 2498 after, and the page renders its schema instead of nothing.
- Updated dependencies [88085e3]
- Updated dependencies [516663d]
- Updated dependencies [460c4d0]
- Updated dependencies [0ae27f7]
- Updated dependencies [78c0f9a]
- Updated dependencies [bbe8b86]
- Updated dependencies [279fb13]
- Updated dependencies [2e82ab2]
- Updated dependencies [40d3a33]
- Updated dependencies [8b9dc62]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [a1609a6]
- Updated dependencies [53f23bc]
- Updated dependencies [c4533dc]
- Updated dependencies [be60815]
- Updated dependencies [37f6844]
- Updated dependencies [93de4f6]
- Updated dependencies [2b50261]
- Updated dependencies [384f30d]
- Updated dependencies [ac600e5]
- Updated dependencies [97fba31]
- Updated dependencies [232f61a]
- Updated dependencies [d374caf]
- Updated dependencies [5673576]
- Updated dependencies [911ceaa]
- Updated dependencies [98eab36]
- Updated dependencies [af5e292]
- Updated dependencies [3fbbea1]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [616a2a5]
- Updated dependencies [0046d8f]
- Updated dependencies [f1d4748]
- Updated dependencies [578e025]
- Updated dependencies [598c89a]
- Updated dependencies [4a0bd17]
- Updated dependencies [b8b9af4]
- Updated dependencies [8c0d52e]
- Updated dependencies [aff10e2]
- Updated dependencies [70a774b]
- Updated dependencies [7458a41]
- Updated dependencies [d971e51]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [75444e3]
- Updated dependencies [58b8346]
- Updated dependencies [2d0bd16]
- Updated dependencies [dad51e5]
- Updated dependencies [1c9c342]
- Updated dependencies [787c738]
- Updated dependencies [8396656]
- Updated dependencies [dbbd38a]
- Updated dependencies [93fe362]
- Updated dependencies [dfc6975]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [144ef9b]
- Updated dependencies [138ab04]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
  - @object-ui/types@17.6.0
  - @object-ui/react@17.6.0
  - @object-ui/components@17.6.0

## 17.5.0

### Patch Changes

- 64cda47: Fix `objectui init`'s scaffold failing its own `npm run build`, and put the third generator under the real `tsc` gate

  The scaffold `objectui init` writes declares `"build": "tsc && vite build"`, so `tsc` runs on the way to a production build — and its `src/main.tsx` did `import './index.css'` with no ambient declaration behind it. Any user who followed the generated README (`objectui init`, then `npm run build`) got `TS2882: Cannot find module or type declarations for side-effect import of './index.css'` in a file the tool had just written for them, before Vite was ever reached.

  Fixed the same way objectui#3853 fixed the two temp-app generators: the scaffold now writes `src/vite-env.d.ts` (`/// <reference types="vite/client" />`), where the `declare module '*.css'` declarations live. `vite` was already in the scaffold's `devDependencies`, so nothing new is declared.

  Measured rather than assumed: this scaffold had that one error and none of the other four classes objectui#3853 found in the temp apps — those live in a `src/Layout.tsx` this scaffold does not have. The `tsc` gate in `app-generator.test.ts` now covers the init scaffold too, so the strictness its own `tsconfig.json` declares is enforced instead of decorative.

- 9b9fa49: Make the generated temp app pass the strict `tsconfig.json` the generator writes beside it, and gate it with a real `tsc`

  Both app generators (`createTempApp`, `createTempAppWithRouting`) emit a `tsconfig.json` carrying `strict`, `noUnusedLocals` and `noUnusedParameters`, but nothing had ever run it — `dev`/`serve`/`build` go through Vite, which transpiles without type-checking — so the generated sources had drifted 17 errors past their own declared config. A user who copies the temp app out as a scaffold, or runs `tsc` in it, met all 17 at once.

  Fixed at the templates: dropped five imports that were declared and never used (`Link` in `src/App.tsx`; `cn`, `Button`, `SidebarGroupContent`, `SidebarGroupLabel` in `src/Layout.tsx`), typed `DynamicIcon`'s and `AppLayout`'s props (which also types the `menu`/`children` map callbacks by inference, and makes `className` optional so the two call sites that omit it are legal), and added the `src/vite-env.d.ts` every Vite TS scaffold carries — without it the entry's `import './index.css'` has no declaration behind it, in both generators.

  The Lucide lookup no longer needs `@ts-expect-error`: the namespace is narrowed to the component-by-name shape the layout actually uses. No `any` was added.

  A real `tsc -p` over a generated app now runs in the package's tests, so the declared strictness is enforced rather than decorative.

- Updated dependencies [ceccdcf]
- Updated dependencies [d6e5124]
- Updated dependencies [debad27]
- Updated dependencies [dc2aa3e]
- Updated dependencies [ee26e65]
- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [8f85f8b]
- Updated dependencies [d0c3b26]
- Updated dependencies [4dadf0d]
- Updated dependencies [ae10a01]
- Updated dependencies [92876f0]
- Updated dependencies [4b70d28]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [b4d3c22]
- Updated dependencies [1f9b905]
- Updated dependencies [cb13400]
- Updated dependencies [bc64bfe]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [3e19fe7]
- Updated dependencies [b953a97]
- Updated dependencies [d7f3e30]
- Updated dependencies [7e4f0e5]
- Updated dependencies [a84385b]
- Updated dependencies [45e1949]
- Updated dependencies [c1d939f]
- Updated dependencies [a3ae404]
- Updated dependencies [bfdf3d4]
- Updated dependencies [bb68488]
- Updated dependencies [b1e42d0]
- Updated dependencies [3f5f87c]
- Updated dependencies [f5e1143]
- Updated dependencies [f148a64]
- Updated dependencies [bb68488]
- Updated dependencies [47f551b]
- Updated dependencies [ab04728]
- Updated dependencies [5bf09fd]
  - @object-ui/react@17.5.0
  - @object-ui/components@17.5.0
  - @object-ui/types@17.5.0

## 17.4.0

### Patch Changes

- c32323e: Generated temp apps now declare every package they import, at ranges anchored to this repo

  `objectui dev` / `serve` / `build` write a throwaway app into `<cwd>/.objectui-tmp`,
  and the `package.json` they wrote named neither `lucide-react` nor any of the seven
  `@object-ui/plugin-*` packages the generated sources import — while pinning
  `@object-ui/react` and `@object-ui/components` at `^0.1.0`, a range that resolves to
  nothing at all for packages published at 17.x (the registry has no 0.1.0). Outside
  this workspace that manifest could not install; inside it, hoisting to the root
  `node_modules` satisfied every missing name, so nothing was ever red.

  **`lucide-react` is now declared** (objectui#3827). Both of its imports in the
  generated layout are live — `import * as LucideIcons` feeds a `DynamicIcon` lookup
  and four `LucideIcons.*` icons, and the named `{ Moon, Sun }` renders the theme
  toggle — so this is the opposite disposition from the sibling generator, where
  objectui#3755 removed an equivalent declaration precisely because nothing imported
  it. Anchored to `^1.28.0`, the range all 23 in-repo manifests that import lucide
  agree on. `commands/dev.ts` had been covering the gap in the consumer, aliasing
  `lucide-react` to a path resolved out of `packages/components` "to avoid dependency
  not found in temp app" — but only in monorepo mode, leaving every other path with an
  unsatisfiable import. The declaration belongs at the producer; the alias is now a
  workspace convenience rather than the only thing holding the import up.

  **The seven plugin packages are now declared too**, in both generators. Measuring
  the reported defect turned up that `src/App.tsx` side-effect-imports
  `@object-ui/plugin-charts`, `-editor`, `-kanban`, `-markdown`, `-form`, `-grid` and
  `-view` to register their components, and no manifest ever named them: the
  undeclared set was eight packages, not the one the issue reported.

  **`@object-ui/*` ranges are derived from this CLI's own version** instead of being
  written out as literals. `.changeset/config.json` puts `@object-ui/cli` in the same
  `fixed` group as every platform package a generated app depends on, so they always
  publish at one version — which makes `^<own version>` both current and guaranteed to
  exist on the registry. A literal here is not merely a fossil risk but a fossil
  generator: that group re-versions on every release, so any hard-coded range is stale
  the next day. This is how `^0.1.0` survived to sit 16 majors behind.

  **The toolchain ranges are anchored to in-repo manifests**, the discipline
  objectui#3742/objectui#3754 established: `vite ^5.0.0` → `^8.2.0`, `typescript
~5.7.3` → `^6.0.3`, `@vitejs/plugin-react ^4.2.1` → `^6.0.5`, `react`/`react-dom`
  `^18.3.1` → `19.2.8` with `@types/*` to match, `react-router-dom ^7.12.0` →
  `^7.18.2`, `postcss ^8.5.6` → `^8.5.26`, `autoprefixer ^10.4.23` → `^10.5.4`. React
  quotes the root's installed version rather than the wider `^18 || ^19` the platform
  packages accept as a peer: the peer says what can work, the root says what the
  generated code has actually run against, and inside this workspace the temp app
  resolves React by hoisting to the root.

  `tailwindcss` is deliberately left at `^3.4.19`. This repo is on Tailwind 4 and
  `@object-ui/components` peers `^4.2.1`, so the range is not merely behind — it
  conflicts. But re-anchoring it is not a version edit: the generated `index.css` uses
  v3 directives, the generated `postcss.config.js` names the plugin key v4 moved to
  `@tailwindcss/postcss`, and the generated `tailwind.config.js` is a v3 config. Raising
  the range without rewriting those three files yields an app that installs and renders
  unstyled, which looks fixed and is worse. Filed separately as objectui#3852; kept
  internally consistent at v3 until then, and pinned as a deliberate deferral rather
  than left to read as drift.

  The generators now build their output as a file map that the writers spill to disk,
  so tests assert over the same artifact the CLI writes. Three structural gates port
  the ones the sibling generator grew: every bare import must be declared, no versioned
  runtime dependency may be declared that nothing imports, and no generated `src/**`
  file may be unreachable from `src/main.tsx` — the one module `index.html` loads. Each
  is paired with a self-test that plants the defect back. Note for the next port: the
  `create-plugin` import scanner matches single-quoted specifiers only, and these
  templates mix quote styles, so a verbatim copy would have been blind to
  `from "lucide-react"` — one of the two lines this issue reports.

- 8277053: 修复 `objectui dev` 生成的临时 app 的 CSS 管线:整套从 Tailwind 3 迁到 Tailwind 4

  生成器写出的样式面此前是完整的 v3 三件套 —— `src/index.css` 用 `@tailwind base/components/utilities` 指令、`postcss.config.js` 写 v3 的 `tailwindcss: {}` 插件键、外加一份 `tailwind.config.js` —— 而仓内与 `@object-ui/components` 都已在 v4(components 的 peer 是 `tailwindcss ^4.2.1`)。两个后果都是真的:

  - **仓内 `objectui dev` 今天不出样式。** `commands/dev.ts` 的 monorepo 分支把 `require('tailwindcss')(configPath)` 当 PostCSS 插件调用,v4 下这条路径只会抛 "moved to `@tailwindcss/postcss`",而该异常被 `try/catch` 吞成一行黄字警告;`css.postcss` 因此没被设上,Vite 退回去搜配置文件,`/src/index.css` 请求最终 500(实测:`Failed to load PostCSS config … Cannot find module '@tailwindcss/postcss'`),浏览器里一条样式都没有。
  - **仓外一次干净安装会 ERESOLVE。** 生成清单声明 `tailwindcss ^3.4.19`,与它依赖的 `@object-ui/components` 的 v4 peer 冲突。

  改动:

  - `src/index.css` 改为仓内惯用的 v4 CSS-first 写法(`@import 'tailwindcss'` + `@custom-variant dark` + `@source` + `@theme`),`@theme` 的 token 集与 `packages/components/src/index.css` 逐条对齐 —— 包含 v3 config 一直缺、而生成的 `src/Layout.tsx` 自己就在用的 8 个 `sidebar-*` token。
  - `postcss.config.js` 改写 `'@tailwindcss/postcss': {}`;`tailwind.config.js` 不再生成(v4 下没有 `@config` 指向它时它就是死文件,仓内本身也零个 `tailwind.config.*`),v3 的 `content` 扫描面等价迁为 `@source`。
  - 清单:`tailwindcss` 抬到 `^4.3.3` 并新增 `@tailwindcss/postcss ^4.3.3`,两者都锚回仓内(#3827 记的 `TAILWIND_V3_DEFERRED` 记账钉随之翻转)。
  - `commands/dev.ts` 改用 `@tailwindcss/postcss`,并由 `@object-ui/cli` 自己声明这两个插件包;加载失败不再吞成警告,而是带修法响亮报错 —— 静默无样式正是这个缺陷能潜伏这么久的原因。

- 59df371: `objectui doctor` now diagnoses Tailwind 4 instead of Tailwind 3

  The Tailwind section of `objectui doctor` was written against v3 and got every
  question backwards on a v4 project — which is every project this repo ships.

  **It counted a missing `tailwind.config.js` as an issue.** In v4 that file is not
  part of the setup: the engine reads CSS-first configuration (`@import
'tailwindcss'`, `@theme`, `@source`) and only loads a JS config when a stylesheet
  opts in with `@config`. So the command reported a problem that did not exist and
  pushed the reader toward creating a file Tailwind would never read. Measured on
  `examples/console-starter`, a correct v4 app: before, `Found 1 issue(s)` —
  `⚠️ tailwind.config.js not found`; after, `Everything looks good! ✨`. The repo's
  own root reproduced it identically.

  **It then graded that file on its `content` array**, the v3 key `@source`
  replaced. The two `tailwind.config.*` files still tracked here are exactly that
  trap: `apps/console` and `examples/byo-backend-console` both declare a `content`
  array, no stylesheet in the repo contains `@config`, so both files are inert —
  and the old check answered `✓ Tailwind content paths configured` for them. A
  false green on a dead file. `apps/console` before: `Everything looks good! ✨`;
  after: one finding saying the config is inert and what to do about it.

  **It never checked `@tailwindcss/postcss`**, the one dependency a v4 build cannot
  start without — v4 moved the PostCSS plugin out of `tailwindcss` into that
  package, and naming the old `tailwindcss` key in a PostCSS config resolves to a
  shim whose only job is to throw. That is the failure form objectui#3852 measured
  on the generated app, and doctor printed `✓ Tailwind CSS installed` straight
  through it.

  The checks are now the v4 contract, matching what `objectui init` scaffolds:
  `@tailwindcss/postcss` declared or installed, a PostCSS config naming it rather
  than the v3 `tailwindcss` key, and a CSS entry running `@import 'tailwindcss'`
  (with `@source` acknowledged when present). The declared `tailwindcss` major is
  read too, so a v3 range is named as migration debt instead of passing as
  `✓ installed`.

  Two deliberate silences, because objectui#3891 is about doctor asserting things
  it cannot see. A **missing** `tailwind.config.*` produces no finding of any level
  — only a _present_ one does, and only when nothing opts into it via `@config`.
  And when no recognised CSS entry exists at all (a monorepo root, a bespoke
  layout), the CSS verdicts are skipped rather than guessed.

  A v3-tolerant dual path — branching on the declared major and running two sets of
  checks — was considered and deliberately not built: it widens the product surface
  past this repo's v4-only posture. v3 spellings are diagnosed as migration debt,
  not supported as a second mode.

  Internally `runDiagnostics(cwd)` now returns structured findings carrying a
  stable `id`, and `doctor()` only renders and counts them. That split is what
  makes the matrix testable against real fixture directories instead of scraped
  console output; the tests pin verdicts by `id`, so wording can improve without
  the coverage evaporating.

- 85fb95b: Fix `objectui init` scaffolding an app that renders neither components nor styles.

  The generated `src/App.tsx` imported only `SchemaRenderer` from `@object-ui/react`, which does not depend on `@object-ui/components` — and registration is a side effect of importing that package. The component registry was therefore empty in every scaffolded project, and each node of all three templates (`simple`, `form`, `dashboard`) rendered "Unknown component type". The manifest already declared `@object-ui/components`; it was declared and never imported. The generated `src/App.tsx` now performs the side-effect import.

  The generated `src/index.css` was a bare `@import 'tailwindcss';` and never loaded the library's published stylesheet, so the theme utilities the templates lean on had no tokens behind them. It now also does `@import '@object-ui/components/style.css';`, matching what the quick-start guide teaches hand-rolled consumers.

  `objectui init` is unchanged in every other respect: the same eleven files, byte for byte, apart from these two lines.

- c29ceff: Move the generator templates' dependency ranges onto the repo's current ones

  The dependabot wave of 2026-08-10 bumped `lucide-react` to `1.29.0` and `vite`
  to `8.2.1` in this repo's own manifests, but the ranges hard-coded in the
  scaffold generators do not move with it — dependabot does not know the
  templates exist. A project scaffolded by `objectui init` / `objectui dev` or by
  `create-plugin` therefore declared a range the repo itself had already moved
  past.

  Three ranges are re-anchored: `lucide-react` `^1.28.0` → `^1.29.0` in the routed
  app generator, and `vite` `^8.2.0` → `^8.2.1` in both the shared CLI scaffold
  devDependencies and the create-plugin template.

- 0a09793: `objectui init` now versions the project it scaffolds against the CLI that wrote it, and stops writing a `tailwind.config.js` Tailwind 4 never reads.

  The generated `package.json` asked for `@object-ui/components` and `@object-ui/react` at `^2.0.0` while those packages publish at 17.x, so `npm install` in a fresh scaffold resolved a major unrelated to the CLI that produced it. Both ranges are now derived from the CLI's own version, which is sound because `.changeset/config.json` releases the CLI and every platform package from one `fixed` group. The scaffold's toolchain ranges had drifted the same way — vite `^7.3.1` against the repo's `^8.2.0`, typescript `^5.9.3` against `^6.0.3`, and seven more — and now read from the same table the temp-app generators use rather than from literals of their own.

  The scaffold's CSS pipeline was already Tailwind 4 (`@tailwindcss/postcss`, `@import 'tailwindcss'`), and v4 reads a JS config only when a stylesheet points `@config` at one. The `tailwind.config.js` written beside it was therefore inert — an authoritative-looking `content` list nothing consumed — and is no longer written.

- Updated dependencies [794c497]
- Updated dependencies [993336f]
- Updated dependencies [f0a625a]
- Updated dependencies [b5980f4]
- Updated dependencies [8aad9fd]
- Updated dependencies [0cbdca8]
- Updated dependencies [d229dfa]
- Updated dependencies [ecae400]
- Updated dependencies [d3e738a]
- Updated dependencies [c3b01a7]
- Updated dependencies [7ed3360]
- Updated dependencies [0fa5e4d]
- Updated dependencies [5bfaabd]
- Updated dependencies [e06810e]
- Updated dependencies [ab3ad4f]
- Updated dependencies [c2fd122]
- Updated dependencies [e24d767]
- Updated dependencies [aca561a]
- Updated dependencies [48132f7]
- Updated dependencies [0ef9dfd]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [e6fdbdc]
- Updated dependencies [54233b1]
- Updated dependencies [97b63d7]
- Updated dependencies [7e2b7e9]
- Updated dependencies [c1e1e6b]
  - @object-ui/components@17.4.0
  - @object-ui/react@17.4.0
  - @object-ui/types@17.4.0

## 17.3.0

### Patch Changes

- Updated dependencies [532cf8b]
- Updated dependencies [680080a]
- Updated dependencies [a7651e6]
- Updated dependencies [d915c47]
- Updated dependencies [b71fc92]
- Updated dependencies [34595eb]
- Updated dependencies [3889ffb]
- Updated dependencies [9e9e9a9]
- Updated dependencies [56409c2]
- Updated dependencies [042e09d]
- Updated dependencies [9cbcbf4]
- Updated dependencies [85c4c9c]
- Updated dependencies [fd54c3e]
- Updated dependencies [4eeb932]
- Updated dependencies [23018cc]
- Updated dependencies [53811d1]
- Updated dependencies [d915c47]
- Updated dependencies [f44d872]
- Updated dependencies [825bbe3]
- Updated dependencies [5dd0127]
- Updated dependencies [06632e9]
- Updated dependencies [a4cff5b]
- Updated dependencies [175bd79]
- Updated dependencies [f833d3a]
- Updated dependencies [71be406]
- Updated dependencies [d22ae31]
- Updated dependencies [8d8094a]
  - @object-ui/components@17.3.0
  - @object-ui/types@17.3.0
  - @object-ui/react@17.3.0

## 17.2.0

### Patch Changes

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [a889e31]
- Updated dependencies [09d30a4]
- Updated dependencies [4bf612c]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [f6e8d78]
- Updated dependencies [ea96284]
- Updated dependencies [a8ad6c0]
- Updated dependencies [444457c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0
  - @object-ui/components@17.2.0
  - @object-ui/react@17.2.0

## 17.1.0

### Patch Changes

- c735bf7: fix(form): a spec-vocabulary field no longer crashes the standalone form, and every surface now says which vocabulary you meant — #3090

  Writing the regression test against the unfixed renderer proved the failure
  was worse than the assumed silent drop: a `{ field: 'x' }` entry (spec
  form-VIEW vocabulary) slipped past the `f?.name` guards into a
  react-hook-form Controller with `name === undefined` and crashed the whole
  standalone form on `name.split('.')`, with nothing naming the culprit entry.
  The renderer now partitions such entries out — the rest of the form renders —
  and surfaces them with an inline alert plus a console.error whose text is the
  fix instruction (rename to `name`, or use an object-bound form whose sections
  accept the spec shape).

  `objectui validate` grows the same boundary awareness: on failure, a
  `{ field: … }` entry in a standalone form gets a "likely cause" hint naming
  the real fix instead of the bare `invalid_union` — the previous message read
  as "bolt a `name` on", which converts spec metadata wrongly. On success,
  mixed-vocabulary entries (`name` + string `field`) get a warning: they
  validate, but the spec key is dead weight the renderer ignores.

  `normalizeSectionField` warns (once per site) when an authored section field
  mixes both identity keys — the spec branch derives the runtime name from
  `field`, so an authored `name` was silently overwritten.

- Updated dependencies [fc0272a]
- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [c785740]
- Updated dependencies [b41f401]
- Updated dependencies [19e9fa0]
- Updated dependencies [9eb932b]
- Updated dependencies [38ca8be]
- Updated dependencies [68ef584]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [c769d3d]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [c735bf7]
- Updated dependencies [02aef0c]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [9a04d25]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [07de839]
- Updated dependencies [2a40b5e]
- Updated dependencies [df613fa]
- Updated dependencies [4874117]
- Updated dependencies [ce08d55]
- Updated dependencies [eb4b740]
- Updated dependencies [5b084eb]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
- Updated dependencies [2d5d594]
- Updated dependencies [ea7f477]
- Updated dependencies [379728f]
- Updated dependencies [7f23cd0]
- Updated dependencies [0ded602]
- Updated dependencies [24e0e0a]
- Updated dependencies [3a6cf24]
- Updated dependencies [aa35561]
- Updated dependencies [03bd53b]
- Updated dependencies [3c1f321]
- Updated dependencies [a045a32]
- Updated dependencies [912496d]
- Updated dependencies [80edbd4]
- Updated dependencies [9867281]
  - @object-ui/components@17.1.0
  - @object-ui/react@17.1.0
  - @object-ui/types@17.1.0

## 17.0.0

### Patch Changes

- dc7a798: fix(plugin-grid,plugin-form,plugin-designer,cli,vscode-extension): type-check the last five unchecked packages, and fix the two runtime bugs that hid there (#2919)

  Closes the remaining `DEBT` entries from the #2911 sweep. Each package gains
  `"type-check": "tsc --noEmit"` and loses its entry in
  `scripts/check-type-check-coverage.mjs`; coverage goes 36 -> 41 of 45 and
  outstanding errors 25 -> 5 (only #2916 `plugin-view` and #2918 `layout` remain).

  **Two of these were real bugs, not just type noise.**

  `@object-ui/cli` — `objectui validate` could never report a validation failure.
  `ZodError.errors` was removed in Zod 4 (the repo is on 4.4.3), so `.errors` read
  `undefined` and `.forEach` threw a `TypeError` that the enclosing `catch`
  reported as `✗ Error reading or parsing schema file: Cannot read properties of
undefined` — swallowing the very errors the command exists to print. Now reads
  `.issues`. Verified against the built CLI: an invalid schema now prints
  `1. Invalid input / Code: invalid_union` and exits 1.

  `@object-ui/plugin-grid` — grouping a grid by a boolean column showed the raw
  i18n key. `t('grid.booleanTrue', 'Yes')` asked for a key present in neither
  `GRID_DEFAULT_TRANSLATIONS` nor any locale bundle, and passed the English
  fallback as a bare second argument — which `createSafeTranslation`'s no-provider
  translator reads as an _options object_, so the fallback never applied and the
  header rendered the literal `grid.booleanTrue`. Switched to the `grid.yes` /
  `grid.no` keys the boolean cell renderer (`ObjectGrid.tsx`) and
  `BulkActionDialog` already use, with the fallback passed as `defaultValue`.
  Covered by a new regression test, confirmed to fail against the old code.

  The rest are type-only corrections that preserve runtime behaviour exactly:

  - **plugin-grid** `importParsers.ts` — `scorePair`'s `score`/`reason` moved into
    one `best` record. They were captured `let`s mutated only inside the `bump`
    closure, which TypeScript's control-flow analysis does not track, so it still
    believed `reason` was `'none'` at the type gate and flagged the comparisons as
    non-overlapping (TS2367). The gate — which stops a text column being mapped
    onto a number field — is unchanged; its two dedicated tests still pass.
  - **plugin-form** — `SectionFieldsContext.fieldLabel` now requires `fallback`,
    matching the `useSafeFieldLabel` producer in `@object-ui/i18n` (an omitted
    fallback could not satisfy the `=> string` return, and all four call sites
    already pass one). This one signature cleared six errors.
    `MasterDetailFormSchema.recordId` widens to `string | number`, matching
    `ObjectFormSchema` and the five envelopes that forward straight into it;
    it is narrowed with `String()` only at the batch-transaction boundary, whose
    `BatchTransactionOperation.id` is a string by protocol (the `isEdit` guard
    already proves it non-null there). `deriveMasterDetail`'s column sort gets an
    explicit `fillPriority` helper — `GridColumn.type` is optional, and a column
    without one keeps sorting at priority 5 exactly as the old
    `TYPE_FILL_PRIORITY[undefined] ?? 5` lookup put it.
  - **plugin-designer** — unused `index` parameter prefixed `_`, matching the
    `_entry` beside it.
  - **cli** — a stale `@ts-expect-error` removed; `viteConfig` is typed `any`, so
    the line it guarded had stopped erroring.
  - **vscode-extension** (`object-ui`) — migrated off `moduleResolution: "node"`,
    which is deprecated and stops working in TypeScript 7, to `node16` paired with
    `module: "node16"` (the package has no `"type": "module"`, so node16 resolves
    it as the CommonJS that tsup emits, and it gains the `exports`-map awareness
    node10 lacks). Its error count was under-reported as 1: that TS5107 config
    error masked four more. The package uses `console`/`Buffer` but sets
    `lib: ["ES2020"]` with no DOM and never declared `@types/node` — added, with an
    explicit `types: ["node", "vscode"]`.

  Also: `plugin-grid`, `plugin-form` and `plugin-designer` gain the `baseUrl` +
  `paths` override their type-checked plugin peers already carry, and `cli` an
  empty `paths`. Without it the inherited root `paths` point `@object-ui/*` at
  sibling `src/`, which is outside each project's `rootDir` and produces the ~104
  spurious TS6059 errors noted in #2915; workspace deps instead resolve through
  node_modules to built `.d.ts`, which `type-check`'s `dependsOn: ["^build"]`
  guarantees exist.

  Verified the gate genuinely covers all five rather than trusting the green:
  injecting a type error into each package makes `pnpm type-check --filter <pkg>`
  fail, which was impossible before this change.

- Updated dependencies [7b21891]
- Updated dependencies [952b978]
- Updated dependencies [de5e40c]
- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [7b35e4b]
- Updated dependencies [8fb1295]
- Updated dependencies [dfd3705]
- Updated dependencies [c77108c]
- Updated dependencies [c19ac11]
- Updated dependencies [6dee2cb]
- Updated dependencies [c7cff19]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [2f947e4]
- Updated dependencies [7d46648]
- Updated dependencies [9b53d72]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [c6cfdf1]
- Updated dependencies [d147a13]
- Updated dependencies [c6aaed8]
- Updated dependencies [dc334da]
  - @object-ui/components@17.0.0
  - @object-ui/react@17.0.0
  - @object-ui/types@17.0.0

## 16.1.0

### Patch Changes

- 549c67d: chore(lint): clear the mechanical baseline lint errors so these packages' lint gates protect them again

  Extends the fields/core cleanup from #2709 (objectui#2713). These eight package
  lints were red at baseline on `main`, so their per-package `lint` gate could not
  catch new violations of the same class. Cleared every **error** (no behavior
  change; warnings are out of scope):

  - **`no-useless-catch`** (`data-objectstack`) — unwrapped five try/catch blocks
    whose `catch` only re-threw; errors still propagate identically.
  - **`preserve-caught-error`** (`cli`, `data-objectstack`, `react`) — the caught
    error's message is inlined into the thrown `Error`; a scoped disable with a
    justifying comment carries each one, because these packages target ES2020
    whose lib types the 1-arg `Error` constructor only (so `{ cause }` won't
    compile) — same reasoning as the core case in #2709.
  - **`prefer-const`** (`plugin-calendar`, `plugin-map`) — `let`→`const` for
    never-reassigned bindings.
  - **`no-empty-object-type`** (`plugin-designer`) — empty extend-only interfaces
    → equivalent `type` aliases.
  - **`no-useless-assignment`** (`react`) — dropped a dead initializer that both
    branches overwrite before it is read.
  - **`no-require-imports`** (`plugin-calendar`, `plugin-timeline` tests) —
    hoisted `vi.mock` factories now use an `async` factory with
    `await import('react')` instead of `require('react')`.
  - **stale `eslint-disable` directive** (`plugin-markdown`) — removed a
    `react/no-danger` disable whose plugin is not loaded in the flat config (an
    unknown-rule reference that ESLint v10 reports as an error); the rationale is
    kept as a plain comment.

- Updated dependencies [7cf4051]
- Updated dependencies [803558e]
- Updated dependencies [2e7d7f0]
- Updated dependencies [ef14f69]
- Updated dependencies [94d4876]
- Updated dependencies [69fa5d1]
- Updated dependencies [549c67d]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [62b9ab5]
- Updated dependencies [1629313]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [199fa83]
  - @object-ui/types@16.1.0
  - @object-ui/react@16.1.0
  - @object-ui/components@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [d3e19ed]
- Updated dependencies [59d4fa9]
- Updated dependencies [4c7c47f]
- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
- Updated dependencies [195a651]
- Updated dependencies [33b4995]
  - @object-ui/react@16.0.0
  - @object-ui/components@16.0.0
  - @object-ui/types@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/react@15.0.0
- @object-ui/components@15.0.0

## 14.1.0

### Patch Changes

- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [055e1d2]
- Updated dependencies [9e2d58f]
- Updated dependencies [dea65f7]
- Updated dependencies [f30ff68]
- Updated dependencies [073e7aa]
- Updated dependencies [6c0135c]
- Updated dependencies [5b52624]
- Updated dependencies [4afb251]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f94905d]
- Updated dependencies [f0f10f5]
  - @object-ui/types@14.1.0
  - @object-ui/react@14.1.0
  - @object-ui/components@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [86c69c3]
- Updated dependencies [a44e7b6]
- Updated dependencies [6a74160]
  - @object-ui/react@14.0.0
  - @object-ui/types@14.0.0
  - @object-ui/components@14.0.0

## 13.2.0

### Patch Changes

- Updated dependencies [80901aa]
- Updated dependencies [e492b9d]
  - @object-ui/components@13.2.0
  - @object-ui/react@13.2.0
  - @object-ui/types@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [ac04b76]
- Updated dependencies [619097e]
  - @object-ui/components@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/react@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [6cbccf3]
- Updated dependencies [c31874d]
  - @object-ui/components@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/react@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
  - @object-ui/types@12.0.0
  - @object-ui/components@12.0.0
  - @object-ui/react@12.0.0

## 11.5.0

### Patch Changes

- Updated dependencies [6fffd3d]
- Updated dependencies [9255686]
- Updated dependencies [fae75e2]
- Updated dependencies [1072701]
  - @object-ui/react@11.5.0
  - @object-ui/components@11.5.0
  - @object-ui/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [bce581a]
- Updated dependencies [c38d107]
- Updated dependencies [7782698]
- Updated dependencies [e84d64d]
  - @object-ui/types@11.4.0
  - @object-ui/components@11.4.0
  - @object-ui/react@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [b7237bb]
- Updated dependencies [d23d6eb]
  - @object-ui/components@11.3.0
  - @object-ui/react@11.3.0
  - @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
  - @object-ui/components@11.2.0
  - @object-ui/react@11.2.0
  - @object-ui/types@11.2.0

## 11.1.0

### Patch Changes

- @object-ui/components@11.1.0
- @object-ui/react@11.1.0
- @object-ui/types@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/types@7.3.0
- @object-ui/react@7.3.0
- @object-ui/components@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [d23db5c]
  - @object-ui/types@7.2.0
  - @object-ui/components@7.2.0
  - @object-ui/react@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [677f7ed]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/react@7.1.0
  - @object-ui/components@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [a00e16d]
- Updated dependencies [c12986e]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [6c0c92c]
- Updated dependencies [cb2fdb1]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [3870c20]
- Updated dependencies [2eb3096]
- Updated dependencies [b88c560]
- Updated dependencies [d16566f]
- Updated dependencies [90acb7f]
- Updated dependencies [7913390]
- Updated dependencies [e95cc25]
- Updated dependencies [abe8ebc]
- Updated dependencies [300d755]
- Updated dependencies [bd8b054]
- Updated dependencies [4eb9cb6]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [8d1195d]
  - @object-ui/components@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/types@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3

## 6.2.2

### Patch Changes

- Updated dependencies [a66f788]
  - @object-ui/react@6.2.2
  - @object-ui/components@6.2.2
  - @object-ui/types@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/react@6.2.0
- @object-ui/components@6.2.0
- @object-ui/types@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/react@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/react@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [b2d1704]
- Updated dependencies [87bc8ff]
- Updated dependencies [3ebba63]
- Updated dependencies [a8d12ec]
- Updated dependencies [70b5570]
- Updated dependencies [aa063db]
- Updated dependencies [7c7400a]
  - @object-ui/types@5.2.0
  - @object-ui/react@5.2.0
  - @object-ui/components@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/types@5.1.1
  - @object-ui/react@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [bd8447d]
- Updated dependencies [fbd5052]
- Updated dependencies [d51a577]
- Updated dependencies [d1ec6a2]
- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
- Updated dependencies [d548d6b]
  - @object-ui/components@5.1.0
  - @object-ui/react@5.1.0
  - @object-ui/types@5.1.0

## 5.0.2

### Patch Changes

- @object-ui/components@5.0.2
- @object-ui/react@5.0.2
- @object-ui/types@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [8930b15]
- Updated dependencies [95b6b21]
- Updated dependencies [ddb08a7]
- Updated dependencies [765d50f]
- Updated dependencies [927187a]
- Updated dependencies [bae8ba8]
- Updated dependencies [8435860]
- Updated dependencies [bb2ea48]
- Updated dependencies [b14fe09]
- Updated dependencies [a7bef6e]
- Updated dependencies [74962b0]
- Updated dependencies [3154334]
- Updated dependencies [fa4c2cb]
- Updated dependencies [7213027]
  - @object-ui/components@5.0.0
  - @object-ui/react@5.0.0
  - @object-ui/types@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/react@4.8.0
- @object-ui/components@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0

## 4.6.0

### Patch Changes

- Updated dependencies [3ee436d]
  - @object-ui/components@4.6.0
  - @object-ui/types@4.6.0
  - @object-ui/react@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
- Updated dependencies [6b6afd1]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/types@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/react@4.5.0

## 4.4.0

### Patch Changes

- Updated dependencies [2bd45af]
  - @object-ui/components@4.4.0
  - @object-ui/types@4.4.0
  - @object-ui/react@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [6b683c8]
  - @object-ui/components@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/types@4.3.1

## 4.3.0

### Patch Changes

- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/components@4.3.0
  - @object-ui/react@4.3.0
  - @object-ui/types@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/components@4.2.0
- @object-ui/react@4.2.0
- @object-ui/types@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/react@4.1.0
- @object-ui/components@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/components@4.0.11
- @object-ui/react@4.0.11
- @object-ui/types@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/components@4.0.8
- @object-ui/react@4.0.8
- @object-ui/types@4.0.8

## 4.0.7

### Patch Changes

- fd15918: Comprehensive i18n refactor + CI test fix.

  **i18n (`@object-ui/i18n`)**

  - Added ~130 new keys under 12 new top-level namespaces: `layout`, `search`,
    `empty`, `renderer`, `actionDialog`, `rowAction`, `navigationSync`,
    `objectActions`, `objectViewActions`, `dashboardActions`, `recordDetail`,
    `cellRender`, plus `grid.{empty,yes,no,systemFields,openMenu}`.
  - Mirrored all new top-level namespaces to all 10 built-in locales
    (en, zh, ja, ko, de, fr, es, pt, ru, ar) to maintain key parity required
    by the locale-structure test. Non-en/zh locales seed with English values
    and rely on `fallbackLng: 'en'` until human translation lands.

  **App shell (`@object-ui/app-shell`)** — replaced hardcoded English in 14
  files with `useObjectTranslation`:

  - Layout: `AppSidebar`, `ActivityFeed` (locale-aware relative time),
    `MetadataInspector`.
  - Views: `SearchResultsPage`, `ActionParamDialog`, `RecordFormPage`,
    `RecordDetailView`, `PageView`, `DashboardView` (PDF / forecast toasts),
    `ReportView`, `ObjectView` (rename / delete view toasts).
  - Console: `AppContent` (no-apps empty state).
  - Components: `PageRenderer`, `FormRenderer`, `DashboardRenderer`.
  - Hooks: `useNavigationSync` (16 toasts incl. Undo label),
    `useObjectActions` (delete confirm + success / failure toasts).

  **Plugin grid (`@object-ui/plugin-grid`)**

  - `ObjectGrid` record-detail panel now translates Empty / Yes / No / System
    via the existing `useGridTranslation` safe-fallback wrapper.
  - `RowActionMenu` adopts a local safe-fallback i18n wrapper for
    `Open menu` / `Edit` / `Delete`, preserving standalone-usage guarantees.

  **CLI test fix (`@object-ui/cli`)**

  - `cli-bin.test.ts` auto-builds the package on first run when `dist/cli.js`
    is missing, instead of throwing. This unbreaks `pnpm test:coverage` in CI
    (root vitest run does not honor turbo's `^build` deps) and removes the
    manual `pnpm --filter @object-ui/cli build` requirement for local dev.

- Updated dependencies [7c9b85c]
  - @object-ui/react@4.0.7
  - @object-ui/components@4.0.7
  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- 925051d: fix: convert Tailwind v3 `[--var]` arbitrary value syntax to v4 `(--var)`

  Shadcn `Sidebar`, `Calendar`, `Chart`, `Popover`, `Tooltip`, `HoverCard`,
  `Menubar`, `Select`, `Dropdown`, `Context-Menu`, and `AppSidebar` used the
  Tailwind v3 syntax `w-[--sidebar-width]`, `origin-[--radix-...]`, etc.
  Tailwind v4 no longer interprets the bare `--xxx` inside arbitrary values
  as `var(--xxx)`, so the rule emits empty CSS — the sidebar collapses to
  0 width and overlays the main content, dropdown/popover positions fall
  back to the wrong origin, and the calendar cells lose their fixed size.

  Replaced all such occurrences with the v4 CSS-variable shorthand
  `w-(--sidebar-width)`, `origin-(--radix-...)`, etc. Existing
  `[calc(var(--xxx)*-1)]` arbitrary expressions are unaffected.

- Updated dependencies [925051d]
- Updated dependencies [1b6dc64]
  - @object-ui/components@4.0.6
  - @object-ui/types@4.0.6
  - @object-ui/react@4.0.6

## 4.0.5

### Patch Changes

- Updated dependencies [1dc6061]
  - @object-ui/components@4.0.5
  - @object-ui/types@4.0.5
  - @object-ui/react@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [d2b6ece]
  - @object-ui/components@4.0.4
  - @object-ui/types@4.0.4
  - @object-ui/react@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3
  - @object-ui/react@4.0.3
  - @object-ui/components@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/react@4.0.1
- @object-ui/components@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/components@4.0.0
  - @object-ui/react@4.0.0

## 3.4.0

### Patch Changes

- Updated dependencies [a2d7023]
- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/components@3.4.0
  - @object-ui/types@3.4.0
  - @object-ui/react@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/react@3.3.2
- @object-ui/components@3.3.2

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/types@3.3.1
  - @object-ui/react@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/react@3.3.0
- @object-ui/components@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/react@3.1.5
- @object-ui/components@3.1.5
- @object-ui/types@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/react@3.1.4
- @object-ui/components@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/react@3.1.3
- @object-ui/components@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/react@3.1.2
- @object-ui/components@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/components@3.1.1
  - @object-ui/react@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/react@3.0.3
- @object-ui/components@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/react@3.0.2
- @object-ui/components@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [adf2cc0]
  - @object-ui/react@3.0.1
  - @object-ui/components@3.0.1
  - @object-ui/types@3.0.1

## 3.0.0

### Minor Changes

- 87979c3: Upgrade to @objectstack v3.0.0 and console bundle optimization
  - Upgraded all @objectstack/\* packages from ^2.0.7 to ^3.0.0
  - Breaking change migrations: Hub → Cloud namespace, definePlugin removed, PaginatedResult.value → .records, PaginatedResult.count → .total, client.meta.getObject() → client.meta.getItem()
  - Console bundle optimization: split monolithic 3.7 MB chunk into 17 granular cacheable chunks (95% main entry reduction)
  - Added gzip + brotli pre-compression via vite-plugin-compression2
  - Lazy MSW loading for build:server (~150 KB gzip saved)
  - Added bundle analysis with rollup-plugin-visualizer

### Patch Changes

- Updated dependencies [87979c3]
  - @object-ui/types@3.0.0
  - @object-ui/react@3.0.0
  - @object-ui/components@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/react@2.0.0
  - @object-ui/components@2.0.0

## 0.3.1

### Patch Changes

- Maintenance release - Documentation and build improvements
- Updated dependencies
  - @object-ui/react@0.3.1
  - @object-ui/components@0.3.1

## 0.3.0

### Minor Changes

- Unified version across all packages to 0.3.0 for consistent versioning

## 0.2.2

### Patch Changes

- New plugin-object and ObjectQL SDK updates

  **Added:**

  - New Plugin: @object-ui/plugin-object - ObjectQL plugin for automatic table and form generation
    - ObjectTable: Auto-generates tables from ObjectQL object schemas
    - ObjectForm: Auto-generates forms from ObjectQL object schemas with create/edit/view modes
    - Full TypeScript support with comprehensive type definitions
  - Type Definitions: Added ObjectTableSchema and ObjectFormSchema to @object-ui/types
  - ObjectQL Integration: Enhanced ObjectQLDataSource with getObjectSchema() method using MetadataApiClient

  **Changed:**

  - Updated @objectql/sdk from ^1.8.3 to ^1.9.1
  - Updated @objectql/types from ^1.8.3 to ^1.9.1

- Updated dependencies
  - @object-ui/react@0.2.2
  - @object-ui/components@0.2.2

## 0.2.1

### Patch Changes

- Patch release: Add automated changeset workflow and CI/CD improvements

  This release includes infrastructure improvements:

  - Added changeset-based version management
  - Enhanced CI/CD workflows with GitHub Actions
  - Improved documentation for contributing and releasing

- Updated dependencies
  - @object-ui/react@0.2.1
  - @object-ui/components@0.2.1
