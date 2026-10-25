/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8522 — `useColumnWidths` is RETIRED from the package entry.
 *
 * The hook kept per-column widths in `localStorage` and no board read it: the
 * rendered lane width comes from `KanbanImpl`'s `columnInlineStyle`, derived
 * from the board's own width on every render. Ruled remove (a published
 * capability with zero consumers retires immediately); the hook, its two option
 * and return types, and its storage key went with it. ⛔ Resizable lanes are
 * not rebuilt to keep it alive; if they are ever wanted, they come back as
 * their own feature.
 *
 * What this pins is the entry's SHAPE, both halves:
 *
 *   - runtime: the hook name is not an own key of the module namespace, with a
 *     sibling hook exported the same way and the board renderer as firing
 *     controls on the same probe;
 *   - compile time: the two type names do not resolve through the entry, with a
 *     sibling hook's return type resolving through the same type query as the
 *     control. Compiled by this package's `tsconfig.test.json` (chained off
 *     `type-check`); an export that comes back fails there with
 *     "Unused '@ts-expect-error' directive".
 */

import { describe, expect, it } from 'vitest';
import * as entry from '../index';

describe('@object-ui/plugin-kanban entry — useColumnWidths retired (objectui#8522)', () => {
  it('no longer exports the hook, while live exports on the same probe still resolve', () => {
    const keys = Object.keys(entry);
    expect(keys).not.toContain('useColumnWidths');
    // Firing controls: a hook exported the same way, and the board renderer.
    // Without them an empty or mis-resolved namespace would pass the line above.
    expect(typeof (entry as Record<string, unknown>).useCrossSwimlaneMove).toBe('function');
    expect(keys).toContain('ObjectKanbanRenderer');
  });

  it('no longer exports the hook option and return types', () => {
    // @ts-expect-error retired with the hook (objectui#8522). If the export
    // comes back, tsc fails with "Unused '@ts-expect-error' directive".
    type _OptionsRetired = import('../index').UseColumnWidthsOptions;
    // @ts-expect-error retired with the hook (objectui#8522), as above.
    type _ReturnRetired = import('../index').UseColumnWidthsReturn;
    // Control: the same type query resolves a sibling hook's return type, so
    // the two errors above are readings of the entry and not of a bad path.
    type _SiblingResolves = import('../index').UseCrossSwimlaneMoveReturn;
  });
});
