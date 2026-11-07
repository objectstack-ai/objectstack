// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The gallery exporter: verified scenario apps, written to a local directory
 * in the layout of objectstack-ai/gallery. It writes nothing anywhere else —
 * how the output reaches the gallery repository is a separate decision.
 *
 * For each card the runs directory holds a record of, the NEWEST record (by
 * date) decides, in this order, each a refusal with its reason:
 *
 *   1. the card is loaded, marked generic and of a gallery tier ({@link GalleryGuard});
 *   2. ⛔ the run was on published packages ({@link unpublishedRunRefusal}): a
 *      `--packages workspace` run is never exported or shown;
 *   3. the record passed every half ({@link judgeRecord});
 *   4. the run's scratch project is still on disk, with its build;
 *   5. its transcript joins with the recording ({@link buildTranscript});
 *   6. its screenshots were taken, unless the caller turned them off.
 *
 * Output (`--out`), per exported app, written whole into a staging directory
 * and then swapped in, so a re-export first deletes the old directory and
 * nothing stale survives (see {@link APP_LAYOUT}):
 *
 *   apps/<id>/README.md               what the app is, its scorecard, the files
 *   apps/<id>/source/…                the authored metadata source (`source.ts`)
 *   apps/<id>/run-record.json         the run record, the work directories redacted (`workDirsOf`)
 *   apps/<id>/scorecard.json|.md      the per-half scorecard
 *   apps/<id>/transcript.json|.md     the per-persona 问数 transcript
 *   apps/<id>/screenshots/<kind>.png  list, kanban/calendar, record, dashboard
 *   index.json                        the manifest (`manifest.ts`)
 *
 * What the exporter owns is what the previous `index.json` lists. An app it
 * listed that does not export this time — its newest record fails, its card
 * is gone or not exportable, its project is gone — is deleted and leaves the
 * index; the summary names why. A directory under `apps/` the index never
 * listed is not the exporter's and is left alone (and named). Nothing is
 * touched when the previous index does not validate, or when the runs
 * directory holds no scenario record while the index lists apps (a wrong
 * `--runs`, never "every app gone").
 *
 * An export without screenshots (`screenshots: false`) never replaces an app
 * whose previous export had them: the old directory and entry are kept, and
 * the summary says so (`kept`). It still removes an app that no longer passes.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { LoadedScenario } from '../loader.js';
import { scenarioNamespace } from '../schema.js';
import type { Recording } from '../runner/driver.js';
import { modeDir } from '../runner/orchestrate.js';
import { readArtifact } from '../runner/project.js';
import { renderScorecard, type CardScorecard } from '../runner/scorecard.js';
import { GALLERY_GUARD, type GalleryGuard } from './generic.js';
import { parseIndex, serializeIndex, type GalleryApp, type GalleryIndex } from './manifest.js';
import { judgeRecord, type PassJudgement } from './pass.js';
import { readRunRecords, redactWorkDir, unpublishedRunRefusal, type RecordFile } from './record.js';
import type { CaptureScreenshots, PlannedShot, SkippedShot } from './screenshots.js';
import { projectFrameworkVersion, readAuthoredSource } from './source.js';
import { buildTranscript, mergeRecordings, renderTranscript } from './transcript.js';

/** The files of one exported app, relative to `apps/<id>/`. */
export const APP_LAYOUT = {
  readme: 'README.md',
  source: 'source',
  runRecord: 'run-record.json',
  scorecardJson: 'scorecard.json',
  scorecardMd: 'scorecard.md',
  transcriptJson: 'transcript.json',
  transcriptMd: 'transcript.md',
  screenshots: 'screenshots',
} as const;

/**
 * The run's scratch project, where the runner CLI scaffolds it: under the
 * record's work directory, `<card-id>-scratch/<namespace>` (`modeDir` +
 * the name `ProjectOps.scaffold` is given). After the run it holds the app as
 * the change request left it, which is the app the iterate halves graded.
 */
export function scratchProjectDir(workDir: string, card: { id: string; code: string }): string {
  return join(workDir, modeDir(card, 'scratch'), scenarioNamespace(card));
}

