# @objectstack/plugin-security

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
