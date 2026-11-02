// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio links into no Setup metadata page (objectstack ADR-0146 D1; N-28).
 *
 * Setup carries no metadata editor and no metadata catalog: its
 * `/apps/<app>/metadata/...` routes redirect into Studio's "All metadata" area
 * (`setupMetadataRedirect.ts`). A Studio file that still linked there would
 * send the user out of Studio and straight back. This pin reads every
 * non-test source under `views/studio-design/`, comments masked, and refuses
 * any `/apps/<app>/metadata` spelling. (The retired Setup › Packaged
 * automation page has its own pin, `noRetiredSetupLink-28578.test.ts`.)
 *
 * ⛔ The datasource is exempt: it stays in Setup (D1), and the area's
 * `datasource/*` route sends it to Setup's Datasources page
 * (`SETUP_DATASOURCES_PATH`).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';

const mask: (source: string) => string = maskComments;

const here = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A Setup metadata URL, written out or composed: `/apps/setup/metadata`,
 * `/apps/${app}/metadata`, `apps/setup/component/metadata/…` — but not the
 * datasource's.
 */
const SETUP_METADATA_LINK =
  /\/?apps\/(?:[\w-]+|\$\{[^}]*\})\/(?:component\/)?metadata(?![\w-])(?!\/datasource(?![\w-]))/g;

function setupLinks(source: string): string[] {
  return [...mask(source).matchAll(SETUP_METADATA_LINK)].map((m) => m[0]);
}

describe('Studio links into no Setup metadata page (ADR-0146 D1)', () => {
  it('the matcher sees each spelling and spares the datasource', () => {
    expect(setupLinks("const a = '/apps/setup/metadata/object';")).toEqual(['/apps/setup/metadata']);
    expect(setupLinks('const b = `/apps/${appName}/metadata/${type}`;')).toEqual(['/apps/${appName}/metadata']);
    expect(setupLinks("navigate('/apps/setup/metadata')")).toEqual(['/apps/setup/metadata']);
    expect(setupLinks("const c = '/apps/setup/component/metadata/resource?type=object';")).toHaveLength(1);
    expect(setupLinks("const d = '/apps/setup/metadata/datasource';")).toEqual([]);
    expect(setupLinks("const e = '/apps/setup/metadata/datasource/main';")).toEqual([]);
    // Not a Setup metadata URL at all.
    expect(setupLinks("const f = '/studio/~all/metadata/object';")).toEqual([]);
    expect(setupLinks("const g = '/apps/setup/metadata_import';")).toEqual([]);
    // A comment is prose, not a link.
    expect(setupLinks('// opens /apps/setup/metadata/object\nconst h = 1;')).toEqual([]);
  });

  it('no Studio source links into /apps/<app>/metadata', () => {
    const files = sourceFiles(here);
    // Control: the walk really reads the folder.
    expect(files.some((file) => file.endsWith('StudioDesignSurface.tsx'))).toBe(true);
    expect(files.some((file) => file.endsWith('BuilderLanding.tsx'))).toBe(true);

    const offenders = files.flatMap((file) =>
      setupLinks(readFileSync(file, 'utf8')).map((link) => `${path.basename(file)}: ${link}`),
    );
    expect(offenders).toEqual([]);
  });
});
