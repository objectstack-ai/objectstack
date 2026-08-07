// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5051 — `composeStacks` composes `i18n` like every other single-valued
 * top-level key: identical declarations pass through, differing ones throw.
 *
 * ## What changed and why
 *
 * #5005 unified the non-array top-level keys on «same value passes / conflict
 * errors», and the maintainer's 2026-08-04 ruling named the rejected shape
 * explicitly: ⛔ no last-wins — an earlier stack's declaration overwritten
 * without a word by whoever composes after it. `i18n` survived that pass only
 * because #5005's subject was keys that were *dropped*, and `i18n` had a
 * working (if silent) strategy of its own. It was then the single remaining
 * last-wins key on the whole surface; the 2026-08-06 ruling on #5051 took
 * option **A — align**.
 *
 * The harm is concrete rather than theoretical: a stack's `translations`
 * bundles are authored against the `supportedLocales` that same stack
 * declares. Letting an add-on's `i18n` win means the base stack's bundles now
 * address locales the composed application does not admit — and the author is
 * told nothing. (The shipped examples are exactly this pair: `app-crm`
 * declares `['en','zh-CN']`, `app-todo` declares `['en','zh-CN','ja-JP']`.)
 *
 * ## Reverse verification — direction declared BEFORE running
 *
 * Restoring the deleted last-wins limb (the `i18n` step in `composeStacks`
 * plus the `i18n: 'i18n'` disposition) must turn the CONFLICT cases below RED:
 * they stop throwing and return the later stack's config, so the assertion
 * fails naming exactly the value that survived — with the earlier stack's
 * declaration nowhere in the result. That is the plain "red" direction.
 *
 * The pass-through cases (one declarant; identical declarations) are GREEN
 * under both implementations by construction — last-wins and single-value
 * agree whenever there is nothing to disagree about. They are control, not
 * evidence, and are labelled as such below.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { composeStacks, defineStack, type ObjectStackDefinition } from './stack.zod';

// ─── Helpers ────────────────────────────────────────────────────────

/** A stack object that is NOT schema-validated — lets a case declare a partial `i18n`. */
function raw(overrides: Record<string, unknown>): ObjectStackDefinition {
  return defineStack(overrides as never, { strict: false });
}

const manifestA = { id: 'com.example.base', name: 'base', version: '1.0.0', type: 'app' as const };
const manifestB = { id: 'com.example.addon', name: 'addon', version: '1.0.0', type: 'app' as const };
const manifestC = { id: 'com.example.extra', name: 'extra', version: '1.0.0', type: 'app' as const };

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

// ─── Conflicts — the behaviour #5051 changed ────────────────────────

