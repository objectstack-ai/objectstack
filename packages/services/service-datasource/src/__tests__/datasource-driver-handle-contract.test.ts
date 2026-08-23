// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DatasourceDriverHandle.introspectSchema — the return contract is the spec
 * introspection shape, enforced by tsc (#11381, option C of the #11123
 * ruling, recorded 2026-08-23).
 *
 * Until #11381 the member was typed `Promise<unknown>`, so the one channel
 * the `isPrimary` → `primaryKey` retirement (#11124) named as its migration
 * path — the compiler, "precisely and at every site" — provably never fired
 * for the seam's OPEN producer population: host-built drivers
 * (`datasource-driver-factory.ts` deliberately ships no driver registry). A
 * driver spelling the primary-key flag wrong compiled clean and produced a
 * federated table whose records silently could not be located or updated.
 *
 * Every mis-shape pin below is resolved by tsc, not by vitest: reverting the
 * tightening (`introspectSchema?(): Promise<IntrospectedSchema>` back to
 * `Promise<unknown>`) makes each `@ts-expect-error` directive unused, and an
 * unused directive is itself an error, so
 * `pnpm --filter @objectstack/service-datasource typecheck` goes red — and
 * the first pin asserts the member's exact type, which reds directly on the
 * same revert. This package carries no test-typecheck-debt ledger entry, so
 * zero errors is the measured baseline these pins move away from. The
 * `expect()` calls only give the assertions a home vitest will run.
 *
 * What these pins deliberately do NOT claim: any runtime behaviour change.
 * The `primaryKeyReader` compatibility belt in
 * `external-datasource-service.ts` still absorbs the retired spelling from
 * producers no compiler reaches (already-built drivers, plain JS, casts);
 * its own suite pins that. Removing the belt is #11123 option B, gated on
 * this tightening being released AND the retirement being published.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DatasourceDriverHandle } from '../contracts/datasource-driver-factory.js';
import type {
  IntrospectedColumn,
  IntrospectedSchema,
  IntrospectedTable,
} from '@objectstack/spec/contracts';

/** A well-formed schema in the spec spelling, reused by the green cases. */
function specShapedSchema(): IntrospectedSchema {
  return {
    tables: {
      customers: {
        name: 'customers',
        columns: [
          { name: 'id', type: 'varchar', nullable: false, primaryKey: true },
          { name: 'email', type: 'varchar', nullable: true, primaryKey: false },
        ],
      },
    },
    dialect: 'sqlite',
    introspectedAt: '2026-08-23T00:00:00.000Z',
  };
}

