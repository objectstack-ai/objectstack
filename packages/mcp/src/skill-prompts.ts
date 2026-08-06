// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * skill-prompts — the `skill` metadata type, projected onto the MCP `prompts`
 * primitive.
 *
 * ⚠️ TWO UNRELATED THINGS SHARE THE WORD "SKILL". This module owns the
 * **metadata type** (`SkillSchema`, `packages/spec/src/ai/skill.zod.ts`) an app
 * author writes as `*.skill.ts`. The `SKILL.md` distributable an external
 * coding agent installs lives in {@link file://./skill-md.ts | skill-md.ts}.
 *
 * ## Why this exists (#3905)
 *
 * ADR-0063 §2 names skills (+ tools / MCP) the **only third-party extension
 * primitive**, and the open distribution is deliberately MCP-only (BYO-AI,
 * cloud ADR-0025): it ships no in-product agent runtime. Until this module,
 * that left `skill` metadata authorable, lint-validated (`validateAiToolReferences`
 * / `validateAiSurfaceAffinity`) — and consumed by nothing here. An open-source
 * author wrote a skill, it validated, it linted, and it never ran.
 *
 * A skill has two halves, and only one of them projects:
 *
 * - **`instructions`** (playbooks, judgment, persona) → an MCP **prompt**. The
 *   model lives client-side in MCP, and `prompts` is precisely the primitive
 *   for server-supplied instruction text a client can list and fetch. This is
 *   what the module projects.
 * - **`tools[]` / `surface`** (tool binding, agent affinity) → **not** projected.
 *   The MCP server exposes ONE flat tool list to the client's own agent loop;
 *   server-side per-skill tool filtering would fight it, and AI-exposed Actions
 *   already reach the client as `action_*` via `list_actions` / `run_action`.
 *   That half is consumed by the cloud agent runtime only, and says so in the
 *   schema's own JSDoc.
 *
 * The projection is **narrow on purpose**: a skill with no `instructions` has
 * nothing to serve, so it is not listed at all rather than listed empty.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Skill-metadata access seam for the MCP prompt surface.
 *
 * Deliberately shaped like {@link McpActionBridge}: a host that cannot resolve
 * skill metadata simply does not implement it, and the prompt surface is then
 * not registered at all (graceful degradation — never an advertised-but-empty
 * capability). On the HTTP transport the runtime supplies it from the
 * **request's own** environment, exactly as it does `listObjects` /
 * `describeObject`, so a multi-tenant host never serves one tenant's skills to
 * another.
 *
 * Returns raw metadata rows: what a metadata store hands back is `unknown`, and
 * {@link projectSkillPrompt} is the one place that decides what a valid row is.
 */
export interface McpSkillBridge {
  /** Skill metadata records visible in this environment. */
  listSkills(): Promise<unknown[]>;
}

/**
 * One skill's projected prompt — the fields the MCP `prompts` primitive
 * actually carries. `instructions` is the prompt body; a skill without one is
 * not projected (see {@link projectSkillPrompt}).
 */
export interface SkillPrompt {
  /** Prompt name — the skill's machine name, unchanged. */
  name: string;
  /** Human title — the skill's `label`. */
  title?: string;
  /** What the skill is for — the skill's `description`. */
  description?: string;
  /** The prompt body — the skill's `instructions`. */
  instructions: string;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Project one skill metadata row onto its MCP prompt, or `null` when the row
 * carries no projectable instructions half.
 *
 * Not projected:
 * - anything that is not an object with a non-empty string `name`;
 * - `active: false` — a disabled skill is not offered (the same rule the cloud
 *   skill registry applies);
 * - no `instructions` (or blank) — the half that projects is missing, so there
 *   is no prompt to serve. The skill is still perfectly valid metadata; it just
 *   has nothing for an MCP client to fetch.
 */
export function projectSkillPrompt(raw: unknown): SkillPrompt | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const name = readString(record, 'name');
  if (!name) return null;
  if (record.active === false) return null;

  const instructions = readString(record, 'instructions');
  if (!instructions) return null;

  const prompt: SkillPrompt = { name, instructions };
  const title = readString(record, 'label');
  if (title) prompt.title = title;
  const description = readString(record, 'description');
  if (description) prompt.description = description;
  return prompt;
}

/**
 * Project every skill the bridge can see. Rows that carry no instructions half
 * are dropped; a duplicate name keeps the first row (metadata names are unique
 * per type, so this only guards a malformed store).
 */
export async function listSkillPrompts(bridge: McpSkillBridge): Promise<SkillPrompt[]> {
  const rows = (await bridge.listSkills()) ?? [];
  const out: SkillPrompt[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const prompt = projectSkillPrompt(row);
    if (!prompt || seen.has(prompt.name)) continue;
    seen.add(prompt.name);
    out.push(prompt);
  }
  return out;
}

/** The MCP `prompts/get` result for one projected skill. */
export function skillPromptResult(prompt: SkillPrompt) {
  return {
    ...(prompt.description ? { description: prompt.description } : {}),
    messages: [
      {
        // MCP prompt messages are `user` | `assistant`; instructions are
        // context handed TO the model, which is the `user` role in this
        // protocol (there is no `system` role in `prompts/get`).
        role: 'user' as const,
        content: { type: 'text' as const, text: prompt.instructions },
      },
    ],
  };
}

/**
 * Register `prompts/list` + `prompts/get` on a server, served live from skill
 * metadata.
 *
 * Uses the low-level request handlers rather than `McpServer.registerPrompt`
 * because the projection must be **read at call time**: the HTTP transport
 * builds a fresh server per request, and a long-lived host can register a skill
 * after boot. Registering statically would freeze the list at wiring time.
 *
 * Protocol notes:
 * - `prompts/list` returns an **empty array** when the environment has no
 *   projectable skill — a server that declares the capability answers the
 *   method, it does not fail it.
 * - `prompts/get` for an unknown name raises `InvalidParams` (-32602), per the
 *   MCP specification's error guidance for prompts.
 * - The caller MUST have declared the `prompts` capability on this server
 *   before calling (the SDK refuses a handler for an undeclared capability).
 */
export function registerSkillPrompts(server: McpServer, bridge: McpSkillBridge): void {
  server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: (await listSkillPrompts(bridge)).map((prompt) => ({
      name: prompt.name,
      ...(prompt.title ? { title: prompt.title } : {}),
      ...(prompt.description ? { description: prompt.description } : {}),
    })),
  }));

  server.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const wanted = request.params.name;
    const prompt = (await listSkillPrompts(bridge)).find((p) => p.name === wanted);
    if (!prompt) {
      throw new McpError(ErrorCode.InvalidParams, `Prompt "${wanted}" not found`);
    }
    return skillPromptResult(prompt);
  });
}
