// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10231] `managerOf` honours its declared `organizationId`.
 *
 * `ITeamGraphService.managerOf(userId, organizationId?)` declares the
 * organization parameter; the implementation used to spell it `_organizationId`
 * and drop it, while `expandRoleUsers` on the SAME class applied
 * `organization_id` to its read.
 *
 * ## Why both directions are pinned, and why the positive half is the longer one
 *
 * This is a security seam, so over-screening is a defect of the same rank as
 * under-screening: a `managerOf` that returned nothing would silently empty
 * every approver slate and every `manager` sharing recipient, and the
 * surrounding `catch` blocks would make that look like "no manager on file"
 * rather than like a fault. The screen therefore reads `sys_member` (the ONLY
 * table carrying a tenancy fact for a user — `sys_user` has no
 * `organization_id`), and it is fail-open on an ABSENT fact.
 *
 * Note the fixture below mirrors that: no `sys_user` row carries an
 * `organization_id`, because no `sys_user` row can. A fixture that invented one
 * would let a `where: { id, organization_id }` implementation pass here and
 * return null against every real driver.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TeamGraphService } from './team-graph.js';
import { BusinessUnitGraphService } from './business-unit-graph.js';

interface Row { [k: string]: any }

/**
 * Minimal engine faithful to the two predicate shapes these paths use. Records
 * every read so a test can assert that the no-organization path issues NO
 * membership query at all — "unchanged when absent" is a claim about the reads
 * as much as about the return value.
 */
function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const reads: string[] = [];
  let throwOnMember = false;
  function matches(row: Row, f: any): boolean {
    if (!f || typeof f !== 'object') return true;
    for (const [k, v] of Object.entries(f)) {
      if (row[k] !== v) return false;
    }
    return true;
  }
  return {
    _tables: tables,
    _reads: reads,
    _throwOnMember: (v: boolean) => { throwOnMember = v; },
    async find(object: string, options?: any): Promise<any[]> {
      reads.push(object);
      if (object === 'sys_member' && throwOnMember) throw new Error('membership store unavailable');
      const predicate = options?.where ?? options?.filter ?? {};
      return (tables[object] ?? []).filter((r) => matches(r, predicate));
    },
    async insert() { return {}; },
    async update() { return {}; },
    async delete() { return {}; },
  };
}

function seed(engine: ReturnType<typeof makeEngine>) {
  // ⛔ No `organization_id` on any row here — sys_user is the global
  // better-auth identity table and has no such column (ADR-0010 section 3.7).
  engine._tables.sys_user = [
    { id: 'alice', manager_id: 'bob' },     // bob: member of org1
    { id: 'dave', manager_id: 'eve' },      // eve: member of org2 ONLY
    { id: 'frank', manager_id: 'ghost' },   // ghost: no membership rows at all
    { id: 'heidi', manager_id: 'ivan' },    // ivan: member of BOTH org1 and org2
    { id: 'carol', manager_id: null },
  ];
  engine._tables.sys_member = [
    { id: 'm1', user_id: 'bob', organization_id: 'org1', role: 'sales_rep' },
    { id: 'm2', user_id: 'eve', organization_id: 'org2', role: 'sales_rep' },
    { id: 'm3', user_id: 'ivan', organization_id: 'org1', role: 'sales_rep' },
    { id: 'm4', user_id: 'ivan', organization_id: 'org2', role: 'sales_rep' },
  ];
}

describe('[#10231] TeamGraphService.managerOf — POSITIVE direction (over-screening guard)', () => {
  let engine: ReturnType<typeof makeEngine>;
  beforeEach(() => { engine = makeEngine(); seed(engine); });

  it('returns a manager who IS a member of the caller organization', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await g.managerOf('alice', 'org1')).toEqual('bob');
  });

  it('returns a manager with NO membership rows at all (absent fact => fail open)', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await g.managerOf('frank', 'org1')).toEqual('ghost');
  });

  it('returns a manager who holds membership in the caller org AND elsewhere', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await g.managerOf('heidi', 'org1')).toEqual('ivan');
  });

  it('returns the manager when the membership read FAILS (infrastructure => fail open)', async () => {
    engine._throwOnMember(true);
    const g = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    // dave's manager is provably outside org1 — but the fact is unreadable, so
    // routing must be left exactly as it was rather than emptied on a hiccup.
    expect(await g.managerOf('dave', 'org1')).toEqual('eve');
  });

  it('still returns null for a user with no manager, without inventing a screen', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await g.managerOf('carol', 'org1')).toBeNull();
    expect(engine._reads.filter((r) => r === 'sys_member')).toEqual([]);
  });

  it('returns null for an empty user id', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await g.managerOf('', 'org1')).toBeNull();
  });
});

