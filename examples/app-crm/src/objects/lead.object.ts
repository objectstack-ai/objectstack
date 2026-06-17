// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { cel, P } from '@objectstack/spec';

export const Lead = ObjectSchema.create({
  name: 'crm_lead',
  label: 'Lead',
  pluralLabel: 'Leads',
  icon: 'funnel',
  description: 'An inbound prospect not yet qualified as an opportunity.',

  fields: {
    name: Field.text({
      label: 'Lead Name',
      required: true,
      searchable: true,
      maxLength: 200,
    }),
    email: Field.email({
      label: 'Email',
      searchable: true,
    }),
    phone: Field.phone({
      label: 'Phone',
    }),
    company: Field.text({
      label: 'Company',
      searchable: true,
      maxLength: 200,
    }),
    title: Field.text({
      label: 'Title',
      maxLength: 120,
    }),
    status: Field.select({
      label: 'Status',
      required: true,
      // Write-path default so minimal creates (e.g. the public Web-to-Lead form,
      // which doesn't expose status) satisfy `required` — the option `default`
      // below is only a UI preselect.
      defaultValue: 'new',
      options: [
        { label: 'New',            value: 'new',            default: true, color: '#94A3B8' },
        { label: 'Contacted',      value: 'contacted',                     color: '#3B82F6' },
        { label: 'Qualifying',     value: 'qualifying',                    color: '#F59E0B' },
        { label: 'Qualified',      value: 'qualified',                     color: '#10B981' },
        { label: 'Disqualified',   value: 'disqualified',                  color: '#EF4444' },
        { label: 'Converted',      value: 'converted',                     color: '#8B5CF6' },
      ],
    }),
    source: Field.select({
      label: 'Lead Source',
      options: [
        { label: 'Website',        value: 'web',            default: true },
        { label: 'Referral',       value: 'referral' },
        { label: 'Event',          value: 'event' },
        { label: 'Social Media',   value: 'social' },
        { label: 'Cold Outreach',  value: 'cold_outreach' },
        { label: 'Partner',        value: 'partner' },
      ],
    }),
    lead_score: Field.number({
      label: 'Lead Score',
      min: 0,
      max: 100,
      defaultValue: 0,
    }),
    assigned_to: Field.text({
      label: 'Assigned To',
      maxLength: 200,
    }),
    account: Field.lookup('crm_account', {
      label: 'Account',
    }),
    converted_opportunity: Field.lookup('crm_opportunity', {
      label: 'Converted Opportunity',
    }),
    notes: Field.textarea({
      label: 'Notes',
    }),
    /** CEL formula: is this lead in a terminal converted/disqualified state? */
    is_closed: Field.formula({
      label: 'Is Closed',
      expression: cel`record.status == "converted" || record.status == "disqualified"`,
    }),
  },

  validations: [
    {
      type: 'state_machine' as const,
      name: 'lead_status_transitions',
      label: 'Lead Status Transitions',
      description: 'Enforces valid status progression for leads.',
      field: 'status',
      message: 'Invalid lead status transition.',
      transitions: {
        new:          ['contacted', 'qualifying', 'disqualified'],
        contacted:    ['qualifying', 'disqualified'],
        qualifying:   ['qualified', 'disqualified'],
        qualified:    ['converted', 'disqualified'],
        disqualified: [],
        converted:    [],
      },
    },
    {
      type: 'script' as const,
      name: 'lead_score_range',
      label: 'Lead Score 0–100',
      description: 'Lead score must be between 0 and 100.',
      condition: P`record.lead_score != null && (record.lead_score < 0 || record.lead_score > 100)`,
      message: 'Lead score must be between 0 and 100.',
    },
  ],
});
