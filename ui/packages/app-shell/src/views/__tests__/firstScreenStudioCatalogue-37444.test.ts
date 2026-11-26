// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37444 — a list or record page's first load does not carry the
 * Studio designer's string table.
 *
 * The running app's save paths (a list's view save, the record page's tabs and
 * arrangement saves, the header-pin save) load with a list or record page. They read pure helpers — the override draft body, the
 * object-extension body, the draft-version guard — which used to live in
 * component modules (`StudioCustomizeControls.tsx`, `DraftConflictDialog.tsx`)
 * that import the designer's `t()` (`metadata-admin/i18n.ts`) and through it
 * the `studio` namespace's English catalogue, statically. Measured on the
 * Console build of `021524cd`, that put about 94 KB gzipped on both pages'
 * first load. The helpers now live in `customizeOverride.ts` and
 * `draftVersionGuard.ts`.
 *
 * This walks each save path's STATIC relative imports in source (type-only
 * imports and `import()` excluded, as the browser loads them) and asserts the
 * walk never reaches the designer's string table. The walk is checked to see
 * the edge it guards: `DraftConflictDialog.tsx` itself must reach it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The designer string table, by file and by package specifier. */
const DESIGNER_I18N_FILE = resolve(SRC, 'views/metadata-admin/i18n.ts');
const DESIGNER_I18N_SPECIFIER = /^@object-ui\/i18n\/namespaces\/studio$/;

/**
 * The save paths a list or record page loads with (read off the Console
 * build's static closure of `ObjectView` and `RecordDetailView`). The
 * design-mode menu save is not one: it loads with design mode, and it still
 * reads the app-nav canvas, which translates.
 */
const SAVE_PATHS = [
  'views/runtime-metadata-persistence.ts',
  'views/recordTabsConfigSave.ts',
  'views/objectExtensionArrangementSave.ts',
  'layout/designModeHeaderPinsSave.ts',
];

/** Static value imports of one module: `import … from '…'` and `export … from '…'`, never `import type`. */
function staticSpecifiers(code: string): string[] {
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(?!type\s)([^;]*?\bfrom\s+)?['"]([^'"]+)['"]/gm;
  for (const m of code.matchAll(re)) {
    if (m[1] === 'export' && !m[2]) continue;
    out.push(m[3]);
  }
  return out;
}

function resolveRelative(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The first chain from `entry` to the designer string table, or `null`. */
function chainToDesignerI18n(entry: string): string[] | null {
  const start = resolve(SRC, entry);
  const prev = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const file = queue.shift() as string;
    for (const specifier of staticSpecifiers(readFileSync(file, 'utf8'))) {
      if (DESIGNER_I18N_SPECIFIER.test(specifier)) {
        const chain = [specifier];
        for (let at: string | null = file; at; at = prev.get(at) ?? null) chain.unshift(at.slice(SRC.length + 1));
        return chain;
      }
      if (!specifier.startsWith('.')) continue;
      const next = resolveRelative(file, specifier);
      if (!next || prev.has(next)) continue;
      prev.set(next, file);
      if (next === DESIGNER_I18N_FILE) {
        const chain: string[] = [];
        for (let at: string | null = next; at; at = prev.get(at) ?? null) chain.unshift(at.slice(SRC.length + 1));
        return chain;
      }
      queue.push(next);
    }
  }
  return null;
}

describe('a list or record page first load carries no Studio designer string table (objectstack#37444)', () => {
  it('the walk sees the edge it guards: the conflict dialog reaches the designer table', () => {
    expect(chainToDesignerI18n('views/metadata-admin/DraftConflictDialog.tsx')).not.toBeNull();
    expect(chainToDesignerI18n('views/studio-design/StudioCustomizeControls.tsx')).not.toBeNull();
  });

  it.each(SAVE_PATHS)('%s reaches no designer string table through static imports', (entry) => {
    expect(chainToDesignerI18n(entry)).toBeNull();
  });

  it('the pure halves import no component module and no string table', () => {
    for (const entry of ['views/studio-design/customizeOverride.ts', 'views/metadata-admin/draftVersionGuard.ts']) {
      expect(chainToDesignerI18n(entry)).toBeNull();
      expect(staticSpecifiers(readFileSync(resolve(SRC, entry), 'utf8'))).not.toContain('@object-ui/components');
    }
  });
});
