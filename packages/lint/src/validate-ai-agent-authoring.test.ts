// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateAiAgentAuthoring as validateAiAgentAuthoringUnrecorded,
  AGENT_AUTHORING_WITHDRAWN,
  DEFAULT_AGENT_OUTSIDE_ROSTER,
  DEFAULT_AGENT_LEGACY_ALIAS,
} from './validate-ai-agent-authoring.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to carry
// is the id's `os explain` entry. Every call below records what it fired, and
// the last cases in this file hold each recorded verdict to one line of at most
// 200 characters — every firing variant this suite exercises, not a chosen few.
// Run the whole file: those cases read what the cases above fired.
const fired: Array<{ rule: string; message: string }> = [];
const validateAiAgentAuthoring: typeof validateAiAgentAuthoringUnrecorded = (...args) => {
  const findings = validateAiAgentAuthoringUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

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
      // Names the allowed set — the CANONICAL two only (#14461). The legacy
      // aliases must not appear here: this string is the prescription, and
      // offering `metadata_assistant` as a thing to write is the very defect
      // #14461 closed.
      expect(findings[0].message).toContain('ask');
      expect(findings[0].message).toContain('build');
      expect(findings[0].message).not.toContain('data_chat');
      expect(findings[0].message).not.toContain('metadata_assistant');
      expect(findings[0].hint).toContain('ask');
      expect(findings[0].hint).toContain('build');
      expect(findings[0].hint).not.toContain('metadata_assistant');
    });

    it('passes the canonical platform agent names', () => {
      for (const defaultAgent of ['ask', 'build']) {
        const stack = { apps: [{ name: 'app', defaultAgent }] };
        expect(validateAiAgentAuthoring(stack), defaultAgent).toEqual([]);
      }
    });

    describe('legacy alias values (issue #14461)', () => {
      // Studio itself pinned `metadata_assistant` while the published skill
      // told authors never to write it, and this rule — reusing the four-name
      // roster — waved the alias through. The value limb now judges against
      // the canonical two, and an alias gets its own id and prescription.
      it.each([
        ['metadata_assistant', 'build'],
        ['data_chat', 'ask'],
      ])('flags %s and prescribes %s', (alias, canonical) => {
        const findings = validateAiAgentAuthoring({
          apps: [{ name: 'studio', defaultAgent: alias }],
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
          severity: 'warning',
          rule: DEFAULT_AGENT_LEGACY_ALIAS,
          where: 'app "studio".defaultAgent',
          path: 'apps[0].defaultAgent',
        });
        expect(findings[0].message).toContain(`"${alias}"`);
        expect(findings[0].message).toContain(`"${canonical}"`);
        expect(findings[0].hint).toContain(`defaultAgent: '${canonical}'`);
      });

      it('says the alias RESOLVES — it is a spelling defect, not a broken pin', () => {
        // The distinction the separate rule id exists to carry: an unknown
        // name is inert at runtime, an alias is not. A message that described
        // the alias as "no effect" would be false, and an author who read it
        // would go looking for a bug that is not there.
        const [alias] = validateAiAgentAuthoring({
          apps: [{ name: 'studio', defaultAgent: 'metadata_assistant' }],
        });
        const [unknown] = validateAiAgentAuthoring({
          apps: [{ name: 'crm', defaultAgent: 'sales_copilot' }],
        });
        expect(alias.message).toContain('still resolves');
        expect(alias.message).not.toContain('has no effect');
        expect(unknown.message).toContain('has no effect');
      });

      it('leaves the DECLARATION limb reading all four names', () => {
        // The two limbs ask different questions, so they keep different
        // rosters: declaring `metadata_assistant` shadows the `build` record
        // through the alias exactly as declaring `build` does, and that
        // judgement is unchanged by #14461.
        for (const name of ['ask', 'build', 'data_chat', 'metadata_assistant']) {
          const findings = validateAiAgentAuthoring({ agents: [{ name }] });
          expect(findings, name).toHaveLength(1);
          expect(findings[0].rule, name).toBe(AGENT_AUTHORING_WITHDRAWN);
          expect(findings[0].message, name).toContain('PLATFORM agent id');
        }
      });
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

describe('[#22161] one-line verdicts — the three agent-authoring ids', () => {
  const IDS = [AGENT_AUTHORING_WITHDRAWN, DEFAULT_AGENT_OUTSIDE_ROSTER, DEFAULT_AGENT_LEGACY_ALIAS];

  it('every verdict the cases above fired is one line of at most 200 characters', () => {
    // The coverage control first: all three ids fired, and both arms of the
    // declaration id, so the shape assertion cannot pass over a partial record.
    expect([...new Set(fired.map((f) => f.rule))].sort()).toEqual([...IDS].sort());
    const declared = fired.filter((f) => f.rule === AGENT_AUTHORING_WITHDRAWN);
    expect(declared.some((f) => f.message.includes('PLATFORM agent id'))).toBe(true);
    expect(declared.some((f) => f.message.includes('were withdrawn'))).toBe(true);
    for (const f of fired) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });

  it('reads as one sentence per arm', () => {
    const findings = validateAiAgentAuthoring({
      agents: [{ name: 'sales_copilot' }, { name: 'build' }],
      apps: [
        { name: 'studio', defaultAgent: 'metadata_assistant' },
        { name: 'crm', defaultAgent: 'sales_copilot' },
      ],
    });
    expect(findings.map((f) => f.message)).toEqual([
      'This stack declares the agent "sales_copilot", but app-package agents were withdrawn (ADR-0063 §2): ' +
        'the runtime filters it out of the agent catalog and refuses to load it, so it never runs',
      'This stack declares an agent named "build", which is a PLATFORM agent id, so the runtime serves ' +
        'its own record for that name and this declaration has no effect',
      'app "studio" pins `defaultAgent` to "metadata_assistant", the RETIRED alias of platform agent ' +
        '"build": it still resolves, but only through the alias registry',
      'app "crm" pins `defaultAgent` to "sales_copilot", which is not a platform agent (ask, build), so ' +
        'it silently falls back to the platform default and the pin has no effect',
    ]);
  });

  it('`os explain` carries what the verdicts no longer say', () => {
    const facts: Record<string, string[]> = {
      [AGENT_AUTHORING_WITHDRAWN]: ['`listAgents()`', '`loadAgent()`', '404s on chat', 'inert metadata', 'ADR-0078'],
      [DEFAULT_AGENT_OUTSIDE_ROSTER]: ['ADR-0063 §1', 'snake_case identifier', 'walked back once'],
      [DEFAULT_AGENT_LEGACY_ALIAS]: ['persisted `agent_id`s', 'the weaker pin', 'in-process alias registration'],
    };
    for (const [rule, list] of Object.entries(facts)) {
      const entry = explainRule(rule);
      expect(entry, `no \`os explain ${rule}\` entry`).toBeDefined();
      const text = entry!.paragraphs.join('\n');
      for (const fact of list) expect(text, `${rule} explanation names ${fact}`).toContain(fact);
    }
  });

  it("the roster paragraph's aliases are the ones the rule resolves", () => {
    // The explanation module imports nothing, so it spells the aliases out;
    // this holds each spelling to the rule by running it.
    const roster = explainRule(DEFAULT_AGENT_LEGACY_ALIAS)!.paragraphs[0]!;
    for (const [alias, canonical] of [['data_chat', 'ask'], ['metadata_assistant', 'build']] as const) {
      expect(roster).toContain(`\`${alias}\` for \`${canonical}\``);
      const [finding] = validateAiAgentAuthoringUnrecorded({ apps: [{ name: 'a', defaultAgent: alias }] });
      expect(finding).toMatchObject({ rule: DEFAULT_AGENT_LEGACY_ALIAS });
      expect(finding!.message).toContain(`platform agent "${canonical}"`);
    }
    // One paragraph, printed under all three ids it explains.
    expect(explainRule(DEFAULT_AGENT_OUTSIDE_ROSTER)!.paragraphs[0]).toBe(roster);
    expect(explainRule(AGENT_AUTHORING_WITHDRAWN)!.paragraphs[0]).toBe(roster);
  });
});
