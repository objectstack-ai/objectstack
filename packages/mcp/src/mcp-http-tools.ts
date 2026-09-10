// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * mcp-http-tools — object CRUD exposed as MCP tools, for EVERY transport.
 *
 * These are the tools an external agent (Claude Desktop / Cursor) drives, over
 * the network or down a local pipe. Every operation MUST run under the caller's
 * resolved principal: we never touch the data engine directly here, all
 * reads/writes go through an injected {@link McpDataBridge} that the host wires
 * to the SAME permission/RLS-enforcing path the REST API uses. This module owns
 * the tool *shape*; the bridge owns *execution + security*.
 *
 * [#8034] The file name says `http` for historical reasons only, and believing
 * it cost this package a transport. Until #8034 {@link registerObjectTools} and
 * {@link registerActionTools} were called from exactly one place —
 * `MCPServerRuntime.handleHttpRequest()`, on the throwaway per-request server —
 * so the LONG-LIVED server behind the stdio transport reached `tools/list` with
 * an empty registry and answered `-32601` while its `initialize` result
 * advertised `capabilities.tools`. {@link wireBridgeTools} is now the one
 * composition both transports call, so a tool added here reaches both by
 * construction and neither can silently serve a different set.
 *
 * The bridge, not the transport, is what varies: the HTTP host binds it to the
 * request's ExecutionContext, the stdio host to the `OS_MCP_STDIO_API_KEY`
 * identity (re-resolved per call, ADR-0101). Both hand the same interface here.
 *
 * SECURITY (zero-tolerance):
 *  - System objects (`sys_*`) are NOT exposed by default — fail-closed guard on
 *    every tool that takes an object name, independent of the bridge.
 *  - The bridge is bound to the caller's principal; tools cannot widen it.
 *  - Errors are returned as tool errors (text), never thrown across the wire,
 *    and never include secrets.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import {
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_ACTIONS,
} from '@objectstack/spec/ai';
// [#15942 / #16293] The confirmation member the `run_action` door accepts and
// forwards. Imported, never hand-spelled: the door that refuses (the runtime's
// `actionConfirmationRefusal`) and the client that retries have to agree on the
// spelling, and this door is the one that has to advertise it.
import {
  AI_ACTION_CONFIRMATION_MEMBER,
  type AIActionConfirmation,
} from '@objectstack/spec/contracts';
import {
  validateExpression,
  introspectScope,
  inferExpressionType,
  type FieldRole,
} from '@objectstack/formula';
// [#16913] The unknown-key error map every `strictToolInput` shape below is
// built with. Imported, never re-implemented: #4001 is this repo's ruling on
// silent key stripping and its explicit instruction is that the parts already
// exist ("这件事需要的零件**已经全在仓库里**"). This is the published factory
// the `packages/spec` campaign standardised on — already carried in
// `api-surface/shared.json`, so reusing it adds nothing to any public surface.
import { strictUnknownKeyError } from '@objectstack/spec/shared';
import {
  METADATA_UNAVAILABLE_CODE,
  metadataPartialListingSentence,
  type DiagnosedObjectListing,
} from './metadata-completeness.js';

export interface McpObjectSummary {
  name: string;
  label?: string;
  fieldCount?: number;
}

/**
 * Data access seam for the HTTP MCP tools. Implemented by the runtime/dispatcher
 * so execution flows through the existing permission + RLS path bound to the
 * caller's ExecutionContext. Every method runs AS the authenticated principal.
 */
export interface McpDataBridge {
  listObjects(): Promise<McpObjectSummary[]>;
  /**
   * [#6504] The same listing, plus whether it can be trusted as COMPLETE.
   *
   * The `list_objects` tool renders its answer as `{ objects, totalCount }`,
   * and `totalCount` is a positive, numeric claim about what this environment
   * declares. During a metadata loader outage that claim is simply false, and
   * nothing in the payload lets a client tell it from a genuinely small
   * environment — the ADR-0110 D3 shape the `objectstack://objects` RESOURCE
   * already closed (PR #7721) and this TOOL did not. The two are the same
   * question asked over two transports, so they now answer it the same way.
   *
   * OPTIONAL, and its optionality is the bridge's own graceful-degradation
   * contract (same as {@link McpDataBridge.aggregate}), stacked on
   * `IMetadataService.listDiagnosed`'s: a bridge that cannot ask its metadata
   * service for a verdict omits this member, the tool behaves exactly as it did
   * before, and nothing anywhere claims completeness it did not establish.
   */
  listObjectsDiagnosed?(): Promise<DiagnosedObjectListing<McpObjectSummary>>;
  describeObject(name: string): Promise<unknown | null>;
  query(
    object: string,
    opts: {
      where?: Record<string, unknown>;
      fields?: string[];
      limit?: number;
      offset?: number;
      orderBy?: Array<{ field: string; order: 'asc' | 'desc' }>;
    },
  ): Promise<unknown>;
  /**
   * [ADR-0090 D10 — maintainer ruling 2026-09-08, #16549] Is a read on `object`
   * NARROWED by the agent ceiling the caller runs under?
   *
   * The transport half of the ruling's consequence (2), and it exists because
   * the deceived consumer on this surface is the **AI itself**: a delegated
   * `query_records` answering `total: 0` with no note is read by the agent as a
   * fact about the data, and it then tells a decision-maker "there are no
   * opportunities this quarter". A narrowed count must arrive WITH the
   * narrowing stated.
   *
   * OPTIONAL, with the same graceful-degradation contract as
   * {@link McpDataBridge.listObjectsDiagnosed} and
   * {@link McpDataBridge.aggregate}: a bridge bound to a principal that cannot
   * be delegated (the stdio API-key host), or wired to a security service
   * predating the probe, omits this member and the tool renders exactly what it
   * rendered before.
   *
   * ⛔ `{ narrowed: false }` and "cannot say" are deliberately the same RENDERED
   * outcome — neither may manufacture a warning. The tool states a narrowing
   * only where one was established.
   */
  diagnoseDelegation?(object: string): Promise<{ narrowed: boolean; statement?: string } | undefined>;
  get(object: string, id: string): Promise<unknown>;
  create(object: string, data: Record<string, unknown>): Promise<unknown>;
  update(object: string, id: string, data: Record<string, unknown>): Promise<unknown>;
  remove(object: string, id: string): Promise<unknown>;
  /**
   * GROUP BY aggregation through the ObjectQL engine's read path (RLS + the
   * FLS aggregate-input gate). OPTIONAL: a runtime that cannot route
   * aggregation through the engine simply omits it and the
   * `aggregate_records` tool is not registered (graceful degradation, same
   * contract as {@link McpActionBridge}).
   *
   * `groupBy` / `aggregations` are the engine's own declarations
   * (`EngineAggregateOptions`, #8032) rather than a hand-mirrored copy: the
   * tool's zod schema below already enforces exactly these shapes at the
   * ingress, and a private restatement is where the two had drifted — this
   * interface used to declare `function: string` against the six-name enum
   * and a `distinct?: boolean` the engine retired (#6815), silently dropping
   * any caller who believed it.
   */
  aggregate?(
    object: string,
    opts: {
      where?: Record<string, unknown>;
      groupBy?: NonNullable<EngineAggregateOptions['groupBy']>;
      aggregations: NonNullable<EngineAggregateOptions['aggregations']>;
      timezone?: string;
    },
  ): Promise<unknown[]>;
}

export interface RegisterObjectToolsOptions {
  /** Expose `sys_*` system objects too. Default false (fail-closed). */
  allowSystemObjects?: boolean;
  /** Hard cap on `query_records` page size. Default 50. */
  maxQueryLimit?: number;
  /**
   * OAuth 2.1 scopes granted to the caller's access token (#2698).
   * UNDEFINED = not scope-limited (API-key / session provenance) — the full
   * principal-bound tool surface registers, today's behavior. An ARRAY
   * narrows registration to the granted tool families, fail-closed:
   * `data:read` → list/describe/query/get, `data:write` → create/update/
   * delete, `actions:execute` → list_actions/run_action. An empty array
   * registers nothing. Scopes only bound the tool surface — every call
   * still runs under the principal's permissions and RLS.
   */
  grantedScopes?: readonly string[];
}

/** One declared input parameter of a business action, LLM-facing. */
export interface McpActionParamSummary {
  name: string;
  type?: 'string' | 'number' | 'boolean' | 'array';
  required?: boolean;
  description?: string;
  /** Allowed values, when the param (or its backing field) is an enum. */
  enum?: string[];
}

/**
 * A business action the caller may invoke, as surfaced by `list_actions`.
 * Mirrors {@link McpObjectSummary} for the action surface: enough for an agent
 * to decide whether and how to call `run_action`, nothing engine-internal.
 */
export interface McpActionSummary {
  /** Declarative action name — the identifier passed to `run_action`. */
  name: string;
  /** The object the action operates on (omitted for object-less actions). */
  objectName?: string;
  /** Human label. */
  label?: string;
  /** What the action does (the authored `ai.description` when present). */
  description?: string;
  /** Dispatch kind: `script` | `flow` | `api`. */
  type?: string;
  /** True when the action acts on a row and so needs a `recordId`. */
  requiresRecord?: boolean;
  /** True when the action is destructive / an author flagged it for confirmation. */
  requiresConfirmation?: boolean;
  /** Declared input parameters. */
  params?: McpActionParamSummary[];
}

/**
 * Action-execution seam for the HTTP MCP tools. Implemented by the runtime so
 * resolution + dispatch flows through the framework's own action mechanism
 * (`IDataEngine.executeAction` / automation flow runner) bound to the caller's
 * ExecutionContext — the SAME permission + RLS path the REST `/actions/...`
 * endpoint uses. Every method runs AS the authenticated principal.
 *
 * Deliberately decoupled from {@link McpDataBridge}: a runtime that cannot
 * resolve the action mechanism simply does not implement this, and the action
 * tools are then not registered (graceful degradation — see
 * `registerActionTools`). Bridging here is direct framework-contract access; it
 * does NOT depend on `@objectstack/service-ai`.
 */
export interface McpActionBridge {
  /** Actions the caller may run, already filtered by permission + visibility. */
  listActions(): Promise<McpActionSummary[]>;
  /**
   * Invoke an action by its declarative name. Resolves the action (optionally
   * scoped by `objectName` to disambiguate), enforces its `requiredPermissions`
   * as the caller, loads the subject record under RLS when row-context, then
   * dispatches through the framework action runner. Throws on
   * denial / not-found / handler failure so the tool surfaces a tool-error.
   */
  runAction(
    name: string,
    input: { objectName?: string; recordId?: string; params?: Record<string, unknown> } & AIActionConfirmation,
  ): Promise<unknown>;
}

export interface RegisterActionToolsOptions {
  /** Expose actions on `sys_*` system objects too. Default false (fail-closed). */
  allowSystemObjects?: boolean;
  /**
   * OAuth 2.1 scopes granted to the caller's access token (#2698) — same
   * contract as {@link RegisterObjectToolsOptions.grantedScopes}. The action
   * tools require `actions:execute`; undefined = not scope-limited.
   */
  grantedScopes?: readonly string[];
}

const DEFAULT_MAX_LIMIT = 50;

/** A `sys_`-prefixed object is a system table — off-limits to external agents. */
function isSystemObject(name: string): boolean {
  return /^sys_/i.test(name);
}

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: jsonText(value) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

/**
 * A tool error that PRESERVES an ADR-0112 envelope when the thrown value
 * carries one.
 *
 * [#15942] `errorResult` above flattens a throw to its message, which is right
 * for the plain `Error`s most bridge failures are. It is wrong for a refusal
 * whose whole point is machine-readability: the confirmation gate answers
 * `ACTION_CONFIRMATION_REQUIRED` with `details` naming the action and the exact
 * member to set, precisely so a refused agent can rebuild the retry WITHOUT
 * re-parsing prose. Flattened to a sentence, that contract is delivered to
 * nobody and the agent is back to guessing the member's spelling from
 * documentation.
 *
 * Uncoded throws fall through to `errorResult` unchanged, so this widens what a
 * caller can read and narrows nothing.
 */
function errorResultFromThrown(err: unknown) {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== 'string' || code.length === 0) return errorResult(messageOf(err));
  const details = (err as { details?: unknown }).details;
  const status = (err as { status?: unknown }).status;
  return {
    content: [
      {
        type: 'text' as const,
        text: jsonText({
          error: {
            code,
            message: messageOf(err),
            ...(typeof status === 'number' ? { status } : {}),
            ...(details !== undefined ? { details } : {}),
          },
        }),
      },
    ],
    isError: true as const,
  };
}

