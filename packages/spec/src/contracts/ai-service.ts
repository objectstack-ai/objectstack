// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IAIService - AI Engine Service Contract
 *
 * Defines the interface for AI capabilities (NLQ, chat, suggestions, embeddings)
 * in ObjectStack. Concrete implementations (OpenAI, Anthropic, Ollama, etc.)
 * should implement this interface.
 *
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete AI/LLM provider implementations.
 *
 * Aligned with CoreServiceName 'ai' in core-services.zod.ts.
 *
 * ## Vercel AI SDK Alignment
 *
 * Message, tool-call, and streaming types are re-exported directly from the
 * Vercel AI SDK (`ai`) so that ObjectStack's wire protocol is fully aligned
 * with the ecosystem used by `@ai-sdk/react/useChat` on the frontend.
 *
 * - `ModelMessage` replaces the former custom `AIMessage`
 * - `ToolCallPart` replaces `AIToolCall`
 * - `ToolResultPart` replaces `AIToolResult`
 * - `TextStreamPart` replaces `AIStreamEvent`
 */

// ---------------------------------------------------------------------------
// Re-exports from Vercel AI SDK (canonical types)
// ---------------------------------------------------------------------------

export type {
    ModelMessage,
    SystemModelMessage,
    UserModelMessage,
    AssistantModelMessage,
    ToolModelMessage,
    ToolCallPart,
    ToolResultPart,
    TextStreamPart,
    ToolSet,
    FinishReason,
} from 'ai';

// ---------------------------------------------------------------------------
// Deprecated aliases — kept for backward compatibility
// ---------------------------------------------------------------------------

import type {
    ModelMessage,
    ToolCallPart,
    ToolResultPart,
    TextStreamPart,
    ToolSet,
} from 'ai';
import type { z } from 'zod';
import type { ExecutionContext } from '../kernel/execution-context.zod.js';
import type { EvalUser } from '../identity/eval-user.zod.js';

/**
 * @deprecated Use `ModelMessage` from `ai` instead.
 *
 * Previously a flat interface with `role`, `content: string`, `toolCalls?`,
 * and `toolCallId?`. The Vercel AI SDK uses a discriminated union where each
 * role has its own content type.
 */
export type AIMessage = ModelMessage;

/**
 * @deprecated Use `ToolCallPart` from `ai` instead.
 *
 * The Vercel type uses `toolCallId` / `toolName` / `input` rather than
 * `id` / `name` / `arguments`.
 */
export type AIToolCall = ToolCallPart;

/**
 * @deprecated Use `ToolResultPart` from `ai` instead.
 */
export type AIToolResult = ToolResultPart;

/**
 * @deprecated Use `AIMessage` directly — tool fields are now on the base type.
 */
export type AIMessageWithTools = ModelMessage;

/**
 * @deprecated Use `AIRequestOptions` directly — tool fields are now on the base type.
 */
export type AIRequestOptionsWithTools = AIRequestOptions;

/**
 * @deprecated Use `TextStreamPart<ToolSet>` from `ai` instead.
 *
 * The Vercel AI SDK uses a rich discriminated union for stream parts.
 */
export type AIStreamEvent = TextStreamPart<ToolSet>;

// ---------------------------------------------------------------------------
// ObjectStack-specific types (no Vercel equivalent)
// ---------------------------------------------------------------------------

/**
 * Options for AI completion/chat requests.
 *
 * Includes tool-related configuration so that tool calling works in both
 * streaming (`streamChat`) and non-streaming (`chat`) modes.
 */
export interface AIRequestOptions {
    /** Model identifier to use */
    model?: string;
    /** Sampling temperature (0-2) */
    temperature?: number;
    /** Maximum tokens to generate */
    maxTokens?: number;
    /** Stop sequences */
    stop?: string[];
    /** Tool definitions available to the model */
    tools?: AIToolDefinition[];
    /** How the model should use tools: 'auto', 'none', or a specific tool name */
    toolChoice?: 'auto' | 'none' | string;
}

/**
 * Result of an AI completion/chat request
 */
export interface AIResult {
    /** Generated text content */
    content: string;
    /** Model used for generation */
    model?: string;
    /** Tool calls requested by the model (present when the model invokes tools) */
    toolCalls?: ToolCallPart[];
    /** Token usage statistics */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    /**
     * Conversation id used for persistence. Echoed back when
     * `chatWithTools` auto-creates a conversation (caller omitted
     * `toolExecutionContext.conversationId` but supplied an actor).
     * Callers can use this to continue the same thread on subsequent
     * turns.
     */
    conversationId?: string;
}

// ---------------------------------------------------------------------------
// Tool Calling Protocol
// ---------------------------------------------------------------------------

/**
 * Definition of a tool that can be invoked by the AI model.
 *
 * This is an ObjectStack-specific simplified definition used by the
 * `IAIService` contract. For the full Vercel AI SDK tool definition,
 * use `Tool` from `ai`.
 */
export interface AIToolDefinition {
    /** Tool name (snake_case identifier) */
    name: string;
    /**
     * Human-readable display name. Optional for the LLM function-calling
     * path (which only needs name/description/parameters), but required
     * when the tool is registered as `tool` metadata for Studio — see
     * `ToolSchema`. Registration paths must supply a label (falling back
     * to a name-derived one) so persisted tool metadata passes validation.
     */
    label?: string;
    /** Human-readable description */
    description: string;
    /** JSON Schema describing the tool parameters */
    parameters: Record<string, unknown>;
    /**
     * Optional tool category. Carried by action-backed tools from
     * `action.ai.category` — the live source; the metadata `ToolSchema.category`
     * was removed in the #3896 close-out. Surfaced by tool-listing routes.
     * Not sent to the model.
     */
    category?: string;
    /**
     * Optional JSON Schema for the tool's return value. Action-backed tools
     * derive this from `action.ai.outputSchema` to enable downstream chaining.
     */
    outputSchema?: Record<string, unknown>;
    /** Object this tool operates on, when the tool is action-backed. */
    objectName?: string;
    /**
     * Whether invoking this tool requires human-in-the-loop confirmation.
     * Action-backed tools set this from the action's confirmation policy
     * (`action.ai.requiresConfirmation`, or the destructive-action default).
     */
    requiresConfirmation?: boolean;
}

// ---------------------------------------------------------------------------
// Action Confirmation Contract
// ---------------------------------------------------------------------------

/**
 * The member an AI-facing action call carries to state that the human in the
 * loop has confirmed it.
 *
 * ONE exported constant, because the member's SPELLING is the whole contract:
 * the door that refuses and the client that retries have to agree on it, and a
 * door hand-spelling its own `'confirm'` is precisely how two doors drift into
 * two dialects (Prime Directive #12). Every door that gates on the member reads
 * this, and the MCP `run_action` and `resume_run` tools key their REFUSAL of it
 * off this constant (below).
 *
 * It rides as a TOP-LEVEL member of the action request. The two request
 * shapes it is destined for are the MCP `run_action` tool input (`actionName`
 * / `objectName` / `recordId` / `params`, `packages/mcp/src/mcp-http-tools.ts`)
 * and the runtime action door's own request object — the `input` argument of
 * `invokeBusinessAction` (`objectName` / `recordId` / `params`,
 * `packages/runtime/src/action-execution.ts`), which the MCP bridge builds
 * that object from. Each grew the member in the change that enforced it. The
 * MCP tool input has since retired it (below). The runtime request keeps it
 * for the host door, which reads it; on the MCP bridge path the same request
 * type still accepts it but nothing reads it there (the amended contract asks
 * the person instead), and no MCP call can supply it, because the tool refuses
 * the member before the bridge is called. A third door
 * carries the same member
 * at the top level of its input: the MCP `delete_record` tool (see
 * {@link AIActionConfirmation}, "The second gate"). Two placements were
 * rejected, and the reasons are the contract:
 *
 * - NOT inside `params`. That bag is not a free surface: it is CLOSED against
 *   the action author's own declared input vocabulary. `enforceActionParams`
 *   (ADR-0104 D2, strict by default since 17.0) rejects any key that is
 *   neither a declared param nor one of the built-ins, so on an action that
 *   declares params at all a platform `confirm` riding there is REFUSED as an
 *   unknown action param — a 400 raised before the confirmation gate is ever
 *   reached, not merely a collision with a name the author might already have
 *   used. On a handler action declaring no params that check is a
 *   pass-through (a declarative `operation: 'update'` is the exception: its
 *   empty list is an empty accept set), so the same member would be silently
 *   accepted there instead: one placement,
 *   two opposite behaviours, which on its own disqualifies it for a safety
 *   member.
 * - NOT a transport header. A header is invisible to the tool schema an agent
 *   reads, so the model cannot discover the retry it is being told to make;
 *   and a header exists only at an HTTP edge, while the action door itself is
 *   a plain function handed a request object rather than a transport envelope
 *   — there is no header there for it to ride on. A free-form header would
 *   also be an OPEN channel, which is the one thing a safety member must not
 *   be.
 *
 * ## Amended: on a declared-gated action the member stops confirming
 *
 * The amended contract ({@link AI_ACTION_CONFIRMATION_CAPABILITY}) has a
 * person confirm an action declaring `ai.requiresConfirmation: true`, through
 * an elicitation or a hand-off to the app, and the member never counts on such
 * a call. The MCP `run_action` and `resume_run` tools implement it, and with
 * it the member is RETIRED from both tools' input: a call that carries it is
 * refused by the tool's closed input, before the call is resolved, on every
 * action, declared-gated or not. The refusal says that confirmation happens in
 * the app, by the person, and the caller resends without the member. A door
 * that has not implemented the amendment (a host door under the `ai` posture)
 * still gates on the member as described above and in
 * {@link AIActionConfirmation}. The MCP `delete_record` and `delete_records`
 * gates are outside the amendment and keep reading it.
 */
