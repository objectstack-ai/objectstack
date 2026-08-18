// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';

/**
 * Flow Node Types — **built-in seed set** (ADR-0018).
 *
 * Historically this `z.enum` *gated* `FlowNodeSchema.type`, which made the
 * closed protocol reject any plugin-registered node type — defeating the open
 * runtime registry (`registerNodeExecutor(type: string)`). Per ADR-0018 the
 * gate is removed: `FlowNodeSchema.type` is now a validated `string`, checked
 * against the live action registry at `registerFlow()` time, not frozen here.
 *
 * `FlowNodeAction` is **retained** as the canonical list of built-in type ids
 * (documentation + the seed descriptor set the engine registers at boot). It
 * no longer constrains authored flows — plugins extend the vocabulary.
 */
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
import { retryPolicyShape } from '../shared/retry-policy.zod';
import { strictObject } from '../shared/strict-object';
import { parseFlowNodeRegions } from './control-flow.zod';
export const FlowNodeAction = z.enum([
  'start',              // Trigger
  'end',                // Return/Stop
  'decision',           // If/Else logic
  'assignment',         // Set Variable
  'loop',               // For Each
  'create_record',      // CRUD: Create
  'update_record',      // CRUD: Update
  'delete_record',      // CRUD: Delete
  'get_record',         // CRUD: Get/Query
  'http',               // Outbound HTTP callout (ADR-0018 M3) — canonical; outbox-backed when durable
  'notify',             // Outbound notification (ADR-0012) — dispatched via the messaging service
  'script',             // Custom action: call the registered function named by `config.function`
                        //   (+ `config.inputs`), resolved from `defineStack({ functions })`. The key
                        //   is REQUIRED — a node naming no callable is flagged at build and refused
                        //   at execute (#1870). The `actionType` dispatch branches (logger-backed
                        //   'email'/'slack', inline `config.script`) were retired in 17 (#4343):
                        //   use `notify` / a connector / a registered function instead.
  'screen',             // Screen / User-Input Element
  'wait',               // Delay/Sleep
  'subflow',            // Call another flow
  'map',                // Sequential multi-instance — per-item subflow, each may pause (ADR-0037 A2)
  'connector_action',   // Zapier-style integration action
  'parallel_gateway',   // BPMN Parallel Gateway — AND-split (all outgoing branches execute concurrently)
  'join_gateway',       // BPMN Join Gateway — AND-join (waits for all incoming branches to complete)
  'boundary_event',     // BPMN Boundary Event — attached to a host node for timer/error/signal interrupts
]);
export type FlowNodeAction = z.input<typeof FlowNodeAction>;

/**
 * The built-in node type ids as a plain string array — the seed set the
 * runtime registers descriptors for at boot. Consumers that need to know
 * "which types ship in the box" (vs plugin-contributed) read this.
 */
export const FLOW_BUILTIN_NODE_TYPES: readonly string[] = FlowNodeAction.options;

/**
 * Structural node types the engine handles without a registered executor
 * (the start sentinel and the end terminator). These are always legal
 * regardless of what executors are registered.
 */
export const FLOW_STRUCTURAL_NODE_TYPES: readonly string[] = ['start', 'end'];

/*
 * ── Unknown-key strictness (#4001, ADR-0078) ────────────────────────────────
 *
 * The four AUTHORING schemas in this module (flow / node / edge / variable)
 * are `.strict()`: a key they do not declare is a loud, fixable parse error,
 * not a silent strip. Flows are the most AI-authored surface in the platform,
 * and an AI author + a silently dropped key is the worst combination — the
 * agent gets a success envelope and reports "done" over dead metadata
 * (cloud#688 / #2419 is exactly this class). A node's `config` stays an OPEN
 * record here: it is per-node-type, owned by the registered executor's
 * `configSchema` (#4027/#4040) and the ADR-0087 conversion layer — outer-shell
 * strictness must not close the plugin node-type namespace.
 *
 * Key lists are kept beside the schemas rather than derived from `.shape`
 * (bodies are allocated lazily; `flow.test.ts` drift-guards every entry).
 *
 * **Batch 11 closed the INNER blocks too.** Closing the four outer shells left
 * six nested authoring blocks on default `.strip` — `FlowNode.connectorConfig`
 * / `.position` / `.inputSchema` / `.waitEventConfig` / `.boundaryConfig` and
 * `Flow.errorHandling`. That is the shape this campaign keeps re-finding: a
 * guard put where the author who wrote it was standing. The outer gate rejected
 * `nodee:` at the node level while `connectorConfig: { connectorId, actionId,
 * params: {…} }` parsed clean and dispatched the action with **no inputs at
 * all** — the executor reads `input ?? {}`, so the whole mapped payload became
 * an empty object and the call succeeded against nothing.
 *
 * Note which cases those six were, and were not, hiding: a slip on a REQUIRED
 * key (`connectorID` for `connectorId`, `attachedToRef` for `attachedToNodeId`)
 * was always loud, because the required key then reads as missing. What
 * `.strip` swallowed is the OPTIONAL half — the input map, the retry budget,
 * `interrupting: false`, `required: true` — i.e. exactly the keys an author adds
 * to CONSTRAIN behaviour, dropped back to a permissive default without a word.
 *
 * They use {@link strictObject}, whose candidate list is read from the shape
 * itself, so these six need no drift-guard entry (and adding one would be the
 * second copy of the truth the helper exists to delete).
 *
 * Deliberately still open, both re-confirmed here rather than left to be
 * rediscovered: the node `config` slot (above), and
 * {@link FlowVersionHistorySchema} at the foot of this file (wire — see its own
 * note).
 */

