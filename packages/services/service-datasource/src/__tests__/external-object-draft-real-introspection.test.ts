// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pin the maintainer ruling names: `generateObjectDraft` driven off a REAL
 * `SqlDriver.introspectSchema()` result, not a hand-written fake.
 *
 * This is the case the original suite could not be. Every other draft fixture
 * in this package writes its remote schema by hand in the `packages/spec`
 * spelling (`primaryKey: true`), so the seam where the driver's output meets
 * this service was never exercised: the driver spelled key membership
 * `isPrimary`, this service reads `col.primaryKey`, and every federated object
 * drafted from a real remote table silently lost its primary key. A fixture in
 * EITHER spelling is blind to that — only a live introspection can see it.
 *
 * Where the key surfaces: `fields.<f>.primaryKey` is not an authorable field
 * key, so the ruling (2026-08-22, item 8, option D) put the introspected key
 * in a COMMENT in the generated source and nowhere else. "The draft carries
 * the remote key" is therefore asserted on `draft.source`, and the definition
 * is asserted to stay free of the unauthorable key — both halves, because an
 * implementation that re-emitted the key onto the field would satisfy the
 * first alone while re-opening a defect the platform's own validator refuses.
 *
 * `@objectstack/driver-sql` is imported as a PACKAGE (its `exports` resolve to
 * `dist/`), so this file measures the driver's BUILT output. The service is
 * imported relatively, so it measures `src/`. That asymmetry is deliberate and
 * is the seam itself: rebuild the driver before reading a verdict here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IntrospectedSchema } from '@objectstack/spec/contracts';
import {
  ExternalDatasourceService,
  type DatasourceLike,
} from '../external-datasource-service.js';

const opened: SqlDriver[] = [];

afterEach(async () => {
  while (opened.length) {
    const d = opened.pop()!;
    try {
      await (d as unknown as { knex?: { destroy(): Promise<void> } }).knex?.destroy();
    } catch {
      /* the pool may never have opened */
    }
  }
});

/** A live in-memory SQLite database, introspected by the real driver. */
async function introspectReal(ddl: (knex: never) => Promise<void>): Promise<unknown> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  } as never);
  opened.push(driver);
  await ddl((driver as unknown as { knex: never }).knex);
  return driver.introspectSchema();
}

/** Wire the service to that result, exactly as `plugin.ts` does — unmodified. */
function serviceOver(schema: unknown): ExternalDatasourceService {
  return new ExternalDatasourceService({
    introspect: async () => schema as IntrospectedSchema,
    getDatasource: async (name): Promise<DatasourceLike> => ({ name, schemaMode: 'external' }),
    getObject: async () => undefined,
    listObjects: async () => [],
  });
}

type CreateTable = {
  schema: { createTable(n: string, cb: (t: never) => void): Promise<void> };
};
type TableBuilder = {
  string(n: string): { primary(): void; notNullable(): { primary(): void } };
  integer(n: string): { notNullable(): unknown };
  primary(cols: string[]): void;
};

/** The `// Remote primary key: …` line of a generated source, or `undefined`. */
function remoteKeyComment(source: string): string | undefined {
  return source.split('\n').find((l) => l.includes('Remote primary key:'))?.trim();
}

describe('generateObjectDraft, driven off a real SqlDriver.introspectSchema()', () => {
  it('carries the introspected primary key into the draft', async () => {
    const schema = await introspectReal(async (knex: never) => {
      await (knex as unknown as CreateTable).schema.createTable('customers', (t: never) => {
        const b = t as unknown as TableBuilder;
        b.string('id').primary();
        b.string('name');
        b.integer('age');
      });
    });

    const draft = await serviceOver(schema).generateObjectDraft('showcase_external', 'customers');

    // The whole card, as one assertion on a real producer's output: before the
    // driver spoke the spec spelling this was `undefined` — the draft named no
    // remote key at all, so a user committing it federated a table with no
    // addressing key.
    expect(remoteKeyComment(draft.source)).toBe('// Remote primary key: id');

    // …and it is the introspected key, not "the first column": a table whose
    // key is not first is covered below.
    expect(draft.definition.fields).toEqual({
      id: { type: 'text' },
      name: { type: 'text' },
      age: { type: 'number' },
    });

    // The key survives as a comment and NOWHERE else. `fields.<f>.primaryKey`
    // is unauthorable (TS2353 against `ServiceObject`, `unrecognized_keys` on
    // `ObjectSchema.safeParse`); this change must not reintroduce it.
    expect(JSON.stringify(draft.definition)).not.toContain('primaryKey');
  });

  it('names every member of a composite key, in declared key order', async () => {
    const schema = await introspectReal(async (knex: never) => {
      await (knex as unknown as CreateTable).schema.createTable('order_lines', (t: never) => {
        const b = t as unknown as TableBuilder;
        b.string('sku');
        b.string('order_id').notNullable();
        b.integer('line_no').notNullable();
        b.primary(['order_id', 'line_no']);
      });
    });

    const draft = await serviceOver(schema).generateObjectDraft('showcase_external', 'order_lines');

    // Column order is (sku, order_id, line_no); key order is (order_id,
    // line_no). Both members, and neither `sku` nor a first-column guess.
    expect(remoteKeyComment(draft.source)).toBe('// Remote primary key: order_id, line_no');
  });

  it('invents no key for a remote table that declares none', async () => {
    const schema = await introspectReal(async (knex: never) => {
      await (knex as unknown as CreateTable).schema.createTable('events', (t: never) => {
        const b = t as unknown as TableBuilder;
        b.string('label');
        b.string('payload');
      });
    });

    const draft = await serviceOver(schema).generateObjectDraft('showcase_external', 'events');

    expect(remoteKeyComment(draft.source)).toBeUndefined();
    expect(Object.keys(draft.definition.fields as object)).toEqual(['label', 'payload']);
  });
});
