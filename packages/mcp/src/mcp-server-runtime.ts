// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Logger, IMetadataService, AIToolDefinition } from '@objectstack/spec/contracts';
import type { Agent } from '@objectstack/spec/ai';
import { PLATFORM_PROVIDED_TOOL_NAMES } from '@objectstack/spec/system';
import type { ToolRegistry, ToolExecutionResult } from './types.js';
import { wireBridgeTools } from './mcp-http-tools.js';
import type {
  McpDataBridge,
  McpActionBridge,
  RegisterObjectToolsOptions,
  RegisterActionToolsOptions,
} from './mcp-http-tools.js';
import {
  METADATA_UNAVAILABLE_CODE,
  metadataPartialListingSentence,
} from './metadata-completeness.js';
import { protocolStdout } from './protocol-stdout.js';
import { renderSkillMarkdown, type RenderSkillOptions } from './skill-md.js';
import {
  listSkillPrompts,
  registerSkillPrompts,
  skillPromptResult,
  type McpSkillBridge,
} from './skill-prompts.js';
import { z } from 'zod';

/**
 * Configuration for the MCP Server Runtime.
 */
export interface MCPServerRuntimeConfig {
  /** Human-readable server name. */
  name?: string;
  /** Server version (semver). */
  version?: string;
  /** Optional instructions describing how to use the server. */
  instructions?: string;
  /** Transport mode: 'stdio' (default) or 'http'. */
  transport?: 'stdio' | 'http';
  /** Logger instance. */
  logger?: Logger;
}

/**
 * Minimal shape of an object definition returned by IMetadataService.
 */
interface ObjectDef {
  name: string;
  label?: string;
  fields?: Record<string, { name?: string; type?: string; label?: string; required?: boolean }>;
  enable?: Record<string, boolean>;
}

/**
 * PLATFORM tool names whose safety class is known from the platform's own
 * registration rather than from anything the definition carries — the
 * last-resort fallback inside {@link safetyAnnotations}, and deliberately NOT
 * a general classifier.
 *
 * Every name here is a tool the cloud AI runtime registers statically
 * (`PLATFORM_TOOLS_BY_PACKAGE` in `@objectstack/spec/system`) and hands to
 * this bridge through the AI service's `ToolRegistry` carrying no
 * `requiresConfirmation`. Two sibling pins hold both sets to that registry —
 * one per direction — so the lists cannot drift back into folklore: a name the
 * platform does not register is a name this bridge knows nothing about.
 *
 * WHY BOTH SETS ARE EXPORTED, AND FOR WHAT. The older pin (`no tool outside
 * PLATFORM_PROVIDED_TOOL_NAMES receives a hint it did not declare`) bridges
 * `[...PLATFORM_PROVIDED_TOOL_NAMES]` and asserts every annotated name is in
 * it. Its ITERATION SOURCE is the registry, so it can only ever see
 * local-has → registry-lacks. The reverse — a name WITHDRAWN from
 * `PLATFORM_TOOLS_BY_PACKAGE` while it stays in a set here — is not among the
 * tools that pin bridges at all: nothing drives it, nothing is annotated, and
 * the case stays green over exactly the drift it is named for.
 *
 * ⚠️ That silent direction is the dangerous one, and NOT because a tool the
 * platform no longer registers keeps a hint. These sets annotate BY NAME. Once
 * a name leaves the registry, a PLUGIN registering a tool of that name
 * inherits a `readOnlyHint` it never declared — a read-only promise the plugin
 * may not honour, handed to it by a stale literal in this file. So the second
 * pin iterates the thing that can drift, which is these two sets, and that
 * requires reaching them from outside this module. They are exported for that
 * and are deliberately NOT re-exported from `index.ts`: the package's
 * published surface is unchanged, and a new name-keyed set added here must be
 * exported too or the pin's coverage guard goes red.
 *
 * ⛔ Do not "repair" this by filtering the literals through
 * `PLATFORM_PROVIDED_TOOL_NAMES` at construction. That absorbs the drift
 * instead of reporting it — the withdrawn name would simply stop annotating,
 * nothing would go red, and the folklore would stay in this file forever. The
 * pin exists to make a withdrawn name LOUD, in CI, at the one moment somebody
 * can still delete it.
 *
 * ⛔ What the fallback must never do again is answer for tools it does NOT
 * contain. These two sets used to be the ONLY source of both hints, so the
 * `else` branch of the membership tests asserted
 * `readOnlyHint: false, destructiveHint: false` — "not read-only and not
 * destructive", the most permissive pair the annotation can express — for
 * every app-registered and every action-backed tool, and inverted the
 * protocol's own conservative default while doing it.
 *
 * `aggregate_records` left the read-only half because it was never a platform
 * tool name (`aggregate_data` is): it belongs to the object-CRUD bridge, which
 * registers it — annotated `readOnlyHint: true` — at its own registration site
 * in `mcp-http-tools.ts`, and never reaches this path.
 */
export const PLATFORM_READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'list_objects',
  'describe_object',
  'query_records',
  'get_record',
  'aggregate_data',
]);

/**
 * The destructive half of the same platform-name fallback — see
 * {@link PLATFORM_READ_ONLY_TOOL_NAMES} for what it is and is not for, and for
 * why both halves are exported to a test rather than kept private.
 */
export const PLATFORM_DESTRUCTIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'delete_field',
]);

/** The safety hints this bridge can source, as MCP spells them. */
interface ToolSafetyHints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

/**
 * The `readOnlyHint` / `destructiveHint` an {@link AIToolDefinition} can
 * actually SOURCE — and nothing else.
 *
 * THE DEFECT. Both hints used to be membership tests against the two name sets
 * above, so a bridged tool outside those seven literals was served to every
 * MCP client as `readOnlyHint: false, destructiveHint: false`. That is not a
 * missing annotation, it is a positive claim of "not read-only, and not
 * destructive" — asserted over every tool an app registers under its own name
 * and every action-backed tool (`delete_opportunity`, `void_invoice`, …).
 * `destructiveHint` is what a host reads to decide whether to interrupt the
 * user before a call, so a destructive action-backed tool arrived flagged as
 * safe.
 *
 * THE DECLARED SOURCE is `AIToolDefinition.requiresConfirmation`
 * (`@objectstack/spec/contracts`), documented on the member itself as carried
 * by action-backed tools "from the action's confirmation policy
 * (`action.ai.requiresConfirmation`, or the destructive-action default)".
 *
 * ⛔ NOT the retired metadata key. `ToolSchema.requiresConfirmation` was
 * removed by ADR-0033 §2 and still hard-REJECTS with a prescription; nothing
 * here asks for it back and no metadata author can reach the member read
 * below. The two live on different objects at different layers: the retired
 * one was authorable `tool` metadata, this one is the runtime contract the AI
 * service registers, which the retirement never touched.
 *
 * ⛔ NOT a second definition of "destructive" either. The framework already
 * has one, maintainer-ruled (`actionLooksDestructive` in
 * `@objectstack/runtime`, #7828 Option A: `mode: 'delete'` / `variant:
 * 'danger'` are the closed declared signals and `confirmText` deliberately is
 * not), and `requiresConfirmation` is literally that function's output —
 * `summarizeAction` fills the field by calling it. So the reuse this bridge
 * owes the ruling is to READ the verdict it is handed, not to re-derive one:
 * an MCP bridge never sees an action, and `@objectstack/mcp` does not depend
 * on `@objectstack/runtime`. The same verdict already travels to MCP on the
 * other path, as `requiresConfirmation` on each `list_actions` entry.
 *
 * WHY A TOOL THAT DECLARES NOTHING GETS NO HINT AT ALL. Measured in the
 * pinned SDK (`@modelcontextprotocol/sdk` 1.30.0, `ToolAnnotationsSchema`):
 * `readOnlyHint` documents `Default: false` and `destructiveHint` documents
 * `Default: true`. Omitting a hint therefore hands the question to the
 * protocol's own conservative default — "may perform destructive updates" —
 * while claiming nothing this framework cannot source, and it is the same
 * treatment the annotation vocabulary has no other word for: MCP has no
 * spelling for "unknown" other than absence. Asserting `false` was the
 * inversion; asserting `true` here would be a property presented as the
 * tool's when it is really this bridge's ignorance.
 *
 * WHY `readOnlyHint` KEEPS A NAME FALLBACK AND NOTHING ELSE. There is no
 * declared source for it at all: `AIToolDefinition` has no member expressing
 * "this tool only reads". The asymmetry with `destructiveHint` is the MCP
 * defaults' own asymmetry — a missing `readOnlyHint` reads as "not read-only",
 * which is the conservative answer, so omission loses only information and
 * never safety. The platform's own readers are the one place that information
 * exists, so they keep it; every other tool is served no `readOnlyHint`
 * rather than a fabricated `false`.
 *
 * PRECEDENCE: what the definition declares outranks what the name suggests.
 */
