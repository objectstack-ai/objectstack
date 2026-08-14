# @objectstack/plugin-sharing

## 17.0.0

### Major Changes

- 4b6cac7: feat(spec)!: resolve the three cross-form dual-source names — ShareRecipientType, TransformType, suggestFieldType (#4539)

  Three `dual-source-exports.baseline.json` rows where the two declarations
  sharing a name did not even share a FORM (type vs const, or two unrelated
  functions), so a wrong import-path pick had no shape overlap to hide behind
  and failed far from the cause. Each judged against a three-repo import-level
  scan (framework, cloud, objectui — the latter two contained zero references
  to all three names). All three rows are deleted from the baseline.

  **Renamed — `./contracts` `ShareRecipientType` → `RecordShareRecipientType`:**

  Two live concepts shared the name. The security zod enum
  (`user | team | position | unit_and_subordinates | business_unit`) is the
  authorable sharing-RULE recipient vocabulary and keeps the name. The contracts
  type describes a different thing — the `recipient_type` a `sys_record_share`
  ROW may carry — and its claim to "mirror spec/security" had been false since
  `group`→`team`/`guest` were retired there. Its member set is now aligned to
  the storage-side gate it actually mirrors, the `SysRecordShare`
  `recipient_type` select: `role` (never persistable, zero producers) is
  replaced by `position`. Only `user` is enforced (and written) today;
  `ISharingService.grant` keeps refusing every other value (ADR-0078).
  Fix: `import type { ShareRecipientType } from '@objectstack/spec/contracts'`
  (or from `@objectstack/plugin-sharing`, whose re-export is renamed in
  lockstep) → `RecordShareRecipientType`; code that named the `'role'` member
  was describing a value no row could ever hold — use the rule vocabulary
  (`SharingRuleRecipientType`) if a role recipient was meant.

  **Renamed — `./shared` `TransformTypeSchema` / `TransformType` →
  `FieldMappingTransformSchema` / `FieldMappingTransform`:**

  `./data`'s `TransformType` (the authorable import-mapping enum
  `none | constant | lookup | split | join | javascript | map`) is the live
  declaration and keeps the name. `./shared` exported `TransformType` as the
  inferred type of `TransformTypeSchema` — a differently-shaped discriminated
  union of transform CONFIG objects — with zero importers for either name in
  all three repos. The shared pair is renamed (not just the alias deleted):
  the docs generator derives `import type { X }` examples by stripping
  `Schema` from each schema const, so an alias-less `TransformTypeSchema`
  would have kept generating a reference to an export that no longer exists.
  Fix: `TransformTypeSchema` → `FieldMappingTransformSchema`,
  `import type { TransformType } from '@objectstack/spec/shared'` →
  `FieldMappingTransform` (same shape); importers who meant the import-mapping
  enum import `TransformType` from `@objectstack/spec/data`.

  **Renamed — `./data` `suggestFieldType` → `suggestFieldTypeForSqlType`:**

  The only function-kind dual-source. The two implementations were never forks
  of one function — different signatures, semantics and return types:
  `shared/suggestions.zod.ts` (kept on `.` / `./shared` under the original
  name) is the typo-suggester for an invalid authored FieldType
  (`(input: string) => string[]`, alias table + Levenshtein, feeds the zod
  error map), while `data/type-compat.ts` is the deterministic SQL-column →
  FieldType mapper for external-datasource drafts
  (`(rawType, dialect?) => FieldType | undefined`, ADR-0015 §4.6). Same input,
  divergent outputs — `('varchar(255)')` → `[]` vs `'text'`; `('text_area')` →
  `['textarea']` vs `undefined`; `('int')` → `['number']` vs `'number'` — and
  the wrong pick compiled wherever the result was only truthiness-checked
  (`[]` is truthy). Behavioral divergence is now pinned in
  `data/type-compat.test.ts`.
  Fix: `import { suggestFieldType } from '@objectstack/spec/data'` →
  `suggestFieldTypeForSqlType` (same signature); imports from the root entry
  or `./shared` are unaffected.

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

- e5e8b10: feat(sharing): a record's share-manager may revoke any share-link on that record (ADR-0111 D8)

  `ShareLinkService.revokeLink` was creator-or-system only, so a record's owner or
  a Modify-All admin could not kill a link someone else minted on their record —
  their record's exposure, but not their link to revoke. Revoke authority now
  also admits a record **share-manager**, probed via the sharing service's
  late-bound `canManageShares` (owner / `modifyAllRecords`). The probe fails
  closed: a deployment without it (or a throwing probe) keeps the pre-D8
  creator-only behaviour. Mint authority is unchanged and now documented as the
  D8 decision it always enforced — the object's `publicSharing` opt-in AND the
  caller's visibility of the record.

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

- dadd1ad: refactor(spec,plugin-sharing): retire the exported `SharingExecutionContext` type (#7218)

  <!-- adr-0087: registered sharing-execution-context-retired -->

  **BREAKING — public surface removal.** `SharingExecutionContext` is deleted from
  `@objectstack/spec` (`contracts/sharing-service`) and from
  `@objectstack/plugin-sharing`, which re-exported it. Both `api-surface/` and
  `export-origins/` snapshots are regenerated accordingly.

  This is the deferred deletion recorded when #7070 split the convergence in two.
  #6523 / PR #7068 converged 36 contract signatures onto the full
  `resolveAuthzContext` envelope (`ExecutionContext`), applying the #6206 ruling —
  enforcement adjudicates on the whole envelope, never a per-site subset. The
  consumer halves then re-annotated the implementations: PR #7140 (identity:
  `plugin-sharing`, `plugin-audit`) and PR #7206 (services: `plugin-approvals`,
  `plugin-reports`). Both landed with the type still exported, because it is
  DEFINED in `packages/spec` and that package's retirement is the spec seat's to
  make. Nothing declares it any more, so it goes.

  **Migration.** Anyone who imported `SharingExecutionContext` from either package
  should import `ExecutionContext` from `@objectstack/spec` instead — the type the
  contracts have declared since #7068. The old shape was six optional fields, all
  of which exist on the envelope with the same names and types, so a value that
  satisfied the retired type already satisfies `ExecutionContext`; only the
  spelling of the annotation changes.

  **No runtime behaviour changes.** The type was erased at compile time and no
  signature's accepted shape moved: the contracts already took the wide envelope.

  **What the retirement did NOT remove — the reason to read the pins.** Deleting
  the type does not make re-narrowing a compile error. Structural subtyping still
  accepts a six-field context where the envelope is expected, so the boundary is
  held by the declared parameter type plus the pins, exactly as before. The three
  `exec-context-annotation.pin.ts` files (`plugin-sharing`, `plugin-approvals`,
  `plugin-reports`) told their failure story as "the parameter narrows back to
  `SharingExecutionContext`", which a deletion would have quietly hollowed out.
  Each now keeps the retired six-field shape as a local, non-exported SPECIMEN
  type and refutes every enforcement parameter against it by type identity, so a
  re-narrowing under ANY name is red — alongside the fresh-literal
  excess-property checks they already carried. `sharing-service.test.ts` in
  `packages/spec` is re-anchored the same way, and its "twin unchanged in shape"
  case becomes a "twin stays retired" case. The narrative the retired type's doc
  block carried (the measured `(context as any).posture` specimen, and why tsc
  cannot police this) moves to the module doc of `contracts/sharing-service`,
  which the contracts and pins now point at.

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

