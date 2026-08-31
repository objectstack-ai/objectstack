// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13651 — the silent downgrade becomes a lint verdict.
 *
 * The pins here are about the DISTINCTION, not just the noise: an accidental
 * scope leak must be an `error` (so a gate can fail on it) while the structural
 * refusal must stay a `warning` (so the legitimate fallback-to-bundling path is
 * not punished). A test that only asserted "something was reported" would pass
 * on the change this card explicitly forbids — deleting the catch.
 */

import { describe, it, expect } from 'vitest';
import {
  checkHookBodyLowering,
  NOT_LOWERABLE_RULE,
  BUNDLED_FALLBACK_RULE,
} from './hook-body-lowering.js';
import { lowerCallables } from '../utils/lower-callables.js';

// Module scope — exactly what a lowered body cannot reach.
const SLA_MATRIX: Record<string, number> = { high: 4, low: 48 };

const freeIdentifierHook = {
  name: 'case_sla',
  object: 'case',
  events: ['beforeInsert'],
  handler: (ctx: any) => {
    ctx.input.sla_hours = SLA_MATRIX[ctx.input.priority];
  },
};

const forbiddenTokenHook = {
  name: 'enrich_lead',
  object: 'lead',
  events: ['beforeInsert'],
  handler: async (ctx: any) => {
    const res = await fetch('https://example.invalid/enrich');
    ctx.input.score = res.status;
  },
};

const selfContainedHook = {
  name: 'normalize_name',
  object: 'account',
  events: ['beforeInsert'],
  handler: (ctx: any) => {
    ctx.input.name = String(ctx.input.name).trim();
  },
};

