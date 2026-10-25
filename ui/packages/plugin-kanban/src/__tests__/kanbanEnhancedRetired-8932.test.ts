/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8932 — `KanbanEnhanced.tsx` is DELETED from `@object-ui/plugin-kanban`.
 *
 * The module was reachable through no entry of this package's `exports` map
 * (`.` and `./style.css` only) and re-exported by no barrel, and once the
 * `kanban-enhanced` registry key retired (objectui#8257) nothing but two test
 * files referred to it. Ruled delete (2026-09-11, ratified by the maintainer
 * 2026-09-24): published source that nothing can reach is removed, rather than
 * given an export nobody asked for or left for the next reader to re-measure.
 * ⛔ If a richer board is ever wanted, it comes back as a feature of the one
 * registered board (`KanbanImpl`), not as a second implementation beside it.
 *
 * Two halves, each with a firing control on the same instrument:
 *
 *   - the file is absent from `src/`, while `KanbanImpl.tsx` in the same
 *     directory reads present;
 *   - no file under `src/` names the retired module as a module specifier — a
 *     static or dynamic import, a re-export, a `require`, or a `vi.mock` /
 *     `vi.doMock` target — while the same pattern over the same walk finds the
 *     live board's lazy import in `KanbanBoardCore.tsx` (in `index.tsx` until
 *     objectui#11234 moved the board body into that internal module).
 *
 * ⚠️ Mock targets count on purpose. A mock registered against a path that no
 * longer exists fails nothing, so it would outlive the module silently; one of
 * the two references this deletion found was exactly that shape.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `packages/plugin-kanban/src` — one level up from `src/__tests__`. */
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The deleted module, and the live board that is the control for it. */
const RETIRED = 'KanbanEnhanced';
const LIVE = 'KanbanImpl';

/** Every `.ts` / `.tsx` file under `src/`, recursively, as a path relative to `src/`. */
function sourceFiles(dir: string = SRC_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [relative(SRC_DIR, full)] : [];
  });
}

/** The files under `src/` that name `<anything>/MODULE` (extension optional) as a module specifier. */
function filesReferencing(moduleName: string): string[] {
  const specifier = new RegExp(
    String.raw`(?:\bfrom|\bimport|\brequire|\bvi\.(?:do)?[mM]ock)\s*\(?\s*['"][^'"]*/${moduleName}(?:\.tsx?)?['"]`,
  );
  return sourceFiles()
    .filter((rel) => specifier.test(readFileSync(join(SRC_DIR, rel), 'utf8')))
    .sort();
}

describe('@object-ui/plugin-kanban — KanbanEnhanced.tsx is deleted (objectui#8932)', () => {
  it('the module file is gone from src/, while the live board beside it reads present', () => {
    expect({
      retired: existsSync(join(SRC_DIR, `${RETIRED}.tsx`)),
      live: existsSync(join(SRC_DIR, `${LIVE}.tsx`)),
    }).toEqual({ retired: false, live: true });
  });

  it('no file under src/ names the deleted module as a specifier, while the same pattern finds the live board', () => {
    // Firing control first: the walk and the pattern are live, so the empty
    // list below is a reading and not a probe that matches nothing.
    expect(filesReferencing(LIVE)).toContain('KanbanBoardCore.tsx');
    expect(filesReferencing(RETIRED)).toEqual([]);
  });
});
