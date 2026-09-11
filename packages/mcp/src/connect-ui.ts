// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Connect an agent" page — plugin-carried UI metadata (#2714 Phase 1,
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
 *
 * ## Two nav entry points, one page (#16746)
 *
 * `POST /api/v1/keys` mints a `sys_api_key` bound to the CALLER, and this page
 * says the key "acts as you" — so the surface that mints it is a per-user
 * credential surface, not an administrative one. Reached only through Setup it
 * could not keep that promise: Setup declares `requiredPermissions:
 * ['setup.access']`, so every non-admin following the two-step guide stopped at
 * step 1 while the endpoint behind the button accepted them all along.
 *
 * The fix is a SECOND contribution, into the `account` app's Developer group
 * beside the `nav_account_api_keys` entry already shipping there. The Setup
 * entry stays for admins. ⛔ Ungating Setup is NOT the fix and was measured:
 * the app-level `setup.access` gate fires BEFORE the group gate, so dropping
 * the group gate alone changes nothing, and dropping both serves 14+ unrelated
 * Setup surfaces (Users, Organization, Branding, Feature Flags, …) to every
 * signed-in user — far past what this card asks for. ⛔ Nor is a
 * `requiresService: 'mcp'` gate on an `account.app.ts` entry: the `mcp` service
 * registers unconditionally in `init()` while this bundle registers behind
 * `isMcpServerEnabled()`, so such an entry outlives its page and 404s on an
 * opted-out deployment. A contribution registers exactly when the page
 * registers, which is why both entries live in THIS bundle and neither carries
 * a gate of its own.
 */

import type { Page } from '@objectstack/spec/ui';

export const CONNECT_AGENT_PAGE: Page = {
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
  description: 'Connect-an-Agent page + Setup and Account navigation for connecting MCP clients to this environment.',
  pages: [CONNECT_AGENT_PAGE],
  // Both entries point at the one `connect_agent` page and share the item id.
  // That is legal and deliberate, read off the fold rather than assumed: the
  // registry keys contributions by TARGET APP
  // (`appNavContributions: Map<string, …>`) and `applyNavContributions(app)`
  // consults only `get(app.name)`, so a nav item id is unique within one app's
  // navigation tree and nothing indexes it across apps — no id-keyed registry,
  // no de-duplication by id, and the translation bundles are keyed
  // `apps.<app>.navigation.<id>` (per-app namespaces, so one id yields two
  // distinct keys). Sharing it keeps ONE identity for one destination.
  //
  // ⛔ The two items are separate object literals, not one shared const: the
  // fold `structuredClone`s the APP but pushes `...c.items` by reference, so a
  // shared literal would put the same object in two apps' navigation trees and
  // any in-place consumer edit would leak across them.
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
    {
      // The per-user half. `ACCOUNT_APP` declares no `requiredPermissions` —
      // deliberately, so every authenticated user reaches their own security
      // surface — and `grp_account_developer` already carries
      // `nav_account_api_keys`. Targeted by NAME; `packages/platform-objects`
      // is not edited.
      app: 'account',
      group: 'grp_account_developer',
      // `priority` orders contributions among THEMSELVES within the group, and
      // the group's own static children always precede them. Stated rather
      // than defaulted, at the schema's declared default: no other package
      // contributes into this group today, so there is nothing to interleave
      // with and no reason to claim a position.
      priority: 200,
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
