// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ExecutionContext } from '@objectstack/spec/kernel';
import { actingAddresses } from './approver-address.js';

/**
 * [#26180 · ruling 6429330267, letter A] The records a caller may READ because
 * an approval step waits on them.
 *
 * While an approval request is pending, each resolved PERSON on the current
 * step's slate, and the override holder, may read the one record the request is
 * about. The grant is derived from state this plugin already keeps — the slate
 * the open path resolved, mirrored into `sys_approval_approver` — so there is
 * no key to declare and nothing for an app to write. plugin-sharing ORs the
 * record ids this answers into its read filter beside the caller's record
 * shares, so every read door that composes the sharing filter serves them, and
 * `explain` names the request.
 *
 * ## Who
 *
 * - A PERSON on the slate: a slot naming the caller's user id or the email
 *   their own account carries — the two addresses `slateNamesAPerson`
 *   (`approver-address.ts`) calls a person. A `position:<p>` / `team:<t>`
 *   literal is an approver target that resolved to nobody when the step opened;
 *   it names no person, so it grants no one a read.
 * - The override holder (`isOverrideActor`, #3424): the administrator who may
 *   decide any pending request of their organization, so may read what it is
 *   about.
 *
 * ## Bounds
 *
 * - Read only: the answer feeds the READ filter alone. The write gates read
 *   `sys_record_share` access levels and never this.
 * - Only while pending: the index holds a request's rows only while it is
 *   pending (`syncApproverIndex` clears them when it leaves `pending`, and
 *   rewrites them on every slate change), and the request row is re-read with
 *   `status: 'pending'`. A step that resolves stops granting at the next read.
 * - Never across organizations (ADR-0105): both reads are fenced to the
 *   caller's active organization — an org-less caller reaches only org-less
 *   requests — and the platform admin's override, which crosses the wall to
 *   DECIDE, does not cross it to READ.
 *
 * ## Cost
 *
 * The read path is hot, so the answer is memoized per execution context (the
 * object the transport builds once per request, as plugin-security's
 * permission-set memo keys on) and per engine write epoch: any write through
 * the engine — a decision among them — retires it, and nothing outlives the
 * request. A person's first read costs one `sys_user` read for the account
 * email and one indexed `sys_approval_approver` read; a caller on no slate
 * stops there, for every object of the request. A caller on a slate pays one
 * `sys_approval_request` read per object. The override holder pays one
 * `sys_approval_request` read per object. Never a read per row.
 *
 * A failed read is not memoized and is rethrown: the caller (plugin-sharing)
 * fails closed and grants nothing.
 */

/** The `ApprovalEngine` member this module reads. */
export interface PendingApproverReadEngine {
  find(object: string, options?: any): Promise<any[]>;
}

/** What the service hands this module: its engine and two of its own answers. */
export interface PendingApproverReadDeps {
  engine: PendingApproverReadEngine;
  /** `ApprovalService.isOverrideActor`, asked with the caller's active organization. */
  isOverrideActor(context: ExecutionContext, organizationId: string | null): boolean;
  /** The email the caller's own account carries (`ApprovalService.callerAccountEmail`). */
  accountEmail(userId: string): Promise<string | null>;
  logger?: { warn?: (msg: string, meta?: unknown) => void };
}

/** record id → the pending request ids that grant it, in the order read. */
export type PendingApproverReadGrants = ReadonlyMap<string, readonly string[]>;

const SYSTEM_CTX: ExecutionContext = { isSystem: true, positions: [], permissions: [] };

/** The window of each probe; a pending queue lives far below it. */
export const PENDING_APPROVER_READ_CAP = 10_000;

const NONE: PendingApproverReadGrants = new Map();

interface MemoEntry {
  epoch: number;
  /** The pending request ids naming the caller as a person; `null` for the override holder. */
  slate?: Promise<readonly string[] | null>;
  byObject: Map<string, Promise<PendingApproverReadGrants>>;
}

/** The caller's active organization, read as the service reads it everywhere else. */
function activeOrganization(context: ExecutionContext): string | null {
  const org = (context as any)?.organizationId ?? context?.tenantId ?? null;
  return org == null || String(org) === '' ? null : String(org);
}

/** The organization fence both probes carry: the caller's organization, or org-less rows only. */
function organizationFence(org: string | null): Record<string, unknown> {
  return { organization_id: org ?? { $null: true } };
}

/** The engine's write epoch when it exposes one; without it nothing is reused. */
function writeEpochOf(engine: unknown): number | undefined {
  const current = (engine as { writeEpoch?: { current?: unknown } } | null)?.writeEpoch?.current;
  return typeof current === 'number' ? current : undefined;
}

