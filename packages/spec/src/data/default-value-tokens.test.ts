// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VALUE_TOKENS,
  DEFAULT_VALUE_TOKEN_NOW,
  DEFAULT_VALUE_TOKEN_CURRENT_USER,
  DEFAULT_VALUE_TOKEN_DESCRIPTIONS,
  isNowDefaultToken,
  isCurrentUserDefaultToken,
  isRuntimeDefaultToken,
  isAppResolvedDefaultToken,
} from './default-value-tokens.js';

describe('defaultValue runtime tokens (#4560)', () => {
  it('declares the complete family, and every member is described', () => {
    expect([...DEFAULT_VALUE_TOKENS]).toEqual(['NOW()', 'current_user']);
    for (const token of DEFAULT_VALUE_TOKENS) {
      expect(DEFAULT_VALUE_TOKEN_DESCRIPTIONS[token]).toBeTruthy();
    }
  });

  it("recognises 'NOW()' case-insensitively and whitespace-tolerantly (the driver's long-standing rule)", () => {
    for (const v of ['NOW()', 'now()', 'Now()', '  NOW()  ']) {
      expect(isNowDefaultToken(v)).toBe(true);
      expect(isRuntimeDefaultToken(v)).toBe(true);
    }
    expect(isNowDefaultToken('NOW')).toBe(false);
    expect(isNowDefaultToken('now(1)')).toBe(false);
  });

  it("matches 'current_user' EXACTLY, mirroring applyFieldDefaults", () => {
    expect(isCurrentUserDefaultToken(DEFAULT_VALUE_TOKEN_CURRENT_USER)).toBe(true);
    // Near-miss spellings are authoring errors, not tokens — widening the match
    // here would make a genuinely-intended literal unstorable.
    for (const v of ['CURRENT_USER', '{current_user}', 'current_user_id', 'currentUser', ' current_user ']) {
      expect(isCurrentUserDefaultToken(v)).toBe(false);
    }
  });

  it('classifies every token as runtime, and splits them by who resolves them', () => {
    for (const token of DEFAULT_VALUE_TOKENS) expect(isRuntimeDefaultToken(token)).toBe(true);
    // `NOW()` has a database counterpart, so it is NOT app-resolved: a driver
    // translates it into a native column DEFAULT.
    expect(isAppResolvedDefaultToken(DEFAULT_VALUE_TOKEN_NOW)).toBe(false);
    // `current_user` has none — the column must carry no DEFAULT at all.
    expect(isAppResolvedDefaultToken(DEFAULT_VALUE_TOKEN_CURRENT_USER)).toBe(true);
  });

  it('treats ordinary literals and non-strings as values, never as instructions', () => {
    for (const v of ['open', '', 0, 1, false, true, null, undefined, {}, [], { dialect: 'cel', source: 'today()' }]) {
      expect(isRuntimeDefaultToken(v)).toBe(false);
      expect(isAppResolvedDefaultToken(v)).toBe(false);
    }
  });
});
