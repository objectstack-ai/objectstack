// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import { StripeConnector } from './src/connectors/stripe.connector.js';
import { allFlows } from './src/flows/stripe.flows.js';

/**
 * Stripe connector app (read only) — open edition (every key it uses runs on
 * the open tier), so it lives in this repository and is validated by its CI
 * against the runtime at HEAD. One declarative connector over Stripe's own
 * OpenAPI document, two flows that use it; no objects, no secret. The listing
 * is `objectstack.manifest.json`, and the README is what the administrator
 * reads before installing.
 */
export default defineStack({
  manifest: {
    id: 'app.objectstack.connector-stripe',
    namespace: 'stripe',
    version: '0.1.0',
    type: 'app',
    name: 'Stripe',
    description: 'Read Stripe customers, charges, invoices and payment intents from flows, over Stripe\'s OpenAPI document.',
    engines: { protocol: '^18' },
  },

  // `automation` materializes the `connectors:` entry at boot and runs the
  // flows; the executor below registers the `openapi` provider with it.
  requires: ['automation'],

  // The generic `openapi` executor, zero-arg: it contributes the provider
  // factory only, which reads the packaged document through the host's
  // package-file capability (confined to this package's root).
  plugins: [new ConnectorOpenApiPlugin()],

  connectors: [StripeConnector],
  flows: allFlows,
});
