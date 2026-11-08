// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The gallery refresh: one deterministic step from "is there a new stable
 * release?" to "a local commit on `export/<version>` in a gallery checkout".
 * Ruling D2 of the scenario-library epic makes a daily scheduled Claude Code
 * task, on the maintainer's subscription login, its caller; the package README
 * ("Refreshing the gallery — the scheduled task's runbook") holds the task's
 * text. The CLI is `refresh-cli.ts` (`gallery-refresh`).
 *
 * In order, each step a refusal ({@link RefreshRefusal}, exit non-zero) or a
 * quiet skip ({@link RefreshOutcome} `skip`, one line, exit 0):
 *
 *   1. The gallery directory is the top of a git checkout with a clean working
 *      tree, and its `index.json` (absent: an empty gallery) is one the
 *      exporter wrote (`manifest.ts`).
 *   2. npm's latest stable `@objectstack/cli` ({@link FRAMEWORK_PACKAGE}) is
 *      read; a `latest` that is not a plain `MAJOR.MINOR.PATCH` is refused.
 *   3. Skip when the gallery is already on it: the index lists at least one
 *      app and every app's `framework.version` equals it (the index carries
 *      the version per app — the `@objectstack/spec` the app's project pins,
 *      which `create-objectstack` pins to its own release, and the fixed
 *      release group versions both packages together).
 *   4. Skip when a remote-tracking `export/<version>` branch already exists:
 *      a refresh for this version was pushed and awaits review. A LOCAL branch
 *      of that name is refused (an earlier run's commit, never overwritten).
 *   5. The cards: every loaded card the gallery guard admits (`generic.ts`:
 *      origin `generic`, tier `starter` or `delivery`), or with `debut` the
 *      first of them by id — only into a gallery that lists no app yet.
 *   6. The run (`deps.run`; the CLI's is `run-scenarios` on the published
 *      packages of exactly that version, scratch mode), then the export into
 *      the gallery directory (`exporter.ts`).
 *   7. Refused when no app exported, when an exported app states another
 *      framework version, or when anything outside `apps/` and `index.json`
 *      changed in the checkout.
 *   8. `git switch -c export/<version>`, `git add`, `git commit` — under the
 *      checkout's own git identity.
 *
 * ⛔ It never pushes, never opens a PR and never talks to GitHub: the caller
 * pushes the branch and opens the PR with the body this returns
 * ({@link refreshPrBody}).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { LoadedScenario } from '../loader.js';
import type { Recording } from '../runner/driver.js';
import { exportGallery, type ExportOptions, type ExportSummary } from './exporter.js';
import { GALLERY_GUARD, type GalleryGuard } from './generic.js';
import { parseIndex, type GalleryIndex } from './manifest.js';
import type { CaptureScreenshots } from './screenshots.js';

/** The package whose npm `latest` is the framework release the gallery follows. */
export const FRAMEWORK_PACKAGE = '@objectstack/cli';

/** A stable release: `MAJOR.MINOR.PATCH`, no prerelease or build suffix. */
export const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

/** The branch a refresh commits on. */
export const galleryBranch = (version: string): string => `export/${version}`;

/** A refresh that stops before committing; the CLI prints the message and exits non-zero. */
export class RefreshRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefreshRefusal';
  }
}

