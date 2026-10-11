// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * render-projection-diff.ts — render, on a pull request, what the change does to
 * the two generated ADR-0087 D4 projections: `spec-changes.json` and the
 * protocol upgrade guide.
 *
 *   tsx scripts/render-projection-diff.ts --base <ref> --out-dir <dir> [--summary <file>]
 *
 * ## Why it exists
 *
 * The #22449 B′ ruling moved both projections out of the review loop: they are
 * generated at publish (`scripts/release-spec-changes.sh`) and the pull-request
 * check generates them in memory without comparing a committed copy. Its
 * condition (1) keeps what the committed copy used to give a reviewer — the
 * GENERATED DIFF — and says a B without it is not taken. This renders that diff
 * into the check run's job summary and a `::notice` annotation (neither needs a
 * token that can write), and writes it to `<out-dir>/spec-projections.diff` for
 * the workflow to upload as an artifact.
 *
 * ## How both sides are generated
 *
 * By the SAME generator entry points the publish lane runs, each in its own
 * tree, each with `--out` (`lib/projection-cli.ts`):
 *
 *   head  the working tree's generators, writing to `<out-dir>/head/`;
 *   base  `<ref>`'s own generators, run in a `git archive` of `<ref>` that
 *         borrows this checkout's `node_modules` — so the base side is what the
 *         base's code generated, never this change's generator applied to it.
 *         A base whose migration registry is git-ignored gets it written first,
 *         by its own generator (`generateBaseRegistry`).
 *
 * ⚠️ A base whose generators predate `--out` writes its committed path instead
 * (inside the throwaway archive, never this checkout). That is read in its
 * place, and the summary says so. It applies only to bases older than the
 * change that added `--out`.
 *
 * ## What it refuses
 *
 * A side that cannot be generated is RED (exit 1), with the projection and the
 * generator's own output named — a renderer that silently has nothing to show
 * would read as "this change does not move the projections". A diff, however
 * large, is never red: it is the thing being shown.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = join(PKG_DIR, 'node_modules', '.bin', 'tsx');

/** Per projection, the most diff characters the job summary shows; the artifact carries all of it. */
export const SUMMARY_DIFF_CAP = 120_000;

/** The most generator output a failure shows in the summary (its tail, where the cause is). */
const FAILURE_OUTPUT_CAP = 4_000;

/** The artifact the workflow uploads `<out-dir>/spec-projections.diff` as. */
export const ARTIFACT_NAME = 'spec-projections-diff';

export interface Projection {
  /** The file name, also the name in every message. */
  name: string;
  /** The generator under `packages/spec/scripts/`. */
  script: string;
  /** Where a generator that predates `--out` writes, relative to the tree root. */
  legacyPath: string;
}

export const PROJECTIONS: readonly Projection[] = [
  { name: 'spec-changes.json', script: 'build-spec-changes.ts', legacyPath: 'packages/spec/spec-changes.json' },
  {
    name: 'protocol-upgrade-guide.md',
    script: 'build-upgrade-guide.ts',
    legacyPath: 'docs/protocol-upgrade-guide.md',
  },
];

/** The outcome of running one generator. */
export interface GeneratorRun {
  status: number;
  output: string;
}

/** Runs `<specDir>/scripts/<script> --out <out>` — injected by the tests. */
export type Generate = (specDir: string, script: string, out: string) => GeneratorRun;

/** Runs `<specDir>/scripts/<script>` with no arguments — injected by the tests. */
export type RunScript = (specDir: string, script: string) => GeneratorRun;

