// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module validate-flow-filter-tokens
 *
 * **A `{…}` filter token in a flow node that NEITHER `{…}` dialect can
 * resolve** (#16096).
 *
 * `filter-token-unknown` (`validate-filter-tokens.ts`) walks seven
 * presentation collections and deliberately not `flows`, so `{TOMORROW()}` in a
 * list view's filter fails the build while the identical string in a flow
 * node's `config.filter` is silent. Its siblings already reach flows
 * (`validate-empty-combinators.ts`, `validate-preset-comparands.ts`,
 * `lint-liveness-properties.ts`), so the gap is a root-list inconsistency, not
 * a position the package holds an opinion about.
 *
 * ## Why this is a SECOND rule id and not `flows` added to that root list
 *
 * The two positions do not share a vocabulary or a consequence, and
 * `filter-token-unknown`'s message is a factual claim about the run —
 * *"sent to the data engine as a literal string, matches no record, and the
 * surface renders empty"* — that is **false** here in both halves:
 *
 * - **Vocabulary.** A flow filter is evaluated by the automation template
 *   evaluator FIRST, and only what that evaluator cannot resolve is handed on
 *   to ObjectQL (`interpolateFilter`, #3810). Judging a flow filter against the
 *   ObjectQL vocabulary reports every legitimate `{record.id}` — measured at
 *   **7 findings, all 7 false positives**, on this repo's own examples.
 *   `flow-template-grammar.ts` carries that measurement and the boundary.
 * - **Consequence.** For the class reported here the run does not query and
 *   render empty: `resolveToken` throws `FlowExpressionFunctionError`, a guard
 *   refusal a `fault` edge may not swallow. The node **cannot run at all**.
 *
 * Widening the published id would make its meaning depend on the position it
 * fired in, which a machine consumer keyed on the id cannot see. So the id is
 * new and the old rule's declared surface list is untouched.
 *
 * ## Severity: `error`
 *
 * The same axis `validate-flow-template-paths.ts` already applies at this exact
 * position — an unresolvable token inside a filter-guarded CRUD node is not
 * "the output will be blank", it is "this node cannot run", so the build is
 * shipping a flow whose runtime is already decided. Gating, not advisory.
 *
 * ## What it deliberately leaves silent
 *
 * Everything whose oracle is open: bare and dotted identifiers (`{recordId}`,
 * `{record.id}`) address a run-time `VariableMap`, and junk shapes collapse
 * into the CRUD guard's own run-time report. Only the CALL-POSITION arm has a
 * closed reference set, and only it is reported. `flow-template-grammar.ts`
 * states that boundary in full.
 */

import { nearestName } from '@objectstack/formula';
import { classifyFilterToken } from '@objectstack/spec/data';

import {
  classifyFlowTemplateToken,
  FLOW_TEMPLATE_DATE_FUNCTIONS,
  FLOW_TEMPLATE_VALUE_FUNCTIONS,
} from './flow-template-grammar.js';
import { walkAuthoredFilters, type FilterSurface } from './filter-walk.js';

/** Diagnostic rule id. */
export const FLOW_FILTER_TOKEN_UNKNOWN = 'flow-filter-token-unknown';

export interface FlowFilterTokenFinding {
  /** Always `error` — the node throws a guard refusal instead of running. */
  severity: 'error';
  rule: string;
  /** Human-readable location, e.g. `flow "opportunity_stagnation"`. */
  where: string;
  /** Config path, e.g. `flows[2].nodes[1].config.filter.close_date.$lt`. */
  path: string;
  message: string;
  hint: string;
}

/**
 * The one collection this rule walks. Declared here rather than shared, for the
 * reason `validate-filter-tokens.ts` states about its own list: a shared
 * surface constant would let another rule's widening land in a gating rule
 * silently.
 */
const FLOW_FILTER_SURFACES: readonly FilterSurface[] = [{ key: 'flows', kind: 'flow' }];

/**
 * Compose the hint, mirroring `unknownFunctionError`'s own prescription so the
 * authoring-time wording and the run-time fault read as one system.
 */
function hintFor(name: string): string {
  if (FLOW_TEMPLATE_DATE_FUNCTIONS.includes(name)) {
    return `${name}() is supported only as the whole token, with an optional ± N day offset — write {${name}() + 7}.`;
  }
  const last = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
  const lower = last.toLowerCase();
  const suggestion = FLOW_TEMPLATE_VALUE_FUNCTIONS.includes(lower)
    ? lower
    : nearestName(lower, FLOW_TEMPLATE_VALUE_FUNCTIONS);
  const didYouMean = suggestion
    ? ` Did you mean '${suggestion}'?${name.includes('.') ? ' Method/namespace call syntax is not supported — write the bare form.' : ''}`
    : '';
  return (
    `Flow filter values resolve in two vocabularies: the flow template dialect — `
    + `{NOW()} / {TODAY()} with an optional ± N day offset, {$User.Id}, {record.<field>}, `
    + `and the value functions ${FLOW_TEMPLATE_VALUE_FUNCTIONS.join(', ')} — and, for a token `
    + `the evaluator does not resolve, the filter placeholders ({current_user_id}, {today}, `
    + `{30_days_ago}).${didYouMean}`
  );
}

/** Judge every string inside one authored filter subtree. */
function walkValues(
  node: unknown,
  path: string,
  where: string,
  out: FlowFilterTokenFinding[],
  seen: Set<unknown>,
): void {
  if (node === null || node === undefined) return;

  if (typeof node === 'string') {
    // Layer one: ask the FILTER dialect first, through the same classifier
    // `filter-token-unknown` uses. `null` means the value is not a placeholder
    // attempt at all; `context` / `date-macro` mean ObjectQL owns and resolves
    // it after the hand-off. Only its `unknown` verdict can possibly be a token
    // neither layer knows — which makes every finding here a strict SUBSET of
    // what a bare `flows` root addition would report, and `token` is the raw
    // text between the braces, exactly as authored.
    const filterVerdict = classifyFilterToken(node);
    if (filterVerdict?.kind !== 'unknown') return;
    // Layer two: ask the FLOW dialect what it does with that same text.
    const verdict = classifyFlowTemplateToken(filterVerdict.token);
    if (verdict.kind !== 'unknown-function') return;
    out.push({
      severity: 'error',
      rule: FLOW_FILTER_TOKEN_UNKNOWN,
      where,
      path,
      message:
        `Filter value "${node}" calls '${verdict.name}', which is not a function in the flow `
        + `template dialect and is not a filter placeholder either. The node does not query with `
        + `an unresolved condition — the template evaluator raises a guard refusal, so this node `
        + `cannot run at all.`,
      hint: hintFor(verdict.name),
    });
    return;
  }

  if (typeof node !== 'object') return;
  // Metadata graphs can be cyclic once normalized; guard the walk.
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach((v, i) => walkValues(v, `${path}[${i}]`, where, out, seen));
    return;
  }

  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    walkValues(v, `${path}.${k}`, where, out, seen);
  }
}

/**
 * Validate flow-node filter placeholders across a schema-parsed stack.
 *
 * Pure `(stack) => Finding[]`; no I/O.
 */
export function validateFlowFilterTokens(
  stack: Record<string, unknown> | undefined | null,
): FlowFilterTokenFinding[] {
  if (!stack || typeof stack !== 'object') return [];
  const out: FlowFilterTokenFinding[] = [];

  walkAuthoredFilters(stack, FLOW_FILTER_SURFACES, ({ value, path, where }) => {
    walkValues(value, path, where, out, new Set());
  });

  return out;
}
