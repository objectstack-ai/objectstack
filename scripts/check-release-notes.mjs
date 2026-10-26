#!/usr/bin/env node
// check-release-notes — guard against the "docs stopped at vN while the
// platform shipped vN+k" drift (the gap that let v10–v14 ship with no curated
// release page while @objectstack/spec was already at 14.x).
//
// The platform is a single version-locked train (changesets `fixed` group), so
// the @objectstack/spec MAJOR is the platform version. Every RELEASED major
// must have a curated, developer-facing release page at
// content/docs/releases/v<major>.mdx, and that page must be wired into the
// section's meta.json so it is actually navigable.
//
// "Navigable" is checked at BOTH levels, because wiring a page into a section
// that is itself unreachable proves nothing: the section must be reachable too,
// via the root sidebar (content/docs/meta.json) or a /docs/releases link on the
// docs home page. Either satisfies it — #3423 deliberately traded the sidebar
// entry for the home-page link — but losing both orphans every release page.
//
// Released majors are read from the spec package CHANGELOG (the changesets
// source of truth). Curated pages only began at v9, and v10/v11 were never
// backfilled — those are the documented, intentional exceptions below. Anything
// else missing is a real gap and fails the build.
//
//   node scripts/check-release-notes.mjs
//   node scripts/check-release-notes.mjs --self-test   # the rule against fixtures, no tree read
//
// When a new major ships: write content/docs/releases/v<major>.mdx (lead with
// breaking changes + migration; fold minors into a "What's new in N.x" section)
// and add it to content/docs/releases/meta.json.
import { readFileSync, existsSync } from 'node:fs';
import { isEntrypoint } from './invoked-as.mjs';

const SPEC_CHANGELOG = 'packages/spec/CHANGELOG.md';
const RELEASES_DIR = 'content/docs/releases';
const META_PATH = `${RELEASES_DIR}/meta.json`;
const ROOT_META_PATH = 'content/docs/meta.json';
const DOCS_HOME = 'content/docs/index.mdx';

// Curated release pages started at v9; v10/v11 were never backfilled (see
// content/docs/releases/index.mdx). Everything from v12 on must have a page.
const FLOOR_MAJOR = 9;
const KNOWN_MISSING = new Set([10, 11]);

