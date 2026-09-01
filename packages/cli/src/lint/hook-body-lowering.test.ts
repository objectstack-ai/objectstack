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
  UNPARSEABLE_BODY_RULE,
  EXTRACTION_FAILED_RULE,
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

// `unparseable`: `String(fn)` yields something `peelToBlockBody` cannot peel —
// an instrument LIMIT, not anything the author chose.
const unparseableHook = (() => {
  const fn = (ctx: any) => {
    ctx.input.x = 1;
  };
  Object.defineProperty(fn, 'toString', { value: () => '???' });
  return { name: 'opaque', object: 'o', events: ['beforeInsert'], handler: fn };
})();

// `unknown`: the extractor itself throws a bare Error (not a
// `HookBodyExtractionError`) — an instrument FAILURE. Same fixture shape the
// build-side pin in `hook-body-refusal-kind.test.ts` uses.
const explodingHook = (() => {
  const fn = () => undefined;
  Object.defineProperty(fn, 'toString', {
    value: () => {
      throw new Error('cannot stringify');
    },
  });
  return { name: 'exploding', object: 'o', events: ['beforeInsert'], handler: fn };
})();

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

  describe('an instrument failure is NOT an author verdict', () => {
    // The whole PR exists because a silent downgrade was misattributed. Telling
    // an author "you chose a bundled closure" when in fact the TOOL failed is
    // the same wrong verdict wearing the fix's clothes — so `unparseable` and
    // `unknown` must never land in the `bundled-fallback` arm, whose prose
    // asserts "the body uses something the sandbox cannot provide".

    it('reports an unparseable body under its own rule, naming the instrument', () => {
      const issues = checkHookBodyLowering({ hooks: [{ ...unparseableHook }] });

      expect(issues).toHaveLength(1);
      expect(issues[0].rule).toBe(UNPARSEABLE_BODY_RULE);
      // Never fatal: an instrument limit must not move the exit contract.
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].message).toContain('not a verdict about the handler');
      // And never the author-verdict prose of the deliberate-bundle arm.
      expect(issues[0].rule).not.toBe(BUNDLED_FALLBACK_RULE);
      expect(issues[0].message).not.toContain('the body uses something the sandbox cannot provide');
    });

    it('reports an extractor throw (kind `unknown`) under its own rule, not as a chosen bundle', () => {
      const issues = checkHookBodyLowering({ hooks: [{ ...explodingHook }] });

      expect(issues).toHaveLength(1);
      expect(issues[0].rule).toBe(EXTRACTION_FAILED_RULE);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].message).toContain('the extraction instrument itself failed');
      expect(issues[0].message).toContain('not a verdict about the handler');
      expect(issues[0].rule).not.toBe(BUNDLED_FALLBACK_RULE);
      expect(issues[0].message).not.toContain('the body uses something the sandbox cannot provide');
    });

    it('keeps the two instrument kinds distinct from each other, not just from the verdict arms', () => {
      // `unknown` is deliberately not folded into `unparseable` (#13651): a
      // broken instrument and a limited instrument are different events.
      const [unparseable] = checkHookBodyLowering({ hooks: [{ ...unparseableHook }] });
      const [unknown] = checkHookBodyLowering({ hooks: [{ ...explodingHook }] });
      expect(unparseable.rule).not.toBe(unknown.rule);
    });
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
        unparseableHook,
        explodingHook,
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
    // Total over all four kinds on purpose: a kind with no row here is a kind
    // whose divergent labeling this pin could never catch — which is exactly
    // how the `unknown`-folded-into-"designed fallback" defect survived to
    // review the first time.
    const kindOfRule: Record<string, string> = {
      [NOT_LOWERABLE_RULE]: 'free-identifiers',
      [BUNDLED_FALLBACK_RULE]: 'forbidden-token',
      [UNPARSEABLE_BODY_RULE]: 'unparseable',
      [EXTRACTION_FAILED_RULE]: 'unknown',
    };
    const lintSaw = checkHookBodyLowering(structuredClone_(config))
      .map((i) => {
        const origin = /^((?:hook|action) '[^']+')/.exec(i.message)?.[1];
        return `${origin}|${kindOfRule[i.rule]}`;
      })
      .sort();

    expect(lintSaw).toEqual(buildSaw);
    // And the population is the real one, not an empty set agreeing with itself
    // — all four kinds present, the two instrument kinds included.
    expect(buildSaw).toEqual([
      "action 'case_escalate'|free-identifiers",
      "hook 'case_sla'|free-identifiers",
      "hook 'enrich_lead'|forbidden-token",
      "hook 'exploding'|unknown",
      "hook 'opaque'|unparseable",
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
