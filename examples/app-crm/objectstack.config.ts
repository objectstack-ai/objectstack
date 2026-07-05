// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';

import * as objects from './src/objects/index.js';
import * as views from './src/views/index.js';
import * as apps from './src/apps/index.js';
import * as dashboards from './src/dashboards/index.js';
import * as datasets from './src/datasets/index.js';
import * as pages from './src/pages/index.js';
import * as actions from './src/actions/index.js';
import { allHooks } from './src/hooks/index.js';
import { allFlows } from './src/flows/index.js';
import {
  SalesRepRole,
  SalesManagerRole,
  FinanceApproverRole,
  SalesUserPermissionSet,
  GuestPortalProfile,
  HighValueOpportunitySharingRule,
  RepLeadSharingRule,
  WonDealActivitySharingRule,
} from './src/security/index.js';
import { CrmSeedData } from './src/data/index.js';
import { CrmDatasource, CrmAnalyticsDatasource } from './src/datasources/crm.datasource.js';
import { CrmTranslationBundle } from './src/translations/crm.translation.js';

/**
 * CRM example — a MINIMAL, realistic relational bundle that smoke-tests the
 * metadata application loading pipeline: objects/relationships → views →
 * app → dashboard (dataset-backed) → hook → one screen-flow wizard → seed.
 * Deliberately small so `pnpm dev:crm` boots fast for backend debugging.
 *
 * NOT a feature showcase: capability breadth (cubes, extensions, apis,
 * webhooks, portals, themes, reports, jobs, emails, automation variety)
 * lives in examples/app-showcase, whose coverage manifest enforces it.
 * For a full enterprise reference see https://github.com/objectstack-ai/hotcrm
 */
export default defineStack({
  manifest: {
    id: 'com.example.crm',
    namespace: 'crm',
    version: '4.0.0',
    type: 'app',
    name: 'CRM (minimal example)',
    description: 'Minimal CRM workspace used by the framework to validate the metadata loading pipeline end-to-end.',
  },

  // Auto-resolved by the CLI; `ui` enables the Studio shell, `automation`
  // loads AutomationServicePlugin + node packs so the convert-lead screen
  // flow can execute.
  requires: ['ui', 'automation'],

  // Infrastructure
  datasources: [CrmDatasource, CrmAnalyticsDatasource],
  datasourceMapping: [
    { namespace: 'crm', datasource: 'crm_primary' },
    { default: true, datasource: 'crm_primary' },
  ],

  // Internationalisation
  translations: [CrmTranslationBundle],
  i18n: {
    defaultLocale: 'en',
    supportedLocales: ['en', 'zh-CN'],
    fallbackLocale: 'en',
    messageFormat: 'simple',
    lazyLoad: false,
    cache: true,
  },

  // Data
  objects: Object.values(objects),

  // UI
  apps: Object.values(apps),
  views: Object.values(views),
  pages: Object.values(pages),
  dashboards: Object.values(dashboards),
  datasets: Object.values(datasets),
  actions: Object.values(actions),

  // Logic
  hooks: allHooks,
  // ADR-0020: `workflows` retired — record state machines are a
  // `state_machine` validation rule on the object (see
  // src/objects/opportunity.object.ts). One flow only: the convert-lead
  // screen wizard the smoke test drives.
  flows: allFlows,

  // Security
  roles: [SalesRepRole, SalesManagerRole, FinanceApproverRole],
  permissions: [SalesUserPermissionSet, GuestPortalProfile],
  sharingRules: [
    HighValueOpportunitySharingRule,
    RepLeadSharingRule,
    WonDealActivitySharingRule,
  ],

  // Seed data
  data: CrmSeedData,
});
