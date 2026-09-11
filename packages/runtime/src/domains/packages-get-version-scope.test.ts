// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /api/v1/packages/:id?version=` is a VERSION-SCOPED read, and its answer
 * is distinguishable from the unversioned one (#17416).
 *
 * ## The defect
 *
 * The route accepted `?version=` and the only surface serving it never read the
 * parameter. `ScopedEnvironmentClient.packages.get(id, version)` declares
 * `version?: string` and appends it, so `?version=99.0.0` against an installed
 * `1.0.0` was answered `200` with the `1.0.0` row — and no status, header or
 * field told the caller which of the two reads it got. The handler that
 * honoured it (with the store predicate `AND version = ?`) went with the REST
 * twin in #14503 / #16628; this dispatcher domain never had it to inherit.
 *
 * ## What is pinned, and why each half is here
 *
 * The card's acceptance criterion is a PAIR, because either half alone passes
 * for the wrong reason:
 *
 *  - **§1 the discriminating pin** — the same request with and without
 *    `?version=<a version that is not installed>` must not produce the same
 *    response. Asserted as `status` PLUS the discriminating field (the error
 *    message naming the version, and the body carrying no package row), ⛔
 *    never as "it returned 200": that reading is precisely what hid this
 *    defect for the whole of its life.
 *  - **§2 the lit control** — the unversioned read still answers exactly as it
 *    did, down to the row it serves. A green that only exercised the new
 *    scoped path would also be green if the ordinary read were broken, and
 *    this door is the single implementation of the route.
 *
 * §3 pins the two requests that mean "the installed row" — no parameter and
 * `?version=latest` — as ONE request, which is the contract the deleted
 * handler published (`requested.value || 'latest'`). §4 pins the repeated
 * parameter as not-a-silent-success: `?version=a&version=b` carries two
 * conflicting intents, and the answer names what it saw rather than choosing.
 * ⚠️ §4 asserts the DEFECT CLASS is closed (no `200` with the installed row),
 * deliberately not the exact status, because the repo's one rule for a repeated
 * single-valued parameter answers `400 VALIDATION_ERROR` and is unreachable
 * from this package today — see `readRequestedVersion`'s header in
 * `packages.ts`. So this pin stays green when that rule lands here.
 *
 * ## The harness
 *
 * A real {@link SchemaRegistry} behind the real {@link HttpDispatcher}, the way
 * `packages-writable-verdict.test.ts` and `packages-readonly-gate.test.ts` next
 * door do it — so the rows under test are what `installPackage` actually
 * produces and the answers are the ones the composed door gives.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.acme.crm';
/** The version actually installed — the row every read below can legitimately serve. */
const INSTALLED = '1.0.0';
/** The card's own repro value: a version this registry does not hold. */
const ABSENT = '99.0.0';

function make() {
    const registry = new SchemaRegistry({ logLevel: 'silent' } as any);
    registry.installPackage({ id: PKG, name: PKG, version: INSTALLED, scope: 'project', type: 'app' } as any);
    const objectql = { registry, manifests: new Map<string, any>() };
    const kernel: any = {
        context: { getService: (name: string) => (name === 'objectql' ? objectql : null) },
    };
    return new HttpDispatcher(kernel);
}

/** Holds the ADR-0106 D4 read set; the caller gate is not this file's subject. */
const reader = (): any => ({
    request: {},
    environmentId: 'pkg-get-version-scope-test',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] },
});

/** `GET /packages/:id` with whatever query the case is about. */
async function get(query: Record<string, unknown>) {
    const dispatcher = make();
    const r = await dispatcher.handlePackages(`/${PKG}`, 'GET', undefined, query, reader());
    return { status: r.response?.status ?? 200, body: r.response?.body };
}