/**
 * Flow Variable Schema
 * Variables available within the flow execution context.
 *
 * `defaultValue` is what makes **declared mean bound** (#4697). Without it a
 * declaration is documentation only: the engine binds an `isInput` variable
 * just when `params[name] !== undefined`, so every path that omits the
 * parameter leaves the name *unbound* — and conditions are strict CEL, where
 * reading an unbound name aborts the whole predicate rather than yielding
 * `false`. Measured on 17.0.0-rc.1 and re-measured on this shape:
 *
 * | expression      | X unbound                 | X = null | X = {f:1} |
 * | --------------- | ------------------------- | -------- | --------- |
 * | `X.f == 1`      | ABORT `Unknown variable`  | ABORT    | `true`    |
 * | `has(X.f)`      | ABORT `Unknown variable`  | `false`  | `true`    |
 * | `has(vars.X)`   | `false`                   | `true`   | `true`    |
 *
 * i.e. the guard an author reaches for first — `has(X.f)` — does not survive
 * the very case it is written for; only the `vars.`-scoped `has(vars.X)` tests
 * bindedness. That is why the answer here is a declared default rather than a
 * guard: a guard encodes "unanswered means no" into the predicate and leaves
 * the graph defect in place, while a default removes the unbound state.
 *
 * Reported from HotCRM (hotcrm#643): a screen collects a checkbox into
 * `createOpportunity`, the runner returns only the fields the user touched, and
 * the untouched path aborted the outgoing edge — a lead conversion that
 * persisted nothing. The workaround was an `assignment` node before every
 * screen, mirroring the screen field's own `defaultValue`.
 *
 * The value is **not** cross-checked against `type` — same posture as every
 * other `defaultValue` on the authoring surface (`mapping`, an action param, a
 * page state slot, a screen field): the declared `type` is itself an open
 * `string`, so there is no closed vocabulary to check against, and inventing
 * one here would be a new validation surface rather than this additive key.
 */
export const FlowVariableSchema = lazySchema(() => strictObject(
  {
    surface: 'this flow variable',
    aliases: { input: 'isInput', output: 'isOutput', default: 'defaultValue', initialValue: 'defaultValue' },
    history:
      'Until #4001 these were dropped silently — the variable still parsed, so a ' +
      'mis-declared input/output contract shipped without a diagnostic.',
  },
  {
  name: z.string().describe('Variable name'),
  type: z.string().describe('Data type (text, number, boolean, object, list)'),
  isInput: z.boolean().default(false).describe('Is input parameter'),
  isOutput: z.boolean().default(false).describe('Is output parameter'),
  defaultValue: z.unknown().optional()
    .describe(
      'Value bound at run start when no parameter supplies one — this is what makes a ' +
      'declared variable always bound. An explicitly supplied param wins, including ' +
      '`false` and `null`; the boundary is `params[name] !== undefined`.',
    ),
}));

/**
 * Flow Node Schema
 * A single step in the visual logic graph.
 * 
 * @example Decision Node
 * {
 *   id: "dec_1",
 *   type: "decision",
 *   label: "Is High Value?",
 *   config: {
 *     // Bare CEL — braces are the #1491 trap and fail at registration.
 *     // Each `label` must match an out-edge's `label` to route anywhere;
 *     // when nothing matches, the `isDefault` out-edge is the fallback.
 *     conditions: [
 *       { label: "Yes", expression: "amount > 10000" },
 *       { label: "No", expression: "true" }   // catch-all, NOT the default path
 *     ]
 *   },
 *   position: { x: 300, y: 200 }
 * }
 */
/**
 * A flow node — **including** whatever ADR-0031 region its `config` holds (#4415).
 *
 * The `.transform()` is the point of this schema, not decoration. `config` is a
 * deliberately open `z.record` (ADR-0018), so a container's nested sub-graph —
 * `loop.config.body`, `parallel.config.branches[]`, `try_catch.config.try` /
 * `.catch` — used to sail through the parse untouched: the *same* bare-string
 * predicate came back as the canonical `{ dialect: 'cel', source }` envelope on a
 * top-level edge and stayed a raw string one level down, a stored shape that
 * depended on graph depth. #4381 closed that with a post-parse pass every caller
 * had to remember to run (`normalizeControlFlowRegions`), which is an unwritten
 * rule — exactly the #4347 defect generator: a new consumer takes `FlowParsed`
 * and uses it, half-parsed and looking finished.
 *
 * Now the schema does it, so "parsed" means parsed at every depth (Prime
 * Directive #1). Nesting needs no manual recursion: a region's `nodes` are
 * `z.array(FlowNodeSchema)`, so Zod re-enters this transform on the way down.
 *
 * ## Two mechanical traps this shape carries — read before editing
 *
 * **1. It is a `ZodPipe`, not a `ZodObject`.** `.strict().transform(…)` is the
 * ADR-0089 D3a shape that once crashed `z.toJSONSchema`'s `seen` table, and
 * `FlowNodeSchema` is reached lazily from three directions (`FlowSchema.nodes`,
 * `FlowRegionSchema.nodes`, `ParallelBranchSchema.nodes`). It works because
 * `lazy-schema.ts`'s `_zod` facade aliases the Proxy's `seen` entry onto the real
 * instance, and because the generators read a pipe's **authorable side** —
 * `pipeAuthorableSide` in `scripts/lib/zod-graph.ts` returns `def.in` for an
 * `a.transform(fn)` pipe. Measured on this schema (#4415): `gen:schema` emits
 * `automation/FlowNode.json (input shape)` with the same key set as before.
 * There is no `.shape` on this export any more — reach for {@link flowNodeObject}
 * if you need the object half.
 *
 * **2. `control-flow.zod.ts` and this module are a deliberate import CYCLE.**
 * The recursion is genuinely mutual (a node holds a region, a region holds
 * nodes), so the region schemas back-reference `FlowNodeSchema`/`FlowEdgeSchema`
 * through `z.lazy(() => …)`, and the object half below is a **hoisted `function`
 * declaration**. Both are load-bearing under `OS_EAGER_SCHEMAS=1` (which
 * `gen:schema` sets, bypassing the `lazySchema` Proxy): without them module
 * evaluation reads a `const` still in its TDZ and dies with
 * `ReferenceError: Cannot access 'FlowNodeSchema' before initialization` before
 * any test runs. `flow-region-cycle.test.ts` pins both import orders in eager
 * mode so that failure can never come back silently.
 */
