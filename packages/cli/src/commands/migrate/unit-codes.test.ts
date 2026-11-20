// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate unit-codes` command shape (ADR-0158 U7 R1; Open item 12, the
 * backfill half).
 *
 * The walk itself is proven in `@objectstack/objectql`'s
 * `unit-code-backfill.test.ts` and, on SQL, in `unit-codes.integration.test.ts`.
 * What is pinned here is what those cannot see: the command is dry-run-by-
 * default, `--object` and `--field` are required and `--map-file` is not (a
 * first run lists the stored values), the mapping file reaches
 * `backfillUnitCodes` as written, a file that is no JSON or a mapping the
 * engine would refuse is refused before the occupancy probe, the `--apply`
 * prompt and the boot, and the refusal of an apply run over an unmatched value
 * reaches the `--json` envelope with its code, its status and each value, exit 1.
 * The seams that would boot a database are replaced; the command's own parse
 * and control flow run for real, and the mapping judge, the formatter and the
 * refusals are the engine's own.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MigrateUnitCodes from './unit-codes.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { isExitSignal } from '../../utils/format.js';
import { backfillUnitCodes } from '@objectstack/objectql';
// Pay the first transform of the dist-resolved workspace deps the command's
// source reaches through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/service-datasource';
import '@objectstack/driver-sql';
import '@objectstack/driver-turso';
import '@objectstack/platform-objects/plugin';
import '@objectstack/service-automation';
import '@objectstack/service-storage';
import '@objectstack/plugin-security';
import '@objectstack/rest';
import '@objectstack/metadata-protocol';
import '@objectstack/metadata';
import '@objectstack/plugin-hono-server';
import '@objectstack/service-settings';
import '@objectstack/cloud-connection';

vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: vi.fn() }));
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(),
}));
vi.mock('../../utils/data-migration-plugins.js', () => ({ buildDataMigrationPlugins: vi.fn(async () => []) }));
const prompt = vi.hoisted(() => ({ opened: 0 }));
vi.mock('node:readline', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:readline')>();
  return {
    ...real,
    createInterface: (() => {
      prompt.opened++;
      return { question: (_q: string, answer: (a: string) => void) => answer('n'), close: () => {} };
    }) as unknown as typeof real.createInterface,
  };
});
vi.mock('@objectstack/objectql', async (importOriginal) => {
  const real = await importOriginal<typeof import('@objectstack/objectql')>();
  return {
    backfillUnitCodes: vi.fn(),
    formatUnitCodeBackfillReport: real.formatUnitCodeBackfillReport,
    unitCodeMappingOf: real.unitCodeMappingOf,
  };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;
const DIR = mkdtempSync(join(tmpdir(), 'os-unit-codes-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const file = (name: string, text: string): string => {
  const path = join(DIR, name);
  writeFileSync(path, text);
  return path;
};

const MATERIAL = {
  fields: {
    uom: { type: 'text' },
    weight: { type: 'number', unitConfig: { unitMode: 'record', unitField: 'uom', unitDimension: 'mass' } },
  },
};
const engine = {
  getObject: (name: string) => (name === 'material' ? MATERIAL : undefined),
  find: async () => [],
  update: async () => ({}),
  getConfigs: () => ({ material: {}, sys_user: {} }),
};

const REPORT = {
  object: 'material', organizationId: null, allOrganizations: false, field: 'uom', quantityFields: ['weight'],
  scannedRecords: 3, mapped: 2, written: 0, unmatched: 0, skippedMember: 1, skippedBlank: 0, blankBesideQuantity: 0,
  values: [
    { value: 'KGM', rows: 1, disposition: 'member' },
    { value: 'kg', rows: 2, disposition: 'mapped', code: 'KGM' },
  ],
  sampleRecordIds: ['m1', 'm2'], applied: false, truncated: false, failures: [], organizations: [],
};
const NAMING = ['--object', 'material', '--field', 'uom'];

let stdout: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(probeMigrationTarget).mockReset();
  vi.mocked(probeMigrationTarget).mockResolvedValue({ status: 'free' } as any);
  vi.mocked(bootSchemaStack).mockReset();
  vi.mocked(bootSchemaStack).mockResolvedValue({
    kernel: { getService: () => engine },
    dbLabel: 'test database',
    shutdown: vi.fn(async () => {}),
  } as any);
  vi.mocked(backfillUnitCodes).mockReset();
  vi.mocked(backfillUnitCodes).mockResolvedValue(REPORT as any);
  prompt.opened = 0;
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, enc?: unknown, cb?: unknown) => {
    const done = typeof enc === 'function' ? enc : cb;
    if (typeof done === 'function') done();
    return true;
  }) as typeof process.stdout.write);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  stdout.mockRestore();
  log.mockRestore();
});

