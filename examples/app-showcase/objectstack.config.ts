// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';

import * as objects from './src/objects/index.js';
import { TaskViews, ProjectViews } from './src/views/index.js';
import { ShowcaseApp } from './src/apps/index.js';
import { ChartGalleryDashboard } from './src/dashboards/index.js';
import { allReports } from './src/reports/index.js';
import { allActions } from './src/actions/index.js';
import { ComponentGalleryPage } from './src/pages/index.js';
import { allFlows } from './src/flows/index.js';
import { allApprovals } from './src/approvals/index.js';
import { allWebhooks } from './src/webhooks/index.js';
import { allJobs } from './src/jobs/index.js';
import { allEmails } from './src/emails/index.js';
import { ShowcaseAssistantAgent, ProjectOpsSkill } from './src/agents/index.js';
import {
  allRoles,
  allPermissionSets,
  allSharingRules,
  allPolicies,
} from './src/security/index.js';
import { allThemes } from './src/themes/index.js';
import { ShowcaseTranslationBundle } from './src/translations/index.js';
import { allDatasources } from './src/datasources/index.js';
import { allPortals } from './src/portals/index.js';
import { ShowcaseSeedData } from './src/data/index.js';

/**
 * Showcase — a kitchen-sink workspace that exercises every metadata type,
 * every view type, every chart type, and the major end-to-end capability
 * chains. It is built for three audiences at once:
 *
 *   • Demonstration — a coherent project-delivery domain with seeded data
 *     so every view renders something real.
 *   • Debugging — open in Studio (`pnpm dev` → http://localhost:3000/_studio)
 *     and click through the gallery navigation.
 *   • Verification — `pnpm verify` runs typecheck + the coverage test, which
 *     introspects the protocol's own enums and fails if any field/chart/
 *     report type is left uncovered.
 */
export default defineStack({
  manifest: {
    id: 'com.example.showcase',
    namespace: 'showcase',
    version: '0.1.0',
    type: 'app',
    name: 'ObjectStack Showcase',
    description: 'Kitchen-sink workspace covering all metadata types, all view types, and the major capability chains.',
  },

  requires: ['ui', 'automation'],

  // Infrastructure
  datasources: allDatasources,
  datasourceMapping: [
    { namespace: 'showcase', datasource: 'showcase_primary' },
    { default: true, datasource: 'showcase_primary' },
  ],

  // i18n
  translations: [ShowcaseTranslationBundle],
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
  apps: [ShowcaseApp],
  portals: allPortals,
  views: [TaskViews, ProjectViews],
  pages: [ComponentGalleryPage],
  dashboards: [ChartGalleryDashboard],
  reports: allReports,
  actions: allActions,
  themes: allThemes,

  // Logic
  flows: allFlows,
  approvals: allApprovals,
  jobs: allJobs,
  emailTemplates: allEmails,
  webhooks: allWebhooks,

  // Security
  roles: allRoles,
  permissions: allPermissionSets,
  sharingRules: allSharingRules,
  policies: allPolicies,

  // AI
  agents: [ShowcaseAssistantAgent],
  skills: [ProjectOpsSkill],

  // Seed data
  data: ShowcaseSeedData,
});
