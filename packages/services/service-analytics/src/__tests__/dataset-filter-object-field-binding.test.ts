// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { compileDataset } from '../dataset-compiler.js';
import { bindDatasetFiltersToObjectFields } from '../dataset-filter-field-binding.js';

/**
 * [#25814] A dataset's filters key their conditions by a field of the dataset's
 * OBJECT — `GlobalFilterSchema.field` says so in as many words ("not against
 * that dataset's declared `dimensions`"), and the authoring gates read the
 * widget filter and the dataset/measure filters the same way. The cube those
 * filters are lowered onto resolves a `where` key as a cube member first, so a
 * dimension sharing the field's name (`{ name: 'department', field:
 * 'department.name' }`) turned the global filter `{ department: <unit id> }`
 * into `department.name = <unit id>`: every widget read 0.
 *
 * The assertions read what reached the driver — the native statement and its
 * params, the engine's aggregate filter — on both strategies.
 */

const CTX = { userId: 'usr_1', tenantId: 'org_9', timezone: 'UTC' } as ExecutionContext;

const OBJECT_FIELDS: Record<string, readonly string[]> = {
  clm_contract: ['name', 'status', 'department', 'amount', 'signed_on'],
  department: ['name'],
};

/** The hotclm shape: a dimension named like the lookup it labels. */
const dataset = DatasetSchema.parse({
  name: 'contract_metrics',
  label: 'Contracts',
  object: 'clm_contract',
  include: ['department'],
  dimensions: [
    { name: 'department', field: 'department.name', type: 'string' },
    { name: 'department_name', field: 'department.name', type: 'string' },
    { name: 'status', field: 'status', type: 'string' },
  ],
  measures: [{ name: 'contract_count', aggregate: 'count' }],
});

type Capabilities = { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean };
const NATIVE: Capabilities = { nativeSql: true, objectqlAggregate: false, inMemory: false };
const ENGINE: Capabilities = { nativeSql: false, objectqlAggregate: true, inMemory: false };

interface Captured {
  sql: { sql: string; params: unknown[] }[];
  aggregate: { object: string; filter: unknown }[];
}

function service(capabilities: Capabilities, captured: Captured, extra: object = {}) {
  return new AnalyticsService({
    queryCapabilities: () => capabilities,
    executeRawSql: async (_object: string, sql: string, params: unknown[]) => {
      captured.sql.push({ sql, params });
      return [];
    },
    executeAggregate: async (object: string, options: { filter?: unknown }) => {
      captured.aggregate.push({ object, filter: options.filter });
      return [];
    },
    getObjectFieldNames: (object: string) => OBJECT_FIELDS[object],
    ...extra,
  } as ConstructorParameters<typeof AnalyticsService>[0]);
}

function fresh(): Captured {
  return { sql: [], aggregate: [] };
}

/**
 * The statement's WHERE clause, so a GROUP BY on the same column cannot satisfy
 * it. A base-table column is written bare in a statement that joins nothing and
 * table-qualified in one that does — both spellings name `clm_contract`'s own
 * column; a joined column is always qualified by its alias.
 */
function whereOf(sql: string): string {
  const where = sql.split(' WHERE ')[1] ?? '';
  return where.split(' GROUP BY ')[0];
}

