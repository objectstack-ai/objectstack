// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

export const LeadViews = defineView({
  list: {
    label: 'All Leads',
    type: 'grid',
    data: { provider: 'object', object: 'crm_lead' },
    columns: [
      { field: 'name' },
      { field: 'company' },
      { field: 'status' },
      { field: 'source' },
      { field: 'lead_score' },
      { field: 'assigned_to' },
      { field: 'email' },
    ],
  },
  listViews: {
    all: {
      label: 'All Leads',
      data: { provider: 'object', object: 'crm_lead' },
      type: 'grid',
      columns: [
        { field: 'name' },
        { field: 'company' },
        { field: 'status' },
        { field: 'source' },
        { field: 'lead_score' },
        { field: 'assigned_to' },
        { field: 'email' },
      ],
    },
    pipeline: {
      label: 'Lead Pipeline (Kanban)',
      type: 'kanban',
      data: { provider: 'object', object: 'crm_lead' },
      columns: ['name', 'company', 'source', 'lead_score'],
      kanban: {
        groupByField: 'status',
        summarizeField: 'lead_score',
        columns: ['name', 'company', 'source', 'lead_score'],
      },
    },
  },
  formViews: {
    /**
     * PUBLIC / ANONYMOUS — Web-to-Lead.
     *
     * Hosted at GET/POST `/api/v1/forms/contact-us` (+ `/submit`). An
     * unauthenticated visitor — or an `EmbeddableForm` iframe on a marketing
     * site — submits it to create a `crm_lead`. `sharing.allowAnonymous` opens
     * the public endpoint; the `guest_portal` profile (INSERT-only on crm_lead)
     * authorizes the write. The lead object's own defaults/hooks stamp internal
     * fields (status, owner, score).
     */
    web_to_lead: {
      type: 'simple',
      data: { provider: 'object', object: 'crm_lead' },
      sections: [
        {
          label: 'Contact us',
          columns: 1,
          fields: [
            { field: 'name', required: true },
            { field: 'company' },
            { field: 'email', required: true },
            { field: 'phone' },
            { field: 'title' },
          ],
        },
      ],
      sharing: {
        enabled: true,
        allowAnonymous: true,
        publicLink: '/forms/contact-us',
      },
    },
    default: {
      type: 'simple',
      sections: [
        {
          label: 'Lead Information',
          columns: 2,
          fields: [
            { field: 'name',     required: true },
            { field: 'company' },
            { field: 'email' },
            { field: 'phone' },
            { field: 'title' },
            { field: 'source' },
          ],
        },
        {
          label: 'Qualification',
          columns: 2,
          fields: [
            { field: 'status',    required: true },
            { field: 'lead_score' },
            { field: 'assigned_to' },
            { field: 'account' },
          ],
        },
        {
          label: 'Conversion',
          columns: 2,
          fields: [
            { field: 'converted_opportunity' },
            { field: 'is_closed' },
          ],
        },
        {
          label: 'Notes',
          columns: 1,
          fields: [{ field: 'notes' }],
        },
      ],
    },
  },
});
