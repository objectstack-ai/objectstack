// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    PLATFORM_SSO_PROVIDER_ID,
    derivePlatformSsoClientId,
    derivePlatformSsoClientSecret,
    buildPlatformSsoRedirectUri,
    seedPlatformSsoClient,
    backfillPlatformSsoClients,
} from './platform-sso.js';

describe('platform-sso key derivation', () => {
    it('client id is deterministic and project-scoped', () => {
        expect(derivePlatformSsoClientId('abc')).toBe('project_abc');
        expect(derivePlatformSsoClientId('p_42')).toBe('project_p_42');
    });

    it('client secret is deterministic for a given (baseSecret, projectId)', () => {
        const s1 = derivePlatformSsoClientSecret('master', 'abc');
        const s2 = derivePlatformSsoClientSecret('master', 'abc');
        expect(s1).toBe(s2);
        expect(s1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('client secret differs across projects', () => {
        expect(derivePlatformSsoClientSecret('master', 'a'))
            .not.toBe(derivePlatformSsoClientSecret('master', 'b'));
    });

    it('client secret rotates with the base secret', () => {
        expect(derivePlatformSsoClientSecret('old', 'abc'))
            .not.toBe(derivePlatformSsoClientSecret('new', 'abc'));
    });

    it('hashPlatformSsoClientSecret matches better-auth oauth-provider defaultHasher (SHA-256 base64url no padding)', async () => {
        const { hashPlatformSsoClientSecret } = await import('./platform-sso.js');
        // Hand-computed: SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        // base64url (no pad) of that = LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ
        expect(hashPlatformSsoClientSecret('hello'))
            .toBe('LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ');
        // Deterministic
        expect(hashPlatformSsoClientSecret('x')).toBe(hashPlatformSsoClientSecret('x'));
        // No '=' padding, no '+' or '/'
        const h = hashPlatformSsoClientSecret('any-input');
        expect(h).not.toMatch(/[=+/]/);
    });

    it('redirect uri matches better-auth genericOAuth callback shape', () => {
        expect(buildPlatformSsoRedirectUri('crm.example.com'))
            .toBe(`https://crm.example.com/api/v1/auth/oauth2/callback/${PLATFORM_SSO_PROVIDER_ID}`);
        // Already-prefixed inputs are preserved.
        expect(buildPlatformSsoRedirectUri('http://localhost:3000'))
            .toBe(`http://localhost:3000/api/v1/auth/oauth2/callback/${PLATFORM_SSO_PROVIDER_ID}`);
    });
});

function createMockQl(initialRows: Record<string, any[]> = {}) {
    const tables: Record<string, any[]> = { ...initialRows };
    return {
        tables,
        async find(object: string, query: any) {
            const list = tables[object] ?? [];
            if (!query?.where) return list;
            return list.filter((row) =>
                Object.entries(query.where).every(([k, v]) => row[k] === v),
            );
        },
        async insert(object: string, data: any) {
            tables[object] = [...(tables[object] ?? []), { ...data }];
            return data;
        },
        async update(object: string, data: any, where: any) {
            const list = tables[object] ?? [];
            tables[object] = list.map((row) => {
                const matches = Object.entries(where?.where ?? {}).every(([k, v]) => row[k] === v);
                return matches ? { ...row, ...data } : row;
            });
            return null;
        },
    };
}

describe('seedPlatformSsoClient', () => {
    it('creates a sys_oauth_application row on first call', async () => {
        const ql = createMockQl({ sys_oauth_application: [] });
        await seedPlatformSsoClient({
            ql,
            projectId: 'proj1',
            hostname: 'one.example.com',
            baseSecret: 'master',
        });
        expect(ql.tables.sys_oauth_application).toHaveLength(1);
        const row = ql.tables.sys_oauth_application[0];
        expect(row.client_id).toBe('project_proj1');
        // client_secret is stored as SHA-256+base64url of the derived plaintext
        // (better-auth oauth-provider defaultHasher format), NOT the raw hex.
        expect(row.client_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(JSON.parse(row.redirect_uris)).toEqual([
            `https://one.example.com/api/v1/auth/oauth2/callback/${PLATFORM_SSO_PROVIDER_ID}`,
        ]);
        expect(row.skip_consent).toBe(true);
        expect(JSON.parse(row.grant_types)).toContain('authorization_code');
    });

    it('is idempotent — second call with same hostname is a no-op', async () => {
        const ql = createMockQl({ sys_oauth_application: [] });
        await seedPlatformSsoClient({ ql, projectId: 'p', hostname: 'h.example.com', baseSecret: 'm' });
        await seedPlatformSsoClient({ ql, projectId: 'p', hostname: 'h.example.com', baseSecret: 'm' });
        expect(ql.tables.sys_oauth_application).toHaveLength(1);
    });

    it('merges a new redirect_uri into the existing row', async () => {
        const ql = createMockQl({ sys_oauth_application: [] });
        await seedPlatformSsoClient({ ql, projectId: 'p', hostname: 'first.example.com', baseSecret: 'm' });
        await seedPlatformSsoClient({ ql, projectId: 'p', hostname: 'second.example.com', baseSecret: 'm' });
        const uris: string[] = JSON.parse(ql.tables.sys_oauth_application[0].redirect_uris);
        expect(uris).toHaveLength(2);
        expect(uris.some((u) => u.includes('first.example.com'))).toBe(true);
        expect(uris.some((u) => u.includes('second.example.com'))).toBe(true);
    });

    it('repairs a malformed existing row (wrong client_secret, empty redirect_uris/grant_types, skip_consent=false)', async () => {
        const ql = createMockQl({
            sys_oauth_application: [{
                id: 'oauthc_proj1',
                client_id: 'project_proj1',
                client_secret: 'WRONG_OLD_SECRET',
                redirect_uris: '[]',
                grant_types: '[]',
                skip_consent: false,
                type: 'web',
                name: 'old name',
            }],
        });
        await seedPlatformSsoClient({
            ql,
            projectId: 'proj1',
            hostname: 'one.example.com',
            baseSecret: 'master',
        });
        expect(ql.tables.sys_oauth_application).toHaveLength(1);
        const row = ql.tables.sys_oauth_application[0];
        // client_secret rewritten to the derived+hashed value (43-char base64url)
        expect(row.client_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(row.client_secret).not.toBe('WRONG_OLD_SECRET');
        // redirect_uris merged in
        expect(JSON.parse(row.redirect_uris)).toContain(
            `https://one.example.com/api/v1/auth/oauth2/callback/${PLATFORM_SSO_PROVIDER_ID}`,
        );
        // grant_types repaired
        expect(JSON.parse(row.grant_types)).toContain('authorization_code');
        // skip_consent flipped back on
        expect(row.skip_consent).toBe(true);
        // disabled set explicitly
        expect(row.disabled).toBe(false);
        // existing name preserved (not overwritten if already non-empty)
        expect(row.name).toBe('old name');
    });

    it('skips seed when baseSecret is empty', async () => {
        const ql = createMockQl({ sys_oauth_application: [] });
        await seedPlatformSsoClient({ ql, projectId: 'p', hostname: 'h.example.com', baseSecret: '' });
        expect(ql.tables.sys_oauth_application).toHaveLength(0);
    });
});

describe('backfillPlatformSsoClients', () => {
    it('seeds every project that lacks an oauth client', async () => {
        const ql = createMockQl({
            sys_project: [
                { id: 'p1', hostname: 'one.example.com', status: 'active' },
                { id: 'p2', hostname: 'two.example.com', status: 'active' },
            ],
            sys_oauth_application: [],
        });
        const r = await backfillPlatformSsoClients({ ql, baseSecret: 'm' });
        expect(r.scanned).toBe(2);
        expect(r.seeded).toBe(2);
        expect(ql.tables.sys_oauth_application).toHaveLength(2);
    });

    it('skips projects that already have an oauth client', async () => {
        const ql = createMockQl({
            sys_project: [{ id: 'p1', hostname: 'one.example.com', status: 'active' }],
            sys_oauth_application: [{
                id: 'oauthc_p1',
                client_id: 'project_p1',
                redirect_uris: JSON.stringify([
                    `https://one.example.com/api/v1/auth/oauth2/callback/${PLATFORM_SSO_PROVIDER_ID}`,
                ]),
            }],
        });
        const r = await backfillPlatformSsoClients({ ql, baseSecret: 'm' });
        expect(r.scanned).toBe(1);
        expect(r.seeded).toBe(0);
        expect(ql.tables.sys_oauth_application).toHaveLength(1);
    });
});