- ccd9397: fix(security)!: a sharing rule with no criteria now shares NOTHING instead of every record (#3896)

  `SharingRuleSchema` has always required `condition`, and its doc is explicit
  that a predicate the compiler cannot lower is _"skipped and logged — never
  seeded as a permissive match-all (ADR-0049)"_. The declared/seed path honoured
  that. The two other ways to create a rule did not:

  - **`POST {basePath}/sharing/rules`** plucks its body field-by-field into
    `SharingRuleService.defineRule`, which validated `name` / `label` / `object` /
    `recipientType` / `recipientId` — and not `criteria`. A missing, `null`, or
    **misspelled** key (`criterias`) was stored as `criteria_json: null`, answered
    `201` with no warning, and evaluated as
    `find(object, { filter: {}, context: SYSTEM_CTX })`: every record of the
    object, up to 5000, granted to the recipient. Triggering it took a typo, not
    an attacker.
  - **Authoring a rule in Setup** is a direct `sys_sharing_rule` insert, which
    never reaches `defineRule` at all.

  Empty criteria is now rejected everywhere a rule can be written, and — because
  rules created before this gate are already in the table — the evaluator refuses
  to act on one regardless of how it got there.

  - **`defineRule` rejects a match-all criteria** with
    `VALIDATION_FAILED: criteria is required …`, alongside its other required
    fields. Covers the REST endpoint, programmatic callers, and the seeder.
    Rejected shapes: missing / `null` / `''` / `{}` / `[]` / `{ $and: [] }` /
    unparsable JSON (e.g. a CEL source typed into the Criteria box).
  - **The evaluator matches nothing** for such a rule and logs why, so a row
    stored before this release under-shares instead of over-sharing: the next
    reconcile _revokes_ the grants it had materialised. Both evaluation paths are
    covered — the bulk `evaluateRule` and the per-record write-hook path.
  - **`bindRuleCriteriaGuard`** fails `sys_sharing_rule` inserts with no
    criteria as a field-level `VALIDATION_FAILED` (a 400 naming `criteria_json`),
    so the Setup path reports the problem instead of saving an inert rule
    (ADR-0078). Updates are checked only when the patch supplies
    `criteria_json` — switching an over-broad legacy rule off must not require
    inventing a criteria for it first.
  - **The seed bootstrap's "empty condition = match-all" branch is gone**: a
    missing or empty `condition` is now skipped and logged like any other
    non-lowerable one.
  - `POST {basePath}/sharing/rules` also accepts `criteria_json` as an alias for
    `criteria`, matching the snake_case aliases the endpoint already takes for
    `object_name` / `recipient_type` / `access_level`.

  **Migration.** There is no "share every record" sharing rule, and there never
  usefully was one — the shape existed only as a failure mode. A rule that
  relied on it must state its predicate (`criteria: { stage: 'won' }`), or, if
  the object really should be readable by everyone, use the object's
  organization-wide default (`sharingModel`) instead. Rules already stored with
  a null `criteria_json` need no data migration: they stop granting on the next
  evaluation and their existing grants are revoked.

- 503be86: feat(security)!: reconcile the SharingRule authoring surface with the enforced runtime — rename `group` → `team`, add `business_unit`, prune `guest` + owner-type rules (#1878)

  The authoring `ShareRecipientType` enum had drifted behind the ADR-0090 D3
  rename and the enforced runtime: the runtime expands `team` (via
  `sys_team`/`sys_team_member`) and `business_unit`, but the authoring enum
  still offered the pre-rename `group` (silently skipped at seed time) and
  omitted the two live recipients. After this change **every authorable
  recipient and rule type is enforced** — nothing on the SharingRule surface
  validates and then silently does nothing (ADR-0078).

  - **`sharedWith.type: 'group'` → `'team'`** (wire-rename): the enum member is
    renamed to match the runtime vocabulary and now maps through the seed
    bootstrap to the live `TeamGraphService` expansion. Flat `sys_team`
    membership; enforced.
  - **`business_unit` added** to the authoring enum — exactly one business
    unit's members (no subtree; use `unit_and_subordinates` for the subtree).
    The runtime + bootstrap already enforced it; only the enum omitted it.
  - **`guest` removed** — it had no runtime recipient mapping. Anonymous access
    is served by the public-form grant and share links, not sharing rules.
  - **Owner-type rules removed** (`type: 'owner'`, `ownedBy`,
    `OwnerSharingRuleSchema` + its type export): they depend on live
    team/position membership, which the static materialiser cannot track, so
    they validated but never materialised a share. They return as an enforced
    form if membership-reactive re-materialisation is designed.
    `SharingRuleSchema` is now the criteria form; the `queue` recipient stays
    runtime-reserved (no `sys_queue` yet) and deliberately non-authorable.

  **Migration** (stale definitions now fail parse with the valid options listed):

  - `sharedWith: { type: 'group', … }` → `sharedWith: { type: 'team', … }`.
  - `sharedWith: { type: 'guest', … }` → delete the rule; expose the records
    via a public form or share link instead.
  - `type: 'owner'` rules → rewrite as a `type: 'criteria'` rule scoping the
    rows by field values (see the migrated examples:
    `share_open_tasks_with_manager` in app-showcase,
    `share_active_leads_with_manager` in app-crm), or use a scope-depth grant.

  <!-- adr-0087: registered sharing-rule-recipient-reconcile -->

- ba5ff2f: fix(plugin-sharing): deactivating or deleting a sharing rule actually withdraws its grants (#4433, #4434)

  An over-granting sharing rule had no withdrawal path on the product's API
  surface. Deactivating it left every grant it had materialised in place — not on
  the next record touch, not after a full restart — and the DELETE route answered
  500 for both address forms it advertises, so the rule could not be removed
  either. Together that made a too-broad rule unrecoverable short of hand-editing
  `sys_record_share`, against a v17 release note that advertises the opposite
  ("switching a rule off actually withdraws access").

  `minor`, not `patch`: this changes an observable runtime behaviour that
  deployments may have adapted to. A `source: 'rule'` grant whose rule is
  inactive — or whose rule row is gone — now disappears, on the deactivating
  write, on the next touch of the record, and on the next boot. Anything relying
  on those rows surviving deactivation (including data repaired by hand around
  the old behaviour) will see them revoked on upgrade. `DELETE
/api/v1/sharing/rules/:idOrName` also starts succeeding where it used to 500,
  so callers that treated that 500 as "unsupported" will now really delete.

  #4433 — three independent gaps, one per path the report walked:

  - **The deactivating write.** The `sys_sharing_rule` reconcile trigger skipped
    every `isSystem` write, on the theory that those were boot seeding.
    `SharingRuleService.defineRule` — the only implementation behind
    `POST /sharing/rules`, and the documented way to deactivate a rule — writes
    with SYSTEM_CTX unconditionally, because it must reach a platform table the
    sharing middleware otherwise gates. So the skip caught 100% of REST
    authoring: the withdrawal path built by #3821 existed, had tests (against a
    mocked session the real path never sends), and was unreachable in production.
    Now gated on boot phase, which is the question the skip actually meant to
    ask.
  - **The record touch.** `evaluateAllForRecord` listed only active rules, so a
    deactivated rule was absent from the loop entirely and its grants were never
    examined. It now reconciles every rule; an inactive one desires nothing and
    takes the existing revoke-the-remainder branch.
  - **The boot pass.** `backfillRuleGrants` was handed an `activeOnly` list,
    making it structurally incapable of revoking anything. It now walks every
    rule, and a new `sweepOrphanedRuleGrants` retires grants whose rule row is
    gone entirely — unreachable by rule iteration, so they need their own sweep.

  #4434 — `deleteRule` purged `sys_record_share` with a predicate-shaped
  `engine.delete` carrying neither a scalar id nor `multi: true`, the one shape
  the engine's dispatch refuses; it threw before ever reaching the rule row.
  Fixed by routing through the same `SharingService.revoke` path every other
  withdrawal already uses, rather than adding `multi: true` — a rule's grants now
  retire exactly one way instead of two divergent ones.

  The unit fakes are part of the fix: `makeEngine().delete` accepted any `where`,
  which is why #4434 shipped green — the pre-existing "deleteRule drops rule and
  all its grants" test asserted success against a delete the running server
  always rejected. The fakes now mirror the real engine's dispatch guard.

- 54299ca: feat(sharing): `ISharingService` 的每行写判定补三态 —— 放行 / 不表态 / 拒绝(#6428)

  #5492 的维护者裁决(2026-08-07,B 案)分两步兑现两种已声明的写扩权,本次是 **step 1:
  契约与默认实现**。plugin-security 前像门的 provenance 分层合成是 step 2,本次一行未动。

  **为什么二态不够(实测,不是推演)。** `canEdit()` 用同一个 `true` 表达了两件事 ——
  「我有依据放行」与「本服务对这一行根本不设门」。对只**追加**一道门的调用方(sharing
  中间件、`sys_attachment` 父记录门、ADR-0055 master 判定)这没问题:`true` = 「我不拦
  你」。对让这个答案去**顶替另一个权威的地板**的调用方就是 fail-open —— #5492 的 E2 实验
  把前像写门委托给 `canEdit()` 后,在**没有 `owner_id` 列**的对象上,普通成员跨 creator
  的 UPDATE 变成 `ok: true`(main 上是 403),因为平台的 `created_by` 所有权地板正是这类
  对象唯一的行级写门,而一个「不表态」的 `true` 把它盖掉了。

  **新增契约面**(`@objectstack/spec/contracts`):

  - `SharingWriteVerdict = 'allow' | 'abstain' | 'deny'` —— 闭合联合,普通 TS 类型
    (非 zod 派生,不进 ADR-0122 的 pin 计数)。
  - `ISharingService.checkEdit()` / `checkDelete()` —— 三态主形态,动作边界照 ADR-0111 D3
    继承:`edit` 级共享让 `checkEdit` 答 `allow`、同一行 `checkDelete` 仍答 `deny`;两者
    的 `abstain` 集合完全相同(两道门对「哪些对象由共享设门」意见一致,只在动词上分歧)。

  **兼容:`canEdit()` / `canDelete()` 原样保留,语义零漂移。** 它们被定义为三态的
  **投影** `verdict !== 'deny'` —— 从前对 public / 无 owner 字段 / bypass 对象返回的那个
  `true`,现在落在 `abstain` 上,投影回来仍是 `true`。真值表逐分支被测试钉住(9 个分支
  × 两个动词),因为 `resolveSharingCanEdit`(plugin-security)与 `sys_attachment` 父记录
  门读的正是这一列,翻掉任何一格都是本 PR 未触及的包里的静默权限变更。

  **fail-closed 落点:查询失败是 `deny`,永远不是 `abstain`。** 两者对合成方是相反的指令
  (`abstain` 把这一行交给另一个权威,`deny` 就地终结),把失败读成「没有意见」正是造出上述
  fail-open 的那个混淆。默认实现把所有权查询与共享查询整段包在 fail-closed 分支里,并
  `logger.error` 记名,不静默吞。

  **行为变化(一处,方向收紧)**:引擎查询抛错时,`canEdit`/`canDelete` 从**向外抛**改为
  返回 `false`。两个既有调用点本来就在自己那侧 catch 成 `false`(`resolveSharingCanEdit`
  的 #5386 fail-closed、attachment hook 的降级读),所以对它们是同一结果;其余调用点由
  「异常中止写入」变成「403 拒绝写入」,严格不更宽松。

  **解锁**:#5492 step 2 的前像门可以按 provenance 分层合成 —— `abstain` 回落平台所有权
  地板、`allow` 按声明顶替地板、`deny` 维持拒绝 —— 而不必在 security 侧重算一份
  owner/depth/share/bypass(那会是同一契约的第二份实现)。#5491 与 #5492 同批落地。

### Patch Changes

- 32f7188: Recompute `unit_and_subordinates` / `business_unit` sharing-rule grants when the business-unit graph changes.

  **Security:** read access granted through a business-unit sharing rule is now withdrawn immediately when the business unit is moved out of the shared subtree, deactivated or deleted, or when the membership row is removed — previously it survived until the shared record happened to be written next, which put no bound at all on how long a revoked recipient kept reading the record.

  The sharing-rule recompute hooks were registered only on each rule's own object, and nothing was registered on `sys_business_unit` or `sys_business_unit_member`. A rule whose recipient resolves through the business-unit tree therefore never re-materialised its `sys_record_share` grants when the tree or a membership moved. Writes to both tables now drive a recompute: the withdrawal is synchronous and complete before the write returns (scoped by recipient, so it needs no scan of the records the rule matches), and the grant direction — a unit moved _into_ a shared subtree — is queued on the existing re-grant queue.

  Only recipient kinds that actually read the business-unit graph are recomputed (`business_unit`, `unit_and_subordinates`); `user`, `team`, `position` and `queue` rules are untouched by a business-unit write.

- 9b51981: fix(plugin-sharing): the `business_unit` sharing-rule recipient expands exactly one unit, not its whole subtree (#7807)

  ⚠️ **This is an intentional over-grant fix, and it REDUCES visible rows for any
  deployment that authored `business_unit` sharing rules.** Read the migration note
  below before upgrading if you use that recipient kind.

  ## What was wrong

  The two business-unit recipient kinds were **declared** as two different widths
  and **enforced** as the same width. `SharingRuleService.expandRecipient` routed
  both through the identical `BusinessUnitGraphService.expandUsers` call, whose
  first act is a BFS over `parent_business_unit_id` — so the two branches differed
  only in their comments.

  A rule authored as `recipient_type: 'business_unit'`, which the authoring spec
  (`ShareRecipientType`), the org-axis lint red-line table and ADR-0057 D5 all
  describe as _"exactly one business unit's members (no subtree)"_, in fact reached
  that unit **plus every descendant unit's members**. On a three-level tree a rule
  anchored at a division silently granted to every department and office beneath
  it.

  Two consequences, and the second is why this is filed as security rather than
  tidiness: the narrow spelling over-granted **silently**, which is the worst
  failure shape for generated security metadata (an agent that asks for the narrow
  grant should get the narrow grant); and `unit_and_subordinates`, documented as
  the _strictly wider_ grant of the pair, was not wider at all, leaving the
  distinction the lint red-line draws unenforceable in practice.

  ## What changed

  `business_unit` now resolves through a new
  `BusinessUnitGraphService.expandUnitMembers()` — members whose
  `business_unit_id` equals the named unit, with no descent. It keeps every other
  guarantee the subtree walk had: an inactive or out-of-tenant anchor unit
  contributes nobody, and an unreadable unit fails closed rather than granting.

  `unit_and_subordinates` is **unchanged** and keeps the subtree walk — it is the
  kind whose declared semantics _is_ the hierarchy widening (ADR-0057 D5). The two
  kinds remain two kinds; neither is merged into the other or retired.
  `expandUsers()` also keeps its meaning for the `bu:` approver prefix and org
  rollups, which are subtree consumers by contract.

  Grant recomputation on business-unit graph writes (#7729) still covers both
  recipient kinds, because a unit-only expansion still reads `sys_business_unit`
  for its anchor's `active` flag and tenant scope and `sys_business_unit_member`
  for its members. What changed there is blast radius, not coverage: re-parenting a
  unit no longer moves a `business_unit` rule's recipients, while deactivating the
  anchor or editing its membership still does.

  ## Migration

  **In-tree cost is zero** — no shipped example app or seeded rule authors
  `business_unit` (the showcase and CRM apps use `position` and
  `unit_and_subordinates`), so nothing in this repository changes behaviour.

  **Out-of-tree deployments:** if you authored a `business_unit` rule and were
  relying — knowingly or not — on it reaching descendant units, those descendant
  members **lose the grants that rule materialised**. Grants are reconciled on the
  next evaluation pass, so the reduction lands without any action on your part.

  If the subtree reach was what you actually wanted, change the rule's recipient to
  `unit_and_subordinates`, which has always meant exactly that and is unaffected by
  this release. If you wanted the narrow grant, you now have it.

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

- 7df7c64: feat(sharing): `sys_sharing_rule.criteria_json` is declaratively required (ADR-0113 P2)

  The field the ADR was written for: `required: true` as the write contract —
  insert must provide, update may not null out, legacy null rows rest, an admin
  can still `active: false` an over-broad legacy rule. Deliberately NO
  `storage.notNull`: deployed tenants' legacy nulls are the case the split
  exists for. The Setup form's required marker and client validation now derive
  from the declaration.

  Not breaking: a rule without criteria was already rejected by the #3929 hook
  guard; the guard narrows to the non-null match-all shapes `required` cannot
  express ('{}', vacuous $and/$or, unparsable JSON), `defineRule` keeps the API
  seam, and the evaluator stays fail-closed (ADR-0049).

- b5f9397: fix(sharing,runtime): a `sort` passed straight to the engine never ordered anything; migrate every in-repo engine call to canonical QueryAST keys (#4346)

  Two changes with different weights, from one sweep of every in-repo engine
  call site that still speaks a deprecated alias.

  **The bug — three dropped sorts.** #4346 made the engine fold `filter`→`where`
  and `top`→`limit` on all six methods. The other four pairs in
  `RPC_QUERY_ALIAS_SLOTS` (`select`, `sort`, `skip`, `populate`) are folded at
  the RPC/wire layer only — their values need shape lowering that belongs to
  those layers — and a **direct `engine.find()` never crosses that layer**. Three
  call sites passed `sort` there, so it rode onto the AST untouched, every
  driver's `Array.isArray(query.orderBy)` guard declined to emit an ORDER BY, and
  the query returned an ordinary-looking, arbitrarily-ordered result:

  | call site                           | asked for                                         | actually got                |
  | ----------------------------------- | ------------------------------------------------- | --------------------------- |
  | `share-link-routes.ts`              | shared AI conversation messages, `created_at asc` | messages in arbitrary order |
  | `runtime/domains/share-links.ts`    | same route, runtime-domain copy                   | same                        |
  | `share-link-service.ts` `listLinks` | the 200 most recent share links                   | an arbitrary 200            |

  All three combine the dropped sort with a `limit` — the "latest N" shape whose
  failure #4226 spelled out: an unapplied sort returns rows in arbitrary order,
  which `limit` then slices into an arbitrary page. #4226 fixed that in the wire
  normalizer; these calls sit one layer below it. `listLinks` had no test at all,
  which is why it went unnoticed. Now pinned — on the option bag the engine
  receives, not on row order, because the failure is that the key never becomes
  `orderBy` and a fake engine honouring either spelling would pass either way.

  **The cleanup — 27 no-op renames.** Every remaining in-repo engine call passing
  `filter` now passes `where` (approvals 5, auth 2, reports 6, sharing 11,
  webhooks 2, plus the one `filters` in a spec doc example). These are strict
  no-ops since #4346 folds the alias — the point is that the framework stops
  depending on a spelling it asks users to migrate off, which is a prerequisite
  for ever retiring the aliases. Service-level `filter` PARAMETERS (each
  service's own public API, e.g. `listRequests(filter)`) are deliberately
  untouched — those are not engine option bags.

  Two of the renamed calls were live victims of the #4346 bug rather than
  cosmetic: `auth-manager`'s `stampIdentitySource` read the table's first row via
  `findOne({filter})` and counted the whole table via `count({filter})`, so a
  federated sign-in never stamped `source: 'idp_provisioned'`. #4346 already
  corrected the behaviour; this makes the call say what it means.

- b8c95a6: fix(plugin-sharing): refuse to mint a share row on a federated object whose `owner_id` is the platform's injected anchor (#8119)

  Granting a per-record share on a **federated** (ADR-0015 `external`) object whose
  `owner_id` is the anchor the registry injected — rather than a column the author
  declared on the remote table — used to succeed and persist a `sys_record_share`
  row. That row was inert **by construction**: no read or write verdict can ever
  consult it. `POST /api/v1/data/:object/:id/shares` now answers **422
  `SHARING_NOT_ENABLED`**, the same refusal the guard already gives for public and
  owner-less objects (ADR-0111 D7, closing the ADR-0078 silently-inert trap).

  **Why the anchor is not a column.** `applySystemFields` injects `owner_id` into
  every object that has not opted out, federated ones included, while
  `Engine.syncObjectSchema` returns early for `external != null` and issues no DDL
  — the remote schema is owned externally. So for a federated object `owner_id`
  exists in the registered schema and nowhere else, and the field-existence test
  behind the share-posture guard was answering YES about a column that is not
  there.

  **Measured, not inferred.** On a booted showcase stack with an unstamped
  federated object bound to the remote `customers` table, the single-record
  ownership lookup does **not** raise on SQLite. A projection naming the phantom
  column is _discarded_ and the whole row comes back without it:

  ```
  find(obj, { where:{id:'c1'}, fields:['id','name'] })      -> keys [id, name]
  find(obj, { where:{id:'c1'}, fields:['id','owner_id'] })  -> keys [id, created_at,
      updated_at, name, email, region, lifetime_value]   — no `owner_id` key, no error
  ```

  So the ownership fast-path reads `owner == null` and both write gates answer
  `deny` — silently, for every principal at every write DEPTH including `org`,
  because the null-owner branch short-circuits before the scope is consulted. Only
  the `modifyAllRecords` bypass reaches `allow`, and it does so without reading a
  share row. Refusing the grant therefore costs no live access: the row it declines
  to write could never have granted any.

  **What is deliberately unchanged.** `checkEdit` / `checkDelete` still refuse on
  these objects. That is fail-closed and safe; widening them to `abstain` would
  hand the row to another authority and can turn a refusal into an allow, which is
  a decision recorded on #8119 rather than part of this fix.

  **Unaffected:** every local object; a federated object whose author **declared**
  a real remote `owner_id` (the test is provenance, not `external`, so its shares
  keep working); and the grandfathered `public_read_write` federated objects, which
  are still refused as _public_ by the check that runs first.

- db59e9c: hooks: drop the last three `doc` / `previousDoc` alias reads on a hook context — read the engine's own keys only

  Behaviour is unchanged: every one of these limbs guarded against a producer that
  has never existed, so none of them could be reached.

  - `service-storage` attachment lifecycle read `ctx.result ?? ctx.input.doc ?? ctx.input.data`
  - `plugin-sharing` primary-BU projection read `(ctx.input.data ?? ctx.input.doc).user_id`
  - `runtime`'s hook sandbox read `engineCtx.input ?? engineCtx.doc` and `engineCtx.previous ?? engineCtx.previousDoc`

  Every ObjectQL write context spells the payload `data` — measured and pinned by
  `hook-input-shape-contract.test.ts` in `@objectstack/objectql` ("insert carries
  `data` — never `doc`", #5273). The top-level pair is the same family one level
  up: `HookContextSchema` declares `input` / `result` / `previous` and neither a
  `doc` nor a `previousDoc`, and `engine.ts` — the sole producer of a HookContext
  — builds neither. The limbs survived only because the old `HookContext.input`
  contract table documented insert as `{ doc, options }`; that table was corrected
  in #5668, and the same alias was removed from `trigger-record-change` in #5671.
  These are the remainder (#5906), removed rather than left as a second de-facto
  contract (PD #12).

- fc3a36a: fix(spec,objectql,sharing,storage): a hook can tell a per-row bulk dispatch from a single-record write again (#6966)

  A predicate (`multi: true`) write dispatches its lifecycle hooks **once per
  matched row** — `after*` since #5038, `before*` since #5574 — on a context
  deliberately indistinguishable from a single-id write's, so a handler written
  for one record works unchanged on a batch. That indistinguishability is the
  feature, and it also erased the only signal several handlers had.

  Before #5574 a bulk `before*` fired once with `input.id` present-but-`undefined`,
  so "`input.id` is empty" meant "this call stands for N rows". Guards across the
  platform were written on it. Every one of them **silently inverted** rather than
  failing: a per-row context has an id, so the guard now answers "single write" for
  every row of a batch. Two further assumptions broke with it — that the engine
  reuses one `HookContext` across a write's before/after pair, and that `after*`
  work keyed on the write's row set runs once.

  ### New: `HookContext.dispatch`

  The engine now states the fact rather than leaving it to be inferred:

  ```ts
  ctx.dispatch; // { mode: 'record' | 'per-row', index: number, scope: object } | undefined
  ```

  - `mode` — `'record'` when the call is the caller's whole write; `'per-row'`
    when it is one of N.
  - `index` — position in the fan-out. `index === 0` is how a handler does
    batch-scoped work once instead of N times.
  - `scope` — scratch shared by **every** dispatch of one write, both phases, same
    object identity. This is the seam handlers used to get by stashing on the
    context itself, which only ever worked because a single-id write reuses one
    context across its pair.

  Bound at every write dispatch site — insert, update, delete, both phases.
  Optional, and an absent marker reads as "not a per-row dispatch", so a handler
  reads `ctx.dispatch?.mode === 'per-row'` and existing code keeps its behaviour.
  Reads carry no marker: a read has no fan-out.

  It is deliberately **not** the `isPredicateBulkWrite` discriminator #5574
  retired. That one was removed under ADR-0049 for having neither a producer nor a
  reachable consumer — it inferred "bulk" from `input.id` and `options.multi` at
  the consumer, which is exactly what `asScalarId` stays unexported to prevent
  (#4434 / #4550). This one is produced by the engine at the point the dispatch
  ladder is decided, and the platform's own handlers read it.

  ### Behaviour fixed

  **Sharing rules and the record-share cascade (`@objectstack/plugin-sharing`).**
  The `before*` hook stashes the write's affected row set for the `after*` hook to
  act on. On a predicate write that stash was landing on a per-row context the
  `after` phase never saw, so `readAffectedRows` answered `resolve-failed` and both
  subscribers took their safe branch: every bulk update or delete on a ruled object
  revoked **all** of that object's rule grants and queued a full asynchronous
  re-grant — once per matched row, with the repeats racing each other's re-grants.
  Access was never widened (the trade is the ruling's "over-granting is an
  incident, under-granting is a wobble" direction), but a bounded write now takes
  the bounded path again: the rows are unioned as the engine hands them over, the
  cap still applies to the union, and the `after*` work runs once per write.

  **File-reference ownership (`@objectstack/service-storage`).** The `beforeDelete`
  hook that pre-resolved ids for a `where`-shaped delete was dead on every path,
  and `afterDelete` was falling back to one `sys_file` lookup **per row** where the
  batch fits one `$in`. Both are fixed by the marker, and the pre-resolution query
  is gone entirely — the engine has already matched the rows and hands them over.
  The `beforeUpdate` copy-on-claim pass no longer runs once per row against a
  batch-scoped payload, which also removes a row-conditioned rewrite of a shared
  `SET` clause (out of contract under ADR-0058 Addendum II D3).

  No authored metadata changes, and no write's result, event or return contract
  changes.

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

- 71af9f5: fix(sharing): the criteria-less-rule warn is once per rule per process, plus one boot aggregate (#3929 follow-up)

  Pre-dedup the fail-closed evaluator warned on EVERY pass — per evaluation and
  per reconciled write — so one legacy criteria-less rule could dominate a
  deployment's log. Enforcement is unchanged (such a rule still matches
  nothing and its grants are revoked on reconcile); the warn now fires once
  per rule per process, and the boot backfill emits a single operator-facing
  aggregate (count + rule names + the fix: repair the criteria or set
  active: false).

- d99ff1a: Stop scoping federated (`external`) objects by the phantom `owner_id` anchor

  The ObjectQL registry injects `owner_id` into every object that has not opted out,
  federated ones included, while `Engine.syncObjectSchema` returns early for
  `external != null` and issues no DDL — so on a federated object that column exists in
  the registered schema and in no store. `SharingService.buildReadFilter` and
  `buildWriteFilter` both decided by asking "does this object carry an `owner_id`
  field?", were answered yes, and AND-composed `owner_id = <caller>` (or the ADR-0057
  DEPTH-widened `$in`) onto a query whose backing table has no such column. On SQLite the
  unresolvable identifier degrades to a string literal, so the predicate is
  constant-false — 0 rows, no error, HTTP 200; Postgres and MySQL raise
  `column "owner_id" does not exist`. Either way a federated object under the
  secure-default `private` OWD was unreadable by any principal whose read scope was
  narrower than `org`, and nothing reported why.

  Both filters now apply a provenance test: an `owner_id` that is byte-identical to the
  shipped `OWNER_FIELD_DEF` on an `external` object is the platform's injected anchor,
  not a real owner column, so ownership scoping contributes nothing there. A federated
  object that **declares** a real remote owner column keeps its scoping, and every local
  object is untouched.

- 8e7955b: Refuse deletion of a platform-global sharing rule to org-scoped callers (#7795)

  `SharingRuleService.deleteRule` now requires **platform** authority to delete a
  sharing rule whose `organization_id` is `null` — a row seeded from declared
  metadata that belongs to no organization. A caller holding only the org-scoped
  `manage_sharing` capability is refused with `PERMISSION_DENIED`, which the REST
  layer answers as **403**; the `manage_platform_settings` capability, the
  built-in `platform_admin` position, and system contexts are all still permitted.

  Why: such a rule's criteria query runs unscoped, so deleting it purged **every**
  tenant's `sys_record_share` grants under it — a cross-tenant destructive act
  authorized by a capability declared `scope: 'org'`. Two measured facts made it
  worse: the boot seeder re-creates the rule on the next restart under a _new_ id,
  so the delete was a revocation wearing removal's clothes rather than a removal;
  and the safe lever was unavailable while the destructive one was not — an org
  admin's `active: false` creates a second, org-stamped row and leaves the shared
  rule running, so deletion was the only lever an org admin had over it.

  Deliberately **403, not 404**: the row is intentionally visible — listing,
  reading and evaluating platform-global rules stay open to org admins, exactly as
  shipped — so answering "no such rule" would contradict a read the same caller
  can perform one call earlier. Nothing on the read/evaluate surface changes.

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

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

- 7f955e5: fix(sharing): deleting a record now revokes every `sys_record_share` row on it, whatever the source (#5103)

  A share row says "principal P has level L on (object O, record R)". Delete R and
  the row describes nothing — yet until now it stayed in the table forever.

  #4779 (PR #5102) bound an `afterDelete` for this, but inside the sharing-RULE
  package, where two conditions fenced it in: it revokes only `source: 'rule'`
  rows, and it binds only on objects that appear in `sys_sharing_rule`. So an
  object that uses nothing but MANUAL shares — a `sharingModel: 'private'` object
  with no rule ever configured — had no delete hook at all, and **manual share +
  record delete = a permanent orphan**.

  Today the harm is bounded, and only because record ids are never reused: the
  `record_id IN (…)` predicate `buildReadFilter` emits matches nothing. Nothing
  enforces that assumption. A custom primary key, an import that preserves ids, or
  any future id recycling turns every one of those rows into a real privilege
  escalation — a new record landing on a recycled id inherits the dead record's
  recipients outright. Secondarily, `sys_record_share` grew without bound and
  Setup's Record Shares list showed rows pointing at nothing.

  **What changed**

  - **A record-delete cascade on every sharing-capable object.** `plugin-sharing`
    binds one `beforeDelete`/`afterDelete` pair with no object filter and judges
    the object's sharing posture from its `sharingModel` metadata _per delete_.
    Nothing is enumerated at boot, so nothing goes stale: an object that gains
    `sharingModel` at runtime is covered on its very next delete, with no rebind.
    Bounded deletes (a scalar id, an `$in` list, or a predicate matching at most
    1000 rows) are revoked synchronously and set-based; an unbounded one queues an
    object-scoped orphan sweep instead. System-context deletes cascade too.
  - **A boot-time orphan sweep keyed on record existence.** On
    `kernel:bootstrapped`, share rows whose RECORD no longer exists are revoked —
    historical orphans, rows a failed hook missed, and the one posture the cascade
    deliberately skips (an unmarked system object). This is a different question
    from the existing `sweepOrphanedRuleGrants`, which asks whether the RULE row
    still exists and therefore can never see a manual share. Bounded per boot:
    keyset pages, one batched existence probe per object per page, and a scan cap
    that reports when it stopped early. An object whose existence probe FAILS has
    its rows left in place — "could not ask" is never read as "the record is gone".

  **What did not change**

  Rule _recompute_ still never touches a manual share. That boundary (#5102) is
  the point: while the record exists, a manual grant is a human decision no rule
  evaluation may overrule. Only the record's DELETION revokes it, and only because
  there is no longer anything to have access to.

  New exports for hosts that compose the plugin by hand:
  `bindRecordShareCascade` / `unbindRecordShareCascade`,
  `objectCanCarryRecordShares`, `SharingService.revokeSharesForDeletedRecords`,
  `SharingService.sweepOrphanedRecordShares`, and `effectiveSharingModel`. Nothing
  was removed or renamed; the standard `SharingServicePlugin` composition needs no
  changes.

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

- 6e66cbe: fix(plugin-sharing): a deleted record kills its share links — resolve fails closed, and the delete cascades (#5190)

  `ShareLinkService.resolveToken` checked the token, `revoked_at`, `expires_at`,
  the audience and the password — **but never whether the record the link points
  at still exists**. Nothing revoked links on delete either: #5103's cascade
  covers `sys_record_share` only. So a share link outlived its record, kept
  resolving, and kept stamping `use_count` / `last_used_at`.

  That is worse than the `sys_record_share` orphan #5103 fixed, and for a
  structural reason: a share row names its beneficiaries, while a share link is an
  identity-less **capability token** — holding the URL _is_ the authorisation. The
  moment a record id is reused (custom primary keys, an import that preserves ids,
  any future id recycling) a link that morally died with its record starts
  authorising a brand-new record, for whoever kept it.

  Both halves of the fix ship together, and the first does not depend on the
  second having run:

  - **`resolveToken` re-asks whether the record exists**, and returns `null`
    through the _same_ branch as revoked / expired — no distinct code, no distinct
    error, nothing an unauthorised holder can read "that record was deleted" out
    of. The probe sits after the cheap in-memory gates (a revoked link still costs
    no query) and _before_ the usage stamp, so a dead record no longer ticks
    `use_count` / `last_used_at`. It fails **closed**: a probe that throws denies,
    because "cannot ask" must not authorise.
  - **Record deletes now cascade to `sys_share_link`**, on #5103's existing seam
    rather than a parallel one — the same global `beforeDelete` row-set stash, the
    same `afterDelete` set-based revoke, the same serialized sweep queue for
    unbounded deletes, and the same `kernel:bootstrapped` orphan sweep (keyset
    pages, a scan cap that reports itself, one batched existence probe per object
    per page, and rows left strictly alone when that probe fails). The two halves
    are isolated, so a driver error reclaiming grants cannot also skip the tokens.

  The link half judges posture from `publicSharing`, which is _independent_ of
  `sharingModel`: the object most likely to hold links is a platform object that
  opted into link sharing, and that is exactly the object the record-share
  predicate skips. `publicSharing` declared counts even when it is currently
  `enabled: false` — links minted while it was on outlive the flip.

  An orphaned link row is **deleted**, not stamped `revoked_at`: its subject is
  gone, so there is no live link left to keep a revocation record of, and the
  table would otherwise only grow (with Setup's link lists pointing at records
  that no longer exist). Links an admin revokes keep their audit row exactly as
  before.

  No metadata, spec or API shape changes. Deployments see fewer rows in
  `sys_share_link` after the next boot, and links whose record was already deleted
  stop resolving immediately — which is the point.

- 8e13ca8: fix(plugin-sharing): share-link 路由把完整授权信封交给 enforcement,修复 `group` 姿态下建链恒 403(#6206,裁决 A 案的消费半边)

  `SharingServicePlugin` 的 share-link 路由此前在 `resolveAuthzContext` 之后重新
  拼一个四字段对象(`userId` / `tenantId` / `positions` / `permissions`),而这个
  对象被原样当作 enforcement context 喂进 `engine.find` —— 即 [Finding-2]
  「只能为你自己看得见的记录建链接」那道可见性校验。被丢在半路的是
  `accessible_org_ids`、`org_user_ids`、`systemPermissions`、`posture`、
  `tabPermissions`。

  实害(已复现,非仅代码读出):`group` 租户姿态下 `accessible_org_ids` 就是
  Layer 0 那堵墙(ADR-0105 D2),集合缺席即判否(fail closed)。于是可见性校验
  查不到任何行,建链接对**调用方本来读得到的记录**返回
  `403 FORBIDDEN: Not permitted to share <object>/<id>` —— 一个已发布姿态上,
  已发布功能完全不可用。`single` 姿态(默认)不读该字段,行为不变。

  改法按维护者 2026-08-07 的 A 案裁决(契约半边 #6430 / PR #6511 已落):信封
  **整个**透传(`{ ...authz, isSystem: false }`),不再逐字段挑选 —— 逐字段挑选正是
  这条缝出问题的方式,也是下一个新增授权维度会再次漏掉的地方。`posture` 随上下文
  流动、不在 enforcement 处重推(ADR-0095 D2)。窄类型 `ShareLinkExecutionContext`
  保留,但只服务路由自己的 401 判定(认证与否),不再出现在任何裁决路径上。

  `ShareLinkService.createLink` / `revokeLink` / `listLinks` 与 `canManageShares`
  探针的参数类型随之收成完整 `ExecutionContext`,与 #6511 落地的契约一致。

- 4580597: fix(plugin-sharing)!: the share-link routes emit the declared envelope, and the last ratchet retires (#3983)

  The fifth and final drifting route module. Unlike the four in #3843, this one was
  not found by reading — `scripts/check-route-envelope.mjs` surfaced it the moment
  that scan went repo-wide, which is the whole argument for a repo-wide guard over
  per-package copies. It also turned out to be the one where the drift had actually
  **broken shipped SDK methods**, not merely mis-shaped a body.

  ## Two SDK methods did not work on this surface

  Three of these routes are `disposition: 'sdk'` in `runtime/src/route-ledger.ts`,
  and `ObjectStackClient.unwrapResponse` decides a body is an envelope by finding a
  boolean `success`. With no flag it hands back the body verbatim:

  | method                | documented / typed as          | actually returned                           |
  | --------------------- | ------------------------------ | ------------------------------------------- |
  | `shareLinks.create()` | "the link row (incl. `token`)" | `{ link: … }` — so `.token` was `undefined` |
  | `shareLinks.list()`   | `Promise<any[]>`               | `{ links: [] }` — so `.map()` threw         |

  `packages/client/src/admin-surfaces.test.ts` mocks all three as
  `{ success: true, data: <payload> }`. The SDK was written and tested against the
  **dispatcher's** shape and only ever worked there.

  ## This is a convergence, not a redesign

  `runtime/src/domains/share-links.ts` serves the same five paths, and for cloud's
  per-environment kernels it is the _designed primary_ surface
  (`registerShareLinkRoutes: false`). It has always answered in the declared
  envelope. The plugin now answers identically:

  | route                            | was                              | now                                     |
  | -------------------------------- | -------------------------------- | --------------------------------------- |
  | `POST /share-links`              | `{ link }`                       | `{ success: true, data: link }`         |
  | `GET /share-links`               | `{ links }`                      | `{ success: true, data: link[] }`       |
  | `DELETE /share-links/:idOrToken` | `{ ok: true }`                   | `{ success: true, data: { ok: true } }` |
  | `GET /:token/resolve`            | `{ record, link, redactFields }` | `{ success: true, data: { … } }`        |
  | `GET /:token/messages`           | `{ data: rows }`                 | `{ success: true, data: rows }`         |
  | errors                           | `{ error: { code, message } }`   | `{ success: false, error: { … } }`      |

  `data` carries each payload **directly** — `data: links`, not `data: { links }`.
  That is what makes `unwrapResponse` return the same value on both surfaces, and
  it is what the SDK already expected.

  ## Breaking: raw `fetch` callers add one hop

  SDK callers get the fix for free (two of them go from broken to working). Direct
  body readers add `.data`:

  ```diff
  - const { links } = await (await fetch('/api/v1/share-links')).json();
  + const { data: links } = await (await fetch('/api/v1/share-links')).json();
  ```

  `{ ok: true }` on revoke survives, but as the payload rather than as the body: at
  the top level it was a second word for `success`, which #3689 retired from
  storage; under `data` it is what the dispatcher already returned.

  The `error` half was already nested `{ code, message }` — #3675's changeset cited
  this module as the good example of that — so only the `success` flag is new there.
  All eleven codes were already SCREAMING_SNAKE and registered, so ADR-0112 needs
  nothing.

  ## Consumers

  Swept, and the result is smaller than #3983 assumed. The framework has **zero**
  consumers of these routes. In objectui, `ShareDialog` was already dual-shape
  tolerant on all three routes it calls (`body.links ?? body.data`,
  `created.link ?? created.data`, and revoke never reads the body) — it needs no
  change, and it carried that tolerance precisely _because_ both shapes existed in
  the fleet.

  `SharedRecordPage` did need one fix, and it is the kind a shape-swap would have
  missed: it renamed the wire's `redactFields` to `redactedFields` only on the
  _bare_ branch, so on the already-enveloped dispatcher path the "fields are hidden
  by the owner" notice never rendered. Converting this surface would have spread
  that to every share page. Fixed in objectui#2980, which merges first.

  ## Guard

  **7 conformant / 0 ratcheted / 1 exempt**, from 6 / 1 / 1. The ratchet mechanism
  stays for the next module that needs it.

  `privateOk` also got narrowed to what its own doc always claimed — a literal `ok`
  at the **top** of a body, where it competes with `success`. The same literal
  inside `data` is payload, which is what a conformant revoke returns. Four
  self-test assertions pin both readings.

- d5749d7: refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

  `BaseResponseSchema` declares one envelope for every REST body the platform
  emits. It declared it once; the code that _wrote_ it was copied per route
  module. After #3843 and #3983 converted the last drifting one, seven modules
  each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
  shape lived in fourteen places rather than one.

  `pnpm check:route-envelope` proved those seven copies agreed, which is why this
  is a cleanup rather than a bug fix. But a guard proves agreement; it does not
  create it. An eighth module starts by copying the pair again — not
  hypothetically: `share-link-routes.ts` was found already drifting by the
  repo-wide scan, and its drift had broken `client.shareLinks.create()` and
  `.list()` through `unwrapResponse` (#3983).

  ## What moved

  `sendOk` / `sendError` now live once, in `@objectstack/types`
  (`response-envelope.ts`), and all seven modules import them:

  | Module                                |
  | ------------------------------------- |
  | `service-storage/storage-routes.ts`   |
  | `service-settings/settings-routes.ts` |
  | `service-datasource/admin-routes.ts`  |
  | `rest/external-datasource-routes.ts`  |
  | `rest/package-routes.ts`              |
  | `service-i18n/i18n-service-plugin.ts` |
  | `plugin-sharing/share-link-routes.ts` |

  Placement was the open question in #3973, not design. `packages/spec` is
  schemas-only (Prime Directive #2), and the callers span `rest`, four
  `services/*` and one `plugins/*`, which rules out anything depending on them.
  `@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
  can reach it, and it is already where the repo puts a helper the HTTP boundaries
  share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
  same argument first.

  The builders take a structural `{ status(n), json(body) }`, so the package
  imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
  `any`-typed `res` the older modules carry.

  ## `error.code` is now checked by the compiler

  All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
  vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
  invented code was still caught only at runtime, by a conformance suite parsing a
  driven body, i.e. only on routes some test happened to drive.

  The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
  fails to compile, at every call site at once:

  ```ts
  sendError(res, 400, "NOT_A_REGISTERED_CODE", "invented");
  // Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
  ```

  This cost no call-site churn: every code the seven modules emit was already
  registered.

  ## `extra` is closed at the same place

  `sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
  and `message`.

  It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
  `key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
  `ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
  rejected, and `envelopeViolations` inspects only the body's top level —
  conformant _by stripping_ rather than by declaration. #4224 moved that module
  onto `details`, which is what lets the parameter close here. Closing it at the
  shared builder is the part that lasts: an undeclared sibling is now a compile
  error in every module at once, rather than a key that quietly evaporates in
  whichever module reintroduces it.

  ## Nothing changes on the wire

  The seven pairs were identical modulo the optional `status` and `extra`
  parameters this one unions, and each module's driven conformance suite still
  parses its real bodies against the real spec schemas. One internal call site was
  rewritten: `package-routes` passed `details` positionally and now passes
  `{ details }`, producing the same `error.details` it always did.

  ## The guard got stronger

  `scripts/check-route-envelope.mjs` counts response write sites per module. A
  module that routes everything through the shared pair builds **none** itself, so
  the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
  shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
  the surface rather than per-module. What the count asserts is no longer "your two
  builders are the enveloped ones" but "you have no builders" — and a new route
  that hand-rolls a body still moves it off zero and fails.

- 3415a61: refactor(plugin-sharing,plugin-audit): enforcement implementations annotate the full `ExecutionContext` (#7136)

  The consumer half of #6523. That change converged 36 contract signatures onto
  the complete `resolveAuthzContext` envelope, applying the #6206 ruling —
  enforcement adjudicates on the whole envelope, never a per-site subset. The
  implementations behind those contracts still annotated their own parameters
  with `SharingExecutionContext`, the six-field shape the contracts used to name,
  so nothing they could _read_ had widened.

  `SharingService`, `SharingRuleService`, the sharing exec-context seam and
  plugin-audit's comment-access gates now declare `ExecutionContext` on all 27 of
  those parameters — plus the two return types that produce the contexts feeding
  them — and the casts the narrow annotation forced are gone:

  - `exec-context-seam.testkit.ts` resolved a REAL context and then had to force
    it into the narrow type — `{ ...authz, isSystem: false } as unknown as
SharingExecutionContext`. It now returns what it resolved, so a drift in
    `resolveAuthzContext`'s output reaches the tests that trust this seam instead
    of being absorbed by a double cast.
  - `SharingRuleService`'s system context is typed as the envelope and passed as
    itself, retiring `SYSTEM_CTX as any` at all 10 of its call sites — an erasure
    on an enforcement input switches checking off for the whole argument, not
    just for the readonly-array mismatch that provoked it.
  - The `(context as any).userId` / `.tenantId` reads in `SharingService` now read
    declared fields.

  **No runtime behaviour changes.** The values were always complete — this
  family's damage was type-side — so every gate answers exactly what it answered
  before. Method parameters only WIDEN what they accept, so no caller is affected.

  Two casts are deliberately kept, and are now documented where they sit:
  `__readScope` / `__writeScope` are private keys plugin-security's middleware
  stamps onto the context it forwards and are not fields of the envelope, and
  `organizationId` is not on the envelope at all — that spelling has its own
  history (#5858 / `check:org-identifier`) and was held out of this change.

  Because a re-narrowed annotation would compile, ship and pass every test in
  these packages, the convergence is pinned by a new compile-time module,
  `exec-context-annotation.pin.ts`: it hands each enforcement parameter a fresh
  literal naming envelope-only fields (`posture`, `accessible_org_ids`,
  `org_user_ids`), which TypeScript's excess-property check rejects the moment a
  parameter narrows back, plus negative cases so a parameter erased to `any`
  cannot pass either.

- 17688fe: fix(sharing): the by-id write gate defers to an app-authored RLS widener instead of hard-refusing (#5493)

  HotCRM's 17.0 GA acceptance sweep declared two RLS update-wideners on one
  profile and measured one of them working. On the junction object
  `crm_campaign_member` a non-owner PATCH returned 200; on `crm_campaign` the
  identical shape returned 403 `FORBIDDEN: insufficient privileges to update
crm_campaign`. That sentence is the sharing middleware's, not the row gate's
  `(row-level security)` — so the refusal landed **before** RLS was consulted and
  the declared widener was never asked.

  The discriminator was never "carries sharing rules". It is whether **record
  sharing enforces on the object at all**: `checkEdit` abstains — and `canEdit`
  therefore answers `true`, letting the write through to RLS — when the effective
  sharing model is `public` (which `controlled_by_parent` maps onto) or when the
  schema has no `owner_id` field. A junction lands in that set; an ordinary owned
  business object does not. Same declaration, opposite outcome, split by a
  property no author writes down.

  Row-level write authority is ONE composite determination (maintainer ruling on
  #5492), so the middleware no longer ends the decision by itself. Before it
  hard-refuses a **by-id** update or delete, it asks the security service's
  `ISecurityService.checkAuthoredRowWrite` — the fail-closed verdict landed by
  #5493 step 1 (PR #6841) — whether an **app-authored** (non-floor) row-level
  policy admits this row for this operation. `admit` retracts this authority's
  refusal and hands the row to the security pre-image gate, which composes per
  #6684/#5492 and makes the final row decision. It does not authorize anything on
  its own.

  Everything else is unchanged, deliberately:

  - **The guarded surface does not shrink.** A member with no authored policy, no
    share and no bypass is still refused; a read-level share still never widens a
    write; an `edit`-level share still widens update and not delete (ADR-0111 D3),
    and an update-only authored widener does not open delete either — the verb is
    threaded through to the verdict, not collapsed.
  - **Fail-closed on every non-`admit` outcome.** No security service (a
    deployment without `@objectstack/plugin-security`), a service predating the
    method, a throwing probe, a principal-less context, an on-behalf-of context
    (ADR-0090 D10) and any unrecognised verdict all leave today's refusal
    byte-for-byte intact. The probe is reached through the same structural
    late-binding this plugin already uses for `hasWriteBypass`; no runtime
    dependency on `plugin-security` is introduced.
  - **A creator who is no longer the owner gets nothing back.** The platform's own
    ownership floor (`created_by == current_user.id`, shipped on the additive
    `member_default` baseline) matches a record transferred away from its creator,
    so a deferral keyed on "the composed RLS admits this row" would return
    transferred records to former creators. The verdict is provenance-aware and
    abstains there; the deferral does not widen it.
  - **The bulk path is untouched** — it composes a filter rather than a verdict,
    and is tracked separately (#6736).
  - **Objects with no owner field are untouched** (#6698): sharing abstains, the
    gate never refuses, so the deferral is never reached and the platform
    `created_by` write floor remains their only row-level write gate.

- f226605: fix(plugin-sharing): hierarchy resolver 拿到调用方真实的活动组织(权威 `organizationId`)(#5859)

  `resolveOwnerScopeIds` 构造 `HierarchyScopeContext` 时读的是
  `(context as any).organizationId` —— **仓内没有任何传输层写过这个键**。REST
  (`rest-server.ts`)和 runtime dispatcher(`resolve-execution-context.ts`)都从同一个
  授权解析器 `resolveAuthzContext` 组装执行上下文,活动组织落在 `tenantId`
  (session 路径 = `session.activeOrganizationId`,API-key 路径 = `sys_api_key.organization_id`),
  `ExecutionContext` 的字段注释写的也正是这句。所以这个读取**结构性恒为 `null`**:
  自 ADR-0057 以来,每一次 DEPTH(`unit` / `unit_and_below` / `own_and_reports`)解析
  都是在**没有组织约束**的前提下跑的,而企业版 resolver 只按 `organizationId` 收窄
  自己的 owner 集合 —— 于是整条 DEPTH 租户隔离从未生效。

  爆炸半径不止「共享管理」一路:同一个 owner 集合喂给 `matchesOwnerScope` →
  `canEdit` / `canDelete`,以及批量写路径 `buildWriteFilter`。#5852 的实测里,
  `group` 姿态下的普通成员对**兄弟组织**记录 `POST /data/:obj/:idB/shares` 得到
  **201**;探针那个 app 的写路径另被 `member_default` 的 `owner_only_writes`
  (keyed on `created_by`)挡下,所以只观测到共享管理一路 —— **不带这条 owner-only
  RLS 的部署,跨组织 edit/delete 同样放行**。

  本次修复(producer 半边,契约半边见 #5858 / PR #5973):

  - 权威字段 `organizationId` 由执行上下文的活动组织填充;`tenantId` 作为
    `@deprecated` 兼容别名原样继续携带(不是消费端 `?? tenantId` 兜底 —— 那正是
    #5858 为 resolver 明令排除的宽容消费者形状)。同样的映射在
    `@objectstack/plugin-security` 的 Layer-0 租户墙里早已在用
    (`computeTenantLayer0Filter({ organizationId: context?.tenantId })`),两层
    enforcement 现在按同一个字段的同一个值收窄。
  - 无活动组织时如实传 `null`(契约类型即 `string | null`),空白字符串归一为
    `null`,绝不让一个假的组织 id 混进 resolver 的查询与日志。
  - resolver 抛错的静默回退改为**留声**(`logger.warn`):此前「resolver 炸了」和
    「层级里确实没有别人」在外部完全同形,这也是本缺陷长期不可见的原因之一。

  ## 姿态感知的组织门(user-visible 行为变化)

  `SharingService` 新增一个 late-bound 的 `tenancy` 姿态探针(读法与 `SecurityPlugin`
  为 Layer-0 墙读 `tenancy` 服务的完全一致,由 `SharingServicePlugin` 自动接线),
  按 **ADR-0105 D1** 的既有分叉决定「没有活动组织」意味着什么 —— 与
  `computeTenantLayer0Filter` 对同一问题给出的答案逐条同形:

  - **`single`**(纯单租户,无组织):**行为不变**,DEPTH 照常 widened。此处「没有组织」
    是那一个隐含租户,不是「所有组织」。
  - **`group` / `isolated`**(有墙):权威组织缺失/空白 → **拒绝**,根本不咨询 resolver,
    回落 owner-only 并打一条点名 ADR-0095 D1 / ADR-0105 D1 与 #5973 契约义务的 `warn`。
    即:有墙部署里,缺组织的 owner-scope 解析从「按无租户约束展开」变为「拒绝展开」。
  - **姿态解析不出**(未接线 / 探针抛错 / 词表外的值)→ 按**有墙**处理。未知姿态不是
    `single` 的证据,否则恰恰在配置已经可疑的部署上恢复了展开。

  对已有部署的影响:`single` 部署零变化;`group` / `isolated` 部署中,一个**没有活动
  组织**的调用方将不再通过 DEPTH 拿到跨组织的 owner 集合(共享管理 / edit / delete /
  批量写四条路径同时闭合)。

- fd6572b: feat(plugin-sharing): an `isSystem` write batch that materialises zero sharing grants now says so, once (#6783)

  The sharing-rule record-write hooks skip `isSystem` sessions, so a seed run — or
  any internal write batch — lands rows on an object an **active** sharing rule
  covers and creates no `sys_record_share` rows at all. The skip is correct: the
  `kernel:bootstrapped` backfill reconciles every rule and `evaluateRule` is
  idempotent, so the state heals. What was wrong is that nothing said so.

  hotcrm#640 is the specimen: a fresh install with 9 active sharing rules, 9
  accounts matching their criteria, users holding the right positions — and an
  empty `sys_record_share`. Every visible layer said "configured". The only way to
  learn that the seed path had skipped materialisation was to query the table,
  find it empty, and read `plugin-sharing`'s source.

  **What changed.** The two skips that drop grant materialisation — `afterInsert`
  and `afterUpdate` — now emit one INFO line naming the behaviour and both
  remedies:

  ```
  [sharing-rule] sharing materialisation skipped for isSystem writes; re-evaluate rules or restart to backfill
  ```

  with the object and the active rules on it as metadata.

  **One line per batch, not per row.** The notice is latched per object per hook
  binding generation, so a seed batch writing 500 rows produces exactly one line.
  The defect being fixed is silence; a per-row flood would be the same defect with
  a different symptom. The latch re-arms with the binding — `bindRuleRebindTriggers`
  re-binds the package on every `sys_sharing_rule` write — so a changed rule set
  gets its own notice instead of inheriting the previous generation's silence.

  **INFO, not warn or error**, deliberately: the behaviour is correct and
  self-healing, and warning about a subsystem working as designed is how operators
  learn to ignore it.

  Deliberately unchanged:

  - **The skip itself.** No write now materialises grants that did not before, and
    no `sys_record_share` row is created, updated or revoked by this change.
  - **No new switch or flag.** The notice is unconditional.
  - **`afterDelete` stays silent.** A delete skips _revocation_, not
    materialisation, and the remedy the line names cannot repair that class:
    `evaluateRule` iterates records that still exist, so neither re-evaluating a
    rule nor restarting can reach a grant whose record is gone. That class belongs
    to the record-delete share cascade and the boot orphan sweep.

  The line is a statement about the write path, not a claim that grants were owed —
  whether a given seeded row satisfies a rule's criteria is exactly the query the
  skip exists to avoid, so answering it here would cost the skip its purpose.

- c272e48: fix(plugin-sharing): recompute sharing rules for predicate (`multi`) writes — stale `sys_record_share` grants no longer survive a bulk update (#4779)

  `bindRuleHooks` located the rows to recompute from a single record id:

  ```ts
  const id = String(data?.id ?? ctx?.input?.id ?? "");
  if (!id) return;
  ```

  `ObjectQL.update()` only populates `input.id` when `where.id` is a scalar. A
  predicate write (`multi: true`) routes to `updateMany`, leaves `input.id`
  undefined, and carries no id in its payload — so **every bulk write skipped
  sharing-rule recompute entirely**.

  The consequence is a fail-open on the authorization side. A criteria-based rule
  materialises `sys_record_share` rows; an admin then bulk-updates those records
  out of the criteria (`{ where: { region: 'east' }, multi: true, data: { region:
'west' } }`); nothing recomputes, the grant rows stay in the table, and the
  recipients keep the read/edit access the rule no longer implies. Same family as
  #4757 (`sys_attachment`) and #4778 (approval locks), but better hidden — a stale
  grant is indistinguishable from a legitimate one. The reverse direction (bulk
  update **into** a rule's criteria never granting) was broken too.

  **What changes**

  The hooks now key off the write's ROW SET instead of one id. `beforeUpdate` /
  `beforeDelete` resolve the affected rows from the predicate and stash them on
  the shared hook context (the `before` hook is where it must happen — the write
  is what makes those rows unfindable); the `after` hook acts on them:

  - **Bounded set (≤ 1000 rows, `RULE_RECOMPUTE_ROW_CAP`)** — `evaluateAllForRecord`
    per row, synchronously. Diff-based, so this covers both directions: rows moved
    out of a rule's criteria are revoked, rows moved in are granted.
  - **Unbounded set** (over the cap, `multi: true` with no `where` at all, or a
    resolve that failed) — every `source: 'rule'` grant on the object is revoked
    **synchronously** in one set-based statement, and the deserved grants are
    restored **asynchronously** by reconciling the object's rules.

  **The write is never refused.** Refusing would turn an internal recompute bound
  into a business-visible limit on how many rows an admin may update, reported by
  a subsystem they never configured. The asymmetry it trades on instead:
  over-granting is a security incident, under-granting is an availability wobble.
  So the safety half is always synchronous and complete, and only the expensive
  restoration half is deferred.

  **Operational note.** After a bulk write whose row set could not be bounded,
  recipients may briefly lose access to records they still qualify for, until the
  background re-grant finishes. It is logged with the object and the reason. The
  re-grant is in-process; if it is lost to a crash, the plugin's existing
  `kernel:bootstrapped` backfill re-runs the same idempotent reconcile on the next
  start, and any subsequent `sys_sharing_rule` write reconciles too.

  **Also fixed:** the rule hooks now bind `afterDelete` and retire the deleted
  records' rule grants. Nothing else could: `evaluateRule` iterates records that
  still exist, so a grant whose record is gone was unreachable by every reconcile
  path and outlived restarts. Harmless only while record ids are never reused —
  an assumption nothing in the platform enforces.

  New on `SharingRuleService`: `revokeRuleGrantsForObject`,
  `revokeRuleGrantsForRecords` and `evaluateAllRulesForObject`. Manual
  (`source: 'manual'`) shares are never touched by any of them.

- 225ab04: fix(plugin-sharing): scope `getRule`'s by-id branch to the caller's organization (#7761)

  **Cross-tenant security fix.** `SharingRuleService.getRule` resolved a rule id
  with a bare `{id: idOrName}` predicate and no organization filter, executed
  under the service's `SYSTEM_CTX` so nothing re-scoped it downstream. An
  org-scoped sharing admin who held another organization's opaque `srule_…` id
  could therefore reach that organization's rule through all three verbs that
  resolve through `getRule`:

  - `GET /api/v1/sharing/rules/:id` — read another tenant's rule, including its
    criteria, recipient and access level;
  - `POST /api/v1/sharing/rules/:id/evaluate` — materialise that tenant's grants
    on demand;
  - `DELETE /api/v1/sharing/rules/:id` — delete the rule **and purge every
    `sys_record_share` grant it had materialised**, silently revoking another
    tenant's record access.

  The caller still needed `manage_sharing` (or the legacy
  `manage_platform_settings`) in their own organization, but that is an
  org-scoped capability — `scope: 'org'` in the spec's capability registry — and
  a rule id is not a tenant boundary: ids leak through logs, exports, support
  tickets, and the evaluate endpoint's own `{ruleId}` response.

  The by-id lookup now carries the same tenant predicate the by-name path has
  carried since #7676: `id = {id} AND (organization_id = {orgId} OR
organization_id IS NULL)` when the caller carries an organization. Two
  behaviours are deliberately preserved: a no-org (system / boot) context still
  resolves any row by id, so boot seeding, hooks and backfills are unaffected;
  and a platform-global (`organization_id = null`) row stays reachable by id, for
  symmetry with the by-name path.

  Reaching another organization's rule by id is now indistinguishable from
  addressing one that does not exist — `getRule` answers `null` (REST: 404),
  `evaluateRule` throws `RULE_NOT_FOUND`, and `deleteRule` is a no-op that leaves
  the row and its grants intact.

- d34d9c9: security(plugin-sharing): a `manage_sharing` holder with no ACTIVE organization no longer reads every tenant's sharing rules (#8158)

  `SharingRuleService` decided its admin read scope on the **absence of an
  organization id**, not on system-ness:

  ```ts
  if (!orgId) return where; // unscoped — every tenant's rows
  ```

  That unfiltered branch exists for the system context — boot seeding, the
  reconcile hooks, the backfills — which legitimately reads across tenants. But
  it was reached by any caller whose context happened to carry no organization,
  and the ADR-0111 D6 gate admits any caller holding the **org-scoped**
  `manage_sharing` capability. So an authenticated, non-system caller arriving
  with neither `organizationId` nor `tenantId` received the system read scope:
  `listRules` returned **every organization's** rules, `getRule` resolved any of
  them by id or by name, and `evaluateRule` reached those rows too — a
  cross-tenant **write**, since it reconciles `sys_record_share` grants.

  **That session is reachable in a real deployment**, measured end to end over
  HTTP rather than inferred: a permission-set grant is independent of
  organization membership, and an org-scoped grant still resolves when the caller
  has no active organization to compare it against. A user holding
  `manage_sharing` with no `sys_member` row — a multi-organization deployment
  (whose membership reconciler binds nobody), an `invite-only` deployment, a user
  removed from their organization, an SSO JIT user pending placement — signs in,
  carries the capability, and carries no tenant.

  **The fix** distinguishes "system context" from "no organization id" at the
  decision point instead of conflating them: `adminOrgScope`, `getRule` and
  `findRuleRowByName` (three sites, one shape) now take the execution context,
  and an authenticated caller with no resolvable organization is **refused** with
  `PERMISSION_DENIED` (HTTP 403) naming the missing organization. A refusal
  rather than an empty list, because `manage_sharing` is declared `scope: 'org'`:
  with no organization there is no scope in which it grants anything, and an
  empty answer over rules that exist and are actively granting access reads as
  "this deployment has no sharing rules".

  **Unchanged**, and covered by tests: system contexts keep the unfiltered read
  and the unfiltered seed (boot seeding is untouched); **platform operators**
  (`manage_platform_settings`, or the `platform_admin` position) keep it too,
  with or without an active organization — that is what the platform-only Setup
  sharing pages are, and a single-tenant deployment before its default
  organization is bootstrapped has exactly that caller; and an org-bound admin
  still sees its own organization's rules plus the platform-global ones, exactly
  as #7676 / #7761 left it.

- 647ec8b: fix(driver-sql,sharing): an unsortable query loses its ORDER BY, not its rows (#3821)

  `SqlDriver.find()` already recovered from a SELECT projection naming a column
  the table lacks (retry with `select('*')`, the unknown field is simply absent
  from each row). The identical failure one clause over — an **ORDER BY** column
  the table lacks — fell through to `return []`. Because `count()` is a separate
  statement, the list endpoint answered `HTTP 200` with `records: []` and
  `total: 3`: the rows are there, none are shown, nothing is logged. Same family
  as the `$`-param footgun closed by #2926.

  It surfaced through the Console's sharing-rule **recipient picker**, which
  never listed a single candidate. The client mangled `'name asc'` into
  `0 n,1 a,2 m,…` (fixed separately in objectui) and the driver turned that into
  "no users exist", so no sharing rule could be authored from the UI at all.

  Rows now outrank their order: the retry ladder drops the projection first (the
  likelier culprit and the cheaper thing to lose), then the sort, then gives up.
  A query that cannot be sorted comes back **unordered instead of empty**. Errors
  that are not about an unknown column still propagate untouched.

  **A rule authored in Setup now actually applies — and switching it off actually
  withdraws access.** Writing a `sys_sharing_rule` rebound the per-record hooks,
  which only makes the rule reach records written FROM THEN ON. So an admin who
  created a rule and enabled it saw nothing happen: the recipient's list stayed
  empty until somebody happened to touch each record. The reverse was worse —
  switching a rule OFF, or deleting it, left every grant it had already issued in
  place, and boot backfill only reconciles ACTIVE rules, so those grants outlived
  restarts while the UI displayed the rule as disabled. The reconcile was reachable
  only through `POST /sharing/rules/:id/evaluate`, which the Console never calls.

  Each non-system write to `sys_sharing_rule` now also reconciles that rule's
  grants, chained behind the existing rebind: insert/update run the same
  diff-based `evaluateRule` the REST endpoint runs (it purges when the rule is
  inactive), and delete purges directly via the new
  `SharingRuleService.revokeRuleGrants` — `evaluateRule` can't help there because
  the row is already gone (`RULE_NOT_FOUND`), which is also why a rule deleted
  through the plain data API used to orphan its grants. Seeding and package
  bootstrap write with `isSystem` and are skipped; `kernel:bootstrapped` already
  backfills those. Reconciliation is best-effort and never fails the write.

  **The dialog's help text was engineering notes, shown to tenant admins.** The
  field descriptions on `sys_sharing_rule` render under each input in Setup, and
  they cited ADR numbers, table and column names (`parent_business_unit_id`,
  `sys_business_unit`), enum machine values the dropdown never shows
  (`business_unit`, `team`), a third-party library (better-auth), and engine
  vocabulary ("evaluation", "lifecycle"). Several were also stale: they still told
  admins to type an id or hand-write a `FilterCondition` after those inputs became
  a record picker and a visual builder. Rewritten for the reader who actually sees
  them — the implementation detail was already in the object's doc comment, which
  is where it stays. `criteria_json`'s LABEL loses its "(FilterCondition JSON)"
  suffix for the same reason, and `active` can finally say what it now does:
  turning it off withdraws the access.

  Also refreshes the `sys_sharing_rule` help text in the zh-CN / ja-JP / es-ES
  translation bundles, which still described `recipient_type` in terms of
  `department` (the enum value is `business_unit`) and told admins to enter a
  queue name for `recipient_id` (`queue` was removed in ADR-0078). The es-ES
  option labels for `position` / `unit_and_subordinates` were translated as
  "rol" — corrected to "Puesto" / "Unidad de negocio y subordinados".

- 2465133: fix(plugins): sweep the service-lookup erasures out of the plugin composition roots, and fix the two alias-only HTTP reads it exposed (#4251 B5)

  Batch B5 of the #4251 sweep: the seven remaining `packages/plugins/*` composition
  roots. 35 lookup sites that had been erased to `any` now carry the slot's
  contract, so the compiler checks what each plugin actually calls on the service
  it resolved. The ratchet drops 143 sites / 32 files to 108 / 25.

  **Two real defects, both of the shape this sweep exists to find.** Approvals'
  actionable-link pages (ADR-0043) and sharing's public share-link REST routes each
  read the HTTP server under `http-server` _only_ — the deprecated alias. The
  ledger records `http.server` as canonical and as the only name present on every
  provider path: `runtime.ts`'s `config.server` path registers no alias at all. On
  that path both lookups threw, the surrounding `catch` swallowed it, and the
  routes silently never mounted — approval e-mail action links 404'd and the
  share-link surface was absent, with nothing in the log to say so. Both reads are
  now canonical-first with the alias as fallback, each name in its own `try`
  because `getService` throws on an empty slot (so `a() ?? b()` inside one `try`
  never reaches `b` — the same correction #4393 made in metadata and
  cloud-connection).

  Typing choices follow the batch method: pure data-plane consumers take the
  narrow contract (`IDataEngine` in reports), consumers that bind hook or
  middleware seams take the engine seen whole (`IObjectQLEngine` in approvals,
  sharing and pinyin-search), and slots with no contract get a **named** local
  surface rather than `any` — plugin-email's `MailSettingsSurface`, and the
  surfaces the consuming packages already declared (`ApprovalMessagingSurface`,
  `SharingSecurityProbe`, `ReportEmail`). A named surface that omits a member
  still makes the compiler name every call site; `any` says nothing.

  No behaviour change beyond the two alias reads. No contract changes.

- 8669e5d: Make package-seeded sharing rules visible and addressable by name to org-scoped admins

  Sharing rules seeded from an app or package are defined under the system context, so they are stored with `organization_id = null` (platform-global). `SharingRuleService.listRules` and the by-name fallback of `getRule` scoped their reads with a strict `organization_id = <caller org>` equality, which such a row can never satisfy. An authenticated org-scoped admin therefore saw `GET /api/v1/sharing/rules` return an empty list over a table of active seeded rules, and by-name `GET` and `evaluate` answered 404 `RULE_NOT_FOUND`; only the by-id branch, which was never org-scoped, still worked.

  Both admin reads now match "this organization OR platform-global", mirroring how enforcement has always read these rows under the system context. Consequences worth knowing:

  - Seeded rules now appear in the admin rule list and can be fetched, evaluated and deleted by name. An org admin could already do all three **by row id** — the by-id branch carries no org filter — so this adds an address form and discoverability, not a new authority. Deleting a package-seeded rule remains reversible: the next boot reseeds it.
  - Rules belonging to a **different** organization remain invisible and unresolvable by name; only rows belonging to no organization at all become visible.
  - `defineRule` is deliberately **not** widened. Its existence lookup decides upsert-vs-insert, so widening it would let one organization's admin rewrite a row every other organization reads. A same-named create still produces a row stamped with the caller's own organization, and by-name lookups prefer that row over the platform-global one.
  - Callers passing a context with no organization (boot seeding, rule hooks, backfills, the boot reconcile) are unaffected — that path was already unfiltered and is unchanged.

- 2a18012: fix(plugin-sharing): the ADR-0111 D7 inert-grant guard runs for SYSTEM callers too, so the sharing-rule evaluator can no longer materialise rows no gate consults (#8207)

  `SharingService.grant` skipped **both** of its pre-flights for a system context,
  in one block, under one justification: _"System callers bypass: the rule
  evaluator materialises through here under its own validation."_ The two halves
  ask different questions, and only one of them may vary by caller.

  - **D1, `assertCanManageShares` — an AUTHORIZATION check.** "May this principal
    manage shares on this record?" A sharing rule is not a principal and has no
    ownership to prove, so the system skip is correct and is unchanged.
  - **D7, the inertness guard — not an authorization check.** "Would any gate ever
    read a row on this object?" The gates that would consult the row
    (`buildReadFilter`, `checkEdit`, `checkDelete`) never see the granter, so the
    answer cannot depend on who asks. Exempting the system context made the guard
    answer a question it was not asked.

  **The "own validation" the old comment credited the evaluator with is not
  there.** Measured, one rule per class, `defineRule` then `evaluateRule`, both
  under a system context: a rule against a `public_read_write` object, an
  owner-less object, a `controlled_by_parent` detail, a federated phantom-anchor
  object, or a bypass object was accepted and materialised a real
  `sys_record_share` row — five for five. `defineRule` never reads the object's
  schema, and reconcile hands `grant` whatever `object_name` the rule row carries.
  So an authored sharing rule pointed at any of those objects minted rows that
  looked granted and enforced nothing, which is the ADR-0078 silently-inert trap
  arriving through the one door the guard did not watch.

  The inertness verdict is now computed caller-free and refused for **every**
  caller. Refusing costs no live access on either path: the row it declines to
  write could never have granted any.

  **What deliberately did NOT move.** The existence check stays non-system-only. An
  unresolvable object name is a NOT_FOUND (REST: 404) for a caller who typed it,
  but for the evaluator it is a stored `object_name` meeting an engine that may not
  have that schema registered at this instant — and absence of a schema is absence
  of _evidence_ of inertness, not evidence of it. Hard-failing a reconcile pass on
  that would refuse a write nobody showed to be inert. An engine with no
  `getSchema` at all keeps its existing "it cannot know" skip.

  **Operator-visible effects.** A sharing rule pointed at an object no gate
  consults now fails loudly instead of quietly writing nothing usable. Every system
  caller of `grant` is the rule evaluator's reconcile, and each of its entry points
  already treats a per-rule failure as best-effort: the boot rule backfill, the
  object-wide re-grant and the business-unit re-grant queue log the refusal (naming
  the rule and the reason) and carry on, and the write hooks catch it, so a user's
  insert or update is never failed by it. `POST /api/v1/sharing/rules/:idOrName/evaluate`
  now answers **422 `SHARING_NOT_ENABLED`**, naming the object and the reason,
  instead of burying the diagnosis in a 500 — the same code-to-status pair the
  per-record shares routes already publish. Withdrawal is untouched, so rows minted
  by an earlier build stay purgeable through `deleteRule` and through evaluating a
  deactivated rule.

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

- 6e6c872: fix(sharing): enforce `publicSharing.eligibility` when a share link is created

  `publicSharing.eligibility` was declared with a TSDoc promising the predicate
  would be evaluated against the candidate record at link creation and refuse with
  422 — and nothing read it. `ShareLinkService.getPolicy()` built its policy from
  the five sibling keys (`enabled`, `allowedAudiences`, `allowedPermissions`,
  `maxExpiryDays`, `redactFields`), all of which were genuinely enforced, and
  skipped this one, so `createLink` ran no predicate at all.

  The consequence was not confined to link creation: `resolveToken` has no auth
  check and reads the record under a system context, so any staff user who could
  read a record could publish it to the open internet past a policy the object
  author wrote specifically to prevent that — with no error raised.

  `createLink` now evaluates the predicate against the candidate record before the
  insert. An ineligible record is refused with `422 RECORD_NOT_ELIGIBLE`, and a
  predicate that cannot be compiled or that faults on the record is refused with
  `422 ELIGIBILITY_UNEVALUABLE` rather than issued past an unanswered policy — a
  restrictive policy must never fail open. Objects that declare no `eligibility`
  key are unaffected, down to the record read's field projection.

  The predicate is evaluated by `@objectstack/formula`'s record-level CEL engine —
  the same evaluator the server-side validation and hook-condition gates use, and
  the same canonical CEL front end sharing rules parse through. Sharing rules
  additionally lower their condition to a pushdown filter because they select a
  set of records inside a query; eligibility judges one record already in hand, so
  record-level constructs such as `has(record.x)` — which the pushdown compiler
  rejects — evaluate normally here.

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
- Updated dependencies [48fcf70]
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
- Updated dependencies [257d97a]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [3ec8186]
- Updated dependencies [6169615]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [a749273]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [b1863a5]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [ffb003c]
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
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
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
- Updated dependencies [ad878e7]
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
- Updated dependencies [3028326]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [fe2dfa1]
- Updated dependencies [c497d26]
- Updated dependencies [6f6fec7]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [bbdbf28]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [3905c00]
- Updated dependencies [4335497]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [b230e5e]
- Updated dependencies [db31402]
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
- Updated dependencies [10c4ea9]
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
- Updated dependencies [d8f65fe]
- Updated dependencies [58ffcab]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [462b713]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [63b33e6]
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
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [8e17759]
- Updated dependencies [2ef1807]
- Updated dependencies [c519533]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [b3de0dd]
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
- Updated dependencies [32d3800]
- Updated dependencies [2b63a00]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [55da611]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [4c45be1]
- Updated dependencies [ac471a0]
- Updated dependencies [6fde910]
- Updated dependencies [60ae58e]
- Updated dependencies [9c82b89]
- Updated dependencies [7f62706]
- Updated dependencies [60cbf9d]
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
- Updated dependencies [742a6a5]
- Updated dependencies [b5f9397]
- Updated dependencies [db0d53c]
- Updated dependencies [1b2eb1b]
- Updated dependencies [afa6aa5]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [c39d713]
- Updated dependencies [b7d3be4]
- Updated dependencies [afb83d3]
- Updated dependencies [2a0d65e]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [f598aa8]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [245d1dc]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [2ad1eba]
- Updated dependencies [881a3cc]
- Updated dependencies [199ec47]
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
- Updated dependencies [c7406b0]
- Updated dependencies [5b89711]
- Updated dependencies [edff010]
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
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [5d4de37]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [c7e7900]
- Updated dependencies [edb4af0]
- Updated dependencies [f09a2e7]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [cb5a75e]
- Updated dependencies [84b6e58]
- Updated dependencies [f160ba4]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [290d944]
- Updated dependencies [042b9ee]
- Updated dependencies [55011af]
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [127f091]
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
- Updated dependencies [53ef057]
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
- Updated dependencies [fce8e49]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [e98fb14]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [5d3ced9]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [1b9a53b]
- Updated dependencies [36d90fc]
- Updated dependencies [1eadac0]
- Updated dependencies [7777e8f]
- Updated dependencies [c804f19]
- Updated dependencies [7c2f7dd]
- Updated dependencies [9b86cf6]
- Updated dependencies [9b26699]
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
- Updated dependencies [dbe92a7]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [e1fa8d5]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [402f534]
- Updated dependencies [59c544d]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [114e727]
- Updated dependencies [7372d46]
- Updated dependencies [5e247fd]
- Updated dependencies [a6cd2c1]
- Updated dependencies [fc3a819]
- Updated dependencies [d56012f]
- Updated dependencies [1a53a02]
- Updated dependencies [75fd301]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [fdca3a1]
- Updated dependencies [1507ba3]
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
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [bf42e76]
- Updated dependencies [edbf873]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [1cae606]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [e3c8ed0]
- Updated dependencies [643b7c7]
- Updated dependencies [fa6dd59]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [55bbefc]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [f1da948]
- Updated dependencies [b9cc17d]
- Updated dependencies [255f2d7]
- Updated dependencies [b4ad984]
- Updated dependencies [bfe689b]
- Updated dependencies [e7a7506]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [0d24078]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [fda61e4]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [de43f94]
- Updated dependencies [5b8f95b]
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
- Updated dependencies [2ddba89]
- Updated dependencies [2ab1257]
- Updated dependencies [4b0ebdb]
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
- Updated dependencies [37a8f2b]
- Updated dependencies [e50e479]
- Updated dependencies [c41828d]
- Updated dependencies [3fb42d2]
- Updated dependencies [8e08bc3]
- Updated dependencies [441d79f]
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
- Updated dependencies [82397b6]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [4df747c]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [31fb03d]
- Updated dependencies [47a4e67]
- Updated dependencies [f07808c]
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [9bc846b]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [bf478e1]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [77fadbf]
- Updated dependencies [8dd98bf]
- Updated dependencies [4fedb11]
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
- Updated dependencies [5c13368]
- Updated dependencies [89d7b35]
- Updated dependencies [1ee48bc]
- Updated dependencies [94f7b6a]
- Updated dependencies [d13f627]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [5487c20]
- Updated dependencies [a841151]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4e74c18]
- Updated dependencies [8b90d68]
- Updated dependencies [4ac12ef]
- Updated dependencies [478f1fd]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [2680cd3]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [1788e19]
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
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [1f6ed16]
- Updated dependencies [db2ea82]
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
- Updated dependencies [5f0852f]
- Updated dependencies [e787608]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
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
- Updated dependencies [d56bcdb]
- Updated dependencies [26bb053]
- Updated dependencies [ee3bde1]
- Updated dependencies [098b629]
- Updated dependencies [60b672e]
- Updated dependencies [f104bab]
- Updated dependencies [d86815e]
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
- Updated dependencies [0a5dc29]
- Updated dependencies [e13fd91]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [d71ff32]
- Updated dependencies [50185a8]
- Updated dependencies [f8cfbb4]
- Updated dependencies [d6bd5a1]
- Updated dependencies [6e6c872]
- Updated dependencies [2bd4e5e]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [488b66c]
- Updated dependencies [148d451]
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
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [6ad13bb]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
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
- Updated dependencies [551f899]
- Updated dependencies [a0fdc56]
- Updated dependencies [946a131]
- Updated dependencies [909895d]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [54f479a]
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
- Updated dependencies [89be40c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [f46e987]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [e3a6f6e]
- Updated dependencies [c9bf940]
- Updated dependencies [a1dd1e4]
- Updated dependencies [a682670]
- Updated dependencies [dadb43f]
- Updated dependencies [2b52bc8]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/objectql@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/platform-objects@17.0.0
  - @objectstack/types@17.0.0
  - @objectstack/metadata-core@17.0.0
  - @objectstack/formula@17.0.0

## 17.0.0-rc.6

### Minor Changes

- dadd1ad: refactor(spec,plugin-sharing): retire the exported `SharingExecutionContext` type (#7218)

  <!-- adr-0087: registered sharing-execution-context-retired -->

  **BREAKING — public surface removal.** `SharingExecutionContext` is deleted from
  `@objectstack/spec` (`contracts/sharing-service`) and from
  `@objectstack/plugin-sharing`, which re-exported it. Both `api-surface/` and
  `export-origins/` snapshots are regenerated accordingly.

  This is the deferred deletion recorded when #7070 split the convergence in two.
  #6523 / PR #7068 converged 36 contract signatures onto the full
  `resolveAuthzContext` envelope (`ExecutionContext`), applying the #6206 ruling —
  enforcement adjudicates on the whole envelope, never a per-site subset. The
  consumer halves then re-annotated the implementations: PR #7140 (identity:
  `plugin-sharing`, `plugin-audit`) and PR #7206 (services: `plugin-approvals`,
  `plugin-reports`). Both landed with the type still exported, because it is
  DEFINED in `packages/spec` and that package's retirement is the spec seat's to
  make. Nothing declares it any more, so it goes.

  **Migration.** Anyone who imported `SharingExecutionContext` from either package
  should import `ExecutionContext` from `@objectstack/spec` instead — the type the
  contracts have declared since #7068. The old shape was six optional fields, all
  of which exist on the envelope with the same names and types, so a value that
  satisfied the retired type already satisfies `ExecutionContext`; only the
  spelling of the annotation changes.

  **No runtime behaviour changes.** The type was erased at compile time and no
  signature's accepted shape moved: the contracts already took the wide envelope.

  **What the retirement did NOT remove — the reason to read the pins.** Deleting
  the type does not make re-narrowing a compile error. Structural subtyping still
  accepts a six-field context where the envelope is expected, so the boundary is
  held by the declared parameter type plus the pins, exactly as before. The three
  `exec-context-annotation.pin.ts` files (`plugin-sharing`, `plugin-approvals`,
  `plugin-reports`) told their failure story as "the parameter narrows back to
  `SharingExecutionContext`", which a deletion would have quietly hollowed out.
  Each now keeps the retired six-field shape as a local, non-exported SPECIMEN
  type and refutes every enforcement parameter against it by type identity, so a
  re-narrowing under ANY name is red — alongside the fresh-literal
  excess-property checks they already carried. `sharing-service.test.ts` in
  `packages/spec` is re-anchored the same way, and its "twin unchanged in shape"
  case becomes a "twin stays retired" case. The narrative the retired type's doc
  block carried (the measured `(context as any).posture` specimen, and why tsc
  cannot police this) moves to the module doc of `contracts/sharing-service`,
  which the contracts and pins now point at.

- 54299ca: feat(sharing): `ISharingService` 的每行写判定补三态 —— 放行 / 不表态 / 拒绝(#6428)

  #5492 的维护者裁决(2026-08-07,B 案)分两步兑现两种已声明的写扩权,本次是 **step 1:
  契约与默认实现**。plugin-security 前像门的 provenance 分层合成是 step 2,本次一行未动。

  **为什么二态不够(实测,不是推演)。** `canEdit()` 用同一个 `true` 表达了两件事 ——
  「我有依据放行」与「本服务对这一行根本不设门」。对只**追加**一道门的调用方(sharing
  中间件、`sys_attachment` 父记录门、ADR-0055 master 判定)这没问题:`true` = 「我不拦
  你」。对让这个答案去**顶替另一个权威的地板**的调用方就是 fail-open —— #5492 的 E2 实验
  把前像写门委托给 `canEdit()` 后,在**没有 `owner_id` 列**的对象上,普通成员跨 creator
  的 UPDATE 变成 `ok: true`(main 上是 403),因为平台的 `created_by` 所有权地板正是这类
  对象唯一的行级写门,而一个「不表态」的 `true` 把它盖掉了。

  **新增契约面**(`@objectstack/spec/contracts`):

  - `SharingWriteVerdict = 'allow' | 'abstain' | 'deny'` —— 闭合联合,普通 TS 类型
    (非 zod 派生,不进 ADR-0122 的 pin 计数)。
  - `ISharingService.checkEdit()` / `checkDelete()` —— 三态主形态,动作边界照 ADR-0111 D3
    继承:`edit` 级共享让 `checkEdit` 答 `allow`、同一行 `checkDelete` 仍答 `deny`;两者
    的 `abstain` 集合完全相同(两道门对「哪些对象由共享设门」意见一致,只在动词上分歧)。

  **兼容:`canEdit()` / `canDelete()` 原样保留,语义零漂移。** 它们被定义为三态的
  **投影** `verdict !== 'deny'` —— 从前对 public / 无 owner 字段 / bypass 对象返回的那个
  `true`,现在落在 `abstain` 上,投影回来仍是 `true`。真值表逐分支被测试钉住(9 个分支
  × 两个动词),因为 `resolveSharingCanEdit`(plugin-security)与 `sys_attachment` 父记录
  门读的正是这一列,翻掉任何一格都是本 PR 未触及的包里的静默权限变更。

  **fail-closed 落点:查询失败是 `deny`,永远不是 `abstain`。** 两者对合成方是相反的指令
  (`abstain` 把这一行交给另一个权威,`deny` 就地终结),把失败读成「没有意见」正是造出上述
  fail-open 的那个混淆。默认实现把所有权查询与共享查询整段包在 fail-closed 分支里,并
  `logger.error` 记名,不静默吞。

  **行为变化(一处,方向收紧)**:引擎查询抛错时,`canEdit`/`canDelete` 从**向外抛**改为
  返回 `false`。两个既有调用点本来就在自己那侧 catch 成 `false`(`resolveSharingCanEdit`
  的 #5386 fail-closed、attachment hook 的降级读),所以对它们是同一结果;其余调用点由
  「异常中止写入」变成「403 拒绝写入」,严格不更宽松。

  **解锁**:#5492 step 2 的前像门可以按 provenance 分层合成 —— `abstain` 回落平台所有权
  地板、`allow` 按声明顶替地板、`deny` 维持拒绝 —— 而不必在 security 侧重算一份
  owner/depth/share/bypass(那会是同一契约的第二份实现)。#5491 与 #5492 同批落地。

### Patch Changes

- db59e9c: hooks: drop the last three `doc` / `previousDoc` alias reads on a hook context — read the engine's own keys only

  Behaviour is unchanged: every one of these limbs guarded against a producer that
  has never existed, so none of them could be reached.

  - `service-storage` attachment lifecycle read `ctx.result ?? ctx.input.doc ?? ctx.input.data`
  - `plugin-sharing` primary-BU projection read `(ctx.input.data ?? ctx.input.doc).user_id`
  - `runtime`'s hook sandbox read `engineCtx.input ?? engineCtx.doc` and `engineCtx.previous ?? engineCtx.previousDoc`

  Every ObjectQL write context spells the payload `data` — measured and pinned by
  `hook-input-shape-contract.test.ts` in `@objectstack/objectql` ("insert carries
  `data` — never `doc`", #5273). The top-level pair is the same family one level
  up: `HookContextSchema` declares `input` / `result` / `previous` and neither a
  `doc` nor a `previousDoc`, and `engine.ts` — the sole producer of a HookContext
  — builds neither. The limbs survived only because the old `HookContext.input`
  contract table documented insert as `{ doc, options }`; that table was corrected
  in #5668, and the same alias was removed from `trigger-record-change` in #5671.
  These are the remainder (#5906), removed rather than left as a second de-facto
  contract (PD #12).

- fc3a36a: fix(spec,objectql,sharing,storage): a hook can tell a per-row bulk dispatch from a single-record write again (#6966)

  A predicate (`multi: true`) write dispatches its lifecycle hooks **once per
  matched row** — `after*` since #5038, `before*` since #5574 — on a context
  deliberately indistinguishable from a single-id write's, so a handler written
  for one record works unchanged on a batch. That indistinguishability is the
  feature, and it also erased the only signal several handlers had.

  Before #5574 a bulk `before*` fired once with `input.id` present-but-`undefined`,
  so "`input.id` is empty" meant "this call stands for N rows". Guards across the
  platform were written on it. Every one of them **silently inverted** rather than
  failing: a per-row context has an id, so the guard now answers "single write" for
  every row of a batch. Two further assumptions broke with it — that the engine
  reuses one `HookContext` across a write's before/after pair, and that `after*`
  work keyed on the write's row set runs once.

  ### New: `HookContext.dispatch`

  The engine now states the fact rather than leaving it to be inferred:

  ```ts
  ctx.dispatch; // { mode: 'record' | 'per-row', index: number, scope: object } | undefined
  ```

  - `mode` — `'record'` when the call is the caller's whole write; `'per-row'`
    when it is one of N.
  - `index` — position in the fan-out. `index === 0` is how a handler does
    batch-scoped work once instead of N times.
  - `scope` — scratch shared by **every** dispatch of one write, both phases, same
    object identity. This is the seam handlers used to get by stashing on the
    context itself, which only ever worked because a single-id write reuses one
    context across its pair.

  Bound at every write dispatch site — insert, update, delete, both phases.
  Optional, and an absent marker reads as "not a per-row dispatch", so a handler
  reads `ctx.dispatch?.mode === 'per-row'` and existing code keeps its behaviour.
  Reads carry no marker: a read has no fan-out.

  It is deliberately **not** the `isPredicateBulkWrite` discriminator #5574
  retired. That one was removed under ADR-0049 for having neither a producer nor a
  reachable consumer — it inferred "bulk" from `input.id` and `options.multi` at
  the consumer, which is exactly what `asScalarId` stays unexported to prevent
  (#4434 / #4550). This one is produced by the engine at the point the dispatch
  ladder is decided, and the platform's own handlers read it.

  ### Behaviour fixed

  **Sharing rules and the record-share cascade (`@objectstack/plugin-sharing`).**
  The `before*` hook stashes the write's affected row set for the `after*` hook to
  act on. On a predicate write that stash was landing on a per-row context the
  `after` phase never saw, so `readAffectedRows` answered `resolve-failed` and both
  subscribers took their safe branch: every bulk update or delete on a ruled object
  revoked **all** of that object's rule grants and queued a full asynchronous
  re-grant — once per matched row, with the repeats racing each other's re-grants.
  Access was never widened (the trade is the ruling's "over-granting is an
  incident, under-granting is a wobble" direction), but a bounded write now takes
  the bounded path again: the rows are unioned as the engine hands them over, the
  cap still applies to the union, and the `after*` work runs once per write.

  **File-reference ownership (`@objectstack/service-storage`).** The `beforeDelete`
  hook that pre-resolved ids for a `where`-shaped delete was dead on every path,
  and `afterDelete` was falling back to one `sys_file` lookup **per row** where the
  batch fits one `$in`. Both are fixed by the marker, and the pre-resolution query
  is gone entirely — the engine has already matched the rows and hands them over.
  The `beforeUpdate` copy-on-claim pass no longer runs once per row against a
  batch-scoped payload, which also removes a row-conditioned rewrite of a shared
  `SET` clause (out of contract under ADR-0058 Addendum II D3).

  No authored metadata changes, and no write's result, event or return contract
  changes.

- 8e13ca8: fix(plugin-sharing): share-link 路由把完整授权信封交给 enforcement,修复 `group` 姿态下建链恒 403(#6206,裁决 A 案的消费半边)

  `SharingServicePlugin` 的 share-link 路由此前在 `resolveAuthzContext` 之后重新
  拼一个四字段对象(`userId` / `tenantId` / `positions` / `permissions`),而这个
  对象被原样当作 enforcement context 喂进 `engine.find` —— 即 [Finding-2]
  「只能为你自己看得见的记录建链接」那道可见性校验。被丢在半路的是
  `accessible_org_ids`、`org_user_ids`、`systemPermissions`、`posture`、
  `tabPermissions`。

  实害(已复现,非仅代码读出):`group` 租户姿态下 `accessible_org_ids` 就是
  Layer 0 那堵墙(ADR-0105 D2),集合缺席即判否(fail closed)。于是可见性校验
  查不到任何行,建链接对**调用方本来读得到的记录**返回
  `403 FORBIDDEN: Not permitted to share <object>/<id>` —— 一个已发布姿态上,
  已发布功能完全不可用。`single` 姿态(默认)不读该字段,行为不变。

  改法按维护者 2026-08-07 的 A 案裁决(契约半边 #6430 / PR #6511 已落):信封
  **整个**透传(`{ ...authz, isSystem: false }`),不再逐字段挑选 —— 逐字段挑选正是
  这条缝出问题的方式,也是下一个新增授权维度会再次漏掉的地方。`posture` 随上下文
  流动、不在 enforcement 处重推(ADR-0095 D2)。窄类型 `ShareLinkExecutionContext`
  保留,但只服务路由自己的 401 判定(认证与否),不再出现在任何裁决路径上。

  `ShareLinkService.createLink` / `revokeLink` / `listLinks` 与 `canManageShares`
  探针的参数类型随之收成完整 `ExecutionContext`,与 #6511 落地的契约一致。

- 3415a61: refactor(plugin-sharing,plugin-audit): enforcement implementations annotate the full `ExecutionContext` (#7136)

  The consumer half of #6523. That change converged 36 contract signatures onto
  the complete `resolveAuthzContext` envelope, applying the #6206 ruling —
  enforcement adjudicates on the whole envelope, never a per-site subset. The
  implementations behind those contracts still annotated their own parameters
  with `SharingExecutionContext`, the six-field shape the contracts used to name,
  so nothing they could _read_ had widened.

  `SharingService`, `SharingRuleService`, the sharing exec-context seam and
  plugin-audit's comment-access gates now declare `ExecutionContext` on all 27 of
  those parameters — plus the two return types that produce the contexts feeding
  them — and the casts the narrow annotation forced are gone:

  - `exec-context-seam.testkit.ts` resolved a REAL context and then had to force
    it into the narrow type — `{ ...authz, isSystem: false } as unknown as
SharingExecutionContext`. It now returns what it resolved, so a drift in
    `resolveAuthzContext`'s output reaches the tests that trust this seam instead
    of being absorbed by a double cast.
  - `SharingRuleService`'s system context is typed as the envelope and passed as
    itself, retiring `SYSTEM_CTX as any` at all 10 of its call sites — an erasure
    on an enforcement input switches checking off for the whole argument, not
    just for the readonly-array mismatch that provoked it.
  - The `(context as any).userId` / `.tenantId` reads in `SharingService` now read
    declared fields.

  **No runtime behaviour changes.** The values were always complete — this
  family's damage was type-side — so every gate answers exactly what it answered
  before. Method parameters only WIDEN what they accept, so no caller is affected.

  Two casts are deliberately kept, and are now documented where they sit:
  `__readScope` / `__writeScope` are private keys plugin-security's middleware
  stamps onto the context it forwards and are not fields of the envelope, and
  `organizationId` is not on the envelope at all — that spelling has its own
  history (#5858 / `check:org-identifier`) and was held out of this change.

  Because a re-narrowed annotation would compile, ship and pass every test in
  these packages, the convergence is pinned by a new compile-time module,
  `exec-context-annotation.pin.ts`: it hands each enforcement parameter a fresh
  literal naming envelope-only fields (`posture`, `accessible_org_ids`,
  `org_user_ids`), which TypeScript's excess-property check rejects the moment a
  parameter narrows back, plus negative cases so a parameter erased to `any`
  cannot pass either.

- 17688fe: fix(sharing): the by-id write gate defers to an app-authored RLS widener instead of hard-refusing (#5493)

  HotCRM's 17.0 GA acceptance sweep declared two RLS update-wideners on one
  profile and measured one of them working. On the junction object
  `crm_campaign_member` a non-owner PATCH returned 200; on `crm_campaign` the
  identical shape returned 403 `FORBIDDEN: insufficient privileges to update
crm_campaign`. That sentence is the sharing middleware's, not the row gate's
  `(row-level security)` — so the refusal landed **before** RLS was consulted and
  the declared widener was never asked.

  The discriminator was never "carries sharing rules". It is whether **record
  sharing enforces on the object at all**: `checkEdit` abstains — and `canEdit`
  therefore answers `true`, letting the write through to RLS — when the effective
  sharing model is `public` (which `controlled_by_parent` maps onto) or when the
  schema has no `owner_id` field. A junction lands in that set; an ordinary owned
  business object does not. Same declaration, opposite outcome, split by a
  property no author writes down.

  Row-level write authority is ONE composite determination (maintainer ruling on
  #5492), so the middleware no longer ends the decision by itself. Before it
  hard-refuses a **by-id** update or delete, it asks the security service's
  `ISecurityService.checkAuthoredRowWrite` — the fail-closed verdict landed by
  #5493 step 1 (PR #6841) — whether an **app-authored** (non-floor) row-level
  policy admits this row for this operation. `admit` retracts this authority's
  refusal and hands the row to the security pre-image gate, which composes per
  #6684/#5492 and makes the final row decision. It does not authorize anything on
  its own.

  Everything else is unchanged, deliberately:

  - **The guarded surface does not shrink.** A member with no authored policy, no
    share and no bypass is still refused; a read-level share still never widens a
    write; an `edit`-level share still widens update and not delete (ADR-0111 D3),
    and an update-only authored widener does not open delete either — the verb is
    threaded through to the verdict, not collapsed.
  - **Fail-closed on every non-`admit` outcome.** No security service (a
    deployment without `@objectstack/plugin-security`), a service predating the
    method, a throwing probe, a principal-less context, an on-behalf-of context
    (ADR-0090 D10) and any unrecognised verdict all leave today's refusal
    byte-for-byte intact. The probe is reached through the same structural
    late-binding this plugin already uses for `hasWriteBypass`; no runtime
    dependency on `plugin-security` is introduced.
  - **A creator who is no longer the owner gets nothing back.** The platform's own
    ownership floor (`created_by == current_user.id`, shipped on the additive
    `member_default` baseline) matches a record transferred away from its creator,
    so a deferral keyed on "the composed RLS admits this row" would return
    transferred records to former creators. The verdict is provenance-aware and
    abstains there; the deferral does not widen it.
  - **The bulk path is untouched** — it composes a filter rather than a verdict,
    and is tracked separately (#6736).
  - **Objects with no owner field are untouched** (#6698): sharing abstains, the
    gate never refuses, so the deferral is never reached and the platform
    `created_by` write floor remains their only row-level write gate.

- fd6572b: feat(plugin-sharing): an `isSystem` write batch that materialises zero sharing grants now says so, once (#6783)

  The sharing-rule record-write hooks skip `isSystem` sessions, so a seed run — or
  any internal write batch — lands rows on an object an **active** sharing rule
  covers and creates no `sys_record_share` rows at all. The skip is correct: the
  `kernel:bootstrapped` backfill reconciles every rule and `evaluateRule` is
  idempotent, so the state heals. What was wrong is that nothing said so.

  hotcrm#640 is the specimen: a fresh install with 9 active sharing rules, 9
  accounts matching their criteria, users holding the right positions — and an
  empty `sys_record_share`. Every visible layer said "configured". The only way to
  learn that the seed path had skipped materialisation was to query the table,
  find it empty, and read `plugin-sharing`'s source.

  **What changed.** The two skips that drop grant materialisation — `afterInsert`
  and `afterUpdate` — now emit one INFO line naming the behaviour and both
  remedies:

  ```
  [sharing-rule] sharing materialisation skipped for isSystem writes; re-evaluate rules or restart to backfill
  ```

  with the object and the active rules on it as metadata.

  **One line per batch, not per row.** The notice is latched per object per hook
  binding generation, so a seed batch writing 500 rows produces exactly one line.
  The defect being fixed is silence; a per-row flood would be the same defect with
  a different symptom. The latch re-arms with the binding — `bindRuleRebindTriggers`
  re-binds the package on every `sys_sharing_rule` write — so a changed rule set
  gets its own notice instead of inheriting the previous generation's silence.

  **INFO, not warn or error**, deliberately: the behaviour is correct and
  self-healing, and warning about a subsystem working as designed is how operators
  learn to ignore it.

  Deliberately unchanged:

  - **The skip itself.** No write now materialises grants that did not before, and
    no `sys_record_share` row is created, updated or revoked by this change.
  - **No new switch or flag.** The notice is unconditional.
  - **`afterDelete` stays silent.** A delete skips _revocation_, not
    materialisation, and the remedy the line names cannot repair that class:
    `evaluateRule` iterates records that still exist, so neither re-evaluating a
    rule nor restarting can reach a grant whose record is gone. That class belongs
    to the record-delete share cascade and the boot orphan sweep.

  The line is a statement about the write path, not a claim that grants were owed —
  whether a given seeded row satisfies a rule's criteria is exactly the query the
  skip exists to avoid, so answering it here would cost the skip its purpose.

- 2465133: fix(plugins): sweep the service-lookup erasures out of the plugin composition roots, and fix the two alias-only HTTP reads it exposed (#4251 B5)

  Batch B5 of the #4251 sweep: the seven remaining `packages/plugins/*` composition
  roots. 35 lookup sites that had been erased to `any` now carry the slot's
  contract, so the compiler checks what each plugin actually calls on the service
  it resolved. The ratchet drops 143 sites / 32 files to 108 / 25.

  **Two real defects, both of the shape this sweep exists to find.** Approvals'
  actionable-link pages (ADR-0043) and sharing's public share-link REST routes each
  read the HTTP server under `http-server` _only_ — the deprecated alias. The
  ledger records `http.server` as canonical and as the only name present on every
  provider path: `runtime.ts`'s `config.server` path registers no alias at all. On
  that path both lookups threw, the surrounding `catch` swallowed it, and the
  routes silently never mounted — approval e-mail action links 404'd and the
  share-link surface was absent, with nothing in the log to say so. Both reads are
  now canonical-first with the alias as fallback, each name in its own `try`
  because `getService` throws on an empty slot (so `a() ?? b()` inside one `try`
  never reaches `b` — the same correction #4393 made in metadata and
  cloud-connection).

  Typing choices follow the batch method: pure data-plane consumers take the
  narrow contract (`IDataEngine` in reports), consumers that bind hook or
  middleware seams take the engine seen whole (`IObjectQLEngine` in approvals,
  sharing and pinyin-search), and slots with no contract get a **named** local
  surface rather than `any` — plugin-email's `MailSettingsSurface`, and the
  surfaces the consuming packages already declared (`ApprovalMessagingSurface`,
  `SharingSecurityProbe`, `ReportEmail`). A named surface that omits a member
  still makes the compiler name every call site; `any` says nothing.

  No behaviour change beyond the two alias reads. No contract changes.

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
- Updated dependencies [ad878e7]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [3028326]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [fe2dfa1]
- Updated dependencies [6f6fec7]
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
- Updated dependencies [10c4ea9]
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
- Updated dependencies [55da611]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [6fde910]
- Updated dependencies [9c82b89]
- Updated dependencies [74155c7]
- Updated dependencies [742a6a5]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [b7d3be4]
- Updated dependencies [2a0d65e]
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
- Updated dependencies [edb4af0]
- Updated dependencies [f09a2e7]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [55011af]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [53ef057]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [c804f19]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [6965160]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [dbe92a7]
- Updated dependencies [c6b6bb4]
- Updated dependencies [59c544d]
- Updated dependencies [2f59da0]
- Updated dependencies [114e727]
- Updated dependencies [5e247fd]
- Updated dependencies [1a53a02]
- Updated dependencies [1507ba3]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [bf42e76]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [bfe689b]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [de43f94]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [3fb42d2]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [82397b6]
- Updated dependencies [4df747c]
- Updated dependencies [7084313]
- Updated dependencies [47a4e67]
- Updated dependencies [91cefb8]
- Updated dependencies [9bc846b]
- Updated dependencies [0e043d8]
- Updated dependencies [4fedb11]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [d13f627]
- Updated dependencies [a841151]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [1788e19]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [1f6ed16]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [d86815e]
- Updated dependencies [61282f9]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [e13fd91]
- Updated dependencies [2bd4e5e]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
- Updated dependencies [c9bf940]
- Updated dependencies [a682670]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/objectql@17.0.0-rc.6
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/formula@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ee3bde1]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
- Updated dependencies [148d451]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/objectql@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/formula@17.0.0-rc.5
  - @objectstack/platform-objects@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- 7f955e5: fix(sharing): deleting a record now revokes every `sys_record_share` row on it, whatever the source (#5103)

  A share row says "principal P has level L on (object O, record R)". Delete R and
  the row describes nothing — yet until now it stayed in the table forever.

  #4779 (PR #5102) bound an `afterDelete` for this, but inside the sharing-RULE
  package, where two conditions fenced it in: it revokes only `source: 'rule'`
  rows, and it binds only on objects that appear in `sys_sharing_rule`. So an
  object that uses nothing but MANUAL shares — a `sharingModel: 'private'` object
  with no rule ever configured — had no delete hook at all, and **manual share +
  record delete = a permanent orphan**.

  Today the harm is bounded, and only because record ids are never reused: the
  `record_id IN (…)` predicate `buildReadFilter` emits matches nothing. Nothing
  enforces that assumption. A custom primary key, an import that preserves ids, or
  any future id recycling turns every one of those rows into a real privilege
  escalation — a new record landing on a recycled id inherits the dead record's
  recipients outright. Secondarily, `sys_record_share` grew without bound and
  Setup's Record Shares list showed rows pointing at nothing.

  **What changed**

  - **A record-delete cascade on every sharing-capable object.** `plugin-sharing`
    binds one `beforeDelete`/`afterDelete` pair with no object filter and judges
    the object's sharing posture from its `sharingModel` metadata _per delete_.
    Nothing is enumerated at boot, so nothing goes stale: an object that gains
    `sharingModel` at runtime is covered on its very next delete, with no rebind.
    Bounded deletes (a scalar id, an `$in` list, or a predicate matching at most
    1000 rows) are revoked synchronously and set-based; an unbounded one queues an
    object-scoped orphan sweep instead. System-context deletes cascade too.
  - **A boot-time orphan sweep keyed on record existence.** On
    `kernel:bootstrapped`, share rows whose RECORD no longer exists are revoked —
    historical orphans, rows a failed hook missed, and the one posture the cascade
    deliberately skips (an unmarked system object). This is a different question
    from the existing `sweepOrphanedRuleGrants`, which asks whether the RULE row
    still exists and therefore can never see a manual share. Bounded per boot:
    keyset pages, one batched existence probe per object per page, and a scan cap
    that reports when it stopped early. An object whose existence probe FAILS has
    its rows left in place — "could not ask" is never read as "the record is gone".

  **What did not change**

  Rule _recompute_ still never touches a manual share. That boundary (#5102) is
  the point: while the record exists, a manual grant is a human decision no rule
  evaluation may overrule. Only the record's DELETION revokes it, and only because
  there is no longer anything to have access to.

  New exports for hosts that compose the plugin by hand:
  `bindRecordShareCascade` / `unbindRecordShareCascade`,
  `objectCanCarryRecordShares`, `SharingService.revokeSharesForDeletedRecords`,
  `SharingService.sweepOrphanedRecordShares`, and `effectiveSharingModel`. Nothing
  was removed or renamed; the standard `SharingServicePlugin` composition needs no
  changes.

- 6e66cbe: fix(plugin-sharing): a deleted record kills its share links — resolve fails closed, and the delete cascades (#5190)

  `ShareLinkService.resolveToken` checked the token, `revoked_at`, `expires_at`,
  the audience and the password — **but never whether the record the link points
  at still exists**. Nothing revoked links on delete either: #5103's cascade
  covers `sys_record_share` only. So a share link outlived its record, kept
  resolving, and kept stamping `use_count` / `last_used_at`.

  That is worse than the `sys_record_share` orphan #5103 fixed, and for a
  structural reason: a share row names its beneficiaries, while a share link is an
  identity-less **capability token** — holding the URL _is_ the authorisation. The
  moment a record id is reused (custom primary keys, an import that preserves ids,
  any future id recycling) a link that morally died with its record starts
  authorising a brand-new record, for whoever kept it.

  Both halves of the fix ship together, and the first does not depend on the
  second having run:

  - **`resolveToken` re-asks whether the record exists**, and returns `null`
    through the _same_ branch as revoked / expired — no distinct code, no distinct
    error, nothing an unauthorised holder can read "that record was deleted" out
    of. The probe sits after the cheap in-memory gates (a revoked link still costs
    no query) and _before_ the usage stamp, so a dead record no longer ticks
    `use_count` / `last_used_at`. It fails **closed**: a probe that throws denies,
    because "cannot ask" must not authorise.
  - **Record deletes now cascade to `sys_share_link`**, on #5103's existing seam
    rather than a parallel one — the same global `beforeDelete` row-set stash, the
    same `afterDelete` set-based revoke, the same serialized sweep queue for
    unbounded deletes, and the same `kernel:bootstrapped` orphan sweep (keyset
    pages, a scan cap that reports itself, one batched existence probe per object
    per page, and rows left strictly alone when that probe fails). The two halves
    are isolated, so a driver error reclaiming grants cannot also skip the tokens.

  The link half judges posture from `publicSharing`, which is _independent_ of
  `sharingModel`: the object most likely to hold links is a platform object that
  opted into link sharing, and that is exactly the object the record-share
  predicate skips. `publicSharing` declared counts even when it is currently
  `enabled: false` — links minted while it was on outlive the flip.

  An orphaned link row is **deleted**, not stamped `revoked_at`: its subject is
  gone, so there is no live link left to keep a revocation record of, and the
  table would otherwise only grow (with Setup's link lists pointing at records
  that no longer exist). Links an admin revokes keep their audit row exactly as
  before.

  No metadata, spec or API shape changes. Deployments see fewer rows in
  `sys_share_link` after the next boot, and links whose record was already deleted
  stop resolving immediately — which is the point.

- f226605: fix(plugin-sharing): hierarchy resolver 拿到调用方真实的活动组织(权威 `organizationId`)(#5859)

  `resolveOwnerScopeIds` 构造 `HierarchyScopeContext` 时读的是
  `(context as any).organizationId` —— **仓内没有任何传输层写过这个键**。REST
  (`rest-server.ts`)和 runtime dispatcher(`resolve-execution-context.ts`)都从同一个
  授权解析器 `resolveAuthzContext` 组装执行上下文,活动组织落在 `tenantId`
  (session 路径 = `session.activeOrganizationId`,API-key 路径 = `sys_api_key.organization_id`),
  `ExecutionContext` 的字段注释写的也正是这句。所以这个读取**结构性恒为 `null`**:
  自 ADR-0057 以来,每一次 DEPTH(`unit` / `unit_and_below` / `own_and_reports`)解析
  都是在**没有组织约束**的前提下跑的,而企业版 resolver 只按 `organizationId` 收窄
  自己的 owner 集合 —— 于是整条 DEPTH 租户隔离从未生效。

  爆炸半径不止「共享管理」一路:同一个 owner 集合喂给 `matchesOwnerScope` →
  `canEdit` / `canDelete`,以及批量写路径 `buildWriteFilter`。#5852 的实测里,
  `group` 姿态下的普通成员对**兄弟组织**记录 `POST /data/:obj/:idB/shares` 得到
  **201**;探针那个 app 的写路径另被 `member_default` 的 `owner_only_writes`
  (keyed on `created_by`)挡下,所以只观测到共享管理一路 —— **不带这条 owner-only
  RLS 的部署,跨组织 edit/delete 同样放行**。

  本次修复(producer 半边,契约半边见 #5858 / PR #5973):

  - 权威字段 `organizationId` 由执行上下文的活动组织填充;`tenantId` 作为
    `@deprecated` 兼容别名原样继续携带(不是消费端 `?? tenantId` 兜底 —— 那正是
    #5858 为 resolver 明令排除的宽容消费者形状)。同样的映射在
    `@objectstack/plugin-security` 的 Layer-0 租户墙里早已在用
    (`computeTenantLayer0Filter({ organizationId: context?.tenantId })`),两层
    enforcement 现在按同一个字段的同一个值收窄。
  - 无活动组织时如实传 `null`(契约类型即 `string | null`),空白字符串归一为
    `null`,绝不让一个假的组织 id 混进 resolver 的查询与日志。
  - resolver 抛错的静默回退改为**留声**(`logger.warn`):此前「resolver 炸了」和
    「层级里确实没有别人」在外部完全同形,这也是本缺陷长期不可见的原因之一。

  ## 姿态感知的组织门(user-visible 行为变化)

  `SharingService` 新增一个 late-bound 的 `tenancy` 姿态探针(读法与 `SecurityPlugin`
  为 Layer-0 墙读 `tenancy` 服务的完全一致,由 `SharingServicePlugin` 自动接线),
  按 **ADR-0105 D1** 的既有分叉决定「没有活动组织」意味着什么 —— 与
  `computeTenantLayer0Filter` 对同一问题给出的答案逐条同形:

  - **`single`**(纯单租户,无组织):**行为不变**,DEPTH 照常 widened。此处「没有组织」
    是那一个隐含租户,不是「所有组织」。
  - **`group` / `isolated`**(有墙):权威组织缺失/空白 → **拒绝**,根本不咨询 resolver,
    回落 owner-only 并打一条点名 ADR-0095 D1 / ADR-0105 D1 与 #5973 契约义务的 `warn`。
    即:有墙部署里,缺组织的 owner-scope 解析从「按无租户约束展开」变为「拒绝展开」。
  - **姿态解析不出**(未接线 / 探针抛错 / 词表外的值)→ 按**有墙**处理。未知姿态不是
    `single` 的证据,否则恰恰在配置已经可疑的部署上恢复了展开。

  对已有部署的影响:`single` 部署零变化;`group` / `isolated` 部署中,一个**没有活动
  组织**的调用方将不再通过 DEPTH 拿到跨组织的 owner 集合(共享管理 / edit / delete /
  批量写四条路径同时闭合)。

- c272e48: fix(plugin-sharing): recompute sharing rules for predicate (`multi`) writes — stale `sys_record_share` grants no longer survive a bulk update (#4779)

  `bindRuleHooks` located the rows to recompute from a single record id:

  ```ts
  const id = String(data?.id ?? ctx?.input?.id ?? "");
  if (!id) return;
  ```

  `ObjectQL.update()` only populates `input.id` when `where.id` is a scalar. A
  predicate write (`multi: true`) routes to `updateMany`, leaves `input.id`
  undefined, and carries no id in its payload — so **every bulk write skipped
  sharing-rule recompute entirely**.

  The consequence is a fail-open on the authorization side. A criteria-based rule
  materialises `sys_record_share` rows; an admin then bulk-updates those records
  out of the criteria (`{ where: { region: 'east' }, multi: true, data: { region:
'west' } }`); nothing recomputes, the grant rows stay in the table, and the
  recipients keep the read/edit access the rule no longer implies. Same family as
  #4757 (`sys_attachment`) and #4778 (approval locks), but better hidden — a stale
  grant is indistinguishable from a legitimate one. The reverse direction (bulk
  update **into** a rule's criteria never granting) was broken too.

  **What changes**

  The hooks now key off the write's ROW SET instead of one id. `beforeUpdate` /
  `beforeDelete` resolve the affected rows from the predicate and stash them on
  the shared hook context (the `before` hook is where it must happen — the write
  is what makes those rows unfindable); the `after` hook acts on them:

  - **Bounded set (≤ 1000 rows, `RULE_RECOMPUTE_ROW_CAP`)** — `evaluateAllForRecord`
    per row, synchronously. Diff-based, so this covers both directions: rows moved
    out of a rule's criteria are revoked, rows moved in are granted.
  - **Unbounded set** (over the cap, `multi: true` with no `where` at all, or a
    resolve that failed) — every `source: 'rule'` grant on the object is revoked
    **synchronously** in one set-based statement, and the deserved grants are
    restored **asynchronously** by reconciling the object's rules.

  **The write is never refused.** Refusing would turn an internal recompute bound
  into a business-visible limit on how many rows an admin may update, reported by
  a subsystem they never configured. The asymmetry it trades on instead:
  over-granting is a security incident, under-granting is an availability wobble.
  So the safety half is always synchronous and complete, and only the expensive
  restoration half is deferred.

  **Operational note.** After a bulk write whose row set could not be bounded,
  recipients may briefly lose access to records they still qualify for, until the
  background re-grant finishes. It is logged with the object and the reason. The
  re-grant is in-process; if it is lost to a crash, the plugin's existing
  `kernel:bootstrapped` backfill re-runs the same idempotent reconcile on the next
  start, and any subsequent `sys_sharing_rule` write reconciles too.

  **Also fixed:** the rule hooks now bind `afterDelete` and retire the deleted
  records' rule grants. Nothing else could: `evaluateRule` iterates records that
  still exist, so a grant whose record is gone was unreachable by every reconcile
  path and outlived restarts. Harmless only while record ids are never reused —
  an assumption nothing in the platform enforces.

  New on `SharingRuleService`: `revokeRuleGrantsForObject`,
  `revokeRuleGrantsForRecords` and `evaluateAllRulesForObject`. Manual
  (`source: 'manual'`) shares are never touched by any of them.

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
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [c497d26]
- Updated dependencies [bbdbf28]
- Updated dependencies [2e284b2]
- Updated dependencies [3905c00]
- Updated dependencies [4335497]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [d8f65fe]
- Updated dependencies [58ffcab]
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
- Updated dependencies [2b63a00]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [0f17114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [afa6aa5]
- Updated dependencies [afb83d3]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [c7406b0]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [290d944]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [e98fb14]
- Updated dependencies [5d3ced9]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [1b9a53b]
- Updated dependencies [1eadac0]
- Updated dependencies [7c2f7dd]
- Updated dependencies [9b26699]
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
- Updated dependencies [1cae606]
- Updated dependencies [108ba8d]
- Updated dependencies [b9cc17d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [0d24078]
- Updated dependencies [089767f]
- Updated dependencies [5b8f95b]
- Updated dependencies [2ddba89]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [37a8f2b]
- Updated dependencies [441d79f]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [bf1edef]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [2680cd3]
- Updated dependencies [c5a5996]
- Updated dependencies [db2ea82]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [d56bcdb]
- Updated dependencies [f104bab]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [488b66c]
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
- Updated dependencies [946a131]
- Updated dependencies [909895d]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
- Updated dependencies [2b52bc8]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4
  - @objectstack/objectql@17.0.0-rc.4
  - @objectstack/formula@17.0.0-rc.4

## 17.0.0-rc.2

### Major Changes

- 4b6cac7: feat(spec)!: resolve the three cross-form dual-source names — ShareRecipientType, TransformType, suggestFieldType (#4539)

  Three `dual-source-exports.baseline.json` rows where the two declarations
  sharing a name did not even share a FORM (type vs const, or two unrelated
  functions), so a wrong import-path pick had no shape overlap to hide behind
  and failed far from the cause. Each judged against a three-repo import-level
  scan (framework, cloud, objectui — the latter two contained zero references
  to all three names). All three rows are deleted from the baseline.

  **Renamed — `./contracts` `ShareRecipientType` → `RecordShareRecipientType`:**

  Two live concepts shared the name. The security zod enum
  (`user | team | position | unit_and_subordinates | business_unit`) is the
  authorable sharing-RULE recipient vocabulary and keeps the name. The contracts
  type describes a different thing — the `recipient_type` a `sys_record_share`
  ROW may carry — and its claim to "mirror spec/security" had been false since
  `group`→`team`/`guest` were retired there. Its member set is now aligned to
  the storage-side gate it actually mirrors, the `SysRecordShare`
  `recipient_type` select: `role` (never persistable, zero producers) is
  replaced by `position`. Only `user` is enforced (and written) today;
  `ISharingService.grant` keeps refusing every other value (ADR-0078).
  Fix: `import type { ShareRecipientType } from '@objectstack/spec/contracts'`
  (or from `@objectstack/plugin-sharing`, whose re-export is renamed in
  lockstep) → `RecordShareRecipientType`; code that named the `'role'` member
  was describing a value no row could ever hold — use the rule vocabulary
  (`SharingRuleRecipientType`) if a role recipient was meant.

  **Renamed — `./shared` `TransformTypeSchema` / `TransformType` →
  `FieldMappingTransformSchema` / `FieldMappingTransform`:**

  `./data`'s `TransformType` (the authorable import-mapping enum
  `none | constant | lookup | split | join | javascript | map`) is the live
  declaration and keeps the name. `./shared` exported `TransformType` as the
  inferred type of `TransformTypeSchema` — a differently-shaped discriminated
  union of transform CONFIG objects — with zero importers for either name in
  all three repos. The shared pair is renamed (not just the alias deleted):
  the docs generator derives `import type { X }` examples by stripping
  `Schema` from each schema const, so an alias-less `TransformTypeSchema`
  would have kept generating a reference to an export that no longer exists.
  Fix: `TransformTypeSchema` → `FieldMappingTransformSchema`,
  `import type { TransformType } from '@objectstack/spec/shared'` →
  `FieldMappingTransform` (same shape); importers who meant the import-mapping
  enum import `TransformType` from `@objectstack/spec/data`.

  **Renamed — `./data` `suggestFieldType` → `suggestFieldTypeForSqlType`:**

  The only function-kind dual-source. The two implementations were never forks
  of one function — different signatures, semantics and return types:
  `shared/suggestions.zod.ts` (kept on `.` / `./shared` under the original
  name) is the typo-suggester for an invalid authored FieldType
  (`(input: string) => string[]`, alias table + Levenshtein, feeds the zod
  error map), while `data/type-compat.ts` is the deterministic SQL-column →
  FieldType mapper for external-datasource drafts
  (`(rawType, dialect?) => FieldType | undefined`, ADR-0015 §4.6). Same input,
  divergent outputs — `('varchar(255)')` → `[]` vs `'text'`; `('text_area')` →
  `['textarea']` vs `undefined`; `('int')` → `['number']` vs `'number'` — and
  the wrong pick compiled wherever the result was only truthiness-checked
  (`[]` is truthy). Behavioral divergence is now pinned in
  `data/type-compat.test.ts`.
  Fix: `import { suggestFieldType } from '@objectstack/spec/data'` →
  `suggestFieldTypeForSqlType` (same signature); imports from the root entry
  or `./shared` are unaffected.

### Minor Changes

- ba5ff2f: fix(plugin-sharing): deactivating or deleting a sharing rule actually withdraws its grants (#4433, #4434)

  An over-granting sharing rule had no withdrawal path on the product's API
  surface. Deactivating it left every grant it had materialised in place — not on
  the next record touch, not after a full restart — and the DELETE route answered
  500 for both address forms it advertises, so the rule could not be removed
  either. Together that made a too-broad rule unrecoverable short of hand-editing
  `sys_record_share`, against a v17 release note that advertises the opposite
  ("switching a rule off actually withdraws access").

  `minor`, not `patch`: this changes an observable runtime behaviour that
  deployments may have adapted to. A `source: 'rule'` grant whose rule is
  inactive — or whose rule row is gone — now disappears, on the deactivating
  write, on the next touch of the record, and on the next boot. Anything relying
  on those rows surviving deactivation (including data repaired by hand around
  the old behaviour) will see them revoked on upgrade. `DELETE
/api/v1/sharing/rules/:idOrName` also starts succeeding where it used to 500,
  so callers that treated that 500 as "unsupported" will now really delete.

  #4433 — three independent gaps, one per path the report walked:

  - **The deactivating write.** The `sys_sharing_rule` reconcile trigger skipped
    every `isSystem` write, on the theory that those were boot seeding.
    `SharingRuleService.defineRule` — the only implementation behind
    `POST /sharing/rules`, and the documented way to deactivate a rule — writes
    with SYSTEM_CTX unconditionally, because it must reach a platform table the
    sharing middleware otherwise gates. So the skip caught 100% of REST
    authoring: the withdrawal path built by #3821 existed, had tests (against a
    mocked session the real path never sends), and was unreachable in production.
    Now gated on boot phase, which is the question the skip actually meant to
    ask.
  - **The record touch.** `evaluateAllForRecord` listed only active rules, so a
    deactivated rule was absent from the loop entirely and its grants were never
    examined. It now reconciles every rule; an inactive one desires nothing and
    takes the existing revoke-the-remainder branch.
  - **The boot pass.** `backfillRuleGrants` was handed an `activeOnly` list,
    making it structurally incapable of revoking anything. It now walks every
    rule, and a new `sweepOrphanedRuleGrants` retires grants whose rule row is
    gone entirely — unreachable by rule iteration, so they need their own sweep.

  #4434 — `deleteRule` purged `sys_record_share` with a predicate-shaped
  `engine.delete` carrying neither a scalar id nor `multi: true`, the one shape
  the engine's dispatch refuses; it threw before ever reaching the rule row.
  Fixed by routing through the same `SharingService.revoke` path every other
  withdrawal already uses, rather than adding `multi: true` — a rule's grants now
  retire exactly one way instead of two divergent ones.

  The unit fakes are part of the fix: `makeEngine().delete` accepted any `where`,
  which is why #4434 shipped green — the pre-existing "deleteRule drops rule and
  all its grants" test asserted success against a delete the running server
  always rejected. The fakes now mirror the real engine's dispatch guard.

### Patch Changes

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [257d97a]
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
- Updated dependencies [462b713]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [63b33e6]
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
- Updated dependencies [4c45be1]
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
- Updated dependencies [cb5a75e]
- Updated dependencies [84b6e58]
- Updated dependencies [f160ba4]
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [127f091]
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
- Updated dependencies [1ee48bc]
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
- Updated dependencies [26bb053]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [50185a8]
- Updated dependencies [d6bd5a1]
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
  - @objectstack/objectql@17.0.0-rc.2
  - @objectstack/platform-objects@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2
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

- e5e8b10: feat(sharing): a record's share-manager may revoke any share-link on that record (ADR-0111 D8)

  `ShareLinkService.revokeLink` was creator-or-system only, so a record's owner or
  a Modify-All admin could not kill a link someone else minted on their record —
  their record's exposure, but not their link to revoke. Revoke authority now
  also admits a record **share-manager**, probed via the sharing service's
  late-bound `canManageShares` (owner / `modifyAllRecords`). The probe fails
  closed: a deployment without it (or a throwing probe) keeps the pre-D8
  creator-only behaviour. Mint authority is unchanged and now documented as the
  D8 decision it always enforced — the object's `publicSharing` opt-in AND the
  caller's visibility of the record.

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

- ccd9397: fix(security)!: a sharing rule with no criteria now shares NOTHING instead of every record (#3896)

  `SharingRuleSchema` has always required `condition`, and its doc is explicit
  that a predicate the compiler cannot lower is _"skipped and logged — never
  seeded as a permissive match-all (ADR-0049)"_. The declared/seed path honoured
  that. The two other ways to create a rule did not:

  - **`POST {basePath}/sharing/rules`** plucks its body field-by-field into
    `SharingRuleService.defineRule`, which validated `name` / `label` / `object` /
    `recipientType` / `recipientId` — and not `criteria`. A missing, `null`, or
    **misspelled** key (`criterias`) was stored as `criteria_json: null`, answered
    `201` with no warning, and evaluated as
    `find(object, { filter: {}, context: SYSTEM_CTX })`: every record of the
    object, up to 5000, granted to the recipient. Triggering it took a typo, not
    an attacker.
  - **Authoring a rule in Setup** is a direct `sys_sharing_rule` insert, which
    never reaches `defineRule` at all.

  Empty criteria is now rejected everywhere a rule can be written, and — because
  rules created before this gate are already in the table — the evaluator refuses
  to act on one regardless of how it got there.

  - **`defineRule` rejects a match-all criteria** with
    `VALIDATION_FAILED: criteria is required …`, alongside its other required
    fields. Covers the REST endpoint, programmatic callers, and the seeder.
    Rejected shapes: missing / `null` / `''` / `{}` / `[]` / `{ $and: [] }` /
    unparsable JSON (e.g. a CEL source typed into the Criteria box).
  - **The evaluator matches nothing** for such a rule and logs why, so a row
    stored before this release under-shares instead of over-sharing: the next
    reconcile _revokes_ the grants it had materialised. Both evaluation paths are
    covered — the bulk `evaluateRule` and the per-record write-hook path.
  - **`bindRuleCriteriaGuard`** fails `sys_sharing_rule` inserts with no
    criteria as a field-level `VALIDATION_FAILED` (a 400 naming `criteria_json`),
    so the Setup path reports the problem instead of saving an inert rule
    (ADR-0078). Updates are checked only when the patch supplies
    `criteria_json` — switching an over-broad legacy rule off must not require
    inventing a criteria for it first.
  - **The seed bootstrap's "empty condition = match-all" branch is gone**: a
    missing or empty `condition` is now skipped and logged like any other
    non-lowerable one.
  - `POST {basePath}/sharing/rules` also accepts `criteria_json` as an alias for
    `criteria`, matching the snake_case aliases the endpoint already takes for
    `object_name` / `recipient_type` / `access_level`.

  **Migration.** There is no "share every record" sharing rule, and there never
  usefully was one — the shape existed only as a failure mode. A rule that
  relied on it must state its predicate (`criteria: { stage: 'won' }`), or, if
  the object really should be readable by everyone, use the object's
  organization-wide default (`sharingModel`) instead. Rules already stored with
  a null `criteria_json` need no data migration: they stop granting on the next
  evaluation and their existing grants are revoked.

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

- 7df7c64: feat(sharing): `sys_sharing_rule.criteria_json` is declaratively required (ADR-0113 P2)

  The field the ADR was written for: `required: true` as the write contract —
  insert must provide, update may not null out, legacy null rows rest, an admin
  can still `active: false` an over-broad legacy rule. Deliberately NO
  `storage.notNull`: deployed tenants' legacy nulls are the case the split
  exists for. The Setup form's required marker and client validation now derive
  from the declaration.

  Not breaking: a rule without criteria was already rejected by the #3929 hook
  guard; the guard narrows to the non-null match-all shapes `required` cannot
  express ('{}', vacuous $and/$or, unparsable JSON), `defineRule` keeps the API
  seam, and the evaluator stays fail-closed (ADR-0049).

- b5f9397: fix(sharing,runtime): a `sort` passed straight to the engine never ordered anything; migrate every in-repo engine call to canonical QueryAST keys (#4346)

  Two changes with different weights, from one sweep of every in-repo engine
  call site that still speaks a deprecated alias.

  **The bug — three dropped sorts.** #4346 made the engine fold `filter`→`where`
  and `top`→`limit` on all six methods. The other four pairs in
  `RPC_QUERY_ALIAS_SLOTS` (`select`, `sort`, `skip`, `populate`) are folded at
  the RPC/wire layer only — their values need shape lowering that belongs to
  those layers — and a **direct `engine.find()` never crosses that layer**. Three
  call sites passed `sort` there, so it rode onto the AST untouched, every
  driver's `Array.isArray(query.orderBy)` guard declined to emit an ORDER BY, and
  the query returned an ordinary-looking, arbitrarily-ordered result:

  | call site                           | asked for                                         | actually got                |
  | ----------------------------------- | ------------------------------------------------- | --------------------------- |
  | `share-link-routes.ts`              | shared AI conversation messages, `created_at asc` | messages in arbitrary order |
  | `runtime/domains/share-links.ts`    | same route, runtime-domain copy                   | same                        |
  | `share-link-service.ts` `listLinks` | the 200 most recent share links                   | an arbitrary 200            |

  All three combine the dropped sort with a `limit` — the "latest N" shape whose
  failure #4226 spelled out: an unapplied sort returns rows in arbitrary order,
  which `limit` then slices into an arbitrary page. #4226 fixed that in the wire
  normalizer; these calls sit one layer below it. `listLinks` had no test at all,
  which is why it went unnoticed. Now pinned — on the option bag the engine
  receives, not on row order, because the failure is that the key never becomes
  `orderBy` and a fake engine honouring either spelling would pass either way.

  **The cleanup — 27 no-op renames.** Every remaining in-repo engine call passing
  `filter` now passes `where` (approvals 5, auth 2, reports 6, sharing 11,
  webhooks 2, plus the one `filters` in a spec doc example). These are strict
  no-ops since #4346 folds the alias — the point is that the framework stops
  depending on a spelling it asks users to migrate off, which is a prerequisite
  for ever retiring the aliases. Service-level `filter` PARAMETERS (each
  service's own public API, e.g. `listRequests(filter)`) are deliberately
  untouched — those are not engine option bags.

  Two of the renamed calls were live victims of the #4346 bug rather than
  cosmetic: `auth-manager`'s `stampIdentitySource` read the table's first row via
  `findOne({filter})` and counted the whole table via `count({filter})`, so a
  federated sign-in never stamped `source: 'idp_provisioned'`. #4346 already
  corrected the behaviour; this makes the call say what it means.

- 71af9f5: fix(sharing): the criteria-less-rule warn is once per rule per process, plus one boot aggregate (#3929 follow-up)

  Pre-dedup the fail-closed evaluator warned on EVERY pass — per evaluation and
  per reconciled write — so one legacy criteria-less rule could dominate a
  deployment's log. Enforcement is unchanged (such a rule still matches
  nothing and its grants are revoked on reconcile); the warn now fires once
  per rule per process, and the boot backfill emits a single operator-facing
  aggregate (count + rule names + the fix: repair the criteria or set
  active: false).

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

- 4580597: fix(plugin-sharing)!: the share-link routes emit the declared envelope, and the last ratchet retires (#3983)

  The fifth and final drifting route module. Unlike the four in #3843, this one was
  not found by reading — `scripts/check-route-envelope.mjs` surfaced it the moment
  that scan went repo-wide, which is the whole argument for a repo-wide guard over
  per-package copies. It also turned out to be the one where the drift had actually
  **broken shipped SDK methods**, not merely mis-shaped a body.

  ## Two SDK methods did not work on this surface

  Three of these routes are `disposition: 'sdk'` in `runtime/src/route-ledger.ts`,
  and `ObjectStackClient.unwrapResponse` decides a body is an envelope by finding a
  boolean `success`. With no flag it hands back the body verbatim:

  | method                | documented / typed as          | actually returned                           |
  | --------------------- | ------------------------------ | ------------------------------------------- |
  | `shareLinks.create()` | "the link row (incl. `token`)" | `{ link: … }` — so `.token` was `undefined` |
  | `shareLinks.list()`   | `Promise<any[]>`               | `{ links: [] }` — so `.map()` threw         |

  `packages/client/src/admin-surfaces.test.ts` mocks all three as
  `{ success: true, data: <payload> }`. The SDK was written and tested against the
  **dispatcher's** shape and only ever worked there.

  ## This is a convergence, not a redesign

  `runtime/src/domains/share-links.ts` serves the same five paths, and for cloud's
  per-environment kernels it is the _designed primary_ surface
  (`registerShareLinkRoutes: false`). It has always answered in the declared
  envelope. The plugin now answers identically:

  | route                            | was                              | now                                     |
  | -------------------------------- | -------------------------------- | --------------------------------------- |
  | `POST /share-links`              | `{ link }`                       | `{ success: true, data: link }`         |
  | `GET /share-links`               | `{ links }`                      | `{ success: true, data: link[] }`       |
  | `DELETE /share-links/:idOrToken` | `{ ok: true }`                   | `{ success: true, data: { ok: true } }` |
  | `GET /:token/resolve`            | `{ record, link, redactFields }` | `{ success: true, data: { … } }`        |
  | `GET /:token/messages`           | `{ data: rows }`                 | `{ success: true, data: rows }`         |
  | errors                           | `{ error: { code, message } }`   | `{ success: false, error: { … } }`      |

  `data` carries each payload **directly** — `data: links`, not `data: { links }`.
  That is what makes `unwrapResponse` return the same value on both surfaces, and
  it is what the SDK already expected.

  ## Breaking: raw `fetch` callers add one hop

  SDK callers get the fix for free (two of them go from broken to working). Direct
  body readers add `.data`:

  ```diff
  - const { links } = await (await fetch('/api/v1/share-links')).json();
  + const { data: links } = await (await fetch('/api/v1/share-links')).json();
  ```

  `{ ok: true }` on revoke survives, but as the payload rather than as the body: at
  the top level it was a second word for `success`, which #3689 retired from
  storage; under `data` it is what the dispatcher already returned.

  The `error` half was already nested `{ code, message }` — #3675's changeset cited
  this module as the good example of that — so only the `success` flag is new there.
  All eleven codes were already SCREAMING_SNAKE and registered, so ADR-0112 needs
  nothing.

  ## Consumers

  Swept, and the result is smaller than #3983 assumed. The framework has **zero**
  consumers of these routes. In objectui, `ShareDialog` was already dual-shape
  tolerant on all three routes it calls (`body.links ?? body.data`,
  `created.link ?? created.data`, and revoke never reads the body) — it needs no
  change, and it carried that tolerance precisely _because_ both shapes existed in
  the fleet.

  `SharedRecordPage` did need one fix, and it is the kind a shape-swap would have
  missed: it renamed the wire's `redactFields` to `redactedFields` only on the
  _bare_ branch, so on the already-enveloped dispatcher path the "fields are hidden
  by the owner" notice never rendered. Converting this surface would have spread
  that to every share page. Fixed in objectui#2980, which merges first.

  ## Guard

  **7 conformant / 0 ratcheted / 1 exempt**, from 6 / 1 / 1. The ratchet mechanism
  stays for the next module that needs it.

  `privateOk` also got narrowed to what its own doc always claimed — a literal `ok`
  at the **top** of a body, where it competes with `success`. The same literal
  inside `data` is payload, which is what a conformant revoke returns. Four
  self-test assertions pin both readings.

- d5749d7: refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

  `BaseResponseSchema` declares one envelope for every REST body the platform
  emits. It declared it once; the code that _wrote_ it was copied per route
  module. After #3843 and #3983 converted the last drifting one, seven modules
  each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
  shape lived in fourteen places rather than one.

  `pnpm check:route-envelope` proved those seven copies agreed, which is why this
  is a cleanup rather than a bug fix. But a guard proves agreement; it does not
  create it. An eighth module starts by copying the pair again — not
  hypothetically: `share-link-routes.ts` was found already drifting by the
  repo-wide scan, and its drift had broken `client.shareLinks.create()` and
  `.list()` through `unwrapResponse` (#3983).

  ## What moved

  `sendOk` / `sendError` now live once, in `@objectstack/types`
  (`response-envelope.ts`), and all seven modules import them:

  | Module                                |
  | ------------------------------------- |
  | `service-storage/storage-routes.ts`   |
  | `service-settings/settings-routes.ts` |
  | `service-datasource/admin-routes.ts`  |
  | `rest/external-datasource-routes.ts`  |
  | `rest/package-routes.ts`              |
  | `service-i18n/i18n-service-plugin.ts` |
  | `plugin-sharing/share-link-routes.ts` |

  Placement was the open question in #3973, not design. `packages/spec` is
  schemas-only (Prime Directive #2), and the callers span `rest`, four
  `services/*` and one `plugins/*`, which rules out anything depending on them.
  `@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
  can reach it, and it is already where the repo puts a helper the HTTP boundaries
  share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
  same argument first.

  The builders take a structural `{ status(n), json(body) }`, so the package
  imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
  `any`-typed `res` the older modules carry.

  ## `error.code` is now checked by the compiler

  All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
  vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
  invented code was still caught only at runtime, by a conformance suite parsing a
  driven body, i.e. only on routes some test happened to drive.

  The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
  fails to compile, at every call site at once:

  ```ts
  sendError(res, 400, "NOT_A_REGISTERED_CODE", "invented");
  // Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
  ```

  This cost no call-site churn: every code the seven modules emit was already
  registered.

  ## `extra` is closed at the same place

  `sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
  and `message`.

  It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
  `key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
  `ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
  rejected, and `envelopeViolations` inspects only the body's top level —
  conformant _by stripping_ rather than by declaration. #4224 moved that module
  onto `details`, which is what lets the parameter close here. Closing it at the
  shared builder is the part that lasts: an undeclared sibling is now a compile
  error in every module at once, rather than a key that quietly evaporates in
  whichever module reintroduces it.

  ## Nothing changes on the wire

  The seven pairs were identical modulo the optional `status` and `extra`
  parameters this one unions, and each module's driven conformance suite still
  parses its real bodies against the real spec schemas. One internal call site was
  rewritten: `package-routes` passed `details` positionally and now passes
  `{ details }`, producing the same `error.details` it always did.

  ## The guard got stronger

  `scripts/check-route-envelope.mjs` counts response write sites per module. A
  module that routes everything through the shared pair builds **none** itself, so
  the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
  shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
  the surface rather than per-module. What the count asserts is no longer "your two
  builders are the enveloped ones" but "you have no builders" — and a new route
  that hand-rolls a body still moves it off zero and fails.

- Updated dependencies [6a67d7a]
- Updated dependencies [48fcf70]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [3ec8186]
- Updated dependencies [b1863a5]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
- Updated dependencies [3aef718]
- Updated dependencies [ffb003c]
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
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
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
- Updated dependencies [c39d713]
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
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [55bbefc]
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
- Updated dependencies [bf478e1]
- Updated dependencies [ec796d5]
- Updated dependencies [77fadbf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [5c13368]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [d5749d7]
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
  - @objectstack/objectql@17.0.0-rc.1
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/formula@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

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

- 503be86: feat(security)!: reconcile the SharingRule authoring surface with the enforced runtime — rename `group` → `team`, add `business_unit`, prune `guest` + owner-type rules (#1878)

  The authoring `ShareRecipientType` enum had drifted behind the ADR-0090 D3
  rename and the enforced runtime: the runtime expands `team` (via
  `sys_team`/`sys_team_member`) and `business_unit`, but the authoring enum
  still offered the pre-rename `group` (silently skipped at seed time) and
  omitted the two live recipients. After this change **every authorable
  recipient and rule type is enforced** — nothing on the SharingRule surface
  validates and then silently does nothing (ADR-0078).

  - **`sharedWith.type: 'group'` → `'team'`** (wire-rename): the enum member is
    renamed to match the runtime vocabulary and now maps through the seed
    bootstrap to the live `TeamGraphService` expansion. Flat `sys_team`
    membership; enforced.
  - **`business_unit` added** to the authoring enum — exactly one business
    unit's members (no subtree; use `unit_and_subordinates` for the subtree).
    The runtime + bootstrap already enforced it; only the enum omitted it.
  - **`guest` removed** — it had no runtime recipient mapping. Anonymous access
    is served by the public-form grant and share links, not sharing rules.
  - **Owner-type rules removed** (`type: 'owner'`, `ownedBy`,
    `OwnerSharingRuleSchema` + its type export): they depend on live
    team/position membership, which the static materialiser cannot track, so
    they validated but never materialised a share. They return as an enforced
    form if membership-reactive re-materialisation is designed.
    `SharingRuleSchema` is now the criteria form; the `queue` recipient stays
    runtime-reserved (no `sys_queue` yet) and deliberately non-authorable.

  **Migration** (stale definitions now fail parse with the valid options listed):

  - `sharedWith: { type: 'group', … }` → `sharedWith: { type: 'team', … }`.
  - `sharedWith: { type: 'guest', … }` → delete the rule; expose the records
    via a public form or share link instead.
  - `type: 'owner'` rules → rewrite as a `type: 'criteria'` rule scoping the
    rows by field values (see the migrated examples:
    `share_open_tasks_with_manager` in app-showcase,
    `share_active_leads_with_manager` in app-crm), or use a scope-depth grant.

### Patch Changes

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

- 647ec8b: fix(driver-sql,sharing): an unsortable query loses its ORDER BY, not its rows (#3821)

  `SqlDriver.find()` already recovered from a SELECT projection naming a column
  the table lacks (retry with `select('*')`, the unknown field is simply absent
  from each row). The identical failure one clause over — an **ORDER BY** column
  the table lacks — fell through to `return []`. Because `count()` is a separate
  statement, the list endpoint answered `HTTP 200` with `records: []` and
  `total: 3`: the rows are there, none are shown, nothing is logged. Same family
  as the `$`-param footgun closed by #2926.

  It surfaced through the Console's sharing-rule **recipient picker**, which
  never listed a single candidate. The client mangled `'name asc'` into
  `0 n,1 a,2 m,…` (fixed separately in objectui) and the driver turned that into
  "no users exist", so no sharing rule could be authored from the UI at all.

  Rows now outrank their order: the retry ladder drops the projection first (the
  likelier culprit and the cheaper thing to lose), then the sort, then gives up.
  A query that cannot be sorted comes back **unordered instead of empty**. Errors
  that are not about an unknown column still propagate untouched.

  **A rule authored in Setup now actually applies — and switching it off actually
  withdraws access.** Writing a `sys_sharing_rule` rebound the per-record hooks,
  which only makes the rule reach records written FROM THEN ON. So an admin who
  created a rule and enabled it saw nothing happen: the recipient's list stayed
  empty until somebody happened to touch each record. The reverse was worse —
  switching a rule OFF, or deleting it, left every grant it had already issued in
  place, and boot backfill only reconciles ACTIVE rules, so those grants outlived
  restarts while the UI displayed the rule as disabled. The reconcile was reachable
  only through `POST /sharing/rules/:id/evaluate`, which the Console never calls.

  Each non-system write to `sys_sharing_rule` now also reconciles that rule's
  grants, chained behind the existing rebind: insert/update run the same
  diff-based `evaluateRule` the REST endpoint runs (it purges when the rule is
  inactive), and delete purges directly via the new
  `SharingRuleService.revokeRuleGrants` — `evaluateRule` can't help there because
  the row is already gone (`RULE_NOT_FOUND`), which is also why a rule deleted
  through the plain data API used to orphan its grants. Seeding and package
  bootstrap write with `isSystem` and are skipped; `kernel:bootstrapped` already
  backfills those. Reconciliation is best-effort and never fails the write.

  **The dialog's help text was engineering notes, shown to tenant admins.** The
  field descriptions on `sys_sharing_rule` render under each input in Setup, and
  they cited ADR numbers, table and column names (`parent_business_unit_id`,
  `sys_business_unit`), enum machine values the dropdown never shows
  (`business_unit`, `team`), a third-party library (better-auth), and engine
  vocabulary ("evaluation", "lifecycle"). Several were also stale: they still told
  admins to type an id or hand-write a `FilterCondition` after those inputs became
  a record picker and a visual builder. Rewritten for the reader who actually sees
  them — the implementation detail was already in the object's doc comment, which
  is where it stays. `criteria_json`'s LABEL loses its "(FilterCondition JSON)"
  suffix for the same reason, and `active` can finally say what it now does:
  turning it off withdraws the access.

  Also refreshes the `sys_sharing_rule` help text in the zh-CN / ja-JP / es-ES
  translation bundles, which still described `recipient_type` in terms of
  `department` (the enum value is `business_unit`) and told admins to enter a
  queue name for `recipient_id` (`queue` was removed in ADR-0078). The es-ES
  option labels for `position` / `unit_and_subordinates` were translated as
  "rol" — corrected to "Puesto" / "Unidad de negocio y subordinados".

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [6169615]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [a749273]
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
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
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
- Updated dependencies [5d4de37]
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
- Updated dependencies [e1fa8d5]
- Updated dependencies [402f534]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
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
- Updated dependencies [8e08bc3]
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
- Updated dependencies [5f0852f]
- Updated dependencies [cde1975]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [9aa5510]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [54f479a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/objectql@17.0.0-rc.0
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
  - @objectstack/objectql@16.1.0

## 16.0.0

### Patch Changes

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
- Updated dependencies [fdc244e]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [7125007]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [674457a]
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
  - @objectstack/objectql@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/formula@16.0.0

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
- Updated dependencies [7125007]
- Updated dependencies [62a2117]
- Updated dependencies [674457a]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/formula@16.0.0-rc.1
  - @objectstack/objectql@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

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
- Updated dependencies [fdc244e]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
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
  - @objectstack/objectql@16.0.0-rc.0
  - @objectstack/platform-objects@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/formula@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/objectql@15.1.1
- @objectstack/formula@15.1.1
- @objectstack/platform-objects@15.1.1

## 15.1.0

### Minor Changes

- f531a26: feat(plugin-sharing): sys_sharing_rule provenance + seed-not-clobber (#2909 P0/T1). The object gains readonly `managed_by` (unified A4 tri-state platform/package/admin) and `customized` columns; declared rules seed with `managed_by: 'package'`. defineRule in seed mode adopts pristine/legacy rows (package upgrades stay deliverable) but never overwrites admin-authored or customized rows — an admin's `active: false` on an over-sharing rule now survives redeploys instead of being resurrected at boot. A beforeUpdate hook stamps `customized` on any non-system edit of a seeded rule. Deliberately NO write gate: sharing rules remain a first-class admin authoring surface (ADR-0094 addendum tradeoff).

### Patch Changes

- f531a26: feat(kernel): add `kernel:bootstrapped` lifecycle anchor — the phase that fires after every `kernel:ready` handler has settled but before `kernel:listening` (HTTP socket open). `kernel:ready` handlers run sequentially in plugin-registration order, so a handler that consumes data produced by a later-starting plugin (e.g. the security bootstrap seeds `sys_position`; the app plugin's seed loader inserts records) would race the very rows it needs. `kernel:bootstrapped` is the correct anchor for reconcile/backfill work: every producer's ready handler has finished by the time it fires. Both `ObjectKernel` and `LiteKernel` trigger it. The sharing-rule boot backfill moves from `kernel:listening` to `kernel:bootstrapped` (semantics-only; behaviour unchanged).
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

- f531a26: fix(security): close three execution-surface authz holes surfaced by the #2849 class sweep (#2980, #2981, #2982)

  Three independent, confirmed-exploitable defects where an execution surface
  ignored the caller's identity or fell open on a missing one. Each is fixed at
  its own enforcement point; none change behaviour for correctly-scoped callers.

  - **#2980 — reports IDOR + scheduled-report RLS bypass.** `ReportService`
    discarded the caller's context and read/wrote `sys_saved_report` with a system
    context, so any authenticated user could read, delete, or overwrite any saved
    report by id (cross-owner / cross-tenant), and `listReports` enumerated all
    owners. `getReport`/`deleteReport`/`saveReport`/`listReports` are now
    owner-scoped (system read of the protection-locked metadata object, but
    authorization enforced by owner match); create/overwrite can no longer spoof
    ownership. Scheduled dispatch no longer runs `isSystem` (which emailed the
    target object's entire table past the owner's RLS): it resolves the owner to a
    real RLS-bearing context via a new `resolveOwnerContext` seam and **fails
    closed** (skips + marks the schedule failed) when the owner can't be resolved,
    rather than running elevated. Wiring that resolver is the reports-surface
    consumer of ADR-0073's user-less identity resolution.

  - **#2981 — knowledge/RAG retrieval fall-open.** `applyPermissionFilter` returned
    every hit when the context was missing _or_ system. A missing identity is no
    longer treated as a grant: object-backed hits fail closed (dropped, keeping
    ACL-less file/http hits), and only an **explicit** system context passes
    through. Closes the agent path where an omitted `ToolExecutionContext.actor`
    yielded unfiltered semantic search over the whole corpus.

  - **#2982 — bulk-write OWD gap.** `update({multi:true})` / `deleteMany` had no
    single id to `canEdit`-gate, so owner scoping was skipped on private (and
    public_read) objects. A new `SharingService.buildWriteFilter` (the edit-set
    analogue of `buildReadFilter`) is AND-ed into the write AST for multi writes,
    constraining them to rows the caller may edit — including the on-behalf-of
    delegator intersection.

  Tracked as the motivating evidence of ADR-0096 (execution-surface identity
  admission); the mechanism that would prevent the class structurally is separate.

- f531a26: fix(plugin-sharing): reconcile every active sharing rule once at boot (#2926 ③). Rule grants are materialized by write hooks, which deliberately skip `isSystem` writes — so seed-loader records never produced `sys_record_share` rows and demo data shipping with matching sharing rules was broken out of the box until each record was touched at runtime. The boot backfill runs on `kernel:listening` — the phase the kernel fires only after every `kernel:ready` handler has settled, including the AppPlugin seed loader — so the reconcile sees the seeded rows rather than racing them. It is idempotent (diff-based reconcile) and best-effort per rule so one broken rule cannot block startup.
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
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [d75c7ac]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/objectql@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/formula@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/objectql@15.0.0
  - @objectstack/formula@15.0.0

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
