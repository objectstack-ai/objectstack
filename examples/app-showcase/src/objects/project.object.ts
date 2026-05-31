// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { cel, P } from '@objectstack/spec';

/**
 * Project — the realistic backbone object. Demonstrates lookup relations,
 * a formula field, a select that drives Kanban grouping, date fields that
 * drive Gantt/timeline views, validations, and a status state machine.
 */
export const Project = ObjectSchema.create({
  name: 'showcase_project',
  label: 'Project',
  pluralLabel: 'Projects',
  icon: 'folder-kanban',
  description: 'A delivery project for an account.',

  fields: {
    name: Field.text({ label: 'Project Name', required: true, searchable: true, maxLength: 200 }),
    account: Field.lookup('showcase_account', { label: 'Account', required: true }),
    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'Planned', value: 'planned', default: true, color: '#94A3B8' },
        { label: 'Active', value: 'active', color: '#3B82F6' },
        { label: 'On Hold', value: 'on_hold', color: '#F59E0B' },
        { label: 'Completed', value: 'completed', color: '#10B981' },
        { label: 'Cancelled', value: 'cancelled', color: '#EF4444' },
      ],
    }),
    health: Field.select({
      label: 'Health',
      options: [
        { label: 'Green', value: 'green', default: true, color: '#10B981' },
        { label: 'Yellow', value: 'yellow', color: '#F59E0B' },
        { label: 'Red', value: 'red', color: '#EF4444' },
      ],
    }),
    budget: Field.currency({ label: 'Budget', scale: 2, min: 0 }),
    spent: Field.currency({ label: 'Spent', scale: 2, min: 0, defaultValue: 0 }),
    budget_remaining: Field.formula({
      label: 'Budget Remaining',
      expression: cel`(budget == null ? 0 : budget) - (spent == null ? 0 : spent)`,
    }),
    start_date: Field.date({ label: 'Start Date' }),
    end_date: Field.date({ label: 'Target End Date' }),
    owner: Field.text({ label: 'Owner', maxLength: 200 }),
    summary: Field.summary({ label: 'Open Tasks' }),
  },

  validations: [
    {
      type: 'cross_field' as const,
      name: 'end_after_start',
      label: 'End After Start',
      description: 'Target end date must be on or after the start date.',
      fields: ['start_date', 'end_date'],
      condition: P`has(start_date) && has(end_date) && end_date < start_date`,
      message: 'Target End Date must be on or after the Start Date.',
    },
    {
      type: 'script' as const,
      name: 'spent_within_budget',
      label: 'Spend Within 120% of Budget',
      description: 'Flag projects spending more than 120% of budget.',
      condition: P`budget != null && spent != null && spent > budget * 1.2`,
      message: 'Spend exceeds 120% of budget — escalate before continuing.',
      severity: 'error' as const,
    },
    {
      type: 'state_machine' as const,
      name: 'project_status_flow',
      label: 'Project Status Flow',
      description: 'Projects progress through valid status transitions.',
      field: 'status',
      message: 'Invalid project status transition.',
      transitions: {
        planned: ['active', 'cancelled'],
        active: ['on_hold', 'completed', 'cancelled'],
        on_hold: ['active', 'cancelled'],
        completed: [],
        cancelled: ['planned'],
      },
    },
  ],
});
