// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-node-expression-paths
 *
 * **Ledger of expression-bearing flow-node config paths** (#4027).
 *
 * A flow node's `config` is `z.record(z.unknown())` — deliberately open, because
 * node types are extensible and each owns its own config shape. The consequence
 * is that the *only* machine-readable description of a node's config is the
 * designer `configSchema` its executor publishes, and nothing connected that to
 * validation. Two separate validators — the engine's `registerFlow` pass and the
 * author-time `@objectstack/lint` pass — each hardcoded the list of config keys
 * that hold expressions (`config.condition`, `edge.condition`) rather than
 * asking the descriptor. A declared expression key outside that hardcoded list
 * was therefore never validated by anyone.
 *
 * That is exactly how #3528 shipped. `screen.fields[].visibleWhen` is declared
 * bare CEL (`xExpression: 'expression'` on the `screen` descriptor since #3304),
 * but neither validator traversed it, so an app authored the predicate in the
 * *other* dialect — `'{createOpportunity} == true'`, the `{var}` template form
 * used correctly by sibling config keys — and it passed `tsc`, passed
 * `objectstack validate`, passed registration, and dead-ended the flow's screen
 * at run time with no diagnostic anywhere.
 *
 * This ledger is the declared source both validators now read, mirroring the
 * dispatcher↔client route ledger of #3569: one list, two consumers, plus a
 * reconciliation test that fails when a declared `xExpression` property this
 * ledger does not carry appears anywhere
 * (`config-expression-ledger.test.ts` in `service-automation`). A new expression
 * key can no longer be added to a designer form and silently go unvalidated.
 *
 * ## The two channels a slot can be declared through
 *
 * A node type declares its config contract one of two ways, and the ratchet
 * reads both (#4439):
 *
 *  - **descriptor `configSchema`** — the JSON-Schema literal an executor
 *    publishes. Its `xExpression` properties are enumerable from the live
 *    registry.
 *  - **`schemaless-node-config.zod.ts`** — `script` / `subflow` / `decision`
 *    publish NO descriptor `configSchema` on purpose (a published partial
 *    schema would drop the editors their hand-written forms need — the #4210
 *    incident), so their contract is a Zod schema in that module and the marker
 *    rides `.meta({ xExpression })` through `z.toJSONSchema`, the same channel
 *    `loop.collection` already used.
 *
 * Until #4439 only the first channel was read, and because the ratchet also
 * fails on a ledger entry no channel declares, a schemaless node's expression
 * slot could not be entered here even deliberately. `decision`'s
 * `conditions[].expression` sat in exactly that hole: declared bare CEL by its
 * own schema and its own comments, walked by neither validator, so a `{…}`
 * predicate passed `objectstack validate` and surfaced only when the flow ran
 * (#4414 made that run-time failure loud; this makes it a build failure).
 *
 * ## Why the dialect must be recorded, not assumed
 *
 * `xExpression` takes two values that mean **opposite** things about braces, and
 * there are in fact *three* dialects in play across the platform:
 *
 *  - `'expression'` → **bare CEL**. `{…}` is the #1491 brace-trap and a hard error.
 *  - `'template'` → **single-brace `{var}` flow interpolation**, the dialect
 *    `interpolate()` implements for flow node config. `{…}` is the *correct*
 *    spelling here.
 *  - The **double-brace `{{ }}` text template** of ADR-0032 §3, which is what
 *    `validateExpression`'s `'template'` role enforces — a different dialect from
 *    the one above, and not the one flow config uses.
 *
 * A dialect-blind check would be worse than none: it would reject every correct
 * `loop.collection` while still passing every wrong `visibleWhen`. Each entry
 * therefore records the dialect, and only those with a validator that actually
 * implements that dialect are checked.
 */

/**
 * The dialect a declared expression slot takes — and therefore what, if
 * anything, can validate it today.
 */
export type FlowNodeExpressionRole =
  /**
   * Bare CEL — a boolean predicate. `{…}` braces are the #1491 brace-trap.
   * Validated by `validateExpression('predicate', …)` at both registration and
   * `objectstack validate`.
   */
  | 'predicate'
  /**
   * Single-brace `{var}` flow interpolation, resolved by `interpolate()` against
   * the flow's live variables.
   *
   * **Declared but not validated.** No validator implements this dialect: the
   * `'template'` role of `validateExpression` enforces the ADR-0032 §3
   * *double-brace* text template and rejects a single `{x}` as a legacy hole, so
   * routing these slots through it would fail every correct `loop.collection` in
   * every existing flow. Recorded here so the reconciliation ratchet still sees
   * the marker and a future validator has one place to hook into.
   */
  | 'flow-template'
  /**
   * A CEL **value** expression — evaluated by the expression engine to the
   * value the variable takes (`validateExpression`'s `'value'` role: parses as
   * CEL, any result type). Not a predicate (no boolean expected) and not a
   * template (no `{token}` holes): the slot's *shape* decides which dialect it
   * is in. A `value` slot is a config position whose authored value is EITHER
   * the `{token}` flow interpolation every node string already gets (a plain
   * string — the `flow-template` dialect above, still unvalidated here) OR an
   * `{ dialect: 'cel', source }` expression envelope (`ExpressionSchema` in
   * `shared/expression.zod.ts`) evaluated to a value. Only the envelope form is
   * an expression to check, so {@link resolveFlowNodeExpressions} emits
   * envelope-shaped objects — never strings — for this role (#14149).
   *
   * Declared for the `assignment` node's `assignments` map (maintainer ruling
   * 2026-09-02, #14149): that is the one slot whose whole job is to compute a
   * value into a variable, and until then CEL was reachable only where the
   * answer had to be a boolean — so the declared stdlib (`joinNonEmpty` and the
   * rest of `CEL_STDLIB_FUNCTIONS`) was unreachable from metadata. Validated at
   * `registerFlow` and `objectstack validate` by the executor-side half
   * (`service-automation` / `lint` consumers call
   * `validateExpression('value', …)` on what this ledger resolves); the same
   * half evaluates the envelope at run time. Until it lands the built-in
   * `assignment` executor writes an envelope object into the variable verbatim
   * (`interpolate()` recurses into it as a literal object) — the contract is
   * declared here first so the executor has one shape to implement.
   */
  | 'value';

/** One expression-bearing config slot on a builtin flow node type. */
export interface FlowNodeExpressionPath {
  /** Registry node type the path belongs to (`node.type`). */
  readonly nodeType: string;
  /**
   * Dot path into `node.config`, using `[]` for "every element of this array"
   * and a `*` segment for "every key of this object" (#14149).
   * `'fields[].visibleWhen'` reads `config.fields[i].visibleWhen` for each `i`;
   * `'assignments.*'` reads `config.assignments[k]` for each authored key `k`
   * — the spelling for a map whose keys are the author's own names (variable
   * names, field names) and so cannot be enumerated by the ledger.
   */
  readonly path: string;
  /** Which dialect this slot takes — decides what counts as malformed. */
  readonly role: FlowNodeExpressionRole;
  /** Author-facing label for diagnostics, e.g. `screen field visibleWhen`. */
  readonly label: string;
}

/**
 * Every expression slot declared by a builtin node's `configSchema`.
 *
 * Kept in sync with the live descriptors by the reconciliation test — add an
 * `xExpression` property to a builtin `configSchema` without adding it here and
 * CI fails, which is the regression guard #3528 lacked.
 *
 * Not listed here (deliberately): `config.condition` and `edge.condition`. Those
 * are *structural* predicate surfaces on every node and edge rather than
 * declared config properties, and both validators already walk them.
 *
 * Also deliberately absent: config values that merely INTERPOLATE `{token}`
 * templates — `script.inputs` / `script.variables` / `subflow.input`,
 * `notify.body`, `create_record.fields.*` and so on. Those are text-with-holes,
 * the shape essentially every node config string has, already covered
 * generically (`validate-flow-template-paths`, the CLI flow linter's
 * `collectTemplateStrings`). A `flow-template` ledger entry means something
 * narrower: a slot whose value is a *reference that must resolve to a value*,
 * like `loop.collection`. The #4439 sweep of the schemaless class found exactly
 * one genuinely declared expression slot — `decision.conditions[].expression` —
 * and `script.template` is a template **id**, not a template body.
 *
 * A `value` entry (#14149) is listed for a third reason, not either of those:
 * the slot's authored value may be an expression *envelope* — `{ dialect:
 * 'cel', source }`, a shape no `{token}` interpolation ever produced — and only
 * that form is resolved. The `assignment` node's `assignments` map is the one
 * such slot; its `{token}` strings stay the generic text-with-holes case above.
 * It is declared through a third channel, the spec Zod contract
 * (`AssignmentConfigSchema`'s map value, `.meta({ xExpression: 'value' })`),
 * because the node's descriptor declares the map as `additionalProperties:
 * true` with no marker and the ratchet's role table knows no `value` marker —
 * teaching the ratchet that channel (walk `additionalProperties` as `*`, map
 * `value` → `'value'`) is the executor half's edit, in `service-automation`.
 */
export const FLOW_NODE_EXPRESSION_PATHS: readonly FlowNodeExpressionPath[] = [
  {
    nodeType: 'screen',
    path: 'fields[].visibleWhen',
    role: 'predicate',
    label: 'screen field visibleWhen',
  },
  {
    // Declared through the schemaless channel — `decision` publishes no
    // descriptor `configSchema`, so the marker lives on
    // `DecisionConditionSchema.expression`'s `.meta()` (#4439).
    nodeType: 'decision',
    path: 'conditions[].expression',
    role: 'predicate',
    label: 'decision branch expression',
  },
  {
    nodeType: 'loop',
    path: 'collection',
    role: 'flow-template',
    label: 'loop collection',
  },
  {
    nodeType: 'map',
    path: 'collection',
    role: 'flow-template',
    label: 'map collection',
  },
  {
    // The `assignment` node's canonical config is the `assignments` map its
    // descriptor and the Studio keyValue editor declare — `{ <variable>:
    // <value> }`, keys authored by the flow author — so the slot is spelled
    // with the `*` wildcard: every value of that map is a `value` slot
    // (#14149). Declared through the spec Zod channel
    // (`AssignmentConfigSchema` in `builtin-node-config.zod.ts`, whose map
    // value carries `.meta({ xExpression: 'value' })`): the descriptor's own
    // `assignments` is `additionalProperties: true` and carries no marker, and
    // objectui's inspector reads `xExpression` on string properties only, so
    // the marker does not reach the Studio form.
    //
    // Deliberately NOT declared: the two legacy shapes the executor still reads
    // (`logic-nodes.ts` — the bare `{ <variable>: <value> }` config with no
    // wrapper, and the `assignments: [{ variable, value }]` array). Neither is
    // declared by the descriptor or offered for new authoring, and their
    // values keep today's meaning (a `{token}` template or a literal — an
    // envelope-shaped object there is a literal object, as it always was).
    nodeType: 'assignment',
    path: 'assignments.*',
    role: 'value',
    label: 'assignment value',
  },
];

/** One resolved expression value found in a node's config. */
export interface ResolvedFlowNodeExpression {
  /** The ledger entry that matched. */
  readonly entry: FlowNodeExpressionPath;
  /** Concrete location, with array indices filled in (`fields[1].visibleWhen`). */
  readonly path: string;
  /** The authored value sitting at that location. */
  readonly value: unknown;
}

/**
 * Is `value` shaped like an expression envelope — a plain object carrying a
 * string `dialect`?
 *
 * The recognizer a `value` slot discriminates on (#14149): a plain string in
 * such a slot is `{token}` flow interpolation, a plain object is a literal, and
 * an object that names a `dialect` is an expression envelope
 * (`ExpressionSchema`) — the one form the expression engine evaluates. It is
 * deliberately looser than "a VALID envelope": `{ dialect: 'cel' }` with no
 * `source` is envelope-shaped, so a malformed envelope reaches the validator
 * and is refused there instead of being silently stored as a literal object.
 * Same test the engine's `edge.condition` dispatch and the lint's page-envelope
 * audit apply (`'dialect' in expression`), stated once so the ledger, the
 * `assignment` config contract and the executor half all draw the line in the
 * same place.
 */
export function isExpressionEnvelopeShaped(value: unknown): value is { dialect: string } {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { dialect?: unknown }).dialect === 'string'
  );
}

/**
 * Resolve every expression slot the ledger declares for `nodeType` against a
 * concrete `config`, filling in array indices and wildcard keys.
 *
 * Pure path resolution — no validation, no I/O. Both the engine and the lint
 * pass call this and then apply their own severity policy (the engine throws on
 * a malformed predicate at `registerFlow`; the lint pass reports it as a located
 * `objectstack validate` finding), so neither has to know the path shapes.
 *
 * What counts as "an authored expression" depends on the role:
 *
 *  - `predicate` / `flow-template`: the slot IS the expression, so a non-empty
 *    string is emitted. Absent, `null` and non-string values are skipped: "not
 *    authored" is not a malformed expression, and a non-string in an expression
 *    slot is a *type* violation for the schema pass to report, not something to
 *    hand to a parser.
 *  - `value`: the slot holds a VALUE that may be spelled as an expression, so
 *    only envelope-shaped objects ({@link isExpressionEnvelopeShaped}) are
 *    emitted. A string there is `{token}` interpolation — the `flow-template`
 *    dialect, not an expression to parse — and every other literal is data.
 *    Existing entries resolve byte-identically: no ledger path before #14149
 *    carries a `*` segment or the `value` role.
 */
export function resolveFlowNodeExpressions(
  nodeType: string,
  config: unknown,
): ResolvedFlowNodeExpression[] {
  if (config == null || typeof config !== 'object') return [];
  const out: ResolvedFlowNodeExpression[] = [];
  for (const entry of FLOW_NODE_EXPRESSION_PATHS) {
    if (entry.nodeType !== nodeType) continue;
    walk(config as Record<string, unknown>, entry.path.split('.'), '', (path, value) => {
      if (entry.role === 'value') {
        if (isExpressionEnvelopeShaped(value)) out.push({ entry, path, value });
      } else if (typeof value === 'string' && value.trim()) {
        out.push({ entry, path, value });
      }
    });
  }
  return out;
}

/**
 * Descend `segments` through `node`, expanding a `key[]` segment over every
 * element of that array and a `*` segment over every own key of that object,
 * and hand each terminal value to `emit` with its concrete path.
 */
function walk(
  node: unknown,
  segments: readonly string[],
  prefix: string,
  emit: (path: string, value: unknown) => void,
): void {
  if (node == null || typeof node !== 'object') return;
  const [head, ...rest] = segments;
  if (head === undefined) return;

  if (head === '*') {
    // Every own key of a plain object (#14149). An array here is not "a map
    // with authored keys" — its shape is `[]`'s, and a wildcard authored
    // against the wrong container must not invent index paths.
    if (Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const here = prefix ? `${prefix}.${key}` : key;
      if (rest.length === 0) emit(here, value);
      else walk(value, rest, here, emit);
    }
    return;
  }

  const isArraySegment = head.endsWith('[]');
  const key = isArraySegment ? head.slice(0, -2) : head;
  const value = (node as Record<string, unknown>)[key];
  const here = prefix ? `${prefix}.${key}` : key;

  if (isArraySegment) {
    if (!Array.isArray(value)) return;
    value.forEach((element, index) => {
      const indexed = `${here}[${index}]`;
      if (rest.length === 0) emit(indexed, element);
      else walk(element, rest, indexed, emit);
    });
    return;
  }

  if (rest.length === 0) emit(here, value);
  else walk(value, rest, here, emit);
}