function safetyAnnotations(tool: AIToolDefinition): ToolSafetyHints {
  if (tool.requiresConfirmation !== undefined) {
    // A tool whose invocation is gated on human confirmation is by
    // construction not a read (`readOnlyHint` is stated so the destructive
    // hint is unambiguously meaningful — MCP reads it only when read-only is
    // false). `false` is the action's declared "no confirmation needed", the
    // one thing that legitimately sources a non-destructive claim.
    return tool.requiresConfirmation
      ? { readOnlyHint: false, destructiveHint: true }
      : { destructiveHint: false };
  }

  if (PLATFORM_READ_ONLY_TOOL_NAMES.has(tool.name)) {
    // Read-only entails non-destructive; both come from the one fact.
    return { readOnlyHint: true, destructiveHint: false };
  }

  if (PLATFORM_DESTRUCTIVE_TOOL_NAMES.has(tool.name)) {
    return { readOnlyHint: false, destructiveHint: true };
  }

  return {};
}

/** The world-domain hint this bridge can source. */
interface ToolWorldHint {
  openWorldHint?: boolean;
}

/**
 * The `openWorldHint` this bridge can actually SOURCE — for the names the
 * PLATFORM registers, and for nobody else.
 *
 * THE DEFECT. This hint used to be a bare `openWorldHint: false` sitting in
 * the annotations literal below, asserted over EVERY bridged tool from
 * nothing at all — every tool an app registers under its own name included.
 * `AIToolDefinition` has no member expressing it, so that `false` was never a
 * property of the tool; it was a property of this file. An app can register a
 * tool that calls a weather API, an LLM, or any outbound service, and this
 * bridge told every MCP client its domain of interaction was closed. Same
 * class as the `readOnlyHint` / `destructiveHint` defect described above.
 *
 * THE SOURCE is {@link PLATFORM_PROVIDED_TOOL_NAMES}
 * (`@objectstack/spec/system`) — the canonical registry of the statically
 * named tools the cloud AI runtime registers (`PLATFORM_TOOLS_BY_PACKAGE`).
 * Every name in it acts on the ObjectStack environment itself, this stack's
 * records and its own metadata, which is a closed and well-defined domain in
 * exactly the sense the SDK gives the word. So `false` for those names is
 * known rather than assumed, and it is the information option 3 (drop the
 * hint outright) would have thrown away.
 *
 * WHY THE REGISTRY AND NOT THE TWO NAME SETS ABOVE. Same shape — a membership
 * test against platform-registered names — but a different question.
 * {@link PLATFORM_READ_ONLY_TOOL_NAMES} and
 * {@link PLATFORM_DESTRUCTIVE_TOOL_NAMES} answer "what SAFETY class does the
 * platform know for this name", and they are deliberately partial: they carry
 * only the platform names whose safety class this bridge knows. The question
 * here is OWNERSHIP, and the registry is what answers it. Keying the world
 * hint off the safety lists instead would drop `create_object`, `add_field`,
 * `list_metadata`, `describe_metadata` and twenty more — platform tools whose
 * world is just as closed — to the protocol default, reintroducing option 3's
 * accuracy loss under a narrower name. A sibling pin already holds the two
 * safety lists to this same registry as a SUBSET, so the hints read one
 * registry between them rather than three hand lists that can drift apart.
 *
 * ⚠️ WHY OMISSION IS NOT THE CONSERVATIVE DIRECTION HERE — AND WHY THE
 * ASYMMETRY WITH {@link safetyAnnotations} IS DELIBERATE, NOT AN OVERSIGHT
 * WAITING TO BE TIDIED. Structurally the two functions are one rule: assert
 * what the platform can source, omit what it cannot, because MCP has no
 * spelling for "unknown" other than absence. What DIFFERS is the price of
 * that absence, and the difference is the SDK's own. Measured in the pinned
 * `@modelcontextprotocol/sdk` 1.30.0 (`ToolAnnotationsSchema`, `dist/esm/types.js`):
 *
 * ```
 *   readOnlyHint     Default: false   ← omission reads "not read-only"
 *   destructiveHint  Default: true    ← omission reads "may be destructive"
 *   openWorldHint    Default: true    ← omission reads "OPEN world"
 * ```
 *
 * For the two safety hints, omission lands on the cautious answer and costs
 * only information — which is why #13318 could move them to omit-when-unsourced
 * and call it conservative. For this one, omission lands on the LESS cautious
 * reading: a tool that sources nothing is understood by every conforming host
 * to reach an open world. That trade is accepted on purpose. For an
 * app-registered tool this bridge genuinely has no source, and falling to the
 * protocol's documented default is honest where asserting `false` was a lie.
 * ⛔ So do not "repair" the asymmetry by re-asserting `false` for everyone:
 * that IS the defect. The identical STRUCTURE of the two functions is what
 * keeps the one rule legible; identical consequences were never the point.
 *
 * ⛔ NOT the dynamic tool families. `PLATFORM_TOOL_FAMILY_PREFIXES`
 * (`action_<name>`) names tools the runtime materialises from an app's OWN
 * declarative actions: the platform registers the wrapper, the app defines the
 * behaviour, outbound calls included. `mcp-http-tools.ts` asserts
 * `openWorldHint: true` for `run_action` on exactly that reasoning. Widening
 * this membership test to the prefixes would re-import the defect under a new
 * name.
 *
 * ⛔ NOT `{ openWorldHint: undefined }`. The no-source answer is an absent
 * KEY, which is why this returns `{}`: an undefined-valued property is dropped
 * by JSON serialization but survives a spread, so "omitted" has to be true of
 * the object as well as of the wire.
 *
 * THE FOLLOW-UP THIS IS NOT. Making the hint a property of the TOOL — a
 * declared member on `AIToolDefinition`, with an action-backed tool inheriting
 * `run_action`'s `openWorldHint: true` — is the shape that would make it true
 * rather than merely defensible. That is a public contract extension in
 * `packages/spec/**` and was ruled a follow-up; this is the zero-contract-change
 * half, which stops the unsourced assertion now.
 */
function worldAnnotation(tool: AIToolDefinition): ToolWorldHint {
  return PLATFORM_PROVIDED_TOOL_NAMES.has(tool.name) ? { openWorldHint: false } : {};
}

// ── AIToolDefinition.parameters → MCP inputSchema ────────────────────────────

/**
 * Convert an {@link AIToolDefinition}'s JSON Schema `parameters` into the Zod
 * schema `McpServer.registerTool` requires for `inputSchema`.
 *
 * ⚠️ The conversion is not a stylistic choice, it is the only door. Measured
 * against `@modelcontextprotocol/sdk` 1.30.0: `registerTool`'s `inputSchema`
 * is typed `ZodRawShapeCompat | AnySchema`, and a raw JSON Schema object
 * reaches the SDK's `getZodSchemaObject()`, which throws `inputSchema must be
 * a Zod schema or raw shape, received an unrecognized object`. `zod@4`'s own
 * `fromJSONSchema` opens that door with no new dependency (this package
 * already depends on `zod`), and the SDK converts the result straight back to
 * JSON Schema for `tools/list` — so what a client receives is the shape the
 * definition declared.
 *
 * Skipping `inputSchema` is NOT the cheaper half of the same behaviour. The
 * SDK synthesises `{ type: 'object', properties: {} }` for a tool registered
 * without one — a positive claim that the tool takes no arguments — and
 * `executeToolHandler()` then invokes the handler as `handler(extra)`, where
 * `RequestHandlerExtra` carries no `arguments` member at all. A schema-less
 * bridged tool therefore both mis-advertises itself AND executes with `{}`
 * whatever the client sent.
 *
 * A `parameters` that does not describe an object — absent, `{}`, or untyped,
 * all of which `fromJSONSchema` turns into `z.any()` — becomes a LOOSE EMPTY
 * OBJECT. MCP requires `Tool.inputSchema.type` to be `"object"`, and a loose
 * empty object is the honest report of "this definition declares no
 * arguments": it advertises exactly what the SDK would have synthesised, it
 * constrains nothing, and it keeps the arguments flowing to the handler.
 *
 * A `parameters` that cannot be converted at all is logged and gets the same
 * loose empty object. Deliberately not a throw: this runs inside
 * {@link MCPServerRuntime.bridgeTools}, so one unconvertible definition would
 * otherwise take the server's ENTIRE tool surface down.
 */
