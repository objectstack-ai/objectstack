// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Dashboard } from '@objectstack/spec/ui';

/**
 * Overview: how many companies and contacts there are, and how they split.
 * Every widget binds to one of the two datasets (ADR-0021).
 */
export const OverviewDashboard = Dashboard.create({
  name: 'starter_overview_dashboard',
  label: 'Overview',
  description: 'Companies and contacts at a glance.',
  columns: 12,
  widgets: [
    {
      id: 'total_companies',
      type: 'metric',
      title: 'Companies',
      description: 'Every company, whatever its type.',
      dataset: 'starter_company_metrics',
      values: ['company_count'],
      layout: { x: 0, y: 0, w: 4, h: 2 },
    },
    {
      id: 'customers',
      type: 'metric',
      title: 'Customers',
      description: 'Companies whose type is Customer.',
      filter: { type: 'customer' },
      dataset: 'starter_company_metrics',
      values: ['company_count'],
      layout: { x: 4, y: 0, w: 4, h: 2 },
    },
    {
      id: 'total_contacts',
      type: 'metric',
      title: 'Contacts',
      description: 'Every contact.',
      dataset: 'starter_contact_metrics',
      values: ['contact_count'],
      layout: { x: 8, y: 0, w: 4, h: 2 },
    },
    {
      id: 'companies_by_type',
      type: 'bar',
      title: 'Companies by Type',
      description: 'How many companies there are of each type.',
      dataset: 'starter_company_metrics',
      dimensions: ['type'],
      values: ['company_count'],
      layout: { x: 0, y: 2, w: 6, h: 4 },
    },
    {
      id: 'companies_by_industry',
      type: 'pie',
      title: 'Companies by Industry',
      description: 'How the companies split across industries.',
      dataset: 'starter_company_metrics',
      dimensions: ['industry'],
      values: ['company_count'],
      layout: { x: 6, y: 2, w: 6, h: 4 },
    },
    {
      id: 'contacts_by_company',
      type: 'bar',
      title: 'Contacts by Company',
      description: 'How many contacts each company has.',
      dataset: 'starter_contact_metrics',
      dimensions: ['company'],
      values: ['contact_count'],
      layout: { x: 0, y: 6, w: 12, h: 4 },
    },
  ],
});
