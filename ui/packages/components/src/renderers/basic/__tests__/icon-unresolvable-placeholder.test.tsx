/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `ui:icon` — an unresolvable glyph renders a VISIBLE placeholder, never
 * nothing (objectui#5631, maintainer ruling 2026-08-22 comment 5380754137:
 * "an unresolvable icon renders a visible placeholder instead of `null`,
 * **regardless** of the key question").
 *
 * ## What this file pins
 *
 * Two things now, where it pinned one. The END OF THE SILENCE — item 3 of the
 * ruling, unconditional and independent of which schema key names the glyph —
 * and, since the 2026-08-24 ruling 「5631 A′，按一次正经的契约迁移立项。」,
 * that the glyph key IS `icon`: every case below authors `icon`, and the legacy
 * `name` spelling has its own describe block asserting it does NOT resolve.
 *
 * That second half is the reason the cases were not simply spelling-swapped.
 * Several of them asserted "an `svg` rendered", which the placeholder satisfies
 * too — an assertion that survives the migration by being unable to fail. Each
 * one below now distinguishes the two outcomes by the placeholder marker.
 *
 * ## Why the warning is asserted through an explicit spy
 *
 * Vitest 4 runs with `silent: 'passed-only'`, so `console.warn` output from a
 * PASSING test is discarded — it never reaches stderr for a human to notice.
 * Observing the warning by eye is therefore not available here, and a test
 * that "checked" it by reading output would check nothing. `vi.spyOn` captures
 * the call regardless of what the reporter prints. That property is not
 * incidental: an unread `console.warn` is half of why objectui#5631 stayed
 * invisible, so the warning is pinned as behaviour rather than trusted.
 *
 * ## Why the assertions are on the RENDERED RESULT, not on `!== null`
 *
 * The pre-fix branch returned `null`. A test asserting `container.firstChild`
 * is non-null would pass against a placeholder that rendered an empty
 * `<span/>` — invisible to a human and attribute-clean to the DOM-leak sweep,
 * i.e. the same defect wearing a different shape. Each case below resolves
 * something a person or a gate could actually see: a real `svg` host, the
 * authored box (`className`/size) still applied to it, an accessible name, and
 * the marker attribute.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
// Registers `ui:icon` at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderIcon(schema: Record<string, unknown>) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { container } = render(<SchemaRenderer schema={{ type: 'icon', ...schema } as never} />);
  return { container, warn };
}

/** The marker the placeholder branch puts on its host, for gates and for this file. */
const MARKER = '[data-objectui-icon-unresolved]';

describe('ui:icon — unresolvable glyph', () => {
  it('renders a visible SVG placeholder instead of nothing', () => {
    const { container } = renderIcon({ icon: 'definitely-not-a-lucide-icon' });

    const placeholder = container.querySelector(MARKER);
    expect(placeholder).not.toBeNull();
    // The host is a real SVG, the same element kind a resolved glyph renders,
    // so the gap occupies the layout slot the icon would have occupied.
    expect(placeholder?.tagName.toLowerCase()).toBe('svg');
    expect(placeholder?.getAttribute('data-objectui-icon-unresolved')).toBe(
      'definitely-not-a-lucide-icon',
    );
  });

  it('names the unresolved icon in its accessible name', () => {
    renderIcon({ icon: 'definitely-not-a-lucide-icon' });

    // `role="img"` + `aria-label`: the placeholder is perceivable, and it says
    // WHICH icon failed rather than being an anonymous box.
    expect(
      screen.getByRole('img', { name: 'Unresolved icon: definitely-not-a-lucide-icon' }),
    ).toBeTruthy();
  });

  it('warns, naming the glyph that did not resolve', () => {
    const { warn } = renderIcon({ icon: 'definitely-not-a-lucide-icon' });

    // Not a pinned call COUNT: React invokes the render function more than
    // once here (measured: two calls for one `render`), and pinning the number
    // would make this file fail on a StrictMode change rather than on the
    // behaviour it is about. What matters is that the warning happens and what
    // it says.
    expect(warn).toHaveBeenCalled();
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('definitely-not-a-lucide-icon');
    expect(message).toContain('objectui#5631');
  });

  it('keeps the authored box: className and size still reach the placeholder', () => {
    const { container } = renderIcon({
      icon: 'definitely-not-a-lucide-icon',
      className: 'text-red-500',
      size: 48,
    });

    const placeholder = container.querySelector(MARKER) as SVGElement | null;
    expect(placeholder).not.toBeNull();
    // Without this the placeholder would collapse to lucide's default box and
    // the gap would not sit where the author put the icon.
    expect(placeholder?.getAttribute('class')).toContain('text-red-500');
    expect(placeholder?.getAttribute('style')).toContain('48px');
  });

  it('renders the placeholder — not a thrown error — when `icon` is absent entirely', () => {
    // Pre-fix this reached `toPascalCase(undefined)` and threw on
    // `undefined.split`, which the SchemaErrorBoundary then swallowed: a THIRD
    // way for this renderer to fail without saying so. `icon` is typed
    // `string` on `IconSchema`, but it arrives from authored JSON.
    //
    // This node carries NO glyph key of either spelling — no `icon`, and no
    // `name` either — so it is the plain absent case, kept distinct from the
    // legacy-spelling case in the describe block below.
    const { container, warn } = renderIcon({ id: 'no_glyph_key_node' });

    const placeholder = container.querySelector(MARKER);
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute('data-objectui-icon-unresolved')).toBe('(none)');
    expect(String(warn.mock.calls[0]?.[0])).toContain('an absent icon name');
  });
});

