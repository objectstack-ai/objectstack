// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta` — the DEFAULT `--to`, and what an empty range is allowed to
 * claim (#17134).
 *
 * ## The defect these pin
 *
 * A `retiredKey()` tombstone closes with the house sentence "Run
 * `os migrate meta --from N` …", whose `N` is the major the source was AUTHORED
 * against — one below the `toMajor` of the ADR-0087 conversion that performs
 * the rename. That template presumes the default terminus is at least the
 * conversion's own `toMajor`, and the presumption held only after the next
 * major shipped: `@objectstack/spec@17.4.0` tombstones keys registered
 * `toMajor: 18`, so `--from 17` defaulted to `--to 17`,
 * `composeMigrationChain` (which keeps `m > fromMajor`) selected NO step, and
 * the command answered `✓ Nothing to migrate — the metadata is already
 * canonical for this range` with exit 0 — for the very conversions the
 * tombstone had just sent the author to run it for. 29 shipped tombstones
 * across 15 files prescribe that invocation.
 *
 * ## Why these are spawned rather than unit-tested
 *
 * The subject is a FLAG DEFAULT and the sentence a real terminal prints, both
 * of which live above every seam an in-process test could reach: the default
 * is resolved by oclif from the flag declaration, and the answer is chosen in
 * the human-output branch that `--json` skips entirely. The `--json` reading is
 * taken from the same spawned process for exactly one reason — `applied` is the
 * machine half of the same claim, and the pre-fix run reported
 * `applied: [], todos: [], schemaValid: false` in one breath.
 *
 * ⛔ No expectation here hard-codes 17 or 18 as the terminus. The two majors
 * move every release; what does not move is that the default terminus is the
 * highest major the installed build carries a step for, so the expectations are
 * derived from `MIGRATION_MAJORS` and `PROTOCOL_MAJOR` and stay true one major
 * later.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATION_MAJORS } from '@objectstack/spec';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { childEnv } from './helpers/serve-process.js';

const execFileP = promisify(execFile);
const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** What the command must now default `--to` to — derived, never written down. */
const TERMINUS = Math.max(PROTOCOL_MAJOR, ...MIGRATION_MAJORS);

/**
 * The card's reproduction: a stack on the installed line authoring the
 * tombstoned `dashboard.refreshInterval` five times. Five rather than one so an
 * assertion cannot pass on a single incidental rewrite.
 */
const RETIRED_KEY_CONFIG = `
export default {
  manifest: { id: 'default_range_repro', name: 'Default Range Repro', version: '1.0.0', type: 'app' },
  objects: [{ name: 'dr_ticket', label: 'Ticket', fields: { title: { type: 'text', label: 'Title' } } }],
  dashboards: [
    { name: 'kpi_a', label: 'KPI A', widgets: [], refreshInterval: 300 },
    { name: 'kpi_b', label: 'KPI B', widgets: [], refreshInterval: 60 },
    { name: 'kpi_c', label: 'KPI C', widgets: [], refreshInterval: 120 },
    { name: 'kpi_d', label: 'KPI D', widgets: [], refreshInterval: 900 },
    { name: 'kpi_e', label: 'KPI E', widgets: [], refreshInterval: 30 },
  ],
};
`;

/** The same stack already canonical — the anti-vacuity control. */
const CANONICAL_CONFIG = `
export default {
  manifest: { id: 'default_range_canon', name: 'Default Range Canon', version: '1.0.0', type: 'app' },
  objects: [{ name: 'dr_thing', label: 'Thing', fields: { title: { type: 'text', label: 'Title' } } }],
  dashboards: [{ name: 'kpi_a', label: 'KPI A', widgets: [], refreshIntervalSeconds: 300 }],
};
`;

const RENAME_CONVERSION = 'dashboard-refresh-interval-to-refresh-interval-seconds';

let retiredDir: string;
let canonicalDir: string;

/** Spawn the real CLI; returns stdout AND the exit code, which is half the claim. */
async function runMeta(args: string[], cwd: string): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await execFileP(TSX, [CLI, 'migrate', 'meta', ...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      env: childEnv({ NO_COLOR: '1' }),
    });
    return { stdout, code: 0 };
  } catch (error: any) {
    return { stdout: String(error.stdout ?? ''), code: Number(error.code ?? 1) };
  }
}

