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
  // No default form: the create and edit forms lay a lead out by the
  // object's `fieldGroups` (objects/lead.object.ts). The public Web-to-Lead
  // form below is a NAMED form: it is served by its slug and keeps loading.
  formViews: {
    /**
     * PUBLIC / ANONYMOUS — Web-to-Lead.
     *
     * Hosted at GET/POST `/api/v1/forms/contact-us` (+ `/submit`). An
     * unauthenticated visitor — or an `EmbeddableForm` iframe on a marketing
     * site — submits it to create a `crm_lead`. `sharing.allowAnonymous` opens
     * the public endpoint, and this declaration is also what authorizes the
     * write: the submit route derives a `publicFormGrant` on `crm_lead` from it
     * (create + read-back on that object only, ADR-0056 Option A). No
     * permission set is needed, `GuestPortalProfile` included (see its
     * comment). Only the fields in `sections` are written; the lead object's
     * field defaults fill what the form does not collect (`status`, `source`,
     * `lead_score`), and the server-managed anchors (`owner_id`,
     * `organization_id`, audit columns) are never taken from a submission.
     */
    web_to_lead: {
      type: 'simple',
      data: { provider: 'object', object: 'crm_lead' },
      sections: [
        {
          name: 'contact_us',
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
  },
});
