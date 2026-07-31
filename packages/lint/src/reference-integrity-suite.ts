// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reference-integrity suite — one entry point for the rules that answer
 * "does this name resolve to anything?" (issue #3583, assessment §5 D5).
 *
 * ## Why this exists
 *
 * These rules were wired **by hand** into each CLI entry point that runs them.
 * `os validate`, `os lint` and `os compile` each grew their own import list and
 * their own call site, so landing a rule meant remembering three places — and
 * the assessment's §2.2 already named the resulting drift as the enemy: the
 * same stack, checked by a different rule subset depending on which command
 * the author happened to run.
 *
 * The suite makes the next rule's wiring a ONE-LINE edit here, and makes the
 * question "which rules run on this path?" answerable by reading one list.
 *
 * ## What belongs in it
 *
 * A rule belongs here when it resolves a NAME written in metadata against the
 * things a stack actually declares — objects, actions, fields, measures,
 * permissions, translation keys. That is the family the HotCRM audit found
 * shipping broken: every instance parsed, validated, and failed silently at
 * runtime because nothing checked that the name pointed at anything.
 *
 * `validateFlowTemplatePaths` is a member for exactly that reason: a
 * `{record.<field>}` token is a field name written in metadata, resolved
 * against the bound object's declared fields. It was wired by hand into
 * `os validate` alone — the drift this suite exists to end — so `os lint` and
 * `os compile` accepted a flow the runtime refuses. Its findings carry BOTH
 * severities (see that module: a filter-position miss gates, every other
 * position advises), which is why the suite's contract is severity-agnostic.
 *
 * `validateSearchableFields` is a member on the same reading, one layer in: an
 * ADR-0061 `searchableFields` entry is a field name written in metadata,
 * resolved against the object's own declared fields. It gates (`error`) because
 * the engine's tolerance for a stale entry — silently filtering it out — either
 * narrows the searched set below what the object declares or, once every entry
 * is stale, falls through to the auto-default and searches a set the author
 * never wrote. See that module for why the other field-existence rules stay
 * advisory and this one does not.
 *
 * Rules that check SHAPE rather than reference (view containers, responsive
 * styles, seed replay safety, seed state machines, seed/security posture) stay
 * out — they answer a different question and have their own call sites.
 *
 * ## One deliberate non-member: `validateActionRecordWrites`
 *
 * It resolves nothing against the stack. `ctx.record.<field> = …` in an action
 * body is discarded because the action path has no record write-back at all, so
 * the finding does not depend on whether the field is declared — checking that
 * would in fact be WRONG, since warning only on the unknown half would imply
 * the declared half persists (#4345). By the membership test above it is a
 * shape rule and belongs at its own call sites.
 *
 * It is carried here anyway, as a deliberate widening rather than an oversight,
 * because "its own call sites" is not a neutral alternative: it means three
 * hand-wired commands, and the drift that produces is exactly what this module
 * exists to end — `validateReadonlyFlowWrites`, the closest sibling by subject
 * (a write that silently does not land), still demonstrates it, wired into
 * `validate` and `compile` but not `lint`. The suite's real invariant is that a
 * stack gets the SAME answer from every command; membership by question-shape
 * is how that was described, not what it is for. A future rule may take the
 * same exemption — but it must say so here, in these terms, rather than quietly
 * reading the membership test loosely.
 *
 * ## Known remaining asymmetry
 *
 * `os doctor` runs only `validateWidgetBindings` and is NOT converted here: it
 * is an environment health check (node version, config presence, circular
 * lookups), not an authoring gate, so adopting the suite there is a product
 * decision about what `doctor` is for — not a wiring cleanup. It is named here
 * so the gap stays visible instead of being rediscovered.
 */

import { validateObjectReferences } from './validate-object-references.js';
import { validateSearchableFields } from './validate-searchable-fields.js';
import { validateActionNameRefs } from './validate-action-name-refs.js';
import { validatePageFieldBindings } from './validate-page-field-bindings.js';
import { validateChartBindings } from './validate-chart-bindings.js';
import { validateNavAccess } from './validate-nav-access.js';
import { validateTranslationReferences } from './validate-translation-references.js';
import { validateFlowTemplatePaths } from './validate-flow-template-paths.js';
import { validateAiSurfaceAffinity } from './validate-ai-surface-affinity.js';
import { validateAiToolReferences } from './validate-ai-tool-references.js';
import { validateAiAgentAuthoring } from './validate-ai-agent-authoring.js';
import { validateHookBodyWrites } from './validate-hook-body-writes.js';
import { validateActionRecordWrites } from './validate-action-record-writes.js';

export type ReferenceIntegritySeverity = 'error' | 'warning';

/**
 * The shape every rule in the suite already returns. Declared here so callers
 * can hold one type instead of a six-way union.
 */
export interface ReferenceIntegrityFinding {
  /** `error` = the reference is dead; `warning` = it may resolve elsewhere, or the miss is inert. */
  severity: ReferenceIntegritySeverity;
  /** Diagnostic rule id (stable; used by allowlists and docs). */
  rule: string;
  /** Human-readable location. */
  where: string;
  /** Config path. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

/** One member of the suite. `name` is the exported function's name — the id a wiring test can assert on. */
export interface ReferenceIntegrityRule {
  name: string;
  run: (stack: Record<string, unknown>) => ReferenceIntegrityFinding[];
}

/**
 * Every reference-integrity rule, in the order their findings are reported.
 *
 * ADDING A RULE: append it here and it runs on `validate`, `lint` and
 * `compile` at once. Do not re-wire the commands.
 */
export const REFERENCE_INTEGRITY_RULES: readonly ReferenceIntegrityRule[] = [
  { name: 'validateObjectReferences', run: validateObjectReferences },
  { name: 'validateSearchableFields', run: validateSearchableFields },
  { name: 'validateActionNameRefs', run: validateActionNameRefs },
  { name: 'validatePageFieldBindings', run: validatePageFieldBindings },
  { name: 'validateChartBindings', run: validateChartBindings },
  { name: 'validateNavAccess', run: validateNavAccess },
  { name: 'validateTranslationReferences', run: validateTranslationReferences },
  { name: 'validateFlowTemplatePaths', run: validateFlowTemplatePaths },
  { name: 'validateAiSurfaceAffinity', run: validateAiSurfaceAffinity },
  { name: 'validateAiToolReferences', run: validateAiToolReferences },
  { name: 'validateAiAgentAuthoring', run: validateAiAgentAuthoring },
  // Field names WRITTEN by an L2 hook body (`ctx.input.x = …`,
  // `ctx.api.object('y').update({ x })`), resolved against the target object's
  // declared fields — the write-side counterpart of validateFlowTemplatePaths'
  // read-side membership (#4271). Lazy: only a hook that actually carries a
  // `language:'js'` body loads the TypeScript parser.
  { name: 'validateHookBodyWrites', run: validateHookBodyWrites },
  // Writes an L2 ACTION body aims at `ctx.record` (#4345). Lazy on the same
  // terms as the rule above. See "One deliberate non-member" in this module's
  // header for why a rule that resolves no name is nevertheless carried here.
  { name: 'validateActionRecordWrites', run: validateActionRecordWrites },
];

/**
 * Run every reference-integrity rule over a stack. Returns the concatenated
 * findings (empty = clean). Pure: no I/O, safe on both the schema-parsed stack
 * and the raw/normalized config the `lint` path carries.
 */
export function validateReferenceIntegrity(stack: Record<string, unknown>): ReferenceIntegrityFinding[] {
  const findings: ReferenceIntegrityFinding[] = [];
  for (const rule of REFERENCE_INTEGRITY_RULES) {
    findings.push(...rule.run(stack));
  }
  return findings;
}