export const FlowNodeSchema = lazySchema(() => flowNodeObject().transform(parseFlowNodeRegions));

/**
 * The plain `ZodObject` half of {@link FlowNodeSchema} — its declared keys,
 * before the region transform turns the export into a `ZodPipe`.
 *
 * A hoisted `function` on purpose (see trap 2 above): under `OS_EAGER_SCHEMAS=1`
 * the `lazySchema` factory runs at module-evaluation time, and a `const` arrow
 * declared after it would still be in its temporal dead zone.
 */
function flowNodeObject() { return strictObject(
  {
    surface: 'this flow node',
    aliases: {
      configuration: 'config',
      settings: 'config',
      properties: 'config',
      options: 'config',
      params: 'config',
      parameters: 'config',
    },
    guidance: {
      inputs:
        '`inputs` is not a FlowNode key — a node\'s runtime inputs live under `config` ' +
        '(e.g. `config.inputs` for script/function nodes); `inputSchema` declares their types.',
    },
    history:
      'Until #4001 these were dropped silently — the node still parsed, so a mis-placed ' +
      'config shipped as a step that quietly ignored it.',
  },
  {
  id: z.string().describe('Node unique ID'),
  type: z.string().min(1).describe(
    'Action type — a built-in FlowNodeAction id or a plugin-registered node type. ' +
    'Validated against the live action registry at registerFlow() (ADR-0018), not by a closed enum.',
  ),
  label: z.string().describe('Node label'),
  
  /** Node Configuration Options (Specific to type) */
  config: z.record(z.string(), z.unknown()).optional().describe('Node configuration'),
  
  /**
   * Connector Action Configuration
   * Used when type is 'connector_action'
   *
   * This block — not `config` — IS the `connector_action` contract: the
   * executor reads nothing else (connector-nodes.ts, #4045). `input` is
   * optional to match what the executor and the designer actually do: the
   * executor dispatches with `input ?? {}`, and the Studio inspector's
   * keyValue editor omits an empty map entirely — so a required `input`
   * declared here turned a no-input action into a load failure nothing
   * downstream asked for.
   */
  connectorConfig: strictObject(
    {
      surface: "this connector_action node's `connectorConfig`",
      // The aliases are the four words the neighbouring surfaces use for the
      // same thing: `config.inputs` on a script node, `input` on the connector
      // ACTION descriptor, `params`/`parameters` in every integration product
      // an author (or an AI) imports vocabulary from. `inputs` is left to the
      // distance fallback — it is one edit away and gets there for free.
      aliases: {
        params: 'input',
        parameters: 'input',
        arguments: 'input',
        payload: 'input',
      },
      history:
        'Until #4001 these were dropped silently — the block still parsed, so a whole ' +
        'mapped input map written under another word vanished and the executor ' +
        'dispatched the action with `input ?? {}`: a successful call carrying nothing.',
    },
    {
      connectorId: z.string().describe('Registered connector name'),
      actionId: z.string().describe('Action key declared by the connector'),
      input: z.record(z.string(), z.unknown()).optional().describe('Mapped inputs for the action'),
    },
  ).optional(),

  /**
   * UI Position (for the canvas).
   *
   * No alias table on purpose: `{ x, y }` is the same two keys React Flow (the
   * Studio canvas) and BPMN DI both use, so there is no neighbouring vocabulary
   * to import from — and the campaign's rule is that an alias entry is an
   * empirical claim, not a precaution. The distance fallback covers `X` / `Y`.
   */
  position: strictObject(
    {
      surface: "this node's canvas `position`",
      history:
        'Until #4001 these were dropped silently — the block still parsed, so a canvas ' +
        'hint written beside x/y (a size, a third coordinate, a designer marker) was ' +
        'discarded, and the round-trip back through the designer could not tell it had ' +
        'ever been written.',
    },
    { x: z.number(), y: z.number() },
  ).optional(),

  /** Node-level execution timeout */
  timeoutMs: z.number().int().min(0).optional().describe('Maximum execution time for this node in milliseconds'),

  /** Node input schema declaration for Studio form generation and runtime validation */
  inputSchema: z.record(z.string(), strictObject(
    {
      surface: "this node input parameter's declaration",
      guidance: {
        // A rename would be actively wrong here: `optional: true` and
        // `required: true` are opposite claims, so pointing an author at
        // `required` without saying to flip the value is the "confidently
        // wrong prescription" this campaign has shipped before. Say the flip.
        optional:
          'There is no `optional` on an input parameter — the polarity is the other way ' +
          'round. Write `required: false` (which is also the default, so the key can just ' +
          'be dropped); `optional: true` is `required: false`, and `optional: false` is ' +
          '`required: true`.',
      },
      history:
        'Until #4001 these were dropped silently — the declaration still parsed, so a ' +
        'parameter constrained under a word we do not declare (`optional: false`) came ' +
        'back UNconstrained: `required` fell to its `false` default, and the engine\'s ' +
        'pre-execution check (`validateNodeInputSchemas`) then had nothing to require.',
    },
    {
      type: z.enum(['string', 'number', 'boolean', 'object', 'array']).describe('Parameter type'),
      required: z.boolean().default(false).describe('Whether the parameter is required'),
      description: z.string().optional().describe('Parameter description'),
    },
  )).optional().describe('Input parameter schema for this node'),

  // `outputSchema` REMOVED (#3896 audit close-out): declared, never validated —
  // no engine path checked node outputs against it (ledger: dead).
  outputSchema: retiredKey(
    '`flow.nodes[].outputSchema` was removed in @objectstack/spec 17.0.0 (#3896 audit ' +
    'close-out) — it was never validated: the engine does not check node outputs against ' +
    'it, so it documented a contract nothing enforced. Delete the key. Downstream nodes ' +
    "read prior outputs via expressions ({{nodeId.field}}) regardless of any declaration. " +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),

  /**
   * Wait Event Configuration (for 'wait' nodes)
   * Defines what external event or condition should resume the paused execution.
   * Industry alignment: BPMN Intermediate Catch Events, Temporal Signals.
   */
  waitEventConfig: strictObject({
    surface: "this wait node's `waitEventConfig`",
    aliases: {
      // Different WORD, same intent — none of these is within edit distance of
      // the key it means. `duration`/`delay` are what the two neighbouring
      // retry/timer shapes in this repo call a millisecond span.
      event: 'eventType',
      signal: 'signalName',
      duration: 'timerDuration',
      delay: 'timerDuration',
    },
    guidance: {
      // Deliberately NOT an alias to `timeoutMs`: that key is a tombstone
      // (below) and pointing a typo at a removed key is how the campaign's own
      // helper once told an author to write something that gets rejected next.
      timeout:
        '`wait` has no timeout — nothing has ever failed or resumed a wait on a deadline ' +
        '(#4158 retired the two keys that claimed one). Use `timerDuration`, and QUOTE the ' +
        'number: the key is a string, and a bare numeric string is read as milliseconds, so ' +
        "`timerDuration: '60000'` is a 60s wait (`timerDuration: 'PT1M'` says the same in ISO 8601).",
    },
    history:
      'Until #4001 these were dropped silently — the block still parsed, so a wait node ' +
      'whose resume condition the author spelled slightly wrong waited on nothing.',
  }, {
    /** Type of event to wait for */
    eventType: z.enum(['timer', 'signal', 'webhook', 'manual', 'condition'])
      .describe('What kind of event resumes the execution'),
    /** Duration to wait (ISO 8601 duration or milliseconds) — for timer events */
    timerDuration: z.string().optional().describe('ISO 8601 duration (e.g., "PT1H") or wait time for timer events'),
    /** Signal name to listen for — for signal/webhook events */
    signalName: z.string().optional().describe('Named signal or webhook event to wait for'),

    /**
     * `wait` never had a timeout. Both keys below described one and neither
     * delivered it (#4158) — the pair is retired in 17 rather than left standing
     * as a promise the runtime does not keep (PD #10). (Both tombstones below say
     * 17 and the ADR-0087 conversion is `toMajor: 17`; this line said 18, the
     * #4350 class — a tombstone naming a major that never shipped it.)
     *
     * `timeoutMs` said "maximum wait time" and its ONLY reader used it as the
     * timer *duration* when `timerDuration` was absent — so it did something, just
     * not what it said. `timerDuration` already expresses that (`parseIsoDuration`
     * reads a bare numeric *string* as milliseconds — the number must be quoted,
     * because `timerDuration` is `z.string()` and the schema is what the author
     * meets), which is why the conversion can move it losslessly, stringifying on
     * the way, instead of dropping it.
     *
     * `onTimeout` had ZERO readers anywhere. Setting it changed nothing, and the
     * showcase set it — a declared default (`'fail'`) stamped on every wait node
     * that no code ever consulted.
     *
     * Real timeout semantics — resume the run at a deadline and either fail the
     * node or continue past it — remain unimplemented. If they are wanted, they
     * should be built to a requirement, not retrofitted to fit two keys that
     * happened to be declared.
     */
    timeoutMs: retiredKey(
      '`waitEventConfig.timeoutMs` was removed in @objectstack/spec 17 (#4158). It documented a '
      + 'timeout guard that never existed: nothing ever failed or resumed a wait on a deadline. Its '
      + 'only reader treated it as the timer DURATION when `timerDuration` was absent, so use '
      + '`timerDuration` — but QUOTE the number: the key is a string, and a bare numeric string is '
      + "read as milliseconds, making `timeoutMs: 60000` and `timerDuration: '60000'` the same wait "
      + "(`timerDuration: 'PT1M'` is the ISO 8601 spelling of that same 60s). Stored flows are "
      + 'converted automatically — the conversion does the quoting for you. '
      + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
    ),
    onTimeout: retiredKey(
      '`waitEventConfig.onTimeout` was removed in @objectstack/spec 17 (#4158). It had no readers at '
      + 'all — no code path ever inspected it, so neither `fail` nor `continue` ever happened. Delete '
      + 'the key. There is no replacement: `wait` has no timeout, and a wait node resumes only when '
      + 'its timer elapses or its signal arrives. '
      + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
    ),
  }).optional().describe('Configuration for wait node event resumption'),

  /**
   * Boundary Event Configuration (for 'boundary_event' nodes)
   * Attaches an event handler to a host activity node (BPMN Boundary Event pattern).
   * Industry alignment: BPMN Boundary Error/Timer/Signal Events.
   */
  boundaryConfig: strictObject({
    surface: "this boundary event's `boundaryConfig`",
    aliases: {
      // This block's own doc claims BPMN alignment, and `bpmn-interop.zod.ts`
      // exists so a third-party definition can be imported — so BPMN's OWN
      // attribute names are exactly the words an author arrives with.
      // `attachedToRef` and `cancelActivity` are verbatim BPMN 2.0 spellings
      // of the two keys below, and neither is within edit distance of it.
      attachedToRef: 'attachedToNodeId',
      attachedTo: 'attachedToNodeId',
      hostNodeId: 'attachedToNodeId',
      cancelActivity: 'interrupting',
      event: 'eventType',
      signal: 'signalName',
      duration: 'timerDuration',
    },
    history:
      'Until #4001 these were dropped silently — the block still parsed, so BPMN\'s ' +
      '`cancelActivity: false` was discarded and `interrupting` fell to its `true` ' +
      'default: an event the author declared NON-interrupting cancelled the host ' +
      'activity anyway.',
  }, {
    /** ID of the host node this boundary event is attached to */
    attachedToNodeId: z.string().describe('Host node ID this boundary event monitors'),
    /** Type of boundary event */
    eventType: z.enum(['error', 'timer', 'signal', 'cancel'])
      .describe('Boundary event trigger type'),
    /** Whether the boundary event interrupts the host activity */
    interrupting: z.boolean().default(true)
      .describe('If true, the host activity is cancelled when this event fires'),
    /** Error code filter — only for error boundary events */
    errorCode: z.string().optional().describe('Specific error code to catch (empty = catch all errors)'),
    /** Timer duration — only for timer boundary events */
    timerDuration: z.string().optional().describe('ISO 8601 duration for timer boundary events'),
    /** Signal name — only for signal boundary events */
    signalName: z.string().optional().describe('Named signal to catch'),
  }).optional().describe('Configuration for boundary events attached to host nodes'),
}); }

