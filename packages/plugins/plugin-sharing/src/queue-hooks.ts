// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D1/D2/D7] The hooks the authored queue tables carry.
 *
 * ## The name guard — one namespace
 *
 * A queue is referenced everywhere by its machine name, declared or authored,
 * resolved registry-first. So a `sys_queue` row may not take a declared
 * queue's name — it would be a second queue under a name that already answers
 * — and a name must be snake_case, because the `queue` column, an assignment
 * rule's target, an approver's value and a sharing recipient's value all carry
 * it verbatim. Authoring a queue in Setup is a plain data insert, so the guard
 * is a hook on the table rather than a check inside a service method nobody
 * calls. A declaration that arrives OVER an existing row (a package installed
 * after the organization authored the name) is not a write this guard sees: it
 * is reported at boot by {@link reportShadowedAuthoredQueues}, loudly, and the
 * declared queue answers for the name.
 *
 * ## The queue-recipient recompute
 *
 * A sharing rule whose recipient is a queue materialises its grants per member
 * (ADR-0142 D7), so a write that changes who is in the queue must move them.
 * Three write paths can:
 *
 * | written table                       | module                                |
 * |-------------------------------------|---------------------------------------|
 * | `sys_queue_member`, `sys_queue`     | this one — the queue's own rows       |
 * | `sys_user_position`, `sys_team_member` | `recipient-membership-recompute.ts`, which looks through queues naming the written position or team |
 * | `sys_business_unit(_member)`        | `bu-tree-recompute.ts`, for a queue with a business-unit member |
 *
 * A member row names a SET of people, not one user, so this module recomputes
 * the way the business-unit module does: the revocation half synchronously
 * (`revokeRuleGrantsForRetiredRecipients`) and the re-grant half on the shared
 * re-grant queue, coalesced per rule. ⛔ The recipient never confers
 * sitting-record access — that is the access path's (`SharingService`), read
 * per request, and needs no recompute at all.
 */

import type { SharingRuleRow } from '@objectstack/spec/contracts';
import type { FieldErrorCode } from '@objectstack/spec/api';
import type { OptionalSharingLogger } from './logger-shapes.js';
import { ruleRegrantQueue } from './rule-hooks.js';
import { METADATA_ACTIVATION_TABLE } from '@objectstack/core';
import {
  QUEUE_ACTIVATION_TYPE,
  QUEUE_MEMBER_OBJECT,
  QUEUE_OBJECT,
  type OwnershipQueueService,
} from './ownership-queue-service.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** Package id of the name / row guards. */
export const QUEUE_GUARD_PACKAGE = 'plugin-sharing:queue-guard';
/** Package id of the queue-recipient recompute hooks. */
export const QUEUE_RECIPIENT_RECOMPUTE_PACKAGE = 'plugin-sharing:queue-recipient-recompute';

const QUEUE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

interface MinimalEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => any | Promise<any>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ): void;
  unregisterHooksByPackage(packageId: string): number;
  find?(object: string, options?: any): Promise<any[]>;
}

/**
 * Field-level refusal for a queue row, on the data-API path. The same shape
 * `SharingCriteriaValidationError` uses (`code: 'VALIDATION_FAILED'`, a
 * `fields[]` entry), so REST answers it as a validation failure naming the
 * field. The entry's code is a member of the closed field-level catalog
 * (`FieldErrorCode`).
 */
