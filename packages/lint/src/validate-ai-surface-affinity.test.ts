// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateAiSurfaceAffinity,
  AI_SKILL_SURFACE_MISMATCH,
} from './validate-ai-surface-affinity.js';

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
