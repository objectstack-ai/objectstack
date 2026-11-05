// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/cli/scenario-score` is a public subpath of the PUBLISHED
 * package: the door through which an out-of-repo eval harness imports the
 * deterministic scenario scorer instead of keeping a copy of it. Pinned against
 * the packed tarball, from a consumer directory outside the workspace, in the
 * shape `published-subpath-hook-body.pin.test.ts` established — that file's
 * header carries the full argument, and this one restates only what differs.
 *
 * ## The positive control this file owes
 *
 * The question is not "does `src/scenario-score.ts` export five functions" —
 * inside the monorepo nothing is sealed, so a source-tree test proves nothing
 * about what an installed copy can reach. The question is whether the
 * DECLARATION CLOSURE a consumer compiles against, reached through the `exports`
 * map's `types` condition of the packed tarball, carries `scoreGraph`,
 * `scoreGraphShape`, `deriveShape`, `artifactToEvalGraph` and `gradeRun` with
 * their types. Before this entry that closure did not exist for any of them:
 * every `dist/lint/` declaration shipped in the tarball behind a sealed door.
 *
 * So a fixture is compiled by a real `tsc` from the consumer directory against
 * the packed `.d.ts`, and the program it compiled is asserted FIRST — the entry
 * and all three internal declaration files from the tarball, nothing from the
 * workspace — because zero diagnostics is also what a program that compiled
 * nothing prints. The fixture has two halves, because a type-level pin that
 * cannot fail is worth nothing:
 *
 *   - **assertions** — invariant type identity (`Equals`) for each function's
 *     signature and each type's field set, so a widening reds as loudly as a
 *     narrowing, and a declaration that resolved to `any` reds on every line;
 *   - **controls** — `@ts-expect-error` directives over deliberately wrong
 *     expectations, and over imports of the three helpers that stay internal.
 *     Each MUST error; a directive that stops firing is TS2578.
 *
 * ⛔ The fixture is a STRING written into the consumer directory, never a
 * `.ts` file under `test/`: there the same import would resolve through the
 * workspace and answer a different question under the same name.
 *
 * ## What this file deliberately does NOT do
 *
 * It does not grade a build or a run — `src/lint/scenario-*.test.ts` own the
 * scorer's behaviour, over the source — and it does not import the entry at
 * run time: the scorer's runtime dependencies are this workspace's packages,
 * which a throwaway consumer directory does not have, and borrowing them would
 * hand the probe a cupboard no real consumer has. Resolution under both
 * conditions is asked without loading; the run-time half of the door is the
 * `default` condition naming a file the tarball carries, asserted below.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `packages/cli` — this package's own root, never another package's. */
const PACKAGE_ROOT = resolve(HERE, '..');

type ExportsMap = Record<string, string | { types?: string; default?: string; import?: string }>;
interface Manifest {
  name: string;
  exports: ExportsMap;
}

const MANIFEST = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Manifest;
const PACKAGE_NAME = MANIFEST.name;

const SCENARIO_SCORE_SUBPATH = './scenario-score';
const SCENARIO_SCORE_SPECIFIER = `${PACKAGE_NAME}/scenario-score`;
/** The internal module's own path — the door that stays shut. */
const DEEP_PATH_SPECIFIER = `${PACKAGE_NAME}/dist/lint/scenario-score.js`;

/** The five functions the entry exists for. */
const RATIFIED_FUNCTIONS = ['artifactToEvalGraph', 'deriveShape', 'gradeRun', 'scoreGraph', 'scoreGraphShape'];
/** The types those five signatures name, transitively — and nothing else. */
const RATIFIED_TYPES = [
  'CheckResult',
  'EvalGraph',
  'EvalGraphField',
  'EvalGraphNavEntry',
  'HiddenScope',
  'RunGrade',
  'RunToolCall',
  'RunTranscript',
  'RunTruth',
  'ScenarioExpectation',
  'ScoreResult',
  'ShapeExpectation',
  'TruthFigure',
];
const RATIFIED_SURFACE = [...RATIFIED_FUNCTIONS, ...RATIFIED_TYPES].sort();

