// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D3] `SqliteWasmDriver` inherits `SqlDriver`'s compile of the
 * composed `ReadableIds` leaf — `field IN (SELECT id FROM P_TABLE WHERE SCOPE
 * AND TENANT)`, walled by `applyTenantScope` with the outer read's options —
 * and its refusal of an uncomposed leaf. Measured here on the sql.js engine
 * through the shared case-set (`READABLE_IDS_CASES`), not assumed from the
 * inheritance: this driver hands `SqlDriver` a dialect class rather than a
 * client string.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  READABLE_IDS_CASES,
  READABLE_IDS_CHILD_OBJECT,
  READABLE_IDS_CHILD_ROWS,
  READABLE_IDS_PARENT_OBJECT,
  READABLE_IDS_PARENT_ROWS,
  READABLE_IDS_REFUSAL,
  lowerFilterCondition,
} from '@objectstack/spec/data';
import { SqliteWasmDriver } from './index.js';

const seamed = (where: unknown): any => lowerFilterCondition(where, { isDatetimeColumn: () => false });

describe('[ADR-0139 D3] driver-sqlite-wasm — ReadableIds conformance', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([
      { name: READABLE_IDS_PARENT_OBJECT, fields: { owner: { type: 'string' }, organization_id: { type: 'string' } } },
      {
        name: READABLE_IDS_CHILD_OBJECT,
        fields: {
          object_name: { type: 'string' },
          record_id: { type: 'string' },
          label: { type: 'string' },
          organization_id: { type: 'string' },
        },
      },
    ]);
    for (const row of READABLE_IDS_PARENT_ROWS) {
      await driver.create(READABLE_IDS_PARENT_OBJECT, { ...row }, { bypassTenantAudit: true });
    }
    for (const row of READABLE_IDS_CHILD_ROWS) {
      await driver.create(READABLE_IDS_CHILD_OBJECT, { ...row }, { bypassTenantAudit: true });
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  for (const c of READABLE_IDS_CASES) {
    if (c.verdict === 'matches') {
      it(c.name, async () => {
        const rows = await driver.find(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) } as any, c.options);
        const got = (rows as any[]).map((r) => String(r.id)).sort((x, y) => x.localeCompare(y));
        expect(got, c.note).toEqual(c.expected);
        expect(await driver.count(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) } as any, c.options), c.note)
          .toBe(c.expected.length);
      });
    } else {
      it(c.name, async () => {
        await expect(
          driver.find(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) } as any),
          c.note,
        ).rejects.toMatchObject(READABLE_IDS_REFUSAL);
      });
    }
  }
});
