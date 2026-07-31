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
});

describe('referencedKeys', () => {
  it('lists the data.* keys an expression depends on', () => {
    expect(referencedKeys("${data.provider === 'cloudflare'}")).toEqual(['provider']);
    expect(referencedKeys("${data.a === '1' || data.b === '2'}")).toEqual(['a', 'b']);
    expect(referencedKeys(undefined)).toEqual([]);
  });
});
