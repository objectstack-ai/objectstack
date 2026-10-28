import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceRoot } from '../workspace-root.mjs';

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
 *  2. **Site-absolute routes are given a root.** Widening the scope without
 *     one does not produce a working sweep, it produces hundreds of hard errors:
 *     `content/docs` carries site-absolute links (`/docs/...`), and Lychee fails
 *     those while CONSTRUCTING the URI — before `exclude` is consulted, so an
 *     `^/docs` exclude pattern cannot suppress them. objectui's `lychee.toml`
 *     answered with a `root_dir` sentinel plus its exclude. The lane that runs
 *     now, the root `check-links.yml`, answers with `--root-dir` at the content
 *     root plus `--fallback-extensions`, so the routes RESOLVE; this pin reads
 *     that argv (objectstack#26080). The two flags only work together: a route
 *     omits its extension, so a root alone turns every route into "file not
 *     found".
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
 *
 * ⚠️ Half 1, the workflow surface of half 3 and the trigger set retired with
 * objectstack#25712; the note above the first describe names the cases. Half 2
 * and this header's own count pin stand.
 */

/**
 * The lychee run that exists: the root `check-links.yml`, which passes
 * `--config lychee.toml` from the repository root. objectui's own
 * `lychee.toml` was read by no workflow and is gone (objectstack#26080).
 */
const liveRoot = workspaceRoot();
const liveLycheeConfigPath = path.join(liveRoot, 'lychee.toml');
const checkLinksWorkflowPath = path.join(liveRoot, '.github/workflows/check-links.yml');

/**
 * The lychee argv `check-links.yml` declares once in `env.LYCHEE_ARGS`, one
 * token per entry. A `${{ … }}` expression is collapsed to one token first
 * (`${{github.workspace}}/content`), so its inner spaces do not split it.
 */
function lycheeArgs(): string[] {
  const lines = fs.readFileSync(checkLinksWorkflowPath, 'utf8').split('\n');
  const start = lines.findIndex((line) => /^\s*LYCHEE_ARGS:\s*>-\s*$/.test(line));
  expect(start, 'check-links.yml no longer declares LYCHEE_ARGS as a folded block').toBeGreaterThan(-1);
  const indent = /^\s*/.exec(lines[start])![0].length;
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && /^\s*/.exec(line)![0].length <= indent) break;
    block.push(line.trim());
  }
  return block
    .join(' ')
    .replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_, expr: string) => `\${{${expr}}}`)
    .split(/\s+/)
    .filter(Boolean);
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

/**
 * Retired with objectstack#25712: `scans every markdown file the site is built
 * from`, `still sweeps the repo-root internal docs and README`, `states its
 * inputs in a shape this test can actually evaluate`, `runs on a schedule as
 * well as on demand`, `does not gate pull requests`, and the workflow surface
 * of the count pin below. Each read objectui's `check-links.yml` (its `args:`
 * block against the docs tree `apps/site/source.config.ts` declares, its
 * triggers, its header prose), which runs nowhere under the monorepo: GitHub
 * runs the root `.github/workflows/` alone. The root `check-links.yml` sweeps
 * the root's own trees, not `ui/`. objectui's is row 6 of the objectstack#25697
 * workflow roster (→ sub-issue 4, which widens the root sweep to `ui/` or keeps
 * objectui's); either way the port brings these pins back against the root
 * workflow, by path.
 */
describe('check-links — the header count pin', () => {
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
    const surfaces = [["this test file's own header", ownHeaderComment()]] as const;

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
});

describe('check-links — site-absolute routes are resolved against the content root', () => {
  it('hands lychee a root for site-absolute routes, and the extensions a route omits', () => {
    // Both halves or neither: without `--root-dir` every `/docs/...` link is a
    // hard error before any filter runs, and a root without
    // `--fallback-extensions` turns every extension-less route into a
    // "file not found".
    const args = lycheeArgs();
    const value = (flag: string): string | undefined => {
      const at = args.indexOf(flag);
      return at === -1 ? undefined : args[at + 1];
    };
    expect(value('--config'), 'the lane must read the root lychee.toml').toBe('lychee.toml');

    const rootDir = value('--root-dir');
    expect(rootDir, 'check-links.yml must pass --root-dir, or site-absolute links are hard errors').toBeDefined();
    const workspace = '${{github.workspace}}/';
    expect(rootDir!.startsWith(workspace), '--root-dir must be absolute, i.e. anchored on the workspace').toBe(true);
    const rel = rootDir!.slice(workspace.length);
    expect(fs.existsSync(path.join(liveRoot, rel, 'docs')), `--root-dir ${rel} must be the tree \`/docs/...\` routes live under`).toBe(true);

    const fallback = (value('--fallback-extensions') ?? '').split(',');
    expect(fallback, '--root-dir alone leaves every extension-less route unresolved').toEqual(
      expect.arrayContaining(['mdx', 'md']),
    );
  });

  it('carries no remap pretending to resolve fumadocs routes', () => {
    // The removed `^/docs/(.*)$ file://./docs/$1` never fired (remap operates on
    // a parsed URL; `/docs/x` fails to parse first) and pointed at the internal
    // `docs/` tree besides. Route-to-file resolution has exactly one owner:
    // scripts/check-doc-links.mjs.
    const config = fs.readFileSync(liveLycheeConfigPath, 'utf8');
    const active = config
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    expect(active, 'internal route resolution belongs to scripts/check-doc-links.mjs').not.toMatch(/^\s*remap\s*=/m);
  });
});
