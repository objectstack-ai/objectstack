// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';
import { ConnectorMcpPlugin } from '@objectstack/connector-mcp';
import { GitHubMcpConnector } from './src/connectors/github.connector.js';
import { allFlows } from './src/flows/github.flows.js';

/**
 * GitHub connector app — open edition (every key it uses runs on the open
 * tier), so it lives in this repository and is validated by its CI against
 * the runtime at HEAD. One declarative connector, two flows that use it; no
 * objects, no secret. The listing is `objectstack.manifest.json`, and the
 * README is what the administrator reads before installing.
 */
export default defineStack({
  manifest: {
    id: 'app.objectstack.connector-github',
    namespace: 'github',
    version: '0.1.0',
    type: 'app',
    name: 'GitHub',
    description: "Search and read GitHub issues from flows, through GitHub's remote MCP server.",
    engines: { protocol: '^18' },
  },

  // `automation` materializes the `connectors:` entry at boot and runs the
  // flows; the executor below registers the `mcp` provider with it.
  requires: ['automation'],

  // The generic `mcp` executor, zero-arg: it contributes the provider factory
  // only. The transport is http, so the stdio policy does not apply.
  plugins: [new ConnectorMcpPlugin()],

  connectors: [GitHubMcpConnector],
  flows: allFlows,
});
