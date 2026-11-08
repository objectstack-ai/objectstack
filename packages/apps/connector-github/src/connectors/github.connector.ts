// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConnector } from '@objectstack/spec/integration';

/**
 * GitHub over its remote MCP server — recipe 2 of the integration recipes
 * (`skills/objectstack-automation/references/integration-recipes.md`): a
 * declarative `provider: 'mcp'` instance (ADR-0097) the `mcp` executor
 * materializes at boot by calling the server's `tools/list`.
 *
 * The server URL and the token header are GitHub's own
 * (github/github-mcp-server `docs/remote-server.md` and the README's remote
 * configuration): `https://api.githubcopilot.com/mcp/`, authenticated by
 * `Authorization: Bearer <personal access token>`. The `bearer` auth below is
 * folded into exactly that header by the executor; the token itself is never
 * in this file — `credentialRef` names it, and the administrator supplies the
 * value (an environment variable of that name, or Setup → Integrations →
 * Connector Credentials).
 *
 * `X-MCP-Readonly: true` asks the server to list only its read tools, and
 * `include` narrows those to the two this app's flows call. An `include`
 * entry the server does not list is refused at materialization, never
 * silently dropped.
 *
 * `toolsSnapshot` pins every included tool (ruling 6556740185, letter B: an
 * MCP app on the shelf ships one pin per tool it includes, and its listing's
 * sha256 is the digest of this pin set). Each value is `mcpToolDigest` of the
 * tool as GitHub's server listed it, measured on 2026-11-06; the README's
 * Provenance section records who measured them, with what token, and the
 * pin-set digest. A server that rewrites or stops serving a pinned tool
 * degrades the instance with `CONNECTOR_UPSTREAM_CHANGED`: that is the signal
 * to re-measure, re-pin and re-publish, never to drop the pin.
 */
export const GitHubMcpConnector = defineConnector({
  name: 'github_mcp',
  label: 'GitHub (remote MCP)',
  type: 'api',
  description:
    "GitHub's remote MCP server, read tools only: issue search and single-issue reads, authenticated by a " +
    'personal access token the administrator supplies.',
  provider: 'mcp',
  providerConfig: {
    transport: {
      kind: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { 'X-MCP-Readonly': 'true' },
    },
    include: ['search_issues', 'issue_read'],
    toolsSnapshot: {
      search_issues: '443421e063c9330d4504a88b57def74d1f1e3d0793479068073630a1846eaeb0',
      issue_read: '380e96f3d78b5c893668ab48a2d72191a3906bdc4e5e5c89f9e92c3e9de6c392',
    },
  },
  auth: { type: 'bearer', credentialRef: 'GITHUB_MCP_TOKEN' },
});
