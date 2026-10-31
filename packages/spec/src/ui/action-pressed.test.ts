// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#27946 — `pressed` on the action contract, the spec half.
//
// A record header action the reader toggles (HotCRM's "Helpful" / "Not
// Helpful") could not show that the reader already acted. `pressed` is the
// per-reader predicate a surface draws as `aria-pressed`: CEL over the same
// scope as `visible`, display only. These pins hold the parse (both arms, the
// normalization), the refusals (a boolean literal, the blank shapes every
// evaluated slot refuses), the renames, and that a block declared under
// `attachedOnRead` is how a per-reader fact reaches it. The lint half is
// pinned in `packages/lint/src/validate-expressions.test.ts` and
// `validate-expressions.attached-on-read.test.ts`.

import { describe, it, expect } from 'vitest';
import { ActionSchema } from './action.zod';
import { EVALUATED_EXPRESSION_SOURCE_REQUIRED } from '../shared/expression.zod';
import { ObjectSchema } from '../data/object.zod';

/** Minimum legal registered action: a `script` needs a dispatch `target`. */
const base = {
  name: 'mark_article_helpful',
  label: 'Helpful',
  objectName: 'kb_article',
  type: 'script',
  target: 'markHelpful',
  locations: ['record_header'],
} as const;

const PRESSED = "has(record.viewer) && record.viewer.vote == 'helpful'";

const messages = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => i.message);

describe('ActionSchema.pressed — the parse', () => {
  it('normalizes a CEL string to the evaluated envelope', () => {
    const result = ActionSchema.safeParse({ ...base, pressed: PRESSED });

    expect(result.success).toBe(true);
    expect(result.success && result.data.pressed).toEqual({ dialect: 'cel', source: PRESSED });
  });

  it('accepts the `{ dialect, source }` envelope', () => {
    const envelope = { dialect: 'cel', source: PRESSED, meta: { rationale: 'the reader voted Helpful' } };
    const result = ActionSchema.safeParse({ ...base, pressed: envelope });

    expect(result.success).toBe(true);
    expect(result.success && result.data.pressed).toEqual(envelope);
  });

  it('is optional — an action without it parses with no key', () => {
    const result = ActionSchema.safeParse(base);

    expect(result.success).toBe(true);
    expect(result.success && 'pressed' in result.data).toBe(false);
  });
});

describe('ActionSchema.pressed — the refusals', () => {
  it.each([true, false])('refuses the boolean literal %s: a constant is a style, not a reader\'s state', (literal) => {
    const result = ActionSchema.safeParse({ ...base, pressed: literal });

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((i) => i.path.join('.'))).toContain('pressed');
  });

  it.each([
    ['a blank bare string', '   '],
    ['a blank `source`', { dialect: 'cel', source: ' ' }],
    ['an `ast`-only envelope', { dialect: 'cel', ast: { kind: 'literal', value: true } }],
  ])('refuses %s with the evaluated-slot sentence', (_label, value) => {
    const result = ActionSchema.safeParse({ ...base, pressed: value });

    expect(result.success).toBe(false);
    expect(messages(result)).toContain(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
  });
});

describe('ActionSchema.pressed — the renames', () => {
  it.each(['active', 'activeWhen', 'pressedWhen'])('`%s` is refused with a rename to `pressed`', (alias) => {
    const result = ActionSchema.safeParse({ ...base, [alias]: PRESSED });

    expect(result.success).toBe(false);
    expect(messages(result).join('\n')).toContain('`pressed`');
  });
});

describe('ActionSchema.pressed — a per-reader fact reaches it through `attachedOnRead`', () => {
  it('the object declares the block the predicate reads, beside its own columns', () => {
    // The vote is a child row per reader, never a column of the article; the
    // serving side computes `viewer.vote` per caller and attaches it.
    const article = ObjectSchema.safeParse({
      name: 'kb_article',
      label: 'Article',
      fields: { title: { type: 'text', label: 'Title' } },
      attachedOnRead: { viewer: { vote: 'text' } },
      actions: [{ ...base, pressed: PRESSED }],
    });

    expect(article.success).toBe(true);
  });
});
