// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { EvaluatedExpressionInputSchema } from '../shared/expression.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { strictObject } from '../shared/strict-object';
import { lazySchema } from '../shared/lazy-schema';

const BORN_CLOSED = 'Declared closed from its first day: an unrecognized key is refused, never dropped.';

/**
 * [ADR-0142 D5] How an assignment entry with a queue target picks one member.
 *
 * - `least_loaded` — for each member, count the object's rows in the
 *   organization that the member owns and that match the entry's `load`
 *   predicate; the smallest count wins, a tie goes to the earlier member
 *   (members are ordered by user id).
 * - `round_robin` — the member after the one the entry's cursor last chose.
 *
 * An entry with a queue target and no strategy PARKS the row: it sits in the
 * queue, `owner_id` empty, until a member claims it.
 */
export const AssignmentStrategy = z.enum(['round_robin', 'least_loaded']);
export type AssignmentStrategy = z.input<typeof AssignmentStrategy>;

/**
 * [ADR-0142 D5] Where an entry sends a matching row: a queue, named by its
 * machine name, or one user, named by id.
 */
export const AssignmentTargetSchema = strictObject(
  {
    surface: 'this assignment target',
    aliases: { id: 'value', name: 'value', queue: 'value', user: 'value' },
    history: BORN_CLOSED,
  },
  {
    type: z.enum(['queue', 'user']).describe("'queue' routes into a queue (by machine name); 'user' names one owner (by id)"),
    value: z.string().min(1).describe('The queue machine name, or the user id'),
  },
).superRefine((target, ctx) => {
  // A queue is referenced by its machine name everywhere (ADR-0142 D1); an id
  // or a label would resolve nowhere and the row would be left ownerless.
  if (target.type === 'queue' && !/^[a-z][a-z0-9_]*$/.test(target.value)) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message:
        `\`assignTo.value\` must name a queue by its machine name when \`type\` is 'queue' ` +
        `(got ${JSON.stringify(target.value)}): the snake_case name a stack's \`queues\` entry declares or an ` +
        "organization's `sys_queue` row carries.",
    });
  }
});

/**
 * [ADR-0142 D5] One entry of an assignment rule. Entries are evaluated in
 * order; the first whose `criteria` match the row in flight wins.
 */
export const AssignmentRuleEntrySchema = strictObject(
  {
    surface: 'this assignment rule entry',
    aliases: { condition: 'criteria', when: 'criteria', filter: 'criteria', target: 'assignTo', assignto: 'assignTo' },
    history: BORN_CLOSED,
  },
  {
    name: SnakeCaseIdentifierSchema.describe('Entry machine name, unique within the rule (the round-robin cursor is kept per entry)'),
    criteria: EvaluatedExpressionInputSchema.optional().describe(
      'CEL over `record.*`, interpreted against the row being inserted (it is not stored yet). Absent = every row.',
    ),
    assignTo: AssignmentTargetSchema.describe('Where a matching row goes: a queue or one user'),
    strategy: AssignmentStrategy.optional().describe(
      "How one member of the target queue is chosen: 'round_robin' or 'least_loaded'. Only with a queue " +
      'target; absent = the row parks in the queue for a member to claim.',
    ),
    load: EvaluatedExpressionInputSchema.optional().describe(
      "Required with 'least_loaded', refused otherwise: a CEL pushdown predicate over the object naming the " +
      "rows that count as a member's open load (e.g. `record.status != \"closed\"`). There is no platform " +
      'default, because what is open differs per object.',
    ),
  },
).superRefine((entry, ctx) => {
  if (entry.strategy !== undefined && entry.assignTo.type !== 'queue') {
    ctx.addIssue({
      code: 'custom',
      path: ['strategy'],
      message:
        `\`strategy: '${entry.strategy}'\` distributes rows over a queue's members, but this entry assigns to ` +
        "one user. Remove `strategy`, or set `assignTo: { type: 'queue', value: '<queue name>' }`.",
    });
  }
  if (entry.strategy === 'least_loaded' && entry.load === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['load'],
      message:
        "`strategy: 'least_loaded'` needs `load`: the CEL predicate naming the rows that count as a member's " +
        'open work (e.g. `record.status != "resolved" && record.status != "closed"`). There is no default — ' +
        'counting every row would count closed work too.',
    });
  }
  if (entry.load !== undefined && entry.strategy !== 'least_loaded') {
    ctx.addIssue({
      code: 'custom',
      path: ['load'],
      message:
        "`load` is read only by `strategy: 'least_loaded'`, and this entry " +
        (entry.strategy === undefined ? 'declares no strategy' : `declares '${entry.strategy}'`) +
        ". Remove `load`, or set `strategy: 'least_loaded'`.",
    });
  }
});

