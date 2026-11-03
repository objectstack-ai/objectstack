// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29613, ADR-0146 D8 item 2] `/me/apps` lists the apps the protocol SERVES
// when the protocol service is present, so a `.custom` pair's published
// override of a base's app is listed over the base's app.
//
// The override used to reach `/me/apps` only through the registry: the
// hydrator registered it in the registry's bare slot wearing the base's
// envelope, and `registry.getAllApps()` listed it there beside the base's own
// app. Since the override is served from its row (`declinesStoredRow` admits
// the pair's declared override), the bare slot holds no copy of it, and the
// registry lists the base's app alone. The protocol's served list
// (`getMetaItems`, what `GET /meta/app` serves) answers the override.
//
// Pinned both ways: with a protocol service the served list is the source,
// and the registry is not read; with none, today's registry path is unchanged.
// A protocol whose list read fails is answered from the registry.

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_APPS = '/api/v1/me/apps';
const USER = 'usr_member';

/** The registry's list: the base's app alone (no bare-slot copy of the override). */
const REGISTRY_APPS = [{ name: 'showcase', label: 'Shipped label', _packageId: 'com.example.showcase' }];
/** The protocol's served list: the pair's override, served as the base's item. */
const SERVED_APPS = [{ name: 'showcase', label: 'Edited label', _packageId: 'com.example.showcase' }];

function mount(protocol: 'served' | 'throws' | 'absent' | 'no-list-read') {
    let registryReads = 0;
    const warnings: string[] = [];
    const services: Record<string, unknown> = {
        auth: {
            api: {
                getSession: async () => ({
                    user: { id: USER, email: 'member@example.com' },
                    session: { activeOrganizationId: 'org_active' },
                }),
            },
        },
        objectql: {
            find: async () => [],
            registry: {
                getAllApps: () => {
                    registryReads += 1;
                    return REGISTRY_APPS;
                },
                getAllObjects: () => [],
            },
            getSchema: () => undefined,
        },
        metadata: { list: async () => [] as unknown[] },
    };
    if (protocol === 'served') {
        services.protocol = { getMetaItems: async ({ type }: { type: string }) => ({ type, items: type === 'app' ? SERVED_APPS : [] }) };
    } else if (protocol === 'throws') {
        services.protocol = {
            getMetaItems: async () => {
                throw new Error('metadata store unavailable');
            },
        };
    } else if (protocol === 'no-list-read') {
        services.protocol = { getDiscovery: async () => ({}) };
    }
    const app = new Hono();
    registerCurrentUserEndpoints({
        rawApp: app,
        ctx: {
            logger: { debug() {}, warn(message: string) { warnings.push(message); } },
            getService: <T,>(name: string): T => {
                if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
                return services[name] as T;
            },
        },
    });
    return { app, registryReads: () => registryReads, warnings };
}

const labelsOf = async (app: Hono): Promise<string[]> => {
    const res = await app.request(`http://localhost${ME_APPS}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { apps: Array<{ label: string }> }).apps.map((a) => a.label);
};

describe('[#29613] /me/apps lists the protocol\'s served apps', () => {
    it('with a protocol service: the served list, the pair\'s override over the base\'s app; the registry is not read', async () => {
        const m = mount('served');
        expect(await labelsOf(m.app)).toEqual(['Edited label']);
        expect(m.registryReads()).toBe(0);
    });

    it('with no protocol service: the registry, as before', async () => {
        const m = mount('absent');
        expect(await labelsOf(m.app)).toEqual(['Shipped label']);
        expect(m.registryReads()).toBe(1);
    });

    it('with a protocol service that has no list read: the registry, as before', async () => {
        const m = mount('no-list-read');
        expect(await labelsOf(m.app)).toEqual(['Shipped label']);
        expect(m.registryReads()).toBe(1);
    });

    it('a protocol list read that fails: answered from the registry, and warned', async () => {
        const m = mount('throws');
        expect(await labelsOf(m.app)).toEqual(['Shipped label']);
        expect(m.registryReads()).toBe(1);
        expect(m.warnings.some((w) => w.includes('/me/apps'))).toBe(true);
    });
});
