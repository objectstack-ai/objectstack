// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7127 — the `defaultValue` shape discriminator: literal vs runtime token vs
 * Expression envelope, plus the shared literal-vs-value-contract check.
 *
 * The discrimination cases pin ENGINE PARITY: every verdict here is the one
 * `ObjectQL.applyFieldDefaults` reaches for the same value (envelope by the
 * same structural predicate, tokens by the same spec predicates, everything
 * else the literal branch). A case that drifts from the engine is wrong HERE,
 * not there — update the module only together with the resolver.
 */

import { describe, it, expect } from 'vitest';

import {
  checkLiteralDefaultValue,
  discriminateDefaultValueShape,
  isExpressionEnvelopeDefault,
  type DefaultValueShape,
} from './default-value-shape';

describe('#7127 discriminateDefaultValueShape — engine-parity classification', () => {
  const CASES: Array<{ label: string; dv: unknown; shape: DefaultValueShape }> = [
    // ── Expression envelopes: the engine's structural predicate, verbatim ────
    { label: 'canonical CEL envelope', dv: { dialect: 'cel', source: 'today()' }, shape: 'expression' },
    {
      label: 'unknown dialect is STILL an envelope (evaluation failing is a runtime concern)',
      dv: { dialect: 'made_up', source: 'x' },
      shape: 'expression',
    },
    {
      label: 'truthy non-string dialect counts (the engine tests truthiness, nothing more)',
      dv: { dialect: 1, source: 'x' },
      shape: 'expression',
    },
    {
      label: 'missing `source` is NOT an envelope — the engine stores it verbatim',
      dv: { dialect: 'cel' },
      shape: 'literal',
    },
    { label: 'missing `dialect` is NOT an envelope', dv: { source: 'today()' }, shape: 'literal' },
    { label: 'falsy dialect is NOT an envelope', dv: { dialect: '', source: 'x' }, shape: 'literal' },
    { label: 'non-string source is NOT an envelope', dv: { dialect: 'cel', source: 7 }, shape: 'literal' },

    // ── Runtime tokens: the spec predicates, spelling for spelling ───────────
    { label: 'NOW() exact', dv: 'NOW()', shape: 'token' },
    { label: 'NOW() is case-insensitive (now())', dv: 'now()', shape: 'token' },
    { label: 'NOW() is whitespace-tolerant ( NOW() )', dv: ' NOW() ', shape: 'token' },
    { label: 'current_user exact', dv: 'current_user', shape: 'token' },

    // ── Near-misses are LITERALS — never silently widened into tokens ────────
    { label: 'CURRENT_USER (wrong case) is a literal', dv: 'CURRENT_USER', shape: 'literal' },
    { label: 'currentUser (camelCase) is a literal', dv: 'currentUser', shape: 'literal' },
    { label: '{current_user} (filter-vocabulary braces) is a literal', dv: '{current_user}', shape: 'literal' },
    { label: 'NOW (no parens) is a literal', dv: 'NOW', shape: 'literal' },

    // ── Ordinary literals ────────────────────────────────────────────────────
    { label: 'string literal', dv: 'open', shape: 'literal' },
    { label: 'number literal', dv: 0, shape: 'literal' },
    { label: 'boolean literal', dv: false, shape: 'literal' },
    { label: 'array literal', dv: ['a'], shape: 'literal' },
    { label: 'plain object literal', dv: { a: 1 }, shape: 'literal' },
  ];

  for (const { label, dv, shape } of CASES) {
    it(`${shape}: ${label}`, () => {
      expect(discriminateDefaultValueShape(dv)).toBe(shape);
    });
  }

  it('absence is the CALLER\'s question — null/undefined fall out as literal here', () => {
    // Consumers apply their own presence predicate BEFORE discriminating (the
    // engine and the action-param dispatcher disagree about `''`, and both are
    // right for their surface). Handing absence in anyway must not crash.
    expect(discriminateDefaultValueShape(null)).toBe('literal');
    expect(discriminateDefaultValueShape(undefined)).toBe('literal');
  });

  it('isExpressionEnvelopeDefault is the exported predicate the classification runs on', () => {
    expect(isExpressionEnvelopeDefault({ dialect: 'cel', source: 'today()' })).toBe(true);
    expect(isExpressionEnvelopeDefault({ dialect: 'cel' })).toBe(false);
    expect(isExpressionEnvelopeDefault('NOW()')).toBe(false);
    expect(isExpressionEnvelopeDefault(null)).toBe(false);
  });
});

describe('#7127 checkLiteralDefaultValue — the shared stored-form literal check', () => {
  it('refuses a literal that cannot satisfy the stored contract, with the contract\'s own detail', () => {
    const v = checkLiteralDefaultValue({ type: 'number' }, 'abc');
    expect(v.ok).toBe(false);
    expect(v.detail).toBeTruthy();

    const wallClock = checkLiteralDefaultValue({ type: 'datetime' }, '2026-08-10T15:00');
    expect(wallClock.ok).toBe(false);
    // The detail is the value contract's message VERBATIM — the same words the
    // #6970 action-param gate and the submit-time dispatcher carry.
    expect(wallClock.detail).toContain('ISO-8601 instant');
  });

  it('accepts a literal the stored contract accepts', () => {
    expect(checkLiteralDefaultValue({ type: 'number' }, 7).ok).toBe(true);
    expect(checkLiteralDefaultValue({ type: 'boolean' }, false).ok).toBe(true);
    expect(checkLiteralDefaultValue({ type: 'date' }, '2026-08-10').ok).toBe(true);
  });

  it('judges option membership from the def, exactly as valueSchemaFor does', () => {
    const def = { type: 'select', options: [{ value: 'gold' }, { value: 'silver' }] };
    expect(checkLiteralDefaultValue(def, 'gold').ok).toBe(true);
    expect(checkLiteralDefaultValue(def, 'platinum').ok).toBe(false);
  });

  it('judges arity from the def (`multiple: true` stores an array)', () => {
    expect(checkLiteralDefaultValue({ type: 'user', multiple: true }, 'usr_1').ok).toBe(false);
    expect(checkLiteralDefaultValue({ type: 'user', multiple: true }, ['usr_1']).ok).toBe(true);
  });

  it('stays open where the contract is deliberately open (json)', () => {
    expect(checkLiteralDefaultValue({ type: 'json' }, { anything: ['at', 'all'] }).ok).toBe(true);
  });
});
