// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateAiSurfaceAffinity as validateAiSurfaceAffinityUnrecorded,
  AI_SKILL_SURFACE_MISMATCH,
} from './validate-ai-surface-affinity.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is `os explain ai-skill-surface-mismatch`. Every direct call below
// records what it fired, and the last cases in this file hold each recorded
// verdict to one line of at most 200 characters — every firing variant this
// suite exercises, not a chosen few. Run the whole file: those cases read what
// the cases above fired.
const fired: Array<{ rule: string; message: string; hint: string }> = [];
const validateAiSurfaceAffinity: typeof validateAiSurfaceAffinityUnrecorded = (...args) => {
  const findings = validateAiSurfaceAffinityUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

describe('validate-ai-surface-affinity', () => {
  // ── The false-positive floor, read per branch (#3806 lesson) ──────────────
  // `examples/` declares zero agents/skills, so it proves nothing about this
  // rule. The floor is instead the real shipped corpus the issue measured:
  // HotCRM's two agents × six skills, none of which declares a `surface`
  // (raw config — no Zod defaults applied). Every binding must pass.
  it('is clean on the HotCRM-shaped corpus (no surface fields anywhere)', () => {
    const stack = {
      agents: [
        {
          name: 'sales_copilot',
          skills: [
            'live_data',
            'lead_qualification',
            'email_drafting',
            'revenue_forecasting',
            'customer_360',
          ],
        },
        {
          name: 'service_copilot',
          skills: ['case_triage', 'customer_360', 'email_drafting'],
        },
      ],
      skills: [
        { name: 'live_data', tools: ['describe_object'] },
        { name: 'lead_qualification', tools: ['analyze_lead'] },
        { name: 'email_drafting', tools: ['generate_email'] },
        { name: 'revenue_forecasting', tools: ['forecast_revenue'] },
        { name: 'customer_360', tools: ['search_knowledge'] },
        { name: 'case_triage', tools: ['triage_case'] },
      ],
    };
    expect(validateAiSurfaceAffinity(stack)).toEqual([]);
  });

  it("flags an 'ask' agent referencing a 'build' skill", () => {
    const stack = {
      agents: [{ name: 'helper', surface: 'ask', skills: ['metadata_authoring'] }],
      skills: [{ name: 'metadata_authoring', surface: 'build', tools: [] }],
    };
    const findings = validateAiSurfaceAffinity(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: AI_SKILL_SURFACE_MISMATCH,
      where: 'agent "helper" · skills',
      path: 'agents[0].skills[0]',
    });
    expect(findings[0].message).toContain("'ask'");
    expect(findings[0].message).toContain("'build'");
  });

  it("flags a 'build' agent referencing an 'ask' skill (symmetric)", () => {
    const stack = {
      agents: [{ name: 'builder', surface: 'build', skills: ['data_explorer'] }],
      skills: [{ name: 'data_explorer', surface: 'ask', tools: [] }],
    };
    const findings = validateAiSurfaceAffinity(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('agents[0].skills[0]');
  });

  it("accepts surface: 'both' on either agent surface", () => {
    const stack = {
      agents: [
        { name: 'asker', surface: 'ask', skills: ['schema_tools'] },
        { name: 'builder', surface: 'build', skills: ['schema_tools'] },
      ],
      skills: [{ name: 'schema_tools', surface: 'both', tools: [] }],
    };
    expect(validateAiSurfaceAffinity(stack)).toEqual([]);
  });

  it("defaults an absent surface to 'ask' on BOTH sides (mirrors the runtime)", () => {
    // Agent without surface (→ 'ask') referencing a build skill: must flag.
    const stack = {
      agents: [{ name: 'helper', skills: ['metadata_authoring'] }],
      skills: [{ name: 'metadata_authoring', surface: 'build', tools: [] }],
    };
    expect(validateAiSurfaceAffinity(stack)).toHaveLength(1);

    // Skill without surface (→ 'ask') referenced by a build agent: must flag.
    const inverse = {
      agents: [{ name: 'builder', surface: 'build', skills: ['plain'] }],
      skills: [{ name: 'plain', tools: [] }],
    };
    expect(validateAiSurfaceAffinity(inverse)).toHaveLength(1);
  });

  it('skips references that do not resolve in-stack (kernel/runtime-registered skills)', () => {
    // `ask`/`build` kernel skills (schema_reader, data_explorer, …) register at
    // boot and are statically invisible — resolving them against `stack.skills`
    // alone is #3820 D0/D2 territory, not this rule's.
    const stack = {
      agents: [{ name: 'helper', surface: 'ask', skills: ['schema_reader', 'data_explorer'] }],
      skills: [],
    };
    expect(validateAiSurfaceAffinity(stack)).toEqual([]);
  });

  it('reports every mismatched binding, with stable paths', () => {
    const stack = {
      agents: [
        {
          name: 'helper',
          surface: 'ask',
          skills: ['ok_skill', 'authoring', 'unresolved', 'design'],
        },
      ],
      skills: [
        { name: 'ok_skill', surface: 'ask', tools: [] },
        { name: 'authoring', surface: 'build', tools: [] },
        { name: 'design', surface: 'build', tools: [] },
      ],
    };
    const findings = validateAiSurfaceAffinity(stack);
    expect(findings.map((f) => f.path)).toEqual(['agents[0].skills[1]', 'agents[0].skills[3]']);
  });

  it('tolerates junk shapes without throwing', () => {
    expect(validateAiSurfaceAffinity({})).toEqual([]);
    expect(validateAiSurfaceAffinity({ agents: 'nope', skills: 42 } as never)).toEqual([]);
    expect(
      validateAiSurfaceAffinity({
        agents: [null, { name: 'x', skills: [null, 7, 'y'] }],
        skills: [null, { surface: 'build' }, { name: 'y', surface: 'build' }],
      } as never),
    ).toHaveLength(1);
  });
});

describe('[#22161] one-line verdicts — ai-skill-surface-mismatch', () => {
  it('reads as one sentence', () => {
    const findings = validateAiSurfaceAffinity({
      agents: [{ name: 'helper', surface: 'ask', skills: ['metadata_authoring'] }],
      skills: [{ name: 'metadata_authoring', surface: 'build', tools: [] }],
    });
    expect(findings.map((f) => f.message)).toEqual([
      'Agent "helper" (surface \'ask\') references skill "metadata_authoring" (surface \'build\'), so the '
        + 'runtime refuses the binding and chatting with this agent fails at request time',
    ]);
  });

  it('`os explain` carries what the verdict no longer says', () => {
    const entry = explainRule(AI_SKILL_SURFACE_MISMATCH);
    expect(entry, 'no `os explain ai-skill-surface-mismatch` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    // The defaults, the `both` arm and the skipped unresolved name are each
    // held to the rule by the cases above.
    for (const fact of [
      'ADR-0063 §1',
      'ADR-0063 §3',
      'ADR-0064 §3',
      '`both` attaches to either',
      'defaults to `ask`',
      '`resolveActiveSkills()` throws',
      'parsed, validated and deployed cleanly',
      'skipped, not reported',
      '`schema_reader`',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });

  it('every verdict the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === AI_SKILL_SURFACE_MISMATCH);
    // The coverage control first: both directions of the mismatch fired.
    expect(converted.some((f) => f.message.includes("(surface 'ask') references skill"))).toBe(true);
    expect(converted.some((f) => f.message.includes("(surface 'build') references skill"))).toBe(true);
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});

// [#22161] Slice 16: the `fix:` line names the three ways out in one line; when
// `surface: 'both'` is right is the explanation's.
describe('[#22161] one-line fix — ai-skill-surface-mismatch', () => {
  it('reads as one remedy, a long skill name included, at most 200 characters', () => {
    const ref = 'regional_enterprise_pipeline_forecast_reviewer';
    const [f] = validateAiSurfaceAffinity({
      agents: [{ name: 'sales_assistant', surface: 'ask', skills: [ref] }],
      skills: [{ name: ref, surface: 'build' }],
    });
    expect(f!.hint).toBe(
      `Move "${ref}" to a 'build'-surface agent, change its \`surface\` to 'ask', or declare \`surface: 'both'\` ` +
        'for a shared, read-only skill',
    );
    const converted = fired.filter((x) => x.rule === AI_SKILL_SURFACE_MISMATCH);
    expect(converted.length).toBeGreaterThan(1);
    for (const x of converted) {
      expect(x.hint, x.rule).not.toContain('\n');
      expect(x.hint.length, `${x.rule}: ${x.hint}`).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain` carries what the `fix:` line no longer says', () => {
    const text = explainRule(AI_SKILL_SURFACE_MISMATCH)!.paragraphs.join('\n');
    expect(text).toContain("Declare `surface: 'both'` only for a genuinely shared, read-only capability");
  });
});
