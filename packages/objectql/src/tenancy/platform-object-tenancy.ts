// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13491] Per-object tenancy classification for the platform namespaces.
 *
 * ## The ruling this implements
 *
 * Maintainer, 2026-08-31 (总监席第 5 场, 联案 #13491 + #13497, verbatim 「同意」):
 * the tenant-audit control's scope is cut by **the object's tenancy
 * classification**, never by the caller's flag.
 *
 *   - `isSystem` x a TENANT-SCOPED object = IN scope. A system write that lands
 *     an org-less row on a tenant-scoped object is the defect class the control
 *     exists for; it has occurred five times (#12745, #12928, #10673, #8617,
 *     cloud#1239 — one a credentials table) and every instance was found by a
 *     person reading call sites, never by the control.
 *   - `isSystem` x a GENUINELY GLOBAL object = OUT of scope. #8672's reasoning
 *     ("an org-less row is defensible for `sys_permission_set`") inherits **per
 *     object**; the wholesale `sys_ / cloud_ / ai_` namespace exemption is
 *     withdrawn.
 *
 * ## Why a ledger and not a schema read
 *
 * The obvious implementation — read the object's schema and treat "has an
 * `organization_id` column" as "tenant-scoped" — does not work, and the
 * measurement is the reason this file exists. `applySystemFields`
 * (`registry.ts`) provisions the tenant COLUMN unconditionally: its existence
 * was deliberately decoupled from whether tenancy is on, so that sudo writers
 * can always stamp it. Measured on this tree by AST census of every
 * `ObjectSchema.create` in `packages/`:
 *
 *   - 84 platform-namespace objects are registered in this repository;
 *   - 25 resolve NO tenant field (24 `managedBy: 'better-auth'`, plus
 *     `sys_sso_provider`'s `tenancy.enabled: false`) and are already outside
 *     the machinery — they exit at `resolveTenantFieldName` returning null;
 *   - **59 carry a tenant column**, `sys_permission_set` — #8672's own example
 *     of a legitimately org-less object — among them.
 *
 * So a schema read admits 59 of 84 in one stroke, i.e. it replaces a wholesale
 * exemption with a wholesale inclusion. The ruling's classification source is
 * "有列**且有写手填**" — the column AND a writer that fills it — and the second
 * half is not a runtime fact. It is a fact about the CODE, established once by
 * inventory and written down here.
 *
 * ## The four classifications, and why `unclassified` is not a failure
 *
 * The ruling's execution point 2 makes the escape hatch mandatory:
 * 「判不了的逐个列出回批呈裁，⛔ 不猜」 — an object whose tenancy cannot be
 * determined is LISTED for adjudication, never guessed either way.
 *
 * `unclassified` therefore keeps TODAY'S behaviour exactly (the object stays
 * outside the machinery, as the blanket guard had it) and appears on the list
 * that goes back to the maintainer. This is what keeps the blast radius of the
 * reclassification knowable even though the unclassified list is long: the only
 * objects whose behaviour changes are the ones classified `tenant-scoped`, and
 * that set is enumerated below with a citation each.
 *
 * ⛔ Do not promote an entry to `tenant-scoped` to shorten the list. The
 * admission bar is a CITABLE writer fact — a maintainer-ordered organization
 * repair, or a writer that stamps the column — and an entry without one is the
 * guess the ruling forbids.
 *
 * ## `conditional`, the fourth verdict (#13636)
 *
 * The 2026-08-31 ruling above cut the question two ways, and while implementing
 * it a THIRD state was measured that neither verdict fits: an object holding
 * both org-stamped rows and a ruled org-less population, where which one is
 * correct is a property of the ROW. `tenant-scoped` would refuse that object's
 * own adjudicated writes on a walled install; `global` would abandon its
 * org-stamped majority. Both specimens were therefore parked in
 * `unclassified` — and `sys_metadata` and `sys_audit_log` are two of the
 * largest write populations in the platform namespace, so parking them is where
 * the control's coverage went to die.
 *
 * The maintainer ruled the fourth verdict in on 2026-08-31 (总监席第 7 场决裁
 * 批 #17, direction B): the platform gets an explicit per-write declaration, and
 * the resolver uses it to tell 「有意的环境级/无租户行」 from 「漏 stamp 的
 * bug」 — 「同一个 NULL 不再身兼两义」. See `orgless-write-declaration.ts` for
 * the channel and for why it is not the per-write bypass flag
 * `system-write-organization.ts` forbids.
 *
 * ⛔ The admission bar here is STRICTER than `tenant-scoped`'s, not looser: an
 * entry must cite a writer that demonstrably produces BOTH populations. The
 * ruling fixes the first batch at exactly the two specimens it named and
 * requires each later member to arrive with its own writer evidence — ⛔ never
 * picked out of the unclassified list by guess.
 *
 * ## What admission actually changes, per object
 *
 * A `tenant-scoped` classification lets the object reach
 * `resolveSystemInsertOrganization` (#8844): on a `single` posture with exactly
 * one organization the write DERIVES it, and on a walled posture
 * (`group` / `isolated`) an org-less write is REFUSED loudly
 * ({@link SystemWriteOrganizationRequiredError}). A `conditional` one reaches
 * the same decision by the same route, with one addition: a write carrying an
 * `orgLessWrite` declaration this ledger admits for that object resolves
 * nothing and is written org-less, which is the adjudicated population. It also
 * stops the engine
 * auto-muting the driver's tenant-audit warning for elevated writes on it.
 * Both directions are the ruled one — a refusal or a warning, never a silent
 * rewrite of what the write touches (execution point 3).
 */

import { isPlatformNamespaceObject } from './system-write-organization';
import type { OrgLessWriteDeclaration, OrgLessWriteReason } from './orgless-write-declaration';
import { OrgLessWriteDeclarationRefusedError } from './orgless-write-declaration';

/**
 * What the one-time inventory concluded about one platform-namespace object.
 *
 * `no-tenant-column` is deliberately NOT a member: an object with no tenant
 * field never reaches a classification question — `resolveTenantFieldName`
 * answers it first, in both the engine and the driver — so recording it here
 * would be a second reading of a fact one function already owns.
 */
export type PlatformObjectTenancy =
  /** Column present AND a citable writer fills it. In scope. */
  | 'tenant-scoped'
  /** #8672's reasoning inherits: rows are deliberately org-less. Out of scope. */
  | 'global'
  /**
   * [#13636] BOTH populations, decided per ROW rather than per object: the
   * object holds org-stamped rows AND a ruled org-less population, and only the
   * writer knows which one a given write is. In scope EXACTLY LIKE
   * `tenant-scoped` — every org-less write is derived or refused — except that
   * a write carrying an admitted `orgLessWrite` declaration
   * ({@link OrgLessWriteReason}) is the ruled population and resolves nothing.
   *
   * ⛔ This is the strictest verdict in the ledger, not a softer one. Promoting
   * an object here ADMITS it into #8844's machinery; `unclassified` is what
   * leaves behaviour where it is.
   */
  | 'conditional'
  /** Not determinable from the tree. Out of scope, PENDING ADJUDICATION. */
  | 'unclassified';

/** One inventory entry: the verdict plus the evidence it was reached on. */
export interface PlatformObjectTenancyEntry {
  readonly tenancy: PlatformObjectTenancy;
  /** Why. A `tenant-scoped`, `global` or `conditional` entry must cite a source. */
  readonly evidence: string;
  /**
   * [#13636] Which org-less populations THIS object admits. Required on a
   * `conditional` entry and meaningless on every other verdict — a reason is
   * never admissible everywhere, so the declaration channel checks the pair
   * (object, reason) rather than the reason alone.
   */
  readonly orgLessReasons?: readonly OrgLessWriteReason[];
}

/**
 * The one-time inventory (#13491 execution point 2).
 *
 * Only objects with a VERDICT are listed. Everything else in the platform
 * namespaces — including the five `cloud_`-runtime objects defined in the
 * separate `cloud` repository, which this tree cannot read — is `unclassified`
 * by absence, which is why {@link classifyPlatformObjectTenancy} answers
 * `unclassified` for an unlisted name rather than throwing.
 */
export const PLATFORM_OBJECT_TENANCY: Readonly<Record<string, PlatformObjectTenancyEntry>> = {
  // ── tenant-scoped ────────────────────────────────────────────────────────
  // Each of these has a maintainer-ordered organization repair, a ruled writer
  // that stamps the column, or both. The citation is the admission bar.
  //
  // ⚠️ `evidence` is a RUNTIME string — it reaches operators and generated
  // surfaces, where a tracker id resolves to nothing (maintainer ruling
  // 2026-08-12). So the prose names the FILE that carries the fact, and the
  // tracker anchors stay in these `//` comments, for the reader who can
  // resolve them and is already looking at the source.

  // #12745 (writer) + the 2026-08-28 backfill ruling 「12745 A回，其他同意。」
  sys_file: {
    tenancy: 'tenant-scoped',
    evidence:
      'The writer was repaired to thread the acting session organization ' +
      '(`StorageMetadataStore.createFile`, `metadata-store.ts`), and the maintainer ordered a backfill on ' +
      '2026-08-28 for the rows it had stranded (`backfill-sys-file-organizations.ts`). An org-less row ' +
      'here is a defect, not a design.',
  },
  // #12928 (insert, FORWARD-STAMP-ONLY) + #13178 (update)
  sys_upload_session: {
    tenancy: 'tenant-scoped',
    evidence:
      '`StorageMetadataStore` stamps `organization_id` from `context.tenantId` on both the insert and the ' +
      'update half (`metadata-store.ts`). The rows that predate the insert repair are historic and were ' +
      'ruled FORWARD-STAMP-ONLY — they say nothing about a NEW write.',
  },
  // #10101 (PR #11311, writer) + maintainer 2026-08-23 direction 3 (backfill); cloud#1395
  sys_approval_request: {
    tenancy: 'tenant-scoped',
    evidence:
      "The writer was repaired to stamp from the SUBJECT record's organization, and the maintainer ordered " +
      'the backfill `backfill-platform-row-organizations.ts` on 2026-08-23 for the rows produced before ' +
      'it — measured on the cloud tracker as pending approvals invisible in every organization-scoped ' +
      "inbox, their own owner's included.",
  },
  // #10101 child row; same 2026-08-23 backfill order
  sys_approval_action: {
    tenancy: 'tenant-scoped',
    evidence:
      'Child row of `sys_approval_request`; moves with its parent in the same 2026-08-23 backfill order, ' +
      'and `approval-service.ts` stamps `organization_id` on it at write time.',
  },
  // #10101 child row; same 2026-08-23 backfill order
  sys_approval_approver: {
    tenancy: 'tenant-scoped',
    evidence:
      'Child row of `sys_approval_request`; same 2026-08-23 backfill order, and `approval-service.ts` ' +
      'stamps `organization_id` on it at write time.',
  },
  // #10101 (writer) + the same 2026-08-23 backfill order
  sys_automation_run: {
    tenancy: 'tenant-scoped',
    evidence:
      '`ObjectStoreSuspendedRunStore` resolves the run organization through ' +
      '`recordOrgResolver.organizationOf(...)` and stamps it (`suspended-run-store.ts`); unattributed run ' +
      'history was the measured symptom, and the same 2026-08-23 order covers its backfill.',
  },
  // #11698
  sys_notification_delivery: {
    tenancy: 'tenant-scoped',
    evidence:
      '`SqlOutbox.enqueue` writes `organization_id` from the organization the messaging service derives ' +
      'for the notification (`sql-outbox.ts`, `messaging-service.ts#notificationOrganization`).',
  },
  // #14484 (writer + backfill), ruled 2026-09-02 — decision batch #11 item 3,
  // maintainer verbatim 「#13564 转维护者处理；其他同意」 ("其他同意" adopts A:
  // tenant-scoped, writer-repaired, existing rows backfilled from the record
  // they grant access to). The per-table order the `sys_file` precedent
  // requires; it covers `sys_record_share` and no other table.
  sys_record_share: {
    tenancy: 'tenant-scoped',
    evidence:
      'The writer was repaired to stamp `organization_id` on every insert and update ' +
      '(`SharingService.grant`, `plugin-sharing/src/sharing-service.ts`): a rule-materialised grant ' +
      "carries the granting rule's organization, a direct grant the shared record's. The maintainer ordered " +
      'the rows written before it backfilled from the record they reference on 2026-09-02 ' +
      '(`backfill-sys-record-share-organizations.ts`). A grant table that cannot say which organization ' +
      'a grant belongs to is a defect, not a design: under a wall, a tenant-scoped read would AND ' +
      "plugin-security's strict `organization_id = :tenant` over the driver's NULL-tolerant arm and every " +
      'organization-less grant would silently disappear.',
  },

  // ── conditional ──────────────────────────────────────────────────────────
  // [#13636] BOTH populations, split per ROW. Admitted by the maintainer's
  // 2026-08-31 ruling (总监席第 7 场决裁批 #17, verbatim 「同意」), whose
  // constraint 3 fixes the first batch at EXACTLY these two and requires every
  // later member to arrive with its own writer evidence:
  // 「首批只收编两只已裁标本 ... ⛔ 不从 #13491 的 51 只 cannot-determine 里凭猜挑成员」.
  //
  // ⛔ Do not add an entry here from the unclassified list without a writer that
  // demonstrably produces BOTH populations. The admission bar is stricter than
  // `tenant-scoped`'s, not looser: a `conditional` entry claims a ruled org-less
  // population exists, and the declaration channel then trusts that claim.

  // #6190 option A (env-wide write for a non-overridable type)
  sys_metadata: {
    tenancy: 'conditional',
    orgLessReasons: ['env-level-metadata'],
    evidence:
      'Holds both populations by adjudication. `SysMetadataRepository` stamps `organization_id` from the ' +
      'repository organization on every org-scoped write (`sys-metadata-repository.ts`), and writes the ' +
      'SAME column NULL when the repository is env-level — the write the 2026-06 ruling on non-overridable ' +
      'types settled as landing env-wide, belonging to the installation rather than to any organization. ' +
      "The env-level write declares itself ('env-level-metadata'); an undeclared org-less write on this " +
      'object is a missing stamp and is refused.',
  },
  // #13636 specimen 2; the enumeration is the writer's own, and this entry
  // states CASE 1 of it only — `audit-writers.ts` declares exactly when
  // `organizationFieldFor(subject) === null` and deliberately leaves case 2
  // (column present, value NULL) to the refusal. ⛔ Do not widen this prose to
  // the writer's whole enumeration: `evidence` is a runtime string, so it would
  // tell an operator the platform blesses a population no writer declares.
  sys_audit_log: {
    tenancy: 'conditional',
    orgLessReasons: ['audit-of-untenanted-record'],
    evidence:
      'Holds both populations, and its writer enumerates the org-less one in its own source: an audit row ' +
      'inherits the organization of the RECORD it describes, falling back to the acting session ' +
      "(`audit-writers.ts`), and neither answers for a record whose object resolves no organization column " +
      'at all — single-tenant stacks, ADR-0066 platform-global objects, the better-auth identity tables, ' +
      "and the installation-level subjects that behave the same way. Exactly those rows declare themselves " +
      "('audit-of-untenanted-record'). A record whose column is PRESENT and NULL is deliberately NOT " +
      'declared by any writer: at the call site it cannot be told apart from a missing stamp, so it keeps ' +
      'meeting the refusal, as does every other undeclared org-less audit row — the invisible-audit-row ' +
      'defect that writer already guards against.',
  },

  // ── global ───────────────────────────────────────────────────────────────
  // #8672, named verbatim by the 2026-08-31 ruling; the driver predicate is #2734.
  // ⚠️ `ensure-default-organization.ts` DOES stamp org-scoped permission sets, so
  // this object holds BOTH populations. It is `global` on the maintainer naming
  // it, not on an absence of org-scoped writes — flagged for the adjudicating
  // batch rather than smoothed over.
  sys_permission_set: {
    tenancy: 'global',
    evidence:
      "The case the 2026-08-31 ruling names verbatim as the one whose reasoning inherits: 'an org-less " +
      "row is defensible for `sys_permission_set`'. The SQL driver's own tenant predicate is written for " +
      'this population — a NULL organization marks a GLOBAL/platform row, and with strict equality every ' +
      'tenant admin saw ZERO RBAC rows on a fresh deployment. It also holds org-scoped rows, so the ' +
      'verdict rests on the maintainer naming it, not on an absence of org-scoped writes.',
  },
};

/**
 * The inventory's verdict for `object`.
 *
 * Answers `unclassified` for any platform-namespace name the inventory does not
 * list — the deliberate direction, since an unlisted object is precisely one
 * nobody has adjudicated, and `unclassified` is the status-quo (excluded)
 * behaviour.
 *
 * ⛔ Never call this on a non-platform object: the classification question is
 * about the platform namespaces only, and an application object's tenancy is
 * answered from its schema. {@link isPlatformObjectOutOfTenantAuditScope} is
 * the predicate that pairs the two.
 */
export function classifyPlatformObjectTenancy(object: string): PlatformObjectTenancy {
  return PLATFORM_OBJECT_TENANCY[object]?.tenancy ?? 'unclassified';
}

/**
 * Is `object` a platform-namespace object the tenant-audit control does NOT
 * cover?
 *
 * This is the narrowed successor to the blanket
 * `isPlatformNamespaceObject(object)` short-circuit. It answers `true` for a
 * platform object classified `global` or `unclassified` — the population the
 * old guard covered wholesale — and `false` for a tenant-scoped one, which now
 * flows into the machinery that was always there.
 *
 * [#13636] `conditional` answers `false` too, on the same footing as
 * `tenant-scoped`: admitting an object is what puts its org-less writes in
 * front of #8844's derive-or-refuse decision, and the per-write declaration
 * then separates the ruled population from the missing stamps. An object whose
 * org-less rows were ADJUDICATED legitimate is therefore MORE covered by the
 * control than an unclassified one, never less.
 *
 * A non-platform object answers `false`: it was never in this exemption, and
 * its tenancy is read from its schema one line further down.
 */
export function isPlatformObjectOutOfTenantAuditScope(object: string): boolean {
  if (!isPlatformNamespaceObject(object)) return false;
  const tenancy = classifyPlatformObjectTenancy(object);
  return tenancy !== 'tenant-scoped' && tenancy !== 'conditional';
}

/** Every object the inventory admitted as tenant-scoped, for tests and reports. */
export function tenantScopedPlatformObjects(): readonly string[] {
  return Object.entries(PLATFORM_OBJECT_TENANCY)
    .filter(([, e]) => e.tenancy === 'tenant-scoped')
    .map(([name]) => name)
    .sort();
}

/**
 * [#13636] Every object admitted as `conditional`, for the gate, the tests and
 * the census. The gate reads this list to hold every `orgLessWrite` declaration
 * in the monorepo to the ledger, which is the "checkable" half of the ruling's
 * three words.
 */
export function conditionalPlatformObjects(): readonly string[] {
  return Object.entries(PLATFORM_OBJECT_TENANCY)
    .filter(([, e]) => e.tenancy === 'conditional')
    .map(([name]) => name)
    .sort();
}

/**
 * [#13636] The org-less populations `object` admits, or an EMPTY list for every
 * object that admits none.
 *
 * Empty is the answer for an unlisted object, for a `tenant-scoped` one and for
 * a `global` one alike, and all three mean the same thing to the caller: this
 * object has no adjudicated org-less population, so no declaration naming it can
 * be honoured.
 */
export function admittedOrgLessReasons(object: string): readonly OrgLessWriteReason[] {
  const entry = PLATFORM_OBJECT_TENANCY[object];
  if (entry?.tenancy !== 'conditional') return [];
  return entry.orgLessReasons ?? [];
}

/**
 * [#13636] Validate one write's `orgLessWrite` option against the ledger, or
 * THROW.
 *
 * Returns the admitted declaration, or `undefined` when the write carries none
 * — the ordinary path, which pays one `undefined` comparison.
 *
 * ⚠️ Every failure here is a THROW rather than a "treat it as absent". That is
 * the ruling's 「静默可选标记不合格」 made mechanical: if a malformed or
 * unadmitted declaration were ignored, the option would have a silent spelling,
 * and a silent spelling is the renamed bypass the ruling disqualified. It also
 * means the check cannot be moved below the resolver's early returns — an
 * ignored declaration on an object that returns early is exactly the silence
 * this refuses.
 *
 * @param object the object the write actually targets — compared against the
 *   declaration's own `object`, which is what stops a declaration on a shared
 *   context or a spread options bag reaching a different object's row.
 */
export function assertOrgLessWriteDeclarationAdmitted(
  object: string,
  declared: unknown,
): OrgLessWriteDeclaration | undefined {
  if (declared === undefined) return undefined;
  if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) {
    throw new OrgLessWriteDeclarationRefusedError(
      object,
      `it is not a declaration object (received ${Array.isArray(declared) ? 'an array' : typeof declared})`,
    );
  }
  const { object: declaredObject, reason } = declared as { object?: unknown; reason?: unknown };
  if (typeof declaredObject !== 'string' || declaredObject === '') {
    throw new OrgLessWriteDeclarationRefusedError(object, "it names no 'object'");
  }
  if (declaredObject !== object) {
    throw new OrgLessWriteDeclarationRefusedError(
      object,
      `it declares '${declaredObject}', which is not the object being written`,
    );
  }
  const admitted = admittedOrgLessReasons(object);
  if (admitted.length === 0) {
    throw new OrgLessWriteDeclarationRefusedError(
      object,
      `the ledger does not classify '${object}' as 'conditional', so it has no adjudicated org-less ` +
        'population to declare',
    );
  }
  if (typeof reason !== 'string' || !admitted.includes(reason as OrgLessWriteReason)) {
    throw new OrgLessWriteDeclarationRefusedError(
      object,
      `'${String(reason)}' is not a reason '${object}' admits (it admits: ${admitted.join(', ')})`,
    );
  }
  return { object, reason: reason as OrgLessWriteReason };
}