beforeAll(() => {
  retiredDir = mkdtempSync(join(tmpdir(), 'os-meta-default-range-'));
  writeFileSync(join(retiredDir, 'objectstack.config.ts'), RETIRED_KEY_CONFIG);
  canonicalDir = mkdtempSync(join(tmpdir(), 'os-meta-default-canon-'));
  writeFileSync(join(canonicalDir, 'objectstack.config.ts'), CANONICAL_CONFIG);
});

afterAll(() => {
  for (const d of [retiredDir, canonicalDir]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('os migrate meta — the invocation the tombstones prescribe (#17134)', () => {
  it('defaults --to to the highest major this build has a step for, not the runtime major', async () => {
    const { stdout, code } = await runMeta(['--from', PROTOCOL_MAJOR.toString(), '--json'], canonicalDir);
    const parsed = JSON.parse(stdout);
    expect(code).toBe(0);
    expect(parsed.from).toBe(PROTOCOL_MAJOR);
    expect(parsed.to).toBe(TERMINUS);
    // ⛔ Anti-vacuity: if the terminus ever equalled PROTOCOL_MAJOR the line
    // above would hold for the very default this card exists to replace, so the
    // premise is asserted rather than assumed. When a major ships and the
    // registry has no entries beyond it yet, this is the line that says so.
    expect(TERMINUS, 'the registry carries a step past the runtime major').toBeGreaterThan(PROTOCOL_MAJOR);
  }, 120_000);

  it('lists every retired-key rewrite for `--from <runtime major>` with no --to at all', async () => {
    const { stdout, code } = await runMeta(['--from', PROTOCOL_MAJOR.toString(), '--json'], retiredDir);
    const parsed = JSON.parse(stdout);
    expect(code).toBe(0);

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
    // The command's own success criterion, unreachable before this fix: the
    // stack the author is asked to adopt parses under the installed schema.
    expect(parsed.schemaValid).toBe(true);
  }, 120_000);

  it('the human run prints the rewrites instead of `Nothing to migrate`', async () => {
    const { stdout, code } = await runMeta(['--from', PROTOCOL_MAJOR.toString()], retiredDir);
    expect(code).toBe(0);
    expect(stdout).toContain('Applied 5 mechanical change(s)');
    expect(stdout).toContain(RENAME_CONVERSION);
    expect(stdout).not.toContain('Nothing to migrate');
  }, 120_000);
});

describe('os migrate meta — an empty range answers as an empty range (#17134)', () => {
  /**
   * The pre-fix default, now only reachable by typing it. The command is right
   * that this range holds no conversion; what it may not do is convert that
   * into a verdict about the metadata.
   */
  it('refuses to call an un-migrated stack canonical when the range holds no step', async () => {
    const major = PROTOCOL_MAJOR.toString();
    const { stdout, code } = await runMeta(['--from', major, '--to', major], retiredDir);

    expect(stdout).not.toContain('already canonical');
    expect(stdout).toContain(`No migration step exists for protocol ${major} → ${major}`);
    // Triage's requirement: name the range that WOULD list them.
    expect(stdout).toContain(`--to ${TERMINUS}`);
    expect(stdout).toContain(`Protocol ${major} → ${TERMINUS} has 5 mechanical`);
    // ⛔ The exit code is deliberately unchanged — this command reports
    // findings rather than exiting on them, exactly as the schema-invalid path
    // beside it always has. What changed is that the text no longer reads as
    // success while it does so.
    expect(code).toBe(0);
  }, 120_000);

  it('no longer returns past the schema verdict that contradicts it', async () => {
    const major = PROTOCOL_MAJOR.toString();
    const { stdout } = await runMeta(['--from', major, '--to', major], retiredDir);
    // Before the fix this line was unreachable: the zero-change branch returned
    // first, so the same run could report `schemaValid: false` in `--json` while
    // the human output stopped at "already canonical".
    expect(stdout).toContain('does not pass schema validation');
    expect(stdout).toContain('replayed no conversion');
  }, 120_000);

  it('still says `Nothing to migrate` for a range that HAS steps and rewrote nothing', async () => {
    // ⛔ The success sentence is not collateral damage: a range holding real
    // steps that matched nothing is a finding about the metadata and keeps the
    // answer every published acceptance check greps for. `13 → 14` is chosen
    // because step 14 carries no semantic entries, so a canonical stack comes
    // back with both lists empty.
    const { stdout, code } = await runMeta(['--from', '13', '--to', '14'], canonicalDir);
    expect(code).toBe(0);
    expect(stdout).toContain('Nothing to migrate');
    expect(stdout).toContain('Migrated stack is schema-valid');
  }, 120_000);
});
