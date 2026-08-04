// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

describe('compileScopedFilterToSql', () => {
  it('implicit equality → qualified column = ?', () => {
    expect(compileScopedFilterToSql({ organization_id: 'org_A' }, 'opportunity')).toEqual({
      sql: '"opportunity"."organization_id" = ?',
      params: ['org_A'],
    });
  });

  it('the RLS deny sentinel compiles to an id equality (matches nothing in practice)', () => {
    const r = compileScopedFilterToSql({ id: '__rls_deny__:00000000-0000-0000-0000-000000000000' }, 'opportunity');
    expect(r.sql).toBe('"opportunity"."id" = ?');
    expect(r.params).toEqual(['__rls_deny__:00000000-0000-0000-0000-000000000000']);
  });

  it('$in → IN (?, ?)', () => {
    expect(compileScopedFilterToSql({ owner_id: { $in: ['u1', 'u2'] } }, 'sys_user')).toEqual({
      sql: '"sys_user"."owner_id" IN (?, ?)',
      params: ['u1', 'u2'],
    });
  });

  it('empty $in → 1 = 0 (matches no rows, fail-safe)', () => {
    expect(compileScopedFilterToSql({ owner_id: { $in: [] } }, 't').sql).toBe('1 = 0');
  });

  it('$or combines multiple policies', () => {
    const r = compileScopedFilterToSql(
      { $or: [{ organization_id: 'org_A' }, { is_public: true }] },
      'doc',
    );
    expect(r.sql).toBe('("doc"."organization_id" = ? OR "doc"."is_public" = ?)');
    expect(r.params).toEqual(['org_A', true]);
  });

  it('$and + nested $or', () => {
    const r = compileScopedFilterToSql(
      { $and: [{ organization_id: 'org_A' }, { $or: [{ owner_id: 'u1' }, { shared: true }] }] },
      'rec',
    );
    expect(r.sql).toBe('("rec"."organization_id" = ? AND ("rec"."owner_id" = ? OR "rec"."shared" = ?))');
    expect(r.params).toEqual(['org_A', 'u1', true]);
  });

  it('null → IS NULL; $ne null → IS NOT NULL', () => {
    expect(compileScopedFilterToSql({ deleted_at: null }, 't').sql).toBe('"t"."deleted_at" IS NULL');
    expect(compileScopedFilterToSql({ deleted_at: { $ne: null } }, 't').sql).toBe('"t"."deleted_at" IS NOT NULL');
  });

  it('comparison + string operators', () => {
    expect(compileScopedFilterToSql({ amount: { $gte: 100 } }, 't').sql).toBe('"t"."amount" >= ?');
    expect(compileScopedFilterToSql({ name: { $startsWith: 'A' } }, 't')).toEqual({
      sql: '"t"."name" LIKE ?', params: ['A%'],
    });
  });

  it('multiple operators on one field are ANDed', () => {
    const r = compileScopedFilterToSql({ amount: { $gte: 10, $lte: 100 } }, 't');
    expect(r.sql).toBe('("t"."amount" >= ? AND "t"."amount" <= ?)');
    expect(r.params).toEqual([10, 100]);
  });

  // ── fail-closed guarantees (security) ──────────────────────────────────────

  it('THROWS on an unsafe field identifier (injection guard)', () => {
    expect(() => compileScopedFilterToSql({ 'id; DROP TABLE x': 'v' }, 't')).toThrowError(/unsafe field identifier/);
  });

  it('THROWS on an unsafe alias identifier', () => {
    expect(() => compileScopedFilterToSql({ id: 'v' }, 'a"; DROP')).toThrowError(/unsafe alias identifier/);
  });

  it('THROWS on an unknown operator (never silently drops a predicate)', () => {
    expect(() => compileScopedFilterToSql({ f: { $regex: '.*' } }, 't')).toThrowError(/unsupported operator/);
  });

  it('THROWS on a nested relation value (cannot join in a flat scope)', () => {
    expect(() => compileScopedFilterToSql({ account: { region: 'NA' } }, 't')).toThrowError(/nested\/relation value/);
  });

  it('empty combinators reduce to their boolean identities (#5322)', () => {
    // FLIPPED pin. Until the 2026-08-04 #5322 ruling this asserted
    // `toThrowError(/non-empty array/)`: the compiler refused empty
    // combinators fail-closed while the five FILTER_LOGIC_CASES backends
    // reduced them to identities. The ruling took the reduction, so `''`
    // (TRUE) and `1 = 0` (FALSE) are now the pinned answers — matching
    // `driver-sql` / `driver-memory` / `formula` / `driver-sqlite-wasm` /
    // `driver-mongodb` row for row.
    expect(compileScopedFilterToSql({ $and: [] }, 't')).toEqual({ sql: '', params: [] });
    expect(compileScopedFilterToSql({ $or: [] }, 't')).toEqual({ sql: '1 = 0', params: [] });
  });

  it('still THROWS on a non-array $and/$or (fail-closed — #5322 loosened only the EMPTY array)', () => {
    expect(() => compileScopedFilterToSql({ $and: 'x' } as never, 't')).toThrowError(/requires an array/);
    expect(() => compileScopedFilterToSql({ $or: { a: 1 } } as never, 't')).toThrowError(/requires an array/);
  });

  it('THROWS on a non-object read scope', () => {
    expect(() => compileScopedFilterToSql('nope' as never, 't')).toThrowError(/must be a filter object/);
  });
});
