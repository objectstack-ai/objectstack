// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `export-gallery --check DIR` — the mechanical check a PR on
 * objectstack-ai/gallery must pass before anyone merges it. It reads a gallery
 * tree and answers one finding per defect; an empty answer is a clean tree.
 * It writes nothing and needs no checkout of this repository.
 *
 * It lives beside the exporter and reads the exporter's own contract — the
 * index schema (`manifest.ts`), the app layout and the stable-version shape
 * (`contract.ts`) — so what the exporter writes and what the check accepts
 * cannot drift. The findings, each with its code:
 *
 *   index-json        `index.json` is not JSON, or does not match
 *                     {@link GalleryIndexSchema} (one finding per schema issue).
 *                     An absent `index.json` is an empty gallery, as the
 *                     exporter and the refresh read it.
 *   app-missing       an entry has no `apps/<id>/` directory.
 *   app-incomplete    an entry's directory lacks a file of {@link APP_LAYOUT}:
 *                     the README, the run record, the scorecard and the
 *                     transcript (JSON and Markdown each), and a `source/` tree
 *                     holding `objectstack.config.ts`.
 *   app-screenshots   an entry lists no screenshot, a listed screenshot is not
 *                     on disk, or `screenshots/` holds a file the entry does
 *                     not list.
 *   app-unlisted      a directory under `apps/` that no entry lists (a
 *                     half-written export's staging directory included).
 *   framework-version an entry's `framework.version` is not a stable
 *                     `MAJOR.MINOR.PATCH`, or not a version of
 *                     {@link FRAMEWORK_PACKAGE} published on npm.
 *   env-file          a file or directory whose name starts `.env`, anywhere.
 *   node-modules      a `node_modules` directory, anywhere.
 *   symbolic-link     a symbolic link, anywhere: the exporter writes none, and
 *                     the content scan below cannot see what one points at.
 *   local-path        a file whose text names an absolute path on a local
 *                     machine ({@link LOCAL_PATH}); the exporter redacts every
 *                     work directory to `$WORK`, so one that survives is a leak.
 *
 * Where the published versions come from is the caller's: the command line
 * asks npm (`npm view @objectstack/cli versions --json`, {@link npmPublishedVersions});
 * a test hands it a list. It is asked only when the index lists an app, so an
 * empty gallery is checked with no network at all.
 *
 * The content scan reads text files only. A file with a NUL byte in its first
 * 8 KiB is binary (the screenshots) and is not scanned; its name still is.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP_LAYOUT, FRAMEWORK_PACKAGE, STABLE_VERSION } from './contract.js';
import { GalleryIndexSchema, type GalleryApp } from './manifest.js';

export const FINDING_CODES = [
  'index-json',
  'app-missing',
  'app-incomplete',
  'app-screenshots',
  'app-unlisted',
  'framework-version',
  'env-file',
  'node-modules',
  'symbolic-link',
  'local-path',
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];

export interface GalleryFinding {
  /** Which finding it is, one of {@link FINDING_CODES}: a diagnostic code, never an ADR-0112 wire code. */
  kind: FindingCode;
  /** Relative to the gallery root, forward slashes; `.` for the root itself. */
  path: string;
  message: string;
}

/** One finding as the command line prints it: `CODE PATH: MESSAGE`, one line. */
export function renderFinding(f: GalleryFinding): string {
  return `${f.kind} ${f.path}: ${f.message.replace(/\s*\n\s*/g, ' ')}`;
}

export interface CheckOptions {
  /** Every published version of {@link FRAMEWORK_PACKAGE}; called once, and only when the index lists an app. */
  publishedVersions: () => readonly string[];
}

