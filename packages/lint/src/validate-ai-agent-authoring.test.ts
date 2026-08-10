// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateAiAgentAuthoring,
  AGENT_AUTHORING_WITHDRAWN,
  DEFAULT_AGENT_OUTSIDE_ROSTER,
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

  describe('app.defaultAgent value (issue #6041)', () => {
    it('flags a defaultAgent value outside the platform agent roster', () => {
      // The #5985 corpus shape: a plausible-looking custom agent name pinned
      // directly on the app, never caught by the schema (any snake_case string
      // parses) or by the array-scanning limb above (this app declares no
      // `agents` at all).
      const stack = {
        apps: [{ name: 'crm', defaultAgent: 'sales_copilot' }],
      };
      const findings = validateAiAgentAuthoring(stack);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: 'warning',
        rule: DEFAULT_AGENT_OUTSIDE_ROSTER,
        where: 'app "crm".defaultAgent',
        path: 'apps[0].defaultAgent',
      });
      // Names the offending value.
      expect(findings[0].message).toContain('"sales_copilot"');
      // Names the allowed set (canonical + legacy aliases).
      expect(findings[0].message).toContain('ask');
      expect(findings[0].message).toContain('build');
      expect(findings[0].message).toContain('data_chat');
      expect(findings[0].message).toContain('metadata_assistant');
      expect(findings[0].hint).toContain('ask');
      expect(findings[0].hint).toContain('build');
    });

    it('passes every canonical platform agent name and every legacy alias', () => {
      for (const defaultAgent of ['ask', 'build', 'data_chat', 'metadata_assistant']) {
        const stack = { apps: [{ name: 'app', defaultAgent }] };
        expect(validateAiAgentAuthoring(stack), defaultAgent).toEqual([]);
      }
    });

    it('is silent when defaultAgent is absent, empty, or not a string', () => {
      expect(validateAiAgentAuthoring({ apps: [{ name: 'a' }] })).toEqual([]);
      expect(validateAiAgentAuthoring({ apps: [{ name: 'a', defaultAgent: '' }] })).toEqual([]);
      expect(
        validateAiAgentAuthoring({ apps: [{ name: 'a', defaultAgent: 42 }] } as never),
      ).toEqual([]);
      expect(validateAiAgentAuthoring({ apps: [] })).toEqual([]);
      expect(validateAiAgentAuthoring({})).toEqual([]);
    });

    it('reports every offending app with stable paths, alongside the agents-array limb', () => {
      const stack = {
        agents: [{ name: 'legacy_bot' }],
        apps: [
          { name: 'a', defaultAgent: 'ask' },
          { name: 'b', defaultAgent: 'rogue_one' },
          { name: 'c', defaultAgent: 'rogue_two' },
        ],
      };
      const findings = validateAiAgentAuthoring(stack);
      expect(findings.map((f) => f.rule)).toEqual([
        AGENT_AUTHORING_WITHDRAWN,
        DEFAULT_AGENT_OUTSIDE_ROSTER,
        DEFAULT_AGENT_OUTSIDE_ROSTER,
      ]);
      expect(findings.slice(1).map((f) => f.path)).toEqual([
        'apps[1].defaultAgent',
        'apps[2].defaultAgent',
      ]);
    });

    it('tolerates junk app shapes without throwing', () => {
      expect(validateAiAgentAuthoring({ apps: 'nope' } as never)).toEqual([]);
      expect(validateAiAgentAuthoring({ apps: [null, 7] } as never)).toEqual([]);
      expect(
        validateAiAgentAuthoring({ apps: [{ defaultAgent: 'rogue' }] } as never),
      ).toHaveLength(1);
    });
  });
});
