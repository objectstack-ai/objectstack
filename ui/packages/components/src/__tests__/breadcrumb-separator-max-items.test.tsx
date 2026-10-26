/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:breadcrumb` honours its two remaining declared keys — `separator` and
 * `maxItems` (objectui#6646).
 *
 * ## The class
 *
 * Both keys are DECLARED on the published protocol — `BreadcrumbSchema` in
 * `packages/types/src/navigation.ts`, mirrored in
 * `packages/types/src/zod/navigation.zod.ts` — and `separator` is additionally
 * ADVERTISED to authors on the component's own documentation page
 * (`content/docs/components/data-display/breadcrumb.mdx`). Before this suite
 * `renderers/data-display/breadcrumb.tsx` contained ZERO occurrences of either
 * name: it always emitted a bare `BreadcrumbSeparator` (shadcn's
 * `ChevronRight`) and it never collapsed.
 *
 * The sharp half is `separator`, and it is sharp for a reason a "declared but
 * unenforced" label does not carry on its face: an author who reads the page,
 * writes `"separator": "/"`, and sees a chevron gets feedback IDENTICAL to
 * having misspelled the key. Nothing distinguishes "the key does nothing" from
 * "I typed `seperator`". `separatorIsDistinguishableFromATypo` below is that
 * exact discrimination, asserted directly rather than implied.
 *
 * ## The declared default was ALSO wrong, and that is its own row
 *
 * `separator` carries `@default '/'` in the declaration while the renderer fell
 * through to shadcn's `ChevronRight`. Declared default and actual render
 * DISAGREED, so honouring only the authored value would have left the docs
 * lying about the unauthored one. The repair aligns the RENDER to the
 * DECLARATION (`schema.separator ?? '/'`) rather than rewriting the declared
 * default, because rewriting a published `@default` is a contract change and
 * this card's dispatched arm is "implement the declaration", not "amend it".
 * `theDeclaredDefault` is that assertion, kept separate from the authored-value
 * rows so a repair that honoured one and not the other cannot read as green.
 *
 * ## `maxItems` and where its number lands
 *
 * The declaration says "Maximum items to display before collapsing", so the
 * count of RENDERED crumbs is what the number bounds — asserted directly, not
 * inferred from which labels survive. The collapse keeps the FIRST crumb and
 * the LAST `maxItems - 1`, with shadcn's `BreadcrumbEllipsis` between them, so
 * the current page (the last crumb, and the whole point of a breadcrumb) is
 * never the thing that gets dropped. At `maxItems: 1` there is no room for both
 * ends and the LAST one is what survives — that asymmetry is deliberate and has
 * its own row rather than being left to the reader.
 *
 * ## The instrument, and why container-level svg queries are refused
 *
 * `BreadcrumbEllipsis` draws a lucide glyph and every crumb may draw one of its
 * own (objectui#5931), so `container.querySelector('svg')` is green in every
 * world and proves nothing. Rows here scope to the element they are about: the
 * separator's own `<li role="presentation">`, or a crumb's own `<li>`.
 *
 * ## Why the renderer is invoked DIRECTLY
 *
 * `ComponentRegistry.get(name)` returns the component the registry actually
 * renders; driving through `SchemaRenderer` injects its own props around it and
 * can be green in both directions (PR #4603's toggle case, restated by #4580).
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

function renderBreadcrumb(schema: Record<string, unknown>) {
  const C = ComponentRegistry.get('breadcrumb') as React.ComponentType<any>;
  return render(<C schema={{ type: 'breadcrumb', ...schema }} />);
}

/** The separator `<li>`s — a DIFFERENT `<li>` from any crumb's. */
function separators(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('li[role="presentation"]'));
}

/**
 * Every CRUMB `<li>`, which is neither of the other two kinds of `<li>` the
 * list holds. A separator is `<li role="presentation">`; the elision is a
 * plain `<li>` wrapping shadcn's `<span role="presentation">`, so "not a
 * separator" alone counts it as a crumb and every `maxItems` count reads one
 * too high. Both are excluded here, by the one attribute shadcn uses to mark
 * decorative nodes.
 */
function crumbs(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('li')).filter(
    (li) =>
      li.getAttribute('role') !== 'presentation' &&
      li.querySelector('[role="presentation"]') === null,
  );
}

const FIVE = [
  { label: 'Home', href: '/' },
  { label: 'Products', href: '/products' },
  { label: 'Electronics', href: '/products/electronics' },
  { label: 'Laptops', href: '/products/electronics/laptops' },
  { label: 'ObjectBook Pro' },
];

describe('ui:breadcrumb separator + maxItems (objectui#6646)', () => {
  describe('harness controls', () => {
    it('mounts every crumb on first render — nothing here is lazy', () => {
      const { container } = renderBreadcrumb({ items: FIVE });
      expect(crumbs(container)).toHaveLength(5);
      expect(screen.getByText('ObjectBook Pro')).toBeTruthy();
    });

    it('positive control on the instrument — `svg.lucide-*` is a query that works', () => {
      // Green in BOTH worlds by construction: this renders the shadcn primitive
      // DIRECTLY, not through `ui:breadcrumb`. It used to be asserted on the
      // renderer's own output, which was only valid while the renderer's
      // default separator WAS that chevron — the very thing this card changes.
      // Kept, at the primitive, so a red `lucide-*` row below still cannot be
      // misread as a broken selector.
      const { container } = render(<BreadcrumbSeparator />);
      expect(container.querySelector('svg.lucide-chevron-right')).not.toBeNull();
    });

    it('a separator sits between crumbs and nowhere else', () => {
      const { container } = renderBreadcrumb({ items: FIVE });
      expect(separators(container)).toHaveLength(4);
    });
  });

  describe('separator — the declared default', () => {
    it('renders the declared `@default \'/\'` when none is authored', () => {
      // RED before the repair: every separator was shadcn's `ChevronRight`, so
      // the declaration's `@default '/'` and the actual render DISAGREED.
      const { container } = renderBreadcrumb({ items: FIVE });
      for (const sep of separators(container)) {
        expect(sep.textContent).toBe('/');
      }
    });

    it('draws NO chevron glyph once the declared default is honoured', () => {
      // The other half of the same alignment: a repair that appended `/` while
      // still drawing the chevron would pass the row above and still show the
      // author something the declaration never promised.
      const { container } = renderBreadcrumb({ items: FIVE });
      for (const sep of separators(container)) {
        expect(sep.querySelector('svg')).toBeNull();
      }
    });
  });

  describe('separator — the authored value', () => {
    it('renders an authored single-character separator', () => {
      // RED before the repair: `schema.separator` was never read.
      const { container } = renderBreadcrumb({ items: FIVE, separator: '>' });
      const seps = separators(container);
      expect(seps).toHaveLength(4);
      for (const sep of seps) {
        expect(sep.textContent).toBe('>');
      }
    });

    it('renders an authored multi-character separator verbatim', () => {
      const { container } = renderBreadcrumb({ items: FIVE, separator: '::' });
      for (const sep of separators(container)) {
        expect(sep.textContent).toBe('::');
      }
    });

    it('an authored separator is DISTINGUISHABLE from a misspelled key', () => {
      // This card's whole subject. Before the repair both spellings produced
      // the identical chevron, so an author who did everything right got the
      // feedback of someone who had typo'd the key name.
      const correct = renderBreadcrumb({ items: FIVE, separator: '·' });
      const correctText = separators(correct.container).map((s) => s.textContent);
      cleanup();
      const typo = renderBreadcrumb({ items: FIVE, seperator: '·' });
      const typoText = separators(typo.container).map((s) => s.textContent);

      expect(correctText).toEqual(['·', '·', '·', '·']);
      expect(typoText).toEqual(['/', '/', '/', '/']);
      expect(correctText).not.toEqual(typoText);
    });

    it('an empty-string separator is honoured, not treated as unauthored', () => {
      // `''` is a legal `string`. A `||` fallback would silently promote it to
      // the default; `??` is what the declaration asks for.
      const { container } = renderBreadcrumb({ items: FIVE, separator: '' });
      for (const sep of separators(container)) {
        expect(sep.textContent).toBe('');
        expect(sep.querySelector('svg')).toBeNull();
      }
    });
  });

  describe('maxItems — the collapse', () => {
    it('renders at most `maxItems` crumbs', () => {
      // RED before the repair: all five rendered and nothing collapsed.
      const { container } = renderBreadcrumb({ items: FIVE, maxItems: 3 });
      expect(crumbs(container)).toHaveLength(3);
    });

    it('keeps the FIRST crumb and the LAST `maxItems - 1`', () => {
      renderBreadcrumb({ items: FIVE, maxItems: 3 });
      expect(screen.getByText('Home')).toBeTruthy();
      expect(screen.getByText('Laptops')).toBeTruthy();
      expect(screen.getByText('ObjectBook Pro')).toBeTruthy();
      expect(screen.queryByText('Products')).toBeNull();
      expect(screen.queryByText('Electronics')).toBeNull();
    });

    it('marks the elision with shadcn\'s BreadcrumbEllipsis, not a bare gap', () => {
      // Without this the collapse is indistinguishable from an author having
      // shipped a shorter trail — the same "no way to tell" failure `separator`
      // has above, one level over.
      const { container } = renderBreadcrumb({ items: FIVE, maxItems: 3 });
      const ellipsis = container.querySelector('li > span[role="presentation"]');
      expect(ellipsis).not.toBeNull();
      // shadcn's `BreadcrumbEllipsis` carries an sr-only "More" beside its
      // glyph — the accessible half, and what makes the elision a rendered
      // FACT rather than three crumbs quietly missing.
      expect(ellipsis!.textContent).toContain('More');
      expect(ellipsis!.querySelector('svg')).not.toBeNull();
    });

    it('still renders the last crumb as the current page after collapsing', () => {
      renderBreadcrumb({ items: FIVE, maxItems: 3 });
      expect(screen.getByText('ObjectBook Pro').closest('[aria-current="page"]')).not.toBeNull();
    });

    it('keeps the CURRENT PAGE, not the root, when `maxItems` is 1', () => {
      // There is no room for both ends; the declaration's subject is a
      // location trail, so the location is what survives.
      const { container } = renderBreadcrumb({ items: FIVE, maxItems: 1 });
      expect(crumbs(container)).toHaveLength(1);
      expect(screen.getByText('ObjectBook Pro')).toBeTruthy();
      expect(screen.queryByText('Home')).toBeNull();
    });

    it('separates the collapsed trail with the same authored separator', () => {
      const { container } = renderBreadcrumb({ items: FIVE, maxItems: 3, separator: '>' });
      const seps = separators(container);
      expect(seps).toHaveLength(3); // first | … | Laptops | ObjectBook Pro
      for (const sep of seps) {
        expect(sep.textContent).toBe('>');
      }
    });

    it('resolves a surviving crumb\'s icon through the collapse (objectui#5931)', () => {
      const { container } = renderBreadcrumb({
        items: [
          { label: 'Home', href: '/', icon: 'home' },
          { label: 'Products', href: '/products', icon: 'book' },
          { label: 'Laptops', href: '/laptops', icon: 'book' },
          { label: 'ObjectBook Pro', icon: 'panels-top-left' },
        ],
        maxItems: 2,
      });
      const kept = crumbs(container);
      expect(kept).toHaveLength(2);
      expect(kept[0].querySelector('svg.lucide-house')).not.toBeNull();
      expect(kept[1].querySelector('svg.lucide-panels-top-left')).not.toBeNull();
    });
  });

  describe('maxItems — when it must NOT collapse', () => {
    it('does not collapse when the trail is shorter than `maxItems`', () => {
      const { container } = renderBreadcrumb({ items: FIVE, maxItems: 9 });
      expect(crumbs(container)).toHaveLength(5);
      expect(container.querySelector('li > span[role="presentation"]')).toBeNull();
    });

    it('does not collapse when the trail is exactly `maxItems` long', () => {
      // The boundary the declaration words as "maximum items to display":
      // five items under `maxItems: 5` are already within the maximum.
      const { container } = renderBreadcrumb({ items: FIVE, maxItems: 5 });
      expect(crumbs(container)).toHaveLength(5);
      expect(container.querySelector('li > span[role="presentation"]')).toBeNull();
    });

    it('does not collapse when `maxItems` is absent', () => {
      const { container } = renderBreadcrumb({ items: FIVE });
      expect(crumbs(container)).toHaveLength(5);
      expect(container.querySelector('li > span[role="presentation"]')).toBeNull();
    });

    it('declines a nonsensical `maxItems` rather than rendering an empty trail', () => {
      for (const bad of [0, -1, Number.NaN]) {
        const { container } = renderBreadcrumb({ items: FIVE, maxItems: bad });
        expect(crumbs(container), `maxItems: ${String(bad)}`).toHaveLength(5);
        cleanup();
      }
    });
  });
});