describe('checkHookBodyLowering', () => {
  it('reports an accidental scope leak as an ERROR a gate can fail on', () => {
    const issues = checkHookBodyLowering({ hooks: [freeIdentifierHook] });

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].rule).toBe(NOT_LOWERABLE_RULE);
    expect(issues[0].path).toBe('hooks[0].handler');
    // Names the callable and the identifier that caused it — the diagnostic
    // `extractHookBody` had already computed and the build dropped into a log.
    expect(issues[0].message).toContain("hook 'case_sla'");
    expect(issues[0].message).toContain('SLA_MATRIX');
    // Says what actually changed. "no behavior change" is true of behaviour and
    // false of deployment shape, which is the whole defect.
    expect(issues[0].message).toContain('deployment shape');
  });

  it('keeps the STRUCTURAL refusal a warning — the bundle is its designed answer', () => {
    const issues = checkHookBodyLowering({ hooks: [forbiddenTokenHook] });

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].rule).toBe(BUNDLED_FALLBACK_RULE);
    expect(issues[0].message).toContain("hook 'enrich_lead'");
    // Reported, but never fatal: `os lint` exits 1 on `error` only, so a
    // legitimate `fetch()` handler still lints clean-enough to ship.
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
  });

  it('says nothing about a handler that really does ship as metadata', () => {
    expect(checkHookBodyLowering({ hooks: [selfContainedHook] })).toEqual([]);
  });

  it('truncates the multi-line offending-source dump to one line', () => {
    const [issue] = checkHookBodyLowering({ hooks: [forbiddenTokenHook] });
    expect(issue.message).not.toContain('--- offending body source ---');
    expect(issue.message.split('\n')).toHaveLength(1);
  });

  describe('the two ways an author declares "bundle this deliberately"', () => {
    it('says nothing about a string handler (already a bundle reference)', () => {
      const issues = checkHookBodyLowering({
        hooks: [{ name: 'h', object: 'o', events: ['beforeInsert'], handler: 'some_bundled_fn' }],
      });
      expect(issues).toEqual([]);
    });

    it('says nothing when the author supplied an explicit `body`', () => {
      // `lowerCallables` only extracts `if (!hook.body)`; this rule mirrors that
      // skip, so the opt-out is the same one the build already honours.
      const issues = checkHookBodyLowering({
        hooks: [{ ...freeIdentifierHook, body: { language: 'js', source: 'return 1;' } }],
      });
      expect(issues).toEqual([]);
    });

    it('never judges a top-level `functions:` entry — that path is never lowered', () => {
      const issues = checkHookBodyLowering({
        functions: { my_fn: (ctx: any) => ctx.input.x = SLA_MATRIX.high },
      });
      expect(issues).toEqual([]);
    });
  });

  describe('actions', () => {
    it('judges an object action `target` and names its path', () => {
      const issues = checkHookBodyLowering({
        objects: [
          {
            name: 'case',
            actions: [
              { name: 'escalate', target: (ctx: any) => { ctx.out = SLA_MATRIX.high; } },
            ],
          },
        ],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].path).toBe('objects[0].actions[0].target');
      expect(issues[0].message).toContain("action 'case_escalate'");
    });

    it('judges a top-level action `target`', () => {
      const issues = checkHookBodyLowering({
        actions: [{ name: 'sweep', target: (ctx: any) => { ctx.out = SLA_MATRIX.low; } }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toBe('actions[0].target');
      expect(issues[0].message).toContain("action 'global_sweep'");
    });
  });

  /**
   * The #3782 class: two surfaces disagreeing about what an author is told.
   * This rule and the build both call `extractHookBody` on the same normalized
   * input, so the agreement is by construction — this pins that it stays so,
   * and would fail the moment someone re-implements the analysis here.
   */
  it('judges exactly the callables the build records as extraction warnings', () => {
    const config = {
      hooks: [
        freeIdentifierHook,
        forbiddenTokenHook,
        selfContainedHook,
        { name: 'string_ref', object: 'o', events: ['beforeInsert'], handler: 'bundled' },
        { ...selfContainedHook, name: 'with_body', body: { language: 'js', source: 'return 1;' } },
      ],
      objects: [
        {
          name: 'case',
          actions: [{ name: 'escalate', target: (ctx: any) => { ctx.out = SLA_MATRIX.high; } }],
        },
      ],
    };

    // What the BUILD records (and then bundles anyway, at exit 0).
    const lowering = lowerCallables(structuredClone_(config));
    const buildSaw = lowering.bodyExtractionWarnings
      .map((w) => `${w.origin}|${w.kind}`)
      .sort();

    // What LINT reports, mapped back through the rule -> kind correspondence.
    const kindOfRule: Record<string, string> = {
      [NOT_LOWERABLE_RULE]: 'free-identifiers',
      [BUNDLED_FALLBACK_RULE]: 'forbidden-token',
    };
    const lintSaw = checkHookBodyLowering(structuredClone_(config))
      .map((i) => {
        const origin = /^((?:hook|action) '[^']+')/.exec(i.message)?.[1];
        return `${origin}|${kindOfRule[i.rule]}`;
      })
      .sort();

    expect(lintSaw).toEqual(buildSaw);
    // And the population is the real one, not an empty set agreeing with itself.
    expect(buildSaw).toEqual([
      "action 'case_escalate'|free-identifiers",
      "hook 'case_sla'|free-identifiers",
      "hook 'enrich_lead'|forbidden-token",
    ]);
  });
});

/**
 * `structuredClone` cannot carry functions, and `lowerCallables` mutates only
 * shallow clones of what it is handed — so the two passes above must each get a
 * fresh object graph without losing the callables. A shallow-enough hand clone
 * is exactly that.
 */
function structuredClone_<T extends Record<string, any>>(v: T): T {
  return {
    ...v,
    ...(Array.isArray(v.hooks) ? { hooks: v.hooks.map((h: any) => ({ ...h })) } : {}),
    ...(Array.isArray(v.objects)
      ? {
          objects: v.objects.map((o: any) => ({
            ...o,
            ...(Array.isArray(o.actions) ? { actions: o.actions.map((a: any) => ({ ...a })) } : {}),
          })),
        }
      : {}),
    ...(Array.isArray(v.actions) ? { actions: v.actions.map((a: any) => ({ ...a })) } : {}),
  };
}
