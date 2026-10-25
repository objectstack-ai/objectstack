import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#3449 — `check-links.yml` was pointed at the wrong tree.
 *
 * Its `args` listed `docs/**` and `README.md` — the repo-root tree of INTERNAL
 * material (ADRs, audit reports). The documentation the site actually publishes
 * lives under `content/docs/**`, the tree `apps/site/source.config.ts` declares
 * as `dir: '../../content/docs'` with baseUrl `/docs`. Not one published page
 * had ever been scanned. The workflow was green about a tree nobody reads and
 * silent about the tree everybody does, which is the same failure mode as
 * #3448 / #3261 / #2879 in this repo: a gate that looks configured and simply
 * never sees its subject.
 *
 * The scope is only part of the fix, so this file pins these halves:
 *
 *  1. **Scope, derived not copied.** The assertions below do not hard-code
 *     `content/docs`; they read the directory out of `apps/site/source.config.ts`
 *     and require the workflow to cover every markdown file under it. A
 *     hard-coded path would be a second copy of the site's layout, free to
 *     drift from it — which is exactly how this bug was born. Move the content
 *     tree again and this test goes red on the same day, instead of the
 *     workflow going quietly blind for another year.
 *
 *  2. **The `root_dir` / `exclude` pair in `lychee.toml`.** Widening the scope
 *     without it does not produce a working sweep, it produces 316 hard errors:
 *     `content/docs` carries ~297 site-absolute links (`/docs/...`), and Lychee
 *     fails those while CONSTRUCTING the URI — before `exclude` is consulted,
 *     so an `^/docs` exclude pattern cannot suppress them. The two settings only
 *     work together; removing either alone re-breaks the sweep, so neither may
 *     leave without the other.
 *
 *  3. **No document count, here or in the workflow's header.** objectui#7825.
 *     Both prose sentences above once carried a hand-copied size — one per tree
 *     — and so did `check-links.yml`'s header; every one of them had drifted
 *     with nothing red in between. The header may name which trees it sweeps,
 *     never how many documents they hold, and the pin below reads THIS block
 *     comment as well as the workflow's so neither copy can rot again.
 *
 * Also pinned: the trigger set. `schedule` must exist (the periodic sweep
 * #3213's ruling B intended, which was correctly withheld until the scope was
 * right), and `push` / `pull_request` must NOT — an external link checker walks
 * the network, and gating PRs on third-party uptime makes other people's work
 * fail for reasons they cannot fix.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/check-links.yml');
const lycheeConfigPath = path.join(repoRoot, 'lychee.toml');
const siteConfigPath = path.join(repoRoot, 'apps/site/source.config.ts');

/**
 * The workflow YAML with whole-line comments removed.
 *
 * Required, not cosmetic: the header explains at length why `push` and
 * `pull_request` stay disabled and names both of them, and the commented-out
 * trigger block is itself part of the record. A scan that counted either would
 * report triggers this workflow does not have.
 */
