// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { lintDeprecatedAliases, ACTION_TARGET_EXECUTE_CONFLICT } from './deprecated-aliases';

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