export class QueueValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly fields: Array<{ field: string; code: FieldErrorCode; message: string }>;
  constructor(issue: { field: string; code: FieldErrorCode; message: string }) {
    super(issue.message);
    this.name = 'ValidationError';
    this.fields = [issue];
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function present(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s === '' ? null : s;
}

/** Bind the `sys_queue` name guard and the `sys_queue_member` queue-name guard. */
export function bindQueueGuards(engine: MinimalEngine, queues: Pick<OwnershipQueueService, 'isDeclaredQueueName'>): void {
  if (typeof engine.registerHook !== 'function') return;
  if (typeof engine.unregisterHooksByPackage === 'function') engine.unregisterHooksByPackage(QUEUE_GUARD_PACKAGE);

  const queueRowGuard = (insert: boolean) => (ctx: any) => {
    const data = ctx?.input?.data;
    if (!isRecord(data)) return;
    if (!insert && !Object.prototype.hasOwnProperty.call(data, 'name')) return;
    const name = data.name;
    if (typeof name !== 'string' || !QUEUE_NAME_PATTERN.test(name)) {
      throw new QueueValidationError({
        field: 'name',
        code: 'invalid_format',
        message: `A queue name is a machine name — lowercase letters, digits and underscores, starting with a letter (got ${JSON.stringify(name)}). Records, assignment rules, approvals and sharing rules refer to the queue by it.`,
      });
    }
    if (queues.isDeclaredQueueName(name)) {
      throw new QueueValidationError({
        field: 'name',
        code: 'invalid_value',
        message:
          `'${name}' is the name of a queue an installed app declares, and one name means one queue. ` +
          `To staff that queue, add members to it under its name; for a queue of your own, choose another name.`,
      });
    }
  };

  const memberRowGuard = (insert: boolean) => (ctx: any) => {
    const data = ctx?.input?.data;
    if (!isRecord(data)) return;
    if (!insert && !Object.prototype.hasOwnProperty.call(data, 'queue')) return;
    const queue = data.queue;
    if (typeof queue !== 'string' || !QUEUE_NAME_PATTERN.test(queue)) {
      throw new QueueValidationError({
        field: 'queue',
        code: 'invalid_format',
        message: `Name the queue by its machine name — lowercase letters, digits and underscores (got ${JSON.stringify(queue)}).`,
      });
    }
  };

  const opts = (object: string) => ({ object, packageId: QUEUE_GUARD_PACKAGE, priority: 100 });
  engine.registerHook('beforeInsert', queueRowGuard(true), opts(QUEUE_OBJECT));
  engine.registerHook('beforeUpdate', queueRowGuard(false), opts(QUEUE_OBJECT));
  engine.registerHook('beforeInsert', memberRowGuard(true), opts(QUEUE_MEMBER_OBJECT));
  engine.registerHook('beforeUpdate', memberRowGuard(false), opts(QUEUE_MEMBER_OBJECT));
}

/**
 * Report, at boot, every `sys_queue` row whose name a package now declares.
 * The declared queue answers for the name (registry-first), so the row is
 * shadowed: its members still join the declared queue, its label does not.
 * Logged at `error`, naming the row's organization, because an administrator
 * has to act — rename the row — and nothing else will say so.
 */
export async function reportShadowedAuthoredQueues(
  engine: MinimalEngine,
  queues: Pick<OwnershipQueueService, 'isDeclaredQueueName'>,
  logger?: {
    warn: (msg: string, meta?: Record<string, any>) => void;
    error?: (msg: string, meta?: Record<string, any>) => void;
  },
): Promise<void> {
  if (typeof engine.find !== 'function') return;
  let rows: any[] = [];
  try {
    rows = await engine.find(QUEUE_OBJECT, { fields: ['name', 'organization_id'], limit: 10000, context: SYSTEM_CTX });
  } catch {
    return; // no table yet — nothing authored to shadow
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = present(row?.name);
    if (!name || !queues.isDeclaredQueueName(name)) continue;
    const msg =
      `[queue] an organization's queue '${name}' is shadowed by a queue an installed app declares under the same ` +
      'name — the declared queue answers for it. Rename the organization\'s queue to keep it.';
    const meta = { queue: name, organization: present(row?.organization_id) };
    if (logger?.error) logger.error(msg, meta);
    else logger?.warn(msg, meta);
  }
}

/** The slice of `SharingRuleService` the recompute drives. */
export interface QueueRecipientRuleService {
  listRules(filter: { object?: string; activeOnly?: boolean }, context: any): Promise<SharingRuleRow[]>;
  revokeRuleGrantsForRetiredRecipients(rule: SharingRuleRow): Promise<number>;
  evaluateRule(idOrName: string, context: any): Promise<unknown>;
}

/** Rules with a queue-membership re-grant queued and not yet started. */
const pendingQueueRegrants = new Set<string>();

/** Test seam: are any coalesced queue re-grants outstanding? */
export function pendingQueueRecipientRegrants(): number {
  return pendingQueueRegrants.size;
}

/**
 * Recompute the queue-recipient rules naming `queueNames`: revoke from the
 * members a rule no longer reaches now, queue the re-grant. Exported for the
 * two other recompute modules' look-through.
 */
export async function recomputeQueueRecipientRules(
  service: QueueRecipientRuleService,
  queueNames: ReadonlySet<string>,
  logger: OptionalSharingLogger | undefined,
  source: { object: string; event: string },
): Promise<void> {
  if (queueNames.size === 0) return;
  const rules = await service.listRules({ activeOnly: true }, SYSTEM_CTX as any);
  const affected = (rules ?? []).filter((r) => r.recipient_type === 'queue' && queueNames.has(String(r.recipient_id)));
  for (const rule of affected) {
    try {
      const retired = await service.revokeRuleGrantsForRetiredRecipients(rule);
      if (retired > 0) {
        logger?.info?.('[sharing-rule] queue membership changed — withdrew grants from members the rule no longer reaches', {
          rule: rule.name ?? rule.id, ...source, recipientsRetired: retired,
        });
      }
    } catch (err: any) {
      logger?.warn?.(
        '[sharing-rule] queue-membership revocation failed — this rule may still grant access to former members ' +
          'until the next reconcile',
        { rule: rule.name ?? rule.id, ...source, error: err?.message },
      );
    }
    const ruleId = String(rule.id);
    if (pendingQueueRegrants.has(ruleId)) continue;
    pendingQueueRegrants.add(ruleId);
    ruleRegrantQueue.enqueue(
      async () => {
        pendingQueueRegrants.delete(ruleId);
        await service.evaluateRule(ruleId, SYSTEM_CTX as any);
      },
      (err: any) => {
        pendingQueueRegrants.delete(ruleId);
        logger?.warn?.(
          '[sharing-rule] queue-membership re-grant failed — new members stay without the rule\'s access until the ' +
            'next reconcile (any sharing-rule write, or a restart)',
          { rule: rule.name ?? ruleId, error: err?.message },
        );
      },
    );
  }
}

/** The queue names a `sys_queue` / `sys_queue_member` hook context touches, before and after. */
function queueNamesOf(object: string, hookCtx: any): Set<string> {
  const column = object === QUEUE_OBJECT ? 'name' : 'queue';
  const out = new Set<string>();
  for (const row of [hookCtx?.previous, hookCtx?.result, hookCtx?.input?.data]) {
    if (!isRecord(row)) continue;
    const name = present(row[column]);
    if (name) out.add(name);
  }
  return out;
}

/** Bind the recompute on the queue's own tables and on the activation ledger's `queue` rows. */
export function bindQueueRecipientRecompute(
  engine: MinimalEngine,
  service: QueueRecipientRuleService,
  logger?: OptionalSharingLogger,
): void {
  if (typeof engine.registerHook !== 'function') return;
  if (typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(QUEUE_RECIPIENT_RECOMPUTE_PACKAGE);
  }
  for (const object of [QUEUE_OBJECT, QUEUE_MEMBER_OBJECT]) {
    for (const event of ['afterInsert', 'afterUpdate', 'afterDelete']) {
      engine.registerHook(
        event,
        async (hookCtx: any) => {
          try {
            await recomputeQueueRecipientRules(service, queueNamesOf(object, hookCtx), logger, { object, event });
          } catch (err: any) {
            // A hook must not fail an operator's write.
            logger?.warn?.('[sharing-rule] queue-recipient recompute failed', { object, event, error: err?.message });
          }
        },
        { object, packageId: QUEUE_RECIPIENT_RECOMPUTE_PACKAGE, priority: 190 },
      );
    }
  }
  // A declared queue switched on or off in the activation ledger changes whom
  // it reaches (off: nobody), so the queue-recipient rules naming it are
  // recomputed on the ledger write. Not caught here: as the declared-sharing-
  // rule switch's reconcile, a failure is the write's, so the activation door
  // never answers 200 over a switched-off queue's grants still standing.
  for (const event of ['afterInsert', 'afterUpdate', 'afterDelete']) {
    engine.registerHook(
      event,
      async (hookCtx: any) => {
        // The update patch carries `{ id, active, … }`; type and name come from
        // the pre-image, an insert's from the row itself.
        const row = { ...(hookCtx?.previous ?? {}), ...(hookCtx?.result ?? hookCtx?.input?.data ?? {}) };
        if (row.metadata_type !== QUEUE_ACTIVATION_TYPE) return;
        const name = present(row.name);
        if (!name) return;
        await recomputeQueueRecipientRules(service, new Set([name]), logger, { object: METADATA_ACTIVATION_TABLE, event });
      },
      { object: METADATA_ACTIVATION_TABLE, packageId: QUEUE_RECIPIENT_RECOMPUTE_PACKAGE, priority: 190 },
    );
  }
}
