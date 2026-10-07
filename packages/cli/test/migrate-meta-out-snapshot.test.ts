// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta --out FILE` writes its snapshot on a run with nothing to
 * migrate, exactly as it does on every other run (#22116).
 *
 * The human report returns early when the chain applied no edit and listed no
 * manual change, and that return used to come before the `--out` write. So a
 * range that crosses no step (`--from 18 --to 18 --out FILE`) exited 0, printed
 * no snapshot line and wrote no FILE, while the same run with `--json` wrote
 * FILE. An operator or a CI step keeps FILE as the record of the run: a missing
 * one fails the next step that opens it, and a stale one left by an earlier run
 * is read as this run's.
 *
 * ## What is pinned
 *
 *  1. Every empty range this build accepts (`--from N --to N`, N from the
 *     support floor to the chain's terminus) writes FILE in the human mode and
 *     names it on exactly one line, after the range answer. The `--json` mode
 *     writes FILE too, and the two FILEs are byte-identical. A stale FILE is
 *     overwritten.
 *  2. Control: a range with steps writes FILE and names it where it always
 *     did, after the manual changes; its bytes equal the `--json` mode's.
 *  3. Order on the early return, as on the main path: the snapshot line, then
 *     `--write`'s outcome, then the data migrations, which stay last. The first
 *     two through the command; the data migrations in-process on
 *     `printMigrationReport`, because an empty range never lists any.
 *  4. Both arms of the early return. The other arm ("Nothing to migrate": a
 *     range WITH steps that applied and listed nothing) is not reachable
 *     through the chain on this build. Measured on `a959493c`: every major
 *     carries semantic entries (77 for protocol 17, 306 for protocol 18), and
 *     the chain lists every entry of every hop it crosses, whatever the stack
 *     holds. It is pinned in-process over a real chain result with its notices
 *     taken away, because the write sits in the branch both arms share.
 *
 * In-process over the real command (`MigrateMeta.run`) against a temp project
 * that links the real `@objectstack/spec`: no process is spawned and no kernel
 * is booted, so this file sits in the `unit` tier.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import {
  applyMetaMigrations,
  MIGRATION_MAJORS,
  MIGRATION_SUPPORT_FLOOR,
  type MigrationChainResult,
} from '@objectstack/spec/migrations';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import MigrateMeta, {
  printMigrationReport,
  type MigrationReport,
  type PendingDataMigration,
  type WriteOutcome,
} from '../src/commands/migrate/meta.js';

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const RUN_TIMEOUT = 120_000;

/** Where the chain ends by default — derived, so the file survives the next major. */
const TERMINUS = Math.max(PROTOCOL_MAJOR, ...MIGRATION_MAJORS);

/** Every empty range the command accepts: `--from N --to N`, floor to terminus. */
const EMPTY_RANGES = Array.from(
  { length: TERMINUS - MIGRATION_SUPPORT_FLOOR + 1 },
  (_, i) => MIGRATION_SUPPORT_FLOOR + i,
);

/** `packages/cli` depends on `@objectstack/spec`; resolved as a package, not a source path. */
const requireFromCli = createRequire(import.meta.url);
const SPEC_PACKAGE_ROOT = dirname(requireFromCli.resolve('@objectstack/spec/package.json'));

const MANIFEST_ID = 'com.example.out-snapshot';

/** A one-object stack, already canonical — the shape of the run the defect was measured on. */
const STACK = {
  manifest: { id: MANIFEST_ID, name: 'Out snapshot', version: '1.0.0', type: 'app' },
  objects: [{ name: 'os_thing', label: 'Thing', fields: { title: { type: 'text', label: 'Title' } } }],
};

let root: string;
let specLink: string;
let project: string;
let fileSeq = 0;

/** A fresh, absent snapshot path under the temp root. */
function freshOut(): string {
  return join(root, `snapshot-${++fileSeq}.json`);
}

interface Run {
  stdout: string;
  lines: string[];
  exitCode: number;
}

/** Run the real command in-process, capturing stdout and any exit. */
async function runMeta(argv: string[]): Promise<Run> {
  const out: string[] = [];
  const priorExitCode = process.exitCode;
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    out.push(String(chunk));
    const done = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
    done?.();
    return true;
  }) as never);
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  let exitCode: number | undefined;
  try {
    await MigrateMeta.run([join(project, 'objectstack.config.ts'), ...argv], { root: CLI_ROOT });
  } catch (e: any) {
    if (typeof e?.oclif?.exit !== 'number') throw e;
    exitCode = e.oclif.exit;
  } finally {
    write.mockRestore();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    if (exitCode === undefined && typeof process.exitCode === 'number' && process.exitCode !== 0) {
      exitCode = process.exitCode;
    }
    process.exitCode = priorExitCode;
  }
  const stdout = stripVTControlCharacters(out.join('\n'));
  return { stdout, lines: stdout.split('\n'), exitCode: exitCode ?? 0 };
}