function withoutComments(yaml: string): string {
  return yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/**
 * The workflow's comment prose, with the leading `#` markers stripped.
 *
 * Stripped, not kept: a sentence that wraps across two comment lines has a `#`
 * sitting in the middle of it, and a scan that reads the raw lines cannot see a
 * numeral and the noun it qualifies as adjacent when the line break falls
 * between them. Removing the marker is what makes the count pin below read the
 * header the way a person does.
 */
function commentProse(yaml: string): string {
  return yaml
    .split('\n')
    .filter((line) => /^\s*#/.test(line))
    .map((line) => line.replace(/^\s*#\s?/, ''))
    .join('\n');
}

/**
 * This file's own leading block comment — the second surface the count pin reads.
 *
 * objectui#7825 found the two drifted counts in `check-links.yml`'s header
 * duplicated, word for word, in the header of the very file that pins it. One
 * of the two copies being guarded and the other not is how the guarded one gets
 * "corrected" from the stale twin later, so both are read here.
 */
function ownHeaderComment(): string {
  const source = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const block = /\/\*\*[\s\S]*?\*\//.exec(source);
  expect(block, "this file's own leading block comment is gone").not.toBeNull();
  return block![0];
}

/**
 * A numeral that qualifies a document-population noun, as `match: text`.
 *
 * Deliberately narrow, and narrow in the same place as the two objectui#7448
 * twins (`check-doc-fence-languages.test.ts`,
 * `check-doc-component-types.test.ts`): issue references, `node-version`,
 * `timeout-minutes`, a cron field and "the third instance of the same shape"
 * are all numbers a header legitimately carries, and none of them rots when a
 * document is added or deleted.
 *
 * Two deliberate widenings over the twins' regex, both measured on THIS header
 * before the fix (objectui#7825):
 *
 *   - **An adjective may sit between the numeral and the noun.** The twins
 *     require the two to be adjacent, and this header's older sentence read
 *     "holds 15 INTERNAL documents" — a document count by any reading, which
 *     the twins' pattern scores as clean. Run verbatim over the pre-fix header
 *     it reported ONE of the two live counts. The twins' own docstrings say
 *     "a numeral DIRECTLY qualifying a document-population noun", so this is
 *     the stated intent implemented, not a new rule.
 *   - **An issue reference is excluded by construction**, not by luck. With
 *     intervening words allowed, `#3449 named only the repo-root docs/**` is
 *     close enough to a false positive to be worth ruling out at the pattern
 *     level, and a header that cannot cite the PR that changed it is a header
 *     nobody will keep accurate.
 *
 * A fresh `RegExp` per call: `lastIndex` on a shared global literal is exactly
 * the kind of state that makes the second caller in a run measure something
 * different from the first.
 */
const POPULATION_COUNT =
  /(?<![#\w.])\d+(?:,\d{3})*\s+(?:[A-Za-z][\w-]*\s+){0,2}`?(?:\.mdx|\.md|documents?|pages?|docs?|files?)\b/i;

function documentCounts(text: string): string[] {
  return [...text.matchAll(new RegExp(POPULATION_COUNT.source, 'gi'))].map((m) => m[0].replace(/\s+/g, ' ').trim());
}

/** The quoted input patterns from the workflow's `args:` block. */
function scannedPatterns(yaml: string): string[] {
  return [...withoutComments(yaml).matchAll(/^\s*'([^']+)'\s*$/gm)].map((m) => m[1]);
}

/** Every `.md` / `.mdx` file below `dir`, as repo-relative paths. */
function markdownFilesUnder(dir: string): string[] {
  const absolute = path.join(repoRoot, dir);
  if (!fs.existsSync(absolute)) return [];
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.mdx?$/.test(entry.name)) found.push(path.relative(repoRoot, full));
    }
  };
  walk(absolute);
  return found;
}

/**
 * Files matched by one input pattern.
 *
 * Only the two shapes the workflow uses are supported — `<dir>/ ** / *.<ext>`
 * and a literal path. Anything else is reported rather than silently counted as
 * zero, because "matches nothing" is the very defect this file exists to catch.
 */
function filesMatching(pattern: string): string[] {
  const glob = /^(.+)\/\*\*\/\*\.([a-z]+)$/.exec(pattern);
  if (glob) {
    const [, base, extension] = glob;
    return markdownFilesUnder(base).filter((file) => file.endsWith(`.${extension}`));
  }
  if (/[*?[\]]/.test(pattern)) {
    throw new Error(`unsupported glob shape in check-links.yml args: ${pattern}`);
  }
  return fs.existsSync(path.join(repoRoot, pattern)) ? [pattern] : [];
}

/** The docs directory the site itself declares, as a repo-relative path. */
function declaredDocsDir(): string {
  const source = fs.readFileSync(siteConfigPath, 'utf8');
  const match = /\bdir:\s*'([^']+)'/.exec(source);
  expect(match, `${siteConfigPath} no longer declares a docs \`dir\``).not.toBeNull();
  const resolved = path.resolve(path.dirname(siteConfigPath), match![1]);
  return path.relative(repoRoot, resolved);
}

const workflowYaml = () => fs.readFileSync(workflowPath, 'utf8');

describe('check-links.yml — the external link sweep looks at the published docs', () => {
  it('scans every markdown file the site is built from', () => {
    // The #3449 assertion. Derived from the site config on purpose: see the
    // header. `content/docs` is never spelled out here.
    const docsDir = declaredDocsDir();
    const published = markdownFilesUnder(docsDir);
    expect(published.length, `no markdown found under the declared docs dir '${docsDir}'`).toBeGreaterThan(100);

    const scanned = new Set(scannedPatterns(workflowYaml()).flatMap(filesMatching));
    const missed = published.filter((file) => !scanned.has(file));
    expect(missed.slice(0, 5), `${missed.length} published doc(s) are not covered by check-links.yml args`).toEqual([]);
  });

  it('still sweeps the repo-root internal docs and README', () => {
    // Ruling on #3449: `docs/**` (ADRs, audits) and README keep their coverage.
    // Widening to the published tree was never meant to narrow anything.
    const scanned = new Set(scannedPatterns(workflowYaml()).flatMap(filesMatching));
    const internal = markdownFilesUnder('docs');
    expect(internal.length, "the repo-root internal docs tree is gone — re-read this workflow's scope").toBeGreaterThan(
      0,
    );

    const missed = internal.filter((file) => !scanned.has(file));
    expect(missed.slice(0, 5), `${missed.length} internal doc(s) are not covered by check-links.yml args`).toEqual([]);
    expect(scanned.has('README.md')).toBe(true);
  });

  it('states its inputs in a shape this test can actually evaluate', () => {
    // Coverage above is asserted per FILE, not per pattern, and that is
    // deliberate: `docs/**/*.mdx` currently matches nothing (the internal tree
    // is all `.md`) and should stay anyway, so that an internal `.mdx` landing
    // tomorrow is swept rather than becoming a fresh blind spot. What must not
    // happen is an args block this test cannot read — it would assert coverage
    // over an empty pattern list and pass while checking nothing.
    const patterns = scannedPatterns(workflowYaml());
    expect(patterns.length, 'no input patterns found in the args block').toBeGreaterThan(2);
    for (const pattern of patterns) expect(() => filesMatching(pattern)).not.toThrow();
  });

  it('runs on a schedule as well as on demand', () => {
    const yaml = withoutComments(workflowYaml());
    expect(yaml, 'the periodic sweep #3213 ruling B intended').toMatch(/^\s*schedule:/m);
    expect(yaml).toMatch(/^\s*-\s*cron:\s*'[^']+'/m);
    expect(yaml).toMatch(/^\s*workflow_dispatch:/m);
  });

  /**
   * objectui#7825 — the third copy of objectui#7448's pin, in the home the card
   * named. This header stated two document counts as literals: the repo-root
   * tree "holds 15 INTERNAL documents", and "the 183 files the published site is
   * built from live in `content/docs/**`". Both had drifted (17 and 184 on the
   * day the card was written, still 17 and 184 when it was fixed), and NOTHING
   * went red over the whole distance, because nothing fails on a stale number
   * written in a comment. It is the same defect the two twins already carry a
   * pin for, and the same fix `UNGATED_DOCS`'s header in
   * `check-doc-snippet-types.mjs` records being applied to itself — "a pointer
   * to the list now rather than a copy of its length".
   *
   * ⛔ Changing 15 to 17 and 183 to 184 would only have reloaded the trap. The
   * header names its populations now — which trees, which extensions — and
   * points at the two live readings (a `find` in any checkout, and Lychee's own
   * run summary). The rule this pin enforces is that no number may be written
   * back that adding a document would falsify.
   *
   * Only the negative half is asserted, as in both twins: a positive assertion
   * ("the header names the reading") would pin a wording, and pinned wording is
   * what this file refuses to do elsewhere. The one positive claim made here is
   * that the pin READ something — an empty scan is the failure mode this whole
   * gate family exists to catch, so both surfaces must come back non-trivial
   * before their emptiness means anything.
   */
  it('its header states the population and never counts it — no count can rot here', () => {
    const surfaces = [
      ['check-links.yml', commentProse(workflowYaml())],
      ["this test file's own header", ownHeaderComment()],
    ] as const;

    for (const [label, prose] of surfaces) {
      expect(
        prose.length,
        `${label}: the prose this pin reads came back empty or near-empty, so it asserted over nothing`,
      ).toBeGreaterThan(400);

      const counts = documentCounts(prose);
      expect(
        counts,
        `${label} states a document count (${counts.join(', ')}). Nothing fails when it drifts, so it ` +
          'will. State the population — which trees, which extensions — or point at a live reading, ' +
          'instead of copying a number into a comment (objectui#7448, objectui#7825).',
      ).toEqual([]);
    }
  });

  /**
   * The positive control for the pin above. A pin that cannot fail is not a pin,
   * and this repository has shipped one with zero demonstrated power before
   * (objectui#7466: 0/32 on the broken tree AND 0/32 on the fixed one), so the
   * shapes that actually rotted are fixtured here as POSITIVES rather than
   * trusted to a reading of the regex.
   *
   * The first two entries are this header's own pre-fix sentences, verbatim; the
   * next two are what the objectui#7448 twins' headers said. The negatives are
   * every number a workflow header legitimately carries — including
   * `297 site-absolute links`, which is the near miss that decides how many
   * intervening words the pattern may skip.
   */
  it('the count pin fires on the shapes that rotted, and on none of the numbers a header may keep', () => {
    const rotted = [
      'the repo-root `docs/**`, which holds 15 INTERNAL documents (ADRs, audits), while',
      'the 183 files the published site is built from live in `content/docs/**`',
      'the same 222 documents `check-doc-snippet-types` covers',
      '184 pages (144 `.mdx` + 40 `.md`)',
      'roughly 1,204 markdown files under the two trees',
      'the scan reads 17 internal ADR documents',
    ];
    for (const line of rotted) {
      expect(documentCounts(line), `the pin must fire on: ${line}`).not.toEqual([]);
    }

    const legitimate = [
      'was wrong until #3449: it listed only the repo-root `docs/**`',
      '#3449 pointed it at both trees, and the test derives the scope',
      'objectui#7448 landed the first two copies of this pin',
      'Weekly sweep, Sundays at 04:17 UTC.',
      'one 502, rate-limit or anti-scraping response from a third-party site',
      'node-version: 22',
      'timeout-minutes: 10',
      'the third instance of the same shape in this repo',
      '~297 site-absolute links (`/docs/...`) are excluded wholesale',
      'lychee-action@v2 with `fail: true`',
    ];
    for (const line of legitimate) {
      expect(documentCounts(line), `the pin must NOT fire on: ${line}`).toEqual([]);
    }
  });

  it('does not gate pull requests', () => {
    // #3213 ruling B. Lychee goes over the network; a third-party 502 must not
    // be able to redden somebody's unrelated PR. The commented-out block in the
    // workflow stays commented — `withoutComments` is what makes this real.
    const yaml = withoutComments(workflowYaml());
    expect(yaml, 'external link checking must not become a PR gate — see #3213').not.toMatch(/^\s*pull_request:/m);
    expect(yaml).not.toMatch(/^\s*push:/m);
  });
});

describe('lychee.toml — site-absolute routes are skipped, not resolved', () => {
  it('resolves site-absolute routes into a sentinel root and excludes it', () => {
    // Both halves or neither: `root_dir` alone turns 297 unresolvable links into
    // 297 "file not found" errors, and the exclude alone cannot fire at all,
    // because the failure happens before filtering.
    const config = fs.readFileSync(lycheeConfigPath, 'utf8');
    const rootDir = /^\s*root_dir\s*=\s*"([^"]+)"/m.exec(config);
    expect(rootDir, 'lychee.toml must set root_dir, or site-absolute links are hard errors').not.toBeNull();
    expect(rootDir![1].startsWith('/'), 'root_dir must be an absolute path').toBe(true);
    expect(fs.existsSync(rootDir![1]), 'root_dir is a sentinel namespace and must not exist on disk').toBe(false);
    expect(config, `root_dir ${rootDir![1]} is set but never excluded`).toContain(`"^file://${rootDir![1]}/`);
  });

  it('carries no remap pretending to resolve fumadocs routes', () => {
    // The removed `^/docs/(.*)$ file://./docs/$1` never fired (remap operates on
    // a parsed URL; `/docs/x` fails to parse first) and pointed at the internal
    // `docs/` tree besides. Route-to-file resolution has exactly one owner:
    // scripts/check-doc-links.mjs.
    const config = fs.readFileSync(lycheeConfigPath, 'utf8');
    const active = config
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    expect(active, 'internal route resolution belongs to scripts/check-doc-links.mjs').not.toMatch(/^\s*remap\s*=/m);
  });
});
