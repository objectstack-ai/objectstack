// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_assignment_rule — an organization's own assignment rule (ADR-0142 D5,
 * ruling A on organization-authored routing).
 *
 * One row is one rule with one entry: when an inserted record of
 * `object_name` matches `criteria`, it goes to the queue or the user the
 * recipient columns name, and a queue target may pick one member by
 * `strategy`. The engine reads the row the way it reads a declared rule's
 * entry (`packages/objectql/src/assignment-rules.ts`).
 *
 * ## Two sources, one namespace
 *
 * A package declares assignment rules in its stack's `assignmentRules`
 * (registry items, never copied into this table); an organization authors its
 * own here, the model `sys_sharing_rule` and `sys_queue` already follow.
 * A row may not take a declared rule's name (ADR-0131 D4): the save guard
 * (`assignment-rule-hooks.ts`) refuses that write.
 *
 * ## Order
 *
 * The engine is first-match. An object's organization rules are evaluated
 * first, ascending by `sort_order` and then by `name`, and the rules packages
 * declare are the fallback. The other order would let an organization's rule
 * never win: the activation ledger that switches a declared rule off is one
 * row per deployment, with no organization column, so an organization cannot
 * switch a package rule off for itself alone.
 *
 * ## Validated on save
 *
 * The save guard refuses, naming the field: a name that is not snake_case or
 * that a package rule holds; an object that does not exist or has no
 * ownership queue column; the shape the stack schema refuses for a declared
 * entry (a strategy on a user target, `least_loaded` without `load`, …);
 * a `criteria` or `load` the engine's CEL paths cannot compile; a user target
 * who is not an active member of the rule's organization; a row with no
 * organization. At insert time a target that no longer resolves leaves the
 * record ownerless and is logged once — intake is never refused.
 *
 * Field `description`s here are ADMIN-FACING help text rendered under each
 * input in Setup; implementation detail belongs in this comment.
 *
 * @namespace sys
 */
export const SysAssignmentRule = ObjectSchema.create({
  name: 'sys_assignment_rule',
  label: 'Assignment Rule',
  pluralLabel: 'Assignment Rules',
  icon: 'route',
  isSystem: true,
  managedBy: 'config',
  description: 'Sends each new record that matches a condition to a queue or a person.',
  displayNameField: 'name',
  nameField: 'name',
  highlightFields: ['name', 'object_name', 'recipient_type', 'recipient_id', 'strategy', 'active'],

  listViews: {
    by_object: {
      type: 'grid',
      name: 'by_object',
      label: 'By Object',
      data: { provider: 'object', object: 'sys_assignment_rule' },
      columns: ['object_name', 'sort_order', 'label', 'recipient_type', 'recipient_id', 'strategy', 'active'],
      // The evaluation order: one object's rules together, in the order the
      // engine tries them.
      sort: [{ field: 'object_name', order: 'asc' }, { field: 'sort_order', order: 'asc' }, { field: 'name', order: 'asc' }],
      pagination: { pageSize: 100 },
    },
  },

  fields: {
    // Non-null: a stored rule always belongs to one organization. A rule that
    // reaches every organization is a DECLARED rule, never a row here.
    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: true,
      group: 'System',
      description: 'The organization this rule belongs to.',
    }),

    name: Field.text({
      label: 'Name',
      required: true,
      maxLength: 100,
      description: 'Identifies the rule. Lowercase letters, digits and underscores only, and not the name of a rule an installed app provides.',
      group: 'Identity',
    }),

    label: Field.text({
      label: 'Display Label',
      required: true,
      maxLength: 200,
      group: 'Identity',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Identity',
    }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      maxLength: 100,
      widget: 'object-ref',
      description: 'The object whose new records this rule sends somewhere. Only objects whose records have an owner can be assigned.',
      group: 'Condition',
    }),

    criteria: Field.textarea({
      label: 'Condition',
      required: false,
      description: 'Which new records this rule takes; leave it empty to take every new record that no earlier rule took. ' +
        'Written as an expression over the record — for example record.priority == "high".',
      group: 'Condition',
    }),

    sort_order: Field.number({
      label: 'Order',
      required: false,
      defaultValue: 0,
      description: 'When several of your rules could take the same record, the one with the lowest order is tried first. Your rules are always tried before the rules installed apps provide.',
      group: 'Condition',
    }),

    recipient_type: Field.select({
      options: [
        { value: 'queue', label: 'Queue' },
        { value: 'user', label: 'User' },
      ],
      label: 'Assign To',
      required: true,
      defaultValue: 'queue',
      description: 'Send the record to a queue, where its members can take it, or straight to one person.',
      group: 'Assignment',
    }),

    recipient_id: Field.text({
      label: 'Queue or User',
      required: true,
      maxLength: 200,
      widget: 'recipient-picker',
      dependsOn: ['recipient_type'],
      description: 'The queue, or the person, the record goes to. A person must be an active member of this organization.',
      group: 'Assignment',
    }),

    strategy: Field.select({
      options: [
        { value: 'round_robin', label: 'Round robin' },
        { value: 'least_loaded', label: 'Least loaded' },
      ],
      label: 'Pick a Member',
      required: false,
      description:
        'For a queue: give the record straight to one member, taking turns or choosing whoever has the least open ' +
        'work. Leave it empty to leave the record in the queue until a member takes it.',
      group: 'Assignment',
    }),

    load: Field.textarea({
      label: 'Open Work',
      required: false,
      description:
        'Required for "Least loaded": which records count as a member\'s open work, written as an expression over ' +
        'the record — for example record.status != "closed".',
      group: 'Assignment',
    }),

    active: Field.boolean({
      label: 'Active',
      required: false,
      defaultValue: true,
      description: 'Turn off to stop this rule from assigning new records, without deleting it.',
      group: 'Lifecycle',
    }),
  },

  indexes: [
    { fields: ['object_name', 'active'] },
    { fields: ['name'], unique: 'organization' },
    { fields: ['organization_id'] },
  ],
});
