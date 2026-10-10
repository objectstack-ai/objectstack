// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22646] A field declared `internal: true` is withheld from every generic
 * exit (#21197). The ROW position honours that by OMISSION (pinned in
 * `api-key-hash-not-serialized.dogfood.test.ts`); the EVALUATE positions of the
 * generic data door did not. On `origin/main`, for `sys_api_key.key` (the
 * stored auth digest, declared `internal: true`), the data door answered a
 * FILTER on it (a confirmation oracle), a SORT by it (an order oracle), and
 * refused a GROUP-BY / aggregate as an undeclared `500 INTERNAL_ERROR`.
 *
 * This drives every position through the real HTTP stack as BOTH a seeded
 * platform admin and an ordinary member, because the gap bound both (#21197):
 * a refusal that only an admin saw would miss the member the row strip binds,
 * and vice versa. Each position must answer `400 INVALID_FIELD` — a declared
 * ADR-0112 refusal, never a 200 and never a 500.
 *
 * The load-bearing NEGATIVE direction: the key must still AUTHENTICATE. The fix
 * refuses the generic data door, not the engine's privileged verifier
 * (`where: { key }` under a system context), so a strip that broke the lookup
 * would satisfy every "refused" assertion and break every login — asserted
 * last. The CONTROL (a filter on the ordinary `name` column) must still answer
 * 200, or "refused" would pass for a door that refuses everything.
 *
 * ⚠️ No reproduction recipe and no value is stated here: the credential is
 * minted through its one real door and never read back.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const OBJ = 'sys_api_key';
const F = 'key';

describe('[#22646] the data door refuses sys_api_key.key in every evaluate position, for member and admin', () => {
    let stack: VerifyStack;
    const personas: Record<string, { token: string; id: string }> = {};

    const mint = async (token: string, name: string): Promise<string> => {
        const res = await stack.apiAs(token, 'POST', '/keys', { name });
        expect(res.status, await res.clone().text()).toBe(201);
        const body: any = await res.json();
        expect(typeof body?.data?.key).toBe('string'); // show-once mint path — the one time a client sees it
        return String(body.data.id);
    };

    beforeAll(async () => {
        stack = await bootShowcase({});
        const adminToken = await stack.signIn();
        const memberToken = await stack.signUp('internal.positions.22646@verify.test');
        personas.admin = { token: adminToken, id: await mint(adminToken, 'pos-admin') };
        personas.member = { token: memberToken, id: await mint(memberToken, 'pos-member') };
    }, 180_000);

    afterAll(async () => { await stack?.stop?.(); });

    // Positions driven through the two data-door routes. `GET` carries the wire
    // spellings ($orderby); `POST …/query` carries the QueryAST body.
    const positions: Array<[string, (token: string) => Promise<Response>]> = [
        ['filter (POST where $eq)', (t) => stack.apiAs(t, 'POST', `/data/${OBJ}/query`, { where: { [F]: { $eq: 'x' } } })],
        ['filter (GET implicit)', (t) => stack.apiAs(t, 'GET', `/data/${OBJ}?${F}=x`)],
        ['sort (GET $orderby)', (t) => stack.apiAs(t, 'GET', `/data/${OBJ}?$orderby=${F}`)],
        ['group-by (was 500)', (t) => stack.apiAs(t, 'POST', `/data/${OBJ}/query`, { groupBy: [F], aggregations: [{ function: 'count', alias: 'n' }] })],
        ['aggregate operand (was 500)', (t) => stack.apiAs(t, 'POST', `/data/${OBJ}/query`, { aggregations: [{ function: 'max', field: F, alias: 'm' }] })],
        ['aggregation filter', (t) => stack.apiAs(t, 'POST', `/data/${OBJ}/query`, { aggregations: [{ function: 'count', alias: 'n', filter: { [F]: 'x' } }] })],
    ];

    for (const [label, call] of positions) {
        for (const persona of ['admin', 'member'] as const) {
            it(`${label} — ${persona}: 400 INVALID_FIELD`, async () => {
                const res = await call(personas[persona]!.token);
                expect(res.status, `${label}/${persona}: ${await res.clone().text()}`).toBe(400);
                const body: any = await res.json();
                expect(body?.error?.code ?? body?.code).toBe('INVALID_FIELD');
            });
        }
    }

    it('CONTROL — a filter on the ordinary `name` column still answers 200 (admin)', async () => {
        const res = await stack.apiAs(personas.admin!.token, 'POST', `/data/${OBJ}/query`, { where: { name: 'pos-admin' } });
        expect(res.status, await res.clone().text()).toBe(200);
    });

    it('CONTROL — a sort on the ordinary `name` column still answers 200 (member)', async () => {
        const res = await stack.apiAs(personas.member!.token, 'GET', `/data/${OBJ}?$orderby=name`);
        expect(res.status, await res.clone().text()).toBe(200);
    });

    it('NEGATIVE — the key still authenticates: the engine verifier lookup is untouched', async () => {
        // Mint a fresh key and use it as the ONLY credential on a real read.
        const res = await stack.apiAs(personas.admin!.token, 'POST', '/keys', { name: 'pos-auth' });
        expect(res.status).toBe(201);
        const raw = String((await res.json())?.data?.key);
        const authed = await stack.api(`/data/${OBJ}?$top=1`, { headers: { 'x-api-key': raw } });
        // 200 proves the verifier's `where: { key: hash }` lookup still resolves
        // the principal — the fix refuses the generic data door, not the engine.
        expect(authed.status, await authed.clone().text()).toBe(200);
    });
});
