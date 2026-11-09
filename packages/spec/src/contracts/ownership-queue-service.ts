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
 *
 * A read that FAILS is not absence. What the expander answers then is the
 * caller's to say, per call — see {@link OwnershipQueueFailedReadAnswer}.
 *
 * ## Who is asking: the caller package
 *
 * Two installed packages may each declare a queue of one name (ADR-0150 D1:
 * a queue is addressed by `(package, name)`). A read that names a queue from
 * inside a package — a declared sharing rule's queue recipient — passes that
 * package as `callerPackageId`, and the name resolves from it (ADR-0150 D3):
 * the package's own queue, else the unique holder in its declared dependency
 * closure plus `sys`, else a refusal naming every candidate. Omitted, the read
 * is environment-wide, as it was before the key existed: one declared holder
 * answers, two or more are refused. See {@link OwnershipQueueCallerPackage}.
 */

import type { QueueMemberType } from '../security/queue.zod.js';

/** Kernel service name the ownership-queue service registers under. ⛔ Not `queue` — see the module header. */
export const OWNERSHIP_QUEUE_SERVICE = 'ownership-queue';

/** Which reader an expansion is for — see {@link IOwnershipQueueService.expandMembers}. */
export type QueueExpansionPurpose = 'access' | 'addressing';

/**
 * What a membership read answers when a read behind the queue FAILS — the
 * `onFailedRead` option of {@link IOwnershipQueueService.expandMembers} and
 * {@link IOwnershipQueueService.isMember} (ADR-0142, D2 "Membership", the
 * amended paragraph "An empty expansion is a fact; a failed read is a fault").
 *
 * The tables behind a queue are its own row (`sys_queue`, through which an
 * authored queue resolves), its member rows (`sys_queue_member`), and the
 * member tables a specification reads: `sys_team_member`, `sys_user_position`,
 * `sys_member` (through the position transition limb), `sys_business_unit_member`
 * and the business-unit tree (`sys_business_unit`). A table the composition
 * does not carry is absence, not failure. The activation-ledger read
 * (`sys_metadata_activation`, which says whether a declared queue or a position
 * is switched off) is NOT a failed read in this sense: under either answer its
 * failure reads "switched on", as it did before the key existed. That posture
 * stays by decision: it is the one the sharing-rule service takes for the same
 * ledger on its own `position` recipients, so a queue's position and a rule's
 * position cannot disagree during an outage.
 *
 * - `'nobody'` — the default and the answer every caller had before the key
 *   existed. A failed read is logged at `warn`, and what sat behind it
 *   contributes nobody. The admission consumers take it, because for them
 *   nobody denies: the sitting-record access path (D3), the claim admission
 *   (D4) and the assignment pool (D5).
 * - `'refuse'` — a failed read rejects the call with a failure that names the
 *   read, never `[]`, a partial set or `false`. The recompute consumers take
 *   it, because they turn the member set into routed work or materialised
 *   grants and "nobody" there revokes: the approver slate (D6) and the
 *   sharing-recipient grant recompute (D7). An implementation written before
 *   this key existed ignores it and answers `'nobody'`; the registered one,
 *   `@objectstack/plugin-sharing`'s, honours `'refuse'`.
 *
 * Under either answer an EMPTY queue — every read succeeded and reached
 * nobody — is still `[]`, and a name that resolves nowhere is still `[]` /
 * `false`: those are facts, not faults.
 *
 * ⛔ An axis independent of {@link QueueExpansionPurpose}: which holders an
 * answer keeps and whether a failed read refuses are two questions, and one
 * value never answers both.
 */
export type OwnershipQueueFailedReadAnswer = 'nobody' | 'refuse';

/**
 * The package a queue name is read from — the `callerPackageId` option of
 * {@link IOwnershipQueueService.resolveQueue},
 * {@link IOwnershipQueueService.expandMembers} and
 * {@link IOwnershipQueueService.isMember} (ADR-0150 D3).
 *
 * - A package id: the name resolves from that package — its own declared
 *   queue, else the unique holder in its declared dependency closure plus
 *   `sys`. Two holders in that reach, a holder only outside it, or only an
 *   environment-authored item, is a refusal naming every candidate: the name
 *   resolves nowhere (`null` / `[]` / `false`), and under
 *   `onFailedRead: 'refuse'` the call rejects with that refusal.
 * - Omitted, `null` or `''`: a caller with no package, the environment-wide
 *   read every caller made before the key existed.
 *
 * A name no package declares is an organization's `sys_queue` row under
 * either answer. Optional, so an implementation written before it still
 * satisfies the contract; such an implementation reads environment-wide,
 * which is stricter than D3, never looser: a name two packages declare is
 * refused there even when the caller's closure reaches only one of them.
 */
export type OwnershipQueueCallerPackage = string | null;

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
  /**
   * The queue named `name` in `organizationId`, or `null` when it resolves
   * nowhere. `callerPackageId` names the package the name is read from
   * ({@link OwnershipQueueCallerPackage}); omitted, the read is
   * environment-wide. The options argument is optional, so a two-argument
   * call is today's.
   */
  resolveQueue(
    name: string,
    organizationId: string | null,
    options?: { callerPackageId?: OwnershipQueueCallerPackage },
  ): Promise<ResolvedQueue | null>;

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
   *
   * `onFailedRead` says what the call is owed when a read behind the queue
   * fails: `'nobody'`, the default, or `'refuse'`, under which the call
   * rejects with a failure naming the read. An empty queue is still `[]`.
   * See {@link OwnershipQueueFailedReadAnswer} for the tables and for which
   * ADR-0142 consumer takes which answer; it is independent of `purpose`.
   *
   * `callerPackageId` names the package the name is read from
   * ({@link OwnershipQueueCallerPackage}); omitted, the read is
   * environment-wide. A third axis, independent of the other two.
   */
  expandMembers(
    name: string,
    organizationId: string | null,
    options?: {
      purpose?: QueueExpansionPurpose;
      onFailedRead?: OwnershipQueueFailedReadAnswer;
      callerPackageId?: OwnershipQueueCallerPackage;
    },
  ): Promise<string[]>;

  /**
   * Is `userId` a member of the queue named `name` in `organizationId`?
   * `false` when the name resolves nowhere.
   *
   * `onFailedRead` is {@link expandMembers}' key with the same meaning:
   * under `'nobody'`, the default, a failed read counts as not reaching
   * `userId`; under `'refuse'`, `false` is answered only when every read
   * behind it succeeded, and a failed read rejects with a failure naming it.
   * Under `'refuse'` the registered service reads the queue's own rows
   * (`sys_queue`, `sys_queue_member`) first, and a failure there rejects at
   * once, since without them the queue's member set would be incomplete (a
   * declared queue's own specifications come from the registry, but its
   * authored additions come from `sys_queue_member`). Past them it
   * answers `true` as soon as a read that succeeded reaches `userId`, even
   * beside a failed read, and rejects only when no successful read reaches
   * `userId` and one failed.
   * `callerPackageId` is {@link expandMembers}' key with the same meaning
   * ({@link OwnershipQueueCallerPackage}).
   * The options argument is optional, so a three-argument call is today's.
   */
  isMember(
    userId: string,
    name: string,
    organizationId: string | null,
    options?: { onFailedRead?: OwnershipQueueFailedReadAnswer; callerPackageId?: OwnershipQueueCallerPackage },
  ): Promise<boolean>;

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
