// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13037] `datasource.external.validation.checkOnBoot` — declared with
 * `.default(true)` since the block was written, and read by NOTHING until this
 * card. An author who wrote `checkOnBoot: false` and left `onMismatch` at its
 * default still got the boot sweep, and a measured mismatch still threw
 * `ExternalSchemaMismatchError` and aborted startup — the exact outcome the key
 * reads as opting out of. The `.default(true)` made it worse than an ignored
 * key: it materializes into every parse output, so a dead knob is byte-identical
 * to an honoured one in stored and serialized datasources.
 *
 * Maintainer ruling 2026-08-29 (verbatim: 「同意」) — ADR-0049 disposition
 * **enforce, not remove**, with the scope pinned at the ruling: the gate covers
 * the **boot step only**. These tests pin both directions and the scope, since
 * a gate that fires in only one direction is the same defect wearing a fix.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// `.js` extension deliberately: this package's `typecheck` excludes `*.test.ts`,
// but the shrink-only TEST_DEBT ratchet (`pnpm check:type-check-debt`) does read
// this layer under `moduleResolution: nodenext`, where an extension-less
// relative import is a TS2835 — measured, and it moved the frozen count 217 →
// 218 before this extension was added.
import { ExternalValidationPlugin } from './external-validation-plugin.js';
import { ExternalSchemaMismatchError, type SchemaDiffEntry } from '@objectstack/spec/shared';
import { DatasourceSchema } from '@objectstack/spec/data';

type Row = { ok: boolean; datasource: string; object: string; diffs: SchemaDiffEntry[] };