/**
 * [ADR-0090 D10 — ruling 2026-09-08, consequence 2] Attach the D10 narrowing
 * notice to a query result WITHOUT reshaping it.
 *
 * The bridge's `query` is typed `Promise<unknown>`, and the shape that ships is
 * the protocol's `{ object, records, total }` — so the object case adds two
 * keys beside the existing ones, mirroring `list_objects`' `partial` / `warning`
 * pair so a client branches on the same vocabulary on both tools. Anything that
 * is NOT a plain object (a bare array from some future bridge) keeps its own
 * shape and carries the notice alongside: inventing a `records` wrapper there
 * would break a caller to deliver a warning about breaking callers.
 */
function withDelegationNotice(value: unknown, statement: string): unknown {
  const notice = { delegationNarrowed: true as const, warning: statement };
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>), ...notice };
  }
  return { result: value, ...notice };
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Authoring site → the `(role, scope)` the shared validator uses. A `formula`
 * field is a `value` expression bound to the `record` namespace; a `validation`
 * rule is a `record`-scoped `predicate`; a `flow_condition` is a `predicate`
 * whose fields are flattened to top level; a `template` is a text template.
 * Exposing a single friendly `site` keeps the tool aligned with how an author
 * thinks about *where* the expression goes.
 */
const VALIDATE_SITE_MAP: Record<string, { role: FieldRole; scope: 'record' | 'flattened' }> = {
  formula: { role: 'value', scope: 'record' },
  validation: { role: 'predicate', scope: 'record' },
  flow_condition: { role: 'predicate', scope: 'flattened' },
  template: { role: 'template', scope: 'record' },
};