/** The indices of the lines that name `file`. */
function linesNaming(lines: string[], file: string): number[] {
  return lines.flatMap((l, i) => (l.includes(file) ? [i] : []));
}

function indexOf(lines: string[], re: RegExp): number {
  return lines.findIndex((l) => re.test(l));
}

const RANGE_ANSWER_RE = /No migration step exists for protocol/;
const SEMANTIC_HEADER_RE = /^ {2}\d+ manual change\(s\) require your judgment:$/;
const WRITE_OUTCOME_RE = /^ {2}ℹ --write: /;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-migrate-meta-out-'));
  mkdirSync(join(root, 'node_modules', '@objectstack'), { recursive: true });
  specLink = join(root, 'node_modules', '@objectstack', 'spec');
  symlinkSync(SPEC_PACKAGE_ROOT, specLink, 'dir');
  project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, 'objectstack.config.ts'),
    `import { defineStack } from '@objectstack/spec';

export default defineStack(${JSON.stringify(STACK, null, 2)});
`,
  );
});

afterAll(() => {
  // Unlinked BEFORE the recursive remove, and named explicitly: this symlink
  // points at the real `packages/spec`, and a cleanup must never follow it.
  try { unlinkSync(specLink); } catch { /* already gone */ }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── 1: an empty range, through the command ─────────────────────────────────

describe('os migrate meta --out over a range that crosses no step', () => {
  it.each(EMPTY_RANGES)('--from %i --to the same writes FILE in the human mode and the --json mode alike', async (n) => {
    const human = freshOut();
    const machine = freshOut();

    const h = await runMeta(['--from', String(n), '--to', String(n), '--out', human]);
    expect(h.exitCode).toBe(0);
    // Anti-vacuity: this run took the empty-range answer, not the main path.
    const answer = indexOf(h.lines, RANGE_ANSWER_RE);
    expect(answer, 'the run answered an empty range').toBeGreaterThan(-1);
    expect(existsSync(human), 'the human mode wrote FILE').toBe(true);
    const named = linesNaming(h.lines, human);
    expect(named, 'one line names FILE').toHaveLength(1);
    expect(named[0]!).toBeGreaterThan(answer);

    const j = await runMeta(['--from', String(n), '--to', String(n), '--out', machine, '--json']);
    expect(j.exitCode).toBe(0);
    expect(JSON.parse(j.stdout).applied).toEqual([]);
    expect(existsSync(machine), 'the --json mode wrote FILE').toBe(true);

    // The two modes agree, byte for byte, and FILE is the stack.
    const bytes = readFileSync(human, 'utf8');
    expect(bytes).toBe(readFileSync(machine, 'utf8'));
    const snapshot = JSON.parse(bytes);
    expect(snapshot.manifest.id).toBe(MANIFEST_ID);
    expect(snapshot.objects.map((o: { name: string }) => o.name)).toEqual(['os_thing']);
  }, RUN_TIMEOUT);

  it('overwrites a stale FILE left by an earlier run', async () => {
    const out = freshOut();
    writeFileSync(out, '{ "stale": true }\n');
    const run = await runMeta(['--from', String(TERMINUS), '--to', String(TERMINUS), '--out', out]);
    expect(run.exitCode).toBe(0);
    const snapshot = JSON.parse(readFileSync(out, 'utf8'));
    expect(snapshot.stale).toBeUndefined();
    expect(snapshot.manifest.id).toBe(MANIFEST_ID);
  }, RUN_TIMEOUT);

  it('prints the snapshot line before --write\'s outcome', async () => {
    const out = freshOut();
    const run = await runMeta(['--from', String(TERMINUS), '--to', String(TERMINUS), '--out', out, '--write']);
    expect(run.exitCode).toBe(0);
    expect(existsSync(out)).toBe(true);
    const named = linesNaming(run.lines, out);
    expect(named).toHaveLength(1);
    const outcome = indexOf(run.lines, WRITE_OUTCOME_RE);
    expect(outcome, '--write printed its outcome').toBeGreaterThan(-1);
    expect(named[0]!).toBeGreaterThan(indexOf(run.lines, RANGE_ANSWER_RE));
    expect(named[0]!).toBeLessThan(outcome);
  }, RUN_TIMEOUT);
});

// ── 2: control — a range with steps ────────────────────────────────────────

describe('os migrate meta --out over a range with steps (control)', () => {
  it('writes FILE and names it after the manual changes, as before; the --json mode agrees', async () => {
    const from = TERMINUS - 1;
    const human = freshOut();
    const machine = freshOut();

    const h = await runMeta(['--from', String(from), '--to', String(TERMINUS), '--out', human]);
    expect(h.exitCode).toBe(0);
    const header = indexOf(h.lines, SEMANTIC_HEADER_RE);
    expect(header, 'anti-vacuity: the run took the main path and listed manual changes').toBeGreaterThan(-1);
    expect(indexOf(h.lines, RANGE_ANSWER_RE)).toBe(-1);
    expect(existsSync(human)).toBe(true);
    const named = linesNaming(h.lines, human);
    expect(named).toHaveLength(1);
    expect(named[0]!).toBeGreaterThan(header);

    const j = await runMeta(['--from', String(from), '--to', String(TERMINUS), '--out', machine, '--json']);
    expect(j.exitCode).toBe(0);
    expect(readFileSync(human, 'utf8')).toBe(readFileSync(machine, 'utf8'));
  }, RUN_TIMEOUT);
});

// ── 3–4: the early return's order, on both of its arms ─────────────────────

describe('printMigrationReport on a run with nothing to migrate', () => {
  let printed: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A data migration named by a command no real one uses, so its line is found by name. */
  const PROBE_DATA_MIGRATION: PendingDataMigration = {
    id: 'probe_data_migration',
    command: 'os migrate probe-data-migration',
    unlocks: 'nothing; a probe.',
  };

  /** `--write` over a chain that applied nothing: a plan with nothing in it. */
  const EMPTY_WRITE: WriteOutcome = {
    plan: { projectRoot: '/nowhere', rewrites: [], written: [], manual: [], unexplained: [] },
    status: 'written',
  };

  function report(result: MigrationChainResult, normalized: Record<string, unknown>, out: string): MigrationReport {
    const parsed = ObjectStackDefinitionSchema.safeParse(result.stack);
    return {
      result,
      normalized,
      schemaValid: parsed.success,
      refusals: parsed.success ? [] : parsed.error.issues,
      dataMigrations: [PROBE_DATA_MIGRATION],
      step: false,
      out,
      write: EMPTY_WRITE,
      elapsed: '1ms',
    };
  }

  const ARMS: Array<[string, () => { result: MigrationChainResult; normalized: Record<string, unknown> }]> = [
    ['an empty range', () => {
      const normalized = normalizeStackInput(STACK, { convert: false });
      const result = applyMetaMigrations(normalized, TERMINUS, TERMINUS);
      expect(result.hops, 'anti-vacuity: the range holds no step').toHaveLength(0);
      return { result, normalized };
    }],
    ['a range with steps that applied and listed nothing', () => {
      const normalized = normalizeStackInput(STACK, { convert: false });
      const real = applyMetaMigrations(normalized, TERMINUS - 1, TERMINUS);
      expect(real.applied, 'the canonical stack needs no mechanical edit').toEqual([]);
      // Not reachable through the chain on this build (see the header): the
      // notices are taken away so the report takes this arm.
      const result = { ...real, todos: [], hops: real.hops.map((hop) => ({ ...hop, todos: [] })) };
      expect(result.hops.length, 'anti-vacuity: the range holds a step').toBeGreaterThan(0);
      return { result, normalized };
    }],
  ];

  it.each(ARMS)('%s: writes FILE, then prints the snapshot line, --write\'s outcome and the data migrations, in that order', (_, arm) => {
    const { result, normalized } = arm();
    const out = freshOut();
    printed = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(' '));
    });
    printMigrationReport(report(result, normalized, out));
    const lines = stripVTControlCharacters(printed.join('\n')).split('\n');

    expect(readFileSync(out, 'utf8')).toBe(JSON.stringify(result.stack, null, 2));
    const named = linesNaming(lines, out);
    expect(named).toHaveLength(1);
    const outcome = indexOf(lines, WRITE_OUTCOME_RE);
    const data = lines.findIndex((l) => l.includes(PROBE_DATA_MIGRATION.command));
    expect(outcome).toBeGreaterThan(-1);
    expect(data).toBeGreaterThan(-1);
    expect(named[0]!).toBeLessThan(outcome);
    expect(outcome).toBeLessThan(data);
  });
});
