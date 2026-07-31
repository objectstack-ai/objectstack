// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `announceOpenMigrationGates` against the REAL registry (ADR-0104 D1 rollout /
 * #3438, correcting #4235 and #4253).
 *
 * The announcement itself is covered in `engine.test.ts`, which mocks
 * `./registry` away. That mock is why these cases live in their own file: the
 * genuine `registerApp → registry` path INJECTS covered-type fields into every
 * object it registers, and a mocked registry hands the engine exactly the
 * fields the test wrote. The two defects pinned below are both invisible under
 * the mock and unconditional in production, so the suite that can see them has
 * to build its objects the way a deployment does.
 *
 * The risk with any such line is not silence, it is speaking where the line is
 * untrue or useless — that trains readers to ignore it. So each silent case is
 * pinned, not just the speaking one.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from './engine';
import type { IDataDriver } from '@objectstack/spec/contracts';

/** Minimal driver whose `find` serves whatever rows the test seeded. */
function makeDriver(seed: Record<string, Array<Record<string, unknown>>> = {}): IDataDriver {
  const store = new Map<string, Array<Record<string, unknown>>>(Object.entries(seed));
  return {
    name: 'default',
    version: '1.0.0',
    async connect() {},
    async disconnect() {},
    async find(object: string) { return store.get(object) ?? []; },
    async findOne() { return null; },
    async count() { return 0; },
    async create(_o: string, data: any) { return data; },
    async update(_o: string, id: string, data: any) { return { ...data, id }; },
    async delete() { return true; },
    async bulkCreate(_o: string, rows: any[]) { return rows; },
    async syncSchema() {},
    async dropTable() {},
  } as unknown as IDataDriver;
}

const COVERED = {
  name: 'contact',
  fields: {
    id: { type: 'text' },
    account: { type: 'lookup', reference: 'account' },
    geo: { type: 'location' },
  },
};

/** Declares no covered field of its own — but the registry will inject four. */
const UNCOVERED = {
  name: 'note',
  fields: { id: { type: 'text' }, body: { type: 'textarea' } },
};

/** The `sys_migration` shape the flag reader needs to find a row at all. */
const FLAG_OBJECT = {
  name: 'sys_migration',
  fields: {
    id: { type: 'text' },
    last_run_at: { type: 'datetime' },
    verified_at: { type: 'datetime' },
    blocking: { type: 'number' },
  },
};

function makeEngine(opts: {
  objects?: any[];
  flagRows?: Array<Record<string, unknown>>;
} = {}) {
  const engine = new ObjectQL();
  engine.registerDriver(
    makeDriver(opts.flagRows ? { sys_migration: opts.flagRows } : {}),
    true,
  );
  engine.registerApp({
    id: 'advisory_pkg',
    name: 'Advisory',
    objects: opts.objects ?? [COVERED, UNCOVERED],
  } as any);
  return engine;
}

/** Everything the announcement logged, as one string. */
async function announce(engine: ObjectQL): Promise<string> {
  const info = vi.spyOn((engine as any).logger, 'info');
  await engine.announceOpenMigrationGates();
  return info.mock.calls.map((c: any[]) => String(c[0])).join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OS_DATA_VALUE_SHAPE_STRICT_ENABLED;
  delete process.env.OS_ALLOW_LAX_VALUE_SHAPES;
  delete process.env.OS_ALLOW_LAX_MEDIA_VALUES;
});

describe('announceOpenMigrationGates, real registry (ADR-0104 D1 / #3438)', () => {
  it('names the command that ends warn mode on a warn-first deployment', async () => {
    expect(await announce(makeEngine())).toMatch(/os migrate value-shapes/);
  });

  it('stays silent when no object declares a covered field — the gate is moot here', async () => {
    // The regression guard for the predicate the dormancy short-circuit counts
    // with. `note` declares only text, but the REGISTRY injects
    // `organization_id` and `owner_id` (both `system`) plus `created_by` /
    // `updated_by` (both in `SKIP_FIELDS`) — four `lookup`s, a covered TYPE
    // apiece. `validateRecord` skips every one of them before it reaches the
    // value-shape check, so counting by raw type answered true for literally
    // every object that exists: the short-circuit never fired, its WeakMap
    // memoized a constant, and this line fired on every deployment there is.
    // Counting by the validator's own `isScannableValueShapeField` — the
    // predicate the scanner already imports — is what makes it mean something.
    //
    // Unreachable through `engine.test.ts`: under its registry mock `note`
    // carries the two fields written above and nothing else.
    const said = await announce(makeEngine({ objects: [UNCOVERED] }));
    expect(said).not.toMatch(/os migrate/);
  });

  it('stays silent under the all-class opt-in — "NOT enforced here" would be false', async () => {
    // `VALUE_SHAPE_STRICT()` short-circuits both `*StrictEffective` functions
    // ahead of the deployment flag, so enforcement is already on and the flag
    // this line reports on decides nothing.
    process.env.OS_DATA_VALUE_SHAPE_STRICT_ENABLED = '1';
    expect(await announce(makeEngine())).not.toMatch(/os migrate/);
  });

  it('stays silent under the value-shape escape hatch — the operator opted out on purpose', async () => {
    // Running the scan cannot change this deployment's posture, so naming it is
    // noise, not help.
    process.env.OS_ALLOW_LAX_VALUE_SHAPES = '1';
    expect(await announce(makeEngine())).not.toMatch(/os migrate value-shapes/);
  });

  it('applies each opt-out to its own class only', async () => {
    // The two opt-outs are per-class, so silencing one must not silence the
    // other. `contact` declares a `location`; `note` gets a `file` here so both
    // gates are live and exactly one is switched off.
    process.env.OS_ALLOW_LAX_MEDIA_VALUES = '1';
    const said = await announce(makeEngine({
      objects: [COVERED, { name: 'note', fields: { id: { type: 'text' }, doc: { type: 'file' } } }],
    }));
    expect(said).not.toMatch(/os migrate files-to-references/);
    expect(said).toMatch(/os migrate value-shapes/);
  });

  it('stays silent once the gate is open (verified row)', async () => {
    const said = await announce(makeEngine({
      objects: [COVERED, UNCOVERED, FLAG_OBJECT],
      flagRows: [
        {
          id: 'adr-0104-value-shapes',
          last_run_at: '2026-07-30T00:00:00.000Z',
          verified_at: '2026-07-30T00:00:00.000Z',
          blocking: 0,
        },
      ],
    }));
    expect(said).not.toMatch(/os migrate value-shapes/);
  });

  it('still speaks when a row exists but did not pass its self-check', async () => {
    // A failed run is not permission — the same "absent evidence is not
    // permission" rule the gate itself runs on, so the advice still applies.
    const said = await announce(makeEngine({
      objects: [COVERED, UNCOVERED, FLAG_OBJECT],
      flagRows: [
        {
          id: 'adr-0104-value-shapes',
          last_run_at: '2026-07-30T00:00:00.000Z',
          verified_at: null,
          blocking: 3,
        },
      ],
    }));
    expect(said).toMatch(/os migrate value-shapes/);
  });
});
