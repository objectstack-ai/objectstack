// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16488 — a composite `externalId`'s NUL joiner must never reach a diagnostic.
 *
 * ## The ruling this file protects on BOTH sides
 *
 * `SeedLoaderService.externalIdKey()` joins a COMPOSITE key's parts with
 * `\u0000` deliberately. Its own comment is the ruling, quoted here verbatim
 * because half of this file exists to keep it true:
 *
 * > joins the per-field values with a separator (`\u0000`) that cannot occur
 * > in a natural-key value, so `('a', 'b')` and `('a\0b', '')` never collide.
 *
 * That is correct for the KEY, and the key does not change by one character.
 * What was wrong is that the SAME string was interpolated into human-readable
 * diagnostics — the `(label=value)` parenthetical of `Failed to write ...`, and
 * pass 2's `on record '...'` lines — so one failing composite-keyed row put a
 * raw NUL byte into the server log. One such byte makes `grep` classify the
 * WHOLE log as binary, so every later `grep -n` / `grep -c` over it silently
 * returns nothing until the reader remembers `-a`: a single byte disables the
 * reader's main instrument at exactly the moment someone is diagnosing a
 * failed boot.
 *
 * Source reading: objectstack-ai/ats#20 — measured there, filed here.
 *
 * ## Why the assertion counts BYTES and not a substring
 *
 * An assertion that the message "contains `employer+user`" passes while the NUL
 * is still sitting in it — the label side always had its `+` rendering. So
 * every diagnostic assertion here counts occurrences of U+0000 and demands
 * ZERO, and {@link nulCount} is proved able to answer non-zero on a control
 * string in the same file (section 4) so a silently-broken counter cannot green
 * the whole suite.
 *
 * ## The two negative controls (sections 3 and 4)
 *
 * 1. A SINGLE-key diagnostic line is byte-identical to what it has always been
 *    — pinned as a whole-string `toBe`, not a `toContain`.
 * 2. Map-key behaviour is untouched: `('a','b')` and `('a\0b','')` still do
 *    not collide, and a pair that WOULD collide under a visible `+` joiner still
 *    dedupes as two distinct rows across a replay. Swapping the NUL for `+` in
 *    the key to make the log prettier is the one fix this card forbids, and
 *    section 4 goes red on it.
 */
import { describe, expect, it, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import {
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
  assertEngineFindOnePredicate,
  type EngineFindOneQueryInput,
} from '@objectstack/metadata-core';

// ---------------------------------------------------------------------------
// Byte instrumentation
// ---------------------------------------------------------------------------

/**
 * U+0000, written as an ESCAPE. Never a raw byte in a source file — that is
 * `check:nul-bytes`' whole subject, and it is the same byte this card keeps out
 * of the log.
 */
const NUL = '\u0000';

/** Occurrences of U+0000 in `text`. The card's assertion is that this is 0. */
function nulCount(text: string): number {
  return text.split(NUL).length - 1;
}

/** Every diagnostic string one load produced: the payload half and the log half. */
function diagnostics(
  result: { errors: Array<{ message: string }> },
  logger: { error: { mock: { calls: unknown[][] } } },
): string[] {
  return [
    ...result.errors.map((e) => e.message),
    ...logger.error.mock.calls.map((call) => String(call[0])),
  ];
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** The withheld tail a driver fault gets — `WITHHELD_WRITE_REASON` in the loader. */
const WITHHELD = 'the data engine rejected the write; the reason is in the server log';

function createMetadata(objects: Record<string, unknown>): IMetadataService {
  return {
    getObject: vi.fn(async (name: string) => objects[name]),
    listObjects: vi.fn(async () => Object.values(objects)),
    register: vi.fn(async () => {}),
  } as unknown as IMetadataService;
}

/** An engine whose every write fails with a bare (non-quotable) driver fault. */
function failingEngine(): IDataEngine {
  const fault = () => new Error('boom');
  return {
    find: vi.fn(async () => []),
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => {
      assertEngineFindOnePredicate(object, query);
      return null;
    }),
    insert: vi.fn(async () => { throw fault(); }),
    update: vi.fn(async (_o: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      throw fault();
    }),
    delete: vi.fn(async (_o: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 1 };
    }),
    count: vi.fn(async () => 0),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;
}

/**
 * A faithful in-memory engine (filters `where`, mints ids) — the same shape
 * `seed-loader-composite-external-id.test.ts` uses, because a mock that ignores
 * `where` returns the whole table and would mask replay/dedupe behaviour.
 */
function createFaithfulEngine(): { engine: IDataEngine; store: Record<string, any[]> } {
  const store: Record<string, any[]> = {};
  let idCounter = 0;

  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      let records = store[objectName] || [];
      if (query?.where) {
        records = records.filter((r) =>
          Object.entries(query.where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return r[k] === v;
          }),
        );
      }
      if (typeof query?.limit === 'number') records = records.slice(0, query.limit);
      return records;
    }),
    findOne: vi.fn(async (objectName: string, query?: any) => {
      assertEngineFindOnePredicate(objectName, query);
      const rows = await (engine.find as any)(objectName, { ...query, limit: 1 });
      return rows[0] ?? null;
    }),
    insert: vi.fn(async (objectName: string, data: any) => {
      if (!store[objectName]) store[objectName] = [];
      if (Array.isArray(data)) {
        const records = data.map((d) => ({ id: `gen-${++idCounter}`, ...d }));
        store[objectName].push(...records);
        return records;
      }
      const record = { id: `gen-${++idCounter}`, ...data };
      store[objectName].push(record);
      return record;
    }),
    update: vi.fn(async (objectName: string, data: any) => {
      assertEngineUpdateDispatch(data, undefined);
      const records = store[objectName] || [];
      const idx = records.findIndex((r) => r.id === data.id);
      if (idx >= 0) {
        records[idx] = { ...records[idx], ...data };
        return records[idx];
      }
      return data;
    }),
    delete: vi.fn(async (_objectName: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 1 };
    }),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;

  return { engine, store };
}

