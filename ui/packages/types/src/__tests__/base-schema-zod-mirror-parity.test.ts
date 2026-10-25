// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The zod `BaseSchema` mirror accepts everything its TypeScript declaration
 * declares (objectui#4605).
 *
 * `packages/types/src/zod/base.zod.ts` is a hand-written runtime validator
 * mirroring the `BaseSchema` interface in `../base.ts`. It is a PUBLISHED
 * surface (`@object-ui/types/zod`), and it had drifted NARROWER than the
 * declaration it mirrors on five keys — so a spelling the published types
 * invite, and the renderer implements, was refused at parse time. That is
 * "declared = enforced" inverted: the type says yes, the validator says no.
 *
 * `.passthrough()` rescues none of it. Passthrough admits UNDECLARED keys;
 * all five are explicitly declared, so the declared narrow validator wins.
 *
 * ## The drift, measured against `origin/main` (`d7573b3f4`) BEFORE the fix
 *
 * Each of these was fed to the unmodified mirror and its rejection recorded —
 * a widened validator accepts everything it accepted before, so a pin that
 * only feeds it currently-valid input passes identically before and after and
 * proves nothing. These are the inputs the OLD mirror really did refuse:
 *
 *   | key           | authored input                             | old mirror said                                    |
 *   |---------------|--------------------------------------------|----------------------------------------------------|
 *   | `visible`     | `'${data.status === "open"}'`              | `expected boolean, received string`                 |
 *   | `disabled`    | `'${data.status === "locked"}'`            | `expected boolean, received string`                 |
 *   | `ariaLabel`   | `{ key, defaultValue }`                    | `expected string, received object`                  |
 *   | `label`       | `{ en: 'Owner', 'zh-CN': '负责人' }`        | `expected string, received object`                  |
 *   | `description` | `{ en: 'The record owner' }`               | `expected string, received object`                  |
 *
 * `visible`/`disabled` widened on the TS side by #4581 (#4580 ruling Q3-A for
 * `disabled`); `ariaLabel` by #4580's Q2-B ruling; `label`/`description` by
 * #4580's revised Q1-A ruling — the last two are the census growth that
 * ruling recorded for this card.
 *
 * ## Two vocabularies, two properties apart — pinned as REJECTIONS
 *
 * `label`/`description` declare the spec's INLINE locale map (`I18nLabel`,
 * `{ en: 'Owner' }`, resolved by `resolveI18nLabel(label, locale)`), while
 * `ariaLabel` declares the KEYED reference (`{ key, defaultValue?, params? }`,
 * resolved by `resolveKeyedI18nLabel`). They are structurally confusable and
 * answer wrongly for each other's input — objectui#4167's hazard, live on this
 * one interface since #4580's revised Q1. Widening both slots to "some object"
 * would have reproduced that defect in a new place, so each slot admits only
 * its own vocabulary and the cross pairings are pinned red below.
 *
 * ## Why the type-level pin is derived rather than a hand-written key list
 *
 * A hand-written list drifts exactly the way the mirror just did. The pin
 * below reads the mirror's OWN `.shape` and compares each key against the
 * declaration, so the NEXT widening of `../base.ts` that forgets this file
 * turns it red with no list to maintain.
 *
 * It reads `.shape` and not `keyof z.input<typeof Mirror>` because that
 * spelling is vacuous — measured: `.passthrough()` collapses the inferred key
 * union to bare `string`, and a pin written over it resolved `never` while
 * five keys were demonstrably narrow.
 */

import { describe, it, expect } from 'vitest';
import { BaseSchema as Mirror } from '../zod/base.zod.js';

/* ── The derived parity invariant lives in the population guard ──────────── */

/**
 * The type-level pin this card introduced — read the mirror's OWN `.shape` and
 * compare each key against the declaration, so the next widening that forgets
 * this file turns red with no key list to maintain — now lives in
 * `./zod-mirror-parity.test.ts` (objectui#5684), which applies that one
 * construction to every registered mirror in `../zod/`.
 *
 * `BaseSchema` is a registered row there (`'base.zod.ts#BaseSchema'`), so the
 * invariant is unchanged and still enforced by `tsc -p tsconfig.test.json`; it
 * is simply not restated here. Its two non-vacuity guards travelled with it:
 * `assertionBaseSchemaKeysResolve` keeps this card's six-key pin by name, and
 * `assertionNoVacuousEntry` generalises the bare-`string` degeneration check
 * across the whole population.
 *
 * What stays here is what is specific to #4605: the spellings the OLD mirror
 * really did refuse, and the two i18n vocabularies that must not cross.
 */

/* ── Runtime: the spellings the OLD mirror refused ───────────────────────── */

describe('zod BaseSchema mirror — the widened spellings parse', () => {
  it('visible accepts the predicate string the renderer evaluates', () => {
    const r = Mirror.safeParse({ type: 'test-component', visible: '${data.status === "open"}' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.visible).toBe('${data.status === "open"}');
  });

  it('disabled accepts the predicate string the renderer evaluates', () => {
    const r = Mirror.safeParse({ type: 'test-component', disabled: '${data.status === "locked"}' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.disabled).toBe('${data.status === "locked"}');
  });

  it('ariaLabel accepts the KEYED i18n reference, params included', () => {
    const ariaLabel = { key: 'dialog.close', defaultValue: 'Close dialog', params: { name: 'Owner' } };
    const r = Mirror.safeParse({ type: 'test-component', ariaLabel });
    expect(r.success).toBe(true);
    expect(r.success && r.data.ariaLabel).toEqual(ariaLabel);
  });

  it('label accepts the spec inline locale map', () => {
    const label = { en: 'Owner', 'zh-CN': '负责人' };
    const r = Mirror.safeParse({ type: 'test-component', label });
    expect(r.success).toBe(true);
    expect(r.success && r.data.label).toEqual(label);
  });

  it('description accepts the spec inline locale map', () => {
    const description = { en: 'The record owner' };
    const r = Mirror.safeParse({ type: 'test-component', description });
    expect(r.success).toBe(true);
    expect(r.success && r.data.description).toEqual(description);
  });
});

/* ── Runtime: the narrow spellings a widening must not lose ──────────────── */

describe('zod BaseSchema mirror — the pre-existing spellings still parse', () => {
  it.each([
    ['visible: boolean', { visible: true }],
    ['disabled: boolean', { disabled: false }],
    ['ariaLabel: string', { ariaLabel: 'Close dialog' }],
    ['label: string', { label: 'Owner' }],
    ['description: string', { description: 'The record owner' }],
  ])('%s', (_name, patch) => {
    expect(Mirror.safeParse({ type: 'test-component', ...patch }).success).toBe(true);
  });
});

/* ── Runtime: the two vocabularies stay apart ────────────────────────────── */

describe('zod BaseSchema mirror — keyed and inline i18n do not cross', () => {
  it('ariaLabel REFUSES an inline locale map (resolveKeyedI18nLabel returns undefined for it)', () => {
    const r = Mirror.safeParse({ type: 'test-component', ariaLabel: { en: 'Owner' } });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues.some((i) => i.path[0] === 'ariaLabel')).toBe(true);
  });

  it.each([['label'], ['description']])(
    '%s REFUSES the keyed reference (the spec resolver reads locale tags, not `key`)',
    (key) => {
      const r = Mirror.safeParse({
        type: 'test-component',
        [key]: { key: 'dialog.close', defaultValue: 'Close dialog' },
      });
      expect(r.success).toBe(false);
      expect(!r.success && r.error.issues.some((i) => i.path[0] === key)).toBe(true);
    },
  );
});