export const AI_ACTION_CONFIRMATION_MEMBER = 'confirm';

/**
 * The confirmation half of an AI-facing action request — a CLOSED boolean
 * member, declared once here and mixed into each door's own request shape
 * rather than restated by it.
 *
 * ## Amended: the member contract is the FROM half
 *
 * For an action declaring `ai.requiresConfirmation: true`, the contract is
 * now a person's confirmation ({@link AI_ACTION_CONFIRMATION_CAPABILITY}):
 * the server elicits it through the client, or hands the call to the host's
 * pending-confirmation service for the person to decide in the app, and the
 * caller's own `confirm` never counts. The MCP `run_action` and `resume_run`
 * tools implement the amendment and no longer accept the member at all: a call
 * that carries it is refused at the tool's input, on every action, and the
 * caller resends without it. What follows describes the member contract a
 * door enforces until it implements the amendment (a host door under the `ai`
 * posture), and the FROM half of the MCP tools' breaking note; the
 * predicate section (the DECLARED flag, never the listing heuristic) and the
 * AI service account rule carry over unchanged. The MCP `delete_record` and
 * `delete_records` gates are outside the amendment and keep reading the
 * member as described below.
 *
 * ## What the member means
 *
 * `confirm: true` asserts that the human in the loop has approved THIS call.
 * It is an attestation carried by the request, not a workflow: there is no
 * queue, no parking, no server-side approval record, and a refused call is
 * simply not executed. A caller acting for a person fixes the request and
 * retries; an AI service account cannot attest for itself (below).
 *
 * Absent, `false`, or any non-`true` value is NOT a confirmation. Executors
 * MUST treat only the boolean `true` as an attestation — a truthy string is a
 * transport artefact, not a decision.
 *
 * ## Which predicate gates the refusal — the DECLARED flag, never a heuristic
 *
 * An AI-facing action door MUST refuse a call when
 * `action.ai.requiresConfirmation === true` — the flag the action's AUTHOR
 * declared — and the request does not carry the confirmation member as `true`.
 *
 * One caller is refused whatever it sends (ADR-0151 D3 rule 3): an AI service
 * account (an agent principal acting for itself, with no `onBehalfOf`) does not
 * confirm an action for itself. For such a caller every action door refuses a
 * declared-gated action, REST `/actions` included, with the member and without
 * it; the member is not read, retrying cannot succeed, and a person runs the
 * action instead. Every other caller is gated by the member as below.
 *
 * The predicate is deliberately narrower than the one behind the
 * `requiresConfirmation` field of a tool/action LISTING (see
 * {@link AIToolDefinition.requiresConfirmation}). That field answers "should a
 * client ASK the human before calling?" and falls back to the runtime's
 * `actionLooksDestructive` heuristic (`packages/runtime/src/action-execution.ts`)
 * when the author declared nothing — the signals that heuristic reads are
 * named once, beside the authorable key in `ui/action.zod.ts`, and are not
 * restated here. This one answers "will the server REFUSE without an
 * attestation?", and an author who declared nothing has asked for nothing:
 * gating the refusal on the heuristic would start refusing calls that work
 * today, on a guess the author never made.
 *
 * So the two are not the same predicate and MUST NOT be collapsed:
 *
 * - listing `requiresConfirmation: true` + declared flag absent → the client
 *   is ADVISED to confirm; the door does not refuse.
 * - declared `ai.requiresConfirmation: true` → the door REFUSES without the
 *   member, and the listing reports `true` as well.
 * - declared `ai.requiresConfirmation: false` → no refusal, whatever the
 *   action looks like to that heuristic. An explicit `false` is the author
 *   asserting the action is safe unattended, and it overrides the heuristic in
 *   that direction too.
 *
 * The member is ACCEPTED on every AI-facing action call and only REQUIRED on
 * the declared-gated ones, so a client acting for a person (a person, or an
 * agent with `onBehalfOf`) that confirms with its human whenever a listing
 * says `requiresConfirmation: true` is always correct; an AI service account
 * is refused a declared-gated action whatever it sends. Inferring the opposite
 * — that a listing's `false` means no door will ever refuse — is sound only
 * because the listing's predicate is the wider of the two.
 *
 * ## The refusal
 *
 * A door that refuses answers 428 with `error.code` `ACTION_CONFIRMATION_REQUIRED`
 * (registered under `@objectstack/runtime` in `ERROR_CODE_LEDGER`) and
 * `error.details` shaped as {@link ActionConfirmationRequiredDetails}, which
 * names the action and the exact member to set. Nothing dispatches: the
 * action body does not run, no record is read or written, and the refusal
 * carries no `status`.
 *
 * ## The second gate: the MCP `delete_record` tool
 *
 * A record delete over MCP is permanent, so the same member gates it, by the
 * maintainer's decision, for every object and with no declared flag to
 * consult: `delete_record` (`packages/mcp/src/mcp-http-tools.ts`) refuses
 * EVERY call that does not carry the member as the boolean `true`, before
 * its data bridge is reached, so nothing is read or deleted. A non-boolean
 * member (the string `"true"`, `1`) is refused first by the tool's closed
 * input schema, with no code and no details, exactly as on `run_action`; an
 * absent or `false` member reaches the gate, and its refusal is the one above:
 * the same code and HTTP status, and `error.details` shaped as
 * {@link ActionConfirmationRequiredDetails}, whose `actionName` is the tool's
 * name, `delete_record`. A client that handles the action refusal confirms
 * with its human and retries the same call with the member set.
 *
 * The gate's bounds are part of the decision: REST `DELETE /api/v1/data/...`
 * (the human path) and the `update_record` tool stay outside it, no object is
 * exempt, and any future bulk-delete tool takes the same gate.
 *
 * ## The third gate: the MCP `delete_records` tool
 *
 * The bulk delete (#30891) takes that gate, with the same member, code, HTTP
 * status and `details` shape, whose `actionName` is `delete_records`. One
 * difference, and it is the tool's reason to exist: its unconfirmed call READS
 * the selection (a filter or an id list), as the caller, and answers the
 * refusal with a `preview` member beside `error` (how many records match, how
 * many a confirmed call attempts, sample ids), so the human approves a count
 * rather than a filter. Nothing is deleted. A confirmed call deletes each
 * selected record as `delete_record` does, under the caller's permissions and
 * the object's delete rules, which no caller bypasses.
 */
export interface AIActionConfirmation {
    /**
     * `true` when the human in the loop has approved this call. Only the
     * boolean `true` is an attestation; see the interface doc.
     */
    confirm?: boolean;
}

