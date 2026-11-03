// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio links into no retired Setup page (objectstack ADR-0146; N-28).
 *
 * Setup › Packaged automation retired with D11: a packaged flow's switch and
 * its copy (New similar) are Studio's, and the page's actions half is Setup's
 * own `automation:packaged-actions` entry. A Studio file that still linked to
 * the retired page would open a route nothing serves. This pin reads every
 * non-test source under `views/studio-design/`, comments masked, and refuses
 * any spelling of the retired ref or its URL.
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

/** The retired ref (`automation:packaged`) or its URL (`…/component/automation/packaged`), not the actions entry. */
const RETIRED = /automation[:/]packaged(?![\w-])/g;

describe('Studio links into no retired Setup page (ADR-0146)', () => {
  it('the matcher sees the ref and the URL, and spares the actions entry', () => {
    expect("'/apps/setup/component/automation/packaged'".match(RETIRED)).toHaveLength(1);
    expect("const REF = 'automation:packaged';".match(RETIRED)).toHaveLength(1);
    expect("'automation:packaged-actions'".match(RETIRED)).toBeNull();
    expect(mask('// was automation:packaged\nconst a = 1;').match(RETIRED)).toBeNull();
  });

  it('no Studio source opens the retired Setup › Packaged automation page (D11)', () => {
    const files = sourceFiles(here);
    // Control: the walk really reads the folder.
    expect(files.some((file) => file.endsWith('StudioDesignSurface.tsx'))).toBe(true);
    expect(files.some((file) => file.endsWith('BuilderLanding.tsx'))).toBe(true);

    const offenders = files.flatMap((file) =>
      [...mask(readFileSync(file, 'utf8')).matchAll(RETIRED)].map((m) => `${path.basename(file)}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });
});
