// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta --json`: a run that replayed no step says so, in the same
 * words the human run does.
 *
 * ## The defect these pin
 *
 * `composeMigrationChain` keeps the majors `m > fromMajor && m <= toMajor`, so
 * an empty range (`--from T` with `T` the terminus, or `--from N --to N`) and
 * an inverted one (`--from T+1`, which defaults `--to` to `T`) both compose zero
 * steps. The human run answers that as an empty range: "this run replayed
 * nothing — that is not a finding that the metadata is canonical". The JSON run
 * answered it exactly like a clean replay — `applied: []`, `todos: []`,
 * `schemaValid: true`, exit 0 — so an upgrade script reading the JSON with a
 * wrong `--from` was told its metadata had been migrated.
 *
 * So the JSON answer now carries `replayedNothing` whenever no step ran, read
 * by the one function the human run renders. A run that replayed a step carries
 * no such member, and its payload keeps the shape it always had.
 *
 * ⛔ No expectation here hard-codes a major. Every range is derived from
 * `MIGRATION_MAJORS` and `PROTOCOL_MAJOR`, so the file stays true one major later.
 *
 * In-process over `MigrateMeta.run`: no process is spawned and no kernel is
 * booted, so this file sits in the `unit` tier by behaviour.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { MIGRATION_MAJORS, MIGRATION_SUPPORT_FLOOR } from '@objectstack/spec/migrations';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import MigrateMeta from '../src/commands/migrate/meta.js';

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

/** Where the chain ends when `--to` is not given, computed as the command computes it. */
const TERMINUS = Math.max(PROTOCOL_MAJOR, ...MIGRATION_MAJORS);

/** One below the terminus: a range that holds the terminus's own step. */
const BELOW = TERMINUS - 1;

/** A canonical stack: nothing in it is a retired spelling. */
const CANONICAL_CONFIG = `
export default {
  manifest: { id: 'com.example.replayed-nothing', name: 'Replayed Nothing', version: '1.0.0', type: 'app' },
  objects: [{ name: 'rn_ticket', label: 'Ticket', fields: { title: { type: 'text', label: 'Title' } } }],
};
`;

/** Every member a replay's payload carried before this change, in order (`hops` only under `--step`). */
const REPLAY_KEYS = [
  'from', 'to', 'protocolVersion', 'applied', 'todos', 'absentTodos',
  'specChanges', 'schemaValid', 'dataMigrations', 'duration',
];

interface Run {
  stdout: string;
  exitCode: number | undefined;
}

let dir: string;
const runs = new Map<string, Promise<Run>>();

/** Run the real command in-process once per distinct invocation, capturing stdout and any exit. */
function runMeta(flags: string[]): Promise<Run> {
  const key = flags.join(' ');
  const hit = runs.get(key);
  if (hit) return hit;
  const started = (async (): Promise<Run> => {
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
      await MigrateMeta.run([join(dir, 'objectstack.config.ts'), ...flags], { root: CLI_ROOT });
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
    return { stdout: stripVTControlCharacters(out.join('\n')), exitCode };
  })();
  runs.set(key, started);
  return started;
}

