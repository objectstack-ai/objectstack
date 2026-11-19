/**
 * objectstack-skill — client-side renderer for the portable ObjectStack Agent
 * Skill (`SKILL.md`), used by the Integrations page "Download skill" button.
 *
 * CANONICAL SOURCE: `renderSkillMarkdown` in `@objectstack/mcp`
 * (`packages/mcp/src/skill-md.ts`). That package pulls in the MCP SDK and is
 * not browser-friendly to import here, so this is a mirror of what the server
 * serves to a caller with no OAuth scopes (an API key or a session): the data
 * skill, with no authoring section and no federation tools. It must stay
 * byte-identical to that render, and two tests compare the two, each from its
 * own side, so an edit to either side without the other goes red:
 *   - `objectstack-skill.test.ts` beside this file imports the canonical
 *     renderer from source; it runs when Test UI does;
 *   - `packages/mcp/src/skill-md.test.ts` imports THIS file from source; it
 *     runs in Test Core on every `packages/mcp` change, which never starts
 *     Test UI (#31017).
 *
 * ⛔ So this file stays IMPORT-FREE. The mcp test, and the type-check program
 * of `packages/mcp/tsconfig.test.json`, compile it as part of that package's
 * tests, where none of the Console's aliases, dependencies or DOM types exist.
 * An import added here must resolve from `packages/mcp`'s test program too,
 * or Test Core goes red on every MCP change for a reason that has nothing to
 * do with the drift it pins.
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

- **list_objects()** — list available objects. System \`sys_*\` objects are hidden,
  except the few declared readable by agents, such as \`sys_user\` (read only).
- **describe_object({ objectName })** — an object's fields and features. A
  \`readonly\` field is never set in a write (a computed value or a declared
  read-only field); \`readonly\` is the schema's, not your edit permission, so a
  write naming a field you may not edit is refused. Send an option's \`value\`.
  To get a \`defaultValue\`, omit the field: a token (\`NOW()\`, \`current_user\`)
  or an expression object is never copied. A validation's \`message\` is what a
  refused write answers.
- **validate_expression({ objectName, expression, site?, severity?, triggerKind?, sweepObject?, startCondition?, variables?, field? })** — check a CEL
  expression against an object's schema *before* you author it into a formula,
  validation, or flow condition. Returns build-time errors (bare field refs,
  unknown fields/functions; at a \`formula\` or \`validation\` site, every other
  refusal the publish gate gives there: a reference read both through the
  relationship and as a value, more than one hop, a hop to a field the target
  does not declare or into a stored-metadata table, and at a \`validation\` site
  an unguarded nullable field or a read of \`parent\`; at a \`flow_condition\`
  of a record-triggered flow, an unguarded nullable \`record.\`/\`previous.\`
  read) and advisory warnings
  (text/boolean fields misused in arithmetic; date-equality pitfalls; an error
  at a \`validation\` site,
  worded for the rule's \`severity\`, and at a \`flow_condition\` of a
  record-triggered or time-relative flow, where it fails the run; a warning on
  any other flow; at a \`formula\`, \`validation\` or \`flow_condition\` site,
  a read of an external object's unprovisioned system column; for a stored
  (non-formula) \`field\`, a read of another record, the clock, the user or a
  permission), plus the fields and stdlib
  functions in scope. A hop target follows the same system-object fence as
  \`describe_object\`. \`site\` is \`formula\` | \`validation\` |
  \`flow_condition\` | \`template\` (default \`formula\`). Pass the rule's
  \`severity\` or the flow's \`triggerKind\` (\`record_change\` by default) to
  get the verdict the publish gate gives that rule or flow; for a
  \`time_relative\` flow, pass the object its sweep scans (\`timeRelative.object\`)
  as \`objectName\`: its conditions read rows of that object, and a start whose
  \`objectName\` names another object is refused at publish
  (\`flow-time-relative-object-mismatch\`). \`sweepObject\` names that same object.
  At a \`flow_condition\` the verdict is the runtime publish gate's, the one a
  flow saved through MCP meets: \`os validate\` also judges bare names and
  unbound roots over the whole flow, so write \`record.<field>\`, and pass the
  flow's \`startCondition\` for an edge or \`decision\` condition after it, and
  its declared \`variables\`: the shadowed-read warning, and the binding of a
  bare name to the variable rather than the field, need them at a
  \`flow_condition\`. Pass \`field\` (formula) to be judged as that field: its type, and the formula
  cycle it would close; a field not yet declared is judged as a new formula.
- **query_records({ objectName, where?, fields?, limit?, offset?, orderBy?, expand?, latestPer? })** —
  read records. \`where\` is a field→value match, e.g. \`{ "status": "open" }\`.
  Results are page-capped; use \`limit\`/\`offset\` to page. The answer's
  \`source\` names the object, filter, measures and grouping its figures came
  from; \`source.line\` is that source in the user's language. For "each X with
  its latest Y", \`latestPer: { "by": ["account"], "orderBy": [{ "field":
  "close_date", "order": "desc" }] }\` answers one record per group (ties go by
  id). \`expand: ["account"]\` returns a lookup as the record it names; a field
  whose object this door does not serve you refuses the call.
- **aggregate_records({ objectName, aggregations, groupBy?, where?, orderBy?, limit? })** —
  counts, sums and breakdowns, computed by the database under your
  permissions. Groups of a select field come in the field's option order; an
  amount over one fixed currency names its ISO 4217 code in \`currencies\`. A
  lookup group carries \`<key>__label\`, the record's name: name the group by
  it, and where it has none, say the record cannot be named rather than
  quoting the id.
- **get_record({ objectName, recordId, related? })** — fetch one record by id.
  \`related: [{ "object": "crm_opportunity" }]\` adds up to 3 lists of the
  records that point at it (name \`field\` when the child points here through
  several fields), each under your permissions on that object; a list with
  \`truncated: true\` has more rows.
- **create_record({ objectName, data })** — create a record.
- **update_record({ objectName, recordId, data })** — change fields on a record.
- **delete_record({ objectName, recordId, confirm })** — delete a record.
  The server REFUSES a call without \`confirm: true\`
  (\`ACTION_CONFIRMATION_REQUIRED\`) and nothing is deleted.
  A request in which the human names the record to delete, with exactly one record matching, is the human's approval of that delete: send confirm: true on that call, without asking again.
  When the name matches more than one record, or the request does not identify one record, do not delete yet: list the candidates, ask the human which one, and send confirm: true only after the answer.
  A deleted business record goes to the recycle bin and can be restored there until the
  deployment's retention ends (30 days by default); the answer names the entry
  as \`recycleBinEntryId\`. An answer without one was a permanent delete: a
  platform object's record (\`sys_\`, \`cloud_\`, \`ai_\`), or any record on a
  deployment with no recycle bin. No MCP tool restores: tell your human the
  record can be restored from the recycle bin (the console, or the REST
  recycle-bin restore route).
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
  stops the call and names the record it stopped at. \`recycleBinEntries\`
  lists each deleted record the recycle bin kept, with its
  \`recycleBinEntryId\`; a deleted record not listed was deleted permanently.
  Over OAuth it needs both \`data:read\` and \`data:write\`.
- **list_actions()** — list the business actions available to you (only those
  the app author exposed to AI and your permissions allow), with each
  action's declared parameters, whether it operates on a record, and whether
  it is flagged destructive. An action that carries \`unavailable\` is listed
  but \`run_action\` would refuse it for you (your credential, or your role in
  this organization): \`unavailable.reason\` says why and what would let it
  run, so tell your human instead of calling it.
- **run_action({ actionName, objectName?, recordId?, params? })** —
  invoke a business action by name. Invocation is permission-gated, but the
  action body executes the app's registered logic as trusted code (it can
  mutate data or trigger flows with the app's own authority). Pass
  \`recordId\` for record-scoped actions and \`params\` for declared inputs;
  \`objectName\` only disambiguates a name shared by multiple objects. An
  action \`list_actions\` reports as \`requiresConfirmation\` may need a
  person's approval, which you cannot give: when its author declared it and
  your client supports elicitation on a connection that can carry it, the
  person is asked in your client — accept runs the call once, and any other
  answer refuses it (\`ACTION_CONFIRMATION_REQUIRED\`); do not retry unless
  they ask. Otherwise the call does not run, and you are answered
  \`status: "pending_confirmation"\` with a \`pendingId\` — the person
  approves or rejects it in the app, so relay the message and do not retry.
  A server that cannot hand it off
  refuses it (\`ACTION_CONFIRMATION_REQUIRED\`, \`details.reason\`
  \`no_confirmation_service\`) and nothing runs: the person performs it in the
  app. Never send \`confirm\`: the tool refuses a call that carries it, on
  every action. Under an AI service
  account's own key (an agent acting for itself, for no person) the call is
  refused whatever it sends and nothing runs: hand the action to a person, or
  its author declares \`ai.requiresConfirmation: false\` when it is safe
  unattended. A flow action that fails answers \`FLOW_FAILED\`: tell the user
  the reason its second text block gives, never the flow and node chain.
- **resume_run({ runId, values? })** — continue a flow run that
  \`run_action\` answered with \`status: "paused"\` and a \`screen\` (a form the
  flow needs filled in). Send the screen's field values in \`values\`, keyed by
  the names in \`screen.fields\`. The run completes, or pauses again on its next
  screen, which you fill with another \`resume_run\`. Only the user whose call
  started the run can resume it, under the same gates as \`run_action\`
  (the person's confirmation, in your client or in the app, for an action its
  author declared \`requiresConfirmation\`, the refusal of a call that sends \`confirm\`,
  and its refusal under an AI service account's own key whatever the call sends).

## Conventions & gotchas

- **Permissions/RLS apply to every call.** Fewer rows than expected, or a
  write that's rejected, usually means your key isn't authorized — don't retry
  blindly; tell the user.
- **Discover, don't assume.** Object and field names vary per app; always
  \`list_objects\` / \`describe_object\` first.
- **Writes are real and immediate.** There is no implicit dry-run. Confirm
  destructive actions (\`delete_record\`, bulk updates) with the user; a
  \`delete_record\` the user named, with exactly one record matching, is
  already confirmed.
- **Page large reads.** Use \`limit\`/\`offset\` rather than asking for everything.
- **People are \`sys_user\` records.** A person field (owner, approver,
  employee) holds a user id. Find it with \`query_records\` on \`sys_user\`:
  \`where: { "email": "..." }\` for exactly one person, or
  \`{ "name": { "$contains": "..." } }\`. Names repeat: when several people
  share a name, tell them apart by email, and ask your human which one if
  unsure. You see the colleagues your console's person picker shows you (your
  organization, directory fields), and \`sys_user\` is read only.
- **Approvals waiting on you.** Where the app runs approvals, query
  \`sys_approval_request\` with
  \`where: {"status":"pending","pending_approvers":{"$contains":"{current_user_id}"}}\`
  (\`{current_user_id}\` stands for you), and decide one with \`run_action\`.
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
   destructive steps with the user (a delete the user named, with exactly one
   record matching, is already confirmed).
`;
}
