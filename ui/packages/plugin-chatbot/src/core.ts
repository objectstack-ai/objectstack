/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `@object-ui/plugin-chatbot/core` — the side-effect-free half of this package
 * (objectui#13410).
 *
 * The package root re-exports `./renderer`, which registers the chat components
 * with `ComponentRegistry` when it is evaluated, and it statically reaches the
 * whole chat UI (`streamdown`, `shiki`, `motion`, the AI Elements). A host that
 * imports one helper from the root therefore keeps all of it. The console shell
 * did exactly that for the agent catalog and a few pure parsers, and the
 * `plugin-chatbot` chunk (169.6 KB gzipped) rode in every first page load.
 *
 * ⛔ Nothing exported here may import a chat UI module, `./renderer` or the
 * package root, directly or through a neighbour: the subpath is only worth
 * having while its closure stays the hooks and parsers below. The same names
 * are still exported from the package root, unchanged.
 */

// The agent catalog hook (talks to @objectstack/service-ai).
export { useAgents, resolveDefaultAgentName, PLATFORM_DEFAULT_AGENT, agentHasCapability } from './useAgents';
export type {
  UseAgentsOptions,
  UseAgentsReturn,
  AgentDescriptor,
  AgentCapabilities,
} from './useAgents';

// Agent alias resolution — friendly console routes ↔ built-in agent ids.
export {
  AGENT_ALIAS_GROUPS,
  agentAliasGroup,
  agentRouteName,
  resolveAgentParam,
  isBuiltinAgentName,
  isBuildAgent,
  isAskAgent,
} from './agentAliases';

// ADR-0057 #8 — the AI-usage-indicator refresh seam.
export { AI_USAGE_REFRESH_EVENT, emitAiUsageRefresh } from './aiUsageEvents';

// ADR-0038 L3 — the publish-health parse every publish-drafts host shares.
export { publishHealthFromResponse } from './publishHealth';
export type { PublishHealth, PublishOutcome } from './publishHealth';

// The pending-approval envelope parse the app-shell hydration mapper shares
// with the live one (objectui#8442). `mapMessages` holds only `import type`
// edges back into the chat UI, which are erased.
export { detectPendingApproval } from './mapMessages';
