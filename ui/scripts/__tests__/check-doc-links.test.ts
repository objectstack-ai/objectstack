import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import {
  SCAN_ROOTS,
  collectBrokenLinks,
  collectFiles,
  collectSiteRoutes,
  diskPathExists,
  headingAnchors,
  routeExists,
  selfRepoPath,
  siteAbsoluteRoute,
  siteUrlExists,
  stripCode,
} from '../check-doc-links.mjs';
import { GithubSlugger as VendoredSlugger, slug as vendoredSlug } from '../github-slug.mjs';

/**
 * objectui#3479 — the behaviour test for `scripts/check-doc-links.mjs`.
 *
 * The gate was wired into CI by #3450 (see `docs-links-workflow.test.ts`, which
 * pins the wiring). What nothing pinned was what it actually *checked*: its
 * `routeExists()` opened with an early `return true` for any href not starting
 * with `/docs`, so every relative link in the tree was waved through unresolved.
 * 33 references to 16 non-existent targets had accumulated behind it.
 *
 * These tests pin the two halves that early return hid, in the two shapes the
 * site actually resolves:
 *
 *   - a RELATIVE href names the target FILE, extension included — that is what
 *     fumadocs' `source.resolveHref` looks up (its page index is keyed by source
 *     file path *with* extension), via `createRelativeLink` in
 *     `apps/site/app/docs/[[...slug]]/page.tsx`;
 *   - an ABSOLUTE `/docs/...` href names an extensionless ROUTE — `resolveHref`
 *     never touches it, so it reaches the browser verbatim.
 *
 * The A-class defect in #3479 is exactly the first shape violated: 13 links
 * spelled `../plugins/plugin-*.md` while every one of those files is `.mdx`.
 *
 * objectui#3490 removed the two waivers those checks were still built on — a
 * non-`/docs` absolute href was waved through unchecked, and a relative href was
 * judged purely as a path on disk. Both answered "does a file exist?" when the
 * question is "does the site serve this URL?", and 18 live 404s had collected
 * behind them. The gate now enumerates `apps/site/app` + `apps/site/public` as
 * its truth source for absolute hrefs, and rejects relative hrefs that resolve
 * out of the docs collection. The describes at the bottom pin both.
 *
 * objectui#3536 extended the gate in two directions, and the last three
 * describes pin them:
 *
 *   - the SCAN SURFACE now includes `examples/**` and the root `README.md`,
 *     under a *different* rule — those files are read on GitHub, so a relative
 *     href there names a path on DISK, not a fumadocs route. The tests that
 *     matter most are the contrast pairs: the same href accepted under one rule
 *     and rejected under the other, in both directions;
 *   - the HREF SHAPE `https://github.com/objectstack-ai/objectui/(blob|tree)/
 *     main/<path>` is now resolved against the working tree in every surface —
 *     an in-repo reference that had been skipped by scheme, and sat dead for
 *     three months between two gates (#3507).
 *
 * objectui#3572 added the three surfaces #3536 had listed as "still not
 * bought": `CONTRIBUTING.md`, `ROADMAP.md` and the internal `docs/` tree, all
 * under the existing `disk` rule. Their backlog was paid first and separately
 * (#3545 / PR #3571 — three dead links), so the rows arrived at zero. Two
 * things in that describe are worth reading before editing it: the pair that
 * keeps `docs/` and `content/docs/` on opposite rules, and the pair that pins
 * the FENCE BOUNDARY — `stripCode()` hides a link inside a code fence from this
 * gate, dead or not, and that limit is pinned as a decision rather than left to
 * be discovered as coverage that was never there (#3570 is the live instance).
 *
 * objectui#3603 closed the second half of the by-scheme skip, and the last
 * describe pins it: a URL on this project's OWN site
 * (`https://www.objectui.org/docs/...`) is an internal route wearing an origin,
 * and `judgeHref()` waved every one of them through. It is now stripped to an
 * absolute site path and handed to the same `routeExists()` — so the tests that
 * matter most there are the INHERITANCE ones: a `.md` extension is rejected
 * because the `/docs` branch is strict, and a non-`/docs` path is judged by the
 * `apps/site` route table. Neither behaviour is re-implemented, and these tests
 * fail if either is.
 *
 * That card's OTHER half — adding the package READMEs to SCAN_ROOTS — was
 * deliberately not bought at the time, because measuring it first turned up 11
 * more dead links in packages the card never touched. objectui#3622 paid those
 * 11 and added the row, and the last describe pins it. Two things there are
 * worth reading before editing it: the scan root carries the table's only
 * wildcard segment, so `collectFiles` has an expansion step whose failure mode
 * is a surface that silently expands to nothing — which is why the row's floor
 * is pinned on DECIDABLE HREFS and not only on file count — and the fixture
 * pair that keeps the row on the `disk` rule, since a package README is read on
 * npm and GitHub and never served by the site.
 *
 * objectui#4148 bought the two surfaces the script's header had been DOCUMENTING
 * as unscanned — the app READMEs and the rest of the root-level markdown — and
 * the final describe pins them. The live instance was two links in
 * `apps/console/README.md` that had been dead for six months under a green gate.
 * One test there is unlike every other in this file: it asserts over the REAL
 * tree, requiring every tracked root-level markdown file to have a row. That is
 * deliberate. The root has no glob spelling, so its completeness is a per-file
 * list, and a list is exactly the thing that goes stale — the assertion is what
 * makes "all of them" survive the next page someone adds.
 *
 * objectui#4938 bought the surface #4148 had left on its own "still not bought"
 * list: everything under each package/app directory that is not already a
 * `README.md` (the #3622/#4148 rows) or a per-package `CHANGELOG.md`
 * (changesets output, never authored prose). The two new rows are `disk` rule,
 * with a `SCAN_ROOTS`-row `exclude` list — new here — naming the basenames
 * `walk()` leaves out at every depth so the row does not re-judge the
 * single-file README rows above it or pull in a nested `README.md`, which is a
 * real, separately-unscanned surface this card's own measurement deliberately
 * left out (see the script's header). The live instance: a dead link in
 * `packages/components/src/renderers/complex/TIMELINE.md` pointing at an
 * example app deleted whole months earlier, fixed in the same PR as the row.
 *
 * objectui#6026 bought the gap objectui#4938 had measured and deliberately
 * left: a `README.md` that is not at a package's top level was excluded from
 * the new rows by basename at every depth, and was never in range of the exact
 * top-level globs above them either, so four real files were seen by no gate.
 * The last describe pins the row that takes them, and two things there are
 * worth reading before editing it. First, ENTRY PRICE ZERO: the four files
 * carried no dead link, so a green run proves nothing on its own — the tests
 * therefore assert the SURFACE (derived from the tree, not from a list in this
 * file) rather than the verdict. Second, the no-double-parse guarantee is now
 * asserted repo-wide instead of argued: every file the scan opens is opened by
 * exactly one row, which is what makes the new rows safe to sit alongside the
 * two rows that already walk the same directories.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoots: string[] = [];

/**
 * The default site fixture: the shapes the real `apps/site/app` uses — a route
 * group serving `/`, a plain segment, an optional catch-all, a nested route
 * handler — plus one static file under `public/`.
 */
const SITE_FIXTURE: Record<string, string> = {
  'apps/site/app/(home)/page.tsx': 'export default () => null',
  'apps/site/app/playground/page.tsx': 'export default () => null',
  'apps/site/app/docs/[[...slug]]/page.tsx': 'export default () => null',
  'apps/site/app/api/search/route.ts': 'export const GET = () => null',
  'apps/site/public/img/guide/shot.png': 'PNG',
};