describe('#5051 — conflicting `i18n` declarations are a composition error', () => {
  it('throws instead of letting the later stack win (the issue\'s own repro)', () => {
    const a = raw({ manifest: manifestA, i18n: { defaultLocale: 'en' } });
    const b = raw({ manifest: manifestB, i18n: { defaultLocale: 'zh-CN' } });

    // On origin/main this returned `{ defaultLocale: 'zh-CN' }` and stack A's
    // declaration vanished without a word.
    expect(() => composeStacks([a, b])).toThrow(/top-level key 'i18n'/);
  });

  it('names both source stacks and the way out', () => {
    const a = raw({ manifest: manifestA, i18n: { defaultLocale: 'en' } });
    const b = raw({ manifest: manifestB, i18n: { defaultLocale: 'zh-CN' } });

    let message = '';
    try {
      composeStacks([a, b]);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("'com.example.base' (stack #0)");
    expect(message).toContain("'com.example.addon' (stack #1)");
    expect(message).toContain("Fix: make the two 'i18n' declarations identical");
    // The prescription names the i18n-specific harm, not only the security one.
    expect(message).toContain("'translations'");
  });

  it('is order-independent — swapping the stacks still throws', () => {
    const a = raw({ manifest: manifestA, i18n: { defaultLocale: 'en' } });
    const b = raw({ manifest: manifestB, i18n: { defaultLocale: 'zh-CN' } });

    expect(() => composeStacks([b, a])).toThrow(/top-level key 'i18n'/);
  });

  it('throws on the shipped examples\' shape — same default locale, different locale sets', () => {
    // Verbatim from examples/app-crm and examples/app-todo, the pair the
    // composition docs use. `defaultLocale` agrees; `supportedLocales` does not.
    const crm = raw({
      manifest: manifestA,
      i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'], fallbackLocale: 'en' },
    });
    const todo = raw({
      manifest: manifestB,
      i18n: {
        defaultLocale: 'en',
        supportedLocales: ['en', 'zh-CN', 'ja-JP'],
        fallbackLocale: 'en',
      },
    });

    expect(() => composeStacks([crm, todo])).toThrow(/top-level key 'i18n'/);
  });

  it('does NOT deep-merge two partial declarations into a third value', () => {
    // Each stack declares a key the other does not. Under a deep merge this
    // would compose to { defaultLocale: 'en', fallbackLocale: 'en',
    // supportedLocales: [...] } — a value neither author wrote. The ruling
    // (#5005, reaffirmed for i18n by #5051) rejects that as loudly as last-wins.
    const a = raw({ manifest: manifestA, i18n: { defaultLocale: 'en' } });
    const b = raw({
      manifest: manifestB,
      i18n: { defaultLocale: 'en', supportedLocales: ['en', 'ja-JP'] },
    });

    expect(() => composeStacks([a, b])).toThrow(/top-level key 'i18n'/);
  });

  it('reports the first disagreeing pair across three stacks', () => {
    const a = raw({ manifest: manifestA, i18n: { defaultLocale: 'en' } });
    const b = raw({ manifest: manifestB, i18n: { defaultLocale: 'zh-CN' } });
    const c = raw({ manifest: manifestC, i18n: { defaultLocale: 'en' } });

    let message = '';
    try {
      composeStacks([a, b, c]);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("'com.example.base' (stack #0)");
    expect(message).toContain("'com.example.addon' (stack #1)");
  });

  it('falls back to the positional label when a stack has no manifest', () => {
    const a = raw({ i18n: { defaultLocale: 'en' } });
    const b = raw({ i18n: { defaultLocale: 'zh-CN' } });

    expect(() => composeStacks([a, b])).toThrow(/stack #0 and stack #1/);
  });

  it('rejects the conflict on schema-valid, strictly-parsed stacks too', () => {
    // Not just the `strict: false` door: this is what an author writing two
    // real `objectstack.config.ts` files and composing them now sees.
    const a = defineStack({
      manifest: manifestA,
      i18n: { defaultLocale: 'en', supportedLocales: ['en'] },
    });
    const b = defineStack({
      manifest: manifestB,
      i18n: { defaultLocale: 'zh-CN', supportedLocales: ['zh-CN'] },
    });

    expect(() => composeStacks([a, b])).toThrow(/top-level key 'i18n'/);
  });
});

// ─── Pass-through — CONTROL (green before and after #5051) ──────────

describe('#5051 control — an `i18n` nobody disagrees about still composes', () => {
  it('keeps the only declaration, from either position', () => {
    const withI18n = { manifest: manifestA, i18n: { defaultLocale: 'en', supportedLocales: ['en'] } };
    const without = { manifest: manifestB };

    expect(composeStacks([raw(withI18n), raw(without)]).i18n).toEqual({
      defaultLocale: 'en',
      supportedLocales: ['en'],
    });
    expect(composeStacks([raw(without), raw(withI18n)]).i18n).toEqual({
      defaultLocale: 'en',
      supportedLocales: ['en'],
    });
  });

  it('passes identical declarations through (structural equality, not identity)', () => {
    const a = raw({
      manifest: manifestA,
      i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'], fallbackLocale: 'en' },
    });
    const b = raw({
      manifest: manifestB,
      i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'], fallbackLocale: 'en' },
    });

    expect(composeStacks([a, b]).i18n).toEqual({
      defaultLocale: 'en',
      supportedLocales: ['en', 'zh-CN'],
      fallbackLocale: 'en',
    });
  });

  it('treats an explicit `i18n: undefined` as "not declared"', () => {
    const a = raw({ manifest: manifestA, i18n: { defaultLocale: 'en' } });
    const b = raw({ manifest: manifestB, i18n: undefined });

    expect(composeStacks([a, b]).i18n).toEqual({ defaultLocale: 'en' });
  });

  it('leaves `i18n` absent when no stack declares one', () => {
    const composed = composeStacks([raw({ manifest: manifestA }), raw({ manifest: manifestB })]);
    expect(composed.i18n).toBeUndefined();
  });

  it('does not warn — `i18n` has a declared composition rule', () => {
    const a = raw({ manifest: manifestA, i18n: { defaultLocale: 'en' } });
    const b = raw({ manifest: manifestB, i18n: { defaultLocale: 'en' } });

    composeStacks([a, b]);

    // A key reaching the composer without a rule warns (#5005 rule 3). `i18n`
    // is declared `'single'`, so silence here is the positive evidence that it
    // did not fall through to the default path.
    expect(warnSpy.mock.calls.map((call: unknown[]) => String(call[0]))).toEqual([]);
  });

  it('leaves the single-stack short circuit alone', () => {
    const only = raw({ manifest: manifestA, i18n: { defaultLocale: 'zh-CN' } });
    expect(composeStacks([only]).i18n).toEqual({ defaultLocale: 'zh-CN' });
  });
});
