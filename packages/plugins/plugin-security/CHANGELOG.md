# @objectstack/plugin-security

## 17.3.0

### Minor Changes

- 6171331: fix(plugin-security): `controlled_by_parent` composes across a chain — a child whose master is itself derived is no longer readable and writable org-wide (#11082)
  
  **BREAKING** access tightening, shipped as `minor` under the repo's
  launch-window convention. It denies reads and writes that previously
  succeeded — which is the whole point: they were never authorized by any
  declaration, and the app author could not tell.
  
  `controlled_by_parent` (ADR-0055) resolves a detail's access from its master.
  #5386 made that resolution fold in the master's ownership and its
  `sys_record_share` grants, not just the master's RLS policies. It did not
  recurse, and both halves it composes answer "no restriction" for a master that
  is **itself** `controlled_by_parent`:
  
  - the RLS half is `null`, because a derived object authors no policy —
    declaring `controlled_by_parent` *is* its policy;
  - the sharing half is `null` too: `plugin-sharing`'s `buildReadFilter` opts out
    of every model that is not `private`, and `effectiveSharingModel` maps
    `controlled_by_parent` to `public`.
  
  Composed: `null`. The derivation's master query then ran as **system** with an
  empty predicate and returned **every master row**, so a two-level chain was
  enforced at level one and org-wide at level two. The write half failed through
  a separate mechanism with the same result: the master gate asks `canEdit` on
  the master row, `checkEdit` returns `abstain` for a `public`-mapped model, and
  `abstain` is not `deny` — so it answered `true` for every master row.
  
  Both halves now walk the chain. The read derivation composes the master's own
  `controlled_by_parent` filter as a third layer, and the write gate runs its
  three master-edit legs on each hop until it reaches a master that governs its
  own rows. The master set is therefore point-for-point equal to what a direct
  read of the master returns, at every level, which is the equality #5386
  established for one level.
  
  This is **not** a blanket refusal for chained declarations: a detail whose
  whole chain is reachable stays readable and writable, and the single-level case
  is unchanged. Two guards bound the walk and both fail **closed**, never to "no
  restriction": a metadata cycle is refused, and so is a chain deeper than 8
  links (a cost ceiling, not a supported-length statement — termination is
  already guaranteed by the cycle guard).
  
  What an app may observe: a detail under a `controlled_by_parent` master that
  was reachable before is now reachable only if the caller can reach the whole
  chain above it. Apps whose masters are `private`, `public_read` or
  `public_read_write` — every `controlled_by_parent` object authored in this
  repo — are unaffected.
  
  <!-- adr-0087: not-required (no-migration-prescription) An access-derivation fix inside plugin-security. No spec surface is renamed, retired or re-shaped, no authorable metadata key changes meaning, and there is nothing for `objectstack migrate meta` to rewrite — a chained declaration that was silently unenforced is now enforced as it always read. -->
- 25b1b81: Surface "declared ≠ enforced" on package-declared permission sets, and give
  operators a sanctioned, audited way to discard a stale environment overlay.
  
  Field report: an rc→GA upgraded environment can freeze a package's
  permission set at a stale snapshot while the shipped artifact keeps
  shipping grant changes — silently, with only a boot log counter as a
  signal. Two independent mechanisms can cause this, and either (or both
  together) can be live on one row:
  
  - **overlay shadow** — a Studio permission-matrix save on a package-declared
    set materializes a `sys_metadata` overlay that shadows every later package
    edit to that set, forever, surviving redeploys and restarts;
  - **provenance skip** — a `sys_permission_set` row whose `managed_by` column
    predates package provenance tracking is treated as environment-authored
    and never reconciled with the package.
  
  `sys_permission_set` now carries `drift_status` / `drift_detail`, recomputed
  every boot, naming the set and the cause — a new "Needs Attention" Setup
  list view surfaces only sets that actually differ from their shipped
  artifact (an in-sync set is never flagged; `drift_status` stays `null`).
  
  A new "Discard Overlay" Setup action (`POST
  /api/v1/security/permission-sets/:id/discard-overlay`) removes a stale
  overlay and resyncs the record to the current artifact synchronously — the
  supported, audited counterpart to the raw-SQL remediation the field report
  had to use. It targets package-declared sets only: a set with no current
  package declaration is refused, so a genuinely environment-authored set can
  never be discarded by name collision.
  
  Boot-time auto-adoption of legacy rows and a bulk `os meta
  adopt-permission-sets` command remain out of scope (2026-08-20 maintainer
  ruling) — the manual SQL adoption recipe stays documented for the rc→GA
  provenance-skip case; see the ops runbook.
- e170b0a: Lock package-declared permission sets at the save door; clone to customize (#11513)
  
  Maintainer ruling of 2026-08-24, recorded verbatim and untranslated:
  「同意 第一步(创业阶段,Salesforce 式)」 — step 1 of the mainstream-platform
  comparison: lock the base, clone to customize.
  
  A Studio/API save that targets a **package-declared** permission set is now
  **refused at the server**, with a message that names the sanctioned path — clone
  it and edit the clone. Previously the data door translated the write into a
  metadata write and left the refusal entirely to the metadata protocol's ADR-0005
  tier gate. That gate is exactly what the documented
  `OS_METADATA_WRITABLE=permission` operator hatch switches off, so on a
  deployment running with the hatch there was no refusal at all: the save minted a
  `sys_metadata` overlay of a packaged set, and boot reconciliation re-projected
  that overlay onto the record on every boot, unconditionally, forever — the set
  froze at the fork and every future package upgrade of it was ignored, silently.
  
  **Clone-to-customize** is the sanctioned path and is unchanged: the clone is an
  ordinary org-owned set (`managed_by: 'admin'`, no `package_id`, so no upgrade
  linkage), and upgrades keep flowing to the package-declared base untouched.
  
  **Existing forks** get a **detection reading** at boot — count *and names*,
  warned loudly, saying outright that nothing was reaped. It reads `sys_metadata`
  directly rather than the `customized` column, which is forced `false` on the
  exact confounded shape the field report measured (a genuinely package-declared
  set whose row's `managed_by` predates provenance tracking). Nothing is reaped,
  merged or migrated: disposition of an existing fork is a follow-up reading for
  the maintainer, and the per-set remedy remains the explicit, audited
  "Discard Overlay" action a human invokes.
  
  Behaviour deliberately NOT narrowed:
  
  - an **ordinary org-owned** set is still fully editable (pinned as a control —
    a lock that refuses everything would satisfy the refusal pin perfectly);
  - the **activate / deactivate** actions still write their column: a bare
    `{ active }` patch is row state, not a customization of the definition;
  - a `managed_by: 'package'` row with **no artifact behind it** — published
    through the metadata door (ADR-0070) and materialized by the ADR-0086 P2
    path — keeps editing in place. That is ADR-0094 D5-R's surviving
    `allowRuntimeCreate` neighbour, and `managed_by` is measurably not the
    artifact-provenance fact. Provenance is read from the engine SchemaRegistry,
    the one source this plugin already calls "package-declared".
  
  Provenance is **fail-closed**: a read that cannot answer refuses the save rather
  than accepting it, and the read is not a name-keyed page over
  `sys_permission_set`, so it cannot be truncated into a false "not packaged".
- a65db76: `OrgScopingEntitlement` grows two per-deployment wall-shaping keys, both declared by the mounted `org-scoping` runtime and consumed by plugin-security when arming the Layer 0 organization wall, both fail-closed (absent ⇒ byte-identical behaviour):
  
  - `platformGlobalObjects?: readonly string[]` — objects THIS deployment declares platform-global; Layer 0 does not wall them here (read filtering, the ADR-0123 D2 no-active-org write refusal, the forge guard, and the Layer 1 wildcard-`organization_id` policy drop all follow, because they read the same per-object security meta). Exact machine names only; a junk shape is refused loudly and exempts nothing.
  - `suppressUnboundedOrgAdminGrant?: boolean` — the walled-posture `organization_admin` auto-grant hands out `organization_admin_no_bypass` (no unbounded `viewAllRecords`/`modifyAllRecords`) instead; the superseded-variant reconcile converges standing grants in both directions.
  
  New spec exports: `PlatformGlobalObjectsSchema`, `PlatformGlobalObjects`, `OrgScopingEntitlementSchema`.
- 5619aac: The packaged-permission-set lock now guards the metadata door as well as the data door. The pre-persistence authoring-gate seam gains a `permission` registration (`registerPackagedPermissionSetLockGate`, new export) that consults the same `classifyPackagedPermissionSet` classifier and throws the same `PackagedPermissionSetLockedError` the `sys_permission_set` write door already uses — one spelling of "package-declared", two doors, one refusal.
  
  What stops working, and for whom: an operator using the `OS_METADATA_WRITABLE=permission` escape hatch to save a permission set that an installed package declares now gets `403 NOT_OVERRIDABLE` (the refusal names the sanctioned clone path) instead of silently minting a `sys_metadata` overlay whose grants win at read over the package's declaration. This applies hatch open or closed, draft and publish saves alike, and also means stored-overlay maintenance passes (e.g. stored-item migration) report a per-row refusal for such grandfathered forks rather than rewriting them.
  
  What keeps working unchanged: hatch writes to any name no installed package declares — the hatch's documented per-org/env override capability — land exactly as before, and package-door authoring of workspace-owned sets (definitions living in `sys_metadata`; ADR-0070, ADR-0094 D5-R) stays editable. Package publishes travel the `package-author` channel, which this seam exempts by contract.
- db39dfc: feat(plugin-security): the verified platform OWNER bypasses the Layer 0 org wall (#12974)
  
  Maintainer ruling 2026-08-29, verbatim and untranslated: 「能不能简单点，对于超级管理员，
  配置了环境变量邮箱的，在执行墙的时候不要强制加上 org_id 的过滤」
  
  When plugin-security arms the Layer 0 organization wall on a READ, the
  `org_id` tenant filter is no longer appended for a session whose account is
  the **verified platform owner** — the `OS_PLATFORM_OWNER_EMAIL` identity,
  matched under the existing #11343 verified-email predicate (the SAME
  comparison the platform-admin elevation gate makes, now shared through
  `platform-owner-wall-bypass.ts`; server-side `sys_user` row facts only, never
  a client-supplied claim). This unblocks the one account meant to be
  all-seeing: metadata-driven operator screens over PUBLIC tenant objects no
  longer read EMPTY for the deployment's declared owner (the cloud#1676 shape).
  
  The door is READ-only. WRITES keep today's behaviour for everyone INCLUDING
  the owner: an org-less tenant-scoped write is still refused 403 naming the
  missing active organization (ADR-0123 D2 — an org-less write would mint
  exactly the NULL-organization rows the platform is eliminating), and the
  by-id write pre-image read stays walled with it.
  
  Fail-closed in every direction, pinned: env unset ⇒ nobody bypasses (the wall
  arms exactly as before, with no row I/O); email mismatch ⇒ walled; email
  matches but the account is NOT verified ⇒ walled; only a verified match lifts
  the read filter. The bypass lifts ONLY Layer 0 — object/field permissions,
  business RLS (Layer 1) and the write `check` path are untouched — and the
  door serves the single env-declared owner (no lists, no patterns). Every
  wall-bypassing read computation emits a structured warn-level audit event
  with the stable name `platform_owner_wall_bypass` (object, operation, userId,
  suppressed filter).
- 7286dd5: Fix: the platform-admin promotion targets the oldest human that can SIGN IN, not the oldest `sys_user` row
  
  Under the `single` posture the first-boot promotion ranked candidates by age
  alone, and "human" was its only filter. On an app that declares people in
  `defineStack({ data })` that picked the wrong row every time: a declared person
  is a credential-less directory row, the declarative seed is awaited inside
  `AppPlugin.start()` (kernel Phase 2), so those rows are always older than any
  account created at `kernel:ready` or later.
  
  Measured on a driven composed boot, not inferred: `admin_full_access` was
  granted to `person0@demo.example` — a row with no `sys_account`, on a database
  whose `sys_account` table was entirely empty — and `claimSeedOwnership` handed
  that same unusable row both seeded business records. A real sign-up arriving
  afterwards was never promoted, because the promotion had already short-circuited
  on "an admin exists". The grant was written, unexercisable, and permanent.
  
  The target is now the oldest human holding a `sys_account`. Any provider counts:
  a federated or SSO account is a login, and narrowing to `credential` would
  recreate this defect for SSO-only deployments. When human rows exist but none can
  authenticate, nobody is promoted and no grant row is written — an `info` line
  says so, and the bootstrap replay now also fires on `sys_account` inserts, so the
  first real login is promoted the moment it exists. That second half is
  load-bearing rather than incidental: a sign-up writes its `sys_user` row before
  its `sys_account` row, so the pre-existing `sys_user` trigger fires while the
  registrant still has no login.
  
  Deployments that already carry a platform-admin grant are untouched. The
  "an admin already exists" short-circuit runs before any target selection, so this
  changes which row a FRESH bootstrap promotes and nothing else — moving an
  already-granted platform admin is not this change's to make.
- f4e741b: feat(security): the referential FK-clear write is exempt from the object-level CRUD check (#12597)
  
  **This changes which deletes succeed** — an observable behavioural contract
  change on the delete path, which is why it ships `minor` rather than as a
  patch-grade defect repair.
  
  Deleting a record makes the engine clear every optional lookup that points at it
  (`deleteBehavior: 'set_null'`). That cleanup `UPDATE` is engine-owned referential
  integrity, and it has carried the server-derived `__referentialFieldClear` marker
  since #3023 — but the marker reached only the ownership-anchor guard, so the
  write still had to pass the **object-level CRUD check** on the referencing
  object. Consequence, measured on a real deployment across 17 role×object pairs: a
  role with full delete rights on A and no grant at all on B could delete an A only
  while B was **empty**. The moment a real row referenced it, the delete failed with
  one generic "you do not have permission", and nothing on any permission screen
  showed that deleting A also required write authority on B.
  
  **What is exempt: the object-level CRUD grant check, and nothing else.** A marked
  `update` skips that one gate (both the caller's grant and the ADR-0090 D10
  delegator half of the same question). Everything else in the security middleware
  runs unchanged and is pinned test-by-test:
  
  - field-level security on the FK column still refuses;
  - the RLS `using` row scope on the referencing object still refuses;
  - the RLS post-image `check` still refuses — so a deployment declaring
    `product != null` keeps getting a truthful refusal instead of a silent clear;
  - declared validation rules keep firing (they were never in this path);
  - a caller without delete rights on the target is still refused;
  - an ordinary, unmarked update on the referencing object is untouched.
  
  ⛔ Deliberately **not** `isSystem`: that bypass is total (see
  `content/docs/permissions/system-context.mdx` — "Elevation is total, and it is not
  granular"), and it would have switched off all three guards above. ⛔ The
  `cascade` arm — deleting whole referencing rows — is **unchanged** and still
  requires the caller's own delete authority on those rows.
  
  The write is not elevated at all, so audit attribution is unchanged: the cleanup
  `UPDATE` still runs under the operator's identity and lands in the ledger as that
  operator (`user_id` / `actor`, and the `updated_by` stamp).
  
  No authorable surface changes, and no metadata needs migrating: a deployment that
  was working around this by granting write access on referencing tables can narrow
  those grants, but nothing forces it to.
- 4d25d22: **BREAKING (platform object removed):** the `sys_scim_provider` platform object is retired (#11757, ruled on #11693 — leg 1a of the #11632 SCIM epic).
  
  FROM → TO, per surface:
  
  - `SysScimProvider` (export of `@objectstack/platform-objects` / `.../identity`) → removed, no replacement export. Fix: delete the import. Stable SCIM state lives on the seven `sys_scim_*` stable-model objects (#3653), and connection credentials on `sys_scim_connection_credential`.
  - `sys_scim_provider` in `PLATFORM_PROVIDED_OBJECT_NAMES` (`@objectstack/spec/system`) → removed. `isPlatformProvidedObjectName('sys_scim_provider')` is now `false`, so a stack referencing the name is flagged as a probable typo instead of resolving.
  - plugin-auth: the object is no longer provisioned, and `AUTH_MODEL_TO_PROTOCOL` carries no `scimProvider` entry — the installed stable `@better-auth/scim@1.7.1` derives no such model, so the entry bridged nothing.
  - plugin-security: the `BETTER_AUTH_MANAGED_OBJECTS` write-deny entry for it is gone with the object (the list is pinned bidirectionally against `managedBy: 'better-auth'` declarations).
  
  The rc.1-era row was written only by the retired `/scim/generate-token` endpoint; after the stable-1.7.1 migration (PR #12726) nothing could write to it. Per the maintainer's ruling (2026-08-24, 「不需要考虑历史数据」; reaffirmed 2026-08-25 — SCIM has no real customers), **no data migration ships**: existing `sys_scim_provider` tables in deployed databases are left untouched — no backfill, no reaper, no migrate command. SCIM-enabled deployments re-register connections on the stable surface; the IdP token reissue is a migration-day operator action regardless of this change.
  
  The ADR-0066 D3 capability-gate pin moves from the retired object to its surviving sibling `sys_sso_provider`, so the gate posture stays test-pinned.
  
  Breaking ships as `minor` per the launch-window convention (`scripts/check-changeset-no-major.mjs`) and the #12726 precedent on the same ruling.
  
  <!-- adr-0087: registered scim-provider-object-retired -->
- 366f895: feat(auth): migrate `@better-auth/scim` from `1.7.0-rc.1` to stable `1.7.1` — the whole-model SCIM migration (#3653, epic #11632)
  
  The stable line is the rc.2-lineage rewrite: the rc.1 `scimProvider` model,
  `/scim/generate-token` endpoint and `storeSCIMToken` option no longer exist,
  replaced by seven new models and a three-way connection contract. This lands
  the migration atomically:
  
  - **Seven new platform objects** back the stable models —
    `sys_scim_connection_binding`, `sys_scim_group`, `sys_scim_group_member`,
    `sys_scim_identity_tombstone`, `sys_scim_projection_grant`,
    `sys_scim_subject`, `sys_scim_user` — bridged via `AUTH_MODEL_TO_PROTOCOL`,
    registered in the platform-object-names registry, listed in
    `BETTER_AUTH_MANAGED_OBJECTS`, and column-pinned by the parity gate (whose
    `KNOWN_UNMAPPED_MODELS` shrinks to the empty set: the rc.1-era group
    provisioning gap — IdP `/Groups` pushes hitting tables that did not exist —
    is closed).
  - **SCIM connections stay runtime data.** The stable constructor is satisfied
    with an application-owned `authentication.verifyBearerToken` that resolves
    the connection from a row at request time — not static boot config, and not
    the upstream `managedConnections` catalog (deliberately not adopted).
  - **ObjectStack owns SCIM credentials outright** (stable upstream stores no
    credential at all): `sys_scim_connection_credential` plus
    `scim-connection-service.ts` mint/digest/verify. At rest only an
    HMAC-SHA-256 keyed by the deployment auth secret (base64url,
    domain-separated) is stored — at parity or better than the rc.1 unsalted
    SHA-256 — pinned by `credential-at-rest-posture.test.ts` including live
    401 paths for forged, revoked and expired bearers.
  - **The ObjectQL better-auth adapter gains native transactions**
    (`engine.transaction`, fail-closed on drivers without `beginTransaction`),
    which stable scim requires by assertion for atomic provisioning writes.
  - **Scaffold suppression retired**: the `@better-auth/scim>better-call`
    `allowedVersions` entry (CLI renderer + blank template) is gone — stable
    1.7.1 peers `better-call@1.4.0` exactly — and its presence ratchets flipped
    to absence pins. The `better-auth>better-sqlite3` and four
    `@better-auth/utils` entries stay; their retirement conditions are separate
    and unmet.
  - The pin resolves **1.7.1 exactly** (not `^1.7.1`): 1.7.2 peers
    `better-auth`/`@better-auth/core` at `^1.7.2`, which only the workspace
    overrides' silencing would "satisfy" while the family is 1.7.1. Floating is
    its own follow-up.
  
  **Semver: minor, argued.** The rc.1 SCIM surface this replaces (generate-token
  endpoint, rc.1 bearer tokens, `sys_scim_provider` rows) changes incompatibly —
  but that surface is default-off (`OS_SCIM_ENABLED`), was shipped with a
  documented "do not let the IdP push groups" boundary, and the maintainer ruled
  (2026-08-25) that SCIM has no real customers and old data need not carry: the
  one binding constraint is that an existing system upgrades smoothly, which it
  does — every table the installed library can write exists at this version, and
  SCIM-disabled deployments see no behavior change. A major would move the whole
  fixed version group for a feature surface with zero consumers. Deployments
  that had SCIM enabled must mint new connection credentials (digests are not
  portable from rc.1 on any path — IdP token reissue is a migration-day
  operator action regardless of semver level). `sys_scim_provider` itself is
  NOT removed here; its retirement is tracked separately (#11757).
- 18b53ac: `SecurityPlugin`'s own report sink is now **console-backed by default** — loud until a host
  injects one — instead of being initialised to an empty object. Its fail-closed refusals
  (`getReadFilter … denying (fail-closed, #2852)` and `#4467`, `checkAuthoredRowWrite …
  abstaining`, the ADR-0123 tenant-wall refusal) previously went nowhere at all on any instance
  whose lifecycle had not yet reached the sink binding; they now reach `console.warn` /
  `console.error`. A host that injects a logger is unaffected: `start()` assigns `ctx.logger`
  over the default, above both of its early bail-outs (#10706), so a degraded boot still reports
  through the host.
  
  **Operator-visible:** a deployment that never injects a sink will begin seeing these refusals
  on the console. That is the intended change — the refusal itself is not moving, only whether
  anyone can see it.
  
  Why `minor` and not `patch`: the observable output of a running deployment changes. The
  declared shape changes with it — the field's `warn` channel is now non-optional, which is what
  #9754 requires of a sink declaring an optional `error`, and what a default of `{}` made
  impossible to state honestly. `error` deliberately stays optional (#9754 option C, falsified:
  hosts do inject reduced sinks). The maintainer ruled on 2026-08-24 (#10556) that the default
  becomes console-backed and that silent-by-declaration is rejected.
- ebb0822: feat(plugin-security): a rank-and-file member may edit their OWN `sys_user` row (#14959)
  
  Maintainer ruling 2026-09-03, decision batch #22, quoted verbatim and
  untranslated as adopted:
  
  > 「同意」
  
  The ruling that admitted `locale` to the ADR-0092 D2 column whitelist (#14787 /
  PR #14958) opened **which columns** a permitted actor may touch. It did not open
  **who**, and ADR-0092 D5 kept that with the permission layer, where
  `member_default` still denied `allowEdit` on `sys_user`. The measured
  consequence: a member's `PATCH /api/v1/data/sys_user/<self>` was refused by the
  object gate *before* the column guard was ever consulted, so `sys_user.locale`
  shipped as a user-stated preference only a platform administrator could set —
  with objectui#7501's "my language" form item waiting on a route that did not
  exist, and #14788 having already ruled the stored value outranks
  `Accept-Language` *because it is the user's own choice*.
  
  This opens the route, on the two axes that already existed and in the shape
  `sys_api_key` has shipped since #8053:
  
  - **Which rows** — `member_default` gains an explicit `sys_user` entry
    (`allowRead`/`allowEdit` true, create/delete **false**), and its
    `sys_user_self` RLS carve-out (`id == current_user.id`) widens from `select`
    to `all` so it reaches the by-id write pre-image check. `sys_user_org_members`
    — the org-peer *visibility* policy — deliberately stays `select`-only:
    policies OR-combine, so widening it would have composed
    `id == me OR id IN <every user in my org>` and handed every member their
    colleagues' profile rows.
  - **Which columns** — unchanged. ADR-0092 D2's identity write guard still bounds
    a user-context update to `SYS_USER_PROFILE_EDIT_FIELDS`
    (`name`, `image`, `locale`); `email`, `role`, the ban columns and every system
    stamp stay unwritable on this path.
  
  `allowCreate` / `allowDelete` stay false: accounts are minted and retired
  through better-auth's own endpoints, and this set is bound to the `everyone`
  anchor, which must remain anchor-safe (ADR-0090 D5).
  
  **ADR-0092 D5 is amended** by the same ruling — self-service edits of the
  whitelisted columns route through the generic data path, with the D6
  `afterUpdate` hook as the session-cache refresh. `name` / `image` therefore
  become editable there too, not only through better-auth `/update-user`. The
  amendment ships as its own PR (`docs/adr/**` is governed and merged by hand).
  
  Rejected in the same ruling, recorded so they are not re-proposed: a dedicated
  endpoint writing under system context (the "second stamping route" #14787's own
  ruling rejected, one level up); leaving the column admin-only (a user-facing
  setting only an administrator can set — ADR-0049's declared-not-reachable shape,
  one step removed); and making `locale` a better-auth `additionalFields` entry
  (#13881 measured that it breaks `getSession` on any environment that has not run
  schema-sync).
  
  The pins are layer-attributed on purpose. Each of the four cases the ruling names
  records *which* of the three layers produced its answer — object gate, row scope,
  or identity guard — because before this change all four were refused by the
  object gate, so "another member's row is refused" and "a non-whitelisted column
  is refused by the guard" were both green while neither mechanism had run. A
  two-leg ablation confirms it: reverting the permission-set entry drops the
  non-whitelisted-column refusal from `identity-guard` to `object-gate`, and
  reverting only the RLS widening drops it to `row-scope`.
- b997272: feat(plugin-security): walled bootstrap stops minting the platform-admin grant row; read-only `platformAdmin` audit service; legacy-grant deprecation pointer (#11974, #11663 L4)
  
  Under **walled postures** (`group` / `isolated`), `bootstrapPlatformAdmin` no
  longer writes the org-less `sys_user_permission_set` row pointing at
  `admin_full_access`. Platform-admin standing on those deployments is
  **config-derived** at the one derivation site (`resolve-authz-context.ts`
  §6b-config, landed with #11663 L2): every account whose stored `sys_user` row
  holds a declared `OS_PLATFORM_OWNER_EMAIL` address and reads VERIFIED resolves
  `PLATFORM_ADMIN` at request time — nothing to mint, nothing to revoke, no
  window in which a row grants standing that policy would refuse. The `single`
  posture keeps first-user promotion and its grant row byte-for-byte (#11663
  Choice 4A; 4B is the sequenced follow-up).
  
  What the walled bootstrap still does:
  
  - **Reports standing** — one info line per boot listing, per declared
    address: registered? verified? which account holds standing. The same
    implementation serves the new read-only **`platformAdmin` service**
    (`configuredEmails()` + `standing()`, registered by SecurityPlugin), so the
    log and the audit surface can never disagree. The service is frozen and has
    no writable member — there is deliberately no runtime path that changes who
    a platform administrator is (#11663 Choice 3A).
  - **Points legacy grants at the config path** — a detected legacy org-less
    human grant logs exactly one deprecation line per process (shared latch
    with the derivation-site reporter) naming `OS_PLATFORM_OWNER_EMAIL`, the
    holder and the config line that re-anchors them. Nothing is revoked: the
    legacy row still confers during the loud, time-boxed migration window
    (#11663 P5).
  
  The bootstrap-replay trigger (`shouldReplayBootstrapFor`) narrows with the
  retired elevation: it now fires only for `sys_user` insert/create under
  non-walled postures (the `single` first-user promotion). The #11343 update arm
  (`email_verified` / `email`) existed solely to re-attempt the walled elevation
  after the owner's verifying write; with standing derived at request time there
  is nothing to re-attempt, and under walled postures no `sys_user` write can
  change the bootstrap's answer at all.
  
  Walled bootstrap outcomes: a declared usable config now answers
  `reason: 'walled_config_derived'` (replacing `walled_owner_not_registered` /
  `walled_owner_not_verified`, whose distinctions moved into the standing
  report); `walled_owner_email_undeclared` stays for the unset/blank/refused
  backstop (Choice 2B: one unparseable entry fails the whole variable closed).
- 9735662: fix(security): walled postures elevate only the env-declared platform owner, never the first registrant (#11184, the framework leg of cloud#1509)
  
  **BREAKING** for walled deployments (`OS_TENANCY_POSTURE=group` or
  `isolated`), shipped as `minor` under the repo's launch-window convention for
  breaking changes. Single-org deployments are byte-for-byte unchanged.
  
  Measured defect (cloud#1509): on a walled multi-tenant SaaS with
  `OS_TENANCY_POSTURE=isolated` and `OS_AUTH_MEMBERSHIP_POLICY=invite-only`, the
  FIRST self-registrant received the cross-tenant `admin_full_access` grant
  (`platform_admin`, `isPlatformAdmin: true`) and — because the default-org
  bootstrap binds "the platform admin" — was merged into the deployment's
  Default Organization as its owner. Whoever curls the public sign-up endpoint
  first owned the platform.
  
  Per the maintainer ruling of 2026-08-23 (verbatim:
  「1509 选择 env 指定 owner 邮箱」):
  
  - **Walled postures: platform admin comes ONLY from the env-declared owner.**
    `bootstrapPlatformAdmin` (plugin-security) no longer promotes the oldest
    human user when the requested posture is walled; it promotes exactly the
    account whose email matches the new `OS_PLATFORM_OWNER_EMAIL` variable
    (case-insensitive, matched whenever that account registers — arrival order
    is irrelevant). Self-registrants are never promoted and, since the shared
    `ensureDefaultOrganization` helper binds only the platform admin, are never
    auto-merged into the Default Organization either.
  - **Fail-closed startup refusal.** A walled posture with no
    `OS_PLATFORM_OWNER_EMAIL` declared refuses to boot from `AuthPlugin.init()`
    with a message naming the variable — never a silent fallback to
    first-registrant elevation. The elevation site itself also refuses
    (`reason: 'walled_owner_email_undeclared'`, logged at `error`) as
    defense-in-depth for compositions that reach the bootstrap without
    plugin-auth (`os meta resync`, bare embeddings).
  - **Single-org posture unchanged.** "First user is owner" stays as ruled
    reasonable there; the new variable is never consulted under `single`.
  - The requested posture (`resolveTenancyPosture()`) is deliberately the input,
    so a walled-requested deployment running degraded
    (`OS_ALLOW_DEGRADED_TENANCY=1`) still refuses first-registrant elevation.
  
  Operator action for walled deployments: set `OS_PLATFORM_OWNER_EMAIL` to the
  operator account's email address before upgrading. Deployments that already
  hold a human platform admin are untouched (the bootstrap remains a no-op once
  any human holds the cross-tenant grant); the variable governs installs that
  have not yet minted their admin. `@objectstack/types` gains the
  `resolvePlatformOwnerEmail()` resolver and the `PLATFORM_OWNER_EMAIL_ENV`
  constant; the verify harness declares the owner email (defaulting to its dev
  admin) for walled fixtures.
  
  <!-- adr-0087: not-required (no-migration-prescription) nothing authorable is removed, renamed or narrowed: no spec key, no metadata spelling and no stored row changes shape, so there is nothing for `os migrate meta` to rewrite and no ledger entry to make. The prescription above is a deployment-environment requirement (declare an env var before boot), which the ADR-0087 ledger does not carry — the refusal itself names the variable at startup. -->

### Patch Changes

- 0e4e51b: feat(spec): `ActionParamSchema.carryOver` — the declared carry-over param: seeded from the row, rendered as a non-editable summary, submitted verbatim (#11753 ruling, spec half; #11992)
  
  <!-- adr-0087: not-required (accept-set expansion) One new CLOSED optional key
  on an existing shape; nothing authorable is renamed, retired or tombstoned, so
  there is no conversion to register. Previously-refused spellings stay refused —
  `readonly` and `disabled` now carry alias guidance pointing at the new key. -->
  
  The maintainer's 2026-08-25 ruling on #11753 (recommendation A) declares ONE
  carry-over contract instead of a rendering convention: a param may state, in
  metadata, that its value is carried through the action dialog rather than
  collected from the user.
  
  - `carryOver: true` — seed from the current row (`defaultFromRow: true` is
    required alongside, enforced at parse time), render as a NON-EDITABLE
    summary, submit VERBATIM. Unlike `visible: false` — the measured non-answer,
    which omits the param from the submission entirely — a carry-over param is
    always sent.
  - Aliases: `readonly` / `disabled` are refused with guidance naming
    `carryOver` (a field's `readonly` means write-path strip, which is exactly
    the wrong half here).
  - Exemplar (`@objectstack/plugin-security`): the five `clone_permission_set`
    JSON facet params (`object_permissions`, `field_permissions`,
    `system_permissions`, `row_level_security`, `tab_permissions`) declare it,
    so the sanctioned clone path stops offering five prefilled raw-JSON
    textareas an admin could hand-mangle into a clone that grants MORE than its
    base. `description` stays an ordinary editable param. The send-side contract
    is unchanged (#11703 pin 6 stays green).
  
  The objectui renderer leg (honouring the declaration in `ActionParamDialog`)
  is the downstream card tracked on #11753.
- 4bd6faa: feat(engine,core,cluster): the authorization-cache invalidation substrate — an engine-seam write epoch, the `authz.invalidated` channel, and a non-optional boot-time posture statement (#11968)
  
  The substrate step (§10.3) of the accepted #11633 cross-request caching design
  (maintainer acceptance 2026-08-25, Fork 2 → B). It ships the invalidation
  machinery once, before the grants cache (#11967) that will consume it, so that
  leg does not carry it. **Nothing here caches anything.**
  
  - **`ObjectQL.writeEpoch`** — a monotonic counter advanced by the engine
    middleware seam on every `insert` / `update` / `delete`, ahead of the whole
    chain (and so ahead of any `isSystem` bypass a middleware applies). It
    generalises the private counter `@objectstack/plugin-security` has carried
    since #10757: the mechanism was always the engine's, and hoisting it lets a
    second consumer share **one** signal instead of minting a parallel one that
    watches a different set of writes. A seam rather than a list of call sites,
    because a forgotten call site fails as silent over-permission and writing
    through the engine is the only way to write at all — including better-auth's
    own adapter.
  - **`authz.invalidated`** — one new channel on the existing `IPubSub`, bridged
    in the shape `MetadataClusterBridgePlugin` already uses. ⭐ **The TTL a
    consuming cache carries is the correctness contract; this channel is not.** No
    shipped driver delivers better than at-most-once (`cluster.mdx` §4.2), so a
    missed message is *expected*, the bridge stays out of the write path (a
    publish failure is logged and swallowed, never awaited by the writer), and the
    channel only moves the *typical* convergence from one TTL to one network hop.
    That statement lives in the code at the channel, where a consumer reads it.
  - **The boot-time posture statement** — non-optional by the ruling. Whenever a
    grants cache is enabled (`OS_AUTHZ_GRANTS_CACHE_TTL_MS` > 0) and there is no
    cross-node invalidation bus, the deployment is told so at `warn`, every boot,
    naming the window it accepted and the remedy. It is a statement, not a
    refusal: a TTL-bounded per-process cache is a legitimate configuration. It is
    said out loud because a silently-absent invalidation bridge is how a security
    control gets disabled with nobody noticing (#4785). The in-process `memory`
    driver counts as **no** bus — a cluster service exists on the shipped default
    while fanning out to nobody, which is the case a "is a cluster service
    registered?" check answers `yes` to and is wrong about.
  
  **Runtime behaviour is unchanged.** With no cache consumer the epoch has zero
  subscribers, so nothing is published and nothing is invalidated; with the
  shipped default TTL of `0` the bridge attaches nothing and logs nothing above
  `debug`. The one composition change worth naming: `Runtime` now registers
  `AuthzClusterBridgePlugin` **unconditionally**, including under `cluster: false`
  — that is not an oversight, it is the loudest case the posture check has, and
  skipping it there would put the statement's absence exactly where the missing
  bus is.
  
  `@objectstack/plugin-security` is a `patch`: its permission-set memo now reads
  the engine's epoch when the wired engine exposes one and keeps its private
  counter otherwise (test doubles, embeddings). The covered set of writes is
  identical — the plugin's own middleware was already global — and it is now
  identical *by construction* rather than by two files agreeing on which
  operations count.
- 86cbe37: feat(core): cross-request authorization grants cache — leg B of #11633 (#11971)
  
  `resolveUserAuthzGrants` can now cache its resolved envelope across requests,
  governed by `OS_AUTHZ_GRANTS_CACHE_TTL_MS`. **The default is `0` — the cache is
  OFF and the shipped behaviour is unchanged** (Fork 4 of the accepted #11633
  design): a deployment that enables it accepts the configured staleness window
  explicitly, and the boot-time posture statement says so out loud when no
  cross-node invalidation bus is attached.
  
  With the cache on:
  
  - **Coarse write-invalidation (Fork 1A).** Any engine write to a watched
    authorization object (`sys_member`, `sys_user_position`,
    `sys_user_permission_set`, `sys_position`, `sys_position_permission_set`,
    `sys_permission_set`, `sys_user`) retires every entry on the writing node —
    a grant/revoke/role change is observed by the very next request there, by
    invalidation and not by TTL. `metadata.changed` and peer-node
    `authz.invalidated` hints retire wholesale via the engine write epoch.
    `sys_session` is deliberately not watched (its once-a-minute
    `last_activity_at` cadence would turn the cache into a non-cache).
  - **Expiry-boundary rule.** Entries expire at `min(ttl, nextBoundary)`, where
    `nextBoundary` is the earliest upcoming ADR-0091 `valid_from`/`valid_until`
    among the rows consulted — a validity window flipping is a permission change
    with no write anywhere, so the timer is the only mechanism for that class.
  - **Ruled bypass list.** The permission explainer
    (`plugin-security` `buildContextForUser`) and `runAs:'user'` automation runs
    (`service-automation`) always resolve fresh, and never populate the cache.
  - The TTL remains the correctness contract; the `authz.invalidated` bus only
    narrows the typical cross-node window (no shipped driver exceeds
    at-most-once delivery).
- c6c895c: **Perf:** the declared-capability boot seed and the environment permission-set overlay reconciler each pay ONE batched existence read instead of one per item, and stop re-writing rows that already match (#11096, #11097).
  
  Both were read-then-write reconcilers over a set known in full before their loop started, and both had the shape #10946 removed from the permission-set and position seeders next door:
  
  - `bootstrapDeclaredCapabilities` issued a `SELECT … WHERE name = ? LIMIT 1` per declared capability, then an `UPDATE` on its own row whether or not anything had changed;
  - `reconcilePermissionSetProjection` projected every environment-scope `permission` overlay in a per-name loop, each iteration issuing its own existence `SELECT` inside `upsertEnvPermissionSet` plus an unconditional `UPDATE`.
  
  On a local file database these loops are invisible. On the remote libsql/Turso database every hosted environment runs, each leg is its own sequential HTTP request, and the capability set is typically the largest of the identity axes — it is the union of every capability every declared package contributes, not a count bounded by the number of permission sets.
  
  Both now hoist one chunked `{ name: { $in: [...] } }` read out of the loop through `buildExistingByName`, which keeps the tri-state judgement that makes hoisting safe: **a read that could not ANSWER is not the answer "none of them exist"**. A batched read fails for the whole set at once, so collapsing those two would make a boot during a brief outage try to re-create everything; the seeders now decline the names they could not read, and say so.
  
  **The write-skip is an equality test, and the reconciliation leg is pinned.** A row whose stored value genuinely differs still gets its `UPDATE` — a reconciler that skipped writes outright would show a perfect round-trip count while silently reconciling nothing, so every counting test added here is paired one-for-one with a drift test over the same fixture, and both pairs were ablated to confirm the drift half fails when the write is removed.
  
  Two behaviour repairs the write-skip REQUIRED, both on the environment door — not optional polish, but corrections the equality test itself demands, verified by ablation (each one made a specific test fail when reverted):
  
  - **`customized` is now compared, not just written.** The flag is provenance rather than definition, so `recordDiffersFromBody` deliberately does not compare it; skipping on the facets alone would have stopped maintaining a flag the Setup list badges on and the reset action reads. It gets its own comparison term, against the same `managed_by:'package'` condition the write uses.
  - **A newly created environment-authored record is no longer born badged "customized".** The INSERT used to stamp the caller's raw overlay opinion (`!!customized`) while the UPDATE branch's rule stamps `false` for a non-package row — those two disagree for any fresh `managed_by:'admin'` row created while its overlay is still active. Before this changeset, that disagreement was invisible: every boot re-wrote every record unconditionally, so the very next reconciliation pass silently overwrote the wrong value back to `false`. Once writes are equality-gated, that disagreement stops being invisible and becomes a REAL, PERMANENT one-boot-late corrective `UPDATE` after every such creation — the "steady state" round-trip count is not actually flat without this fix. Confirmed on this branch: reverting it to `!!customized` fails `#11097 — env overlay reconciliation: round trips > does not grow the steady-state round-trip count` and `#11097 — drift STILL reconciles > only the DRIFTED overlay is written` (both start seeing a real `UPDATE` on the boot immediately after any overlay-backed admin row is created).
  
  `projectPermissionMutation` also syncs the in-memory evaluator registry on an unchanged record, not only on a write. That sync is not a database round trip, and the evaluator resolves permission sets registry-first — gating it on "a write happened" would have left a steady-state boot enforcing the stale declared body while the record and Setup showed the overlay.
  
  ⚠️ **This is a behaviour change beyond the write COUNT**, flagged explicitly: today, a brand-new environment-authored permission set with no package baseline can be observed `customized: true` for the one boot between its creation and the next reconciliation pass (or, on the live write-through door, self-heals within the same request). After this changeset it is never observed `true`. The change is required for the round-trip fix's own steady-state claim to hold on this path — the two are not separable — but it is a resulting-STATE change, not merely a write-count change, and is called out here for that reason.
  
  ⚠️ **No curve number is claimed for either axis.** The hosted `bootstrap-curve.mjs` rig lives in `objectstack-ai/cloud` and neither of these axes has ever been measured on it. What is established is that the code shape is the one measured at slope 4.0000 / R² = 1.000000 on the two sibling loops in #10946, and that the round-trip COUNT is now flat in the number of declared items — which is what the new tests assert, in counts, never in wall time.
- c33f185: Seed the curated platform capabilities with ONE batched existence read, and stop
  rewriting rows that already match
  
  `bootstrapSystemCapabilities` built its whole definition set in memory and then
  issued a separate `SELECT … WHERE name = ? LIMIT 1` per definition, followed by
  an `UPDATE` that fired whether or not `label`/`description` had changed. On a
  local file database that loop is invisible; on the remote libsql/Turso database
  every hosted environment runs, each leg is its own sequential HTTP request,
  competing for the same boot request budget as everything else. On a stock
  installation that is 8 reads plus 8 writes, every `kernel:ready`, to store bytes
  already there.
  
  The curated half's existence read is now one batched `$in`, and the reconcile is
  equality-gated. On a steady-state rebuild the curated half costs **1 round trip**
  instead of 16, and the write gate sits after the derived-ownership guard, so it
  removes the redundant `UPDATE` from **both** halves.
  
  **The #8470 predicate travels inside the batched query, not applied to its
  answer.** The curated half does not ask "is there a row with this name" — it asks
  for the platform's own organization-less row (`managed_by: 'platform'` +
  `organization_id: null`), and since `sys_capability.name` became unique per
  ORGANIZATION those are different questions. Batching the wide question and
  filtering afterwards reads every organization's row for every curated name — a
  set bounded only by the number of organizations — against a page capped at one
  row per name, so the page truncates, and a truncated page reads as "absent",
  which inserts. Both harms are pinned as tests rather than argued: without the
  predicate the shared name resolves to an organization's row, and two curated
  names whose platform rows demonstrably exist come back absent.
  
  **An unreadable database now declines instead of guessing.** Hoisting a read out
  of a loop changes what a failure means: per item a failed read fell through to an
  insert the unique index refused, for that one name; batched, one failure speaks
  for the whole set. `unknown` is therefore never read as "absent" — the affected
  definitions are left entirely alone, counted in the new `unreadable`, and warned
  once. This also retires a misdiagnosis: an unreadable database used to make this
  half attempt an insert per curated name and then report a `blockedCurated`
  collision for each, describing a blocking row nobody ever saw.
  
  `CapabilitySeedResult` gains `unchanged` and `unreadable`. Reporting "wrote
  nothing because nothing differed" separately from "wrote nothing because the
  writes stopped working" is what keeps the round-trip count from being satisfiable
  by an implementation that simply stopped reconciling.
  
  **The derived half keeps its per-item read**, and not because it is the smaller
  one — it is the half that grows. Its lookup is cross-organization by
  construction, and `skippedAuthored` and the `platformStampedInOrg` anomaly signal
  are computed from the lowest-id row installation-wide; narrowing it to the
  platform bucket answers a different question and would silently reverse part of a
  maintainer ruling, while batching it unnarrowed needs an unbounded read. Filed
  rather than taken.
  
  No speedup is claimed. The hosted boot-curve rig lives in another repository and
  its axes are permission sets / positions / objects, not this one. What is
  established here is the round-trip count and the identity of the row each leg
  reads and writes, both pinned in-repo.
- a7a7390: perf(plugin-security): claim seed ownership with a predicate write per object, paged only when the engine refuses it (#14530)
  
  `claimSeedOwnership` — the pass that hands seeded business records to the first
  platform admin — scanned every `owner_id`-declaring object twice at
  `limit: 10_000` and then issued **one single-id `update` per matched id**: up to
  20 000 full engine writes for one object, each paying the whole middleware,
  validation and hook chain. The unit of work is now the **set**, not the row: one
  predicate write per unowned shape (`owner_id IS NULL`, then
  `owner_id = usr_system`), so the matched set is the same set the old two-scan
  rule resolved — row for row — while the write count stops scaling with N. The
  count reported per object is the sum of the affected-row counts those writes
  resolve, never a length this pass counted for itself.
  
  Measured on a real ObjectQL engine (in-memory driver, one sharing-rule-covered
  object, shared box): 2 000 rows 2 122 ms to 208 ms; 5 000 rows 10 658 ms to
  528 ms, with engine `update` calls falling from N to two per object.
  
  The second half is what the batch buys downstream. plugin-sharing's `rule-hooks`
  already routes a write whose row set exceeds `RULE_RECOMPUTE_ROW_CAP` (1 000)
  into one set-based revoke plus one queued `evaluateAllRulesForObject`, but that
  branch reads **one write's** row set, and every write in the old loop
  legitimately carried a single row — so the batch existed only in the caller,
  where nothing downstream could see it. Batching here is what lets machinery
  already built for this shape do its job; `plugin-sharing` is unchanged.
  
  **And a paged fallback, because one write cannot always carry the set.** A
  predicate write carries no `limit`, so the bound becomes the engine's own
  `MAX_BULK_PER_ROW_HOOK_ROWS` (10 000): `beforeUpdate` / `afterUpdate` hooks are
  contracted to fire per matched row on a predicate write (ADR-0058 D6), and every
  object carries such hooks in practice, so the engine refuses an over-sized write
  **whole** — nothing written. Measured: 21 000 unowned rows re-owned **nothing**,
  where the old loop re-owned 10 000 of them. This pass decides `owner_id`, a
  record-access field, so an unclaimed object is a permission outcome and not an
  observability detail. The refusal is now answered by taking one page of ids off
  the top (half the ceiling) and re-attempting the whole set, until one write can
  carry what is left. Re-measured after paging: the same 21 000-row object claims
  **all 21 000**, in 8 engine writes and 3 reads.
  
  The order is not cosmetic. Paging unconditionally measured 13x slower on the
  sizes every real install has — an `id IN (…)` page is a linear scan of the id
  list per row in `InMemoryDriver`, so an always-paged claim is quadratic there
  where the natural predicate is linear (5 000 rows: 528 ms whole-set versus
  5 865 ms always-paged). The page is what the engine's refusal buys, not the
  default.
  
  `patch`: no declared surface moves, no export changes, and the reachable
  population strictly grows.
- 5cb62d8: Make `clone_permission_set` carry the system permissions, row-level security
  and tab permissions it was silently dropping
  
  The Clone action POSTs its `params` values to `/api/v1/data/sys_permission_set`,
  so the params list *is* the payload. It named two of the six definition facets a
  `sys_permission_set` row carries — `object_permissions` and `field_permissions`
  — leaving `system_permissions`, `row_level_security` and `tab_permissions`
  absent from the body. `permissionSetBodyFromRow()` then read each one through
  `parseMaybeJson(undefined, …)` and filled the empty default, so cloning a set
  that grants `setup.access`, or one carrying row-level security policies,
  produced a clone with none of them: record created, success toast fired, and the
  missing half discoverable only by diffing the two records.
  
  The three now travel, in the same JSON-string shape the two listed columns
  already used. Nothing about what the door ACCEPTS changed — `permissionSetBodyFromRow()`
  already read all six columns; what changed is what the action SENDS.
  
  This became urgent one commit ago. The save door now refuses an in-place edit of
  a package-declared permission set **and its refusal message tells the admin to
  clone**, which made this action the platform's own recommended remedy while it
  was still dropping three facets — an admin following that instruction lost
  grants quietly. The failure direction was fail-closed (fewer grants), which is
  why it was quiet.
  
  `admin_scope` is **deliberately not copied** (maintainer ruling 2026-08-24).
  Putting an ADR-0090 D12 delegated-admin authority onto a brand-new
  organization-owned set on the admin's behalf is a privilege decision, not a
  field copy. The Clone dialog now says so in its description, so the omission
  reads to the admin as a decision rather than as the same silent drop — grant a
  scope deliberately on the new set if it needs one.
  
  Pinned by `packaged-permission-set-lock.test.ts` pin 6, which assembles the
  clone payload by READING the action's params list rather than restating it, and
  asserts each facet by identity against a non-empty value — the empty default
  (`[]` / `{}`) is exactly what a "present" assertion would have accepted. Its
  control proves the exclusion is live: the base fixture carries a real
  `admin_scope`, and the clone still has none.
- 1a68552: perf(security): batch the derived half of `bootstrapSystemCapabilities`, unnarrowed (#11520)
  
  `bootstrapSystemCapabilities` reconciles two halves. #11451 batched the CURATED
  half into one `$in` read carrying the #8470 predicate and left the DERIVED
  half — the union of every `systemPermissions` string that nothing declares —
  reading one row at a time, so a rebuild cost `1 + derived` round trips.
  
  That residue was filed rather than fixed for a reason that has since expired.
  Two objections stood: narrowing the derived read to the platform bucket answers
  a different question and reverses ruled ground, and batching it *unnarrowed*
  needed an unbounded read. #11518 removed the second one — `readNamePage` now
  asks for one row more than its page budget and reports the overflow as
  `truncated` = "could not answer", degrading loudly to the per-item read — so
  the wide batched read became bounded without becoming a different question.
  
  The derived half now consults its own `buildExistingByName` index, built with
  **no predicate**: the read emits `{ name: { $in: … } }` under `seedCtx()`
  (`{ isSystem: true }`, the same context the per-item read used), and unscoped
  `resolveOwnOrganizationRow` returns the FIRST row with no bucket filter — so
  the index resolves to the same lowest-`id` row installation-wide that
  `tryFind(…, 1)[0]` returned under #4363's `ORDER BY id ASC`. A steady-state
  rebuild costs 2 reads at every derived size instead of `1 + derived`.
  
  ⛔ The first objection still stands and is now pinned rather than only
  documented: the derived read is **not** narrowed to `organization_id: null`.
  Doing so would silence #8751's `platformStampedInOrg` anomaly signal in exactly
  the case its doc says it is counted for, and would seed the platform bucket in
  the case #8552 ruled must be left alone. A new test asserts the derived read's
  key set is `name` and nothing else.
  
  One behaviour change, in the direction #10946 chose deliberately for the
  curated half: a derived name whose existence read **cannot answer** is now
  DECLINED (counted in `unreadable`) instead of being read as absent. The old
  `tryFind` swallowed a failed read into `[]`, which routed the name to its
  insert branch — a duplicate placeholder wherever the read failed but the write
  did not, refused only where the unique index happens to exist, and silent
  either way because the `blockedCurated` diagnostic is curated-only. The
  `unreadable` counter and its summary warning now cover both halves; the warning
  reports the whole definition set as its total rather than the curated count.
- 01da105: fix(plugin-security): `explain` now reports a fail-closed RLS denial as `denies` with `allowed: false` (#13639)
  
  **A wrong answer is corrected — read this if you consume `explain`.** For one
  class of request, `explain` previously answered `decision.allowed: true` about a
  request that is guaranteed to return zero rows. It now answers `false`.
  
  **The class.** When applicable RLS policies exist but none can be compiled
  against the current execution context — typically a required `current_user.*`
  variable resolving to nothing, e.g. a caller with no active organization — the
  compiler fails **closed** and composes plugin-security's `RLS_DENY_FILTER`
  (`{ id: '__rls_deny__:…' }`), a predicate no record can satisfy. Enforcement
  was always correct: the caller saw zero rows.
  
  `explain`, however, recognised only its own `__deny_all__` sentinel, so it
  reported that composition with layer verdict **`narrows`** and
  `decision.allowed: **true**`. That is the diagnostic tool giving an
  affirmatively wrong answer to the operator asking why a user sees nothing —
  every available signal pointing away from the cause.
  
  **What changed.** Deny recognition is now value-agnostic and routed through one
  named predicate, so both the object-level `rls` verdict and the record-grained
  layer attribution recognise either sentinel:
  
  - the `rls` layer verdict flips `narrows` → `denies`, with the matching detail;
  - `decision.allowed` flips `true` → `false` for this class;
  - the record-grained `tenant_isolation` and `rls` layers report the fail-closed
    prose instead of "record does not match" prose.
  
  ⭐ **Deliberately NOT changed — no payload moves.** `readFilter` (and a layer's
  `rowFilter`) keeps reporting the predicate that was **actually composed**: a
  deployment that receives `{ id: '__rls_deny__:…' }` today keeps receiving it
  byte-for-byte. The documented `__deny_all__` collapse still fires for
  `__deny_all__` alone, and the two sentinels are **not** merged. Rewriting the
  published payload, and unifying the sentinel vocabulary, are recorded on #13639
  as separate deployment-facing decisions.
  
  **Record-level correctness did not move**, only its prose: the record-grained
  `outcome`, `matchesRecord` and rule `effect` were already right, because the
  sentinel excludes every real record on its own.
  
  **If you assert on `explain` output**, expectations that encoded the old answer
  for a fail-closed RLS denial — verdict `narrows`, or `allowed: true` — now fail,
  and they were asserting the defect. Enforcement behaviour is unchanged in every
  respect; `explain` is a diagnostic surface and no enforcement path reads its
  verdict.
- c61ad20: fix(plugin-security): fail CLOSED on a non-object row in the platform-admin promotion predicate (#12515)
  
  `bootstrapPlatformAdmin`'s local `isHumanUser` decided "is this `sys_user` row a
  HUMAN?" with a bare truthiness check followed by two property comparisons:
  
  ```ts
  const isHumanUser = (u: any) => u && u.id !== SystemUserId.SYSTEM && u.role !== 'system';
  ```
  
  On a truthy NON-object input (`'usr_alice'`, a number, `true`) both comparisons
  read `undefined` and therefore both pass, so the input scored **human**. The
  same question's consolidated owner — `isHumanUserRow` in `@objectstack/plugin-auth`
  — requires `typeof row === 'object'` and answers **non-human** for those inputs.
  Two owners of one question, disagreeing, and the disagreement fell the wrong way
  on the security-critical side: this is the copy that performs the
  **platform-admin promotion**, so it failed OPEN. Its worst shape is the system
  account's own id arriving as a bare string, which the old spelling would have
  promoted.
  
  The predicate now mirrors `isHumanUserRow` — the same `typeof` guard, and a real
  boolean return instead of echoing a falsy input back:
  
  ```ts
  const isHumanUser = (u: any) =>
    !!u && typeof u === 'object' && u.id !== SystemUserId.SYSTEM && u.role !== 'system';
  ```
  
  **Why mirroring rather than a stricter rule of its own.** Over-tightening this
  predicate has a worse failure mode than the bug: an install that cannot promote
  its first admin is locked out of itself. The guard was therefore measured before
  it was chosen, not after. Against a real `SqlDriver` over the shipped `SysUser`
  declaration, every row a real `sys_user` read yields is a plain object — zero
  truthy non-objects, and zero rows whose verdict moves when the guard is added.
  The mirrored guard is also already the incumbent on this exact population:
  `plugin-auth`'s dev-admin seed filters the byte-identical read (`sys_user`,
  `where: {}`, `limit: 50`, system context) through `isHumanUserRow` today.
  
  **No reachable behaviour changes.** The divergence is unreachable through any
  live call site, so this ships as a hardening of malformed-input handling rather
  than a behavioural fix. The 14 existing agreement cases in the cross-package
  pin are byte-for-byte unmoved; the pin gains the non-object class it previously
  had to exclude (it would have failed), which is what now stops the asymmetry
  returning — consolidating the two copies into a shared package stays declined,
  so nothing else was going to retire it.
- 30928a6: fix(i18n): read the provenance companion at serving time, not only record it (#12642)
  
  Maintainer ruling #12069 Option A (#11671) landed translation provenance as
  **two** halves: `os i18n extract --source-hashes` RECORDS which source revision
  a generated leaf is still a byte copy of, and `withSourceFallback` READS those
  records at serving time and substitutes the current source for a leaf whose
  source has moved underneath it. The recording half was then rolled out to every
  bundle set. The reading half was not — measured on `main`: provenance
  **recorded in 9 of 9** bundle sets and **read at serving time in 1**.
  
  The other eight assembled their `TranslationBundle` straight from the raw
  generated modules and never consulted the companion sitting beside them, so
  they recorded the drift and went on serving the superseded draft. Nothing said
  so: `check:i18n` compares key sets and they still matched, `check:i18n-coverage`
  counts a present leaf as translated, and `check:i18n-stale-fill`'s cross-locale
  rule needs a SECOND locale holding the same stale bytes before it can testify.
  The measured case had one locale and no second witness.
  
  All eight are wired here, in the shape `@objectstack/platform-objects`'s own
  `metadata-translations/index.ts` uses — the committed
  `<locale>.source-hashes.generated.ts` passed as the fourth argument, the third
  left `undefined` because these sets have no hand-authored sections. Provenance
  is now recorded in 9 of 9 sets and served in 9 of 9.
  
  `@objectstack/plugin-webhooks` was the last of them and is the only one whose
  manifest changed: `withSourceFallback` lives in `@objectstack/platform-objects`,
  which that package did not declare. It was **already in that package's install
  closure** through `@objectstack/service-messaging`, so the edge declares a
  resolution that already resolved rather than adding a package to the graph —
  and relying on it undeclared would have been a phantom dependency under this
  repo's strict package manager.
  
  `check:i18n-stale-fill` gains a second verdict, **UNSERVED PROVENANCE**, so this
  cannot silently come apart again: a bundle set that commits a companion and
  does not consult it at serving time now fails the build, including a tenth set
  that lands tomorrow.
  
  **Graded `patch`, and the grade is the interesting part.** No API changes, no
  new exported surface, and no key set moves — substitution was chosen over
  deletion precisely so key-set claims stay put (ruling #8765 Option B). What
  changes is which STRING a stale leaf serves. On this tree that is **zero
  leaves**: a record is only ever written for a leaf that IS a byte copy of the
  current source, so the companions arrive 0-stale by construction. The change is
  in what happens the next time a source string moves — the reader sees the
  English source rather than a superseded draft of it, which is the same
  degradation an untranslated key already produces and not a new state.
- de47336: chore(i18n): roll the generated-leaf provenance companion out to the remaining bundle sets (#12559)
  
  `os i18n extract --source-hashes` (#11671, maintainer ruling #12069 Option A)
  records, per generated translation leaf, the digest of the source revision that
  leaf is **still a byte copy of** — the one signal that tells a stale fill from a
  real translation once the source has moved and the two stopped being
  distinguishable by value. It shipped opt-in, and exactly one of the nine i18n
  bundle sets opted in. A landed detector, a changeset announcing it and a green
  gate read together as *"generated translation staleness is now caught"*; for
  eight of nine sets it was not, and the thing making it not caught was a single
  absent flag in an extract config — invisible from all three of those surfaces.
  
  **All eight remaining sets now opt in** — `plugin-approvals`, `plugin-audit`,
  `plugin-security`, `plugin-sharing`, `plugin-webhooks`, `service-messaging`,
  `service-realtime`, `service-storage`. Each documents `source-hashes` in its
  extract config and commits three `<locale>.source-hashes.generated.ts`
  companions, produced by the same extract run as the bundles they sit beside
  (`check:i18n` compares them byte-for-byte, so they cannot be written by hand).
  `check:i18n` now reports 7 bundles per set where it reported 4, and 11 for
  `platform-objects` where it reported 8.
  
  **Records count what is currently RECORDABLE, never what is covered.** A record
  is written only for a leaf that *is* right now a byte copy of the current
  source, so a fully translated locale starts with an empty table — which is the
  instrument armed, not an instrument that measures nothing: the entry appears by
  itself on the first extract after a leaf becomes a fill. Measured at this
  commit, per set over its three translated locales: `service-messaging` 289,
  `plugin-approvals` 61, `plugin-security` 33, `plugin-webhooks` 20,
  `plugin-audit` 8, `service-storage` 7, `plugin-sharing` 1 (es-ES only; zh-CN and
  ja-JP are fully translated and start empty), `service-realtime` 0 (all three
  locales fully translated). **419 records written across the eight sets, 0
  stale.**
  
  **One extractor fix the rollout forced.** `--source-hashes` had one user, and
  that user commits both generated sections, so the interaction with
  `--no-metadata-forms` had never been exercised. The provenance table is computed
  over every generated section the extractor builds; the eight sets here commit no
  metadata-forms bundle, and their `metadataForms` subtree — absent from their
  merge baseline — arrives as a fresh `--fill=default` copy of `en`, so every leaf
  of it was recordable. First measured on `plugin-audit`: **763 records, of which
  2 were its own objects and 761 were digests of the Studio metadata-form baseline
  `@objectstack/platform-objects` owns.** Those records are unreadable in the
  package holding them and would have rewritten all 24 companions on any unrelated
  `*.form.ts` change in `packages/spec` — the cross-package coupling ADR-0029 D8
  and every `bundle-ownership.test.ts` keep out of committed bundles. The
  companion now covers exactly the sections a run commits, decided by the same two
  predicates that decide the bundle files. `platform-objects` commits both, so its
  three committed companions are byte-for-byte unchanged.
  
  **Grade: `patch`, and behaviour on the day it lands is unchanged for every
  leaf.** A record is written only where a leaf is currently a byte copy of the
  **current** source, so every record written equals the current digest and none
  of them can be stale; the mechanism cannot arrive red. No committed translation
  bundle changed a byte, no public API moved, and no leaf's rendered text changed.
  `narrowToCommittedSections` is new but internal to `@objectstack/cli` — the
  package's entrypoint does not re-export the extractor utils.
  
  **What this does not do**, stated so the boundary is not inferred wrongly a
  second time: these eight sets now *record* provenance. Reading it at serving
  time is `withSourceFallback`, and that is still wired in
  `@objectstack/platform-objects` alone — so a stale fill in one of the eight is
  now recorded and reportable, but not yet substituted at runtime. Tracked
  separately.
- 3e9c0d8: test(plugin-security): the managed-deny floor now sees the evaluator's first grant route — `allowTransfer` (#14137)
  
  The independent-property floor that derives which seeded default permission
  sets MUST be managed-deny targets ("a default set whose `'*'` wildcard grants
  a write", pinned in `default-permission-sets.test.ts` and diffed against
  `MANAGED_DENY_TARGET_SETS`, #14029) read only the three CRUD write flags plus
  `modifyAllRecords`. That missed the evaluator's FIRST grant route — the
  direct bit read off `OPERATION_TO_PERMISSION` (`transfer: 'allowTransfer'`),
  a real grant ENFORCED today through the insert/update `owner_id` door (#3004).
  A future default set shaped `'*': { allowRead: true, allowTransfer: true }`
  would have held ownership reassignment on every `managedBy: 'better-auth'`
  identity table while tripping neither floor clause, so it was never required
  to become a managed-deny target and would have kept its wildcard silently.
  
  The floor now also checks `wc.allowTransfer === true` (a value test, never
  key-existence — Zod materialises these bits with `.default(false)`, so they
  are present-as-false; #14129 first review), and both exhaustive docblocks
  name the first route. Zero behaviour delta today: no existing seeded set
  carries a transfer-granting wildcard, every existing set keeps its exact
  verdict (pinned), and the runtime deny application is byte-identical — this
  hardens a CI-time pin, not the shipped permission surface.
- 20b79be: fix(plugin-security): registry-driven managed-object write denies now reach `organization_admin_no_bypass` (#14029)
  
  `MANAGED_DENY_TARGET_SETS` named four default sets, and `applyManagedWriteDenies`
  matches on it exactly — so at `kernel:ready` the injection walked the derived
  `organization_admin_no_bypass` variant and skipped it. The variant is a shallow
  copy of `organization_admin` taken at module load (`deriveWallLessOrgAdmin`
  strips only the `viewAllRecords`/`modifyAllRecords` superuser bits), which means
  its `'*'` wildcard still grants create/edit/delete AND entries injected into the
  parent's `objects` can never propagate to it. Its own docblock declares
  "managed-write denies … carried over verbatim"; the behaviour violated that
  declared contract.
  
  No gap opens on today's tree — the static `BETTER_AUTH_MANAGED_OBJECTS`
  baseline covers the 28 declared managed tables and is copied into the variant at
  derivation. The gap was the next `managedBy: 'better-auth'` schema that lands
  without a hand edit to that list: `organization_admin` would receive the
  injected deny while the wall-less variant's wildcard kept granting raw CRUD on
  an identity table — precisely the drift the registry-driven module exists to
  close (ADR-0092), on the posture (`auto-org-admin-grant` under a wall-less
  deployment) where the bits are least bounded.
  
  - `ORGANIZATION_ADMIN_NO_BYPASS` is now a member of `MANAGED_DENY_TARGET_SETS`.
    The variant's pre-existing explicit entries (static baseline, RBAC read-only
    block) survive unchanged — the injection skips any object a set already
    names.
  - The membership pin no longer checks the list against itself: the required
    floor ("default sets holding a write-granting `'*'` wildcard") is derived
    from the real seeded sets and diffed against the list; a non-empty
    difference is red. `admin_full_access` stays deliberately excluded (admin
    rescue path) and that exclusion is pinned exactly.
- 52954c0: `IObjectQLEngine.getSchema` now returns `ServiceObject | undefined` instead of `unknown` (#12481) — the #11833 ruling's fork 3 as executed by #12248, applied one member over by inheritance: `ObjectQL.getObject` is literally `getSchema`'s alias (`return this.getSchema(name)`), the class has always answered `ServiceObject | undefined`, and `ServiceObject` lives in spec (`data/object.zod.ts`), so the contract's "engine-local type" rationale for `unknown` no longer applied here either. FROM `getSchema(objectName: string): unknown` TO `getSchema(objectName: string): ServiceObject | undefined` (authored state, ADR-0122, matching `getObject`). Consumers reading `managedBy` / `fields` / `userActions` off the answer no longer need a cast or a private structural re-declaration; `plugin-security`'s engine-owned write guard drops its now-redundant `as EngineOwnedSchemaLike | undefined` narrowing (behaviour unchanged). Implementations conforming to the class's actual behaviour are unaffected; a fake answering a non-conforming shape now fails compile at the member instead of drifting silently.
- 9cfc1f7: Extend the packaged-permission-set lock ("lock the base, clone to customize", 2026-08-24 ruling) to the `restore` leg of the permission-set write-through — the one write point that did not consult it. The leg now checks provenance before re-authoring a restored record's definition into metadata: a package-declared name (or one whose provenance cannot be resolved — fail-closed) has its re-author refused and the refusal reported loudly on the durability channel, while the engine's un-trash stands (this leg runs after it and deliberately never throws). With the mint refused, boot reconciliation re-projects the declared body, so the environment converges to the package truth instead of a silent fork. Org-owned sets restore exactly as before.
- 8af88dd: feat(spec): retire the `allowRestore` / `allowPurge` object-permission bits — declared gates on operations that do not exist (#12497, ADR-0049)
  
  **BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
  launch-window convention ships it as `minor`; the migration prescription is
  registered under protocol major 18, where `os migrate meta` users will look).
  Maintainer ruling 2026-08-26 (decision-inbox batch 5) accepting #1883's
  recommendation B; **the keys return with the M2 lifecycle initiative** (feature
  + RBAC in one batch) — anchor card #1883 stays open.
  
  `allowRestore` and `allowPurge` claimed to gate `restore` (undelete) and
  `purge` (hard-delete / GDPR erase) ObjectQL operations that have never
  existed: no destructive lifecycle verb is in the engine's dispatch vocabulary
  (pinned by objectql's `engine-middleware-operation-vocabulary.test.ts`, #8106).
  Authoring the bits granted nothing — and in the `allowPurge: false` direction
  the failure was ADR-0049's worst false-compliance shape: an admin believed a
  lock on permanent deletion existed when the operation itself did not. The
  sibling `allowTransfer` is **enforced** (#3004, the insert/update `owner_id`
  door) and is untouched.
  
  **What is refused:** authoring either key, with any value — both are
  `retiredKey()` tombstones (`ObjectPermissionSchema` is reachable from the
  `permission` metadata root, so the tombstone route keeps the removal audible:
  a tsc `never` on the input type plus a parse-time prescription). The former
  `restore` / `purge` bare-verb aliases now answer with the same prescription
  instead of a rename onto a tombstone. The tombstone rides the `.extend()`
  clone into `EffectiveObjectPermissionSchema`, so the response-side def carries
  the same `[RETIRED]` rows.
  
  **What stays accepted:** every other object-permission bit parses
  byte-identically (`allow*` CRUD, `allowExport`, `allowTransfer`,
  `viewAllRecords`, `modifyAllRecords`, `readScope` / `writeScope`).
  
  **Runtime (plugin-security):** the evaluator's pre-mapping rows
  (`OPERATION_TO_PERMISSION` restore→allowRestore / purge→allowPurge) retired in
  the same batch — with the bits unwritable, a mapping onto them was a claim
  about a surface that rejects authoring. Behaviour is deny-before and
  deny-after: a dispatched `restore` / `purge` is refused fail-closed by the
  `DESTRUCTIVE_OPERATIONS` backstop, now unconditionally (not even
  `modifyAllRecords` reaches an unmapped destructive op — the bypass re-covers
  them only when the M2 batch re-adds the rows). `transfer` keeps its row and
  its bypass. `describeHighPrivilegeBits` stopped reading `allowPurge` (a legacy
  stored value grants nothing, so flagging it guarded nothing real); the
  delete/purge/transfer class message is unchanged.
  
  The retirement kit:
  
  - `retiredKey()` tombstones + former-alias `guidance` prescriptions at the
    schema (`packages/spec/src/security/permission.zod.ts`)
  - ADR-0087 registration: retired-key entries
    `security/ObjectPermission:allowRestore` / `:allowPurge` (and the
    `security/EffectiveObjectPermission` pair for the cloned rows) and the D2
    conversion `permission-allow-restore-purge-removed` (protocol 18), wired
    into the step-18 chain — `os migrate meta --from 17` strips the keys from
    every object grant in `permissions[].objects` (pure lossless delete; they
    never had an effect to lose)
  - liveness ledger: both entries flipped to `dead` with the retiredKey evidence
    (entries stay — the tombstone keeps the keys in the walked shape, the
    `rls.priority` precedent)
  - pin tests (`permission.test.ts` — refusal pins asserting the prescription;
    `security-plugin.test.ts` — fail-closed pins incl. the legacy-stored-grant
    and modifyAllRecords directions; `audience-anchors.test.ts` — the predicate
    no longer reads the retired bit)
  - generated baselines/docs follow the schema (`authorable-surface/`,
    `authorable-defaults/`, spec-changes, upgrade guide, reference docs)
  
  ## FROM → TO
  
  ```ts
  // before — parsed green; nothing ever read the bits, no operation existed
  definePermissionSet({
    name: 'support_agent',
    objects: {
      crm_ticket: {
        allowRead: true, allowEdit: true,
        allowRestore: true,   // claimed: can undelete — nothing enforced it
        allowPurge: false,    // claimed: GDPR erase locked — no lock existed
      },
    },
  });
  
  // after — delete the keys; restore/purge dispatches are denied fail-closed
  // until the M2 lifecycle batch ships the operations WITH their RBAC bits
  definePermissionSet({
    name: 'support_agent',
    objects: {
      crm_ticket: { allowRead: true, allowEdit: true },
    },
  });
  ```
  
  <!-- adr-0087: registered permission-allow-restore-purge-removed -->
- 31bb2e7: fix(plugin-security): report the two swallowed `tryUpdate` refusals outside the catalog seed (#12970)
  
  Both sites call the shared `tryUpdate` in `permission-set-projection.ts`, which
  answers `false` on refusal. That answer is byte-identical to "nothing to do",
  and neither caller passed the optional refusal log the helper already accepts —
  so a refused write was indistinguishable from a clean pass.
  
  **`permission-set-drift.ts` — a refused diagnostic write silenced its own
  report.** `persistPermissionSetDriftDiagnostics` counted only the writes that
  landed, and `runPermissionSetDriftDiagnostics` reported only when that count was
  non-zero. A boot on which every drift write was refused computed the drift
  correctly, persisted none of it, and printed nothing at all — indistinguishable
  from a deployment with no drift, while the sets kept enforcing grants that
  differ from the shipped artifact. The pass now records refusals, answers a
  `refused` count beside `updated`, reports them once per pass on the durability
  channel, and emits the drifted-set line when writes were refused as well as when
  they landed. A steady-state boot (nothing to write, nothing refused) stays
  exactly as quiet as before.
  
  **`permission-set-overlay-discard.ts` — the audit line could describe a discard
  that did not happen.** On the degraded-kernel branch the resync write's result
  was discarded entirely. On refusal the row was re-read unchanged, so
  `objectGrantsAfter` equalled `objectGrantsBefore` while the `info` entry still
  announced a completed "sanctioned operator action": every field individually
  true, the entry as a whole false. The result is now read, and a refused resync
  emits one entry stating what did and did not land — the overlay row deletion
  (which had already succeeded) and the refused resync, with the un-healed grant
  count named as such — **instead of** the success line, never alongside it.
  
  Both new lines go through the shared durability channel with its mandatory
  `warn` fallback, so they still print against a host sink that has no `error`.
  They reuse the shared refusal *accumulator* (`createSeedWriteRefusals`, with its
  cross-dialect classification and value-free driver-code channel) but not
  `reportSeedWriteRefusals`, whose prose is specific to seeding the RBAC catalog
  and would misdiagnose either of these paths.
  
  No API is removed or narrowed. `persistPermissionSetDriftDiagnostics` and
  `runPermissionSetDriftDiagnostics` answer one additional field (`refused`), and
  what `discardPermissionSetOverlay` returns to its caller is deliberately
  unchanged.
- 502ff8b: An organization-less `sys_permission_set` row grants again — #11121 revoked standing access silently
  
  #11121 made the request-time permission-set loader tenant-scoped so two
  organizations holding a row for the same name stop answering each other's
  requests. It shipped the second half as a COMMENT — "an organization-less
  leftover only where it does not [have its own]" — and the code read `.own`
  alone, which by `resolveOwnOrganizationRow`'s own documented contract is never
  a residue once an organization is supplied.
  
  That helper is written for SEEDERS, where refusing to read a residue as
  "already seeded" is the entire point. Enforcement wants the opposite reading: an
  organization-less row is still a row the principal was granted, and dropping it
  revokes standing access with no signal at the moment of loss — the failure this
  catalog's own header, and `resolve-authz-context`'s `sys_position` read, both
  name as the thing not to do.
  
  The asymmetry was observable on a single row: its `system_permissions` and
  `tab_permissions` kept applying, because that read is unscoped and by id, while
  its `object_permissions` and `admin_scope` stopped. One row, two enforcement
  planes, opposite verdicts. Every walled deployment carrying pre-#11121 rows —
  or any row authored without a tenant, which includes admin-UI-authored sets —
  lost those grants on upgrade, reported only as a boot WARN about "leftovers"
  that states the catalog is complete.
  
  Found by cloud's `apps/ee-group-showcase` dogfood suites, which had been failing
  four ADR-0111 / ADR-0105 assertions on cloud main while turbo replayed them from
  cache.
  
  Preference order is unchanged, so the cross-tenant bleed #11121 closed stays
  closed: this organization's own row still WINS wherever it exists, and a
  leftover is consulted only in its absence. #11121's suite covers seeding and the
  `sys_position` sweep; the three cases added here cover the loader path it did
  not — residue resolves, own beats residue, and the single-posture carve-out is
  untouched. Reverting the one-line fix reddens exactly the first of them.
- d7b3963: Export the kernel platform-admin capability declaration from `@objectstack/spec` (`ADMIN_FULL_ACCESS_CAPABILITIES`) and import it in plugin-security's `admin_full_access` permission-set declaration, so exactly one copy of the capability list exists (#11663 Choice 6A, leg L1). Behaviour-neutral: the declared capability set is byte-for-byte unchanged, pinned by test.
- 7c41693: fix(core,plugin-auth,plugin-security): every `OS_PLATFORM_OWNER_EMAIL` reader asks the ONE list-aware parser (#13147)
  
  `OS_PLATFORM_OWNER_EMAIL` accepts one address **or a comma-separated list** of
  them (#11663 Choice 2B). The list parse landed in a single home
  (`@objectstack/core`'s `platform-admin.ts`) and the authorization derivation
  consumed it — but every other reader kept calling `resolvePlatformOwnerEmail()`,
  which returns the operator's value trimmed and otherwise verbatim, and kept
  treating that whole string as ONE address.
  
  An operator who configured a list therefore entered a self-contradictory state:
  authorization recognised them as a platform administrator, while four separate
  capabilities silently did nothing. Every direction failed **closed** — no
  privilege escalation existed at any point — but a declared capability vanished
  with no error anywhere:
  
  - `bootstrap-platform-admin` promoted **nobody**, logging "will be promoted when
    that account registers" on every boot forever;
  - the walled operator stamp (`plugin-auth`) stamped **no** list member verified,
    so the account it should have provisioned was then refused elevation as
    `walled_owner_not_verified`;
  - `isVerifiedPlatformOwnerSession` / `platform-owner-wall-bypass` let **nobody**
    across the Layer 0 organization wall — the largest of the affected surfaces;
  - the walled boot diagnostic printed the raw list in the slot where an operator
    reads one address, and its dev-seed silence clause never matched.
  
  All six readers now ask the same parser. `@objectstack/core` gains
  `isConfiguredPlatformAdminEmail(email, config)` — the membership half of
  `matchesConfiguredPlatformAdmin`, spelled once and shared, for the readers that
  hold a bare address rather than a `sys_user` row (the elevation gate keeps its
  two halves apart so `walled_owner_not_registered` and `walled_owner_not_verified`
  stay distinct answers; the stamp is handed an email before any row exists; the
  wall takes a fast negative before spending a row read). `PlatformAdminEmailConfig`
  gains `declaredSpellings`, the entries as the operator typed them, so the by-email
  `sys_user` lookup and the boot diagnostic get the as-typed form **from the one
  parse** instead of splitting the raw value a second time.
  
  Behaviour for a single declared address is unchanged, including the
  case-insensitive match and the verbatim-spelling store lookup. A **refused**
  list (Choice 2B fails the whole variable closed on one unparseable entry) now
  reaches these readers as "zero administrators", which is the same answer they
  already gave for an unset variable — never a silently narrower set.
  
  Two readers deliberately keep reading the raw value: the walled-boot refusal and
  the verification-path probe guard in `auth-plugin.ts` both use it as a pure
  truthiness test ("did the operator declare anything at all?"), which is
  grammar-independent. A census pin now enumerates the raw readers across both
  plugin packages and fails on a seventh.
- f64668d: fix(plugin-audit,plugin-security): declare sourced bounds on the four keyed text columns that break MySQL schema-sync (#12059)
  
  Four text columns that a declared index keys on carried no `maxLength`, so
  `driver-sql` emitted them `TEXT`. MySQL refuses a TEXT/BLOB column in a key
  without a key length (`ER_BLOB_KEY_WITHOUT_LENGTH`): `CREATE TABLE` succeeds,
  `ALTER TABLE … ADD INDEX` fails, and the object lands registered-but-broken
  with its declared index silently absent.
  
  | Object | Column | Bound | Producer the bound is derived from |
  |---|---|---|---|
  | `sys_activity` | `record_id` | 255 | the physical `id` column — `driver-sql` creates every primary key as `table.string('id').primary()`, knex's `varchar(255)` |
  | `sys_audit_log` | `record_id` | 255 | same |
  | `sys_audience_binding_suggestion` | `package_id` | 255 | `sys_permission_set.package_id` (255), which the same boot pass writes the same value into |
  | `sys_audience_binding_suggestion` | `permission_set_name` | 100 | `sys_permission_set.name` (100), the column this value resolves against at confirm time |
  
  Each bound is derived from a **named producer** and stated in the declaration
  so it is vetoable in review (#11374 route A; PR #12058 is the worked
  precedent). None of them narrows anything storable:
  
  - a record id cannot exceed the `varchar(255)` column the id itself lives in,
    and the `referenceVia` seed path refuses an unresolvable pointer rather than
    storing a natural key verbatim;
  - a permission set name longer than 100 is already refused at the write seam
    today — measured on a real engine, `ValidationError: API Name must be ≤ 100
    characters (got 101)` — so no set with such a name can exist, and a
    suggestion naming one could never be confirmed.
  
  Measured at the driver level, shipped declaration vs. the same declaration with
  the bounds stripped: `record_id`, `package_id` and `permission_set_name` move
  `TEXT` → `varchar(255)` / `varchar(100)`, while `id` reads `varchar(255)` in
  both — the transitivity premise, read off a real table rather than assumed.
  
  Existing deployments are not rewritten: a physical `TEXT` column is deliberately
  not diffed against `maxLength` (#11431), so no `ALTER` is planned and no value
  at rest is truncated. The repair takes effect where the decision is makeable at
  all — at `CREATE TABLE` — because no dialect turns a TEXT column into a keyable
  one afterwards.
  
  Each plugin also gains a keyed-text-bounds pin driven through its **own
  registration path** (`init()` → the manifest `register({ objects })` call),
  rather than a hand-written object list: the platform-objects pin enumerates only
  that package's exports, which is exactly why these four columns escaped route
  A's sweep after ADR-0029 K2 moved the objects out.
- 9690d11: fix(plugin-security): the app default permission set resolves from `packages[]`, not only the flattened top level (#15007)
  
  `appSecurityPluginOptions(config)` read `config.permissions` and nothing else.
  For a multi-package artifact under the ADR-0130 D4 option-B shape — where
  `packages[]` carries each definition exactly once and the flattened top-level
  copy is gone — that read returns `undefined`, the reader concludes "this app
  declared no default profile", and the boot continues. Nothing throws and
  nothing logs.
  
  That silence has a security posture attached. The name this resolves becomes
  the `SecurityPlugin`'s `fallbackPermissionSet`, i.e. the app's half of every
  authenticated human principal's additive baseline
  (`composeHumanBaselinePermissionSets`, ADR-0090 D5). Losing it does not deny
  anyone the boot — the deployment simply runs on the platform floor alone, and
  every member of a multi-package app quietly holds less access than the app
  declared for them. #7555 measured what that looks like from the outside: nav
  entries served, 403 behind them.
  
  The resolution now reads the flattened top level FIRST and then each package
  body, in the order `resolveArtifactPackageOrder` (`@objectstack/core`,
  ADR-0130 D4+D5) registers them:
  
  - **Every artifact the platform emits today answers bit-identically.** The
    flattened level still answers first, so the `packages[]` pass can only supply
    a set where the top level had none. This is the reader half of the ruled
    order (readers first, emitter last, artifact stays additive throughout), so
    it lands with no change to what any command emits.
  - **Order is the platform's one package order, not the array's.**
    `appDefaultPermissionSetName` resolves the FIRST `isDefault` set, so with two
    packages declaring one, "first" has to mean here what it means at every other
    artifact reader: dependency-topological, so a package that extends another is
    read after it whichever array slot it occupies.
  - **The singular `manifest` is still not consulted** (#7001 — the harness must
    not honour a declaration `serve.ts` ignores). That is not a special case: an
    artifact carrying no `packages` key makes `resolveArtifactPackageOrder`
    return the caller's own object as the single package body, so that branch
    reads `permissions` from exactly where the old code read it.
  - **A malformed `packages` is refused, not skipped.** A non-array `packages`,
    an entry inlined instead of wrapped under `manifest:`, or a duplicate package
    id raises the same ADR-0112 envelope (`code` + `status: 422`) the manifest
    service raises when it registers that artifact. Catching it would resolve a
    permission surface out of an artifact the loader refuses to load.
  
  Every boot path that already funnelled through this one function picks the fix
  up unchanged: `objectstack serve`'s artifact and from-source paths, and
  `@objectstack/verify`'s `bootStack` / RLS harness.
- ad54eb3: feat(tooling): onboard all 14 `packages/plugins/**` packages into `check:test-typecheck` (#14062)
  
  Every plugin package now has a `tsconfig.test.json` compiled by the shared
  `check:test-typecheck` gate, and its `typecheck` script names it. Before this,
  the shrink-only `test-typecheck-debt.json` ratchet said **nothing** about a
  third of the repo's runtime surface: 14 packages, 1 `tsconfig.test.json`
  (`plugin-security`, wired directly to `tsc` rather than to the instrument), and
  0 `check:test-typecheck` scripts.
  
  Onboarded as a family by the director ruling of 2026-09-01 on #14062
  (maintainer verbatim: 「同意」), which also carries the #5286 maintainer
  authority the starting ledgers need. The smaller branch triage recommended —
  declare the instrument's scope and re-site the two compile-time pins — was
  recorded as considered and not taken: an instrument silent over a third of the
  runtime surface is a hole readers generalise across, and that costs more than
  fourteen tsconfigs.
  
  **Measured, not assumed** (at `e80889095`, workspace closure built first). Four
  packages carry residue and therefore a starting ledger — plugin-approvals 324
  over 8 files, plugin-auth 94 over 10, plugin-sharing 3 over 2,
  knowledge-ragflow 3 over 1. The other ten measure **zero** and deliberately get
  no ledger file at all: the gate reads a missing ledger as `{ entries: {} }`, so
  any error there is red immediately with no entry to be added to — strictly
  stronger than a ledger holding nothing, and the call `plugin-security` had
  already recorded for itself.
  
  ⛔ **This does not repair 345 type errors.** Per ruling item 3 it makes the
  ratchet able to *see* them; paydown follows the ratchet's own shrink-only
  discipline on its own cards. No test file is edited here.
  
  Two corrections to the finding's own prose, both measured: the exclusion is
  narrower than "no plugin package compiles its tests" — 9 of the 14 already
  compiled their tests inside the `typecheck`-invoked build config, at zero
  errors — and `exec-context-annotation.pin.ts` is a `.pin.ts`, which
  `**/*.test.ts` never excluded, so its directives were already live. The pin
  this change genuinely makes real is
  `plugin-approvals/src/manager-org-screen-parity.contract.test.ts`, which no tsc
  program had ever read.
- 936aa2d: Say the position-name fold out loud: a permission set granted only because a POSITION of the same name resolved by name, with no `sys_position_permission_set` row behind it, now emits a `position_name_fold_grant` warning (#13419 执行要点 3, warning half).
  
  Permission-set resolution requests `[...positions, ...explicitPermissionSets]`, so a position called `sales_rep` resolves a permission set called `sales_rep` — no junction row, no audit line, and nothing declaring that it happens. An operator inspecting `sys_position_permission_set` sees "no bindings" while bindings are in force. The maintainer ruling (2026-08-31) makes the junction table the one governed channel; this reports the ungoverned grants until the fold itself is retired.
  
  The warning names the pair `(position N, set N)` **specifically**. A position bound to some *other* set is still folded onto its own name, so a report keyed on "is this position bound to anything?" would miss real folds while looking complete. It stays silent for a position already carrying that set through the governed channel (a junction row or a direct assignment), for baseline sets, and for any position with no same-named set — which is every built-in identity (`platform_admin`, `org_owner`, `org_admin`, `org_member`, `guest`). It is emitted once per position name per process, so it stays loud instead of becoming per-request volume operators filter away.
  
  ⛔ Resolution results are unchanged. Nothing is granted, revoked, accepted or rejected differently — the warning is purely additive, per the ruling's 「任何行为差异只能表现为拒绝/告警,永不静默改变解析结果」.
- d48929e: fix(security): a refused RBAC catalog write is now boot-visible instead of reporting a seed of zero (#12923)
  
  The five RBAC catalog seeders answered a refused write with `null`/`false`,
  which is byte-for-byte the answer for "nothing to do": the `seeded` counter
  never incremented and the pass returned normally. On a deployment still
  enforcing a **platform-wide** unique index on the name column — the shape that
  predates per-organization materialization — every per-organization INSERT is
  refused that way, so the boot log read as a successful seed of zero rows.
  Measured on a deployed plane, undetected for weeks: an empty Setup (no
  positions, no permission sets, no capabilities) under a clean log.
  
  The outer handler was not missing, it was **disarmed**. `security-plugin.ts`
  already wrapped the organization-creation seed in a `try`/`catch` that warns,
  and it was unreachable for this failure class: the refusal was converted to
  `null` three call layers below, so the `await` resolved normally and the hook
  logged "RBAC catalog seeded" at `info` over a seed of nothing. Another outer
  `try`/`catch` would fix nothing — the signal has to survive the inner helper,
  which is where the change is.
  
  Each seeder now accumulates the writes the database refused and reports them
  **once per object per class per pass**, beside its counts:
  
  - a **unique violation** is named as a deployment-schema defect, with the
    migrate remedy (`os migrate plan` → `os migrate apply`, where the legacy
    index surfaces as a `replace_unique_index` operation) and a pointer to the
    query engine's own redacted `Insert operation failed` entries, which keep the
    colliding index identifier;
  - anything **else** gets its own line and is never relabelled as the above,
    because no migration repairs it.
  
  Classification uses the shipped cross-dialect predicates in
  `@objectstack/types` (`isUniqueViolationError` / `uniqueViolationColumn`), not
  a local `23505` / `ER_DUP_ENTRY` regex. The warning prints only the value-free
  `code`/`errno` channel — never the driver's message, which a SQL driver
  prefixes with the fully bound statement.
  
  Diagnosis only: the seeders still **warn and continue**, never throw. A rethrow
  would turn a silent degradation into a boot failure on every deployment
  carrying the legacy index. Counts, accept/reject behaviour and the healthy-path
  logs are unchanged, and a pass that refuses nothing stays silent.
- 192b2ba: **An RLS denial caused by an unresolved variable now leaves a trace — and the trace carries the reason.**
  
  When `compileCelToFilter` refuses a policy predicate, it produces a precise `detail`: which
  `current_user.*` variable did not resolve, or which member of a pre-resolved membership array
  came back `null`, and at what index. `RLSCompiler.compileExpression` consumed only `!ok` and
  threw that `detail` away one line before the only place that could surface it, and the warn
  sitting beside the drop was gated on `isSupportedRlsExpression` — a SHAPE-only test that
  answers "supported" for exactly these shapes, so nothing logged.
  
  The result was the worst-shaped failure an operator can be handed: the caller sees zero rows,
  no error is raised, nothing appears in the log — and the denial is *deliberate*, the
  fail-closed path working as designed, so a correct refusal is indistinguishable from "the data
  genuinely doesn't match".
  
  The drop site now keeps the compiler's reason and, when every applicable policy has dropped and
  the clause actually fails closed, logs one line naming the policy, the object, the clause, the
  predicate, the variable path, the member index and the consequence (`__rls_deny__`, zero rows,
  a refusal rather than an empty result set). The same line covers the emptied-membership drop,
  which the compiler reports as a success and this file then refuses — silent for the same reason.
  
  Nothing about the decision moves. `RLS_DENY_FILTER` still lands in the read filter, record
  attribution still excludes, zero rows still means zero rows, and `compileExpression` keeps its
  published `Record | null` signature. A predicate that never compiles for any input keeps its
  existing "DROPPED (no enforcement)" line (now also carrying the compiler's reason) rather than
  gaining a second one; a dropped policy whose sibling still grants stays silent, because that
  caller sees rows; and because this seam runs on read paths the denial line is emitted once per
  distinct cause rather than once per request.
- 09b0d7b: Security fix (fail-closed tightening, #13552): the RLS emptied-membership deny guard is now polarity-aware. A policy whose pre-resolved membership set resolves EMPTY under a negated membership test (`not in` — e.g. `using: '!(owner in current_user.org_user_ids)'`) now compiles to the deny sentinel (zero rows) instead of flowing through. Before this fix `$in: []` under `$not` inverted to a constant-TRUE clause (`NOT (1 = 0)` on the SQL read-scope lowering), so the policy the guard exists to turn into a DENY compiled to ALLOW-ALL on reads. The guard now fires at any composition depth: `$not` wrapping the membership directly, `$not` arms nested inside `$or`/`$and`, `$not` over a composite containing the membership, and multi-level `$not` (odd polarity anywhere; the bare positive case is unchanged).
  
  Blast radius, in plain terms: callers that were relying on that allow-all stop seeing rows. If a negated-membership policy was the only applicable policy and its membership set resolves empty (no active organization; an empty team/territory/blocked set), reads that previously returned EVERY row now return ZERO rows. The prior behaviour was a defect — an over-permissive read on a row-level-security scope — not a contract. If own-rows access must survive an emptied membership set, author it as a separate OR'd policy (e.g. `owner == current_user.id`): each policy's grant is compiled independently, and a sibling policy dropping does not take it down. A deliberate allow-all remains authorable as a literal `true` predicate. Unchanged: a NON-empty membership set under `not in` compiles and enforces exactly as before, and an emptied POSITIVE membership nested in `$or` (e.g. `owner in current_user.team_ids || owner == current_user.id`) still preserves the other arm's grant.
- 73c8466: fix(plugin-security): resolve the org-admin permission set per organization, and keep the revoke reach wide (#11670)
  
  `auto-org-admin-grant.ts` resolved the `sys_permission_set` row that every
  auto-provisioned org-admin grant points at by NAME alone: no `organization_id`
  predicate, `limit: 1`, and cached per ObjectQL instance on the name alone. Each
  property reads as deliberate; together they answer with a row nobody chose.
  
  Post-#10103 the RBAC catalog is materialized per organization and
  `sys_permission_set.name` is unique per organization (ADR-0120 D3), so one name
  carries a row per organization PLUS the organization-less platform-bucket row
  `bootstrapPlatformAdmin` mints on every boot — and that bucket row is the
  OLDEST bearing the name (measured on a fresh walled rig at 1.3 s ahead of the
  first `sys_organization`, #11532). An unscoped `limit: 1` read has no reason to
  prefer any other, and a per-instance cache keyed on the name made the first
  organization reconciled in a process pick the row every later organization got.
  The grant target is a foreign key, so on a walled deployment
  `sys_user_permission_set` rows granting `organization_admin` could point at a
  row belonging to no organization.
  
  **Walled postures only.** The read is now threaded with the granting
  organization — through `SqlDriver.applyTenantScope`, resolved by
  `resolveOwnOrganizationRow`, the catalog's own spelling of "which row is this
  organization's" — and the cache is keyed on `(organization, name)`. `single`
  keeps the unscoped answer and the unscoped `limit: 1` grant-target read
  unchanged; no read on a `single` path carries a `tenantId`.
  
  **When the organization has no own row**, the resolver returns `null` (the
  module's existing `skipped` / `permission_set_missing` no-op) and warns loudly,
  rather than falling back to the organization-less row: a fallback would keep
  minting grants at the platform bucket, and the second one would never be
  repaired — once the organization's own row appeared the reconciler would insert
  a duplicate beside it.
  
  **The revoke reach widened in the same change, deliberately.** Narrowing the
  grant target without it would be a permission loosening: a demoted admin whose
  grant predates this fix names the organization-less row, and the ADR-0105 D4 F2
  close-out (a deployment that drops its wall must not leave the unbounded
  `organization_admin` grant standing) converges across copies written under the
  other posture. Revocation therefore matches EVERY copy of the set name, in every
  posture — the per-pair superseded and demotion legs and the backfill's orphan
  sweep alike. The grant target is posture-scoped; the revoke reach never is.
  
  ⛔ No repair of existing rows is claimed or performed. This makes new
  resolutions correct; grants already pointing at the organization-less row are
  left exactly as they are, including the duplicate that appears beside one when
  its holder still qualifies. Accept/reject is unchanged today — `resolve-authz-context`
  resolves permission sets by id without tenant scoping, which is why the defect
  was invisible — and no published surface changes.
- 71627f7: fix(plugin-security): count and report the refused writes seven `catch {}` sites swallowed (#12981)
  
  Batch 2 of the ruled `catch { return null; }` worklist. The census instrument
  that landed with batch 1 (`scripts/measure-durability-swallow-family.mjs`)
  named seven tier-1 DARK sites in this package; all seven are repaired here, and
  a re-run moves tier 1 from **28 sites in 14 files to 21 in 11** while
  `channelled` rises **19 → 26** — the seven, moved, nothing else touched.
  
  Each site swallowed a refused write into a bare `catch`, so a pass in which the
  store refused **everything** returned counts identical to a pass with nothing to
  do — and in two of the three files the summary log is suppressed on exactly
  those counts, so the one boot that needed a line printed none. The refusals are
  now recorded through the in-package accumulator, reported **once** per pass with
  the consequence and the remedy, and the `> 0` summary suppressors are widened.
  
  - **`bootstrap-system-capabilities.ts`** — a refused `sys_capability` insert on
    the *derived* half reached no counter and no log at all, and a refused
    *update* was silent on both halves, while the boot went on logging "system
    capabilities seeded" at `info` over zero landed rows. Reported on the
    durability channel (`error`, falling back to `warn`), stating what is actually
    lost: registry state, not authorization — grants resolve capabilities by name,
    not by row.
  - **`cleanup-package-permissions.ts`** — ADR-0090 D5 promises that uninstalling
    a package "revokes it everywhere at once. No ghost grants." A refused deletion
    left the grant live while the package door answered `success`, and the
    all-zero outcome was the same one an uninstall of a package that granted
    nothing returns.
  - **`suggested-audience-bindings.ts`** ×4 — refused create / confirm / prune /
    reap. The insert site previously filed **every** failure under its documented
    "unique-index race — benign" rationale; the shared accumulator classifies with
    the shipped `isUniqueViolationError` predicate, so the genuine race is still
    treated as benign and excluded, while store outages are counted and reported.
  
  `PackagePermissionCleanupOutcome`, `SuggestionSyncOutcome` and
  `CapabilitySeedResult` gain a `refused` count (additive; they are returned, not
  constructed by callers).
  
  ⚠️ Two of the three files keep their report at `warn` rather than `error`. Their
  sinks ride on types exported from this package's `index.ts` that declare `warn`
  optional, and adding `error?` would enrol them into
  `check:optional-error-sink-contract`'s population, which requires a
  non-optional `warn` — a published-shape break, and a contract call above this
  repair. The **silence** is what is fixed here and it needed no contract; the
  **level** is recorded on #12981.
  
  ⛔ No entry was added to `scripts/durability-degradation.baseline.json` and the
  gate vocabulary is untouched in either direction, as the 2026-08-29 ruling
  requires until the family is repaired.
  
  ⭐ One file outside the package changed, declared on #12981 before editing:
  `scripts/measure-durability-swallow-family.mjs` (the census instrument, wired
  into no workflow) pinned its `dark` positive control to
  `bootstrap-system-capabilities.ts` — one of the seven — so repairing it turned
  the instrument's own `--self-test` red. The control now names
  `plugin-sharing`'s `share-link-service.ts`, which batch 1 judged permanently
  OUT of the programme (a `use_count` telemetry stamp), because any tier-1 DARK
  member still ON the worklist is a control the programme is designed to destroy.
  No predicate, tier or vocabulary change; `--self-test` is green.
- e1d773e: fix(security): stop reading a truncated existence page as "absent" — the unscoped page cap is now measured, not trusted (#11518)
  
  `buildExistingByName` (`seed-name-lookup.ts`) is the batched existence oracle the
  identity seeders consult in place of a per-item read. Its UNSCOPED page was
  capped at `limit: names.length`, which is exact only while one row can exist per
  name. Since #8461 / ADR-0120 D1 `sys_capability.name` and
  `sys_permission_set.name` are unique **per organization**, and ADR-0066 D1
  explicitly encourages admins to EXTEND the registry inside their own
  organization — so one name legitimately carries a row per organization plus the
  platform's, and an unscoped page of N names can match far more than N rows.
  
  The rows that fall off a full page are the highest `id`s under #4363's
  `ORDER BY id ASC` tie-breaker, so **whole names vanish from the page** — and a
  name missing from the page reads as `absent`, which routes its caller to the
  **INSERT** branch. #10103 had already found and repaired exactly this on the
  SCOPED arm; the unscoped arm never got the repair, and two seeders on `main`
  read unscoped (`bootstrapDeclaredCapabilities`, `permission-set-projection`'s
  env-overlay pass).
  
  ⛔ `names.length * 2` would have been the same defect with a larger constant:
  rows-per-name is bounded only by the number of organizations, so no constant
  multiplier is correct. Instead the cap stopped being a promise and became a
  **measurement** — the read asks for one row MORE than it is willing to hold, and
  a page that comes back carrying that extra row is a PREFIX of the answer rather
  than the answer. It then joins the module's existing "could not answer" causes
  and degrades to the per-item read, the fallback already there for a driver
  without `$in`. Both directions are exact: no complete page is ever mistaken for
  a truncated one, and no truncated page for a complete one.
  
  **Behaviour change, stated rather than slipped in.** In the truncating case the
  two unscoped seeders go from a **silent wrong answer to a loud slow one**: names
  that used to be reported `absent` (and re-inserted, or refused by the unique key
  as a collision naming a row nobody ever saw) are now answered correctly, at the
  cost of one read per name plus a warning naming the object and the budget it
  could not fit inside. An install that does not overflow the budget — every stock
  one, where a name carries a single row — issues exactly the same single read it
  issued before and says nothing.
  
  The SCOPED arm keeps #10103's cap exactly (`names.length * 2`), because there the
  number is a proven bound rather than a budget: `applyTenantScope` returns this
  organization's rows plus organization-less ones, and the declared name index is
  unique per organization. It gains the same probe, which turns a scoped page that
  overflows that bound — reachable only where the unique index is absent or not yet
  created — into the same loud degradation instead of a silent truncation.
- 50cf294: fix(security,verify): the last two tolerant `reference_to` readers — one made loud, one narrowed with a named reason (#13250)
  
  `@objectstack/spec` declares `reference` as the only relationship spelling and
  `FieldSchema` rejects `reference_to` / `referenceTo` (#11567, "one key, one
  answer"). Three live consumers still read the rejected alias as an accepted
  fallback. The lint reader was narrowed in #13322; the two remaining ones get
  **different** dispositions, because their failure modes are different in kind
  (maintainer ruling, 2026-08-30).
  
  **`@objectstack/plugin-security` — the tolerance STAYS, and is now LOUD.**
  `resolveCbpRelation` reads `ql.getSchema()`, i.e. the `SchemaRegistry`, and a
  raw `registerObject` skips Zod by design, so the alias genuinely reaches it
  (re-measured: a raw round-trip serves the field back as
  `["name","type","required","reference_to"]`, canonical absent). A miss there is
  not a quiet wrong answer, it is a **denial** — `resolveCbpRelation` returning
  null is fail-closed, giving `RLS_DENY_FILTER` (zero rows for every non-admin
  caller) on read and throwing `MasterDetailRelationMissingError` on write. So
  narrowing it would take a raw-registered, alias-spelled `controlled_by_parent`
  object from "access derived from its master" to "everything denied, and writes
  throw": an availability outage on a population that provably exists. The alias
  therefore still resolves, unchanged, and the plugin now reports it **once per
  object** through its own report sink — the same `warn` channel and console
  backed default as every other report site there. The message names the object,
  the field, the alias key and the rename, and states that access is unaffected
  so nobody goes hunting for an outage that did not happen. Nothing is reported
  for the canonical spelling, or when a canonical `reference` won over a stale
  alias on the same field.
  
  The report's granularity is the cache's: it sits inside `resolveCbpRelation`'s
  resolution body, which runs only on a `cbpRelCache` miss, so 25 reads of one
  object produce one report — and it re-arms when `metadata.watch('*')` clears
  that cache, which is exactly when a Studio / AI-authoring author is listening.
  
  **`@objectstack/verify` — narrowed, and the finding says WHY.** `deriveCrudCases`
  reads its config from `loadConfig()`, which does not validate ("the gate lives
  in the loaded module"), so the alias reaches it through two unparsed doors —
  a plain-object config, and the documented `defineStack(cfg, { strict: false })`
  (re-measured: the same fixture is refused by the default strict parse with
  *"Unrecognized key(s) on this field: `reference_to`"*, and survives both doors
  verbatim). Unlike the security reader, verify's failure mode is a **report
  line** rather than a refusal, so narrowing costs coverage, not availability —
  and it is safe. But a verifier that silently under-verifies is the defect
  #5262 was about, so the narrowing ships **with** its reason: an alias-spelled
  required relation now reports
  
  > required lookup field "company_id" spells the rejected alias `reference_to`
  > instead of `reference` — `reference` is the only relationship spelling
  > @objectstack/spec declares, so this app's target "company" was not derived;
  > rename the key
  
  rather than degrading to the generic "has no `reference` target", and an
  optional one is skipped under `relation-rejected-reference-alias:<key>` rather
  than the generic `relation-missing-reference`. Both land in the existing
  free-form `CrudCase.blocked` / `skippedFields[].reason` strings — no new
  exported type, no new status, no widened published surface.
  
  No shipped metadata spells either alias: the repo-wide sweep finds the spelling
  only in tests, the spec's own alias tables and other readers' documentation —
  no example app or platform object uses it.
  
  ⛔ Narrowing the security reader for real remains out of scope here, and is
  only honest behind a migration that sweeps stored / raw-registered metadata
  first.
- 7cbe705: fix(tooling): put three more package-root plugin manifests inside a tsc program (#14386)
  
  `check:type-check-coverage`'s `isUncheckedSourceCandidate` skipped `depth === 0`
  (the package root) unconditionally, so a package-root `.ts` file was invisible
  to SOURCES_COVERED no matter what it contained — not reported, and not
  tracked either. That is exactly why #13284's `driver-memory` /
  `plugin-hono-server` manifests went unchecked for as long as they did:
  `pnpm --filter <pkg> typecheck` exited 0 with a file no tsc program read, and
  the coverage gate called the package COVERED at the same time.
  
  This finds three more package-root manifest authoring sites the same hole
  hid, all `objectstack.config.ts`: `plugin-auth`, `plugin-security` and
  `service-i18n`. The gate now admits `depth === 0` only for a declared,
  exact-name allowlist (`ROOT_SOURCE_FILES`, `objectstack.config.ts` its only
  member) — not every root-level file, which stays the unresolved "104-file"
  scope question this card explicitly declines to settle (comment
  5504408509 on #14386) — and each of the three manifests now sits inside a
  program its package's own `typecheck` script invokes: a widened `include` on
  the existing sibling `noEmit` program for `plugin-auth`
  (`tsconfig.examples.json`) and `plugin-security` (`tsconfig.scripts.json`),
  and a new sibling `tsconfig.typecheck.json` for `service-i18n` (which had no
  sibling to widen), following the `driver-memory` shape #13284 established.
  
  All three type-check clean at zero recorded debt — no ledger entry is added.
- c0714eb: Walled platform-admin elevation now requires the owner-email match to be
  VERIFIED, and the bootstrap re-runs on the verifying update (#11343)
  
  Under walled postures (`group`/`isolated`), `bootstrapPlatformAdmin` matched
  the env-declared `OS_PLATFORM_OWNER_EMAIL` against the raw email string on
  `sys_user` — with no `email_verified` condition, while email verification is
  off by default. #11211 narrowed elevation from "whoever registers first" to
  "the declared owner's address" (a real and large narrowing); this closes the
  remainder that card #11343 records: in the window before the owner registers,
  an account created with the owner's address would still be elevated.
  
  Two halves, deliberately in one change:
  
  1. **The elevation match requires `email_verified`** (fail-closed allow-list
     over driver representations; an absent field on an imported/legacy row
     reads as unverified). An unverified holder of the owner's address is
     refused like any stranger — new reason `walled_owner_not_verified`, logged
     loudly with the unblock in the line. Never falls back, same direction as
     the undeclared-owner refusal.
  2. **The bootstrap-replay middleware now also fires on `sys_user` updates
     touching `email_verified` / `email`** (trigger set extracted as
     `shouldReplayBootstrapFor`, consumed by the middleware and its pins alike).
     Verification is an UPDATE — with the old insert-only replay, requiring
     verification would have refused the genuine owner at sign-up and then
     never looked again, leaving the platform without any administrator.
  
  `single` posture is untouched both ways: first-user promotion (ruled
  reasonable in #11184) does not gain a verification requirement, and the
  owner-email variable is still never consulted there. Both directions are
  pinned: the unverified holder is refused AND the verified owner is elevated —
  including across the refuse-then-verify-then-re-run sequence.
  
  The seeded dev admin (`maybeSeedDevAdmin`, dev-only) is now provisioned with
  `email_verified` stamped: it is created by the deployment's own boot command
  with operator-known credentials — the same trust shape as a trusted-SSO
  insert, not an unknown self-registrant — so walled dev/harness boots keep a
  promotable declared owner. The generic sign-up path is unchanged.
- 4d5b4f8: feat(auth): walled deployment's declared owner is email-verified at operator-provisioned creation (#12751)
  
  On a **walled** deployment (`OS_TENANCY_POSTURE` in the wall-enforcing
  family), the account whose email equals the declared platform owner
  (`OS_PLATFORM_OWNER_EMAIL`) is stamped `emailVerified` **at creation** when
  it comes into existence through an **operator provisioning path** — extending
  the #11343 dev-boot seeded-admin precedent to production walled boots
  (maintainer ruling 2026-08-28, cloud#1677: 「运营方创建即视为已验证」; the
  trust anchor is the operator's env-var declaration plus the
  operator-executed creation, not a mailbox round-trip; SMTP stays required
  only for inviting others).
  
  **Which creation paths qualify** (the [#11739] audience taxonomy, not a
  second classification):
  
  - the **bootstrap carve-out** — the very first account on a fresh install
    (zero human users), the one self-serve creation a walled boot admits;
  - **admin create-user / bulk import** (`method: 'admin'`) — an act only an
    authenticated admin session can perform;
  - **SCIM** (`method: 'scim'`) — provisioning executed by the
    operator-registered directory.
  
  **Never**: non-bootstrap self-registration (including an
  invitation-admitted registration typing the owner address), provider-class
  JIT (the IdP asserts its own `emailVerified` at insert), any non-owner
  address, any unwalled posture, and a later email **update** to the owner
  address (the stamp is staged at the admission gate and consumed once by the
  `user.create` before-hook — a seam an update cannot traverse). Dev-boot
  behaviour (#11343) is unchanged.
  
  The `WALLED_OWNER_NO_VERIFICATION_PATH` boot warning now probes the owner
  account's state: a fresh walled boot with no transport and no federated
  sign-in is **silent** (the operator's own first-account creation arrives
  verified — the case this closes), while an owner account that already
  exists **unverified**, a populated store whose bootstrap window is spent,
  and an unanswerable probe keep warning. A settled deployment whose owner is
  verified stops re-warning on every boot.
  
  `@objectstack/types` gains `isEmailVerifiedUserRow` — the [#11343]
  fail-closed verified-representation allow-list, moved from
  `plugin-security`'s private copy so the elevation gate and the boot
  diagnostic read ONE resolution (`plugin-security` now consumes it; no
  behaviour change there).
- e3f056f: Stop the per-organization catalog pass from reporting the platform's own
  permission sets as "pre-fix" leftovers with a remedy that recreates them
  
  On a fresh walled deployment (`OS_TENANCY_POSTURE=isolated`, three
  organizations) the boot log warned, once per organization, that *"pre-fix
  organization-less `sys_permission_set` rows are still present"* and offered
  *"re-initialize the deployment, or adopt each row by hand"*. Both halves were
  wrong there:
  
  - **Nothing was pre-fix.** The eight rows it named (`admin_full_access`,
    `organization_admin`, `organization_admin_no_bypass`, `member_default`,
    `viewer_readonly`, `mcp_agent_data_read`, `mcp_agent_data_write`,
    `mcp_agent_restricted`) were minted 1.3 s earlier — before the deployment's
    first organization existed — by `bootstrapPlatformAdmin`, the fifth seeder,
    which the #10103 ruling deliberately left outside the per-organization
    conversion. An operator on a deployment hours old was told they were carrying
    legacy state they never had.
  - **Its first remedy did not terminate.** Re-initializing a fresh walled
    deployment mints exactly those eight rows again on the next boot, so only the
    hand-adoption branch ends — and that one hands a platform-wide bucket to a
    single tenant.
  
  The pass now separates the two classes it was conflating and reports each with
  the remedy that fits, carrying a machine-readable `origin`
  (`'platform-bucket'` / `'pre-fix-residue'`) beside the named rows:
  
  - the **platform bucket** — names an organization-less writer still seeds on
    every boot — is reported as what it is, states that this organization's own
    copies were created and no action is required, and says plainly that
    re-initializing does *not* clear it;
  - a **genuine pre-fix leftover** keeps the original wording and the original
    remedy, unchanged.
  
  Membership is decided by name rather than by `managed_by`, because the question
  the remedy turns on is "will a re-initialized deployment have this row again?"
  — true for these names whatever provenance the current row carries (a
  pre-#8692 install stores `'admin'` on the very same names). It falls back to the
  shipped `defaultPermissionSets`, so a host that never threads the new
  `platformBucketNames` option still classifies correctly; the option exists for
  a host that overrode `SecurityPluginOptions.defaultPermissionSets`.
  
  `bootstrapPlatformAdmin` also declares what it wrote: under a walled posture it
  now logs that the platform defaults were seeded *without* an organization and
  that each organization's copies come from the catalog pass. The rig's boot line
  read `{"seeded":8}` with nothing to indicate the rows carried no organization
  at all, so the operator's first sight of them was the warning above.
  
  **No behaviour change to the seeding itself.** The eight rows are still minted,
  still organization-less, still unreaped — that is the ruled outcome of #10103
  (2026-08-20), and `PLATFORM_ADMIN` is derived from an unscoped grant pointing at
  the `admin_full_access` row *by row id*, so removing them would silently demote
  every platform admin. Whether the platform bucket should be materialized per
  organization remains the maintainer's open call, not this change.
- Updated dependencies [809d417]
- Updated dependencies [387e231]
- Updated dependencies [f794e4e]
- Updated dependencies [cae2169]
- Updated dependencies [b812a54]
- Updated dependencies [2d4fa75]
- Updated dependencies [0e4e51b]
- Updated dependencies [e84bbf6]
- Updated dependencies [effae80]
- Updated dependencies [efb3513]
- Updated dependencies [d62f990]
- Updated dependencies [c45d8e6]
- Updated dependencies [2e3e8c7]
- Updated dependencies [e621291]
- Updated dependencies [655b106]
- Updated dependencies [40a93b5]
- Updated dependencies [101ad2c]
- Updated dependencies [d5b330d]
- Updated dependencies [dda969c]
- Updated dependencies [1f45690]
- Updated dependencies [277948f]
- Updated dependencies [8bdd955]
- Updated dependencies [54e2d36]
- Updated dependencies [b745157]
- Updated dependencies [f3bbbef]
- Updated dependencies [4f24e9d]
- Updated dependencies [e27583e]
- Updated dependencies [4bd6faa]
- Updated dependencies [86cbe37]
- Updated dependencies [6a180e4]
- Updated dependencies [474242f]
- Updated dependencies [63cd487]
- Updated dependencies [bd4aa4e]
- Updated dependencies [803eaab]
- Updated dependencies [f8e8f03]
- Updated dependencies [983edf1]
- Updated dependencies [eae824e]
- Updated dependencies [f6fa22c]
- Updated dependencies [8a483b3]
- Updated dependencies [3bc2e38]
- Updated dependencies [97bcd99]
- Updated dependencies [df59de0]
- Updated dependencies [96e25a8]
- Updated dependencies [713f83f]
- Updated dependencies [77d4b3c]
- Updated dependencies [f75a38a]
- Updated dependencies [7a25e7d]
- Updated dependencies [1fa05a6]
- Updated dependencies [c85a265]
- Updated dependencies [dcb10a5]
- Updated dependencies [773a999]
- Updated dependencies [35dffea]
- Updated dependencies [d8024f0]
- Updated dependencies [8120808]
- Updated dependencies [776a098]
- Updated dependencies [5060877]
- Updated dependencies [4f6325d]
- Updated dependencies [52954c0]
- Updated dependencies [2aa8456]
- Updated dependencies [d23ebb9]
- Updated dependencies [93809a3]
- Updated dependencies [7c0d0c3]
- Updated dependencies [daae7aa]
- Updated dependencies [8dc22d6]
- Updated dependencies [fa5d137]
- Updated dependencies [a392dbf]
- Updated dependencies [279431e]
- Updated dependencies [948dd6b]
- Updated dependencies [3b4c56c]
- Updated dependencies [ae8edd2]
- Updated dependencies [e25403c]
- Updated dependencies [a81aa9d]
- Updated dependencies [64baa68]
- Updated dependencies [9fa70d7]
- Updated dependencies [09db64a]
- Updated dependencies [92916e7]
- Updated dependencies [a84f3ea]
- Updated dependencies [f2eaae8]
- Updated dependencies [56c093c]
- Updated dependencies [c09451b]
- Updated dependencies [ba64877]
- Updated dependencies [e7191ce]
- Updated dependencies [7345308]
- Updated dependencies [79b6a22]
- Updated dependencies [30d96ab]
- Updated dependencies [f658793]
- Updated dependencies [0fd4899]
- Updated dependencies [c95ad19]
- Updated dependencies [e58ea8b]
- Updated dependencies [4a17645]
- Updated dependencies [3795c5f]
- Updated dependencies [8ab926b]
- Updated dependencies [7317cf2]
- Updated dependencies [e25e839]
- Updated dependencies [5997207]
- Updated dependencies [8b13cc8]
- Updated dependencies [00d8f65]
- Updated dependencies [4a4a35d]
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
- Updated dependencies [200d255]
- Updated dependencies [2852acc]
- Updated dependencies [daeaaf9]
- Updated dependencies [c459da6]
- Updated dependencies [e914733]
- Updated dependencies [1d8ad0f]
- Updated dependencies [9738c35]
- Updated dependencies [f887e52]
- Updated dependencies [881f8d8]
- Updated dependencies [3bfa1e6]
- Updated dependencies [0a8ebf3]
- Updated dependencies [901355c]
- Updated dependencies [34ce8e7]
- Updated dependencies [33681ea]
- Updated dependencies [bfe13c8]
- Updated dependencies [0fb3044]
- Updated dependencies [4635f3e]
- Updated dependencies [fd289be]
- Updated dependencies [ee3595c]
- Updated dependencies [09b4f4e]
- Updated dependencies [b2eab95]
- Updated dependencies [93940d4]
- Updated dependencies [3a04b01]
- Updated dependencies [45b9051]
- Updated dependencies [3954fb7]
- Updated dependencies [4805b56]
- Updated dependencies [b9e9227]
- Updated dependencies [d395692]
- Updated dependencies [5894d30]
- Updated dependencies [a3765f6]
- Updated dependencies [2d5cee3]
- Updated dependencies [e22158f]
- Updated dependencies [7404925]
- Updated dependencies [0c2334f]
- Updated dependencies [778c59f]
- Updated dependencies [d2619fd]
- Updated dependencies [af56546]
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
- Updated dependencies [a17da05]
- Updated dependencies [a8c00e2]
- Updated dependencies [22e5236]
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
- Updated dependencies [15d55fb]
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
- Updated dependencies [f6344e7]
- Updated dependencies [42a117b]
- Updated dependencies [1401ae7]
- Updated dependencies [4297fe7]
- Updated dependencies [e398863]
- Updated dependencies [d16df74]
- Updated dependencies [d79c602]
- Updated dependencies [f11fc61]
- Updated dependencies [e808890]
- Updated dependencies [8f79379]
- Updated dependencies [e6ca40e]
- Updated dependencies [0c77ea4]
- Updated dependencies [52954c0]
- Updated dependencies [89eb997]
- Updated dependencies [7131f12]
- Updated dependencies [aa5994e]
- Updated dependencies [be93457]
- Updated dependencies [a65db76]
- Updated dependencies [2cf5a96]
- Updated dependencies [15eb2c9]
- Updated dependencies [5691b07]
- Updated dependencies [2a6122b]
- Updated dependencies [225e769]
- Updated dependencies [8af88dd]
- Updated dependencies [fb5fbb8]
- Updated dependencies [d7b3963]
- Updated dependencies [33184fd]
- Updated dependencies [7c41693]
- Updated dependencies [b72db01]
- Updated dependencies [dce5cd4]
- Updated dependencies [9688f58]
- Updated dependencies [556ebc1]
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
- Updated dependencies [064d484]
- Updated dependencies [527e050]
- Updated dependencies [dd33bf9]
- Updated dependencies [4cb2a90]
- Updated dependencies [74a7804]
- Updated dependencies [53d3689]
- Updated dependencies [b3a63d3]
- Updated dependencies [49f0dcf]
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
- Updated dependencies [db8c288]
- Updated dependencies [0e5fe7f]
- Updated dependencies [add4360]
- Updated dependencies [e0abc38]
- Updated dependencies [fc9ba76]
- Updated dependencies [1272f0a]
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
- Updated dependencies [598b7ec]
- Updated dependencies [d028b37]
- Updated dependencies [f7b25c5]
- Updated dependencies [122ef38]
- Updated dependencies [4a37870]
- Updated dependencies [428f9b2]
- Updated dependencies [aa7ff56]
- Updated dependencies [811a3c2]
- Updated dependencies [1401ae7]
- Updated dependencies [2fd3f1c]
- Updated dependencies [c41b42e]
- Updated dependencies [d41d166]
- Updated dependencies [c4db311]
- Updated dependencies [750fff5]
- Updated dependencies [c19035e]
- Updated dependencies [ececf7a]
- Updated dependencies [d173125]
- Updated dependencies [8eeca27]
- Updated dependencies [8425c17]
- Updated dependencies [a5ef1d8]
- Updated dependencies [87ad30c]
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
- Updated dependencies [038f333]
- Updated dependencies [644ad50]
- Updated dependencies [9735662]
- Updated dependencies [4d5b4f8]
- Updated dependencies [5d16379]
- Updated dependencies [0da7cd2]
- Updated dependencies [28a5c3e]
- Updated dependencies [4bc18e5]
- Updated dependencies [9f57f1e]
  - @objectstack/spec@17.3.0
  - @objectstack/platform-objects@17.3.0
  - @objectstack/core@17.3.0
  - @objectstack/types@17.3.0
  - @objectstack/metadata-core@17.3.0
  - @objectstack/formula@17.3.0

## 17.2.0

### Minor Changes

- 5337ef1: Batch the identity boot seeds' existence read and stop re-writing rows that
  already match the declaration (#10946).
  
  Every permission set and every position an environment declared cost **exactly
  4 sequential database round trips on every kernel boot** — measured on a real
  per-environment kernel build with every `@libsql/client` call counted: slope
  4.0000, R² = 1.000000 on both axes, with a per-statement histogram naming the
  four legs (2 × existence `SELECT`, 1 × `UPDATE`, 1 × `SELECT`). Two of the four
  were an `UPDATE` that fired even when nothing had changed. On a local file
  database the loop is invisible; on a remote libsql/Turso database — every hosted
  environment — each leg is its own sequential HTTP request. Schema sync had
  already been batched (`TursoDriver.supports.batchSchemaSync`), which is why
  objects, views and artifact seeds add 0.00 round trips each on the same rig;
  identity content was the one content axis still paying per item.
  
  Both loops now hoist **one** `{ name: { $in: [...] } }` existence read out of the
  loop — the declaration is known in full before the loop starts — and write only
  when the stored row actually differs from what would be written. A steady-state
  rebuild of both loops is now O(1) round trips: measured in-repo against a
  call-counting ObjectQL double, a rebuild of 1, 5, 20 and 40 declared items costs
  1 round trip in every case, for permission sets and positions alike.
  
  Three things the change is careful **not** to become:
  
  - **Drift still reconciles.** The skip is on equality, never on "we have seen
    this name": a row whose stored value differs — a package version bump, a
    hand-edit, a partially applied write — still gets its `UPDATE`. An
    implementation that skipped all writes would show the same round-trip curve
    and silently stop reconciling, so the round-trip pins are paired one-for-one
    with drift pins over the same fixtures.
  - **A read that could not answer is not the answer "none exist."** A batched
    read fails for the whole set at once, so swallowing its failure into `[]`
    would make every boot conclude nothing is seeded and re-create everything. The
    seam is judged on whether the driver returned a result set, never on whether
    the array came back empty; a failed batched read degrades to the per-item read
    (loudly warned), and a name whose record cannot be read at all is declined
    rather than inserted. That last step is deliberately stricter than the code it
    replaces, which turned a failed read into an insert attempt and leaned on the
    `name` unique index to refuse it.
  - **A converged publish is still a successful publish.** `PermissionSeedOutcome`
    gains `unchanged` (rows that already matched) and `unreadable` (names declined
    because their record could not be read). The ADR-0086 P2 publish materializer
    asks "did the record end up matching the published body", which was
    accidentally identical to "was a write issued" only because the seeder always
    wrote; it now reads `seeded + updated + unchanged`, so every case that reported
    a materialization before still reports one. A re-publish of a byte-identical
    body reports `inserted: 0, updated: 0` instead of `updated: 1` — the one
    reporting difference, and the truthful reading.
  
  `bootstrapDeclaredPositions` likewise returns `unchanged` and `unreadable`
  alongside `seeded`/`updated`.
- a16ff50: `SweepLogger` and `ProjectionLogger` now declare `warn` as a REQUIRED channel, so a sink handed to the boot outbox sweep or to permission-set reconciliation can no longer be one that prints nothing (#9754)
  
  Both interfaces declared every member optional — `info?`, `warn?`, `error?` — which made `{ info }` a legal sink. Against such a sink both durability reports evaporated: each reaches for `error`, finds none, falls back to `warn`, and finds none of that either. For the sweep that is mail the platform accepted and never delivered, summarised to nobody; for reconciliation it is a permission set that will not survive a re-provision, with the `info` "reconciled" line skipped as well, so the sink heard neither the failure nor the reassurance.
  
  #9657 and #9748 repaired the call-site spellings. This is the other half, and the half that cannot regress: an optional `error` with no guaranteed alternative is a contract that permits silence, so an author reading the interface can write a report that never prints and be right about the type. Requiring `warn` makes that unrepresentable at the point of authoring rather than catchable one gate-run later.
  
  `error` deliberately stays optional on both types — hosts do inject reduced sinks, and requiring `error` would foreclose the `{ warn }`-only host the drivers were written for.
  
  If you pass a logger of your own and it declares no `warn`, add one; the kernel `Logger`, `ctx.logger` and `console` all satisfy the tightened shape unchanged. Consumers reach these types through `@objectstack/plugin-security`'s exported `ProjectionDeps`; `SweepLogger` is internal to `@objectstack/plugin-email`.
  
  The rule now has a checker of its own: `pnpm check:optional-error-sink` scans every sink type in `packages/**`, reports the population as a census on every run, and carries a shrink-only ledger of the 15 sinks that still permit silence.
- 504c8d5: Materialize the RBAC catalog **per organization**, so a walled deployment can
  administer positions, permission sets and sharing rules again (#10103).
  
  On a walled deployment (`group` / `isolated`) every principal — an organization
  owner and a platform admin alike — listed **zero** positions, permission sets
  and sharing rules while the tables held rows. Nothing could be bound through
  Setup, and a declared `hierarchy-security` could never be armed by an operator
  however loudly an app declared it.
  
  Every row in those three tables was organization-less. plugin-security's Layer 0
  composes a strict `organization_id = :tenant` for a walled posture and the
  middleware ANDs it into the read AST over the driver's
  `(organization_id = :tenant OR organization_id IS NULL)`; the conjunction of the
  two is the strict equality alone, so the driver's null arm was annihilated on
  every authenticated read.
  
  **The wall is not changed, at either layer.** The rows get an owner instead:
  
  - `bootstrapDeclaredPositions`, `bootstrapBuiltinRoles`,
    `bootstrapDeclaredPermissions` (plugin-security) and
    `bootstrapDeclaredSharingRules` (plugin-sharing) upsert by
    `(name, organization_id)` and run **one pass per organization** under a walled
    posture — the framework built-ins (`platform_admin`, `org_*`, `everyone`,
    `guest`) included, matching `sys_user_position`, which is already
    per-organization, and matching both objects' own `unique: 'organization'` name
    index.
  - Seeding also fires on **organization creation**, not only at `kernel:ready`, so
    a tenant created after startup does not administer an empty catalog until the
    next restart.
  - `single` posture is **unchanged**: exactly one organization-less pass, which is
    the correct shape there.
  
  An organization-less row is now invalid state under a walled posture. Nothing is
  reaped — grants (`sys_user_position`, `sys_position_permission_set`,
  `sys_user_permission_set`, `sys_record_share`) point at these rows by id, so
  deleting them would revoke standing access with no signal at the moment of loss.
  Instead a per-organization pass that meets pre-fix organization-less rows for
  names it seeds **says so loudly**, naming the rows and the remedy, and still
  creates that organization's own copies. The failure this closes is the silent
  no-op: a tenant-threaded pass that sees the old row through the driver's
  compatibility arm, reads the name as already represented, and creates nothing
  while reporting success.
  
  Two enforcement-plane reads are scoped in the same change, because the exposure
  they carry only exists once per-organization copies exist:
  
  - `resolveUserAuthzContext`'s position name-sweep (`@objectstack/core`) resolved
    `sys_position` by name across **every** organization, so the junction read
    behind it collected another organization's `everyone` binding — a cross-organization
    grant bleed, and an O(organizations) read on the per-request path. It is now
    threaded through the driver's tenant chokepoint, keeping per-request resolution
    O(the caller's own organization's catalog).
  - plugin-security's permission-set `dbLoader` resolved sets by name unscoped,
    with a `limit` equal to the number of names — correct while one row existed per
    name, a truncation the moment copies exist. It is now scoped to the caller's
    organization and its bound widened.
  
  Boot reconciliation is O(changed declarations): each pass reads what its
  organization already has and writes only where a declaration actually differs, so
  the common boot performs no writes at all. Steady state rides the
  organization-creation hook.
  
  Cross-links #10119 / PR #10422, whose criteria-sweep scoping makes per-organization
  sharing rules cheaper than the unscoped sweep they replace.
- 3ee8ddf: fix(security): **BREAKING** — `sys_position` retires the `permissions` column (ADR-0049 enforce-or-remove, #9885)
  
  Maintainer ruling 2026-08-20: **REMOVE**. The column — a "JSON-serialized array
  of permission strings" textarea — was declared on the platform position table
  while **no producer ever wrote it and no runtime path ever read it**. The
  object-scoped census (every `sys_position`-naming file, with same-object
  positive controls resolving `active` / `delegatable` / `is_default` / `name`
  to real readers) measured it at zero on both sides: the builtin and declared
  position bootstrappers set `label` / `description` / `managed_by` / `active` /
  `is_default` only, and position→grant resolution consults
  `sys_position_permission_set` rows plus the position `name` — never this
  column. Its only reference was the `clone_position` action copying it between
  rows (a copy of a value nothing writes), removed in the same stroke. objectui
  was searched under the same discipline: no console surface names the column.
  A free-text grant catalogue on a security object that no runtime enforces
  tells an author — human or AI — that direct position-level permission strings
  are a platform capability; they are not. This is an **accept-set narrowing**:
  the platform stops declaring, projecting and accepting the column.
  
  Migration (FROM → TO):
  
  | Wrote | Write instead |
  |---|---|
  | `permissions` on a `sys_position` seed row or data-door write | Delete the key. Capability reaches a position **only** through permission-set bindings (`sys_position_permission_set` rows, created in Setup or by an app's kernel:ready binder); prose that was documenting intent belongs in `description`. |
  
  One-line fix: delete `permissions` from any authored `sys_position` row.
  
  <!-- adr-0087: registered position-permissions-column-retired -->
  
  Enforcement after the removal is loud, not silent: the engine's schema
  preflight refuses an undeclared field with `400 INVALID_FIELD` before the
  driver or any hook runs, and `PositionSchema`'s strict parse now rejects a
  declared-position `permissions` key with guidance naming the binding table.
  Physical columns on already-deployed databases are untouched (ADR-0045 schema
  sync is additive). If position-level direct grants ever become a real need,
  the column is re-declared **with a runtime reader in the same PR** —
  declare-and-enforce or don't declare.

### Patch Changes

- 02b3b07: Point every runtime-emitted documentation URL at the canonical host, and retarget the
  metadata-protection `docsUrl` at a page that actually exists.
  
  Two defects, one string. The host half: `docs.objectstack.ai` is an alias that redirects
  to `https://objectstack.ai` path-preservingly, so nothing here was a broken link — it was
  the unratified spelling sitting in the places a user copies from. The CLI's spec-version
  advisory, the Setup and Studio in-app overview pages (English and Chinese alike), and a
  showcase demo action now all name the canonical host.
  
  The path half is the real fix. All 29 `protection.docsUrl` values on the platform's
  system objects and apps pointed at `/adr/0010-metadata-protection`, and `/adr/...` is not
  a route on any host: the docs site mounts `content/docs` under `/docs`, `docs/adr/` is
  not published, and no redirect source lives outside the `/docs` space. The slug was wrong
  too — the record is `0010-metadata-protection-model.md`. Studio renders this URL as a
  link in the lock banner, so an operator asking why an item is locked was being sent
  nowhere. They now point at `https://objectstack.ai/docs/references/shared/protection`,
  the published reference for the very schema that carries the field.
- 5886ee6: Stop issuing two DB queries for questions already answered earlier in the same
  request (#10757). One authenticated `GET /data/:object?$top=1` measured **24 DB
  queries before, 23 after** — **22** when the caller opts out of the count.
  Measured with `X-OS-Debug-Timing: json` on `pnpm dev:crm`, whose `Server-Timing`
  carries `db;dur=…;desc="N queries"`.
  
  **`$count=false` now skips the COUNT query** (`@objectstack/metadata-protocol`).
  The parameter has been declared (`ODataQuerySchema.$count`), aliased on the wire
  (`$count` → `count`), reserved out of the implicit-field-filter bucket,
  arity-checked and boolean-coerced for a long time — and then deleted unread, so
  every paginated list ran `engine.count()` whether or not the caller wanted a
  total. It is honoured now:
  
  ```
  GET /data/task?$top=25              → { records, total, hasMore }   (unchanged)
  GET /data/task?$top=25&$count=true  → { records, total, hasMore }   (unchanged)
  GET /data/task?$top=25&$count=false → { records, hasMore }          (no COUNT query)
  ```
  
  Read the shape of that carefully before adopting it:
  
  - **Only an explicit `false` opts out.** An ABSENT `$count` still counts and
    still reports `total`. OData reads absent as "omit the count", and taking that
    reading here would silently strip `total` from every existing caller — none of
    them send the parameter, all of them read the number. The asymmetry is
    deliberate and pinned by tests.
  - **`total` is OMITTED, never estimated.** `FindDataResponse.total` is declared
    optional ("if requested"), so absent is the declared shape for "not
    requested". A caller that opted out and then reads `total` gets `undefined`,
    not a plausible-looking guess — guard the read (`total ?? undefined`) or do
    not send `$count=false`.
  - **`hasMore` is still answered**, from the page alone: a full page means there
    may be more. Same page-local rule the `$search` path already uses.
  
  **A find and its COUNT resolve permission sets once, not twice**
  (`@objectstack/plugin-security`). `findData` answers a paginated list with two
  engine operations, and the security middleware runs on both; each pass re-read
  `sys_permission_set` for the same context with identical bindings. The
  resolution is now memoized per execution context — a `WeakMap` keyed on the
  context object, which is built once per request and collected with it, so
  nothing outlives the caller it was resolved for — and **retired by any write**:
  a process-wide epoch is bumped on every `insert`/`update`/`delete` the engine
  middleware sees, ahead of the `isSystem` bypass so a seeder, a package publish
  or an auto-org-admin grant invalidates too. A context whose grants are rewritten
  in place re-resolves as well (the memo key covers `positions`, `permissions`,
  `principalKind` and the presence of `userId`). No authorization answer is reused
  across a write, across a context, or across a request.
  
  Not a fix for the whole cost: the remaining ~22 queries per authenticated
  request are session resolution, grant resolution, localization and metadata
  reads that repeat on every request. Removing those needs cross-request caching
  with an invalidation design, which is deliberately not in this change.
- b20c8d2: **Durability fix:** the two boot-time **summary** reports now reach a logger sink that has no `error` method, instead of printing nothing at all (#9748).
  
  `SweepLogger.error` and `ProjectionLogger.error` are both declared **optional**, and both summaries were spelled `logger?.error?.(…)` — an optional call that emits **nothing** when the method is absent. #9657 repaired the six per-row reports of this shape; it could not see these two, because `check:durability-log-level` only judges a call inside a `catch`, and a summary sits after the loop. Against a `{ info, warn }` sink the result was that the repair made the split **worse**: the per-row detail arrived at `warn` while the count of failures vanished, so the detail and the total reported through different channels.
  
  - `sweepStrandedOutbox()` — *"N stranded `sys_email` row(s) could NOT be delivered"*. Mail the platform **accepted** and never delivered, previously summarised to nobody.
  - `reconcilePermissionSetProjection()` — *"N FAILED backfill(s)"*. Worse than a plain omission here: the `else` branch carrying the `info` "reconciled" line is skipped too, so such a sink heard **neither** — the reassuring half-truth this rule exists to remove, arrived at from the other side.
  
  Both now reach for `error` and fall back to `warn`, never to silence — the same repair shape #9657 applied to the per-row lines. A sink that **does** have `error` is unaffected and still gets the summary at `error`; a downgraded level is a degradation of the channel, never of the message, so the consequence and the fix survive the fallback intact.
  
  Also enforced from now on: `check:durability-log-level` grew a **summary limb** that judges a report keyed on the counter a durability-critical `catch` accumulated into, so this class cannot regress silently. The limb never second-guesses a chosen log **level** — it only checks that a call that reaches for `error` can actually print.
- 6ceaa4b: docs: name packages that exist in seven published documents, and gate the class (#10893)
  
  A published README ships inside the npm tarball, so an install instruction in one
  reaches every reader of the package. Nine `@objectstack/` names across seven
  published documents named a package that is in **no directory of this repo**, and
  five of those sat on `import` lines inside runnable fences.
  
  `check:published-readme-exports` could not see any of it, by construction. It
  resolves a documented import against the package's built type surface through the
  workspace member map, so a specifier that is not a member has no type entry to
  compare against and the gate reads no further — strict about a member that exists,
  silent about one that does not. The gate now makes the member-existence claim
  first: an `@objectstack/`-scoped specifier that names no workspace member is a
  finding, and the run header prints the scoped population as `N/N` so a recogniser
  that stops matching shows up as a denominator that fell.
  
  What each dead claim now says, and why:
  
  - **`@objectstack/trigger-schedule`** and **`@objectstack/trigger-record-change`**
    each misnamed **themselves**. Both READMEs — including their `# ` titles and
    every fenced import — said `@objectstack/plugin-trigger-…`, a name that has
    never been published. The exported class names (`ScheduleTriggerPlugin`,
    `TimeRelativeTriggerPlugin`, `RecordChangeTriggerPlugin`) were correct all
    along; only the package name was wrong, so this is a rename pinned by each
    package's own `name` field.
  - **`@objectstack/plugin-security`** told readers to `install
    @objectstack/plugin-org-scoping` and register an `OrgScopingPlugin` from it. No
    such package exists. The organization wall ships as the enterprise
    `@objectstack/organizations` runtime, whose `OrganizationsPlugin` registers the
    `org-scoping` service this plugin probes — the name `objectstack serve` and
    `objectstack doctor` both print. Asking for the wall without it is a refusal to
    boot (ADR-0093 D5), not a silent downgrade, and the page now says so. The
    tenant-isolation bullet pointed at `@objectstack/service-tenant`, which is the
    cloud control-plane runtime from the separate `cloud` repository and not where
    the wall comes from either.
  - **`@objectstack/service-package`** described packages being "delivered to
    runtime kernels that load them through `@objectstack/service-marketplace`". That
    package was never built: ADR-0003, ADR-0016 and ADR-0025 all name it as future
    work. The loading half that does exist here is
    `@objectstack/cloud-connection`'s `MarketplaceInstallLocalPlugin`.
  - **`@objectstack/embedder-openai`** had a fenced example importing
    `KnowledgeTursoPlugin` from `@objectstack/knowledge-turso` — the worst shape,
    because a reader pastes it. No knowledge adapter in this repository consumes an
    `IEmbedder` at all: `knowledge-memory` and `knowledge-ragflow` take no embedder
    option, and the adapters the contract is written for are not here. The example
    is now the `embed()` surface that does exist, with the gap stated rather than
    papered over with a substitute package name.
  - **`@objectstack/driver-sqlite-wasm`**'s "When to use" table compared it against
    `@objectstack/driver-sqlite` and `@objectstack/driver-postgres`. Neither has
    ever existed; `@objectstack/driver-sql` covers PostgreSQL, MySQL and SQLite
    through Knex, choosing the client from its optional peers.
  - **`@objectstack/spec`**'s published `prompts/architecture.md` instructed code
    generators to write `import { User } from '@objectstack/protocol'`. The package
    is `@objectstack/spec`, which the same sentence names as the path being
    replaced.
  
  Four `@objectstack/` names that are **not** in this repo are deliberately left as
  they are, because prose may name a package this repo does not build and a runnable
  import may not: `@objectstack/security-enterprise` (the enterprise edition, whose
  install hint the CLI prints and a CLI test pins), `@objectstack/service-tenant`
  (the cloud runtime), `@objectstack/framework` (the umbrella install name), and the
  two names `service-datasource`'s README recalls as its own past.
- 145ba75: docs: repair the dead repo-relative targets in four published READMEs (#10813)
  
  A published README ships inside the npm tarball, so a dead relative link in one
  is shipped to every reader who installs the package. Nine of them were measured
  across four packages, and nothing read them: `check:published-readme-links`
  checked docs-site URLs, `check:published-readme-exports` checked fenced import
  lines, and the lychee lane never sees `packages/**/README.md`.
  
  `@objectstack/runtime` carried six dead targets. Each was traced to where the
  content actually went rather than deleted:
  
  - `MINI_KERNEL_GUIDE.md`, `MINI_KERNEL_ARCHITECTURE.md` and
    `MINI_KERNEL_IMPLEMENTATION.md` were deleted from the repo root in January as
    "redundant markdown files" (d709ecce68 — 14 files, 5051 deletions, nothing
    added). The kernel reference they described is the docs site now, so the
    Documentation section is the same footer eight sibling READMEs already use.
  - `examples/host/` was renamed to `examples/app-host`, then `apps/server`, then
    `apps/objectos`, and finally split out to `objectstack-ai/cloud`. In-repo, an
    HTTP server in front of the runtime is `@objectstack/plugin-hono-server` plus
    the `@objectstack/hono` adapter, so the bullet points there.
  - `examples/msw-react-crud/` became `examples/app-react-crud`, then
    `apps/console`, and now ships as `@object-ui/console` from another repo.
  - `test-mini-kernel.ts` was a root-level scratch script; this package's suite is
    179 test files under `src/`.
  - The section also ended on a truncated bullet with an unterminated backtick
    (`` - `packages/runtime/src/ ``), which is now a real pointer to that suite.
  
  The other three packages: `@objectstack/hono` and `@objectstack/service-package`
  still spelled `@objectstack/driver-sql` as `../../plugins/driver-sql`, stale
  since the driver moved to `packages/drivers/` (#5618). `@objectstack/plugin-security`
  and `@objectstack/service-package` linked three packages that are in no directory
  of this repo (`plugin-org-scoping`, `service-tenant`, `service-marketplace`);
  those links are dropped and the names kept as code spans, which is the spelling
  those same files already use for a package they cannot point at in-tree. Whether
  those three packages exist at all is a separate question, filed separately.
- b419135: Report a metadata-store OUTAGE as an outage, not as an absent declaration
  (#10424). When an object's security posture cannot be resolved, the refusal
  now consumes the `degraded` verdict `IMetadataService.getDiagnosed` was already
  computing and discarding (#5840), so a store that could not answer no longer
  wears the sentence written for an object that was never declared — "Check that
  the object is declared and published on this runtime" sent operators to
  re-check a healthy declaration in the middle of an incident. The refusal now
  names the store, says the declaration may well be fine, and the operator log
  line carries a grep-able `DEGRADED` / `metadata-store OUTAGE`.
  
  Explanation and logging only. The deny is unchanged in every case — same
  `PermissionDeniedError`, same `PERMISSION_DENIED`, same 403, still fail-closed
  per #3545 — and the set of requests that are accepted or rejected does not
  move: the resolving read is untouched and `getDiagnosed` is consulted as a
  separate best-effort probe on the path that is already refusing. A metadata
  service that does not implement the optional `getDiagnosed` reports `unknown`
  and keeps the previous wording; it is never reported as an outage.
- 88e32a8: `SecurityPlugin.start()` binds its report sink **above** the two bail-outs, so a
  degraded boot no longer leaves the plugin permanently unable to report (#10706).
  
  `private logger … = {}` is an empty object from construction, and
  `this.logger = ctx.logger` was its only assignment — sitting in the "capture
  handles" block, **below** the two `return`s that fire when `objectql`/`metadata`
  cannot be resolved, or when the engine carries no `registerMiddleware`. On
  either path the field stayed `{}` for the **lifetime of the instance**. Every
  report site is written `this.logger.warn?.(…)`, so an unbound sink is not a
  state any caller can notice: the reports simply do not happen. The assignment
  now runs immediately after the `Starting Security Plugin...` line, before either
  bail-out can be taken.
  
  Boot behaviour is otherwise unchanged, and that is pinned rather than asserted:
  both bail-outs still `return`, the middleware and the `security` service are
  still **not** registered on those paths, and both bail-outs still report through
  `ctx.logger` — which was always a real sink, so the bail-out itself was already
  loud. What was silent was the plugin's own field afterwards.
  
  Scope note: this is independent of the open design call on #10556 about what the
  default sink should be. Only the **placement** of the binding changes; the `= {}`
  default itself is untouched, and the fix is correct under every option there.
  
  Reachability, measured rather than assumed: every in-repo caller of the two
  public methods that report through the field (`checkAuthoredRowWrite`,
  `getReadFilter`) reaches them through the registered `security` service, and
  that service is registered *below* the bail-outs too — so on a bailed-out boot
  there is no live consumer. The defect was latent, not live. It is still a defect
  on its own terms: a sink that can never be bound after an early return is
  unrepresentable as a state the code can notice.
  
  New pin: `start-logger-binding.test.ts`.
- 24ba050: **Message change (no behaviour change):** a data-plane read against an object that exists only as an **unpublished draft** now says so, instead of reporting an internal security step (#10401).
  
  The refusal itself is unchanged and stays fail-closed (#3545): same `PermissionDeniedError`, same `PERMISSION_DENIED` code, same HTTP 403, same `[Security] Access denied` prefix — which is a **matcher** the transports read as "this is a 403", not house style. Nothing here widens access, and no access decision branches on the new information.
  
  What changed is what the refusal *says*. One sentence — "the security posture of object 'X' could not be resolved for operation 'find'" — covered two conditions with two different remedies, and described neither: because it named a *security* step, every reader took it for a permissions problem and went looking for a sharing rule to change. Measured downstream (objectstack-ai/cloud#1481): an end-user AI turn asked "how many customers do I have?" against a draft-only object, spent seven tool calls oscillating between a metadata plane that said the object existed and this refusal, then told the user the object was "missing its sharing/visibility setting" — confident, professional, and wrong. On a free plan that one turn also exhausted the daily allowance.
  
  The two conditions are now separated:
  
  - **The object has a `sys_metadata` draft and no published row** → *"object 'X' is not published — a draft declaration exists but no published one … Publish the object to make it queryable. This is NOT a permissions problem …"*.
  - **The declaration genuinely cannot be read** (never declared, or a metadata-store outage) → the pre-existing clause **verbatim**, so any surface matching `the security posture of object 'X' could not be resolved for operation 'Y'` keeps matching, followed by the remedy and the same explicit statement that permissions are not the lever.
  
  Both sentences, and the operator log line beside them, are derived from one module (`unresolved-posture.ts`) shared with the explain engine's `object_crud` layer detail. Enforcement and explanation stating one refusal in two drifting wordings is the defect shape this closes, so the wording is a single source rather than two literals.
  
  The discriminator comes from a **best-effort** `sys_metadata` probe that runs only on the path already refusing, reads under a system context (so it cannot re-enter the middleware), and fails safe in one direction only: any failure — no `sys_metadata` in the deployment, an unprovisioned store, a driver error — reports the both-conditions wording rather than a claim. A posture that resolves never probes at all.
- Updated dependencies [8f04d9a]
- Updated dependencies [6936d07]
- Updated dependencies [59eb04d]
- Updated dependencies [9f05b7d]
- Updated dependencies [3b2af5e]
- Updated dependencies [7d2d112]
- Updated dependencies [5fa0d72]
- Updated dependencies [8cc8401]
- Updated dependencies [02b3b07]
- Updated dependencies [914c413]
- Updated dependencies [55809a0]
- Updated dependencies [ee2ff45]
- Updated dependencies [47cd3ec]
- Updated dependencies [52db1d1]
- Updated dependencies [5649efb]
- Updated dependencies [9d7d2de]
- Updated dependencies [c815c50]
- Updated dependencies [795ea05]
- Updated dependencies [2306a76]
- Updated dependencies [e5ea701]
- Updated dependencies [26f3588]
- Updated dependencies [a40dcc1]
- Updated dependencies [def0d3e]
- Updated dependencies [8d0bb79]
- Updated dependencies [5acb58d]
- Updated dependencies [2e3cf95]
- Updated dependencies [4c93387]
- Updated dependencies [504c8d5]
- Updated dependencies [a037f7c]
- Updated dependencies [3ee8ddf]
- Updated dependencies [16cef97]
- Updated dependencies [a79bd35]
- Updated dependencies [6ceaa4b]
- Updated dependencies [15ea214]
- Updated dependencies [de19489]
- Updated dependencies [c684d00]
- Updated dependencies [923c424]
- Updated dependencies [0ab81d1]
- Updated dependencies [1ec36b7]
- Updated dependencies [5f2e54c]
- Updated dependencies [189373b]
- Updated dependencies [35ad101]
- Updated dependencies [ceb33a9]
- Updated dependencies [dccbcec]
- Updated dependencies [05bc692]
- Updated dependencies [73d9795]
- Updated dependencies [8012960]
- Updated dependencies [266654d]
- Updated dependencies [f34f56b]
- Updated dependencies [f399618]
- Updated dependencies [75e9301]
- Updated dependencies [f334d66]
- Updated dependencies [2810695]
  - @objectstack/platform-objects@17.2.0
  - @objectstack/spec@17.2.0
  - @objectstack/core@17.2.0
  - @objectstack/metadata-core@17.2.0
  - @objectstack/formula@17.2.0

## 17.1.0

### Minor Changes

- 720ee95: fix(security): the shipped admin permission sets no longer grant export on the `*` wildcard (#8681)
  
  <!-- adr-0087: registered admin-export-wildcard-removed -->
  
  **BREAKING for any deployment whose administrators export today.** Landing after
  the v17.0.0 cut, so it ships as `minor` under the lockstep launch-window
  convention; the migration prescription is registered under protocol major 18,
  where `objectstack migrate meta` users will look.
  
  `admin_full_access`, `organization_admin` and the derived
  `organization_admin_no_bypass` shipped `objects['*'].allowExport = true`. That
  single line made the 17.0 export axis **undeniable** for anyone holding an admin
  set: an application could declare an object exportable by nobody, ship it, and
  the platform would export it anyway.
  
  Measured on 17.0.0 GA — 40 export probes, 5 principals, 8 objects, real Bearer
  tokens — an org owner exported `crm_quote` (9 rows), `crm_campaign` (13) and
  `crm_task` (15) with 200 and full data. No app permission set granted export on
  any of the three, and the app had no way to say no:
  
  1. the wildcard lives in code-package metadata, so editing it answers
     `403 [not_overridable] Metadata item 'permission/admin_full_access' is
     provided by a code package`;
  2. the org admin holds no app-authored permission set, so there is nowhere to
     author the per-object `allowExport: false` that would otherwise have won.
  
  **This was never a gate defect.** The same run proves the export gate exact for
  every other principal: a token refused on one object exports another on the same
  route, granting `allowExport` at runtime flips 403 to 200, and revoking it flips
  it back. A plain member carrying `'*': { allowExport: true }` exported too — the
  wildcard was simply doing what it said. What changes is that the platform stops
  shipping that grant.
  
  This is #5491 applied to the export axis. That change removed `member_default`'s
  CRUD wildcard because a wildcard in a set every principal resolves is not a
  default but a floor no app can get under; the export wildcard survived by
  omission rather than by decision, one tier up.
  
  **Migration — grant `allowExport` explicitly in an app permission set where
  admin export is intended.** There is no automatic replacement, deliberately:
  which principals may take a bulk machine-readable copy of a table is the
  segregation-of-duties judgement the axis exists to make explicit.
  
  ```ts
  // In YOUR app's permission set — not a platform set (those are not overridable).
  {
    name: 'system_admin',
    objects: {
      crm_account: { allowRead: true, allowExport: true },  // export intended
      crm_quote:   { allowRead: true },                     // export withheld
    },
  }
  ```
  
  ⚠️ **Nothing fails at parse time, and the shipped sets are re-seeded on
  upgrade.** A deployment that upgrades without editing anything is valid metadata
  whose administrators have quietly lost export on every object no app set names —
  the first sign is a support report, not an error. Verify behaviourally: sign in
  as an org owner and call `GET /api/v1/data/<object>/export`, expecting 200 where
  export is intended and 403 `EXPORT_NOT_PERMITTED` where it is not.
  
  **What is deliberately unchanged.** READ is untouched — an admin still sees
  every record they saw before; this narrows bulk egress only. `allowExport` on a
  `'*'` entry remains a supported, honoured authoring shape in an app's own sets.
  Specific-over-wildcard precedence is unchanged (an explicit per-object entry
  still overrides the wildcard). The `viewAllRecords` / `modifyAllRecords`
  super-user bits still do not imply export, exactly as before. And an app's own
  admin set already gets precisely its declared posture — declared `false` answers
  403, declared `true` answers 200 — which is what makes withdrawing the platform
  grant safe rather than merely restrictive.
  
  Both admin sets are fixed together, and the org-admin pair from one declaration
  (`organization_admin_no_bypass` is derived from `organization_admin`). Fixing
  one and not the other was rejected outright: a half-closed export boundary reads
  as closed and is not.
- cc5c07b: fix(plugin-security)!: an insert that omits a required master-detail parent answers `400 VALIDATION_FAILED` with `fields[]`, not a `[Security]`-prefixed `422` (#8688)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves.
  No spec property, object or field is renamed, retired or tombstoned — the change
  is confined to which HTTP error envelope one runtime condition answers with
  (`assertControlledByParentWrite`'s insert leg), and both envelopes already exist
  in ADR-0112's closed vocabulary. There is no metadata an upgrader could migrate:
  an app's declarations are byte-identical before and after, and the only consumer
  action is branching on `VALIDATION_FAILED` instead of `MISSING_REQUIRED_FIELD`
  for this one condition, which is prose in this changeset rather than a
  prescription `objectstack migrate meta` could carry out. -->
  
  **BREAKING (error contract).** On an `insert` into a `controlled_by_parent`
  detail whose master reference is absent, the platform used to answer:
  
  ```
  HTTP 422
  code  : MISSING_REQUIRED_FIELD
  error : [Security] Missing master reference: insert on 'crm_contact' did not
          supply 'crm_account'. …
  fields: (absent)
  ```
  
  It now answers the same envelope every other missing-required-field case
  answers — `400 VALIDATION_FAILED`, carrying `fields[]` with
  `{ field, code: 'required' }` — wherever required-field validation provably
  refuses that omission. A client branching on `code === 'MISSING_REQUIRED_FIELD'`
  for this condition must branch on `VALIDATION_FAILED` instead; a client already
  handling the platform's ordinary missing-field envelope needs no change and
  gains the field it could not previously highlight.
  
  **What was wrong.** `assertControlledByParentWrite` runs in the security
  middleware chain, *outside* the executor that calls `validateRecord`, so on an
  insert it short-circuited required-field validation on the one field they
  share. One user-visible condition therefore had two answers on adjacent
  branches of the same field: absent → `422` with no `fields[]`, present but
  unresolvable → `400 VALIDATION_FAILED` with `fields[]`. A form could highlight
  the offending input in the second case and not the first, and any surface
  rendering the message string showed a missing required field as a security
  refusal. Measured live on 17.0.0 GA over REST.
  
  The two harms could not be separated: both transport doors emit `fields[]` only
  for the `VALIDATION_FAILED` duck-type and each overwrites `code` when it
  matches, so "add `fields[]` while keeping `MISSING_REQUIRED_FIELD`" is not a
  reachable throw shape.
  
  **The stand-down is CONDITIONAL, and the residue is deliberate.** It applies
  only where `validateRecord` really does refuse the omission: a `master_detail`
  declared `required: true` and not `readonly`/`system`. For three other
  declarable shapes — a `master_detail` with no `required`; `required` +
  `readonly`; `required` + `system` — the validator skips the field before its
  required check ever runs (`if (def.system || def.readonly) continue;`), so the
  master gate is the only thing refusing the insert. There it keeps answering
  `422 MISSING_REQUIRED_FIELD` exactly as before. A flat hand-over was measured to
  mint a detail row with a null master FK, which the `controlled_by_parent` read
  filter (`fk IN (readable masters)`) can never match — readable by nobody, and
  answering `422` on every later by-id write.
  
  **So the envelope asymmetry is not gone, it is confined** — to precisely those
  three declarations, and no further. But confined is not unreachable: #8772
  *proposes* a publish-time lint that would refuse them, and that issue is open
  and unruled, so nothing refuses them at publish today. A `master_detail` with
  no `required` draws only a non-blocking `warning`; `required` + `readonly` and
  `required` + `system` draw nothing at all. An app can therefore newly declare
  any of the three, publish cleanly, and still see the old
  `422 MISSING_REQUIRED_FIELD` with no `fields[]` — so treat these shapes as a
  live surface to avoid authoring into, not as a legacy tail that is already
  closing. One further residual, narrower still: a
  `controlled_by_parent` object whose relation resolves through the required-*lookup*
  fallback also keeps the `422` — validation would cover it, but the ruling covers
  `master_detail`, and widening a ruling is not the implementer's call.
  
  **Unchanged, and pinned as unchanged:** a master that is *present but not
  writable* by the caller still answers `403 PERMISSION_DENIED — requires edit
  access to its master record`. The stand-down is keyed on the FK being absent;
  every access leg still runs when one is supplied. The stored-row shape (a by-id
  write whose persisted FK is null) also keeps its `422`: the caller sent no such
  field, so a `fields[]` naming it would name a field that was never in the
  request, and no payload the caller could send would fix it.
  
  **One pin was rewritten deliberately**, not adjusted to match new behaviour: the
  `[#7474]` six-envelope truth table's **insert** leg in
  `controlled-by-parent-sharing.test.ts`. Its successor asserts both sides of the
  condition — the covered shape hands over (the executor is reached, and the real
  `validateRecord` refuses with `VALIDATION_FAILED` + `fields[]`), and each
  uncovered shape still gets the `422` (with the real validator raising nothing on
  the same payload, which is why the gate must stay). The truth table's other
  legs are update-path and are untouched.
  
  This supersedes the 2026-08-11 envelope choice on #7474, on that ruling's own
  rationale: if a detail without its master is "precisely a required value that is
  absent", the platform's contract for a required value that is absent is
  `400 VALIDATION_FAILED` with `fields[]`.
- 6feac91: **Security boundary change — this WIDENS who may write rows that are refused today.** On an ADR-0055 `controlled_by_parent` detail, the ADR-0055 master gate is now the sole row-level write authority: the platform's wildcard ownership floor (`owner_only_writes` / `owner_only_deletes`, `created_by == current_user.id`) is no longer applied to such a detail at the by-id write pre-image gate. A by-id UPDATE or DELETE of a child row **created by another user** now succeeds whenever the caller may edit that child's master — where it previously answered `403` `record_access_denied`. Maintainer ruling 2026-08-15 on #8757 (delegated adjudication).
  
  What the widening rests on: `assertControlledByParentWrite` — the object's declared write gate — already runs on the same operation, immediately after the pre-image gate, under a superset of its guard, and it refuses whenever the master is not editable. The floor is handed to that gate, not removed. Callers who could not edit the master are refused exactly as before, with the master gate's own sentence instead of the record-access one.
  
  Why it was wrong before: `controlled_by_parent` means "access derives from the master", and the detail declares nothing about who may write it. Two gates were answering one write, and the stricter — a creator-only rule no author wrote — always won: `SharingService.checkEdit` abstains on the `public`-mapped model before reaching its `modifyAllRecords` branch, so ownership depth, an `edit`-level `sys_record_share` and Modify All Data were all inert on a detail.
  
  Deliberately unchanged, each measured:
  
  - **BULK (AST) writes keep the floor.** `assertControlledByParentWrite` returns early with no single id, so nothing would replace it there. The floor is dropped from the by-id call site, never from the object's posture alone.
  - **Delegated (on-behalf-of) by-id writes keep both principals' floors**, matching ADR-0090 D10's existing exclusion at this gate.
  - **INSERT and the read path are untouched** — an insert has no pre-image and so never carried the floor; the floor is `update`/`delete`-only.
  - **App-authored policies are untouched** (provenance, ADR-0105 D3), Layer 0's tenant wall is untouched, and a detail that authors its own `select` policies still derives its write scope from them (#7665).
- 5f5e234: fix(security): `sys_permission_set.active` and `sys_position.active` now actually stop granting access (#8613)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
  added, renamed or retired. `active` is a ROW property of a `sys_permission_set`
  / `sys_position` record, not a key on `PermissionSetSchema` (which is a strict
  object in `packages/spec` and deliberately declares no such key — see
  `permission-set-projection.ts`'s ROW_STATE_COLUMNS). No spec schema, export or
  stored metadata shape changes, so there is no conversion to register and no
  tombstone to write. The change is a runtime predicate at the authorization
  resolution seam; the remedy for an affected deployment is operational
  (re-activate rows that were switched off), not a metadata migration. -->
  
  **BREAKING for deployments that already switched a permission set or position
  off.** Both objects ship a Deactivate action whose confirmation dialog promises,
  in all four locales, that access stops:
  
  > Deactivate this permission set? Existing assignments stay in place but stop
  > granting access until re-activated.
  > Deactivate this position? Users keep their assignment but the position stops
  > granting permissions until re-activated.
  
  Nothing read the column. Measured on the real resolver: a position seeded
  `active: false` still granted its permission sets, and a permission set seeded
  `active: false` still returned `posture: PLATFORM_ADMIN` with its system
  permissions. Deactivation moved a badge in Setup and nothing else — while the
  admin who had just revoked a compromised or over-broad grant was told the
  opposite, and whose likely next step was therefore *not* the action that would
  have worked (delete the set, or remove the assignments).
  
  **What changes at runtime.** `resolveAuthzContext` / `resolveUserAuthzGrants`
  (`@objectstack/core`) — the single seam every transport resolves authorization
  through — now drop a deactivated row **before** any derivation:
  
  - a deactivated `sys_position` no longer contributes its
    `sys_position_permission_set` grants, and its name leaves `positions` (so the
    name-reuse path cannot resolve the same grant one layer down);
  - a deactivated `sys_permission_set` contributes no name, no
    `system_permissions`, no `tab_permissions`, **and no `PLATFORM_ADMIN`
    posture** — the flag is applied before the posture is derived, not after;
  - the `plugin-security` DB loader applies the same predicate, which is what
    judges a set reached by NAME through an active position of the same name.
  
  Both tables were already read at that seam, so this costs **zero new hot-path
  queries**.
  
  **⚠️ Read this before upgrading.** Any `sys_permission_set` or `sys_position`
  row currently carrying `active: false` **stops granting the moment this
  lands** — on live data, with no migration step to notice. That is the correct
  direction (it is what the dialog said when someone clicked Deactivate), but on
  an installation that used the switch believing it was inert it is a real
  revocation. Before upgrading, list the deactivated rows and re-activate any that
  are still meant to grant:
  
  ```
  GET /api/v1/data/sys_permission_set?filters=[["active","=",false]]
  GET /api/v1/data/sys_position?filters=[["active","=",false]]
  ```
  
  A row whose `active` column is **absent or NULL** is unaffected: the predicate
  is "explicitly deactivated", never "explicitly active", so rows that predate the
  column keep granting exactly as before.
  
  **Break-glass, closed in the same change** (`@objectstack/plugin-auth`).
  Enforcing the flag opened a one-click, installation-wide lockout: deactivating
  `admin_full_access` un-makes every platform admin at once, through a payload
  that touches neither `name` nor any identity table, and re-activating requires
  the permission the click just took away (the seeders deliberately never
  reconcile `active`, so no restart restores it). The last-administrator guard now
  judges that write like the delete and rename spellings it already refused, and
  an environment whose break-glass set is *already* off is read as emptied rather
  than as a bootstrap window — so it does not silently disarm the guard for every
  other identity write. Re-activation itself stays permitted, or the refusal would
  have no way out from inside the product.
- 0ccea4a: fix(security): security explain reports partial masking — the field-mask layer gains the third state instead of calling gated fields hidden and gate-less rule fields readable (#9127)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable
  changes. No `packages/spec` property is added, renamed, retired or tombstoned:
  `field.maskingRule` was minted by #8993 and is untouched here, and the explain
  report's own schema (`ExplainLayerSchema`) keeps its exact shape — the fix
  lands entirely in what the `fls` layer's existing `verdict` and `detail` say.
  There is no stored data to migrate and no author-facing spelling to convert. -->
  
  #8993 landed partial masking on the enforcement channel: a field declaring
  `maskingRule` is no longer deleted from a masked caller's response, its value
  is **replaced** (`13812345678` → `138****5678`), with the field's
  `requiredPermissions` acting as the unmask gate. The access-explanation
  engine's field-mask layer predates that and read only the binary mask, so on
  the one surface whose whole job is to describe enforcement it stated two
  things that were not true:
  
  - a field with `maskingRule` **and** a `requiredPermissions` gate the caller
    does not hold was listed under *"N field(s) masked from responses"* — an
    admin reading the report concluded the key was absent, while the caller was
    in fact receiving the partially masked value;
  - a field with `maskingRule` and **no** gate was reported under *"No
    field-level masking applies"* — invisible in the report, and masked for
    every non-system caller in reality.
  
  Both directions matter, and they fail opposite ways: the first overstates the
  protection in place, the second hides that any applies at all.
  
  The `fls` layer now reports the three states the enforcement path actually
  produces — **hidden** (key deleted), **partially masked** (key served, value
  replaced, the applicable rule named) and **readable** — and answers `narrows`
  whenever either dimension bites, where a gate-less rule previously produced
  `not_applicable`.
  
  **Mirrored, not re-derived.** The composition deciding which rules apply to a
  caller — `computePartialMaskRules` AND the explicit-deny exclusion that a
  permission-set `readable: false` still wins outright — is lifted into one
  method on the plugin (`computeReadPartialMaskRules`) that the result-masking
  middleware, the readable-field projection and now explain all call. The
  hidden/partial split in the report is `FieldMasker.maskResults`' own rule
  (`!(field in rules)`), so the report cannot disagree with the masking it
  describes. A second, independent derivation inside the explain engine is
  exactly how this drift opened in the first place; `security-service.ts`'s
  module contract claims explain *"matches enforcement by construction"*, and
  this restores that for the partial-mask dimension.
  
  **Breaking for direct embedders of the engine** (hence `minor`, not `patch`):
  `ExplainEngineDeps` gains a **required** `getPartialMaskRules`. It is required
  rather than optional on purpose — the field-mask decision has three outcomes
  and the existing binary `getFieldMask` can express only two, so an engine
  wired without it would silently reproduce both misreports above. A compile
  error is the correct way for that omission to surface. Callers going through
  `SecurityPlugin` / the `security` service's `explain()` — every consumer in
  this repo — need no change.
- 3851f87: Partial field masking (#8993): `FieldSchema` declares `maskingRule` — a closed
  preset enum (`phone`, `id_card`, `bank_account`, `email`, `name`) plus a
  `{ keepHead, keepTail }` escape hatch — and plugin-security's `FieldMasker`
  enforces it in the same PR (ADR-0049 declare = enforce; the key re-enters the
  schema only with its runtime consumer attached, honouring the 2026-06 prune in
  spirit).
  
  A field declaring a rule is served masked-but-recognisable (`138****5678`) to
  every non-system caller; the field's `requiredPermissions` (ADR-0066 D3) is the
  unmask gate — holders of all listed capabilities read the full value. A
  permission set that marks the field non-readable still deletes it entirely.
  Masking rides the single runtime channel, so API callers, browser users, the
  CSV/XLSX export route and the AI-context interceptor all see the same
  deterministic, length-preserving masked value. Masked callers cannot filter,
  sort, group or aggregate on the field (403, the FLS predicate-oracle guard),
  and a write that round-trips a masked placeholder is refused with
  `400 VALIDATION_ERROR` instead of silently overwriting the stored value.
  New exports: `FieldMaskingRuleSchema`, `FieldMaskingKeepSchema`,
  `FIELD_MASKING_PRESETS`, `maskFieldValue`, `MASK_CHAR`.
- 73cfddf: fix(security): **BREAKING** — `sys_user_permission_set` retires the `delegated_from` column (ADR-0049 enforce-or-remove, #9730)
  
  Maintainer ruling 2026-08-18: **REMOVE**. The runtime delegation gate is
  structurally scoped to `sys_user_position` — `isDelegationWrite` returns `false`
  for every other object, so `assertSelfDelegation` was unreachable for
  `sys_user_permission_set` — and the explain engine reads delegation provenance
  from position rows only. On the permission-set grant table the column was
  therefore declared and data-door-writable while **no runtime consumer read
  it**: its only enforcement was the authoring-time lint rule requiring a
  `reason` on delegation rows, which a row written through the generic data door
  never meets. A declared-but-unenforced writable column on a security object is
  the declare-not-enforce trap in its pure form — an author stamping
  `delegated_from` on a permission-set grant believed they constrained
  delegation, and nothing refused or honoured it. Producers measured at zero:
  the only object literals naming both the table and the column were lint test
  fixtures.
  
  Migration (FROM → TO):
  
  | Wrote | Write instead |
  |---|---|
  | `delegated_from` on a `sys_user_permission_set` seed row or data-door write | Delete the key. Provenance prose belongs in `reason` (still declared on both grant tables); actual delegation-of-duty belongs on `sys_user_position`, where `delegated_from` remains declared **and** runtime-enforced (ADR-0091 D3). |
  
  One-line fix: delete `delegated_from` from any authored `sys_user_permission_set` row.
  
  <!-- adr-0087: registered ups-delegated-from-column-retired -->
  
  Enforcement after the removal is loud, not silent: the engine's schema
  preflight refuses an undeclared field with `400 INVALID_FIELD` before the
  driver or any hook runs, so a stale seed or client write is told exactly what
  to remove. Physical columns on already-deployed databases are untouched
  (ADR-0045 schema sync is additive); the platform stops declaring, projecting
  and accepting the column. The sibling `sys_user_position.delegated_from` — the
  enforced half of ADR-0091 D3 — is untouched, pinned by test. If
  permission-set-granularity delegation ever becomes a real need, the column is
  re-declared **with a runtime reader in the same PR** — declare-and-enforce or
  don't declare.
  
  The docs' per-object grant-column table (`content/docs/permissions/
  authorization.mdx`) now records the retirement, and the security-posture
  lint's D3 rule is scoped to the position table (see the `@objectstack/lint`
  changeset).

### Patch Changes

- cf0d902: fix(security): the `controlled_by_parent` master-editability check consults the same app-authored write widener the by-id path does (#8679)
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable surface
  changes: nothing is added, renamed, retired or tombstoned in `packages/spec`.
  This is a behavioural fix inside one existing gate, which now asks an
  already-shipped question at a second call site. -->
  
  `crm_campaign_member`-shaped objects — ADR-0055 `controlled_by_parent` details —
  route every insert/update/delete through `assertControlledByParentWrite`, which
  asks whether the caller may EDIT the master. That gate's record-sharing leg
  hard-refused on `canEdit === false` **without ever asking whether an app-authored
  RLS update-widener admits the master row**. The by-id write path has asked
  exactly that since #5493 (merged as PR #6909), where the deferral was installed
  on the sharing middleware's refusal branch.
  
  So one principal, one master record and one operation got **two different
  answers depending on who was asking** — measured on 17.0.0 GA with real Bearer
  tokens, one variable (who created the master), everything else identical:
  
  | step | master created by ADMIN | master created by the caller |
  |---|---|---|
  | PATCH the master itself, by id | **200** | 200 |
  | INSERT a child | **403** | 201 |
  | UPDATE a child | **403** | 200 |
  | `security/explain` update on the master, record-scoped | **`allowed=true`** | `allowed=true` |
  
  The master write and the platform's own `explain` verdict both said yes; only the
  derived write disagreed, refusing with `master '...' not editable by this user
  (record sharing)` — naming the very layer #6909 had already taught to defer.
  
  **The fix consults the same composition, and does not relax the check.** The
  verdict comes from `checkAuthoredRowWrite` — the method
  `SharingService.probeAuthoredRowWrite` passes straight through to — so the answer
  at this call site is byte-for-byte the one a direct by-id write of that master
  would get. There is no second copy to drift, which matters because a duplicated
  permission composition is how the two paths diverged. The question is asked for
  `update`, matching the two legs already above it: this gate's subject is edit
  access to the master, never the detail's own verb.
  
  Nothing else widens. The object-level `update` grant and the master's own
  write-RLS leg run first and still refuse on their own terms; `admit` retracts
  only the record-sharing leg's refusal, exactly as an `admit` on the by-id path
  hands the row to the pre-image gate rather than authorizing anything. Every other
  outcome — `abstain`, no authored policy, a `check`-only policy, a principal-less
  or delegated context, a throwing probe — leaves the refusal untouched, and the
  method is fail-closed in the `abstain` direction, so no failure mode here can
  open access.
  
  The regression proof drives both directions on one fixture and refuses to be
  satisfiable by a relaxation: the RLS-widened master **permits** the derived write
  **and** a principal with no widener and no share is still refused on the same
  route with the same payload. A transferred master (write RLS admits via the
  platform floor, record sharing refuses because the owner is someone else) keeps
  the record-sharing leg itself pinned live — deleting that leg outright would
  otherwise leave the suite green — with an `edit`-level share admitting the same
  row and a `read`-level share still refusing it.
- 498f4e8: fix(security): `controlled_by_parent` detail writes compose the master's ownership floor the same way a direct write does (#8865)
  
  **This change widens a permission boundary, deliberately and with maintainer
  approval (ruling of 2026-08-15, direction 1): children of a master become
  writable by every principal whose record-sharing verdict on that master is
  `allow`.** That is the same set which already reaches the master itself — the
  widening restores a symmetry the platform declares, it does not mint a new
  capability — but it is a real widening and it is stated here rather than
  softened.
  
  ## What was measured
  
  `assertControlledByParentWrite` (ADR-0055, step 2.8) resolves master-edit access
  in two legs. Leg 1 — the master's own write RLS — computed
  `computeRlsFilter(master, 'update')` with **no** `dropPlatformOwnershipFloor`,
  while the by-id write pre-image gate (step 2.7) computes the same filter for the
  same object with that knob set whenever `ISharingService` answers `allow`. So the
  platform's ownership floor (`created_by == current_user.id`, shipped by
  `member_default`) was dropped on the direct path and left standing on the derived
  one, and one principal, one master row and one `update` got two answers:
  
  | step | verdict before |
  |---|---|
  | PATCH the master `camp_mkt` directly, by id | allowed |
  | UPDATE a child of `camp_mkt` | `403 … requires edit access to its master record (master 'crm_campaign' not editable by this user (row-level security))` |
  
  The principal in that measurement holds `modifyAllRecords` on the master, which
  is exactly what makes the sharing verdict `allow` and drops the floor on the
  direct path; it did not create the master, so the undropped floor refused it on
  the derived path. Every widening mechanism the platform declares — ownership at
  write DEPTH, an `edit`-level `sys_record_share`, `modifyAllRecords` — was
  therefore inert **for children** while it worked **for the master itself**. An
  app author saw a master they could edit and children they could not.
  
  This is the divergence #8679 closed in leg 2 (record sharing), surviving one leg
  over, and it is closed the same way: one principal, one row, one operation must
  not get two answers.
  
  ## The change
  
  Leg 1 adopts step 2.7's composition, clause for clause:
  
  - ask `resolveSharingWriteVerdict('update', master, masterId, …)` — the tri-state
    verdict, not `canEdit`'s boolean projection — and drop the platform ownership
    floor **only** on `allow`;
  - ask it only when a platform floor policy is actually applicable to this
    (principal, master, `update`), so an object with no floor in play spends no
    sharing probe;
  - `abstain` and `deny` both leave the floor standing, and the verdict answers
    `deny` when its own probe throws, so no failure mode of this composition can
    widen;
  - the on-behalf-of path (ADR-0090 D10) is excluded, mirroring step 2.7: a
    delegated write keeps **both** principals' floors, exactly as before.
  
  Only the PLATFORM's floor is droppable (provenance, ADR-0105 D3). An app-authored
  policy — including one spelling the identical predicate — reaches the compiler
  untouched and still refuses (ADR-0049), and Layer 0 (the tenant wall) is not
  affected at all. Step 2.7's composition and the insert leg's #8688 stand-down are
  untouched.
  
  ## Pinned
  
  The residual assertion the measuring run left in the tree
  (`controlled-by-parent-detail-write-authority.test.ts`, labelled `RESIDUAL
  (#8865)` with the comment "When #8865 lands the assertion above flips") now
  asserts the permission, and keeps its witness — the same principal, the same
  master row, the same operation, asked directly — so the two paths cannot drift
  apart again without a red.
  
  A new section pins the flip to the composition rather than to a relaxation, each
  case varying one input and asserting the direct write of the master agrees:
  
  - an `edit`-level `sys_record_share` on the master — and nothing else — is what
    moves a child write from refused to permitted;
  - an owner-less master, where `checkEdit` abstains for everyone (Modify All Data
    included), keeps its floor and refuses on both paths — the case that separates
    the ruled `=== 'allow'` composition from the boolean projection;
  - an app-authored master policy still refuses a principal whose sharing verdict
    is `allow`, while the same write without that policy is permitted.
- 4c178c1: fix(security): the ADR-0091 D5 attestation columns stop claiming a recertification review the platform does not run (#9046)
  
  `last_certified_at` and `certified_by` are declared on both grant tables
  (`sys_user_permission_set`, `sys_user_position`) as the ADR-0091 D5
  recertification *substrate*. A whole-tree sweep over `packages/`, `apps/` and
  `examples/` — every `.ts`/`.tsx`, tests included — finds the pair in exactly two
  kinds of place: those two declarations and the generated i18n bundles carrying
  their strings. **No producer and no consumer.** Nothing stamps either column,
  nothing reads either one, and no surface derives "never certified" or
  "certification stale" from them. The sweep is not blind: the sibling ADR-0091
  columns on the same objects all resolve to real enforcement — `valid_from` /
  `valid_until` through `isGrantActive` at resolution time, `reason` and
  `delegated_from` through the delegated-admin gate and the security-posture lint.
  
  Their descriptions nonetheless stated D5's intent as though it were the
  behavior — *"When this grant was last attested in a recertification review. Null
  = never certified"* and *"Reviewer who last attested this grant."* Access
  recertification is a compliance control (SOX / ISO 27001 access review), so that
  misreading is the expensive kind: an admin walking `plugin-security`'s objects,
  or an AI agent authoring against this model, takes a populated `Last Certified
  At` as evidence of a review the platform never performed and never checked.
  
  ADR-0049 enforce-or-remove, settled the way `sys_capability.active` was
  (maintainer ruling, 2026-08-13): **the claim is withdrawn in prose.** Building
  the review workflow is a designed feature with no measured pull, and dropping
  shipped columns costs a migration over existing rows while buying nothing the
  prose fix does not — the harm here is the promise, not the storage, and a
  description is one line to change back if D5 is ever implemented. The columns,
  their types and their storage are untouched; no producer and no consumer is
  added, deliberately.
  
  Both descriptions now state the inertness outright rather than merely omitting
  the promise, so a reader who remembers the old wording is told it was wrong
  instead of being left to infer it. All four locale bundles carry the corrected
  text.
- 8656d67: fix(plugin-security): the derived capability seeder's skip is counted and warned instead of leaving the platform bucket silently unseeded (#8536)
  
  **This does not change what the seeder does. It changes whether an operator can
  tell what it did.** No adoption, no backfill, no new writes — the #5876 guard
  keeps declining an authored row, which is the ruled behaviour (#8552 settled the
  posture on an occupied platform bucket: keep declining, loudly).
  
  `bootstrapSystemCapabilities` derives a placeholder `sys_capability` row for any
  capability a bootstrap permission set grants by name. Its lookup runs under the
  system context, which carries no `tenantId`, so it reads **across
  organizations** — and when the row it finds is one it does not own, the #5876
  guard `continue`s before any insert is attempted.
  
  Before #8461 that was harmless, because `name` was unique installation-wide: "a
  row resolves this name" and "the platform holds a row for this name" were one
  statement, which is exactly what #5876's reasoning rests on ("the capability
  resolves and the authored copy is the better one"). Per-organization uniqueness
  (ADR-0120 D1) separated them. An organization's row now satisfies the lookup
  while the platform's NULL-organization bucket is **never written at all**, and
  nothing said so: `skippedAuthored` moved, and that counter cannot distinguish
  "an authored copy was left alone" from "the platform's definition exists
  nowhere".
  
  The skip now reads the platform bucket once — on that branch only, the same cost
  the curated half already accepted — and warns with the curated half's
  provenance-naming shape: it names the `managed_by` and organization it **read**
  off the blocking row rather than asserting an ownership verdict, states which of
  the three bucket observations it saw (free / held by an unstamped row / held by
  a row with a named provenance), and carries the #8552 hand-resolution line only
  where a row an operator may legitimately rename is what blocks the bucket. Where
  an organization's row is what stands in the way, the message says there is
  nothing to remove — that row is a supported ADR-0066 D1 extension.
  
  The warning fires only where the platform's own placeholder is genuinely
  **absent**, so it means one thing. A skip that declines a mere refresh — the
  placeholder is present and simply was not the row the cross-organization lookup
  selected — stays summary-only, as #4632 decided.
  
  `CapabilitySeedResult` gains `unseededDerived`, a documented **subset** of
  `skippedAuthored` rather than a split of it: the existing counter keeps its
  meaning and its value, because the two facts are separable only since #8461 and
  neither should be inferred from the other.
- e9534a4: A durability failure reported to a logger without `error` is no longer lost
  
  Six degradation reports — a lost `sys_audit_log` row (CRUD, auth-event and
  read-audit writers), a stranded `sys_email` row, and the two permission-set
  metadata backfill failures — were spelled `logger?.error?.(…)`. `error` is
  declared OPTIONAL on those sinks, and an optional call emits nothing at all when
  the method is absent: a host injecting a `{ info, warn }` logger received no
  report whatsoever, on exactly the paths whose whole point is that nothing else
  looks broken afterwards.
  
  Each now reaches for `error` and falls back to `warn`, never to silence. The
  message, its consequence and its fix are identical on both channels; only the
  level degrades, and only when the sink cannot do better.
  
  `AuthEventAuditLogger` additionally declares the `warn?` method it needs for
  that fallback, matching `ReadAuditLogger`, which always had it. The addition is
  optional, so no existing sink stops satisfying the interface.
- 4ea921c: Repair the ADR-0090 `sys_role` → `sys_position` rename in the es-ES object
  translation bundles, and guard it mechanically.
  
  The rename half-landed in Spanish: an unreviewed substring find-replace produced
  two non-words (`Puestoes` as the plural of `Puesto`, and `contpuesto` where the
  replace ate the unrelated word `control`), while nine further leaves in
  `plugin-security` and three in `plugin-sharing` were missed entirely and still
  named the pre-rename concept. In `plugin-sharing` the same picklist key rendered
  two different ways in one file — `position` was `Puesto` on the sharing rule and
  `posición` on the record share, and `unit_and_subordinates` read `Rol y
  subordinados` (naming the removed role concept) against `Unidad de negocio y
  subordinados` on its sibling.
  
  Spanish-facing admins saw `Puestoes` as the object's plural label in navigation
  and list views, and two different words for one recipient kind across two Setup
  screens.
  
  Two regression guards now cover the classes involved: a malformed-compound and
  stale-term check on the renamed security objects, and a self-consistency check
  asserting that a picklist option key shared by several sharing objects renders
  identically within a locale. Neither needs a reader of the locale to review it.
- 42b05af: feat(security): the explain engine reports a DEACTIVATED permission set / position as a held-but-not-resolving contributor state, sharing one vocabulary with the ADR-0091 expired state (#8714)
  
  ADR-0091 validity windows and the ADR-0049 `active` switch are structural
  siblings — both resolution-time, fail-closed filters that can make a grant a
  user visibly held yesterday stop resolving today. The explain engine narrated
  only one of them: an expired grant reported "held until … — expired", while a
  deactivated permission set or position simply vanished from
  `layers[].contributors[]`, answering exactly like a grant that never existed.
  Deactivation is an incident-response, installation-wide control with no date on
  the user's own grant row, so the silence hit precisely where attribution
  matters most.
  
  Per the 2026-08-18 maintainer ruling, the two lifecycle controls now share ONE
  "held but not resolving, because X" vocabulary:
  
  - `@objectstack/spec`: `ExplainLayerSchema.contributors[].state` widens from
    `['active', 'expired']` to `['active', 'expired', 'deactivated']` — a closed
    enumeration of reasons, extended only deliberately (an unknown state such as
    `'suspended'` is still refused, and stays pinned as refused). Widening only:
    every payload that parsed before parses unchanged.
  - `@objectstack/plugin-security`: the explain-only provenance pass re-reads the
    grant rows it already walks (`sys_user_position`, direct
    `sys_user_permission_set` grants at the existing by-id `sys_permission_set`
    read) and reports a held row whose catalogue entry is switched off as
    `{ state: 'deactivated', via: 'held — deactivated' }`, judged by the same
    shared `isRowActive` predicate the resolver enforces with. The resolver's
    fail-closed dropping is untouched — this is presentation, never aggregation.
    A row both expired and deactivated reports `expired` (one reason per row,
    resolver drop order).
  
  Internal (not a public contract): `buildContextForUser`'s context annotation
  `expiredGrants` is replaced by `droppedGrants`, one array whose entries carry
  the same closed reason enumeration (`state: 'expired' | 'deactivated'`) instead
  of a per-cause sibling array.
- c73eacd: Reconcile audience-binding suggestions per organization (ADR-0090 D5/D9)
  
  `sys_audience_binding_suggestion` rows are per-tenant by construction — a
  package suggests, and a TENANT admin confirms — but the reconciler read and
  wrote through a module-level `{ isSystem: true }` context carrying no tenant.
  On a shared-runtime multi-organization installation that produced ONE
  organization-less row that every tenant read: the first admin to confirm or
  dismiss answered for all of them, while the binding their confirm created
  existed only in their own organization, so every other tenant's users never
  received the package's default permission set and the surface reported the
  suggestion resolved.
  
  - every read and write in the module now carries `{ isSystem: true, tenantId }`
    — the anchor lookup, the "is it already bound?" lookup, and the
    list/confirm/dismiss paths, not just the writes;
  - `reconcileAudienceBindingSuggestions` is the new entry point the runtime
    calls: one pass per organization under a `group`/`isolated` posture, and the
    publishing organization alone on the package-door publish path;
  - pre-existing organization-less rows are reaped before the passes and
    regenerated per organization. Without that, ADR-0120 D3's platform bucket
    keeps showing the old row to every tenant and the per-organization passes
    create nothing at all. No permission binding is touched by the reap.
  
  A `single`-posture deployment is unchanged: exactly one organization-less pass,
  and no reap.
- 712e185: fix(security): platform default permission sets are stamped `managed_by: 'platform'`, so `os meta resync` stops skipping every one of them (#8692)
  
  <!-- adr-0087: not-required (no-migration-prescription) One column value added to
  one seeder's INSERT, plus a reworded warn line. Nothing authorable is renamed,
  retired or tombstoned, so there is no conversion to register — and the ruling
  this implements explicitly prescribes NO migration for existing rows (see
  below), which is the opposite of a migration prescription rather than an omitted
  one. -->
  
  `bootstrapPlatformAdmin` seeded the default permission sets
  (`admin_full_access` / `member_default` / `viewer_readonly` …) **without writing
  `managed_by`**, so the value fell to the declared `defaultValue: 'admin'` on
  `sys_permission_set`. `os meta resync` only reconciles rows the platform still
  owns (`managed_by` absent or `'platform'`), so the platform's own default sets
  took the skip branch — **measured on a real engine: `resynced 0` /
  `resyncSkipped 8`, every shipped set**, each one logged as an *"intentional
  override"* for a row no admin had ever touched.
  
  That is the exact inverse of what the resync flag was built for (#2705:
  *"reconcile the row to the shipped dist so a dev source edit takes effect
  without `--fresh`"*). The command could not perform, for the rows it names in
  its own help text, the one job it exists to do.
  
  **The seed insert now stamps `managed_by: 'platform'` explicitly**, which also
  puts this seeder in line with its two siblings in the same package —
  `bootstrap-builtin-positions.ts` and `bootstrap-system-capabilities.ts` both
  stamp `'platform'` rather than inheriting a default. A fresh install's default
  sets are now platform-owned, and a resync reconciles all of them. Admin-takeover
  protection is unchanged in shape and becomes *real* rather than nominal: a set
  an admin takes over in Setup is stamped `'admin'` by the projection path, so
  platform-seeded and admin-authored rows finally carry **different** values
  instead of the same one.
  
  **Forward-stamp only — existing rows are deliberately NOT migrated.** A stored
  `'admin'` is indistinguishable between "the old seeder's field default" and "an
  administrator took this set over in Setup". Restamping legacy rows to
  `'platform'` would make genuine admin customizations reconcilable and could
  silently overwrite them on the next `os meta resync`, so pre-existing rows keep
  the skip permanently and by decision. Report, don't rewrite. A legacy install
  that wants its platform defaults reconciled has to re-own the rows deliberately
  (or re-seed with `--fresh`) — an operator's choice, not one a boot makes for
  them. The seeder's docblock records this so the next reader finds a decision
  rather than a mystery.
  
  **The skip warning stops claiming intent.** It read
  `… row is admin-owned (intentional override)`; on any pre-existing install that
  sentence is false, because the only writer may have been this same seeder one
  call earlier. It now reads `… row is admin-owned` — provenance and action, no
  claim about anybody's intent.
  
  Two comments asserting that the insert-once posture *"keeps the platform
  defaults env-authored — the posture `bootstrapDeclaredPermissions` relies on"*
  are removed: that reliance was measured false. `bootstrapDeclaredPermissions`
  special-cases only `managed_by === 'package'`; every other value — `'platform'`
  included — falls to the same `skippedEnvAuthored` branch, so its behaviour is
  identical before and after this change.
  
  The pin suite added by the measurement round now asserts both sides of the line
  the ruling drew: a fresh install stores `'platform'` and resyncs everything, and
  a pre-ruling `'admin'` row is still skipped with its content intact.
- 693c788: fix(security): the derived capability seeder owns its row by the same conjunction as the curated half
  
  `bootstrapSystemCapabilities`' DERIVED half tested ownership with `managed_by === 'platform'` alone. That was sufficient while `sys_capability.name` was unique installation-wide; since #8461 made it unique per ORGANIZATION (ADR-0120 D1) it also admits a platform-STAMPED row sitting inside an organization — the shape the file header names ("from seed data or a legacy import") and the shape #8470 refused to let `managed_by` alone stand for on the curated half, because it "would not carry that guarantee". The guard admitted such a row and rewrote its `label`/`description` with `humanize(name)`, which is the precise harm #5876 exists to prevent, while the platform (NULL-organization) bucket was never written. Every counter read zero and nothing was logged, because both #5876's counter and #8536's live on the branch where the guard DECLINES.
  
  The ownership test is now the same conjunction the curated half uses — `managed_by: 'platform'` AND `organization_id: null`. The lookup is unchanged (still cross-organization, by design). This restores a declared invariant rather than widening an accept set: what the derived half may refresh narrows to the rows it provably owns.
  
  **Reachability: a DORMANT asymmetry with a LIVE route — not a live defect.** No shipped artifact in this repository produces such a row: both capability seeders run under a system context with no tenant and never write `organization_id`, `normalizeManagedByVocab` does not touch this object, the admin door refuses the stamp outright (`assertSystemRowWriteGate`), and no `sys_capability` seed dataset exists anywhere in the repo. The ROUTE is nevertheless live and needs no unsupported step, and its load-bearing link is measured rather than argued: the seed loader writes as `isSystem` specifically so seeds can target `sys_*` tables, `defineSeed` type-checks `managed_by: 'platform'`, and on a per-organization replay the loader's tenant stamp short-circuits its own `sys_` exemption when an organization is pinned. Measured against the real seed loader, a `sys_capability` seed carrying `managed_by: 'platform'` was inserted with `organization_id` set when an organization was pinned, and inserted unstamped when none was — so the stamp is the pinning's doing, not a fixture artifact. Not claimed: how many organizations a given deployment replays seeds into is a provisioning question this repo cannot answer. So the fix lands as trap-removal and invariant-restoration, at exactly that severity — worth landing because the mistake would be invisible, ADR-0066 asset ownership forbidding the organization's own admin from editing or deleting the row through Setup.
  
  **Observability.** The newly-declined row flows through #8536's skip branch unchanged, so `skippedAuthored` and `unseededDerived` keep their exact documented meanings and their subset relationship; they simply become reachable on a state the broken guard used to swallow. The misplaced stamp gets its OWN signal, a new `platformStampedInOrg` counter on `CapabilitySeedResult`, rather than being folded into `unseededDerived` — "the platform's definition is missing" and "a row wears the platform's stamp where the platform never writes" are different facts, and the second is worth counting even when the first is false. The warning gains a matching remediation arm; the admin-authored row's "supported extension" sentence would be false here, and its "nothing for an operator to remove" advice would be wrong about the one row Setup cannot touch at all.
  
  **Not changed:** the platform bucket is still not backfilled when another row satisfies the lookup. That is #8552's ruled posture (no adoption, no backfill), shipped for the admin-authored case in #8536; the fix makes the state observable, not repaired, and the suite pins the bucket ABSENT so a future backfill has to fail rather than pass.
  
  `patch`, not `minor`: the behaviour change is a guard declining a row it should never have rewritten, plus diagnostics. `platformStampedInOrg` is a new field on a returned result object, but `bootstrapSystemCapabilities` is a boot-time internal whose only caller ignores the result shape — no consumer reads the type, so nothing gains a capability it can build on.
- c25b2d5: fix(security): comment moderation stops being dead behind the platform delete floor — `sys_comment` gets the per-object delete policy that lets a parent-record editor moderate (#8839)
  
  <!-- adr-0087: not-required (no-migration-prescription) One per-object RLS policy
  added to a shipped default permission set. Nothing authorable is renamed,
  retired or tombstoned, so there is no conversion to register. The behavioural
  change is that a `sys_comment` DELETE by a non-author is no longer refused by the
  platform's ownership floor before plugin-audit's author-or-parent-editor gate is
  consulted. -->
  
  `plugin-audit` implements an explicit **author-or-parent-editor** rule for
  removing a comment — *"Rewriting or removing someone else's words is moderation,
  hence the tighter author-or-parent-editor rule"* — deriving a comment's access
  from the record its `thread_id` names, the way an attachment's derives from its
  parent.
  
  **That rule was unreachable in every org-bound deployment.** `member_default`
  ships a wildcard row-level delete floor:
  
  ```
  { name: 'owner_only_deletes', object: '*', operation: 'delete',
    using: 'created_by == current_user.id', positions: ['org_member'] }
  ```
  
  A parent-record editor moderating someone else's comment holds `org_member` and
  is not the comment's `created_by`, so the floor answered `PERMISSION_DENIED`
  before the moderation rule was ever consulted. The floor is a **second,
  parent-blind implementation** of "who may remove this row", and on `sys_comment`
  it was winning against the one authority that can actually see the parent.
  
  **Why nothing caught it:** the only fixture proving the capability
  (`comments-permission-matrix.dogfood.test.ts` case (d)) booted **org-less**, so
  its principals resolved `positions: ['everyone']`, the positions-gated floor never
  applied, and the case passed over the broken behaviour — #8023's disarm shape.
  
  **The fix is one per-object policy** in `member_default`:
  
  ```
  { name: 'sys_comment_moderation', object: 'sys_comment', operation: 'delete',
    using: 'id != null', positions: ['org_member'] }
  ```
  
  It contributes the **alternate match** that stops the floor pre-empting the gate;
  it does not re-implement the rule. The parent-editor limb is not expressible as a
  row predicate — the authority lives on another record and RLS has no join — so
  `id != null` is every row of this object said plainly, the same spelling and
  reasoning as the existing `sys_invitation_org_admin`. What actually narrows a
  `sys_comment` delete is, in order: the object-level delete bit (this set grants no
  `allowDelete` at all), Layer 0's tenant wall, and then plugin-audit's gate, which
  requires every matched row to pass and fails closed on a thread naming no
  authorizable parent. That gate is not optional — `AuditPlugin` registers
  `sys_comment` and installs the gate in the same `start()`.
  
  ⛔ **The wildcard floor itself is unchanged.** The widening is scoped to
  `sys_comment`, and to the `delete` limb only; the `update` half of plugin-audit's
  rule deliberately stays under the floor.
  
  The `positions: ['org_member']` domain is load-bearing rather than cosmetic: it
  confines the widening to exactly the principals the floor binds. An undomained
  twin would carry a `using` into a delete class that is **empty** today for
  org-less and `everyone`-only principals, switching off the derive-from-select rule
  that currently bounds their writes to their readable set — widening them too.
  
  Access-widening approved by maintainer ruling (2026-08-15), which is what the
  standing manual floor on relaxing an access-control boundary required.
  
  The pin is the fixture, now **armed**: `orgContext: true` plus `assertArmed` on
  both the author and the moderator persona, so the file can never again certify
  moderation from a boot structurally unable to observe the floor. Reverse-verified
  — with the policy removed and the artifact rebuilt, exactly one case reddens with
  `PERMISSION_DENIED` on `sys_comment` and the other nine stay green. The
  stranger-without-parent-EDIT case now asserts its refusal code **exactly**
  (`RECORD_NOT_ACCESSIBLE`, plugin-audit's gate — not the floor's
  `PERMISSION_DENIED`), so the floor silently re-asserting itself over `sys_comment`
  cannot pass as a correct refusal.
- 147eadc: Correct `sys_position`'s translated uniqueness text in the `es-ES`, `ja-JP` and `zh-CN` bundles to say the machine name is unique **per organization**
  
  The English bundle and the object source both already state that a position's machine name is unique per organization — the declared index is `{ fields: ['name'], unique: 'organization' }`. The three other shipped locales still asserted bare, unqualified uniqueness, so an admin reading Setup in Spanish, Japanese or Chinese was told the name had to be free installation-wide, which the declared index does not enforce.
  
  Both places `sys_position` states the rule are corrected:
  
  - `fields.name.help`, the field help in the object's detail and edit views. It now also carries the source's current examples (`sales_manager`, `hr_specialist` rather than the superseded `admin`, `editor`, `viewer`).
  - `actions.clone_position.params.name.helpText`, the help on the Clone Position dialog's API-name input — the text an admin reads at the moment they type a new name.
  
  Leaf string values only — no bundle structure was hand-edited.
- Updated dependencies [56656aa]
- Updated dependencies [c9f5950]
- Updated dependencies [d6e80b2]
- Updated dependencies [07e630e]
- Updated dependencies [66beee0]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [03520eb]
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
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
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
- Updated dependencies [24173e9]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [f8eb736]
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
- Updated dependencies [b6c7690]
- Updated dependencies [3851f87]
- Updated dependencies [845e164]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [7fc01db]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [04f8fdb]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [6158146]
- Updated dependencies [84cb121]
- Updated dependencies [ca19ee8]
- Updated dependencies [a675b4d]
- Updated dependencies [b887013]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [b3f9831]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/platform-objects@17.1.0
  - @objectstack/core@17.1.0
  - @objectstack/metadata-core@17.1.0
  - @objectstack/formula@17.1.0

## 17.0.0

### Major Changes

- 4ed7ed4: feat(security)!: the export axis is now OPT-IN, explainable, and covers reports (#3544, #3710)

  **BREAKING — `allowExport` unset no longer means "inherit read".** Reading a
  record and taking a bulk machine-readable copy of the whole table are different
  privileges (Salesforce "Export Reports", Dynamics "Export to Excel", NetSuite
  "Export Lists", SAP `S_GUI` 61 all separate them). The axis now says so.

  ### Migration — FROM → TO

  |                      | before                              | after                      |
  | -------------------- | ----------------------------------- | -------------------------- |
  | `allowExport` unset  | export **allowed** (inherited read) | export **denied**          |
  | `allowExport: false` | export denied                       | export denied (unchanged)  |
  | `allowExport: true`  | export allowed                      | export allowed (unchanged) |

  **The one-line fix:** add `allowExport: true` to the object entry (or the `'*'`
  wildcard) of every permission set whose holders should keep exporting.

  ```ts
  objects: {
    deal: { allowRead: true, allowExport: true },   // ← add the grant
  }
  ```

  Nothing else changes: read, CRUD, RLS, FLS and sharing are untouched, and a set
  that never exported is unaffected.

  **Who is affected.** Package-shipped sets are re-seeded on upgrade, so the
  built-ins are handled for you — `admin_full_access` and `organization_admin` now
  carry `allowExport: true` explicitly. **Environment-authored sets are not**: any
  custom set whose users export must be edited. `member_default` deliberately does
  NOT carry the grant, so ordinary authenticated users lose export until an admin
  grants it — that is the point of the flip, not an oversight.

  **Merge semantics.** Most-permissive, exactly like the CRUD bits: any set
  granting `true` grants export. `false` and unset are the same outcome; `false`
  is authoring intent, not a veto, because permission sets are additive capability
  containers (ADR-0090).

  **Not implied by super-user bits.** `viewAllRecords` / `modifyAllRecords` no
  longer confer export. Separating "may see all data" from "may take a bulk copy"
  is the segregation-of-duties case the axis exists for.

  ### Also in this change

  - **spec** — a set carrying `allowExport` is now **high-privilege**
    (`describeHighPrivilegeBits`), so it cannot be bound to the `everyone` /
    `guest` audience anchors. Without this the opt-in was defeatable by binding an
    export-granting set to `everyone`. One predicate, so the runtime anchor gate,
    the `@objectstack/lint` security-posture rule and the install-time suggestion
    surface all pick it up together.
  - **spec / plugin-security** — `ExplainOperationSchema` gains `export`, so
    `explain` can answer _why_ a caller got `403 EXPORT_NOT_PERMITTED`. It
    explains as `read ∧ the export grant`: `object_crud` reports the conjunction
    and attributes the granting set, while every data-shaped layer
    (requiredPermissions, OWD/depth/sharing, RLS, record attribution) is computed
    as the `find` the export actually performs — asking the RLS compiler about an
    `export` operation would match no policy and wrongly report "no RLS applies".
    `readFilter` is surfaced for `export` as it is for `read`.
  - **plugin-reports** — closes the reports side door (#3710). A report rendered
    as `csv`/`json` is the same bulk copy of the same object, so it is gated by
    the same `ISecurityService.canExport`. Enforced in `executeReport`, which the
    interactive run, the ad-hoc run and the scheduled dispatch all funnel through;
    `scheduleReport` additionally refuses at create time so an author is not told
    at 3am. A schedule created while granted stops delivering once the grant is
    revoked. `html_table` stays a read — it is a rendered view, not a bulk copy.
    Deployments without `plugin-security` are unaffected (no permission sets
    exist, so the axis does not apply).

  <!-- adr-0087: registered export-axis-opt-in -->

- 9e9445b: <!-- adr-0087: not-required (no-migration-prescription) what this change removes is a VALUE in one platform-seeded sys_permission_set row, not an authorable key. No spec schema key is retired: object_permissions['*'] stays fully authorable, and admin_full_access / organization_admin / viewer_readonly still ship one. Nothing an app authored becomes invalid, nothing stored fails to parse, and the seeded row itself is rewritten by the boot seeder, so there is no stored shape for `objectstack migrate meta` to rewrite and nothing for the ledger to carry. The Migration section below prescribes a DEPLOYMENT action -- declare the object access you were relying on -- not a consumer code or metadata rewrite. -->

  fix(plugin-security)!: `member_default` no longer grants a `*` wildcard — the platform baseline is explicit-allow (#5491)

  **This is a deliberate, breaking narrowing of the default security posture.
  Deployments that relied on the implicit wildcard lose that access. That is the
  intended behaviour change, not a side effect — read the migration below before
  upgrading.**

  `member_default` is the additive `everyone` baseline: it resolves for **every**
  authenticated member, in addition to whatever else they hold. It carried
  `object_permissions["*"] = {allowCreate: true, allowRead: true, allowEdit: true,
allowDelete: false}`, and object permissions merge most-permissively — so that
  entry was not a default, it was a **floor no application could get under**. An
  app's explicit-allow object gate was erased on three of the four axes; only
  delete stayed profile-driven, because the baseline never granted it.

  HotCRM's 17.0 GA sweep measured the consequence across 5 profiles × 17 objects
  (188 probes, each user with their own bearer token):

  - **21 of 21 create-DENIAL probes returned `201`** — every profile created on
    every object once validation passed, including objects the profile explicitly
    denied;
  - a `service_agent` profile that declares no edit anywhere edited its own
    `crm_account`;
  - on `public_read` objects the wildcard yielded **`200` with ALL rows** for
    non-holders — real unauthorized reads, not the documented "200 with 0 rows"
    empty-set pattern;
  - `security/explain` stated it outright for a profile carrying an all-false
    deny: _"create on 'crm_opportunity' is granted by [member_default]"_.

  Because app-side authorization suites validate the app's _declarations_, CI
  stayed green while the runtime posture was default-open — `declared ≠ enforced`
  inside the security layer itself.

  **The change.** The wildcard is removed on all three live axes. The platform
  baseline narrows to explicit-allow: object access now comes from OWDs plus
  profile / permission-set **declarations** only. Deny-precedence merge semantics
  were considered and rejected — permission sets remain additive capability
  containers (ADR-0090); the fix is to stop the platform shipping a grant nobody
  asked for, not to invent a veto.

  What `member_default` still declares, it still enforces, and nothing here is
  newly granted: read on the better-auth identity tables (their writes stay
  denied — that door is better-auth), self-service on `sys_user_preference` (now
  an explicit entry rather than an implicit one; the effective access for a member
  is byte-identical, and its `sys_user_preference_self` RLS carve-out already
  declared exactly that intent), and every row-level policy it shipped before —
  `owner_only_writes`, `owner_only_deletes` and the identity `_self` carve-outs
  are untouched. The set stays anchor-safe, so its `everyone` binding is
  unaffected. `admin_full_access`, `organization_admin` and `viewer_readonly` keep
  their wildcards: those are granted deliberately to a principal, which is exactly
  what the baseline was not.

  ## Migration

  After upgrading, a member holding **no** application profile has no access to
  application objects. Restore access by declaring it, in one of two places:

  1. **Ship an app default profile.** Mark a permission set `isDefault: true` and
     the CLI wires it as the additive per-request baseline (ADR-0056 D7 /
     ADR-0090 D5). This is the recommended route and what the bundled showcase app
     already does — list the objects members legitimately touch, with the axes
     they need.
  2. **Grant per position / per user.** Bind an ordinary permission set through
     `sys_position_permission_set` or `sys_user_permission_set`.

  To find what a deployment was silently relying on, ask
  `GET /api/v1/security/explain?object=<name>&operation=<op>` for a
  representative member before upgrading: any answer attributing the grant to
  `[member_default]` on an application object is access that will stop. An app
  whose own profiles already declare everything its users do is unaffected.

### Minor Changes

- ce5242c: feat(auth,objectql,audit,security,spec): identity-table writes carry the real actor, so `sys_member` history stops saying "system" (#4586)

  better-auth owns every write to the identity tables (`sys_member`, `sys_user`,
  `sys_invitation`, …) and its ObjectQL adapter runs them `isSystem: true` **on
  purpose** — the route already authorized the action under better-auth's own ACL,
  and ADR-0092 D2 refuses user-context writes to those tables outright. The
  consequence was that the human who clicked _make admin_ was known exactly once,
  in the hook layer where the session exists, and then discarded: every
  `trackHistory` transition on `sys_member` recorded `user_id: null` / "system",
  and `sys_user_permission_set.granted_by` was written null by the auto-grant.
  "Who made this person an org admin?" had no answer in the platform's own audit
  log.

  **What changed**

  A request-scoped attribution seam, general rather than a `sys_member` special
  case:

  | Layer                        | Before                             | After                                                                                                                          |
  | :--------------------------- | :--------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
  | `ExecutionContext`           | `userId` / `actor` only            | new optional `attributedUserId` — the human CREDITED for a write the system AUTHORIZED                                         |
  | `HookContext`                | `session`, `user`                  | new `provenance.attributedUserId`, split off the context beside `session`                                                      |
  | better-auth ObjectQL adapter | `{ isSystem: true }`               | `{ isSystem: true, attributedUserId }` when a request scope is open                                                            |
  | audit writer                 | `user_id = session.userId ?? null` | falls back to `provenance.attributedUserId` when the session names nobody                                                      |
  | `auto-org-admin-grant`       | `granted_by: null`, no `reason`    | the attributed human in `granted_by`, plus a machine-provenance `reason` naming the writer and the triggering `sys_member` row |

  Outside a request scope nothing changes: writes stay bare `{ isSystem: true }`
  and audit rows keep recording `null`. Absence is still never upgraded into a
  caller, and never written as a sentinel string (ADR-0118 D1/D2).

  **Hard constraint — attribution is not authority**

  `attributedUserId` is read by exactly one consumer, the audit writer, and by no
  security middleware. It never becomes `ExecutionContext.userId`, so it is never
  the subject the engine authorizes as: not RLS `current_user`, not the ownership
  stamp, not permission resolution. A context carrying only `attributedUserId`
  authorizes exactly like an empty context (ANONYMOUS), and a context carrying it
  beside `isSystem: true` authorizes exactly like `isSystem` alone. Re-authorizing
  identity writes as the human would re-adjudicate a decision better-auth already
  made — the second adjudication track ADR-0095 D3 closed. The constraint is
  pinned by tests at three layers: the engine seam
  (`packages/objectql/src/engine.test.ts`), the better-auth adapter
  (`packages/plugins/plugin-auth/src/auth-actor-attribution.test.ts`), and the
  live HTTP route (a plain member still cannot promote themselves).

  **For authors and plugin developers**

  `attributedUserId` is authorable on `ExecutionContext` and readable as
  `ctx.provenance?.attributedUserId` in hooks. Use it to answer _who is
  responsible_; keep using `ctx.session` / `ctx.user` to decide _what is
  permitted_. The two are separate fields precisely so the distinction cannot be
  blurred by accident.

- 7fb436c: Multi-organization operation is an ENTITLEMENT again: the `group` posture no
  longer activates without the enterprise runtime (ADR-0105 D12 correction).

  The first ADR-0105 wave read D12 as "the `group` wall ships open" and made the
  posture self-activating — it never probed for `@objectstack/organizations`. That
  turned `group` into a free multi-org path around the `isolated` gate (ADR-0081
  D2), and made the weaker isolation the free one, which is not a boundary anyone
  would draw on purpose.

  The distinction that was missed: **open code is not free activation.** The wall's
  implementation has always lived in the open packages — that is equally true of
  `isolated`, whose Layer 0 wall sits in `plugin-security` and is gated on a
  service the enterprise package registers. Cloud ADR-0016's 铁律
  (强制免费、治理收费) guarantees that a deployment RUNNING a multi-org shape is
  safe; it is satisfied by REFUSING to run one unwalled, not by giving the posture
  away.

  ## Changes

  - **`tenancy-service`**: `group` probes `org-scoping` exactly like `isolated`.
    Without it the posture resolves to `single` and reports `degraded`.
  - **`os serve`**: the ADR-0093 D5 boot guard keys off the resolved POSTURE
    instead of `OS_MULTI_ORG_ENABLED`. Previously `OS_TENANCY_POSTURE=group` skipped
    both the enterprise package load AND the fail-fast, silently degrading to an
    unwalled deployment — the exact ADR-0049 class that guard exists to close. A
    `group` request without the runtime now refuses to boot unless
    `OS_ALLOW_DEGRADED_TENANCY=1`.
  - **New seam — the runtime declares what it entitles.** `org-scoping` may expose
    `supportedPostures` (`OrgScopingEntitlement`, `@objectstack/spec/security`);
    the open side honours it and fails closed on anything not listed. Whether
    `group` and `isolated` are one commercial tier or two is packaging policy, and
    packaging policy belongs to the commercial runtime rather than hard-coded in
    open core. Omitting the field entitles every walled posture, so existing
    runtimes are unaffected.
  - **`organization_id` stamping returns to the enterprise runtime.** The previous
    wave moved auto-stamping into the open engine; that removed the closed
    package's only load-bearing runtime duty, so a five-line forged `org-scoping`
    registration would have produced a fully working multi-org deployment. With
    stamping back where it was, a forged registration yields NULL-org rows the wall
    hides — a broken deployment, not an unlicensed working one.

    **Write-side VALIDATION stays open and is unchanged**, including the
    bulk-insert coverage: rejecting a forged `organization_id` is a security
    property, not a packaging one. Only filling an ABSENT value moved back.

  - Default-organization bootstrap returns to `single`-only; every walled posture
    keeps its existing owner (ADR-0081 D1).

  ## Note for operators

  `OS_TENANCY_POSTURE=group` without `@objectstack/organizations` installed now
  **refuses to boot** rather than running single-org. This only affects
  deployments that adopted `group` between the two waves.

- 879ea13: ADR-0105 Phase 0 + Phase 1: group tenancy posture; organization scope as a
  first-class authorization dimension.

  > This release carries BREAKING spec removals (see "Enforce-or-remove" below)
  > but is recorded as `minor`: every publishable package is in the Changesets
  > lockstep group, so one `major` would promote the whole monorepo. Breaking
  > changes ship as `minor` during the launch window — the migration notes below
  > are what reach consumers in `CHANGELOG.md`.

  ## Tenancy is now a spectrum (D1)

  `single | group | isolated`, resolved by the `tenancy` service and selected with
  the new `OS_TENANCY_POSTURE` env var. Existing deployments are unchanged:
  `OS_TENANCY_POSTURE` unset derives the posture from `OS_MULTI_ORG_ENABLED`
  (`true` ⇒ `isolated`, else `single`). An unrecognized value throws at boot
  rather than silently landing in a posture with no organization wall.

  - `single` — no wall (unchanged).
  - `group` — **new.** Organizations are membership boundaries over one shared
    dataset; Layer 0 becomes `organization_id IN accessible_org_ids` (union / MOAC
    semantics). Enforced by the OPEN engine.
  - `isolated` — today's `multi`, renamed. Behavior, enterprise `org-scoping`
    probe and degraded-boot handling all unchanged.

  ## Organization scope is a first-class context field (D2)

  `ExecutionContext.accessible_org_ids` — every organization the caller holds a
  currently-valid membership in (ADR-0091 validity windows) — is resolved once by
  `resolveAuthzContext` and carried by every transport. The `group` wall reads it
  directly; RLS policies may reference it as
  `organization_id IN (current_user.accessible_org_ids)`. An empty or absent set
  fails the wall closed.

  Only the Layer 0 PREDICATE widens. Composition is untouched: the wall is still
  computed independently of the RLS compiler, AND-composed outermost, and
  crossable only by a true `PLATFORM_ADMIN` on a posture-permitting object — so
  ADR-0095's W1/W2 invariants hold in every posture.

  ## Two P0 correctness fixes (D3, D4) — behavior changes

  **D3 — app-authored org-scoped RLS policies are no longer silently dropped**
  (finding F1, framework#3539). `collectRLSPolicies` used to strip any policy whose
  `using` contained the substring `current_user.organization_id` when isolation was
  inactive, which swallowed app-authored policies as well as the platform's own.
  Stripping is now decided by PROVENANCE (identity against the shipped
  declaration). **Upgrade impact:** in a deployment with no organization wall, an
  app-authored policy referencing the active organization is now RETAINED and
  fails closed (zero rows) with a one-time warning, where it previously vanished
  and the object read unscoped. `getReadFilter` shared the defect, so analytics and
  raw-SQL consumers were affected too. If a policy was only ever meant for
  multi-org, delete it or install `@objectstack/organizations`.

  **D4 — `viewAllRecords`/`modifyAllRecords` never cross an organization
  boundary** (finding F2, framework#3540). Under a wall-less posture nothing
  bounded the wildcard superuser bits `organization_admin` carries, so a
  deployment that accumulated organizations (personal orgs on signup) made every
  owner/admin an environment-wide superuser. `auto-org-admin-grant` now grants a
  de-VAMA'd `organization_admin_no_bypass` variant when no wall is enforced, and
  revokes the superseded variant whenever the posture changes. **Upgrade impact:**
  in `single` posture an org owner/admin keeps full CRUD but loses the blanket
  ownership/sharing/RLS bypass. Deliberate deployment-wide visibility remains
  available through `admin_full_access` or an explicitly authored permission set —
  it just stops being a side effect of a better-auth membership role.

  ## Engine-owned organization stamping (D5)

  Under any wall-enforcing posture the engine stamps `organization_id` from the
  caller's active organization on an insert that omits it, and validates every
  supplied value against the wall. Idempotent with the enterprise auto-stamp
  (neither overwrites a supplied value). This also closes a real hole: the
  pre-existing post-image check required a non-array payload, so a BULK insert
  could carry a forged `organization_id` per row. One forged row now denies the
  whole write.

  ## Group structure, extension fields and red-line lints (D6, D7)

  - `sys_organization` gains `parent_organization_id` and `sort_order` — a
    **reporting dimension only**.
  - New lint `validateOrgAxisRedLines` (`org-axis-permission-inheritance`,
    `org-axis-cross-org-bu-grant`), wired into `os lint` / `os compile` /
    `os validate`: an RLS policy or sharing rule that walks the org tree is an
    error, as is a business-unit grant on a platform-global object.
  - Extension fields on better-auth-managed objects ride the existing ADR-0092
    whitelist. A new guard derives better-auth's real field surface from
    `getAuthTables()` at the pinned version and fails the build on any name
    collision, so a library upgrade cannot silently take ownership of a column.

  ## Enforce-or-remove (D11) — BREAKING

  Both removals are of surface that had **zero runtime consumers**, so no
  behavior changes; authoring them is now a no-op instead of a lint warning.

  - **`PermissionSet.contextVariables` — REMOVED.** The RLS compiler never read
    it. FROM → TO: a set a policy needs as `field IN (current_user.<key>)` is now
    supplied by a registered membership resolver (below); a constant belongs in
    the policy itself as a literal (`status = 'published'`).
  - **`Territory` / `TerritoryModel` / `TerritoryType` (`security/territory.zod.ts`)
    — REMOVED.** No runtime object, stack field or resolver existed. FROM → TO:
    matrix requirements are served by multi-position × business-unit anchoring; a
    generalized dimension-security module will arrive with its own ADR.
  - **`ExecutionContext.rlsMembership` — PRODUCTIZED.** The bag the compiler has
    merged since ADR-0056 finally has a producer: register an
    `IRlsMembershipResolver` (`@objectstack/spec/contracts`) under the
    `rls-membership-resolver` service, declaring the keys it owns. Fail-closed by
    construction — an unresolved key makes its policies drop out. Kernel-owned
    keys (`accessible_org_ids`, `org_user_ids`, …) are reserved and cannot be
    overwritten from this seam.

  ## Edition boundary (D12)

  The `group` posture's enforcement primitives ship OPEN — the union wall,
  `accessible_org_ids` resolution, D5 stamping/validation, the D3/D4 correctness
  fixes and the D6 lints — because the correctness of a wall is never a paid
  feature (cloud ADR-0016 铁律「强制免费、治理收费」). `isolated` keeps its existing
  enterprise `org-scoping` probe, so the current commercial boundary for
  legal-entity isolation is unchanged by this release.

- 1ea6bce: feat(sharing): hierarchy managers may manage shares within their write DEPTH (ADR-0111 D1 DEPTH)

  `canManageShares` gains its named DEPTH extension: a caller whose effective
  WRITE scope on the object is a hierarchy scope (`unit` / `unit_and_below` /
  `own_and_reports`) may now manage shares on a record whose owner falls within
  that scope's owner set — the same set the write filter and `canEdit` already
  honour, resolved by the enterprise `hierarchy-scope-resolver`. This lets a
  manager grant/revoke/list shares on a subordinate's record, matching
  Salesforce (roles above the owner) and Dataverse (the `Share` privilege's BU
  depth), without expanding the MVP owner + Modify-All authority.

  - New `ISecurityService.resolveWriteScope(object, context)` — the effective
    write scope, resolved by the same evaluator the CRUD middleware uses; fails
    closed to `own`. Mirrored on the sharing plugin's structural probe.
  - The gate honours only the three hierarchy scopes. `org` from the probe is
    deliberately ignored: it means both a genuine Modify-All holder (already
    granted via `hasWriteBypass`) AND the fail-OPEN "no permission set mentions
    this object" default, so honouring it here would reopen the hole
    `hasWriteBypass` was chosen to avoid.
  - Fails closed with no security service or no enterprise resolver — the open
    edition stays owner + Modify-All, exactly as before.

- c1dcacd: fix(sharing)!: the share-management surface gains the authorization layer it never had (ADR-0111 P0, #3902)

  Record sharing shipped as a data layer with no authorization of its own: every
  `/data/:object/:id/shares` and `/sharing/rules` route authenticated the caller
  and then ran the service under `SYSTEM_CTX` — any signed-in user could revoke
  anyone's share, enumerate who-can-see-what, write self-grants, and define /
  evaluate org-wide sharing rules. ADR-0111's P0 rulings land here:

  - **D1/D2** — `ISharingService.canManageShares(object, recordId, context)`:
    system, the record's owner, or a holder of Modify All Data (probed via the
    new fail-closed `ISecurityService.hasWriteBypass`). Enforced in the SERVICE,
    so every caller is covered; without plugin-security it fails closed to
    owner-only.
  - **D4** — `revoke` is symmetric with grant, validates the share belongs to the
    URL's record (`NOT_FOUND` on mismatch), and refuses non-`manual` rows
    (`CONFLICT` — a rule-materialised grant would be resurrected by the next
    reconcile).
  - **D5** — `listShares` is management-gated (invisible record → `NOT_FOUND`,
    visible-but-not-manager → `PERMISSION_DENIED`), and the open
    `/data/sys_record_share` read surface is self-scoped: non-admin callers see
    only rows naming them as recipient or grantor.
  - **D6** — the whole `/sharing/rules` surface (list/create/get/delete/evaluate)
    requires the new **`manage_sharing`** capability (D9; seeded into
    `admin_full_access`, `manage_platform_settings` honoured as the legacy
    equivalent), enforced in `SharingRuleService`.
  - **D7** — no inert grants: `recipientType` is narrowed to `user` (the only
    type any gate enforces), grants on objects the sharing gates never consult
    (public model, no `owner_id`, bypass, `controlled_by_parent`) fail with
    `SHARING_NOT_ENABLED` (422), and the manual upsert keys on
    `(object, record, recipient, source)` so manual and rule rows coexist.

  **Breaking** for callers that relied on the missing gate: unauthorized share
  management now fails with 403/404/409/422 instead of silently succeeding, and
  `ISharingService.revoke` gained an optional `scope` parameter. The verb
  boundary (edit ≠ delete, ADR-0111 D3) is NOT in this change — it lands as the
  separate P1.

- ad303ed: fix(sharing)!: an edit-level share no longer grants delete (ADR-0111 D3, the verb boundary)

  `update` and `delete` shared one `canEdit` gate, and `canEdit` accepts an
  `edit`-level share — so one "edit" grant silently conferred delete, the
  opposite error from the retired `full` level. A share widens _which rows_ a
  principal reaches, never _which verbs_ they may use (Salesforce Read/Write
  cannot delete; Dataverse `Delete` is a distinct privilege; Odoo splits
  `write`/`unlink`).

  - `ISharingService.canDelete(object, recordId, context)` — ownership (widened
    by write DEPTH) or the `modifyAllRecords` super-user bypass ONLY; an `edit`
    or legacy `full` share does not confer it. `canEdit` is unchanged (the
    update gate, share included).
  - `SharingService.buildWriteFilter` takes a `verb` parameter: a bulk
    `delete({multi:true})` scopes to the owner/DEPTH set alone (no share
    widening), while a bulk `update` keeps it.
  - The sharing middleware routes `delete` through `canDelete` and logs a
    specific fail-closed reason on denial (ADR-0111 D10).
  - `/security/explain` consults `canDelete` for a `delete` operation, so the
    record-level explanation matches enforcement.

  **Breaking**: a caller who could delete a record _only_ through an edit-level
  share (and holds object-level delete CRUD) can no longer delete it — delete now
  requires ownership, write depth, or Modify All Data. No new delete access level
  is introduced; a future per-record delete grant would be a capability mask
  AND-ed with object CRUD, not a fourth share level.

- 328ccc5: fix(security,analytics): scope /analytics/query to the caller's readable records, and refuse a measure over a missing field (#4467, #4437)

  Two defects on the analytics query path, both found by the v17 verification run
  (#3909 / #4482), both reproduced against a live showcase server before the fix
  and re-verified with the same requests after.

  ## #4467 — `/analytics/query` applied no record-level scoping

  `ISecurityService.getReadFilter` documents itself as "the same filter the engine
  middleware AND-s into every find", and exists precisely for paths that bypass
  that middleware — its own doc comment names the analytics raw-SQL path. But the
  chain it mirrors is TWO sibling middlewares: plugin-security's RLS injection and
  plugin-sharing's owner/share visibility filter (`buildSharingMiddleware` AND-s
  `buildReadFilter` into `ast.where` for `find`/`findOne`/`count`/`aggregate`).
  Only the RLS half was ever computed here, and analytics has no other source of
  scope, so the OWD/share predicate simply never existed on that path.

  Live repro: `showcase_private_note` is `sharingModel: 'private'`; an admin owns
  5 notes, a member holds read shares on exactly 2 and no `viewAllRecords`.
  `GET /data/showcase_private_note` correctly returned 2 for the member, while
  `POST /analytics/query {measures:['count']}` returned 5 — and adding
  `dimensions:['title']` returned all five titles, i.e. the VALUES of a column
  that caller may not read, not merely a bad count. Any authenticated caller who
  could reach `/analytics` could enumerate the field values of every row of any
  object exposed as a cube, regardless of OWD, sharing rules, or RLS.

  `getReadFilter` now resolves plugin-sharing's `buildReadFilter` through the
  late-bound `sharing` service and AND-composes it with the RLS filter — the same
  composition the two middlewares reach by both writing into `ast.where`. It also
  computes the ADR-0057 D1 `__readScope` depth that the security middleware
  normally stashes on the context for plugin-sharing to widen its owner-match
  with, using the same `getEffectiveScope` call the middleware makes: no
  middleware runs on this path, and without it a caller granted `unit`/`org` read
  depth would be silently narrowed to `own`. The sharing predicate is resolved for
  every non-system caller AHEAD of the RLS stand-down branches, because those are
  the RLS middleware's own early exits and none of them is a reason to drop a
  sibling middleware's predicate; a sharing-resolution failure denies outright
  rather than falling through to half a scope.

  **Why `minor` rather than `patch`.** This is an observable behaviour change on a
  public read surface, in the narrowing direction: analytics results that a
  principal could previously read they now cannot. Counts drop, `dimensions`
  groupings lose rows, and any dashboard, report, or export built on
  `/analytics/query` over an owner-private object will show smaller numbers for
  non-superuser principals — correctly, but visibly. Deployments that had (however
  unknowingly) come to depend on the unscoped totals will see them change on
  upgrade, so this warrants more than a patch-level note even though it is a
  security fix. No API signature changed: `ISecurityService.getReadFilter`'s
  declaration is untouched — the implementation merely started honouring the
  contract it already documented.

  ## #4437 — a measure naming a missing field 500'd with SQLITE_ERROR

  `inferMeasure('ghost_sum')` maps a suffix convention onto a field name and has
  no way to know the field exists, so it built `SUM(ghost)`, the driver threw
  `no such column`, and the caller got
  `500 {"code":"SQLITE_ERROR","message":"Internal server error"}` — a driver error
  class as the `error.code` for what is a plain typo, which ADR-0112 forbids. A
  dotted spelling took the same path (`measures:['total.sum']` prefix-strips to
  `sum` → `SUM(sum)` → 500). The DATA route has refused the identical mistake with
  a `400 INVALID_FIELD` naming the field since #4315/#4254.

  `AnalyticsService.ensureCube` now validates each measure's resolved source field
  against the backing object's field names before any SQL is built, and rejects
  with the same envelope the data route produces (`400 INVALID_FIELD` carrying
  `field`, `object`, `param`, `measure`) so one mistake has one shape across
  `/data` and `/analytics`. The new `getObjectFieldNames` config hook reads the
  same schema registry `isRegisteredObject` already consults and the data path's
  own gate reads, so "which fields exist" has a single answer across both routes.

  The gate is tiered exactly like the #3867 cube-inference gate, deliberately
  narrow: it applies only when the cube's `sql` is a bare object name (an authored
  cube whose `sql` is a real SQL expression has no field list to check against),
  only when the probe answers (no data engine, or an external datasource whose
  columns are not mirrored locally, stands down), and only to measures whose
  source is a bare column — `count(*)` has no source field, and a dotted
  cross-object reference resolves through a join this layer cannot see, so both
  pass through untouched. `id`/`created_at`/`updated_at` are admitted
  unconditionally, matching the data path's `resolveQueryFields`: a gate stricter
  than the engine it guards would reject queries that used to work. Validation
  runs before the cube is registered, so a rejected query leaves no trace in the
  registry — otherwise a retry would find a "registered" cube carrying the bogus
  measure and sail straight into SQL.

  This half is `minor` for the same envelope reason: a request that used to return
  500 now returns 400 with a different `code`, which is a visible contract change
  for any caller branching on the response.

- 04c56aa: security: add a fail-closed authored-row-write verdict to `ISecurityService`

  `ISecurityService` gains an optional, verdict-shaped, by-id method:

  ```ts
  checkAuthoredRowWrite?(
    object: string,
    recordId: string,
    operation: AuthoredRowWriteOperation, // 'update' | 'delete'
    context?: SecurityContext,
  ): Promise< AuthoredRowWriteVerdict >;  // 'admit' | 'abstain'
  ```

  It answers one question no existing surface could: does an **app-authored**
  row-level security policy admit this row for this write, on its own, with the
  platform's ownership floor taken out by provenance?

  Every other method reports the **composed** RLS verdict, and sitting inside that
  composition is the platform's own wildcard write floor (`created_by ==
current_user.id`, shipped on the `member_default` baseline every authenticated
  member resolves additively). So "the composed RLS admits this row" is true for
  the row's CREATOR whether or not any app policy mentions it — which makes it a
  measurably different question, not a cheaper spelling of the same one. A caller
  deferring to the composed answer would hand transferred records back to their
  former creators.

  `admit` iff at least one applicable, non-floor policy matches the row for the
  operation. `abstain` in every other case — no authored policy, no match, an
  unreadable or cross-tenant row, a principal-less or on-behalf-of context, or any
  internal failure. The method never throws outward, and it is **optional**: a
  deployment whose security service omits it behaves byte-for-byte as before,
  because callers feature-detect and read absence as `abstain`.

  `@objectstack/plugin-security` implements it on the registered `security`
  service, reading the verdict off the same layered RLS computation the middleware
  enforces with — no second RLS evaluator.

- 6dcbbc3: fix(plugin-security): the org-admin auto-grant can actually revoke — demoted admins really do lose tenant admin (#4640)

  `auto-org-admin-grant`'s only delete channel called
  `ql.delete(object, id, { context })`. The engine's signature is two arguments —
  `delete(object, options?: EngineDeleteOptions)` — so the id landed in the option
  bag, `rejectUnknownEngineOptions` read its character indices (`'0'`, `'1'`, …)
  as unknown option keys and threw, and `tryDelete`'s `catch` swallowed it. The
  system context in the discarded third argument went with it.

  That wrapper is the module's **only** delete channel, so all three revoke paths
  were silent no-ops for the module's entire life:

  1. **Demotion and member removal did not take the capability back.**
     `organization/update-member-role` moving someone from `owner`/`admin` back to
     `member` reconciled, deleted nothing, and returned
     `{ action: 'skipped', reason: 'delete_failed' }` while the
     `sys_user_permission_set` row stayed put. That row carries wildcard
     `viewAllRecords`/`modifyAllRecords` → `isTenantAdmin()`, so the demoted user
     remained a **tenant admin**.
  2. **The ADR-0105 D4 superseded-variant convergence never converged.** A posture
     change left the old `organization_admin` / `organization_admin_no_bypass` row
     in force — on a wall-less deployment, that is the unbounded variant.
  3. **The `kernel:ready` orphan sweep never swept** (membership deleted, grant
     left behind).

  The call now matches every other `ql.delete` call site in the repo:
  `ql.delete(object, { where: { id }, context: SYSTEM_CTX })`.

  ## ⚠️ Behaviour change: people will lose tenant admin on upgrade — that is the fix working

  Existing deployments have accumulated `sys_user_permission_set` rows that should
  have been revoked when someone was demoted or removed from an organization.
  After this release the `kernel:ready` backfill reconciles them, and every one of
  those grants is deleted on the first boot. Concretely, on upgrade:

  - users demoted from `owner`/`admin` to `member` at any point in the past
    **stop being tenant admins**;
  - users whose membership was deleted lose their orphaned org-scoped grant;
  - deployments that changed `tenancy.posture` converge on the posture's variant
    instead of keeping both.

  Nobody loses access they were _supposed_ to have: the grade that qualified them
  was already taken away, and only the capability row outlived it. If a specific
  person should keep blanket visibility, grant it deliberately —
  `admin_full_access` or an explicitly authored permission set — rather than
  through a better-auth membership grade. Expect `[security] revoked org-admin
capability` lines in the boot log naming each one.

  Failed revokes are no longer silent either: a delete the datastore rejects logs
  `[security] org-admin grant revoke FAILED — capability still in force`, and a
  reconcile that found grant rows and removed none logs that it left them behind.
  A capability the platform decided to withdraw and could not is exactly the
  outcome that must reach an operator.

- c931e53: Setup can no longer create — or rename a row to — a `sys_capability` whose `name` is in
  the platform's curated set (`PLATFORM_CAPABILITY_NAMES`). **An authoring call that
  previously answered 200 now refuses**: the admin-door data write (`insert`, and `update`
  that renames TO a curated name) is rejected at the security middleware with
  `403 PERMISSION_DENIED` and a message naming the colliding curated name. The affected
  names are the curated registry's members, currently: `manage_users`, `manage_org_users`,
  `manage_metadata`, `manage_platform_settings`, `setup.access`, `setup.write`,
  `studio.access`, `manage_sharing`, `export_data` (maintainer ruling on #8552, applying
  the "refuse a declaration the platform cannot honour" principle — such a row can never
  be the curated capability, and it blocks the platform's own definition from ever
  seeding).

  What is NOT changed:

  - creating capabilities with non-curated names stays open, in every deployment shape
    (including the community NULL-organization-bucket shape with no org stamper);
  - existing colliding rows are deliberately left to the operator (no adoption, no
    provenance backfill — ruling options 2/3 are rejected): they can still be edited, and
    renamed AWAY from the curated name (a payload repeating the row's own unchanged name
    is not a rename and is not refused);
  - the curated seeder's decline-and-warn behaviour on existing collisions stands; its
    per-boot `blockedCurated` warning now also carries one operator-facing remediation
    line (rename or remove the blocking row, then restart, and the platform definition
    seeds);
  - boot/system writes (`isSystem`) — the seeders and package publish — are unaffected.

- 5c04b2a: **The curated capability seeder reconciles the row the platform owns — never an organization's (#8470).**

  `bootstrapSystemCapabilities` upserted each curated capability with
  `find('sys_capability', { where: { name }, limit: 1 })` under a system context,
  i.e. across organizations. Since #8461 made `sys_capability.name` unique per
  ORGANIZATION rather than installation-wide (ADR-0120 D1, closing the
  cross-tenant existence oracle #8323 reports), that lookup can have **two**
  candidates: the platform's own row in the NULL-organization bucket, and one an
  admin authored inside their organization — a supported action (ADR-0066 D1: the
  platform DEFINES, admins EXTEND in Setup).

  Two harms followed, the second worse:

  1. an organization's authored `label`/`description` were overwritten with the
     platform's copy at every boot; and
  2. when the organization's row was the one selected **before** the platform's
     row existed, the seeder took the update branch and the curated definition was
     **never inserted, in any bucket, installation-wide**.

  **Ordering was not the missing property.** #4363's pagination tie-breaker
  already appends `ORDER BY id` to any paged read of a driver-managed table, and
  `limit: 1` counts as paged on both the SQL and MongoDB drivers — so the lookup
  was already deterministic, deterministic on `id`, which says nothing about who
  owns the row. Worse, being stable made it permanent: an installation that picked
  the wrong row picked it again on every subsequent boot instead of self-healing.

  **The curated lookup is now scoped to `managed_by: 'platform'` AND
  `organization_id: null`** — the two facts that jointly define the platform's own
  row, and which together make the result set a provable singleton (the post-#8461
  unique key is `(COALESCE(organization_id, …), name)`, so the platform bucket
  admits at most one row per name). The DERIVED half is unchanged: its own #5876
  guard already refuses to touch a row it does not own.

  The organization's row keeps its authored copy, and the platform's curated row
  is seeded regardless of what any organization has authored.

  **New `blockedCurated` field on the seeding result** (a widened return type —
  breaking for anyone constructing `CapabilitySeedResult` by hand, hence `minor`
  per the launch-window convention). It counts, and warns about, the one collision
  the seeder now declines to resolve by overwriting: a curated name already held
  in the platform bucket by a row the scoped lookup did not match. Previously that
  case was "resolved" by clobbering the other author; now it is refused, and
  refusing silently would be its own defect, since `tryInsert` swallows the
  engine's unique-constraint refusal. The warning states the provenance it
  actually **read** off the blocking row rather than asserting who authored it —
  the seeder observes "no platform-owned row matched, and the insert was refused",
  which is not the same fact as "this row belongs to someone else".

  Reachable and ordinary, not hypothetical: `organization_id` auto-stamping lives
  in the enterprise `@objectstack/organizations` runtime, which is also what
  activates every walled posture — so on a deployment without it (`single`
  posture, no stamper) every Setup-authored capability row lands in the
  NULL-organization bucket.

  No authorization behaviour changes. Grants (`systemPermissions`) and
  requirements (`requiredPermissions`) resolve capabilities **by name**, and no
  runtime code path reads a `sys_capability` row to decide access — so a
  never-seeded curated row was a registry/Setup-listing defect, not a privilege
  one. No migration: an already-overwritten organization row is not restored, but
  it stops being overwritten, and a missing curated row is seeded on the next
  boot.

- 7c7e246: feat(authz): expose the caller's delegable scope — the read half of the
  delegated-administration gate (ADR-0090 D12 / ADR-0105 D8)

  `adminScope` decided writes but could not be READ: `assignablePermissionSets`
  lived only inside `delegated-admin-gate.ts`, so a UI offering "place this
  person in a unit, with these positions" (the D8 scoped-invitation form) had no
  way to narrow its pickers. It would list the whole tree and let the user
  discover the boundary by being refused — which turns an authorization gate into
  a validator and makes the boundary invisible until it bites.

  `ISecurityService.describeDelegableScope(callerContext)` answers it, exposed as
  `GET /api/v1/security/my-delegable-scope` and `client.security.describeDelegableScope()`:

  - `placeableBusinessUnitIds` — union of the subtrees where the caller may place
    people (scopes granting `manageAssignments`);
  - `assignablePositions` — positions whose every distributed permission set the
    caller may hand out (containment check included);
  - `scopes` — the held `adminScope`s with subtrees resolved, for attribution;
  - `isTenantAdmin` — unconstrained, with everything enumerated so a consumer
    renders ONE uniform picker instead of special-casing.

  Computed by the same helpers the write gate enforces with, so an option this
  reports is one `assert()` accepts — a test asserts that agreement directly. It
  NARROWS; the gate still decides.

  Strictly self-scoped: no target-user parameter, so it discloses nothing beyond
  the authority the caller already holds (unlike `explain`, which has one and
  gates it). Fail-closed — unresolvable scopes contribute nothing, a caller with
  no delegated authority gets empty lists, and a deployment without
  `@objectstack/plugin-security` gets 501.

- 9613396: feat(security): ENFORCE the user-level export axis on the server (#3544)

  `allowExport` landed as a spec bit plus a `/me/permissions` annotation, which
  hid the client's Export button — and nothing else. Because `export ⊆ list`, the
  REST export route streams through `findData` and the engine middleware sees an
  ordinary `find` gated by `allowRead`, so no code path ever read the bit: a caller
  holding `allowExport: false` could still `curl
/api/v1/data/:object/export` and drain the whole table. Declared, not enforced.

  - **plugin-security** `PermissionEvaluator.checkObjectPermission('export', …)` is
    now a real decision: `export` = read granted ∧ not explicitly denied.
    `allowExport` stays out of `OPERATION_TO_PERMISSION` on purpose — that map
    means "the bit must be truthy", which would have denied export to every
    permission set authored before the axis existed. The new exported
    `resolveUserExportAllowed()` folds the tri-state across sets (`true` beats
    `false` beats unset) exactly as the `/me/permissions` merge does.
  - **spec** `ISecurityService` gains `canExport(object, context)` — the question a
    bulk-egress door outside the engine middleware has to ask before it reads.
    Fails CLOSED; `isSystem` and an empty set resolution bypass, mirroring the
    middleware.
  - **rest** `GET /data/:object/export` calls it and answers **403
    `EXPORT_NOT_PERMITTED`** before the first chunk is fetched. Distinct from the
    object-level 405 `OBJECT_API_METHOD_NOT_ALLOWED`, which still runs first: 405
    says the object exposes no export, 403 says this caller may not use it. No
    security service (no `plugin-security` ⇒ no permission sets) → allowed, the
    same fail-open posture as every other permission gate in that layer; service
    present but unable to answer → denied.
  - **plugin-hono-server** the `/me/permissions` annotation now falls back to the
    `'*'` entry's export bit when a per-object entry declares none, matching the
    evaluator's own wildcard fallback — so a set that denies export wholesale via
    `'*'` no longer offers a button the server refuses.

  Backward-compatible: `allowExport` is still an opt-out with no default, so an
  unset bit inherits read and existing permission sets behave exactly as before.
  Only a permission set that explicitly sets `allowExport: false` changes — and it
  now changes on the server, which is the point.

  Implementers of `ISecurityService` outside this repo must add `canExport`; the
  interface member is required, matching how `getReadableFields` was added.
  Consumers still feature-detect (`typeof svc.canExport === 'function'`), so a
  partial implementation degrades rather than throwing.

- 6029cc1: Explain and enforcement now resolve ONE authorization aggregation (#6352).

  `buildContextForUser()` — the explain API's reconstruction of an arbitrary user's
  context, behind `explain(request, callerContext)` and the `userId` parameter — was
  a hand-written second implementation of `@objectstack/core`'s `resolveAuthzContext`
  aggregation. Its agreement with enforcement was guaranteed by two comments saying
  it mirrored the resolver ("mirroring the runtime resolver's semantics", "we compute
  it here with the IDENTICAL rule") and by nothing else: no assertion anywhere in the
  repo compared the two.

  It did not agree. Measured over identical rows, the mirror dropped:

  | input                                                          | resolver       | explain mirror |
  | -------------------------------------------------------------- | -------------- | -------------- |
  | `sys_member` role positions (ADR-0095 D3)                      | `org_admin`, … | —              |
  | position-bound permission sets (`sys_position_permission_set`) | resolved       | —              |
  | the `everyone` anchor's bound sets (ADR-0090 D5)               | resolved       | —              |
  | `platform_admin` position projection (ADR-0068 D2)             | projected      | —              |
  | `systemPermissions` / `posture` / `email` / `ai_seat`          | resolved       | —              |

  The user-visible consequence: permission sets are resolved BY NAME from
  `context.positions ∪ context.permissions`, and a set carried by a POSITION only
  becomes a name inside the resolver. So for any user whose grants arrive through a
  position — the ordinary way an org grants access — the explain panel resolved fewer
  sets than enforcement and reported a denial the runtime never made. A security UI
  that says "you have no access" about access you have is worse than no panel.

  `buildContextForUser` now calls `resolveUserAuthzGrants` (core's userId-driven
  resolver core, already the same entry point `runAs:'user'` automation runs use) and
  adds presentation only: the ADR-0091 expired-grant and `delegated_from` annotations
  the resolver correctly discards, and `hasPlatformAdminGrant`, which is now read
  back off the resolver's own posture verdict instead of recomputed. The returned
  context additionally carries `systemPermissions`, `org_user_ids`, `posture`,
  `tabPermissions` and `email` — additive; no field was removed or renamed.

  Pinned by a parity suite that runs both implementations over the same fixture rows
  (org role projection, position-bound sets, the `everyone` anchor, both
  `platform_admin` polarities, `organization_admin` → `TENANT_ADMIN`, ADR-0091
  windows) and asserts each case's concrete expected output, so the pin cannot pass
  by both sides resolving to nothing. Restoring the mirror turns 9 of those cases
  red.

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

- 3208222: feat(security): a tenant-scoped write with no active organization is refused, naming what is missing (ADR-0123 D2, #8247/#8208)

  <!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes changes: no spec key, export or config field is removed or renamed, and no stored shape is affected. The behaviour change is entirely runtime — an authenticated caller in a state that used to corrupt silently now gets a refusal. There is no metadata edit to prescribe, so there is nothing an upgrade guide or `objectstack migrate meta` could carry. -->

  **BREAKING** for one caller state, in the direction of refusing what used to
  corrupt silently: an authenticated, non-system caller with **no active
  organization** writing to a tenant-scoped object under a walled tenancy posture
  (`isolated` / `group`) now receives `403 PERMISSION_DENIED` instead of a `2xx`.

  ### What was happening

  The Layer 0 write-side wall validated **supplied** `organization_id` values
  only. That is the correct guard for a payload naming _another_ tenant, and it
  left the opposite case open: a payload naming _no_ tenant, written by a caller
  who _has_ no tenant. Nothing filled it downstream either — auto-stamping lives
  in the enterprise organizations runtime and has nothing to stamp when the caller
  carries no active organization.

  So the row landed with `organization_id` NULL, and the read wall — correctly,
  by the same posture — then hid it from every reader, including the author who
  had just created it. A write that succeeds and a record nobody can reach.

  ### The rule now (ADR-0123)

  Under an authenticated session with no active organization:

  - tenant-scoped **reads resolve to nothing** (Layer 0's deny sentinel —
    unchanged, silent, HTTP 200);
  - tenant-scoped **`insert` / `update` are refused loudly**, and the message
    **names the missing active organization** rather than reading as a generic
    permission denial;
  - no path stamps a NULL tenant on behalf of an authenticated caller.

  `delete` is deliberately unaffected: it places no row and decides no tenant, so
  its target is selected through the Layer 0 row wall, which already resolves to
  nothing under this state.

  ### Who is unaffected

  Reads. System contexts (boot seeding, reconcilers, backfills, imports). True
  platform operators on a posture-permitting object (ADR-0095 D3) — and only
  there: the same operator on an ordinary business tenant object meets the wall
  like anyone else. The `single` posture, where there is no wall at all. Objects
  that opted out of tenancy or carry no `organization_id` column. Federated
  objects whose tenant anchor is a phantom. Under `group`, a caller with a
  non-empty membership set is fully scoped and unaffected even with no active
  organization, because membership — not the active organization — is that
  posture's scope.

  ### If you hit the refusal

  The caller genuinely has no organization to write into. Give them a membership
  (or an active organization selection) and retry; the refusal names this so it is
  not mistaken for a permission-set problem. Deployments that reached this state
  at sign-up are additionally addressed by the membership-ordering fix in
  `@objectstack/plugin-auth`, which settles the membership before the first
  session mints.

- 018d22c: feat(lint): an authored OWD is required at the runtime object door — `runtimeTypes` gains `object`, completing the #7891 flip; the plugin gate's R2 `owd_external_wider` arm is retired as its duplicate (#8310, maintainer-ruled)

  The security publish linter (`validateSecurityPosture`, ADR-0090 D7) now runs
  for runtime-authored **object** publishes, alongside the `seed` /
  `permission` / `book` types that crossed earlier in the #7891 rollout. An
  active-state object publish — Studio publish, direct REST save, AI builders —
  with **no authored `sharingModel`** is refused with `422 INVALID_METADATA`
  (`security-owd-unset` in `issues`): absence is not a decision. Previously the
  runtime door accepted OWD-less bodies and silently defaulted them to
  `private` (ADR-0090 D1) while the CLI refused the same body — the runtime
  door was permanently weaker than the build door on exactly the hottest
  AI-author write path.

  Door order at `saveMetaItem`, now pinned end-to-end: the **422 lint door
  answers first** (all 12 rule ids of the D7 block, external ≤ internal
  included), then the ADR-0094-seam plugin gate answers for what passes lint.
  Consequences:

  - `objectPostureGate`'s **R2 arm (`403 owd_external_wider`, external ≤
    internal) is retired as a duplicate** of the lint door (maintainer ruling
    on #8310; ADR-0094 amendment rides this change). An external-wider pair now
    answers `422` / `security-external-wider-than-internal` instead of `403` /
    `owd_external_wider`. R2's only non-shadowed refusals were false positives
    (system objects, whose unset OWD is effectively PUBLIC at runtime, and
    draft saves, which the lint discipline defers to the draft→active
    promotion gate per #4463 D1).
  - **R1 stays**: an environment overlay may still only TIGHTEN a packaged
    object's posture (`403 owd_widening_forbidden`) — no lint rule can judge
    the packaged baseline.
  - Draft saves are ungated (work-in-progress may be dirty); the draft→active
    promotion runs the same 422 gate, so no defective body reaches `active`.
  - The `package-author` channel carve-out (#6710) is unchanged on both doors.

  Migration: author `sharingModel` explicitly on every runtime-published object
  body (`'private'` is the recommended default; `'public_read'`,
  `'public_read_write'`, `'controlled_by_parent'` for master-detail children).
  Stored metadata is untouched — the gate judges new writes only, and a clean
  write is never blamed for a pre-existing OWD-less object in the environment
  (the gate's baseline/candidate differential cancels context findings).
  `OS_ALLOW_UNLINTED_METADATA_WRITES=1` remains the loud migration hatch.

- b61afc1: fix(plugin-security,spec): the `403 PERMISSION_DENIED` from the object CRUD gate stops handing a business user internal authorization vocabulary

  An operation the caller's permission sets do not grant is correctly refused with
  `403 PERMISSION_DENIED`, and the transport was never the problem. What reached
  the end user was: `Error.message` is the body's human-readable string on every
  transport (`mapDataError`'s `body.error`, the dispatcher's `error.message`) and
  Console renders it verbatim in a toast. So an operator in a fully localized app
  read

  ```
  [Security] Access denied: operation 'delete' on object 'app_child_object'
  is not permitted for positions [org_member, everyone]
  ```

  English-only; naming a table they have never seen; ending in `positions [...]`,
  internal authorization vocabulary that reads as a contradiction to someone who
  does hold rights on the record they clicked. It is not confined to obviously
  unauthorized actions either — `cascadeDeleteRelations` re-authorises every
  cascade CHILD independently, so an ordinary delete of a parent the app
  deliberately granted can surface a 403 naming a child object the operator never
  addressed.

  The error now carries two messages because it has two audiences:

  - `message` — the user's half, rendered in `ExecutionContext.locale` through the
    shared operation-message catalog (`@objectstack/spec/system`, the mechanism
    built for `DELETE_RESTRICTED`), overridable per deployment under
    `errors.permission_denied`. It names no object, no operation and no position,
    in any of the four shipped locales.
  - `developerMessage` — the developer's half, the previous sentence byte for
    byte. It is LOGGED at the throw site, not shipped to the client.

  That last point is where this deliberately diverges from its sibling.
  `DELETE_RESTRICTED` ships its developer half over the wire because the same body
  already carries the API names it mentions; the 403 body does not. REST's
  `mapDataError` builds `{ error, code, object? }` for a permission denial and
  never reads `error.details`, so the positions, the operation and (on a cascade)
  the child object's API name reach a client through nothing but the message —
  shipping a `developerMessage` there would have ADDED a disclosure rather than
  removed one. `developerMessage` is therefore a sibling of `details`, never a
  member of it, because `details` is the field the runtime dispatcher serialises.

  Enforcement is untouched: same 403, same `PERMISSION_DENIED`, same decision
  logic, and the structured `details` payload (`operation`, `object`, `positions`,
  `permissionSets`) is byte-identical to before.

- 0848bea: feat(spec)!: retire the overloaded `managedBy: 'system'` bucket — the residue becomes `system-data` (#3355)

  **FROM → TO: `managedBy: 'system'` → `managedBy: 'system-data'`.** One-line fix:
  rename the value. Nothing else about the object changes. `os migrate meta --from 16`
  rewrites it for you; stored metadata is CONVERTED by the ADR-0087 entry
  `object-managed-by-system-to-system-data`, never silently reinterpreted.

  ADR-0103 split the overloaded `system` bucket in v16, and it split it
  **additively**: the 20 engine-owned objects moved to the new explicit
  `engine-owned`, while the 8 admin/user-writable ones — the RBAC link tables
  (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`),
  `sys_user_preference`, `sys_approval_delegation`, and the three messaging config
  grids — stayed behind on `system`. That was the right move for a v16 that could
  not break authors, but it left the enum in a state where the surviving value
  names the half that had already moved out: `system` sitting on precisely the
  objects a user writes.

  That is not a cosmetic complaint. An author choosing between `system` and
  `engine-owned` had nothing in the vocabulary to choose _on_, so the bucket was
  re-overloadable by anyone reading the name in good faith — a model author most
  of all, since "system table" reads as "the engine owns this" in every other
  codebase. `system-data` states both boundaries explicitly: the **schema** is the
  platform's (versus `platform`, which is tenant-modelled), the **data** is the
  admin's or the user's (versus `engine-owned`, where the engine owns both).

  Because v16 already drained the engine side, the conversion is a **one-to-one
  mechanical value rename** with no judgement call — by construction every
  remaining `system` declaration is writable platform data.

  **One deliberate consequence — the affordance default flips.** `system` defaulted
  LOCKED and each of the 8 objects re-opened its writes with a
  `userActions: { create: true, edit: true, delete: true }` block. `system-data`
  defaults **WRITABLE** (full CRUD), because a bucket that exists to say "the data
  is yours" should not make every member ask for it back. Those blocks are now
  redundant and have been deleted from the 8 platform objects; keep `userActions`
  only to **NARROW**. If you converted an object that carried no `userActions`, it
  gains the generic affordances — the honest reading of the bucket it moved into.

  **No enforcement moves.** The engine write guard, the `DelegatedAdminGate`, RLS
  and permission sets all adjudicate off resolved affordances and the principal,
  never off the bucket name. `system-data` simply joins `platform` / `config` as a
  bucket the fail-closed guard does not cover, because a writable default has
  nothing to close on. The 8 objects passed that guard before (via `userActions`)
  and pass it now (via the bucket default), for the same resolved-affordance
  reason.

  `'system'` is **retired from the load path**: the enum rejects it with a
  prescription naming `system-data` and the one-line fix. Absorbing it silently at
  load would leave every author still writing the name this rename exists to
  unteach.

- 9e9445b: fix(plugin-security): the row-level write gate honours `modifyAllRecords` and `edit`-level record shares (#5492)

  HotCRM's 17.0 GA acceptance sweep measured two declared write-widening
  mechanisms as completely inert. A manager profile carrying `viewAllRecords` +
  `modifyAllRecords` got `403 … (row-level security)` on **every** cross-owner
  write — update and delete, four objects — while its reads widened exactly as
  declared (43/43, 9/9). And all three `edit`-level sharing rules materialised
  into `sys_record_share` correctly and widened reads exactly, yet a `PATCH` by
  the share target was refused every time. Read-level shares correctly denied
  writes, so the machinery distinguished the levels on paper and the write gate
  then ignored the distinction.

  **One root cause.** Row-level write access was two authorities AND-ed together
  with no knowledge of each other. `ISharingService` reads all three declared
  wideners (ownership at write DEPTH, `sys_record_share.access_level`, the
  `modifyAllRecords` bypass); the security plugin's by-id write pre-image gate
  read only RLS — and sitting inside that RLS is the platform's own ownership
  floor, `owner_only_writes` / `owner_only_deletes` (`created_by ==
current_user.id`, applicability `positions: ['org_member']`). That floor is a
  second implementation of "ownership", and it is the one blind to every widener.
  Every member resolves it additively from the `member_default` baseline — a
  manager is an org member too — so the widener-blind copy always won.

  **The fix is composition by provenance, not a new bypass.** The pre-image gate
  now asks the authority that owns those mechanisms for its tri-state verdict
  (`ISharingService.checkEdit` / `checkDelete`, the contract added in #6428):

  - `allow` — a positive basis exists, so the declared authority **replaces** the
    platform floor;
  - `abstain` — record sharing does not enforce on this row at all (a `public`
    object, an object with no owner field, a platform internal), so the floor
    **stays**: it is the only row-level write gate such rows have;
  - `deny` — the floor stays; the refusal belongs to the sharing middleware that
    produced the verdict.

  The action boundary is inherited rather than restated (ADR-0111 D3): update asks
  `checkEdit`, delete asks `checkDelete`, so an `edit` share widens update and
  still does not confer delete. `modifyAllRecords` covers both verbs
  (`MODIFY_ALL_WRITE_KEYS`).

  **What is deliberately unchanged.** Layer 0's tenant wall and every
  **app-authored** RLS policy are untouched — only the policies the platform
  itself ships are replaceable, matched by the same `(object, name, using)`
  provenance key ADR-0105 D3 uses for tenant policies, so an app policy spelling
  the identical predicate keeps refusing (ADR-0049: a declared security property
  stays declared). This is therefore not `modifyAllRecords` bypassing write-side
  RLS on an ordinary business posture, which ADR-0066 ① withholds and this change
  leaves withheld; it is the platform's floor deferring to the platform's own
  ownership authority. The on-behalf-of (ADR-0090 D10) path keeps both principals'
  floors, matching `hasWriteBypass`, which already fails closed for a delegated
  context. A deployment without `@objectstack/plugin-sharing` sees no change at
  all: with nothing to consult, the gate abstains and the floor decides.

  Net effect for deployments: a Modify All Data holder can now correct, reassign
  and clean up records they did not create, and an `edit`-share recipient can
  finally edit the record shared with them. Nothing that was refused for lack of a
  grant becomes permitted — read-share targets are still denied writes, `edit`
  shares still cannot delete, and a member with neither is still refused.

- aa8b847: feat(authz): scoped invitations — placement intent on an invitation, gated by
  the issuer's adminScope and applied on acceptance (ADR-0105 D8)

  An invitation may now carry PLACEMENT INTENT — the business unit the invitee
  lands in and the positions they are assigned — so a delegated (plant) admin's
  invitee arrives already in the right unit and role instead of waiting on a
  platform admin. This closes the structural gap ADR-0105 D8 names for
  `single`-posture deployments and is the natural admission path under `group`.

  The two halves ship together, deliberately:

  - **Issuance is authorized** against the ISSUER's `adminScope` (ADR-0090 D12),
    by dry-running the existing `DelegatedAdminGate` against the very
    `sys_user_position` rows the acceptance would write. The gate is reused
    verbatim — no second copy of the subtree/allowlist logic to drift — so an
    invitation can never place what its issuer could not have assigned directly.
    Without that gate the feature would be an escalation hole: the built-in
    `organization_admin` is deliberately read-only on the RBAC tables precisely
    so a fresh org admin cannot rebind themselves, and applying an unchecked
    invitation payload under system context would hand that authority straight
    back.
  - **Acceptance applies it**, idempotently and failure-isolated: a replayed
    acceptance converges instead of duplicating assignments, and a placement
    miss never undoes a valid membership.

  Surface:

  - `sys_invitation` gains `business_unit_id` + `positions` (ADR-0092 extension
    fields, registered in the D7 collision-guarded whitelist; NOT generically
    editable — placement is set only at issuance, through the gate).
  - `@objectstack/plugin-security` registers the `invitation-placement` service
    (`assertIssuable` / `apply`).
  - `@objectstack/plugin-auth` wires better-auth's `beforeCreateInvitation` /
    `afterAcceptInvitation` to it. **Fail closed**: an invitation that requests
    placement in a deployment without the delegated-administration runtime is
    refused, never silently placed unchecked.

  Existing invitations are unaffected — an invitation without placement intent
  never consults the gate and behaves exactly as before.

- c6a4eeb: fix(plugin-security,spec): the row-level and capability `403 PERMISSION_DENIED` refusals stop handing a business user internal authorization vocabulary

  #7414 converted one template of this family — the object CRUD grant denial. The
  same defect sat on the other gates of the same middleware that an ordinary,
  non-admin principal reaches on ordinary business work. `Error.message` is the
  body's human-readable string on every transport (`mapDataError`'s `body.error`,
  the dispatcher's `error.message`) and Console renders it verbatim in a toast, so
  a salesperson editing someone else's opportunity read

  ```
  [Security] Access denied: not permitted to update this 'crm_opportunity'
  record (row-level security)
  ```

  English-only, naming a table they have never seen, and ending in the name of the
  mechanism that refused them rather than anything they can act on.

  Three gates now render the user's half through the shared operation-message
  catalog (`@objectstack/spec/system`, the mechanism built for `DELETE_RESTRICTED`
  and reused by #7414), overridable per deployment under `errors.<key>`:

  - the row-level pre-image write denial renders `record_access_denied`;
  - the row-level CHECK post-image denial renders `record_change_not_allowed`;
  - the capability AND-gate (ADR-0066 D3) renders the existing `permission_denied`.

  Two new catalog keys, in all four shipped locales, and not three: the rule is one
  key per SITUATION, not per gate and not per wire code. A user blocked by
  row-level security can often ask the record's owner; a user whose post-image
  failed a CHECK can simply change what they typed; a user whose grants do not
  cover the action needs an administrator. Those are three different next steps, so
  they are three different sentences. A caller missing a CRUD bit and a caller
  missing a `requiredPermissions` capability, by contrast, are in ONE situation with
  one remedy — the difference between them is a fact about our authorization model,
  which is exactly the vocabulary that must not reach a toast — so both render
  `permission_denied`.

  Each sentence names nothing: no object, no record id, no capability, no
  mechanism. That was re-derived per site rather than inherited. The row-level
  denial is the one gate here that COULD have named honestly, because the refused
  record is the one the caller just addressed; it still does not, because the only
  spellings available at the throw site are the object's API name and an opaque row
  id, and reaching a label means the ladder whose last rung is the API name.

  Each refusal keeps its developer half as `developerMessage`, the previous
  sentence byte for byte, LOGGED at the throw site rather than shipped — following
  #7414, which measured that REST's `mapDataError` builds `{ error, code, object? }`
  and never reads `error.details`, so shipping it would ADD a disclosure on the
  transport that discloses less. `developerMessage` is a sibling of `details`,
  never a member, because `details` is what the runtime dispatcher serialises.

  Enforcement is untouched: same 403, same `PERMISSION_DENIED`, same decision
  logic, and every structured `details` payload — including `requiredPermissions`,
  `missingPermissions` and `recordId` — is byte-identical to before.

- d318b24: feat: `security.getReadableFields` query surface for export column projection (#3547, #3391 follow-up)

  The REST export route projected its columns by inferring readability from the
  first chunk of already-masked data rows (#3498). That has two known
  compromises: a readable column whose first-chunk values are all null (and thus
  omitted by the driver) drops out of the header, and an empty result set leaves
  nothing to narrow. This adds the long-term-correct path.

  - **plugin-security** — the `security` service gains
    `getReadableFields(object, context)`. It resolves the caller's permission
    sets and builds the field-permission map with the SAME evaluator +
    `requiredPermissions` fold the read middleware's `FieldMasker` uses (and the
    same on-behalf-of delegator intersection, fail-closed on a dangling
    delegator), then returns every schema field NOT masked non-readable — the
    exact complement of what the mask deletes, so it can never drift from
    data-plane FLS. Computed from schema + context, never from data rows: immune
    to null values and empty result sets. A system context bypasses FLS; an
    unresolvable schema returns `undefined` so callers fall back.
  - **rest** — the `GET /data/:object/export` route asks the environment's
    `security` service for `getReadableFields(object, context)` and projects the
    schema-derived header to that set BEFORE streaming. When no security service
    is reachable (no plugin-security / single-kernel without a provider) it
    degrades to the existing masked-row inference, so there is zero regression.
    Explicit `?fields=` requests are still honored verbatim.

  Contract-neutral: export columns already equal list's readable columns
  (`export ⊆ list`, #3391); this makes the projection authoritative instead of
  inferred.

- e51acd6: Split `controlled_by_parent` write refusals by true semantics: three of the six legs stop answering `403 PERMISSION_DENIED`

  A by-id write to a `controlled_by_parent` detail is refused for six distinct reasons, and all six used to answer with one envelope and one sentence — `403 PERMISSION_DENIED: … requires edit access to its master record`. Only three of them are authorization verdicts. The other three said something untrue and prescribed a remedy that could not work: "ask whoever owns the parent record" cannot fix a null master reference, a deleted row, or an object that declares `controlled_by_parent` with no `master_detail` relation to derive access from.

  Unchanged — the three genuine verdicts keep `403 PERMISSION_DENIED` and their exact wording:

  - the caller holds no object-level `update` on the master
  - the master row lies outside the caller's write RLS
  - the master carries no `edit`-level share grant

  Changed — the three non-verdict conditions now answer for what they are:

  | condition                                                        | before                  | after                        |
  | ---------------------------------------------------------------- | ----------------------- | ---------------------------- |
  | `controlled_by_parent` declared with no `master_detail` relation | `403 PERMISSION_DENIED` | `422 INVALID_METADATA`       |
  | the target detail row does not exist                             | `403 PERMISSION_DENIED` | `404 RECORD_NOT_FOUND`       |
  | the detail's master reference is empty                           | `403 PERMISSION_DENIED` | `422 MISSING_REQUIRED_FIELD` |

  Each carries a message written for the app author, naming the object, the operation and the remedy. The metadata-defect case is the one that matters most: it is a precisely detectable authoring defect that was disguised as routine RBAC noise, so nobody ever investigated it — and a false 403 steers debugging, human or agent, toward permission changes when the truth is broken metadata.

  The 404 does not widen what a caller can learn. The detail row is probed under a system context, so a row hidden from the caller by row-level security is still found and falls through to the authorization legs; object-level CRUD and the row-level write pre-image check both run before this gate. Absence there is real absence.

  All codes come from the existing ADR-0112 vocabulary — no new error code is introduced.

- d19fb5c: fix(verify,plugin-security,cli): `bootStack` honours the app-declared default permission set, like `serve` always did (#7001)

  Two boot paths disagreed about whether an application's declared default
  permission profile exists.

  - **`objectstack serve` honoured it** — it read the permission set marked
    `isDefault: true` off `config.permissions` and passed the name as the
    `SecurityPlugin` `fallbackPermissionSet`.
  - **`bootStack` did not** — `@objectstack/verify` constructed a vanilla
    `new SecurityPlugin()` and never read `config.permissions` at all.

  So the profile an app declares was in force when a human ran the CLI and
  silently absent when the app's own suite booted it: a `declared ≠ enforced`
  split inside the harness that exists to catch that split. Green tests,
  different production behaviour.

  It was invisible until #5491. Until then the platform's `member_default`
  carried an `object_permissions['*']` wildcard, so a member with no application
  profile reached every object anyway and the declared fallback was never
  load-bearing. #5491 removed that floor deliberately and its Migration section
  prescribes exactly one consumer action — ship an app default profile via
  `isDefault: true` — which `bootStack` had no way to express. Measured in
  cloud's `ee-group-showcase`, adding the prescribed profile changed nothing: the
  same acceptance cases still failed at the object gate.

  **What changed.** The resolution now lives in one place and both boot paths call
  it: `appSecurityPluginOptions(config)`, new in `@objectstack/plugin-security`
  next to the existing `appDefaultPermissionSetName`. It answers the question a
  booter actually has — _what do I hand the `SecurityPlugin` constructor for this
  config_ — rather than just the name, because the second half
  (`name ? { fallbackPermissionSet: name } : undefined`) is a decision, not
  formatting, and while `serve.ts` had open-coded it, `bootStack` had simply never
  grown one. `serve.ts` is converged onto the same helper, so the two now agree by
  construction rather than by each caller remembering.

  **Behavioural change, `@objectstack/verify` only.** `bootStack(config)` on an
  app that declares an `isDefault` permission set now boots with that profile as
  the additive per-request baseline (ADR-0090 D5), matching `objectstack dev`. An
  app that declares no such set is unaffected — the resolution yields `undefined`
  and the plugin keeps deriving `member_default` from its built-in sets, exactly
  as before.

  A suite that deliberately wants the platform's own baseline over an app that
  declares a default now says so: `bootStack(config, { security: new SecurityPlugin() })`.
  A plugin passed in `opts.security` still wins whole and is never merged into —
  it arrives carrying its own constructor options, and silently rewriting one of
  them would be a worse surprise than the bug being fixed.

  Measured blast radius across the framework's own suites: of 86 dogfood files and
  524 tests, exactly one assertion moved — `me-apps-and-everyone-baseline`, which
  asserts the bootstrap binds `member_default` to the `everyone` anchor and whose
  header already read "Deliberately VANILLA". That dependence was real but silent,
  expressed only by the harness default; it is now stated in the argument. The
  showcase fixtures that needed the app profile were already hand-wiring a
  `SecurityPlugin` for it (`test/showcase-security.ts`, added by #5491) — the
  "custom security code" these dogfood apps exist to prove unnecessary — and are
  unchanged by this release.

### Patch Changes

- 735f850: fix(security): resolve the ISSUER's real grants when authorizing invitation
  placement (ADR-0105 D8)

  Scoped-invitation issuance dry-runs `DelegatedAdminGate` against the
  `sys_user_position` rows the acceptance would write. The gate reads authority
  off `context.positions` / `context.permissions` — but the invitation hook
  handed it a hand-built `{ userId, tenantId }`, which carries neither. Every
  delegated administrator therefore resolved to the additive baseline alone and
  was refused:

  > requires tenant-level administration or a delegated adminScope (ADR-0090 D12)

  Fail-closed, but dead: only a tenant admin could ever issue a placement, which
  is the one case the feature was not for. Caught by cloud's group-posture
  dogfood, which exercises the real HTTP path with a real delegate.

  `assertIssuable` now takes `actorUserId` instead of a caller-built
  `actorContext` and resolves that user's grants itself through the single authz
  resolver (`@objectstack/core` `resolveUserAuthzGrants`) — the same envelope a
  transport would have carried, from the same reads. There is no request to
  resolve a context from inside a better-auth hook, so the id is what the caller
  can honestly supply and the resolution belongs behind the boundary.

  A principal-less call still reaches the gate with an empty context on purpose:
  the gate owns that refusal too, so the security boundary keeps exactly one
  place an issuance can be denied.

- 63f3b87: ADR-0094 D5-R: retire the "customize packaged permission sets through an ADR-0005 env
  overlay" direction (2026-07-14), and make the ADR text and the
  `permission-set-projection.ts` header agree with what is enforced.

  `#6483` (PR #6608) rolled `permission` back to `allowOrgOverride: false`, so a metadata
  write against a **code-declared (artifact-backed)** permission set is refused with 403
  `NOT_OVERRIDABLE` — ADR-0005's security row ("overlays would create silent privilege
  drift") is enforced again. The supported channel for those sets is the one ADR-0086
  always named: edit the package and re-publish. Environment authoring survives on the
  `allowRuntimeCreate` tier, for sets whose definition lives only in `sys_metadata`
  (data-door creations, and package sets authored + published through the metadata door);
  that tier edits the single stored definition in place and is deliberately **not**
  described as a re-route of the retired overlay channel.

  No behaviour change: the four production write points keep their current dispositions.
  The refusal is left to the producer — `plugin-security` does not re-derive
  artifact-backing to pre-empt it — and the two write points that catch a failed metadata
  write (the `restore` leg and the boot backfill) keep reporting on the durability channel.
  What changes is prose, plus test coverage that can now see the gate: the suite's protocol
  stub models ADR-0005's tier gate, so the four cases that pinned the retired direction no
  longer pass for want of a stub that could refuse.

- 73f69dc: fix(plugin-security): `checkAuthoredRowWrite` answers the declaration, not the caller's read scope (#7281)

  `ISecurityService.checkAuthoredRowWrite` asks one question — _does an
  app-authored row-level widener admit this row for this write?_ — and it resolved
  that question by re-reading the row through the **caller's own** execution
  context. That `findOne` re-enters the middleware chain, so `plugin-sharing`'s
  READ filter applied: on a `private`-OWD object a cross-owner row is invisible to
  the caller, the read answered null, and the verdict was `abstain` for a row the
  declaration names by predicate.

  Measured on the real stack across two objects identical in every respect except
  their OWD — same widener text, same principal, same cross-owner row shape:

  | OWD           | verdict before | verdict after |
  | ------------- | -------------- | ------------- |
  | `public_read` | `admit`        | `admit`       |
  | `private`     | **`abstain`**  | **`admit`**   |

  So the by-id widener surface was live on read-open objects and stood down on
  read-closed ones, discriminated by a property the widener's author never
  mentions — and `private` is the posture #5493 built that surface for. The
  maintainer ruled it a defect (2026-08-10): the verdict is about the row and the
  policy, not about what the caller may see. The probe read now resolves under an
  elevated, principal-less scope.

  **This does not widen anything.** The predicate carries the whole of the
  question and travels in the query rather than in the scope: `{id} AND
layer0(tenant wall) AND layer1(app-authored policies)`, both layers still
  compiled from the caller's own permission sets and tenant before the read, and
  the read is projected to `id` so the probe can only ever learn _that_ a row
  matches. A row in another tenant, a row no authored policy matches, and a caller
  holding no authored policy at all all still answer `abstain` — pinned, including
  by mutation: delete the tenant layer from the predicate and the cross-tenant case
  goes red. `admit` also remains evidence and never authorization: the by-id write
  pre-image gate still resolves the write under the caller's own context and
  refuses on its own terms.

  One consequence is stated plainly rather than papered over: because that
  pre-image gate performs the same caller-scoped read, a `private`-OWD cross-owner
  by-id write is **still refused end-to-end** after this change — now by the
  row-level gate (`PERMISSION_DENIED`, "…(row-level security)") rather than by the
  sharing middleware's `FORBIDDEN`. Whether a write should reach a row the caller
  cannot read is a separate contract question about that gate's read scope, and it
  is not settled here. Both behaviours are pinned on the real stack.

  The `@objectstack/spec` half is documentation only: `ISecurityService`'s contract
  listed "the row is unreadable" among the `abstain` cases, which is exactly the
  conflation the ruling removed. No signature, shape or vocabulary changes, and the
  method stays optional and fail-closed.

- 9c82146: fix(security): an app-declared permission baseline COMPOSES with the platform `member_default` instead of replacing it (#7555)

  A permission set marked `isDefault: true` used to become the deployment's ONLY
  baseline: `SecurityPlugin`'s `fallbackPermissionSet` held a single name, and an
  app's declared set went into it, so every member of that app silently lost the
  platform floor. Measured on the showcase (#7555): a fresh member is served all
  10 built-in Account nav entries and 7/7 of the objects behind them answer 403,
  because `showcase_member_default` names no `sys_*` object and `member_default`
  was no longer in force for anyone in that app.

  That is the ADR-0090 D5 fallback cliff in its second spelling — D5 rules the
  baseline additive without exception ("The fallback cliff is abolished. …
  `everyone` is additive like any other position: baseline ∪ explicit, always")
  and narrows `isDefault` to a package-authored _suggestion_, "never a runtime
  fallback".

  The human baseline is now the list of names it always was: the declared set
  **plus** the platform `member_default`, deduped. Both are pushed into the
  per-request resolution, both back the post-resolution fallback and the ADR-0106
  D7 metadata-plane resolution, and both are bound to the `everyone` audience
  anchor at boot so `security/explain` and the Setup UI report the default a
  request actually applies. The composed list is published as a new
  `security.baselinePermissionSets` service, which `/auth/me/permissions` and
  `/me/apps` read so the capability and tab surface cannot disagree with the data
  plane; `security.fallbackPermissionSet` is unchanged and still means "the single
  name this deployment declared".

  Deliberately unchanged:

  - **Agent principals** keep exactly their ADR-0090 D10 restricted ceiling — the
    composed human baseline is unreachable from `principalKind: 'agent'`.
  - **`fallbackPermissionSet: null`** still disables the baseline entirely; the
    composition never re-adds one.
  - **`member_default`'s own grant rows**, the D5/D9 high-privilege anchor-binding
    gate, and #5491's narrowing of the platform baseline to explicit-allow.

  An app that declares no `isDefault` set resolves `['member_default']` and is
  byte-for-byte unaffected.

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

- 6af87d7: fix(plugin-security): a `check`-only write policy no longer disables both write-side row gates — a caller who cannot read a record could write it by id (#8059)

  **The exposure, measured on the shipped showcase.** A persona holding the plain
  `contributor` position got `GET /data/showcase_invoice/:id` → **404** — the app's
  `invoice_own_rows` narrowing correctly hid an invoice it does not own — and
  `PATCH /data/showcase_invoice/:id` → **200, with the row actually changed**
  (confirmed by re-reading it as an admin). Same on `showcase_invoice_line`, which
  derives its access from that invoice via `controlled_by_parent`. **A caller who
  could not read a record could write it by id**, including reassigning its owner
  to themselves. That is the #1994 class ("you cannot mutate what you cannot see"),
  still open for this authoring shape one issue after #7665 closed it for the
  select-only shape.

  It is not showcase-specific. Any app that authors a `using` narrowing for a
  position **plus any update-class policy — even one that only validates the
  post-image** — lost by-id write scoping on that object. The showcase is the
  shipped example of the recommended authoring style, so this is the shape apps are
  being taught to write.

  **One authoring shape switched off both belts, which is why both are fixed here.**
  The showcase's `invoice_owner_immutable` is `operation: 'update'` with a `check`
  clause and no `using`:

  - **The row gate never derived a scope.** #7665's write-visibility floor derives
    a write scope from the caller's SELECT narrowing when no policy of the write
    class applies, but it tested whether the applicable set was _empty_. A
    check-only policy is fully applicable — object, `positions` and operation all
    match — so the set was non-empty and the derivation was skipped, while the
    policy itself compiled to no row filter at all, having no `using` for the
    compiler to read. Layer 1 was null and every write-side row gate composed from
    it was a no-op again: the by-id pre-image gate, the `controlled_by_parent`
    master check, and the bulk-write AST injection. The trigger now asks whether a
    write-scope **predicate** applies, which is what #7665's criterion says — a
    `check` clause is post-image validation (ADR-0058 D4), not a scope predicate.
  - **The post-image check was dropped for every caller.** `computeWriteCheckFilter`
    did not pass the caller's held positions, so the ADR-0090 P2 applicability
    domain was evaluated against an empty list and **every policy declaring
    `positions` was filtered out of the check** — for holders and non-holders
    alike. A position-scoped `check` clause was inert (ADR-0049
    enforce-or-remove), so the write was not stopped on the way out either.
    Positions are now threaded through, and the domain still decides: a policy
    scoped to a position a caller does not hold still does not apply to them.

  **Also fixed, as a direct consequence of the first site.**
  `checkAuthoredRowWrite` — the by-id widener's "does an app-authored policy admit
  this row?" probe — reached its `abstain` verdict for check-only policies only
  because Layer 1 happened to be null. With a scope now derived in exactly that
  case, the derived readable-set scope would have started answering `admit`, which
  widens. The probe now requires an authored policy that actually declares a row
  scope, so a derived scope still cannot masquerade as an authored admission
  (#5493 / #7281). This preserves the previous verdict rather than changing it.

  **Unaffected:** an object that authors a real update-scope `using` predicate
  keeps deciding by it alone, in both directions, and the read-side superuser
  bypass and platform ownership floor paths are untouched. In-scope writes by
  legitimate holders still land.

- 846ed1f: fix(security): `controlled_by_parent` 现在真的跟随主档访问 —— 折入主档的归属与共享授权 (#5386)

  **这是一次安全收紧。** 升级后,此前被越权看到 / 写到的明细行会读不到、写不了 —— 那正是
  声明本来就要求的边界。

  ADR-0055 的 `controlled_by_parent` 对作者的承诺是「子记录跟随父记录的访问」。实现只兑现了
  一半:派生用的主档 id 集来自 `computeRlsFilter(master, 'find')`,即只有 Layer 0(租户)与
  Layer 1(`rowLevelSecurity` 策略)。归属(owner scope)与 `sys_record_share` 授权由**另一个
  插件** `plugin-sharing` 的 `buildReadFilter` 贡献,而它对「有效共享模型不是 `private`」的对象
  返回 `null` —— `controlled_by_parent` 在那边恰好映射为 `public`。于是记录级访问的两半在派生
  对象上从未相遇。

  后果比文档里那句「sharing grants 未折入」读起来严重得多:

  - 主档上**没有写任何 `rowLevelSecurity`** 的应用,得到的是一个**不受限的主档 id 集**,派生
    过滤器等于什么都没收窄 —— 只要持有对象级 read,全部明细行可读。行项目类对象(报价行、
    发票行)是这个形状的常客,而它们携带逐行定价与折扣。
  - 在主档上补写 RLS 也不是绕法:RLS 与 sharing 过滤器是 **AND**,补写会连同被共享进来的行
    一起切掉。
  - 写这半有同样的洞,而且是从另一侧来的:`assertControlledByParentWrite` 只在主档的写 RLS
    编译出非空过滤器时才检查主档行,主档没写 RLS 时**整段跳过** —— 持有 `allowEdit` 的调用者
    可以改自己根本看不到的父记录下的明细。

  **修复**:主档可达性改走与「直接读 / 直接写主档」完全相同的路径,复用既有合成点,不在
  plugin-security 里重刻一份 sharing 语义。

  - 读:`computeControlledByParentFilter` 现在把主档的读 RLS 与 `resolveSharingReadFilter`
    (`getReadFilter` 已经在用的那个 OWD/共享半边)AND 起来再解析主档 id 集。哪一半生效由
    **主档自己的有效共享模型**决定,因此派生出的可见集与直接 find 主档逐点一致。
  - 写:`assertControlledByParentWrite` 在原有的 CRUD `update` + 写 RLS 之外,**无条件**追问
    plugin-sharing 的单记录写闸 `canEdit`(归属按写深度放宽、`edit` 级共享、
    `modifyAllRecords` 旁路)—— 无条件,正因为写 RLS 那一半在常见情形下会被整段跳过。
  - 两侧解析失败一律**fail closed**(主档 id 集为空 / 拒绝写),而不是悄悄放宽回全员可见。

  未变更的部分:v1 的**单层**语义 —— 主档自身的 `controlled_by_parent` 仍不递归下钻;没有装
  `plugin-sharing` 的部署行为不变(那种部署里主档本身也没有归属与共享可言,派生集依旧与直接
  读主档相等);`read` 级共享仍然只开读不开写,与直接访问主档的逐动词答案一致。

- 89e9808: A `delegated_admin` can now read the invitations it issued (#8240)

  `delegated_admin` is the one principal that may reach `/organization/invite-member`
  without being an org admin (ADR-0105 D8), but #8095's narrowing of the
  `sys_invitation` ledger admitted `org_owner` / `org_admin` only — and that role
  normalizes to neither. It could create invitations it then could not list, with no
  second path back, since better-auth's own `list-invitations` route is owner/admin
  gated too.

  `member_default` gains one row-scope policy, `sys_invitation_issuer`
  (`inviter_id == current_user.id`, domained to the `delegated_admin` grade), a
  sibling of the addressee carve-out that already sits beside it. Scope-bounded on
  purpose: the issuing principal reviews **its own** issuance, not the ledger. Owner
  and admin visibility is unchanged, and a plain member still reads nothing but the
  invitation addressed to them.

- 9ce0ca9: **An admin-authored capability's `label`/`description` survive the boot (#5876).**

  `bootstrapSystemCapabilities` seeds `sys_capability` in two halves: the CURATED
  platform capabilities, and the back-compat DERIVED defaults — one row per
  capability string a bootstrap permission set grants via `systemPermissions[]`
  that nothing declared. Its seed loop refreshed `label`/`description` on whatever
  row it found for a name, without looking at `managed_by`, while the comment
  directly above it claimed the opposite ("do NOT clobber admin edits"). What
  #2909 T3 actually made seed-once is `scope`, and only `scope`.

  For a derived name there is no authored copy to reconcile: `label` is
  `humanize(name)` and `description` is `Capability <name>.`, both generated from
  the granted string. So an existing row's authored display fields were rewritten
  to a humanized placeholder on **every boot**, whoever wrote them — silent data
  loss, invisible from the outside.

  Reachable, narrowly, and it needs the admin row to pre-exist the grant: an admin
  creates capability `X` in Setup (`managed_by:'admin'` — the only provenance the
  ADR-0066 write-guard leaves admin-writable), an app whose bootstrap permission
  set grants `X` is installed, and every boot from then on renames it. The reverse
  order is not reachable: once the derivation has created the
  `managed_by:'platform'` placeholder, the write-guard stops the admin editing it
  at all.

  **The derived half now reconciles display fields only on rows it owns** —
  `managed_by:'platform'` on a non-curated name, which can only be its own
  placeholder from an earlier boot. `admin` rows, `package` rows and rows whose
  provenance is missing are left exactly as their author wrote them, and counted
  in the new `skippedAuthored` field of the seeding result (reported in the boot
  summary, not warned about: nothing is degraded, the capability resolves and the
  authored copy is the better one).

  **The curated half is unchanged.** Those definitions are authored by the
  platform and a new version legitimately ships new copy, so a curated name still
  refreshes the row it finds. `scope` stays seed-once on both halves.

  No migration and no authoring change: a placeholder that was already
  overwritten is not restored (the previous text is gone), but it stops being
  overwritten again, and an admin's re-edit now sticks.

- 2b1e37f: fix(security): `$expand` no longer discloses records the caller is 403'd from — the #2850 expand waiver is removed (#7626)

  A **low-privilege authenticated user could read records they are explicitly
  denied**, through the `$expand` seam. Measured on the running showcase app with a
  `contributor`-only session:

  - `GET /api/v1/data/showcase_contact/<id>` → **403 PERMISSION_DENIED**;
  - same session, `GET /api/v1/data/showcase_invoice?$expand=contact` on an invoice
    it owns → **200 with that contact fully materialised**, all 18 fields including
    `email`, byte-identical to the admin's response;
  - the body door (`POST …/query` with a nested `expand`) behaved the same.

  `showcase_contact` declares `sharingModel: 'private'` and the row was
  admin-owned, so both the object-level CRUD gate and the OWD row scope were
  bypassed. RLS on the DIRECT path was never affected and is unchanged.

  **Root cause.** #2850 correctly routed the engine's expand path back through the
  security middleware (tagging the sub-read `__expandRead`), which is what put the
  referenced object's RLS + FLS on an expansion at all. It also added a relaxation:

  ```ts
  operation === "find" && __expandRead && !secMeta.isPrivate; // → skip CRUD + requiredPermissions
  ```

  justified as "a PUBLIC referenced object is already broadly readable via the `'*'`
  wildcard grant, so gating the expansion adds no protection". Neither half held:

  1. `secMeta.isPrivate` is derived from `access.default` (ADR-0066 D2 — whether a
     `'*'` wildcard COVERS the object), a **different axis** from the `sharingModel`
     OWD that scopes an object's ROWS. An object that leaves `access` unset — nearly
     all of them, `showcase_contact` included — read as "public", so the waiver
     fired for it.
  2. "already broadly readable" was never **checked**. The condition asks nothing
     about the caller's grants, so it fired hardest for the caller holding none —
     #2850's own unit pin waives the gate for a permission set with `objects: {}`.
     Where the premise is true the waiver is inert (the CRUD gate would pass
     anyway); its only non-vacuous effect was on callers the gate meant to refuse.

  The OWD half followed from the same skip: `getEffectiveScope` answers `'org'` when
  no set grants the operation — safe only because such a caller is denied
  separately — so waiving the denial also stamped `__readScope: 'org'` and dissolved
  plugin-sharing's owner filter.

  **Fix.** The waiver is deleted; both throw-gates now run for every referenced
  object. One rule, public and private alike — the rule #2850 already applied to its
  private half: _an expansion may reveal only rows the caller could have read
  directly._ Nothing over-blocks a legitimate lookup: `expandRelatedRecords` already
  catches a refused sub-read and retains the bare FK id, so the parent read still
  returns 200 with the id it had. `__expandRead` itself stays — it is the marker the
  storage/comment access hooks strip as a privileged widening input, and `core`'s
  operation-private-keys list is what keeps it unforgeable from the wire.

  **Regression proof.** `packages/qa/dogfood/test/showcase-expand-crud-gate.dogfood.test.ts`
  drives the live HTTP stack with **two real sessions** — admin sees the expansion,
  the `contributor`-only persona must not — across all three expand doors
  (query-string `$expand` on list and by-id, body `expand`), and carries the
  over-correction guard: the contributor's foreign-invoice query still returns
  200 with 0 rows, and a lookup they DO hold a grant on still expands. The unit
  pins in `security-plugin.test.ts` are re-aimed but deliberately are not the
  regression story: an `__expandRead`-wiring assertion is the exact shape that
  stayed green for the whole life of this disclosure.

- 66360f3: fix(plugin-security): the tenant wall no longer scopes a federated object by a column it does not have (#7835)

  A **federated** object (ADR-0015 — `external`, bound to a remote table) is
  registered like any other, which means the ObjectQL registry injects the
  platform's system anchors into it: `organization_id`, `owner_id`,
  `owning_business_unit_id` and the audit `*_by` lookups. But the platform issues
  no DDL for a federated object — `Engine.syncObjectSchema` returns early, because
  the remote schema is owned externally. Those columns therefore exist in the
  registered schema and **in no backing store**.

  Layer 0 (the tenant wall, ADR-0095 D1) decides "is this a tenant object?" by
  asking whether the object carries `organization_id`, so it was answered yes about
  a phantom and AND-composed `organization_id = <active org>` onto every federated
  read under a walled (`isolated` / `group`) posture. Measured on the shipped
  showcase: the composed read filter for `showcase_ext_customer` was
  `{ organization_id: 'org_alpha' }`, and `GET /data/showcase_ext_customer`
  answered **HTTP 200 with zero rows**.

  The symptom is dialect-dependent and the defect is not. On SQLite an identifier
  that resolves to no column is reinterpreted as a string literal, so the
  comparison is constant-false: no error, no rows, a success status. Postgres and
  MySQL raise `column "organization_id" does not exist` instead. Either way the
  wall isolates nothing while the federated catalog stops answering the moment a
  deployment turns the organization wall on.

  Layer 0 now discounts an `organization_id` that is the **platform's injected
  anchor** on a federated object, so it contributes no predicate there. What is
  unchanged:

  - **Local objects.** The platform provisions their `organization_id`, so the
    anchor is real and the wall is untouched.
  - **A federated object that DECLARES a real remote `organization_id`.** The test
    is provenance — identity against the shipped column definition the registry
    spreads — not "is this object federated", so an author who exposes a genuine
    remote tenant column keeps their wall. Any inexact match is read as "not the
    platform's anchor" and leaves the wall in place: the fail direction is toward
    isolation.
  - **Layer 1 (business RLS).** App-authored policies still reach the compiler
    untouched (ADR-0049), including on federated objects.

  This is the plugin-security sibling of the engine-layer fix that withheld
  `DriverOptions.tenantId` for the same objects; that one cannot reach here,
  because Layer 0 is a `where` predicate composed into the query AST rather than a
  driver option.

  Record-ownership scoping (`__readScope` `own`/`unit` lowered to an `owner_id`
  predicate) reaches federated objects through the same phantom column set and is
  **not** addressed here — it is produced in `@objectstack/plugin-sharing` and is
  tracked separately.

- d97f2a2: fix(plugin-security): `getReadFilter` applies the `controlled_by_parent` derivation — the analytics read scope was missing the master half entirely

  `getReadFilter` is the read-scope provider bound by the analytics / raw-SQL
  path: the one read surface that bypasses the engine and therefore has no other
  source of scope. Its contract is that it returns **the same filter the engine
  middleware ANDs into every find**. That middleware injects three things — the
  RLS filter, the ADR-0055 `controlled_by_parent` derivation (`masterFK IN
(accessible master ids)`), and plugin-sharing's OWD / record-share filter.
  `getReadFilter` composed only the first and third; `computeControlledByParentFilter`
  was never called on that path at all.

  For an object whose `sharingModel` is `controlled_by_parent` that is not a
  partial gap but a total one, because the two layers it _did_ compose both stand
  down on exactly that object by design: such an object carries no authored RLS
  (the whole point of the model is that access is derived rather than authored),
  and it maps to `public` in plugin-sharing's `effectiveSharingModel`, so
  `buildReadFilter` returns `null`. Both halves returned `null`, the composition
  returned `undefined`, and the analytics path ran with **no predicate**. A caller
  who could not read a single master row through `/data` could still `COUNT(*)`
  and `GROUP BY` its detail rows through `/analytics` — and line-item objects are
  the usual shape here, so the grouped values are per-line prices and discounts.

  The derivation is now composed into the same AND on that path, resolved from the
  permission sets `getReadFilter` had already resolved (no second resolution), so
  the two read surfaces enforce identical scoping — which is why
  `computeControlledByParentFilter` was extracted and shared in the first place.
  Failures deny: the derivation is internally fail-closed, and a throw propagates
  to the method's existing fail-closed handler rather than widening the read. The
  delegated (`onBehalfOf`) branch already denied outright on this path (#2852) and
  is unchanged.

  This is the same failure shape #4467 fixed for the OWD/sharing layer of this
  method, one layer over; #5386 fixed _which inputs_ the derivation folds in, not
  _whether it runs_ on this surface.

  **Impact.** A deployment with `controlled_by_parent` objects and an analytics /
  raw-SQL consumer will see those queries return fewer rows — the rows the caller
  was never entitled to aggregate. No authoring change is required.

- 307e0fe: fix(security): govern `sys_member` writes — organization membership is not a delegable capability (#3697 follow-up)

  `DelegatedAdminGate`'s `GOVERNED_OBJECTS` covered the four RBAC link tables but
  not `sys_member`, so the table that decides _who is an org admin_ was the one
  authority surface the delegated-administration gate never saw.

  That matters because a membership row is an authority dial: `role` containing
  `owner`/`admin` is auto-elevated to `organization_admin` by
  `auto-org-admin-grant.ts`, and that set's wildcard `modifyAllRecords` is exactly
  what `isTenantAdmin()` tests. Writing one mints a tenant admin — the same
  escalation the invitation role cap closes on the issuance path, one layer down
  at the table.

  **Not exploitable today, and this changes no working behaviour.** Every
  `sys_member` writer is a better-auth path running under `isSystem`, which
  short-circuits the whole security middleware before this gate; the ADR-0092 D2
  identity write guard refuses user-context writes to better-auth-managed tables
  upstream of it. The gate is added so the chain cannot silently reopen the day a
  direct-write surface is introduced — a `case` label is not enforcement, and the
  call site is what decides (AGENTS.md Prime Directive #10).

  The rule is tenant-admin-only rather than scope-delegable, deliberately: no axis
  of `AdminScope` expresses "organization membership" (its vocabulary is BU
  subtree, action flags and an assignable-set allowlist), so there is nothing for
  a delegated scope to approve part of — and a delegate who could write one would
  mint authority strictly greater than their own, which is what ADR-0090 D12
  exists to prevent. Adding people to an organization already has a delegable
  path: the **invitation**, whose placement is authorized against the issuer's
  `adminScope` and whose role is capped at the issuer's own grade. The refusal
  message says so.

- 0e3a226: fix(authz): widen the driver's native tenant scope to the membership union
  under the `group` posture — ADR-0105 D2 finally reaches the wire (#3623)

  The Layer 0 wall correctly compiled `organization_id IN accessible_org_ids`
  under `group`, but the ObjectQL engine also propagated the active-org
  `tenantId` into `DriverOptions` unconditionally, and the SQL driver's native
  scoping ANDed `organization_id = tenantId` under the union — collapsing every
  group read back to active-org (isolated) reach. Found by the cloud-side
  `ee-group-showcase` dogfood (cloud#880), the first end-to-end boot of `group`
  against a real driver.

  - `DriverOptions.tenantIds` (spec): the union tenant access set. Drivers with
    native scoping widen reads/updates/deletes/aggregates to `IN (...)`,
    keeping the NULL-tenant global-row carve-out; inserts still stamp from
    `tenantId` (the active organization is the write target, D5). Absent or
    empty ⇒ equality fallback — fail toward isolation, never toward exposure.
  - ObjectQL engine threads `ExecutionContext.accessible_org_ids` as
    `tenantIds` when the tenancy posture is `group`, reported by a new
    `setTenancyPostureProvider` seam.
  - SecurityPlugin wires that provider at start — deliberately from the
    enforcement layer, so the driver wall only widens while the Layer 0 union
    wall enforces above it. Embeddings without plugin-security keep active-org
    equality.

- 8af76ae: The i18n extractor's default locale now tracks the source instead of merging (#8543), and the approval vocabularies carry authored English labels in the contract (#8580).

  - `os i18n extract` merge mode no longer applies to the default locale: `en` is a copy of the source, not a translation, so an edited label/description/help now reaches the regenerated `en` bundle instead of being silently shadowed by the stale entry forever (53 stale entries had accumulated across 6 packages under the old behavior; all rewritten here). Translated locales (`zh-CN` / `ja-JP` / `es-ES`) keep merge semantics exactly as before — no existing translation is overwritten.
  - Bare-string and label-less select options now seed through the extractor's derived channel: the machine value still seeds the skeleton, but the coverage gate no longer demands "translations" of machine identifiers, and a copied value can no longer masquerade as authored display text.
  - New `@objectstack/spec/contracts` exports `APPROVAL_STATUS_LABELS` and `APPROVAL_ACTION_KIND_LABELS`: the authored English for `sys_approval_request.status` (previously living only in the generated `en` bundle) and `sys_approval_action.action` (previously shipping raw machine values such as `submit` / `request_info` — the #7232 humanization missed this sibling field). Both columns derive their option labels from these maps; the regenerated `en` bundles copy them verbatim.

- d1cabaa: fix(i18n): translate the SSO / SCIM / user-position / import-job admin objects

  Four live, UI-facing system objects were registered but never added to their
  package's i18n extract config, so non-English admins saw raw English `label`
  metadata:

  - `sys_sso_provider`, `sys_scim_provider` (platform-objects) — identity-provider
    admin grids plus the register / verify-domain actions.
  - `sys_user_position` (plugin-security) — delegated position assignment
    (`userActions` create/edit/delete); its sibling `sys_user_permission_set` was
    already translated, so this closes an inconsistency.
  - `sys_import_job` (platform-objects) — import history / progress, alongside the
    already-translated `sys_job` / `sys_job_run`.

  Adds each object to its package's `scripts/i18n-extract.config.ts` and supplies
  real zh-CN / ja-JP / es-ES translations across all four locale bundles, and
  extends the bundle-ownership guards' `OWNED_OBJECTS` to cover them. The
  orphan-only guards from #3502 could not catch this "owned-and-live-but-never-
  extracted" gap.

- aff9e56: fix(i18n): translate the platform packages' declared surface, and gate all nine bundles instead of one (#3762)

  Only `platform-objects` was wired into a translation-drift check. The other
  **eight** packages shipped a `scripts/i18n-extract.config.ts` that nothing ever
  ran — and four of them had already drifted out of sync with the schema, exactly
  the rot `pnpm check:i18n` exists to catch, one directory over.

  **Translated.** `plugin-security` (45 strings per locale), `plugin-webhooks`
  (15), `plugin-audit` (8), `plugin-sharing` (7) and `service-storage` (7) are now
  at **zero** untranslated declared strings in zh-CN / ja-JP / es-ES — 246
  translations. Most were newly _visible_ rather than newly missing: #3753 taught
  the coverage detector to walk action `params`, `resultDialog`, `listViews` and
  the rest of the declared surface, and these are what it found.

  Wording was harvested from the repo's own bundles wherever a string was already
  translated somewhere (1382 unambiguous source strings), so `Created At` reads
  `创建时间` here because that is what it reads everywhere else, rather than a
  fresh invention. Protocol tokens are deliberately left identical across locales:
  `GET` / `POST` / `PUT` / `PATCH` / `DELETE`, `ETag`, `ACL`, `URL`.

  **Gated.** `scripts/check-i18n-bundles.mjs` replaces the single-package
  `pnpm check:i18n` and checks all nine. It does not restate each package's
  command — it parses the one already documented in that config's own docstring
  and runs it, so the documented regenerate command and the gate cannot diverge.
  The coverage ratchet grows the same way, from `examples/*` to twelve configs;
  eight of them sit at zero, which makes it the strict gate there.

  **Fixed a real truncation bug it exposed.** `os lint --json` on a large config
  came out of a pipe cut off at exactly 65536 bytes — `console.log(big)` followed
  by `process.exit(1)` tears the process down before an async pipe write drains,
  while an interactive run (stdout is a TTY, written synchronously) looks perfect.
  Every scripted consumer silently got invalid JSON. `emitJson` in
  `packages/cli/src/utils/format.ts` waits for the write to drain and sets
  `process.exitCode` instead; `lint`, `i18n check` and `i18n extract` use it.
  Roughly 30 other CLI commands share the pattern and are not touched here.

  The nine documented regenerate commands also gain `--no-metadata-forms` (added
  in #3768), since the Studio metadata-form baseline belongs to `platform-objects`
  alone, not to a copy in every plugin.

  Not fixed here: `platform-objects`' own 77-per-locale gap is `apps.*` /
  `dashboards.*` navigation and widget labels, which live outside the `objects`
  subtree and cannot be scaffolded while the package extracts with
  `--objects-only`. That needs an emit decision first — tracked in #3762.

- 3987a48: fix(security): `member_default` grants owner-scoped READ on the personal inbox (#7344)

  The Account app's **Inbox → Notifications** entry was a dead end for every
  non-admin. The app declares no `requiredPermissions`, so it is reachable by
  design for every authenticated user, but the object behind that entry was named
  by no shipped permission set — so the read came back `403 PERMISSION_DENIED`,
  verbatim from the browser-measured run:

  ```
  [Security] Access denied: operation 'find' on object 'sys_inbox_message'
  is not permitted for positions [org_member, contributor, finance, everyone]
  ```

  Two consequences were measured: the Notifications entry never rendered anything
  for the audience the Account app exists for, and the console bell's notification
  half was structurally **0** for any non-admin (a badge reading `2` was
  `0 notifications + 2 pending approvals`).

  `member_default` now NAMES both halves of the personal inbox, read-only:

  | object                     | read | create | edit | delete | row scoping                                                    |
  | :------------------------- | :--: | :----: | :--: | :----: | :------------------------------------------------------------- |
  | `sys_inbox_message`        |  ✅  |   ❌   |  ❌  |   ❌   | `sys_inbox_message_self` — `user_id == current_user.id`        |
  | `sys_notification_receipt` |  ✅  |   ❌   |  ❌  |   ❌   | `sys_notification_receipt_self` — `user_id == current_user.id` |

  `sys_notification_receipt` is not an extra: read-state lives on the receipt, not
  on the inbox row (ADR-0030), so the entry needs both to render.

  **This is not a rollback of #5491.** The baseline stays explicit-allow — no
  wildcard returns, and these are two NAMED objects in exactly the shape
  `sys_user_preference` already uses there: an object grant plus a `_self` RLS
  carve-out. Neither object declares `organization_id`, so Layer 0 is inert on
  them (as it is on `sys_oauth_application`) and the `_self` policies ARE the row
  scoping — without them the read bit would have been org-wide. A member reads
  their own rows and only their own; an unidentified caller fails closed to
  `RLS_DENY_FILTER` rather than open.

  The grants are READ-only because nothing in the flow needs more: rows are
  written by the always-on `inbox` messaging channel keyed on the recipient, and
  mark-read is served by `POST /api/v1/notifications/read` rather than the generic
  data API. `allowDelete`/`allowExport` stay false, so the set remains bindable to
  the `everyone` anchor (ADR-0090 D5).

  `sys_activity` is deliberately **not** included, per the maintainer ruling — it
  is not a per-user-scoped shape, and it is a separate question if it ever
  matters. It is pinned as an explicit negative in the tests.

- f3e26b7: docs(plugin-security,skills): re-premise `member_default`'s removed wildcard in the published customer skill and in the plugin's own README (#7151)

  Two shipped documents still described a permission-set shape the platform has not
  had for two releases. Both premises were re-measured against the real imported
  `defaultPermissionSets` at this branch point, and both had expired:

  - `member_default.objects['*']` is `undefined` — the plain `'*'` object grant was
    removed when the platform baseline narrowed to explicit-allow.
  - Neither `member_default` nor `viewer_readonly` carries a `tenant_isolation`
    entry in `rowLevelSecurity`, and neither carries any wildcard tenant policy at
    all. Tenant isolation is **Layer 0** (`tenant-layer.ts`) since ADR-0095 D1.

  **`packages/plugins/plugin-security/README.md`** described the pre-ADR-0095
  probe-and-strip mechanism as the plugin's own current behaviour ("Service present
  → keeps the wildcard `tenant_isolation` RLS policy … shipped with the default
  `member_default` / `viewer_readonly` permission sets"). Rewritten to the real
  mechanism: the plugin resolves a tenancy **posture** at start time; the tenant
  wall is Layer 0, AND-composed ahead of business RLS and inert under `single`; and
  the strip that survives targets the platform's own tenant-scoped policies **by
  provenance** (`organization_admin`'s `sys_member_org` / `sys_invitation_org` /
  `sys_team_org`, the `sys_organization_self` carve-out), never an app-authored
  policy — which reaches the compiler and fails closed there (ADR-0105 D3).

  **`skills/objectstack-data/SKILL.md`** (published customer guidance) did not
  merely mention the wildcard — its ⚠️ callout built a recommendation on a leak
  that cannot happen. The recommended recipe
  (`tenancy: { enabled: false }` + `requiredPermissions`) is unchanged and still
  correct, but every stated reason for it was rewritten to the measured one:

  - the empty-list symptom is the Layer 0 tenant wall denying rows whose
    `organization_id` is null or absent, not a `member_default` RLS policy;
  - `viewAllRecords` short-circuits business RLS only and never crosses the wall —
    that takes a true platform admin (the superuser bit **and** a
    platform-exclusive capability) on a posture that permits it;
  - the ⚠️ now names the surviving hazard truthfully. `tenancy: { enabled: false }`
    alone switches the wall off for every caller, and the risk is any permission
    set with a wildcard read grant — the shipped `viewer_readonly` still has one —
    not `member_default`, which grants only the objects it names.

  No runtime behaviour changes; documentation only.

- 8e0bb68: fix(plugin-security): a member can revoke their OWN API key — owner-scoped `update` on `sys_api_key` for `member_default` (#8053)

  An ordinary member who minted a personal API key could not revoke it.
  `PATCH /api/v1/data/sys_api_key/{their own id} {"revoked": true}` answered **403
  `PERMISSION_DENIED`**, the row stayed `revoked: false`, and the key kept
  authenticating. The `revoke_api_key` / `restore_api_key` row actions rendered in
  that member's own **My Keys** grid the whole time — a dead affordance on the
  persona the surface is built for.

  A personal API key acts as its owner ("treat it like a password", per the
  console's own mint screen), and the owner is the person who discovers it leaked.
  Their only remedy was to find an admin.

  This is the residual of #7727, one layer down. That fix was correct as far as it
  went: the method gate opened (`enable.apiMethods` gained `update`) and ADR-0092
  D2's column whitelist registered `revoked`. But the **object-CRUD** layer was
  untouched — the platform `member_default` set granted only `allowRead` across the
  better-auth-managed identity tables, so `update` on `sys_api_key` resolved for
  `admin_full_access` and nobody else. `GET /api/v1/security/explain` said so
  outright, as that member: _"No resolved permission set grants update on
  sys_api_key"_. Because #7727's tests all drove the admin, the member half stayed
  hidden behind its fix.

  `member_default` now carries an explicit `sys_api_key` entry with `allowEdit`.
  Two pre-existing mechanisms bound it, and the grant is deliberately not bounded
  by the permission-set boolean alone:

  - **which rows** — the `sys_api_key_self` RLS carve-out
    (`user_id == current_user.id`), which already made the row owner-_visible_;
    there was simply no `allowEdit` to go with it. A member PATCHing another
    user's key is still refused **403**, row unchanged.
  - **which fields** — ADR-0092 D2's identity write guard, whose per-object update
    whitelist for this table lists `revoked` alone. `key` stays unwritable (a
    rotated hash would mint a credential nobody holds) and `user_id` stays
    unwritable (re-owning a key is privilege transfer) — both are stripped even
    when smuggled alongside a legal `revoked`.

  **Unaffected, and pinned as such:** cross-owner revocation stays 403; a
  non-`revoked` column stays refused for the owner too; `create` / `delete` stay
  **405** at the method gate (minting remains `POST /api/v1/keys`, the only path
  that returns the raw secret once, and rows retire by revoking, not deleting);
  show-once semantics are intact. Every other better-auth-managed identity table
  stays write-denied — `sys_api_key` is the one exception, and it is one because
  that table is hand-rolled ObjectStack rather than better-auth-owned, with a
  registered whitelist already governing its single platform-owned column.

  The regression pin runs as the key's **owner**, not as an admin — the persona
  gap that let this survive #7727's own test suite.

- 7180ed5: fix(security): fail closed when an object's security posture can't be resolved
  (#3545)

  #3545 accepted the API-exposure gate's fail-open on unresolvable metadata on one
  load-bearing premise: that gate is a SURFACE-AREA control, while the real
  authorization boundary — auth + the ObjectQL security middleware (CRUD/FLS/RLS)
  — enforces unconditionally on the data call whatever the gate answers.

  Verifying that premise rather than assuming it shows it did not hold. The
  middleware does run unconditionally, but two of its INPUTS were read from the
  same object metadata and defaulted permissively when it could not be resolved,
  so the very trigger the issue is about reached one layer PAST the gate, into the
  boundary itself: an unresolved `access.default` read as PUBLIC (so a plain `'*'`
  wildcard covered an object ADR-0066 D2 excludes from it) and an unresolved
  `requiredPermissions` read as NO CONTRACT (so the D3 capability AND-gate was
  skipped entirely).

  `getObjectSecurityMeta` now flags `unresolved`, and the three consumers that turn
  posture into an access decision fail closed on it: the middleware denies (with an
  error log, so a persistent metadata outage is observable rather than a silent
  blanket-allow), `canExport` denies, and `getReadableFields` exposes no columns —
  the same stance already taken for a permission-resolution failure and a dangling
  delegator. `computeLayeredRlsFilter` keeps consuming the defaults deliberately:
  there the permissive value WITHHOLDS the cross-tenant exemption, so it is already
  the closed direction.

  Blast radius is bounded to the risky case. System/boot writes (`isSystem`) and
  principal-less/anonymous contexts short-circuit earlier in the middleware, so
  reaching the new check means an authenticated principal with resolved grants
  asking for an object whose declaration is missing; the cold-start window is
  served by those short-circuits, not by the permissive default. The exposure
  gate's own tiered decision (transient unavailability → fail open) is therefore
  unchanged — it now rests on a boundary that actually holds.

  The explain engine reports the denial on its existing `object_crud` layer naming
  the real cause, so the "why am I denied?" surface cannot drift from enforcement.

- 7ce02eb: feat(spec,objectql): `IObjectQLEngine` — the `objectql` slot's contract exists, the class `implements` it, and the seven consumer-local stand-ins are deleted (#4251 B3)

  ObjectQL registers one instance under two names, and the ledger can finally say
  what each name means: `data` stays `IDataEngine` (the data plane), `objectql`
  now resolves to **`IObjectQLEngine`** — the full engine: schema access
  (`getSchema` / `getObject` / `registry`), actions (`registerAction` /
  `removeActionsByPackage` / `executeAction`), the hook/middleware seams
  (`registerHook` / `unregisterHooksByPackage` / `registerFunction` /
  `registerMiddleware` / `bindHooks`), the first-wins default runners and hook
  metrics, boot wiring (`registerDriver` / `setDatasourceMapping` /
  `registerApp`), and the ops probes (`checkDriversHealth` /
  `wasDatastoreCreatedFromEmpty` / `invalidateDataMigrationFlags`). The ledger
  test pins the new relation: `objectql` strictly widens `data`, deliberately no
  longer equal.

  **Why now, and why `implements` is the point.** The honest state for two
  batches was recorded on `DomainHandlerContext.getObjectQL`: ObjectQL is wider
  than `IDataEngine`, the wider part had no contract, and typing it `IDataEngine`
  would be "the more comfortable-looking lie". The interim discipline — each
  consumer declares the narrow slice it uses — produced seven local surfaces
  (`AppEngineSurface`, `EngineRegistrySurface`, `EngineExtensionSurface`,
  `SecurityEngineSurface`, `FreshDatastoreEngine`, the dispatcher's inline
  `checkDriversHealth` slice, the `getObjectQL: any` itself). Each was honest and
  each was an UNCHECKED claim: `getService<Surface>('objectql')` is an assertion,
  so an engine rename would have broken every consumer at runtime with zero
  compile errors. `ObjectQL implements IObjectQLEngine` converts all of them into
  one compiler-verified claim. All seven stand-ins are deleted; consumers import
  the one declaration. `getObjectQL` is typed `Promise<IObjectQLEngine | null>`
  end to end, closing the oldest documented `any` in the dispatcher.

  **Evidence bar unchanged.** Every declared member has a cross-package consumer
  reaching it through the slot; engine members without one (e.g. `triggerHooks`,
  cross-package only in tests) stay off until a caller appears. The registry view
  (`EngineSchemaRegistryView`) declares exactly the eight members consumers use.

  **`_registry` never leaves the engine package now.** plugin-security's
  declared-metadata readers (`readDeclared`, permission-set projection, suggested
  audience bindings) reached ObjectQL's private `_registry` field through `any` —
  the same private reach `/me/apps` had in B2, five more times. All migrated to
  the public `registry` getter the contract declares, test doubles included.

  **`IMetadataService` gains `subscribe?` / `loadMany?`** — implemented by
  `MetadataManager` beside `watch` all along, reached through the slot only via
  `any` by ObjectQLPlugin's metadata bridge (the re-sync keeping runtime-authored
  hooks/actions live). With them declared, the bridge's six `metadata` lookups
  and metadata-protocol's `objectql` lookup carry contract types, and both files
  leave the grandfather list entirely: baseline **167 → 159 sites, 36 → 34
  files**.

- 00e9196: Surface the `isDefault` audience-binding suggestion on stock instead of skipping auto-bound declarations

  `GET /api/v1/security/suggested-bindings` returned an empty list on a stock boot even though the `isDefault` permission set and its `everyone` binding both existed. The security plugin binds the app's baseline set to the `everyone` anchor at boot, before the first reconcile runs, so `syncAudienceBindingSuggestions` always found the declaration already satisfied and skipped it entirely — no row was written, and the declaration only ever appeared after an admin deleted the binding by hand.

  An already-satisfied declaration is now recorded rather than skipped, in the state it is actually in: `confirmed` with an empty `resolved_by`, which is how the backing object defines an observed binding ("bound at boot or by hand, not confirmed through the prompt"). It is deliberately not `pending`: that is the actionable-prompt state the console panel lists and the confirm/dismiss methods accept, so a pending row would ask an admin to accept a binding that already exists.

  The existing flow is unchanged — an unbound declaration still surfaces as `pending`, and the pending-to-confirmed transition still fires when the binding is observed later.

- 8c767f5: fix(plugin-security): a `public_read_write` object is writable by everyone the access matrix grants `edit`, not only by each row's creator (#8023)

  An object declaring `sharingModel: 'public_read_write'` promised "everyone can
  see and edit" and delivered "everyone can see, only the creator can edit". A
  persona the access matrix grants `edit: true` could `GET` a row **200** and
  `PATCH` the same row **403 PERMISSION_DENIED**, with the record-level refusal
  ("You do not have access to this record…"). Three declarations agreed the write
  was allowed — the access matrix's `edit: true`, the object's OWD, and the
  absence of any authored RLS — and the runtime refused it anyway.

  The cause is the platform's own row-level write ownership floor.
  `member_default` ships `owner_only_writes` (object `'*'`, operation `update`,
  `created_by == current_user.id`, positions `['org_member']`). The by-id write
  pre-image gate lets `ISharingService`'s tri-state verdict **replace** that floor,
  but only on a positive `allow` — and on a public object the service **abstains**,
  because record sharing genuinely does not enforce there. An abstain keeps the
  floor, so the floor became the object's only row-level write gate and quietly
  overrode its OWD.

  An object whose author declared `public_read_write` now never inherits the
  wildcard `update` floor in the first place. Three boundaries are deliberate:

  - **`delete` is unchanged.** `public_read_write` is "see and edit"; the legacy
    `full` alias that also covered transfer/delete was refused a mechanical
    conversion for being _wider_ than it (ADR-0090 D4). `owner_only_deletes` still
    refuses a non-creator delete.
  - **Only the OWD that says so.** The declared model is read, never
    `plugin-sharing`'s effective bucket — which folds `controlled_by_parent` and an
    unset model on a system object into the same `'public'` value. A detail object
    derives access from its master, and an unset model on a `sys_*` table is a
    legacy default, so neither opens writes. An unresolvable schema fails closed.
  - **Only the platform's floor.** Provenance decides, so an app-authored policy
    spelling the identical predicate still reaches the compiler and still refuses
    (ADR-0049).

  Because the floor is removed at collection time, the write class is then empty
  and the derive-from-select scope supplies the write filter — so "you cannot
  mutate what you cannot see" continues to hold on these objects: a caller
  narrowed by select-only RLS still cannot write a row outside its readable set.

  Objects with any other OWD are untouched: on `private` and `public_read`, a
  non-owner write is still refused. The object-level gate is untouched too — a
  persona with `edit: false` still gets the object-level refusal, with its own
  distinct sentence. `POST /api/v1/security/explain` follows the same composition,
  so it stops reporting the `rls` layer as `narrows` for `update` on an object
  with zero authored RLS, while continuing to report a narrowing for `delete`.

- 0d9a779: fix(security): 让 permission-set 投影只写 spec 认的键，并把静默失败的 backfill 变响亮 (#4669)

  ADR-0094 D4 的 permission-set backfill 在 #4001 之后 **100% 失败**：`sys_permission_set`
  每一行都有 `active` 存储列，`permissionSetBodyFromRow()` 把整行转成 metadata body 时把它
  一起带上，而 #4001 已经把 `PermissionSetSchema` 封成 `.strict()` —— 于是每一次
  `saveMetaItem` 都抛 `[invalid_metadata] … Unrecognized key(s) on this permission set:
'active'`。失败被 `catch` 成一条 `warn`、计数器不加一，所以测试全绿、没有任何自动信号：
  一个整条停摆的投影路径就这样过了一个发布周期。

  **归属判定：`active` 是行状态，不是声明。** 它的全部消费面 —— 表列、`highlightFields`、
  Setup 列表视图的过滤器、两个启停动作的 `bodyExtra: { active: … }` —— 都是记录的运行时开关，
  不是作者声明的能力边界。所以修法是在**投影侧挑键**，而不是把状态提升进 spec
  （`packages/spec/**` 零改动）。

  - `permissionSetBodyFromRow()` / `mergeRowPatchIntoBody()` 现在都经过一个**从
    `PermissionSetSchema.shape` 派生**的键白名单（不是手抄的字符串数组 —— 手抄的话 spec 加键
    时这里又会静默漏，正是本 bug 的翻版）。存储列（`active`、时间戳、`managed_by` /
    `package_id` / `customized`）一律不进 metadata body；`#4001` 之前**已经落库**、body 里
    仍带着 `active` 的历史 overlay 行，也在同一个闸口被滤掉，因此它们的数据门编辑不再报 422。
  - 两个启停动作行为不变：只含行状态的 PATCH 不再被改写成 metadata 写入，而是原样交给驱动
    执行列写入（保留 history / `updated_at` / FLS 等正常语义），并且不会再给一个包自带的
    permission set 平白造出一条“customization” overlay。投影通道则不再从 body 读 `active` ——
    一次投影不会再用陈旧 body 把管理员刚停用的 set 重新打开。
  - backfill 真失败时按 AGENTS.md「Degradation log levels」(#4632) 变响亮：`error` 级、
    文案写明后果（记录照常列出、看起来一切正常，但定义不在 metadata 里，重新 provision 不会
    重建它）与修复动作，并新增 `ProjectionReconcileOutcome.backfillFailed` 计数，让降级出现在
    结果里而不只在日志里。

- 4c31321: Docs: bring the second ADR-0094 copy in `permission-set-projection.ts` up to D5-R.

  PR #6962 retired the 2026-07-14 "customize packaged permission sets through an ADR-0005
  env overlay" direction and corrected this file's **header**. A second copy survived in
  the function-level JSDoc of `upsertEnvPermissionSet` — an exported symbol, so the stale
  text ships in the published `.d.ts` and reads as fact to the next author. It stated both
  halves D5-R retired: that an env-scope overlay is the platform's standard customization
  of a packaged definition, and that deleting the overlay resets the row to the shipped
  declaration.

  Both are now stated as current: `#6483` (PR #6608) rolled `permission` back to
  `allowOrgOverride: false`, so a metadata write against a code-declared (artifact-backed)
  set is refused by the producer with 403 `NOT_OVERRIDABLE` and the supported channel is
  ADR-0086's (edit the package, re-publish); and `#6960` measures the ordinary delete path
  refusing to lift even a legacy pre-rollback overlay, leaving `OS_METADATA_WRITABLE` as
  the only documented removal — so "delete = reset" is recorded as retired rather than
  restated. The retirement itself is kept in the text, not deleted, so a reader arriving
  at this function does not have to reconstruct the history.

  Prose only — no behaviour change. The same retired direction was also corrected in three
  neighbouring comments in this package (the `readDeclaredBody` JSDoc, and the two
  `security-plugin.ts` package-managed write-gate comments) plus their two test rationales,
  so the package no longer states the direction in two voices.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- 7dbf4c3: test: twelve in-memory driver doubles in `plugin-sharing`, `plugin-security` and
  `runtime` conjoin `$or`/`$and` with their sibling filters instead of short-circuiting
  (part of #7620)

  Twelve test files across three packages built an in-memory driver whose `WHERE`
  matcher **returned early** on `$or` (and usually `$and`), discarding every sibling
  equality key in the same object:

  ```ts
  if (Array.isArray(filter.$or)) return filter.$or.some((f) => matches(row, f));
  if (Array.isArray(filter.$and))
    return filter.$and.every((f) => matches(row, f));
  for (const [k, v] of Object.entries(filter)) {
    /* siblings, never reached */
  }
  ```

  A real driver ANDs them. So a query mixing an equality key with a top-level `$or`
  would have been answered on the `$or` alone, handing back rows the sibling key
  would have excluded — not a stricter or looser edge case, a different query, with
  the suite staying green while testing it.

  The fix is the ~2-line change already established by `packages/objectql`'s six
  (#7846) and by several already-corrected siblings in these same two packages
  (`bu-tree-recompute.test.ts`, `recipient-width.test.ts`, `sharing-rule.test.ts`,
  `system-caller-inert-grant.test.ts`, `business-unit-graph.test.ts`): fold the
  combinator check into a guard that only short-circuits on **failure**, so the
  sibling-key loop still runs afterward.

  **This lane's file enumeration differs from the issue body**, which is stale
  (confirmed in-thread): `plugin-sharing/src/sharing-rule.test.ts` was already fixed
  before this PR, and three files this PR fixes were never named in the issue at all
  (`plugin-sharing/src/sharing-service.test.ts`,
  `plugin-security/src/check-only-write-scope.test.ts`,
  `plugin-security/src/select-only-write-visibility.test.ts` — found by re-grepping
  `$or` across both packages' `src/*.test.ts` at this PR's base ref rather than
  trusting the issue's list). Files corrected here:

  - `packages/plugins/plugin-sharing/src/`: `authored-row-write-deferral.test.ts`,
    `boot-backfill.test.ts`, `bulk-recompute.test.ts`, `record-share-cascade.test.ts`,
    `sharing-service.test.ts`, `system-write-skip-notice.test.ts`
  - `packages/plugins/plugin-security/src/`: `authored-row-write-verdict.test.ts`,
    `check-only-write-scope.test.ts`, `row-write-widener-composition.test.ts`,
    `select-only-write-visibility.test.ts`, `vama-write-path-convergence.test.ts`
  - `packages/runtime/src/domains/`: `share-links-enforcement-context.test.ts`

  **All twelve are dormant today — measured, not assumed**, via the same
  `fs.appendFileSync` probe discipline #7846 used (a `console.log` probe was tried
  first, returned nothing, and was correctly distrusted rather than read as "zero
  calls"). Per-package results, with a positive control proving the probe would have
  caught a live case:

  - `plugin-sharing`'s six: **0 combinator calls out of ~1.52M matcher invocations**
    across the six suites (dominated by one bulk-recompute test's own scale; the
    other five totalled ~2,755). Positive control: instrumenting the already-fixed
    `sharing-rule.test.ts` with the identical probe, then reverting it, recorded 151
    `$or` and 3 `$and` calls in the same run — proof the zero above is a real
    absence, not a dead probe.
  - `plugin-security`'s five: **not** all-zero like objectql/sharing — `$and`
    appears 23–71 times per file and `$or` appears twice in one file
    (`authored-row-write-verdict.test.ts`). But every single one of those calls
    carried the combinator as the **only** key in its filter object (`other: []`),
    so early-return and conjoin produce identical results in every case observed —
    dormant in the sense that decides this PR, for a different reason than
    objectql/sharing (never invoked, vs. invoked but never mixed with a sibling).
  - `runtime`'s one file: 1 `$or` and 10 `$and` calls, same "combinator-only, no
    siblings" shape — dormant for the same reason as `plugin-security`.

  No existing test outcome changes anywhere, and none should: `plugin-sharing`
  (21 files / 569 tests), `plugin-security` (52 files / 1037 tests) and `runtime`
  (151 files / 2317 tests) are green before and after, byte-identical assertions.

  **Operator-support measurement, per the card's ask**: unlike the objectql six
  (measured byte-for-byte identical operator support), these twelve are **not** a
  single lowest common denominator. `plugin-sharing`'s matchers mostly support
  `$in`, several add `$ne` or `$gte`/`$gt` (the tree/graph-shaped ones), and
  `sharing-service.test.ts` supports only `$in`. `plugin-security`'s five and the
  `runtime` one are the most uniform subset (`$in` only, identical shape). A shared
  helper across all sixteen files repo-wide would have to be a strict superset or
  force some suites to drop operators they use — a materially different tradeoff
  than the objectql lane's "no lowest common denominator to flatten to" finding.

  Deliberately **not** extracted into a shared helper here either, for the same
  reason `packages/objectql`'s six gave: keeping each test double's substrate
  self-contained so it can fail independently of any other suite's fixture file.
  Where a cross-package helper would live, and whether the missing regression guard
  is worth adding, are open questions for the PM now that all three lanes of #7620
  have landed — not decided in this PR.

- 5b47ab5: refactor(data)!: the QueryAST request surface stops declaring what no executor runs — `joins` and `windowFunctions` removed, six search flags and `aggregations[].filter` marked experimental, and the liveness ledger now governs the query surface (#4286)

  #4196 removed one declared-but-inert member from `FieldNode`. Applying the same
  method to the rest of the request surface (#4286) found 12 more members of
  `QueryAST` that no executor runs — `packages/objectql`'s `engine.ts` contains
  zero reads of any of them on the query path. This change dispositions the
  mechanical tiers and closes the gate that let the class stay invisible.

  **Removed (tombstoned): `query.joins` and `query.windowFunctions`.**

  - `joins` — no engine or driver ever read it; a query carrying it silently ran
    as a single-table query. Related-record retrieval already has a live
    spelling: `expand`. The orphaned `JoinNode` / `JoinNodeInput` /
    `JoinNodeSchema` / `JoinType` / `JoinStrategy` exports are deleted with the
    key (`data/JoinNode`, `data/JoinType`, `data/JoinStrategy` leave the
    published JSON schemas).
  - `windowFunctions` — `find()` never applied it, so every OVER clause it
    declared was silently dropped. The one live door is the SQL driver's own
    `findWithWindowFunctions(object, query)` (driver-level, not on the
    `IDataDriver` contract), and its input is a flat driver shape the spec
    vocabulary never matched — `WindowFunctionNodeSchema` declared `field` /
    `over` / `frame` members that door never read. The `WindowFunction` /
    `WindowSpec` / `WindowFunctionNode` exports are deleted with the key.

  **FROM → TO**

  | Was                                                     | Now                                                                                                             |
  | :------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------- |
  | `joins: [{ type: 'inner', object: 'customer', on: … }]` | `expand: { customer_id: { object: 'customer', fields: ['name'] } }`                                             |
  | `joins` for one related column                          | `fields: ['customer_id.name']` (dotted path)                                                                    |
  | `windowFunctions: [{ function: 'rank', … }]` in a query | `aggregations` + `groupBy`, or rankings in report/dashboard metadata                                            |
  | OVER-clause SQL from an embedder                        | `sqlDriver.findWithWindowFunctions(object, { windowFunctions: [{ function, alias, partitionBy?, orderBy? }] })` |

  The one-line fix: **delete the key**. Both are `retiredKey()` tombstones on the
  non-strict `BaseQuerySchema`, so authoring either fails `tsc` (input type
  `never`) and a query still carrying one — even as an empty array — fails to
  parse with the prescription itself. `QueryAST` is a request shape, never stored
  in stack metadata, so there is no `os migrate meta` step: the removals are
  registered as protocol-17 **semantic** migrations (`query-joins-retired`,
  `query-window-functions-retired`), the #4196 precedent.

  Compat note for the REST boundary: both names remain **reserved** list-query
  parameters while the tombstones live (`retiredKey()` keeps a key in
  `keyof QueryAST`, which feeds `RESERVED_LIST_QUERY_PARAMS`), so nothing changes
  for objects with fields named `joins`/`windowFunctions` — the un-reservation
  happens when the tombstones age out, and is called out in
  `metadata-protocol`'s `QUERY_AST_KEYS` comment for whoever does it.

  **Marked `[EXPERIMENTAL — not enforced]` (no wire or compat impact):**
  `search.fuzzy` / `operator` / `boost` / `minScore` / `language` / `highlight`
  (the ADR-0061 expansion reads only `query` + `fields`) and
  `AggregationNode.filter` (a SQL `FILTER (WHERE …)` affordance neither the SQL
  builders nor the in-memory fallback applies). Authoring one is now a
  declaration, not a silent no-op.

  **Deliberately NOT dispositioned here** (they want a maintainer call, #4286
  steps 3–4): `having` (the strongest enforce candidate — `engine.aggregate()`
  currently rebuilds the driver AST without it), and `cursor` / `distinct`
  (shipped SDK producers `QueryBuilder.cursor()` / `.distinct()`; `distinct` is
  mis-wired — its only observable effect is suppressing the REST list count).
  All three are recorded `dead` with evidence in the new ledger.

  **The gate:** `QuerySchema` joins the liveness ledger through the gate's
  `SPEC_ONLY_SCHEMAS` override (the `webhook` precedent) as governed type
  `query` — the first governance of what _callers_ write into a query rather
  than what authors write into metadata files. `packages/spec/liveness/query.json`
  classifies all 27 walked members (15 live with evidence, 7 experimental via
  describe markers, 5 dead), so the next declared-but-inert request member fails
  CI instead of needing a person to notice it.

  `@objectstack/plugin-security` (patch): the FLS predicate guard's
  `windowFunctions` walk is pruned — the clause no longer exists to leak through.
  The `having` and `aggregations[].filter` walks stay, deliberately: those
  members remain declared, and the guard being ready is what makes enforcing
  them later safe.

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

- 76bcb83: feat(spec): filter-subtree provenance — the cross-field refusal names an author's own columns again, without re-disclosing policy (#8220, A of the #7929 ruling)

  #8198 (B of the 2026-08-12 #7929 ruling) made the SQL family's cross-field
  `{ $field }` refusal withhold its operands from **every** caller, because the
  predicate reached the driver as a bare `FilterCondition`: an administrator's
  CEL sharing/permission rule and the author's own filter were indistinguishable
  there. The accepted, named cost was the author's diagnostic. This change is A
  — the sanctioned follow-up that pays it back behind a real mark instead of a
  guess.

  **The mark** (`@objectstack/spec/data`, `filter-subtree-provenance.ts`) is a
  spec-declared symbol on a filter subtree: `markFilterSubtreeProvenance(subtree,
'author' | 'policy')`, read positionally by
  `resolveFilterSubtreeProvenance(root, node)` (innermost mark on the ancestor
  chain wins; located by object identity, never structural equality). It rides
  the `where` tree by reference across the `DriverQuery` boundary — no new slot,
  documented on `DriverQuery` itself — and is dropped by exactly the operations
  (serialize, copy, rewrite) after which no attestation could be trusted.

  **Set at both read-scope merge boundaries**: `plugin-security`'s CRUD RLS
  injection marks every injected scope `'policy'` and the caller's verbatim
  predicate `'author'` — the latter only under the identity vouch
  `ast.where === options.where`, so a tree a sibling middleware already rewrote
  is vouched for nobody. `service-analytics`' `ObjectQLStrategy.withReadScope`
  marks its scope `'policy'` and the strategy-built user filter `'author'` (and
  `resolveFkAttr`'s scope arm `'policy'`).

  **Consumed by the SQL family** (`driver-sql`, `driver-turso`'s
  `RemoteTransport`; `driver-sqlite-wasm` inherits): a refusal raised from a
  subtree positively marked `'author'` carries its full diagnostic on the wire
  again — both columns, the operator, the list index, the boundary reason —
  same identity (`INVALID_FILTER` / 400).

  **⚠️ The fail direction is closed, and it is the design**: unmarked or
  ambiguous — no mark anywhere, a mark lost to serialization, a node
  unreachable from the query's own `where`, conflicting aliased marks —
  withholds exactly like `'policy'`. The mark is permission to reveal, never a
  requirement to prove secrecy; a driver-side guess at provenance is the shape
  the #7929 triage rejected.

  **Two B-era pins were REWRITTEN deliberately, not weakened.** First,
  `service-analytics`' `cross-field-engine-fallback.test.ts` pinned B's blanket
  redaction on refusals of the caller's OWN `where` (no scope in play) — under A
  that caller is the vouched author, so those cases now assert the corpus's
  `diagnosticIncludes` fragments are back on the wire, while the
  policy-injected-scope case gains the explicit non-disclosure assertions as its
  fail-closed pair. Second, the sharper one:
  `packages/runtime/src/cross-field-refusal-operand-withhold.test.ts` pinned
  author-written and policy-injected refusals **byte-identical** — the strongest
  available statement of "the driver cannot tell them apart", and explicitly the
  assertion A was chartered to supersede. Its successor pins the three-way split
  #8220's "Done means" names: policy-injected withholds (unchanged), the vouched
  author's filter names its columns again (the messages now differ, by design),
  and an unmarked predicate still withholds **byte-identical to the policy
  case** — B's surviving half. Reading that diff as a regression is exactly what
  the old pin's comment warned against; the file header carries the full
  account.

  Unaffected: the REST boundary's 5xx-only withhold (#5367/#5667) and every
  refusal outside the cross-field family.

- dc6abfd: fix(plugin-security): 被拒收的 capability 声明不再连派生占位一起压掉 (#4967 Part 1/3)

  `SecurityPlugin` 分两遍种 `sys_capability`:第一遍落包声明的 capability
  (`managed_by:'package'` + `package_id`),第二遍种平台 curated 集合 + 从
  permission set 的 `systemPermissions[]` **派生**的 back-compat 占位,并**跳过**
  第一遍报上来的名字,以免占位把已写好的声明覆盖掉。

  问题在于第一遍报的是「读到的每个名字」,而不是「真正落了行的名字」:
  `bootstrapDeclaredCapabilities` 在 upsert 作出任何决定**之前**就把
  `cap.name` 推进了返回列表。而 upsert 有三条**拒收**路径,一行都不写。其中
  「声明没有归属包」这一条既没写行、又占住了名字,于是派生占位也被跳过——
  capability **在任何一行里都不存在**。净效果是:**写下这条声明,比不写还糟**
  (不写至少还有派生占位)。这正是 showcase 的
  `showcase.export_data` 只留下一条 `warn` 的成因。

  修法是把「上报」与「读到」拆开:一个名字进入上报列表(现更名为
  `materializedNames`)的条件,是本遍**确认它有行**——本遍写成了
  (seeded / updated / claimed),或找到一行不能被覆盖的既有行(admin 自建、他包
  所有、curated 平台名)。三条拒收路径按「派生是否会覆盖既有 authored 行」分别
  处置,理由写在代码里:

  - **curated 平台名**:仍然上报。curated 那一遍无条件种这些名字,行必然存在;
    且派生路径本来就够不到 curated 名(它已在 curated 表里)。
  - **他包所有 / admin 自建**:仍然上报。行存在且 label/description 是**作者写
    的**,派生会把它们刷成 humanize 出来的占位——压掉派生正是这份列表的用途。
  - **没有归属包**:仅当已存在一行时才上报。没有行时回落到派生占位,和「从未
    写过这条声明」时一样。

  同时补上这条路径此前缺失的计数器 `skippedUnowned`,于是每条具名声明恰好落在
  一个计数器里,列表与计数器可以对账。

  **行为变化(升级须知)**:一条被拒收(无归属包)且被某个 permission set 授权
  的 capability,此前在 `sys_capability` 里**没有任何行**,现在会出现一行
  `managed_by:'platform'` 的派生占位——即它在 Setup 的能力列表里可见、可解析、
  带 humanize 出来的 label。注意这不改变**运行时判定**:权限求值一直是按
  `systemPermissions[]` 里的字符串取并集的,从不查 `sys_capability`;恢复的是
  注册表一侧的 declared = enforced(能力有定义记录、可见、可管理、有 provenance),
  不是把一个原本不生效的授权变成生效。若某个部署依赖「那条能力在能力列表里查不
  到」,升级后它会出现。

  诊断消息同时按 #4632 改进(级别仍为 `warn` —— 功能性降级,非持久性失败):
  拒收时点名**授权它的 permission set**,并写明真实后果,例如
  `[security] declared capability "showcase.export_data" has no owning package (granted by showcase_ops): falls back to the back-compat derived placeholder …`。
  无人授权、或已有行的情形各有对应措辞。

- 30f1b74: fix(plugins): a declared item reaches its schema intact — retire the `i?.content ?? i` unwrap from plugin read paths (#8378)

  Ten production reads over `SchemaRegistry.listItems` unwrapped every declared
  item as `i?.content ?? i`, presuming a `{ name, content }` storage envelope.
  That envelope has **no producer**. Re-measured at these seams rather than
  inherited from #7519's measurement of `MetadataFacade`:

  - `registerMetadataCollections` (objectql) registers each stack-collection
    element as-is — `registerItem(type, item, 'name')`, no boxing;
  - `loadMetaFromDb` registers `convertStoredItem(JSON.parse(record.metadata))` —
    the parsed body, never the `sys_metadata` row (whose body column is
    `metadata`, not `content`);
  - the facade's own interim boxing of non-object values, the one writer that ever
    produced the shape, was removed by #8349.

  **Removal is a fix, not a cleanup.** None of the types read through these seams
  — `permission`, `position`, `capability`, `object`, `sharingRule`, `webhook`,
  `emailTemplate` — declares a stored `content` key; every one of them rejects it
  as an unrecognized key. So wherever the key did appear the unwrap replaced a
  whole authoring document with one of its values, and `''` — falsy but
  non-nullish — passed `??` and then died at the reader's own `filter(Boolean)`,
  dropping the item with no warning, no count and no row.

  **On email templates the harm was sharpest, and it is the one users will
  notice.** `content` really is a spelling an author can write there:
  `EmailTemplateDefinitionSchema` lists it in its `strictObject` **aliases** table
  (`content: 'bodyHtml'`). That table is a _rejection_ facility, not a conversion —
  it feeds `strictUnknownKeyError`, which runs only on the `unrecognized_keys`
  path and only builds a message; nothing rewrites the key, and the ADR-0087
  conversion layer has no `email_template` entry either. The schema was therefore
  always ready with the author's fix, and the unwrap was the one thing standing
  between the author and it: the HTML string reached
  `EmailTemplateDefinitionSchema.parse()`, which answered `Invalid input: expected
object, received string`, and the boot warning's `name` field came back
  `undefined` — so an operator could not even tell **which** template had failed.

  A template authored with `content` now yields what it was always meant to:

  > Unrecognized key(s) on this email template: `content`. Did you mean
  > `content` → `bodyHtml`?

  …named against the template it came from, and counted as `skipped` rather than
  vanishing.

  No behaviour changes for spec-valid metadata: the reads hand back exactly the
  documents they always did.

- 94a0bbc: fix(security)!: a disabled RLS policy no longer grants — found by re-verifying the ledger's security subset (#3896 follow-up)

  **The fix.** `RowLevelSecurityPolicySchema.enabled` promises, verbatim: _"Disabled
  policies are not evaluated."_ Nothing read it — not the collection site, not the
  projection round-trip, not the compiler. Because applicable policies OR-combine
  (any match allows access), a policy an admin switched off **kept contributing its
  grant**: disabling a too-permissive policy silently changed nothing. That is the
  #3896 shape — a documented security control whose real behaviour is wider than
  its contract — one layer up, on RLS instead of sharing rules.

  `getApplicablePolicies` now excludes `enabled === false` before any matching, at
  the single choke point both the find path and the analytics path flow through —
  the same place, and the same ADR-0049 enforce-or-remove resolution, as the
  formerly-unenforced `positions` domain. Exact `=== false` on purpose: the schema
  defaults `enabled` to true and projection rows may omit the key, so absent stays
  active. Four tests pin both directions. Access-narrowing only: no policy grants
  MORE after this change, and nothing in-repo authors `enabled: false`.

  **The audit that found it.** All 44 entries of the liveness ledger's security
  subset (`permission` 33, `position` 4, `object` sharing/access 7) were
  call-graph-closed by hand and stamped `verifiedAt: 2026-07-30` — the subset's
  first-ever re-verification (previously 4 dated entries repo-wide, and the last
  sweep that cited preview renderers went 10-for-13 wrong). Beyond `enabled`:

  - `rowLevelSecurity.priority` → **dead + authorWarn**. Not merely unimplemented:
    policies OR-combine (the schema's own describe says most-permissive-wins), so
    the promised "conflict resolution" semantics cannot exist. A REMOVE candidate
    per the #3715/#3950 precedent while the v17 breaking window is open.
  - `rowLevelSecurity.label` / `description` / `tags` → dead (benign display —
    no consumer in either repo; deliberately not authorWarn'd).
  - `tabPermissions` was UNDERSTATED: the note said only `'hidden'` is read, but
    hono's rank merge reads all four visibility values across resolved sets, and
    the `me-apps-and-everyone-baseline` dogfood test exercises it. Evidence
    upgraded; noted as a proof-binding candidate.
  - `allowExport` re-verified TRUE against the suspicion that it was
    projection-only: the export route carries its own caller-level 403 gate
    (`enforceExportPermission`), fail-closed when the security service cannot
    answer, separate from the object-level 405.
  - `allowTransfer/Restore/Purge` notes re-confirmed accurate (M2 operations still
    unshipped; the RBAC gates are pre-mapped fail-closed).
  - `object.ownership` evidence had rotted (line drift) — refreshed; six other
    object-level security entries re-cited and stamped.

  No other runtime behaviour changes.

- bf1edef: feat(formula,lint): wire ADR-0056 D4's RLS authoring gate, from the runtime's own predicate (#4983)

  `isSupportedRlsExpression` has carried the same docblock since ADR-0056 D4:
  "exposed so an authoring-time gate (`objectstack compile`) can REJECT a
  predicate the runtime would silently drop … A `false` here means 'this
  predicate will never enforce'." It had **no non-test consumer anywhere** — the
  function written to fix declared-but-never-read was itself declared and never
  read. This lands the consumer, in two steps that had to happen in this order.

  **1. `sqlPredicateToCel` and `isSupportedRlsExpression` move FROM
  `@objectstack/plugin-security` (`src/rls-compiler.ts`) TO `@objectstack/formula`
  (`src/rls-predicate.ts`), and are exported from its root.** Executable code
  unchanged — a change of address, not of behaviour; `plugin-security` now imports
  them from `@objectstack/formula` and keeps no copy, so there is still exactly
  one definition. No import path outside the two packages changes: neither symbol
  was ever exported from `@objectstack/plugin-security`'s entry point. The move is
  what makes step 2 possible at all — `@objectstack/lint` may depend on
  `@objectstack/spec` and never on a runtime, so with the predicate living in a
  runtime the gate's only other door was copying the SQL→CEL bridge, whose
  boundary conditions (quoted literals are never rewritten; canonical CEL passes
  through unchanged) _are_ the gate's red/green line. A fork drifting by one
  character rejects policies the runtime executes correctly — the false-positive
  direction, which is worse than the gap. ADR-0058 D1 asks for a single canonical
  shape gate; the bridge is part of that gate.

  **2. New `@objectstack/lint` rule `validateRlsPredicateEnforceability`,
  `error`, on all three authoring commands**, over
  `permissions[].rowLevelSecurity[].using` and `.check`:

  - **`rls-predicate-unenforceable`** — parses as CEL, outside the pushdown
    subset: a function call (`size(...)`, `has(...)`), arithmetic, a ternary, a
    cross-object path (`record.account.region`).
  - **`rls-predicate-unparseable`** — does not parse as CEL even after the legacy
    SQL bridge (`=` → `==`, `IN` → `in`): SQL `AND` / `OR` / `LIKE`, a subquery.
    Its own id because the fix is different — write CEL (`&&`, `||`), not a
    different shape.

  What the gate prevents, measured through `plugin-security` rather than inferred:
  `RLSCompiler` drops the policy and logs one request-time WARN. On the read path,
  when it is the only applicable policy, `compileFilter` returns the
  `RLS_DENY_FILTER` sentinel instead, which is AND-ed onto the where clause — so
  every select / update / delete on the object matches **zero rows**. On the
  ADR-0058 D4 write path the post-image `check` becomes that same sentinel, which
  no record satisfies, so every insert / update fails with `PermissionDeniedError`.
  The runtime fails closed, which is why this was survivable: the result is not a
  hole but a policy that reads as an authorization and behaves as a blanket
  refusal, with nothing at authoring time pointing at the line that caused it.

  Fix a flagged predicate by rewriting it inside the lowerable subset — `==` `!=`
  `>` `<` `>=` `<=`, `in`, `&&` `||` `!`, `== null` / `!= null`, and
  `startsWith` / `endsWith` / `contains` over single-column field paths (ADR-0058
  D2), against a literal or a `current_user.*` value. Two specific migrations:
  `has(x)` / `size(x) > 0` → `x != null` (a function call is correct in an object
  _validation_ rule, which is interpreted, and wrong here, where the predicate is
  compiled to a filter); and a related record's field → denormalise it onto this
  object (formula/rollup) and test that column, since RLS cannot join (ADR-0055).

  Same construction as the sharing-rule gate (#4698): the rule does not model the
  consumer or grep for it — it calls `isSupportedRlsExpression`, the exact
  function `RLSCompiler.compileFilter` consults to decide whether a dropped policy
  earns its warning, so the two verdicts are one boolean by construction, pinned
  in both directions over a shared corpus. Measured before shipping: every RLS
  predicate declared anywhere in this repo — the `plugin-security` platform seeds,
  the examples, the dogfood fixtures, the authoring skill — is supported, so the
  gate turns nothing red that works today. Unlike the sharing-rule gate, CEL
  _syntax_ is reported here rather than deferred to `expression-invalid`:
  `validateStackExpressions` does not walk `rowLevelSecurity` at all, and could not
  judge this field correctly if it did, because `owner_id = current_user.id` is a
  CEL syntax error and a working RLS predicate at the same time.

- 21888ab: fix(plugin-security): propagate engine faults from permission pre-image probes instead of reading them as absent rows (#7505)

  `SecurityPlugin`'s shared by-id probe, `readRowById`, answered `null` for three
  different facts — the row does not exist, the engine threw (driver down, table
  missing, timeout), and no engine is wired — and every gate that probes with it
  read all three as "no such row". Its own contract note claimed a `null` "always
  DENIES downstream". That was true of one caller and false of the rest, in two
  opposite directions:

  - **`assertControlledByParentWrite`** reported a store outage as **`404
RECORD_NOT_FOUND`**. After #7474 split that leg out, the answer was precisely
    wrong in a way an SDK acts on: 404 is terminal, so a client drops the record
    id and stops retrying at exactly the moment the truthful answer was "come back
    in a minute".
  - **The two admin-door provenance gates** (`sys_permission_set`'s ADR-0086
    two-doors gate and `sys_position` / `sys_capability`'s ADR-0066
    asset-ownership gate) read `null` as "this row is not package/platform-managed"
    and let the write **through**. For the duration of a store fault, both
    boundaries silently stood down — fail-**open**.
  - **The owner-anchor echo** caught the throw and answered `403 changing record
ownership`: fail-closed, but with a sentence accusing the caller of an
    ownership grab they never attempted, on an envelope a client will not retry.

  Per the maintainer ruling of 2026-08-11 the posture is **fail-closed**, and an
  outage is never reported as a missing record. An engine fault now propagates out
  of the probe and out of the gate, so the write is refused (nothing reaches the
  driver) and the caller is told what actually happened. The error is re-thrown as
  the engine threw it rather than re-badged: objectql's `DatasourceUnavailableError`
  keeps its `ERR_DATASOURCE_UNAVAILABLE` code and reaches the wire as **503**,
  which is the answer a client can back off on. Wrapping it in a security code
  would have relabelled a dependency outage as an authorization event.

  `null` from the probe now means one thing: the row is genuinely absent.

  **Steady-state behaviour is unchanged at every call site** — an absent detail
  row still answers `404 RECORD_NOT_FOUND`, a package-managed row is still refused
  403, an unchanged-owner form echo is still tolerated, and a pre-image the caller
  cannot read still denies exactly like one that is not there (the
  owner-enumeration oracle is untouched). Only the fault path moved.

  Deliberately unchanged: the master-visibility probe inside the same
  controlled-by-parent gate still treats a throw as "not visible" and answers 403.
  The two probes ask different questions — "does this row exist", which an outage
  leaves unanswered and which must not be answered "no", versus "is this master
  visible to you under your own write policy", whose fail-closed default genuinely
  is "not visible".

  You may now see `503 ERR_DATASOURCE_UNAVAILABLE` from a write that previously
  returned `404`, `403`, or — at the two provenance gates — succeeded, but only
  while the datasource behind the probed object is unavailable.

- 1659072: feat(spec): publish `ISecurityService` — the `security` service surface becomes an enforced contract

  The `security` service registers seven cross-package methods (`getReadFilter`,
  `getReadableFields`, `resolvePermissionSetNames`, `explain`, and the three
  audience-binding suggestion calls) but had no contract in
  `@objectstack/spec/contracts`. Consumers duck-typed it, and each one invented its
  own fallback for a missing method or an "empty" answer — with more consumers
  arriving, that is a drift surface.

  `ISecurityService` now documents the surface, and both ends are typed against it
  so it is **enforced rather than declared**: `plugin-security` assigns its
  registration to `ISecurityService` (a renamed, dropped, or re-typed method fails
  that build), and the REST layer resolves the service as a `Partial<ISecurityService>`
  (so call sites must keep feature-detecting instead of assuming the full surface).

  The contract makes explicit the one thing consumers cannot guess — that the
  methods do **not** share a failure convention:

  - `getReadFilter` fails **CLOSED**: a resolution failure yields a deny filter
    matching zero rows, never `undefined`. `undefined` means "no row restriction",
    and nothing else.
  - `getReadableFields` fails **SOFT**: `undefined` means "no answer, use your own
    projection", while `[]` is authoritative and means "no field is readable" —
    opposite instructions that a consumer must not conflate.

  Typing the producer immediately caught one real discrepancy, fixed here:
  `getReadFilter` declared `Promise<Record<string, unknown> | null | undefined>`
  while every return path yields a filter or `undefined` (`filter ?? undefined`
  normalizes the null away). The dead `| null` is removed, so "no restriction" has
  exactly one representation. Type-level only — no runtime behaviour changes.

- f450ae7: feat(spec,plugin-security): publish the caller's resolved permission SETS on the `security` service (#7616)

  `ISecurityService` could report the caller's effective permission-set **names**
  (`resolvePermissionSetNames`) and nothing else. That is the right primitive for
  an audience check — "does this caller hold `sales_manager`?" — and the wrong one
  for a **merge**. A consumer that must fold the caller's grants into one answer
  needs the sets themselves: `objects`, `fields`, `systemPermissions`,
  `tabPermissions`. None of the four is reachable from a name.

  So the two consumers that need a merge re-implement the resolution instead.
  `/auth/me/permissions` and `/me/apps` (`plugin-hono-server`'s
  `current-user-endpoints.ts`) each resolve the caller's permission sets by hand,
  alongside `SecurityPlugin`'s own copy on the data plane — **one rule, three
  copies**, and it has now drifted from the enforcement path three times, each
  divergence found only after it reached a user:

  - **#7608** — the plugin applied the ADR-0090 D5 baseline additively while both
    endpoints kept the `resolved.length === 0` fallback cliff, so a member's first
    grant took them from **2 apps to 1** on `/me/apps`.
  - **#7555 / PR #7605** — an app-declared `isDefault` set _displaced_
    `member_default` here rather than composing with it.
  - **#6334** — the same file's grant aggregation missed `sys_user_position`
    entirely; closed by delegating to `resolveUserAuthzGrants`, which is the
    precedent this extends one step further.

  **New: `ISecurityService.resolvePermissionSetsForContext(context)`** — the same
  resolution `resolvePermissionSetNames` reports the names of, returned whole and
  in resolution order. Implementations must return the sets their own enforcement
  path resolved (positions expanded, the D5 baseline applied additively, the D10
  agent-principal rule honoured), never a re-derivation. Merge semantics stay with
  the caller on purpose: two consumers legitimately project different subsets of
  the same sets, and folding a merge in here would make the method a fourth copy
  of the rule rather than the one source of its input.

  **It is OPTIONAL, and that is load-bearing.** The contract's availability rule
  has consumers resolve this service as `Partial<ISecurityService>`, so a caller
  must keep its own resolution as the fallback until a floor version carrying the
  method can be assumed. Declaring it optional makes that degradation a property
  of the type — the unguarded call does not compile — rather than a promise in
  prose.

  `plugin-security` exposes it on the **registered service literal**, not merely
  as a public class member. That distinction is the whole point: the two
  consumers must never take a runtime dependency on `plugin-security` (it is
  optional in the stacks those endpoints serve), so the service locator is the
  only seam that can carry the delegation, and a method the class declares but the
  literal does not expose is unreachable across it.

  **One implementation gap closed so the declaration is true rather than
  nominal.** The plugin's `sys_permission_set` loader hydrated `objects`, `fields`
  and `systemPermissions` but dropped `tab_permissions`, so every **DB-authored**
  set came back without the column `/me/apps` filters its app list with. Nothing
  on the data plane reads `tabPermissions` (the evaluator never mentions it), so
  this is inert for enforcement today — but shipping a contract that promises the
  sets whole over a loader that drops a quarter of them is exactly the
  declared-≠-delivered defect this card exists to prevent. The row is already
  fetched in full: no extra query, one JSON parse.

  **No behaviour changes today.** The method has no caller yet — by design. The
  call sites are step 2 and land separately, because `/me/apps` deliberately
  projects a narrower column set than `/auth/me/permissions`, so delegating
  changes which columns load on both surfaces: a user-visible change that wants
  its own before/after measurement rather than riding along on a contract
  addition.

  Also corrects a stale doc-comment on `resolveFallbackPermissionSets`, which
  still described the `resolved.length === 0 && fallbackName` second step that
  PR #7615 deleted (that guard _was_ the fallback cliff D5 abolishes).

- b54aaab: fix(plugin-security): a by-id write target must be inside the caller's readable set when only select-scope RLS is authored

  An object whose row narrowing is authored as `operation: 'select'` rules only had an
  **open by-id write path**. A low-privilege user could `PATCH` records they could not
  read — 200, values persisted — on the object itself and on a `controlled_by_parent`
  detail, while the read side correctly hid the same rows (404 on GET, absent from list).

  The cause was a single missing scope. The by-id write pre-image gate, the
  controlled_by_parent master check and the bulk write filter all compose the RLS filter
  for the **write** operation. With no update-scope policy applicable to the caller,
  that filter compiled to nothing and every one of those row gates became a no-op at
  once; an open sharing model (`public_read_write`) then admitted the write. Deriving the
  detail's access from the same permissive master verdict spread it to details as well.

  An empty write-class policy collection now **derives its scope from the caller's
  `select` narrowing** — the same policies, compiled by the same compiler, that the read
  path enforces. "You cannot mutate what you cannot see" holds by construction on all
  three gates, and the explain engine reports the same narrowing for `update`/`delete`
  that it reports for `read` instead of "No RLS policy applies".

  Migration-visible change: on an object narrowed by select-only RLS, a by-id or bulk
  `update`/`delete` of a row **outside the caller's readable set** is now refused
  (`PERMISSION_DENIED`, 403) where it previously succeeded. Reads, inserts, and any
  object that **does** author an update- or delete-scope policy are unaffected — where a
  write-class predicate exists it keeps deciding alone, so app-authored write wideners
  behave exactly as before. Callers holding a read-side superuser bypass
  (`viewAllRecords` on a posture-permitting object) are not newly narrowed. An app that
  relied on the previous behaviour should author an explicit `operation: 'update'` policy
  expressing the wider write scope it intends.

- f00d8d4: fix(sharing): remove the `full` access level — it promised delete/transfer/share and granted `edit` (#3865)

  `sys_sharing_rule.access_level` / `sys_record_share.access_level` offered three
  levels, the third documented as **Full Access (Transfer, Share, Delete)**. No
  code path granted transfer, re-share, or delete because of it: both enforcement
  sites matched `access_level in ('edit','full')`, so `full` was byte-equivalent
  to `edit`. An admin picking "Full Access" in Setup was told they had granted
  delete rights and had not — declared-but-unenforced metadata (ADR-0078,
  ADR-0049), the same defect that retired the `queue` recipient before it.

  Measured on showcase, a `full` recipient got `read: allowed`, `update: allowed`,
  `delete: DENIED` — and the denial came from `decidedBy=object_crud`, i.e. the
  object-level CRUD gate rejected the delete _before_ sharing was consulted at
  all. That is not an oversight to patch around; it is the model working. Record
  sharing widens **which rows** a principal reaches, never **which verbs** they
  may use — the same split Salesforce enforces (its sharing rules stop at
  Read-Only / Read-Write; Full Access is owner / hierarchy / Modify All only,
  never grantable by a rule) and Dataverse enforces by AND-ing every shared access
  right against the security role's own privilege. Delete and transfer belong to
  ownership, the ADR-0057 DEPTH scopes, and admin scope.

  **What changed**

  - `SharingLevel` (spec/security) and `ShareAccessLevel` (spec/contracts) are now
    `read | edit`. The `Field.select` on both objects offers the same two, so the
    Setup dropdown no longer shows the misleading option.
  - `SharingService.grant()` and `SharingRuleService.defineRule()` gained the
    access-level validation they never had: `full` normalises to `edit`, and an
    unrecognised level is a `VALIDATION_FAILED` (HTTP 400) instead of being
    persisted verbatim as a grant no gate would ever match.
  - Enforcement stays deliberately wider than authoring — the read/write gates
    still match `edit`/`full` — so a row written before this release keeps
    working. Narrowing them would silently _revoke_ access.
  - A boot backfill normalises stored `full` rows on both tables, and the
    `sharing-rule-access-level-full-to-edit` conversion rewrites declarative
    stacks at load, so nothing needs consumer action.

  **Migration.** None. `full` and `edit` were already behaviourally identical, so
  rewriting one to the other cannot change an access decision — unlike the OWD
  `sharingModel: 'full'` alias retired in ADR-0090 D4, which changed posture and
  had to be delegated to the author. A stack that still authors `accessLevel:
'full'` converts at load with a deprecation notice; stored rows normalise at
  next boot. Code that pinned the `ShareAccessLevel` type to `'full'` no longer
  compiles — use `'edit'`.

  Reviving a real per-record delete grant is a separate design (a capability mask
  AND-ed with object CRUD, plus the share-administration model that would have to
  authorise re-sharing), not a fourth enum member.

- d92c72d: fix(lint,runtime,core): the slot-lookup guard sees the split-declaration form — the shape that made the ratchet look cleaner the more it was used (#4251)

  The three selectors from #4321 all key off the erasure and the lookup being in
  ONE expression. Split them and every selector misses:

  ```ts
  let ql: any;
  try {
    ql = ctx.getService("objectql");
  } catch {
    /* optional */
  }
  ```

  Selector 1 needs the call inside the declarator (this declarator has no init),
  selector 2 needs `as`, selector 3 needs a type argument. The contract is erased
  exactly as in `const ql: any = ctx.getService(…)`.

  **Why this could not wait for the batches.** The baseline's monotonicity check
  means a file that leaves the grandfather list can never be re-added. So every
  batch converted more of this shape from "grandfathered" into "lint covers this
  file and says nothing" — B2 alone moved `plugin-security/security-plugin.ts`
  into that state. A ratchet that reports a cleaner number the more you sweep is
  the #4342 failure wearing different clothes, and the fix only gets more
  expensive per batch shipped.

  **It is a rule, not a fourth selector, and that is the whole finding.** esquery
  can match `AssignmentExpression:has(CallExpression[…])`, but it cannot tell
  which declaration the assigned identifier resolves to — so it would equally
  flag the correctly-typed form this work line exists to produce (`let
i18nService: II18nService | undefined; i18nService = …`, 8 such sites today in
  runtime/app-plugin.ts, service-automation and metadata-protocol). Resolving the
  identifier needs SCOPE analysis. That is cheap and needs no type information, so
  this stays out of the typed-lint pass the KNOWN RESIDUAL still waits on — but it
  is a rule, and the earlier "just one more selector" estimate was wrong.

  Verified against exactly that: the rule flags all 16 real sites and none of the
  8 correctly-typed lookalikes.

  **Scale.** The baseline goes 140 → **169 sites** with the file count unchanged
  at 37: 29 sites were already inside grandfathered files and simply invisible.
  16 more could NOT be grandfathered (12 in files earlier batches had cleared, 3
  in files never listed, 1 the regex sweep had missed) and are typed here —
  `runtime/app-plugin.ts` ×5, `core/fallbacks/authored-translation-sync.ts` ×2,
  `plugin-security/security-plugin.ts` ×2, `cloud-connection/{runtime-config,
marketplace-proxy}-plugin.ts` ×3, `platform-objects/src/plugin.ts` ×2,
  `runtime/http-dispatcher.ts`, `runtime/domains/ai.ts`. No baseline key was
  added; the key set still only shrinks.

  Contracts where they exist (`IAIService`, `IJobService`, `IMetadataService`,
  `II18nService`, `IDataEngine`, `IHttpServer`), named local surfaces where they
  do not — `AppEngineSurface`, `SecurityEngineSurface`, `RawAppHost`,
  `EnvRegistrySurface`, `FreshDatastoreEngine`, `AuthoredTranslationSink`. Two of
  those record something worth naming: `IHttpServer` has no `getRawApp()` (the
  contract is framework-agnostic and the raw app is Hono's own handle), and
  ObjectQL's `_defaultBodyRunner` / `_defaultActionRunner` have no public reader
  at all — the engine attaches them via `(this as any)` and publishes nothing,
  while `getHookMetricsRecorder()` exists for exactly that question about the
  metrics recorder. Declared rather than laundered through `any`, and filed.

- c54c822: fix(spec,plugins): sweep the auth/session slot lookups — 31 sites typed, and the user-import metadata reader was pointed at a service that never had the method (#4251)

  Batch B2 of the #4251 sweep: every service-lookup erasure in the auth/session
  family. `plugin-auth/auth-plugin.ts` (20), `plugin-hono-server/current-user-endpoints.ts`
  (10) and `plugin-security/security-plugin.ts` (1) now pass the slot's contract
  type; the ratchet baseline drops **171 → 140 sites, 40 → 37 files**.

  **The yield.** `POST /admin/import-users` resolved the `metadata` slot and probed
  `metadataService?.getMetaItem` to decide whether to pass the import's field-coercion
  dependency. `getMetaItem` is a **protocol** method — `ObjectStackProtocolImplementation`,
  registered by MetadataProtocolPlugin under the `protocol` slot. `MetadataManager`,
  which occupies `metadata`, has never had it. So the probe was false on every
  deployment and the dep was never passed: imported rows reached `sys_user`
  uncoerced, with the branch that says otherwise sitting right there. This is the
  same shape as #4127's dead `automation.trigger` and #4321's `registerInMemory`
  probes — a capability the code advertises and the runtime cannot deliver, kept
  invisible by the `any`. Typing the lookup to `IMetadataService` is what turned it
  into a compile error. The route reads `protocol` now.

  `/me/apps` reached ObjectQL's **private** `_registry` through `as any` while
  `/auth/me/permissions`, two handlers up in the same file, read the public
  `registry` getter over the same field of the same object. Both read the public
  accessor now; the one test that stubbed `_registry` was pinning the private reach
  and stubs `registry` instead.

  **Contract, from evidence.** `IDataEngine`'s read methods (`find` / `findOne` /
  `count` / `aggregate`) declare the trailing `options?: BaseEngineOptions`
  argument they have always accepted. ObjectQL's own doc explains why it exists:
  reads once took their context inside the query while writes took it in trailing
  `options.context`, so the same `{ context }` object was correct as `insert`'s 3rd
  argument and **silently dropped** as `find`'s — "an intended `isSystem` bypass
  just vanished". The engine accepts both channels; the contract exposed only the
  query one, so callers using the trailing channel — the current-user endpoints'
  permission-set loader among them — could only reach it by erasing the lookup.
  Adding an optional trailing parameter breaks no implementor (the existing
  minimal-implementation test proves it) and no caller. `BaseEngineOptions` was
  already exported, sitting unused under the "legacy/deprecated" heading, which is
  why the contract went looking and did not find it; it moves up beside the other
  QueryAST-aligned types with the rationale attached. One new spec test pins the
  trailing argument at the call site — the position where the old contract rejected it.

  **Where the contract does not reach, the escape hatch is named.** Three slots
  resist a spec type today and each gets a narrow, documented local interface
  instead of `any`: `security.permissions` (plugin-security's `PermissionEvaluator`
  — plugin-hono-server must not depend on an optional plugin), `settings`
  (service-settings' resolver, same reason), and ObjectQL beyond `IDataEngine`
  (`registry` / `getSchema` / `registerHook` / `registerMiddleware`). That last one
  is deliberate scope: the standing record on `getObjectQL` in `@objectstack/runtime`
  says ObjectQL is genuinely wider than `IDataEngine` and nobody has written the
  wider contract, so typing the whole thing `IDataEngine` would be "the more
  comfortable-looking lie". These declarations are what that contract gets written
  from, and what it deletes.

  No behavior changes beyond the two fixes above.

- 779bab3: fix(plugin-security): withdraw the `sys_capability` Deactivate dialog's false promise that deactivation revokes access (#8535)

  **A shipped confirmation dialog's promise is being withdrawn.** The
  `deactivate_capability` action told the admin, verbatim:

  > Deactivate this capability? Grants and resource requirements that reference it
  > stop resolving until re-activated.

  No code path has ever enforced that. `PermissionEvaluator.getSystemPermissions()`
  unions `permissionSets[].systemPermissions` — plain strings — and a resource's
  `requiredPermissions` is matched against that string set. Neither loads a
  `sys_capability` row. The table's only two production readers are the seeders
  (`bootstrap-system-capabilities.ts`, `bootstrap-declared-capabilities.ts`), which
  **write** `active: true` on insert and never read it back.

  **What `active` actually means now, stated plainly:** it is a catalogue /
  visibility flag. It marks a row inactive for filtering and review in Setup, and it
  has **no authorization effect whatsoever**. Deactivating a capability revokes
  nothing — permission sets that grant it and resources that require it match it by
  name and keep resolving exactly as before.

  The direction of the old falsehood was the dangerous one. An admin withdrawing a
  capability was told the withdrawal took effect, and it silently did not — the
  escalation is what they believed they had prevented. This is ADR-0049
  enforce-or-remove; per the maintainer ruling of 2026-08-13 the claim is
  **withdrawn, not enforced**. Putting the capability registry on the authorization
  hot path is an architectural change — caching, fail-closed semantics, org-authored
  rows influencing platform capabilities — that must arrive as a designed feature
  with its own card if capability lifecycle management ever earns real pull, not as
  a side effect of wiring up one field.

  Changes, all presentation and text — no behaviour changes, because there was no
  behaviour to change:

  - the confirmation dialog now states the non-effect outright rather than merely
    omitting the promise: an admin who remembers the old wording has to be told it
    was wrong, not left to infer it;
  - the same correction is made in **all four shipped locales** (`en`, `es-ES`,
    `ja-JP`, `zh-CN`). Editing the source object does **not** rewrite shipped
    bundles — the extractor preserves existing leaf values, so a changed string
    stays stale in every locale until corrected by hand;
  - `active` gains a `description` it never had, declaring its real semantics
    including the negative half. Its absence is how the dialog became the only place
    the field's meaning was stated — and that statement was false;
  - `active` is demoted from `highlightFields`, from the `danger` action variant,
    and from the two scoped list views, and stays in the full-catalogue view where a
    catalogue attribute belongs. A truthful dialog under a field still presented as
    first-class tells the admin the flag matters after all.

  Admins who deactivated a capability expecting access to stop should be aware that
  access never stopped, and should withdraw the grant itself (the permission set's
  `systemPermissions`) instead.

- 4f99860: fix(plugin-security): a plain member can no longer read the organization's whole invitation ledger (#8095)

  **Security — narrowing.** Any authenticated `member` of an organization could
  read **every** `sys_invitation` row of that organization through the data API:
  each invitee's email address, the role they were about to be granted, who
  invited them, and the expiry. Measured live: `GET /api/v1/data/sys_invitation`
  as a plain member returned `200` with the same rows the org **owner** sees.

  The grant was declared, not accidental. `sys_invitation` is in
  `BETTER_AUTH_MANAGED_OBJECTS`, whose blanket `denyWritesOnManagedObjects()`
  entry sets `allowRead: true` on every managed identity table for
  `member_default` and `viewer_readonly` — reads permitted, "subject to the rest
  of the RLS chain". For this object there was no rest of the chain: neither set
  declared a row-level policy for `sys_invitation`, and an object with no
  applicable policy compiles to a null business-RLS filter, i.e. no row scope at
  all. `sys_member` is a staff directory and reads org-wide on purpose; a pending
  invitation is administrative _intent_ about people who are not members and never
  consented to a directory listing — and _who is about to become an admin_ is
  enough for targeted social engineering.

  **What changed.** `member_default` and `viewer_readonly` each gain one
  row-level policy, `sys_invitation_self` (`select`,
  `email == current_user.email`), and `organization_admin` (with the wall-less
  `organization_admin_no_bypass` variant derived from it) gains
  `sys_invitation_org_admin` — the org-administration side of the same ledger,
  scoped by `positions` to `org_owner` / `org_admin`.

  The second policy is not decoration. `member_default` resolves for **every**
  authenticated principal (the `everyone` anchor), so the addressee scope reaches
  org admins too, and on the **default** `single` posture neither mechanism that
  normally keeps an admin whole is present: the wildcard
  `viewAllRecords` short-circuit is withheld from a wall-less deployment
  (ADR-0105 D4), and `sys_invitation_org` is stripped as a platform tenant policy
  when org isolation is inactive (ADR-0105 D3). Measured on a stock boot with only
  the member-side scope in place, the org **owner** read zero invitations — the
  Invitations page would have gone blank for the one persona entitled to it.
  `sys_invitation_org_admin` states the admission on the axis that survives both,
  carrying no tenant token for the strip to key on; the organization boundary
  remains Layer 0's, which AND-composes ahead of it, so its widest reach is the
  admin's own organization — exactly what `sys_invitation_org` already declared.

  **The invitee still sees their own invitation**, and that half is not
  incidental: the recipient-side row actions on `sys_invitation`
  (`accept_invitation` / `reject_invitation`) are gated on
  `record.email == ctx.user.email`, so an addressee who cannot read their row
  cannot act on it. The object-level read bit is therefore deliberately left open
  and the narrowing done at the row level — closing the object would have broken
  acceptance while looking like the same fix.

  **Not covered by the ruling, and therefore unchanged here:** a
  `delegated_admin` normalizes to neither `org_owner` nor `org_admin`, so that
  role now reads only its own row through the data API even though it may issue
  invitations. Filed separately rather than decided in this PR.

  **Unaffected.** Every better-auth organization endpoint
  (`invite-member`, `accept-invitation`, `reject-invitation`,
  `cancel-invitation`, `list-invitations`, `list-user-invitations`,
  `get-invitation`) reads and writes `sys_invitation` through the identity
  adapter under a system context, so the invitation lifecycle and the console's
  accept page — which use those endpoints, not the data API — behave exactly as
  before. Owners and admins are unchanged, in both the wall-enforcing
  (`organization_admin`) and wall-less (`organization_admin_no_bypass`)
  variants. Platform admins are unchanged.

  **You may notice** that a principal who is neither owner nor admin no longer
  sees other people's invitations on a generic `sys_invitation` grid — including
  the Setup app's Invitations page and the Organization record's Invitations tab
  if a non-admin reaches them. That is the fix, not a regression. A deployment
  that genuinely wants a wider invitation read should declare it on an
  application permission set rather than rely on the managed-object baseline.

- 6b441a8: fix(plugin-security,spec): `sys_position.name` uniqueness is per organization (#8468)

  `sys_position` declared its uniqueness as a table-level index with bare
  `unique: true`. At the DECLARED-index level that is the positional spelling of
  `'global'` — the listed columns verbatim — so on a tenant-scoped object it
  materialized an **installation-wide** unique index. (Field-level `unique: true`
  means the opposite, per-organization, and has since #3696; `packages/lint` names
  that divergence "the #4986 trap" and warns on it via
  `unique/unscoped-declared-index`.) This is the third instance of the class
  ruled on 2026-08-13, after `sys_user_preference` and `sys_capability` (#8461).

  Measured live on a real engine before the fix — two organizations, same name,
  `OS_TENANCY_POSTURE=isolated`:

  ```
  CREATE UNIQUE INDEX uniq_sys_position_name on sys_position (name)

  org_jia POST name=sales_manager  → 201
  org_yi  POST the SAME name       → 409 UNIQUE_VIOLATION
  org_yi  POST an unused name      → 201
  org_yi  GET  that name           → total 0
  ```

  Two consequences. **An organization could not name a position that any other
  organization had already used** — `sales_manager` taken installation-wide meant
  a permanent, unexplained 409 on a perfectly ordinary name. And because the
  refusal is per-value on a row the caller cannot read, it was a **cross-tenant
  existence oracle**: an admin could enumerate other organizations' position
  vocabulary by reading 409-vs-201.

  The declaration now says `unique: 'organization'` (ADR-0120 D1), materializing
  `(COALESCE(organization_id,'__global__'), name)`. Platform-seeded rows
  (`bootstrapBuiltinRoles` — `platform_admin`, `org_*`, and the ADR-0090 D9
  audience anchors) carry no organization and the key part is NULL-safe (ADR-0120
  D3), so they stay unique among themselves and the bootstrap upsert-by-name is
  unaffected. Same-organization duplicates are still refused — the constraint is
  scoped, not removed.

  Positions are deliberately flat (ADR-0090 D3, finalizing ADR-0057 D5), so the
  "a hierarchy implies a shared namespace" argument does not arise here: there is
  no `parent_id` on this object.

  **Published text.** The field's spec `describe()` said "Unique position name",
  and `content/docs/references/identity/position.mdx` is generated from it, so the
  docs asserted installation-uniqueness as though it had been intended. The
  `describe()` now reads "Position name, unique per organization" and the
  reference page is regenerated from it; the object's own field description and
  the `clone_position` dialog's help text are corrected to match.

  **Migration.** No new machinery: the `replace_unique_index` retirement that
  #8461 generalized to declared indexes covers this object unchanged. Respelling a
  declared index changes its generated name, which on a deployed database would
  otherwise read as two unrelated findings — the composite missing (safe) and the
  old global index orphaned (**destructive**) — letting an operator who applies
  only the safe half keep the defect while the plan reads as applied. Instead it
  plans as ONE `replace_unique_index` entry categorised `safe`, CREATE before
  DROP, with the legacy index dropped only once the replacement is confirmed
  present.

  Operators upgrading a deployed database should run `os migrate plan` / `os
migrate apply` — no `--allow-destructive` required. Note that **deploying the
  new code is not by itself the fix**: `initObjects` is additive, so until the
  retirement is applied the old installation-wide index keeps enforcing (and the
  constraint is never unenforced at any point in the migration).

- 7e4783f: fix(plugin-security,service-messaging): two more tenant-scoped declared unique indexes become per-organization (#8577)

  Two platform objects declared their uniqueness as a table-level index with bare
  `unique: true`. At the DECLARED-index level that is the positional spelling of
  `'global'` — the listed columns verbatim — so on a tenant-scoped object each
  materialized an **installation-wide** unique index. (Field-level `unique: true`
  means the opposite, per-organization, and has since #3696; `packages/lint` names
  that divergence "the #4986 trap" and warns on it via
  `unique/unscoped-declared-index`.) These are the fifth act of the class ruled on
  2026-08-13, after `sys_user_preference` / `sys_capability` (#8461),
  `sys_position` (#8556) and the five of #8554.

  | object                            | package             | was                                                | now                    |
  | --------------------------------- | ------------------- | -------------------------------------------------- | ---------------------- |
  | `sys_notification_subscription`   | `service-messaging` | `[topic, principal]` global                        | same, per organization |
  | `sys_audience_binding_suggestion` | `plugin-security`   | `[package_id, permission_set_name, anchor]` global | same, per organization |

  Measured live on a real engine before the fix — two organizations, the same key,
  `OS_TENANCY_POSTURE=isolated`, driving the real shipped declarations. Both
  reproduced identically:

  ```
  org_jia POST the key   → 201
  org_yi  POST the SAME  → 409 UNIQUE_VIOLATION
  org_yi  POST an unused → 201            ← the control that makes it an oracle
  org_yi  GET  the key   → total 0        ← refused by a row it cannot see
  ```

  `sys_notification_subscription` is the class's usual shape and the direct sibling
  of `sys_notification_preference`: a user belonging to two organizations could not
  subscribe to the same topic in both, and since `role:x` / `team:x` principal
  names are themselves per-organization, the same string denoted different
  subscribers while colliding on one installation-wide key.

  `sys_audience_binding_suggestion` is **more serious, and it is not a naming
  collision at all.** Its key is the owning package's id, the package's own
  permission-set name and the anchor — the same triple for every tenant that
  installs the same package — while the row is per-tenant by construction
  (ADR-0090 D5/D9: raised when a package's `isDefault` set is observed, resolved
  when a tenant admin confirms). So the second and every later organization to
  install a package never got its suggestion row: its admins were never prompted to
  bind the package's default permission set, its users never received that set, and
  nothing reported it — the reconciler cannot distinguish the cross-tenant UNIQUE
  violation from the benign concurrent-sync race its `catch` was written for. Both
  halves are now pinned end to end: two organizations installing the same package
  each end up with their own pending row, and re-running one organization's sync
  still adds nothing.

  ### One caveat on `sys_audience_binding_suggestion`

  This release makes a per-organization suggestion row **possible**; it is not yet
  what the platform writes. The reconciler still reads and writes through a
  tenant-less system context, so on a shared-runtime multi-organization
  installation the surface continues to hold one organization-less row that every
  tenant reads — measured, recorded as a test, and tracked in #8617, which remains
  open. Single-organization installations are unaffected either way.

  ## ⚠️ Operators: a migration is REQUIRED, and deploying this release is not it

  Respelling a declared index changes its generated **name**. On an existing
  database `initObjects` is additive: it creates the new per-organization composite
  at boot and **never drops the old global index**, which goes on enforcing. Until
  the retirement is applied, a deployed installation that has taken this release
  still refuses the second organization's row — that is asserted as a test, not
  assumed.

  Run the migration:

  ```
  os migrate plan       # shows one `replace_unique_index` per object, categorised `safe`
  os migrate apply      # no --allow-destructive needed
  ```

  Each object plans as **one pure relaxation**, not as two findings. That matters:
  if it read as "composite missing" (safe) plus "old global index orphaned"
  (destructive, opt-in), an operator applying only the safe half would keep the
  global index — keep the defect — while the plan read as applied. The #8461
  `replace_unique_index` arm covers both unchanged (no driver change in this
  release), applies CREATE-before-DROP so uniqueness is never unenforced in
  between, drops the legacy index only once the replacement is confirmed present,
  preserves every row, and converges to no drift.

  Two details worth an operator's attention:

  - **Both** replacement index names are **hash-suffixed**, because their natural
    names are 66 and 90 characters against a 60-character limit:
    `uniq_sys_notification_subscription_799a483c` and
    `uniq_sys_audience_binding_suggestion_a736dc5a`. On
    `sys_audience_binding_suggestion` the legacy name
    (`uniq_sys_audience_binding_suggestion_79a05fef`) is hash-suffixed too, so the
    two differ only in the hash. That is expected, not corruption.
  - Rows with no `organization_id` (platform/seed rows) stay unique **among
    themselves**: the organization key part is NULL-safe
    (`COALESCE(organization_id, '__global__')`, ADR-0120 D3), so seeding by name
    keeps working and a tenant may hold its own row of the same key.

  ## Not breaking

  A relaxation admits key pairs that were previously refused and refuses nothing
  that previously succeeded, so no caller that worked before fails now. Every read
  path for these two objects goes through the tenant-scoped data API, so no
  consumer resolves one of these keys across organizations expecting at most one
  row. Shipped as `patch` for that reason — the same call #8556 and #8554 made for
  the same shape.

  The one published uniqueness claim about either object — "one per package × set ×
  anchor" on the permission-sets guide — now reads "one per organization × package
  × set × anchor". Neither object's field text made a uniqueness claim, so no
  translation bundle changed.

- b45c71e: fix(plugin-security,plugin-sharing,plugin-webhooks,platform-objects,service-messaging,spec): five tenant-scoped declared unique indexes become per-organization (#8554)

  Five platform objects declared their uniqueness as a table-level index with bare
  `unique: true`. At the DECLARED-index level that is the positional spelling of
  `'global'` — the listed columns verbatim — so on a tenant-scoped object each
  materialized an **installation-wide** unique index. (Field-level `unique: true`
  means the opposite, per-organization, and has since #3696; `packages/lint` names
  that divergence "the #4986 trap" and warns on it via
  `unique/unscoped-declared-index`.) These are the fourth act of the class ruled on
  2026-08-13, after `sys_user_preference` / `sys_capability` (#8461) and
  `sys_position` (#8556).

  | object                        | package             | was                                | now                               |
  | ----------------------------- | ------------------- | ---------------------------------- | --------------------------------- |
  | `sys_permission_set`          | `plugin-security`   | `[name]` global                    | `[name]` per organization         |
  | `sys_sharing_rule`            | `plugin-sharing`    | `[name]` global                    | `[name]` per organization         |
  | `sys_webhook`                 | `plugin-webhooks`   | `[name]` global                    | `[name]` per organization         |
  | `sys_email_template`          | `platform-objects`  | `[name, locale]` global            | `[name, locale]` per organization |
  | `sys_notification_preference` | `service-messaging` | `[user_id, topic, channel]` global | same, per organization            |

  Measured live on a real engine before the fix — two organizations, the same key,
  `OS_TENANCY_POSTURE=isolated`, driving the real shipped declarations. All five
  reproduced identically:

  ```
  org_jia POST the key   → 201
  org_yi  POST the SAME  → 409 UNIQUE_VIOLATION
  org_yi  POST an unused → 201            ← the control that makes it an oracle
  org_yi  GET  the key   → total 0        ← refused by a row it cannot see
  ```

  Two consequences, both removed. **A cross-tenant existence oracle:** the 409 is a
  per-value answer about a row the caller cannot read, so an organization could
  enumerate another organization's permission-set, sharing-rule, webhook and
  template naming. **A functional dead end:** the second organization simply could
  not use the name, and the refusal did not say why. For
  `sys_notification_preference` the shape is the one #8323 measured on
  `sys_user_preference` — a user belonging to two organizations could not hold
  independent per-topic delivery toggles.

  ## ⚠️ Operators: a migration is REQUIRED, and deploying this release is not it

  Respelling a declared index changes its generated **name**. On an existing
  database `initObjects` is additive: it creates the new per-organization composite
  at boot and **never drops the old global index**, which goes on enforcing. Until
  the retirement is applied, a deployed installation that has taken this release is
  still enumerable — that is asserted as a test, not assumed.

  Run the migration:

  ```
  os migrate plan       # shows one `replace_unique_index` per object, categorised `safe`
  os migrate apply      # no --allow-destructive needed
  ```

  Each object plans as **one pure relaxation**, not as two findings. That matters:
  if it read as "composite missing" (safe) plus "old global index orphaned"
  (destructive, opt-in), an operator applying only the safe half would keep the
  global index — keep the defect — while the plan read as applied. The `#8461`
  `replace_unique_index` arm covers all five unchanged (no driver change in this
  release), applies CREATE-before-DROP so uniqueness is never unenforced in
  between, drops the legacy index only once the replacement is confirmed present,
  preserves every row, and converges to no drift.

  Two columns are worth an operator's attention:

  - `sys_notification_preference`'s replacement index name is **hash-suffixed** —
    `uniq_sys_notification_preference_a22d7d27` — because the natural name is 70
    characters and the limit is 60. That is expected, not corruption.
  - Rows with no `organization_id` (platform/seed rows) stay unique **among
    themselves**: the organization key part is NULL-safe
    (`COALESCE(organization_id, '__global__')`, ADR-0120 D3), so seeding by name
    keeps working and a tenant may hold its own row of the same name.

  ## Not breaking

  A relaxation admits key pairs that were previously refused and refuses nothing
  that previously succeeded, so no caller that worked before fails now. Every read
  path for these five objects goes through the tenant-scoped data API, so no
  consumer resolves one of these names across organizations expecting at most one
  row. Shipped as `patch` for that reason — the same call #8556 made for the same
  shape.

  Published text carrying the bare uniqueness claim was corrected at its source and
  the generated reference pages regenerated (`security/permission.mdx`,
  `automation/webhook.mdx`, and `integration/connector.mdx`, which embeds the same
  webhook schema), together with the `sys_permission_set` field description, its
  clone-dialog help text, the `sys_webhook` field description, and the matching
  translation bundles in all four shipped locales.

- d71ff32: fix(platform-objects,plugin-security,driver-sql): `sys_user_preference` and `sys_capability` uniqueness is per organization (#8323)

  Both objects declared their uniqueness as a table-level index with bare
  `unique: true`. At the DECLARED-index level that is the positional spelling of
  `'global'` — the listed columns verbatim — so on a tenant-scoped object it
  materialized an **installation-wide** unique index. (Field-level `unique: true`
  means the opposite, per-organization, and has since #3696; `packages/lint` names
  that divergence "the #4986 trap" and warns on it via
  `unique/unscoped-declared-index`.) Measured on a deployment running
  `OS_TENANCY_POSTURE=isolated`:

  - **A user in two organizations could never persist a preference key they had
    already used in the first one.** `sys_user_preference`'s `(user_id, key)` was
    installation-wide, so the second organization's write was refused by a row the
    caller cannot read — and `data-objectstack`'s `userState.save()` swallows the
    failure by design, so "recent items" and similar preferences silently stopped
    persisting in a user's second workspace, with no error anywhere.
  - **`sys_capability.name` refusals were an existence oracle across tenants.** An
    organization could POST a name and read `409` vs `201` to learn whether some
    other organization — or the platform seed — already held it, while its own
    `GET` on that name returned zero rows.

  Both declarations now say `unique: 'organization'` (ADR-0120 D1), materializing
  `(COALESCE(organization_id,'__global__'), …)`. Platform-seeded rows carry no
  organization and the key part is NULL-safe (ADR-0120 D3), so they stay unique
  among themselves and `bootstrapSystemCapabilities`' upsert-by-name is unaffected.
  Same-organization duplicates are still refused — the constraint is scoped, not
  removed.

  The bare `unique: true` spelling itself is **unchanged**; whether it should be
  reinterpreted is #5082 (v18), and the publish-time authoring advisory is #8379.

  **Migration (`@objectstack/driver-sql`).** Respelling a declared index changes
  its generated name, which on a deployed database read as two unrelated findings:
  the composite missing (`create_index`, safe) and the old global index orphaned
  (`drop_index`, **destructive**). An operator applying only the safe half would
  have kept the global index — i.e. kept the defect — while the plan read as
  applied. The declared-index respelling now routes through the same
  `replace_unique_index` retirement the field-level `unique` migration has used
  since #3728: one finding, categorised `safe`, CREATE before DROP, and the legacy
  index dropped only once the replacement is confirmed present. Any two rows
  colliding on `(organization, …fields)` already collided on `(…fields)`, so the
  replacement can neither fail on existing data nor lose any.

  Operators upgrading a deployed database should run `os migrate plan` / `os
migrate apply` — no `--allow-destructive` is required. Until the retirement is
  applied the old index keeps enforcing, so the constraint is never unenforced at
  any point in the migration.

- 69a89ce: fix(plugin-security,plugin-sharing): the write path consults the View/Modify All Data bypass — one predicate for `security/explain` and `/data` (#4647)

  A **Modify All Data** holder, a `sharingModel: 'private'` object, and a record
  whose `owner_id` is NULL got two opposite answers for one
  (principal, record, operation) triple:

  ```
  POST /api/v1/security/explain  { object, operation: 'update', recordId }
    → allowed: true, layers[vama_bypass]: "View/Modify All Data bypass held
      via [admin_full_access] — ownership and sharing checks are skipped"
  PATCH /api/v1/data/crm_contract/<id>
    → 403 FORBIDDEN
  ```

  Filling `owner_id` in made the same PATCH succeed, so the write path really was
  running the record-level ownership check the bypass layer said had been skipped.
  `sys_attachment`'s `canEdit(parent)` gate agreed with the 403, not with explain.
  Ownerless rows are not exotic: a system-context seed writes them by design (the
  seed loader disables `owner_id` injection).

  **The write path was the side that was wrong.** Modify All Data means an admin
  edits any record regardless of ownership (the Salesforce reference frame this
  platform's `modifyAllRecords` already follows, #1883), so:

  - `SharingService.canEdit` / `canDelete` now consult the super-user write bypass
    **after** ownership and shares have failed, through the existing late-bound
    `ISecurityService.hasWriteBypass` probe. The `sys_attachment`
    `canEdit(parent)` gate and the sharing-rule management gate reach the same
    answer because they call the same function.
  - The bypass they consult and the one `security/explain` reports are now **one
    predicate** — `PermissionEvaluator.superuserBypassSets` — rather than two
    independent readings of the permission sets. A cross-path test pins the triple
    through both `explain` and the real write middleware chain and asserts they
    agree, for update, delete and the attachment gate.

  **The widening is exactly Modify-scoped.** `viewAllRecords` ("View All Data") is
  a read power and never grants write: explain's `vama_bypass` layer is now
  operation-aware, asking for the modify bit on a write and the view bit on a read,
  and a view-only holder is refused on both paths. The probe still fails **closed**
  — no `@objectstack/plugin-security`, a throwing probe, a principal-less or
  on-behalf-of context all degrade to owner-only.

  **Explain payload self-consistency.** For a record-grained request the top-level
  `allowed` and the `record` verdict no longer contradict each other on this
  triple: the row is `visible: true` with `decidedBy: 'vama_bypass'`, the
  `vama_bypass` layer carries its own per-record attribution, and the `sharing`
  layer credits the bypass instead of reporting "no ownership and no edit/full
  share grants write" next to `allowed: true`. Where the bypass is not what
  admitted the row (owner, or an admitting share) the previous `decidedBy` is
  unchanged. Note that for a principal with **no** bypass, an object-level
  `allowed: true` beside `record.visible: false` remains correct and intended —
  `allowed` answers the object question, `record` answers the row question, and it
  is the `record` verdict that the write path mirrors.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [098f4bb]
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
- Updated dependencies [c44dd5e]
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
- Updated dependencies [52200b4]
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
- Updated dependencies [5fa04fb]
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
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
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
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [b230e5e]
- Updated dependencies [5d24f4b]
- Updated dependencies [29b94ed]
- Updated dependencies [07c68b0]
- Updated dependencies [f6cd635]
- Updated dependencies [2e836de]
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
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e9b5265]
- Updated dependencies [e650d67]
- Updated dependencies [121852d]
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
- Updated dependencies [0f17114]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [db0d53c]
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
- Updated dependencies [f586f1a]
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
- Updated dependencies [d5e9f6e]
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
- Updated dependencies [cafec0a]
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
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
- Updated dependencies [c7e7900]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
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
- Updated dependencies [524151c]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [d1cabaa]
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
- Updated dependencies [3670cf9]
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
- Updated dependencies [e98fb14]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [1b9a53b]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [6965160]
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
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [59c544d]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [7372d46]
- Updated dependencies [5e247fd]
- Updated dependencies [d56012f]
- Updated dependencies [1a53a02]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [a954634]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [c5adfe1]
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
- Updated dependencies [e7a7506]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [fda61e4]
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
- Updated dependencies [4921a95]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
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
- Updated dependencies [cc2de0e]
- Updated dependencies [97b6658]
- Updated dependencies [28d1eb7]
- Updated dependencies [06770c0]
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
- Updated dependencies [db48ad5]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [65f184b]
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
- Updated dependencies [bf1edef]
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
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
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
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [3f296bf]
- Updated dependencies [e474853]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [569611f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
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
- Updated dependencies [e787608]
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
- Updated dependencies [ee264b2]
- Updated dependencies [60b672e]
- Updated dependencies [f104bab]
- Updated dependencies [68dea0b]
- Updated dependencies [6b441a8]
- Updated dependencies [64f8cbe]
- Updated dependencies [6cb81c7]
- Updated dependencies [61282f9]
- Updated dependencies [c073b8c]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [3a2dde7]
- Updated dependencies [8c20f75]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [078e28b]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [d71ff32]
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
- Updated dependencies [9aa5510]
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
- Updated dependencies [4965bfa]
- Updated dependencies [8b50cb3]
- Updated dependencies [a0fdc56]
- Updated dependencies [946a131]
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
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
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
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/platform-objects@17.0.0
  - @objectstack/metadata-core@17.0.0
  - @objectstack/formula@17.0.0

## 17.0.0-rc.6

### Major Changes

- 9e9445b: <!-- adr-0087: not-required (no-migration-prescription) what this change removes is a VALUE in one platform-seeded sys_permission_set row, not an authorable key. No spec schema key is retired: object_permissions['*'] stays fully authorable, and admin_full_access / organization_admin / viewer_readonly still ship one. Nothing an app authored becomes invalid, nothing stored fails to parse, and the seeded row itself is rewritten by the boot seeder, so there is no stored shape for `objectstack migrate meta` to rewrite and nothing for the ledger to carry. The Migration section below prescribes a DEPLOYMENT action -- declare the object access you were relying on -- not a consumer code or metadata rewrite. -->

  fix(plugin-security)!: `member_default` no longer grants a `*` wildcard — the platform baseline is explicit-allow (#5491)

  **This is a deliberate, breaking narrowing of the default security posture.
  Deployments that relied on the implicit wildcard lose that access. That is the
  intended behaviour change, not a side effect — read the migration below before
  upgrading.**

  `member_default` is the additive `everyone` baseline: it resolves for **every**
  authenticated member, in addition to whatever else they hold. It carried
  `object_permissions["*"] = {allowCreate: true, allowRead: true, allowEdit: true,
allowDelete: false}`, and object permissions merge most-permissively — so that
  entry was not a default, it was a **floor no application could get under**. An
  app's explicit-allow object gate was erased on three of the four axes; only
  delete stayed profile-driven, because the baseline never granted it.

  HotCRM's 17.0 GA sweep measured the consequence across 5 profiles × 17 objects
  (188 probes, each user with their own bearer token):

  - **21 of 21 create-DENIAL probes returned `201`** — every profile created on
    every object once validation passed, including objects the profile explicitly
    denied;
  - a `service_agent` profile that declares no edit anywhere edited its own
    `crm_account`;
  - on `public_read` objects the wildcard yielded **`200` with ALL rows** for
    non-holders — real unauthorized reads, not the documented "200 with 0 rows"
    empty-set pattern;
  - `security/explain` stated it outright for a profile carrying an all-false
    deny: _"create on 'crm_opportunity' is granted by [member_default]"_.

  Because app-side authorization suites validate the app's _declarations_, CI
  stayed green while the runtime posture was default-open — `declared ≠ enforced`
  inside the security layer itself.

  **The change.** The wildcard is removed on all three live axes. The platform
  baseline narrows to explicit-allow: object access now comes from OWDs plus
  profile / permission-set **declarations** only. Deny-precedence merge semantics
  were considered and rejected — permission sets remain additive capability
  containers (ADR-0090); the fix is to stop the platform shipping a grant nobody
  asked for, not to invent a veto.

  What `member_default` still declares, it still enforces, and nothing here is
  newly granted: read on the better-auth identity tables (their writes stay
  denied — that door is better-auth), self-service on `sys_user_preference` (now
  an explicit entry rather than an implicit one; the effective access for a member
  is byte-identical, and its `sys_user_preference_self` RLS carve-out already
  declared exactly that intent), and every row-level policy it shipped before —
  `owner_only_writes`, `owner_only_deletes` and the identity `_self` carve-outs
  are untouched. The set stays anchor-safe, so its `everyone` binding is
  unaffected. `admin_full_access`, `organization_admin` and `viewer_readonly` keep
  their wildcards: those are granted deliberately to a principal, which is exactly
  what the baseline was not.

  ## Migration

  After upgrading, a member holding **no** application profile has no access to
  application objects. Restore access by declaring it, in one of two places:

  1. **Ship an app default profile.** Mark a permission set `isDefault: true` and
     the CLI wires it as the additive per-request baseline (ADR-0056 D7 /
     ADR-0090 D5). This is the recommended route and what the bundled showcase app
     already does — list the objects members legitimately touch, with the axes
     they need.
  2. **Grant per position / per user.** Bind an ordinary permission set through
     `sys_position_permission_set` or `sys_user_permission_set`.

  To find what a deployment was silently relying on, ask
  `GET /api/v1/security/explain?object=<name>&operation=<op>` for a
  representative member before upgrading: any answer attributing the grant to
  `[member_default]` on an application object is access that will stop. An app
  whose own profiles already declare everything its users do is unaffected.

### Minor Changes

- 04c56aa: security: add a fail-closed authored-row-write verdict to `ISecurityService`

  `ISecurityService` gains an optional, verdict-shaped, by-id method:

  ```ts
  checkAuthoredRowWrite?(
    object: string,
    recordId: string,
    operation: AuthoredRowWriteOperation, // 'update' | 'delete'
    context?: SecurityContext,
  ): Promise< AuthoredRowWriteVerdict >;  // 'admit' | 'abstain'
  ```

  It answers one question no existing surface could: does an **app-authored**
  row-level security policy admit this row for this write, on its own, with the
  platform's ownership floor taken out by provenance?

  Every other method reports the **composed** RLS verdict, and sitting inside that
  composition is the platform's own wildcard write floor (`created_by ==
current_user.id`, shipped on the `member_default` baseline every authenticated
  member resolves additively). So "the composed RLS admits this row" is true for
  the row's CREATOR whether or not any app policy mentions it — which makes it a
  measurably different question, not a cheaper spelling of the same one. A caller
  deferring to the composed answer would hand transferred records back to their
  former creators.

  `admit` iff at least one applicable, non-floor policy matches the row for the
  operation. `abstain` in every other case — no authored policy, no match, an
  unreadable or cross-tenant row, a principal-less or on-behalf-of context, or any
  internal failure. The method never throws outward, and it is **optional**: a
  deployment whose security service omits it behaves byte-for-byte as before,
  because callers feature-detect and read absence as `abstain`.

  `@objectstack/plugin-security` implements it on the registered `security`
  service, reading the verdict off the same layered RLS computation the middleware
  enforces with — no second RLS evaluator.

- 6029cc1: Explain and enforcement now resolve ONE authorization aggregation (#6352).

  `buildContextForUser()` — the explain API's reconstruction of an arbitrary user's
  context, behind `explain(request, callerContext)` and the `userId` parameter — was
  a hand-written second implementation of `@objectstack/core`'s `resolveAuthzContext`
  aggregation. Its agreement with enforcement was guaranteed by two comments saying
  it mirrored the resolver ("mirroring the runtime resolver's semantics", "we compute
  it here with the IDENTICAL rule") and by nothing else: no assertion anywhere in the
  repo compared the two.

  It did not agree. Measured over identical rows, the mirror dropped:

  | input                                                          | resolver       | explain mirror |
  | -------------------------------------------------------------- | -------------- | -------------- |
  | `sys_member` role positions (ADR-0095 D3)                      | `org_admin`, … | —              |
  | position-bound permission sets (`sys_position_permission_set`) | resolved       | —              |
  | the `everyone` anchor's bound sets (ADR-0090 D5)               | resolved       | —              |
  | `platform_admin` position projection (ADR-0068 D2)             | projected      | —              |
  | `systemPermissions` / `posture` / `email` / `ai_seat`          | resolved       | —              |

  The user-visible consequence: permission sets are resolved BY NAME from
  `context.positions ∪ context.permissions`, and a set carried by a POSITION only
  becomes a name inside the resolver. So for any user whose grants arrive through a
  position — the ordinary way an org grants access — the explain panel resolved fewer
  sets than enforcement and reported a denial the runtime never made. A security UI
  that says "you have no access" about access you have is worse than no panel.

  `buildContextForUser` now calls `resolveUserAuthzGrants` (core's userId-driven
  resolver core, already the same entry point `runAs:'user'` automation runs use) and
  adds presentation only: the ADR-0091 expired-grant and `delegated_from` annotations
  the resolver correctly discards, and `hasPlatformAdminGrant`, which is now read
  back off the resolver's own posture verdict instead of recomputed. The returned
  context additionally carries `systemPermissions`, `org_user_ids`, `posture`,
  `tabPermissions` and `email` — additive; no field was removed or renamed.

  Pinned by a parity suite that runs both implementations over the same fixture rows
  (org role projection, position-bound sets, the `everyone` anchor, both
  `platform_admin` polarities, `organization_admin` → `TENANT_ADMIN`, ADR-0091
  windows) and asserts each case's concrete expected output, so the pin cannot pass
  by both sides resolving to nothing. Restoring the mirror turns 9 of those cases
  red.

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

- 9e9445b: fix(plugin-security): the row-level write gate honours `modifyAllRecords` and `edit`-level record shares (#5492)

  HotCRM's 17.0 GA acceptance sweep measured two declared write-widening
  mechanisms as completely inert. A manager profile carrying `viewAllRecords` +
  `modifyAllRecords` got `403 … (row-level security)` on **every** cross-owner
  write — update and delete, four objects — while its reads widened exactly as
  declared (43/43, 9/9). And all three `edit`-level sharing rules materialised
  into `sys_record_share` correctly and widened reads exactly, yet a `PATCH` by
  the share target was refused every time. Read-level shares correctly denied
  writes, so the machinery distinguished the levels on paper and the write gate
  then ignored the distinction.

  **One root cause.** Row-level write access was two authorities AND-ed together
  with no knowledge of each other. `ISharingService` reads all three declared
  wideners (ownership at write DEPTH, `sys_record_share.access_level`, the
  `modifyAllRecords` bypass); the security plugin's by-id write pre-image gate
  read only RLS — and sitting inside that RLS is the platform's own ownership
  floor, `owner_only_writes` / `owner_only_deletes` (`created_by ==
current_user.id`, applicability `positions: ['org_member']`). That floor is a
  second implementation of "ownership", and it is the one blind to every widener.
  Every member resolves it additively from the `member_default` baseline — a
  manager is an org member too — so the widener-blind copy always won.

  **The fix is composition by provenance, not a new bypass.** The pre-image gate
  now asks the authority that owns those mechanisms for its tri-state verdict
  (`ISharingService.checkEdit` / `checkDelete`, the contract added in #6428):

  - `allow` — a positive basis exists, so the declared authority **replaces** the
    platform floor;
  - `abstain` — record sharing does not enforce on this row at all (a `public`
    object, an object with no owner field, a platform internal), so the floor
    **stays**: it is the only row-level write gate such rows have;
  - `deny` — the floor stays; the refusal belongs to the sharing middleware that
    produced the verdict.

  The action boundary is inherited rather than restated (ADR-0111 D3): update asks
  `checkEdit`, delete asks `checkDelete`, so an `edit` share widens update and
  still does not confer delete. `modifyAllRecords` covers both verbs
  (`MODIFY_ALL_WRITE_KEYS`).

  **What is deliberately unchanged.** Layer 0's tenant wall and every
  **app-authored** RLS policy are untouched — only the policies the platform
  itself ships are replaceable, matched by the same `(object, name, using)`
  provenance key ADR-0105 D3 uses for tenant policies, so an app policy spelling
  the identical predicate keeps refusing (ADR-0049: a declared security property
  stays declared). This is therefore not `modifyAllRecords` bypassing write-side
  RLS on an ordinary business posture, which ADR-0066 ① withholds and this change
  leaves withheld; it is the platform's floor deferring to the platform's own
  ownership authority. The on-behalf-of (ADR-0090 D10) path keeps both principals'
  floors, matching `hasWriteBypass`, which already fails closed for a delegated
  context. A deployment without `@objectstack/plugin-sharing` sees no change at
  all: with nothing to consult, the gate abstains and the floor decides.

  Net effect for deployments: a Modify All Data holder can now correct, reassign
  and clean up records they did not create, and an `edit`-share recipient can
  finally edit the record shared with them. Nothing that was refused for lack of a
  grant becomes permitted — read-share targets are still denied writes, `edit`
  shares still cannot delete, and a member with neither is still refused.

- d19fb5c: fix(verify,plugin-security,cli): `bootStack` honours the app-declared default permission set, like `serve` always did (#7001)

  Two boot paths disagreed about whether an application's declared default
  permission profile exists.

  - **`objectstack serve` honoured it** — it read the permission set marked
    `isDefault: true` off `config.permissions` and passed the name as the
    `SecurityPlugin` `fallbackPermissionSet`.
  - **`bootStack` did not** — `@objectstack/verify` constructed a vanilla
    `new SecurityPlugin()` and never read `config.permissions` at all.

  So the profile an app declares was in force when a human ran the CLI and
  silently absent when the app's own suite booted it: a `declared ≠ enforced`
  split inside the harness that exists to catch that split. Green tests,
  different production behaviour.

  It was invisible until #5491. Until then the platform's `member_default`
  carried an `object_permissions['*']` wildcard, so a member with no application
  profile reached every object anyway and the declared fallback was never
  load-bearing. #5491 removed that floor deliberately and its Migration section
  prescribes exactly one consumer action — ship an app default profile via
  `isDefault: true` — which `bootStack` had no way to express. Measured in
  cloud's `ee-group-showcase`, adding the prescribed profile changed nothing: the
  same acceptance cases still failed at the object gate.

  **What changed.** The resolution now lives in one place and both boot paths call
  it: `appSecurityPluginOptions(config)`, new in `@objectstack/plugin-security`
  next to the existing `appDefaultPermissionSetName`. It answers the question a
  booter actually has — _what do I hand the `SecurityPlugin` constructor for this
  config_ — rather than just the name, because the second half
  (`name ? { fallbackPermissionSet: name } : undefined`) is a decision, not
  formatting, and while `serve.ts` had open-coded it, `bootStack` had simply never
  grown one. `serve.ts` is converged onto the same helper, so the two now agree by
  construction rather than by each caller remembering.

  **Behavioural change, `@objectstack/verify` only.** `bootStack(config)` on an
  app that declares an `isDefault` permission set now boots with that profile as
  the additive per-request baseline (ADR-0090 D5), matching `objectstack dev`. An
  app that declares no such set is unaffected — the resolution yields `undefined`
  and the plugin keeps deriving `member_default` from its built-in sets, exactly
  as before.

  A suite that deliberately wants the platform's own baseline over an app that
  declares a default now says so: `bootStack(config, { security: new SecurityPlugin() })`.
  A plugin passed in `opts.security` still wins whole and is never merged into —
  it arrives carrying its own constructor options, and silently rewriting one of
  them would be a worse surprise than the bug being fixed.

  Measured blast radius across the framework's own suites: of 86 dogfood files and
  524 tests, exactly one assertion moved — `me-apps-and-everyone-baseline`, which
  asserts the bootstrap binds `member_default` to the `everyone` anchor and whose
  header already read "Deliberately VANILLA". That dependence was real but silent,
  expressed only by the harness default; it is now stated in the argument. The
  showcase fixtures that needed the app profile were already hand-wiring a
  `SecurityPlugin` for it (`test/showcase-security.ts`, added by #5491) — the
  "custom security code" these dogfood apps exist to prove unnecessary — and are
  unchanged by this release.

### Patch Changes

- 63f3b87: ADR-0094 D5-R: retire the "customize packaged permission sets through an ADR-0005 env
  overlay" direction (2026-07-14), and make the ADR text and the
  `permission-set-projection.ts` header agree with what is enforced.

  `#6483` (PR #6608) rolled `permission` back to `allowOrgOverride: false`, so a metadata
  write against a **code-declared (artifact-backed)** permission set is refused with 403
  `NOT_OVERRIDABLE` — ADR-0005's security row ("overlays would create silent privilege
  drift") is enforced again. The supported channel for those sets is the one ADR-0086
  always named: edit the package and re-publish. Environment authoring survives on the
  `allowRuntimeCreate` tier, for sets whose definition lives only in `sys_metadata`
  (data-door creations, and package sets authored + published through the metadata door);
  that tier edits the single stored definition in place and is deliberately **not**
  described as a re-route of the retired overlay channel.

  No behaviour change: the four production write points keep their current dispositions.
  The refusal is left to the producer — `plugin-security` does not re-derive
  artifact-backing to pre-empt it — and the two write points that catch a failed metadata
  write (the `restore` leg and the boot backfill) keep reporting on the durability channel.
  What changes is prose, plus test coverage that can now see the gate: the suite's protocol
  stub models ADR-0005's tier gate, so the four cases that pinned the retired direction no
  longer pass for want of a stub that could refuse.

- 73f69dc: fix(plugin-security): `checkAuthoredRowWrite` answers the declaration, not the caller's read scope (#7281)

  `ISecurityService.checkAuthoredRowWrite` asks one question — _does an
  app-authored row-level widener admit this row for this write?_ — and it resolved
  that question by re-reading the row through the **caller's own** execution
  context. That `findOne` re-enters the middleware chain, so `plugin-sharing`'s
  READ filter applied: on a `private`-OWD object a cross-owner row is invisible to
  the caller, the read answered null, and the verdict was `abstain` for a row the
  declaration names by predicate.

  Measured on the real stack across two objects identical in every respect except
  their OWD — same widener text, same principal, same cross-owner row shape:

  | OWD           | verdict before | verdict after |
  | ------------- | -------------- | ------------- |
  | `public_read` | `admit`        | `admit`       |
  | `private`     | **`abstain`**  | **`admit`**   |

  So the by-id widener surface was live on read-open objects and stood down on
  read-closed ones, discriminated by a property the widener's author never
  mentions — and `private` is the posture #5493 built that surface for. The
  maintainer ruled it a defect (2026-08-10): the verdict is about the row and the
  policy, not about what the caller may see. The probe read now resolves under an
  elevated, principal-less scope.

  **This does not widen anything.** The predicate carries the whole of the
  question and travels in the query rather than in the scope: `{id} AND
layer0(tenant wall) AND layer1(app-authored policies)`, both layers still
  compiled from the caller's own permission sets and tenant before the read, and
  the read is projected to `id` so the probe can only ever learn _that_ a row
  matches. A row in another tenant, a row no authored policy matches, and a caller
  holding no authored policy at all all still answer `abstain` — pinned, including
  by mutation: delete the tenant layer from the predicate and the cross-tenant case
  goes red. `admit` also remains evidence and never authorization: the by-id write
  pre-image gate still resolves the write under the caller's own context and
  refuses on its own terms.

  One consequence is stated plainly rather than papered over: because that
  pre-image gate performs the same caller-scoped read, a `private`-OWD cross-owner
  by-id write is **still refused end-to-end** after this change — now by the
  row-level gate (`PERMISSION_DENIED`, "…(row-level security)") rather than by the
  sharing middleware's `FORBIDDEN`. Whether a write should reach a row the caller
  cannot read is a separate contract question about that gate's read scope, and it
  is not settled here. Both behaviours are pinned on the real stack.

  The `@objectstack/spec` half is documentation only: `ISecurityService`'s contract
  listed "the row is unreadable" among the `abstain` cases, which is exactly the
  conflation the ruling removed. No signature, shape or vocabulary changes, and the
  method stays optional and fail-closed.

- f3e26b7: docs(plugin-security,skills): re-premise `member_default`'s removed wildcard in the published customer skill and in the plugin's own README (#7151)

  Two shipped documents still described a permission-set shape the platform has not
  had for two releases. Both premises were re-measured against the real imported
  `defaultPermissionSets` at this branch point, and both had expired:

  - `member_default.objects['*']` is `undefined` — the plain `'*'` object grant was
    removed when the platform baseline narrowed to explicit-allow.
  - Neither `member_default` nor `viewer_readonly` carries a `tenant_isolation`
    entry in `rowLevelSecurity`, and neither carries any wildcard tenant policy at
    all. Tenant isolation is **Layer 0** (`tenant-layer.ts`) since ADR-0095 D1.

  **`packages/plugins/plugin-security/README.md`** described the pre-ADR-0095
  probe-and-strip mechanism as the plugin's own current behaviour ("Service present
  → keeps the wildcard `tenant_isolation` RLS policy … shipped with the default
  `member_default` / `viewer_readonly` permission sets"). Rewritten to the real
  mechanism: the plugin resolves a tenancy **posture** at start time; the tenant
  wall is Layer 0, AND-composed ahead of business RLS and inert under `single`; and
  the strip that survives targets the platform's own tenant-scoped policies **by
  provenance** (`organization_admin`'s `sys_member_org` / `sys_invitation_org` /
  `sys_team_org`, the `sys_organization_self` carve-out), never an app-authored
  policy — which reaches the compiler and fails closed there (ADR-0105 D3).

  **`skills/objectstack-data/SKILL.md`** (published customer guidance) did not
  merely mention the wildcard — its ⚠️ callout built a recommendation on a leak
  that cannot happen. The recommended recipe
  (`tenancy: { enabled: false }` + `requiredPermissions`) is unchanged and still
  correct, but every stated reason for it was rewritten to the measured one:

  - the empty-list symptom is the Layer 0 tenant wall denying rows whose
    `organization_id` is null or absent, not a `member_default` RLS policy;
  - `viewAllRecords` short-circuits business RLS only and never crosses the wall —
    that takes a true platform admin (the superuser bit **and** a
    platform-exclusive capability) on a posture that permits it;
  - the ⚠️ now names the surviving hazard truthfully. `tenancy: { enabled: false }`
    alone switches the wall off for every caller, and the risk is any permission
    set with a wildcard read grant — the shipped `viewer_readonly` still has one —
    not `member_default`, which grants only the objects it names.

  No runtime behaviour changes; documentation only.

- 4c31321: Docs: bring the second ADR-0094 copy in `permission-set-projection.ts` up to D5-R.

  PR #6962 retired the 2026-07-14 "customize packaged permission sets through an ADR-0005
  env overlay" direction and corrected this file's **header**. A second copy survived in
  the function-level JSDoc of `upsertEnvPermissionSet` — an exported symbol, so the stale
  text ships in the published `.d.ts` and reads as fact to the next author. It stated both
  halves D5-R retired: that an env-scope overlay is the platform's standard customization
  of a packaged definition, and that deleting the overlay resets the row to the shipped
  declaration.

  Both are now stated as current: `#6483` (PR #6608) rolled `permission` back to
  `allowOrgOverride: false`, so a metadata write against a code-declared (artifact-backed)
  set is refused by the producer with 403 `NOT_OVERRIDABLE` and the supported channel is
  ADR-0086's (edit the package, re-publish); and `#6960` measures the ordinary delete path
  refusing to lift even a legacy pre-rollback overlay, leaving `OS_METADATA_WRITABLE` as
  the only documented removal — so "delete = reset" is recorded as retired rather than
  restated. The retirement itself is kept in the text, not deleted, so a reader arriving
  at this function does not have to reconstruct the history.

  Prose only — no behaviour change. The same retired direction was also corrected in three
  neighbouring comments in this package (the `readDeclaredBody` JSDoc, and the two
  `security-plugin.ts` package-managed write-gate comments) plus their two test rationales,
  so the package no longer states the direction in two voices.

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
- Updated dependencies [5fa04fb]
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
- Updated dependencies [b230e5e]
- Updated dependencies [5d24f4b]
- Updated dependencies [29b94ed]
- Updated dependencies [07c68b0]
- Updated dependencies [f6cd635]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e9b5265]
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
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [d5e9f6e]
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
- Updated dependencies [cafec0a]
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
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [6965160]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [59c544d]
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
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
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
- Updated dependencies [d42a92f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [61282f9]
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
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/formula@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/formula@17.0.0-rc.5
  - @objectstack/platform-objects@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- 846ed1f: fix(security): `controlled_by_parent` 现在真的跟随主档访问 —— 折入主档的归属与共享授权 (#5386)

  **这是一次安全收紧。** 升级后,此前被越权看到 / 写到的明细行会读不到、写不了 —— 那正是
  声明本来就要求的边界。

  ADR-0055 的 `controlled_by_parent` 对作者的承诺是「子记录跟随父记录的访问」。实现只兑现了
  一半:派生用的主档 id 集来自 `computeRlsFilter(master, 'find')`,即只有 Layer 0(租户)与
  Layer 1(`rowLevelSecurity` 策略)。归属(owner scope)与 `sys_record_share` 授权由**另一个
  插件** `plugin-sharing` 的 `buildReadFilter` 贡献,而它对「有效共享模型不是 `private`」的对象
  返回 `null` —— `controlled_by_parent` 在那边恰好映射为 `public`。于是记录级访问的两半在派生
  对象上从未相遇。

  后果比文档里那句「sharing grants 未折入」读起来严重得多:

  - 主档上**没有写任何 `rowLevelSecurity`** 的应用,得到的是一个**不受限的主档 id 集**,派生
    过滤器等于什么都没收窄 —— 只要持有对象级 read,全部明细行可读。行项目类对象(报价行、
    发票行)是这个形状的常客,而它们携带逐行定价与折扣。
  - 在主档上补写 RLS 也不是绕法:RLS 与 sharing 过滤器是 **AND**,补写会连同被共享进来的行
    一起切掉。
  - 写这半有同样的洞,而且是从另一侧来的:`assertControlledByParentWrite` 只在主档的写 RLS
    编译出非空过滤器时才检查主档行,主档没写 RLS 时**整段跳过** —— 持有 `allowEdit` 的调用者
    可以改自己根本看不到的父记录下的明细。

  **修复**:主档可达性改走与「直接读 / 直接写主档」完全相同的路径,复用既有合成点,不在
  plugin-security 里重刻一份 sharing 语义。

  - 读:`computeControlledByParentFilter` 现在把主档的读 RLS 与 `resolveSharingReadFilter`
    (`getReadFilter` 已经在用的那个 OWD/共享半边)AND 起来再解析主档 id 集。哪一半生效由
    **主档自己的有效共享模型**决定,因此派生出的可见集与直接 find 主档逐点一致。
  - 写:`assertControlledByParentWrite` 在原有的 CRUD `update` + 写 RLS 之外,**无条件**追问
    plugin-sharing 的单记录写闸 `canEdit`(归属按写深度放宽、`edit` 级共享、
    `modifyAllRecords` 旁路)—— 无条件,正因为写 RLS 那一半在常见情形下会被整段跳过。
  - 两侧解析失败一律**fail closed**(主档 id 集为空 / 拒绝写),而不是悄悄放宽回全员可见。

  未变更的部分:v1 的**单层**语义 —— 主档自身的 `controlled_by_parent` 仍不递归下钻;没有装
  `plugin-sharing` 的部署行为不变(那种部署里主档本身也没有归属与共享可言,派生集依旧与直接
  读主档相等);`read` 级共享仍然只开读不开写,与直接访问主档的逐动词答案一致。

- 9ce0ca9: **An admin-authored capability's `label`/`description` survive the boot (#5876).**

  `bootstrapSystemCapabilities` seeds `sys_capability` in two halves: the CURATED
  platform capabilities, and the back-compat DERIVED defaults — one row per
  capability string a bootstrap permission set grants via `systemPermissions[]`
  that nothing declared. Its seed loop refreshed `label`/`description` on whatever
  row it found for a name, without looking at `managed_by`, while the comment
  directly above it claimed the opposite ("do NOT clobber admin edits"). What
  #2909 T3 actually made seed-once is `scope`, and only `scope`.

  For a derived name there is no authored copy to reconcile: `label` is
  `humanize(name)` and `description` is `Capability <name>.`, both generated from
  the granted string. So an existing row's authored display fields were rewritten
  to a humanized placeholder on **every boot**, whoever wrote them — silent data
  loss, invisible from the outside.

  Reachable, narrowly, and it needs the admin row to pre-exist the grant: an admin
  creates capability `X` in Setup (`managed_by:'admin'` — the only provenance the
  ADR-0066 write-guard leaves admin-writable), an app whose bootstrap permission
  set grants `X` is installed, and every boot from then on renames it. The reverse
  order is not reachable: once the derivation has created the
  `managed_by:'platform'` placeholder, the write-guard stops the admin editing it
  at all.

  **The derived half now reconciles display fields only on rows it owns** —
  `managed_by:'platform'` on a non-curated name, which can only be its own
  placeholder from an earlier boot. `admin` rows, `package` rows and rows whose
  provenance is missing are left exactly as their author wrote them, and counted
  in the new `skippedAuthored` field of the seeding result (reported in the boot
  summary, not warned about: nothing is degraded, the capability resolves and the
  authored copy is the better one).

  **The curated half is unchanged.** Those definitions are authored by the
  platform and a new version legitimately ships new copy, so a curated name still
  refreshes the row it finds. `scope` stays seed-once on both halves.

  No migration and no authoring change: a placeholder that was already
  overwritten is not restored (the previous text is gone), but it stops being
  overwritten again, and an admin's re-edit now sticks.

- d97f2a2: fix(plugin-security): `getReadFilter` applies the `controlled_by_parent` derivation — the analytics read scope was missing the master half entirely

  `getReadFilter` is the read-scope provider bound by the analytics / raw-SQL
  path: the one read surface that bypasses the engine and therefore has no other
  source of scope. Its contract is that it returns **the same filter the engine
  middleware ANDs into every find**. That middleware injects three things — the
  RLS filter, the ADR-0055 `controlled_by_parent` derivation (`masterFK IN
(accessible master ids)`), and plugin-sharing's OWD / record-share filter.
  `getReadFilter` composed only the first and third; `computeControlledByParentFilter`
  was never called on that path at all.

  For an object whose `sharingModel` is `controlled_by_parent` that is not a
  partial gap but a total one, because the two layers it _did_ compose both stand
  down on exactly that object by design: such an object carries no authored RLS
  (the whole point of the model is that access is derived rather than authored),
  and it maps to `public` in plugin-sharing's `effectiveSharingModel`, so
  `buildReadFilter` returns `null`. Both halves returned `null`, the composition
  returned `undefined`, and the analytics path ran with **no predicate**. A caller
  who could not read a single master row through `/data` could still `COUNT(*)`
  and `GROUP BY` its detail rows through `/analytics` — and line-item objects are
  the usual shape here, so the grouped values are per-line prices and discounts.

  The derivation is now composed into the same AND on that path, resolved from the
  permission sets `getReadFilter` had already resolved (no second resolution), so
  the two read surfaces enforce identical scoping — which is why
  `computeControlledByParentFilter` was extracted and shared in the first place.
  Failures deny: the derivation is internally fail-closed, and a throw propagates
  to the method's existing fail-closed handler rather than widening the read. The
  delegated (`onBehalfOf`) branch already denied outright on this path (#2852) and
  is unchanged.

  This is the same failure shape #4467 fixed for the OWD/sharing layer of this
  method, one layer over; #5386 fixed _which inputs_ the derivation folds in, not
  _whether it runs_ on this surface.

  **Impact.** A deployment with `controlled_by_parent` objects and an analytics /
  raw-SQL consumer will see those queries return fewer rows — the rows the caller
  was never entitled to aggregate. No authoring change is required.

- dc6abfd: fix(plugin-security): 被拒收的 capability 声明不再连派生占位一起压掉 (#4967 Part 1/3)

  `SecurityPlugin` 分两遍种 `sys_capability`:第一遍落包声明的 capability
  (`managed_by:'package'` + `package_id`),第二遍种平台 curated 集合 + 从
  permission set 的 `systemPermissions[]` **派生**的 back-compat 占位,并**跳过**
  第一遍报上来的名字,以免占位把已写好的声明覆盖掉。

  问题在于第一遍报的是「读到的每个名字」,而不是「真正落了行的名字」:
  `bootstrapDeclaredCapabilities` 在 upsert 作出任何决定**之前**就把
  `cap.name` 推进了返回列表。而 upsert 有三条**拒收**路径,一行都不写。其中
  「声明没有归属包」这一条既没写行、又占住了名字,于是派生占位也被跳过——
  capability **在任何一行里都不存在**。净效果是:**写下这条声明,比不写还糟**
  (不写至少还有派生占位)。这正是 showcase 的
  `showcase.export_data` 只留下一条 `warn` 的成因。

  修法是把「上报」与「读到」拆开:一个名字进入上报列表(现更名为
  `materializedNames`)的条件,是本遍**确认它有行**——本遍写成了
  (seeded / updated / claimed),或找到一行不能被覆盖的既有行(admin 自建、他包
  所有、curated 平台名)。三条拒收路径按「派生是否会覆盖既有 authored 行」分别
  处置,理由写在代码里:

  - **curated 平台名**:仍然上报。curated 那一遍无条件种这些名字,行必然存在;
    且派生路径本来就够不到 curated 名(它已在 curated 表里)。
  - **他包所有 / admin 自建**:仍然上报。行存在且 label/description 是**作者写
    的**,派生会把它们刷成 humanize 出来的占位——压掉派生正是这份列表的用途。
  - **没有归属包**:仅当已存在一行时才上报。没有行时回落到派生占位,和「从未
    写过这条声明」时一样。

  同时补上这条路径此前缺失的计数器 `skippedUnowned`,于是每条具名声明恰好落在
  一个计数器里,列表与计数器可以对账。

  **行为变化(升级须知)**:一条被拒收(无归属包)且被某个 permission set 授权
  的 capability,此前在 `sys_capability` 里**没有任何行**,现在会出现一行
  `managed_by:'platform'` 的派生占位——即它在 Setup 的能力列表里可见、可解析、
  带 humanize 出来的 label。注意这不改变**运行时判定**:权限求值一直是按
  `systemPermissions[]` 里的字符串取并集的,从不查 `sys_capability`;恢复的是
  注册表一侧的 declared = enforced(能力有定义记录、可见、可管理、有 provenance),
  不是把一个原本不生效的授权变成生效。若某个部署依赖「那条能力在能力列表里查不
  到」,升级后它会出现。

  诊断消息同时按 #4632 改进(级别仍为 `warn` —— 功能性降级,非持久性失败):
  拒收时点名**授权它的 permission set**,并写明真实后果,例如
  `[security] declared capability "showcase.export_data" has no owning package (granted by showcase_ops): falls back to the back-compat derived placeholder …`。
  无人授权、或已有行的情形各有对应措辞。

- bf1edef: feat(formula,lint): wire ADR-0056 D4's RLS authoring gate, from the runtime's own predicate (#4983)

  `isSupportedRlsExpression` has carried the same docblock since ADR-0056 D4:
  "exposed so an authoring-time gate (`objectstack compile`) can REJECT a
  predicate the runtime would silently drop … A `false` here means 'this
  predicate will never enforce'." It had **no non-test consumer anywhere** — the
  function written to fix declared-but-never-read was itself declared and never
  read. This lands the consumer, in two steps that had to happen in this order.

  **1. `sqlPredicateToCel` and `isSupportedRlsExpression` move FROM
  `@objectstack/plugin-security` (`src/rls-compiler.ts`) TO `@objectstack/formula`
  (`src/rls-predicate.ts`), and are exported from its root.** Executable code
  unchanged — a change of address, not of behaviour; `plugin-security` now imports
  them from `@objectstack/formula` and keeps no copy, so there is still exactly
  one definition. No import path outside the two packages changes: neither symbol
  was ever exported from `@objectstack/plugin-security`'s entry point. The move is
  what makes step 2 possible at all — `@objectstack/lint` may depend on
  `@objectstack/spec` and never on a runtime, so with the predicate living in a
  runtime the gate's only other door was copying the SQL→CEL bridge, whose
  boundary conditions (quoted literals are never rewritten; canonical CEL passes
  through unchanged) _are_ the gate's red/green line. A fork drifting by one
  character rejects policies the runtime executes correctly — the false-positive
  direction, which is worse than the gap. ADR-0058 D1 asks for a single canonical
  shape gate; the bridge is part of that gate.

  **2. New `@objectstack/lint` rule `validateRlsPredicateEnforceability`,
  `error`, on all three authoring commands**, over
  `permissions[].rowLevelSecurity[].using` and `.check`:

  - **`rls-predicate-unenforceable`** — parses as CEL, outside the pushdown
    subset: a function call (`size(...)`, `has(...)`), arithmetic, a ternary, a
    cross-object path (`record.account.region`).
  - **`rls-predicate-unparseable`** — does not parse as CEL even after the legacy
    SQL bridge (`=` → `==`, `IN` → `in`): SQL `AND` / `OR` / `LIKE`, a subquery.
    Its own id because the fix is different — write CEL (`&&`, `||`), not a
    different shape.

  What the gate prevents, measured through `plugin-security` rather than inferred:
  `RLSCompiler` drops the policy and logs one request-time WARN. On the read path,
  when it is the only applicable policy, `compileFilter` returns the
  `RLS_DENY_FILTER` sentinel instead, which is AND-ed onto the where clause — so
  every select / update / delete on the object matches **zero rows**. On the
  ADR-0058 D4 write path the post-image `check` becomes that same sentinel, which
  no record satisfies, so every insert / update fails with `PermissionDeniedError`.
  The runtime fails closed, which is why this was survivable: the result is not a
  hole but a policy that reads as an authorization and behaves as a blanket
  refusal, with nothing at authoring time pointing at the line that caused it.

  Fix a flagged predicate by rewriting it inside the lowerable subset — `==` `!=`
  `>` `<` `>=` `<=`, `in`, `&&` `||` `!`, `== null` / `!= null`, and
  `startsWith` / `endsWith` / `contains` over single-column field paths (ADR-0058
  D2), against a literal or a `current_user.*` value. Two specific migrations:
  `has(x)` / `size(x) > 0` → `x != null` (a function call is correct in an object
  _validation_ rule, which is interpreted, and wrong here, where the predicate is
  compiled to a filter); and a related record's field → denormalise it onto this
  object (formula/rollup) and test that column, since RLS cannot join (ADR-0055).

  Same construction as the sharing-rule gate (#4698): the rule does not model the
  consumer or grep for it — it calls `isSupportedRlsExpression`, the exact
  function `RLSCompiler.compileFilter` consults to decide whether a dropped policy
  earns its warning, so the two verdicts are one boolean by construction, pinned
  in both directions over a shared corpus. Measured before shipping: every RLS
  predicate declared anywhere in this repo — the `plugin-security` platform seeds,
  the examples, the dogfood fixtures, the authoring skill — is supported, so the
  gate turns nothing red that works today. Unlike the sharing-rule gate, CEL
  _syntax_ is reported here rather than deferred to `expression-invalid`:
  `validateStackExpressions` does not walk `rowLevelSecurity` at all, and could not
  judge this field correctly if it did, because `owner_id = current_user.id` is a
  CEL syntax error and a working RLS predicate at the same time.

- 69a89ce: fix(plugin-security,plugin-sharing): the write path consults the View/Modify All Data bypass — one predicate for `security/explain` and `/data` (#4647)

  A **Modify All Data** holder, a `sharingModel: 'private'` object, and a record
  whose `owner_id` is NULL got two opposite answers for one
  (principal, record, operation) triple:

  ```
  POST /api/v1/security/explain  { object, operation: 'update', recordId }
    → allowed: true, layers[vama_bypass]: "View/Modify All Data bypass held
      via [admin_full_access] — ownership and sharing checks are skipped"
  PATCH /api/v1/data/crm_contract/<id>
    → 403 FORBIDDEN
  ```

  Filling `owner_id` in made the same PATCH succeed, so the write path really was
  running the record-level ownership check the bypass layer said had been skipped.
  `sys_attachment`'s `canEdit(parent)` gate agreed with the 403, not with explain.
  Ownerless rows are not exotic: a system-context seed writes them by design (the
  seed loader disables `owner_id` injection).

  **The write path was the side that was wrong.** Modify All Data means an admin
  edits any record regardless of ownership (the Salesforce reference frame this
  platform's `modifyAllRecords` already follows, #1883), so:

  - `SharingService.canEdit` / `canDelete` now consult the super-user write bypass
    **after** ownership and shares have failed, through the existing late-bound
    `ISecurityService.hasWriteBypass` probe. The `sys_attachment`
    `canEdit(parent)` gate and the sharing-rule management gate reach the same
    answer because they call the same function.
  - The bypass they consult and the one `security/explain` reports are now **one
    predicate** — `PermissionEvaluator.superuserBypassSets` — rather than two
    independent readings of the permission sets. A cross-path test pins the triple
    through both `explain` and the real write middleware chain and asserts they
    agree, for update, delete and the attachment gate.

  **The widening is exactly Modify-scoped.** `viewAllRecords` ("View All Data") is
  a read power and never grants write: explain's `vama_bypass` layer is now
  operation-aware, asking for the modify bit on a write and the view bit on a read,
  and a view-only holder is refused on both paths. The probe still fails **closed**
  — no `@objectstack/plugin-security`, a throwing probe, a principal-less or
  on-behalf-of context all degrade to owner-only.

  **Explain payload self-consistency.** For a record-grained request the top-level
  `allowed` and the `record` verdict no longer contradict each other on this
  triple: the row is `visible: true` with `decidedBy: 'vama_bypass'`, the
  `vama_bypass` layer carries its own per-record attribution, and the `sharing`
  layer credits the bypass instead of reporting "no ownership and no edit/full
  share grants write" next to `allowed: true`. Where the bypass is not what
  admitted the row (owner, or an admitting share) the previous `decidedBy` is
  unchanged. Note that for a principal with **no** bypass, an object-level
  `allowed: true` beside `record.visible: false` remains correct and intended —
  `allowed` answers the object question, `record` answers the row question, and it
  is the `record` verdict that the write path mirrors.

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
- Updated dependencies [b746aa0]
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
- Updated dependencies [0f17114]
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
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [e98fb14]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [1b9a53b]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
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
- Updated dependencies [bf1edef]
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
- Updated dependencies [f104bab]
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
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4
  - @objectstack/formula@17.0.0-rc.4

## 17.0.0-rc.2

### Minor Changes

- ce5242c: feat(auth,objectql,audit,security,spec): identity-table writes carry the real actor, so `sys_member` history stops saying "system" (#4586)

  better-auth owns every write to the identity tables (`sys_member`, `sys_user`,
  `sys_invitation`, …) and its ObjectQL adapter runs them `isSystem: true` **on
  purpose** — the route already authorized the action under better-auth's own ACL,
  and ADR-0092 D2 refuses user-context writes to those tables outright. The
  consequence was that the human who clicked _make admin_ was known exactly once,
  in the hook layer where the session exists, and then discarded: every
  `trackHistory` transition on `sys_member` recorded `user_id: null` / "system",
  and `sys_user_permission_set.granted_by` was written null by the auto-grant.
  "Who made this person an org admin?" had no answer in the platform's own audit
  log.

  **What changed**

  A request-scoped attribution seam, general rather than a `sys_member` special
  case:

  | Layer                        | Before                             | After                                                                                                                          |
  | :--------------------------- | :--------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
  | `ExecutionContext`           | `userId` / `actor` only            | new optional `attributedUserId` — the human CREDITED for a write the system AUTHORIZED                                         |
  | `HookContext`                | `session`, `user`                  | new `provenance.attributedUserId`, split off the context beside `session`                                                      |
  | better-auth ObjectQL adapter | `{ isSystem: true }`               | `{ isSystem: true, attributedUserId }` when a request scope is open                                                            |
  | audit writer                 | `user_id = session.userId ?? null` | falls back to `provenance.attributedUserId` when the session names nobody                                                      |
  | `auto-org-admin-grant`       | `granted_by: null`, no `reason`    | the attributed human in `granted_by`, plus a machine-provenance `reason` naming the writer and the triggering `sys_member` row |

  Outside a request scope nothing changes: writes stay bare `{ isSystem: true }`
  and audit rows keep recording `null`. Absence is still never upgraded into a
  caller, and never written as a sentinel string (ADR-0118 D1/D2).

  **Hard constraint — attribution is not authority**

  `attributedUserId` is read by exactly one consumer, the audit writer, and by no
  security middleware. It never becomes `ExecutionContext.userId`, so it is never
  the subject the engine authorizes as: not RLS `current_user`, not the ownership
  stamp, not permission resolution. A context carrying only `attributedUserId`
  authorizes exactly like an empty context (ANONYMOUS), and a context carrying it
  beside `isSystem: true` authorizes exactly like `isSystem` alone. Re-authorizing
  identity writes as the human would re-adjudicate a decision better-auth already
  made — the second adjudication track ADR-0095 D3 closed. The constraint is
  pinned by tests at three layers: the engine seam
  (`packages/objectql/src/engine.test.ts`), the better-auth adapter
  (`packages/plugins/plugin-auth/src/auth-actor-attribution.test.ts`), and the
  live HTTP route (a plain member still cannot promote themselves).

  **For authors and plugin developers**

  `attributedUserId` is authorable on `ExecutionContext` and readable as
  `ctx.provenance?.attributedUserId` in hooks. Use it to answer _who is
  responsible_; keep using `ctx.session` / `ctx.user` to decide _what is
  permitted_. The two are separate fields precisely so the distinction cannot be
  blurred by accident.

- 328ccc5: fix(security,analytics): scope /analytics/query to the caller's readable records, and refuse a measure over a missing field (#4467, #4437)

  Two defects on the analytics query path, both found by the v17 verification run
  (#3909 / #4482), both reproduced against a live showcase server before the fix
  and re-verified with the same requests after.

  ## #4467 — `/analytics/query` applied no record-level scoping

  `ISecurityService.getReadFilter` documents itself as "the same filter the engine
  middleware AND-s into every find", and exists precisely for paths that bypass
  that middleware — its own doc comment names the analytics raw-SQL path. But the
  chain it mirrors is TWO sibling middlewares: plugin-security's RLS injection and
  plugin-sharing's owner/share visibility filter (`buildSharingMiddleware` AND-s
  `buildReadFilter` into `ast.where` for `find`/`findOne`/`count`/`aggregate`).
  Only the RLS half was ever computed here, and analytics has no other source of
  scope, so the OWD/share predicate simply never existed on that path.

  Live repro: `showcase_private_note` is `sharingModel: 'private'`; an admin owns
  5 notes, a member holds read shares on exactly 2 and no `viewAllRecords`.
  `GET /data/showcase_private_note` correctly returned 2 for the member, while
  `POST /analytics/query {measures:['count']}` returned 5 — and adding
  `dimensions:['title']` returned all five titles, i.e. the VALUES of a column
  that caller may not read, not merely a bad count. Any authenticated caller who
  could reach `/analytics` could enumerate the field values of every row of any
  object exposed as a cube, regardless of OWD, sharing rules, or RLS.

  `getReadFilter` now resolves plugin-sharing's `buildReadFilter` through the
  late-bound `sharing` service and AND-composes it with the RLS filter — the same
  composition the two middlewares reach by both writing into `ast.where`. It also
  computes the ADR-0057 D1 `__readScope` depth that the security middleware
  normally stashes on the context for plugin-sharing to widen its owner-match
  with, using the same `getEffectiveScope` call the middleware makes: no
  middleware runs on this path, and without it a caller granted `unit`/`org` read
  depth would be silently narrowed to `own`. The sharing predicate is resolved for
  every non-system caller AHEAD of the RLS stand-down branches, because those are
  the RLS middleware's own early exits and none of them is a reason to drop a
  sibling middleware's predicate; a sharing-resolution failure denies outright
  rather than falling through to half a scope.

  **Why `minor` rather than `patch`.** This is an observable behaviour change on a
  public read surface, in the narrowing direction: analytics results that a
  principal could previously read they now cannot. Counts drop, `dimensions`
  groupings lose rows, and any dashboard, report, or export built on
  `/analytics/query` over an owner-private object will show smaller numbers for
  non-superuser principals — correctly, but visibly. Deployments that had (however
  unknowingly) come to depend on the unscoped totals will see them change on
  upgrade, so this warrants more than a patch-level note even though it is a
  security fix. No API signature changed: `ISecurityService.getReadFilter`'s
  declaration is untouched — the implementation merely started honouring the
  contract it already documented.

  ## #4437 — a measure naming a missing field 500'd with SQLITE_ERROR

  `inferMeasure('ghost_sum')` maps a suffix convention onto a field name and has
  no way to know the field exists, so it built `SUM(ghost)`, the driver threw
  `no such column`, and the caller got
  `500 {"code":"SQLITE_ERROR","message":"Internal server error"}` — a driver error
  class as the `error.code` for what is a plain typo, which ADR-0112 forbids. A
  dotted spelling took the same path (`measures:['total.sum']` prefix-strips to
  `sum` → `SUM(sum)` → 500). The DATA route has refused the identical mistake with
  a `400 INVALID_FIELD` naming the field since #4315/#4254.

  `AnalyticsService.ensureCube` now validates each measure's resolved source field
  against the backing object's field names before any SQL is built, and rejects
  with the same envelope the data route produces (`400 INVALID_FIELD` carrying
  `field`, `object`, `param`, `measure`) so one mistake has one shape across
  `/data` and `/analytics`. The new `getObjectFieldNames` config hook reads the
  same schema registry `isRegisteredObject` already consults and the data path's
  own gate reads, so "which fields exist" has a single answer across both routes.

  The gate is tiered exactly like the #3867 cube-inference gate, deliberately
  narrow: it applies only when the cube's `sql` is a bare object name (an authored
  cube whose `sql` is a real SQL expression has no field list to check against),
  only when the probe answers (no data engine, or an external datasource whose
  columns are not mirrored locally, stands down), and only to measures whose
  source is a bare column — `count(*)` has no source field, and a dotted
  cross-object reference resolves through a join this layer cannot see, so both
  pass through untouched. `id`/`created_at`/`updated_at` are admitted
  unconditionally, matching the data path's `resolveQueryFields`: a gate stricter
  than the engine it guards would reject queries that used to work. Validation
  runs before the cube is registered, so a rejected query leaves no trace in the
  registry — otherwise a retry would find a "registered" cube carrying the bogus
  measure and sail straight into SQL.

  This half is `minor` for the same envelope reason: a request that used to return
  500 now returns 400 with a different `code`, which is a visible contract change
  for any caller branching on the response.

- 6dcbbc3: fix(plugin-security): the org-admin auto-grant can actually revoke — demoted admins really do lose tenant admin (#4640)

  `auto-org-admin-grant`'s only delete channel called
  `ql.delete(object, id, { context })`. The engine's signature is two arguments —
  `delete(object, options?: EngineDeleteOptions)` — so the id landed in the option
  bag, `rejectUnknownEngineOptions` read its character indices (`'0'`, `'1'`, …)
  as unknown option keys and threw, and `tryDelete`'s `catch` swallowed it. The
  system context in the discarded third argument went with it.

  That wrapper is the module's **only** delete channel, so all three revoke paths
  were silent no-ops for the module's entire life:

  1. **Demotion and member removal did not take the capability back.**
     `organization/update-member-role` moving someone from `owner`/`admin` back to
     `member` reconciled, deleted nothing, and returned
     `{ action: 'skipped', reason: 'delete_failed' }` while the
     `sys_user_permission_set` row stayed put. That row carries wildcard
     `viewAllRecords`/`modifyAllRecords` → `isTenantAdmin()`, so the demoted user
     remained a **tenant admin**.
  2. **The ADR-0105 D4 superseded-variant convergence never converged.** A posture
     change left the old `organization_admin` / `organization_admin_no_bypass` row
     in force — on a wall-less deployment, that is the unbounded variant.
  3. **The `kernel:ready` orphan sweep never swept** (membership deleted, grant
     left behind).

  The call now matches every other `ql.delete` call site in the repo:
  `ql.delete(object, { where: { id }, context: SYSTEM_CTX })`.

  ## ⚠️ Behaviour change: people will lose tenant admin on upgrade — that is the fix working

  Existing deployments have accumulated `sys_user_permission_set` rows that should
  have been revoked when someone was demoted or removed from an organization.
  After this release the `kernel:ready` backfill reconciles them, and every one of
  those grants is deleted on the first boot. Concretely, on upgrade:

  - users demoted from `owner`/`admin` to `member` at any point in the past
    **stop being tenant admins**;
  - users whose membership was deleted lose their orphaned org-scoped grant;
  - deployments that changed `tenancy.posture` converge on the posture's variant
    instead of keeping both.

  Nobody loses access they were _supposed_ to have: the grade that qualified them
  was already taken away, and only the capability row outlived it. If a specific
  person should keep blanket visibility, grant it deliberately —
  `admin_full_access` or an explicitly authored permission set — rather than
  through a better-auth membership grade. Expect `[security] revoked org-admin
capability` lines in the boot log naming each one.

  Failed revokes are no longer silent either: a delete the datastore rejects logs
  `[security] org-admin grant revoke FAILED — capability still in force`, and a
  reconcile that found grant rows and removed none logs that it left them behind.
  A capability the platform decided to withdraw and could not is exactly the
  outcome that must reach an operator.

- 0848bea: feat(spec)!: retire the overloaded `managedBy: 'system'` bucket — the residue becomes `system-data` (#3355)

  **FROM → TO: `managedBy: 'system'` → `managedBy: 'system-data'`.** One-line fix:
  rename the value. Nothing else about the object changes. `os migrate meta --from 16`
  rewrites it for you; stored metadata is CONVERTED by the ADR-0087 entry
  `object-managed-by-system-to-system-data`, never silently reinterpreted.

  ADR-0103 split the overloaded `system` bucket in v16, and it split it
  **additively**: the 20 engine-owned objects moved to the new explicit
  `engine-owned`, while the 8 admin/user-writable ones — the RBAC link tables
  (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`),
  `sys_user_preference`, `sys_approval_delegation`, and the three messaging config
  grids — stayed behind on `system`. That was the right move for a v16 that could
  not break authors, but it left the enum in a state where the surviving value
  names the half that had already moved out: `system` sitting on precisely the
  objects a user writes.

  That is not a cosmetic complaint. An author choosing between `system` and
  `engine-owned` had nothing in the vocabulary to choose _on_, so the bucket was
  re-overloadable by anyone reading the name in good faith — a model author most
  of all, since "system table" reads as "the engine owns this" in every other
  codebase. `system-data` states both boundaries explicitly: the **schema** is the
  platform's (versus `platform`, which is tenant-modelled), the **data** is the
  admin's or the user's (versus `engine-owned`, where the engine owns both).

  Because v16 already drained the engine side, the conversion is a **one-to-one
  mechanical value rename** with no judgement call — by construction every
  remaining `system` declaration is writable platform data.

  **One deliberate consequence — the affordance default flips.** `system` defaulted
  LOCKED and each of the 8 objects re-opened its writes with a
  `userActions: { create: true, edit: true, delete: true }` block. `system-data`
  defaults **WRITABLE** (full CRUD), because a bucket that exists to say "the data
  is yours" should not make every member ask for it back. Those blocks are now
  redundant and have been deleted from the 8 platform objects; keep `userActions`
  only to **NARROW**. If you converted an object that carried no `userActions`, it
  gains the generic affordances — the honest reading of the bucket it moved into.

  **No enforcement moves.** The engine write guard, the `DelegatedAdminGate`, RLS
  and permission sets all adjudicate off resolved affordances and the principal,
  never off the bucket name. `system-data` simply joins `platform` / `config` as a
  bucket the fail-closed guard does not cover, because a writable default has
  nothing to close on. The 8 objects passed that guard before (via `userActions`)
  and pass it now (via the bucket default), for the same resolved-affordance
  reason.

  `'system'` is **retired from the load path**: the enum rejects it with a
  prescription naming `system-data` and the one-line fix. Absorbing it silently at
  load would leave every author still writing the name this rename exists to
  unteach.

### Patch Changes

- 0d9a779: fix(security): 让 permission-set 投影只写 spec 认的键，并把静默失败的 backfill 变响亮 (#4669)

  ADR-0094 D4 的 permission-set backfill 在 #4001 之后 **100% 失败**：`sys_permission_set`
  每一行都有 `active` 存储列，`permissionSetBodyFromRow()` 把整行转成 metadata body 时把它
  一起带上，而 #4001 已经把 `PermissionSetSchema` 封成 `.strict()` —— 于是每一次
  `saveMetaItem` 都抛 `[invalid_metadata] … Unrecognized key(s) on this permission set:
'active'`。失败被 `catch` 成一条 `warn`、计数器不加一，所以测试全绿、没有任何自动信号：
  一个整条停摆的投影路径就这样过了一个发布周期。

  **归属判定：`active` 是行状态，不是声明。** 它的全部消费面 —— 表列、`highlightFields`、
  Setup 列表视图的过滤器、两个启停动作的 `bodyExtra: { active: … }` —— 都是记录的运行时开关，
  不是作者声明的能力边界。所以修法是在**投影侧挑键**，而不是把状态提升进 spec
  （`packages/spec/**` 零改动）。

  - `permissionSetBodyFromRow()` / `mergeRowPatchIntoBody()` 现在都经过一个**从
    `PermissionSetSchema.shape` 派生**的键白名单（不是手抄的字符串数组 —— 手抄的话 spec 加键
    时这里又会静默漏，正是本 bug 的翻版）。存储列（`active`、时间戳、`managed_by` /
    `package_id` / `customized`）一律不进 metadata body；`#4001` 之前**已经落库**、body 里
    仍带着 `active` 的历史 overlay 行，也在同一个闸口被滤掉，因此它们的数据门编辑不再报 422。
  - 两个启停动作行为不变：只含行状态的 PATCH 不再被改写成 metadata 写入，而是原样交给驱动
    执行列写入（保留 history / `updated_at` / FLS 等正常语义），并且不会再给一个包自带的
    permission set 平白造出一条“customization” overlay。投影通道则不再从 body 读 `active` ——
    一次投影不会再用陈旧 body 把管理员刚停用的 set 重新打开。
  - backfill 真失败时按 AGENTS.md「Degradation log levels」(#4632) 变响亮：`error` 级、
    文案写明后果（记录照常列出、看起来一切正常，但定义不在 metadata 里，重新 provision 不会
    重建它）与修复动作，并新增 `ProjectionReconcileOutcome.backfillFailed` 计数，让降级出现在
    结果里而不只在日志里。

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
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
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
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
  - @objectstack/platform-objects@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/formula@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- 1ea6bce: feat(sharing): hierarchy managers may manage shares within their write DEPTH (ADR-0111 D1 DEPTH)

  `canManageShares` gains its named DEPTH extension: a caller whose effective
  WRITE scope on the object is a hierarchy scope (`unit` / `unit_and_below` /
  `own_and_reports`) may now manage shares on a record whose owner falls within
  that scope's owner set — the same set the write filter and `canEdit` already
  honour, resolved by the enterprise `hierarchy-scope-resolver`. This lets a
  manager grant/revoke/list shares on a subordinate's record, matching
  Salesforce (roles above the owner) and Dataverse (the `Share` privilege's BU
  depth), without expanding the MVP owner + Modify-All authority.

  - New `ISecurityService.resolveWriteScope(object, context)` — the effective
    write scope, resolved by the same evaluator the CRUD middleware uses; fails
    closed to `own`. Mirrored on the sharing plugin's structural probe.
  - The gate honours only the three hierarchy scopes. `org` from the probe is
    deliberately ignored: it means both a genuine Modify-All holder (already
    granted via `hasWriteBypass`) AND the fail-OPEN "no permission set mentions
    this object" default, so honouring it here would reopen the hole
    `hasWriteBypass` was chosen to avoid.
  - Fails closed with no security service or no enterprise resolver — the open
    edition stays owner + Modify-All, exactly as before.

- c1dcacd: fix(sharing)!: the share-management surface gains the authorization layer it never had (ADR-0111 P0, #3902)

  Record sharing shipped as a data layer with no authorization of its own: every
  `/data/:object/:id/shares` and `/sharing/rules` route authenticated the caller
  and then ran the service under `SYSTEM_CTX` — any signed-in user could revoke
  anyone's share, enumerate who-can-see-what, write self-grants, and define /
  evaluate org-wide sharing rules. ADR-0111's P0 rulings land here:

  - **D1/D2** — `ISharingService.canManageShares(object, recordId, context)`:
    system, the record's owner, or a holder of Modify All Data (probed via the
    new fail-closed `ISecurityService.hasWriteBypass`). Enforced in the SERVICE,
    so every caller is covered; without plugin-security it fails closed to
    owner-only.
  - **D4** — `revoke` is symmetric with grant, validates the share belongs to the
    URL's record (`NOT_FOUND` on mismatch), and refuses non-`manual` rows
    (`CONFLICT` — a rule-materialised grant would be resurrected by the next
    reconcile).
  - **D5** — `listShares` is management-gated (invisible record → `NOT_FOUND`,
    visible-but-not-manager → `PERMISSION_DENIED`), and the open
    `/data/sys_record_share` read surface is self-scoped: non-admin callers see
    only rows naming them as recipient or grantor.
  - **D6** — the whole `/sharing/rules` surface (list/create/get/delete/evaluate)
    requires the new **`manage_sharing`** capability (D9; seeded into
    `admin_full_access`, `manage_platform_settings` honoured as the legacy
    equivalent), enforced in `SharingRuleService`.
  - **D7** — no inert grants: `recipientType` is narrowed to `user` (the only
    type any gate enforces), grants on objects the sharing gates never consult
    (public model, no `owner_id`, bypass, `controlled_by_parent`) fail with
    `SHARING_NOT_ENABLED` (422), and the manual upsert keys on
    `(object, record, recipient, source)` so manual and rule rows coexist.

  **Breaking** for callers that relied on the missing gate: unauthorized share
  management now fails with 403/404/409/422 instead of silently succeeding, and
  `ISharingService.revoke` gained an optional `scope` parameter. The verb
  boundary (edit ≠ delete, ADR-0111 D3) is NOT in this change — it lands as the
  separate P1.

- ad303ed: fix(sharing)!: an edit-level share no longer grants delete (ADR-0111 D3, the verb boundary)

  `update` and `delete` shared one `canEdit` gate, and `canEdit` accepts an
  `edit`-level share — so one "edit" grant silently conferred delete, the
  opposite error from the retired `full` level. A share widens _which rows_ a
  principal reaches, never _which verbs_ they may use (Salesforce Read/Write
  cannot delete; Dataverse `Delete` is a distinct privilege; Odoo splits
  `write`/`unlink`).

  - `ISharingService.canDelete(object, recordId, context)` — ownership (widened
    by write DEPTH) or the `modifyAllRecords` super-user bypass ONLY; an `edit`
    or legacy `full` share does not confer it. `canEdit` is unchanged (the
    update gate, share included).
  - `SharingService.buildWriteFilter` takes a `verb` parameter: a bulk
    `delete({multi:true})` scopes to the owner/DEPTH set alone (no share
    widening), while a bulk `update` keeps it.
  - The sharing middleware routes `delete` through `canDelete` and logs a
    specific fail-closed reason on denial (ADR-0111 D10).
  - `/security/explain` consults `canDelete` for a `delete` operation, so the
    record-level explanation matches enforcement.

  **Breaking**: a caller who could delete a record _only_ through an edit-level
  share (and holds object-level delete CRUD) can no longer delete it — delete now
  requires ownership, write depth, or Modify All Data. No new delete access level
  is introduced; a future per-record delete grant would be a capability mask
  AND-ed with object CRUD, not a fourth share level.

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

- 7ce02eb: feat(spec,objectql): `IObjectQLEngine` — the `objectql` slot's contract exists, the class `implements` it, and the seven consumer-local stand-ins are deleted (#4251 B3)

  ObjectQL registers one instance under two names, and the ledger can finally say
  what each name means: `data` stays `IDataEngine` (the data plane), `objectql`
  now resolves to **`IObjectQLEngine`** — the full engine: schema access
  (`getSchema` / `getObject` / `registry`), actions (`registerAction` /
  `removeActionsByPackage` / `executeAction`), the hook/middleware seams
  (`registerHook` / `unregisterHooksByPackage` / `registerFunction` /
  `registerMiddleware` / `bindHooks`), the first-wins default runners and hook
  metrics, boot wiring (`registerDriver` / `setDatasourceMapping` /
  `registerApp`), and the ops probes (`checkDriversHealth` /
  `wasDatastoreCreatedFromEmpty` / `invalidateDataMigrationFlags`). The ledger
  test pins the new relation: `objectql` strictly widens `data`, deliberately no
  longer equal.

  **Why now, and why `implements` is the point.** The honest state for two
  batches was recorded on `DomainHandlerContext.getObjectQL`: ObjectQL is wider
  than `IDataEngine`, the wider part had no contract, and typing it `IDataEngine`
  would be "the more comfortable-looking lie". The interim discipline — each
  consumer declares the narrow slice it uses — produced seven local surfaces
  (`AppEngineSurface`, `EngineRegistrySurface`, `EngineExtensionSurface`,
  `SecurityEngineSurface`, `FreshDatastoreEngine`, the dispatcher's inline
  `checkDriversHealth` slice, the `getObjectQL: any` itself). Each was honest and
  each was an UNCHECKED claim: `getService<Surface>('objectql')` is an assertion,
  so an engine rename would have broken every consumer at runtime with zero
  compile errors. `ObjectQL implements IObjectQLEngine` converts all of them into
  one compiler-verified claim. All seven stand-ins are deleted; consumers import
  the one declaration. `getObjectQL` is typed `Promise<IObjectQLEngine | null>`
  end to end, closing the oldest documented `any` in the dispatcher.

  **Evidence bar unchanged.** Every declared member has a cross-package consumer
  reaching it through the slot; engine members without one (e.g. `triggerHooks`,
  cross-package only in tests) stay off until a caller appears. The registry view
  (`EngineSchemaRegistryView`) declares exactly the eight members consumers use.

  **`_registry` never leaves the engine package now.** plugin-security's
  declared-metadata readers (`readDeclared`, permission-set projection, suggested
  audience bindings) reached ObjectQL's private `_registry` field through `any` —
  the same private reach `/me/apps` had in B2, five more times. All migrated to
  the public `registry` getter the contract declares, test doubles included.

  **`IMetadataService` gains `subscribe?` / `loadMany?`** — implemented by
  `MetadataManager` beside `watch` all along, reached through the slot only via
  `any` by ObjectQLPlugin's metadata bridge (the re-sync keeping runtime-authored
  hooks/actions live). With them declared, the bridge's six `metadata` lookups
  and metadata-protocol's `objectql` lookup carry contract types, and both files
  leave the grandfather list entirely: baseline **167 → 159 sites, 36 → 34
  files**.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- 5b47ab5: refactor(data)!: the QueryAST request surface stops declaring what no executor runs — `joins` and `windowFunctions` removed, six search flags and `aggregations[].filter` marked experimental, and the liveness ledger now governs the query surface (#4286)

  #4196 removed one declared-but-inert member from `FieldNode`. Applying the same
  method to the rest of the request surface (#4286) found 12 more members of
  `QueryAST` that no executor runs — `packages/objectql`'s `engine.ts` contains
  zero reads of any of them on the query path. This change dispositions the
  mechanical tiers and closes the gate that let the class stay invisible.

  **Removed (tombstoned): `query.joins` and `query.windowFunctions`.**

  - `joins` — no engine or driver ever read it; a query carrying it silently ran
    as a single-table query. Related-record retrieval already has a live
    spelling: `expand`. The orphaned `JoinNode` / `JoinNodeInput` /
    `JoinNodeSchema` / `JoinType` / `JoinStrategy` exports are deleted with the
    key (`data/JoinNode`, `data/JoinType`, `data/JoinStrategy` leave the
    published JSON schemas).
  - `windowFunctions` — `find()` never applied it, so every OVER clause it
    declared was silently dropped. The one live door is the SQL driver's own
    `findWithWindowFunctions(object, query)` (driver-level, not on the
    `IDataDriver` contract), and its input is a flat driver shape the spec
    vocabulary never matched — `WindowFunctionNodeSchema` declared `field` /
    `over` / `frame` members that door never read. The `WindowFunction` /
    `WindowSpec` / `WindowFunctionNode` exports are deleted with the key.

  **FROM → TO**

  | Was                                                     | Now                                                                                                             |
  | :------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------- |
  | `joins: [{ type: 'inner', object: 'customer', on: … }]` | `expand: { customer_id: { object: 'customer', fields: ['name'] } }`                                             |
  | `joins` for one related column                          | `fields: ['customer_id.name']` (dotted path)                                                                    |
  | `windowFunctions: [{ function: 'rank', … }]` in a query | `aggregations` + `groupBy`, or rankings in report/dashboard metadata                                            |
  | OVER-clause SQL from an embedder                        | `sqlDriver.findWithWindowFunctions(object, { windowFunctions: [{ function, alias, partitionBy?, orderBy? }] })` |

  The one-line fix: **delete the key**. Both are `retiredKey()` tombstones on the
  non-strict `BaseQuerySchema`, so authoring either fails `tsc` (input type
  `never`) and a query still carrying one — even as an empty array — fails to
  parse with the prescription itself. `QueryAST` is a request shape, never stored
  in stack metadata, so there is no `os migrate meta` step: the removals are
  registered as protocol-17 **semantic** migrations (`query-joins-retired`,
  `query-window-functions-retired`), the #4196 precedent.

  Compat note for the REST boundary: both names remain **reserved** list-query
  parameters while the tombstones live (`retiredKey()` keeps a key in
  `keyof QueryAST`, which feeds `RESERVED_LIST_QUERY_PARAMS`), so nothing changes
  for objects with fields named `joins`/`windowFunctions` — the un-reservation
  happens when the tombstones age out, and is called out in
  `metadata-protocol`'s `QUERY_AST_KEYS` comment for whoever does it.

  **Marked `[EXPERIMENTAL — not enforced]` (no wire or compat impact):**
  `search.fuzzy` / `operator` / `boost` / `minScore` / `language` / `highlight`
  (the ADR-0061 expansion reads only `query` + `fields`) and
  `AggregationNode.filter` (a SQL `FILTER (WHERE …)` affordance neither the SQL
  builders nor the in-memory fallback applies). Authoring one is now a
  declaration, not a silent no-op.

  **Deliberately NOT dispositioned here** (they want a maintainer call, #4286
  steps 3–4): `having` (the strongest enforce candidate — `engine.aggregate()`
  currently rebuilds the driver AST without it), and `cursor` / `distinct`
  (shipped SDK producers `QueryBuilder.cursor()` / `.distinct()`; `distinct` is
  mis-wired — its only observable effect is suppressing the REST list count).
  All three are recorded `dead` with evidence in the new ledger.

  **The gate:** `QuerySchema` joins the liveness ledger through the gate's
  `SPEC_ONLY_SCHEMAS` override (the `webhook` precedent) as governed type
  `query` — the first governance of what _callers_ write into a query rather
  than what authors write into metadata files. `packages/spec/liveness/query.json`
  classifies all 27 walked members (15 live with evidence, 7 experimental via
  describe markers, 5 dead), so the next declared-but-inert request member fails
  CI instead of needing a person to notice it.

  `@objectstack/plugin-security` (patch): the FLS predicate guard's
  `windowFunctions` walk is pruned — the clause no longer exists to leak through.
  The `having` and `aggregations[].filter` walks stay, deliberately: those
  members remain declared, and the guard being ready is what makes enforcing
  them later safe.

- 94a0bbc: fix(security)!: a disabled RLS policy no longer grants — found by re-verifying the ledger's security subset (#3896 follow-up)

  **The fix.** `RowLevelSecurityPolicySchema.enabled` promises, verbatim: _"Disabled
  policies are not evaluated."_ Nothing read it — not the collection site, not the
  projection round-trip, not the compiler. Because applicable policies OR-combine
  (any match allows access), a policy an admin switched off **kept contributing its
  grant**: disabling a too-permissive policy silently changed nothing. That is the
  #3896 shape — a documented security control whose real behaviour is wider than
  its contract — one layer up, on RLS instead of sharing rules.

  `getApplicablePolicies` now excludes `enabled === false` before any matching, at
  the single choke point both the find path and the analytics path flow through —
  the same place, and the same ADR-0049 enforce-or-remove resolution, as the
  formerly-unenforced `positions` domain. Exact `=== false` on purpose: the schema
  defaults `enabled` to true and projection rows may omit the key, so absent stays
  active. Four tests pin both directions. Access-narrowing only: no policy grants
  MORE after this change, and nothing in-repo authors `enabled: false`.

  **The audit that found it.** All 44 entries of the liveness ledger's security
  subset (`permission` 33, `position` 4, `object` sharing/access 7) were
  call-graph-closed by hand and stamped `verifiedAt: 2026-07-30` — the subset's
  first-ever re-verification (previously 4 dated entries repo-wide, and the last
  sweep that cited preview renderers went 10-for-13 wrong). Beyond `enabled`:

  - `rowLevelSecurity.priority` → **dead + authorWarn**. Not merely unimplemented:
    policies OR-combine (the schema's own describe says most-permissive-wins), so
    the promised "conflict resolution" semantics cannot exist. A REMOVE candidate
    per the #3715/#3950 precedent while the v17 breaking window is open.
  - `rowLevelSecurity.label` / `description` / `tags` → dead (benign display —
    no consumer in either repo; deliberately not authorWarn'd).
  - `tabPermissions` was UNDERSTATED: the note said only `'hidden'` is read, but
    hono's rank merge reads all four visibility values across resolved sets, and
    the `me-apps-and-everyone-baseline` dogfood test exercises it. Evidence
    upgraded; noted as a proof-binding candidate.
  - `allowExport` re-verified TRUE against the suspicion that it was
    projection-only: the export route carries its own caller-level 403 gate
    (`enforceExportPermission`), fail-closed when the security service cannot
    answer, separate from the object-level 405.
  - `allowTransfer/Restore/Purge` notes re-confirmed accurate (M2 operations still
    unshipped; the RBAC gates are pre-mapped fail-closed).
  - `object.ownership` evidence had rotted (line drift) — refreshed; six other
    object-level security entries re-cited and stamped.

  No other runtime behaviour changes.

- d92c72d: fix(lint,runtime,core): the slot-lookup guard sees the split-declaration form — the shape that made the ratchet look cleaner the more it was used (#4251)

  The three selectors from #4321 all key off the erasure and the lookup being in
  ONE expression. Split them and every selector misses:

  ```ts
  let ql: any;
  try {
    ql = ctx.getService("objectql");
  } catch {
    /* optional */
  }
  ```

  Selector 1 needs the call inside the declarator (this declarator has no init),
  selector 2 needs `as`, selector 3 needs a type argument. The contract is erased
  exactly as in `const ql: any = ctx.getService(…)`.

  **Why this could not wait for the batches.** The baseline's monotonicity check
  means a file that leaves the grandfather list can never be re-added. So every
  batch converted more of this shape from "grandfathered" into "lint covers this
  file and says nothing" — B2 alone moved `plugin-security/security-plugin.ts`
  into that state. A ratchet that reports a cleaner number the more you sweep is
  the #4342 failure wearing different clothes, and the fix only gets more
  expensive per batch shipped.

  **It is a rule, not a fourth selector, and that is the whole finding.** esquery
  can match `AssignmentExpression:has(CallExpression[…])`, but it cannot tell
  which declaration the assigned identifier resolves to — so it would equally
  flag the correctly-typed form this work line exists to produce (`let
i18nService: II18nService | undefined; i18nService = …`, 8 such sites today in
  runtime/app-plugin.ts, service-automation and metadata-protocol). Resolving the
  identifier needs SCOPE analysis. That is cheap and needs no type information, so
  this stays out of the typed-lint pass the KNOWN RESIDUAL still waits on — but it
  is a rule, and the earlier "just one more selector" estimate was wrong.

  Verified against exactly that: the rule flags all 16 real sites and none of the
  8 correctly-typed lookalikes.

  **Scale.** The baseline goes 140 → **169 sites** with the file count unchanged
  at 37: 29 sites were already inside grandfathered files and simply invisible.
  16 more could NOT be grandfathered (12 in files earlier batches had cleared, 3
  in files never listed, 1 the regex sweep had missed) and are typed here —
  `runtime/app-plugin.ts` ×5, `core/fallbacks/authored-translation-sync.ts` ×2,
  `plugin-security/security-plugin.ts` ×2, `cloud-connection/{runtime-config,
marketplace-proxy}-plugin.ts` ×3, `platform-objects/src/plugin.ts` ×2,
  `runtime/http-dispatcher.ts`, `runtime/domains/ai.ts`. No baseline key was
  added; the key set still only shrinks.

  Contracts where they exist (`IAIService`, `IJobService`, `IMetadataService`,
  `II18nService`, `IDataEngine`, `IHttpServer`), named local surfaces where they
  do not — `AppEngineSurface`, `SecurityEngineSurface`, `RawAppHost`,
  `EnvRegistrySurface`, `FreshDatastoreEngine`, `AuthoredTranslationSink`. Two of
  those record something worth naming: `IHttpServer` has no `getRawApp()` (the
  contract is framework-agnostic and the raw app is Hono's own handle), and
  ObjectQL's `_defaultBodyRunner` / `_defaultActionRunner` have no public reader
  at all — the engine attaches them via `(this as any)` and publishes nothing,
  while `getHookMetricsRecorder()` exists for exactly that question about the
  metrics recorder. Declared rather than laundered through `any`, and filed.

- c54c822: fix(spec,plugins): sweep the auth/session slot lookups — 31 sites typed, and the user-import metadata reader was pointed at a service that never had the method (#4251)

  Batch B2 of the #4251 sweep: every service-lookup erasure in the auth/session
  family. `plugin-auth/auth-plugin.ts` (20), `plugin-hono-server/current-user-endpoints.ts`
  (10) and `plugin-security/security-plugin.ts` (1) now pass the slot's contract
  type; the ratchet baseline drops **171 → 140 sites, 40 → 37 files**.

  **The yield.** `POST /admin/import-users` resolved the `metadata` slot and probed
  `metadataService?.getMetaItem` to decide whether to pass the import's field-coercion
  dependency. `getMetaItem` is a **protocol** method — `ObjectStackProtocolImplementation`,
  registered by MetadataProtocolPlugin under the `protocol` slot. `MetadataManager`,
  which occupies `metadata`, has never had it. So the probe was false on every
  deployment and the dep was never passed: imported rows reached `sys_user`
  uncoerced, with the branch that says otherwise sitting right there. This is the
  same shape as #4127's dead `automation.trigger` and #4321's `registerInMemory`
  probes — a capability the code advertises and the runtime cannot deliver, kept
  invisible by the `any`. Typing the lookup to `IMetadataService` is what turned it
  into a compile error. The route reads `protocol` now.

  `/me/apps` reached ObjectQL's **private** `_registry` through `as any` while
  `/auth/me/permissions`, two handlers up in the same file, read the public
  `registry` getter over the same field of the same object. Both read the public
  accessor now; the one test that stubbed `_registry` was pinning the private reach
  and stubs `registry` instead.

  **Contract, from evidence.** `IDataEngine`'s read methods (`find` / `findOne` /
  `count` / `aggregate`) declare the trailing `options?: BaseEngineOptions`
  argument they have always accepted. ObjectQL's own doc explains why it exists:
  reads once took their context inside the query while writes took it in trailing
  `options.context`, so the same `{ context }` object was correct as `insert`'s 3rd
  argument and **silently dropped** as `find`'s — "an intended `isSystem` bypass
  just vanished". The engine accepts both channels; the contract exposed only the
  query one, so callers using the trailing channel — the current-user endpoints'
  permission-set loader among them — could only reach it by erasing the lookup.
  Adding an optional trailing parameter breaks no implementor (the existing
  minimal-implementation test proves it) and no caller. `BaseEngineOptions` was
  already exported, sitting unused under the "legacy/deprecated" heading, which is
  why the contract went looking and did not find it; it moves up beside the other
  QueryAST-aligned types with the rationale attached. One new spec test pins the
  trailing argument at the call site — the position where the old contract rejected it.

  **Where the contract does not reach, the escape hatch is named.** Three slots
  resist a spec type today and each gets a narrow, documented local interface
  instead of `any`: `security.permissions` (plugin-security's `PermissionEvaluator`
  — plugin-hono-server must not depend on an optional plugin), `settings`
  (service-settings' resolver, same reason), and ObjectQL beyond `IDataEngine`
  (`registry` / `getSchema` / `registerHook` / `registerMiddleware`). That last one
  is deliberate scope: the standing record on `getObjectQL` in `@objectstack/runtime`
  says ObjectQL is genuinely wider than `IDataEngine` and nobody has written the
  wider contract, so typing the whole thing `IDataEngine` would be "the more
  comfortable-looking lie". These declarations are what that contract gets written
  from, and what it deletes.

  No behavior changes beyond the two fixes above.

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
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
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
- Updated dependencies [45dc446]
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
- Updated dependencies [be7360c]
- Updated dependencies [cc2de0e]
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
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [68dea0b]
- Updated dependencies [64f8cbe]
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
- Updated dependencies [4965bfa]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/formula@17.0.0-rc.1

## 17.0.0-rc.0

### Major Changes

- 4ed7ed4: feat(security)!: the export axis is now OPT-IN, explainable, and covers reports (#3544, #3710)

  **BREAKING — `allowExport` unset no longer means "inherit read".** Reading a
  record and taking a bulk machine-readable copy of the whole table are different
  privileges (Salesforce "Export Reports", Dynamics "Export to Excel", NetSuite
  "Export Lists", SAP `S_GUI` 61 all separate them). The axis now says so.

  ### Migration — FROM → TO

  |                      | before                              | after                      |
  | -------------------- | ----------------------------------- | -------------------------- |
  | `allowExport` unset  | export **allowed** (inherited read) | export **denied**          |
  | `allowExport: false` | export denied                       | export denied (unchanged)  |
  | `allowExport: true`  | export allowed                      | export allowed (unchanged) |

  **The one-line fix:** add `allowExport: true` to the object entry (or the `'*'`
  wildcard) of every permission set whose holders should keep exporting.

  ```ts
  objects: {
    deal: { allowRead: true, allowExport: true },   // ← add the grant
  }
  ```

  Nothing else changes: read, CRUD, RLS, FLS and sharing are untouched, and a set
  that never exported is unaffected.

  **Who is affected.** Package-shipped sets are re-seeded on upgrade, so the
  built-ins are handled for you — `admin_full_access` and `organization_admin` now
  carry `allowExport: true` explicitly. **Environment-authored sets are not**: any
  custom set whose users export must be edited. `member_default` deliberately does
  NOT carry the grant, so ordinary authenticated users lose export until an admin
  grants it — that is the point of the flip, not an oversight.

  **Merge semantics.** Most-permissive, exactly like the CRUD bits: any set
  granting `true` grants export. `false` and unset are the same outcome; `false`
  is authoring intent, not a veto, because permission sets are additive capability
  containers (ADR-0090).

  **Not implied by super-user bits.** `viewAllRecords` / `modifyAllRecords` no
  longer confer export. Separating "may see all data" from "may take a bulk copy"
  is the segregation-of-duties case the axis exists for.

  ### Also in this change

  - **spec** — a set carrying `allowExport` is now **high-privilege**
    (`describeHighPrivilegeBits`), so it cannot be bound to the `everyone` /
    `guest` audience anchors. Without this the opt-in was defeatable by binding an
    export-granting set to `everyone`. One predicate, so the runtime anchor gate,
    the `@objectstack/lint` security-posture rule and the install-time suggestion
    surface all pick it up together.
  - **spec / plugin-security** — `ExplainOperationSchema` gains `export`, so
    `explain` can answer _why_ a caller got `403 EXPORT_NOT_PERMITTED`. It
    explains as `read ∧ the export grant`: `object_crud` reports the conjunction
    and attributes the granting set, while every data-shaped layer
    (requiredPermissions, OWD/depth/sharing, RLS, record attribution) is computed
    as the `find` the export actually performs — asking the RLS compiler about an
    `export` operation would match no policy and wrongly report "no RLS applies".
    `readFilter` is surfaced for `export` as it is for `read`.
  - **plugin-reports** — closes the reports side door (#3710). A report rendered
    as `csv`/`json` is the same bulk copy of the same object, so it is gated by
    the same `ISecurityService.canExport`. Enforced in `executeReport`, which the
    interactive run, the ad-hoc run and the scheduled dispatch all funnel through;
    `scheduleReport` additionally refuses at create time so an author is not told
    at 3am. A schedule created while granted stops delivering once the grant is
    revoked. `html_table` stays a read — it is a rendered view, not a bulk copy.
    Deployments without `plugin-security` are unaffected (no permission sets
    exist, so the axis does not apply).

### Minor Changes

- 7fb436c: Multi-organization operation is an ENTITLEMENT again: the `group` posture no
  longer activates without the enterprise runtime (ADR-0105 D12 correction).

  The first ADR-0105 wave read D12 as "the `group` wall ships open" and made the
  posture self-activating — it never probed for `@objectstack/organizations`. That
  turned `group` into a free multi-org path around the `isolated` gate (ADR-0081
  D2), and made the weaker isolation the free one, which is not a boundary anyone
  would draw on purpose.

  The distinction that was missed: **open code is not free activation.** The wall's
  implementation has always lived in the open packages — that is equally true of
  `isolated`, whose Layer 0 wall sits in `plugin-security` and is gated on a
  service the enterprise package registers. Cloud ADR-0016's 铁律
  (强制免费、治理收费) guarantees that a deployment RUNNING a multi-org shape is
  safe; it is satisfied by REFUSING to run one unwalled, not by giving the posture
  away.

  ## Changes

  - **`tenancy-service`**: `group` probes `org-scoping` exactly like `isolated`.
    Without it the posture resolves to `single` and reports `degraded`.
  - **`os serve`**: the ADR-0093 D5 boot guard keys off the resolved POSTURE
    instead of `OS_MULTI_ORG_ENABLED`. Previously `OS_TENANCY_POSTURE=group` skipped
    both the enterprise package load AND the fail-fast, silently degrading to an
    unwalled deployment — the exact ADR-0049 class that guard exists to close. A
    `group` request without the runtime now refuses to boot unless
    `OS_ALLOW_DEGRADED_TENANCY=1`.
  - **New seam — the runtime declares what it entitles.** `org-scoping` may expose
    `supportedPostures` (`OrgScopingEntitlement`, `@objectstack/spec/security`);
    the open side honours it and fails closed on anything not listed. Whether
    `group` and `isolated` are one commercial tier or two is packaging policy, and
    packaging policy belongs to the commercial runtime rather than hard-coded in
    open core. Omitting the field entitles every walled posture, so existing
    runtimes are unaffected.
  - **`organization_id` stamping returns to the enterprise runtime.** The previous
    wave moved auto-stamping into the open engine; that removed the closed
    package's only load-bearing runtime duty, so a five-line forged `org-scoping`
    registration would have produced a fully working multi-org deployment. With
    stamping back where it was, a forged registration yields NULL-org rows the wall
    hides — a broken deployment, not an unlicensed working one.

    **Write-side VALIDATION stays open and is unchanged**, including the
    bulk-insert coverage: rejecting a forged `organization_id` is a security
    property, not a packaging one. Only filling an ABSENT value moved back.

  - Default-organization bootstrap returns to `single`-only; every walled posture
    keeps its existing owner (ADR-0081 D1).

  ## Note for operators

  `OS_TENANCY_POSTURE=group` without `@objectstack/organizations` installed now
  **refuses to boot** rather than running single-org. This only affects
  deployments that adopted `group` between the two waves.

- 879ea13: ADR-0105 Phase 0 + Phase 1: group tenancy posture; organization scope as a
  first-class authorization dimension.

  > This release carries BREAKING spec removals (see "Enforce-or-remove" below)
  > but is recorded as `minor`: every publishable package is in the Changesets
  > lockstep group, so one `major` would promote the whole monorepo. Breaking
  > changes ship as `minor` during the launch window — the migration notes below
  > are what reach consumers in `CHANGELOG.md`.

  ## Tenancy is now a spectrum (D1)

  `single | group | isolated`, resolved by the `tenancy` service and selected with
  the new `OS_TENANCY_POSTURE` env var. Existing deployments are unchanged:
  `OS_TENANCY_POSTURE` unset derives the posture from `OS_MULTI_ORG_ENABLED`
  (`true` ⇒ `isolated`, else `single`). An unrecognized value throws at boot
  rather than silently landing in a posture with no organization wall.

  - `single` — no wall (unchanged).
  - `group` — **new.** Organizations are membership boundaries over one shared
    dataset; Layer 0 becomes `organization_id IN accessible_org_ids` (union / MOAC
    semantics). Enforced by the OPEN engine.
  - `isolated` — today's `multi`, renamed. Behavior, enterprise `org-scoping`
    probe and degraded-boot handling all unchanged.

  ## Organization scope is a first-class context field (D2)

  `ExecutionContext.accessible_org_ids` — every organization the caller holds a
  currently-valid membership in (ADR-0091 validity windows) — is resolved once by
  `resolveAuthzContext` and carried by every transport. The `group` wall reads it
  directly; RLS policies may reference it as
  `organization_id IN (current_user.accessible_org_ids)`. An empty or absent set
  fails the wall closed.

  Only the Layer 0 PREDICATE widens. Composition is untouched: the wall is still
  computed independently of the RLS compiler, AND-composed outermost, and
  crossable only by a true `PLATFORM_ADMIN` on a posture-permitting object — so
  ADR-0095's W1/W2 invariants hold in every posture.

  ## Two P0 correctness fixes (D3, D4) — behavior changes

  **D3 — app-authored org-scoped RLS policies are no longer silently dropped**
  (finding F1, framework#3539). `collectRLSPolicies` used to strip any policy whose
  `using` contained the substring `current_user.organization_id` when isolation was
  inactive, which swallowed app-authored policies as well as the platform's own.
  Stripping is now decided by PROVENANCE (identity against the shipped
  declaration). **Upgrade impact:** in a deployment with no organization wall, an
  app-authored policy referencing the active organization is now RETAINED and
  fails closed (zero rows) with a one-time warning, where it previously vanished
  and the object read unscoped. `getReadFilter` shared the defect, so analytics and
  raw-SQL consumers were affected too. If a policy was only ever meant for
  multi-org, delete it or install `@objectstack/organizations`.

  **D4 — `viewAllRecords`/`modifyAllRecords` never cross an organization
  boundary** (finding F2, framework#3540). Under a wall-less posture nothing
  bounded the wildcard superuser bits `organization_admin` carries, so a
  deployment that accumulated organizations (personal orgs on signup) made every
  owner/admin an environment-wide superuser. `auto-org-admin-grant` now grants a
  de-VAMA'd `organization_admin_no_bypass` variant when no wall is enforced, and
  revokes the superseded variant whenever the posture changes. **Upgrade impact:**
  in `single` posture an org owner/admin keeps full CRUD but loses the blanket
  ownership/sharing/RLS bypass. Deliberate deployment-wide visibility remains
  available through `admin_full_access` or an explicitly authored permission set —
  it just stops being a side effect of a better-auth membership role.

  ## Engine-owned organization stamping (D5)

  Under any wall-enforcing posture the engine stamps `organization_id` from the
  caller's active organization on an insert that omits it, and validates every
  supplied value against the wall. Idempotent with the enterprise auto-stamp
  (neither overwrites a supplied value). This also closes a real hole: the
  pre-existing post-image check required a non-array payload, so a BULK insert
  could carry a forged `organization_id` per row. One forged row now denies the
  whole write.

  ## Group structure, extension fields and red-line lints (D6, D7)

  - `sys_organization` gains `parent_organization_id` and `sort_order` — a
    **reporting dimension only**.
  - New lint `validateOrgAxisRedLines` (`org-axis-permission-inheritance`,
    `org-axis-cross-org-bu-grant`), wired into `os lint` / `os compile` /
    `os validate`: an RLS policy or sharing rule that walks the org tree is an
    error, as is a business-unit grant on a platform-global object.
  - Extension fields on better-auth-managed objects ride the existing ADR-0092
    whitelist. A new guard derives better-auth's real field surface from
    `getAuthTables()` at the pinned version and fails the build on any name
    collision, so a library upgrade cannot silently take ownership of a column.

  ## Enforce-or-remove (D11) — BREAKING

  Both removals are of surface that had **zero runtime consumers**, so no
  behavior changes; authoring them is now a no-op instead of a lint warning.

  - **`PermissionSet.contextVariables` — REMOVED.** The RLS compiler never read
    it. FROM → TO: a set a policy needs as `field IN (current_user.<key>)` is now
    supplied by a registered membership resolver (below); a constant belongs in
    the policy itself as a literal (`status = 'published'`).
  - **`Territory` / `TerritoryModel` / `TerritoryType` (`security/territory.zod.ts`)
    — REMOVED.** No runtime object, stack field or resolver existed. FROM → TO:
    matrix requirements are served by multi-position × business-unit anchoring; a
    generalized dimension-security module will arrive with its own ADR.
  - **`ExecutionContext.rlsMembership` — PRODUCTIZED.** The bag the compiler has
    merged since ADR-0056 finally has a producer: register an
    `IRlsMembershipResolver` (`@objectstack/spec/contracts`) under the
    `rls-membership-resolver` service, declaring the keys it owns. Fail-closed by
    construction — an unresolved key makes its policies drop out. Kernel-owned
    keys (`accessible_org_ids`, `org_user_ids`, …) are reserved and cannot be
    overwritten from this seam.

  ## Edition boundary (D12)

  The `group` posture's enforcement primitives ship OPEN — the union wall,
  `accessible_org_ids` resolution, D5 stamping/validation, the D3/D4 correctness
  fixes and the D6 lints — because the correctness of a wall is never a paid
  feature (cloud ADR-0016 铁律「强制免费、治理收费」). `isolated` keeps its existing
  enterprise `org-scoping` probe, so the current commercial boundary for
  legal-entity isolation is unchanged by this release.

- 7c7e246: feat(authz): expose the caller's delegable scope — the read half of the
  delegated-administration gate (ADR-0090 D12 / ADR-0105 D8)

  `adminScope` decided writes but could not be READ: `assignablePermissionSets`
  lived only inside `delegated-admin-gate.ts`, so a UI offering "place this
  person in a unit, with these positions" (the D8 scoped-invitation form) had no
  way to narrow its pickers. It would list the whole tree and let the user
  discover the boundary by being refused — which turns an authorization gate into
  a validator and makes the boundary invisible until it bites.

  `ISecurityService.describeDelegableScope(callerContext)` answers it, exposed as
  `GET /api/v1/security/my-delegable-scope` and `client.security.describeDelegableScope()`:

  - `placeableBusinessUnitIds` — union of the subtrees where the caller may place
    people (scopes granting `manageAssignments`);
  - `assignablePositions` — positions whose every distributed permission set the
    caller may hand out (containment check included);
  - `scopes` — the held `adminScope`s with subtrees resolved, for attribution;
  - `isTenantAdmin` — unconstrained, with everything enumerated so a consumer
    renders ONE uniform picker instead of special-casing.

  Computed by the same helpers the write gate enforces with, so an option this
  reports is one `assert()` accepts — a test asserts that agreement directly. It
  NARROWS; the gate still decides.

  Strictly self-scoped: no target-user parameter, so it discloses nothing beyond
  the authority the caller already holds (unlike `explain`, which has one and
  gates it). Fail-closed — unresolvable scopes contribute nothing, a caller with
  no delegated authority gets empty lists, and a deployment without
  `@objectstack/plugin-security` gets 501.

- 9613396: feat(security): ENFORCE the user-level export axis on the server (#3544)

  `allowExport` landed as a spec bit plus a `/me/permissions` annotation, which
  hid the client's Export button — and nothing else. Because `export ⊆ list`, the
  REST export route streams through `findData` and the engine middleware sees an
  ordinary `find` gated by `allowRead`, so no code path ever read the bit: a caller
  holding `allowExport: false` could still `curl
/api/v1/data/:object/export` and drain the whole table. Declared, not enforced.

  - **plugin-security** `PermissionEvaluator.checkObjectPermission('export', …)` is
    now a real decision: `export` = read granted ∧ not explicitly denied.
    `allowExport` stays out of `OPERATION_TO_PERMISSION` on purpose — that map
    means "the bit must be truthy", which would have denied export to every
    permission set authored before the axis existed. The new exported
    `resolveUserExportAllowed()` folds the tri-state across sets (`true` beats
    `false` beats unset) exactly as the `/me/permissions` merge does.
  - **spec** `ISecurityService` gains `canExport(object, context)` — the question a
    bulk-egress door outside the engine middleware has to ask before it reads.
    Fails CLOSED; `isSystem` and an empty set resolution bypass, mirroring the
    middleware.
  - **rest** `GET /data/:object/export` calls it and answers **403
    `EXPORT_NOT_PERMITTED`** before the first chunk is fetched. Distinct from the
    object-level 405 `OBJECT_API_METHOD_NOT_ALLOWED`, which still runs first: 405
    says the object exposes no export, 403 says this caller may not use it. No
    security service (no `plugin-security` ⇒ no permission sets) → allowed, the
    same fail-open posture as every other permission gate in that layer; service
    present but unable to answer → denied.
  - **plugin-hono-server** the `/me/permissions` annotation now falls back to the
    `'*'` entry's export bit when a per-object entry declares none, matching the
    evaluator's own wildcard fallback — so a set that denies export wholesale via
    `'*'` no longer offers a button the server refuses.

  Backward-compatible: `allowExport` is still an opt-out with no default, so an
  unset bit inherits read and existing permission sets behave exactly as before.
  Only a permission set that explicitly sets `allowExport: false` changes — and it
  now changes on the server, which is the point.

  Implementers of `ISecurityService` outside this repo must add `canExport`; the
  interface member is required, matching how `getReadableFields` was added.
  Consumers still feature-detect (`typeof svc.canExport === 'function'`), so a
  partial implementation degrades rather than throwing.

- aa8b847: feat(authz): scoped invitations — placement intent on an invitation, gated by
  the issuer's adminScope and applied on acceptance (ADR-0105 D8)

  An invitation may now carry PLACEMENT INTENT — the business unit the invitee
  lands in and the positions they are assigned — so a delegated (plant) admin's
  invitee arrives already in the right unit and role instead of waiting on a
  platform admin. This closes the structural gap ADR-0105 D8 names for
  `single`-posture deployments and is the natural admission path under `group`.

  The two halves ship together, deliberately:

  - **Issuance is authorized** against the ISSUER's `adminScope` (ADR-0090 D12),
    by dry-running the existing `DelegatedAdminGate` against the very
    `sys_user_position` rows the acceptance would write. The gate is reused
    verbatim — no second copy of the subtree/allowlist logic to drift — so an
    invitation can never place what its issuer could not have assigned directly.
    Without that gate the feature would be an escalation hole: the built-in
    `organization_admin` is deliberately read-only on the RBAC tables precisely
    so a fresh org admin cannot rebind themselves, and applying an unchecked
    invitation payload under system context would hand that authority straight
    back.
  - **Acceptance applies it**, idempotently and failure-isolated: a replayed
    acceptance converges instead of duplicating assignments, and a placement
    miss never undoes a valid membership.

  Surface:

  - `sys_invitation` gains `business_unit_id` + `positions` (ADR-0092 extension
    fields, registered in the D7 collision-guarded whitelist; NOT generically
    editable — placement is set only at issuance, through the gate).
  - `@objectstack/plugin-security` registers the `invitation-placement` service
    (`assertIssuable` / `apply`).
  - `@objectstack/plugin-auth` wires better-auth's `beforeCreateInvitation` /
    `afterAcceptInvitation` to it. **Fail closed**: an invitation that requests
    placement in a deployment without the delegated-administration runtime is
    refused, never silently placed unchecked.

  Existing invitations are unaffected — an invitation without placement intent
  never consults the gate and behaves exactly as before.

- d318b24: feat: `security.getReadableFields` query surface for export column projection (#3547, #3391 follow-up)

  The REST export route projected its columns by inferring readability from the
  first chunk of already-masked data rows (#3498). That has two known
  compromises: a readable column whose first-chunk values are all null (and thus
  omitted by the driver) drops out of the header, and an empty result set leaves
  nothing to narrow. This adds the long-term-correct path.

  - **plugin-security** — the `security` service gains
    `getReadableFields(object, context)`. It resolves the caller's permission
    sets and builds the field-permission map with the SAME evaluator +
    `requiredPermissions` fold the read middleware's `FieldMasker` uses (and the
    same on-behalf-of delegator intersection, fail-closed on a dangling
    delegator), then returns every schema field NOT masked non-readable — the
    exact complement of what the mask deletes, so it can never drift from
    data-plane FLS. Computed from schema + context, never from data rows: immune
    to null values and empty result sets. A system context bypasses FLS; an
    unresolvable schema returns `undefined` so callers fall back.
  - **rest** — the `GET /data/:object/export` route asks the environment's
    `security` service for `getReadableFields(object, context)` and projects the
    schema-derived header to that set BEFORE streaming. When no security service
    is reachable (no plugin-security / single-kernel without a provider) it
    degrades to the existing masked-row inference, so there is zero regression.
    Explicit `?fields=` requests are still honored verbatim.

  Contract-neutral: export columns already equal list's readable columns
  (`export ⊆ list`, #3391); this makes the projection authoritative instead of
  inferred.

### Patch Changes

- 735f850: fix(security): resolve the ISSUER's real grants when authorizing invitation
  placement (ADR-0105 D8)

  Scoped-invitation issuance dry-runs `DelegatedAdminGate` against the
  `sys_user_position` rows the acceptance would write. The gate reads authority
  off `context.positions` / `context.permissions` — but the invitation hook
  handed it a hand-built `{ userId, tenantId }`, which carries neither. Every
  delegated administrator therefore resolved to the additive baseline alone and
  was refused:

  > requires tenant-level administration or a delegated adminScope (ADR-0090 D12)

  Fail-closed, but dead: only a tenant admin could ever issue a placement, which
  is the one case the feature was not for. Caught by cloud's group-posture
  dogfood, which exercises the real HTTP path with a real delegate.

  `assertIssuable` now takes `actorUserId` instead of a caller-built
  `actorContext` and resolves that user's grants itself through the single authz
  resolver (`@objectstack/core` `resolveUserAuthzGrants`) — the same envelope a
  transport would have carried, from the same reads. There is no request to
  resolve a context from inside a better-auth hook, so the id is what the caller
  can honestly supply and the resolution belongs behind the boundary.

  A principal-less call still reaches the gate with an empty context on purpose:
  the gate owns that refusal too, so the security boundary keeps exactly one
  place an issuance can be denied.

- 307e0fe: fix(security): govern `sys_member` writes — organization membership is not a delegable capability (#3697 follow-up)

  `DelegatedAdminGate`'s `GOVERNED_OBJECTS` covered the four RBAC link tables but
  not `sys_member`, so the table that decides _who is an org admin_ was the one
  authority surface the delegated-administration gate never saw.

  That matters because a membership row is an authority dial: `role` containing
  `owner`/`admin` is auto-elevated to `organization_admin` by
  `auto-org-admin-grant.ts`, and that set's wildcard `modifyAllRecords` is exactly
  what `isTenantAdmin()` tests. Writing one mints a tenant admin — the same
  escalation the invitation role cap closes on the issuance path, one layer down
  at the table.

  **Not exploitable today, and this changes no working behaviour.** Every
  `sys_member` writer is a better-auth path running under `isSystem`, which
  short-circuits the whole security middleware before this gate; the ADR-0092 D2
  identity write guard refuses user-context writes to better-auth-managed tables
  upstream of it. The gate is added so the chain cannot silently reopen the day a
  direct-write surface is introduced — a `case` label is not enforcement, and the
  call site is what decides (AGENTS.md Prime Directive #10).

  The rule is tenant-admin-only rather than scope-delegable, deliberately: no axis
  of `AdminScope` expresses "organization membership" (its vocabulary is BU
  subtree, action flags and an assignable-set allowlist), so there is nothing for
  a delegated scope to approve part of — and a delegate who could write one would
  mint authority strictly greater than their own, which is what ADR-0090 D12
  exists to prevent. Adding people to an organization already has a delegable
  path: the **invitation**, whose placement is authorized against the issuer's
  `adminScope` and whose role is capped at the issuer's own grade. The refusal
  message says so.

- 0e3a226: fix(authz): widen the driver's native tenant scope to the membership union
  under the `group` posture — ADR-0105 D2 finally reaches the wire (#3623)

  The Layer 0 wall correctly compiled `organization_id IN accessible_org_ids`
  under `group`, but the ObjectQL engine also propagated the active-org
  `tenantId` into `DriverOptions` unconditionally, and the SQL driver's native
  scoping ANDed `organization_id = tenantId` under the union — collapsing every
  group read back to active-org (isolated) reach. Found by the cloud-side
  `ee-group-showcase` dogfood (cloud#880), the first end-to-end boot of `group`
  against a real driver.

  - `DriverOptions.tenantIds` (spec): the union tenant access set. Drivers with
    native scoping widen reads/updates/deletes/aggregates to `IN (...)`,
    keeping the NULL-tenant global-row carve-out; inserts still stamp from
    `tenantId` (the active organization is the write target, D5). Absent or
    empty ⇒ equality fallback — fail toward isolation, never toward exposure.
  - ObjectQL engine threads `ExecutionContext.accessible_org_ids` as
    `tenantIds` when the tenancy posture is `group`, reported by a new
    `setTenancyPostureProvider` seam.
  - SecurityPlugin wires that provider at start — deliberately from the
    enforcement layer, so the driver wall only widens while the Layer 0 union
    wall enforces above it. Embeddings without plugin-security keep active-org
    equality.

- d1cabaa: fix(i18n): translate the SSO / SCIM / user-position / import-job admin objects

  Four live, UI-facing system objects were registered but never added to their
  package's i18n extract config, so non-English admins saw raw English `label`
  metadata:

  - `sys_sso_provider`, `sys_scim_provider` (platform-objects) — identity-provider
    admin grids plus the register / verify-domain actions.
  - `sys_user_position` (plugin-security) — delegated position assignment
    (`userActions` create/edit/delete); its sibling `sys_user_permission_set` was
    already translated, so this closes an inconsistency.
  - `sys_import_job` (platform-objects) — import history / progress, alongside the
    already-translated `sys_job` / `sys_job_run`.

  Adds each object to its package's `scripts/i18n-extract.config.ts` and supplies
  real zh-CN / ja-JP / es-ES translations across all four locale bundles, and
  extends the bundle-ownership guards' `OWNED_OBJECTS` to cover them. The
  orphan-only guards from #3502 could not catch this "owned-and-live-but-never-
  extracted" gap.

- aff9e56: fix(i18n): translate the platform packages' declared surface, and gate all nine bundles instead of one (#3762)

  Only `platform-objects` was wired into a translation-drift check. The other
  **eight** packages shipped a `scripts/i18n-extract.config.ts` that nothing ever
  ran — and four of them had already drifted out of sync with the schema, exactly
  the rot `pnpm check:i18n` exists to catch, one directory over.

  **Translated.** `plugin-security` (45 strings per locale), `plugin-webhooks`
  (15), `plugin-audit` (8), `plugin-sharing` (7) and `service-storage` (7) are now
  at **zero** untranslated declared strings in zh-CN / ja-JP / es-ES — 246
  translations. Most were newly _visible_ rather than newly missing: #3753 taught
  the coverage detector to walk action `params`, `resultDialog`, `listViews` and
  the rest of the declared surface, and these are what it found.

  Wording was harvested from the repo's own bundles wherever a string was already
  translated somewhere (1382 unambiguous source strings), so `Created At` reads
  `创建时间` here because that is what it reads everywhere else, rather than a
  fresh invention. Protocol tokens are deliberately left identical across locales:
  `GET` / `POST` / `PUT` / `PATCH` / `DELETE`, `ETag`, `ACL`, `URL`.

  **Gated.** `scripts/check-i18n-bundles.mjs` replaces the single-package
  `pnpm check:i18n` and checks all nine. It does not restate each package's
  command — it parses the one already documented in that config's own docstring
  and runs it, so the documented regenerate command and the gate cannot diverge.
  The coverage ratchet grows the same way, from `examples/*` to twelve configs;
  eight of them sit at zero, which makes it the strict gate there.

  **Fixed a real truncation bug it exposed.** `os lint --json` on a large config
  came out of a pipe cut off at exactly 65536 bytes — `console.log(big)` followed
  by `process.exit(1)` tears the process down before an async pipe write drains,
  while an interactive run (stdout is a TTY, written synchronously) looks perfect.
  Every scripted consumer silently got invalid JSON. `emitJson` in
  `packages/cli/src/utils/format.ts` waits for the write to drain and sets
  `process.exitCode` instead; `lint`, `i18n check` and `i18n extract` use it.
  Roughly 30 other CLI commands share the pattern and are not touched here.

  The nine documented regenerate commands also gain `--no-metadata-forms` (added
  in #3768), since the Studio metadata-form baseline belongs to `platform-objects`
  alone, not to a copy in every plugin.

  Not fixed here: `platform-objects`' own 77-per-locale gap is `apps.*` /
  `dashboards.*` navigation and widget labels, which live outside the `objects`
  subtree and cannot be scaffolded while the package extracts with
  `--objects-only`. That needs an emit decision first — tracked in #3762.

- 7180ed5: fix(security): fail closed when an object's security posture can't be resolved
  (#3545)

  #3545 accepted the API-exposure gate's fail-open on unresolvable metadata on one
  load-bearing premise: that gate is a SURFACE-AREA control, while the real
  authorization boundary — auth + the ObjectQL security middleware (CRUD/FLS/RLS)
  — enforces unconditionally on the data call whatever the gate answers.

  Verifying that premise rather than assuming it shows it did not hold. The
  middleware does run unconditionally, but two of its INPUTS were read from the
  same object metadata and defaulted permissively when it could not be resolved,
  so the very trigger the issue is about reached one layer PAST the gate, into the
  boundary itself: an unresolved `access.default` read as PUBLIC (so a plain `'*'`
  wildcard covered an object ADR-0066 D2 excludes from it) and an unresolved
  `requiredPermissions` read as NO CONTRACT (so the D3 capability AND-gate was
  skipped entirely).

  `getObjectSecurityMeta` now flags `unresolved`, and the three consumers that turn
  posture into an access decision fail closed on it: the middleware denies (with an
  error log, so a persistent metadata outage is observable rather than a silent
  blanket-allow), `canExport` denies, and `getReadableFields` exposes no columns —
  the same stance already taken for a permission-resolution failure and a dangling
  delegator. `computeLayeredRlsFilter` keeps consuming the defaults deliberately:
  there the permissive value WITHHOLDS the cross-tenant exemption, so it is already
  the closed direction.

  Blast radius is bounded to the risky case. System/boot writes (`isSystem`) and
  principal-less/anonymous contexts short-circuit earlier in the middleware, so
  reaching the new check means an authenticated principal with resolved grants
  asking for an object whose declaration is missing; the cold-start window is
  served by those short-circuits, not by the permissive default. The exposure
  gate's own tiered decision (transient unavailability → fail open) is therefore
  unchanged — it now rests on a boundary that actually holds.

  The explain engine reports the denial on its existing `object_crud` layer naming
  the real cause, so the "why am I denied?" surface cannot drift from enforcement.

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

- 1659072: feat(spec): publish `ISecurityService` — the `security` service surface becomes an enforced contract

  The `security` service registers seven cross-package methods (`getReadFilter`,
  `getReadableFields`, `resolvePermissionSetNames`, `explain`, and the three
  audience-binding suggestion calls) but had no contract in
  `@objectstack/spec/contracts`. Consumers duck-typed it, and each one invented its
  own fallback for a missing method or an "empty" answer — with more consumers
  arriving, that is a drift surface.

  `ISecurityService` now documents the surface, and both ends are typed against it
  so it is **enforced rather than declared**: `plugin-security` assigns its
  registration to `ISecurityService` (a renamed, dropped, or re-typed method fails
  that build), and the REST layer resolves the service as a `Partial<ISecurityService>`
  (so call sites must keep feature-detecting instead of assuming the full surface).

  The contract makes explicit the one thing consumers cannot guess — that the
  methods do **not** share a failure convention:

  - `getReadFilter` fails **CLOSED**: a resolution failure yields a deny filter
    matching zero rows, never `undefined`. `undefined` means "no row restriction",
    and nothing else.
  - `getReadableFields` fails **SOFT**: `undefined` means "no answer, use your own
    projection", while `[]` is authoritative and means "no field is readable" —
    opposite instructions that a consumer must not conflate.

  Typing the producer immediately caught one real discrepancy, fixed here:
  `getReadFilter` declared `Promise<Record<string, unknown> | null | undefined>`
  while every return path yields a filter or `undefined` (`filter ?? undefined`
  normalizes the null away). The dead `| null` is removed, so "no restriction" has
  exactly one representation. Type-level only — no runtime behaviour changes.

- f00d8d4: fix(sharing): remove the `full` access level — it promised delete/transfer/share and granted `edit` (#3865)

  `sys_sharing_rule.access_level` / `sys_record_share.access_level` offered three
  levels, the third documented as **Full Access (Transfer, Share, Delete)**. No
  code path granted transfer, re-share, or delete because of it: both enforcement
  sites matched `access_level in ('edit','full')`, so `full` was byte-equivalent
  to `edit`. An admin picking "Full Access" in Setup was told they had granted
  delete rights and had not — declared-but-unenforced metadata (ADR-0078,
  ADR-0049), the same defect that retired the `queue` recipient before it.

  Measured on showcase, a `full` recipient got `read: allowed`, `update: allowed`,
  `delete: DENIED` — and the denial came from `decidedBy=object_crud`, i.e. the
  object-level CRUD gate rejected the delete _before_ sharing was consulted at
  all. That is not an oversight to patch around; it is the model working. Record
  sharing widens **which rows** a principal reaches, never **which verbs** they
  may use — the same split Salesforce enforces (its sharing rules stop at
  Read-Only / Read-Write; Full Access is owner / hierarchy / Modify All only,
  never grantable by a rule) and Dataverse enforces by AND-ing every shared access
  right against the security role's own privilege. Delete and transfer belong to
  ownership, the ADR-0057 DEPTH scopes, and admin scope.

  **What changed**

  - `SharingLevel` (spec/security) and `ShareAccessLevel` (spec/contracts) are now
    `read | edit`. The `Field.select` on both objects offers the same two, so the
    Setup dropdown no longer shows the misleading option.
  - `SharingService.grant()` and `SharingRuleService.defineRule()` gained the
    access-level validation they never had: `full` normalises to `edit`, and an
    unrecognised level is a `VALIDATION_FAILED` (HTTP 400) instead of being
    persisted verbatim as a grant no gate would ever match.
  - Enforcement stays deliberately wider than authoring — the read/write gates
    still match `edit`/`full` — so a row written before this release keeps
    working. Narrowing them would silently _revoke_ access.
  - A boot backfill normalises stored `full` rows on both tables, and the
    `sharing-rule-access-level-full-to-edit` conversion rewrites declarative
    stacks at load, so nothing needs consumer action.

  **Migration.** None. `full` and `edit` were already behaviourally identical, so
  rewriting one to the other cannot change an access decision — unlike the OWD
  `sharingModel: 'full'` alias retired in ADR-0090 D4, which changed posture and
  had to be delegated to the author. A stack that still authors `accessLevel:
'full'` converts at load with a deprecation notice; stored rows normalise at
  next boot. Code that pinned the `ShareAccessLevel` type to `'full'` no longer
  compiles — use `'edit'`.

  Reviving a real per-record delete grant is a separate design (a capability mask
  AND-ed with object CRUD, plus the share-administration model that would have to
  authorise re-sharing), not a fourth enum member.

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
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
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
- Updated dependencies [524151c]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [d1cabaa]
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
- Updated dependencies [4921a95]
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
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
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
- Updated dependencies [9aa5510]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/platform-objects@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/formula@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/formula@16.1.0

## 16.0.0

### Minor Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

### Patch Changes

- 2f3c641: ADR-0099 P0: land the probe-vs-carried-rung equivalence gate in the authz matrix (`authz-matrix-gate.test.ts`) — seeded-shape equivalence cells, two adversarial `KNOWN DIVERGENCE` pins (scoped `admin_full_access` grant; piecemeal platform-exclusive capability), the I2 nesting and I3 narrowing invariant cells, posture-blindness staging pins for the P1 flip, and the EXTERNAL dead-branch cell. Extracts the platform-admin capability probe as the exported pure `hasPlatformAdminCapability` (mechanical, behavior unchanged). Test-only gate; the ADR-0099 P1 flip lands behind it (#3211).
- e38da5b: ADR-0099 P1 (#3211 M2): the Layer 0 cross-tenant exemption gate now reads the carried `ctx.posture` rung (#2956) as authoritative, with the platform-admin capability probe demoted to a fallback for resolver-less contexts (delegated-admin bridge, sharing service, `getReadFilter`). The read and write (insert/update post-image) tenant checks share one decision (`computeLayeredRlsFilter`), so they cannot drift. A probe↔rung disagreement logs a defect breadcrumb and enforces the narrower rung verdict.

  **Behavior change (security narrowing, multi-org / `@objectstack/organizations` only):** a principal whose carried rung is not `PLATFORM_ADMIN` no longer crosses the tenant wall on private / platform-global / better-auth-managed objects, even when its resolved permission sets carry a platform-exclusive capability. Two shapes are affected: (a) a **scoped** `admin_full_access` grant (`sys_user_permission_set.organization_id` non-null), and (b) a custom set granting a platform capability (e.g. `studio.access`) piecemeal alongside a superuser bit. Both are now walled to their own org — the fail-safe direction (the carried rung is a strict subset of the probe). Single-org / env-per-database deployments are unaffected (Layer 0 is inert).

  **Upgrade check:** before upgrading, scan `sys_user_permission_set` for `admin_full_access` rows with a non-null `organization_id`, and custom permission sets whose `systemPermissions` intersect `{manage_metadata, manage_platform_settings, studio.access, manage_users}`. To restore cross-tenant operator access for such a principal, grant the **unscoped** `admin_full_access` instead. The `[authz/ADR-0099]` warn log names any principal hitting the divergence at runtime.

- f9b118d: ADR-0099 P2′ (#3211 M3′): pin the two-axis Amendment in the authz matrix. The original P2 (collapse the Layer 1 tier onto posture) was rejected — Layer 1's tier input is the per-object super-bit, a per-principal × per-object delegation primitive posture cannot represent. New cells pin: seeded-face agreement (seeded super-bit holders are already ≥ TENANT_ADMIN), the load-bearing delegation cell (a MEMBER with a delegated per-object `viewAllRecords`/`modifyAllRecords` short-circuits Layer 1 yet stays walled by Layer 0 — the auditor pattern), invariant I7 (the scope axis never crosses a boundary posture has not opened), and the contrast that the bit is a real grantable capability, not conditionally inert. Test-only; zero behavior change.
- 9d897b3: **Derive the better-auth managed-object write denies from the live registry (#3325, follow-through of ADR-0092 / ADR-0103).** The default permission sets deny generic writes on better-auth identity tables via a hand-maintained `BETTER_AUTH_MANAGED_OBJECTS` list — exactly the drift ADR-0092 forbids, and it had already drifted (the list carried 17 names while 22 schemas declare `managedBy: 'better-auth'`, leaving `sys_scim_provider`, `sys_sso_provider`, and three `sys_oauth_*` tables wildcard-granted for writes at the permission-evaluator layer; the identity write guard still 403'd the actual write, so this was a defense-in-depth gap, not a live hole).

  - New `applyManagedWriteDenies` (`managed-object-write-denies.ts`) injects a read-only-write deny for every registered `managedBy: 'better-auth'` object into the four write-granting default sets (`organization_admin`, `member_default`, `viewer_readonly`, MCP write) at `kernel:ready`, mutating the shared in-memory `bootstrapPermissionSets` in place (the array the evaluator resolves and the seeder serializes — a DB-row-only fix would be dead code). Never touches `admin_full_access`, never overrides an existing explicit entry, ignores `userActions` (the better-auth bucket is hard-denied — `sys_user`'s `userActions.edit` opens only a field-level whitelist the identity guard enforces).
  - The static `BETTER_AUTH_MANAGED_OBJECTS` list is completed to 22 and kept as a compile-time baseline (covers the pre-`kernel:ready` window), now pinned bidirectionally against the `@objectstack/platform-objects` schemas by a test so it cannot silently rot again.
  - Engine-owned `system`/`append-only` objects are deliberately NOT given deny entries — a per-object entry overrides the wildcard and would drop `viewAllRecords`; their writes are already rejected by the ADR-0103 engine guard.

  No public API change; the helper is internal. Behavior is byte-preserving for the 17 already-listed tables and closes the gap on the 5 that had drifted.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [7125007]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
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
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/platform-objects@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/formula@16.0.0

## 16.0.0-rc.1

### Minor Changes

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

### Patch Changes

- 9d897b3: **Derive the better-auth managed-object write denies from the live registry (#3325, follow-through of ADR-0092 / ADR-0103).** The default permission sets deny generic writes on better-auth identity tables via a hand-maintained `BETTER_AUTH_MANAGED_OBJECTS` list — exactly the drift ADR-0092 forbids, and it had already drifted (the list carried 17 names while 22 schemas declare `managedBy: 'better-auth'`, leaving `sys_scim_provider`, `sys_sso_provider`, and three `sys_oauth_*` tables wildcard-granted for writes at the permission-evaluator layer; the identity write guard still 403'd the actual write, so this was a defense-in-depth gap, not a live hole).

  - New `applyManagedWriteDenies` (`managed-object-write-denies.ts`) injects a read-only-write deny for every registered `managedBy: 'better-auth'` object into the four write-granting default sets (`organization_admin`, `member_default`, `viewer_readonly`, MCP write) at `kernel:ready`, mutating the shared in-memory `bootstrapPermissionSets` in place (the array the evaluator resolves and the seeder serializes — a DB-row-only fix would be dead code). Never touches `admin_full_access`, never overrides an existing explicit entry, ignores `userActions` (the better-auth bucket is hard-denied — `sys_user`'s `userActions.edit` opens only a field-level whitelist the identity guard enforces).
  - The static `BETTER_AUTH_MANAGED_OBJECTS` list is completed to 22 and kept as a compile-time baseline (covers the pre-`kernel:ready` window), now pinned bidirectionally against the `@objectstack/platform-objects` schemas by a test so it cannot silently rot again.
  - Engine-owned `system`/`append-only` objects are deliberately NOT given deny entries — a per-object entry overrides the wildcard and would drop `viewAllRecords`; their writes are already rejected by the ADR-0103 engine guard.

  No public API change; the helper is internal. Behavior is byte-preserving for the 17 already-listed tables and closes the gap on the 5 that had drifted.

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [7125007]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/formula@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

### Patch Changes

- 2f3c641: ADR-0099 P0: land the probe-vs-carried-rung equivalence gate in the authz matrix (`authz-matrix-gate.test.ts`) — seeded-shape equivalence cells, two adversarial `KNOWN DIVERGENCE` pins (scoped `admin_full_access` grant; piecemeal platform-exclusive capability), the I2 nesting and I3 narrowing invariant cells, posture-blindness staging pins for the P1 flip, and the EXTERNAL dead-branch cell. Extracts the platform-admin capability probe as the exported pure `hasPlatformAdminCapability` (mechanical, behavior unchanged). Test-only gate; the ADR-0099 P1 flip lands behind it (#3211).
- e38da5b: ADR-0099 P1 (#3211 M2): the Layer 0 cross-tenant exemption gate now reads the carried `ctx.posture` rung (#2956) as authoritative, with the platform-admin capability probe demoted to a fallback for resolver-less contexts (delegated-admin bridge, sharing service, `getReadFilter`). The read and write (insert/update post-image) tenant checks share one decision (`computeLayeredRlsFilter`), so they cannot drift. A probe↔rung disagreement logs a defect breadcrumb and enforces the narrower rung verdict.

  **Behavior change (security narrowing, multi-org / `@objectstack/organizations` only):** a principal whose carried rung is not `PLATFORM_ADMIN` no longer crosses the tenant wall on private / platform-global / better-auth-managed objects, even when its resolved permission sets carry a platform-exclusive capability. Two shapes are affected: (a) a **scoped** `admin_full_access` grant (`sys_user_permission_set.organization_id` non-null), and (b) a custom set granting a platform capability (e.g. `studio.access`) piecemeal alongside a superuser bit. Both are now walled to their own org — the fail-safe direction (the carried rung is a strict subset of the probe). Single-org / env-per-database deployments are unaffected (Layer 0 is inert).

  **Upgrade check:** before upgrading, scan `sys_user_permission_set` for `admin_full_access` rows with a non-null `organization_id`, and custom permission sets whose `systemPermissions` intersect `{manage_metadata, manage_platform_settings, studio.access, manage_users}`. To restore cross-tenant operator access for such a principal, grant the **unscoped** `admin_full_access` instead. The `[authz/ADR-0099]` warn log names any principal hitting the divergence at runtime.

- f9b118d: ADR-0099 P2′ (#3211 M3′): pin the two-axis Amendment in the authz matrix. The original P2 (collapse the Layer 1 tier onto posture) was rejected — Layer 1's tier input is the per-object super-bit, a per-principal × per-object delegation primitive posture cannot represent. New cells pin: seeded-face agreement (seeded super-bit holders are already ≥ TENANT_ADMIN), the load-bearing delegation cell (a MEMBER with a delegated per-object `viewAllRecords`/`modifyAllRecords` short-circuits Layer 1 yet stays walled by Layer 0 — the auditor pattern), invariant I7 (the scope axis never crosses a boundary posture has not opened), and the contrast that the bit is a real grantable capability, not conditionally inert. Test-only; zero behavior change.
- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/platform-objects@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/formula@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/formula@15.1.1
- @objectstack/platform-objects@15.1.1

## 15.1.0

### Minor Changes

- f531a26: OWD posture is now enforced on the runtime write path (#3050). `metadata-protocol` gains the ADR-0094-addendum `registerAuthoringGate(type, gate)` seam — an awaited, throwing pre-persistence hook inside `saveMetaItem` (draft and publish-mode saves; environment writes only). `plugin-security` registers the `object` posture gate on it: an environment overlay of a packaged object may only TIGHTEN `sharingModel`/`externalSharingModel` (ADR-0086 D1 — closes the `OS_METADATA_WRITABLE=object` unvalidated-widening hole), and `externalSharingModel ≤ sharingModel` (ADR-0090 D11) is now rejected at save time instead of only by CLI lint. Write-path only — stored metadata keeps loading unchanged.

### Patch Changes

- f531a26: fix(security): fail-closed sentinel for on-behalf-of reads on getReadFilter (#2852)

  `getReadFilter` (the read-scope provider the analytics/raw-SQL path binds to)
  resolves only the caller's own ceiling — the ADR-0090 D10 delegator RLS
  intersection that the engine middleware applies to find/count/aggregate is not
  implemented on this path. Computing a filter here for a delegated (on-behalf-of)
  context would therefore silently widen the read past the delegator's scope.

  Until the intersection is threaded through `computeRlsFilter` (tracked with
  #2920 B1 / ADR-0095 D1), `getReadFilter` now denies fail-closed (deny sentinel +
  error log) when `context.onBehalfOf.userId` is set. System on-behalf-of bypasses
  ahead of the guard, and no agent surface reaches analytics today, so this is a
  latent-invariant guard rather than a live-traffic behavior change.

- f531a26: feat(mcp): `aggregate_records` tool — GROUP BY aggregation over the engine read path

  New MCP tool `aggregate_records` (count/sum/avg/min/max/count_distinct, optional
  groupBy incl. date bucketing, where filter, IANA timezone) in the `data:read`
  family. Execution routes through the ObjectQL ENGINE (`callData('aggregate')`
  deliberately never uses the raw per-env driver), so RLS/tenant scoping and the
  D10 delegator intersection apply exactly as on find.

  Security hardening shipped with it:

  - plugin-security: new FLS aggregate-INPUT gate — result masking never runs for
    `aggregate` (output rows carry only aliases), so any groupBy / aggregation
    reference to an FLS-unreadable field is now rejected fail-closed with the
    offending field names (mirrors the FLS write gate).
  - runtime: `aggregate` maps to the `list` ApiMethod in the object exposure gate
    (an object whose `apiMethods` whitelist excludes `list` cannot leak row
    statistics through GROUP BY), and the aggregate action requires at least one
    aggregation (the engine's in-memory path would otherwise degrade to raw rows
    that the FLS masker does not cover).

  The bridge seam is optional: a runtime that does not implement
  `McpDataBridge.aggregate` simply does not register the tool (graceful
  degradation, same contract as the action tools).

- f531a26: fix(security): exempt engine referential FK clears from the owner_id transfer guard (#3023)

  Follow-up to the #3004 ownership-anchor guard. `owner_id` is a lookup to `sys_user`
  with the default `deleteBehavior: 'set_null'`, so deleting a `sys_user` makes
  `cascadeDeleteRelations` null `owner_id` on every dependent row. That cascade write
  re-entered the write middleware under the deleter's context, where the #3004 guard
  read the `owner_id = null` as a user-initiated disown and denied it — aborting the
  cascade mid-way (no transaction, so partial state) for any deleter without the
  transfer grant on the child object (e.g. a member clearing a `public_read_write`
  child that RLS would otherwise have allowed).

  The cascade FK clear is engine-mandated referential integrity consequent to an
  already-authorized parent delete, not a user ownership change. `cascadeDeleteRelations`
  now tags the `set_null` write with a server-derived `__referentialFieldClear` context
  marker (set by the engine, never built from a request — same trust model as
  `__expandRead`), and the ownership-anchor guard skips when that marker is present.
  Ordinary user writes are unaffected; the marker cannot be forged from client input,
  so it can never slip a real ownership transfer past the guard.

- f531a26: fix(security): guard the `owner_id` ownership anchor and scope bulk writes to owner-visible rows (#3004, #2982)

  Two write-path holes on the row-ownership anchor (`owner_id`), the column OWD
  row-level scoping keys off to decide who may update/delete a record.

  - **#3004 — client-writable, unguarded `owner_id`.** The anchor is deliberately
    not `readonly` (ownership is transferable), so the static-readonly strip never
    covered it and FLS doesn't gate it by default. A non-privileged writer could
    therefore `insert` a record under someone else's name (forge) or `update` one
    to a new owner (transfer / disown), evading the owner gate that governs
    update/delete. The security middleware (plugin-security step 3.5) now treats
    `owner_id` as system-managed for non-privileged writers: on insert an empty
    value is auto-stamped to the acting user (batch rows too — previously only the
    single-record path stamped, leaving bulk-inserted rows NULL-owned and
    invisible to their creator), and a supplied foreign owner is denied; on update
    a supplied `owner_id` is a transfer/disown and is denied — the unchanged no-op
    echo of a form save is tolerated via a pre-image compare, and a bulk
    change-set carrying `owner_id` fails closed. A non-scalar `owner_id`
    (array/object) is rejected outright rather than string-coerced, and the
    change-set membership test uses own-property semantics so a polluted
    prototype cannot spoof an ownership write. Both require the transfer grant
    (`allowTransfer`, or `modifyAllRecords` which implies it) to proceed. System
    context (`ctx.isSystem`) stays fully exempt (OAuth provisioning / cron
    snapshots / seed claims / migrations), and under delegation both principals
    must hold the grant (ADR-0090 D10 intersection). Note a REST **import** runs
    under the importer's own context (not `isSystem`), so a non-privileged user
    importing a CSV whose `owner_id` column names other users is correctly denied
    unless they hold the transfer grant — administrators (who carry
    `modifyAllRecords`) are unaffected.

  - **#2982 — bulk writes skipped owner scoping on OWD-`private` objects.** A
    `update({ multi: true })` / bulk delete rebuilt the driver AST from
    `options.where` AFTER the middleware chain, discarding the owner/RLS write
    filter that plugin-sharing (`buildWriteFilter`) and plugin-security compose
    onto `opCtx.ast` — so a member's bulk write hit every matching row, including
    peers'. The engine now seeds `opCtx.ast` from the caller's predicate BEFORE the
    chain (the same seam reads use) and hands the middleware-composed AST to
    `driver.updateMany` / `driver.deleteMany`, so bulk writes are constrained to the
    rows the caller may edit — matching single-id write behavior. `delete` now
    applies the same scalar-`id` guard `update` already had, so an id-list bulk
    delete (`where: { id: { $in: […] } }, multi: true`) is owner-scoped too, and
    both multi branches fail CLOSED (throw) rather than silently rebuilding an
    unscoped predicate if the row-scoping AST is ever absent.

    Consequences of routing bulk writes through the AST: the anti-oracle
    predicate guard now also applies to bulk `update`/`delete` (a bulk write
    filtering on an FLS-unreadable field is rejected, as reads already are), and a
    principal-less (no-`userId`, non-system) bulk write on an owner-scoped object
    now correctly affects zero rows instead of all of them.

  Proven end-to-end on the real showcase app
  (`packages/qa/dogfood/test/owner-anchor-and-bulk-writes.dogfood.test.ts`) and pinned
  in the ADR-0096 authz-conformance ledger (`ownership-anchor-guard`,
  `bulk-write-owner-scoping`).

- f531a26: fix(security): scope the bulk-write predicate guard to the caller's own filter, and dedupe pre-image reads (#3018 review follow-ups)

  Two hardening follow-ups from the #3018 adversarial review.

  **Predicate guard is now middleware-order-independent for writes.** #2982 made bulk
  `update`/`delete` carry an `opCtx.ast`, which brought them under the step-2.9
  anti-oracle predicate guard for the first time. That guard is documented to run
  against the _caller's own_ predicate — RLS / sharing filters legitimately reference
  fields the caller cannot read (e.g. `owner_id`). But for a bulk write it inspected
  `opCtx.ast.where`, which a sibling middleware (`plugin-sharing`) may have already had
  an `owner_id` owner-match composed into — and the two middlewares' registration order
  is not contractually guaranteed. On an object whose `owner_id` is FLS-hidden, that
  could 403 a legitimate bulk write purely because the injected filter named the field.
  The guard now inspects `opCtx.options.where` (the caller's untouched predicate) for
  `update`/`delete`, so it can never mistake an injected owner/RLS filter for a caller
  probe, independent of middleware order. Reads are unchanged (the read seed is the
  caller's query verbatim and the guard runs before this middleware's own injection).

  **Pre-image reads deduplicated.** The by-id "read the target row" pattern was inlined
  at ~5 gates with slightly divergent shapes; a single `readRowById` helper (fail-closed:
  missing engine / null id / thrown read → `null`, which always denies) now backs the
  provenance gates, and a memoized `getCallerPreImage` collapses the owner-anchor echo
  check (3.5) and the RLS `check` post-image (3.6) — which read the identical
  `(object, id, caller-context)` row — into one read per operation. No behavior change;
  the read shape can no longer drift across sites.

- f531a26: fix(security): public-form submissions can no longer forge server-managed anchors (#3022)

  The anonymous public-form surface (ADR-0056 Option A, `POST /forms/:slug/submit`)
  is authorized by the declaration-derived `publicFormGrant`, which short-circuits
  the security middleware BEFORE every write gate (CRUD, FLS, the owner anchor
  guard, the tenant CHECK). The only field-side defense was the route's
  declared-field allow-list — and a FormView with zero declared section fields
  fell back to merging the raw body wholesale, so an unauthenticated visitor
  could `POST owner_id=<victim>` (or `organization_id`, audit columns, `id`) and
  attach the record to another user or tenant — the #3004 insert-forge, with no
  credentials at all.

  Server-managed anchors are now enforced on this surface at BOTH layers, from a
  single shared definition (`PUBLIC_FORM_SERVER_MANAGED_FIELDS`, new in
  `@objectstack/spec/security`):

  - **Data layer (authoritative)** — the `publicFormGrant` branch in
    `@objectstack/plugin-security` strips `id` / `owner_id` / `organization_id` /
    `tenant_id` / audit columns / soft-delete state / `__search` from every row
    of a granted insert (batch included) before admitting the write, so the
    boundary holds no matter what any route lets through. Ownership stays NULL
    for object hooks / the first-admin bootstrap to assign, as for other
    anonymous-seeded rows.
  - **Route layer** — the submit allow-list excludes the same set
    unconditionally: an explicitly declared `owner_id` section field no longer
    passes, and the zero-declared-sections fallback keeps its documented
    all-fields behavior for business columns while refusing the managed set.
    The resolve route (`GET /forms/:slug`) drops the managed fields from the
    rendered sections and the embedded object schema so a form never collects a
    value the submit refuses, and `GET /forms/:slug/lookup/:field` refuses a
    `publicPicker` declared on a managed anchor (which would have opened
    anonymous `sys_user` search through `owner_id`).

  Authenticated writes are unaffected — this is the anonymous-surface rule only;
  `owner_id` transfer semantics for signed-in callers stay governed by the
  transfer grant (#3004 / PR #3018).

- f531a26: fix(security): enforce referenced-object RLS/FLS on $expand (#2850)

  `expandRelatedRecords` resolved lookup/master_detail/user references via the
  driver directly, so the referenced object's row- and field-level security never
  ran — any API/session caller who could read a base row could `?expand=` a
  foreign key and receive RLS-hidden rows and FLS-masked fields (tenant isolation
  was the only surviving boundary).

  The expand batch now routes through the engine's own `find`, so the security
  middleware applies the referenced object's RLS + FLS to the `id $in [...]` batch
  (one query per level, no N+1). The sub-read carries a server-set `__expandRead`
  marker: the middleware waives only the object-level CRUD / requiredPermissions
  gate for PUBLIC referenced objects (already broadly readable — avoids
  over-blocking common status/owner lookups), while PRIVATE referenced objects
  keep the full gate. Covers the list and single-record REST/protocol surfaces.

- f531a26: fix(plugin-security): stop clobbering admin-edited capability `scope` on boot (#2909 T3). `scope` is an admin-editable classification select on sys_capability, but the curated seeder refreshed it on every boot alongside label/description — silently reverting admin reclassifications. It is now seed-once: written on insert, never refreshed (a curated scope change in a new platform version requires a data migration; recorded in the ADR-0094 addendum).
- f531a26: fix(plugin-security): re-arm the sys_position system-row write gate after the A4 managed_by rename (#2926 ①). The gate's provenance map still keyed on the legacy `system`/`config` values while rows are now stamped (and boot-normalized to) `platform`/`package`, so platform/package-managed positions — including the `everyone`/`guest` audience anchors — could be physically deleted through the data API once their bindings were removed. The map now guards both the canonical and legacy vocabularies, and the misleading "no runtime path branches on legacy values" safety notes were corrected.
- f531a26: fix(plugin-security): bind the fallback permission set to the `everyone` anchor AFTER the anchor is seeded. The baseline auto-bind (ADR-0090 D5) ran earlier in `runBootstrap` than `bootstrapBuiltinRoles`, which creates the `everyone` position — so the `everyone` lookup returned nothing and the app's `isDefault` set was never bound, leaving a fresh deploy's `everyone` empty (personas silently degraded) and a redundant `sys_audience_binding_suggestion` filed for the same set. The auto-bind now runs after `bootstrapBuiltinRoles` and before `syncAudienceBindingSuggestions`, so the documented app-level auto-bind actually happens and the suggestion sync correctly skips the already-bound set.
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
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/formula@15.1.0

## 15.0.0

### Major Changes

- 0fcef9b: ADR-0095 D1: tenant isolation is now **Layer 0** — an independent, always-first,
  AND-composed filter (`tenant-layer.ts`), no longer a wildcard `tenant_isolation`
  RLS policy OR-merged with business RLS. The effective row filter is
  `Layer0(tenant) AND Layer1(business RLS)`; the two share no compiler, merge step,
  or bypass bit. The superuser bypass now exempts the tenant wall only as a Layer 0
  rule (platform-admin posture + object posture permits: private / platform-global
  / better-auth-managed), never via a business-RLS short-circuit.

  **BREAKING (multi-org `tenancy.mode = 'multi'` deployments only; `single` mode is
  inert and unchanged).** Retiring the OR-merged tenant policy resolves four
  behavior deltas, all toward stronger/correcter isolation:

  - **(a) Cross-tenant read leak closed.** A permissive business RLS policy (e.g.
    `status == 'public'`) no longer OR-widens tenant scope; a foreign-org row it
    matched is now invisible.
  - **(b) Member by-id writes narrow to owner-only.** The OR-merge silently widened
    `owner_only_writes` (`created_by == me`) back to org-wide, so a member could
    by-id update/delete _any_ record in their org. Writes are now owner-scoped as
    authored. **Migration:** if your deployment intentionally relied on members
    editing each other's records org-wide, grant an explicit per-object edit
    permission set (position-distributed) where that is wanted — the baseline
    `member_default` no longer permits it.
  - **(c) Global-catalog objects visible to members.** On a `tenancy.enabled:false`
    object, members were scoped by a phantom `organization_id` filter (a column
    such objects lack); Layer 0 correctly treats them as non-tenant, so the global
    catalog is visible.
  - **(e) No-active-org writes fail closed.** A write by a principal with no active
    organization on a tenant object is now denied (was owner-scoped only).

  `tenant_isolation` is retired from the seeded `organization_admin` /
  `member_default` / `viewer_readonly` sets; the `_self` / `_org` identity-table
  carve-outs and `owner_only_writes/deletes` are unchanged. Customized seeded sets
  keep their overlays (ADR-0094). The driver-level `applyTenantScope` seam is
  untouched. See ADR-0095 and framework#2936 (the `extractTargetField` `==` blind
  spot this exposes, tracked separately).

- 2ae78c6: fix(plugin-security): #2937 — Layer 0 insert post-image 租户检查（伪造 organization_id 的用户 insert 现被拒）

  **安全修复 + 行为变更（release-notes callout）。** 多组织模式(`tenancy.mode='multi'` +
  `@objectstack/organizations`)下，一个普通用户此前可以 `insert` 一条**伪造 `organization_id`**
  (指向别的租户)的业务记录并使其落进受害租户 —— Layer 0 的租户墙 AND-composed 到读 +
  update/delete 的 pre-image，但 insert 没有 pre-image、也不带 AST，从未被门控(ADR-0095 D1
  读侧 W1 的写侧未竟部分)。

  新增 SecurityPlugin 中间件步骤 3.7:对 insert 的 **post-image** 复用读侧同一套 Layer 0 决策
  (`computeInsertTenantCheckFilter` → `computeLayeredRlsFilter` 的 `layer0`)做校验 ——
  一个**显式提供**的 `organization_id` 必须等于调用者的活动组织,否则 fail-closed 拒绝。规则与
  读侧完全一致:单组织/隔离未激活、非租户对象(无 `organization_id` 列或 `tenancy.enabled:false`)、
  platform-admin 姿态豁免的对象均不适用;无活动组织的用户提供任意 org_id → 拒(deny sentinel)。

  **行为 delta(需注意):** 此前能成功的「带跨租户 `organization_id` 的用户级 insert」现被拒绝。
  **缺省(不提供 `organization_id`)的 insert 不受影响** —— 补全仍由 `@objectstack/organizations`
  的 auto-stamp 负责(职责分离,因此本检查与 auto-stamp 中间件的注册顺序无关)。系统上下文
  (`isSystem`,含 import 引擎 / 迁移 / 每-org seed replay·clone·orphan-claim 的 `SYSTEM_CTX`)
  在中间件入口即短路,合法的「代客设置 org_id」写路径**完全不受影响**。

  矩阵门:`authz-matrix-gate.test.ts` 新增 `[#2937] Layer 0 insert post-image tenant guard`
  八格(伪造异租户 → 拒、同租户 → 通过、缺省 → 放行、无活动组织 → 拒、platform-admin 私有对象豁免、
  public 业务对象不豁免、tenancy-disabled 对象不适用、单组织模式不检查)。授权一致性 ledger
  新增 `multi-tenant-insert-postimage` 行。配套 cloud `@objectstack/organizations` 的 auto-stamp
  权威覆盖(纵深防御)。Closes objectstack-ai/objectstack#2937。

- ef70521: fix(plugin-security): 堵跨租户 UPDATE 写 + org_admin 越 private 租户对象墙（security）

  **安全修复 + 行为变更（release-notes callout）。** 修复 security review 确认的两个租户墙授权漏洞，两者同在 `security-plugin.ts` / `tenant-layer.ts` 的写侧热路径。多组织模式（`tenancy.mode='multi'` + `@objectstack/organizations`）下生效。

  **Finding 1 [BLOCKER] — 经 UPDATE 重指 `organization_id` 的跨租户写。** #2937 的 Layer 0 insert post-image 检查（中间件 step 3.7）只管 insert。对称的 update 路径无人管：成员拥有 org A 的记录 R，对 R 发 by-id 或 bulk `update` 带 `{organization_id: 受害者 org B}`，即可把行**移动进任意租户**——auto-stamp（insert-only）、FLS、服务端未强制的 `readonly`、Layer 0 pre-image（只校验旧 org）、显式 RLS check 全部漏过。修法（Option B，最小面 + 与 insert 对称）：把 step 3.7 的 Layer 0 post-image 检查扩到 update，复用**同一套** Layer 0 决策（`computeWriteTenantCheckFilter` → `computeLayeredRlsFilter` 的 `layer0`）。一个**显式提供**的 `organization_id` 必须过 Layer 0（== 调用者活动组织），否则 fail-closed 拒绝——这令非平台用户上下文里 `organization_id` **事实不可变**（只有活动组织值能过，而 pre-image 已把目标锁在活动组织内，故重指到任何**其他**租户被拒）。缺省（不碰 org_id）的 update 不受影响；bulk update 的跨租户 change-set 也被堵。

  **Finding 2 [HIGH] — org_admin 在 private 租户对象上越租户墙。** Layer 0 跨租户豁免门此前用「持有 `viewAllRecords`/`modifyAllRecords`」判定。`organization_admin`（自动授给每个 org owner/admin）经其 `'*'` 通配持有这两个超级位，于是在 `access.default:'private'` 的**租户业务对象**上触发豁免 → 零过滤 → 读写所有租户的行。修法：把 Layer 0 豁免门从「超级位」收窄为**真正的平台管理员判定**（`hasPlatformAdminPosture`：持有平台专属能力 `manage_metadata`/`manage_platform_settings`/`studio.access`/`manage_users`，即 `admin_full_access` 携带而 `organization_admin` 刻意不给的那组）。超级位继续只驱动 Layer 1 业务 RLS 短路（TENANT_ADMIN 组织内见全行、无所有权收窄）。因新豁免是旧门的严格子集，只会**收窄**、绝不放宽（fail-safe）。

  **行为收窄（预期的安全收窄，需注意）：** org admin 不再在 private/platform-global/better-auth 的**租户**对象上越租户墙——它现在被 Layer 0 墙到自己的 org。真·平台管理员（`admin_full_access` + 平台 systemPermissions）仍豁免；better-auth 托管身份表 carve-out 不受影响（无 `organization_id` 列，Layer 0 本就 inert）。系统上下文（`isSystem`，含 import/迁移/seed 的合法跨组织移动）在中间件入口即短路，完全不受影响。

  **为何不用 `ctx.posture` 作豁免门：** B2 已把 `PLATFORM_ADMIN` posture 落进 `resolve-authz-context.ts` 的 `ctx.posture`，但该字段**未被 plumb 进** enforcement 中间件收到的 ExecutionContext（rest-server 与 runtime dispatcher 都丢弃了它），直接消费会静默 no-op。改用平台专属能力探针，读的是 enforcement 已用的同一套 permission sets，覆盖所有入口，且天然 fail-safe。

  矩阵门：`authz-matrix-gate.test.ts` 更新 `private_obj.org_admin` 格（read `null` → `{organization_id:'org-1'}`）并新增 `[Finding 1 …]`（8 格：成员重指异租户 → 拒、同租户 → 通过、不碰 org_id→ 放行、无活动组织 → 拒、org_admin 重指 → 拒、platform-admin private 对象 → 放行、public 对象 → 拒、单组织 → 不检查）与 `[Finding 2 …]`（5 格：org_admin private 对象读/写墙到本租户、真平台管理员仍豁免、org_admin public 对象回归、better-auth carve-out 不受影响）。授权一致性 ledger 更新 `multi-tenant-write-postimage`（覆盖 insert+update）并新增 `multi-tenant-exemption-posture`。关联 objectstack-ai/objectstack#2920。

### Minor Changes

- 5febe3f: feat(plugin-security): A4 — managed_by tri-state unification + listView exposure (#2920)

  Unifies the record-level provenance vocabulary across the three RBAC catalogs
  (`sys_capability`, `sys_permission_set`, `sys_position`) onto a single tri-state
  — **platform / package / admin** — so an administrator reads one vocabulary for
  "who owns this" everywhere.

  - **`sys_permission_set.managed_by`** and **`sys_position.managed_by`** converted
    from free `text` to a constrained `select` matching `sys_capability` (options
    `platform` / `package` / `admin`, `defaultValue: 'admin'`, `readonly`).
  - **Writers re-stamped to canonical vocab:** built-in identity/anchor positions
    now seed `managed_by: 'platform'` (was `'system'`); env/Studio-authored
    permission sets project as `managed_by: 'admin'` (was `'user'`). Declared
    package sets (`'package'`) and platform capabilities (`'platform'`) were
    already canonical.
  - **`sys_position` list views** (`active` / `default_positions` / `custom` /
    `all_positions`) now surface the `managed_by` column, matching the capability
    and permission-set views.
  - **Back-compat, no destructive migration.** No runtime path branches on the
    legacy values — every access decision keys on `'package'` / `'platform'`
    (both unchanged) — so the rename never changes an authorization outcome.
    Built-in positions and declared sets self-heal on their next bootstrap upsert;
    a new idempotent `kernel:ready` reconciler (`normalizeManagedByVocab`) rewrites
    the residual legacy values (`system`→`platform`, `config`→`package`,
    `user`→`admin`) on existing `sys_position` / `sys_permission_set` rows.
  - **i18n:** `managed_by` field + option labels (`platform` / `package` / `admin`)
    added for `sys_capability` / `sys_permission_set` / `sys_position` across
    en / zh-CN / ja-JP / es-ES.

  Pairs with objectui `feat(app-shell): A4 — provenance tri-state badge`
  (framework#2920).

- e62c233: feat(spec,plugin-security): package-level capability declaration API (ADR-0066 D1)

  Packages can now DEFINE their own authorization capabilities explicitly via the
  new `defineCapability` factory and a stack's `capabilities` array, instead of
  relying on the implicit "derive an untitled capability from whatever a permission
  set references in `systemPermissions[]`" back-door.

  - `@objectstack/spec`: new `defineCapability` / `CapabilityDeclarationSchema`
    (`{ name, label?, description?, scope, packageId? }`) and a `capabilities`
    field on the stack definition.
  - `@objectstack/plugin-security`: new `bootstrapDeclaredCapabilities` seeds
    declared capabilities into `sys_capability` with `managed_by:'package'` +
    `package_id` provenance (new `package_id` field on the object). Idempotent,
    upgrade-aware; refuses to hijack curated platform capabilities or another
    package's rows, never clobbers admin-authored rows, and CLAIMS a pre-existing
    derived placeholder (upgrading it to package provenance). The implicit
    derive-from-`systemPermissions` path still runs for back-compat but now skips
    any explicitly-declared name so it can't clobber authored metadata.
  - `@objectstack/runtime`: stack-declared `capabilities` are registered into the
    metadata registry (type `capability`) so the boot seeder can read them.
  - `@objectstack/lint`: `validateCapabilityReferences` treats
    `stack.capabilities` names as a known capability source.

  A capability is not a contract: DEFINE it (`defineCapability`), GRANT it
  (`systemPermissions`), REQUIRE it (`requiredPermissions`) — no `inputs`.
  Aligns with ADR-0094 D5 (retire implicit `managed_by`-guessing back-doors).

- a581a65: feat(plugin-security): C2-β — explain 引擎 record 粒度行级归因 (#2920)

  `explain(principal, object, operation, recordId?)` 现支持记录级解释。透传 `recordId` 时，引擎在对象级流水线之上叠加**行级归因**，全部复用 enforcement 同一批函数（explained-by-construction）：

  - **`tenant_isolation` Layer 0**：作为永远最先的层被 prepend；每层打上 `kernelTier`（`layer_0_tenant` vs `layer_1_business`），可区分「租户墙挡的」还是「业务 RLS 挡的」。
  - **每层 `record` 归因**（tenant / owd_baseline / sharing / rls）：`outcome`（admitted/excluded/not_evaluated）、有效 `rowFilter`、`matchesRecord`（用 `@objectstack/formula` 的 `matchesFilterCondition` 对同一条 FilterCondition 求值)、命中的 `rules[]`（tenant_filter/owd_baseline/ownership/record_share/sharing_rule/team/rls_policy，含 grants/via/effect）。
  - **顶层 `record` 判定**：`visible` + `decidedBy` 决定性层。读走复合行过滤匹配，写走 sharing service 的 `canEdit`（均为 enforcement 原语）。
  - **`principal.posture`**：ADR-0095 D2 档位（PLATFORM_ADMIN/TENANT_ADMIN/MEMBER/EXTERNAL）的 B2 stand-in 派生（复用 `resolveAuthzContext` 已投影的 platform_admin / org 角色证据），待 B2 合并后替换。
  - `computeRlsFilter` 重构为 `computeLayeredRlsFilter`（暴露 `{ layer0, layer1 }` 拆分）+ 薄 andCompose 包装，单一代码路径，行级归因不会与执行漂移。
  - REST `security.explain`（GET/POST）接受可选 `recordId`。

  **向后兼容**:无 `recordId` 的对象级请求输出 **byte-identical**——无 `tenant_isolation` 层、无 `kernelTier`、无 `posture`、无 `record`。

### Patch Changes

- ca2b2f6: fix(plugin-security): #2936 — RLS field-existence / tenancy-disabled safety nets now recognize canonical `==`

  `extractTargetField` (the lightweight left-hand-field parser feeding the Layer 1
  **field-existence** net and the **tenancy-disabled** skip net in
  `computeLayeredRlsFilter`) only matched the legacy single-`=` / `IN` shape. It
  returned `null` for canonical CEL `==` (`field == …`), which is how real seeds
  and business policies author equality. A `null` target field means "keep the
  policy", so both safety nets were **inert** for every `==` policy: a wildcard
  policy targeting a column the object lacks was NOT failed closed, and a
  `==`-form `organization_id` policy on a `tenancy.enabled:false` object was NOT
  skipped. The regex now recognizes `==` (listed before `=` so the ordered
  alternation does not mis-match the first `=`), alongside the existing `=`/`IN`.
  Recognition is only **extended** — the net semantics are unchanged, and
  `!=`/`>`/`<`/`>=`/`<=` still return `null` (conservative keep), matching prior
  behavior for any unmatched shape.

  Behavior delta (fail-closed strengthening, same effective visibility): the
  wildcard `owner_only_writes` / `owner_only_deletes` seed policies
  (`created_by == current_user.id`) now correctly fail closed on an object that
  lacks a `created_by` column (platform-global / system tables). Previously they
  slipped the net and compiled to a phantom `{ created_by: … }` filter against a
  missing column — a driver-dependent, effectively-deny result; now the net drops
  the sole applicable write policy and yields the deny sentinel. A member could not
  by-id write such a column-less object either way, so the visible/writable row set
  is unchanged; only the mechanism is now an explicit fail-closed deny. All ordinary
  tenant/business objects carry `created_by`, so they are unaffected (proven green by
  the dogfood authz-conformance + RLS matrices). The tenancy-disabled skip net has no
  effect on any current seed (no `==` seed policy targets `organization_id` on a
  tenancy-disabled object). The tenant wall itself is Layer 0 (`tenant-layer.ts`),
  which never used this parser, so tenant isolation is unaffected (ADR-0095 D1).

- 698454e: Security fix: constrain self-delegation (D3) position anchor to prevent lateral
  visibility escalation (cloud#830 follow-up).

  cloud#830 (C1 position-anchor) made `sys_user_position.business_unit_id`
  visibility **load-bearing** — it is the readScope depth anchor, so a
  `unit`/`unit_and_below` holder sees the owner set rooted at that BU (and, for
  `unit_and_below`, its whole subtree). The delegated-admin gate's self-service
  delegation path (`assertSelfDelegation`) stamped this anchor with **no
  subtree/source constraint**: a holder of a delegatable, non-admin-scope position
  anchored at a LOW business unit could delegate it to a co-conspirator with an
  **ancestor / arbitrary-high** anchor, leaking that BU's whole subtree of member
  records — visibility beyond the delegator's own range. Mutual delegation could
  grant it both ways.

  The gate now requires a self-delegated `business_unit_id` to fall inside the
  delegator's **own effective anchor** for that position (the subtree of their own
  direct holding's anchor, or of their member BU when the holding is unanchored) —
  the same "assignments must target your subtree" spirit as the D12
  delegated-admin boundary. Fail-closed: an anchor that cannot be proven inside the
  delegator's range is rejected. Unanchored delegation rows keep prior behavior
  (the delegate resolves to their own member BU — not a widening). The
  "anchoring only narrows, never widens" invariant now holds on the D3 path too.

- 29a4c90: fix(plugin-security): explain posture 证据对齐 enforcement 派生（消除标签漂移）

  Security review 低危项。explain-engine 的 `derivePosture(context)` 之前用**松名字匹配**作
  posture 证据——`permissions.includes(ADMIN_FULL_ACCESS)`（不校验非作用域）+ `positions.includes(
'org_owner'/'org_admin')`（读 better-auth 角色），比 enforcement（`resolve-authz-context.ts` 的
  `hasPlatformAdminGrant`：要求**非作用域 admin_full_access user grant**；TENANT_ADMIN 用
  `organization_admin` **能力**而非角色）更松，可能让 explain 面板给运维显示**偏高**的 posture 标签
  （作用域 org-admin grant 被误标 PLATFORM/TENANT_ADMIN）。

  修法——让 explain 的 posture 走 enforcement 已用的同一份证据：

  - **优先直接消费 `ctx.posture`**：principal 经完整 `resolveAuthzContext` 时已带 enforcement 派生的
    rung，逐字返回 → 结构上不可能漂移。
  - **回退（explain 用 `buildContextForUser` 自建 context，不经完整 resolveAuthzContext）**：复制
    enforcement 的非作用域 grant 判定——`buildContextForUser` 现按与 `hasPlatformAdminGrant` 逐字节
    一致的规则（`admin_full_access` 且 `organization_id == null` 的 active user grant）计算并挂出
    `hasPlatformAdminGrant`；`derivePosture` 以此 + 投影出的 `platform_admin` 内建岗位判 PLATFORM_ADMIN，
    以 `organization_admin` **能力**判 TENANT_ADMIN，**不再**读 `org_owner`/`org_admin` 角色岗位
    （ADR-0095 D3：角色只是 provisioning 来源，非裁决输入 — explain 侧同样闭合 #2836 dual-track）。
  - 保留 explain 特有的 **guest → EXTERNAL** 底（enforcement floor 是 MEMBER），且置于最前。

  只改 explain 的 **posture 标签**证据，不改 explain 的 allow/deny verdict（来自复用的 enforcement
  filter），不改 enforcement。#2947 跟踪的「posture 未 plumb 进 enforcement context」更广缺口不在本
  任务范围。关联 #2920。

- 5774a75: 内置行写护栏：`sys_position` / `sys_capability` 的平台/应用托管行不再可被客户管理员删改。

  `sys_permission_set` 早有两道门写护栏（`assertPackageManagedWriteGate`）拦截对 package 托管行的写入，但 `sys_position` / `sys_capability` 缺失对应保护——平台/应用发布的系统岗位与能力（provenance 记录在 `managed_by`）可被管理员直接 delete / update 直达驱动，静默破坏应用的授权基线（ADR-0049：provenance 字段存在却无强制 = 正是要补的 enforcement gap）。

  新增 **`assertSystemRowWriteGate`**（`packages/plugins/plugin-security/src/security-plugin.ts`，data-write hook 接线与 package 门同处），对这两个对象的托管行施加一道无条件的数据层边界：

  - **禁止伪造托管来源**：管理员门的 insert / update 载荷（单对象或数组）不得把 `managed_by` 盖成平台/应用值——只有携带 `isSystem` 的平台 seeder / 包发布路径可写；同时封堵 update-to-forge（把自建行改 badge 成托管行）。
  - **拒绝改删托管行**：对 `managed_by` 已是平台/应用值的行，`delete` / `update` / `transfer` / `restore` / `purge` 一律拒绝。与 `sys_permission_set` 不同，这两个对象没有 ADR-0094 overlay write-through，故写护栏必须在此层直接拒绝，而非下放给下游翻译。
  - **管理员自建行不受限**：`managed_by` 为 `user`/∅（sys_position）或 `admin`（sys_capability）的行完全归管理员所有（含委派管理员在自己 subtree 内的自建行）。

  护栏 fail-closed 且不依赖调用方授权——持 `modifyAllRecords` 的超管也无法删除平台岗位。两对象的 `managed_by` 词表不同（sys_position：`system`/`config` 托管，`user`/∅ 自建；sys_capability：`platform`/`package` 托管，`admin` 自建），网关按对象分别判定。错误信息仅含业务文案（"此岗位/能力由 平台|应用包 提供，不可删除/修改"）。

  与 delegated-admin 边界不冲突：`GOVERNED_OBJECTS` 本就不含这两个对象，委派管理仍治理 RBAC 链接表而非定义对象。

- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/formula@15.0.0

## 14.8.0

### Minor Changes

- f0acf25: Surface a `customized` flag on `sys_permission_set` so Setup can tell — at a glance — which packaged permission sets have an environment overlay (ADR-0094).

  - The env projector stamps `customized: true` on a `managed_by:'package'` row while an overlay shadows its shipped baseline, and clears it when the overlay is removed (the data-door "reset"). Env-authored rows are never flagged (an env set is the definition, not a customization of one).
  - The new read-only boolean field is added to `sys_permission_set` and to the "All" Setup list view (alongside `managed_by`), so a packaged-but-customized set is visible without opening the Studio layered diff.

- 712328a: Package-owned permission sets are now customizable through the standard environment metadata overlay (ADR-0094 D5, revised — closes framework#2898 by making the overlay FIRST-CLASS instead of rejecting it).

  - An env-scope `saveMetaItem('permission', …)` on a package-owned set is a real customization: the awaited projector applies the effective (overlay-wins) body to the `sys_permission_set` record while preserving its `managed_by:'package'` + `package_id` provenance, and the evaluator enforces it.
  - A data-door edit of a packaged set (Setup PATCH) is translated into exactly that overlay — no more flat 403; a data-door "delete" removes the overlay and RESETS the record to the shipped declaration (the row survives).
  - The ADR-0086 two-doors data gate narrows to what stays structurally true: forging package provenance through the admin door remains refused, as do the lifecycle ops with no overlay translation (`transfer`/`restore`/`purge`) on package rows; kernels without a metadata overlay layer keep the legacy full refusal.
  - Cross-package roles compose via positions (bind several packages' sets); overlays narrow. Rationale: rejecting the overlay would make `permission` the one type whose declared `allowOrgOverride: true` is a lie, and clone-to-customize forks away from vendor baseline updates.

  Note the standard overlay trade, now applicable to permission sets: while an overlay pins a set, later vendor baseline changes (including tightenings) don't take effect for that name until the overlay is reset or re-authored — surfaced by the Studio layered diff and covered by ADR-0091 recertification.

  Also lands a dogfood proof (`showcase-permission-projection`) covering the full ADR-0094 invariant set — write-through, awaited projection, declared-set edit becomes an enforced overlay, package-set customize/reset lifecycle — registered in the liveness proof registry.

- 1dede32: Make the `sys_permission_set` data record a pure projection of the metadata layer (ADR-0094; framework#2875) — one authoritative store for permission-set definitions, retiring the two-store split-brain behind the #2857 display-freshness class.

  - **`@objectstack/metadata-protocol`**: new `registerMutationProjector(type, fn)` — an awaited, best-effort per-type hook invoked after persistence inside `saveMetaItem` / `publishMetaItem` / `deleteMetaItem`, so a derived data-plane read-model is already consistent when the write returns (outcome surfaced as `projectionApplied` on the response). Complements the fire-and-forget `onMetadataMutation` listeners.
  - **`@objectstack/plugin-security`**: every non-system data-door write on `sys_permission_set` (Setup CRUD, bulk imports, any ObjectQL path) is redirected into the metadata store by an engine middleware; the record is written only by the projector. Boot reconciliation projects env overlays onto records (Studio-created sets now appear in Setup), backfills legacy data-door-only records into metadata once, and re-projects drifted records from the effective body (metadata wins). The projector also syncs the metadata manager's in-memory `permission` entry, so evaluator resolution and the Setup display can no longer disagree.

  Behavior changes: "deleting" an artifact-backed permission set through the data door now resets it to its declared body instead of removing the row; renaming a set through the data door is rejected (`400`) — clone to a new name instead; record edits that predate this change and are shadowed by a metadata definition are discarded (loud warning) at first boot, since they were never enforced.

  Moved exports (from `@objectstack/plugin-security`): `upsertEnvPermissionSet` now lives in `permission-set-projection.js` (still re-exported from the package root) and **creates** missing records; `projectEnvPermissionOnMutation` / `subscribeEnvPermissionProjection` are replaced by `projectPermissionMutation` / `registerPermissionSetProjection`.

### Patch Changes

- a199626: `claimSeedOwnership` now skips **external (federated) objects** — those with an `external` remote-table binding (ADR-0015) — the same way it already skips `managedBy` and `sys_*` objects.

  The seed-ownership backfill walks every registered object that exposes an `owner_id` column and re-owns its unowned rows to the first admin. Federated objects get `owner_id` auto-injected into their schema, so they passed the filter and the backfill issued `select id from <remote_table> where owner_id is null` against a read-only remote datasource whose table may not be provisioned yet at boot — producing startup errors like `Find operation failed … no such table: customers`. External objects are read-only (DDL forbidden, writes double-opt-in) and their ownership is not the platform's to reassign, so they are excluded from the scan entirely.

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/formula@14.8.0

## 14.7.0

### Patch Changes

- 824a395: Tenancy mode as a first-class capability + a single owner for the user→membership
  lifecycle (ADR-0093, Phases 1–3).

  **Tenancy service (`@objectstack/types`, `@objectstack/plugin-auth`).** plugin-auth
  registers a `tenancy` service — the single source of truth for tenancy mode
  (`mode`, `isolationActive`, `requested`, `degraded`, `defaultOrgId()`). It derives
  `isolationActive` from the presence of the `org-scoping` service, so the
  enterprise `@objectstack/organizations` package lights it up with no change.
  SecurityPlugin's RLS-strip gate and `/auth/config` (`features.multiOrgEnabled`,
  new `features.degradedTenancy`) now consume it instead of re-deriving the fact.

  **Fail-fast on degraded tenancy (`@objectstack/cli`, ADR-0093 D5).**
  `OS_MULTI_ORG_ENABLED=true` without a working `@objectstack/organizations` now
  **refuses to boot** — a deployment that requested tenant isolation must not serve
  traffic without it (tenant RLS would be silently stripped). Escape hatch:
  `OS_ALLOW_DEGRADED_TENANCY=1` boots in an explicitly branded degraded state
  (`features.degradedTenancy`). **This may halt upgrades for deployments that were
  silently degraded — intentionally; install the enterprise package or set the
  escape hatch.**

  **Membership reconciler (`@objectstack/plugin-auth`, ADR-0093 D1–D3, D6).** A
  single reconciler composed into better-auth's `user.create.after` hook owns the
  "every new user gets a membership" invariant across all creation paths (signup,
  admin create-user, import, SSO JIT). It yields to any existing membership (host
  hooks win), honors a new `membershipPolicy: 'auto' | 'invite-only'` auth option
  (default `auto`), and binds only to an unambiguous target org (single-org default;
  multi-org binds nothing). A bounded, idempotent `kernel:ready` backfill covers
  pre-existing member-less users in single-org/auto deployments
  (`OS_SKIP_MEMBERSHIP_BACKFILL=1` to opt out). The endpoint-level create-user bind
  from #2882 now delegates to this shared reconciler.

  New env vars: `OS_ALLOW_DEGRADED_TENANCY`, `OS_SKIP_MEMBERSHIP_BACKFILL`. New docs:
  Deployment → Tenancy Modes & Membership.

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/formula@14.7.0
  - @objectstack/platform-objects@14.7.0

## 14.6.0

### Patch Changes

- 6e2b8ae: **Project env-scope permission-set edits onto the `sys_permission_set` record (#2857).**

  A `sys_permission_set` has two representations: the authoritative **metadata** the
  structured editor writes, and the queryable **data record** (snake_case
  JSON-string columns) the admin/Setup surface reads. The metadata→record
  projection (`toRowFields` / `upsertPackagePermissionSet`) ran only at **boot** and
  on **publish** (package door), and the publish path refuses env-authored rows —
  so an environment-scope `save('permission', …)` updated the `sys_metadata`
  overlay (and the layered read) but left the `sys_permission_set` record **stale**
  (split-brain). Enforcement reads the authoritative metadata so access stayed
  correct, but the admin surface showed old values.

  Adds the **environment door**: `subscribeEnvPermissionProjection` hooks the
  protocol's post-persistence `onMetadataMutation` choke point; on an active
  (non-draft) `permission` save it re-reads the fresh effective body via the
  layered read (the boot-cached metadata registry would return a stale declared
  body) and `upsertEnvPermissionSet` projects the six facets onto the record.
  Ownership is decided by the **record's** `managed_by` — env-authored rows
  (platform/user/absent) are projected; a package-owned record's baseline is left
  to boot re-seed / publish, so the two doors never fight. Mirrors the existing
  `authored-translation-sync` mutation-listener pattern.

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/formula@14.6.0

## 14.5.0

### Minor Changes

- f70eb2c: ADR-0090 D10 — agent/service intersection runtime. When a request's principal acts `onBehalfOf` a user (an AI agent or a service acting for a person), the effective permission is now the INTERSECTION of the principal's own grants and the delegator's grants — never the union. Confused-deputy prevention: an over-privileged agent may never see or touch anything the user it stands in for could not, and vice-versa. Previously `principalKind:'agent'` / `onBehalfOf` was a P1 context shape the evaluator did not read.

  The intersection is applied at EVERY axis, gated on the presence of the delegation link so the ordinary (non-delegated) path is byte-identical:

  - **plugin-security** middleware — the delegator's effective permission sets are reconstructed once (fail-CLOSED if the delegator no longer exists — a dangling link is denied, not resolved to the additive baseline) and AND-composed into: the required-capability gate, object CRUD, field-level security (read mask + write forbid + predicate-oracle guard), the row-level `using` pre-image on by-id writes, the `check` post-image, and the RLS read-filter injection. View/Modify-All only survives when BOTH principals hold it.
  - **plugin-sharing** middleware — the OWD/record-sharing owner-match is IDENTITY-scoped, so it re-runs the visibility filter (and `canEdit`) under the delegator's own identity + depth and AND-s it in. An agent with View-All acting on behalf of a plain member therefore sees exactly that member's own rows — not everyone's, and not nothing.
  - **explain engine** — every layer reports the narrower verdict when `onBehalfOf` is set, so the D6 access explanation stays truthful for delegated principals; a dangling delegator is reported as a fail-closed deny.

  First-cut scope (documented in code + covered by tests): one delegation hop (the `onBehalfOf` shape carries a single delegator, and any single-hop intersection is a safe lower bound on a true multi-hop chain); tenant-scoped substitution bags (`tenantId`, `org_user_ids`, `email`) are inherited from the live principal, while person-specific membership bags left unresolved narrow rather than widen. The agent grant-ceiling lint (D10 rule 2) is a follow-up — the runtime intersection already caps the agent regardless of what its own sets carry, and a lint needs an agent-set designation convention that does not yet exist.

- d79ca07: ADR-0090 D10 — activate the agent principal (OAuth → `principalKind:'agent'` + scope-derived ceiling). This wires the _producer_ side of the D10 intersection that shipped in #2838, so it stops being dormant: an MCP request authenticated with an OAuth access token is now resolved as an AI **agent acting on behalf of** the human `sub`, and its effective permission is the intersection of a scope-derived capability ceiling AND the user's own grants.

  - **`resolve-execution-context` (producer)**: when a verified MCP OAuth token names an authorized client (`azp`), the request resolves to `principalKind:'agent'` with `onBehalfOf:{ userId }` (the human), and the agent's OWN grants are replaced by the scope-derived ceiling — `data:read` → read-only, `data:write` → full CRUD, neither → no data access. `userId` stays the human so owner-stamping and `current_user.*` RLS resolve to them; the user-derived `systemPermissions` are cleared so a cap-gated action can't ride the user's capabilities. A token without a client stays a `human` principal.
  - **`plugin-security`**: three built-in ceiling sets (`mcp_agent_data_read` / `mcp_agent_data_write` / `mcp_agent_restricted`) — pure CRUD bits, no row-level security (all row/owner/tenant narrowing comes from the delegating user on the other side of the intersection). An `agent` principal skips the additive human baseline (`member_default`) — its grants are exactly its ceiling — and its fallback is the restricted (no-object-access) set, so a mis-resolved agent fails CLOSED, never open.
  - **`spec`**: `MCP_AGENT_PERMISSION_SET_*` names + `scopesToAgentPermissionSets()`, single-sourced next to the OAuth scope constants.

  **Behaviour change (a security tightening).** Previously an MCP OAuth request executed with the FULL authority of the logged-in user, and scopes narrowed only the tool surface. Now the scope is also a real data-layer ceiling: a `data:read` token can never write ANY record, even via a crafted call, no matter what the user could do. This is strictly consistent with the existing contract that "a scope can never grant more than the user could do" — the intersection only ever narrows — and closes the gap where a compromised or confused agent could act with the user's full reach.

  Verified end-to-end: a `data:read` agent acting for a member who owns a record can read it but cannot edit or create; a `data:write` agent for the same user can. Producer mapping unit-tested in `@objectstack/runtime`; enforcement dogfooded against the served engine (`showcase-agent-scope-ceiling`).

### Patch Changes

- c044f08: **Security fix (Critical): the settings HTTP routes no longer trust spoofable identity headers, and writes are now capability-gated.**

  Previously `GET/PUT/POST /api/settings/*` derived the caller's identity from `x-user-id` / `x-tenant-id` / `x-permissions` request headers (the route default), and `setMany` performed **no permission check** — so on a standard `os serve --server` deployment (settings + HTTP server composed by default, routes registered on the raw app with no auth middleware) an **unauthenticated** remote client could write tenant- or platform-scoped settings (including the auth security-policy, localization, and company manifests) and enumerate every namespace.

  Fixes:

  - **Verified identity.** `SettingsServicePlugin` now derives the caller's identity and capabilities from the platform's verified resolution (`resolveAuthzContext` — session cookie / API key / OAuth), never from request headers. The route default is now SECURE: it trusts no identity header and yields an anonymous, denied context.
  - **Capability gates.** Manifest `readPermission` / `writePermission` are enforced for HTTP callers: reads of a protected namespace, writes, and actions require the declared capability (writes default to at least the read capability, never ungated). Enforced via a new `enforced` flag set only at the HTTP boundary — **in-process/boot callers (`kernel.getService('settings')`, seed) are unchanged** and keep full trusted access.
  - Unauthenticated HTTP callers can no longer enumerate protected manifests or write; a `403 SETTINGS_FORBIDDEN` is returned when the capability is missing.

  **`setup.write` capability now real.** Enforcing the manifests' declared `writePermission` surfaced a modeling gap: `setup.write` (the write counterpart to `setup.access`, used by the branding / company / localization / feature-flag manifests) was referenced but never declared or granted — so under enforcement _nobody_, not even an admin, could write those namespaces. It is now a declared platform capability (`PLATFORM_CAPABILITIES`) held by `admin_full_access` and `organization_admin`, alongside `setup.access`.

  **Behaviour change:** a deployment that relied on the old header-trusted default must present a real verified session/API-key/OAuth credential (which the console already does). A custom integration may still inject its own `contextFromRequest`.

  Found by an adversarial security review of the request→ExecutionContext trust boundary.

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
- Updated dependencies [8f23746]
- Updated dependencies [b97af7e]
- Updated dependencies [6da03ee]
  - @objectstack/spec@14.5.0
  - @objectstack/platform-objects@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/formula@14.5.0

## 14.4.0

### Minor Changes

- 82e745e: ADR-0091 L1 — grant validity windows: effective-dated assignments, resolution-time filtering, explain expired state, authoring lint.

  - **plugin-security (objects)**: `sys_user_position` and `sys_user_permission_set` gain the D1 lifecycle columns — `valid_from`, `valid_until` (half-open `[from, until)`, UTC; null = unbounded, existing rows unchanged), `reason`, `delegated_from`, `last_certified_at`, `certified_by`.
  - **core**: new shared predicate `isGrantActive` / `isGrantExpired` (`@objectstack/core`), and `resolveAuthzContext` now filters BOTH grant tables through it (D2, fail-closed — an expired unscoped `admin_full_access` grant no longer derives `platform_admin`). Present-but-unparseable bounds fail closed.
  - **plugin-security (explain)**: `buildContextForUser` applies the same filter and returns `expiredGrants`; the principal layer reports the dedicated "held until … — expired" contributor state so "why did access disappear" is self-answering. Spec `ExplainLayerSchema` contributors gain an optional `state: 'active' | 'expired'`.
  - **plugin-sharing**: `PositionGraphService.expandPositionUsers` filters expired holders — sharing-rule recipients stop including them at resolution time.
  - **lint (D7)**: two new error rules over seed data — `security-grant-expired-at-authoring` (a `valid_until` in the past, or unparseable, is a grant that can never resolve) and `security-delegation-missing-reason` (a `delegated_from` row without `reason` breaks the D3 dual audit). Also re-exported the missing `SECURITY_MASTER_DETAIL_UNGRANTED` constant.

  No background job is involved anywhere — per ADR-0049, an expired grant simply stops resolving, in every edition.

- f3035bd: ADR-0091 L2 — delegation of duty (职务代理): self-service, time-boxed position delegation without administration.

  - **spec**: `PositionSchema.delegatable` (default false) + the `sys_position.delegatable` field. A position opts in to being self-service delegated.
  - **plugin-security (D12 gate)**: a new self-service branch — a non-admin holder of a `delegatable` position may insert a `sys_user_position` row assigning it to a delegate, WITHOUT any `adminScope`, iff the row is a well-formed delegation: `delegated_from` = the writer (you delegate your OWN authority), a mandatory `valid_until` in the future and within the 30-day ceiling, a mandatory `reason`, and the writer holds the position **directly** (validity-filtered — a grant that itself arrived via delegation is not re-delegatable). Insert-only, so a delegation is not self-renewable. A `delegatable` position that distributes an `adminScope`-carrying set is rejected fail-closed — administration is never self-delegated (D12 containment). Dual audit: `granted_by` (writer) + `delegated_from` (authority source).
  - **plugin-security (explain)**: `buildContextForUser` surfaces delegation provenance; the principal layer attributes a delegated position "via delegation from X, until Y".
  - **liveness / proof (ADR-0054)**: `position.delegatable` is a bound high-risk class with an end-to-end dogfood proof (`delegation-of-duty`) — a gated delegation write over the real HTTP API, then the delegate's grant resolving in-window and dying at `valid_until` via the real resolver.

  Break-glass activation and recertification campaigns stay enterprise (D7); their community shapes are the L1 substrate.

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/formula@14.4.0

## 14.3.0

### Minor Changes

- 02f6af4: ADR-0090 follow-through wave: enforce book audience at the read layer; finish the D2/D3 cleanup the P1 rename missed.

  - **rest**: `/meta/book`, `/meta/doc`, and `/meta/book/:name/tree` now ENFORCE
    the ADR-0046 §6.7 audience model (ADR-0049 — no unenforced security
    properties): anonymous callers see only `public` books/docs;
    `{ permissionSet }`-gated books require the caller to hold the named set;
    a doc's effective audience is the union over the books that CLAIM it
    (unclaimed docs default to `org`; orphan rendering never inherits `public`).
    Gated evaluation fails CLOSED when holdings cannot be resolved. `doc`/`book`
    single-item reads bypass the shared meta cache (per-caller gate vs shared ETag).
  - **spec**: new pure helpers powering that gate — `audienceAllows`,
    `resolveDocAudiences`, `docAudienceAllows`, `resolveBookClaimedDocs`
    (+ `AudienceCaller`/`AudienceBook` types). BREAKING but ships as a `minor`
    per the launch-window convention (pre-1.0 semantics — breaking changes do
    not burn a major version number while the whole stack is in lockstep):
    `METADATA_FORM_REGISTRY` keys `role`/`profile` are gone — `position` is the
    registered form (the `position` type had LOST its form layout in the P1
    rename); `EnvironmentArtifactMetadataSchema` declares `positions` instead of
    retired `roles`/`profiles`.
  - **plugin-security**: the `security` service exposes
    `resolvePermissionSetNames(ctx)` — the same resolution as data-plane
    enforcement, for the docs gate.
  - **metadata**: artifact ingestion maps `positions → 'position'` (the stale
    `roles → 'role'` mapping matched nothing since the P1 rename, silently
    dropping compiled positions from metadata registration).
  - **lint**: books join the D3 role-word scan (their `audience` is a
    permission-model reference now), and a new advisory rule
    `security-book-audience-unknown-set` flags a `{ permissionSet }` audience
    naming a set the stack does not declare (runtime fails closed — the typo
    cost is "nobody can read the book", so say it at author time).
  - **platform-objects**: metadata-form translations regain `position` (all four
    locales) and drop the retired `role`/`profile` groups, with a vocabulary
    regression test.

- 8f0b9df: fix(cli,plugin-security): `os meta resync` to re-materialize default permission sets from dist (#2705)

  The default permission sets (`admin_full_access` / `member_default` /
  `viewer_readonly` …) were seeded **insert-once** at boot: `bootstrapPlatformAdmin`
  skipped any row that already existed and never wrote the shipped declaration
  back. So editing a default set's source, recompiling, and restarting `os dev`
  **without** `--fresh` left the runtime serving the OLD value — silently, because
  the runtime authz resolver hydrates permission sets from the `sys_permission_set`
  row (`resolve-authz-context.ts`), not from the in-memory dist. A permission-gated
  surface (e.g. `setup.access`) would keep its stale behavior with no error, which
  repeatedly misled debugging. Every _other_ metadata seed (declared permission
  sets, positions, built-in roles, capabilities) already upserts on boot, leaving
  the platform-default path the lone insert-once holdout — a gap ADR-0090 widened
  by persisting more facets (`system_permissions`, delegated-admin `admin_scope`)
  onto the same row.

  The insert-once posture is deliberate for prod (it protects an admin's Setup
  edits and keeps the defaults env-authored — the exact posture
  `bootstrapDeclaredPermissions` relies on), so this is **not** switched to a blind
  upsert. Instead:

  - `bootstrapPlatformAdmin` gains a `resync` option. Default boot behavior is
    unchanged (insert-once). Under `resync`, an existing row is reconciled to the
    shipped dist **only** when the platform still owns it (`managed_by` absent or
    `'platform'`); a row an admin took over (`managed_by:'user'`) or a package owns
    (`'package'`) is an intentional override and is left untouched.
  - New `os meta resync` command boots the runtime, reconciles the default
    permission-set rows to the compiled dist, and reports what was reconciled /
    preserved / newly seeded — **without touching business data** and without a
    `--fresh` wipe. Gated behind a confirmation prompt (`--yes` to skip; `--json`
    for scripting).

  Prod boot is unaffected; the fix is entirely opt-in via the new command.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/formula@14.3.0

## 14.2.0

### Minor Changes

- ac8f029: Two ADR-0090 D5 closures (#2752, #2753):

  **`GET /me/apps` sources the engine registry.** Stack apps are registered
  into the engine registry (runtime AppPlugin), not the metadata service —
  `metadata.list('app')` returned `[]` for every principal, leaving
  `tabPermissions` and `AppSchema.requiredPermissions` with no enforced
  consumer. The endpoint now reads `registry.getAllApps()` (same authority as
  the meta routes, nav contributions merged) with the metadata service as an
  additive fallback; the capability and tab filters are unchanged and now
  actually run.

  **The default baseline binds to the `everyone` anchor.** `member_default`
  carried `allowDelete` on its `'*'` grant — an anchor-forbidden bit — so
  bootstrap refused the `everyone` binding on every boot and the baseline
  flowed only through the separate fallback channel D5 explicitly rejected.
  Two aligned changes:

  - `describeHighPrivilegeBits` (spec) is calibrated to the exact ADR-0090 D5
    bit list (VAMA, delete/purge/transfer, systemPermissions). A plain `'*'`
    wildcard is no longer high-privilege by itself; the wildcard ban moves to
    the GUEST tier where D9 specifies it (`describeAnchorForbiddenBits`).
  - `member_default` drops `allowDelete` from the wildcard. **Behavior
    change:** deleting records is no longer a baseline right — members keep
    create/read/edit-own; domains that want member deletes grant them per
    object via an ordinary position-distributed set. The owner-scoped delete
    RLS stays as a narrowing defense for members who receive a delete bit
    elsewhere.

  With the baseline anchor-safe, bootstrap's existing binding path succeeds:
  "what new users get" is now literally "what is bound to `everyone`" — same
  table, same audit, same explain path (proven by the new
  `me-apps-and-everyone-baseline` dogfood).

- 4ab9958: Position assignment panels as pure SDUI (ADR-0090 follow-through).

  - `RecordRelatedListProps` gains `relationshipValueField` (default `'id'`): which parent-record field the junction's `relationshipField` stores — the generic affordance for name-keyed junctions (`sys_user_position.position` stores `sys_position.name`). Used for both the list filter and the Add-picker's parent-side value.
  - `sys_user` detail page gains a **Positions** tab (assign positions to a user; Add picker stores the position machine name via `valueField: 'name'`; the D12 delegated-admin gate's denials surface in the dialog).
  - New `sys_position` detail page (shipped by plugin-security): **Holders** (name-keyed via `relationshipValueField: 'name'`) and **Permission Sets** (bindings) tabs — zero bespoke UI; ADR-0091 validity columns slot in later as plain column additions.

  Renderer note: the generic `record:related_list` Add-picker and `relationshipValueField` support land in objectui alongside the ^14 alignment; with older renderers these tabs degrade to read-only lists.

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/formula@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/formula@14.1.0
  - @objectstack/platform-objects@14.1.0

## 14.0.0

### Minor Changes

- ac08698: ADR-0090 D6 — the explain engine gets its REST face (#2696).

  **`@objectstack/rest`**: new `GET/POST /api/v1/security/explain`
  (`object`/`operation`/`userId`, validated against the spec's
  `ExplainRequestSchema`) delegating to the `security` service's
  `explain(request, callerContext)` — the same code paths the enforcement
  middleware runs, so the returned `ExplainDecision` is explained by
  construction. The route is authenticated-only (401 even on
  `requireAuth=false` deployments), returns 501 when no security service
  exposes `explain`, and maps the service's `PermissionDeniedError` to 403.
  Registered on scoped (`/environments/:environmentId`) and unscoped base
  paths; the env kernel's own `security` service is preferred, with a new
  host-kernel `securityServiceProvider` fallback wired by the REST plugin.

  **`@objectstack/plugin-security`**: `explainAccessForCaller` now honors
  delegated administration (D12) — explaining ANOTHER user is authorized by
  `manage_users` **or** a delegated `adminScope` whose business-unit subtree
  covers the target user (new `DelegatedAdminGate.scopesCoverUser`, fail-closed
  on unresolvable scopes/memberships). Self-explain still needs neither.

- bd39dc5: ADR-0090 D5/D9 — suggested audience bindings become a queryable, confirmable surface.

  A package permission set declaring `isDefault: true` is an install-time
  SUGGESTION to bind the set to the built-in `everyone` position — never
  auto-bound. Until now the flag was only read at bootstrap as the fallback-set
  name; after an install there was no way to see or act on the suggestion.

  **`@objectstack/plugin-security`**: new `sys_audience_binding_suggestion`
  system object (read-only over the data API; unique per
  package × set × anchor) plus a convergent reconciler
  (`syncAudienceBindingSuggestions`) that reads every declared `isDefault` set —
  boot-declared stack metadata AND installed package manifests, so a runtime
  `POST /api/v1/packages` install is visible immediately — and keeps the table
  honest: undeclared → pending row pruned, bound out-of-band → marked
  `confirmed` (observed). The `security` service gains
  `listAudienceBindingSuggestions` / `confirmAudienceBindingSuggestion` /
  `dismissAudienceBindingSuggestion`, all pre-gated on tenant-level admin
  (ADR-0066 superuser wildcard — anchors stay tenant-level only per D12).
  Confirm writes the `sys_position_permission_set` row **with the caller's
  execution context**, so the D5/D9 audience-anchor gate (no high-privilege
  set on `everyone`/`guest`) and the D12 delegated-admin gate enforce the
  binding; a set not yet materialized (installed this session) is first
  seeded through the same provenance-checked upsert as the boot seeder
  (ADR-0086 D4).

  **`@objectstack/rest`** and **`@objectstack/runtime`**: the HTTP surface,
  registered on both API layers (the RestServer that `objectstack dev`/hono
  serves, and the runtime HttpDispatcher used by the adapters) —
  `GET /api/v1/security/suggested-bindings?status=&packageId=`,
  `POST /api/v1/security/suggested-bindings/:id/confirm`,
  `POST /api/v1/security/suggested-bindings/:id/dismiss` (401 unauthenticated,
  403/404/409 mapped from the service's typed errors, 501/503 without
  plugin-security).

- 1056c5f: Package uninstall now revokes the package's data-plane permission rows (#2747, ADR-0086 D3 / ADR-0090 D5 "no ghost grants").

  **`@objectstack/metadata-protocol`**: `deletePackage` gains an
  uninstall-cleanup seam — the exact mirror of the publish materializer:
  domain plugins register named cleanups via `registerUninstallCleanup(name,
fn)` and every cleanup runs with the uninstalled package id, its outcome
  reported on the new `cleanups` array of the response (a failed revocation is
  visible, never silent). `deletePackage` also unregisters the package from
  the in-memory SchemaRegistry (best-effort), so the running kernel stops
  serving it without waiting for a restart.

  **`@objectstack/plugin-security`**: registers the
  `security.package-permissions` cleanup — deletes the package's own
  `sys_permission_set` rows (`managed_by: 'package'` + matching `package_id`
  only; env-authored and foreign-package rows are never touched, ADR-0086 D4),
  their `sys_position_permission_set` / `sys_user_permission_set` bindings
  (bindings first, so no dangling grants), and the package's
  `sys_audience_binding_suggestion` rows (a reinstall re-prompts fresh).
  Also fixes the engine-call signature in the suggestion module: `find`/`delete`
  read `context` from their second argument — the previous trailing
  `{ context }` argument was ignored, so deletes ran principal-less.

  **`@objectstack/rest`**: `DELETE /api/v1/packages/:id` (no version pin) now
  goes through `protocol.deletePackage` — one uninstall semantic instead of a
  bare `sys_packages` row delete — removing the package's metadata, durable
  record, registry entry, and running the cleanups; the response carries
  `deletedCount` + `cleanups`. A version-scoped delete keeps the narrow
  durable-registry semantics.

### Patch Changes

- 0a8e685: ADR-0090 permission-model zoo + docs alignment.

  **Showcase (`@objectstack/example-showcase`)** now exercises the full Permission
  Model v2 authoring surface and is guarded by a new runtime dogfood test
  (`showcase-permission-zoo.dogfood.test.ts`): typed `definePosition`/
  `definePermissionSet`/`defineSharingRule` factories; six flat positions (the
  stale pre-D3 `parent` fields are gone); permission sets covering CRUD+FLS+RLS,
  org-depth read/write asymmetry (`readScope: 'org'` / `writeScope: 'own'`),
  View-All (auditor) and Modify-All (ops) bypasses, `systemPermissions`
  (`setup.access`), the `isDefault` everyone-suggestion (incl. personal-data
  grants on the `private`-OWD note object), a guest-safe set for the `guest`
  anchor (D9), and a delegated-administration `adminScope` bounded to a seeded
  `sys_business_unit` subtree (D12). Objects gain `externalSharingModel` dials
  (D11). A committed `access-matrix.json` opts the showcase into the D6 snapshot
  gate. Hierarchy depths (`own_and_reports`/`unit`/`unit_and_below`) are
  deliberately NOT authored — they are enterprise (`hierarchy-security`) and the
  open runtime fails closed; BU-shaped visibility is demonstrated via the
  enforced `unit_and_subordinates` sharing-rule recipient instead.

  **`@objectstack/spec`**: `defineStack` strict cross-reference validation no
  longer rejects permission grants or seed datasets that target platform-provided
  objects (`sys_`/`cloud_`/`ai_` prefixes) — a delegated-admin set carrying CRUD
  on the RBAC link tables (ADR-0090 D12) and an app seeding the business-unit
  tree are legitimate shapes; the typo net stays intact for the stack's own
  objects. Stale pre-ADR-0090 vocabulary in zod docstrings (rls/territory/
  sharing/tool/agent) is rewritten; the auto-generated references (including the
  previously missing `security/explain.mdx`) are regenerated.

  **Docs**: `protocol/objectql/security.mdx` rewritten to the v2 model (no
  profiles, positions, canonical OWD four + D1 private default +
  `externalSharingModel`, position-scoped RLS, enforced sharing recipients);
  `isProfile` scrubbed from every authoring example; the dead
  `/docs/references/identity/role` link fixed; implementation-status and
  plugin READMEs aligned. Remaining rename misses are tracked in #2722
  (RLSUserContext.role), #2723 (portal `profiles`), #2724 (sys_record_share
  `role` enum).

- d0531c4: Setup → Access Control nav: the `sys_position` entry is renamed
  `nav_roles`/"Roles" → `nav_positions`/"Positions" (岗位 / ポジション /
  Posiciones) — the last "role" leftover in platform UI copy (ADR-0090 D3;
  the Studio-side relabel already landed in objectui). The framework's
  `.objectui-sha` pin is bumped to pick up the Studio Access-pillar explain
  panel ("why can this user access?", ADR-0090 D6) and the suggested
  audience-binding install prompt (D5/D9).
- cff5aac: Setup navigation: the Access Control menu entry for `sys_position` is now labeled "Positions" (was still "Roles" after the ADR-0090 D3 rename) — `nav_roles` → `nav_positions`, with zh-CN 岗位 / ja-JP ポジション / es-ES Posiciones translations updated to match the position vocabulary.
- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [332b711]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
  - @objectstack/spec@14.0.0
  - @objectstack/platform-objects@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/formula@14.0.0

## 13.0.0

### Major Changes

- 6d83431: ADR-0090 P1 breaking wave — permission model v2 concept convergence.

  Pre-launch one-step renames and secure defaults (no compatibility aliases, per
  ADR-0090 D3/D4 superseding ADR-0057 D5/D7's alias discipline):

  - `sys_role` → `sys_position`, `sys_user_role` → `sys_user_position` (field
    `role` → `position`), `sys_role_permission_set` → `sys_position_permission_set`
    (field `role_id` → `position_id`); `RoleSchema`/`defineRole` →
    `PositionSchema`/`definePosition` with **no `parent`** (positions are flat;
    hierarchy lives on the business-unit tree).
  - `ExecutionContext.roles[]` → `positions[]`; the EvalUser/CEL contract
    `current_user.roles` → `current_user.positions` (formula validators updated);
    stack property `roles:` → `positions:`; metadata kinds `role`/`profile` →
    `position` (profile kind removed).
  - `isProfile` removed from `PermissionSetSchema` (ADR-0090 D2); `isDefault`
    narrows to an install-time suggestion; `appDefaultProfileName` →
    `appDefaultPermissionSetName` (isDefault-only).
  - OWD enum drops legacy aliases `read`/`read_write`/`full`; new optional
    `externalSharingModel` (external dial, `private` default) lands as P1 spec
    shape (ADR-0090 D11).
  - **Secure default (D1)**: a custom object with an owner field and NO
    `sharingModel` now resolves `private` (was: fully public). System objects
    keep their explicit posture. Unrecognised stored values fail closed.
  - ExecutionContext gains the P1 principal-taxonomy shape (D10):
    `principalKind` / `audience` / `onBehalfOf` (optional, semantics phase in
    later).
  - Sharing recipients: `role` → `position` (expanded via `sys_user_position`
    ∪ the better-auth membership transition source); `role_and_subordinates`
    removed — `unit_and_subordinates` now expands the business-unit subtree
    (finishes ADR-0057 D5's re-homing).

- b271691: ADR-0090 P3 — security-domain publish linter (D7) and delegated administration (D12).

  **D7 — `validateSecurityPosture` (@objectstack/lint), wired into `os compile` (errors gate the build) and `os lint`.** Rules, each with a failing fixture: `security-owd-unset` (custom object with no `sharingModel` — the objectui#2348 leave_request shape), `security-owd-alias` (retired D4 alias values, with fix-it), `security-external-wider-than-internal` (D11 `external ≤ internal`), `security-wildcard-vama` (`'*'` + View/Modify All outside the platform admin set, ADR-0066), `security-anchor-high-privilege` (an `isDefault`/everyone-suggested set carrying anchor-forbidden bits), `security-role-word` (D3 vocabulary freeze in security identifiers/labels; ARIA/page roles exempt), and advisory `security-private-no-readscope`.

  **D12 — delegated administration (@objectstack/plugin-security `DelegatedAdminGate`).** `PermissionSetSchema.adminScope` (new in spec, persisted as `sys_permission_set.admin_scope`) declares WHERE (a `sys_business_unit` subtree), WHAT (`manageAssignments` / `manageBindings` / `authorEnvironmentSets`), and WHICH sets a delegate may hand out (`assignablePermissionSets` allowlist). Writes to `sys_user_position`, `sys_position_permission_set`, `sys_user_permission_set`, and `sys_permission_set` are now governed: tenant-level admins (ADR-0066 superuser wildcard) pass through; delegates need a covering scope — inside their subtree, allowlisted sets only (to others AND themselves), single-row writes, `granted_by` audit-stamped; everyone else (including holders of plain CRUD on RBAC tables) is denied. Granting or authoring a set that itself carries an `adminScope` requires a held scope that STRICTLY contains it. The `everyone`/`guest` anchors stay tenant-level only, and direct position assignments to an anchor are rejected for every caller.

  **ADR-0090 Addendum — assignment-level BU anchor.** `sys_user_position.business_unit_id` lands with its three consumers scoped: D12 delegation boundary (enforced here), audit fact, and the depth-anchor contract for enterprise `hierarchy-scope-resolver` implementations (documented on `IHierarchyScopeResolver`).

  **D9 tier tightening.** `describeHighPrivilegeBits` moved to `@objectstack/spec/security` (re-exported from plugin-security) alongside new `describeAnchorForbiddenBits`: `guest` bindings now additionally reject edit bits (read-only by default; create stays the case-by-case exception).

  **BREAKING (@objectstack/plugin-security):** exports renamed to the ADR-0090 D3 vocabulary — `SysRole`→`SysPosition`, `SysUserRole`→`SysUserPosition`, `SysRolePermissionSet`→`SysPositionPermissionSet` (no aliases, pre-launch one-step rename). `sys_position` row actions/list views renamed (`activate_position`, …), labels relabeled Role→Position. Non-tenant-admin writes to the RBAC link tables without an `adminScope` are now denied (previously any CRUD grant on those tables sufficed).

  **BREAKING (@objectstack/platform-objects):** `sys_business_unit_member.role_in_business_unit` → `function_in_business_unit` (D3 reserved-word sweep; values member/lead/deputy unchanged).

### Minor Changes

- 01917c2: ADR-0090 P2 — audience anchors: `everyone`/`guest` builtin positions.

  - `EVERYONE_POSITION` / `GUEST_POSITION` constants in `@objectstack/spec`;
    both anchors seeded (system-managed) alongside the builtin identity names.
  - Every authenticated principal implicitly holds `everyone` in
    `ctx.positions`, so sets bound to it resolve as ordinary position-bound
    grants — ADDITIVE. The fallback CLIFF is abolished: the configured
    baseline (`fallbackPermissionSet`, default `member_default`) now applies
    in addition to explicit grants instead of only when the user had none,
    and is also seeded as an `everyone` binding (same table/audit/explain
    path as admin-authored defaults).
  - Sessionless HTTP principals resolve as `principalKind: 'guest'` holding
    exactly `['guest']`; internal bare contexts are untouched.
  - Audience-anchor binding gate: `sys_position_permission_set` writes that
    would bind a high-privilege set (VAMA, delete/purge/transfer, system
    permissions, `'*'` wildcard) to `everyone`/`guest` are rejected at the
    data layer, unconditionally (`describeHighPrivilegeBits` predicate is
    exported and shared with the seed-time validation).

- a5a1e41: ADR-0090 P4 — explain engine (D6), access-matrix snapshot gate, recalibrated benchmark.

  **Explain contract (@objectstack/spec).** `ExplainRequestSchema` / `ExplainDecisionSchema` / `ExplainLayerSchema`: `explain(principal, object, operation)` reports the verdict of every evaluation-pipeline layer in order (principal → required_permissions → object_crud → fls → owd_baseline → depth → sharing → vama_bypass → rls), with per-layer contributor attribution (which permission set, reached via which position/baseline) and — for reads — the composed row filter as the machine artifact. Carries the D10 dual attribution (`principalKind`, `onBehalfOf`).

  **Explain engine (@objectstack/plugin-security).** `explainAccess` is "explained by construction": it calls the SAME permission-set resolution, evaluator, FLS mask, and RLS composition the enforcement middleware calls (injected from `SecurityPlugin`), so the report cannot drift from enforcement. Exposed on the `security` kernel service as `explain(request, callerContext)`; explaining another user requires `manage_users` (the target's context is reconstructed from `sys_user_position` / `sys_user_permission_set` with everyone-anchor semantics via `buildContextForUser`).

  **Access-matrix snapshot gate (@objectstack/lint + os compile).** `buildAccessMatrix(stack)` derives the (permission set × object) capability matrix purely from metadata; `diffAccessMatrix` renders semantic review lines ("'crm_admin' gains delete on 'crm_lead'", depth changes, OWD swings, entry add/remove). `os compile` gains an opt-in gate: with `access-matrix.json` committed next to the config, any drift fails the build with those lines until re-snapshotted via `--update-access-matrix` — every capability change becomes a reviewable diff. Seeded for `examples/app-crm`.

  **Benchmark (ADR-0090 Addendum).** `scripts/bench/permission-bench.mts` — single-org 10k users × 1M rows per the recalibrated topology; asserts the O()-shape property (per-request cost independent of user population; unit-depth IN-set cost tracks unit size). Passing at 0.1µs/eval and 59ms/1M-row IN-set scan.

- 466adf6: Per-operation object `requiredPermissions` (ADR-0066 ⑤) — an object can now be
  read-open / write-gated instead of gating all of CRUD on one capability set.

  `Object.requiredPermissions` accepts either the original `string[]` (capabilities
  required for **all** operations) **or** a `{ read?, create?, update?, delete? }`
  map that gates each operation class independently — mirroring how Salesforce and
  Dataverse separate capability by operation. plugin-security enforces the caps for
  the request's operation class as the same D3 AND-gate (checked before the CRUD
  grant, fail-closed). The mapping folds `transfer`/`restore` into `update` and
  `purge` into `delete`, derived from the existing CRUD permission bits so it stays
  in lockstep with them.

  Backward-compatible: the `string[]` form keeps its gate-every-operation semantics
  (normalized into an `all` bucket that unions with the per-operation bucket), so
  existing objects are unaffected. The per-operation map's keys are validated
  `.strict()`, so a mistyped key (e.g. `reads`) is rejected at author time rather
  than silently ignored.

### Patch Changes

- 466adf6: Author-time capability-reference lint (ADR-0066 ⑨) — `os validate` / `os lint`
  now warn when a `requiredPermissions` names a capability that is registered
  nowhere.

  `requiredPermissions` (on objects, fields, apps, actions) is a free string, so a
  typo like `mange_users` is schema-valid and fails closed at runtime (the caller
  is denied) — safe, but silent. The new `validateCapabilityReferences` rule
  (`@objectstack/lint`) resolves every reference against the author-time known set
  and warns on the unresolved ones:

  - built-in platform capabilities — now sourced from a single canonical list in
    `@objectstack/spec` (`security/capabilities.ts`: `PLATFORM_CAPABILITIES` /
    `PLATFORM_CAPABILITY_NAMES`), which `@objectstack/plugin-security`'s
    `bootstrapSystemCapabilities` also seeds from (one source of truth, no drift),
  - any capability a permission set in the stack grants via `systemPermissions`
    (granting is what declares it — mirrors the runtime derived-defaults rule), and
  - any `sys_capability` row shipped as seed data.

  It is a **warning**, not an error: a single package can't see capabilities
  declared by other installed packages, and the reference fails closed anyway.
  `systemPermissions` itself is never flagged — it is the declaration side, and a
  package legitimately introduces new capabilities there. The object case also
  understands the per-operation `requiredPermissions` map form (ADR-0066 ⑤) and
  points a finding at the exact operation slice.

- 799b285: Fix field-level-security read leak on mutation responses. The security
  middleware only masked read-protected fields on `find`/`findOne` results, so a
  caller with edit-but-not-field-read could `insert`/`update` a record and read a
  read-protected field back out of the echoed post-image (field WRITES were
  already blocked, but the response image was not masked). The mask now also
  covers `insert`/`update` results, matching read behavior.
- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/formula@13.0.0
  - @objectstack/platform-objects@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/formula@12.6.0
  - @objectstack/platform-objects@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/formula@12.5.0
  - @objectstack/platform-objects@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/formula@12.4.0
  - @objectstack/platform-objects@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/formula@12.3.0
  - @objectstack/platform-objects@12.3.0

## 12.2.0

### Minor Changes

- 3962023: feat(spec,security): make ambiguous nav landings unrepresentable + close the field-permission filter oracle (objectui#2251, objectui ADR-0055).

  **spec — `ObjectNavItem` target exclusivity.** `NavigationItemSchema` now rejects an object nav item that combines `filters` with `recordId` or `viewName` (custom issue on `filters` with the fix in the message). Runtime precedence would silently ignore the extras — a stale `recordId` hijacking a configured `filters` slice — so the ambiguous combination is now unwritable (ADR-0053 correct-by-construction). FROM `{ filters, viewName }` / `{ filters, recordId }` TO exactly one landing field; the legacy `recordId` + `viewName` combination stays tolerated (documented: `viewName` is ignored). `filters` shipped in the same unreleased minor, so no released metadata is affected.

  **plugin-security — field-level predicate guard.** `FieldMasker` strips non-readable fields from RESULTS, but predicates still leaked their values: filtering / sorting / grouping / aggregating by a hidden field changes row presence (a filter oracle — probe `salary >= X` even though the column is masked). The security middleware now rejects (403 `PermissionDeniedError`, `reason: 'field_predicate_denied'`) any caller query whose `where` / `orderBy` / `groupBy` / `having` / `aggregations` / `windowFunctions` reference a field the caller cannot read — evaluated against the caller's AST **before** RLS injection, so RLS policies may keep referencing hidden fields (e.g. `owner_id`). Rejection over silent predicate dropping: removing an `$and` branch widens results and re-opens the oracle. New exports: `assertReadableQueryFields`, `collectQueryFields`, `collectConditionFields`.

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/formula@12.2.0
  - @objectstack/platform-objects@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/formula@12.1.0
  - @objectstack/platform-objects@12.1.0

## 12.0.0

### Minor Changes

- 9796e7c: feat(security): two-doors separation for permission sets (ADR-0086 P2)

  Splits who may change a permission set into two non-overlapping doors, enforced
  at the data layer instead of by convention:

  **块 1 — the package door (publish-time materialization).**
  `ObjectStackProtocolImplementation` gains a generic publish-time materializer
  registry (`registerPublishMaterializer(type, fn)`). When a draft of a registered
  type is published, its body is projected into a data-plane row and the result is
  surfaced on the publish response as `materializeApplied` (best-effort, never
  thrown — same contract as `seedApplied`). `promoteDraft` now returns the draft's
  `packageId` so the materializer can stamp the owning package. `plugin-security`
  registers a `permission` materializer that upserts the published set into
  `sys_permission_set` with `managed_by:'package'` + `package_id` — so a set
  authored through the studio package door (saved as a `permission` draft, then
  published) lands in the admin surface with the exact provenance the boot seeder
  already stamps, now on the runtime publish path too. The single-set upsert is
  shared with `bootstrapDeclaredPermissions` (`upsertPackagePermissionSet`), so
  both paths apply the same own-row / foreign-package / env-authored rules.

  **块 2 — the admin door (data-layer write gate).**
  The security middleware now refuses any admin-door write
  (`update`/`delete`/`transfer`/`restore`/`purge`) to a `sys_permission_set` row
  with `managed_by:'package'`, and refuses an `insert` that forges
  `managed_by:'package'`. The gate fails closed regardless of the caller's grants
  (a platform admin with `modifyAllRecords` is blocked just the same), so it is a
  real data-layer boundary rather than a UI hint. System/boot writes carry
  `isSystem` and bypass the whole middleware, so the boot seeder and the publish
  materializer are unaffected. Env-authored sets (`managed_by` `user`/`platform`
  or absent) stay freely editable through the admin door — the two doors never
  overwrite each other.

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

### Patch Changes

- 48ad533: fix(security): surface swallowed permission-set resolution failures (#2565)

  `PermissionEvaluator.resolvePermissionSets` swallowed metadata `list()` and
  `sys_permission_set` dbLoader failures silently — fail-closed (unresolvable
  sets grant nothing), but a transient DB error made custom permission sets
  vanish with no trace, leaving the resulting 403s undiagnosable. The evaluator
  now accepts an optional `{ logger }` and emits one `warn` per failed source,
  naming the unresolved permission sets and the error. SecurityPlugin wires its
  plugin logger into both call sites. Resolution behavior is byte-identical.

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/platform-objects@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/formula@12.0.0

## 11.10.0

### Patch Changes

- 6a9397e: Retire the deprecated `compactLayout` alias for `highlightFields` (framework#2536, closes the ADR-0085 deprecation window).

  - `ObjectSchema` no longer declares `compactLayout`: `create()` rejects it like any unknown key; lenient `parse()` strips it (no silent aliasing).
  - The parse-time alias AND the `highlightFields → compactLayout` back-fill transition mirror are removed from `normalizeSemanticRoleAliases`. Served metadata now carries the canonical key only.
  - All remaining first-party authors (27 system objects across plugin-audit / approvals / security / sharing / webhooks / service-storage / automation / messaging / realtime — missed by the #2521 sweep, caught by the type gate) renamed to `highlightFields`.
  - The downstream smoke pin moves to hotcrm v1.2.2 (hotcrm#424: same rename + deps ^11.7.0).
  - Consumers were switched in objectui#2168 and shipped via the console pin bump (#2526); this closes the window scheduled there. The dogfood mirror assertion (#2528) flips to `compactLayout: undefined` in this same change, per the plan it carried.

  Version note: minor, not major — the key was deprecated-with-alias for a full release window, all first-party consumers/authors are migrated, and the spec api-surface gate reports no export changes (same documented-exception path as the ADR-0085 removals in 11.7.0). External metadata still authoring `compactLayout` will now fail `create()` loudly with the standard unknown-key error naming the key.

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/formula@11.10.0
  - @objectstack/platform-objects@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/formula@11.9.0
  - @objectstack/platform-objects@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/formula@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/formula@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/formula@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/platform-objects@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/platform-objects@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/platform-objects@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/formula@11.2.0
  - @objectstack/platform-objects@11.2.0

## 11.1.0

### Patch Changes

- 574e7a3: Security: platform admins see all rows of better-auth-managed identity objects (ADR-0024 / cloud#551)

  Identity tables managed by the auth library (`managedBy: 'better-auth'` — `sys_oauth_application`, `sys_account`, `sys_session`, `sys_sso_provider`, …) are written by better-auth's own adapter with **no tenant context**, so `organization_id` is never stamped and `member_default`'s wildcard `tenant_isolation` RLS denies every row — a platform admin's Setup list (OAuth Applications, Identity Links, …) renders **empty**.

  These objects now get the **same posture-gated superuser bypass** as `private` / `tenancy.enabled:false` objects, so a platform admin's `viewAllRecords` sees all identity rows env-wide. This is **admin-only**: non-admins never trigger the bypass — their `_self` carve-outs / `tenant_isolation` still apply (verified by a regression test that a member stays tenant-scoped), and the flag is deliberately **not** used for the wildcard-policy drop, so it can never leak rows to members.

  Fixes the empty-list symptom across all better-auth-managed Setup objects without per-object `tenancy` changes (which would risk the control plane, where some of these objects ARE cross-env-isolated).

- Updated dependencies [cbc8c02]
- Updated dependencies [07c2773]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/formula@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
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
- Updated dependencies [5737261]
- Updated dependencies [a619a3a]
- Updated dependencies [f44c1bd]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/formula@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/formula@10.3.0
- @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/formula@10.2.0
  - @objectstack/platform-objects@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/formula@10.1.0
  - @objectstack/platform-objects@10.1.0

## 10.0.0

### Minor Changes

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
  `sys_user_position` assignment, and seeds stack-declared `roles`/`sharingRules` into
  `sys_position`/`sys_sharing_rule` at boot (closes #2077). Hierarchy-relative scopes are
  delegated to a pluggable `IHierarchyScopeResolver` (open edition fails closed to
  owner-only; `defineStack` errors without `requires: ['hierarchy-security']`). Also
  fixes a latent over-grant where `engine.find({ filter })` was ignored (driver reads
  `where`) — normalized `filter`→`where` in the engine.

- cfd86ce: ADR-0058 — expression & predicate surface unification. Adds the canonical
  CEL→FilterCondition pushdown compiler in `@objectstack/formula`
  (`compileCelToFilter`, `isPushdownableCel`, `lowerCelAst`) plus an in-memory
  `matchesFilterCondition` backend (one AST, three backends). `plugin-security`
  (RLS `using`, via a SQL bridge) and `plugin-sharing` (`celToFilter`) cut over to
  it, retiring the bespoke regex/field-equality front-ends. Compound sharing
  conditions now compile and enforce end-to-end (closes #1887). The RLS `check`
  clause is now enforced on the write post-image (insert/by-id update), fail-closed.
  Non-pushdownable predicates (arithmetic, functions, subqueries, cross-object) are
  an authoring compile error, never silently dropped (ADR-0049/0055).
- 6ca20b3: ADR-0058 D1 follow-through — RLS predicates are now canonical CEL. Migrated every
  seeded RLS `using`/`check` (default permission sets, showcase, and the
  `RLS.ownerPolicy`/`tenantPolicy`/`allowAllPolicy` helper factories) from the
  legacy SQL-ish form (`=`, `IN (...)`) to pure CEL (`==`, `in`), so authors and AI
  learn ONE expression language. The `sqlPredicateToCel` bridge is retained as a
  DEPRECATED transitional shim: a stored SQL-style predicate still compiles (no
  silent deny on legacy data) but emits a deprecation warn; canonical CEL passes
  through as a no-op. No runtime behavior change — CEL and the old SQL form compile
  to the identical FilterCondition.

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [7108ff3]
- Updated dependencies [30c0313]
- Updated dependencies [e16f2a8]
- Updated dependencies [cfd86ce]
- Updated dependencies [e411a82]
- Updated dependencies [ae271d0]
- Updated dependencies [61ed5c7]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [0df063e]
- Updated dependencies [ce13bb8]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [47d978a]
- Updated dependencies [48a307a]
- Updated dependencies [25fc0e4]
  - @objectstack/spec@10.0.0
  - @objectstack/platform-objects@10.0.0
  - @objectstack/formula@10.0.0
  - @objectstack/core@10.0.0

## 9.11.0

### Minor Changes

- fa8964d: feat(security): RLS predicates that won't compile are surfaced, not silently dropped (ADR-0056 D4)

  The RLS compiler previously dropped any `using`/`check` it could not parse (e.g. `==`,
  `AND`/`OR`, ranges) in silence — if it was the only policy, the object lost protection
  with no signal (the class of bug that left a showcase owner predicate inert for two PRs).
  Now the compiler WARNS (via the security plugin's logger) when an **unsupported-shape**
  predicate is dropped, distinguishing it from the intentional "context variable absent"
  fail-closed skip. Also exports `isSupportedRlsExpression(expr)` so an authoring-time gate
  (`objectstack compile`) can reject a predicate the runtime would never enforce. No change
  to compiled filters for valid predicates; fail-closed semantics preserved.

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

- 751f5cf: feat(security): declaration-derived public-form authorization (ADR-0056, Option A)

  Public form submissions are now authorized by the **declaration**, not by a
  deployment-configured `guest_portal` profile. The form-submit route derives a narrow
  `publicFormGrant: { object }` from the matched form's target object; the SecurityPlugin
  honors it as a least-privilege capability — **create + the immediate read-back on THAT
  object only**, with no userId, and crucially NOT the anonymous fall-open. This makes
  public forms work under secure-by-default (`requireAuth`) **without** a hand-configured
  `guest_portal`, scoped to exactly the declared object (the field allow-list is still
  enforced at the route; `guest_portal`/`anonymous` are kept on the context for back-compat
  with guest-detection hooks). It is the prerequisite that unblocks the eventual
  `requireAuth` default flip, and generalizes the platform principle "public access =
  declared + runtime-derived scoped grant" (the same shape share-links already use).
  Proven by `form-self-auth` dogfood (create on target allowed; cross-object + update/delete
  denied). plugin-security 108, rest 121, full dogfood 98 — no regression.

- 5a5a9fe: feat(security): public-form demo (Option A) + app-declared default profile wiring (ADR-0056 D7)

  Wires ADR-0056's app-declarable default profile through the CLI so it actually
  takes effect under `pnpm dev`. `@objectstack/plugin-security` exports a new
  `appDefaultProfileName(permissions)` helper that extracts the first
  `isProfile && isDefault` profile name from a stack; `@objectstack/cli` (`serve.ts`)
  passes it as the SecurityPlugin `fallbackPermissionSet` (undefined → built-in
  `member_default` preserved, so apps that declare no default are unaffected).

  The showcase gains a working web-to-lead **public form** (`showcase_inquiry` +
  an `allowAnonymous` FormView authorized by the declaration-derived
  `publicFormGrant`, no `guest_portal` profile) and an app-declared default
  profile (`showcase_member_default`), each covered by a dogfood proof over the
  real HTTP stack.

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

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/platform-objects@9.11.0

## 9.10.0

### Minor Changes

- 1f88fd9: Converge the RLS contract with the reference compiler, and wire §7.3.1 dynamic membership.

  - **spec (docs)**: narrow `rls.zod.ts` to the four expression forms the compiler actually implements — `field = current_user.<prop>`, `field = 'literal'`, `field IN (current_user.<array>)`, and `1 = 1`. Removed the over-promised surface (subqueries, `AND`/`OR`/`NOT`, `LIKE`/`ILIKE`, regex, `ANY`/`ALL`, `NOT IN`, `IS NULL`, `NOW()`/`CURRENT_DATE`) from the operator list, context-variable list, and `@example` policies, and documented the fail-closed behaviour explicitly.
  - **spec (schema)**: `ExecutionContext` gains `rlsMembership?: Record<string, string[]>` — a bag of pre-resolved dynamic-membership id arrays (team members, territory accounts, shared records) that the runtime stages so RLS can scope via `field IN (current_user.<key>)` without subquery support. Generalizes the previously hard-coded `org_user_ids`.
  - **plugin-security**: `RLSCompiler.compileFilter` merges `rlsMembership` keys into the user context (arrays only, never clobbering the named `id`/`organization_id`/`roles`/`org_user_ids` fields), so §7.3.1 hierarchy- and sharing-based policies compile. `compileExpression` now recognizes `1 = 1` as always-true (empty filter), making `RLS.allowAllPolicy` grant access instead of silently failing closed. Missing/empty membership sets still fail closed.

- e2b5324: feat(ownership): auto-provision a canonical `owner_id` and hand seeded records to the first admin

  Ownership is now correct-by-default instead of opt-in — closing the gap where
  seeded demo data ended up owned by nobody a human can log in as (so "My" views,
  owner reports and owner notifications were empty out of the box) and where
  author-written objects silently shipped with no working ownership at all.

  - **`applySystemFields` (objectql)** now auto-injects a canonical, reassignable
    `owner_id` lookup (→ `sys_user`) on user-authored business objects, alongside
    the existing tenant/audit fields. Unlike the audit `*_by` lookups it is NOT
    readonly — ownership transfers. Withheld for `managedBy` / `sys_*` tables and
    for objects that opt out via `ownership: 'org' | 'none'` (Dataverse-style). The
    safe default direction: forgetting the opt-out leaves a harmless spare column,
    whereas the old opt-IN model let authors ship objects with broken ownership.
    Once present, the existing machinery engages automatically (insert auto-stamp,
    owner-scoped RLS, owner-keyed views/reports).

  - **`claimSeedOwnership` (plugin-security)**, invoked from `bootstrapPlatformAdmin`
    right after the first human is promoted to platform admin, transfers ownership
    of seeded rows (`owner_id` NULL or `usr_system`) to that admin. The ownership
    twin of org-scoping's `claimOrphanOrgRows`. Idempotent; skips `managedBy` /
    `sys_*`. Authors write plain seed records (no `owner_id`) and the platform —
    not the author — performs the handoff, so there is nothing to remember or
    mistype.

  - **`usr_system` is never minted (runtime + objectql).** The seed loader binds
    `os.user` to a NULL identity, so `cel`os.user.id``resolves to NULL at seed
time (the owning admin does not exist yet) and the row seeds NULL-owned — then
the handoff above fills it. The runtime's`ensureSeedIdentity`(the only code
that inserted a`usr_system`row) is removed.`SystemUserId.SYSTEM`survives
only as a reserved id so legacy DBs' exclusion guards / ownership handoff still
recognize a pre-existing row.`os.org`is unaffected (derived from`organizationId`).

  Also hardens `bootstrapPlatformAdmin` against a latent dts typecheck error
  (defensive read of the untyped `description` on seed permission sets).

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/platform-objects@9.9.1

## 9.9.0

### Minor Changes

- 92d75ca: fix(security): enforce row-level security on by-id writes — close the member-can-edit-others'-records hole (#1985).

  A single-id `update`/`delete` goes straight to `driver.update(object, id, …)` / `driver.delete(object, id)` and builds no query `ast`, so the RLS `where` filter the middleware injects on the read path was **never applied to by-id writes**. Combined with `member_default` granting `*: { edit, delete }` (scoped, by design, via the `owner_only_writes/deletes` RLS), this meant the owner predicate was silently bypassed: **any authenticated member could modify or delete another user's records** (verified end-to-end — a member PATCH'd an admin's record and the change persisted).

  Two coordinated changes:

  - **Enforce a pre-image authorization check.** Before a single-id `update`/`delete`, the security middleware computes the write-operation RLS filter and re-reads the target row with `{ id } AND <writeFilter>`; if the row isn't visible (someone else's, or RLS-hidden) it throws `PermissionDeniedError` (403). Reuses the existing RLS/tenant machinery, is recursion-safe (a `find` doesn't trigger the check), and is skipped when no RLS policy applies (e.g. admin sets, `modifyAllRecords`) so admins and unguarded objects are unchanged.
  - **Repoint owner scoping to a column that exists.** `owner_only_writes`/`owner_only_deletes` keyed on `owner_id`, which author-defined objects almost never declare — so the policy referenced a missing column and `computeRlsFilter` dropped it (the no-op that made the bypass invisible). Now keyed on `created_by`, the ownership column the engine stamps on every object.

  Result: a member may edit/delete the records they created, not others'; admins (and any set with `modifyAllRecords` or no RLS) are unrestricted. Objects that opt out of audit fields (`systemFields.audit: false`) have no `created_by` and now fail **closed** for member writes (grant `modifyAllRecords` or a per-object policy to allow). Objects modeling transferable ownership should override with a per-object owner policy.

  Verified live on app-crm (2 users): member→others' record PATCH/DELETE = 403 (unmutated); member→own = 200; admin→any = 200. Note: cross-tenant write isolation additionally depends on an organization being assigned at sign-up (tracked separately in #1985).

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
  - @objectstack/core@9.9.0
  - @objectstack/platform-objects@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/platform-objects@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/platform-objects@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/platform-objects@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [5be7102]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/platform-objects@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/platform-objects@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/platform-objects@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/platform-objects@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/platform-objects@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/platform-objects@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/platform-objects@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/platform-objects@8.0.1

## 8.0.0

### Patch Changes

- 1e8b680: fix(security): close four P0 launch-readiness findings

  - **plugin-auth (P0-1):** `generateSecret()` now throws (fails boot) when no
    `OS_AUTH_SECRET` is set and `NODE_ENV==='production'`, instead of silently
    falling back to a predictable `dev-secret-<timestamp>` (session forgery). The
    dev/test fallback is unchanged.
  - **plugin-security (P0-2):** the permission-resolution `catch` now **fails
    closed** — it logs at ERROR and throws `PermissionDeniedError` rather than
    `return next()`. A degraded metadata service can no longer let every
    authenticated request bypass RBAC/RLS. System operations still bypass as before.
  - **driver-sql (P0-3):** the `contains` / `$contains` operator now escapes LIKE
    metacharacters (`%` / `_` / `\`) in the user value and binds an explicit
    `ESCAPE '\'`, so a value of `%` matches literally instead of every row
    (filter bypass). Correct across SQLite/MySQL/Postgres.
  - **driver-mongodb (P0-4):** the field-operator translator now rejects unknown
    `$`-operators instead of passing them through, blocking `$where` / `$function`
    / `$expr` (server-side JS execution / query-intent bypass). All legitimate
    ObjectQL operators remain allowlisted.

  +12 regression tests across the four packages.

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/platform-objects@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/platform-objects@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [7ae6abc]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/platform-objects@7.4.1

## 7.4.0

### Minor Changes

- e478e0c: ADR-0029 K2 — security domain ownership (RBAC + sharing) + Setup nav contributions.

  Moves the security objects out of the `@objectstack/platform-objects` monolith
  into the two capability plugins that already register and operate them, split by
  concern (the two are orthogonal — sharing objects never reference RBAC objects):

  - **`@objectstack/plugin-security`** (RBAC) gains `sys_position`,
    `sys_permission_set`, `sys_user_permission_set`, `sys_position_permission_set`,
    and the `defaultPermissionSets` seed (which its `bootstrap-platform-admin`
    already consumes). The RBAC + default-permission-set tests move with them.
  - **`@objectstack/plugin-sharing`** gains `sys_record_share`,
    `sys_sharing_rule`, `sys_share_link`.
  - `@objectstack/platform-objects` no longer defines/exports any security
    objects; the `/security` subpath is now an empty barrel. Runtime is unchanged
    (both plugins already registered these objects at runtime).

  **D7 navigation** — the Setup app's `group_access_control` is now assembled from
  three sources: `plugin-security` contributes Roles / Permission Sets (priority
  100), `plugin-sharing` contributes Sharing Rules / Record Shares (priority 200),
  and `platform-objects` keeps only API Keys (`sys_api_key`, an identity object,
  priority 300) — preserving the original menu order.

  **i18n (D8)** — the objects are removed from the `platform-objects` i18n extract
  config; existing generated bundles keep working at runtime (object-name keyed).
  Migrating the i18n extraction to the owning plugins remains the tracked
  follow-up.

### Patch Changes

- 4404572: ADR-0029 D8 — migrate i18n ownership for the moved domains to their plugins.

  The object translations for the domains decomposed in K2.a/K2.b/K2 previously
  lived in the `@objectstack/platform-objects` generated bundles even though the
  objects now live in their capability plugins. This moves each domain's i18n
  extraction + bundles to the owning plugin, preserving every hand-translated
  string (zh-CN / ja-JP / es-ES):

  - Each plugin gains a build-time `scripts/i18n-extract.config.ts` and a
    `src/translations/` bundle (`{locale}.objects.generated.ts` + an `index.ts`
    barrel), generated with `os i18n extract` and self-baselined so re-runs
    preserve translations.
  - Each plugin loads its bundle at runtime on `kernel:ready` via
    `i18n.loadTranslations` (the i18n service is optional — load is best-effort).
    - `plugin-webhooks` ← `sys_webhook`, `sys_webhook_delivery`
    - `plugin-approvals` ← `sys_approval_request`, `sys_approval_action`
    - `plugin-security` ← `sys_position`, `sys_permission_set`,
      `sys_user_permission_set`, `sys_position_permission_set`
    - `plugin-sharing` ← `sys_record_share`, `sys_sharing_rule`, `sys_share_link`
  - `@objectstack/platform-objects` translation bundles are regenerated to drop
    those objects' keys (its extract config already excluded them); all other
    objects' translations and the metadata-form bundles are preserved.

  Net runtime effect is unchanged (same translations load, now contributed by the
  package that owns each object) — closing the D8 follow-up tracked since K2.a.

- 08fbbb4: Fix: the first-boot platform-admin promotion no longer gets stolen by the
  `usr_system` seed identity, and the dev seed admin uses fixed, well-known
  credentials.

  **`@objectstack/plugin-security` — `bootstrapPlatformAdmin` skips the system user**

  `5e831dea3` (#1392) added `ensureSeedIdentity` to the runtime SeedLoader,
  which upserts a non-loginable system identity (`usr_system`, role `system`,
  `system@objectstack.local`) to own seeded records — created _before_ the first
  human sign-up. Because `bootstrapPlatformAdmin` promoted the **earliest-created**
  `sys_user`, on any app that ships seed data `usr_system` won the promotion and
  the real admin login stayed at `role: user`. Login succeeded but Setup and
  Studio (gated by `setup.access` / `studio.access` on `admin_full_access`) were
  invisible — a silent, confusing regression.

  `bootstrap-platform-admin.ts` now filters out the system account
  (`id === SystemUserId.SYSTEM || role === 'system'`) when picking the first user
  to promote, and the "an admin already exists" short-circuit ignores any
  `admin_full_access` grant held by `usr_system` — so a database where it was
  wrongly promoted self-heals on the next boot.

  **`@objectstack/cli` — `os dev` seeds `admin@objectos.ai` / `admin123`**

  The `--admin-email` / `--admin-password` defaults changed from
  `admin@dev.local` / `admin12345` to the fixed, well-known
  `admin@objectos.ai` / `admin123`, so tooling and docs never have to guess the
  seeded credentials. Override with `--admin-email` / `--admin-password`.

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [4404572]
- Updated dependencies [eea3f1b]
- Updated dependencies [e478e0c]
- Updated dependencies [4cc2ced]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/platform-objects@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/platform-objects@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/platform-objects@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Major Changes

- 3a630b6: **Split organization-scoping from `@objectstack/plugin-security` into a new `@objectstack/plugin-org-scoping` package.**

  Per ADR-0002, "tenant" in ObjectStack means _physical_ isolation (one Environment = one database, handled by `@objectstack/driver-turso`'s multi-tenant router). The row-level `organization_id` scoping that previously lived inside SecurityPlugin is a different concept — _logical_ scoping inside a single DB — and now ships as its own plugin.

  ### Breaking changes — `@objectstack/plugin-security`

  - Removed the `multiTenant` constructor option. SecurityPlugin no longer touches `organization_id` on insert and no longer registers the `sys_organization` post-create seed pipeline.
  - Wildcard `current_user.organization_id` RLS policies in the default permission sets are now stripped UNLESS the new `org-scoping` service is registered (i.e. unless `OrgScopingPlugin` is also installed).
  - Removed export `cloneTenantSeedData` (now exposed as `cloneOrgSeedData` from `@objectstack/plugin-org-scoping`).
  - `bootstrapPlatformAdmin()` no longer accepts a `multiTenant` flag and no longer auto-creates a default organization — that behavior moved to `ensureDefaultOrganization()` in the new plugin.

  ### Migration

  Single-tenant deployments — no action required.

  Multi-tenant deployments (previously `new SecurityPlugin({ multiTenant: true })`):

  ```diff
  + import { OrgScopingPlugin } from '@objectstack/plugin-org-scoping';
    import { SecurityPlugin } from '@objectstack/plugin-security';

  + await kernel.use(new OrgScopingPlugin());     // MUST be BEFORE SecurityPlugin
  - await kernel.use(new SecurityPlugin({ multiTenant: true }));
  + await kernel.use(new SecurityPlugin());
  ```

  The runtime's `OS_MULTI_TENANT` env switch — read by `@objectstack/runtime/cloud/ArtifactKernelFactory`, `@objectstack/plugin-dev`, and the `objectstack` CLI's `serve` / `dev` / `start` commands — automatically registers `OrgScopingPlugin` when set to `true`, so projects driven by the CLI need no code changes.

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/platform-objects@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/platform-objects@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/platform-objects@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/platform-objects@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/platform-objects@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/platform-objects@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/platform-objects@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

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

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [888a5c1]
- Updated dependencies [2f9073a]
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/platform-objects@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/platform-objects@4.1.1

## 4.1.0

### Minor Changes

- d3b455f: Add server-side Field-Level Security write enforcement. Client-side
  ObjectForm / inline-grid already hides non-editable fields, but the
  SecurityPlugin middleware previously only enforced FLS on **read**
  (`maskResults` on find/findOne). Insert and update operations could
  target any field — a hand-crafted POST bypassed FLS entirely.

  The middleware now runs `FieldMasker.detectForbiddenWrites` on every
  insert / update payload (single record or bulk array) and throws
  `PermissionDeniedError` (HTTP 403) when the payload references a field
  the caller is not permitted to edit. The offending field list is
  exposed via `details.forbiddenFields` for actionable client error UI.

  Allow-list semantics: only fields explicitly enumerated in a
  permission set's `fields` map are constrained. System operations
  (`ExecutionContext.isSystem`) continue to bypass the check.

  Why throw vs. silently stripping: silent strip hides the boundary
  from honest clients (partial-save confusion) AND gives probing clients
  no signal that the field exists. Throwing makes the boundary
  observable in both directions.

  Also exposes `FieldMasker.detectForbiddenWrites(data, fieldPermissions)`
  as a standalone helper for callers that want to do the check
  out-of-band (e.g., adapters that strip-then-warn instead of fail-closed).

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/platform-objects@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6

## 2.0.5

### Patch Changes

- Unify all package versions with a patch release
- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5
