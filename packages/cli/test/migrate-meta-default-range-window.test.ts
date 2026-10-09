// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta`: the DEFAULT `--to`, pinned in the window #17134 was found
 * in, with that window held open on purpose.
 *
 * ## Why this file exists beside `migrate-meta-default-range.test.ts`
 *
 * The default under test is `Math.max(PROTOCOL_MAJOR, ...MIGRATION_MAJORS)`.
 * The default it replaced is `PROTOCOL_MAJOR`. The two differ only while the
 * registry carries a step PAST the runtime major, which is the window each
 * major's line spends accumulating the next major's conversions. Measured at
 * protocol 18 on #22130's branch: `MIGRATION_MAJORS` is `[17, 18]`, and no
 * conversion registers `toMajor: 19`. Both defaults are 18, so no run of the
 * installed CLI tells them apart. The spawned file's anti-vacuity line
 * (`TERMINUS > PROTOCOL_MAJOR`) would read `18 > 18` there.
 *
 * So the window is held open here rather than waited for. The real command
 * runs in-process over the real registry, and only the runtime's protocol
 * major is replaced: by the rename step's AUTHORING major (`toMajor - 1`).
 * That is the world `@objectstack/spec@17.4.0` shipped in and the card was
 * measured in. In it, the old default composes `N → N` and lists nothing,
 * while the default under test reaches the rename's step and lists all five
 * rewrites. The anti-vacuity assertion is the spawned file's own line, applied
 * to this window, where it holds in every release instead of only while the
 * live registry runs ahead.
 *
 * ⛔ The replacement is the module's two protocol constants and nothing else.
 * The registry, the conversions, the schemas and the loader are the installed
 * ones, so the five rewrites and the schema verdict are the real chain's.
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
import { MIGRATIONS_BY_MAJOR, MIGRATION_MAJORS } from '@objectstack/spec/migrations';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import MigrateMeta from '../src/commands/migrate/meta.js';

const { RENAME_CONVERSION } = vi.hoisted(() => ({
  RENAME_CONVERSION: 'dashboard-refresh-interval-to-refresh-interval-seconds',
}));

/**
 * The window: the runtime still on the major the tombstone's source was
 * authored against, with the rename's step already registered. Derived from
 * the registry, never written down. A missing step is a loud failure here,
 * because the window would otherwise be undefined.
 */
vi.mock('@objectstack/spec/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@objectstack/spec/kernel')>();
  const { MIGRATIONS_BY_MAJOR: steps } = await import('@objectstack/spec/migrations');
  const step = Object.values(steps).find((s) => s.conversionIds.includes(RENAME_CONVERSION));
  if (!step) throw new Error(`no registered migration step carries ${RENAME_CONVERSION}`);
  const major = step.toMajor - 1;
  return { ...actual, PROTOCOL_MAJOR: major, PROTOCOL_VERSION: `${major}.0.0` };
});

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const RENAME_STEP = Object.values(MIGRATIONS_BY_MAJOR).find((s) => s.conversionIds.includes(RENAME_CONVERSION))!;

/** The tombstone's `N`, and in this window also the runtime's major. */
const AUTHORED = RENAME_STEP.toMajor - 1;

/** The default under test, computed as the command computes it, in this window. */
const TERMINUS = Math.max(PROTOCOL_MAJOR, ...MIGRATION_MAJORS);

/** The spawned file's reproduction: five dashboards authoring the retired key. */
const RETIRED_KEY_CONFIG = `
export default {
  manifest: { id: 'com.example.default-range-window', name: 'Default Range Window', version: '1.0.0', type: 'app' },
  objects: [{ name: 'dw_ticket', label: 'Ticket', fields: { title: { type: 'text', label: 'Title' } } }],
  dashboards: [
    { name: 'kpi_a', label: 'KPI A', widgets: [], refreshInterval: 300 },
    { name: 'kpi_b', label: 'KPI B', widgets: [], refreshInterval: 60 },
    { name: 'kpi_c', label: 'KPI C', widgets: [], refreshInterval: 120 },
    { name: 'kpi_d', label: 'KPI D', widgets: [], refreshInterval: 900 },
    { name: 'kpi_e', label: 'KPI E', widgets: [], refreshInterval: 30 },
  ],
};
`;

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