/** Materialises `{ 'content/docs/guide/a.md': '...' }` into a throwaway repo. */
function repoWith(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-doc-links-'));
  tempRoots.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

/** Docs-only sugar: keys are relative to `content/docs`, site fixture implied. */
function docsRootWith(files: Record<string, string>): string {
  const prefixed = Object.fromEntries(Object.entries(files).map(([rel, body]) => [`content/docs/${rel}`, body]));
  return path.join(repoWith({ ...SITE_FIXTURE, ...prefixed }), 'content/docs');
}

function scan(repo: string): { file: string; href: string; line: number; reason: string }[] {
  return collectBrokenLinks(repo);
}

/** `[href, reason]` for every rejection, in scan order. */
function rejections(files: Record<string, string>): [string, string][] {
  return scan(repoWith(files)).map((item) => [item.href, item.reason]);
}

/** The hrefs reported broken, in file order. */
function brokenHrefs(files: Record<string, string>): string[] {
  const docsRoot = docsRootWith(files);
  const repo = path.resolve(docsRoot, '../..');
  return scan(repo).map((item) => item.href);
}

/** A `SCAN_ROOTS` row, as this file reads it — the module is `.mjs`, so untyped. */
interface ScanRoot {
  readonly path: string;
  readonly rule: string;
  readonly exclude?: string[];
  readonly collect?: string[];
}

/** Every file the real scan opens, tagged with the row that opened it. */
function scannedByRow(): { file: string; row: string }[] {
  const opened: { file: string; row: string }[] = [];
  for (const row of SCAN_ROOTS as ScanRoot[]) {
    const files = collectFiles(
      path.join(repoRoot, row.path),
      row.exclude ? new Set(row.exclude) : undefined,
      row.collect ? new Set(row.collect) : undefined,
    ) as string[];
    for (const file of files) opened.push({ file: path.relative(repoRoot, file), row: row.path });
  }
  return opened;
}

/**
 * The nested-README population, derived from the tree rather than listed here
 * (objectui#6026). An UNFILTERED walk of the same two wildcard roots is the
 * oracle: whatever markdown is really under a package or app directory, minus
 * the top-level `README.md` each package row already owns — which is a path
 * shape (`<top>/<name>/README.md`), not a rule `walk()` knows.
 */
function nestedReadmes(): string[] {
  const found: string[] = [];
  for (const top of ['packages/*', 'apps/*']) {
    for (const file of collectFiles(path.join(repoRoot, top)) as string[]) {
      const segments = path.relative(repoRoot, file).split(path.sep);
      if (segments[segments.length - 1] === 'README.md' && segments.length > 3) found.push(segments.join('/'));
    }
  }
  return found.sort();
}

afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

const FENCE = '```';

describe('relative hrefs are resolved — the hole objectui#3479 closed', () => {
  it('reports a relative link whose target does not exist', () => {
    expect(
      brokenHrefs({
        'guide/a.md': '[gone](./nowhere.md)',
      }),
    ).toEqual(['./nowhere.md']);
  });

  it('reports the #3479 A-class shape: link says .md, file is .mdx', () => {
    // The single assertion that dies if the `startsWith('/docs') -> return true`
    // early return ever comes back. 13 of the 16 broken targets were this.
    expect(
      brokenHrefs({
        'guide/plugins.md': '[Charts](../plugins/plugin-charts.md)',
        'plugins/plugin-charts.mdx': '# Charts',
      }),
    ).toEqual(['../plugins/plugin-charts.md']);
  });

  it('accepts the same link once it names the real file', () => {
    expect(
      brokenHrefs({
        'guide/plugins.md': '[Charts](../plugins/plugin-charts.mdx)',
        'plugins/plugin-charts.mdx': '# Charts',
      }),
    ).toEqual([]);
  });

  it('accepts a relative link to a real .md file', () => {
    expect(
      brokenHrefs({
        'guide/a.md': '[b](./b.md)',
        'guide/b.md': '# B',
      }),
    ).toEqual([]);
  });

  it('accepts the extensionless-route spelling of a relative link', () => {
    // Not the recommended form — it misses fumadocs' resolver and only works by
    // browser URL-relative resolution — but it is not a broken link, and this
    // gate does not invent style rules.
    expect(
      brokenHrefs({
        'guide/plugins.md': '[Charts](../plugins/plugin-charts)',
        'plugins/plugin-charts.mdx': '# Charts',
      }),
    ).toEqual([]);
  });

  it('accepts a relative link to a directory index', () => {
    expect(
      brokenHrefs({
        'guide/a.md': '[plugins](../plugins)',
        'plugins/index.md': '# Plugins',
      }),
    ).toEqual([]);
  });

  it('rejects a relative link to a directory that has no index page', () => {
    expect(
      brokenHrefs({
        'guide/a.md': '[plugins](../plugins)',
        'plugins/plugin-charts.mdx': '# Charts',
      }),
    ).toEqual(['../plugins']);
  });

  it('resolves relative to the linking file, not the docs root', () => {
    // `./b.md` from `guide/a.md` is `guide/b.md` — a root-relative reading would
    // look for `b.md` at the top level and call a valid link broken.
    expect(
      brokenHrefs({
        'guide/a.md': '[b](./b.md)',
        'guide/b.md': '# B',
        'b.md': '# decoy at the root',
      }),
    ).toEqual([]);

    expect(
      brokenHrefs({
        'guide/a.md': '[b](./b.md)',
        'b.md': '# only at the root',
      }),
    ).toEqual(['./b.md']);
  });

  it('resolves the fragment against the target document, and ignores the query', () => {
    // Was 'ignores the fragment and query when resolving' — the fragment half
    // is objectui#7644's, and this fixture used to pass BECAUSE `#a-section`
    // was never looked at. `b.md` now has the heading it names.
    expect(
      brokenHrefs({
        'guide/a.md': '[b](./b.md#a-section) and [c](./b.md?x=1)',
        'guide/b.md': '# B\n\n## A section',
      }),
    ).toEqual([]);
  });

  it('reports a cross-file fragment naming a heading the target does not have', () => {
    expect(
      brokenHrefs({
        'guide/a.md': '[b](./b.md#a-section)',
        'guide/b.md': '# B\n\n## Another section',
      }),
    ).toEqual(['./b.md#a-section']);
  });
});

describe('absolute /docs hrefs stay strict — they are routes, not files', () => {
  it('accepts an extensionless route', () => {
    expect(
      brokenHrefs({
        'guide/a.md': '[plugins](/docs/plugins/plugin-charts)',
        'plugins/plugin-charts.mdx': '# Charts',
      }),
    ).toEqual([]);
  });

  it('rejects a /docs route carrying a file extension, even when that file exists', () => {
    // `next.config.mjs` rewrites only `/docs/:path*.mdx` (to the raw-markdown
    // llms route); `/docs/guide/b.md` is a 404 on the site whatever is on disk.
    // A relative-link check that resolved absolute hrefs on the filesystem too
    // would quietly bless both.
    expect(
      brokenHrefs({
        'guide/a.md': '[b](/docs/guide/b.md)',
        'guide/b.md': '# B',
      }),
    ).toEqual(['/docs/guide/b.md']);
  });

  it('accepts /docs itself when the root has an index page', () => {
    expect(brokenHrefs({ 'index.md': '[home](/docs)' })).toEqual([]);
  });

  it('is checked before the site-route table, so the /docs rule stays the strict one', () => {
    // `/docs/[[...slug]]` is a real route in the site fixture, so the generic
    // route matcher would accept `/docs/guide/b.md`. It must not get the chance:
    // the extension makes it a 404, and the `/docs` branch above owns that call.
    expect(
      brokenHrefs({
        'guide/a.md': '[b](/docs/guide/b.md)',
        'guide/b.md': '# B',
      }),
    ).toEqual(['/docs/guide/b.md']);
  });
});

describe('external and non-path hrefs are left alone', () => {
  it('skips schemes and empty targets, and resolves an in-page anchor', () => {
    // Was 'skips schemes, in-page anchors and empty targets'. Anchors stopped
    // being skipped in objectui#7644; the other three shapes are unchanged, and
    // the heading this one names is now in the fixture.
    expect(
      brokenHrefs({
        'guide/a.md': [
          '# A',
          '## Section',
          '[web](https://example.com/nope)',
          '[mail](mailto:a@b.c)',
          '[tel](tel:+1000)',
          '[anchor](#section)',
        ].join('\n\n'),
      }),
    ).toEqual([]);
  });

  it('reports an in-page anchor with no matching heading — the objectui#7644 hole', () => {
    expect(
      brokenHrefs({ 'guide/a.md': '# A\n\n## Section\n\n[anchor](#renamed-section)' }),
    ).toEqual(['#renamed-section']);
  });
});

describe('code is stripped before scanning — markdown syntax quoted in code is not a link', () => {
  it('blanks a fenced block but keeps every newline, so line numbers stay true', () => {
    const source = ['before', FENCE + 'tsx', '[x](./nowhere.md)', FENCE, 'after'].join('\n');
    const stripped = stripCode(source);

    expect(stripped.split('\n')).toHaveLength(source.split('\n').length);
    expect(stripped).toHaveLength(source.length);
    expect(stripped.split('\n')[0]).toBe('before');
    expect(stripped.split('\n')[2].trim()).toBe('');
    expect(stripped.split('\n')[4]).toBe('after');
  });

  it('blanks an inline code span', () => {
    expect(stripCode('- **Links**: `[text](url)`').trim()).toBe('- **Links**:');
  });

  it('does not report the fenced JSX false positive main carries', () => {
    // content/docs/guide/notifications.md:54 — inside a ```tsx fence,
    // `toast[n.severity](n.title, { description: n.message })` matches the link
    // regex with an "href" of `n.title, { description: n.message }`.
    expect(
      brokenHrefs({
        'guide/notifications.md': [
          FENCE + 'tsx',
          'onToast={(n) => toast[n.severity](n.title, { description: n.message })}',
          FENCE,
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('does not report the inline-code false positive main carries', () => {
    // content/docs/fields/rich-text.mdx:47 documents the syntax itself.
    expect(
      brokenHrefs({
        'fields/rich-text.mdx': '- **Links**: `[text](url)`\n- **Images**: `![alt](url)`',
      }),
    ).toEqual([]);
  });

  it('still reports a real link on a line that also contains code', () => {
    expect(
      brokenHrefs({
        'guide/a.md': 'Use `[text](url)` to write [this](./nowhere.md).',
      }),
    ).toEqual(['./nowhere.md']);
  });

  it('closes a fence only on a matching, bare marker', () => {
    const source = [FENCE, '[x](./nowhere.md)', FENCE + 'ts', '[y](./nowhere.md)', FENCE].join('\n');
    expect(stripCode(source).replace(/\s/g, '')).toBe('');
  });
});

describe('the repo it guards', () => {
  it('has no broken internal links in any scanned surface', () => {
    // The other half of objectui#3479: the extended check must land GREEN, not
    // arrive with a backlog it merely describes. objectui#3536 widened what
    // "any scanned surface" means — see the next test, which is what stops this
    // one from passing because nothing was looked at.
    const broken = scan(repoRoot);
    const report = broken.map((b) => `[${b.reason}] ${path.relative(repoRoot, b.file)}:${b.line} -> ${b.href}`);
    expect(report).toEqual([]);
  });

  it('really scans every surface in SCAN_ROOTS — a green above must mean "checked"', () => {
    // objectui#3536. The assertion the widened scan needs most: `collectFiles`
    // returns [] for a root that is not there, so a typo in SCAN_ROOTS, or a
    // rename of `examples/`, would silently drop a whole surface and leave the
    // test above green about a tree it never opened.
    //
    // objectui#3572 — the per-root COUNT lines are the half that does not
    // extend itself. The `Object.keys` assertion below fails loudly on a new
    // row (it did, which is how this test was found to need work), but a row
    // whose count nobody pins is still a surface that could go empty — a typo
    // in `docs` would then leave the whole tree unopened and every test above
    // green. Every root carries its own floor for that reason.
    const scanned = Object.fromEntries(
      (SCAN_ROOTS as ScanRoot[]).map((root) => [
        root.path,
        collectFiles(
          path.join(repoRoot, root.path),
          root.exclude ? new Set(root.exclude) : undefined,
          root.collect ? new Set(root.collect) : undefined,
        ).length,
      ]),
    );

    expect(Object.keys(scanned)).toEqual([
      'content/docs',
      'examples',
      'README.md',
      'CONTRIBUTING.md',
      'ROADMAP.md',
      'docs',
      'packages/*/README.md',
      'apps/*/README.md',
      'packages/*',
      'apps/*',
      'packages/*/*',
      'apps/*/*',
      'AGENTS.md',
      'CHANGELOG.md',
      'CLAUDE.md',
      'LICENSE-THIRD-PARTY.md',
      'QUICK_REFERENCE.md',
    ]);
    expect(scanned['README.md']).toBe(1);
    expect(scanned['CONTRIBUTING.md']).toBe(1);
    expect(scanned['ROADMAP.md']).toBe(1);
    expect(scanned['examples']).toBeGreaterThanOrEqual(4);
    expect(scanned['docs']).toBeGreaterThanOrEqual(15);
    expect(scanned['content/docs']).toBeGreaterThanOrEqual(100);
    // objectui#3622. 38 of the 39 package directories carry a README today
    // (`sdui-parser` does not), and this row is the only one whose path needs
    // expanding before anything is opened — so a floor here is also the floor
    // under `expandWildcard()`.
    expect(scanned['packages/*/README.md']).toBeGreaterThanOrEqual(35);
    // objectui#4148. Both apps carry one today; the floor is 2 rather than the
    // exact count because this row exists precisely so the NEXT app is scanned
    // without anyone editing the table.
    expect(scanned['apps/*/README.md']).toBeGreaterThanOrEqual(2);
    // objectui#4938. Measured at 15 files (12 under packages/*, 3 under
    // apps/*) the day the row landed; a floor rather than an exact count for
    // the same reason as every wildcard row above — the surface is meant to
    // pick up the next file someone adds, not stay pinned to today's.
    // objectui#5965 removed `packages/vscode-extension/SUMMARY.md` (a one-off
    // session artifact asserting a CodeQL scan this repo never ran), taking
    // the packages/* population from 12 to 11. The floor moves down by exactly
    // that one deliberate deletion — it still fails if the scanner itself
    // stops walking the tree, which is what this row guards.
    expect(scanned['packages/*']).toBeGreaterThanOrEqual(11);
    expect(scanned['apps/*']).toBeGreaterThanOrEqual(3);
    // objectui#6026. Four nested READMEs today, all under `packages/*`; the
    // `apps/*` side of the pair is deliberately empty, which is why it gets NO
    // count floor — a `toBe(0)` here would redden the first PR that writes a
    // nested README under an app, and that PR is the row working. What keeps
    // the empty row honest instead is the partition test in that card's
    // describe: it derives the nested-README population from the tree and
    // requires every one of them to be opened, so an `apps/*` row that stopped
    // expanding would fail there the day it started mattering.
    expect(scanned['packages/*/*']).toBeGreaterThanOrEqual(4);
    for (const rootFile of ['AGENTS.md', 'CHANGELOG.md', 'CLAUDE.md', 'LICENSE-THIRD-PARTY.md', 'QUICK_REFERENCE.md']) {
      expect(scanned[rootFile], `${rootFile} is a SCAN_ROOTS row that opened no file`).toBe(1);
    }
  });

  it('pairs each scan root with the link semantics that root actually has', () => {
    // The rule split is the design decision of objectui#3536, so it is pinned
    // as data: `examples/**` and the root README are read on GitHub (disk
    // paths), `content/docs` is served by fumadocs (site routes).
    //
    // objectui#3572 added the last three, all `disk` — they are read on GitHub
    // like the first two. The table is the whole configuration surface, so it
    // is pinned whole: a row silently changing rule would re-judge a tree.
    //
    // objectui#3622 added the package READMEs, `disk` for the same reason and
    // one more: they are read on **npm** as well, where a leading `/` is no
    // more this repo's root than it is on github.com.
    //
    // objectui#4148 added the app READMEs and the rest of the root-level
    // markdown, every one `disk`. `@object-ui/console` is a published package,
    // so its README is read in exactly the two places a package README is; the
    // root files are read on GitHub. Nothing here is served by the site, and a
    // row that quietly took the `docs` rule would re-judge a whole tree — which
    // is why the table is pinned whole rather than by length.
    //
    // objectui#4938 added the rest of each package/app directory tree, also
    // `disk` — same files, same reason. The `exclude` list on each row is part
    // of this pin too: it is what keeps the new rows from re-judging the
    // README rows right above them, or from silently widening onto the
    // per-package `CHANGELOG.md` files this card explicitly did not buy.
    //
    // objectui#6026 added the nested-README rows, `disk` again. Two parts of
    // them are pinned here rather than left to reading: `collect` (the only
    // basenames the walk keeps — the inverse of `exclude`, and the thing that
    // stops these rows from becoming a second copy of the two above them), and
    // the SECOND wildcard segment in each path, which is the whole reason the
    // top-level README cannot be reached from these rows. A row quietly losing
    // that segment would start double-parsing every package README.
    expect(SCAN_ROOTS).toEqual([
      { path: 'content/docs', rule: 'docs' },
      { path: 'examples', rule: 'disk' },
      { path: 'README.md', rule: 'disk' },
      { path: 'CONTRIBUTING.md', rule: 'disk' },
      { path: 'ROADMAP.md', rule: 'disk' },
      { path: 'docs', rule: 'disk' },
      { path: 'packages/*/README.md', rule: 'disk' },
      { path: 'apps/*/README.md', rule: 'disk' },
      { path: 'packages/*', rule: 'disk', exclude: ['README.md', 'CHANGELOG.md'] },
      { path: 'apps/*', rule: 'disk', exclude: ['README.md', 'CHANGELOG.md'] },
      { path: 'packages/*/*', rule: 'disk', collect: ['README.md'] },
      { path: 'apps/*/*', rule: 'disk', collect: ['README.md'] },
      { path: 'AGENTS.md', rule: 'disk' },
      { path: 'CHANGELOG.md', rule: 'disk' },
      { path: 'CLAUDE.md', rule: 'disk' },
      { path: 'LICENSE-THIRD-PARTY.md', rule: 'disk' },
      { path: 'QUICK_REFERENCE.md', rule: 'disk' },
    ]);
  });

  it('keeps `docs/` and `content/docs/` apart — same href, two rules', () => {
    // objectui#3572. The two roots differ by one path segment and are judged by
    // opposite rules, so a prefix-matching slip would hand one tree the other's
    // semantics. `../packages/core/README.md` is the discriminator: out of
    // `docs/` it is an ordinary GitHub path (accepted), out of `content/docs/`
    // it leaves the fumadocs page index (rejected) — even though the same file
    // backs both.
    const repo = repoWith({
      ...SITE_FIXTURE,
      'docs/ARCHITECTURE.md': '[core](../packages/core/README.md) and [gone](./NOWHERE.md)',
      'content/docs/guide/a.md': '[core](../../../packages/core/README.md)',
      'packages/core/README.md': '# Core',
    });

    // The second `docs/` link is a control, for the reason the fence test spells
    // out below: an expectation naming only the `content/docs` rejection would
    // hold just as well if `docs/` were never scanned at all, so it would prove
    // nothing about the half it exists to test. One rejection from EACH tree
    // cannot pass that way.
    expect(scan(repo).map((item) => [path.relative(repo, item.file), item.href, item.reason])).toEqual([
      [path.join('content', 'docs', 'guide', 'a.md'), '../../../packages/core/README.md', 'escapes-collection'],
      [path.join('docs', 'ARCHITECTURE.md'), './NOWHERE.md', 'example-relative'],
    ]);
  });

  it('has no dead self-repo GitHub URLs — the #3507 sweep, now a gate', () => {
    // #3509 cleared this class to zero (25 targets, exactly 2 dead); PR #3506
    // then added 8 more with nothing checking them. This is that sweep, run on
    // every push instead of by hand in an issue comment.
    const targets = new Set<string>();
    for (const root of SCAN_ROOTS as { path: string; exclude?: string[] }[]) {
      const exclude = root.exclude ? new Set(root.exclude) : undefined;
      for (const file of collectFiles(path.join(repoRoot, root.path), exclude) as string[]) {
        for (const match of stripCode(fs.readFileSync(file, 'utf8')).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
          const target = selfRepoPath(match[1].trim());
          if (target !== null) targets.add(target);
        }
      }
    }

    expect(targets.size).toBeGreaterThanOrEqual(25);
    expect([...targets].filter((target) => !fs.existsSync(path.join(repoRoot, target)))).toEqual([]);
  });

  it('exposes routeExists with the context the scan gives it', () => {
    const root = docsRootWith({ 'guide/a.md': '# A', 'plugins/plugin-charts.mdx': '# Charts' });
    const fromFile = path.join(root, 'guide/a.md');

    expect(routeExists('../plugins/plugin-charts.mdx', { fromFile, docsRoot: root })).toBe(true);
    expect(routeExists('../plugins/plugin-charts.md', { fromFile, docsRoot: root })).toBe(false);
  });

  it('reads the real apps/site tree as its route truth source', () => {
    // The coupling objectui#3490 deliberately bought, pinned against the actual
    // site: the enumerator must understand this router's shapes (a `(home)`
    // group serving `/`, dot-named literal segments, an optional catch-all) and
    // must NOT invent the prefixes the 17 dead links assumed.
    const site = collectSiteRoutes(path.join(repoRoot, 'apps/site'));

    for (const served of ['/', '/playground', '/llms.txt', '/docs/guide/expressions', '/logo.svg']) {
      expect([served, siteUrlExists(served, site)]).toEqual([served, true]);
    }
    for (const dead of ['/spec/component.md', '/protocol/overview', '/api/core', '/api/react', '/examples/crm']) {
      expect([dead, siteUrlExists(dead, site)]).toEqual([dead, false]);
    }
  });
});

describe('absolute non-/docs hrefs are resolved against the site — objectui#3490 B-class', () => {
  it('reports the shape all 17 dead links had: a prefix the router has no segment for', () => {
    // The assertion that dies if `if (cleanHref.startsWith('/')) return true;`
    // ever comes back. `/spec`, `/protocol`, `/examples` are not route segments
    // in apps/site/app, and never were.
    expect(
      brokenHrefs({
        'guide/a.md': [
          '[spec](/spec/component-package.md)',
          '[protocol](/protocol/overview)',
          '[example](/examples/crm)',
        ].join('\n\n'),
      }),
    ).toEqual(['/spec/component-package.md', '/protocol/overview', '/examples/crm']);
  });

  it('reports a sibling of a real segment — /api exists, /api/core does not', () => {
    // The near-miss that makes prefix-allowlisting useless: the fixture has
    // `app/api/search/route.ts`, so `/api` is a real path prefix. It is not a
    // route, and neither is `/api/core`.
    expect(
      brokenHrefs({ 'guide/a.md': '[core](/api/core) and [search](/api/search)' }),
    ).toEqual(['/api/core']);
  });

  it('accepts a static file under public/ — the 3 /img links in #3490 were fine', () => {
    expect(brokenHrefs({ 'guide/a.md': '![shot](/img/guide/shot.png)' })).toEqual([]);
  });

  it('reports a public/ path that does not exist', () => {
    expect(brokenHrefs({ 'guide/a.md': '![gone](/img/guide/missing.png)' })).toEqual(['/img/guide/missing.png']);
  });

  it('accepts a plain route and the site root, trailing slash or not', () => {
    expect(brokenHrefs({ 'guide/a.md': '[p](/playground) [q](/playground/) [home](/)' })).toEqual([]);
  });

  it('refuses to judge an absolute href with no route table rather than waving it through', () => {
    // A silent `true` here is exactly how the 18 accumulated. Callers that skip
    // the truth source get an error, not a green.
    const docsRoot = docsRootWith({ 'guide/a.md': '# A' });
    expect(() => routeExists('/spec/component.md', { fromFile: path.join(docsRoot, 'guide/a.md'), docsRoot })).toThrow(
      /site route table/,
    );
  });
});

describe('the route table follows Next.js segment semantics', () => {
  function tableFor(files: Record<string, string>) {
    return collectSiteRoutes(path.join(repoWith(files), 'apps/site'));
  }

  it('drops route groups, skips private and slot folders, and needs a page or route file', () => {
    const site = tableFor({
      'apps/site/app/(marketing)/pricing/page.tsx': 'x',
      'apps/site/app/_internal/secret/page.tsx': 'x',
      'apps/site/app/components/Thing.tsx': 'x',
      'apps/site/app/feed/route.ts': 'x',
    });

    expect(siteUrlExists('/pricing', site)).toBe(true);
    expect(siteUrlExists('/(marketing)/pricing', site)).toBe(false);
    expect(siteUrlExists('/_internal/secret', site)).toBe(false);
    expect(siteUrlExists('/components', site)).toBe(false);
    expect(siteUrlExists('/feed', site)).toBe(true);
  });

  it('matches dynamic, catch-all and optional catch-all segments by arity', () => {
    const site = tableFor({
      'apps/site/app/blog/[slug]/page.tsx': 'x',
      'apps/site/app/og/[...slug]/page.tsx': 'x',
      'apps/site/app/wiki/[[...slug]]/page.tsx': 'x',
    });

    expect(siteUrlExists('/blog/hello', site)).toBe(true);
    expect(siteUrlExists('/blog', site)).toBe(false);
    expect(siteUrlExists('/blog/a/b', site)).toBe(false);

    expect(siteUrlExists('/og/a', site)).toBe(true);
    expect(siteUrlExists('/og/a/b', site)).toBe(true);
    expect(siteUrlExists('/og', site)).toBe(false);

    expect(siteUrlExists('/wiki', site)).toBe(true);
    expect(siteUrlExists('/wiki/a/b', site)).toBe(true);
  });
});

describe('relative hrefs may not leave the collection — objectui#3490 A-class', () => {
  it('reports a link out of content/docs even though the file is really there', () => {
    // `guide/data-source.md:202` pointed at `../../../packages/data-objectstack/
    // README.md#...`. The file exists, so `lychee --offline` and the pre-#3490
    // check both passed it; the site still 404s, because fumadocs can only
    // resolve inside the docs page index. The fixture materialises the target,
    // so this test fails if existence is ever allowed to decide the verdict.
    const repo = repoWith({
      ...SITE_FIXTURE,
      'content/docs/guide/data-source.md': '[adapter README](../../../packages/data-objectstack/README.md#batch)',
      'packages/data-objectstack/README.md': '# Adapter',
    });

    expect(fs.existsSync(path.join(repo, 'packages/data-objectstack/README.md'))).toBe(true);
    expect(scan(repo).map((item) => [item.href, item.reason])).toEqual([
      ['../../../packages/data-objectstack/README.md#batch', 'escapes-collection'],
    ]);
  });

  it('still accepts relative links that stay inside the collection', () => {
    expect(
      brokenHrefs({
        'guide/plugins.md': '[Charts](../plugins/plugin-charts.mdx) and [self](./plugins.md)',
        'plugins/plugin-charts.mdx': '# Charts',
      }),
    ).toEqual([]);
  });

  // The `labels each failure with the check that rejected it` test that stood
  // here is superseded by `labels all seven checks distinctly` in the last
  // describe — same fixture shape, extended with objectui#3536's three reasons.
});

describe('examples/** and the root README are scanned as DISK paths — objectui#3536 extension 1', () => {
  const EXAMPLE = 'examples/hello-world/README.md';

  it('reports the #3486 shape: a link to an example directory that was deleted', () => {
    // `examples/hello-world/README.md` really carried `../crm/` and `../todo/`
    // after both examples were removed. Two people found them by eye; nothing
    // in CI ever would have, because this file was outside the scan surface.
    expect(
      rejections({
        [EXAMPLE]: '[CRM](../crm/) and [Todo](../todo/)',
        'examples/schema-catalog/README.md': '# Schema Catalog',
      }),
    ).toEqual([
      ['../crm/', 'example-relative'],
      ['../todo/', 'example-relative'],
    ]);
  });

  it('reports the PR #3485 shape: a dead example entry in the root README', () => {
    expect(
      rejections({
        'README.md': '- [Todo](./examples/todo)\n- [Hello World](./examples/hello-world)',
        'examples/hello-world/README.md': '# Hello World',
      }),
    ).toEqual([['./examples/todo', 'example-relative']]);
  });

  it('accepts a directory, a non-markdown file, and an extensionless file', () => {
    // All three are things GitHub renders happily and `routeCandidates()` knows
    // nothing about: the docs rule would reject every one of them.
    expect(
      rejections({
        'README.md': '[pkg](./packages/core) [vite](./vite.config.ts) [licence](./LICENSE)',
        'packages/core/index.ts': 'export {}',
        'vite.config.ts': 'export default {}',
        LICENSE: 'MIT',
      }),
    ).toEqual([]);
  });

  it('rejects an extensionless spelling of a markdown file — the docs rule accepts it', () => {
    // The sharpest contrast pair. On the site `../plugins/plugin-charts` may
    // resolve in the browser, so the docs rule lets it through (see the
    // "accepts the extensionless-route spelling" test above). GitHub serves
    // FILES: there is nothing at that name, so it is simply a 404.
    expect(
      rejections({
        'examples/README.md': '[catalog](./schema-catalog/README)',
        'examples/schema-catalog/README.md': '# Schema Catalog',
      }),
    ).toEqual([['./schema-catalog/README', 'example-relative']]);
  });

  it('accepts a relative link that leaves the example — there is no collection to escape', () => {
    // The other half of the contrast. The identical shape out of content/docs
    // is `escapes-collection` (pinned below); out of an example README it is
    // exactly how console-starter's README links the app-shell source and a
    // docs page, and both render.
    expect(
      rejections({
        'examples/console-starter/README.md': [
          '[shell](../../packages/app-shell/src/console/ConsoleShell.tsx)',
          '[lookup](../../content/docs/fields/lookup.mdx)',
        ].join('\n\n'),
        'packages/app-shell/src/console/ConsoleShell.tsx': 'export {}',
        'content/docs/fields/lookup.mdx': '# Lookup',
      }),
    ).toEqual([]);
  });

  it('rejects a relative link that climbs out of the repository', () => {
    // The one containment rule the disk surface does have: GitHub cannot render
    // a path above the repo root, whatever exists on the machine running this.
    expect(rejections({ 'examples/README.md': '[up](../../../etc/hosts)' })).toEqual([
      ['../../../etc/hosts', 'example-relative'],
    ]);
  });

  it('rejects an absolute /... href — GitHub resolves it against github.com', () => {
    // No file in these surfaces carries this shape today; the rejection is
    // preventive, and it is what the renderer forces. `/packages/core` in the
    // root README links to https://github.com/packages/core, not to this repo.
    expect(
      rejections({
        'README.md': '[core](/packages/core)',
        'packages/core/index.ts': 'export {}',
      }),
    ).toEqual([['/packages/core', 'example-absolute']]);
  });

  it('leaves external URLs alone here too, and resolves the in-page anchor', () => {
    expect(
      rejections({
        'examples/README.md':
          '# Examples\n\n## Quick start\n\n[web](https://example.com/nope) [mail](mailto:a@b.c) [top](#quick-start)',
      }),
    ).toEqual([]);
  });

  it('reports a dead in-page anchor on a disk surface too', () => {
    expect(rejections({ 'examples/README.md': '# Examples\n\n## Quick start\n\n[top](#quickstart)' })).toEqual([
      ['#quickstart', 'anchor'],
    ]);
  });

  it('scans every markdown file under examples/, not only README.md', () => {
    expect(rejections({ 'examples/hello-world/NOTES.md': '[gone](./nowhere.md)' })).toEqual([
      ['./nowhere.md', 'example-relative'],
    ]);
  });

  it('does not walk into an example dependency tree', () => {
    // `pnpm install` puts a real `node_modules` in every example. Its READMEs
    // are not ours, and there are tens of thousands of them.
    expect(
      rejections({
        'examples/hello-world/node_modules/some-dep/README.md': '[gone](./nowhere.md)',
        'examples/hello-world/dist/README.md': '[gone](./nowhere.md)',
      }),
    ).toEqual([]);
  });

  it('exposes diskPathExists with the context the scan gives it', () => {
    const repo = repoWith({ 'examples/README.md': '# Examples', 'examples/hello-world/vite.config.ts': 'x' });
    const fromFile = path.join(repo, 'examples/README.md');

    expect(diskPathExists('./hello-world/vite.config.ts', { fromFile, repoRoot: repo })).toBe(true);
    expect(diskPathExists('./hello-world/vite.config', { fromFile, repoRoot: repo })).toBe(false);
    expect(diskPathExists('/hello-world/vite.config.ts', { fromFile, repoRoot: repo })).toBe(false);
  });

  it('keeps the docs rules off the disk surface and the disk rules off docs', () => {
    // One fixture, one target, four links: the same two hrefs judged by both
    // rules. If either rule ever leaks into the other's surface, exactly one of
    // these four verdicts flips.
    const repo = repoWith({
      ...SITE_FIXTURE,
      'content/docs/guide/a.md': '[out](../../../packages/core/README.md) and [bare](../plugins/plugin-charts)',
      'content/docs/plugins/plugin-charts.mdx': '# Charts',
      'examples/README.md': '[out](../packages/core/README.md) and [bare](../content/docs/plugins/plugin-charts)',
      'packages/core/README.md': '# Core',
    });

    expect(scan(repo).map((item) => [path.relative(repo, item.file), item.href, item.reason])).toEqual([
      ['content/docs/guide/a.md', '../../../packages/core/README.md', 'escapes-collection'],
      ['examples/README.md', '../content/docs/plugins/plugin-charts', 'example-relative'],
    ]);
  });
});

describe('CONTRIBUTING.md, ROADMAP.md and docs/** joined the disk surface — objectui#3572', () => {
  it('reports the #3545 shape: the dead links CONTRIBUTING.md really carried', () => {
    // The two CONTRIBUTING.md links PR #3571 fixed were of exactly this shape —
    // a relative path to a file that is not there. Nothing could have caught
    // them: the file sat outside SCAN_ROOTS, and lychee does not gate.
    expect(
      rejections({
        'CONTRIBUTING.md': '[architecture](./content/docs/guide/architecture.md) and [gone](./docs/NOWHERE.md)',
        'content/docs/guide/architecture.md': '# Architecture',
      }),
    ).toEqual([['./docs/NOWHERE.md', 'example-relative']]);
  });

  it('reports the third one: a dead link in ROADMAP.md', () => {
    expect(
      rejections({
        'ROADMAP.md': '[adr](./docs/adr/0001-master-detail-subform.md) and [gone](./docs/adr/9999-nope.md)',
        'docs/adr/0001-master-detail-subform.md': '# ADR 1',
      }),
    ).toEqual([['./docs/adr/9999-nope.md', 'example-relative']]);
  });

  it('walks docs/ recursively, not just its top level', () => {
    // 13 of the tree's 15 files are under `docs/adr/` and `docs/audits/`. A
    // scan that opened only `docs/*.md` would report nothing and look green.
    expect(
      rejections({
        'docs/ARCHITECTURE.md': '[fine](./adr/0001-a.md)',
        'docs/adr/0001-a.md': '[gone](./0002-missing.md)',
        'docs/audits/2026-06-ui-testability.md': '[gone](../nowhere/x.md)',
      }),
    ).toEqual([
      ['./0002-missing.md', 'example-relative'],
      ['../nowhere/x.md', 'example-relative'],
    ]);
  });

  it('accepts a docs/ link that leaves docs/ — there is no collection to escape', () => {
    // The disk rule's whole point, on the new tree: ADRs cite package sources
    // and published docs pages, and GitHub renders every one of them.
    expect(
      rejections({
        'docs/adr/0054-ui-testability-contract.md': [
          '[shell](../../packages/app-shell/src/console/ConsoleShell.tsx)',
          '[lookup](../../content/docs/fields/lookup.mdx)',
          '[roadmap](../../ROADMAP.md)',
          '[dir](../../packages/core)',
        ].join('\n\n'),
        'packages/app-shell/src/console/ConsoleShell.tsx': 'export {}',
        'content/docs/fields/lookup.mdx': '# Lookup',
        'ROADMAP.md': '# Roadmap',
        'packages/core/index.ts': 'export {}',
      }),
    ).toEqual([]);
  });

  it('rejects an extensionless markdown spelling and an absolute /... href here too', () => {
    // Same two rules as examples/**, since it is the same `disk` rule class —
    // this pins that the new rows really got it, and did not quietly land on
    // the docs rule (which accepts the extensionless form).
    expect(
      rejections({
        'docs/ARCHITECTURE.md': '[adr](./adr/0001-a) and [abs](/packages/core)',
        'docs/adr/0001-a.md': '# ADR 1',
        'packages/core/index.ts': 'export {}',
      }),
    ).toEqual([
      ['./adr/0001-a', 'example-relative'],
      ['/packages/core', 'example-absolute'],
    ]);
  });

  it('does NOT see a dead link inside a code fence — the boundary, pinned deliberately', () => {
    // objectui#3572's stated limit, and objectui#3570's instance class:
    // `stripCode()` blanks fences before the scan, so an illustrative route in
    // a fenced block is invisible to this gate whether or not it is dead. Real
    // `CONTRIBUTING.md` carries 10 such links today.
    //
    // This test exists so the boundary is a DECISION with a name, not a silent
    // gap someone later reads as coverage. If `stripCode()` is ever narrowed,
    // this goes red and the two false positives it was built for come back.
    //
    // The CONTROL link matters more than the fenced ones: an `toEqual([])` here
    // would also pass if CONTRIBUTING.md were dropped from SCAN_ROOTS entirely
    // — green because nothing was scanned, which is the failure mode this whole
    // file exists to prevent. Asserting "exactly the prose link, and none of
    // the three fenced ones" cannot pass vacuously: delete the scan row and the
    // control disappears too, turning this red.
    expect(
      rejections({
        'CONTRIBUTING.md': [
          'Link docs pages like this:',
          FENCE + 'md',
          '[Quick Start](/guide/quick-start)',
          '[Core API](/api/core)',
          FENCE,
          'and inline: `[Spec](/spec/component)`',
          '',
          'See [the guide](./docs/GONE.md).',
        ].join('\n'),
      }),
    ).toEqual([['./docs/GONE.md', 'example-relative']]);
  });

  it('leaves the anchors and external URLs these files are mostly made of alone', () => {
    // CONTRIBUTING.md is 15 visible links, of which this gate judges exactly
    // one — the rest are its own table-of-contents anchors and external URLs.
    expect(
      rejections({
        'CONTRIBUTING.md': [
          '[Getting Started](#getting-started)',
          '[Commit Guidelines](#commit-guidelines)',
          '[Conventional Commits](https://www.conventionalcommits.org/)',
          '[Changesets](https://github.com/changesets/changesets)',
          '## Getting Started',
          '## Commit Guidelines',
        ].join('\n\n'),
      }),
    ).toEqual([]);
  });

  it("resolves this surface's table-of-contents anchors rather than skipping them", () => {
    // The two headings above are what makes the case above pass now. Drop one
    // and the link to it is reported — which is the whole point of the check
    // objectui#7644 added, on the surface that is mostly such links.
    expect(
      rejections({
        'CONTRIBUTING.md': ['[Getting Started](#getting-started)', '## Commit Guidelines'].join('\n\n'),
      }),
    ).toEqual([['#getting-started', 'anchor']]);
  });
});

describe("this repo's own GitHub blob/tree URLs are resolved offline — objectui#3536 extension 2", () => {
  it('reports the #3507 shape: a tree/main URL to a deleted example', () => {
    // `examples/crm` and `examples/todo` were deleted in 12b287d8b and the two
    // links to them stayed dead about three months: this script skipped them by
    // scheme, and lychee (`schedule` + `workflow_dispatch`, no PR trigger) blocks
    // nobody.
    expect(
      rejections({
        ...SITE_FIXTURE,
        'content/docs/guide/building-crud-app.md': [
          '[CRM](https://github.com/objectstack-ai/objectui/tree/main/examples/crm)',
          '[Catalog](https://github.com/objectstack-ai/objectui/tree/main/examples/schema-catalog)',
        ].join('\n\n'),
        'examples/schema-catalog/README.md': '# Schema Catalog',
      }),
    ).toEqual([['https://github.com/objectstack-ai/objectui/tree/main/examples/crm', 'self-repo-url']]);
  });

  it('checks the shape in the disk surfaces too, not only content/docs', () => {
    expect(
      rejections({
        'examples/README.md': '[gone](https://github.com/objectstack-ai/objectui/blob/main/packages/gone/README.md)',
      }),
    ).toEqual([['https://github.com/objectstack-ai/objectui/blob/main/packages/gone/README.md', 'self-repo-url']]);
  });

  it('accepts a blob URL to a real file and a tree URL to a real directory', () => {
    expect(
      rejections({
        ...SITE_FIXTURE,
        'content/docs/plugins/plugin-charts.mdx': [
          '[README](https://github.com/objectstack-ai/objectui/blob/main/packages/plugin-charts/README.md)',
          '[Packages](https://github.com/objectstack-ai/objectui/tree/main/packages)',
        ].join('\n\n'),
        'packages/plugin-charts/README.md': '# Charts',
      }),
    ).toEqual([]);
  });

  it('resolves a markdown fragment, keeps ignoring the query, and still checks the path', () => {
    // Was 'ignores the fragment and the query — anchors are out of scope'. The
    // "different gate" that comment deferred to is objectui#7644, and it is
    // this one: a fragment on one of these URLs is resolved whenever the path
    // names markdown in this tree. `?plain=1` is still ignored.
    expect(
      rejections({
        ...SITE_FIXTURE,
        'content/docs/guide/a.md': [
          '[live](https://github.com/objectstack-ai/objectui/blob/main/packages/core/README.md#install)',
          '[raw](https://github.com/objectstack-ai/objectui/blob/main/packages/core/README.md?plain=1)',
          '[dead](https://github.com/objectstack-ai/objectui/blob/main/packages/gone/README.md#install)',
        ].join('\n\n'),
        'packages/core/README.md': '# Core\n\n## Install',
      }),
    ).toEqual([['https://github.com/objectstack-ai/objectui/blob/main/packages/gone/README.md#install', 'self-repo-url']]);
  });

  it('leaves every other GitHub URL alone — nothing else is decidable offline', () => {
    // A different repo (lychee's job), a different ref (not in this tree), and
    // github.com web routes: the two badge URLs and the issues link that the
    // root README really carries.
    expect(
      rejections({
        'examples/README.md': [
          '[other repo](https://github.com/objectstack-ai/objectstack/blob/main/packages/gone/README.md)',
          '[a tag](https://github.com/objectstack-ai/objectui/blob/v1.2.0/packages/gone/README.md)',
          '[a sha](https://github.com/objectstack-ai/objectui/blob/12b287d8b/packages/gone/README.md)',
          '[issues](https://github.com/objectstack-ai/objectui/issues)',
          '[ci](https://github.com/objectstack-ai/objectui/workflows/CI/badge.svg)',
          '[repo root](https://github.com/objectstack-ai/objectui/tree/main)',
        ].join('\n\n'),
      }),
    ).toEqual([]);
  });

  it('exposes selfRepoPath: the path it extracts, and the shapes it declines', () => {
    expect(selfRepoPath('https://github.com/objectstack-ai/objectui/blob/main/packages/core/README.md')).toBe(
      'packages/core/README.md',
    );
    expect(selfRepoPath('https://github.com/objectstack-ai/objectui/tree/main/packages/#readme')).toBe('packages');
    expect(selfRepoPath('https://github.com/objectstack-ai/objectui/issues')).toBeNull();
    expect(selfRepoPath('https://github.com/objectstack-ai/objectstack/blob/main/a.md')).toBeNull();
    expect(selfRepoPath('./packages/core/README.md')).toBeNull();
  });

  it('does not let the URL escape the repository', () => {
    expect(
      rejections({
        'examples/README.md': '[up](https://github.com/objectstack-ai/objectui/blob/main/../../../etc/hosts)',
      }),
    ).toEqual([['https://github.com/objectstack-ai/objectui/blob/main/../../../etc/hosts', 'self-repo-url']]);
  });
});

describe('every failure carries the reason that rejected it', () => {
  it('labels all eight checks distinctly', () => {
    // The #3490 test of the same name, extended with objectui#3536's three and
    // objectui#3603's one. Every reason here must have a HINTS entry — the next
    // test pins that.
    const repo = repoWith({
      ...SITE_FIXTURE,
      'content/docs/guide/a.md': [
        '[out](../../../elsewhere/README.md)',
        '[site](/spec/component.md)',
        '[docs](/docs/guide/a.md)',
        '[rel](./nowhere.md)',
        '[self](https://github.com/objectstack-ai/objectui/blob/main/packages/gone/README.md)',
        '[origin](https://www.objectui.org/docs/guide/gone)',
      ].join('\n\n'),
      'examples/README.md': '[disk](./nowhere.md) and [abs](/packages/core)',
    });

    expect(scan(repo).map((item) => item.reason)).toEqual([
      'escapes-collection',
      'site-route',
      'docs-route',
      'relative',
      'self-repo-url',
      'site-absolute-url',
      'example-relative',
      'example-absolute',
    ]);
  });

  it('prints a hint for every reason the script can produce', () => {
    // A reason with no HINTS entry fails silently: the failure line is printed
    // and the "how do I fix this" paragraph simply never appears.
    const source = fs.readFileSync(path.join(repoRoot, 'scripts/check-doc-links.mjs'), 'utf8');
    const hinted = source
      .slice(source.indexOf('const HINTS = {'))
      .split('\n};')[0]
      .matchAll(/^\s{2}'?([a-z-]+)'?:/gm);

    expect([...hinted].map((match) => match[1]).sort()).toEqual([
      'anchor',
      'docs-route',
      'escapes-collection',
      'example-absolute',
      'example-relative',
      'relative',
      'self-repo-url',
      'site-absolute-url',
      'site-route',
    ]);
  });
});

describe("this site's own absolute URLs are resolved as internal routes — objectui#3603", () => {
  it('reports the shape all 9 package-README links had: a full site URL to no page', () => {
    // The assertion that dies if `if (EXTERNAL_HREF_RE.test(href)) return null;`
    // is ever allowed to reach a site-absolute URL again. `/docs/packages/*` is
    // the namespace 7 package READMEs invented; it has never existed.
    expect(
      brokenHrefs({
        'guide/a.md': '[docs](https://www.objectui.org/docs/packages/auth)',
      }),
    ).toEqual(['https://www.objectui.org/docs/packages/auth']);
  });

  it('accepts the same URL once it names a real page', () => {
    expect(
      brokenHrefs({
        'guide/a.md': '[renderer](https://www.objectui.org/docs/core/schema-renderer)',
        'core/schema-renderer.mdx': '# SchemaRenderer',
      }),
    ).toEqual([]);
  });

  it('judges both host spellings — this tree really carries www and bare', () => {
    // 109 `www.objectui.org` against 9 bare `objectui.org` on main. Accepting
    // only the majority spelling would leave the other 9 in the blind spot the
    // whole change exists to close.
    expect(
      brokenHrefs({
        'guide/a.md': [
          '[www dead](https://www.objectui.org/docs/gone)',
          '[bare dead](https://objectui.org/docs/gone)',
          '[www live](https://www.objectui.org/docs/guide/a)',
          '[bare live](https://objectui.org/docs/guide/a)',
        ].join('\n\n'),
      }),
    ).toEqual(['https://www.objectui.org/docs/gone', 'https://objectui.org/docs/gone']);
  });

  it('INHERITS /docs strictness — an extension 404s here exactly as it does origin-less', () => {
    // The test that proves the origin is stripped and the rest handed to the
    // existing `routeExists()`, rather than judged by some new parallel path.
    // `guide/b.md` is materialised: only the strict `/docs` branch rejects it.
    expect(
      brokenHrefs({
        'guide/a.md': '[b](https://www.objectui.org/docs/guide/b.md)',
        'guide/b.md': '# B',
      }),
    ).toEqual(['https://www.objectui.org/docs/guide/b.md']);
  });

  it('INHERITS the apps/site route table for non-/docs paths', () => {
    // `/playground` and `/` are real routes in the site fixture; `/examples` is
    // the prefix #3490 proved has never been one. Same table, same verdicts.
    expect(
      brokenHrefs({
        'guide/a.md': [
          '[examples](https://www.objectui.org/examples)',
          '[playground](https://www.objectui.org/playground)',
          '[home](https://www.objectui.org)',
          '[home slash](https://www.objectui.org/)',
        ].join('\n\n'),
      }),
    ).toEqual(['https://www.objectui.org/examples']);
  });

  it('checks site URLs in the disk surfaces too, not only content/docs', () => {
    // One rejection from EACH tree, for the reason the fence test spells out:
    // an expectation naming only the content/docs one would hold just as well
    // if the check never ran on the disk rule, and would prove nothing.
    const repo = repoWith({
      ...SITE_FIXTURE,
      'content/docs/guide/a.md': '[gone](https://www.objectui.org/docs/gone)',
      'README.md': '[gone](https://objectui.org/docs/gone)',
      'examples/hello-world/README.md': '[live](https://www.objectui.org/docs/guide/a)',
    });

    expect(scan(repo).map((item) => [path.relative(repo, item.file), item.reason])).toEqual([
      [path.join('content', 'docs', 'guide', 'a.md'), 'site-absolute-url'],
      ['README.md', 'site-absolute-url'],
    ]);
  });

  it('leaves every other origin alone, a lookalike host included', () => {
    // The regex is anchored at both ends precisely so `objectui.org.example.com`
    // cannot borrow this repo's route table — it is somebody else's host, and
    // resolving it here would invent 404s that are not ours to report.
    expect(
      brokenHrefs({
        'guide/a.md': [
          '[lookalike](https://objectui.org.example.com/docs/gone)',
          '[prefixed](https://notobjectui.org/docs/gone)',
          '[other](https://example.com/docs/gone)',
          '[docs of another](https://react.dev/docs/gone)',
        ].join('\n\n'),
      }),
    ).toEqual([]);
  });

  it('resolves the fragment on a site URL too, and still ignores the query', () => {
    // Was 'anchors are out of scope'. The origin is stripped, the route is
    // resolved to its file, and objectui#7644 then reads that file's headings —
    // so this shape is judged exactly as the origin-less spelling is.
    expect(
      brokenHrefs({
        'guide/a.md': [
          '# A',
          '## Install',
          '[live](https://www.objectui.org/docs/guide/a#install)',
          '[live q](https://www.objectui.org/docs/guide/a?x=1)',
          '[dead](https://www.objectui.org/docs/gone#install)',
        ].join('\n\n'),
      }),
    ).toEqual(['https://www.objectui.org/docs/gone#install']);
  });

  it('reports a site URL whose route resolves but whose anchor does not', () => {
    expect(
      brokenHrefs({
        'guide/a.md': '# A\n\n## Install\n\n[moved](https://www.objectui.org/docs/guide/a#installation)',
      }),
    ).toEqual(['https://www.objectui.org/docs/guide/a#installation']);
  });

  it('exposes siteAbsoluteRoute: the path it extracts, and the shapes it declines', () => {
    expect(siteAbsoluteRoute('https://www.objectui.org/docs/guide/plugins')).toBe('/docs/guide/plugins');
    expect(siteAbsoluteRoute('https://objectui.org/api/core')).toBe('/api/core');
    expect(siteAbsoluteRoute('http://objectui.org/docs')).toBe('/docs');
    // No path at all is the site ROOT, not the empty string — `routeExists()`
    // reads '' as a pure in-page anchor and would wave it through.
    expect(siteAbsoluteRoute('https://www.objectui.org')).toBe('/');
    expect(siteAbsoluteRoute('https://www.objectui.org/docs/guide/a#x')).toBe('/docs/guide/a');
    expect(siteAbsoluteRoute('https://objectui.org.example.com/docs')).toBeNull();
    expect(siteAbsoluteRoute('https://example.com/docs')).toBeNull();
    expect(siteAbsoluteRoute('/docs/guide/plugins')).toBeNull();
  });

  it('really judges the site-absolute URLs this repo carries — the floor under the green', () => {
    // objectui#3603's anti-vacuous-green assertion, and the one this change
    // needs most. Unlike #3536 and #3572 this card added NO scan root, so the
    // repo-wide "no broken internal links" test above stays green whether or
    // not the new resolution runs at all — it would pass just as well if
    // `siteAbsoluteRoute()` returned null for everything. This pins that the
    // URLs are really there and really reaching the check.
    //
    // Measured on main when #3603 landed: 11 of them, of which 6 sit inside
    // `content/docs` itself — the fact that makes this a general fix rather
    // than a package README one — and 3 carry a `/docs/...` path, so the strict
    // branch above is genuinely exercised by real content and not only by
    // fixtures. objectui#3622 took the total to 58 by adding a surface that
    // writes 47 of them; the floors below stay at #3603's measurement, since
    // they exist to pin THAT card's minimum and the new root has its own floor
    // in the last describe.
    const seen: { root: string; route: string }[] = [];
    for (const root of SCAN_ROOTS as { path: string }[]) {
      for (const file of collectFiles(path.join(repoRoot, root.path)) as string[]) {
        for (const match of stripCode(fs.readFileSync(file, 'utf8')).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
          const route = siteAbsoluteRoute(match[1].trim());
          if (route !== null) seen.push({ root: root.path, route });
        }
      }
    }

    expect(seen.length).toBeGreaterThanOrEqual(11);
    expect(seen.filter((item) => item.root === 'content/docs').length).toBeGreaterThanOrEqual(6);
    expect(seen.filter((item) => item.route.startsWith('/docs')).length).toBeGreaterThanOrEqual(3);
  });
});

describe('packages/*/README.md joined the disk surface — objectui#3622', () => {
  it('reports the four shapes the 11 dead links really had', () => {
    // One fixture carrying all four, each next to a live control of the same
    // shape — so no verdict here can be right for the wrong reason:
    //
    //   /api/core            a route prefix the router has never had (#3490's class)
    //   /docs/core           a REAL directory with no index page, so not a route
    //   ../../docs/SHA…      a disk path that has never existed
    //   ./LICENSE            a disk path this package really does not have
    //
    // The middle one is the one objectui#3603's own verification script scored
    // green, by accepting a bare directory as a fumadocs candidate. The fixture
    // materialises `content/docs/core/schema-renderer.mdx` so the directory is
    // genuinely there and only the missing index decides the verdict.
    expect(
      rejections({
        ...SITE_FIXTURE,
        'content/docs/core/schema-renderer.mdx': '# SchemaRenderer',
        'packages/core/README.md': [
          '[api](https://objectui.org/api/core)',
          '[group](https://www.objectui.org/docs/core)',
          '[renderer](https://www.objectui.org/docs/core/schema-renderer)',
          '[sync](../../docs/SHADCN_SYNC.md)',
          '[changelog](./CHANGELOG.md)',
          '[licence](./LICENSE)',
        ].join('\n\n'),
        'packages/core/CHANGELOG.md': '# Changelog',
      }),
    ).toEqual([
      ['https://objectui.org/api/core', 'site-absolute-url'],
      ['https://www.objectui.org/docs/core', 'site-absolute-url'],
      ['../../docs/SHADCN_SYNC.md', 'example-relative'],
      ['./LICENSE', 'example-relative'],
    ]);
  });

  it('expands the wildcard to one path per package directory, sorted', () => {
    // The row is the table's only wildcard, so this is where `expandWildcard()`
    // is pinned: one path per directory, a package without a README dropped
    // (`sdui-parser` on main), and a stable order so the report does not depend
    // on the filesystem's.
    const repo = repoWith({
      'packages/gamma/README.md': '# Gamma',
      'packages/alpha/README.md': '# Alpha',
      'packages/beta/index.ts': 'export {}',
    });

    expect(
      collectFiles(path.join(repo, 'packages/*/README.md')).map((file: string) => path.relative(repo, file)),
    ).toEqual([path.join('packages', 'alpha', 'README.md'), path.join('packages', 'gamma', 'README.md')]);
  });

  it('took only the README at the time — objectui#4938 bought the rest, minus CHANGELOG.md', () => {
    // This row's own boundary was `README.md` only; `packages/*` below now
    // covers TESTING.md and a package's docs/ tree, so all three sibling files
    // are judged today except the generated CHANGELOG. The README's own dead
    // link stays the control that proves this row still fires on its own.
    expect(
      rejections({
        'packages/core/README.md': '[fine](./CHANGELOG.md) and [gone](./NOWHERE.md)',
        'packages/core/CHANGELOG.md': '[also gone](./NOWHERE.md)',
        'packages/core/TESTING.md': '[also gone](./NOWHERE.md)',
        'packages/core/docs/FilterBuilder.md': '[also gone](./NOWHERE.md)',
      }),
    ).toEqual([
      ['./NOWHERE.md', 'example-relative'],
      ['./NOWHERE.md', 'example-relative'],
      ['./NOWHERE.md', 'example-relative'],
    ]);
  });

  it('does not treat a dependency tree under packages/ as a package', () => {
    // `packages/node_modules` is a directory like any other to a wildcard, and
    // its READMEs are not ours. Same exclusion the tree walk already applies.
    expect(
      rejections({
        'packages/core/README.md': '[gone](./NOWHERE.md)',
        'packages/node_modules/README.md': '[gone](./NOWHERE.md)',
      }),
    ).toEqual([['./NOWHERE.md', 'example-relative']]);
  });

  it('keeps the docs rules off package READMEs — the contrast pair', () => {
    // A package README is read on npm and on GitHub, never served by the site,
    // so it takes the `disk` rule. Two hrefs make that visible in both
    // directions: a link INTO content/docs is fine from a README (there is no
    // collection to escape) and rejected from inside content/docs, while the
    // extensionless spelling the docs rule accepts is a 404 on GitHub.
    const repo = repoWith({
      ...SITE_FIXTURE,
      'content/docs/guide/a.md': '[readme](../../../packages/core/README.md)',
      'content/docs/fields/lookup.mdx': '# Lookup',
      'packages/core/README.md': '[lookup](../../content/docs/fields/lookup.mdx) and [bare](../../content/docs/fields/lookup)',
    });

    expect(scan(repo).map((item) => [path.relative(repo, item.file), item.href, item.reason])).toEqual([
      [path.join('content', 'docs', 'guide', 'a.md'), '../../../packages/core/README.md', 'escapes-collection'],
      [path.join('packages', 'core', 'README.md'), '../../content/docs/fields/lookup', 'example-relative'],
    ]);
  });

  it('refuses a wildcard that is not a whole path segment, rather than matching nothing', () => {
    // The failure mode a glob row has and a plain path does not: a pattern that
    // expands to zero paths is a surface silently dropped, and every test above
    // stays green about a tree nobody opened. Loud beats quiet, as with the
    // missing route table in `routeExists()`.
    const repo = repoWith({ 'packages/plugin-charts/README.md': '# Charts' });

    expect(() => collectFiles(path.join(repo, 'packages/plugin-*/README.md'))).toThrow(/whole path segment/);
  });

  it('really judges the links these READMEs carry — the floor under the green', () => {
    // The anti-vacuous-green floor for this row, and the reason it counts HREFS
    // rather than files: the file count above proves the wildcard expanded, but
    // a surface of 38 files carrying nothing this gate can decide would still
    // leave the repo-wide green meaning "checked nothing". Measured when the row
    // landed: 200 decidable hrefs across the 38 READMEs, 47 of them site-absolute
    // URLs — the shape 9 of the 11 dead links had.
    // The root is read out of SCAN_ROOTS rather than spelled again here, so
    // deleting the row takes this floor with it instead of leaving a green test
    // measuring a surface the gate no longer scans.
    const root = (SCAN_ROOTS as { path: string }[]).find((item) => item.path.startsWith('packages/'));
    expect(root).toBeDefined();

    const decidable: string[] = [];
    const siteAbsolute: string[] = [];
    for (const file of collectFiles(path.join(repoRoot, root!.path)) as string[]) {
      for (const match of stripCode(fs.readFileSync(file, 'utf8')).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const href = match[1].trim();
        const decidableScheme = siteAbsoluteRoute(href) !== null || selfRepoPath(href) !== null;
        if (siteAbsoluteRoute(href) !== null) siteAbsolute.push(href);
        if (decidableScheme || !/^(?:#|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(href)) decidable.push(href);
      }
    }

    expect(decidable.length).toBeGreaterThanOrEqual(150);
    expect(siteAbsolute.length).toBeGreaterThanOrEqual(40);
  });
});

describe('objectui#4148 — the app READMEs and the rest of the repo root', () => {
  /**
   * The two surfaces this gate's own header had DOCUMENTED as unscanned, bought
   * together. The live instance was `apps/console/README.md`, which linked twice
   * to a `./CONSOLE_ROADMAP.md` that left the directory in `c988277ff`: both
   * links were dead for about six months while `pnpm docs:check-links` reported
   * green on every push, because `apps/` matched no scan root.
   *
   * These tests are fixture-based rather than assertions about the real tree, so
   * they keep failing for the right reason after the real dead links are gone.
   * The one exception is the last test, which is deliberately about the real
   * tree: it is what stops this surface from silently reopening.
   */
  it('judges a dead link in an app README, and accepts a live one', () => {
    // The row's whole purpose, in both directions at once — a green here that
    // came from the surface not being scanned would have to explain the red.
    const repo = repoWith({
      ...SITE_FIXTURE,
      'ROADMAP.md': '# Roadmap',
      'apps/console/README.md': '[roadmap](../../ROADMAP.md) and [gone](./CONSOLE_ROADMAP.md)',
      'apps/site/README.md': '[roadmap](../../ROADMAP.md)',
    });

    expect(scan(repo).map((item) => [path.relative(repo, item.file), item.href, item.reason])).toEqual([
      [path.join('apps', 'console', 'README.md'), './CONSOLE_ROADMAP.md', 'example-relative'],
    ]);
  });

  it('took only the READMEs under apps/ at the time — objectui#4938 bought the docs/ tree beside them', () => {
    // Mirrors the objectui#3622 test one directory over, updated the same way:
    // `apps/*` below now walks the rest of an app directory, so
    // `docs/UI_IMPROVEMENT_PROPOSAL.md` is judged too. The per-app CHANGELOG
    // stays out — it is `exclude`d on that row for the same reason a package
    // CHANGELOG is.
    expect(
      rejections({
        'apps/console/README.md': '[gone](./NOWHERE.md)',
        'apps/console/CHANGELOG.md': '[also gone](./NOWHERE.md)',
        'apps/console/docs/UI_IMPROVEMENT_PROPOSAL.md': '[also gone](./NOWHERE.md)',
      }),
    ).toEqual([
      ['./NOWHERE.md', 'example-relative'],
      ['./NOWHERE.md', 'example-relative'],
    ]);
  });

  it('keeps the docs rules off app READMEs — the contrast pair', () => {
    // `@object-ui/console` is published, so its README is read on npm and on
    // GitHub and never served by the site: `disk`, for the same reason as a
    // package README. The discriminator is the extensionless spelling, which the
    // docs rule accepts as a route and GitHub 404s.
    const repo = repoWith({
      ...SITE_FIXTURE,
      'content/docs/guide/console.md': '# Console',
      'apps/console/README.md':
        '[guide](../../content/docs/guide/console.md) and [bare](../../content/docs/guide/console)',
    });

    expect(scan(repo).map((item) => [path.relative(repo, item.file), item.href, item.reason])).toEqual([
      [path.join('apps', 'console', 'README.md'), '../../content/docs/guide/console', 'example-relative'],
    ]);
  });

  it('judges a dead link in a root-level file the header used to list as unscanned', () => {
    // objectui#4149 had resolved QUICK_REFERENCE.md's links inside its own pin
    // test, explicitly as a stopgap until this row existed. This is the row; that
    // block was deleted with it, so this is now the only thing making the claim.
    expect(
      rejections({
        'QUICK_REFERENCE.md': '[gone](./NOWHERE.md)',
        'CLAUDE.md': '[also gone](./NOWHERE.md)',
        'CHANGELOG.md': '[also gone](./NOWHERE.md)',
        'AGENTS.md': '[also gone](./NOWHERE.md)',
        'LICENSE-THIRD-PARTY.md': '[also gone](./NOWHERE.md)',
      }),
    ).toEqual([
      ['./NOWHERE.md', 'example-relative'],
      ['./NOWHERE.md', 'example-relative'],
      ['./NOWHERE.md', 'example-relative'],
      ['./NOWHERE.md', 'example-relative'],
      ['./NOWHERE.md', 'example-relative'],
    ]);
  });

  it('scans EVERY tracked root-level markdown file — the invariant that replaces the list', () => {
    // The reverse direction, and the reason `LICENSE-THIRD-PARTY.md` is a row
    // even though it carries no links today: the header used to name four
    // unscanned root files, and a list of names is a thing that goes stale the
    // next time someone adds a page. "All of them" does not, provided something
    // holds it — this is that something. A new root-level markdown file with no
    // SCAN_ROOTS row fails here, which is the only moment anyone is thinking
    // about the file.
    //
    // Tracked files only, via git rather than readdir: an untracked stray at the
    // root (a scratch note, or a generated `AGENTS.md` of the kind objectui#4149
    // found `next dev` writing into `apps/site/`) is not this gate's business and
    // must not redden the suite.
    const tracked = execFileSync('git', ['ls-files', '--', '*.md'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.includes('/'))
      .sort();

    const rows = new Set((SCAN_ROOTS as { path: string }[]).map((item) => item.path));
    expect(
      tracked.filter((file) => !rows.has(file)),
      'every root-level markdown file needs its own SCAN_ROOTS row — the root has no glob spelling ' +
        '(`expandWildcard()` expands a whole path segment, never `*.md`), so completeness here is per-file',
    ).toEqual([]);

    // Floor under the floor: if `git ls-files` ever returned nothing, the
    // assertion above would pass while proving nothing at all.
    expect(tracked.length).toBeGreaterThanOrEqual(8);
  });
});

describe('objectui#4938 — the rest of each package/app directory', () => {
  /**
   * The surface objectui#4148 had named and left on its own "still not bought"
   * list: everything inside a package/app directory that is not the top-level
   * README (already scanned by the two `README.md`-only rows above this one)
   * or a generated CHANGELOG.md. `TESTING.md`, `MIGRATION.md`, a `docs/` tree,
   * a nested component doc — one row each, at any depth, via a plain
   * directory walk rather than another per-filename row.
   *
   * The live instance: `packages/components/src/renderers/complex/TIMELINE.md`
   * linked `../../examples/prototype/src/App.tsx`, an example app deleted whole
   * in `3aa84cee0` months earlier. No gate had ever opened the file, so nothing
   * noticed. Fixed in the same PR as this row, repointed at the interactive
   * demo the docs site now serves for the same content.
   */
  it('judges a dead link in a package-internal non-README file, and accepts a live one', () => {
    // The row's whole purpose, in both directions at once — same shape as the
    // objectui#4148 test one directory over.
    const repo = repoWith({
      'packages/core/TESTING.md': '[gone](./NOWHERE.md) and [live](./README.md)',
      'packages/core/README.md': '# Core',
    });

    expect(scan(repo).map((item) => [path.relative(repo, item.file), item.href, item.reason])).toEqual([
      [path.join('packages', 'core', 'TESTING.md'), './NOWHERE.md', 'example-relative'],
    ]);
  });

  it('excludes CHANGELOG.md at EVERY depth, not only the top level', () => {
    // `exclude` (new with this row) is a basename filter `walk()` applies at
    // every level it recurses into, not only the directory the scan root
    // itself names. A nested CHANGELOG.md is therefore excluded for the same
    // reason the top-level one is: neither is authored prose, wherever it sits.
    //
    // `README.md` is on this same every-depth exclude and stays there —
    // objectui#6026 did NOT narrow it. That card added rows of its own for the
    // nested READMEs (last describe), so the file a nested README carries is
    // judged by exactly one row, and it is not this one. The distinct hrefs
    // below are what makes that visible: a rejection here names the row that
    // produced it.
    expect(
      rejections({
        'packages/core/src/adapters/CHANGELOG.md': '[gone](./NOWHERE-changelog.md)',
        'packages/core/src/adapters/NOTES.md': '[gone](./NOWHERE-notes.md)',
      }),
    ).toEqual([['./NOWHERE-notes.md', 'example-relative']]);
  });

  it('does not re-report the top-level README the earlier row already scans', () => {
    // `packages/*` sits on top of `packages/*/README.md`, not beside it as an
    // independent tree — the same dead link must not appear twice in the
    // report just because two rows both could have opened the file.
    expect(rejections({ 'packages/core/README.md': '[gone](./NOWHERE.md)' })).toEqual([
      ['./NOWHERE.md', 'example-relative'],
    ]);
  });

  it('does not walk into a dependency tree under packages/ or apps/', () => {
    // Same exclusion the tree walk already applies everywhere else — a
    // wildcard directory row is not a license to open node_modules.
    expect(
      rejections({
        'packages/core/TESTING.md': '[gone](./NOWHERE.md)',
        'packages/core/node_modules/SOMETHING.md': '[gone](./NOWHERE.md)',
        'apps/console/docs/a.md': '[gone](./NOWHERE.md)',
        'apps/console/node_modules/SOMETHING.md': '[gone](./NOWHERE.md)',
      }),
    ).toEqual([
      ['./NOWHERE.md', 'example-relative'],
      ['./NOWHERE.md', 'example-relative'],
    ]);
  });

  it('keeps the docs rules off it — the contrast pair', () => {
    // Same `disk` rule as the README rows above it, for the same reason: read
    // on GitHub (and npm, for a published package), never served by the site.
    const repo = repoWith({
      ...SITE_FIXTURE,
      'content/docs/fields/lookup.mdx': '# Lookup',
      'packages/core/TESTING.md':
        '[lookup](../../content/docs/fields/lookup.mdx) and [bare](../../content/docs/fields/lookup)',
    });

    expect(scan(repo).map((item) => [path.relative(repo, item.file), item.href, item.reason])).toEqual([
      [path.join('packages', 'core', 'TESTING.md'), '../../content/docs/fields/lookup', 'example-relative'],
    ]);
  });

  it('really scans the real tree — the floor under the green', () => {
    // Measured when the row landed: 15 files across `packages/*` and `apps/*`
    // combined (12 + 3), carrying 4 decidable links — 3 relative and, after
    // the TIMELINE.md fix in this same PR, 1 site-absolute URL (which carries
    // a scheme, so it needs the same `siteAbsoluteRoute`/`selfRepoPath` escape
    // hatch the objectui#3622 test above uses — a scheme alone does not mean
    // "not ours to judge"). A floor rather than an exact count, same reasoning
    // as every wildcard row above.
    const packagesRoot = (SCAN_ROOTS as { path: string; exclude?: string[] }[]).find(
      (item) => item.path === 'packages/*',
    );
    const appsRoot = (SCAN_ROOTS as { path: string; exclude?: string[] }[]).find((item) => item.path === 'apps/*');
    expect(packagesRoot).toBeDefined();
    expect(appsRoot).toBeDefined();

    const files = [
      ...(collectFiles(path.join(repoRoot, packagesRoot!.path), new Set(packagesRoot!.exclude)) as string[]),
      ...(collectFiles(path.join(repoRoot, appsRoot!.path), new Set(appsRoot!.exclude)) as string[]),
    ];
    // objectui#5965 removed `packages/vscode-extension/SUMMARY.md`, so the
    // combined population is 14 (11 + 3) rather than the 15 measured when the
    // row landed. Still a floor, for the reasoning above.
    expect(files.length).toBeGreaterThanOrEqual(14);

    let decidable = 0;
    for (const file of files) {
      for (const match of stripCode(fs.readFileSync(file, 'utf8')).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const href = match[1].trim();
        const decidableScheme = siteAbsoluteRoute(href) !== null || selfRepoPath(href) !== null;
        if (decidableScheme || !/^(?:#|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(href)) decidable++;
      }
    }
    expect(decidable).toBeGreaterThanOrEqual(4);
  });
});

describe('objectui#6026 — the nested READMEs', () => {
  /**
   * The gap objectui#4938 measured and left open, named in its own header
   * section: `exclude` drops a basename at EVERY depth, so `README.md` on the
   * two rows above hid every README that is not at a package's top level —
   * and the rows above THOSE are exact top-level globs, which such a file is
   * not at. Four real files were therefore seen by no gate at all.
   *
   * Entry price was ZERO dead links (4 files, 97 markdown links, 96 decidable
   * here). That makes a green run worthless as evidence on its own, and it is
   * why the real-tree tests at the bottom of this describe assert the SCAN
   * SURFACE — which files are opened, and by how many rows — instead of the
   * verdict. The fixture tests above them are the ones that prove the rows can
   * go red at all.
   *
   * The mechanism is `collect` (the inverse of `exclude`: the only basenames
   * the walk keeps) plus a second wildcard segment in the row path. The second
   * segment is what makes the no-double-parse guarantee structural: the rows
   * are rooted at each package/app's SUBdirectories, so the top-level README
   * the earlier row owns is not underneath them and no filter has to remember
   * to leave it out.
   */
  it('judges a dead link in a nested README, and accepts a live one', () => {
    // The row's whole purpose, in both directions at once.
    const repo = repoWith({
      'packages/core/src/adapters/README.md': '[gone](./NOWHERE.md) and [live](./adapter.ts)',
      'packages/core/src/adapters/adapter.ts': 'export {};',
    });

    expect(scan(repo).map((item) => [path.relative(repo, item.file), item.href, item.reason])).toEqual([
      [path.join('packages', 'core', 'src', 'adapters', 'README.md'), './NOWHERE.md', 'example-relative'],
    ]);
  });

  it('reaches a nested README at any depth, and under an app as well as a package', () => {
    // `apps/*` has no nested README on main today, so the fixture is the only
    // place that row's mechanism is exercised — buying the surface while it is
    // empty is the cheapest this ever gets, and an empty row that was never
    // shown to work is not a surface at all.
    expect(
      rejections({
        'packages/types/src/zod/README.md': '[gone](./NOWHERE-zod.md)',
        'packages/plugin-gantt/docs/verification/deep/deeper/README.md': '[gone](./NOWHERE-deep.md)',
        'apps/console/src/pages/README.md': '[gone](./NOWHERE-app.md)',
      }),
    ).toEqual([
      // Scan order is SCAN_ROOTS order, then `expandWildcard()`'s sort — so
      // `plugin-gantt` precedes `types`, and both precede the `apps` row.
      ['./NOWHERE-deep.md', 'example-relative'],
      ['./NOWHERE-zod.md', 'example-relative'],
      ['./NOWHERE-app.md', 'example-relative'],
    ]);
  });

  it('still does not re-report the top-level README — the second wildcard is what keeps it out', () => {
    // The constraint this card must not break. `packages/*` + one more
    // wildcard segment is rooted at `packages/core/src`, not `packages/core`,
    // so the top-level README is outside these rows by construction rather
    // than by a filter. One dead link, one report — not two.
    expect(
      rejections({
        'packages/core/README.md': '[gone](./NOWHERE-top.md)',
        'packages/core/src/adapters/README.md': '[gone](./NOWHERE-nested.md)',
      }),
    ).toEqual([
      ['./NOWHERE-top.md', 'example-relative'],
      ['./NOWHERE-nested.md', 'example-relative'],
    ]);
  });

  it('takes only README.md — the other markdown beside it stays with the packages/* row', () => {
    // `collect` is a whitelist, so the nested rows cannot widen onto a
    // neighbouring file, and the CHANGELOG exclusion the row above owns is
    // untouched by this card. Distinct hrefs so a double report would be
    // visible rather than hidden behind two identical entries.
    expect(
      rejections({
        'packages/core/src/adapters/README.md': '[gone](./NOWHERE-readme.md)',
        'packages/core/src/adapters/NOTES.md': '[gone](./NOWHERE-notes.md)',
        'packages/core/src/adapters/CHANGELOG.md': '[gone](./NOWHERE-changelog.md)',
      }),
    ).toEqual([
      ['./NOWHERE-notes.md', 'example-relative'],
      ['./NOWHERE-readme.md', 'example-relative'],
    ]);
  });

  it('does not walk into a dependency tree looking for READMEs', () => {
    // A published dependency's own README is not ours to judge — same
    // exclusion every other walk in this file applies.
    expect(
      rejections({
        'packages/core/src/adapters/README.md': '[gone](./NOWHERE-ours.md)',
        'packages/core/node_modules/dep/src/README.md': '[gone](./NOWHERE-theirs.md)',
      }),
    ).toEqual([['./NOWHERE-ours.md', 'example-relative']]);
  });

  it('refuses a row that names both a collect list and an exclude list', () => {
    // Opposite readings of one list. Guessing which was meant would narrow a
    // surface silently, the one failure mode this gate must not have — same
    // stance as `expandWildcard()` throwing on a partial-segment glob.
    expect(() =>
      collectFiles(path.join(repoRoot, 'packages'), new Set(['CHANGELOG.md']), new Set(['README.md'])),
    ).toThrow(/`exclude` OR `collect`/);

    expect(
      (SCAN_ROOTS as ScanRoot[]).filter((row) => row.exclude && row.collect).map((row) => row.path),
      'a SCAN_ROOTS row carrying both filters has no defensible meaning',
    ).toEqual([]);
  });

  it('opens every nested README that is really in the tree — the surface, not the verdict', () => {
    // The assertion this card actually needs. Entry price was zero dead links,
    // so the green above proves nothing on its own; what has to be true is
    // that these files are now LOOKED AT. The population is derived from an
    // unfiltered walk of the same roots rather than listed here, so the day
    // someone writes the fifth nested README this test covers it without an
    // edit — and a row that stopped expanding fails here rather than going
    // quietly green.
    const nested = nestedReadmes();
    const opened = new Set(scannedByRow().map((entry) => entry.file.split(path.sep).join('/')));

    expect(nested.length, 'floor under the floor: an empty population would make the next line vacuous').toBeGreaterThanOrEqual(4);
    expect(nested.filter((file) => !opened.has(file)), 'a nested README no SCAN_ROOTS row opens').toEqual([]);
  });

  it('opens every file exactly once — the rows partition the tree, they do not overlap', () => {
    // The other half, and the constraint that makes it safe for three rows to
    // walk the same package directory: a file opened twice is judged twice and
    // reported twice. Repo-wide rather than package-only, because the cheapest
    // way to break it is a new row elsewhere, not a change to these.
    const rowsByFile = new Map<string, string[]>();
    for (const entry of scannedByRow()) {
      rowsByFile.set(entry.file, [...(rowsByFile.get(entry.file) ?? []), entry.row]);
    }

    const twice = [...rowsByFile.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([file, rows]) => `${file} <- ${rows.join(' + ')}`);

    expect(twice, 'these files are opened by more than one SCAN_ROOTS row').toEqual([]);
    expect(rowsByFile.size, 'floor under the floor: nothing scanned would make the line above vacuous').toBeGreaterThanOrEqual(250);
  });
});

/**
 * objectui#7644 — the `#fragment`, which nothing had ever resolved.
 *
 * The gap was measured as a two-arm control on `content/docs/api/schema-reference.md`:
 * the same invocation exited 1 on a broken file path and 0 on a broken in-page
 * anchor. These pin the second arm, in every shape that reaches the check, plus
 * the thing the check is only as good as — its slug rule.
 */
describe('in-page and cross-document anchors are resolved — objectui#7644', () => {
  it('resolves a duplicate heading the way the slugger disambiguates it', () => {
    expect(
      brokenHrefs({
        'guide/a.md': ['# A', '## Options', '## Options', '[first](#options)', '[second](#options-1)'].join('\n\n'),
      }),
    ).toEqual([]);
  });

  it('reports the suffix the slugger never handed out', () => {
    expect(
      brokenHrefs({ 'guide/a.md': ['# A', '## Options', '[third](#options-2)'].join('\n\n') }),
    ).toEqual(['#options-2']);
  });

  it('does not take a heading out of a fenced code block', () => {
    expect(
      brokenHrefs({
        'guide/a.md': ['# A', FENCE + 'md', '## Fenced heading', FENCE, '[x](#fenced-heading)'].join('\n'),
      }),
    ).toEqual(['#fenced-heading']);
  });

  it('does not take a heading out of YAML frontmatter, whose comments start with #', () => {
    expect(
      brokenHrefs({
        'guide/a.md': ['---', 'title: A', '# just a yaml comment', '---', '# Real', '[x](#just-a-yaml-comment)'].join(
          '\n',
        ),
      }),
    ).toEqual(['#just-a-yaml-comment']);
  });

  it("slugs a heading's inline code as literal text, angle brackets included", () => {
    // `### \`objectui add <component>\`` — seven headings in this repo have this
    // shape, and stripping tag-shaped text inside a code span would break them.
    expect(
      brokenHrefs({
        'guide/a.md': ['# A', '## `objectui add <component>`', '[x](#objectui-add-component)'].join('\n\n'),
      }),
    ).toEqual([]);
  });

  it('honours fumadocs `[#custom-id]` inside content/docs, and not on a disk surface', () => {
    // fumadocs' `remarkHeading` reads the override off the heading's last text
    // node; GitHub has no such syntax, so on a README the brackets are just text.
    expect(brokenHrefs({ 'guide/a.md': ['# A', '## Long Title [#short]', '[x](#short)'].join('\n\n') })).toEqual([]);
    expect(
      rejections({ 'docs/a.md': ['# A', '## Long Title [#short]', '[x](#short)'].join('\n\n') }),
    ).toEqual([['#short', 'anchor']]);
  });

  it('decodes a percent-encoded fragment before comparing', () => {
    expect(brokenHrefs({ 'guide/a.md': ['# A', '## Café', '[x](#caf%C3%A9)'].join('\n\n') })).toEqual([]);
  });

  it('judges nothing when the href names no anchor at all', () => {
    expect(brokenHrefs({ 'guide/a.md': '# A\n\n[x](./b.md#)', 'guide/b.md': '# B' })).toEqual([]);
  });

  it('resolves a fragment on this repo’s own blob URL, and skips a line reference', () => {
    // The objectui#3536 waiver this retires said anchors here were "a different
    // gate". Three such links are live in this tree and all three resolve.
    expect(
      rejections({
        ...SITE_FIXTURE,
        'content/docs/guide/a.md': [
          '[ok](https://github.com/objectstack-ai/objectui/blob/main/packages/core/README.md#install)',
          // fixture-address: fixture document content handed to the link reader, ⛔ not a pointer into this tree
          '[line](https://github.com/objectstack-ai/objectui/blob/main/packages/core/README.md#L42)',
          '[gone](https://github.com/objectstack-ai/objectui/blob/main/packages/core/README.md#uninstall)',
        ].join('\n\n'),
        'packages/core/README.md': '# Core\n\n## Install',
      }).map(([href, reason]) => [href.split('#')[1], reason]),
    ).toEqual([['uninstall', 'anchor']]);
  });

  it('has no opinion on a fragment whose target is not markdown it can read', () => {
    // A site route outside the collection is TSX, and a non-markdown file has no
    // headings. Neither is a pass dressed as one — the gate simply cannot decide.
    expect(
      rejections({
        ...SITE_FIXTURE,
        'content/docs/guide/a.md': '[play](/playground#tab-two)',
        'examples/demo/README.md': '[src](./App.tsx#L10) and [img](../../apps/site/public/img/guide/shot.png#x)',
        'examples/demo/App.tsx': 'export default null',
      }),
    ).toEqual([]);
  });

  it('checks the DOCUMENT before the anchor — a dead path is still a dead path', () => {
    expect(brokenHrefs({ 'guide/a.md': '[x](./gone.md#section)' })).toEqual(['./gone.md#section']);
  });
});

// `scripts/github-slug.mjs` is a COPY of github-slugger, because this gate runs
// before `pnpm install` and may not import a package (see
// `check-pre-install-import-graph.mjs --list`). A copy is only safe while
// something proves it still equals the original — that is what the describe below
// is. Both truth sources are resolved from the workspace package that DECLARES
// them, so neither is a phantom dependency of the repo root:
//   fumadocs-core  — declared by `apps/site`, the docs renderer itself
//   github-slugger — declared by `@object-ui/plugin-markdown`
const siteRequire = createRequire(path.join(repoRoot, 'apps/site/package.json'));
const markdownRequire = createRequire(path.join(repoRoot, 'packages/plugin-markdown/package.json'));

const loadToc = async (): Promise<(content: string, plugins: unknown[]) => Promise<{ url: string; title: string }[]>> =>
  (await import(pathToFileURL(siteRequire.resolve('fumadocs-core/content/toc')).href)).getTableOfContents;
const loadSlugger = async (): Promise<new () => { slug(value: string): string }> =>
  (await import(pathToFileURL(markdownRequire.resolve('github-slugger')).href)).default;
const loadMdx = async (): Promise<unknown> => (await import('remark-mdx')).default;

/** The document body fumadocs-mdx hands the remark pipeline: frontmatter gone. */
function documentBody(raw: string): string {
  const lines = raw.split('\n');
  if (!/^---\s*$/.test(lines[0] ?? '')) return raw;
  for (let index = 1; index < lines.length; index += 1) {
    // Blank the frontmatter rather than dropping it, so line numbers survive.
    if (/^(?:---|\.\.\.)\s*$/.test(lines[index])) return '\n'.repeat(index + 1) + lines.slice(index + 1).join('\n');
  }
  return raw;
}

/** One scanned file, parsed ONCE by the renderer both corpus tests compare against. */
interface CorpusEntry {
  readonly file: string;
  readonly rule: string;
  readonly raw: string;
  readonly body: string;
  readonly toc: { url: string; title: string }[];
}

/**
 * The whole-corpus walk, performed ONCE at MODULE SCOPE — objectui#8062.
 *
 * The two corpus tests at the bottom of this file each walked every
 * `SCAN_ROOTS` entry and handed all 273 files to fumadocs' own
 * `getTableOfContents`. Measured on this tree (2.5 MB of markdown): that remark
 * parse is 2.7-3.1 s per pass, while everything those two tests actually ASSERT
 * adds up to 27 ms. So an UNBOUNDED corpus walk sat inside vitest's BOUNDED
 * 15 s window — twice, over identical inputs — and both tests timed out under
 * container load (idle they were 4429 ms and 3792 ms, i.e. 3.4x of headroom,
 * and this file is measurably ~1.6x slower on a contended box).
 *
 * The repair is the one AGENTS.md prescribes under its test-discipline rule
 * ("flaky tests: look for the race, do not raise the timeout"), and it is NOT a
 * raised timeout: move the unbounded work OUT of the bounded window. Module
 * scope is the only home that qualifies — the cost lands in the import phase,
 * which no `testTimeout` governs, and unlike a `beforeAll` it does not trade
 * the 15 s budget for the NARROWER 10 s `hookTimeout`. Each `it()` below now
 * times its own assertion, and the shared parse is paid once, not twice.
 *
 * ⚠ Whatever else you do to this block, keep the parse here: this is the
 * property that makes the timeout question moot rather than merely deferred.
 */
const ANCHOR_CORPUS: CorpusEntry[] = await (async () => {
  const [getTableOfContents, remarkMdx] = await Promise.all([loadToc(), loadMdx()]);
  const entries: CorpusEntry[] = [];
  for (const row of SCAN_ROOTS as ScanRoot[]) {
    const files = collectFiles(
      path.join(repoRoot, row.path),
      row.exclude ? new Set(row.exclude) : undefined,
      row.collect ? new Set(row.collect) : undefined,
    ) as string[];
    for (const file of files) {
      const raw = fs.readFileSync(file, 'utf8');
      const body = documentBody(raw);
      // `.mdx` is parsed with `remark-mdx` exactly as `fumadocs-mdx` compiles
      // it; without it a JSX element followed by a heading with no blank line
      // between them is one HTML block, and four real files here have that shape.
      const toc = await getTableOfContents(body, file.endsWith('.mdx') ? [remarkMdx] : []);
      entries.push({ file, rule: row.rule, raw, body, toc });
    }
  }
  return entries;
})();

describe('the anchor rule is the renderers’ own, not this gate’s — objectui#7644', () => {
  it('reproduces github-slugger exactly, over every non-surrogate code point', async () => {
    // The tempting shortcut — `/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu` — is not
    // equivalent, and this is the assertion that says so: it disagrees on the
    // `No` digits (`²`, `¹`, `¼`) and on every letter Unicode has added since
    // the table was generated. Character by character, no room for a near-miss.
    const Slugger = await loadSlugger();
    const differing: string[] = [];
    let compared = 0;
    for (let point = 0; point <= 0x10ffff; point += 1) {
      if (point >= 0xd800 && point <= 0xdfff) continue; // lone surrogates are not characters
      const char = String.fromCodePoint(point);
      compared += 1;
      if (vendoredSlug(char) !== new Slugger().slug(char)) {
        differing.push(`U+${point.toString(16).toUpperCase()}`);
        if (differing.length > 8) break;
      }
    }
    expect(differing).toEqual([]);
    expect(compared).toBe(1_112_064); // a lit instrument, not an empty loop
  });

  it('reproduces the duplicate-heading counter, which is what makes `-1` resolvable', async () => {
    const Slugger = await loadSlugger();
    const upstream = new Slugger();
    const vendored = new VendoredSlugger();
    const headings = ['Options', 'Options', 'options', 'Options!', 'Options 1', 'Options', 'Other'];
    expect(headings.map((heading) => vendored.slug(heading))).toEqual(headings.map((heading) => upstream.slug(heading)));
  });

  it('agrees with the real renderers on every heading in the scan surface', async () => {
    // The corpus check, and the reason the hand-written flattener in
    // `check-doc-links.mjs` is safe to hand-write. Truth per rule:
    //   docs — fumadocs' own `getTableOfContents`, MDX-parsed for `.mdx` exactly
    //          as `fumadocs-mdx` compiles it (see `ANCHOR_CORPUS`, which is where
    //          that parse now happens — once, for both tests, objectui#8062).
    //   disk — GitHub, i.e. the real `github-slugger` run over the same flattened
    //          heading titles, in document order.
    const Slugger = await loadSlugger();
    const disagreeing: string[] = [];
    let docsFiles = 0;
    let diskFiles = 0;

    for (const { file, rule, raw, toc } of ANCHOR_CORPUS) {
      let expected: Set<string>;
      if (rule === 'docs') {
        docsFiles += 1;
        expected = new Set(toc.map((item) => item.url.slice(1)));
      } else {
        diskFiles += 1;
        const slugger = new Slugger();
        expected = new Set(toc.map((item) => slugger.slug(item.title)));
      }
      const actual = headingAnchors(raw, { customId: rule === 'docs' }) as Set<string>;
      const only = [...expected].filter((id) => !actual.has(id)).concat([...actual].filter((id) => !expected.has(id)));
      if (only.length > 0) disagreeing.push(`${path.relative(repoRoot, file)}: ${only.join(', ')}`);
    }

    expect(disagreeing).toEqual([]);
    // A zero above is only a reading if something was actually compared.
    expect(docsFiles).toBeGreaterThan(150);
    expect(diskFiles).toBeGreaterThan(50);
  });

  it('has no setext headings, which the ATX-only scan would not see', () => {
    // `Title` over `---` is a heading too, and `headingAnchors()` does not read
    // one. Nothing in this tree writes them; this is what says so out loud, so
    // the day someone does the answer is a red test rather than a missing anchor.
    // The renderer's own reading of each file is `ANCHOR_CORPUS` (objectui#8062);
    // what this test computes is the ATX count it compares that against.
    const setext: string[] = [];
    for (const { file, body, toc } of ANCHOR_CORPUS) {
      const lines = body.split('\n');
      // Every heading fumadocs found must have been written in ATX form; the
      // TOC carries no position, so compare counts against the ATX scan.
      const atx = lines.filter((line, index) => /^#{1,6}\s+\S/.test(line) && !inFence(lines, index)).length;
      if (toc.length > atx) setext.push(`${path.relative(repoRoot, file)}: ${toc.length} headings, ${atx} ATX`);
    }
    expect(setext).toEqual([]);
  });
});

/** Is `lines[target]` inside a fenced code block? */
function inFence(lines: string[], target: number): boolean {
  let fence: string | null = null;
  for (let index = 0; index < target; index += 1) {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[index]);
    if (!match) continue;
    const marker = match[1][0];
    if (fence === null) fence = marker;
    else if (marker === fence) fence = null;
  }
  return fence !== null;
}
