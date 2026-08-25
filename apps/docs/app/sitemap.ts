import { execFileSync } from 'node:child_process';

import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/site';
import { blog, source } from '@/lib/source';

/**
 * `/sitemap.xml`.
 *
 * Same story as `app/robots.ts`: with no route here the path fell through to
 * `app/[lang]/page.tsx` and answered `200 text/html`, so a sitemap submitted to
 * Search Console would have failed to parse. Every indexable URL is derived from
 * `source` / `blog` — never a hand-maintained list, which is guaranteed to rot the
 * first time a page is added.
 *
 * Static: generated once at build, so the `git log` below runs in the build
 * process and never in a request.
 */
export const dynamic = 'force-static';
export const revalidate = false;

/** Repo-relative roots of the two MDX collections, matching `source.config.ts`. */
const DOCS_CONTENT_ROOT = 'content/docs';
const BLOG_CONTENT_ROOT = 'content/blog';

/**
 * `lastModified` comes from the git committer date of each source `.mdx`, not from
 * build time. Build time would restamp all 400+ pages on every deploy, which tells
 * a crawler that the whole site changed whenever anything did — a signal that gets
 * discounted precisely because it is never false.
 *
 * One `git log` pass over both collections covers every file (~1s over 11k commits
 * locally, measured), rather than one `git log` per page.
 *
 * When the date cannot be known — no git directory, or a clone shallow enough that
 * no commit in the window touched the file — the entry ships **without**
 * `lastModified`. `lastmod` is optional in the sitemap protocol, and omitting it is
 * the honest answer; substituting build time would reintroduce the exact lie this
 * function exists to avoid. Degrading silently is not on the table either: the
 * build prints a counted warning naming the remedy.
 */
let cachedGitDates: Map<string, Date> | undefined;

function loadGitDates(): Map<string, Date> {
  if (cachedGitDates) return cachedGitDates;

  const dates = new Map<string, Date>();
  const git = (args: string[], cwd: string) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  try {
    const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
    const shallow = git(['rev-parse', '--is-shallow-repository'], repoRoot).trim() === 'true';
    if (shallow) {
      console.warn(
        '[sitemap] the checkout is a shallow clone; pages whose last commit predates the ' +
          'clone depth will ship without <lastmod>. Deepen the clone to restore the dates.',
      );
    }

    // `--format` marker cannot collide with a path: no file under content/ starts
    // with "commit-date:". `diff.relative=false` pins the printed paths to
    // repo-root-relative regardless of local git config.
    const log = git(
      [
        '-c',
        'diff.relative=false',
        'log',
        '--format=commit-date:%cI',
        '--name-only',
        '--no-renames',
        '--',
        DOCS_CONTENT_ROOT,
        BLOG_CONTENT_ROOT,
      ],
      repoRoot,
    );

    // `git log` is newest-first, so the first date seen for a path is its latest.
    let current: Date | undefined;
    for (const line of log.split('\n')) {
      if (line.startsWith('commit-date:')) {
        current = new Date(line.slice('commit-date:'.length));
        continue;
      }
      if (!line || !current || dates.has(line)) continue;
      dates.set(line, current);
    }
  } catch (error) {
    console.warn(
      `[sitemap] could not read commit dates from git (${
        error instanceof Error ? error.message : String(error)
      }); every entry will ship without <lastmod>.`,
    );
  }

  cachedGitDates = dates;
  return dates;
}

type SitemapEntry = MetadataRoute.Sitemap[number];

export default function sitemap(): MetadataRoute.Sitemap {
  const dates = loadGitDates();
  const undated: string[] = [];

  /**
   * `sourcePath` is repo-relative; `undefined` for routes with no MDX file behind
   * them (the homepage, the blog index), which are not counted as missing dates.
   */
  const entry = (url: string, sourcePath?: string): SitemapEntry => {
    const lastModified = sourcePath ? dates.get(sourcePath) : undefined;
    if (sourcePath && !lastModified) undated.push(sourcePath);
    return lastModified ? { url: absoluteUrl(url), lastModified } : { url: absoluteUrl(url) };
  };

  const byUrl = (a: SitemapEntry, b: SitemapEntry) => a.url.localeCompare(b.url);

  // `getPages()` with no argument lists every language. English is the only one
  // today, and a future locale belongs in the sitemap under its own prefixed URL,
  // so leaving it unfiltered is the forward-correct spelling.
  const docs = source
    .getPages()
    .map((page) => entry(page.url, `${DOCS_CONTENT_ROOT}/${page.path}`))
    .sort(byUrl);

  const posts = blog
    .getPages()
    .map((page) => entry(page.url, `${BLOG_CONTENT_ROOT}/${page.path}`))
    .sort(byUrl);

  if (undated.length > 0) {
    console.warn(
      `[sitemap] ${undated.length} of ${docs.length + posts.length} content pages have no git ` +
        `commit date and ship without <lastmod>; first: ${undated.slice(0, 3).join(', ')}`,
    );
  }

  // No `priority` or `changeFrequency`: Google ignores both, and inventing values
  // for 400+ pages would put numbers into a machine-readable surface that nothing
  // measured.
  return [entry('/'), ...docs, entry('/blog'), ...posts];
}
