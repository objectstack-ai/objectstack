// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';
import { ConnectorRestPlugin } from '@objectstack/connector-rest';
import { ConnectorSlackPlugin } from '@objectstack/connector-slack';

import * as objects from './src/objects/index.js';
import { TaskViews, ProjectViews } from './src/views/index.js';
import { ShowcaseApp } from './src/apps/index.js';
import { ChartGalleryDashboard } from './src/dashboards/index.js';
import { allReports } from './src/reports/index.js';
import { allActions } from './src/actions/index.js';
import { ComponentGalleryPage, ProjectWorkspacePage, ProjectDetailPage } from './src/pages/index.js';
import { allFlows } from './src/flows/index.js';
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
import { allPortals } from './src/portals/index.js';
import { ShowcaseSeedData } from './src/data/index.js';

// Ambient `process` for the env-var overrides below — the showcase tsconfig
// doesn't pull in `@types/node`, but the CLI provides the real `process` at
// runtime. Keeps `pnpm typecheck` green without widening the type surface.
declare const process: { env: Record<string, string | undefined> };

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

  // Capability tokens the CLI resolves to platform plugins:
  //   • automation  — AutomationServicePlugin (flow engine + node executors).
  //   • approvals   — ApprovalsServicePlugin, so the `approval` flow node
  //                   (ADR-0019) is contributed to the engine.
  //   • messaging   — MessagingServicePlugin, so the `notify` node delivers to
  //                   the inbox channel (`sys_inbox_message` rows) instead of
  //                   degrading to a logged no-op.
  //   • triggers    — record-change + schedule FlowTrigger plugins, so the
  //                   autolaunched / schedule flows below actually auto-fire.
  //   • job         — JobServicePlugin, the timing backend the schedule trigger
  //                   delegates to (interval / cron jobs).
  //   • marketplace — PackageServicePlugin (sys_packages store). Enables the AI
  //                   blueprint flow to auto-create a writable "app package" home
  //                   (ADR-0033 zero-package app building) and the Studio package
  //                   selector to list DB packages.
  requires: ['ui', 'automation', 'approvals', 'messaging', 'triggers', 'job', 'marketplace'],

  // Concrete connectors for the `connector_action` node. The baseline engine
  // ships the dispatch node + an empty registry; these plugins populate it.
  //   • rest  → points at the running server itself, so the REST connector
  //             flow's call + response are observable on the flow run with no
  //             external dependency. Override the target with SHOWCASE_SELF_URL.
  //   • slack → registered so TaskCompletedSlackFlow resolves its connector;
  //             live posting needs a real bot token (set SLACK_BOT_TOKEN).
  plugins: [
    new ConnectorRestPlugin({
      name: 'rest',
      baseUrl: process.env.SHOWCASE_SELF_URL ?? 'http://127.0.0.1:3000',
    }),
    new ConnectorSlackPlugin({
      token: process.env.SLACK_BOT_TOKEN ?? 'xoxb-showcase-demo-token',
    }),
  ],

  // Infrastructure
  // No explicit datasource: the standalone CLI anchors a persistent sqlite
  // database at `<project>/.objectstack/data/standalone.db`, so data and
  // AI-authored metadata survive restarts (a `:memory:` datasource would wipe
  // everything on every restart, which makes local app-building unusable).

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
  pages: [ComponentGalleryPage, ProjectWorkspacePage, ProjectDetailPage],
  dashboards: [ChartGalleryDashboard],
  reports: allReports,
  actions: allActions,
  themes: allThemes,

  // Logic
  flows: allFlows,
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
