// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { P } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

export const Activity = ObjectSchema.create({
  name: 'crm_activity',
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is intentionally org-shared; without this the new secure default
  // (unset OWD => private) would owner-filter it, and the D7 publish linter
  // (security-owd-unset) fails the build on an undeclared baseline.
  sharingModel: 'public_read_write',
  label: 'Activity',
  pluralLabel: 'Activities',
  icon: 'calendar-check',
  description: 'A logged interaction (call, email, meeting, or task) related to a CRM record.',

  fields: {
    subject: Field.text({
      label: 'Subject',
      required: true,
      searchable: true,
      maxLength: 255,
    }),
    type: Field.select({
      label: 'Type',
      required: true,
      options: [
        { label: 'Call',     value: 'call',     default: true, color: '#3B82F6' },
        { label: 'Email',    value: 'email',                   color: '#8B5CF6' },
        { label: 'Meeting',  value: 'meeting',                 color: '#F59E0B' },
        { label: 'Task',     value: 'task',                    color: '#10B981' },
      ],
    }),
    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'Planned',      value: 'planned',      default: true, color: '#94A3B8' },
        { label: 'In Progress',  value: 'in_progress',                 color: '#F59E0B' },
        { label: 'Completed',    value: 'completed',                   color: '#10B981' },
        { label: 'Cancelled',    value: 'cancelled',                   color: '#EF4444' },
      ],
    }),
    // A deadline, declared (objectui#11815 ruling D): past it the activity
    // reads as overdue until it is completed.
    due_date: Field.datetime({
      label: 'Due Date / Time',
      dueLike: true,
      settledWhen: P`record.status == 'completed'`,
    }),
    contact: Field.lookup('crm_contact', {
      label: 'Contact',
    }),
    account: Field.lookup('crm_account', {
      label: 'Account',
    }),
    opportunity: Field.lookup('crm_opportunity', {
      label: 'Opportunity',
    }),
    description: Field.textarea({
      label: 'Description',
    }),
    outcome: Field.textarea({
      label: 'Outcome / Notes',
    }),
    duration_minutes: Field.number({
      label: 'Duration (min)',
      min: 0,
    }),
  },
});
