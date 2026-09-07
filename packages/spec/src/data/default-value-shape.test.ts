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

  // ── #16077: `detail` is the ACTIONABLE issue, not `issues[0]` ─────────────
  //
  // zod sorts per-member issues ahead of the object-level `unrecognized_keys`
  // one, so a positional read handed an author who RENAMED a key a
  // missing-member type error about a member they never wrote — and which of
  // the two they got depended on whether some unrelated member happened to
  // also be wrong. Each case below asserts BOTH halves: the prescription is
  // present, AND the half that was being shown instead is gone. Without the
  // second the pin cannot see a regression back to the positional read.
  it('#16077 prefers the rename over a MISSING-member type error (location)', () => {
    const v = checkLiteralDefaultValue({ type: 'location' }, { latitude: 1, longitude: 2 });
    expect(v.ok).toBe(false);
    // Positionally this rejection reads
    // `[invalid_type(lat), invalid_type(lng), unrecognized_keys]`.
    expect(v.detail).toContain('`latitude` \u2192 `lat`');
    expect(v.detail).toContain('`longitude` \u2192 `lng`');
    expect(v.detail).not.toContain('expected number, received undefined');
    // Edit distance cannot reach `latitude` -> `lat`; the curated `aliases`
    // map is the only thing that can, which is why discarding it cost the
    // author the whole prescription.
  });

  it('#16077 prefers the rename over a WRONG-TYPED-member error (address)', () => {
    const v = checkLiteralDefaultValue({ type: 'address' }, { street: 5, postal_code: '98101' });
    expect(v.ok).toBe(false);
    // Every member of `address` is optional, which rules out a MISSING-member
    // error but says nothing about a wrong-typed declared one — it sorts ahead
    // just the same. This is the case that made the defect look location-only.
    expect(v.detail).toContain('`postal_code` \u2192 `postalCode`');
    expect(v.detail).not.toContain('expected string, received number');
  });

  it('#16077 leaves the already-correct case exactly as it was (the asymmetry is gone)', () => {
    // No member error to sort ahead, so this one was always right. Pinning it
    // beside the two above is what states the property: the diagnosis no
    // longer depends on whether an unrelated member happened to also be wrong.
    const lucky = checkLiteralDefaultValue({ type: 'address' }, { postal_code: '98101' });
    const unlucky = checkLiteralDefaultValue({ type: 'address' }, { street: 5, postal_code: '98101' });
    expect(lucky.ok).toBe(false);
    expect(lucky.detail).toContain('`postal_code` \u2192 `postalCode`');
    expect(unlucky.detail).toContain('`postal_code` \u2192 `postalCode`');
  });

  it('#16077 is a NO-OP for a class that cannot emit `unrecognized_keys`', () => {
    // The sweep over all sixteen classes `valueSchemaFor(def, 'stored')`
    // covers found only `location` and `address` backed by a `strictObject`,
    // so only they can emit the issue the preference looks for. For the other
    // fourteen the selected message is `issues[0]` exactly as before — this
    // pin is the one that goes red if the preference ever starts reordering
    // a class it has no business reordering.
    const v = checkLiteralDefaultValue({ type: 'datetime' }, '2026-08-10T15:00');
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('ISO-8601 instant');
    expect(v.detail).not.toContain('Unrecognized key');
  });
});