/**
 * Flow Edge Schema
 * Connections between nodes.
 */
export const FlowEdgeSchema = lazySchema(() => strictObject(
  {
    surface: 'this flow edge',
    aliases: {
      // n8n / mermaid / BPMN-tool vocabulary an author (or AI) imports wholesale.
      from: 'source',
      to: 'target',
      sourceid: 'source',
      targetid: 'target',
      expression: 'condition',
      when: 'condition',
      guard: 'condition',
    },
    history:
      'Until #4001 these were dropped silently — the edge still parsed, so a branch ' +
      'predicate or endpoint the author wrote was quietly ignored.',
  },
  {
  id: z.string().describe('Edge unique ID'),
  source: z.string().describe('Source Node ID'),
  target: z.string().describe('Target Node ID'),
  
  /** Condition for this path (only for decision/branch nodes) */
  condition: ExpressionInputSchema.optional().describe('Predicate (CEL) returning boolean used for branching.'),
  
  type: z.enum(['default', 'fault', 'conditional', 'back'])
    .default('default')
    .describe(
      'Connection type: default (normal flow), fault (error path), conditional (expression-guarded), '
      + 'or back (ADR-0044 declared back-edge — traversed normally at run time, but excluded from DAG '
      + 'cycle validation so a revise/rework loop can re-enter an earlier node)',
    ),
  label: z.string().optional().describe('Label on the connector'),

  /**
   * Default Sequence Flow marker (BPMN Default Flow semantics).
   *
   * When true, this edge is traversed only when NO sibling conditional edge of
   * the same source node matched — the "otherwise" branch. A default edge is
   * therefore not part of the unconditional parallel fan-out; when a conditional
   * sibling wins, this edge's target records a `skipped` step instead.
   *
   * Enforced by `AutomationEngine.traverseNext` since #4414. It had promised
   * exactly this since it was declared and had **zero readers** for as long: an
   * author who marked the fallback edge got an ordinary unconditional edge that
   * ran on every pass, alongside whichever branch actually matched. Combining it
   * with `condition` on the same edge is self-contradictory (BPMN forbids a
   * conditional default flow) and is flagged by the `os build` / `os validate`
   * flow linter, as is a second default edge out of the same node.
   */
  isDefault: z.boolean().default(false)
    .describe(
      'BPMN default flow: traverse this edge only when no sibling conditional edge of the same '
      + 'source node matched. Mutually exclusive with `condition`; at most one per source node.',
    ),
}));