/** npm's `latest` dist-tag of {@link FRAMEWORK_PACKAGE} (`npm view`, so the caller's npm configuration applies). */
export function npmLatestVersion(pkg: string = FRAMEWORK_PACKAGE): string {
  return execFileSync('npm', ['view', pkg, 'dist-tags.latest'], { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** The gallery's framework version, as its index states it. */
export interface GalleryVersions {
  /** The index, or undefined when the checkout has none yet. */
  index: GalleryIndex | undefined;
  /** The distinct `framework.version` of the listed apps, sorted. */
  versions: string[];
}

export function readGalleryVersions(galleryDir: string): GalleryVersions {
  const file = join(galleryDir, 'index.json');
  if (!existsSync(file)) return { index: undefined, versions: [] };
  let index: GalleryIndex;
  try {
    index = parseIndex(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new RefreshRefusal(`${file} is not a gallery index the exporter wrote: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { index, versions: [...new Set(index.apps.map((a) => a.framework.version))].sort() };
}

/** What the run step is asked to do: run these cards on this release, write records to `runsDir` and every turn to `recording`. */
export interface RunPlan {
  /** The framework release: the run scaffolds with `create-objectstack@<version>`, on the published packages. */
  version: string;
  /** The card ids to run. */
  cards: string[];
  /** The card directory the CLI loaded, when not the default. */
  cardsDir?: string;
  /** Where the run records go (`run-scenarios --out`). */
  runsDir: string;
  /** Where the projects are scaffolded (`run-scenarios --work`). */
  workDir: string;
  /** Where every live turn is saved (`run-scenarios --record`): the transcript's reply text. */
  recording: string;
  /** The model every live turn asks for (`--model`); the login's own when absent. */
  model?: string;
}

/**
 * The `run-scenarios` command line for a plan: the published packages of
 * exactly that release, scratch mode only (the gallery ships the scratch
 * project, and the exporter's pass rule owes scratch mode's six halves, the
 * iterate Run included).
 */
export function runnerArgv(plan: RunPlan): string[] {
  return [
    ...(plan.cardsDir ? ['--cards', plan.cardsDir] : []),
    '--only',
    plan.cards.join(','),
    '--modes',
    'scratch',
    '--packages',
    'published',
    '--create-version',
    plan.version,
    '--out',
    plan.runsDir,
    '--work',
    plan.workDir,
    '--record',
    plan.recording,
    ...(plan.model ? ['--model', plan.model] : []),
  ];
}

export interface RefreshOptions {
  /** The gallery checkout: the top of its git working tree. */
  galleryDir: string;
  /** The loaded cards (`loadScenarios`). */
  cards: readonly LoadedScenario[];
  /** The card directory, when not the default (passed to the run). */
  cardsDir?: string;
  /** Export one card only: the gallery's first app. */
  debut?: boolean;
  /** The model every live turn asks for. */
  model?: string;
  /** Where the run's records, projects and recording go. */
  workDir: string;
}

export interface RefreshDeps {
  /** npm's latest `@objectstack/cli`; default {@link npmLatestVersion}. */
  latestVersion?: () => string | Promise<string>;
  /** Run the cards; resolves once the records and the recording are written. */
  run: (plan: RunPlan) => Promise<void>;
  /** Take screenshots with this; `false` exports without them. */
  screenshots: CaptureScreenshots | false;
  /** Default {@link GALLERY_GUARD}; a test seam, as for the exporter — the CLI offers no flag for another. */
  guard?: GalleryGuard;
}

export type RefreshOutcome =
  | { kind: 'skip'; line: string }
  | { kind: 'committed'; version: string; branch: string; commit: string; cards: string[]; summary: ExportSummary; body: string };

interface GitAnswer {
  status: number;
  stdout: string;
  stderr: string;
}

function git(dir: string, args: readonly string[]): GitAnswer {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (r.error) throw new RefreshRefusal(`git ${args[0]} could not run: ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}

function gitOk(dir: string, args: readonly string[]): string {
  const r = git(dir, args);
  if (r.status !== 0) throw new RefreshRefusal(`git ${args.join(' ')} exited ${r.status} in ${dir}: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout;
}

/** The checkout's changed paths (`git status --porcelain`), untracked files listed one by one. */
function changedPaths(dir: string): string[] {
  return gitOk(dir, ['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => l.slice(3));
}

function checkCheckout(galleryDir: string): void {
  if (!existsSync(galleryDir) || !statSync(galleryDir).isDirectory()) throw new RefreshRefusal(`--gallery ${galleryDir} is not a directory`);
  const top = git(galleryDir, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== realpathSync(galleryDir)) {
    throw new RefreshRefusal(`--gallery ${galleryDir} is not the top of a git checkout: the refresh commits there`);
  }
  const dirty = changedPaths(galleryDir);
  if (dirty.length > 0) {
    throw new RefreshRefusal(`the gallery checkout has uncommitted changes (${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ', …' : ''}): a refresh commits only what it exports`);
  }
}

/** A gallery path the exporter writes: `index.json` or anything under `apps/`. */
const exporterPath = (p: string): boolean => p === 'index.json' || p.startsWith('apps/');

export async function galleryRefresh(opts: RefreshOptions, deps: RefreshDeps): Promise<RefreshOutcome> {
  const dir = opts.galleryDir;
  checkCheckout(dir);
  const before = readGalleryVersions(dir);

  let latest: string;
  try {
    latest = (await (deps.latestVersion ?? npmLatestVersion)()).trim();
  } catch (e) {
    throw new RefreshRefusal(`npm's latest ${FRAMEWORK_PACKAGE} could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!STABLE_VERSION.test(latest)) {
    throw new RefreshRefusal(`npm's latest ${FRAMEWORK_PACKAGE} is \`${latest}\`, not a stable MAJOR.MINOR.PATCH release: nothing is run`);
  }
  const listed = before.index?.apps.length ?? 0;
  if (listed > 0 && before.versions.length === 1 && before.versions[0] === latest) {
    return { kind: 'skip', line: `skip: the gallery's index.json framework.version is ${latest}, npm's latest stable ${FRAMEWORK_PACKAGE}` };
  }
  const branch = galleryBranch(latest);
  if (git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0) {
    throw new RefreshRefusal(`the gallery checkout already has a local branch ${branch}: an earlier refresh's commit, which is never overwritten — push it or delete it`);
  }
  const pending = gitOk(dir, ['for-each-ref', '--format=%(refname:short)', `refs/remotes/*/${branch}`]).trim();
  if (pending !== '') {
    return { kind: 'skip', line: `skip: ${pending.split('\n')[0]} already exists: the refresh for ${latest} awaits review` };
  }

  const guard = deps.guard ?? GALLERY_GUARD;
  const eligible = opts.cards
    .filter((s) => guard(s).eligible)
    .map((s) => s.card.id)
    .sort();
  if (eligible.length === 0) throw new RefreshRefusal('no loaded card may be exported (origin `generic`, tier `starter` or `delivery`): nothing to run');
  if (opts.debut && listed > 0) {
    throw new RefreshRefusal(`--debut exports the gallery's first app, and its index.json already lists ${listed}: run without --debut`);
  }
  const cards = opts.debut ? [eligible[0]!] : eligible;

  const plan: RunPlan = {
    version: latest,
    cards,
    ...(opts.cardsDir ? { cardsDir: opts.cardsDir } : {}),
    runsDir: join(opts.workDir, 'runs'),
    workDir: join(opts.workDir, 'work'),
    recording: join(opts.workDir, 'recording.json'),
    ...(opts.model ? { model: opts.model } : {}),
  };
  await deps.run(plan);
  if (!existsSync(plan.runsDir)) throw new RefreshRefusal(`the run wrote no record (${plan.runsDir} does not exist): nothing is exported`);

  const recordings: Recording[] = existsSync(plan.recording) ? [JSON.parse(readFileSync(plan.recording, 'utf8')) as Recording] : [];
  const exportOptions: ExportOptions = { runsDir: plan.runsDir, outDir: dir, cards: opts.cards, recordings, guard, screenshots: deps.screenshots };
  const summary = await exportGallery(exportOptions);
  if (summary.exported.length === 0) {
    const why = summary.refused.map((r) => `${r.id}: ${r.reasons.join('; ')}`);
    throw new RefreshRefusal(`no app exported for ${latest}, so nothing is committed${why.length ? ` — ${why.join(' · ')}` : ''}. The gallery checkout's working tree holds what the export changed`);
  }
  const after = readGalleryVersions(dir);
  const stale = (after.index?.apps ?? []).filter((a) => a.framework.version !== latest);
  if (stale.length > 0) {
    throw new RefreshRefusal(
      `${stale.map((a) => `${a.id} states framework ${a.framework.version}`).join(', ')}, not ${latest}: the run did not install that release, so nothing is committed`,
    );
  }
  const stray = changedPaths(dir).filter((p) => !exporterPath(p));
  if (stray.length > 0) throw new RefreshRefusal(`the checkout changed outside apps/ and index.json (${stray.join(', ')}): nothing is committed`);

  gitOk(dir, ['switch', '--quiet', '-c', branch]);
  gitOk(dir, ['add', '--all', '--', 'apps', 'index.json']);
  if (git(dir, ['diff', '--cached', '--quiet']).status === 0) throw new RefreshRefusal(`the export changed nothing in the checkout: nothing is committed on ${branch}`);
  const subject = `export: the gallery on ${FRAMEWORK_PACKAGE} ${latest}${opts.debut ? ' (debut)' : ''}`;
  gitOk(dir, ['commit', '--quiet', '-m', subject, '-m', `Generated by gallery-refresh (@objectstack/scenarios): ${summary.exported.map((e) => e.id).join(', ')}.`]);
  const commit = gitOk(dir, ['rev-parse', 'HEAD']).trim();
  const body = refreshPrBody({ version: latest, branch, commit, previous: before, cards, debut: opts.debut === true, ...(opts.model ? { model: opts.model } : {}), summary });
  return { kind: 'committed', version: latest, branch, commit, cards, summary, body };
}

export interface PrBodyInput {
  version: string;
  branch: string;
  commit: string;
  previous: GalleryVersions;
  cards: string[];
  debut: boolean;
  model?: string;
  summary: ExportSummary;
}

/** The PR body the caller opens the gallery PR with: what was run, what was exported, and what was not and why. */
export function refreshPrBody(p: PrBodyInput): string {
  const prev = p.previous.index && p.previous.index.apps.length > 0 ? `${p.previous.versions.join(', ')} (${p.previous.index.apps.length} app(s))` : 'none (the gallery listed no app)';
  const s = p.summary;
  const lines = [
    `Gallery refresh for ObjectStack ${p.version}, npm's latest stable \`${FRAMEWORK_PACKAGE}\`.`,
    '',
    'Generated by `gallery-refresh` (`@objectstack/scenarios`): every file under `apps/` and `index.json` is the exporter\'s output. Do not edit it by hand; fix the card, the platform or the authoring skills, and the next refresh corrects it.',
    '',
    `- Branch: \`${p.branch}\`, one commit \`${p.commit.slice(0, 10)}\``,
    `- Previous framework version in index.json: ${prev}`,
    `- Cards run: ${p.debut ? 'the debut, one card' : 'every generic starter or delivery card'}: ${p.cards.map((c) => `\`${c}\``).join(', ')}`,
    `- Run: scratch mode, published packages \`create-objectstack@${p.version}\`, model ${p.model ? `\`${p.model}\`` : 'the login\'s default'}`,
    '',
    `## Exported (${s.exported.length})`,
    '',
    ...s.exported.map((e) => `- \`${e.id}\`: ${e.screenshots.length} screenshot(s)${e.skippedShots.map((k) => `; no ${k.kind}: ${k.reason}`).join('')}`),
  ];
  const section = (title: string, rows: string[]) => (rows.length ? ['', `## ${title} (${rows.length})`, '', ...rows] : []);
  lines.push(
    ...section('Refused', s.refused.map((r) => `- \`${r.id}\`: ${r.reasons.join('; ')}`)),
    ...section('Removed from the gallery', s.removed.map((r) => `- \`${r.id}\`: ${r.why}`)),
    ...section('Kept as the previous export left them', s.kept.map((k) => `- \`${k.id}\`: ${k.why}`)),
    ...section('Not the exporter\'s, left alone', s.unowned.map((u) => `- \`apps/${u}\``)),
    '',
  );
  return lines.join('\n');
}
