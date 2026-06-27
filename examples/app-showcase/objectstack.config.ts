// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';
import { ConnectorRestPlugin } from '@objectstack/connector-rest';
import { ConnectorSlackPlugin } from '@objectstack/connector-slack';
import {
  MarketplaceProxyPlugin,
  MarketplaceInstallLocalPlugin,
  CloudConnectionPlugin,
  RuntimeConfigPlugin,
  resolveCloudUrl,
} from '@objectstack/cloud-connection';

import * as objects from './src/objects/index.js';
import { ShowcaseExternalDatasource } from './src/datasources/showcase-external.datasource.js';
import { ExternalCustomer, ExternalOrder } from './src/objects/external/index.js';
import { setupShowcaseExternalDatasource } from './src/datasources/external-fixture.js';
import { registerRecalcEndpoint } from './src/server/recalc-endpoint.js';
import { TaskViews, ProjectViews, InquiryViews, BusinessUnitViews } from './src/views/index.js';
import { ShowcaseApp } from './src/apps/index.js';
import { ChartGalleryDashboard, OpsDashboard } from './src/dashboards/index.js';
import { ShowcaseTaskDataset, ShowcaseProjectDataset } from './src/datasets/index.js';
import { allReports } from './src/reports/index.js';
import { allActions } from './src/actions/index.js';
import { ComponentGalleryPage, ProjectWorkspacePage, ProjectDetailPage, TaskWorkbenchPage, TaskTriagePage, TaskBoardPage, TaskCalendarPage, TaskGalleryPage, TaskSchedulePage, TaskTimelinePage, TaskMapPage, TaskAllViewsPage, ActiveProjectsPage, TaskDetailPage, AccountDetailPage, ReviewQueuePage, NewProjectWizardPage, MyWorkPage, SettingsPage, StylingGalleryPage, CommandCenterPage, PageVariablesPage, ContactFormPage } from './src/pages/index.js';
import { allFlows } from './src/flows/index.js';
import { allWebhooks } from './src/webhooks/index.js';
import { allHooks } from './src/hooks/index.js';
import { allJobs } from './src/jobs/index.js';
import { allEmails } from './src/emails/index.js';
import { allBooks } from './src/books/index.js';
import {
  allRoles,
  allPermissionSets,
  allSharingRules,
} from './src/security/index.js';
import { allThemes } from './src/themes/index.js';
import { ShowcaseTranslationBundle } from './src/translations/index.js';
import { allPortals } from './src/portals/index.js';
import { ShowcaseSeedData } from './src/data/index.js';

// Ambient `process` for the env-var overrides below — the showcase tsconfig
// doesn't pull in `@types/node`, but the CLI provides the real `process` at
// runtime. Keeps `pnpm typecheck` green without widening the type surface.
declare const process: { env: Record<string, string | undefined> };

// Marketplace catalog URL: `OS_CLOUD_URL` → public ObjectStack catalog by
// default; `OS_CLOUD_URL=off` returns '' and disables the marketplace plugins.
const marketplaceUrl = resolveCloudUrl();

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
    // App Marketplace for the open single-environment shape (ADR-0008).
    // Since ADR-0006 Phase 4 the CLI no longer auto-injects these — a host
    // that wants a marketplace wires @objectstack/cloud-connection explicitly.
    // Browse + install resolve against `OS_CLOUD_URL` (default: the public
    // ObjectStack catalog; set `OS_CLOUD_URL=off` for fully-offline runs —
    // air-gapped installs still work via `os package install <artifact.json>`).
    // install-local merges packages into THIS runtime's kernel: once
    // installed, nothing here depends on the cloud at runtime.
    ...(marketplaceUrl
      ? [
          new MarketplaceProxyPlugin({ controlPlaneUrl: marketplaceUrl }),
          new MarketplaceInstallLocalPlugin({ controlPlaneUrl: marketplaceUrl }),
          new CloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: marketplaceUrl }),
        ]
      : []),
    new RuntimeConfigPlugin({ controlPlaneUrl: '', singleEnvironment: true, installLocal: true }),
  ],

  // Infrastructure
  // No explicit datasource: the standalone CLI anchors a persistent sqlite
  // database at `<project>/.objectstack/data/standalone.db`, so data and
  // AI-authored metadata survive restarts (a `:memory:` datasource would wipe
  // everything on every restart, which makes local app-building unusable).
  //
  // External-datasource federation demo (ADR-0015 / ADR-0062): a second,
  // read-only SQLite file declared as a code-defined external datasource. It
  // appears in Setup → Datasources and its federated objects (below) are
  // queryable via REST — with NO driver wiring: the declared `external`
  // datasource AUTO-CONNECTS at boot (ADR-0062 D1/D8). `onEnable` (bottom of
  // this file) only provisions the "remote" fixture file's tables + seed data;
  // `os dev` needs no extra setup.
  datasources: [ShowcaseExternalDatasource],

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
  objects: [...Object.values(objects), ExternalCustomer, ExternalOrder],

  // UI
  apps: [ShowcaseApp],
  portals: allPortals,
  views: [TaskViews, ProjectViews, InquiryViews, BusinessUnitViews],
  pages: [ComponentGalleryPage, ProjectWorkspacePage, ProjectDetailPage, TaskWorkbenchPage, TaskTriagePage, TaskBoardPage, TaskCalendarPage, TaskGalleryPage, TaskSchedulePage, TaskTimelinePage, TaskMapPage, TaskAllViewsPage, ActiveProjectsPage, TaskDetailPage, AccountDetailPage, ReviewQueuePage, NewProjectWizardPage, MyWorkPage, SettingsPage, StylingGalleryPage, CommandCenterPage, PageVariablesPage, ContactFormPage],
  dashboards: [ChartGalleryDashboard, OpsDashboard],
  books: allBooks,
  datasets: [ShowcaseTaskDataset, ShowcaseProjectDataset],
  reports: allReports,
  actions: allActions,
  themes: allThemes,

  // Logic
  flows: allFlows,
  jobs: allJobs,
  emailTemplates: allEmails,
  hooks: allHooks,
  webhooks: allWebhooks,

  // Security
  roles: allRoles,
  permissions: allPermissionSets,
  sharingRules: allSharingRules,

  // Seed data
  data: ShowcaseSeedData,
});

/**
 * Provisions the "remote" fixture database for the external-datasource
 * federation demo (ADR-0015 / ADR-0062). Creating + seeding the remote tables is
 * CODE (DDL on a separate SQLite file), so it can't live in the declarative
 * artifact — it runs here. The AppPlugin invokes `onEnable` at boot.
 *
 * NOTE (ADR-0062 D8): this no longer registers the external driver. The declared
 * `external` datasource auto-connects at boot, so the federated objects are
 * queryable with no driver wiring.
 */
export const onEnable = async (ctx: unknown): Promise<void> => {
  await setupShowcaseExternalDatasource(ctx as Parameters<typeof setupShowcaseExternalDatasource>[0]);
  // Mount the custom REST endpoint behind the `showcase_recalc_estimate` api action.
  registerRecalcEndpoint(ctx as Parameters<typeof registerRecalcEndpoint>[0]);
};
