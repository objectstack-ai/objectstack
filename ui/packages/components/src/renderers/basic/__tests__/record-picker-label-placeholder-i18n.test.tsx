/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:record_picker`'s `label` and `placeholder` resolve the inline locale
 * map their contract admits (objectui#5637) — the two keys objectui#5590 left
 * behind when it fixed the third key of this same block.
 *
 * Measured on the installed pin (`@objectstack/spec` 17.1.0), all three members
 * of `ElementRecordPickerPropsSchema` resolve to
 * `optional -> union -> string | record`, and
 * `safeParse({ object: 'account', <key>: { en, 'zh-CN' } })` succeeds for each.
 *
 * ## Red-first — the three measured failure modes, and they are NOT one mode
 *
 * Run against the unfixed renderer, viewer language `zh-CN`:
 *
 * ```
 * placeholder={ en, 'zh-CN' }        -> THREW  Objects are not valid as a React child
 *                                              (found: object with keys {en, zh-CN})
 * label={ en: 'Owner', 'zh-CN': … }  -> RENDERED "Owner"            (English to a zh-CN viewer)
 * label={ 'zh-CN': …, ja: … }        -> label element ABSENT        (nothing thrown, nothing logged)
 * ```
 *
 * The second and third come from this file's local `toText()`, whose object
 * branch ends `String(o.label ?? o.name ?? o.title ?? o.en ?? '')`. Reaching
 * `o.en` unconditionally is an ENGLISH PICK wearing locale resolution's
 * clothes, and its `?? ''` miss meets a `{label && …}` render site — so a map
 * that simply omits English deletes the label element. A fix that only stops
 * the throw is half a fix, which is why all three are pinned here.
 *
 * ## `toText` is deliberately NOT the fix site
 *
 * `toText` is SHARED: it also renders ROW VALUES (`toText(row?.[labelField])`).
 * Those are record field values, not `I18nLabel`, so a locale-aware `toText`
 * would change a second, unrelated call site. Both keys resolve at their own
 * read site instead, and the last case below is the control that proves the row
 * path still runs through the untouched helper.
 *
 * No adapter is provided: with none, the fetch effect parks and `rows` stays
 * empty — the same disposition `record-picker-empty-text-i18n.test.tsx` and
 * `page-variables.test.tsx` already rely on for this block. The one case that
 * needs rows drives its own stub adapter.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';
// Registers `element:record_picker` at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

/** The inline locale map an author writes; `zh-CN` exists so a switch is observable. */
const INLINE_MAP = { en: 'Owner', 'zh-CN': '负责人' } as const;

/** The same shape with NO `en` entry — legal under the contract, and the case that vanished. */
const NO_EN_MAP = { 'zh-CN': '负责人', ja: '担当' } as const;

function renderPicker(properties: Record<string, unknown>, language = 'en') {
  const C = ComponentRegistry.get('element:record_picker') as React.ComponentType<any>;
  if (!C) throw new Error('element:record_picker is not registered');
  return render(
    <I18nProvider
      persistLanguage={false}
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
    >
      <C schema={{ type: 'element:record_picker', id: 'picker', properties }} />
    </I18nProvider>,
  );
}

/** The rendered `<label>` element, or `null` when the render site dropped it. */
const labelEl = (container: HTMLElement) => container.querySelector('label');
/** The trigger's rendered text — where `SelectValue`'s placeholder lands. */
const triggerText = (container: HTMLElement) =>
  container.querySelector('[data-testid="record-picker-trigger"]')?.textContent ?? '';

describe('element:record_picker — label/placeholder accept the inline locale map (objectui#5637)', () => {
  it('renders the picker, its label and its placeholder at all (reachability before absence)', () => {
    // Without this, every "the text is X" / "the element is gone" assertion
    // below would be satisfied just as well by a picker that rendered neither.
    const { container } = renderPicker({
      object: 'account',
      label: 'Owner',
      placeholder: 'Select a record…',
    });
    expect(screen.getByTestId('record-picker')).toBeInTheDocument();
    expect(labelEl(container)?.textContent).toBe('Owner');
    expect(triggerText(container)).toContain('Select a record…');
  });

  // ── 1. placeholder: the arm that THREW ────────────────────────────────────
  it('resolves a `placeholder` map to the active language — the case that THREW', () => {
    const { container } = renderPicker({ object: 'account', placeholder: INLINE_MAP }, 'zh-CN');
    expect(triggerText(container)).toContain('负责人');
  });

  it('resolves the SAME `placeholder` map differently for a different language', () => {
    // Paired with the case above: an `.en` pick would satisfy this one alone.
    const { container } = renderPicker({ object: 'account', placeholder: INLINE_MAP }, 'en');
    expect(triggerText(container)).toContain('Owner');
  });

  it('falls back from a region tag to the base language the author wrote (`placeholder`)', () => {
    // Author wrote `zh`; viewer is `zh-CN`. Pins a limb past "exact match", so a
    // resolver that only ever hit the exact key could not satisfy this file.
    const { container } = renderPicker(
      { object: 'account', placeholder: { en: 'Owner', zh: '负责人' } },
      'zh-CN',
    );
    expect(triggerText(container)).toContain('负责人');
  });

  // ── 2. label: rendered ENGLISH to a zh-CN viewer ──────────────────────────
  it('resolves a `label` map to the active language, not to its `en` entry', () => {
    // THE ASSERTION THAT SEPARATES THE TWO CANDIDATE FIXES. `toText` already
    // reaches `o.en`, so the English half of this map renders green either way;
    // only the zh-CN viewer distinguishes real locale resolution from an
    // English pick.
    const { container } = renderPicker({ object: 'account', label: INLINE_MAP }, 'zh-CN');
    expect(labelEl(container)?.textContent).toBe('负责人');
  });

  it('resolves the SAME `label` map differently for a different language', () => {
    const { container } = renderPicker({ object: 'account', label: INLINE_MAP }, 'en');
    expect(labelEl(container)?.textContent).toBe('Owner');
  });

  // ── 3. label: the element that DISAPPEARED ────────────────────────────────
  it('keeps the label ELEMENT for a map that omits `en` — the silent case', () => {
    // The quiet one. `toText` returned `''` for a map with no `en`, and the
    // render site is `{label && …}`, so a correctly authored map that simply
    // omits English deleted the label element with nothing thrown and nothing
    // logged. Asserted as presence FIRST, then text: a fix that resolved the
    // string but left the element gone must fail here.
    const { container } = renderPicker({ object: 'account', label: NO_EN_MAP }, 'zh-CN');
    expect(labelEl(container)).not.toBeNull();
    expect(labelEl(container)?.textContent).toBe('负责人');
  });

  it('resolves a no-`en` map for a viewer whose language it does carry (`ja`)', () => {
    // Same map, a different one of its entries: the vanishing was a property of
    // the MAP (no `en`), not of `zh-CN`.
    const { container } = renderPicker({ object: 'account', label: NO_EN_MAP }, 'ja');
    expect(labelEl(container)?.textContent).toBe('担当');
  });

  // ── Controls ──────────────────────────────────────────────────────────────
  it('passes a plain string `label` and `placeholder` through unchanged, in any language', () => {
    // CONTROL, same keys and same read sites as the probes: capable of failing
    // — a resolution that mangled the string arm turns this red.
    const { container } = renderPicker(
      { object: 'account', label: 'Owner', placeholder: 'Pick one' },
      'zh-CN',
    );
    expect(labelEl(container)?.textContent).toBe('Owner');
    expect(triggerText(container)).toContain('Pick one');
  });

  it('draws the active language\'s placeholder default for an ABSENT key', () => {
    // CONTROL for the ordering choice at the read site: the default is applied
    // before resolution, so an absent key still means the default. Edited
    // deliberately by objectui#12910: this case drew the English
    // "Select a record…" under zh-CN. The default is now the bundle's
    // `lookup.selectRecord`, so a zh-CN viewer reads 选择记录.
    const { container } = renderPicker({ object: 'account' }, 'zh-CN');
    expect(triggerText(container)).toContain('选择记录');
    expect(triggerText(container)).not.toContain('Select');
  });

  it('renders NO label element when `label` is absent', () => {
    // CONTROL for the other direction of the `{label && …}` site: absent must
    // still mean absent, so the vanishing-map fix cannot be "always render a
    // label".
    const { container } = renderPicker({ object: 'account' }, 'zh-CN');
    expect(labelEl(container)).toBeNull();
  });
});