const json = async (flags: string[]) => {
  const run = await runMeta([...flags, '--json']);
  return { exitCode: run.exitCode, payload: JSON.parse(run.stdout) };
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-meta-replayed-nothing-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), CANONICAL_CONFIG);
});

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('os migrate meta --json: a run that replayed no step says so', () => {
  it('derives its ranges from a registry that has a step at the terminus', () => {
    // Anti-vacuity: without a step at the terminus `--from BELOW` is no replay,
    // and the control case below would read an empty range as a real one.
    expect(MIGRATION_MAJORS).toContain(TERMINUS);
    expect(BELOW).toBeGreaterThanOrEqual(MIGRATION_SUPPORT_FLOOR);
  });

  it('an empty range at the terminus (`--from T`) carries the marker, with no wider range', async () => {
    const { exitCode, payload } = await json(['--from', String(TERMINUS)]);
    expect(exitCode).toBeUndefined();
    expect(payload.from).toBe(TERMINUS);
    expect(payload.to).toBe(TERMINUS);
    expect(payload.applied).toEqual([]);
    expect(payload.todos).toEqual([]);
    expect(payload.replayedNothing).toEqual({ reason: 'empty-range', widestRange: null });
  }, 120_000);

  it('an explicit empty range (`--from T --to T`) carries the same marker', async () => {
    const { exitCode, payload } = await json(['--from', String(TERMINUS), '--to', String(TERMINUS)]);
    expect(exitCode).toBeUndefined();
    expect(payload.replayedNothing).toEqual({ reason: 'empty-range', widestRange: null });
  }, 120_000);

  it('an inverted range (`--from T+1`) carries the marker, and its reason says the range is inverted', async () => {
    const { exitCode, payload } = await json(['--from', String(TERMINUS + 1)]);
    // Not refused: an inverted range is answered, never gated.
    expect(exitCode).toBeUndefined();
    expect(payload.from).toBe(TERMINUS + 1);
    expect(payload.to).toBe(TERMINUS);
    expect(payload.replayedNothing).toEqual({ reason: 'inverted-range', widestRange: null });
  }, 120_000);

  it('an inverted range whose --to is below the terminus offers no wider range either', async () => {
    // `--from T --to T-1` and `--from T+1 --to T-1`: a "widest range" from a
    // `--from` at or above the terminus is itself empty or inverted, so there
    // is no wider range to name, whatever `--to` says.
    for (const from of [TERMINUS, TERMINUS + 1]) {
      const { exitCode, payload } = await json(['--from', String(from), '--to', String(BELOW)]);
      expect(exitCode).toBeUndefined();
      expect(payload.from).toBe(from);
      expect(payload.to).toBe(BELOW);
      expect(payload.replayedNothing).toEqual({ reason: 'inverted-range', widestRange: null });
    }
  }, 120_000);

  it('an empty range below the terminus names what the widest range holds, as the human run does', async () => {
    const flags = ['--from', String(BELOW), '--to', String(BELOW)];
    const { exitCode, payload } = await json(flags);
    expect(exitCode).toBeUndefined();
    expect(payload.replayedNothing?.reason).toBe('empty-range');
    const widest = payload.replayedNothing?.widestRange;
    expect(widest).toMatchObject({ from: BELOW, to: TERMINUS });
    expect(typeof widest.applied).toBe('number');
    expect(typeof widest.manual).toBe('number');
    // One reading, two faces: the counts the human run prints are the JSON's.
    const human = (await runMeta(flags)).stdout;
    if (widest.applied === 0 && widest.manual === 0) {
      expect(human).toContain(`(protocol ${BELOW} → ${TERMINUS}) has nothing for this stack either`);
    } else {
      expect(human).toContain(
        `Protocol ${BELOW} → ${TERMINUS} has ${widest.applied} mechanical and ${widest.manual} manual change(s)`,
      );
    }
  }, 120_000);

  it('the human run names the inverted range too', async () => {
    const { stdout, exitCode } = await runMeta(['--from', String(TERMINUS + 1)]);
    expect(exitCode).toBeUndefined();
    expect(stdout).toContain(`--from ${TERMINUS + 1} is above --to ${TERMINUS}`);
    expect(stdout).toContain('this run replayed nothing');
  }, 120_000);

  it('a real replay (`--from T-1`) carries no marker and keeps the payload it always had', async () => {
    const { exitCode, payload } = await json(['--from', String(BELOW)]);
    expect(exitCode).toBeUndefined();
    expect(payload.from).toBe(BELOW);
    expect(payload.to).toBe(TERMINUS);
    expect(Object.keys(payload)).toEqual(REPLAY_KEYS);
  }, 120_000);
});
