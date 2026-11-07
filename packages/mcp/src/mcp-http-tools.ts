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
 *    every tool that takes an object name, independent of the bridge. The
 *    action tools yield PER ACTION: a `sys_*` action whose author declared
 *    `ai.exposed: true` (the bridge attests it as `aiExposed`) is listed and
 *    run like any other exposed action (#27681, ADR-0011) — no other key and
 *    no deployment switch opens one.
 *  - The bridge is bound to the caller's principal; tools cannot widen it.
 *  - Errors are returned as tool errors (text), never thrown across the wire,
 *    and never include secrets.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
// [#28550, #28609] The engine's aggregation entry. Each `aggregate_records`
// entry IS this node, so this door and the REST query door (which parses
// `FindDataRequestSchema`, whose `aggregations` are this node) judge one shape
// with one refusal.
import { AggregationNodeSchema } from '@objectstack/spec/data';
// [#23529] The catalogue's spelling of `PERMISSION_DENIED`, the code whose
// `details` `errorResultFromThrown` withholds. Imported, never hand-spelled.
import { StandardErrorCode, type ErrorCode } from '@objectstack/spec/api';
// [#23701] The one key every door that translates the engine's unique-violation
// envelope asks (the registered code AND the class name, never message text),
// and the one classification whose arm states the wire code for it.
import { earnedAnswerOf, isEngineDuplicateRecordEnvelope, isServerFault, logServerFault, mapDataError, resolveQueryReadLimits, sandboxBusinessMessage, staleSummaryAnswerLines, structuredCodeAnswer, type SummaryRecomputeRefusal } from '@objectstack/types';
import {
  MCP_OAUTH_SCOPE_DATA_READ,
  MCP_OAUTH_SCOPE_DATA_WRITE,
  MCP_OAUTH_SCOPE_ACTIONS,
  MCP_OAUTH_SCOPE_METADATA_WRITE,
} from '@objectstack/spec/ai';
// [#15942 / #16293] The confirmation member the `run_action` door accepts and
// forwards. Imported, never hand-spelled: the door that refuses (the runtime's
// `actionConfirmationRefusal`) and the client that retries have to agree on the
// spelling, and this door is the one that has to advertise it.
import {
  AI_ACTION_CONFIRMATION_MEMBER,
  type AIActionConfirmation,
  type ActionConfirmationRequiredDetails,
  type ImportObjectResult,
  type RemoteTable,
} from '@objectstack/spec/contracts';
import {
  validateExpression,
  introspectScope,
  inferExpressionType,
  type ExprFaultOutcome,
  type FieldRole,
} from '@objectstack/formula';
// [#16913] The unknown-key error map every `strictToolInput` shape below is
// built with. Imported, never re-implemented: #4001 is this repo's ruling on
// silent key stripping and its explicit instruction is that the parts already
// exist ("这件事需要的零件**已经全在仓库里**"). This is the published factory
// the `packages/spec` campaign standardised on — already carried in
// `api-surface/shared.json`, so reusing it adds nothing to any public surface.
import { strictUnknownKeyError } from '@objectstack/spec/shared';
// [#27411] The input schemas the save/build gate parses an expression slot
// with. `validate_expression` parses with the SAME schema before it runs the
// formula checks, so a blank source gets the gate's verdict and its published
// sentence, never a second blank rule written here.
import { EvaluatedExpressionInputSchema, TemplateExpressionInputSchema } from '@objectstack/spec/shared';
import { FLOW_TRIGGER_KINDS, type FlowTriggerKind } from '@objectstack/spec/automation';
import {
  METADATA_UNAVAILABLE_CODE,
  metadataPartialListingSentence,
  type DiagnosedObjectListing,
} from './metadata-completeness.js';
// [#30892] The file seam and what `read_file` renders from it.
import { READ_FILE_MAX_BYTES, renderReadFile, type McpFileBridge } from './file-content.js';

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
  /**
   * [#28715] The fields of `name` that declare options — the fields a
   * formula's `label(record.<field>)` can answer on — or `null` when no such
   * object is served. Read from the same object {@link describeObject} reads,
   * through `@objectstack/formula`'s `declaresOptions`, the predicate the
   * engine builds `label()`'s map with: both bridges read the protocol's
   * served object, where a field bound to a shared `picklist` already carries
   * the list's resolved `options`.
   *
   * `validate_expression` hands it to the shared validator as
   * `ExprSchemaHint.optionFields`, so the tool refuses the `label()` call the
   * object save door refuses, in the same words. It is a member of its own,
   * not a key on {@link describeObject}'s answer, so `describe_object` serves
   * what it served before.
   *
   * OPTIONAL, like {@link listObjectsDiagnosed}: a bridge that omits it gets
   * no `label()` target check, exactly as before (the validator's opt-in).
   */
  optionFieldsOf?(name: string): Promise<readonly string[] | null>;
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
  /**
   * True when the action's author opted it into the AI surface
   * (`ai: { exposed: true, description }`, ADR-0011), as the bridge read it off
   * the declaration. With `allowSystemObjects` off, an action on a `sys_*`
   * object is listed and run ONLY when this is `true` (#27681): the tool layer
   * never sees the declaration, so a bridge that does not attest it keeps
   * every system-object action hidden and refused, exactly as before.
   */
  aiExposed?: boolean;
  /** Declared input parameters. */
  params?: McpActionParamSummary[];
  /**
   * Present when `run_action` would refuse this action for THIS caller's
   * credential before running it: an `api` action whose target endpoint does
   * not accept the credential the caller connected with (an OAuth access token
   * is honoured on the MCP endpoint only, so an endpoint outside it cannot read
   * it). The action is still listed, so an agent can tell its user why it
   * cannot run it; `code` is the standard error code `run_action` answers with
   * (`UNAUTHENTICATED`), `reason` the sentence it carries, including what would
   * let the action run. Absent when the action can be run.
   */
  unavailable?: McpActionUnavailable;
}

/** Why `run_action` would refuse a listed action for this caller ({@link McpActionSummary.unavailable}). */
export interface McpActionUnavailable {
  /** The standard error code `run_action` answers with. */
  code: string;
  /** The refusal sentence `run_action` carries: why, and what would let the action run. */
  reason: string;
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
  /**
   * [#30771] The capability refusal `runAction` would throw for an action on
   * `objectName` that {@link listActions} leaves out because the caller lacks
   * its declared `requiredPermissions` — `{ code, status, message }`, the same
   * values the by-name call throws. `undefined` for anything else (not
   * declared, not exposed to AI), so `run_action`'s scoped `sys_*` pre-screen
   * keeps its system-object refusal there. Runs nothing.
   *
   * OPTIONAL: a bridge without it keeps the system-object refusal for every
   * `sys_*` action its listing leaves out, as before.
   */
  capabilityRefusal?(name: string, objectName: string): Promise<ThrownRefusalEnvelope | undefined>;
  /**
   * [#15705] Continue a run that `runAction` answered with `status: 'paused'`
   * and a `screen`, submitting that screen's field values as `values`.
   *
   * The host admits the call only where `runAction` would admit starting the
   * same flow on the same record for this caller. That means the run was
   * started by this caller, an AI-exposed flow action the caller may run
   * targets the run's flow, the subject record is still readable by the
   * caller, and the run is parked on a screen. Resolves to `runAction`'s
   * envelope (`{ ok, action, objectName, recordId?, result }`). A run that
   * pauses on its next screen comes back paused again. Throws on refusal, with
   * the ADR-0112 `code` / `status` on the thrown value.
   *
   * OPTIONAL, like {@link McpDataBridge.aggregate}. A host that cannot resume
   * runs omits it, and `resume_run` is then not registered.
   */
  resumeRun?(
    runId: string,
    input: { values?: Record<string, unknown> } & AIActionConfirmation,
  ): Promise<unknown>;
}

/**
 * [#27745] The federation seam: list a federated datasource's remote tables
 * (an OData datasource's entity sets) and import one as a live federated
 * object — the same `IExternalDatasourceService` calls Studio's datasource
 * page makes (`GET …/external/tables`, `POST …/tables/:remote/import`).
 *
 * The host binds both to the caller and refuses as the REST routes refuse:
 * listing needs the federation READ capability, importing the READ capability
 * AND the WRITE one — the import answers with the remote table's structure,
 * which needs the read capability on every door
 * (`FEDERATION_READ_CAPABILITY` / `FEDERATION_WRITE_CAPABILITY`, judged by
 * `federationCapabilityRefusal`, `@objectstack/rest`), thrown with the
 * ADR-0112 `code` / `status`.
 *
 * OPTIONAL as a pair: a bridge without both registers neither tool. The
 * runtime's bridge carries both and answers `503 SERVICE_UNAVAILABLE` per call
 * on a host with no `external-datasource` service, as the REST twin does.
 */
export interface McpFederationBridge {
  listRemoteTables(datasource: string, opts: { schema?: string }): Promise<RemoteTable[]>;
  importObject(
    datasource: string,
    remoteName: string,
    opts: { name?: string; writable?: boolean },
  ): Promise<ImportObjectResult>;
}

