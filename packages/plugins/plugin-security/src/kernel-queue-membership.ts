// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D3] `current_user.queues` — the machine names of the ownership
 * queues the caller belongs to in the active organization, resolved by the
 * platform and by nothing else.
 *
 * ## One producer
 *
 * `queues` is a {@link RESERVED_RLS_MEMBERSHIP_KEYS} key: the registered
 * `rls-membership-resolver` is screened off it, the compiler's merge refuses it
 * from any `rlsMembership` bag, and `membershipKeys` may not declare it. The
 * value comes from here alone, and here it comes from the ownership-queue
 * service's `queuesOf` — the same membership answer (`plugin-sharing`'s one
 * expander, `access` purpose) the claim gate's `isMember` and the sharing
 * owner match read, so an RLS policy and the claim gate cannot disagree about
 * who sits in a queue.
 *
 * ## Where the value lives
 *
 * On the execution context, under a module-private symbol, together with the
 * principal and organization it was resolved for. A caller cannot forge it (no
 * string key reaches it, and `context.queues` is never read), and a context
 * copied for ANOTHER principal (a delegator's, say) does not carry the first
 * one's queues: {@link kernelQueuesOf} answers only for the identity the set
 * was resolved for.
 *
 * ## Lazily, and fail closed
 *
 * Resolved once per request, and only when a policy about to compile reads the
 * key (`stageRlsMembership`): a request that reads none pays nothing. With no
 * signed-in user, no ownership-queue service, or a `queuesOf` that throws, the
 * key stays unresolved, so every policy reading it drops on the compiler's
 * existing path and fails closed. A caller in no queue resolves to `[]`, which
 * matches nothing.
 */

import type { IOwnershipQueueService } from '@objectstack/spec/contracts';

/** The members of the security plugin the kernel queue read uses. */
export interface KernelQueueStagingHost {
  readonly logger: { warn?: (message: string, meta?: Record<string, unknown>) => void } | undefined;
  /** The ownership-queue service, or `null` when no plugin registers it. */
  ownershipQueueMembership(): Pick<IOwnershipQueueService, 'queuesOf'> | null;
}

interface StagedQueues {
  readonly userId: string;
  readonly organizationId: string | null;
  readonly queues: readonly string[];
}

const KERNEL_QUEUES = Symbol('objectstack.security.kernelQueues');

/** Per execution context: the one resolution in flight or settled. */
const PENDING = new WeakMap<object, Promise<void>>();

function organizationOf(context: any): string | null {
  return context?.tenantId ? String(context.tenantId) : null;
}

/**
 * The kernel's `current_user.queues` for this context, or `undefined` when it
 * was not resolved for this context's principal and organization.
 */
export function kernelQueuesOf(context: unknown): string[] | undefined {
  if (!context || typeof context !== 'object') return undefined;
  const staged = (context as Record<symbol, StagedQueues | undefined>)[KERNEL_QUEUES];
  if (!staged) return undefined;
  const userId = (context as { userId?: unknown }).userId;
  if (userId == null || staged.userId !== String(userId)) return undefined;
  if (staged.organizationId !== organizationOf(context)) return undefined;
  return [...staged.queues];
}

/** Resolve `current_user.queues` onto `context`, once per request. */
export async function stageKernelQueues(host: KernelQueueStagingHost, context: any): Promise<void> {
  if (!context || typeof context !== 'object' || context.userId == null) return;
  if (kernelQueuesOf(context) !== undefined) return;
  let pending = PENDING.get(context);
  if (!pending) {
    pending = resolveOnto(host, context);
    PENDING.set(context, pending);
  }
  await pending;
}

async function resolveOnto(host: KernelQueueStagingHost, context: any): Promise<void> {
  const service = host.ownershipQueueMembership();
  if (!service) return;
  const userId = String(context.userId);
  const organizationId = organizationOf(context);
  let names: unknown;
  try {
    names = await service.queuesOf(userId, organizationId);
  } catch (e) {
    host.logger?.warn?.(
      '[security/ADR-0142] queue membership could not be resolved — policies reading current_user.queues ' +
        'fail closed for this request',
      { userId, error: (e as Error)?.message },
    );
    return;
  }
  if (!Array.isArray(names)) return;
  const staged: StagedQueues = {
    userId,
    organizationId,
    queues: Object.freeze(names.filter((n): n is string => typeof n === 'string')),
  };
  try {
    context[KERNEL_QUEUES] = staged;
  } catch {
    // A frozen context keeps the key unresolved: fail closed.
  }
}
