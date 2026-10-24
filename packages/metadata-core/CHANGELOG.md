# @objectstack/metadata-core

## 18.1.0

### Minor Changes

- 386f60f: fix(spec)!: the `Field.select` string shorthand keeps every character it does not document transforming, so an option such as `'no-overlay'` is refused instead of being declared as a different value
  
  Clause-②: no (narrowing: a `Field.select` shorthand string the helper used to rewrite silently, e.g. `'no-overlay'` → `nooverlay`, is refused instead)
  
  Metadata-protocol: narrowed
  
  <!-- adr-0087: registered field-select-shorthand-keeps-written-value -->
  
  **BREAKING** (a TypeScript author's shorthand that used to be rewritten is now refused), shipped as `minor` under the launch-window convention for breaking changes.
  
  `Field.select(['a', 'b'])` and `Field.select({ options: ['a', 'b'] })` build each option as `{ label: s, value: … }`. The value used to be the string lower-cased, with whitespace turned into `_`, and then with every character outside `a-z`, `0-9` and `_` deleted. That last step was undocumented and silent: `'no-overlay'` became `nooverlay`, `'user-agent-based'` became `useragentbased`, `'v1.2'` became `v12`, and the field declared a value its author never wrote, so a record written with the value as written was refused with `invalid_option`.
  
  - **FROM:** a shorthand string is lower-cased, whitespace becomes `_`, and every other character outside `a-z0-9_` is deleted. `Field.select(['no-overlay'])` declares the option value `nooverlay`, and the object loads.
  - **TO:** a shorthand string is lower-cased and whitespace becomes `_`, nothing else. `Field.select(['no-overlay'])` declares `no-overlay`, which is not a system identifier, so the object is refused by the rule an explicit `{ value: 'no-overlay' }` already met: `ObjectSchema.create` throws a `ZodError` at module load with `invalid_format` at `fields.FIELD.options.N.value` and the message `System identifier must be lowercase, starting with a letter, and may contain letters, numbers, underscores, or dots`, and the object save door answers `422 INVALID_METADATA` with the same finding. A dot is now kept (`'v1.2'` declares `v1.2`, which is a valid identifier).
  - **Unchanged:** `Field.select(['In Progress', 'Closed Won'])` still declares `in_progress` and `closed_won`. An explicit option's value is still lower-cased. `SelectOptionSchema.value` accepts and refuses exactly what it did before.
  - **The fix:** write such an option explicitly, with the value you will store: `Field.select({ options: [{ label: 'no-overlay', value: 'no_overlay' }] })`. If rows already hold the hyphenated spelling, the column is not a select: declare it as `Field.text({ maxLength: 255 })`.
  
  `@objectstack/metadata-core`: `sys_metadata_audit.lock_state` was the one in-tree column relying on the strip. It declared the options `none`, `nooverlay`, `nodelete` and `full`, while its writer stores the `MetadataLock` spelling (`none`, `no-overlay`, `no-delete`, `full`), so no `no-overlay` or `no-delete` row ever matched a declared option. It is now `Field.text({ maxLength: 255 })`, read-only as before. `GET /api/v1/meta/object/sys_metadata_audit` serves `lock_state` as `type: 'text'` with `maxLength: 255` and no `options`. No stored row is rewritten, the writer and reader are unchanged, and an existing `varchar(255)` column reports no schema drift on postgres, mysql or sqlite.
  
  `@objectstack/platform-objects`: the translation bundles drop the four `sys_metadata_audit.lock_state` option labels (`none`, `nooverlay`, `nodelete`, `full`), which the column no longer declares. The field label stays translated.

### Patch Changes

- b42c621: fix(lint)!: `os lint` and the react-page props check report the retired list-view `filterableFields` by name, and the readers that still treated it as a field position go
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: not-required (already-registered view-list-filterable-fields-removed, list-view-filterable-fields-retired) The key's retirement, its D2 conversion and its D3 entry are already registered by the change that tombstoned it, which shipped in 18.0.0. This change adds no key, conversion or stored shape: it makes `os lint` and the react-page props check give the verdict `os validate` and `os build` already give the list-view key, with the tombstone's own prescription. -->
  
  **BREAKING** (an authoring narrowing), shipped as `minor` under the launch-window convention for breaking changes.
  
  `@objectstack/spec` 18 retired the list view's `filterableFields` with a `retiredKey()` tombstone, so `os validate` and `os build` refuse it at the parse. Two authoring checks still read it as a live field position:
  
  - **`os lint`** never parses: it judges the normalized stack, and the conversion that strips the key is retired from the load path. On a JSON, YAML or raw-object source the key reached the list-view field-reference rule as written. A valid field name passed `os lint`, and a stale one was reported as an unknown field (`list-view-field-unknown` / `list-view-field-dotted`), never as the retirement.
  - **The react-page props check** read `<ListView filterableFields={[…]}>` as a field-bearing prop. A react page's source is parsed against no list-view schema, so `os validate`, `os build` and `os lint` passed the prop whenever its names resolved.
  
  Both now refuse the key by name, as an `error`, whatever it names:
  
  - a list view (every rung: an object's `listViews`, a `defineView` container's `list` / `listViews`, the flattened list overlay and the view item record) reports `list-view-key-retired` at `….filterableFields`, whether or not its object binding resolves;
  - `<ListView filterableFields>` on a react page reports `react-prop-retired`.
  
  The message names the retirement and the hint is the tombstone's own "Delete the key" sentence, read from `ListViewSchema` rather than retyped. The new rule id is exported from the package root as `LIST_VIEW_KEY_RETIRED`.
  
  ### FROM → TO
  
  | before | after |
  | --- | --- |
  | `filterableFields: ['status']` on a list view in a non-`defineStack` source: `os lint` passed | `os lint` fails with `list-view-key-retired` |
  | `filterableFields: ['ghost']` on such a list view: `list-view-field-unknown` | `list-view-key-retired` |
  | `<ListView filterableFields={['status']} />` on a react page: passed every authoring command | `react-prop-retired` |
  
  **The one-line fix:** delete `filterableFields` (the key or the prop). For a curated end-user filter bar, declare `userFilters: { element: 'dropdown', fields: [{ field: 'status' }] }`; the Filter panel offers every field the user may read. `os migrate meta --from 17` lists the edits for existing metadata sources; a react page's source is yours to edit by hand.
  
  ### The residue readers that go
  
  - **`@objectstack/lint`**: the list-view field-reference rule no longer walks `filterableFields` as a filter position (its severity and dotted-path maps), the field-consumer rule no longer counts it as a behavioural read, and `os explain list-view-field-unknown` / `list-view-field-dotted` no longer name it as a checked position.
  - **`@objectstack/metadata-protocol`**: `computeViewReferenceDiagnostics` no longer walks `filterableFields`, the same deletion its retired sibling `tabs` had. A stored body has the key stripped by the conversion replay before it is served, and the write door refuses it.
  - **`@objectstack/metadata-core`**: the ADR-0106 field-security scrub no longer classifies `filterableFields` as a list-view name list. A body that still carries the key goes the unclassified way and fails closed: a list view whose `filterableFields` names a field the caller may not read is dropped whole, where the scrub used to remove the name.
  
  ⛔ **Untouched:** `userFilters` and `searchableFields` keep their meaning and their checks.
- dc532e8: feat(spec): a roster object can declare its membership keys, `ObjectSchema.membershipKeys`
  
  Clause-②: yes (widening)
  Metadata-protocol: added
  
  `ObjectSchema` gains one optional key, `membershipKeys`: the `current_user.KEY` sets this object defines, by name, the metadata twin of the registered membership resolver (ADR-0105 D11). `current_user.KEY` is to be the distinct values of `valueField` on this object's rows whose `userField` is the signed-in user and on which the optional `filter` holds, so a permission set's row policy can read `supplier in current_user.portal_supplier_ids` instead of a stamp on every record. The entry shape is exported as `MembershipKeySchema` from `@objectstack/spec/security` (types `MembershipKey` and `MembershipKeyParsed`), with the map `MembershipKeysSchema` (`MembershipKeys`, `MembershipKeysParsed`), the name rule `MembershipKeyNameSchema` (`MembershipKeyName`, `MembershipKeyNameParsed`) and the platform bound `MEMBERSHIP_KEY_MAX_VALUES` (1,000).
  
  - **What it parses.** `userField` and `valueField` (required column names), `filter` (CEL over this object's own columns), `label` and `description`.
  - **What it refuses.** Any other member (`object`, which is implied, and an authored size such as `limit`, each with a prescription); a key name that is not snake_case or is one of the kernel's own context names (`id`, `organization_id`, `positions`, `org_user_ids`, `accessible_org_ids`, `email`); `valueField` naming the same column as `userField`; and `membershipKeys` on an object extension, so a key can only be declared by the package that owns the roster object.
  - **`defineStack` and `composeStacks`** refuse one key declared on two objects, in the cross-reference envelope (`STACK_CROSS_REFERENCE_INVALID`, 422): a key name is one request-wide name. Under `objectConflict: 'merge'`, two stacks declaring a different `membershipKeys` on one object are refused like every other object-level collection.
  - **What it does today: nothing.** No server reads the key in this release, so a policy reading a declared key matches no rows, as it would for any key nothing supplies. Authoring the key raises the liveness lint's `liveness-planned-property` warning until the security plugin stages it. Scope rows with positions or a registered membership resolver in the meantime.
  - **`@objectstack/metadata-core`: the field-level-security projection classifies the new key.** When an object document is served to a caller who cannot read some of its fields, each membership key whose `userField`, `valueField` or `filter` names such a field is dropped whole from the served document; the others are served unchanged.
  - The row-level security docs no longer say the runtime stages `territory_account_ids` or `team_member_ids`: those are app-supplied keys, and the docs now say where a membership key comes from.
  - Additive: every object that parsed before still parses, and its parsed output is unchanged.
- ee63b47: fix: Setup field help is written for administrators, and the two access-review fields nothing uses yet are hidden from the Setup forms
  
  Clause-②: no
  Metadata-protocol: none
  
  A Setup pass met field help written for the platform's developers: "Foreign key to sys_user.id", "NULL only on a grant written before the column existed", "via isGrantActive", "(P3 digest middleware)", "Owned by objectql (better-auth is oblivious to this column)", "LifecycleService (Reaper / Rotator / Archiver)" and ADR numbers. Each now says what the field means and what to do with it, in every shipped locale (`en` regenerated from the source; `zh-CN`, `ja-JP` and `es-ES` translated):
  
  - the user, OAuth application, session and refresh-token fields of the permission-set and position assignments and of the OAuth token, consent and client-resource objects, and the package-version field of stored metadata;
  - the permission set picked on an assignment;
  - the start time of an approval delegation;
  - the digest cadence and quiet hours of a notification preference, which now say how each value behaves;
  - the AI Access and Locale fields of a user;
  - the Data Lifecycle settings page and its retention overrides.
  
  `Last Certified At` and `Certified By` on `sys_user_permission_set` and `sys_user_position` are reserved for a future access-review feature and nothing writes or reads them. They are now `hidden: true`, so the Setup forms and detail pages no longer show them. The columns and any stored values stay.
- Updated dependencies [448374d]
- Updated dependencies [7cacad5]
- Updated dependencies [df8bb40]
- Updated dependencies [0091d84]
- Updated dependencies [5e9b100]
- Updated dependencies [7532ea3]
- Updated dependencies [fde7456]
- Updated dependencies [de9cd1f]
- Updated dependencies [925fd07]
- Updated dependencies [e7befa7]
- Updated dependencies [55d7aab]
- Updated dependencies [0715fac]
- Updated dependencies [60b42cd]
- Updated dependencies [b9a79ef]
- Updated dependencies [63085c3]
- Updated dependencies [0b8bce4]
- Updated dependencies [2069b81]
- Updated dependencies [1862d8d]
- Updated dependencies [30d21f6]
- Updated dependencies [eddffc3]
- Updated dependencies [69712d5]
- Updated dependencies [e939357]
- Updated dependencies [045858f]
- Updated dependencies [baedcec]
- Updated dependencies [03c12a5]
- Updated dependencies [386f60f]
- Updated dependencies [28c9a2c]
- Updated dependencies [2354058]
- Updated dependencies [edcc8ce]
- Updated dependencies [fccbd9d]
- Updated dependencies [c8f4c43]
- Updated dependencies [02ad31a]
- Updated dependencies [03966ce]
- Updated dependencies [e3aa111]
- Updated dependencies [863c580]
- Updated dependencies [7f5b19d]
- Updated dependencies [14e7239]
- Updated dependencies [fe0ec2b]
- Updated dependencies [dfab597]
- Updated dependencies [9127f23]
- Updated dependencies [24360dc]
- Updated dependencies [ecb4e69]
- Updated dependencies [bda53bb]
- Updated dependencies [b964ea1]
- Updated dependencies [9019af9]
- Updated dependencies [45f9962]
- Updated dependencies [e5eab06]
- Updated dependencies [dc532e8]
- Updated dependencies [5f30f00]
- Updated dependencies [7db1697]
- Updated dependencies [f5b6b3f]
- Updated dependencies [f4112a7]
- Updated dependencies [303aef0]
- Updated dependencies [d12e650]
- Updated dependencies [830a63a]
- Updated dependencies [1000cc7]
- Updated dependencies [bdf762c]
- Updated dependencies [27b3f1f]
- Updated dependencies [7c68b10]
- Updated dependencies [025f6de]
  - @objectstack/spec@18.1.0

## 18.0.0

### Minor Changes

- 06cc45d: Under a walled posture the security catalog is the platform operator's: tenants are refused creating, changing or deleting positions, permission sets and capabilities, and may only assign them
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: registered walled-catalog-tenant-writes-retired -->
  
  **BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D3: "Shared-DB multi-tenant (`group` / `isolated`): tenant admins cannot create or edit catalog items; the operator defines the catalog for every tenant … Creation through Setup or the API is refused with a message naming the posture and the capability.").
  
  **Why.** The catalog is environment-level, and every organization resolves it by name. Measured on a booted `isolated` and `group` stack: an organization owner granted `manage_metadata` inside their own organization saved `PUT /meta/permission/:name` over a permission set another organization's member holds, and that member's next resolution carried the change. One organization's write changed what another organization's members resolve.
  
  **FROM → TO**, on a `group` or `isolated` deployment, for a caller below the platform operator (the `PLATFORM_ADMIN` rung: the deployment's declared `OS_PLATFORM_OWNER_EMAIL` owner):
  
  - `PUT /meta/:type/:name`, `DELETE /meta/:type/:name`, `POST /meta/:type/:name/publish` and `POST /meta/:type/:name/rollback` on `@objectstack/rest`, and `PUT /meta/:type/:name` on the runtime dispatcher, for `position` or `permission`: **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN` (the dispatcher's `PUT` answers `403 PERMISSION_DENIED`). The message names the posture and the capability.
  - The same doors for `capability`: admitted where they were admitted. `capability` is a code-only type, so these doors already refused its writes before this change; only the sentence the caller reads changes, to the posture refusal. For `capability`, the accept set narrows at the data door on `sys_capability`, below.
  - `POST /security/permission-sets/:name/clone` (the permission-set clone door): **FROM** admitted to any `manage_metadata` holder **TO** `403 PERMISSION_DENIED`, before the source is read.
  - A data-door insert, update or delete on `sys_position`, `sys_permission_set` or `sys_capability`: **FROM** admitted to any caller whose grants admit the table (a `sys_permission_set` create landed in the environment ledger; a `sys_position` create landed as an organization row with no definition) **TO** `403 PERMISSION_DENIED`, before anything is written. This includes an ADR-0090 D12 delegate whose `adminScope` carries `authorEnvironmentSets`: under a wall it can no longer author environment permission sets at the data door. Its assignment and binding paths are untouched.
  
  **Unchanged.** Assignments: `sys_user_position` and `sys_user_permission_set` rows stay organization rows that an organization's administrators write for their own members. The platform operator and the engine's own writes (seeders, installers, migrations) write the catalog as before. Every other metadata type is untouched. Under `single` (and with no `tenancy` service), catalog writes stay with `manage_metadata` holders, exactly as before. The catalog activation door already required the platform operator under a wall.
  
  **The remedy.** A tenant that needs a position or permission set asks the platform operator to define it in Studio, or through a managed package. The tenant's administrators then assign it to their members. `@objectstack/spec` registers the change as the ADR-0087 semantic entry `walled-catalog-tenant-writes-retired`. `@objectstack/metadata-core` exports the one predicate every door asks, `walledCatalogWriteVerdict`, beside `isSecurityCatalogType`, `SECURITY_CATALOG_TYPES` and `PLATFORM_OPERATOR_POSTURE`. A custom door that writes catalog items asks it after `metaWriteCapabilityVerdict`.
- 7895671: feat(metadata-core,rest,runtime,plugin-email,spec)!: the `/meta` doors carry no organization; organization-admin metadata authoring closes and `manage_org_presentation` retires (ADR-0131 D6)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered manage-org-presentation-retired, meta-doors-organization-scope-retired -->
  
  **BREAKING**, graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N`.
  
  ADR-0131 D6 retires the per-organization overlay axis: environment metadata written by Studio belongs to the whole deployment. The `/meta` doors of both transports (`@objectstack/rest` and the runtime dispatcher's `/meta` branch) used to thread the caller's active organization into writes and reads of the five `allowOrgOverride: true` types (`view`, `dashboard`, `report`, `translation`, `email_template`). They no longer do, for any type, and the read and the write flip together.
  
  **What changes.**
  
  - **Writes land environment-wide.** `PUT`, `DELETE`, `POST …/publish` and `POST …/rollback` on `/api/v1/meta/:type/:name` hand the protocol no organization, so the row and its audit and history rows carry `organization_id` NULL, whatever the caller's active organization.
  - **Reads are environment → code.** The item read (both cache arms), the list, the layered view (`/layers` and `?layers=true`), `/published`, `?state=draft`, `GET /meta/_drafts`, `/history`, `/diff`, `/audit` (the environment rows, `organizationId: null`), `GET /meta/diagnostics` and `/references` name no organization.
  - **An organization admin's metadata write is refused.** `metaWriteCapabilityVerdict` admits `isSystem` or `manage_metadata` only. A caller holding `manage_org_presentation` and not `manage_metadata` is answered `403` on all four item doors (`FORBIDDEN` on REST, `PERMISSION_DENIED` on the dispatcher) with `… requires the \`manage_metadata\` capability.`, for every type and whatever its active organization.
  - **`manage_org_presentation` retires** from `PLATFORM_CAPABILITIES` (`@objectstack/spec/security`). A permission set naming it still parses and loads, and its other grants still apply; the grant itself admits nothing. The `sys_capability` row seeded for it earlier is not pruned (the seeder upserts only); an operator may delete it in Setup.
  - **The email-template boot sweep** (`@objectstack/plugin-email`) reads the effective templates environment → code, as the door serves them; it no longer reads in the Default Organization.
  
  **What moves for consumers.**
  
  - FROM `import { organizationIdForMetaWrite } from '@objectstack/metadata-core'` TO nothing: a `/meta` write carries no organization. Delete the call and the `organizationId` it fed.
  - FROM `import { ORG_PRESENTATION_AUTHORING_CAPABILITY } from '@objectstack/metadata-core'` TO nothing: delete the import.
  - FROM `metaWriteCapabilityVerdict({ isSystem, systemPermissions, canonicalType, activeOrganizationId, operation })` TO `metaWriteCapabilityVerdict({ isSystem, systemPermissions, operation })`: drop the two members.
  - FROM `import { metaReadOrganizationId } from '@objectstack/rest'` TO nothing: a `/meta` read carries no organization. `metaCallerOrganizationId` stays.
  - FROM `bootstrapEffectiveEmailTemplates(engine, metadataService, { protocol, tenancy })` TO `{ protocol }`: the `tenancy` source is gone.
  - A permission set granting `manage_org_presentation`: grant `manage_metadata` to whoever must author those five types, and delete the stale grant.
  
  **What a deployment observes.** An overlay row an earlier release stored under an organization stays in `sys_metadata` untouched, and is no longer served by any `/meta` read or projected by the email-template sweep until the promotion ceremony (ADR-0131 C7) carries it to the environment layer. Under the `single` posture that is every earlier Studio save of the five types, because it was filed under the Default Organization: on the `/meta` doors such an edit reads as reverted to the environment or code definition. Re-save the item in Studio to make the edit live on the `/meta` doors now. Public forms are the exception: until that ceremony the anonymous form doors read a form `view` in the Default Organization and prefer its overlay for the form's body, while a withdrawal in either layer closes the form, fail-closed. So a legacy organization overlay of a public form keeps serving its body there: a Studio re-save of that body (an environment row) does not change the body the public form serves, and a Studio withdrawal (an environment row) still closes it.
  
  **What does not change.** Saves of every other type were already environment-wide. Flow saves, the capability gate's answer for `manage_metadata` holders and `isSystem`, the protocol's own organization-scoped refusals, and the `/packages` doors are untouched by this change.
- c8b062f: feat(metadata-protocol,metadata-core,objectql,rest,plugin-security,spec)!: every metadata read is environment → code; legacy organization rows and overlays of sealed managed content are reported at boot, not served (ADR-0131 D6)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered metadata-read-organization-scope-retired -->
  
  **BREAKING (narrowing).** No read that is refused today is admitted. Graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N`.
  
  ADR-0131 D6 retires the per-organization overlay axis. The doors carry no organization and the protocol refuses every organization-scoped write; now every protocol read is environment → code as well.
  
  **What changes.**
  
  - The item, list, layered, cached (ETag), history, diff, audit, drafts and commit-timeline reads, the `_lock` gate's overlay layer, search's page sweep, diagnostics and references serve the environment's stored row, else the code packages' definition — whatever organization a caller names. A row stored organization-scoped by an earlier release is served by no read and loaded by no boot.
  - `overlayScope` on the layered read is `'env'` or `null`; `'org'` is gone.
  - `listDrafts` lists the environment's drafts only, and its rows carry no `organizationId`.
  - `listCommits` lists the environment's commits only, for every caller: a legacy organization commit is not shown, so an operator on the packages door no longer sees every organization's legacy commits, and a rollback plan never contains one.
  - [Triage ruling Q1 → C] An environment row that overlays an item a managed package ships, on a type sealed against overlays (any type whose registry entry admits no overlay — a managed flow, action, hook, object or datasource, for example — written through the `OS_METADATA_WRITABLE` hatch before the seal), is not served: the package's definition is. An `object` such row is not loaded at boot either, so the engine keeps the packaged schema. A stored fork of a code-declared permission set keeps its own ruling instead: the reads do not decline it, a cold boot refuses a deployment that holds one (ADR-0048), and the offline `os migrate security-catalog-overlays` removes it.
  - `@objectstack/objectql` binds the environment's authored hook and action rows only; a legacy organization-scoped hook or action row is no longer bound.
  - Boot names both populations, once each: `[metadata_org_scoped_unserved]` lists every legacy organization row per type (active and draft), plus the legacy rows of `sys_metadata_commit`, `sys_metadata_history` and `sys_metadata_audit`, and names the v18 migration ceremony (`os migrate`, ADR-0131 D10) that carries them; `[metadata_sealed_overlay_unserved]` lists the sealed overlays per type with the two remedies. Nothing is deleted or rewritten.
  - The anonymous public-form doors keep reading the Default Organization's legacy `view` layer, fail-closed, until that ceremony (triage ruling Q3 A) — through the protocol-internal `legacyFormOrganizationId` key, which no spec request declares and which the protocol honours for `view` alone.
  - The seed loader's refusal of an unowned record now prescribes `organization_id` on the record first: a seed published through a package carries no caller organization.
  
  **What moves for consumers.**
  
  | From | To |
  |:--|:--|
  | `organizationId` on a `GetMetaItems` / `GetMetaItem` / `GetMetaItemLayered` / `AuditMetaItem` / `HistoryMetaItem` / `GetMetaItemCached` request (`@objectstack/spec`) | drop it: the read is the environment's. The key is stripped at a spec parse (the schemas are not strict) and no longer type-checks |
  | `organizationId` on a `listDrafts` / `listCommits` / `diffMetaItem` / `getMetaDiagnostics` / `findReferencesToMeta` request (`@objectstack/metadata-protocol`) | drop it |
  | `ListDraftsResponse` draft `organizationId` | gone: every listed draft is the environment's |
  | `SysMetadataRepository.listDrafts` row `organizationId` (`@objectstack/metadata-protocol`) | gone: every listed row is an environment draft, whichever repository asks |
  | `overlayScope: 'org'` (`GetMetaItemLayeredResponse`) | only `'env'` or `null` |
  | `declaresOrgOverride`, `organizationIdForMetaRead` (`@objectstack/metadata-core`) | removed — no read takes an organization. Read `allowOrgOverride` off `DEFAULT_METADATA_TYPE_REGISTRY` where a type's overlay channel is the question |
  | `MetadataAuthoringGateContext.organizationId` (`@objectstack/metadata-protocol`) | removed — no write is organization-scoped, and no gate read it |
  | `organizationId` on `projectPermissionMutation`'s `evt` (`@objectstack/plugin-security`) | drop it: the projection reads the environment → code layered read, whatever organization the event names |
  | a legacy organization-scoped `sys_metadata` row a deployment relied on | re-save the item in Studio to make it environment-wide now, or wait for the v18 migration ceremony, which promotes it |
  | an environment overlay of a managed item on a sealed type (flow, action, hook, object, datasource …) | re-express the change as a new item under a new name (a linkage-free clone), then delete the stored row; or delete the row |
  
  **What does not change.** No stored row is deleted, rewritten or migrated. The anonymous form doors' read of organization-layer withdrawals is unchanged.
- 117d34d: feat(metadata-core,metadata-protocol,metadata,platform-objects,spec)!: `sys_view_definition` retires as inert (ADR-0131 D13)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered sys-view-definition-retired -->
  
  **BREAKING**, graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N` like every other stage.
  
  `sys_view_definition` was declared for runtime-authored shared and personal views (ADR-0017) and never used for them: no framework code writes or reads its rows, and the Studio console's view doors write the ADR-0005 `view` overlay in `sys_metadata` through the metadata API. ADR-0131 D13 retires it. A runtime-authored view is a `view` metadata item, written through `PUT /api/v1/meta/view/<name>` (the client's `meta.saveItem` for type `view`); nothing about that path changes.
  
  **What moves for consumers.**
  
  - **The object.** FROM `import { SysViewDefinitionObject } from '@objectstack/metadata-core'` (or from `@objectstack/platform-objects`, or its `/metadata` subpath) TO nothing: delete the import. Neither `MetadataPlugin` nor the metadata protocol assembly registers the object any more, so the generic data door no longer serves it.
  - **The migration exports** of `@objectstack/metadata-protocol`. FROM `ensureViewDefinitionActiveIndex`, `resolveIndexExec`, `buildActiveIndexSql`, `VIEW_DEFINITION_TABLE`, `VIEW_ACTIVE_INDEX_NAME`, `VIEW_ACTIVE_PROBE_INDEX_NAME`, `VIEW_ACTIVE_INDEX_COLUMNS`, `EnsureViewIndexLogger`, `EnsureViewIndexStatus` and `EnsureViewIndexResult` TO nothing: delete the import. `classifyIndexFailure` and the `IndexExec` type are still exported, unchanged, from the shared index-migration module.
  - **The name.** `PLATFORM_OBJECTS_BY_PACKAGE['metadata-core']` (`@objectstack/spec/system`) lists four objects, and `isPlatformProvidedObjectName` answers `false` for `sys_view_definition`. A stack that names it (a lookup target, a flow trigger, a permission entry, a platform-global declaration) is now flagged as naming an unknown object: remove the reference.
  - **`os migrate duplicates`.** `runtimeIndexPreflight` carries three entries (the two `sys_metadata` overlay indexes and `sys_setting`'s row identity), with no `idx_sys_view_def_active` entry. A serving boot no longer runs the active-row index migration for the table, and no longer logs its `sys_view_definition active-row index` lines.
  - **Translations.** The platform translation bundles no longer carry `sys_view_definition` keys.
  
  **Existing databases.** Schema sync is additive and never drops a table, so a database an earlier release provisioned keeps `sys_view_definition`, with any rows a caller wrote through the generic data door; nothing reads them. `os migrate apply --allow-destructive` does not drop it either, because it reconciles declared objects only (measured on one database: it dropped an orphaned column of a declared table and left this table and its row in place). On a project with a host config, `os migrate plan` lists it among the platform-prefixed tables nothing declares. Export any row worth keeping; dropping the table is the operator's call, by hand: `DROP TABLE sys_view_definition`.
- f4069c5: fix(metadata): the object read's `sortability` follows the caller's field permission for every caller class
  
  Clause-②: yes (widening)
  
  - **What was wrong.** ADR-0106 D4 serves a caller holding `manage_metadata`, `studio.access` or `setup.access` (a platform admin, and an organization admin through `setup.access`) the object schema UNMASKED, because Studio and Setup authoring need the whole definition. The `sortability` projection served beside it on `GET /meta/object/:name` (and the runtime dispatcher's `/metadata/object/:name`) was derived from that unmasked document, so it marked a field `sortable: true` that the same caller's field permission marks unreadable, while the data route refuses a sort or filter on that field with `403 PERMISSION_DENIED`. A client building its sort picker from the projection offered a click the server refuses.
  - **What changes.** `sortability` is now derived from the caller's runtime view: the served document for every caller the mask projects (unchanged), and for a D4-exempt caller the fields their own field permission reads. The definition (`item.fields`) is unchanged for every class: whole for an exempt caller, masked for everyone else. The data route and `/auth/me/permissions` are unchanged.
  - **Caching.** On the cached `GET /meta/object/:name` branch an exempt caller's ETag folds a fingerprint of the fields withheld from their projection, and the conditional request is judged after it is folded. An exempt caller whose permission withholds nothing keeps the byte-identical ETag. An exempt caller and a projected caller denied the same field never share a validator.
  - **Failure posture.** The exempt caller's field permission is asked lazily, only by the item read that serves `sortability`, and never turns their definition read into a fault: if the security service throws or cannot answer, `sortability` is derived from the served document as before, with one `warn`.
  - **New in `@objectstack/metadata-core`.** `resolveObjectSchemaRuntimeView(document, posture)` returns `{ document, withheld, fingerprint }`, the view the runtime projections beside an object schema are derived from. The types `ObjectSchemaRuntimeView` and `ObjectSchemaRuntimeFieldPosture` are exported with it, and the `passthrough` member of `ObjectSchemaMaskPosture` gains an optional `runtime` (set on an `exempt` posture for a capability-exempt caller in a deployment with a `security` service).
  - **New in `@objectstack/rest`.** `translateMetaEnvelope` takes an optional fifth argument, `runtimeDocument` (default: the served document), and `MetaItemAnswerSources.translateEnvelope` an optional third. Nothing is removed, renamed or narrowed.
- 8532783: feat(service-datasource,metadata-core)!: the datasource-admin plugin reads the environment's stored `datasource` rows only; a legacy organization-scoped row is neither loaded at boot nor served (ADR-0131 D6)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (already-registered metadata-read-organization-scope-retired) That entry retires every metadata read of a row stored organization-scoped, the boot hydration included, and states that such a row is served by no read and loaded by no boot. This changeset carries the same rule to the datasource-admin plugin's own reads of sys_metadata: no key, export or stored shape is removed, renamed or re-shaped, and nothing is rewritten. -->
  
  **BREAKING (narrowing).** Graded `minor` on the v18 prerelease line, as the read narrowing it completes.
  
  **What changes.** `DatasourceAdminServicePlugin` reads stored `datasource` rows in five places — the boot restore (`restoreRuntimeDatasources`), the by-name read behind cluster convergence and the `/meta` door's datasource projection, and the existence probes behind its own create, update and remove. Each now reads the environment's rows only, judged by the same row-value test the metadata reads apply. A row stored organization-scoped by an earlier release:
  
  - is no longer registered at boot, so the datasource-admin door and the metadata read door no longer serve it, and no live pool is opened from it;
  - is never updated or deleted by an admin create, update or remove under its name — those write and remove an environment row of their own;
  - stays at rest, and the boot report `[metadata_org_scoped_unserved]` keeps naming it. Nothing is deleted or rewritten; the v18 migration ceremony (`os migrate`, ADR-0131 D10) carries it.
  
  **What moves for consumers.**
  
  | From | To |
  |:--|:--|
  | a legacy organization-scoped runtime datasource a deployment relied on | re-create it through the datasource-admin door or save it through the `/meta` door to make it environment-wide now, or wait for the v18 migration ceremony |
  
  `@objectstack/metadata-core` exports `isLegacyOrganizationRow`, the one row-value test for such a row; `@objectstack/objectql`'s authored hook and action binders now read it from there, with no change in what they bind.
- 58f5c90: fix(metadata-core): an artifact declaring `engines.protocol: '^18'` that was built during the v18 prerelease boots on a later runtime that retired one of its shapes — the artifact door replays every retired conversion of protocol 18's step for a floor of `18.0.0`
  
  Clause-②: yes
  
  **What an operator saw.** A compiled artifact (`os build` → `dist/objectstack.json`) that declares `engines.protocol: '^18'` and was built before a protocol-18 retirement landed carries the retired shape, for example a defaulted key that every earlier parse emitted. Booted on a runtime that enforces the retirement, the metadata plugin's startup refused it at the strict parse and the boot rolled back. The artifact door compared the floor `18.0.0` with each retirement's `retiredAfter` stamp, and every retirement that lands during the v18 prerelease is stamped with the last 17.x release, below that floor, so nothing was replayed.
  
  **What an operator sees now.** The same artifact boots. One warning per conversion names it and its site count: `[MetadataPlugin] artifact 'LABEL' declares the first release of protocol 18 (authored engines.protocol floor 18.0.0), which a build from any 18.0.0 prerelease declares too, so it may predate retirements in the conversion step into protocol 18 that this runtime enforces (runtime spec VERSION) — converted N site(s) forward via ADR-0087 conversion 'ID' …`. The artifact file itself is unchanged, so it converts again on every boot until it is rebuilt with `os build`. An artifact built after the retirement boots exactly as before: the replay finds nothing to convert, and nothing is logged.
  
  - **`@objectstack/metadata-core`.** `applyArtifactForwardConversions` opens its window on a third condition. A declared floor of `M.0.0` at or above the runtime label replays every retired entry whose `toMajor` is `M`, except the default flips the door already refuses. An artifact cannot say which of those entries it predates: it carries no field naming the spec or CLI that built it. Each entry rewrites only its own old shape, so the replay changes nothing in an artifact that lacks that shape. `ArtifactForwardConversionVerdict` gains `'converted-major-step'`, so a consumer that switches exhaustively over the verdict adds that arm. `replayedRetirements` still lists only the entries the per-entry rule opened. The rule holds for every 18.0.0 prerelease label and at 18.0.0 itself. From 18.0.1 on, the label half replays the whole chain for such an artifact, as before.
  - **`@objectstack/metadata`.** The artifact door places the new verdict on the open side of its window table and gives it its own clause, so the summary never claims that a `^18` artifact "predates" a runtime labelled below it. The bare-root form-predicate notice uses the same window.
  
  **Unchanged.** The protocol handshake still refuses a `^17` artifact on a protocol-18 runtime and prescribes `objectstack migrate meta --from 17`. A floor above `M.0.0` (such as `^18.0.1`) and a 17.x floor keep their previous verdicts.
- 430e5f5: fix(security)!: under a walled posture every environment-metadata write is the platform operator's, whatever its type (ADR-0131 D12 items 7–8, D11)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered walled-environment-metadata-writes-retired -->
  
  **BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes. ADR-0131 D12 item 7: a walled deployment is "one environment, one schema, one catalog … The metadata-authoring capability (`manage_metadata` / `studio.access`) is what headquarters IT holds and plant admins do not." Item 8: a plant "cannot create a position, a permission set, a capability, a template or any metadata … A plant that needs its own catalog is given its own environment." D11: the rules are identical in every posture; only whether the wall is enforced differs.
  
  **Why.** The environment definition ledger carries no organization column, so a write lands for every organization. Measured on booted `isolated` and `group` stacks before this change: an organization owner granted `manage_metadata` inside their own organization created an object, a view and a flow at `/api/v1/meta`, edited, published, rolled back and reset the operator's view, ran `POST /api/v1/meta/_migrate-stored`, passed all thirteen `/api/v1/packages` write doors, installed, upgraded and uninstalled packages through `install-local`, and created a flow at `/api/v1/automation`, each with `2xx`; another organization's owner read every result. The security catalog was refused at these doors already; every other type was not.
  
  **FROM → TO**, on a `group` or `isolated` deployment, for a caller below the platform operator (the `PLATFORM_ADMIN` rung: the deployment's declared `OS_PLATFORM_OWNER_EMAIL` owner):
  
  - `PUT`, `DELETE`, `POST …/publish` and `POST …/rollback` of `/api/v1/meta/:type/:name` on `@objectstack/rest`, and `PUT /meta/:type/:name` on the runtime dispatcher, for a type outside the security catalog (`object`, `view`, `flow`, `app`, `dashboard`, `translation` and every other type): **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN` (the dispatcher answers `403 PERMISSION_DENIED`).
  - Every `/api/v1/packages` write on the runtime dispatcher — create, the manifest `PATCH`, enable, disable, publish, publish-drafts, discard-drafts, revert, rollback, `commits/:commitId/revert`, duplicate, adopt-orphans and delete — for a package carrying no position, permission set or capability: **FROM** admitted to any `manage_metadata` holder **TO** `403 PERMISSION_DENIED`, before anything is read or written. The refusal no longer reads the package's items.
  - `POST /api/v1/marketplace/install-local` (install and upgrade) and `DELETE /api/v1/marketplace/install-local/:id` (uninstall) on `@objectstack/cloud-connection`, for a package carrying no catalog item: **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN`. The refusal's `error.details` no longer carries `catalogItems`; it carries `manifestId`.
  - `POST /api/v1/automation`, `PUT /api/v1/automation/:name`, `DELETE /api/v1/automation/:name` and `POST /api/v1/automation/:name/clone`: **FROM** admitted to any `manage_metadata` holder **TO** `403 PERMISSION_DENIED`, before the automation service is touched.
  - `POST /api/v1/meta/_migrate-stored`, the install-wide rewrite of the stored metadata, preview and apply alike: **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN` on `@objectstack/rest` and `403 PERMISSION_DENIED` on the runtime dispatcher, before a row is read.
  - Every one of these refusals carries one sentence: it names the written type (`a package` at the package doors, `the environment's stored metadata` at the rewrite), the posture and "ADR-0131 D3, D12 items 7–8, D11", and points at an environment of the organization's own. The catalog refusals that shipped before keep their envelopes and now read the same sentence.
  - The activation refusals under a wall (`POST /api/v1/automation/:name/toggle`, `POST /api/v1/actions/_activation/…`, `POST /api/v1/security/_activation/permission/…`) no longer recommend cloning a flow or a permission set, or authoring a sibling action, since those writes are the operator's under a wall too; they name the platform operator.
  
  **Unchanged.** Reads. Assignments: `sys_user_position` and `sys_user_permission_set` rows stay organization rows. The platform operator and the engine's own writes (seeders, installers, migrations) write as before. Under `single` (and with no `tenancy` service), a `manage_metadata` holder writes exactly as before.
  
  **The remedy.** The platform operator authors the environment's metadata, in Studio or through a managed package; an organization that needs metadata of its own is given an environment of its own. `@objectstack/spec` registers the change as the ADR-0087 semantic entry `walled-environment-metadata-writes-retired`. `walledCatalogWriteVerdict` (`@objectstack/metadata-core`) now judges every type alike: a custom door that writes environment metadata asks it after its capability gate, with no `isSecurityCatalogType` pre-filter.
- dd29bbe: feat(metadata-core,metadata-protocol)!: the `sys_metadata` family declares no organization column — `sys_metadata`, `sys_metadata_audit`, `sys_metadata_commit` and `sys_metadata_history` (ADR-0131 D6/D7)
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: registered sys-metadata-organization-column-retired, sys-metadata-audit-organization-column-retired, sys-metadata-commit-organization-column-retired, sys-metadata-history-organization-column-retired -->
  
  **BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes.
  
  Metadata is the environment's (ADR-0131 D6). The four tables of the metadata family no longer declare `organization_id`, and each sets `systemFields.tenant: false`, so the engine injects none back. The engine refuses an undeclared field, so nothing reads or writes the column any more.
  
  FROM → TO:
  
  - An authored filter, list-view column, report grouping, formula or seed key naming `organization_id` on one of the four tables → delete it; no organization owns a row. The field resolver answers it as an unknown field.
  - `new SysMetadataRepository({ engine, organizationId, orgLabel })` → `new SysMetadataRepository({ engine, orgLabel })`. The `organizationId` option is gone: every repository reads and writes the environment's rows.
  - `DatabaseLoader`'s `organizationId` option (and so `MetadataManager.setDatabaseDriver` / `setDataEngine`'s `organizationId` argument) → accepted and ignored, like `environmentId`: no write stamps it and no read filters on it. Drop the argument.
  - `@objectstack/spec`: the published `ApiError.code` / `ErrorCode` enum widens by `LEGACY_ORGANIZATION_ROWS_UNREADABLE`, registered under `@objectstack/metadata-core`.
  - `isLegacyOrganizationRow(row)` (`@objectstack/metadata-core`) → `readLegacyOrganizationRows(driver, table?)`. The row-value test read a key the engine no longer returns, so it is removed. The new read answers from the physical column, through the table's driver (`engine.getDriverForObject`): id → organization, empty on a migrated or fresh database. A seam that cannot answer is refused (`LegacyOrganizationRowsUnreadable`), never read as "none".
  - An existing database → run `os migrate organization-ownership` (review its plan), then `os migrate organization-ownership --apply --plan-file FILE` with that plan file. The ceremony promotes or reports the legacy organization rows, then drops the physical column. Until it has run, the v18 runtime refuses to start against the database.
  
  The indexes are re-keyed with the column:
  
  - The overlay unique key is (`type`, `name`, `package_id`, `bundle_member`): the declared `idx_sys_metadata_overlay_active` and the runtime partial indexes of the same names. Removing the organization TIGHTENS uniqueness. On a database the ceremony has not cleared, two legacy organizations' rows, or an organization's row and the environment's, can share a key. There the runtime index migration keeps the previous index and names the duplicates (ADR-0120 D4); it never drops a row. `os migrate duplicates` and the boot report group by the same key.
  - `sys_metadata_history` is unique on (`event_seq`) and on (`type`, `name`, `version`). Its other indexes, and those of `sys_metadata_audit` and `sys_metadata_commit`, lose their organization prefix.
  - `idx_sys_metadata_org_type` is gone.
  
  What else changes:
  
  - The boot line `[metadata_org_scoped_unserved]` is gone with the column it read. A database still holding legacy organization rows is refused at boot instead, until the ceremony has run.
  - The package uninstall no longer removes a legacy organization's row of the package's name: no row carries an organization.
  - Who reads the family through the generic data door (`/data/sys_metadata_*`), before → after:
    - `sys_metadata_audit`, `sys_metadata_history`, `sys_metadata_commit`, **under a wall** (`isolated` / `group`): before, the tenant wall filtered each caller to its own organization's rows, and an `organization_admin` read its organization's. With the column gone the wall has nothing to filter on, so without a gate that admin would read every organization's trail, history bodies and commit ranges. After: each requires `studio.access` (`requiredPermissions`, the #22107 precedent). The capability is platform-scoped, so an `organization_admin` holding it by role does not exist, and that admin is refused.
    - The same three, **under `single`**: before, any caller whose grant covered the table (a read wildcard) read it. After: `studio.access` is required there too. A Studio author (the platform admin among them) reads as before; a plain member is refused.
    - Every `/meta` door serving these rows admits `studio.access`: `/meta/:type/:name/history`, `/audit` and `/diff` admit `studio.access` or `manage_metadata`, and `/packages/:id/commits` admits `studio.access` alone; `setup.access` alone is refused at all four. `requiredPermissions` is an AND-gate and cannot name an any-of set, and `setup.access` is held by organization admins, so it could not be the gate. A caller holding only `manage_metadata` therefore still reads the history and audit rows through `/meta`, but not the commit rows, and none of them through the data door.
    - `sys_metadata` stays ungated, before and after: its rows are what `/meta` already serves to every organization.
  - On a database the ceremony has not migrated (which `os serve` refuses, but every `os migrate` boot opens, the ceremony's own among them), the legacy organization rows are still told apart, off the physical column:
    - every read the metadata protocol makes of the family goes through one seam that leaves them out. That covers boot hydration; the `/meta` list, by-name, layered and draft-preview reads; the item lock (`_lock`) the reads report and the save and delete gates enforce; the package-less write and read address; and the package, commit, audit, history and diff reads. Two reads keep them on purpose and read the column themselves: `os migrate meta --stored` reports such a row, and the commit revert refuses a legacy commit by name. The authored hook and action binders leave them out too;
    - the metadata repository's write never resolves to one: before, a save of an address that only a legacy organization's row held rewrote that row in place (measured on the ceremony's template promotion). Now the write targets the environment's row, and with none it creates one, which the re-keyed unique index refuses beside the organization's row until the ceremony settles it;
    - `os migrate meta --stored` reports such a row `skipped` and never re-saves it;
    - `os migrate security-catalog-overlays` neither lists nor deletes it;
    - a commit recorded in a legacy organization's layer is still refused by the revert;
    - the runtime-datasource reads, the packaged permission-set overlay reading, the kernel:ready security-catalog echo, the stored flow-credential move and a `DatabaseLoader` (engine- or driver-backed) leave them out.
  - `SqlDriver.listPhysicalColumns(object, options?)` (new, read-only): a table's physical column names, from the catalog, joining `options.transaction`. `TursoDriver`'s remote face answers it from the remote catalog. Every boot asks whether the family still carries the retired column, and it asks this way, not through `execute()`. So `os migrate plan` keeps its "a plan writes nothing" line on a migrated or fresh database. The legacy rows themselves are read with a raw statement only where the column exists.
  - `GET /forms/:slug` and `POST /forms/:slug/submit` no longer read the Default Organization's legacy layer. Every metadata read is now environment → code. The doors judge each candidate against the environment's view list, which holds one item per package of a view name. So a withdrawal in one package still closes that name's form in every package. On a deployment with no organization this closes more than before, which is the fail-closed direction. A withdrawal saved only at the organization layer is carried onto the environment by the ceremony's `metadata-promotion` step, which the runtime requires before it starts.
  - The protocol's `getMetaItems` drops its undocumented `legacyFormOrganizationId` request key. It was never in the spec's `GetMetaItemsRequest`, and only those doors passed it. A caller that still passes it now gets the environment's list.
- c2bb302: fix(cli): `os migrate organization-ownership` reads its SQL dialect once, through the driver resolver it shares with metadata-core, and refuses an unresolved dialect before any statement, naming the driver, with no SQLite default left
  
  Clause-②: yes (widening)
  
  **Who this is for.** An operator who runs the organization-ownership ceremony (plan or `--apply`) on a PostgreSQL or MySQL database whose driver's knex `config.client` is a client CLASS (knex's bring-your-own-dialect hatch) or a client string the ceremony does not recognise.
  
  **FROM.** Both arms took the dialect from `String(config.client)` alone, with a reader of their own.
  
  - Such a run was refused (`driver-unsupported`, exit 1) by the plan step, which runs first. A client class was stringified, so the refusal printed the class's source text in place of the driver's name.
  - The apply step and its template lookup each carried a `'sqlite'` default for an unresolved dialect. Neither was reachable, only because the plan step had already refused.
  
  **TO.** The dialect is resolved once, from the stack's driver, before either arm runs a statement. The resolver is the one metadata-core's legacy-row reader uses: the driver's `dialectName` first, then a recognised `config.client` string.
  
  - Refused: a client class with no recognised `dialectName`, an unrecognised client string, `dialectName: 'unknown'` (what `SqlDriver` answers for either), and a driver with no dialect at all. Each gets `driver-unsupported`, exit 1, with no statement run and no plan file written. The refusal names the driver: its name, its `dialectName`, and its client string or client class name.
  - No `'sqlite'` default remains. The plan and the apply take the resolved dialect and never re-derive it.
  - The plan file's `client` field records the client only when it is a string.
  
  Measured on each in-repo SQL driver: `SqlDriver` on better-sqlite3, pg and mysql2, and `TursoDriver`, resolve to the dialect they did before.
  
  **metadata-core.** `dialectOfDriver(driver)` is exported. It is the one resolver behind `readLegacyOrganizationRows`, and answers:
  
  - `'sqlite' | 'postgres' | 'mysql'`;
  - `'none'` for a driver that is not a SQL driver;
  - `'unresolved'` otherwise.
  
  A `dialectName` string is the whole answer, recognised or not. A `config.client` is read only when there is no `dialectName`, and only as a string.
- d050a8f: fix(spec,objectql)!: an installed or stored page carrying a declaration spec 18 retires converts at load instead of stopping the kernel build — `isDefault` off a bound record page is deleted and `template: 'full-width'` re-spelled `default`, each with a named notice; the authoring, save and publish doors keep refusing
  
  Clause-②: yes (widening)
  
  **What changes.** Protocol 18 refused `isDefault: true` on a page that is not a record page bound to an object, and closed the page `template` set (retiring `full-width`), at every door — the page parse (`definePage`, `defineStack`, so `os validate` / `os build`, and the metadata save door) and the kernel's package registration (`SchemaRegistry.installPackage` / `registerItem`, `MisplacedDefaultPageError`). The registration refusal also fired when a kernel was built from a package that was installed BEFORE the retirement: every hosted environment holding such a package failed its kernel build, with no remedy short of upgrading the package in each one. Data at rest now converts, and only data at rest:
  
  | Door | Before | Now |
  | :--- | :--- | :--- |
  | `definePage` / `defineStack` (`os validate`, `os build`), the metadata save door, package publish | refused at `isDefault` / `template` | **unchanged** — refused with the same sentence |
  | a `sys_metadata` page row read back | served with `_diagnostics.valid: false` | converted on read: the flag deleted, `full-width` → `default`, `OS_METADATA_CONVERTED` notice |
  | a compiled artifact inside the window its `engines.protocol` opens | the artifact door refused the artifact | converted before the strict parse, as every retired entry is |
  | a package body registered through `manifest.register` / `ObjectQL.registerApp` that declares `engines.protocol` (an installed package, a marketplace install) | `MisplacedDefaultPageError`, kernel build stopped | converted before anything registers, with one `warn` per (package, conversion) naming the conversion id and the first site; the body is left unchanged on disk |
  | the same body with NO declared range (a manifest a plugin builds in code), or declaring a floor newer than every retirement | refused | **unchanged** — refused |
  
  **The two ADR-0087 D2 entries**, both `retiredFromLoadPath` from the day they land (the authoring funnel never replays them):
  
  - `page-is-default-off-record-page-removed` (`page.isDefault`): deletes `isDefault: true` from exactly the pages `misplacedDefaultPageRefusal` refuses — a `home`, `app`, `utility` or `list` page, or a record page with no `object`. Lossless: nothing read the flag there (an app opens on its first navigation item). A default record page bound to an object keeps its flag.
  - `page-template-full-width-to-default` (`page.template`): `'full-width'` → `'default'`. Lossless: the console drew both names with one template component. An unregistered template name (`centered`, `two-column`) and a region the template does not place have no lossless rewrite and are NOT converted — they stay with the parse, and the D3 entries `page-is-default-off-record-page-refused` / `page-template-closed-region-unplaced-refused` name the hand edits.
  
  **`@objectstack/objectql`** — `ObjectQL.registerApp` (and the `manifest` service, for an artifact carrying `packages[]`) replays the versioned forward conversion (`applyArtifactForwardConversions`, `@objectstack/metadata-core`) over a package body that declares its protocol range, before `installPackage`; the converted copy is what the package record and every registered item carry. Public: `ObjectQL.convertPackageBodyForward(body)`.
  
  **`@objectstack/metadata-core`** — `applyArtifactForwardConversions` reads the declared range off a FLAT package body (the manifest half beside its collections, no `manifest` key) when the definition carries no `manifest`; a definition with a `manifest` object is read there, as before.
  
  Migration: none for authors — the authoring doors refuse exactly what they refused. An installed package converts again at every registration until it is rebuilt (`os build`) and re-published with tooling from a release that ships the retirement; the boot log's warn names the conversion and the site.
  
  <!-- adr-0087: registered page-is-default-off-record-page-removed, page-template-full-width-to-default -->
- 2ec6827: feat(metadata-protocol): the draft save records `draftChanges` — which surface, actor and instant last changed each key path of a pending draft — and the strict draft read serves it
  
  Clause-②: yes (widening)
  
  - **Recorded by the draft save.** `saveMetaItem({ mode: 'draft', surface })` compares the body it writes with the body it replaces, inside the write's own transaction: the draft row, else (the draft's first save) the active row its publish would replace, else nothing, which records `[]`, the whole body. A path is the object keys from the body root to the deepest changed key; an array is one leaf, with no index. Each changed path is stamped `{ by: surface ?? 'api', actor, at }`, where `actor` is the value the save's history event carries (or `null`) and `at` is the write's instant as `toISOString()`.
  - **Kept until publish or discard.** No two entries share a path: a save replaces every entry at or under each path it changes, so the longest prefix answers for a key. A save that changes no key path leaves the entries as they were. Publish and discard delete the draft row, and the entries with it, so the next draft starts clean. A `migrate-stored` rewrite and an active save record nothing.
  - **Served on the strict draft read only.** `getMetaItem({ state: 'draft' })` answering a stored draft row carries `draftChanges` beside `item`. It is absent on the active read, the cached branch, the `?preview=draft` read, and a draft row whose saves recorded none (one saved before this release) — never `[]`.
  - **Stored on the row.** `sys_metadata` gains a nullable `draft_changes` column (`@objectstack/metadata-core`'s `SysMetadataObject`), never inside the stored body. Schema sync adds it to an existing table on boot with no manual step (measured on SQLite and the memory driver).
  - **Translated labels.** `@objectstack/platform-objects`' translation bundles carry the new column's label and help text in every shipped locale.
  - **An unknown `surface` is refused.** In-process, a value outside `copilot | studio | api` is refused `400 INVALID_REQUEST` before anything is written.

### Patch Changes

- 78b1a63: Clause-②: no
  
  The `source` describe on `MetadataEventSchema` no longer lists `"fs"`, `"studio"`, `"rest"`, `"ai"` and
  `"git-import"` as origin labels: of those, only `fs` is written by any producer (`FileSystemRepository`),
  and no write path stamps an authoring surface there. It now says what the field is: the write path that
  produced the event, an open label its writer stamps rather than an enum to pick from or match against, for
  example `protocol.saveMetaItem`, `protocol.publishMetaItem`, `migrate-stored`, `sys-metadata-repo`
  (`SysMetadataRepository`'s default) or `fs`. The field stays `z.string()`, so no key, type, export or
  accepted value changes, and every repository emits exactly what it emitted before.
- 56c8844: `@objectstack/spec/ui` now exports the rule that decides which forms a `view` body opens to anonymous intake, so a console reads "published" from the same rule the server's anonymous form doors serve
  
  Clause-②: yes (widening)
  
  - **New on `@objectstack/spec/ui`:** `publicFormSlug`, `anonymousFormIntakeSlug`, `anonymousFormIntakeCandidates`, `anonymousFormIntakeSlugs` and the `AnonymousFormIntakeCandidate` type. They lived only in `@objectstack/metadata-core`, which a browser console should not depend on. They are pure functions with no imports, beside the `SharingConfigSchema` they read.
  - **What they decide is unchanged.** A form is open when its `sharing` has `enabled === true`, `allowAnonymous === true` and a non-empty `publicLink`. The scan covers the same three shapes in the same order: the nested `form`, every `formViews` entry, then the `config` of a `viewKind: 'form'` item.
  - **`@objectstack/metadata-core` re-exports the same functions** from `@objectstack/spec/ui`. They are the spec's own bindings, not wrappers or copies, so there is still one copy of the rule. Its exports, names and types are unchanged, and `@objectstack/rest` and `@objectstack/metadata-protocol` keep importing from it. Its built output now loads `@objectstack/spec/ui` to get them.
  - **Not covered by the new export:** whether another metadata layer withdraws a form (`anonymousFormIntakeWithdrawnIn`), and whether the deployment's tenancy posture lets the form take an anonymous submission (`anonymousFormIntakeUnavailability`). These two read server state and stay in `@objectstack/metadata-core`. `anonymousFormObjectName`, which names the object a form submits into, stays there beside them; it is a pure read of the form and the view, not of server state. A form the new functions call open can still be withheld by a withdrawal in another layer or by the posture.
- 3d886ee: A field can declare cell formatting rules: `conditionalFormatting: [{ condition, style }]`, the rule a list view already declares for its rows
  
  Clause-②: yes (widening)
  
  - **`FieldSchema.conditionalFormatting`** (optional) is an ordered list of `{ condition, style }` rules. The first rule whose CEL `condition` holds applies its CSS `style` map to that field's cell, wherever the field renders. A list view's row rules still style the row, and both may apply to one record. Example: `amount: Field.currency({ conditionalFormatting: [{ condition: P\`value < 0\`, style: { color: '#b91c1c' } }] })`.
  - **One rule element, no second style vocabulary.** The `{ condition, style }` element moved out of `ListViewSchema` into its own spec module, and both `ListViewSchema.conditionalFormatting` and `FieldSchema.conditionalFormatting` mount it. The list view accepts exactly what it accepted before. Its refusal of an unknown rule key now reads the same on both members: for a `color` written beside `style`, it says to put the colour in `style` first, then points a list view at `rowColor`.
  - **The scope is `value` and `record`.** `value` is this field's value on the record and `record` is the row. `@objectstack/lint` judges each condition at `objectstack build`, `objectstack validate` and the object save: it must parse, read fields as `record.<field>`, name declared fields, and read no other root (`previous`, `parent` and the user roots are refused, naming the field and the rule).
  - **For presentation only.** Use it for rules that carry no meaning of their own, such as an amount below zero in red or stock under its safety level in amber. A deadline's overdue state stays a declaration (`dueLike` with `settledWhen`).
  - **Display only.** Nothing on the write path reads the key, and every metadata that parsed before parses unchanged. Field-level security drops a rule whose condition reads a field the caller cannot read, keeping the other rules in order (`@objectstack/metadata-core`). The SQL driver classifies the key as presentation, so it never reaches column DDL (`@objectstack/driver-sql`).
  - **Who reads it.** objectui's cell renderers read the rules in a follow-up release, once this spec version is published. Until then a rule is validated when it is authored and styles no cell.
- 9af0005: The shared build validator (`@objectstack/lint`'s expression rule over `@objectstack/formula`) judges `record.<block>.<leaf>` against an object's declared read attachments (`ObjectSchema.attachedOnRead`)
  
  - **`@objectstack/lint`.** The field index the expression rule builds now adds each block an object declares under `attachedOnRead` to the names `record.<x>` resolves to, and hands the shared validator the block's declared leaves. A predicate such as `record.viewer.can_act` on an object that declares the `viewer` block is accepted where it was refused as an unknown field.
  - **`@objectstack/formula`.** `ExprSchemaHint` gains an optional `attachedOnRead` (block name → declared leaf keys). When a `record.` or `previous.` reference names a declared block, its next segment must be a leaf the block declares. Anything else is refused with the existing `unknown-field` code: `field` is the dotted path as written (`viewer.can_actt`), `suggestion` the nearest declared leaf (`viewer.can_act`), and the new optional `block` and `leaves` params carry the leaves the block declares, which the message names. No new refusal code.
  - **`@objectstack/metadata-core`.** The ADR-0106 field-level-security masker classifies the new top-level key as passed through unchanged (`OBJECT_REFERENCE_POSITIONS.attachedOnRead`): a block name and its leaf keys never name a field, so no caller's served object definition loses or gains anything.
  - **Unchanged.** An object that declares no block keeps every verdict it had, and a second segment off any other field is not judged. Index access, a method call on a block and a third segment stay unjudged.
- e5687cb: An `email` field can declare that it identifies a correspondent for inbound mail: `mailAssociation`
  
  Clause-②: yes (widening)
  
  - **`mailAssociation: boolean`** (optional, no default) on a field definition. TRUE marks this email field as identifying a message correspondent: when a mailbox service ingests a message, it associates the message with every record of the object whose value in this field equals one of the message's participant addresses (From, Sender, Reply-To, To and Cc, plus those of a forwarded message it carries; ASCII case-insensitive; the receiving mailbox's own addresses excluded; only within the mailbox's organization). A message no record matches waits in the mailbox's unassociated pool. Absent or FALSE: the field takes no part in matching.
  - **The platform learns which fields carry a correspondent's address, never what a contact is.** Every object that flags a field is treated alike; no app code and no resolver service is involved.
  - **The door that judges it.** `FieldSchema` refuses the key on any type other than `email`, naming the field's type and the fix (change the type to `email`, or drop the key). Every metadata that parsed before parses unchanged.
  - **Who reads it.** Nothing yet: the mailbox service's ingest is the reader, and it ships separately. Until then `objectstack validate` and `objectstack lint` warn an author who sets it (`liveness-planned-property`) that no mailbox service reads it yet.
  - **Where to author it.** The field designer offers it on email fields as "Match Inbound Mail".
  - **`@objectstack/driver-sql`.** `FIELD_KEY_STORAGE_CLASS` classifies `mailAssociation` as `presentation`: the mailbox service reads it, never `createColumn`, so a declaration on a builtin column name is not reported as discarded storage. No behaviour changes.
  - **`@objectstack/metadata-core`.** `FIELD_REFERENCE_POSITIONS` classifies `mailAssociation` as `keep`: the FLS scrub of a served object definition passes the flag through unchanged, because it names no field.
  - **`@objectstack/platform-objects`.** The field designer's new row carries its label and help text in the metadata-form translation bundles for en, zh-CN, ja-JP and es-ES.
- 5677add: fix(metadata-protocol): two locales of one email template saved through the metadata door both survive a restart — an overlay row is keyed by its bundle member (#22877)
  
  Clause-②: no
  
  **What an administrator sees.** Saving the same email template in two languages through the metadata door (`PUT /api/v1/meta/email_template/:name`, the Studio editor's save) keeps both. Before, the store kept one overlay row per template name, so the second language's save replaced the first language's row: both read back until the next restart, and then the first language mailed the package wording again. Each language now keeps its own wording across restarts, and each send in that language uses it.
  
  **What changed in the store.**
  
  - `sys_metadata` gains one nullable column, `bundle_member`. It holds the member of a metadata type whose identity is a pair — today `email_template`, identified by `(name, locale)`. NULL is the canonical member (`en-US`, the locale a send falls back to). Every other row stays NULL, so rows of every other type, and an `en-US` template row, are byte-identical to before.
  - The value is taken from the saved body's `locale`; it is never authored. A body that declares no `locale` is the `en-US` member.
  - The overlay uniqueness index becomes `(type, name, organization_id, COALESCE(package_id, ''), COALESCE(bundle_member, ''))`, for active rows and for draft rows, and the declared index in `metadata-core` carries the column too. A second row for the same template, language, package and state is refused by the index.
  
  **What a read or a door addresses.** A save addresses the language its body names. A read, delete, publish, history or revert by name that names no language addresses the `en-US` member: `GET /meta/email_template/:name` serves the `en-US` wording (the stored one when it was customized, else the package's), where before it served whichever row the name had. The layered list and the send path serve every language as before. A non-`en-US` language's own customization is reached through the list, and is replaced by a save that names its `locale`; a by-name reset (`DELETE`) removes the `en-US` customization only. The lineage counter stays one per template name, so a version number names one saved snapshot, and a revert by name restores only a version of the `en-US` member. Resetting, publishing or reading a non-`en-US` language by name needs the by-name member selector, which arrives with stage 2 of #22877; until then those doors address the `en-US` member.
  
  **What happens on the first boot after upgrading.** Nothing to configure.
  
  1. The schema sync adds the `bundle_member` column.
  2. Boot hydration gives every `email_template` row stored before the column existed the member its body declares, so a row an earlier save left holding a second language's wording becomes that language's row, not the `en-US` one. Rows of every other type are not read or written.
  3. The first metadata write rebuilds the overlay index with the new key, through the existing probe-then-replace order. Adding a key part only relaxes uniqueness, so no rows a store already holds can block the rebuild; a store that was already blocked is reported as before, with the duplicate-listing query and `os migrate duplicates`.
  
  **On a database without partial indexes (MySQL).** The rebuild above is refused there, as before, and reported in the server log at the first metadata write. A store that booted an earlier version keeps the four-column declared index under `idx_sys_metadata_overlay_active`, because the schema sync skips an index whose name already exists. That index has never constrained an environment-wide overlay row: those rows store no organization, and a UNIQUE key does not collide NULLs. So two languages of one template coexist there too, and no save is refused. `os migrate plan` lists the declaration change on that index as a destructive `recreate_index`. To bring the index to the five-column declaration, run `os migrate apply --allow-destructive`. A fresh store gets the five-column declaration.
  
  `os migrate duplicates` boots read-only and adds no column. Run against a store this version has not booted yet, it lists the two overlay indexes with every row read as the empty member — the value the column will hold — so a duplicate that will block the rebuild is still reported, and the entry's `duplicateSql` is the member-less statement that ran there.
- c5b43b6: fix(metadata-core, runtime): a multi-package artifact built before a retirement boots at `os dev -a` and `os start`. The ADR-0087 forward conversion walks every `packages[].manifest` body, and the runtime's artifact load converts the bundle once, before any reader sees it
  
  Clause-②: no
  
  **What an operator saw.** A multi-package release artifact (ADR-0130 D4: `os build` of a `composeStacks(…, { manifest: 'preserve' })` project) carries its collections in `packages[i].manifest`. Take such an artifact built before a retirement, for example with a dashboard still spelled `refreshInterval`. `os dev -a dist/objectstack.json` and `os start` exited at boot with "`packages[1]` is not a package entry (ADR-0130 D4): manifest.dashboards.0.refreshInterval: `dashboard.refreshInterval` was renamed to `refreshIntervalSeconds`…". The metadata plugin's artifact door refused the same artifact at its strict parse. The ADR-0087 conversion converted that dashboard when it sat in the artifact's own `dashboards`, but it never read a package body, and the runtime read the bundle raw before any conversion ran.
  
  **What an operator sees now.** The same artifact boots at `os dev -a` and at `os start`. Each body's items are served converted (`refreshIntervalSeconds: 300`, valid), each owned by its own package. The boot log names each conversion once, with the body it found it in: `[MetadataPlugin] artifact '…' … converted 2 site(s) forward via ADR-0087 conversion 'dashboard-refresh-interval-to-refresh-interval-seconds' (first at packages[0].manifest.dashboards[0].refreshIntervalSeconds) …`. The artifact file itself is unchanged, so it converts again on every boot until it is rebuilt with `os build`. A body built after the retirement converts nothing and logs nothing. An artifact authored past every retirement is still refused with the tombstone inside its body.
  
  - **`@objectstack/metadata-core`.** `applyArtifactForwardConversions` runs the same conversion over each package body as over the artifact's own collections. It uses the same registry and the same window, decided once from the artifact's own `engines.protocol`; a body's own `engines.protocol` is not read. A notice from a body is located from the artifact root (`packages[1].manifest.…`).
  - **`@objectstack/runtime`.** `loadArtifactBundle` converts the loaded artifact once, before it merges the runtime module and before the stack, `AppPlugin` or the `manifest` service read it. The database resolver reads the artifact file itself, and it runs the same conversion on what it reads. So a multi-package artifact that declares its default datasource in a package body opens that database, not the unified default.
  
  **Unchanged.** An artifact without `packages[]` converts exactly as before, with the same notices, paths and messages, and it is served the same way.
- 8c10776: fix(metadata-protocol): a stored-metadata migration records the user who ran it, or nobody, never a label
  
  Clause-②: no
  
  - **What was wrong.** The stored-metadata migration pass (`os migrate meta --stored`, `POST /api/v1/meta/_migrate-stored`, the runtime dispatcher's `POST /metadata/_migrate-stored`, and `migrateStoredMetadata()` called in process) recorded a label as the writer of every row it rewrote: `'os migrate meta --stored'`, `'<user id> (POST /api/v1/meta/_migrate-stored)'`, `'POST /api/v1/meta/_migrate-stored'`, or `'migrate-stored'`. The writer lands in `sys_metadata_history.recorded_by` and in the row's `updated_by`. Both columns are references to `sys_user`, so the label pointed at no user. Nothing refused it, because metadata writes run as the system.
  - **What it does now.** The pass records the id of the user who ran it, exactly as every other metadata write does. A REST or runtime call by a signed-in user with `manage_metadata` records that user's id. A run with no user records `null`, which means "system-initiated". That covers the CLI, which opens the database directly with no session, and a system caller. The pass still names itself on each history row's `source` (`migrate-stored`), as it did before.
  - **What an operator sees.** History rows and rewritten rows written by a migration from this release on name the person who ran it, or nobody. They never name a command or a route. Rows a migration rewrote before this release keep the label they were given.
  - **Contract text.** `MetadataItem.authoredBy`'s description now gives the same rule as `PutOptions.actor`: the acting user's id, or `null` for a system-initiated write, never a label such as `"system"` or `"cli"`. The schema accepts the same values as before.
- 105902f: feat(spec)!: retire the view form's `visibleOn` and the page component's `visibility` as keys; their ADR-0089 renames leave the load path
  
  Clause-②: yes (narrowing)
  
  **BREAKING (authoring):** ADR-0089 made `visibleWhen` the one conditional-visibility key, and through 17 the old spellings were declared `[DEPRECATED]` keys that the parse folded onto `visibleWhen` without a word: `visibleOn` on a form view's fields and sections, and `visibility` on a page component. At 18 all three positions carry a `retiredKey()` tombstone naming `visibleWhen`, the parse-time fold is gone, and the two ADR-0087 D2 conversions `view-visibleOn-to-visibleWhen` and `page-component-visibility-to-visibleWhen` (protocol 15) are retired from the load path (`retiredAfter: '17.7.0'`).
  
  ## FROM → TO
  
  | you wrote (17.7 and earlier) | write instead |
  | --- | --- |
  | `visibleOn: "…"` on a form field (`view.form.sections[].fields[]`) | `visibleWhen: "…"` |
  | `visibleOn: "…"` on a form section (`view.form.sections[]`) | `visibleWhen: "…"` |
  | `visibility: "…"` on a page component (`page.components[]`, slots and nested containers included) | `visibleWhen: "…"` |
  
  **The one-line fix:** rename the key to `visibleWhen`; the CEL predicate is unchanged. Where a node wrote both keys, `visibleWhen` was the one in effect: delete the old key.
  
  **What an author who still writes it sees.** `tsc` fails at a typed authoring site (`FormFieldInput`, `FormSection`, `PageComponent` type the key as retired), and the parse refuses it by name at its own path — `defineStack` throws `STACK_SCHEMA_INVALID` (422), `os validate` / `os build` print the issue, and the metadata save door answers 422:
  
  > `page.components[].visibility` was removed in @objectstack/spec 18 (ADR-0089 D2) — it was the page component's deprecated spelling of the conditional-visibility predicate, which the parse folded into `visibleWhen` until this release. Use `visibleWhen`. Rename the key; the value (a CEL predicate) is unchanged. Where a component writes both, `visibleWhen` is the one that was in effect: delete `visibility`.
  
  **No tool makes the rename.** Both conversions belong to protocol 15, below the migration floor, so `os migrate meta --from 17` applies no edit for either key and `--write` writes none: it prints each written key among the refusals the migrated stack still has, and lists the D3 entry `ui-visibility-alias-keys-retired` as the hand edit.
  
  **Stored metadata needs no edit.** Stored-row rehydration and the artifact-ingestion door inside its window still replay both conversions, so a `sys_metadata` view or page row written with the old key keeps loading with `visibleWhen`. A script that saves a view or page through the metadata API with the old key is refused and needs the same rename.
  
  ## The retirement kit
  
  - **Tombstones** on `FormFieldSchema`, `FormSectionSchema` and `PageComponentSchema`; `RETIRED_KEYS_BY_MAJOR[18]`: `ui/FormField:visibleOn`, `ui/FormSection:visibleOn`, `ui/PageComponent:visibility`; the authorable-surface rows read `[RETIRED]`.
  - **The fold is gone.** The three shapes are plain closed objects again (no `.transform` pipe): a section's group-reference rule no longer lists `visibleOn` (the tombstone answers it first), and a slotted page node's `type` refusal now arrives at its own path instead of nested in an `invalid_union`.
  - **The D3 entry `ui-visibility-alias-keys-retired`**, one for both keys.
  - **No deprecation window**, per the project's startup-stage posture.
  
  `@objectstack/lint`: the visibility-predicate rules (`visibility-root-mislayered`, `visibility-bare-identifier`, `visibility-predicate-syntax`) and the predicate-path rules read `visibleWhen` only. `os validate`, `os build`, `os verify`, `defineStack` and the metadata save door parse first and refuse either retired key by name, so a body they judge cannot carry one. `os lint` is the one door that hands these rules an unparsed stack: there a predicate written under a retired key is not judged, by design — the parsing doors refuse the key itself, and `os lint` reports no refused shape.
  
  `@objectstack/metadata-core`: `detectUnboundFormViewPredicateRoots` reads `visibleWhen` only. Its caller scans an artifact after `applyArtifactForwardConversions`, which renames a legacy `visibleOn` first.
  
  Not part of it: `normalizeVisibleWhen` and `VISIBILITY_ALIAS_KEYS` stay exported (no schema here calls them any more); objectui's renderer reads of the old keys leave on the objectui side.
  
  ⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is published, so this is breaking for consumers no telemetry was consulted for.
  
  <!-- adr-0087: registered ui-visibility-alias-keys-retired -->
- 8776119: **Shipped in 18.0.0-next.2**, whose CHANGELOG missed this entry (#23818); listed here one prerelease late.
  
  feat(spec): `referenceDeletedWhen` beside `referenceVia` marks a polymorphic pointer's target as platform-deleted
  
  Clause-②: yes
  
  `FieldSchema` gains one optional key beside `referenceVia`: `referenceDeletedWhen: { field, value }`. On rows where the sibling `select` field `field` holds the option `value`, the record the pointer names was deleted by the platform's own assertion, and a renderer draws a tombstone from that option's own label instead of a link. Example: `record_id: Field.text({ referenceVia: 'object_name', referenceDeletedWhen: { field: 'cancel_reason', value: 'record_deleted' } })`.
  
  Any other shape is refused at parse, naming the field and the option:
  
  - the key on a field that declares no `referenceVia` (`FieldSchema`), or an unknown key inside it;
  - a `field` that is the declaring field itself, is not declared on the object, is not a `select`, is a `multiple: true` select, or declares no inline `options` (a `picklist`-backed select); a `value` that is not one of the sibling's option values (`ObjectSchema`, at every door: `ObjectSchema.create()`, `defineStack`, raw `.parse()` and the metadata save door).
  
  Nothing that parsed before is refused: the key is new. Its liveness row is `planned` until the renderer that reads it ships.
  
  The other packages classify the new key where every field key is classified:
  
  - **`@objectstack/metadata-core`.** `FIELD_REFERENCE_POSITIONS` deletes a served field's `referenceDeletedWhen` when its `field` names a field the caller cannot read (field-level security); `value` is an option value and never a field name.
  - **`@objectstack/driver-sql`.** `FIELD_KEY_STORAGE_CLASS` classifies it `presentation`: no DDL reads it.
  - **`@objectstack/platform-objects`.** The field form's new `referenceDeletedWhen` row carries its labels and help text in zh-CN, ja-JP and es-ES.
- 30ce56e: Clause-②: no
  
  Setup pages describe their records in plain admin sentences. Business Units now reads "Your
  company structure — divisions, departments, regions and offices — used to scope data and
  reports.", Notification Events "Every notification the platform sent, one row per event.",
  Notification Preferences "Which topics and channels each user receives; admins set the
  defaults.", Notification Templates "The subject and body each notification topic sends, per
  channel and language." and HTTP Deliveries "Outgoing HTTP calls made by webhooks and flows, one
  row per call, with its delivery status." Field help on Users, Organizations, Invitations and SSO
  Providers, and the metadata-storage and notification-delivery object descriptions, no longer
  carry design-record numbers; those references stay in the code comments. The zh-CN, ja-JP and
  es-ES translations follow. Wording only: no field, permission or behaviour changes.
- df2c551: fix(metadata-core): the package installs on npm 10 again, and into projects that use vitest 5, because it no longer declares an optional `vitest` peer
  
  Clause-②: no
  
  On npm 10, the npm that Node 22 bundles, `npm install @objectstack/metadata-core` exited 1 with `Cannot read properties of null (reading 'edgesOut')`. So did installing a package that depends on it, such as `@objectstack/objectql`. The cause was this package's optional peer `vitest: ^4.0.0`. It led npm 10 to vitest 4.1.12, whose own peer declarations contradict each other, and npm 10's resolver crashes on that. The same peer also made npm refuse (`ERESOLVE`) to install the package into a project that already uses vitest 5.
  
  The package's main entry never imports `vitest`. Only the test-only `@objectstack/metadata-core/testing` entry does, so the peer is removed. Nothing the package exports changes.
  
  If you import `@objectstack/metadata-core/testing`, list `vitest` in your own `devDependencies`, as that entry's documentation already says. This package runs that suite on vitest 4. In a pnpm workspace with hoisting turned off (`hoist=false`), that entry can no longer find `vitest` from inside a workspace package. Declare the peer back in your `pnpm-workspace.yaml`:
  
  ```yaml
  packageExtensions:
    '@objectstack/metadata-core':
      peerDependencies:
        vitest: '*'
  ```
  
  `@objectstack/plugin-auth` still fails the same way on npm 10, because its `better-auth` dependency declares its own optional `vitest` peer. Install it with npm 11, or add `"overrides": { "vitest": "~4.0.0" }` to your project's `package.json`.
- adad73f: feat(spec)!: a select option declares its lifecycle `kind` (`open` / `won` / `lost`), and every option of an object's `stageField` must declare it
  
  Clause-②: yes (narrowing)
  
  `SelectOptionSchema` gains one optional key, `kind`, a closed vocabulary of three lifecycle categories that means the same on every object: `open` (a step on the way), `won` (the successful end: a deal's Closed Won, a lead's Converted, a task's Done, a case's Resolved) and `lost` (the unsuccessful end: Closed Lost, Unqualified, Cancelled). It is the spelling `record:path` `stages[].terminal` already takes, so the data layer and the page say one thing one way. Example: `{ label: 'Closed Lost', value: 'closed_lost', kind: 'lost' }`. The exported type `SelectOptionKind` names the three values.
  
  - On a plain single-value `select` / `radio` the key is optional, and an absent kind reads as `open`. Nothing is written in at parse: an option without `kind` parses without it.
  - On any other field's options (`multiselect`, `checkboxes`, `tags`, a `multiple: true` select, a lookup's static options) `FieldSchema` refuses it at `options.<i>.kind`: a lifecycle is one value per record.
  - A shared `picklist`'s options accept it (the same option shape). A form view's option list does not (`FormSelectOptionSchema`): it is refused there as an unknown key whose message points at the object field's own option.
  
  **BREAKING (authoring):** when an object's `stageField` names a field, every option of that field must declare `kind`. `ObjectSchema` refuses the object otherwise, at every door that parses one (`ObjectSchema.create()`, `defineStack`, `os validate`, `os build`, the metadata save door), with one issue per option at `fields.<field>.options.<i>.kind` naming the field and the option. There is no default under `stageField`. Also refused, at `stageField`: a stage field that takes its options from a `picklist` (the object cannot see them to check), and a stage field carrying options that holds no single option code per record (`multiselect`, a `multiple: true` select). Unchanged: `stageField: false`, a `stageField` naming no declared field, and one naming a field with no options.
  
  Migration: add `kind` to each option of the stage field, marking each terminal state `won` or `lost` and every other state `open`:
  
  - `status: Field.select({ options: [{ label: 'New', value: 'new' }, { label: 'Converted', value: 'converted' }, { label: 'Unqualified', value: 'unqualified' }] })` with `stageField: 'status'` → the same options with `kind: 'open'`, `kind: 'won'` and `kind: 'lost'`.
  - A picklist-backed stage field → declare its options inline on the field.
  - An object with no linear lifecycle → `stageField: false`.
  
  No conversion makes this edit, because which option ends a record's life successfully is the author's to say. `os migrate meta` lists the D3 entry `stage-field-option-kind-required` with the prescription.
  
  The Studio object designer's options repeater offers `kind`; the field form's options repeater lists it.
  
  The other packages follow the new key:
  
  - **`@objectstack/platform-objects`.** The metadata-form translation bundles (`./metadata-translations`) carry the options repeater's new `kind` row, with its label and help text in zh-CN, ja-JP and es-ES.
  - **`@objectstack/metadata-core`.** The published contract fixture `FLS_CONTRACT_OBJECT` (`@objectstack/metadata-core/testing`) names `salary_grade` as its `stageField`, so its two options now declare `kind: 'open'`, and the fixture meets the stage-field rule: `ObjectSchema` raises no issue at `stageField` or under `fields.salary_grade.options`. The fixture is not otherwise a spec-valid object (its `script` actions carry no `body` or `target`), and this change leaves that as it was.
  
  <!-- adr-0087: registered stage-field-option-kind-required -->
- 077b75f: fix(metadata-core): the protocol handshake reads an `engines.protocol` `||` union, so `'^17.7.0 || ^18.0.0'` loads on protocol 18 instead of being refused as incompatible
  
  Clause-②: no
  
  - **What was wrong.** `rangeAdmitsMajor` had no branch for `||`. A union reached the caret branch and was read as a caret on its first alternative, so `'^17.7.0 || ^18.0.0'` answered `OS_PROTOCOL_INCOMPATIBLE` on protocol 18. Every door that runs the ADR-0087 D1 handshake refused it: `sys_packages` boot rehydration, the marketplace install-local POST and rehydrate, and `protocol.installPackage`.
  - **What it does now.** A union admits a major when any alternative admits it. When none does and any alternative is unrecognized (an empty one included, `'^17 ||'`), the union answers `unparsed-range`: the package loads with the existing `[protocol]` warning and is never refused. A union whose every alternative refuses is refused as before. Each alternative is read with the unchanged single-range grammar (caret, tilde, hyphen, comparators, `x`, `*`), so a range without `||` reads exactly as it did.
  - **The refusal's `targetMajor`.** For a refused union it is the lowest alternative's major, whatever order the alternatives are written in, so `'^17 || ^16'` and `'^16 || ^17'` both name `objectstack migrate meta --from 16`. It used to read the first alternative.
  - **The artifact forward-conversion floor.** `parseRangeFloor` reads a union's floor as its lowest alternative's (`'^18.0.0 || ^17.1.0'` → `17.1.0`, as for `'^17.1.0 || ^18.0.0'`), and `null` when an alternative is unreadable. It used to read the first alternative, so a union written high-first opened a narrower conversion window than the same range written low-first.
- 31e7d0b: feat(spec): an object can declare its default row scope, `defaultRowScope`, the row-level security policy shape without `object`
  
  Clause-②: yes (widening)
  
  `ObjectSchema` gains one optional key, `defaultRowScope`: one row-level security policy, written like a permission set's `rowLevelSecurity` entry without `object`, which the declaring object implies. The shape is exported as `DefaultRowScopeSchema` from `@objectstack/spec/security` (types `DefaultRowScope` and `DefaultRowScopeParsed`).
  
  - **What it parses.** Every member of `RowLevelSecurityPolicySchema` except `object`, the same member schemas: `name`, `label`, `description`, `operation`, `using`, `check`, `positions` and `enabled` (default `true`). The policy's two rules hold as written: at least one of `using` / `check`, and no `check` on a `select` or `delete` policy.
  - **What it refuses.** `object` is refused by name, with a prescription to delete it: the target is implied. Any other unknown key is refused too, the policy's retired `priority` and `tags` included.
  - **What it does.** The security plugin's row-policy collection (`collectRLSPolicies`), the one step every read, write and explain passes through, applies the key: when the permission sets the caller holds carry no row policy for the object and the operation (a `'*'` policy counts; one switched off, outside the caller's positions, or for another operation does not), the object's default is used in their place and judged like a held policy. A policy an authored set carries for the object is used as authored, with the default not added to it; a principal whose superuser bypass skips row policies is unaffected; an object without the key keeps its behaviour. A `using` the row-filter compiler cannot lower makes the reads it governs return no rows, with one server warning. The platform's identity objects are to declare it for their own tables in a separate change. See the `@objectstack/plugin-security` entry in this release for the reader.
  - **`composeStacks` with `objectConflict: 'merge'`** now refuses two stacks that declare a different `defaultRowScope` on the same object, the way it refuses every other fixed-shape config object (`access`, `enable`, `publicSharing`, …). The refusal message's list of those objects names `defaultRowScope` too. Nothing composed before is affected, because no stack declared the key.
  - **`@objectstack/metadata-core`: the field-level-security projection classifies the new key.** When an object document is served to a caller who cannot read some of its fields, `defaultRowScope` is treated like a validation rule: the whole policy is dropped from the served document when its `using`, `check` or prose names a field that caller cannot read, and served unchanged otherwise. No behaviour moves until an object declares the key, and no object declares it yet.
  - Additive: every object that parsed before still parses, and its parsed output is unchanged.
- ef1fcb2: A declared index states its uniqueness scope: bare `unique: true` on `indexes[]` is refused (protocol 18, ADR-0120 D1/D7), stored metadata converts it to `unique: 'global'` with zero drift, and `VISIBILITY_STRICT_OPTIONS` leaves `@objectstack/spec`'s public surface.
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered declared-index-bare-unique-true-retired, visibility-strict-options-unexported -->
  
  **BREAKING**: an accept-set narrowing on a published authoring surface and one export removal, shipped as `minor` under the launch-window convention for accept-set narrowings (Changesets pre mode is not in on `main`).
  
  **Why.** On a declared index, bare `unique: true` was the one `unique` spelling whose scope was positional. It built the index over exactly `fields`, one holder across the whole installation, while reading like "unique per organization" to an author who knew the field-level meaning. 17.x warned (lint `unique/unscoped-declared-index`). Protocol 18 refuses it, so the scope is always stated.
  
  **What is refused.** A declared index (`objects[].indexes[]`, `objectExtensions[].indexes[]`) whose `unique` is bare `true`. The refusal names both replacements, and says which one keeps the index bare `true` built. It is raised by:
  
  - the schema (`IndexSchema.unique`, now `false | 'global' | 'organization'`), at every door that parses: `ObjectSchema.create()` and `ObjectSchema.parse()`, `defineStack`, `os validate`, `os build`, and the runtime save door (`422 INVALID_METADATA`). `tsc` refuses it too, because the input type no longer admits `true`;
  - lint `unique/unscoped-declared-index`, now an `error` and a gating rule on all three commands. It is what refuses the spelling under `os lint`, which never parses.
  
  **What converts.** The protocol-18 ADR-0087 conversion `declared-index-unique-scope` rewrites a declared index's bare `true` to `'global'` on every data-at-rest seam: stored `sys_metadata` rows (`applyConversionsToStoredItem`), built artifacts inside their declared-floor window, and `os migrate meta --from 17`. `'global'` is exactly the index bare `true` built, so the physical index is byte-identical and the drift plan is empty. It is retired from the authoring funnel, so a live author is refused and taught instead of converted silently.
  
  **What stays accepted.** Field-level `unique: true` still means one holder per organization and stays valid indefinitely. On a declared index, `unique: false` or omitted, `'global'` and `'organization'` parse exactly as before.
  
  ## FROM → TO
  
  | you wrote | write instead |
  |:--|:--|
  | `indexes: [{ fields: [...], unique: true }]` | `indexes: [{ fields: [...], unique: 'global' }]`: the same index, nothing on disk changes |
  | …the same, when you meant one holder per organization | `unique: 'organization'`: the driver prepends the NULL-safe organization key part at registration, and `os migrate plan` shows the index change |
  | `import { VISIBILITY_STRICT_OPTIONS } from '@objectstack/spec/shared'` (or the root entry) | delete the import: it was an internal option bag for the spec's own visibility-carrying schemas, and those schemas are unchanged |
  
  **The one-line fix: on every declared index, write `unique: 'global'` where you wrote `unique: true`.** Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.
  
  **Who is affected, measured.** At `e67ba80049`, an AST census found 48 declared indexes with bare `unique: true` in 39 source files of this repository, all platform and plugin objects. Every one is respelled `'global'` in this change, and the nine-key S5 corpus is pinned to build byte-identical indexes before and after (`driver-sql`'s `sql-driver-unique-tenancy.test.ts`). `examples/**` and `apps/**` carry none. Deployed metadata and other repositories were not measured.
  
  ### The kit
  
  - **The refusal.** `IndexSchema.unique` in `data/object.zod.ts`, with its own prescription. The lint rule moved from `warning` to `error` and from advisory to gating.
  - **The conversion.** `declared-index-unique-scope` (`toMajor: 18`, retired from the load path, `retiredAfter: '17.7.0'`), with its S4/S5 fixture.
  - **The ledger.** The D3 semantic entries `declared-index-bare-unique-true-retired` (the scope each respelled index really meant is the author's call) and `visibility-strict-options-unexported`, plus a step-18 rationale fragment.
  - **The export.** `VISIBILITY_STRICT_OPTIONS` moved to the unbarrelled `shared/visibility-strict-options.ts`, beside its type `StrictObjectOptions`. `check:api-surface` counts the removal.
  - **The pins.** The "`'global'` is a synonym of `true`" driver pin retired with the bare spelling. The verbatim pin is stated in `'global'`.
- Updated dependencies [ffba02e]
- Updated dependencies [29d0ed3]
- Updated dependencies [1b40780]
- Updated dependencies [ca426cb]
- Updated dependencies [4ad3ce5]
- Updated dependencies [8016a9d]
- Updated dependencies [df9d07e]
- Updated dependencies [8eac321]
- Updated dependencies [a5a781b]
- Updated dependencies [191e043]
- Updated dependencies [b12e16a]
- Updated dependencies [fbafb85]
- Updated dependencies [35450f0]
- Updated dependencies [1e8b628]
- Updated dependencies [12d1476]
- Updated dependencies [14ccb1d]
- Updated dependencies [c0803b0]
- Updated dependencies [4bc3bec]
- Updated dependencies [1f949da]
- Updated dependencies [ecb7b44]
- Updated dependencies [41edf73]
- Updated dependencies [1c1144f]
- Updated dependencies [3983965]
- Updated dependencies [0c910d5]
- Updated dependencies [317cddd]
- Updated dependencies [fec87e7]
- Updated dependencies [dac99c2]
- Updated dependencies [0d3ea29]
- Updated dependencies [0253192]
- Updated dependencies [bfc15d2]
- Updated dependencies [7aa8d51]
- Updated dependencies [95a8435]
- Updated dependencies [60bcfe7]
- Updated dependencies [66949b7]
- Updated dependencies [d112087]
- Updated dependencies [4806b18]
- Updated dependencies [1802315]
- Updated dependencies [06cc45d]
- Updated dependencies [7de0265]
- Updated dependencies [7895671]
- Updated dependencies [b389e43]
- Updated dependencies [c8b062f]
- Updated dependencies [117d34d]
- Updated dependencies [6729e10]
- Updated dependencies [1920cf3]
- Updated dependencies [41d0d40]
- Updated dependencies [c52bfb4]
- Updated dependencies [f9b4217]
- Updated dependencies [eebaf3b]
- Updated dependencies [c7d6037]
- Updated dependencies [72b26ed]
- Updated dependencies [2d21b9c]
- Updated dependencies [f66fdc7]
- Updated dependencies [9fdb127]
- Updated dependencies [615c696]
- Updated dependencies [968acc8]
- Updated dependencies [111ffff]
- Updated dependencies [12b9daf]
- Updated dependencies [7958bdf]
- Updated dependencies [d85615d]
- Updated dependencies [6a06e3b]
- Updated dependencies [0e9e7b7]
- Updated dependencies [0af4f66]
- Updated dependencies [9a0401f]
- Updated dependencies [9c93ce6]
- Updated dependencies [ac9f8bd]
- Updated dependencies [04e776b]
- Updated dependencies [a7df552]
- Updated dependencies [2f70c22]
- Updated dependencies [78f841b]
- Updated dependencies [c565813]
- Updated dependencies [d5a14dd]
- Updated dependencies [93125ae]
- Updated dependencies [56c8844]
- Updated dependencies [d4680d2]
- Updated dependencies [cdeabec]
- Updated dependencies [d7c5c33]
- Updated dependencies [a87d8be]
- Updated dependencies [15ec50e]
- Updated dependencies [db4c45b]
- Updated dependencies [51290bc]
- Updated dependencies [ad381fd]
- Updated dependencies [2b61f2d]
- Updated dependencies [8f2e808]
- Updated dependencies [3b49318]
- Updated dependencies [4e9fe9f]
- Updated dependencies [9ad3d24]
- Updated dependencies [326a90a]
- Updated dependencies [9fe7448]
- Updated dependencies [2e11d90]
- Updated dependencies [4578c56]
- Updated dependencies [c512c25]
- Updated dependencies [215e662]
- Updated dependencies [3d886ee]
- Updated dependencies [d8d0711]
- Updated dependencies [b15f8a1]
- Updated dependencies [40a6ee5]
- Updated dependencies [5910b5e]
- Updated dependencies [081e6a0]
- Updated dependencies [1884948]
- Updated dependencies [e23eccb]
- Updated dependencies [ac8f2c5]
- Updated dependencies [db9cf80]
- Updated dependencies [e75dced]
- Updated dependencies [9af0005]
- Updated dependencies [440bed6]
- Updated dependencies [b2549a8]
- Updated dependencies [ee8751d]
- Updated dependencies [96e4be4]
- Updated dependencies [194a42d]
- Updated dependencies [35ef501]
- Updated dependencies [faf6348]
- Updated dependencies [557ae7c]
- Updated dependencies [6a3fe25]
- Updated dependencies [7731d70]
- Updated dependencies [3073b72]
- Updated dependencies [c76edeb]
- Updated dependencies [5b12503]
- Updated dependencies [514bf3c]
- Updated dependencies [20e7d52]
- Updated dependencies [b3a3634]
- Updated dependencies [3e72f93]
- Updated dependencies [f89b5f5]
- Updated dependencies [d25b187]
- Updated dependencies [0e00d36]
- Updated dependencies [d748ae8]
- Updated dependencies [dab6bf4]
- Updated dependencies [ed1de8c]
- Updated dependencies [a00cf99]
- Updated dependencies [5fb1746]
- Updated dependencies [29a163f]
- Updated dependencies [e223152]
- Updated dependencies [9f5eca5]
- Updated dependencies [9963322]
- Updated dependencies [b27b894]
- Updated dependencies [02d9f69]
- Updated dependencies [f53f14b]
- Updated dependencies [a800912]
- Updated dependencies [d973c34]
- Updated dependencies [156ddfa]
- Updated dependencies [5081090]
- Updated dependencies [b6eb25f]
- Updated dependencies [165587e]
- Updated dependencies [e04759d]
- Updated dependencies [ea9fd99]
- Updated dependencies [b32ee3e]
- Updated dependencies [e5899a6]
- Updated dependencies [490cb6d]
- Updated dependencies [e865300]
- Updated dependencies [ec7c7e0]
- Updated dependencies [85edd61]
- Updated dependencies [e84aeb3]
- Updated dependencies [322ff1e]
- Updated dependencies [5fc57b3]
- Updated dependencies [581ca7d]
- Updated dependencies [3f0b6f2]
- Updated dependencies [9814035]
- Updated dependencies [55382dc]
- Updated dependencies [b1d701b]
- Updated dependencies [efcbac7]
- Updated dependencies [20028df]
- Updated dependencies [69d4218]
- Updated dependencies [5ce6773]
- Updated dependencies [9432bac]
- Updated dependencies [3f69471]
- Updated dependencies [e5687cb]
- Updated dependencies [1e62f71]
- Updated dependencies [777eed2]
- Updated dependencies [ec7f7f8]
- Updated dependencies [038d4c9]
- Updated dependencies [147a0d1]
- Updated dependencies [1959aac]
- Updated dependencies [1badd31]
- Updated dependencies [55828c5]
- Updated dependencies [7856110]
- Updated dependencies [9b37edb]
- Updated dependencies [4216796]
- Updated dependencies [a22e67b]
- Updated dependencies [5f37d36]
- Updated dependencies [62ce45d]
- Updated dependencies [39e93ef]
- Updated dependencies [02bec6c]
- Updated dependencies [719183f]
- Updated dependencies [c40a0dd]
- Updated dependencies [bb7ccde]
- Updated dependencies [df000d4]
- Updated dependencies [646303e]
- Updated dependencies [8464380]
- Updated dependencies [252a582]
- Updated dependencies [f931e76]
- Updated dependencies [1912af4]
- Updated dependencies [e5f9f01]
- Updated dependencies [76815b9]
- Updated dependencies [4d1e4a8]
- Updated dependencies [4cc3ff9]
- Updated dependencies [c056979]
- Updated dependencies [4f68ba1]
- Updated dependencies [107853c]
- Updated dependencies [543b33d]
- Updated dependencies [b529a5c]
- Updated dependencies [1623faf]
- Updated dependencies [b4d573a]
- Updated dependencies [87d0619]
- Updated dependencies [4e0838d]
- Updated dependencies [60f9baf]
- Updated dependencies [584e737]
- Updated dependencies [c857a93]
- Updated dependencies [345d1be]
- Updated dependencies [430e5f5]
- Updated dependencies [14a13bc]
- Updated dependencies [ca0bdbc]
- Updated dependencies [301eec6]
- Updated dependencies [572ecfb]
- Updated dependencies [5547ad4]
- Updated dependencies [707b3cd]
- Updated dependencies [6673c80]
- Updated dependencies [0f05907]
- Updated dependencies [5e725b8]
- Updated dependencies [eeb95f7]
- Updated dependencies [d89f491]
- Updated dependencies [dc39326]
- Updated dependencies [775ed65]
- Updated dependencies [e4ec6ec]
- Updated dependencies [b1e9280]
- Updated dependencies [05ab9ef]
- Updated dependencies [1d79556]
- Updated dependencies [07b27b3]
- Updated dependencies [d0c09e4]
- Updated dependencies [3fed1eb]
- Updated dependencies [1692cd1]
- Updated dependencies [73c7dc4]
- Updated dependencies [8693110]
- Updated dependencies [ad5a7d7]
- Updated dependencies [dd29bbe]
- Updated dependencies [dd29bbe]
- Updated dependencies [6f21216]
- Updated dependencies [2372e0a]
- Updated dependencies [5afa1e0]
- Updated dependencies [56b2612]
- Updated dependencies [1418de4]
- Updated dependencies [7a96bf8]
- Updated dependencies [a35f7a6]
- Updated dependencies [5fd2c76]
- Updated dependencies [be48c5e]
- Updated dependencies [57994c3]
- Updated dependencies [23e689d]
- Updated dependencies [bc0538a]
- Updated dependencies [f606ba2]
- Updated dependencies [d176b0a]
- Updated dependencies [105902f]
- Updated dependencies [f901746]
- Updated dependencies [c5dd7fc]
- Updated dependencies [ee0e115]
- Updated dependencies [4feb2d0]
- Updated dependencies [8684079]
- Updated dependencies [a69a40a]
- Updated dependencies [1ac24f2]
- Updated dependencies [0a052e6]
- Updated dependencies [462dff3]
- Updated dependencies [ae0ca66]
- Updated dependencies [c03077e]
- Updated dependencies [23d0bc7]
- Updated dependencies [069fd40]
- Updated dependencies [941c78a]
- Updated dependencies [8776119]
- Updated dependencies [0a168a3]
- Updated dependencies [97b8e7a]
- Updated dependencies [af3873b]
- Updated dependencies [9cb9d95]
- Updated dependencies [f846cc2]
- Updated dependencies [1ecb08a]
- Updated dependencies [adad73f]
- Updated dependencies [6422da5]
- Updated dependencies [d0fe050]
- Updated dependencies [dd11563]
- Updated dependencies [2c702fd]
- Updated dependencies [92fd343]
- Updated dependencies [bbdfc05]
- Updated dependencies [d050a8f]
- Updated dependencies [d731b89]
- Updated dependencies [905f57b]
- Updated dependencies [66d2757]
- Updated dependencies [a65a59b]
- Updated dependencies [b0a1df0]
- Updated dependencies [8a83ceb]
- Updated dependencies [462d02f]
- Updated dependencies [eda6f14]
- Updated dependencies [2ee5861]
- Updated dependencies [45e6001]
- Updated dependencies [e46ce7b]
- Updated dependencies [9f024d8]
- Updated dependencies [1489952]
- Updated dependencies [030a7b8]
- Updated dependencies [b1845ed]
- Updated dependencies [70cfb12]
- Updated dependencies [8bfb17d]
- Updated dependencies [8215ff7]
- Updated dependencies [4f11af5]
- Updated dependencies [b036ac5]
- Updated dependencies [d537a31]
- Updated dependencies [6ec0e12]
- Updated dependencies [af284b0]
- Updated dependencies [14a8bd2]
- Updated dependencies [1e001c7]
- Updated dependencies [0b44840]
- Updated dependencies [ef65646]
- Updated dependencies [586705d]
- Updated dependencies [1173017]
- Updated dependencies [fa26308]
- Updated dependencies [2ce2e36]
- Updated dependencies [584b422]
- Updated dependencies [01fafde]
- Updated dependencies [370833a]
- Updated dependencies [3a734e0]
- Updated dependencies [ba5bfe9]
- Updated dependencies [26501ae]
- Updated dependencies [31e7d0b]
- Updated dependencies [94e60c0]
- Updated dependencies [741aa85]
- Updated dependencies [db1f1fd]
- Updated dependencies [adb7910]
- Updated dependencies [f573976]
- Updated dependencies [69f342b]
- Updated dependencies [2ec6827]
- Updated dependencies [fb0d85b]
- Updated dependencies [ff48407]
- Updated dependencies [ef1fcb2]
- Updated dependencies [ace0a53]
- Updated dependencies [de70e97]
- Updated dependencies [74c4b34]
- Updated dependencies [e040b8c]
- Updated dependencies [f451a59]
- Updated dependencies [ba95607]
- Updated dependencies [b53b949]
- Updated dependencies [ea9fd99]
- Updated dependencies [1e44436]
- Updated dependencies [2acff87]
- Updated dependencies [299a2c6]
- Updated dependencies [325a92e]
- Updated dependencies [e23eccb]
- Updated dependencies [bf492c8]
  - @objectstack/spec@18.0.0

## 18.0.0-next.5

### Minor Changes

- 2ec6827: feat(metadata-protocol): the draft save records `draftChanges` — which surface, actor and instant last changed each key path of a pending draft — and the strict draft read serves it
  
  Clause-②: yes (widening)
  
  - **Recorded by the draft save.** `saveMetaItem({ mode: 'draft', surface })` compares the body it writes with the body it replaces, inside the write's own transaction: the draft row, else (the draft's first save) the active row its publish would replace, else nothing, which records `[]`, the whole body. A path is the object keys from the body root to the deepest changed key; an array is one leaf, with no index. Each changed path is stamped `{ by: surface ?? 'api', actor, at }`, where `actor` is the value the save's history event carries (or `null`) and `at` is the write's instant as `toISOString()`.
  - **Kept until publish or discard.** No two entries share a path: a save replaces every entry at or under each path it changes, so the longest prefix answers for a key. A save that changes no key path leaves the entries as they were. Publish and discard delete the draft row, and the entries with it, so the next draft starts clean. A `migrate-stored` rewrite and an active save record nothing.
  - **Served on the strict draft read only.** `getMetaItem({ state: 'draft' })` answering a stored draft row carries `draftChanges` beside `item`. It is absent on the active read, the cached branch, the `?preview=draft` read, and a draft row whose saves recorded none (one saved before this release) — never `[]`.
  - **Stored on the row.** `sys_metadata` gains a nullable `draft_changes` column (`@objectstack/metadata-core`'s `SysMetadataObject`), never inside the stored body. Schema sync adds it to an existing table on boot with no manual step (measured on SQLite and the memory driver).
  - **Translated labels.** `@objectstack/platform-objects`' translation bundles carry the new column's label and help text in every shipped locale.
  - **An unknown `surface` is refused.** In-process, a value outside `copilot | studio | api` is refused `400 INVALID_REQUEST` before anything is written.

### Patch Changes

- Updated dependencies [fa26308]
- Updated dependencies [01fafde]
- Updated dependencies [26501ae]
- Updated dependencies [94e60c0]
- Updated dependencies [adb7910]
- Updated dependencies [69f342b]
- Updated dependencies [2ec6827]
- Updated dependencies [fb0d85b]
- Updated dependencies [ff48407]
  - @objectstack/spec@18.0.0-next.5

## 18.0.0-next.4

### Patch Changes

- 31e7d0b: feat(spec): an object can declare its default row scope, `defaultRowScope`, the row-level security policy shape without `object`
  
  Clause-②: yes (widening)
  
  `ObjectSchema` gains one optional key, `defaultRowScope`: one row-level security policy, written like a permission set's `rowLevelSecurity` entry without `object`, which the declaring object implies. The shape is exported as `DefaultRowScopeSchema` from `@objectstack/spec/security` (types `DefaultRowScope` and `DefaultRowScopeParsed`).
  
  - **What it parses.** Every member of `RowLevelSecurityPolicySchema` except `object`, the same member schemas: `name`, `label`, `description`, `operation`, `using`, `check`, `positions` and `enabled` (default `true`). The policy's two rules hold as written: at least one of `using` / `check`, and no `check` on a `select` or `delete` policy.
  - **What it refuses.** `object` is refused by name, with a prescription to delete it: the target is implied. Any other unknown key is refused too, the policy's retired `priority` and `tags` included.
  - **What it does today: nothing.** No server reads the key in this release, so declaring it filters no rows. The describe states the contract the security plugin's row-policy collection is to meet once it reads the key: the default is to apply when no permission set the caller holds carries a row policy for the object; a policy an authored set carries is to be used as authored; a superuser-bypass principal is to be unaffected; an object without the key keeps its behaviour. No object declares the key yet; the platform's identity objects are to declare it for their own tables. Authoring the key raises the liveness lint's `liveness-planned-property` warning until then. Restrict rows with a permission set's `rowLevelSecurity` policy in the meantime.
  - **`composeStacks` with `objectConflict: 'merge'`** now refuses two stacks that declare a different `defaultRowScope` on the same object, the way it refuses every other fixed-shape config object (`access`, `enable`, `publicSharing`, …). The refusal message's list of those objects names `defaultRowScope` too. Nothing composed before is affected, because no stack declared the key.
  - **`@objectstack/metadata-core`: the field-level-security projection classifies the new key.** When an object document is served to a caller who cannot read some of its fields, `defaultRowScope` is treated like a validation rule: the whole policy is dropped from the served document when its `using`, `check` or prose names a field that caller cannot read, and served unchanged otherwise. No behaviour moves until an object declares the key, and no object declares it yet.
  - Additive: every object that parsed before still parses, and its parsed output is unchanged.
- Updated dependencies [eebaf3b]
- Updated dependencies [194a42d]
- Updated dependencies [bb7ccde]
- Updated dependencies [df000d4]
- Updated dependencies [646303e]
- Updated dependencies [b0a1df0]
- Updated dependencies [eda6f14]
- Updated dependencies [2ee5861]
- Updated dependencies [e46ce7b]
- Updated dependencies [1489952]
- Updated dependencies [030a7b8]
- Updated dependencies [b1845ed]
- Updated dependencies [70cfb12]
- Updated dependencies [8bfb17d]
- Updated dependencies [8215ff7]
- Updated dependencies [4f11af5]
- Updated dependencies [b036ac5]
- Updated dependencies [d537a31]
- Updated dependencies [6ec0e12]
- Updated dependencies [af284b0]
- Updated dependencies [14a8bd2]
- Updated dependencies [1e001c7]
- Updated dependencies [0b44840]
- Updated dependencies [ef65646]
- Updated dependencies [586705d]
- Updated dependencies [1173017]
- Updated dependencies [2ce2e36]
- Updated dependencies [584b422]
- Updated dependencies [370833a]
- Updated dependencies [3a734e0]
- Updated dependencies [ba5bfe9]
- Updated dependencies [31e7d0b]
- Updated dependencies [741aa85]
- Updated dependencies [db1f1fd]
- Updated dependencies [f573976]
  - @objectstack/spec@18.0.0-next.4

## 18.0.0-next.3

### Minor Changes

- d050a8f: fix(spec,objectql)!: an installed or stored page carrying a declaration spec 18 retires converts at load instead of stopping the kernel build — `isDefault` off a bound record page is deleted and `template: 'full-width'` re-spelled `default`, each with a named notice; the authoring, save and publish doors keep refusing
  
  Clause-②: yes (widening)
  
  **What changes.** Protocol 18 refused `isDefault: true` on a page that is not a record page bound to an object, and closed the page `template` set (retiring `full-width`), at every door — the page parse (`definePage`, `defineStack`, so `os validate` / `os build`, and the metadata save door) and the kernel's package registration (`SchemaRegistry.installPackage` / `registerItem`, `MisplacedDefaultPageError`). The registration refusal also fired when a kernel was built from a package that was installed BEFORE the retirement: every hosted environment holding such a package failed its kernel build, with no remedy short of upgrading the package in each one. Data at rest now converts, and only data at rest:
  
  | Door | Before | Now |
  | :--- | :--- | :--- |
  | `definePage` / `defineStack` (`os validate`, `os build`), the metadata save door, package publish | refused at `isDefault` / `template` | **unchanged** — refused with the same sentence |
  | a `sys_metadata` page row read back | served with `_diagnostics.valid: false` | converted on read: the flag deleted, `full-width` → `default`, `OS_METADATA_CONVERTED` notice |
  | a compiled artifact inside the window its `engines.protocol` opens | the artifact door refused the artifact | converted before the strict parse, as every retired entry is |
  | a package body registered through `manifest.register` / `ObjectQL.registerApp` that declares `engines.protocol` (an installed package, a marketplace install) | `MisplacedDefaultPageError`, kernel build stopped | converted before anything registers, with one `warn` per (package, conversion) naming the conversion id and the first site; the body is left unchanged on disk |
  | the same body with NO declared range (a manifest a plugin builds in code), or declaring a floor newer than every retirement | refused | **unchanged** — refused |
  
  **The two ADR-0087 D2 entries**, both `retiredFromLoadPath` from the day they land (the authoring funnel never replays them):
  
  - `page-is-default-off-record-page-removed` (`page.isDefault`): deletes `isDefault: true` from exactly the pages `misplacedDefaultPageRefusal` refuses — a `home`, `app`, `utility` or `list` page, or a record page with no `object`. Lossless: nothing read the flag there (an app opens on its first navigation item). A default record page bound to an object keeps its flag.
  - `page-template-full-width-to-default` (`page.template`): `'full-width'` → `'default'`. Lossless: the console drew both names with one template component. An unregistered template name (`centered`, `two-column`) and a region the template does not place have no lossless rewrite and are NOT converted — they stay with the parse, and the D3 entries `page-is-default-off-record-page-refused` / `page-template-closed-region-unplaced-refused` name the hand edits.
  
  **`@objectstack/objectql`** — `ObjectQL.registerApp` (and the `manifest` service, for an artifact carrying `packages[]`) replays the versioned forward conversion (`applyArtifactForwardConversions`, `@objectstack/metadata-core`) over a package body that declares its protocol range, before `installPackage`; the converted copy is what the package record and every registered item carry. Public: `ObjectQL.convertPackageBodyForward(body)`.
  
  **`@objectstack/metadata-core`** — `applyArtifactForwardConversions` reads the declared range off a FLAT package body (the manifest half beside its collections, no `manifest` key) when the definition carries no `manifest`; a definition with a `manifest` object is read there, as before.
  
  Migration: none for authors — the authoring doors refuse exactly what they refused. An installed package converts again at every registration until it is rebuilt (`os build`) and re-published with tooling from a release that ships the retirement; the boot log's warn names the conversion and the site.
  
  <!-- adr-0087: registered page-is-default-off-record-page-removed, page-template-full-width-to-default -->

### Patch Changes

- 105902f: feat(spec)!: retire the view form's `visibleOn` and the page component's `visibility` as keys; their ADR-0089 renames leave the load path
  
  Clause-②: yes (narrowing)
  
  **BREAKING (authoring):** ADR-0089 made `visibleWhen` the one conditional-visibility key, and through 17 the old spellings were declared `[DEPRECATED]` keys that the parse folded onto `visibleWhen` without a word: `visibleOn` on a form view's fields and sections, and `visibility` on a page component. At 18 all three positions carry a `retiredKey()` tombstone naming `visibleWhen`, the parse-time fold is gone, and the two ADR-0087 D2 conversions `view-visibleOn-to-visibleWhen` and `page-component-visibility-to-visibleWhen` (protocol 15) are retired from the load path (`retiredAfter: '17.7.0'`).
  
  ## FROM → TO
  
  | you wrote (17.7 and earlier) | write instead |
  | --- | --- |
  | `visibleOn: "…"` on a form field (`view.form.sections[].fields[]`) | `visibleWhen: "…"` |
  | `visibleOn: "…"` on a form section (`view.form.sections[]`) | `visibleWhen: "…"` |
  | `visibility: "…"` on a page component (`page.components[]`, slots and nested containers included) | `visibleWhen: "…"` |
  
  **The one-line fix:** rename the key to `visibleWhen`; the CEL predicate is unchanged. Where a node wrote both keys, `visibleWhen` was the one in effect: delete the old key.
  
  **What an author who still writes it sees.** `tsc` fails at a typed authoring site (`FormFieldInput`, `FormSection`, `PageComponent` type the key as retired), and the parse refuses it by name at its own path — `defineStack` throws `STACK_SCHEMA_INVALID` (422), `os validate` / `os build` print the issue, and the metadata save door answers 422:
  
  > `page.components[].visibility` was removed in @objectstack/spec 18 (ADR-0089 D2) — it was the page component's deprecated spelling of the conditional-visibility predicate, which the parse folded into `visibleWhen` until this release. Use `visibleWhen`. Rename the key; the value (a CEL predicate) is unchanged. Where a component writes both, `visibleWhen` is the one that was in effect: delete `visibility`.
  
  **No tool makes the rename.** Both conversions belong to protocol 15, below the migration floor, so `os migrate meta --from 17` applies no edit for either key and `--write` writes none: it prints each written key among the refusals the migrated stack still has, and lists the D3 entry `ui-visibility-alias-keys-retired` as the hand edit.
  
  **Stored metadata needs no edit.** Stored-row rehydration and the artifact-ingestion door inside its window still replay both conversions, so a `sys_metadata` view or page row written with the old key keeps loading with `visibleWhen`. A script that saves a view or page through the metadata API with the old key is refused and needs the same rename.
  
  ## The retirement kit
  
  - **Tombstones** on `FormFieldSchema`, `FormSectionSchema` and `PageComponentSchema`; `RETIRED_KEYS_BY_MAJOR[18]`: `ui/FormField:visibleOn`, `ui/FormSection:visibleOn`, `ui/PageComponent:visibility`; the authorable-surface rows read `[RETIRED]`.
  - **The fold is gone.** The three shapes are plain closed objects again (no `.transform` pipe): a section's group-reference rule no longer lists `visibleOn` (the tombstone answers it first), and a slotted page node's `type` refusal now arrives at its own path instead of nested in an `invalid_union`.
  - **The D3 entry `ui-visibility-alias-keys-retired`**, one for both keys.
  - **No deprecation window**, per the project's startup-stage posture.
  
  `@objectstack/lint`: the visibility-predicate rules (`visibility-root-mislayered`, `visibility-bare-identifier`, `visibility-predicate-syntax`) and the predicate-path rules read `visibleWhen` only. `os validate`, `os build`, `os verify`, `defineStack` and the metadata save door parse first and refuse either retired key by name, so a body they judge cannot carry one. `os lint` is the one door that hands these rules an unparsed stack: there a predicate written under a retired key is not judged, by design — the parsing doors refuse the key itself, and `os lint` reports no refused shape.
  
  `@objectstack/metadata-core`: `detectUnboundFormViewPredicateRoots` reads `visibleWhen` only. Its caller scans an artifact after `applyArtifactForwardConversions`, which renames a legacy `visibleOn` first.
  
  Not part of it: `normalizeVisibleWhen` and `VISIBILITY_ALIAS_KEYS` stay exported (no schema here calls them any more); objectui's renderer reads of the old keys leave on the objectui side.
  
  ⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is published, so this is breaking for consumers no telemetry was consulted for.
  
  <!-- adr-0087: registered ui-visibility-alias-keys-retired -->
- 8776119: **Shipped in 18.0.0-next.2**, whose CHANGELOG missed this entry (#23818); listed here one prerelease late.
  
  feat(spec): `referenceDeletedWhen` beside `referenceVia` marks a polymorphic pointer's target as platform-deleted
  
  Clause-②: yes
  
  `FieldSchema` gains one optional key beside `referenceVia`: `referenceDeletedWhen: { field, value }`. On rows where the sibling `select` field `field` holds the option `value`, the record the pointer names was deleted by the platform's own assertion, and a renderer draws a tombstone from that option's own label instead of a link. Example: `record_id: Field.text({ referenceVia: 'object_name', referenceDeletedWhen: { field: 'cancel_reason', value: 'record_deleted' } })`.
  
  Any other shape is refused at parse, naming the field and the option:
  
  - the key on a field that declares no `referenceVia` (`FieldSchema`), or an unknown key inside it;
  - a `field` that is the declaring field itself, is not declared on the object, is not a `select`, is a `multiple: true` select, or declares no inline `options` (a `picklist`-backed select); a `value` that is not one of the sibling's option values (`ObjectSchema`, at every door: `ObjectSchema.create()`, `defineStack`, raw `.parse()` and the metadata save door).
  
  Nothing that parsed before is refused: the key is new. Its liveness row is `planned` until the renderer that reads it ships.
  
  The other packages classify the new key where every field key is classified:
  
  - **`@objectstack/metadata-core`.** `FIELD_REFERENCE_POSITIONS` deletes a served field's `referenceDeletedWhen` when its `field` names a field the caller cannot read (field-level security); `value` is an option value and never a field name.
  - **`@objectstack/driver-sql`.** `FIELD_KEY_STORAGE_CLASS` classifies it `presentation`: no DDL reads it.
  - **`@objectstack/platform-objects`.** The field form's new `referenceDeletedWhen` row carries its labels and help text in zh-CN, ja-JP and es-ES.
- 30ce56e: Clause-②: no
  
  Setup pages describe their records in plain admin sentences. Business Units now reads "Your
  company structure — divisions, departments, regions and offices — used to scope data and
  reports.", Notification Events "Every notification the platform sent, one row per event.",
  Notification Preferences "Which topics and channels each user receives; admins set the
  defaults.", Notification Templates "The subject and body each notification topic sends, per
  channel and language." and HTTP Deliveries "Outgoing HTTP calls made by webhooks and flows, one
  row per call, with its delivery status." Field help on Users, Organizations, Invitations and SSO
  Providers, and the metadata-storage and notification-delivery object descriptions, no longer
  carry design-record numbers; those references stay in the code comments. The zh-CN, ja-JP and
  es-ES translations follow. Wording only: no field, permission or behaviour changes.
- df2c551: fix(metadata-core): the package installs on npm 10 again, and into projects that use vitest 5, because it no longer declares an optional `vitest` peer
  
  Clause-②: no
  
  On npm 10, the npm that Node 22 bundles, `npm install @objectstack/metadata-core` exited 1 with `Cannot read properties of null (reading 'edgesOut')`. So did installing a package that depends on it, such as `@objectstack/objectql`. The cause was this package's optional peer `vitest: ^4.0.0`. It led npm 10 to vitest 4.1.12, whose own peer declarations contradict each other, and npm 10's resolver crashes on that. The same peer also made npm refuse (`ERESOLVE`) to install the package into a project that already uses vitest 5.
  
  The package's main entry never imports `vitest`. Only the test-only `@objectstack/metadata-core/testing` entry does, so the peer is removed. Nothing the package exports changes.
  
  If you import `@objectstack/metadata-core/testing`, list `vitest` in your own `devDependencies`, as that entry's documentation already says. This package runs that suite on vitest 4. In a pnpm workspace with hoisting turned off (`hoist=false`), that entry can no longer find `vitest` from inside a workspace package. Declare the peer back in your `pnpm-workspace.yaml`:
  
  ```yaml
  packageExtensions:
    '@objectstack/metadata-core':
      peerDependencies:
        vitest: '*'
  ```
  
  `@objectstack/plugin-auth` still fails the same way on npm 10, because its `better-auth` dependency declares its own optional `vitest` peer. Install it with npm 11, or add `"overrides": { "vitest": "~4.0.0" }` to your project's `package.json`.
- adad73f: feat(spec)!: a select option declares its lifecycle `kind` (`open` / `won` / `lost`), and every option of an object's `stageField` must declare it
  
  Clause-②: yes (narrowing)
  
  `SelectOptionSchema` gains one optional key, `kind`, a closed vocabulary of three lifecycle categories that means the same on every object: `open` (a step on the way), `won` (the successful end: a deal's Closed Won, a lead's Converted, a task's Done, a case's Resolved) and `lost` (the unsuccessful end: Closed Lost, Unqualified, Cancelled). It is the spelling `record:path` `stages[].terminal` already takes, so the data layer and the page say one thing one way. Example: `{ label: 'Closed Lost', value: 'closed_lost', kind: 'lost' }`. The exported type `SelectOptionKind` names the three values.
  
  - On a plain single-value `select` / `radio` the key is optional, and an absent kind reads as `open`. Nothing is written in at parse: an option without `kind` parses without it.
  - On any other field's options (`multiselect`, `checkboxes`, `tags`, a `multiple: true` select, a lookup's static options) `FieldSchema` refuses it at `options.<i>.kind`: a lifecycle is one value per record.
  - A shared `picklist`'s options accept it (the same option shape). A form view's option list does not (`FormSelectOptionSchema`): it is refused there as an unknown key whose message points at the object field's own option.
  
  **BREAKING (authoring):** when an object's `stageField` names a field, every option of that field must declare `kind`. `ObjectSchema` refuses the object otherwise, at every door that parses one (`ObjectSchema.create()`, `defineStack`, `os validate`, `os build`, the metadata save door), with one issue per option at `fields.<field>.options.<i>.kind` naming the field and the option. There is no default under `stageField`. Also refused, at `stageField`: a stage field that takes its options from a `picklist` (the object cannot see them to check), and a stage field carrying options that holds no single option code per record (`multiselect`, a `multiple: true` select). Unchanged: `stageField: false`, a `stageField` naming no declared field, and one naming a field with no options.
  
  Migration: add `kind` to each option of the stage field, marking each terminal state `won` or `lost` and every other state `open`:
  
  - `status: Field.select({ options: [{ label: 'New', value: 'new' }, { label: 'Converted', value: 'converted' }, { label: 'Unqualified', value: 'unqualified' }] })` with `stageField: 'status'` → the same options with `kind: 'open'`, `kind: 'won'` and `kind: 'lost'`.
  - A picklist-backed stage field → declare its options inline on the field.
  - An object with no linear lifecycle → `stageField: false`.
  
  No conversion makes this edit, because which option ends a record's life successfully is the author's to say. `os migrate meta` lists the D3 entry `stage-field-option-kind-required` with the prescription.
  
  The Studio object designer's options repeater offers `kind`; the field form's options repeater lists it.
  
  The other packages follow the new key:
  
  - **`@objectstack/platform-objects`.** The metadata-form translation bundles (`./metadata-translations`) carry the options repeater's new `kind` row, with its label and help text in zh-CN, ja-JP and es-ES.
  - **`@objectstack/metadata-core`.** The published contract fixture `FLS_CONTRACT_OBJECT` (`@objectstack/metadata-core/testing`) names `salary_grade` as its `stageField`, so its two options now declare `kind: 'open'`, and the fixture meets the stage-field rule: `ObjectSchema` raises no issue at `stageField` or under `fields.salary_grade.options`. The fixture is not otherwise a spec-valid object (its `script` actions carry no `body` or `target`), and this change leaves that as it was.
  
  <!-- adr-0087: registered stage-field-option-kind-required -->
- 077b75f: fix(metadata-core): the protocol handshake reads an `engines.protocol` `||` union, so `'^17.7.0 || ^18.0.0'` loads on protocol 18 instead of being refused as incompatible
  
  Clause-②: no
  
  - **What was wrong.** `rangeAdmitsMajor` had no branch for `||`. A union reached the caret branch and was read as a caret on its first alternative, so `'^17.7.0 || ^18.0.0'` answered `OS_PROTOCOL_INCOMPATIBLE` on protocol 18. Every door that runs the ADR-0087 D1 handshake refused it: `sys_packages` boot rehydration, the marketplace install-local POST and rehydrate, and `protocol.installPackage`.
  - **What it does now.** A union admits a major when any alternative admits it. When none does and any alternative is unrecognized (an empty one included, `'^17 ||'`), the union answers `unparsed-range`: the package loads with the existing `[protocol]` warning and is never refused. A union whose every alternative refuses is refused as before. Each alternative is read with the unchanged single-range grammar (caret, tilde, hyphen, comparators, `x`, `*`), so a range without `||` reads exactly as it did.
  - **The refusal's `targetMajor`.** For a refused union it is the lowest alternative's major, whatever order the alternatives are written in, so `'^17 || ^16'` and `'^16 || ^17'` both name `objectstack migrate meta --from 16`. It used to read the first alternative.
  - **The artifact forward-conversion floor.** `parseRangeFloor` reads a union's floor as its lowest alternative's (`'^18.0.0 || ^17.1.0'` → `17.1.0`, as for `'^17.1.0 || ^18.0.0'`), and `null` when an alternative is unreadable. It used to read the first alternative, so a union written high-first opened a narrower conversion window than the same range written low-first.
- Updated dependencies [b15f8a1]
- Updated dependencies [4216796]
- Updated dependencies [c40a0dd]
- Updated dependencies [60f9baf]
- Updated dependencies [3fed1eb]
- Updated dependencies [a35f7a6]
- Updated dependencies [f606ba2]
- Updated dependencies [105902f]
- Updated dependencies [f901746]
- Updated dependencies [ee0e115]
- Updated dependencies [8684079]
- Updated dependencies [a69a40a]
- Updated dependencies [0a052e6]
- Updated dependencies [ae0ca66]
- Updated dependencies [23d0bc7]
- Updated dependencies [8776119]
- Updated dependencies [0a168a3]
- Updated dependencies [97b8e7a]
- Updated dependencies [af3873b]
- Updated dependencies [9cb9d95]
- Updated dependencies [f846cc2]
- Updated dependencies [1ecb08a]
- Updated dependencies [adad73f]
- Updated dependencies [6422da5]
- Updated dependencies [d0fe050]
- Updated dependencies [dd11563]
- Updated dependencies [2c702fd]
- Updated dependencies [92fd343]
- Updated dependencies [bbdfc05]
- Updated dependencies [d050a8f]
- Updated dependencies [d731b89]
- Updated dependencies [905f57b]
- Updated dependencies [66d2757]
- Updated dependencies [a65a59b]
- Updated dependencies [8a83ceb]
- Updated dependencies [462d02f]
- Updated dependencies [45e6001]
- Updated dependencies [9f024d8]
  - @objectstack/spec@18.0.0-next.3

## 18.0.0-next.2

### Minor Changes

- dd29bbe: feat(metadata-core,metadata-protocol)!: the `sys_metadata` family declares no organization column — `sys_metadata`, `sys_metadata_audit`, `sys_metadata_commit` and `sys_metadata_history` (ADR-0131 D6/D7)
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: registered sys-metadata-organization-column-retired, sys-metadata-audit-organization-column-retired, sys-metadata-commit-organization-column-retired, sys-metadata-history-organization-column-retired -->
  
  **BREAKING**, shipped as `minor` under the repo's launch-window convention for breaking changes.
  
  Metadata is the environment's (ADR-0131 D6). The four tables of the metadata family no longer declare `organization_id`, and each sets `systemFields.tenant: false`, so the engine injects none back. The engine refuses an undeclared field, so nothing reads or writes the column any more.
  
  FROM → TO:
  
  - An authored filter, list-view column, report grouping, formula or seed key naming `organization_id` on one of the four tables → delete it; no organization owns a row. The field resolver answers it as an unknown field.
  - `new SysMetadataRepository({ engine, organizationId, orgLabel })` → `new SysMetadataRepository({ engine, orgLabel })`. The `organizationId` option is gone: every repository reads and writes the environment's rows.
  - `DatabaseLoader`'s `organizationId` option (and so `MetadataManager.setDatabaseDriver` / `setDataEngine`'s `organizationId` argument) → accepted and ignored, like `environmentId`: no write stamps it and no read filters on it. Drop the argument.
  - `@objectstack/spec`: the published `ApiError.code` / `ErrorCode` enum widens by `LEGACY_ORGANIZATION_ROWS_UNREADABLE`, registered under `@objectstack/metadata-core`.
  - `isLegacyOrganizationRow(row)` (`@objectstack/metadata-core`) → `readLegacyOrganizationRows(driver, table?)`. The row-value test read a key the engine no longer returns, so it is removed. The new read answers from the physical column, through the table's driver (`engine.getDriverForObject`): id → organization, empty on a migrated or fresh database. A seam that cannot answer is refused (`LegacyOrganizationRowsUnreadable`), never read as "none".
  - An existing database → run `os migrate organization-ownership` (review its plan), then `os migrate organization-ownership --apply --plan-file FILE` with that plan file. The ceremony promotes or reports the legacy organization rows, then drops the physical column. Until it has run, the v18 runtime refuses to start against the database.
  
  The indexes are re-keyed with the column:
  
  - The overlay unique key is (`type`, `name`, `package_id`, `bundle_member`): the declared `idx_sys_metadata_overlay_active` and the runtime partial indexes of the same names. Removing the organization TIGHTENS uniqueness. On a database the ceremony has not cleared, two legacy organizations' rows, or an organization's row and the environment's, can share a key. There the runtime index migration keeps the previous index and names the duplicates (ADR-0120 D4); it never drops a row. `os migrate duplicates` and the boot report group by the same key.
  - `sys_metadata_history` is unique on (`event_seq`) and on (`type`, `name`, `version`). Its other indexes, and those of `sys_metadata_audit` and `sys_metadata_commit`, lose their organization prefix.
  - `idx_sys_metadata_org_type` is gone.
  
  What else changes:
  
  - The boot line `[metadata_org_scoped_unserved]` is gone with the column it read. A database still holding legacy organization rows is refused at boot instead, until the ceremony has run.
  - The package uninstall no longer removes a legacy organization's row of the package's name: no row carries an organization.
  - Who reads the family through the generic data door (`/data/sys_metadata_*`), before → after:
    - `sys_metadata_audit`, `sys_metadata_history`, `sys_metadata_commit`, **under a wall** (`isolated` / `group`): before, the tenant wall filtered each caller to its own organization's rows, and an `organization_admin` read its organization's. With the column gone the wall has nothing to filter on, so without a gate that admin would read every organization's trail, history bodies and commit ranges. After: each requires `studio.access` (`requiredPermissions`, the #22107 precedent). The capability is platform-scoped, so an `organization_admin` holding it by role does not exist, and that admin is refused.
    - The same three, **under `single`**: before, any caller whose grant covered the table (a read wildcard) read it. After: `studio.access` is required there too. A Studio author (the platform admin among them) reads as before; a plain member is refused.
    - Every `/meta` door serving these rows admits `studio.access`: `/meta/:type/:name/history`, `/audit` and `/diff` admit `studio.access` or `manage_metadata`, and `/packages/:id/commits` admits `studio.access` alone; `setup.access` alone is refused at all four. `requiredPermissions` is an AND-gate and cannot name an any-of set, and `setup.access` is held by organization admins, so it could not be the gate. A caller holding only `manage_metadata` therefore still reads the history and audit rows through `/meta`, but not the commit rows, and none of them through the data door.
    - `sys_metadata` stays ungated, before and after: its rows are what `/meta` already serves to every organization.
  - On a database the ceremony has not migrated (which `os serve` refuses, but every `os migrate` boot opens, the ceremony's own among them), the legacy organization rows are still told apart, off the physical column:
    - every read the metadata protocol makes of the family goes through one seam that leaves them out. That covers boot hydration; the `/meta` list, by-name, layered and draft-preview reads; the item lock (`_lock`) the reads report and the save and delete gates enforce; the package-less write and read address; and the package, commit, audit, history and diff reads. Two reads keep them on purpose and read the column themselves: `os migrate meta --stored` reports such a row, and the commit revert refuses a legacy commit by name. The authored hook and action binders leave them out too;
    - the metadata repository's write never resolves to one: before, a save of an address that only a legacy organization's row held rewrote that row in place (measured on the ceremony's template promotion). Now the write targets the environment's row, and with none it creates one, which the re-keyed unique index refuses beside the organization's row until the ceremony settles it;
    - `os migrate meta --stored` reports such a row `skipped` and never re-saves it;
    - `os migrate security-catalog-overlays` neither lists nor deletes it;
    - a commit recorded in a legacy organization's layer is still refused by the revert;
    - the runtime-datasource reads, the packaged permission-set overlay reading, the kernel:ready security-catalog echo, the stored flow-credential move and a `DatabaseLoader` (engine- or driver-backed) leave them out.
  - `SqlDriver.listPhysicalColumns(object, options?)` (new, read-only): a table's physical column names, from the catalog, joining `options.transaction`. `TursoDriver`'s remote face answers it from the remote catalog. Every boot asks whether the family still carries the retired column, and it asks this way, not through `execute()`. So `os migrate plan` keeps its "a plan writes nothing" line on a migrated or fresh database. The legacy rows themselves are read with a raw statement only where the column exists.
  - `GET /forms/:slug` and `POST /forms/:slug/submit` no longer read the Default Organization's legacy layer. Every metadata read is now environment → code. The doors judge each candidate against the environment's view list, which holds one item per package of a view name. So a withdrawal in one package still closes that name's form in every package. On a deployment with no organization this closes more than before, which is the fail-closed direction. A withdrawal saved only at the organization layer is carried onto the environment by the ceremony's `metadata-promotion` step, which the runtime requires before it starts.
  - The protocol's `getMetaItems` drops its undocumented `legacyFormOrganizationId` request key. It was never in the spec's `GetMetaItemsRequest`, and only those doors passed it. A caller that still passes it now gets the environment's list.
- c2bb302: fix(cli): `os migrate organization-ownership` reads its SQL dialect once, through the driver resolver it shares with metadata-core, and refuses an unresolved dialect before any statement, naming the driver, with no SQLite default left
  
  Clause-②: yes (widening)
  
  **Who this is for.** An operator who runs the organization-ownership ceremony (plan or `--apply`) on a PostgreSQL or MySQL database whose driver's knex `config.client` is a client CLASS (knex's bring-your-own-dialect hatch) or a client string the ceremony does not recognise.
  
  **FROM.** Both arms took the dialect from `String(config.client)` alone, with a reader of their own.
  
  - Such a run was refused (`driver-unsupported`, exit 1) by the plan step, which runs first. A client class was stringified, so the refusal printed the class's source text in place of the driver's name.
  - The apply step and its template lookup each carried a `'sqlite'` default for an unresolved dialect. Neither was reachable, only because the plan step had already refused.
  
  **TO.** The dialect is resolved once, from the stack's driver, before either arm runs a statement. The resolver is the one metadata-core's legacy-row reader uses: the driver's `dialectName` first, then a recognised `config.client` string.
  
  - Refused: a client class with no recognised `dialectName`, an unrecognised client string, `dialectName: 'unknown'` (what `SqlDriver` answers for either), and a driver with no dialect at all. Each gets `driver-unsupported`, exit 1, with no statement run and no plan file written. The refusal names the driver: its name, its `dialectName`, and its client string or client class name.
  - No `'sqlite'` default remains. The plan and the apply take the resolved dialect and never re-derive it.
  - The plan file's `client` field records the client only when it is a string.
  
  Measured on each in-repo SQL driver: `SqlDriver` on better-sqlite3, pg and mysql2, and `TursoDriver`, resolve to the dialect they did before.
  
  **metadata-core.** `dialectOfDriver(driver)` is exported. It is the one resolver behind `readLegacyOrganizationRows`, and answers:
  
  - `'sqlite' | 'postgres' | 'mysql'`;
  - `'none'` for a driver that is not a SQL driver;
  - `'unresolved'` otherwise.
  
  A `dialectName` string is the whole answer, recognised or not. A `config.client` is read only when there is no `dialectName`, and only as a string.

### Patch Changes

- Updated dependencies [0d3ea29]
- Updated dependencies [f9b4217]
- Updated dependencies [87d0619]
- Updated dependencies [4e0838d]
- Updated dependencies [584e737]
- Updated dependencies [301eec6]
- Updated dependencies [5547ad4]
- Updated dependencies [0f05907]
- Updated dependencies [b1e9280]
- Updated dependencies [05ab9ef]
- Updated dependencies [1d79556]
- Updated dependencies [07b27b3]
- Updated dependencies [d0c09e4]
- Updated dependencies [1692cd1]
- Updated dependencies [73c7dc4]
- Updated dependencies [8693110]
- Updated dependencies [ad5a7d7]
- Updated dependencies [dd29bbe]
- Updated dependencies [dd29bbe]
- Updated dependencies [6f21216]
- Updated dependencies [2372e0a]
- Updated dependencies [5afa1e0]
- Updated dependencies [56b2612]
- Updated dependencies [1418de4]
- Updated dependencies [7a96bf8]
- Updated dependencies [5fd2c76]
- Updated dependencies [be48c5e]
- Updated dependencies [57994c3]
- Updated dependencies [23e689d]
- Updated dependencies [bc0538a]
- Updated dependencies [d176b0a]
- Updated dependencies [c5dd7fc]
- Updated dependencies [4feb2d0]
- Updated dependencies [1ac24f2]
- Updated dependencies [462dff3]
- Updated dependencies [c03077e]
- Updated dependencies [069fd40]
- Updated dependencies [941c78a]
  - @objectstack/spec@18.0.0-next.2

## 18.0.0-next.1

### Minor Changes

- 430e5f5: fix(security)!: under a walled posture every environment-metadata write is the platform operator's, whatever its type (ADR-0131 D12 items 7–8, D11)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered walled-environment-metadata-writes-retired -->
  
  **BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes. ADR-0131 D12 item 7: a walled deployment is "one environment, one schema, one catalog … The metadata-authoring capability (`manage_metadata` / `studio.access`) is what headquarters IT holds and plant admins do not." Item 8: a plant "cannot create a position, a permission set, a capability, a template or any metadata … A plant that needs its own catalog is given its own environment." D11: the rules are identical in every posture; only whether the wall is enforced differs.
  
  **Why.** The environment definition ledger carries no organization column, so a write lands for every organization. Measured on booted `isolated` and `group` stacks before this change: an organization owner granted `manage_metadata` inside their own organization created an object, a view and a flow at `/api/v1/meta`, edited, published, rolled back and reset the operator's view, ran `POST /api/v1/meta/_migrate-stored`, passed all thirteen `/api/v1/packages` write doors, installed, upgraded and uninstalled packages through `install-local`, and created a flow at `/api/v1/automation`, each with `2xx`; another organization's owner read every result. The security catalog was refused at these doors already; every other type was not.
  
  **FROM → TO**, on a `group` or `isolated` deployment, for a caller below the platform operator (the `PLATFORM_ADMIN` rung: the deployment's declared `OS_PLATFORM_OWNER_EMAIL` owner):
  
  - `PUT`, `DELETE`, `POST …/publish` and `POST …/rollback` of `/api/v1/meta/:type/:name` on `@objectstack/rest`, and `PUT /meta/:type/:name` on the runtime dispatcher, for a type outside the security catalog (`object`, `view`, `flow`, `app`, `dashboard`, `translation` and every other type): **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN` (the dispatcher answers `403 PERMISSION_DENIED`).
  - Every `/api/v1/packages` write on the runtime dispatcher — create, the manifest `PATCH`, enable, disable, publish, publish-drafts, discard-drafts, revert, rollback, `commits/:commitId/revert`, duplicate, adopt-orphans and delete — for a package carrying no position, permission set or capability: **FROM** admitted to any `manage_metadata` holder **TO** `403 PERMISSION_DENIED`, before anything is read or written. The refusal no longer reads the package's items.
  - `POST /api/v1/marketplace/install-local` (install and upgrade) and `DELETE /api/v1/marketplace/install-local/:id` (uninstall) on `@objectstack/cloud-connection`, for a package carrying no catalog item: **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN`. The refusal's `error.details` no longer carries `catalogItems`; it carries `manifestId`.
  - `POST /api/v1/automation`, `PUT /api/v1/automation/:name`, `DELETE /api/v1/automation/:name` and `POST /api/v1/automation/:name/clone`: **FROM** admitted to any `manage_metadata` holder **TO** `403 PERMISSION_DENIED`, before the automation service is touched.
  - `POST /api/v1/meta/_migrate-stored`, the install-wide rewrite of the stored metadata, preview and apply alike: **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN` on `@objectstack/rest` and `403 PERMISSION_DENIED` on the runtime dispatcher, before a row is read.
  - Every one of these refusals carries one sentence: it names the written type (`a package` at the package doors, `the environment's stored metadata` at the rewrite), the posture and "ADR-0131 D3, D12 items 7–8, D11", and points at an environment of the organization's own. The catalog refusals that shipped before keep their envelopes and now read the same sentence.
  - The activation refusals under a wall (`POST /api/v1/automation/:name/toggle`, `POST /api/v1/actions/_activation/…`, `POST /api/v1/security/_activation/permission/…`) no longer recommend cloning a flow or a permission set, or authoring a sibling action, since those writes are the operator's under a wall too; they name the platform operator.
  
  **Unchanged.** Reads. Assignments: `sys_user_position` and `sys_user_permission_set` rows stay organization rows. The platform operator and the engine's own writes (seeders, installers, migrations) write as before. Under `single` (and with no `tenancy` service), a `manage_metadata` holder writes exactly as before.
  
  **The remedy.** The platform operator authors the environment's metadata, in Studio or through a managed package; an organization that needs metadata of its own is given an environment of its own. `@objectstack/spec` registers the change as the ADR-0087 semantic entry `walled-environment-metadata-writes-retired`. `walledCatalogWriteVerdict` (`@objectstack/metadata-core`) now judges every type alike: a custom door that writes environment metadata asks it after its capability gate, with no `isSecurityCatalogType` pre-filter.

### Patch Changes

- Updated dependencies [dac99c2]
- Updated dependencies [66949b7]
- Updated dependencies [7958bdf]
- Updated dependencies [777eed2]
- Updated dependencies [5f37d36]
- Updated dependencies [1912af4]
- Updated dependencies [76815b9]
- Updated dependencies [4d1e4a8]
- Updated dependencies [4cc3ff9]
- Updated dependencies [c056979]
- Updated dependencies [4f68ba1]
- Updated dependencies [107853c]
- Updated dependencies [543b33d]
- Updated dependencies [b529a5c]
- Updated dependencies [1623faf]
- Updated dependencies [b4d573a]
- Updated dependencies [c857a93]
- Updated dependencies [345d1be]
- Updated dependencies [430e5f5]
- Updated dependencies [14a13bc]
- Updated dependencies [ca0bdbc]
- Updated dependencies [572ecfb]
- Updated dependencies [707b3cd]
- Updated dependencies [6673c80]
- Updated dependencies [5e725b8]
- Updated dependencies [eeb95f7]
- Updated dependencies [d89f491]
- Updated dependencies [dc39326]
- Updated dependencies [775ed65]
- Updated dependencies [e4ec6ec]
- Updated dependencies [325a92e]
  - @objectstack/spec@18.0.0-next.1

## 18.0.0-next.0

### Minor Changes

- 06cc45d: Under a walled posture the security catalog is the platform operator's: tenants are refused creating, changing or deleting positions, permission sets and capabilities, and may only assign them
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: registered walled-catalog-tenant-writes-retired -->
  
  **BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D3: "Shared-DB multi-tenant (`group` / `isolated`): tenant admins cannot create or edit catalog items; the operator defines the catalog for every tenant … Creation through Setup or the API is refused with a message naming the posture and the capability.").
  
  **Why.** The catalog is environment-level, and every organization resolves it by name. Measured on a booted `isolated` and `group` stack: an organization owner granted `manage_metadata` inside their own organization saved `PUT /meta/permission/:name` over a permission set another organization's member holds, and that member's next resolution carried the change. One organization's write changed what another organization's members resolve.
  
  **FROM → TO**, on a `group` or `isolated` deployment, for a caller below the platform operator (the `PLATFORM_ADMIN` rung: the deployment's declared `OS_PLATFORM_OWNER_EMAIL` owner):
  
  - `PUT /meta/:type/:name`, `DELETE /meta/:type/:name`, `POST /meta/:type/:name/publish` and `POST /meta/:type/:name/rollback` on `@objectstack/rest`, and `PUT /meta/:type/:name` on the runtime dispatcher, for `position` or `permission`: **FROM** admitted to any `manage_metadata` holder **TO** `403 FORBIDDEN` (the dispatcher's `PUT` answers `403 PERMISSION_DENIED`). The message names the posture and the capability.
  - The same doors for `capability`: admitted where they were admitted. `capability` is a code-only type, so these doors already refused its writes before this change; only the sentence the caller reads changes, to the posture refusal. For `capability`, the accept set narrows at the data door on `sys_capability`, below.
  - `POST /security/permission-sets/:name/clone` (the permission-set clone door): **FROM** admitted to any `manage_metadata` holder **TO** `403 PERMISSION_DENIED`, before the source is read.
  - A data-door insert, update or delete on `sys_position`, `sys_permission_set` or `sys_capability`: **FROM** admitted to any caller whose grants admit the table (a `sys_permission_set` create landed in the environment ledger; a `sys_position` create landed as an organization row with no definition) **TO** `403 PERMISSION_DENIED`, before anything is written. This includes an ADR-0090 D12 delegate whose `adminScope` carries `authorEnvironmentSets`: under a wall it can no longer author environment permission sets at the data door. Its assignment and binding paths are untouched.
  
  **Unchanged.** Assignments: `sys_user_position` and `sys_user_permission_set` rows stay organization rows that an organization's administrators write for their own members. The platform operator and the engine's own writes (seeders, installers, migrations) write the catalog as before. Every other metadata type is untouched. Under `single` (and with no `tenancy` service), catalog writes stay with `manage_metadata` holders, exactly as before. The catalog activation door already required the platform operator under a wall.
  
  **The remedy.** A tenant that needs a position or permission set asks the platform operator to define it in Studio, or through a managed package. The tenant's administrators then assign it to their members. `@objectstack/spec` registers the change as the ADR-0087 semantic entry `walled-catalog-tenant-writes-retired`. `@objectstack/metadata-core` exports the one predicate every door asks, `walledCatalogWriteVerdict`, beside `isSecurityCatalogType`, `SECURITY_CATALOG_TYPES` and `PLATFORM_OPERATOR_POSTURE`. A custom door that writes catalog items asks it after `metaWriteCapabilityVerdict`.
- 7895671: feat(metadata-core,rest,runtime,plugin-email,spec)!: the `/meta` doors carry no organization; organization-admin metadata authoring closes and `manage_org_presentation` retires (ADR-0131 D6)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered manage-org-presentation-retired, meta-doors-organization-scope-retired -->
  
  **BREAKING**, graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N`.
  
  ADR-0131 D6 retires the per-organization overlay axis: environment metadata written by Studio belongs to the whole deployment. The `/meta` doors of both transports (`@objectstack/rest` and the runtime dispatcher's `/meta` branch) used to thread the caller's active organization into writes and reads of the five `allowOrgOverride: true` types (`view`, `dashboard`, `report`, `translation`, `email_template`). They no longer do, for any type, and the read and the write flip together.
  
  **What changes.**
  
  - **Writes land environment-wide.** `PUT`, `DELETE`, `POST …/publish` and `POST …/rollback` on `/api/v1/meta/:type/:name` hand the protocol no organization, so the row and its audit and history rows carry `organization_id` NULL, whatever the caller's active organization.
  - **Reads are environment → code.** The item read (both cache arms), the list, the layered view (`/layers` and `?layers=true`), `/published`, `?state=draft`, `GET /meta/_drafts`, `/history`, `/diff`, `/audit` (the environment rows, `organizationId: null`), `GET /meta/diagnostics` and `/references` name no organization.
  - **An organization admin's metadata write is refused.** `metaWriteCapabilityVerdict` admits `isSystem` or `manage_metadata` only. A caller holding `manage_org_presentation` and not `manage_metadata` is answered `403` on all four item doors (`FORBIDDEN` on REST, `PERMISSION_DENIED` on the dispatcher) with `… requires the \`manage_metadata\` capability.`, for every type and whatever its active organization.
  - **`manage_org_presentation` retires** from `PLATFORM_CAPABILITIES` (`@objectstack/spec/security`). A permission set naming it still parses and loads, and its other grants still apply; the grant itself admits nothing. The `sys_capability` row seeded for it earlier is not pruned (the seeder upserts only); an operator may delete it in Setup.
  - **The email-template boot sweep** (`@objectstack/plugin-email`) reads the effective templates environment → code, as the door serves them; it no longer reads in the Default Organization.
  
  **What moves for consumers.**
  
  - FROM `import { organizationIdForMetaWrite } from '@objectstack/metadata-core'` TO nothing: a `/meta` write carries no organization. Delete the call and the `organizationId` it fed.
  - FROM `import { ORG_PRESENTATION_AUTHORING_CAPABILITY } from '@objectstack/metadata-core'` TO nothing: delete the import.
  - FROM `metaWriteCapabilityVerdict({ isSystem, systemPermissions, canonicalType, activeOrganizationId, operation })` TO `metaWriteCapabilityVerdict({ isSystem, systemPermissions, operation })`: drop the two members.
  - FROM `import { metaReadOrganizationId } from '@objectstack/rest'` TO nothing: a `/meta` read carries no organization. `metaCallerOrganizationId` stays.
  - FROM `bootstrapEffectiveEmailTemplates(engine, metadataService, { protocol, tenancy })` TO `{ protocol }`: the `tenancy` source is gone.
  - A permission set granting `manage_org_presentation`: grant `manage_metadata` to whoever must author those five types, and delete the stale grant.
  
  **What a deployment observes.** An overlay row an earlier release stored under an organization stays in `sys_metadata` untouched, and is no longer served by any `/meta` read or projected by the email-template sweep until the promotion ceremony (ADR-0131 C7) carries it to the environment layer. Under the `single` posture that is every earlier Studio save of the five types, because it was filed under the Default Organization: on the `/meta` doors such an edit reads as reverted to the environment or code definition. Re-save the item in Studio to make the edit live on the `/meta` doors now. Public forms are the exception: until that ceremony the anonymous form doors read a form `view` in the Default Organization and prefer its overlay for the form's body, while a withdrawal in either layer closes the form, fail-closed. So a legacy organization overlay of a public form keeps serving its body there: a Studio re-save of that body (an environment row) does not change the body the public form serves, and a Studio withdrawal (an environment row) still closes it.
  
  **What does not change.** Saves of every other type were already environment-wide. Flow saves, the capability gate's answer for `manage_metadata` holders and `isSystem`, the protocol's own organization-scoped refusals, and the `/packages` doors are untouched by this change.
- c8b062f: feat(metadata-protocol,metadata-core,objectql,rest,plugin-security,spec)!: every metadata read is environment → code; legacy organization rows and overlays of sealed managed content are reported at boot, not served (ADR-0131 D6)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered metadata-read-organization-scope-retired -->
  
  **BREAKING (narrowing).** No read that is refused today is admitted. Graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N`.
  
  ADR-0131 D6 retires the per-organization overlay axis. The doors carry no organization and the protocol refuses every organization-scoped write; now every protocol read is environment → code as well.
  
  **What changes.**
  
  - The item, list, layered, cached (ETag), history, diff, audit, drafts and commit-timeline reads, the `_lock` gate's overlay layer, search's page sweep, diagnostics and references serve the environment's stored row, else the code packages' definition — whatever organization a caller names. A row stored organization-scoped by an earlier release is served by no read and loaded by no boot.
  - `overlayScope` on the layered read is `'env'` or `null`; `'org'` is gone.
  - `listDrafts` lists the environment's drafts only, and its rows carry no `organizationId`.
  - `listCommits` lists the environment's commits only, for every caller: a legacy organization commit is not shown, so an operator on the packages door no longer sees every organization's legacy commits, and a rollback plan never contains one.
  - [Triage ruling Q1 → C] An environment row that overlays an item a managed package ships, on a type sealed against overlays (any type whose registry entry admits no overlay — a managed flow, action, hook, object or datasource, for example — written through the `OS_METADATA_WRITABLE` hatch before the seal), is not served: the package's definition is. An `object` such row is not loaded at boot either, so the engine keeps the packaged schema. A stored fork of a code-declared permission set keeps its own ruling instead: the reads do not decline it, a cold boot refuses a deployment that holds one (ADR-0048), and the offline `os migrate security-catalog-overlays` removes it.
  - `@objectstack/objectql` binds the environment's authored hook and action rows only; a legacy organization-scoped hook or action row is no longer bound.
  - Boot names both populations, once each: `[metadata_org_scoped_unserved]` lists every legacy organization row per type (active and draft), plus the legacy rows of `sys_metadata_commit`, `sys_metadata_history` and `sys_metadata_audit`, and names the v18 migration ceremony (`os migrate`, ADR-0131 D10) that carries them; `[metadata_sealed_overlay_unserved]` lists the sealed overlays per type with the two remedies. Nothing is deleted or rewritten.
  - The anonymous public-form doors keep reading the Default Organization's legacy `view` layer, fail-closed, until that ceremony (triage ruling Q3 A) — through the protocol-internal `legacyFormOrganizationId` key, which no spec request declares and which the protocol honours for `view` alone.
  - The seed loader's refusal of an unowned record now prescribes `organization_id` on the record first: a seed published through a package carries no caller organization.
  
  **What moves for consumers.**
  
  | From | To |
  |:--|:--|
  | `organizationId` on a `GetMetaItems` / `GetMetaItem` / `GetMetaItemLayered` / `AuditMetaItem` / `HistoryMetaItem` / `GetMetaItemCached` request (`@objectstack/spec`) | drop it: the read is the environment's. The key is stripped at a spec parse (the schemas are not strict) and no longer type-checks |
  | `organizationId` on a `listDrafts` / `listCommits` / `diffMetaItem` / `getMetaDiagnostics` / `findReferencesToMeta` request (`@objectstack/metadata-protocol`) | drop it |
  | `ListDraftsResponse` draft `organizationId` | gone: every listed draft is the environment's |
  | `SysMetadataRepository.listDrafts` row `organizationId` (`@objectstack/metadata-protocol`) | gone: every listed row is an environment draft, whichever repository asks |
  | `overlayScope: 'org'` (`GetMetaItemLayeredResponse`) | only `'env'` or `null` |
  | `declaresOrgOverride`, `organizationIdForMetaRead` (`@objectstack/metadata-core`) | removed — no read takes an organization. Read `allowOrgOverride` off `DEFAULT_METADATA_TYPE_REGISTRY` where a type's overlay channel is the question |
  | `MetadataAuthoringGateContext.organizationId` (`@objectstack/metadata-protocol`) | removed — no write is organization-scoped, and no gate read it |
  | `organizationId` on `projectPermissionMutation`'s `evt` (`@objectstack/plugin-security`) | drop it: the projection reads the environment → code layered read, whatever organization the event names |
  | a legacy organization-scoped `sys_metadata` row a deployment relied on | re-save the item in Studio to make it environment-wide now, or wait for the v18 migration ceremony, which promotes it |
  | an environment overlay of a managed item on a sealed type (flow, action, hook, object, datasource …) | re-express the change as a new item under a new name (a linkage-free clone), then delete the stored row; or delete the row |
  
  **What does not change.** No stored row is deleted, rewritten or migrated. The anonymous form doors' read of organization-layer withdrawals is unchanged.
- 117d34d: feat(metadata-core,metadata-protocol,metadata,platform-objects,spec)!: `sys_view_definition` retires as inert (ADR-0131 D13)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered sys-view-definition-retired -->
  
  **BREAKING**, graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N` like every other stage.
  
  `sys_view_definition` was declared for runtime-authored shared and personal views (ADR-0017) and never used for them: no framework code writes or reads its rows, and the Studio console's view doors write the ADR-0005 `view` overlay in `sys_metadata` through the metadata API. ADR-0131 D13 retires it. A runtime-authored view is a `view` metadata item, written through `PUT /api/v1/meta/view/<name>` (the client's `meta.saveItem` for type `view`); nothing about that path changes.
  
  **What moves for consumers.**
  
  - **The object.** FROM `import { SysViewDefinitionObject } from '@objectstack/metadata-core'` (or from `@objectstack/platform-objects`, or its `/metadata` subpath) TO nothing: delete the import. Neither `MetadataPlugin` nor the metadata protocol assembly registers the object any more, so the generic data door no longer serves it.
  - **The migration exports** of `@objectstack/metadata-protocol`. FROM `ensureViewDefinitionActiveIndex`, `resolveIndexExec`, `buildActiveIndexSql`, `VIEW_DEFINITION_TABLE`, `VIEW_ACTIVE_INDEX_NAME`, `VIEW_ACTIVE_PROBE_INDEX_NAME`, `VIEW_ACTIVE_INDEX_COLUMNS`, `EnsureViewIndexLogger`, `EnsureViewIndexStatus` and `EnsureViewIndexResult` TO nothing: delete the import. `classifyIndexFailure` and the `IndexExec` type are still exported, unchanged, from the shared index-migration module.
  - **The name.** `PLATFORM_OBJECTS_BY_PACKAGE['metadata-core']` (`@objectstack/spec/system`) lists four objects, and `isPlatformProvidedObjectName` answers `false` for `sys_view_definition`. A stack that names it (a lookup target, a flow trigger, a permission entry, a platform-global declaration) is now flagged as naming an unknown object: remove the reference.
  - **`os migrate duplicates`.** `runtimeIndexPreflight` carries three entries (the two `sys_metadata` overlay indexes and `sys_setting`'s row identity), with no `idx_sys_view_def_active` entry. A serving boot no longer runs the active-row index migration for the table, and no longer logs its `sys_view_definition active-row index` lines.
  - **Translations.** The platform translation bundles no longer carry `sys_view_definition` keys.
  
  **Existing databases.** Schema sync is additive and never drops a table, so a database an earlier release provisioned keeps `sys_view_definition`, with any rows a caller wrote through the generic data door; nothing reads them. `os migrate apply --allow-destructive` does not drop it either, because it reconciles declared objects only (measured on one database: it dropped an orphaned column of a declared table and left this table and its row in place). On a project with a host config, `os migrate plan` lists it among the platform-prefixed tables nothing declares. Export any row worth keeping; dropping the table is the operator's call, by hand: `DROP TABLE sys_view_definition`.
- f4069c5: fix(metadata): the object read's `sortability` follows the caller's field permission for every caller class
  
  Clause-②: yes (widening)
  
  - **What was wrong.** ADR-0106 D4 serves a caller holding `manage_metadata`, `studio.access` or `setup.access` (a platform admin, and an organization admin through `setup.access`) the object schema UNMASKED, because Studio and Setup authoring need the whole definition. The `sortability` projection served beside it on `GET /meta/object/:name` (and the runtime dispatcher's `/metadata/object/:name`) was derived from that unmasked document, so it marked a field `sortable: true` that the same caller's field permission marks unreadable, while the data route refuses a sort or filter on that field with `403 PERMISSION_DENIED`. A client building its sort picker from the projection offered a click the server refuses.
  - **What changes.** `sortability` is now derived from the caller's runtime view: the served document for every caller the mask projects (unchanged), and for a D4-exempt caller the fields their own field permission reads. The definition (`item.fields`) is unchanged for every class: whole for an exempt caller, masked for everyone else. The data route and `/auth/me/permissions` are unchanged.
  - **Caching.** On the cached `GET /meta/object/:name` branch an exempt caller's ETag folds a fingerprint of the fields withheld from their projection, and the conditional request is judged after it is folded. An exempt caller whose permission withholds nothing keeps the byte-identical ETag. An exempt caller and a projected caller denied the same field never share a validator.
  - **Failure posture.** The exempt caller's field permission is asked lazily, only by the item read that serves `sortability`, and never turns their definition read into a fault: if the security service throws or cannot answer, `sortability` is derived from the served document as before, with one `warn`.
  - **New in `@objectstack/metadata-core`.** `resolveObjectSchemaRuntimeView(document, posture)` returns `{ document, withheld, fingerprint }`, the view the runtime projections beside an object schema are derived from. The types `ObjectSchemaRuntimeView` and `ObjectSchemaRuntimeFieldPosture` are exported with it, and the `passthrough` member of `ObjectSchemaMaskPosture` gains an optional `runtime` (set on an `exempt` posture for a capability-exempt caller in a deployment with a `security` service).
  - **New in `@objectstack/rest`.** `translateMetaEnvelope` takes an optional fifth argument, `runtimeDocument` (default: the served document), and `MetaItemAnswerSources.translateEnvelope` an optional third. Nothing is removed, renamed or narrowed.
- 8532783: feat(service-datasource,metadata-core)!: the datasource-admin plugin reads the environment's stored `datasource` rows only; a legacy organization-scoped row is neither loaded at boot nor served (ADR-0131 D6)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (already-registered metadata-read-organization-scope-retired) That entry retires every metadata read of a row stored organization-scoped, the boot hydration included, and states that such a row is served by no read and loaded by no boot. This changeset carries the same rule to the datasource-admin plugin's own reads of sys_metadata: no key, export or stored shape is removed, renamed or re-shaped, and nothing is rewritten. -->
  
  **BREAKING (narrowing).** Graded `minor` on the v18 prerelease line, as the read narrowing it completes.
  
  **What changes.** `DatasourceAdminServicePlugin` reads stored `datasource` rows in five places — the boot restore (`restoreRuntimeDatasources`), the by-name read behind cluster convergence and the `/meta` door's datasource projection, and the existence probes behind its own create, update and remove. Each now reads the environment's rows only, judged by the same row-value test the metadata reads apply. A row stored organization-scoped by an earlier release:
  
  - is no longer registered at boot, so the datasource-admin door and the metadata read door no longer serve it, and no live pool is opened from it;
  - is never updated or deleted by an admin create, update or remove under its name — those write and remove an environment row of their own;
  - stays at rest, and the boot report `[metadata_org_scoped_unserved]` keeps naming it. Nothing is deleted or rewritten; the v18 migration ceremony (`os migrate`, ADR-0131 D10) carries it.
  
  **What moves for consumers.**
  
  | From | To |
  |:--|:--|
  | a legacy organization-scoped runtime datasource a deployment relied on | re-create it through the datasource-admin door or save it through the `/meta` door to make it environment-wide now, or wait for the v18 migration ceremony |
  
  `@objectstack/metadata-core` exports `isLegacyOrganizationRow`, the one row-value test for such a row; `@objectstack/objectql`'s authored hook and action binders now read it from there, with no change in what they bind.
- 58f5c90: fix(metadata-core): an artifact declaring `engines.protocol: '^18'` that was built during the v18 prerelease boots on a later runtime that retired one of its shapes — the artifact door replays every retired conversion of protocol 18's step for a floor of `18.0.0`
  
  Clause-②: yes
  
  **What an operator saw.** A compiled artifact (`os build` → `dist/objectstack.json`) that declares `engines.protocol: '^18'` and was built before a protocol-18 retirement landed carries the retired shape, for example a defaulted key that every earlier parse emitted. Booted on a runtime that enforces the retirement, the metadata plugin's startup refused it at the strict parse and the boot rolled back. The artifact door compared the floor `18.0.0` with each retirement's `retiredAfter` stamp, and every retirement that lands during the v18 prerelease is stamped with the last 17.x release, below that floor, so nothing was replayed.
  
  **What an operator sees now.** The same artifact boots. One warning per conversion names it and its site count: `[MetadataPlugin] artifact 'LABEL' declares the first release of protocol 18 (authored engines.protocol floor 18.0.0), which a build from any 18.0.0 prerelease declares too, so it may predate retirements in the conversion step into protocol 18 that this runtime enforces (runtime spec VERSION) — converted N site(s) forward via ADR-0087 conversion 'ID' …`. The artifact file itself is unchanged, so it converts again on every boot until it is rebuilt with `os build`. An artifact built after the retirement boots exactly as before: the replay finds nothing to convert, and nothing is logged.
  
  - **`@objectstack/metadata-core`.** `applyArtifactForwardConversions` opens its window on a third condition. A declared floor of `M.0.0` at or above the runtime label replays every retired entry whose `toMajor` is `M`, except the default flips the door already refuses. An artifact cannot say which of those entries it predates: it carries no field naming the spec or CLI that built it. Each entry rewrites only its own old shape, so the replay changes nothing in an artifact that lacks that shape. `ArtifactForwardConversionVerdict` gains `'converted-major-step'`, so a consumer that switches exhaustively over the verdict adds that arm. `replayedRetirements` still lists only the entries the per-entry rule opened. The rule holds for every 18.0.0 prerelease label and at 18.0.0 itself. From 18.0.1 on, the label half replays the whole chain for such an artifact, as before.
  - **`@objectstack/metadata`.** The artifact door places the new verdict on the open side of its window table and gives it its own clause, so the summary never claims that a `^18` artifact "predates" a runtime labelled below it. The bare-root form-predicate notice uses the same window.
  
  **Unchanged.** The protocol handshake still refuses a `^17` artifact on a protocol-18 runtime and prescribes `objectstack migrate meta --from 17`. A floor above `M.0.0` (such as `^18.0.1`) and a 17.x floor keep their previous verdicts.

### Patch Changes

- 56c8844: `@objectstack/spec/ui` now exports the rule that decides which forms a `view` body opens to anonymous intake, so a console reads "published" from the same rule the server's anonymous form doors serve
  
  Clause-②: yes (widening)
  
  - **New on `@objectstack/spec/ui`:** `publicFormSlug`, `anonymousFormIntakeSlug`, `anonymousFormIntakeCandidates`, `anonymousFormIntakeSlugs` and the `AnonymousFormIntakeCandidate` type. They lived only in `@objectstack/metadata-core`, which a browser console should not depend on. They are pure functions with no imports, beside the `SharingConfigSchema` they read.
  - **What they decide is unchanged.** A form is open when its `sharing` has `enabled === true`, `allowAnonymous === true` and a non-empty `publicLink`. The scan covers the same three shapes in the same order: the nested `form`, every `formViews` entry, then the `config` of a `viewKind: 'form'` item.
  - **`@objectstack/metadata-core` re-exports the same functions** from `@objectstack/spec/ui`. They are the spec's own bindings, not wrappers or copies, so there is still one copy of the rule. Its exports, names and types are unchanged, and `@objectstack/rest` and `@objectstack/metadata-protocol` keep importing from it. Its built output now loads `@objectstack/spec/ui` to get them.
  - **Not covered by the new export:** whether another metadata layer withdraws a form (`anonymousFormIntakeWithdrawnIn`), and whether the deployment's tenancy posture lets the form take an anonymous submission (`anonymousFormIntakeUnavailability`). These two read server state and stay in `@objectstack/metadata-core`. `anonymousFormObjectName`, which names the object a form submits into, stays there beside them; it is a pure read of the form and the view, not of server state. A form the new functions call open can still be withheld by a withdrawal in another layer or by the posture.
- 3d886ee: A field can declare cell formatting rules: `conditionalFormatting: [{ condition, style }]`, the rule a list view already declares for its rows
  
  Clause-②: yes (widening)
  
  - **`FieldSchema.conditionalFormatting`** (optional) is an ordered list of `{ condition, style }` rules. The first rule whose CEL `condition` holds applies its CSS `style` map to that field's cell, wherever the field renders. A list view's row rules still style the row, and both may apply to one record. Example: `amount: Field.currency({ conditionalFormatting: [{ condition: P\`value < 0\`, style: { color: '#b91c1c' } }] })`.
  - **One rule element, no second style vocabulary.** The `{ condition, style }` element moved out of `ListViewSchema` into its own spec module, and both `ListViewSchema.conditionalFormatting` and `FieldSchema.conditionalFormatting` mount it. The list view accepts exactly what it accepted before. Its refusal of an unknown rule key now reads the same on both members: for a `color` written beside `style`, it says to put the colour in `style` first, then points a list view at `rowColor`.
  - **The scope is `value` and `record`.** `value` is this field's value on the record and `record` is the row. `@objectstack/lint` judges each condition at `objectstack build`, `objectstack validate` and the object save: it must parse, read fields as `record.<field>`, name declared fields, and read no other root (`previous`, `parent` and the user roots are refused, naming the field and the rule).
  - **For presentation only.** Use it for rules that carry no meaning of their own, such as an amount below zero in red or stock under its safety level in amber. A deadline's overdue state stays a declaration (`dueLike` with `settledWhen`).
  - **Display only.** Nothing on the write path reads the key, and every metadata that parsed before parses unchanged. Field-level security drops a rule whose condition reads a field the caller cannot read, keeping the other rules in order (`@objectstack/metadata-core`). The SQL driver classifies the key as presentation, so it never reaches column DDL (`@objectstack/driver-sql`).
  - **Who reads it.** objectui's cell renderers read the rules in a follow-up release, once this spec version is published. Until then a rule is validated when it is authored and styles no cell.
- 9af0005: The shared build validator (`@objectstack/lint`'s expression rule over `@objectstack/formula`) judges `record.<block>.<leaf>` against an object's declared read attachments (`ObjectSchema.attachedOnRead`)
  
  - **`@objectstack/lint`.** The field index the expression rule builds now adds each block an object declares under `attachedOnRead` to the names `record.<x>` resolves to, and hands the shared validator the block's declared leaves. A predicate such as `record.viewer.can_act` on an object that declares the `viewer` block is accepted where it was refused as an unknown field.
  - **`@objectstack/formula`.** `ExprSchemaHint` gains an optional `attachedOnRead` (block name → declared leaf keys). When a `record.` or `previous.` reference names a declared block, its next segment must be a leaf the block declares. Anything else is refused with the existing `unknown-field` code: `field` is the dotted path as written (`viewer.can_actt`), `suggestion` the nearest declared leaf (`viewer.can_act`), and the new optional `block` and `leaves` params carry the leaves the block declares, which the message names. No new refusal code.
  - **`@objectstack/metadata-core`.** The ADR-0106 field-level-security masker classifies the new top-level key as passed through unchanged (`OBJECT_REFERENCE_POSITIONS.attachedOnRead`): a block name and its leaf keys never name a field, so no caller's served object definition loses or gains anything.
  - **Unchanged.** An object that declares no block keeps every verdict it had, and a second segment off any other field is not judged. Index access, a method call on a block and a third segment stay unjudged.
- e5687cb: An `email` field can declare that it identifies a correspondent for inbound mail: `mailAssociation`
  
  Clause-②: yes (widening)
  
  - **`mailAssociation: boolean`** (optional, no default) on a field definition. TRUE marks this email field as identifying a message correspondent: when a mailbox service ingests a message, it associates the message with every record of the object whose value in this field equals one of the message's participant addresses (From, Sender, Reply-To, To and Cc, plus those of a forwarded message it carries; ASCII case-insensitive; the receiving mailbox's own addresses excluded; only within the mailbox's organization). A message no record matches waits in the mailbox's unassociated pool. Absent or FALSE: the field takes no part in matching.
  - **The platform learns which fields carry a correspondent's address, never what a contact is.** Every object that flags a field is treated alike; no app code and no resolver service is involved.
  - **The door that judges it.** `FieldSchema` refuses the key on any type other than `email`, naming the field's type and the fix (change the type to `email`, or drop the key). Every metadata that parsed before parses unchanged.
  - **Who reads it.** Nothing yet: the mailbox service's ingest is the reader, and it ships separately. Until then `objectstack validate` and `objectstack lint` warn an author who sets it (`liveness-planned-property`) that no mailbox service reads it yet.
  - **Where to author it.** The field designer offers it on email fields as "Match Inbound Mail".
  - **`@objectstack/driver-sql`.** `FIELD_KEY_STORAGE_CLASS` classifies `mailAssociation` as `presentation`: the mailbox service reads it, never `createColumn`, so a declaration on a builtin column name is not reported as discarded storage. No behaviour changes.
  - **`@objectstack/metadata-core`.** `FIELD_REFERENCE_POSITIONS` classifies `mailAssociation` as `keep`: the FLS scrub of a served object definition passes the flag through unchanged, because it names no field.
  - **`@objectstack/platform-objects`.** The field designer's new row carries its label and help text in the metadata-form translation bundles for en, zh-CN, ja-JP and es-ES.
- 5677add: fix(metadata-protocol): two locales of one email template saved through the metadata door both survive a restart — an overlay row is keyed by its bundle member (#22877)
  
  Clause-②: no
  
  **What an administrator sees.** Saving the same email template in two languages through the metadata door (`PUT /api/v1/meta/email_template/:name`, the Studio editor's save) keeps both. Before, the store kept one overlay row per template name, so the second language's save replaced the first language's row: both read back until the next restart, and then the first language mailed the package wording again. Each language now keeps its own wording across restarts, and each send in that language uses it.
  
  **What changed in the store.**
  
  - `sys_metadata` gains one nullable column, `bundle_member`. It holds the member of a metadata type whose identity is a pair — today `email_template`, identified by `(name, locale)`. NULL is the canonical member (`en-US`, the locale a send falls back to). Every other row stays NULL, so rows of every other type, and an `en-US` template row, are byte-identical to before.
  - The value is taken from the saved body's `locale`; it is never authored. A body that declares no `locale` is the `en-US` member.
  - The overlay uniqueness index becomes `(type, name, organization_id, COALESCE(package_id, ''), COALESCE(bundle_member, ''))`, for active rows and for draft rows, and the declared index in `metadata-core` carries the column too. A second row for the same template, language, package and state is refused by the index.
  
  **What a read or a door addresses.** A save addresses the language its body names. A read, delete, publish, history or revert by name that names no language addresses the `en-US` member: `GET /meta/email_template/:name` serves the `en-US` wording (the stored one when it was customized, else the package's), where before it served whichever row the name had. The layered list and the send path serve every language as before. A non-`en-US` language's own customization is reached through the list, and is replaced by a save that names its `locale`; a by-name reset (`DELETE`) removes the `en-US` customization only. The lineage counter stays one per template name, so a version number names one saved snapshot, and a revert by name restores only a version of the `en-US` member. Resetting, publishing or reading a non-`en-US` language by name needs the by-name member selector, which arrives with stage 2 of #22877; until then those doors address the `en-US` member.
  
  **What happens on the first boot after upgrading.** Nothing to configure.
  
  1. The schema sync adds the `bundle_member` column.
  2. Boot hydration gives every `email_template` row stored before the column existed the member its body declares, so a row an earlier save left holding a second language's wording becomes that language's row, not the `en-US` one. Rows of every other type are not read or written.
  3. The first metadata write rebuilds the overlay index with the new key, through the existing probe-then-replace order. Adding a key part only relaxes uniqueness, so no rows a store already holds can block the rebuild; a store that was already blocked is reported as before, with the duplicate-listing query and `os migrate duplicates`.
  
  **On a database without partial indexes (MySQL).** The rebuild above is refused there, as before, and reported in the server log at the first metadata write. A store that booted an earlier version keeps the four-column declared index under `idx_sys_metadata_overlay_active`, because the schema sync skips an index whose name already exists. That index has never constrained an environment-wide overlay row: those rows store no organization, and a UNIQUE key does not collide NULLs. So two languages of one template coexist there too, and no save is refused. `os migrate plan` lists the declaration change on that index as a destructive `recreate_index`. To bring the index to the five-column declaration, run `os migrate apply --allow-destructive`. A fresh store gets the five-column declaration.
  
  `os migrate duplicates` boots read-only and adds no column. Run against a store this version has not booted yet, it lists the two overlay indexes with every row read as the empty member — the value the column will hold — so a duplicate that will block the rebuild is still reported, and the entry's `duplicateSql` is the member-less statement that ran there.
- c5b43b6: fix(metadata-core, runtime): a multi-package artifact built before a retirement boots at `os dev -a` and `os start`. The ADR-0087 forward conversion walks every `packages[].manifest` body, and the runtime's artifact load converts the bundle once, before any reader sees it
  
  Clause-②: no
  
  **What an operator saw.** A multi-package release artifact (ADR-0130 D4: `os build` of a `composeStacks(…, { manifest: 'preserve' })` project) carries its collections in `packages[i].manifest`. Take such an artifact built before a retirement, for example with a dashboard still spelled `refreshInterval`. `os dev -a dist/objectstack.json` and `os start` exited at boot with "`packages[1]` is not a package entry (ADR-0130 D4): manifest.dashboards.0.refreshInterval: `dashboard.refreshInterval` was renamed to `refreshIntervalSeconds`…". The metadata plugin's artifact door refused the same artifact at its strict parse. The ADR-0087 conversion converted that dashboard when it sat in the artifact's own `dashboards`, but it never read a package body, and the runtime read the bundle raw before any conversion ran.
  
  **What an operator sees now.** The same artifact boots at `os dev -a` and at `os start`. Each body's items are served converted (`refreshIntervalSeconds: 300`, valid), each owned by its own package. The boot log names each conversion once, with the body it found it in: `[MetadataPlugin] artifact '…' … converted 2 site(s) forward via ADR-0087 conversion 'dashboard-refresh-interval-to-refresh-interval-seconds' (first at packages[0].manifest.dashboards[0].refreshIntervalSeconds) …`. The artifact file itself is unchanged, so it converts again on every boot until it is rebuilt with `os build`. A body built after the retirement converts nothing and logs nothing. An artifact authored past every retirement is still refused with the tombstone inside its body.
  
  - **`@objectstack/metadata-core`.** `applyArtifactForwardConversions` runs the same conversion over each package body as over the artifact's own collections. It uses the same registry and the same window, decided once from the artifact's own `engines.protocol`; a body's own `engines.protocol` is not read. A notice from a body is located from the artifact root (`packages[1].manifest.…`).
  - **`@objectstack/runtime`.** `loadArtifactBundle` converts the loaded artifact once, before it merges the runtime module and before the stack, `AppPlugin` or the `manifest` service read it. The database resolver reads the artifact file itself, and it runs the same conversion on what it reads. So a multi-package artifact that declares its default datasource in a package body opens that database, not the unified default.
  
  **Unchanged.** An artifact without `packages[]` converts exactly as before, with the same notices, paths and messages, and it is served the same way.
- 8c10776: fix(metadata-protocol): a stored-metadata migration records the user who ran it, or nobody, never a label
  
  Clause-②: no
  
  - **What was wrong.** The stored-metadata migration pass (`os migrate meta --stored`, `POST /api/v1/meta/_migrate-stored`, the runtime dispatcher's `POST /metadata/_migrate-stored`, and `migrateStoredMetadata()` called in process) recorded a label as the writer of every row it rewrote: `'os migrate meta --stored'`, `'<user id> (POST /api/v1/meta/_migrate-stored)'`, `'POST /api/v1/meta/_migrate-stored'`, or `'migrate-stored'`. The writer lands in `sys_metadata_history.recorded_by` and in the row's `updated_by`. Both columns are references to `sys_user`, so the label pointed at no user. Nothing refused it, because metadata writes run as the system.
  - **What it does now.** The pass records the id of the user who ran it, exactly as every other metadata write does. A REST or runtime call by a signed-in user with `manage_metadata` records that user's id. A run with no user records `null`, which means "system-initiated". That covers the CLI, which opens the database directly with no session, and a system caller. The pass still names itself on each history row's `source` (`migrate-stored`), as it did before.
  - **What an operator sees.** History rows and rewritten rows written by a migration from this release on name the person who ran it, or nobody. They never name a command or a route. Rows a migration rewrote before this release keep the label they were given.
  - **Contract text.** `MetadataItem.authoredBy`'s description now gives the same rule as `PutOptions.actor`: the acting user's id, or `null` for a system-initiated write, never a label such as `"system"` or `"cli"`. The schema accepts the same values as before.
- ef1fcb2: A declared index states its uniqueness scope: bare `unique: true` on `indexes[]` is refused (protocol 18, ADR-0120 D1/D7), stored metadata converts it to `unique: 'global'` with zero drift, and `VISIBILITY_STRICT_OPTIONS` leaves `@objectstack/spec`'s public surface.
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered declared-index-bare-unique-true-retired, visibility-strict-options-unexported -->
  
  **BREAKING**: an accept-set narrowing on a published authoring surface and one export removal, shipped as `minor` under the launch-window convention for accept-set narrowings (Changesets pre mode is not in on `main`).
  
  **Why.** On a declared index, bare `unique: true` was the one `unique` spelling whose scope was positional. It built the index over exactly `fields`, one holder across the whole installation, while reading like "unique per organization" to an author who knew the field-level meaning. 17.x warned (lint `unique/unscoped-declared-index`). Protocol 18 refuses it, so the scope is always stated.
  
  **What is refused.** A declared index (`objects[].indexes[]`, `objectExtensions[].indexes[]`) whose `unique` is bare `true`. The refusal names both replacements, and says which one keeps the index bare `true` built. It is raised by:
  
  - the schema (`IndexSchema.unique`, now `false | 'global' | 'organization'`), at every door that parses: `ObjectSchema.create()` and `ObjectSchema.parse()`, `defineStack`, `os validate`, `os build`, and the runtime save door (`422 INVALID_METADATA`). `tsc` refuses it too, because the input type no longer admits `true`;
  - lint `unique/unscoped-declared-index`, now an `error` and a gating rule on all three commands. It is what refuses the spelling under `os lint`, which never parses.
  
  **What converts.** The protocol-18 ADR-0087 conversion `declared-index-unique-scope` rewrites a declared index's bare `true` to `'global'` on every data-at-rest seam: stored `sys_metadata` rows (`applyConversionsToStoredItem`), built artifacts inside their declared-floor window, and `os migrate meta --from 17`. `'global'` is exactly the index bare `true` built, so the physical index is byte-identical and the drift plan is empty. It is retired from the authoring funnel, so a live author is refused and taught instead of converted silently.
  
  **What stays accepted.** Field-level `unique: true` still means one holder per organization and stays valid indefinitely. On a declared index, `unique: false` or omitted, `'global'` and `'organization'` parse exactly as before.
  
  ## FROM → TO
  
  | you wrote | write instead |
  |:--|:--|
  | `indexes: [{ fields: [...], unique: true }]` | `indexes: [{ fields: [...], unique: 'global' }]`: the same index, nothing on disk changes |
  | …the same, when you meant one holder per organization | `unique: 'organization'`: the driver prepends the NULL-safe organization key part at registration, and `os migrate plan` shows the index change |
  | `import { VISIBILITY_STRICT_OPTIONS } from '@objectstack/spec/shared'` (or the root entry) | delete the import: it was an internal option bag for the spec's own visibility-carrying schemas, and those schemas are unchanged |
  
  **The one-line fix: on every declared index, write `unique: 'global'` where you wrote `unique: true`.** Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.
  
  **Who is affected, measured.** At `e67ba80049`, an AST census found 48 declared indexes with bare `unique: true` in 39 source files of this repository, all platform and plugin objects. Every one is respelled `'global'` in this change, and the nine-key S5 corpus is pinned to build byte-identical indexes before and after (`driver-sql`'s `sql-driver-unique-tenancy.test.ts`). `examples/**` and `apps/**` carry none. Deployed metadata and other repositories were not measured.
  
  ### The kit
  
  - **The refusal.** `IndexSchema.unique` in `data/object.zod.ts`, with its own prescription. The lint rule moved from `warning` to `error` and from advisory to gating.
  - **The conversion.** `declared-index-unique-scope` (`toMajor: 18`, retired from the load path, `retiredAfter: '17.7.0'`), with its S4/S5 fixture.
  - **The ledger.** The D3 semantic entries `declared-index-bare-unique-true-retired` (the scope each respelled index really meant is the author's call) and `visibility-strict-options-unexported`, plus a step-18 rationale fragment.
  - **The export.** `VISIBILITY_STRICT_OPTIONS` moved to the unbarrelled `shared/visibility-strict-options.ts`, beside its type `StrictObjectOptions`. `check:api-surface` counts the removal.
  - **The pins.** The "`'global'` is a synonym of `true`" driver pin retired with the bare spelling. The verbatim pin is stated in `'global'`.
- Updated dependencies [317cddd]
- Updated dependencies [fec87e7]
- Updated dependencies [0253192]
- Updated dependencies [bfc15d2]
- Updated dependencies [7aa8d51]
- Updated dependencies [95a8435]
- Updated dependencies [60bcfe7]
- Updated dependencies [d112087]
- Updated dependencies [4806b18]
- Updated dependencies [1802315]
- Updated dependencies [06cc45d]
- Updated dependencies [7de0265]
- Updated dependencies [7895671]
- Updated dependencies [b389e43]
- Updated dependencies [c8b062f]
- Updated dependencies [117d34d]
- Updated dependencies [6729e10]
- Updated dependencies [1920cf3]
- Updated dependencies [41d0d40]
- Updated dependencies [c52bfb4]
- Updated dependencies [c7d6037]
- Updated dependencies [72b26ed]
- Updated dependencies [2d21b9c]
- Updated dependencies [f66fdc7]
- Updated dependencies [9fdb127]
- Updated dependencies [615c696]
- Updated dependencies [968acc8]
- Updated dependencies [111ffff]
- Updated dependencies [12b9daf]
- Updated dependencies [d85615d]
- Updated dependencies [6a06e3b]
- Updated dependencies [0e9e7b7]
- Updated dependencies [0af4f66]
- Updated dependencies [9a0401f]
- Updated dependencies [9c93ce6]
- Updated dependencies [ac9f8bd]
- Updated dependencies [04e776b]
- Updated dependencies [a7df552]
- Updated dependencies [2f70c22]
- Updated dependencies [78f841b]
- Updated dependencies [c565813]
- Updated dependencies [d5a14dd]
- Updated dependencies [93125ae]
- Updated dependencies [56c8844]
- Updated dependencies [d4680d2]
- Updated dependencies [cdeabec]
- Updated dependencies [d7c5c33]
- Updated dependencies [a87d8be]
- Updated dependencies [15ec50e]
- Updated dependencies [db4c45b]
- Updated dependencies [51290bc]
- Updated dependencies [ad381fd]
- Updated dependencies [2b61f2d]
- Updated dependencies [8f2e808]
- Updated dependencies [3b49318]
- Updated dependencies [4e9fe9f]
- Updated dependencies [9ad3d24]
- Updated dependencies [326a90a]
- Updated dependencies [9fe7448]
- Updated dependencies [2e11d90]
- Updated dependencies [4578c56]
- Updated dependencies [c512c25]
- Updated dependencies [215e662]
- Updated dependencies [3d886ee]
- Updated dependencies [d8d0711]
- Updated dependencies [40a6ee5]
- Updated dependencies [5910b5e]
- Updated dependencies [081e6a0]
- Updated dependencies [1884948]
- Updated dependencies [e23eccb]
- Updated dependencies [ac8f2c5]
- Updated dependencies [db9cf80]
- Updated dependencies [e75dced]
- Updated dependencies [9af0005]
- Updated dependencies [440bed6]
- Updated dependencies [b2549a8]
- Updated dependencies [ee8751d]
- Updated dependencies [96e4be4]
- Updated dependencies [35ef501]
- Updated dependencies [faf6348]
- Updated dependencies [557ae7c]
- Updated dependencies [6a3fe25]
- Updated dependencies [7731d70]
- Updated dependencies [3073b72]
- Updated dependencies [c76edeb]
- Updated dependencies [5b12503]
- Updated dependencies [514bf3c]
- Updated dependencies [20e7d52]
- Updated dependencies [b3a3634]
- Updated dependencies [3e72f93]
- Updated dependencies [f89b5f5]
- Updated dependencies [d25b187]
- Updated dependencies [0e00d36]
- Updated dependencies [d748ae8]
- Updated dependencies [dab6bf4]
- Updated dependencies [ed1de8c]
- Updated dependencies [a00cf99]
- Updated dependencies [5fb1746]
- Updated dependencies [29a163f]
- Updated dependencies [e223152]
- Updated dependencies [9f5eca5]
- Updated dependencies [9963322]
- Updated dependencies [b27b894]
- Updated dependencies [02d9f69]
- Updated dependencies [f53f14b]
- Updated dependencies [a800912]
- Updated dependencies [d973c34]
- Updated dependencies [156ddfa]
- Updated dependencies [5081090]
- Updated dependencies [b6eb25f]
- Updated dependencies [165587e]
- Updated dependencies [e04759d]
- Updated dependencies [ea9fd99]
- Updated dependencies [b32ee3e]
- Updated dependencies [e5899a6]
- Updated dependencies [490cb6d]
- Updated dependencies [e865300]
- Updated dependencies [ec7c7e0]
- Updated dependencies [85edd61]
- Updated dependencies [e84aeb3]
- Updated dependencies [322ff1e]
- Updated dependencies [5fc57b3]
- Updated dependencies [581ca7d]
- Updated dependencies [3f0b6f2]
- Updated dependencies [9814035]
- Updated dependencies [55382dc]
- Updated dependencies [b1d701b]
- Updated dependencies [efcbac7]
- Updated dependencies [20028df]
- Updated dependencies [69d4218]
- Updated dependencies [5ce6773]
- Updated dependencies [9432bac]
- Updated dependencies [3f69471]
- Updated dependencies [e5687cb]
- Updated dependencies [1e62f71]
- Updated dependencies [ec7f7f8]
- Updated dependencies [038d4c9]
- Updated dependencies [147a0d1]
- Updated dependencies [1959aac]
- Updated dependencies [1badd31]
- Updated dependencies [55828c5]
- Updated dependencies [7856110]
- Updated dependencies [9b37edb]
- Updated dependencies [a22e67b]
- Updated dependencies [62ce45d]
- Updated dependencies [39e93ef]
- Updated dependencies [02bec6c]
- Updated dependencies [719183f]
- Updated dependencies [8464380]
- Updated dependencies [252a582]
- Updated dependencies [f931e76]
- Updated dependencies [e5f9f01]
- Updated dependencies [ef1fcb2]
- Updated dependencies [ace0a53]
- Updated dependencies [de70e97]
- Updated dependencies [74c4b34]
- Updated dependencies [e040b8c]
- Updated dependencies [f451a59]
- Updated dependencies [ba95607]
- Updated dependencies [b53b949]
- Updated dependencies [ea9fd99]
- Updated dependencies [1e44436]
- Updated dependencies [2acff87]
- Updated dependencies [299a2c6]
- Updated dependencies [e23eccb]
- Updated dependencies [bf492c8]
  - @objectstack/spec@18.0.0-next.0

## 17.7.0

### Minor Changes

- 83b3d32: Public forms on a walled tenancy posture: saving or publishing a view whose public form cannot take anonymous intake now tells the author why, on the response.
  
  Clause-②: yes (widening)
  
  On a walled posture (`group` or `isolated` in force), an open public form whose object is walled by an organization column cannot take an anonymous submission: the submission carries no organization, and an insert without one into a walled object is refused. The two anonymous form endpoints already answer such a form as a withdrawn one (`404 FORM_NOT_FOUND`), and the administrator's read of the view (`GET /meta/view/:name`) already states why in `_diagnostics.warnings`.
  
  - **`@objectstack/metadata-protocol`**: saving the view (`PUT /meta/view/:name`) or publishing its draft (`POST /meta/view/:name/publish`, and a package's batch publish) now answers success with one `warning` advisory per such form, under `advisories`, with rule `public-form-intake-unavailable`. It is located at the form's `sharing` (for example `views[0].formViews.contact.sharing`), its `message` is the same text the administrator's read states, and its `hint` is the remedy: if the object's rows belong to no organization, declare `tenancy: { enabled: false }` on it. The write is never refused. The advisory reads the posture in force from the `tenancy` service, which is what the anonymous endpoints read: a single-posture deployment, a deployment whose walled posture is degraded to `single`, a deployment with no tenancy service, and a form bound to a tenancy-disabled object get no advisory, and a draft save is not judged. The publish refusal for an unstamped platform schedule flow still reads the requested posture, as before.
  - **`@objectstack/metadata-core`**: the intake-availability rule moved here from `@objectstack/rest` and is exported, so the anonymous endpoints, the administrator's read and the publish advisory read one answer: `anonymousFormIntakeUnavailability(object, posture, readObjectSchema)` (`null` when the form can take intake, otherwise the object, the posture and the wall column; it judges the object's effective schema, with the injected `organization_id`), `anonymousFormIntakePosture(tenancy)` (the posture in force, as a tenancy service reports it), `anonymousFormIntakeUnavailableMessage` and `anonymousFormIntakeUnavailableRemedy` (the reason and its remedy), `anonymousFormSharingPath` and `anonymousFormObjectName`, and the type `AnonymousFormIntakeUnavailable`.
  - **`@objectstack/rest`**: the anonymous form endpoints and the administrator's read import that rule instead of holding their own copy. Their answers are unchanged.
- a6a7547: The object-schema field mask (ADR-0106 D1) now removes a denied field's references from the rest of the served object document, not only its `fields` entry.
  
  Clause-②: no
  
  A caller who cannot read a field was served a document without that field's definition, but other parts of the document could still name the field. Those parts are now projected too, on every exit that serves an object schema to a restricted caller: the by-name read, the list read and the layered view. What happens to each kind of position:
  
  - **Object-level rule entries** (`validations`, `indexes`, `activityMilestones`). An entry that names or reads a denied field is dropped whole. The platform still evaluates the stored rule on every write.
  - **Role pointers** (`nameField`, `displayNameField`, `imageField`, `stageField`, `tenancy.tenantField`, `lifecycle.ttl.field`). A pointer to a denied field is deleted, so the role falls back to its default.
  - **Name lists** (`highlightFields`, `searchableFields`, `publicSharing.redactFields`, list-view column lists, `external.columnMap` entries, and a readable field's `relatedListColumns` / `dependsOn`). The denied entries are filtered out. A list-view column in object form is dropped when any of its facets names a denied field: its own `field`, its `prefix.field` or its `summary.field`. A `dependsOn` entry's `param` is the lookup target's key and is not read as a field here. A list left empty is deleted.
  - **The inline master-detail grid** (`inlineColumns`, `inlineAmountField`). These are declared on the child object's own `master_detail` field and name the child's own fields. A column that is a denied field, or is computed from one (`expr`), is dropped. A denied `inlineAmountField` is deleted.
  - **Expressions** (`titleFormat`, field-group `visibleWhen`, row-CRUD `visibleWhen` / `disabledWhen`, `publicSharing.eligibility`, lifecycle `onlyWhen`, and a readable field's formula `expression`, `visibleWhen` / `readonlyWhen` / `requiredWhen`, `relatedListFilter`, `defaultValue`, `autonumberFormat` and per-option `visibleWhen`). An expression that reads a denied field is deleted. The readable field itself stays.
  - **List views and actions.** An entry whose filter, sort, predicate, params or `patch` read a denied field is dropped. So is a list view whose key is a denied field's name.
  
  In these positions an object key counts as a field reference only where keys are field names: a `FilterCondition`, a lifecycle `onlyWhen` map, an action's `patch`. A denied field named like a schema word (`type`, `source`, `name`) no longer removes every rule, view, action or CEL envelope. A dotted path whose root segment is a denied field counts as a reference to it, whether it is a field-keyed key, a name-list entry or a pointer. The mask also terminates on a cyclic document.
  
  Names of another object's fields (`lookupColumns`, `displayField`, `summaryOperations`, …) are left alone, because that object's own projection governs them. A key that is not classified is deleted when it mentions a denied field in any string or key, so a new key over-masks until it is classified. A test holds the classification equal to the live `ObjectSchema`, `FieldSchema`, `InlineGridColumnSchema`, `ListColumnSchema`, `ColumnPrefixSchema` and `ColumnSummaryConfigSchema` key sets. A caller who is denied nothing still gets the same document reference, so nothing changes for unrestricted callers.
  
  The shared contract fixture in `@objectstack/metadata-core/testing` (`FLS_CONTRACT_OBJECT`) now names its fields in each of these positions, including list views (one with object-form columns), actions and the inline grid, and its formula field uses the real `expression` key. The contract's residue check matches a denied name as an identifier token anywhere in the served document, so a name inside an expression fails it. Projection cases also check what must survive (`retained`), so a mask that deletes too much fails as well.
- e83c9f6: A package install refused by the ADR-0087 D1 protocol handshake now answers `422 OS_PROTOCOL_INCOMPATIBLE`, with its structured diagnostic in `error.details`. It used to answer the `500` server-fault fallback, with the diagnostic only inside the message.
  
  Clause-②: yes
  
  - **`POST /api/v1/packages`:** a manifest whose declared range (`engines.protocol`, then `engines.platform`, then `engine.objectstack`) excludes this runtime's protocol major answers `422`, with `error.code: 'OS_PROTOCOL_INCOMPATIBLE'` and `error.details: { requiredRange, rangeSource, protocolVersion, targetMajor, migrateCommand }`. `error.message` is unchanged, and the command after its `Run:` equals `migrateCommand`. Nothing is installed, so a later `GET /api/v1/packages/{id}` still answers `404`.
  - **The no-protocol-service fallback:** in a composition without a `protocol` service, `POST /api/v1/packages` used to install such a manifest. It now runs the same handshake and answers the same `422`.
  - **`@objectstack/metadata-core`:** `ProtocolIncompatibleError` declares `status` and `statusCode` `422`, with `code` as the literal `'OS_PROTOCOL_INCOMPATIBLE'`. It also carries a `Symbol.for` brand, and the new `isProtocolIncompatibleError(e)` recognises it across module instances, where `instanceof` would not. Any other caller that resolves the error (the boot-time `AppPlugin` load included) reads `422` rather than the `500` fallback.
  - **`@objectstack/spec`:** the error-code ledger's `OS_PROTOCOL_INCOMPATIBLE` row states its status (422) and the door that carries the diagnostic. The vocabulary does not change.
  
  A client that branched on `500` for this code should branch on `422`, or on `error.code`. None was found in this repository, the SDK or the console.
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable key, spelling, export or stored shape is removed or renamed, so `objectstack migrate meta` has nothing to rewrite. The refusal's HTTP status and envelope change and one export is added, but the protocol range check itself is unchanged, and the no-protocol-service fallback now refuses what the composed door already refused. The other categories are closed on facts: the three packages publish (not unpublished); no ADR-0087 id covers this refusal and this diff adds none (not registered or already-registered); and the change moves a wire answer, not only a TS declaration (not runtime-interface-only or type-surface-only). -->
- 75ddcd1: `POST /api/v1/marketplace/install-local` now runs the ADR-0087 D1 protocol handshake. A manifest whose declared range excludes this runtime's protocol major is refused with `422 OS_PROTOCOL_INCOMPATIBLE`, the answer `POST /api/v1/packages` already gives. It used to install with a `200` (#21762).
  
  Clause-②: yes (widening)
  
  - **Install.** The handshake runs after the manifest id is parsed and before anything is registered, written or synced. The range is read from `engines.protocol`, then `engines.platform`, then `engine.objectstack`. The refusal answers `422` with `error.code: 'OS_PROTOCOL_INCOMPATIBLE'`, the handshake's own `error.message`, and `error.details: { requiredRange, rangeSource, protocolVersion, targetMajor, migrateCommand }`. It is the same on the inline-manifest branch and the cloud-snapshot branch. No ledger file is written, and an installed earlier version stays as it was. A manifest with no range, or a range the handshake cannot read, still installs, and the handshake's warning goes to the plugin's logger.
  - **Restart.** On `kernel:ready`, a ledger entry whose range excludes this runtime's major is not loaded. Nothing is registered, synced, bound or seeded for it. One `error` line names the package, `OS_PROTOCOL_INCOMPATIBLE` and the replay command (`objectstack migrate meta --from N`). The boot continues with the other entries. The entry stays in the ledger, so `DELETE /api/v1/marketplace/install-local/{id}` still removes it, and installing a compatible version replaces it. Before, it was registered and its schemas synced, with no warning.
  - **`@objectstack/metadata-core`:** a new export, `protocolIncompatibleAnswer(err)`, with its return type `ProtocolIncompatibleAnswer`. It turns a `ProtocolIncompatibleError` into the status, code, message and five-member `details` an HTTP door answers. Both install doors call it, so their answers are the same bytes.
  - **`@objectstack/runtime`:** `POST /api/v1/packages` answers through that helper. Its response is unchanged.
  
  A client that relied on install-local accepting a package built for another protocol major gets `422` now. Install a version built for this runtime's protocol, or migrate the package with the `migrateCommand` in the refusal.
- e1790fd: The content hash keeps the order of an object's `fields`, so a pure field reorder is a new version instead of "no change" (#21790).
  
  Clause-②: yes
  
  - **`canonicalize(value, type?)` and `hashSpec(value, type?)`** take the metadata type. For a type whose body has a map the spec declares ordered, that map keeps its insertion order in the canonical form. Today that is one map: `object.fields`, whose traversal order is the field order the platform presents. Every other map stays key-order independent, including the keys around `fields` and the keys inside each field definition. Called without a type, both functions return exactly what they returned before.
  - **`orderedMapKeys(type?)`** is a new export. It returns the top-level keys of a `type` body whose map keeps its order (`['fields']` for `object`, `[]` otherwise).
  - `InMemoryRepository` and the repository contract suite hash as `ref.type`. Invariant 4 now reads `item.hash === hashSpec(item.body, item.ref.type)`.
  - **Stored hashes.** An object whose `fields` are already in sorted key order hashes exactly as before. Any other object hashes differently from the hash stored before this release. A stored hash is still that row's version token: `@objectstack/metadata-protocol` keeps it as written and compares content to decide whether a save changed anything.
  
  `minor` because two exports widen: a new parameter and a new function. No metadata key, accepted value, wire payload or error code changes.
- e6dc7a2: The object-schema field mask (ADR-0106 D1) judges an action param that names another object's field through `objectOverride` against that object, not the one being served.
  
  Clause-②: yes (widening)
  
  **What a user saw.** A `delegated_admin` may invite members, and the invite door admits them, but `GET /meta/object/sys_user` served that principal no `invite_user` action. The action's `role` param is `{ field: 'role', objectOverride: 'sys_member' }`: it names `sys_member.role`. The mask read every param's `field` as a field of the served object, so a caller denied `sys_user.role` lost the whole action. A plain `member` lost it the same way. The member is now served the action too, and still not offered it: the action's `requiresMembershipReach` predicate excludes the member grade.
  
  **The rule.** A param whose `objectOverride` names another object reads that object's field. It is judged against the caller's readable fields on that object, and it is not a reference to the served object's fields. The action is still dropped when the caller cannot read the field there, and when that object's readable fields cannot be determined (no answer from the security service, a security service that throws, or an object that does not exist). Nothing about the other object is served on a guess. The rest of the param is still read against the served object: `visible`, an option's `visibleWhen`, `defaultValue`, and an explicit `name` that differs from `field`. A `name` that only repeats `field` is read as that field. With `defaultFromRow`, the param also reads `field` from the served object's row, so `field` is judged against the served object too. An exempt caller (platform admin, `isSystem`) is served the whole schema, as before.
  
  **The API (`@objectstack/metadata-core`), additive.**
  
  - `relateObjectSchemaMaskPosture(posture, ...documents)` completes a `project` posture for the documents it is about to mask. It reads the caller's readable fields on each other object their action params name through `objectOverride`. It runs after the fetch, because only the document names those objects. It returns every other posture, and any document with no such param, unchanged, and it never throws.
  - The `project` member of `ObjectSchemaMaskPosture` gains two optional fields. `relate` asks the posture's question (same caller, same security service) about another object. `resolveObjectSchemaMaskPosture` sets it. `related` holds the answers. A `project` posture built without `related` gets no answers, so `applyObjectSchemaMask` drops every action with such a param.
  - `applyObjectSchemaMask` folds each related read it withholds into the fingerprint, written as `object.field`. Two callers who are denied the same fields on the served object but differ on the other object get different validators. An unrestricted caller's ETag is unchanged.
  - The shared contract fixture `FLS_CONTRACT_OBJECT` (`@objectstack/metadata-core/testing`) gains two actions whose params read `contact` fields through `objectOverride`. The contract's projection cases now require the readable one to be served and the denied one to be dropped. An exit that never relates its posture fails the contract by name.
  
  **Every exit relates its posture (`@objectstack/rest`, `@objectstack/runtime`).** These exits relate the posture after the fetch, before the projection: the shared item, layered and list chains, `RestServer`'s cached read and published read, and the runtime dispatcher's mask. The `/meta` diff route masks `fields` only and needs no relate step.
  
  **Measured on a showcase boot.** We read every object schema (78 objects, by-name read and list read) as five principals: a platform admin, an org owner, an admin, a `delegated_admin` and a `member`. Before and after this change, the only served action that moved is `sys_user.invite_user`, which is now served to the `delegated_admin` and the `member`. This repository has two authored params with `objectOverride`: `sys_user.invite_user`'s `role` and `sys_member.invite_user`'s `email` (on `sys_invitation`). The second was served to all five principals before and after.
- 3c7785d: A public form's explicit intake withdrawal at any metadata layer now holds: layering can only narrow anonymous intake, never re-open it
  
  Clause-②: yes (widening)
  
  - **What counts as a withdrawal.** A withdrawal keeps the form's `publicLink` and sets `sharing.enabled: false` or `sharing.allowAnonymous: false`. Only an explicit `false` counts: a switch that is absent is not a withdrawal. Removing the `sharing` block, clearing the `publicLink`, or deleting the view at one layer is not a withdrawal either. A sharing that names no public link withdraws nothing.
  - **Organization-scoped saves and publishes.** A `view` save or draft promotion in the organization the anonymous form doors read is refused with `403 NOT_OVERRIDABLE` if it would leave open a form that the environment-wide definition withdraws. This check judges by the stored row: the organization's body is compared with the env-wide body of the row it is keyed by (the active env-wide row, else the package's artifact), and also with the env-wide view list the way the doors read it (a container-shaped body is expanded the way the list read expands it). Inside the row, a withdrawn form matches by its place (`form`, the same `formViews` entry, or `config`) or by its public slug, and either match is enough. So a renamed `formViews` key, a `form.name`, a move to another place, a listViews collision rename in the expansion, and a new or re-cased slug are all judged as the same form. A form that differs from every withdrawn form in both place and slug, such as a sibling in the same container, stays independent. The check also covers an organization copy that was already open before the withdrawal, the next time it is saved. The message names the remedies: save the overlay withdrawn, or publish the form from its environment-wide definition. An organization-scoped save that keeps the form withdrawn is still accepted.
  - **Anonymous form doors.** `GET /forms/:slug` and `POST /forms/:slug/submit` judge by the name of the view item they serve. Beneath the organization's read they read the env-wide view list, and they serve a form only when the env-wide item of the same name does not explicitly withdraw a form in the same place or with the same slug. A withdrawn form answers `404 FORM_NOT_FOUND` on both doors and creates no record. A form that is open at every layer is served as before. A form that only an organization carries is still served there. A different view that uses the same slug is a different form, and the two never close each other.
  - **Package-shipped forms.** A package's form is part of the env-wide definition, not a separate layer beneath it. A package artifact that was parsed by the stack schema (strict `defineStack`, the default) carries the schema's default `enabled: false`, so a shipped form that keeps its link without switching `enabled` on is an explicit withdrawal (fail closed). An artifact that reached the runtime without that parse (`defineStack(..., { strict: false })` or a hand-built manifest) is judged as written: there a switch it omits is absent, which is not a withdrawal. The env-wide definition is the administrator's switch: an env-wide save may open a form the package ships closed.
  - **Known limit: packages and names.** A withdrawal of a view name closes that name in every package. When two packages ship a view of the same name, one package's withdrawal also closes the other package's form of that name: it may over-close, never under-close. Per-package precision is tracked in #21934. A publish judges the draft it promotes under the same package key: with two packages holding a draft of the same view in one organization, each draft is judged on its own publish.
  - **Known limit.** The doors match by served item name, and the save check runs only on an organization-scoped save or publish. An organization overlay that was stored before the env-wide withdrawal, or that a rollback or commit-revert restores, can still be served if it keeps the form open under a different key or place than the env-wide definition. Withdraw the form in that overlay to close it. Rollback and commit-revert restores are not gated by the save check.
  - **Behaviour change.** Between 17.6.0 and this fix, an organization overlay that published a form the environment-wide (package) definition withdrew was honoured: the doors served the organization's copy. That behaviour never shipped in a release, and it is reversed on purpose. The environment-wide withdrawal now wins.
  - **`@objectstack/metadata-core`** exports the shared judgement `anonymousFormIntakeWithdrawnIn` (a new, additive public export). Both the doors and the save path read it.
- 6dd99b8: Public forms: every declared means of withdrawing a form from anonymous intake is now honoured by every anonymous form door. Which forms a `view` opens to anonymous intake is now decided by one rule, `anonymousFormIntakeCandidates` (new in `@objectstack/metadata-core`, alongside `anonymousFormIntakeSlugs`, `anonymousFormIntakeSlug` and `publicFormSlug`), read by both the anonymous form endpoints in `@objectstack/rest` and the organization-scoped `view` write check in `@objectstack/metadata-protocol`, so the two can no longer disagree. A form is served anonymously only when its `sharing` config declares public sharing as `SharingConfigSchema` defines it: `sharing.enabled: true`, `sharing.allowAnonymous: true` and a `sharing.publicLink` slug. `enabled` defaults to `false`, so a form that set only `allowAnonymous` and `publicLink` is no longer served on the anonymous endpoints (`404 FORM_NOT_FOUND`). Migration: add `enabled: true` to the form's `sharing` block (and to any stored overlay of it) to keep it public; see the public forms guide.

### Patch Changes

- c98a72d: Provenance comments in `@objectstack/metadata-core` cite the commits that decided them, not tracker numbers that no longer resolve
  
  Clause-②: no
  
  Docblocks and comments across the package cited issue-tracker numbers that now answer 404 on GitHub.
  Each now cites the commit in this repository's history that made the decision it describes, with two
  exceptions: two comments on `retiredFromLoadPath`'s jurisdiction (in `artifact-forward-conversion.ts`
  and its test) cite ADR-0087, which records that determination, and five comments that meant an
  objectui issue now spell it `objectui#6111`, as they already spelled `objectui#6110` beside it. One
  commit citation sits inside a maintainer ruling quoted in `record-organization.ts`: the number there
  became the bracketed editorial substitution `[commit 7901b2dd2]`, the commit that landed the ruling it
  names, and the rest of the quotation is unchanged. Some of these docblocks sit on exported members, so
  the reworded text appears in the published declaration files (`index.d.ts` / `index.d.cts`,
  `testing.d.ts` and a shared declaration chunk); the JavaScript output and its sourcemaps do not change.
  
  Comment only: no export, type, error code, status, message text or runtime behaviour changes.
- Updated dependencies [ecb6ca0]
- Updated dependencies [135daaa]
- Updated dependencies [22c2d6f]
- Updated dependencies [909229e]
- Updated dependencies [0721848]
- Updated dependencies [bdd3654]
- Updated dependencies [aead296]
- Updated dependencies [ad7c351]
- Updated dependencies [e901c27]
- Updated dependencies [a387354]
- Updated dependencies [f6b7520]
- Updated dependencies [36e4647]
- Updated dependencies [93a54b8]
- Updated dependencies [f623e2f]
- Updated dependencies [96a9719]
- Updated dependencies [41a3c8d]
- Updated dependencies [c52c49d]
- Updated dependencies [cfa4d74]
- Updated dependencies [99589f9]
- Updated dependencies [36ad321]
- Updated dependencies [dcc5ef4]
- Updated dependencies [9b7a0ef]
- Updated dependencies [5a9292e]
- Updated dependencies [1c52a5e]
- Updated dependencies [99e1912]
- Updated dependencies [7ebb543]
- Updated dependencies [3911901]
- Updated dependencies [222ecc2]
- Updated dependencies [3937ad2]
- Updated dependencies [3a6d92f]
- Updated dependencies [7526058]
- Updated dependencies [53fd35e]
- Updated dependencies [23365ea]
- Updated dependencies [32d5769]
- Updated dependencies [16eefc6]
- Updated dependencies [6e33b67]
- Updated dependencies [57cc695]
- Updated dependencies [db3fee3]
- Updated dependencies [4c8363f]
- Updated dependencies [9f13c94]
- Updated dependencies [6d67ad5]
- Updated dependencies [ca0dfb6]
- Updated dependencies [45efcfa]
- Updated dependencies [c9c555a]
- Updated dependencies [68c5ab7]
- Updated dependencies [b793010]
- Updated dependencies [5555047]
- Updated dependencies [aa46322]
- Updated dependencies [100c394]
- Updated dependencies [72217cd]
- Updated dependencies [72af58c]
- Updated dependencies [1289925]
- Updated dependencies [958cfe2]
- Updated dependencies [ced3e1a]
- Updated dependencies [7d674df]
- Updated dependencies [3f1bc81]
- Updated dependencies [72f3c74]
- Updated dependencies [529d971]
- Updated dependencies [16d241a]
- Updated dependencies [4331a6b]
- Updated dependencies [6c5697d]
- Updated dependencies [9a4182a]
- Updated dependencies [41b1333]
- Updated dependencies [f1e4ae5]
- Updated dependencies [eb9ef79]
- Updated dependencies [f83d066]
- Updated dependencies [9e9d693]
- Updated dependencies [6ec54f0]
- Updated dependencies [98eb3b9]
- Updated dependencies [a2aadab]
- Updated dependencies [fe10172]
- Updated dependencies [ed15448]
- Updated dependencies [9d91f58]
- Updated dependencies [9059082]
- Updated dependencies [309224d]
- Updated dependencies [e83c9f6]
- Updated dependencies [045f764]
- Updated dependencies [2df3d13]
- Updated dependencies [07bf21f]
- Updated dependencies [6fb7115]
- Updated dependencies [53021e3]
- Updated dependencies [ba57588]
- Updated dependencies [a43d90a]
- Updated dependencies [607463d]
- Updated dependencies [cab6396]
- Updated dependencies [e864db5]
- Updated dependencies [866683f]
- Updated dependencies [88a39c0]
- Updated dependencies [8e35895]
- Updated dependencies [1f04696]
- Updated dependencies [bab7685]
- Updated dependencies [fb69825]
- Updated dependencies [48eb9c1]
- Updated dependencies [8832655]
- Updated dependencies [100f68b]
- Updated dependencies [8963dbf]
- Updated dependencies [1354e7b]
- Updated dependencies [1cbe165]
- Updated dependencies [15fe567]
- Updated dependencies [0bddffd]
- Updated dependencies [7e0066a]
  - @objectstack/spec@17.7.0

## 17.6.0

### Patch Changes

- 3572916: The shared engine case tables and the published contract suites in metadata-core no longer cite tracker numbers in their case labels; each label states its case in words
  
  Clause-②: no
  
  Several labels these tables and suites ship ended with an issue-tracker number where the case belonged. A
  test driven from them printed that number as part of its name, and a failing assertion quoted it as the
  reason. The number goes; where the label did not already say what the case is, it now does.
  
  - `ENGINE_DELETE_DISPATCH_CASES`, `ENGINE_UPDATE_DISPATCH_CASES` and `ENGINE_FINDONE_PREDICATE_CASES`:
    the `what` labels of 22 rows. Among them, the compare-and-set rows now say the by-id path would drop the
    CAS guard; the payload-id rows say which declared `where.id` would be silently dropped; and the falsy
    `where.id` boundary says it is a scalar, so neither the different-row refusal nor the non-scalar refusal
    applies.
  - `@objectstack/metadata-core/testing`: the repository contract suite's `serialized-form identity` group
    title, and two `why` texts of `OBJECT_SCHEMA_MASK_CASES` (the empty-readable-set refusal, and the
    write-capable exemption, which now names the schema write gate, `manage_metadata`).
  
  Text only: no case is added, removed or re-ordered, and no `options`, `data`, `expect`, `expectId`, `id`,
  `readable` or `context` value moves. A suite that selects or skips these cases by their label text (a
  `-t` filter, a skip list) needs the new spelling.
- 3fbf3ca: Refusals, log lines and field help in core, the in-memory and MongoDB drivers, formula, metadata, metadata-core, objectql and platform-objects no longer cite tracker numbers; each states the reason in words
  
  Clause-②: no
  
  Many messages these packages show to authors, administrators and operators ended with an issue-tracker
  number where the reason belonged. The number goes, and where the sentence did not already say what was
  decided, it now does. Where an ADR stood beside the number, the ADR stays.
  
  - Refusals and prescriptions: the retired health-check keys, the `IMetadataService.register` refusals
    (the contract refuses loudly and names the mismatch, never coerces a value into storability), the
    kernel's plugin-ordering errors (registration order is not a contract), the in-memory and MongoDB
    filter and aggregation refusals, formula's empty field constraint, the retired `artifact-api`
    source, and the by-id update and delete refusals. The MongoDB retired-aggregate refusal now says the
    function left `AggregationFunction` because no SQL backend compiled it; its undeclared-aggregate
    refusal says the builder used to sum an unrecognised name before this refusal existed.
  - The `findOne` no-predicate refusal loses its citation in `objectql` and in `metadata-core`'s
    `engineFindOnePredicateRefusalMessage` together, so the two still read byte for byte the same.
  - The in-memory and MongoDB drivers' multi-tenancy refusals (`MEMORY_MULTI_TENANT_UNSUPPORTED`,
    `MONGODB_MULTI_TENANT_UNSUPPORTED`) no longer end with a `Tracking:` line linking a tracker card;
    the sentence above it already says the driver refuses rather than run or answer unisolated.
  - Field help and protection text: the `sys_account` token help (and its es-ES, ja-JP and zh-CN
    translations), the `sys_email` headers help and the SCIM credential store's protection reason.
  - Log lines: the superseded-registration warning, the authz cache posture line, the endpoint matcher's
    excluded-item error, the metadata history and loader-read failure errors, and the fresh-datastore
    attestation info lines.
  
  Text only: no error code, field name, status or behaviour changes.
- f3b16fc: Raise the published dependency floors to the 2026-10 production dependency group. No API changes. A consumer install resolves these ranges:
  
  Clause-②: no
  
  - `zod` `^4.6.1` → `^4.6.5`: `@objectstack/spec`, `@objectstack/core`, `@objectstack/objectql`, `@objectstack/rest`, `@objectstack/runtime`, `@objectstack/cli`, `@objectstack/mcp`, `@objectstack/metadata`, `@objectstack/metadata-core`, `@objectstack/metadata-protocol`, `@objectstack/driver-turso`.
  - `@libsql/client` `^0.17.3` → `^0.18.0`: `@objectstack/driver-turso`. Every behaviour the driver documents was re-measured on 0.18.0 and holds unchanged. That covers the URL scheme routing, the `URL_INVALID` and `URL_SCHEME_NOT_SUPPORTED` refusals, the WebSocket transport having no `fetch` or timeout seam, `syncUrl` being read only by the embedded-replica client, and the `?authToken=` precedence on `url` and `syncUrl`. The driver's refusal messages now name 0.18.0 as the measured version. 0.18.0 changes only the local `file:` client, which now pools connections. The driver creates that client only for an embedded replica, and calls only `sync()` on it.
  - `@modelcontextprotocol/sdk` `^1.30.0` → `^1.30.1`: `@objectstack/connector-mcp`, `@objectstack/mcp`.
  - `chalk` `^6.0.0` → `^6.0.1`: `@objectstack/cli`, `create-objectstack`. `yaml` `^2.9.0` → `^2.9.1` and `tsx` `^4.23.12` → `^4.23.15`: `@objectstack/cli`.
  - `mongodb` `^7.5.0` → `^7.6.0`: `@objectstack/driver-mongodb`.
  - `sql.js` `^1.14.1` → `^1.14.2`: `@objectstack/driver-sqlite-wasm`.
  - `@noble/hashes` `^2.3.0` → `^2.4.0` and `jose` `^6.2.8` → `^6.2.12`: `@objectstack/plugin-auth`. The better-auth family stays at exactly `1.7.3`.
  - `hono` `^4.13.5` → `^4.13.9`: `@objectstack/plugin-hono-server`.
  - `pinyin-pro` `^3.29.1` → `^3.29.4`: `@objectstack/plugin-pinyin-search`.
  - `@noble/ciphers` `^2.3.0` → `^2.4.0`: `@objectstack/service-settings`.
- Updated dependencies [e5c7d07]
- Updated dependencies [addbbf0]
- Updated dependencies [93d4e0e]
- Updated dependencies [88b484e]
- Updated dependencies [9905e61]
- Updated dependencies [f11b5f2]
- Updated dependencies [0cb72cf]
- Updated dependencies [c1d8051]
- Updated dependencies [a918fe7]
- Updated dependencies [41dcf11]
- Updated dependencies [c46279f]
- Updated dependencies [688ddef]
- Updated dependencies [b1aab1e]
- Updated dependencies [274e162]
- Updated dependencies [0efbdc3]
- Updated dependencies [c8dd8dd]
- Updated dependencies [03cdb9a]
- Updated dependencies [15b586d]
- Updated dependencies [542670d]
- Updated dependencies [e73ee2d]
- Updated dependencies [92fe081]
- Updated dependencies [c4c68ca]
- Updated dependencies [d78a0bd]
- Updated dependencies [5363e2d]
- Updated dependencies [c876a74]
- Updated dependencies [f1e921a]
- Updated dependencies [7a1faf1]
- Updated dependencies [c9d234c]
- Updated dependencies [24d521e]
- Updated dependencies [3a89d45]
- Updated dependencies [f379f57]
- Updated dependencies [05cb2bc]
- Updated dependencies [7510663]
- Updated dependencies [1a75e39]
- Updated dependencies [d7631d5]
- Updated dependencies [d830d71]
- Updated dependencies [1ab9892]
- Updated dependencies [fbec216]
- Updated dependencies [35587f7]
- Updated dependencies [ace770d]
- Updated dependencies [ed54768]
- Updated dependencies [99786f9]
- Updated dependencies [63bfe69]
- Updated dependencies [1940afd]
- Updated dependencies [4f83db5]
- Updated dependencies [f5c7b2c]
- Updated dependencies [6afccda]
- Updated dependencies [671d4c1]
- Updated dependencies [bbcd20c]
- Updated dependencies [c8111a5]
- Updated dependencies [9ad6544]
- Updated dependencies [c9c182e]
- Updated dependencies [4b4ee88]
- Updated dependencies [f10d802]
- Updated dependencies [93e9e42]
- Updated dependencies [ca5408c]
- Updated dependencies [b280546]
- Updated dependencies [975b248]
- Updated dependencies [ebb66aa]
- Updated dependencies [ceee88f]
- Updated dependencies [e18fea6]
- Updated dependencies [f750119]
- Updated dependencies [660a9b2]
- Updated dependencies [f6ccca4]
- Updated dependencies [26437ae]
- Updated dependencies [32d3b3c]
- Updated dependencies [c6b3a01]
- Updated dependencies [bee75ce]
- Updated dependencies [2742e53]
- Updated dependencies [a75311d]
- Updated dependencies [d98bf24]
- Updated dependencies [8368f1c]
- Updated dependencies [31c3996]
- Updated dependencies [95555e7]
- Updated dependencies [a29a0ea]
- Updated dependencies [83480c6]
- Updated dependencies [013f97d]
- Updated dependencies [5d5e679]
- Updated dependencies [e07566b]
- Updated dependencies [11d28c1]
- Updated dependencies [399e3aa]
- Updated dependencies [ba03198]
- Updated dependencies [94608a7]
- Updated dependencies [b3d7a70]
- Updated dependencies [b3917d9]
- Updated dependencies [c27404f]
- Updated dependencies [27c0cf3]
- Updated dependencies [70dae53]
- Updated dependencies [665cab3]
- Updated dependencies [62b90d7]
- Updated dependencies [cb45469]
- Updated dependencies [f3b16fc]
- Updated dependencies [d6d6e87]
- Updated dependencies [df1feae]
- Updated dependencies [336e191]
- Updated dependencies [9bdc6d3]
- Updated dependencies [24c554d]
- Updated dependencies [3dc33b2]
- Updated dependencies [9969228]
- Updated dependencies [95e24b0]
- Updated dependencies [1a4c7f8]
- Updated dependencies [c7396f1]
- Updated dependencies [434c6c7]
- Updated dependencies [4b59a38]
- Updated dependencies [cfa9315]
- Updated dependencies [0803a8b]
- Updated dependencies [0d42104]
- Updated dependencies [a3d7588]
- Updated dependencies [b8191f7]
- Updated dependencies [315888d]
- Updated dependencies [1741c5d]
- Updated dependencies [3711e0b]
- Updated dependencies [a8acee2]
- Updated dependencies [a51920f]
- Updated dependencies [0f6dcac]
- Updated dependencies [682873f]
- Updated dependencies [2123fcc]
  - @objectstack/spec@17.6.0

## 17.5.0

### Minor Changes

- 502f179: **BREAKING** — retire `object.tenancy.organizationField`, the stamp-only column
  declaration the whole protocol declared exactly once, on a table this platform ships.
  
  The key answered "which column says who this platform row is ABOUT", where
  `tenancy.tenantField` answers "what is this object WALLED by". The spec's own docblock
  stated the consequence: *"For ordinary objects the two coincide and `organizationField`
  is never needed."* Measured on `main` before this change, the entire repository declared
  it **once** — `packages/platform-objects/src/identity/sys-api-key.object.ts`, the
  better-auth credential table — and zero business objects declared it anywhere. Its
  readers were three platform-row writers, scope-pinned **by name** (audit stamping, the
  approval-row writer, the automation-run recorder), so an application declaration was
  inert by construction while still being authorable on every object, which made every
  future piece of organization logic owe the question "what if somebody set this?".
  ADR-0049 enforce-or-remove; maintainer ruling 2026-09-18, verbatim and untranslated:
  「organizationField 撤出可授权面 同意你的建议」.
  
  ## FROM → TO
  
  | you wrote (17.4 and earlier) | write instead |
  | --- | --- |
  | `tenancy: { enabled: false, organizationField: 'active_organization_id' }` | `tenancy: { enabled: false }` — delete the key. Nothing read it on an application object |
  | `tenancy: { enabled: true, organizationField: 'about_org_id' }` on an object whose tenant column really is `about_org_id` | `tenancy: { enabled: true, tenantField: 'about_org_id' }` — the surviving key both walls the object and stamps its platform rows |
  | you declared it to make one platform table's rows stamp differently | nothing to write. That divergence is a platform fact now, not a knob |
  
  The `tenancy` block is `.strict()`, so the key is **refused** with its prescription
  rather than stripped, and `os migrate meta --from 17` lists the mechanical edits for
  existing sources.
  
  ## What does NOT change
  
  The `sys_api_key` divergence is intact, and that is the point of the shape this takes.
  The credential table is `managedBy: 'better-auth'`, so `resolveInjectedSystemColumns`
  bails before tenancy is consulted and no `organization_id` is ever injected; the column
  it really carries is better-auth's `active_organization_id`. Its audit, approval and
  automation-run rows still stamp that column. What moved is only where the fact is
  written: `PLATFORM_STAMP_ORGANIZATION_COLUMNS` in `@objectstack/metadata-core`, one row,
  keyed by object name and read by the STAMP face alone. The WALL face
  (`resolveRecordWallOrganizationField`) never read the key and is untouched, so the
  stamp/wall divergence pin stands unchanged.
  
  ⛔ The column is **not** renamed to `organization_id` and must never be: in this platform
  "has an `organization_id` column" IS the wall, so the rename would wall the credential
  table on an equality that excludes NULL and every pre-existing key would vanish from its
  own owner's key list.
  
  ## For `@objectstack/metadata-core` consumers
  
  `resolveRecordOrganizationField` and `createRecordOrganizationResolver` keep their
  signatures and their four-limb precedence. Limb 0 is now keyed by the object's
  registered NAME against the platform table instead of by a declaration on the definition:
  the engine-bound resolver passes the name it was asked about, and the two-argument
  function reads `objectDef.name` when the definition carries one. A caller that fed it a
  hand-built definition carrying `tenancy.organizationField` — only reachable by
  reimplementing a platform writer — now gets limbs 1 to 4.
  
  The retirement kit, in the shape the playbook prescribes:
  
  - the key is DELETED from `TenancyConfigSchema` (the block is a `strictObject`), and a
    `TENANCY_RETIRED_KEY_GUIDANCE` row carries the prescription beside the two v15.0
    precedents (`tenancy.strategy`, `tenancy.crossTenantAccess`)
  - D2 conversion `object-tenancy-organization-field-removed` (`toMajor: 18`,
    `retiredFromLoadPath: true`) strips the key from authored sources and stored
    `sys_metadata` rows; D3 wires it into the protocol-18 chain step, and
    `RETIRED_KEYS_BY_MAJOR[18]` declares `data/TenancyConfig:organizationField`
  - the `authorable-surface/data.json` row is deleted in this same commit — the strict
    route's tripwire — with the build computing the guidance-route proof for itself
  - the liveness ledger row is deleted, since the key leaves the walked shape entirely
  - pin tests: the authored shape is refused with its prescription, and the `sys_api_key`
    stamp is pinned end to end beside the closed-set control (the same shape under any
    other object name takes the ordinary limbs)
  
  Clause-②: no
  
  <!-- adr-0087: registered object-tenancy-organization-field-removed -->
- e956924: feat(spec,metadata-core)!: every retired ADR-0087 conversion carries `retiredAfter`, and the artifact door opens its window per entry (#20390)
  
  Clause-②: yes
  
  <!-- adr-0087: not-required (runtime-interface-only packages/spec/src/conversions/types.ts#MetadataConversion) a TypeScript type with no Zod schema, no stored row and no authorable key; the compiler reports the missing member to every implementer, and no metadata shape changes -->
  
  **BREAKING** for code that implements `MetadataConversion` itself — shipped as `minor` under the launch-window convention (`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by this banner and the ADR-0087 disposition above). `MetadataConversion` is now a type alias of a live-or-retired union: an entry with `retiredFromLoadPath: true` must also carry `retiredAfter`, a stable `x.y.z` string, and a live entry carries neither. tsc names the missing member (`Property 'retiredAfter' is missing`). No in-repo conversion is left unstamped, and no metadata an author writes changes.
  
  **What the field means.** `retiredAfter` is the last published `@objectstack/spec` version whose authoring surface still accepted the entry's old shape. It is a fact when the entry lands: the package's own version label at that moment, because `main` carries the last release's label until the next release is cut. Every published retired entry is stamped from the published tarballs — the stable release just before the first tarball that carries it retired — and each entry not yet in any published tarball carries the current label, `17.4.0`.
  
  **Why the artifact door needed it.** Between two releases, `main` refuses keys that the next release retires while its label still reads the last release. The artifact-ingestion door (`applyArtifactForwardConversions`) compared an artifact's `engines.protocol` floor with that label alone, so an artifact built by the last published CLI — floor `^17.4.0`, dashboard `chartConfig.type`/`xAxis`/`yAxis` and page `assignedProfiles` — read as "authored current": nothing was converted and the strict parse refused the boot. The door now replays a registry entry when the floor is below the runtime label, **or** at or below that entry's `retiredAfter`. After a release the rule reduces to the old one, and an artifact whose floor is above an entry's `retiredAfter` still meets that entry's tombstone — a floor of `^17.5.0` on a 17.5.0 runtime is refused, not converted. `DEFAULT_FLIPS_NOT_REPLAYED_HERE` is still read first.
  
  **`@objectstack/metadata-core`.** `ArtifactForwardConversionVerdict` gains `'converted-retired-after'`: the floor is at or above the runtime label, but at or below the `retiredAfter` of at least one retired entry, and only those entries are replayed. `ArtifactForwardConversionResult` gains `replayedRetirements` (exported element type `ArtifactReplayedRetirement`): under that verdict, each retirement this runtime enforces past the artifact's floor, with its `retiredAfter`; empty for every other verdict. A consumer that switches exhaustively over the verdict adds that arm.
  
  **`@objectstack/metadata`, the artifact door — the arm added.** `MetadataPlugin` now reads which verdicts open the window from one total table over `ArtifactForwardConversionVerdict`, with `'converted-retired-after'` on the open side. The #12915 unbound form-predicate notice rides that same reading, so a 17.4.0-built artifact carrying a bare-root form predicate on `main` is announced now, rather than only once the package label moves past 17.4.0. A verdict added later fails to compile until it is placed on one side of the window. Under the new verdict the conversion summary no longer says the artifact "predates this runtime's spec" beside a runtime version equal to its floor: it names the retirement this runtime enforces past the artifact's floor, with the release that last accepted the shape, and says the artifact converts again on every boot until it is rebuilt with tooling from a release that ships the retirement. Summaries are still one per conversion per artifact, naming the site count.
  
  **Census.** 94 retired entries when this landed: 73 published (first retired in 15.1.0: 5, 17.0.0: 45, 17.1.0: 5, 17.2.0: 2, 17.3.0: 8, 17.4.0: 8) and 21 unpublished. `packages/spec/src/conversions/retired-after.census.json` holds the raw per-release facts, and `retired-after.census.test.ts` pins every value against it, offline. `packages/spec/scripts/build-retired-after-census.ts` re-derives the census from the npm registry (tarball integrity checked). Run it after each stable publish; `docs/releases-maintenance.md` lists that step in the GA release flow.
- 2bed4c3: fix(objectql)!: a field whose `type` is absent or is not a `FieldType` member is refused at the registration door, and every downstream family default becomes a refusal (#16319)
  
  <!-- adr-0087: not-required (no-migration-prescription) nothing an author can write is removed or renamed, and no conversion could repair these bodies: a field with no `type` carries no statement of intent for a conversion to rewrite, which is exactly the finding — the platform cannot know whether the author meant a bounded VARCHAR or an unbounded TEXT, and the two producers guessed differently. The remedy is a human decision per field, so it is prescribed in prose and in the refusal text rather than registered as a mechanical rewrite. -->
  
  **BREAKING** for stored metadata only: an object whose declaration carries a field with no `type`, or with a `type` that is not a `FieldType` member, **no longer loads**. Shipped as `minor` under the repo's launch-window convention. Maintainer ruling, 2026-09-10, verbatim: 「16319 一个没写 type(或拼错)的字段 应该禁止加载。这个才是合理的吧?其他同意」.
  
  **What you have to do.** Nothing, unless a `sys_metadata` row in your deployment carries such a field. If one does, the startup log names it at `error` level — object, field and reason — and the row is left untouched and still reachable: open it in Studio and give the field a real `FieldType` member, or delete it (`DELETE /api/v1/metadata/object/NAME`). Nothing that passes `FieldSchema` is affected: it has always required `type` and always refused a non-member, so only the doors that skip Zod could ever deliver one.
  
  ## What was wrong
  
  One declaration produced two different columns. Measured on live PostgreSQL 16.13, driving all three producers from one object:
  
  | declaration | driver | `os generate migration --format sql` | `--format ts` |
  |:---|:---|:---|:---|
  | `{ maxLength: 100 }`, no `type` | `character varying(100)` | `TEXT` | `TEXT` |
  | `{ type: 'this_is_not_a_field_type', maxLength: 100 }` | `character varying(255)` | `TEXT` | `TEXT` |
  
  `SqlDriver.createColumn` read `field.type || 'string'`, which heads its STRING-family arm and sizes the column from the declared `maxLength` (knex's 255 without one). All four generator loops in `os generate` read `String(fieldDef.type || 'text')`, which heads the TEXT family — unbounded unless the column is keyed. Both directions of harm are in the first row: the platform refuses a 101-character value that both generated tables accept, and a table generated from the same object accepts values the platform will not store.
  
  ## What it does now
  
  - **One point of closure, at the registration door.** `SchemaRegistry.registerObject` refuses the WHOLE object declaration, with the ADR-0112 envelope (`INVALID_METADATA` + `422`), naming the object, the field and the reason — and offering the spec's own "did you mean?" for a mis-spelling. ⛔ The offending field is never dropped on its own: an object loaded one field short reports success at every authoring surface while the column is never created and every read of it answers `undefined`. Every door goes through this one — declared stacks, package and plugin manifests, `saveMetaItem`, the `sys_metadata` boot rehydration, and raw `registerObject` calls — and all three contributor kinds (`own`, `overlay`, `extend`) are judged, because `ObjectSchema.fields` and `ObjectExtensionSchema.fields` are both `z.record(z.string(), FieldSchema)`.
  - **The startup policy is revised for this class.** `loadMetaFromDb`'s 「Registered anyway so it stays serveable and fixable」 no longer applies to it. The row does not register; the startup log states the consequence and the fix once, at `error`. The row itself is untouched, and the metadata API's raw-row path still lists it, still serves it with the offending field visible, still accepts a corrected write, and still deletes it — pinned, because a refused row that vanished from Studio would be unfixable.
  - **Downstream guesses become refusals.** `createColumn` refuses a field that declares no `type` instead of building `varchar(255)` for it. All four `os generate` loops — both migration formats and both `os generate types` loops — refuse an absent or non-member `type` and generate nothing for that object, rather than emitting a table one column short. `fieldTypeToSql`'s docblock is rewritten in the same stroke: its `TEXT` miss branch is now dead residue of a total table, ⛔ not a family default to route anything new to.
  
  ## Scope, stated rather than left to be inferred
  
  `SqlDriver.createColumn` refuses `type` ABSENCE, not `FieldType` MEMBERSHIP. Membership is refused for the whole object at the registration door, which fronts every route into `syncSchema`, so a non-member cannot reach the driver from a runtime at all. `driver-sql`'s own test corpus declares 388 non-member spellings across ~100 files that drive `initObjects` directly, and `'string'` is a declared `case` arm of that switch whose column shape differs from every member's — so closing that half is a corpus migration with column consequences, deliberately not folded into this change. A pin holds the boundary in both directions.
  
  ONE fixture in that corpus is migrated here, because it is the one that crosses the door. `CROSS_FIELD_OBJECT_FIELDS` — exported from this package's root, so a published export and not only a local literal — declared `stage` and `owner` as `'string'`. Four of its five consumers hand it to `driver.initObjects`, which the paragraph above leaves alone; the fifth hands it to `ql.registerObject`, which now refuses the whole object. Both fields are re-spelled `'text'`. That is not a re-typing: `canonicalizeSqlType('varchar(255)')` is `'text'` and `suggestFieldTypeForSqlType('varchar(255)')` is `'text'`, both pinned in `spec/data/type-compat.test.ts`, so `'text'` is the spelling of the column `'string'` was already producing. It does move the emitted column from `varchar(255)` to `TEXT` (measured on sqlite-wasm: `stage varchar(255)` becomes `stage text`), which is inert for this fixture — no index keys either column, `initObjects` is passed no indexes, and the corpus's longest value in them is four characters.
- 0a56d3b: feat(spec,types,triggers)!: `group` runs package-authored scheduled work without a declaration, owning each run's writes per record (#18378)
  
  <!-- adr-0087: not-required (already-registered schedule-flow-acting-organization-required) This amends the EXISTING semantic entry rather than adding one: same authorable key, same deployment switch, same surface, and the entry predates this diff at the merge base. Nothing is renamed, retired or re-typed — the start node's `config` is an open record (ADR-0018), so every flow that parses today parses byte-identically afterwards and `objectstack migrate meta` has nothing new to rewrite. What moves is the BIND-time accept set (it WIDENS) and the RUN-time organization such a flow's writes carry; the entry's own surface/replacement/reason/acceptanceCriteria each gained their `group` row in this diff. -->
  
  `Clause-②: yes (widening)`
  
  **ADR-0087 disposition — `not-required (already-registered)`, not `registered`.**
  The ledger entry this change belongs to already exists
  (`schedule-flow-acting-organization-required`, entry 18) and predates this diff
  at the merge base, so `registered` would assert a registration this PR did not
  make. The entry's `surface`, `replacement`, `reason` and `acceptanceCriteria`
  each gained their `group` row here, the rejected bootstrap-organization arm
  included — recorded because it is the one a later reader will re-propose.
  
  **Marked breaking (`!`) for the behaviour change, not for a narrowing.** Nothing
  that worked stops working and nothing that was admitted becomes refused — the
  accept set WIDENS in one cell. What earns the banner is the other direction: on a
  `group` deployment with the switch already on, flows that were refused at bind
  now arm and run, so clock-driven work appears where an operator had none. That is
  worth reading before upgrading even though no consumer has to change anything.
  
  ## What changes
  
  With `OS_AUTOMATION_SCHEDULED_WORK_ENABLED` on and tenancy posture `group`, a
  time-triggered flow that declares no `config.organization` now **binds and
  runs**, where it was previously refused at bind. The organization its writes
  carry follows the record:
  
  | posture | declaration | a bound run's writes act as |
  |---|---|---|
  | `single` | not read | nothing — the install's one organization resolves beneath each write |
  | `group` | **optional** | declared ⇒ the declaration; undeclared ⇒ **the swept record's own organization** |
  | `isolated` | **required** | the declaration; undeclared ⇒ not armed, unchanged |
  
  A `timeRelative` sweep under `group` reads group-wide — inherent to the posture
  (ADR-0105 D1) — and stamps each run it launches with that record's organization:
  sweep contracts across four plants and each plant's contract yields a run acting
  as that plant, whose notifications reach that plant's inboxes.
  
  ## Why this is not a fallback that guesses
  
  It is the order `sys_automation_run` was **already** ruled to use.
  `ObjectStoreSuspendedRunStore` resolves a run's organization as
  `organizationOf(<subject record>) ?? ctx.tenantId` — subject first, acting
  context as the fallback and never the primary. Before this change those two
  halves disagreed under `group`: the history row was stamped from the record while
  the inbox and delivery rows followed an acting context that could not exist
  there, so they were refused while the tick summarised itself as healthy.
  
  ⚠️ With one stated exception, because the two halves ask different questions:
  the history row is STAMPED (`tenancy.organizationField` wins there) while the
  run's acting organization is a WALL reading that never consults that key. They
  agree on every object where the two coincide — which is every ordinary object,
  since a declared stamp column is what makes them differ and one shipped object
  declares one (`sys_api_key`, deliberately unwalled). Sweeping that object under
  `group` stamps its history row while the run itself acts as nothing: the correct
  pair of answers, not a residue of the old disagreement, and recorded rather than
  smoothed over.
  
  ⛔ A record-less run under `group` that declared nothing still resolves
  **nothing** and is refused at its first tenant-scoped write (`walled-posture`,
  ADR-0112), loudly and by name. The rejected alternative was a fallback to the
  bootstrap organization (`slug='default'`): under a wall that organization is
  minted admin-keyed by the enterprise organizations runtime and may not exist at
  all, and where it does it is whichever organization the platform owner
  registered under — plausibly one plant of many, not the group's head office.
  
  ## Upgrading
  
  **Most deployments: nothing to do.** The switch this depends on is OFF by default
  and ships unreleased alongside this change, so the `group`-is-walled behaviour
  being amended has never appeared in a published version — no released consumer
  can be relying on it.
  
  If you run posture `group` **and** turn the switch on, read your boot log: each
  time-triggered flow's bind line now names which of the three shapes it bound as
  ("as organization '…'", "with per-record acting organization", or "with NO
  acting organization"). Two things to check:
  
  - A flow you expected to act as ONE organization but which binds per-record is
    missing its `config.organization`. Add it — declaring still narrows, bounding
    the sweep's query as well as its identity.
  - A plain `schedule` cron flow that binds "with NO acting organization" has no
    record to derive one from. If it writes notifications, inbox messages or any
    other per-organization row, declare `organization` on its start node; the bind
    line says so, and so does the refusal at the first tick.
  
  ## Which organization a record belongs to — the WALL question, not the stamp one
  
  `@objectstack/metadata-core` gains a second face on the record→organization
  resolver, and the split is the point: `resolveRecordOrganizationField` /
  `createRecordOrganizationResolver` answer **"who is this row ABOUT"** (the STAMP
  question, whose `tenancy.organizationField` limb stays pinned to the three
  sanctioned platform-row writers), while the new
  `resolveRecordWallOrganizationField` / `createRecordWallOrganizationResolver`
  answer **"what is this row WALLED by"** — `tenancy.enabled: false` ⇒ nothing,
  then a declared `tenancy.tenantField`, then the kernel's `organization_id`.
  
  The sweep uses the WALL face, because "which organization does this run act as"
  is a question about the wall. ⛔ It never reads `tenancy.organizationField`: that
  key is declared on exactly one shipped object (`sys_api_key`, deliberately
  unwalled, #8287), and reading it here would turn "the audit trail should follow
  this row's own organization even though nothing walls it" into an acting
  identity. A sweep over such an object resolves **nothing** and takes the
  `walled-posture` refusal at its first tenant-scoped write, which is the honest
  answer. Limbs 1 to 4 are one implementation shared by both faces, pinned as
  such, so the half they agree on cannot drift apart.
  
  **API:** `ScheduledWorkPolicy` gains `runOwnership: 'unscoped' | 'per-record' |
  'declared'`, and `requiresActingOrganization` narrows from "any walled posture"
  to `isolated` only. The two are deliberately separate axes: the boolean decides
  whether BIND refuses, `runOwnership` decides what a run that DID bind carries.
  Inside `@objectstack/trigger-schedule`, both triggers share one bind-line
  vocabulary (`describeScheduleRunOwnership`) so they cannot describe one
  deployment differently. ⚠️ That helper is module-level, NOT a package export: it
  is not re-exported from the package barrel, whose own note says an export whose
  only consumers live inside its own package belongs in a non-barrel module. The
  new PUBLIC surface in this change is `ScheduledRunOwnership` and the
  `runOwnership` key on `@objectstack/types`, plus
  `resolveRecordWallOrganizationField` and
  `createRecordWallOrganizationResolver` on `@objectstack/metadata-core` — and
  those four are what put `Clause-②` at `yes`. Nothing existing is renamed or
  re-typed: both stamp-face exports keep their names, their signatures and their
  answers, limb 0 included.
- cca1dc0: <!-- adr-0087: not-required (no-migration-prescription) both renamed members are RUNTIME OUTPUT, not authored metadata: a CLI `--json` key emitted from an inline object literal, and a member of a TypeScript diagnostic object built at throw time. Neither has a Zod schema, a `packages/spec` declaration or a stored representation, so `objectstack migrate meta` has nothing to reach and a ledger entry would project into `spec-changes.json` and the upgrade guide as an instruction no metadata upgrader can act on. The prescription in this body addresses a SOURCE-CODE and stdout-reading consumer, whose delivery channel is the compiler and this changelog (ADR-0087 D8) -- the same disposition and the same argument as the `specVersionGap` to `protocolVersionGap` rename that shipped from this repo. -->
  
  feat(cli,metadata-core)!: the protocol version is emitted under `protocolVersion`, never under a `runtime`-shaped name (#15585)
  
  **BREAKING** — two published machine surfaces change a key name. There is **no alias
  and no dual-key transition window**: one axis, one name.
  
  | Surface | Was | Now |
  |:--|:--|:--|
  | `os migrate meta --json` payload | `runtime` | `protocolVersion` |
  | `OS_PROTOCOL_INCOMPATIBLE` diagnostic (`ProtocolIncompatibleError.diagnostic`) | `runtimeVersion` | `protocolVersion` |
  | `checkProtocolCompat()` / `assertProtocolCompat()` 2nd parameter | `runtimeVersion` | `protocolVersion` |
  
  The **value** is unchanged on every one of them: it is `PROTOCOL_VERSION`, the protocol
  major padded to a semver (`'17.0.0'`), exactly as before. Nothing else on either payload
  moves — no other key is added, removed or reshaped, and both text faces are byte-identical.
  The parameter rename is positional, so no call site changes.
  
  ## Why the name had to move
  
  `PROTOCOL_VERSION` is the protocol major padded to a semver and never tracks the installed
  `@objectstack/cli` or runtime package version. Printed or emitted under the word *runtime*
  it read as one: on a 17.3.0 install `runtime: "17.0.0"` reads as an apparent downgrade or
  a stale install, next to the real package versions of the same upgrade session.
  
  The human line was repaired first and now reads
  `Chain:  protocol 17 → 17 (this runtime implements protocol 17)`. The machine face is the
  worse half and was left standing, because a key on a published payload is a contract
  change: an agent scripting an upgrade has no prose to disambiguate at all, and the
  diagnostic's own `message` — which *is* unambiguous — is the one part a machine consumer
  does not parse.
  
  ## What a consumer should do
  
  Read the new key. The old one is absent, so a consumer that does not move reads
  `undefined` rather than a wrong value.
  
  ```diff
  - const v = payload.runtime;                  // os migrate meta --json
  + const v = payload.protocolVersion;
  
  - const v = err.diagnostic.runtimeVersion;    // OS_PROTOCOL_INCOMPATIBLE
  + const v = err.diagnostic.protocolVersion;
  ```
  
  The diagnostic surfaces through every package that re-emits it — `@objectstack/runtime`
  spreads it into `ArtifactReferenceError.detail`, `@objectstack/metadata-protocol` throws it
  from the package install boundary, and `@objectstack/services-package` reads it during
  hydration — so a consumer reading it from any of those reads the new name too.
  
  `runtimeMajor` on the same diagnostic is deliberately **unchanged**: it is an integer
  protocol major, not a semver in a version position, and it does not carry the ambiguity
  this rename closes.
  
  The breaking surface was measured before the rename and is closed inside this repository:
  the only reader of the `--json` key was this repo's own e2e pin and the only reader of the
  diagnostic member was `metadata-core`'s own unit test, both of which move in this same
  change; the published `skills/objectstack-upgrade/SKILL.md` documents `--json` without ever
  naming the field. **Zero external consumers were found.** Graded `minor` rather than
  `major` for the launch window; the banner above carries the breaking-ness the level cannot.

### Patch Changes

- 0283cb9: feat(automation)!: an edge-branched `decision` is exclusive — the first out-edge whose condition holds, in declaration order, wins; `mode: 'inclusive'` takes every one (#15429)
  
  <!-- adr-0087: registered flow-decision-mode-inclusive-explicit -->
  
  Clause-②: yes
  
  **BREAKING** — the run-time semantics of a shipped node type change. A `decision` node that
  declares no `config.conditions` and branches on its out-edges used to take EVERY out-edge whose
  condition held, one after another, while its schema, the docs and the engine's own comment all
  called it an exclusive gateway; hotcrm#1555 rendered a refusal screen AND ran the conversion in
  one execution. Maintainer ruling on #15429 (2026-09-23, 「跟主流对齐」): the gateway follows
  BPMN's exclusive gateway, Salesforce Flow's Decision and n8n's Switch default, and taking every
  true branch is a declaration the author writes down.
  
  | | before | after |
  |:--|:--|:--|
  | two conditioned out-edges, both hold | both successors run, sequentially, nothing reported | the FIRST declared one runs; the second records a `skipped` step |
  | `config: { mode: 'inclusive' }` | accepted, never read | every out-edge whose condition holds runs, sequentially |
  | none holds | the `isDefault` edge runs | unchanged |
  | `mode` beside a non-empty `conditions` list, or outside `'exclusive' \| 'inclusive'` | refused by a direct parse only | refused at `registerFlow` and by `os validate`, with the schema's own sentence |
  
  ## Migration: FROM → TO
  
  `os migrate meta --from 17` lists the mechanical edits for existing sources and applies them
  to the migrated stack: the ADR-0087 D2 conversion `flow-decision-mode-inclusive-explicit`
  writes `mode: 'inclusive'` onto every decision that has no `conditions` list and two or more
  conditioned out-edges, inside ADR-0031 regions included, so a migrated flow runs exactly as it
  did.
  
  ```ts
  // FROM — every true out-edge ran
  { id: 'verdict', type: 'decision', label: 'Verdict?' }
  // TO — what the conversion writes; delete the key where the conditions partition
  { id: 'verdict', type: 'decision', label: 'Verdict?', config: { mode: 'inclusive' } }
  ```
  
  Then review each written key (the paired D3 entry `flow-decision-edge-branching-first-match`
  carries the acceptance criteria): delete it where the conditions partition (`== 'a'` beside
  `!= 'a'`, `>` beside `<=`, a guard beside `isDefault: true`), keep it where the flow relies on
  more than one branch running for one record, and where the overlap was accidental narrow the
  conditions into a partition and delete the key. `os validate` reports
  `flow-decision-inclusive-overlap` on every decision that keeps the key with two or more
  conditioned out-edges, so the review list is the lint output.
  
  ## BREAKING for flows stored in `sys_metadata` — maintainer ruling letter C on #15429
  
  A `decision` node stored in `sys_metadata` (a flow built or edited in the Studio designer) with
  **no `config.conditions`, no `mode`, and two or more out-edges carrying a `condition`** evaluates
  **first-match** after this upgrade: where it took every out-edge whose condition held, it now takes
  only the first one that holds, in the order the flow declares its edges. Nothing rewrites that row
  — no stored-row migration, no cutoff, no read-path completion — because nothing about a stored row
  says it was saved before the flip. The one-line fix, for a node that meant every branch:
  
  ```ts
  { id: 'route', type: 'decision', label: 'Route', config: { mode: 'inclusive' } }
  ```
  
  `os migrate meta --stored` (and `POST /api/v1/meta/_migrate-stored`) lists every such node under
  `decisionModeReview` — flow row, node id, label and path — on a preview and an `--apply` run
  alike, and writes nothing for it: the list moves no row outcome, no count and no exit code, so an
  operator can review the candidates before and after the upgrade. A node leaves the list once it
  declares `mode`, either member. Every such node in the measured corpus below is a partition, where
  the new meaning runs exactly what the old one did.
  
  Authored sources and built artifacts keep the old behaviour instead, where the source's age is a
  fact: `os migrate meta --from 17` writes `mode: 'inclusive'` (above), while the authoring funnel,
  the automation engine's flow rehydration seam and the artifact-ingestion door all refuse the
  conversion by id — a default flip replayed there would turn a decision written today against this
  contract, where an omitted `mode` means exclusive, into an inclusive gateway.
  
  ## Reach, measured at landing
  
  - Release state: the npm registry's `latest` `@objectstack/spec` is `17.4.0` (`npm view`,
    2026-09-27), whose `json-schema/automation/DecisionConfig.json` declares `conditions` only —
    `mode` has not shipped; `.changeset/19867-decision-config-mode.md` and
    `.changeset/20168-decision-mode-beside-conditions-refused.md` are still unconsumed in this
    tree. So `mode` reaches its first release together with the traversal that reads it and the
    conversion that writes it; no published accept set narrows, and the registration and
    `os validate` refusals narrow nothing that shipped.
  - Corpus census (this repository at the branch base and `objectstack-ai/hotcrm` at `2f7b2326`,
    read-only): 30 decision nodes across 48 flows; 17 have two or more conditioned out-edges and
    no `mode` (the conversion's positives — every one a hand-written partition, including
    hotcrm's `lead_conversion.decision_duplicate`, the #1555 node), 13 have one conditioned
    out-edge (left alone), and no node of any other type carries a conditioned out-edge, so the
    exclusive traversal is scoped to `decision` with nothing else to migrate.
  - What the published surface gains: the D2 conversion and its D3 entry in the protocol-18
    chain (`spec-changes.json`, the upgrade guide), `DecisionConfigSchema.mode`'s describe and
    docblock now state the run-time semantics, and `@objectstack/lint` gains
    `flow-decision-mode-invalid` (gating) and `flow-decision-inclusive-overlap` (advisory).
  
  The traversal change is scoped to `decision` nodes: conditioned out-edges of any other node
  type keep the every-true-edge traversal they had (none was measured to exist).
- 134b410: The artifact-ingestion door no longer replays the **default-flip** class of ADR-0087 conversion, so an artifact carrying `defineApp({ hidden: true })` is registered with `hidden: true` — not as an unpublished app (#17885, #4829).
  
  `app-hidden-to-unpublished` rewrites `app.hidden: true` into `app._unpublished: true`. Both keys are live and they mean opposite kinds of thing: `hidden` is navigation presentation and *"never an access gate"* (`ui/app.zod.ts`), while `_unpublished` is the machine-managed publish gate `filterAppForUser` drops the app on for every user without `studio.access` / `setup.access`. Measured before the change, on an artifact declaring `engines.protocol: ^17.0.0` — the range `create-objectstack` stamps — against a 17.4.0 runtime: the door emitted the `app-hidden-to-unpublished` notice and the object that reached registration carried `hidden: undefined`, `_unpublished: true`. So an author who asked for "keep this out of the App Switcher" got "nobody but a builder can see this" — the incident the `_unpublished` split was introduced to end, arriving through the conversion layer.
  
  - **The entry is not withdrawn and no key moves.** It still fires where its precondition is a fact — the stored-row rehydration seams (a pre-split `hidden: true` row can only have come from the materialization path) and `os migrate meta`, where the operator asserts the source's age. What changed is that the artifact door, whose evidence is the artifact's **declared `engines.protocol` floor** rather than its age, no longer treats that guess as sufficient for a rewrite that reinterprets a live authorable key.
  - **The retired window stays open.** Closing it wholesale would fix this and re-break #12772: an artifact built by 17.1.0 tooling carrying `allowRestore` / `allowPurge` would again be refused at the tombstone with no operator remedy. The door refuses one named class by id, with its reason written beside it, and the pin drives a retired conversion and a non-retired one through the same window to prove it.
  - **New seam option, no new export.** `applyConversions` accepts `excludeConversionIds` — the seat-level spelling of "my evidence cannot carry this entry". `retiredFromLoadPath` cannot express it: that flag's jurisdiction is the authoring funnel and nothing else.
  - ⛔ **The consumer is unchanged.** `filterAppForUser` withholding on `_unpublished` is correct; the defect was who writes `_unpublished`.
  
  Deployments whose apps were being served as unpublished purely because of a permissive `engines.protocol` range will see those apps again, for every user, on the next boot. No artifact file changes and no stored row is rewritten.
- 95fb417: **The declared `zod` floor moves from `^4.4.3` to `^4.6.1`**, because on zod below 4.6.1 the three standard error formatters — `z.treeifyError()`, `error.format()` and `error.flatten()` — cannot render a refusal these packages actually emit (#19581).
  
  Clause-②: no
  
  **What breaks below the new floor.** All three formatters walked an issue's `path` by reading `curr[el]` and testing it for truthiness before creating a node, so a path element naming a member of `Object.prototype` was answered by the prototype and no node was ever created. Two different failures follow:
  
  | path shape | what happened on `^4.4.3` |
  |:---|:---|
  | terminal element (`['assignments','__proto__']`, `['x','toString']`) | the inherited member is adopted as the node, then `node._errors.push(...)` runs on it — `TypeError: Cannot read properties of undefined (reading 'push')` |
  | non-terminal element (`['__proto__', …]`) | the walk continues **into** `Object.prototype` and writes the next segment onto it — the message is silently dropped from the returned tree and the process gains a global prototype key |
  
  **Why it reached this platform's consumers.** `@objectstack/spec` refuses a `__proto__` key on its open-key authoring surfaces, and that refusal's issue path is `['assignments','__proto__']` — precisely the terminal shape. Anything that formatted one of these refusals for display crashed on it, and the crash was in the formatter, not in the guard. The guards themselves are unchanged and still necessary: 4.6.1 still drops a `__proto__` key from `z.record()` and `.catchall()` output, which is what they exist to refuse.
  
  **What an upgrading consumer must do.** Nothing, if `zod` is resolved through these packages — the floor does it. A consumer that pins `zod` itself must move that pin to `^4.6.1` or higher; a pin below it reintroduces the crash on any refusal whose path names an `Object.prototype` member, including the ones these packages emit.
  
  `@objectstack/lint` also moves, but only in `devDependencies`, so nothing it publishes changes for a consumer and it takes no release here.
  
  ## The second half the floor move needs: an unknown key refuses TERMINALLY again
  
  From zod 4.5.0 an `unrecognized_keys` issue carries `continue: true`, so it no
  longer aborts the shape that raised it. Two things follow, and both were
  measured on this package with the same bodies on 4.4.3 and 4.6.1:
  
  1. **A closed shape's own refinements now run after the refusal**, adding a
     second complaint that contradicts the first.
  2. **A union containing that shape loses its envelope.** zod's
     `handleUnionResults` returns a single non-aborted member's issues
     *unwrapped* instead of raising `invalid_union`, so the union's message
     becomes whichever branch zod judged closest.
  
  At `PUT /api/v1/meta/view` that turned a retired-value refusal into the wrong
  branch's prescription. Writing `type: 'page'` on a ViewItem answered:
  
  ```
  Unrecognized key(s) on this view container: `viewKind`, `config`.
    • `viewKind` belongs to a single VIEW, not to the container. Wrap it: …
  ```
  
  — naming neither `page` nor its removal. It now answers, as it did before:
  
  ```
  config.type: 'page' was removed from the list-view `type` enum in
  @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) — …
  ```
  
  **What an upgrading consumer must do.** Nothing. No key or value changed
  status: everything this package accepted before it accepts now, and everything
  it refused it still refuses. What changed is which of several competing
  complaints an author reads, and that a refusal behind a union is again
  reported as `invalid_union` with its branches, which is what `z.treeifyError()`
  and this package's own `formatZodError` expand.
  
  ⚠️ A closed shape declared with a bare `z.object(…).strict()` or
  `z.strictObject(…)` — zod's own, not this package's `strictObject` — does NOT
  get this and will still collapse its union. Build closed authoring shapes with
  `strictObject`, or re-declare an existing one through `closedObject`.
- 8cbc3c0: docs(metadata-core): the `item-key-discriminators` module docblock quoted a spec sentence that no longer exists and that the contract denies ("best match") (#19592)
  
  Clause-②: no — no accept set moves, no published payload key changes, no
  export is added or removed. The corrected prose ships as TSDoc in
  `@objectstack/metadata-core`'s `dist/index.d.ts` and `dist/index.d.cts` (the
  package publishes `dist`), which is why this is a changeset rather than
  `skip-changeset`.
  
  The module docblock of `packages/metadata-core/src/item-key-discriminators.ts`
  put a sentence inside quotation marks and attributed it to
  `EmailTemplateDefinitionSchema` in `packages/spec/src/system/email-template.zod.ts`:
  that the service "picks the best match for the recipient's locale". That
  sentence occurs nowhere in `packages/spec/src` today, and it states the opposite
  of the contract: `SendTemplateInput.template` in
  `packages/spec/src/contracts/email-service.ts` says there is no "best match" and
  no language-subtag folding.
  
  The docblock now cites the spec by file and symbol instead of quoting it. It
  says the `locale` key is the second half of the bundle key, that resolution is
  exact, and that `SendTemplateInput.locale` holds the ladder: the named tag matched
  exactly, then the literal `en-US`, then, only for a call that named no locale and
  only when the bundle has no `en-US` row, the bundle's lowest locale tag. The one
  quotation left in the docblock ("is resolved by `(name, locale)`", from the
  schema's header) still exists verbatim in the spec.
  
  No behaviour changes: the edit is prose. `ITEM_KEY_DISCRIMINATORS`,
  `readDiscriminatorValue`, `itemDiscriminator` and the `en-US` canonical are
  untouched.
- 7536721: `ENGINE_DELETE_DISPATCH_CASES` and `ENGINE_UPDATE_DISPATCH_CASES` retire their three ARRAY `where.id` rows (#19757)
  
  The engine-double conformance tables no longer carry these three rows:
  
  - delete's `array id, no multi`
  - update's `array id, no multi`
  - update's `a SCALAR data.id beside an ARRAY where.id`
  
  Each row puts `where: { id: ['a', 'b'] }` in the equality slot. Since this release's `@objectstack/spec` change, the shared comparand-shape face refuses an array in that slot with `INVALID_FILTER` / 400. The face runs at the engine's lowering seam, which every verb crosses before the dispatch runs, so the real engine never reaches the dispatch predicate with such an input. A row claiming a dispatch verdict for it would pin a branch the engine cannot reach. It was measured red against the real engine: `ObjectQL.delete` / `ObjectQL.update` refused the input with the face's words, not the dispatch's.
  
  The predicates themselves are unchanged. `resolveEngineDeleteDispatch` / `resolveEngineUpdateDispatch` and the `assert*` helpers still answer an array `where.id` with `reject`, and `scalarDeleteId` / `scalarUpdateId` still treat an array as not-an-id. A test double bound to them therefore still refuses such a call, with the dispatch's sentence. No double runs the shared filter face, for this shape or for any other face refusal. The `$in` rows keep the "a non-scalar `where.id` is not an id" coverage, including the #11230 refusal beside a scalar payload id.
  
  If you run these tables against your own engine double, it has three fewer cases to answer. Nothing else changes.
- Updated dependencies [863c7c4]
- Updated dependencies [0f95f43]
- Updated dependencies [825d70f]
- Updated dependencies [6057357]
- Updated dependencies [a60e04d]
- Updated dependencies [abc4b83]
- Updated dependencies [7382c5d]
- Updated dependencies [ea2940d]
- Updated dependencies [7d0f911]
- Updated dependencies [48f5200]
- Updated dependencies [245f360]
- Updated dependencies [d0f1845]
- Updated dependencies [9dcdb77]
- Updated dependencies [6175da8]
- Updated dependencies [0283cb9]
- Updated dependencies [324968e]
- Updated dependencies [7843663]
- Updated dependencies [ce57857]
- Updated dependencies [744a0a3]
- Updated dependencies [c7d4825]
- Updated dependencies [4844840]
- Updated dependencies [fe71032]
- Updated dependencies [74eaab8]
- Updated dependencies [0b788da]
- Updated dependencies [f7a3495]
- Updated dependencies [97f4f8c]
- Updated dependencies [482d34d]
- Updated dependencies [7a25a3e]
- Updated dependencies [839d1b0]
- Updated dependencies [2fc092b]
- Updated dependencies [2dfe070]
- Updated dependencies [6059b29]
- Updated dependencies [88a072e]
- Updated dependencies [d4a1a28]
- Updated dependencies [3d8779d]
- Updated dependencies [0bd7dae]
- Updated dependencies [d34f9b6]
- Updated dependencies [57343f7]
- Updated dependencies [271d6bb]
- Updated dependencies [1e20f81]
- Updated dependencies [38472ce]
- Updated dependencies [8b48903]
- Updated dependencies [2d235bc]
- Updated dependencies [aaacf1d]
- Updated dependencies [9dacf61]
- Updated dependencies [146c291]
- Updated dependencies [4db1bf1]
- Updated dependencies [e0e4a56]
- Updated dependencies [7aae005]
- Updated dependencies [bdb247d]
- Updated dependencies [d5c91dd]
- Updated dependencies [0e51278]
- Updated dependencies [48203ff]
- Updated dependencies [ada2869]
- Updated dependencies [d88a47d]
- Updated dependencies [2f1a6f6]
- Updated dependencies [23fc5d6]
- Updated dependencies [2d34f32]
- Updated dependencies [7b1e4a4]
- Updated dependencies [d7c0241]
- Updated dependencies [9e3c485]
- Updated dependencies [e1796ad]
- Updated dependencies [8271c81]
- Updated dependencies [c9eb773]
- Updated dependencies [fbc12be]
- Updated dependencies [ec2ede0]
- Updated dependencies [4342c99]
- Updated dependencies [132dd13]
- Updated dependencies [d285bf0]
- Updated dependencies [dfeba25]
- Updated dependencies [9059a94]
- Updated dependencies [0a88a80]
- Updated dependencies [2c1011b]
- Updated dependencies [12bb672]
- Updated dependencies [97233b9]
- Updated dependencies [c199772]
- Updated dependencies [f5a7250]
- Updated dependencies [1a2bb9e]
- Updated dependencies [eea7ccc]
- Updated dependencies [097d268]
- Updated dependencies [182bbde]
- Updated dependencies [5ce3705]
- Updated dependencies [24d622b]
- Updated dependencies [0252320]
- Updated dependencies [2eb4724]
- Updated dependencies [e04a0af]
- Updated dependencies [6b97a20]
- Updated dependencies [75237a9]
- Updated dependencies [497655f]
- Updated dependencies [ada7012]
- Updated dependencies [3a9ad22]
- Updated dependencies [6d2571f]
- Updated dependencies [2bf6ef1]
- Updated dependencies [092d460]
- Updated dependencies [09e16a5]
- Updated dependencies [98bd798]
- Updated dependencies [cbcae14]
- Updated dependencies [8261ff7]
- Updated dependencies [24489f1]
- Updated dependencies [fc28c1d]
- Updated dependencies [6d64785]
- Updated dependencies [00c332b]
- Updated dependencies [b3b43b6]
- Updated dependencies [d93400f]
- Updated dependencies [b1d3945]
- Updated dependencies [134b410]
- Updated dependencies [84e6b05]
- Updated dependencies [cb1f274]
- Updated dependencies [5c28cc7]
- Updated dependencies [b0eb9a5]
- Updated dependencies [e233db9]
- Updated dependencies [176b035]
- Updated dependencies [a83dbb6]
- Updated dependencies [d3a2331]
- Updated dependencies [51297e9]
- Updated dependencies [2d892dd]
- Updated dependencies [156792e]
- Updated dependencies [5ba2ec3]
- Updated dependencies [abb01f1]
- Updated dependencies [e64ae15]
- Updated dependencies [02bdeaa]
- Updated dependencies [66abef3]
- Updated dependencies [25c9a83]
- Updated dependencies [ee5812a]
- Updated dependencies [68fea8b]
- Updated dependencies [c049e74]
- Updated dependencies [bb9794a]
- Updated dependencies [d402e32]
- Updated dependencies [63a8eb4]
- Updated dependencies [9a910c4]
- Updated dependencies [adabccf]
- Updated dependencies [340b6dc]
- Updated dependencies [99fcb4a]
- Updated dependencies [55095cc]
- Updated dependencies [0f1cd83]
- Updated dependencies [a3d4c59]
- Updated dependencies [1aa5026]
- Updated dependencies [2b80461]
- Updated dependencies [2bdb81f]
- Updated dependencies [b9d5422]
- Updated dependencies [c7448dc]
- Updated dependencies [627382b]
- Updated dependencies [0b31d90]
- Updated dependencies [4b58dcf]
- Updated dependencies [c23cfb3]
- Updated dependencies [559041d]
- Updated dependencies [e0d0553]
- Updated dependencies [5100c42]
- Updated dependencies [596090e]
- Updated dependencies [5380daa]
- Updated dependencies [00b38d7]
- Updated dependencies [47a9002]
- Updated dependencies [7056ca5]
- Updated dependencies [731f020]
- Updated dependencies [5eebc9e]
- Updated dependencies [72c1640]
- Updated dependencies [5e5ec9f]
- Updated dependencies [170fd83]
- Updated dependencies [922923b]
- Updated dependencies [2cac363]
- Updated dependencies [fc91239]
- Updated dependencies [e6c34f6]
- Updated dependencies [062f5cd]
- Updated dependencies [5d8319f]
- Updated dependencies [43f4766]
- Updated dependencies [8e8ea99]
- Updated dependencies [a484966]
- Updated dependencies [021755a]
- Updated dependencies [b929e0a]
- Updated dependencies [dbd4744]
- Updated dependencies [14a762f]
- Updated dependencies [b146102]
- Updated dependencies [75c0dac]
- Updated dependencies [9bb059d]
- Updated dependencies [07c6f82]
- Updated dependencies [502f179]
- Updated dependencies [f20fe29]
- Updated dependencies [362035c]
- Updated dependencies [7e0bfce]
- Updated dependencies [c120dbd]
- Updated dependencies [32b5831]
- Updated dependencies [74554a3]
- Updated dependencies [e56112c]
- Updated dependencies [aeaaa44]
- Updated dependencies [43460b9]
- Updated dependencies [44a2332]
- Updated dependencies [f34dda6]
- Updated dependencies [488f4f5]
- Updated dependencies [15f9284]
- Updated dependencies [a4ca69a]
- Updated dependencies [1ff3a8f]
- Updated dependencies [61dd96f]
- Updated dependencies [b971924]
- Updated dependencies [6afa59d]
- Updated dependencies [e37ea4d]
- Updated dependencies [8f6d831]
- Updated dependencies [fa29803]
- Updated dependencies [b01bdbc]
- Updated dependencies [adbdbc5]
- Updated dependencies [6cc8dcd]
- Updated dependencies [ba77509]
- Updated dependencies [408ca2e]
- Updated dependencies [ec292cf]
- Updated dependencies [dc0ab6a]
- Updated dependencies [19e58e2]
- Updated dependencies [7e1b048]
- Updated dependencies [342808c]
- Updated dependencies [b3615f1]
- Updated dependencies [0b4022b]
- Updated dependencies [a60c913]
- Updated dependencies [5c5b67f]
- Updated dependencies [3f9e2ea]
- Updated dependencies [77f54bf]
- Updated dependencies [ccccdcc]
- Updated dependencies [48c91e9]
- Updated dependencies [2b52a5b]
- Updated dependencies [0f057b6]
- Updated dependencies [3875ae6]
- Updated dependencies [1c16889]
- Updated dependencies [1912237]
- Updated dependencies [fc29c74]
- Updated dependencies [95fb417]
- Updated dependencies [4ec3987]
- Updated dependencies [5b9402d]
- Updated dependencies [2cf9db7]
- Updated dependencies [dc1b986]
- Updated dependencies [655e8c0]
- Updated dependencies [041c8cf]
- Updated dependencies [e3277c3]
- Updated dependencies [cc6dfd9]
- Updated dependencies [7536721]
- Updated dependencies [9df3934]
- Updated dependencies [0b83e01]
- Updated dependencies [ebc6afe]
- Updated dependencies [6696056]
- Updated dependencies [0e06f3b]
- Updated dependencies [c1dfa52]
- Updated dependencies [2548ba5]
- Updated dependencies [9282578]
- Updated dependencies [ecf90b2]
- Updated dependencies [90ff10a]
- Updated dependencies [2bbebf5]
- Updated dependencies [369bcbe]
- Updated dependencies [3bd28e2]
- Updated dependencies [9347c1f]
- Updated dependencies [c164186]
- Updated dependencies [e7344f0]
- Updated dependencies [4d7e740]
- Updated dependencies [de091b5]
- Updated dependencies [6aa3188]
- Updated dependencies [ae7a35a]
- Updated dependencies [cf55914]
- Updated dependencies [17bd318]
- Updated dependencies [681868c]
- Updated dependencies [2274894]
- Updated dependencies [e462186]
- Updated dependencies [b5853da]
- Updated dependencies [4ac9319]
- Updated dependencies [560b724]
- Updated dependencies [16c5473]
- Updated dependencies [b276d44]
- Updated dependencies [3f86dc5]
- Updated dependencies [172b4cf]
- Updated dependencies [67c98f6]
- Updated dependencies [b98fbc2]
- Updated dependencies [e7f69db]
- Updated dependencies [84156c7]
- Updated dependencies [e0f17a3]
- Updated dependencies [0bf85ea]
- Updated dependencies [1df29df]
- Updated dependencies [8a44ce7]
- Updated dependencies [ca753c0]
- Updated dependencies [8ecbe0f]
- Updated dependencies [6a4aec7]
- Updated dependencies [e4471e6]
- Updated dependencies [e8fcf55]
- Updated dependencies [8d1f7ab]
- Updated dependencies [cfc3bcf]
- Updated dependencies [dd1b803]
- Updated dependencies [03d6cb0]
- Updated dependencies [9e7824a]
- Updated dependencies [08c8484]
- Updated dependencies [93cfc3f]
- Updated dependencies [6ac33a5]
- Updated dependencies [443b2f4]
- Updated dependencies [7e7fab7]
- Updated dependencies [b09ce67]
- Updated dependencies [4df101c]
- Updated dependencies [6a6a17b]
- Updated dependencies [733822c]
- Updated dependencies [a91d12a]
- Updated dependencies [bea6d2e]
- Updated dependencies [f415bcf]
- Updated dependencies [5f9d7d7]
- Updated dependencies [31d281d]
- Updated dependencies [569d4d2]
- Updated dependencies [9e9bb46]
- Updated dependencies [0d7ed5a]
- Updated dependencies [2aa25ef]
- Updated dependencies [0e1afe8]
- Updated dependencies [288611e]
- Updated dependencies [dfd8e39]
- Updated dependencies [28ad7e4]
- Updated dependencies [e6b7d8c]
- Updated dependencies [40b315b]
- Updated dependencies [f2c7eef]
- Updated dependencies [7e36a3c]
- Updated dependencies [5a6267f]
- Updated dependencies [0bbe400]
- Updated dependencies [862b6ce]
- Updated dependencies [80153f5]
- Updated dependencies [26daf0b]
- Updated dependencies [826f327]
- Updated dependencies [7e5246d]
- Updated dependencies [b810ddb]
- Updated dependencies [7dc45eb]
- Updated dependencies [17e4f52]
- Updated dependencies [dcd3bce]
- Updated dependencies [2d91c9a]
- Updated dependencies [b285508]
- Updated dependencies [2c31070]
- Updated dependencies [7db1332]
- Updated dependencies [aeb0557]
- Updated dependencies [1c1b8c8]
- Updated dependencies [05077d4]
- Updated dependencies [ba5927f]
- Updated dependencies [75b2169]
- Updated dependencies [de8c973]
- Updated dependencies [65352b7]
- Updated dependencies [e956924]
- Updated dependencies [2304b16]
- Updated dependencies [c7ad16f]
- Updated dependencies [48efe91]
- Updated dependencies [fb38607]
- Updated dependencies [dc07593]
- Updated dependencies [e967cbd]
- Updated dependencies [8255a51]
- Updated dependencies [d1c01ff]
- Updated dependencies [9e1689f]
- Updated dependencies [b057434]
- Updated dependencies [5f392f0]
- Updated dependencies [a362e0e]
- Updated dependencies [f26fb8e]
- Updated dependencies [0da638c]
- Updated dependencies [041d9fd]
- Updated dependencies [b8ec127]
- Updated dependencies [e81c4e5]
- Updated dependencies [28f9277]
- Updated dependencies [929d9e3]
- Updated dependencies [8a5240a]
- Updated dependencies [c1d54db]
- Updated dependencies [c7af6bd]
- Updated dependencies [1f0b565]
- Updated dependencies [23aa83c]
- Updated dependencies [357f499]
- Updated dependencies [80aef80]
- Updated dependencies [65ad77d]
- Updated dependencies [a61ae59]
- Updated dependencies [fb59fb5]
- Updated dependencies [a54ecaa]
- Updated dependencies [854639b]
- Updated dependencies [44c917a]
- Updated dependencies [613d35a]
- Updated dependencies [e08c8b0]
- Updated dependencies [0ee32ed]
- Updated dependencies [58b36fa]
- Updated dependencies [4792049]
- Updated dependencies [53ec0b1]
- Updated dependencies [0a56d3b]
- Updated dependencies [f8e5790]
- Updated dependencies [d2c1d19]
- Updated dependencies [681871e]
- Updated dependencies [54e8234]
- Updated dependencies [d127f9b]
- Updated dependencies [4bbf766]
- Updated dependencies [c17b494]
- Updated dependencies [d414e2b]
- Updated dependencies [af98a04]
- Updated dependencies [43cbe14]
- Updated dependencies [c86d351]
- Updated dependencies [6e3e546]
- Updated dependencies [c4d1759]
- Updated dependencies [f7a9740]
- Updated dependencies [96451ec]
- Updated dependencies [9cdffbe]
- Updated dependencies [331a1a2]
- Updated dependencies [9788f1e]
- Updated dependencies [3cf6449]
- Updated dependencies [3cf6449]
- Updated dependencies [2bd53f1]
- Updated dependencies [5f9f846]
- Updated dependencies [5d527f7]
- Updated dependencies [5bf2330]
- Updated dependencies [9165d5c]
- Updated dependencies [d9e1587]
- Updated dependencies [07150b3]
- Updated dependencies [143c715]
- Updated dependencies [fb2bccf]
- Updated dependencies [d2badf7]
- Updated dependencies [d64bcb6]
- Updated dependencies [d4f5232]
- Updated dependencies [396eae3]
- Updated dependencies [ecdfc94]
- Updated dependencies [f04be62]
- Updated dependencies [de1a611]
- Updated dependencies [4fba503]
- Updated dependencies [db76982]
- Updated dependencies [5cf58eb]
- Updated dependencies [66e266c]
- Updated dependencies [3b1dab9]
- Updated dependencies [7607076]
- Updated dependencies [1555ed4]
- Updated dependencies [776d64c]
- Updated dependencies [03b19d9]
- Updated dependencies [6154165]
- Updated dependencies [199002b]
- Updated dependencies [ab450f4]
- Updated dependencies [21ab410]
- Updated dependencies [025588a]
- Updated dependencies [a49e8ae]
- Updated dependencies [f3e3d59]
- Updated dependencies [9bd4344]
- Updated dependencies [51efbf1]
- Updated dependencies [9c44eed]
- Updated dependencies [bbca441]
- Updated dependencies [7cd5874]
- Updated dependencies [3cb84d0]
- Updated dependencies [119a02b]
- Updated dependencies [eea8787]
- Updated dependencies [7887077]
- Updated dependencies [29dd1a6]
  - @objectstack/spec@17.5.0

## 17.4.0

### Patch Changes

- c5d6803: Published `.js.map` files no longer embed the complete original source text (`sourcesContent`) — comments included. `sourcemap: true` was esbuild shorthand, and esbuild's own default for `sourcesContent` is `true`; nobody had decided to publish every package's full source (including `@internal`/test-only comments) to npm inside its source maps, it fell out of a default nobody had looked at. Measured before this change: 55 of 57 publishable packages shipped embedded source text, and maps were roughly half of `@objectstack/spec`'s published bytes.
  
  `sourcesContent: false` is now set at one shared place (`scripts/tsup-drop-sources-content.mjs`, wired into every `tsup.config.ts` via tsup's `esbuildOptions` hook — most packages build through the repo-root config directly and pick this up with no config change of their own). `mappings` are untouched, so stack-trace positions still resolve correctly to the original file/line/column; only the embedded source text is gone.
  
  `@objectstack/cli` (built with `tsc`, not `tsup`) never embedded source text to begin with — its maps' `sources` entries point at `src/**` paths that are not part of the published tarball either way. That is not a defect unique to `cli`: every `tsup`-built package's `sources` entries are `../src/**`-relative paths that are equally outside `files: ["dist", …]`, and were merely masked by the embedded content that just stopped shipping. Shipping `src/**` in `files[]` to make `sources` resolve was rejected — it would put most of the removed bytes straight back. So `cli`'s maps are left exactly as `tsc` emits them: this is now the fleet-consistent shape (accurate `mappings`, non-resolving-but-honest `sources` labels, no embedded text), not an outlier.
  
  A new gate, `pnpm check:sourcemap-no-sources-content`, sweeps every built, non-private package's `dist/**/*.map` and fails if any of them carries a non-empty `sourcesContent` array — so a future `tsup.config.ts` that skips the shared hook, or a toolchain upgrade that changes esbuild's default back, is caught rather than silently re-publishing source text.
- 4df2a98: `sys_metadata_commit` and `sys_http_delivery` stop declaring `maxLength: 64` on `id` — the last two platform-shipped declarations that made a clean boot warn about the platform's own tables.
  
  The driver emits `id`, `created_at` and `updated_at` itself and skips any declared field colliding with one, so the STORAGE half of such a declaration is discarded. #12015 made that discard loud instead of silent, and #12131 then cleared 45 system objects declaring `id` as `text`. These two survived that sweep because their residue was an attribute rather than a type: nothing can honour a `maxLength: 64` on a column the platform emits as `varchar(255)`.
  
  Measured on `origin/main` at `70f7d6d735`, over all 112 `*.object.ts` files in the repo (117 object declarations, 215 fields declared on a platform-emitted builtin column): exactly **2** declarations still tripped the diagnostic, and both are these. Fed through the real `SqlDriver` DDL path — one create pass, then one alter pass over the now-existing tables — those two produced **4** `[sql-driver]` collision warning blocks; after this change the same two runs produce **0**, with the 215-field sweep unchanged so the empty result is a measurement and not an empty loop.
  
  **No behaviour changes.** The attribute was already being discarded before it reached DDL, so the physical columns, the accept set and every write path are byte-for-byte what they were. What changes is that the platform's own declarations no longer trip a diagnostic aimed at author code.
  
  ⛔ The warning itself is untouched, on purpose. It is working as designed — it is the diagnostic #12015 was filed for, because a declared `id` used to be discarded in silence. Quieting, suppressing or narrowing it was never the remedy; the platform's declarations getting clean is.
  
  Each package gains an in-package pin (`builtin-column-storage-attributes.test.ts`) holding every object schema it ships to that shape, with a positive control in the same run.
- Updated dependencies [fe0d9a4]
- Updated dependencies [ecd2158]
- Updated dependencies [f2b5e46]
- Updated dependencies [ed7243d]
- Updated dependencies [6ba0db4]
- Updated dependencies [625b0c3]
- Updated dependencies [233222e]
- Updated dependencies [07f40e5]
- Updated dependencies [ceb4877]
- Updated dependencies [e9fcd6b]
- Updated dependencies [90e7e6d]
- Updated dependencies [2bdabe6]
- Updated dependencies [ca326b5]
- Updated dependencies [8f404a5]
- Updated dependencies [68437d4]
- Updated dependencies [abb140c]
- Updated dependencies [8333a6c]
- Updated dependencies [3e3ecb0]
- Updated dependencies [3030369]
- Updated dependencies [d5d8d50]
- Updated dependencies [e08892d]
- Updated dependencies [ae05f2e]
- Updated dependencies [b548e43]
- Updated dependencies [c463d03]
- Updated dependencies [64bd6a3]
- Updated dependencies [13c48c2]
- Updated dependencies [132742f]
- Updated dependencies [85a2459]
- Updated dependencies [50dc214]
- Updated dependencies [e89fa92]
- Updated dependencies [e9fcd6b]
- Updated dependencies [8976ea1]
- Updated dependencies [56fe8c2]
- Updated dependencies [acabd24]
- Updated dependencies [ab50c8f]
- Updated dependencies [6491463]
- Updated dependencies [89cf4d6]
- Updated dependencies [21c5dcb]
- Updated dependencies [6d4d5d3]
- Updated dependencies [ed5d557]
- Updated dependencies [bca21f7]
- Updated dependencies [e9fcd6b]
- Updated dependencies [1a7a7c9]
- Updated dependencies [e9fcd6b]
- Updated dependencies [ef3a138]
- Updated dependencies [68d5dfd]
- Updated dependencies [3e21cf0]
- Updated dependencies [4cfc93b]
- Updated dependencies [efd6b43]
- Updated dependencies [859ded3]
- Updated dependencies [fa125f3]
- Updated dependencies [74628d9]
- Updated dependencies [a646120]
- Updated dependencies [6f1ce7d]
- Updated dependencies [7778115]
- Updated dependencies [2c753fe]
- Updated dependencies [52804cd]
- Updated dependencies [3f89967]
- Updated dependencies [53cf263]
- Updated dependencies [21aabbc]
- Updated dependencies [9c270bb]
- Updated dependencies [76c8c5a]
- Updated dependencies [a84e1ce]
- Updated dependencies [bf1054a]
- Updated dependencies [d8d2776]
- Updated dependencies [222dc0f]
- Updated dependencies [e9fcd6b]
- Updated dependencies [32c917d]
- Updated dependencies [f9a3c32]
- Updated dependencies [f502898]
- Updated dependencies [af7edfe]
- Updated dependencies [b60f48b]
- Updated dependencies [c78c918]
- Updated dependencies [cf9bda4]
- Updated dependencies [784cb92]
- Updated dependencies [7629f4d]
- Updated dependencies [51df9fd]
- Updated dependencies [a7da4de]
- Updated dependencies [de0bcdd]
- Updated dependencies [70f7d6d]
- Updated dependencies [c677cda]
- Updated dependencies [554a160]
- Updated dependencies [f7da71e]
- Updated dependencies [7f745c3]
- Updated dependencies [5eb24f8]
- Updated dependencies [2a3decc]
- Updated dependencies [cc00df2]
- Updated dependencies [f4e6adf]
- Updated dependencies [ee4a59b]
- Updated dependencies [4db3c61]
- Updated dependencies [5ca314a]
- Updated dependencies [e0af1a8]
- Updated dependencies [414c1fc]
- Updated dependencies [22c0279]
- Updated dependencies [0db2947]
- Updated dependencies [92b5d7f]
- Updated dependencies [613bfbd]
- Updated dependencies [abae16a]
- Updated dependencies [094b8fd]
- Updated dependencies [c7aca0d]
- Updated dependencies [c1d8f98]
- Updated dependencies [8e0b297]
- Updated dependencies [5f7fa1d]
- Updated dependencies [87f0ccc]
- Updated dependencies [aedbaef]
- Updated dependencies [c5d6803]
- Updated dependencies [10d05bb]
- Updated dependencies [69602e5]
- Updated dependencies [c3ce76c]
- Updated dependencies [7936b29]
- Updated dependencies [46803fa]
- Updated dependencies [c2a336c]
- Updated dependencies [9f890d3]
- Updated dependencies [0bb2318]
- Updated dependencies [f7db8f4]
- Updated dependencies [1ecee3e]
- Updated dependencies [9408b7f]
- Updated dependencies [e9fcd6b]
- Updated dependencies [9bcd9be]
- Updated dependencies [b398ad2]
- Updated dependencies [99261a7]
- Updated dependencies [81b426f]
- Updated dependencies [001af1c]
- Updated dependencies [fb77aa5]
- Updated dependencies [581d8f8]
- Updated dependencies [f81afe3]
- Updated dependencies [40a44b9]
- Updated dependencies [7a7fb03]
- Updated dependencies [8fd246d]
  - @objectstack/spec@17.4.0

## 17.3.0

### Minor Changes

- fa5d137: feat(devx,datasource,automation): published `src/**` may only import workspace packages it declares (#10062)
  
  A package's non-test `src/**` was free to import any workspace package,
  declared or not, and nothing checked it. The class was filed with one member
  and a mitigation — the import was type-only, so nothing reached the emitted
  JavaScript and rollup-plugin-dts inlined the declaration rather than naming an
  unresolvable module. It grew to four members with no signal, and one of them
  killed the mitigation: `service-automation/src/flow-precedence.ts` **value**
  imports from `@objectstack/objectql`, which it does not declare, and because
  the shared tsup config externalises only `dependencies`/`peerDependencies`, the
  bundler answered by inlining objectql's implementation into
  `service-automation/dist/index.js` — a second copy of another package's code,
  kept correct by build configuration alone.
  
  `pnpm check:undeclared-dep-imports` is the gate, and the per-member fixes here
  are decided one at a time rather than by a uniform policy — declaring makes a
  coupling real and installable, routing it away removes it, and the two are not
  interchangeable:
  
  * **`@objectstack/service-datasource`** now declares `@objectstack/driver-sql`
    and `@objectstack/driver-memory` as **dependencies**. Both are loaded through
    an *unguarded* `await import(...)` on the postgres, mysql, sqlite and memory
    arms, so a consumer reaching one of those paths needed a package it was never
    told to install, and would have met `ERR_MODULE_NOT_FOUND` rather than a
    diagnosis. The three *guarded* driver arms — `@objectstack/driver-sqlite-wasm`,
    `@objectstack/driver-mongodb`, `@objectstack/driver-turso` — are deliberately
    left undeclared: each load sits in a `try`/`catch` that answers an absent
    package with the fault, the consequence and the install command, and each
    rides as an optional install. Declaring them would install them (turso drags
    `@libsql/client`'s native bindings) and, measured on this branch, takes a live
    assertion out of the tree: `default-datasource-driver-factory.test.ts` reaches
    the missing-package arm with no stub precisely because the package does not
    resolve from here.
  * **`@objectstack/metadata-core`** now owns the ADR-0029 D9.6 provenance pair,
    `isCodeArtifactBody` and `isTenantAuthored`, sunk out of
    `@objectstack/objectql`'s registry by the same criterion as the write-verb
    dispatch predicates and the audit governance table beside them: a second layer
    needs the answer and the reverse import would either close a cycle or make the
    consumer depend on the whole data engine for one predicate. `objectql`
    re-exports `isCodeArtifactBody` from its original path, so its public API is
    unchanged; `service-automation` imports it from `metadata-core`, which it
    already declared, and its bundle no longer carries a copy of objectql's code.
  
  Two members stay recorded rather than remediated, because the tree already
  carries the decision not to declare them together with its reason
  (`@objectstack/runtime` → `@objectstack/driver-turso`, whose bare `import()` is
  a host-replaceable default thunk under #6268; `@objectstack/rest` →
  `@objectstack/objectql`, whose absence must degrade to `501 NOT_IMPLEMENTED`
  rather than fail module load). Their ledger rows carry mechanical evidence and
  go red the moment that evidence stops holding — in particular, a `type-only`
  row reds on the day its import becomes a value import, which is exactly the
  transition nothing caught the first time.
- 0fd4899: feat(metadata-core,objectql): publish `assertEngineFindOnePredicate` — the read-side member of the engine-double contract family (#11957)
  
  `ObjectQL.findOne` applies `limit: 1`, so a query naming no particular record
  would return an ARBITRARY row. `requireFindOnePredicate` (#4419) REFUSES that
  call. Every in-memory test double in the repo instead read an absent filter as
  "match everything" and answered happily, so a production call site that violates
  #4419 read as *working* under every unit suite and only failed on a real engine.
  
  That is measured, not hypothetical. `AuthManager.isBootstrapCreation` probed the
  bootstrap population with `findOne({ where: [] })` inside a `try/catch`; on a
  real engine that throws, the `catch` read the refusal as "users exist", and the
  declared first-run bypass became permanently inert on real deployments — while a
  641-line unit matrix over the double stayed green, including a case named
  "bootstrap: the very first signup is admitted" (#11767).
  
  New public API, mirroring the two write-side dispatch predicates
  (`assertEngineDeleteDispatch`, `assertEngineUpdateDispatch`) exactly — the
  implementation lives in `@objectstack/metadata-core` so that packages
  `@objectstack/objectql` itself depends on can reach it, and `@objectstack/objectql`
  re-exports every symbol:
  
  - `assertEngineFindOnePredicate(object, query)` — the line a fake engine's
    `findOne` opens with; throws the engine's own message, object name included.
  - `resolveEngineFindOnePredicate(object, query)` — the same decision without the
    throw, for a double that wants to classify.
  - `engineFindOnePredicateRefusalMessage(object)` — the refusal text, so an
    assertion pins the producer's wording rather than a paraphrase.
  - `ENGINE_FINDONE_PREDICATE_CASES` — the shared conformance case-set, driven
    against the REAL engine by
    `packages/objectql/src/engine-findone-predicate.test.ts`, so the predicate
    cannot drift from `engine.ts` unnoticed.
  
  Nothing is removed and no existing behaviour changes: the engine's own guard is
  untouched, and this publishes the decision it already makes so a double can
  import it instead of re-deriving it.
- 15eb2c9: feat(security,meta): org-scoped presentation authoring capability `manage_org_presentation` (#12702)
  
  A tenant org admin in a walled posture can now be granted org-scoped authoring
  of exactly the org-overridable presentation types (ADR-0005 tier A: view /
  dashboard / report / translation / email_template today — the registry is the
  authority) without holding platform-wide `manage_metadata` (maintainer
  direction 2026-08-27, quoted in #12701).
  
  - **spec**: new curated `PLATFORM_CAPABILITIES` entry `manage_org_presentation`
    (`scope: 'org'`), seeded into `sys_capability` at boot like its siblings.
    Granted by NO shipped permission set — the SaaS operator grants it per
    deployment, so existing postures (`single` included) are byte-unchanged by
    its existence.
  - **metadata-core**: new `metaWriteCapabilityVerdict` — the capability half of
    the `/meta` write decision, beside the existing org-scope half
    (`organizationIdForMetaWrite`). It admits `isSystem` and `manage_metadata`
    exactly as before, and `manage_org_presentation` ONLY when the target type's
    registry entry declares `allowOrgOverride: true` (registry-derived via
    `declaresOrgOverride`, never a hand-written list) AND the session has an
    active organization — the very organization the doors thread, so an admitted
    write can only land org-scoped in the caller's own partition: never tier-B,
    never env-wide, never another org's.
  - **rest**: the four `/meta` item write doors (`PUT` save, `DELETE` reset,
    `POST /publish`, `POST /rollback`) run the shared verdict.
    `POST /meta/_migrate-stored` stays `manage_metadata`-only — an install-wide
    rewrite is env-wide by definition.
  - **runtime**: the dispatcher `/meta` `PUT` door runs the same shared verdict
    (its `_migrate-stored` twin likewise stays `manage_metadata`-only).
  
  Refusals keep their transports' existing envelopes (REST `403 FORBIDDEN`,
  dispatcher `403 PERMISSION_DENIED`); the tier-B refusal sentence is
  byte-identical to before, and the tier-A sentences name the sanctioned path
  without disclosing the caller's own grants (#7450). Platform `manage_metadata`
  behaviour is unchanged on every door.
- 1272f0a: Promote `resolveRecordOrganizationField` to the shared platform-row organization resolver (the cloud#1395 Option A ruling): a platform row's organization is the SUBJECT record's organization; actor context is the fallback, never the primary.
  
  - `@objectstack/metadata-core` now owns the resolver (`resolveRecordOrganizationField`, `createFieldPresenceProbe`, and the new memoized `createRecordOrganizationResolver` factory) so all three sanctioned writers share one precedence.
  - `@objectstack/plugin-approvals`: `openNodeRequest` stamps `sys_approval_request`, `sys_approval_action` and the `sys_approval_approver` index from the subject record's organization (acting context as fallback). Fixes the measured defect where every schedule / time-relative / api triggered approval persisted `organization_id = NULL` — locking the record it was about while being invisible in every inbox, its owner's included.
  - `@objectstack/service-automation`: `sys_automation_run` rows (paused and terminal) resolve their organization from the trigger-record snapshot, with the acting tenant as fallback. Terminal rows previously never carried an organization at all.
  - `@objectstack/plugin-audit`: the resolver moved out; the package re-exports it from the original paths, behavior unchanged.
  
  The `sys_api_key` divergence is preserved and pinned: `tenancy.organizationField` (who a row is ABOUT) still wins over the tenant wall answer, and the credential table stays unwalled.
- d41d166: fix: the `./testing` subpaths are ESM-only — they no longer advertise a `require` condition vitest refuses to serve (#12985)
  
  Both packages published their test-harness subpath as a dual entry point:
  
  ```jsonc
  // FROM — @objectstack/metadata-core and @objectstack/service-cluster
  "./testing": {
    "types": "./dist/testing.d.ts",
    "import": "./dist/testing.js",
    "require": "./dist/testing.cjs"
  }
  
  // TO
  "./testing": {
    "types": "./dist/testing.d.ts",
    "import": "./dist/testing.js"
  }
  ```
  
  The `require` half was a promise neither package could keep. Both subpaths
  re-export `vitest`, and vitest **refuses** to be loaded from CommonJS by
  design — its CJS entry is a single `throw`:
  
  ```
  node -e "require('@objectstack/metadata-core/testing')"
  Error: Vitest cannot be imported in a CommonJS module using require(). Please use "import" instead.
  ```
  
  The emitted bytes parse; the load fails inside vitest's own entry, for every
  consumer and every code path. So the condition could never resolve to working
  code, on any release, since it was first declared. It is removed rather than
  repaired because the failure is not ours to fix: a test harness has no business
  advertising a `require` condition when the test runner it re-exports does not
  serve one.
  
  **Nothing that worked stops working**, and that is why this is not filed as a
  breaking removal. A CJS consumer that resolved through the old condition got a
  hard `Error` at load; it now gets a resolution error from node instead — a
  different message for the same non-working call, and an earlier and clearer
  one. The `import` condition, the types and the runtime API are untouched, and
  every in-repo consumer already reaches these subpaths through `import`
  (`@objectstack/metadata-fs`, `@objectstack/metadata-protocol`,
  `@objectstack/rest`, `@objectstack/runtime`, `@objectstack/service-cluster-redis`).
  
  **If you did spell it as `require`** — `require('@objectstack/metadata-core/testing')`
  or `require('@objectstack/service-cluster/testing')` — switch the call to
  `await import('@objectstack/metadata-core/testing')`, or move the calling
  module to ESM. That is the same change the old condition already forced on
  you, one error message earlier.
  
  `dist/testing.cjs` is still emitted (both packages build every entry in both
  formats) and still parsed by `pnpm check:dual-build-cjs-loads`; it is simply no
  longer reachable through the manifest. Removing it from the build is a
  tsup-config change with its own risks and is not folded in here.
- 5d16379: **BREAKING (accept-set tightening)**: a by-id `update` whose bound truthy scalar payload `data.id` stands beside a DECLARED but non-scalar `options.where.id` — `{ $in: [...] }`, an array, `null` — is now refused loudly (`UPDATE_ID_MISMATCH`, HTTP 400) instead of silently binding the payload row and discarding both the id predicate and any declared `multi: true` (#11230).
  
  `update(obj, { id: 'rec_1', title: 'x' }, { where: { id: { $in: ['a', 'b'] } }, multi: true })` used to write exactly one row — `rec_1` — with no diagnostic: the payload id outranked `where` and `multi` alike (#5748), so the declared row SET and the declared bulk intent were both dropped, and `rec_1` need not even have been a member of the set. This was the LAST silent member of the dropped-declaration family (#5748 payload operator-objects, #11009 extra `where` keys, #11142 unequal scalar `where.id`); closing it reverses the remaining half of the #5748-pinned verdict `a SCALAR data.id still outranks where and multi`, which the maintainer ruling on #11230 (2026-08-23) authorizes.
  
  What changes, per call shape (`resolveEngineUpdateDispatch`, so every pinned test double inherits the same verdict):
  
  - A truthy scalar `data.id` beside a **non-scalar** `where.id` — an operator object, an array, `null`, or an explicitly-`undefined` `id` key — now **throws** `UPDATE_ID_MISMATCH` with `status: 400`, naming the payload id and the KIND of predicate the caller wrote. `multi: true` does not rescue the call (the payload id outranks `multi` per #5748, so the contradiction stands). Previously the write landed on the payload row with both declarations silently ignored.
  - Boundaries that do **not** move: a **falsy** scalar `where.id` (`0`, `''`) is a scalar and keeps its #11142 verdict (by-id); a `where` that declares **no** `id` key at all (`{}`, or no `where`) is untouched; and with **no** scalar payload id the ladder is exactly as #5748 left it (`multi` when declared, otherwise `reject`) — the refusal lives only on the payload-sourced by-id arm.
  - The refusal shares the #11142 error code deliberately — one ADR-0112 ledger member for one defect class, two messages. No new code is registered.
  
  A caller hitting the new refusal declared a row address and a row-set predicate in one call and meant one of them; each fix is a one-line edit at the call site: drop `id` from the payload to write EVERY row the predicate selects (`update(object, fields, { where: { id: { $in: [...] } }, multi: true })`), or drop `where.id` to write the single row the payload names (`update(object, { id, ...fields })`). The refusal text names both. Measured before shipping: **no in-repo call site constructs the pair** — every production `where.id` predicate (the outbox sweeps) carries a payload with no `id` — so the in-repo blast radius is nil; an external SDK caller can still write it, and today that silently drops both declarations.
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable surface is removed or renamed — no spec key, no export, no config field changes spelling, so `objectstack migrate meta` has nothing to rewrite and no ledger entry could serve an upgrader. The newly-refused call shape is a self-contradictory input whose declared condition was never evaluated; deciding whether the caller meant the payload row or the predicate's row set is a per-site intent decision a mechanical rewrite must not make, and the refusal text itself names both call-site fixes. -->

### Patch Changes

- 54e2d36: Artifacts built by released 17.x tooling boot again on ≥17.2 runtimes: the artifact-ingestion door now runs a versioned ADR-0087 forward conversion before the strict parse (#12772).
  
  A compiled artifact whose declared `engines.protocol` floor predates the running `@objectstack/spec` version replays the full conversion chain — retired entries included — before validation, exactly the policy the stored-row read path already applies to `sys_metadata` rows. Measured incident: `dist/objectstack.json` built by `@objectstack/cli` 17.1.0 carries the then-legal `allowRestore`/`allowPurge` permission bits (75 of each, injected by the released builder), and spec 17.2.0's `retiredKey` tombstone refused the boot with no operator remedy (`os migrate meta` targets sources, not built artifacts).
  
  The conversion is versioned, not a blanket amnesty: an artifact authored at the current (or a newer) spec version converts nothing and still refuses at the tombstone — the retired keys return with the M2 lifecycle initiative (#1883), and artifacts authored against that surface are never stripped by history. Conversion notices surface operator-visibly and deduped, one summary line per conversion per artifact. New exports from `@objectstack/metadata-core`: `applyArtifactForwardConversions`, `resolveInstalledSpecVersion`, `parseRangeFloor`, `resolveDeclaredRange`.
- b745157: feat(metadata-core,metadata): warn the operator when a pre-current-era artifact carries form-view predicates that fault open (#12915)
  
  A form-view predicate binds `record` (+ `previous`, `parent`) in runtime record
  forms, or `data` in metadata-editing forms. The contract states the failure mode
  beside the vocabulary: **a bare identifier is unbound, the predicate faults, and
  `visibleWhen`'s fault fallback is `true`** — so a field the predicate was
  authored to hide renders for everyone.
  
  That is quiet alone and lethal in combination with the authoring pattern it
  serves. Measured on a real deployment: an artifact built by released
  `@objectstack/cli` 17.1.0 authors
  `{ field: 'disqualification_reason', required: true, visibleWhen: 'status == "unqualified"' }`
  — the era's working spelling. On a 17.2 runtime the predicate faults open, the
  conditionally hidden field renders, and its unconditional `required: true`
  blocks **every** record creation through the console, while the same payload
  POSTs 201 through REST. Nothing refused and nothing logged, so the operator —
  the only person who can rebuild the artifact — had no signal at all.
  
  The framework artifact door now emits **one deduped `warn` line per artifact**
  naming the authored `engines.protocol` floor and the runtime spec version, how
  many predicates on which views (with the first path as an anchor), the
  fault-open consequence, and the remedy (`os build`). It rides the same funnel
  that already carries the forward-conversion summaries, so both SaaS shapes are
  covered: a single-DB multi-org runtime warns once at boot, and per-tenant-DB
  kernels each warn at their own.
  
  **No behaviour change.** No refusal, no rewrite, no schema or contract edit —
  the predicate keeps faulting open exactly as before, and the artifact bytes are
  untouched. Rewriting a bare root to `record.` is a separate, deferred ADR-0087
  conversion.
  
  **Scoped to legacy artifacts by construction.** The notice fires only inside the
  versioned window the forward conversion already opens (declared floor below the
  running spec, or undeclared), read off that pass's own verdict rather than
  recomputed. An artifact declaring the current or a newer floor gets zero notices
  from this feature even when it carries bare roots — the boundary that keeps a
  notice about legacy artifacts out of contract territory.
  
  Detection is exported from `@objectstack/metadata-core` as
  `detectUnboundFormViewPredicateRoots` (with `BOUND_FORM_VIEW_PREDICATE_ROOTS`)
  so other composed artifact doors can reuse one policy rather than fork it. It is
  pure, read-only, and tuned to prefer silence over a false accusation: string
  literals are stripped before the scan, only root position counts, call targets
  are not roots, comprehension macros (whose iteration variable is locally bound)
  are skipped whole, and AST-only envelopes pass.
- d23ebb9: fix(metadata-core,service-cluster): stop emitting and publishing the CJS half of `./testing` (#13013)
  
  #13001 made both `./testing` subpaths ESM-only, dropping the `require` condition
  that pointed at `dist/testing.cjs`. The build kept emitting those files and
  `files: ["dist"]` kept packing them, so every release shipped bytes no exports
  condition could reach. Measured with `npm pack --dry-run`, before → after:
  
  | package | files | unpacked | dropped |
  |---|---|---|---|
  | `@objectstack/metadata-core` | 22 → 16 | 3.3 MB → 3.2 MB | `testing.cjs` (28.0 kB), `testing.cjs.map` (48.4 kB), `testing.d.cts` (9.4 kB), `chunk-H2D6OJ76.cjs` (4.2 kB) + map (10.6 kB), `repository-*.d.cts` |
  | `@objectstack/service-cluster` | 15 → 12 | 364.1 kB → 336.9 kB | `testing.cjs` (11.9 kB), `testing.cjs.map` (14.5 kB), `testing.d.cts` (794 B) |
  
  Nothing reachable changed. The whole ESM surface of both packages — `index.js`,
  `testing.js`, their maps, the shared chunk, and every declaration the manifest
  names — is **byte-for-byte identical** to the previous build (sha256, before vs
  after). `index.cjs` changes only because what was a shared CJS chunk is now
  inlined into the sole remaining CJS entry.
  
  Each `tsup.config.ts` becomes an array of two configs split **by format** —
  ESM keeps both entries, CJS takes `src/index.ts` alone. The split is by format
  and never by entry: `index` and `testing` share a chunk carrying the error
  classes, and one config per entry would give `testing.js` its own copies, so
  `ConflictError` reached through `@objectstack/metadata-core/testing` would stop
  being the class thrown by `@objectstack/metadata-core` — which the published
  contract suite asserts (`.rejects.toBeInstanceOf(ConflictError)`).
  
  `clean` moves out of tsup and into the `build` script (`rm -rf dist && tsup`).
  tsup runs an array config through `Promise.all`, so the halves build
  concurrently and a `clean` in either races the other's writes; the script-level
  clean is also stronger than tsup's own, which preserves `*.d.{ts,cts,mts}` and
  would therefore have left a stale `dist/testing.d.cts` behind on every rebuild
  of an existing worktree.
- e7191ce: fix(build): give each `exports` condition its own `types` target in the 28 dual-build packages (#13112)
  
  **Published-surface change, zero runtime change.** No emitted byte moves; what
  moves is which declaration file a resolver READS. Maintainer ruling 2026-08-29
  (decision batch #3, verbatim 「同意」) chose declaring the files over deleting
  them.
  
  ## What was wrong
  
  These 28 packages are `"type": "module"` and dual-built, and each spelled one
  `types` condition as a **sibling** of `import`/`require`:
  
  ```json
  "exports": { ".": {
    "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs"
  } }
  ```
  
  A sibling `types` answers for **both** conditions, so a CommonJS consumer was
  handed `dist/index.d.ts` — an ES-module declaration, because the package is
  `"type": "module"` — for an entry point it reaches with `require`. Measured with
  `tsc --traceResolution` on a `"type": "commonjs"` fixture at `moduleResolution:
  node16`:
  
  ```
  error TS1479: The current file is a CommonJS module whose imports will produce
  'require' calls; however, the referenced file is an ECMAScript module and cannot
  be imported with 'require'.
  ```
  
  The JavaScript at `dist/index.cjs` loads perfectly (`check:dual-build-cjs-loads`
  has asserted that for months). It is the **types** that told the consumer the
  supported `require` entry point could not be required. The `dist/index.d.cts`
  twin tsup emits beside it — 36 files, 5,517,701 B on this build — was named by
  no condition at all and shipped in every tarball unreachable.
  
  ## What changed
  
  Each condition now names its own declaration, the shape TypeScript documents:
  
  ```json
  "exports": { ".": {
    "import":  { "types": "./dist/index.d.ts",  "default": "./dist/index.js" },
    "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
  } }
  ```
  
  33 entry points across 27 packages, subpaths included. The root `types` field is
  untouched, so `node10` resolvers are unaffected; the `import` condition resolves
  exactly what it resolved before, measured as an unchanged control in the same
  run.
  
  ## `@objectstack/core` is deliberately NOT changed
  
  Splitting a declaration in two makes TypeScript compare it nominally, and
  `ObjectKernel` carries a `private plugins` member that reaches every plugin
  through `PluginContext.getKernel()`. With core split, whole-repo `pnpm build`
  fails in `@objectstack/verify` with 5 × TS2345 ("Types have separate
  declarations of a private property 'plugins'"); with core held back and the
  other 27 split, 71/71 tasks pass. So core keeps the sibling-`types` shape and
  its two `.d.cts` files (220,854 B) stay unreachable, declared as such in
  `check:dual-build-cjs-loads`. Splitting it needs a decision about core's public
  types, not about an exports map.
  
  ## For consumers
  
  - **ESM consumers: nothing changes.** Same declaration file, byte for byte.
  - **CJS consumers under `node16`/`nodenext`: TS1479 goes away** and the
    declarations they get are the ones built for CommonJS.
  - **`node10` / `moduleResolution: node` consumers: nothing changes** — they never
    read `exports`.
  - Nothing is removed: every path that resolved before still resolves.
  
  Packages that are CJS-first (`require` → `./dist/index.js`, no `"type": "module"`)
  were already correct and are untouched — their `dist/index.d.ts` really is the
  CommonJS declaration. Their ESM mirror (an unreachable `.d.mts` under the
  `import` condition) is a separate, larger population and is filed separately per
  the ruling, not fixed here.
  
  `check:dual-build-cjs-loads` grew a fourth invariant (TYPED) that reds on the old
  shape, so the drift cannot return silently.
- 00d8f65: docs(metadata-core): correct `createFieldPresenceProbe`'s stated reason — the `organization_id` column is provisioned unconditionally (#13416)
  
  `createFieldPresenceProbe` is a published export, and its docstring is emitted
  verbatim into the built declarations (`dist/index.d.ts` and `dist/index.d.cts`),
  so it is what a consumer's editor shows on hover. That docstring recorded a
  falsified fact as the probe's reason for existing: *"the SchemaRegistry
  auto-injects `organization_id` only in multi-tenant mode … so on single-tenant
  stacks the `sys_audit_log` / `sys_activity` tables have no such column."*
  
  The column has since been decoupled from the posture flag. It is provisioned
  **unconditionally**, subject only to the explicit opt-outs (`systemFields:
  false`, `systemFields.tenant: false`, `managedBy: 'better-auth'`,
  `tenancy.enabled: false`); the multi-tenant flag now governs only whether the
  column is **INDEXED**, never whether it EXISTS. Three sources in the tree agree:
  `applySystemFields` says so at the injection site (`objectql/src/registry.ts`),
  the derivation it consumes (`resolveInjectedSystemColumns`,
  `spec/src/data/injected-system-columns.ts`) accepts no `multiTenant` input to
  decide with, and `objectql/src/registry-tenancy-posture.test.ts` pins it
  executably. Both tables the old sentence named resolve the column on every
  posture.
  
  Read literally, the stale sentence invited two wrong moves — deleting the probe
  as dead once someone checked that the column is always provisioned, or
  hand-rolling a fresh posture-conditional probe elsewhere on the same false
  premise. The sentence is therefore corrected and its history kept, rather than
  dropped: the probe never read the posture flag, and what it still answers is
  provenance, not posture (an ADR-0015 `external` object, the explicit opt-outs,
  and an engine with no `getSchema`).
  
  Prose only. No runtime behaviour, no exported signature and no accept/reject
  decision moves; the probe's implementation is byte-identical.
- 200d255: fix(metadata-core,metadata): a form SECTION binds `current_user` too, so the unbound-root notice stops flagging one (#13072)
  
  Second correction to the unbound-root boot notice, and the same defect as the
  first one a surface later. The notice judged a SECTION-level predicate against
  `record` / `previous` / `parent` / `data`, sourced faithfully from the section
  contract prose — which was stale.
  
  `current_user` and its ADR-0068 alias roots (`user`, `ctx.user`, `os.user`)
  **resolve on a section-level `visibleWhen`**: objectui#6110 threads the host
  shell's predicate scope into `isSectionVisible` where it used to pass
  `undefined`, and objectui#6111 copies the authored `visibleWhen` onto the
  `section-divider` pseudo-field whose predicate the SDUI form renderer evaluates
  with that scope bound. #12914 re-measured the contract text accordingly. Until
  this change, a legacy artifact carrying a legitimate section-level
  `current_user.role == "admin"` predicate was reported at boot as an unbound root
  that faults open — a notice about a predicate that resolves, which is the
  cry-wolf failure the module's own doc forbids and the one that trains operators
  to ignore the channel.
  
  **What changes:** one vocabulary now serves both form-view predicate surfaces —
  `record`, `previous`, `parent`, `data`, `current_user`, `user`, `ctx`, `os`. A
  section predicate rooted at the `current_user` family is silent; a section
  predicate rooted at a bare field identifier is still reported, and the operator
  line still prints the rule per surface for the surfaces the findings implicate.
  
  **Blast radius, stated without inflation:** this is a **notice**, not a refusal
  — no parse change, no gate, no behaviour change, and it only runs inside the
  versioned window `applyArtifactForwardConversions` opens. The cost it removes is
  a false operator signal on legacy artifacts, not a broken runtime.
  
  **Removed export, with its migration:** `FIELD_ONLY_BOUND_PREDICATE_ROOTS` is
  gone from `@objectstack/metadata-core`. The section binding empties it, and an
  exported constant named `FIELD_ONLY_…` holding `[]` asserts a per-surface
  difference that no renderer makes. FROM → TO: read
  `BOUND_FORM_VIEW_PREDICATE_ROOTS` (every root bound on any form-view predicate)
  or `BOUND_FORM_FIELD_PREDICATE_ROOTS` (the field question, the same list today).
  No consumer can be carrying it: the notice has never shipped — the two
  changesets that introduce it are still pending in `.changeset/`, the newest
  published `@objectstack/metadata-core` is 17.2.0, and the commit that added
  `form-predicate-root-policy.ts` is in no release tag. This was the last moment
  at which the removal cost nothing.
  
  **Why the vocabulary is no longer justified by quoting the contract.** Both
  times this list has been wrong, it was wrong by transcribing a correct-looking
  sentence that the renderer had already moved past. The prose is a transcription
  of a renderer and can only lag one, so membership is now stated as the mechanism
  — *a root is bound on a surface iff some renderer threads a scope carrying it
  into that surface's evaluator* — with the threading site named per entry, and
  the module's test reads the LIVE `.describe()` text of
  `FormFieldSchema.visibleWhen` / `FormSectionSchema.visibleWhen` out of
  `@objectstack/spec` instead of copying it into a comment. A comment quoting that
  sentence goes stale in silence, twice now; an assertion that fetches it cannot.
  
  <!-- adr-0087: not-required (unpublished) the removed export FIELD_ONLY_BOUND_PREDICATE_ROOTS was added after 17.2.0 and is in no release tag, so no upgrader can be holding it and there is nothing to migrate from. -->
- 2852acc: fix(metadata-core,metadata): split the form-view predicate root vocabulary per surface, so a field-level `current_user` test is not false-flagged (#12915)
  
  Same-day correction to the unbound-root boot notice. The notice judged **every**
  form-view predicate against one vocabulary (`record` / `previous` / `parent` /
  `data`), sourced faithfully from the contract prose — which, for the field-level
  slot, was stale.
  
  `current_user` and its ADR-0068 alias roots (`user`, `ctx.user`, `os.user`)
  **resolve on a field-level `visibleWhen`** since objectui#6010; three spec text
  sites still said otherwise until #12930 re-measured them, and one of those sites
  was the sentence this policy was written against. A legacy artifact carrying a
  legitimate `current_user.role == "admin"` field predicate was therefore reported
  as faulting open — the cry-wolf failure the notice is explicitly built to avoid,
  and the one that trains operators to ignore the channel.
  
  The vocabulary is now per surface, which is what the contract actually says:
  
  - **Field-level** (`BOUND_FORM_FIELD_PREDICATE_ROOTS`): the shared base plus
    `current_user`, `user`, `ctx`, `os`. Silent on all of them.
  - **Section-level** (`BOUND_FORM_VIEW_PREDICATE_ROOTS`, unchanged in name and
    value): the base alone. `current_user` is still flagged there — the section
    docblock states it is unbound at that level and faults open.
  
  Two limits of the field binding deliberately do **not** change the answer: it is
  a rendering rule rather than authorization (an authoring hazard, not a
  version-drift one), and the scope is empty on the console's public `/f/:slug`
  route (equally true of a freshly built current artifact, so it says nothing
  about the artifact's era — the only thing this notice claims to detect).
  
  The emitted warn line now prints the bound roots **per surface, and only for the
  surfaces the findings implicate**, so an operator is never shown a rule their
  artifact has no instance of. Findings carry a `surface` field.
  
  `unboundRootsInCelSource` takes the vocabulary as an optional second argument;
  its default is unchanged (the stricter base), so existing callers behave exactly
  as before.
- 15d55fb: fix(metadata-core): the CJS entry point loads again — `import.meta` is no longer emitted into `dist/index.cjs` (#12971)
  
  `@objectstack/metadata-core` declares `"type": "module"` with a dual `exports`
  map, so `require('@objectstack/metadata-core')` is a published, supported entry
  point. Since 17.2.0 it was **unloadable**: `resolveInstalledSpecVersion()`
  anchors its `@objectstack/spec` lookup with `createRequire(import.meta.url)` —
  correct for the ESM output — and tsup emitted that identifier **verbatim** into
  `dist/index.cjs`. `import.meta` outside an ES module is a **parse-time** error,
  so the module never began executing:
  
  ```
  node -e "require('@objectstack/metadata-core')"
  SyntaxError: Cannot use 'import.meta' outside a module
  ```
  
  The failure was total, not partial. Neither the `typeof require === 'function'`
  fast path above the line nor the `try`/`catch` around it ever ran, so **every**
  CJS consumer and **every** code path in the package was affected, not just
  callers of `resolveInstalledSpecVersion()`. Measured downstream: a walled
  enterprise runtime refused to boot because `@objectstack/organizations`
  resolves through this condition and the fail-closed tenancy wall correctly
  refuses to serve when the organization wall cannot load.
  
  **The fix** is `shims: true` in this package's `tsup.config.ts` — the same one
  line, for the same measured reason, already carried by `@objectstack/runtime`
  and `@objectstack/metadata-protocol`. tsup rewrites `import.meta.url` in the
  CJS output to a real `__filename`-derived URL, so both formats anchor on the
  module's own file and resolve the same `@objectstack/spec/package.json`. Both
  conditions now load and `resolveInstalledSpecVersion()` returns the identical
  value in each.
  
  No API, type or behaviour change, and the ESM half is untouched — measured
  rather than assumed: rebuilding with and without the shim, the emitted ESM code
  bytes are identical in every file, and the whole difference is the shared
  chunk's content-hashed **filename** (`chunk-DDDKWTSW.js` → `chunk-46MG4YHS.js`)
  and the `sourceMappingURL` line naming it. Chunk names are internal to the
  package; no `exports` target moves. Nothing an author writes moves either.
  
  **The class is now gated.** `pnpm check:dual-build-cjs-loads` (a step in the
  required **Build Core** job) parses every emitted CommonJS file and `require()`s
  every published `require` entry point in the workspace — 105 entries across 67
  packages — so the next package to leak ESM-only syntax into its CJS output
  fails at the commit that introduces it rather than in a consumer's release.
- Updated dependencies [809d417]
- Updated dependencies [387e231]
- Updated dependencies [f794e4e]
- Updated dependencies [cae2169]
- Updated dependencies [b812a54]
- Updated dependencies [2d4fa75]
- Updated dependencies [0e4e51b]
- Updated dependencies [e84bbf6]
- Updated dependencies [effae80]
- Updated dependencies [d62f990]
- Updated dependencies [c45d8e6]
- Updated dependencies [2e3e8c7]
- Updated dependencies [e621291]
- Updated dependencies [40a93b5]
- Updated dependencies [d5b330d]
- Updated dependencies [dda969c]
- Updated dependencies [1f45690]
- Updated dependencies [277948f]
- Updated dependencies [8bdd955]
- Updated dependencies [f3bbbef]
- Updated dependencies [4f24e9d]
- Updated dependencies [474242f]
- Updated dependencies [63cd487]
- Updated dependencies [bd4aa4e]
- Updated dependencies [803eaab]
- Updated dependencies [f8e8f03]
- Updated dependencies [eae824e]
- Updated dependencies [f6fa22c]
- Updated dependencies [8a483b3]
- Updated dependencies [97bcd99]
- Updated dependencies [df59de0]
- Updated dependencies [96e25a8]
- Updated dependencies [f75a38a]
- Updated dependencies [7a25e7d]
- Updated dependencies [1fa05a6]
- Updated dependencies [c85a265]
- Updated dependencies [dcb10a5]
- Updated dependencies [773a999]
- Updated dependencies [35dffea]
- Updated dependencies [776a098]
- Updated dependencies [5060877]
- Updated dependencies [4f6325d]
- Updated dependencies [52954c0]
- Updated dependencies [2aa8456]
- Updated dependencies [93809a3]
- Updated dependencies [7c0d0c3]
- Updated dependencies [daae7aa]
- Updated dependencies [8dc22d6]
- Updated dependencies [279431e]
- Updated dependencies [948dd6b]
- Updated dependencies [3b4c56c]
- Updated dependencies [ae8edd2]
- Updated dependencies [e25403c]
- Updated dependencies [64baa68]
- Updated dependencies [9fa70d7]
- Updated dependencies [09db64a]
- Updated dependencies [92916e7]
- Updated dependencies [a84f3ea]
- Updated dependencies [f2eaae8]
- Updated dependencies [c09451b]
- Updated dependencies [ba64877]
- Updated dependencies [7345308]
- Updated dependencies [79b6a22]
- Updated dependencies [30d96ab]
- Updated dependencies [f658793]
- Updated dependencies [c95ad19]
- Updated dependencies [e58ea8b]
- Updated dependencies [4a17645]
- Updated dependencies [3795c5f]
- Updated dependencies [8ab926b]
- Updated dependencies [7317cf2]
- Updated dependencies [e25e839]
- Updated dependencies [5997207]
- Updated dependencies [8b13cc8]
- Updated dependencies [4a4a35d]
- Updated dependencies [86e765a]
- Updated dependencies [1d7e76a]
- Updated dependencies [53dc739]
- Updated dependencies [fd289be]
- Updated dependencies [03bf7b1]
- Updated dependencies [f90e820]
- Updated dependencies [18d816a]
- Updated dependencies [e8bd715]
- Updated dependencies [b91c351]
- Updated dependencies [a28a3c0]
- Updated dependencies [daeaaf9]
- Updated dependencies [c459da6]
- Updated dependencies [e914733]
- Updated dependencies [f887e52]
- Updated dependencies [881f8d8]
- Updated dependencies [3bfa1e6]
- Updated dependencies [901355c]
- Updated dependencies [34ce8e7]
- Updated dependencies [33681ea]
- Updated dependencies [4635f3e]
- Updated dependencies [ee3595c]
- Updated dependencies [b2eab95]
- Updated dependencies [93940d4]
- Updated dependencies [3a04b01]
- Updated dependencies [45b9051]
- Updated dependencies [b9e9227]
- Updated dependencies [d395692]
- Updated dependencies [5894d30]
- Updated dependencies [a3765f6]
- Updated dependencies [e22158f]
- Updated dependencies [7404925]
- Updated dependencies [0c2334f]
- Updated dependencies [778c59f]
- Updated dependencies [d2619fd]
- Updated dependencies [6acb11a]
- Updated dependencies [33c5fd3]
- Updated dependencies [20b0fdb]
- Updated dependencies [905019b]
- Updated dependencies [a286411]
- Updated dependencies [98c0d33]
- Updated dependencies [368a82e]
- Updated dependencies [a3d5724]
- Updated dependencies [93ea19b]
- Updated dependencies [9ee2dcf]
- Updated dependencies [8cb96ec]
- Updated dependencies [8f10a79]
- Updated dependencies [6269a55]
- Updated dependencies [0fb8760]
- Updated dependencies [e5ce2ed]
- Updated dependencies [be21955]
- Updated dependencies [bc56e18]
- Updated dependencies [be21955]
- Updated dependencies [a9ee989]
- Updated dependencies [4d0d944]
- Updated dependencies [15d58db]
- Updated dependencies [d63b014]
- Updated dependencies [9abe4e4]
- Updated dependencies [2cc7122]
- Updated dependencies [50d6c92]
- Updated dependencies [9e0ba21]
- Updated dependencies [311433f]
- Updated dependencies [3e5ad08]
- Updated dependencies [9abe4e4]
- Updated dependencies [b7131f3]
- Updated dependencies [e5812fa]
- Updated dependencies [7085f90]
- Updated dependencies [dee4dd4]
- Updated dependencies [ce7e497]
- Updated dependencies [51ecb2f]
- Updated dependencies [9086761]
- Updated dependencies [42a117b]
- Updated dependencies [1401ae7]
- Updated dependencies [4297fe7]
- Updated dependencies [e398863]
- Updated dependencies [d16df74]
- Updated dependencies [f11fc61]
- Updated dependencies [e808890]
- Updated dependencies [8f79379]
- Updated dependencies [e6ca40e]
- Updated dependencies [0c77ea4]
- Updated dependencies [52954c0]
- Updated dependencies [89eb997]
- Updated dependencies [aa5994e]
- Updated dependencies [be93457]
- Updated dependencies [a65db76]
- Updated dependencies [15eb2c9]
- Updated dependencies [5691b07]
- Updated dependencies [2a6122b]
- Updated dependencies [225e769]
- Updated dependencies [8af88dd]
- Updated dependencies [fb5fbb8]
- Updated dependencies [d7b3963]
- Updated dependencies [b72db01]
- Updated dependencies [dce5cd4]
- Updated dependencies [177ebdc]
- Updated dependencies [8d237b4]
- Updated dependencies [2d2e6f0]
- Updated dependencies [2d8dd8d]
- Updated dependencies [22d573e]
- Updated dependencies [b5a2398]
- Updated dependencies [348860c]
- Updated dependencies [5383fa6]
- Updated dependencies [5b3ff63]
- Updated dependencies [1a6a19c]
- Updated dependencies [527e050]
- Updated dependencies [dd33bf9]
- Updated dependencies [4cb2a90]
- Updated dependencies [74a7804]
- Updated dependencies [53d3689]
- Updated dependencies [b3a63d3]
- Updated dependencies [033a34c]
- Updated dependencies [4d25d22]
- Updated dependencies [1ffee51]
- Updated dependencies [5ae4303]
- Updated dependencies [ece4dad]
- Updated dependencies [e9b377e]
- Updated dependencies [146f448]
- Updated dependencies [735f5c7]
- Updated dependencies [a7e18de]
- Updated dependencies [366f895]
- Updated dependencies [dc75ba8]
- Updated dependencies [cce0aa9]
- Updated dependencies [e764507]
- Updated dependencies [cff17af]
- Updated dependencies [39404f3]
- Updated dependencies [ca1965f]
- Updated dependencies [8619f95]
- Updated dependencies [b706af9]
- Updated dependencies [fc9ba76]
- Updated dependencies [0f94cc7]
- Updated dependencies [a11c1a5]
- Updated dependencies [71f9cd1]
- Updated dependencies [ee17d86]
- Updated dependencies [cdbd920]
- Updated dependencies [18c432e]
- Updated dependencies [3c418c4]
- Updated dependencies [fa8715a]
- Updated dependencies [a933ed7]
- Updated dependencies [b3ca463]
- Updated dependencies [a933ed7]
- Updated dependencies [0d4a6a8]
- Updated dependencies [518d5e5]
- Updated dependencies [6643ba1]
- Updated dependencies [eeba2ef]
- Updated dependencies [ec4c4d2]
- Updated dependencies [424f73c]
- Updated dependencies [cccbe51]
- Updated dependencies [a8d6b1d]
- Updated dependencies [e4a7695]
- Updated dependencies [87075b1]
- Updated dependencies [fc58a99]
- Updated dependencies [14cfc00]
- Updated dependencies [1c6f7b4]
- Updated dependencies [e854a53]
- Updated dependencies [dfebfc8]
- Updated dependencies [d028b37]
- Updated dependencies [122ef38]
- Updated dependencies [4a37870]
- Updated dependencies [428f9b2]
- Updated dependencies [aa7ff56]
- Updated dependencies [c41b42e]
- Updated dependencies [c4db311]
- Updated dependencies [750fff5]
- Updated dependencies [c19035e]
- Updated dependencies [ececf7a]
- Updated dependencies [d173125]
- Updated dependencies [8eeca27]
- Updated dependencies [8425c17]
- Updated dependencies [a5ef1d8]
- Updated dependencies [772d5de]
- Updated dependencies [ce80ec2]
- Updated dependencies [b372318]
- Updated dependencies [97a2263]
- Updated dependencies [29d0676]
- Updated dependencies [0169d49]
- Updated dependencies [6bd3231]
- Updated dependencies [d2b5ba8]
- Updated dependencies [b799ac5]
- Updated dependencies [8f74307]
- Updated dependencies [d23dc08]
- Updated dependencies [644ad50]
- Updated dependencies [0da7cd2]
- Updated dependencies [28a5c3e]
- Updated dependencies [4bc18e5]
  - @objectstack/spec@17.3.0

## 17.2.0

### Minor Changes

- 8cc8401: **BREAKING (accept-set tightening)**: a by-id `update`/`delete` whose `options.where` carries predicate keys beyond `id` is now refused loudly instead of silently dropping the predicate (#11009).
  
  The by-id dispatch routes to `driver.update(object, id, …)` / `driver.delete(object, id, …)`, which bind ONLY the primary key — every other `where` key was discarded with no diagnostic. A compare-and-set written as `{ where: { id, status: { $in: [...] } }, multi: false }` therefore evaluated to nothing and the write landed unconditionally, reading exactly like a working conditional write. Measured on `better-sqlite3` through a real `ObjectQL` + `SqlDriver`: `SqlHttpOutbox.redeliver`'s terminal-status guard was inert, so a delivery row claimed `in_flight` mid-redeliver was reset anyway and the redelivery reported success while the in-flight attempt kept running.
  
  What changes, per call shape (`resolveEngineUpdateDispatch` / `resolveEngineDeleteDispatch`, so every pinned test double inherits the same verdicts):
  
  - A `where` naming a scalar `id` **and nothing else** is unchanged — by-id, with or without `multi: true` (the `LifecycleService` guarded-reap idiom keeps its per-record cascade path).
  - A `where` carrying a scalar `id` **plus other keys**, with a declared `multi: true` (id sourced from `where`): now routes to the **predicate path** (`driver.updateMany` / `driver.deleteMany`), which compiles EVERY `where` key — the compare-and-set spelling. Previously this dispatched by-id and dropped the extra keys.
  - The same shape **without** `multi: true` — and any by-id call via a scalar `data.id` beside extra `where` keys, `multi` or not (the payload id outranks `multi` per #5748 and cannot be demoted onto the predicate path): now **throws**, naming the keys the by-id path would have dropped. Previously it succeeded with the condition ignored.
  
  A caller hitting the new refusal decides which of two things it meant, and each is a one-line edit at the call site: declare the predicate path (`multi: true`) so the full `where` is honoured and the result is the matched count, or drop the extra `where` keys to keep an unconditional single-row write. Flow authors reach this through `update_record` / `delete_record` nodes whose `filter` names `id` plus other keys without declaring `multi` — those configs were silently unconditional before and refuse loudly now.
  
  `SqlHttpOutbox.redeliver` itself now rides the predicate path, and `MemoryHttpOutbox.redeliver` re-checks terminal status after its guard, so both `IHttpOutbox` implementations agree: a row claimed between redeliver's read and its write is NOT reset, and `redeliver` reports `DELIVERY_NOT_ELIGIBLE` instead of success.
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable surface is removed or renamed — no spec key, no export, no config field changes spelling, so `objectstack migrate meta` has nothing to rewrite and no ledger entry could serve an upgrader. The newly-refused call shapes were silently broken before this change (their declared condition was never evaluated); the refusal text itself names the two call-site choices, and choosing between them is a per-site intent decision (conditional vs unconditional write) that a mechanical rewrite must not make. -->
- 05bc692: `runRepositoryContractTests` gains two narrow options so the shared invariant
  table can be applied to `SysMetadataRepository` — the implementation that backs
  every production metadata write, and the one that had never been handed to the
  suite (#10420). Both are additive and optional; every existing call site is
  unchanged.
  
  - **`primaryType` / `secondaryType`** move the suite's two *fixture* metadata
    types (previously hard-coded `'view'` and `'object'`), defaulting to exactly
    those. This is a fixture knob, not an invariant knob: no clause is added,
    removed or weakened by moving it. It exists because an implementation may sit
    behind a write-authorization door keyed on the type —
    `SysMetadataRepository.assertAllowed()` refuses any type whose registry entry
    lacks `allowOrgOverride`, `'object'` included — so a hard-coded fixture type
    silently decided which implementations could be held to the table at all.
  - **`declaredDivergences`** records an issue-tracked exception to the table.
    It does **not** skip the clause it names — a skipped clause is
    indistinguishable from coverage in a green run, which is the one failure a
    shared contract suite must not have. It swaps in a clause that *pins the
    divergent behaviour*, so the suite reds the day the implementation starts
    conforming and whoever fixes it is told to delete the declaration in the same
    PR. Shrink-only, audited in the fixing direction, like the repo's other
    ledgers. The only member today is `resumableWatch` (contract invariant 6), and
    the only declaration is `SysMetadataRepository` — see #10842.
  
  Publishable behaviour is otherwise untouched: `packages/metadata-protocol` gains
  a test file only, and 32 of the suite's 34 clauses were already satisfied by
  `SysMetadataRepository` on the first run.
- f334d66: `MetadataRepository.watch()` — a numeric `since` now replays from the durable
  log, and what a bare `watch(filter)` owes is written into the contract.
  
  **`SysMetadataRepository.watch(filter, since)`** read `since` only as a drop
  filter on live events, so an event that had already committed was unreachable
  through `watch()` however low `since` was set — even though the repository holds
  a durable per-org `event_seq` log in `sys_metadata_history` and already reads it
  org-wide in `nextEventSeq()`. Invariant 6 of the repository contract
  ("`watch(_, since)` MUST replay all events with `seq > since` before delivering
  live events") was therefore unimplemented in the repository backing every
  production metadata write. It now replays through that same query, using the
  row-to-event mapping extracted out of `history()`. The live listener is
  registered before the durable read is issued and a set of delivered `seq`
  numbers closes the replay-to-live seam, so an event committing mid-read arrives
  exactly once; a failed durable read is raised to the consumer rather than
  degraded into a silent live-only tail.
  
  **No behaviour change for a `watch()` with no `since`** — deliberately. Both
  in-repo production subscribers (`MetadataManager.startRepositoryWatch()` and
  `MetadataCache.start()`) attach that way, and replaying for them would push an
  org's entire history through cache invalidation and HMR as "this just changed"
  at every attach.
  
  **Contract text (`@objectstack/metadata-core`, `repository.ts`).** Invariant 6
  now states its own boundary: a `watch()` with no `since` is owed **live events
  only**; an implementation MAY additionally deliver events that had already
  committed, but a caller MUST NOT rely on it, and a caller that needs the
  already-committed prefix passes a numeric `since` or reads `history()`. That
  half was previously unwritten and load-bearing — "no `since` replays
  everything" existed only as `InMemoryRepository`'s implementation, and the
  shared contract suite silently depended on it.
  
  **If you run `runRepositoryContractTests` from
  `@objectstack/metadata-core/testing` against your own implementation**, one
  clause changed shape. `watch filters by type and name` (which wrote twice, then
  opened a watch and expected the match back) is replaced by `watch filters by
  type and name — over the live stream`, which opens the subscription first and
  writes after. FROM: an implementation passed by replaying its whole matching log
  on a bare `watch(filter)`. TO: it passes by delivering, and filtering, the
  events that commit after the subscription is established. An implementation that
  replays as well still passes — the new clause asserts the floor, not the
  maximum. If yours only replayed and never delivered live events, it was relying
  on unspecified behaviour and now needs a live path.
- 2810695: **BREAKING (accept-set tightening)**: a by-id `update` whose truthy scalar `options.where.id` names a DIFFERENT row than the truthy scalar payload `data.id` is now refused loudly — `UPDATE_ID_MISMATCH`, HTTP 400 — instead of silently binding the payload row and discarding the `where.id` predicate (#11142).
  
  `update(obj, { id: 'rec_1', title: 'x' }, { where: { id: 'rec_2' } })` used to write `rec_1` with no diagnostic: the caller declared "update rec_1 where id = rec_2" — a condition that can never hold — and the by-id path dropped the losing spelling exactly the way #11009's extra `where` keys were dropped. This was the one unhonoured-predicate shape #11009's refusal deliberately left standing, because refusing it partially reverses the #5748-pinned verdict (`a SCALAR data.id still wins over a scalar where.id`). The maintainer ruling on #11142 (2026-08-23) authorizes that reversal for the UNEQUAL truthy scalar shape only.
  
  What changes, per call shape (`resolveEngineUpdateDispatch`, so every pinned test double inherits the same verdict):
  
  - `data.id === where.id` (both truthy scalars) is **unchanged** — by-id. This is the normal REST spelling: the ingress folds the path id into the payload, so redundant-but-agreeing pairs are routine.
  - `data.id` and `where.id` both truthy scalars and **different** — including differing only in type, e.g. `42` beside `'42'` — now **throws** `UPDATE_ID_MISMATCH` with `status: 400`, naming both ids. A declared `multi: true` does not rescue the call (the payload id outranks `multi` per #5748, so the contradiction stands). Previously the write landed on the payload row with the condition silently ignored.
  - A **falsy** scalar `where.id` (`0`, `''`) beside a payload id is unchanged (a falsy id identifies no row on this ladder, so there is no second row address to conflict with), and a **non-scalar** `where.id` (`{ $in: [...] }`, an array, `null`) beside a payload id keeps its #5748 by-id verdict — widening over either is a separate decision, deliberately not taken here.
  
  A caller hitting the new refusal wrote two row addresses and meant one of them; each fix is a one-line edit at the call site: make the two ids equal (or drop `where.id`) to keep addressing the row by the payload id, or remove `id` from the payload to address the row by `where.id`. The refusal is decorated with `code: 'UPDATE_ID_MISMATCH'` and `status: 400` on the thrown error (registered in the ADR-0112 error-code ledger; the spec's `ErrorCode` union gains the member), so REST callers get a located 400 instead of a sanitised 500, and doubles pinned to `assertEngineUpdateDispatch` throw the identical envelope.
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable surface is removed or renamed — no spec key, no export, no config field changes spelling, so `objectstack migrate meta` has nothing to rewrite and no ledger entry could serve an upgrader. The newly-refused call shape was a self-contradictory input whose declared condition was never evaluated; deciding which of the two ids the caller meant is a per-site intent decision a mechanical rewrite must not make, and the refusal text itself names both call-site fixes. -->

### Patch Changes

- 26f3588: **Fix:** the REST `/meta` doors now decide **organization scope on the folded type**, never on the raw URL spelling (#10340).
  
  Storage folds `/meta/:type` through `META_URL_TO_SINGULAR` — the complete spelling map — while the doors' scope predicate (`declaresOrgOverride`) tolerates only the manifest-collection spellings. For the two registry-derived spellings, `translations` and `email_templates`, the doors therefore read and wrote **env-wide** where the singular twin was org-scoped: an org-active author's `PUT /meta/translations/:name` landed an env-wide row their own org-scoped read then shadowed (persisted, receipted as live, served by nothing), and `GET` under one spelling answered a different partition than the other — one item, two namespaces, addressed by spelling (#4432 / #7894's defect one layer down).
  
  - All nine `/meta` org-scope call sites (list, single read, layers view, compound read, save, compound save, delete, publish, rollback) fold the segment through `canonicalMetaUrlType` **before** calling `organizationIdForMetaRead` / `organizationIdForMetaWrite`, exactly as `metadata-url-spelling.ts` mandates: folding happens at the boundary and only there.
  - The `GET /meta/:type/:name/published` code-store fallback folds too — the smaller second site of the same class: it reads a registry keyed by canonical types, so a recognised plural of a code-published item answered 404 while the singular answered 200.
  - **Deliberately unchanged:** `GET /meta/_drafts` still applies no fold (it filters by the draft row's *stored* type, which is canonical because the protocol folds on save), the request `type` handed to the protocol stays the raw segment (the protocol owns its own fold), and `declaresOrgOverride` does **not** absorb the URL map — a predicate below the boundary consuming the URL spelling contract is the repair #7894 forbids. `@objectstack/metadata-core` changes are documentation and pins only: the predicate's header no longer claims parity with the protocol's normalization (measured false), and new tests pin both the composed fold→predicate contract and the predicate's deliberate limit.
  
  No stored rows move: rows previously minted env-wide through a plural spelling stay env-wide and keep serving org-less callers (and org-active callers until an org overlay exists), which is the same layering the singular spelling always had.
- Updated dependencies [6936d07]
- Updated dependencies [59eb04d]
- Updated dependencies [9f05b7d]
- Updated dependencies [7d2d112]
- Updated dependencies [5fa0d72]
- Updated dependencies [02b3b07]
- Updated dependencies [914c413]
- Updated dependencies [55809a0]
- Updated dependencies [52db1d1]
- Updated dependencies [5649efb]
- Updated dependencies [2306a76]
- Updated dependencies [e5ea701]
- Updated dependencies [a40dcc1]
- Updated dependencies [def0d3e]
- Updated dependencies [8d0bb79]
- Updated dependencies [5acb58d]
- Updated dependencies [2e3cf95]
- Updated dependencies [4c93387]
- Updated dependencies [a037f7c]
- Updated dependencies [3ee8ddf]
- Updated dependencies [16cef97]
- Updated dependencies [a79bd35]
- Updated dependencies [6ceaa4b]
- Updated dependencies [15ea214]
- Updated dependencies [de19489]
- Updated dependencies [c684d00]
- Updated dependencies [923c424]
- Updated dependencies [1ec36b7]
- Updated dependencies [5f2e54c]
- Updated dependencies [189373b]
- Updated dependencies [35ad101]
- Updated dependencies [ceb33a9]
- Updated dependencies [73d9795]
- Updated dependencies [8012960]
- Updated dependencies [f34f56b]
- Updated dependencies [f399618]
- Updated dependencies [75e9301]
- Updated dependencies [2810695]
  - @objectstack/spec@17.2.0

## 17.1.0

### Patch Changes

- b6c7690: fix(rest): org-overridable metadata is served back by every `/meta` read door, not just persisted (#9454)
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable key is
  added, renamed, retired or tombstoned. One new exported predicate in
  `metadata-core` (`organizationIdForMetaRead`), one widened optional request
  member on an existing protocol method (`getMetaItemCached`'s `organizationId`),
  and caller-side threading in `packages/rest`. The accept/reject behaviour of
  every write door is unchanged — this card is read-side only. -->
  
  A runtime `PUT` of an org-overridable metadata type — `view`, `dashboard`,
  `report`, `translation`, `email_template` — answered **200** with a receipt
  reporting `state: 'active'` plus a version and sequence number, **persisted the
  row with its `organization_id`**, and was then served back by **nothing**: the
  direct `GET` answered 404, the scoped listing was unchanged, the unfiltered
  listing was missing it, and the browser rendered an empty view or "Dashboard Not
  Found". The platform reported success in the same breath as not delivering the
  work, which is declared ≠ enforced in the direction hardest for an author to
  notice — the write path says everything worked.
  
  **The write door was correct as-is.** The row really is persisted, so the
  receipt is truthful; this was persisted-but-not-served, never a silent write
  no-op. **The overlay-resolution layer was correct too**, and type-agnostic:
  `getMetaItem` resolves `(orgId ? findOverlay(orgId) : undefined) ??
  findOverlay(null)`, `getMetaItems` unions both scopes under org-wins precedence,
  and `getMetaItemLayered` even reports `overlayScope`. The defect was that the
  REST read doors **never stated the scope**, so every one of them asked for the
  env-wide partition and the org partition was never consulted.
  
  **The repair is one registry-derived predicate, threaded at the read doors.**
  `organizationIdForMetaRead` joins `organizationIdForMetaWrite` in
  `metadata-core`, deriving from the same `allowOrgOverride` registry flag, so
  read scope and write scope cannot drift and a registry entry flipping the flag
  moves both doors together. It is threaded through the **already-memoised**
  `resolveExecCtx`, so no new per-request organization resolution is introduced.
  
  ⛔ **Not a bare `ctx?.tenantId` at each site**, and the reason is measurable
  rather than stylistic: deployments predating the #6190 ruling hold **phantom
  org-scoped rows for types the registry declares non-overridable** (the runtime
  used to stamp `organization_id` on every type). Boot hydration deliberately
  walks past those rows, so they are dead. A read door naming the org for *every*
  type would resolve them again — serving, on the read side, a document that
  vanishes at the next restart.
  
  **`getMetaItemCached` gains an `organizationId` member** — it was the only meta
  read verb that could not express one, having hard-coded a two-key delegation to
  `getMetaItem`. The organization is also folded into its **ETag**. The mechanism
  differs from `locale` and the difference is stated rather than glossed: `locale`
  is invisible to the hash (the body is translated after the validator runs), so
  folding it in was the only way it could vary the validator at all, whereas the
  org-resolved document *is* the thing hashed. No cache leak is claimed — the
  directive is `private, no-cache` and there is no server-side cache entry keyed by
  type+name. It is folded in because that makes scope a **declared** property of
  the validator instead of an emergent property of the body.
  
  **Both REST branches are fixed, which is the half-fix this card could easily
  have shipped instead.** `view` and `dashboard` share one mechanism but reach it
  through two different arms: `view` takes the cached arm (`getMetaItemCached`),
  while `dashboard` bypasses the cache via `isDashboardType` and takes the
  uncached arm. Both omitted the org, so a fix applied to one arm would have
  fixed exactly one type while the receipt kept claiming success for the other.
  The scope is now resolved **above** the fork, so the two arms cannot disagree.
  
  The regression proof drives real REST routes against a real protocol over a stub
  engine — write-then-read agreement on **one boot**, for all five types, through
  both arms. Its most important assertions are the ones that do **not** merely
  check the item comes back: an org-less caller and a **second organization** must
  each be refused it. An org-blind overlay fallback would satisfy every other
  assertion in the file while matching an arbitrary tenant's row.
- 845e164: fix(metadata-protocol): a package publish refused by the namespace-prefix rule now leaves an audit row per violation (#8595)
  
  `publishPackageDrafts` refuses a whole batch pre-flight when an object draft's
  name is missing its package namespace prefix (ADR-0028). That refusal returns
  ABOVE the batch's `engine.transaction()`, so it reached neither the post-commit
  `allowed` rows nor the rollback handler's `batch_aborted` row: it wrote nothing
  to `sys_metadata_audit` at all. The compliance consequence is the defect — a
  package rejected for a bad object name was **indistinguishable in the trail from
  a package nobody ever pressed Publish on**, so a compliance query could not tell
  a refused publish from one that never happened.
  
  Each violation now leaves its own `publish` / `denied` row keyed on the
  offending draft's `(type, name)` — the tuple `auditMetaItem` reads, so the
  refusal is visible on that item's own audit-log tab via
  `GET /api/v1/meta/:type/:name/audit`. The row carries the violated rule
  (`namespace_prefix`) as its `code`, and the rule's actionable message as `note`.
  Rows are keyed on the draft's own organization scope, matching the promoted
  rows: an env-wide draft audits env-wide even when the publishing session carries
  an active org.
  
  One row per violation rather than one per batch: a pre-flight refusal names N
  violating items and no single causal one, so a batch-level row would have had to
  mint a synthetic identity — exactly what the `batch_aborted` row declines to do
  for its own unattributable case.
- 1a7f907: fix(metadata): a package publish refuses a draft stored under a non-canonical metadata type, and the ADR-0010 audit writer asserts its `type` instead of folding it (#8908)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
  renamed, retired or tombstoned — no spec key changes shape, so there is no
  conversion to register. Two accept sets are narrowed at runtime (the batch
  publish's pre-flight, and `recordMetadataAudit`'s `type` argument), and two
  error codes are added to the ADR-0112 ledger. The rows this refuses are
  pre-#7894 residue that no current writer can mint. -->
  
  **Two tightenings, one card, because they are the same defect at two layers.**
  
  `publishPackageDrafts` reads `sys_metadata` rows **at rest**, so #7894's `/meta`
  boundary fold never reached it. `promoteDraftForPublish` folds the stored
  spelling through `PLURAL_TO_SINGULAR` — the *manifest-collection* map, which
  legitimately omits types that are not stack collections. For those the fold is a
  **no-op**: the lookup key equals the stored spelling, the draft resolves, and the
  publish mints an ACTIVE row in the namespace `PUT /meta/field/…` answers
  403 NOT_OVERRIDABLE for. Measured on the card with the real repository over a
  stub engine:
  
  ```
  publishPackageDrafts({ packageId: 'app.demo' })
    → { success: true, publishedCount: 1, published: [{ type: 'fields', name: 'legacy_field' }] }
  active row: { type: 'fields', name: 'legacy_field', package_id: 'app.demo' }
  audit row:  { type: 'fields', name: 'legacy_field', outcome: 'allowed', code: 'ok' }
  ```
  
  Every registry read and every compliance query on `field` misses an item the
  platform just reported as published — the #4432 shadowing shape, minted at
  publish time instead of at the URL, and the last route by which a pre-#7894 row
  could be re-promoted rather than migrated.
  
  **1. The publish refuses it, at the pre-flight, batch-atomically.** Same shape as
  the ADR-0028 namespace-prefix gate that already stands there: found before
  anything is promoted, failing the whole batch (`publishedCount: 0`,
  `published: []`) rather than publishing the healthy siblings around it, with one
  audit row per violation. The refusal names the row, names the canonical type, and
  states the re-author path; `failed[].code` is the new
  `STORED_TYPE_NOT_CANONICAL`, and the audit column's spelling is
  `stored_type_not_canonical`.
  
  The rule is **derived, not a list**: a spelling the platform's URL/registry map
  folds elsewhere *and* the manifest map leaves unchanged. Against the real maps
  that is **six** spellings — `fields`, `seeds`, `external_catalogs`,
  `externalCatalogs`, `translations`, `email_templates` — where the card named
  four; the last two would have been missing from any hand-written list, and a
  newly declared type that never reaches the manifest map is covered on the day it
  is declared. A manifest-**present** plural (`objects`) is deliberately *not* in
  the class: it is already fail-closed at the promote (`NO_DRAFT`, batch aborted)
  and keeps that verdict.
  
  ⛔ Deliberately **not** included: migrating the row (a `_migrate-stored` /
  boot-reconciliation conversion). That was the other option on the card and is
  explicitly unruled — it stays available as a follow-up with its own appetite.
  
  **2. `recordMetadataAudit` refuses a non-canonical `type` (`AUDIT_TYPE_NOT_CANONICAL`)
  instead of folding it.** The writer used to open with
  `type: PLURAL_TO_SINGULAR[entry.type] ?? entry.type` — a lenient consumer, and a
  **tolerant-and-incomplete** one: the fold read the same manifest map, so the
  compliance trail came out canonical for the 29 types that never needed it and
  non-canonical for exactly the ones that did. Ruled the same direction as the
  refusal above: **fold at the boundary, assert at the writer.** Every call site
  that builds a row out of an at-rest `type` — all of them on
  `publishPackageDrafts` — now folds with `canonicalMetaType`; the `/meta` routes
  were already canonical by the time they got there. The throw sits **outside** the
  writer's best-effort `try`, because inside it the method's own `catch` would
  degrade the assert into a `console.warn`.
  
  The assert cannot refuse a canonical type (no canonical spelling folds
  elsewhere — 33 of 33, measured) nor a plugin-registered or otherwise
  unrecognised kind (`canonicalMetaType` is the identity for anything the static
  map does not carry), so it narrows the accept set without closing it.
  
  **Reachability was enumerated before the assert landed**, as the ruling required:
  `recordMetadataAudit` is private to `protocol.ts` with 11 call sites, `sys_metadata`
  rows have exactly one producer in the repository (`saveMetaItem` → `repo.put`,
  post-fold), and no current write path can mint a non-canonical stored type. The
  only non-canonical types that ever reached an audit write came from the batch
  publish's at-rest rows, which is what the boundary folds now cover.
  
  Also fixed, as a consequence of that fold rather than as a separate change: on
  the batch route `getEffectiveLock`'s overlay limb was queried with the raw stored
  spelling, so an ADR-0010 `_lock` carried by the canonical active row was looked
  up under a `type` no row has and came back `'none'` — the verdict "the author
  declared no protection". That is the batch twin of the hole #8769 closed on
  `publishMetaItem`.
- 7fc01db: REST `/meta` write doors now carry the caller's organization, so audit rows are no longer stamped environment-wide
  
  `PUT /meta/:type/:name` (both arities), `DELETE /meta/:type/:name`,
  `POST /meta/:type/:name/publish` and `POST /meta/:type/:name/rollback` passed no
  organization, so every `sys_metadata_audit` row a REST-authored metadata write produced was
  stamped `organization_id: null`. Composed with the scoped audit read shipped alongside it —
  which returns own-org rows **plus** environment-wide ones, a limb that is required rather
  than optional — that left every REST-authored audit row readable by every tenant, carrying
  its `actor`, `note`, `lock_state` and `request_id`. The read side could not close this: the
  rows were genuinely unscoped, so no filter could separate them.
  
  The organization is taken from the execution context these doors already resolve, and is
  threaded through `organizationIdForMetaWrite` — the same registry-derived predicate the
  runtime `/metadata` dispatcher uses. Types the registry declares `allowOrgOverride: true`
  (`view`, `dashboard`, `report`, `translation`, `email_template`) now scope both the overlay
  row and its audit row to the caller's organization; every other type continues to write
  environment-wide, because its write genuinely is environment-wide and the protocol refuses
  an org-scoped write for it. `null` is now reserved for writes that really are
  environment-wide.
  
  Two behaviour changes ride along, both required for the fix to be usable rather than
  separate improvements: `publish` and `rollback` resolve their row through the organization,
  so scoping the save without scoping them would have broken the draft → publish loop; and
  `GET /meta/:type/:name/published` is now organization-scoped (organization-first, then
  environment-wide), without which it would answer 404 for an item the same caller had just
  published through the same transport.
  
  `organizationIdForMetaWrite` / `declaresOrgOverride` moved from `@objectstack/runtime` into
  `@objectstack/metadata-core` so both doors share one implementation — `@objectstack/rest`
  cannot import from `runtime`, which depends on it. Runtime behaviour is unchanged.
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [11b779e]
- Updated dependencies [739fe5b]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [3851f87]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0

## 17.0.0

### Major Changes

- 65f184b: fix(metadata)!: `sys_metadata_history.recorded_by` stores NULL, not the sentinel string `'system'` (#4556)

  `recorded_by` is declared `Field.lookup('sys_user', { readonly: true })` — a
  foreign key. The write path filled it with `actor ?? 'system'`, so every
  metadata write without a caller actor (boot sync, migration, an internal call)
  stored the **string** `'system'` in a column whose declared type says "the id
  of a `sys_user` row". No such row exists, and `SystemUserId.SYSTEM`
  (`'usr_system'`) is not auto-provisioned on the current runtime either, so the
  value resolved to nothing under any reading. Any consumer that read the field
  by its declaration — `expand`, an owner column in a report, an audit timeline
  showing "who changed this" — got an id that could not be dereferenced.

  It had already cost twice. #4441 had to exempt every `readonly` field from the
  write-path referential-integrity check, because otherwise ordinary metadata
  authoring (package create / publish / clone) was rejected. #4551's
  dangling-reference audit had to skip the same set for the same reason. The
  field ended up the platform's only reference column that is neither enforced
  nor audited.

  **The fix is on the write path, not the declaration.** `recorded_by` stays a
  `lookup('sys_user')`; an actor-less write now stores `NULL`, and `NULL` means
  "system-initiated (boot sync, migration, scheduled job)" — the standard
  expression of "no link", and already what this column's `set_null` delete
  behaviour means. No magic system-user account (a row that can never sign in yet
  holds an identity is a new security surface), and no `actor_kind` companion
  column.

  **Breaking — the repository contract is now explicitly nullable.**

  | Surface                                   | Before   | After                                 |
  | :---------------------------------------- | :------- | :------------------------------------ |
  | `PutOptions.actor`, `DeleteOptions.actor` | `string` | `string \| null` (still **required**) |
  | `MetadataEvent.actor`                     | `string` | `string \| null`                      |
  | `MetadataItem.authoredBy`                 | `string` | `string \| null`                      |

  `actor` stays required rather than becoming optional on purpose: every call
  site must state which of the two it is, so a forgotten actor cannot silently
  become a fake foreign key. Migrating a caller:

  - **Writers** — passing a real identity: unchanged. Passing `'system'`, `''`,
    or a label to satisfy the type: pass `null` instead.
  - **Readers** — `event.actor` and `item.authoredBy` can be `null`. Handle it at
    the point of display (`actor ?? 'System'` in a UI string is fine — the fix is
    that the _stored_ value no longer lies, not that no label may ever be shown).

  Two read paths also stopped inventing a value: `SysMetadataRepository.history()`
  and `getByHash()` rendered an absent actor as the string `'unknown'`, which is
  indistinguishable from a real user id to anything that resolves the field. They
  now surface `null`.

  **Existing rows: `os migrate recorded-by`.** The stored `'system'` values are
  rewritten to `NULL` by a new command, which runs the conversion through the
  ADR-0119 D2 migration journal (chunk-atomic, resumable via `os migrate resume`).
  It is a dry run by default and safe to re-run — it selects only rows still
  holding the sentinel, so a second `--apply` converts nothing.

  The rewrite is **semantically equivalent, not a reinterpretation**: this column
  has only ever held that one sentinel, written by exactly one expression
  (`actor ?? 'system'`), and both spellings mean "no actor" — only `NULL` is
  expressible in the declared type.

  Deliberately unchanged: `sys_metadata_audit.actor` is a `text` column whose
  declaration already says "user id, system id, or `'system'`", so its `'system'`
  default is honest and stays. The #4441 `readonly` narrowing and the #4551 audit
  skip also stay — see the PR for why they are still correct.

- ce92674: feat(spec)!: retire the standalone `validation` metadata kind (#4509, ADR-0088)

  A validation rule authored as its own artifact bound to nothing and gated no
  write. `ValidationRuleSchema` carries **no object-binding key** — no `object`,
  no `objectName` — and all six variants are `strictObject`, so an author could
  not supply one either. No merge step existed. The only code that expected such a
  key was a reference-tracker row scanning a field the schema would have stripped.
  Meanwhile the engine evaluates exactly one shape: the object's own
  `validations[]` array, on insert and on every matched update row.

  So a rule created through the standalone door — a `*.validation.ts` file, or
  Studio's Validations list — parsed, saved, reported success, and intercepted
  nothing. Including a `state_machine` rule, which ADR-0020 routes through this
  same vocabulary: an author could believe they had locked down record state
  transitions and have changed nothing at all.

  Under ADR-0088 the kind fails the admission test on its first clause: a rule has
  no independent lifecycle, because it only means something against an object. And
  unlike the sibling disconnects closed in this batch, it could not be bridged into
  one — the shape has nowhere to name its object.

  **The rule vocabulary is untouched.** `ValidationRuleSchema` and all six
  variants are unchanged and fully live; the engine's evaluation path is not
  modified by this change. It is the _kind_ that was inert, not the schema. The
  liveness ledger keeps governing it through the gate's `SPEC_ONLY_SCHEMAS`
  override (alongside `webhook` and `query`), because an ungoverned live schema is
  exactly how the next drift would hide.

  **Migration.** Move the rule into the owning object's `validations:` array — the
  rule body is identical, same schema, same six variants:

  ```ts
  // before — a standalone *.validation.ts, which never ran
  export default defineValidation({ name: 'amount_positive', type: 'script', … })

  // after — on the object, where rules are evaluated
  ObjectSchema.create({
    name: 'invoice',
    validations: [{ name: 'amount_positive', type: 'script', … }],
  })
  ```

  Removed: the registry entry (and its `*.validation.ts` / `*.validation.yml`
  patterns), the `MetadataTypeSchema` member, the metadata-core lockstep enum
  member, the schema-map entry, the create seed, Studio's Validations nav item and
  its hand-crafted form, and the dangling reference-tracker row. Standalone rows
  already in `sys_metadata` are left alone — they were never evaluated, so nothing
  changes behaviorally.

### Minor Changes

- f5a4ef0: refactor!: ADR-0112 batch 2 — sweep the lowercase error-code emitters (#4003)

  Continues #3841 per ADR-0112. Batch 1 (#3988) settled the vocabulary and closed
  the set; this batch moves the emitters that still spoke lowercase `snake_case`
  onto it.

  **Wire-visible change.** Error codes on these surfaces change spelling. Generic
  conditions collapse onto the standard catalog rather than keeping a synonym:
  `unauthorized`/`unauthenticated` → `UNAUTHENTICATED`, `forbidden` →
  `PERMISSION_DENIED`, `not_found` → `RESOURCE_NOT_FOUND`, `internal` →
  `INTERNAL_ERROR`, `unavailable` → `SERVICE_UNAVAILABLE`, `not_supported` →
  `NOT_IMPLEMENTED`, `bad_request` → `INVALID_REQUEST`. Domain conditions get codes
  registered in `ERROR_CODE_LEDGER` (`MARKETPLACE_STORAGE_FAILED`,
  `PLUGIN_MANIFEST_INVALID`, `ITEM_LOCKED`, `DELIVERY_NOT_ELIGIBLE`, …). Swept:
  `cloud-connection`, `plugin-auth`, `hono`, `metadata-protocol`, `rest`,
  `service-messaging`, `service-automation`, `trigger-api`.

  Branch on `error.code` values rather than pattern-matching their case: the
  console's fix for the same rename (objectui#2977) reads codes case-insensitively
  for exactly this reason, and that is the pattern to copy in your own consumers if
  you support servers on both sides of the change.

  **Four routes stop putting a code in the message slot.** The webhook redeliver
  route, the API-trigger webhook, and two `rest` routes answered
  `{ success: false, error: '<code>', message }` — the code occupying `error`, the
  declared object envelope nowhere. They now emit `error: { code, message }`, and
  three API-trigger branches gained a message they never had. Clients reading
  `body.error` as a string on those routes must read `body.error.code`.

  **`ConnectorErrorCategory` / `ConnectorRetryStrategy`** (ADR-0112 D9a):
  `@objectstack/spec` exported two mutually incompatible `ErrorCategory` types and
  two `RetryStrategy` types. The connector-side pair is renamed; importers of the
  `integration` subpath update the name. Side effect: the api-side `ErrorCategory`
  and `RetryStrategy` now appear in the generated API reference at all — the name
  collision had been silently dropping them.

  **`OAUTH_REGISTER_FAILED` replaces an unbounded code source.** The OAuth client
  registration route put better-auth's arbitrary `body.error` string straight into
  `error.code`. The code is now ours and the upstream discriminator moved to
  `details.upstreamError`.

  **Not swept, deliberately.** `sys_metadata_audit.code` keeps its lowercase values
  (ADR-0112 D6b): it is persisted audit history, and the same column holds
  non-error outcomes (`ok`, `lock_override`). Diagnostics records that ship inside a
  200 keep theirs (D6c), as do field-level codes (D6, #3977) and the CLI's
  `--json` output contract.

  A `check:error-code-casing` CI guard now fails on a new lowercase literal in a
  code position, since the ledger's casing rule can only police codes that someone
  registers.

- 121852d: Metadata-plane FLS: the ADR-0106 D4 read exemption is now **derived** from the #6603 write-capability gate, so "whoever can write a schema can see all of it" is enforced by construction (#7020).

  The two sets used to be maintained separately and were in fact different: the write gate demands `manage_metadata`, while the D4 exemption listed `studio.access` / `setup.access`. They met only on the shipped `admin_full_access` set, which carries all three — so the invariant #6603's ruling stated held by coincidence, not by construction. A caller holding `manage_metadata` alone passed every metadata write gate and still read a **masked** object schema, and its GET, edit and PUT round trip then deleted the fields it was never shown.

  `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES` is now the union of two named halves — `OBJECT_SCHEMA_WRITE_CAPABILITIES` (the write gate's key, spelled once) and `OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES` (`studio.access` / `setup.access`) — both newly exported from `@objectstack/metadata-core`.

  **Behaviour change:** a caller holding `manage_metadata` now reads object schemas unmasked on every schema-serving exit. This widens read access for that cohort and is the ruled intent (maintainer, 2026-08-10). The derivation is one-directional: no principal loses read access, and the `/packages` read cohort (#7033 / #7023) keeps its own separately-ruled set.

- c7e7900: fix(metadata-core,metadata-fs): hash the serialized form, so `put().version` identifies the bytes actually stored (#7856)

  `hashSpec` canonicalised a `Date` to `{}`, because `canonicalize` walked a
  value's own enumerable keys and a `Date` has none. `JSON.stringify` — what every
  repository actually writes — turns the same `Date` into an ISO string. So the
  hash of the in-memory spec and the hash of the bytes on disk were **different
  hashes for the same item**, and the version handed back to a caller did not
  identify what had been stored.

  Measured on `main`, one spec carrying one `Date`:

  ```
  canonicalize(in-memory) : {"createdAt":{},"label":"Home"}
  JSON.stringify (bytes)  : {"label":"Home","createdAt":"2024-01-01T00:00:00.000Z"}
  ```

  `canonicalize` now honours `toJSON` exactly as `JSON.stringify` does —
  consulted once per position, its result serialised as-is and never
  re-consulted — which makes a new guarantee true by construction:

  ```
  canonicalize(x) === canonicalize(JSON.parse(JSON.stringify(x)))
  ```

  **Both repository implementations were wrong, in different places**, which is
  why the fix is one function rather than two patches. `FileSystemRepository`
  broke `put().version === get().hash`: it hashed the spec it was handed, wrote
  `JSON.stringify` of it, and re-hashed the parse on the way back out.
  `InMemoryRepository` broke the repository contract's invariant 4
  (`item.hash === hashSpec(item.body)`): it stores `body` already serialised
  (`clonePlain`) while hashing the in-memory spec, so the item it returns
  disagreed with its own hash. `SysMetadataRepository` inherits the fix through
  the same function.

  Downstream, an incoherent version meant a repository could report an
  `{op:'update', actor:'fs'}` for a file nothing outside the process had touched:
  the head index held a hash the disk could never reproduce, so re-reading one's
  own write looked like somebody else's edit. That surfaces without any watcher —
  a restart rebuilds the index from disk and the version the caller was handed no
  longer matches it.

  **Ordinary specs hash exactly as before, and this is not a migration.** The new
  path diverges only at a position carrying a callable `toJSON`; a graph without
  one is byte-identical through `canonicalize`. Verified against this repository's
  entire checked-in JSON corpus — 1973 files hashed under both the old and the new
  implementation, **0 hashes changed** — and the `hashSpec({})` regression guard
  in `metadata-core` is unmoved. Stored versions for ordinary specs keep their
  meaning. Versions for `toJSON`-carrying specs do change, and those are exactly
  the versions that never identified their stored bytes in the first place.

  Also supported as a consequence: a class instance with a `toJSON` now hashes as
  whatever it serialises to, rather than as its private fields. One without a
  `toJSON` still hashes as its own enumerable keys — which is what
  `JSON.stringify` writes for it.

  The pin is table-driven and lives in the shared repository contract suite, so
  every `MetadataRepository` implementation is held to it: `Date` at a key, `Date`
  under an array index, a class whose `toJSON` yields a string, an object literal
  carrying its own `toJSON`, a nested case, and a plain-JSON control row that
  proves the fix did not simply change every hash.

- 3670cf9: feat(metadata-core, objectql): machine-readable provenance for injected system columns — one authoritative answer to "is this column actually provisioned by the platform?" (#7865)

  `applySystemFields` injects the platform anchors (`organization_id`,
  `owner_id`, `owning_business_unit_id`, the audit family) into every object that
  has not opted out — **including federated ones** (ADR-0015 `external`), for
  which the platform provisions no storage: `Engine.syncObjectSchema` returns
  early and issues no DDL. On such an object those anchors exist in the
  registered schema and nowhere else, and a predicate over one degrades silently
  on SQLite (unresolvable identifier → string literal → constant-false: HTTP 200,
  zero rows, no error). Three consumers had independently re-derived that fact
  (engine `DriverOptions.tenantId` withholding, plugin-security's Layer-0 phantom
  guard, plugin-sharing's proposed `owner_id` twin).

  Per the 2026-08-12 maintainer ruling (direction B), the injection keeps running
  and the injected anchors now carry a machine-readable provenance marker, spelled
  as an exported derivation in `@objectstack/metadata-core` (re-exported by
  `@objectstack/objectql`, the injecting registry):

  - `platformProvisionsStorage(def)` — `false` exactly for ADR-0015 `external`
    objects (the same predicate `syncObjectSchema` routes by, exported once).
  - `resolveInjectedColumnProvenance(def, column)` —
    `'author' | 'injected-provisioned' | 'injected-unprovisioned' | 'absent'`;
    `'injected-unprovisioned'` is the marker: the platform's own injected anchor
    with no storage behind it.
  - `unprovisionedInjectedColumns(def)` — the enumerable form.

  The marker is deliberately **not** a `provisioned: false` key on the field
  definitions: `FieldSchema` is strict (an undeclared key would stamp
  `_diagnostics: { valid: false }` on every served federated object, and
  declaring it would hand authors a forgeable switch over their own tenant wall),
  and the anchor definitions are read by exact identity in the #4326 round-trip
  strip and plugin-security's Layer-0 guard — a data key would flip both. No
  document byte changes anywhere: registered, served (`/meta`), or stored. The
  existing consumer guards are unchanged and converge on this API opportunistically
  as they are next touched, per the ruling.

  An author-declared column of the same name — including a real remote
  `organization_id` on a federated object — answers `'author'`, never the marker,
  so a consumer acting on the marker can never suppress a tenant wall the author
  deliberately made real. Any inexact match fails toward `'author'`: toward
  enforcement, never exposure.

- 5e247fd: fix(metadata-protocol): a `/meta` object read serves the effective runtime schema, whichever layer answered (#6562)

  `GET /api/v1/meta/object/:name` answered a **different set of fields** depending
  on which link of its resolution chain produced the answer, for the same object:

  - **registry-backed** → the schema AFTER `applySystemFields`, so it carried the
    injected system columns — `created_at`, `created_by`, `updated_at`,
    `updated_by`, `organization_id`, `owner_id`, `owning_business_unit_id` — even
    when the author declared none of them;
  - **overlay-backed** (a `sys_metadata` customization row, or a MetadataService
    body) → the stored document VERBATIM, so every one of those columns was simply
    absent.

  Whether an object carries an overlay is invisible to the caller, so the same
  request reported the platform's own columns or not, and nothing in the response
  said which had happened. `/meta` is the machine-readable contract clients and AI
  authors code against: an author reading an overlay-backed object saw no
  `created_at` / `owner_id` / `organization_id` and reasonably concluded the
  columns do not exist — while every one of them is real in the database,
  filterable, orderable, and enforced read-only on write.

  **Every `/meta` object read exit now serves the effective schema.** The
  single-item read, the list, the cached/ETag branch, both draft reads and the
  layered read's `effective` layer all report the injected columns, with the same
  `readonly` / `system` markers the engine enforces (`owner_id` stays
  `readonly: false` — ownership is transferable). This is the presence half of the
  seam #4513 closed the value half of.

  Three things deliberately did **not** change:

  - **`?layers=1`'s `overlay` layer stays byte-verbatim.** Injection happens at the
    read exits only, so Studio's "what you customised" diff never shows a column
    nobody wrote. Only `effective` is injected.
  - **A `GET` → `PUT` round-trip still persists a byte-identical body** (#4326).
    The write path gained the strip counterpart: a field byte-identical to the
    platform's own definition is removed again on save, so a served document handed
    straight back stores exactly what it stored before — same checksum, same
    history diff. A declared `owner_id` carrying the author's own label is _not_
    the platform's definition and survives untouched.
  - **A declared system column stays the author's.** Injection only ever adds a
    column nobody declared; it never rewrites one that was.

  Which columns an object carries is `resolveInjectedSystemColumns`
  (`@objectstack/spec/data`, #5378) — the same derivation `applySystemFields`
  consumes — so every opt-out (`systemFields: false`, `managedBy: 'better-auth'`,
  `systemFields.audit`/`.tenant`, `tenancy.enabled: false`, the per-tier
  `ownership` table, the `sys_*` namespace) is answered in one place and re-derived
  in none. **What** each column looks like moves to `@objectstack/metadata-core`
  (`AUDIT_FIELD_DEFS` and the three tenancy/ownership anchors, re-exported from
  `@objectstack/objectql` so the symbols still resolve there) — the same relocation,
  for the same dependency cycle, as the audit-governance table in #4513:
  `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the read
  path could not import the definitions from the registry that provisions them.
  One table now feeds the injection pass and the read exits, so they cannot drift.

  One key is deliberately not carried onto a served document: `organization_id`'s
  `indexed`. It is not a `FieldSchema` key — removed in the 16.x line (#2377,
  ADR-0049) and rejected by name by the strict schema — and its only consumer is
  `driver-mongodb`'s schema builder, which reads the registered schema and never a
  served document. It stays at the injection site; that the registry-backed read
  answers `_diagnostics: { valid: false }` because of it is filed as #6810.

- a954634: feat(meta): object schemas served by `/meta` and `/metadata` are masked per caller (ADR-0106, #3682)

  The data plane has enforced field-level security everywhere it matters for
  several releases — list reads mask values, exports project columns, and the
  write path 403s forbidden fields. The **metadata** plane did not: any
  authenticated caller who asked `GET /meta/object/:name` received the full object
  schema, including fields they have no read access to at all.

  That is more than a list of names. A field carries its label, type, **picklist
  option values** (often a sensitive operational taxonomy), its **formula**
  expression (pricing and scoring IP), its `visibleWhen` predicate, its
  `defaultValue`, and — via ADR-0066 D3 — the `requiredPermissions` capability
  names guarding it. For a customer running a dealer, supplier or patient portal
  on ObjectStack, the only remediation available in their own tier was modelling
  discipline: keep sensitive fields off portal-visible objects, or split one
  business entity into an internal object and a portal object and synchronize
  them. This is a platform-side fix, so every deployment inherits it.

  **What changes.** Serving an object schema now projects `fields` onto the set
  the caller may read, and a field outside that set is removed **whole** — no
  name, no label, no options, no formula, no `requiredPermissions`. Partial
  redaction was rejected: keeping the name still leaks existence and invites
  clients to render ghost columns. Masking keys on the `readable` bit only; a
  readable-but-not-editable field stays in the schema, because the UI must render
  it and the `editable` affordance is already served per caller by
  `/auth/me/permissions`.

  Every outlet that serves an object schema goes through one shared projection,
  so coverage is not a per-route promise:

  - `GET /meta/object/:name` — the cached branch (the default) **and** the
    uncached branch, which is what `?state=draft`, `?preview=draft` and
    `?package=` take;
  - `GET /meta/object/:name?layers=true` — the layered diagnostic view, all three
    of `code` / `overlay` / `effective`;
  - `GET /meta/:type/:section/:name` — the compound-name read;
  - `GET /meta/object` — the list read, each item projected independently;
  - the runtime `/metadata` catch-all — the protocol-backed, registry-backed and
    last-ditch single reads, the `/metadata/objects` list (protocol and registry),
    and the legacy one-segment `/metadata/:objectName` spelling.

  **Caching is unchanged in cost and correct per cohort.** The shared metadata
  cache still stores one full schema per (type, name, locale, environment) — no
  caller dimension in the key — and the mask runs after retrieval. What varies
  per caller is the validator: a stable hash of the caller's _denied_ field set is
  folded into the ETag. A caller who can read everything denies nothing, so their
  fingerprint is empty and both their ETag and their response body are
  **byte-identical** to previous releases. Callers in one permission cohort share
  `304`s; a permission change moves the fingerprint and self-invalidates the stale
  `304`, so nothing needs purging after a permission-set edit.

  **Exemptions** are a property of the caller, not of the route: `isSystem` and
  platform-admin callers (holders of `studio.access` / `setup.access`, the same
  judgement the app filter uses) receive the full schema on any route, because
  Studio and Setup authoring cannot work against a projected schema.

  **Failure posture is explicit and three-tiered.** With no `security` service
  registered the schema is served unmasked — that deployment has no FLS posture at
  all and tightening only the metadata plane would be theater. When field
  visibility cannot be _determined_ (a registry-hydration window), the schema is
  served unmasked but loudly: a structured warning, a new
  `objectstack_meta_field_visibility_undetermined_total` counter, and a response
  downgraded to `Cache-Control: private, no-store` with no shared ETag. Failing
  closed there would brick every render of the object for every user and can
  deadlock console bootstrap, since permission sets are themselves metadata. When
  permission evaluation **throws**, the request fails with `503
FIELD_VISIBILITY_UNRESOLVED` — an unhealthy security service must not auto-open
  a disclosure hole, and an empty-fields `200` would be both a silently wrong UI
  and cacheable poison.

  **Guest and public deployments** get a deliberate posture rather than an
  accidental one: `@objectstack/plugin-security` gains
  `getMetadataReadableFields`, which resolves the configured fallback permission
  set (`security.fallbackPermissionSet`, default `member_default`) for a caller
  who resolves to zero sets, exactly as `/auth/me/permissions` does.
  `getReadableFields` is unchanged — on the data plane, mirroring the engine
  middleware's fall-open is what keeps it drift-free.

  **Escape hatch.** Masking is the platform default. A deployment that explicitly
  wants an unmasked metadata plane sets `OS_ALLOW_UNMASKED_OBJECT_METADATA=1`, or
  `metadata.maskObjectFields: false` on the REST server. Toggling it changes
  disclosure only: the console reads every field affordance from
  `/auth/me/permissions`, so UI correctness is unaffected either way.

  Operators fronting the runtime with a CDN or reverse proxy should read the new
  "CDN / reverse-proxy caching of `/meta` object schemas" section in the
  production-readiness guide before tuning anything — in particular, do not
  configure a proxy to ignore `Cache-Control: private`, and do not strip or
  rewrite `ETag` on these routes.

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- db0d53c: `resolveEngineDeleteDispatch` 末尾改真值测试:假值标量 `where.id` 不再答 `by-id`

  `engine-delete-dispatch.ts` 的自我描述是「what does `ObjectQLEngine.delete` do with this call」的**唯一**答案,其测试文件头把赌注写得很明白:一份漂移的共享判定比没有判定更糟——每个钉在它上面的假引擎都会自信地、一致地错,而门禁照样报绿。这条性质此前在**假值标量 id** 上不成立,实测(origin/main,记录型 driver 驱动真实引擎):

  | 调用                                 | 真实 `ObjectQL.delete` | 判定(修改前) |
  | :----------------------------------- | :--------------------- | :----------- |
  | `{ where: { id: 0 } }`               | `reject`               | `by-id`      |
  | `{ where: { id: '' } }`              | `reject`               | `by-id`      |
  | `{ where: { id: 0 }, multi: true }`  | `multi`                | `by-id`      |
  | `{ where: { id: '' }, multi: true }` | `multi`                | `by-id`      |

  原因是两侧问了不同的问题:判定读 `scalarDeleteId(...) !== undefined`,而 `engine.ts` 把判定结果落进 `id` 之后按 `if (hookContext.input.id)` 分支——**真值**测试,`0` / `''` 落到 multi/reject 阶梯。于是按 `assertEngineDeleteDispatch(options)` 钉死的替身会**接受** `delete(o, { where: { id: '' } })`,而真服务器抛 `Delete requires an ID or options.multi=true`:pinned 替身在这一个输入上仍比生产者宽松,正是本模块存在的理由(#4434 形状)。`id: ''`(路径段为空 / 表单字段未填直传 `where.id`)是可达形状,不是猎奇。

  本次改的是**判定,不是引擎**。`resolveEngineDeleteDispatch` 是对 `ObjectQL.delete` 的描述,错的是描述:`delete(o, { where: { id: 0 } })` 改动前抛错,改动后照样抛错,**生产者行为零变化**,`engine.ts` 一字未动。反向做法(让 `{ id: 0 }` 变成真的按 id 删)是改生产者行为,已作为 #5747 的 B 方案明确不取。

  同时给 `ENGINE_DELETE_DISPATCH_CASES` 补上 `{ id: 0 }` / `{ id: '' }` 的有/无 `multi` 四例——此前这套逐例对照**结构上够不到**这个输入(#4868 家族:一次逐例跑不可能反驳一个没人列出来的输入),这才是判定能悄悄漂移一年的原因。`scalarDeleteId` 保持值忠实(`{ where: { id: 0 } }` 仍返回 `0`),真值测试只加在判定这一层,与 update 侧孪生模块 `scalarUpdateId` 的分法一致。

- 72c3c86: refactor(spec)!: retire `indexes[].type` and `indexes[].partial` — two authorable index keys no driver ever read (#5248, #4943)

  `IndexSchema` declared five keys; only three of them ever reached a `CREATE
INDEX`. `SqlDriver.syncDeclaredIndexes` builds every declared index through
  knex's `table.index(fields, name)` / `table.unique(fields, { indexName })`, and
  the drift differ's `DeclaredIndexInput` carries `name` / `fields` / `unique` /
  `nullSafeColumns`. So:

  - **`partial`** — documented as _"Partial index condition (SQL WHERE clause)"_ —
    produced a **full** index with the predicate silently discarded. This was the
    damaging half, because it reads as a correctness control: the platform's own
    `sys_metadata` declared `partial: "state = 'active'"` for overlay uniqueness,
    and what the declaration alone materialized was an _unrestricted_ unique index.
  - **`type`** additionally carried `.default('btree')`, so it appeared in **every**
    parse output of **every** index — an access-method knob that had never
    influenced a single statement, rendered as live configuration. (It was pinned
    as such in a `sys_presence` test, on an object that never declared it.)

  Both are the ADR-0078 no-silently-inert / ADR-0049 enforce-or-remove shape.
  Remove was chosen over enforce: enforcing needs per-dialect algorithm mapping
  (`gin`/`gist` Postgres-only, `fulltext` MySQL-family), raw-SQL `CREATE INDEX …
WHERE` on the dialects that have partial indexes at all (MySQL does not), and a
  redesign of how `isSyncReproducibleIndex` excludes partial indexes from
  incremental sync — design cost for a capability with no demand. If a real need
  appears it returns enforce-first.

  ## Migration

  | FROM                                                      | TO                                                                                              |
  | :-------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
  | `indexes: [{ fields: […], type: 'gin' }]`                 | `indexes: [{ fields: […] }]` — create the specialised index from a database-layer migration     |
  | `indexes: [{ fields: […], partial: "state = 'active'" }]` | `indexes: [{ fields: […] }]` — issue `CREATE [UNIQUE] INDEX … WHERE …` from a runtime migration |

  **One-line fix: delete the key.** Neither removal changes any DDL, because no
  DDL ever depended on them — verified byte-for-byte against the `CREATE INDEX`
  statements SQLite actually stores
  (`packages/drivers/driver-sql/src/declared-index-retired-keys.test.ts`).

  Both capabilities remain available where they are implementable. The index
  method is the driver/dialect's choice. A partial index is issued as raw SQL from
  a runtime migration — exactly what `metadata-protocol`'s `ensureOverlayIndex`
  already does for `sys_metadata`, and what actually delivers that table's
  active-row-scoped uniqueness today.

  ⚠️ **Not affected:** driver-sql's own `partial` flag (`parseIndexDdl` /
  `introspectIndexes` / `isSyncReproducibleIndex`). That is a boolean parsed back
  out of the _database's own_ DDL for drift detection — the opposite direction —
  so migration-created partial indexes stay recognized and exempt from incremental
  sync, unchanged.

  ## The retirement kit

  - `retiredKey()` tombstones at `IndexSchema` (the shape is deliberately
    `.strip()`, so a plain delete would swap one silent no-op for another): writing
    either key is now a `tsc` error and a parse error carrying the prescription.
    They sit at the bottom of the shape per the #5606 renderer note.
  - **ADR-0087 D2 conversion + D3 chain step** (`object-index-type-partial-removed`,
    `toMajor: 17`, wired into the existing step-17 chain): strips both keys from
    `objects[]` and `objectExtensions[]`; `os migrate meta --from 16` rewrites sources
    mechanically. A pure lossless delete — there was no effect to lose.
  - **Producers flipped:** `sys_metadata` (`idx_sys_metadata_overlay_active`, the
    case #4943 named) and `sys_view_definition` (`idx_sys_view_def_active`), both
    with their comments corrected to say what is actually materialized.
  - Published skill (`objectstack-data`), `content/docs/data-modeling/objects.mdx`,
    liveness ledger note and generated baselines updated.

- 2d8dba3: Author-time warning for unprovisioned injected anchors on external objects (#8116). The injected-system-column definition tables and the #7865 provenance derivation (`platformProvisionsStorage`, `resolveInjectedColumnProvenance`, `unprovisionedInjectedColumns`, plus the newly exported identity predicate `isInjectedColumnDefinition`) moved from `@objectstack/metadata-core` into `@objectstack/spec/data`; `@objectstack/metadata-core` re-exports every previously-public name unchanged, so no downstream import changes. Built on the spec export, `@objectstack/lint` now warns when an expression, field conditional rule, formula, `stageField` or `highlightFields` entry references an injected system column (`owner_id`, `organization_id`, the audit family, `owning_business_unit_id`) on an ADR-0015 `external` object: the platform registers the anchor but provisions no storage behind it, so the reference silently degrades at query time (on SQLite: constant-false, HTTP 200, zero rows, no error). New advisory rule id `semantic-role-field-unprovisioned`; the expression finding is warning-severity and never fails the build. An author-declared column of the same name is treated as the author's real remote column and never warned.
- 7372d46: fix(metadata-protocol): keep every i18n bundle member through the `/meta` list merge (#7774)

  #7730 taught the `SchemaRegistry` that an `email_template`'s identity is
  `(name, locale)`, so `listItems('email_template')` returns every member of a
  declared i18n bundle. `GET /meta/<type>` then merges that listing with two
  higher layers, and both merges keyed by `(package, name)` with no
  discriminator — so the bundle survived registration only to collapse one layer
  later, and the list served a single locale.

  **Both merges now key on the pair.** `metaItemKey` takes an optional third
  component and `mergePackageAwareOverlay` buckets per slot rather than per name;
  both derive the value from the shared discriminator table, and both are
  byte-identical for a type that declares no discriminator — which is every type
  except `email_template` today.

  - **The MetadataService merge** is the path the issue named: with a `metadata`
    service installed and answering non-empty for the type, the second member's
    `Map.set` overwrote the first.
  - **The `sys_metadata` overlay merge** was predicted to need no change, on the
    ground that overlay rows are unique on `type+name+organization_id+package_id`
    and carry no locale column. That is true of the rows and beside the point:
    the base of that merge is the registry's bundle, so bucketing by bare name
    dropped a locale as soon as a single overlay row existed for the type — and
    the row that survived was the overlay body, whichever member it customizes.
    An overlay (or a draft preview) now lands on its own locale member and the
    rest of the bundle is served untouched. Across the env-wide and org tiers,
    rows that customize different members are likewise two slots instead of one;
    org-over-env precedence is unchanged within a member.

  **The discriminator table moved to `@objectstack/metadata-core`.**
  `ITEM_KEY_DISCRIMINATORS` was declared in `@objectstack/objectql`'s
  `registry.ts`, and `@objectstack/objectql` depends on
  `@objectstack/metadata-protocol`, so the protocol package could not import it
  without closing a dependency cycle. metadata-core is the package both already
  depend on and depends on neither — the same criterion that sank the engine
  write-verb dispatch predicates (#5619) and the audit-field governance table
  (#4513) there. **No public surface changes:** `registry.ts` re-exports
  `ITEM_KEY_DISCRIMINATORS` under its original name from its original module, so
  every existing import keeps working; `@objectstack/metadata-core` gains it plus
  `readDiscriminatorValue` / `itemDiscriminator` as additive exports. The
  registry's storage-key _format_ (`name@<locale>` composite keys and their
  parser) deliberately did not move — it encodes the registry's own Map keys,
  which no other package reads.

  For an app this is Studio's metadata list and `GET /meta/email_template`
  showing both the en-US and the zh-CN copy of a template instead of whichever
  one the merge happened to keep.

- 1a53a02: fix(meta): `/meta` object reads stop reporting `readonly: false` on fields the write path refuses (#4513)

  `#4447` made the audit-provenance family (`created_at`, `created_by`,
  `updated_at`, `updated_by`) engine-owned on the **write** path: the registry's
  `applySystemFields` forces `{ readonly: true, system: true }` over a _declared_
  audit field, and `ObjectQL.update` strips a non-system caller's write to it.

  The **read** path never learned it. A `/meta` object read resolves through
  `sys_metadata` overlay → MetadataService → SchemaRegistry, and only the last of
  those three has been through `applySystemFields` — so an object whose built
  artifact ships a materialized `created_at` carrying FieldSchema defaults
  (`readonly: false`) reported that value to every client while writes to that
  same field were being refused. Measured before the fix, all of the read exits
  agreed with each other and disagreed with the engine:

  ```
  single  read: {"type":"datetime","label":"Created At","readonly":false}
  list    read: {"type":"datetime","label":"Created At","readonly":false}
  cached  read: {"type":"datetime","label":"Created At","readonly":false}
  layered read: {"type":"datetime","label":"Created At","readonly":false}
  ```

  One field, two answers — and the machine-readable one, the only face a client
  or an AI author writing code off `/meta` can see, was the wrong one.

  **What changes.** Every `/meta` object read exit now reports the audit family
  the way the engine enforces it. That covers the single-item read (both the
  singular and plural type spelling), the list read, the cached/ETag branch, the
  `?preview=draft` and `?state=draft` reads, and the layered read's `effective`
  layer. `GET` bodies for objects that declare an audit field will show
  `readonly: true, system: true` where they previously showed `readonly: false`
  or omitted the keys; nothing else about the document changes, and the ETag for
  such an object changes once.

  **What deliberately does not change.**

  - The layered read's `code` and `overlay` layers stay raw — showing the
    package's declaration beside the governed `effective` value is the
    diagnostic's whole point.
  - `sys_metadata` still stores exactly what the author saved; the correction is
    applied on the way out, so no phantom customization appears in the diff.
  - An object that opts out of the audit family (`systemFields: false`,
    `systemFields.audit: false`, `managedBy: 'better-auth'`) is untouched — the
    engine enforces nothing there, so a read that claimed otherwise would be the
    same lie pointing the other way.
  - Only `readonly` and `system` are forced. Every other key an author writes —
    `label`, `description`, `hidden`, `group`, and `type` for an external object
    mapping a differently-typed remote column — stays theirs.

  The governance table moved from `packages/objectql/src/registry.ts` to
  `@objectstack/metadata-core` (`AUDIT_FIELD_GOVERNANCE`, plus the
  `applyAuditFieldGovernance` normalizer the read path applies), by the same
  criterion and for the same cycle as the `#5619` engine-dispatch predicates:
  `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the
  read path cannot import the table from the registry that enforces it, and a
  second copy would agree only until someone edited one side. `objectql`
  re-exports the symbol from its original path, so its public API is unchanged.

- fda61e4: fix(metadata-protocol): `publishPackageDrafts` now writes the audit rows a batch publish always owed

  Studio's "publish whole app" (`POST /packages/:id/publish-drafts`) promoted every
  draft in a package and wrote **no `sys_metadata_audit` rows at all** — neither the
  allowed-outcome `publish` rows nor a `denied` row for a refusal. The route calls
  `promoteDraftForPublish` directly rather than `publishMetaItem`, so the row added
  for the single-item routes never ran for it: a batch that published twenty
  artifacts left the compliance trail exactly as empty as a batch nobody ran.

  Both outcomes are now recorded, and **where** they are recorded is the fix:

  - **allowed** — one `publish` / `allowed` row per promoted item, written in Phase 2
    off `promoted[]`, with `source: 'protocol.publishPackageDrafts'` so the trail
    distinguishes "publish whole app" from a single-item publish. The row is keyed on
    the scope the draft was promoted in, not the request's active org, because
    env-wide drafts are promoted env-wide.
  - **denied** — one `publish` / `denied` row with `code: 'batch_aborted'` when the
    batch rolls back, written from the rollback handler, **outside** the
    `engine.transaction()`. Written inside it, the refusal's own row would roll back
    with the batch it records — leaving nothing behind about a refused publish, which
    is the defect the single-item audit rows exist to close.

  The causal reason rides in `note`, which is served by `GET /api/v1/meta/:type/:name/audit`
  and therefore carries the client-facing text rather than raw driver output.

- db48ad5: fix(security,approvals,metadata-core): restore batch routes on the eight objects the #3391 P1 companion fix missed (#3026)

  The #3391 P1 contract made the bulk gate `bulk ∧ derived(child)`: a batch
  request is admitted only when the object grants the `bulk` **primitive** and the
  batched child operation is itself allowed. Before that, the `*Many` routes
  checked only the child verb, so a boilerplate CRUD-five whitelist
  (`['get','list','create','update','delete']`) batched fine.

  The companion fix — adding the `bulk` primitive wherever an explicit whitelist
  survived — was applied only inside `platform-objects`. Eight objects carrying
  the same boilerplate live in other packages and kept the gap, so `/batch`,
  `createMany`, `updateMany` and `deleteMany` answered `405
OBJECT_API_METHOD_NOT_ALLOWED` on objects whose single-record create/update/
  delete were wide open. `data-objectstack` rethrows that 405 without falling back
  to per-row writes, which surfaced as a hard error on multi-select delete in the
  Setup grids.

  Objects reclaimed (whitelist now `['get','list','create','update','delete','bulk']`):
  `sys_capability`, `sys_permission_set`, `sys_position`,
  `sys_position_permission_set`, `sys_user_permission_set`, `sys_user_position`
  (plugin-security); `sys_approval_delegation` (plugin-approvals);
  `sys_view_definition` (metadata-core).

  No new authority is granted: `bulk` only permits batching verbs each object
  already exposes one record at a time, and every batched row still passes the
  same row- and field-level permission checks. The whitelists stay explicit rather
  than being deleted — seven of the eight are `managedBy`, and
  `reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
  `apiMethods`, so dropping the line would silently disable the managed-write
  backstop.

- 51a587d: 两个写动词的派发判定下沉到 `@objectstack/metadata-core` —— 公共 API 零变化,一次关闭 26 条 engine-double 基线条目

  `ObjectQL.delete` / `ObjectQL.update` 的三分支派发判定(`engine-delete-dispatch.ts` #4550、
  `engine-update-dispatch.ts` #5480)从 `packages/objectql/src/` **原样搬到**
  `packages/metadata-core/src/`。这是一次搬移,不是重构:两个模块本来就零 import、纯自包含,
  判定逻辑一个字未改。

  **为什么搬。** `@objectstack/objectql` 的 `dependencies` 含 `@objectstack/metadata-protocol`,
  所以那个包里 13 个假引擎结构性地无法 import 这两个谓词 —— 反向 devDependency 即成环,
  turbo 2.10.7 直接拒绝任务图。判据来自门禁台账里
  `packages/spec/src/contracts/data-engine.test.ts` 那条 EXEMPT:反向 import 不可行时,唯一
  出路是下沉到**两边都已依赖**的包。`@objectstack/metadata-core` 正是这个包
  (`objectql -> metadata-core` 与 `metadata-protocol -> metadata-core` 都是既有边),而它自己
  的 `dependencies` 只有 `{ @objectstack/spec, zod }`,不含 objectql,故不引入新环。

  **公共 API 与既有调用点零变化。** `packages/objectql/src/engine-delete-dispatch.ts` /
  `engine-update-dispatch.ts` 保留在原路径,改为 re-export shim,因此
  `@objectstack/objectql` 仍然导出
  `resolveEngineDeleteDispatch` / `assertEngineDeleteDispatch` / `scalarDeleteId` /
  `ENGINE_DELETE_REJECT_MESSAGE` / `ENGINE_DELETE_DISPATCH_CASES` 及 update 侧的五个同名对应物
  (与全部类型),`engine.ts` 与 37 个既有 pinned 调用点一行未动。同一批符号现在也从
  `@objectstack/metadata-core` 导出。

  搭配的门禁改动:`scripts/check-engine-double-contract.mjs` 的两个 slice 现在同时接受
  `@objectstack/metadata-core` 与 `@objectstack/objectql` 两种拼写(它们指向同一个函数),
  失败提示也改为在「objectql 依赖该包」时优先建议 metadata-core。

- c073b8c: refactor(metadata-core): drop `sys_view_definition`'s all-six `apiMethods` whitelist (#3026)

  #3745 completed this object's boilerplate CRUD-five whitelist to all six
  primitives so its batch routes stopped 405-ing. A whitelist naming all six is
  equivalent to no whitelist — except it stops tracking primitives the enum grows
  later — so the #3543 audit rule applies and the declaration is removed.

  No behaviour change: `undefined` resolves to `unrestricted`, whose effective
  operation set is identical to `restricted` holding all six.

  Removing it is safe HERE specifically because the object has no `managedBy`:
  `reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
  `apiMethods`, so for a managed object an absent whitelist would take the
  managed-write backstop with it. That is why the RBAC objects reclaimed by #3745
  keep their explicit arrays and this one does not.

- 946a131: fix(metadata-core,objectql): `ObjectQL.update` 的 `data.id` 同过标量测试,不再把载荷里的算子对象当主键 (#5748)

  `ObjectQL.update(object, data, options)` 用两处取主键,而这两处此前用的是**两套规则**:

  - `options.where.id` 走**标量测试** —— `{ id: { $in: [...] } }` / `{ id: [...] }` /
    `{ id: null }` 是多行谓词,不算 id(#4434 / #4550);
  - `data.id` **不做任何测试**,只要为真就原样当主键,并且先于 `where`、也先于
    `options.multi`。

  于是同一个算子对象,写在 `where.id` 里被正确识别为谓词,写在 `data.id` 里却被
  当成主键绑进 `driver.update(object, id, …)` 的主键位置,**显式声明的
  `multi: true` 被无声忽略**。后果不是数据被覆盖,而是静默失灵或难读的驱动错误:
  SQLite 侧报参数绑定错误,别的驱动可能只匹配零行 —— 两种都不会告诉调用方
  「你的 `multi` 被忽略了」。这是 declared ≠ enforced 的一种,#5393 刚给 flow 的
  `update_record` 补上的 `multi` 批量意图键正是被这条更早的规则盖掉的。

  现在 `data.id` 与 `where.id` **共用同一个标量测试**(判定在
  `packages/metadata-core/src/engine-update-dispatch.ts` 定义一次,`engine.ts` 与
  全部 fake engine 经 `resolveEngineUpdateDispatch` /
  `assertEngineUpdateDispatch` 复用同一份)。非标量 `data.id` 不算 id,因此不再
  盖住任何东西:判定按 `where.id` → `multi` → `reject` 的原有阶梯继续往下走。

  **行为矩阵(FROM → TO)。标量 `data.id` 的按 id 写法完全不受影响。**

  | 调用                                                                | FROM                       | TO                                                                |
  | :------------------------------------------------------------------ | :------------------------- | :---------------------------------------------------------------- |
  | `update(o, { id: 'rec_1', …f })`                                    | by-id `'rec_1'`            | **不变**                                                          |
  | `update(o, { id: 'rec_1', …f }, { multi: true })`                   | by-id `'rec_1'`            | **不变**(标量 `data.id` 仍先于 `multi`)                           |
  | `update(o, { id: 'rec_1', …f }, { where: { id: 'rec_2' } })`        | by-id `'rec_1'`            | **不变**(标量 `data.id` 仍先于 `where`)                           |
  | `update(o, { id: 0, …f }, { multi: true })`                         | multi                      | **不变**(真值判定,`0` 不标识行)                                   |
  | `update(o, { id: { $in: [...] }, …f }, { multi: true })`            | by-id,算子对象被绑进主键位 | **multi** —— 声明的批量意图被执行                                 |
  | `update(o, { id: ['a','b'], …f }, { multi: true })`                 | by-id,数组被绑进主键位     | **multi**                                                         |
  | `update(o, { id: { $in: [...] }, …f })`(**无** `multi`)             | by-id,算子对象被绑进主键位 | **reject**,消息不变:`Update requires an ID or options.multi=true` |
  | `update(o, { id: { $in: [...] }, …f }, { multi: false })`           | 同上                       | **reject**                                                        |
  | `update(o, { id: { $in: [...] }, …f }, { where: { id: 'rec_1' } })` | by-id,绑的是**算子对象**   | by-id,绑的是 **`'rec_1'`**                                        |

  最后一格是这次修复里唯一「判定不变、绑定值变了」的一格 —— 前后都是 `by-id`,
  变的是哪一个 id 源胜出。`ENGINE_UPDATE_DISPATCH_CASES` 因此新增可选的
  `expectId`,把落进主键位的值本身也钉住,避免用例因为「什么都没产出」而绿。

  **「无 `multi` 的非标量 `data.id`」被明确定成响亮拒绝**,不会静默升级成一次真的
  批量写 —— 这是裁决(维护者 2026-08-06)对方案 B 那条顾虑的处置:把算子对象写进
  载荷大概率是写错了位置,那就报错,而不是替作者决定他想批量写。

  无 API 变更:导出符号、类型与 `ENGINE_UPDATE_REJECT_MESSAGE` 的文案均不变。

- 3d4c545: fix(metadata): `sys_view_definition` 的「活跃行唯一」真正生效——归档视图不再占用 (name, organization_id, owner) 名额

  `sys_view_definition` 的 `idx_sys_view_def_active` 索引注释一直承诺「among active rows」，但这个语义从未在任何一层交付：声明面的 `partial: "state = 'active'"` 没有任何 driver 消费者（`syncDeclaredIndexes` 走 knex 的 `table.unique()`，无法表达 `WHERE`），该键已随 #5248 / #4943 退役；而与 `sys_metadata` 不同，这张表背后**没有**任何等价的运行时迁移。结果是建出来的一直是无谓词的全量 UNIQUE 索引——用户归档（或软删、重置）一个视图后，**无法再新建同名视图**，被一条自己刚扔掉的记录挡住。

  现在补上运行时迁移 `ensureViewDefinitionActiveIndex`（照 `metadata-protocol` 既有的 `ensureOverlayIndex` 范式），在 `kernel:ready` 用 raw SQL 发 `CREATE UNIQUE INDEX idx_sys_view_def_active … WHERE state = 'active'`：

  - **名额可回收**——归档视图不再占用名额，同名视图可以重建；
  - **唯一性不放宽**——两条 `state='active'` 的同名同域行仍然被拒；
  - **复用声明的索引名**——`syncDeclaredIndexes` 按名跳过，后续每次启动都不会把全量 UNIQUE 索引重新加回来；
  - **降级只会退回今天的行为，不会更低**——迁移先用一个临时探针索引验证当前方言与数据确实能建出部分索引，成功后才替换既有索引。因此 MySQL / MariaDB（无部分索引）上原有的全量 UNIQUE 索引原样保留（归档行在该方言上仍占名额，以 `info` 记录），不会出现「旧索引已删、新索引没建成」的无约束窗口。

  `metadata-core` 侧只更新了 `sys-view-definition.object.ts` 的注释：该声明现在被明确记为**降级形态**（供无部分索引的方言与不跑该迁移的宿主使用），不应删除。

  已知未涵盖：`owner` 为 NULL 的共享视图与 `organization_id` 为 NULL 的环境级视图，因 SQL UNIQUE 的 NULL-distinct 语义本来就不受该索引约束。这是早于本次修复的既有缺口，本迁移只改变**行范围**（`WHERE state = 'active'`）而不动键的拼写——这也正是它严格弱于被替换的索引、因而不可能在存量数据上建失败的原因。该缺口已另单记录。

- bb7cb41: fix(metadata): two same-name active SHARED views can no longer coexist — `sys_view_definition`'s active-row index gets a NULL-safe key (#6417)

  #5839 / PR #6415 delivered "unique among ACTIVE rows" for `sys_view_definition`
  as a runtime partial UNIQUE index, and deliberately changed only the index's
  **row scope** — that is what made it strictly weaker than the index it replaced
  and therefore incapable of failing on existing data. It also left the other
  half of the same index broken, and pinned that gap honestly rather than closing
  it.

  SQL UNIQUE treats NULLs as mutually **distinct**. `owner` is NULL for SHARED
  views and `organization_id` is NULL for environment-level ones, so
  `(name, organization_id, owner)` constrained **personal views only**. Measured
  on real SQLite over the driver's own DDL:

  ```text
  two ACTIVE personal views, same (name, org, owner) : REJECTED
  two ACTIVE shared views    (owner NULL)            : OK   ← unconstrained
  two ACTIVE env-level views (organization_id NULL)  : OK   ← unconstrained
  ```

  Two same-name shared views inside one tenant were therefore reachable, while
  `name` is declared as the globally unique qualified view id (`object.viewKey`)
  — so the view switcher, which aggregates and de-duplicates by `name`, and every
  read path that locates a view by name, had no defined answer about which row
  they got.

  **What changes.** Per the maintainer ruling of 2026-08-08 this is now forbidden.
  The same runtime migration materializes the key NULL-safe, folding each nullable
  part's NULLs into one bucket that is unique among itself:

  ```sql
  CREATE UNIQUE INDEX idx_sys_view_def_active ON sys_view_definition
    (name, COALESCE(organization_id, '__global__'), COALESCE(owner, ''))
    WHERE state = 'active'
  ```

  Both spellings are copied from an existing in-repo precedent rather than
  invented: `'__global__'` is ADR-0120 D3's reserved sentinel for the tenant
  column (the driver's `GLOBAL_TENANT`), and `COALESCE(owner, '')` is
  `ensureOverlayIndex`'s `COALESCE(package_id, '')` form for a non-tenant nullable
  discriminator. Neither can collide with real data — an organization id may never
  equal `'__global__'`, and an owner is a user id, never the empty string.
  **Storage is untouched**: rows keep their NULLs, only the index folds them, so
  `WHERE owner = ''` still matches nothing.

  Unchanged: archived rows stay exempt (#5839's active-only scoping survives, on
  shared views too), a shared view and a personal view may still share a name, and
  so may two tenants' or two environments' rows.

  **This is a tightening, so it can fail to build.** Unlike #5839, rows that
  violate the new key exist in the wild today, precisely because nothing rejected
  them. The migration probes before it replaces anything, and on a conflict takes
  ADR-0120 D4's disposition: the previous index is left in place (the table is
  never left unconstrained), the report names the key that is not enforced, ships
  the exact `GROUP BY … HAVING COUNT(*) > 1` query that lists the offending rows,
  points at `os migrate plan` — and the boot continues. Resolve the duplicate
  active shared views, restart, and the tightening applies itself.

  Dialects with no partial indexes (MySQL/MariaDB) keep the declared bare
  composite, which is ADR-0120 D3's own degradation. That report is **raised from
  `info` to `error`**: under #5839 alone the dialect lost slot recycling, a
  functional degradation the next user hits immediately, but it now loses an
  integrity guarantee the platform states it enforces while continuing to look
  healthy — AGENTS.md's durability arm. The line names both gaps that stay open
  there and the duplicate-listing query. The unclassifiable-failure arm is raised
  with it, so the failure nobody can name is never reported more quietly than the
  one that has a name.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [ac37fc6]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [881a3cc]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [d127ff0]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [97b6658]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [89d7b35]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [60b672e]
- Updated dependencies [6b441a8]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [f8cfbb4]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0

## 17.0.0-rc.6

### Minor Changes

- 121852d: Metadata-plane FLS: the ADR-0106 D4 read exemption is now **derived** from the #6603 write-capability gate, so "whoever can write a schema can see all of it" is enforced by construction (#7020).

  The two sets used to be maintained separately and were in fact different: the write gate demands `manage_metadata`, while the D4 exemption listed `studio.access` / `setup.access`. They met only on the shipped `admin_full_access` set, which carries all three — so the invariant #6603's ruling stated held by coincidence, not by construction. A caller holding `manage_metadata` alone passed every metadata write gate and still read a **masked** object schema, and its GET, edit and PUT round trip then deleted the fields it was never shown.

  `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES` is now the union of two named halves — `OBJECT_SCHEMA_WRITE_CAPABILITIES` (the write gate's key, spelled once) and `OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES` (`studio.access` / `setup.access`) — both newly exported from `@objectstack/metadata-core`.

  **Behaviour change:** a caller holding `manage_metadata` now reads object schemas unmasked on every schema-serving exit. This widens read access for that cohort and is the ruled intent (maintainer, 2026-08-10). The derivation is one-directional: no principal loses read access, and the `/packages` read cohort (#7033 / #7023) keeps its own separately-ruled set.

- 5e247fd: fix(metadata-protocol): a `/meta` object read serves the effective runtime schema, whichever layer answered (#6562)

  `GET /api/v1/meta/object/:name` answered a **different set of fields** depending
  on which link of its resolution chain produced the answer, for the same object:

  - **registry-backed** → the schema AFTER `applySystemFields`, so it carried the
    injected system columns — `created_at`, `created_by`, `updated_at`,
    `updated_by`, `organization_id`, `owner_id`, `owning_business_unit_id` — even
    when the author declared none of them;
  - **overlay-backed** (a `sys_metadata` customization row, or a MetadataService
    body) → the stored document VERBATIM, so every one of those columns was simply
    absent.

  Whether an object carries an overlay is invisible to the caller, so the same
  request reported the platform's own columns or not, and nothing in the response
  said which had happened. `/meta` is the machine-readable contract clients and AI
  authors code against: an author reading an overlay-backed object saw no
  `created_at` / `owner_id` / `organization_id` and reasonably concluded the
  columns do not exist — while every one of them is real in the database,
  filterable, orderable, and enforced read-only on write.

  **Every `/meta` object read exit now serves the effective schema.** The
  single-item read, the list, the cached/ETag branch, both draft reads and the
  layered read's `effective` layer all report the injected columns, with the same
  `readonly` / `system` markers the engine enforces (`owner_id` stays
  `readonly: false` — ownership is transferable). This is the presence half of the
  seam #4513 closed the value half of.

  Three things deliberately did **not** change:

  - **`?layers=1`'s `overlay` layer stays byte-verbatim.** Injection happens at the
    read exits only, so Studio's "what you customised" diff never shows a column
    nobody wrote. Only `effective` is injected.
  - **A `GET` → `PUT` round-trip still persists a byte-identical body** (#4326).
    The write path gained the strip counterpart: a field byte-identical to the
    platform's own definition is removed again on save, so a served document handed
    straight back stores exactly what it stored before — same checksum, same
    history diff. A declared `owner_id` carrying the author's own label is _not_
    the platform's definition and survives untouched.
  - **A declared system column stays the author's.** Injection only ever adds a
    column nobody declared; it never rewrites one that was.

  Which columns an object carries is `resolveInjectedSystemColumns`
  (`@objectstack/spec/data`, #5378) — the same derivation `applySystemFields`
  consumes — so every opt-out (`systemFields: false`, `managedBy: 'better-auth'`,
  `systemFields.audit`/`.tenant`, `tenancy.enabled: false`, the per-tier
  `ownership` table, the `sys_*` namespace) is answered in one place and re-derived
  in none. **What** each column looks like moves to `@objectstack/metadata-core`
  (`AUDIT_FIELD_DEFS` and the three tenancy/ownership anchors, re-exported from
  `@objectstack/objectql` so the symbols still resolve there) — the same relocation,
  for the same dependency cycle, as the audit-governance table in #4513:
  `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the read
  path could not import the definitions from the registry that provisions them.
  One table now feeds the injection pass and the read exits, so they cannot drift.

  One key is deliberately not carried onto a served document: `organization_id`'s
  `indexed`. It is not a `FieldSchema` key — removed in the 16.x line (#2377,
  ADR-0049) and rejected by name by the strict schema — and its only consumer is
  `driver-mongodb`'s schema builder, which reads the registered schema and never a
  served document. It stays at the injection site; that the registry-backed read
  answers `_diagnostics: { valid: false }` because of it is filed as #6810.

- a954634: feat(meta): object schemas served by `/meta` and `/metadata` are masked per caller (ADR-0106, #3682)

  The data plane has enforced field-level security everywhere it matters for
  several releases — list reads mask values, exports project columns, and the
  write path 403s forbidden fields. The **metadata** plane did not: any
  authenticated caller who asked `GET /meta/object/:name` received the full object
  schema, including fields they have no read access to at all.

  That is more than a list of names. A field carries its label, type, **picklist
  option values** (often a sensitive operational taxonomy), its **formula**
  expression (pricing and scoring IP), its `visibleWhen` predicate, its
  `defaultValue`, and — via ADR-0066 D3 — the `requiredPermissions` capability
  names guarding it. For a customer running a dealer, supplier or patient portal
  on ObjectStack, the only remediation available in their own tier was modelling
  discipline: keep sensitive fields off portal-visible objects, or split one
  business entity into an internal object and a portal object and synchronize
  them. This is a platform-side fix, so every deployment inherits it.

  **What changes.** Serving an object schema now projects `fields` onto the set
  the caller may read, and a field outside that set is removed **whole** — no
  name, no label, no options, no formula, no `requiredPermissions`. Partial
  redaction was rejected: keeping the name still leaks existence and invites
  clients to render ghost columns. Masking keys on the `readable` bit only; a
  readable-but-not-editable field stays in the schema, because the UI must render
  it and the `editable` affordance is already served per caller by
  `/auth/me/permissions`.

  Every outlet that serves an object schema goes through one shared projection,
  so coverage is not a per-route promise:

  - `GET /meta/object/:name` — the cached branch (the default) **and** the
    uncached branch, which is what `?state=draft`, `?preview=draft` and
    `?package=` take;
  - `GET /meta/object/:name?layers=true` — the layered diagnostic view, all three
    of `code` / `overlay` / `effective`;
  - `GET /meta/:type/:section/:name` — the compound-name read;
  - `GET /meta/object` — the list read, each item projected independently;
  - the runtime `/metadata` catch-all — the protocol-backed, registry-backed and
    last-ditch single reads, the `/metadata/objects` list (protocol and registry),
    and the legacy one-segment `/metadata/:objectName` spelling.

  **Caching is unchanged in cost and correct per cohort.** The shared metadata
  cache still stores one full schema per (type, name, locale, environment) — no
  caller dimension in the key — and the mask runs after retrieval. What varies
  per caller is the validator: a stable hash of the caller's _denied_ field set is
  folded into the ETag. A caller who can read everything denies nothing, so their
  fingerprint is empty and both their ETag and their response body are
  **byte-identical** to previous releases. Callers in one permission cohort share
  `304`s; a permission change moves the fingerprint and self-invalidates the stale
  `304`, so nothing needs purging after a permission-set edit.

  **Exemptions** are a property of the caller, not of the route: `isSystem` and
  platform-admin callers (holders of `studio.access` / `setup.access`, the same
  judgement the app filter uses) receive the full schema on any route, because
  Studio and Setup authoring cannot work against a projected schema.

  **Failure posture is explicit and three-tiered.** With no `security` service
  registered the schema is served unmasked — that deployment has no FLS posture at
  all and tightening only the metadata plane would be theater. When field
  visibility cannot be _determined_ (a registry-hydration window), the schema is
  served unmasked but loudly: a structured warning, a new
  `objectstack_meta_field_visibility_undetermined_total` counter, and a response
  downgraded to `Cache-Control: private, no-store` with no shared ETag. Failing
  closed there would brick every render of the object for every user and can
  deadlock console bootstrap, since permission sets are themselves metadata. When
  permission evaluation **throws**, the request fails with `503
FIELD_VISIBILITY_UNRESOLVED` — an unhealthy security service must not auto-open
  a disclosure hole, and an empty-fields `200` would be both a silently wrong UI
  and cacheable poison.

  **Guest and public deployments** get a deliberate posture rather than an
  accidental one: `@objectstack/plugin-security` gains
  `getMetadataReadableFields`, which resolves the configured fallback permission
  set (`security.fallbackPermissionSet`, default `member_default`) for a caller
  who resolves to zero sets, exactly as `/auth/me/permissions` does.
  `getReadableFields` is unchanged — on the data plane, mirroring the engine
  middleware's fall-open is what keeps it drift-free.

  **Escape hatch.** Masking is the platform default. A deployment that explicitly
  wants an unmasked metadata plane sets `OS_ALLOW_UNMASKED_OBJECT_METADATA=1`, or
  `metadata.maskObjectFields: false` on the REST server. Toggling it changes
  disclosure only: the console reads every field affordance from
  `/auth/me/permissions`, so UI correctness is unaffected either way.

  Operators fronting the runtime with a CDN or reverse proxy should read the new
  "CDN / reverse-proxy caching of `/meta` object schemas" section in the
  production-readiness guide before tuning anything — in particular, do not
  configure a proxy to ignore `Cache-Control: private`, and do not strip or
  rewrite `ETag` on these routes.

### Patch Changes

- 1a53a02: fix(meta): `/meta` object reads stop reporting `readonly: false` on fields the write path refuses (#4513)

  `#4447` made the audit-provenance family (`created_at`, `created_by`,
  `updated_at`, `updated_by`) engine-owned on the **write** path: the registry's
  `applySystemFields` forces `{ readonly: true, system: true }` over a _declared_
  audit field, and `ObjectQL.update` strips a non-system caller's write to it.

  The **read** path never learned it. A `/meta` object read resolves through
  `sys_metadata` overlay → MetadataService → SchemaRegistry, and only the last of
  those three has been through `applySystemFields` — so an object whose built
  artifact ships a materialized `created_at` carrying FieldSchema defaults
  (`readonly: false`) reported that value to every client while writes to that
  same field were being refused. Measured before the fix, all of the read exits
  agreed with each other and disagreed with the engine:

  ```
  single  read: {"type":"datetime","label":"Created At","readonly":false}
  list    read: {"type":"datetime","label":"Created At","readonly":false}
  cached  read: {"type":"datetime","label":"Created At","readonly":false}
  layered read: {"type":"datetime","label":"Created At","readonly":false}
  ```

  One field, two answers — and the machine-readable one, the only face a client
  or an AI author writing code off `/meta` can see, was the wrong one.

  **What changes.** Every `/meta` object read exit now reports the audit family
  the way the engine enforces it. That covers the single-item read (both the
  singular and plural type spelling), the list read, the cached/ETag branch, the
  `?preview=draft` and `?state=draft` reads, and the layered read's `effective`
  layer. `GET` bodies for objects that declare an audit field will show
  `readonly: true, system: true` where they previously showed `readonly: false`
  or omitted the keys; nothing else about the document changes, and the ETag for
  such an object changes once.

  **What deliberately does not change.**

  - The layered read's `code` and `overlay` layers stay raw — showing the
    package's declaration beside the governed `effective` value is the
    diagnostic's whole point.
  - `sys_metadata` still stores exactly what the author saved; the correction is
    applied on the way out, so no phantom customization appears in the diff.
  - An object that opts out of the audit family (`systemFields: false`,
    `systemFields.audit: false`, `managedBy: 'better-auth'`) is untouched — the
    engine enforces nothing there, so a read that claimed otherwise would be the
    same lie pointing the other way.
  - Only `readonly` and `system` are forced. Every other key an author writes —
    `label`, `description`, `hidden`, `group`, and `type` for an external object
    mapping a differently-typed remote column — stays theirs.

  The governance table moved from `packages/objectql/src/registry.ts` to
  `@objectstack/metadata-core` (`AUDIT_FIELD_GOVERNANCE`, plus the
  `applyAuditFieldGovernance` normalizer the read path applies), by the same
  criterion and for the same cycle as the `#5619` engine-dispatch predicates:
  `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the
  read path cannot import the table from the registry that enforces it, and a
  second copy would agree only until someone edited one side. `objectql`
  re-exports the symbol from its original path, so its public API is unchanged.

- 3d4c545: fix(metadata): `sys_view_definition` 的「活跃行唯一」真正生效——归档视图不再占用 (name, organization_id, owner) 名额

  `sys_view_definition` 的 `idx_sys_view_def_active` 索引注释一直承诺「among active rows」，但这个语义从未在任何一层交付：声明面的 `partial: "state = 'active'"` 没有任何 driver 消费者（`syncDeclaredIndexes` 走 knex 的 `table.unique()`，无法表达 `WHERE`），该键已随 #5248 / #4943 退役；而与 `sys_metadata` 不同，这张表背后**没有**任何等价的运行时迁移。结果是建出来的一直是无谓词的全量 UNIQUE 索引——用户归档（或软删、重置）一个视图后，**无法再新建同名视图**，被一条自己刚扔掉的记录挡住。

  现在补上运行时迁移 `ensureViewDefinitionActiveIndex`（照 `metadata-protocol` 既有的 `ensureOverlayIndex` 范式），在 `kernel:ready` 用 raw SQL 发 `CREATE UNIQUE INDEX idx_sys_view_def_active … WHERE state = 'active'`：

  - **名额可回收**——归档视图不再占用名额，同名视图可以重建；
  - **唯一性不放宽**——两条 `state='active'` 的同名同域行仍然被拒；
  - **复用声明的索引名**——`syncDeclaredIndexes` 按名跳过，后续每次启动都不会把全量 UNIQUE 索引重新加回来；
  - **降级只会退回今天的行为，不会更低**——迁移先用一个临时探针索引验证当前方言与数据确实能建出部分索引，成功后才替换既有索引。因此 MySQL / MariaDB（无部分索引）上原有的全量 UNIQUE 索引原样保留（归档行在该方言上仍占名额，以 `info` 记录），不会出现「旧索引已删、新索引没建成」的无约束窗口。

  `metadata-core` 侧只更新了 `sys-view-definition.object.ts` 的注释：该声明现在被明确记为**降级形态**（供无部分索引的方言与不跑该迁移的宿主使用），不应删除。

  已知未涵盖：`owner` 为 NULL 的共享视图与 `organization_id` 为 NULL 的环境级视图，因 SQL UNIQUE 的 NULL-distinct 语义本来就不受该索引约束。这是早于本次修复的既有缺口，本迁移只改变**行范围**（`WHERE state = 'active'`）而不动键的拼写——这也正是它严格弱于被替换的索引、因而不可能在存量数据上建失败的原因。该缺口已另单记录。

- bb7cb41: fix(metadata): two same-name active SHARED views can no longer coexist — `sys_view_definition`'s active-row index gets a NULL-safe key (#6417)

  #5839 / PR #6415 delivered "unique among ACTIVE rows" for `sys_view_definition`
  as a runtime partial UNIQUE index, and deliberately changed only the index's
  **row scope** — that is what made it strictly weaker than the index it replaced
  and therefore incapable of failing on existing data. It also left the other
  half of the same index broken, and pinned that gap honestly rather than closing
  it.

  SQL UNIQUE treats NULLs as mutually **distinct**. `owner` is NULL for SHARED
  views and `organization_id` is NULL for environment-level ones, so
  `(name, organization_id, owner)` constrained **personal views only**. Measured
  on real SQLite over the driver's own DDL:

  ```text
  two ACTIVE personal views, same (name, org, owner) : REJECTED
  two ACTIVE shared views    (owner NULL)            : OK   ← unconstrained
  two ACTIVE env-level views (organization_id NULL)  : OK   ← unconstrained
  ```

  Two same-name shared views inside one tenant were therefore reachable, while
  `name` is declared as the globally unique qualified view id (`object.viewKey`)
  — so the view switcher, which aggregates and de-duplicates by `name`, and every
  read path that locates a view by name, had no defined answer about which row
  they got.

  **What changes.** Per the maintainer ruling of 2026-08-08 this is now forbidden.
  The same runtime migration materializes the key NULL-safe, folding each nullable
  part's NULLs into one bucket that is unique among itself:

  ```sql
  CREATE UNIQUE INDEX idx_sys_view_def_active ON sys_view_definition
    (name, COALESCE(organization_id, '__global__'), COALESCE(owner, ''))
    WHERE state = 'active'
  ```

  Both spellings are copied from an existing in-repo precedent rather than
  invented: `'__global__'` is ADR-0120 D3's reserved sentinel for the tenant
  column (the driver's `GLOBAL_TENANT`), and `COALESCE(owner, '')` is
  `ensureOverlayIndex`'s `COALESCE(package_id, '')` form for a non-tenant nullable
  discriminator. Neither can collide with real data — an organization id may never
  equal `'__global__'`, and an owner is a user id, never the empty string.
  **Storage is untouched**: rows keep their NULLs, only the index folds them, so
  `WHERE owner = ''` still matches nothing.

  Unchanged: archived rows stay exempt (#5839's active-only scoping survives, on
  shared views too), a shared view and a personal view may still share a name, and
  so may two tenants' or two environments' rows.

  **This is a tightening, so it can fail to build.** Unlike #5839, rows that
  violate the new key exist in the wild today, precisely because nothing rejected
  them. The migration probes before it replaces anything, and on a conflict takes
  ADR-0120 D4's disposition: the previous index is left in place (the table is
  never left unconstrained), the report names the key that is not enforced, ships
  the exact `GROUP BY … HAVING COUNT(*) > 1` query that lists the offending rows,
  points at `os migrate plan` — and the boot continues. Resolve the duplicate
  active shared views, restart, and the tightening applies itself.

  Dialects with no partial indexes (MySQL/MariaDB) keep the declared bare
  composite, which is ADR-0120 D3's own degradation. That report is **raised from
  `info` to `error`**: under #5839 alone the dialect lost slot recycling, a
  functional degradation the next user hits immediately, but it now loses an
  integrity guarantee the platform states it enforces while continuing to look
  healthy — AGENTS.md's durability arm. The line names both gaps that stay open
  there and the duplicate-listing query. The unclassifiable-failure arm is raised
  with it, so the failure nobody can name is never reported more quietly than the
  one that has a name.

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- db0d53c: `resolveEngineDeleteDispatch` 末尾改真值测试:假值标量 `where.id` 不再答 `by-id`

  `engine-delete-dispatch.ts` 的自我描述是「what does `ObjectQLEngine.delete` do with this call」的**唯一**答案,其测试文件头把赌注写得很明白:一份漂移的共享判定比没有判定更糟——每个钉在它上面的假引擎都会自信地、一致地错,而门禁照样报绿。这条性质此前在**假值标量 id** 上不成立,实测(origin/main,记录型 driver 驱动真实引擎):

  | 调用                                 | 真实 `ObjectQL.delete` | 判定(修改前) |
  | :----------------------------------- | :--------------------- | :----------- |
  | `{ where: { id: 0 } }`               | `reject`               | `by-id`      |
  | `{ where: { id: '' } }`              | `reject`               | `by-id`      |
  | `{ where: { id: 0 }, multi: true }`  | `multi`                | `by-id`      |
  | `{ where: { id: '' }, multi: true }` | `multi`                | `by-id`      |

  原因是两侧问了不同的问题:判定读 `scalarDeleteId(...) !== undefined`,而 `engine.ts` 把判定结果落进 `id` 之后按 `if (hookContext.input.id)` 分支——**真值**测试,`0` / `''` 落到 multi/reject 阶梯。于是按 `assertEngineDeleteDispatch(options)` 钉死的替身会**接受** `delete(o, { where: { id: '' } })`,而真服务器抛 `Delete requires an ID or options.multi=true`:pinned 替身在这一个输入上仍比生产者宽松,正是本模块存在的理由(#4434 形状)。`id: ''`(路径段为空 / 表单字段未填直传 `where.id`)是可达形状,不是猎奇。

  本次改的是**判定,不是引擎**。`resolveEngineDeleteDispatch` 是对 `ObjectQL.delete` 的描述,错的是描述:`delete(o, { where: { id: 0 } })` 改动前抛错,改动后照样抛错,**生产者行为零变化**,`engine.ts` 一字未动。反向做法(让 `{ id: 0 }` 变成真的按 id 删)是改生产者行为,已作为 #5747 的 B 方案明确不取。

  同时给 `ENGINE_DELETE_DISPATCH_CASES` 补上 `{ id: 0 }` / `{ id: '' }` 的有/无 `multi` 四例——此前这套逐例对照**结构上够不到**这个输入(#4868 家族:一次逐例跑不可能反驳一个没人列出来的输入),这才是判定能悄悄漂移一年的原因。`scalarDeleteId` 保持值忠实(`{ where: { id: 0 } }` 仍返回 `0`),真值测试只加在判定这一层,与 update 侧孪生模块 `scalarUpdateId` 的分法一致。

- 72c3c86: refactor(spec)!: retire `indexes[].type` and `indexes[].partial` — two authorable index keys no driver ever read (#5248, #4943)

  `IndexSchema` declared five keys; only three of them ever reached a `CREATE
INDEX`. `SqlDriver.syncDeclaredIndexes` builds every declared index through
  knex's `table.index(fields, name)` / `table.unique(fields, { indexName })`, and
  the drift differ's `DeclaredIndexInput` carries `name` / `fields` / `unique` /
  `nullSafeColumns`. So:

  - **`partial`** — documented as _"Partial index condition (SQL WHERE clause)"_ —
    produced a **full** index with the predicate silently discarded. This was the
    damaging half, because it reads as a correctness control: the platform's own
    `sys_metadata` declared `partial: "state = 'active'"` for overlay uniqueness,
    and what the declaration alone materialized was an _unrestricted_ unique index.
  - **`type`** additionally carried `.default('btree')`, so it appeared in **every**
    parse output of **every** index — an access-method knob that had never
    influenced a single statement, rendered as live configuration. (It was pinned
    as such in a `sys_presence` test, on an object that never declared it.)

  Both are the ADR-0078 no-silently-inert / ADR-0049 enforce-or-remove shape.
  Remove was chosen over enforce: enforcing needs per-dialect algorithm mapping
  (`gin`/`gist` Postgres-only, `fulltext` MySQL-family), raw-SQL `CREATE INDEX …
WHERE` on the dialects that have partial indexes at all (MySQL does not), and a
  redesign of how `isSyncReproducibleIndex` excludes partial indexes from
  incremental sync — design cost for a capability with no demand. If a real need
  appears it returns enforce-first.

  ## Migration

  | FROM                                                      | TO                                                                                              |
  | :-------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
  | `indexes: [{ fields: […], type: 'gin' }]`                 | `indexes: [{ fields: […] }]` — create the specialised index from a database-layer migration     |
  | `indexes: [{ fields: […], partial: "state = 'active'" }]` | `indexes: [{ fields: […] }]` — issue `CREATE [UNIQUE] INDEX … WHERE …` from a runtime migration |

  **One-line fix: delete the key.** Neither removal changes any DDL, because no
  DDL ever depended on them — verified byte-for-byte against the `CREATE INDEX`
  statements SQLite actually stores
  (`packages/drivers/driver-sql/src/declared-index-retired-keys.test.ts`).

  Both capabilities remain available where they are implementable. The index
  method is the driver/dialect's choice. A partial index is issued as raw SQL from
  a runtime migration — exactly what `metadata-protocol`'s `ensureOverlayIndex`
  already does for `sys_metadata`, and what actually delivers that table's
  active-row-scoped uniqueness today.

  ⚠️ **Not affected:** driver-sql's own `partial` flag (`parseIndexDdl` /
  `introspectIndexes` / `isSyncReproducibleIndex`). That is a boolean parsed back
  out of the _database's own_ DDL for drift detection — the opposite direction —
  so migration-created partial indexes stay recognized and exempt from incremental
  sync, unchanged.

  ## The retirement kit

  - `retiredKey()` tombstones at `IndexSchema` (the shape is deliberately
    `.strip()`, so a plain delete would swap one silent no-op for another): writing
    either key is now a `tsc` error and a parse error carrying the prescription.
    They sit at the bottom of the shape per the #5606 renderer note.
  - **ADR-0087 D2 conversion + D3 chain step** (`object-index-type-partial-removed`,
    `toMajor: 17`, wired into the existing step-17 chain): strips both keys from
    `objects[]` and `objectExtensions[]`; `os migrate meta --from 16` rewrites sources
    mechanically. A pure lossless delete — there was no effect to lose.
  - **Producers flipped:** `sys_metadata` (`idx_sys_metadata_overlay_active`, the
    case #4943 named) and `sys_view_definition` (`idx_sys_view_def_active`), both
    with their comments corrected to say what is actually materialized.
  - Published skill (`objectstack-data`), `content/docs/data-modeling/objects.mdx`,
    liveness ledger note and generated baselines updated.

- 51a587d: 两个写动词的派发判定下沉到 `@objectstack/metadata-core` —— 公共 API 零变化,一次关闭 26 条 engine-double 基线条目

  `ObjectQL.delete` / `ObjectQL.update` 的三分支派发判定(`engine-delete-dispatch.ts` #4550、
  `engine-update-dispatch.ts` #5480)从 `packages/objectql/src/` **原样搬到**
  `packages/metadata-core/src/`。这是一次搬移,不是重构:两个模块本来就零 import、纯自包含,
  判定逻辑一个字未改。

  **为什么搬。** `@objectstack/objectql` 的 `dependencies` 含 `@objectstack/metadata-protocol`,
  所以那个包里 13 个假引擎结构性地无法 import 这两个谓词 —— 反向 devDependency 即成环,
  turbo 2.10.7 直接拒绝任务图。判据来自门禁台账里
  `packages/spec/src/contracts/data-engine.test.ts` 那条 EXEMPT:反向 import 不可行时,唯一
  出路是下沉到**两边都已依赖**的包。`@objectstack/metadata-core` 正是这个包
  (`objectql -> metadata-core` 与 `metadata-protocol -> metadata-core` 都是既有边),而它自己
  的 `dependencies` 只有 `{ @objectstack/spec, zod }`,不含 objectql,故不引入新环。

  **公共 API 与既有调用点零变化。** `packages/objectql/src/engine-delete-dispatch.ts` /
  `engine-update-dispatch.ts` 保留在原路径,改为 re-export shim,因此
  `@objectstack/objectql` 仍然导出
  `resolveEngineDeleteDispatch` / `assertEngineDeleteDispatch` / `scalarDeleteId` /
  `ENGINE_DELETE_REJECT_MESSAGE` / `ENGINE_DELETE_DISPATCH_CASES` 及 update 侧的五个同名对应物
  (与全部类型),`engine.ts` 与 37 个既有 pinned 调用点一行未动。同一批符号现在也从
  `@objectstack/metadata-core` 导出。

  搭配的门禁改动:`scripts/check-engine-double-contract.mjs` 的两个 slice 现在同时接受
  `@objectstack/metadata-core` 与 `@objectstack/objectql` 两种拼写(它们指向同一个函数),
  失败提示也改为在「objectql 依赖该包」时优先建议 metadata-core。

- 946a131: fix(metadata-core,objectql): `ObjectQL.update` 的 `data.id` 同过标量测试,不再把载荷里的算子对象当主键 (#5748)

  `ObjectQL.update(object, data, options)` 用两处取主键,而这两处此前用的是**两套规则**:

  - `options.where.id` 走**标量测试** —— `{ id: { $in: [...] } }` / `{ id: [...] }` /
    `{ id: null }` 是多行谓词,不算 id(#4434 / #4550);
  - `data.id` **不做任何测试**,只要为真就原样当主键,并且先于 `where`、也先于
    `options.multi`。

  于是同一个算子对象,写在 `where.id` 里被正确识别为谓词,写在 `data.id` 里却被
  当成主键绑进 `driver.update(object, id, …)` 的主键位置,**显式声明的
  `multi: true` 被无声忽略**。后果不是数据被覆盖,而是静默失灵或难读的驱动错误:
  SQLite 侧报参数绑定错误,别的驱动可能只匹配零行 —— 两种都不会告诉调用方
  「你的 `multi` 被忽略了」。这是 declared ≠ enforced 的一种,#5393 刚给 flow 的
  `update_record` 补上的 `multi` 批量意图键正是被这条更早的规则盖掉的。

  现在 `data.id` 与 `where.id` **共用同一个标量测试**(判定在
  `packages/metadata-core/src/engine-update-dispatch.ts` 定义一次,`engine.ts` 与
  全部 fake engine 经 `resolveEngineUpdateDispatch` /
  `assertEngineUpdateDispatch` 复用同一份)。非标量 `data.id` 不算 id,因此不再
  盖住任何东西:判定按 `where.id` → `multi` → `reject` 的原有阶梯继续往下走。

  **行为矩阵(FROM → TO)。标量 `data.id` 的按 id 写法完全不受影响。**

  | 调用                                                                | FROM                       | TO                                                                |
  | :------------------------------------------------------------------ | :------------------------- | :---------------------------------------------------------------- |
  | `update(o, { id: 'rec_1', …f })`                                    | by-id `'rec_1'`            | **不变**                                                          |
  | `update(o, { id: 'rec_1', …f }, { multi: true })`                   | by-id `'rec_1'`            | **不变**(标量 `data.id` 仍先于 `multi`)                           |
  | `update(o, { id: 'rec_1', …f }, { where: { id: 'rec_2' } })`        | by-id `'rec_1'`            | **不变**(标量 `data.id` 仍先于 `where`)                           |
  | `update(o, { id: 0, …f }, { multi: true })`                         | multi                      | **不变**(真值判定,`0` 不标识行)                                   |
  | `update(o, { id: { $in: [...] }, …f }, { multi: true })`            | by-id,算子对象被绑进主键位 | **multi** —— 声明的批量意图被执行                                 |
  | `update(o, { id: ['a','b'], …f }, { multi: true })`                 | by-id,数组被绑进主键位     | **multi**                                                         |
  | `update(o, { id: { $in: [...] }, …f })`(**无** `multi`)             | by-id,算子对象被绑进主键位 | **reject**,消息不变:`Update requires an ID or options.multi=true` |
  | `update(o, { id: { $in: [...] }, …f }, { multi: false })`           | 同上                       | **reject**                                                        |
  | `update(o, { id: { $in: [...] }, …f }, { where: { id: 'rec_1' } })` | by-id,绑的是**算子对象**   | by-id,绑的是 **`'rec_1'`**                                        |

  最后一格是这次修复里唯一「判定不变、绑定值变了」的一格 —— 前后都是 `by-id`,
  变的是哪一个 id 源胜出。`ENGINE_UPDATE_DISPATCH_CASES` 因此新增可选的
  `expectId`,把落进主键位的值本身也钉住,避免用例因为「什么都没产出」而绿。

  **「无 `multi` 的非标量 `data.id`」被明确定成响亮拒绝**,不会静默升级成一次真的
  批量写 —— 这是裁决(维护者 2026-08-06)对方案 B 那条顾虑的处置:把算子对象写进
  载荷大概率是写错了位置,那就报错,而不是替作者决定他想批量写。

  无 API 变更:导出符号、类型与 `ENGINE_UPDATE_REJECT_MESSAGE` 的文案均不变。

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4

## 17.0.0-rc.2

### Major Changes

- 65f184b: fix(metadata)!: `sys_metadata_history.recorded_by` stores NULL, not the sentinel string `'system'` (#4556)

  `recorded_by` is declared `Field.lookup('sys_user', { readonly: true })` — a
  foreign key. The write path filled it with `actor ?? 'system'`, so every
  metadata write without a caller actor (boot sync, migration, an internal call)
  stored the **string** `'system'` in a column whose declared type says "the id
  of a `sys_user` row". No such row exists, and `SystemUserId.SYSTEM`
  (`'usr_system'`) is not auto-provisioned on the current runtime either, so the
  value resolved to nothing under any reading. Any consumer that read the field
  by its declaration — `expand`, an owner column in a report, an audit timeline
  showing "who changed this" — got an id that could not be dereferenced.

  It had already cost twice. #4441 had to exempt every `readonly` field from the
  write-path referential-integrity check, because otherwise ordinary metadata
  authoring (package create / publish / clone) was rejected. #4551's
  dangling-reference audit had to skip the same set for the same reason. The
  field ended up the platform's only reference column that is neither enforced
  nor audited.

  **The fix is on the write path, not the declaration.** `recorded_by` stays a
  `lookup('sys_user')`; an actor-less write now stores `NULL`, and `NULL` means
  "system-initiated (boot sync, migration, scheduled job)" — the standard
  expression of "no link", and already what this column's `set_null` delete
  behaviour means. No magic system-user account (a row that can never sign in yet
  holds an identity is a new security surface), and no `actor_kind` companion
  column.

  **Breaking — the repository contract is now explicitly nullable.**

  | Surface                                   | Before   | After                                 |
  | :---------------------------------------- | :------- | :------------------------------------ |
  | `PutOptions.actor`, `DeleteOptions.actor` | `string` | `string \| null` (still **required**) |
  | `MetadataEvent.actor`                     | `string` | `string \| null`                      |
  | `MetadataItem.authoredBy`                 | `string` | `string \| null`                      |

  `actor` stays required rather than becoming optional on purpose: every call
  site must state which of the two it is, so a forgotten actor cannot silently
  become a fake foreign key. Migrating a caller:

  - **Writers** — passing a real identity: unchanged. Passing `'system'`, `''`,
    or a label to satisfy the type: pass `null` instead.
  - **Readers** — `event.actor` and `item.authoredBy` can be `null`. Handle it at
    the point of display (`actor ?? 'System'` in a UI string is fine — the fix is
    that the _stored_ value no longer lies, not that no label may ever be shown).

  Two read paths also stopped inventing a value: `SysMetadataRepository.history()`
  and `getByHash()` rendered an absent actor as the string `'unknown'`, which is
  indistinguishable from a real user id to anything that resolves the field. They
  now surface `null`.

  **Existing rows: `os migrate recorded-by`.** The stored `'system'` values are
  rewritten to `NULL` by a new command, which runs the conversion through the
  ADR-0119 D2 migration journal (chunk-atomic, resumable via `os migrate resume`).
  It is a dry run by default and safe to re-run — it selects only rows still
  holding the sentinel, so a second `--apply` converts nothing.

  The rewrite is **semantically equivalent, not a reinterpretation**: this column
  has only ever held that one sentinel, written by exactly one expression
  (`actor ?? 'system'`), and both spellings mean "no actor" — only `NULL` is
  expressible in the declared type.

  Deliberately unchanged: `sys_metadata_audit.actor` is a `text` column whose
  declaration already says "user id, system id, or `'system'`", so its `'system'`
  default is honest and stays. The #4441 `readonly` narrowing and the #4551 audit
  skip also stay — see the PR for why they are still correct.

- ce92674: feat(spec)!: retire the standalone `validation` metadata kind (#4509, ADR-0088)

  A validation rule authored as its own artifact bound to nothing and gated no
  write. `ValidationRuleSchema` carries **no object-binding key** — no `object`,
  no `objectName` — and all six variants are `strictObject`, so an author could
  not supply one either. No merge step existed. The only code that expected such a
  key was a reference-tracker row scanning a field the schema would have stripped.
  Meanwhile the engine evaluates exactly one shape: the object's own
  `validations[]` array, on insert and on every matched update row.

  So a rule created through the standalone door — a `*.validation.ts` file, or
  Studio's Validations list — parsed, saved, reported success, and intercepted
  nothing. Including a `state_machine` rule, which ADR-0020 routes through this
  same vocabulary: an author could believe they had locked down record state
  transitions and have changed nothing at all.

  Under ADR-0088 the kind fails the admission test on its first clause: a rule has
  no independent lifecycle, because it only means something against an object. And
  unlike the sibling disconnects closed in this batch, it could not be bridged into
  one — the shape has nowhere to name its object.

  **The rule vocabulary is untouched.** `ValidationRuleSchema` and all six
  variants are unchanged and fully live; the engine's evaluation path is not
  modified by this change. It is the _kind_ that was inert, not the schema. The
  liveness ledger keeps governing it through the gate's `SPEC_ONLY_SCHEMAS`
  override (alongside `webhook` and `query`), because an ungoverned live schema is
  exactly how the next drift would hide.

  **Migration.** Move the rule into the owning object's `validations:` array — the
  rule body is identical, same schema, same six variants:

  ```ts
  // before — a standalone *.validation.ts, which never ran
  export default defineValidation({ name: 'amount_positive', type: 'script', … })

  // after — on the object, where rules are evaluated
  ObjectSchema.create({
    name: 'invoice',
    validations: [{ name: 'amount_positive', type: 'script', … }],
  })
  ```

  Removed: the registry entry (and its `*.validation.ts` / `*.validation.yml`
  patterns), the `MetadataTypeSchema` member, the metadata-core lockstep enum
  member, the schema-map entry, the create seed, Studio's Validations nav item and
  its hand-crafted form, and the dangling reference-tracker row. Standalone rows
  already in `sys_metadata` are left alone — they were never evaluated, so nothing
  changes behaviorally.

### Patch Changes

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- f5a4ef0: refactor!: ADR-0112 batch 2 — sweep the lowercase error-code emitters (#4003)

  Continues #3841 per ADR-0112. Batch 1 (#3988) settled the vocabulary and closed
  the set; this batch moves the emitters that still spoke lowercase `snake_case`
  onto it.

  **Wire-visible change.** Error codes on these surfaces change spelling. Generic
  conditions collapse onto the standard catalog rather than keeping a synonym:
  `unauthorized`/`unauthenticated` → `UNAUTHENTICATED`, `forbidden` →
  `PERMISSION_DENIED`, `not_found` → `RESOURCE_NOT_FOUND`, `internal` →
  `INTERNAL_ERROR`, `unavailable` → `SERVICE_UNAVAILABLE`, `not_supported` →
  `NOT_IMPLEMENTED`, `bad_request` → `INVALID_REQUEST`. Domain conditions get codes
  registered in `ERROR_CODE_LEDGER` (`MARKETPLACE_STORAGE_FAILED`,
  `PLUGIN_MANIFEST_INVALID`, `ITEM_LOCKED`, `DELIVERY_NOT_ELIGIBLE`, …). Swept:
  `cloud-connection`, `plugin-auth`, `hono`, `metadata-protocol`, `rest`,
  `service-messaging`, `service-automation`, `trigger-api`.

  Branch on `error.code` values rather than pattern-matching their case: the
  console's fix for the same rename (objectui#2977) reads codes case-insensitively
  for exactly this reason, and that is the pattern to copy in your own consumers if
  you support servers on both sides of the change.

  **Four routes stop putting a code in the message slot.** The webhook redeliver
  route, the API-trigger webhook, and two `rest` routes answered
  `{ success: false, error: '<code>', message }` — the code occupying `error`, the
  declared object envelope nowhere. They now emit `error: { code, message }`, and
  three API-trigger branches gained a message they never had. Clients reading
  `body.error` as a string on those routes must read `body.error.code`.

  **`ConnectorErrorCategory` / `ConnectorRetryStrategy`** (ADR-0112 D9a):
  `@objectstack/spec` exported two mutually incompatible `ErrorCategory` types and
  two `RetryStrategy` types. The connector-side pair is renamed; importers of the
  `integration` subpath update the name. Side effect: the api-side `ErrorCategory`
  and `RetryStrategy` now appear in the generated API reference at all — the name
  collision had been silently dropping them.

  **`OAUTH_REGISTER_FAILED` replaces an unbounded code source.** The OAuth client
  registration route put better-auth's arbitrary `body.error` string straight into
  `error.code`. The code is now ours and the upstream discriminator moved to
  `details.upstreamError`.

  **Not swept, deliberately.** `sys_metadata_audit.code` keeps its lowercase values
  (ADR-0112 D6b): it is persisted audit history, and the same column holds
  non-error outcomes (`ok`, `lock_override`). Diagnostics records that ship inside a
  200 keep theirs (D6c), as do field-level codes (D6, #3977) and the CLI's
  `--json` output contract.

  A `check:error-code-casing` CI guard now fails on a new lowercase literal in a
  code position, since the ledger's casing rule can only police codes that someone
  registers.

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [65a3a84]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1

## 17.0.0-rc.0

### Patch Changes

- db48ad5: fix(security,approvals,metadata-core): restore batch routes on the eight objects the #3391 P1 companion fix missed (#3026)

  The #3391 P1 contract made the bulk gate `bulk ∧ derived(child)`: a batch
  request is admitted only when the object grants the `bulk` **primitive** and the
  batched child operation is itself allowed. Before that, the `*Many` routes
  checked only the child verb, so a boilerplate CRUD-five whitelist
  (`['get','list','create','update','delete']`) batched fine.

  The companion fix — adding the `bulk` primitive wherever an explicit whitelist
  survived — was applied only inside `platform-objects`. Eight objects carrying
  the same boilerplate live in other packages and kept the gap, so `/batch`,
  `createMany`, `updateMany` and `deleteMany` answered `405
OBJECT_API_METHOD_NOT_ALLOWED` on objects whose single-record create/update/
  delete were wide open. `data-objectstack` rethrows that 405 without falling back
  to per-row writes, which surfaced as a hard error on multi-select delete in the
  Setup grids.

  Objects reclaimed (whitelist now `['get','list','create','update','delete','bulk']`):
  `sys_capability`, `sys_permission_set`, `sys_position`,
  `sys_position_permission_set`, `sys_user_permission_set`, `sys_user_position`
  (plugin-security); `sys_approval_delegation` (plugin-approvals);
  `sys_view_definition` (metadata-core).

  No new authority is granted: `bulk` only permits batching verbs each object
  already exposes one record at a time, and every batched row still passes the
  same row- and field-level permission checks. The whitelists stay explicit rather
  than being deleted — seven of the eight are `managedBy`, and
  `reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
  `apiMethods`, so dropping the line would silently disable the managed-write
  backstop.

- c073b8c: refactor(metadata-core): drop `sys_view_definition`'s all-six `apiMethods` whitelist (#3026)

  #3745 completed this object's boilerplate CRUD-five whitelist to all six
  primitives so its batch routes stopped 405-ing. A whitelist naming all six is
  equivalent to no whitelist — except it stops tracking primitives the enum grows
  later — so the #3543 audit rule applies and the declaration is removed.

  No behaviour change: `undefined` resolves to `unrestricted`, whose effective
  operation set is identical to `restricted` holding all six.

  Removing it is safe HERE specifically because the object has no `managedBy`:
  `reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
  `apiMethods`, so for a managed object an absent whitelist would take the
  managed-write backstop with it. That is why the RBAC objects reclaimed by #3745
  keep their explicit arrays and this one does not.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [67452d1]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
  - @objectstack/spec@16.1.0

## 16.0.0

### Patch Changes

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

- 06cb319: fix(identity): close the generic-write apiMethods hole on sys_presence and sys_metadata (#3220)

  Follow-through on #1591/#3213 (better-auth apiMethods reconciliation) for two
  non-better-auth managed objects that shipped the same contradiction: their
  `enable.apiMethods` advertised generic `create`/`update`/`delete` while their
  `managedBy` bucket forbids user-context writes, leaving the generic `/data`
  route open to a write the bucket does not permit.

  - `sys_presence` (`managedBy: 'append-only'`) advertised `create`/`update`/`delete`
    (update/delete on an append-only object at that) but is written only over the
    realtime websocket/in-memory path, never through ObjectQL. Narrowed to
    `['get', 'list']`.
  - `sys_metadata` (`managedBy: 'system'`) advertised full CRUD but customization
    overlays are authored only through the metadata-protocol RPC (engine writes
    carry a transaction context, not a user session); neither the framework nor
    the Console (objectui) POSTs `/data/sys_metadata`. Narrowed to `['get', 'list']`.

  Reads stay open. The metadata-protocol / realtime write paths are engine-level
  and bypass the HTTP exposure gate, so they are unaffected — verified by the
  metadata-authoring dogfood and the objectql overlay tests.

  A blast-radius audit confirmed the broader `system`/`append-only` buckets are NOT
  safe to guard wholesale: several `system` objects (`sys_user_position`,
  `sys_user_permission_set`, `sys_position_permission_set`, `sys_user_preference`,
  `sys_import_job`) are legitimately user-writable by design (delegated
  administration, user preferences, imports). Generalizing the engine write guard
  to those buckets is intentionally NOT done here — see #3220 for the bucket-taxonomy
  root cause.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0

## 16.0.0-rc.1

### Patch Changes

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- 06cb319: fix(identity): close the generic-write apiMethods hole on sys_presence and sys_metadata (#3220)

  Follow-through on #1591/#3213 (better-auth apiMethods reconciliation) for two
  non-better-auth managed objects that shipped the same contradiction: their
  `enable.apiMethods` advertised generic `create`/`update`/`delete` while their
  `managedBy` bucket forbids user-context writes, leaving the generic `/data`
  route open to a write the bucket does not permit.

  - `sys_presence` (`managedBy: 'append-only'`) advertised `create`/`update`/`delete`
    (update/delete on an append-only object at that) but is written only over the
    realtime websocket/in-memory path, never through ObjectQL. Narrowed to
    `['get', 'list']`.
  - `sys_metadata` (`managedBy: 'system'`) advertised full CRUD but customization
    overlays are authored only through the metadata-protocol RPC (engine writes
    carry a transaction context, not a user session); neither the framework nor
    the Console (objectui) POSTs `/data/sys_metadata`. Narrowed to `['get', 'list']`.

  Reads stay open. The metadata-protocol / realtime write paths are engine-level
  and bypass the HTTP exposure gate, so they are unaffected — verified by the
  metadata-authoring dogfood and the objectql overlay tests.

  A blast-radius audit confirmed the broader `system`/`append-only` buckets are NOT
  safe to guard wholesale: several `system` objects (`sys_user_position`,
  `sys_user_permission_set`, `sys_position_permission_set`, `sys_user_preference`,
  `sys_import_job`) are legitimately user-writable by design (delegated
  administration, user preferences, imports). Generalizing the engine write guard
  to those buckets is intentionally NOT done here — see #3220 for the bucket-taxonomy
  root cause.

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1

## 15.1.0

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0

## 14.4.0

### Minor Changes

- 7953832: ADR-0057 data lifecycle P1–P4 (#2786): platform-generated data is now bounded by construction.

  - **P1 — contract**: new `lifecycle` object property (`class: record | audit | telemetry | transient | event` + `retention` / `ttl` / `storage(rotation)` / `archive` / `reclaim`), enforced by the platform-owned **LifecycleService** registered by `ObjectQLPlugin` (default-on; disable via `OS_LIFECYCLE_DISABLED=1` or plugin `lifecycle.enabled=false`). The Reaper batch-deletes rows past `retention.maxAge` / `ttl` under a system context and reclaims space (`SqlDriver.reclaimSpace()` → SQLite `PRAGMA incremental_vacuum`). Non-`record` classes must declare a bounding policy (parse-time invariant + spec-liveness gate + dogfood storage-growth gate).
  - **P2 — rotation**: `storage: { strategy: 'rotation', shards, unit }` physically time-shards the table on SQLite — writes land in the current shard, reads go through a UNION-ALL view under the base name, expiry is an O(1) `DROP` of shards past the window. A legacy table is adopted as the first shard on upgrade. Other dialects fall back to an equivalent age-based reap.
  - **P3 — separation + Archiver**: registering a datasource named `telemetry` routes telemetry/event/audit objects to it (opt-in by existence; `transient` deliberately stays on the primary). Audit objects with `archive` declared get retain → archive → delete once the archive datasource exists; without it rows are retained, never dropped unarchived.
  - **P4 — governance**: new `lifecycle` settings namespace — runtime enable switch, per-object retention overrides (tenant-scoped: regulated tenants set years, dev sets days), per-object/per-class row quotas and growth alerts (observe-and-alert only).

  **Behavior change**: 11 platform objects now carry lifecycle declarations and their telemetry is bounded by default — `sys_activity` 14d (rotated), `sys_audit_log` 90d hot → archive (retained forever until an `archive` datasource is registered), `sys_metadata_audit` 365d → archive, `sys_job_run` / `sys_automation_run` / `sys_http_delivery` 30d, notification pipeline (`sys_notification`, delivery, receipt, inbox) 90d, `sys_device_code` expires_at + 1d. Extend windows per environment/tenant via the `lifecycle.retention_overrides` setting.

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
  - @objectstack/spec@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0

## 12.4.0

### Minor Changes

- 60dc3ba: ADR-0087 P0 — enforce the protocol version handshake (make `engines.protocol` real).

  `PluginEnginesSchema.protocol` (ADR-0025 §3.2, protocol-first per §3.10 #3) was declared, documented, and checked by no loader or installer — an ADR-0078 "declarable-but-inert" violation. A package built against an incompatible protocol major failed deep in a schema `.parse()` or a renderer contract instead of at the boundary.

  - **`@objectstack/spec`**: exports `PROTOCOL_VERSION` / `PROTOCOL_MAJOR` (`kernel`) — the single source of truth the handshake checks against. A drift test keeps it in lockstep with the package major.
  - **`@objectstack/metadata-core`**: adds `checkProtocolCompat()` (pure, major-grained range check), `assertProtocolCompat()`, and the structured `ProtocolIncompatibleError` (`OS_PROTOCOL_INCOMPATIBLE`, carrying both versions and the `objectstack migrate meta --from N` command). It refuses only on a _positive_ mismatch determination; absent ranges are grandfathered (warn) and unrecognized ranges never cause a false rejection.
  - **`@objectstack/metadata-protocol`**: `installPackage` runs the handshake before writing to the registry — an incompatible package is refused with a machine-actionable diagnostic instead of crashing later.

  Additive and backward compatible: packages that declare no `engines.protocol` range keep loading (with a warning). Part of the ADR-0087 epic (#2643); resolves #2644.

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0

## 12.2.0

### Minor Changes

- da807f7: feat(spec)!: retire the placeholder metadata kinds `trigger`, `router`, `function`, `service` (ADR-0088).

  The registry is the contract authors — human and AI — read to learn what can be authored, and these four kinds had no authoring surface, no loader, no schema, and no (or a dead) consumer. `MetadataTypeSchema` + `DEFAULT_METADATA_TYPE_REGISTRY` shrink 30 → 26; `OPS_FILE_SUFFIX_REGEX` drops the four suffixes; the dormant objectql load path that registered QL functions from `type: 'function'` metadata items is removed (`defineStack({ functions })` / plugin `contributes.functions` remain the delivered forms); the metadata-core lockstep enum follows. `external_catalog` stays and is now annotated RUNTIME-CREATED (ADR-0062): its lack of an authoring surface is correct design. The delivered replacements: `hook` / `record_change` flows (trigger), plugin `contributes.routes` + declarative `apis:` (router), `defineStack({ functions })` (function), the plugin/service registry (service). Persisted `sys_metadata` rows are unaffected — no production read path re-parses stored `type` values through the enum.

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
  - @objectstack/spec@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/spec@11.1.0

## 11.0.0

### Minor Changes

- 4d99a5c: Package-scoped commit history & rollback for AI authoring (ADR-0067)

  Each authoring apply now lands as one revertible **commit** on a package timeline, on top of `sys_metadata_history`:

  - New `sys_metadata_commit` object groups a turn's metadata changes (by `event_seq` range).
  - `publishPackageDrafts` records each publish as one commit (best-effort) with a per-artifact revert plan and an optional `message` / `aiModel`.
  - New protocol methods `listCommits`, `revertCommit`, `rollbackToPackageCommit` (reusing `restoreVersion` + delete; a revert is itself an append-only commit).
  - New REST routes: `GET /packages/:id/commits`, `POST /packages/:id/commits/:commitId/revert`, `POST /packages/:id/rollback`.

### Patch Changes

- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0

## 9.4.0

### Minor Changes

- fef38ec: feat(metadata): package-scoped customization overlays (ADR-0048 #1824)

  A `sys_metadata` customization overlay is now keyed by `(type, name,
organization_id, package_id)`, so two installed packages shipping an item of the
  same `type`/`name` can each carry their **own** overlay. Previously the overlay
  uniqueness key was `(type, name, organization_id)` — physically one row per
  name — so customizing one package's item shadowed both, and a package-scoped
  read fell back to whichever row existed.

  - **Index**: `idx_sys_metadata_overlay_active` / `…_draft` now include
    `package_id`. The runtime migration (`ensureOverlayIndex`) uses
    `COALESCE(package_id, '')` so package-less (global) overlays stay unique among
    themselves (a plain unique index treats NULLs as distinct). DROP-then-CREATE,
    idempotent; existing rows migrate safely (the old key already guaranteed one
    row per `(type, name, org)`).
  - **Write**: `SysMetadataRepository.whereFor`/`put`/`get` scope the upsert to the
    requested package, so a save bound to package B no longer finds and overwrites
    package A's same-name overlay. A package-less save (`packageId` null) targets
    the global row.
  - **Read**: `getMetaItem` / `getMetaItemLayered` overlay lookups already prefer
    the package-scoped row; the fallback now resolves only the **global**
    (`package_id IS NULL`) overlay, never a _different_ package's row. Package-less
    readers are unchanged (match-any, back-compat).

  Verified live against a real collision (two packages each shipping
  `page/showcase_task_workbench`): two overlay rows coexist, and `?package=` single
  reads + the `?layers=true` Studio editor view each return that package's own
  overlay; the unique index migrated in place.

  Known follow-up: the _unscoped list_ (`GET /meta/:type` with no `?package=`)
  still dedupes by bare name, so when two packages both carry an overlay on the
  same name the list collapses them — the per-package single-item and editor paths
  are unaffected. Tracked for the list-dedup-by-name work.

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0

## 7.7.0

### Patch Changes

- 764c747: fix(metadata): home the metadata-storage objects in metadata-core and register them from ObjectQL

  Standalone "host config" apps boot without `@objectstack/metadata`'s MetadataPlugin, so nobody registered the metadata-storage objects (`sys_metadata`, `_history`, `_audit`, `sys_view_definition`) into ObjectQL — their tables were never schema-synced and ObjectQL's own protocol (`loadMetaFromDb` / `getMetaItems`) failed with `no such table: sys_metadata` on every read.

  - Move the four storage-object definitions from `@objectstack/platform-objects/metadata` to `@objectstack/metadata-core` (the lowest package shared by their real consumers); `platform-objects/metadata` now re-exports them for back-compat.
  - `ObjectQLPlugin` registers these objects itself (gated on `environmentId === undefined`, mirroring `restoreMetadataFromDb`) so their tables always sync on platform/standalone kernels.
  - Gate the SQL driver's tenant-audit warning on actual multi-tenant mode — `organization_id` now exists on every table, so column presence alone no longer implies "tenant-scoped"; single-tenant boots no longer spam the warning for system writes.

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0

## 7.6.0

## 7.5.0

## 7.4.1

## 7.4.0

## 7.3.0

## 7.2.1

## 7.2.0

## 7.1.0

## 7.0.0

## 6.9.0

## 6.8.1

## 6.8.0

## 6.7.1

## 6.7.0

## 6.6.0

## 6.5.1

## 6.5.0

## 6.4.0

## 6.3.0

## 6.2.0

## 6.1.1

## 6.1.0

## 6.0.0

## 5.2.0

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

## 5.0.0

### Minor Changes

- 5e9dcb4: **BREAKING — metadata: remove `project` and `branch` from `MetaRef`**

  The metadata layer no longer models project or branch. Customisation is now
  scoped purely to **organisation**. Project remains exclusively as an artifact
  packaging concept (the `objectstack.json` bundle envelope); branching is left
  to Git.

  What changed:

  - `MetaRef` is now `{ org, type, name, version? }` (was
    `{ org, project, branch, type, name, version? }`). `refKey()` is the two
    segment string `${org}/${type}/${name}` (was five segments).
  - `MetadataItem.seq` is monotonic **per org** (was per branch).
  - `BranchRef`, `MergeStrategy`, `MergeResult` types and the optional
    `fork`/`merge` methods on `MetadataRepository` are removed.
  - `ListFilter` / `WatchFilter` / `HistoryOptions` no longer accept `project`
    or `branch`.
  - `FileSystemRepository` disk layout simplified to
    `<root>/<type>/<name>.json` (was `<root>/<project>/<branch>/<type>/<name>.json`);
    change-log path is now `.objectstack/.log/main.jsonl` regardless of any
    branch concept. Constructor no longer accepts `project` / `branch`.
  - `SysMetadataRepository`: removed `projectLabel` / `branchLabel` options;
    the `sys_metadata` schema's `project_id` / `branch` columns (if present)
    are ignored. A future major release will `DROP` them.
  - `MetadataManager.setRepository(repo, opts)` no longer takes an opts object
    with `branch`.

  Migration:

  ```diff
  -const ref = { org: 'acme', project: 'crm', branch: 'main', type: 'view', name: 'home' };
  +const ref = { org: 'acme', type: 'view', name: 'home' };

  -new FileSystemRepository({ root, org: 'acme', project: 'crm', branch: 'main' });
  +new FileSystemRepository({ root, org: 'acme' });
  ```

  Existing `sys_metadata` rows continue to load; the deprecated columns are
  ignored at read time.

- 4150fe4: Add `MetadataCache` — bounded, event-invalidated LRU sitting in front of
  any `MetadataRepository`. Features:

  - Bounded by `maxEntries` and `maxBytes` (default 1024 / 8 MiB).
  - LRU eviction with touch-on-read.
  - Lazy fill on read miss; negative caching for known-absent items.
  - Subscribes to `repo.watch(filter)` and invalidates affected entries
    (including rename: both old and new keys).
  - Coalesces concurrent reads for the same key onto a single backend
    fetch (thundering-herd safe).
  - Generation counter discards in-flight fetches that race an
    invalidation, preventing stale-cache poisoning.
  - Diagnostics via `getStats()` (entries, bytes, hits, misses,
    invalidations, coalesced).

  Includes a property-based test that verifies cache→repo convergence
  under randomly-generated update sequences.

  See ADR-0008 §10 PR-3.

- 8337cdb: Add `InMemoryRepository` (reference implementation) and a parameterised
  Repository contract test suite. The contract suite, exposed at
  `@objectstack/metadata-core/testing`, verifies the seven invariants every
  backend must satisfy (atomic put, monotonic seq per branch, optimistic
  locking, canonical hashing, event ordering, watch resumability,
  tombstones).

  Includes implementation-specific tests covering the injected clock,
  canonical-hash insertion-order independence, and deep-copy isolation
  between caller and store.

  See ADR-0008 §10 PR-2.

- 58835a6: Add `LayeredRepository` — composes N `MetadataRepository`s into a
  read-through stack. Reads walk top-to-bottom; writes route to the
  topmost writable layer; `list()` deduplicates by `refKey` preferring
  the top; `history()` and `watch()` merge events from all layers,
  tagging each event's `source` with `<layer>:<original-source>`. The
  multiplexed `watch()` correctly cancels all child iterators when the
  consumer calls `return()`.

  Enables the canonical "system built-ins under user overlay" pattern
  described in ADR-0008.

  See ADR-0008 §10 PR-5.

- 8cc30b4: New package: Repository contracts for the metadata lifecycle (ADR-0008).

  Definitions only — no I/O. Exports Zod schemas, the
  `MetadataRepository` interface, canonical-form helpers
  (`canonicalize`, `hashSpec`), and typed errors (`ConflictError`,
  `NotFoundError`, `SchemaValidationError`).

  This is M0 PR-1 of the four-layer metadata refactor. Subsequent PRs
  add `InMemoryRepository`, `MetadataCache`, `FileSystemRepository`
  and migrate the existing `MetadataManager` / HMR plumbing onto the
  new contracts.

### Patch Changes

- 32ce912: Add `@objectstack/metadata-fs` — Node-only `FileSystemRepository`
  implementation of the M0 Repository contract.

  Layout:

  ```
  <root>/
    <type>/<name>.json          # canonical body (atomic rename writes)
    .objectstack/.log/<branch>.jsonl   # append-only change log
  ```

  Features:

  - All 17 contract tests pass (`singleBranch: true`).
  - Per-key serialization via `KeyedMutex`.
  - Atomic writes via tmpfile + rename.
  - Heads and `seq` recovered from the JSONL log on `start()` — survives
    process restart.
  - chokidar watcher translates external edits (e.g. VSCode saves) into
    `MetadataEvent`s with `source: 'fs'`.
  - Self-write suppression: 200ms window prevents the watcher from
    re-emitting events for files we wrote ourselves.
  - Manual `AsyncIterator` for `watch()` to mirror the in-memory pattern.

  Also (`metadata-core`):

  - Add `singleBranch` option to `runRepositoryContractTests` so
    single-branch backends (like the FS one) skip the cross-branch test.
  - Switch tsup `splitting: true` so `index.js` and `testing.js` share a
    single `ConflictError` class identity (was double-bundled before).

  See ADR-0008 §10 PR-4.