/**
 * The `error.details` payload of an `ACTION_CONFIRMATION_REQUIRED` refusal.
 *
 * Machine-readable on purpose, and the reason the refusal is a contract rather
 * than a message: an agent that has just been refused must be able to build
 * the retry WITHOUT re-parsing the prose it was handed. It gets back the
 * action it addressed and the member to set — so the fix is mechanical, and a
 * client never has to hard-code the member's spelling from documentation.
 */
export interface ActionConfirmationRequiredDetails {
    /**
     * The declarative action name the refused call addressed; on the MCP
     * `delete_record` and `delete_records` doors, the tool's own name.
     */
    actionName: string;
    /** The object the action operates on; omitted for object-less actions. */
    objectName?: string;
    /**
     * Always the value of {@link AI_ACTION_CONFIRMATION_MEMBER}, echoed so the
     * caller reads the member's spelling off the refusal instead of restating
     * it. What the caller does with it depends on the gate that refused:
     *
     * - A member gate (no `reason`: the MCP `delete_record` / `delete_records`
     *   gate, or a door before the amendment): a caller acting for a person
     *   sets it to `true` and retries, once its human approves.
     * - A refusal under the amended contract ({@link AI_ACTION_CONFIRMATION_CAPABILITY},
     *   `reason` set): the member confers nothing, and no retry with it runs
     *   the action; `reason` says what the caller can do. At the MCP
     *   `run_action` and `resume_run` tools the echo names the member those
     *   tools REFUSE at their input: the caller never sends it there, since
     *   the person confirms, in the client when it can be asked there and in
     *   the app otherwise.
     *
     * An AI service account's refusal carries it too, but no retry of that
     * account's succeeds: a person runs the action (ADR-0151 D3 rule 3).
     */
    confirmationMember: typeof AI_ACTION_CONFIRMATION_MEMBER;
    /**
     * Which case of the amended contract refused the call; see
     * {@link ActionConfirmationRefusalReason}. Every door implementing that
     * contract sets it on a declared-gated refusal, the AI service account's
     * included on every door. A refusal without it comes from a member gate:
     * a door before the implementing change, or the MCP `delete_record` /
     * `delete_records` gate.
     */
    reason?: ActionConfirmationRefusalReason;
}

// ---------------------------------------------------------------------------
// Action Confirmation by Elicitation or Hand-off — the amended contract
// ---------------------------------------------------------------------------