describe('a dataset filter key that names an object field binds to that field — NativeSQLStrategy', () => {
  it('a widget runtimeFilter (a bound dashboard global filter) compares the lookup column, not the dimension', async () => {
    const captured = fresh();
    await service(NATIVE, captured).queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['contract_count'], runtimeFilter: { department: 'bu_1' } },
      CTX,
    );

    expect(captured.sql).toHaveLength(1);
    const { sql, params } = captured.sql[0];
    expect(whereOf(sql)).toBe('department = $1');
    expect(params).toEqual(['bu_1']);
    // Nothing reads the related object any more: the join was the dimension's.
    expect(sql).not.toContain('JOIN');
  });

  it('the same key still GROUPS by the dimension when the selection names it', async () => {
    const captured = fresh();
    await service(NATIVE, captured).queryDataset(
      dataset,
      { dimensions: ['department'], measures: ['contract_count'], runtimeFilter: { department: 'bu_1' } },
      CTX,
    );

    const { sql } = captured.sql[0];
    expect(sql).toContain('"department"."name" AS "department"');
    expect(whereOf(sql)).toBe('"clm_contract"."department" = $1');
  });

  it('under $and / $or / $not, beside an operator object', async () => {
    const captured = fresh();
    await service(NATIVE, captured).queryDataset(
      dataset,
      {
        dimensions: ['status'],
        measures: ['contract_count'],
        runtimeFilter: {
          $and: [
            { $or: [{ department: 'bu_1' }, { department: { $in: ['bu_2', 'bu_3'] } }] },
            { $not: { department: 'bu_9' } },
          ],
        },
      },
      CTX,
    );

    const { sql } = captured.sql[0];
    expect(sql).not.toContain('JOIN');
    expect(whereOf(sql).match(/\bdepartment\b/g)).toHaveLength(4);
    expect(captured.sql[0].params).toEqual(expect.arrayContaining(['bu_1', 'bu_2', 'bu_3', 'bu_9']));
  });

  it("the dataset's intrinsic filter and a measure-scoped filter bind the same way", async () => {
    const scoped = DatasetSchema.parse({
      ...dataset,
      name: 'legal_contract_metrics',
      filter: { department: 'bu_legal' },
      measures: [
        { name: 'contract_count', aggregate: 'count' },
        { name: 'signed_count', aggregate: 'count', filter: { department: 'bu_legal', status: 'signed' } },
      ],
    });
    const captured = fresh();
    await service(NATIVE, captured).queryDataset(
      scoped,
      { dimensions: ['status'], measures: ['contract_count', 'signed_count'] },
      CTX,
    );

    expect(captured.sql.length).toBeGreaterThan(0);
    for (const { sql } of captured.sql) {
      expect(sql).not.toContain('JOIN');
      expect(whereOf(sql)).toMatch(/(^|\()department = \$\d/);
      expect(whereOf(sql)).not.toContain('"department".');
    }
  });

  it('a key naming only a dimension (no such field) keeps resolving through the dimension', async () => {
    const captured = fresh();
    await service(NATIVE, captured).queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['contract_count'], runtimeFilter: { department_name: 'Legal' } },
      CTX,
    );

    expect(whereOf(captured.sql[0].sql)).toBe('"department"."name" = $1');
  });

  it('a host that cannot name the object\'s fields keeps today\'s resolution (cannot answer, do not block)', async () => {
    const captured = fresh();
    await service(NATIVE, captured, { getObjectFieldNames: () => undefined }).queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['contract_count'], runtimeFilter: { department: 'bu_1' } },
      CTX,
    );

    expect(whereOf(captured.sql[0].sql)).toBe('"department"."name" = $1');
  });

  it('the cube door is untouched: `where` on the registered cube still speaks the member vocabulary', async () => {
    const captured = fresh();
    const svc = service(NATIVE, captured, { datasets: [dataset] });
    await svc.query(
      { cube: 'contract_metrics', measures: ['contract_count'], dimensions: ['status'], where: { department: 'Legal' } },
      CTX,
    );

    expect(whereOf(captured.sql[0].sql)).toBe('"department"."name" = $1');
  });
});

describe('a dataset filter key that names an object field binds to that field — ObjectQLStrategy', () => {
  it('the engine aggregate receives the lookup field, not a cross-object path', async () => {
    const captured = fresh();
    await service(ENGINE, captured).queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['contract_count'], runtimeFilter: { department: 'bu_1' } },
      CTX,
    );

    expect(captured.aggregate).toHaveLength(1);
    expect(captured.aggregate[0].object).toBe('clm_contract');
    expect(captured.aggregate[0].filter).toEqual({ department: 'bu_1' });
  });
});

