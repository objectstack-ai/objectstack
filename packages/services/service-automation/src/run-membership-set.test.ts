// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0093 D8.1, as amended] Under every tenancy posture, a person's data
 * access requires a current membership in the organization, judged on each
 * request. The organization wall reads that membership off the context's
 * membership set (`accessible_org_ids`). A `runAs:'user'` run's data operations
 * are the acting user's, so they carry that user's set: the one the launch
 * door handed the run (an empty set included), or the one run setup resolves
 * through the same resolver the request path uses. A `runAs:'system'` run
 * carries none.
 */

import { describe, it, expect, vi } from 'vitest';

import { seedRunGrants } from './run-resume.js';
import { resolveRunDataContext, runAccessibleOrgIds } from './runtime-identity.js';

const host = (grants: Record<string, unknown> | undefined) => ({
    userGrantsResolver: vi.fn(async () => grants as any),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
});

const MEMBER_GRANTS = { positions: ['org_member', 'everyone'], permissions: ['lead_reader'], org_user_ids: ['u_mia'], accessible_org_ids: ['org_1'], email: 'mia@x.invalid' };

describe('[ADR-0093 D8.1] a runAs:\'user\' run carries the acting user\'s membership set', () => {
    it('run setup seeds the set from the resolver, and every data operation carries it', async () => {
        const run: any = { userId: 'u_mia', tenantId: 'org_1', runAs: 'user' };
        await seedRunGrants.call(host(MEMBER_GRANTS), 'lead_triage', run, 'triggering');
        expect(runAccessibleOrgIds(run)).toEqual(['org_1']);
        expect(resolveRunDataContext(run)).toMatchObject({ userId: 'u_mia', accessible_org_ids: ['org_1'] });
    });

    it('an empty resolved set is carried as such', async () => {
        const run: any = { userId: 'u_gone', tenantId: 'org_1', runAs: 'user' };
        await seedRunGrants.call(host({ ...MEMBER_GRANTS, accessible_org_ids: [] }), 'lead_triage', run, 'triggering');
        expect(resolveRunDataContext(run)).toMatchObject({ accessible_org_ids: [] });
    });

    it('a set the launch door handed the run is kept, beside forwarded grants, and asks the resolver nothing', async () => {
        const run: any = {
            userId: 'u_mia', tenantId: 'org_1', runAs: 'user',
            positions: ['org_member'], permissions: ['lead_reader'], org_user_ids: ['u_mia'], email: 'mia@x.invalid',
            accessible_org_ids: [],
        };
        const h = host(MEMBER_GRANTS);
        await seedRunGrants.call(h, 'lead_triage', run, 'triggering');
        expect(h.userGrantsResolver).not.toHaveBeenCalled();
        expect(resolveRunDataContext(run)).toMatchObject({ accessible_org_ids: [] });
    });

    it('forwarded grants without a set still resolve the set', async () => {
        const run: any = {
            userId: 'u_mia', tenantId: 'org_1', runAs: 'user',
            positions: ['org_member'], permissions: ['lead_reader'], org_user_ids: ['u_mia'], email: 'mia@x.invalid',
        };
        const h = host(MEMBER_GRANTS);
        await seedRunGrants.call(h, 'lead_triage', run, 'triggering');
        expect(h.userGrantsResolver).toHaveBeenCalledTimes(1);
        expect(resolveRunDataContext(run)).toMatchObject({ accessible_org_ids: ['org_1'], permissions: ['lead_reader'] });
    });

    it('a set run setup cannot resolve is an empty one: the run is judged as a person who holds no current membership', async () => {
        const run: any = { userId: 'u_mia', tenantId: 'org_1', runAs: 'user' };
        const h = { ...host(MEMBER_GRANTS), userGrantsResolver: vi.fn(async () => { throw new Error('grants store unreachable'); }) };
        await seedRunGrants.call(h as any, 'lead_triage', run, 'triggering');
        expect(resolveRunDataContext(run)).toMatchObject({ userId: 'u_mia', accessible_org_ids: [] });
        expect(h.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('a carried set survives a failed resolution of the rest', async () => {
        const run: any = { userId: 'u_mia', tenantId: 'org_1', runAs: 'user', accessible_org_ids: ['org_1'] };
        const h = { ...host(MEMBER_GRANTS), userGrantsResolver: vi.fn(async () => { throw new Error('grants store unreachable'); }) };
        await seedRunGrants.call(h as any, 'lead_triage', run, 'triggering');
        expect(resolveRunDataContext(run)).toMatchObject({ accessible_org_ids: ['org_1'] });
    });

    it('a runAs:\'system\' run carries no set', async () => {
        const run: any = { userId: 'u_mia', tenantId: 'org_1', runAs: 'system' };
        const h = host(MEMBER_GRANTS);
        await seedRunGrants.call(h, 'lead_triage', run, 'triggering');
        expect('accessible_org_ids' in (resolveRunDataContext(run) as object)).toBe(false);
    });

    it('only an array is read as a set', () => {
        for (const value of ['org_1', null, undefined, 1, {}]) {
            expect(runAccessibleOrgIds({ accessible_org_ids: value } as any)).toBeUndefined();
        }
        expect(runAccessibleOrgIds({ accessible_org_ids: [] } as any)).toEqual([]);
    });
});