/**
 * The MCP client capability a person's in-client confirmation travels
 * through: `elicitation`, which an MCP client advertises in the
 * `capabilities` of its `initialize` request.
 *
 * ONE exported constant for the same reason {@link AI_ACTION_CONFIRMATION_MEMBER}
 * is one: the door that reads the capability and the client that advertises
 * it have to agree on its spelling.
 *
 * ## Why the contract was amended
 *
 * Under the member contract ({@link AIActionConfirmation}) the confirmation of
 * a declared-gated action is the caller's own `confirm: true`, an
 * unverifiable claim: the gate made FORGETTING loud and did not prove a
 * person. Measured on published 18.4.0, an agent sent `confirm: true` itself
 * on an irreversible action in 2 of 6 runs, reading the person's instruction
 * as consent. The account owner ruled the fix on objectstack-ai/cloud#3826
 * (「3826 照建议（征询版）」, phase 1, card 1 of its item-6 chain) and amended
 * it on the card that carries this contract (「我开始重新接受你说的主流方案，就是推送到客户的手机端」,
 * 「比如最简单的我可以先推送到邮件」): the server asks the person, in the
 * client when the client can be asked and in the app otherwise, and the
 * caller's own answer never counts.
 *
 * ## The contract
 *
 * 1. **Which calls.** A call on an action whose author declared
 *    `ai.requiresConfirmation: true` (the DECLARED flag, never the listing
 *    heuristic; {@link AIActionConfirmation} keeps that predicate), through
 *    EVERY AI door that starts one: the MCP `run_action` tool, the MCP
 *    `resume_run` tool for the candidate action it would run, and the in-app
 *    assistant's action tools (the actions-as-tools runtime of ADR-0011). Every
 *    caller acting for a person is covered, OAuth token, API key or a session
 *    to the app, a person or an agent acting for one (`onBehalfOf`). Rules 2
 *    to 4 below are the MCP doors' channel. The in-app door asks through its
 *    own channel, under "The in-app assistant door" below; rules 5 and 6 bind
 *    it as written.
 * 2. **When the person is asked.** After EVERY admission gate has passed,
 *    the subject load and the caller-scope subject verdict included, so
 *    nobody is asked to confirm a call that is refused anyway, and before
 *    anything dispatches. A call refused at confirmation, or never confirmed,
 *    may therefore have READ its subject under the caller's permissions; it
 *    writes nothing.
 * 3. **How the person is asked — three steps, in order.**
 *    1. **Elicit**, when the client advertised `elicitation` at `initialize`
 *       for the session the call rides on and the door can carry a request to
 *       it while the call is open. The server sends ONE MCP
 *       `elicitation/create` request in form mode, naming the action, the
 *       object and the record it runs on (its id, and its title when the
 *       subject load read one). An empty `elicitation: {}` reads as form mode
 *       (MCP 2025-11-25). The answer is the result's `action` alone; any
 *       `content` is not read.
 *    2. **Hand off**, otherwise: the door hands the call to the host's
 *       pending-confirmation service ({@link IActionConfirmationService}, the
 *       service registered under {@link ACTION_CONFIRMATION_SERVICE}) and
 *       answers the caller with {@link ActionConfirmationPending}: a pending
 *       id and a plain message that a confirmation was sent to the person.
 *       Nothing runs then. The host shows the pending item to the person in
 *       the app and notifies them (an emailed link, for example); the person
 *       signs in and approves or rejects it there. The person who approves or
 *       rejects is the person the call ran as (its `userId`, the person an
 *       agent acts for), and nobody else: another user who can see the item
 *       cannot decide it. When a pending item lapses,
 *       and how the caller learns its outcome, are the host's to define and
 *       outside this contract.
 *    3. **Refuse**, only when the host registers no service under
 *       {@link ACTION_CONFIRMATION_SERVICE}: reason
 *       `no_confirmation_service`. The message tells the person to use a
 *       client that supports confirmation, or to perform the action in the
 *       app.
 *    A door or a client that cannot elicit is never refused for that alone:
 *    it takes step 2, or step 3 when the host has no service. No step ever
 *    falls back to the member.
 * 4. **What each answer does.**
 *    - Elicited `accept`: the call dispatches as any admitted call does,
 *      exactly once, under the caller's permissions. The confirmation covers
 *      that one call: nothing is stored, and the next call is asked again.
 *      For a `resume_run` call the accept is bound to the screen the run was
 *      parked on when the person was asked: when the run has moved on to
 *      another screen meanwhile, the resume is refused `409
 *      RESOURCE_CONFLICT`, nothing resumes, and the run stays where it is.
 *    - Elicited `decline`: the person said no. Refused, reason `declined`;
 *      nothing runs. The caller does not retry unless the person asks again.
 *    - Elicited `cancel`: the person dismissed the question without choosing.
 *      Refused, reason `cancelled`; nothing runs. An error answer to the
 *      elicitation request, or a connection that drops before an answer, is
 *      read the same way.
 *    - Elicitation timed out: no answer within the door's bound, which the
 *      implementing door names. Refused, reason `timed_out`; nothing runs,
 *      and an answer that arrives later runs nothing.
 *    - Handed off, then approved in the app: the action runs as the person
 *      who approved it, through the same admitted sequence, every gate and
 *      permission re-checked at that moment; a refusal there runs nothing and
 *      is recorded on the pending item. A handed-off `resume_run` call
 *      carries its run ({@link ActionConfirmationHandOff.run}): approving it
 *      resumes THAT parked run with the values the call carried, as the
 *      approver, who must be the run's owner as today; it never starts a new
 *      run of the flow. The approval is bound to the screen the run was
 *      parked on when the call was handed off (the run's `screenNodeId`):
 *      when the host passes that screen back and the run has moved on to
 *      another one, the resume is refused and the run stays where it is.
 *    - Handed off, then rejected in the app: nothing runs.
 *    The approve and reject doors of the pending-confirmation service take a
 *    person's signed-in session to the app and nothing else. They refuse an
 *    AI identity: an agent principal (`principalKind: 'agent'`, with or
 *    without `onBehalfOf`), and any call that arrives through an AI door. They
 *    also refuse an API key, a delegated or OAuth token and any other service
 *    credential, whoever it resolves to: a person's own API key resolves as
 *    that person, and is refused there all the same. A person decides; an
 *    agent, a script or a credential never decides for one.
 * 5. **The caller's `confirm` never counts.** On a declared-gated call the
 *    member ({@link AI_ACTION_CONFIRMATION_MEMBER}) confers nothing: not with
 *    an elicitation, not in place of one, not in place of a hand-off, and not
 *    when the host has no service. The MCP `run_action` and `resume_run`
 *    tools do not accept it at all: a call carrying it is refused at the
 *    tool's input, on every action, gated or not, because the person
 *    confirms (elicited in the client where it can be asked, in the app
 *    otherwise); the caller resends without it.
 * 6. **An AI service account: unchanged** (ADR-0151 D3 rule 3). An agent
 *    principal acting for itself, with no `onBehalfOf`, is refused whatever it
 *    sends, reason `service_account`. It is neither elicited (no person stands
 *    behind the account, and its own client could answer) nor handed off. The
 *    one admitted sequence asks this rule at every door that runs an action,
 *    so REST `/actions` and a host door carry the same `reason` on that
 *    refusal.
 *
 * Every refusal keeps the registered envelope: `428`,
 * `ACTION_CONFIRMATION_REQUIRED`, and `error.details` shaped as
 * {@link ActionConfirmationRequiredDetails}, whose `reason` says which case
 * above it is. A hand-off is not a refusal: it is the successful answer
 * {@link ActionConfirmationPending}.
 *
 * ## The in-app assistant door: the same rule, its own channel
 *
 * Ruled on #33689 (record 6893484458, 「B 同一规则，两套流程暂留」): the rule
 * binds every AI door, the in-app assistant included, and the in-app door
 * keeps its own channel. Merging the two channels was not ruled.
 *
 * The in-app assistant asks through the pending-action queue of
 * {@link IAIService}: the call is recorded as a pending action
 * ({@link IAIService.proposePendingAction}), the tool answers the model
 * `pending_approval`, and the person is shown the item as an inline
 * pending-approval card in the conversation and in the inbox. Nothing runs
 * until the item is decided. When that channel is not wired (no AI service
 * that records pending actions, or the host has not turned the queue on),
 * the door does not offer a declared-gated action as a tool at all: it is
 * neither run unconfirmed nor offered and then refused. Three points bind the
 * in-app door, the same three that bind a hand-off:
 *
 * 1. **Who decides.** Only the person the call ran as (the conversation's
 *    user, the person an agent acts for) approves or rejects the item. Holding
 *    `ai:approve`, or any other permission, does not let another user decide
 *    it. A host that wants a second person to approve the write uses the
 *    existing `held` outcome of {@link IAIService.approvePendingAction}: the
 *    person approves, and the write waits on the approvals engine.
 * 2. **Which credential.** The approve and reject doors take a person's
 *    signed-in session to the app and nothing else, exactly as the
 *    pending-confirmation service's doors do (rule 4): an API key, a delegated
 *    or OAuth token and any other service credential are refused, whoever it
 *    resolves to, and so is an AI identity (an agent principal, with or
 *    without `onBehalfOf`, and any call that arrives through an AI door).
 * 3. **As whom it runs.** An approved item runs as that person, never as a
 *    synthetic AI principal, through the same admitted sequence as any action
 *    call, every gate and permission re-checked at the moment of approval. A
 *    refusal there runs nothing and is recorded on the item as `failed`.
 *
 * The three points bind EVERY item in the in-app queue, whichever trigger
 * queued it: an action declaring `ai.requiresConfirmation: true`, or one the
 * destructive heuristic gates (ADR-0011's confirmation table). A pending row
 * does not record why it was queued, and the queue has one decider rule; an
 * administrator who is to approve as well does so through `held`, never by
 * deciding the person's item.
 *
 * Neither the model's own confirmation nor the caller's `confirm` counts
 * (rule 5): the item waits for the person. An approval proves what an approved
 * hand-off proves, that a signed-in session to the app answered.
 *
 * ## What an answer proves
 *
 * An elicited `accept` proves that the CLIENT answered, not that a person
 * did. The amendment closes the measured hole, an agent model answering for
 * the person inside a client that would have asked its user; a caller that
 * writes its own client can advertise `elicitation` and answer `accept`
 * itself, bounded by its credentials as before.
 *
 * An approval of a hand-off proves that a signed-in session to the app
 * answered, not that a person did: the approve and reject doors refuse every
 * credential but a person's session, so a caller holding only the person's
 * API key or token cannot approve its own hand-off, and one that holds the
 * person's session (their password, or a browser they are signed in to) can,
 * bounded by that session as any action in the app is. Each answer is as
 * strong as what it takes to give it; neither proves a human.
 *
 * ## Its bounds
 *
 * - The MCP `delete_record` and `delete_records` gates are not declared-gated
 *   actions: they read the member, as {@link AIActionConfirmation} describes,
 *   until a decision moves them.
 * - REST `/actions` stays outside the gate for a person, as before.
 * - The in-app door's pending-action queue and the pending-confirmation
 *   service ({@link IActionConfirmationService}) stay two seams; the rule
 *   that binds them is one.
 *
 * ## When it binds
 *
 * This text is the contract from the release that carries it. The doors
 * implement it in the change that enforces it, which also moves the shipped
 * prescriptions that describe the member. Until a door's change ships, it
 * still gates on the member as {@link AIActionConfirmation} describes. The
 * MCP `run_action` and `resume_run` tools ran a declared-gated action on
 * `confirm: true` until theirs, over stdio and over Streamable HTTP alike, and
 * that reading is the FROM half of their breaking note; the release that
 * ships their hand-off also retires the member from their input, so a call
 * that carries it is refused there. The in-app door likewise runs
 * ADR-0011's queue as documented until its implementing change ships: any
 * holder of `ai:approve` may decide an item, the approve and reject doors take
 * whatever credential they authenticate, and an approved item is re-dispatched
 * through the pre-registered dispatcher of ADR-0011's invocation flow. That
 * reading is the FROM half for the in-app door's three points.
 *
 * Measured at the amendment: the long-lived stdio server keeps the client's
 * `initialize` capabilities and can send a request to the client while a call
 * is open. The Streamable HTTP door (`handleHttpRequest` in
 * `packages/mcp/src/mcp-server-runtime.ts`) builds a fresh server per request,
 * issues no session id and answers in JSON, so as built it can do neither:
 * under step 2 its callers are handed off. Whether, and how, that door comes
 * to elicit is the implementing change's decision.
 */
export const AI_ACTION_CONFIRMATION_CAPABILITY = 'elicitation';

/**
 * Why a declared-gated call was refused under the amended contract
 * ({@link AI_ACTION_CONFIRMATION_CAPABILITY}), carried as
 * {@link ActionConfirmationRequiredDetails.reason}. A CLOSED set; a hand-off is
 * not among them, because it is not a refusal:
 *
 * - `declined`: the person answered an elicitation with no.
 * - `cancelled`: the person dismissed the elicitation, the client answered it
 *   with an error, or the connection dropped first.
 * - `timed_out`: no answer to the elicitation within the door's bound.
 * - `no_confirmation_service`: the client could not be elicited and the host
 *   registers no pending-confirmation service ({@link IActionConfirmationService})
 *   under {@link ACTION_CONFIRMATION_SERVICE}.
 *   The person uses a client that supports confirmation, or performs the
 *   action in the app.
 * - `service_account`: an AI service account, which never confirms an action
 *   for itself (ADR-0151 D3 rule 3). A person runs the action.
 */
export const ACTION_CONFIRMATION_REFUSAL_REASONS = [
    'declined',
    'cancelled',
    'timed_out',
    'no_confirmation_service',
    'service_account',
] as const;

