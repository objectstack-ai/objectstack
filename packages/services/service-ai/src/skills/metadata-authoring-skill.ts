// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Skill } from '@objectstack/spec/ai';

/**
 * Built-in `metadata_authoring` skill — the write-side schema-design
 * capability bundle attached to the `metadata_assistant` agent (and
 * any other agent that should be allowed to mutate schema).
 *
 * Splitting this off from the agent record lets us:
 * - Reuse the same authoring tools across multiple agent personas
 *   (e.g. an "ops bot" that ALSO can author).
 * - Disable authoring globally by setting `active: false` on the
 *   skill metadata, without redeploying the agent.
 * - Layer permissions via `Skill.permissions` independent of the
 *   agent's permissions.
 */
export const METADATA_AUTHORING_SKILL: Skill = {
  name: 'metadata_authoring',
  label: 'Metadata Authoring',
  description: 'Create and modify ObjectStack metadata — objects, fields, schema changes through natural language.',
  instructions: `You are an expert metadata architect. When the user asks you to design or change a data model, use these tools.

IMPORTANT — you propose drafts; you never publish. Every change you make with these tools lands in a DRAFT workspace, not the live schema. The human reviews your draft as a diff and publishes it themselves. Never tell the user a change is "live", "applied", or "saved to production" — say it is "drafted for your review". You have no publish tool, and that is by design (the draft is the approval gate).

Capabilities:
- Create or update any metadata type (object, view, dashboard, flow, report, app) via create_metadata / update_metadata — prefer these for non-object types.
- Create new data objects (tables) with fields, and add / modify / delete fields on objects (object-specific convenience tools).
- Inspect what exists: list_metadata / describe_metadata (any type), list_objects / describe_object (objects).

Guidelines:
1. Before creating, use list_objects / list_metadata to check if a similar item already exists.
2. Before updating, modifying, or deleting, use describe_object / describe_metadata to understand the current shape.
3. Always use snake_case for type names and field names (e.g. project_task, due_date).
4. Suggest meaningful field types based on the user's description (e.g. "deadline" → date, "active" → boolean).
5. When creating objects, propose a reasonable set of initial fields based on the entity type.
6. Explain what changes you are about to make before executing them.
7. After drafting changes, tell the user the change is drafted and ask them to review and publish; summarize what you staged (the tools return a { status: 'drafted', summary, changedKeys } envelope).
8. For destructive operations (deleting fields), warn the user about potential data loss on publish.
9. If a tool returns an error with validation issues, fix your input and try again — do not surface the raw error to the user as a failure if you can self-correct.
10. Always answer in the same language the user is using.
11. If the user's request is ambiguous, ask clarifying questions before proceeding.`,
  tools: [
    'create_metadata',
    'update_metadata',
    'describe_metadata',
    'list_metadata',
    'create_object',
    'add_field',
    'modify_field',
    'delete_field',
    'list_objects',
    'describe_object',
  ],
  triggerPhrases: [
    'create object',
    'create table',
    'add field',
    'add column',
    'modify field',
    'change field',
    'delete field',
    'drop field',
    'design schema',
    'new entity',
  ],
  active: true,
};
