// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/ownership-queue-service
 *
 * [ADR-0142 D1/D2] The ownership-queue service: resolve a queue by name in an
 * organization, expand its members, test one user's membership, list the
 * queues a user belongs to. `@objectstack/plugin-sharing` implements it, beside
 * the expanders and the owner match it already owns.
 *
 * ## Why the service is not named `queue`
 *
 * The kernel service name `queue` belongs to the JOB queue
 * (`@objectstack/service-queue`, the core in-memory fallback, and every
 * `getService('queue')` caller that enqueues durable work). An ownership queue
 * is a queue of PEOPLE that records sit in — a different noun, as `sys_queue`
 * and `sys_job_queue` are different tables. The service therefore registers
 * under {@link OWNERSHIP_QUEUE_SERVICE}, and every probe for "is a queue
 * service present" — the engine's boot refusal for a stack that declares
 * `queues` or `assignmentRules` included — tests that name, never `queue`: a
 * composition that loads the job queue and no ownership-queue service would
 * otherwise pass the check with nothing behind its declared queues.
 *
 * ## One expander for every consumer
 *
 * {@link IOwnershipQueueService.expandMembers} is the ONE function the five
 * consumers read: the sitting-record access path, the claim admission, the
 * assignment pool, the approver slate and the sharing recipient. Its answer is
 * de-duplicated and ordered by user id ascending, so round-robin and the
 * least-loaded tie-break see one stable order wherever they run.
 *
 * ## Absence is not a fault, and never a grant
 *
 * A name that resolves nowhere answers `null` / `[]` / `false`; an empty queue
 * answers `[]`. Each consumer says what it does with that (ADR-0142 D5, D6,
 * D7) — and every queue-dependent ADMISSION fails closed when the service is
 * not registered at all.
 */

import type { QueueMemberType } from '../security/queue.zod.js';

/** Kernel service name the ownership-queue service registers under. ⛔ Not `queue` — see the module header. */
export const OWNERSHIP_QUEUE_SERVICE = 'ownership-queue';

/** Which reader an expansion is for — see {@link IOwnershipQueueService.expandMembers}. */
export type QueueExpansionPurpose = 'access' | 'addressing';

/** One member specification: a recipient kind and the value that kind takes in a sharing rule. */
export interface QueueMemberSpec {
  type: QueueMemberType;
  value: string;
}

/** A queue as the service resolves it in one organization. */
export interface ResolvedQueue {
  /** The machine name every reference uses. */
  name: string;
  label: string;
  /**
   * `declared` — a stack's `queues` entry, served from the registry.
   * `authored` — an organization's `sys_queue` row.
   */
  source: 'declared' | 'authored';
  /** The organization an authored queue belongs to; `null` for a declared queue (it is served to every organization). */
  organizationId: string | null;
  /** The member specifications, as declared or authored — not yet expanded. */
  members: QueueMemberSpec[];
  /** The package that ships a declared queue, when it names one. */
  packageId?: string;
}

/**
 * The ownership-queue service. Every method resolves the queue in
 * `organizationId` — the organization of the request or of the row — with
 * declared queues first and the organization's `sys_queue` rows second
 * (ADR-0131 D4's registry-first rule). A declared queue switched off in the
 * activation ledger resolves nowhere.
 */
export interface IOwnershipQueueService {
  /** The queue named `name` in `organizationId`, or `null` when it resolves nowhere. */
  resolveQueue(name: string, organizationId: string | null): Promise<ResolvedQueue | null>;

  /**
   * The queue's members in `organizationId`: the union of each member
   * specification's expansion, de-duplicated and ordered by user id
   * ascending. `[]` for an empty queue and for a name that resolves nowhere.
   *
   * `purpose` carries the platform's split between the two kinds of reader
   * (maintainer ruling 2026-08-15: "Access-conferring paths filter
   * deactivated positions; addressing paths do not"). `'access'`, the
   * default, drops the holders of a position the activation ledger switches
   * off — the sitting-record path, the claim, the assignment pool and the
   * sharing recipient all confer access. `'addressing'` keeps them — the
   * approver slate routes work, and dropping holders there is fail-open.
   */
  expandMembers(
    name: string,
    organizationId: string | null,
    options?: { purpose?: QueueExpansionPurpose },
  ): Promise<string[]>;

  /** Is `userId` a member of the queue named `name` in `organizationId`? `false` when the name resolves nowhere. */
  isMember(userId: string, name: string, organizationId: string | null): Promise<boolean>;

  /**
   * The machine names of every queue `userId` is a member of in
   * `organizationId` — the set the sitting-record access path reads as
   * `current_user.queues`. Ordered by name.
   */
  queuesOf(userId: string, organizationId: string | null): Promise<string[]>;

  /**
   * Does `organizationId` have at least one ownership queue? `true` exactly
   * when some name would resolve there through {@link resolveQueue}: a
   * declared queue the activation ledger leaves on, or an organization's
   * `sys_queue` row that does not sit under a declared queue's name.
   *
   * The one answer `GET /auth/me/permissions` carries as `hasAnyQueue`
   * (`MePermissionsAuthenticatedResponseSchema`, `@objectstack/spec/api`), so
   * a member who may not read `sys_queue` can still tell whether a queue
   * filter can ever return a row. It discloses no name and no count.
   *
   * Optional, as {@link declaredQueueNamed} is, so an implementation written
   * before it still satisfies the contract: the route answers `false` when the
   * registered service does not carry it.
   */
  hasAnyQueue?(organizationId: string | null): Promise<boolean>;

  /**
   * The declared queue named `name`, whether or not the activation ledger
   * switches it off — `null` when no package declares it. Optional: the
   * activation door looks a `queue` row's subject up through it (a queue
   * switched off must stay addressable to be switched back on), and answers
   * 503 when the registered service does not carry it.
   */
  declaredQueueNamed?(name: string): Promise<{ name: string; packageId?: string } | null>;
}