// ── Tool arguments: an undeclared key is REFUSED, not stripped (#16913) ──────

/**
 * The one sentence every tool's refusal ends with — why the key the caller
 * just sent used to disappear without a word.
 *
 * Kept identical across the eleven tools on purpose. Triage's reading of this
 * card was that one tool holding two postures is evidence there was never a
 * rule; the answer to that is one posture, stated in one sentence, on every
 * door — not eleven bespoke ones.
 */
// ⛔ No tracker id in this string. It is RUNTIME prose — it reaches an MCP
// client, an agent transcript and any log that captures a tool error, and none
// of those readers can resolve `#NNNN` (`pnpm check:doc-authoring`). The anchor
// belongs in a comment, where the reader who can resolve it is already looking:
// the card is #16913, and the campaign it extends is #4001.
const UNKNOWN_ARG_HISTORY =
  'This argument used to be dropped silently and the call still succeeded, so a mis-guessed '
  + 'parameter name answered a differently filtered or differently ordered set with no way for '
  + 'the caller to tell.';

/**
 * Close an MCP tool's argument shape against keys it does not declare.
 *
 * ## Why the shape has to become a real schema
 *
 * `McpServer.registerTool` takes `inputSchema` as `ZodRawShapeCompat |
 * AnySchema` (measured against `@modelcontextprotocol/sdk` 1.30.0 — the same
 * reading `toolInputSchema()` in `mcp-server-runtime.ts` already records). Hand
 * it a RAW SHAPE, as every tool here did until #16913, and the SDK wraps it with
 * `objectFromShape()`, whose zod default is `.strip`: `validateToolInput()`
 * parses the arguments against that wrap and the handler is invoked with a
 * payload the undeclared keys have already been deleted from. The handler
 * cannot report what it never received — this is not a handler bug, and no
 * amount of care inside one can fix it. `run_action`'s confirmation member
 * carries the same finding from the other side ("Under zod an undeclared key is
 * DROPPED, not rejected"), and had to be *declared* for exactly this reason.
 *
 * Handing `registerTool` a built `.strict()` object instead moves the decision
 * one frame up, to the only place that can still see the key: the SDK refuses
 * before dispatch, the bridge is never called, and the client receives a tool
 * error. Two consequences worth naming because they are the deliverable:
 *
 *  - the refusal arrives as a TOOL ERROR (`isError: true`, text content), not
 *    as an exception across the wire — the SDK's `CallTool` handler converts
 *    its own `McpError` through `createToolError()`, so this file's standing
 *    promise ("errors are returned as tool errors, never thrown across the
 *    wire") survives intact;
 *  - `tools/list` renders the closed shape as `additionalProperties: false`,
 *    so an agent reads the narrowing off the schema rather than discovering it
 *    by being refused. Triage asked for the narrowing to be DECLARED; that is
 *    where it is declared.
 *
 * ## Why refusing, and not tolerating
 *
 * The consumer of these tools is an AI agent, and a silently dropped argument
 * produces a plausible, confident, wrong answer: a dropped `orderBy` answers a
 * differently ORDERED set ("the top 3 by amount" that is really the first 3 in
 * seed order), a dropped `where` a WIDER one (all 16 rows reported as the
 * filtered ones). Both were reported from real spikes against 17.3.0. Nothing
 * in either payload — status, header or field — distinguishes them from a real
 * answer, which is the asymmetry #4001 named: **静默失效比硬报错更坏,因为它制造
 * 虚假的完成**.
 *
 * ⛔ The direction is refusal only. Adding `sort` or `filters` as accepted
 * aliases would be the loosening triage explicitly ruled out — these keys are
 * *named in the message* so the caller can fix the call, and are never parsed.
 *
 * ## Why the message, and not just `.strict()`
 *
 * #4001: 「**strict 必须配可修的错误信息,不能只是「大声」。** 光报
 * "unrecognized key" 只是把静默失效换成了困惑」. Bare zod answers
 * `Unrecognized key: "sort"`, which tells an agent it was wrong and not what to
 * write. {@link strictUnknownKeyError} adds both channels the campaign
 * standardised: an explicit alias table for semantic near-misses, then a
 * length-relative edit-distance fallback for slips. `sort → orderBy` and
 * `filters → where` are alias-table entries, not typos — they are the spellings
 * a caller who knows other query APIs reaches for, the same species as #3746's
 * `visibleWhen → visible`.
 *
 * `knownKeys` is read from `shape` rather than transcribed beside it, which is
 * what `packages/spec`'s own `strictObject()` does and for the same reason: a
 * hand-written key array is a second copy of the truth that can drift from the
 * shape it describes. That helper is internal to `packages/spec` (not exported
 * from `@objectstack/spec`), so this is the same two lines over the published
 * factory rather than a second implementation of it.
 */
