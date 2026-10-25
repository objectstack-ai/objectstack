/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list region's accessible name resolves the inline locale map — objectui#5134.
 *
 * ## The defect this pins
 *
 * `@objectstack/spec`'s `AriaPropsSchema` types `ariaLabel` as `I18nLabel`,
 * i.e. a plain string **OR** an inline locale map, and this component's read
 * site spread it into the DOM with `as string`. A cast is not a conversion, so
 * a map-valued `aria.ariaLabel` reached the DOM as
 * `aria-label="[object Object]"` — the string a screen reader then announces as
 * the view's accessible name, in every locale.
 *
 * The map form is spec-valid metadata that arrives via API/import (the closing
 * ruling on objectui#4163 recorded it as legitimate), so this is a live path,
 * even though no measured author writes one today.
 *
 * ## Why the earlier sweep missed it, and why this file exists
 *
 * objectui#4163 part 1 swept the sites the compiler could name. `as string`
 * is invisible to the compiler by construction — that is the whole point of a
 * cast — so no type error existed to sweep, and none would appear if the fix
 * were reverted. Nothing but an executed assertion can hold this site.
 *
 * ## Assertions are on the ACCESSIBLE NAME, not the attribute string
 *
 * `getByRole('region', { name })` matches on the a11y tree's computed name,
 * which is the thing the defect corrupts. `aria-label="[object Object]"` is a
 * region NAMED `[object Object]`, so a query for the real name simply does not
 * match it. A raw `getAttribute` check is kept alongside only where absence of
 * the attribute is the claim.
 *
 * ## Direction, written before the run (reverse verification)
 *
 * Restoring `schema.aria.ariaLabel as string` at the read site was PREDICTED to
 * turn the three map cases RED (`[object Object]` as the name, so the queried
 * name does not exist) and the empty-map case RED (the attribute present rather
 * than omitted, since `{}` is truthy), while leaving every string-arm case
 * GREEN — the string arm is the negative control and never touched the union's
 * second limb. Measured outcome is recorded on the PR.
 *
 * ## Locale channel
 *
 * `useDisplayLocale()` composes tenant locale → active UI language → `'en'`.
 * `LocalizationProvider` drives its first limb, which pins the locale
 * deterministically without registering a react-i18next global instance — the
 * hazard that forces `ListView.overlayTitleNoProviderFallback.test.tsx` into
 * its own file.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are partial stubs carrying only the members the path under test calls;
 * completing them would change which capability probes fire, and so would
 * change what these tests measure.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

const mockDataSource = {
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

/** The map an author writes; `zh-CN` exists so a locale switch is observable. */
const INLINE_MAP = { en: 'Accounts', 'zh-CN': '客户' } as const;

function renderListView(aria: unknown, locale: string) {
  const schema = {
    type: 'list-view',
    objectName: 'accounts',
    viewType: 'grid',
    columns: ['name'],
    ...(aria === undefined ? {} : { aria }),
  } as ListViewSchema;

  return render(
    <LocalizationProvider value={{ locale }}>
      <SchemaRendererProvider dataSource={mockDataSource as unknown as DataSource}>
        <ListView schema={schema} />
      </SchemaRendererProvider>
    </LocalizationProvider>,
  );
}

/** The list region is the root node ListView renders (`role` defaults to `region`). */
const regionEl = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe('ListView nested aria.ariaLabel resolves the inline locale map (#5134)', () => {
  /* ── The map arm: what was broken ─────────────────────────────────────── */

  describe('the map arm', () => {
    it('announces the string for the audience locale, not [object Object]', () => {
      const { container } = renderListView({ ariaLabel: INLINE_MAP }, 'zh-CN');

      expect(screen.getByRole('region', { name: '客户' })).toBeInTheDocument();
      // Stated separately because `[object Object]` is the exact byte sequence
      // the cast produced, and it is what a screen reader read aloud.
      expect(regionEl(container).getAttribute('aria-label')).toBe('客户');
      expect(regionEl(container).getAttribute('aria-label')).not.toBe('[object Object]');
      cleanup();
    });

    it('resolves the same map differently for a different locale', () => {
      renderListView({ ariaLabel: INLINE_MAP }, 'en');

      expect(screen.getByRole('region', { name: 'Accounts' })).toBeInTheDocument();
      // A resolver that only ever answered one entry would pass the case above
      // and fail here.
      expect(screen.queryByRole('region', { name: '客户' })).toBeNull();
      cleanup();
    });

    it('follows the region to base-language limb of the resolver rule', () => {
      // Author wrote only `zh`; the audience is `zh-CN`. The six-limb rule is
      // the spec resolver's own and is pinned limb-for-limb in this package by
      // `i18nLabel-resolver-parity.test.ts` — asserted here only to show the
      // rule genuinely reaches this read site.
      renderListView({ ariaLabel: { en: 'Accounts', zh: '客户' } }, 'zh-CN');

      expect(screen.getByRole('region', { name: '客户' })).toBeInTheDocument();
      cleanup();
    });
  });

  /* ── The string arm: the negative control ─────────────────────────────── */

  describe('the string arm (negative control — unchanged by this fix)', () => {
    it('passes a plain string through unchanged', () => {
      const { container } = renderListView({ ariaLabel: 'Accounts' }, 'zh-CN');

      expect(screen.getByRole('region', { name: 'Accounts' })).toBeInTheDocument();
      expect(regionEl(container).getAttribute('aria-label')).toBe('Accounts');
      cleanup();
    });

    it('passes a plain string through unchanged for every locale', () => {
      const { container } = renderListView({ ariaLabel: 'Accounts' }, 'en');

      expect(regionEl(container).getAttribute('aria-label')).toBe('Accounts');
      cleanup();
    });

    it('omits the attribute for an empty string, exactly as before', () => {
      // `''` is a label an author wrote, but it names nothing; the pre-existing
      // truthiness guard dropped it and still does.
      const { container } = renderListView({ ariaLabel: '' }, 'en');

      expect(regionEl(container).hasAttribute('aria-label')).toBe(false);
      cleanup();
    });
  });

  /* ── Absence and misses omit the attribute ────────────────────────────── */

  describe('absence and misses', () => {
    it('omits the attribute when no aria bag is authored', () => {
      const { container } = renderListView(undefined, 'en');

      expect(regionEl(container).hasAttribute('aria-label')).toBe(false);
      cleanup();
    });

    it('omits the attribute when the map matches nothing', () => {
      // `{}` is TRUTHY, so the pre-fix guard admitted it and rendered
      // `[object Object]`. A miss resolves to `undefined` here and the
      // attribute is dropped: an unnamed region beats a garbage-named one.
      const { container } = renderListView({ ariaLabel: {} }, 'en');

      expect(regionEl(container).hasAttribute('aria-label')).toBe(false);
      cleanup();
    });
  });
});
