// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  AuthoredRowWriteOperation,
  AuthoredRowWriteVerdict,
  ISharingService,
  IHierarchyScopeResolver,
  RecordShare,
  GrantShareInput,
  SharingExecutionContext,
  ShareAccessLevel,
  SharingWriteVerdict,
} from '@objectstack/spec/contracts';
import {
  normalizeTenancyPosture,
  postureEnforcesWall,
  type TenancyPosture,
} from '@objectstack/spec/security';
import { WRITE_ACCESS_LEVELS, normalizeAccessLevel } from './access-level.js';
import {
  deleteRowsForDeletedRecords,
  sweepOrphanedRowsByRecordExistence,
  type OrphanShareSweepOptions,
  type OrphanShareSweepResult,
} from './record-orphan-cleanup.js';

/**
 * [#5103] Re-exported from their new home so this module's public surface is
 * unchanged: #5190 moved the record-existence cleanup MECHANISM into
 * `record-orphan-cleanup.ts` (`sys_share_link` needs the identical walk), and a
 * type that moved house is not an API change callers should have to notice.
 */
export type { OrphanShareSweepOptions, OrphanShareSweepResult };

/**
 * Shape of the data engine the service actually needs. Kept narrow so
 * unit tests can pass an in-memory fake without depending on the full
 * ObjectQL engine class.
 */
export interface SharingEngine {
  find(object: string, options?: any): Promise<any[]>;
  findOne?(object: string, options?: any): Promise<any>;
  insert(object: string, data: any, options?: any): Promise<any>;
  update(object: string, idOrData: any, dataOrOptions?: any, options?: any): Promise<any>;
  delete(object: string, options?: any): Promise<any>;
  getSchema?(object: string): any | undefined;
}

/**
 * Random share id. Keeps the plugin self-contained (no `crypto.randomUUID`
 * dependency in environments that don't expose it on `globalThis`).
 */