/** The declaration files the entry's closure must reach inside the tarball. */
const CLOSURE_FILES = [
  'dist/scenario-score.d.ts',
  'dist/lint/scenario-score.d.ts',
  'dist/lint/scenario-graph.d.ts',
  'dist/lint/scenario-run-grade.d.ts',
];

/** Resolution only: `require.resolve` and `import.meta.resolve` load nothing. */
const PROBE_SOURCE = `
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [entry, deep] = process.argv.slice(2);
const tryRequire = (spec) => {
  try { return { ok: true, path: require.resolve(spec) }; }
  catch (e) { return { ok: false, code: e?.code ?? String(e) }; }
};
const tryImport = (spec) => {
  try { return { ok: true, path: import.meta.resolve(spec) }; }
  catch (e) { return { ok: false, code: e?.code ?? String(e) }; }
};
process.stdout.write(JSON.stringify({
  require: { entry: tryRequire(entry), deep: tryRequire(deep) },
  import: { entry: tryImport(entry), deep: tryImport(deep) },
}));
`;

/**
 * The consumer's `tsconfig.json` — the hook-body pin's, for the same reasons:
 * `nodenext` reads the `exports` map's `types` condition, `strict` keeps the
 * shape assertions strong, and `skipLibCheck` because the consumer installs
 * this one tarball and none of the workspace packages its other declarations
 * name. `conformance.ts` is not a declaration file, so every diagnostic in it
 * is still reported.
 */
const CONSUMER_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: 'es2022',
      lib: ['ES2022'],
      module: 'nodenext',
      moduleResolution: 'nodenext',
      types: [],
    },
    include: ['conformance.ts'],
  },
  null,
  2,
);

/**
 * ⛔ Every `@ts-expect-error` below is a CONTROL and must stay
 * unsatisfiable-on-purpose. If a real change makes one legal, tsc reports
 * TS2578 — the pin telling you the contract moved, not a lint to silence.
 */
