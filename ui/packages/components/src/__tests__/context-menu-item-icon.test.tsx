/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:context-menu` resolves an item's authored `icon` to a glyph (objectui#6278).
 *
 * The twin repair is objectui#5930 on `renderers/overlay/dropdown-menu.tsx`;
 * this file is that suite ported to the file next door, with the two
 * differences below made explicit rather than copied over silently.
 *
 * ## Difference 1 — the defect here is an ABSENT render, not a WRONG one
 *
 * `dropdown-menu` rendered the authored string into a text node, so its
 * load-bearing assertion could be `queryByText('trash')` — the word was on
 * screen. `context-menu` never referenced `icon` at all (0 occurrences in the
 * file at `090927f4f`, against 2 for `shortcut` and 12 for `label` on the same
 * pathspec), so it drew NOTHING. `queryByText(name)` is therefore a GHOST here:
 * it is null before the fix and null after it. The discriminating assertion is
 * the presence of the RESOLVED GLYPH, and that is what every measurement row
 * below asserts.
 *
 * ## Difference 2 — the submenu trigger already contains an svg
 *
 * `ContextMenuSubTrigger` renders its own `ChevronRight` unconditionally (see
 * `src/ui/context-menu.tsx`). A bare `querySelector('svg')` on that arm is
 * therefore GREEN IN BOTH WORLDS — the blind instrument this suite must not
 * use. Each assertion names the glyph by the identity lucide gives it,
 * `svg.lucide-<authored-name>`, which is derived from the AUTHORED name (the
 * independent input) and not from the renderer under test. The chevron is
 * asserted alongside it as a positive control ON THE INSTRUMENT: if the
 * `lucide-trash` row is red while the chevron row is green, the query works and
 * the authored icon is genuinely missing.
 *
 * ## Why Radix's lazy mount is handled by an EVENT here, not `defaultOpen`
 *
 * The twin passes `defaultOpen: true`. `@radix-ui/react-context-menu`'s root
 * has no such prop — its `ContextMenuProps` is `{ children, open, onOpenChange,
 * dir, modal }` — and a context menu opens on the trigger's `contextmenu`
 * event. Without firing it this suite would render an EMPTY container and prove
 * nothing, which is why `expectsMenuOpen` is asserted as a harness control
 * before any glyph is read.
 *
 * ## Why the renderer is invoked DIRECTLY
 *
 * `ComponentRegistry.get(name)` returns the component the registry actually
 * renders; driving through `SchemaRenderer` injects its own props around it and
 * can be green in both directions (PR #4603's toggle case, restated by #4580).
 *
 * ## Why lucide is NOT mocked
 *
 * The contract under test is "the authored name is resolved against lucide's
 * runtime `icons` RECORD". Mocking the record would delete the half that
 * matters: that a RETIRED spelling resolves to NOTHING rather than degrading to
 * a wrong glyph. `edit` is that control — a deprecated lucide export whose key
 * is absent from the runtime record (measured on lucide-react 1.31.0, 1767
 * keys), so it must draw no glyph while `copy`/`trash` must draw one. That row
 * is what rules out the `LazyIcon` surface, which would degrade `edit` to the
 * `Database` glyph.
 *
 * ## What this file does NOT own
 *
 * Fixture drift. The catalog's own four names live in
 * `examples/schema-catalog/src/schemas/components-overlay-context-menu/basic-context-menu.json`
 * and are judged on every run by `scripts/check-lucide-icon-record-names.mjs`,
 * whose census this card's PR extends with a `'context-menu'` entry. This suite
 * pins the RENDERER; the gate pins the SPELLINGS.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

afterEach(() => cleanup());

/**
 * Render the menu and OPEN it. Radix mounts `ContextMenuContent` only after the
 * trigger sees a `contextmenu` event — see the header note.
 */
function renderMenu(items: any[]) {
  const C = ComponentRegistry.get('context-menu') as React.ComponentType<any>;
  const { container } = render(
    <C schema={{ type: 'context-menu', trigger: { type: 'text', content: 'AREA' }, items }} />,
  );
  fireEvent.contextMenu(container.firstElementChild as HTMLElement);
  return container;
}

/** The menu item element carrying `label`. Both arms render `role="menuitem"`. */
function itemFor(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[role="menuitem"]');
  if (!el) throw new Error(`no [role="menuitem"] ancestor for ${label}`);
  return el as HTMLElement;
}

describe('ui:context-menu item icon resolution (objectui#6278)', () => {
  describe('harness control — the menu actually opens', () => {
    // Without this every "renders no glyph" row below would pass vacuously
    // against a container that rendered nothing at all.
    it('mounts the content and its items after the contextmenu event', () => {
      renderMenu([{ label: 'Copy', icon: 'copy' }, { label: 'Plain' }]);
      expect(screen.getByRole('menu')).toBeTruthy();
      expect(itemFor('Copy')).toBeTruthy();
      expect(itemFor('Plain')).toBeTruthy();
    });
  });

  describe('ContextMenuItem arm (leaf)', () => {
    it('renders the resolved glyph for a live icon name', () => {
      renderMenu([{ label: 'Copy', icon: 'copy' }]);
      // RED before the repair: the leaf item contained no svg whatsoever.
      expect(itemFor('Copy').querySelector('svg.lucide-copy')).not.toBeNull();
    });

    it('renders no glyph for a RETIRED spelling — the RECORD surface, not a fallback', () => {
      // Rules out `LazyIcon`, which degrades an unknown name to `Database`.
      renderMenu([{ label: 'Edit', icon: 'edit' }]);
      expect(itemFor('Edit').querySelector('svg')).toBeNull();
    });

    it('renders no glyph when no icon is authored', () => {
      renderMenu([{ label: 'Plain' }]);
      expect(itemFor('Plain').querySelector('svg')).toBeNull();
    });
  });

  describe('ContextMenuSubTrigger arm (submenu)', () => {
    // Repairing only the leaf arm would be "a narrower version of the same
    // bug" (objectui#5930), so this arm is measured as its own row.
    const submenu = [{ label: 'More', icon: 'trash', children: [{ label: 'Nested' }] }];

    it('positive control on the instrument — the arm DOES contain a queryable svg', () => {
      // Green in both worlds BY DESIGN: `ContextMenuSubTrigger` always draws a
      // chevron. It exists so a red `lucide-trash` row cannot be misread as a
      // broken query.
      renderMenu(submenu);
      expect(itemFor('More').querySelector('svg.lucide-chevron-right')).not.toBeNull();
    });

    it('renders the resolved glyph for a live icon name', () => {
      renderMenu(submenu);
      // RED before the repair: the chevron was the arm's ONLY svg.
      expect(itemFor('More').querySelector('svg.lucide-trash')).not.toBeNull();
    });

    it('renders no glyph beside the chevron for a RETIRED spelling', () => {
      renderMenu([{ label: 'More', icon: 'edit', children: [{ label: 'Nested' }] }]);
      const svgs = Array.from(itemFor('More').querySelectorAll('svg'));
      expect(svgs.map((s) => s.getAttribute('class'))).toHaveLength(1);
      expect(itemFor('More').querySelector('svg.lucide-chevron-right')).not.toBeNull();
    });
  });

  describe('the basic-context-menu.json catalog fixture', () => {
    // The four names the catalog actually authors. The fixture is a live
    // specimen AND a declared AI few-shot retrieval source, so every name it
    // ships must draw. Spelling drift is the gate's job (see the header);
    // this row is the renderer's half of that contract.
    //
    // ⛔ No `value` key here, and its absence is deliberate. These items are a
    // TRANSCRIPTION of the fixture, so a key the fixture does not carry is a
    // spelling the next author copies out of here. No arm of the `MenuItem`
    // union declares `value` — objectui#6523 narrowed that union on purpose —
    // and no menu renderer reads it; objectui#7072 deleted it from the four
    // catalog fixtures and objectui#7102 from these copies. Re-adding it would
    // NOT go red: `MenuItemSchema`'s arms are non-strict `z.object`s, so zod
    // strips the key and reports success. Hence this note rather than a pin —
    // a parse-based pin here could not fail.
    it('draws a distinct glyph for each of the four authored names', () => {
      renderMenu([
        { label: 'Copy', icon: 'copy' },
        { label: 'Cut', icon: 'scissors' },
        { label: 'Paste', icon: 'clipboard' },
        { separator: true },
        { label: 'Delete', icon: 'trash' },
      ]);
      for (const [label, name] of [
        ['Copy', 'copy'],
        ['Cut', 'scissors'],
        ['Paste', 'clipboard'],
        ['Delete', 'trash'],
      ]) {
        expect(
          itemFor(label).querySelector(`svg.lucide-${name}`),
          `${label} should draw the ${name} glyph`,
        ).not.toBeNull();
      }
    });
  });
});
