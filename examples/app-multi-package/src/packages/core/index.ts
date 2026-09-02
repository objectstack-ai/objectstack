// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';

/**
 * `com.example.multi.core` — the consumer-facing App of this artifact
 * (ADR-0019 D1: the App is the only thing a consumer installs and opens).
 *
 * It owns `crm_account` and the one app. Everything else this product ships is
 * a MODULE inside the same artifact, sharing this package's namespace so a
 * split costs no object rename (ADR-0129 D1–D2: the object `name` IS the table
 * name, the REST path, the formula token and the saved-view key).
 */
export default defineStack({
  manifest: {
    id: 'com.example.multi.core',
    name: 'Multi-Package Core',
    namespace: 'crm',
    version: '1.0.0',
    type: 'app',
    description: 'The App half of a two-package release artifact (ADR-0130 D4)',
    engines: { protocol: '^17' },
  },

  objects: [
    {
      name: 'crm_account',
      label: 'Account',
      pluralLabel: 'Accounts',
      // ADR-0090 D1 — the org-wide default is an authored decision, never an
      // accident: the runtime fails closed to 'private', and a rule refuses the
      // silence rather than letting the fallback stand in for a choice.
      sharingModel: 'private',
      fields: {
        name: { name: 'name', type: 'text', label: 'Account Name', required: true },
        industry: { name: 'industry', type: 'text', label: 'Industry' },
      },
    },
  ],

  apps: [
    {
      name: 'multi_crm',
      label: 'Multi-Package CRM',
      description: 'Accounts, plus whatever modules this artifact delivers alongside',
      navigation: [
        { id: 'nav_accounts', type: 'object', objectName: 'crm_account', label: 'Accounts', icon: 'building' },
      ],
    },
  ],
});
