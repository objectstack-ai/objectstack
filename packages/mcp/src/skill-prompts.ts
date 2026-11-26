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
 *
 * ## The owner decides whether a skill is written for MCP at all (#34167)
 *
 * The binding test below answers whether a connection CAN run a playbook. It
 * cannot answer whether the playbook is written for MCP: a skill may bind
 * tools MCP serves under the same names (`create_record`, `action_*` through
 * `run_action`) and still tell the model to call in-product tools and wait for
 * the in-product approval card. Its owner says so with `mcpPrompt: false`, and
 * {@link projectSkillPrompt} — the one place both the per-request HTTP surface
 * and the long-lived stdio server read — projects no such skill, on any
 * connection, whatever its binding.
 *
 * ## The binding still decides WHETHER a skill is offered (#32767)
 *
 * The binding is not projected, but it is read: a skill's instructions teach
 * the model to call the tools it binds, so a connection that does not serve
 * one of them is handed a playbook it cannot run. A `data:read` token was
 * offered `metadata_authoring` and eight more skills naming eighteen tools its
 * own `tools/list` never listed. So {@link registerSkillPrompts} offers a skill
 * only when THIS connection serves every tool its binding names
 * ({@link skillBindingServed}); a skill that binds no tool is offered as
 * before, and a withheld skill is unknown to `prompts/get`, exactly like a
 * name no skill derives.
 *
 * ## A skill with `context` takes a record (ADR-0160 D8)
 *
 * A skill that names a context pack (`SkillSchema.context`) lists one optional
 * prompt argument, the record id ({@link SKILL_PROMPT_RECORD_ARGUMENT}), when
 * that name resolves to a pack ({@link skillPromptRecordContext}). Given, the
 * prompt's one message carries the skill's instructions, one fixed platform
 * line ({@link SKILL_PROMPT_RECORD_CONTEXT_LINE}) and the `get_record_context`
 * call's arguments as one JSON object — `objectName`, `recordId`, `context`.
 * The record id the client sent is only ever a JSON string value there, never
 * joined into prose, and the pack is never inlined: the model reads it as the
 * tool's answer, through the ordinary tool seams. Not given, or a name that
 * resolves to no pack, and the prompt is byte-identical to the prompt of the
 * same skill without the key. Parse requires such a skill to bind
 * `get_record_context`, so the binding test above withholds it on a connection
 * that does not serve the tool.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import {
  RUNTIME_COMPATIBILITY_PACKAGE_ID,
  describePackageScopedHolder,
  packageScopedHolderSource,
  resolvePackageScopedHolders,
} from '@objectstack/core';
import {
  AiContextSchema,
  GET_RECORD_CONTEXT_TOOL_NAME,
  deriveAiFaceName,
  type AiContext,
} from '@objectstack/spec/ai';
import { stripReadDecorations } from '@objectstack/spec/kernel';

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
  /**
   * [ADR-0160 D8] The context packs (`ai_context`) visible in this
   * environment, as raw rows: the listing `get_record_context` selects from,
   * which a skill's `context` is resolved against
   * ({@link skillPromptRecordContext}). Read decorations are stripped here,
   * and a row that does not parse is no pack, as at the tool.
   *
   * OPTIONAL: a host without it offers no skill a record argument, and every
   * prompt is the one it is without `context`.
   */
  listContextPacks?(): Promise<unknown[]>;
  /**
   * [ADR-0150 D3 step 2] A package's resolution closure: the packages other
   * than itself whose items a bare name it writes may resolve to (its declared
   * dependency closure plus every `sys` package; `packageResolutionClosure`,
   * `@objectstack/metadata-core`). Read for a package-held skill whose
   * `context` names no pack of its own package.
   *
   * OPTIONAL: without it a package-held skill resolves only its own package's
   * pack, and a pack its package depends on is answered as no pack — never
   * one picked environment-wide.
   */
  packageResolutionClosure?(packageId: string): ReadonlySet<string>;
}

/**
 * [ADR-0160 D8] The `get_record_context` call a skill's prompt asks the model
 * to make, less the record id the client supplies: what the skill's `context`
 * resolved to.
 */
