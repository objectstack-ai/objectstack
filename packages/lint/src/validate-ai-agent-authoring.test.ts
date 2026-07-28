// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateAiAgentAuthoring,
  AGENT_AUTHORING_WITHDRAWN,
} from './validate-ai-agent-authoring.js';

describe('validate-ai-agent-authoring', () => {
  it('is silent for the stack every app package should be — no agents at all', () => {
    expect(validateAiAgentAuthoring({ skills: [{ name: 's', tools: [] }] })).toEqual([]);
    expect(validateAiAgentAuthoring({ agents: [] })).toEqual([]);
    expect(validateAiAgentAuthoring({})).toEqual([]);
  });

  it('flags a custom agent and points at the skills that already carry it', () => {
    // The HotCRM shape: a persona referencing skills that do the actual work.
    const stack = {
      agents: [
        {
          name: 'sales_copilot',
          label: 'Sales Copilot',
          skills: ['live_data', 'lead_qualification', 'email_drafting'],
        },
      ],
    };
    const findings = validateAiAgentAuthoring(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      rule: AGENT_AUTHORING_WITHDRAWN,
      where: 'agent "sales_copilot"',
      path: 'agents[0]',
    });
    expect(findings[0].message).toContain('ADR-0063 §2');
    expect(findings[0].hint).toContain('3 skills');
  });

  it('omits the skill sentence when the agent references none', () => {
    const findings = validateAiAgentAuthoring({ agents: [{ name: 'lonely' }] });
    expect(findings).toHaveLength(1);
    expect(findings[0].hint).not.toContain('skills this agent references');
  });

  it('uses distinct wording when a stack shadows a platform agent id', () => {
    for (const name of ['ask', 'build', 'data_chat', 'metadata_assistant']) {
      const findings = validateAiAgentAuthoring({ agents: [{ name }] });
      expect(findings, name).toHaveLength(1);
      expect(findings[0].message).toContain('PLATFORM agent id');
      expect(findings[0].hint).toContain('the platform owns');
    }
  });

  it('reports every declared agent with stable paths', () => {
    const stack = { agents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] };
    expect(validateAiAgentAuthoring(stack).map((f) => f.path)).toEqual([
      'agents[0]',
      'agents[1]',
      'agents[2]',
    ]);
  });

  it('tolerates junk shapes without throwing', () => {
    expect(validateAiAgentAuthoring({ agents: 'nope' } as never)).toEqual([]);
    expect(validateAiAgentAuthoring({ agents: [null, 7] } as never)).toEqual([]);
    expect(validateAiAgentAuthoring({ agents: [{ skills: 'nope' }] } as never)).toHaveLength(1);
  });
});