/** Every published version of `pkg` (`npm view`, so the caller's npm configuration applies). Throws when npm cannot answer. */
export function npmPublishedVersions(pkg: string = FRAMEWORK_PACKAGE): string[] {
  const out = execFileSync('npm', ['view', pkg, 'versions', '--json'], { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const v = JSON.parse(out) as unknown;
  // npm answers a bare string when a package has exactly one version.
  const list = typeof v === 'string' ? [v] : v;
  if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) throw new Error(`npm view ${pkg} versions answered something that is not a version list`);
  return list;
}

/**
 * An absolute path on a local machine: a home, temp or mount root on a POSIX
 * system, a `file://` URL, or a Windows drive path into its user or system
 * directories. The POSIX roots must start a path (nothing word-like or a slash
 * before them), so a URL path (`https://example.com/home/…`) and a route
 * (`/api/v1/…`) are not read as one.
 */
export const LOCAL_PATH =
  /(?<![\w.\/-])\/(?:home|Users|root|tmp|private|var\/folders|mnt|opt|srv|workspace)\/|file:\/\/\/|(?<![A-Za-z0-9])[A-Za-z]:\\{1,2}(?:Users|Windows|ProgramData|Program Files|Temp|Documents and Settings)\\/i;

const ENV_NAME = /^\.env/;
const BINARY_PROBE = 8192;

/** The app files a complete `apps/<id>/` directory holds, besides `source/` and the screenshots. */
const REQUIRED_FILES = [APP_LAYOUT.readme, APP_LAYOUT.runRecord, APP_LAYOUT.scorecardJson, APP_LAYOUT.scorecardMd, APP_LAYOUT.transcriptJson, APP_LAYOUT.transcriptMd] as const;

/** The file `source/` must hold: the project file the exporter refuses to export without (`source.ts`). */
const SOURCE_REQUIRED = 'objectstack.config.ts';

/** Records one finding of this kind. */
type AddFinding = (kind: FindingCode, path: string, message: string) => void;

const isDir = (p: string) => existsSync(p) && lstatSync(p).isDirectory();
const isFile = (p: string) => existsSync(p) && lstatSync(p).isFile();

/** Every finding on the gallery tree at `dir`, in a stable order: the index, the apps, then the tree scan. */
export function checkGallery(dir: string, opts: CheckOptions): GalleryFinding[] {
  const findings: GalleryFinding[] = [];
  const add: AddFinding = (kind, path, message) => void findings.push({ kind, path, message });

  // ── the index ────────────────────────────────────────────────────────────
  const indexFile = join(dir, 'index.json');
  let apps: GalleryApp[] | undefined = [];
  if (existsSync(indexFile)) {
    apps = undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(indexFile, 'utf8'));
    } catch (e) {
      add('index-json', 'index.json', `not JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (raw !== undefined) {
      const parsed = GalleryIndexSchema.safeParse(raw);
      if (parsed.success) apps = parsed.data.apps;
      else for (const issue of parsed.error.issues) add('index-json', 'index.json', `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`);
    }
  }

  // ── the apps the index lists, and the directories it does not ─────────────
  const appsDir = join(dir, 'apps');
  const appDirs = isDir(appsDir)
    ? readdirSync(appsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : [];
  if (apps !== undefined) {
    let published: ReadonlySet<string> | undefined;
    for (const app of apps) {
      const rel = `apps/${app.id}`;
      const root = join(dir, rel);
      if (!isDir(root)) {
        add('app-missing', rel, `index.json lists \`${app.id}\`, and there is no ${rel}/ directory`);
      } else {
        for (const f of REQUIRED_FILES) if (!isFile(join(root, f))) add('app-incomplete', `${rel}/${f}`, `a complete app directory holds ${f}, and this one has none`);
        if (!isFile(join(root, APP_LAYOUT.source, SOURCE_REQUIRED))) {
          add('app-incomplete', `${rel}/${APP_LAYOUT.source}`, `a complete app directory holds its metadata source, ${APP_LAYOUT.source}/${SOURCE_REQUIRED} at least, and this one does not`);
        }
        checkScreenshots(dir, app, add);
      }
      const v = app.framework.version;
      if (!STABLE_VERSION.test(v)) {
        add('framework-version', `index.json`, `${app.id}: framework.version \`${v}\` is not a stable MAJOR.MINOR.PATCH release of ${FRAMEWORK_PACKAGE}`);
      } else {
        published ??= new Set(opts.publishedVersions());
        if (!published.has(v)) add('framework-version', 'index.json', `${app.id}: framework.version \`${v}\` is not a published ${FRAMEWORK_PACKAGE} version`);
      }
    }
    const listed = new Set(apps.map((a) => a.id));
    for (const d of appDirs) if (!listed.has(d)) add('app-unlisted', `apps/${d}`, 'a directory under apps/ that index.json does not list');
  }

  // ── the whole tree: stray files and local paths ──────────────────────────
  scanTree(dir, '', add);
  return findings;
}

function checkScreenshots(dir: string, app: GalleryApp, add: AddFinding): void {
  const rel = `apps/${app.id}/${APP_LAYOUT.screenshots}`;
  if (app.screenshots.length === 0) add('app-screenshots', rel, `index.json lists no screenshot for \`${app.id}\`: an app is shown with its screenshots`);
  const listed = new Set(app.screenshots.map((s) => s.path));
  for (const s of app.screenshots) if (!isFile(join(dir, s.path))) add('app-screenshots', s.path, 'index.json lists this screenshot, and the file is not there');
  const shotsDir = join(dir, rel);
  if (!isDir(shotsDir)) return;
  for (const e of readdirSync(shotsDir, { withFileTypes: true })) {
    const p = `${rel}/${e.name}`;
    if (!listed.has(p)) add('app-screenshots', p, `index.json does not list this file for \`${app.id}\``);
  }
}

function scanTree(root: string, rel: string, add: AddFinding): void {
  for (const e of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (!rel && e.name === '.git') continue;
    if (e.isSymbolicLink()) {
      add('symbolic-link', p, 'a symbolic link: the exporter writes none, and what it points at is not checked');
      continue;
    }
    if (ENV_NAME.test(e.name)) add('env-file', p, 'an environment file never belongs in the gallery');
    if (e.isDirectory()) {
      if (e.name === 'node_modules') add('node-modules', p, 'an installed dependency tree never belongs in the gallery');
      else scanTree(root, p, add);
      continue;
    }
    if (!e.isFile()) continue;
    const bytes = readFileSync(join(root, p));
    if (bytes.subarray(0, BINARY_PROBE).includes(0)) continue;
    const lines = bytes.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = LOCAL_PATH.exec(lines[i]!);
      if (m) {
        add('local-path', `${p}:${i + 1}`, `names a local absolute path (\`${m[0]}…\`); the exporter redacts every work directory to $WORK`);
        break; // one finding per file: the first line that names one
      }
    }
  }
}