describe('the field-read admission judges the field the filter binds to', () => {
  /** A caller who may read the contract's own columns and nothing of the related unit. */
  const readers = {
    getReadableFields: (object: string) => (object === 'clm_contract' ? OBJECT_FIELDS.clm_contract : []),
  };

  it('admits a filter on a readable lookup field without reading the related object', async () => {
    const captured = fresh();
    await service(NATIVE, captured, readers).queryDataset(
      dataset,
      { dimensions: ['status'], measures: ['contract_count'], runtimeFilter: { department: 'bu_1' } },
      CTX,
    );

    expect(captured.sql).toHaveLength(1);
    expect(captured.sql[0].sql).not.toContain('JOIN');
    expect(whereOf(captured.sql[0].sql)).toBe('department = $1');
  });

  it('refuses the same filter when the lookup field itself is not readable', async () => {
    const captured = fresh();
    const err = await service(NATIVE, captured, {
      getReadableFields: (object: string) => (object === 'clm_contract' ? ['name', 'status'] : []),
    })
      .queryDataset(
        dataset,
        { dimensions: ['status'], measures: ['contract_count'], runtimeFilter: { department: 'bu_1' } },
        CTX,
      )
      .catch((e: unknown) => e);

    expect((err as { code?: string }).code).toBe('PERMISSION_DENIED');
    expect((err as { status?: number }).status).toBe(403);
    expect(captured.sql).toHaveLength(0);
  });
});

describe('bindDatasetFiltersToObjectFields — the binding itself', () => {
  const compiledOf = (d: typeof dataset) => compileDataset(d);

  it('returns its inputs untouched when no key is shadowed', () => {
    const compiled = compiledOf(dataset);
    const selection = { dimensions: ['status'], measures: ['contract_count'], runtimeFilter: { status: 'signed', department_name: 'Legal' } };
    const bound = bindDatasetFiltersToObjectFields(compiled, selection, OBJECT_FIELDS.clm_contract);

    expect(bound.compiled).toBe(compiled);
    expect(bound.selection).toBe(selection);
  });

  it('mints a member name no member, field or earlier binding uses, and leaves the shared cube alone', () => {
    const compiled = compiledOf(dataset);
    const before = Object.keys(compiled.cube.dimensions);
    const fields = [...OBJECT_FIELDS.clm_contract, 'department__object_field'];
    const bound = bindDatasetFiltersToObjectFields(
      compiled,
      { dimensions: [], measures: ['contract_count'], runtimeFilter: { department: 'bu_1', status: 'signed' } },
      fields,
    );

    expect(bound.selection.runtimeFilter).toEqual({ department__object_field_2: 'bu_1', status: 'signed' });
    expect(bound.compiled.cube.dimensions.department__object_field_2).toMatchObject({ sql: 'department', type: 'string' });
    expect(bound.compiled.cube.dimensions.department).toEqual(compiled.cube.dimensions.department);
    expect(Object.keys(compiled.cube.dimensions)).toEqual(before);
  });

  it('leaves a nested-relation condition as written — the engine reads its key as the relation field', () => {
    const compiled = compiledOf(dataset);
    const relation = { $or: [{ department: { name: 'Legal' } }, { department: 'bu_1' }] };
    const bound = bindDatasetFiltersToObjectFields(
      compiled,
      { dimensions: [], measures: ['contract_count'], runtimeFilter: relation },
      OBJECT_FIELDS.clm_contract,
    );

    expect(bound.selection.runtimeFilter).toEqual({
      $or: [{ department: { name: 'Legal' } }, { department__object_field: 'bu_1' }],
    });
    // …and alone it shadows nothing, so nothing is minted.
    const alone = bindDatasetFiltersToObjectFields(
      compiled,
      { dimensions: [], measures: ['contract_count'], runtimeFilter: { department: { name: 'Legal' } } },
      OBJECT_FIELDS.clm_contract,
    );
    expect(alone.compiled).toBe(compiled);
  });
});
