// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  lintDeprecatedAliases,
  ACTION_TARGET_EXECUTE_CONFLICT,
  FIELD_REQUIREDWHEN_CONDITIONALREQUIRED_CONFLICT,
  AGENT_KNOWLEDGE_SOURCES_TOPICS_CONFLICT,
} from './deprecated-aliases';

// ── #3743: the discarded `execute` alias now has an author-facing warning ──
//
// #3742 made `target` win everywhere and had the `ActionSchema` transform DROP
// `execute` from its output, so "two different scripts for one button" became
// unrepresentable. What it left: when an author declares both slots with
// different values, the losing one is thrown away **silently**. Prime Directive
// #12 wants that surfaced at authoring time, which is why this lint exists — and
// why it runs PRE-parse: the transform it reports on has already erased the
// evidence by the time anything downstream gets to look.

const action = (extra: Record<string, unknown>) => ({
  name: 'convert',
  label: 'Convert',
  type: 'script',
  ...extra,
});

describe('lintDeprecatedAliases — quiet paths', () => {
  it('says nothing when only the canonical `target` is declared', () => {
    expect(lintDeprecatedAliases({ actions: [action({ target: 'preferredHandler' })] })).toEqual([]);
  });

  it('says nothing when only the deprecated `execute` is declared', () => {
    // The alias alone is lowered into `target` and works. Deprecation nagging is
    // a separate decision from reporting a DISCARDED handler; this rule reports
    // the discard only.
    expect(lintDeprecatedAliases({ actions: [action({ execute: 'legacyHandler' })] })).toEqual([]);
  });

  it('says nothing when both slots carry the SAME value', () => {
    // Redundant, not contradictory — nothing the author wrote is lost.
    const stack = { actions: [action({ target: 'sameHandler', execute: 'sameHandler' })] };
    expect(lintDeprecatedAliases(stack)).toEqual([]);
  });

  it('says nothing when both slots hold the very same function reference', () => {
    const handler = function sharedHandler() { return 'shared'; };
    const stack = { actions: [action({ target: handler, execute: handler })] };
    expect(lintDeprecatedAliases(stack)).toEqual([]);
  });

  it('treats an empty-string slot as undeclared', () => {
    const stack = { actions: [action({ target: '', execute: 'legacyHandler' })] };
    expect(lintDeprecatedAliases(stack)).toEqual([]);
  });

  it('tolerates a stack with no actions at all', () => {
    expect(lintDeprecatedAliases({})).toEqual([]);
    expect(lintDeprecatedAliases({ objects: [{ name: 'crm_deal' }] })).toEqual([]);
  });
});

