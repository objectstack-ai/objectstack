// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [Ruling of record 6355206139, letter B] The EXTERNAL rung's OWD floor at the
 * sharing gates. For an external principal every object's org-wide default is
 * owner_only — the rows it owns and the rows shared to it (a share, or a
 * sharing rule's materialised grant) — unless plugin-security stamped that a
 * held grant's RLS speaks for the object, in which case the object's own model
 * stands and that RLS bounds the rows (Layer 1, not this service). An internal
 * principal is unchanged on every model. A `controlled_by_parent` detail is
 * not floored: its access derives from its master, which meets the floor.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EXTERNAL_READ_GRANT_KEY, EXTERNAL_WRITE_GRANT_KEY } from '@objectstack/core';
import { SharingService } from './sharing-service.js';

type Row = Record<string, any>;

/** A read-only fake engine: schemas, and `find` over in-memory tables with equality and `$in`. */
function makeEngine(schemas: Record<string, any>, tables: Record<string, Row[]>) {
  return {
    getSchema: (name: string) => schemas[name],
    async find(object: string, opts?: any) {
      const where = opts?.where ?? {};
      const rows = (tables[object] ?? []).filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`test double: combinator ${k} is not implemented`);
          return v && typeof v === 'object' && '$in' in (v as any) ? (v as any).$in.includes(r[k]) : r[k] === v;
        }),
      );
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
  };
}

const fields = { id: {}, name: {}, owner_id: {} };
const SCHEMAS = {
  private_doc: { name: 'private_doc', sharingModel: 'private', fields },
  catalog: { name: 'catalog', sharingModel: 'public_read', fields },
  board: { name: 'board', sharingModel: 'public_read_write', fields },
  line: { name: 'line', sharingModel: 'controlled_by_parent', fields },
  sys_widget: { name: 'sys_widget', isSystem: true, fields },
  ownerless: { name: 'ownerless', sharingModel: 'public_read_write', fields: { id: {}, name: {} } },
};

const TABLES = (): Record<string, Row[]> => ({
  board: [
    { id: 'b_own', owner_id: 'u_ext' },
    { id: 'b_other', owner_id: 'u_emp' },
    { id: 'b_shared', owner_id: 'u_emp' },
  ],
  sys_record_share: [
    { id: 's1', object_name: 'board', record_id: 'b_shared', recipient_type: 'user', recipient_id: 'u_ext', access_level: 'edit' },
    { id: 's2', object_name: 'catalog', record_id: 'c_shared', recipient_type: 'user', recipient_id: 'u_ext', access_level: 'read' },
  ],
});

const EXTERNAL = { userId: 'u_ext', tenantId: 'org_a', audience: 'external', posture: 'EXTERNAL' } as const;
const MEMBER = { userId: 'u_emp', tenantId: 'org_a', posture: 'MEMBER' } as const;

