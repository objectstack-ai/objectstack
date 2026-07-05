# @objectstack/spec

## 12.2.0

### Minor Changes

- fce8ff4: feat(rest,spec): named import mappings (#2611) — `POST /data/:object/import` accepts `mappingName`, resolving a registered `defineMapping` artifact (stack `mappings:`) and applying its fieldMapping pipeline (rename + constant/map/split/join; lookup delegates to the built-in reference resolution) as a strict projection before coercion. The artifact's `mode`/`upsertKey` serve as writeMode/matchFields defaults; explicit request values win. Errors are loud and specific: `MAPPING_NOT_FOUND`, `MAPPING_TARGET_MISMATCH`, `MAPPING_FORMAT_MISMATCH`, `CONFLICTING_MAPPING` (mutually exclusive with the inline rename), and `UNSUPPORTED_TRANSFORM` for `javascript` (no server-side sandbox — never silently skipped). `defineStack` cross-reference validation now rejects mappings targeting undefined objects and `javascript` transforms at build time.
- 3962023: feat(spec,security): make ambiguous nav landings unrepresentable + close the field-permission filter oracle (objectui#2251, objectui ADR-0055).

  **spec — `ObjectNavItem` target exclusivity.** `NavigationItemSchema` now rejects an object nav item that combines `filters` with `recordId` or `viewName` (custom issue on `filters` with the fix in the message). Runtime precedence would silently ignore the extras — a stale `recordId` hijacking a configured `filters` slice — so the ambiguous combination is now unwritable (ADR-0053 correct-by-construction). FROM `{ filters, viewName }` / `{ filters, recordId }` TO exactly one landing field; the legacy `recordId` + `viewName` combination stays tolerated (documented: `viewName` is ignored). `filters` shipped in the same unreleased minor, so no released metadata is affected.

  **plugin-security — field-level predicate guard.** `FieldMasker` strips non-readable fields from RESULTS, but predicates still leaked their values: filtering / sorting / grouping / aggregating by a hidden field changes row presence (a filter oracle — probe `salary >= X` even though the column is masked). The security middleware now rejects (403 `PermissionDeniedError`, `reason: 'field_predicate_denied'`) any caller query whose `where` / `orderBy` / `groupBy` / `having` / `aggregations` / `windowFunctions` reference a field the caller cannot read — evaluated against the caller's AST **before** RLS injection, so RLS policies may keep referencing hidden fields (e.g. `owner_id`). Rejection over silent predicate dropping: removing an `$and` branch widens results and re-opens the oracle. New exports: `assertReadableQueryFields`, `collectQueryFields`, `collectConditionFields`.

- 2bb193d: feat(spec): `ObjectNavItem.filters` — declarative URL filter conditions targeting the parameterized bare data surface (objectui ADR-0055, objectui#2251).

  An object nav item can now carry `filters: Record<string, string>` (equality semantics). The shell resolves such an entry to `/:objectName/data?filter[<field>]=<value>` — an unanchored data surface with removable filter chips — instead of a saved list view. Use it for one-off / parameterized slices (dashboard drill-throughs, "assigned to me" links); slices worth curating stay on `viewName`. Values support the same `{current_user_id}` / `{current_org_id}` template variables as `recordId`. Target precedence within `type: 'object'`: `recordId` → `filters` → `viewName`. Purely additive — items without `filters` are unaffected.

- 0426d27: feat(spec): `deriveRecordFlowSurface(def, flow, opts)` — flow-aware record-surface derivation (#2604, extends #2578's `deriveRecordSurface`, ADR-0085 §5 one-shared-derivation).

  Decides the default surface per record FLOW: `view` keeps the shipped behavior verbatim (field-heavy → `route`/page, light → drawer overlay); the task flows (`create` / `edit` / `child-create` / `child-edit`) are ALWAYS overlays — never routes — with the derived `'page'` mapped to a full-screen modal (`size: 'full'`) and light objects staying a drawer. `child-*` flows take the CHILD object's def (the overlay sizes to the record being edited; the return target is always the parent detail). Mobile task flows are full-screen modals.

  Rationale: viewing a record is shareable state (deep-link belongs there); making/changing one is a transient task whose URL is a false promise (refresh loses the draft) and whose invariant is lossless return to the origin. Renderers treat the result as the DEFAULT only — explicit `navigation.mode`/`size`, `FormView.type`/`modalSize`, or an assigned page still win. No new authorable key (ADR-0085 §2). Additive, no breaking changes.

- da807f7: feat(spec)!: retire the placeholder metadata kinds `trigger`, `router`, `function`, `service` (ADR-0088).

  The registry is the contract authors — human and AI — read to learn what can be authored, and these four kinds had no authoring surface, no loader, no schema, and no (or a dead) consumer. `MetadataTypeSchema` + `DEFAULT_METADATA_TYPE_REGISTRY` shrink 30 → 26; `OPS_FILE_SUFFIX_REGEX` drops the four suffixes; the dormant objectql load path that registered QL functions from `type: 'function'` metadata items is removed (`defineStack({ functions })` / plugin `contributes.functions` remain the delivered forms); the metadata-core lockstep enum follows. `external_catalog` stays and is now annotated RUNTIME-CREATED (ADR-0062): its lack of an authoring surface is correct design. The delivered replacements: `hook` / `record_change` flows (trigger), plugin `contributes.routes` + declarative `apis:` (router), `defineStack({ functions })` (function), the plugin/service registry (service). Persisted `sys_metadata` rows are unaffected — no production read path re-parses stored `type` values through the enum.

## 12.1.0

### Patch Changes

- 93e6d02: Docs: correct the `Field.relatedList` JSDoc + `.describe()` to match the shipped behavior (#2579 follow-up). Non-primary related lists stack under a single shared "Related" tab and only `'primary'` earns its own tab — there is no count-based auto-split (the "count-aware" wording was a stale draft). Comment/description only; no code or behavior change.

## 12.0.0

### Major Changes

- 7c09621: feat(security)!: `api.requireAuth` now defaults to `true` — anonymous access to the data API is denied by default (ADR-0056 D2 flip)

  **BREAKING.** The global `requireAuth` default flipped FROM `false` TO `true`
  (`RestApiConfigSchema.requireAuth` in `@objectstack/spec`, mirrored by
  `RestServer.normalizeConfig` in `@objectstack/rest`). Anonymous requests to
  the `/data/*` CRUD + batch endpoints are now rejected with HTTP 401 unless the
  deployment explicitly opts out. (Scope note: this gate covers the REST
  `/data/*` surface — the metadata read/write endpoints and the dispatcher
  GraphQL route have their own pre-existing anonymous posture, tracked
  separately; this flip does not change them.)

  **Migration (one line):** a deployment that intentionally serves data publicly
  (demo / playground / kiosk) sets the flag on the stack config — now a declared
  `ObjectStackDefinitionSchema.api` field, so it survives `defineStack` strict
  parsing (previously an undeclared top-level `api` key was silently stripped):

  ```ts
  export default defineStack({
    // …
    api: { requireAuth: false },
  });
  ```

  The REST plugin logs a boot warning for the explicit opt-out so a fail-open
  posture is always visible. A misplaced `api.requireAuth` at the plugin level
  (one nesting short) is now also called out with a boot warning instead of
  being silently ignored.

  **What keeps working with no action:**

  - **Share links** — validate their token, then read under a system context.
  - **Public forms** — self-authorizing via the declaration-derived
    `publicFormGrant` (create + read-back on the declared target object only);
    no `guest_portal` profile needed.
  - **Control plane** — `/auth`, `/health`, `/discovery` are exempt.
  - **`objectstack serve` with an auth-less stack** — the CLI passes an explicit
    `requireAuth: false` for stacks whose tier set has no `auth` (nothing could
    authenticate against them), with the boot warning.

### Minor Changes

- a8df396: feat(spec,lint): adaptive record surface + semantic field `span` for field-heavy objects (#2578)

  Field-heavy objects need two things the protocol did not express well: multi-column
  forms, and opening create/edit/detail as a full page rather than a cramped popup —
  for _some_ objects, automatically. Because all metadata is AI-authored, the design
  goal is to make AI unable to get it wrong, which reshaped both features away from
  new authored keys.

  **`deriveRecordSurface` (new spec derivation, ADR-0085 §5).** A record's default
  surface — full `page` vs `drawer`/`modal` overlay — is _derived_ from how heavy the
  record is (visible, non-system field count; mobile always pages), not authored. Per
  ADR-0085 §2's admission test a `recordSurface` object key would fail: field count is
  exactly the kind of fact a machine can infer, and modal-vs-page is pure
  re-arrangement, not a business fact. So there is **no new object key** and **no new
  ADR** — just a single shared derivation renderers consume as a default (an explicit
  form/navigation config still wins), plus a one-line clarification to ADR-0085 §2's
  rejected-keys list so `recordSurface` is not re-proposed. Explicit per-object control
  remains the sanctioned assigned-page path.

  **`FormField.span: 'auto' | 'full'` (new, replaces absolute `colSpan` as the
  primary primitive).** Under a per-surface derived column count (mobile 1 / modal 2 /
  page 3-4) an absolute `colSpan: 3` only lines up at the one width the author
  imagined — fragile by construction. The relative `span` is decoupled from the column
  count: `auto` (default; omit it) sizes by widget type × current columns, `full` takes
  the whole row at any count. `colSpan` is retained for back-compat and clamped by the
  renderer; `half` was considered and deferred (weakest AI-safety). The rationale lives
  here rather than in a new ADR, per the fewer-ADRs convention.

  **`validateFormLayout` (new lint, ADR-0078/0019).** Two advisory rules over authored
  form views: `form-field-unknown` (a section references a field not on the bound
  object — silently never renders) and `absolute-colspan-discouraged` (steers authors
  to `span: 'full'`). Both warnings, with fix hints, held to the same bar for AI and
  hand authors.

  **`NavigationConfig.size` (new) replaces pixel `width`.** A T-shirt bucket
  (`auto`/sm/md/lg/xl/full, default `auto`, aligned with `FormView.modalSize`) for a
  drawer/modal detail overlay. `width`/`drawerWidth` (pixel) are deprecated: a pixel
  width cannot be authored blind — the author (often an AI) does not know the client
  viewport. `auto` means the renderer derives the size from field count and clamps to
  the viewport, so AI writes nothing.

  All additive: no exports removed, no behavior change for existing metadata.

- e695fe0: feat(spec,lint): reject userFilters on object list views (ADR-0053 phase 4)

  ADR-0053 reserves `userFilters`/`quickFilters` for page lists ("filters" mode);
  on an object list view ("views" mode — where the `ViewTabBar` is the only nav
  control) they are silently dropped. This lands the phase-4 guardrail as a
  layered defence, so the wrong-context authoring mistake is caught without
  breaking existing metadata:

  - **Type-level (author time):** new `ObjectListViewSchema` = `ListViewSchema`
    minus `userFilters`. Object built-in `listViews` and `defineView`
    `list`/`listViews` now use it, so `userFilters` on an object list view is a
    `tsc` error. The full `ListViewSchema` (page "filters" mode) is untouched.
  - **Runtime (back-compat):** the field is STRIPPED at parse (default strip, no
    throw), so existing metadata keeps loading — `ObjectSchema.parse` never fails
    on a stray `userFilters`.
  - **Author/CI (actionable):** new `@objectstack/lint` rule
    `validateListViewMode`, wired into `os validate`, reports the wrong-context
    field PRE-parse (before the schema strips it) with a fix hint.

  Closes the schema half of objectui #2219; supersedes the interim runtime warn in
  objectui #2220.

- 7709db4: feat(security): permission-set package provenance + declared-permission seeding (ADR-0086 P1)

  Packages now ship working default access for their own objects, with a
  machine-checkable metadata↔config boundary:

  - **Spec (ADR-0086 D3)**: `PermissionSetSchema.packageId` (owning package for
    a package-shipped set; absent = env-authored) and per-record provenance
    `managedBy: 'package' | 'platform' | 'user'` on the existing
    metadata-persistence axis. Persisted on `sys_permission_set` as
    `package_id` / `managed_by` (new columns + `package_id` index).
  - **Seeding (ADR-0086 D5)**: new `bootstrapDeclaredPermissions` — the sibling
    of `bootstrapDeclaredRoles` — materializes `stack.permissions` into
    `sys_permission_set` at boot with `managed_by:'package'` + `package_id`.
    Idempotent and upgrade-aware: rows the seeder owns are re-seeded to the
    shipped declaration on every boot; rows owned by a different package are
    refused loudly; env-authored `platform`/`user`/legacy rows are never
    clobbered. Closes the ADR-0078 inert-metadata violation for
    `stack.permissions` (declared sets were runtime-enforced but never
    materialized — invisible to the admin surface, uninstall undefined).
  - Conformance matrix row `declarative-permission-seeding` (ADR-0056 D10) +
    dogfood proof pin the behavior so it cannot regress to inert.

- 2082109: Detail-page related lists: `relatedList: 'primary'` prominence + optional related-list columns (#2579).

  `Field.relatedList` on a child's `lookup`/`master_detail` FK becomes a tri-state
  `boolean | 'primary'`. `'primary'` marks a CORE relationship — a prominence hint
  (ADR-0085), not a layout switch — that the detail page promotes to its own tab,
  while non-primary children collapse into a single shared "Related" tab.
  `false`/`true` keep their meaning (suppress / show in the derived default), so
  the change is additive and opt-in per relationship (no primary anywhere → the
  detail page is byte-for-byte the legacy stacked default).

  `RecordRelatedListProps.columns` becomes optional: when omitted the related list
  derives its columns from the child object's `highlightFields` / default list
  columns — a related list is just another surface that lists that object.
  Required → optional is back-compat.

  Renderer + derivation changes ship in objectui: `relatedList: 'primary'` → own
  tab; one related list per eligible FK (a child that references the parent
  through several relationships now surfaces each, previously only the first);
  self-referential relationships (hierarchies) surface a "child" list; and the
  lookup-picker default columns are unified onto the same `highlightFields`
  source so a picker and a related list of the same object agree with zero
  per-surface config.

- 069c205: Add a build-time view-reference lint that fails `os compile` on a broken form-view reference, and surfaces the previously-silent `_2` rename collision as a warning (#2554).

  `expandViewContainer` gains a behaviour-preserving companion `expandViewContainerWithDiagnostics` that also reports every `<object>.<key>` name collision. List and form views share one namespace during expansion, and the default `list` implicitly claims `<object>.default`; a colliding key was previously renamed to `<object>.<key>_2` **silently**, so references (form action `target`s, navigation `viewName`s) resolved to the _other_ view.

  The new `lint-view-refs` build lint consumes those diagnostics with a broken/fragile severity split, tuned so an upgrade does NOT break existing apps that merely have a colliding key:

  - **view-ref-form-target-kind** — ERROR (fails the build): a `type:'form'` action whose `target` resolves to an existing LIST view — the concrete #2554 breakage (a blank form, a silently no-op submit). High-confidence, so it fails.
  - **view-key-collision** — WARNING: a key silently renamed on collision. Fragile, not broken — it breaks something only if the requested name is referenced — so it warns.
  - **view-ref-form-target-missing** — WARNING: a form target resolving to no view; probably a typo, but possibly a view the lint failed to collect, so it warns rather than risk a false-positive build failure.

  This shifts objectui's runtime `viewKind` guard left to compile time: the author — very often an AI generating templates — discovers the mistake on `os compile` instead of when an end user clicks. It mirrors the existing broken/fragile two-level authoring lints (flow-patterns, autonumber, liveness). `expandViewContainer`'s runtime behaviour is unchanged; the fix is diagnostics-only plus the build gate.

### Patch Changes

- 7c09621: feat(security): pre-map `transfer`/`restore`/`purge` to their RBAC bits (#1883)

  The permission evaluator now maps the destructive record-lifecycle operations
  to their spec permission bits (`transfer` → `allowTransfer`, `restore` →
  `allowRestore`, `purge` → `allowPurge`) and extends the `modifyAllRecords`
  super-user bypass to cover them. The ObjectQL operations themselves are still
  roadmap M2 — but the gate now exists ahead of them: the moment such an
  operation is dispatched through the security middleware it is denied unless a
  resolved permission set grants the matching bit. Unmapped destructive
  operations continue to fail closed (ADR-0049). Spec descriptions updated from
  `[EXPERIMENTAL — not enforced]` to `[RBAC-gated; operation pending M2]`.

- 9860de4: Surface view-key collisions during view container expansion instead of renaming silently.

  `expandViewContainer` keeps its backward-compatible rename behaviour (`<object>.<key>` →
  `<object>.<key>_2` on collision) but now stamps a machine-readable
  `_diagnostics.warnings` entry on the renamed `ExpandedViewItem`, explaining that
  references targeting the requested name (form action targets, navigation `viewName`s)
  will resolve to the _other_ view. Both flattening loaders — the ObjectQL engine and the
  MetadataPlugin — log these warnings at boot so the collision is visible instead of
  manifesting as a form action opening a list view (#2554).

## 11.10.0

### Minor Changes

- 6a9397e: Retire the deprecated `compactLayout` alias for `highlightFields` (framework#2536, closes the ADR-0085 deprecation window).

  - `ObjectSchema` no longer declares `compactLayout`: `create()` rejects it like any unknown key; lenient `parse()` strips it (no silent aliasing).
  - The parse-time alias AND the `highlightFields → compactLayout` back-fill transition mirror are removed from `normalizeSemanticRoleAliases`. Served metadata now carries the canonical key only.
  - All remaining first-party authors (27 system objects across plugin-audit / approvals / security / sharing / webhooks / service-storage / automation / messaging / realtime — missed by the #2521 sweep, caught by the type gate) renamed to `highlightFields`.
  - The downstream smoke pin moves to hotcrm v1.2.2 (hotcrm#424: same rename + deps ^11.7.0).
  - Consumers were switched in objectui#2168 and shipped via the console pin bump (#2526); this closes the window scheduled there. The dogfood mirror assertion (#2528) flips to `compactLayout: undefined` in this same change, per the plan it carried.

  Version note: minor, not major — the key was deprecated-with-alias for a full release window, all first-party consumers/authors are migrated, and the spec api-surface gate reports no export changes (same documented-exception path as the ADR-0085 removals in 11.7.0). External metadata still authoring `compactLayout` will now fail `create()` loudly with the standard unknown-key error naming the key.

- c0efe5d: Upgrade path for retired spec keys — the error IS the guide:

  - **Tombstone entries** in `UNKNOWN_KEY_GUIDANCE`: `create()` rejecting a retired key (`compactLayout`, the `detail` block, object-level `views`, `defaultDetailForm`) now names the replacement, the version/decision that removed it, and the one-line fix — instead of a bare unknown-key error. Tombstones age out ~two majors after the removal.
  - **`CHANGELOG.md` now ships inside the npm package** (`files` allowlist): every breaking entry's migration notes travel with the exact version installed, greppable offline from `node_modules/@objectstack/spec/CHANGELOG.md`.
  - **`llms.txt` gains an "Upgrading Across Spec Versions" section** teaching agents the two-step protocol: read the tombstone, then grep the shipped CHANGELOG — and never to re-add rejected keys or downgrade to silence errors.

## 11.9.0

### Patch Changes

- d3595d9: Clean up two stale code-side doc remnants found during the ADR-0085 docs sweep (#2529):

  - `RecordDetailsProps` (ui/component.zod.ts) `layout`/`fields` descriptions taught the
    deprecated `compactLayout` name — now teach the ADR-0085 canonical `highlightFields`
    (`compactLayout` remains a supported alias). Regenerated
    `skills/objectstack-ui/{contracts/react-blocks.contract.json,references/react-blocks.md}`.
  - Removed an orphaned JSDoc block in data/object.zod.ts describing `defaultDetailForm`,
    a prop that was never implemented and was removed from the spec in #2402.

  Doc-text only; no schema shape or behavior change.

## 11.8.0

## 11.7.0

### Minor Changes

- 5178906: ADR-0085: object presentation intent is declared as cross-surface semantic
  roles, never as per-surface hint blocks.

  **@objectstack/spec**

  - New top-level `stageField: string | false` — names the object's linear
    lifecycle field (`false` declares the status-like field non-linear and
    suppresses every consumer's stage heuristics). Legitimizes the key the UI
    runtime already read but the schema rejected.
  - `compactLayout` → **`highlightFields`** (the value is an ordered field
    list, not a layout; "highlight" is already the renderer-side term of art).
    `compactLayout` stays accepted as a parse-time alias and is preserved on
    output — the ADR-0079 `displayNameField → nameField` pattern.
  - `fieldGroups[].collapse: 'none' | 'expanded' | 'collapsed'` replaces
    `defaultExpanded` AND the UI-dialect `collapsible`/`collapsed` boolean pair
    (which had drifted two ways: spec declared a key no renderer read, renderers
    read keys the spec rejected). Old keys map onto the enum at parse and remain
    accepted for one minor.
  - `fieldGroups[].visibleOn` removed (no consumer anywhere — ADR-0049
    enforce-or-remove; re-add together with its enforcement when a surface
    evaluates it).
  - The `detail: { … }.passthrough()` UI-hints block is **removed**. Every key
    in it was either unauthorable, a proven no-op for spec authors
    (`hideReferenceRail` — the rail is default-off and its enabling key was
    never typed), or a per-page toggle that belongs to an assigned Page. Zero
    authors existed across framework and objectui (evidence in ADR-0085); the
    removal ships as a minor under the documented dead-surface exception
    (PR #2272 precedent).
  - New `deriveFieldGroupLayout(def)` in `@objectstack/spec/data` — the single
    source of the fieldGroups rendering semantics (declared order, empty groups
    dropped, ungrouped trailing bucket minus audit/system fields, collapse
    passthrough incl. deprecated aliases). UI renderers consume this instead of
    their two pre-existing near-identical local copies.

  **@objectstack/lint / @objectstack/cli**

  - New `validateSemanticRoles` (wired into `os lint`): warns on
    `Field.group` → undeclared group, declared-but-unreferenced groups, and
    `stageField`/`highlightFields` entries naming non-existent fields — the
    dangling-pointer shapes that are Zod-valid but silently inert at render
    time (ADR-0078 completeness gate).

  **@objectstack/platform-objects**

  - All 35 system objects renamed `compactLayout:` → `highlightFields:`
    (behaviour unchanged via the alias).

## 11.6.0

## 11.5.0

### Minor Changes

- 6ee4f04: Complete the FormView protocol with the form-presentation options the ObjectForm
  component already accepts (conformance follow-up). FormViewSchema gains optional
  `layout`, `columns`, `title`, `description`, `defaultTab`, `tabPosition`,
  `allowSkip`, `showStepIndicator`, `splitDirection`, `splitSize`, `splitResizable`,
  `drawerSide`, `drawerWidth`, `modalSize` — the per-`type` (tabbed/wizard/split/
  drawer/modal) presentation config. The spec↔frontend conformance check went from
  14 frontend-only → 0 for object-form; the react-tier contract now sources these
  from the spec (with descriptions) instead of a hand-authored overlay.
- c1e3a65: Add the react-tier component contract index (`REACT_BLOCKS`, ADR-0081):
  `packages/spec/src/ui/react-blocks.ts` maps each curated public block injected
  into `kind:'react'` page source to the **spec zod schema** that defines its
  declarative config props (FormView, ListView, RecordDetails/Highlights/
  RelatedList/Path, Chart) plus a hand-authored React-interaction overlay
  (binding/controlled/callback — objectName, recordId, mode, onSuccess,
  onRowClick, …). `pnpm --filter @objectstack/spec gen:react-blocks` generates the
  AI-facing contract (skills/objectstack-ui/references/react-blocks.md + .json)
  from it — the `data` props come from the spec (single source, no re-authoring).

## 11.4.0

### Minor Changes

- 5821c51: ADR-0081: split the AI page-authoring surface into honest tiers.

  - `PageSchema.kind` gains `'html'` and `'react'`. `'html'` is the constrained
    parse-never-execute tier (the renamed `'jsx'`, kept as a deprecated alias);
    `'react'` is the real-React tier (executed at render by
    `@object-ui/react-runtime`). It runs author JS, so it is gated by a host
    capability that **defaults ON** (the platform trusts reviewed, draft-gated
    authors) and is disabled **server-side** via the `OS_PAGE_REACT=off`
    env toggle. The completeness gate now requires `source` for all three kinds.
  - `@objectstack/cli` console serving injects the disable global into the served
    HTML when `OS_PAGE_REACT=off` (read per request, no rebuild).
  - `validate-jsx-pages` lints `html`/`jsx` (constrained parse). A new
    `validate-react-pages` transpiles `react` source with Sucrase (transpile-only,
    never executed) so syntax errors fail at `os build` instead of at render.

### Patch Changes

- a0fce3f: feat(spec): add `userActions.editInline` toggle for inline record editing

  `UserActionsConfigSchema` — the shared toggle set behind both a view's toolbar
  and a page's `interfaceConfig.userActions` — gains `editInline: boolean`
  (default `false`, alongside `addRecordForm`). The runtime already honors it
  (objectui `InterfaceListPage` reads `userActions.editInline` → `inlineEdit`),
  and the metadata-admin "Interface (list pages)" panel — which auto-renders
  these booleans as checkboxes — now exposes an "Edit Inline" toggle. When on,
  cells edit with the field's type-aware widget (the same control the form uses).
  A list stays read-only unless the author opts in.

## 11.3.0

### Minor Changes

- b4a5df0: chore(ai): align framework with Vercel AI SDK v7 and stop bundling provider SDKs

  AI runtime capabilities now live in the cloud package (service-ai removed from the
  open edition, ADR-0025 S2). The framework therefore no longer ships any `@ai-sdk/*`
  provider SDK:

  - `@objectstack/cli` drops the dead `@ai-sdk/anthropic|gateway|google|openai`
    dependencies (zero usages in `cli/src` — they were only bundled so the old
    in-tree `service-ai` could `require()` them at runtime). Apps that boot the
    closed AI now declare the providers themselves (cloud side).
  - `examples/app-todo` drops the unused `ai` / `@ai-sdk/gateway` devDeps and the
    dead `test:ai*` / `test:agent` / `test:llm` scripts (their test files were
    migrated to cloud).
  - `@objectstack/spec` bumps its `ai` peer/dev dependency from `^6` to `^7`. The
    protocol still re-exports the canonical message/stream types (`ModelMessage`,
    `TextStreamPart`, `ToolSet`, `FinishReason`, …) — all verified present in
    `ai@7`; `ai` stays an OPTIONAL peer so installs are not forced.

  First step of the AI SDK v6→v7 / providers v3→v4 upgrade. Cloud (service-ai
  adapter migration + apps declaring v4 providers) and objectui (chatbot useChat
  v7) follow in their own PRs.

### Patch Changes

- 58e8e31: feat(lint): ADR-0079 record-title gate — deprecate titleFormat + record-title validator

  A record's human title is a structural invariant (ADR-0079): every object
  resolves a primary title from a real STORED field via `nameField` (the
  canonical pointer; `displayNameField` is the deprecated alias) or a
  deterministic derivation. This adds build-time diagnostics so `os build` /
  `os lint`, the MCP authoring surface, and hand-authoring all get the coverage
  cloud graph-lint already has (the ADR-0078 "not cloud-only" principle):

  - `title-format-retired` — flags an object that declares a `titleFormat`. That
    key is a render-only template the server can neither return nor query;
    ADR-0079 retires it in favour of `nameField`. The schema still parses it
    (existing metadata keeps loading), so this is advisory, not an error.
  - `title-unresolvable` — flags an object whose title cannot be resolved from any
    stored field (`objectTitleCompleteness` reports `status: 'none'`).

  `@objectstack/spec` carries the `titleFormat` `.describe()` deprecation note;
  the `@objectstack/cli` `lint` command wires the new validator into its run.

## 11.2.0

### Minor Changes

- d0f4b13: Segment `ObjectStackProtocol` into per-domain protocol interfaces (ADR-0076 D9)

  `ObjectStackProtocol` was a single 70-method interface spanning 11 unrelated domains. It is now the **composition** of focused per-domain contracts — `DataProtocol`, `MetadataProtocol`, `AnalyticsProtocol`, `AutomationProtocol`, `PackageProtocol`, `ViewProtocol`, `PermissionProtocol`, `WorkflowProtocol`, `RealtimeProtocol`, `NotificationProtocol`, `AiProtocol`, `I18nProtocol`, `FeedProtocol` — all newly exported.

  `ObjectStackProtocol` now `extends` all of them and is **shape-identical** to the previous flat interface, so every existing implementation/consumer is unaffected (non-breaking). New code should depend on the narrowest slice it needs (e.g. `DataProtocol`). Per ADR-0076 D9 (rev.7) the composed union is transitional; capability availability is provided at runtime by the discovery `services` registry.

- 302bdab: ADR-0080: `PageSchema` gains `kind: 'jsx'` + `source` (the authoritative JSX text, compiled to the tree at save time) + `requires`, with a completeness `superRefine` — a jsx page with no source fails loudly (ADR-0078).

## 11.1.0

### Minor Changes

- ecf193f: Add `openIn` to `ActionSchema` — a declarative new-tab control for static `type:'url'` actions.

  Counterpart to objectui issue #2043, which added a first-class `openIn?: 'self' | 'new-tab'`
  field to its public `ActionSchema` and honors it in `ActionRunner.executeUrl` (read with
  priority over the legacy `params.newTab` / external-URL heuristic). Until now
  `@objectstack/spec`'s `ActionSchema` was a plain `z.object(...)` that **stripped** unknown
  keys, so `openIn` written via `defineAction({...})` was silently dropped at build and never
  reached objectui's runtime. Authors (e.g. plan-management) therefore couldn't use it.

  ```ts
  defineAction({
    name: "print_a3",
    label: "打印总表(A3)",
    type: "url",
    target: "/print/a3?id=${record.id}",
    openIn: "new-tab", // now preserved end-to-end
  });
  ```

  - `openIn: 'new-tab'` — open a **static** `target` URL in a new tab. No handler, no pre-open.
  - `openIn: 'self'` — navigate in place.
  - omitted — external/absolute URLs open in a new tab; relative URLs navigate in place.

  Kept distinct from the existing `opensInNewTab` / `newTabUrl` (those pre-open an
  `about:blank` tab synchronously for **async** SSO-redirect handlers — not merged). It is a
  static execution option and must stay OUT of `params` (which is user-input-collection only).

  Consuming projects must upgrade `@objectstack/spec` to this version for the declarative
  new-tab path to work end-to-end.

- 51bec81: Remove a first batch of dead (unenforced, unauthored) metadata properties (#2377, ADR-0049).

  Verified set 0× / read 0× across framework + objectui + cloud + hotcrm + templates, with no test footprint outside `@objectstack/spec`:

  - **field**: `caseSensitive`, `maxRating`
  - **object**: `partitioning` (+ `PartitioningConfigSchema`), `defaultDetailForm`

  Liveness ledgers (field/object) updated; api-surface regenerated (drops `PartitioningConfig`/`PartitioningConfigSchema` only). Folded into the 11 line (`minor`).

  The remaining #2377 candidates are deliberately not in this batch: overloaded names (`tags`/`active`/`versioning`/`dependencies`/`index`/…) need per-occurrence handling, and `softDelete` / `measures.certified` turned out to be set in non-spec test fixtures (analytics, mcp) — both deferred. See the issue for the full split.

- 3e593a7: Remove the deprecated `DriverInterface` type alias — use `IDataDriver` (11.0).

  `DriverInterface` was a `@deprecated` alias of `IDataDriver` (the authoritative
  driver contract). It is removed from `@objectstack/spec/contracts` and
  `@objectstack/core`; `objectql`'s engine now types drivers as `IDataDriver`
  directly (a type-identical change, since the alias _was_ `IDataDriver`).

  Driver authors: replace `DriverInterface` with `IDataDriver` (same shape).

  Note: this is unrelated to the live `IDataEngine` interface (engine-layer
  contract, not deprecated) and to the separate zod-derived `DriverInterface` /
  `DriverInterfaceSchema` in `@objectstack/spec/data` (the runtime driver schema),
  both of which are unchanged.

- 63d5403: Remove the dead `PolicySchema` / `definePolicy` and the stack `policies` collection (#1882, ADR-0049).

  `PolicySchema` (password / network / session / audit "org security policy") was
  **100% unenforced** — no runtime consumer ever read it. Per ADR-0049
  (enforce-or-remove) it is removed rather than implemented:

  - `@objectstack/spec`: delete `security/policy.zod.ts` (`PolicySchema`,
    `Password/Network/Session/AuditPolicySchema`, `definePolicy`); drop the
    `policies` field from the stack schema and the `policies` collection wiring
    (`MAP_SUPPORTED_FIELDS`, `METADATA_ALIASES`).
  - `@objectstack/downstream-contract`: drop the `DcPolicy` fixture/case (the
    contract gate stays green — `SharingRule` / `PermissionSet` are unaffected).
  - Examples (`app-crm`, `app-showcase`): drop their unused policy definitions.

  No migration needed for consumers: `policies` was never enforced. `SharingRule`,
  `PermissionSet`, RLS, and all `*PolicySchema` siblings (retry/retention/RLS/etc.)
  are unrelated and unchanged. Verified: hotcrm + templates have zero Policy-API
  usage; downstream-contract gate green.

## 11.0.0

### Major Changes

- a658523: Open edition is MCP-only.

  The bundled AI authoring service (`@objectstack/service-ai`) is no longer part of
  the open distribution (ADR-0025 S2, #2325); AI now integrates through MCP
  (`@objectstack/mcp`) and the documented opt-in seam — an app that declares
  `@objectstack/service-ai` / `@objectstack/service-ai-studio` still loads the
  service. Removing a published package from the open edition is a breaking change,
  so this cuts the next release as a major.

- 82ff91c: Remove the deprecated `http_request` / `http_call` / `webhook` flow-node aliases — author `http` (ADR-0018 M3).

  ADR-0018 M3 collapsed the divergent outbound-callout verbs onto the canonical
  `http` node and kept the old names as deprecated aliases for back-compat. This
  removes those aliases (the 11.0 cleanup):

  - `http_request` is dropped from `FlowNodeAction` (and therefore
    `FLOW_BUILTIN_NODE_TYPES`); authoring it now fails fast at parse instead of
    resolving to `http`.
  - `AutomationEngine` no longer registers the `http_request` / `http_call` /
    `webhook` node aliases; only `http` is registered.
  - The flow-builder palette offers `http`.

  **Breaking.** Flows / workflow rules / approval actions that still use the old
  node type must switch to `type: 'http'` (behavior is identical — durable outbox
  when `config.durable`, inline fetch otherwise). The trigger `eventType: 'webhook'`
  and the `webhook` resume event are unaffected — only the HTTP _node_ aliases are
  removed. First-party examples (showcase, app-crm) are migrated.

- 638f472: Remove the deprecated `IUIService` contract (use `IMetadataService`) — 11.0.

  `IUIService` (spec `contracts/ui-service.ts`) was superseded by `IMetadataService`
  (views/dashboards are metadata: `metadata.get('view', …)` / `register(…)`). This
  removes the dead interface and its dev stub:

  - spec: delete `contracts/ui-service.ts` + its barrel export.
  - plugin-dev: drop the bespoke `ui` dev stub (`createUIStub`). `'ui'` remains a
    `CoreServiceName`, so dev mode still registers a generic stub for it via the
    fallback path; only the obsolete view/dashboard methods are gone.

  Use `IMetadataService` for view/dashboard CRUD.

### Minor Changes

- ab5718a: Auth: reject breached passwords via Have I Been Pwned (ADR-0069 D1, P1)

  First slice of ADR-0069 (enterprise authentication hardening) and the enforcement-wired pattern template the rest of the ADR follows. Adds a `password_reject_breached` auth setting (default **off**) bound end-to-end to better-auth's native `haveibeenpwned` plugin — a k-anonymity range check on sign-up / change-password / reset-password (the plaintext password never leaves the process).

  - **spec**: new `passwordRejectBreached` flag on `AuthPluginConfigSchema`.
  - **service-settings**: new "Reject breached passwords" toggle in the `auth` manifest's password-policy group (`global` scope, `manage_platform_settings`).
  - **plugin-auth**: `bindAuthSettings` maps the setting into the plugin config; `buildPluginList` gates and mounts the `haveIBeenPwned` plugin (env `OS_AUTH_PASSWORD_REJECT_BREACHED` wins over config, mirroring `OS_AUTH_TWO_FACTOR`).
  - **cli**: surface the knob in the `serve` boot config alongside `twoFactor`.

  Default-off and additive — no behavior change on upgrade. Per ADR-0049 the toggle ships with its enforcement (no false surface). No new identity fields (the `[custom]` D1 items — complexity / expiry / history — land in follow-up PRs).

- 4845c12: feat(cli): make the AI service opt-in via a declared dependency; honor `config.tiers`

  **AI edition boundary (cli).** The CLI auto-registered the headless `AIServicePlugin`
  whenever the `ai` tier was enabled (default) and `@objectstack/service-ai` was
  merely _resolvable_. In a workspace/monorepo the package is hoist-resolvable even
  when an app does not declare it, so every app got the AI service — discovery
  reported `services.ai: available` and the agent runtime served any
  metadata-defined agents — including Community-Edition apps that ship no AI.

  Now the _declared_ dependency is the boundary: AIService auto-registers only when
  the host app declares `@objectstack/service-ai` **or** `@objectstack/service-ai-studio`
  (Studio attaches its personas via the base service's `ai:ready` hook, so declaring
  Studio implies the base). A CE app that declares neither gets no AI service, no
  agents, and `services.ai: { enabled: false, status: 'unavailable' }` in discovery
  (so the console hides its AI surface). MCP and every other capability are
  unaffected. The `app-showcase`/`app-crm` examples now declare `@objectstack/service-ai`.

  **`config.tiers` now honored (spec).** `ObjectStackDefinitionSchema` gains a `tiers`
  field, so `defineStack` no longer strips it. `config.tiers` (e.g. a list WITHOUT
  `ai`) now actually overrides the `--preset` default — previously it was silently
  dropped by schema validation, making the `--preset` help text inaccurate. This is
  a second, in-place way to disable AI for a deployment without touching dependencies.

- 715d667: feat(spec): dataset authoring form + derived measures without a dummy aggregate

  `dataset` was the only UI-authorable metadata type without a `defineForm`
  layout, so Studio's create surface fell back to the auto-generated flat layout
  (free-text `object`, no grouping). Adds `dataset.form.ts` (registered in
  `METADATA_FORM_REGISTRY`): sectioned Basics / Source / Dimensions / Measures
  with an `object` picker (`ref:object`) and guidance — matching the sibling
  `report` editor.

  Also makes `DatasetMeasureSchema.aggregate` optional. A derived measure
  (`derived: { op, of }`) combines other measures by name and `aggregate` is
  ignored for it at compile time, but the schema still required it — so a derived
  measure failed validation unless you added a meaningless aggregate. `aggregate`
  is now required only for non-derived measures (enforced in the existing
  `superRefine`). Backward compatible: existing measures that carry an aggregate
  stay valid.

- 5eef4cf: feat(analytics): multi-hop relationship joins for datasets (ADR-0071)

  A dataset's `include` and dimension/measure `field` paths may now traverse up to
  3 to-one relationship hops (`account.owner.region`), not just one. The compiler
  expands each declared path into the ordered join chain (one `cube.join` per path
  prefix, aliased dot-free as `account__owner` so it stays a single valid SQL
  identifier), and the NativeSQLStrategy emits the chained `LEFT JOIN`s. Per-hop
  tenant/RLS read-scope is enforced for EVERY object in the chain — the
  alias-driven scope loop already generalizes, so no security path is rewritten.

  Restricted to **to-one** (lookup / master_detail) relationships, which never fan
  out — aggregates stay correct with no symmetric-aggregate machinery; to-many
  traversal is out of scope. Single-hop datasets are byte-for-byte unchanged (the
  dot-free alias is a no-op for a single segment). Undeclared paths are still
  rejected (ADR-0021 D-C); paths beyond 3 hops are rejected at both parse and
  compile time.

- 6c4fbd9: fix(security): enforce flow `runAs` execution identity (#1888)

  The `service-automation` engine now honors `flow.runAs` instead of ignoring it.
  Previously the CRUD nodes passed **no identity** to ObjectQL, so the security
  middleware was skipped entirely — every flow ran effectively elevated regardless
  of `runAs`. A `runAs:'user'` flow did **not** de-elevate (a privilege-boundary
  surprise), and `runAs:'system'` did not _explicitly_ elevate.

  The engine now establishes the run's data-layer identity at setup and restores
  the caller's context afterward:

  - **`runAs:'system'`** → an elevated, RLS-bypassing system principal
    (`{ isSystem: true }`): the run can read/write records the triggering user
    cannot.
  - **`runAs:'user'`** (default) → the **triggering user's** identity
    (`{ userId, roles, permissions, tenantId }`): CRUD nodes' ObjectQL reads/writes
    respect that user's row-level security, and the run can never exceed the
    triggering user's grants.

  To keep `runAs:'user'` faithful to a direct request by that user, the REST
  trigger route (`@objectstack/runtime`) and the record-change trigger
  (`@objectstack/trigger-record-change`) now forward the caller's resolved
  `roles`/`tenantId` into the `AutomationContext` (new optional fields), not just
  `userId`. The new `resolveRunDataContext` helper is the single place that maps a
  run's effective `runAs` to the ObjectQL context, shared by every data node.

  The `[EXPERIMENTAL — not enforced]` marker is removed from `FlowSchema.runAs`.

  **Behavior change / migration.** Flows that previously relied on the implicit
  elevation (the default `runAs:'user'` ran unscoped) now run as the triggering
  user and are subject to their RLS. **Declare `runAs:'system'` on any flow that
  must read or write beyond the triggering user's access** (e.g. system
  automations, cross-owner roll-ups). Schedule-triggered runs have no trigger user;
  under `user` they stay unscoped (there is no identity to scope to) — declare
  `system` to make elevation explicit.

  Proven both directions by the dogfood regression gate
  (`flow-runas.dogfood.test.ts` — a restricted member triggers system vs user
  flows against an owner-scoped record) and service-automation unit + regression
  tests (`crud-runas.test.ts`).

- ef3ed67: Formula field typing: `inferExpressionType()` + a declared `returnType`.

  - `@objectstack/formula`: new `inferExpressionType()` (and lower-level `inferCelType()`) surfaces the cel-js type-checker's result for a CEL value/formula expression, mapped to `number | text | boolean | date | unknown`. Conservative — two `dyn` operands stay `unknown`; typed literals/stdlib returns pin a concrete type.
  - `@objectstack/spec`: `FieldSchema` gains an optional `returnType` (`number|text|boolean|date`) so a formula field can carry its declared value type (the way Salesforce/Airtable do), letting consumers (dataset measures, formatting, validation) read a declared type instead of re-parsing the expression.

- cd51229: Expose authoritative create seeds via /meta/types (spec-derived create-shape contract, Phase 2)

  The minimal valid create seeds added in `@objectstack/spec/kernel` (`getMetadataCreateSeed`) now reach consumers through the real `/meta/types` registry response: each entry carries an optional `createSeed`. The Studio designer / CLI / API clients derive their create defaults from this single source of truth instead of re-inventing them — closing the drift that produced the dashboard-`layout` and action-`body` create→save 422s.

  - `@objectstack/spec`: barrel-export `getMetadataCreateSeed` / `listMetadataCreateSeedTypes` from `/kernel`; add optional `createSeed` to the `GetMetaTypesResponse` entry schema.
  - `@objectstack/objectql`: `getMetaTypes()` attaches each type's seed (registry + runtime entries). Canvas-create types whose shape is built interactively (report) are intentionally absent.

- 7697a0e: chore(spec): hard-remove the dead `blank`/`record_review` page config (enforce-or-remove)

  Completes the enforce-or-remove started in framework#2265. The `blank` and
  `record_review` page types were already removed from `PageTypeSchema` (no
  renderer), their fields marked `@deprecated`, and objectui dropped all
  references (objectui#1949). This deletes the now-unreachable surface:

  - `BlankPageLayoutSchema`, `BlankPageLayoutItemSchema`, `RecordReviewConfigSchema`
    (and their inferred types `BlankPageLayout`, `BlankPageLayoutItem`,
    `RecordReviewConfig`).
  - The `blankLayout` and `recordReview` fields on `PageSchema`.
  - `page-builder.zod.ts` (the `blank`-type drag-drop canvas config:
    `PageBuilderConfigSchema` / `CanvasSnapSettingsSchema` / `CanvasZoomSettingsSchema`
    / `ElementPaletteItemSchema` / `InterfaceBuilderConfigSchema` and their types)
    and its `@objectstack/spec/studio` re-exports — nothing consumed them.

  The `page` liveness ledger drops to 15 properties (the 2 `dead` entries are gone).
  No consumers in framework or objectui (objectui#1949 already merged).

  **Version note (kept `minor`, not `major`).** These exports shipped in the
  published `10.3.0`, so under ADR-0059 §4 (the freeze contract) a removal would
  normally demand a major bump. It is kept `minor` as a deliberate, documented
  exception: the removed symbols are config schemas for the renderless
  `blank`/`record_review` page types — authoring those already failed at runtime
  ("Unknown component type"), the frozen `@objectstack/downstream-contract`
  fixture never referenced them, and the pre-publish hotcrm live gate guards
  against any real consumer break. The `api-surface.json` snapshot is regenerated
  alongside this so the removal is acknowledged, not silent.

- cfd5ac4: fix(spec): remove unrendered roadmap page types from PageTypeSchema (enforce-or-remove)

  `PageTypeSchema` advertised six page types that never shipped a renderer —
  `dashboard`, `form`, `record_detail`, `record_review`, `overview`, `blank`.
  Authoring one passed schema validation but broke at runtime ("Unknown component
  type"), a false affordance that's especially dangerous when templates are
  AI-authored. Per ADR-0049 (enforce-or-remove), the enum is now the _live_ set
  (`record`, `home`, `app`, `utility`, `list`) — authoring a removed type now
  fails fast at parse instead of silently at render. The removed types are tracked
  in the new `PAGE_TYPE_ROADMAP` export and re-enter the enum only when a renderer
  ships. A `page-type-liveness` gate test asserts the enum never re-grows a
  roadmap type.

  The `recordReview`/`blankLayout` config schemas and fields are retained but
  `@deprecated` (their page types are no longer authorizable) to avoid breaking
  downstream imports; they will be removed in a coordinated follow-up. The
  `variables` page field is documented `@experimental` — its state container is
  wired but no consumer reads/writes it end-to-end yet.

- 5c4a8c8: feat(spec): RecordRelatedListProps.add — add-existing-via-picker (generic m2m/junction assignment). A related list can now link existing records via a picker, not just create+navigate. Powers a generic "Assigned Users" / Manage Assignments UI on permission sets.
- 3afaeed: feat(ui): add `element:text_input` — free-text data-entry element for SDUI pages

  SDUI pages could display and navigate but not collect free-text input. This adds
  that half of the contract:

  - `ElementTextInputPropsSchema` (label, placeholder, `inputType` —
    text/email/number/tel/url/password — defaultValue, required, disabled,
    description) wired into `PageComponentType` and `ComponentPropsMap` as
    `element:text_input`.

  The objectui renderer binds the typed value into a page variable
  (`PageVariableSchema.source`); a submit `element:button` reads it back via
  `{{page.<var>}}` token interpolation in the console action runtime. Showcase:
  `showcase_contact_form` (text inputs → page variables → POST web-to-lead).

- 3d04e06: Add authoritative per-type create seeds (root-cause for the "designer shape ≠ spec" family)

  New `metadata-create-seeds.ts`: a single source of truth for the minimal valid create shape of each metadata type (`getMetadataCreateSeed(type)`), co-located with the schemas and asserted valid against each type's schema by `metadata-create-seeds.test.ts`. This anchors the create-form's default shape to the spec so it can't drift — the root cause of the recurring family where a freshly-created item (dashboard without `layout`, script action without `body`, report with stale `objectName`/`columns`) failed validation on save (422) yet passed every other gate. Seeds the 9 core Studio-designer types (dashboard, action, page, view, flow, validation, hook, dataset, object); the test surfaces remaining schema-backed types still needing a seed. (Follow-up: expose `createSeed` via `/meta/types` so the Studio designer consumes it instead of hardcoding `createDefaults`.)

- d980f0d: feat: add a first-class `user` field type (person picker)

  A new `user` field type — the equivalent of Airtable's Collaborator / Notion's
  Person / Salesforce's `Lookup(User)`. Authored as `Field.user({ ... })`; use
  `{ multiple: true }` for collaborators/watchers and `{ defaultValue: 'current_user' }`
  to auto-fill the acting user on create.

  **Why a distinct type rather than telling authors to `Field.lookup('sys_user')`:**
  selecting a person is table-stakes, but the value is in _modelling
  discoverability_ — a "User" entry in the Studio/AI field palette instead of
  requiring authors (and AI) to know to reference the internal `sys_user` system
  object — plus `current_user` defaults and a user-search picker. Storage and
  runtime are unchanged.

  **Deliberately NOT a new storage primitive.** `user` is a _semantic
  specialization of `lookup`_ with the target fixed to `sys_user`: it shares the
  exact lookup code path — same FK string column (`multiple` ⇒ JSON), same
  `$expand` resolution, same indexing — so referential integrity and fresh display
  names come for free, and nothing is re-implemented. An existing
  `Field.lookup('sys_user')` is therefore equivalent at the storage layer (zero
  data migration to adopt `Field.user`).

  Ownership semantics are **unchanged**: the existing `owner_id` convention +
  `plugin-security` auto-stamp/RLS still apply. A declarative `owner` flag is a
  possible future follow-up; intentionally not added here to avoid a second
  field type for what is a system role (rationale: keep the `FieldType` surface
  lean — see related ADR-0059 freeze discipline).

  Changes: `FieldType` gains `'user'` + `Field.user()` builder; the SQL/Mongo
  drivers treat `user` exactly like `lookup`; the engine resolves `$expand` for
  `user` fields and honours a new `defaultValue: 'current_user'` token (resolved
  app-side from the execution context, mirroring the `NOW()` convention); kanban
  group-by and symbolic seed references accept `user`; approvals enrich `user`
  references. The public API surface is unchanged (additive enum member).

### Patch Changes

- c1a754a: feat(spec): type ChartConfig `colors` as a palette OR a value→color map

  `ChartConfigSchema.colors` now accepts either a positional palette (`string[]`)
  or an explicit value→color map (`Record<value, color>`, kanban-style). A
  value→color map — and a select/lookup dimension's option colors — take
  precedence over the positional palette per category, so semantic charts
  (health, status) paint their own colors instead of the generic palette.

- 6fbe91f: fix(spec): make dashboard widget `layout` optional (auto-flowed when omitted)

  `DashboardWidgetSchema.layout` was required, but the entire runtime treats it as
  optional: the renderer (`DashboardGridLayout`) auto-flows any widget without a
  layout (`x: (i % 4) * 3, y: ⌊i/4⌋ * 4, w: 3, h: 4`), and the Studio dashboard
  designer adds widgets **without** a layout by design.

  The mismatch meant every dashboard authored in the Studio designer failed spec
  validation the moment a widget was added — the draft `PUT /meta/dashboard/...`
  returned **422** ("widgets: Invalid type: expected object, received undefined"),
  so the draft never saved and **Publish stayed disabled**, even though the widget
  rendered correctly in the canvas. Found by dogfooding the dashboard designer in
  the browser.

  `layout` is now optional; absence means "auto-place". Authors may still pin an
  explicit grid position. Backward-compatible — existing dashboards that specify
  `layout` are unaffected.

- 72759e1: feat(spec): add the `back` edge style to the flow-builder canvas protocol

  `FlowCanvasEdgeStyleSchema` gains a `back` value alongside `solid`/`dashed`/`dotted`/`bold`, marking an ADR-0044 declared back-edge (a `revise` loop's resubmit edge). Flow-builder-protocol consumers can now render it as a distinct curved/dashed return arc, set apart from forward flow — matching the objectui designer's hand-rolled canvas (objectstack-ai/objectui#1954). Part of #2274.

- e7e04f1: chore(liveness): bring `page` under the spec liveness gate

  Onboards the `page` metadata type to the ADR-0049/#1919 liveness ledger
  (`packages/spec/liveness/page.json`) and adds it to the governed-types list in
  `check-liveness.mts`. Every authorable PageSchema property now declares a
  status with evidence: 17 properties — 14 `live` (objectui renderer consumers
  cited as prose), 1 `experimental` (`variables` — provider/hook exist, no
  end-to-end consumer), 2 `dead` (`recordReview` / `blankLayout` — their page
  types were removed in framework#2265 and objectui dropped all references in
  objectui#1949; the fields stay @deprecated pending hard-removal). CI now fails
  if a new page property lands unclassified.

- 2be5c1f: Promote `PageSchema.variables` from @experimental to live (ADR-0049)

  Page-local state is now wired end-to-end (runtime in objectui#1957: page
  variables are injected into the visible/CEL expression context as `page.<var>`,
  and `element:record_picker` writes a variable via its `source` binding). The
  spec docs are updated to describe the now-live behaviour and the binding
  direction, and the liveness ledger entry is flipped `experimental → live`.

- ad143ce: fix(security): surface the schedule/user-less `runAs:'user'` fail-open (#1888 follow-up)

  With `flow.runAs` now enforced (#1888), a **schedule-triggered** flow with the
  default `runAs:'user'` has no trigger user. `resolveRunDataContext` returns
  `undefined` for that case, so the CRUD nodes pass no ObjectQL `options.context`
  and the security middleware — which _skips_ when there is no identity (it
  delegates auth to the auth layer) — runs the operation **UNSCOPED** (effectively
  elevated). An author who left `runAs` at the `'user'` default expecting a
  restricted run silently gets an unscoped one — a fail-open footgun (ADR-0049: a
  security property must not silently do the opposite of what it implies).

  This is the **product decision** to make that explicit, chosen to keep legitimate
  scheduled CRUD working (denying outright would break it, and silently elevating
  would hide the author's intent). Prevention happens where the platform can tell
  intent apart (author/build time); the runtime stays non-breaking but is no longer
  silent:

  - **Author-time lint** (`@objectstack/cli`, `lintFlowPatterns`): a new advisory
    rule `flow-schedule-runas-unscoped` flags a schedule-triggered flow whose
    effective `runAs` is `user` (explicit or unset) and which performs a data
    operation — pointing the author at `runAs:'system'`. Catches the footgun at
    compile time, before deploy (most flows are AI-authored).
  - **Runtime warning** (`@objectstack/service-automation`): the engine now emits a
    clear one-per-run warning when a user-mode run resolves no trigger identity and
    the flow touches data — the fail-open is _audible_ rather than silent. Behavior
    is otherwise unchanged (the run still executes), so scheduled CRUD that relied
    on this is not broken. New helpers `runIsUnscopedUserMode`, `flowTouchesData`,
    and `DATA_NODE_TYPES` are exported alongside `resolveRunDataContext`.
  - **Spec describe** (`@objectstack/spec`): `FlowSchema.runAs` now states that a
    scheduled run has no user, so under `user` it runs unscoped — declare `system`.

  The first-party example apps that tripped the new lint are fixed to declare
  `runAs:'system'` explicitly (`stale_opportunity_sweep`, the app-todo
  `task_reminder` / `overdue_escalation` sweeps) — they read/write across owners and
  were running unscoped by default.

  Longer term, attributing scheduled runs to a dedicated service principal (so they
  are scopable + audit-attributable rather than unscoped) is the right enforcement;
  tracked as M2 follow-up.

  Proven by a service-automation unit test (the engine warns once for a user-less
  user-mode data run; stays silent for `system`, for an identified user, and for a
  data-less flow), an end-to-end test wiring the **real `ScheduleTrigger` to the
  real engine** (`@objectstack/trigger-schedule`) that fires a job and asserts the
  user-less identity reaches the engine + trips the warning through the actual cron
  path, and a dogfood gate (`flow-runas-schedule.dogfood.test.ts`) that drives
  user-less runs through the real automation + security + data stack: a
  `runAs:'user'` run reads + writes an owner-scoped note a member cannot — audibly —
  while `runAs:'system'` is the explicit, warning-free equivalent.

  Refs #1888, ADR-0049.

- 8801c02: fix(spec): don't require `slots` on slotted pages

  `PageSchema`'s superRefine rejected any `kind: 'slotted'` page that didn't
  provide a `slots` map — but a slotted page with no overrides is valid: every
  slot falls through to the synthesized default layout, the natural starting
  point before you add overrides. Requiring `slots` up front made the Studio
  "New Page" form a dead-end the moment you picked "slotted" (the form can't
  author a slot map), the same trap as the old required `regions`.

- 4a84c98: fix(spec): make page `regions` and component `properties` optional

  `PageSchema.regions` and `PageComponentSchema.properties` were required, which
  made it impossible to create record/home/app pages in the Studio editor: the
  New Page form has no region editor, and the create-form seeds a record page's
  default layout from `buildDefaultPageSchema`, whose nodes carry props at the top
  level — so every seeded block tripped `regions.N.components.M.properties:
expected record`. Both are now `.optional().default(...)`; an empty full page
  falls back to the synthesized default layout, slotted pages compose via `slots`,
  list pages ignore regions, and prop-less components (record:activity,
  element:divider) no longer need `properties: {}`.

## 10.3.0

## 10.2.0

### Minor Changes

- b496498: feat(spec): add `responsiveStyles` to the UI page-component envelope (ADR-0065)

  `ResponsiveStylesSchema` / `StyleMapSchema` model the SDUI scoped-styling
  primitive — per-breakpoint CSS-property maps (`large`/`medium`/`small`/`xsmall`)
  compiled to id-scoped CSS at render. `PageComponentSchema` gains an optional
  `responsiveStyles` field: the preferred, build-independent, collision-free
  styling channel for metadata-authored pages (distinct from the layout-oriented
  `responsive` config). Prefer design-token values.

## 10.1.0

### Minor Changes

- 49da36e: feat(analytics): correct analytics over federated objects (ADR-0062 Phase 3, D6)

  Analytics over an external (federated) object now aggregates against the
  **correct** remote table instead of silently querying the wrong one. The
  `NativeSQLStrategy` hand-compiles `FROM "<object>"` and bare column references,
  which bypass the driver's physical-table resolution (`external.remoteName` /
  `remoteSchema` / `columnMap`). It now **declines** any query whose base or joined
  object is federated, routing it to the `ObjectQLStrategy` — whose
  `engine.aggregate()` goes through the driver's `getBuilder` and already honours
  `remoteName`/`remoteSchema` (#2138/#2149). This "reuses the driver's resolution"
  (D6) rather than re-implementing it.

  Adds an optional `StrategyContext.isExternalObject(objectName)` hook (reported by
  the analytics plugin from the object's `external` block). Purely additive — with
  no hook, behavior is unchanged for managed objects.

- ac79f16: feat(datasource): auto-connect declared external datasources (ADR-0062 Phase 1, D1/D2/D5)

  A declared external datasource is now connected to a live ObjectQL driver and its
  federated objects are queryable **with zero app code** — no `onEnable` driver
  wiring. Implements ADR-0062 Phase 1.

  - **D1 — one connect path.** New `DatasourceConnectionService` in
    `@objectstack/service-datasource` owns the single "definition → live driver"
    path: build via the injected driver factory → resolve `external.credentialsRef`
    via the `SecretBinder` → connect → `engine.registerDriver` under the datasource
    name → register the datasource def → sync each bound federated object's read
    metadata (DDL-free). Both origins converge on it: the runtime-admin
    `registerPool` now delegates here, and `AppPlugin` auto-connects code-defined
    datasources. Exposed as the `'datasource-connection'` kernel service.
  - **D2 — opt-in-safe gate.** A declared datasource auto-connects only when it is
    `external`, an object **explicitly** binds to it via `object.datasource`, or it
    sets the new `autoConnect: true` flag. A managed datasource that nothing
    explicitly binds (incl. ones referenced only by a `datasourceMapping` rule, e.g.
    `examples/app-crm`'s `:memory:` datasources) stays metadata-only — existing apps
    are byte-for-byte unchanged. See the ADR-0062 D2 implementation note.
  - **D5 — lifecycle, ordering & policy.** Connect happens in `AppPlugin.start()`
    (before the `kernel:ready` validation gate, relying on the kernel's
    init-all-then-start-all ordering). Fail-fast for a declared `external` datasource
    with `validation.onMismatch: 'fail'`; degrade-with-warning otherwise (and always
    for runtime-admin/rehydrate, so a UI action or replica blip never bricks the
    server). Adds a host-injectable `DatasourceConnectPolicy` (open-core default
    allows; a multi-tenant host binds a stricter fail-closed policy for egress
    isolation) consulted before every connect — one connect path, no cloud fork.

  Adds `datasource.autoConnect` to the spec. The legacy `onEnable` +
  `ctx.drivers.register` bridge remains supported as an escape hatch (idempotent vs.
  auto-connect). No behavior change for managed apps.

## 10.0.0

### Minor Changes

- d7ff626: spec(action): a `script` action must declare an executable binding — reject at
  author/compile time when it has neither an inline `body` nor a `target`.

  A `type: 'script'` action with no `body` and no `target` registers no runtime
  handler: `AppPlugin` skips it, and invoking it falls through to the wildcard
  lookup and fails with `Action '<name>' on object '*' not found` (the #2169
  "Mark Done" bug). The shape was schema-valid and passed coverage tests, so the
  break only surfaced when a user clicked the button.

  `ActionSchema` now enforces the invariant via `superRefine`: `script` requires
  `body || target` (mirroring the existing "non-script types require `target`"
  rule). `body`-bound actions are auto-registered by the runtime; `target`-bound
  actions name a function wired imperatively (e.g. via `onEnable`). This only
  rejects configurations that were already non-functional at runtime — verified
  against the full monorepo build (every shipped bundle still compiles).

- e16f2a8: **BREAKING:** the system object `sys_department` is renamed to `sys_business_unit`
  — object + member table (`sys_department_member` → `sys_business_unit_member`),
  fields, and i18n — with **no compatibility alias**. Any deployment holding
  `sys_department` rows, or metadata that references the object by name (lookups,
  list views, queries, sharing/approval scopes), must migrate to `sys_business_unit`.
  A renamed shipped system object is a breaking change to the platform's public
  data surface, so this lands as a **major**. Verified per ADR-0059's pre-publish
  hotcrm gate: no published downstream consumer references the old name.

  ADR-0057 — ERP authorization core. Adds permission-grant access DEPTH
  (`own`/`own_and_reports`/`unit`/`unit_and_below`/`org`), renames `sys_department`
  → `sys_business_unit` (no aliases — see BREAKING above), introduces the platform-owned
  `sys_user_role` assignment, and seeds stack-declared `roles`/`sharingRules` into
  `sys_role`/`sys_sharing_rule` at boot (closes #2077). Hierarchy-relative scopes are
  delegated to a pluggable `IHierarchyScopeResolver` (open edition fails closed to
  owner-only; `defineStack` errors without `requires: ['hierarchy-security']`). Also
  fixes a latent over-grant where `engine.find({ filter })` was ignored (driver reads
  `where`) — normalized `filter`→`where` in the engine.

- e411a82: feat(ai): split `ask`/`build` agents by surface + tool scoping (ADR-0063/0064).

  Two kernel agents bound by surface, not a per-turn classifier. `SkillSchema`
  gains `surface: 'ask'|'build'|'both'` and `AgentSchema` gains `surface:
'ask'|'build'` (ADR-0063 §3); an agent's tools are exactly the union of its
  surface-compatible skills' tools — incompatible binding is a load error in
  `resolveActiveSkills` (ADR-0064 §3). The `ask` agent is now data-only (the
  ADR-0040 unified "INTENT FIRST" classifier and the `buildRegisterActive`
  degradation shim are removed); a new `schema_reader` (`surface:'both'`) owns
  the shared reads `describe_object`/`list_objects`/`query_data` so the build
  agent reuses them without dual-listing. `*.agent.ts` is closed to third
  parties: the `agent` metadata-type is `allowRuntimeCreate:false,
allowOrgOverride:false` and the runtime catalog lists only platform agents
  (ADR-0063 §2). Renames `data-chat-agent.ts`→`ask-agent.ts`,
  `DEFAULT_DATA_AGENT_NAME`→`ASK_AGENT_NAME` (the `data_chat`/`metadata_assistant`
  aliases stay resolvable).

- a581385: Propagate a dataset measure's declared currency to the analytics result field.

  Adds an optional `DatasetMeasure.currency` (ISO 4217) on the semantic layer and
  carries it onto each measure result field alongside `label`/`format`, so a
  currency-aware client (Intl symbol) can render `¥1,234` / `$616,000` from a real
  currency code instead of a plain number or a `$` baked into `format`. Additive
  and optional — existing datasets are unaffected.

- 220ce5b: Resolve the tenant default currency onto ExecutionContext.

  Adds `ExecutionContext.currency` (ISO 4217) and resolves it from the
  `localization.currency` setting alongside `timezone`/`locale` — in both the
  runtime `resolveExecutionContext` and the REST mirror. This is the foundation
  for the documented "applied when a currency field omits its own" fallback: the
  tenant default is now carried on every request context, so analytics enrichment,
  formatters, and renderers can resolve a measure/field currency down to the org
  default instead of hard-coding it. Undefined when no tenant default is
  configured (consumers then render a plain number).

- 6ca20b3: ADR-0058 D1 follow-through — RLS predicates are now canonical CEL. Migrated every
  seeded RLS `using`/`check` (default permission sets, showcase, and the
  `RLS.ownerPolicy`/`tenantPolicy`/`allowAllPolicy` helper factories) from the
  legacy SQL-ish form (`=`, `IN (...)`) to pure CEL (`==`, `in`), so authors and AI
  learn ONE expression language. The `sqlPredicateToCel` bridge is retained as a
  DEPRECATED transitional shim: a stored SQL-style predicate still compiles (no
  silent deny on legacy data) but emits a deprecation warn; canonical CEL passes
  through as a no-op. No runtime behavior change — CEL and the old SQL form compile
  to the identical FilterCondition.
- 5f875fe: spec: add `defineX` factories for the remaining 16 writable domains and the 6
  missing `XInput` aliases — one consistent, type-safe authoring entry per domain
  (#2035).

  New factories: `defineDatasource`, `defineConnector`, `definePolicy`,
  `defineSharingRule`, `defineRole`, `definePermissionSet`,
  `defineEmailTemplateDefinition`, `defineReport`, `defineWebhook`,
  `defineObjectExtension`, `defineCube`, `defineMapping`, `defineTheme`,
  `defineTranslationBundle`, `definePage`, `defineAction`. Each mirrors the 19
  existing factories (`XSchema.parse(z.input<…>)`): input-shape ergonomics +
  authoring-time validation. Because a factory is a _value_ import, a broken
  import hard-errors instead of silently degrading to `any` (the #2023 failure
  mode), and errors surface at `.parse()` time with field-level messages.

  Also adds the previously-missing input aliases `PolicyInput`, `CubeInput`,
  `MappingInput`, `ThemeInput`, `TranslationBundleInput`, `PageInput`.

  Purely additive: no existing exports change.

- b469950: feat(spec): add a `tree` view type to the ListView schema

  `'tree'` is now a valid `ListView.type` (and `VisualizationType`), backed by a
  new `TreeConfigSchema` (`parentField` / `labelField` / `fields` /
  `defaultExpandedDepth`, passthrough). This lets a self-referencing object be
  served as a tree-grid; without it the runtime Zod-validates view metadata and
  silently drops `type:'tree'`. Renderer ships in objectui `@object-ui/plugin-tree`.

### Patch Changes

- 2a1b16b: fix(ADR-0015): honor `external.remoteName` / `external.remoteSchema` on the federation read path.

  The query path previously resolved an external object's physical table from the
  object name, ignoring its `external` binding — so a federated object bound to a
  differently-named remote table failed with `no such table`, and ADR-0015's own
  `wh_order` → `mart.fact_orders` example was unqueryable. The SQL driver now
  resolves the remote table (`remoteName`, plus `remoteSchema` via `.withSchema()`
  on pg/mysql) and registers external objects' read-coercion metadata without DDL
  (`SqlDriver.registerExternalObject`, routed from the engine/plugin schema-sync).
  The managed path is unchanged. See ADR-0015 §18.

- 3efe334: Honor a nested `where` filter inside `expand` on lookup/master_detail expansion.

  The expand post-processor batch-loads related records with an `id $in [...]` query but never merged the nested QueryAST `where`, so a documented `expand: { rel: { where: {...} } }` filter was silently ignored and every related record came back. The nested filter is now AND-merged into the batch query via an explicit `$and` group (`{ $and: [{ id: { $in } }, nestedAST.where] }`) — robust against a nested filter that itself keys `id` or uses a top-level `$or`/`$and`, where a shallow spread would clobber or reorder the constraint.

  `limit`/`offset`/`orderBy` remain intentionally not honored on the expand path: it batch-loads every parent's related records in one `$in` query and re-keys them per parent by foreign key, so a per-parent page size or ordering can't be expressed there. Docs and the schema `describe()` are updated to match, with a guard test asserting `limit`/`offset` are not pushed into the expand query.

- feead7e: fix(spec): make `GanttConfigSchema` forward-compatible via `.passthrough()`.

  The gantt renderer (objectui plugin-gantt) keeps adding view-config knobs
  (e.g. `lockField`, `defaultCollapsedDepth`) ahead of this schema. Without
  passthrough, the console — which validates the view config against a bundled
  copy of this schema before handing it to the renderer — strips any field not
  declared here, so every new renderer knob needs a spec release + console
  rebuild before it can take effect. Adding `.passthrough()` lets unknown fields
  flow through to the renderer, decoupling renderer releases from spec releases.
  Known fields keep their validation; the renderer still only reads what it
  understands.

## 9.11.0

### Minor Changes

- e7f6539: feat(spec,sharing): canonical OWD vocabulary on `object.sharingModel` (ADR-0056 D1)

  Reconciles the Org-Wide-Default naming so authors use ONE vocabulary. `object.sharingModel`
  now accepts the canonical OWD names — `private` | `public_read` | `public_read_write` |
  `controlled_by_parent` — alongside the legacy `read` / `read_write` / `full` aliases (kept,
  non-breaking). The sharing runtime maps them onto the three enforced behaviours
  (`public_read` ≡ legacy `read` = everyone reads / owner writes; `public_read_write` =
  unscoped). Unknown values remain rejected by the enum (authoring-time, fail-closed). The
  showcase announcement now declares the canonical `public_read`, exercised end-to-end by the
  public-read dogfood proof.

- 2365d07: feat(sharing): configurable role-hierarchy widening — `role_and_subordinates` recipient (ADR-0056 D6)

  Role-hierarchy access widening ("a manager sees records shared with their team") is now
  **implemented and configurable per sharing rule**, not a hardcoded no-op. The
  `role_and_subordinates` recipient (declarable on `sys_sharing_rule.recipient_type`) expands,
  at evaluation time, to the named role **plus every subordinate role** by walking the
  `sys_role.parent` hierarchy via a new `RoleGraphService` (mirroring the department/team
  graphs; cycle-safe). Previously `Role.parent` was declared but never consumed — a silent
  no-op flagged by the ADR-0056 audit. This is the Salesforce "grant access using hierarchies"
  model expressed declaratively: each rule chooses whether to roll up the hierarchy. Unit-proven
  (role-graph traversal, subordinate-user expansion, cycle safety); the recipient is added to
  the authoring select + the `SharingRuleRecipientType` contract.

- 6595b53: feat(security): app-declarable default profile (`isDefault`, ADR-0056 D7)

  An app can now declare its default access posture for authenticated users who have
  no explicit grants, via `isDefault: true` on a permission set — instead of always
  inheriting the built-in `member_default`. The SecurityPlugin resolves the fallback
  from the `isDefault` profile when no explicit `fallbackPermissionSet` is configured
  (falling back to `member_default` when none is declared — non-breaking). This is the
  foundation for SSO/JIT provisioning (mapping IdP claims → a declared default profile).
  Proven by the `showcase-default-profile` dogfood test: a sign-up governed by a custom
  default that grants only `showcase_announcement` can read it but is denied
  `showcase_private_note` (which the `member_default` wildcard would have allowed).

- 36138c7: feat(autonumber): date, {field} and per-scope counter reset for autonumber formats

  `autonumberFormat` previously only understood a single `{0000}` sequence slot —
  everything else was a fixed literal prefix on one global counter. Real MES/eHR
  record numbers need three more token classes, so the format is now tokenized by a
  shared pure renderer in `@objectstack/spec` (`parseAutonumberFormat` /
  `renderAutonumber`) that the engine fallback and the SQL driver both call, so they
  emit byte-identical numbers (#1603 parity):

  - **Date tokens** — `{YYYY}` `{YY}` `{MM}` `{DD}` `{YYYYMMDD}` resolve the calendar
    day in the request's **business timezone** (`ExecutionContext.timezone`, ADR-0053;
    UTC fallback), threaded through the new `DriverOptions.timezone`.
  - **`{field}` interpolation** — `{section}{island_zone}{000}` substitutes record
    field values into the prefix.
  - **Per-scope counter reset** — the counter's scope is the rendered prefix _before_
    the sequence slot, so `AD{YYYYMMDD}{0000}` resets daily, `{section}{island_zone}{000}`
    numbers per group, and `{plan_no}{000}` numbers per parent — all from one
    mechanism, no separate reset config.

  Fixed-prefix formats like `CASE-{0000}` render an empty scope and keep their single
  global counter, so existing sequences are unchanged. The persistent
  `_objectstack_sequences` table is keyed by a `key_hash` (SHA-256 of
  `object, tenant_id, field, scope`) — a single 64-char primary key that keys every
  dialect uniformly, stays within MySQL's utf8mb4 index-length limit (four raw
  columns would not), and lets `scope` be a generous non-indexed column. Deployments
  with an older table (3-column, or an interim `scope` column) are migrated in place
  on first use, carrying existing counters to `scope=''`.

  Guardrails:

  - **Empty interpolated field is a hard error, not a silent mis-number.** A
    `{field}` token whose value is missing at create time would render to an empty
    prefix and collapse the record into the wrong counter scope. Both the SQL driver
    and the engine fallback now refuse to generate and throw a clear error naming the
    empty field (shared `missingFieldValues` helper).
  - **Build-time lint (`@objectstack/cli compile`).** `autonumber` formats are
    checked against the object's fields: a `{field}` token naming a non-existent
    field (or the autonumber field itself) **fails the build**; a token naming an
    _optional_ field emits an advisory warning to mark it `required: true`.
  - **Migration fails safe.** If a legacy table cannot be migrated to the `key_hash`
    shape, fixed-prefix sequences keep working via the legacy key and a per-scope
    write raises an actionable error instead of corrupting counters.
  - **Long `{field}` scopes are supported** (e.g. a long `{plan_no}`): the non-indexed
    `scope` column and hashed key remove the old varchar/PK length ceiling.

  Notes on inherent semantics (documented, not bugs):

  - The counter scope IS the rendered prefix. When two records' tokens render to the
    same prefix string (e.g. `{a}{b}` for `('AB','C')` and `('A','BC')`) they also
    render the same visible number, so they share one counter to stay unique — the
    remedy for genuinely-distinct groups is an unambiguous format (a delimiter
    literal between variable tokens).
  - The sequence pad width is a MINIMUM; past it the number grows (`{000}` →
    `1000`), it never wraps — matching mainstream autonumber semantics.

- 4c213c2: Master-detail "controlled by parent" permissions (ADR-0055).

  A detail object can now declare `sharingModel: 'controlled_by_parent'`: its read/write access is derived from its master record, with no authored RLS.

  - `@objectstack/spec`: `controlled_by_parent` added to the authorable `object.sharingModel` enum.
  - `@objectstack/plugin-security`: reads inject `masterFK IN (accessible master ids)` (resolved from the master's own RLS, reusing the existing filter machinery — zero RLS-compiler changes); by-id writes (insert/update/delete) to a detail now require edit access to its master, closing the #1994-class by-id hole for derived access.
  - `@objectstack/verify`: related-record **topological synthesis** — `deriveCrudCases` no longer skips objects with required relations; it builds the object dependency graph, orders it topologically, and threads real target ids, so relationship-dense objects (and the master-detail RLS proof) are verifiable. Honest `blocked` verdicts remain for required-reference cycles and external/missing targets.

  v1 limits (per ADR-0055): the accessible-master id set is unbounded (large-tenant scale is a documented future limit), and master-detail chains are single-level (not transitively traversed).

- 2afb612: feat(security): resolve `current_user.email` in RLS owner policies

  RLS `using` predicates can now reference **`current_user.email`** — a unique,
  human-readable, _seedable_ owner anchor (`owner = current_user.email`). Previously
  the RLS compiler resolved only `current_user.id` / `organization_id` / `roles` /
  `org_user_ids`, so any owner-by-name/email predicate silently compiled to the
  deny sentinel (fail-closed → the user saw nothing). Email is sourced for free
  from the auth session (with a bounded `sys_user` fallback for the API-key path)
  and threaded onto the `ExecutionContext` in both identity resolvers — the REST
  data path (`rest-server`) and the dispatcher path (`resolve-execution-context`).

  Display `name` is deliberately **not** exposed to RLS: names collide, and a
  collision on an ownership predicate is an access-control leak. Only unique
  identifiers (`id`, `email`) are resolvable.

  This makes owner-scoped row-level security work with seed data (no per-user ids
  needed) and, combined with `controlled_by_parent` (ADR-0055), lets a master's
  owner scoping flow to its detail records. The example-showcase demonstrates it:
  `showcase_invoice` carries an `owner` email + an owner RLS policy, its lines are
  controlled-by-parent, and invoices/lines are seeded per owner. It also fixes the
  showcase's previously inert owner predicates (they used `==` and `current_user.name`,
  neither of which the compiler accepts) to `= current_user.email`.

### Patch Changes

- fa8964d: docs(spec): mark unenforced compliance/encryption/masking/RLS-config surface EXPERIMENTAL (ADR-0056 D8)

  Per ADR-0049's enforce-or-remove gate (and ADR-0056 D8), the security-adjacent
  schemas that are parsed but have **no runtime consumer** now carry an explicit
  `⚠️ EXPERIMENTAL — NOT ENFORCED` header so the no-op is visible to authors and the
  reference docs: GDPR/HIPAA/PCI compliance configs, field-level encryption, data
  masking, the unified security-context governance, and the global `RLSConfig` /
  `RLSAuditEvent` (distinct from the ENFORCED `RowLevelSecurityPolicySchema`, which is
  left untouched). No behaviour change — these were already inert; the marker makes
  the inertness honest rather than silent.

- a8e4f3b: Add the ADR-0054 "prove-it-runs" proof field + ratchet to the spec liveness gate. A `live` ledger entry may now carry a `proof` — a reference (`<file>#<proof-id>`) to a dogfood test that asserts the property's runtime behavior. A bound high-risk `live` property must carry a valid proof, validated statically by the liveness gate (the file exists and declares the matching `@proof:` tag). Four high-risk classes are bound this phase: field types (`field.type`), RLS (`permission.rowLevelSecurity.using`), flow nodes (`flow.nodes.type`), and analytics (`dataset.dimensions.dateGranularity`). The `dataset` metadata type is now governed (new `liveness/dataset.json`). The authoritative high-risk-class list lives in `scripts/liveness/proof-registry.mts`; see `liveness/README.md`.

## 9.10.0

### Minor Changes

- 1f88fd9: Converge the RLS contract with the reference compiler, and wire §7.3.1 dynamic membership.

  - **spec (docs)**: narrow `rls.zod.ts` to the four expression forms the compiler actually implements — `field = current_user.<prop>`, `field = 'literal'`, `field IN (current_user.<array>)`, and `1 = 1`. Removed the over-promised surface (subqueries, `AND`/`OR`/`NOT`, `LIKE`/`ILIKE`, regex, `ANY`/`ALL`, `NOT IN`, `IS NULL`, `NOW()`/`CURRENT_DATE`) from the operator list, context-variable list, and `@example` policies, and documented the fail-closed behaviour explicitly.
  - **spec (schema)**: `ExecutionContext` gains `rlsMembership?: Record<string, string[]>` — a bag of pre-resolved dynamic-membership id arrays (team members, territory accounts, shared records) that the runtime stages so RLS can scope via `field IN (current_user.<key>)` without subquery support. Generalizes the previously hard-coded `org_user_ids`.
  - **plugin-security**: `RLSCompiler.compileFilter` merges `rlsMembership` keys into the user context (arrays only, never clobbering the named `id`/`organization_id`/`roles`/`org_user_ids` fields), so §7.3.1 hierarchy- and sharing-based policies compile. `compileExpression` now recognizes `1 = 1` as always-true (empty filter), making `RLS.allowAllPolicy` grant access instead of silently failing closed. Missing/empty membership sets still fail closed.

- 1f88fd9: Add a transaction boundary to sandboxed hook/action bodies: `ctx.api.transaction(async () => { … })`. Every `ctx.api` read/write inside the callback runs in one driver transaction — committed when the callback returns, rolled back if it throws (or if the body leaves the transaction open at timeout). Guarded by the new `api.transaction` capability.

  - **spec**: new `api.transaction` capability token on `HookBodyCapability`.
  - **objectql**: `ScopedContext` gains discrete `beginTransaction()` / `commitTransaction(handle)` / `rollbackTransaction(handle)` primitives. The handle is threaded **explicitly** through a child context (`resolveTx` honors it ahead of the ambient `txStore`), because the sandbox drives the body across many host event-loop turns where AsyncLocalStorage context does not survive. Degrades to non-transactional execution when the driver has no transaction support.
  - **runtime**: the QuickJS runner wires `ctx.api.transaction` over three deferred-promise host leaves (begin/commit/rollback), routes in-transaction ops through the tx-scoped context, and rolls back a transaction the body left open before disposing the VM.

### Patch Changes

- db02bd5: Fix dashboard time-series charts / "last N months" KPIs that filter or group by a `Field.datetime` column silently returning "No rows".

  The analytics `NativeSQLStrategy` compiles dashboard relative-date tokens (`{12_months_ago}`, `{today}`, …) to ISO date strings and binds them directly into raw SQL, bypassing the driver's own filter coercion. Under better-sqlite3 a `Field.datetime` column is stored as an INTEGER epoch (ms), so `assessed_at >= '2025-06-18'` became a TEXT-vs-INTEGER affinity compare that is always false — an empty result even though the rows exist. `Field.date` columns store ISO TEXT and were unaffected.

  The strategy now coerces a temporal comparand to the column's on-disk storage form via a new optional `StrategyContext.coerceTemporalFilterValue` hook, wired to the driver's public `SqlDriver.temporalFilterValue` (the single source of truth for the storage convention). Coercion is dialect-correct: SQLite `Field.datetime` → epoch ms; `Field.date` text and native-timestamp dialects (Postgres/MySQL) are left unchanged, so Postgres is never handed an epoch integer. Applied to `gte`/`lte`/`gt`/`lt`/`equals`, `in`/`notIn`, and the `dateRange`/timeDimension `BETWEEN` path.

- 641675d: Add `*Input` authoring-type aliases (`DatasourceInput`, `ConnectorInput`, `SharingRuleInput`, `JobInput`, `WebhookInput`, `EmailTemplateDefinitionInput`, `RoleInput`, `PermissionSetInput`, `ObjectExtensionInput`) alongside the existing `FieldInput`/`ActionInput`/`ReportInput`/`PortalInput` convention. These are `z.input<typeof XSchema>` aliases so authored literals keep `.default()` fields optional and accept CEL/Expression string shorthands — matching how `defineX()` helpers already accept input. No runtime change.
- 94e9040: fix(spec): declare the extended Gantt config fields the renderer actually reads

  `GanttConfigSchema` only declared the 5 core timeline fields as a plain
  `z.object` (no passthrough), so every other field the Gantt renderer consumes —
  `parentField`/`typeField` (two-level summary→step hierarchy), `colorField`,
  `groupByField`, `tooltipFields`, `baselineStartField`/`baselineEndField`,
  `resourceView`/`assigneeField`/`effortField`/`capacity`, `quickFilters`,
  `autoZoomToFilter` — was silently stripped by `.parse()` on both the compile-time
  protocol check and the runtime `GET /api/v1/meta/view/:object` re-validation. With
  the keys gone before render, the Gantt degraded to a flat list (no parent/child
  rows, no summary bars, no expand/collapse). These fields are now declared
  explicitly (with descriptions), so the renderer contract round-trips through the
  spec instead of requiring downstream patches.

## 9.9.1

## 9.9.0

### Minor Changes

- 84249a4: feat(action): `undoable` flag on the UI Action schema

  Single-record update actions can declare `undoable: true`. The runtime captures
  the record's prior field values and offers an "Undo" affordance on the success
  toast (backed by the client UndoManager). Pairs with the objectui runtime that
  honours it. Also documents that conditional `visible` / `disabled` CEL
  predicates are evaluated by the action renderers (used here to hide an action
  when it no longer applies, e.g. Convert Lead on an already-converted lead).

- 11af299: feat(runtime): resolve a reference timezone onto ExecutionContext (ADR-0053 Phase 2 foundation)

  Adds `ExecutionContext.timezone` (optional IANA zone) and resolves it once per request in `resolveExecutionContext`, with precedence **user preference → org default → `UTC`**:

  - User override: `sys_user_preference` row `(user_id, key='timezone')`.
  - Org default: the tenant-scoped `sys_setting` `(namespace='localization', key='timezone', scope='tenant')` — one org per physical tenant (ADR-0002), so no tenant_id filter is needed.
  - An invalid IANA zone is ignored and resolution falls through; every read is defensive and never blocks auth.

  This is **pure plumbing with no behavior change**: nothing reads `ctx.timezone` yet, and an absent value resolves to `UTC` (today's behavior). It is the foundation the rest of ADR-0053 Phase 2 consumes — tz-aware `today()`/`daysFromNow()` (#1980), datetime rendering (#1981), and analytics bucketing (#1982). A discoverable `localization` settings manifest for the org default is a follow-up; the resolver already reads the row if present.

  Part of #1978.

- d5774b5: fix(spec): `Field.rating` / `Field.vector` builders emit live props instead of dead ones

  The `Field.rating(n)` and `Field.vector(n)` builders emitted properties the
  spec-liveness ledger classifies as **dead** (silent runtime no-ops), so every
  field authored through them tripped the `liveness-dead-property` author lint:

  - `Field.rating(n)` emitted `maxRating`, but the rating renderer reads the flat
    `max` prop (`RatingField.tsx:13`). The builder now emits `max`.
  - `Field.vector(n)` emitted a nested `vectorConfig` block, but the renderer
    reads the flat `dimensions` sibling (`VectorField.tsx:11`) and nothing
    consumes `vectorConfig` (no vector-index DDL). The builder now emits the flat
    `dimensions`.

  `dimensions` is also promoted to a **declared, live** top-level `FieldSchema`
  property. It was previously only valid nested inside `vectorConfig`, so a flat
  `dimensions` authored by hand was silently **stripped** during compile (Zod
  drops unknown keys) — the renderer then saw no dimensionality. It now survives
  compilation and is governed by the liveness gate.

  `maxRating` and `vectorConfig` remain accepted by the schema (still classified
  `dead` + `authorWarn`) for back-compat, so hand-authored usages still surface
  the advisory warning rather than type-erroring.

- 134043a: feat(automation): declarative screen-flow completion/error messages + action `errorMessage`

  A screen flow can now declare `successMessage` / `errorMessage` (FlowSchema). The
  engine surfaces them on the terminal `AutomationResult` (`successMessage` on
  success, `errorMessage` on failure), so the UI flow-runner shows a meaningful
  toast instead of a generic "Done" / the raw error — no manual "success screen"
  node needed. The CRM convert-lead wizard sets a friendly completion message.

  Also exposes `errorMessage` on the UI Action schema. The runtime (ActionRunner)
  already honoured it; it just wasn't declarable in the spec — closing a
  spec↔runtime gap so authors can set a friendly failure toast.

- 9afeb2d: feat(settings): `localization` settings — platform default timezone, language & formats (ADR-0053 Phase 2)

  Adds a `localization` SettingsManifest, the missing keystone that makes the Phase 2 reference-timezone actually configurable end-to-end. One declaration gives the full settings stack for free: platform built-in default → `global` → `tenant` cascade, a permission-gated settings page, and i18n.

  **Keys** (organization-level; per-user overrides intentionally out of scope for v1): `timezone` (UTC), `locale` (en-US), `default_country`, `date_format`, `time_format`, `number_format`, `first_day_of_week`, `currency` (USD), `fiscal_year_start`. Benchmarked against Salesforce/Workday "Company Information + Locale".

  **Resolver 收编** — `resolveExecutionContext` now resolves `timezone` **and** `locale` from the `localization` settings via the `settings` service (canonical 4-tier cascade), falling back to a direct tenant-scoped `sys_setting` read, then `UTC` / `en-US`. This replaces the hand-rolled `sys_user_preference` + tenant-only `sys_setting` path from #1978 (which bypassed the settings abstraction and is dropped along with the per-user tier). New `ExecutionContext.locale`.

  **Consumer wiring** — analytics date bucketing now picks up the resolved org timezone: `DatasetExecutor` threads `ExecutionContext.timezone` into the query (precedence: explicit selection tz → request tz → UTC), so #1982's tz-aware buckets fire for a configured org without callers passing a zone. Formula `today()`/`datetime` were already wired (#1979/#1980).

  Email `datetime` rendering (`SendTemplateInput.timezone`, shipped in #1981) is intentionally **not** wired here: the only current `sendTemplate` callers are pre-session auth emails with no org context; business-notification callers can pass the zone when they appear.

- 6bec07e: feat(automation): object-form screen-flow steps

  A `screen` node that declares `config.objectName` now renders the named object's
  FULL create/edit form (including inline master-detail child grids) instead of a
  flat field list. The node emits an `object-form` `ScreenSpec`
  (`kind`/`objectName`/`mode`/`recordId`/`defaults`/`idVariable`); the client
  renders the real ObjectForm, persists the record (and its children, atomically),
  and resumes the run with the saved id bound to `idVariable` so a later step can
  reference it — e.g. a lead-conversion wizard: a full Customer step, then a full
  Opportunity-with-line-items step.

  - **spec**: `ScreenSpec` gains `kind`/`objectName`/`mode`/`recordId`/`defaults`/`idVariable`.
  - **service-automation**: the `screen` executor emits object-form specs and now
    interpolates `title`/`description`/field `defaultValue`/object-form `defaults`
    against live flow variables (the engine does not pre-interpolate node config).

- 601cc11: feat(analytics): timezone-aware date bucketing (ADR-0053 Phase 2)

  Analytics day/week/month/quarter/year buckets now resolve on a **reference timezone's** calendar days, so a row near a tz day-boundary lands in the bucket a user in that zone would expect — identically on SQLite and Postgres.

  Per ADR-0053 decision **D2**, bucketing is done **in-memory, uniformly** for non-UTC zones rather than emitting dialect-specific `date_trunc … AT TIME ZONE` (SQLite has no tz database and MySQL needs tz tables loaded, so splitting by dialect would shift bucket boundaries for the same data). `engine.aggregate({ timezone })` therefore forces the in-memory aggregation path when a non-UTC reference tz is set — the date-range `where` still goes to the driver, so only matching rows are fetched. **UTC / unset keeps the native driver fast path unchanged.**

  - New shared `calendarPartsInTz` / `calendarPartsInTzOrUtc` util in `@objectstack/core` (DST-safe via `Intl.DateTimeFormat`, never hand-rolled offset math; falls back to UTC for an unset/`'UTC'`/invalid zone).
  - `EngineAggregateOptions` and the analytics `executeAggregate` bridge / `ObjectQLStrategy` thread the reference timezone (sourced from the dataset selection / `ExecutionContext`) through to `applyInMemoryAggregation` → `bucketDateValue`, and the draft-preview evaluator's `bucketDate`.
  - `formatDateBucket` (dimension labels) stays UTC-only by design: it re-labels values that were _already_ bucketed upstream, so re-applying a timezone there would shift a correct bucket by a day.

- 575448d: feat(formula,email): render `datetime` in a reference timezone (ADR-0053 Phase 2)

  `datetime` template holes now render in a reference timezone's wall-clock when one is supplied, at the presentation boundary — storage stays UTC.

  - **Formula template engine** — the `datetime` formatter takes the reference timezone from `EvalContext.timezone` (threaded in #1980) and passes it to `Intl.DateTimeFormat`. `{{ ts | datetime }}` renders in that zone; `{{ ts | datetime:iso }}` stays UTC (machine-readable). Calendar-day `date` rendering is intentionally **unchanged** (tz-naive — a `Field.date` has no zone). New exported `formatValue(name, value, arg, { locale, timeZone })` makes the whitelisted formatters reusable outside the full CEL template engine.
  - **Email pipeline** — `plugin-email`'s renderer previously bypassed the formatter pipeline (`String()` only), so a datetime went out as raw ISO. Email holes now accept the shared formula formatters — `{{ order.total | currency }}`, `{{ ts | datetime }}` — reusing `formatValue` (single source of truth), while keeping the engine's HTML-escaping and `{{{ }}}` raw-output semantics. `SendTemplateInput.timezone` (mirroring the existing `locale`) flows into rendering so an email's datetime shows the recipient's wall-clock.

### Patch Changes

- 90108e0: feat(cli): liveness author-warning lint — close the spec-liveness loop on the author side.

  The liveness ledgers already classify every authorable property live/experimental/dead with evidence, and the CI gate enforces classification _completeness_ — but that knowledge never reached the person (very often an AI) writing the metadata. The new `compile` lint (`lint-liveness-properties.ts`) reads the ledgers and emits an advisory **warning** when an authored object/field sets a property that is misleading at runtime — e.g. `object.enable.feeds` (no feed runtime; comments live on sys_comment), `object.versioning` (no versioning engine), `field.columnName` (driver ignores it; column == field key), `field.maxRating`/`vectorConfig` (renderer reads a different key) — each with a corrective hint toward the supported alternative. Never fails the build (advisory only), consistent with the existing flow anti-pattern lint.

  Signal-over-noise by design: warnings are **opt-in per ledger entry** via a new `authorWarn`/`authorHint` annotation (plus `experimental` entries warn by default). Booleans warn only when set truthy, and only `default(false)` flags are marked, so schema defaults (`enable.trash`, `enable.searchable`) never trip it. Coverage grows by annotating more ledger entries, not by changing lint code; today it covers `object` (incl. `enable.*`) and `field`.

  - `@objectstack/spec`: ledger entries gain optional `authorWarn`/`authorHint`; `liveness/` is now shipped in the package `files` so the CLI can read it. Seeded annotations on the misleading object capability flags + aspirational blocks and the misleading dead field props. No schema/runtime change.

## 9.8.0

### Minor Changes

- 97c55b3: chore(spec): prune 15 dead field display-config properties (ADR-0049 / dead-surface plan). Removes `FieldSchema` enhanced-type _display_ knobs that had no runtime reader and no renderer consumer (dead in both layers per the field liveness audit): code `theme`/`lineNumbers`, rating `allowHalf`, location `displayMap`/`allowGeocoding`, address `addressFormat`, color `colorFormat`/`allowAlpha`/`presetColors`, slider `showValue`/`marks`, barcode/qr `barcodeFormat`/`qrErrorCorrection`/`displayValue`/`allowScanning`. The wired knobs (`language`, `maxRating`, `step`) and the functional nested configs (`currencyConfig`/`vectorConfig`/`fileAttachmentConfig`) are kept. Field _types_ are unchanged; only unused optional config props are removed. Narrows the false spec surface (narrow-and-true).
- 1b1f490: chore(spec): prune 7 dead field governance/compliance properties (dead-surface plan, P0/P2). Removes `FieldSchema` props that implied data-protection/governance behavior but had no runtime consumer — false promises (the real at-rest channel is `type: 'secret'`): `encryptionConfig`, `maskingRule`, `auditTrail`, `cached`, `dataQuality`, `writeRequiresMasterRead`, `trackFeedHistory`. Also drops the now-unused `EncryptionConfigSchema`/`MaskingRuleSchema` imports. Kept `caseSensitive` and `dependencies` (potentially functional — conservative). Field types unchanged.

## 9.7.0

## 9.6.0

### Minor Changes

- 71578f2: feat(book): documentation navigation as a `book` element — spine + derived membership (ADR-0046 §6)

  Adds the `book` metadata element: a navigation **spine** (ordered groups + `audience` + identity) whose membership is **derived** by rule (`include` glob/tag) plus optional per-doc `order`/`group`, never a central array. This keeps AI authoring create-and-forget (no central-array read-modify-write) and runtime overlay merge-safe (RFC 7396 treats arrays atomically).

  - `BookSchema` + `resolveBookTree()` derived-membership resolver + `defineBook()` + additive `doc.order`/`doc.group`.
  - Register `book` as a render-time metadata type (`allowOrgOverride: true`); wire it through the runtime type enumerations (PLURAL_TO_SINGULAR, engine registration, artifact field map, type-schema map).
  - REST `GET /meta/book/:name/tree` resolves the tree; read-layer `audience` gating (`public` ≡ anonymous; `org`/`{profile}` require sign-in).

### Patch Changes

- d1e930a: feat(spec): model action-param translations in TranslationData (`_actions.params`) so action param label/helpText/placeholder/options can be localized via the keys+bundles path. Additive and optional — existing bundles unaffected.
- 5e3a301: fix(spec): surface hook `retryPolicy` and `timeout` in the Studio hook designer form (Execution section), completing schema coverage.
- 5db2742: chore(spec): mark every PolicySchema property `[EXPERIMENTAL — not enforced]` (ADR-0049, #1882). PolicySchema (password/network/session/audit + `forceMfa`, IP allow-list, retention) is parsed but has no runtime consumer — `better-auth` runs hardcoded defaults. The per-property markers make the no-op explicit in the generated reference docs (previously `forceMfa` read "Require 2FA for all users" with no caveat — a false-compliance signal) and to the spec-liveness gate, which now classifies them `experimental` rather than `dead`. Description-only; no behaviour change.

## 9.5.1

### Patch Changes

- ee72aae: fix(spec): render action `body` as a composite editor (language + source) instead of a flat code field

  An action's `body` is a discriminated union (`HookBodySchema`), the same shape hooks use, but `action.form.ts` mapped the whole field to `{ widget: 'code' }`, so the Studio inspector fed the union object to a single JS editor and rendered `[object Object]`. The layout now mirrors the working `hook.form.ts`: a composite with a `language` select, a `source` code editor, and the L2-only capability/timeout knobs.

## 9.5.0

### Minor Changes

- d08551c: feat(ADR-0046): per-locale documentation content (doc i18n)

  Docs can now ship localized bodies. Authors add sibling locale-variant files
  `src/docs/<name>.<locale>.md` (e.g. `crm_lead_guide.zh.md`, `..pt-BR.md`) next
  to the base `<name>.md`; the base stays the default and the fallback. Flatness is
  preserved — variants are flat siblings, not subdirectories.

  - **spec**: `DocSchema` gains an optional `translations` map
    (`locale → {label?, description?, content}`) plus `resolveDocLocale(doc, locale)`,
    which collapses a doc to the best-matching locale (exact → primary subtag
    `zh-CN`→`zh` → base) with per-field fallback and strips the `translations` map.
  - **cli (collect-docs)**: variant files are folded into the base doc's
    `translations`; orphan/duplicate variants and the v1 MDX/image bans are linted
    on variant content too.
  - **rest**: `/meta/doc` (list + single) resolves the request locale from the
    existing `Accept-Language` / `?locale` negotiation, returns one localized body,
    and never ships the `translations` map. Doc detail bypasses the response cache
    so a language switch can't return a stale-locale body.
  - **setup / studio**: the built-in overview docs now ship `zh` translations
    (TS-first inline `translations`), so a Chinese console renders Chinese docs.

  The console already sends the active UI language as `Accept-Language`, so doc
  content localizes on a language switch with no client change.

### Patch Changes

- 707aeed: ui(page.form): sourceView is a view picker; hide template on list pages

  - `interfaceConfig.sourceView` now declares `widget: 'view-ref'` + `dependsOn: 'source'` so the page editor renders a dropdown of the source object's views instead of a free-text input (where an author could type a non-existent view name). The objectui `view-ref` widget reads the source object's views; until it ships, the field degrades to the existing text input.
  - The `template` field is now hidden for `type == 'list'` (`visibleOn: "data.type != 'list'"`). A list/interface page renders via InterfaceListPage and ignores the region template, so showing the field only added noise — same rationale as the already-hidden Data Context / Layout sections.

- 7a103d4: ui(page.form): icon field uses the searchable icon-picker widget

  The Basics → `icon` field now carries `widget: 'icon'`, so the metadata-admin
  form renders a searchable Lucide icon picker (preview + name) instead of a raw
  text input where authors had to type an exact icon name. Mirrors the existing
  `view-ref` / `filter-mode` widget hints; the picker ships in
  `@object-ui/app-shell` and is reusable for app/object icon fields.

- 4b01250: ui(page): page `type` is the page kind, not a visualization

  Removed `grid` / `kanban` / `calendar` / `gallery` / `timeline` from `PageTypeSchema`. They are visualizations of a `list` (interface) page — configured via `interfaceConfig.appearance.allowedVisualizations` and switched at runtime — never distinct page kinds. The runtime never branched on them as page types (it always read the visualization from `interfaceConfig`), so they only misled authors (e.g. selecting page type "kanban" did nothing). `VisualizationTypeSchema` is unchanged and remains the home for those values.

  The roadmap interface kinds (`dashboard`, `form`, `record_detail`, `record_review`, `overview`, `blank`) stay valid in the schema but the page authoring form (`page.form.ts`) now offers only the kinds with a dedicated renderer — `list`, `record`, `home`, `app`, `utility` — with explicit labels, so the dropdown stops presenting dead options.

## 9.4.0

### Minor Changes

- 060467a: feat(ADR-0046): add optional `description` to package docs

  A doc can now carry a one-line `description` (frontmatter `description:`),
  giving the natural minimal model: title / summary / body. `DocSchema` gains an
  optional `description`; `os build` reads it from frontmatter. It travels in the
  `GET /meta/doc` list response (unlike `content`, which the list omits), so a
  docs portal can show summaries without fetching each body. Example docs
  (app-showcase, app-todo) updated.

  Also records the deferred-to-P3 design for doc **tags** in ADR-0046: tags are
  keys (i18n-resolved, never display strings), with a small protocol core
  vocabulary plus namespace-prefixed package tags — not a field to bolt on early.

- 0856476: feat(metadata): package-scoped single-item resolution via `?package=` (ADR-0048)

  A single-item metadata GET (`/meta/:type/:name?package=<id>`) now resolves
  package-scoped (prefer-local): when two installed packages ship an item of the
  same `type`/`name`, the requester's own package wins. Previously only the _list_
  endpoint was package-aware; a single-item fetch was context-free, so a
  cross-package collision always resolved to whichever package registered first.

  The fix threads `packageId` end-to-end:

  - `@objectstack/rest` — the cacheable single-item path called `getMetaItemCached`
    (ETag keyed on type+name only) and dropped `?package=`. A `?package=` read now
    bypasses that cache and takes the disambiguating `getMetaItem(type, name,
packageId)` path, so two same-named items never share one cache entry.
  - `@objectstack/objectql` — `protocol.getMetaItem` forwards `packageId` to the
    overlay query (`sys_metadata.package_id`), `MetadataFacade.get`, and
    `registry.getItem`; `MetadataFacade.get` gained an optional `currentPackageId`.
  - `@objectstack/runtime` — the parallel HTTP dispatcher threads `?package=` too.

  This lets the doc viewer (`/apps/:packageId/docs/:name`) resolve one doc scoped
  to its app, so `doc` names no longer need a namespace prefix for uniqueness (the
  prefix becomes a recommended convention, like `page`/`dashboard`/`report`);
  `doc.zod` doc-comments updated accordingly.

- b678d8c: feat(spec): page form filter-mode widget + ADR-0047 §3.4a (omit-is-none)

  The Interface section's `interfaceConfig` composite now lists its sub-fields
  explicitly so `userFilters` can use the dedicated `filter-mode` selector widget
  (None / Tabs / Dropdown, objectui). An unknown widget name degrades gracefully
  to the prior composite rendering, so this is independently mergeable.

  ADR-0047 §3.4a records the design decision: "no filter bar" is the ABSENCE of
  `userFilters`, not a literal `element: 'none'` — presence and style are
  orthogonal axes, keeping declarative metadata and overlay diffs clean. The
  `userFilters` element `'toggle'` is deprecated (kept in the enum for back-compat;
  authoring offers None/Tabs/Dropdown only, Airtable parity).

- b678d8c: feat(spec): ADR-0047 — list pages hide region/data-context, interface section prominent

  Reorganizes the page form (`page.form.ts`) so interface/list pages get a lean,
  relevant panel instead of the generic page-form dump:

  - Data Context + Layout sections gain `visibleOn` `data.type != 'list'` (region
    designer / page object don't apply to a list surface).
  - Interface section becomes primary content (`collapsed: false`, named for i18n).
  - `interfaceConfig` sub-fields reordered (common first, rare last); `source`
    gets the `ref:object` picker; `sourceView`/`userActions`/etc. gain helpText.
  - `type` field helpText notes `'list'` = interface page.

### Patch Changes

- b678d8c: fix(service-ai): resolve the current object for AI chat across languages

  The console assistant reported "can't find the X object" when asked to analyse
  the object on the current page — most visibly for non-English prompts. Three
  compounding gaps fixed:

  - `SchemaRetriever.tokenise()` dropped all CJK text, so a Chinese request
    yielded zero terms; it now emits CJK single-char + bigram terms.
  - Nothing fed the current object's schema to the agent, so "this object" could
    not be resolved without a lucky keyword hit. `AgentRuntime.buildContextSchema
Messages()` now injects the current object's schema into the system prompt and
    both chat routes call it.
  - `ToolExecutionContext` (and the `ai-service` spec contract) gains
    `currentObjectName`/`currentViewName`; routes thread them through and
    `query_data` falls back to the current object when keyword retrieval is empty
    (so the open edition, which lacks `describe_object`/`list_objects`, still
    resolves the page's object).

## 9.3.0

### Minor Changes

- 1ada658: ADR-0046 P1: package documentation as metadata. New `doc` metadata element — flat Markdown files under `src/docs/*.md` compile into `docs: DocSchema[]` on the stack and register like any other metadata.

  - spec: `DocSchema` ({ name, label?, content }) in `system/`, `StackDefinition.docs`, `doc` in `MetadataTypeSchema` + type registry (inert data, runtime-creatable) + canonical schema map, `docs → doc` plural mapping.
  - cli: `os build` collects flat `src/docs/*.md` (frontmatter `title:`/first `#` heading → label) and enforces the ADR lint — flat directory, namespace-prefixed snake_case names, namespace required when docs ship, MDX/image ban, same-package relative-link resolution. Same rules surface in `os lint`.
  - objectql: `docs` joins the generic metadata registration loop (manifest + nested plugins).
  - runtime: docs count as app payload; `GET /metadata/doc` list responses omit `content` by default (`?include=content` opts in) so unbounded manuals stay off hot paths.

- 290f631: ADR-0044 flow-level send-back-for-revision (#1744). The approval node gains a third flow movement beyond approve/reject: `sendBack()` finalizes the pending request as `returned` (new `ApprovalStatus`), resumes the run down its `revise` edge to a wait point where the record lock releases, and the submitter's `resubmit()` re-enters the approval node over a declared back-edge, opening the next round's request (fresh approver slate, re-locked, `round` stamped via the config snapshot). Engine: `FlowEdgeSchema.type` gains `'back'` — cycle validation now requires the graph _minus_ back-edges to be a DAG (unmarked cycles still rejected), node re-entry overwrites outputs/appends steps, a 100-re-entry runaway guard backstops misauthored loops, and `cancelRun(runId, reason)` lands as the first run-cancel primitive (recall crossing a revise window cancels the parked run). `maxRevisions` (default 3) on the approval node config auto-rejects send-backs past the budget. REST: `POST /approvals/requests/:id/revise` and `/resubmit`. Audit kinds `revise`/`resubmit` join `ApprovalActionKind` and the `sys_approval_action` enum.
- 50b7b47: Approvals server-side pagination + search pushdown (#1745). `listRequests` accepts `q` / `limit` / `offset` — free-text search pushes into the engine query as an `$or` of `$contains` terms (the `payload_json` snapshot carries record titles, so titles match without a join), and the page window pushes down whenever the filter is fully pushable; approver/status-array filters still post-filter their bounded scan and window in memory (the documented residual until the approver join-table follow-up). New `countRequests` returns the unwindowed total (engine `count` when pushable). REST: `GET /approvals/requests` gains `q`/`limit`/`offset` and returns `{data, total}` when paging.
- f15d6f6: ADR-0042 SLA auto-escalation + ADR-0041 mechanical landing. plugin-approvals now owns a jobs-backed escalation scanner (`runEscalations`, interval job `approvals-sla-escalation` + boot catch-up): overdue pending requests escalate **at most once** (the `escalate` audit row is the idempotency marker, written audit-first) executing the node's `escalation.action` — notify / reassign-to-`escalateTo` / auto_approve / auto_reject as the reserved actor `system:sla`. The trigger packages drop their `plugin-` prefix (`@objectstack/trigger-record-change`, `@objectstack/trigger-schedule`) per ADR-0041, and `ActionDescriptor` gains an optional `maturity: 'ga' | 'beta' | 'reserved'` field so designers can grey out contract-ahead-of-runtime surfaces.
- f8684ea: Approvals thread interactions — the collaboration layer between submit and decide. `reassign()` hands a pending-approver slot to someone else (audit-first ordering, new approver notified via the optional `messaging` service), `remind()` nudges every pending approver with a 4h per-request throttle (`THROTTLED` → HTTP 429), `requestInfo()` sends a request back to the submitter for more material while it stays pending, and `comment()` adds free-form thread replies. Rows expose `sla_due_at` (`created_at + escalation.timeoutHours`, display-only) and single reads attach `flow_steps` (the owning flow's approval trunk with done/current/upcoming states). REST grows the four matching POST routes; the `sys_approval_action.action` enum gains the new kinds.
- b4765be: Server-side totals for matrix reports (#1753). `queryDataset` selections accept `totals: { groupings: string[][] }` — each grouping a subset of `selection.dimensions` to additionally aggregate by (`[]` = grand total); the marginal rows come back on `AnalyticsResult.totals` in request order. Each subtotal/grand total re-runs the full executor pipeline (measure-scoped filters, derived measures, compareTo) grouped only by that subset, so totals use each measure's true aggregate over the underlying rows — an `avg` total is the average of all rows, never an average of bucket averages (the ADR-0021 line that forbids client-side re-aggregation). Dimension display labels resolve on totals rows the same as the primary grid. A matrix report renderer asks for `{ groupings: [rowDims, columnDims, []] }` and renders the supplied totals row/column.

### Patch Changes

- 3219191: ADR-0043 actionable approval links (#1743). `remind()` now fans out per approver: every concrete identity gets its own single-use approve/reject links in the notification payload. Tokens are 256-bit, stored as SHA-256 hashes only (`sys_approval_token`), scoped to one request + action + approver, 72h TTL, consumed-before-decide (replay burns), and re-validated at redemption against the live request (decided/recalled/reassigned ⇒ dead link). The plugin mounts a session-less bilingual confirm page at `GET /api/v1/approvals/act` (renders only — mail-gateway prefetch safe) and redeems exclusively on the `POST`, auditing the decision as the bound approver.

## 9.2.0

### Minor Changes

- 2f57b75: Approvals display contract v2 — no raw identifiers reach a business reviewer. The inbox enrichment pass now resolves the three remaining id leaks: `payload_display` resolves lookup/master_detail foreign keys in the snapshot to the referenced record's display title (batched one query per object), `pending_approver_names` resolves user-id approvers via `sys_user` (id or email; `role:<r>` literals stay as-is), `object_label` rides the target object's schema label on the row, and `listActions` rows carry `actor_name` so the audit timeline never shows an id.
- 2f57b75: ADR-0040: unify the platform assistant. The default `data_chat` agent becomes the single platform assistant carrying both the data and authoring registers — the end user never picks an agent. It gains the `metadata_authoring` and `solution_design` skills (registered by the cloud AI Studio plugin; data-only deployments degrade gracefully as the skill registry ignores unresolved names), an intent preamble that classifies build/change vs data intent first and applies that register's discipline without mixing registers or narrating failures, an 'Assistant' persona, temperature 0.2, a guardrail blocklist union minus `alter_schema`/`drop_table` (the build register is draft-gated schema work per ADR-0033), a 60s execution budget, and react ×10 planning with replan.

## 9.1.0

### Minor Changes

- b9062c9: ADR-0021 D2: `Report` gains `columns` (dimension names across — a `matrix` report pivots `rows` × `columns` with `values` in the cells; also on joined blocks) and `drilldown` (boolean, default `true` — click an aggregated row/cell to open the underlying records). `reportForm` surfaces both in the Dataset binding section (`columns` visible for matrix only).

## 9.0.1

### Patch Changes

- 1817845: reportForm now matches the 9.0 dataset-bound ReportSchema (ADR-0021): the authoring form declares `dataset` / `values` / `rows` / `runtimeFilter` instead of the removed query-form fields (`objectName` / `columns` / `groupingsDown` / `groupingsAcross` / `filter`), so editors no longer offer fields the schema strips at parse time.

## 9.0.0

### Major Changes

- 4c3f693: ADR-0021 single-form cutover (BREAKING): the inline analytics author surface is
  removed — every dashboard widget, report, and list-chart must now bind a
  semantic `dataset` and select dimensions/measures **by name**.

  Removed from the spec:

  - **DashboardWidget** — `object`, `categoryField`, `categoryGranularity`,
    `valueField`, `aggregate`, `measures` (and the `WidgetMeasure` schema/type).
    `dataset` + `values` are now required; `filter` is the presentation-scope
    runtimeFilter; `dimensions` / `compareTo` are retained.
  - **Report** — top-level (and joined-block) `objectName`, `columns`,
    `groupingsDown`, `groupingsAcross`, `filter`. A non-joined report now requires
    `dataset` + `values`; `rows` are the dimensions.
  - **ListChart** — `xAxisField`, `yAxisFields`, `aggregation`, `groupByField`.
    `dataset` + `values` are now required.

  Migration: replace the inline query with a `defineDataset(...)` and reference it
  by name. A flat record listing (the former `tabular` report / inline list) is an
  object-bound ListView (ADR-0017), not an analytics dataset. See
  `docs/adr/0021-analytics-dataset-semantic-layer.md` and the
  `content/docs/guides/analytics-datasets.mdx` guide.

- 1c83ee8: BREAKING: `ChartTypeSchema` drops 8 variant types that only rendered as their
  base chart, so the taxonomy now advertises only families the renderer draws
  distinctly.

  Removed: `grouped-bar`, `stacked-bar`, `bi-polar-bar` (→ bar — no multi-series
  grouping/stacking), `stacked-area` (→ area), `step-line`, `spline` (→ line),
  `pyramid` (→ funnel), `bubble` (→ scatter — no size encoding).

  Kept: bar / horizontal-bar / column, line / area, pie / donut / funnel, scatter,
  treemap / sankey, radar, table / pivot, and the single-value performance family
  (metric / kpi / gauge / solid-gauge / bullet — these render an honest value
  today and gain a dial when a gauge renderer lands).

  Migration: a widget/series using a removed type should switch to its base
  (`stacked-bar`→`bar`, `spline`→`line`, `pyramid`→`funnel`, `bubble`→`scatter`,
  etc.). These can return via an opt-in renderer once a real renderer + data model
  backs them.

### Minor Changes

- 0bf39f1: `queryDataset` now carries each measure's display `label` and `format` on the
  result `fields`, so presentations can show "Tasks" / "$616,000" instead of the
  raw measure name "task_count" / "616000".

  - `AnalyticsResult.fields[]` gains optional `label?` and `format?`.
  - The dataset executor enriches measure columns from the dataset's measure
    definitions (matching `<name>` and `<name>__compare`).

  The format can't be baked into the numeric row value (charts need the raw
  number), so the renderer applies it at display time.

### Patch Changes

- f533f42: Settings namespace environment overrides now use the canonical ObjectStack
  `OS_<NAMESPACE>_<KEY>` form, with no unprefixed aliases. For example,
  `ai.openai_base_url` is now `OS_AI_OPENAI_BASE_URL`, and
  `feature_flags.ai_enabled` is now `OS_FEATURE_FLAGS_AI_ENABLED`.

  The AI service now treats a stored or env-locked `provider=memory` setting as
  an explicit override, while the manifest default still leaves boot-time
  provider auto-detection intact.

  The auth plugin now binds the `auth` settings namespace to better-auth runtime
  configuration, exposes an extension hook for provider packages, and includes a
  basic Google sign-in implementation configured either in Setup → Authentication
  or by deployment-level `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## 8.0.1

## 8.0.0

### Minor Changes

- b990b89: fix(autonumber): one owner for autonumber generation — the persistent driver sequence (#1603)

  Autonumber values were generated in TWO places: the SQL driver's persistent,
  atomic `_objectstack_sequences` table AND a non-persistent in-memory counter in
  the ObjectQL engine. Because the engine pre-filled the field BEFORE calling the
  driver, the driver always saw a value already set and skipped — so the
  persistent sequence was effectively dead code, and a multi-instance / post-restart
  deployment could mint duplicate numbers from the in-memory counter.

  This makes generation single-owner:

  - **`@objectstack/spec`** — `DriverCapabilities` gains an optional `autonumber`
    flag: "driver natively generates persistent autonumber/sequence values".

  - **`@objectstack/driver-sql`** — advertises `supports.autonumber = true`.
    `bulkCreate()` now fills autonumber fields too (previously only `create()` /
    `upsert()` did), so bulk inserts also draw from the persistent sequence.
    Field parsing now honors either the spec-canonical `autonumberFormat` key OR
    the `format` shorthand (both appear in metadata).

  - **`@objectstack/objectql`** — when the driver advertises native autonumber
    support, the engine NO LONGER pre-fills (it defers entirely to the persistent
    driver sequence as the single source of truth). For drivers without native
    support (memory, mongodb) the in-memory fallback is unchanged. The fallback
    also now reads either `autonumberFormat` or `format`. Record-validation
    exempts `autonumber` fields from the `required` check — the value is
    runtime-owned and assigned after validation, so a required record number is
    never rejected as "missing".

  No metadata changes required. Existing data is respected: the driver bootstraps
  each sequence from the current max numeric tail on first use.

- 99111ec: Field-level conditional rules (CEL): `visibleWhen` / `readonlyWhen` / `requiredWhen`, enforced server-side.

  Add three CEL-predicate field props (over `record`) evaluated on both sides. **Spec**: `visibleWhen` / `readonlyWhen` / `requiredWhen` (`requiredWhen` canonical; `conditionalRequired` kept as a back-compat alias). **Server (objectql)**: the validator now enforces `requiredWhen`/`conditionalRequired` over the merged record (so the rule can't be bypassed by a direct API write), and the update path ignores writes to a field whose `readonlyWhen` is TRUE (keeps the persisted value). `needsPriorRecord` accounts for conditional fields so the prior record is fetched on update.

- d5a8161: feat(spec): resilientFetch — timeout + backoff for outbound HTTP (P1-1)

  Outbound calls in the connectors/embedder were naked `fetch` with no timeout or
  retry, so a slow or rate-limited external API could hang an agent turn with no
  recovery.

  New shared `resilientFetch` (`@objectstack/spec/shared`):

  - per-attempt timeout via `AbortController` (default 30s);
  - exponential backoff with jitter, up to 3 attempts, on network errors / 429 / 5xx;
  - honours a `Retry-After` header on 429;
  - never retries a caller-initiated abort (intentional cancellation).

  Wired into `connector-rest`, `connector-slack`, and `embedder-openai`.
  `connector-mcp` talks through the MCP SDK transport, so it gets a 30s per-request
  `timeout` on `callTool` / `listTools` instead.

  A stateful per-host **circuit breaker** is deliberately left as a follow-up:
  timeout + backoff already removes the hang/no-recovery risk.

- 5cf1f1b: feat(spec): `inlineEdit` on relationship fields for declarative master-detail

  A `master_detail`/`lookup` field can now declare `inlineEdit: true` (plus
  optional `inlineTitle` / `inlineColumns` / `inlineAmountField`) to mean "these
  child records are entered/edited inline within the parent's form". The intent
  lives in the data model: the parent's standard create/edit form then renders an
  atomic master-detail form (object fields + an editable child grid) with no form
  view config and no bespoke page. Use for line-item/composition children; leave
  off for associations (comments, attachments). Renderer support is in objectui.

- 9ef89d4: feat(spec): `FormViewSchema.subforms` for config-driven master-detail

  A form view can now declare inline child collections via `subforms`, so the
  standard create/edit form for an object can render as a master-detail form
  (object fields on top, an editable child grid below, persisted atomically)
  without a bespoke page. Each entry needs only `childObject`; the relationship
  FK and grid columns are derived from the child object's metadata (override via
  `relationshipField` / `columns`). Renderer support: ObjectForm already renders
  `subforms` (objectui), and the ObjectView form path passes them through.

- 9e2e229: feat(objectql): compute roll-up `summary` fields server-side

  The `summary` field type was declared in the spec but never computed — its value
  stayed empty. ObjectQL now recomputes roll-up summaries automatically: a parent
  field whose `summaryOperations` aggregates (`count`/`sum`/`min`/`max`/`avg`) a
  field across child records is recalculated whenever a child is inserted,
  updated, or deleted.

  - **`@objectstack/spec`** — `summaryOperations` gains an optional
    `relationshipField` (the child→parent FK). When omitted the engine
    auto-detects it from the child's `lookup`/`master_detail` field whose
    `reference` points back at the parent; set it explicitly only when the child
    has more than one such reference.

  - **`@objectstack/objectql`** — after `afterInsert` / `afterUpdate` /
    `afterDelete` on a child object, the engine finds the affected parent (from
    the child's FK, plus the prior FK on update/delete so a re-parented child
    updates both), re-aggregates the child collection, and writes the result onto
    the parent's summary field. It runs in the caller's execution context, so when
    a transaction is open (e.g. the cross-object `/api/v1/batch`) the rollup
    commits atomically with the child writes. A small index of child→summary
    descriptors is built lazily from the registry and invalidated on package
    registration.

  Empty collections roll up to `0` for `count`/`sum` and `null` for
  `min`/`max`/`avg`. This lets master-detail forms stop computing parent totals on
  the client — the server is now the single source of truth.

### Patch Changes

- a46c017: feat(ai): actions opt in to being AI tools via an `ai:` block (ADR-0011)

  Realigns ADR-0011 with its original opt-in design. An Action becomes an
  AI-callable tool only when its metadata sets `ai.exposed: true`, which requires
  an explicit, LLM-facing `ai.description` (≥40 chars, distinct from the UI
  `label`). There is no heuristic auto-exposure and no description derived from
  the label — a clean break from the first implementation's opt-out `aiExposed`
  flag, which is removed (no compatibility shim; the platform has not shipped).

  The `ai:` block also carries `category`, `paramHints` (per-parameter JSON-Schema
  refinement), `outputSchema` (summarised into the tool description for chaining),
  and `requiresConfirmation` (overrides the destructive-action HITL default).
  `AIToolDefinition` is extended to carry `category` / `outputSchema` / `objectName`
  / `requiresConfirmation`. The `@objectstack/service-ai` bridge
  (`action-tools.ts`) now gates on opt-in, merges `paramHints`, and emits a lint
  warning when an exposed destructive-looking action asserts itself safe via
  `ai.requiresConfirmation: false`.

- 3306d2f: feat(automation): surface structured-region body steps in run observability (#1505)

  `loop` / `parallel` / `try_catch` previously ran their body, branch, and handler
  regions against a region-local step log that was **discarded** — run logs
  (`listRuns` / `getRun`) showed the container as a single opaque step, hiding the
  per-iteration / per-branch steps that actually executed.

  `AutomationEngine.runRegion()` now **returns** its body steps, and the container
  node folds them into the parent run log via a new `NodeExecutionResult.childSteps`
  field. Each surfaced step is tagged with its **immediate** container via three new
  optional fields on `ExecutionStepLogSchema` (and the engine's `StepLogEntry`):

  - `parentNodeId` — the enclosing `loop` / `parallel` / `try_catch` node
  - `iteration` — zero-based loop iteration or parallel branch index
  - `regionKind` — `loop-body` | `parallel-branch` | `try` | `catch`

  Tagging fills only fields left undefined, so nested regions keep each step's
  innermost container. A failed try-region attempt's partial steps are still not
  surfaced (preserving `try_catch` retry semantics). Fully additive — existing run
  logs and consumers are unaffected.

- bc44195: chore(automation): retire the `workflow_rule` authoring paradigm (ADR-0018 M5 dropped)

  ADR-0019 already removed the Workflow-Rule → Flow compiler (Workflow Rules were
  removed in #1398 and `workflow` was reclaimed for state machines), but the
  `workflow_rule` paradigm tag survived in `ActionParadigmSchema` and on every
  built-in node descriptor. There is no declarative Workflow-Rule authoring view
  to feed, so the tag is now retired: `ActionParadigmSchema` keeps `['flow',
'approval']`, and the `http` / `notify` / `connector_action` descriptors (plus
  the deprecated-alias fallback) advertise `['flow', 'approval']`. Approval
  execution convergence is delivered by the ADR-0019 approval Flow node, not a
  compiler. ADR-0018's status and migration table are updated to mark M3 shipped,
  M4 framework-complete, and M5 dropped.

## 7.9.0

## 7.8.0

### Minor Changes

- 36719db: fix: AI-built apps are usable immediately — sync new object tables on publish + emit valid kanban config

  Two gaps found by end-to-end testing of an AI-built app:

  1. **A freshly-published object couldn't accept records until a server restart.** Publishing a drafted object registered it in the in-memory registry but never created its physical table (table sync only ran at boot), so inserts failed with `object_not_found` ("no such table"). Added `ObjectQL.syncObjectSchema(name)` (a targeted, idempotent single-object schema sync) and call it from the publish paths (`protocol.publishMetaItem` and `saveMetaItem` mode:'publish', via `ensureObjectStorage`). Best-effort + non-fatal. New objects are now CRUD-able the moment they're published.

  2. **AI-generated kanban views rendered as plain lists** (and sometimes failed validation). The blueprint `viewBody` emitted `list.type:'kanban'` with no `kanban` config; `KanbanConfigSchema` requires `groupByField` **and** `columns`. Added an optional `groupBy` to the blueprint view schema (lenient + strict) and have `apply_blueprint` set `list.kanban = { groupByField, columns }` — using the view's explicit `groupBy` when given, else inferring the object's first `select` field. AI-built kanban views now validate, publish, and carry a real group-by field.

### Patch Changes

- 06f2bbb: fix(ai): make ADR-0033 blueprint authoring work with OpenAI structured outputs

  Two bugs surfaced by a live end-to-end run (Studio chat → blueprint → draft → review → publish) against a real model (OpenAI via the Vercel AI Gateway) — both invisible to the existing unit tests:

  1. **`propose_blueprint` failed against OpenAI strict structured outputs.** `SolutionBlueprintSchema` uses optional fields and a free-form `seedData` record; OpenAI's strict mode requires every property listed in `required` and rejects open `additionalProperties`, so `generateObject` errored (`'required' … must include every key in properties`) and the agent silently fell back to free-text. Adds `SolutionBlueprintStrictSchema` — a strict-compatible mirror (optional → nullable, no `z.record`) used **only** as the `generateObject` output contract. The lenient `SolutionBlueprintSchema` (and every existing consumer/test) is unchanged; the blueprint tools strip the `null`s the strict contract emits so downstream stays clean.

  2. **Tool-only assistant turns failed to persist.** `ai_messages.content` is required, but an assistant turn that only calls a tool has no text, so the insert failed, the turn was dropped, and the next turn lost context (the agent re-proposed instead of applying the confirmed blueprint). `ObjectQLConversationService.addMessage` now synthesizes a readable placeholder from the tool names (`(called propose_blueprint)`) plus a defensive non-empty fallback.

  With both fixes the full plan-first loop runs end-to-end on OpenAI models: propose → confirm → batch-draft objects/views/dashboards/app → review/diff → publish.

- 424ab26: fix(seed): reject object-wrapped relationship references and constrain them at compile time

  Seed datasets resolve `lookup` / `master_detail` references by matching the value
  against the target record's externalId — so the value must be the plain natural-key
  string (e.g. `account: 'Acme Corp'`), never a wrapper object like
  `account: { externalId: 'Acme Corp' }`. The wrapper was silently skipped by the
  loader, fell through unresolved, and reached the SQL driver as a non-bindable value —
  masked on an always-empty `:memory:` DB but crashing on a persistent one with
  "SQLite3 can only bind numbers, strings, bigints, buffers, and null" once seeds re-ran
  as updates.

  - `defineDataset` now constrains reference fields to `string | null` at compile time
    (derived from each field's `type`), so the object form is a type error.
  - `SeedLoaderService` now fails loudly with an actionable message (and drops the value
    instead of handing it to the driver) when a reference is an object — consistent
    behavior across all drivers, no longer silently masked.

## 7.7.0

### Minor Changes

- b391955: feat(ai): blueprint app-building — propose/draft the navigation app, not just the data model

  The plan-first blueprint (ADR-0033 §4) now also designs the **app** (the navigation shell end users open in the App Launcher), so "build me a project-management application" yields an openable app — not just its objects, views, and dashboards.

  - `SolutionBlueprintSchema` (`@objectstack/spec/ai`) gains an optional `app: { name, label?, icon?, nav? }`, where each nav entry targets a created object or dashboard. `nav` may be omitted to auto-surface every object (then dashboard).
  - `apply_blueprint` expands the app into an `AppSchema` body (single-level `navigation` of object/dashboard items) and drafts it last — through the same draft-gated, per-type-validated `stageDraft` path as everything else. It never sets `isDefault`.
  - `propose_blueprint` now asks the agent to include the app and reports `counts.app`.

  Still draft-gated: nothing is live until the human publishes. Scope is basic app-building (one app, flat nav); areas/groups/mobile-nav remain author-it-later via `update_metadata`.

- f06b64e: feat(ai): ADR-0033 Phase C — plan-first blueprint authoring

  For high-level goals ("build me a project-management system") the metadata assistant now designs before it builds. Adds a `SolutionBlueprintSchema` (`@objectstack/spec/ai`) describing proposed objects, fields, relationships, views, dashboards, and seed data with stated assumptions, plus two tools:

  - `propose_blueprint(goal)` — emits a structured blueprint via structured output. **Nothing is persisted**; the agent presents it for conversational confirmation and asks at most 1–2 structure-deciding questions.
  - `apply_blueprint(blueprint)` — only after the human approves, batch-drafts every artifact through the Phase A draft path (`protocol.saveMetaItem({mode:'draft'})`), validated per-type and partial-tolerant (a bad item is reported, the rest still draft). Seed data is reported as proposed, not auto-applied (no runtime `dataset` type).

  A new `solution_design` skill carries the plan-first instructions and is bound to `metadata_assistant` alongside `metadata_authoring`. The shared draft-write primitive is exported from the metadata tools as `stageDraft` and reused, keeping one draft-write path.

- 023bf93: fix(spec): reject unknown top-level keys on `ObjectSchema.create()` (#1535)

  `ObjectSchemaBase` is a plain `z.object({...})` (Zod default `.strip()`), so any
  unknown top-level key passed to `ObjectSchema.create()` — `workflows`, a typo'd
  `validation`/`indexs`, etc. — was discarded silently: no error, no warning, and a
  green `tsc`. Declarative metadata an author believed they shipped (e.g. object-level
  `workflows: [...]`) vanished from every built artifact, dead from day one. This is the
  metadata-shape analogue of ADR-0032's "no silent failure" principle.

  `create()` now rejects unknown top-level keys with a precise, fixable build error that
  names the offending key(s), suggests the intended key on a likely typo
  (`validation` → `validations`), and — for known-confusable keys like `workflows` —
  points authors at the supported mechanism (a lifecycle hook `src/objects/<name>.hook.ts`
  or a top-level `record_change` flow; there is no object-level `workflows[]` field). The
  factory signature also constrains excess keys to `never`, so the mistake is caught at
  `tsc` time as well as at build.

  The non-strict `ObjectSchema.parse()` load path (registry/artifact validation) is
  unchanged.

  Also fixes two platform objects (`sys_secret`, `sys_setting_audit`) that carried
  silently-stripped `views`/`scope`/`defaultViewName` keys: their intended list views are
  migrated to the supported `listViews` field (`type: 'list'` → `'grid'`) so they now
  render instead of being dropped. The `objectstack-data` skill's CRM blueprint no longer
  teaches the non-existent `workflows[]` shape.

## 7.6.0

### Minor Changes

- 955d4c8: ADR-0018 M3: unified `http` / `notify` executors backed by a generic HTTP outbox.

  Promotes a reliable outbound-HTTP delivery outbox into `service-messaging` (the
  raw-callout counterpart to the notification outbox) and routes the Flow `http`
  node through it — closing the "`http_request` is a bare `fetch()` with no retry"
  gap. The five divergent outbound verbs collapse onto canonical `http` / `notify`.

  **`@objectstack/service-messaging` (additive):**

  - `IHttpOutbox` / `HttpDelivery` generic raw-callout shape
    (`source` / `refId` / `dedupKey` / `label` / `signingSecret`), `SqlHttpOutbox`
    over a new `sys_http_delivery` object, `MemoryHttpOutbox`, `HttpDispatcher`
    (per-partition cluster lock, claim/ack/retry/dead-letter), and a shared
    `sendOnce` + 7-step jittered retry schedule.
  - `MessagingService` gains `setHttpOutbox()` / `isHttpDeliveryReady()` /
    `enqueueHttp()`; the plugin wires the outbox + dispatcher at `kernel:ready`.

  **`@objectstack/service-automation`:**

  - Canonical `http` executor — `durable: true` enqueues onto the messaging HTTP
    outbox (retry/dead-letter); otherwise an inline `fetch()` preserving
    `http_request`'s request/response semantics.
  - `engine.registerNodeAlias()` — registers a delegating executor + a
    `deprecated` / `aliasOf` descriptor. `http_request` / `http_call` / `webhook`
    are now deprecated aliases of `http`; existing flows keep running.
  - `notify` descriptor marked `needsOutbox` (its delivery is outbox-backed).

  **`@objectstack/spec`:** `flow.zod` adds `http` to the builtin node-type seed set.

  `plugin-webhooks` cut-over to the shared outbox is a deliberate follow-up.

- b046ec2: feat(automation): BPMN ⇄ structured-construct model mapping (ADR-0031, task 5)

  Add the semantic bridge between the structured control-flow constructs (the
  native model) and the BPMN gateway/boundary/multi-instance vocabulary (kept for
  interop only), at the **flow-model level** — independent of any wire format
  (`automation/bpmn-mapping.ts`):

  - `exportConstructsToBpmn(flow)` expands each construct into its BPMN
    interchange shape — `parallel` → `parallel_gateway` (AND-split) + branch
    regions + `join_gateway` (AND-join); `try_catch` → the protected activity +
    an error `boundary_event` + the handler region; `loop` → its body marked with
    multi-instance loop characteristics — so external BPM tools see a well-formed
    BPMN graph. Each expansion's anchor carries an `osConstruct` extension marker.
  - `importBpmnToConstructs(flow)` folds that BPMN shape back into the constructs:
    exact reconstruction from the `osConstruct` marker (so `construct → BPMN →
construct` is identity), and a best-effort structural fold of foreign
    `parallel_gateway`/`join_gateway` pairs, with diagnostics for shapes it can't
    safely fold.

  BPMN 2.0 **XML** (de)serialization layers on top of this mapping and remains a
  plugin concern (per `bpmn-interop.zod.ts`), out of scope here.

- 2170ad9: client SDK: add `approvals` namespace; remove dead workflow approve/reject surface (ADR-0019)

  ADR-0019 collapsed approval into Flow: approval is no longer a workflow step but
  a first-class **flow node** that opens a request and suspends the run, with a
  human decision resuming the flow down the matching `approve` / `reject` edge.
  The server already exposes this as a dedicated `/api/v1/approvals` surface
  (`registerApprovalsEndpoints`), but the client SDK still carried the old
  approval-on-`workflow` methods, which pointed at routes that never existed.

  - **`@objectstack/client`** gains a `client.approvals` namespace backed by the
    real REST surface:

    - `listRequests(filter?)` → `GET /approvals/requests` (the "my approvals"
      inbox; filter by `status` (single or array), `object`, `recordId`,
      `approverId`, `submitterId`).
    - `getRequest(id)` → `GET /approvals/requests/:id`.
    - `approve(id, { actorId?, comment? })` / `reject(id, …)` →
      `POST /approvals/requests/:id/{approve,reject}` (records a decision and
      resumes the owning flow run).
    - `listActions(id)` → `GET /approvals/requests/:id/actions` (audit trail).

    The approval runtime types (`ApprovalRequestRow`, `ApprovalActionRow`,
    `ApprovalStatus`, `ApprovalDecisionInput`, `ApprovalDecisionResult`) are
    re-exported so consumers can type the namespace without reaching into
    `@objectstack/spec`.

  - **Removed the dead workflow approve/reject surface.** `client.workflow.approve`
    / `client.workflow.reject` and the backing `WorkflowApprove*` / `WorkflowReject*`
    protocol schemas, types, `IProtocolService` methods, and the `/approve` /
    `/reject` entries in `DEFAULT_WORKFLOW_ROUTES` are gone — approval decisions
    are no longer recorded on a workflow record. `workflow` is reclaimed for state
    machines, so `getConfig` / `getState` / `transition` are unchanged.

  - Discovery advertises the new route key: `ApiRoutesSchema.approvals`.

- 7648242: Enforce every declared validation-rule type on the write path; trim the three that can't be (#1475).

  The `validations` union advertised nine rule types but only three (`state_machine`,
  `cross_field`, `script`) ran on insert/update — the other six were accepted by the
  schema yet silently did nothing. This closes that gap on both sides: implement the
  synchronous types, and trim the ones that don't belong in a write-path rule.

  **`@objectstack/objectql` (additive):** the rule evaluator now enforces three more
  types, all deterministic, synchronous, side-effect-free predicates over one record:

  - `format` — a field value against a `regex` and/or a named format
    (`email` / `url` / `phone` / `json`). Runs only when the write touches the field
    and the value is non-empty; a malformed regex fails open.
  - `json_schema` — a JSON field validated against a JSON Schema via `ajv` (compiled
    result memoised per schema). Accepts a parsed object or a JSON string; an
    unparseable string is itself a violation; an uncompilable schema fails open.
  - `conditional` — evaluates `when`, then recurses into `then` / `otherwise`. The
    nested rule supplies the message; the outer conditional's `severity` decides
    blocking. `needsPriorRecord` now recurses into conditional branches.

  Adds `ajv` as a dependency and three error codes (`invalid_format`, `invalid_json`,
  `json_schema_violation`).

  **`@objectstack/spec` (breaking for unused declarations):** removes the
  `unique`, `async`, and `custom` validation-rule variants (and the
  `UniquenessValidationSchema` / `AsyncValidationSchema` / `CustomValidatorSchema`
  exports). They were never enforced and each needs I/O or a handler model a
  write-path rule must not carry. Use the layer that already does each correctly:
  uniqueness → a unique index (`ObjectSchema.indexes`, `partial` for scope) or
  field-level `unique: true`; async/remote → the client form layer; custom code →
  a `beforeInsert` / `beforeUpdate` lifecycle hook. Field-level `unique: true` is
  unaffected.

  `examples/app-showcase` demonstrates and verifies each newly-enforced type. See the
  ADR-0020 addendum for the rationale.

- 60f9c45: feat(automation): structured control-flow constructs (ADR-0031) — loop container

  Adopt structured control-flow as the native, AI-authored flow model (ADR-0031),
  choosing representation **(B) nested sub-structure**: containers carry their body
  as a self-contained single-entry/single-exit region in `config`.

  - **spec**: new `automation/control-flow.zod.ts` defining the `loop` container
    (`config.body`), `parallel` block (`config.branches[]`, implicit join), and
    `try/catch/retry` (`config.try`/`config.catch`/`config.retry`) configs, plus
    region well-formedness analysis (`analyzeRegion`, `findRegionEntry`) and
    `validateControlFlow` (single-entry/single-exit, acyclic; bounded loop).
  - **engine**: `registerFlow()` now rejects malformed control-flow regions before
    a flow can run; new `AutomationEngine.runRegion()` executes a body region in
    the enclosing variable scope without touching the shared DAG traversal.
  - **loop executor**: replaces the no-op `loop` stub with a real iteration
    container — binds the iterator/index variables and runs the body once per item
    under a hard max-iteration guard. Legacy flat-graph loops (no `config.body`)
    keep working — the construct is additive.

  Parallel-block and try/catch _engine execution_ and BPMN interop mapping remain
  follow-ups (issue #1479, tasks 3–5).

### Patch Changes

- c4a4cbd: ADR-0032 (phase 1): validate-by-default expression layer — no silent failure.

  Kills the #1491 class where a malformed predicate (e.g. the `{record.x}`
  template-brace-in-CEL mistake) silently evaluated to `false` and made a flow
  "fire" with no effect:

  - **service-automation**: flow `evaluateCondition` no longer swallows CEL
    failures to `false` — it throws an attributed, corrective error; and
    `registerFlow` now parse-validates every predicate (start/decision/edge
    condition) at registration, failing loudly with the offending location +
    source + the fix.
  - **formula**: new shared validator — `validateExpression(role, src, schema?)`,
    `introspectScope`, `CEL_STDLIB_FUNCTIONS` — with schema-aware field-existence
    - did-you-mean. The `{{ }}` template engine gains a formatter whitelist
      (`currency`/`number`/`percent`/`date`/`datetime`/`truncate`/`upper`/`lower`/
      `default`/…) with defined value→string semantics; arbitrary logic in holes is
      rejected. Plain `{{ path }}` stays back-compatible.
  - **cli**: `objectstack compile` validates every flow / validation-rule /
    field-formula predicate against the resolved object schema and fails the
    build with located, corrective messages.
  - **service-ai**: new agent-callable `validate_expression` tool so authoring
    agents self-correct before committing.
  - **spec**: fix the `FlowSchema` JSDoc example that taught the bad
    `condition: "{amount} < 500"` single-brace form.

- 02d6359: docs(automation): document ADR-0031 control-flow constructs; fix dangling reference card

  - **guide**: `content/docs/guides/metadata/flow.mdx` now documents the structured
    control-flow constructs — the `loop` container, `parallel` block (implicit
    join), and `try_catch` (try/catch/retry) — with config examples and the
    region/DAG model. The Node Types table is updated accordingly.
  - **doc generator**: `build-docs.ts` now cards only reference pages that were
    actually generated. Control-flow's schemas embed CEL-expression transforms
    (like `Flow`/`FlowEdge`) and so have no JSON-Schema page; the index previously
    carded every `.zod.ts`, producing a dangling "Control Flow" 404 link. Cards
    now align with `meta.json` (generated pages only).

- 8fa1e7f: Fix the docs generator (`build-docs.ts`) leaking an unmatched `<` / `{` into generated MDX, which broke the `apps/docs` Turbopack build (e.g. a SemVer range `">=4.0 <5"` in a `.describe()` string was read as the start of a JSX tag). Unmatched openers are now emitted as HTML entities (`&lt;` / `&#123;`); union-variant descriptions also go through the escaper.
- 55866f5: Fail loud instead of silently minting an ephemeral encryption key; ship a persistent env-master-key provider as the default (#1507).

  The default `ICryptoProvider` backs every secret-at-rest in the platform —
  encrypted settings (`sys_setting.value_enc`), ObjectQL `secret` fields, and
  runtime datasource credentials. Its key resolution previously fell back,
  **silently**, to a fresh per-process `randomBytes(32)` key (or auto-minted a
  new on-disk key on every boot) when no stable key was available. In an
  ephemeral-FS container or a multi-node cluster, each restart / each node then
  encrypts under a different key, and every previously-written `sys_secret` value
  becomes undecryptable. The failure was invisible at encrypt and boot time and
  only surfaced later as "all my saved passwords / API keys / DB credentials
  fail to decrypt".

  - **Renamed `InMemoryCryptoProvider` → `LocalCryptoProvider`.** The old name
    implied an ephemeral key when the provider in fact persists one.
    `InMemoryCryptoProvider` stays as a deprecated alias for backward
    compatibility.
  - **Added `OS_SECRET_KEY`** as the canonical production master key (32-byte
    hex or base64), the documented production default. `OS_DEV_CRYPTO_KEY`
    remains the dev convenience key.
  - **Fail-loud in production.** When `NODE_ENV=production` and no stable key
    source (env var or a pre-existing persisted file) is available, the provider
    now throws an actionable error at construction instead of generating a key —
    turning silent data-loss into a config error at boot. It never auto-mints a
    key in production. Development and test keep the ergonomic fallback
    (persisted dev key / ephemeral test key).
  - `serve` surfaces the production-key error verbatim and refuses to wire an
    unstable provider for `secret` fields.

  KMS / Vault providers (managed custody, per-tenant keys, automatic rotation)
  remain future/enterprise plug-ins behind the same `ICryptoProvider` seam;
  "your stored secret is still there after a reboot" stays open-source.

## 7.5.0

## 7.4.1

## 7.4.0

### Minor Changes

- 23c7107: ADR-0020 — converge the three "state machine" declaration shapes to one
  **enforced** `state_machine` validation rule.

  Before this change a record state machine could be declared three ways (a
  `workflow` metadata type, an `object.stateMachines` map, or a `state_machine`
  validation rule) and **none of them were enforced at runtime** — a declarative
  guardrail that was pure decoration, and a hallucination trap for AI authors.

  **Enforcement (`@objectstack/objectql`)**

  - New `validation/rule-validator.ts` evaluates the object's `validations` union
    on the write path: `evaluateValidationRules`, `needsPriorRecord`, and the
    `legalNextStates` introspection helper (all exported from the package root).
  - `state_machine` rules reject illegal `field` transitions on update (with the
    rule's `message`); `script` / `cross_field` predicate rules now also fire
    (they were silently broken on PATCH updates because only the patch, not the
    prior record, was available). The engine plumbs the prior record into
    rule evaluation on single-row update; multi-row (`updateMany`) updates log a
    warning and skip rule evaluation rather than enforce on incomplete data.

  **Convergence / retirement (`@objectstack/spec`) — breaking**

  - Retires the `workflow` metadata type (removed from the metadata-type enum,
    the registry, the schema map, the `workflows` collection key, and the
    plural→singular mapping).
  - Removes the `object.stateMachines` map and the `stack.workflows` array. The
    `state_machine` validation rule is the single canonical home.
  - The XState-style `StateMachineSchema` file is **kept** (still used by the
    agent conversation lifecycle and the discovery protocol); only its role as
    the `workflow` metadata-type backing schema was removed. The optional
    `workflow` **RPC service** surface (`CoreServiceName.workflow`,
    `/api/v1/workflow`, `IWorkflowService`) is kept as a documented follow-up.

  **Introspection (`@objectstack/runtime`)**

  - Adds `GET /metadata/objects/:name/state/:field?from=:state`, returning the
    legal next states for a field (`next: null` when no FSM governs the field,
    `[]` for a declared dead-end) so UIs/agents read the transition table instead
    of re-deriving it.

  **Surfaces (`@objectstack/platform-objects`, `@objectstack/cli`)**

  - Studio drops the standalone "Workflow Rules" nav (state machines are edited
    alongside the object's other validation rules).
  - `explain` no longer lists `workflow` as a related metadata type.

  Migration: replace a `workflow` / `StateMachineConfig` declaration with a
  `state_machine` validation rule on the object (`field` + `{ from: [allowedTo] }`
  transition table), and move any side-effecting actions (emails, task creation)
  into a record-triggered or scheduled Flow (ADR-0019). See the migrated
  `examples/app-crm` flows for the pattern.

- c72daad: ADR-0029 D7 — Setup app navigation contributions.

  Adds the UI-layer analog of object `own`/`extend`: a package can contribute
  navigation items into an app it does not own, so a shared admin app can be a
  thin shell while each capability plugin ships the menu for the objects it owns.

  - **`@objectstack/spec`** — new `NavigationContributionSchema` (`{ app, group?,
priority, items }`) and an optional `navigationContributions` field on the
    manifest.
  - **`@objectstack/objectql`** — `SchemaRegistry.registerAppNavContribution()`
    plus lazy merge in `getApp` / `getAllApps` (by target group id + priority,
    cloning so the stored app is never mutated); the engine wires
    `manifest.navigationContributions` during app registration.
  - **`@objectstack/platform-objects`** — the Setup app becomes a **shell** of
    empty group anchors; its entries for platform-objects-owned objects move to
    `SETUP_NAV_CONTRIBUTIONS`.
  - **`@objectstack/plugin-auth`** — registers `SETUP_NAV_CONTRIBUTIONS` alongside
    the Setup app it already registers.
  - **`@objectstack/plugin-webhooks`** — contributes its `Webhooks` /
    `Webhook Deliveries` entries into the Setup `group_integrations` slot (it owns
    `sys_webhook` / `sys_webhook_delivery` per K2.a), demonstrating end-to-end
    cross-plugin contribution.

  The rendered Setup nav is identical to the former static artifact — just
  assembled from its owners. A disabled/absent capability contributes nothing and
  its slot stays empty (in addition to the existing `requiresObject` gating).
  This unblocks moving each remaining K2 domain's menu out of the monolith with
  its objects.

- f115182: ADR-0019 — App as the consumer-facing unit. The consumer Marketplace surfaces
  exactly one user-visible noun, the App.

  - Adds `CONSUMER_INSTALLABLE_TYPES` and `isConsumerInstallable(type)` (the single
    source of truth for "what a consumer can install").
  - Constrains `MarketplaceListingSchema.packageType` to `CONSUMER_INSTALLABLE_TYPES`
    (default `app`) so a non-App (driver/server/plugin/…) listing cannot be
    represented — the "consumers see only Apps" guarantee is enforced in the data
    contract, not a forgettable query filter.
  - `defineStack()` now enforces **at most one App per package**: a package with
    `manifest.type === 'app'` may not define more than one app — the banned "suite
    contains apps" shape throws with a clear fix (fold into one app with multiple
    tabs, or split into separate packages). Zero apps is allowed; non-`app`
    package types are unconstrained. Non-breaking for existing stacks.

  The package `type` enum is unchanged; the additions are non-breaking. No
  runtime/registry/execution changes.

- 2faf9f2: External Datasource Federation (ADR-0015) — Phase 1.

  Adds the spec foundation and the DDL gate for federating mature external
  databases without ObjectStack ever mutating their schema:

  - `Datasource.schemaMode` (`managed` | `external` | `validate-only`) and
    `Datasource.external` settings, with a cross-field invariant.
  - `Object.external` binding (remote table/schema, writability, column map).
  - Shared error contract: `ExternalSchemaMismatchError`,
    `ExternalWriteForbiddenError`, `ExternalSchemaModeViolationError`
    (stable `code`s) + structured `SchemaDiffEntry` rendering.
  - `driver-sql` DDL gate: schema-mutating DDL (`initObjects`/`syncSchema`/
    `dropTable`) is rejected when `schemaMode !== 'managed'`.

  All changes are additive and backward-compatible (`schemaMode` defaults to
  `'managed'`).

- 2faf9f2: External Datasource Federation (ADR-0015) — Phase 2 (service core).

  Adds the federation service contract, the type-compatibility matrix, and a
  new service package that introspects, drafts, and validates federated
  objects:

  - `@objectstack/spec`:
    - `data/type-compat.ts` — dialect-aware SQL↔field-type matrix
      (`canonicalizeSqlType`, `suggestFieldType`, `isCompatible`) for
      postgres/mysql/sqlite/snowflake/bigquery/mongo.
    - `contracts/external-datasource-service.ts` — `IExternalDatasourceService`
      plus `RemoteTable`, `GenerateDraftOpts`, `ObjectDraft`,
      `SchemaValidationResult`/`Report`.
  - `@objectstack/service-external-datasource` (new): implements the service —
    `listRemoteTables`, `generateObjectDraft` (renders a reviewable
    `*.object.ts` with `// REVIEW:` markers), `validateObject`/`validateAll`
    (structured `SchemaDiffEntry` diffs), and `refreshCatalog`. Decoupled from
    the kernel via injected I/O; kernel plugin registers it as the
    `external-datasource` service.

  REST routes and the `os datasource` CLI commands follow in a subsequent
  slice.

- 2faf9f2: External Datasource Federation (ADR-0015) — Phase 3 spec: `external_catalog`
  metadata type.

  - Registers `external_catalog` in `MetadataTypeSchema` and
    `DEFAULT_METADATA_TYPE_REGISTRY` (system domain, `allowRuntimeCreate: true`,
    not org-overridable).
  - Adds `data/external-catalog.zod.ts` — `ExternalCatalogSchema` /
    `ExternalTableSchema` / `ExternalColumnSchema` for persisting a cached
    remote-schema snapshot of a federated datasource (consumed by
    `refreshCatalog`, the boot-validation gate, and Studio's schema browser).

- ff3d006: Screen-flow runtime — interactive `screen` nodes (suspend → render → resume).

  A `screen` node that declares input fields now suspends the run on entry
  (reusing the ADR-0019 durable pause), surfaces a `ScreenSpec` describing the
  form, and resumes with the collected values applied as **bare** flow variables
  so downstream nodes read them via `{var}`. (`waitForInput: false` forces the
  old server pass-through.)

  - **spec**: `AutomationResult.screen?: ScreenSpec`, `ResumeSignal.variables?`
    (bare vars), `IAutomationService.getSuspendedScreen?(runId)`.
  - **service-automation**: the `screen` executor builds the `ScreenSpec` and
    suspends when fields are present; the suspend/resume plumbing threads the
    screen through `FlowSuspendSignal` → `SuspendedRun` → the paused result;
    `resume()` sets `signal.variables` as bare flow variables; `getSuspendedScreen`.
  - **runtime**: `POST /api/v1/automation/:name/runs/:runId/resume` (body
    `{ inputs }`) and `GET …/runs/:runId/screen`, wired through both the
    dispatcher route table and `handleAutomation`.

  Verified end-to-end headlessly: the showcase Reassign Wizard launches → pauses
  at the "New Assignee" screen → resumes with the input → the task is reassigned.
  The objectui `FlowRunner` UI that renders these screens ships separately.

- 5e831de: Seed data: first-class identity binding + loud failures (fixes #1389)

  Records seeded via `defineDataset` / `defineStack({ data })` can now bind to a
  platform user with `cel\`os.user.id\``(and to the org with`cel\`os.org.id\``),
  which previously never resolved at boot.

  - **`os.user` / `os.org` now actually resolve.** The runtime provisions a
    deterministic, non-loginable system user (`usr_system`, role `system`)
    _before_ any seed runs and binds it to `os.user`, so identity-derived seed
    values resolve even on a fresh boot — before the first human sign-up. The
    human login admin remains a separate better-auth identity and need not own
    seed data. Exposed as the canonical `SystemUserId.SYSTEM` constant.
  - **New `SeedLoaderConfig.identity`** carries the `os.user` / `os.org` subject
    into CEL evaluation (`@objectstack/spec`).
  - **Failures are loud, not silent.** A record whose CEL value can't resolve
    (e.g. a required `cel\`os.user.id\`` with no identity) — or that fails to
    write — is now counted as an error, marks the load unsuccessful, and logs an
    actionable message, instead of being silently dropped.

### Patch Changes

- 58b450b: Make metadata labels follow the active UI language without a page refresh (#1319).

  The client now carries the active locale on every request (`Accept-Language`,
  `setLocale`/`getLocale`), the protocol ETag is locale-aware so cached metadata
  no longer collides across languages, and the `client-react` metadata hooks
  refetch when the locale changes. The `apps/account` console wires its router
  locale through so a language switch relabels server-resolved object/field/view
  labels in place instead of leaving the UI half-translated until reload.

- 82eb6cf: Fix system-metadata translations: locale fallback, app/dashboard localization, and coverage gaps.

  Switching the UI language left many surfaces in English. Three root causes
  are addressed:

  - **Locale fallback (server).** The metadata translation resolver
    (`@objectstack/spec` `i18n-resolver`) now resolves a requested locale
    against the locales actually present in the bundle (exact →
    case-insensitive → base-language → variant), so a request for `zh`
    correctly hits the `zh-CN` bundle instead of falling back to English.
    This mirrors `resolveLocale` in `@objectstack/core` and benefits every
    resolver (objects, views, actions, settings, metadata forms).

  - **App & dashboard localization (server).** Added `translateApp` and
    `translateDashboard` resolvers and wired `app`/`dashboard` into the REST
    `/meta` translation path. App labels, sidebar/navigation group labels,
    and dashboard titles/widgets were previously never localized at the API
    boundary even though the translation data existed.

  - **Coverage & quality (data).** Added translations for the previously
    untranslated platform objects `sys_share_link`, `sys_view_definition`,
    and `sys_metadata_audit` (and registered them in the i18n-extract config
    so future extractions keep them). Replaced English placeholder strings
    left in the `zh-CN` / `ja-JP` / `es-ES` object and metadata-form bundles
    (notably action `confirmText` / `successMessage` prompts). Added the
    missing `es-ES` built-in Settings bundle in `@objectstack/service-settings`.

- 13d8653: Record-change flow trigger — auto-launch flows on data mutations.

  Completes the automation engine's `FlowTrigger` extension point so flows whose
  `start` node declares a record-change trigger (`config: { objectName,
triggerType: 'record-after-update', condition }`) actually fire on the matching
  mutation. Previously the slot was dead — nothing called `trigger.start` — so
  such flows could only run via a manual `engine.execute()`.

  **Engine baseline (`@objectstack/service-automation`)**

  - Redefines `FlowTrigger` around a parsed `FlowTriggerBinding` (flowName,
    object, event, condition, schedule, raw config). The engine parses the start
    node and hands the trigger a normalized binding, keeping trigger plugins
    decoupled from flow-definition internals (mirrors `connector_action` ↔
    `connector-rest`).
  - Ordering-independent, bidirectional wiring: `registerFlow`/`toggleFlow`
    activate bindings; `registerTrigger` retro-binds already-registered flows (a
    trigger plugin wires up on `kernel:ready`, after flows are pulled in);
    `unregisterFlow`/`unregisterTrigger`/disable tear them down.
  - Centralized start-condition gate in `execute()`: the start node's `condition`
    (e.g. `status == 'done' && previous.status != 'done'`) is evaluated once for
    every trigger type and manual runs; false ⇒ `{ skipped: true }`.
  - Seeds `record`, flattened record fields, and `previous` into flow variables.
  - New `getActiveTriggerBindings()` getter + exports `FlowTriggerBinding`.

  **Spec (`@objectstack/spec`)**

  - Adds `previous?` to `AutomationContext` — the pre-update "old" row, so flows
    can gate on transitions.

  **New package (`@objectstack/plugin-trigger-record-change`)**

  - The concrete trigger: subscribes to ObjectQL lifecycle hooks
    (`record-after-update` → `afterUpdate`, etc.), builds an `AutomationContext`
    from the new/old record, and runs the flow. Error-isolated (a flow failure
    never breaks the CRUD write); graceful degrade when the automation service or
    ObjectQL engine is absent (mirrors `plugin-audit`).

  The `schedule` trigger (ticker/cron + `sys_job` lifecycle) is a follow-up.

## 7.3.0

### Minor Changes

- 5e7c554: **Rename kernel plugin-sandbox permission schemas to remove a naming footgun** (issue #1383).

  `@objectstack/spec/kernel` exported `PermissionSchema` / `PermissionSetSchema`
  (and the `Permission` / `PermissionSet` types) for the plugin-sandbox security
  model. Their names collided with the metadata-protocol permission set exported
  from `@objectstack/spec/security` (`PermissionSetSchema`), making it very easy
  to validate the `permission`/`profile` metadata type against the wrong schema
  and reject every legal payload.

  The kernel symbols are now prefixed with `Plugin` to reflect their specialized
  semantics:

  | Old (`@objectstack/spec/kernel`) | New                         |
  | :------------------------------- | :-------------------------- |
  | `PermissionSchema`               | `PluginPermissionSchema`    |
  | `PermissionSetSchema`            | `PluginPermissionSetSchema` |
  | `Permission` (type)              | `PluginPermission`          |
  | `PermissionSet` (type)           | `PluginPermissionSet`       |

  The metadata `permission`/`profile` types are unchanged — keep using
  `PermissionSetSchema` from `@objectstack/spec/security`.

## 7.2.1

## 7.2.0

## 7.1.0

### Minor Changes

- 47a92f4: Promote `email_template` to a first-class metadata type using the canonical
  `EmailTemplateDefinitionSchema`.

  Previously `email_template` had two competing Zod schemas (Prime Directive
  #8 violation): the legacy `EmailTemplateSchema` (a sub-shape of
  `Notification`) and the richer `EmailTemplateDefinitionSchema`. The runtime
  metadata protocol (`packages/objectql/src/protocol.ts`) and Studio's
  property panel registered the legacy one, which is why all the new fields
  (`name`, `label`, `category`, `locale`, `bodyHtml`, `bodyText`, …) were
  reported as “declared in form layout but missing from schema”.

  This change:

  - Repoints the `email_template` entry in `TYPE_TO_SCHEMA`
    (`packages/objectql/src/protocol.ts`) and in
    `BUILTIN_METADATA_TYPE_SCHEMAS`
    (`packages/spec/src/kernel/metadata-type-schemas.ts`) to
    `EmailTemplateDefinitionSchema`. The legacy `EmailTemplateSchema` is
    kept only as an inline sub-shape inside `Notification`.
  - Adds an `emailTemplates` collection to `defineStack()` input
    (`packages/spec/src/stack.zod.ts`), registers it in
    `MAP_SUPPORTED_FIELDS`/`PLURAL_TO_SINGULAR`
    (`packages/spec/src/shared/metadata-collection.zod.ts`), wires it into
    `ARTIFACT_FIELD_TO_TYPE` (`packages/metadata/src/plugin.ts`) and
    `APP_CATEGORY_KEYS` (`packages/runtime/src/app-plugin.ts`).
  - Rewrites `packages/spec/src/system/email-template.form.ts` for the new
    schema with sections for Identity, Subject, HTML body, Plain-text body,
    Variables, Delivery overrides, Status.
  - Ships three reference templates in `examples/app-crm/src/emails/`:
    `crm.deal_won` (rewritten to canonical shape), `crm.welcome` (new),
    `crm.lead_followup` (new), and wires them into the CRM stack via
    `emailTemplates: Object.values(emails)`.

  End-to-end verified in Studio: list view at
  `/_console/apps/studio/metadata/email_template` shows all three entries;
  the detail view renders the EmailTemplatePreview iframe and the property
  panel cleanly renders every canonical field (no missing-schema warnings).
  `GET /api/v1/meta` now returns the new `properties` set
  (`name, label, category, locale, subject, bodyHtml, bodyText, variables,
fromOverride, replyTo, active, isSystem, description`).

## 7.0.0

### Major Changes

- dc72172: **Breaking:** Removed `@objectstack/driver-turso` and `@objectstack/knowledge-turso` from the open-core framework.

  The Turso/libSQL driver and its native-vector knowledge adapter now ship exclusively with the **ObjectStack Cloud** distribution (`objectstack-ai/cloud`). Rationale: Turso is used only for cloud/edge multi-tenant deployments — local development uses better-sqlite3 (faster), and the Turso integration is part of ObjectStack's commercial offering.

  ### What moved out

  - `@objectstack/driver-turso` → `objectstack-ai/cloud/packages/driver-turso`
  - `@objectstack/knowledge-turso` → `objectstack-ai/cloud/packages/knowledge-turso`
  - `ITursoPlatformService` contract (spec/contracts/turso-platform.ts) — removed entirely
  - `TursoConfigSchema`, `TursoDriverSpec`, `TursoMultiTenantConfigSchema`, `TenantResolverStrategySchema`, etc. — moved into `@objectstack/driver-turso` (re-exported from cloud)

  ### Framework-side changes

  - `packages/runtime/src/standalone-stack.ts`: `databaseDriver` enum no longer accepts `'turso'`; `libsql://`/`https://` URL detection removed. Cloud builds register the Turso driver via their own stack composition.
  - `packages/runtime/src/cloud/artifact-environment-registry.ts`: dropped `case 'libsql'/'turso'`. Cloud has its own `ArtifactEnvironmentRegistry` that handles Turso.
  - `packages/cli/src/commands/serve.ts`: removed `driverType === 'turso' | 'libsql'` branch.
  - `packages/runtime/package.json`, `packages/cli/package.json`: removed optional peerDep on `@objectstack/driver-turso`.
  - `packages/runtime/tsup.config.ts`: removed `@objectstack/driver-turso` from `external`.
  - `packages/spec/src/contracts/index.ts`: stopped re-exporting `turso-platform.js`.
  - `packages/spec/src/data/index.ts`: stopped re-exporting `driver/turso-multi-tenant.zod`.

  ### Migration for open-source users

  If you used `libsql://` URLs or `@objectstack/driver-turso` directly, either:

  1. Switch to `file:` URLs (better-sqlite3 via `@objectstack/driver-sql`) for local/self-hosted deployments, **or**
  2. Use ObjectStack Cloud, which ships the Turso driver as part of the commercial distribution.

### Minor Changes

- 74470ad: **New `account` App for self-service identity management + `App.hidden` shell hint**

  Adds a dedicated **Account** App (`name: 'account'`, icon `user-circle`) that exposes the three end-user identity surfaces:

  - **Two-Factor Authentication** — `sys_two_factor`
  - **Linked Accounts** — `sys_account`
  - **OAuth Applications** — `sys_oauth_application`

  The app declares **no** `requiredPermissions`, so every authenticated user can reach it — unlike Setup, which requires `setup.access` and therefore excludes the default `member_default` permission set. Combined with the C-tier `resultDialog` actions already shipped on these objects (2FA QR + backup codes, OAuth `client_secret` reveal, `link_social` redirect), this replaces the legacy standalone `apps/account` SPA with a single console + metadata-driven surface.

  **New `App.hidden: boolean` field** (`packages/spec/src/ui/app.zod.ts`) hides an app from the top-level App Switcher. Hidden apps stay fully routable and permission-checked; the shell is expected to surface them through the avatar / user dropdown instead. Mirrors the GitHub Settings / Google account chip / Salesforce Personal Settings pattern. The Account app is the first user.

  Wiring: `plugin-auth` registers `ACCOUNT_APP` alongside `SETUP_APP` / `STUDIO_APP` (`packages/plugins/plugin-auth/src/auth-plugin.ts`). The legacy duplicate entries inside Setup's Advanced group are kept unchanged — they remain admin-only for tenant-wide inspection.

  **Follow-up for objectui**: the shell's `AppSwitcher` and avatar `DropdownMenu` need updating to honour `app.hidden` (filter hidden apps out of the switcher; render them as dropdown menu entries). Tracked separately.

- d29617e: Add `Action.resultDialog` for one-shot reveal of API responses

  Some platform operations return values the user MUST copy now because they
  cannot be retrieved later — TOTP enrollment URIs, OAuth client secrets,
  backup recovery codes. Previously these were handled by bespoke account-app
  pages because actions only surfaced a `successMessage` toast.

  This change adds:

  - **`Action.resultDialog`** — describes a post-success modal that renders
    selected fields from `result.data`. Supports `qrcode`, `code-list`,
    `secret`, `text`, and `json` field formats. When set, renderers SHOULD
    suppress `successMessage` and require explicit acknowledgement.

  - **`Action.target` interpolation contract** — formalised TSDoc spelling
    out the `${param.X}` and `${ctx.X}` substitution rules (with mandatory
    `encodeURIComponent` for URL query positions). Used by redirect-style
    actions like `link_social`.

  New / updated platform actions:

  - `sys_two_factor`: `enable_two_factor` now reveals TOTP URI + backup codes;
    added `regenerate_backup_codes`.
  - `sys_oauth_application`: `rotate_client_secret` now reveals the new
    secret; added `create_oauth_application` toolbar action.
  - `sys_account`: added `link_social` toolbar action (type:`url`, templated
    target) for self-service identity linking.

  These let the Setup app cover OAuth-app registration, 2FA enrollment, and
  social-account linking entirely through metadata, removing the last
  must-have reasons to ship a separate `apps/account` SPA.

  Renderer-side work (separate PR in `objectui`): consume `resultDialog`,
  implement `${param}/${ctx}` interpolation, ship `ResultDialog` component.
  See `c-tier-renderer-contract.md` design note.

## 6.9.0

## 6.8.1

## 6.8.0

### Minor Changes

- c8b9f57: Metadata Admin engine — protocol foundations.

  This is the backend half of the unified Metadata Admin shipped in the Setup
  app. The framework now exposes everything the engine needs to render a
  directory tile, schema-driven form, layered diff, references graph, and
  destructive-change confirmation for every registered metadata type.

  - **`GET /api/v1/meta/types`** is now type-rich. Each entry includes
    `{ icon, domain, schema (JSONSchema), allowOrgOverride, allowRuntimeCreate, supportsOverlay, ui? }`
    so the client can render without a second round-trip per type.
  - **`GET /api/v1/meta/:type/:name/references`** scans every registered
    metadata type for pointers to the given item (object fields, view sources,
    flow targets, permission objects, …) and returns the inbound edges so the
    UI can warn before deletes.
  - **`GET /api/v1/meta/:type/:name?layers=code,overlay,effective`** returns
    each layer separately rather than the merged effective document, powering
    the 3-state diff editor (code source / overlay / effective).
  - **Destructive-change detection** on `PUT /api/v1/meta/object/:name` and
    `PUT /api/v1/meta/field/:name`: rejects field type narrowing, required
    toggled on without a default, removed enum values, etc., unless the
    client opts in with `force=true`.
  - **Env-var registry patch:** `OBJECTSTACK_METADATA_WRITABLE=object,field,permission,view,…`
    flips `allowOrgOverride` on for the listed types at boot, enabling
    runtime overlays for production without re-deploying spec.
  - New guide: **[Adding a Metadata Type](../content/docs/guides/adding-a-metadata-type.mdx)**
    walks through registry entry + Zod schema + optional custom editor.

  Setup app navigation now uses the new component-route variant
  (`{ type: 'component', componentRef: 'metadata:directory' }`) — the temporary
  `/dev/meta` route is removed.

### Patch Changes

- 6e88f77: Auto-persist chat history when a `conversationId` is supplied.

  - `AIService.chatWithTools` and `streamChatWithTools` now write the inbound user turn, each intermediate assistant/tool round, and the final assistant turn to `ai_messages` whenever `toolExecutionContext.conversationId` is set. Persistence is best-effort: failures are warned and never break the chat response.
  - Add `IAIConversationService.update(conversationId, { title?, metadata? })` and a matching `PATCH /api/v1/ai/conversations/:id` route so clients can rename conversations and edit metadata.
  - `ObjectQLConversationService` and `InMemoryConversationService` both implement the new `update` method.

## 6.7.1

## 6.7.0

### Minor Changes

- 430067b: Introduce `IEmbedder` protocol and extract `@objectstack/embedder-openai` plugin.

  **What's new**

  - **`IEmbedder` contract** (`@objectstack/spec/contracts/embedder.ts`) — protocol-level interface for text → vector providers. One contract covers cloud APIs (OpenAI / 阿里通义 / 智谱 / 硅基流动 / 火山 Doubao / MiniMax), local Ollama daemons, and in-process embedders.
  - **`@objectstack/embedder-openai`** — new package. Drop-in for any OpenAI-shape endpoint via `baseUrl`. Ships preset constants for 8 mainstream providers (`createOpenAIEmbedder({ preset: 'siliconflow', ... })`) and pre-baked dimensions for 16+ popular models.

  **Breaking changes (`@objectstack/knowledge-turso`)**

  - `OpenAIEmbeddingProvider` is **removed** — install `@objectstack/embedder-openai` and use `OpenAIEmbedder` instead (identical option shape).
  - `EmbeddingProvider` type alias kept as a deprecated re-export of `IEmbedder` for smoother migration; will be removed in a future major.
  - `HashEmbeddingProvider` is now an alias for the renamed `HashEmbedder` class — no functional change.

  **Migration**

  ```diff
  - import { OpenAIEmbeddingProvider } from '@objectstack/knowledge-turso';
  + import { OpenAIEmbedder } from '@objectstack/embedder-openai';

  - const embedding = new OpenAIEmbeddingProvider({ apiKey });
  + const embedding = new OpenAIEmbedder({ apiKey });
  ```

  For 国内 providers, use presets:

  ```ts
  import { createOpenAIEmbedder } from "@objectstack/embedder-openai";
  const embedding = createOpenAIEmbedder({
    preset: "siliconflow", // or 'dashscope', 'zhipu', 'doubao', 'ollama', …
    apiKey: process.env.SILICONFLOW_API_KEY!,
    model: "BAAI/bge-m3",
  });
  ```

- 4f9e9d4: Settings → runtime bridge: `embedder_*` settings now build a real
  `IEmbedder` and register it as a kernel-level DI service.

  **`@objectstack/spec`**

  - Exports `EMBEDDER_SERVICE = 'embedder'` from `contracts/embedder.ts`
    as the canonical DI token for the kernel-registered embedder.

  **`@objectstack/service-ai`**

  - Adds `@objectstack/embedder-openai` as an **optional peer dependency**
    (matches the `@ai-sdk/*` provider plugins pattern).
  - `AIServicePlugin.bindSettings()` now also:
    - Reads `embedder_provider` / `embedder_api_key` / `embedder_model` /
      `embedder_base_url` / `embedder_dimensions` from the `ai` namespace.
    - Dynamically imports `@objectstack/embedder-openai` and constructs
      an `OpenAIEmbedder` via `createOpenAIEmbedder({ preset, … })`.
    - Registers / replaces the instance under `EMBEDDER_SERVICE`. When
      the operator sets `embedder_provider = none`, the service is left
      unset so adapters can fail fast with a clear message.
    - Subscribes to `settings:changed` for the `ai` namespace so embedder
      swaps go live without restart (mirrors the chat-adapter pattern).
    - Overrides the manifest's fallback `ai/test_embedder` action with a
      live one-shot `embed(['ping'])` round-trip against the form's
      (possibly unsaved) values. Reports vector dims + latency.

  **`@objectstack/knowledge-turso`**

  - `KnowledgeTursoPlugin`'s `embedding` constructor option is now
    **optional**. When omitted, the plugin resolves `EMBEDDER_SERVICE`
    from the kernel at `start()` time — typically the embedder built by
    `@objectstack/service-ai` from the `ai` settings namespace.
  - Explicit `embedding` still wins when both are present (useful for
    tests and multi-embedder setups).
  - Logs `(embedder=<id>, dims=<n>)` on adapter registration so operators
    can confirm wiring at a glance.
  - When neither path resolves, the plugin warns with a one-line hint
    pointing to `Settings → AI & Embedder` and no-ops gracefully (the
    host kernel still boots).

  **Tests**

  - `service-ai`: +5 cases (now 85) covering `ai/test_embedder` action
    registration, `provider=none` warning, missing-api-key error,
    custom-provider-without-base-URL error, and the full happy path
    (mocked fetch → embedder registered under `EMBEDDER_SERVICE` →
    test_embedder action returns vector dims).
  - `knowledge-turso`: new `plugin.test.ts` (+5 cases) covering deferred
    construction, EMBEDDER_SERVICE fallback, explicit-wins precedence,
    missing-both warn-and-noop, and missing-knowledge-service warn.

  End-to-end now possible: operator opens **Settings → AI & Embedder**,
  picks 硅基流动 + paste API key + chooses `BAAI/bge-m3`, hits **Save**.
  Within the same process, `EMBEDDER_SERVICE` is registered/replaced,
  `KnowledgeTursoPlugin` (if started without an explicit embedder)
  picks it up, and subsequent `knowledge.search()` calls embed via the
  new provider — no restart, no env vars.

## 6.6.0

### Minor Changes

- a49cfc2: Add `compareTo` field to `DashboardWidgetSchema` and `variant` / `dashArray` /
  `opacity` to `ChartSeriesSchema` so renderers can express period-over-period
  overlays on metric / gauge / chart widgets.

  `compareTo` accepts `'previousPeriod'`, `'previousYear'`, or
  `{ offset: '7d' | '4w' | '1M' | '1y' }`. The renderer issues a second query
  against the shifted filter and either (a) derives a trend delta for KPI
  widgets or (b) overlays a muted comparison series on cartesian charts.

## 6.5.1

## 6.5.0

### Patch Changes

- Fix: update `package.json` `exports` to use nested `import`/`require` conditions with per-condition `types` fields (e.g. `import.types → index.d.mts`, `require.types → index.d.ts`). This ensures TypeScript with `moduleResolution: "bundler"` resolves to the ESM declaration file (`.d.mts`) which uses explicit `.mjs` chunk imports — eliminating the intermittent TS2306 "is not a module" error that occurred when tsup's DTS worker processed the CJS declaration chain.

## 6.4.0

### Minor Changes

- f8651cc: Knowledge Protocol MVP — protocol-first RAG via adapter plugins.

  **What's new:**

  - `@objectstack/spec` — new `KnowledgeSource` / `KnowledgeDocument` / `KnowledgeChunk` / `KnowledgeHit` schemas (under `@objectstack/spec/ai`) and `IKnowledgeService` / `IKnowledgeAdapter` contracts (under `@objectstack/spec/contracts`).
  - `@objectstack/service-knowledge` — `KnowledgeService` orchestrator + `KnowledgeServicePlugin`. Routes search/index calls to the appropriate adapter, runs **permission-aware retrieval** by re-checking every hit's `sourceRecordId` against the caller's `ExecutionContext` via `IDataEngine` (same RLS that gates plain ObjectQL), and subscribes to `IRealtimeService` for inline record→adapter sync.
  - `@objectstack/knowledge-memory` — deterministic, dependency-free in-memory adapter for dev/tests/reference. Hash-token embedder + brute-force cosine + paragraph chunking.
  - `@objectstack/knowledge-ragflow` — production-grade adapter against the Apache-2.0 [RAGFlow](https://github.com/infiniflow/ragflow) REST API. Plug in your dataset id; ObjectStack handles permission filtering after retrieval.
  - `@objectstack/service-ai` — new `search_knowledge` tool wired through the registry. Threads the LLM caller's actor into `KnowledgeService.search` so retrieval honours RLS automatically.

  **Why this design:** ObjectStack does NOT own chunking / embedding / vector storage / rerank — those are commodity capabilities best handled by mature OSS (RAGFlow, LlamaIndex, Dify, …). What ObjectStack uniquely owns is the protocol + permission-aware orchestration on top.

  See `content/docs/protocol/knowledge.mdx` for the full design.

- f8651cc: AI tools now execute with the end-user's `ExecutionContext`, so the
  existing ObjectQL row-level-security rules automatically scope what an
  agent can read and mutate.

  **What changed**

  - New `ToolExecutionContext` (on `@objectstack/spec/contracts`'s
    `ChatWithToolsOptions`) carries the authenticated actor, conversation
    id, and environment id through to tool handlers.
  - The built-in data tools (`query_records`, `get_record`,
    `aggregate_data`, legacy `query_data`) and the auto-generated
    `action_*` tools now pass `options.context` to `IDataEngine` calls,
    mapping the actor to `{ userId, roles, permissions, isSystem: false }`.
  - Assistant + agent REST routes forward `req.user` into the new
    context automatically — no caller changes required.
  - When no actor is provided (cron jobs, internal callers, existing tests)
    the helpers fall back to `{ isSystem: true }`, preserving today's
    behaviour. **Fully backward compatible.**

  **Why this matters**

  Before this change, an AI tool call ran with system privileges and saw
  every row in the tenant. Now the agent sees exactly what the human
  operator would see — same RLS, same field-level masking, same audit
  trail. This is the foundation for trustworthy autonomous agents.

  **For custom call sites**

  If you invoke `aiService.chatWithTools(...)` from your own route, pass
  `toolExecutionContext: { actor: { id, roles, permissions } }` to inherit
  the user's permissions. Omit it to keep the legacy system-level
  behaviour.

- 0bf6f9a: Add `Portal` metadata kind for external-user UI projections.

  A `Portal` declares a public-facing "site" derived from an existing `App` (or a curated subset of objects/views), with its own theme, authentication mode (anonymous / passwordless / sso), custom routes, and per-route guards. This is the protocol surface for the "customer portal" use case — partner sites, public booking, support knowledge bases — without forking the back-office `App`.

  **New exports under `@objectstack/spec/ui`:**

  - `PortalSchema`, `Portal` — Zod schema + inferred type.
  - `PortalRouteSchema`, `PortalRoute` — per-route configuration (view ref, layout, auth requirement, sharing scope).
  - `PortalAuthModeSchema` — enum of auth strategies (`anonymous`, `passwordless`, `oauth`, `sso`).
  - `definePortal()` — DX builder mirroring `defineApp()`.

  **Stack composition:** `composeStacks()` now accepts and merges `portals` alongside `apps`, `objects`, `views`, etc.

  No runtime / app behaviour change — this ships the protocol contract first so plugins, Studio, and the runtime can land Portal support in subsequent releases.

## 6.3.0

## 6.2.0

### Patch Changes

- b4c74a9: **Actions-as-tools Phase 3 — Human-In-The-Loop approval queue.**

  Dangerous declarative actions (`confirmText`, `mode:'delete'`, `variant:'danger'`) can now be exposed to the LLM safely. Instead of being skipped outright, they are registered as tools whose handler enqueues a pending request and returns `{ status: 'pending_approval', pendingActionId }` to the model. A human approves (or rejects) from Studio's pending-actions inbox; the service then re-runs the exact same dispatcher.

  ### New surface

  - New system object `ai_pending_actions` (id, conversation_id?, message_id?, object_name, action_name, tool_name, tool_input, status [`pending`|`approved`|`executed`|`failed`|`rejected`], result?, error?, rejection_reason?, proposed_by, decided_by?, proposed_at, decided_at?).
  - New built-in Studio view `AiPendingActionView` with `pending` / `executed` / `rejected` / `failed` sub-views and per-row **Approve** / **Reject** API actions.
  - New methods on `IAIService` (all optional, gated on a wired `IDataEngine`):
    - `proposePendingAction(input) → { id }`
    - `approvePendingAction(id, actorId) → { status, result?, error? }`
    - `rejectPendingAction(id, actorId, reason?)`
    - `listPendingActions(filter?) → PendingActionRow[]`
  - New exported types: `PendingActionStatus`, `ProposePendingActionInput`, `PendingActionRow`.
  - New REST routes (auth required):
    - `GET    /api/v1/ai/pending-actions` (`ai:read`)
    - `GET    /api/v1/ai/pending-actions/:id` (`ai:read`)
    - `POST   /api/v1/ai/pending-actions/:id/approve` (`ai:approve`)
    - `POST   /api/v1/ai/pending-actions/:id/reject` (`ai:approve`)
  - New exported predicate `actionRequiresApproval(action)` for Studio's exposure surface.

  ### Wiring

  `AIServicePluginOptions` gains `enableActionApproval?: boolean` (default `false`). When `true` and an `IDataEngine` is available, dangerous actions are registered and routed through the queue.

  ```ts
  kernel.use(
    new AIServicePlugin({
      enableActionApproval: true, // opt in
      apiActionBaseUrl: "http://localhost:3000",
    })
  );
  ```

  ### Internals

  - `actionSkipReason()` accepts `enableActionApproval` + `aiService` in its ctx and stops returning `"requires confirmation"` / `"mode='delete'"` / `"variant='danger'"` when HITL is wired.
  - `registerActionsAsTools()` pre-registers a _bypass-approval_ dispatcher per dangerous tool via `aiService.registerPendingActionDispatcher(toolName, fn)`; approval calls back into the same code path with `enableActionApproval` flipped off, so a single handler implementation serves both proposal and execution.
  - `createActionToolHandler()` short-circuits to `proposePendingAction()` when `enableActionApproval && actionRequiresApproval(action) && ctx.aiService?.proposePendingAction`.

  ### Out of scope (deferred)

  Slack/email notifications, approver routing (any signed-in user can approve in v1), auto-expiry of pending requests, resuming the same LLM turn after approval (operators get a fresh assistant message instead).

## 6.1.1

## 6.1.0

### Minor Changes

- 93c0589: **AI v1: Actions-as-Tools** — every declarative UI `Action` of `type: 'script'`
  is now auto-exposed as an AI-callable tool named `action_<name>`. Agents can
  perform business operations ("complete the groceries task") via natural
  language, routed through the same `dataEngine.executeAction()` dispatcher
  Studio uses. This is the write-side counterpart to `query_data`.

  **Highlights**

  - `registerActionsAsTools(toolRegistry, { metadata, dataEngine })` walks every
    object's `actions[]` and registers script-type ones, auto-injecting a
    `recordId` argument for row-context actions and inheriting JSON-Schema
    parameter types from the owning object's fields.
  - Safety filters skip destructive actions by default: `confirmText`,
    `mode: 'delete'`, `variant: 'danger'`, or explicit `aiExposed: false`.
  - New `aiExposed?: boolean` flag on `ActionSchema` for fine-grained opt-out.
  - New `actions_executor` skill bundle subscribes to `action_*` (wildcard
    tool names now supported in `SkillSchema.tools`).
  - The built-in `data_chat` agent now references both `data_explorer` and
    `actions_executor` skills, so users get read + write capabilities out of
    the box.
  - `MemoryLLMAdapter` learned a small two-step heuristic — when it sees an
    action verb ("complete", "start", "clone", ...) it routes to the matching
    `action_*` tool, resolving `recordId` from any prior `query_data` result.
  - New `examples/app-todo/test/ai-action.test.ts` demo proves the loop:
    user says "please complete the groceries task" → agent finds the task →
    agent calls `action_complete_task` → task status flips → `ai_traces`
    records the run.

  **Breaking changes**

  None. `aiExposed` is additive; existing actions remain exposed unless
  they fail an existing safety filter.

  **Phase-1 limitations** (Phase-2 roadmap items)

  - Only `type: 'script'` actions; `api`/`flow`/`url`/`modal`/`form` skipped.
  - No human-in-the-loop approval flow for destructive actions yet.
  - No CEL evaluation of `visible`/`disabled` predicates against agent context.
  - No bulk action support (single-record only).

## 6.0.0

### Major Changes

- 629a716: # v1 AI Protocol focusing — remove application-template schemas

  The `@objectstack/spec/ai` protocol is reduced to **only the primitives
  the runtime directly consumes**. Eight schemas that described
  application templates or product features (not platform contracts) are
  removed; three more are slimmed to their primitive cores.

  ## Removed (8 files, ~4,700 lines)

  | File                           | Reason for removal                                                                |
  | ------------------------------ | --------------------------------------------------------------------------------- |
  | `ai/devops-agent.zod.ts`       | A specific Agent template, not a primitive. Compose with `Agent + Skill + Tool`.  |
  | `ai/plugin-development.zod.ts` | Specific workflow; same reasoning.                                                |
  | `ai/runtime-ops.zod.ts`        | AIOps is a vertical product, not a backend platform concern.                      |
  | `ai/predictive.zod.ts`         | ML pipeline product (DataRobot/H2O space), orthogonal to metadata-driven backend. |
  | `ai/agent-action.zod.ts`       | 100% conceptual overlap with `tool` + `flow`.                                     |
  | `ai/orchestration.zod.ts`      | Multi-agent plans can be expressed as agents-as-tools. Premature.                 |
  | `ai/nlq.zod.ts`                | NLQ is LLM-native capability + a `query_data` tool over ObjectQL, not a protocol. |
  | `ai/feedback-loop.zod.ts`      | RLHF / training-side concern; not platform-owned.                                 |

  ## Slimmed (3 files)

  - **`ai/rag-pipeline.zod.ts` → `ai/embedding.zod.ts`** (318 → 80 lines).
    Keeps `EmbeddingModelSchema` + `VectorStoreSchema` primitives.
    Removed: chunking strategies, retrieval pipelines, rerankers,
    document loaders, end-to-end RAG pipeline DSL. The `ragPipelines`
    field on `defineStack()` is removed.
  - **`ai/cost.zod.ts` → `ai/usage.zod.ts`** (431 → ~70 lines).
    Keeps `TokenUsageSchema` + `AIUsageRecordSchema`. Model pricing is
    the canonical `ModelPricingSchema` already exported from
    `ai/model-registry.zod.ts`. Removed: budget definitions,
    enforcement, alerts, allocation reports, optimization
    recommendations.
  - **`ai/mcp.zod.ts`** (629 → ~100 lines). Defines only how to
    _reference_ an external MCP server and _bind_ its tools to an
    agent. The MCP protocol itself is owned by Anthropic's published
    spec and the `@modelcontextprotocol/sdk`; we no longer re-declare
    transport/capability/resource/prompt/streaming/sampling shapes.

  ## Migration

  No production code in this repository depended on the removed
  schemas. Downstream consumers that imported any of the removed types
  from `@objectstack/spec/ai` must:

  1. **Remove the import.** The platform no longer provides these types.
  2. **Define your own application-level shape** in your project / plugin
     if you still need the concept. The primitives (`Agent`, `Skill`,
     `Tool`, `Conversation`, `Embedding`, `Usage`, `MCP{ServerRef,ToolBinding}`)
     are sufficient to express every removed schema.
  3. For RAG: replace `RAGPipelineConfig` with your own pipeline
     description built on `EmbeddingModelSchema` + `VectorStoreSchema`.
  4. For cost: replace budget enforcement with your own service built
     on `AIUsageRecordSchema` records.

  ## Why

  The platform's job is to define **primitives that any AI feature can
  be built on top of**, leveraging the metadata-driven nature of
  ObjectStack. The removed schemas described specific product features
  (DevOps agent, AIOps, RAG pipeline DSL, budget enforcement) that
  should live in plugins or applications — not in the canonical
  protocol. Shipping a 6,245-line AI protocol where 80% of it has no
  runtime implementation creates false promises to integrators.

  After this change the AI protocol is:

  ```
  ai/
  ├── agent.zod.ts          ← who
  ├── skill.zod.ts          ← when
  ├── tool.zod.ts           ← what
  ├── conversation.zod.ts   ← what to remember
  ├── model-registry.zod.ts ← which LLMs
  ├── embedding.zod.ts      ← embedding + vector store primitives
  ├── usage.zod.ts          ← token + cost accounting
  └── mcp.zod.ts            ← external ecosystem bridge
  ```

  8 files, ~1,200 lines. Every schema has a runtime implementation in
  `@objectstack/service-ai` or `@objectstack/plugin-mcp-server`.

- 944f187: # v5.0 — `project` → `environment` hard rename

  The runtime concept previously called **"project"** (per-tenant business
  workspace; Org → **Project** → Branch hierarchy; per-project ObjectKernel,
  per-project DB, per-project artifact) is now uniformly called
  **"environment"**.

  This is a **hard rename with no aliases, deprecation shims, or compatibility
  layer**. Upgrade requires a coordinated update of CLI, runtime, server, and any
  clients calling the REST API.

  > Note: "project" in the npm / monorepo sense (the framework itself, `package.json`,
  > tsconfig project references, vitest `projects` config) is **unchanged**.

  ## Breaking changes

  ### CLI

  - Flags renamed:
    - `--project` / `-p` → `--environment` / `-e` (`os publish`, `os rollback`)
    - `--project-id` → `--environment-id` (`os dev`)
  - Default local env id: `proj_local` → `env_local`.
  - Env var: `OS_PROJECT_ID` → `OS_ENVIRONMENT_ID`.
  - Command group renamed: `os projects ...` → `os environments ...`
    (`bind`, `create`, `list`, `show`, `switch`).
  - Persisted auth-config key: `activeProjectId` → `activeEnvironmentId`.

  ### HTTP / REST

  - Scoped routes: `/api/v1/projects/:projectId/...` → `/api/v1/environments/:environmentId/...`.
  - Cloud control-plane routes: `/api/v1/cloud/projects/...` → `/api/v1/cloud/environments/...`
    (including `/cloud/environments/:id/artifact`, `/cloud/environments/:id/metadata`,
    `/cloud/environments/:id/credentials/rotate`, etc.).
  - Header: `X-Project-Id` (and lowercase `x-project-id`) → `X-Environment-Id`
    (`x-environment-id`).
  - Route param name in handlers: `req.params.projectId` → `req.params.environmentId`.
  - Hostname-routing and tenant-resolution code-paths use `environmentId` end-to-end.

  ### Runtime / spec

  - Exported symbols (no aliases):
    - `createSystemProjectPlugin` → `createSystemEnvironmentPlugin`
    - `SYSTEM_PROJECT_ID` → `SYSTEM_ENVIRONMENT_ID`
    - `ProjectArtifactSchema` → `EnvironmentArtifactSchema`
    - `PROJECT_ARTIFACT_SCHEMA_VERSION` → `ENVIRONMENT_ARTIFACT_SCHEMA_VERSION`
    - `ObjectOSProjectPlugin` → `ObjectOSEnvironmentPlugin`
    - `createSingleProjectPlugin` → `createSingleEnvironmentPlugin`
  - Plugin identifier strings:
    - `com.objectstack.runtime.objectos-project` → `objectos-environment`
    - `com.objectstack.studio.single-project` → `single-environment`
    - `com.objectstack.multi-project` → `multi-environment`
    - `com.objectstack.runtime.system-project` → `system-environment`
  - Provisioning hook: `provisionSystemProject` → `provisionSystemEnvironment`.

  ### Database / schemas

  - Column renames on `sys_metadata` and `sys_metadata_history`:
    `project_id` → `environment_id`.
  - Column renames on `sys_activity`: `project_id` → `environment_id` (plus index).
  - Object renames in platform-objects metadata: `sys_project` → `sys_environment`
    (lookup targets), `sys_project_member` → `sys_environment_member`,
    `sys_project_credential` → `sys_environment_credential`.
  - Auth-context field: `active_project_id` → `active_environment_id`.
  - JSON schemas under `packages/spec/json-schema/system/`:
    `ProjectArtifact*.json` → `EnvironmentArtifact*.json` (regenerated at build).

  ### Automatic forward migration

  A new migration `migrateProjectIdToEnvironmentId`
  (`packages/metadata/src/migrations/migrate-project-id-to-environment-id.ts`)
  auto-runs from `DatabaseLoader.ensureSchema()` on bootstrap and rewrites any
  existing `project_id` column on `sys_metadata` / `sys_metadata_history` to
  `environment_id` (idempotent, best-effort). Existing rows are preserved.

  The legacy reverse migration `migrateEnvIdToProjectId` is retained verbatim
  for historical / disaster-recovery use; it is **not** auto-run.

  ## Migration guide

  ```diff
  -os publish --project proj_xyz
  +os publish --environment env_xyz

  -curl -H "X-Project-Id: env_xyz" https://api.example.com/api/v1/data/customer
  +curl -H "X-Environment-Id: env_xyz" https://api.example.com/api/v1/data/customer

  -OS_PROJECT_ID=env_xyz os dev
  +OS_ENVIRONMENT_ID=env_xyz os dev

  -import { createSystemProjectPlugin, SYSTEM_PROJECT_ID } from "@objectstack/runtime";
  +import { createSystemEnvironmentPlugin, SYSTEM_ENVIRONMENT_ID } from "@objectstack/runtime";

  -import { ProjectArtifactSchema } from "@objectstack/spec";
  +import { EnvironmentArtifactSchema } from "@objectstack/spec";
  ```

  If you maintain a Cloud control-plane deployment, the `cloud` repository must
  be updated in lockstep to pick up the new plugin identifier strings
  (`single-environment`, `multi-environment`, `objectos-environment`).

### Minor Changes

- dbc4f7d: feat(ai): v1 AI capabilities — ModelRegistry, structured output, tracing, schema retrieval, and `query_data` tool

  This release lights up the first concrete capabilities on the slimmed AI protocol. All additions are
  non-breaking — new contract methods are optional and existing callers keep working unchanged.

  ### What's new

  - **ModelRegistry** (`@objectstack/service-ai`): in-memory runtime registry for `AI.ModelConfig`.
    Wire models via `AIServicePluginOptions.models` / `defaultModelId`. Exposes `get`, `getOrThrow`,
    `getDefault`, `list`, and `estimateCost(modelId, usage)` for ex-post token cost computation.

  - **ai_traces object + auto-tracing**: every LLM call from `AIService` (`chat`, `complete`,
    `stream_chat`, `chat_with_tools`, `generate_object`, `embed`) is now instrumented with latency,
    token usage, status, and (when pricing is registered) cost. The default `ObjectQLTraceRecorder`
    is auto-wired when the runtime exposes an `IDataEngine`, persisting rows to the new `ai_traces`
    object. Drop in a custom `TraceRecorder` via `AIServicePluginOptions.traceRecorder`, or pass
    `null` to opt out.

  - **Structured output (`IAIService.generateObject`)**: new optional method on `IAIService` and
    `LLMAdapter` that returns a parsed, schema-validated object instead of free-form text.
    Implemented end-to-end in `VercelLLMAdapter` (uses the AI SDK's `generateObject` — provider
    strict-mode is automatic when supported). `MemoryLLMAdapter` ships a deterministic heuristic
    implementation so tests and demos work without an API key.

  - **SchemaRetriever**: lightweight keyword-based retriever over `IMetadataService.listObjects()`.
    Scores by object name (×3), label/plural (×2), description (×1), field name (×2), and field
    label (×1) with English stop-word filtering. Tokenisation splits snake_case so `todo_task` in
    a query matches `name: 'todo_task'`. `SchemaRetriever.renderSnippet()` produces a Markdown
    block ready to inject into a system prompt — no embeddings, no extra infra.

  - **`query_data` tool**: auto-registered when AI + Metadata + Data engine are all present. Takes
    a natural-language `request`, retrieves relevant schemas, asks the model for a structured
    `QueryPlan` via `generateObject`, validates the plan targets a real object, and executes it
    through `IDataEngine.find`. Returns `{ plan, count, records }`. The composed primitive that
    closes the loop from "ask in English" → "validated SQL-shaped result".

  - **Working demo in `examples/app-todo`**: `pnpm --filter @example/app-todo test:ai` boots the
    full Todo stack, invokes `query_data` against the seeded tasks, and verifies the call lands
    in `ai_traces`. Zero API keys, ~3 seconds end-to-end. Serves as the canonical reference for
    wiring AI into a real app.

  ### Hardening

  - Strict tool schemas: nested `orderBy` and `aggregations` items in `data-tools` now declare
    `additionalProperties: false` + `required`, matching the top-level contract and making them
    safe for provider strict mode.

  ### Breaking-ish

  - `TraceOperation` values are now snake_case (`stream_chat`, `chat_with_tools`, `generate_object`)
    to match the project's data-value convention and so the `ai_traces.operation` select validates.
    Custom `TraceRecorder` implementations that hard-code the old camelCase names need to be
    updated. The values are an internal observability artefact — no public protocol surface
    exposes them.

  ### Notes

  - `zod` is now a direct dependency of `@objectstack/service-ai` (previously transitive via `ai`)
    because contract signatures and the new tool definition use `z.ZodType` types directly.
  - All new methods on `IAIService` / `LLMAdapter` are optional — existing custom adapters and
    callers continue to work without changes.
  - 12 new unit tests cover `ModelRegistry` (cost math, defaults, throwing lookups) and
    `SchemaRetriever` (scoring, snake_case tokenisation, limits, snippet rendering).
    Full suite: 323/323 ✓.

## 5.2.0

### Minor Changes

- fa011d8: feat(studio): metadata history timeline viewer

  Adds a new `history` view mode that surfaces the audit timeline produced by `sys_metadata_history` (ADR-0008 §5) inside Studio. Available for every metadata type as a wildcard built-in plugin.

  - `@objectstack/spec`: extend `ViewModeSchema` with `'history'`.
  - `@objectstack/studio`: new `historyViewerPlugin` rendering an event timeline (create/update/delete/rename) with op icons, short hash, actor, source, expandable detail panel. ADR-0009 `executionPinned` types (`flow`, `workflow`, `approval`) show a "Pinned" badge explaining that historical versions are retained for in-flight executions.

  Reads from the existing `GET /meta/:type/:name/history` REST endpoint via `client.meta.getHistory()`; no new server surface.

### Patch Changes

- bab2b20: feat(approvals): execution-pinned approval processes (ADR-0009)

  When an approval request is submitted, the engine now records a `process_hash`
  on `sys_approval_request` — the sha256 of the approval process body resolved
  through `MetadataRepository`. While the request is in flight, `approve` /
  `reject` / `recall` resolve the pinned process body via
  `MetadataRepository.getByHash`. Upgrading the approval process definition
  mid-flight therefore no longer affects requests that already started against
  the previous version.

  Behavior:

  - `sys_approval_request` gains a `process_hash` column (text, nullable,
    read-only). Existing rows keep working — the engine falls back to the
    current `sys_approval_process` projection when the column is empty.
  - `ApprovalServiceOptions` accepts an optional `metadataRepo`. When omitted
    (e.g. defining processes purely through the runtime API or in unit tests),
    pinning is silently disabled and the service behaves as before.
  - `ApprovalsServicePlugin` looks up the metadata service from the kernel
    and wires its repository automatically.
  - The metadata-core local `MetadataTypeSchema` enum was realigned with the
    canonical `@objectstack/spec/kernel` enum (drift fix: `approval`, `field`,
    `function`, `service`, …).

  This is the first user-visible consumer of the `executionPinned` capability
  introduced in ADR-0009.

- b806f58: Scope `sys_user` visibility to fellow organization members.

  The default RLS policy on `sys_user` was `id = current_user.id`, which meant
  @-mention pickers, owner/assignee lookups, reviewer selectors and the user
  roster all returned just the current user. The RLS compiler doesn't support
  subqueries, so a `id IN (SELECT user_id FROM sys_member ...)` policy isn't
  expressible.

  This change:

  1. Pre-resolves `org_user_ids` (the IDs of all users in the active org) into
     `ExecutionContext` in **all three** REST entry-point resolvers
     (`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/plugin-hono-server`).
  2. Adds the field to `ExecutionContextSchema` so it survives Zod parsing.
  3. Adds an `org_user_ids` field to the RLS compiler's user context.
  4. Adds a new `sys_user_org_members` policy (`id IN (current_user.org_user_ids)`)
     to both `member_default` and `viewer_readonly` permission sets, alongside
     the existing `sys_user_self` policy. The RLS compiler OR-combines them, so
     users see themselves AND their org collaborators.

  Capped at 1000 members per request. Large enterprises should plug in a
  directory cache or split per workspace.

## 5.1.0

### Minor Changes

- 75f4ee6: feat(metadata): introduce `executionPinned` capability for runtime version pinning (ADR-0009)

  Adds a new capability flag on the metadata type registry so that types whose runtime
  transaction rows reference a specific historical version (flow, workflow, approval)
  get unified pinning behavior — instead of every business table re-implementing its
  own snapshot column.

  - `MetadataTypeRegistryEntrySchema` gains `executionPinned: boolean`, enforced
    invariant `executionPinned ⇒ supportsVersioning`.
  - `flow`, `workflow`, `approval` flipped to `executionPinned: true`. `approval`
    also corrected to `supportsVersioning: true` (it was wrongly `false`).
  - `MetadataRepository.getByHash(ref, hash)` added to the interface. Production
    implementation in `SysMetadataRepository` resolves historical bodies through
    `sys_metadata_history` keyed by `(organization_id, type, name, checksum)`.
    In-memory and FS repositories serve HEAD-only matches.
  - `sys_metadata_history` gains an index on `(organization_id, type, name, checksum)`
    to keep hash lookups O(log n).
  - `HistoryCleanupManager` skips pinned types entirely (both age-based and
    count-based retention) — pinned-type history must never be GC'd.

  See `docs/adr/0009-execution-pinned-metadata.md` for full rationale and the
  list of rejected alternatives (no shared snapshot table, no inlined snapshot column).

- 823d559: Remove `sys_metadata_history.metadata_id` column.

  The column was originally a `Field.lookup` FK into `sys_metadata.id`,
  then downgraded to plain `text` during the M1 history-writes work so
  that DELETE tombstones could keep an orphaned ref. After M1 we
  concluded the column carries no business value:

  - Audit-time joins use `(organization_id, type, name, version)`,
    which is already a UNIQUE composite key.
  - The physical row id is a database-internal detail with no logical
    identity — it cannot follow an item through delete + recreate.
  - No code reader was ever added.

  This release removes the column outright:

  - Dropped `metadata_id` from `SysMetadataHistoryObject`
    (`@objectstack/platform-objects`).
  - Dropped `metadataId` from `MetadataHistoryRecordSchema`
    (`@objectstack/spec`).
  - `SysMetadataRepository.put`/`delete` no longer write the column.
  - Legacy `DatabaseLoader.createHistoryRecord` no longer writes it;
    `getHistoryRecord`/`queryHistory` filter by `(type, name)` directly
    (no parent-row lookup needed).
  - `MetadataHistoryCleanup` `maxVersions` policy groups by
    `(type, name)` instead of `metadata_id`.

  **Migration**: Drop the column from existing `sys_metadata_history`
  tables in a follow-up SQL migration. Existing history rows remain
  queryable since `(organization_id, type, name, version)` is already
  the canonical lookup key. No consumer code should be reading
  `metadata_id` — if you are, switch to `(organization_id, type, name,
version)`.

  See ADR-0008 §14 for the full rationale.

## 5.0.0

### Minor Changes

- 2f9073a: Add `_sections` to `ObjectTranslationData` so per-section labels on detail
  pages can be authored alongside `_views` and `_actions`. Convention:
  `objects.<object>._sections.<section_name>.label`. Consumed by
  `@object-ui/plugin-detail` when sections declare a stable `name`.

## 4.2.0

### Minor Changes

- 2869891: feat: Optimistic Concurrency Control (OCC) via `If-Match`

  Update and Delete requests now accept an optional version token. When supplied,
  the protocol compares it against the record's current `updated_at` (or `version`
  column when available) and rejects with `409 CONCURRENT_UPDATE` on mismatch,
  preventing silent overwrites when two clients edit the same record.

  **Wire formats** (opt-in, all server- and client-backward-compatible):

  - `PATCH /data/{object}/{id}` — supports `If-Match: "<token>"` header
    _or_ `expectedVersion: "<token>"` body field (body wins when both present).
  - `DELETE /data/{object}/{id}` — supports `If-Match` header _or_
    `?expectedVersion=...` query param.
  - Conflict response: `409 { error, code: 'CONCURRENT_UPDATE', currentVersion,
currentRecord }` so the client can offer Reload / Overwrite / Cancel UX.

  **Behaviour**

  - Missing/empty version → no check (legacy callers unaffected).
  - Record not found during the version probe → no check; the downstream write
    produces a normal `404`.
  - Object has no `updated_at` column → no check (explicit opt-out for objects
    without timestamps).
  - Quoted RFC-7232 tokens (`"…"`) are accepted and unquoted before comparison.

  **Client**

  `client.data.update(resource, id, data, { ifMatch })` and
  `client.data.delete(resource, id, { ifMatch })` now forward the token as an
  `If-Match` header.

  Application-level CAS (findOne + compare in protocol.ts) is used in this slice
  to avoid touching every storage driver. A small TOCTOU window remains; for the
  B2B record-editing latencies this protects against, it is more than sufficient.
  Drivers may later be upgraded to atomic `WHERE id=? AND updated_at=?` writes
  for true CAS without changing the public API.

  Tests: 7 new cases in `protocol-data.test.ts` cover opt-in, match, mismatch,
  quote-stripping, no-timestamps, empty-token, and the delete path.

## 4.1.1

## 4.1.0

### Minor Changes

- 23db640: `record:highlights` now accepts richer field items.

  Each entry in `fields` may be either a bare field name (backward compatible) or an object `{ name, label?, icon?, type? }` that lets the schema override the displayed label, attach a Lucide icon, or force a specific cell renderer without editing the underlying object metadata. Useful when the same field appears in multiple highlight strips with different framing (e.g. "Annual Revenue" vs "ARR") or when you want a tiny icon for status-like fields.

### Patch Changes

- 2108c30: `ActionParamSchema.required` now defaults to `false` (was effectively `undefined`). Functionally equivalent for existing consumers (which check truthiness), but makes the parsed object shape complete and unblocks downstream type narrowing. Fixes pre-existing failing test `action.test.ts > should accept minimal action parameter`.

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release

## 4.0.4

### Patch Changes

- 326b66b: fix: studio CI test failures and metadata protocol mock handler improvements

## 4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai

## 4.0.0

### Minor Changes

- f08ffc3: Fix discovery API endpoint routing and protocol consistency.

  **Discovery route standardization:**

  - All adapters (Express, Fastify, Hono, NestJS, Next.js, Nuxt, SvelteKit) now mount the discovery endpoint at `{prefix}/discovery` instead of `{prefix}` root.
  - `.well-known/objectstack` redirects now point to `{prefix}/discovery`.
  - Client `connect()` fallback URL changed from `/api/v1` to `/api/v1/discovery`.
  - Runtime dispatcher handles both `/discovery` (standard) and `/` (legacy) for backward compatibility.

  **Schema & route alignment:**

  - Added `storage` (service: `file-storage`) and `feed` (service: `data`) routes to `DEFAULT_DISPATCHER_ROUTES`.
  - Added `feed` and `discovery` fields to `ApiRoutesSchema`.
  - Unified `GetDiscoveryResponseSchema` with `DiscoverySchema` as single source of truth.
  - Client `getRoute('feed')` fallback updated from `/api/v1/data` to `/api/v1/feed`.

  **Type safety:**

  - Extracted `ApiRouteType` from `ApiRoutes` keys for type-safe client route resolution.
  - Removed `as any` type casting in client route access.

- e0b0a78: Deprecate DataEngineQueryOptions in favor of QueryAST-aligned EngineQueryOptions.

  Engine, Protocol, and Client now use standard QueryAST parameter names:

  - `filter` → `where`
  - `select` → `fields`
  - `sort` → `orderBy`
  - `skip` → `offset`
  - `populate` → `expand`
  - `top` → `limit`

  The old DataEngine\* schemas and types are preserved with `@deprecated` markers for backward compatibility.

## 3.3.1

### Minor Changes

- AI Agent/Skill/Tool metadata protocol refactoring (aligned with Salesforce Agentforce, Microsoft Copilot Studio, ServiceNow Now Assist)
  - **Tool as first-class metadata** (`src/ai/tool.zod.ts`): `ToolSchema`, `ToolCategorySchema`, `defineTool()` factory. Fields: name, label, description, category, parameters (JSON Schema), outputSchema, objectName, requiresConfirmation, permissions, active, builtIn.
  - **Skill as ability group** (`src/ai/skill.zod.ts`): `SkillSchema`, `SkillTriggerConditionSchema`, `defineSkill()` factory. Fields: name, label, description, instructions, tools (tool name references), triggerPhrases, triggerConditions, permissions, active.
  - **Agent protocol updated**: Added `skills: string[]` for Agent→Skill→Tool architecture; existing `tools` retained as backward-compatible fallback. Added `permissions: string[]` for access control.
  - **Metadata registry**: `tool` and `skill` registered as first-class metadata types in `MetadataTypeSchema` and `DEFAULT_METADATA_TYPE_REGISTRY` (domain: `ai`, filePatterns: `**/*.tool.ts`, `**/*.skill.ts`, etc.)
  - **Exports**: `defineTool`, `defineSkill`, `Tool`, `Skill` exported from `@objectstack/spec` root and `@objectstack/spec/ai` subpath.

## 3.3.0

## 3.2.9

## 3.2.8

## 3.2.7

## 3.2.6

## 3.2.5

## 3.2.4

## 3.2.3

## 3.2.2

### Patch Changes

- 46defbb: Fix filter operators (contains, notContains, startsWith, endsWith, between, null) broken across spec and memory driver

  - Add `$notContains` to `StringOperatorSchema`, `FieldOperatorsSchema`, `FILTER_OPERATORS`, and `Filter` type
  - Add `notcontains` / `not_contains` to `VALID_AST_OPERATORS` and `AST_OPERATOR_MAP`
  - Fix memory driver `convertToMongoQuery()` passthrough to normalize non-standard operators to Mingo-compatible format
  - Add `$notContains` and `$null` operators to memory matcher
  - Fix undefined value guard in memory matcher to exclude `$exists`, `$ne`, and `$null`

## 3.2.1

### Patch Changes

- 850b546: Maintenance patch release

## 3.2.0

### Minor Changes

- 5901c29: feat: auto-merge actions into object metadata via objectName

  - Added optional `objectName` field to `ActionSchema` for associating actions with specific objects
  - Added optional `actions` field to `ObjectSchema` to hold object-scoped actions
  - `defineStack()` and `composeStacks()` now auto-merge top-level actions with `objectName` into their target object's `actions` array
  - Added cross-reference validation for `action.objectName` referencing undefined objects
  - Top-level `actions` array is preserved for global access (platform overview, search)
  - Updated example apps (CRM, Todo) to use `objectName` on their action definitions

## 3.1.1

### Patch Changes

- 953d667: Add modal cross-reference validation, action handler examples, and action.mdx doc sync

## 3.1.0

### Minor Changes

- 0088830: Minor version release

## 3.0.11

### Patch Changes

- 92d9d99: Add auto-detect persistence strategy for memory driver: automatically selects localStorage (browser) or file system (Node.js) based on runtime environment

## 3.0.10

### Patch Changes

- d1e5d31: Fix UI protocol design issues

## 3.0.9

### Patch Changes

- 15e0df6: chore: unify all package versions to 3.0.8

## 3.0.8

### Patch Changes

- 5a968a2: Unify all package version numbers across the monorepo. All packages now share the same version and are released together via the changeset fixed group.

## 3.0.7

### Patch Changes

- 0119bd7: Implement DatabaseLoader for production metadata persistence
- 5426bdf: Migrate CLI architecture to oclif framework
  Improve chart

## 3.0.6

### Patch Changes

- 5df254c: Patch version release

## 3.0.5

### Patch Changes

- 23a4a68: Patch release for ObjectStack spec

## 3.0.4

### Patch Changes

- d738987: chore: patch release

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.

## 3.0.2

### Patch Changes

- 28985f5: **Breaking Change: Strict Validation Enabled by Default**

  `defineStack()` now validates configurations by default to enforce naming conventions and catch errors early.

  **What Changed:**

  - `defineStack()` now defaults to `strict: true` (was `strict: false`)
  - Field names are now validated to ensure snake_case format
  - Object names, field types, and all schema definitions are validated

  **Migration Guide:**

  If you have existing code that violates naming conventions:

  ```typescript
  // Before (would silently accept invalid names):
  defineStack({
    manifest: {...},
    objects: [{
      name: 'my_object',
      fields: {
        firstName: { type: 'text' }  // ❌ Invalid: camelCase
      }
    }]
  });

  // After (will throw validation error):
  // Error: Field names must be lowercase snake_case

  // Fix: Use snake_case
  defineStack({
    manifest: {...},
    objects: [{
      name: 'my_object',
      fields: {
        first_name: { type: 'text' }  // ✅ Valid: snake_case
      }
    }]
  });
  ```

  **Temporary Workaround:**

  If you need to temporarily disable validation while fixing your code:

  ```typescript
  defineStack(config, { strict: false }); // Bypass validation
  ```

  **Why This Change:**

  1. **Catches Errors Early**: Invalid field names caught during development, not runtime
  2. **Enforces Conventions**: Ensures consistent snake_case naming across all projects
  3. **Prevents AI Hallucinations**: AI-generated objects must follow proper conventions
  4. **Database Compatibility**: snake_case prevents case-sensitivity issues in queries

  **Impact:**

  - Projects with properly named fields (snake_case): ✅ No changes needed
  - Projects with camelCase/PascalCase fields: ⚠️ Must update field names or use `strict: false`

## 3.0.1

### Patch Changes

- 389725a: Fix build and test stability improvements

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

## 2.0.7

### Patch Changes

- Modularized kernel/events.zod.ts into 6 focused sub-modules for better tree-shaking and maintainability:

  - events/core.zod.ts: Priority, metadata, type definition, base event
  - events/handlers.zod.ts: Event handlers, routes, persistence
  - events/queue.zod.ts: Queue config, replay, sourcing
  - events/dlq.zod.ts: Dead letter queue, event log entries
  - events/integrations.zod.ts: Webhooks, message queues, notifications
  - events/bus.zod.ts: Complete event bus config and helpers

  kernel/events.zod.ts now re-exports from sub-modules (backward compatible).
  Created v3.0 migration guide.

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.5

### Patch Changes

- Unify all package versions with a patch release

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.2

### Patch Changes

- 1db8559: chore: exclude generated json-schema from git tracking

  - Add `packages/spec/json-schema/` to `.gitignore` (1277 generated files, 5MB)
  - JSON schema files are still generated during `pnpm build` and included in npm publish via `files` field
  - Fix studio module resolution logic for better compatibility

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.0

### Minor Changes

- 38e5dd5: feat: Studio DX, REST extraction, Dispatcher plugin
- 38e5dd5: test minor bump

## 1.0.12

### Patch Changes

- chore: add Vercel deployment configs, simplify console runtime configuration

## 1.0.11

## 1.0.10

## 1.0.9

## 1.0.8

## 1.0.7

## 1.0.6

### Patch Changes

- a7f7b9d: fix(data): add missing expand, top, having, distinct fields to QuerySchema for OData/ObjectQL compatibility

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance

## 1.0.4

## 1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.

## 1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

## 0.9.2

### Patch Changes

- Refactor documentation architecture and terminology (Data/System/UI Protocols).

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.

## 0.8.2

### Patch Changes

- 555e6a7: Refactor: Deprecated View Storage protocol in favor of Metadata Views.

  - **BREAKING**: Removed `view-storage.zod.ts` and `ViewStorage` related types from `@objectstack/spec`.
  - **BREAKING**: Removed `createView`, `updateView`, `deleteView`, `listViews` from `ObjectStackProtocol` interface.
  - **BREAKING**: Removed in-memory View Storage implementation from `@objectstack/objectql`.
  - **UPDATE**: `@objectstack/plugin-msw` now dynamically loads `@objectstack/objectql` to avoid hard dependencies.

## 0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2

## 0.4.1

### Patch Changes

- Version synchronization and dependency updates

  - Synchronized plugin-msw version to 0.4.1
  - Updated runtime peer dependency versions to ^0.4.1
  - Fixed internal dependency version mismatches

## 0.4.0

### Minor Changes

- Release version 0.4.0

## 0.3.3

### Patch Changes

- Workflow and configuration improvements

  - Enhanced GitHub workflows for CI, release, and PR automation
  - Added comprehensive prompt templates for different protocol areas
  - Improved project documentation and automation guides
  - Updated changeset configuration
  - Added cursor rules for better development experience

## 0.3.2

### Patch Changes

- Patch release for maintenance and stability improvements

## 0.3.1

## 0.3.0

### Minor Changes

- Documentation and project structure improvements

  - Comprehensive documentation structure with CONTRIBUTING.md
  - Documentation hub at docs/README.md
  - Standards documentation (naming-conventions, api-design, error-handling)
  - Architecture deep dives (data-layer, ui-layer, system-layer)
  - Code of Conduct
  - Enhanced documentation organization following industry best practices

## 0.2.0

### Minor Changes

- Initial release of ObjectStack Protocol & Specification packages

  This is the first public release of the ObjectStack ecosystem, providing:

  - Core protocol definitions and TypeScript types
  - ObjectQL query language and runtime
  - Memory driver for in-memory data storage
  - Client library for interacting with ObjectStack
  - Hono server plugin for REST API endpoints
  - Complete JSON schema generation for all specifications

## 0.1.2

### Patch Changes

- Remove debug logs from registry and protocol modules

## 0.1.1

### Patch Changes

- b58a0ef: Initial release of ObjectStack Protocol & Specification.
