// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { App } from '@objectstack/spec/ui';

export const CrmApp = App.create({
  name: 'crm_app',
  label: 'CRM',
  icon: 'briefcase',
  branding: {
    primaryColor: '#2563EB',
  },

  navigation: [
    {
      id: 'group_sales',
      type: 'group',
      label: 'Sales',
      icon: 'briefcase',
      children: [
        { id: 'nav_leads',         type: 'object',    objectName: 'crm_lead',        label: 'Leads',         icon: 'funnel' },
        { id: 'nav_accounts',      type: 'object',    objectName: 'crm_account',     label: 'Accounts',      icon: 'building' },
        { id: 'nav_contacts',      type: 'object',    objectName: 'crm_contact',     label: 'Contacts',      icon: 'user' },
        { id: 'nav_opportunities', type: 'object',    objectName: 'crm_opportunity', label: 'Opportunities', icon: 'trending-up' },
        { id: 'nav_activities',    type: 'object',    objectName: 'crm_activity',    label: 'Activities',    icon: 'calendar-check' },
      ],
    },
    {
      id: 'group_analytics',
      type: 'group',
      label: 'Analytics',
      icon: 'chart-bar',
      children: [
        // Same audience as the dashboard itself (see security/capabilities.ts).
        { id: 'nav_pipeline_dashboard', type: 'dashboard', dashboardName: 'pipeline_dashboard', label: 'Pipeline', icon: 'layout-dashboard', requiredPermissions: ['crm.view_pipeline'] },
      ],
    },
  ],
});
