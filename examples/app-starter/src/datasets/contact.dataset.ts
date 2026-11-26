// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

/**
 * Contact counts (ADR-0021): the dashboard's contact tiles bind here.
 */
export const ContactDataset = defineDataset({
  name: 'starter_contact_metrics',
  label: 'Contact Metrics',
  description: 'How many contacts there are, by company and by influence',
  object: 'starter_contact',

  dimensions: [
    {
      name: 'company',
      label: 'Company',
      field: 'company',
      type: 'lookup',
      description:
        'The company the contact works at; results show the company name. A contact with no company is counted '
        + 'under no company.',
      synonyms: ['employer', 'organization', '公司', '所属公司'],
    },
    {
      name: 'influence',
      label: 'Influence',
      field: 'influence',
      type: 'string',
      description: 'How much say the contact has in the company\'s decisions: Decision Maker, Influencer, User or Other.',
      synonyms: ['influence', 'buying influence', '影响力', '决策影响'],
    },
  ],

  measures: [
    {
      name: 'contact_count',
      label: 'Contacts',
      aggregate: 'count',
      description: 'How many contacts there are.',
      synonyms: ['number of contacts', 'contact total', '联系人数', '联系人数量'],
    },
  ],
});