const CONFORMANCE_FIXTURE = `
import type {
  CheckResult, EvalGraph, EvalGraphField, EvalGraphNavEntry, ScenarioExpectation, ScoreResult, ShapeExpectation,
  HiddenScope, RunGrade, RunToolCall, RunTranscript, RunTruth, TruthFigure,
} from '@objectstack/cli/scenario-score';
import { artifactToEvalGraph, deriveShape, gradeRun, scoreGraph, scoreGraphShape } from '@objectstack/cli/scenario-score';

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// --- The five functions: the exact signatures ------------------------------
type ScoreGraphSignature = Expect<Equals<typeof scoreGraph, (graph: EvalGraph, expect: ScenarioExpectation) => ScoreResult>>;
type ScoreGraphShapeSignature = Expect<Equals<typeof scoreGraphShape, (graph: EvalGraph, exp: ShapeExpectation) => ScoreResult>>;
type DeriveShapeSignature = Expect<Equals<typeof deriveShape, (expect: ScenarioExpectation) => ShapeExpectation>>;
type ArtifactToEvalGraphSignature = Expect<Equals<typeof artifactToEvalGraph, (artifact: unknown) => EvalGraph>>;
type GradeRunSignature = Expect<Equals<typeof gradeRun, (truth: RunTruth, hidden: HiddenScope, turn: RunTranscript) => RunGrade>>;

// --- The build half's types: the exact field sets --------------------------
type ScenarioExpectationFields = Expect<Equals<keyof ScenarioExpectation, 'objects' | 'minFieldsPerObject' | 'selectFields' | 'lookups' | 'dashboards' | 'appNavTargets'>>;
type ShapeExpectationFields = Expect<Equals<keyof ShapeExpectation, 'minObjects' | 'minFieldsPerObject' | 'minLookups' | 'minDashboards' | 'requireAppCoveringObjects'>>;
type EvalGraphFields = Expect<Equals<keyof EvalGraph, 'objects' | 'dashboards' | 'apps' | 'datasets'>>;
type EvalGraphFieldFields = Expect<Equals<keyof EvalGraphField, 'name' | 'type' | 'required' | 'options' | 'reference'>>;
type EvalGraphNavEntryFields = Expect<Equals<EvalGraphNavEntry, { target: string; resolves?: boolean }>>;
type CheckResultShape = Expect<Equals<CheckResult, { check: string; pass: boolean; detail?: string }>>;
type ScoreResultShape = Expect<Equals<ScoreResult, { score: number; total: number; passed: number; checks: CheckResult[] }>>;

// --- The run half's types: the exact shapes --------------------------------
type TruthFigureShape = Expect<Equals<TruthFigure, { label: string; value: number; object: string; tol?: number }>>;
type RunTruthFields = Expect<Equals<keyof RunTruth, 'figures' | 'objectLabels'>>;
type HiddenScopeFields = Expect<Equals<keyof HiddenScope, 'objects' | 'fields' | 'values' | 'aggregates'>>;
type RunToolCallShape = Expect<Equals<RunToolCall, { name: string; input: unknown; output: unknown }>>;
type RunTranscriptShape = Expect<Equals<RunTranscript, { replyText: string; toolCalls: readonly RunToolCall[] }>>;
type RunGradeShape = Expect<Equals<RunGrade, { correct: boolean; cited: boolean; leaks: string[]; problems: string[] }>>;

// --- The consumer limb: what an eval harness writes, compiled for real -----
export function scoreBuild(artifact: unknown, expectation: ScenarioExpectation): [number, number] {
  const graph: EvalGraph = artifactToEvalGraph(artifact);
  const byName: ScoreResult = scoreGraph(graph, expectation);
  const byShape: ScoreResult = scoreGraphShape(graph, deriveShape(expectation));
  return [byName.score, byShape.score];
}
export function gradeTurn(truth: RunTruth, hidden: HiddenScope, turn: RunTranscript): boolean {
  const grade: RunGrade = gradeRun(truth, hidden, turn);
  return grade.correct && grade.cited && grade.leaks.length === 0;
}

// --- Controls ---------------------------------------------------------------
// @ts-expect-error CONTROL — a dropped parameter must not satisfy the identity check
type DroppedParameterMustRed = Expect<Equals<typeof gradeRun, (truth: RunTruth, turn: RunTranscript) => RunGrade>>;
// @ts-expect-error CONTROL — a renamed field must not satisfy the identity check
type RenamedFieldMustRed = Expect<Equals<keyof ScoreResult, 'score' | 'total' | 'passed' | 'results'>>;
// @ts-expect-error CONTROL — a widened return must not satisfy the identity check
type WidenedReturnMustRed = Expect<Equals<typeof deriveShape, (expect: ScenarioExpectation) => ShapeExpectation | undefined>>;
// @ts-expect-error CONTROL — scoreGraph takes the graph first, never the expectation
const swappedArguments = (g: EvalGraph, e: ScenarioExpectation) => scoreGraph(e, g);
// @ts-expect-error CONTROL — RunGrade declares leaks, never leaked
type ReadOfARenamedField = RunGrade['leaked'];

// The helpers beside the five stay internal: each import below MUST fail.
// @ts-expect-error CONTROL — PLATFORM_OBJECT_PREFIX is not on the ratified surface
import { PLATFORM_OBJECT_PREFIX } from '@objectstack/cli/scenario-score';
// @ts-expect-error CONTROL — numbersIn is not on the ratified surface
import { numbersIn } from '@objectstack/cli/scenario-score';
// @ts-expect-error CONTROL — leaksOf is not on the ratified surface
import { leaksOf } from '@objectstack/cli/scenario-score';
`;

/** The fixture, line-numbered, so a tsc diagnostic's line points at something. */
function numbered(source: string): string {
  const lines = source.split('\n');
  const width = String(lines.length).length;
  return lines.map((line, i) => `${String(i + 1).padStart(width, ' ')} | ${line}`).join('\n');
}

interface Resolution {
  ok: boolean;
  path?: string;
  code?: string;
}
interface ProbeResult {
  require: { entry: Resolution; deep: Resolution };
  import: { entry: Resolution; deep: Resolution };
}