describe('the EXTERNAL OWD floor — reads', () => {
  let svc: SharingService;
  beforeEach(() => {
    svc = new SharingService({ engine: makeEngine(SCHEMAS, TABLES()) as any });
  });

  for (const object of ['catalog', 'board', 'sys_widget']) {
    it(`${object} (${(SCHEMAS as any)[object].sharingModel ?? 'system, unset'}): an external reads its own rows and the rows shared to it`, async () => {
      const filter: any = await svc.buildReadFilter(object, { ...EXTERNAL } as any);
      expect(filter).not.toBeNull();
      const ownerArm = filter.$or ? filter.$or[0] : filter;
      expect(ownerArm).toEqual({ owner_id: 'u_ext' });
    });
  }

  it('a share reaches the external on a public_read_write object (OR-ed beside the owner arm)', async () => {
    expect(await svc.buildReadFilter('board', { ...EXTERNAL } as any)).toEqual({
      $or: [{ owner_id: 'u_ext' }, { id: { $in: ['b_shared'] } }],
    });
  });

  it('either carried value floors it: audience alone, or the EXTERNAL rung alone', async () => {
    expect(await svc.buildReadFilter('catalog', { userId: 'u_ext', audience: 'external' } as any)).not.toBeNull();
    expect(await svc.buildReadFilter('catalog', { userId: 'u_ext', posture: 'EXTERNAL' } as any)).not.toBeNull();
  });

  it('a held grant’s RLS lifts the floor for its object: the model stands, the RLS bounds the rows', async () => {
    expect(await svc.buildReadFilter('board', { ...EXTERNAL, [EXTERNAL_READ_GRANT_KEY]: 'board' } as any)).toBeNull();
  });

  it('a stamp for another object, or for the write class, does not lift it', async () => {
    expect(await svc.buildReadFilter('board', { ...EXTERNAL, [EXTERNAL_READ_GRANT_KEY]: 'catalog' } as any)).not.toBeNull();
    expect(await svc.buildReadFilter('board', { ...EXTERNAL, [EXTERNAL_WRITE_GRANT_KEY]: 'board' } as any)).not.toBeNull();
  });

  it('a controlled_by_parent detail is not floored: its rows derive from the master, which meets the floor', async () => {
    expect(await svc.buildReadFilter('line', { ...EXTERNAL } as any)).toBeNull();
    expect(await svc.buildWriteFilter('line', { ...EXTERNAL } as any, 'update')).toBeNull();
    expect(await svc.checkEdit('line', 'l1', { ...EXTERNAL } as any)).toBe('abstain');
    expect(await svc.checkDelete('line', 'l1', { ...EXTERNAL } as any)).toBe('abstain');
  });

  it('private stays owner ∪ shares, as for a member', async () => {
    expect(await svc.buildReadFilter('private_doc', { ...EXTERNAL } as any)).toEqual({ owner_id: 'u_ext' });
  });

  it('an object with no owner column is not under OWD: the sharing layer abstains, for an external as for a member', async () => {
    expect(await svc.buildReadFilter('ownerless', { ...EXTERNAL } as any)).toBeNull();
  });

  it('CONTROL: a member reads every public model unfiltered', async () => {
    for (const object of ['catalog', 'board', 'line', 'sys_widget']) {
      expect(await svc.buildReadFilter(object, { ...MEMBER } as any)).toBeNull();
    }
  });
});

describe('the EXTERNAL OWD floor — writes', () => {
  let svc: SharingService;
  beforeEach(() => {
    svc = new SharingService({ engine: makeEngine(SCHEMAS, TABLES()) as any });
  });

  it('bulk writes on public_read_write are owner ∪ edit-shares for an external, open for a member', async () => {
    expect(await svc.buildWriteFilter('board', { ...EXTERNAL } as any, 'update')).toEqual({
      $or: [{ owner_id: 'u_ext' }, { id: { $in: ['b_shared'] } }],
    });
    expect(await svc.buildWriteFilter('board', { ...EXTERNAL } as any, 'delete')).toEqual({ owner_id: 'u_ext' });
    expect(await svc.buildWriteFilter('board', { ...MEMBER } as any, 'update')).toBeNull();
  });

  it('by-id edit: its own row and an edit-share admit, another’s row is refused; a member abstains', async () => {
    expect(await svc.checkEdit('board', 'b_own', { ...EXTERNAL } as any)).toBe('allow');
    expect(await svc.checkEdit('board', 'b_shared', { ...EXTERNAL } as any)).toBe('allow');
    expect(await svc.checkEdit('board', 'b_other', { ...EXTERNAL } as any)).toBe('deny');
    expect(await svc.checkEdit('board', 'b_other', { ...MEMBER } as any)).toBe('abstain');
  });

  it('by-id delete: its own row only (a share never opens delete)', async () => {
    expect(await svc.checkDelete('board', 'b_own', { ...EXTERNAL } as any)).toBe('allow');
    expect(await svc.checkDelete('board', 'b_shared', { ...EXTERNAL } as any)).toBe('deny');
  });

  it('a held grant’s write-class RLS lifts the floor for its object: sharing abstains, the RLS gates the row', async () => {
    const stamped = { ...EXTERNAL, [EXTERNAL_WRITE_GRANT_KEY]: 'board' } as any;
    expect(await svc.checkEdit('board', 'b_other', stamped)).toBe('abstain');
    expect(await svc.buildWriteFilter('board', stamped, 'update')).toBeNull();
  });
});
