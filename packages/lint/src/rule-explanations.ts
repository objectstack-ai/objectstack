// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The full reasoning behind an author-time rule, kept out of its finding.
 *
 * A finding is printed by `os validate`, `os build` and `os dev` on every run,
 * so it carries one verdict sentence (`message`) and one fix (`hint`) and
 * nothing more. Everything an author needs only once — what the rule counts,
 * what it deliberately does not, why it exists, where its boundaries are —
 * lives here instead, keyed by rule id, and `os explain <rule-id>` prints it.
 * The CLI's `rule:` line names that command for exactly the rule ids this
 * table holds, so the pointer is never printed for a rule that has nothing to
 * show.
 *
 * ⛔ One copy. The text below is not repeated in the rule's message or hint,
 * and a rule's message does not paraphrase it: an author who wants the "why"
 * runs the command.
 *
 * ## Why this module imports nothing
 *
 * It is published as its own entry, `@objectstack/lint/rule-explanations`, as
 * well as from the root barrel, because the CLI's finding printer reads it on
 * every command that prints a finding, and that printer is deliberately not a
 * rule-engine import: loading the root barrel costs about half a second (every
 * rule module and `@objectstack/spec` with it), which `os explain object` and
 * every other command would otherwise pay. So the keys are the rule ids
 * spelled as literals, and a list a rule computes from data (the roots a scan
 * reads) is written out here — `rule-explanations.test.ts` holds each key to a
 * rule id constant some rule file exports and each such list to the rule's own
 * constant, so neither can drift from the rule it explains.
 *
 * Adding an entry: key it by the rule's id, write `covers` so that it
 * completes the sentence "`os explain <id>` for …", and move the long text out
 * of the rule in the same edit. The id must not equal an `os explain` schema
 * name — the command resolves one positional against both, and the CLI pins
 * the two sets disjoint.
 */

/** The long-form explanation of one author-time rule. */
export interface RuleExplanation {
  /** The rule id this explains — the `rule` of every finding it covers. */
  rule: string;
  /**
   * A short noun phrase that completes "`os explain <id>` for …" on the CLI's
   * `rule:` line, e.g. `what counts as a consumer`.
   */
  covers: string;
  /** The reasoning, one paragraph per entry, in reading order. */
  paragraphs: readonly string[];
}

const FIELD_NO_CONSUMERS_EXPLANATION: RuleExplanation = {
  rule: 'field-no-consumers',
  covers: 'what counts as a consumer',
  paragraphs: [
    'A declared field is CONSUMED when something in this stack reads or displays it: a view column, ' +
      'an inline grid column, a form section, a page binding, a flow node, a dataset or cube member, a ' +
      'dashboard widget, a formula, a validation, a hook or an action that names it; a declared field ' +
      'group (`group` naming one of the object\'s `fieldGroups`) that places it on the synthesized ' +
      'layout; or a seed or import mapping that matches on it (`externalId` / `upsertKey`). One such ' +
      'site is enough: a field that is only drawn is the ordinary state of most fields, not a defect.',
    'A CARRIER names a field without reading it, so it does not count: a translation label, a seed ' +
      'value, an import-mapping target, a permission grant, a flow that only WRITES it, an ' +
      '`inlineColumns` entry on a relationship field that does not set `inlineEdit` (no grid is ' +
      'drawn), or a dataset or cube member path the analytics door refuses (a hop or column that does ' +
      'not resolve, or a join the dataset\'s `include` does not declare).',
    'The verdict on the warning is `inert` when no site of any kind names the field, and ' +
      '`carrier-only` when only carriers do — then the warning lists each carrier site, because ' +
      'removing the declaration means cleaning them too. Verdicts are per object: a consumer of the ' +
      'same field name on another object does not cover this declaration.',
    'Never reported, because the platform reads them without an authored consumer: a system column ' +
      'the registry injects (when the object re-declares it), the record\'s title field, and a ' +
      '`master_detail` field (the relationship is consumed by being declared). Fields an ' +
      '`objectExtensions` entry adds are not judged, and a stack that declares no consumer root at ' +
      'all (objects only) is skipped: its consumers are declared elsewhere.',
    'To fix it, give the field a consumer — a view column, a form section, a page binding, a ' +
      'formula, a validation, a flow node, a dataset dimension, or a `group` naming one of the ' +
      'object\'s declared `fieldGroups` so the synthesized layout draws it — or remove the ' +
      'declaration together with any carrier sites the warning lists.',
    'The rule is advisory and stays a warning: a consumer can legitimately live outside the stack — ' +
      'an API client, a hook or package this stack does not carry, a Studio-authored view. Ignore ' +
      'the warning for such a field.',
    // Held equal to `CONSUMER_ROOTS` / `CARRIER_ROOTS` by `rule-explanations.test.ts`.
    'Roots scanned: objects, views, pages, apps, flows, dashboards, reports, datasets, actions, hooks, ' +
      'jobs, emailTemplates, agents, tools, skills, apis, webhooks, sharingRules, analyticsCubes ' +
      '(consumers) · translations, data, mappings, permissions (carriers). Test fixtures are never ' +
      'scanned: the rule reads metadata, not a repository, so a field that only a test reads is ' +
      'reported.',
  ],
};

const SECURITY_OWD_UNSET_EXPLANATION: RuleExplanation = {
  rule: 'security-owd-unset',
  covers: 'why the baseline must be declared',
  paragraphs: [
    'Every custom object declares its organization-wide default, `sharingModel` (OWD): the ' +
      'record-level baseline that every permission set\'s object grant is read against. An object ' +
      'that declares none still runs — the runtime fails CLOSED to \'private\' (ADR-0090 D1) — and ' +
      'this rule refuses it anyway, because the baseline must be an authored decision, not an ' +
      'accident of a default.',
    'The shape it guards: an object with no `sharingModel`, granted ordinary read/write by a ' +
      'permission set, let that grant read and edit every other user\'s records. Failing closed is ' +
      'the runtime\'s half of the fix; declaring the value is the author\'s half, so the next reader ' +
      'of the object sees the decision instead of inferring it from a default.',
    'The values, for internal users: \'private\' — the owner plus explicit shares (the recommended ' +
      'default); \'public_read\' — everyone reads, the owner writes; \'public_read_write\' — everyone ' +
      'reads and writes; \'controlled_by_parent\' — access derives from the master record (a ' +
      'master-detail child).',
    'System objects (`isSystem: true`, or a name starting with `sys_`) are not judged: the platform ' +
      'owns their posture.',
  ],
};

/**
 * Every rule explanation this package ships, keyed by rule id. `os explain
 * <rule-id>` reads this table and nothing else.
 */
export const RULE_EXPLANATIONS: Readonly<Record<string, RuleExplanation>> = Object.freeze({
  [FIELD_NO_CONSUMERS_EXPLANATION.rule]: FIELD_NO_CONSUMERS_EXPLANATION,
  [SECURITY_OWD_UNSET_EXPLANATION.rule]: SECURITY_OWD_UNSET_EXPLANATION,
});

/** The explanation for `rule`, or `undefined` when the rule has none. Exact id match. */
export function explainRule(rule: string): RuleExplanation | undefined {
  return Object.prototype.hasOwnProperty.call(RULE_EXPLANATIONS, rule) ? RULE_EXPLANATIONS[rule] : undefined;
}
