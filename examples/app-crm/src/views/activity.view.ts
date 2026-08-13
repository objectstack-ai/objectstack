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
  formViews: {
    default: {
      type: 'simple',
      sections: [
        {
          name: 'activity_details',
          label: 'Activity Details',
          columns: 2,
          fields: [
            { field: 'subject',          required: true },
            { field: 'type',             required: true },
            { field: 'status',           required: true },
            { field: 'due_date' },
            { field: 'duration_minutes' },
          ],
        },
        {
          name: 'related_records',
          label: 'Related Records',
          columns: 2,
          fields: [
            { field: 'contact' },
            { field: 'account' },
            { field: 'opportunity' },
          ],
        },
        {
          name: 'notes',
          label: 'Notes',
          columns: 1,
          fields: [
            { field: 'description' },
            { field: 'outcome' },
          ],
        },
      ],
    },
  },
});