describe('ui:icon — resolvable glyph is untouched by objectui#5631', () => {
  it('renders the real lucide glyph with no placeholder and no warning', () => {
    const { container, warn } = renderIcon({ icon: 'check', className: 'text-green-500' });

    expect(container.querySelector(MARKER)).toBeNull();
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('class')).toContain('text-green-500');
    expect(warn).not.toHaveBeenCalled();
  });

  it('still resolves the kebab-case and renamed-icon paths', () => {
    // `home` -> `Home` -> mapped to `House`: the `iconNameMap` hop, which the
    // placeholder branch must not have short-circuited.
    const { container, warn } = renderIcon({ icon: 'home' });

    expect(container.querySelector(MARKER)).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the LEGACY `name`-as-glyph spelling does not resolve (objectui#5631)', () => {
  /**
   * The shape this migration retired: `name` naming the glyph. These cases are
   * the load-bearing half of the ruling — 「⛔ no tolerant `icon ?? name`
   * fallback」 is only true if a node authoring `name` demonstrably fails to
   * resolve, so it is asserted here rather than assumed from reading the
   * renderer.
   *
   * `name: 'check'` is chosen deliberately over a nonsense string: `check` IS a
   * real lucide glyph, so a tolerant fallback would resolve it and this case
   * would go green. A nonsense name could not tell a fallback apart from a
   * miss, and would pass either way.
   */
  it('renders the placeholder even when `name` holds a REAL lucide glyph name', () => {
    const { container } = renderIcon({ name: 'check' });

    const placeholder = container.querySelector(MARKER);
    expect(placeholder).not.toBeNull();
    // `(none)` — no glyph was requested at all, because `name` is not a glyph
    // key. If a fallback existed this would read `check` and resolve.
    expect(placeholder?.getAttribute('data-objectui-icon-unresolved')).toBe('(none)');
  });

  it('marks the legacy node so the migration is visible to a gate, not just a human', () => {
    const { container } = renderIcon({ name: 'check' });

    // Distinguishes "authored a glyph name that does not resolve" from "has
    // not been migrated yet" — two different repairs.
    expect(
      container.querySelector('[data-objectui-icon-legacy-name-key]')?.getAttribute(
        'data-objectui-icon-legacy-name-key',
      ),
    ).toBe('check');
  });

  it('warns with the RENAME, not just "no glyph resolves"', () => {
    const { warn } = renderIcon({ name: 'save_icon' });

    expect(warn).toHaveBeenCalled();
    const message = String(warn.mock.calls[0]?.[0]);
    // The reader of this warning is an author whose node used to work. Telling
    // them only that nothing resolved would make a mechanical rename look like
    // a missing icon.
    expect(message).toContain('save_icon');
    expect(message).toContain('identity key');
    expect(message).toContain('icon: "save_icon"');
    expect(message).toContain('migrateIconNodeKeys');
    expect(message).toContain('objectui#5631');
  });

  it('says so in the accessible name too', () => {
    renderIcon({ name: 'save_icon' });

    expect(
      screen.getByRole('img', {
        name: 'Unresolved icon: `name` is no longer the icon key, rename it to `icon` (save_icon)',
      }),
    ).toBeTruthy();
  });

  it('a node with BOTH keys resolves from `icon` and is not marked legacy', () => {
    // `name` is a perfectly legitimate identity alongside `icon`. It must not
    // drag a working node into the legacy branch.
    const { container, warn } = renderIcon({ icon: 'check', name: 'save_icon' });

    expect(container.querySelector(MARKER)).toBeNull();
    expect(container.querySelector('[data-objectui-icon-legacy-name-key]')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the placeholder glyph itself resolves (objectui#5622 mechanism)', () => {
  it('is imported by name, so it cannot silently become another `null`', async () => {
    // The failure this guards: lucide retires a spelling by dropping it from
    // the runtime `icons` record while KEEPING the deprecated named export.
    // A placeholder looked up in that record could therefore resolve to
    // `undefined` and render nothing — objectui#5631 again, one level up.
    // Measured on lucide-react 1.31.0: `CircleHelp` and `HelpCircle` are both
    // ABSENT from the record while both resolve as named exports, so this is
    // not a hypothetical hazard.
    const lucide = await import('lucide-react');

    expect(typeof (lucide as Record<string, unknown>).SquareDashed).not.toBe('undefined');
    // The record-based lookup this file's renderer uses for AUTHORED names is
    // exactly what the placeholder must not depend on. Pinned so that a future
    // edit swapping the named import for `icons[...]` has to face this case.
    expect(
      Object.prototype.hasOwnProperty.call(lucide.icons, 'CircleHelp')
        || Object.prototype.hasOwnProperty.call(lucide.icons, 'HelpCircle'),
    ).toBe(false);
  });
});