function toolInputSchema(tool: AIToolDefinition, logger?: Logger): z.ZodType<Record<string, unknown>> {
  const declaresNothing = () => z.looseObject({}) as unknown as z.ZodType<Record<string, unknown>>;

  let converted: unknown;
  try {
    converted = z.fromJSONSchema(tool.parameters as never);
  } catch (err) {
    logger?.warn(`[MCP] Tool "${tool.name}" has unconvertible JSON Schema parameters; bridged with no declared arguments`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return declaresNothing();
  }

  if (converted instanceof z.ZodObject) {
    return converted as unknown as z.ZodType<Record<string, unknown>>;
  }

  logger?.debug(`[MCP] Tool "${tool.name}" declares no object parameters; bridged with no declared arguments`);
  return declaresNothing();
}

// ── Metadata outage vs. metadata miss (#6055, ADR-0110 D3) ───────────────────

/**
 * [#6055] The classification this file gives "the read happened and found
 * nothing", as opposed to {@link METADATA_UNAVAILABLE_CODE} for "the read did
 * not happen". Both are the standard catalog's own codes for their status
 * (`HttpStatusErrorCodeMap[404]` / `[503]`, ADR-0112) — the same spelling the
 * `sys_metadata` half of this family already emits (#5532 / #5843 / #5705), not
 * a vocabulary invented for MCP.
 *
 * [#6504] Its 503 twin moved to `./metadata-completeness.js` when the
 * `list_objects` TOOL joined the `objectstack://objects` RESOURCE in withholding
 * the same claim: two surfaces answering one question must say it in one
 * vocabulary, and this file cannot export to `mcp-http-tools.ts` (it imports
 * from it).
 */
const METADATA_MISS_CODE = 'RESOURCE_NOT_FOUND';

/**
 * [#6055] The sentence for "a read that would have decided this did not
 * happen", modelled on `METADATA_STORE_UNAVAILABLE_MESSAGE` (#5532) —
 * *whether it exists is unknown*, plus the retry advice — with two deliberate
 * differences:
 *
 * 1. It names the **metadata service**, not "the metadata store". The verdict
 *    behind it is `getDiagnosed`'s `degraded`, whose meaning is "at least one
 *    LOADER threw and nothing answered this item" — a loader-set fact, not a
 *    single-store one. PR #6051 records that distinction explicitly (it is why
 *    `degraded` did not copy #5897's `storeUnavailable` spelling), so echoing
 *    "store" here would import the narrower claim.
 * 2. It states what the caller is NOT getting. This surface is fail-CLOSED
 *    both before and after this change — the defect was never that an outage
 *    widened access, only that it was **described** as an author's decision —
 *    and saying so keeps the next reader from "restoring" a body here.
 */
function metadataUnavailableSentence(subject: string, withheld: string): string {
  return (
    `The metadata service could not be read, so whether ${subject} exists is unknown. `
    + `No ${withheld} is being served for this call. `
    + 'Retry once the metadata service is reachable.'
  );
}

/**
 * [#6504] `metadataPartialListingSentence` — the plural counterpart of
 * {@link metadataUnavailableSentence}, and deliberately not the same sentence:
 * the singular one says nothing is being served, because on that surface
 * nothing is, while the plural one serves the best-effort set and withholds
 * only the completeness claim on top of it.
 *
 * It now lives in `./metadata-completeness.js` with the 503 code it travels
 * with — see the note on {@link METADATA_MISS_CODE}.
 */

/** What {@link diagnosedGet} and {@link diagnoseEmptyRead} report. */
interface DiagnosedRead {
  data: unknown;
  degraded: boolean;
  errors: string[];
}

/** What {@link diagnosedList} reports — {@link DiagnosedRead} for a plural read. */
interface DiagnosedListRead {
  items: unknown[];
  degraded: boolean;
  errors: string[];
}

/**
 * [#6504] List one metadata type, keeping the ADR-0110 D3 verdict instead of
 * flattening an outage into an array indistinguishable from a small
 * environment.
 *
 * `IMetadataService.listDiagnosed` is **optional** for the reason
 * `getDiagnosed` is (#5840): a service that predates it cannot report the
 * distinction, so it is read exactly as before and reports nothing degraded.
 * Same probe-and-fall-back shape as {@link diagnosedGet}, one read over.
 *
 * Unlike its singular twin this one is defensive about `items` as well as the
 * verdict — `list` may resolve nullish on an implementation that predates the
 * non-null guarantee, which is why the call site being replaced carried its own
 * `?? []`.
 */
async function diagnosedList(
  metadataService: IMetadataService,
  type: string,
): Promise<DiagnosedListRead> {
  if (typeof metadataService.listDiagnosed === 'function') {
    const diagnosed = await metadataService.listDiagnosed(type);
    return {
      items: Array.isArray(diagnosed?.items) ? diagnosed.items : [],
      degraded: diagnosed?.degraded === true,
      errors: Array.isArray(diagnosed?.errors) ? diagnosed.errors : [],
    };
  }
  return { items: (await metadataService.list(type)) ?? [], degraded: false, errors: [] };
}

/**
 * [#6504] The verdict for a listing that did NOT go through `list` — used by
 * the `objectstack://objects` resource, whose resolver is `listObjects()`.
 *
 * The plural instance of {@link diagnoseEmptyRead}'s decision, taken on the
 * same ground and for the same reason: `listObjects` is its own member of
 * `IMetadataService` and declares **no equivalence** to `list('object')`, so
 * presuming one at a consumer would be the private dialect Prime Directive #12
 * forbids. The resolver is therefore left untouched and only the *question*
 * "could this answer be trusted as complete?" is asked of the member declared
 * to answer it.
 *
 * Two differences from the singular probe, both deliberate:
 *
 * - It runs on **every** answer, not only an empty one. The defect this closes
 *   is a non-empty-but-short list rendered with a confident count, so "the
 *   answer looks fine" is exactly the case that needs asking.
 * - That costs a second read per call in principle and nothing in practice on
 *   the implementation that ships: `MetadataManager.listObjects()` is
 *   `list('object')`, and `list`/`listDiagnosed` share one cache entry and one
 *   single-flight slot, so the probe lands on the entry the resolver just
 *   filled. On a host where the two resolve different sets the verdict
 *   describes the loader set rather than that host's own listing — which
 *   withholds a completeness claim it might have been entitled to, and never
 *   manufactures one it is not. That is the same conservative direction
 *   {@link diagnoseEmptyRead} accepts.
 */
async function diagnoseListRead(
  metadataService: IMetadataService,
  type: string,
): Promise<{ degraded: boolean; errors: string[] }> {
  if (typeof metadataService.listDiagnosed !== 'function') {
    return { degraded: false, errors: [] };
  }
  const diagnosed = await metadataService.listDiagnosed(type);
  return {
    degraded: diagnosed?.degraded === true,
    errors: Array.isArray(diagnosed?.errors) ? diagnosed.errors : [],
  };
}

/**
 * [#8328] The protocol layer's overlay-aware merged read.
 *
 * `IMetadataService.list()` is the registry/loader listing and applies **no**
 * `sys_metadata` overlay merge — a runtime `PUT /api/v1/meta/<type>/<name>`
 * lands in that store and never reaches it. The merge lives one layer up, in
 * the protocol's `getMetaItems`, which reads the overlay rows and resolves them
 * per `(slot, package)` over the registry and MetadataService baselines.
 *
 * Structurally optional, and NOT the optionality `listDiagnosed` has: a host
 * that assembles this runtime without the metadata protocol has no merged read
 * to offer at all, so the seam is absent rather than degraded. `undefined` here
 * therefore means "this host cannot merge", never "merging was skipped".
 */
export interface McpMergedMetadataRead {
  /** The protocol's merged listing for one metadata type. */
  getMetaItems(request: { type: string }): Promise<unknown>;
}

/**
 * Coerce a `getMetaItems` answer into its items array.
 *
 * The protocol answers `{ type, items }`, but the shape is read defensively for
 * the reason `packages/rest` reads it defensively at every one of its own call
 * sites: this is a duck-typed seam across a package boundary, and a host may
 * hand back the bare array.
 */
function metaItemsArray(answer: unknown): unknown[] {
  if (Array.isArray(answer)) return answer;
  const items = (answer as { items?: unknown } | null | undefined)?.items;
  return Array.isArray(items) ? items : [];
}

/**
 * [#8328] List one metadata type through the **merged** read when this host has
 * one, keeping #6504's completeness verdict on top of it.
 *
 * The defect this closes: the skill prompt surface read `list()` one layer
 * below where any overlay merging happens, so a runtime meta PUT returned 200
 * and the flip never reached MCP prompts, while `GET /api/v1/meta/skill` served
 * it from the merged read. Two surfaces, one skill name, two answers.
 *
 * The composition is the point, and it is the one this file already uses for
 * `objectstack://objects`: **items** come from the merged read, and the
 * **verdict** from {@link diagnoseListRead}, which asks `listDiagnosed` the
 * question `getMetaItems` cannot answer. `getMetaItems` swallows a
 * MetadataService read failure into its own `catch` and reports a merged list
 * either way, so taking its answer alone would have silently spent the
 * degraded/errors contract #6504 installed — a known-partial prompt surface
 * would go back to presenting as a complete one. Asking the metadata service
 * directly keeps that verdict addressed to the same set the items came from:
 * the merged list is the registry/overlay layers ON TOP of exactly the
 * MetadataService listing whose completeness is being judged, so a loader that
 * could not be read makes both short together.
 *
 * ⛔ No fallback to the un-merged `list()` when the merged read THROWS. That
 * would answer with registry rows in the shape of merged ones — the very defect
 * above, restored silently at the moment the overlay store is unreadable, which
 * is exactly when an overlay is most likely to be the thing being missed.
 * `getMetaItems` already answers registry-only for the one benign case (the
 * `sys_metadata` table not being provisioned yet); anything it raises past that
 * means overlay rows may exist and were not seen, and the caller's own handling
 * — a warn and no skill prompts — is the honest report.
 */
async function mergedDiagnosedList(
  metadataService: IMetadataService,
  mergedRead: McpMergedMetadataRead | undefined,
  type: string,
): Promise<DiagnosedListRead> {
  if (!mergedRead || typeof mergedRead.getMetaItems !== 'function') {
    return diagnosedList(metadataService, type);
  }
  const items = metaItemsArray(await mergedRead.getMetaItems({ type }));
  const verdict = await diagnoseListRead(metadataService, type);
  return { items, degraded: verdict.degraded, errors: verdict.errors };
}

/**
 * [#6055] Read one metadata item, keeping the ADR-0110 D3 verdict instead of
 * flattening an outage into the same `undefined` a never-declared name
 * produces.
 *
 * `IMetadataService.getDiagnosed` is **optional** (#5840): implementations that
 * predate it cannot report the distinction at all, so a service without it is
 * read exactly as before and reports nothing degraded — which is precisely what
 * it could express. Same probe, same fallback, as the two consumers PR #6051
 * landed (`metadata-protocol/src/protocol.ts`, `objectql/src/plugin.ts`).
 *
 * `getDiagnosed` is the diagnosed twin of `get` (registry-first, and
 * `metadata-manager-get-diagnosed.test.ts` pins that `get()` and
 * `getDiagnosed().data` agree on every case), so swapping it in for a `get`
 * call site changes what the caller LEARNS, never what it resolves.
 */
async function diagnosedGet(
  metadataService: IMetadataService,
  type: string,
  name: string,
): Promise<DiagnosedRead> {
  if (typeof metadataService.getDiagnosed === 'function') {
    const diagnosed = await metadataService.getDiagnosed(type, name);
    return {
      data: diagnosed?.data,
      degraded: diagnosed?.degraded === true,
      errors: Array.isArray(diagnosed?.errors) ? diagnosed.errors : [],
    };
  }
  return { data: await metadataService.get(type, name), degraded: false, errors: [] };
}

/**
 * [#6055] The verdict for a lookup that did NOT go through `get` — used by the
 * `object_schema` resource, whose resolver is `getObject(name)`.
 *
 * Deliberately a **verdict-only probe run after the empty answer**, rather than
 * swapping `getObject` out for `getDiagnosed('object', name)`. The ground is
 * the *contract*, not the runtime: `getObject` is its own member of
 * `IMetadataService`, and at the time of #6055 that member carried **no
 * documented equivalence** to `get('object', name)`. Presuming an undocumented
 * equivalence at a consumer is exactly the private dialect Prime Directive #12
 * forbids, so the resolver is left untouched and only the *question* "could
 * this answer be trusted as complete?" is asked of the contract member that is
 * declared to answer it.
 *
 * [#6724] This TSDoc used to offer a second, factual ground — that the
 * equivalence "does not hold in general", `MetadataFacade.getObject` (objectql)
 * returning "a different shape from its own `get()`". That claim is **false**,
 * and it was asserted rather than measured. `SchemaRegistry.getItem`
 * special-cases `'object'`/`'objects'` straight back to `getObject`, so the
 * facade's `get('object', n)` resolves through the very same lookup, and the
 * `item?.content ?? item` unwrap that follows is a no-op — a merged
 * `ServiceObject` has no `content` key. Measured: the two members hand back the
 * **identical object reference** on a hit, and both answer `undefined` on a
 * miss. All three shipped implementations are pinned that way by
 * `packages/objectql/src/metadata-service-getobject-equivalence.test.ts`
 * (PR #6839 for #6745), and `IMetadataService.getObject` has documented the
 * equivalence since PR #6723 (#6505) — so the "no documented equivalence" half
 * above is a fact about #6055's repo, not today's.
 *
 * Correcting the record does not decide the design question, and this note
 * deliberately does not make that call: whether the resolver should become
 * `getDiagnosed('object', name)` and shed the extra miss-path read is a
 * separate judgement, to be made on its own merits by whoever takes it up.
 *
 * Consequences of that choice, both acceptable and both deliberate:
 * - one extra read on the MISS path only (never on a hit, never on success);
 * - on a host that implements `getDiagnosed` *and* a `getObject` resolving
 *   somewhere else, a degraded loader set makes this answer "unknown" for an
 *   object that is genuinely absent. That is the conservative direction — it
 *   withholds, it never admits — and no such host exists today
 *   (`MetadataManager` is the only `getDiagnosed` implementation on `main`).
 *   Since PR #6723 the contract also rules such a host out by declaration, so
 *   this reads as residual risk against a contract violation, not as a live
 *   divergence anyone can point at.
 */
async function diagnoseEmptyRead(
  metadataService: IMetadataService,
  type: string,
  name: string,
): Promise<{ degraded: boolean; errors: string[] }> {
  if (typeof metadataService.getDiagnosed !== 'function') {
    return { degraded: false, errors: [] };
  }
  const diagnosed = await metadataService.getDiagnosed(type, name);
  return {
    degraded: diagnosed?.degraded === true,
    errors: Array.isArray(diagnosed?.errors) ? diagnosed.errors : [],
  };
}

/**
 * What MCP's `prompts/get` answers with — the text-content subset of the SDK's
 * `GetPromptResult` this surface produces.
 *
 * The index signature is not decoration: the SDK's own result types are
 * `{ [x: string]: unknown; … }` (protocol passthrough plus `_meta`), and a
 * named interface without it is rejected by `registerPrompt`'s callback
 * signature. Narrower than `GetPromptResult` on the `content` union so the pin
 * tests can read `.text` without narrowing at every assertion.
 */
export interface AgentPromptResult {
  [key: string]: unknown;
  messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
}

/** An `Error: …` answer on the prompt surface — this file's existing shape. */
function promptError(text: string): AgentPromptResult {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

/**
 * [#6055] Resolve the `agent_prompt` answer for one call.
 *
 * Exported so the three states below can be pinned directly: the handler is
 * registered on a private `McpServer`, and driving it over a transport would
 * test the SDK rather than this decision.
 *
 * The three states, and why each answers what it does:
 *
 * - **present** — the agent's instructions plus any UI context. Unchanged.
 * - **genuinely absent** — `Error: Agent "X" not found`, byte-identical to
 *   before. A miss is a real fact about what the author declared and this
 *   surface was always right to state it.
 * - **degraded** — an honest {@link METADATA_UNAVAILABLE_CODE} sentence.
 *   Before #6055 this case produced the *not found* text: an availability
 *   failure reported to an MCP client as a declaration fact, the ADR-0110 D3
 *   shape. It never widened access (no instructions were served either way),
 *   so this is a diagnosis fix and MUST stay one — a body served here would be
 *   a security regression, not a nicety.
 *
 * Order matters and is the same narrowing PR #6051 applied to `getMetaItem`:
 * `degraded` only decides the answer once the read has resolved NOTHING, i.e.
 * only when the answer would otherwise have been the unfounded "not found".
 * A read that answered a body is served as it always was.
 */
export async function buildAgentPromptResult(
  metadataService: IMetadataService,
  args: { agentName?: unknown; objectName?: unknown; recordId?: unknown; viewName?: unknown },
  logger?: Logger,
): Promise<AgentPromptResult> {
  const agentName = String(args.agentName ?? '');
  if (!agentName) {
    return promptError('Error: agentName argument is required');
  }

  const read = await diagnosedGet(metadataService, 'agent', agentName);

  if (read.data === undefined || read.data === null) {
    if (read.degraded) {
      logger?.warn(
        '[MCP] agent prompt refused — the metadata service could not be read, so whether this agent '
          + 'exists is unknown. The caller was told SERVICE_UNAVAILABLE and no instructions were served '
          + '(unchanged: nothing is served on a miss either). '
          + 'Fix: check the loaders behind the metadata service (datasource connection, credentials, table).',
        { agentName, errors: read.errors },
      );
      return promptError(
        `Error: ${METADATA_UNAVAILABLE_CODE} — `
          + metadataUnavailableSentence(`agent "${agentName}"`, 'agent instruction'),
      );
    }
    return promptError(`Error: Agent "${agentName}" not found`);
  }

  const agent = read.data as Agent;

  // Build system prompt from agent instructions + context
  const parts: string[] = [];
  parts.push(agent.instructions ?? '');

  const contextHints: string[] = [];
  if (args.objectName) contextHints.push(`Current object: ${args.objectName}`);
  if (args.recordId) contextHints.push(`Selected record ID: ${args.recordId}`);
  if (args.viewName) contextHints.push(`Current view: ${args.viewName}`);
  if (contextHints.length > 0) {
    parts.push('\n--- Current Context ---\n' + contextHints.join('\n'));
  }

  return {
    messages: [{
      role: 'assistant' as const,
      content: { type: 'text' as const, text: parts.join('\n') },
    }],
  };
}

/**
 * What MCP's `resources/read` answers with — the text-content subset of the
 * SDK's `ReadResourceResult`. Carries an index signature for the same reason
 * {@link AgentPromptResult} does.
 */
export interface ObjectSchemaResourceResult {
  [key: string]: unknown;
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}

/**
 * [#6055] Resolve the `objectstack://objects/{objectName}` answer for one call.
 *
 * The `agent_prompt` sibling of this fix, on the second occurrence of the same
 * family in this package: `getObject()` returning `undefined` was read as
 * `Object "X" not found` whether the object was never declared or every loader
 * behind the metadata service was down.
 *
 * A resource body is JSON, so unlike the prompt surface it can carry the
 * classification structurally — and both answers now do, so an MCP client can
 * tell an outage from a miss without parsing prose. The `error` sentence of the
 * miss is unchanged; `code`/`status` are additive.
 *
 * Why the resolver is still `getObject` and the verdict is a second, probe-only
 * read: see {@link diagnoseEmptyRead}.
 */
export async function buildObjectSchemaResource(
  metadataService: IMetadataService,
  objectName: string,
  logger?: Logger,
): Promise<ObjectSchemaResourceResult> {
  const uri = `objectstack://objects/${objectName}`;
  const body = (payload: unknown): ObjectSchemaResourceResult => ({
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(payload) }],
  });

  const objectDef = await metadataService.getObject(objectName);

  if (!objectDef) {
    const { degraded, errors } = await diagnoseEmptyRead(metadataService, 'object', objectName);
    if (degraded) {
      logger?.warn(
        '[MCP] object schema withheld — the metadata service could not be read, so whether this object '
          + 'exists is unknown. The caller was told SERVICE_UNAVAILABLE and no schema was served '
          + '(unchanged: nothing is served on a miss either). '
          + 'Fix: check the loaders behind the metadata service (datasource connection, credentials, table).',
        { objectName, errors },
      );
      return body({
        error: metadataUnavailableSentence(`object "${objectName}"`, 'schema'),
        code: METADATA_UNAVAILABLE_CODE,
        status: 503,
      });
    }
    return body({
      error: `Object "${objectName}" not found`,
      code: METADATA_MISS_CODE,
      status: 404,
    });
  }

  const def = objectDef as ObjectDef;
  const fields = def.fields ?? {};
  const fieldSummary = Object.entries(fields).map(([key, f]) => ({
    name: key,
    type: f.type,
    label: f.label ?? key,
    required: f.required ?? false,
  }));

  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({
        name: def.name,
        label: def.label ?? def.name,
        fields: fieldSummary,
        enableFeatures: def.enable ?? {},
      }, null, 2),
    }],
  };
}

