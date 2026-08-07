// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the declared protocol-module titles (#5853) from both ends.
 *
 * The bug was `qa` rendering as **"Qa Protocol"** in three published places at
 * once, because `build-docs.ts` guessed the title from the directory name and
 * upper-cased only the three abbreviations someone had thought of
 * (`['UI', 'AI', 'API']`). `qa` is the fourth.
 *
 * What makes this worth more than one line of test: the wrong title was
 * **undetectable**. `check:docs` compares generation against what was
 * committed, so a stable wrong title is green forever — `Qa Protocol` survived
 * every regeneration from the day `src/qa/` was created until #4759 printed 14
 * titles side by side and a human read it. So the pin has to cover the shape,
 * not just the instance:
 *
 *  - **the table** — `qa` resolves to `QA Protocol`, every abbreviation module
 *    keeps its capitalisation, and the declared keys match the directories on
 *    disk in both directions;
 *  - **the visibility property** the declared table was chosen for — a module
 *    directory with no entry is REPORTED BY NAME, where the old shape silently
 *    invented `Iam Protocol`. This is the assertion that would have to be
 *    deleted, not merely edited, to bring the silence back;
 *  - **the artifacts** — the three committed landing sites. Without these,
 *    deleting the generator's use of the table would leave every unit test
 *    green while the published pages went back to `Qa Protocol` (the same
 *    reason `root-index.test.ts` asserts over the committed `.mdx`).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CATEGORY_TITLES,
  categoryTitleCoverage,
  formatCategoryTitleCoverage,
  resolveCategoryTitles,
} from './lib/category-title';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(HERE, '../src');
const DOCS_ROOT = resolve(HERE, '../../../content/docs/references');

const moduleDirsOnDisk = () =>
  readdirSync(SRC_DIR)
    .filter(entry => statSync(join(SRC_DIR, entry)).isDirectory())
    .sort();

describe('CATEGORY_TITLES', () => {
  it('titles qa as "QA Protocol" — the abbreviation the derived shape downgraded (#5853)', () => {
    expect(CATEGORY_TITLES.qa).toBe('QA Protocol');
    expect(CATEGORY_TITLES.qa).not.toBe('Qa Protocol');
  });

  it('keeps every abbreviation module upper-cased, not title-cased', () => {
    // The four abbreviations among the module directories. `qa` sat outside the
    // old hard-coded trio for no reason other than nobody having added it, and
    // `src/qa/index.ts` itself opens with "Quality Assurance (QA) Protocol".
    expect({
      ai: CATEGORY_TITLES.ai,
      api: CATEGORY_TITLES.api,
      qa: CATEGORY_TITLES.qa,
      ui: CATEGORY_TITLES.ui,
    }).toEqual({
      ai: 'AI Protocol',
      api: 'API Protocol',
      qa: 'QA Protocol',
      ui: 'UI Protocol',
    });
  });

  it('declares a title for exactly the module directories under packages/spec/src', () => {
    // Both directions, against the real tree — the same rule `blurbCoverage`
    // holds the root-index blurbs to. A missing entry is the bug this file
    // exists for; a stale entry is a display name outliving its directory.
    expect(Object.keys(CATEGORY_TITLES).sort()).toEqual(moduleDirsOnDisk());
  });

  it('resolves the real tree without throwing, and titles every directory in it', () => {
    const dirs = moduleDirsOnDisk();
    const resolved = resolveCategoryTitles(dirs);

    expect(Object.keys(resolved).sort()).toEqual(dirs);
    expect(Object.values(resolved).every(title => title.length > 0)).toBe(true);
  });
});

describe('categoryTitleCoverage — the property the declared table was chosen for', () => {
  const declared = { ai: 'AI Protocol', qa: 'QA Protocol' };

  it('is silent when the declarations and the directories agree', () => {
    expect(categoryTitleCoverage(['ai', 'qa'], declared)).toEqual({ missing: [], extra: [] });
  });

  it('REPORTS a new module directory instead of inventing a title for it', () => {
    // The regression this replaces, in its next incarnation: under the old
    // "upper-case then look the abbreviation up in a list" shape, a new `iam`
    // directory silently published "Iam Protocol" and no gate could see it,
    // because a wrong title is a stable one. Now the run cannot produce a
    // title at all until someone declares it.
    const coverage = categoryTitleCoverage(['ai', 'iam', 'qa'], declared);

    expect(coverage.missing).toEqual(['iam']);
    expect(coverage.extra).toEqual([]);
    expect(() => resolveCategoryTitles(['ai', 'iam', 'qa'], declared)).toThrow(/iam/);
  });

  it('reports a title whose directory is gone, so a display name cannot outlive it', () => {
    const coverage = categoryTitleCoverage(['ai'], declared);

    expect(coverage.missing).toEqual([]);
    expect(coverage.extra).toEqual(['qa']);
    expect(() => resolveCategoryTitles(['ai'], declared)).toThrow(/qa/);
  });

  it('names the directory, the file to edit, and the line to add', () => {
    // A message that only said "coverage mismatch" would send the reader back
    // to the guessing shape to work out what to write.
    const message = formatCategoryTitleCoverage(categoryTitleCoverage(['ai', 'iam', 'qa'], declared));

    expect(message).toContain('iam');
    expect(message).toContain('scripts/lib/category-title.ts');
    expect(message).toContain('add one line');
  });
});

describe('the committed landing sites', () => {
  // The three places the title is published, per #5853. Read from disk rather
  // than regenerated: this is the assertion that fails if the generator stops
  // using the table, or if someone hand-edits a generated page back.
  const read = (rel: string) => {
    const abs = join(DOCS_ROOT, rel);
    expect(existsSync(abs), `${rel} should exist`).toBe(true);
    return readFileSync(abs, 'utf-8');
  };

  it('gives the qa category page the title "QA Protocol"', () => {
    expect(read('qa/index.mdx')).toContain('title: QA Protocol');
  });

  it('gives the qa sidebar entry the label "QA Protocol"', () => {
    expect(JSON.parse(read('qa/meta.json')).title).toBe('QA Protocol');
  });

  it('spells it "QA Protocol" in the root index nav row and section heading', () => {
    const index = read('index.mdx');

    expect(index).toContain('[QA Protocol](/docs/references/qa)');
    expect(index).toContain('## QA Protocol');
  });

  it('leaves no "Qa Protocol" anywhere under content/docs/references', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(abs);
        } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.json')) {
          if (readFileSync(abs, 'utf-8').includes('Qa Protocol')) offenders.push(abs);
        }
      }
    };
    walk(DOCS_ROOT);

    expect(offenders).toEqual([]);
  });
});