function makeCtx(services: Record<string, unknown>) {
  const warnings: unknown[][] = [];
  const infos: unknown[][] = [];
  const ctx = {
    getService: <T>(name: string): T => {
      if (name in services) return services[name] as T;
      throw new Error(`service '${name}' not registered`);
    },
    registerService: vi.fn(),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: {
      debug: vi.fn(),
      info: (...a: unknown[]) => infos.push(a),
      warn: (...a: unknown[]) => warnings.push(a),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { ctx, warnings, infos };
}

/** A real measured mismatch — the kind that reaches the `onMismatch` policy. */
const mismatch: SchemaDiffEntry[] = [
  { kind: 'type_mismatch', remoteName: 'fact_orders', column: 'amount', expected: 'number', actual: 'text', severity: 'error' },
];

/** [#11166] The indeterminate row: the remote could not be read at all. */
const unreachable: SchemaDiffEntry[] = [
  { kind: 'unreachable', remoteName: 'fact_orders', actual: 'connect ECONNREFUSED 10.0.0.5:5432', severity: 'error' },
];

const sweep = (rows: Row[]) => ({
  validateAll: async () => ({ ok: rows.every((r) => r.ok), results: rows }),
});

/**
 * A metadata service answering per-datasource definitions, counting its reads.
 * The call count is asserted on directly — the gate resolves a per-datasource
 * key over a whole-farm report, and "once per datasource" rather than "once per
 * row" is a property worth pinning, not an implementation detail.
 */
function metadataOf(defs: Record<string, unknown>) {
  const calls: string[] = [];
  return {
    calls,
    service: {
      get: async (type: string, name: string) => {
        calls.push(`${type}:${name}`);
        return defs[name];
      },
    },
  };
}

const withCheckOnBoot = (checkOnBoot: boolean, onMismatch: 'fail' | 'warn' | 'ignore' = 'fail') => ({
  schemaMode: 'external',
  external: { validation: { onMismatch, checkOnBoot } },
});

const skipLine = (infos: unknown[][]) => infos.find((i) => String(i[0]).includes('SKIPPED'));

describe('checkOnBoot: false — the datasource is skipped by the kernel:ready sweep (#13037)', () => {
  /**
   * ⭐ The card's actual harm, driven end to end. Asserting merely that
   * validation "was not run" would leave the interesting half untested: what
   * the author is opting out of is not the work, it is the ABORT.
   */
  it('a MEASURED mismatch cannot abort boot through a checkOnBoot:false datasource', async () => {
    const meta = metadataOf({ warehouse: withCheckOnBoot(false) });
    const { ctx, warnings, infos } = makeCtx({
      'external-datasource': sweep([
        { ok: false, datasource: 'warehouse', object: 'wh_order', diffs: mismatch },
      ]),
      metadata: meta.service,
    });

    // Boot completes. Under `onMismatch: 'fail'` this same row aborts boot when
    // checkOnBoot is true — pinned in the sibling describe below.
    await expect(new ExternalValidationPlugin().runValidation(ctx)).resolves.toBeUndefined();

    // And it was skipped, not merely tolerated: no drift warning was logged for
    // it either, and the skip is stated to the operator by name.
    expect(warnings.some((w) => String(w[0]).includes('drift'))).toBe(false);
    expect(skipLine(infos)?.[1]).toMatchObject({ datasources: ['warehouse'], objectsSkipped: 1 });
  });

  it('its objects are not counted in the all-clear — the verdict covers the gated datasources only', async () => {
    const meta = metadataOf({
      warehouse: withCheckOnBoot(false),
      ledger: withCheckOnBoot(true),
    });
    const { ctx, infos } = makeCtx({
      'external-datasource': sweep([
        { ok: true, datasource: 'warehouse', object: 'wh_order', diffs: [] },
        { ok: true, datasource: 'warehouse', object: 'wh_item', diffs: [] },
        { ok: true, datasource: 'ledger', object: 'gl_entry', diffs: [] },
      ]),
      metadata: meta.service,
    });

    await new ExternalValidationPlugin().runValidation(ctx);

    const allClear = infos.find((i) => String(i[0]).includes('match their remote schema'));
    expect(allClear?.[1]).toMatchObject({ objects: 1 });
    expect(skipLine(infos)?.[1]).toMatchObject({ datasources: ['warehouse'], objectsSkipped: 2 });
  });

  /**
   * [#11166]'s loud unreachable warning is part of the boot gate, so it is part
   * of what `checkOnBoot: false` opts out of. Skipped means skipped — an author
   * who took the boot check off their datasource should not be told at every
   * startup that the boot check could not read it.
   */
  it('does not raise the unreachable-remote warning for a skipped datasource', async () => {
    const meta = metadataOf({ warehouse: withCheckOnBoot(false) });
    const { ctx, warnings } = makeCtx({
      'external-datasource': sweep([
        { ok: false, datasource: 'warehouse', object: 'wh_order', diffs: unreachable },
      ]),
      metadata: meta.service,
    });

    await expect(new ExternalValidationPlugin().runValidation(ctx)).resolves.toBeUndefined();
    expect(warnings.some((w) => String(w[0]).includes('could not be validated'))).toBe(false);
  });
});

describe('checkOnBoot: true / absent — today\'s behaviour, unchanged (#13037)', () => {
  it('an explicit checkOnBoot:true still aborts boot on a measured mismatch', async () => {
    const meta = metadataOf({ warehouse: withCheckOnBoot(true) });
    const { ctx } = makeCtx({
      'external-datasource': sweep([
        { ok: false, datasource: 'warehouse', object: 'wh_order', diffs: mismatch },
      ]),
      metadata: meta.service,
    });

    // ADR-0112 envelope, not a bare `toThrow()`: the code and status are the
    // contract, and a bare throw assertion passes for any accidental `Error`.
    await expect(new ExternalValidationPlugin().runValidation(ctx)).rejects.toMatchObject({
      code: 'EXTERNAL_SCHEMA_MISMATCH',
      status: 503,
      datasource: 'warehouse',
    });
  });

  it('an ABSENT checkOnBoot still aborts boot — the schema default is true', async () => {
    const meta = metadataOf({
      // No `checkOnBoot` key at all: a legacy stored row, or a definition that
      // never went through the parse that materializes the default.
      warehouse: { schemaMode: 'external', external: { validation: { onMismatch: 'fail' } } },
    });
    const { ctx } = makeCtx({
      'external-datasource': sweep([
        { ok: false, datasource: 'warehouse', object: 'wh_order', diffs: mismatch },
      ]),
      metadata: meta.service,
    });

    await expect(new ExternalValidationPlugin().runValidation(ctx)).rejects.toBeInstanceOf(
      ExternalSchemaMismatchError,
    );
  });

  /**
   * The gate must be silent when nobody opted out — a new line on every healthy
   * boot would be a behaviour change of its own, and the ruling asked for this
   * branch to stay byte-identical.
   */
  it('emits no skip line when no datasource opts out', async () => {
    const meta = metadataOf({ warehouse: withCheckOnBoot(true) });
    const { ctx, infos } = makeCtx({
      'external-datasource': sweep([
        { ok: true, datasource: 'warehouse', object: 'wh_order', diffs: [] },
      ]),
      metadata: meta.service,
    });

    await new ExternalValidationPlugin().runValidation(ctx);
    expect(skipLine(infos)).toBeUndefined();
    expect(infos.some((i) => String(i[0]).includes('match their remote schema'))).toBe(true);
  });

  /**
   * Every uncertainty resolves towards RUNNING the check. A definition that
   * cannot be read must never be inferred to have opted out — that would turn a
   * transient metadata outage into a silently ungated boot, which is the whole
   * failure class this card is about, inverted.
   */
  it('validates — does not skip — when the datasource definition cannot be read', async () => {
    const { ctx } = makeCtx({
      'external-datasource': sweep([
        { ok: false, datasource: 'warehouse', object: 'wh_order', diffs: mismatch },
      ]),
      metadata: { get: async () => { throw new Error('metadata store unreachable'); } },
    });

    await expect(new ExternalValidationPlugin().runValidation(ctx)).rejects.toBeInstanceOf(
      ExternalSchemaMismatchError,
    );
  });
});

describe('the gate is PER DATASOURCE, not global (#13037)', () => {
  /**
   * ⭐ The assertion the ruling actually turns on. The sweep is whole-farm and
   * the key is per-source, so a single-datasource test cannot tell a per-source
   * gate apart from a global kill switch: both pass it. This one separates them
   * — one datasource opts out and mismatches, another does not and mismatches,
   * and boot must still abort FOR THE SECOND ONE.
   */
  it('a checkOnBoot:false datasource does not suppress another datasource\'s abort', async () => {
    const meta = metadataOf({
      warehouse: withCheckOnBoot(false),
      ledger: withCheckOnBoot(true),
    });
    const { ctx, infos } = makeCtx({
      'external-datasource': sweep([
        { ok: false, datasource: 'warehouse', object: 'wh_order', diffs: mismatch },
        { ok: false, datasource: 'ledger', object: 'gl_entry', diffs: mismatch },
      ]),
      metadata: meta.service,
    });

    const err = await new ExternalValidationPlugin().runValidation(ctx).then(
      () => { throw new Error('boot was expected to abort on the ledger mismatch'); },
      (e: unknown) => e as ExternalSchemaMismatchError,
    );

    expect(err).toBeInstanceOf(ExternalSchemaMismatchError);
    expect(err.code).toBe('EXTERNAL_SCHEMA_MISMATCH');
    expect(err.status).toBe(503);
    // ⭐ It aborted BECAUSE OF `ledger`. Asserting only "it threw" would pass on
    // a gate wired backwards, which would have thrown for `warehouse` instead.
    expect(err.datasource).toBe('ledger');
    expect(err.object).toBe('gl_entry');
    // And the opted-out one really was dropped rather than merely out-raced.
    expect(skipLine(infos)?.[1]).toMatchObject({ datasources: ['warehouse'] });
  });

  it('reads each datasource definition once per sweep, not once per row', async () => {
    const meta = metadataOf({
      warehouse: withCheckOnBoot(false),
      ledger: withCheckOnBoot(true),
    });
    const { ctx } = makeCtx({
      'external-datasource': sweep([
        { ok: true, datasource: 'warehouse', object: 'wh_a', diffs: [] },
        { ok: true, datasource: 'warehouse', object: 'wh_b', diffs: [] },
        { ok: true, datasource: 'ledger', object: 'gl_a', diffs: [] },
        { ok: true, datasource: 'ledger', object: 'gl_b', diffs: [] },
      ]),
      metadata: meta.service,
    });

    await new ExternalValidationPlugin().runValidation(ctx);
    expect(meta.calls.sort()).toEqual(['datasource:ledger', 'datasource:warehouse']);
  });
});

describe('the value read is the PARSED one, and there is only one spelling of it (#13037)', () => {
  const authored = (validation: Record<string, unknown>) => ({
    name: 'warehouse',
    driver: 'postgres' as const,
    config: { host: 'db.internal', database: 'warehouse' },
    schemaMode: 'external' as const,
    external: { validation },
  });

  /**
   * ⭐ End to end through the real schema: an author document is parsed by
   * `DatasourceSchema`, and the PARSED definition — the shape the metadata
   * service hands back — is what the gate is handed. This is what stops the
   * read point drifting to raw author input, which would miss both the
   * `.default(true)` materialization and any future conversion-layer rewrite.
   */
  it('a parsed checkOnBoot:false datasource is honoured by the boot gate', async () => {
    const parsed = DatasourceSchema.parse(authored({ onMismatch: 'fail', checkOnBoot: false }));
    expect(parsed.external?.validation?.checkOnBoot).toBe(false);

    const meta = metadataOf({ warehouse: parsed });
    const { ctx, infos } = makeCtx({
      'external-datasource': sweep([
        { ok: false, datasource: 'warehouse', object: 'wh_order', diffs: mismatch },
      ]),
      metadata: meta.service,
    });

    await expect(new ExternalValidationPlugin().runValidation(ctx)).resolves.toBeUndefined();
    expect(skipLine(infos)?.[1]).toMatchObject({ datasources: ['warehouse'] });
  });

  it('a parsed datasource that omits the key carries the materialized default and is validated', async () => {
    const parsed = DatasourceSchema.parse(authored({ onMismatch: 'fail' }));
    // The `.default(true)` the card names: the knob is present in every parse
    // output, which is exactly why an unread one was indistinguishable from an
    // honoured one.
    expect(parsed.external?.validation?.checkOnBoot).toBe(true);

    const meta = metadataOf({ warehouse: parsed });
    const { ctx } = makeCtx({
      'external-datasource': sweep([
        { ok: false, datasource: 'warehouse', object: 'wh_order', diffs: mismatch },
      ]),
      metadata: meta.service,
    });

    await expect(new ExternalValidationPlugin().runValidation(ctx)).rejects.toBeInstanceOf(
      ExternalSchemaMismatchError,
    );
  });

  /**
   * ⭐ `checkonboot` and `validateonboot` appear in this block's `strictObject`
   * table, and both the card and the dispatch read that table as an alias FOLD
   * — i.e. as two further authorable spellings the gate would have to honour or
   * else deliver half the surface. Measured here: it is not a fold. The table
   * feeds the `unrecognized_keys` REJECTION path only (`strict-object.ts`: "an
   * alias runs only from the `unrecognized_keys` path"), so both spellings are
   * refused at parse with a rename prescription, and `checkOnBoot` is the only
   * spelling that ever reaches a reader.
   *
   * Pinned rather than merely noted, in both directions: if a real fold is ever
   * added, this test reds and sends its author to the gate's read point instead
   * of letting a second spelling silently become inert — which is the defect
   * this whole card is about. ⛔ The answer to a red here is never a `??` chain
   * in the consumer (AGENTS.md Prime Directive #12).
   */
  it('`checkonboot` / `validateonboot` are REJECTED spellings, not folds — one key, one read point', () => {
    for (const spelling of ['checkonboot', 'validateonboot']) {
      const result = DatasourceSchema.safeParse(authored({ [spelling]: false }));
      expect(result.success, `${spelling} must not parse`).toBe(false);
      const issue = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
      expect(issue, `${spelling} must be refused as an unrecognized key`).toBeDefined();
      expect(issue!.message).toContain(spelling);
      // The refusal carries the one spelling that works.
      expect(issue!.message).toContain('checkOnBoot');
    }

    // Positive control for the probe above: the canonical spelling parses on
    // the very same document, so the two failures are about the KEY and not
    // about the fixture.
    expect(DatasourceSchema.safeParse(authored({ checkOnBoot: false })).success).toBe(true);
  });
});

describe('scope: the gate covers the BOOT STEP ONLY (#13037)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * ⭐ The scope the maintainer pinned at the ruling, held mechanically rather
   * than in prose: `checkOnBoot` and `checkIntervalMs` answer different
   * questions ("gate my startup on this" vs "watch this while I run"), so a
   * datasource that opted out of the boot check still gets the background drift
   * checker it asked for. A future edit that extends the gate to
   * `scheduleDriftChecks` fails here.
   */
  it('checkOnBoot:false still arms the background drift checker it asked for', async () => {
    const { ctx } = makeCtx({
      'external-datasource': sweep([]),
      metadata: {
        list: async () => [
          {
            name: 'warehouse',
            schemaMode: 'external',
            external: { validation: { onMismatch: 'fail', checkOnBoot: false, checkIntervalMs: 60_000 } },
          },
        ],
      },
    });

    const plugin = new ExternalValidationPlugin();
    await plugin.scheduleDriftChecks(ctx);
    expect(vi.getTimerCount()).toBe(1);
    plugin.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
