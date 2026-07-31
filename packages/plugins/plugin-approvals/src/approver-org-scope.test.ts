// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D9] Cross-organization approver targeting.
 *
 * The property that matters is that this is a route WITHIN one group, not a
 * channel to an arbitrary tenant — so every test here is about a boundary
 * holding or a failure being LOUD. The thing D9 exists to prevent is silence:
 * an approval that reads as "escalate to group" but quietly resolves inside the
 * plant, or one that routes to someone the D2 wall then hides the request from.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  filterApproversWhoCanRead,
  resolveApproverDirectoryOrg,
  type ApproverOrgScopeDeps,
} from './approver-org-scope.js';

/**
 * A three-tier group: group → division → plant, plus a shared-services SIBLING
 * of the plant, plus an organization in a DIFFERENT group entirely.
 */
const ORGS: Record<string, { id: string; slug: string; parent_organization_id: string | null }> = {
  o_group: { id: 'o_group', slug: 'acme-group', parent_organization_id: null },
  o_div: { id: 'o_div', slug: 'acme-north', parent_organization_id: 'o_group' },
  o_plant: { id: 'o_plant', slug: 'acme-plant-a', parent_organization_id: 'o_div' },
  o_ssc: { id: 'o_ssc', slug: 'acme-ssc', parent_organization_id: 'o_group' },
  o_other: { id: 'o_other', slug: 'rival-co', parent_organization_id: null },
  o_lone: { id: 'o_lone', slug: 'lone-co', parent_organization_id: null },
};

function makeDeps(over: Partial<ApproverOrgScopeDeps> & { members?: Array<{ user_id: string; organization_id: string }> } = {}): ApproverOrgScopeDeps & { warn: any } {
  const warn = vi.fn();
  const members = over.members ?? [];
  const engine = {
    find: vi.fn(async (object: string, opts: any) => {
      // Reads the CANONICAL key, like the engine's own post-fold AST. This
      // double used to read `opts.filter`, which is why it kept passing while
      // production spoke the deprecated spelling: both sides shared one
      // dialect, so nothing forced the migration (#4346).
      const f = opts?.where ?? {};
      if (object === 'sys_organization') {
        const rows = Object.values(ORGS).filter((o) =>
          (f.id === undefined || o.id === f.id) && (f.slug === undefined || o.slug === f.slug));
        return rows;
      }
      if (object === 'sys_member') {
        const wanted: string[] = f.user_id?.$in ?? [];
        return members.filter((m) => m.organization_id === f.organization_id && wanted.includes(m.user_id));
      }
      return [];
    }),
  };
  return { engine, logger: { warn }, posture: () => 'group', ...over, warn } as any;
}

const resolve = (
  deps: ApproverOrgScopeDeps,
  declaration: string | undefined,
  requestOrg: string | null,
  type = 'position',
  orgScoped = true,
) => resolveApproverDirectoryOrg(deps, declaration, requestOrg, type, orgScoped);

describe('resolveApproverDirectoryOrg — the default path is untouched', () => {
  it('returns the request org and reads NOTHING when no organization is declared', async () => {
    const deps = makeDeps();
    await expect(resolve(deps, undefined, 'o_plant')).resolves.toBe('o_plant');
    // The overwhelmingly common case must not cost a query.
    expect((deps.engine.find as any)).not.toHaveBeenCalled();
  });

  it('passes a null request org straight through — a single-org deployment is unaffected', async () => {
    const deps = makeDeps();
    await expect(resolve(deps, undefined, null)).resolves.toBeNull();
  });
});

describe('resolveApproverDirectoryOrg — symbols resolve against the D6 tree', () => {
  it('$root climbs to the group organization, not just one level', async () => {
    // o_plant → o_div → o_group. A one-level implementation would answer o_div.
    await expect(resolve(makeDeps(), '$root', 'o_plant')).resolves.toBe('o_group');
  });

  it('$parent stops at exactly one level — division sign-off in a three-tier group', async () => {
    await expect(resolve(makeDeps(), '$parent', 'o_plant')).resolves.toBe('o_div');
  });

  it('$root on an organization with no lineage FAILS instead of silently self-targeting', async () => {
    // Returning o_lone would make "escalate to group" mean "approve in place" —
    // the exact silent misrouting D9 exists to prevent.
    await expect(resolve(makeDeps(), '$root', 'o_lone')).rejects.toThrow(
      /VALIDATION_FAILED.*no 'parent_organization_id' lineage/,
    );
  });

  it('$parent at the root of a group fails rather than resolving to nothing', async () => {
    await expect(resolve(makeDeps(), '$parent', 'o_group')).rejects.toThrow(/VALIDATION_FAILED.*no parent/);
  });
});

