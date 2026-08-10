// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Connect an agent" Setup page — plugin-carried UI metadata (#2714 Phase 1,
 * objectui#2363).
 *
 * The page ships WITH the MCP capability (same principle as the marketplace
 * pages in `@objectstack/cloud-connection`, cloud ADR-0009: the nav lives and
 * dies with the capability — no MCP plugin, no entry). The page body is the
 * SDUI widget `mcp:connect-agent`, provided by objectui's console app-shell:
 * it reads `/discovery` for the environment's MCP URL, renders per-client
 * connect cards (claude.ai / Claude Desktop / Claude Code / Cursor / VS Code /
 * Codex), mints API keys for headless callers, and links the SKILL.md
 * download (`GET /api/v1/mcp/skill`).
 *
 * Registered by {@link MCPServerPlugin} on `kernel:ready`, gated on the same
 * default-on switch as the HTTP surface — an opted-out deployment
 * (`OS_MCP_SERVER_ENABLED=false`) gets no page and no nav entry.
 */

export const CONNECT_AGENT_PAGE = {
  name: 'connect_agent',
  label: 'Connect an Agent',
  type: 'app' as const,
  template: 'default',
  kind: 'full' as const,
  isDefault: false,
  regions: [
    {
      name: 'header',
      width: 'full' as const,
      components: [
        {
          type: 'page:header',
          properties: {
            title: 'Connect an Agent',
            subtitle:
              'Give any MCP-capable AI client governed access to this environment — ' +
              'every call runs under the caller\'s own permissions and row-level security.',
            // `icon` removed here (#6946): `page:header` never drew one — retired from the spec.
          },
        },
      ],
    },
    {
      name: 'main',
      width: 'large' as const,
      components: [{ type: 'mcp:connect-agent', properties: {} }],
    },
  ],
};

export const CONNECT_AGENT_UI_BUNDLE = {
  id: 'com.objectstack.mcp.connect-agent-ui',
  namespace: 'sys',
  version: '0.1.0',
  type: 'plugin',
  scope: 'system',
  name: 'Connect an Agent UI',
  description: 'Setup page + navigation for connecting MCP clients to this environment.',
  pages: [CONNECT_AGENT_PAGE],
  navigationContributions: [
    {
      app: 'setup',
      group: 'group_integrations',
      priority: 110,
      items: [
        {
          id: 'nav_connect_agent',
          type: 'page',
          pageName: 'connect_agent',
          label: 'Connect an Agent',
          icon: 'bot',
        },
      ],
    },
  ],
};
