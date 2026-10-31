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
  },
  auth: { type: 'bearer', credentialRef: 'GITHUB_MCP_TOKEN' },
});
