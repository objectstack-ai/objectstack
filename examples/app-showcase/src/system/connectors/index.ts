// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConnector, type Connector } from '@objectstack/spec/integration';

import { resolveShowcaseSelfUrl } from '../self-url.js';

/**
 * Declarative `connectors:` — the collection now holds BOTH kinds (ADR-0097):
 *
 * 1. **Provider-bound instance** ({@link StatusApiConnector}) — a live,
 *    dispatchable connector authored as pure metadata. It names a `provider`
 *    (`rest`) and the automation service materializes it at boot: it looks up
 *    the provider factory `@objectstack/connector-rest` contributes, applies
 *    `providerConfig` + the resolved `auth`, and calls
 *    `engine.registerConnector(def, handlers)` for you. The result is
 *    indistinguishable from a hand-written connector — `connector_action`
 *    dispatches it and `GET /connectors` lists it. {@link
 *    file://../../automation/flows/index.ts | ShowcaseDeclarativeConnectorPingFlow}
 *    calls it end-to-end. This is the #2977 / ADR-0097 upgrade of what used to
 *    be a purely descriptor-only collection.
 *
 * 2. **Catalog descriptor** ({@link ErpCatalogConnector}, the #2612 interim
 *    contract) — an inert entry for discovery / documentation / marketplace
 *    listing. It has no `provider`, so it never reaches the connector registry;
 *    `connector_action` cannot dispatch it. `enabled: false` marks it a
 *    deliberate catalog-only descriptor and suppresses the boot audit warning
 *    for a declared-with-actions connector that has no runtime registration.
 *
 * Runtime connectors may also be contributed directly by plugins calling
 * `engine.registerConnector()` (ADR-0018 §Addendum) — the `rest`/`slack`
 * `plugins:` entries in objectstack.config.ts, exercised by the connector flows
 * in src/automation/flows/.
 */

/**
 * ADR-0097 provider-bound instance — declared as pure metadata, materialized
 * into a live `rest` connector at boot by ConnectorRestPlugin's provider factory
 * (which the plugin registers even though, here, it is also configured with a
 * hand-wired `rest` connector). Points at the running server itself, so
 * {@link file://../../automation/flows/index.ts | ShowcaseDeclarativeConnectorPingFlow}
 * can dispatch `GET /api/v1/health` through it with no external dependency and no
 * credentials. `auth: { type: 'none' }` keeps boot self-contained; a real
 * upstream would use `auth: { type: 'bearer', credentialRef: '<env var>' }`.
 */
export const StatusApiConnector = defineConnector({
  name: 'showcase_status_api',
  label: 'Status API (Declarative REST Instance)',
  type: 'api',
  description:
    'Provider-bound declarative connector instance (ADR-0097): authored as metadata, materialized into a live, ' +
    'dispatchable `rest` connector at boot. Unlike the ERP descriptor below, this one IS callable from a flow ' +
    'connector_action and appears in GET /connectors.',
  provider: 'rest',
  providerConfig: {
    // Points at the running server itself, so the dispatch is observable with
    // no external dependency. Resolved from the environment (#7538) via the
    // same helper objectstack.config.ts's `rest` plugin uses, so the two
    // self-URL sources cannot diverge: SHOWCASE_SELF_URL, else the CLI's own
    // OS_PORT / PORT, else http://127.0.0.1:3000. A literal here made every
    // self-ping flow fail `fetch failed` on any instance not listening on 3000
    // — and metadata modules DO read env: this file is evaluated by whichever
    // process loads objectstack.config.ts (see ../self-url.ts for when that is
    // boot time vs build time).
    baseUrl: resolveShowcaseSelfUrl(),
  },
  auth: { type: 'none' },
});
/**
 * ADR-0097 provider-bound instance, **file-path spec** form (#3016): the OpenAPI
 * document lives next to this file (`status-openapi.json`) and is referenced by
 * a path resolved relative to THIS package's root at materialization — reads
 * are confined to the package root (absolute / `..`-escaping paths are
 * rejected), and a missing or unparseable document fails boot loudly. The
 * `openapi` provider factory (ConnectorOpenApiPlugin in objectstack.config.ts)
 * turns the document's one operation (`getHealth` → `GET /api/v1/health`) into
 * a dispatchable action against the running server itself, so the materialized
 * connector is observable with no external dependency. Complements
 * {@link StatusApiConnector}, which demos the same materialization from the
 * `rest` provider's inline config.
 */
export const StatusOpenApiConnector = defineConnector({
  name: 'showcase_status_openapi',
  label: 'Status API (Declarative OpenAPI Instance, File-Path Spec)',
  type: 'api',
  description:
    'Provider-bound declarative connector instance (ADR-0097) whose OpenAPI document is referenced as a ' +
    'package-relative file path (#3016) and read at boot, confined to the package root. Materialized into a live ' +
    '`openapi` connector — getHealth dispatches GET /api/v1/health against the running server.',
  provider: 'openapi',
  providerConfig: {
    // Package-relative file ref (#3016) — resolved against the directory that
    // holds objectstack.config.ts (the CLI passes it as the automation
    // service's packageRoot). Inline documents and http(s) URLs stay valid.
    spec: './src/system/connectors/status-openapi.json',
    // Same env-resolved self URL as StatusApiConnector above (#7538). This
    // OVERRIDES the document's own `servers[0].url` — createOpenApiConnector
    // resolves `config.baseUrl ?? document.servers?.[0]?.url`
    // (packages/connectors/connector-openapi/src/openapi-connector.ts) — so the
    // static literal in status-openapi.json stays a documentation default and
    // is not what the dispatch actually uses.
    baseUrl: resolveShowcaseSelfUrl(),
  },
  auth: { type: 'none' },
});

