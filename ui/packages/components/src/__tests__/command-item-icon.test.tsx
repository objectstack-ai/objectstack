/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:command` resolves an item's authored `icon` to a glyph (objectui#5931).
 *
 * `CommandItem.icon` has been a declared, published key of the protocol
 * (`packages/types/src/form.ts`, mirrored in `zod/form.zod.ts`, documented in
 * `content/docs/components/form/command.mdx`) and is authored NINE times across
 * the two catalog fixtures — while `renderers/form/command.tsx` contained ZERO
 * occurrences of `icon`. A command palette whose every row was drawn without
 * its glyph.
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
 * GLYPH. The text direction is still asserted, once, as a REGRESSION guard: it
 * is the exact defect `dropdown-menu` shipped, and a future "repair" that
 * printed the name instead of resolving it would be caught by it and by
 * nothing else here.
 *
 * ## Difference 2 — the lazy-mount question, answered by measurement
 *
 * The twins pass `defaultOpen: true` / fire a `contextmenu` event because Radix
 * mounts their content lazily; without it those suites render an empty
 * container and prove nothing. `ui:command` renders `cmdk` INLINE — there is no
 * open state on the component at all (`CommandDialog` is a separate export this
 * renderer does not use), so its list is in the tree on first render. cmdk does
 * FILTER, though, and an item filtered out is an item that is not in the DOM:
 * with an empty query every item matches, which is the state every row here
 * renders in. The harness control asserts the items really mounted rather than
 * assuming either fact.
 *
 * ## Difference 3 — this component has exactly ONE arm, and that was checked
 *
 * The twins carry a second arm (the submenu trigger) that had the identical
 * defect, and repairing only the leaf would have been "a narrower version of
 * the same bug" (objectui#5930). `ui:command` has no second arm to miss:
 * `CommandGroup` takes `heading` as a plain string and the `CommandGroup` type
 * declares no `icon` of its own, so `groups[].items[].icon` is the only icon
 * key in the shape. Recorded as a measurement, because "there is no second
 * arm" is exactly the claim that is worth being wrong about.
 *
 * ## The instrument's positive control
 *
 * `CommandInput` always draws a `Search` glyph, OUTSIDE the list. A bare
 * `container.querySelector('svg')` would therefore be green in both worlds —
 * the blind instrument this suite must not use. Every row scopes to the item's
 * own `[cmdk-item]` element and names the glyph by the class lucide derives
 * from the icon's own identity (`svg.lucide-<key>`), while the search glyph is
 * asserted at container level as a control ON THE INSTRUMENT.
 *
 * ## Why lucide is NOT mocked
 *
 * The contract under test is "the authored name is resolved against lucide's
 * runtime `icons` RECORD". Mocking the record would delete the half that
 * matters: that a RETIRED spelling resolves to NOTHING rather than degrading to
 * a wrong glyph. `smile` is that control — a deprecated lucide export whose key
 * is absent from the runtime record (measured on lucide-react 1.31.0, 1767
 * keys; `Smile === FaceSlightlySmiling` is TRUE, the retired alias is the very
 * same object under a dead name). It is also the spelling `command-menu.json`
 * shipped, now corrected to `face-slightly-smiling`. That row is what rules out
 * the `LazyIcon` surface, which would degrade `smile` to the `Database` glyph.
 *
 * ## Why the renderer is invoked DIRECTLY
 *
 * `ComponentRegistry.get(name)` returns the component the registry actually
 * renders; driving through `SchemaRenderer` injects its own props around it and
 * can be green in both directions (PR #4603's toggle case, restated by #4580).
 *
 * ## What this file does NOT own
 *
 * Fixture spelling drift. The catalog's nine names are judged on every run by
 * `scripts/check-lucide-icon-record-names.mjs`, whose census this card's PR
 * extends with a `'command'` entry. This suite pins the RENDERER; the gate pins
 * the SPELLINGS.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

afterEach(() => cleanup());

function renderCommand(items: any[], heading = 'Suggestions') {
  const C = ComponentRegistry.get('command') as React.ComponentType<any>;
  return render(<C schema={{ type: 'command', groups: [{ heading, items }] }} />);
}

/** The item's own cmdk element. */
function itemFor(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[cmdk-item], [role="option"]');
  if (!el) throw new Error(`no cmdk item ancestor for ${label}`);
  return el as HTMLElement;
}

describe('ui:command item icon resolution (objectui#5931)', () => {
  describe('harness controls', () => {
    it('mounts the list and its items on first render — nothing is deferred', () => {
      // Without this every "renders no glyph" row below could pass vacuously
      // against a container that rendered no items at all.
      renderCommand([{ value: 'calendar', label: 'Calendar', icon: 'calendar' }, { value: 'plain', label: 'Plain' }]);
      expect(itemFor('Calendar')).toBeTruthy();
      expect(itemFor('Plain')).toBeTruthy();
    });

    it('positive control on the instrument — a queryable svg IS present', () => {
      // Green in both worlds BY DESIGN: `CommandInput` always draws a search
      // glyph. It exists so a red `lucide-*` row cannot be misread as a broken
      // query.
      const { container } = renderCommand([{ value: 'plain', label: 'Plain' }]);
      expect(container.querySelector('svg.lucide-search')).not.toBeNull();
      // …and it is NOT inside the item, which is why the rows below can scope
      // to the item and stay discriminating.
      expect(itemFor('Plain').querySelector('svg')).toBeNull();
    });
  });

  describe('CommandItem arm — this component\'s only icon arm', () => {
    it('renders the resolved glyph for a live icon name', () => {
      renderCommand([{ value: 'calendar', label: 'Calendar', icon: 'calendar' }]);
      // RED before the repair: the item contained no svg whatsoever.
      expect(itemFor('Calendar').querySelector('svg.lucide-calendar')).not.toBeNull();
    });

    it('renders no glyph for a RETIRED spelling — the RECORD surface, not a fallback', () => {
      // Rules out `LazyIcon`, which degrades an unknown name to `Database`.
      renderCommand([{ value: 'search', label: 'Search Emoji', icon: 'smile' }]);
      expect(itemFor('Search Emoji').querySelector('svg')).toBeNull();
    });

    it('renders no glyph for an UNKNOWN name', () => {
      renderCommand([{ value: 'x', label: 'Unknown', icon: 'not-a-real-icon' }]);
      expect(itemFor('Unknown').querySelector('svg')).toBeNull();
    });

    it('renders no glyph when no icon is authored', () => {
      renderCommand([{ value: 'plain', label: 'Plain' }]);
      expect(itemFor('Plain').querySelector('svg')).toBeNull();
    });
  });

  describe('the authored NAME never reaches the DOM as text', () => {
    // Not discriminating here — this renderer never printed the name, so this
    // is null in both worlds. It is the regression guard against acquiring
    // `dropdown-menu`'s defect (objectui#5930), which is the one failure mode a
    // glyph-presence assertion cannot see.
    it('draws the glyph and not the word', () => {
      renderCommand([{ value: 'calendar', label: 'Calendar', icon: 'calendar' }]);
      expect(itemFor('Calendar').querySelector('svg.lucide-calendar')).not.toBeNull();
      expect(screen.queryByText('calendar')).toBeNull();
    });
  });

  describe('the catalog fixtures', () => {
    // Both fixtures are live specimens AND declared AI few-shot retrieval
    // sources, so every name they ship must actually draw.
    // `face-slightly-smiling` is the identity-derived live key for the retired
    // `smile` that `command-menu.json` carried.
    it('command-menu.json — draws a glyph for all six names it declares', () => {
      renderCommand([
        { value: 'calendar', label: 'Calendar', icon: 'calendar' },
        { value: 'search', label: 'Search Emoji', icon: 'face-slightly-smiling' },
        { value: 'calculator', label: 'Calculator', icon: 'calculator' },
        { value: 'profile', label: 'Profile', icon: 'user' },
        { value: 'billing', label: 'Billing', icon: 'credit-card' },
        { value: 'settings', label: 'Settings', icon: 'settings' },
      ]);
      for (const [label, name] of [
        ['Calendar', 'calendar'],
        ['Search Emoji', 'face-slightly-smiling'],
        ['Calculator', 'calculator'],
        ['Profile', 'user'],
        ['Billing', 'credit-card'],
        ['Settings', 'settings'],
      ]) {
        expect(
          itemFor(label).querySelector(`svg.lucide-${name}`),
          `${label} should draw the ${name} glyph`,
        ).not.toBeNull();
      }
    });

    it('file-command-palette.json — draws a glyph for all three names it declares', () => {
      renderCommand([
        { value: 'new', label: 'New File', icon: 'file-plus' },
        { value: 'open', label: 'Open File', icon: 'folder-open' },
        { value: 'save', label: 'Save', icon: 'save' },
      ], 'File');
      for (const [label, name] of [
        ['New File', 'file-plus'],
        ['Open File', 'folder-open'],
        ['Save', 'save'],
      ]) {
        expect(
          itemFor(label).querySelector(`svg.lucide-${name}`),
          `${label} should draw the ${name} glyph`,
        ).not.toBeNull();
      }
    });
  });
});