/** One member of {@link ACTION_CONFIRMATION_REFUSAL_REASONS}. */
export type ActionConfirmationRefusalReason = (typeof ACTION_CONFIRMATION_REFUSAL_REASONS)[number];

/**
 * The call an AI door hands to the host's pending-confirmation service (step 2
 * of {@link AI_ACTION_CONFIRMATION_CAPABILITY}): enough to show the person what
 * they are asked to approve, and to run it again, as them, once they do.
 */
export interface ActionConfirmationHandOff {
    /** The declarative action name the call addressed. */
    actionName: string;
    /** The object the action operates on; omitted for object-less actions. */
    objectName?: string;
    /** The package namespace the call qualified the action with, if any. */
    namespace?: string;
    /** The record the action runs on, when it takes one. */
    recordId?: string;
    /** The action params the call carried, after the door's own checks. */
    params: Record<string, unknown>;
    /** The AI door the call arrived through, e.g. `mcp`. */
    door: string;
    /**
     * The parked run a `resume_run` call continues: present exactly when the
     * call is a `resume_run`, absent for `run_action`. Approval resumes this
     * run with `values`, as the approver, who must be the run's owner; it
     * never starts a new run, and `params` is then empty.
     */
    run?: {
        /** The paused run the call resumes. */
        runId: string;
        /** The screen's field values the call carried. */
        values: Record<string, unknown>;
        /**
         * The screen the run was parked on when the call was handed off: its
         * `nodeId` (`ScreenSpec.nodeId`, `./automation-service`), the screen
         * `values` were given for. Absent when the engine named no node for
         * it. A host that stores it and passes it back on approval
         * (`ActionResumeRequest.screenNodeId`, `@objectstack/runtime`) binds
         * the approval to that screen: a run that has moved on to another
         * screen (a wizard the person advanced in the app, or a second
         * approval of the same call) is refused, and nothing resumes.
         */
        screenNodeId?: string;
    };
}

/**
 * The answer an AI door gives the caller when it hands a declared-gated call
 * off (step 2 of {@link AI_ACTION_CONFIRMATION_CAPABILITY}). A success, not a
 * refusal: the call was accepted for a person's decision, and nothing has run.
 */
export interface ActionConfirmationPending {
    /** The discriminant: the call waits on a person's confirmation in the app. */
    status: 'pending_confirmation';
    /** The pending item's id in the host's pending-confirmation service. */
    pendingId: string;
    /** A plain message for the person: a confirmation was sent to them, and where to answer it. */
    message: string;
    /** The declarative action name the call addressed. */
    actionName: string;
    /** The object the action operates on; omitted for object-less actions. */
    objectName?: string;
}

/**
 * The service slot a {@link IActionConfirmationService} is registered under
 * (step 2 of {@link AI_ACTION_CONFIRMATION_CAPABILITY}). The open build ships
 * none; with none registered, a door that cannot elicit refuses, reason
 * `no_confirmation_service` (step 3).
 */
export const ACTION_CONFIRMATION_SERVICE = 'ai.actionConfirmation';

/**
 * The host's pending-confirmation service: the hand-off seam of the amended
 * contract ({@link AI_ACTION_CONFIRMATION_CAPABILITY}, step 2), registered
 * under {@link ACTION_CONFIRMATION_SERVICE}. OPTIONAL — a host without one
 * refuses, reason `no_confirmation_service` (step 3), which is the case of a
 * bare open-source deployment.
 *
 * The service owns what happens after the hand-off: it stores the pending
 * item, shows it to the person the call ran as in the app and notifies them,
 * and serves the approve and reject doors. Only that person decides the item.
 * Those doors take a person's signed-in session and nothing else: they refuse
 * an AI identity (an agent principal, with or without `onBehalfOf`, and any
 * call through an AI door) and an API key, token or other service credential,
 * whoever it resolves to. On approval the action runs as the approving person
 * through the same admitted sequence, every gate and permission re-checked; a
 * hand-off that carries a run ({@link ActionConfirmationHandOff.run}) resumes
 * that run instead of starting one. On rejection nothing runs. When an item
 * lapses, and how the caller learns its outcome, are the host's to define.
 *
 * The approval leg runs through the framework's host doors, so a host keeps
 * no copy of the admission rules (`@objectstack/runtime`):
 * `dispatchAction(kernel, { …, posture: 'ai', confirm: true })` runs a
 * handed-off `run_action` as the approving person, and
 * `dispatchActionResume(kernel, { executionContext, runId, values, confirm:
 * true })` resumes the run a handed-off `resume_run` carries
 * ({@link ActionConfirmationHandOff.run}) as that person, asking every
 * `resume_run` gate again: a run no longer paused, or one another person
 * started, is refused. A wizard the first approval moved on to its next
 * screen is still paused under the same run id, so the host passes back the
 * screen the call was handed off on (`run.screenNodeId`, as `screenNodeId`):
 * a run no longer on that screen is refused, `409 RESOURCE_CONFLICT`, and
 * stays where it is. Without it, a second call with the same hand-off
 * resumes whatever screen the run is on with the values given. Deciding a
 * pending item once is the host's.
 *
 * A host may build it over its own pending-action store; the
 * `held` outcome of {@link IAIService.approvePendingAction} is the existing
 * precedent for a write that waits on a person outside the conversation.
 */
export interface IActionConfirmationService {
    /**
     * Record `handOff` for the person the caller acts for, notify them, and
     * return the pending item's id. Runs nothing.
     *
     * @param handOff - The call to confirm
     * @param context - The caller's execution context: who is asked, and as
     *                whose call the item is recorded
     */
    submit(handOff: ActionConfirmationHandOff, context: ExecutionContext): Promise<{ pendingId: string }>;
}

// ---------------------------------------------------------------------------
// The AI-route caller — `req.user` on an AI route handler
// ---------------------------------------------------------------------------

/**
 * Which credential admitted the caller of an AI route, as
 * {@link AIRouteUser.credential} carries it. One vocabulary: the runtime's
 * environment-membership gate and its api-action forward read the same three
 * values.
 *
 * - `session`: a person's signed-in session to the app, whichever carrier
 *   brought its token: the session cookie, or an `Authorization: Bearer`
 *   header (the same session, read by the same session read; a client on a
 *   split-origin deployment, where the cookie does not flow, sends it that
 *   way). Ruled on #34184 (record 6942875153), Q1 A.
 * - `api_key`: an API key, in any spelling the key header accepts.
 * - `oauth`: an OAuth access token (honoured on the MCP endpoint alone), or
 *   the credential the server mints to forward an OAuth-connected agent's call
 *   in process; both resolve to an agent principal carrying the token's
 *   scopes.
 */
export type AIRouteCredentialKind = 'session' | 'api_key' | 'oauth';

/**
 * The caller an AI route handler receives as `req.user`: the route table the
 * AI service registers (`buildAIRoutes`) is dispatched with
 * `{ body, params, query, headers, user }`, and `user` is this shape, or
 * absent for an anonymous caller (reachable only on a route that declares
 * `auth: false`).
 *
 * The identity core is an `EvalUser` (ADR-0068 D1), extended with the keys
 * every dispatch path that hands a user to customer code publishes: the
 * id and display-name aliases and the two authority channels, which are never
 * merged. Two facts are the AI route's own, so that a door reserved to the
 * person (an approval only the person the call ran as may give) can tell who
 * is acting and how they came in, without reading request headers:
 * {@link AIRouteUser.impersonatedBy} and {@link AIRouteUser.credential}.
 */
