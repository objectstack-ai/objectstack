/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:header-bar` resolves a crumb's authored `icon` to a glyph — the SAME
 * `BreadcrumbItem.icon` `ui:breadcrumb` resolves (objectui#6645).
 *
 * ## The class, and why it is a card rather than a footnote
 *
 * `HeaderBarSchema.crumbs` is typed `BreadcrumbItem[]` — the very interface
 * `BreadcrumbSchema.items` uses (`packages/types/src/navigation.ts`, mirrored as
 * `BreadcrumbItemSchema` in `packages/types/src/zod/navigation.zod.ts`). That
 * mirror does not merely DECLARE `icon`, it DESCRIBES it
 * (`.describe('Breadcrumb icon')`), so any authoring surface that reads Zod
 * `describe` — designer, schema hints, generated docs — can already present the
 * key to an author. The window in which "nobody has authored it yet" protects
 * anyone is therefore narrower than an unauthored-fixture census suggests.
 *
 * `renderers/navigation/header-bar.tsx` contained ZERO occurrences of the
 * substring `icon`: its `BreadcrumbLabel` helper read `crumb.label`,
 * `crumb.siblings` and `crumb.href`, and nothing else.
 *
 * ## The asymmetry is the subject, so it is asserted DIRECTLY
 *
 * After objectui#5931 / PR #6644, one declared key behaved DIFFERENTLY on its
 * two consumers: authored on a `breadcrumb` item it drew a glyph, authored on a
 * `header-bar` crumb it drew nothing. That asymmetry was invisible only because
 * it had been a uniform zero on both. `theTwoConsumersAgree` below renders the
 * SAME crumb object through both renderers and compares the resolved glyph, so
 * a future repair that drifts one of them apart from the other is red here and
 * nowhere else.
 *
 * ## The resolver is the SHARED one, and that is a measurable fact
 *
 * The repair calls `resolveIcon` from `renderers/action/resolve-icon.ts` — the
 * same function `ui:button`, the `action:*` family, `ui:dropdown-menu`,
 * `ui:context-menu` and `ui:breadcrumb` route through — and NOT a local
 * normaliser of its own. objectui#5993 is the lesson: a local copy is "the same
 * algorithm under a different function", and an alias later added to absorb a
 * lucide retirement reached every `action:*` site EXCEPT `ui:button`. The
 * `home` -> `lucide-house` row below is what pins that from the outside: that
 * indirection exists ONLY in the shared resolver's `iconNameMap`, so a local
 * re-implementation of `toPascalCase` alone renders nothing and the row is red.
 *
 * ## The RECORD surface, not the lazy one
 *
 * Names resolve against lucide's runtime `icons` RECORD, so an unknown or
 * RETIRED spelling renders NOTHING. `layout` is the control: a deprecated
 * lucide export absent from the runtime record (`Layout === PanelsTopLeft` is
 * TRUE — the retired alias is the very same object under a dead name). Its row
 * is what rules out `LazyIcon`, which degrades an unknown name to the
 * `Database` glyph — trading a no-icon failure for a WRONG-icon one, ruled out
 * for authored icon fields by objectui#5622 / #5633.
 *
 * ## Why every row scopes to the crumb's own `<li>`
 *
 * This header draws lucide glyphs that have nothing to do with any crumb:
 * `SidebarTrigger`'s panel icon, `BreadcrumbSeparator`'s chevron between
 * crumbs, and `ChevronDown` on a siblings dropdown. A container-level
 * `querySelector('svg')` is green in every world — the blind instrument this
 * suite must not use.
 *
 * ## The `SidebarProvider` host
 *
 * `SidebarTrigger` calls `useSidebar()`, which THROWS without a provider. A
 * caught throw renders error-boundary markup that reads as an attribute-clean
 * pass (`widget-dom-leak-sweep`'s trap 4), so the host is a precondition of
 * measuring anything here at all — `theHarnessRendersTheRealHeader` asserts it
 * rather than assuming it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';
import { SidebarProvider } from '../ui';

afterEach(() => cleanup());

function renderHeaderBar(crumbs: any[]) {
  const C = ComponentRegistry.get('header-bar') as React.ComponentType<any>;
  return render(
    <SidebarProvider>
      <C schema={{ type: 'header-bar', crumbs }} />
    </SidebarProvider>,
  );
}

function renderBreadcrumb(items: any[]) {
  const C = ComponentRegistry.get('breadcrumb') as React.ComponentType<any>;
  return render(<C schema={{ type: 'breadcrumb', items }} />);
}

/** The crumb's own `<li>`. Separators are DIFFERENT `<li>`s. */
function crumbFor(label: string): HTMLElement {
  const el = screen.getByText(label).closest('li');
  if (!el) throw new Error(`no <li> ancestor for ${label}`);
  return el as HTMLElement;
}

/** Two crumbs, so the link arm and the page arm are both exercised. */
const TWO = (icon?: string) => [
  { label: 'Home', href: '#', ...(icon ? { icon } : {}) },
  { label: 'Current Page', ...(icon ? { icon } : {}) },
];

describe('ui:header-bar crumb icon resolution (objectui#6645)', () => {
  describe('harness controls', () => {
    it('theHarnessRendersTheRealHeader — not error-boundary markup', () => {
      // `useSidebar()` throws without `SidebarProvider`, and the caught throw
      // is clean markup that would make every "renders no glyph" row below pass
      // for the wrong reason.
      const { container } = renderHeaderBar(TWO());
      expect(container.querySelector('header')).not.toBeNull();
      expect(crumbFor('Home')).toBeTruthy();
      expect(crumbFor('Current Page')).toBeTruthy();
    });

    it('both arms are the ones the renderer is documented to produce', () => {
      renderHeaderBar(TWO());
      expect(screen.getByText('Home').closest('a')).not.toBeNull();
      expect(screen.getByText('Current Page').closest('[aria-current="page"]')).not.toBeNull();
    });

    it('positive control on the instrument — foreign glyphs ARE present, outside every crumb', () => {
      // Green in both worlds BY DESIGN. It exists so a red `lucide-*` row
      // cannot be misread as a broken query, and it is the reason no row here
      // may query at container level.
      const { container } = renderHeaderBar(TWO());
      expect(container.querySelector('svg')).not.toBeNull();
      expect(crumbFor('Home').querySelector('svg')).toBeNull();
      expect(crumbFor('Current Page').querySelector('svg')).toBeNull();
    });
  });

  describe('BreadcrumbLink arm (every crumb but the last)', () => {
    it('renders the resolved glyph for a live icon name', () => {
      // RED before the repair: the crumb contained no svg whatsoever.
      renderHeaderBar([{ label: 'Projects', href: '#', icon: 'book' }, { label: 'Web App' }]);
      expect(crumbFor('Projects').querySelector('svg.lucide-book')).not.toBeNull();
    });

    it('renders no glyph for a RETIRED spelling — the RECORD surface, not a fallback', () => {
      renderHeaderBar([{ label: 'Projects', href: '#', icon: 'layout' }, { label: 'Web App' }]);
      expect(crumbFor('Projects').querySelector('svg')).toBeNull();
    });

    it('renders no glyph for an UNKNOWN name', () => {
      renderHeaderBar([{ label: 'Projects', href: '#', icon: 'not-a-real-icon' }, { label: 'Web App' }]);
      expect(crumbFor('Projects').querySelector('svg')).toBeNull();
    });
  });

  describe('BreadcrumbPage arm (the last crumb)', () => {
    it('renders the resolved glyph for a live icon name', () => {
      // RED before the repair, and red again if only the link arm were fixed —
      // "a narrower version of the same bug" (objectui#5930).
      renderHeaderBar([{ label: 'Projects', href: '#' }, { label: 'Web App', icon: 'panels-top-left' }]);
      expect(crumbFor('Web App').querySelector('svg.lucide-panels-top-left')).not.toBeNull();
    });

    it('renders no glyph when no icon is authored', () => {
      renderHeaderBar(TWO());
      expect(crumbFor('Current Page').querySelector('svg')).toBeNull();
    });
  });

  describe('the siblings-dropdown arm — this renderer\'s THIRD arm', () => {
    // `BreadcrumbLabel` branches on `crumb.siblings` BEFORE it branches on
    // `isLast`, so a repair written inside that helper's leaf arms would miss
    // this one. `ui:breadcrumb` has no such arm; it is the one shape this card
    // cannot inherit from PR #6644 and must measure for itself.
    it('renders the resolved glyph beside a crumb that opens a dropdown', () => {
      renderHeaderBar([
        {
          label: 'Accounts',
          href: '#',
          icon: 'book',
          siblings: [{ label: 'Contacts', href: '#contacts' }],
        },
        { label: 'Acme Inc' },
      ]);
      expect(crumbFor('Accounts').querySelector('svg.lucide-book')).not.toBeNull();
    });

    it('and the dropdown\'s own chevron is still there — the glyph did not replace it', () => {
      renderHeaderBar([
        {
          label: 'Accounts',
          href: '#',
          icon: 'book',
          siblings: [{ label: 'Contacts', href: '#contacts' }],
        },
        { label: 'Acme Inc' },
      ]);
      expect(crumbFor('Accounts').querySelector('svg.lucide-chevron-down')).not.toBeNull();
    });
  });

  describe('the shared resolver, pinned from the outside', () => {
    it('routes `home` to lucide\'s `House` — an indirection only the SHARED resolver has', () => {
      // `resolveIcon`'s `iconNameMap` is the only place this rename lives. A
      // local `toPascalCase` copy in `header-bar.tsx` would look for `Home`,
      // find nothing in the record, and render no glyph — which is exactly the
      // objectui#5993 failure this row exists to refuse.
      renderHeaderBar([{ label: 'Home', href: '#', icon: 'home' }, { label: 'Current Page' }]);
      expect(crumbFor('Home').querySelector('svg.lucide-house')).not.toBeNull();
    });

    it('draws the glyph and not the word', () => {
      // The regression guard against acquiring objectui#5930's defect —
      // printing the authored name as a text node. Not discriminating on its
      // own (this renderer never printed it), and a glyph-presence assertion
      // cannot see it.
      renderHeaderBar([{ label: 'Projects', href: '#', icon: 'book' }, { label: 'Web App' }]);
      expect(crumbFor('Projects').querySelector('svg.lucide-book')).not.toBeNull();
      expect(screen.queryByText('book')).toBeNull();
    });
  });

  describe('theTwoConsumersAgree — the asymmetry this card is about', () => {
    it('the same authored crumb draws the same glyph on `ui:breadcrumb` and `ui:header-bar`', () => {
      // ONE object, both consumers. Before the repair the breadcrumb side drew
      // `lucide-book` and the header-bar side drew nothing — one declared key,
      // two behaviours.
      const CRUMB = { label: 'Docs', href: '#', icon: 'book' };
      const TAIL = { label: 'Components' };

      renderBreadcrumb([CRUMB, TAIL]);
      const onBreadcrumb = crumbFor('Docs').querySelector('svg')?.getAttribute('class') ?? null;
      cleanup();

      renderHeaderBar([CRUMB, TAIL]);
      const onHeaderBar = crumbFor('Docs').querySelector('svg')?.getAttribute('class') ?? null;

      expect(onBreadcrumb).not.toBeNull();
      expect(onHeaderBar).not.toBeNull();
      expect(onHeaderBar).toBe(onBreadcrumb);
    });

    it('…and they agree on a RETIRED spelling too — both draw nothing', () => {
      // The agreement must hold in the negative direction as well, or a
      // header-bar that quietly used `LazyIcon` would satisfy the row above
      // while diverging on exactly the names that matter.
      const CRUMB = { label: 'Docs', href: '#', icon: 'layout' };
      const TAIL = { label: 'Components' };

      renderBreadcrumb([CRUMB, TAIL]);
      expect(crumbFor('Docs').querySelector('svg')).toBeNull();
      cleanup();

      renderHeaderBar([CRUMB, TAIL]);
      expect(crumbFor('Docs').querySelector('svg')).toBeNull();
    });
  });

  describe('the crumbs-with-icons catalog fixture', () => {
    // The fixture is a live specimen AND a declared AI few-shot retrieval
    // source, so every name it ships must actually draw.
    it('draws a glyph for every icon name it declares', () => {
      renderHeaderBar([
        { label: 'Home', href: '#', icon: 'home' },
        { label: 'Settings', href: '#', icon: 'settings' },
        { label: 'Profile', icon: 'user' },
      ]);
      for (const [label, glyph] of [
        ['Home', 'lucide-house'],
        ['Settings', 'lucide-settings'],
        ['Profile', 'lucide-user'],
      ]) {
        expect(
          crumbFor(label).querySelector(`svg.${glyph}`),
          `${label} should draw ${glyph}`,
        ).not.toBeNull();
      }
    });
  });
});
