// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';
import { ConnectorMcpPlugin } from '@objectstack/connector-mcp';
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
import { registerShowcaseApprovalDemo } from './src/security/seed-approval-demo.js';
import { TaskViews, ProjectViews, InquiryViews, BusinessUnitViews, ContactViews, FieldZooViews } from './src/ui/views/index.js';
import { ShowcaseApp } from './src/ui/apps/index.js';
import { ChartGalleryDashboard, OpsDashboard, RevenuePulseDashboard } from './src/ui/dashboards/index.js';
import { ShowcaseTaskDataset, ShowcaseProjectDataset, ShowcaseInvoiceDataset, ShowcaseAccountDataset } from './src/ui/datasets/index.js';
import { allReports } from './src/ui/reports/index.js';
import { allActions } from './src/ui/actions/index.js';
import { CapabilityMapPage, StartHerePage, ComponentGalleryPage, ProjectWorkspacePage, ProjectDetailPage, TaskWorkbenchPage, TaskTriagePage, TaskBoardPage, TaskCalendarPage, TaskGalleryPage, TaskSchedulePage, TaskTimelinePage, TaskMapPage, TaskAllViewsPage, ActiveProjectsPage, TaskDetailPage, ReviewQueuePage, NewProjectWizardPage, MyWorkPage, SettingsPage, StylingGalleryPage, CommandCenterPage, CommandCenterJsxPage, CrmWorkbenchPage, TaskDeskPage, PageVariablesPage, ContactFormPage, RenewalsPipelinePage } from './src/ui/pages/index.js';
import { allFlows } from './src/automation/flows/index.js';
import { allWebhooks } from './src/automation/webhooks/index.js';
import { allHooks } from './src/data/hooks/index.js';
import { allJobs, sweepProjectHealth, bindShowcaseJobRuntime } from './src/automation/jobs/index.js';
import { allEmails } from './src/system/emails/index.js';
import { allBooks } from './src/system/books/index.js';
import { allApis } from './src/system/apis/index.js';
import { allConnectors } from './src/system/connectors/index.js';
import { resolveShowcaseSelfUrl } from './src/system/self-url.js';
import {
  allPositions,
  allPermissionSets,
  allCapabilities,
  allSharingRules,
} from './src/security/index.js';
import { allThemes } from './src/ui/themes/index.js';
import { ShowcaseTranslationBundle } from './src/system/translations/index.js';
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
    // Protocol major this package is authored against (ADR-0087). The kernel
    // checks the range at load time and refuses a major-incompatible runtime
    // with a structured diagnostic instead of failing deep in a schema parse.
    engines: { protocol: '^17' },
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
  requires: ['ui', 'automation', 'approvals', 'messaging', 'triggers', 'job', 'marketplace', 'webhooks', 'realtime'],

  // Concrete connectors for the `connector_action` node. The baseline engine
  // ships the dispatch node + an empty registry; these plugins populate it.
  //   • rest    → points at the running server itself, so the REST connector
  //               flow's call + response are observable on the flow run with no
  //               external dependency. The target is resolved by
  //               src/system/self-url.ts — SHOWCASE_SELF_URL, else the CLI's
  //               own OS_PORT / PORT, else http://127.0.0.1:3000 — and the
  //               declarative connector instances in src/system/connectors/
  //               resolve through the SAME helper (#7538).
  //   • slack   → registered so TaskCompletedSlackFlow resolves its connector;
  //               live posting needs a real bot token (set SLACK_BOT_TOKEN).
  //   • openapi → option-less: contributes only the `openapi` provider factory
  //               (ADR-0097), which materializes the StatusOpenApiConnector
  //               declarative instance below — its OpenAPI document is a
  //               package-relative FILE PATH read at boot (#3016).
  //   • mcp     → contributes the `mcp` provider factory, which materializes
  //               the DevToolsMcpConnector declarative instance from the
  //               in-repo stdio fixture (scripts/mcp-fixture.mjs). The
  //               `declarativeStdio` allowlist is the #3055 security opt-in:
  //               declarative stdio transports spawn a local process from
  //               METADATA, so they are denied by default; this host
  //               deliberately trusts `node` to run the in-repo fixture.
  //               (A coarse boundary by design — trusting `node` trusts what
  //               it is asked to run; real deployments should list specific
  //               server binaries.)
  plugins: [
    new ConnectorOpenApiPlugin(),
    new ConnectorMcpPlugin({ declarativeStdio: ['node'] }),
    new ConnectorRestPlugin({
      name: 'rest',
      // Shared with the declarative connector instances in
      // src/system/connectors/ (#7538) — one resolver, so the two self-URL
      // sources cannot drift apart.
      baseUrl: resolveShowcaseSelfUrl(),
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
  views: [TaskViews, ProjectViews, InquiryViews, BusinessUnitViews, ContactViews, FieldZooViews],
  pages: [CapabilityMapPage, StartHerePage, ComponentGalleryPage, ProjectWorkspacePage, ProjectDetailPage, TaskWorkbenchPage, TaskTriagePage, TaskBoardPage, TaskCalendarPage, TaskGalleryPage, TaskSchedulePage, TaskTimelinePage, TaskMapPage, TaskAllViewsPage, ActiveProjectsPage, TaskDetailPage, ReviewQueuePage, NewProjectWizardPage, MyWorkPage, SettingsPage, StylingGalleryPage, CommandCenterPage, CommandCenterJsxPage, CrmWorkbenchPage, TaskDeskPage, PageVariablesPage, ContactFormPage, RenewalsPipelinePage],
  dashboards: [ChartGalleryDashboard, OpsDashboard, RevenuePulseDashboard],
  books: allBooks,
  datasets: [ShowcaseTaskDataset, ShowcaseProjectDataset, ShowcaseInvoiceDataset, ShowcaseAccountDataset],
  reports: allReports,
  actions: allActions,
  themes: allThemes,

  // Logic
  flows: allFlows,
  // Named callables a `script` flow node invokes (#1870). Since #4343 that is
  // the ONLY thing a script node does, so this map is what makes one runnable.
  // A flow function is PURE: it takes `inputs`, RETURNS a value, and a later
  // declarative node uses or persists it — it does no data I/O of its own
  // (#4396), which is why it needs no `effect` declaration here.
  //
  // A JOB handler resolves through this same map (`collectBundleFunctions`), so
  // `sweepProjectHealth` — the handler `HealthSweepJob` names — lives here too.
  // It is the case the pure contract does not cover: a nightly sweep has no
  // downstream declarative node to persist for it, so it writes over an engine
  // handle captured at `onEnable`. That is why it is spelled the DECLARED way
  // (#4396) — an undeclared writer is counted as having written nothing, which
  // is indistinguishable from the broken sweep #4354 exists to detect.
  //
  // This entry authored the bare form until #4976, not because the bare form was
  // right but because the declared one could not survive `objectstack build`:
  // the CLI lowers it to `{ handler: 'sweepProjectHealth', effect: 'writes' }`
  // and `FlowFunctionEntrySchema` had no member for a declaration whose handler
  // is a ref, so `pnpm build` failed with `functions: invalid_union`. #4976
  // added that member; the honest spelling is back, and this app is the
  // end-to-end proof that it builds.
  functions: {
    summarizeCompletedTask: ({ input }: { input: Record<string, unknown> }) =>
      `Completed: ${String(input.title ?? 'task')} (priority ${String(input.priority ?? 'normal')}).`,
    sweepProjectHealth: { handler: sweepProjectHealth, effect: 'writes' as const },
  },
  jobs: allJobs,
  emailTemplates: allEmails,
  // Declarative REST endpoints (object_operation + flow) — LIVE again since
  // #5040 landed the executor and E7 narrowed #4936's blanket refusal to
  // per-endpoint publish gates. Both paths sit under this app's ADR-0121 D1
  // carve-out `/api/v1/apps/<manifest.namespace>/…`, which is why
  // `manifest.namespace: 'showcase'` above is load-bearing rather than
  // decorative: publish rejects an `apis:` block without it. See
  // src/system/apis/ for the declarations and the `authRequired` reasoning;
  // src/system/server/recalc-endpoint.ts remains the code-mounted counterpart.
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
  // Make the v16 approval features (会签 / quorum) demonstrable on a fresh boot:
  // assign the dev admin the approver positions and launch the signoff flows so
  // real pending requests land in the inbox (cannot be a seed — see
  // seed-approval-demo.ts).
  registerShowcaseApprovalDemo(ctx as Parameters<typeof registerShowcaseApprovalDemo>[0]);
  // Hand the nightly health-sweep job its data handle. A job handler is invoked
  // by the job service with `{ jobId, data }` and no engine (flow functions are
  // pure by default, #4396), so `onEnable` — the one place the app is handed a
  // live engine — is where the sweep gets one.
  bindShowcaseJobRuntime(ctx as Parameters<typeof bindShowcaseJobRuntime>[0]);
};
