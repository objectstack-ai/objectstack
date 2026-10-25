/**
 * ObjectUI — ValueDataSource Tests
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { ValueDataSource } from '../ValueDataSource';

const sampleData = [
  { id: '1', name: 'Alice', age: 30, role: 'admin' },
  { id: '2', name: 'Bob', age: 25, role: 'user' },
  { id: '3', name: 'Charlie', age: 35, role: 'admin' },
  { id: '4', name: 'Diana', age: 28, role: 'user' },
  { id: '5', name: 'Eve', age: 22, role: 'guest' },
];

function createDS() {
  return new ValueDataSource({ items: sampleData });
}

// ---------------------------------------------------------------------------
// find
// ---------------------------------------------------------------------------

describe('ValueDataSource — find', () => {
  it('should return all items with no params', async () => {
    const ds = createDS();
    const result = await ds.find('users');
    expect(result.data).toHaveLength(5);
    expect(result.total).toBe(5);
  });

  it('should filter by equality', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $filter: { role: 'admin' } });
    expect(result.data).toHaveLength(2);
    expect(result.data.every((r: any) => r.role === 'admin')).toBe(true);
    expect(result.total).toBe(2);
  });

  it('should filter with $gt operator', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $filter: { age: { $gt: 28 } } });
    expect(result.data).toHaveLength(2);
    expect(result.data.map((r: any) => r.name).sort()).toEqual(['Alice', 'Charlie']);
  });

  it('should filter with $gte operator', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $filter: { age: { $gte: 28 } } });
    expect(result.data).toHaveLength(3);
  });

  it('should filter with $lt operator', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $filter: { age: { $lt: 25 } } });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Eve');
  });

  it('should filter with $ne operator', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $filter: { role: { $ne: 'admin' } } });
    expect(result.data).toHaveLength(3);
  });

  it('should filter with $in operator', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      $filter: { role: { $in: ['admin', 'guest'] } },
    });
    expect(result.data).toHaveLength(3);
  });

  it('should filter with $contains operator', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      // `Ali`, not `ali`: this case used the lower-case spelling and passed only
      // because `$contains` folded both sides, which objectui#7379 ended. The
      // row it means to select is still the same one, and the case rule itself
      // is pinned in `ValueDataSource.textOperatorCase.test.ts` rather than
      // riding along here.
      $filter: { name: { $contains: 'Ali' } },
    });
    expect(result.data).toHaveLength(1); // Alice only ('Ali' is not in 'Charlie')
  });

  it('should sort ascending by Record format', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $orderby: { name: 'asc' } });
    const names = result.data.map((r: any) => r.name);
    expect(names).toEqual(['Alice', 'Bob', 'Charlie', 'Diana', 'Eve']);
  });

  it('should sort descending by Record format', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $orderby: { age: 'desc' } });
    expect(result.data[0].name).toBe('Charlie');
    expect(result.data[4].name).toBe('Eve');
  });

  it('should sort by string array format', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $orderby: ['-age'] });
    expect(result.data[0].name).toBe('Charlie');
  });

  it('should sort by object array format', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      $orderby: [{ field: 'age', order: 'asc' }],
    });
    expect(result.data[0].name).toBe('Eve');
    expect(result.data[4].name).toBe('Charlie');
  });

  it('should paginate with $skip and $top', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $skip: 2, $top: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(5); // total before pagination
    expect(result.hasMore).toBe(true);
  });

  it('should return hasMore=false when all items returned', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $top: 10 });
    expect(result.hasMore).toBe(false);
  });

  it('should select specific fields', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $select: ['name', 'age'] });
    const first = result.data[0] as any;
    expect(first.name).toBeDefined();
    expect(first.age).toBeDefined();
    expect(first.id).toBeUndefined();
    expect(first.role).toBeUndefined();
  });

  it('should search across string fields', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $search: 'bob' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Bob');
  });

  it('should combine filter + sort + pagination', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      $filter: { role: 'user' },
      $orderby: { age: 'asc' },
      $top: 1,
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Bob'); // youngest user
    expect(result.total).toBe(2); // 2 users total
    expect(result.hasMore).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AST-format filter support
// ---------------------------------------------------------------------------

describe('ValueDataSource — AST filter', () => {
  it('should filter with simple AST equality condition', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      $filter: ['role', '=', 'admin'],
    });
    expect(result.data).toHaveLength(2);
    expect(result.data.every((r: any) => r.role === 'admin')).toBe(true);
  });

  it('should filter with AST "in" operator', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      $filter: ['role', 'in', ['admin', 'guest']],
    });
    expect(result.data).toHaveLength(3);
  });

  it('should filter with AST "and" logical operator', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      $filter: ['and', ['role', '=', 'admin'], ['age', '>', 30]],
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Charlie');
  });

  it('should filter with AST "or" logical operator', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      $filter: ['or', ['role', '=', 'guest'], ['name', '=', 'Alice']],
    });
    expect(result.data).toHaveLength(2);
  });

  it('should filter with AST "!=" operator', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      $filter: ['role', '!=', 'admin'],
    });
    expect(result.data).toHaveLength(3);
  });

  it('should filter with AST "not in" operator', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      $filter: ['role', 'not in', ['admin', 'guest']],
    });
    expect(result.data).toHaveLength(2);
    expect(result.data.every((r: any) => r.role === 'user')).toBe(true);
  });

  it('should filter with AST "contains" operator', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      $filter: ['name', 'contains', 'li'],
    });
    expect(result.data).toHaveLength(2); // Alice, Charlie
  });

  it('should filter with nested AST (and with in operator)', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      $filter: ['and', ['role', 'in', ['admin', 'user']], ['age', '>=', 28]],
    });
    expect(result.data).toHaveLength(3); // Alice (30, admin), Charlie (35, admin), Diana (28, user)
  });

  it('should return all items with empty AST filter', async () => {
    const ds = createDS();
    const result = await ds.find('users', { $filter: [] });
    expect(result.data).toHaveLength(5);
  });

  it('should combine AST filter with sort', async () => {
    const ds = createDS();
    const result = await ds.find('users', {
      $filter: ['role', '=', 'admin'],
      $orderby: { age: 'asc' },
    });
    expect(result.data).toHaveLength(2);
    expect(result.data[0].name).toBe('Alice');
    expect(result.data[1].name).toBe('Charlie');
  });
});

// ---------------------------------------------------------------------------
// findOne
// ---------------------------------------------------------------------------

describe('ValueDataSource — findOne', () => {
  it('should find a record by id', async () => {
    const ds = createDS();
    const record = await ds.findOne('users', '3');
    expect(record).not.toBeNull();
    expect((record as any).name).toBe('Charlie');
  });

  it('should return null for missing id', async () => {
    const ds = createDS();
    const record = await ds.findOne('users', '999');
    expect(record).toBeNull();
  });

  it('should use custom idField', async () => {
    const ds = new ValueDataSource({
      items: [{ code: 'A', label: 'Alpha' }],
      idField: 'code',
    });
    const record = await ds.findOne('items', 'A');
    expect(record).not.toBeNull();
    expect((record as any).label).toBe('Alpha');
  });

  it('should select fields on findOne', async () => {
    const ds = createDS();
    const record = await ds.findOne('users', '1', { $select: ['name'] });
    expect(record).not.toBeNull();
    expect((record as any).name).toBe('Alice');
    expect((record as any).age).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('ValueDataSource — create', () => {
  it('should add a record to the collection', async () => {
    const ds = createDS();
    const created = await ds.create('users', { name: 'Frank', age: 40, role: 'user' });
    expect((created as any).name).toBe('Frank');
    expect(ds.count).toBe(6);
  });

  it('should auto-generate an ID if missing', async () => {
    const ds = createDS();
    const created = await ds.create('users', { name: 'Grace' });
    expect((created as any).id).toBeDefined();
    expect(String((created as any).id).startsWith('auto_')).toBe(true);
  });

  it('should preserve existing ID', async () => {
    const ds = createDS();
    const created = await ds.create('users', { id: 'custom-id', name: 'Heidi' });
    expect((created as any).id).toBe('custom-id');
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('ValueDataSource — update', () => {
  it('should update an existing record', async () => {
    const ds = createDS();
    const updated = await ds.update('users', '1', { age: 31 });
    expect((updated as any).age).toBe(31);
    expect((updated as any).name).toBe('Alice');
  });

  it('should throw for non-existent record', async () => {
    const ds = createDS();
    await expect(ds.update('users', '999', { age: 50 })).rejects.toThrow(
      'Record with id "999" not found',
    );
  });

  it('should persist updates in subsequent finds', async () => {
    const ds = createDS();
    await ds.update('users', '2', { name: 'Bobby' });
    const result = await ds.findOne('users', '2');
    expect((result as any).name).toBe('Bobby');
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('ValueDataSource — delete', () => {
  it('should remove a record', async () => {
    const ds = createDS();
    const ok = await ds.delete('users', '1');
    expect(ok).toBe(true);
    expect(ds.count).toBe(4);
  });

  it('should return false for non-existent record', async () => {
    const ds = createDS();
    const ok = await ds.delete('users', '999');
    expect(ok).toBe(false);
    expect(ds.count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// bulk
// ---------------------------------------------------------------------------

describe('ValueDataSource — bulk', () => {
  it('should bulk create records', async () => {
    const ds = createDS();
    const results = await ds.bulk!('users', 'create', [
      { name: 'X', age: 10 },
      { name: 'Y', age: 20 },
    ]);
    expect(results).toHaveLength(2);
    expect(ds.count).toBe(7);
  });

  it('should bulk delete records', async () => {
    const ds = createDS();
    await ds.bulk!('users', 'delete', [{ id: '1' }, { id: '2' }]);
    expect(ds.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// getObjectSchema
// ---------------------------------------------------------------------------

describe('ValueDataSource — getObjectSchema', () => {
  it('should infer schema from first item', async () => {
    const ds = createDS();
    const schema = await ds.getObjectSchema('users');
    expect(schema.name).toBe('users');
    expect(schema.fields.id).toBeDefined();
    expect(schema.fields.name.type).toBe('string');
    expect(schema.fields.age.type).toBe('number');
  });

  it('should return empty fields for empty dataset', async () => {
    const ds = new ValueDataSource({ items: [] });
    const schema = await ds.getObjectSchema('empty');
    expect(schema.fields).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

describe('ValueDataSource — isolation', () => {
  it('should not mutate the original items array', async () => {
    const original = [{ id: '1', name: 'Test' }];
    const ds = new ValueDataSource({ items: original });
    await ds.create('x', { name: 'New' });
    expect(original).toHaveLength(1); // original untouched
    expect(ds.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------

describe('ValueDataSource — aggregate', () => {
  const aggData = [
    { id: '1', category: 'A', amount: 10 },
    { id: '2', category: 'A', amount: 20 },
    { id: '3', category: 'B', amount: 30 },
    { id: '4', category: 'B', amount: 40 },
    { id: '5', category: 'B', amount: 50 },
  ];

  function createAggDS() {
    return new ValueDataSource({ items: aggData });
  }

  it('should compute sum aggregation', async () => {
    const ds = createAggDS();
    const result = await ds.aggregate('items', { field: 'amount', function: 'sum', groupBy: 'category' });
    expect(result).toHaveLength(2);
    const groupA = result.find((r: any) => r.category === 'A');
    const groupB = result.find((r: any) => r.category === 'B');
    expect(groupA?.amount).toBe(30);
    expect(groupB?.amount).toBe(120);
  });

  it('should compute count aggregation', async () => {
    const ds = createAggDS();
    const result = await ds.aggregate('items', { field: 'amount', function: 'count', groupBy: 'category' });
    expect(result).toHaveLength(2);
    expect(result.find((r: any) => r.category === 'A')?.amount).toBe(2);
    expect(result.find((r: any) => r.category === 'B')?.amount).toBe(3);
  });

  it('should compute avg aggregation', async () => {
    const ds = createAggDS();
    const result = await ds.aggregate('items', { field: 'amount', function: 'avg', groupBy: 'category' });
    expect(result.find((r: any) => r.category === 'A')?.amount).toBe(15);
    expect(result.find((r: any) => r.category === 'B')?.amount).toBe(40);
  });

  it('should compute min aggregation', async () => {
    const ds = createAggDS();
    const result = await ds.aggregate('items', { field: 'amount', function: 'min', groupBy: 'category' });
    expect(result.find((r: any) => r.category === 'A')?.amount).toBe(10);
    expect(result.find((r: any) => r.category === 'B')?.amount).toBe(30);
  });

  it('should compute max aggregation', async () => {
    const ds = createAggDS();
    const result = await ds.aggregate('items', { field: 'amount', function: 'max', groupBy: 'category' });
    expect(result.find((r: any) => r.category === 'A')?.amount).toBe(20);
    expect(result.find((r: any) => r.category === 'B')?.amount).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// onMutation (P2 — Event Bus)
// ---------------------------------------------------------------------------

describe('ValueDataSource — onMutation', () => {
  it('should emit "create" event when a record is created', async () => {
    const ds = createDS();
    const events: any[] = [];
    ds.onMutation((e) => events.push(e));

    await ds.create('users', { name: 'Zara', age: 40 });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('create');
    expect(events[0].resource).toBe('users');
    expect(events[0].record.name).toBe('Zara');
  });

  it('should emit "update" event when a record is updated', async () => {
    const ds = createDS();
    const events: any[] = [];
    ds.onMutation((e) => events.push(e));

    await ds.update('users', '1', { age: 31 });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('update');
    expect(events[0].resource).toBe('users');
    expect(events[0].id).toBe('1');
    expect(events[0].record.age).toBe(31);
  });

  it('should emit "delete" event when a record is deleted', async () => {
    const ds = createDS();
    const events: any[] = [];
    ds.onMutation((e) => events.push(e));

    await ds.delete('users', '2');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('delete');
    expect(events[0].resource).toBe('users');
    expect(events[0].id).toBe('2');
    expect(events[0].record).toBeUndefined();
  });

  it('should not emit "delete" for non-existent record', async () => {
    const ds = createDS();
    const events: any[] = [];
    ds.onMutation((e) => events.push(e));

    await ds.delete('users', '999');

    expect(events).toHaveLength(0);
  });

  it('should support multiple subscribers', async () => {
    const ds = createDS();
    const eventsA: any[] = [];
    const eventsB: any[] = [];
    ds.onMutation((e) => eventsA.push(e));
    ds.onMutation((e) => eventsB.push(e));

    await ds.create('users', { name: 'Multi' });

    expect(eventsA).toHaveLength(1);
    expect(eventsB).toHaveLength(1);
  });

  it('should unsubscribe correctly', async () => {
    const ds = createDS();
    const events: any[] = [];
    const unsub = ds.onMutation((e) => events.push(e));

    await ds.create('users', { name: 'Before' });
    expect(events).toHaveLength(1);

    unsub();

    await ds.create('users', { name: 'After' });
    expect(events).toHaveLength(1); // No new event
  });

  it('should emit events for bulk operations', async () => {
    const ds = createDS();
    const events: any[] = [];
    ds.onMutation((e) => events.push(e));

    await ds.bulk!('users', 'create', [
      { name: 'Bulk1' },
      { name: 'Bulk2' },
    ]);

    // Bulk create calls create() for each item
    expect(events).toHaveLength(2);
    expect(events.every((e: any) => e.type === 'create')).toBe(true);
  });
});