function makeShareId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `shr_${g.crypto.randomUUID()}`;
  return `shr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** System-elevated context for the plugin's own queries / mutations. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * Owner field convention. Hard-coded to `owner_id` for MVP — the
 * sharing model in Salesforce / ServiceNow / Dynamics all assume a
 * single owner field, and customising it is a follow-up. Objects
 * without `owner_id` are treated as "unowned" and read filters are
 * suppressed (they fall back to OWD-public behaviour).
 */
const OWNER_FIELD = 'owner_id';

/**
 * Effective sharing model — collapses the authorable OWD vocabulary onto the
 * three behaviours this service enforces:
 *   - `private`              → owner-only read + write
 *   - `public_read`          → everyone reads, owner writes
 *   - `public_read_write`    → public (no record-level filter)
 *   - `controlled_by_parent` → public here (scoped separately by the
 *                              security plugin's master-detail path, ADR-0055)
 *
 * [ADR-0090 D1] Secure default: a CUSTOM object (not `sys_*`, not
 * `isSystem`) that declares NO `sharingModel` resolves to **`private`** —
 * the former fall-through-to-public default silently granted org-wide
 * read/write to any C/R/U grant holder (the objectui#2348 incident).
 * System/platform objects keep their explicit ADR-0066 posture and the
 * bypass list; an unset model on them stays public as before.
 *
 * [ADR-0090 D4] The legacy aliases (`read`/`read_write`/`full`) no longer
 * parse at authoring. A stored value this function does not recognise
 * fails CLOSED to `private` (never silently public).
 */
export function effectiveSharingModel(schema: any): 'private' | 'read' | 'public' {
  const m = schema?.sharingModel ?? schema?.security?.sharingModel;
  if (m === 'private') return 'private';
  if (m === 'public_read') return 'read';
  if (m === 'public_read_write' || m === 'controlled_by_parent') return 'public';
  if (m == null) {
    const isSystem = schema?.isSystem === true || String(schema?.name ?? '').startsWith('sys_');
    return isSystem ? 'public' : 'private';
  }
  return 'private';
}

/**
 * [#5859 / #5852] The caller's ACTIVE ORGANIZATION as carried by an execution
 * context — the value `HierarchyScopeContext.organizationId` (the authoritative
 * tenancy field since #5858 / PR #5973) must be filled with.
 *
 * Every transport puts it on `tenantId`: both HTTP entry points build their
 * context from the ONE shared authorization resolver
 * (`resolveAuthzContext`, `@objectstack/core`), which resolves
 * `tenantId = session.activeOrganizationId` on the session path and
 * `sys_api_key.organization_id` on the API-key path, and `ExecutionContext`
 * documents the field as exactly that ("Current organization/tenant ID
 * (resolved from `session.activeOrganizationId`)"). NOTHING sets
 * `organizationId` on an execution context — which is why reading that key
 * here produced a structural `null` on every real request, and every
 * hierarchy resolver ran with no organization to scope by (#5852: an ordinary
 * member `POST`ing a share on a SIBLING organization's record got 201).
 *
 * This is the PRODUCER speaking the contract's authoritative name — not a
 * consumer-side `?? tenantId` tolerance, which #5858 explicitly rules out for
 * resolvers. The identical mapping already backs the Layer-0 tenant wall in
 * `@objectstack/plugin-security` (`computeTenantLayer0Filter({ organizationId:
 * context?.tenantId })`), so the two enforcement layers now scope by the same
 * value from the same field.
 *
 * Returns `null` — never `undefined`, and never a blank string — for "no active
 * organization": the contract types the field as `string | null`, and `null` is
 * the value a resolver's fail-closed obligation is written against.
 */
function activeOrganizationId(context: SharingExecutionContext): string | null {
  const org = (context as any)?.tenantId;
  return typeof org === 'string' && org.trim() !== '' ? org : null;
}

function hasOwnerField(schema: any): boolean {
  return Boolean(schema?.fields && OWNER_FIELD in schema.fields);
}

/**
 * [ADR-0111 D2] The narrow slice of `ISecurityService` the management gate
 * needs — kept structural so unit tests can pass a stub and so a deployment
 * without `@objectstack/plugin-security` degrades to owner-only (fail closed).
 */
export interface SharingSecurityProbe {
  hasWriteBypass?(object: string, context: unknown): Promise<boolean>;
  /**
   * [#5493] `ISecurityService.checkAuthoredRowWrite` — "does an APP-AUTHORED
   * row-level policy admit this row for this write operation, on its own, with
   * the platform's ownership floor taken out?"
   *
   * Read by {@link SharingService.probeAuthoredRowWrite} so the write gate can
   * DEFER instead of hard-refusing a by-id write that a declared widener
   * admits. Structural on purpose, exactly like the two members above: this
   * plugin does not depend on `@objectstack/plugin-security`, it declares the
   * slice it probes.
   *
   * `admit` is EVIDENCE, never authorization — it says a declared policy speaks
   * for this row, not that the write is permitted. Every other outcome
   * (`abstain`, an absent method, an absent service, a throw) is one
   * instruction: keep today's refusal.
   */
  checkAuthoredRowWrite?(
    object: string,
    recordId: string,
    operation: AuthoredRowWriteOperation,
    context?: unknown,
  ): Promise<AuthoredRowWriteVerdict>;
  /**
   * [ADR-0111 D1 DEPTH] The caller's effective WRITE scope on `object`
   * (`own` / `own_and_reports` / `unit` / `unit_and_below` / `org`), resolved
   * from their permission sets exactly as the CRUD middleware resolves it.
   * Used by {@link SharingService.canManageShares} to let a hierarchy manager
   * manage shares on records they can write by DEPTH. Fails closed to `own`.
   */
  resolveWriteScope?(
    object: string,
    context: unknown,
  ): Promise<'own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org'>;
}

/** [#5103] The table whose orphans this service owns. */
const RECORD_SHARE_SWEEP_SUBJECT = {
  table: 'sys_record_share',
  noun: 'share',
  issue: '#5103',
} as const;

/**
 * [ADR-0105 D1 / #5859] The narrow slice of the `tenancy` service the
 * organization gate needs — the deployment's posture, i.e. whether an
 * organization wall is enforced at all. Kept structural (and identical in shape
 * to what `SecurityPlugin` reads) so a stack without `@objectstack/plugin-auth`
 * needs no adapter, and so a unit test can state a posture without a kernel.
 */
export interface SharingTenancyProbe {
  /** `single` | `group` | `isolated` (the legacy `multi` spelling normalizes). */
  readonly posture?: TenancyPosture | string;
  /** Pre-ADR-0105 shape: "is the hard organization wall on?" */
  readonly isolationActive?: boolean;
}

export interface SharingServiceOptions {
  engine: SharingEngine;
  /** Object names that bypass sharing — typically platform internals. */
  bypassObjects?: string[];
  /**
   * [ADR-0057] Late-bound lookup for the enterprise hierarchy-scope resolver
   * (`hierarchy-scope-resolver` service). Returns null in the open edition.
   */
  hierarchyResolver?: () => IHierarchyScopeResolver | null | undefined;
  /**
   * [ADR-0111 D1/D2] Late-bound lookup for the `security` service, probed for
   * the super-user write bypass (`modifyAllRecords`) in
   * {@link SharingService.canManageShares}. Absent / throwing / returning
   * null → management authority fails CLOSED to owner-only.
   *
   * [#5493] The SAME handle carries the authored-row-write verdict read by
   * {@link SharingService.probeAuthoredRowWrite} — one late binding, two
   * probes, so a deployment cannot end up with one of them wired and the other
   * not. Both fail closed on absence, in their own directions.
   */
  securityService?: () => SharingSecurityProbe | null | undefined;
  /**
   * [ADR-0105 D1 / #5859] Late-bound lookup for the `tenancy` service — the
   * single source of truth for which posture is IN FORCE. Read ONLY to decide
   * whether a missing authoritative organization must refuse a hierarchy scope
   * (see {@link SharingService.organizationScopeRequired}).
   *
   * Absent / throwing / posture-less → the gate assumes a WALLED deployment and
   * refuses: an unresolvable posture must not be read as "no wall, carry on".
   */
  tenancy?: () => SharingTenancyProbe | null | undefined;
  /** [#5103] Optional logger for the record-delete cascade / orphan sweep. */
  logger?: { info?: Function; warn?: Function; error?: Function; debug?: Function };
}

/**
 * Default `ISharingService` implementation.
 *
 * Stores every grant in `sys_record_share`. The plugin layer registers
 * an engine middleware that calls `buildReadFilter` / `canEdit` so that
 * neither this class nor its callers need to know about middleware
 * plumbing.
 */
export class SharingService implements ISharingService {
  private readonly engine: SharingEngine;
  private readonly bypassObjects: Set<string>;
  private readonly hierarchyResolver?: () => IHierarchyScopeResolver | null | undefined;
  private readonly securityService?: () => SharingSecurityProbe | null | undefined;
  private readonly tenancy?: () => SharingTenancyProbe | null | undefined;
  private readonly logger?: SharingServiceOptions['logger'];

  constructor(options: SharingServiceOptions) {
    this.engine = options.engine;
    this.hierarchyResolver = options.hierarchyResolver;
    this.securityService = options.securityService;
    this.tenancy = options.tenancy;
    this.logger = options.logger;
    this.bypassObjects = new Set([
      'sys_record_share',
      'sys_user',
      'sys_organization',
      'sys_member',
      'sys_position',
      'sys_permission_set',
      'sys_user_permission_set',
      'sys_position_permission_set',
      ...(options.bypassObjects ?? []),
    ]);
  }

  /**
   * Build a `FilterCondition` restricting `find` to records the caller
   * may see. Returns `null` when no filter should be applied.
   */
  async buildReadFilter(
    object: string,
    context: SharingExecutionContext,
  ): Promise<unknown | null> {
    if (this.shouldBypass(object, context)) return null;

    const schema = this.engine.getSchema?.(object);
    if (!schema) return null;
    if (effectiveSharingModel(schema) !== 'private') return null;
    if (!hasOwnerField(schema)) return null;
    if (!context.userId) {
      // Authenticated context with no user id is a degenerate case
      // (e.g. anonymous API key). Restrict to nothing rather than
      // accidentally leaking owner-only data.
      return { id: '__deny_all__' };
    }

    // [ADR-0057 D1] Access DEPTH widens the owner-match for this grant:
    // own → [me], unit → my BU members, unit_and_below → my BU subtree, org →
    // no owner filter. Sharing grants are still OR-ed in on top (additive).
    const readScope = (context as any).__readScope as ('own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org' | undefined);
    if (readScope === 'org') return null;
    const ownerIds = await this.resolveOwnerScopeIds(context, readScope);
    const ownerMatch: Record<string, unknown> = ownerIds.length === 1
      ? { [OWNER_FIELD]: ownerIds[0] }
      : { [OWNER_FIELD]: { $in: ownerIds } };

    const grants = await this.engine.find('sys_record_share', {
      where: {
        object_name: object,
        recipient_type: 'user',
        recipient_id: context.userId,
      },
      fields: ['record_id', 'access_level'],
      limit: 5000,
      context: SYSTEM_CTX,
    });

    const grantedIds: string[] = Array.isArray(grants)
      ? grants.map((g: any) => String(g.record_id)).filter(Boolean)
      : [];

    if (grantedIds.length === 0) {
      return ownerMatch;
    }

    return {
      $or: [
        ownerMatch,
        { id: { $in: grantedIds } },
      ],
    };
  }

  /**
   * Build a `FilterCondition` restricting a **bulk** (multi-row) write to the
   * records the caller may edit — the write analogue of {@link buildReadFilter}.
   * Single-id writes are gated by {@link canEdit}; a `update({multi:true})` /
   * `deleteMany` has no single id, so without this filter it would touch every
   * matching row regardless of ownership (#2982). Returns `null` when no
   * restriction applies (system/bypass, public objects, no owner field).
   *
   * Editable-set = owner-match (widened by write DEPTH) OR records shared to
   * the caller at a {@link WRITE_ACCESS_LEVELS} level. Unlike reads, this
   * applies to BOTH `private` and `read` (public_read) models — public_read is
   * read-open but write-owned; only a fully `public` object is write-open.
   */
  async buildWriteFilter(
    object: string,
    context: SharingExecutionContext,
    verb: 'update' | 'delete' = 'update',
  ): Promise<unknown | null> {
    if (this.shouldBypass(object, context)) return null;

    const schema = this.engine.getSchema?.(object);
    if (!schema) return null;
    if (effectiveSharingModel(schema) === 'public') return null;
    if (!hasOwnerField(schema)) return null;
    if (!context.userId) {
      // Authenticated but principal-less → edit nothing (fail closed),
      // mirroring buildReadFilter's degenerate-context handling.
      return { id: '__deny_all__' };
    }

    const writeScope = (context as any).__writeScope as ('own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org' | undefined);
    if (writeScope === 'org') return null;
    const ownerIds = await this.resolveOwnerScopeIds(context, writeScope);
    const ownerMatch: Record<string, unknown> = ownerIds.length === 1
      ? { [OWNER_FIELD]: ownerIds[0] }
      : { [OWNER_FIELD]: { $in: ownerIds } };

    // [ADR-0111 D3] The verb boundary applied to BULK writes: a share widens
    // which rows a principal may *edit*, never which they may *delete*. So a
    // `delete({multi:true})` scopes to the owner/DEPTH set ALONE — the shared
    // record ids are NOT OR-ed in, exactly as the single-id `canDelete` gate
    // drops the share branch. Update keeps the share widening.
    if (verb === 'delete') return ownerMatch;

    const grants = await this.engine.find('sys_record_share', {
      where: {
        object_name: object,
        recipient_type: 'user',
        recipient_id: context.userId,
        access_level: { $in: [...WRITE_ACCESS_LEVELS] },
      },
      fields: ['record_id'],
      limit: 5000,
      context: SYSTEM_CTX,
    });
    const grantedIds: string[] = Array.isArray(grants)
      ? grants.map((g: any) => String(g.record_id)).filter(Boolean)
      : [];

    if (grantedIds.length === 0) return ownerMatch;
    return { $or: [ownerMatch, { id: { $in: grantedIds } }] };
  }

  /**
   * Does the caller own `(object, recordId)` within their write DEPTH? The
   * shared ownership fast-path behind both {@link canEdit} and
   * {@link canDelete}. Returns `false` when the record has no owner value.
   */
  private async matchesOwnerScope(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<boolean> {
    const own = await this.engine.find(object, {
      where: { id: recordId },
      fields: ['id', OWNER_FIELD],
      limit: 1,
      context: SYSTEM_CTX,
    });
    const owner = Array.isArray(own) && own[0] ? (own[0] as any)[OWNER_FIELD] : undefined;
    if (owner == null) return false;
    const writeScope = (context as any).__writeScope as ('own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org' | undefined);
    if (writeScope === 'org') return true;
    const owners = await this.resolveOwnerScopeIds(context, writeScope);
    return owners.includes(String(owner));
  }

  /**
   * [#4647] Does the caller hold **Modify All Data** (`modifyAllRecords`) on
   * `object`? Probed through the late-bound security service, which answers
   * from `PermissionEvaluator.superuserBypassSets` — the SAME predicate the
   * explain engine's `vama_bypass` layer reports. That shared function is the
   * whole point: before #4647 explain answered "bypass held, ownership and
   * sharing are skipped" while this side never asked at all, so a Modify All
   * Data holder was told `allowed: true` by `security/explain` and handed a
   * 403 by `PATCH /data/…` on the very same record.
   *
   * Consulted only AFTER ownership and shares have failed, so the ordinary
   * write costs no extra resolution.
   *
   * **Fails CLOSED** (ADR-0111 D2): no security service (a deployment without
   * `@objectstack/plugin-security`), a throwing probe, a principal-less or
   * on-behalf-of context → `false`, i.e. owner-only as before.
   */
  private async hasModifyAllBypass(
    object: string,
    context: SharingExecutionContext,
  ): Promise<boolean> {
    const probe = this.securityService?.();
    if (!probe || typeof probe.hasWriteBypass !== 'function') return false;
    try {
      return (await probe.hasWriteBypass(object, context)) === true;
    } catch {
      return false;
    }
  }

  /**
   * [#6428] The two reasons {@link shouldBypass} answers `true` are NOT the
   * same verdict, and merging them is what the tri-state exists to undo.
   *
   * - `context.isSystem` → **`allow`**. A platform-internal writer (audit,
   *   migrations, this plugin's own reconciliation) is positively permitted;
   *   the contract calls it a complete bypass, and a composing caller must not
   *   re-gate it behind somebody else's floor.
   * - a bypass-LISTED object → **`abstain`**. Record sharing simply does not
   *   enforce on `sys_user` / `sys_record_share` / … — it is not a statement
   *   that the write is permitted, and whatever else guards those tables
   *   (RLS, the platform ownership floor) still decides.
   *
   * `null` = "no bypass applies, keep evaluating".
   */
  private bypassVerdict(
    object: string,
    context: SharingExecutionContext,
  ): SharingWriteVerdict | null {
    if (context?.isSystem) return 'allow';
    if (this.bypassObjects.has(object)) return 'abstain';
    return null;
  }

  /**
   * [#6428] The one place an unresolvable write gate becomes a verdict.
   *
   * **`deny`, never `abstain`** — the two are opposite instructions to a
   * composing caller (`abstain` hands the row to another authority, `deny`
   * ends it), and reading a failed lookup as "no opinion" is exactly the
   * confusion that produced #5492's measured fail-open. Logged rather than
   * swallowed: a silently-denied write is indistinguishable from a legitimate
   * refusal, which is how a broken engine looks like a permissions problem.
   */
  private writeGateFailClosed(
    verb: 'update' | 'delete',
    object: string,
    recordId: string,
    context: SharingExecutionContext,
    err: unknown,
  ): SharingWriteVerdict {
    this.logger?.error?.(
      `[sharing] the ${verb} gate could not resolve a verdict for '${object}' record `
      + `'${recordId}' (user ${context?.userId ?? 'unknown'}) — DENYING (fail-closed, #6428): `
      + 'a failed lookup is a refusal, never an abstention',
      err instanceof Error ? err : new Error(String(err)),
    );
    return 'deny';
  }

  /**
   * [#6428] Tri-state UPDATE verdict — the single place the update gate is
   * decided, and the primary form of {@link canEdit}.
   *
   * `allow` when a POSITIVE basis exists: ownership (widened by write DEPTH),
   * an explicit write-level share, or — [#4647] — the `modifyAllRecords`
   * super-user bypass. That bypass branch is what makes "Modify All Data" mean
   * what it says (an admin edits any record regardless of ownership — #1883's
   * Salesforce reference frame) on rows the DEPTH fast-path cannot reach: an
   * OWNERLESS row (`owner_id` NULL, which system-context seeds routinely
   * produce) matches no owner set at any depth, so ownership alone refused it.
   *
   * `abstain` when record sharing does not enforce on the row at all — a
   * public object, an object with no `owner_id` field, a bypass-listed
   * internal, an object with no resolvable schema. Historically these returned
   * the same `true` as a real grant, and #5492's E2 experiment measured what
   * that costs a caller which lets the answer OVERRIDE the platform's
   * `created_by` ownership floor: an ordinary member's cross-creator UPDATE
   * succeeded on owner-less objects, where the floor alone had been refusing it.
   *
   * `deny` for everything else, including a lookup that throws.
   */
  async checkEdit(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<SharingWriteVerdict> {
    const bypass = this.bypassVerdict(object, context);
    if (bypass) return bypass;

    try {
      const schema = this.engine.getSchema?.(object);
      if (!schema) return 'abstain';
      const model = effectiveSharingModel(schema);
      if (model === 'public') return 'abstain';
      if (!hasOwnerField(schema)) return 'abstain';
      if (!context.userId) return 'deny';

      // 1) Ownership (write DEPTH widens the owner-set) — fast path.
      if (await this.matchesOwnerScope(object, recordId, context)) return 'allow';

      // 2) Explicit write-level share (`edit`, plus not-yet-normalised `full`).
      const editGrants = await this.engine.find('sys_record_share', {
        where: {
          object_name: object,
          record_id: recordId,
          recipient_type: 'user',
          recipient_id: context.userId,
          access_level: { $in: [...WRITE_ACCESS_LEVELS] },
        },
        fields: ['id'],
        limit: 1,
        context: SYSTEM_CTX,
      });
      if (Array.isArray(editGrants) && editGrants.length > 0) return 'allow';

      // 3) [#4647] Modify All Data — the explicit bypass, asked LAST and
      // answered by the same predicate `security/explain` reports.
      return (await this.hasModifyAllBypass(object, context)) ? 'allow' : 'deny';
    } catch (err) {
      return this.writeGateFailClosed('update', object, recordId, context, err);
    }
  }

  /**
   * Return `true` if the caller may UPDATE `(object, recordId)`: ownership
   * (widened by write DEPTH), an explicit write-level share, or — [#4647] —
   * the `modifyAllRecords` super-user bypass. Always `true` for system context,
   * public objects, and objects without an owner field.
   *
   * [#6428] The two-state PROJECTION of {@link checkEdit}: `true` for every
   * verdict that is not `deny`. The truth table is byte-for-byte the historical
   * one — `abstain` is where the old `true` for public / owner-less / bypassed
   * objects went — so every existing caller (the sharing middleware, the
   * `sys_attachment` parent gate, the ADR-0055 master check) keeps its exact
   * semantics. A caller that would let this answer OVERRIDE another authority
   * must read {@link checkEdit} instead, because only there is "I permit this"
   * distinguishable from "I do not enforce here".
   */
  async canEdit(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<boolean> {
    return (await this.checkEdit(object, recordId, context)) !== 'deny';
  }

  /**
   * [#6428 / ADR-0111 D3] Tri-state DELETE verdict — the primary form of
   * {@link canDelete}.
   *
   * Deliberately NARROWER than {@link checkEdit}: `allow` is ownership (widened
   * by write DEPTH) or the `modifyAllRecords` super-user bypass — and NOTHING
   * ELSE. An `edit` (or legacy `full`) share opens update but not delete
   * (sharing widens rows, never verbs), so a share holder gets `deny` here
   * while `checkEdit` answers `allow` on the same row. The `abstain` set is
   * IDENTICAL to `checkEdit`'s: both gates agree about which objects sharing
   * enforces on, and differ only about the verb.
   *
   * [#4647] The bypass is asked EXPLICITLY (`hasWriteBypass`) instead of only
   * riding in as `__writeScope === 'org'`. The scope proxy was silently
   * partial: `matchesOwnerScope` refuses an OWNERLESS row before it ever looks
   * at the scope, so a Modify All Data holder could not delete a row with a
   * NULL `owner_id` — while `security/explain` said the bypass applied.
   */
  async checkDelete(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<SharingWriteVerdict> {
    const bypass = this.bypassVerdict(object, context);
    if (bypass) return bypass;

    try {
      const schema = this.engine.getSchema?.(object);
      if (!schema) return 'abstain';
      if (effectiveSharingModel(schema) === 'public') return 'abstain';
      if (!hasOwnerField(schema)) return 'abstain';
      if (!context.userId) return 'deny';

      // Ownership / write DEPTH only — no share branch. This is the whole
      // difference from checkEdit.
      if (await this.matchesOwnerScope(object, recordId, context)) return 'allow';

      // [#4647] Modify All Data — the same explicit bypass checkEdit consults.
      return (await this.hasModifyAllBypass(object, context)) ? 'allow' : 'deny';
    } catch (err) {
      return this.writeGateFailClosed('delete', object, recordId, context, err);
    }
  }

  /**
   * [ADR-0111 D3] Return `true` if the caller may DELETE `(object, recordId)`.
   *
   * Deliberately NARROWER than {@link canEdit}: ownership (widened by write
   * DEPTH) or the `modifyAllRecords` super-user bypass — and NOTHING ELSE. An
   * `edit` (or legacy `full`) share opens update but not delete: sharing widens
   * rows, never verbs. Always `true` for system context, public objects, and
   * objects without an owner field, matching {@link canEdit}.
   *
   * [#6428] The two-state PROJECTION of {@link checkDelete}, on the same rule
   * as {@link canEdit}: `true` for everything that is not a `deny`.
   */
  async canDelete(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<boolean> {
    return (await this.checkDelete(object, recordId, context)) !== 'deny';
  }

  /**
   * [#5493 / maintainer ruling 2026-08-08, issue comment 5226389104] Ask the
   * OTHER row-level write authority whether an APP-AUTHORED RLS policy admits
   * this row for this operation, so the by-id write gate can DEFER instead of
   * hard-refusing a write that a declaration already speaks for.
   *
   * **This is not a sharing verdict and it never becomes one.** Nothing here
   * feeds {@link checkEdit} / {@link checkDelete} / {@link buildWriteFilter} —
   * those keep answering exactly what record sharing knows, which is what
   * `plugin-security`'s own composition (#5492) reads off this service. Folding
   * the probe into them would make the two authorities read each other in a
   * circle. Only the middleware's refusal branch consults it.
   *
   * **Why the security service answers it and this plugin does not re-derive
   * it.** Row-level write authority is ONE composite determination, but its two
   * halves know different things. The composed RLS answer cannot stand in for
   * "an app policy admits this row": the platform's own ownership floor
   * (`owner_only_writes` / `owner_only_deletes`, `created_by ==
   * current_user.id`) ships on the additive `member_default` baseline, so the
   * composed answer is true for the row's CREATOR whether or not any app policy
   * mentions it. #5493's probe E-A measured the cost — a creator who is no
   * longer the owner (a record transferred away) would get their old records
   * back. Separating the two needs policy PROVENANCE, which is private to
   * `plugin-security` by design. Hence a verdict on the service, and hence this
   * method is a PASSTHROUGH with no logic of its own to drift.
   *
   * **Fail-closed in the `abstain` direction**, because the caller uses `admit`
   * to WIDEN: an absent security service (no `plugin-security` at all), a
   * service that predates the method, a probe that throws, a principal-less
   * context, a delegated (on-behalf-of) identity, and any verdict this consumer
   * does not recognise all return `abstain` — byte-for-byte the behaviour of a
   * deployment that never asked.
   */
  async probeAuthoredRowWrite(
    object: string,
    recordId: string,
    operation: AuthoredRowWriteOperation,
    context: SharingExecutionContext,
  ): Promise<AuthoredRowWriteVerdict> {
    try {
      if (!context?.userId) return 'abstain';
      // [ADR-0090 D10] A delegated identity is not measurable here. The
      // delegator intersection is composed by the MIDDLEWARE (it gates twice),
      // so a single verdict would be resolved against one of the two identities
      // and silently stand for both. Declining to defer is the answer that
      // changes nothing — the same stance `hasWriteBypass` and
      // `resolveWriteScope` already take on this context.
      if ((context as { onBehalfOf?: { userId?: string } }).onBehalfOf?.userId) return 'abstain';

      const probe = this.securityService?.();
      // Feature-detected, never assumed: the contract declares the method
      // OPTIONAL precisely so absence and `abstain` are ONE instruction.
      if (!probe || typeof probe.checkAuthoredRowWrite !== 'function') return 'abstain';

      const verdict = await probe.checkAuthoredRowWrite(object, recordId, operation, context);
      // Only the literal `admit` widens. A probe answering in a vocabulary this
      // consumer does not know is an unmeasured answer, not a permission.
      return verdict === 'admit' ? 'admit' : 'abstain';
    } catch (err) {
      this.logger?.warn?.(
        `[sharing] the authored-row-write probe for '${object}' record '${recordId}' `
        + `(${operation}, user ${context?.userId ?? 'unknown'}) could not be resolved — `
        + 'ABSTAINING, so the existing refusal stands (fail-closed, #5493)',
        err instanceof Error ? err : new Error(String(err)),
      );
      return 'abstain';
    }
  }

  /**
   * [ADR-0111 D1] May `context` MANAGE shares (grant / revoke / list) on
   * `(object, recordId)`? System → yes. Record owner → yes. Super-user write
   * bypass (`modifyAllRecords`, probed via the late-bound security service) →
   * yes. [ADR-0111 D1 DEPTH] A HIERARCHY MANAGER whose write DEPTH
   * (`unit` / `unit_and_below` / `own_and_reports`) covers the record's owner →
   * yes. Everything else — a missing record, a principal-less context, a probe
   * failure, a deployment without plugin-security or the enterprise resolver —
   * fails CLOSED to `false`.
   */
  async canManageShares(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<boolean> {
    if (context?.isSystem) return true;
    if (!object || !recordId || !context?.userId) return false;

    // Ownership — read under system context so field-level masking cannot
    // hide the owner column from the decision itself. Keep the owner value:
    // the DEPTH branch below reuses it rather than re-reading the row.
    let owner: unknown;
    try {
      const rows = await this.engine.find(object, {
        where: { id: recordId },
        fields: ['id', OWNER_FIELD],
        limit: 1,
        context: SYSTEM_CTX,
      });
      const row: any = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) return false;
      owner = row[OWNER_FIELD];
      if (owner != null && String(owner) === String(context.userId)) return true;
    } catch {
      return false;
    }

    // Modify All Data — the EXPLICIT bypass only (ADR-0111 D1/D2; never the
    // effective write scope, whose unmatched-object case fails open to 'org').
    // [#4647] Shared with `canEdit`/`canDelete` so the three gates cannot drift.
    if (await this.hasModifyAllBypass(object, context)) return true;

    const probe = this.securityService?.();

    // [ADR-0111 D1 DEPTH] Hierarchy-manager authority: a caller whose effective
    // WRITE scope on this object is a HIERARCHY scope may manage shares on a
    // record whose owner falls within that scope's owner set (the same set the
    // write filter/canEdit use). Only the three hierarchy scopes widen here —
    // `own` adds nothing beyond the ownership check above, and `org` is
    // DELIBERATELY ignored: `resolveWriteScope` returns `org` both for a genuine
    // Modify-All holder (already handled) AND for the fail-OPEN
    // "no permission set mentions this object" case, so honouring `org` here
    // would reopen exactly the hole `hasWriteBypass` was chosen to avoid.
    if (owner != null && probe && typeof probe.resolveWriteScope === 'function') {
      try {
        const scope = await probe.resolveWriteScope(object, context);
        if (scope === 'unit' || scope === 'unit_and_below' || scope === 'own_and_reports') {
          const ownerIds = await this.resolveOwnerScopeIds(context, scope);
          if (ownerIds.includes(String(owner))) return true;
        }
      } catch {
        /* fall through to deny */
      }
    }
    return false;
  }

  /**
   * [ADR-0111 D5] Is `(object, recordId)` VISIBLE to the caller? Reads under
   * the CALLER's own context so the security RLS and sharing read filters
   * decide, exactly as a plain find would. Any failure → not visible (fail
   * closed); callers surface that as NOT_FOUND so a missing record and an
   * invisible one are indistinguishable.
   */
  private async isRecordVisible(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<boolean> {
    try {
      const rows = await this.engine.find(object, {
        where: { id: recordId },
        fields: ['id'],
        limit: 1,
        context,
      });
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * [ADR-0111 D1/D5] The shared pre-flight for every management verb:
   * invisible/missing record → NOT_FOUND (404); visible but unmanageable →
   * PERMISSION_DENIED (403). System context skips both.
   */
  private async assertCanManageShares(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<void> {
    if (context?.isSystem) return;
    if (!(await this.isRecordVisible(object, recordId, context))) {
      throw new Error(`NOT_FOUND: ${object}/${recordId} not found`);
    }
    if (!(await this.canManageShares(object, recordId, context))) {
      throw new Error(
        `PERMISSION_DENIED: managing shares on ${object}/${recordId} requires record ownership or Modify All Data (ADR-0111 D1)`,
      );
    }
  }

  /**
   * [ADR-0111 D7] The object must be one the sharing gates actually consult —
   * otherwise the grant would persist a row no read/write decision ever reads
   * (the ADR-0078 silently-inert trap, inverted: "share" succeeds and nothing
   * is shared). Bypass objects, `controlled_by_parent` (a detail record's
   * access follows its master, ADR-0055), public models, and owner-less
   * objects all refuse with SHARING_NOT_ENABLED (REST: 422). An engine
   * without schema access skips the check — it cannot know, and this guard is
   * an inertness guard, not the authority gate.
   */
  private assertSharingEnforced(object: string): void {
    if (this.bypassObjects.has(object)) {
      throw new Error(
        `SHARING_NOT_ENABLED: '${object}' bypasses record sharing; a share row on it would never be consulted`,
      );
    }
    if (typeof this.engine.getSchema !== 'function') return;
    const schema = this.engine.getSchema(object);
    if (!schema) throw new Error(`NOT_FOUND: unknown object '${object}'`);
    const declared = schema?.sharingModel ?? schema?.security?.sharingModel;
    if (declared === 'controlled_by_parent') {
      throw new Error(
        `SHARING_NOT_ENABLED: '${object}' is controlled by its parent (master-detail); share the master record instead`,
      );
    }
    if (effectiveSharingModel(schema) === 'public' || !hasOwnerField(schema)) {
      throw new Error(
        `SHARING_NOT_ENABLED: '${object}' is not under record-sharing enforcement `
        + `(public sharing model or no '${OWNER_FIELD}' field); a share row on it would never be consulted`,
      );
    }
  }

  /**
   * Upsert a share row. Returning the existing row when an identical
   * grant already exists keeps the REST endpoint idempotent.
   *
   * [ADR-0111 D1/D7] Non-system callers must hold {@link canManageShares} on
   * the record; the recipient must be a `user` (the only type any gate
   * enforces); and the object must be in an enforcing sharing posture. The
   * upsert matches on `(object, record, recipient, source)` so a manual grant
   * never clobbers a rule-materialised row (and vice versa) — when both exist,
   * the gates' `$in` queries make the widest level win (grants are additive).
   */
  async grant(
    input: GrantShareInput,
    context: SharingExecutionContext,
  ): Promise<RecordShare> {
    if (!input.object) throw new Error('VALIDATION_FAILED: object is required');
    if (!input.recordId) throw new Error('VALIDATION_FAILED: recordId is required');
    if (!input.recipientId) throw new Error('VALIDATION_FAILED: recipientId is required');

    const recipientType = input.recipientType ?? 'user';
    // [ADR-0111 D7] Only `user` recipients are consulted by the read/write
    // gates; persisting any other type would be a silently inert grant
    // (ADR-0078). Group / business-unit principals are delivered via sharing
    // rules, whose evaluator expands them into per-user rows.
    if (recipientType !== 'user') {
      throw new Error(
        `VALIDATION_FAILED: recipientType must be 'user' (received ${JSON.stringify(recipientType)}) — `
        + `group/position recipients are delivered via sharing rules (ADR-0111 D7)`,
      );
    }
    // Validate BEFORE any write. Previously anything at all was persisted
    // verbatim, so a typo'd level became a grant that no gate ever matched — a
    // share row that looks granted and enforces nothing (#3865). `full`
    // normalises to `edit` (what it always meant); everything unrecognised is a
    // loud VALIDATION_FAILED the REST layer maps to 400.
    const accessLevel: ShareAccessLevel = normalizeAccessLevel(input.accessLevel, 'read');
    const source = input.source ?? 'manual';

    // [ADR-0111 D1/D7] Authorization + posture, service-side so every caller
    // is covered (#3902 ③ — the REST route used to hand any signed-in user
    // straight to this SYSTEM_CTX write path). System callers bypass: the
    // rule evaluator materialises through here under its own validation.
    if (!context?.isSystem) {
      this.assertSharingEnforced(input.object);
      await this.assertCanManageShares(input.object, input.recordId, context);
    }

    // Upsert: if a row with same (object, record, recipient, source) exists,
    // update its access level / reason; otherwise insert a new one. `source`
    // is part of the key (ADR-0111 D7): a manual grant must not clobber a
    // rule-materialised row — the rule's next reconcile would fight it (flip
    // it back or purge it), leaving access flapping between the two answers.
    const existing = await this.engine.find('sys_record_share', {
      where: {
        object_name: input.object,
        record_id: input.recordId,
        recipient_type: recipientType,
        recipient_id: input.recipientId,
        source,
      },
      limit: 1,
      context: SYSTEM_CTX,
    });
    const now = new Date().toISOString();
    if (Array.isArray(existing) && existing[0]) {
      const row: any = existing[0];
      const patch: any = {
        id: row.id,
        access_level: accessLevel,
        source,
        source_id: input.sourceId ?? row.source_id ?? null,
        reason: input.reason ?? row.reason ?? null,
        updated_at: now,
      };
      await this.engine.update('sys_record_share', patch, { context: SYSTEM_CTX });
      return { ...row, ...patch } as RecordShare;
    }

    const id = makeShareId();
    const row: any = {
      id,
      object_name: input.object,
      record_id: input.recordId,
      recipient_type: recipientType,
      recipient_id: input.recipientId,
      access_level: accessLevel,
      source,
      source_id: input.sourceId ?? null,
      granted_by: context.userId ?? null,
      reason: input.reason ?? null,
      created_at: now,
      updated_at: now,
    };
    await this.engine.insert('sys_record_share', row, { context: SYSTEM_CTX });
    return row as RecordShare;
  }

  /**
   * Delete a share row by id.
   *
   * [ADR-0111 D4] `revoke(shareId)` used to delete unconditionally — any
   * signed-in user holding (or enumerating) a share id could silently strip
   * any user's access to any record (#3902 ①). Non-system callers now must:
   * hold {@link canManageShares} on the share's record (revoke is SYMMETRIC
   * with grant — no granter exception); pass a `scope` match when the caller
   * supplies one (the REST route forwards its URL's object/record, so a share
   * id cannot be revoked through an unrelated path); and target a `manual`
   * row — rule-materialised grants would be silently re-granted on the next
   * reconcile, so "revoked" would be a lie (deactivate the rule instead).
   * System callers keep the historical delete-by-id no-op-when-missing
   * behaviour (the rule evaluator's reconciliation path).
   */
  async revoke(
    shareId: string,
    context: SharingExecutionContext,
    scope?: { object: string; recordId: string },
  ): Promise<void> {
    if (!shareId) throw new Error('VALIDATION_FAILED: shareId is required');
    if (context?.isSystem) {
      await this.engine.delete('sys_record_share', {
        where: { id: shareId },
        context: SYSTEM_CTX,
      });
      return;
    }

    const rows = await this.engine.find('sys_record_share', {
      where: { id: shareId },
      limit: 1,
      context: SYSTEM_CTX,
    });
    const row: any = Array.isArray(rows) ? rows[0] : undefined;
    // Missing row and scope-mismatched row are the same 404 — neither
    // confirms the share's existence to a caller who cannot manage it.
    if (!row) throw new Error(`NOT_FOUND: share ${shareId} not found`);
    if (
      scope
      && (String(row.object_name) !== String(scope.object)
        || String(row.record_id) !== String(scope.recordId))
    ) {
      throw new Error(`NOT_FOUND: share ${shareId} not found on ${scope.object}/${scope.recordId}`);
    }
    await this.assertCanManageShares(String(row.object_name), String(row.record_id), context);
    if (row.source != null && row.source !== 'manual') {
      throw new Error(
        `CONFLICT: share ${shareId} is materialised by source '${row.source}' and would be re-granted `
        + `on the next reconciliation — deactivate or edit its sharing rule instead (ADR-0111 D4)`,
      );
    }
    await this.engine.delete('sys_record_share', {
      where: { id: shareId },
      context: SYSTEM_CTX,
    });
  }

  /**
   * List share rows for `(object, recordId)`.
   *
   * [ADR-0111 D5] Management-gated for non-system callers: enumerating who
   * can see a record is both an information disclosure and the exact recon
   * that hands an attacker the share ids the revoke gate protects (#3902 ②).
   * Salesforce's Sharing Detail page is likewise owner/hierarchy/admin-only.
   * "What is shared with me / by me" is served by the self-scoped
   * `sys_record_share` read surface instead.
   */
  async listShares(
    object: string,
    recordId: string,
    context: SharingExecutionContext,
  ): Promise<RecordShare[]> {
    if (!context?.isSystem) {
      await this.assertCanManageShares(object, recordId, context);
    }
    const rows = await this.engine.find('sys_record_share', {
      where: { object_name: object, record_id: recordId },
      orderBy: [{ field: 'created_at', order: 'desc' }],
      limit: 500,
      context: SYSTEM_CTX,
    });
    return Array.isArray(rows) ? (rows as RecordShare[]) : [];
  }

  /**
   * [#5103] Revoke EVERY `sys_record_share` row belonging to records that have
   * just been deleted — regardless of `source`.
   *
   * This is the one place manual shares are swept, and the justification is
   * exactly what makes it safe: the record is GONE. A share says "principal P
   * has level L on (object O, record R)"; with R deleted the row cannot
   * describe any access a human decided to give, so keeping it is not respect
   * for the admin's decision, it is a dangling reference. Contrast rule
   * RECOMPUTE, which must never touch a manual row (#5102 pinned that, and it
   * stays pinned): there the record still exists and the human's decision is
   * still about something.
   *
   * Why the orphan matters even though the record is gone: `buildReadFilter`
   * emits `id IN (<granted record ids>)`, which matches nothing today ONLY
   * because record ids are never reused — an assumption no gate enforces. A
   * new record landing on a recycled id would inherit the dead record's
   * recipients outright (#5103). The rows are also unbounded growth and show
   * up in Setup's Record Shares list pointing at nothing.
   *
   * Set-based and chunked, so its cost tracks the number of ids, not the
   * number of share rows. Returns nothing: counting would need a read the hot
   * delete path should not pay for, and callers that need a count (tests, the
   * sweep) can read the table.
   *
   * [#5190] The mechanism now lives in `record-orphan-cleanup.ts`, shared with
   * `sys_share_link`'s identical cascade. This method keeps the meaning.
   */
  async revokeSharesForDeletedRecords(
    object: string,
    recordIds: readonly string[],
  ): Promise<void> {
    await deleteRowsForDeletedRecords(
      this.engine,
      RECORD_SHARE_SWEEP_SUBJECT.table,
      object,
      recordIds,
    );
  }

  /**
   * [#5103] Revoke every share row whose RECORD no longer exists.
   *
   * The convergence half of the record-delete cascade, and the shape
   * `SharingRuleService.sweepOrphanedRuleGrants` (#4433) established — with a
   * different predicate, which is the whole point: that sweep asks "does the
   * RULE row still exist", so it can never see a manual share, nor a rule
   * grant whose rule is alive and whose record is not. This one asks "does the
   * RECORD still exist", which is the question the invariant is actually made
   * of, and it is source-agnostic.
   *
   * Two callers, one primitive:
   *  - `kernel:bootstrapped`, unscoped — historical orphans from before the
   *    cascade existed, plus anything a crashed hook missed, converge on the
   *    next boot;
   *  - the cascade's unbounded-delete branch, scoped to one object — a bulk
   *    delete whose row set could not be enumerated cannot name the ids to
   *    revoke, but the sweep does not need them: it reads the shares and asks
   *    about each record. This is deliberately NOT the rule path's
   *    "revoke everything on the object and re-grant asynchronously" — that
   *    trade is only available where a reconcile can put the grants back, and
   *    nothing can re-create a manual share.
   *
   * Bounded on both axes: rows are read by keyset page (never `OFFSET`, which
   * skips rows in a walk that deletes as it goes — #4363), the scan stops at
   * `max` and SAYS so, and existence is probed one batched `id IN (…)` per
   * object per page rather than one query per share row.
   *
   * Fails SAFE per object: a probe that throws leaves that object's rows
   * untouched and is reported in `unresolvedObjects`. "Nothing was queried" is
   * not "nothing matched" — deleting on a failed probe would turn a transient
   * driver error into permanent access loss.
   *
   * [#5190] The walk itself lives in `record-orphan-cleanup.ts` — `sys_share_link`
   * runs the identical one, and a second copy is how two sweeps that must agree
   * start disagreeing (chunk size, cap, the failed-probe rule).
   */
  async sweepOrphanedRecordShares(
    options?: OrphanShareSweepOptions,
  ): Promise<OrphanShareSweepResult> {
    return sweepOrphanedRowsByRecordExistence(
      this.engine,
      RECORD_SHARE_SWEEP_SUBJECT,
      options,
      this.logger,
    );
  }

  // ── helpers ──────────────────────────────────────────────────────

  /**
   * [ADR-0057] Resolve the owner-id set for a DEPTH scope. `own`/unset/`org`
   * resolve locally to the caller. HIERARCHY scopes (`unit` / `unit_and_below`
   * / `own_and_reports`) are an ENTERPRISE capability resolved by a pluggable
   * {@link IHierarchyScopeResolver} (`hierarchy-scope-resolver` service, shipped
   * only by `@objectstack/security-enterprise`). The open edition has none, so
   * this fails CLOSED to owner-only — a hierarchy scope NEVER widens without the
   * enterprise resolver (the spec gate also refuses to compile such a grant).
   *
   * [#5859 / #5852] The PRODUCER side of {@link HierarchyScopeContext}: the
   * authoritative `organizationId` is filled from the execution context's
   * active organization ({@link activeOrganizationId}). The read this replaced
   * (`(context as any).organizationId`) named a key NO transport ever sets, so
   * the field was structurally `null` on every real request and every resolver
   * ran with no organization to scope by.
   *
   * `null` is passed through HONESTLY when the caller has no active
   * organization — never papered over with the deprecated `tenantId` alias, and
   * never turned into a blank-string org that would match nothing. What a
   * resolver must then do is ITS contract:
   * `IHierarchyScopeResolver.resolveOwnerIds` — "**Fail CLOSED on a missing
   * organization** … 'no org' is not 'every org'. Return owner-only (or throw,
   * which the sharing layer treats the same way); never widen."
   *
   * On top of that, a WALLED deployment refuses outright: when an organization
   * wall is in force and the authoritative org is missing, the resolver is not
   * consulted at all and the caller falls back to owner-only, loudly — see
   * {@link SharingService.organizationScopeRequired} for why the refusal is
   * posture-scoped rather than unconditional.
   */
  private async resolveOwnerScopeIds(
    context: SharingExecutionContext,
    scope: 'own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org' | undefined,
  ): Promise<string[]> {
    const me = String((context as any).userId);
    if (!scope || scope === 'own' || scope === 'org') return [me];
    const resolver = this.hierarchyResolver?.();
    if (!resolver) return [me];

    const organizationId = activeOrganizationId(context);
    if (organizationId === null && this.organizationScopeRequired()) {
      this.logger?.warn?.(
        '[sharing] hierarchy scope NOT widened: an organization wall is in force but the caller ' +
          'context carries no active organization — failing closed to owner-only. ' +
          '"No org" is not "every org" (IHierarchyScopeResolver.resolveOwnerIds, #5973); ' +
          'the same rule walls Layer 0 (ADR-0095 D1 / ADR-0105 D1).',
        { userId: me, scope },
      );
      return [me];
    }

    try {
      const ids = await resolver.resolveOwnerIds(
        {
          userId: me,
          // AUTHORITATIVE (#5858 / PR #5973). Never `(context as any).organizationId`:
          // no execution context in this repo carries that key.
          organizationId,
          // [#6139] What a `null` organizationId MEANS. Under `single` it is
          // the one implicit tenant and DEPTH resolves normally; under
          // `group`/`isolated` it is a missing constraint and the resolver's
          // fail-closed obligation applies. Without this a spec-conformant
          // resolver had to refuse every `null`, which killed DEPTH on exactly
          // the single-posture deployments ruling C (#5859) requires it to work
          // on. Same value the refusal above keys on — one derivation, so the
          // two cannot disagree.
          posture: this.effectiveTenancyPosture(),
          // The @deprecated compatibility alias, carried through unchanged for
          // resolvers that still read it. It is NOT the authority — a resolver
          // reading it alone is the shape #5858 ruled out.
          tenantId: (context as any).tenantId ?? null,
        },
        scope,
      );
      return Array.isArray(ids) && ids.length > 0 ? ids : [me];
    } catch (err: any) {
      // A throwing resolver is treated exactly like an empty answer (the
      // contract says so) — but say it out loud: a silently-swallowed resolver
      // failure is indistinguishable from "the hierarchy legitimately covers
      // nobody else", which is how #5852 stayed invisible for so long.
      this.logger?.warn?.(
        '[sharing] hierarchy scope resolver failed — falling back to owner-only (fail closed)',
        { userId: me, scope, organizationId, error: err?.message },
      );
      return [me];
    }
  }

  /**
   * [ADR-0105 D1 / #5859] Must a hierarchy scope be refused when the caller
   * carries no authoritative organization?
   *
   * The answer is the deployment's TENANCY POSTURE, not a constant — which is
   * the same answer Layer 0 already gives to the same question
   * (`computeTenantLayer0Filter`, ADR-0095 D1 / ADR-0105 D1):
   *
   *  - `single` → **no**. There is no organization dimension at all; "no org"
   *    there means "the one implicit tenant", not "every org", and hierarchy
   *    DEPTH is pinned working in exactly that shape (the ADR-0057 D1 proofs
   *    boot a pure single-tenant stack on purpose — `@objectstack/verify`'s
   *    harness sets `autoDefaultOrganization: false` to model it). Refusing
   *    here would retire DEPTH for every org-less deployment.
   *  - `group` / `isolated` → **yes**. A wall is in force, so a caller with no
   *    active organization has no tenancy constraint to scope an owner set by,
   *    and widening one would hand out exactly the cross-organization reach
   *    #5852 measured. Layer 0 denies in the same situation; this is that rule,
   *    applied one layer up where the sharing gates read.
   *
   * Fails CLOSED on an unresolvable posture (no `tenancy` probe wired, a
   * throwing probe, or a value outside the vocabulary): an unknown posture is
   * NOT evidence of `single`, and reading it as such would restore the widening
   * on precisely the deployments whose configuration is already suspect.
   */
  private organizationScopeRequired(): boolean {
    return postureEnforcesWall(this.effectiveTenancyPosture());
  }

  /**
   * [#6139] The posture this deployment reports to a
   * {@link IHierarchyScopeResolver} — and the single place the answer is
   * decided.
   *
   * `HierarchyScopeContext.posture` is what lets a resolver tell "single
   * posture, legitimately no organization" apart from "walled posture,
   * organization missing ⇒ fail closed": the two `null`s that were previously
   * indistinguishable on that interface, and that demand opposite answers. The
   * producer already had to resolve the posture for
   * {@link SharingService.organizationScopeRequired}, so reporting it costs
   * nothing new. Deriving it TWICE is what would let the local refusal and the
   * reported posture drift apart, which is why that predicate is now expressed
   * in terms of this one rather than beside it.
   *
   * Fails CLOSED, exactly as the contract requires of a producer: an
   * unresolvable posture (no `tenancy` probe wired, a throwing probe, a value
   * outside the vocabulary) reports the strictest WALLED posture, never
   * `single`. An unknown posture is not evidence of `single`, and reading it as
   * such would restore the #5852 widening on precisely the deployments whose
   * configuration is already suspect.
   */
  private effectiveTenancyPosture(): TenancyPosture {
    let probe: SharingTenancyProbe | null | undefined;
    try {
      probe = this.tenancy?.();
    } catch {
      return 'isolated'; // unresolvable → strictest walled posture
    }
    if (!probe) return 'isolated';
    const posture = normalizeTenancyPosture(probe.posture);
    if (posture) return posture;
    // Pre-ADR-0105 shape: only `isolationActive === false` is a POSITIVE
    // statement that no wall is enforced — the wall-less shape `single` names.
    // `undefined` stays unresolved and keeps the strict answer.
    if (probe.isolationActive === false) return 'single';
    return 'isolated';
  }

  private shouldBypass(object: string, context: SharingExecutionContext): boolean {
    if (context?.isSystem) return true;
    if (this.bypassObjects.has(object)) return true;
    return false;
  }
}
