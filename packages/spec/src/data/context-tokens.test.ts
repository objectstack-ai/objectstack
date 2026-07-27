// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  CONTEXT_TOKENS,
  CONTEXT_TOKEN_DESCRIPTIONS,
  CONTEXT_TOKEN_SUGGESTIONS,
  ContextTokenPlaceholderSchema,
  ContextTokenSchema,
  classifyFilterToken,
  isContextToken,
  isKnownFilterToken,
} from './context-tokens.zod';

describe('context token contract', () => {
  it('every token has a description', () => {
    for (const t of CONTEXT_TOKENS) {
      expect(CONTEXT_TOKEN_DESCRIPTIONS[t]).toBeTypeOf('string');
    }
  });

  it('tokens pass the token schema', () => {
    for (const t of CONTEXT_TOKENS) {
      expect(() => ContextTokenSchema.parse(t)).not.toThrow();
    }
  });

  it('placeholder schema accepts {token} and ${token}', () => {
    expect(() => ContextTokenPlaceholderSchema.parse('{current_user_id}')).not.toThrow();
    expect(() => ContextTokenPlaceholderSchema.parse('${current_org_id}')).not.toThrow();
    expect(() => ContextTokenPlaceholderSchema.parse('current_user_id')).toThrow();
  });

  // The spelling in the #3574 report. It has never resolved anywhere in the
  // platform — `current_user` is the RLS expression root, not a filter token —
  // so the contract must keep rejecting it rather than quietly aliasing it.
  it('rejects {current_user}, the RLS root mistaken for a filter token', () => {
    expect(isContextToken('current_user')).toBe(false);
    expect(isKnownFilterToken('current_user')).toBe(false);
    expect(() => ContextTokenPlaceholderSchema.parse('{current_user}')).toThrow();
  });

  it('rejects near-miss spellings that resolve nowhere', () => {
    for (const bad of ['user_id', 'me', 'current_organization_id', 'foo', 'currentUserId']) {
      expect(isContextToken(bad), bad).toBe(false);
    }
  });
});

describe('isKnownFilterToken — the union of both filter vocabularies', () => {
  it('accepts context tokens and date macros alike', () => {
    expect(isKnownFilterToken('current_user_id')).toBe(true);
    expect(isKnownFilterToken('current_org_id')).toBe(true);
    expect(isKnownFilterToken('today')).toBe(true);
    expect(isKnownFilterToken('30_days_ago')).toBe(true);
    expect(isKnownFilterToken('week_start')).toBe(true);
  });

  it('rejects AppContextSelector ids — nav-only, meaningless in a filter', () => {
    expect(isKnownFilterToken('active_package')).toBe(false);
  });
});

describe('classifyFilterToken', () => {
  it('returns null for values that are not placeholders at all', () => {
    for (const v of ['open', '', 42, null, undefined, { $gte: 1 }, ['a'], 'a{b}c']) {
      expect(classifyFilterToken(v)).toBeNull();
    }
  });

  it('classifies each vocabulary', () => {
    expect(classifyFilterToken('{current_user_id}')).toEqual({
      kind: 'context',
      token: 'current_user_id',
    });
    expect(classifyFilterToken('{today}')).toEqual({ kind: 'date-macro', token: 'today' });
    expect(classifyFilterToken('${30_days_ago}')).toEqual({
      kind: 'date-macro',
      token: '30_days_ago',
    });
  });

  // Each suggestion below is a real authoring mistake: the token is a correct
  // spelling elsewhere in the platform, which is why authors reach for it.
  it('suggests the intended token for known near-misses', () => {
    expect(classifyFilterToken('{current_user}')).toEqual({
      kind: 'unknown',
      token: 'current_user',
      suggestion: 'current_user_id',
    });
    expect(classifyFilterToken('{user_id}')).toEqual({
      kind: 'unknown',
      token: 'user_id',
      suggestion: 'current_user_id',
    });
    expect(classifyFilterToken('{org_id}')).toEqual({
      kind: 'unknown',
      token: 'org_id',
      suggestion: 'current_org_id',
    });
  });

  it('reports unknown tokens with no suggestion when there is no near-miss', () => {
    expect(classifyFilterToken('{totally_made_up}')).toEqual({
      kind: 'unknown',
      token: 'totally_made_up',
      suggestion: undefined,
    });
  });

  it('every suggestion resolves to a real token', () => {
    for (const [from, to] of Object.entries(CONTEXT_TOKEN_SUGGESTIONS)) {
      expect(isContextToken(to), `${from} → ${to}`).toBe(true);
      // A suggestion key must itself be invalid, or the mapping is incoherent.
      expect(isKnownFilterToken(from), from).toBe(false);
    }
  });
});