/**
 * Flow Schema
 * Visual Business Logic Orchestration.
 * 
 * @example Simple Approval Logic
 * {
 *   name: "approve_order_flow",
 *   label: "Approve Large Orders",
 *   type: "record_change",
 *   status: "active",
 *   nodes: [
 *     { id: "start", type: "start", label: "Start", position: {x: 0, y: 0} },
 *     { id: "check_amount", type: "decision", label: "Check Amount", position: {x: 0, y: 100} },
 *     { id: "auto_approve", type: "update_record", label: "Auto Approve", position: {x: -100, y: 200} },
 *     { id: "submit_for_approval", type: "connector_action", label: "Submit", position: {x: 100, y: 200} }
 *   ],
 *   edges: [
 *     { id: "e1", source: "start", target: "check_amount" },
 *     // Conditions are bare CEL (ADR-0032). Reference fields directly —
 *     // `record.amount`, `previous.status`, `<var>.field` — and DO NOT wrap them
 *     // in `{…}` template braces: `{amount}` parses as a CEL map literal and fails.
 *     { id: "e2", source: "check_amount", target: "auto_approve", condition: "record.amount < 500" },
 *     { id: "e3", source: "check_amount", target: "submit_for_approval", condition: "record.amount >= 500" }
 *   ]
 * }
 */