describe('#17416 GET /packages/:id — ?version= scopes the read', () => {
    describe('§1 the discriminating pin — with and without ?version= are not the same answer', () => {
        it('a non-installed ?version= is NOT answered with the installed row', async () => {
            const scoped = await get({ version: ABSENT });
            const unscoped = await get({});

            // The discriminating field, not the status alone.
            expect(scoped.status).toBe(404);
            expect(scoped.body?.error?.message).toContain(ABSENT);
            expect(scoped.body?.error?.message).toContain(INSTALLED);
            // ⛔ No package row rode out on the refusal.
            expect(scoped.body?.data).toBeUndefined();

            // ...and the SAME request without the parameter is a different answer.
            expect(unscoped.status).toBe(200);
            expect(unscoped.body?.data?.manifest?.version).toBe(INSTALLED);
            expect(scoped.status).not.toBe(unscoped.status);
            expect(scoped.body).not.toEqual(unscoped.body);
        });

        it('the installed version IS served when it is the one asked for', async () => {
            const r = await get({ version: INSTALLED });
            expect(r.status).toBe(200);
            expect(r.body?.data?.manifest?.id).toBe(PKG);
            expect(r.body?.data?.manifest?.version).toBe(INSTALLED);
        });

        it('an id this registry does not hold keeps the wording packages-single-door pins', async () => {
            const dispatcher = make();
            const r = await dispatcher.handlePackages('/com.absent.pkg', 'GET', undefined, { version: ABSENT }, reader());
            expect(r.response?.status).toBe(404);
            // ⛔ The id 404 is NOT re-worded by the version scope: a package that
            // is not here cannot be "at the wrong version".
            expect(r.response?.body?.error?.message).toBe(`Package 'com.absent.pkg' not found`);
        });
    });

    describe('§2 the lit control — the unversioned read is untouched', () => {
        it('answers 200 with the installed row and its writability verdict', async () => {
            const r = await get({});
            expect(r.status).toBe(200);
            expect(r.body?.success).toBe(true);
            expect(r.body?.data?.manifest?.id).toBe(PKG);
            expect(r.body?.data?.manifest?.version).toBe(INSTALLED);
            // The #14375 verdict the door has always stamped, still stamped.
            expect(r.body?.data?.writable).toBe(true);
        });

        it('is byte-identical to the read with no query object at all', async () => {
            const dispatcher = make();
            const withEmpty = await dispatcher.handlePackages(`/${PKG}`, 'GET', undefined, {}, reader());
            const withNone = await dispatcher.handlePackages(`/${PKG}`, 'GET', undefined, undefined, reader());
            expect(withNone.response?.status ?? 200).toBe(200);
            expect(withNone.response?.body).toEqual(withEmpty.response?.body);
        });
    });

    describe('§3 `latest` and absent name the SAME request', () => {
        it('?version=latest serves the installed row, exactly as no parameter does', async () => {
            const latest = await get({ version: 'latest' });
            const unscoped = await get({});
            expect(latest.status).toBe(200);
            expect(latest.body).toEqual(unscoped.body);
        });
    });

    describe('§4 a repeated ?version= is not resolved silently', () => {
        it('two conflicting values are not answered 200 with the installed row', async () => {
            const r = await get({ version: [ABSENT, INSTALLED] });
            // The defect class: a success carrying a row the caller did not ask for.
            expect(r.status).not.toBe(200);
            expect(r.body?.data).toBeUndefined();
            // It says what it saw rather than choosing one of the two.
            expect(r.body?.error?.message).toContain('supplied 2 times');
        });

        it('ONE occurrence encoded as a one-element array is one occurrence', async () => {
            const arr = await get({ version: [INSTALLED] });
            const str = await get({ version: INSTALLED });
            expect(arr.status).toBe(200);
            expect(arr.body).toEqual(str.body);
        });

        it('a one-element array naming an absent version still refuses', async () => {
            const r = await get({ version: [ABSENT] });
            expect(r.status).toBe(404);
            expect(r.body?.error?.message).toContain(ABSENT);
        });
    });
});