function runTsx(specDir: string, args: string[]): GeneratorRun {
  const r = spawnSync(TSX, args, {
    cwd: specDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

function realGenerate(specDir: string, script: string, out: string): GeneratorRun {
  return runTsx(specDir, [join(specDir, 'scripts', script), '--out', out]);
}

function realRunScript(specDir: string, script: string): GeneratorRun {
  return runTsx(specDir, [join(specDir, 'scripts', script)]);
}

/** The base's git-ignored migration registry and the generator that writes it, relative to its `packages/spec`. */
export const BASE_REGISTRY = { file: 'src/migrations/registry.ts', generator: 'build-migration-registry.ts' } as const;

/**
 * Write a base tree's migration registry with the BASE's own generator, when the
 * archive carries the generator but not the registry. Returns whether it ran.
 *
 * Both projection generators import `../src/migrations/registry`. Since #22554
 * ruling B that file is git-ignored and generated at install and build, so a
 * `git archive` of a base at or after that change has only its template and
 * entries — the base generators would die on a missing module. The generator
 * resolves its package root from its own path, so run from the base tree it
 * writes the base's registry from the base's entries, never this checkout's.
 * A base that committed the registry keeps it untouched. A generator that fails,
 * or exits 0 without writing the file, is thrown: the caller reports the base red.
 */
export function generateBaseRegistry(specDir: string, run: RunScript = realRunScript): boolean {
  const registry = join(specDir, BASE_REGISTRY.file);
  if (existsSync(registry)) return false;
  if (!existsSync(join(specDir, 'scripts', BASE_REGISTRY.generator))) return false;
  const r = run(specDir, BASE_REGISTRY.generator);
  if (r.status !== 0) {
    throw new Error(`${BASE_REGISTRY.generator} exited ${r.status}, so the base has no ${BASE_REGISTRY.file}:\n${r.output.trim()}`);
  }
  if (!existsSync(registry)) {
    throw new Error(`${BASE_REGISTRY.generator} exited 0 but wrote no ${BASE_REGISTRY.file}:\n${r.output.trim()}`);
  }
  return true;
}

function git(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: `${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

/**
 * Lay `<sha>`'s generator inputs out under `<dest>`, mirroring the repo layout,
 * with this checkout's dependencies borrowed. Returns the base tree's
 * `packages/spec`. Injected by the tests.
 */
export type MaterializeBase = (repoRoot: string, sha: string, dest: string) => string;

function realMaterializeBase(repoRoot: string, sha: string, dest: string): string {
  // Only the generators' inputs, and deliberately NOT the committed copies: a
  // pre-`--out` base then writes its committed path into an empty slot, so what
  // `generateSide` reads there can only be what that generator just produced.
  const tar = join(dest, 'base.tar');
  const archived = git(
    [
      'archive', '--format=tar', '-o', tar, sha,
      'packages/spec/src', 'packages/spec/scripts', 'packages/spec/package.json', 'packages/spec/tsconfig.json',
      'tsconfig.json',
    ],
    repoRoot,
  );
  if (archived.status !== 0) throw new Error(`git archive ${sha} failed: ${archived.stderr.trim()}`);
  const tree = join(dest, 'tree');
  mkdirSync(tree, { recursive: true });
  const unpacked = spawnSync('tar', ['-xf', tar, '-C', tree], { encoding: 'utf8' });
  if (unpacked.status !== 0) throw new Error(`tar -xf ${tar} failed: ${unpacked.stderr}`);
  // A generator that predates `--out` writes `docs/…` relative to the tree root.
  mkdirSync(join(tree, 'docs'), { recursive: true });
  symlinkSync(join(repoRoot, 'node_modules'), join(tree, 'node_modules'));
  symlinkSync(join(repoRoot, 'packages', 'spec', 'node_modules'), join(tree, 'packages', 'spec', 'node_modules'));
  const specDir = join(tree, 'packages', 'spec');
  generateBaseRegistry(specDir);
  return specDir;
}

/** One side's generated file for one projection, or why there is none. */
export interface SideResult {
  file: string | null;
  /** True when a generator that predates `--out` wrote its committed path. */
  legacy: boolean;
  failure: string | null;
}

/** Run one generator into `<sideDir>/<name>`, reading a pre-`--out` base's committed path in its place. */
export function generateSide(
  generate: Generate,
  specDir: string,
  projection: Projection,
  sideDir: string,
  allowLegacy: boolean,
): SideResult {
  const out = join(sideDir, projection.name);
  mkdirSync(sideDir, { recursive: true });
  const run = generate(specDir, projection.script, out);
  if (run.status !== 0) {
    return { file: null, legacy: false, failure: `${projection.script} exited ${run.status}:\n${run.output.trim()}` };
  }
  if (existsSync(out)) return { file: out, legacy: false, failure: null };
  const legacy = resolve(specDir, '..', '..', projection.legacyPath);
  if (allowLegacy && existsSync(legacy)) {
    writeFileSync(out, readFileSync(legacy));
    return { file: out, legacy: true, failure: null };
  }
  return {
    file: null,
    legacy: false,
    failure: `${projection.script} exited 0 but wrote neither ${out}${allowLegacy ? ` nor ${legacy}` : ''}:\n${run.output.trim()}`,
  };
}

/** `git diff --no-index` of two files, labelled `base/<name>` → `head/<name>`; '' when identical. */
export function diffFiles(outDir: string, name: string): string {
  const r = git(['diff', '--no-index', '--no-color', '--text', '-U3', join('base', name), join('head', name)], outDir);
  if (r.status === 0) return '';
  if (r.status === 1) return r.stdout;
  throw new Error(`git diff --no-index base/${name} head/${name} failed (exit ${r.status}): ${r.stderr.trim()}`);
}

interface IdDelta {
  record: string;
  addedConverted: string[];
  removedConverted: string[];
  addedMigrated: string[];
  removedMigrated: string[];
}

interface ManifestShape {
  aggregate?: { from: number; to: number; converted?: { conversionId: string }[]; migrated?: { migrationId: string }[] };
  perMajor?: { from: number; to: number; converted?: { conversionId: string }[]; migrated?: { migrationId: string }[] }[];
}

/**
 * Registry ids each record of `spec-changes.json` gained or lost — the reviewer's
 * headline, read off the two GENERATED manifests (never off the source).
 * Records are keyed `from → to`; a record present on one side only counts all its ids.
 */
export function idDeltas(baseText: string, headText: string): IdDelta[] {
  const base = JSON.parse(baseText) as ManifestShape;
  const head = JSON.parse(headText) as ManifestShape;
  type Rec = NonNullable<ManifestShape['perMajor']>[number];
  const records = (doc: ManifestShape): Map<string, Rec> => {
    const map = new Map<string, Rec>();
    for (const rec of doc.perMajor ?? []) map.set(`perMajor ${rec.from} → ${rec.to}`, rec);
    if (doc.aggregate) map.set(`aggregate ${doc.aggregate.from} → ${doc.aggregate.to}`, doc.aggregate);
    return map;
  };
  const baseRecords = records(base);
  const headRecords = records(head);
  const keys = [...new Set([...baseRecords.keys(), ...headRecords.keys()])];
  const minus = (a: string[], b: string[]) => a.filter((x) => !b.includes(x)).sort();
  const deltas: IdDelta[] = [];
  for (const key of keys) {
    const b = baseRecords.get(key);
    const h = headRecords.get(key);
    const conv = (r: Rec | undefined) => (r?.converted ?? []).map((c) => c.conversionId);
    const mig = (r: Rec | undefined) => (r?.migrated ?? []).map((m) => m.migrationId);
    const delta: IdDelta = {
      record: key,
      addedConverted: minus(conv(h), conv(b)),
      removedConverted: minus(conv(b), conv(h)),
      addedMigrated: minus(mig(h), mig(b)),
      removedMigrated: minus(mig(b), mig(h)),
    };
    const moved =
      delta.addedConverted.length + delta.removedConverted.length + delta.addedMigrated.length +
      delta.removedMigrated.length;
    if (moved > 0) deltas.push(delta);
  }
  return deltas;
}

const ID_LIST_CAP = 12;

function ids(sign: string, kind: string, list: string[]): string | null {
  if (list.length === 0) return null;
  const shown = list.slice(0, ID_LIST_CAP).map((id) => `\`${id}\``).join(', ');
  const more = list.length > ID_LIST_CAP ? `, … ${list.length - ID_LIST_CAP} more` : '';
  return `${sign}${list.length} ${kind} (${shown}${more})`;
}

/** One line per record whose registry ids moved. */
export function describeDeltas(deltas: IdDelta[]): string[] {
  return deltas.map((d) => {
    const parts = [
      ids('+', 'converted', d.addedConverted),
      ids('−', 'converted', d.removedConverted),
      ids('+', 'migrated', d.addedMigrated),
      ids('−', 'migrated', d.removedMigrated),
    ].filter((p): p is string => p !== null);
    return `${d.record}: ${parts.join('; ')}`;
  });
}

/** A fence one backtick longer than the longest backtick run in `text` (the guide carries fences of its own). */
export function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

function lineCounts(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { added, removed };
}

export interface RenderedProjection {
  name: string;
  diff: string;
  /** Headline lines (`spec-changes.json` only). */
  headline: string[];
  legacyBase: boolean;
}

/** The job-summary markdown for a run in which both sides generated. */
export function renderSummary(baseLabel: string, projections: RenderedProjection[]): string {
  const out: string[] = [];
  out.push(`## Generated ADR-0087 projections — diff against \`${baseLabel}\``);
  out.push('');
  out.push(
    'Both sides are generated from the registries by the generators the publish lane runs; no committed copy ' +
      'is read. This is the review diff a committed copy used to carry.',
  );
  out.push('');
  out.push('| Projection | Change |');
  out.push('|---|---|');
  for (const p of projections) {
    if (p.diff === '') {
      out.push(`| \`${p.name}\` | no change |`);
      continue;
    }
    const { added, removed } = lineCounts(p.diff);
    const head = p.headline.length > 0 ? ` · ${p.headline.join(' · ')}` : '';
    out.push(`| \`${p.name}\` | +${added} −${removed} line(s)${head} |`);
  }
  if (projections.some((p) => p.legacyBase)) {
    out.push('');
    out.push(
      '> The base’s generators predate `--out`, so the base side was read from the path they write ' +
        '(inside a throwaway archive of the base).',
    );
  }
  for (const p of projections) {
    if (p.diff === '') continue;
    const shown = p.diff.length > SUMMARY_DIFF_CAP ? p.diff.slice(0, SUMMARY_DIFF_CAP) : p.diff;
    const fence = fenceFor(shown);
    out.push('');
    out.push(`<details><summary><code>${p.name}</code></summary>`);
    out.push('');
    out.push(`${fence}diff`);
    out.push(shown.replace(/\n$/, ''));
    out.push(fence);
    if (shown.length < p.diff.length) {
      out.push('');
      out.push(
        `Truncated at ${SUMMARY_DIFF_CAP} of ${p.diff.length} characters — the whole diff is the ` +
          `\`${ARTIFACT_NAME}\` artifact of this run.`,
      );
    }
    out.push('');
    out.push('</details>');
  }
  out.push('');
  return out.join('\n');
}

export interface RenderOptions {
  repoRoot: string;
  /** The ref to diff against, already resolved to a commit. */
  baseSha: string;
  /** How the base is named in the summary. */
  baseLabel: string;
  outDir: string;
  headSpecDir: string;
  generate?: Generate;
  materializeBase?: MaterializeBase;
}

export interface RenderResult {
  code: 0 | 1;
  /** Markdown for the job summary. */
  summary: string;
  /** One line for the `::notice` annotation, or the failure. */
  headline: string;
  changed: boolean;
}

export function renderProjectionDiff(opts: RenderOptions): RenderResult {
  const generate = opts.generate ?? realGenerate;
  const materialize = opts.materializeBase ?? realMaterializeBase;
  const scratch = mkdtempSync(join(os.tmpdir(), 'render-projection-diff-'));
  try {
    const failures: string[] = [];
    let baseSpecDir: string | null = null;
    try {
      baseSpecDir = materialize(opts.repoRoot, opts.baseSha, scratch);
    } catch (err) {
      failures.push(`base ${opts.baseLabel}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const rendered: RenderedProjection[] = [];
    for (const projection of PROJECTIONS) {
      const head = generateSide(generate, opts.headSpecDir, projection, join(opts.outDir, 'head'), false);
      if (head.failure) failures.push(`head ${projection.name}: ${head.failure}`);
      if (!baseSpecDir) continue;
      const base = generateSide(generate, baseSpecDir, projection, join(opts.outDir, 'base'), true);
      if (base.failure) failures.push(`base ${opts.baseLabel} ${projection.name}: ${base.failure}`);
      if (head.failure || base.failure) continue;
      const diff = diffFiles(opts.outDir, projection.name);
      const headline =
        projection.name === 'spec-changes.json' && diff !== ''
          ? describeDeltas(
              idDeltas(readFileSync(join(opts.outDir, 'base', projection.name), 'utf8'),
                readFileSync(join(opts.outDir, 'head', projection.name), 'utf8')),
            )
          : [];
      rendered.push({ name: projection.name, diff, headline, legacyBase: base.legacy });
    }

    if (failures.length > 0) {
      const summary = [
        `## Generated ADR-0087 projections — NOT rendered`,
        '',
        'A side could not be generated, so there is no diff to show. A projection that does not generate is a ' +
          'red check: the publish lane would fail on the same registries.',
        '',
        ...failures.flatMap((f) => {
          const [first, ...rest] = f.split('\n');
          const detail = rest.join('\n').trim().slice(-FAILURE_OUTPUT_CAP);
          if (detail === '') return [`- ${first}`];
          const fence = fenceFor(detail);
          return [`- ${first}`, '', `${fence}text`, detail, fence, ''];
        }),
        '',
      ].join('\n');
      const headline = `projection generation failed: ${failures.map((f) => f.split('\n')[0]).join('; ')}`;
      return { code: 1, summary, headline, changed: false };
    }

    const changed = rendered.some((p) => p.diff !== '');
    const diffFile = join(opts.outDir, 'spec-projections.diff');
    rmSync(diffFile, { force: true });
    if (changed) writeFileSync(diffFile, rendered.map((p) => p.diff).join(''));
    const headline = changed
      ? rendered
          .filter((p) => p.diff !== '')
          .map((p) => {
            const { added, removed } = lineCounts(p.diff);
            return `${p.name} +${added} −${removed}${p.headline.length > 0 ? ` (${p.headline.join('; ')})` : ''}`;
          })
          .join(' · ')
      : `neither projection changes against ${opts.baseLabel}`;
    return { code: 0, summary: renderSummary(opts.baseLabel, rendered), headline, changed };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function argValue(argv: string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  const value = at >= 0 ? argv[at + 1] : undefined;
  return value === undefined || value.startsWith('--') ? undefined : value;
}

function main(argv: string[]): number {
  const base = argValue(argv, '--base');
  const outDirArg = argValue(argv, '--out-dir');
  const summaryFile = argValue(argv, '--summary');
  if (!base || !outDirArg) {
    console.error(
      'usage: tsx scripts/render-projection-diff.ts --base <ref> --out-dir <dir> [--summary <file>]',
    );
    return 2;
  }
  const top = git(['rev-parse', '--show-toplevel'], PKG_DIR);
  if (top.status !== 0) {
    console.error(`✗ not inside a git checkout (${top.stderr.trim()}) — nothing was rendered.`);
    return 1;
  }
  const repoRoot = top.stdout.trim();
  const sha = git(['rev-parse', '--verify', `${base}^{commit}`], repoRoot);
  if (sha.status !== 0) {
    console.error(`✗ --base ${base} does not resolve to a commit here (${sha.stderr.trim()}) — nothing was rendered.`);
    return 1;
  }
  const baseSha = sha.stdout.trim();
  const outDir = resolve(outDirArg);
  mkdirSync(outDir, { recursive: true });

  const result = renderProjectionDiff({
    repoRoot,
    baseSha,
    baseLabel: `${base} = ${baseSha.slice(0, 10)}`,
    outDir,
    headSpecDir: realpathSync(PKG_DIR),
  });
  if (summaryFile) appendFileSync(summaryFile, `${result.summary}\n`);
  writeFileSync(join(outDir, 'summary.md'), result.summary);
  if (process.env.GITHUB_ACTIONS === 'true') {
    const level = result.code === 0 ? 'notice' : 'error';
    // Workflow-command data must not carry a raw newline.
    console.log(`::${level} title=Generated ADR-0087 projections::${result.headline.replace(/\r?\n/g, ' ')}`);
  }
  if (result.code !== 0) {
    console.error(result.summary);
    return result.code;
  }
  console.log(`✓ ${result.headline}`);
  console.log(`  summary: ${join(outDir, 'summary.md')}${result.changed ? ` · diff: ${join(outDir, 'spec-projections.diff')}` : ''}`);
  return 0;
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) process.exit(main(process.argv.slice(2)));
