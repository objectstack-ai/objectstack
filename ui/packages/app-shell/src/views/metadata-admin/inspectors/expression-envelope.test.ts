// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#3218 — the ONE read/write pair every inspector uses for an
 * ADR-0089 expression-shaped metadata value.
 *
 * The read delegates to `conditionText` (objectui#3216's single reader) so this
 * module adds no new spelling of "how an expression is read". What it adds is
 * the WRITE, which #3216 never had to answer: an inspector edits `source`, and
 * everything else in the envelope must survive that edit.
 *
 * Fixtures are authored input fed through `HookSchema.parse` — never
 * hand-written envelopes — so they cannot drift from the spec. The one
 * exception is the ast-only envelope, which `@objectstack/spec` 17.5.0 refuses
 * to produce; its row says why (objectui#11073).
 */

import { describe, it, expect } from 'vitest';
import { HookSchema } from '@objectstack/spec/data';
import { expressionSource, writeExpressionSource } from './expression-envelope';

/** The `condition` a hook actually carries once the spec has parsed it. */
function storedCondition(authored: unknown): unknown {
  return HookSchema.parse({
    name: 'guard_hook',
    object: 'lead',
    events: ['beforeInsert'],
    handler: 'guard_fn',
    condition: authored,
  }).condition;
}

describe('expressionSource — read (#3218)', () => {
  it('reads the envelope the spec normalizes an authored string into', () => {
    const stored = storedCondition('amount > 10');
    expect(stored).toEqual({ dialect: 'cel', source: 'amount > 10' });
    // The defect: this used to be '' because the read was bare-string-only,
    // so the author saw "no condition" on a hook that had one.
    expect(expressionSource(stored)).toBe('amount > 10');
  });

  it('reads a bare string unchanged (pre-parse drafts)', () => {
    expect(expressionSource('amount > 10')).toBe('amount > 10');
  });

  it('reads nothing readable as the empty string', () => {
    expect(expressionSource(undefined)).toBe('');
    expect(expressionSource(null)).toBe('');
    // `disabled` is `boolean | ExpressionInput` on an action — a boolean is
    // not an expression and must not be stringified into the editor.
    expect(expressionSource(true)).toBe('');
    // An AST-only envelope (spec phase M9.2) has no readable source;
    // `conditionText` says so rather than inventing text. Through
    // `@objectstack/spec` 17.4.0 `HookSchema.parse` produced one; 17.5.0
    // REFUSES it at `condition` (an evaluated slot needs a non-blank `source`),
    // so the spec can no longer mint this fixture (objectui#11073). The read
    // still owes an answer for the one that is already STORED — the exact
    // object 17.4.0 parsed to, which a hand-written literal now reproduces.
    const astOnly = { dialect: 'cel', ast: { op: 'gt' } };
    const refused = HookSchema.safeParse({
      name: 'guard_hook',
      object: 'lead',
      events: ['beforeInsert'],
      handler: 'guard_fn',
      condition: astOnly,
    });
    expect(refused.success, 'the spec refuses an ast-only envelope since 17.5.0').toBe(false);
    expect(refused.success ? [] : refused.error.issues.map((i) => i.path.join('.'))).toContain('condition');
    expect(expressionSource(astOnly)).toBe('');
    // Never `[object Object]` — the generic SchemaForm condition widget used
    // to `String(value)` an envelope straight into the editor.
    expect(expressionSource({ dialect: 'cel', source: 'a > 1' })).not.toContain('object Object');
  });
});

describe('writeExpressionSource — write (#3218, ruling option B)', () => {
  it('preserves `dialect` and `meta`, replaces `source`', () => {
    const stored = storedCondition({
      dialect: 'cel',
      source: 'amount > 10',
      meta: { rationale: 'large deals only', generatedBy: 'agent:deal-guard' },
    });
    expect(writeExpressionSource(stored, 'amount > 20')).toEqual({
      dialect: 'cel',
      source: 'amount > 20',
      meta: { rationale: 'large deals only', generatedBy: 'agent:deal-guard' },
    });
  });

  it('keeps a non-cel dialect (the A/B dividing line)', () => {
    for (const dialect of ['template', 'cron'] as const) {
      const stored = storedCondition({ dialect, source: 'a' });
      expect(writeExpressionSource(stored, 'b')).toEqual({ dialect, source: 'b' });
    }
  });

  it('DISCARDS `ast` — it is derived from the old source', () => {
    const stored = storedCondition({
      dialect: 'cel',
      source: 'amount > 10',
      ast: { op: '>', left: 'amount', right: 10 },
      meta: { generatedBy: 'agent:deal-guard' },
    });
    const next = writeExpressionSource(stored, 'amount > 20') as Record<string, unknown>;
    expect(next).not.toHaveProperty('ast');
    expect(next).toEqual({
      dialect: 'cel',
      source: 'amount > 20',
      meta: { generatedBy: 'agent:deal-guard' },
    });
    // Still spec-valid: ExpressionSchema's refine only needs one of source|ast.
    expect(
      HookSchema.parse({
        name: 'guard_hook', object: 'lead', events: ['beforeInsert'], handler: 'guard_fn',
        condition: next,
      }).condition,
    ).toEqual(next);
  });

  it('falls back to the bare-string shorthand when there is no prior envelope', () => {
    // The shorthand IS `dialect: 'cel'` — the spec's pipe normalizes it — so
    // nothing is lost, and a plain-string field is not handed an object.
    expect(writeExpressionSource(undefined, 'amount > 10')).toBe('amount > 10');
    expect(writeExpressionSource('amount > 5', 'amount > 10')).toBe('amount > 10');
    expect(writeExpressionSource(true, 'amount > 10')).toBe('amount > 10');
    // An object with no `dialect` is not a valid envelope; treat it as absent
    // rather than propagating a shape the spec rejects.
    expect(writeExpressionSource({ source: 'amount > 5' }, 'amount > 10')).toBe('amount > 10');
  });

  it('clears to `undefined` on an empty source, envelope or not', () => {
    expect(writeExpressionSource(storedCondition('amount > 10'), '')).toBeUndefined();
    expect(writeExpressionSource('amount > 10', '')).toBeUndefined();
    expect(writeExpressionSource(undefined, '')).toBeUndefined();
  });

  it('does not mutate the draft it was given', () => {
    const stored = storedCondition({ dialect: 'cel', source: 'amount > 10', ast: { op: 'gt' } });
    const snapshot = JSON.parse(JSON.stringify(stored));
    writeExpressionSource(stored, 'amount > 20');
    expect(stored).toEqual(snapshot);
  });
});
