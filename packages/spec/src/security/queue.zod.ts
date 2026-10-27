// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { strictObject } from '../shared/strict-object';
import { lazySchema } from '../shared/lazy-schema';
import { ShareRecipientType } from './sharing.zod';

/**
 * [ADR-0142 D2] The recipient kinds a queue's members are written with: the
 * five SET-VALUED members of {@link ShareRecipientType}, derived from it so the
 * two vocabularies cannot drift. `field` is excluded because it is
 * record-relative and names no set of people; `queue` is excluded because a
 * queue does not contain queues.
 *
 * Each kind takes the `value` it takes in a sharing rule — a user id, a team
 * id, a position machine name, a business-unit id — and is expanded by the
 * expanders the sharing engine already runs, scoped to the queue's
 * organization. There is no new principal vocabulary.
 */
export const QueueMemberType = ShareRecipientType.exclude(['field', 'queue']);
export type QueueMemberType = z.input<typeof QueueMemberType>;

/**
 * The one sentence a declared queue refuses a non-position member with. Its
 * own constant because the refusal names the place the member belongs.
 */
const DECLARED_QUEUE_MEMBER_TYPE_REFUSAL =
  "A declared queue's members name positions only (`type: 'position'`, `value: '<position name>'`). " +
  'A position is a catalog item a package can know by name; a user, a team or a business unit is an ' +
  "organization's own row, so it joins a queue through that organization's `sys_queue_member` rows in Setup.";

/**
 * [ADR-0142 D1, merge question 18] One member of a DECLARED queue: a position,
 * named by its machine name. Users, teams and business units join a queue
 * through the organization's authored `sys_queue_member` rows, where any
 * {@link QueueMemberType} is admitted.
 */
export const DeclaredQueueMemberSchema = strictObject(
  {
    surface: 'this queue member',
    aliases: { id: 'value', position: 'value', name: 'value' },
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
  },
  {
    type: z.literal('position', { error: () => DECLARED_QUEUE_MEMBER_TYPE_REFUSAL })
      .describe("The member kind. A declared queue names positions only ('position')."),
    value: SnakeCaseIdentifierSchema.describe('The position machine name whose holders are members of the queue'),
  },
);

/**
 * Queue — a named set of people that records can sit in (ADR-0142 D1).
 *
 * A record of an `ownership: 'user'` object SITS IN a queue when its
 * `owner_id` is empty and its system-managed `queue` column names the queue.
 * The queue's members read and edit what sits in it, any one of them takes a
 * record by claiming it (an update of `owner_id` to themselves, adjudicated by
 * the ownership-transfer gate), and an assignment rule can route inserted rows
 * into it.
 *
 * A queue has the two sources a sharing rule has (ADR-0131 D6, regime C):
 *
 * - **Declared** — this schema, the stack's `queues`. Read from the registry
 *   on every use and never copied into rows; switched off through the
 *   activation ledger (`sys_metadata_activation`, `metadata_type: 'queue'`).
 *   Its members name positions only (see {@link DeclaredQueueMemberSchema}).
 * - **Authored** — an organization's `sys_queue` row with its
 *   `sys_queue_member` rows, any of the five member kinds.
 *
 * One namespace, by name: a `sys_queue` row may not take a declared queue's
 * name. The word `queue` here is a queue of PEOPLE; the job-queue service and
 * its `sys_job_queue` table are a different noun.
 */
export const QueueSchema = lazySchema(() => strictObject(
  {
    surface: 'this queue',
    aliases: { title: 'label', users: 'members', recipients: 'members' },
    guidance: {
      organization_id:
        '`organization_id` is not a queue field — a declared queue is a catalog item served to every ' +
        "organization; an organization's own queue is a `sys_queue` row it authors in Setup.",
      strategy:
        '`strategy` is not a queue field — how a record is chosen for a member is the assignment rule\'s ' +
        'declaration (`assignmentRules[].entries[].strategy`), so one queue can be routed into differently ' +
        'per object.',
    },
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
  },
  {
    name: SnakeCaseIdentifierSchema.describe(
      'Queue machine name (lowercase snake_case); the one name the `queue` column, an assignment rule, an ' +
      'approver and a sharing recipient reference it by',
    ),
    label: z.string().describe('Display label (e.g. Support Intake)'),
    description: z.string().optional().describe('Administrative notes'),
    members: z.array(DeclaredQueueMemberSchema).default([]).describe(
      'The positions whose holders are members, resolved in the organization a record or request belongs to. ' +
      'An empty list is a queue nobody staffs yet: records still sit in it.',
    ),

    // ADR-0010 — runtime protection envelope (internal — set by loader). The
    // shape is strict, and both metadata load paths stamp this envelope on
    // every item, so it is declared here for the reason `sharing.zod.ts`
    // gives for its own spread.
    ...MetadataProtectionFields,
  },
));

export type Queue = z.input<typeof QueueSchema>;
/** Post-parse shape of {@link Queue} — defaults applied (ADR-0122). */
export type QueueParsed = z.infer<typeof QueueSchema>;
export type DeclaredQueueMember = z.input<typeof DeclaredQueueMemberSchema>;

/**
 * Type-safe factory for a declared queue. Validates at authoring time via
 * `.parse()`.
 */
export function defineQueue(config: z.input<typeof QueueSchema>): QueueParsed {
  return QueueSchema.parse(config);
}
