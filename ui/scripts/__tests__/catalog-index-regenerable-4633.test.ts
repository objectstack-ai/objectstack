import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#4633 — `pnpm --filter @object-ui/example-schema-catalog regenerate`
 * must be safe to run on an untouched tree.
 *
 * The defect: `scripts/regenerate-catalog-index.py` derived every `title` from
 * the filename and wrote `description: ""` unconditionally. Running the
 * documented regenerate command on a clean `origin/main` reported success
 * ("Wrote ... with 423 entries.") while producing a 29-insertion diff that
 * DISCARDED hand-written metadata for ten entries — six of them
 * `plugin-dashboard` entries whose strings are user-visible on
 * /docs/guide/schema-catalog. Anyone adding a catalog entry is expected to run
 * the script, so every addition silently reverted somebody else's curation, and
 * the diff looked like ordinary generated-file churn in review.
 *
 * The fix moves curated strings into `src/catalog-meta.json`, which the
 * generator only ever READS, and makes the ordering path-aware. This file pins
 * both halves:
 *
 *  - the checked-in `index.ts` still matches what the generator produces
 *    (`--check`), so a hand-edit to the generated file — or a curated title
 *    added there instead of to the sidecar — fails here rather than silently
 *    at the next author's regeneration;
 *  - in a hermetic sandbox, that adding an entry and regenerating leaves every
 *    existing curated string byte-identical, that the ordering is by
 *    (category, slug), and that `--check` genuinely goes red when the generated
 *    file drifts.
 *
 * The sandbox half is what makes the first half trustworthy: a `--check` that
 * could never fail would pass forever over a broken generator.
 *
 * Reverse verification (direction predicted before running, both measured RED):
 *  - restore the filename-derived title / empty description in the generator
 *    and `the checked-in index.ts matches its generator` fails, printing the
 *    curated strings it would discard;
 *  - restore the sort over the filename and the same assertion fails on
 *    `filtered-dashboard` ordering after its `filtered-dashboard-*` siblings.
 *
 * The generator is Python because it always has been, and
 * `examples/schema-catalog/package.json` documents `python3` as the way to run
 * it; shelling out here keeps ONE source of truth for the output format rather
 * than re-implementing it in TypeScript and letting the two drift.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const GENERATOR = path.join(repoRoot, 'scripts', 'regenerate-catalog-index.py');
const CATALOG = path.join(repoRoot, 'examples', 'schema-catalog');

