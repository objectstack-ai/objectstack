// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * skill — the generic, portable ObjectStack Agent Skill.
 *
 * Per ADR-0036 (Amendment C): the cross-agent distributable is ONE generic
 * Skill, not per-app artifacts and not hand-maintained vendor config snippets.
 * Agent Skills (`SKILL.md`) is an open, cross-platform standard (Claude Code,
 * OpenAI Codex, Gemini CLI, Copilot, Cursor, …), so this single skill teaches
 * any skills-capable agent how to drive an ObjectStack environment over MCP.
 *
 * The skill content is GENERIC — it never enumerates a tenant's schema (that is
 * discovered live via the `list_objects` / `describe_object` MCP tools). Only
 * the connection URL is environment-specific, slotted in by
 * {@link renderSkillMarkdown}. So one skill install works for every env and
 * every app the caller's key can reach; building a new app needs no reinstall.
 *
 * This module is the single source of truth for the skill; serve it (objectui /
 * cloud) by calling {@link renderSkillMarkdown} with the env's MCP URL.
 */

/** Skill identity (mirrors the `SKILL.md` YAML frontmatter). */
export const OBJECTSTACK_SKILL_NAME = 'objectstack';
export const OBJECTSTACK_SKILL_DESCRIPTION =
  'Query and modify data in an ObjectStack app over MCP — discover objects, ' +
  'read and filter records, and create/update/delete under your own ' +
  'permissions and row-level security. Use when the user wants to inspect or ' +
  'change data in their ObjectStack environment.';

export interface RenderSkillOptions {
  /**
   * The environment's MCP endpoint, e.g. `https://acme.objectos.app/api/v1/mcp`.
   * When omitted a clearly-marked placeholder is used so the skill is still
   * valid and self-explanatory.
   */
  mcpUrl?: string;
  /** Optional human label for the environment, shown in the intro. */
  envName?: string;
}

const URL_PLACEHOLDER = '<YOUR_ENV_MCP_URL>'; // e.g. https://<env>.objectos.app/api/v1/mcp

/**
 * Render the full `SKILL.md` (YAML frontmatter + body). Pass the env's MCP URL
 * to produce a ready-to-install skill; the body is otherwise generic.
 */
export function renderSkillMarkdown(options: RenderSkillOptions = {}): string {
  const url = options.mcpUrl?.trim() || URL_PLACEHOLDER;
  const envLabel = options.envName?.trim();
  const intro = envLabel
    ? `This skill connects you to the **${envLabel}** ObjectStack environment.`
    : 'This skill connects you to an ObjectStack environment.';

  return `---
name: ${OBJECTSTACK_SKILL_NAME}
description: ${OBJECTSTACK_SKILL_DESCRIPTION}
---

# ObjectStack

${intro} An ObjectStack environment exposes its data **objects** (tables) and
its business **actions** (registered app logic: approvals, conversions, flow
triggers) as tools over the Model Context Protocol (MCP). Every operation runs **as you** —
under your account's permissions and row-level security — so you may see a
subset of rows, or get a permission error on a write. That is expected
governance, not a failure.

## When to use

Use these tools whenever the user wants to **inspect or change data** in their
ObjectStack app — look up records, filter/report, create or update entries,
clean up data — or **run a business action** the app defines (approve a
request, convert a lead, kick off a flow). Prefer these tools over guessing —
the environment is the source of truth, and an action is always better than
hand-editing the records it would have touched.

## Connect

This skill drives the MCP server at:

\`\`\`
${url}
\`\`\`

Two authentication tracks are supported:

**OAuth (recommended for interactive clients).** Add the URL as a remote MCP
server with no credentials; the deployment is its own OAuth 2.1 authorization
server, so an OAuth-capable client (claude.ai custom connectors, Claude
Desktop, Claude Code) discovers it automatically, registers itself, and opens
a browser login. You sign in as yourself and every tool call runs under your
own permissions. Example (Claude Code):

\`\`\`
claude mcp add --transport http objectstack ${url}
\`\`\`

**API key (headless: CI, scripts, agents without a browser).** Send an
ObjectStack API key as a request header (the key is shown to you once when
created; treat it like a password):

\`\`\`
x-api-key: <YOUR_API_KEY>
\`\`\`

(\`Authorization: ApiKey <YOUR_API_KEY>\` and \`Authorization: Bearer
<YOUR_API_KEY>\` are also accepted.) If your MCP client supports custom
headers on a remote server, set the header there.

## Discover before you act

The schema is **not** baked into this skill — it is discovered live, so it is
always current even as the app evolves:

1. \`list_objects\` — see what objects exist.
2. \`describe_object({ objectName })\` — get an object's fields (name, type,
   required) before querying or writing it.
3. \`list_actions\` — see what business actions you may run (each entry
   includes its parameters and whether it needs a \`recordId\`).

Always discover the relevant object's shape before constructing a filter or a
create/update payload.

## Tools

- **list_objects()** — list available objects (system \`sys_*\` objects are hidden).
- **describe_object({ objectName })** — an object's fields and features.
- **query_records({ objectName, where?, fields?, limit?, offset?, orderBy? })** —
  read records. \`where\` is a field→value match, e.g. \`{ "status": "open" }\`.
  Results are page-capped; use \`limit\`/\`offset\` to page.
- **get_record({ objectName, recordId })** — fetch one record by id.
- **create_record({ objectName, data })** — create a record.
- **update_record({ objectName, recordId, data })** — change fields on a record.
- **delete_record({ objectName, recordId })** — delete a record (destructive —
  confirm with the user first).
- **list_actions()** — list the business actions you are permitted to run, with
  each action's declared parameters, whether it operates on a record, and
  whether it is flagged destructive.
- **run_action({ actionName, objectName?, recordId?, params? })** — invoke a
  business action by name. This executes the app's registered logic (can
  mutate data or trigger flows) under your permissions and RLS. Pass
  \`recordId\` for record-scoped actions and \`params\` for declared inputs;
  \`objectName\` only disambiguates a name shared by multiple objects.

## Conventions & gotchas

- **Permissions/RLS apply to every call.** Fewer rows than expected, or a
  write that's rejected, usually means your key isn't authorized — don't retry
  blindly; tell the user.
- **Discover, don't assume.** Object and field names vary per app; always
  \`list_objects\` / \`describe_object\` first.
- **Writes are real and immediate.** There is no implicit dry-run. Confirm
  destructive actions (\`delete_record\`, bulk updates) with the user.
- **Page large reads.** Use \`limit\`/\`offset\` rather than asking for everything.
- **Prefer actions over hand-edits.** When \`list_actions\` offers an action for
  the task (approve, convert, close, …), call it instead of updating the
  records yourself — actions carry the app's validation and side effects.
  Confirm first when an action is record-destructive or flagged for
  confirmation.

## Recommended workflow

1. \`list_objects\` (and \`list_actions\` when the task sounds like a business
   operation) to orient.
2. \`describe_object\` on the target object.
3. \`query_records\` to read / verify current state.
4. \`run_action\` when a matching business action exists; otherwise
   \`create_record\` / \`update_record\` / \`delete_record\` — confirming
   destructive steps with the user.
`;
}