let dir: string;
const runs = new Map<string, Promise<Run>>();

/** Run the real command in-process once per distinct invocation, capturing both streams and any exit. */
function runMeta(flags: string[]): Promise<Run> {
  const key = flags.join(' ');
  const hit = runs.get(key);
  if (hit) return hit;
  const started = (async (): Promise<Run> => {
    const out: string[] = [];
    const err: string[] = [];
    const priorExitCode = process.exitCode;
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      out.push(String(chunk));
      const done = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
      done?.();
      return true;
    }) as never);
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
    const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
    const error = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
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
    return {
      stdout: stripVTControlCharacters(out.join('\n')),
      stderr: stripVTControlCharacters(err.join('\n')),
      exitCode,
    };
  })();
  runs.set(key, started);
  return started;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-meta-default-window-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), RETIRED_KEY_CONFIG);
});

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('os migrate meta: the default --to in the window the card was found in (#17134)', () => {
  it('runs in that window: the runtime major is the tombstone\'s authoring major', () => {
    // The replacement reached the module the command reads. Without this, a
    // mock that silently missed would leave the cases below on the live major.
    expect(PROTOCOL_MAJOR).toBe(AUTHORED);
    expect(MIGRATION_MAJORS).toContain(RENAME_STEP.toMajor);
  });

  it('defaults --to to the highest major this build has a step for, not the runtime major', async () => {
    const { stdout, exitCode } = await runMeta(['--from', String(AUTHORED), '--json']);
    const parsed = JSON.parse(stdout);
    expect(exitCode).toBeUndefined();
    expect(parsed.from).toBe(AUTHORED);
    expect(parsed.to).toBe(TERMINUS);
    // ⛔ Anti-vacuity. If the terminus ever equalled PROTOCOL_MAJOR the line
    // above would hold for the very default this card exists to replace, so the
    // premise is asserted rather than assumed: this is the line that speaks up
    // when a major ships and the registry has no entry past it yet.
    expect(TERMINUS, 'the registry carries a step past the runtime major').toBeGreaterThan(PROTOCOL_MAJOR);
  }, 120_000);

  it('lists every retired-key rewrite for the tombstone\'s `--from`, with no --to given', async () => {
    const parsed = JSON.parse((await runMeta(['--from', String(AUTHORED), '--json'])).stdout);
    const renames = parsed.applied.filter((a: any) => a.conversionId === RENAME_CONVERSION);
    expect(renames.map((a: any) => a.path)).toEqual([
      'dashboards[0].refreshIntervalSeconds',
      'dashboards[1].refreshIntervalSeconds',
      'dashboards[2].refreshIntervalSeconds',
      'dashboards[3].refreshIntervalSeconds',
      'dashboards[4].refreshIntervalSeconds',
    ]);
    for (const r of renames) {
      expect(r.from).toBe('refreshInterval');
      expect(r.to).toBe('refreshIntervalSeconds');
    }
    expect(parsed.schemaValid).toBe(true);
  }, 120_000);

  it('the human run prints the rewrites instead of the canonical verdict', async () => {
    const { stdout, exitCode } = await runMeta(['--from', String(AUTHORED)]);
    expect(exitCode).toBeUndefined();
    expect(stdout).toContain('Applied 5 mechanical change(s)');
    expect(stdout).toContain(RENAME_CONVERSION);
    // ⛔ The whole sentence, never the phrase: step-18 semantic entries open a
    // `replacement` with "Nothing to migrate to, because …".
    expect(stdout).not.toContain('Nothing to migrate — the metadata is already canonical');
  }, 120_000);
});
