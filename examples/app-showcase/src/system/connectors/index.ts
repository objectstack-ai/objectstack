// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConnector, type Connector } from '@objectstack/spec/integration';

/**
 * Declarative `connectors:` — the collection now holds BOTH kinds (ADR-0096):
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
 *    calls it end-to-end. This is the #2977 / ADR-0096 upgrade of what used to
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
 * ADR-0096 provider-bound instance — declared as pure metadata, materialized
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
    'Provider-bound declarative connector instance (ADR-0096): authored as metadata, materialized into a live, ' +
    'dispatchable `rest` connector at boot. Unlike the ERP descriptor below, this one IS callable from a flow ' +
    'connector_action and appears in GET /connectors.',
  provider: 'rest',
  providerConfig: {
    // Points at the running server itself (the showcase dev port is 3000), so
    // the dispatch is observable with no external dependency. Kept a literal
    // because metadata files don't read env — the env-driven `rest` plugin
    // connector in objectstack.config.ts is the tunable one.
    baseUrl: 'http://127.0.0.1:3000',
  },
  auth: { type: 'none' },
});
export const ErpCatalogConnector = defineConnector({
  name: 'showcase_erp_catalog',
  label: 'ERP Integration (Catalog Descriptor)',
  type: 'saas',
  description:
    'Catalog-only descriptor documenting a planned ERP integration: what it is, how it authenticates, ' +
    'and which actions it will expose. Not dispatchable — see the connector plugins in ' +
    'objectstack.config.ts for the live registry entries this collection does NOT feed (#2612).',
  authentication: { type: 'api-key', key: 'SET_AT_INSTALL_TIME', headerName: 'X-API-Key' },
  // Descriptor-level action catalog: key + label + I/O JSON Schemas. Note the
  // deliberate absence of any execution binding (HTTP method/path) — that is
  // what keeps descriptors inert today and what ADR-0096's provider binding
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

export const allConnectors: Connector[] = [StatusApiConnector, ErpCatalogConnector];