function releasedMajors(text) {
  const majors = new Set();
  for (const m of text.matchAll(/^##\s+(\d+)\.\d+\.\d+/gm)) {
    majors.add(Number.parseInt(m[1], 10));
  }
  return [...majors].sort((a, b) => a - b);
}

/**
 * The whole rule, over inputs `main()` reads from the tree and `selfTest()`
 * builds by hand. `inRootNav` / `docsHome` are null when their file could not
 * be read or parsed, which counts as "no entry point", exactly as the tree read
 * always has. Each problem carries a `kind` and the `subject` it names, so the
 * self-test asserts WHAT was found, never the wording of the message.
 */
function findProblems({ changelog, metaPages, inRootNav, docsHome, pageExists }) {
  const problems = [];

  // The section itself has to be REACHABLE, or every page inside it is orphaned no
  // matter how well the section's own meta.json is wired. #3423 took `releases`
  // out of the root sidebar deliberately ("lookup content ... the docs home page
  // links both"), which is a legitimate IA choice — the failure mode is losing
  // BOTH entry points, which this check catches while allowing either one.
  // Until now the success message claimed "navigable" while only ever reading the
  // section's own meta.json.
  const onDocsHome = docsHome !== null && /\]\(\/docs\/releases\b/.test(docsHome);
  if (inRootNav !== true && !onDocsHome) {
    problems.push({
      kind: 'section-unreachable',
      subject: 'releases',
      text:
        `the Releases section is unreachable — "releases" is not in ${ROOT_META_PATH} ` +
          `"pages" AND ${DOCS_HOME} carries no /docs/releases link. Every release page ` +
          `is then an orphan that only a direct URL can reach. Restore one of the two.`,
    });
  }
  for (const major of releasedMajors(changelog)) {
    if (major < FLOOR_MAJOR || KNOWN_MISSING.has(major)) continue;
    const slug = `v${major}`;
    // Two layouts, both first-class, and this gate owns EXISTENCE only: one flat
    // `v16.mdx`, or a `v17/` folder whose `index.mdx` is the major's landing page
    // with one file per minor beside it. Either satisfies "the major has a
    // curated, navigable page" — the nav entry is the folder name in both cases,
    // so the `metaPages` check below is unchanged. ⛔ Neither layout is deprecated.
    if (!pageExists(`${RELEASES_DIR}/${slug}.mdx`) && !pageExists(`${RELEASES_DIR}/${slug}/index.mdx`)) {
      problems.push({
        kind: 'page-missing',
        subject: slug,
        text:
          `${RELEASES_DIR}/${slug}.mdx (or ${RELEASES_DIR}/${slug}/index.mdx) is missing — ` +
            `@objectstack/spec shipped a ${major}.x ` +
            `release but there is no curated release page. Write it (lead with breaking ` +
            `changes + migration), then add "${slug}" to ${META_PATH}.`,
      });
    } else if (!metaPages.has(slug)) {
      problems.push({
        kind: 'page-unlisted',
        subject: slug,
        text:
          `${slug}.mdx exists but is not listed in ${META_PATH} "pages" — the page is ` +
            `unreachable in the docs nav. Add "${slug}" to the pages array.`,
      });
    }
  }
  return problems;
}

// ── --self-test ──────────────────────────────────────────────────────────────
//
// Shape copied from `scripts/check-agent-model-declared.mjs` (AGENTS.md,
// "Writing a --self-test"): a literal cases table whose row LABELS are the
// battery roster, each floored at 1 and registered as the first statement of
// the loop body; the roster's own size pinned; and a verdict flag the dispatch
// refuses to run without.

let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'every released major has a page listed in meta.json → GREEN': 1,
  'a released major with no page → RED, naming the missing page': 1,
  'a page that exists but is not in meta.json "pages" → RED': 1,
  'the folder layout (vN/index.mdx) satisfies existence → GREEN': 1,
  'majors below the floor and the known-missing v10/v11 are skipped → GREEN': 1,
  'majors are read from CHANGELOG release headings only, deduplicated': 1,
  'no root-nav entry AND no docs-home link → RED (section unreachable)': 1,
  'the docs-home link alone keeps the section reachable → GREEN': 1,
  'an unreadable root meta.json and docs home count as no entry point → RED': 1,
  'several defects → every one reported, not only the first': 1,
});

const SELF_TEST_BATTERY_FLOOR = 10;

