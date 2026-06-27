// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';

import * as objects from './src/objects/index.js';
import * as views from './src/views/index.js';
import * as apps from './src/apps/index.js';
import * as dashboards from './src/dashboards/index.js';
import * as datasets from './src/datasets/index.js';
import * as reports from './src/reports/index.js';
import * as pages from './src/pages/index.js';
import * as actions from './src/actions/index.js';
import * as emails from './src/emails/index.js';
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
import { LeadCsvImportMapping, ContactJsonSyncMapping } from './src/data/crm-mappings.js';
import { CrmDatasource, CrmAnalyticsDatasource } from './src/datasources/crm.datasource.js';
import { CrmTranslationBundle } from './src/translations/crm.translation.js';
import { ContactExtension } from './src/extensions/contact.extension.js';
import { CustomerPortal } from './src/portals/customer.portal.js';
import { CrmLightTheme, CrmDarkTheme } from './src/themes/crm.theme.js';
import { LeadScoringJob, PipelineReportJob, RenewalSweepJob } from './src/jobs/crm-jobs.js';
import {
  PipelineSummaryEndpoint,
  LeadConvertEndpoint,
  MarketingWebhookEndpoint,
} from './src/api/crm-endpoints.js';
import { OpportunityChangedWebhook, DealWonSlackWebhook } from './src/webhooks/crm-webhooks.js';
import { PipelineCube, LeadFunnelCube } from './src/analytics/crm.cube.js';
import { HubSpotConnector, SlackConnector } from './src/connectors/crm-connectors.js';

/**
 * CRM example — exercises the full metadata loading pipeline with at
 * least one record of every form-bearing metadata type so the Studio
 * metadata-admin UI can be developed and validated against real data.
 *
 * For a full enterprise reference (10+ objects, RAG, sharing rules,
 * etc.) see https://github.com/objectstack-ai/hotcrm
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

  // Auto-resolved by the CLI; `ui` enables the Studio shell, `automation` loads
  // AutomationServicePlugin + node packs so screen flows can execute, and
  // `approvals` loads ApprovalsServicePlugin so the `approval` flow node is
  // contributed to the engine (ADR-0019) — required for the discount-approval
  // flow to compile/register and to surface the node in the designer palette.
  requires: ['ui', 'automation', 'approvals'],

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
  objectExtensions: [ContactExtension],

  // UI
  apps: Object.values(apps),
  portals: [CustomerPortal],
  views: Object.values(views),
  pages: Object.values(pages),
  dashboards: Object.values(dashboards),
  datasets: Object.values(datasets),
  reports: Object.values(reports),
  actions: Object.values(actions),
  themes: [CrmLightTheme, CrmDarkTheme],

  // Logic
  hooks: allHooks,
  // ADR-0020: `workflows` retired — record state machines are now a
  // `state_machine` validation rule on the object (see
  // src/objects/opportunity.object.ts) and side-effecting automation is
  // modelled as Flows (high-value-deal, stale-opportunity in allFlows).
  flows: allFlows,
  jobs: [LeadScoringJob, PipelineReportJob, RenewalSweepJob],
  emailTemplates: Object.values(emails),

  // Security
  roles: [SalesRepRole, SalesManagerRole, FinanceApproverRole],
  permissions: [SalesUserPermissionSet, GuestPortalProfile],
  sharingRules: [
    HighValueOpportunitySharingRule,
    RepLeadSharingRule,
    WonDealActivitySharingRule,
  ],

  // API
  apis: [PipelineSummaryEndpoint, LeadConvertEndpoint, MarketingWebhookEndpoint],
  webhooks: [OpportunityChangedWebhook, DealWonSlackWebhook],

  // Data Extensions
  mappings: [LeadCsvImportMapping, ContactJsonSyncMapping],
  analyticsCubes: [PipelineCube, LeadFunnelCube],

  // Integrations
  connectors: [HubSpotConnector, SlackConnector],

  // Seed data
  data: CrmSeedData,
});
