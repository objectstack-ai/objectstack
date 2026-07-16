// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import { ConnectorRestPlugin } from '@objectstack/connector-rest';
import { ConnectorSlackPlugin } from '@objectstack/connector-slack';
import {
  MarketplaceProxyPlugin,
  MarketplaceInstallLocalPlugin,
  CloudConnectionPlugin,
  RuntimeConfigPlugin,
  resolveCloudUrl,
} from '@objectstack/cloud-connection';

import * as objects from './src/data/objects/index.js';
import { ShowcaseExternalDatasource } from './src/system/datasources/showcase-external.datasource.js';
import { ExternalCustomer, ExternalOrder } from './src/data/objects/external/index.js';
import { setupShowcaseExternalDatasource } from './src/system/datasources/external-fixture.js';
import { registerRecalcEndpoint } from './src/system/server/recalc-endpoint.js';
import { registerShowcasePositionBindings } from './src/security/bind-position-sets.js';
import { TaskViews, ProjectViews, InquiryViews, BusinessUnitViews } from './src/ui/views/index.js';
import { ShowcaseApp } from './src/ui/apps/index.js';
import { ChartGalleryDashboard, OpsDashboard, RevenuePulseDashboard } from './src/ui/dashboards/index.js';
import { ShowcaseTaskDataset, ShowcaseProjectDataset, ShowcaseInvoiceDataset, ShowcaseAccountDataset } from './src/ui/datasets/index.js';
import { allReports } from './src/ui/reports/index.js';
import { allActions } from './src/ui/actions/index.js';
import { CapabilityMapPage, StartHerePage, ComponentGalleryPage, ProjectWorkspacePage, ProjectDetailPage, TaskWorkbenchPage, TaskTriagePage, TaskBoardPage, TaskCalendarPage, TaskGalleryPage, TaskSchedulePage, TaskTimelinePage, TaskMapPage, TaskAllViewsPage, ActiveProjectsPage, TaskDetailPage, ReviewQueuePage, NewProjectWizardPage, MyWorkPage, SettingsPage, StylingGalleryPage, CommandCenterPage, CommandCenterJsxPage, CrmWorkbenchPage, TaskDeskPage, PageVariablesPage, ContactFormPage, RenewalsPipelinePage } from './src/ui/pages/index.js';
import { allFlows } from './src/automation/flows/index.js';
import { allWebhooks } from './src/automation/webhooks/index.js';
import { allHooks } from './src/data/hooks/index.js';
import { allJobs } from './src/automation/jobs/index.js';
import { allEmails } from './src/system/emails/index.js';
import { allBooks } from './src/system/books/index.js';
import { allApis } from './src/system/apis/index.js';
import { allConnectors } from './src/system/connectors/index.js';
import {
  allPositions,
  allPermissionSets,
  allCapabilities,
  allSharingRules,
} from './src/security/index.js';
import { allThemes } from './src/ui/themes/index.js';
import { ShowcaseTranslationBundle } from './src/system/translations/index.js';
import { allPortals } from './src/ui/portals/index.js';
import { ShowcaseSeedData } from './src/data/seed/index.js';
import { allCubes } from './src/data/analytics/showcase.cube.js';
import { allObjectExtensions } from './src/data/extensions/account.extension.js';
import { allMappings } from './src/data/mappings/index.js';

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
 *     so every view renders something real. The Capability Map landing page
 *     indexes every demo by protocol domain, and five tour docs
 *     (src/docs/showcase_tour_*.md) walk each domain with live metadata
 *     embeds.
 *   • Debugging — open in Studio (`pnpm dev` → http://localhost:3000/_studio)
 *     and click through the gallery navigation.
 *   • Verification — `pnpm verify` runs typecheck + the coverage test, which
 *     introspects the protocol's own contracts at two levels: every metadata
 *     kind in DEFAULT_METADATA_TYPE_REGISTRY must be demonstrated or
 *     explicitly waived (reason + issue), and every enum variant
 *     (field/chart/report/action) must appear at least once.
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
  //   • rest    → points at the running server itself, so the REST connector
  //               flow's call + response are observable on the flow run with no
  //               external dependency. Override the target with SHOWCASE_SELF_URL.
  //   • slack   → registered so TaskCompletedSlackFlow resolves its connector;
  //               live posting needs a real bot token (set SLACK_BOT_TOKEN).
  //   • openapi → option-less: contributes only the `openapi` provider factory
  //               (ADR-0097), which materializes the StatusOpenApiConnector
  //               declarative instance below — its OpenAPI document is a
  //               package-relative FILE PATH read at boot (#3016).
  plugins: [
    new ConnectorOpenApiPlugin(),
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
  // Additive overlay merged into showcase_account at registration — the
  // package-extends-an-object mechanism (see src/data/extensions/).
  objectExtensions: allObjectExtensions,
  // Analytics semantic layer served by the foundational analytics capability
  // (`/api/v1/analytics/*`) — no `requires` token needed; the CLI always
  // loads it and registers these cubes (see src/data/analytics/).
  analyticsCubes: allCubes,
  // Named import mappings (#2611) — resolved by the import endpoint via
  // `mappingName` (see src/data/mappings/).
  mappings: allMappings,

  // UI
  apps: [ShowcaseApp],
  portals: allPortals,
  views: [TaskViews, ProjectViews, InquiryViews, BusinessUnitViews],
  pages: [CapabilityMapPage, StartHerePage, ComponentGalleryPage, ProjectWorkspacePage, ProjectDetailPage, TaskWorkbenchPage, TaskTriagePage, TaskBoardPage, TaskCalendarPage, TaskGalleryPage, TaskSchedulePage, TaskTimelinePage, TaskMapPage, TaskAllViewsPage, ActiveProjectsPage, TaskDetailPage, ReviewQueuePage, NewProjectWizardPage, MyWorkPage, SettingsPage, StylingGalleryPage, CommandCenterPage, CommandCenterJsxPage, CrmWorkbenchPage, TaskDeskPage, PageVariablesPage, ContactFormPage, RenewalsPipelinePage],
  dashboards: [ChartGalleryDashboard, OpsDashboard, RevenuePulseDashboard],
  books: allBooks,
  datasets: [ShowcaseTaskDataset, ShowcaseProjectDataset, ShowcaseInvoiceDataset, ShowcaseAccountDataset],
  reports: allReports,
  actions: allActions,
  themes: allThemes,

  // Logic
  flows: allFlows,
  jobs: allJobs,
  emailTemplates: allEmails,
  // Declarative REST endpoints (object_operation + flow) — the metadata
  // counterpart of the code-mounted recalc endpoint (see src/system/apis/).
  apis: allApis,
  // Declarative `connectors:` — both kinds (ADR-0097): provider-bound
  // INSTANCES (StatusApiConnector via `rest`; StatusOpenApiConnector via
  // `openapi` with a package-relative file-path spec, #3016) materialized into
  // live, dispatchable connectors at boot, plus a CATALOG DESCRIPTOR
  // (ErpCatalogConnector, #2612) that stays metadata-only. See
  // src/system/connectors/ for the full contract.
  connectors: allConnectors,
  hooks: allHooks,
  webhooks: allWebhooks,

  // Security
  positions: allPositions,
  permissions: allPermissionSets,
  // [ADR-0066 D1] Package-declared authorization capabilities — seeded into
  // sys_capability with package provenance (managed_by:'package').
  capabilities: allCapabilities,
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
  // [#2926 ②] Ensure the persona position↔permission-set bindings exist after
  // the security bootstraps (cannot be a seed — see bind-position-sets.ts).
  registerShowcasePositionBindings(ctx as Parameters<typeof registerShowcasePositionBindings>[0]);
};
