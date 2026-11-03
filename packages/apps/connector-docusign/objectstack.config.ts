// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import { DocuSignConnector } from './src/connectors/docusign.connector.js';
import { DocuSignEnvelope } from './src/objects/docusign-envelope.object.js';
import { allFlows } from './src/flows/docusign.flows.js';

/**
 * DocuSign eSignature connector app — open edition (every key it uses runs on
 * the open tier), so it lives in this repository and is validated by its CI
 * against the runtime at HEAD. One declarative connector over DocuSign's own
 * OpenAPI document, authorized by OAuth with the OAuth client each
 * deployment's administrator registers (ADR-0143 D2.1, `clientSource:
 * 'installer'`), one object that keeps each envelope's signature status, and
 * three flows that use them; no secret and no client of anyone's. The
 * listing is `objectstack.manifest.json`, and the README is what the
 * administrator reads before installing.
 */
export default defineStack({
  manifest: {
    id: 'app.objectstack.connector-docusign',
    namespace: 'docusign',
    version: '0.1.0',
    type: 'app',
    name: 'DocuSign eSignature',
    description: 'Send documents for signature, read envelopes and follow their signature status from flows, over DocuSign\'s eSignature OpenAPI document (developer sandbox).',
    engines: { protocol: '^18' },
  },

  // `automation` materializes the `connectors:` entry at boot, serves the
  // connection door an administrator connects it through, and runs the
  // flows; the executor below registers the `openapi` provider with it.
  requires: ['automation'],

  // The generic `openapi` executor, zero-arg: it contributes the provider
  // factory only, which reads the packaged document through the host's
  // package-file capability (confined to this package's root).
  plugins: [new ConnectorOpenApiPlugin()],

  objects: [DocuSignEnvelope],
  connectors: [DocuSignConnector],
  flows: allFlows,
});