describe('DatasourceDriverHandle.introspectSchema return contract (#11381)', () => {
  it('declares exactly the spec introspection shape — not unknown', () => {
    // The strongest pin in the file: this line reads the member's type off the
    // CONTRACT and reds directly if the tightening is reverted to
    // `Promise<unknown>` (or widened to any other spelling), independently of
    // every `@ts-expect-error` below.
    expectTypeOf<
      ReturnType<NonNullable<DatasourceDriverHandle['introspectSchema']>>
    >().toEqualTypeOf<Promise<IntrospectedSchema>>();
  });

  it('accepts a correctly-shaped driver, written in the spec spelling', async () => {
    // A host-built handle authored fresh against this version: per-column
    // `primaryKey`, schema-level `dialect` + `introspectedAt`. This literal
    // failing to compile is the regression.
    const handle: DatasourceDriverHandle = {
      introspectSchema: async () => specShapedSchema(),
    };
    const schema = await handle.introspectSchema!();
    expect(schema.tables.customers.columns[0].primaryKey).toBe(true);
  });

  it('gives the consumer a typed result — the probe read is no longer unknown', async () => {
    const handle: DatasourceDriverHandle = {
      introspectSchema: async () => specShapedSchema(),
    };
    // Before #11381 this expression was `unknown` and every consumer either
    // cast or re-narrowed; now `dialect` reads straight off the declared type.
    expectTypeOf(handle.introspectSchema!()).resolves.toEqualTypeOf<IntrospectedSchema>();
    expect((await handle.introspectSchema!()).dialect).toBe('sqlite');
  });

  it('still accepts a RICHER driver whose declared type extends the spec contract', async () => {
    // The in-tree pattern: driver-sql / objectql declare their introspection
    // types as EXTENSIONS of the spec contract (table-level `primaryKeys`,
    // per-column `maxLength`, …). Return-type covariance admits those extras
    // on any non-literal value, so such a driver needs no edit — and the
    // `primaryKeyReader` belt keeps reading `table.primaryKeys` as the one
    // carrier of composite-key ORDER.
    interface RicherColumn extends IntrospectedColumn {
      maxLength?: number | string;
    }
    interface RicherTable extends IntrospectedTable {
      columns: RicherColumn[];
      primaryKeys: string[];
    }
    interface RicherSchema extends IntrospectedSchema {
      tables: Record<string, RicherTable>;
    }
    const richer = async (): Promise<RicherSchema> => ({
      tables: {
        orders: {
          name: 'orders',
          columns: [
            { name: 'order_id', type: 'varchar', nullable: false, primaryKey: true, maxLength: 36 },
            { name: 'line_no', type: 'integer', nullable: false, primaryKey: true },
          ],
          primaryKeys: ['order_id', 'line_no'],
        },
      },
      dialect: 'postgres',
      introspectedAt: '2026-08-23T00:00:00.000Z',
    });
    const handle: DatasourceDriverHandle = { introspectSchema: richer };
    const schema = await handle.introspectSchema!();
    expect(schema.tables.orders.columns).toHaveLength(2);
  });

  it('refuses the retired `isPrimary` spelling, naming the field', () => {
    // The founding defect (#10676 → #11001 → #11123): a driver spelling the
    // per-column flag `isPrimary`. tsc's rejection names the field on both
    // instruments — the missing required key ("Property 'primaryKey' is
    // missing in type … but required in type 'IntrospectedColumn'") and, on a
    // fresh literal, the excess key ("'isPrimary' does not exist in type
    // 'IntrospectedColumn'").
    const misSpelledColumn: IntrospectedColumn = {
      name: 'id',
      type: 'varchar',
      nullable: false,
      // @ts-expect-error - the spec spelling is `primaryKey`; `isPrimary` does not exist in type 'IntrospectedColumn'
      isPrimary: true,
    };
    expect(misSpelledColumn).toBeTruthy();

    // The same mistake a whole driver up: pre-#11381 this handle compiled
    // clean and lost the remote key at runtime; now it does not compile.
    const legacyDriver = async () => ({
      tables: {
        customers: {
          name: 'customers',
          columns: [{ name: 'id', type: 'varchar', nullable: false, isPrimary: true }],
        },
      },
      dialect: 'sqlite',
      introspectedAt: '2026-08-23T00:00:00.000Z',
    });
    // @ts-expect-error - a driver whose columns spell the flag `isPrimary` no longer satisfies the handle
    const misSpelledHandle: DatasourceDriverHandle = { introspectSchema: legacyDriver };
    expect(misSpelledHandle).toBeTruthy();
  });

  it('refuses the `{ tables }`-only schema the driver actually shipped (#10998)', () => {
    // Measured on the pre-retirement driver: `Object.keys()` of the schema
    // was `["tables"]` — no `dialect`, no `introspectedAt` — so type mapping
    // ran dialect-blind across the whole federation path. tsc now names both
    // missing fields.
    const bareTables = async () => ({
      tables: {
        customers: {
          name: 'customers',
          columns: [{ name: 'id', type: 'varchar', nullable: false, primaryKey: true }],
        },
      },
    });
    // @ts-expect-error - `dialect` and `introspectedAt` are required by the spec introspection contract
    const tablesOnlyHandle: DatasourceDriverHandle = { introspectSchema: bareTables };
    expect(tablesOnlyHandle).toBeTruthy();
  });

  it('refuses a table-level `primaryKeys` list written fresh against the BARE spec shape', () => {
    // On the spec contract the primary-key fact is per-column. A table-level
    // list is a driver-sql EXTENSION — legal on a declared extending type
    // (previous green case), refused as an excess key on a fresh literal of
    // the bare contract, so an author who reaches for the extension is told
    // to declare it rather than having half a spelling absorbed silently.
    const listOnlyTable: IntrospectedTable = {
      name: 'customers',
      columns: [{ name: 'id', type: 'varchar', nullable: false, primaryKey: false }],
      // @ts-expect-error - `primaryKeys` does not exist in type 'IntrospectedTable'; declare an extending type or spell the fact per-column
      primaryKeys: ['id'],
    };
    expect(listOnlyTable).toBeTruthy();
  });

  it('refuses a driver that only promises `unknown` — the pre-#11381 signature itself', () => {
    const opaque = async (): Promise<unknown> => JSON.parse('{}');
    // @ts-expect-error - `Promise<unknown>` is exactly the contract this member no longer has
    const opaqueHandle: DatasourceDriverHandle = { introspectSchema: opaque };
    expect(opaqueHandle).toBeTruthy();
  });
});
