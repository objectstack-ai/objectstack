// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34777] `meta.getItem` takes `state: 'draft'` and sends `?state=draft`, the
 * strict draft read the REST door serves (`item._diagnostics` carries what a
 * publish of the draft would refuse, #26707), on BOTH declarations: the
 * unscoped client and the environment-scoped twin (one door, #7019).
 *
 * The two declarations are textually alike, so every claim is made once per
 * client. `'active'` is the default said out loud and sends nothing, so a call
 * without the member, or with `'active'`, is the URL it was before.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackClient } from './index';

const BASE = 'http://localhost:9';
const CRM = 'com.acme.crm';

function recordingClient() {
    const sent: string[] = [];
    const client = new ObjectStackClient({
        baseUrl: BASE,
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
            sent.push(`${(init?.method ?? 'GET').toUpperCase()} ${String(input)}`);
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'application/json' }),
                json: async () => ({ success: true, data: { type: 'view', name: 'v', item: {} } }),
                text: async () => '{}',
            } as unknown as Response;
        }) as typeof fetch,
    });
    return { client, scoped: client.environment('env_1'), sent };
}

const SURFACES = [
    { name: 'unscoped', prefix: `${BASE}/api/v1/meta`, pick: (c: ReturnType<typeof recordingClient>) => c.client.meta },
    { name: 'scoped', prefix: `${BASE}/api/v1/environments/env_1/meta`, pick: (c: ReturnType<typeof recordingClient>) => c.scoped.meta },
];

describe('[#34777] meta.getItem `state: \'draft\'` sends `?state=draft`', () => {
    for (const surface of SURFACES) {
        it(`${surface.name}: beside \`?package=\`, the package's draft`, async () => {
            const c = recordingClient();
            await surface.pick(c).getItem('view', 'v', { packageId: CRM, state: 'draft' });
            expect(c.sent).toEqual([`GET ${surface.prefix}/view/v?package=${CRM}&state=draft`]);
        });

        it(`${surface.name}: alone`, async () => {
            const c = recordingClient();
            await surface.pick(c).getItem('view', 'v', { state: 'draft' });
            expect(c.sent).toEqual([`GET ${surface.prefix}/view/v?state=draft`]);
        });

        it(`${surface.name}: CONTROL — omitted or \`'active'\`, the URL it always sent`, async () => {
            const c = recordingClient();
            await surface.pick(c).getItem('view', 'v');
            await surface.pick(c).getItem('view', 'v', { packageId: CRM });
            await surface.pick(c).getItem('view', 'v', { packageId: CRM, state: 'active' });
            expect(c.sent).toEqual([
                `GET ${surface.prefix}/view/v`,
                `GET ${surface.prefix}/view/v?package=${CRM}`,
                `GET ${surface.prefix}/view/v?package=${CRM}`,
            ]);
        });
    }
});
