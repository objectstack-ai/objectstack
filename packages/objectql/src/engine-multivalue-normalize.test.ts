// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';

/**
 * #2552 — multi-value fields must reach the driver as ARRAYS.
 *
 * The write pipeline used to pass a lone scalar for a multiselect /
 * tags / select+multiple / lookup+multiple field straight through to the
 * driver (`PATCH { labels: "frontend" }` → stored verbatim as a string),
 * silently corrupting the column shape for every array-consumer. The
 * engine now normalizes unambiguous scalars into single-element arrays
 * BEFORE validation, and validation rejects any remaining non-array
 * shape with `invalid_type` instead of letting it hit storage.
 *
 * These tests assert on what the DRIVER receives — the actual corruption
 * point — not just on validator return values.
 */
vi.mock('./registry', async () => {
  // [#10551] The one shared factory — see `registry-module-mock.ts` for the
  // member set, the #9002 / #9154 lessons it carries, and why the async factory
  // form is what makes this import legal under `vi.mock` hoisting.
  const { createRegistryModuleMock } = await import('./registry-module-mock.js');
  return createRegistryModuleMock();
});

const PROJECT_SCHEMA = {
  name: 'project',
  fields: {
    name: { type: 'text' },
    labels: { type: 'multiselect', options: ['frontend', 'backend', 'design'] },
    tags: { type: 'tags' },
    channels: { type: 'select', multiple: true, options: ['email', 'sms'] },
    related_docs: { type: 'lookup', multiple: true, reference_to: 'document' },
    // Field.user expands to type 'user' at runtime — the showcase
    // team_members field ships exactly this shape (#2552 e2e regression).
    team_members: { type: 'user', multiple: true, reference: 'sys_user' },
    status: { type: 'select', options: ['active', 'done'] },
  },
};

function makeDriver() {
  const created: any[] = [];
  const updated: any[] = [];
  const driver: any = {
    name: 'memory',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue({ id: 'r1' }),
    create: vi.fn(async (_obj: string, row: any) => {
      created.push(row);
      return { id: 'r1', ...row };
    }),
    update: vi.fn(async (_obj: string, id: string, row: any) => {
      updated.push(row);
      return { id, ...row };
    }),
    delete: vi.fn(),
  };
  return { driver, created, updated };
}

async function makeEngine(driver: any) {
  vi.mocked((SchemaRegistry as any).getObject).mockImplementation((name: string) =>
    name === 'project' ? PROJECT_SCHEMA : undefined,
  );
  const ql = new ObjectQL();
  ql.registerDriver(driver, true);
  await ql.init();
  return ql;
}

describe('engine write pipeline — multi-value scalar normalization (#2552)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('insert: wraps scalars so the driver receives arrays', async () => {
    const { driver, created } = makeDriver();
    const ql = await makeEngine(driver);
    await ql.insert('project', {
      name: 'P1',
      labels: 'frontend',
      tags: 'urgent',
      channels: 'email',
      related_docs: 'doc-1',
      team_members: 'user-1',
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      labels: ['frontend'],
      tags: ['urgent'],
      channels: ['email'],
      related_docs: ['doc-1'],
      team_members: ['user-1'],
    });
  });

  it('update: wraps scalars so the driver receives arrays', async () => {
    const { driver, updated } = makeDriver();
    const ql = await makeEngine(driver);
    await ql.update('project', { id: 'r1', labels: 'design', team_members: 'user-2' });
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ labels: ['design'], team_members: ['user-2'] });
  });

  it('update: legal arrays pass through untouched (select+multiple was mis-rejected before)', async () => {
    const { driver, updated } = makeDriver();
    const ql = await makeEngine(driver);
    await ql.update('project', {
      id: 'r1',
      labels: ['frontend', 'design'],
      channels: ['email', 'sms'],
      related_docs: ['d1', 'd2'],
      team_members: ['u1', 'u2'],
    });
    expect(updated[0]).toMatchObject({
      labels: ['frontend', 'design'],
      channels: ['email', 'sms'],
      related_docs: ['d1', 'd2'],
      team_members: ['u1', 'u2'],
    });
  });

  it('update: un-wrappable junk is rejected BEFORE reaching the driver', async () => {
    const { driver, updated } = makeDriver();
    const ql = await makeEngine(driver);
    await expect(
      ql.update('project', { id: 'r1', labels: { nested: true } }),
    ).rejects.toThrow(/must be an array/i);
    expect(updated).toHaveLength(0);
  });

  it('insert: invalid option inside a wrapped scalar still 400s', async () => {
    const { driver, created } = makeDriver();
    const ql = await makeEngine(driver);
    await expect(ql.insert('project', { name: 'P2', labels: 'nope' })).rejects.toThrow(
      /is not one of/i,
    );
    expect(created).toHaveLength(0);
  });

  it('single-value fields are untouched', async () => {
    const { driver, created } = makeDriver();
    const ql = await makeEngine(driver);
    await ql.insert('project', { name: 'P3', status: 'active' });
    expect(created[0].status).toBe('active');
  });
});
