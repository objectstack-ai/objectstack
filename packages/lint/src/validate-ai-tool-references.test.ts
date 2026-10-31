// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateAiToolReferences as validateAiToolReferencesUnrecorded,
  AI_SKILL_TOOL_UNRESOLVED,
} from './validate-ai-tool-references.js';
import { PLATFORM_TOOL_FAMILY_PREFIXES } from '@objectstack/spec/system';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is `os explain ai-skill-tool-unresolved`. Every direct call below
// records what it fired, and the last cases in this file hold each recorded
// verdict to one line of at most 200 characters — every firing variant this
// suite exercises, not a chosen few. Run the whole file: those cases read what
// the cases above fired.
const fired: Array<{ rule: string; message: string; hint: string }> = [];
const validateAiToolReferences: typeof validateAiToolReferencesUnrecorded = (...args) => {
  const findings = validateAiToolReferencesUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

describe('validate-ai-tool-references', () => {
  // ── The motivating corpus, measured per branch (#3806 / #3820 §3) ─────────
  // HotCRM's six skills carry 16 tool references: 6 resolve via the platform
  // registry, 10 are fictional. The rule must find exactly the 10 — a single
  // false positive on the resolvable 6 is the failure mode that got this
  // branch blocked on D0 in the first place.
  it('yields exactly the 10 fictional references on the HotCRM corpus, 0 false positives', () => {
    const stack = {
      skills: [
        { name: 'live_data', tools: ['describe_object', 'list_objects', 'query_records', 'get_record', 'aggregate_data'] },
        { name: 'customer_360', tools: ['search_knowledge'] },
        { name: 'case_triage', tools: ['triage_case'] },
        { name: 'email_drafting', tools: ['generate_email_copy', 'optimize_subject_line', 'personalize_content', 'generate_email'] },
        { name: 'lead_qualification', tools: ['analyze_lead', 'suggest_next_action'] },
        { name: 'revenue_forecasting', tools: ['analyze_pipeline', 'identify_at_risk', 'forecast_revenue'] },
      ],
    };
    const findings = validateAiToolReferences(stack);
    expect(findings).toHaveLength(10);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
    expect(findings.every((f) => f.rule === AI_SKILL_TOOL_UNRESOLVED)).toBe(true);
    const flagged = findings.map((f) => f.message.match(/^Tool "([a-z_]+)"/)?.[1]);
    expect(flagged).toEqual([
      'triage_case',
      'generate_email_copy',
      'optimize_subject_line',
      'personalize_content',
      'generate_email',
      'analyze_lead',
      'suggest_next_action',
      'analyze_pipeline',
      'identify_at_risk',
      'forecast_revenue',
    ]);
  });

  it('resolves declared stack.tools records (the optional refinement layer)', () => {
    const stack = {
      tools: [{ name: 'quote_discount', label: 'Quote', description: 'x' }],
      skills: [{ name: 's', tools: ['quote_discount'] }],
    };
    expect(validateAiToolReferences(stack)).toEqual([]);
  });

  const exposed = (name: string, type = 'script') => ({
    name,
    label: name,
    type,
    target: name,
    ai: { exposed: true, description: 'A sufficiently long LLM-facing description of the action.' },
  });

  it('resolves materialised action tools from stack-level and object-level actions', () => {
    const stack = {
      actions: [exposed('send_invoice')],
      objects: [{ name: 'crm_case', actions: [exposed('triage_case', 'flow')] }],
      skills: [{ name: 's', tools: ['action_send_invoice', 'action_triage_case'] }],
    };
    expect(validateAiToolReferences(stack)).toEqual([]);
  });

  // ADR-0011 — the runtime materialises `action_<name>` ONLY for an action
  // that opted in AND has a headless path. Resolving against every declared
  // action would bless a reference the agent can never call: the exact
  // failure this rule exists to catch, one layer down.
  it('does NOT resolve an action that is not AI-exposed', () => {
    const stack = {
      actions: [{ name: 'send_invoice', label: 'Send', type: 'script', target: 'send_invoice' }],
      skills: [{ name: 's', tools: ['action_send_invoice'] }],
    };
    const findings = validateAiToolReferences(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('does not become an AI tool');
    expect(findings[0].hint).toContain('ai: { exposed: true');
  });

  it('does NOT resolve a UI-only action type, even when opted in', () => {
    // `modal`/`form`/`url` have no headless invocation path — staying
    // human-driven is a legitimate design answer, and `os explain` says so
    // ([#22161]: the one-line `fix:` names the UI-action route).
    for (const type of ['modal', 'form', 'url']) {
      const stack = {
        actions: [{ ...exposed('escalate_case'), type }],
        skills: [{ name: 's', tools: ['action_escalate_case'] }],
      };
      const findings = validateAiToolReferences(stack);
      expect(findings, type).toHaveLength(1);
      expect(findings[0].hint).toContain('recommend the UI action');
    }
    expect(explainRule(AI_SKILL_TOOL_UNRESOLVED)!.paragraphs.join('\n')).toContain(
      'stays human-driven by design: that is a legitimate answer, not a gap',
    );
  });

  it('does NOT resolve an exposed action missing its LLM-facing description', () => {
    const stack = {
      actions: [{ name: 'send_invoice', type: 'script', target: 'x', ai: { exposed: true } }],
      skills: [{ name: 's', tools: ['action_send_invoice'] }],
    };
    expect(validateAiToolReferences(stack)).toHaveLength(1);
  });

  it('does NOT resolve a flow/api action with no target to dispatch', () => {
    const stack = {
      actions: [{ name: 'run_it', type: 'flow', ai: { exposed: true, description: 'x'.repeat(45) } }],
      skills: [{ name: 's', tools: ['action_run_it'] }],
    };
    expect(validateAiToolReferences(stack)).toHaveLength(1);
  });

  it('does NOT resolve a bare action name — the tool is the materialised action_<name>', () => {
    // The ADR-0109 default path is `action_<name>`; naming the raw action is
    // the near-miss the hint should catch, via the suggestion.
    const stack = {
      objects: [{ name: 'crm_case', actions: [exposed('triage_case', 'flow')] }],
      skills: [{ name: 's', tools: ['triage_case'] }],
    };
    const findings = validateAiToolReferences(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Did you mean "action_triage_case"?');
  });

  // #14577 — the `action_<name>` prefix pre-pass stays rule-local (it is
  // knowledge about ADR-0109's materialised family, not something the shared
  // helper should know), but a miss now falls through to `suggestName`
  // (#14268) instead of a private Levenshtein copy. This case has no
  // `action_`-prefixed match at all, so it pins that the fallback still fires
  // — via containment, the class the private copy could not reach.
  it('falls through to suggestName (containment) when the prefix pre-pass misses', () => {
    const stack = {
      tools: [{ name: 'search_knowledge_base', label: 'Search KB', description: 'x' }],
      skills: [{ name: 's', tools: ['knowledge_base'] }],
    };
    const findings = validateAiToolReferences(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Did you mean "search_knowledge_base"?');
  });

  it('resolves trailing-wildcard families against the universe', () => {
    const withActions = {
      objects: [{ name: 'crm_case', actions: [exposed('triage_case', 'flow')] }],
      skills: [{ name: 's', tools: ['action_*'] }],
    };
    expect(validateAiToolReferences(withActions)).toEqual([]);

    // A family subscription that matches nothing contributes zero tools.
    const withoutActions = { skills: [{ name: 's', tools: ['crm_*'] }] };
    const findings = validateAiToolReferences(withoutActions);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Tool family "crm_*"');
  });

  it('resolves platform registry names without any stack declarations', () => {
    const stack = { skills: [{ name: 's', tools: ['query_records', 'verify_build', 'suggest_builder'] }] };
    expect(validateAiToolReferences(stack)).toEqual([]);
  });

  /**
   * [#16512] The five `service-ai-studio` tools the cloud runtime registers
   * that the registry did not list.
   *
   * `PLATFORM_PROVIDED_TOOL_NAMES` is the load-bearing half of
   * `skill.tools[]` reference integrity under ADR-0109, so while these five
   * were absent a skill naming any of them was reported as a FICTIONAL tool —
   * the precise failure the registry exists to end. The pin lives here, not
   * beside the constant: "refused" and "accepted" are this rule's verdicts,
   * and the list's own file can only pin its shape.
   */
  it('resolves the five service-ai-studio tools the registry was missing (#16512)', () => {
    const five = ['test_flow', 'toggle_flow', 'get_authoring_rules', 'load_tools', 'open_record'];
    expect(validateAiToolReferences({ skills: [{ name: 's', tools: five }] })).toEqual([]);

    // The control, without which this pin cannot fail: a sixth name shaped
    // exactly like the five and registered by nobody is STILL reported. A
    // universe widened until everything resolves would pass the assertion
    // above and fail this one.
    const control = validateAiToolReferences({
      skills: [{ name: 's', tools: [...five, 'archive_flow'] }],
    });
    expect(control).toHaveLength(1);
    expect(control[0].path).toBe('skills[0].tools[5]');
    expect(control[0].message).toContain('archive_flow');
  });

  /**
   * [#27002] The two `service-ai` package-doc tools cloud#3335 adds to the
   * `ask` agent (`search_package_docs`, `read_package_doc`): the same widening
   * #16512 made for five `service-ai-studio` tools, so a skill naming either
   * resolves instead of being reported as a fictional tool.
   */
  it('resolves the two service-ai package-doc tools (#27002)', () => {
    const two = ['search_package_docs', 'read_package_doc'];
    expect(validateAiToolReferences({ skills: [{ name: 's', tools: two }] })).toEqual([]);

    // The control: a third name shaped like the two and registered by nobody
    // is still reported, so this pin fails on a universe widened too far.
    const control = validateAiToolReferences({
      skills: [{ name: 's', tools: [...two, 'list_package_docs'] }],
    });
    expect(control).toHaveLength(1);
    expect(control[0].path).toBe('skills[0].tools[2]');
    expect(control[0].message).toContain('list_package_docs');
  });

  /**
   * The `ask` agent's new-record draft signal (cloud#3383, ui half #28104): a
   * skill naming `draft_record` resolves; a near name nobody registers does not.
   */
  it('resolves the service-ai-studio record-draft signal', () => {
    expect(validateAiToolReferences({ skills: [{ name: 's', tools: ['draft_record'] }] })).toEqual([]);

    const control = validateAiToolReferences({
      skills: [{ name: 's', tools: ['draft_record', 'draft_records'] }],
    });
    expect(control).toHaveLength(1);
    expect(control[0].path).toBe('skills[0].tools[1]');
    expect(control[0].message).toContain('draft_records');
  });

  it('reports stable paths and tolerates junk shapes', () => {
    const stack = {
      skills: [{ name: 's', tools: ['query_records', 'nope_tool'] }],
    };
    const findings = validateAiToolReferences(stack);
    expect(findings.map((f) => f.path)).toEqual(['skills[0].tools[1]']);

    expect(validateAiToolReferences({})).toEqual([]);
    expect(validateAiToolReferences({ skills: 'nope', tools: 42 } as never)).toEqual([]);
    expect(
      validateAiToolReferences({ skills: [null, { tools: [7, null, 'query_records'] }] } as never),
    ).toEqual([]);
  });

  /**
   * [#15444] The declarative `operation: 'update'` action materialises a tool.
   *
   * `materialisesAsTool` mirrors the runtime's headless-invocability door, and
   * that door learned `operation` before `type` in #15079 — the declarative
   * single-record field write (#14092) is invokable with NEITHER a `target`
   * nor a `body`, because `ActionSchema` refuses both beside
   * `operation: 'update'` and the platform action route performs the write.
   * While this mirror still read `type` only, its `script` arm answered
   * `false`: `action_mark_done` was reported as a fictional tool reference and
   * the action was offered in the near-miss hint as one that never
   * materialises — for metadata the runtime lists and runs.
   */
  it('materialises a tool for a declarative `operation: \'update\'` action (no target, no body)', () => {
    const markDone = {
      name: 'mark_done',
      operation: 'update',
      patch: { status: 'done' },
      ai: { exposed: true, description: 'Mark the current task done.' },
    };
    const stack = {
      objects: [{ name: 'todo_task', actions: [markDone] }],
      skills: [{ name: 's', tools: ['action_mark_done'] }],
    };
    expect(validateAiToolReferences(stack)).toEqual([]);

    // Positive control, same rule and same shape: an AI-exposed `script`
    // action with no `operation` and nothing to dispatch on still does NOT
    // materialise, so a reference to it is still reported. Without this a
    // predicate hard-wired to `true` would pass the assertion above.
    const wiredToNothing = { ...markDone, operation: undefined, patch: undefined };
    const control = validateAiToolReferences({
      objects: [{ name: 'todo_task', actions: [wiredToNothing] }],
      skills: [{ name: 's', tools: ['action_mark_done'] }],
    });
    expect(control).toHaveLength(1);
    expect(control[0].path).toBe('skills[0].tools[0]');
  });
});

describe('[#22161] one-line verdicts — ai-skill-tool-unresolved', () => {
  it('reads as one sentence per arm', () => {
    const family = validateAiToolReferences({ skills: [{ name: 's', tools: ['crm_*'] }] });
    expect(family.map((f) => f.message)).toEqual([
      'Tool family "crm_*" matches no tool this stack can resolve, so the subscription contributes zero tools '
        + 'at runtime',
    ]);
    const unexposed = validateAiToolReferences({
      actions: [{ name: 'send_invoice', label: 'Send', type: 'script', target: 'send_invoice' }],
      skills: [{ name: 's', tools: ['action_send_invoice'] }],
    });
    expect(unexposed.map((f) => f.message)).toEqual([
      'Tool "action_send_invoice" names action "send_invoice", which does not become an AI tool (it needs '
        + '`ai.exposed` and a headless path), so the runtime drops the reference',
    ]);
    const fictional = validateAiToolReferences({ skills: [{ name: 's', tools: ['nope_tool'] }] });
    expect(fictional.map((f) => f.message)).toEqual([
      'Tool "nope_tool" resolves to no stack, platform or materialised action tool, so the runtime drops it '
        + 'and the agent cannot call it.',
    ]);
  });

  it('`os explain` carries what the verdict no longer says', () => {
    const entry = explainRule(AI_SKILL_TOOL_UNRESOLVED);
    expect(entry, 'no `os explain ai-skill-tool-unresolved` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    // The three sources, the wildcard, the opt-in and the headless paths are
    // each held to the rule by the cases above and the one below.
    for (const fact of [
      '`stack.tools`',
      '`PLATFORM_PROVIDED_TOOL_NAMES`',
      '`stack.actions` or any object\'s `actions`',
      'trailing-wildcard',
      '`ai.exposed: true` with an `ai.description` (ADR-0011)',
      '`operation: \'update\'`',
      'a `script` action with a target or a body',
      'an `api` or `flow` action with a target',
      '`url`, `modal` or `form` action is UI-only',
      'advisory-first ratchet',
      'never at the runtime publish gate',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });

  it('each headless path the explanation names materialises a tool', () => {
    const description = 'A sufficiently long LLM-facing description of the action.';
    for (const action of [
      { name: 'a', type: 'script', target: 'a' },
      { name: 'a', type: 'script', body: 'return 1;' },
      { name: 'a', type: 'api', target: '/x' },
      { name: 'a', type: 'flow', target: 'f' },
    ]) {
      const stack = { actions: [{ ...action, ai: { exposed: true, description } }], skills: [{ name: 's', tools: ['action_a'] }] };
      expect(validateAiToolReferencesUnrecorded(stack), JSON.stringify(action)).toEqual([]);
    }
    // The control: the same action without its opt-in is reported.
    expect(validateAiToolReferencesUnrecorded({
      actions: [{ name: 'a', type: 'api', target: '/x' }],
      skills: [{ name: 's', tools: ['action_a'] }],
    })).toHaveLength(1);
  });

  it('every verdict the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === AI_SKILL_TOOL_UNRESOLVED);
    // The coverage control first: all three arms fired.
    expect(converted.some((f) => f.message.startsWith('Tool family '))).toBe(true);
    expect(converted.some((f) => f.message.includes('does not become an AI tool'))).toBe(true);
    expect(converted.some((f) => f.message.includes('resolves to no stack, platform or materialised action tool'))).toBe(true);
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});

// [#22161] Slice 12: the `fix:` line. One remedy line per arm; the design note
// on UI-only actions, the ADR-0109 default path, the family prefixes and the
// runtime-plugin exception are the explanation's.
describe('[#22161] one-line fixes — ai-skill-tool-unresolved', () => {
  it('every `fix:` line the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === AI_SKILL_TOOL_UNRESOLVED);
    // Coverage control: the opt-in arm and the back-it arm both fired.
    expect(converted.some((f) => f.hint.startsWith('Opt "'))).toBe(true);
    expect(converted.some((f) => f.hint.startsWith('Back "'))).toBe(true);
    for (const f of converted) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain` names exactly the family prefixes the runtime materialises, and the moved text', () => {
    const text = explainRule(AI_SKILL_TOOL_UNRESOLVED)!.paragraphs.join('\n');
    expect(text).toContain(`Family prefixes materialised by the runtime: ${PLATFORM_TOOL_FAMILY_PREFIXES.join(', ')}.`);
    expect(text).toContain('the ADR-0109 default path');
    expect(text).toContain('at least 40 characters');
    expect(text).toContain('a runtime plugin outside the platform registry provides the name');
  });
});