/**
 * ADR-0097 provider-bound instance, **mcp** form (#3056, completing the live
 * demo deferred from #3017): the entry points at the tiny in-repo MCP fixture
 * server (`scripts/mcp-fixture.mjs`) over a **stdio** transport. At boot the
 * `mcp` provider factory (ConnectorMcpPlugin in objectstack.config.ts) spawns
 * the fixture, calls `tools/list`, and maps its one deterministic tool
 * (`echo_upper`) to a connector action — no network, no ports, no boot-ordering
 * coupling, so the demo is CI-deterministic.
 *
 * Two platform behaviors are dogfooded here:
 * - **#3055 stdio policy**: a declarative stdio transport spawns a local
 *   process from metadata, so it is denied by default; the host opts in via
 *   `new ConnectorMcpPlugin({ declarativeStdio: ['node'] })` in
 *   objectstack.config.ts. Remove that option and boot fails loudly with the
 *   opt-in instructions — try it.
 * - **#3049 degrade + retry**: if the fixture were unreachable (e.g. the
 *   script path wrong), boot would NOT crash — the instance registers
 *   `state: 'degraded'` on GET /connectors and the platform retries with
 *   backoff until it heals.
 */
export const DevToolsMcpConnector = defineConnector({
  name: 'showcase_mcp_tools',
  label: 'Dev Tools (Declarative MCP Instance)',
  type: 'api',
  description:
    'Provider-bound declarative connector instance (ADR-0097) backed by a Model Context Protocol server: the ' +
    'in-repo stdio fixture (scripts/mcp-fixture.mjs). Its tools/list becomes the action list — echo_upper is ' +
    'dispatched end-to-end by ShowcaseMcpConnectorEchoFlow.',
  provider: 'mcp',
  providerConfig: {
    // Spawned at materialization; the path is relative to the app's working
    // directory (`os dev`/`serve` run from the app root). The command must be
    // allowlisted by the host's declarativeStdio policy (#3055) — see
    // objectstack.config.ts.
    transport: { kind: 'stdio', command: 'node', args: ['./scripts/mcp-fixture.mjs'] },
  },
  auth: { type: 'none' },
});

export const ErpCatalogConnector = defineConnector({
  name: 'showcase_erp_catalog',
  label: 'ERP Integration (Catalog Descriptor)',
  type: 'saas',
  description:
    'Catalog-only descriptor documenting a planned ERP integration: what it is, how it authenticates ' +
    '(API key in the X-API-Key header, bound at install time), and which actions it will expose. ' +
    'Not dispatchable — see the connector plugins in objectstack.config.ts for the live registry ' +
    'entries this collection does NOT feed (#2612).',
  // No `authentication` block — a descriptor holds no live credentials (#7990:
  // the publish door refuses any non-`none` `authentication`, because the row
  // lands whole in `sys_metadata`). The auth SCHEME is prose in `description`;
  // when this becomes a dispatchable instance it declares `provider` and
  // references its key with `auth: { type: 'api-key', credentialRef: … }`
  // (ADR-0097 §3). Until #7990 this entry carried
  // `authentication: { type: 'api-key', key: 'SET_AT_INSTALL_TIME', … }` — a
  // placeholder, but the exact inline-cleartext shape the door now refuses.
  // Descriptor-level action catalog: key + label + I/O JSON Schemas. Note the
  // deliberate absence of any execution binding (HTTP method/path) — that is
  // what keeps descriptors inert today and what ADR-0097's provider binding
  // supplies declaratively.
  actions: [
    {
      key: 'get_invoice',
      label: 'Get Invoice',
      description: 'Fetch a single invoice from the ERP by its number.',
      inputSchema: {
        type: 'object',
        properties: { invoiceNumber: { type: 'string' } },
        required: ['invoiceNumber'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          invoiceNumber: { type: 'string' },
          status: { type: 'string' },
          totalAmount: { type: 'number' },
        },
      },
    },
    {
      key: 'post_journal_entry',
      label: 'Post Journal Entry',
      description: 'Write a journal entry into the ERP general ledger.',
      inputSchema: {
        type: 'object',
        properties: {
          account: { type: 'string' },
          amount: { type: 'number' },
          memo: { type: 'string' },
        },
        required: ['account', 'amount'],
      },
    },
  ],
  // Deliberate catalog-only descriptor: suppresses the boot inert-connector
  // audit warning (#2612).
  enabled: false,
});

export const allConnectors: Connector[] = [
  StatusApiConnector,
  StatusOpenApiConnector,
  DevToolsMcpConnector,
  ErpCatalogConnector,
];
