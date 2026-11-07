// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `pnpm --filter @objectstack/scenarios export-gallery --runs DIR --out DIR [flags]`
 * — write every verified scenario app the runner's records prove into a
 * local directory, in the layout of objectstack-ai/gallery (`exporter.ts`).
 *
 *   --runs DIR           the run records (`run-scenarios --out`; default docs/qa/platform-checklist/runs)
 *   --out DIR            where `apps/` and `index.json` go (required)
 *   --recording F        a run's recording (`run-scenarios --record F`, or the
 *                        file a `--driver recorded:F` run replayed); repeatable
 *   --cards DIR          the card directory (default: the repo's docs/qa/scenarios);
 *                        any other directory is loaded as the private overlay,
 *                        where a `generic` card is refused (`libraryOf`)
 *   --work DIR           read the projects here, not at each record's `evidenceDir`
 *                        (both directories are redacted to `$WORK` in the output)
 *   --no-screenshots     export without screenshots (no app is booted); an app
 *                        whose previous export had screenshots is kept as it was
 *
 * A runs directory with no scenario record, over an index that lists apps,
 * exits non-zero and touches nothing (a wrong `--runs`, never "every app gone").
 *   --chromium PATH      the Chromium executable for the screenshots
 *
 * It writes only under `--out`; it pushes nothing anywhere. ⛔ It exports only
 * a card whose `origin` is `generic` and whose `tier` is `starter` or
 * `delivery` (`generic.ts`), and only a run on published packages — never a
 * `run-scenarios --packages workspace` record (`record.ts`) — and offers no
 * flag to do otherwise.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatRefusal, libraryOf, loadScenarios, readCapabilityAreas } from '../loader.js';
import { HttpApp } from '../runner/app.js';
import { ADMIN, findUp } from '../runner/cli.js';
import type { Recording } from '../runner/driver.js';
import { bootDev } from '../runner/project.js';
import { exportGallery, type ExportSummary } from './exporter.js';
import { captureScreenshots, playwrightBrowser, type CaptureScreenshots } from './screenshots.js';

export interface ExportCliArgs {
  runs?: string;
  out?: string;
  recordings: string[];
  cards?: string;
  work?: string;
  screenshots: boolean;
  chromium?: string;
}

export function parseExportArgs(argv: readonly string[]): ExportCliArgs {
  const a: ExportCliArgs = { recordings: [], screenshots: true };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--runs') a.runs = val();
    else if (flag === '--out') a.out = val();
    else if (flag === '--recording') a.recordings.push(val());
    else if (flag === '--cards') a.cards = val();
    else if (flag === '--work') a.work = val();
    else if (flag === '--no-screenshots') a.screenshots = false;
    else if (flag === '--chromium') a.chromium = val();
    else throw new Error(`unknown flag \`${flag}\``);
  }
  if (!a.out) throw new Error('--out DIR is required: the directory `apps/` and `index.json` are written into');
  return a;
}

/** The summary, one line per app, as the CLI prints it. */
export function renderSummary(s: ExportSummary): string[] {
  const lines: string[] = [];
  for (const e of s.exported) lines.push(`exported ${e.id} · ${e.screenshots.length} screenshot(s)${e.skippedShots.map((k) => ` · no ${k.kind}: ${k.reason}`).join('')}`);
  for (const r of s.refused) lines.push(`refused  ${r.id} · ${r.reasons.join(' · ')}`);
  for (const r of s.removed) lines.push(`removed  ${r.id} · ${r.why}`);
  for (const k of s.kept) lines.push(`kept     ${k.id} · ${k.why}`);
  for (const u of s.unowned) lines.push(`left     apps/${u} · not in the previous index, so not the exporter's`);
  for (const f of s.ignoredFiles) lines.push(`ignored  ${f} · not a scenario-runner record`);
  lines.push(`index.json ${s.indexChanged ? 'written' : 'unchanged'} · ${s.exported.length} exported, ${s.refused.length} refused, ${s.removed.length} removed, ${s.kept.length} kept`);
  return lines;
}

/** Test seam: replace the screenshot step (the CLI's is the real browser). */
export interface ExportCliDeps {
  screenshots?: CaptureScreenshots;
}

export async function main(argv: readonly string[], deps: ExportCliDeps = {}): Promise<number> {
  const args = parseExportArgs(argv);
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = findUp(here, (d) => existsSync(join(d, 'pnpm-workspace.yaml')));
  const cardsDir = resolve(args.cards ?? join(repo, 'docs/qa/scenarios'));
  const runsDir = resolve(args.runs ?? join(repo, 'docs/qa/platform-checklist/runs'));
  const { cards, refusals } = loadScenarios(cardsDir, {
    areas: readCapabilityAreas(join(repo, 'docs/qa/platform-checklist/areas')),
    library: libraryOf(cardsDir, repo),
  });
  for (const r of refusals) console.error(formatRefusal(r));
  const recordings = args.recordings.map((f) => JSON.parse(readFileSync(resolve(f), 'utf8')) as Recording);
  const browser = playwrightBrowser(args.chromium ? { executablePath: args.chromium } : {});
  const screenshots: CaptureScreenshots | false = !args.screenshots
    ? false
    : (deps.screenshots ??
      ((input) => captureScreenshots(input, { boot: (dir) => bootDev(dir), harness: (url) => new HttpApp({ baseUrl: url, adminEmail: ADMIN.email, adminPassword: ADMIN.password }), browser, admin: ADMIN })));
  const summary = await exportGallery({
    runsDir,
    outDir: resolve(args.out!),
    cards,
    recordings,
    ...(args.work ? { workDir: resolve(args.work) } : {}),
    screenshots,
  });
  for (const line of renderSummary(summary)) (/^(refused|removed|kept) /.test(line) ? console.error : console.log)(line);
  return 0;
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