export interface AIRouteUser extends EvalUser {
    /** The acting user's id (`sys_user.id`). */
    id: string;
    /** Alias of {@link AIRouteUser.id}. */
    userId: string;
    /** The display name (`sys_user.name`); the id when none resolves. */
    name: string;
    /** Alias of {@link AIRouteUser.name}. */
    displayName: string;
    /** ADR-0090 position names held by the caller. */
    positions: string[];
    /** Permission-SET names (`admin_full_access`, `ai_seat`, …). */
    permissions: string[];
    /** CAPABILITIES (`manage_metadata`, `studio.access`, …): a separate channel. */
    systemPermissions: string[];
    /**
     * The administrator (a `sys_user` id) who started the impersonation session
     * this request runs in: `ExecutionContext.impersonatedBy`, carried as is.
     * Absent on every other request; absence means the user in
     * {@link AIRouteUser.id} is acting themselves. {@link AIRouteUser.id} stays
     * the impersonated user.
     *
     * A fact a door may use to refuse an act reserved to the person (ruled on
     * #34184, record 6942875153, Q2 A). It is never the authorization subject, and no platform
     * middleware reads it; what it decides is the consuming door's.
     */
    impersonatedBy?: string;
    /**
     * Which credential admitted this caller; see {@link AIRouteCredentialKind}.
     * Absent when the request recorded none (a host that hands the dispatcher
     * an execution context without running its identity step). A door reserved
     * to a person's signed-in session reads anything but `'session'`, absence
     * included, as not that session.
     */
    credential?: AIRouteCredentialKind;
}

// ---------------------------------------------------------------------------
// IAIService
// ---------------------------------------------------------------------------

export interface IAIService {
    /**
     * Generate a chat completion from a conversation.
     *
     * Accepts Vercel AI SDK `ModelMessage[]` for full ecosystem alignment.
     *
     * @param messages - Array of conversation messages (Vercel `ModelMessage`)
     * @param options - Optional request configuration
     * @returns AI-generated response
     */
    chat(messages: ModelMessage[], options?: AIRequestOptions): Promise<AIResult>;

    /**
     * Generate a text completion from a prompt
     * @param prompt - Input prompt string
     * @param options - Optional request configuration
     * @returns AI-generated response
     */
    complete(prompt: string, options?: AIRequestOptions): Promise<AIResult>;

    /**
     * Generate embeddings for a text input
     * @param input - Text or array of texts to embed
     * @param model - Optional embedding model identifier
     * @returns Array of embedding vectors
     */
    embed?(input: string | string[], model?: string): Promise<number[][]>;

    /**
     * List available models
     * @returns Array of model identifiers
     */
    listModels?(): Promise<string[]>;

    /**
     * Stream a chat completion as an async iterable of Vercel AI SDK stream parts.
     *
     * @param messages - Array of conversation messages (Vercel `ModelMessage`)
     * @param options - Optional request configuration (supports tool definitions)
     * @returns Async iterable of `TextStreamPart` events
     */
    streamChat?(messages: ModelMessage[], options?: AIRequestOptions): AsyncIterable<TextStreamPart<ToolSet>>;

    /**
     * Generate a strongly-typed object that conforms to a Zod schema.
     *
     * Implementations should leverage native structured-output features
     * (OpenAI JSON mode / Responses API, Anthropic tool use, Gemini schema)
     * when available. The result `object` is guaranteed to validate against
     * the schema.
     *
     * Optional — adapters that do not support structured output should
     * either throw or omit this method.
     *
     * @example
     * ```ts
     * const Schema = z.object({ name: z.string(), priority: z.number().int() });
     * const { object } = await ai.generateObject(messages, Schema);
     * // object is typed as { name: string; priority: number }
     * ```
     */
    generateObject?<T>(
        messages: ModelMessage[],
        schema: z.ZodType<T>,
        options?: GenerateObjectOptions,
    ): Promise<AIObjectResult<T>>;

    /**
     * Chat with automatic tool call resolution.
     *
     * Sends messages to the LLM with tool definitions, automatically
     * executes any returned tool calls, feeds the results back, and
     * repeats until the model returns a final text response or the
     * maximum number of iterations is reached.
     *
     * @param messages - Conversation messages (Vercel `ModelMessage`)
     * @param options  - Request options (tools are auto-injected from the registry)
     * @returns Final AI result after all tool calls have been resolved
     */
    chatWithTools?(messages: ModelMessage[], options?: ChatWithToolsOptions): Promise<AIResult>;

    /**
     * Persist a proposed AI-initiated action that requires human approval
     * before execution. Used by the actions-as-tools runtime when the
     * picked action is dangerous (delete / danger variant / has
     * `confirmText`) or declares `ai.requiresConfirmation: true`, and
     * `enableActionApproval` is on.
     *
     * Implementations write a row to `ai_pending_actions` and return
     * its id. The caller (the tool handler) immediately returns a
     * `{ status: 'pending_approval' }` envelope to the LLM.
     *
     * This is the in-app assistant door's channel of the confirmation rule
     * ({@link AI_ACTION_CONFIRMATION_CAPABILITY}, "The in-app assistant
     * door"), and its three points bind the item from the moment it is
     * recorded:
     *
     * 1. **Who decides:** only the person the call ran as, recorded as
     *    `proposedBy`; no other user decides it, whatever permission they
     *    hold, `ai:approve` included.
     * 2. **Which credential:** the item is decided on that person's signed-in
     *    session to the app, never on an API key, token or AI identity.
     * 3. **As whom it runs:** once approved, as that person, every gate and
     *    permission re-checked.
     */
    proposePendingAction?(input: ProposePendingActionInput): Promise<{ id: string }>;

    /**
     * Approve a previously-proposed pending action and re-dispatch it
     * via the same handler that would have run had approval not been
     * required. Updates the row to `executed` (or `failed`) and returns
     * the outcome.
     *
     * The three points of the in-app assistant door
     * ({@link AI_ACTION_CONFIRMATION_CAPABILITY}) bind it:
     *
     * 1. **Who decides:** `actorId` must be the person the call ran as (the
     *    row's `proposed_by`). Another user is refused whatever permission
     *    they hold, `ai:approve` included, and the row stays `pending`.
     * 2. **Which credential:** the door that calls this member admits only a
     *    person's signed-in session to the app; an API key, a delegated or
     *    OAuth token, any other service credential and an AI identity are
     *    refused before it is called, whoever they resolve to.
     * 3. **As whom it runs:** the re-dispatch runs as that person, through
     *    the same admitted sequence as any action call, every gate and
     *    permission re-checked at this moment. A refusal there runs nothing
     *    and the row is `failed`.
     *
     * A host that wants a second person to approve the write does not let
     * that person decide the item: it uses `held`, below.
     *
     * `held` is the third outcome: the confirmation was accepted, and the
     * write waits on an approval outside the conversation, because a host
     * policy held it for a human approver. Nothing has been written yet,
     * so the row is `held`, never `executed`; `result` carries whatever the
     * host returned about the hold. The host that held the action moves it
     * on: when that approval resolves, it writes the row's final state
     * (`executed`, `rejected` or `failed`). This service does not.
     */
    approvePendingAction?(
        id: string,
        actorId: string,
    ): Promise<{ status: 'executed' | 'held' | 'failed'; result?: unknown; error?: string }>;

    /**
     * Reject a pending action. The row transitions to `rejected` and the
     * optional `reason` is stored so the next LLM turn can surface it.
     * Nothing runs.
     *
     * The deciding points of the in-app assistant door
     * ({@link AI_ACTION_CONFIRMATION_CAPABILITY}) bind it as they bind
     * {@link IAIService.approvePendingAction}: `actorId` must be the person
     * the call ran as (the row's `proposed_by`), whatever permission another
     * user holds, `ai:approve` included; and the door that calls this member
     * admits only that person's signed-in session to the app, never an API
     * key, token or AI identity.
     */
    rejectPendingAction?(id: string, actorId: string, reason?: string): Promise<void>;

    /**
     * Inbox query: list pending (or filtered) action proposals. Used by
     * Studio's pending-actions view.
     *
     * @param filter - Status, conversation, object and row-count filters
     * @param context - The caller's execution context, the trailing
     *                parameter the other store contracts take. When it is
     *                supplied, the implementation passes it unchanged as the
     *                `context` of the engine read it makes
     *                (`BaseEngineOptions.context`), so the read runs as that
     *                caller: under ADR-0096 D5 strict mode an engine read
     *                with no principal is refused with 403, so without it an
     *                implementation can only read as system. When it is
     *                omitted, the read is the one the implementation made
     *                before this parameter existed. Whether a caller is
     *                admitted to the rows depends on the stored object's
     *                access and sharing, which this contract does not declare.
     */
    listPendingActions?(
        filter?: {
            status?: PendingActionStatus | PendingActionStatus[];
            conversationId?: string;
            objectName?: string;
            limit?: number;
        },
        context?: ExecutionContext,
    ): Promise<PendingActionRow[]>;
}

