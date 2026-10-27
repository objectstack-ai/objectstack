// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * skill-md — the generic, portable ObjectStack Agent Skill (`SKILL.md`).
 *
 * ⚠️ TWO UNRELATED THINGS SHARE THE WORD "SKILL". This module is the
 * **`SKILL.md` distributable** — a markdown file an external coding agent
 * (Claude Code, Codex, Gemini CLI) installs to learn how to drive an
 * ObjectStack environment over MCP. It is NOT the `skill` **metadata type**
 * (`SkillSchema`, `packages/spec/src/ai/skill.zod.ts`) that an app author
 * writes as `*.skill.ts`; that one is projected onto the MCP `prompts`
 * primitive by {@link file://./skill-prompts.ts | skill-prompts.ts}. The file
 * was called `skill.ts` until #3905, where the collision was fixed by naming
 * each module after the artifact it owns — a `skill` grep in this package used
 * to find this file first and the metadata type never (#3905).
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

import type { AIToolDefinition } from '@objectstack/spec/contracts';
import { MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_METADATA_WRITE } from '@objectstack/spec/ai';
import { grantsAuthoringTools } from './mcp-http-tools.js';

/** Skill identity (mirrors the `SKILL.md` YAML frontmatter). */
export const OBJECTSTACK_SKILL_NAME = 'objectstack';
/**
 * The name every connect snippet this platform prints gives the MCP server
 * (the `<name>` in `claude mcp add --transport http <name> <url>`).
 *
 * ONE name for one endpoint: the served `SKILL.md` below and `os dev`'s boot
 * banner (`printMcpConnectHint` in `@objectstack/cli`) both read this
 * constant, so a reader who follows either never registers the same server
 * twice under two names. It is deliberately the platform's name, not the app
 * folder's or the manifest's: the served skill is generic across every app
 * the caller's key can reach (ADR-0036 Amendment C), and neither the skill
 * route nor discovery serves an app name a console snippet could read.
 */
export const OBJECTSTACK_MCP_SERVER_NAME = 'objectstack';
export const OBJECTSTACK_SKILL_DESCRIPTION =
  'Query and modify data in an ObjectStack app over MCP — discover objects, ' +
  'read and filter records, and create/update/delete under your own ' +
  'permissions and row-level security. Use when the user wants to inspect or ' +
  'change data in their ObjectStack environment.';
/**
 * [#26464] The frontmatter description served when the skill also teaches the
 * authoring tools (see {@link RenderSkillOptions.authoringTools}). A
 * skills-capable agent decides whether to load a skill from this one line, so
 * a skill that teaches building must SAY so here, or an agent asked to build
 * an object never opens it. The data sentence stays verbatim in front.
 */
export const OBJECTSTACK_SKILL_DESCRIPTION_WITH_AUTHORING =
  OBJECTSTACK_SKILL_DESCRIPTION +
  ` With the ${MCP_OAUTH_SCOPE_METADATA_WRITE} scope, also build and change the ` +
  'app\'s metadata (objects, fields, views, flows) as drafts a person publishes.';

export interface RenderSkillOptions {
  /**
   * The environment's MCP endpoint, e.g. `https://acme.objectos.app/api/v1/mcp`.
   * When omitted a clearly-marked placeholder is used so the skill is still
   * valid and self-explanatory.
   */
  mcpUrl?: string;
  /** Optional human label for the environment, shown in the intro. */
  envName?: string;
  /**
   * [#26464] The OAuth scopes the caller's token carries. The authoring
   * section renders only when they admit the family (`grantsAuthoringTools`:
   * a scope list naming `metadata:write`) AND {@link authoringTools} names at
   * least one tool — the same predicate that registers the family on the HTTP
   * surface, so the skill never teaches a tool the server would refuse.
   * Undefined (an API key, a session, or a host that serves the skill
   * publicly) renders the data skill exactly as before.
   */
  grantedScopes?: readonly string[];
  /**
   * The authoring tools the host injects for this caller (name and
   * description, as `tools/list` shows them). Which tools these are is the
   * host's business — this renderer names what it is handed and nothing else.
   */
  authoringTools?: ReadonlyArray<Pick<AIToolDefinition, 'name' | 'description'>>;
}

const URL_PLACEHOLDER = '<YOUR_ENV_MCP_URL>'; // e.g. https://<env>.objectos.app/api/v1/mcp

/** One line for a tool's description — a bullet in the skill cannot hold a paragraph break. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * [#26464] The authoring section, rendered only for a caller whose grant
 * admits the family and whose host injected at least one authoring tool. It
 * teaches the build loop the maintainer ruled for hosted MCP (cloud
 * ADR-0112): create, verify, and leave a draft that a person publishes in the
 * UI — from the same source as the data loop, so the client model learns both
 * the same way. Tool names come from the host; none is hard-coded here.
 */
function renderAuthoringSection(
  tools: ReadonlyArray<Pick<AIToolDefinition, 'name' | 'description'>>,
  describeObjectRegistered: boolean,
): string {
  const bullets = tools.map((t) => `- **${t.name}** — ${oneLine(t.description)}`).join('\n');
  // Name `describe_object` only when the same grant registers it (the data
  // gate: `data:read`). A metadata:write-only connection has no data tool, so
  // teaching one there would be teaching a tool the server refuses.
  const discover = describeObjectRegistered
    ? 'Discover first here too — `describe_object` on an object\nbefore you change it.'
    : 'Your grant carries no `data:read`, so the data tools are not on this\nconnection: read the current state through the authoring tools\' own verify\nstep before you change an object.';
  return `
## Build — authoring tools (\`${MCP_OAUTH_SCOPE_METADATA_WRITE}\`)

Your connection also carries the **\`${MCP_OAUTH_SCOPE_METADATA_WRITE}\`** scope, so this
environment exposes its **authoring tools**: you can build and change the app's
own metadata — objects, fields, views, flows and the rest — not only its
records. Authoring lands as **drafts**: nothing you write is published, and a
person reviews and publishes the drafts in the UI. Every authoring call is
checked against the scope AND your own metadata permissions, so a refused
authoring call means you may not author that here, not that the connection is
broken.

The build loop is **create → verify → draft**: create or change the metadata,
verify it (the environment validates what you wrote and reports what it
refuses, so read the result before the next step), and leave it as a draft for
a person to publish. ${discover}

${bullets}
`;
}

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
  // [#26464] The authoring section exists only for a grant the HTTP surface
  // would honour, and only when there is a tool to name — one predicate,
  // shared with `registerAuthoringTools`.
  const authoringTools =
    grantsAuthoringTools(options.grantedScopes) && options.authoringTools && options.authoringTools.length > 0
      ? options.authoringTools
      : undefined;
  const description = authoringTools ? OBJECTSTACK_SKILL_DESCRIPTION_WITH_AUTHORING : OBJECTSTACK_SKILL_DESCRIPTION;
  // Mirrors the native data gate in `wireBridgeTools` (`!scopes || scopes.includes(data:read)`).
  const describeObjectRegistered = !options.grantedScopes || options.grantedScopes.includes(MCP_OAUTH_SCOPE_DATA_READ);

  return `---
name: ${OBJECTSTACK_SKILL_NAME}
description: ${description}
---

# ObjectStack

${intro} An ObjectStack environment exposes its data **objects** (tables) and
its business **actions** (registered app logic: approvals, conversions, flow
triggers) as tools over the Model Context Protocol (MCP). Every operation runs
under the permissions and row-level security of the identity that connected you
— and, for an OAuth connection, **within the consent scopes you were granted**
(a read-only scope can never write, even where that user could). So you may see
a subset of rows, or get a permission error on a write. That is expected
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
a browser login. You authorize the connection in the browser; the client then
acts as an agent **on your behalf** — every tool call is bounded by the
intersection of the consent scopes you grant and your own permissions/RLS (it
can never exceed either). Example (Claude Code):

\`\`\`
claude mcp add --transport http ${OBJECTSTACK_MCP_SERVER_NAME} ${url}
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
- **validate_expression({ objectName, expression, site? })** — check a CEL
  expression against an object's schema *before* you author it into a formula,
  validation, or flow condition. Returns build-time errors (bare field refs,
  unknown fields/functions) and advisory warnings (text/boolean fields misused
  in arithmetic), plus the fields and stdlib functions in scope. \`site\` is
  \`formula\` | \`validation\` | \`flow_condition\` | \`template\` (default \`formula\`).
- **query_records({ objectName, where?, fields?, limit?, offset?, orderBy? })** —
  read records. \`where\` is a field→value match, e.g. \`{ "status": "open" }\`.
  Results are page-capped; use \`limit\`/\`offset\` to page.
- **get_record({ objectName, recordId })** — fetch one record by id.
- **create_record({ objectName, data })** — create a record.
- **update_record({ objectName, recordId, data })** — change fields on a record.
- **delete_record({ objectName, recordId })** — delete a record (destructive —
  confirm with the user first).
- **list_actions()** — list the business actions available to you (only those
  the app author exposed to AI and you are permitted to run), with each
  action's declared parameters, whether it operates on a record, and whether
  it is flagged destructive.
- **run_action({ actionName, objectName?, recordId?, params?, confirm? })** —
  invoke a business action by name. Invocation is permission-gated, but the
  action body executes the app's registered logic as trusted code (it can
  mutate data or trigger flows with the app's own authority). Pass
  \`recordId\` for record-scoped actions and \`params\` for declared inputs;
  \`objectName\` only disambiguates a name shared by multiple objects. Pass
  \`confirm: true\` on an action \`list_actions\` reports as
  \`requiresConfirmation\` — the server REFUSES such a call without it
  (\`ACTION_CONFIRMATION_REQUIRED\`) and nothing runs. Ask your human first;
  the flag asserts an approval, it does not obtain one.
- **resume_run({ runId, values?, confirm? })** — continue a flow run that
  \`run_action\` answered with \`status: "paused"\` and a \`screen\` (a form the
  flow needs filled in). Send the screen's field values in \`values\`, keyed by
  the names in \`screen.fields\`. The run completes, or pauses again on its next
  screen, which you fill with another \`resume_run\`. Only the user whose call
  started the run can resume it, under the same gates as \`run_action\`
  (including \`confirm: true\` for an action flagged \`requiresConfirmation\`).
${authoringTools ? renderAuthoringSection(authoringTools, describeObjectRegistered) : ''}
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
