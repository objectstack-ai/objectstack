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
 * the out-edges, `subflow` carries a top-level `timeoutMs` — a published
 * partial schema would DROP those editors (the #4210 `connector_action`
 * incident). So the Studio form for these types is objectui's hand-written
 * group, and until #4278 **nothing reconciled that hand-written table against
 * the executors**: `script`'s form offered an `outputVariables` key nothing
 * reads, two `actionType` options that fail every run, a no-op default — and
 * could not author the `function`/`inputs`/`outputVariable` path that works.
 *
 * `script`'s own reason for staying schemaless was that its form switched on
 * `actionType`. #4343 retired that switch, so the node is now three flat keys
 * and could graduate to a published descriptor `configSchema` the way `map`
 * did — a follow-up, deliberately not folded into the retirement.
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
 * ## What these schemas are wired to
 *
 * `script` and `subflow` are **parsed at execute time** since #4343, through
 * the same `parseNodeConfig()` seam #4277 gave the flat builtins
 * (`service-automation`'s `parse-config.ts`): a config that fails its contract
 * refuses the node as a GUARD — wrong metadata, so a rerun cannot help and no
 * `fault` edge may route it (#3863).
 *
 * `script` could not be parsed while its legal key set depended on
 * `actionType`; #4343 removed that dependence instead of modelling it.
 * Converging the node to its one real path — call a registered function — left
 * a flat three-key contract a flat parse fits exactly, and the five keys the
 * other branches read became {@link retiredKey} tombstones.
 *
 * The two halves reach different audiences, which is why they shipped together:
 *
 *  - the **tombstones** teach whoever authors the key — `tsc` types it `never`,
 *    and a direct parse raises the prescription. They do NOT reach a stored
 *    flow: `FlowNodeSchema.config` is `z.record(z.unknown())`, so no load-path
 *    parse ever descends into a node's config;
 *  - the **execute-time parse** is what a stored flow meets. `registerFlow`
 *    canonicalizes data at rest through the retired conversion too (#3903), so
 *    a stored `actionType: 'email'` node arrives here stripped of the keys
 *    nothing read — and then refuses, naming the `function` it does not have,
 *    instead of logging a line and reporting success as it used to.
 *
 * `decision` stays export-only, deliberately: it may carry no `conditions` at
 * all when it branches purely on edge predicates (a plain BPMN exclusive
 * gateway), and `conditions` is its only key — so a parse would have nothing
 * left to check. Its enforcement remains the objectui reconciliation test,
 * which is what #4278 was actually about (a form authoring keys nothing reads).
 *
 * Undeclared aliases are NOT part of these contracts: `subflow`'s historical
 * `flow` spelling graduated into the ADR-0087 D2 conversion
 * `flow-node-subflow-flow-alias` (the `map.flow` path), so the executor only
 * ever sees `flowName`.
 *
 * ## Unknown keys — closed as of #4001 批 9, and this class had NO other door
 *
 * The descriptor-schema'd builtins have a registration-time key gate:
 * `registerFlow()` walks each node's `config` against the descriptor's
 * `configSchema` and hard-rejects what it does not declare (#4277). **These
 * three node types are exempt from that walk** — by construction, since it
 * derives the declared set from a `configSchema` they publish none of
 * (`validateNodeConfigKeys`' schemaless exemption). So until now the entire
 * `script` / `subflow` / `decision` config surface had exactly zero unknown-key
 * enforcement at any layer: the execute-time parse #4343 added checks types and
 * requiredness, and Zod's default `.strip` deleted everything else in silence.
 *
 * That is the #4001 asymmetry in its purest form — a guard was written for the
 * door in front of its author, and the class it structurally could not cover is
 * precisely the class with no second door. Closing these shapes is therefore
 * not a duplicate check for `script` and `subflow`; it is their first one.
 *
 * `decision` is still export-only, so its strictness binds at authoring
 * (`tsc`), in the published JSON Schema, and in objectui's reconciliation —
 * not at run time. It is closed anyway, because the campaign's whole finding
 * is that a shape left open accretes a test, a form and a fixture that assert
 * the openness, and then closing it is a migration instead of an edit.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
import { strictObject } from '../shared/strict-object';

/**
 * What a rejected key on these contracts silently did before #4001 批 9 — and
 * for `script` / `subflow` / `decision`, what NOTHING else was catching.
 */
const SCHEMALESS_NODE_CONFIG_HISTORY =
  'Until #4001 an undeclared key here was dropped in silence at every layer: these node types publish no '
  + "descriptor `configSchema`, so `registerFlow()`'s undeclared-key rejection (#4277) structurally skips them, "
  + 'and the execute-time parse checked only types and requiredness.';

/**
 * `script` prescriptions for the two ADR-0087 D2 aliases (#3796).
 *
 * `functionName` and `input` are retired SPELLINGS that
 * `flow-node-script-config-aliases` rewrites at load, so — like the notify
 * family — a config still carrying one at parse time carries the canonical key
 * too, and since #4923 it carries a canonical key holding a DIFFERENT value
 * (an identical twin is deleted by the conversion). `input` earns its entry
 * twice over: edit distance would suggest `inputs` without ever saying that
 * `input` is *canonical* on `connector_action`'s `connectorConfig`, which is
 * where the spelling leaked in from and where it must NOT be changed.
 *
 * The five `actionType`-branch keys need no entry here: `retiredKey()` puts the
 * prescription in the shape itself, which is strictly stronger (it also types
 * them `never`), and `strictObject` already keeps such keys out of the
 * did-you-mean candidate list.
 */
const SCRIPT_KEY_GUIDANCE: Readonly<Record<string, string>> = {
  functionName:
    'The callable reference is `function` (#1870). `functionName` was the AI/template-emitted alias, rewritten at '
    + 'load by the ADR-0087 D2 conversion `flow-node-script-config-aliases`. If `function` is also present, the two '
    + 'name DIFFERENT callables and the conversion kept both rather than picking which one runs (#4923) — decide '
    + 'which it is, put it on `function`, and delete `functionName`.',
  input:
    'The input map on a `script` node is `inputs` (plural). The singular `input` leaked in from '
    + "`connector_action`, where `connectorConfig.input` is a DIFFERENT and canonical surface — do not \"fix\" that "
    + 'one. `flow-node-script-config-aliases` rewrites this key at load; delete it once `inputs` carries the values. '
    + 'If `inputs` is also present with DIFFERENT values, the conversion kept both rather than choosing (#4923) — '
    + 'reconcile them onto `inputs`.',
};

/** `subflow` prescriptions — one retired spelling, one wrong layer. */
const SUBFLOW_KEY_GUIDANCE: Readonly<Record<string, string>> = {
  flow:
    'The invoked flow is named by `flowName`. `flow` was an undeclared executor fallback that no schema or form '
    + 'ever described; it graduated into the ADR-0087 D2 conversion `flow-node-subflow-flow-alias` (#4278), which '
    + 'rewrites it at load. If `flowName` is also present, the two name DIFFERENT flows and the conversion kept '
    + 'both rather than picking which one this step invokes (#4923) — decide which it is, put it on `flowName`, '
    + 'and delete `flow`.',
  timeoutMs:
    "A subflow step's timeout is the engine's per-node guard, so it belongs on the NODE, not in its config: "
    + '`{ id, type: "subflow", timeoutMs: 30000, config: { … } }`. `FlowNodeSchema.timeoutMs` is the declared key.',
};

/**
 * `decision` prescriptions for the legacy singular `config.condition` (#4414).
 *
 * This is the entry that could not be left to edit distance. `condition` →
 * `conditions` is one character, so the suggester would confidently propose it
 * — and taking that advice is the *worse* outcome: a decision that declares
 * `conditions` here **and** carries per-edge `condition`s picks a branch and
 * then lets that branch's edge re-decide, which is the double-declaration
 * behind #4414 itself. Finding 7's shape ("this campaign's own helper
 * signposting the way into the failure it exists to kill") applies exactly, so
 * the rename is suppressed and the mechanism is named instead.
 *
 * The claim is measured, not assumed: `config.condition` is READ only on a
 * `start` node (the trigger gate) and is inert on all nineteen other builtins —
 * that is what `lint-flow-patterns`' `flow-inert-node-condition` advisory
 * already says, and this table is where the same prose becomes a rejection.
 */
const DECISION_KEY_GUIDANCE: Readonly<Record<string, string>> = {
  condition:
    'Nothing reads `config.condition` on a `decision`: the key is the trigger gate on a `start` node and is inert '
    + 'on every other node type (#4414), so a predicate written here never gates anything — it is still '
    + 'parse-validated at registration, which is why a malformed one is caught and an INERT one was not. Branching '
    + 'lives on the OUT-EDGES: give each branch its own `condition` and mark the fallback `isDefault: true`. Do not '
    + 'reach for the plural `conditions` here on the strength of the spelling — declaring branches here AND on the '
    + 'edges is the double-declaration #4414 was filed for. If the edges already carry the predicate, delete this key.',
};

// ─── script ──────────────────────────────────────────────────────────

/**
 * `script` node config — what the executor reads (screen-nodes.ts).
 *
 * **One shape, one path (#4343):** a `script` node names a registered function
 * (`defineStack({ functions })`), passes it `inputs`, and binds its return
 * value to `outputVariable`. `function` is required — a script node that names
 * no callable has nothing to run, and the execute-time parse refuses it rather
 * than letting the run discover that halfway through.
 *
 * The invoked function is contractually PURE — it returns its result and the
 * flow graph persists it (`FlowFunctionEffectSchema`, #4396). The descriptor
 * publishes that as `handlerContract: 'pure'`, and it is what lets the node
 * report no record metrics without guessing. A function that legitimately
 * writes declares `effect: 'writes'` where it is registered, so the run reports
 * an effect it cannot count instead of reporting none.
 *
 * ## What the four other shapes were, and why they are gone
 *
 * Until #4343 the legal key set depended on `actionType`, which is why this
 * contract could not be parsed at all (see the module header). Of the four
 * dispatch branches only the function path ran real logic:
 *
 *  - `actionType: 'email' | 'slack'` were **logger-backed stubs**. They wrote a
 *    line to the log, reported success, and delivered nothing under any
 *    configuration — `template` / `recipients` / `variables` fed a message no
 *    channel ever sent. `notify` (real delivery, via the messaging service) and
 *    `connector_action` were already the live mechanisms.
 *  - `script` (inline JS) was **recognized but never executed**: the built-in
 *    runtime has no server-side JS sandbox, so the node warned and no-op'd.
 *  - any other `actionType` was **shorthand for a function name** — a second
 *    spelling of `function`, and the `invoke_function` marker named nothing on
 *    its own.
 *
 * All five keys are tombstoned below; the ADR-0087 D2 conversion
 * `flow-node-script-branch-keys-removed` rewrites stored sources (moving a
 * shorthand `actionType` into `function`, where that is what it meant).
 */
export const ScriptConfigSchema = lazySchema(() => strictObject({
  surface: 'this script node config',
  history: SCHEMALESS_NODE_CONFIG_HISTORY,
  guidance: SCRIPT_KEY_GUIDANCE,
}, {
  /**
   * Registered function to call (`defineStack({ functions })`) — required: it
   * is the whole of what a `script` node does.
   *
   * Contractually pure: it takes `inputs`, RETURNS a value, and does no data
   * I/O of its own. A function that legitimately writes declares
   * `effect: 'writes'` where it is registered, so the run reports an effect it
   * cannot count instead of reporting none (#4396).
   */
  function: z.string().min(1)
    .describe('Registered function to call (defineStack({ functions })). Contractually pure — it returns a value a later declarative node persists'),
  /** Inputs passed to the function; values interpolate `{token}` templates against the live flow variables. */
  inputs: z.record(z.string(), z.unknown()).optional()
    .describe('Inputs passed to the function (values interpolate {token} templates)'),
  /** Flow variable the function's RETURN value is bound to (pure-function pattern — data I/O stays on the graph). */
  outputVariable: z.string().optional()
    .describe("Flow variable the function's return value is bound to"),

  // The four retired dispatch branches (#4343). Each tombstone carries its own
  // prescription because the three replacements are different mechanisms, not
  // one rename: real messaging is `notify`, Slack is a connector, and inline
  // logic belongs in a registered function.
  actionType: retiredKey(
    '`script.config.actionType` was removed in @objectstack/spec 17 (#4343) — none of its values '
    + 'did what it said. The two built-ins were logger-backed stubs that recorded the intent and '
    + 'delivered nothing under any configuration, and every other value was a second spelling of '
    + '`config.function`. Replace it per branch: for `email` use a `notify` node (it delivers '
    + 'through the messaging service — the in-app inbox by default, real email once '
    + '`@objectstack/plugin-email` is installed); for `slack` use a `connector_action` node with '
    + 'the Slack connector, or an `http` node posting to a webhook; for anything else, move the '
    + 'name into `config.function`. Run `os migrate meta --from 16` to rewrite the shorthand '
    + 'case into `config.function` automatically; the stub and marker values are removed.',
  ),
  template: retiredKey(
    '`script.config.template` was removed in @objectstack/spec 17 (#4343) — it fed only the '
    + 'logger-backed `email`/`slack` stubs, which never rendered or sent a message, so no template '
    + 'id was ever resolved. Delete the key. A `notify` node carries its own `title`/`message`, and '
    + 'stored templates live in the messaging service (`sys_notification_template`), not on the '
    + 'node. Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  recipients: retiredKey(
    '`script.config.recipients` was removed in @objectstack/spec 17 (#4343) — the addresses were '
    + 'logged, never messaged: the `email`/`slack` branches it fed delivered nothing. Use a '
    + '`notify` node, whose `recipients` (user ids, field refs or addresses) reach the messaging '
    + 'service for real. Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  variables: retiredKey(
    '`script.config.variables` was removed in @objectstack/spec 17 (#4343) — it injected values '
    + 'into a template no side effect ever rendered. Delete the key. A `notify` node carries '
    + 'structured data in `payload`; a registered function takes it in `config.inputs`. '
    + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  script: retiredKey(
    '`script.config.script` was removed in @objectstack/spec 17 (#4343) — the built-in runtime has '
    + 'no server-side JS sandbox, so an inline body was recognized and never executed: the node '
    + 'warned and completed as a no-op. Move the logic into a registered function '
    + '(`defineStack({ functions })`) and name it in `config.function`. '
    + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
}));

export type ScriptConfig = z.input<typeof ScriptConfigSchema>;
export type ScriptConfigParsed = z.infer<typeof ScriptConfigSchema>;

// ─── subflow ─────────────────────────────────────────────────────────

/**
 * `subflow` node config — what the executor reads (subflow-node.ts).
 *
 * `flowName` is execute-time required: since #4343 the executor parses this
 * contract before it runs, so a missing or empty name refuses the node as a
 * guard (wrong metadata — a rerun cannot supply it) instead of failing through
 * a hand-written check. The historical undeclared `flow` alias is NOT part of
 * this contract: the
 * ADR-0087 D2 conversion `flow-node-subflow-flow-alias` rewrites it at load
 * (#4278 — the `map.flow` graduation path), so the executor only ever sees
 * `flowName`. The node-level `timeoutMs` lives on {@link FlowNodeSchema}, not
 * here — a subflow step's timeout is the engine's per-node guard.
 */
export const SubflowConfigSchema = lazySchema(() => strictObject({
  surface: 'this subflow node config',
  history: SCHEMALESS_NODE_CONFIG_HISTORY,
  guidance: SUBFLOW_KEY_GUIDANCE,
}, {
  /** The flow to invoke (execute-time required). */
  flowName: z.string().min(1).describe('Flow invoked as this step (it may pause — approval / screen / wait)'),
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
export const DecisionConditionSchema = lazySchema(() => strictObject({
  surface: 'this decision branch',
  history: SCHEMALESS_NODE_CONFIG_HISTORY,
  // `condition` is the EDGE's spelling of the same intent one layer out
  // (`FlowEdgeSchema` declares it, and already aliases `expression`/`when`/
  // `guard` TO it). The two surfaces spell one concept with two words, so the
  // confusion is symmetric and the mirror alias belongs here — this is the
  // `visibleWhen → visible` category, not a typo edit distance would reach.
  aliases: { condition: 'expression' },
  guidance: {
    target:
      'The designer\'s branch rows show a **Target** column, but it is VIRTUAL — objectui\'s `flow-decision-edges` '
      + "projects it from the node's out-edges and applies edits back to them; it is never stored on the branch. "
      + "Route by making this branch's `label` match an out-edge's `label` exactly (a label nothing claims cannot "
      + 'route: traversal falls back to considering every out-edge, and `os validate` reports it as '
      + '`flow-branch-label-unmatched`, #4414).',
  },
}, {
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
export const DecisionConfigSchema = lazySchema(() => strictObject({
  surface: 'this decision node config',
  history: SCHEMALESS_NODE_CONFIG_HISTORY,
  guidance: DECISION_KEY_GUIDANCE,
}, {
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