/**
 * Lifecycle of a pending action proposal.
 *
 * `held`: the confirmation was accepted, and the write waits on an approval
 * outside the conversation. It is not a final state; the host that held it
 * writes `executed`, `rejected` or `failed` when that approval resolves
 * (see {@link IAIService.approvePendingAction}).
 */
export type PendingActionStatus = 'pending' | 'approved' | 'held' | 'executed' | 'failed' | 'rejected';

/** Input for {@link IAIService.proposePendingAction}. */
export interface ProposePendingActionInput {
    objectName: string;
    actionName: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    conversationId?: string;
    messageId?: string;
    proposedBy?: string;
}

/** Stored row shape returned by {@link IAIService.listPendingActions}. */
export interface PendingActionRow {
    id: string;
    object_name: string;
    action_name: string;
    tool_name: string;
    tool_input: string;
    status: PendingActionStatus;
    result?: string;
    error?: string;
    rejection_reason?: string;
    conversation_id?: string;
    message_id?: string;
    proposed_by?: string;
    decided_by?: string;
    proposed_at: string;
    decided_at?: string;
}

/**
 * Options for the `chatWithTools()` tool call loop.
 */
export interface ChatWithToolsOptions extends AIRequestOptions {
    /** Maximum number of tool call loop iterations (default: 10) */
    maxIterations?: number;
    /**
     * Optional callback invoked when a tool execution fails.
     *
     * Receives the tool call that failed and the error message.
     * Return `'continue'` (default) to feed the error back to the model,
     * or `'abort'` to immediately stop the tool call loop.
     */
    onToolError?: (toolCall: ToolCallPart, error: string) => 'continue' | 'abort';
    /**
     * Per-call execution context threaded into every tool handler the
     * loop dispatches. The HTTP route MUST populate this from
     * `req.user` (and any conversation/environment headers) so that
     * built-in data tools forward the actor into ObjectQL's
     * `ExecutionContext` and row-level security automatically scopes
     * what the LLM can see or change.
     *
     * Optional at the type level only — a missing context is NOT a
     * grant of authority (#2991). When omitted, executors MUST run
     * data-touching tools as an unauthenticated (RLS-on, sees-nothing)
     * principal, exactly as if an empty context had been passed; they
     * MUST NOT fall back to system-level behaviour. Trusted internal
     * callers (cron, migrations, server jobs) that genuinely need full
     * authority opt in explicitly via
     * {@link ToolExecutionContext.isSystem}.
     */
    toolExecutionContext?: ToolExecutionContext;
}

/**
 * Per-call execution context threaded into every tool handler invoked
 * by {@link ChatWithToolsOptions}. Mirrors {@link ExecutionContext}
 * but is tailored to the AI tool boundary (no transaction handle, no
 * raw access token — those live on the engine call site).
 *
 * ## Identity semantics (fail-closed, #2991)
 *
 * "No identity" is never a grant of authority. Executors MUST derive
 * the ObjectQL `ExecutionContext` for data-touching tools as:
 *
 * - `actor` present → that user's context (RLS scopes reads/writes).
 * - `isSystem: true` → system context (RLS bypass) — an explicit,
 *   greppable elevation, same convention as `IDataEngine` /
 *   `IKnowledgeService`.
 * - neither → an anonymous, unauthenticated context (RLS on, sees
 *   nothing). NEVER system.
 */
export interface ToolExecutionContext {
    /**
     * Authenticated end user on whose behalf the LLM is acting.
     * Built-in tools promote this into the ObjectQL `ExecutionContext`
     * so RLS engages.
     *
     * A missing actor means an UNAUTHENTICATED caller (#2991):
     * executors MUST run data-touching tools with an anonymous
     * (RLS-on, sees-nothing) context — never as system. System
     * execution is only ever the explicit {@link isSystem} opt-in,
     * not the consequence of a forgotten field.
     */
    actor?: {
        id: string;
        name?: string;
        positions?: string[];
        permissions?: string[];
    };
    /**
     * Explicit, deliberate elevation: run tool handlers with a
     * system-level (RLS-bypassing) `ExecutionContext` — the same
     * convention as `IDataEngine` / `IKnowledgeService`
     * (`isSystem: true`). Reserved for trusted server-side invocations
     * (cron, migrations, internal jobs); MUST be set by trusted server
     * code only, never derived from request input, and ignored when an
     * {@link actor} is present. This flag is the ONLY way to obtain
     * system behaviour from the tool loop — a merely absent actor
     * fails closed to anonymous instead (#2991).
     */
    isSystem?: boolean;
    /** Conversation id for trace/HITL correlation. */
    conversationId?: string;
    /**
     * Stable per-user-turn idempotency key (ADR-0013 D1). Supplied by the
     * client and constant across a Retry of the same turn. The service dedups
     * the inbound user message by `(conversationId, turnId)` and short-circuits
     * the stored reply when the turn already completed. Omit for
     * internal/system invocations that have no user-facing turn.
     */
    turnId?: string;
    /** Assistant message id that produced the tool call. */
    messageId?: string;
    /** Active environment (multi-tenant project) id, if known. */
    environmentId?: string;
    /**
     * The agent this chat runs as (e.g. the `:agentName` from
     * `/api/v1/ai/agents/:agentName/chat`). Stamped onto an auto-created
     * conversation's `agent_id` so downstream analytics / per-agent metering can
     * attribute usage to the right agent instead of leaving it null.
     */
    agentId?: string;
    /**
     * Object the user is currently viewing in the UI (e.g. the list/detail
     * page they have open). Built-in data tools use this as a fallback target
     * when the user refers to "this object" / "the current object" and the
     * free-text request doesn't name one explicitly — so a question phrased in
     * any language still resolves to the right object without a keyword match.
     */
    currentObjectName?: string;
    /** View the user is currently viewing, if known. */
    currentViewName?: string;
    /**
     * cloud#1610 — what the user is currently DISCUSSING, derived by the UI
     * from its route and selection, sent fresh on every turn. Strictly richer
     * than `currentObjectName`/`currentViewName` (which stay as their own
     * fields for back-compat): the Studio pillar the user is on, the selected
     * artifact WITH its type discriminator (an interfaces nav leaf may be a
     * page, object view, dashboard or report — the type is what makes "改这个"
     * unambiguous), an optional finer selection inside it, and the canvas mode.
     * Consumers treat every field as optional and advisory: grounding for the
     * agents ("当前正在讨论…"), default targets for authoring tools — never an
     * access decision.
     */
    surfaceContext?: {
        /** Studio pillar / console area, e.g. 'data' | 'automations' | 'interfaces' | 'access'. */
        pillar?: string;
        /** The artifact under discussion, with its metadata type (e.g. {type:'dashboard', name:'sales_overview'}). */
        artifact?: { type: string; name: string };
        /** Finer selection inside the artifact (e.g. {kind:'field', id:'priority'}). */
        selection?: { kind: string; id: string };
        /** Canvas mode where applicable: 'design' | 'run'. */
        mode?: string;
    };
    /**
     * Text of the latest user message (neutral context, like currentObjectName).
     * Forwarded so a tool can detect intent — e.g. an explicit confirm/approval —
     * without re-deriving it from the transcript. Consumers own any semantics.
     * Populated by whichever layer owns the agent route (cloud, post-cloud ADR-0025).
     */
    userMessageText?: string;
    /**
     * Blueprint-identity digest stamped on a CONFIRM REPLAY of an already
     * approved proposal — the consent record saying *this exact blueprint* is
     * the one the user approved, carried onto the turn that replays it.
     * Populated by whichever layer owns the agent route (cloud, post-cloud
     * ADR-0025) — the same provenance {@link userMessageText} carries — and set
     * only by in-process server code on that route. ⛔ NEVER derived from a
     * request body, a tool argument or the transcript: anything the caller can
     * write is not a confirmation.
     *
     * `undefined` means "no confirmed identity on this turn" and authorizes
     * NOTHING — the same fail-closed reading as {@link actor} and
     * {@link isSystem} (#2991). A handler MUST NOT read consent out of a
     * missing field.
     *
     * Declared here because a published handler already AUTHORIZES on it:
     * cloud's `apply_blueprint` gate makes a matching identity one clause of
     * the decision to build a whole app (cloud#1954, cloud PR #2005). A field a
     * handler authorizes on belongs in the declared contract, not in a
     * consumer's structural cast.
     */
    confirmedBlueprintIdentity?: string;
    /** Distributed-trace id for cross-service correlation. */
    traceId?: string;
    /**
     * Emit a progress event WHILE a long-running tool executes, surfaced to the
     * client mid-stream (before the tool returns). Set only on the streaming
     * path (`streamChatWithTools`); `undefined` for non-streaming/system calls,
     * so handlers must call it optionally (`ctx.onProgress?.(…)`).
     *
     * `type` is a Vercel UI-message-stream custom data-part name (must start
     * with `data-`, e.g. `data-build-progress`). Pass a stable `id` to RECONCILE
     * (replace) the part across emits — ideal for a single progress object that
     * updates in place; omit `id` for append-only events. `data` is the payload.
     *
     * Example (apply_blueprint streaming its build tree):
     *   ctx.onProgress?.({ type: 'data-build-progress', id: 'build', data: { phase, items } });
     */
    onProgress?: (part: { type: string; id?: string; data?: unknown }) => void;
}

