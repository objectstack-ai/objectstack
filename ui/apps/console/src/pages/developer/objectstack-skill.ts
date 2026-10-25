/**
 * objectstack-skill — client-side renderer for the portable ObjectStack Agent
 * Skill (`SKILL.md`), used by the Integrations page "Download skill" button.
 *
 * CANONICAL SOURCE: `renderSkillMarkdown` in `@objectstack/mcp` (framework).
 * That package pulls in the MCP SDK and is not browser-friendly to import here,
 * so this is a faithful mirror for the download UX. Keep the two in sync — the
 * unit test asserts the structural invariants (frontmatter, URL slot, tools).
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

${intro} An ObjectStack environment exposes its data **objects** (tables) as
tools over the Model Context Protocol (MCP). Every operation runs **as you** —
under your account's permissions and row-level security — so you may see a
subset of rows, or get a permission error on a write. That is expected
governance, not a failure.

## When to use

Use these tools whenever the user wants to **inspect or change data** in their
ObjectStack app: look up records, filter/report, create or update entries, or
clean up data. Prefer these tools over guessing — the environment is the source
of truth.

## Connect

This skill drives the MCP server at:

\`\`\`
${url}
\`\`\`

Authenticate with an ObjectStack API key sent as a request header (the key is
shown to you once when created; treat it like a password):

\`\`\`
x-api-key: <YOUR_API_KEY>
\`\`\`

(The header \`Authorization: ApiKey <YOUR_API_KEY>\` is also accepted.) If your
MCP client supports custom headers on a remote server, set the header there.

## Discover before you act

The schema is **not** baked into this skill — it is discovered live, so it is
always current even as the app evolves:

1. \`list_objects\` — see what objects exist.
2. \`describe_object({ objectName })\` — get an object's fields (name, type,
   required) before querying or writing it.

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

## Conventions & gotchas

- **Permissions/RLS apply to every call.** Fewer rows than expected, or a
  write that's rejected, usually means your key isn't authorized — don't retry
  blindly; tell the user.
- **Discover, don't assume.** Object and field names vary per app; always
  \`list_objects\` / \`describe_object\` first.
- **Writes are real and immediate.** There is no implicit dry-run. Confirm
  destructive actions (\`delete_record\`, bulk updates) with the user.
- **Page large reads.** Use \`limit\`/\`offset\` rather than asking for everything.

## Recommended workflow

1. \`list_objects\` to orient.
2. \`describe_object\` on the target object.
3. \`query_records\` to read / verify current state.
4. \`create_record\` / \`update_record\` / \`delete_record\` to make changes,
   confirming destructive steps with the user.
`;
}
