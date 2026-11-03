// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29281] `org_user_ids` — the fellow-org peer list `sys_user`'s org-members
 * row scope reads (`id in current_user.org_user_ids`) — holds EVERY member of
 * the active organization, whatever its size, and nobody else.
 *
 * It is read from `sys_member` in the resolver's first leg, bounded at 1,000
 * rows. That bound used to be the list: a read that came back AT it was taken
 * as the whole membership, so the members past the 1,000th `sys_member.id`
 * were silently missing from every ordinary member's `sys_user` reads. Now a
 * first read at its bound is the signal to read the membership to completion
 * (ordered by id, a page at a time) and to say so once; a first read under it
 * is the whole membership, exactly as before, and nothing else is read.
 *
 * The double below honours the reads' `where` (equality, `$gt`), `orderBy` and
 * `limit`, and answers an UNORDERED read in insertion order, which here is not
 * id order — so a completion that resumed after the first page's last id,
 * trusting that page to be the id-lowest 1,000, would miss members and fail.
 * The real-driver twin is plugin-security's
 * `sys-user-org-members-past-first-read.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveUserAuthzGrants } from './resolve-authz-context.js';
import { isAuthzStoreUnavailableError } from './authz-store-unavailable.js';
import { bindCatalogFromTables } from './__tests__/security-catalog.testkit.js';

const ORG = 'org_large';
const ELSEWHERE = 'org_elsewhere';
const ME = 'u000000';
const FIRST_READ_BOUND = 1000;
/** The completion read's page (`ORG_MEMBERS_PAGE_ROWS` in `resolve-authz-context.ts`). */
const PAGE_ROWS = 10000;

interface Read { object: string; where: Record<string, unknown>; limit?: number; orderBy?: unknown }

function makeQl(
  tables: Record<string, any[]>,
  opts: { ignoreCursor?: boolean; failAfter?: number; staleForOrderedReads?: ReadonlySet<string> } = {},
) {
  const reads: Read[] = [];
  const holds = (row: any, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && '$gt' in (v as any)) {
        return opts.ignoreCursor ? true : String(row[k]) > String((v as any).$gt);
      }
      if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
      if (v === null) return (row[k] ?? null) === null;
      return row[k] === v;
    });
  return Object.assign(bindCatalogFromTables({
    async find(object: string, q: any) {
      reads.push({ object, where: JSON.parse(JSON.stringify(q?.where ?? {})), limit: q?.limit, orderBy: q?.orderBy });
      if (opts.failAfter !== undefined && object === 'sys_member' && reads.filter((r) => r.object === 'sys_member').length > opts.failAfter) {
        throw new Error('connection reset');
      }
      const order = Array.isArray(q?.orderBy) ? q.orderBy[0] : undefined;
      // An ordered read (the completion's) answering from an older snapshot: the
      // members named here had not joined yet as far as it can see.
      const stale = order && object === 'sys_member' ? opts.staleForOrderedReads : undefined;
      let rows = (tables[object] ?? []).filter((r) => holds(r, q?.where ?? {}) && !stale?.has(r.user_id));
      if (order) {
        rows = [...rows].sort((a, b) => (a[order.field] < b[order.field] ? -1 : a[order.field] > b[order.field] ? 1 : 0));
        if (order.order === 'desc') rows.reverse();
      }
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
  }, tables), { reads });
}

/**
 * `n` members of `ORG` (the caller first) plus two members of `ELSEWHERE`.
 * Each `sys_member.id` comes from a permutation that does not follow the user
 * ids, and the table holds the rows in user order, so the first 1,000 rows an
 * unordered read returns are NOT the 1,000 lowest ids.
 */
function tablesOf(n: number) {
  const pad = (i: number) => String(i).padStart(6, '0');
  const sys_member = Array.from({ length: n }, (_, i) => ({
    id: `m${pad((i * 7919) % 1000003)}`,
    user_id: `u${pad(i)}`,
    organization_id: ORG,
    role: 'member',
  }));
  sys_member.push(
    { id: 'm000001x', user_id: 'u_elsewhere_1', organization_id: ELSEWHERE, role: 'member' },
    { id: 'mzzzzzz', user_id: 'u_elsewhere_2', organization_id: ELSEWHERE, role: 'member' },
  );
  return {
    sys_user: [{ id: ME, email: 'me@example.test' }],
    sys_member,
    sys_user_position: [],
    sys_user_permission_set: [],
  };
}

const orgReads = (reads: Read[]) => reads.filter((r) => r.object === 'sys_member' && r.where.organization_id === ORG);
const membersOf = (tables: ReturnType<typeof tablesOf>) =>
  tables.sys_member.filter((m) => m.organization_id === ORG).map((m) => m.user_id).sort();

afterEach(() => vi.restoreAllMocks());

describe('[#29281] org_user_ids holds the whole active organization', () => {
  it('⭐ 1,005 members: every member and the caller, and nobody from another organization', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tables = tablesOf(FIRST_READ_BOUND + 5);
    const grants = await resolveUserAuthzGrants(makeQl(tables), ME, { tenantId: ORG });

    expect([...grants.org_user_ids].sort()).toEqual(membersOf(tables));
    expect(grants.org_user_ids).toHaveLength(FIRST_READ_BOUND + 5);
    expect(grants.org_user_ids).not.toContain('u_elsewhere_1');
    expect(grants.org_user_ids).not.toContain('u_elsewhere_2');
  });

  it('a first read AT its bound reads the rest in id order, a page at a time, inside the organization', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tables = tablesOf(PAGE_ROWS * 2 + 7);
    const ql = makeQl(tables);
    const grants = await resolveUserAuthzGrants(ql, ME, { tenantId: ORG });

    expect([...grants.org_user_ids].sort()).toEqual(membersOf(tables));
    const [first, ...rest] = orgReads(ql.reads);
    // The first leg's read is unchanged: same filter, same bound, no ordering asked.
    expect(first).toEqual({ object: 'sys_member', where: { organization_id: ORG }, limit: FIRST_READ_BOUND, orderBy: undefined });
    // The completion starts over from the first id, then resumes after each page's last id.
    const ids = tables.sys_member.filter((m) => m.organization_id === ORG).map((m) => m.id).sort();
    expect(rest).toEqual([
      { object: 'sys_member', where: { organization_id: ORG }, limit: PAGE_ROWS, orderBy: [{ field: 'id', order: 'asc' }] },
      { object: 'sys_member', where: { organization_id: ORG, id: { $gt: ids[PAGE_ROWS - 1] } }, limit: PAGE_ROWS, orderBy: [{ field: 'id', order: 'asc' }] },
      { object: 'sys_member', where: { organization_id: ORG, id: { $gt: ids[PAGE_ROWS * 2 - 1] } }, limit: PAGE_ROWS, orderBy: [{ field: 'id', order: 'asc' }] },
    ]);
  });

  it('999 members: the one first read is the whole membership, nothing else is read and nothing is said', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tables = tablesOf(FIRST_READ_BOUND - 1);
    const ql = makeQl(tables);
    const grants = await resolveUserAuthzGrants(ql, ME, { tenantId: ORG });

    expect([...grants.org_user_ids].sort()).toEqual(membersOf(tables));
    expect(orgReads(ql.reads)).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('exactly 1,000 members: the same members, one completion read that comes back short, and nothing said', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tables = tablesOf(FIRST_READ_BOUND);
    const ql = makeQl(tables);
    const grants = await resolveUserAuthzGrants(ql, ME, { tenantId: ORG });

    expect([...grants.org_user_ids].sort()).toEqual(membersOf(tables));
    // The first read cannot tell 1,000 from more, so one page is read — and it is the whole membership.
    expect(orgReads(ql.reads)).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a first read at its bound is said once per organization and engine, naming the organization and the count', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tables = tablesOf(FIRST_READ_BOUND + 5);
    const ql = makeQl(tables);
    await resolveUserAuthzGrants(ql, ME, { tenantId: ORG });
    await resolveUserAuthzGrants(ql, ME, { tenantId: ORG });

    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(ORG));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`${FIRST_READ_BOUND + 5}`);
    expect(lines[0]).toContain('org_user_ids');
  });

  it('a completion that sees fewer members than the first read still yields every member the first read returned', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tables = tablesOf(FIRST_READ_BOUND + 5);
    // Five members the unordered first read returns (it answers in insertion
    // order) that the completion's older snapshot does not hold.
    const unseen = new Set(['u000001', 'u000002', 'u000003', 'u000004', 'u000005']);
    const ql = makeQl(tables, { staleForOrderedReads: unseen });
    const grants = await resolveUserAuthzGrants(ql, ME, { tenantId: ORG });

    // The completion did run, and did come back short of them.
    expect(orgReads(ql.reads)).toHaveLength(2);
    for (const u of unseen) expect(grants.org_user_ids).toContain(u);
    expect([...grants.org_user_ids].sort()).toEqual(membersOf(tables));
    expect(grants.org_user_ids).not.toContain('u_elsewhere_1');
    expect(grants.org_user_ids).not.toContain('u_elsewhere_2');
  });

  it('a page that fails to read fails the resolution loudly — never a shorter list', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tables = tablesOf(FIRST_READ_BOUND + 5);
    // The caller's own read and the first organization read succeed; the next one throws.
    const err = await resolveUserAuthzGrants(makeQl(tables, { failAfter: 2 }), ME, { tenantId: ORG }).catch((e) => e);
    expect(isAuthzStoreUnavailableError(err)).toBe(true);
    expect((err as { object?: string }).object).toBe('sys_member');
  });

  it('a full page whose rows carry no id fails loudly — there is no cursor to resume after', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tables = tablesOf(PAGE_ROWS + 5);
    for (const m of tables.sys_member) delete (m as { id?: string }).id;
    const err = await resolveUserAuthzGrants(makeQl(tables), ME, { tenantId: ORG }).catch((e) => e);
    expect(isAuthzStoreUnavailableError(err)).toBe(true);
    expect((err as { object?: string }).object).toBe('sys_member');
  });

  it('a page that does not advance past its cursor fails loudly — never loops, never truncates', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tables = tablesOf(PAGE_ROWS + 5);
    const err = await resolveUserAuthzGrants(makeQl(tables, { ignoreCursor: true }), ME, { tenantId: ORG }).catch((e) => e);
    expect(isAuthzStoreUnavailableError(err)).toBe(true);
    expect((err as { object?: string }).object).toBe('sys_member');
  });
});