export interface ExportOptions {
  /** Where the runner wrote its records. */
  runsDir: string;
  /** The gallery checkout (or any directory) to write into. */
  outDir: string;
  /** The loaded cards (`loadScenarios`). */
  cards: readonly LoadedScenario[];
  /** The run's recordings: the transcript's reply text. */
  recordings: readonly Recording[];
  /** Read the projects here instead of each record's `evidenceDir` (records moved off the machine that ran them). */
  workDir?: string;
  /** Decides which cards may be exported. Default {@link GALLERY_GUARD}: origin `generic`, tier `starter` or `delivery`. */
  guard?: GalleryGuard;
  /** Take screenshots with this; `false` exports without them. */
  screenshots: CaptureScreenshots | false;
}

export interface ExportSummary {
  exported: Array<{ id: string; screenshots: PlannedShot[]; skippedShots: SkippedShot[] }>;
  refused: Array<{ id: string; reasons: string[] }>;
  /** Apps the previous index listed that this export deleted. */
  removed: Array<{ id: string; why: string }>;
  /**
   * Apps that would have exported, kept as the previous export left them
   * instead: an export without screenshots never replaces one that had them.
   */
  kept: Array<{ id: string; why: string }>;
  /** Directories under `apps/` the exporter does not own, left as they were. */
  unowned: string[];
  /** JSON files in the runs directory that are not scenario-runner records. */
  ignoredFiles: string[];
  /** True when the index bytes on disk changed. */
  indexChanged: boolean;
}

class Refused extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join('; '));
  }
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

function appReadme(scenario: LoadedScenario, entry: GalleryApp, judgement: PassJudgement, scorecard: CardScorecard, shots: PlannedShot[], skipped: SkippedShot[]): string {
  const c = scenario.card;
  const lines = [
    `# ${c.title.en}`,
    '',
    c.title.zh,
    '',
    `Generated by the ObjectStack scenario pipeline — do not edit by hand. Fix the card, the platform or the authoring skills instead; the next release rebuild corrects this directory.`,
    '',
    `- Scenario: \`${c.id}\` · business functions ${c.businessFunctions.map((f) => `\`${f}\``).join(', ')} · namespace \`${entry.namespace}\``,
    `- Framework: @objectstack/spec ${entry.framework.version} (runner checkout ${entry.framework.runner}) · run ${entry.run} on ${entry.runDate}`,
    `- 问数: ${entry.qa.questions} questions, ${entry.qa.turns} persona turns · ${entry.operations} write operations`,
    '',
    '## The requirement',
    '',
    ...(c.prompt.short.zh ? [`- ${c.prompt.short.zh}`] : []),
    ...(c.prompt.short.en ? [`- ${c.prompt.short.en}`] : []),
    '',
    '## What passed',
    '',
    ...judgement.halves.map((h) => `- \`${h.id}\`: ${h.verdict}`),
    '',
    renderScorecard(scorecard),
    '',
    '## Files',
    '',
    `- [\`${APP_LAYOUT.source}/\`](./${APP_LAYOUT.source}/) — the app's metadata source, as the AI wrote it (after the change request)`,
    `- [\`${APP_LAYOUT.transcriptMd}\`](./${APP_LAYOUT.transcriptMd}) — every data question, each persona's answer and its grade ([JSON](./${APP_LAYOUT.transcriptJson}))`,
    `- [\`${APP_LAYOUT.scorecardMd}\`](./${APP_LAYOUT.scorecardMd}) — the scorecard ([JSON](./${APP_LAYOUT.scorecardJson}))`,
    `- [\`${APP_LAYOUT.runRecord}\`](./${APP_LAYOUT.runRecord}) — the full run record`,
    ...shots.map((s) => `- [\`${s.file}\`](./${s.file}) — ${s.kind}${s.view ? ` (${s.view})` : s.object ? ` (${s.object})` : ''}`),
    ...skipped.map((s) => `- no ${s.kind} screenshot: ${s.reason}`),
    '',
  ];
  return lines.join('\n');
}

