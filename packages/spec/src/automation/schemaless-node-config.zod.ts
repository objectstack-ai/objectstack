// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/schemaless-node-config
 *
 * Config contracts for the **descriptor-schemaless** builtins whose designer
 * form lives ONLY in objectui's hand-written `FLOW_NODE_CONFIG` table —
 * `script`, `subflow` and `decision` (#4278).
 *
 * ## Why these nodes publish no descriptor `configSchema` — and still need this
 *
 * `config-schemas.test.ts` in `service-automation` pins the schemaless class
 * with each member's reason: `decision`'s virtual Target column is derived from
 * the out-edges, `script`'s form switches on `actionType`, `subflow` carries a
 * top-level `timeoutMs` — a published partial schema would DROP those editors
 * (the #4210 `connector_action` incident). So the Studio form for these types
 * is objectui's hand-written group, and until #4278 **nothing reconciled that
 * hand-written table against the executors**: `script`'s form offered an
 * `outputVariables` key nothing reads, two `actionType` options that fail every
 * run, a no-op default — and could not author the `function`/`inputs`/
 * `outputVariable` path that works.
 *
 * These schemas are the machine-readable half of that reconciliation. They are
 * **written from the executors** (`service-automation/builtin/screen-nodes.ts`
 * for `script`, `subflow-node.ts`, `logic-nodes.ts` for `decision`), not from
 * any form, and objectui's `flow-node-config` reconciliation test compares its
 * hand-written key sets against them — the same bidirectional ledger the
 * descriptor-schema'd builtins get from `builtin-node-form-zod-ledger.test.ts`,
 * carried across the repo seam by the `@objectstack/spec` dependency objectui
 * already has.
 *
 * `wait` and `connector_action` — the other two schemaless members — need no
 * entry here: their contracts are the spec-structured sibling blocks on
 * {@link FlowNodeSchema} (`waitEventConfig` / `connectorConfig`), which the
 * same objectui test reconciles directly.
 *
 * ## What these schemas are (and are not) wired to
 *
 * Contract exports only — no engine path `parse()`s a node config with them,
 * so registering a flow behaves exactly as before. This is where they differ
 * from their `builtin-node-config.zod.ts` siblings, which #4277 wired into
 * execute-time parsing (`service-automation`'s `parse-config.ts`) and into the
 * `registerFlow()` unknown-key rejection.
 *
 * That difference is deliberate, and it is the same reason these three publish
 * no descriptor `configSchema`: **their key set is not the whole contract.**
 * `script`'s legal keys depend on `actionType` (a built-in side effect reads
 * `template`/`recipients`/`variables`; the function path reads
 * `function`/`inputs`/`outputVariable`), and `decision` may carry no
 * `conditions` at all when it branches purely on edge predicates. A flat parse
 * would either reject those shapes or wave everything through — neither is the
 * contract. Wiring them in needs a discriminated form first; until then the
 * enforcement they DO get is the objectui reconciliation test, which is what
 * #4278 was actually about (a form authoring keys nothing reads).
 *
 * Undeclared aliases are NOT part of these contracts: `subflow`'s historical
 * `flow` spelling graduated into the ADR-0087 D2 conversion
 * `flow-node-subflow-flow-alias` (the `map.flow` path), so the executor only
 * ever sees `flowName`.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

// ─── script ──────────────────────────────────────────────────────────

/**
 * `script` action types with a built-in (logger-backed) side-effect handler.
 * Any other non-marker `actionType` is treated as a registered-function name
 * (#1870). The executor builds its dispatch set from THIS constant, and the
 * designer's `actionType` options must stay within
 * `[SCRIPT_INVOKE_FUNCTION_ACTION_TYPE, ...SCRIPT_BUILTIN_ACTION_TYPES]` —
 * the #4278 drift was the form offering `sms` / `notification`, which are in
 * neither set and so failed every run as unresolvable function names.
 */
export const SCRIPT_BUILTIN_ACTION_TYPES = ['email', 'slack'] as const;
export type ScriptBuiltinActionType = (typeof SCRIPT_BUILTIN_ACTION_TYPES)[number];

/**
 * The `actionType` MARKER meaning "call the registered function named by
 * `config.function`" — it is not itself a function name. The executor fails
 * the step with a clear message when this marker is set and `function` is not.
 */
export const SCRIPT_INVOKE_FUNCTION_ACTION_TYPE = 'invoke_function';

/**
 * `script` node config — what the executor reads (screen-nodes.ts).
 *
 * Dispatch precedence, verbatim from the executor:
 *
 *  1. `function` set → resolve and call that registered function (always wins).
 *  2. `actionType` ∈ {@link SCRIPT_BUILTIN_ACTION_TYPES} → the built-in
 *     logger-backed side effect, fed by `template` / `recipients` / `variables`.
 *  3. `script` set (no `function`) → **recognized but NOT executed**: the
 *     built-in runtime has no server-side JS sandbox, so the node warns loudly
 *     and completes as a no-op. Authoring is steered to a registered function.
 *  4. Anything left in `actionType` (except the
 *     {@link SCRIPT_INVOKE_FUNCTION_ACTION_TYPE} marker) is shorthand for a
 *     function name; a name that resolves to nothing fails the step LOUDLY.
 *
 * The invoked function is contractually PURE — it returns its result and the
 * flow graph persists it (`FlowFunctionEffectSchema`, #4396). The descriptor
 * publishes that as `handlerContract: 'pure'`, and it is what lets the node
 * report no record metrics without guessing.
 */
export const ScriptConfigSchema = lazySchema(() => z.object({
  /** Built-in side-effect id, the `invoke_function` marker, or (shorthand) a registered-function name. */
  actionType: z.string().optional()
    .describe("How this step runs: a built-in side effect ('email' | 'slack'), the 'invoke_function' marker, or shorthand for a registered-function name"),
  /**
   * Registered function to call (`defineStack({ functions })`) — always wins
   * over `actionType`.
   *
   * Contractually pure: it takes `inputs`, RETURNS a value, and does no data
   * I/O of its own. A function that legitimately writes declares
   * `effect: 'writes'` where it is registered, so the run reports an effect it
   * cannot count instead of reporting none (#4396).
   */
  function: z.string().optional()
    .describe('Registered function to call (defineStack({ functions })); takes precedence over actionType. Contractually pure — it returns a value a later declarative node persists'),
  /** Inputs passed to the function; values interpolate `{token}` templates against the live flow variables. */
  inputs: z.record(z.string(), z.unknown()).optional()
    .describe('Inputs passed to the function (values interpolate {token} templates)'),
  /** Flow variable the function's RETURN value is bound to (pure-function pattern — data I/O stays on the graph). */
  outputVariable: z.string().optional()
    .describe("Flow variable the function's return value is bound to"),
  /** Built-in side effects only: message template id. */
  template: z.string().optional()
    .describe('Built-in side effects only: message template id'),
  /** Built-in side effects only: recipient list (user ids, field refs, addresses). */
  recipients: z.array(z.string()).optional()
    .describe('Built-in side effects only: recipients (user ids, field refs, or addresses)'),
  /** Built-in side effects only: values injected into the template. */
  variables: z.record(z.string(), z.unknown()).optional()
    .describe('Built-in side effects only: values injected into the template'),
  /**
   * Inline JS source — recognized but NOT executed by the built-in runtime (no
   * server-side JS sandbox): the node warns and completes as a no-op. Kept in
   * the contract because the executor reads it; deliberately NOT offered for
   * new authoring (the designer renders a stored value read-only-style and
   * steers authors to `function`).
   */
  script: z.string().optional()
    .describe('Inline JS source — recognized but not executed by the built-in runtime; use a registered function via `function` instead'),
}));

export type ScriptConfig = z.input<typeof ScriptConfigSchema>;
export type ScriptConfigParsed = z.infer<typeof ScriptConfigSchema>;

// ─── subflow ─────────────────────────────────────────────────────────

/**
 * `subflow` node config — what the executor reads (subflow-node.ts).
 *
 * `flowName` is execute-time required (the step is refused without it). The
 * historical undeclared `flow` alias is NOT part of this contract: the
 * ADR-0087 D2 conversion `flow-node-subflow-flow-alias` rewrites it at load
 * (#4278 — the `map.flow` graduation path), so the executor only ever sees
 * `flowName`. The node-level `timeoutMs` lives on {@link FlowNodeSchema}, not
 * here — a subflow step's timeout is the engine's per-node guard.
 */
export const SubflowConfigSchema = lazySchema(() => z.object({
  /** The flow to invoke (execute-time required). */
  flowName: z.string().describe('Flow invoked as this step (it may pause — approval / screen / wait)'),
  /** Values passed to the child's input variables; `{token}` templates resolve against the parent's variables. */
  input: z.record(z.string(), z.unknown()).optional()
    .describe("Values passed to the subflow's input variables (interpolate {token} templates)"),
  /** Parent flow variable the child's output is bound to. */
  outputVariable: z.string().optional()
    .describe("Parent flow variable the subflow's output is bound to"),
}));

export type SubflowConfig = z.input<typeof SubflowConfigSchema>;
export type SubflowConfigParsed = z.infer<typeof SubflowConfigSchema>;

// ─── decision ────────────────────────────────────────────────────────

/**
 * One `decision` branch — what the executor reads per condition
 * (logic-nodes.ts): the first branch whose bare-CEL `expression` evaluates
 * true wins, and the run continues down the out-edge labelled `label`. When no
 * branch matches, the run takes the declared fallback — the out-edge marked
 * `isDefault: true`, or one literally labelled `default`.
 *
 * `label` must match an out-edge's `label` **exactly**. A label nothing claims
 * cannot route: traversal logs a warning and falls back to considering every
 * out-edge, and `os validate` reports it as `flow-branch-label-unmatched`
 * (#4414 — every decision label in the repo used to miss, silently).
 *
 * The designer's branch rows also show a **Target** column — that is a
 * VIRTUAL column projected from the node's out-edges by the designer
 * (objectui `flow-decision-edges`), never stored on the branch, so it is
 * deliberately absent here.
 */
export const DecisionConditionSchema = lazySchema(() => z.object({
  /** Branch label — must match an out-edge's `label` to route anywhere. */
  label: z.string().describe("Branch label; the winning branch resumes down the out-edge with this label (no match → the out-edge marked isDefault, or one labelled 'default')"),
  /**
   * Bare-CEL predicate (ADR-0032) — `{…}` template braces are the #1491 trap.
   *
   * `xExpression: 'expression'` is what carries that from a comment into the
   * machine-readable contract (#4439): it rides the `.meta()` → JSON-Schema
   * channel (same as `loop.collection`'s `'template'` marker), so the
   * expression ledger can claim this slot even though `decision` publishes no
   * descriptor `configSchema`, and `registerFlow` / `objectstack validate` then
   * check it as the bare CEL it is. Before that the declaration was prose only:
   * both validators walked a hardcoded list this key was not on, so a
   * brace-in-CEL predicate passed the build and was only caught at run time.
   */
  expression: z.string().meta({
    description: 'Bare CEL predicate deciding this branch',
    xExpression: 'expression',
  }),
}));

export type DecisionCondition = z.input<typeof DecisionConditionSchema>;

/**
 * `decision` node config — what the executor reads.
 *
 * A decision may also carry no `conditions` at all and rely purely on the
 * OUT-EDGES (`edge.condition` per branch + `isDefault` on the fallback,
 * evaluated by the engine's traversal) — a plain BPMN exclusive gateway, and
 * the shape every bundled example uses. A node that declares no `conditions`
 * reports no branch at all, so nothing competes with the edges.
 *
 * Pick **one** mechanism per decision. Declaring `conditions` here *and*
 * per-edge `condition`s means the node picks a branch and then that branch's
 * edge re-decides — the double-declaration behind #4414.
 *
 * The legacy singular `config.condition` is a structural surface the engine
 * parse-validates on every node at registration but the decision executor never
 * reads; branching predicates live in `conditions[]` or on the edges.
 */
export const DecisionConfigSchema = lazySchema(() => z.object({
  /** Ordered branches; first true expression wins, else the declared default edge. */
  conditions: z.array(DecisionConditionSchema).optional()
    .describe('Ordered decision branches (first true expression wins; omit to branch purely on edge conditions)'),
}));

export type DecisionConfig = z.input<typeof DecisionConfigSchema>;
export type DecisionConfigParsed = z.infer<typeof DecisionConfigSchema>;

// ─── registry ────────────────────────────────────────────────────────

/**
 * Every schemaless builtin's config contract, keyed by `node.type` (#4439).
 *
 * The descriptor-schema'd builtins can be enumerated at run time — the engine's
 * registry hands out their `configSchema`s — but these three publish none by
 * design, so anything that wants to reason about *all* node config contracts
 * had to name them one by one. That is how the expression ledger's
 * reconciliation ratchet ended up structurally unable to cover them: it derives
 * its expectation from descriptor `configSchema`s, and a node that has none
 * could never own a ledger entry, no matter what its contract declared.
 *
 * With this map the ratchet reads BOTH channels — descriptor `xExpression`
 * markers and these schemas' `.meta({ xExpression })` markers — so a declared
 * expression slot is covered wherever it is declared, and a stale ledger entry
 * still fails from either side.
 *
 * Additive: objectui's `flow-node-config` reconciliation imports each schema by
 * name and is unaffected.
 */
export const SCHEMALESS_NODE_CONFIG_SCHEMAS = {
  script: ScriptConfigSchema,
  subflow: SubflowConfigSchema,
  decision: DecisionConfigSchema,
} as const satisfies Record<string, z.ZodType>;

/** Node types whose config contract lives in this module rather than a descriptor. */
export type SchemalessNodeType = keyof typeof SCHEMALESS_NODE_CONFIG_SCHEMAS;

/**
 * {@link SCHEMALESS_NODE_CONFIG_SCHEMAS} as JSON Schema, memoized — the same
 * shape a descriptor's `configSchema` is, so a consumer can read both channels
 * with one walk instead of two notions of "a declared config property" (#4439).
 *
 * Derived in `input` mode like {@link getApprovalNodeConfigJsonSchema}, which
 * is what carries `.meta({ xExpression })` markers through verbatim.
 *
 * These are **not** published on a descriptor — that is the whole point of the
 * schemaless class (see this module's header) — so nothing here reaches the
 * Studio property form. It exists so validation ledgers and reconciliation
 * ratchets can see these contracts at all.
 */
let cachedSchemalessNodeConfigJsonSchemas: Readonly<Record<SchemalessNodeType, unknown>> | undefined;
export function getSchemalessNodeConfigJsonSchemas(): Readonly<Record<SchemalessNodeType, unknown>> {
  if (cachedSchemalessNodeConfigJsonSchemas === undefined) {
    const out = {} as Record<SchemalessNodeType, unknown>;
    for (const [nodeType, schema] of Object.entries(SCHEMALESS_NODE_CONFIG_SCHEMAS)) {
      out[nodeType as SchemalessNodeType] = z.toJSONSchema(schema, {
        target: 'draft-2020-12',
        io: 'input',
        unrepresentable: 'any',
      });
    }
    cachedSchemalessNodeConfigJsonSchemas = out;
  }
  return cachedSchemalessNodeConfigJsonSchemas;
}