/**
 * Options for {@link IAIService.generateObject}.
 */
export interface GenerateObjectOptions extends AIRequestOptions {
    /** Optional schema name to send to the provider (improves prompt clarity). */
    schemaName?: string;
    /** Optional schema description (sent to the provider). */
    schemaDescription?: string;
}

/**
 * Result of a {@link IAIService.generateObject} call.
 */
export interface AIObjectResult<T> {
    /** The validated, strongly-typed object. */
    object: T;
    /** Model used for generation. */
    model?: string;
    /** Token usage statistics. */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

// ---------------------------------------------------------------------------
// Conversation Management
// ---------------------------------------------------------------------------

/**
 * One message of a persisted conversation: a Vercel `ModelMessage` plus the
 * turn it belongs to, the `turnId` it was written under
 * ({@link IAIConversationService.addMessage}). Absent or null on a message
 * stored with no turn. The wire shape is `AiConversationMessageSchema` (`api/protocol.zod.ts`).
 */
export type AIConversationMessage = ModelMessage & {
    /** The turn the message was written under; absent or null when it had none. */
    turnId?: string | null;
};

/**
 * A persistent AI conversation with message history
 */
export interface AIConversation {
    /** Conversation ID */
    id: string;
    /** Title / summary */
    title?: string;
    /** Associated agent ID */
    agentId?: string;
    /** User who owns the conversation */
    userId?: string;
    /** Messages in the conversation, each with the turn it was written under */
    messages: AIConversationMessage[];
    /** Creation timestamp (ISO 8601) */
    createdAt: string;
    /** Last update timestamp (ISO 8601) */
    updatedAt: string;
    /** Conversation metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Optional per-message observability metadata passed by the AI service
 * when persisting a message that was produced (or consumed) by an LLM
 * call. Lets the conversation store record token usage, latency, and
 * model id alongside each message so analytics surfaces (cost per turn,
 * latency histograms, A/B comparisons) can read a single table.
 *
 * All fields are optional — user-authored messages typically pass none.
 * Conversation services SHOULD persist supplied fields verbatim and
 * SHOULD tolerate missing fields gracefully (older callers, in-flight
 * upgrades).
 */
export interface MessageObservability {
    /** Model id reported by the adapter (e.g. `gpt-4o-mini-2024-07-18`). */
    model?: string;
    /** Tokens consumed by the prompt portion of the call. */
    promptTokens?: number;
    /** Tokens generated in the completion. */
    completionTokens?: number;
    /** prompt + completion. */
    totalTokens?: number;
    /** Wall-clock duration of the LLM call that produced this message. */
    latencyMs?: number;
}

/**
 * IAIConversationService - Manages persistent AI conversations
 *
 * Provides CRUD operations for conversations and their messages.
 *
 * ## The caller's execution context on reads (ADR-0096 D5)
 *
 * {@link IAIConversationService.get} and {@link IAIConversationService.list}
 * take an optional trailing `context`: the caller's {@link ExecutionContext},
 * the type and position the other store contracts use (`ISharingService`,
 * `IApprovalService`, `IShareLinkService`, `IAnalyticsService`).
 *
 * - **Supplied:** the implementation passes it unchanged as the `context` of
 *   every engine read the method makes (`BaseEngineOptions.context` on
 *   `IDataEngine.find` / `findOne`), so the read runs as that caller. Under
 *   ADR-0096 D5 strict mode an engine read with no principal is refused with
 *   403, so without a caller an implementation can only read as system.
 * - **Omitted:** the read is the one the implementation made before this
 *   parameter existed, and a caller written against the shorter signature
 *   keeps compiling.
 *
 * Whether a caller is admitted to the rows depends on the stored objects'
 * access and sharing, which this contract does not declare.
 */
export interface IAIConversationService {
    /**
     * Create a new conversation
     * @param options - Initial conversation properties
     * @returns The created conversation
     */
    create(options?: {
        title?: string;
        agentId?: string;
        userId?: string;
        metadata?: Record<string, unknown>;
    }): Promise<AIConversation>;

    /**
     * Get a conversation by ID, including its full message history.
     *
     * For paginated or filtered reads of `ai_messages`, use the generic
     * ObjectQL data endpoint directly — that's the canonical query layer.
     *
     * @param conversationId - Conversation identifier
     * @param context - The caller's execution context, passed to every
     *                engine read this method makes (see the interface doc)
     * @returns The conversation, or null if not found
     */
    get(conversationId: string, context?: ExecutionContext): Promise<AIConversation | null>;

    /**
     * List conversations with optional filters
     * @param options - Filter and pagination options. `userId` filters on
     *                the conversation's owner; it is not the caller's
     *                identity and does not stand in for `context`.
     * @param context - The caller's execution context, passed to every
     *                engine read this method makes (see the interface doc)
     * @returns Array of matching conversations
     */
    list(
        options?: {
            userId?: string;
            agentId?: string;
            limit?: number;
            cursor?: string;
        },
        context?: ExecutionContext,
    ): Promise<AIConversation[]>;

    /**
     * Add a message to a conversation
     * @param conversationId - Target conversation ID
     * @param message - Message to append (Vercel `ModelMessage`)
     * @param extras - Optional per-message observability metadata. When
     *                supplied, the conversation service persists token
     *                usage, latency, and model id alongside the message
     *                so each `ai_messages` row can be analysed without
     *                joining `ai_traces` by timestamp.
     * @param turnId - Optional stable per-user-turn idempotency key
     *                (ADR-0013 D1). Persisted as `turn_id` so the turn's
     *                messages can be deduped and reconciled on Retry.
     * @returns The updated conversation
     */
    addMessage(
        conversationId: string,
        message: ModelMessage,
        extras?: MessageObservability,
        turnId?: string,
    ): Promise<AIConversation>;

    /**
     * Reconcile the state of a single user turn (ADR-0013 D1).
     *
     * Lets the tool loop make a turn idempotent: dedup the inbound user
     * message and short-circuit a turn that already completed instead of
     * re-running tools / re-planning.
     *
     * @param conversationId - Conversation the turn belongs to
     * @param turnId - The turn's stable idempotency key
     * @returns `userExists` — whether a `user` message was already recorded
     *          for this turn; `reply` — the turn's final assistant text reply
     *          (an assistant message with no pending tool calls), or null if
     *          the turn never completed.
     */
    getTurnState(
        conversationId: string,
        turnId: string,
    ): Promise<{ userExists: boolean; reply: AIResult | null }>;

    /**
     * Update mutable conversation fields (title, metadata).
     * @param conversationId - Conversation to update
     * @param patch - Fields to change. Only provided keys are written.
     * @returns The updated conversation
     */
    update(
        conversationId: string,
        patch: { title?: string; metadata?: Record<string, unknown> },
    ): Promise<AIConversation>;

    /**
     * Delete a conversation
     * @param conversationId - Conversation to delete
     */
    delete(conversationId: string): Promise<void>;
}