/** Write `files` (relative path → bytes) under `dir`. */
function writeTree(dir: string, files: Iterable<[string, string | Buffer]>): void {
  for (const [rel, data] of files) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  }
}

/**
 * Every absolute directory that names this run's work directory: the record's
 * own `evidenceDir` (the machine that ran it — every build tail and error text
 * names it), `--work` when the projects are read elsewhere, and the real path
 * of each that exists here (a symbolic-linked temp directory). Each is redacted
 * from everything the gallery receives.
 */
export function workDirsOf(recordEvidenceDir: string, workDir: string | undefined): string[] {
  const dirs = [recordEvidenceDir, ...(workDir !== undefined ? [workDir] : [])];
  for (const d of [...dirs]) {
    try {
      dirs.push(realpathSync(d));
    } catch {
      // not on this machine: the record's directory, moved off it
    }
  }
  return [...new Set(dirs)];
}

export async function exportGallery(opts: ExportOptions): Promise<ExportSummary> {
  const guard = opts.guard ?? GALLERY_GUARD;
  const appsDir = join(opts.outDir, 'apps');
  const indexFile = join(opts.outDir, 'index.json');

  // Read everything that can refuse the whole export before touching the output.
  const before = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : undefined;
  let previous: GalleryIndex | undefined;
  if (before !== undefined) {
    try {
      previous = parseIndex(before);
    } catch (e) {
      throw new Error(`${indexFile} is not a gallery index this exporter wrote, so nothing is touched: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const { newest, ignored } = readRunRecords(opts.runsDir);
  // An empty or wrong `--runs` would otherwise read as "every app lost its record" and delete the gallery.
  if (newest.size === 0 && (previous?.apps.length ?? 0) > 0) {
    throw new Error(
      `${opts.runsDir} holds no scenario run record, and ${indexFile} lists ${previous!.apps.length} app(s), so nothing is touched: a runs directory with no record is read as a wrong --runs, never as every app gone`,
    );
  }
  const previousById = new Map((previous?.apps ?? []).map((a) => [a.id, a]));
  const turns = mergeRecordings(opts.recordings);
  const cards = new Map(opts.cards.map((s) => [s.card.id, s]));

  const summary: ExportSummary = { exported: [], refused: [], removed: [], kept: [], unowned: [], ignoredFiles: ignored, indexChanged: false };
  const entries: GalleryApp[] = [];
  mkdirSync(appsDir, { recursive: true });

  for (const id of [...newest.keys()].sort()) {
    const rf = newest.get(id)!;
    const staging = join(appsDir, `.staging-${id}`);
    rmSync(staging, { recursive: true, force: true });
    try {
      const done = await exportOne(id, rf, cards.get(id), staging, guard, turns, opts);
      const old = previousById.get(id);
      if (opts.screenshots === false && old && old.screenshots.length > 0 && existsSync(join(appsDir, id))) {
        // It still passes, but this export has no screenshots: the old directory and entry stand, shots and all.
        rmSync(staging, { recursive: true, force: true });
        entries.push(old);
        summary.kept.push({ id, why: `exported without screenshots, and the previous export has ${old.screenshots.length}: it is kept as it was, and not replaced by an entry with none` });
        continue;
      }
      rmSync(join(appsDir, id), { recursive: true, force: true });
      renameSync(staging, join(appsDir, id));
      entries.push(done.entry);
      summary.exported.push({ id, screenshots: done.shots, skippedShots: done.skipped });
    } catch (e) {
      rmSync(staging, { recursive: true, force: true });
      summary.refused.push({ id, reasons: e instanceof Refused ? e.reasons : [e instanceof Error ? e.message : String(e)] });
    }
  }

  const exported = new Set(entries.map((e) => e.id)); // written or kept
  const refusedWhy = new Map(summary.refused.map((r) => [r.id, r.reasons.join('; ')]));
  for (const old of previous?.apps ?? []) {
    if (exported.has(old.id)) continue;
    rmSync(join(appsDir, old.id), { recursive: true, force: true });
    summary.removed.push({ id: old.id, why: refusedWhy.get(old.id) ?? 'the runs directory holds no record of it' });
  }
  const owned = new Set([...(previous?.apps ?? []).map((a) => a.id), ...exported]);
  summary.unowned = readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !owned.has(e.name))
    .map((e) => e.name)
    .sort();

  const after = serializeIndex(entries);
  if (after !== before) writeFileSync(indexFile, after);
  summary.indexChanged = after !== before;
  return summary;
}

async function exportOne(
  id: string,
  rf: RecordFile,
  scenario: LoadedScenario | undefined,
  staging: string,
  guard: GalleryGuard,
  turns: ReturnType<typeof mergeRecordings>,
  opts: ExportOptions,
): Promise<{ entry: GalleryApp; shots: PlannedShot[]; skipped: SkippedShot[] }> {
  if (!scenario) throw new Refused([`no loaded card \`${id}\` (removed, renamed, or refused by the loader)`]);
  const verdict = guard(scenario);
  if (!verdict.eligible) throw new Refused(verdict.reasons);
  const { record } = rf;
  const unpublished = unpublishedRunRefusal(record);
  if (unpublished) throw new Refused([`${rf.file}: ${unpublished}`]);
  const judgement = judgeRecord(record);
  if (!judgement.passed) throw new Refused([`${rf.file} did not pass every half`, ...judgement.reasons]);

  const card = scenario.card;
  const workDir = opts.workDir ?? record.evidenceDir;
  const projectDir = scratchProjectDir(workDir, card);
  if (!existsSync(projectDir)) throw new Refused([`the run's scratch project is gone: ${projectDir}`]);
  const artifact = readArtifact(projectDir);
  if (artifact === undefined) throw new Refused([`${projectDir} holds no dist/objectstack.json`]);
  const source = readAuthoredSource(projectDir);
  const frameworkVersion = projectFrameworkVersion(projectDir);
  const redact = <T,>(v: T): T => redactWorkDir(v, workDirsOf(record.evidenceDir, opts.workDir));
  const transcript = redact(buildTranscript(scenario, record, turns));

  let shots: PlannedShot[] = [];
  let skipped: SkippedShot[] = [];
  if (opts.screenshots) {
    const taken = await opts.screenshots({ scenario, projectDir, artifact, dir: staging });
    shots = taken.shots;
    skipped = taken.skipped;
  }

  const scorecard = redact(record.scorecard as unknown as CardScorecard);
  const entry: GalleryApp = {
    id,
    code: card.code,
    namespace: scenarioNamespace(card),
    path: `apps/${id}`,
    function: card.businessFunctions[0]!,
    title: { en: card.title.en, zh: card.title.zh },
    summary: { ...(card.prompt.short.en ? { en: card.prompt.short.en } : {}), ...(card.prompt.short.zh ? { zh: card.prompt.short.zh } : {}) },
    capabilities: [...card.capabilities].sort(),
    screenshots: shots.map((s) => ({ kind: s.kind, path: `apps/${id}/${s.file}`, ...(s.object ? { object: s.object } : {}), ...(s.view ? { view: s.view } : {}) })),
    qa: { questions: record.cardRun.counts.questions, turns: record.cardRun.counts.questionTurns, personas: record.cardRun.counts.personas },
    operations: record.cardRun.counts.operations,
    framework: { version: frameworkVersion, runner: record.env.framework },
    runDate: record.date,
    run: record.run,
  };

  writeTree(join(staging, APP_LAYOUT.source), source.files);
  writeTree(staging, [
    [APP_LAYOUT.runRecord, json(redact(rf.raw))],
    [APP_LAYOUT.scorecardJson, json(scorecard)],
    [APP_LAYOUT.scorecardMd, `${renderScorecard(scorecard)}\n`],
    [APP_LAYOUT.transcriptJson, json(transcript)],
    [APP_LAYOUT.transcriptMd, renderTranscript(transcript, card.title.en)],
    [APP_LAYOUT.readme, redact(appReadme(scenario, entry, judgement, scorecard, shots, skipped))],
  ]);
  return { entry, shots, skipped };
}