/** Run the generator rooted at `root`; returns stdout+stderr and the exit code. */
function runGenerator(
  root: string,
  args: string[] = [],
): { status: number; output: string } {
  try {
    const stdout = execFileSync(
      'python3',
      [path.join(root, 'scripts', 'regenerate-catalog-index.py'), ...args],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { status: 0, output: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** A minimal repo-shaped tree the generator can run against. */
function sandbox(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-regen-4633-'));
  const schemas = path.join(root, 'examples', 'schema-catalog', 'src', 'schemas');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(GENERATOR, path.join(root, 'scripts', 'regenerate-catalog-index.py'));

  fs.mkdirSync(path.join(schemas, 'plugin-dashboard'), { recursive: true });
  for (const slug of [
    'filtered-dashboard',
    'filtered-dashboard-date-presets',
    'support-dashboard',
  ]) {
    fs.writeFileSync(
      path.join(schemas, 'plugin-dashboard', `${slug}.json`),
      `${JSON.stringify({ type: 'dashboard' })}\n`,
    );
  }
  fs.writeFileSync(
    path.join(root, 'examples', 'schema-catalog', 'src', 'catalog-meta.json'),
    `${JSON.stringify(
      {
        'plugin-dashboard/filtered-dashboard-date-presets': {
          title: 'Filtered Dashboard — Date Presets + Custom Range',
          description:
            'Built-in dateRange with presets and allowCustomRange; per-widget date-field override',
          tags: ['dashboard', 'filters'],
        },
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

const indexOf = (root: string): string =>
  fs.readFileSync(
    path.join(root, 'examples', 'schema-catalog', 'src', 'index.ts'),
    'utf8',
  );

describe('objectui#4633 — the catalog index is reproducible from its generator', () => {
  it('the checked-in index.ts matches its generator', () => {
    const { status, output } = runGenerator(repoRoot, ['--check']);
    expect(
      output,
      'examples/schema-catalog/src/index.ts drifted from ' +
        'scripts/regenerate-catalog-index.py. Regenerate and commit, and put curated ' +
        'titles/descriptions in src/catalog-meta.json — never in the generated file.',
    ).toContain('is up to date');
    expect(status).toBe(0);
  });

  it('every id curated in catalog-meta.json still has an entry on disk', () => {
    const curated = JSON.parse(
      fs.readFileSync(path.join(CATALOG, 'src', 'catalog-meta.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(curated).length).toBeGreaterThan(0);
    for (const id of Object.keys(curated)) {
      const [category, slug] = id.split('/');
      expect(
        fs.existsSync(path.join(CATALOG, 'src', 'schemas', category, `${slug}.json`)),
        `catalog-meta.json curates "${id}", which has no schema file`,
      ).toBe(true);
    }
  });

  it('adding an entry leaves existing curated metadata byte-identical', () => {
    const root = sandbox();
    expect(runGenerator(root).status).toBe(0);
    const before = indexOf(root);
    const curatedBlock = before.slice(
      before.indexOf("  'plugin-dashboard/filtered-dashboard-date-presets': {"),
      before.indexOf('    schema: plugin_dashboard_filtered_dashboard_date_presets,'),
    );
    expect(curatedBlock).toContain(
      'title: "Filtered Dashboard — Date Presets + Custom Range"',
    );
    expect(curatedBlock).toContain('tags: ["dashboard", "filters"]');

    fs.writeFileSync(
      path.join(
        root,
        'examples/schema-catalog/src/schemas/plugin-dashboard/brand-new-entry.json',
      ),
      `${JSON.stringify({ type: 'dashboard' })}\n`,
    );
    expect(runGenerator(root).status).toBe(0);
    const after = indexOf(root);

    expect(after).toContain("'plugin-dashboard/brand-new-entry'");
    expect(after).toContain(curatedBlock);
  });

  it('orders entries by (category, slug), not by filename', () => {
    const root = sandbox();
    expect(runGenerator(root).status).toBe(0);
    const body = indexOf(root).split('const REGISTRY: Record<string, Example> = {')[1];
    const ids = [...body.matchAll(/^ {2}'([^']+)': \{$/gm)].map((m) => m[1]);
    // Sorting on the filename compares ".json" and puts the bare slug LAST,
    // because '-' < '.'; sorting on the parsed slug keeps the prefix first.
    expect(ids).toEqual([
      'plugin-dashboard/filtered-dashboard',
      'plugin-dashboard/filtered-dashboard-date-presets',
      'plugin-dashboard/support-dashboard',
    ]);
  });

  it('--check fails when the generated file is edited by hand', () => {
    const root = sandbox();
    expect(runGenerator(root).status).toBe(0);
    expect(runGenerator(root, ['--check']).status).toBe(0);

    const indexPath = path.join(root, 'examples/schema-catalog/src/index.ts');
    fs.writeFileSync(
      indexPath,
      indexOf(root).replace('description: ""', 'description: "hand-typed, will be lost"'),
    );
    const { status, output } = runGenerator(root, ['--check']);
    expect(status).not.toBe(0);
    expect(output).toContain('does not match its generator');
    expect(output).toContain('catalog-meta.json');
  });

  it('refuses curated metadata for an id with no entry on disk', () => {
    const root = sandbox();
    const metaPath = path.join(root, 'examples/schema-catalog/src/catalog-meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    meta['plugin-dashboard/deleted-long-ago'] = { title: 'Gone' };
    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

    const { status, output } = runGenerator(root);
    expect(status).not.toBe(0);
    expect(output).toContain('plugin-dashboard/deleted-long-ago');
  });
});
