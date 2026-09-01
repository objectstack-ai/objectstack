// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module flow-variable-scope
 *
 * **The one sub-case of a bare identifier in a flattened flow scope that is
 * genuinely ambiguous AND genuinely breaks: a name bound as BOTH a declared
 * flow variable and a field on the bound object** (#14089).
 *
 * ## Why a bare identifier is normally correct here, and stays uncriticised
 *
 * A flow node/edge `condition` is evaluated in a *flattened* scope: the trigger
 * record's own fields are spread to top level, so `status == "dispatched"` is
 * the shape the platform's own canon teaches and the engine deliberately
 * supports. `@objectstack/formula` says so in its published contract
 * (`ExprSchemaHint.scope`: on flattened scope "bare `status` is correct and is
 * NOT an error"; `cel-engine.ts`: the record-scope checker "must NOT be applied
 * to flow / automation conditions"), and `AutomationEngine.seedRunVariables`
 * says so at the other end — it flattens the record's fields "so bare
 * references (`status`, `budget`) resolve in start conditions and edge
 * predicates". Two shipped example apps read fields bare in exactly that way.
 *
 * ⛔ So this module does NOT judge a bare identifier for being bare. Rejecting
 * the form would make this package refuse what the platform's own contract
 * blesses — the "linter denying its own contract" shape #5378 already paid down
 * inside `validate-expressions.ts` — and warning on it would fire on canon, the
 * trust-killer ADR-0072 D1 names. Maintainer ruling, 2026-09-01 (director batch
 * #23), verbatim and untranslated:
 *
 * > **C**:新诊断只命中**真正含糊且真正会坏**的子情形 —— 裸名**既**匹配已声明
 * > 流程变量**又**匹配绑定对象上的字段(遮蔽:`seedRunVariables` 先播变量、
 * > record 字段只在未绑定守卫下扁平化 ⇒ 变量赢且无处声张)。判据封闭(两边都是
 * > 被编写的元数据),零迁移,不动契约、不动 pin、不碰示例应用
 *
 * ## The mechanism, measured at both ends
 *
 * `seedRunVariables` seeds the flow's declared variables FIRST, then flattens
 * the record's fields only where nothing is bound yet:
 *
 * ```ts
 * const variables = this.seedDeclaredVariables(flow, context);   // (1) variables
 * if (context?.record) {
 *   variables.set('record', context.record);
 *   for (const [k, v] of Object.entries(context.record)) {
 *     if (!variables.has(k)) variables.set(k, v);                // (2) guarded
 *   }
 * }
 * ```
 *
 * So when one name is both, **the variable wins and nothing anywhere reports
 * the collision**. The author reads `status` on a flow that also declares a
 * `status` variable and is reading the variable, not the field — a wrong
 * predicate at the surface where a wrong predicate is least visible, because a
 * flow condition that never fires produces no record, no error and no log line.
 *
 * The node-id row (below) shadows even harder, in `evaluateCondition`'s scope
 * build: a variable keyed `"<nodeId>.<outputKey>"` is expanded into a nested
 * object path, and the expansion **overwrites** a non-object value already
 * sitting at `<nodeId>` — so a flattened field named like a node id is replaced
 * by an object at scope-build time.
 *
 * ## Severity
 *
 * `warning`, never `error` — whether the shadow actually bites on a given run
 * depends on values the author has not written down (a declared input with no
 * `defaultValue` is bound only when a param supplies one), and this diagnostic
 * must not fail a build over a collision that may be intentional.
 */

import { firstUndeclaredReference } from '@objectstack/formula';

type AnyRec = Record<string, unknown>;

/** The node shape this module reads: `collectFlowGraphs`' element type, loosened. */
interface FlowNodeLike {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly config?: unknown;
}

/** One graph out of `collectFlowGraphs` — every region is already its own graph. */
export interface FlowGraphLike {
  readonly nodes: readonly FlowNodeLike[];
}

/** The flow-level slice this module reads. */
export interface FlowVariableHost {
  readonly variables?: unknown;
}

/**
 * `config` keys whose VALUE is a variable name the runtime binds.
 *
 * Read off every node rather than gated on an enumerated node-type list, and
 * that is the deliberate direction: the type list is what drifts silently when
 * a new container arrives, while these key spellings are specific enough that a
 * node carrying one and not binding a variable does not exist. Measured
 * declaration → binder pairs:
 *
 * | key | declared by | bound at |
 * |---|---|---|
 * | `iteratorVariable` | `control-flow.zod.ts` (loop), `builtin-node-config.zod.ts` (map) | `loop-node.ts`, `map-node.ts` |
 * | `indexVariable` | the same two | the same two |
 * | `errorVariable` | `control-flow.zod.ts` (try_catch) | `try-catch-node.ts` |
 * | `outputVariable` | `builtin-node-config.zod.ts`, `schemaless-node-config.zod.ts` | `crud-nodes.ts`, `screen-nodes.ts`, `map-node.ts`, `subflow-node.ts` |
 *
 * ⚠️ `control-flow.zod.ts` REJECTS the `itemVariable` alias by name, so on the
 * parsed path only the canonical spelling can arrive — reading the alias here
 * would be a consumer-side tolerance of a shape the schema refuses (Prime
 * Directive #12).
 */
export const VARIABLE_NAME_CONFIG_KEYS = ['iteratorVariable', 'indexVariable', 'errorVariable', 'outputVariable'] as const;

/**
 * The node type whose `config` names variables *structurally* rather than
 * through a declared key. Gated on the type on purpose: shape 3 below reads
 * EVERY top-level config key as a variable name, which is correct for this node
 * and catastrophic over-collection for any other (a `start` node would donate
 * `objectName` and `condition`, an `http` node its `url`).
 */
/*
 * ⛔ Module-private, deliberately. `rule-id-barrel-exports.test.ts` reads every
 * `export const NAME = '<slug>';` in `src/` as a RULE ID that a published
 * barrel must re-export — and `'assignment'` is slug-shaped. This is a node
 * type, not a rule id, and putting it in the package's public surface to
 * satisfy that scan would publish an internal detail nobody consumes. The
 * type gate is pinned through BEHAVIOUR instead (a non-assignment node donates
 * no config keys), which is the property that actually matters.
 */
const ASSIGNMENT_NODE_TYPE = 'assignment';

/**
 * The keys an `assignments` ARRAY entry may name its target with — the three
 * `logic-nodes.ts` reads, in its precedence order. Exported so the guard can
 * assert the list rather than re-derive it from the source text.
 */
export const ASSIGNMENT_ENTRY_NAME_KEYS = ['variable', 'name', 'key'] as const;

/**
 * Variable names an `assignment` node binds — **three shapes**, mirroring the
 * executor's own dispatch in `logic-nodes.ts` branch for branch.
 *
 * Shape 3 is the class a hand-written collector misses: with no `assignments`
 * wrapper at all, the top-level `config` keys ARE the variable names, and the
 * node config schema states that exemption deliberately (`builtin-node-config.zod.ts`).
 * An implementer who looks for `assignments`, finds nothing and collects zero
 * names from a legacy assignment node loses every variable that node sets —
 * here that is a MISSED warning, and under any stricter rule it would have been
 * a false rejection.
 */
function assignmentTargets(config: AnyRec): string[] {
  const raw = config.assignments;
  const out: string[] = [];
  if (Array.isArray(raw)) {
    // Shape 2: [{ variable | name | key, value }, …]
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as AnyRec;
      for (const nameKey of ASSIGNMENT_ENTRY_NAME_KEYS) {
        const name = entry[nameKey];
        if (typeof name === 'string' && name) { out.push(name); break; }
      }
    }
    return out;
  }
  if (raw && typeof raw === 'object') {
    // Shape 1: { <var>: <value>, … } — the canonical Studio shape.
    return Object.keys(raw as AnyRec);
  }
  // Shape 3: no wrapper — the config's own keys are the variable names.
  return Object.keys(config);
}

/**
 * Every name that is bound as a flow variable at some point in this flow's run.
 *
 * **Flow-scoped, not graph-scoped, and that is measured**: `seedRunVariables`
 * builds ONE map per run, so a name declared inside a `loop` body is in scope
 * for the whole flow. The set is therefore one flat union gathered across every
 * graph `collectFlowGraphs` yields — which already includes every ADR-0031
 * region slot (`loop.body`, `parallel.branches[]`, `try_catch.try/catch`).
 *
 * ⚠️ Consequence for the caller: this cannot be interleaved with the checking
 * walk. A condition on the first node is in scope for a variable declared by
 * the last one, so collection must COMPLETE before any condition is judged;
 * collecting as you go would make the verdict depend on traversal order.
 *
 * The nine-row surface, with the two rows that are easiest to miss called out:
 *
 * 1. `flow.variables[].name` — `FlowVariableSchema`, seeded by `seedDeclaredVariables`
 * 2-5. the four {@link VARIABLE_NAME_CONFIG_KEYS} above
 * 6. node `config.outputVariable` (folded into the same list)
 * 7. assignment targets — three shapes, see {@link assignmentTargets}
 * 8. **node ids** — not a "variable" in any schema sense, but a bare CEL root at
 *    runtime: the engine writes each of a node's outputs under a variable key
 *    spelled "node id, dot, output key", and `evaluateCondition` expands that
 *    dotted key into a nested object AT the node id, overwriting whatever scalar
 *    was flattened there
 * 9. engine-reserved handles (`record`, `previous`, the dollar-prefixed run
 *    handles) — deliberately NOT collected: they are `SCOPE_ROOTS` members or
 *    dollar-prefixed, so they can never be the bare undeclared identifier this
 *    module looks for, and adding them would only widen the set with names no
 *    object may declare as a field anyway
 */
export function collectFlowVariableNames(
  flow: FlowVariableHost,
  graphs: readonly FlowGraphLike[],
): ReadonlySet<string> {
  const names = new Set<string>();

  // Row 1 — the flow's own declarations.
  const declared = flow.variables;
  if (Array.isArray(declared)) {
    for (const item of declared) {
      if (!item || typeof item !== 'object') continue;
      const flowVar = item as AnyRec;
      if (typeof flowVar.name === 'string' && flowVar.name) names.add(flowVar.name);
    }
  }

  for (const graph of graphs) {
    for (const item of graph.nodes) {
      const flowNode = item as AnyRec;
      // Row 8 — the node id itself.
      if (typeof flowNode.id === 'string' && flowNode.id) names.add(flowNode.id);
      const rawConfig = flowNode.config;
      if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue;
      const config = rawConfig as AnyRec;
      // Rows 2-6 — declared keys whose value is a name.
      for (const key of VARIABLE_NAME_CONFIG_KEYS) {
        const value = config[key];
        if (typeof value === 'string' && value) names.add(value);
      }
      // Row 7 — assignment targets.
      if (flowNode.type === ASSIGNMENT_NODE_TYPE) {
        for (const target of assignmentTargets(config)) if (target) names.add(target);
      }
    }
  }

  return names;
}

/**
 * Upper bound on the bare-root enumeration below. A predicate reaching for more
 * distinct undeclared roots than this is pathological, and the loop must
 * terminate on a source the oracle keeps faulting on for a reason we did not
 * anticipate.
 */
const MAX_BARE_ROOTS = 64;

/**
 * Every bare (undeclared) top-level identifier in `source`, discovered by
 * re-asking the oracle with the ones already found declared.
 *
 * ⛔ The oracle is `firstUndeclaredReference`, **not** `collectCelRootIdentifiers`,
 * and the difference is the whole false-positive budget: the former acts only on
 * cel-js's own `Unknown variable` fault, so a comprehension-macro variable
 * (`items.exists(x, x.n > 1)`) and a function name are never reported; the
 * latter reads the AST and reports macro variables as roots, so a macro variable
 * sharing a field's name would be flagged for a collision that does not exist.
 *
 * ⚠️ **Known, deliberate blind spot**: `SCOPE_ROOTS` are declared in the oracle's
 * strict environment, so a flow variable named `result` / `data` / `item` /
 * `config` (all `SCOPE_ROOTS` members) is never reported as a bare root and its
 * shadow goes unwarned. That is an UNDER-report, the safe direction for a new
 * warning, and it is the price of the pinned oracle — closing it would mean
 * consulting the AST, which is what re-opens the macro-variable false positive.
 */
function bareRootsOf(source: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < MAX_BARE_ROOTS; i++) {
    const next = firstUndeclaredReference(source, found);
    if (next === null || found.includes(next)) break;
    found.push(next);
  }
  return found;
}

/**
 * The names in `source` that are read BARE while being bound as both a declared
 * flow variable and a field on the bound object — i.e. the shadowing case, in
 * discovery order.
 *
 * Empty (at zero CEL cost) whenever the two authored sets do not intersect,
 * which is the overwhelmingly common case: a flow whose variables share no name
 * with the trigger object's fields can never produce this finding, so the
 * expensive half never runs.
 */
export function shadowedFieldReads(
  source: string,
  declaredVariables: ReadonlySet<string>,
  fieldNames: readonly string[],
): string[] {
  if (declaredVariables.size === 0 || fieldNames.length === 0) return [];
  const candidates = new Set(fieldNames.filter((name) => declaredVariables.has(name)));
  if (candidates.size === 0) return [];
  return bareRootsOf(source).filter((root) => candidates.has(root));
}

/**
 * The diagnostic. Names the mechanism rather than only the collision, because
 * the mechanism is the part the author cannot see: both spellings look
 * reasonable, and nothing at author time or run time says which one won.
 */
export function shadowedFieldMessage(name: string, objectName: string): string {
  return (
    `bare reference \`${name}\` is BOTH a declared flow variable and a field on \`${objectName}\` — ` +
    `a flow run seeds its declared variables FIRST and flattens the record's fields only where ` +
    `nothing is bound yet, so this reads the VARIABLE, the field is unreachable under its own ` +
    `name, and nothing reports the collision. Write \`record.${name}\` if you meant the field, ` +
    `or rename the variable if you meant the variable.`
  );
}
