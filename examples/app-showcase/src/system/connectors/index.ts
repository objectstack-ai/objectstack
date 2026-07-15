// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConnector, type Connector } from '@objectstack/spec/integration';

/**
 * Declarative `connectors:` — catalog descriptors (#2612).
 *
 * A stack's `connectors:` collection is **descriptor-only**: entries register
 * as metadata (kind 'connector') for discovery, documentation, and future
 * marketplace listing, but they never reach the automation engine's connector
 * registry — `connector_action` cannot dispatch them. Live connectors are the
 * `plugins:` entries in objectstack.config.ts (ConnectorRestPlugin /
 * ConnectorSlackPlugin), which call `engine.registerConnector(def, handlers)`
 * (ADR-0018 §Addendum) and are exercised by the connector flows in
 * src/automation/flows/.
 *
 * `enabled: false` marks the entry as a deliberate catalog-only descriptor —
 * without it, the automation service's boot audit (rightly) warns that a
 * declared connector with actions has no runtime registration.
 *
 * Declarative provider-bound connector *instances* — entries a generic
 * executor (connector-openapi / connector-mcp) materializes into dispatchable
 * connectors at boot — are the planned upgrade of this collection, tracked in
 * https://github.com/objectstack-ai/framework/issues/2977 (ADR-0096).
 */
export const ErpCatalogConnector: Connector = defineConnector({
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

export const allConnectors: Connector[] = [ErpCatalogConnector];