function selfTest() {
  const page = (slug) => `${RELEASES_DIR}/${slug}.mdx`;
  const changelog = (...versions) => `# @objectstack/spec\n\n${versions.map((v) => `## ${v}\n\n- a change\n`).join('\n')}`;
  const tree = ({ log = changelog('16.0.0', '17.2.0', '17.0.0'), meta = ['v16', 'v17'], pages = [page('v16'), page('v17')], inRootNav = true, docsHome = null } = {}) => ({
    changelog: log,
    metaPages: new Set(meta),
    inRootNav,
    docsHome,
    pageExists: (path) => pages.includes(path),
  });

  const cases = [
    {
      label: 'every released major has a page listed in meta.json → GREEN',
      input: tree(),
      expect: [],
    },
    {
      label: 'a released major with no page → RED, naming the missing page',
      input: tree({ pages: [page('v16')] }),
      expect: ['page-missing:v17'],
    },
    {
      label: 'a page that exists but is not in meta.json "pages" → RED',
      input: tree({ meta: ['v16'] }),
      expect: ['page-unlisted:v17'],
    },
    {
      label: 'the folder layout (vN/index.mdx) satisfies existence → GREEN',
      input: tree({ pages: [page('v16'), `${RELEASES_DIR}/v17/index.mdx`] }),
      expect: [],
    },
    {
      label: 'majors below the floor and the known-missing v10/v11 are skipped → GREEN',
      input: tree({ log: changelog('8.1.0', '10.0.0', '11.3.2', '16.0.0'), meta: ['v16'], pages: [page('v16')] }),
      expect: [],
    },
    {
      label: 'majors are read from CHANGELOG release headings only, deduplicated',
      check: () => JSON.stringify(releasedMajors('## 13.0.0\n### 99.0.0\n## 12.1.0\n## 13.4.1\n  ## 14.0.0\n## 15.x\n')) === '[12,13]',
    },
    {
      label: 'no root-nav entry AND no docs-home link → RED (section unreachable)',
      input: tree({ inRootNav: false, docsHome: 'See [the changelog](/docs/changelog).' }),
      expect: ['section-unreachable:releases'],
    },
    {
      label: 'the docs-home link alone keeps the section reachable → GREEN',
      input: tree({ inRootNav: false, docsHome: 'Read [the release notes](/docs/releases).' }),
      expect: [],
    },
    {
      label: 'an unreadable root meta.json and docs home count as no entry point → RED',
      input: tree({ inRootNav: null, docsHome: null }),
      expect: ['section-unreachable:releases'],
    },
    {
      label: 'several defects → every one reported, not only the first',
      input: tree({ inRootNav: false, meta: [], pages: [page('v16')] }),
      expect: ['section-unreachable:releases', 'page-unlisted:v16', 'page-missing:v17'],
    },
  ];

  const batterySeen = new Map();
  let failed = 0;
  for (const c of cases) {
    batterySeen.set(c.label, (batterySeen.get(c.label) ?? 0) + 1);
    let ok;
    let detail = '';
    if (c.check) {
      ok = c.check();
    } else {
      const got = findProblems(c.input).map((p) => `${p.kind}:${p.subject}`);
      ok = JSON.stringify(got) === JSON.stringify(c.expect);
      if (!ok) detail = `\n      expected ${JSON.stringify(c.expect)}\n      got      ${JSON.stringify(got)}`;
    }
    if (ok) {
      console.log(`  ✓ ${c.label}`);
    } else {
      console.error(`  ✗ ${c.label}${detail}`);
      failed += 1;
    }
  }

  // The floor: every declared row RAN, evaluated before the verdict so the
  // success line can only follow a run whose registered rows equal the roster.
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed += 1;
  };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — ` +
        'a battery deleted from the roster takes its own floor with it.',
    );
  }
  const labels = cases.map((c) => c.label);
  const duplicated = [...new Set(labels.filter((label, i) => labels.indexOf(label) !== i))];
  if (duplicated.length > 0) {
    floorFailure(`the cases table uses ${duplicated.map((l) => JSON.stringify(l)).join(', ')} as a row label more than once.`);
  }
  for (const [label, count] of batterySeen) {
    if (!declared.includes(label)) {
      floorFailure(`self-test battery "${label}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
    }
  }
  for (const label of declared) {
    const count = batterySeen.get(label) ?? 0;
    if (count < SELF_TEST_BATTERIES[label]) {
      floorFailure(`self-test battery "${label}" DID NOT RUN — ${count} case(s) registered, ${SELF_TEST_BATTERIES[label]} pinned.`);
    }
  }

  if (failed > 0) {
    console.error(`\n✗ check-release-notes self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`\n✓ check-release-notes self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-release-notes self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test\n' +
          'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return;
  }

  const meta = JSON.parse(readFileSync(META_PATH, 'utf8'));
  const readOrNull = (path, parse) => {
    try {
      return parse(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  };
  const problems = findProblems({
    changelog: readFileSync(SPEC_CHANGELOG, 'utf8'),
    metaPages: new Set(meta.pages || []),
    inRootNav: readOrNull(ROOT_META_PATH, (text) => (JSON.parse(text).pages || []).includes('releases')),
    docsHome: readOrNull(DOCS_HOME, (text) => text),
    pageExists: existsSync,
  });

  if (problems.length > 0) {
    console.error(`check-release-notes: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  • ${p.text}`);
    process.exit(1);
  }

  console.log('check-release-notes: OK — every released major has a curated, navigable release page.');
}

if (isEntrypoint(import.meta.url)) {
  main();
}
