// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { evaluateVisibility, referencedKeys, VisibilityParseError } from './visibility-eval.js';

describe('evaluateVisibility', () => {
  it('handles every expression shape used by the bundled manifests', () => {
    expect(evaluateVisibility("${data.provider === 'cloudflare'}", { provider: 'cloudflare' })).toBe(true);
    expect(evaluateVisibility("${data.provider === 'cloudflare'}", { provider: 'openai' })).toBe(false);
    expect(evaluateVisibility("${data.provider !== 'memory'}", { provider: 'memory' })).toBe(false);
    expect(evaluateVisibility("${data.embedder_provider && data.embedder_provider !== 'none'}", { embedder_provider: 'openai' })).toBe(true);
    expect(evaluateVisibility("${data.embedder_provider && data.embedder_provider !== 'none'}", { embedder_provider: 'none' })).toBe(false);
    expect(evaluateVisibility("${data.embedder_provider && data.embedder_provider !== 'none'}", {})).toBe(false);
    expect(evaluateVisibility("${data.embedder_provider === 'custom' || data.embedder_provider === 'azure'}", { embedder_provider: 'azure' })).toBe(true);
    expect(evaluateVisibility("${data.provider !== 'memory' && data.title_generation_enabled !== false}", { provider: 'openai' })).toBe(true);
    expect(evaluateVisibility("${data.google_enabled !== false}", { google_enabled: false })).toBe(false);
  });

  it('supports negation, parentheses, and envelope form', () => {
    expect(evaluateVisibility('${!data.flag}', { flag: false })).toBe(true);
    expect(evaluateVisibility("${(data.a === '1' || data.b === '2') && data.c !== '3'}", { a: '1', c: 'x' })).toBe(true);
    expect(evaluateVisibility({ dialect: 'template', source: "${data.provider === 'smtp'}" }, { provider: 'smtp' })).toBe(true);
  });

  it('treats missing expressions as visible', () => {
    expect(evaluateVisibility(undefined, {})).toBe(true);
  });

  it('throws VisibilityParseError outside the grammar', () => {
    expect(() => evaluateVisibility('${data.x.map(y => y)}', {})).toThrow(VisibilityParseError);
    expect(() => evaluateVisibility('${window.location}', {})).toThrow(VisibilityParseError);
    expect(() => evaluateVisibility("${data.a === 'unterminated}", {})).toThrow(VisibilityParseError);
  });

  /**
   * #7169 — `>` / `>=` / `<` / `<=`. Not a speculative widening: the auth
   * manifest already ships `visible: '${data.lockout_threshold > 0}'`, the
   * console renders it (its client-side evaluator is a `new Function`), and
   * this grammar refused it — which, before this issue's fail-closed change,
   * silently switched off `lockout_duration_minutes`' declared `min: 1,
   * max: 1440`. The `settings-service` suite pins that end of it; this pins the
   * grammar, including that the semantics match the console's JS.
   */
  describe('relational operators (#7169)', () => {
    it('evaluates the manifest predicate that used to be unparseable', () => {
      expect(evaluateVisibility('${data.lockout_threshold > 0}', { lockout_threshold: 5 })).toBe(true);
      expect(evaluateVisibility('${data.lockout_threshold > 0}', { lockout_threshold: 0 })).toBe(false);
    });

    it('covers all four, and tokenizes >= / <= ahead of > / <', () => {
      expect(evaluateVisibility('${data.n >= 3}', { n: 3 })).toBe(true);
      expect(evaluateVisibility('${data.n > 3}', { n: 3 })).toBe(false);
      expect(evaluateVisibility('${data.n <= 3}', { n: 3 })).toBe(true);
      expect(evaluateVisibility('${data.n < 3}', { n: 3 })).toBe(false);
    });

    it('composes with the rest of the grammar', () => {
      expect(evaluateVisibility("${data.n > 0 && data.mode === 'on'}", { n: 1, mode: 'on' })).toBe(true);
      expect(evaluateVisibility("${data.n > 0 && data.mode === 'on'}", { n: 0, mode: 'on' })).toBe(false);
      expect(evaluateVisibility('${!(data.n >= 10)}', { n: 2 })).toBe(true);
    });

    it('matches the console evaluator on an absent key rather than inventing a verdict', () => {
      // `new Function('data', 'with (data) { return (data.n > 0); }')({})` is
      // `false` — `undefined > 0` is `false` in JS, and so is `undefined < 0`.
      // The two evaluators disagreeing about a predicate IS the #7169 bug class,
      // so this is pinned rather than left to read as an accident.
      expect(evaluateVisibility('${data.n > 0}', {})).toBe(false);
      expect(evaluateVisibility('${data.n < 0}', {})).toBe(false);
      expect(evaluateVisibility('${data.n >= 0}', {})).toBe(false);
    });

    it('carries the parse reason separately from the composed sentence', () => {
      // `VisibilityParseError.detail` exists so a caller refusing a save can
      // embed the reason in its own message (#7169) instead of nesting ours.
      const err = (() => {
        try { evaluateVisibility("${data.provider in ['openai']}", {}); return null; }
        catch (e) { return e as VisibilityParseError; }
      })();
      expect(err).toBeInstanceOf(VisibilityParseError);
      expect(err!.source).toBe("data.provider in ['openai']");
      expect(err!.detail).toBe('unsupported identifier "in"');
      expect(err!.message).toContain(err!.detail);
    });
  });
});

describe('referencedKeys', () => {
  it('lists the data.* keys an expression depends on', () => {
    expect(referencedKeys("${data.provider === 'cloudflare'}")).toEqual(['provider']);
    expect(referencedKeys("${data.a === '1' || data.b === '2'}")).toEqual(['a', 'b']);
    expect(referencedKeys(undefined)).toEqual([]);
  });
});