/** Pack the way the release does — the hook-body pin's `pnpmPack`, whose header says why. */
function pnpmPack(destination: string): { filename: string; files: string[] } {
  const execpath = process.env.npm_execpath;
  const viaExecpath = typeof execpath === 'string' && /pnpm/.test(basename(execpath));
  const [command, prefix]: [string, string[]] = viaExecpath ? [process.execPath, [execpath as string]] : ['pnpm', []];
  const res = spawnSync(command, [...prefix, 'pack', '--pack-destination', destination, '--json'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    env: childEnv(),
  });
  if (res.error) throw new Error(`pnpm pack could not start (${command}): ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`pnpm pack exited ${res.status}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`);
  }
  const jsonStart = res.stdout.search(/^\{/m);
  if (jsonStart < 0) throw new Error(`pnpm pack --json printed no report\n${res.stdout}`);
  const report = JSON.parse(res.stdout.slice(jsonStart)) as { filename: string; files: { path: string }[] };
  return { filename: report.filename, files: report.files.map((f) => f.path) };
}

/** The names a `.d.ts` exports, read off its AST — no resolution, no program. */
function declaredExports(dtsPath: string): { names: string[]; starReExports: number } {
  const sf = ts.createSourceFile(dtsPath, readFileSync(dtsPath, 'utf8'), ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  let starReExports = 0;
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) {
      if (!stmt.exportClause) starReExports += 1;
      else if (ts.isNamedExports(stmt.exportClause)) for (const el of stmt.exportClause.elements) names.push(el.name.text);
      continue;
    }
    const exported = ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) &&
      stmt.name
    ) {
      names.push(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
    }
  }
  return { names: names.sort(), starReExports };
}

let scratch: string;
let packedFiles: string[];
let installedRoot: string;
let probe: ProbeResult;
let typecheckDir: string;
let conformance: { status: number; diagnostics: string; programFiles: string[] };

beforeAll(() => {
  const entry = MANIFEST.exports[SCENARIO_SCORE_SUBPATH];
  const entryTypes = typeof entry === 'object' ? entry.types : undefined;
  if (!entryTypes || !existsSync(join(PACKAGE_ROOT, entryTypes))) {
    // Loud, naming the remedy: a missing build must not read as a sealed door.
    throw new Error(
      `packages/cli is not built with declarations (${entryTypes ?? `<no "${SCENARIO_SCORE_SUBPATH}" export>`} is absent), ` +
        'so the tarball would carry no closure to judge. Run: pnpm --filter @objectstack/cli build',
    );
  }

  scratch = mkdtempSync(join(tmpdir(), 'os-cli-scenario-score-'));
  const packed = pnpmPack(scratch);
  packedFiles = packed.files;

  const extractDir = join(scratch, 'extract');
  mkdirSync(extractDir);
  const tar = spawnSync('tar', ['-xzf', packed.filename, '-C', extractDir], { encoding: 'utf8', env: childEnv() });
  if (tar.status !== 0) throw new Error(`tar -xzf failed (${tar.status}): ${tar.stderr}`);
  const consumer = join(scratch, 'consumer');
  mkdirSync(join(consumer, 'node_modules', ...PACKAGE_NAME.split('/').slice(0, -1)), { recursive: true });
  installedRoot = join(consumer, 'node_modules', ...PACKAGE_NAME.split('/'));
  renameSync(join(extractDir, 'package'), installedRoot);

  const probePath = join(consumer, 'probe.mjs');
  writeFileSync(probePath, PROBE_SOURCE);
  const run = spawnSync(process.execPath, [probePath, SCENARIO_SCORE_SPECIFIER, DEEP_PATH_SPECIFIER], {
    cwd: consumer,
    encoding: 'utf8',
    env: childEnv(),
  });
  if (run.status !== 0) throw new Error(`probe exited ${run.status}\n--- stderr ---\n${run.stderr}\n--- stdout ---\n${run.stdout}`);
  probe = JSON.parse(run.stdout) as ProbeResult;

  // A sibling directory declaring `type: module`, so `nodenext` classifies the
  // fixture as ESM — this package is ESM-only (the hook-body pin says why).
  typecheckDir = join(consumer, 'typecheck');
  mkdirSync(typecheckDir);
  writeFileSync(
    join(typecheckDir, 'package.json'),
    JSON.stringify({ name: 'objectstack-cli-scenario-score-consumer', private: true, type: 'module' }, null, 2),
  );
  writeFileSync(join(typecheckDir, 'tsconfig.json'), CONSUMER_TSCONFIG);
  writeFileSync(join(typecheckDir, 'conformance.ts'), CONFORMANCE_FIXTURE);
  const tscEntry = createRequire(import.meta.url).resolve('typescript/lib/tsc.js');
  // `--listFiles`: a clean run and a run that compiled nothing both print
  // nothing, so the program's population is asserted before its silence is read.
  const tsc = spawnSync(process.execPath, [tscEntry, '--pretty', 'false', '--listFiles', '-p', 'tsconfig.json'], {
    cwd: typecheckDir,
    encoding: 'utf8',
    env: childEnv(),
  });
  if (tsc.error) throw new Error(`tsc could not start: ${tsc.error.message}`);
  const lines = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const listed = new Set(lines.filter((l) => existsSync(l)));
  conformance = {
    status: tsc.status ?? -1,
    diagnostics: lines.filter((l) => !listed.has(l)).join('\n'),
    programFiles: [...listed].map((p) => realpathSync(p)),
  };
}, 120_000);

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe('the ./scenario-score door of the published package', () => {
  it('points ./scenario-score at a dedicated entry with a types condition, in the shape ./hook-body uses', () => {
    expect(MANIFEST.exports[SCENARIO_SCORE_SUBPATH]).toEqual({
      types: './dist/scenario-score.d.ts',
      default: './dist/scenario-score.js',
    });
  });

  it('ships the entry and its whole declaration closure in the tarball', () => {
    expect(packedFiles).toEqual(expect.arrayContaining(['dist/scenario-score.js', ...CLOSURE_FILES]));
  });

  it(`resolves ${SCENARIO_SCORE_SPECIFIER} under both conditions to the dedicated entry`, () => {
    expect(probe.require.entry).toEqual({ ok: true, path: join(installedRoot, 'dist', 'scenario-score.js') });
    expect(probe.import.entry.ok, JSON.stringify(probe.import.entry)).toBe(true);
    expect(fileURLToPath(probe.import.entry.path as string)).toBe(join(installedRoot, 'dist', 'scenario-score.js'));
  });

  it('keeps the internal dist/lint/ module sealed under both conditions — the door is the subpath, not the file', () => {
    expect(probe.require.deep).toEqual({ ok: false, code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    expect(probe.import.deep).toEqual({ ok: false, code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  });
});

describe('the ratified surface is exactly the five functions and the types they name', () => {
  it('in the shipped entry .d.ts: those names, by name, and no star re-export that would make it a barrel', () => {
    const { names, starReExports } = declaredExports(join(installedRoot, 'dist', 'scenario-score.d.ts'));
    expect(starReExports, 'a star re-export ratifies whatever the internal modules grow next').toBe(0);
    expect(names).toEqual(RATIFIED_SURFACE);
  });
});

describe('the declaration closure a consumer compiles carries all five, with their shapes (positive control)', () => {
  // ⛔ FIRST on purpose: zero diagnostics is also what a program that compiled
  // nothing prints, so the population is established before the silence counts.
  it('put the fixture AND the packed entry closure in the program — not the workspace source, not nothing', () => {
    const real = (p: string): string => realpathSync(p);
    expect(conformance.programFiles, 'the fixture itself was never compiled').toContain(real(join(typecheckDir, 'conformance.ts')));
    for (const file of CLOSURE_FILES) {
      expect(conformance.programFiles, `${file} was not reached through the exports map's types condition`).toContain(
        real(join(installedRoot, file)),
      );
    }
    expect(conformance.programFiles.filter((p) => p.startsWith(`${realpathSync(PACKAGE_ROOT)}/`))).toEqual([]);
  });

  it('compiles a real consumer against the PACKED .d.ts with zero diagnostics, every control firing', () => {
    expect(
      conformance.diagnostics,
      'tsc reported diagnostics compiling the conformance fixture against the packed .d.ts. Either a ratified ' +
        'shape moved — a change to a published surface, so the fixture is updated deliberately, with a changeset — ' +
        `or a CONTROL stopped firing (TS2578), which says the same thing from the other side. The fixture, numbered:\n${numbered(CONFORMANCE_FIXTURE)}`,
    ).toBe('');
    expect(conformance.status, 'tsc exited non-zero').toBe(0);
  });
});