/**
 * [#6504] Resolve the `objectstack://objects` answer for one call.
 *
 * Extracted from the resource handler for the reason
 * {@link buildAgentPromptResult} was: the handler is registered on a private
 * `McpServer`, so driving it over a transport would test the SDK rather than
 * this decision.
 *
 * **This surface MIS-DESCRIBES, and that is why it is treated differently from
 * the skill bridge in {@link MCPServerRuntime.bridgePrompts}.** It renders the
 * listing as `{ objects, totalCount }`, and `totalCount` is a positive, numeric
 * claim about what this environment declares. During a loader outage the claim
 * is simply false — an MCP client is told, with a number, that the environment
 * contains fewer objects than it does — and nothing in the payload lets it tell
 * that from a genuinely small environment.
 *
 * The fix withholds the CLAIM, not the data:
 *
 * - **healthy** — `{ objects, totalCount }`, byte-identical to before. A count
 *   from a complete read is a fact this surface was always right to state.
 * - **degraded** — the same `objects` (the best-effort set is still the most
 *   useful true thing here), and `totalCount` is **absent**. In its place:
 *   `partial: true`, `returnedCount`, and the `code`/`status` envelope the
 *   sibling resource already carries, so a client can branch structurally.
 *
 * Dropping the key rather than reporting a smaller number is the point. A
 * client reading `body.totalCount` gets `undefined` — which fails, or renders
 * as nothing, or throws — where a plausible-looking integer would have been
 * believed. The absent key is the loud version of "we do not know the total";
 * `returnedCount` says the one thing that IS known, in a name that cannot be
 * mistaken for a total.
 *
 * Unchanged in the other direction: this is a diagnosis fix, so a degraded read
 * still serves every object it could reach. Withholding them would be a new
 * functional regression rather than the removal of a false statement.
 */
