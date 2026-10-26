/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:breadcrumb` resolves an item's authored `icon` to a glyph (objectui#5931).
 *
 * `BreadcrumbItem.icon` has been a declared, published key of the protocol
 * (`packages/types/src/navigation.ts`, mirrored in `zod/navigation.zod.ts`,
 * documented in `content/docs/components/data-display/breadcrumb.mdx`) and is
 * authored by the catalog fixture literally named `with-icons.json` — while
 * `renderers/data-display/breadcrumb.tsx` contained ZERO occurrences of `icon`.
 * The page named "With Icons" rendered none.
 *
 * The sibling repairs are objectui#5930 (`dropdown-menu`) and objectui#6278
 * (`context-menu`); this suite is that shape ported, with the differences below
 * made explicit rather than copied over silently.
 *
 * ## Difference 1 — the defect is an ABSENT render, not a WRONG one
 *
 * `dropdown-menu` rendered the authored string into a text node, so its
 * load-bearing assertion could be `queryByText('copy')` — the word was on
 * screen. This renderer never referenced `icon` at all, so it drew NOTHING and
 * `queryByText(name)` is null both before and after the repair. The
 * DISCRIMINATING assertion here is therefore the presence of the RESOLVED
 * GLYPH, and that is what every measurement row asserts. The text direction is
 * still asserted, once, as a REGRESSION guard: it is the exact defect
 * `dropdown-menu` shipped, and a future "repair" that printed the name instead
 * of resolving it would be caught by it and by nothing else here.
 *
 * ## Difference 2 — nothing here mounts lazily, and that is a MEASUREMENT
 *
 * The twins pass `defaultOpen: true` / fire a `contextmenu` event because Radix
 * mounts their content lazily; without it those suites render an empty
 * container and prove nothing. `ui/breadcrumb.tsx` is plain `nav`/`ol`/`li`
 * markup with no Radix root and no open state at all, so its items are in the
 * tree on first render. The harness control below asserts that rather than
 * assuming it — a vacuous container would make every "renders no glyph" row
 * pass for the wrong reason.
 *
 * ## Difference 3 — BOTH arms, and where the icon sits relative to them
 *
 * The renderer splits on position: the LAST crumb is a `BreadcrumbPage`
 * (`<span role="link" aria-current="page">`), every earlier one a
 * `BreadcrumbLink` (`<a>`). Repairing only one would be "a narrower version of
 * the same bug" (objectui#5930), so both are measured as their own rows. The
 * fix resolves once per item and renders the glyph ABOVE that split, inside
 * `BreadcrumbItem`, so neither arm can be forgotten.
 *
 * ## The instrument's positive control
 *
 * Every row scopes to the crumb's own `<li>` and names the glyph by the class
 * lucide derives from the icon's own identity (`svg.lucide-<key>`). A bare
 * `container.querySelector('svg')` would be green in both worlds — the blind
 * instrument this suite must not use — so a separate control establishes that
 * the selector finds a glyph when one IS present: if a `lucide-book` row is red
 * while the control is green, the query works and the authored icon is
 * genuinely absent.
 *
 * ⚠️ That control used to be asserted on THIS renderer's output, because
 * `BreadcrumbSeparator` fell through to a `ChevronRight` in a sibling `<li>`.
 * objectui#6646 aligned the renderer's default separator to the `@default '/'`
 * its declaration has always carried, so no chevron is drawn here any more and
 * the control would have been RED for a reason that has nothing to do with
 * icons. It is preserved by rendering the shadcn PRIMITIVE directly — still a
 * positive control on the selector, and now green in both worlds by
 * construction rather than by a renderer default that was free to change.
 *
 * ## Why lucide is NOT mocked
 *
 * The contract under test is "the authored name is resolved against lucide's
 * runtime `icons` RECORD". Mocking the record would delete the half that
 * matters: that a RETIRED spelling resolves to NOTHING rather than degrading to
 * a wrong glyph. `layout` is that control — a deprecated lucide export whose
 * key is absent from the runtime record (measured on lucide-react 1.31.0, 1767
 * keys; `Layout === PanelsTopLeft` is TRUE, the retired alias is the very same
 * object under a dead name). It is also the spelling this fixture shipped, now
 * corrected to `panels-top-left`. That row is what rules out the `LazyIcon`
 * surface, which would degrade `layout` to the `Database` glyph.
 *
 * ## Why the renderer is invoked DIRECTLY
 *
 * `ComponentRegistry.get(name)` returns the component the registry actually
 * renders; driving through `SchemaRenderer` injects its own props around it and
 * can be green in both directions (PR #4603's toggle case, restated by #4580).
 *
 * ## What this file does NOT own
 *
 * Fixture spelling drift. `with-icons.json`'s names are judged on every run by
 * `scripts/check-lucide-icon-record-names.mjs`, whose census this card's PR
 * extends with a `'breadcrumb'` entry. This suite pins the RENDERER; the gate
 * pins the SPELLINGS.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';
import { BreadcrumbSeparator } from '../ui/breadcrumb';

afterEach(() => cleanup());

function renderCrumbs(items: any[]) {
  const C = ComponentRegistry.get('breadcrumb') as React.ComponentType<any>;
  return render(<C schema={{ type: 'breadcrumb', items }} />);
}

/** The crumb's own `<li>` (`BreadcrumbItem`). The separator is a DIFFERENT `<li>`. */
function crumbFor(label: string): HTMLElement {
  const el = screen.getByText(label).closest('li');
  if (!el) throw new Error(`no <li> ancestor for ${label}`);
  return el as HTMLElement;
}

/** Two crumbs, so the link arm and the page arm are both exercised. */
const TWO = (icon?: string) => [
  { label: 'Home', href: '/', ...(icon ? { icon } : {}) },
  { label: 'Docs', ...(icon ? { icon } : {}) },
];

describe('ui:breadcrumb item icon resolution (objectui#5931)', () => {
  describe('harness controls', () => {
    it('mounts every crumb on first render — nothing here is lazy', () => {
      renderCrumbs(TWO());
      expect(crumbFor('Home')).toBeTruthy();
      expect(crumbFor('Docs')).toBeTruthy();
    });

    it('both arms are the ones the renderer is documented to produce', () => {
      renderCrumbs(TWO());
      // Non-last -> BreadcrumbLink (<a>); last -> BreadcrumbPage (aria-current).
      expect(screen.getByText('Home').closest('a')).not.toBeNull();
      expect(screen.getByText('Docs').closest('[aria-current="page"]')).not.toBeNull();
    });

    it('positive control on the instrument — a queryable svg IS findable', () => {
      // Green in both worlds BY DESIGN, and independent of what `ui:breadcrumb`
      // chooses to draw: the shadcn primitive is rendered DIRECTLY, so this
      // proves the `svg.lucide-*` selector works and a red `lucide-*` row below
      // cannot be misread as a broken query. See the header for why it no
      // longer reads the renderer's own separator (objectui#6646).
      const { container } = render(<BreadcrumbSeparator />);
      expect(container.querySelector('svg.lucide-chevron-right')).not.toBeNull();
    });

    it('…and no glyph leaks into a crumb that authored none', () => {
      // The other half of the old control: the rows below can scope to the
      // crumb's own <li> and stay discriminating because nothing else puts an
      // svg there.
      renderCrumbs(TWO());
      expect(crumbFor('Home').querySelector('svg')).toBeNull();
    });
  });

  describe('BreadcrumbLink arm (every crumb but the last)', () => {
    it('renders the resolved glyph for a live icon name', () => {
      renderCrumbs([{ label: 'Docs', href: '/docs', icon: 'book' }, { label: 'Components' }]);
      // RED before the repair: the crumb contained no svg whatsoever.
      expect(crumbFor('Docs').querySelector('svg.lucide-book')).not.toBeNull();
    });

    it('renders no glyph for a RETIRED spelling — the RECORD surface, not a fallback', () => {
      // Rules out `LazyIcon`, which degrades an unknown name to `Database`.
      renderCrumbs([{ label: 'Docs', href: '/docs', icon: 'layout' }, { label: 'Components' }]);
      expect(crumbFor('Docs').querySelector('svg')).toBeNull();
    });

    it('renders no glyph for an UNKNOWN name', () => {
      renderCrumbs([{ label: 'Docs', href: '/docs', icon: 'not-a-real-icon' }, { label: 'Components' }]);
      expect(crumbFor('Docs').querySelector('svg')).toBeNull();
    });
  });

  describe('BreadcrumbPage arm (the last crumb)', () => {
    it('renders the resolved glyph for a live icon name', () => {
      renderCrumbs([{ label: 'Docs', href: '/docs' }, { label: 'Components', icon: 'panels-top-left' }]);
      // RED before the repair, and red again if only the link arm were fixed.
      expect(crumbFor('Components').querySelector('svg.lucide-panels-top-left')).not.toBeNull();
    });

    it('renders no glyph for a RETIRED spelling', () => {
      renderCrumbs([{ label: 'Docs', href: '/docs' }, { label: 'Components', icon: 'layout' }]);
      expect(crumbFor('Components').querySelector('svg')).toBeNull();
    });

    it('renders no glyph when no icon is authored', () => {
      renderCrumbs(TWO());
      expect(crumbFor('Docs').querySelector('svg')).toBeNull();
    });
  });

  describe('the authored NAME never reaches the DOM as text', () => {
    // Not discriminating here — this renderer never printed the name, so this
    // is null in both worlds. It is the regression guard against acquiring
    // `dropdown-menu`'s defect (objectui#5930), which is the one failure mode a
    // glyph-presence assertion cannot see.
    it('draws the glyph and not the word', () => {
      renderCrumbs([{ label: 'Docs', href: '/docs', icon: 'book' }, { label: 'Components', icon: 'panels-top-left' }]);
      expect(crumbFor('Docs').querySelector('svg.lucide-book')).not.toBeNull();
      expect(screen.queryByText('book')).toBeNull();
      expect(screen.queryByText('panels-top-left')).toBeNull();
    });
  });

  describe('the with-icons.json catalog fixture', () => {
    // The fixture is a live specimen AND a declared AI few-shot retrieval
    // source, so every name it ships must actually draw. `panels-top-left` is
    // the identity-derived live key for the retired `layout` it carried.
    it('draws a glyph for every icon name it declares', () => {
      renderCrumbs([
        { label: 'Home', href: '/', icon: 'home' },
        { label: 'Docs', href: '/docs', icon: 'book' },
        { label: 'Components', icon: 'panels-top-left' },
      ]);
      for (const [label, glyph] of [
        // `home` is the ONE authored name whose glyph class is not its own
        // spelling: `resolveIcon`'s `iconNameMap` sends it to lucide's `House`.
        // Asserting the resolved class pins that indirection from the outside.
        ['Home', 'lucide-house'],
        ['Docs', 'lucide-book'],
        ['Components', 'lucide-panels-top-left'],
      ]) {
        expect(
          crumbFor(label).querySelector(`svg.${glyph}`),
          `${label} should draw ${glyph}`,
        ).not.toBeNull();
      }
    });
  });
});