describe('lintDeprecatedAliases — action-target-execute-conflict', () => {
  it('flags the string/string pair from #3713 and names both handlers', () => {
    const stack = { actions: [action({ target: 'preferredHandler', execute: 'legacyHandler' })] };
    const findings = lintDeprecatedAliases(stack);

    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(ACTION_TARGET_EXECUTE_CONFLICT);
    // Advisory: the stack is well-defined and shippable — the cost is a handler
    // that never runs, not a broken build.
    expect(f.severity).toBe('warning');
    expect(f.where).toBe(`action 'convert'`);
    // Both values must appear, or the author cannot tell WHICH handler they lost.
    expect(f.message).toContain(`'preferredHandler'`);
    expect(f.message).toContain(`'legacyHandler'`);
    // …and the precedence has to be stated, not implied.
    expect(f.message).toContain(`'target' wins`);
    // The one-line fix (#3743 suggested shape).
    expect(f.hint).toContain(`Delete 'execute'`);
  });

  it('carries object context for an action nested under its object', () => {
    const stack = {
      objects: [{
        name: 'crm_deal',
        actions: [action({ target: 'preferredHandler', execute: 'legacyHandler' })],
      }],
    };
    const [f] = lintDeprecatedAliases(stack);
    expect(f.where).toBe(`action 'convert' on object 'crm_deal'`);
  });

  it('reports ONE finding for an action that appears both top-level and nested', () => {
    // The loader auto-populates `objects[*].actions` from `actions[*].objectName`,
    // so the same authored action routinely shows up twice. One mistake, one line.
    const both = action({ target: 'preferredHandler', execute: 'legacyHandler' });
    const stack = {
      objects: [{ name: 'crm_deal', actions: [both] }],
      actions: [both],
    };
    const findings = lintDeprecatedAliases(stack);
    expect(findings).toHaveLength(1);
    // Object-nested is walked first, so the surviving finding keeps the context.
    expect(findings[0].where).toBe(`action 'convert' on object 'crm_deal'`);
  });

  it('flags inline functions too — the silent discard is the same', () => {
    const stack = {
      actions: [action({
        target: function preferredHandler() { return 'preferred'; },
        execute: function legacyHandler() { return 'legacy'; },
      })],
    };
    const [f] = lintDeprecatedAliases(stack);
    expect(f.rule).toBe(ACTION_TARGET_EXECUTE_CONFLICT);
    expect(f.message).toContain('an inline function');
  });

  it('flags the mixed string-target / function-execute pair', () => {
    // The combination #3742 left resolving the alias's way in `lowerCallables`.
    // Both halves of #3743 meet here: the precedence fix makes `target` win, and
    // this warning is what tells the author the inline function is gone.
    const stack = {
      actions: [action({
        target: 'preferredHandler',
        execute: function legacyHandler() { return 'legacy'; },
      })],
    };
    const [f] = lintDeprecatedAliases(stack);
    expect(f.message).toContain(`'preferredHandler'`);
    expect(f.message).toContain('an inline function');
  });

  it('reads map-shaped action slots, injecting the map key as the name', () => {
    const stack = {
      objects: {
        crm_deal: {
          actions: {
            convert: { label: 'Convert', type: 'script', target: 'preferredHandler', execute: 'legacyHandler' },
          },
        },
      },
    };
    const [f] = lintDeprecatedAliases(stack);
    expect(f.where).toBe(`action 'convert' on object 'crm_deal'`);
  });

  it('reports every distinct offending action', () => {
    const stack = {
      actions: [
        action({ name: 'convert', target: 'a', execute: 'b' }),
        action({ name: 'archive', target: 'c', execute: 'd' }),
        action({ name: 'clean', target: 'e' }),
      ],
    };
    expect(lintDeprecatedAliases(stack).map((f) => f.where)).toEqual([
      `action 'convert'`,
      `action 'archive'`,
    ]);
  });
});

// ── The two sibling fold-and-drop aliases (#3743 follow-up) ──────────────────
//
// `execute` was never special: `FieldSchema` folds `conditionalRequired` into
// `requiredWhen` and `AIKnowledgeSchema` folds `topics` into `sources`, both
// dropping the alias from the parsed output exactly the same way. That makes
// all three invisible to every post-parse check, so all three belong to this
// pre-parse pass — which is the reason the pass exists as a rule SET rather
// than one hard-coded rule.

describe('lintDeprecatedAliases — field-requiredwhen-conditionalrequired-conflict', () => {
  const objectWith = (field: Record<string, unknown>) => ({
    objects: [{
      name: 'crm_task',
      fields: { due_date: { type: 'date', label: 'Due', ...field } },
    }],
  });

  it('flags a field declaring both predicates with different sources', () => {
    const findings = lintDeprecatedAliases(objectWith({
      requiredWhen: 'record.stage == "closed"',
      conditionalRequired: 'record.amount > 0',
    }));

    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(FIELD_REQUIREDWHEN_CONDITIONALREQUIRED_CONFLICT);
    expect(f.severity).toBe('warning');
    expect(f.where).toBe(`field 'due_date' on object 'crm_task'`);
    expect(f.message).toContain('record.stage == "closed"');
    expect(f.message).toContain('record.amount > 0');
    expect(f.message).toContain(`'requiredWhen' wins`);
    expect(f.message).toContain('never gates the field');
    expect(f.hint).toContain(`Delete 'conditionalRequired'`);
  });

  it('stays quiet when only one predicate slot is declared', () => {
    expect(lintDeprecatedAliases(objectWith({ requiredWhen: 'record.paid' }))).toEqual([]);
    expect(lintDeprecatedAliases(objectWith({ conditionalRequired: 'record.paid' }))).toEqual([]);
  });

  it('compares the predicate TEXT, not the wrapper', () => {
    // A bare string and the `{ dialect, source }` envelope it lowers into are
    // the same predicate written two ways — nothing is lost either way.
    expect(lintDeprecatedAliases(objectWith({
      requiredWhen: 'record.paid',
      conditionalRequired: { dialect: 'cel', source: 'record.paid' },
    }))).toEqual([]);
  });

  it('reads the envelope form on both slots', () => {
    const [f] = lintDeprecatedAliases(objectWith({
      requiredWhen: { dialect: 'cel', source: 'record.a' },
      conditionalRequired: { dialect: 'cel', source: 'record.b' },
    }));
    expect(f.rule).toBe(FIELD_REQUIREDWHEN_CONDITIONALREQUIRED_CONFLICT);
    expect(f.message).toContain('record.a');
    expect(f.message).toContain('record.b');
  });

  it('covers fields added by an object extension', () => {
    // An extension adds/overrides fields on another package's object through
    // the same `FieldSchema`, so it carries the same silent discard.
    const [f] = lintDeprecatedAliases({
      objectExtensions: [{
        objectName: 'sys_user',
        fields: { nickname: { type: 'text', requiredWhen: 'record.a', conditionalRequired: 'record.b' } },
      }],
    });
    expect(f.where).toBe(`field 'nickname' on object extension 'sys_user'`);
  });

  it('tolerates an object with no fields', () => {
    expect(lintDeprecatedAliases({ objects: [{ name: 'crm_task' }] })).toEqual([]);
  });
});