export const FlowSchema = lazySchema(() => strictObject(
  {
    surface: 'this flow',
    aliases: {
      steps: 'nodes',
      connections: 'edges',
      transitions: 'edges',
      links: 'edges',
      trigger: 'type',
      triggertype: 'type',
      title: 'label',
    },
    guidance: {
      object:
        '`object` is not a Flow field — a record-change flow binds its object on the ' +
        'START node\'s `config` (`{ objectName, triggerType, condition }`), not at the ' +
        'flow top level.',
      objectName:
        '`objectName` is not a Flow field — it belongs on the START node\'s `config` ' +
        '(`{ objectName, triggerType, condition }`), not at the flow top level.',
      schedule:
        '`schedule` is not a Flow field — a schedule flow declares its cron/interval as ' +
        '`config.schedule` on the START node, not at the flow top level.',
    },
    history:
      'Until #4001 these were dropped silently — the flow still parsed, so a trigger ' +
      'binding or config the author wrote was quietly ignored.',
  },
  {
  /** Identity */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Machine name'),
  label: z.string().describe('Flow label'),
  description: z.string().optional(),

  /**
   * Terminal messages for the flow. Since #9414, carried on EVERY terminal
   * run — `execute()`'s exit, both `retryExecution()` exits, and the resume
   * exit — not only on `screen`-flow runs. The pair is set on the terminal
   * {@link AutomationResult} (`successMessage` on success, `errorMessage` on
   * failure) returned by any trigger route (e.g.
   * `POST /api/v1/automation/:name/trigger`), whether or not a UI is
   * listening; a `screen`-flow run additionally has the UI flow-runner show
   * `successMessage` as a toast instead of a generic "Done", and
   * `errorMessage` instead of the raw error. Reading this pair as
   * screen-flow-only was the alternative considered and rejected at #9414's
   * triage — narrowing the text would delete a declared, documented,
   * console-consumed capability to make a bug disappear — so treat the
   * screen-flow toast as one consumer, not the whole contract. Plain
   * strings; `{var}` is NOT interpolated here.
   */
  successMessage: z.string().optional().describe('Message carried on AutomationResult for every terminal run (not only screen flows); the screen-flow UI shows it as a toast instead of a generic "Done".'),
  errorMessage: z.string().optional().describe('Message carried on AutomationResult for every terminal run (not only screen flows); the screen-flow UI shows it as a toast instead of the raw error.'),

  /** Metadata & Versioning */
  version: z.number().int().default(1).describe('Version number'),
  status: z.enum(['draft', 'active', 'obsolete', 'invalid']).default('draft').describe('Deployment status'),
  // `template` REMOVED (#3896 audit close-out): no reader in designer or engine.
  template: retiredKey(
    '`flow.template` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — ' +
    'no designer or engine path ever read it, so flagging a flow as a template/subflow did ' +
    'nothing. Delete the key. Shared logic is invoked via a subflow NODE referencing the ' +
    'flow by name. ' +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),

  /** Trigger Type */
  type: z.enum(['autolaunched', 'record_change', 'schedule', 'screen', 'api']).describe('Flow type'),
  
  /** Configuration Variables */
  variables: z.array(FlowVariableSchema).optional().describe('Flow variables'),
  
  /** Graph Definition */
  nodes: z.array(FlowNodeSchema).describe('Flow nodes'),
  edges: z.array(FlowEdgeSchema).describe('Flow connections'),
  
  // `active` REMOVED (#3896 audit close-out) — the rls.enabled shape, in the
  // over-permissive direction: the spec default was `false` while the engine
  // treated an unset flow as ENABLED, and `active: false` never stopped a flow
  // (`status` is the enforced lifecycle). An author who "disabled" a flow here
  // left it firing.
  active: retiredKey(
    '`flow.active` was removed in @objectstack/spec 17.0.0 (#3896 audit close-out) — it ' +
    'never had an effect: the engine arms flows from `status`, and `active: false` did NOT ' +
    'stop a flow (worse, the default read as disabled while the engine treated unset as ' +
    "enabled). Delete the key. Use `status: 'obsolete'` (or 'invalid') to unbind and " +
    "disable a flow, `status: 'active'` to arm it. " +
    'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
  ),
  // ADR-0049 / #1888 — ENFORCED. The service-automation engine establishes the
  // declared identity for the run's data operations and restores the caller's
  // context afterward: `system` runs elevated (a full-access, RLS-bypassing
  // system principal); `user` (default) runs as the triggering user, so CRUD
  // nodes' ObjectQL reads/writes respect that user's row-level security.
  //
  // A run under `user` that resolves NO trigger user has nothing to scope to, so
  // its data operations are REFUSED (#3760). This is NOT a schedule-only case —
  // it is any run whose trigger supplied no user, and the commonest by far is a
  // record-change flow fired by a write that carried none (any `isSystem`
  // plugin/service write; `isSystem` does not suppress trigger dispatch, only
  // `skipTriggers` does). Declare `system` to make the elevation explicit.
  runAs: z
    .enum(['system', 'user'])
    .default('user')
    .describe(
      'Execution identity for the run: system = elevated (bypasses RLS), user = the triggering user (RLS-respecting). ' +
        'A run with no trigger user has no identity to scope to, so under user its data operations are REFUSED — ' +
        'declare system to make the elevation explicit. This covers schedule/time-relative/api triggers AND any ' +
        'record-change flow fired by a write that carried no user.',
    ),

  /**
   * Error Handling Strategy.
   *
   * The retry knobs are the converged `RetryPolicySchema` contract, shared with
   * `job.retryPolicy` and a `try_catch` node's `retry` (#4661 + #4964 — see
   * `shared/retry-policy.zod.ts`; `ETLPipeline.retry` did the same until #6414
   * retired the L2 ETL layer). Until 17 this block spelled the base delay
   * `retryDelayMs` while the converged policy spelled it `backoffMs`, so an
   * author who read the newer file and brought the word here had it silently
   * stripped (pre-批 11) or rejected (post-批 11) — being punished for learning
   * the canonical spelling. `strategy` stays here: it selects *whether* the
   * policy runs, it is not part of the policy.
   *
   * **These defaults are the only defaults** (#4247). The engine reads the
   * parsed block field-by-field with no fallback of its own — `retryExecution`
   * used to carry `errorHandling.maxRetries ?? 3` beside a schema that said
   * `.default(0)`, so "how many times does an under-specified flow retry?" had
   * two answers and the winner depended on whether that flow had been through
   * `FlowSchema` (0) or hand-built and fed to the engine directly (3). One
   * contract, one number: whatever this block parses to is what runs.
   *
   * The retry knobs are read **only** under `strategy: 'retry'`; `'fail'` and
   * `'continue'` ignore them (a fully spelled-out block under `'fail'` is
   * common and stays legal).
   */
  errorHandling: strictObject({
    surface: "this flow's `errorHandling` block",
    aliases: {
      // Every one of these is a real, in-repo spelling of the same knob on a
      // NEIGHBOURING retry surface — which is what makes this table an
      // empirical claim rather than a guess about typos:
      //   `integration/connector.zod.ts` RetryConfig → `initialDelayMs`,
      //     `maxDelayMs`.
      // `retries`/`attempts` are the plain-English forms; `onError` is n8n's
      // word for the strategy switch.
      //
      // `backoffMs` was HERE until #4964, pointing at `retryDelayMs` — i.e.
      // this table used to punish an author for having read the newer file
      // (`shared/retry-policy.zod.ts` tombstoned `retryDelayMs` as "the
      // automation-side spelling" in #4661, and then this surface still
      // demanded it). The alias is gone because the divergence is gone: the
      // block now builds from `retryPolicyShape()`, `backoffMs` IS the key,
      // and `retryDelayMs` is the tombstone that arrives with it.
      initialDelayMs: 'backoffMs',
      maxDelayMs: 'maxRetryDelayMs',
      retries: 'maxRetries',
      attempts: 'maxRetries',
      onError: 'strategy',
    },
    guidance: {
      // NOT an alias. `maxAttempts` (connector RetryConfig) counts the FIRST
      // attempt; `maxRetries` counts the ones after it. A bare rename would
      // silently change the number's meaning by one — the exact shape of the
      // four wrong prescriptions this campaign shipped and had to withdraw.
      maxAttempts:
        '`maxAttempts` is the connector/RetryConfig spelling and INCLUDES the first attempt; ' +
        'flow `errorHandling` counts retries AFTER it. Write `maxRetries: <maxAttempts - 1>` ' +
        '— renaming the key alone would quietly run one attempt fewer than you asked for.',
      fallback:
        'There is no fallback node on `errorHandling` (`fallbackNodeId` was removed in 17, ' +
        '#3896 — the engine never read it). Draw a per-node FAULT EDGE from the failing node ' +
        'to the handler node instead.',
      fallbackNode:
        'There is no fallback node on `errorHandling` (`fallbackNodeId` was removed in 17, ' +
        '#3896 — the engine never read it). Draw a per-node FAULT EDGE from the failing node ' +
        'to the handler node instead.',
    },
    history:
      'Until #4001 these were dropped silently — the block still parsed, so a retry budget ' +
      'or backoff the author configured was replaced by this block\'s defaults without a word. ' +
      'Since #4964 the retry keys are the converged `RetryPolicySchema` contract, so a spelling ' +
      'learned on `job.retryPolicy` or a `try_catch` node\'s `retry` is correct here too.',
  }, {
    strategy: z.enum(['fail', 'retry', 'continue']).default('fail').describe('How to handle node execution errors'),

    // ── The retry policy itself: ONE declaration (#4964) ────────────────
    // `maxRetries` / `backoffMs` / `backoffMultiplier` / `maxRetryDelayMs` /
    // `jitter`, plus the `retryDelayMs` tombstone, all arrive from
    // `shared/retry-policy.zod.ts`. Before #4964 they were hand-copied here,
    // and the copy had drifted in exactly one word — this block spelled the
    // base delay `retryDelayMs` where the converged policy spells it
    // `backoffMs`. Every other key, bound and default already matched, which
    // is what made the divergence so durable: it looked reviewed.
    //
    // The spread is what keeps that from happening again. A key added to the
    // policy lands on all three surfaces at once, instead of on the ones
    // whoever added it happened to grep for.
    ...retryPolicyShape(),

    // The ONE site-specific override, and it is prose only — same type, same
    // bounds, same default, all still single-sourced above. `.describe()`
    // lands in `content/docs/references/`, and the flow surface has a reading
    // the other two do not: the count is read only under `strategy:
    // 'retry'`, where the `superRefine` below then requires >= 1 (#4247).
    // Default 0 = "no retries" is the right reading for the two strategies
    // that never retry; under `'retry'` it would mean "retry, zero times",
    // refused below rather than defaulted to some count, because a retry
    // re-runs the WHOLE flow (CRUD side effects and all) and nobody should
    // have that number picked for them.
    maxRetries: retryPolicyShape().maxRetries
      .describe("Retry attempts after the initial one. Read only under strategy: 'retry', which requires >= 1; 0 (the default) means no retry."),

    // `fallbackNodeId` REMOVED (#3896 audit close-out): the engine routes
    // unrecoverable errors via per-node FAULT EDGES, never this — an author
    // who configured a fallback here had none.
    fallbackNodeId: retiredKey(
      '`flow.errorHandling.fallbackNodeId` was removed in @objectstack/spec 17.0.0 (#3896 ' +
      'audit close-out) — the engine routes unrecoverable node errors via per-node fault ' +
      "edges (an edge with type: 'fault'), and never read this key: a fallback " +
      'configured here silently did not exist. Delete the key and draw a fault edge from ' +
      'the failing node to the handler node instead. ' +
      'Run `os migrate meta --from 16` to rewrite existing sources automatically.',
    ),
  }).superRefine((eh, ctx) => {
    // `strategy: 'retry'` with 0 attempts is `strategy: 'fail'` wearing a
    // different label — the flow runs once and stops. That is a declared
    // capability the runtime does not deliver (AGENTS.md Prime Directive #10
    // corollary), and omitting `maxRetries` produced exactly it. Refuse the
    // combination in both spellings — written 0 and defaulted 0 — so the
    // attempt count is stated wherever retrying is asked for.
    if (eh.strategy === 'retry' && eh.maxRetries < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxRetries'],
        message:
          "`errorHandling.strategy: 'retry'` requires `maxRetries` >= 1 — retrying zero " +
          "times is exactly `strategy: 'fail'`, so a flow that omits the count (it " +
          'defaults to 0) or writes 0 never retries. State the attempts explicitly ' +
          "(e.g. `maxRetries: 3`), or use `strategy: 'fail'` if no retry is wanted. " +
          'Note a retry re-runs the WHOLE flow, so side-effecting nodes run again.',
      });
    }
  }).optional().describe('Flow-level error handling configuration'),
  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this flow.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,

}));