const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

// The card's own row: a join table keyed by (employer, user), values shaped
// like the ones that produced the reported log line.
const EMPLOYER = 'ats_employer-1788753956811-1';
const USER = 'usr_ats_quillstone_admin';

const MEMBER_OBJECTS = {
  ats_employer_member: {
    name: 'ats_employer_member',
    fields: { employer: { type: 'text' }, user: { type: 'text' }, role: { type: 'text' } },
  },
};

const MEMBER_SEED = [{
  object: 'ats_employer_member',
  externalId: ['employer', 'user'],
  mode: 'upsert',
  env: ['prod', 'dev', 'test'],
  records: [{ employer: EMPLOYER, user: USER, role: 'admin' }],
}];

async function loadMemberFailure() {
  const logger = createLogger();
  const svc = new SeedLoaderService(failingEngine(), createMetadata(MEMBER_OBJECTS), logger as never);
  const result = await svc.load({ seeds: MEMBER_SEED, config: CONFIG } as never);
  return { result, logger };
}

// ===========================================================================
// 1. THE CARD — the per-record write failure carries ZERO NUL bytes
// ===========================================================================

describe('[#16488] a composite externalId never puts a raw NUL in a seed diagnostic', () => {
  it('the `Failed to write` line — payload AND log — contains U+0000 zero times', async () => {
    const { result, logger } = await loadMemberFailure();

    expect(result.success).toBe(false);
    const lines = diagnostics(result as never, logger as never);
    // Anti-vacuity: the scenario really did produce the diagnostic under test.
    expect(lines.some((l) => l.includes('Failed to write ats_employer_member record #0'))).toBe(true);

    // THE assertion of this card, on BYTES.
    for (const line of lines) expect(nulCount(line)).toBe(0);
  });

  it('renders both key parts visibly, so the line is readable and not merely NUL-stripped', async () => {
    const { result } = await loadMemberFailure();

    const message = result.errors[0].message;
    // The FIELD-name side is unchanged: `externalIdLabel` has always joined with `+`.
    expect(message).toContain('(employer+user=');
    // The VALUE side now renders as a JSON array of the parts — unambiguous
    // even when a value itself contains the ` + ` the label side uses.
    expect(message).toBe(
      'Failed to write ats_employer_member record #0 ' +
        `(employer+user=${JSON.stringify([EMPLOYER, USER])}): ${WITHHELD}`,
    );
  });

  it('the structured payload keeps the real key — the rendering is for humans only', async () => {
    const { result } = await loadMemberFailure();

    // `attemptedValue` is the record's EXTERNAL key ("which row") — a datum a
    // machine reads, not prose. It keeps the NUL-joined key verbatim; only the
    // message is rendered. A consumer that serialises it (JSON, util.inspect)
    // escapes the control character rather than emitting the byte.
    expect(result.errors[0].attemptedValue).toBe(`${EMPLOYER}${NUL}${USER}`);
    expect(JSON.stringify(result.errors[0].attemptedValue)).not.toContain(NUL);
  });
});

// ===========================================================================
// 2. THE WIDER SURFACE — pass 2's `on record '...'` lines are the same defect
// ===========================================================================

describe('[#16488] pass-2 deferred-reference diagnostics name the record NUL-free', () => {
  it('the UNRESOLVED-after-pass-2 line carries zero NUL bytes and names both parts', async () => {
    // `mate` points at a `demo_other` row that is never seeded, so pass 1
    // defers the reference and pass 2 reports it permanently unresolved —
    // naming the source row by its (composite) natural key.
    const objects = {
      demo_link: {
        name: 'demo_link',
        fields: {
          a: { type: 'text' },
          b: { type: 'text' },
          mate: { type: 'lookup', reference: 'demo_other' },
        },
      },
      demo_other: { name: 'demo_other', fields: { name: { type: 'text' } } },
    };
    const seeds = [{
      object: 'demo_link',
      externalId: ['a', 'b'],
      mode: 'upsert',
      env: ['prod', 'dev', 'test'],
      records: [{ a: EMPLOYER, b: USER, mate: 'ghost' }],
    }];

    const logger = createLogger();
    const { engine } = createFaithfulEngine();
    const result = await new SeedLoaderService(engine, createMetadata(objects), logger as never)
      .load({ seeds, config: CONFIG } as never);

    const lines = diagnostics(result as never, logger as never);
    // Anti-vacuity: the pass-2 diagnostic really fired.
    const unresolved = lines.filter((l) => l.includes('UNRESOLVED after pass 2'));
    expect(unresolved.length).toBeGreaterThan(0);
    // It still names the row — by a rendering, not by the map key.
    expect(unresolved[0]).toContain(JSON.stringify([EMPLOYER, USER]));

    for (const line of lines) expect(nulCount(line)).toBe(0);
  });
});