describe('lintDeprecatedAliases — agent-knowledge-sources-topics-conflict', () => {
  const agentWith = (knowledge: Record<string, unknown>) => ({
    agents: [{ name: 'support_bot', label: 'Support', knowledge }],
  });

  it('flags an agent declaring both source lists with different members', () => {
    const findings = lintDeprecatedAliases(agentWith({
      sources: ['faq', 'policies'],
      topics: ['legacy_kb'],
    }));

    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(AGENT_KNOWLEDGE_SOURCES_TOPICS_CONFLICT);
    expect(f.severity).toBe('warning');
    expect(f.where).toBe(`agent 'support_bot' knowledge`);
    expect(f.message).toContain(`'faq', 'policies'`);
    expect(f.message).toContain(`'legacy_kb'`);
    expect(f.message).toContain(`'sources' wins`);
    expect(f.message).toContain('never recruited into RAG context');
    expect(f.hint).toContain(`Delete 'topics'`);
  });

  it('stays quiet when only one list is declared', () => {
    expect(lintDeprecatedAliases(agentWith({ sources: ['faq'] }))).toEqual([]);
    expect(lintDeprecatedAliases(agentWith({ topics: ['faq'] }))).toEqual([]);
  });

  it('stays quiet when the two lists have the same members in any order', () => {
    // Order and repetition are not meaningful for either slot, so the same set
    // written twice loses nothing.
    expect(lintDeprecatedAliases(agentWith({
      sources: ['faq', 'policies'],
      topics: ['policies', 'faq', 'faq'],
    }))).toEqual([]);
  });

  it('treats an empty list as undeclared', () => {
    expect(lintDeprecatedAliases(agentWith({ sources: [], topics: ['faq'] }))).toEqual([]);
  });

  it('tolerates an agent with no knowledge block', () => {
    expect(lintDeprecatedAliases({ agents: [{ name: 'support_bot' }] })).toEqual([]);
  });
});

describe('lintDeprecatedAliases — all three rules together', () => {
  it('reports each rule independently in one pass', () => {
    const stack = {
      objects: [{
        name: 'crm_task',
        fields: { due_date: { type: 'date', requiredWhen: 'record.a', conditionalRequired: 'record.b' } },
        actions: [{ name: 'convert', type: 'script', target: 'preferred', execute: 'legacy' }],
      }],
      agents: [{ name: 'support_bot', knowledge: { sources: ['faq'], topics: ['legacy_kb'] } }],
    };

    expect(lintDeprecatedAliases(stack).map((f) => f.rule).sort()).toEqual([
      ACTION_TARGET_EXECUTE_CONFLICT,
      AGENT_KNOWLEDGE_SOURCES_TOPICS_CONFLICT,
      FIELD_REQUIREDWHEN_CONDITIONALREQUIRED_CONFLICT,
    ].sort());
  });

  it('returns nothing for a stack that uses only canonical keys', () => {
    const stack = {
      objects: [{
        name: 'crm_task',
        fields: { due_date: { type: 'date', requiredWhen: 'record.a' } },
        actions: [{ name: 'convert', type: 'script', target: 'preferred' }],
      }],
      agents: [{ name: 'support_bot', knowledge: { sources: ['faq'] } }],
    };
    expect(lintDeprecatedAliases(stack)).toEqual([]);
  });
});
