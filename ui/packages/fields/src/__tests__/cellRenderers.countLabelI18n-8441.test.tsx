/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8441 — the `repeater` cell counted its rows in hardcoded Chinese,
 * and the `file` cell counted its files in hardcoded English.
 *
 * ## What was measured before anything moved
 *
 * `getCellRenderer('repeater')` returned an inline arrow that rendered the row
 * count followed by a Chinese unit word (U+9879, spelled as an escape
 * throughout this file — AGENTS.md #-1 governs comments and source too). Every
 * reader on every locale saw it, English ones included, next to the English
 * siblings `[Vector]`, `[Grid]` and `FileCellRenderer`'s `N files` on the same
 * detail page. Two rules broke on one literal: #-1 (English-only codebase) and
 * "it bypasses i18n entirely".
 *
 * ## Why the fix is the i18n channel and not "make it English"
 *
 * Maintainer ruling on the card: making it English answers only the FIRST of
 * the two rules the card names — "every reader on every locale sees an
 * unlocalized literal" survives verbatim, in another language. The channel
 * (`useFieldTranslate` -> `useObjectTranslation`) was already imported by this
 * very file and already used by `DateCellRenderer`, `DateTimeCellRenderer`,
 * `ImageCellRenderer` and `FormulaCellRenderer`, so routing costs no new
 * dependency and no new published surface.
 *
 * `FileCellRenderer` rides along for the same reason: it spelled the same
 * concept `count === 1 ? 'file' : 'files'` two hundred lines up. That is not a
 * rule violation — it is English — but a two-branch ternary cannot spell `ru`'s
 * four plural categories or `ar`'s six, and two adjacent cells answering one
 * concept two ways is the shape the ruling closes.
 *
 * ## The shape of the assertions here, and why each one is needed
 *
 * - **Every pin reads RENDERED DOM TEXT**, never source text. A source-text
 *   assertion passes the day someone re-adds the literal through a constant.
 * - **A LIT CONTROL for the channel, in this same run.** Every negative
 *   assertion below ("no U+9879 survives", "no English survives") is also
 *   satisfied by a provider that never mounted and a pack that never loaded.
 *   The control renders `detail.unresolvedReference` — a key that resolved
 *   through THIS file's `useFieldTranslate` before this card — under `ru`, and
 *   asserts the Russian value. If it fails, nothing else here means anything.
 * - **`ru` is the non-English leg, not `zh`, and that is load-bearing.**
 *   `Intl.PluralRules('ru').select(2)` is `few`, a category `en` does not
 *   have, so count 2 is answered by the `ru` pack's own `_few` slot (since
 *   objectui#11432; the BASE key before it) — in Russian. A leg that renders
 *   English there is objectui#3863 reopened. `zh` is asserted too, because the same Chinese
 *   string that was the DEFECT as a source literal is the CORRECT rendering as
 *   a pack value, and only a locale-varying assertion can tell those apart.
 * - **The provider-less English fallback is pinned byte-equal to the `en`
 *   pack.** `check:i18n-keys` compares an inline `defaultValue` against the
 *   pack; this call site's fallback is a ternary, not that shape, so the gate
 *   cannot see it. This pin is the comparison instead — the same duty
 *   `userCell.unresolvedReference-8434.test.tsx` performs for its sentence.
 * - **The table entry is pinned STABLE across `getCellRenderer` calls.**
 *   `getCellRenderer` rebuilds `standardMap` on every call and both call sites
 *   (`DetailSection`, `renderFieldValue`) resolve inside render, so an inline
 *   arrow is a new component TYPE per render: React unmounts and remounts the
 *   cell, taking react-i18next's language subscription with it. Hoisting the
 *   renderer to a module-level function is what makes the hook safe to hold,
 *   and identity is the only observable that says so.
 *
 * ## The call mechanism this card's premise turned on
 *
 * The ruling made the fix conditional on hooks being legal in that table. Both
 * halves were measured on `origin/main` before a line was written: four table
 * entries already call hooks, and every call site renders the resolved value as
 * a JSX ELEMENT (`<CellRenderer value={…} field={…} />` in
 * `plugin-detail/src/DetailSection.tsx`, `<Renderer … />` in
 * `plugin-dashboard/src/recordFields.tsx` and
 * `fields/src/widgets/lookupColumnDisplay.tsx`), never a plain call. The tests
 * below render through the same shape.
 *
 * ## What this file deliberately does NOT pin
 *
 * The `[Vector]` / `[Grid]` placeholders in the same table. They are a
 * different class — type placeholders, not count phrases — the card did not
 * measure them, and the ruling fenced them off. Pinning their current text here
 * would read as an endorsement of it.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { en, ru, zh } from '@object-ui/i18n/locales';

import { getCellRenderer } from '../index';

/**
 * The Chinese unit word the defect hardcoded, written as an escape so this file
 * stays English source (AGENTS.md #-1) and so a careless find-and-replace over
 * the character cannot silently disarm the assertions.
 */
const CN_ITEM_UNIT = '\u9879';

const repeaterField = { name: 'stuff', label: 'Stuff', type: 'repeater' } as any;
const fileField = { name: 'docs', label: 'Docs', type: 'file' } as any;

/**
 * Resolve and render exactly the way the production call sites do — resolve the
 * component, then render it as an ELEMENT. `DetailSection.tsx:381` is
 * `const CellRenderer = getCellRenderer(resolvedType); return <CellRenderer
 * value={value} field={…} />`; this is that, verbatim.
 */
function renderCell(type: string, value: unknown, field: any, language?: string) {
  const CellRenderer = getCellRenderer(type);
  const element = <CellRenderer value={value} field={field} />;
  return render(
    language === undefined ? (
      element
    ) : (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
        {element}
      </I18nProvider>
    ),
  );
}

const textOf = (container: HTMLElement) => container.textContent ?? '';

/** An `n`-element array — the value shape a `repeater` / multi-file cell holds. */
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ q: i + 1 }));

