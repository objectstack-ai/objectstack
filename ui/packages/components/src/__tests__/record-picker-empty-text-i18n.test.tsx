/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:record_picker.emptyText` resolves the inline locale map the contract
 * admits (objectui#5590).
 *
 * `@objectstack/spec` widened this key to the `I18nLabel` union at 17.0.0-rc.6
 * and the installed 17.0.0 GA still carries it — measured, not assumed:
 * `ElementRecordPickerPropsSchema.safeParse({ object: 'account', emptyText: { en, 'zh-CN' } })`
 * succeeds, and the shape resolves to `optional(union(string, record))`. The
 * renderer honoured only the string arm, passing the map straight into a text
 * node.
 *
 * ## Red-first — what the map arm did before the fix
 *
 * Not a mis-render: React REFUSES a plain object in a child position rather
 * than stringifying it, so the whole picker subtree threw
 *
 * ```
 * Objects are not valid as a React child (found: object with keys {en, zh-CN}).
 * ```
 *
 * — byte-identical to the pre-fix harm `inline-locale-label-read-sites.test.tsx`
 * measured for `schema.label`, which is the same class one key over. Measured
 * on this renderer before the fix and again by mutating the fix away; both runs
 * are quoted in the PR body.
 *
 * ## Why the second locale is load-bearing, not decoration
 *
 * This file's own `toText()` helper already reaches `o.en` as its fourth
 * fallback, so a case that only ever asserts the ENGLISH string would pass
 * against a `toText`-based "fix" that ignores the active language entirely.
 * The `zh-CN` case is the one that separates real locale resolution
 * (`pickLocalized`) from an `.en` pick, so it is the assertion that pins the
 * helper choice the inherited ruling names.
 *
 * No adapter is provided: with none, the fetch effect parks and `rows` stays
 * empty, which is exactly the branch that renders `emptyText` (the disposition
 * `page-variables.test.tsx` already relies on for this block).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';
// Registers `element:record_picker` at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

/** The inline locale map an author writes; `zh-CN` exists so a switch is observable. */
const INLINE_MAP = { en: 'None', 'zh-CN': '无记录' } as const;

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

describe('element:record_picker — emptyText accepts the inline locale map (objectui#5590)', () => {
  it('renders the empty-state branch at all (reachability before absence)', () => {
    // Without this, every "the text is X" assertion below would be satisfied
    // just as well by a picker that rendered no empty state — or no picker.
    renderPicker({ object: 'account' });
    expect(screen.getByTestId('record-picker')).toBeInTheDocument();
    // The bundle's `common.noData` since objectui#12910 (was "No records").
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('resolves the map to the active language — the case that THREW before', () => {
    renderPicker({ object: 'account', emptyText: INLINE_MAP }, 'zh-CN');
    expect(screen.getByText('无记录')).toBeInTheDocument();
  });

  it('resolves the SAME map differently for a different language', () => {
    // The half a `.en`-only pick (this file's `toText`) would also pass; kept
    // paired with the case above, which it would not.
    renderPicker({ object: 'account', emptyText: INLINE_MAP }, 'en');
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('falls back from a region tag to the base language the author wrote', () => {
    // Author wrote `zh`; viewer is `zh-CN`. Pins a limb past "exact match", so a
    // resolver that only ever hit the exact key could not satisfy this file.
    renderPicker({ object: 'account', emptyText: { en: 'None', zh: '无记录' } }, 'zh-CN');
    expect(screen.getByText('无记录')).toBeInTheDocument();
  });

  it('passes a plain string through unchanged, in any language', () => {
    // CONTROL, same key and same render site as the probes: capable of failing
    // — a resolution that mangled the string arm turns this red.
    renderPicker({ object: 'account', emptyText: 'Nothing here' }, 'zh-CN');
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('draws the active language\'s default for an ABSENT key', () => {
    // CONTROL for the ordering choice at the read site: the default is applied
    // before resolution, so an absent key still means the default. Edited
    // deliberately by objectui#12910: this case rendered the English
    // "No records" under zh-CN, the defect that card closes. The default is
    // now the bundle's `common.noData`, so a zh-CN viewer reads 暂无数据.
    renderPicker({ object: 'account' }, 'zh-CN');
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
    expect(screen.queryByText('No records')).toBeNull();
  });

  it('renders an authored empty string as empty, not as the default', () => {
    // The other half of that ordering choice, and the one a `||` default would
    // silently break: `''` is a legal string under the contract and an author
    // who writes it is asking for no text, not for the default ("No data").
    const { container } = renderPicker({ object: 'account', emptyText: '' }, 'en');
    expect(screen.queryByText('No data')).toBeNull();
    expect(container.querySelector('p.text-xs')?.textContent).toBe('');
  });
});
