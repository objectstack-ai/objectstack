// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `pnpm --filter @objectstack/scenarios gallery-refresh --gallery DIR [flags]`
 * — the gallery refresh in one step (`refresh.ts`): npm's latest stable
 * `@objectstack/cli` against the gallery's `index.json`; when they differ, run
 * the cards on that release, export into the gallery checkout and commit on
 * `export/<version>`. Ruling D2: a daily scheduled Claude Code task on the
 * maintainer's subscription login runs it (the package README holds the
 * task's runbook).
 *
 *   --gallery DIR        the gallery checkout, the top of its git working tree (required)
 *   --cards DIR          the card directory (default: the repo's docs/qa/scenarios);
 *                        any other directory is loaded as the private overlay,
 *                        where a `generic` card is refused (`libraryOf`)
 *   --model M            the model every live turn asks for (`run-scenarios --model`;
 *                        default: the login's own)
 *   --debut              run and export one card only, the first exportable card
 *                        by id: the gallery's first app (refused once the index lists one)
 *   --work DIR           where the run's records, projects and recording go
 *                        (default: a new temp directory)
 *   --chromium PATH      the Chromium executable for the screenshots
 *
 * Output: `skip: …` (one line, exit 0) when the gallery is already on the
 * release; otherwise the branch, the commit and the PR body, exit 0. A refusal
 * prints why and exits 1. ⛔ It never pushes and never opens the PR.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatRefusal, libraryOf, loadScenarios, readCapabilityAreas } from '../loader.js';
import { findUp, main as runScenarios } from '../runner/cli.js';
import { liveScreenshots, renderSummary } from './cli.js';
import { galleryRefresh, RefreshRefusal, runnerArgv, type RefreshDeps, type RefreshOutcome } from './refresh.js';

export interface RefreshCliArgs {
  gallery: string;
  cards?: string;
  model?: string;
  debut: boolean;
  work?: string;
  chromium?: string;
}

export function parseRefreshArgs(argv: readonly string[]): RefreshCliArgs {
  const a: Partial<RefreshCliArgs> & { debut: boolean } = { debut: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--gallery') a.gallery = val();
    else if (flag === '--cards') a.cards = val();
    else if (flag === '--model') {
      const raw = val();
      if (raw.trim() === '' || raw.startsWith('-')) throw new Error(`--model takes a model alias or name (sonnet, opus, claude-sonnet-4-5), not \`${raw}\``);
      a.model = raw;
    } else if (flag === '--debut') a.debut = true;
    else if (flag === '--work') a.work = val();
    else if (flag === '--chromium') a.chromium = val();
    else throw new Error(`unknown flag \`${flag}\``);
  }
  if (!a.gallery) throw new Error('--gallery DIR is required: the gallery checkout the refresh exports into and commits in');
  return a as RefreshCliArgs;
}

/** What the CLI prints for an outcome, one entry per line. */
export function renderOutcome(o: RefreshOutcome): string[] {
  if (o.kind === 'skip') return [o.line];
  return [
    ...renderSummary(o.summary),
    `branch: ${o.branch}`,
    `commit: ${o.commit}`,
    'Not pushed. Push the branch and open the PR with this body:',
    '',
    o.body,
  ];
}

/** Test seam: replace the steps that reach outside (npm, the model, the browser). */
export type RefreshCliDeps = Partial<RefreshDeps>;

export async function main(argv: readonly string[], deps: RefreshCliDeps = {}, io = { out: (l: string) => console.log(l), err: (l: string) => console.error(l) }): Promise<number> {
  const args = parseRefreshArgs(argv);
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = findUp(here, (d) => existsSync(join(d, 'pnpm-workspace.yaml')));
  const cardsDir = resolve(args.cards ?? join(repo, 'docs/qa/scenarios'));
  const { cards, refusals } = loadScenarios(cardsDir, {
    areas: readCapabilityAreas(join(repo, 'docs/qa/platform-checklist/areas')),
    library: libraryOf(cardsDir, repo),
  });
  for (const r of refusals) io.err(formatRefusal(r));
  const work = resolve(args.work ?? mkdtempSync(join(tmpdir(), 'gallery-refresh-')));
  mkdirSync(work, { recursive: true });
  const run: RefreshDeps['run'] =
    deps.run ??
    (async (plan) => {
      const code = await runScenarios(runnerArgv(plan));
      if (code !== 0) throw new RefreshRefusal(`run-scenarios exited ${code}: nothing is exported`);
    });
  try {
    const outcome = await galleryRefresh(
      { galleryDir: resolve(args.gallery), cards, ...(args.cards ? { cardsDir } : {}), debut: args.debut, ...(args.model ? { model: args.model } : {}), workDir: work },
      { ...deps, run, screenshots: deps.screenshots ?? liveScreenshots(args.chromium) },
    );
    // A skip ran nothing: the temp directory it was given is removed again.
    if (outcome.kind === 'skip' && args.work === undefined) rmSync(work, { recursive: true, force: true });
    for (const line of renderOutcome(outcome)) io.out(line);
    return 0;
  } catch (e) {
    if (!(e instanceof RefreshRefusal)) throw e;
    io.err(`gallery-refresh: refused — ${e.message}`);
    io.err(`work directory: ${work}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