/**
 * A file value that RESOLVES — the expanded read-path shape. `rows(n)` above
 * deliberately does not: objectui#9161 renders one as an anchor and the other as
 * plain text, and only having both in this file says which pin measures which.
 */
const RESOLVABLE = { id: 'f_1928', name: 'att-1928.txt', url: '/api/v1/storage/files/f_1928' };

beforeEach(() => {
  cleanup();
});

/* -------------------------------------------------------------------------- */
/* Control: the channel is live in THIS run.                                    */
/* -------------------------------------------------------------------------- */

describe('the locale channel is live in this run (control for objectui#8441)', () => {
  it('resolves detail.unresolvedReference under `ru` — a key keyed before this card', () => {
    // Same file, same `useFieldTranslate`, same provider. A blank or English
    // result in any test below is a dead provider unless this one passes.
    const { container } = renderCell('user', 'Ada Lovelace', { name: 'owner', type: 'user' }, 'ru');
    const stated = container.querySelector('[data-slot="unresolved-reference"]')?.getAttribute('title');
    const packed = (ru as any).detail.unresolvedReference.replace('{{value}}', 'Ada Lovelace');
    expect(stated, 'the ru pack must be loaded and the provider mounted').toBe(packed);
    expect(stated, 'and it must not be the English sentence').not.toBe(
      (en as any).detail.unresolvedReference.replace('{{value}}', 'Ada Lovelace'),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* THE DEFECT: the repeater count under an English locale.                      */
/* -------------------------------------------------------------------------- */

describe('objectui#8441 — the `repeater` count is English under an English locale', () => {
  it('a two-element array renders `2 items`, with no Chinese unit word anywhere', () => {
    const { container } = renderCell('repeater', rows(2), repeaterField, 'en');
    expect(textOf(container)).not.toContain(CN_ITEM_UNIT);
    expect(textOf(container)).toBe('2 items');
  });

  it('a one-element array renders the singular — a count phrase must agree with its number', () => {
    const { container } = renderCell('repeater', rows(1), repeaterField, 'en');
    expect(textOf(container)).toBe('1 item');
  });

  it('an empty array still renders the shared empty affordance, unchanged by this card', () => {
    const { container } = renderCell('repeater', [], repeaterField, 'en');
    expect(textOf(container)).not.toContain(CN_ITEM_UNIT);
    expect(textOf(container)).not.toMatch(/item/);
  });

  it('a non-array value is still empty, unchanged by this card', () => {
    const { container } = renderCell('repeater', null, repeaterField, 'en');
    expect(textOf(container)).not.toMatch(/item/);
  });
});

/* -------------------------------------------------------------------------- */
/* The label really varies by locale — the half "make it English" cannot buy.    */
/* -------------------------------------------------------------------------- */

describe('objectui#8441 — the `repeater` count varies by locale', () => {
  it('`zh` renders the Chinese unit word as a PACK VALUE, not as a source literal', () => {
    const { container } = renderCell('repeater', rows(2), repeaterField, 'zh');
    expect(textOf(container)).toContain(CN_ITEM_UNIT);
    expect(textOf(container)).toBe((zh as any).detail.repeaterItemCount.replace('{{count}}', '2'));
    // …and the same value under `en` does not, which is the whole difference
    // between a translation and a hardcode.
    cleanup();
    expect(textOf(renderCell('repeater', rows(2), repeaterField, 'en').container)).not.toContain(
      CN_ITEM_UNIT,
    );
  });

  it('`ru` at count 1 uses `_one` from the ru pack', () => {
    const { container } = renderCell('repeater', rows(1), repeaterField, 'ru');
    expect(textOf(container)).toBe((ru as any).detail.repeaterItemCount_one.replace('{{count}}', '1'));
  });

  it('`ru` at count 2 reads the `_few` slot IN RUSSIAN — objectui#11432, not English', () => {
    // `Intl.PluralRules('ru').select(2)` is `few`. Since objectui#11432 the ru
    // pack spells out `_few` (before it, the base key answered; before THAT,
    // i18next walked `fallbackLng` to `en` and a Russian reader got English at
    // counts 2-20 — objectui#3863). This is the pin that says the channel reaches
    // the category's own slot.
    expect(new Intl.PluralRules('ru').select(2)).toBe('few');
    const { container } = renderCell('repeater', rows(2), repeaterField, 'ru');
    const rendered = textOf(container);
    // ⚠️ The RENDER-side assertion runs FIRST, deliberately. Reading the pack for
    // the oracle throws when the slot is absent, and a pin that dies on its own
    // oracle reddens without ever saying what the reader saw. Measured: with the
    // ru base key deleted this leg reported a `TypeError` on the oracle and
    // nothing about the DOM — so the order is the difference between "red" and
    // "red for the stated reason".
    expect(rendered, 'a Russian reader must not be handed English').not.toBe('2 items');
    expect(rendered).toBe((ru as any).detail.repeaterItemCount_few.replace('{{count}}', '2'));
  });
});

/* -------------------------------------------------------------------------- */
/* FileCellRenderer — in scope because the premise held: one channel, two sites. */
/* -------------------------------------------------------------------------- */

describe('objectui#8441 — the `file` count reads the same channel', () => {
  /**
   * ⚠️ UPDATED by objectui#9161, and the update is the finding rather than a
   * formality — the same way objectui#8695 moved a pin in
   * `cell-truncation.test.tsx` and that move WAS the finding.
   *
   * The two cases below asserted `2 files` / `1 file` against the WHOLE
   * container text for a NON-EMPTY array. That count was not a label beside the
   * files; it was the entire rendering. A `file` field in read-only state
   * therefore named nothing and linked nothing, so an attachment that uploaded
   * successfully could not be opened or downloaded from the PC Console at all
   * — while the record read, the signing endpoint and the signed URL itself all
   * answered 200. objectui#9161 replaced the non-empty arm with ONE AFFORDANCE
   * PER FILE.
   *
   * ⭐ objectui#8441's own subject survives intact and is re-pinned here, on the
   * arm where a count is still the whole truth: an array that resolves to no
   * renderable file states `0 files` — through `useFieldTranslate`, so `ru`'s
   * four plural categories and `ar`'s six stay the pack's problem and not a
   * ternary's. The per-item FALLBACK NAME is on the same channel, which is what
   * the `ru` and `zh` legs below now measure.
   *
   * ⛔ No `toBe` was weakened to a `toContain` and no case was deleted to get
   * past this: each one asserts the NEW text exactly, and the href the card
   * exists to produce is asserted beside it.
   */
  it('`en` keeps its English text byte for byte — the count arm, and the new per-file arm', () => {
    // `rows(n)` is `{ q: n }`: an object carrying neither a `url` nor an id, so
    // it resolves to NO href and renders as plain text under the pack's
    // fallback name. objectui#9161 requires exactly that — ⛔ never a dead
    // anchor for a value with nothing to link to.
    const fallback = (en as any).fields.file.fileFallback;
    expect(textOf(renderCell('file', rows(2), fileField, 'en').container)).toBe(fallback + fallback);
    cleanup();
    expect(textOf(renderCell('file', rows(1), fileField, 'en').container)).toBe(fallback);
    cleanup();
    // The count sentence, byte for byte, on the arm that kept it.
    expect(textOf(renderCell('file', [], fileField, 'en').container)).toBe('0 files');
    cleanup();
    // ⭐ And the behaviour the count made impossible, asserted in the same case
    // so this pin cannot be read as merely recording a text change: a file that
    // resolves carries its name AND a working href.
    const { container } = renderCell('file', [RESOLVABLE], fileField, 'en');
    expect(textOf(container)).toBe(RESOLVABLE.name);
    expect(container.querySelector('a')?.getAttribute('href')).toBe(RESOLVABLE.url);
  });

  it('`ru` at count 0 reads the `_many` slot IN RUSSIAN, and the per-file name is the `ru` word', () => {
    // `Intl.PluralRules('ru').select(0)` is `many`. Since objectui#11432 the ru
    // pack spells out `_many`, so count 0 reads it — before that it landed on the
    // BASE key, and before the base key i18next walked `fallbackLng` to `en` and
    // a Russian reader got English (objectui#3863).
    expect(new Intl.PluralRules('ru').select(0)).toBe('many');
    const zero = textOf(renderCell('file', [], fileField, 'ru').container);
    // ⚠️ RENDER-side first, deliberately: reading the pack for the oracle throws
    // when the slot is absent, and a pin that dies on its own oracle reddens
    // without ever saying what the reader saw.
    expect(zero, 'a Russian reader must not be handed English').not.toBe('0 files');
    expect(zero).toBe((ru as any).detail.fileCount_many.replace('{{count}}', '0'));
    cleanup();
    // The per-item fallback name rides the same channel: a bare value with no
    // name of its own is named by the `ru` pack, never by a source literal.
    const one = textOf(renderCell('file', rows(1), fileField, 'ru').container);
    expect(one).toBe((ru as any).fields.file.fileFallback);
    expect(one, 'and it is not the English word').not.toBe((en as any).fields.file.fileFallback);
  });

  it('a falsy value is still the empty affordance — the hook sits ABOVE that guard', () => {
    // The hoist is the rules-of-hooks half of this change: the early return was
    // this renderer's first statement, so a hook written after it would be
    // skipped for an empty value and hook order would desync between renders.
    const { container } = renderCell('file', null, fileField, 'en');
    expect(textOf(container)).not.toMatch(/file/);
  });

  it('a single file object still renders its name, untouched by this card', () => {
    const { container } = renderCell('file', { name: 'contract.pdf' }, fileField, 'en');
    expect(textOf(container)).toBe('contract.pdf');
  });
});

/* -------------------------------------------------------------------------- */
/* The provider-less path, and the pack it must not drift from.                 */
/* -------------------------------------------------------------------------- */

describe('objectui#8441 — the provider-less English fallback matches the `en` pack', () => {
  it('`repeater` — singular and plural, byte-equal to `en`', () => {
    expect(textOf(renderCell('repeater', rows(1), repeaterField).container)).toBe(
      (en as any).detail.repeaterItemCount_one.replace('{{count}}', '1'),
    );
    cleanup();
    expect(textOf(renderCell('repeater', rows(2), repeaterField).container)).toBe(
      (en as any).detail.repeaterItemCount_other.replace('{{count}}', '2'),
    );
  });

  it('`file` — the surviving count call, and the fallback name, byte-equal to `en`', () => {
    // ⚠️ UPDATED by objectui#9161: the two counts this asserted were taken on a
    // NON-EMPTY array, the arm that no longer counts. The DUTY is unchanged and
    // is what moved with the call — `check:i18n-keys` compares an inline
    // `defaultValue` against the pack, and neither of these call sites has that
    // shape (one is a ternary, the other a key-equality test), so this pin is
    // the comparison.
    expect(textOf(renderCell('file', [], fileField).container)).toBe(
      (en as any).detail.fileCount_other.replace('{{count}}', '0'),
    );
    cleanup();
    expect(textOf(renderCell('file', rows(1), fileField).container)).toBe(
      (en as any).fields.file.fileFallback,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Why the renderer had to leave the table literal.                             */
/* -------------------------------------------------------------------------- */

describe('objectui#8441 — the `repeater` entry is a STABLE component reference', () => {
  it('two resolutions return the same function object', () => {
    // `getCellRenderer` rebuilds `standardMap` per call, and both production
    // call sites resolve inside render. An inline arrow would be a fresh
    // component TYPE every render: React remounts the cell and tears down the
    // hook state — react-i18next's language subscription — with it. Identity is
    // the only observable that distinguishes the two shapes.
    expect(getCellRenderer('repeater')).toBe(getCellRenderer('repeater'));
  });

  // A control stood here: `getCellRenderer('vector')` differed across two
  // calls, which was the live proof that the resolver rebuilds its table. It
  // proved that only while `vector` was an inline arrow. objectui#8678 made the
  // last four inline entries named renderers, because they now draw
  // `EmptyValue`, which holds a hook, and that is this card's own reason. With
  // no inline entry left, the rebuild cannot be seen through identity. The
  // property this describe exists for is now pinned for EVERY registered type
  // by `cellRenderers.valueIndependent-8678`, so a new inline entry goes red by
  // name. On a memoised resolver an inline arrow would be harmless, so that pin
  // measures the observable React actually keys on.
});