export interface RegisterActionToolsOptions {
  /**
   * Expose actions on `sys_*` system objects too. Default false (fail-closed):
   * a `sys_*` action is then listed and run only when the bridge attests its
   * author's AI opt-in ({@link McpActionSummary.aiExposed}). This option opens
   * the TOOL layer's filter only; the runtime bridge still requires the
   * per-action opt-in for every `sys_*` action (#27681).
   */
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

/**
 * [#27681] Whether the action tools may list a summary with `allowSystemObjects`
 * off: any action not on a `sys_*` object, and a `sys_*` one only when the
 * bridge attests its author's `ai.exposed` opt-in. ONE predicate for
 * `list_actions` and `run_action`, so the two cannot disagree about a system
 * object's action.
 */
function isListableAction(action: McpActionSummary): boolean {
  return !action.objectName || !isSystemObject(action.objectName) || action.aiExposed === true;
}

function systemObjectActionRefusal(actionName: string, objectName: string): string {
  return (
    `Action "${actionName}" on system object "${objectName}" is not exposed via MCP: a system object's action is ` +
    'reachable only when its author exposed it to AI (ai.exposed) and list_actions lists it for you'
  );
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
 * Uncoded throws fall through to `errorResult` unchanged.
 *
 * `run_action` and `resume_run` only. The other catches render through
 * {@link errorResultWithCode}, which serves the same envelope WITHOUT `details`;
 * that function says why.
 *
 * [#23529] ⛔ A `PERMISSION_DENIED` is the exception: it renders through
 * {@link errorResultWithCode}, so its `details` are WITHHELD here too. The
 * security gate puts the caller's `positions` and `permissionSets` in those
 * `details`; the ruling on #7450 keeps them off the wire, and the runtime
 * dispatcher and the REST actions door both drop them. These two tools are
 * reachable by that refusal: a declarative update action writes as the caller,
 * so a caller who may read the row but not update it meets the gate's
 * write-side refusal, and a host script handler can rethrow one. The answer is
 * a tool result inside a JSON-RPC 200, which the dispatcher's withholding never
 * sees, so it is withheld at this renderer.
 *
 * The question is asked on the DECLARED code, spelled from the spec's standard
 * catalogue rather than restated, and answered with the data tools' own
 * function rather than a second filter of `details`. Every `PermissionDeniedError`
 * declares this code (it is a class constant), and a throw with no code never
 * reaches the `details` read at all. Every other coded refusal keeps its
 * `details` as before, so #15942's confirmation contract and `resume_run`'s
 * REST-built `details` are unchanged.
 */
function errorResultFromThrown(err: unknown) {
  const envelope = thrownRefusalEnvelope(err);
  if (!envelope) return errorResult(messageOf(err));
  if (envelope.code === StandardErrorCode.enum.PERMISSION_DENIED) return errorResultWithCode(err);
  const details = (err as { details?: unknown }).details;
  return codedErrorResult({ ...envelope, ...(details !== undefined ? { details } : {}) });
}

/**
 * [#23509] The metadata tools', `list_actions`' and `delete_records`' tool
 * error, and the coded half of the record data tools' ({@link dataDoorErrorResult}):
 * a thrown coded refusal renders its `code` and `status` beside the message, in
 * {@link errorResultFromThrown}'s shape. A throw with no code renders here as
 * `errorResult(messageOf(err))`, byte-identical to what these catches answered
 * before; the record data tools classify it as the `/data` door does instead
 * (#31218).
 *
 * These catches used to answer the message alone, so a client never read the
 * code it is meant to branch on. The affected refusals: a key whose owner is
 * held (`MFA_REQUIRED`, which ruling C′ item 1 says is refused "with the same
 * code" at every seam), `RECORD_NOT_FOUND`, the exposure and permission
 * refusals, and `INVALID_FIELD`.
 *
 * ⛔ `details` is WITHHELD here, deliberately. What a refusal's `details` may
 * disclose is decided per error class at the HTTP boundary, and this package
 * holds no copy of that policy. Measured on `/mcp`: a `PERMISSION_DENIED`
 * thrown by the security gate carries the caller's `positions` and
 * `permissionSets` (and, on a cascade, an object the caller never addressed).
 * The runtime dispatcher drops those `details` from the wire, so serving them
 * here would disclose on MCP what REST withholds. `code`, `message` and
 * `status` are what every boundary serves.
 */
function errorResultWithCode(err: unknown) {
  const envelope = thrownRefusalEnvelope(err);
  return envelope ? codedErrorResult({ ...envelope }) : errorResult(messageOf(err));
}

/**
 * The tools whose throw the `/api/v1/data` door classifies: the record reads
 * and writes, each the MCP face of one `/data` route. {@link dataDoorErrorResult}
 * renders their catches.
 */
type DataDoorTool =
  | 'query_records'
  | 'aggregate_records'
  | 'get_record'
  | 'create_record'
  | 'update_record'
  | 'delete_record';

/** What the `/data` door answers a thrown value with, read off {@link mapDataError}. */
interface DataDoorAnswer {
  code?: string;
  message: string;
  status: number;
}

/**
 * The `/api/v1/data` door's answer to a thrown value: `mapDataError`
 * (`@objectstack/types`), the classifier that door answers with, read as the
 * `code`, sentence and status it would put on the wire. ⛔ Never a second
 * classification: this file asks the door's own function, so the two doors
 * cannot drift apart on a throw.
 *
 * The sentence is the door's `error` text, which is the caller-addressed one:
 * a sandboxed hook body's inner sentence without the `<kind> '<name>' threw:`
 * wrapper, and `Internal server error` for a fault. `object`, `field` and the
 * other context keys the door adds are not read, as `details` is not
 * ({@link errorResultWithCode}).
 */
function dataDoorAnswerOf(err: unknown, objectName: string): DataDoorAnswer {
  const door = mapDataError(err, objectName);
  const code = typeof door.body.code === 'string' && door.body.code !== '' ? door.body.code : undefined;
  const message = typeof door.body.error === 'string' && door.body.error !== '' ? door.body.error : messageOf(err);
  return { ...(code !== undefined ? { code } : {}), message, status: door.status };
}

/**
 * [#31218] The record data tools' tool error: a CODED throw renders exactly as
 * {@link errorResultWithCode} renders it, and a throw with NO code renders the
 * answer the `/api/v1/data` door gives the same throw ({@link dataDoorAnswerOf}),
 * as `{ error: { code, message, status } }` with `isError`.
 *
 * Those catches used to answer a code-less throw as its bare message. Measured
 * on `MCPServerRuntime`: a sandboxed hook body's `throw new Error('…')` (the
 * QuickJS runner's `SandboxError`, which carries no `code`) reached the agent
 * as `hook '<name>' threw: Error: …`, the debug wrapper with the hook's name and
 * no code, where `/data` answers `400 HOOK_ABORTED` with the inner sentence. The
 * family is answered the same way, each as the door answers it:
 *
 * - an undeclared sandboxed abort: `HOOK_ABORTED`, the door's 4xx, the inner
 *   sentence only;
 * - a code hook's bare `throw new Error`, a driver error: `500 INTERNAL_ERROR`,
 *   `Internal server error`. The thrown message is WITHHELD, as the door
 *   withholds it, and reaches the operator instead, through the one 5xx log
 *   line every door prints (`logServerFault`);
 * - a throw that declared a status and no code (the runtime's
 *   `{ statusCode: 503, message }` when no data service is registered): the
 *   status, and no code, since the door invents none. A declared 5xx's prose is
 *   withheld there too.
 *
 * ⛔ The coded path is read FIRST and is unchanged: a thrown `code` keeps
 * {@link thrownRefusalEnvelope}'s rendering byte for byte, its unique-violation
 * spelling included.
 *
 * Only these six tools. `delete_records` groups its rows through the same door
 * ({@link rowRefusalOf}); its outer catch also renders this file's own
 * code-less sentences, which the door's message heuristics would misread, so
 * it keeps {@link errorResultWithCode}.
 */
function dataDoorErrorResult(err: unknown, tool: DataDoorTool, objectName: string) {
  const envelope = thrownRefusalEnvelope(err);
  if (envelope) return codedErrorResult({ ...envelope });
  const door = dataDoorAnswerOf(err, objectName);
  if (isServerFault(door.status)) {
    logServerFault({
      status: door.status,
      error: err,
      ...(door.code !== undefined ? { code: door.code } : {}),
      request: { method: 'tools/call', path: `${tool} ${objectName}` },
    });
  }
  return codedErrorResult(door);
}

/**
 * [#28782, #28844, #28856] A write tool's answer to a throw: a write the engine
 * stored but whose parent roll-up it could not recompute (`ERR_SUMMARY_RECOMPUTE`,
 * "the triggering records WERE written") answers the write it is, read off
 * #28781's carrier the bridge attached, with the stale column logged once at
 * `error`. An agent that read an error would apply the write again. Any other
 * throw, including every refusal raised before the write, renders through
 * `otherwise`: {@link dataDoorErrorResult} for the data tools,
 * {@link errorResultFromThrown} for `run_action`, whose answer the runtime
 * composed and attached.
 */
function landedWriteResultOrError(
  err: unknown,
  objectName: string | undefined,
  otherwise: (err: unknown) => ReturnType<typeof errorResultWithCode>,
) {
  const earned = earnedAnswerOf(err);
  if (earned === undefined) return otherwise(err);
  for (const line of staleSummaryAnswerLines(err as SummaryRecomputeRefusal, objectName)) console.error(`[MCP] ${line}`);
  return textResult(earned);
}

function codedErrorResult(error: { code?: string; message: string; status?: number; details?: unknown }) {
  return {
    content: [{ type: 'text' as const, text: jsonText({ error }) }],
    isError: true as const,
  };
}

/**
 * The code and status the confirmation gate answers with, on `run_action`'s
 * door (the runtime's `actionConfirmationRefusal`) and on `delete_record`'s
 * (below). Typed as the registered vocabulary, so a misspelling fails to
 * compile instead of reaching a client as a code nobody branches on.
 */
const ACTION_CONFIRMATION_REQUIRED: ErrorCode = 'ACTION_CONFIRMATION_REQUIRED';
const ACTION_CONFIRMATION_REQUIRED_HTTP_STATUS = 428;

/** The `details.actionName` a `delete_record` refusal names: the tool the refused call addressed. */
const DELETE_RECORD_TOOL = 'delete_record';

/**
 * The confirmation gate on the MCP `delete_record` tool: `run_action`'s gate,
 * widened by the maintainer's decision to this one tool, for every object.
 *
 * A delete over MCP is permanent, and the bridge's checks say whether the
 * caller MAY delete, never whether a human asked for it. So a call that does
 * not carry the confirmation member as the boolean `true` is refused with the
 * refusal `run_action` answers an author-gated action with: the same code,
 * status, envelope keys and `details` shape (`ActionConfirmationRequiredDetails`),
 * rendered by the same {@link codedErrorResult}. A client that already handles
 * that refusal confirms with its human and retries this call unchanged but for
 * the member.
 *
 * The runtime's builder is out of reach (`@objectstack/runtime` and this
 * package do not depend on each other), so the contract types and the shared
 * renderer are what hold the two refusals to one shape; the dogfood suite
 * serves both side by side to one caller.
 *
 * What it is NOT, as on `run_action`: `confirm: true` is an unverifiable
 * caller claim. The gate makes forgetting loud; it does not prove a human.
 *
 * Scope, as decided: this tool only. REST `DELETE /api/v1/data/...` (the human
 * path) and `update_record` stay outside it, no object is exempt, and a future
 * bulk-delete tool takes the same gate.
 *
 * Returns `undefined` when the call may proceed.
 */
function recordDeleteConfirmationRefusal(
  objectName: string,
  recordId: string,
  request: AIActionConfirmation,
): DeleteConfirmationRefusal | undefined {
  if (isDeleteConfirmed(request)) return undefined;
  return deleteConfirmationRefusal(
    DELETE_RECORD_TOOL,
    objectName,
    `delete_record on '${objectName}' record '${recordId}' carries no confirmation — nothing was deleted. `
      + 'A delete over MCP is permanent: confirm with the human in the loop, then retry this call with '
      + `'${AI_ACTION_CONFIRMATION_MEMBER}': true on the request.`,
  );
}

/** The refusal both delete tools answer an unconfirmed call with: `run_action`'s, addressed to the tool. */
type DeleteConfirmationRefusal = ThrownRefusalEnvelope & { details: ActionConfirmationRequiredDetails };

/**
 * Only the boolean `true` attests; absent, `false` and a truthy string do not.
 * One predicate for `delete_record` and `delete_records`, so the one-row and
 * the many-row delete cannot disagree about what a confirmation is.
 */
function isDeleteConfirmed(request: AIActionConfirmation): boolean {
  return request[AI_ACTION_CONFIRMATION_MEMBER] === true;
}

/**
 * The ONE builder of the delete tools' confirmation refusal: the code, status
 * and `details` shape (`ActionConfirmationRequiredDetails`) `run_action`'s gate
 * answers, with `details.actionName` naming the tool the refused call
 * addressed. `delete_record` and `delete_records` differ only in the sentence.
 */
function deleteConfirmationRefusal(actionName: string, objectName: string, message: string): DeleteConfirmationRefusal {
  return {
    code: ACTION_CONFIRMATION_REQUIRED,
    message,
    status: ACTION_CONFIRMATION_REQUIRED_HTTP_STATUS,
    details: {
      actionName,
      objectName,
      confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
    },
  };
}

// ── delete_records: many rows of one object in one confirmed call (#30891) ──

/** The `details.actionName` a `delete_records` refusal names: the tool the refused call addressed. */
const DELETE_RECORDS_TOOL = 'delete_records';

/**
 * [#30891] The most records one `delete_records` call deletes.
 *
 * 200 is the bound the platform's other many-row delete door already applies
 * per request: REST `POST /data/:object/deleteMany` refuses more ids than
 * `RestServerConfig.batch.maxBatchSize`, whose default is 200. Like that
 * route, this tool deletes ONE ROW AT A TIME (each row its own engine delete,
 * so each row meets its own delete rules and cascade), so the cap also bounds
 * the length of one call. A selection that matches more answers how many
 * remain, and the next call continues.
 */
export const DELETE_RECORDS_MAX_PER_CALL = 200;

/**
 * The cap one `delete_records` call runs under: {@link DELETE_RECORDS_MAX_PER_CALL},
 * or the deployment's read window when that is smaller.
 *
 * The selection is READ before anything is deleted, and the data door's read
 * window refuses (never clamps) a read asking for more rows than
 * `OS_DATA_MAX_PAGE_SIZE` or walking past `OS_DATA_QUERY_ROW_BUDGET`
 * (`@objectstack/types`' `query-read-limits.ts`). A cap above either would
 * make every filter selection a refusal on that host, and the caller has no
 * `limit` to lower. So the cap follows the window down, and the answer's
 * `cap` names the number used.
 */
export function deleteRecordsCap(env?: Record<string, string | undefined>): number {
  const { maxPageSize, rowBudget } = resolveQueryReadLimits(env);
  return Math.min(DELETE_RECORDS_MAX_PER_CALL, maxPageSize ?? Infinity, rowBudget ?? Infinity);
}

/** How many ids of the selection a preview names. */
const DELETE_RECORDS_SAMPLE_SIZE = 10;

/** The alias the selection's count is read under. */
const DELETE_RECORDS_COUNT_ALIAS = 'matched';

/** What one `delete_records` call selects: a filter, or an id list. Exactly one. */
interface DeleteRecordsSelection {
  where?: Record<string, unknown>;
  recordIds?: string[];
}

/** The selection, resolved under the caller's permissions and row-level security. */
interface ResolvedDeleteSelection {
  /** The cap this call runs under ({@link deleteRecordsCap}). */
  cap: number;
  /** The ids a confirmed call attempts NOW, at most the cap: by id for a filter, the caller's order for a list. */
  attempt: string[];
  /** How many records the selection matches for this caller, when that is known. */
  matched?: number;
  /** True when more records match than one call attempts, whether or not `matched` is known. */
  moreThanCap: boolean;
  /** The listed ids that name no record this caller can read (an id-list selection only). */
  notFound: string[];
}

/** One group of refused rows: the same code, status and reason, as the delete answered each row. */
interface DeleteRefusalGroup {
  code?: string;
  status?: number;
  reason: string;
  count: number;
  recordIds: string[];
}

/** The rows a bridge's `query` answered, read off the protocol's `{ records }` shape. */
function queriedRows(result: unknown, objectName: string): Array<Record<string, unknown>> {
  const records = (result as { records?: unknown } | null | undefined)?.records;
  if (!Array.isArray(records)) {
    // Loud, never "nothing matched": an answer this tool cannot read is not a
    // selection of zero rows, and a delete planned from it would be a guess.
    throw new Error(`delete_records could not read the records the query on '${objectName}' answered — nothing was deleted.`);
  }
  return records as Array<Record<string, unknown>>;
}

function idOfRow(row: Record<string, unknown>): string | undefined {
  const id = row?.id;
  return typeof id === 'string' && id.length > 0 ? id : typeof id === 'number' ? String(id) : undefined;
}

/**
 * Resolve a `delete_records` selection to the ids one call attempts, through
 * the bridge's `query` (and `aggregate`, for the count), so the read runs as
 * the caller: a record the caller cannot read is never selected, and so never
 * deleted by this tool.
 *
 * A filter is read in id order, at most the cap. Whether more match than one
 * call attempts is then the count's answer, asked of `aggregate` only when the
 * read came back full. ⛔ Not a read of one row past the cap: the data door's
 * read window REFUSES a read over the host's page size or row budget
 * (`OS_DATA_MAX_PAGE_SIZE` / `OS_DATA_QUERY_ROW_BUDGET`, "refuse, never
 * clamp"), so a 201-row probe would refuse every filter on a host that sets
 * either at 200. A bridge without `aggregate` (or whose count cannot be read)
 * keeps the probe, the one way it has to tell "exactly the cap" from "more".
 * An id list is at most the cap long (the handler refuses a longer one before
 * reading), so one read of those ids answers both which exist and how many.
 */
async function resolveDeleteSelection(
  bridge: McpDataBridge,
  objectName: string,
  selection: DeleteRecordsSelection,
  cap: number,
): Promise<ResolvedDeleteSelection> {
  if (selection.recordIds) {
    const listed = [...new Set(selection.recordIds)];
    const rows = queriedRows(
      await bridge.query(objectName, { where: { id: { $in: listed } }, fields: ['id'], limit: listed.length }),
      objectName,
    );
    const found = new Set(rows.map(idOfRow).filter((id): id is string => id !== undefined));
    const attempt = listed.filter((id) => found.has(id));
    return { cap, attempt, matched: attempt.length, moreThanCap: false, notFound: listed.filter((id) => !found.has(id)) };
  }
  const where = selection.where ?? {};
  const readIds = async (limit: number): Promise<string[]> =>
    queriedRows(
      await bridge.query(objectName, { where, fields: ['id'], orderBy: [{ field: 'id', order: 'asc' }], limit }),
      objectName,
    )
      .map(idOfRow)
      .filter((id): id is string => id !== undefined);

  if (typeof bridge.aggregate === 'function') {
    const ids = await readIds(cap);
    if (ids.length < cap) return { cap, attempt: ids, matched: ids.length, moreThanCap: false, notFound: [] };
    const count = await countSelection(bridge, objectName, where);
    if (count !== undefined) {
      // A count below the rows just read is a write landing between the two
      // reads; the read is the floor.
      const matched = Math.max(count, ids.length);
      return { cap, attempt: ids, matched, moreThanCap: matched > cap, notFound: [] };
    }
  }
  const probed = await readIds(cap + 1);
  const moreThanCap = probed.length > cap;
  return {
    cap,
    attempt: probed.slice(0, cap),
    ...(moreThanCap ? {} : { matched: probed.length }),
    moreThanCap,
    notFound: [],
  };
}

/** The selection's count under the caller's row-level security, or `undefined` when the bridge cannot say. */
async function countSelection(
  bridge: McpDataBridge,
  objectName: string,
  where: Record<string, unknown>,
): Promise<number | undefined> {
  if (typeof bridge.aggregate !== 'function') return undefined;
  const rows = await bridge.aggregate(objectName, {
    where,
    aggregations: [{ function: 'count', alias: DELETE_RECORDS_COUNT_ALIAS }],
  });
  const value = (rows?.[0] as Record<string, unknown> | undefined)?.[DELETE_RECORDS_COUNT_ALIAS];
  if (typeof value === 'bigint') return Number(value);
  // A SQL driver may answer a COUNT as a decimal string (a 64-bit integer).
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A row the delete stopped at: a fault, not a delete rule's refusal. */
interface DeleteFault {
  recordId: string;
  code?: string;
  status?: number;
  message: string;
}

/** What {@link deleteEach} did with the attempt set, in order. */
interface DeleteEachOutcome {
  /** Rows the bridge was asked to delete: every row before a fault, and the faulted one. */
  attempted: number;
  deleted: number;
  refusals: DeleteRefusalGroup[];
  notRemoved: string[];
  /** Set when a fault stopped the walk; the rows after it were not attempted. */
  fault?: DeleteFault;
  notAttempted: number;
}

/**
 * A refused row's group key, or `undefined` when the throw is a FAULT.
 *
 * The line is the one the platform's data door already draws, read with its
 * own classifier so the two doors cannot disagree on a row: `mapDataError`
 * (`@objectstack/types`), the REST `/data` door's table, which the bulk-import
 * runner adopts per row too. A 4xx verdict is a refusal; a 5xx verdict is a
 * fault. That covers the coded and the uncoded throw alike:
 *
 * - a delete rule's coded refusal (`RECORD_LOCKED` / 409, `PERMISSION_DENIED`
 *   / 403, a package's own code at 422) is a 4xx refusal, grouped under the
 *   code and message {@link thrownRefusalEnvelope} reads, the spelling
 *   `delete_record` answers;
 * - a sandboxed hook body's deliberate throw carries no code; the door
 *   answers it `400 HOOK_ABORTED` with the body's own sentence, and so is it
 *   grouped here;
 * - a code hook's bare `throw new Error`, a lost connection, a driver error
 *   are faults, and so is a driver's OWN string code (`ECONNREFUSED`, a SQL
 *   state such as `57P01`, `SQLITE_BUSY`): a `code` is not a rule's verdict
 *   by being a string, and the door answers each of those `500`.
 *
 * Measured on a booted stack: REST `DELETE` answers the sandboxed refusal
 * `400 HOOK_ABORTED` and the code hook's bare throw `500 INTERNAL_ERROR`.
 */
function rowRefusalOf(err: unknown, objectName: string): Omit<DeleteRefusalGroup, 'count' | 'recordIds'> | undefined {
  const door = dataDoorAnswerOf(err, objectName);
  if (isServerFault(door.status)) return undefined;
  const envelope = thrownRefusalEnvelope(err);
  if (envelope) return { code: envelope.code, status: envelope.status ?? door.status, reason: envelope.message };
  return { ...(door.code !== undefined ? { code: door.code } : {}), status: door.status, reason: door.message };
}

/**
 * Delete each id of the attempt set through the bridge's `remove`, the member
 * `delete_record` deletes with, so each row passes exactly the checks a
 * one-row delete passes: the object's exposure, the caller's permissions and
 * row-level security, and the package's delete rules (`beforeDelete` hooks,
 * restricted relations). No row is deleted any other way, so no rule is
 * bypassed, for an administrator either (the maintainer's ruling on the card).
 *
 * A refused row stays, and its refusal is grouped: rows refused with the same
 * code, status and reason are one group ({@link rowRefusalOf}; a refusal's
 * `details` is never read, as the one-row tool renders a throw). A delete
 * that landed under a parent roll-up the engine could not recompute counts as
 * deleted, as `delete_record` answers it, with the stale column logged.
 *
 * ⛔ A FAULT stops the walk. A driver error or a crash is not a rule's verdict
 * on that row: grouped as a "refusal" it would read as the rules' answer, and
 * the rows after it would meet the same broken store. So the first fault ends
 * the call, and the answer names it, the row it stopped at, and what was
 * already deleted (those deletes stay deleted).
 */
async function deleteEach(
  bridge: McpDataBridge,
  objectName: string,
  ids: readonly string[],
): Promise<DeleteEachOutcome> {
  let deleted = 0;
  let attempted = 0;
  const notRemoved: string[] = [];
  const groups = new Map<string, DeleteRefusalGroup>();
  let fault: DeleteFault | undefined;
  for (const id of ids) {
    attempted++;
    try {
      const answer = await bridge.remove(objectName, id);
      // `success: false` is the protocol's "matched, and deliberately NOT
      // removed" (a reset, not a delete); anything else is a deletion.
      if ((answer as { success?: unknown } | null | undefined)?.success === false) notRemoved.push(id);
      else deleted++;
    } catch (err) {
      if (earnedAnswerOf(err) !== undefined) {
        for (const line of staleSummaryAnswerLines(err as SummaryRecomputeRefusal, objectName)) console.error(`[MCP] ${line}`);
        deleted++;
        continue;
      }
      const refusal = rowRefusalOf(err, objectName);
      if (!refusal) {
        const envelope = thrownRefusalEnvelope(err);
        fault = {
          recordId: id,
          ...(envelope ? { code: envelope.code } : {}),
          ...(envelope?.status !== undefined ? { status: envelope.status } : {}),
          message: envelope?.message ?? messageOf(err),
        };
        break;
      }
      const key = JSON.stringify([refusal.code ?? null, refusal.status ?? null, refusal.reason]);
      const group = groups.get(key) ?? { ...refusal, count: 0, recordIds: [] };
      group.count++;
      group.recordIds.push(id);
      groups.set(key, group);
    }
  }
  // Largest group first; a tie keeps the order the rows were refused in.
  const refusals = [...groups.values()].sort((a, b) => b.count - a.count);
  return { attempted, deleted, refusals, notRemoved, ...(fault ? { fault } : {}), notAttempted: ids.length - attempted };
}

/** How many records one call names: the exact count, or that more than the cap match. */
function selectionCount(resolved: ResolvedDeleteSelection): { matched: number } | { matchedMoreThan: number } {
  return resolved.matched !== undefined ? { matched: resolved.matched } : { matchedMoreThan: resolved.cap };
}

function deleteRecordsPreview(objectName: string, resolved: ResolvedDeleteSelection) {
  return {
    object: objectName,
    ...selectionCount(resolved),
    wouldAttempt: resolved.attempt.length,
    cap: resolved.cap,
    sampleRecordIds: resolved.attempt.slice(0, DELETE_RECORDS_SAMPLE_SIZE),
    ...(resolved.notFound.length > 0 ? { notFound: resolved.notFound } : {}),
    note:
      'Nothing was deleted. The object\'s delete rules (locks, restricted relations, permissions) are judged per '
      + 'record when the delete runs: a confirmed call deletes the records they allow and answers the rest grouped '
      + 'by reason, with their ids.',
  };
}

/** The unconfirmed `delete_records` call's refusal sentence. */
function deleteRecordsRefusalMessage(objectName: string, resolved: ResolvedDeleteSelection): string {
  const count = resolved.matched !== undefined
    ? `${resolved.matched} record(s)`
    : `more than ${resolved.cap} records`;
  return (
    `delete_records on '${objectName}' carries no confirmation — nothing was deleted. The selection matches ${count}; `
    + `a confirmed call deletes up to ${resolved.cap} of them. A delete over MCP is permanent: show `
    + `the preview to the human in the loop, then retry this call with '${AI_ACTION_CONFIRMATION_MEMBER}': true on the request.`
  );
}

/** What a confirmed `delete_records` call answers: the outcome per row, counted and grouped. */
function deleteRecordsOutcome(objectName: string, resolved: ResolvedDeleteSelection, done: DeleteEachOutcome) {
  const refused = done.refusals.reduce((n, g) => n + g.count, 0);
  // Of the records the selection matched when this call began, how many still
  // match: the refused, the not removed, the faulted, the not attempted and
  // the ones past the cap.
  const remaining = resolved.matched !== undefined ? resolved.matched - done.deleted : undefined;
  const beyondCap = resolved.matched !== undefined ? resolved.matched - resolved.attempt.length : undefined;
  const next: string[] = [];
  if (resolved.moreThanCap && !done.fault) {
    next.push(
      `${beyondCap !== undefined ? beyondCap : 'More'} matching record(s) were past this call's cap of `
        + `${resolved.cap}: call again with the same selection and confirm: true to continue.`,
    );
  }
  if (refused > 0 && resolved.moreThanCap && !done.fault) {
    next.push(
      'Refused records still match the selection and are attempted again first; to move past them, exclude their ids '
        + '(for example {"id": {"$nin": [...]}} in where).',
    );
  }
  return {
    object: objectName,
    ...selectionCount(resolved),
    attempted: done.attempted,
    deleted: done.deleted,
    refused,
    refusals: done.refusals,
    ...(done.notRemoved.length > 0 ? { notRemoved: done.notRemoved } : {}),
    ...(resolved.notFound.length > 0 ? { notFound: resolved.notFound } : {}),
    ...(done.fault ? { stoppedAt: done.fault.recordId, notAttempted: done.notAttempted } : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    cap: resolved.cap,
    ...(next.length > 0 ? { next: next.join(' ') } : {}),
  };
}

/**
 * The tool error a fault answers: the fault itself (its code and status when
 * it declared them), the row it stopped at, and the call's progress, since
 * the records deleted before it stay deleted and an agent that read a bare
 * error would retry them as if nothing had happened.
 */
function deleteRecordsFaultMessage(objectName: string, done: DeleteEachOutcome & { fault: DeleteFault }): string {
  return (
    `delete_records on '${objectName}' stopped at record '${done.fault.recordId}': ${done.fault.message} `
    + 'This is a fault, not a delete rule\'s refusal, so no record after it was attempted. '
    + `${done.deleted} record(s) were deleted before it and stay deleted; ${done.notAttempted} were not attempted. `
    + 'Retry the same call once the fault is resolved: it selects what still matches.'
  );
}

/** What {@link thrownRefusalEnvelope} reads off a thrown coded refusal. */
export interface ThrownRefusalEnvelope {
  code: string;
  message: string;
  status?: number;
}

/**
 * Read the ADR-0112 `code`, message and `status` off a thrown value, or
 * `undefined` when it carries no non-empty string `code`.
 *
 * The one reader both MCP surfaces use, so the tools and the record resource
 * (`MCPServerRuntime.bridgeResources`) agree on what counts as a coded
 * refusal. `undefined` tells the caller to keep its own message-only
 * rendering: nothing is invented for a throw that never had a code. `details`
 * is not read here; {@link errorResultWithCode} says why.
 *
 * ## One wire spelling for a unique-constraint refusal (#23701)
 *
 * Maintainer ruling (2026-09-03, recorded in commit 65846bc46): one wire
 * spelling on every route, `UNIQUE_VIOLATION`; the row reports it too.
 *
 * The engine's `DuplicateRecordError` declares its in-process identity,
 * `DUPLICATE_RECORD`, which an in-process caller (a hook, a flow node)
 * branches on and which is ⛔ not renamed. This reader used to relay that
 * code verbatim, so a tool call that repeated a unique value
 * (`create_record`, `update_record`, a `run_action` body's write) answered
 * `DUPLICATE_RECORD`, while `RestServer`'s arm, the batch and import rows, both
 * Hono doors and the runtime dispatcher answer the same throw as
 * `UNIQUE_VIOLATION`. An MCP client is out of process, so it gets the wire
 * spelling.
 *
 * The code is decided here, before it is written, keyed as those doors key it
 * ({@link isEngineDuplicateRecordEnvelope}, `@objectstack/types`). A producer
 * that merely SPEAKS `DUPLICATE_RECORD` (a hook or an action handler throwing
 * the registered code without being the engine's class) keeps its own code.
 * `message` (the engine's sentence) and `status` (409) are unchanged.
 *
 * ⛔ Only the code moves. The other doors also carry the REST arm's context
 * (`developerMessage`, `object`, `field`) in their envelope's context slot;
 * this envelope has none. It is `code`, `message` and `status`, and the data
 * tools withhold `details` by design ({@link errorResultWithCode}).
 *
 * ## The caller-addressed sentence of a sandboxed refusal (#31246)
 *
 * A QuickJS hook or action body that throws with a declared `code` and
 * `status` leaves the runner as a `SandboxError` whose `.message` is the
 * `<kind> '<name>' threw: Error: …` debug wrapper, naming the hook, and whose
 * `.innerMessage` is the sentence the author addressed to the caller. The
 * `message` here is `sandboxBusinessMessage` (`@objectstack/types`), the read
 * the `/api/v1/data` door makes for the same throw, and `.message` only when
 * that read declines: not a sandbox refusal, or a body that crashed. ⛔ One
 * reader, never a copy of its logic here, and never a strip of the wrapper's
 * prose: a non-sandbox refusal keeps its own message byte for byte. The code
 * and status are unchanged.
 */
export function thrownRefusalEnvelope(err: unknown): ThrownRefusalEnvelope | undefined {
  const thrownCode = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof thrownCode !== 'string' || thrownCode.length === 0) return undefined;
  const status = (err as { status?: unknown }).status;
  return {
    code: wireCodeOf(err, thrownCode),
    message: sandboxBusinessMessage(err) ?? messageOf(err),
    ...(typeof status === 'number' ? { status } : {}),
  };
}

/**
 * [#23701] The code a thrown refusal crosses to an MCP client with: the
 * thrown one, except for the engine's `DuplicateRecordError`, whose wire code
 * is read off the shared classification's arm for that class
 * (`structuredCodeAnswer`, `@objectstack/types`, the arm `RestServer`
 * answers with). So this package spells no copy of the wire code of its own:
 * it relays the classification's answer, as the REST door does, and the
 * pins in `mcp-unique-violation-wire-code.test.ts` hold what that answer is.
 */
function wireCodeOf(err: unknown, thrownCode: string): string {
  if (!isEngineDuplicateRecordEnvelope(err)) return thrownCode;
  const armCode = structuredCodeAnswer(err)?.body.code;
  return typeof armCode === 'string' ? armCode : thrownCode;
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
 *
 * `slot` is the spec input schema the save/build gate parses that site's slot
 * with: an evaluated CEL slot (`EvaluatedExpressionInputSchema` — the formula
 * `expression`, validation and flow-edge conditions) or a `{{ }}` template slot
 * (`TemplateExpressionInputSchema`). The tool parses with it first, so whatever
 * the gate refuses at the envelope level — today a source that is blank after
 * trimming — the tool refuses too, with the gate's own issue.
 *
 * [#28715] `optionLabels`: the site where the gate judges what a `label()`
 * call names (`ExprSchemaHint.optionFields`). `@objectstack/lint`'s formula
 * pass hands the validator the object's option-bearing fields on a formula
 * field's `expression` and nowhere else, so the tool asks the bridge for them
 * on the `formula` site only and answers every other site as the gate does.
 */
const VALIDATE_SITE_MAP: Record<
  string,
  {
    role: FieldRole;
    scope: 'record' | 'flattened';
    slot: z.ZodType;
    optionLabels?: true;
    /**
     * [#29904, #29926, #29959] What the gate's runtime does on a fault at this
     * site, from the caller's optional `severity` / `triggerKind` — the two
     * facts `@objectstack/lint`'s `faultOutcomeOf` ledger reads off the rule
     * and the flow — and (#30026) `sweepsTypedObject`, the ledger's third: a
     * time-relative sweep's object is `objectName` (no `sweepObject`, or the
     * same one). Absent: the site declares none.
     */
    faultOutcome?: (inputs: {
      severity: ValidationSeverity;
      triggerKind: FlowTriggerOrNone;
      sweepsTypedObject: boolean;
    }) => ExprFaultOutcome | undefined;
  }
> = {
  formula: { role: 'value', scope: 'record', slot: EvaluatedExpressionInputSchema, optionLabels: true },
  // [#29904, #29926] A `severity: 'error'` rule (the default) fails closed: a
  // fault refuses the write. An advisory rule (`warning` / `info`) fails open:
  // the rule is skipped and the write proceeds. The gate grades a
  // text-vs-number comparison an error worded for each; the tool answers what
  // the gate will for the severity it is told.
  validation: {
    role: 'predicate', scope: 'record', slot: EvaluatedExpressionInputSchema,
    faultOutcome: ({ severity }) => (severity === 'warning' || severity === 'info' ? 'fail-open' : 'fail-closed'),
  },
  // [#29926, #29959] A record-triggered flow's start, edge or `decision`
  // branch condition (the default `triggerKind`): the trigger record is
  // flattened into the run's variables, a fault fails the run while the write
  // that fired it lands, and the gate grades a text-vs-number comparison an
  // error worded so. A time-relative sweep launches each run with a row of
  // the swept object as its record, so a sweep of `objectName` is graded the
  // same; a sweep of another object (`sweepObject`, #30026) binds a row of
  // THAT object, and like any other trigger kind declares no outcome: the
  // gate's `type-mismatch-run-may-fail` warning.
  flow_condition: {
    role: 'predicate', scope: 'flattened', slot: EvaluatedExpressionInputSchema,
    faultOutcome: ({ triggerKind, sweepsTypedObject }) =>
      (triggerKind === 'record_change' || (triggerKind === 'time_relative' && sweepsTypedObject) ? 'run-fails' : undefined),
  },
  template: { role: 'template', scope: 'record', slot: TemplateExpressionInputSchema },
};

/** [#29959] A validation rule's `severity`, as `ValidationRuleSchema` spells it. */
type ValidationSeverity = 'error' | 'warning' | 'info';
const VALIDATION_SEVERITIES = ['error', 'warning', 'info'] as const satisfies readonly ValidationSeverity[];
/**
 * [#29959] A flow's trigger kind, as `resolveFlowTriggerKind` answers it, or
 * `none` for a flow with no auto-launch trigger (a screen flow, an
 * autolaunched flow started by hand, an action or a parent flow).
 */
type FlowTriggerOrNone = FlowTriggerKind | 'none';
const FLOW_TRIGGER_INPUTS: [FlowTriggerOrNone, ...FlowTriggerOrNone[]] = ['none', ...FLOW_TRIGGER_KINDS];

// ── Tool arguments: an undeclared key is REFUSED, not stripped (#16913) ──────

/**
 * [#30126 row 15] The refusal says which key is wrong and what to send
 * instead, and stops there: no sentence on why the key used to be dropped.
 *
 * `strictUnknownKeyError` (`@objectstack/spec/shared`) closes every message
 * with its surface's `history` sentence. On an authorable metadata schema that
 * sentence tells an author why a file that used to load is now refused; here
 * the reader is an agent mid-call, and the history of #16913 (a mis-guessed
 * name used to be stripped by the SDK, so the call succeeded with a different
 * answer) tells it nothing it can act on. So the factory is handed an empty
 * history and the separator it leaves is trimmed: the message ends at its last
 * fix channel. The prose that explains the posture stays in this file, beside
 * {@link strictToolInput}, where the readers who need it look.
 */
function withoutHistorySentence(map: z.core.$ZodErrorMap): z.core.$ZodErrorMap {
  return (issue) => {
    const answer = map(issue);
    return typeof answer === 'string' ? answer.trimEnd() : answer;
  };
}

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
      error: withoutHistorySentence(strictUnknownKeyError({
        surface: options.surface,
        knownKeys: Object.keys(shape),
        aliases: options.aliases,
        history: '',
      })),
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
 * mechanism keeps serving object tools unchanged), and `resume_run` beside
 * them when it also implements `resumeRun` (#15705). Whoever owns the server
 * decides nothing else: the tool set is a function of the BRIDGE, so the same
 * bridge yields the same tools on stdio and over HTTP, which is the property
 * `transport-parity` pins.
 *
 * @returns the names actually registered, so a host can report its surface
 *   honestly instead of asserting a count that can drift from the code above.
 */
export function wireBridgeTools(
  server: McpServer,
  bridge: McpDataBridge & Partial<McpActionBridge> & Partial<McpFederationBridge> & McpFileBridge,
  options: RegisterObjectToolsOptions & RegisterActionToolsOptions = {},
): string[] {
  const registered = registerObjectTools(server, bridge, options);
  // [#30892] `read_file` / `create_upload_link`, each only where the bridge
  // implements its member.
  registered.push(...registerFileTools(server, bridge, options));
  if (typeof bridge.listActions === 'function' && typeof bridge.runAction === 'function') {
    registered.push(...registerActionTools(server, bridge as McpActionBridge, options));
  }
  if (typeof bridge.listRemoteTables === 'function' && typeof bridge.importObject === 'function') {
    registered.push(...registerFederationTools(server, bridge as McpFederationBridge, options));
  }
  return registered;
}

/**
 * [#27745] Register the federation pair, `list_remote_tables` and
 * `import_object`, over {@link McpFederationBridge}.
 *
 * Gated as the AUTHORING family is ({@link grantsAuthoringTools}): an import
 * lands object metadata, so both register only for a token whose scopes name
 * `metadata:write`, and a key or a session gets neither. The listing rides
 * with the import because it is the import's discovery step, and it reads a
 * live remote schema, which the REST twin gates as an administrator read.
 * Unlike the authoring family, the import does not land a draft: it saves a
 * live, read-only (unless `writable`) federated object, exactly as Studio's
 * "Import as Object" does — the description says so.
 */
export function registerFederationTools(
  server: McpServer,
  bridge: McpFederationBridge,
  options: { grantedScopes?: readonly string[] } = {},
): string[] {
  const registered: string[] = [];
  const note = (name: string): string => {
    registered.push(name);
    return name;
  };
  if (!grantsAuthoringTools(options.grantedScopes)) return registered;

  server.registerTool(
    note('list_remote_tables'),
    {
      description:
        'List the remote tables of a federated datasource — for an OData datasource, the entity sets its ' +
        '$metadata declares — with their column counts. Use import_object to turn one into an object. ' +
        'Reads the live remote schema; requires the federation read capability.',
      inputSchema: strictToolInput(
        { surface: 'this list_remote_tables call', aliases: { name: 'datasource', datasourceName: 'datasource' } },
        {
          datasource: z.string().describe('The federated datasource name (schemaMode external or validate-only).'),
          schema: z.string().optional().describe('Restrict the listing to one remote schema.'),
        },
      ),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args: { datasource: string; schema?: string }) => {
      try {
        const tables = await bridge.listRemoteTables(args.datasource, args.schema ? { schema: args.schema } : {});
        return textResult({ tables, totalCount: tables.length });
      } catch (err) {
        return errorResultWithCode(err);
      }
    },
  );

  server.registerTool(
    note('import_object'),
    {
      description:
        'Import one remote table of a federated datasource (an OData entity set) as a live federated object, ' +
        'the same import Studio\'s datasource page performs. The object is saved at once (not as a draft), is ' +
        'read-only unless writable is true (which also needs the datasource to allow writes), and maps the ' +
        'remote types to field types. A navigation becomes a lookup only when its target is already imported, ' +
        'so import targets first; the result\'s review lists lossy columns and navigations left out. ' +
        'Requires the federation read and write capabilities.',
      inputSchema: strictToolInput(
        {
          surface: 'this import_object call',
          aliases: {
            datasourceName: 'datasource',
            table: 'remoteName',
            remoteTable: 'remoteName',
            entitySet: 'remoteName',
            objectName: 'name',
          },
        },
        {
          datasource: z.string().describe('The federated datasource name.'),
          remoteName: z.string().describe('The remote table / entity set, as list_remote_tables names it.'),
          name: z
            .string()
            .optional()
            .describe('Override the derived object name (snake_case, package namespace prefix included).'),
          writable: z
            .boolean()
            .optional()
            .describe('Opt the object into writes. Default false: federated objects are read-only.'),
        },
      ),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args: { datasource: string; remoteName: string; name?: string; writable?: boolean }) => {
      try {
        const result = await bridge.importObject(args.datasource, args.remoteName, {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.writable !== undefined ? { writable: args.writable } : {}),
        });
        return textResult({ object: result });
      } catch (err) {
        return errorResultWithCode(err);
      }
    },
  );

  return registered;
}

/**
 * [#26464] Whether a grant admits the AUTHORING family — the host-injected
 * authoring `ToolRegistry` the HTTP runtime bridges (`registerAuthoringTools`
 * in `mcp-server-runtime.ts`) and the skill section that names those tools
 * (`skill-md.ts`). One predicate for both, so the skill never teaches a tool
 * the server would refuse.
 *
 * The refusal shape is the one the three native families already use: a tool
 * outside the grant is NOT registered, so `tools/list` omits it and the SDK
 * answers `tools/call` on it as an unknown tool — the same answer
 * `create_record` gets without `data:write`.
 *
 * Deliberately stricter than the native families' rule on the UNDEFINED side.
 * For data and action tools `grantedScopes: undefined` (API-key / session
 * provenance) means "not scope-limited" and keeps the full surface, because
 * every one of those calls is bounded by the caller's own permissions and RLS.
 * Authoring lands metadata, and the ruling that opens it over MCP (cloud
 * ADR-0112, the maintainer's 2026-10-27 ruling) opens it to a developer whose
 * TOKEN carries the consent — so the family registers only when a scope list
 * is present AND names `metadata:write`. A key or a session, having consented
 * to nothing, is served no authoring tool; widening that to the headless track
 * is a decision for its own card, not a default this predicate takes.
 */
export function grantsAuthoringTools(grantedScopes: readonly string[] | undefined): boolean {
  return Array.isArray(grantedScopes) && grantedScopes.includes(MCP_OAUTH_SCOPE_METADATA_WRITE);
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
          return errorResultWithCode(err);
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
          return errorResultWithCode(err);
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
          '(text/boolean fields misused in arithmetic, an error at a `validation` site, worded for the rule\'s ' +
          '`severity`, and at a `flow_condition` of a record-triggered or time-relative flow, where it fails the run; ' +
          'a warning on any other flow; date-equality pitfalls), plus the fields and stdlib ' +
          'functions in scope so you can self-correct. `site` says where the expression will live: a `formula` ' +
          'field, a `validation`/predicate, or a `flow_condition` (fields are bound bare in flow conditions). ' +
          'Pass the rule\'s `severity` (validation) or the flow\'s `triggerKind` (flow_condition), so the verdict is ' +
          'the one the publish gate gives that rule or flow. A time-relative flow\'s conditions read a row of the object ' +
          'its sweep scans (`timeRelative.object`): pass that object as objectName. A start whose objectName names ' +
          'another object is refused at publish (`flow-time-relative-object-mismatch`).',
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
            severity: z
              .enum(VALIDATION_SEVERITIES)
              .optional()
              .describe(
                'site validation only: the rule\'s `severity`. A `warning` / `info` rule is advisory, so a fault skips it ' +
                'instead of refusing the write, and the verdict says so. Default: error, the rule default.',
              ),
            triggerKind: z
              .enum(FLOW_TRIGGER_INPUTS)
              .optional()
              .describe(
                'site flow_condition only: how the flow is started — record_change (start triggerType record-*), ' +
                'time_relative, schedule, api, or none (started by hand, an action or a parent flow). A type mismatch ' +
                'is an error on a record_change or time_relative flow (its record is a row of objectName) and a warning ' +
                'on any other. Default: record_change.',
              ),
            sweepObject: z
              .string()
              .optional()
              .describe(
                'site flow_condition with triggerKind time_relative only: the flow\'s `timeRelative.object`, the object ' +
                'the sweep scans and whose rows it hands each run as its record. Its conditions are typed against that ' +
                'object, so it is objectName too. A start whose objectName names another object is refused at publish ' +
                '(`flow-time-relative-object-mismatch`); passed with another objectName, the verdict is the gate\'s ' +
                'advisory one for such a flow, a type mismatch warning. Default: objectName.',
              ),
          },
        ),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, expression, site, severity, triggerKind, sweepObject }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        // [#29959] Each input describes one site; on another it would be
        // silently meaningless, so it is refused instead.
        if (severity !== undefined && site !== 'validation') {
          return errorResult(`\`severity\` describes a validation rule; it applies only with site "validation", not "${site ?? 'formula'}".`);
        }
        if (triggerKind !== undefined && site !== 'flow_condition') {
          return errorResult(`\`triggerKind\` describes a flow; it applies only with site "flow_condition", not "${site ?? 'formula'}".`);
        }
        // [#30026] The swept object describes a time-relative flow alone.
        if (sweepObject !== undefined && (site !== 'flow_condition' || triggerKind !== 'time_relative')) {
          return errorResult(
            `\`sweepObject\` describes a time-relative sweep; it applies only with site "flow_condition" and triggerKind ` +
              `"time_relative", not site "${site ?? 'formula'}" with triggerKind "${triggerKind ?? 'record_change'}".`,
          );
        }
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
          const { role, scope, slot, optionLabels, faultOutcome: outcomeOf } = VALIDATE_SITE_MAP[site ?? 'formula'];
          const faultOutcome = outcomeOf?.({
            severity: severity ?? 'error',
            triggerKind: triggerKind ?? 'record_change',
            sweepsTypedObject: sweepObject === undefined || sweepObject === objectName,
          });
          // [#28715] The object's option-bearing fields, where the gate reads
          // them: `label(record.<field>)` on a declared field outside this list
          // is refused as `label-field-no-options` by the one validator.
          const optionFields = optionLabels && bridge.optionFieldsOf
            ? await bridge.optionFieldsOf(objectName)
            : null;
          const hint = {
            objectName,
            fields,
            fieldTypes,
            scope,
            ...(optionFields ? { optionFields } : {}),
            ...(faultOutcome ? { faultOutcome } : {}),
            // [#30250] A time-relative sweep's run is fired by no write: the
            // gate's run-fails sentence there names none, and so does this one.
            ...(site === 'flow_condition' && triggerKind === 'time_relative' ? { timeRelativeSweep: true } : {}),
          } as const;
          // The gate's envelope verdict first: `validateExpression` treats a
          // blank source as "not authored" and answers ok, while the save gate
          // refuses it. Each issue is the spec schema's own (code and message),
          // so the tool and the gate cannot drift apart on this rule.
          const slotParse = slot.safeParse(expression);
          const result = slotParse.success
            ? validateExpression(role, expression, hint)
            : {
                ok: false,
                errors: slotParse.error.issues.map((issue) => ({
                  source: expression,
                  message: issue.message,
                  code: issue.code,
                })),
                warnings: [],
              };
          const inScope = introspectScope(role, hint);
          const inferredType =
            slotParse.success && role === 'value' ? inferExpressionType(expression, hint) : undefined;
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
          return errorResultWithCode(err);
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
          return dataDoorErrorResult(err, 'query_records', objectName);
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
              // [#28550 → #28609] One entry is the engine's own node, taken whole:
              // `AggregationNodeSchema` is closed at the producer, so an
              // undeclared entry key is refused here in the words the REST
              // query door prints for the same body (`aliases` and the retired
              // `distinct`'s tombstone included), and `filter` reaches the
              // bridge unchanged for `engine.aggregate` to apply. ⛔ No local
              // copy of the entry: the copy this tool closed by itself (#28550)
              // was a second key list, which this node now is.
              .array(AggregationNodeSchema)
              .min(1)
              .describe(
                'Metrics to compute, e.g. [{"function":"sum","field":"amount","alias":"total"},'
                  + '{"function":"count","alias":"open_count","filter":{"status":"open"}}]',
              ),
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
            return dataDoorErrorResult(err, 'aggregate_records', objectName);
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
          return dataDoorErrorResult(err, 'get_record', objectName);
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
          return landedWriteResultOrError(err, objectName, (e) => dataDoorErrorResult(e, 'create_record', objectName));
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
          return landedWriteResultOrError(err, objectName, (e) => dataDoorErrorResult(e, 'update_record', objectName));
        }
      },
    );

    server.registerTool(
      note('delete_record'),
      {
        description:
          'Delete a record by id. This is destructive and permanent. A call is REFUSED unless it also sends ' +
          'confirm: true — ask the human first, then retry; nothing is deleted on a refused call.',
        inputSchema: strictToolInput(
          { surface: 'this delete_record call', aliases: { ...OBJECT_NAME_ALIASES, ...RECORD_ID_ALIASES } },
          {
            objectName: z.string().describe('The object/table name'),
            recordId: z.string().describe('The record id'),
            // The confirmation member, keyed off the contract's constant as
            // `run_action` declares it. OPTIONAL in the schema on purpose: a
            // required member would refuse an unconfirmed call as a bare input
            // validation error, with no code and no retry details, before the
            // handler could answer the gate's refusal.
            [AI_ACTION_CONFIRMATION_MEMBER]: z
              .boolean()
              .optional()
              .describe(
                'Set to true only when the human in the loop has approved deleting THIS record. Without it '
                + 'the call is refused and nothing is deleted.',
              ),
          },
        ),
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      async (args) => {
        const { objectName, recordId } = args;
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        // The gate, before the bridge: a refused call reaches no bridge, so
        // nothing is read or deleted whichever bridge serves this server.
        const unconfirmed = recordDeleteConfirmationRefusal(objectName, recordId, args);
        if (unconfirmed) return codedErrorResult(unconfirmed);
        try {
          return textResult(await bridge.remove(objectName, recordId));
        } catch (err) {
          return landedWriteResultOrError(err, objectName, (e) => dataDoorErrorResult(e, 'delete_record', objectName));
        }
      },
    );

    // [#30891] Registered under BOTH data scopes. Its unconfirmed call reads
    // the selection (ids and a count) through `query` / `aggregate`, a
    // list-class read; under `data:write` alone that read would serve ids a
    // token granted no `data:read` cannot list (seat decision on the review).
    if (canRead) {
      // [#30891] Many records of one object in one confirmed call, where the
      // agent used to plan one `delete_record` per row. It composes the bridge
      // members the other data tools call — `query` (and `aggregate`) to select,
      // `remove` to delete each row — so it adds no execution path: each row is
      // deleted exactly as `delete_record` deletes it, under the caller's
      // permissions, row-level security and the package's delete rules, and a
      // rule's refusal holds for every caller, an administrator included
      // (maintainer's ruling on the card: no bypass).
      //
      // The confirmation is `delete_record`'s, by the decision that gated it: an
      // unconfirmed call is refused with the same code, status and `details`
      // shape. What the refusal adds is a `preview` beside `error` — the count
      // and a sample of what a confirmed call would delete — because a human
      // asked to approve a bulk delete has to see its size. Reading the
      // selection is the one thing an unconfirmed call does; it deletes nothing.
      //
      // ⛔ The preview names no per-record refusal, and claims none: the engine
      // has no delete dry run (`BatchOptions.validateOnly` was retired for
      // promising one), and running the delete inside a rolled-back transaction
      // would still fire `afterDelete` hooks, which do not wait for a commit.
      // So the delete rules are judged when the delete runs, and the confirmed
      // call answers them grouped by reason.
      server.registerTool(
        note(DELETE_RECORDS_TOOL),
        {
          description:
            'Delete many records of ONE object in one call: those a filter (where) matches, or an id list (recordIds) — '
            + 'instead of one delete_record per row. Destructive and permanent. A call without confirm: true deletes '
            + 'nothing: it is REFUSED (ACTION_CONFIRMATION_REQUIRED) with a `preview` of what a confirmed call would '
            + 'delete (how many match, sample ids). Show that to the human, and retry with confirm: true only once they '
            + `approve. A confirmed call deletes at most ${DELETE_RECORDS_MAX_PER_CALL} records (fewer when the `
            + 'deployment\'s read page size or row budget is smaller; the answer\'s cap says), each under your '
            + 'permissions, row-level security and the object\'s delete rules, which no caller can bypass. Records a '
            + 'rule refuses stay; the answer counts them grouped by reason with their ids, and says how many still match.',
          inputSchema: strictToolInput(
            {
              surface: 'this delete_records call',
              aliases: {
                ...OBJECT_NAME_ALIASES,
                filters: 'where',
                filter: 'where',
                conditions: 'where',
                criteria: 'where',
                ids: 'recordIds',
                record_ids: 'recordIds',
                recordId: 'recordIds',
              },
            },
            {
              objectName: z.string().describe('The object/table name'),
              where: z
                .record(z.string(), z.unknown())
                .optional()
                .describe(
                  'Filter conditions selecting the records to delete, as query_records takes them, e.g. '
                    + '{"status":"closed"}. {} selects every record you can see. Send this or recordIds, not both.',
                ),
              recordIds: z
                .array(z.string().min(1))
                .min(1)
                .max(DELETE_RECORDS_MAX_PER_CALL)
                .optional()
                .describe(
                  `The ids of the records to delete (at most ${DELETE_RECORDS_MAX_PER_CALL}). Send this or where, not both.`,
                ),
              // The confirmation member, as `delete_record` declares it: optional
              // in the schema so an unconfirmed call reaches the handler and is
              // answered with the gate's refusal and the preview.
              [AI_ACTION_CONFIRMATION_MEMBER]: z
                .boolean()
                .optional()
                .describe(
                  'Set to true only when the human in the loop has approved deleting the records this selection '
                    + 'matches. Without it nothing is deleted: the call answers a preview.',
                ),
            },
          ),
          annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        },
        async (args) => {
          const { objectName, where, recordIds } = args;
          const bad = guard(objectName);
          if (bad) return errorResult(bad);
          if ((where === undefined) === (recordIds === undefined)) {
            return errorResult(
              where === undefined
                ? 'delete_records needs a selection: send where (a filter, {} for every record) or recordIds (an id list).'
                : 'delete_records takes one selection: send where or recordIds, not both.',
            );
          }
          try {
            const cap = deleteRecordsCap();
            if (recordIds !== undefined && new Set(recordIds).size > cap) {
              // Before any read: the read of a longer list would be the read
              // window's own refusal, naming a `limit` this caller never sent.
              return errorResult(
                `delete_records takes at most ${cap} ids per call on this deployment (its read page size or row `
                  + `budget is ${cap}) — nothing was deleted. Send the list in parts of at most ${cap} ids.`,
              );
            }
            const resolved = await resolveDeleteSelection(bridge, objectName, { where, recordIds }, cap);
            // [ADR-0090 D10] A count a delegated read narrowed is served with the
            // narrowing stated, as `query_records` serves its rows. ⛔ The probe
            // never fails the call it annotates.
            const narrowing = typeof bridge.diagnoseDelegation === 'function'
              ? await bridge.diagnoseDelegation(objectName).catch(() => undefined)
              : undefined;
            const stated = (value: Record<string, unknown>): unknown =>
              narrowing?.narrowed && narrowing.statement ? withDelegationNotice(value, narrowing.statement) : value;
            if (!isDeleteConfirmed(args)) {
              const refusal = deleteConfirmationRefusal(
                DELETE_RECORDS_TOOL,
                objectName,
                deleteRecordsRefusalMessage(objectName, resolved),
              );
              return {
                content: [{
                  type: 'text' as const,
                  text: jsonText({ error: refusal, preview: stated(deleteRecordsPreview(objectName, resolved)) }),
                }],
                isError: true as const,
              };
            }
            const done = await deleteEach(bridge, objectName, resolved.attempt);
            const outcome = stated(deleteRecordsOutcome(objectName, resolved, done));
            if (done.fault) {
              const { fault } = done;
              const error = {
                ...(fault.code !== undefined ? { code: fault.code } : {}),
                message: deleteRecordsFaultMessage(objectName, { ...done, fault }),
                ...(fault.status !== undefined ? { status: fault.status } : {}),
              };
              return {
                content: [{ type: 'text' as const, text: jsonText({ error, progress: outcome }) }],
                isError: true as const,
              };
            }
            return textResult(outcome);
          } catch (err) {
            return errorResultWithCode(err);
          }
        },
      );
    }
  } // end canWrite (data:write)

  return registered;
}

