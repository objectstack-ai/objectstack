// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D3] A `runAs: 'user'` run whose acting user is an AI service
 * account carries `principalKind: 'agent'` onto every data operation it makes,
 * so the security plugin evaluates the run as the agent principal it is —
 * the agent ceiling, no member baseline — whether run setup resolved the
 * account's grants (a record-change trigger hands it only a `userId`) or a
 * door forwarded them with the kind. A person's run carries no kind (CONTROL),
 * and a decision that moves the run to a decider drops the trigger user's
 * kind with the rest of their facts.
 */

import { describe, it, expect, vi } from 'vitest';

import { seedRunGrants } from './run-resume.js';
import { resolveRunDataContext, runPrincipalKind } from './runtime-identity.js';

const host = (grants: Record<string, unknown>) => ({
    userGrantsResolver: vi.fn(async () => grants as any),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
});

const ACCOUNT_GRANTS = { positions: ['org_member'], permissions: ['lead_reader'], org_user_ids: ['u_bot'], posture: 'MEMBER', principalKind: 'agent' };
const PERSON_GRANTS = { positions: ['org_member', 'everyone'], permissions: ['lead_reader'], org_user_ids: ['u_mia'], posture: 'MEMBER' };

describe('[ADR-0151 D3] an AI service account\'s run is an agent principal on every write', () => {
    it('run setup seeds the kind from the resolver, and every data operation carries it', async () => {
        const run: any = { userId: 'u_bot', tenantId: 'org_1', runAs: 'user' };
        await seedRunGrants.call(host(ACCOUNT_GRANTS), 'lead_triage', run, 'triggering');
        expect(run.principalKind).toBe('agent');
        expect(runPrincipalKind(run)).toBe('agent');
        expect(resolveRunDataContext(run)).toMatchObject({ userId: 'u_bot', principalKind: 'agent', permissions: ['lead_reader'] });
    });

    it('a door-forwarded kind beside forwarded grants is kept: setup does not re-resolve them', async () => {
        const run: any = { userId: 'u_bot', tenantId: 'org_1', runAs: 'user', positions: ['org_member'], permissions: ['lead_reader'], principalKind: 'agent', email: 'b@x.invalid' };
        const h = host(ACCOUNT_GRANTS);
        await seedRunGrants.call(h, 'lead_triage', run, 'triggering');
        expect(resolveRunDataContext(run)).toMatchObject({ principalKind: 'agent' });
    });

    it('a kind forwarded WITHOUT grants is not kept on its own: it is re-seeded only by the resolution', async () => {
        const run: any = { userId: 'u_mia', tenantId: 'org_1', runAs: 'user', principalKind: 'agent' };
        await seedRunGrants.call(host(PERSON_GRANTS), 'lead_triage', run, 'triggering');
        expect(run.principalKind).toBeUndefined();
        expect('principalKind' in (resolveRunDataContext(run) as object)).toBe(false);
    });

    it('CONTROL: a person\'s run carries no kind', async () => {
        const run: any = { userId: 'u_mia', tenantId: 'org_1', runAs: 'user' };
        await seedRunGrants.call(host(PERSON_GRANTS), 'lead_triage', run, 'triggering');
        expect(run.principalKind).toBeUndefined();
        expect('principalKind' in (resolveRunDataContext(run) as object)).toBe(false);
    });

    it('only the literal agent kind is read', () => {
        for (const value of ['human', 'AGENT', '', undefined, 1]) {
            expect(runPrincipalKind({ principalKind: value } as any)).toBeUndefined();
        }
    });
});
