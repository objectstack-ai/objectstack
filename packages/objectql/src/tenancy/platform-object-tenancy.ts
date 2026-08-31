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
 * ## The three classifications, and why `unclassified` is not a failure
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
 * ## What admission actually changes, per object
 *
 * A `tenant-scoped` classification lets the object reach
 * `resolveSystemInsertOrganization` (#8844): on a `single` posture with exactly
 * one organization the write DERIVES it, and on a walled posture
 * (`group` / `isolated`) an org-less write is REFUSED loudly
 * ({@link SystemWriteOrganizationRequiredError}). It also stops the engine
 * auto-muting the driver's tenant-audit warning for elevated writes on it.
 * Both directions are the ruled one — a refusal or a warning, never a silent
 * rewrite of what the write touches (execution point 3).
 */

import { isPlatformNamespaceObject } from './system-write-organization';

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
  /** Not determinable from the tree. Out of scope, PENDING ADJUDICATION. */
  | 'unclassified';

/** One inventory entry: the verdict plus the evidence it was reached on. */
export interface PlatformObjectTenancyEntry {
  readonly tenancy: PlatformObjectTenancy;
  /** Why. A `tenant-scoped` or `global` entry must cite a source. */
  readonly evidence: string;
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
 * A non-platform object answers `false`: it was never in this exemption, and
 * its tenancy is read from its schema one line further down.
 */
export function isPlatformObjectOutOfTenantAuditScope(object: string): boolean {
  if (!isPlatformNamespaceObject(object)) return false;
  return classifyPlatformObjectTenancy(object) !== 'tenant-scoped';
}

/** Every object the inventory admitted as tenant-scoped, for tests and reports. */
export function tenantScopedPlatformObjects(): readonly string[] {
  return Object.entries(PLATFORM_OBJECT_TENANCY)
    .filter(([, e]) => e.tenancy === 'tenant-scoped')
    .map(([name]) => name)
    .sort();
}
