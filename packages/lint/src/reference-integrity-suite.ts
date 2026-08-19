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
 * `validateSortableFields` is the same reading one axis over (#9257): a list
 * view's `sort` names a field, resolved against the object's declared fields.
 * It gates for a stronger reason than its search sibling — the engine has no
 * tolerance to describe here. An unknown sort name is refused at the REST
 * ingress (`assertSortFieldsExist`, #6994) and a `formula` one by the engine
 * itself (`assertOrderByIsMaterializable`, #7095), both `400 INVALID_SORT`; and
 * because a view's declared sort is its FIRST fetch, the refusal is the whole
 * view failing to load, every time, from an authoring typo made long before.
 *
 * Rules that check SHAPE rather than reference (view containers, responsive
 * styles, seed replay safety, seed state machines, seed/security posture) stay
 * out — they answer a different question and have their own call sites.
 *
 * ## The runtime-publish axis (#9313)
 *
 * The suite is one `AUTHORING_RULES` entry, and the runtime publish gate
 * dispatches that entry by the written item's type (`runtimeTypes` on the
 * entry: `flow` since #4463 P1, `view` since #9313). Which MEMBERS judge a
 * given per-write snapshot is the suite's own, finer axis —
 * `ReferenceIntegrityRule.runtimeTypes`, default `['flow']` — because the
 * snapshot deliberately carries only the measured context collections
 * (objects / permissions / books / datasets), and a member resolving against
 * any other collection would read every reference into it as dead. The CLI
 * commands ignore the axis entirely: a whole-stack run is always the full
 * suite.
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
import { validateSortableFields } from './validate-sortable-fields.js';
import { validateActionNameRefs } from './validate-action-name-refs.js';
import { validatePageFieldBindings } from './validate-page-field-bindings.js';
import { validateChartBindings } from './validate-chart-bindings.js';
import { validateNavAccess } from './validate-nav-access.js';
import { validateNavTargetRefs } from './validate-nav-target-refs.js';
import { validateNavObjectServability } from './validate-nav-object-servability.js';
import { validateTranslationReferences } from './validate-translation-references.js';
import { validateTranslatableSections } from './validate-translatable-sections.js';
import { validateFlowTemplatePaths } from './validate-flow-template-paths.js';
import { validateAiSurfaceAffinity } from './validate-ai-surface-affinity.js';
import { validateAiToolReferences } from './validate-ai-tool-references.js';
import { validateAiAgentAuthoring } from './validate-ai-agent-authoring.js';
import { validateHookBodyWrites } from './validate-hook-body-writes.js';
import { validateActionBodyWrites } from './validate-action-body-writes.js';
import { validateFlowNodeWrites } from './validate-flow-node-writes.js';
import { validateReadonlyFlowWrites } from './validate-readonly-flow-writes.js';
import { validateReactPageProps } from './validate-react-page-props.js';

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
  /**
   * [#9313] The runtime-publish per-write snapshot types this member judges.
   *
   * The suite is ONE entry in `AUTHORING_RULES`, and that entry's
   * `runtimeTypes` says which WRITES dispatch the suite at the runtime publish
   * gate. This field is the finer axis the entry cannot express: which MEMBERS
   * are safe to judge that per-write snapshot. The two axes differ because the
   * snapshot is partial by design (`RuntimeStackContext` carries objects /
   * permissions / books / datasets and nothing else): a member that resolves
   * against a collection the snapshot does not carry would not go quiet — it
   * would report every reference into that collection as dead. Measured on the
   * `view` widening: `validateActionNameRefs` resolves a list view's
   * `rowActions[]` / `bulkActions[]` against `stack.actions`, which no
   * per-write snapshot carries, so crossing it with the suite would refuse a
   * legitimate view write for every stack-level action it names — a false 422
   * on the only door a Studio tenant has.
   *
   * ABSENT = `['flow']`, the surface the whole suite has run on since #4463 P1.
   * The default is deliberately the frozen historical surface, never "all":
   * widening a member onto another type is an explicit declaration here plus
   * its own false-positive measurement (#4716's budget), exactly the
   * discipline `runtimeTypes` gives registry entries. CLI commands ignore this
   * field entirely — all members always run there (see
   * {@link validateReferenceIntegrity}).
   */
  runtimeTypes?: readonly string[];
  run: (stack: Record<string, unknown>) => ReferenceIntegrityFinding[];
}

/** The runtime snapshot types a member judges when it declares none. */
const DEFAULT_MEMBER_RUNTIME_TYPES: readonly string[] = ['flow'];

/**
 * Every reference-integrity rule, in the order their findings are reported.
 *
 * ADDING A RULE: append it here and it runs on `validate`, `lint` and
 * `compile` at once. Do not re-wire the commands. It joins the runtime
 * publish gate on the DEFAULT member surface (`flow` snapshots only, #9313) —
 * widening it to another write type is a `runtimeTypes` declaration on the
 * member plus that type's own false-positive measurement, never automatic.
 */
export const REFERENCE_INTEGRITY_RULES: readonly ReferenceIntegrityRule[] = [
  { name: 'validateObjectReferences', run: validateObjectReferences },
  // [#9313] `runtimeTypes` gains `view` on this member and its sort sibling:
  // both judge a LIST VIEW's field references, and a standalone list view is
  // written through `PUT /api/v1/meta/view` — the only door a Studio tenant or
  // an MCP/AI author has. Their walks read the flattened overlay shape that
  // door carries (see each rule's `views[]` self rung), and they resolve only
  // against `stack.objects`, which the per-write snapshot DOES carry — so the
  // crossing has no missing-collection false-positive channel. Measured over
  // the shipped view corpus before crossing (0 refusals; population in the
  // #9313 PR).
  { name: 'validateSearchableFields', runtimeTypes: ['flow', 'view'], run: validateSearchableFields },
  // [#9257] The same reading, one axis over: a list view's `sort` is a field
  // name written in metadata, resolved against the object's declared fields. It
  // gates (`error`) because the runtime does not tolerate a bad one at all —
  // `assertSortFieldsExist` (#6994) and `assertOrderByIsMaterializable` (#7095)
  // both answer `400 INVALID_SORT` — and a view's sort is its FIRST fetch, so
  // the refusal is the whole view, on every load, traced to nothing.
  { name: 'validateSortableFields', runtimeTypes: ['flow', 'view'], run: validateSortableFields },
  { name: 'validateActionNameRefs', run: validateActionNameRefs },
  { name: 'validatePageFieldBindings', run: validatePageFieldBindings },
  { name: 'validateChartBindings', run: validateChartBindings },
  { name: 'validateNavAccess', run: validateNavAccess },
  // Nav targets that are NOT object names — page/report/dashboard. Restores the
  // coverage `defineStack`'s own cross-reference block switches off whenever the
  // stack declares none of that collection (`pageNames.size > 0 && …`), which is
  // exactly the state a stack is in when the target was never written.
  // `action` is deliberately absent (validateActionNameRefs owns it) and so is
  // `component` (an unregistered ref renders a named diagnostic, not silence).
  { name: 'validateNavTargetRefs', run: validateNavTargetRefs },
  // [#7912] The THIRD question about a nav entry, after "does the target
  // resolve?" (above) and "is it granted?" (`validateNavAccess`): can the
  // destination serve at all? An object's own `enable` block can make its list
  // answer 404/405 for every persona, and no gate authorable on the entry
  // expresses that — which is how #7544's dead row survived review for a year.
  // The server now prunes such an entry from the `/meta` payload; the
  // maintainer ruling of 2026-08-12 makes THIS the mandatory companion, so the
  // prune is never silent to the author who wrote the row.
  { name: 'validateNavObjectServability', run: validateNavObjectServability },
  { name: 'validateTranslationReferences', run: validateTranslationReferences },
  // The same family from the other end (#5417). Its sibling above asks "does
  // this bundle key resolve?"; this one asks "is there a key at all?" — a form
  // section authored with a `label` and no `name` renders a heading that
  // `_sections` (keyed by name) can never address, so neither the orphan check
  // nor the coverage walk can see it. A reference that cannot be written is
  // still a reference question, and warning-only for the same reason its
  // sibling is: one heading stays in the source locale, nothing breaks.
  { name: 'validateTranslatableSections', run: validateTranslatableSections },
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
  // The same check on the other surface that carries a `HookBodySchema` body:
  // action bodies, run by the same sandbox. Only the `ctx.api` write family
  // carries over — an action's `ctx.input` is its params bag, not a record
  // (see that module's ledger). Lazy on the same terms.
  //
  // The first member here to emit more than one rule id (`validateReactPageProps`
  // below is the other, and carries the most). Besides resolving `ctx.api`
  // writes against declared fields (`action-body-write-unknown-field`), it
  // reports a `ctx.record` write that can reach nothing
  // (`action-record-write-discarded`, #4345) — not a resolution question, so
  // by the charter above it does not belong in the suite. It rides along
  // anyway because it falls out of the SAME parse of the SAME source: a
  // separate member would parse every action body twice to say two things
  // about one walk, and hand-wiring it into the CLI instead is exactly the
  // drift this suite exists to end — which `validateReadonlyFlowWrites` was
  // the standing proof of, until it joined the suite below.
  { name: 'validateActionBodyWrites', run: validateActionBodyWrites },
  // The third surface that writes a record field set: a flow `update_record`
  // node's `config.fields`. Same question as the two rules above, but the map
  // is structural metadata rather than parsed JS, so a finding is a certainty
  // and gates (`error`) — see that module for why, and why the docs' long-
  // standing "prefer a flow node, it's checked" advice was the least true of
  // the three until it landed.
  { name: 'validateFlowNodeWrites', run: validateFlowNodeWrites },
  // The OTHER question about that same `config.fields` map: not "does this
  // field exist?" but "is it writable?" — a `runAs:'user'` update_record
  // writing a static-`readonly` field is stripped by the engine and the step
  // still reports success (#2948/#3425). It walks the identical map the rule
  // above walks, so the two splitting call sites was never defensible: hand-
  // wired into `validate` and `compile` only, it left `os lint` PASSING a flow
  // `os validate` refuses — and this one gates, so the divergence shipped a
  // build the other command would have stopped. Joining the suite is the whole
  // fix; the two hand-wired call sites are deleted with it (#4345 follow-up).
  { name: 'validateReadonlyFlowWrites', run: validateReadonlyFlowWrites },
  // The `kind:'react'` page surface. Every prop a react block binds BY FIELD
  // NAME is resolved against the object it names (#4340) — `<ListView columns>`,
  // `<ObjectForm fields>`, `<Block type="element:…">` through the SAME
  // `COMPONENT_FIELD_SPECS` table `validatePageFieldBindings` walks one surface
  // over, plus `<ObjectChart>`'s aggregate/axes (#3701/#3729) and
  // `searchableFields` (#4329). Squarely the charter's question, on the surface
  // where it had no answer at all.
  //
  // It also carries `react-block-needs-record-context` (#4413) — a BINDING
  // question rather than a resolution one: the `record:*` family reads its
  // record from a record page's context, so on THIS surface the binding does
  // not exist at all and the props the contract published for it were read by
  // no renderer. This rule used to resolve those props' field names against
  // the object they named — lint standing guard over a binding that never ran.
  // It rejects the blocks now, out of the same parse.
  //
  // It was hand-wired into `os validate` ALONE, so `os lint` and `os compile`
  // accepted a react page whose every field binding was stale — including the
  // gating ones (a missing required binding, a filter position naming no field:
  // the predicate can never match and the list comes back empty). That is
  // `validateReadonlyFlowWrites`' divergence again, one surface over, and it is
  // the reason this entry exists rather than a fourth hand-wiring.
  //
  // Like `validateActionBodyWrites` above, it emits ids that are not resolution
  // questions — `react-prop-missing-required` and `react-prop-typo` are shape,
  // and by the charter belong outside. They ride along for the same reason: they
  // fall out of the SAME TypeScript parse of the SAME page source, and splitting
  // them into a second member would parse every react page twice to say two
  // things about one walk. Lazy on the same terms as the hook/action body rules
  // — only a page that is actually `kind:'react'` loads the compiler.
  { name: 'validateReactPageProps', run: validateReactPageProps },
];

/**
 * Options for {@link validateReferenceIntegrity}.
 *
 * Declared as the suite's own type rather than importing
 * `AuthoringRuleContext` from `authoring-rules.ts` — the suite predates the
 * registry and the registry imports the suite, so the dependency must keep
 * pointing that way. The registry's context is assignable to this shape by
 * construction (`runtimeWriteType` spells the same key on both).
 */
export interface ReferenceIntegrityRunOptions {
  /**
   * [#9313] The singular metadata type of the per-write snapshot being judged,
   * when the caller is the runtime publish gate. Set by `runtime-gate.ts` for
   * every gated write; ABSENT on the three CLI commands and every whole-stack
   * caller, which run all members unconditionally.
   */
  runtimeWriteType?: string;
}

/**
 * Run every reference-integrity rule over a stack. Returns the concatenated
 * findings (empty = clean). Pure: no I/O, safe on both the schema-parsed stack
 * and the raw/normalized config the `lint` path carries.
 *
 * [#9313] When `options.runtimeWriteType` is set — the runtime publish gate
 * judging one write's snapshot — only the members declaring that type run
 * (see {@link ReferenceIntegrityRule.runtimeTypes}). Whole-stack callers pass
 * no options and keep the full suite, byte-identically.
 */
export function validateReferenceIntegrity(
  stack: Record<string, unknown>,
  options?: ReferenceIntegrityRunOptions,
): ReferenceIntegrityFinding[] {
  const findings: ReferenceIntegrityFinding[] = [];
  const writeType = options?.runtimeWriteType;
  for (const rule of REFERENCE_INTEGRITY_RULES) {
    if (writeType !== undefined
      && !(rule.runtimeTypes ?? DEFAULT_MEMBER_RUNTIME_TYPES).includes(writeType)) continue;
    findings.push(...rule.run(stack));
  }
  return findings;
}