/**
 * Assignment Rule — declared routing of an inserted row to a queue or a user
 * (ADR-0142 D5).
 *
 * The engine evaluates an object's active rules ONCE per inserted row, after
 * every `beforeInsert` hook has run and before the write, and only for a row
 * whose `owner_id` and `queue` are both still empty: a writer-supplied owner
 * was adjudicated by the ownership gate, and a hook that set or cleared one
 * spoke for the scenario first. An update never evaluates a rule.
 *
 * The evaluation is a platform step: its reads run under a system context
 * pinned to the row's organization, and the owner it picks is ownership, not
 * attribution — the row's audit columns still record the writer. It never
 * refuses an insert: an empty queue, a queue that does not resolve in the
 * row's organization, or a failed read leaves the row ownerless (sitting in
 * the queue when one was chosen) and is logged once.
 *
 * Assignment rules are declared only (the stack's `assignmentRules`);
 * organization-authored rules are deferred (ADR-0142 merge question 11).
 * Switched off through the activation ledger (`sys_metadata_activation`,
 * `metadata_type: 'assignment_rule'`) or `active: false`.
 */
export const AssignmentRuleSchema = lazySchema(() => strictObject(
  {
    surface: 'this assignment rule',
    aliases: { title: 'label', rules: 'entries', enabled: 'active', objectname: 'object' },
    guidance: {
      runAs:
        '`runAs` is not an assignment-rule field — the evaluation is a platform step that reads under a ' +
        "system context pinned to the row's organization, never a hook's or a flow's declared identity " +
        '(ADR-0073 D2).',
      on:
        '`on` is not an assignment-rule field — a rule is evaluated once, on insert, for a row that is still ' +
        'ownerless after every hook. Re-routing on an update is not part of this surface.',
    },
    history: BORN_CLOSED,
  },
  {
    name: SnakeCaseIdentifierSchema.describe('Rule machine name (lowercase snake_case)'),
    label: z.string().optional().describe('Display label'),
    description: z.string().optional().describe('Administrative notes'),
    object: SnakeCaseIdentifierSchema.describe('The object whose inserted rows the rule routes (an `ownership: user` object)'),
    active: z.boolean().default(true).describe('Whether the rule is evaluated'),
    entries: z.array(AssignmentRuleEntrySchema).min(1).describe(
      'Ordered entries; the first whose criteria match the inserted row decides where it goes',
    ),

    // ADR-0010 — runtime protection envelope (internal — set by loader).
    ...MetadataProtectionFields,
  },
).superRefine((rule, ctx) => {
  const seen = new Set<string>();
  rule.entries.forEach((entry, i) => {
    if (seen.has(entry.name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries', i, 'name'],
        message:
          `Two entries of assignment rule '${rule.name}' are named '${entry.name}'. Entry names are unique ` +
          'within a rule: the round-robin cursor is kept per entry, so two entries sharing one would share ' +
          'one rotation.',
      });
    }
    seen.add(entry.name);
  });
}));

export type AssignmentRule = z.input<typeof AssignmentRuleSchema>;
/** Post-parse shape of {@link AssignmentRule} — defaults applied, transforms run (ADR-0122). */
export type AssignmentRuleParsed = z.infer<typeof AssignmentRuleSchema>;
export type AssignmentRuleEntry = z.input<typeof AssignmentRuleEntrySchema>;
/** The parsed entry: `criteria` and `load` arrive as their evaluated-expression form. */
export type AssignmentRuleEntryParsed = z.infer<typeof AssignmentRuleEntrySchema>;
export type AssignmentTarget = z.input<typeof AssignmentTargetSchema>;

/**
 * Type-safe factory for an assignment rule. Validates at authoring time via
 * `.parse()` and accepts input-shape config.
 */
export function defineAssignmentRule(config: z.input<typeof AssignmentRuleSchema>): AssignmentRuleParsed {
  return AssignmentRuleSchema.parse(config);
}