/**
 * Register the business-action tool set (`list_actions`, `run_action`, and
 * `resume_run` when the bridge implements `resumeRun`) on an
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
  // [#15705] `resume_run` is registered only when the bridge can resume. The
  // same test decides whether `run_action`'s description mentions it.
  const canResume = typeof bridge.resumeRun === 'function';

  server.registerTool(
    note('list_actions'),
    {
      description:
        'List the business actions you can invoke in this app (e.g. "complete task", "convert lead"). ' +
        'Returns each action\'s name, the object it operates on, a description, whether it needs a record id, ' +
        'whether it is destructive, and its input parameters. Only actions the app author has exposed to AI ' +
        'and that the caller is permitted to run are returned. Use run_action to invoke one. An action that ' +
        'carries "unavailable" cannot be run with the credential you connected with: run_action would refuse ' +
        'it with unavailable.code, and unavailable.reason says why and what would let it run, so tell the ' +
        'user instead of calling it.',
      inputSchema: strictToolInput({ surface: 'this list_actions call' }, {}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      try {
        const actions = await bridge.listActions();
        const visible = allowSystem ? actions : actions.filter(isListableAction);
        return textResult({ actions: visible, totalCount: visible.length });
      } catch (err) {
        return errorResultWithCode(err);
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
        'send confirm: true — ask the human first, then retry; nothing runs on a refused call.' +
        // [#15705] Named only where `resume_run` is actually registered below,
        // so this description never points an agent at a tool it cannot call.
        (canResume
          ? ' A flow action can answer result.status "paused" with a runId and a screen (a form to fill ' +
            'in): the run has stopped to wait for that form, and resume_run submits its field values to ' +
            'continue it.'
          : ''),
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
      try {
        // [#27681] A `sys_*` action runs only where `list_actions` would list
        // it: the bridge's own listing is what attests the author's
        // `ai.exposed` (see `isListableAction`). A name with no `objectName`
        // is resolved by the bridge, whose runtime applies the same per-action
        // rule to the object it resolves.
        if (objectName && !allowSystem && isSystemObject(objectName)) {
          const listed = await bridge.listActions();
          const admitted = listed.some(
            (a) => a.name === actionName && a.objectName === objectName && isListableAction(a),
          );
          if (!admitted) {
            // [#30771] An exposed action the caller's declared gate refuses is
            // left out of the listing too: answer that gate's refusal, the one
            // the by-name call gets, not the system-object sentence. Nothing
            // runs either way.
            const refusal = await bridge.capabilityRefusal?.(actionName, objectName);
            if (refusal) return errorResultWithCode(Object.assign(new Error(refusal.message), refusal));
            return errorResult(systemObjectActionRefusal(actionName, objectName));
          }
        }
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
        return landedWriteResultOrError(err, objectName, errorResultFromThrown);
      }
    },
  );

  // [#15705] `resume_run`: the other half of a screen flow. `run_action` on a
  // flow whose screen still needs input answers `status: 'paused'` with a
  // `runId` and the `screen` to fill in. Before this tool, nothing on this
  // surface could submit that screen, so the run stayed parked and the agent
  // could start the action but never finish it.
  //
  // This tool owns the SHAPE only, like `run_action`. The bridge decides
  // whether the call is allowed, and it applies `run_action`'s own gates to the
  // run (see `McpActionBridge.resumeRun`). Registered in this family on
  // purpose: the same `actions:execute` scope grants both, and both transports
  // get it through `wireBridgeTools`, as they get `run_action`.
  if (canResume) {
    const resumeRun = bridge.resumeRun!.bind(bridge);
    server.registerTool(
      note('resume_run'),
      {
        description:
          'Continue a flow run that run_action (or an earlier resume_run) answered with result.status ' +
          '"paused" and a screen: submit the screen\'s field values, keyed by each screen.fields[].name. ' +
          'The run continues from that screen. The result has run_action\'s shape: the run completes, or ' +
          'pauses again on its NEXT screen with a new screen to fill (call resume_run again for it). Only ' +
          'the user whose call started the run can resume it, and it is gated exactly as run_action is ' +
          '(author AI opt-in, your capabilities, your read access to the record). The rest of the flow runs ' +
          'the app\'s business logic and can mutate data. When list_actions reports requiresConfirmation for ' +
          'the action that started the run, send confirm: true (ask the human first); without it the call ' +
          'is refused and the run stays paused.',
        inputSchema: strictToolInput(
          {
            surface: 'this resume_run call',
            // The spellings a caller who knows the REST resume door (`inputs`
            // / `variables`) or the other tools (`params`, `data`) reaches
            // for. Each is named in the refusal so the caller can resend with
            // `values`; none is accepted.
            aliases: {
              id: 'runId',
              run_id: 'runId',
              run: 'runId',
              inputs: 'values',
              variables: 'values',
              params: 'values',
              data: 'values',
              fields: 'values',
              answers: 'values',
            },
          },
          {
            runId: z
              .string()
              .describe('The runId from a result whose status is "paused" and that carries a screen.'),
            values: z
              .record(z.string(), z.unknown())
              .optional()
              .describe(
                'The screen\'s field values, keyed by field name (the names in screen.fields). Omit only when '
                + 'every field on the screen is optional.',
              ),
            // The confirmation member, keyed off the contract's constant exactly
            // as `run_action` declares it, for the same reason: a member this
            // shape did not declare would be refused, and the gate that asks
            // for it could never be satisfied.
            [AI_ACTION_CONFIRMATION_MEMBER]: z
              .boolean()
              .optional()
              .describe(
                'Set to true to confirm resuming a run of an action the app author gated with '
                + 'ai.requiresConfirmation (list_actions reports requiresConfirmation). Assert this only when '
                + 'the human in the loop has approved THIS call; without it the call is refused and the run '
                + 'stays paused.',
              ),
          },
        ),
        // The rest of the flow runs here, so this carries the same annotations
        // as `run_action`: the client should confirm before calling it.
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      },
      async (args) => {
        const { runId, values } = args;
        const confirm = args[AI_ACTION_CONFIRMATION_MEMBER];
        if (!runId || typeof runId !== 'string') {
          return errorResult('runId is required');
        }
        try {
          const result = await resumeRun(runId, {
            values,
            // Forwarded, never rebuilt without it: see `run_action` above.
            [AI_ACTION_CONFIRMATION_MEMBER]: confirm,
          });
          return textResult(result);
        } catch (err) {
          return errorResultFromThrown(err);
        }
      },
    );
  }

  return registered;
}

/**
 * [#30892] Register the file pair over {@link McpFileBridge}: `read_file`
 * (with `data:read`) reads a file a record carries, and `create_upload_link`
 * (with `data:write`) mints a single-use link through which the user uploads
 * a file onto a record. Each registers only where the bridge implements its
 * member, so a host that cannot reach a record's files serves neither.
 *
 * Neither tool judges access itself. The bridge reads the record as the
 * caller first (the `get_record` door), so a record the caller cannot read is
 * refused here with the code `get_record` answers; the storage service then
 * asks the download door's own verdict for the file, and the attach rule's
 * for a link. `sys_*` objects are refused as every object tool refuses them.
 */
