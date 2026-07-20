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
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is RLS-owned / intentionally public; without this the new secure
  // default (unset OWD => private) would owner-filter it.
  sharingModel: 'public_read_write',
  label: 'Project',
  pluralLabel: 'Projects',
  icon: 'folder-kanban',
  description: 'A delivery project for an account.',

  // [#2727 / #2970] Opt in to the generic Attachments panel on the record
  // detail page — projects carry briefs, SOWs, and deliverable files. This is
  // the showcase's files-enabled object for browser-dogfooding the attachments
  // surface (upload / list / download / delete + parent-derived access).
  enable: { files: true },

  fields: {
    name: Field.text({ label: 'Project Name', required: true, searchable: true, maxLength: 200 }),
    // `relatedList*` is the read-side mirror of inline editing: the Account's
    // record DETAIL page auto-renders a "Projects" tab — derived from this
    // lookup relationship, with NO page config. `relatedList: 'primary'` marks
    // it a CORE relationship (ADR-0085 prominence) so the detail page promotes
    // it to its own tab; non-primary children collapse into a shared "Related"
    // tab. Title and columns are declared here on the relationship (where AI
    // authors the model), not in a hand-built page.
    account: Field.lookup('showcase_account', {
      label: 'Account',
      required: true,
      relatedList: 'primary',
      relatedListTitle: 'Projects',
      relatedListColumns: ['name', 'status', 'health', 'budget', 'end_date'],
    }),
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
      expression: cel`(record.budget == null ? 0 : record.budget) - (record.spent == null ? 0 : record.spent)`,
    }),
    start_date: Field.date({ label: 'Start Date' }),
    end_date: Field.date({ label: 'Target End Date' }),
    owner: Field.text({ label: 'Owner', maxLength: 200 }),
    // Multi-value fields — the payload for the grid's *bulk-edit* showcase. A
    // multiselect (fixed options) and a multi-user field are exactly the two
    // shapes that, before #2185, the bulk dialog could not set: its people /
    // select picker collapsed to a single value and overwrote the array. The
    // list view's `bulkActionDefs` below now sets both with real multi-select
    // controls, writing an array patch.
    labels: {
      type: 'multiselect',
      label: 'Labels',
      options: [
        { label: 'Frontend', value: 'frontend', color: '#3B82F6' },
        { label: 'Backend', value: 'backend', color: '#8B5CF6' },
        { label: 'Design', value: 'design', color: '#EC4899' },
        { label: 'QA', value: 'qa', color: '#F59E0B' },
        { label: 'DevOps', value: 'devops', color: '#10B981' },
      ],
    },
    team_members: Field.user({ label: 'Team Members', multiple: true }),
    // Roll-up summaries — recomputed server-side whenever a child task is
    // inserted / updated / deleted (FK auto-detected: showcase_task.project).
    task_count: Field.summary({
      label: 'Tasks',
      summaryOperations: { object: 'showcase_task', field: 'estimate_hours', function: 'count' },
    }),
    total_estimate: Field.summary({
      label: 'Total Estimate (h)',
      summaryOperations: { object: 'showcase_task', field: 'estimate_hours', function: 'sum' },
    }),
  },

  validations: [
    {
      type: 'cross_field' as const,
      name: 'end_after_start',
      label: 'End After Start',
      description: 'Target end date must be on or after the start date.',
      fields: ['start_date', 'end_date'],
      condition: P`has(record.start_date) && has(record.end_date) && record.end_date < record.start_date`,
      message: 'Target End Date must be on or after the Start Date.',
    },
    {
      type: 'script' as const,
      name: 'spent_within_budget',
      label: 'Spend Within 120% of Budget',
      description: 'Flag projects spending more than 120% of budget.',
      condition: P`record.budget != null && record.spent != null && record.spent > record.budget * 1.2`,
      message: 'Spend exceeds 120% of budget — escalate before continuing.',
      severity: 'error' as const,
    },
    {
      type: 'state_machine' as const,
      name: 'project_status_flow',
      label: 'Project Status Flow',
      description: 'Projects progress through valid status transitions.',
      field: 'status',
      // `transitions` govern UPDATE; `initialStates` (#3165) is the FSM entry
      // point on INSERT — without it a `select` would accept ANY option as the
      // initial value, so a project could be born already `completed`. Requiring
      // `insert` in `events` is what makes the initialStates check run on create.
      events: ['insert', 'update'] as const,
      initialStates: ['planned'],
      message: 'Invalid project status transition.',
      transitions: {
        planned: ['active', 'cancelled'],
        active: ['on_hold', 'completed', 'cancelled'],
        on_hold: ['active', 'cancelled'],
        completed: [],
        cancelled: ['planned'],
      },
    },
    {
      // Advisory (severity: 'warning') state machine — demonstrates a soft
      // transition guard: health should escalate/de-escalate one step at a
      // time (green↔yellow↔red). A jump (e.g. green→red) is *flagged* (logged
      // server-side) but NOT blocked, unlike the error-severity status flow.
      type: 'state_machine' as const,
      name: 'project_health_progression',
      label: 'Project Health Progression (advisory)',
      description: 'Health should change one step at a time; skips are warned, not blocked.',
      field: 'health',
      events: ['update'] as const,
      severity: 'warning' as const,
      message: 'Health changed by more than one step — confirm this is intentional.',
      transitions: {
        green: ['yellow'],
        yellow: ['green', 'red'],
        red: ['yellow'],
      },
    },
  ],
});