export class PendingApproverReadGrantSource {
  private readonly memo = new WeakMap<object, MemoEntry>();

  constructor(private readonly deps: PendingApproverReadDeps) {}

  /** The record ids of `object` the caller may read through a pending approval step. */
  async forObject(object: string, context: ExecutionContext): Promise<PendingApproverReadGrants> {
    if (!object || !context || context.isSystem) return NONE;
    const userId = context.userId != null ? String(context.userId) : '';
    if (!userId) return NONE;
    const entry = this.entryFor(context);
    if (!entry) return this.compute(object, context, undefined);
    const cached = entry.byObject.get(object);
    if (cached) return cached;
    const pending = this.compute(object, context, entry);
    entry.byObject.set(object, pending);
    // A failed read is never reused: the next read asks again.
    pending.catch(() => {
      if (entry.byObject.get(object) === pending) entry.byObject.delete(object);
    });
    return pending;
  }

  /** The memo entry for this context at the current epoch, or `undefined` when nothing may be reused. */
  private entryFor(context: ExecutionContext): MemoEntry | undefined {
    const epoch = writeEpochOf(this.deps.engine);
    if (epoch === undefined || typeof context !== 'object') return undefined;
    const held = this.memo.get(context);
    if (held && held.epoch === epoch) return held;
    const fresh: MemoEntry = { epoch, byObject: new Map() };
    this.memo.set(context, fresh);
    return fresh;
  }

  private async compute(
    object: string,
    context: ExecutionContext,
    entry: MemoEntry | undefined,
  ): Promise<PendingApproverReadGrants> {
    const org = activeOrganization(context);
    let slate: readonly string[] | null;
    if (entry) {
      if (!entry.slate) {
        entry.slate = this.slateRequestIds(context, org);
        const held = entry.slate;
        held.catch(() => {
          if (entry.slate === held) entry.slate = undefined;
        });
      }
      slate = await entry.slate;
    } else {
      slate = await this.slateRequestIds(context, org);
    }
    if (slate !== null && slate.length === 0) return NONE;

    const where: Record<string, unknown> = { object_name: object, status: 'pending', ...organizationFence(org) };
    if (slate !== null) where.id = slate.length === 1 ? slate[0] : { $in: [...slate] };
    const rows = await this.deps.engine.find('sys_approval_request', {
      where,
      fields: ['id', 'record_id'],
      limit: PENDING_APPROVER_READ_CAP,
      context: SYSTEM_CTX,
    });
    const list: any[] = Array.isArray(rows) ? rows : [];
    this.warnOnWindow(list.length, 'sys_approval_request');
    const grants = new Map<string, string[]>();
    for (const row of list) {
      if (row?.record_id == null || row?.id == null) continue;
      const recordId = String(row.record_id);
      const requests = grants.get(recordId) ?? [];
      requests.push(String(row.id));
      grants.set(recordId, requests);
    }
    return grants;
  }

  /**
   * The pending requests whose slate names the caller as a person, or `null`
   * for the override holder, whose reach is every pending request of their
   * organization. One indexed read, the same one "My Pending" makes, on the
   * person addresses only.
   */
  private async slateRequestIds(context: ExecutionContext, org: string | null): Promise<readonly string[] | null> {
    if (this.deps.isOverrideActor(context, org)) return null;
    const userId = String(context.userId);
    // The caller's acting addresses with no positions: the user id and the
    // account email, the two `slateNamesAPerson` calls a person.
    const persons = actingAddresses({ userId, email: await this.deps.accountEmail(userId), positions: [] });
    const rows = await this.deps.engine.find('sys_approval_approver', {
      where: { approver: persons.length === 1 ? persons[0] : { $in: persons }, ...organizationFence(org) },
      fields: ['request_id'],
      limit: PENDING_APPROVER_READ_CAP,
      context: SYSTEM_CTX,
    });
    const list: any[] = Array.isArray(rows) ? rows : [];
    this.warnOnWindow(list.length, 'sys_approval_approver');
    return [...new Set(list.map((r) => String(r?.request_id ?? '')).filter(Boolean))];
  }

  private warnOnWindow(count: number, table: string): void {
    if (count < PENDING_APPROVER_READ_CAP) return;
    this.deps.logger?.warn?.(
      `[approvals] the pending approver's record-read probe on '${table}' hit its window — some records a pending `
        + 'approver may read are not granted on this read',
      { cap: PENDING_APPROVER_READ_CAP, table },
    );
  }
}
