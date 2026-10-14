// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta --stored` — what the closing line says about the rows the
 * pass could not rewrite (#23391).
 *
 * It used to tell the operator every such row "keeps reading canonically
 * through the chain, so nothing is broken". Two of the stored pass's four
 * failed kinds break that claim. A stored body that is not valid JSON does not
 * load at all. A flow that does not canonicalize is refused by the engine at
 * boot as well: `AutomationEngine.registerFlow` runs the same `canonicalizeFlow`
 * parse the pass ran, so the flow is not registered and does not run. What
 * holds for all four is that the pass wrote nothing, so each row reads as it did
 * before the run.
 *
 * Pinned through the command's human output. The boot is replaced, so no
 * database is opened. The command's own control flow runs for real, as does
 * the real `formatStoredMigrationReport`. The control is a failed row that is
 * not a flow: it gets the line every failed kind shares, with no flow sentence.
 * The mixed case pins that the sentence follows the rows actually present.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import MigrateMeta from '../src/commands/migrate/meta.js';

const boot = vi.hoisted(() => vi.fn());
vi.mock('../src/utils/schema-migrate.js', () => ({ bootSchemaStack: boot }));
vi.mock('../src/utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(async () => ({ status: 'free' })),
}));
vi.mock('../src/utils/data-migration-plugins.js', () => ({ buildDataMigrationPlugins: vi.fn(async () => []) }));

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

const SHARED = 'Each stays as stored, and reads as it did before this run, until the reason printed beside it is fixed.';
const NOT_JSON = 'a row whose stored body is not valid JSON does not load at all';
const FLOW_REFUSED =
  'a flow whose reason says it does not canonicalize is refused by the engine at boot as well, '
  + 'so it is not registered and does not run';
/** The claim this card retired: false for a flow the engine refuses and for a body that is not JSON. */
const RETIRED_CLAIM = 'nothing is broken';

/** A failed row as `migrateStoredMetadata` reports it; `reason` is the producer's own text. */
function failedRow(type: string, name: string, reason: string) {
  return {
    id: `meta_${name}`,
    type,
    name,
    organizationId: null,
    packageId: null,
    state: 'active' as const,
    outcome: 'failed' as const,
    notices: [],
    todos: [],
    reason,
  };
}

const FLOW_ROW = failedRow(
  'flow',
  'approve_order',
  'the flow does not canonicalize: Unrecognized key(s) on this flow: `bogus_key`.',
);
const VIEW_ROW = failedRow(
  'view',
  'open_cases',
  "the stored body is not valid JSON (Expected property name or '}' in JSON at position 2 (line 1 column 3))",
);

function reportOf(rows: ReturnType<typeof failedRow>[], apply = false) {
  return {
    apply,
    protocol: '18.0.0',
    scanned: rows.length + 1,
    canonical: 1,
    pending: 0,
    rewritten: 0,
    skipped: 0,
    failed: rows.length,
    rows,
    decisionModeReview: [],
  };
}

const migrateStoredMetadata = vi.fn();
let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  migrateStoredMetadata.mockReset();
  boot.mockReset();
  boot.mockResolvedValue({
    kernel: { getService: (name: string) => (name === 'protocol' ? { migrateStoredMetadata } : undefined) },
    dbLabel: 'file:test.db',
    tableAbsent: () => false,
    shutdown: vi.fn(async () => {}),
  });
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  stdout.mockRestore();
  stderr.mockRestore();
  log.mockRestore();
});

/** Run the command over `report`; the printed lines, colour stripped, and the exit code it raised. */
async function run(argv: string[], report: ReturnType<typeof reportOf>) {
  migrateStoredMetadata.mockResolvedValue(report);
  let exit: number | undefined;
  try {
    await MigrateMeta.run(argv, { root: CLI_ROOT });
  } catch (error: any) {
    exit = error?.oclif?.exit;
    if (exit === undefined) throw error;
  }
  const lines = log.mock.calls
    .map((call: unknown[]) => stripVTControlCharacters(call.map(String).join(' ')))
    .join('\n')
    .split('\n');
  const summary = lines.filter((line: string) => line.includes('could not be rewritten.'));
  return { exit, summary };
}

describe('os migrate meta --stored — the failed line says what holds for each failed kind (#23391)', () => {
  it('a failed flow row: the engine refuses it at boot too, so it is not registered; "nothing is broken" is gone', async () => {
    const { exit, summary } = await run(['--stored'], reportOf([FLOW_ROW]));

    expect(exit).toBe(1);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toContain(`✗ 1 row(s) could not be rewritten. ${SHARED}`);
    expect(summary[0]).toContain(FLOW_REFUSED);
    expect(summary[0]).not.toContain(RETIRED_CLAIM);
  }, RUN_TIMEOUT);

  it('control: a failed row that is not a flow gets the shared line and the JSON sentence, with no flow sentence', async () => {
    const { exit, summary } = await run(['--stored'], reportOf([VIEW_ROW]));

    expect(exit).toBe(1);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toContain(`✗ 1 row(s) could not be rewritten. ${SHARED}`);
    expect(summary[0]).toContain(`That does not mean it works: ${NOT_JSON}.`);
    expect(summary[0]).not.toContain('a flow whose reason');
    expect(summary[0]).not.toContain(RETIRED_CLAIM);
  }, RUN_TIMEOUT);

  it('mixed, on --apply: one line, both sentences, counting every failed row', async () => {
    const { exit, summary } = await run(['--stored', '--apply', '--yes'], reportOf([VIEW_ROW, FLOW_ROW], true));

    expect(exit).toBe(1);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toContain(`✗ 2 row(s) could not be rewritten. ${SHARED}`);
    expect(summary[0]).toContain(`That does not mean it works: ${NOT_JSON}, and ${FLOW_REFUSED}.`);
    expect(summary[0]).not.toContain(RETIRED_CLAIM);
  }, RUN_TIMEOUT);
});