function strictToolInput<T extends z.ZodRawShape>(
  options: { surface: string; aliases?: Readonly<Record<string, string>> },
  shape: T,
) {
  return z
    .object(shape, {
      error: strictUnknownKeyError({
        surface: options.surface,
        knownKeys: Object.keys(shape),
        aliases: options.aliases,
        history: UNKNOWN_ARG_HISTORY,
      }),
    })
    .strict();
}

/**
 * The spellings every object-scoped tool shares, split out because they are the
 * same guess wherever an object name is taken.
 */
const OBJECT_NAME_ALIASES = { object: 'objectName', table: 'objectName' } as const;

/** The spellings every record-scoped tool shares. */
const RECORD_ID_ALIASES = { id: 'recordId', record_id: 'recordId' } as const;

/**
 * Wire the FULL tool surface a bridge can serve onto one {@link McpServer} —
 * the single composition both transports call (#8034).
 *
 * Object CRUD always; the business-action pair only when the bridge implements
 * `listActions` + `runAction` (graceful degradation — a host with no action
 * mechanism keeps serving object tools unchanged). Whoever owns the server
 * decides nothing else: the tool set is a function of the BRIDGE, so the same
 * bridge yields the same tools on stdio and over HTTP, which is the property
 * `transport-parity` pins.
 *
 * @returns the names actually registered, so a host can report its surface
 *   honestly instead of asserting a count that can drift from the code above.
 */
export function wireBridgeTools(
  server: McpServer,
  bridge: McpDataBridge & Partial<McpActionBridge>,
  options: RegisterObjectToolsOptions & RegisterActionToolsOptions = {},
): string[] {
  const registered = registerObjectTools(server, bridge, options);
  if (typeof bridge.listActions === 'function' && typeof bridge.runAction === 'function') {
    registered.push(...registerActionTools(server, bridge as McpActionBridge, options));
  }
  return registered;
}

/**
 * Register the object-CRUD tool set on an {@link McpServer} — the throwaway
 * per-request one on HTTP, the long-lived one behind stdio. All execution is
 * delegated to `bridge`, which the host binds to the caller's principal.
 *
 * @returns the names registered on this call (the set varies with
 *   `grantedScopes` and with whether the bridge implements `aggregate`).
 */
