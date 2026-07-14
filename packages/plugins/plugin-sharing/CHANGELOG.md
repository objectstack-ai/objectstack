# @objectstack/plugin-sharing

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/formula@14.8.0
  - @objectstack/objectql@14.8.0

## 14.7.0

### Minor Changes

- d6a72eb: Field metadata gains a `widget` override (`FieldSchema.widget`) — names a
  registered form component (resolved as `field:<widget>`) to render a field with,
  overriding the default widget derived from `type` and degrading back to it when
  unregistered. The generic object form already honored this hint (objectui
  `ObjectForm`/`form.tsx` resolve `widget || type`); this promotes it to a
  first-class, liveness-classified authoring property so any config object can ask
  for a picker instead of a raw input.

  `sys_sharing_rule` uses it so the Setup **New Sharing Rule** form is
  pick-not-type instead of asking admins to hand-enter machine data:

  - `object_name` → `object-ref` (choose a registered object by name)
  - `criteria_json` → `filter-condition` (visual criteria builder scoped to the
    chosen object's fields; `dependsOn: object_name`)
  - `recipient_id` → `recipient-picker` (record picker whose target follows
    `recipient_type`; `dependsOn: recipient_type`)

  Also removes the `queue` recipient type: it is declared-but-unenforced (the
  evaluator expands no users for it), so offering it authored a silently-inert rule
  (ADR-0078). i18n bundles regenerated. Requires the matching objectui widgets; the
  fields degrade to their `type` renderer where those aren't loaded.

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/formula@14.7.0
  - @objectstack/objectql@14.7.0
  - @objectstack/platform-objects@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
- Updated dependencies [8f4a261]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/objectql@14.6.0
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

- 01274eb: **Security fix (#2851): the share-link HTTP routes no longer trust spoofable identity headers, and the service enforces ownership.**

  The raw-app share-link routes (`POST/GET/DELETE /api/v1/share-links`, registered by `SharingServicePlugin`) derived the caller from `x-user-id` / `x-tenant-id` request headers, and the service ignored the caller context on revoke. So a client could forge link attribution, enumerate another user's link tokens (`GET ?createdBy=<victim>` → tokens that resolve records under a system context, bypassing RLS), and revoke arbitrary users' links.

  Fixes:

  - **Verified identity.** `SharingServicePlugin` now derives the caller (and their positions/permissions) from the platform's verified resolution (`resolveAuthzContext` — session / API key / OAuth), never from headers. The route default is SECURE (anonymous). Create / list / revoke require a signed-in principal (401 otherwise); the public `/:token/resolve` route stays public (the token is the authorization) but keys its `audience: 'signed_in'` check off the verified session rather than a spoofable `x-user-id`.
  - **List scoping.** `GET /api/v1/share-links` is forced to the caller's own links — a client can no longer pass `?createdBy=<victim>` to enumerate others' tokens.
  - **Revoke ownership.** `revokeLink` now requires the caller to be the link's creator (system/internal callers bypass). Previously the caller context was ignored, so anyone could revoke any link (sharing DoS).
  - **Create access check.** `createLink` verifies the record is visible to the caller (read under the caller's own RLS) before minting a link — you can only share a record you can actually see. Internal (system) callers are unchanged.

  `ShareLinkExecutionContext` gains optional `positions` / `permissions` so the record-access check evaluates the real principal.

  Found by an adversarial security review of the request→ExecutionContext trust boundary (companion to the settings-routes fix, #2848).

### Patch Changes

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
  - @objectstack/objectql@14.5.0
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

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/objectql@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/formula@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [ff648ad]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/objectql@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/formula@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/formula@14.2.0
  - @objectstack/objectql@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/formula@14.1.0
  - @objectstack/objectql@14.1.0
  - @objectstack/platform-objects@14.1.0

## 14.0.0

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

- afa8115: ADR-0090 vocabulary leftovers (#2722, #2723, #2724) — the last "role"/"profile"
  surfaces are renamed one-step, no aliases (launch-window discipline).

  **`PortalSchema.profiles` → `positions`** (#2723, D2 removal miss). FROM → TO:
  `profiles: ['client_portal_user']` → `positions: ['client_portal_user']` —
  portal admission is now position-scoped; use the built-in `guest` position
  for anonymous-only portals. The removed `profiles` key is a loud tombstone:
  authoring it fails with the prescription instead of silently stripping. The
  showcase Client Portal is migrated and now admits a real declared position
  (`client_portal_user`).

  **`RLSUserContextSchema.role` → `positions`** (#2722, D3 rename miss). FROM →
  TO: `role: string | string[]` → `positions: string[]` — matches the runtime
  shape the RLS compiler resolves as `current_user.positions`. No runtime
  consumer read the old field (the compiler has its own context type); public
  export names are unchanged.

  **`sys_record_share.recipient_type` `'role'` → `'position'`** (#2724, D3).
  The record-share enum and the `ShareRecipientType` contract type now match
  the already-migrated spec zod enum. No stored-data migration is required:
  no reader expands non-`user` record-share rows (rules materialize per-user
  grants), so legacy `'role'` rows were inert. The plugin-sharing translation
  bundles are regenerated — fixing the pre-stale `sys_sharing_rule` options
  block too — with zh-CN/ja-JP labels patched per the generated-file contract
  (业务单元及下级 / ビジネスユニットと下位階層).

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [332b711]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [afa8115]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
  - @objectstack/spec@14.0.0
  - @objectstack/platform-objects@14.0.0
  - @objectstack/objectql@14.0.0
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

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [a1766fe]
- Updated dependencies [2bee609]
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/objectql@13.0.0
  - @objectstack/formula@13.0.0
  - @objectstack/platform-objects@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/formula@12.6.0
  - @objectstack/objectql@12.6.0
  - @objectstack/platform-objects@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/objectql@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/formula@12.5.0
  - @objectstack/platform-objects@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/objectql@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/formula@12.4.0
  - @objectstack/platform-objects@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [5a0da03]
- Updated dependencies [e7eceec]
  - @objectstack/objectql@12.3.0
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/formula@12.3.0
  - @objectstack/platform-objects@12.3.0

## 12.2.0

### Patch Changes

- 4f5b791: Wire three more Studio-authored metadata surfaces at runtime (#2605 — the
  "declared but never wired" family, following the #2596 hooks template).

  **Authored actions now execute (#2605 item 1).** `engine.executeAction`'s map
  was only ever populated from the app bundle at boot, so a published `action`
  row (standalone or embedded in an authored object's `actions[]`) was stored
  and listed but never executable — before OR after a restart. Now:

  - `AppPlugin` installs a QuickJS-sandboxed default action runner at boot
    (`engine.setDefaultActionRunner`), the action-path twin of the #2596 hook
    body runner. Opt out with `OS_DISABLE_AUTHORED_ACTIONS=1`.
  - `ObjectQLPlugin` re-registers runtime-authored actions from their
    `sys_metadata` rows under `packageId: 'metadata-service'` at
    `kernel:ready`, on `metadata:reloaded`, and on `action`/`object` protocol
    mutations — saves, publishes, edits, and deletes take effect live.
    Package-artifact actions are excluded (AppPlugin owns those; re-registering
    would clobber their handlers).

  **Authored translations reach the i18n runtime (#2591).** `translation`
  metadata items (single-locale `AppTranslationBundle` payloads; locale from
  `_meta.locale`, a top-level `locale`, or a BCP-47-shaped item name) now load
  into the i18n service as a separate authored layer that overlays static
  bundles. Both adapters carry the layer — service-i18n's `FileI18nAdapter`
  AND the kernel's in-memory fallback (`createMemoryI18n`), which is what dev
  and standalone stacks actually run. The shared sync
  (`wireAuthoredTranslationSync`, exported from `@objectstack/core`, wired by
  the runtime's AppPlugin and by I18nServicePlugin with single-owner
  semantics) runs at `kernel:ready`, on `metadata:reloaded`, and on
  `translation` protocol mutations, with clear-then-reload semantics so
  deleted items/keys stop resolving instead of lingering in the deep-merged
  map.

  **Sharing rules created at runtime bind without a restart (#2592).**
  `bindRuleHooks` was boot-only, so the first rule authored at runtime for an
  object with no boot-time rule silently never evaluated (rule authoring is a
  data insert — `metadata:reloaded` never fires). The sharing plugin now binds
  afterInsert/afterUpdate/afterDelete triggers on `sys_sharing_rule` that
  unbind + re-bind the rule-hook package from a fresh `listRules()`, serialized
  so overlapping writes can't leave a stale snapshot bound, and fail-safe so a
  rebind failure never fails the rule write.

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/objectql@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/formula@12.2.0
  - @objectstack/platform-objects@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/formula@12.1.0
  - @objectstack/objectql@12.1.0
  - @objectstack/platform-objects@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [7c09621]
- Updated dependencies [2d567cb]
- Updated dependencies [24b62ee]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [c2fdbf9]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/platform-objects@12.0.0
  - @objectstack/objectql@12.0.0
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
  - @objectstack/objectql@11.10.0
  - @objectstack/platform-objects@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/formula@11.9.0
  - @objectstack/objectql@11.9.0
  - @objectstack/platform-objects@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/objectql@11.8.0
  - @objectstack/formula@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/formula@11.7.0
  - @objectstack/objectql@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/objectql@11.6.0
- @objectstack/formula@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/objectql@11.5.0
  - @objectstack/platform-objects@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/objectql@11.4.0
  - @objectstack/platform-objects@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/objectql@11.3.0
  - @objectstack/platform-objects@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/formula@11.2.0
  - @objectstack/objectql@11.2.0
  - @objectstack/platform-objects@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [cbc8c02]
- Updated dependencies [07c2773]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [13dbcf2]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/objectql@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/formula@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [4d99a5c]
- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
- Updated dependencies [ab5718a]
- Updated dependencies [61d441f]
- Updated dependencies [c224e18]
- Updated dependencies [d616e1d]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [359c0aa]
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
  - @objectstack/objectql@11.0.0
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/formula@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- Updated dependencies [211425e]
  - @objectstack/objectql@10.3.0
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
  - @objectstack/objectql@10.2.0
  - @objectstack/platform-objects@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/formula@10.1.0
  - @objectstack/objectql@10.1.0
  - @objectstack/platform-objects@10.1.0

## 10.0.0

### Major Changes

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

### Minor Changes

- 30c0313: Add `sys_user.primary_business_unit_id` projection (ADR-0057 addendum D12).

  Adds a denormalised `primary_business_unit_id` lookup to `sys_user`, maintained
  by plugin-sharing as a projection of `sys_business_unit_member.is_primary`
  (insert/update/delete hooks + a boot-time backfill). This makes "pick people by
  business unit" — the Dataverse _filtered lookup_ / ServiceNow _reference
  qualifier_ interaction — expressible as a plain `where: { primary_business_unit_id: X }`
  (and thus as a `lookupFilters` picker filter) with **zero** query-engine change,
  without traversing the membership junction. `sys_business_unit_member` remains
  the effective-dated, matrix-friendly source of truth; the new column is a
  maintained projection, not a second source. Home is plugin-sharing (always
  loaded, owns the BU graph) rather than plugin-org-scoping, so the projection
  works in single-tenant deployments too. Picker filtering by BU is therefore an
  **open** (non-enterprise) capability — only hierarchy _rollup_ stays paid.

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

### Patch Changes

- ce13bb8: Single-tenant audit follow-ups (ADR-0057):

  - **`sys_member` / `sys_invitation`**: make `organization_id` optional (same class as the
    sys_business_unit/sys_team fix #2178). Single-tenant has no org row and no auto-stamp;
    multi-tenant still auto-stamps via OrgScopingPlugin with null-org rows hidden by
    tenant-isolation RLS (fail-closed). Completes the org-scoped identity graph's
    single-tenant consistency.
  - **`BusinessUnitGraphService.headOf()`**: add the missing `orgScope()` org filter (it
    queries under SYSTEM_CTX, bypassing RLS, so the scope is the only isolation). Previously
    `headOf(buId)` read a business unit's `manager_user_id` by id alone — a cross-organization
    leak in multi-tenant. Now consistent with `descendants()`. +regression test.

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
  - @objectstack/objectql@10.0.0
  - @objectstack/platform-objects@10.0.0
  - @objectstack/formula@10.0.0
  - @objectstack/core@10.0.0

## 9.11.0

### Minor Changes

- 2365d07: feat(sharing): configurable role-hierarchy widening — `unit_and_subordinates` recipient (ADR-0056 D6)

  Role-hierarchy access widening ("a manager sees records shared with their team") is now
  **implemented and configurable per sharing rule**, not a hardcoded no-op. The
  `unit_and_subordinates` recipient (declarable on `sys_sharing_rule.recipient_type`) expands,
  at evaluation time, to the named role **plus every subordinate role** by walking the
  `sys_position.parent` hierarchy via a new `PositionGraphService` (mirroring the department/team
  graphs; cycle-safe). Previously `Role.parent` was declared but never consumed — a silent
  no-op flagged by the ADR-0056 audit. This is the Salesforce "grant access using hierarchies"
  model expressed declaratively: each rule chooses whether to roll up the hierarchy. Unit-proven
  (role-graph traversal, subordinate-user expansion, cycle safety); the recipient is added to
  the authoring select + the `SharingRuleRecipientType` contract.

### Patch Changes

- e7f6539: feat(spec,sharing): canonical OWD vocabulary on `object.sharingModel` (ADR-0056 D1)

  Reconciles the Org-Wide-Default naming so authors use ONE vocabulary. `object.sharingModel`
  now accepts the canonical OWD names — `private` | `public_read` | `public_read_write` |
  `controlled_by_parent` — alongside the legacy `read` / `read_write` / `full` aliases (kept,
  non-breaking). The sharing runtime maps them onto the three enforced behaviours
  (`public_read` ≡ legacy `read` = everyone reads / owner writes; `public_read_write` =
  unscoped). Unknown values remain rejected by the enum (authoring-time, fail-closed). The
  showcase announcement now declares the canonical `public_read`, exercised end-to-end by the
  public-read dogfood proof.

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/objectql@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/platform-objects@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
- Updated dependencies [fd07027]
  - @objectstack/spec@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/objectql@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/objectql@9.9.1
- @objectstack/platform-objects@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [44c5348]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [bfa3102]
- Updated dependencies [134043a]
- Updated dependencies [67c29ee]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [d99a75a]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/objectql@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/platform-objects@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [76ac582]
- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
- Updated dependencies [884bf2f]
  - @objectstack/objectql@9.8.0
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/platform-objects@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/objectql@9.7.0
- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
- Updated dependencies [b04b7e3]
- Updated dependencies [d13df3f]
  - @objectstack/spec@9.6.0
  - @objectstack/objectql@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/platform-objects@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/objectql@9.5.1
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
  - @objectstack/objectql@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [c1dfe34]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [3e675f6]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/objectql@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/platform-objects@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [6259882]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
- Updated dependencies [b10aa78]
- Updated dependencies [2796a1f]
  - @objectstack/spec@9.3.0
  - @objectstack/objectql@9.3.0
  - @objectstack/platform-objects@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/objectql@9.2.0
  - @objectstack/platform-objects@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/objectql@9.1.0
  - @objectstack/platform-objects@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/objectql@9.0.1
  - @objectstack/platform-objects@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/objectql@9.0.0
  - @objectstack/platform-objects@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/objectql@8.0.1
- @objectstack/platform-objects@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [e6374b5]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
- Updated dependencies [345e189]
  - @objectstack/spec@8.0.0
  - @objectstack/objectql@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/platform-objects@8.0.0

## 7.9.0

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
  - @objectstack/objectql@7.9.0
  - @objectstack/spec@7.9.0
  - @objectstack/core@7.9.0
  - @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [6fc2678]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/objectql@7.8.0
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
  - @objectstack/objectql@7.7.0
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
  - @objectstack/objectql@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/objectql@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/objectql@7.4.1
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
- Updated dependencies [2faf9f2]
- Updated dependencies [a6d4cbb]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/objectql@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/objectql@7.3.0
  - @objectstack/platform-objects@7.3.0

## 7.2.1

### Patch Changes

- Updated dependencies [9096dfe]
  - @objectstack/objectql@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1
  - @objectstack/platform-objects@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/objectql@7.2.0
- @objectstack/platform-objects@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/objectql@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

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
  - @objectstack/objectql@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/objectql@6.9.0
- @objectstack/platform-objects@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/objectql@6.8.1
- @objectstack/platform-objects@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/objectql@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/objectql@6.7.1
- @objectstack/platform-objects@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/objectql@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/objectql@6.6.0
  - @objectstack/platform-objects@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/objectql@6.5.1
- @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/objectql@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/objectql@6.4.0
  - @objectstack/platform-objects@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/objectql@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/objectql@6.2.0
  - @objectstack/platform-objects@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/objectql@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/objectql@6.1.0
  - @objectstack/platform-objects@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/objectql@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/objectql@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/objectql@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [5e9dcb4]
- Updated dependencies [f139a24]
- Updated dependencies [4eb9f8c]
- Updated dependencies [2f7e42a]
- Updated dependencies [602cce7]
- Updated dependencies [1e625b8]
- Updated dependencies [6ee42b8]
- Updated dependencies [888a5c1]
- Updated dependencies [5cfdc85]
- Updated dependencies [09f005a]
- Updated dependencies [7825394]
- Updated dependencies [96ad4df]
- Updated dependencies [2f9073a]
  - @objectstack/objectql@5.0.0
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/objectql@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/platform-objects@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/objectql@4.1.1
- @objectstack/platform-objects@4.1.1

## 4.0.1

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
- Updated dependencies [5683206]
- Updated dependencies [f0b3972]
- Updated dependencies [0e63f2f]
  - @objectstack/spec@4.1.0
  - @objectstack/objectql@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0