export async function buildObjectListResource(
  metadataService: IMetadataService,
  logger?: Logger,
): Promise<ObjectSchemaResourceResult> {
  const objects = await metadataService.listObjects();
  const summary = ((objects ?? []) as ObjectDef[]).map(o => ({
    name: o.name,
    label: o.label ?? o.name,
    fieldCount: o.fields ? Object.keys(o.fields).length : 0,
  }));

  // Asked on every answer, not just an empty one — a short list rendered with a
  // confident count is exactly the case that looks fine. See {@link diagnoseListRead}.
  const { degraded, errors } = await diagnoseListRead(metadataService, 'object');

  if (degraded) {
    logger?.warn(
      '[MCP] object listing served WITHOUT a total — the metadata service could not be fully read, so '
        + 'this listing is known-partial and any count taken from it would understate the environment. '
        + 'The caller was told SERVICE_UNAVAILABLE and given the objects that could be read '
        + '(unchanged: the reachable set is still served). '
        + 'Fix: check the loaders behind the metadata service (datasource connection, credentials, table).',
      { returnedCount: summary.length, errors },
    );
  }

  const body = degraded
    ? {
        objects: summary,
        partial: true,
        returnedCount: summary.length,
        warning: metadataPartialListingSentence('objects', summary.length),
        code: METADATA_UNAVAILABLE_CODE,
        status: 503,
      }
    : { objects: summary, totalCount: summary.length };

  return {
    contents: [{
      uri: 'objectstack://objects',
      mimeType: 'application/json',
      text: JSON.stringify(body, null, 2),
    }],
  };
}

/**
 * MCPServerRuntime — Bridges ObjectStack kernel services to the Model Context Protocol.
 *
 * Responsibilities:
 * 1. Bridge ToolRegistry → MCP tools (all registered AI tools)
 * 2. Bridge IMetadataService → MCP resources (object schemas, metadata types)
 * 3. Bridge IDataEngine → MCP resources (record access by URI)
 * 4. Bridge Agent definitions + `skill` metadata → MCP prompts (#3905:
 *    the `instructions` half of an authored skill is what an MCP client can
 *    list and fetch — see `skill-prompts.ts`)
 *
 * Architecture:
 * ```
 * ToolRegistry (service-ai)  ──┐
 * IMetadataService (metadata) ─┼──→  MCPServerRuntime  ──→  McpServer (SDK)
 * IDataEngine (objectql)     ──┤                              │
 * Agent definitions          ──┘                              ├── stdio transport
 *                                                             └── http transport (future)
 * ```
 */
export class MCPServerRuntime {
  private readonly mcpServer: McpServer;
  private readonly config: Required<Pick<MCPServerRuntimeConfig, 'name' | 'version'>> & MCPServerRuntimeConfig;
  private transport: StdioServerTransport | undefined;
  private started = false;