export function registerObjectTools(
  server: McpServer,
  bridge: McpDataBridge,
  options: RegisterObjectToolsOptions = {},
): string[] {
  // Recorded AT the registration site (`note('…')` below) rather than as a
  // second list here: a literal list would be a parallel spelling of the same
  // fact, and the first tool added without updating it would make every
  // caller's report of this surface wrong while every test stayed green.
  const registered: string[] = [];
  const note = (name: string): string => {
    registered.push(name);
    return name;
  };
  const allowSystem = options.allowSystemObjects === true;
  const maxLimit = options.maxQueryLimit ?? DEFAULT_MAX_LIMIT;
  // OAuth tool-family gating (#2698). undefined = not scope-limited.
  // A tool outside the grant is NOT registered at all — the SDK then
  // rejects it as unknown, which doubles as dispatch-time enforcement.
  const scopes = options.grantedScopes;
  const canRead = !scopes || scopes.includes(MCP_OAUTH_SCOPE_DATA_READ);
  const canWrite = !scopes || scopes.includes(MCP_OAUTH_SCOPE_DATA_WRITE);

  /** Fail-closed object-name guard shared by every object-scoped tool. */
  const guard = (objectName: string): string | undefined => {
    if (!objectName || typeof objectName !== 'string') return 'objectName is required';
    if (!allowSystem && isSystemObject(objectName)) {
      return `Object "${objectName}" is a system object and is not exposed via MCP`;
    }
    return undefined;
  };

  if (canRead) {
    server.registerTool(
      note('list_objects'),
      {
        description:
          'List the data objects (tables) available in this app. Returns each object\'s name, label and field count.',
        inputSchema: strictToolInput({ surface: 'this list_objects call' }, {}),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      // [#6504] This tool MIS-DESCRIBES during a metadata loader outage, which
      // is why it changes while most consumers in that sweep correctly do not:
      // it publishes `totalCount`, and a count is the strongest positive claim
      // a read can make. The fix withholds the CLAIM, not the data — the same
      // treatment, in the same words, the `objectstack://objects` resource got
      // in PR #7721.
      //
      //  - healthy   → `{ objects, totalCount }`, byte-identical to before. A
      //                count from a complete read is a fact this tool was
      //                always right to state.
      //  - degraded  → the same `objects` (the reachable set is still the most
      //                useful true thing here), `totalCount` ABSENT, and in its
      //                place `partial` / `returnedCount` / `warning` plus the
      //                503 envelope so a client can branch structurally.
      //
      // Dropping the key rather than reporting a smaller number is the point: a
      // client reading `totalCount` gets `undefined` — which fails, or renders
      // as nothing — where a plausible-looking integer would have been believed.
      //
      // `returnedCount` counts what this tool actually SERVES, i.e. after the
      // system-object filter, not what the bridge handed over. The two differ
      // whenever `allowSystemObjects` is false, and naming the pre-filter number
      // here would restate the same over-claim one field along.
      async () => {
        try {
          const diagnosed = bridge.listObjectsDiagnosed
            ? await bridge.listObjectsDiagnosed()
            : { objects: await bridge.listObjects(), degraded: false, errors: [] };
          const visible = allowSystem
            ? diagnosed.objects
            : diagnosed.objects.filter((o) => !isSystemObject(o.name));
          if (!diagnosed.degraded) {
            return textResult({ objects: visible, totalCount: visible.length });
          }
          return textResult({
            objects: visible,
            partial: true,
            returnedCount: visible.length,
            warning: metadataPartialListingSentence('objects', visible.length),
            code: METADATA_UNAVAILABLE_CODE,
            status: 503,
          });
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );

    server.registerTool(
      note('describe_object'),
      {
        description:
          'Get the schema of a data object: its fields (name, type, label, required) and enabled features.',
        inputSchema: strictToolInput(
          { surface: 'this describe_object call', aliases: { ...OBJECT_NAME_ALIASES, name: 'objectName' } },
          { objectName: z.string().describe('The object/table name, e.g. "task"') },
        ),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          const def = await bridge.describeObject(objectName);
          if (!def) return errorResult(`Object "${objectName}" not found`);
          return textResult(def);
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );

    // Validate a CEL expression against a real object schema BEFORE it is
    // authored into metadata — the same checks `objectstack build` runs, so an
    // agent gets a build-accurate verdict plus the fields/functions in scope to
    // self-correct, instead of shipping a formula that silently evaluates to
    // `null` (#1928). Read-only (schema introspection); no data is touched.
    server.registerTool(
      note('validate_expression'),
      {
        description:
          'Validate a CEL expression against an object\'s schema before authoring it into metadata. Returns ' +
          'build-time errors (bare field refs, unknown fields, unknown functions) and advisory warnings ' +
          '(text/boolean fields misused in arithmetic, date-equality pitfalls), plus the fields and stdlib ' +
          'functions in scope so you can self-correct. `site` says where the expression will live: a `formula` ' +
          'field, a `validation`/predicate, or a `flow_condition` (fields are bound bare in flow conditions).',
        inputSchema: strictToolInput(
          {
            surface: 'this validate_expression call',
            aliases: {
              ...OBJECT_NAME_ALIASES,
              formula: 'expression',
              expr: 'expression',
              cel: 'expression',
              context: 'site',
            },
          },
          {
            objectName: z.string().describe('The object/table the expression is authored against, e.g. "task"'),
            expression: z.string().describe('The CEL expression to validate, e.g. "record.amount / 100"'),
            site: z
              .enum(['formula', 'validation', 'flow_condition', 'template'])
              .optional()
              .describe(
                'Where the expression will live. formula/validation bind `record.<field>`; flow_condition binds fields bare. Default: formula.',
              ),
          },
        ),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, expression, site }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          const def = (await bridge.describeObject(objectName)) as { fields?: unknown } | null;
          if (!def) return errorResult(`Object "${objectName}" not found`);
          const fieldDefs = Array.isArray(def.fields) ? (def.fields as Array<Record<string, unknown>>) : [];
          const fields: string[] = [];
          const fieldTypes: Record<string, string> = {};
          for (const f of fieldDefs) {
            if (typeof f?.name !== 'string') continue;
            fields.push(f.name);
            if (typeof f?.type === 'string') fieldTypes[f.name] = f.type;
          }
          const { role, scope } = VALIDATE_SITE_MAP[site ?? 'formula'];
          const hint = { objectName, fields, fieldTypes, scope } as const;
          const result = validateExpression(role, expression, hint);
          const inScope = introspectScope(role, hint);
          const inferredType = role === 'value' ? inferExpressionType(expression, hint) : undefined;
          return textResult({
            ok: result.ok,
            errors: result.errors,
            warnings: result.warnings,
            ...(inferredType ? { inferredType } : {}),
            inScope: {
              dialect: inScope.dialect,
              roots: inScope.roots,
              fields: inScope.fields,
              functions: inScope.functions,
            },
          });
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );

    server.registerTool(
      note('query_records'),
      {
        description:
          'Query records from an object with optional filter, field selection, sorting and pagination. ' +
          'Runs under the caller\'s permissions and row-level security.',
        inputSchema: strictToolInput(
          {
            surface: 'this query_records call',
            // The three spellings both #16913 repro reports actually sent, plus
            // the neighbours of each. None is a typo: they are what a caller who
            // knows another query API reaches for, which is why edit distance
            // cannot find them and an explicit table must.
            aliases: {
              ...OBJECT_NAME_ALIASES,
              sort: 'orderBy',
              sortBy: 'orderBy',
              order: 'orderBy',
              order_by: 'orderBy',
              filters: 'where',
              filter: 'where',
              conditions: 'where',
              criteria: 'where',
              select: 'fields',
              columns: 'fields',
              projection: 'fields',
              pageSize: 'limit',
              top: 'limit',
              take: 'limit',
              skip: 'offset',
              start: 'offset',
            },
          },
          {
            objectName: z.string().describe('The object/table name'),
            where: z
              .record(z.string(), z.unknown())
              .optional()
              .describe('Filter conditions, e.g. {"status":"open"}'),
            fields: z.array(z.string()).optional().describe('Field names to return (defaults to all)'),
            limit: z.number().int().positive().max(maxLimit).optional().describe(`Max rows (≤ ${maxLimit})`),
            offset: z.number().int().nonnegative().optional().describe('Rows to skip'),
            orderBy: z
              .array(z.object({ field: z.string(), order: z.enum(['asc', 'desc']) }))
              .optional()
              .describe('Sort order'),
          },
        ),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, where, fields, limit, offset, orderBy }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          const result = await bridge.query(objectName, {
            where,
            fields,
            limit: Math.min(limit ?? maxLimit, maxLimit),
            offset,
            orderBy,
          });
          // [ADR-0090 D10 — ruling 2026-09-08, consequence 2] A delegated read
          // the agent ceiling NARROWED is served with the narrowing stated. The
          // rows are still served — a partial answer is the most useful true
          // thing here, exactly as in `list_objects` above; what is withheld is
          // the implicit claim that this count describes the object.
          //
          // ⛔ The probe may never fail the query it annotates: it is caught
          // into "no statement", which is byte-for-byte the pre-#16549 render.
          const diagnosed = typeof bridge.diagnoseDelegation === 'function'
            ? await bridge.diagnoseDelegation(objectName).catch(() => undefined)
            : undefined;
          if (!diagnosed?.narrowed || !diagnosed.statement) return textResult(result);
          return textResult(withDelegationNotice(result, diagnosed.statement));
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );

    if (typeof bridge.aggregate === 'function') {
      const aggregateFn = bridge.aggregate.bind(bridge);
      server.registerTool(
        note('aggregate_records'),
        {
          description:
            'Aggregate records with GROUP BY: count/sum/avg/min/max/count_distinct over an object, ' +
            'optionally grouped by fields (dates can be bucketed by day/week/month/quarter/year). ' +
            'Use this instead of paging query_records when a question needs totals or breakdowns. ' +
            'Runs under the caller\'s permissions, row-level security and field-level security.',
          inputSchema: strictToolInput(
            {
              surface: 'this aggregate_records call',
              aliases: {
                ...OBJECT_NAME_ALIASES,
                filters: 'where',
                filter: 'where',
                conditions: 'where',
                group_by: 'groupBy',
                metrics: 'aggregations',
                aggregates: 'aggregations',
                aggs: 'aggregations',
                tz: 'timezone',
                timeZone: 'timezone',
              },
            },
            {
            objectName: z.string().describe('The object/table name'),
            aggregations: z
              .array(
                z.object({
                  function: z
                    .enum(['count', 'sum', 'avg', 'min', 'max', 'count_distinct'])
                    .describe('Aggregation function'),
                  field: z.string().optional().describe('Field to aggregate (omit for count(*))'),
                  alias: z.string().describe('Result column name'),
                }),
              )
              .min(1)
              .describe('Metrics to compute, e.g. [{"function":"sum","field":"amount","alias":"total"}]'),
            groupBy: z
              .array(
                z.union([
                  z.string(),
                  z.object({
                    field: z.string().describe('Field to group by'),
                    dateGranularity: z
                      .enum(['day', 'week', 'month', 'quarter', 'year'])
                      .optional()
                      .describe('Bucket a date field into uniform periods'),
                    alias: z.string().optional().describe('Alias for the projected group value'),
                  }),
                ]),
              )
              .optional()
              .describe('Grouping fields; omit for a single overall row'),
            where: z
              .record(z.string(), z.unknown())
              .optional()
              .describe('Filter conditions applied before aggregation, e.g. {"status":"open"}'),
            timezone: z
              .string()
              .optional()
              .describe('IANA timezone for date bucketing (defaults to UTC)'),
            },
          ),
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        },
        async ({ objectName, aggregations, groupBy, where, timezone }) => {
          const bad = guard(objectName);
          if (bad) return errorResult(bad);
          try {
            const rows = (await aggregateFn(objectName, {
              where,
              groupBy,
              aggregations,
              timezone,
            })) ?? [];
            // Group count is unbounded (a high-cardinality groupBy can return
            // thousands of rows) — cap the tool output like query_records does.
            const truncated = rows.length > maxLimit;
            return textResult({
              rows: truncated ? rows.slice(0, maxLimit) : rows,
              totalGroups: rows.length,
              ...(truncated ? { truncated: true } : {}),
            });
          } catch (err) {
            return errorResult(messageOf(err));
          }
        },
      );
    }

    server.registerTool(
      note('get_record'),
      {
        description: 'Fetch a single record by id.',
        inputSchema: strictToolInput(
          { surface: 'this get_record call', aliases: { ...OBJECT_NAME_ALIASES, ...RECORD_ID_ALIASES } },
          {
            objectName: z.string().describe('The object/table name'),
            recordId: z.string().describe('The record id'),
          },
        ),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, recordId }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          const record = await bridge.get(objectName, recordId);
          if (record == null) return errorResult(`Record "${recordId}" not found in "${objectName}"`);
          return textResult(record);
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );
  } // end canRead (data:read)

  if (canWrite) {
    server.registerTool(
      note('create_record'),
      {
        description: 'Create a new record. Runs under the caller\'s permissions and validations.',
        inputSchema: strictToolInput(
          {
            surface: 'this create_record call',
            aliases: { ...OBJECT_NAME_ALIASES, record: 'data', values: 'data', fields: 'data' },
          },
          {
            objectName: z.string().describe('The object/table name'),
            data: z.record(z.string(), z.unknown()).describe('Field values for the new record'),
          },
        ),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, data }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          return textResult(await bridge.create(objectName, data));
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );

    server.registerTool(
      note('update_record'),
      {
        description: 'Update fields on an existing record by id.',
        inputSchema: strictToolInput(
          {
            surface: 'this update_record call',
            aliases: {
              ...OBJECT_NAME_ALIASES,
              ...RECORD_ID_ALIASES,
              record: 'data',
              values: 'data',
              fields: 'data',
            },
          },
          {
            objectName: z.string().describe('The object/table name'),
            recordId: z.string().describe('The record id'),
            data: z.record(z.string(), z.unknown()).describe('Field values to change'),
          },
        ),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, recordId, data }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          return textResult(await bridge.update(objectName, recordId, data));
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );

    server.registerTool(
      note('delete_record'),
      {
        description: 'Delete a record by id. This is destructive.',
        inputSchema: strictToolInput(
          { surface: 'this delete_record call', aliases: { ...OBJECT_NAME_ALIASES, ...RECORD_ID_ALIASES } },
          {
            objectName: z.string().describe('The object/table name'),
            recordId: z.string().describe('The record id'),
          },
        ),
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async ({ objectName, recordId }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        try {
          return textResult(await bridge.remove(objectName, recordId));
        } catch (err) {
          return errorResult(messageOf(err));
        }
      },
    );
  } // end canWrite (data:write)

  return registered;
}

/**
 * Register the business-action tool set (`list_actions`, `run_action`) on an
 * {@link McpServer}. This is the action analogue of
 * {@link registerObjectTools}: it owns the tool *shape* and delegates all
 * resolution + dispatch + security to `bridge`, which the runtime binds to the
 * caller's principal.
 *
 * Symmetry with the object tools is deliberate — like `list_objects`/CRUD, the
 * action surface exposes the *mechanism* and delegates enforcement to the
 * bridge, with `sys_*`-scoped actions held back fail-closed by default.
 *
 * SECURITY (#2849): unlike object CRUD — where every call is RLS/FLS-bounded —
 * an action's body executes as TRUSTED app code once invoked. The bridge
 * therefore gates at invoke time: `ai.exposed` (the author's explicit AI
 * opt-in, ADR-0011) + the ADR-0066 D4 capability gate. The earlier design
 * ("no separate AI opt-in flag; rely on permission + RLS enforcement") was
 * revised, because there is no data-layer backstop inside an action body.
 */
export function registerActionTools(
  server: McpServer,
  bridge: McpActionBridge,
  options: RegisterActionToolsOptions = {},
): string[] {
  const registered: string[] = [];
  const note = (name: string): string => {
    registered.push(name);
    return name;
  };
  const allowSystem = options.allowSystemObjects === true;
  // OAuth tool-family gating (#2698): the whole action surface requires
  // `actions:execute`. Not registered = unknown tool = fail-closed.
  if (options.grantedScopes && !options.grantedScopes.includes(MCP_OAUTH_SCOPE_ACTIONS)) {
    return registered;
  }

  server.registerTool(
    note('list_actions'),
    {
      description:
        'List the business actions you can invoke in this app (e.g. "complete task", "convert lead"). ' +
        'Returns each action\'s name, the object it operates on, a description, whether it needs a record id, ' +
        'whether it is destructive, and its input parameters. Only actions the app author has exposed to AI ' +
        'and that the caller is permitted to run are returned. Use run_action to invoke one.',
      inputSchema: strictToolInput({ surface: 'this list_actions call' }, {}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      try {
        const actions = await bridge.listActions();
        const visible = allowSystem
          ? actions
          : actions.filter((a) => !a.objectName || !isSystemObject(a.objectName));
        return textResult({ actions: visible, totalCount: visible.length });
      } catch (err) {
        return errorResult(messageOf(err));
      }
    },
  );

  server.registerTool(
    note('run_action'),
    {
      description:
        'Invoke a business action by name (see list_actions). Runs the app\'s registered business logic — ' +
        'this can mutate data or trigger flows. Invocation is gated (author AI opt-in + your capabilities), ' +
        'but the action body itself runs as trusted application code with the app\'s full data authority. ' +
        'Supply recordId for actions that operate on a specific record, and params for any declared inputs. ' +
        'An action the author gated (list_actions reports requiresConfirmation) is REFUSED unless you also ' +
        'send confirm: true — ask the human first, then retry; nothing runs on a refused call.',
      inputSchema: strictToolInput(
        {
          surface: 'this run_action call',
          aliases: {
            ...OBJECT_NAME_ALIASES,
            ...RECORD_ID_ALIASES,
            action: 'actionName',
            name: 'actionName',
            action_name: 'actionName',
            args: 'params',
            input: 'params',
            arguments: 'params',
            parameters: 'params',
          },
        },
        {
        actionName: z.string().describe('The action name from list_actions, e.g. "complete_task"'),
        objectName: z
          .string()
          .optional()
          .describe('The object the action belongs to. Optional; required only to disambiguate a name shared by multiple objects.'),
        recordId: z
          .string()
          .optional()
          .describe('The id of the record to act on (for record-scoped actions).'),
        params: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Input parameters declared by the action.'),
        // [#15942 / #16293] The confirmation member — a CLOSED boolean at the
        // TOP LEVEL of the request, keyed off the contract's own constant so
        // this door cannot spell it differently from the door that refuses.
        //
        // WHY IT IS DECLARED HERE AND NOT ONLY ENFORCED IN THE RUNTIME. Under
        // zod an undeclared key is DROPPED, not rejected: before this member
        // existed a client that sent `confirm: true` had it silently stripped
        // by the SDK's shape wrap and then again by this handler's forward, so
        // enforcing the gate alone would have made every action declaring
        // `ai.requiresConfirmation: true` permanently un-invokable over MCP —
        // refused, retried with the member, stripped, refused again. The door
        // grows the member in the same change that enforces it.
        //
        // It is also how the model DISCOVERS the retry: an agent reads the tool
        // schema, so a member that lives only in the refusal prose (or in a
        // transport header) is one it cannot see.
        [AI_ACTION_CONFIRMATION_MEMBER]: z
          .boolean()
          .optional()
          .describe(
            'Set to true to confirm a call the app author gated with ai.requiresConfirmation '
            + '(list_actions reports requiresConfirmation for each action). Assert this only when '
            + 'the human in the loop has approved THIS call; without it a gated action is refused '
            + 'and nothing runs.',
          ),
        },
      ),
      // Actions execute app-defined business logic with side effects (writes,
      // flows, outbound calls), so we mark the tool destructive + open-world:
      // MCP clients should confirm before invoking. Per-action destructiveness
      // is further surfaced via `requiresConfirmation` in list_actions.
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) => {
      const { actionName, objectName, recordId, params } = args;
      // Read off the constant, so the member's spelling has exactly one
      // authority in this package (the schema key above is the same constant).
      const confirm = args[AI_ACTION_CONFIRMATION_MEMBER];
      if (!actionName || typeof actionName !== 'string') {
        return errorResult('actionName is required');
      }
      if (objectName && !allowSystem && isSystemObject(objectName)) {
        return errorResult(`Object "${objectName}" is a system object and its actions are not exposed via MCP`);
      }
      try {
        const result = await bridge.runAction(actionName, {
          objectName,
          recordId,
          params,
          // [#15942] Forwarded, not rebuilt-without. This line and the schema
          // key above are the two halves of one change: dropping either one
          // restores the strip that made the gate unsatisfiable.
          [AI_ACTION_CONFIRMATION_MEMBER]: confirm,
        });
        return textResult(result);
      } catch (err) {
        return errorResultFromThrown(err);
      }
    },
  );

  return registered;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as any).message);
  return String(err);
}
