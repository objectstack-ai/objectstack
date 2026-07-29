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
//
// When a new major ships: write content/docs/releases/v<major>.mdx (lead with
// breaking changes + migration; fold minors into a "What's new in N.x" section)
// and add it to content/docs/releases/meta.json.
import { readFileSync, existsSync } from 'node:fs';

const SPEC_CHANGELOG = 'packages/spec/CHANGELOG.md';
const RELEASES_DIR = 'content/docs/releases';
const META_PATH = `${RELEASES_DIR}/meta.json`;
const ROOT_META_PATH = 'content/docs/meta.json';
const DOCS_HOME = 'content/docs/index.mdx';

// Curated release pages started at v9; v10/v11 were never backfilled (see
// content/docs/releases/index.mdx). Everything from v12 on must have a page.
const FLOOR_MAJOR = 9;
const KNOWN_MISSING = new Set([10, 11]);

function releasedMajors() {
  const text = readFileSync(SPEC_CHANGELOG, 'utf8');
  const majors = new Set();
  for (const m of text.matchAll(/^##\s+(\d+)\.\d+\.\d+/gm)) {
    majors.add(Number.parseInt(m[1], 10));
  }
  return [...majors].sort((a, b) => a - b);
}

const meta = JSON.parse(readFileSync(META_PATH, 'utf8'));
const metaPages = new Set(meta.pages || []);

const problems = [];

// The section itself has to be REACHABLE, or every page inside it is orphaned no
// matter how well the section's own meta.json is wired. #3423 took `releases`
// out of the root sidebar deliberately ("lookup content ... the docs home page
// links both"), which is a legitimate IA choice — the failure mode is losing
// BOTH entry points, which this check catches while allowing either one.
// Until now the success message claimed "navigable" while only ever reading the
// section's own meta.json.
const inRootNav = (() => {
  try {
    return (JSON.parse(readFileSync(ROOT_META_PATH, 'utf8')).pages || []).includes('releases');
  } catch {
    return false;
  }
})();
const onDocsHome = (() => {
  try {
    return /\]\(\/docs\/releases\b/.test(readFileSync(DOCS_HOME, 'utf8'));
  } catch {
    return false;
  }
})();
if (!inRootNav && !onDocsHome) {
  problems.push(
    `the Releases section is unreachable — "releases" is not in ${ROOT_META_PATH} ` +
      `"pages" AND ${DOCS_HOME} carries no /docs/releases link. Every release page ` +
      `is then an orphan that only a direct URL can reach. Restore one of the two.`,
  );
}
for (const major of releasedMajors()) {
  if (major < FLOOR_MAJOR || KNOWN_MISSING.has(major)) continue;
  const slug = `v${major}`;
  if (!existsSync(`${RELEASES_DIR}/${slug}.mdx`)) {
    problems.push(
      `${RELEASES_DIR}/${slug}.mdx is missing — @objectstack/spec shipped a ${major}.x ` +
        `release but there is no curated release page. Write it (lead with breaking ` +
        `changes + migration), then add "${slug}" to ${META_PATH}.`,
    );
  } else if (!metaPages.has(slug)) {
    problems.push(
      `${slug}.mdx exists but is not listed in ${META_PATH} "pages" — the page is ` +
        `unreachable in the docs nav. Add "${slug}" to the pages array.`,
    );
  }
}

if (problems.length > 0) {
  console.error(`check-release-notes: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}

console.log('check-release-notes: OK — every released major has a curated, navigable release page.');
