// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21046] Discovery reports which optional `/auth` route families are
 * mounted — the dispatcher producer's half (`getDiscoveryInfo()`, served at
 * `/.well-known/objectstack` on every composition and at `/discovery` on a
 * REST-less one).
 *
 * The #15920 ruling keeps the plain `404` an unmounted admin-family route
 * answers and names discovery as where an SDK caller asks before building those
 * URLs; discovery carried only `routes.auth`, the same with the admin plugin
 * off and on. The directive the fix carries is "no second derivation": the
 * answer is the auth service's OWN public config — what `GET /auth/config`
 * serves — read through `readAuthFamilies`, never a re-reading of plugin
 * configuration or environment here.
 *
 * So the stand-in below answers `getPublicConfig()` and nothing else, and the
 * pins are written from the service's answer outward: whatever it says, the
 * document says, in both directions. A producer that hard-coded either value,
 * or read anything but this method, goes red on one of the two cases.
 * `packages/qa/dogfood/test/discovery-auth-families.dogfood.test.ts` is the
 * boot-level pin that the real `AuthManager` and the wire agree with it.
 */

import { describe, it, expect, vi } from 'vitest';
import { DiscoverySchema, readAuthFamilies } from '@objectstack/spec/api';
import { HttpDispatcher } from './http-dispatcher.js';

const PREFIX = '/api/v1';

/** A dispatcher whose kernel resolves exactly the `auth` slot under test. */
function dispatcherWithAuth(auth: unknown): HttpDispatcher {
    const kernel = {
        context: { getService: () => null },
        getService: (name: string) => (name === 'auth' ? auth : null),
    } as any;
    return new HttpDispatcher(kernel);
}

/** An auth service whose public config — the `/auth/config` body — says `admin`. */
function authAnswering(admin: boolean) {
    return {
        handleRequest: async () => new Response(null, { status: 404 }),
        verify: async () => ({ success: false }),
        getPublicConfig: vi.fn(() => ({
            emailPassword: { enabled: true },
            socialProviders: [],
            features: { admin, organization: true, twoFactor: false },
        })),
    };
}

describe('[#21046] getDiscoveryInfo() reports the auth families the auth service says it mounts', () => {
    for (const admin of [false, true]) {
        it(`reports authFamilies.admin: ${admin} when /auth/config's source says ${admin}`, async () => {
            const auth = authAnswering(admin);
            const info: any = await dispatcherWithAuth(auth).getDiscoveryInfo(PREFIX);

            expect(info.authFamilies).toEqual({ admin });
            // Read from the service's own public config — the one source.
            expect(auth.getPublicConfig).toHaveBeenCalled();
            // …and the very value the shared reader produces from it, so the
            // two discovery producers cannot hold two readings of one service.
            expect(info.authFamilies).toEqual(readAuthFamilies(auth));
            // An auth surface to have families at all.
            expect(info.routes.auth).toBe(`${PREFIX}/auth`);

            const parsed = DiscoverySchema.safeParse(info);
            expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
            expect(parsed.success && parsed.data.authFamilies).toEqual({ admin });
        });
    }

    it('emits no `authFamilies` when no auth service is registered (no auth surface either)', async () => {
        const info: any = await dispatcherWithAuth(null).getDiscoveryInfo(PREFIX);

        expect(Object.prototype.hasOwnProperty.call(info, 'authFamilies')).toBe(false);
        expect(info.routes.auth).toBeUndefined();
    });

    it('emits no `authFamilies` when the auth service publishes no public config — it cannot say, so it does not guess', async () => {
        const { getPublicConfig: _omitted, ...withoutConfig } = authAnswering(true);
        const info: any = await dispatcherWithAuth(withoutConfig).getDiscoveryInfo(PREFIX);

        expect(Object.prototype.hasOwnProperty.call(info, 'authFamilies')).toBe(false);
        // The auth surface itself is still advertised: absence of the families
        // answer is "unknown", not "no auth".
        expect(info.routes.auth).toBe(`${PREFIX}/auth`);
    });

    it('a throwing public config leaves the document answerable and claims nothing', async () => {
        const auth = {
            ...authAnswering(true),
            getPublicConfig: () => {
                throw new Error('auth config unreadable');
            },
        };
        const info: any = await dispatcherWithAuth(auth).getDiscoveryInfo(PREFIX);

        expect(Object.prototype.hasOwnProperty.call(info, 'authFamilies')).toBe(false);
        expect(DiscoverySchema.safeParse(info).success).toBe(true);
    });
});
