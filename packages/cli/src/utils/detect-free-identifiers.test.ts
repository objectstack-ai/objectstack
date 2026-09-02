// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  detectFreeIdentifiers,
  NODE_ONLY_GLOBALS,
  SANDBOX_GLOBALS,
} from './detect-free-identifiers.js';

/** Helper: stringify a real function so we test the exact `.toString()` path. */
const src = (fn: (...a: any[]) => any) => String(fn);

describe('detectFreeIdentifiers (#1876 — body self-containment)', () => {
  describe('flags module-scope references (would ReferenceError at runtime)', () => {
    it('a helper call (arrow)', () => {
      const r = detectFreeIdentifiers('(ctx) => { ctx.record.slug = slugify(ctx.record.name); }');
      expect(r.unparsed).toBe(false);
      expect(r.free).toEqual(['slugify']);
    });

    it('a top-level const (function expression)', () => {
      const r = detectFreeIdentifiers('function h(ctx){ return TAX_RATE * ctx.amount; }');
      expect(r.free).toEqual(['TAX_RATE']);
    });

    it('object-method shorthand form', () => {
      const r = detectFreeIdentifiers('handler(ctx){ return fmt(ctx.x); }');
      expect(r.free).toEqual(['fmt']);
    });

    it('an implicit-return arrow', () => {
      const r = detectFreeIdentifiers('(ctx) => compute(ctx.a, ctx.b)');
      expect(r.free).toEqual(['compute']);
    });

    it('multiple distinct free names, sorted & de-duped', () => {
      const r = detectFreeIdentifiers('(ctx) => { a(ctx); b(ctx); a(ctx); return CONST; }');
      expect(r.free).toEqual(['CONST', 'a', 'b']);
    });
  });

  describe('does NOT flag self-contained handlers (false-positive guards)', () => {
    const selfContained: Array<[string, string]> = [
      ['member access only', '(ctx) => { ctx.record.slug = ctx.record.name.toLowerCase(); }'],
      ['local const', '(ctx) => { const s = ctx.record.name; return s.trim(); }'],
      ['globals (Math/JSON)', '(ctx) => { ctx.record.id = Math.round(JSON.parse(ctx.x).y); }'],
      ['destructured params', '({ record, api }) => { record.x = record.y; return api; }'],
      ['locally-declared helper', '(ctx) => { const f = (a) => a * 2; return f(ctx.n); }'],
      ['object shorthand of a local', '(ctx) => { const a = ctx.a; return { a }; }'],
      ['object literal keys', '(ctx) => ({ total: ctx.a, count: ctx.b })'],
      ['for-of loop binding', '(ctx) => { let sum = 0; for (const x of ctx.items) { sum += x; } ctx.sum = sum; }'],
      ['catch binding', '(ctx) => { try { ctx.run(); } catch (err) { ctx.log = err; } }'],
      ['param default uses global', '({ x = Math.PI }) => x'],
      ['returned object method closes over param', '(ctx) => ({ run() { return ctx.x; } })'],
      ['element access with local key', '(ctx) => { const k = ctx.key; return ctx.data[k]; }'],
      ['named function expression recursion', 'function fact(n){ return n <= 1 ? 1 : n * fact(n - 1); }'],
      ['nested destructuring', '({ a: { b } }) => b + 1'],
      ['rest params', '(...args) => args.length'],
      ['typeof a local', '(ctx) => { const v = ctx.v; return typeof v; }'],
      // #14301 — the node-only refusal is a SCOPE analysis, not a token scan.
      // A locally-bound name that happens to spell a host global is bound, and
      // a member NAMED after one is not a reference at all. Both would be
      // false refusals, and a false refusal here costs an author a body they
      // were entitled to.
      ['a local shadowing a host global', '(ctx) => { const Intl = ctx.fmt; return Intl.format(ctx.d); }'],
      ['a member named after a host global', '(ctx) => { return ctx.Intl.format(ctx.d); }'],
      ['a param named after a host global', '(ctx, Intl) => Intl.format(ctx.d)'],
    ];
    for (const [label, source] of selfContained) {
      it(label, () => {
        const r = detectFreeIdentifiers(source);
        expect(r.unparsed).toBe(false);
        expect(r.free).toEqual([]);
      });
    }
  });

  describe('real compiled `.toString()` shapes', () => {
    it('does not flag a self-contained closure', () => {
      const handler = (ctx: any) => {
        const name = String(ctx.record.name ?? '').trim();
        ctx.record.slug = name.toLowerCase().replace(/\s+/g, '-');
      };
      expect(detectFreeIdentifiers(src(handler)).free).toEqual([]);
    });
  });

  it('never invents free vars for non-handler junk (conservative — caller won\'t block)', () => {
    // Whether or not TS error-recovers a node, the safe outcome is no free vars
    // so extraction is never blocked on garbage. (peelToBlockBody rejects such
    // input earlier in the real path anyway.)
    expect(detectFreeIdentifiers('this is not a function').free).toEqual([]);
    expect(detectFreeIdentifiers('').free).toEqual([]);
    expect(detectFreeIdentifiers('{ not: valid').free).toEqual([]);
  });
  // ── #14301 — globals the NODE HOST has and the sandbox does not ──────────
  //
  // The reported shape: `Intl` sat in one generous allowlist beside `JSON`, so
  // a handler calling `Intl.DateTimeFormat` had no free identifier, lowered
  // into `body.source`, and threw `ReferenceError` in production while every
  // local gate was green. The split makes the reference visible again; the
  // membership of the two sets is not asserted here from knowledge — it is
  // measured inside the real sandbox by `sandbox-globals-probe.test.ts`.
  describe('reports host globals the sandbox does not provide', () => {
    it('the card reproduction — Intl.DateTimeFormat', () => {
      const r = detectFreeIdentifiers(
        "(ctx) => { const f = new Intl.DateTimeFormat('en-US'); ctx.input.label = f.format(new Date(ctx.input.at)); }",
      );
      expect(r.unparsed).toBe(false);
      expect(r.free).toEqual(['Intl']);
      expect(r.nodeOnly).toEqual(['Intl']);
    });

    it('`nodeOnly` is a labelled SUBSET of `free`, not a second list', () => {
      // Both halves at once. The caller needs them apart because the remedies
      // are opposite — inline the helper, but a host global cannot be inlined
      // — and needs them together because the refusal names every name.
      const r = detectFreeIdentifiers('(ctx) => { ctx.x = slugify(ctx.name) + Intl.NumberFormat; }');
      expect(r.free).toEqual(['Intl', 'slugify']);
      expect(r.nodeOnly).toEqual(['Intl']);
      expect(r.nodeOnly.every((n) => r.free.includes(n))).toBe(true);
    });

    it('a sandbox-provided global is still waived — the positive control', () => {
      const r = detectFreeIdentifiers('(ctx) => { ctx.x = JSON.stringify(Math.round(ctx.n)); }');
      expect(r.free).toEqual([]);
      expect(r.nodeOnly).toEqual([]);
    });

    it('every member of NODE_ONLY_GLOBALS is reported when referenced free', () => {
      // Set-wide rather than per-name: a member added to the set without the
      // detector reading it would otherwise sit inert, which is the exact
      // shape of the defect being closed one level up.
      for (const name of NODE_ONLY_GLOBALS) {
        const r = detectFreeIdentifiers(`(ctx) => { ctx.x = ${name}; }`);
        expect({ name, free: r.free, nodeOnly: r.nodeOnly }).toEqual({
          name,
          free: [name],
          nodeOnly: [name],
        });
      }
    });

    it('every member of SANDBOX_GLOBALS is waived when referenced free', () => {
      for (const name of SANDBOX_GLOBALS) {
        const r = detectFreeIdentifiers(`(ctx) => { ctx.x = ${name}; }`);
        expect({ name, free: r.free, nodeOnly: r.nodeOnly }).toEqual({
          name,
          free: [],
          nodeOnly: [],
        });
      }
    });

    it('junk input reports neither list (conservative — never blocks extraction)', () => {
      // The bias the file's header states, restated over the NEW field: a
      // source this analysis cannot make sense of must not produce a refusal.
      // Asserted over the same three junk shapes the #1876 case uses, and
      // without asserting `unparsed` — TS error-recovery decides that, and the
      // invariant that matters is that neither list fills.
      for (const junk of ['this is not a function', '', '{ not: valid']) {
        const r = detectFreeIdentifiers(junk);
        expect({ junk, free: r.free, nodeOnly: r.nodeOnly }).toEqual({
          junk,
          free: [],
          nodeOnly: [],
        });
      }
    });
  });
});