describe('resolveApproverDirectoryOrg — a slug names one organization, bounded by the group', () => {
  it('accepts a SIBLING in the same group — the shared-services-centre shape', async () => {
    // o_ssc is not an ancestor of o_plant; it shares the root. This is why the
    // rule is "shares a root", not "is an ancestor".
    await expect(resolve(makeDeps(), 'acme-ssc', 'o_plant')).resolves.toBe('o_ssc');
  });

  it('refuses an organization in a DIFFERENT group — this is not a channel to any tenant', async () => {
    await expect(resolve(makeDeps(), 'rival-co', 'o_plant')).rejects.toThrow(
      /VALIDATION_FAILED.*not in the same group/,
    );
  });

  it('refuses an unknown slug and says an id is not accepted', async () => {
    // The most likely authoring mistake is pasting an organization id, which is
    // per-deployment and would make the flow unportable.
    await expect(resolve(makeDeps(), 'o_plant', 'o_plant')).rejects.toThrow(
      /VALIDATION_FAILED.*never an id/,
    );
  });
});

describe('resolveApproverDirectoryOrg — the guards', () => {
  it('refuses under a non-group posture instead of silently ignoring the declaration', async () => {
    // A deployment migrating group → isolated must not quietly reroute its
    // approvals; that is an audit event, not a config detail.
    const deps = makeDeps({ posture: () => 'isolated' });
    await expect(resolve(deps, '$root', 'o_plant')).rejects.toThrow(
      /VALIDATION_FAILED.*requires the 'group' tenancy posture.*isolated/,
    );
  });

  it('stands down when the posture is unknown — a minimal stack is not broken by a guard it cannot answer', async () => {
    const deps = makeDeps({ posture: () => undefined });
    await expect(resolve(deps, '$root', 'o_plant')).resolves.toBe('o_group');
  });

  it('refuses the declaration on an approver type that has no organization directory', async () => {
    // `user` names a person outright; an `organization` on it would have no
    // effect. An author who wrote it believed it did something.
    await expect(resolve(makeDeps(), '$root', 'o_plant', 'user', false)).rejects.toThrow(
      /VALIDATION_FAILED.*would have no effect/,
    );
  });

  it('refuses when the request carries no organization at all', async () => {
    await expect(resolve(makeDeps(), '$root', null)).rejects.toThrow(
      /VALIDATION_FAILED.*carries no organization/,
    );
  });

  it('survives a cycle in the grouping metadata instead of looping forever', async () => {
    const deps = makeDeps();
    (deps.engine.find as any) = vi.fn(async (object: string, opts: any) => {
      if (object !== 'sys_organization') return [];
      const id = opts?.where?.id;
      // a → b → a
      if (id === 'a') return [{ id: 'a', slug: 'a', parent_organization_id: 'b' }];
      if (id === 'b') return [{ id: 'b', slug: 'b', parent_organization_id: 'a' }];
      return [];
    });
    // Terminates; the cycle is broken and whatever it settles on is bounded.
    await expect(resolve(deps, '$parent', 'a')).resolves.toBe('b');
  });
});

describe('filterApproversWhoCanRead — routing to someone the wall hides is a silent failure', () => {
  it('keeps approvers who hold a membership in the REQUEST org', async () => {
    const deps = makeDeps({ members: [{ user_id: 'u_cfo', organization_id: 'o_plant' }] });
    const kept = await filterApproversWhoCanRead(deps, ['u_cfo'], 'o_plant', {
      approverType: 'position', value: 'cfo', directoryOrgId: 'o_group',
    });
    expect(kept).toEqual(['u_cfo']);
    expect(deps.warn).not.toHaveBeenCalled();
  });

  it('drops an approver with no membership there, and says exactly why', async () => {
    // She holds `cfo` in the group org but no membership in the plant, so D2's
    // union would hide the request from her: routing succeeds, then she opens a
    // task she cannot open. Convert that into the empty-slate path the node
    // already has a policy for.
    const deps = makeDeps({ members: [{ user_id: 'u_ok', organization_id: 'o_plant' }] });
    const kept = await filterApproversWhoCanRead(deps, ['u_ok', 'u_no_membership'], 'o_plant', {
      approverType: 'position', value: 'cfo', directoryOrgId: 'o_group',
    });
    expect(kept).toEqual(['u_ok']);
    expect(deps.warn).toHaveBeenCalledTimes(1);
    const msg = String(deps.warn.mock.calls[0][0]);
    expect(msg).toMatch(/u_no_membership|cross-organization approver/);
    expect(msg).toMatch(/Grant those users a membership|retarget/);
  });

  it('does NOT empty a live slate when membership is unreadable', async () => {
    // An infrastructure hiccup must not silently unstaff a pending approval:
    // routing to someone who may not see it is recoverable, emptying is not.
    const deps = makeDeps();
    (deps.engine.find as any) = vi.fn(async () => { throw new Error('driver hiccup'); });
    const kept = await filterApproversWhoCanRead(deps, ['u1', 'u2'], 'o_plant', {
      approverType: 'position', directoryOrgId: 'o_group',
    });
    expect(kept).toEqual(['u1', 'u2']);
  });
});