export interface SkillPromptRecordContext {
  /** The resolved pack's root object: the call's `objectName`. */
  objectName: string;
  /**
   * The resolved pack's AI face (ADR-0150's addendum of 2026-11-25, reader 2):
   * `NS-NAME` for a package's pack, its bare name for an environment pack — the
   * spelling the tool's `context` argument selects exactly that pack by.
   */
  context: string;
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
  /**
   * [ADR-0160 D8] Present only when the skill's `context` resolves to a pack:
   * the prompt then lists the record argument and, given one, asks for this
   * call ({@link skillPromptResult}).
   */
  recordContext?: SkillPromptRecordContext;
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
 * - `mcpPrompt: false` — the owner declared the skill written for the
 *   in-product agents only (#34167); no tool binding brings it back;
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
  // [#34167] The owner's opt-out of MCP projection: in-product only.
  if (record.mcpPrompt === false) return null;

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
 * [#34167] Whether `rows` hold `prompt`'s skill (same name, same holder) as a
 * row its owner has WITHDRAWN from MCP: `mcpPrompt: false` (in-product only).
 * A long-lived server that registered the prompt from an
 * earlier read asks this when a re-read no longer finds it, so a skill opted
 * out after boot is answered as unknown rather than served from the snapshot.
 * A skill that is simply gone is not withdrawn: the snapshot keeps it, as
 * does one deactivated after boot (`active: false`), whose get is unchanged.
 */
export function skillPromptWithdrawn(rows: readonly unknown[], prompt: SkillPrompt): boolean {
  return rows.some((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const record = raw as Record<string, unknown>;
    if (readString(record, 'name') !== prompt.name) return false;
    if ((readString(record, '_packageId') ?? undefined) !== prompt.packageId) return false;
    return record.mcpPrompt === false;
  });
}

/**
 * Project every skill the bridge can see. Rows that carry no instructions half
 * are dropped. [ADR-0150] Two packages may each hold a skill of one name, and
 * both are kept: each is listed under its own face ({@link skillPromptFaces}).
 * A second row of one holder and name keeps the first (a holder holds a name
 * once, so this only guards a malformed store).
 */
export async function listSkillPrompts(bridge: McpSkillBridge): Promise<SkillPrompt[]> {
  return listSkillPromptsServedBy(bridge, undefined);
}

/**
 * [#32767] {@link listSkillPrompts}, keeping only the skills whose tool
 * binding `served` serves ({@link skillBindingServed}). `undefined` = the
 * served tool list is unknown, and every skill is kept, as before.
 */
async function listSkillPromptsServedBy(
  bridge: McpSkillBridge,
  served: ReadonlySet<string> | undefined,
  onWithheld?: (prompt: SkillPrompt, unserved: readonly string[]) => void,
): Promise<SkillPrompt[]> {
  const rows = (await bridge.listSkills()) ?? [];
  const namespaceOf = typeof bridge.packageNamespace === 'function'
    ? (packageId: string) => bridge.packageNamespace!(packageId)
    : undefined;
  const out: SkillPrompt[] = [];
  const contextOf = new Map<SkillPrompt, string>();
  const seen = new Set<string>();
  for (const row of rows) {
    const prompt = projectSkillPrompt(row, namespaceOf);
    if (!prompt) continue;
    if (served && !skillBindingServed(row, served)) {
      onWithheld?.(prompt, unservedBindingEntries(row, served));
      continue;
    }
    const holding = `${prompt.packageId ?? ''}\u0000${prompt.name}`;
    if (seen.has(holding)) continue;
    seen.add(holding);
    out.push(prompt);
    const context = readString(row as Record<string, unknown>, 'context');
    if (context) contextOf.set(prompt, context);
  }
  // [ADR-0160 D8] The packs are read only when an offered skill names one.
  if (contextOf.size > 0 && typeof bridge.listContextPacks === 'function') {
    const packs = contextPackHoldings((await bridge.listContextPacks()) ?? [], namespaceOf);
    const closureOf = typeof bridge.packageResolutionClosure === 'function'
      ? (packageId: string) => bridge.packageResolutionClosure!(packageId)
      : undefined;
    for (const [prompt, context] of contextOf) {
      const recordContext = skillPromptRecordContext({ context, packageId: prompt.packageId }, packs, closureOf);
      if (recordContext) prompt.recordContext = recordContext;
    }
  }
  return out;
}

/**
 * [ADR-0160 D8] One context pack as a skill's `context` resolves against it:
 * the parsed pack, its holder and its AI face — the three things the tool's
 * pack selection reads (`selectContextPack`, `@objectstack/service-record-context`).
 */
export interface ContextPackHolding {
  pack: AiContext;
  /** The package holding the pack; absent for an environment pack. */
  packageId?: string;
  /** The pack's AI face: `NS-NAME` for a package's pack, its bare name otherwise. */
  face: string;
}

/**
 * The package a pack's row is bound to: a non-empty `_packageId` that is not
 * one of the two spellings ADR-0150 D3 reads as "no package" (the package-less
 * row's `sys_metadata` sentinel, the runtime's compatibility id) — the reading
 * `get_record_context`'s pack selection takes of the same row.
 */
function packHolderOf(pack: AiContext): string | undefined {
  const id = (pack as { _packageId?: unknown })._packageId;
  return typeof id === 'string' && id !== '' && id !== 'sys_metadata' && id !== RUNTIME_COMPATIBILITY_PACKAGE_ID
    ? id
    : undefined;
}

/**
 * [ADR-0160 D8] The packs of a listing as a skill's `context` resolves
 * against them, in listing order. Read decorations are stripped and a row
 * that does not parse is no pack, as at the tool; each face is derived by the
 * one derivation (`deriveAiFaceName`) from the holder's namespace.
 */
export function contextPackHoldings(
  rows: readonly unknown[],
  packageNamespace?: (packageId: string) => string | undefined,
): ContextPackHolding[] {
  const out: ContextPackHolding[] = [];
  for (const row of rows) {
    const parsed = AiContextSchema.safeParse(stripReadDecorations(row));
    if (!parsed.success) continue;
    const pack = parsed.data as AiContext;
    const packageId = packHolderOf(pack);
    const namespace = packageId !== undefined ? packageNamespace?.(packageId) : undefined;
    out.push({ pack, ...(packageId !== undefined ? { packageId } : {}), face: deriveAiFaceName({ name: pack.name, namespace }) });
  }
  return out;
}

/**
 * [ADR-0160 D8; ADR-0150's addendum of 2026-11-25, reader 2] What a skill's
 * `context` resolves to, or `undefined` when it names no pack.
 *
 * The key is a reference between items, a bare name, so it resolves by the
 * one rule (`resolvePackageScopedHolders`, ADR-0150 D3) over the packs of
 * that name: from the skill's own package (its own pack, else the one holder
 * in its resolution closure), and as a caller with no package for a skill
 * authored in the environment (the environment's own pack, else the one
 * package holder). A refusal — two holders the rule cannot pick between, or
 * holders all outside the skill's closure — resolves to no pack: ⛔ never one
 * picked by order. The pack is handed on by its face, so the tool's selection
 * reads back exactly the pack resolved here.
 */
export function skillPromptRecordContext(
  skill: { context: string; packageId?: string },
  packs: readonly ContextPackHolding[],
  closureOf: (packageId: string) => ReadonlySet<string> = () => new Set<string>(),
): SkillPromptRecordContext | undefined {
  const named = packs.filter((p) => p.pack.name === skill.context);
  if (named.length === 0) return undefined;
  // A holder holds a name once (one slot per `(package, name)`); two rows of
  // one holder are a malformed listing, never chosen between.
  const holders = new Set(named.map((p) => p.packageId ?? null));
  if (holders.size !== named.length) return undefined;
  const resolution = resolvePackageScopedHolders<ContextPackHolding>(
    { type: 'ai_context', name: skill.context, callerPackageId: skill.packageId ?? null },
    packageScopedHolderSource(named.map((p) => [p.packageId ?? null, p] as const)),
    closureOf,
  );
  if (resolution.status !== 'resolved') return undefined;
  return { objectName: resolution.item.pack.object, context: resolution.item.face };
}

/**
 * [#32767] The MCP door of each platform tool family
 * (`PLATFORM_TOOL_FAMILY_PREFIXES` in `@objectstack/spec/system`; a pin holds
 * every spec prefix to a door here). The native MCP families register no
 * `action_<name>` tool: an AI-exposed action reaches the client through
 * `run_action` (the skill schema's own JSDoc says so), so a binding naming one
 * is served when `run_action` is, as well as by a tool of that very name.
 */
export const TOOL_FAMILY_DOORS: ReadonlyArray<readonly [prefix: string, door: string]> = [['action_', 'run_action']];

/** Whether one entry of a skill's `tools` binding names a tool `served` serves. */
function bindingEntryServed(entry: string, served: ReadonlySet<string>): boolean {
  const wildcard = entry.endsWith('*');
  const stem = wildcard ? entry.slice(0, -1) : entry;
  // A plain name is served by the tool of that name; a trailing wildcard
  // (`SkillSchema.tools`) by any tool it matches. A host server may list a
  // family member by name, so the match is read before the family's door.
  if (wildcard) {
    for (const name of served) if (name.startsWith(stem)) return true;
  } else if (served.has(entry)) {
    return true;
  }
  for (const [prefix, door] of TOOL_FAMILY_DOORS) {
    if (stem.startsWith(prefix)) return served.has(door);
  }
  return false;
}

/**
 * [#32767] Whether a connection serving `served` serves every tool a raw
 * skill row binds (`SkillSchema.tools`). A row that binds no tool binds
 * nothing this connection could lack, so it is served.
 */
export function skillBindingServed(raw: unknown, served: ReadonlySet<string>): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return true;
  const binding = (raw as Record<string, unknown>).tools;
  if (!Array.isArray(binding)) return true;
  return binding.every((entry) => typeof entry !== 'string' || bindingEntryServed(entry, served));
}

/** The entries of a raw skill row's `tools` binding that `served` does not serve, in binding order. */
function unservedBindingEntries(raw: unknown, served: ReadonlySet<string>): string[] {
  const binding = (raw as Record<string, unknown>).tools;
  if (!Array.isArray(binding)) return [];
  return binding.filter((entry): entry is string => typeof entry === 'string' && !bindingEntryServed(entry, served));
}

/**
 * The line a withheld skill is reported with: the skill, and each tool its
 * binding names that this connection does not serve.
 */
export function withheldSkillPromptMessage(prompt: SkillPrompt, unserved: readonly string[]): string {
  return `[MCP] Skill "${prompt.name}" (prompt "${prompt.face}") is not offered on this connection: it binds `
    + `${unserved.map((name) => `"${name}"`).join(', ')}, which this connection does not serve, so its instructions `
    + 'would teach the model a tool it cannot call.';
}

/**
 * [#32767] The tools this server serves: the names its `tools/list` answers,
 * which is the SDK registry's enabled entries. Read when a prompt request is
 * answered — every tool family is registered on the per-request server before
 * it connects, so the answer is the connection's whole tool list.
 *
 * `undefined` when this SDK's registry cannot be read: the served list is then
 * unknown and every skill is offered, as before this filter. On such an SDK
 * the two data-only pins in `skill-prompts.test.ts` go red (their CONTROL pins
 * stay green), so the regression cannot pass silently.
 */
function servedToolNames(server: McpServer): ReadonlySet<string> | undefined {
  const tools = (server as unknown as { _registeredTools?: unknown })._registeredTools;
  if (tools === null || typeof tools !== 'object') return undefined;
  const served = new Set<string>();
  for (const [name, tool] of Object.entries(tools as Record<string, unknown>)) {
    // The filter the SDK's own `tools/list` applies: a disabled tool is not served.
    if ((tool as { enabled?: unknown } | null)?.enabled) served.add(name);
  }
  return served;
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

/** [ADR-0160 D8] The one argument a skill whose `context` resolves to a pack lists: the record id. */
export const SKILL_PROMPT_RECORD_ARGUMENT = 'recordId';

/** One MCP prompt argument, as `prompts/list` carries it. */
export interface SkillPromptArgument {
  name: string;
  description: string;
  required: false;
}

/** [ADR-0160 D8] The record argument's `prompts/list` entry. It names no object: the pack's root is the call's, never the listing's. */
export function skillPromptRecordArgument(): SkillPromptArgument {
  return {
    name: SKILL_PROMPT_RECORD_ARGUMENT,
    description:
      'The id of the record this skill works on. Given, the prompt asks the model to read that record with '
      + `${GET_RECORD_CONTEXT_TOOL_NAME} before it follows the instructions.`,
    required: false,
  };
}

/**
 * [ADR-0160 D8] The fixed platform line a record-scoped prompt carries between
 * the skill's instructions and the call's arguments. Platform-written and the
 * same for every skill and record: no client value is ever joined into it.
 */
export const SKILL_PROMPT_RECORD_CONTEXT_LINE =
  `Before you follow the instructions above, call the ${GET_RECORD_CONTEXT_TOOL_NAME} tool with exactly the `
  + 'arguments in the JSON object on the next line, and work from the record it answers.';

/**
 * The `prompts/list` entry of one face: a duplicate face is listed once, as the refusal it answers.
 * [ADR-0160 D8] A skill whose `context` resolves to a pack lists the record argument.
 */
export function skillPromptListEntry(
  entry: SkillPromptFace,
): { name: string; title?: string; description?: string; arguments?: SkillPromptArgument[] } {
  if (entry.prompts.length > 1) {
    return { name: entry.face, description: `Not served: ${duplicateSkillFaceMessage(entry)}` };
  }
  const prompt = entry.prompts[0];
  return {
    name: entry.face,
    ...(prompt.title ? { title: prompt.title } : {}),
    ...(prompt.description ? { description: prompt.description } : {}),
    ...(prompt.recordContext ? { arguments: [skillPromptRecordArgument()] } : {}),
  };
}

/**
 * The MCP `prompts/get` result for one projected skill.
 *
 * [ADR-0160 D8] For a skill whose `context` resolved to a pack, a given
 * record id ({@link SKILL_PROMPT_RECORD_ARGUMENT}) adds two parts to the one
 * message, after the instructions: {@link SKILL_PROMPT_RECORD_CONTEXT_LINE},
 * then the `get_record_context` call's arguments as one JSON object
 * (`objectName`, `recordId`, `context`). The record id is only ever that
 * object's string value — `JSON.stringify` escapes whatever it holds, so it
 * cannot leave the value — and the pack is never inlined. No record id, or a
 * skill whose `context` resolves to no pack: the result is exactly the one
 * the skill has without the key, whatever arguments were sent. A record id
 * that is not a non-empty string is refused (`-32602`).
 */
export function skillPromptResult(prompt: SkillPrompt, args?: Record<string, unknown>) {
  const recordId = prompt.recordContext ? args?.[SKILL_PROMPT_RECORD_ARGUMENT] : undefined;
  let text = prompt.instructions;
  if (recordId !== undefined) {
    if (typeof recordId !== 'string' || recordId.trim() === '') {
      throw new McpError(
        ErrorCode.InvalidParams,
        `The "${SKILL_PROMPT_RECORD_ARGUMENT}" argument of prompt "${prompt.face}" is the id of a record: a non-empty `
          + 'string. Send the id, or leave the argument out for the prompt without a record.',
      );
    }
    const call = { objectName: prompt.recordContext!.objectName, recordId, context: prompt.recordContext!.context };
    text = `${prompt.instructions}\n\n${SKILL_PROMPT_RECORD_CONTEXT_LINE}\n${JSON.stringify(call)}`;
  }
  return {
    ...(prompt.description ? { description: prompt.description } : {}),
    messages: [
      {
        // MCP prompt messages are `user` | `assistant`; instructions are
        // context handed TO the model, which is the `user` role in this
        // protocol (there is no `system` role in `prompts/get`).
        role: 'user' as const,
        content: { type: 'text' as const, text },
      },
    ],
  };
}

/**
 * Register `prompts/list` + `prompts/get` on a server, served live from skill
 * metadata. [#32767] Only the skills whose tool binding this server serves
 * ({@link skillBindingServed} over {@link servedToolNames}): a withheld skill
 * is not listed, and `prompts/get` answers it as it answers an unknown name.
 * With `options.logger`, each listing reports every withheld skill at
 * `debug` ({@link withheldSkillPromptMessage}).
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
export function registerSkillPrompts(
  server: McpServer,
  bridge: McpSkillBridge,
  options: { logger?: { debug(message: string): void } } = {},
): void {
  // Absence must be loud: a withheld skill is said once per listing, at
  // `debug` (the HTTP transport lists per request), naming the tools this
  // connection lacks, so an author can find out why a skill is missing
  // without listing prompts on a live connection.
  const reportWithheld = options.logger
    ? (prompt: SkillPrompt, unserved: readonly string[]) =>
      options.logger!.debug(withheldSkillPromptMessage(prompt, unserved))
    : undefined;
  // [ADR-0150 D6] Listed by face, each face once ({@link skillPromptListEntry}).
  server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: skillPromptFaces(await listSkillPromptsServedBy(bridge, servedToolNames(server), reportWithheld)).map(
      skillPromptListEntry,
    ),
  }));

  // [ADR-0150 D5/D6] Got by face, or by the bare skill name while one holder
  // has it ({@link lookupSkillPrompt}); a refusal names every candidate.
  server.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const wanted = request.params.name;
    const lookup = lookupSkillPrompt(await listSkillPromptsServedBy(bridge, servedToolNames(server)), wanted);
    if (lookup.status === 'refused') throw skillPromptRefusalError(lookup);
    if (lookup.status === 'not-found') {
      throw new McpError(ErrorCode.InvalidParams, `Prompt "${wanted}" not found`);
    }
    // [ADR-0160 D8] The record argument, read only for a skill that lists it.
    return skillPromptResult(lookup.prompt, request.params.arguments);
  });
}