// ===========================================================================
// 3. NEGATIVE CONTROL A — a SINGLE-key diagnostic is byte-identical
// ===========================================================================

describe('[#16488] negative control: a non-composite externalId diagnostic does not move', () => {
  it('pins the whole message, byte for byte', async () => {
    const objects = { demo_solo: { name: 'demo_solo', fields: { name: { type: 'text' }, plan: { type: 'text' } } } };
    const seeds = [{
      object: 'demo_solo',
      externalId: 'name',
      mode: 'upsert',
      env: ['prod', 'dev', 'test'],
      records: [{ name: 'acme', plan: 'pro' }],
    }];

    const logger = createLogger();
    const svc = new SeedLoaderService(failingEngine(), createMetadata(objects), logger as never);
    const result = await svc.load({ seeds, config: CONFIG } as never);

    // `toBe`, not `toContain`: "byte-identical" is the claim, so the whole
    // string is the assertion. A single-field key never contains U+0000, so the
    // renderer returns it unchanged and this line reads exactly as it always did.
    expect(result.errors[0].message).toBe(
      `Failed to write demo_solo record #0 (name=acme): ${WITHHELD}`,
    );
    expect(result.errors[0].attemptedValue).toBe('acme');
  });
});

// ===========================================================================
// 4. NEGATIVE CONTROL B — the MAP KEY is untouched, and the counter can fire
// ===========================================================================

describe('[#16488] negative control: the U+0000 joiner still separates map keys', () => {
  it('nulCount answers non-zero on a control string — the instrument is live', () => {
    // Without this, a broken counter would green every assertion above.
    expect(nulCount(`${EMPLOYER}${NUL}${USER}`)).toBe(1);
    expect(nulCount('a')).toBe(0);
  });

  it("the ruling's own pair — ('a','b') and ('a\\0b','') — still do not collide", async () => {
    const objects = { demo_pair: { name: 'demo_pair', fields: { a: { type: 'text' }, b: { type: 'text' } } } };
    const seeds = [{
      object: 'demo_pair',
      externalId: ['a', 'b'],
      mode: 'upsert',
      env: ['prod', 'dev', 'test'],
      records: [
        { a: 'a', b: 'b' },
        { a: `a${NUL}b`, b: '' },
      ],
    }];

    const { engine, store } = createFaithfulEngine();
    const result = await new SeedLoaderService(engine, createMetadata(objects), createLogger() as never)
      .load({ seeds, config: CONFIG } as never);

    expect(result.success).toBe(true);
    // Two rows, not one: the second never matched the first.
    expect(store.demo_pair).toHaveLength(2);
    expect(store.demo_pair.map((r: any) => r.a).sort()).toEqual([`a${NUL}b`, 'a'].sort());
  });

  it('a pair that WOULD collide under a visible `+` joiner still dedupes as two rows on replay', async () => {
    // This is the test that goes red if anyone swaps the NUL for `+` in the
    // KEY to make the log prettier: `('x','y+z')` and `('x+y','z')` both join to
    // `x+y+z` under `+`, and the second row would be swallowed by the first.
    const objects = { demo_pair: { name: 'demo_pair', fields: { a: { type: 'text' }, b: { type: 'text' } } } };
    const seeds = [{
      object: 'demo_pair',
      externalId: ['a', 'b'],
      mode: 'upsert',
      env: ['prod', 'dev', 'test'],
      records: [
        { a: 'x', b: 'y+z' },
        { a: 'x+y', b: 'z' },
      ],
    }];

    const { engine, store } = createFaithfulEngine();
    const metadata = createMetadata(objects);

    const first = await new SeedLoaderService(engine, metadata, createLogger() as never)
      .load({ seeds, config: CONFIG } as never);
    expect(first.success).toBe(true);
    expect(store.demo_pair).toHaveLength(2);

    // Replay: each row matches ITS OWN key, so both skip and the table stays at 2.
    const second = await new SeedLoaderService(engine, metadata, createLogger() as never)
      .load({ seeds, config: CONFIG } as never);
    expect(second.success).toBe(true);
    expect(store.demo_pair).toHaveLength(2);
    expect(second.results.find((r: any) => r.object === 'demo_pair')!.skipped).toBe(2);
  });
});
