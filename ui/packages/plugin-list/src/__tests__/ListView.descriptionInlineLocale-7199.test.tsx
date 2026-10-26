/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The view description resolves the inline locale map — objectui#7199, half two.
 *
 * ## The defect this pins
 *
 * `ListViewSchema.description` is `I18nLabel` — a plain string **OR** an inline
 * locale map (`{ en, 'zh-CN' }`), measured against the `@objectstack/spec@17.2.0`
 * dist this repo installs: `ListViewSchema.safeParse` ACCEPTS both and rejects a
 * number and a nested object at that key. The read site rendered
 *
 *     typeof schema.description === 'string' ? schema.description : ''
 *
 * which is not a resolution but a type test, and its else-arm is the empty
 * string. So a map — metadata the contract entitles an author to write —
 * rendered a BLANK strip in every locale.
 *
 * ## Why it is worth its own file rather than a case in `ListView.test.tsx`
 *
 * It is the second route to objectui#7199's reported symptom, and the reason
 * that card could not be closed by relaying the value alone: with only the
 * relay fixed (`app-shell`'s `fullSchema`), a per-view locale-map description
 * arrives correctly and still renders nothing — the identical silent blank, one
 * layer down. A card that closes while its symptom still reproduces stops being
 * findable, so both halves ship together and both are pinned.
 *
 * The blank is also invisible to the compiler: the else-arm is well-typed, so
 * no type error existed before the fix and none appears if it is reverted.
 * Nothing but an executed assertion holds this site.
 *
 * ## The guard moved from the RAW value to the RESOLVED one
 *
 * `{schema.description && …}` admitted `{}` — a truthy object — and rendered an
 * empty strip. The guard now reads the resolved string, so a map with no usable
 * entry drops the element entirely. That is asserted below, not just described:
 * it is the one behaviour change beyond the map arm.
 *
 * ## Which resolver, and why
 *
 * `pickLocalized` (`@object-ui/i18n`) — the spelling a TEXT NODE wants, `''` on
 * a miss. It is the same helper `TabBar.tsx` resolves the sibling `label` with
 * (`ListViewSchema.label` is the same `I18nLabel` type), one component tree
 * away. The nested `aria.ariaLabel` read site next door deliberately uses the
 * spec's `resolveI18nLabel` instead, for its `undefined`, because an ATTRIBUTE
 * wants omission rather than an empty name. The split is by DESTINATION, and
 * the two agree limb for limb — pinned by `i18nLabel-resolver-parity.test.ts`
 * in this package. ⛔ Neither is hand-rolled here.
 *
 * ## Direction and counts, written before the run (reverse verification)
 *
 * Restoring the `typeof` test at the read site was PREDICTED to turn the four
 * map cases RED (the resolved text absent; for the empty map, the strip present
 * rather than dropped) and to leave the five string-arm / suppression cases
 * GREEN — the string arm never touched the union's second limb, so it is the
 * negative control and cannot tell the two worlds apart. Predicted 4 red / 5
 * passing. Measured outcome is recorded on the PR.
 *
 * ## Locale channel
 *
 * `useDisplayLocale()` composes tenant locale → active UI language → `'en'`.
 * `LocalizationProvider` drives its first limb, pinning the locale
 * deterministically without registering a react-i18next global instance —
 * the same channel `ListView.ariaLabelInlineLocale.test.tsx` uses.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
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

/**
 * The map an author writes. Both entries are distinct sentences so a resolver
 * that only ever answered one of them fails a case instead of passing two.
 */
const INLINE_MAP = {
  en: 'Open and in-progress work only.',
  'zh-CN': '仅未完成的工作。',
} as const;

function renderDescription(
  description: unknown,
  locale: string,
  extra: Record<string, unknown> = {},
) {
  const schema = {
    type: 'list-view',
    objectName: 'tasks',
    viewType: 'grid',
    columns: ['name'],
    ...(description === undefined ? {} : { description }),
    ...extra,
  } as ListViewSchema;

  return render(
    <LocalizationProvider value={{ locale }}>
      <SchemaRendererProvider dataSource={mockDataSource as unknown as DataSource}>
        <ListView schema={schema} />
      </SchemaRendererProvider>
    </LocalizationProvider>,
  );
}

afterEach(() => cleanup());

describe('ListView view description resolves the inline locale map (objectui#7199)', () => {
  /* ── The map arm: what was broken ─────────────────────────────────────── */

  describe('the map arm', () => {
    it('renders the sentence for the audience locale, not a blank strip', () => {
      renderDescription(INLINE_MAP, 'zh-CN');

      expect(screen.getByTestId('view-description-info')).toHaveAttribute('title', '仅未完成的工作。');
      // Stated separately because the empty string is the exact thing the
      // `typeof` else-arm produced: the element WAS in the DOM, carrying
      // nothing, which is why the author had no way to notice.
      expect(screen.getByTestId('view-description-info').getAttribute('title')).not.toBe('');
    });

    it('resolves the same map differently for a different locale', () => {
      renderDescription(INLINE_MAP, 'en');

      expect(screen.getByTestId('view-description-info')).toHaveAttribute('title', 
        'Open and in-progress work only.',
      );
      // A resolver that always answered one entry would pass the case above
      // and fail here.
      expect(screen.queryByText('仅未完成的工作。')).toBeNull();
    });

    it('follows the base-language limb of the resolver rule', () => {
      // Author wrote only `zh`; the audience is `zh-CN`. The six-limb rule is
      // the shared resolver's own and is pinned limb-for-limb in this package
      // by `i18nLabel-resolver-parity.test.ts` — asserted here only to show the
      // rule genuinely reaches this read site.
      renderDescription({ en: 'Open work only.', zh: '仅未完成。' }, 'zh-CN');

      expect(screen.getByTestId('view-description-info')).toHaveAttribute('title', '仅未完成。');
    });

    it('drops the strip entirely when the map matches nothing', () => {
      // `{}` is TRUTHY, so the pre-fix guard admitted it and rendered an empty
      // grey strip. The guard now reads the RESOLVED text, so a miss removes
      // the element rather than reserving blank space for it.
      renderDescription({}, 'en');

      expect(screen.queryByTestId('view-description-info')).not.toBeInTheDocument();
    });
  });

  /* ── The string arm: the negative control ─────────────────────────────── */

  describe('the string arm (negative control — unchanged by this fix)', () => {
    it('passes a plain string through unchanged', () => {
      renderDescription('Open and in-progress work only.', 'zh-CN');

      expect(screen.getByTestId('view-description-info')).toHaveAttribute('title', 
        'Open and in-progress work only.',
      );
    });

    it('passes a plain string through unchanged for every locale', () => {
      renderDescription('Open and in-progress work only.', 'en');

      expect(screen.getByTestId('view-description-info')).toHaveAttribute('title', 
        'Open and in-progress work only.',
      );
    });

    it('renders nothing when no description is authored', () => {
      renderDescription(undefined, 'en');

      expect(screen.queryByTestId('view-description-info')).not.toBeInTheDocument();
    });
  });

  /* ── The author's opt-out still wins over both arms ───────────────────── */

  describe('appearance.showDescription: false still suppresses', () => {
    it('suppresses a plain-string description', () => {
      renderDescription('Open and in-progress work only.', 'en', {
        appearance: { showDescription: false },
      });

      expect(screen.queryByTestId('view-description-info')).not.toBeInTheDocument();
    });

    it('suppresses a resolved locale-map description', () => {
      // The case the fix could have broken: resolving the map first must not
      // route around the opt-out. `showDescription` defaults to `true`
      // (measured on `@objectstack/spec@17.2.0`: an `appearance: {}` parses to
      // `{ showDescription: true }`), so only an explicit `false` suppresses —
      // which is why objectui#7199 records no missing author opt-in.
      renderDescription(INLINE_MAP, 'zh-CN', {
        appearance: { showDescription: false },
      });

      expect(screen.queryByTestId('view-description-info')).not.toBeInTheDocument();
    });
  });
});
