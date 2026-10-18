// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Example custom page — a CRM landing page.
 */
export const CrmWelcomePage = definePage({
  name: 'crm_welcome',
  label: 'CRM Welcome',
  type: 'home',
  template: 'header-sidebar-main',
  isDefault: false,
  kind: 'full',
  regions: [
    {
      name: 'header',
      width: 'full',
      components: [
        {
          type: 'page:header',
          properties: {
            title: 'Welcome to the CRM',
            subtitle: 'Manage your accounts, contacts and opportunities.',
          },
        },
      ],
    },
    {
      name: 'main',
      components: [
        {
          type: 'element:text',
          properties: {
            content:
              'This is a sample custom page. Edit it in Studio to add charts, lists, or AI components.',
          },
        },
      ],
    },
  ],
});