const printed = (): string => log.mock.calls.map((c: unknown[]) => c.map(String).join(' ')).join('\n');
const jsonOut = (): any => JSON.parse(stdout.mock.calls.map((c: unknown[]) => String(c[0])).join(''));
const exitOf = (err: unknown): number | undefined => (err as { oclif?: { exit?: number } })?.oclif?.exit;

/** The real backfill's refusal of an apply run over `lbs`, which the mapping does not name. */
const unmatchedRefusal = async (): Promise<Error & Record<string, unknown>> => {
  const real = await vi.importActual<typeof import('@objectstack/objectql')>('@objectstack/objectql');
  const rows = [{ id: 'm1', uom: 'kg', weight: 1 }, { id: 'm2', uom: 'lbs', weight: 2 }];
  const walked = { ...engine, find: async (o: string, q: { where?: unknown }) => (o === 'material' && !q.where ? rows : []) };
  return real.backfillUnitCodes(walked, { info() {}, warn() {} }, {
    object: 'material', field: 'uom', mapping: { kg: 'KGM' }, apply: true,
  }).then(() => { throw new Error('expected the apply run to be refused'); }, (e: unknown) => e as Error & Record<string, unknown>);
};

describe('os migrate unit-codes', () => {
  it('is a dry run by default, --yes is opt-in, and --map-file is optional', () => {
    expect(MigrateUnitCodes.flags.apply.default).toBe(false);
    expect(MigrateUnitCodes.flags.yes.default).toBe(false);
    expect(MigrateUnitCodes.flags.object.required).toBe(true);
    expect(MigrateUnitCodes.flags.field.required).toBe(true);
    expect(MigrateUnitCodes.flags['map-file'].required).not.toBe(true);
  });

  it('refuses to run without --field', async () => {
    const err = await MigrateUnitCodes.run(['--object', 'material'], { root: CLI_ROOT }).catch((e: unknown) => e);
    expect(String((err as Error)?.message)).toMatch(/field/);
    expect(vi.mocked(backfillUnitCodes)).not.toHaveBeenCalled();
  }, RUN_TIMEOUT);

  it('a dry run with no --map-file hands no mapping to the backfill, and prints its listing', async () => {
    await MigrateUnitCodes.run(['--json', ...NAMING], { root: CLI_ROOT });
    expect(vi.mocked(backfillUnitCodes)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(backfillUnitCodes).mock.calls[0][2]).toEqual({
      object: 'material', field: 'uom', apply: false, organizationId: undefined, maxRecords: undefined,
    });
    expect(jsonOut()).toMatchObject({ apply: false, report: { mapped: 2, written: 0, values: REPORT.values } });
  }, RUN_TIMEOUT);

  it('--map-file reaches the backfill exactly as written, "" entry included; --apply --yes writes', async () => {
    const mapping = { kg: 'KGM', '公斤': 'KGM', 'kg ': 'KGM', '': 'KGM' };
    await MigrateUnitCodes.run(['--json', '--apply', '--yes', ...NAMING, '--map-file', file('units.json', JSON.stringify(mapping))], { root: CLI_ROOT });
    expect(vi.mocked(backfillUnitCodes).mock.calls[0][2]).toMatchObject({ mapping, apply: true });
  }, RUN_TIMEOUT);

  it('--org hands the organization over; --all-organizations asks for every one; both together is a usage error', async () => {
    await MigrateUnitCodes.run(['--json', ...NAMING, '--org', 'org_a'], { root: CLI_ROOT });
    expect(vi.mocked(backfillUnitCodes).mock.calls[0][2]).toMatchObject({ organizationId: 'org_a' });
    expect(vi.mocked(backfillUnitCodes).mock.calls[0][2]).not.toHaveProperty('allOrganizations');
    await MigrateUnitCodes.run(['--json', ...NAMING, '--all-organizations'], { root: CLI_ROOT });
    expect(vi.mocked(backfillUnitCodes).mock.calls[1][2]).toMatchObject({ allOrganizations: true, organizationId: undefined });
    vi.mocked(bootSchemaStack).mockClear();
    const err = await MigrateUnitCodes.run(['--json', '--apply', '--yes', ...NAMING, '--org', 'org_a', '--all-organizations'], { root: CLI_ROOT })
      .catch((e: unknown) => e);
    expect(exitOf(err)).toBe(2);
    expect(vi.mocked(bootSchemaStack)).not.toHaveBeenCalled();
  }, RUN_TIMEOUT);

  it('an object the deployment does not declare is refused before the backfill is called', async () => {
    const err = await MigrateUnitCodes.run(['--json', '--object', 'nope', '--field', 'uom'], { root: CLI_ROOT }).catch((e: unknown) => e);
    expect(exitOf(err)).toBe(1);
    expect(vi.mocked(backfillUnitCodes)).not.toHaveBeenCalled();
    expect(jsonOut()).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  }, RUN_TIMEOUT);

  describe('a mapping file that is no JSON, or a mapping the engine refuses, is refused before the probe, the prompt and the boot', () => {
    it.each([
      ['not JSON', '{ kg: KGM'],
      ['an array', '["kg"]'],
      ['a target that is no string', '{ "kg": 3 }'],
      ['a blank target', '{ "kg": " " }'],
    ])('%s: VALIDATION_ERROR / 400 on mapping, exit 1, nothing opened', async (_label, text) => {
      const wasTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      let err: unknown;
      try {
        err = await MigrateUnitCodes.run(['--json', '--apply', ...NAMING, '--map-file', file('bad.json', text)], { root: CLI_ROOT })
          .catch((e: unknown) => e);
      } finally {
        Object.defineProperty(process.stdin, 'isTTY', { value: wasTTY, configurable: true });
      }
      expect(isExitSignal(err)).toBe(true);
      expect(exitOf(err)).toBe(1);
      const payload = jsonOut();
      expect(payload).toMatchObject({ code: 'VALIDATION_ERROR', httpStatus: 400 });
      // The engine's own judge answers, never the `--apply` gate's `confirmation_required`.
      expect(payload.error).toMatch(/^\[unit-code-backfill\] /);
      expect(prompt.opened).toBe(0);
      expect(vi.mocked(probeMigrationTarget)).not.toHaveBeenCalled();
      expect(vi.mocked(bootSchemaStack)).not.toHaveBeenCalled();
      expect(vi.mocked(backfillUnitCodes)).not.toHaveBeenCalled();
    }, RUN_TIMEOUT);

    it('a valid mapping file still reaches the boot (the control)', async () => {
      await MigrateUnitCodes.run(['--json', ...NAMING, '--map-file', file('good.json', '{ "kg": "KGM" }')], { root: CLI_ROOT });
      expect(vi.mocked(probeMigrationTarget)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(bootSchemaStack)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(backfillUnitCodes)).toHaveBeenCalledTimes(1);
    }, RUN_TIMEOUT);
  });

  describe('an apply run over a value with no mapping entry', () => {
    it('--json carries the engine\'s VALIDATION_ERROR / 400 envelope and each unmatched value with its rows, exit 1', async () => {
      const refusal = await unmatchedRefusal();
      vi.mocked(backfillUnitCodes).mockRejectedValue(refusal);
      const err = await MigrateUnitCodes.run(['--json', '--apply', '--yes', ...NAMING, '--map-file', file('kg.json', '{ "kg": "KGM" }')], { root: CLI_ROOT })
        .catch((e: unknown) => e);
      expect(isExitSignal(err)).toBe(true);
      expect(exitOf(err)).toBe(1);
      expect(jsonOut()).toMatchObject({
        code: 'VALIDATION_ERROR', httpStatus: 400, error: refusal.message,
        unmatched: [{ value: 'lbs', rows: 1, disposition: 'unmatched' }],
      });
    }, RUN_TIMEOUT);

    it('the human face prints the refusal naming the value and the remedy, exit 1', async () => {
      vi.mocked(backfillUnitCodes).mockRejectedValue(await unmatchedRefusal());
      const err = await MigrateUnitCodes.run(['--apply', '--yes', ...NAMING, '--map-file', file('kg.json', '{ "kg": "KGM" }')], { root: CLI_ROOT })
        .catch((e: unknown) => e);
      expect(exitOf(err)).toBe(1);
      expect(printed()).toContain('Add each value to --map-file with its unit code');
    }, RUN_TIMEOUT);
  });

  it('the human dry run lists every stored value with its rows and what the mapping does with it', async () => {
    await MigrateUnitCodes.run(NAMING, { root: CLI_ROOT });
    const text = printed();
    expect(text).toContain('Scanned 3 row(s) of material for the unit code in uom.');
    expect(text).toContain('"kg": 2 row(s), → KGM');
    expect(text).toContain('Dry run — no row or table was written. Re-run with --apply to convert.');
    expect(text).toContain('Dry run only — 2 row(s) would be rewritten. Re-run with --apply.');
  }, RUN_TIMEOUT);
});
