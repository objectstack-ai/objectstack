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
 * canonical for this range` at exit 0 — for the very conversions the tombstone
 * had just sent the author to run it for. 29 shipped tombstones across 15
 * source files prescribe that invocation.
 *
 * ⚠️ The sharp half is that an empty chain makes the answer UNFALSIFIABLE:
 * with no step selected, `applied` and `todos` are empty for every input, so
 * that invocation at the installed major could not have reported anything
 * else, for any stack, ever.
 *
 * ## Why these spawn, and why the file is QUEUE tier rather than `.e2e`
 *
 * The subject is a FLAG DEFAULT and the sentence a real terminal prints, both
 * of which live above every seam an in-process test could reach: the default is
 * resolved by oclif from the flag declaration, and the answer is chosen in the
 * human-output branch `--json` skips entirely. So the CLI is spawned — but the
 * file deliberately does NOT carry the `.e2e` name, because that name selects
 * the NIGHTLY population (`vitest-tiers.ts` → "The NIGHTLY tiers"), and a p1
 * whose only pin runs nightly is not protected by the merge queue's required
 * set. The tier header sanctions exactly this combination: the name decides the
 * run and the behaviour decides the project, so this is queue-tier by name and
 * `integration` by behaviour. Cost is held down by running each distinct
 * invocation once and sharing it across the assertions that read it.
 *
 * ⛔ No expectation here hard-codes 17 or 18. Both majors move every release;
 * what does not move is that the default terminus is the highest major the
 * installed build carries a step for, so every expectation is derived from
 * `MIGRATION_MAJORS` and `PROTOCOL_MAJOR` and stays true one major later.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS_BY_MAJOR, MIGRATION_MAJORS, MIGRATION_SUPPORT_FLOOR } from '@objectstack/spec';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { childEnv } from './helpers/serve-process.js';

const execFileP = promisify(execFile);
const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** What the command must now default `--to` to — derived, never written down. */
const TERMINUS = Math.max(PROTOCOL_MAJOR, ...MIGRATION_MAJORS);
const INSTALLED = String(PROTOCOL_MAJOR);

/**
 * The card's reproduction: a stack on the installed line authoring the
 * tombstoned `dashboard.refreshInterval` five times. Five rather than one so no
 * assertion can pass on a single incidental rewrite.
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

/** The same shape already canonical — the control every "it fired" line needs. */
const CANONICAL_CONFIG = `
export default {
  manifest: { id: 'default_range_canon', name: 'Default Range Canon', version: '1.0.0', type: 'app' },
  objects: [{ name: 'dr_thing', label: 'Thing', fields: { title: { type: 'text', label: 'Title' } } }],
  dashboards: [{ name: 'kpi_a', label: 'KPI A', widgets: [], refreshIntervalSeconds: 300 }],
};
`;

const RENAME_CONVERSION = 'dashboard-refresh-interval-to-refresh-interval-seconds';

interface Run { stdout: string; code: number }

let retiredDir: string;
let canonicalDir: string;
const runs = new Map<string, Promise<Run>>();

/**
 * Spawn the real CLI once per distinct invocation. The exit code is returned
 * beside stdout because it is half of what "reads as success" meant here.
 */
function runMeta(args: string[], cwd: string): Promise<Run> {
  const key = `${cwd}::${args.join(' ')}`;
  const hit = runs.get(key);
  if (hit) return hit;
  const started = execFileP(TSX, [CLI, 'migrate', 'meta', ...args], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    env: childEnv({ NO_COLOR: '1' }),
  }).then(
    ({ stdout }) => ({ stdout, code: 0 }),
    (error: any) => ({ stdout: String(error.stdout ?? ''), code: Number(error.code ?? 1) }),
  );
  runs.set(key, started);
  return started;
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
    const { stdout, code } = await runMeta(['--from', INSTALLED, '--json'], retiredDir);
    const parsed = JSON.parse(stdout);
    expect(code).toBe(0);
    expect(parsed.from).toBe(PROTOCOL_MAJOR);
    expect(parsed.to).toBe(TERMINUS);
    // ⛔ Anti-vacuity. If the terminus ever equalled PROTOCOL_MAJOR the line
    // above would hold for the very default this card exists to replace, so the
    // premise is asserted rather than assumed: this is the line that speaks up
    // when a major ships and the registry has no entry past it yet.
    expect(TERMINUS, 'the registry carries a step past the runtime major').toBeGreaterThan(PROTOCOL_MAJOR);
  }, 120_000);

  it('lists every retired-key rewrite with no --to given at all', async () => {
    const { stdout } = await runMeta(['--from', INSTALLED, '--json'], retiredDir);
    const parsed = JSON.parse(stdout);

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
    // stack the author is asked to adopt parses under the INSTALLED schema.
    // Pre-fix this same run reported `applied: [], schemaValid: false`.
    expect(parsed.schemaValid).toBe(true);
  }, 120_000);

  it('the human run prints the rewrites instead of `Nothing to migrate`', async () => {
    const { stdout, code } = await runMeta(['--from', INSTALLED], retiredDir);
    expect(code).toBe(0);
    expect(stdout).toContain('Applied 5 mechanical change(s)');
    expect(stdout).toContain(RENAME_CONVERSION);
    // ⛔ The whole sentence, never the phrase. Two step-18 semantic entries open
    // their `replacement` with "Nothing to migrate to, because …", so a bare
    // `not.toContain('Nothing to migrate')` fails on prose that is not this
    // command's verdict at all — and, run the other way round, a grep for the
    // phrase reports the verdict present on a run that never printed it. That
    // collision is why the published acceptance check this PR corrects reads
    // `applied` from `--json` instead of grepping the headline.
    expect(stdout).not.toContain('Nothing to migrate — the metadata is already canonical');
  }, 120_000);
});

describe('os migrate meta — an empty range answers as an empty range (#17134)', () => {
  /**
   * The pre-fix default, now reachable only by typing it. The command is right
   * that this range holds no conversion; what it may not do is turn that into a
   * verdict about the metadata.
   */
  it('refuses to call an un-migrated stack canonical when the range holds no step', async () => {
    const { stdout, code } = await runMeta(['--from', INSTALLED, '--to', INSTALLED], retiredDir);

    expect(stdout).not.toContain('already canonical');
    expect(stdout).toContain(`No migration step exists for protocol ${INSTALLED} → ${INSTALLED}`);
    // Triage's requirement: name the range that WOULD list them.
    expect(stdout).toContain(`--to ${TERMINUS}`);
    expect(stdout).toContain(`Protocol ${INSTALLED} → ${TERMINUS} has 5 mechanical`);
    // ⛔ The exit code is deliberately unchanged. This command reports findings
    // rather than exiting on them — its schema-invalid arm beside this one has
    // always been a warning at exit 0. What changed is that the text no longer
    // reads as success while it does so.
    expect(code).toBe(0);
  }, 120_000);

  it('no longer returns past the schema verdict that contradicts it', async () => {
    const { stdout } = await runMeta(['--from', INSTALLED, '--to', INSTALLED], retiredDir);
    // Unreachable before the fix: the zero-change branch returned first, so the
    // same run could report `schemaValid: false` in `--json` while the human
    // output claimed the metadata was canonical and stopped.
    expect(stdout).toContain('does not pass schema validation');
    expect(stdout).toContain('replayed no conversion');
  }, 120_000);

  /**
   * ⚠️ #19056 did not change this behaviour — it removed every INPUT that can
   * reach it, and the honest pin is that reason rather than a re-pointed number.
   *
   * The success sentence needs `applied` AND `todos` empty over a NON-empty
   * chain. `applyMetaMigrations` surfaces a step's whole `semantic` list as
   * todos on every hop it replays, whatever the stack holds, so an empty
   * `todos` needs a hop whose own `semantic` list is empty. `13 → 14` was that
   * hop: step 14 carried none. Raising `MIGRATION_SUPPORT_FLOOR` to 16 retired
   * steps 11–16, and both hops the chain still reaches carry semantic entries —
   * so on this build no `--from` / `--to` reaches the sentence at all. Measured:
   * `--from 16 --to 17` on the canonical stack prints 77 manual changes and
   * `Migrated stack is schema-valid` at exit 0.
   *
   * ⛔ Re-pointing `13` to `16` would NOT have pinned this behaviour — it would
   * have pinned the OTHER branch of the same `if` under this branch's name,
   * which is the failure this whole describe block exists to stop. So the
   * spawned case is selected by the registry instead: it revives by itself the
   * day a reachable hop ships with no semantic residue, and the case below it
   * pins what IS reachable today.
   *
   * WHAT WAS LOST, named: while no reachable hop is semantic-free, nothing
   * spawns the CLI over the success sentence. The branch is still covered
   * in-process (`printSuccess` is chosen by `applied.length === 0 &&
   * todos.length === 0 && hops.length > 0`), but not end to end from a real
   * terminal.
   */
  const SEMANTIC_FREE_HOP = MIGRATION_MAJORS.find(
    (m) => m - 1 >= MIGRATION_SUPPORT_FLOOR && MIGRATIONS_BY_MAJOR[m]!.semantic.length === 0,
  );

  it('states which world we are in — whether any reachable hop is semantic-free', () => {
    // Anti-vacuity for the two cases below: both are selected by
    // SEMANTIC_FREE_HOP, so a registry that could not answer the question would
    // silently turn the spawned case off and leave nothing in its place.
    expect(MIGRATION_MAJORS.length).toBeGreaterThan(0);
    const reachable = MIGRATION_MAJORS.filter((m) => m - 1 >= MIGRATION_SUPPORT_FLOOR);
    expect(reachable.length).toBeGreaterThan(0);
    for (const m of reachable) expect(MIGRATIONS_BY_MAJOR[m]).toBeDefined();

    if (SEMANTIC_FREE_HOP === undefined) {
      // The #19056 world: every hop the floor still reaches carries semantic
      // entries, so the success sentence has no input. This is the assertion
      // that makes the skip below a measurement instead of a hole.
      expect(reachable.map((m) => MIGRATIONS_BY_MAJOR[m]!.semantic.length)).not.toContain(0);
    } else {
      expect(MIGRATIONS_BY_MAJOR[SEMANTIC_FREE_HOP]!.semantic).toHaveLength(0);
      expect(SEMANTIC_FREE_HOP - 1).toBeGreaterThanOrEqual(MIGRATION_SUPPORT_FLOOR);
    }
  });

  it.skipIf(SEMANTIC_FREE_HOP === undefined)(
    'still says `Nothing to migrate` for a range that HAS steps and rewrote nothing',
    async () => {
      // ⛔ The success sentence is not collateral damage: a range holding real
      // steps that matched nothing is a finding about the metadata, and it keeps
      // the answer published acceptance checks grep for.
      const hop = SEMANTIC_FREE_HOP!;
      const { stdout, code } = await runMeta(['--from', String(hop - 1), '--to', String(hop)], canonicalDir);
      expect(code).toBe(0);
      expect(stdout).toContain('Nothing to migrate');
      expect(stdout).toContain('Migrated stack is schema-valid');
    },
    120_000,
  );

  it('a canonical stack over the oldest SUPPORTED range is not answered as an empty range', async () => {
    // What is reachable now, and the half #17134 is actually about: the oldest
    // range the floor still admits HAS a step, so the empty-range warning must
    // not appear, the run must still reach its schema verdict, and it must not
    // claim canonicality it did not check. Derived from the registry, so the
    // next floor move re-points this instead of inviting another delete.
    const from = String(MIGRATION_SUPPORT_FLOOR);
    const to = String(MIGRATION_MAJORS.find((m) => m > MIGRATION_SUPPORT_FLOOR)!);
    const { stdout, code } = await runMeta(['--from', from, '--to', to], canonicalDir);

    expect(code).toBe(0);
    // The chain really ran — without this the three negatives below all hold
    // on a run that did nothing at all.
    expect(stdout).toContain('manual change(s) require your judgment');
    expect(stdout).toContain('Migrated stack is schema-valid');
    expect(stdout).not.toContain(`No migration step exists for protocol ${from} → ${to}`);
    // ⛔ The whole sentence, never the phrase — step-18 semantic entries open a
    // `replacement` with "Nothing to migrate to, because …" (see the sibling
    // case above), so the bare phrase collides with prose this command prints.
    expect(stdout).not.toContain('Nothing to migrate — the metadata is already canonical for this range');
  }, 120_000);
});