describe('[#10231] TeamGraphService.managerOf — NEGATIVE direction (the screen)', () => {
  let engine: ReturnType<typeof makeEngine>;
  beforeEach(() => { engine = makeEngine(); seed(engine); });

  it('screens out a manager provably outside the caller organization', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await g.managerOf('dave', 'org1')).toBeNull();
  });

  it('screens using the INSTANCE organization when the argument is omitted (expandRoleUsers parity)', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await g.managerOf('dave')).toBeNull();
  });

  it('the explicit argument WINS over the instance organization', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    // eve is a member of org2, so asking as org2 must return her even though
    // the instance is scoped to org1.
    expect(await g.managerOf('dave', 'org2')).toEqual('eve');
  });
});

describe('[#10231] TeamGraphService.managerOf — ABSENT organization is UNCHANGED', () => {
  let engine: ReturnType<typeof makeEngine>;
  beforeEach(() => { engine = makeEngine(); seed(engine); });

  it('returns the cross-organization manager unchanged when no organization is in play', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: null });
    expect(await g.managerOf('dave')).toEqual('eve');
    expect(await g.managerOf('alice')).toEqual('bob');
  });

  it('issues NO membership read at all when no organization is in play', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: null });
    await g.managerOf('dave');
    expect(engine._reads).toEqual(['sys_user']);
    expect(engine._reads).not.toContain('sys_member');
  });

  it('an undefined argument on an unscoped instance does not screen', async () => {
    const g = new TeamGraphService({ engine: engine as any });
    expect(await g.managerOf('dave', undefined)).toEqual('eve');
  });
});

describe('[#10231] TeamGraphService.managerOf — the cache is organization-qualified', () => {
  let engine: ReturnType<typeof makeEngine>;
  beforeEach(() => { engine = makeEngine(); seed(engine); });

  it('a screened null for one organization does not leak to an unscoped read', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: null });
    expect(await g.managerOf('dave', 'org1')).toBeNull(); // screened
    // A user-keyed cache would serve that null here and turn one screened
    // caller into a permanent outage for every unscoped reader behind it.
    expect(await g.managerOf('dave')).toEqual('eve');
  });

  it('answers for two different organizations do not overwrite each other', async () => {
    const g = new TeamGraphService({ engine: engine as any, organizationId: null });
    expect(await g.managerOf('dave', 'org2')).toEqual('eve');
    expect(await g.managerOf('dave', 'org1')).toBeNull();
    expect(await g.managerOf('dave', 'org2')).toEqual('eve');
  });
});

describe('[#10231] BusinessUnitGraphService.managerOf — standalone fallback', () => {
  let engine: ReturnType<typeof makeEngine>;
  beforeEach(() => { engine = makeEngine(); seed(engine); });

  it('screens on the standalone fallback (no teamGraph supplied)', async () => {
    const d = new BusinessUnitGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await d.managerOf('dave', 'org1')).toBeNull();
  });

  it('returns an in-organization manager on the standalone fallback', async () => {
    const d = new BusinessUnitGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await d.managerOf('alice', 'org1')).toEqual('bob');
  });

  it('fails open on the standalone fallback when no membership fact exists', async () => {
    const d = new BusinessUnitGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await d.managerOf('frank', 'org1')).toEqual('ghost');
  });

  it('leaves the standalone fallback unchanged when no organization is in play', async () => {
    const d = new BusinessUnitGraphService({ engine: engine as any, organizationId: null });
    expect(await d.managerOf('dave')).toEqual('eve');
    expect(engine._reads).not.toContain('sys_member');
  });

  it('screens using the INSTANCE organization on the standalone fallback', async () => {
    const d = new BusinessUnitGraphService({ engine: engine as any, organizationId: 'org1' });
    expect(await d.managerOf('dave')).toBeNull();
  });

  it('the delegating limb screens identically to the standalone one', async () => {
    const team = new TeamGraphService({ engine: engine as any, organizationId: 'org1' });
    const delegating = new BusinessUnitGraphService({
      engine: engine as any, organizationId: 'org1', teamGraph: team,
    });
    const standalone = new BusinessUnitGraphService({ engine: engine as any, organizationId: 'org1' });
    // Same method name, same inputs — the answer must not depend on whether a
    // teamGraph happened to be passed to the constructor.
    expect(await delegating.managerOf('dave', 'org1')).toEqual(await standalone.managerOf('dave', 'org1'));
    expect(await delegating.managerOf('dave', 'org1')).toBeNull();
    expect(await delegating.managerOf('alice', 'org1')).toEqual('bob');
  });
});