export function registerFileTools(
  server: McpServer,
  bridge: McpFileBridge,
  options: RegisterObjectToolsOptions = {},
): string[] {
  const registered: string[] = [];
  const note = (name: string): string => {
    registered.push(name);
    return name;
  };
  const allowSystem = options.allowSystemObjects === true;
  const scopes = options.grantedScopes;
  const canRead = !scopes || scopes.includes(MCP_OAUTH_SCOPE_DATA_READ);
  const canWrite = !scopes || scopes.includes(MCP_OAUTH_SCOPE_DATA_WRITE);
  const guard = (objectName: string): string | undefined => {
    if (!objectName || typeof objectName !== 'string') return 'objectName is required';
    if (!allowSystem && isSystemObject(objectName)) {
      return `Object "${objectName}" is a system object and is not exposed via MCP`;
    }
    return undefined;
  };

  if (canRead && typeof bridge.readRecordFile === 'function') {
    const readFn = bridge.readRecordFile.bind(bridge);
    const listFn = typeof bridge.listRecordFiles === 'function' ? bridge.listRecordFiles.bind(bridge) : undefined;
    server.registerTool(
      note('read_file'),
      {
        description:
          'Read a file a record carries: one held by a file field (field, plus fileId when the field holds several) ' +
          'or one of its attachments (attachmentId). Answers the file\'s facts (name, type, size in bytes, the ' +
          `byte cap read_file reads, ${READ_FILE_MAX_BYTES}) with a short-lived download link, then its content: the ` +
          'text of a text file, a PDF or a Word (.docx) document, or the image itself. A larger file answers its ' +
          'facts and the link only. ' +
          (listFn
            ? 'Name neither field nor attachmentId to list the files on the record you can read, with their ids. '
            : '') +
          'You can read a file only where you can read its record: a record you cannot read answers as not found.',
        inputSchema: strictToolInput(
          {
            surface: 'this read_file call',
            aliases: {
              ...OBJECT_NAME_ALIASES,
              ...RECORD_ID_ALIASES,
              fieldName: 'field',
              field_name: 'field',
              file_id: 'fileId',
              attachment_id: 'attachmentId',
              attachment: 'attachmentId',
            },
          },
          {
            objectName: z.string().describe('The object/table name'),
            recordId: z.string().describe('The record id'),
            field: z.string().optional().describe('A file or image field of the record'),
            fileId: z
              .string()
              .optional()
              .describe('Which file, when the field holds several (a multi-file field); with field only'),
            attachmentId: z.string().optional().describe('One of the record\'s attachments, by its id'),
          },
        ),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, recordId, field, fileId, attachmentId }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        if (field !== undefined && attachmentId !== undefined) {
          return errorResult('Name one file: either field (with fileId for a multi-file field) or attachmentId, not both.');
        }
        if (fileId !== undefined && field === undefined) {
          return errorResult('fileId names a file within a field: send field with it.');
        }
        try {
          if (field === undefined && attachmentId === undefined) {
            if (!listFn) return errorResult('Name the file to read: field (a file field of the record) or attachmentId.');
            return textResult({ files: await listFn(objectName, recordId) });
          }
          const target = attachmentId !== undefined ? { attachmentId } : { field: field as string, ...(fileId !== undefined ? { fileId } : {}) };
          const file = await readFn(objectName, recordId, target, { maxBytes: READ_FILE_MAX_BYTES });
          return { content: await renderReadFile(file) };
        } catch (err) {
          return errorResultWithCode(err);
        }
      },
    );
  }

  if (canWrite && typeof bridge.createUploadLink === 'function') {
    const linkFn = bridge.createUploadLink.bind(bridge);
    server.registerTool(
      note('create_upload_link'),
      {
        description:
          'Create a link through which the user uploads one file onto a record: into a file field (field) or ' +
          'as an attachment (attachments: true). Give the link to the user to open in a browser where they are ' +
          'signed in to this deployment as themselves; it works only for them, once, for this record and field ' +
          'only, and expires (see expiresAt). The upload is stored as the user, so they must be able to edit the ' +
          'record (and the field).',
        inputSchema: strictToolInput(
          {
            surface: 'this create_upload_link call',
            aliases: {
              ...OBJECT_NAME_ALIASES,
              ...RECORD_ID_ALIASES,
              fieldName: 'field',
              field_name: 'field',
              attachment: 'attachments',
            },
          },
          {
            objectName: z.string().describe('The object/table name'),
            recordId: z.string().describe('The record id'),
            field: z.string().optional().describe('A file or image field of the record the upload fills'),
            attachments: z
              .literal(true)
              .optional()
              .describe('true to attach the upload to the record instead of filling a field'),
          },
        ),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ objectName, recordId, field, attachments }) => {
        const bad = guard(objectName);
        if (bad) return errorResult(bad);
        if ((field === undefined) === (attachments === undefined)) {
          return errorResult('Say where the upload lands: either field (a file field of the record) or attachments: true.');
        }
        try {
          const target = field !== undefined ? { field } : { attachments: true as const };
          const link = await linkFn(objectName, recordId, target);
          return textResult({
            url: link.url,
            expiresAt: link.expiresAt,
            singleUse: true,
            objectName,
            recordId,
            ...(field !== undefined ? { field } : { attachments: true }),
            instructions:
              'Give this link to the user to open in a browser where they are signed in to this deployment, and ' +
              'pick the file. It works only for them, once, until expiresAt.',
          });
        } catch (err) {
          return errorResultWithCode(err);
        }
      },
    );
  }

  return registered;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as any).message);
  return String(err);
}
