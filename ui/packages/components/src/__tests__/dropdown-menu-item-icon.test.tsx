/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:dropdown-menu` resolves an item's authored `icon` to a glyph (objectui#5930).
 *
 * Before the fix both arms of `renderMenuItems` rendered the authored STRING
 * into a text node — `{item.icon && <span className="mr-2">{item.icon}</span>}` —
 * so the catalog fixture literally named `with-icons.json` drew the words
 * `edit Edit`, `copy Copy`, `trash Delete`. The key parsed, published and was
 * documented in the registration's own item-shape description; nothing was
 * red, because no renderer test asserted a glyph here.
 *
 * ## Why the assertions are shaped this way
 *
 * The defect is a WRONG RENDER, not an absent one, so `queryByText(name)` is
 * the load-bearing assertion: a test that only asserted "an svg exists" passes
 * against the broken renderer too, since the pre-fix `<span>` sits inside the
 * same item as the trigger's own glyph. Both directions are asserted — the
 * glyph appears AND the bare name does not.
 *
 * ⚠️ `defaultOpen: true` is load-bearing. Radix mounts `DropdownMenuContent`
 * lazily, so without it this suite renders an EMPTY container and proves
 * nothing — the same trap recorded on `inline-locale-label-read-sites.test.tsx`.
 *
 * ## Why the renderer is invoked DIRECTLY
 *
 * `ComponentRegistry.get(name)` returns the component the registry actually
 * renders; driving through `SchemaRenderer` injects its own props around it and
 * can be green in both directions (PR #4603's toggle case, restated by #4580).
 *
 * ## Why lucide is NOT mocked here
 *
 * The contract under test is "the authored name is resolved against lucide's
 * runtime `icons` RECORD", and the record surface is a synchronous object
 * lookup with no chunk-loading path to flake on — unlike the dynamic
 * (`LazyIcon`) surface, which sibling suites mock for exactly that reason.
 * Mocking the record here would delete the half of the contract that matters:
 * that a RETIRED spelling resolves to nothing. `edit` is that control — it is
 * a deprecated lucide export whose key was dropped from the record, so it is
 * the case that must render no glyph while `square-pen` (the same object under
 * its live key) must render one.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

afterEach(() => cleanup());

/** `defaultOpen` is load-bearing — see the header note on Radix's lazy mount. */
function renderMenu(items: any[]) {
  const C = ComponentRegistry.get('dropdown-menu') as React.ComponentType<any>;
  return render(
    <C schema={{ type: 'dropdown-menu', defaultOpen: true, items }} />,
  );
}

/** The rendered glyph for an item, located via the item's own label. */
function glyphFor(label: string): SVGElement | null {
  const item = screen.getByText(label).closest('[role="menuitem"], [role="menu"] div');
  return item?.querySelector('svg') ?? null;
}

describe('ui:dropdown-menu item icon resolution (objectui#5930)', () => {
  describe('DropdownMenuItem arm', () => {
    it('renders a glyph for a live icon name', () => {
      renderMenu([{ label: 'Copy', icon: 'copy' }]);
      expect(glyphFor('Copy')).not.toBeNull();
    });

    it('does NOT render the authored icon name as text — the defect itself', () => {
      renderMenu([{ label: 'Copy', icon: 'copy' }]);
      // Pre-fix this found the literal word beside the label.
      expect(screen.queryByText('copy')).toBeNull();
    });

    it('renders no glyph and no text for a RETIRED spelling', () => {
      // `edit` is a deprecated lucide export dropped from the runtime `icons`
      // record. The record surface is chosen precisely so this renders nothing
      // rather than degrading to a wrong glyph.
      renderMenu([{ label: 'Edit', icon: 'edit' }]);
      expect(glyphFor('Edit')).toBeNull();
      expect(screen.queryByText('edit')).toBeNull();
    });

    it('renders no glyph when no icon is authored', () => {
      renderMenu([{ label: 'Plain' }]);
      expect(glyphFor('Plain')).toBeNull();
    });
  });

  describe('DropdownMenuSubTrigger arm', () => {
    // The submenu TRIGGER is mounted with the parent content; only
    // `DropdownMenuSubContent` needs the submenu opened, and it is not read here.
    it('renders a glyph for a live icon name', () => {
      renderMenu([{ label: 'More', icon: 'trash', children: [{ label: 'Nested' }] }]);
      expect(glyphFor('More')).not.toBeNull();
    });

    it('does NOT render the authored icon name as text — the defect itself', () => {
      renderMenu([{ label: 'More', icon: 'trash', children: [{ label: 'Nested' }] }]);
      expect(screen.queryByText('trash')).toBeNull();
    });
  });

  describe('the with-icons.json catalog fixture', () => {
    // The fixture is a live specimen AND a declared AI few-shot retrieval
    // source, so every name it ships must actually draw. `square-pen` is the
    // identity-derived live key for the retired `edit` this fixture carried.
    //
    // ⛔ No `value` key here, and its absence is deliberate — same reason as
    // the twin block in `context-menu-item-icon.test.tsx`, which carries the
    // long form. In short: no arm of the `MenuItem` union declares `value`
    // (objectui#6523), no menu renderer reads it, objectui#7072 removed it
    // from the fixtures and objectui#7102 from these copies — and re-adding
    // it could not go red, because `MenuItemSchema` is non-strict and strips
    // the key while reporting success.
    it('draws a glyph for every icon name it declares', () => {
      renderMenu([
        { label: 'Edit', icon: 'square-pen' },
        { label: 'Copy', icon: 'copy' },
        { label: 'Delete', icon: 'trash' },
      ]);
      for (const label of ['Edit', 'Copy', 'Delete']) {
        expect(glyphFor(label), `${label} should draw a glyph`).not.toBeNull();
      }
      for (const name of ['square-pen', 'copy', 'trash']) {
        expect(screen.queryByText(name)).toBeNull();
      }
    });
  });
});
