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
import {
  describePackageScopedHolder,
  packageScopedHolderSource,
  resolvePackageScopedHolders,
} from '@objectstack/core';
import { deriveAiFaceName } from '@objectstack/spec/ai';

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
  /**
   * [ADR-0150 D6] The manifest namespace of an installed package, by its id:
   * what a package-held skill's prompt name is derived from (`NS-NAME`).
   * `undefined` for an id the host cannot place (no package record).
   *
   * OPTIONAL: a host without it derives every prompt name from the skill name
   * alone, the environment item's face, as before.
   */
  packageNamespace?(packageId: string): string | undefined;
}

/**
 * One skill's projected prompt — the fields the MCP `prompts` primitive
 * actually carries. `instructions` is the prompt body; a skill without one is
 * not projected (see {@link projectSkillPrompt}).
 */
export interface SkillPrompt {
  /**
   * [ADR-0150 D6] The prompt name a client lists and gets: the skill's AI face,
   * `deriveAiFaceName` over its address — `NS-NAME` for a package's skill,
   * the bare name for an environment-authored one.
   */
  face: string;
  /** The skill's machine name, unchanged. */
  name: string;
  /** The package that holds the skill (its row's `_packageId`); absent for an environment-authored skill. */
  packageId?: string;
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
export function projectSkillPrompt(
  raw: unknown,
  packageNamespace?: (packageId: string) => string | undefined,
): SkillPrompt | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const name = readString(record, 'name');
  if (!name) return null;
  if (record.active === false) return null;

  const instructions = readString(record, 'instructions');
  if (!instructions) return null;

  // [ADR-0150 D6] The prompt name is derived from the skill's address, never
  // authored: its holder's namespace and its name. ONE derivation, spec's.
  const packageId = readString(record, '_packageId');
  const namespace = packageId ? packageNamespace?.(packageId) : undefined;
  const face = deriveAiFaceName({ name, namespace });
  const prompt: SkillPrompt = { face, name, instructions };
  if (packageId) prompt.packageId = packageId;
  const title = readString(record, 'label');
  if (title) prompt.title = title;
  const description = readString(record, 'description');
  if (description) prompt.description = description;
  return prompt;
}

/**
 * Project every skill the bridge can see. Rows that carry no instructions half
 * are dropped. [ADR-0150] Two packages may each hold a skill of one name, and
 * both are kept: each is listed under its own face ({@link skillPromptFaces}).
 * A second row of one holder and name keeps the first (a holder holds a name
 * once, so this only guards a malformed store).
 */
export async function listSkillPrompts(bridge: McpSkillBridge): Promise<SkillPrompt[]> {
  const rows = (await bridge.listSkills()) ?? [];
  const namespaceOf = typeof bridge.packageNamespace === 'function'
    ? (packageId: string) => bridge.packageNamespace!(packageId)
    : undefined;
  const out: SkillPrompt[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const prompt = projectSkillPrompt(row, namespaceOf);
    if (!prompt) continue;
    const holding = `${prompt.packageId ?? ''}\u0000${prompt.name}`;
    if (seen.has(holding)) continue;
    seen.add(holding);
    out.push(prompt);
  }
  return out;
}

/**
 * [ADR-0150 D6, Q3] One entry of the face list: a face and the skills that
 * derive it. One skill is a prompt; two or more are a duplicate face, which is
 * listed once and refused at every get, naming each skill — never one of them
 * served, never one dropped.
 */
export interface SkillPromptFace {
  face: string;
  prompts: SkillPrompt[];
}

/** The face list, in the store's order: each face once, with every skill that derives it. */
export function skillPromptFaces(prompts: readonly SkillPrompt[]): SkillPromptFace[] {
  const byFace = new Map<string, SkillPromptFace>();
  for (const prompt of prompts) {
    const entry = byFace.get(prompt.face);
    if (entry) entry.prompts.push(prompt);
    else byFace.set(prompt.face, { face: prompt.face, prompts: [prompt] });
  }
  return [...byFace.values()];
}

/** How a refusal names one skill: its name and its holder. */
function describeSkillHolder(prompt: SkillPrompt): string {
  return `skill "${prompt.name}" of ${describePackageScopedHolder(
    prompt.packageId ? { kind: 'package', packageId: prompt.packageId } : { kind: 'environment' },
  )}`;
}

/** The refusal a duplicate face answers: every skill that derives it, and the author's fix. */
export function duplicateSkillFaceMessage(entry: SkillPromptFace): string {
  return `The prompt name "${entry.face}" is derived for ${entry.prompts.length} skills: `
    + `${entry.prompts.map(describeSkillHolder).join('; ')}. A prompt name names one skill, so none of them is `
    + 'served under it: rename one of the skills so their prompt names differ.';
}