  constructor(config: MCPServerRuntimeConfig = {}) {
    this.config = {
      name: 'objectstack',
      version: '1.0.0',
      transport: 'stdio',
      ...config,
    };

    this.mcpServer = new McpServer(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        // [#8034] `resources` / `tools` / `prompts` are DELIBERATELY absent
        // here — they are declared by the SDK when something is actually
        // registered, never by hand.
        //
        // Until #8034 this object hand-declared all three, and the `tools` one
        // was a lie on the transport that mattered most: `McpServer.registerTool`
        // is what installs the `tools/list` + `tools/call` handlers (its
        // `setToolRequestHandlers()` also calls `server.registerCapabilities({
        // tools: … })`), so a long-lived server that registered NO tool
        // advertised `capabilities.tools: {}` in its `initialize` result and
        // then answered `-32601 Method not found` to every `tools/list` and
        // `tools/call`. That is the dishonest self-report ADR-0076 D12 / #2462
        // forbid — "advertise what you actually serve" — and this lane closed
        // the same shape twice on other surfaces (#7939 `handlerReady: true`
        // for an empty slot, #7602 `capabilities.search` with no route).
        //
        // Deriving them is what makes the two halves agree STRUCTURALLY rather
        // than by two literals that can drift: there is now no way to advertise
        // a primitive without also installing its handlers, because the SDK
        // does both in one call. Registration order is unchanged and already
        // correct — every bridge runs before `start()` connects the transport,
        // which is also what `Server.registerCapabilities` requires (it throws
        // once a transport is attached). The per-request HTTP server in
        // {@link handleHttpRequest} has always built its capabilities this way
        // (see the `skillBridge ? { prompts: {} }` line there); this brings the
        // long-lived server to the same contract.
        //
        // `logging` STAYS hand-declared: it is honest. The SDK has no
        // `registerLogging` to derive it from, and the declaration is itself
        // what wires the `logging/setLevel` request handler and enables
        // `sendLoggingMessage` — so here, declared IS served.
        capabilities: {
          logging: {},
        },
        instructions: this.config.instructions ?? 'ObjectStack MCP Server — access data objects, AI tools, and agent prompts.',
      },
    );
  }

  /** The underlying McpServer instance (for advanced use cases). */
  get server(): McpServer {
    return this.mcpServer;
  }

  /** Whether the server is currently connected and running. */
  get isStarted(): boolean {
    return this.started;
  }

  // ── Helpers ─────────────────────────────────────────────────────

  /**
   * Extract the text value from a ToolExecutionResult's output.
   *
   * The output may be a `{ type: 'text', value: string }` object (from the
   * Vercel AI SDK ToolResultPart) or any serialisable value.
   */
  private static formatToolOutput(result: ToolExecutionResult): string {
    const output = result.output;
    if (output && typeof output === 'object' && 'value' in output) {
      return String((output as { value: unknown }).value);
    }
    return JSON.stringify(output ?? '');
  }

  // ── Tool Bridge ────────────────────────────────────────────────

  /**
   * Bridge all tools from the ToolRegistry to MCP tools.
   *
   * Each registered tool becomes an MCP tool with the same name, description
   * and declared arguments: `AIToolDefinition.parameters` is JSON Schema, and
   * {@link toolInputSchema} converts it into the Zod schema the SDK requires
   * for `inputSchema`. Its safety annotations come from what the definition
   * declares — see {@link safetyAnnotations}. The handler delegates to the
   * ToolRegistry's execute path.
   */
  bridgeTools(toolRegistry: ToolRegistry): void {
    const tools = toolRegistry.getAll();
    const logger = this.config.logger;

    for (const tool of tools) {
      this.registerToolFromDefinition(tool, toolRegistry);
    }

    logger?.info(`[MCP] Bridged ${tools.length} tools from ToolRegistry`);
  }

  /**
   * [#8034] Bridge a principal-bound {@link McpDataBridge} onto the LONG-LIVED
   * server — the object-CRUD tools, plus the business-action pair when the
   * bridge carries that seam.
   *
   * This is the stdio counterpart of what {@link handleHttpRequest} does per
   * request, and it exists because that per-request call used to be the ONLY
   * one. `registerObjectTools` / `registerActionTools` were reachable from
   * nowhere else, so the long-lived server's entire tool surface was whatever
   * {@link bridgeTools} found in the AI service's function-calling
   * `ToolRegistry` — a DIFFERENT surface, empty on any app that registers no AI
   * tools. The stdio transport therefore served zero tools while advertising
   * the `tools` capability, and every `tools/list` / `tools/call` answered
   * `-32601 Method not found`. Both transports now register through the one
   * {@link wireBridgeTools} composition.
   *
   * Ordering: call this BEFORE {@link start}. Tool registration is also what
   * declares the `tools` capability (see the constructor), and the SDK refuses
   * to register capabilities once a transport is attached. The plugin bridges
   * everything ahead of `start()` for exactly that reason.
   *
   * Not called for a host that has no principal to bind: no bridge means no
   * tools registered and no `tools` capability advertised, which is the honest
   * report rather than an empty promise (ADR-0076 D12).
   *
   * @returns the tool names registered, for the caller's boot log.
   */
  bridgeDataTools(
    bridge: McpDataBridge & Partial<McpActionBridge>,
    toolOptions?: RegisterObjectToolsOptions & RegisterActionToolsOptions,
  ): string[] {
    const registered = wireBridgeTools(this.mcpServer, bridge, toolOptions);
    this.config.logger?.info(
      `[MCP] Bridged ${registered.length} data tools (${registered.join(', ')})`,
    );
    return registered;
  }

  /**
   * Register a single tool on the MCP server from an AIToolDefinition.
   *
   * The definition's JSON Schema `parameters` is forwarded as the tool's
   * `inputSchema` (see {@link toolInputSchema} for why it must be converted
   * first). Declaring it is what makes the SDK hand the call's arguments to
   * this handler at all: `McpServer.executeToolHandler()` branches on
   * `tool.inputSchema` and invokes a schema-less tool as `handler(extra)` —
   * with no `arguments` anywhere on that `extra` (`RequestHandlerExtra` has no
   * such member), which is why a bridged tool used to execute with `{}` no
   * matter what the client sent.
   *
   * The safety annotations come from {@link safetyAnnotations}, which reads
   * what the definition DECLARES and omits the hints it cannot source; the
   * name-derived `readOnlyHint: false, destructiveHint: false` this call used
   * to assert over every unlisted tool is gone. `openWorldHint` now goes
   * through {@link worldAnnotation} on the same principle — asserted `false`
   * for platform-registered names, omitted for everyone else — but read that
   * function before assuming the two omissions cost the same thing: the SDK
   * defaults them in opposite directions.
   */
  private registerToolFromDefinition(tool: AIToolDefinition, toolRegistry: ToolRegistry): void {
    const logger = this.config.logger;

    this.mcpServer.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: toolInputSchema(tool, logger),
        annotations: {
          // Only the hints these two can source — a tool that declares nothing
          // and is not a platform name is served neither set, so the MCP
          // defaults apply. Those defaults are NOT symmetrical between them;
          // {@link worldAnnotation} is where that is written down.
          ...safetyAnnotations(tool),
          ...worldAnnotation(tool),
        },
      },
      async (args) => {
        try {
          const result = await toolRegistry.execute({
            type: 'tool-call',
            toolCallId: `mcp-${tool.name}-${Date.now()}`,
            toolName: tool.name,
            input: args,
          });

          const outputText = MCPServerRuntime.formatToolOutput(result);

          if (result.isError) {
            return {
              content: [{ type: 'text' as const, text: outputText }],
              isError: true,
            };
          }

          return {
            content: [{ type: 'text' as const, text: outputText }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger?.warn(`[MCP] Tool "${tool.name}" execution failed:`, { error: message });
          return {
            content: [{ type: 'text' as const, text: message }],
            isError: true,
          };
        }
      },
    );
  }

  // ── Resource Bridge ────────────────────────────────────────────

  /**
   * Bridge metadata service and data engine to MCP resources.
   *
   * Exposes:
   * - `objectstack://objects` — List all data objects
   * - `objectstack://objects/{objectName}` — Get object schema
   * - `objectstack://objects/{objectName}/records/{recordId}` — Get a specific record
   * - `objectstack://metadata/types` — List all metadata types
   */
  bridgeResources(
    metadataService: IMetadataService,
    getRecord?: (objectName: string, recordId: string) => Promise<Record<string, unknown> | null>,
  ): void {
    const logger = this.config.logger;
    let resourceCount = 0;

    // ── Static resource: List all objects ──
    this.mcpServer.registerResource(
      'object_list',
      'objectstack://objects',
      {
        description: 'List all data objects (tables) in the ObjectStack instance',
        mimeType: 'application/json',
      },
      async () =>
        // [#6504] The completeness of the count lives in the builder — see
        // {@link buildObjectListResource}.
        buildObjectListResource(metadataService, logger),
    );
    resourceCount++;

    // ── Template resource: Object schema ──
    this.mcpServer.registerResource(
      'object_schema',
      new ResourceTemplate('objectstack://objects/{objectName}', { list: undefined }),
      {
        description: 'Get the full schema of a specific data object including fields and features',
        mimeType: 'application/json',
      },
      async (_uri, variables) =>
        // [#6055] Outage vs. miss lives in the builder — see
        // {@link buildObjectSchemaResource}.
        buildObjectSchemaResource(metadataService, String(variables.objectName), logger),
    );
    resourceCount++;

    // ── Template resource: Record by ID ──
    // The ONE resource that reads ROW data, so it MUST run under a principal
    // (ADR-0101): the caller supplies a principal-bound reader that applies
    // RLS/FLS/tenant (e.g. `ql.find(obj, { where: { id }, context })`). Without
    // one, the resource is NOT registered — there is deliberately no unscoped
    // fallback. The long-lived stdio server reaches this only after the plugin
    // resolved `OS_MCP_STDIO_API_KEY` to an identity; the reader re-resolves per
    // call, so a revoked/expired key stops working on the next read.
    if (getRecord) {
      this.mcpServer.registerResource(
        'record_by_id',
        new ResourceTemplate('objectstack://objects/{objectName}/records/{recordId}', { list: undefined }),
        {
          description: 'Get a specific record by ID from a data object (under the caller\'s permissions and row-level security)',
          mimeType: 'application/json',
        },
        async (_uri, variables) => {
          const objectName = String(variables.objectName);
          const recordId = String(variables.recordId);

          try {
            const record = await getRecord(objectName, recordId);

            if (!record) {
              return {
                contents: [{
                  uri: `objectstack://objects/${objectName}/records/${recordId}`,
                  mimeType: 'application/json',
                  text: JSON.stringify({ error: `Record "${recordId}" not found in "${objectName}"` }),
                }],
              };
            }

            return {
              contents: [{
                uri: `objectstack://objects/${objectName}/records/${recordId}`,
                mimeType: 'application/json',
                text: JSON.stringify(record, null, 2),
              }],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              contents: [{
                uri: `objectstack://objects/${objectName}/records/${recordId}`,
                mimeType: 'application/json',
                text: JSON.stringify({ error: message }),
              }],
            };
          }
        },
      );
      resourceCount++;
    }

    // ── Static resource: Metadata types ──
    if (metadataService.getRegisteredTypes) {
      this.mcpServer.registerResource(
        'metadata_types',
        'objectstack://metadata/types',
        {
          description: 'List all registered metadata types (object, app, view, agent, tool, etc.)',
          mimeType: 'application/json',
        },
        async () => {
          const types = await metadataService.getRegisteredTypes!();
          return {
            contents: [{
              uri: 'objectstack://metadata/types',
              mimeType: 'application/json',
              text: JSON.stringify({ types, totalCount: types.length }, null, 2),
            }],
          };
        },
      );
      resourceCount++;
    }

    logger?.info(`[MCP] Bridged ${resourceCount} resource endpoints`);
  }

  // ── Prompt Bridge ──────────────────────────────────────────────

  /**
   * Bridge registered agents **and authored skills** to MCP prompts.
   *
   * Two prompt families land here:
   *
   * 1. `agent_prompt` — one dynamic prompt that loads an agent's system prompt
   *    by name, with optional UI context (objectName, recordId, viewName).
   * 2. One prompt per authored `skill` that carries `instructions` (#3905).
   *    This is the open distribution's consumer for skill metadata: a tenant
   *    writes `*.skill.ts`, and its instructions become a prompt any MCP client
   *    connected to this server can list and fetch. See `skill-prompts.ts` for
   *    why only the instructions half projects.
   *
   * The skill **list** is a snapshot taken here (the stdio transport registers
   * prompts with the SDK, which owns `prompts/list` for this server); each
   * prompt's **body** is re-read from metadata at `prompts/get` time, so an
   * edited skill serves fresh text without a restart. The HTTP transport builds
   * its server per request and is live on both — see {@link handleHttpRequest}.
   *
   * [#8328] `mergedRead` is the protocol layer's overlay-aware listing (see
   * {@link McpMergedMetadataRead}). When the host can supply it, the skill read
   * goes through it so a runtime `PUT /api/v1/meta/skill/<name>` reaches this
   * surface; without it the read is the pre-#8328 one, unchanged. It is a
   * parameter rather than something resolved in here because this runtime is
   * handed its collaborators and holds no service registry of its own — the
   * assembly that knows both services wires them together (`plugin.ts`).
   *
   * ⚠️ This bridges the **long-lived** server only — the one the stdio
   * transport serves. The HTTP surface at `/api/v1/mcp` builds a fresh server
   * per request from a bridge the RUNTIME supplies
   * (`packages/runtime/src/domains/mcp.ts` → `buildMcpBridge`), and its
   * `listSkills` is a separate read that this parameter cannot reach. Both
   * surfaces have to be pointed at the merged read to close #8328; this one is
   * the half that lives in this package.
   */
  async bridgePrompts(
    metadataService: IMetadataService,
    mergedRead?: McpMergedMetadataRead,
  ): Promise<void> {
    const logger = this.config.logger;

    // Register a dynamic prompt that loads agents at call time
    this.mcpServer.registerPrompt(
      'agent_prompt',
      {
        description: 'Load an agent\'s system prompt with optional UI context. ' +
          'Use the agentName argument to select which agent\'s instructions to use.',
        argsSchema: {
          agentName: z.string().describe('Name of the agent to load (e.g. "data_chat", "metadata_assistant")'),
          objectName: z.string().optional().describe('Current object the user is viewing'),
          recordId: z.string().optional().describe('Currently selected record ID'),
          viewName: z.string().optional().describe('Current view name'),
        },
      },
      async (args) =>
        // [#6055] Outage vs. miss lives in the builder — see
        // {@link buildAgentPromptResult}.
        buildAgentPromptResult(metadataService, args, logger),
    );

    logger?.info('[MCP] Agent prompts bridged');

    // ── Skill metadata → MCP prompts (#3905) ──
    // [#6504] This consumer is a SNAPSHOT, not a mis-describing surface, and is
    // treated accordingly — the per-consumer discipline PR #6051 established,
    // applied rather than a blanket rule. Unlike `objectstack://objects` it
    // publishes no count and makes no completeness claim to any client: what a
    // degraded read costs here is that skills a loader could not be reached for
    // are silently not registered as prompts. There is nobody to tell — the
    // reply this read shapes is the SDK's own `prompts/list`, whose shape this
    // file does not own, and inventing a placeholder prompt to carry the news
    // would put a fabricated entry in a list whose entire purpose is to say
    // what exists.
    //
    // So the verdict goes to the operator, at `warn`: a functional degradation
    // (the prompt surface is visibly smaller than it should be), not a
    // durability one, which is the level AGENTS.md → "Degradation log levels"
    // prescribes. What makes it worth saying at all is the snapshot's LIFETIME:
    // the stdio transport takes this list once at bridge time, so an outage
    // during boot leaves the prompt surface short until the server is
    // restarted, long after the loader heals. The HTTP transport rebuilds per
    // request and self-heals — the line says which one the reader is looking at.
    let skillListVerdict: { degraded: boolean; errors: string[] } = { degraded: false, errors: [] };
    const skillBridge: McpSkillBridge = {
      listSkills: async () => {
        // The verdict of the READ, recorded as the read happens. `listSkills`
        // is also the per-call re-read behind each registered prompt's body, so
        // this is deliberately last-read-wins rather than boot-only: the
        // snapshot check below runs immediately after its own call.
        //
        // [#8328] Through the merged read when this host has one — the whole
        // point of the re-read above is that an edited skill serves fresh text,
        // and a runtime meta PUT is the edit that never arrived.
        const read = await mergedDiagnosedList(metadataService, mergedRead, 'skill');
        skillListVerdict = { degraded: read.degraded, errors: read.errors };
        return read.items;
      },
    };

    let skills: Awaited<ReturnType<typeof listSkillPrompts>>;
    try {
      skills = await listSkillPrompts(skillBridge);
    } catch (err) {
      // A metadata service that cannot list this type is not a boot failure —
      // the server keeps its tools, resources and agent prompt.
      const message = err instanceof Error ? err.message : String(err);
      logger?.warn(`[MCP] Could not read skill metadata for the prompt surface: ${message}`);
      return;
    }

    // [#6504] The read ANSWERED, and the answer is known-short. Before this the
    // two outcomes were indistinguishable from here: `list('skill')` resolves
    // an array whether every loader answered or one of them was down, so a
    // partial prompt surface was bridged with the same single `info` line a
    // complete one gets.
    if (skillListVerdict.degraded) {
      logger?.warn(
        '[MCP] skill prompt list is INCOMPLETE — the metadata service could not be fully read, so skills '
          + 'held by the unreadable loader(s) are missing from this surface. They are missing, NOT undeclared: '
          + 'an MCP client listing prompts now sees fewer than this environment declares. '
          + 'The stdio transport takes this list once at bridge time, so it stays short until the server is '
          + 'restarted, even after the loader recovers; the HTTP transport rebuilds per request and self-heals. '
          + 'Fix: check the loaders behind the metadata service (datasource connection, credentials, table).',
        { readable: skills.length, errors: skillListVerdict.errors },
      );
    }

    let bridged = 0;
    for (const skill of skills) {
      if (skill.name === 'agent_prompt') {
        // The one reserved name on this surface. Never silently dropped: the
        // author is told which skill collided and what it costs them.
        logger?.warn(
          `[MCP] Skill "${skill.name}" is not exposed as a prompt — that name is reserved by the built-in agent prompt. Rename the skill to make its instructions reachable over MCP.`,
        );
        continue;
      }
      this.mcpServer.registerPrompt(
        skill.name,
        {
          ...(skill.title ? { title: skill.title } : {}),
          ...(skill.description ? { description: skill.description } : {}),
        },
        async () => {
          // Re-read at call time so an edited skill serves fresh instructions.
          const current = (await listSkillPrompts(skillBridge)).find((s) => s.name === skill.name);
          return skillPromptResult(current ?? skill);
        },
      );
      bridged++;
    }

    logger?.info(`[MCP] Bridged ${bridged} skill prompts`);
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /**
   * Start the MCP server with the configured transport.
   *
   * For stdio transport, this connects to process stdin/stdout.
   */
  async start(): Promise<void> {
    if (this.started) return;

    const logger = this.config.logger;

    if (this.config.transport === 'stdio') {
      // [#7915] stdin as usual, stdout through the transport's OWN channel to
      // the real stream. A host that boots this plugin must keep its banners
      // and kernel logs off stdout (the framing is newline-delimited JSON), and
      // the only way to move every writer at once is to intercept
      // `process.stdout.write` — which would swallow these frames too. See
      // protocol-stdout.ts for why the transport claims the channel itself
      // rather than being handed one.
      this.transport = new StdioServerTransport(process.stdin, protocolStdout());
      await this.mcpServer.connect(this.transport);
      // [#7645] The transport now OWNS this process's stdin — so make sure it
      // is actually flowing. `StdioServerTransport.start()` only attaches a
      // `data` listener, and Node auto-switches a stream to flowing mode on
      // that listener ONLY while `readableFlowing` is still `null`. Once
      // something has explicitly called `pause()`, the flag is `false` and a
      // later `data` listener does NOT resume it: the listener is attached,
      // `bytesRead` stays 0, and the server is started-but-permanently-deaf.
      //
      // That is not hypothetical. Under `objectstack serve`, oclif's argument
      // parser reads stdin for any positional arg the user did not supply
      // (`tryStdin` → `createInterface({input: process.stdin})`, aborted after
      // 10 ms), and `Interface.close()` calls `stdin.pause()`. `serve` declares
      // an optional `config` positional, so `os serve --dev` (no path) left
      // stdin paused and EVERY `initialize` / `tools/list` / `resources/read`
      // timed out with zero bytes on stdout — while the same command WITH the
      // path (parser never touches stdin) answered fine. Measured both ways.
      //
      // The resume lives here rather than in the CLI because the pause is not
      // oclif-specific: any host that touched stdin before `start()` (a
      // readline prompt, a supervisor, an embedding process) leaves it paused,
      // and every one of them yields the same silent deafness. This is the one
      // place that knows a long-lived stdio transport was just attached.
      //
      // Resumed AFTER `connect()` on purpose: `connect()` attaches the
      // transport's `data` listener, so no byte can flow before there is a
      // reader for it.
      if (typeof process !== 'undefined' && typeof process.stdin?.resume === 'function') {
        process.stdin.resume();
      }
      this.started = true;
      logger?.info(`[MCP] Server started (transport: stdio, name: ${this.config.name})`);
    } else {
      // HTTP is served per-request via `handleHttpRequest()` (mounted by the
      // runtime dispatcher at `/api/v1/mcp`), not through a long-lived
      // `connect()` like stdio — so there is nothing to start here.
      logger?.info('[MCP] HTTP transport ready (served per-request at /api/v1/mcp).');
    }
  }

  /**
   * Stop the MCP server and disconnect the transport.
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    await this.mcpServer.close();
    this.transport = undefined;
    this.started = false;
    this.config.logger?.info('[MCP] Server stopped');
  }

  /**
   * Render the portable Agent Skill (`SKILL.md`) for this environment
   * (ADR-0036 Amendment C: ONE generic skill, schema discovered live).
   *
   * Exposed on the runtime so HTTP hosts can serve it (`GET /api/v1/mcp/skill`
   * in the runtime dispatcher) without depending on `@objectstack/mcp` —
   * they duck-call this through the registered `'mcp'` service, mirroring
   * how `handleHttpRequest` is reached.
   */
  renderSkill(options?: RenderSkillOptions): string {
    return renderSkillMarkdown(options);
  }

  // ── HTTP (Streamable HTTP) transport ───────────────────────────

  /**
   * Handle one MCP request over the **Streamable HTTP** transport (Web Standard
   * `Request`/`Response`), the network-reachable surface for external agents.
   *
   * Stateless by design: a fresh {@link McpServer} + transport is built per
   * request (the SDK-recommended pattern for stateless HTTP — it avoids any
   * cross-request session/request-id collision and keeps each call isolated).
   * The tool set is the object-CRUD bridge plus — when the bridge can resolve
   * the framework's action mechanism — the business-action tools
   * (`list_actions` / `run_action`), all bound to the **caller's principal**
   * via `bridge`; the runtime wires that bridge to the existing permission +
   * RLS path, so an external agent can never exceed the key's authority.
   *
   * Only these native tools are exposed here — the internal AI/authoring
   * toolRegistry (which can mutate metadata) is deliberately NOT bridged onto
   * the external surface.
   *
   * **Prompts (#3905).** When the bridge can also read this environment's
   * `skill` metadata (`listSkills`), the server additionally serves the MCP
   * `prompts` primitive: every authored skill that carries `instructions`
   * becomes a prompt the client can `prompts/list` and `prompts/get`. The
   * projection is read from the SAME per-request, environment-scoped bridge the
   * tools use — never from server-held state — so a multi-tenant host cannot
   * serve one environment's skills to another. A bridge without `listSkills`
   * does not declare the capability at all (graceful degradation, as with the
   * action tools).
   *
   * @param request    The inbound Web `Request` (headers/method/url).
   * @param opts.bridge       Principal-bound data (+ optional action / skill) accessor (required to expose tools).
   * @param opts.parsedBody   Pre-parsed JSON-RPC body (the dispatcher already read it).
   * @param opts.authInfo     Optional auth info forwarded to message handlers.
   * @param opts.toolOptions  Tool exposure options (system objects, query limits).
   */
  async handleHttpRequest(
    request: Request,
    opts: {
      bridge?: McpDataBridge & Partial<McpActionBridge> & Partial<McpSkillBridge>;
      parsedBody?: unknown;
      authInfo?: unknown;
      toolOptions?: RegisterObjectToolsOptions & RegisterActionToolsOptions;
    } = {},
  ): Promise<Response> {
    // The prompt surface is wired by capability, like the action tools: a
    // bridge that cannot read skill metadata gets no `prompts` capability and
    // no handlers, rather than a capability that answers nothing.
    const skillBridge =
      opts.bridge && typeof opts.bridge.listSkills === 'function'
        ? (opts.bridge as McpSkillBridge)
        : undefined;

    // Fresh, isolated server per request (stateless).
    const server = new McpServer(
      { name: this.config.name, version: this.config.version },
      {
        // [#8034] `tools` is DERIVED, exactly as on the long-lived server:
        // `registerObjectTools` declares it when it registers the first tool,
        // so a request that supplies no bridge (or a grant that registers
        // nothing) now advertises no tool capability instead of advertising one
        // and answering `-32601` — which is what the two "registers nothing"
        // pins in this package already describe in their titles.
        //
        // `prompts` STAYS hand-declared and is not the same case:
        // `registerSkillPrompts` installs LOW-LEVEL request handlers so the
        // list can be read at call time, and `Server.setRequestHandler` refuses
        // a handler whose capability was not declared first. Here the
        // declaration is what makes the handlers installable, and it is gated
        // on the seam actually being there — declared IS served.
        capabilities: { ...(skillBridge ? { prompts: {} } : {}) },
        instructions:
          this.config.instructions ??
          'ObjectStack MCP Server — query and modify your app\'s data objects as tools.',
      },
    );

    if (skillBridge) {
      registerSkillPrompts(server, skillBridge);
    }

    if (opts.bridge) {
      // [#8034] The SAME composition the long-lived server uses in
      // {@link bridgeDataTools} — including the by-capability action wiring
      // that used to be open-coded here. Two transports, one call site.
      wireBridgeTools(server, opts.bridge, opts.toolOptions);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      // Stateless: no session id, single request/response.
      sessionIdGenerator: undefined,
      // Return a buffered JSON response (no long-lived SSE) — fits the
      // Worker→container hop without streaming pass-through concerns.
      enableJsonResponse: true,
    });

    await server.connect(transport);
    try {
      // JSON-response mode fully materialises the Response before resolving,
      // so it is safe to close the per-request server in `finally`.
      return await transport.handleRequest(request, {
        parsedBody: opts.parsedBody,
        authInfo: opts.authInfo as any,
      });
    } finally {
      await server.close().catch(() => {});
    }
  }
}
