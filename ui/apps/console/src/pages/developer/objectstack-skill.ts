/**
 * objectstack-skill — client-side renderer for the portable ObjectStack Agent
 * Skill (`SKILL.md`), used by the Integrations page "Download skill" button.
 *
 * CANONICAL SOURCE: `renderSkillMarkdown` in `@objectstack/mcp`
 * (`packages/mcp/src/skill-md.ts`). That package pulls in the MCP SDK and is
 * not browser-friendly to import here, so this is a mirror of what the server
 * serves to a caller with no OAuth scopes (an API key or a session): the data
 * skill, with no authoring section and no federation tools. It must stay
 * byte-identical to that render — `objectstack-skill.test.ts` imports the
 * canonical renderer from source and compares the two, so an edit to either
 * side without the other goes red there.
 *
 * Per ADR-0036 Amendment C this is ONE generic skill: it never enumerates a
 * tenant's schema (the agent discovers live via list_objects/describe_object);
 * only the connection URL is environment-specific.
 */

export interface RenderSkillOptions {
  /** The env's MCP endpoint, e.g. https://acme.objectos.app/api/v1/mcp */
  mcpUrl?: string;
  /** Optional human label for the environment. */
  envName?: string;
}

export const OBJECTSTACK_SKILL_NAME = 'objectstack';
/** The server name the `claude mcp add` snippet registers (mirrors `OBJECTSTACK_MCP_SERVER_NAME`). */
export const OBJECTSTACK_MCP_SERVER_NAME = 'objectstack';
export const OBJECTSTACK_SKILL_DESCRIPTION =
  'Query and modify data in an ObjectStack app over MCP — discover objects, ' +
  'read and filter records, and create/update/delete under your own ' +
  'permissions and row-level security. Use when the user wants to inspect or ' +
  'change data in their ObjectStack environment.';

const URL_PLACEHOLDER = '<YOUR_ENV_MCP_URL>';

export function renderObjectStackSkill(options: RenderSkillOptions = {}): string {
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
- **validate_expression({ objectName, expression, site?, severity?, triggerKind?, sweepObject? })** — check a CEL
  expression against an object's schema *before* you author it into a formula,
  validation, or flow condition. Returns build-time errors (bare field refs,
  unknown fields/functions) and advisory warnings (text/boolean fields misused
  in arithmetic; an error at a \`validation\` site, worded for the rule's
  \`severity\`, and at a \`flow_condition\` of a record-triggered or
  time-relative flow, where it fails the run; a warning on any other flow), plus the fields and
  stdlib functions in scope. \`site\` is \`formula\` | \`validation\` |
  \`flow_condition\` | \`template\` (default \`formula\`). Pass the rule's
  \`severity\` or the flow's \`triggerKind\` (\`record_change\` by default) to
  get the verdict the publish gate gives that rule or flow; for a
  \`time_relative\` flow, pass the object its sweep scans (\`timeRelative.object\`)
  as \`objectName\`: its conditions read rows of that object, and a start whose
  \`objectName\` names another object is refused at publish
  (\`flow-time-relative-object-mismatch\`). \`sweepObject\` names that same object.
- **query_records({ objectName, where?, fields?, limit?, offset?, orderBy? })** —
  read records. \`where\` is a field→value match, e.g. \`{ "status": "open" }\`.
  Results are page-capped; use \`limit\`/\`offset\` to page.
- **get_record({ objectName, recordId })** — fetch one record by id.
- **create_record({ objectName, data })** — create a record.
- **update_record({ objectName, recordId, data })** — change fields on a record.
- **delete_record({ objectName, recordId, confirm })** — delete a record,
  permanently. The server REFUSES a call without \`confirm: true\`
  (\`ACTION_CONFIRMATION_REQUIRED\`) and nothing is deleted. Ask your human
  first; the flag asserts an approval, it does not obtain one.
- **delete_records({ objectName, where | recordIds, confirm })** — delete many
  records of one object in one call, instead of one \`delete_record\` per row.
  Without \`confirm: true\` it deletes nothing and is REFUSED
  (\`ACTION_CONFIRMATION_REQUIRED\`) with a \`preview\`: how many records match
  and sample ids. Show that to your human, then retry with \`confirm: true\`.
  A confirmed call deletes up to 200 records (fewer on a deployment with
  a smaller read page; the answer's \`cap\` says), each under your permissions
  and the object's delete rules (no one bypasses them); refused records stay
  and come back grouped by reason with their ids, and \`remaining\` says how
  many still match. Call again to continue. A fault (not a rule's refusal)
  stops the call and names the record it stopped at. Over OAuth it needs both
  \`data:read\` and \`data:write\`.
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