/**
 * Type-safe factory for creating flow definitions.
 *
 * Validates the config at creation time using Zod `.parse()`.
 *
 * @example
 * ```ts
 * const onCreateFlow = defineFlow({
 *   name: 'on_task_create',
 *   label: 'On Task Create',
 *   type: 'record_change',
 *   nodes: [
 *     { id: 'start', type: 'start', label: 'Start' },
 *     { id: 'end', type: 'end', label: 'End' },
 *   ],
 *   edges: [{ id: 'e1', source: 'start', target: 'end' }],
 * });
 * ```
 */
export function defineFlow(config: z.input<typeof FlowSchema>): FlowParsed {
  return FlowSchema.parse(config);
}

export type Flow = z.input<typeof FlowSchema>;
export type FlowParsed = z.infer<typeof FlowSchema>;
export type FlowNode = z.input<typeof FlowNodeSchema>;
export type FlowNodeParsed = z.infer<typeof FlowNodeSchema>;
export type FlowEdge = z.input<typeof FlowEdgeSchema>;
export type FlowEdgeParsed = z.infer<typeof FlowEdgeSchema>;

/**
 * Flow Version History Schema
 * Tracks historical versions of flow definitions for rollback support.
 *
 * Industry alignment: Salesforce Flow Versions, n8n Workflow History.
 *
 * ## Deliberately NOT `.strict()` — stop here (#4001 batch 11)
 *
 * Every other object site in this module is closed, so the next sweep will read
 * this one as the last hold-out and reach for `strictObject`. It is not a
 * hold-out: it is the only WIRE shape in the file, and the strictness ledger's
 * `automation/flow.zod.ts` row has exempted it since the row was written.
 *
 * Nobody authors a version-history record. The engine/Studio EMIT one when a
 * flow is published — `flowName` / `version` / `createdAt` / `createdBy` are
 * stamped by the writer, not typed by a person — so the asymmetry that makes
 * strictness right everywhere else (author writes it, a dropped key is a silent
 * defect they own) does not hold: here an added field is *our* enrichment, and
 * closing this shape would turn a future emitter-side addition into a parse
 * failure for anyone reading history they were handed. Same reasoning, and the
 * same verdict, as `HookContextSchema` and the `execution.zod.ts` run-state
 * envelopes.
 *
 * `definition` is the authored half, and it is already strict — it references
 * {@link FlowSchema}, so the flow inside a history record is validated by the
 * gate above, exactly where the author's keys are.
 */
export const FlowVersionHistorySchema = lazySchema(() => z.object({
  flowName: z.string().describe('Flow machine name'),
  version: z.number().int().min(1).describe('Version number'),
  definition: FlowSchema.describe('Complete flow definition snapshot'),
  createdAt: z.string().datetime().describe('When this version was created'),
  createdBy: z.string().optional().describe('User who created this version'),
  changeNote: z.string().optional().describe('Description of what changed in this version'),
}));

export type FlowVersionHistory = z.input<typeof FlowVersionHistorySchema>;
export type FlowVersionHistoryParsed = z.infer<typeof FlowVersionHistorySchema>;
