// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

export const ActivityViews = defineView({
  list: {
    label: 'All Activities',
    type: 'grid',
    data: { provider: 'object', object: 'crm_activity' },
    columns: [
      { field: 'subject' },
      { field: 'type' },
      { field: 'status' },
      { field: 'due_date' },
      { field: 'contact' },
      { field: 'account' },
      { field: 'opportunity' },
    ],
  },
  listViews: {
    all: {
      label: 'All Activities',
      data: { provider: 'object', object: 'crm_activity' },
      type: 'grid',
      columns: [
        { field: 'subject' },
        { field: 'type' },
        { field: 'status' },
        { field: 'due_date' },
        { field: 'contact' },
        { field: 'account' },
        { field: 'opportunity' },
      ],
    },
    /**
     * Calendar view — uses due_date as the event anchor.
     * Demonstrates the CalendarConfigSchema shape (startDateField + titleField).
     */
    calendar: {
      label: 'Activity Calendar',
      type: 'calendar',
      data: { provider: 'object', object: 'crm_activity' },
      columns: ['subject', 'type', 'status', 'due_date'],
      calendar: {
        startDateField: 'due_date',
        titleField:     'subject',
        colorField:     'type',
      },
    },
  },
  // No form here: the create and edit forms lay an activity out by the
  // object's `fieldGroups` (objects/activity.object.ts).
});