/** What {@link lookupSkillPrompt} answers for a requested prompt name. */
export type SkillPromptLookup =
  | { status: 'found'; prompt: SkillPrompt }
  /** Every candidate named, nothing served: a duplicate face, or a bare name two packages hold. */
  | { status: 'refused'; message: string; candidates: string[] }
  | { status: 'not-found' };

/**
 * [ADR-0150 D5/D6] The skill a requested prompt name means.
 *
 * 1. **A face** answers its one skill; a duplicate face is refused, naming
 *    each skill that derives it.
 * 2. **Otherwise a bare skill name** — the name a client may have fetched the
 *    prompt by before faces were derived — resolves by ADR-0150 D3 for a
 *    caller with no package (R's rule, `resolvePackageScopedHolders`): the
 *    environment's own skill, else the one package holder; two package
 *    holders are refused, naming each and the face that gets each one.
 *    An environment skill's face IS its bare name, so step 1 already
 *    answered it.
 * 3. Neither: not found.
 */
export function lookupSkillPrompt(prompts: readonly SkillPrompt[], wanted: string): SkillPromptLookup {
  const faced = prompts.filter((p) => p.face === wanted);
  if (faced.length === 1) return { status: 'found', prompt: faced[0] };
  if (faced.length > 1) {
    return {
      status: 'refused',
      message: duplicateSkillFaceMessage({ face: wanted, prompts: faced }),
      candidates: faced.map((p) => p.face),
    };
  }
  const named = prompts.filter((p) => p.name === wanted);
  if (named.length === 0) return { status: 'not-found' };
  const holdings: Array<readonly [string | null, SkillPrompt]> = [];
  const held = new Set<string | null>();
  for (const prompt of named) {
    const holder = prompt.packageId ?? null;
    if (held.has(holder)) continue;
    held.add(holder);
    holdings.push([holder, prompt]);
  }
  const resolution = resolvePackageScopedHolders<SkillPrompt>(
    { type: 'skill', name: wanted, callerPackageId: null },
    packageScopedHolderSource(holdings),
    // A caller with no package is never asked for a closure.
    () => new Set<string>(),
  );
  if (resolution.status === 'resolved') return { status: 'found', prompt: resolution.item };
  if (resolution.status === 'refused') {
    const faces = named.map((p) => p.face);
    return {
      status: 'refused',
      message: `${resolution.message} Get one by its prompt name: ${faces.map((f) => `"${f}"`).join(', ')}.`,
      candidates: faces,
    };
  }
  return { status: 'not-found' };
}

/**
 * The `prompts/get` error a refused lookup answers: `-32602`, with the
 * ADR-0112 code and status of a name in conflict (ADR-0150 D5's `409`) and
 * every candidate prompt name in its data.
 */
export function skillPromptRefusalError(lookup: Extract<SkillPromptLookup, { status: 'refused' }>): McpError {
  return new McpError(ErrorCode.InvalidParams, lookup.message, {
    code: 'RESOURCE_CONFLICT',
    status: 409,
    candidates: lookup.candidates,
  });
}

/** The `prompts/list` entry of one face: a duplicate face is listed once, as the refusal it answers. */
export function skillPromptListEntry(entry: SkillPromptFace): { name: string; title?: string; description?: string } {
  if (entry.prompts.length > 1) {
    return { name: entry.face, description: `Not served: ${duplicateSkillFaceMessage(entry)}` };
  }
  const prompt = entry.prompts[0];
  return {
    name: entry.face,
    ...(prompt.title ? { title: prompt.title } : {}),
    ...(prompt.description ? { description: prompt.description } : {}),
  };
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
  // [ADR-0150 D6] Listed by face, each face once ({@link skillPromptListEntry}).
  server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: skillPromptFaces(await listSkillPrompts(bridge)).map(skillPromptListEntry),
  }));

  // [ADR-0150 D5/D6] Got by face, or by the bare skill name while one holder
  // has it ({@link lookupSkillPrompt}); a refusal names every candidate.
  server.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const wanted = request.params.name;
    const lookup = lookupSkillPrompt(await listSkillPrompts(bridge), wanted);
    if (lookup.status === 'refused') throw skillPromptRefusalError(lookup);
    if (lookup.status === 'not-found') {
      throw new McpError(ErrorCode.InvalidParams, `Prompt "${wanted}" not found`);
    }
    return skillPromptResult(lookup.prompt);
  });
}
