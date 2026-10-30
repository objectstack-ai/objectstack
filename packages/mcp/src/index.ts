// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/mcp
 *
 * ObjectStack as an MCP server. Exposes your app's objects (and registered AI
 * tools, data resources, agent prompts) over the Model Context Protocol — via
 * stdio (local) and Streamable HTTP (remote agents: Claude, Cursor, Codex,
 * Gemini, Copilot, …). The inbound sibling (consuming external MCP servers) is
 * `@objectstack/connector-mcp`.
 */

export { MCPServerPlugin } from './plugin.js';
export type { MCPServerPluginOptions } from './plugin.js';
export { MCPServerRuntime } from './mcp-server-runtime.js';
export type { MCPServerRuntimeConfig } from './mcp-server-runtime.js';
// [#26464] The host-injected authoring bridge behind `metadata:write`: the
// shapes a host passes to `handleHttpRequest` (`authoring`) and the door
// constant its access check branches on.
export { MCP_TOOL_DOOR } from './types.js';
export type {
  McpToolDoor,
  McpTokenPrincipal,
  McpAuthoringToolContext,
  McpAuthoringToolRegistry,
  McpAuthoringInjection,
} from './types.js';
export {
  registerObjectTools,
  registerActionTools,
  registerFederationTools,
  grantsAuthoringTools,
} from './mcp-http-tools.js';
export type {
  McpDataBridge,
  McpObjectSummary,
  RegisterObjectToolsOptions,
  McpActionBridge,
  McpActionSummary,
  McpActionParamSummary,
  RegisterActionToolsOptions,
  McpFederationBridge,
} from './mcp-http-tools.js';
// The portable `SKILL.md` distributable (ADR-0036 Amendment C) — NOT the
// `skill` metadata type; that one is projected onto MCP prompts just below.
export {
  renderSkillMarkdown,
  OBJECTSTACK_SKILL_NAME,
  OBJECTSTACK_SKILL_DESCRIPTION,
  OBJECTSTACK_SKILL_DESCRIPTION_WITH_AUTHORING,
  OBJECTSTACK_MCP_SERVER_NAME,
} from './skill-md.js';
export type { RenderSkillOptions } from './skill-md.js';
// The `skill` metadata type (`SkillSchema`) → MCP `prompts` primitive (#3905).
export {
  projectSkillPrompt,
  listSkillPrompts,
  registerSkillPrompts,
  skillPromptResult,
} from './skill-prompts.js';
export type { McpSkillBridge, SkillPrompt } from './skill-prompts.js';
export { CONNECT_AGENT_PAGE, CONNECT_AGENT_UI_BUNDLE } from './connect-ui.js';
