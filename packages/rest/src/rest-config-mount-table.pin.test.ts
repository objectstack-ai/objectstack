// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15544] The MOUNT half of every `RestServerConfig` switch.
 *
 * The suite already pins what a switch NORMALIZES to
 * (`rest-sub-config-parse-not-cast.test.ts` §D) and the EFFECT of
 * `batch.maxBatchSize` (`rest-batch-size-cap.test.ts`). Nothing pinned the
 * direction in between: **that a `false` switch removes its route from the
 * mounted table.**
 *
 * That is the dangerous direction. A refactor that stops reading a switch at
 * the registrar — or reads the wrong one — leaves every existing test green:
 * the normalized config is still correct, the cap still works, and the route
 * is simply still mounted. The operator sets config that nothing honours,
 * which is the declared-not-enforced state ADR-0049 exists to catch, inside
 * the test suite meant to catch it.
 *
 * ⛔ This file pins CURRENT mount behaviour. It is not a judgement that each
 * switch's radius is the right one — where a radius disagrees with the
 * switch's own `describe()` that is a defect filed elsewhere (#15542 for
 * `metadata.endpoints.items`), and the table below records the radius as
 * MEASURED so such a defect is visible here rather than hidden.
 *
 * ## What is pinned, and why it is a diff rather than an existence check
 *
 * Every case asserts the SET DIFFERENCE between the all-true baseline table
 * and the switch-off table, in both directions. Two shapes make a per-route
 * existence check insufficient:
 *
 *   - `crud.operations.list` gates TWO mounts — `GET {dataPrefix}/:object` and
 *     `POST {dataPrefix}/:object/query`. The query door has no switch of its
 *     own, so a pin asserting "the list route disappeared" passes while half
 *     the intent is broken.
 *   - `metadata.endpoints.items` gates FOUR, one of them the write door
 *     `POST {prefix}/_migrate-stored`, while its `describe()` names one read.
 *
 * Asserting the difference is EXACTLY a named set catches a gate that grows a
 * route as loudly as one that loses a route.
 *
 * ## ⛔ ANTI-VACUITY — this pin is the exact shape that passes for free
 *
 * An assertion that a route is ABSENT is green when the server failed to
 * build, when the route name is misspelled, when `getRoutes()` returns empty,
 * and when a table-driven suite iterates zero cases (#15410 measured 20 of 178
 * self-tests failing on zero cases; this is not the 179th). So:
 *
 *   1. Every absence has its PRESENCE TWIN in the same case — with the switch
 *      on, each route it gates must be in the baseline. A misspelled path
 *      fails there before the absence is ever consulted.
 *   2. `§0` asserts the case table is exhaustive at its measured size, the
 *      baseline is non-empty and free of duplicates, and every route the table
 *      names is really in the baseline.
 *
 * ## ⚠️ The batch gates are conjunctions, so a mount can be absent for TWO reasons
 *
 * The four bulk mounts read `switch AND protocol member`
 * (`operations.createMany && this.protocol.createManyData`). A pin that only
 * checks absence goes green against a protocol that merely lacks the member —
 * measuring the wrong conjunct. So the baseline protocol here carries EVERY
 * member, and §2 pins the other conjunct separately: with every switch true
 * and the members gone, exactly those four mounts drop and CRUD is untouched.
 *
 * ## Route COUNT is deliberately a floor, not an equality
 *
 * An exact `toBe(85)` on the baseline would redden on every unrelated PR that
 * adds a REST route — a maintenance tax on other lanes for no extra safety
 * here. The anti-vacuity job is done strictly better by requiring every route
 * the table names to be present (an equality over the surface this file is
 * about) plus a floor that no broken-harness table could clear.
 *
 * Measured on `origin/main` `cc5b3dd0c27` — baseline 85 routes.
 */

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

/**
 * A protocol carrying EVERY optional member a mount conjunct reads, so the
 * baseline measures the SWITCH and never the member. Dropping a member here
 * silently converts the batch cases into tautologies — see §2, which is the
 * guard that would catch it.
 */
function protocolWithEveryMember(): any {
    return {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        createManyData: vi.fn(),
        updateManyData: vi.fn(),
        deleteManyData: vi.fn(),
        batchData: vi.fn(),
    };
}

/** Every switch this file is about, spelled TRUE rather than left to defaults. */
const ALL_TRUE = {
    api: {
        requireAuth: false,
        enableCrud: true,
        enableBatch: true,
        enableMetadata: true,
        enableDiscovery: true,
        enableOpenApi: true,
        enableUi: true,
        enableSearch: true,
    },
    crud: { operations: { create: true, read: true, update: true, delete: true, list: true } },
    batch: { enableBatchEndpoint: true, operations: { createMany: true, updateMany: true, deleteMany: true } },
    metadata: { endpoints: { types: true, items: true, item: true } },
};

/** Deep-merge just enough to flip one leaf switch off inside ALL_TRUE. */
function withSwitchOff(path: string): any {
    const cfg = JSON.parse(JSON.stringify(ALL_TRUE));
    const parts = path.split('.');
    let node = cfg;
    for (const key of parts.slice(0, -1)) node = node[key];
    node[parts[parts.length - 1]] = false;
    return cfg;
}

function mountedRoutes(config: any, protocol: any = protocolWithEveryMember()): string[] {
    const rest = new RestServer(createMockServer() as any, protocol, config as any);
    rest.registerRoutes();
    return rest.getRoutes().map((r: any) => `${r.method} ${r.path}`).sort();
}

const BASELINE = mountedRoutes(ALL_TRUE);

const DATA = '/api/v1/data/:object';
const META = '/api/v1/meta';

/**
 * switch → the routes it gates, MEASURED (baseline minus switch-off), not
 * transcribed from the schema's `describe()`. Where the two disagree the
 * disagreement is a defect about the describe(), and this table is the side
 * that was measured.
 */
const CASES: Array<{ path: string; removes: string[] }> = [
    // --- crud.operations.* -------------------------------------------------
    { path: 'crud.operations.create', removes: [`POST ${DATA}`] },
    { path: 'crud.operations.read', removes: [`GET ${DATA}/:id`] },
    { path: 'crud.operations.update', removes: [`PATCH ${DATA}/:id`] },
    { path: 'crud.operations.delete', removes: [`DELETE ${DATA}/:id`] },
    // TWO mounts — the query door has no switch of its own.
    { path: 'crud.operations.list', removes: [`GET ${DATA}`, `POST ${DATA}/query`] },

    // --- batch.* -----------------------------------------------------------
    // Only the PER-OBJECT door. The cross-object `POST /api/v1/batch` survives
    // this switch and answers to `api.enableBatch` instead, which is what the
    // switch's own describe() says ('Enable POST /data/:object/batch').
    { path: 'batch.enableBatchEndpoint', removes: [`POST ${DATA}/batch`] },
    { path: 'batch.operations.createMany', removes: [`POST ${DATA}/createMany`] },
    { path: 'batch.operations.updateMany', removes: [`POST ${DATA}/updateMany`] },
    { path: 'batch.operations.deleteMany', removes: [`POST ${DATA}/deleteMany`] },

    // --- metadata.endpoints.* ----------------------------------------------
    // Two spellings, one handler.
    { path: 'metadata.endpoints.types', removes: [`GET ${META}`, `GET ${META}/types`] },
    // ⚠️ FOUR routes, and one of them is a WRITE door (#15542): the declared
    // meaning is "GET /meta/:type - List items of type", but switching it off
    // also disarms `_migrate-stored`, `_drafts` and `diagnostics`.
    {
        path: 'metadata.endpoints.items',
        removes: [`GET ${META}/:type`, `GET ${META}/_drafts`, `GET ${META}/diagnostics`, `POST ${META}/_migrate-stored`],
    },
    // ⚠️ FOUR routes, and NOT the ones a reader would guess: the per-item
    // WRITES (`PUT`/`DELETE {prefix}/:type/:name`) and the history family
    // (`history`, `audit`, `diff`, `published`, `publish`, `rollback`) are NOT
    // gated by it — they answer to `api.enableMetadata` alone.
    {
        path: 'metadata.endpoints.item',
        removes: [
            `GET ${META}/:type/:name`,
            `GET ${META}/:type/:name/layers`,
            `GET ${META}/:type/:name/references`,
            `GET ${META}/book/:name/tree`,
        ],
    },

    // --- api.* — the family the card's title reaches, same registrar seam ---
    {
        path: 'api.enableCrud',
        removes: [
            `DELETE ${DATA}/:id`, `GET ${DATA}`, `GET ${DATA}/:id`,
            `PATCH ${DATA}/:id`, `POST ${DATA}`, `POST ${DATA}/query`,
        ],
    },
    {
        path: 'api.enableBatch',
        removes: [
            'POST /api/v1/batch',
            `POST ${DATA}/batch`, `POST ${DATA}/createMany`,
            `POST ${DATA}/deleteMany`, `POST ${DATA}/updateMany`,
        ],
    },
    {
        path: 'api.enableMetadata',
        removes: [
            `DELETE ${META}/:type/:name`,
            `GET ${META}`,
            `GET ${META}/:type`,
            `GET ${META}/:type/:name`,
            `GET ${META}/:type/:name/audit`,
            `GET ${META}/:type/:name/diff`,
            `GET ${META}/:type/:name/history`,
            `GET ${META}/:type/:name/layers`,
            `GET ${META}/:type/:name/published`,
            `GET ${META}/:type/:name/references`,
            `GET ${META}/_drafts`,
            `GET ${META}/book/:name/tree`,
            `GET ${META}/diagnostics`,
            `GET ${META}/object/:name/state/:field`,
            `GET ${META}/types`,
            `POST ${META}/:type/:name/publish`,
            `POST ${META}/:type/:name/rollback`,
            `POST ${META}/_migrate-stored`,
            `PUT ${META}/:type/:name`,
        ],
    },
    { path: 'api.enableDiscovery', removes: ['GET /api/v1', 'GET /api/v1/discovery'] },
    { path: 'api.enableOpenApi', removes: ['GET /api/v1/docs', 'GET /api/v1/openapi.json'] },
    { path: 'api.enableUi', removes: ['GET /api/v1/ui/view/:object/:type'] },
    { path: 'api.enableSearch', removes: ['GET /api/v1/search'] },
];

describe('[#15544] §0 the harness measures something', () => {
    it('the case table is exhaustive at its measured size', () => {
        // ⛔ A table-driven pin that silently iterates zero cases is the
        // failure this number exists to prevent. Nineteen mount-gating
        // switches were measured on `origin/main` `cc5b3dd0c27`. A switch
        // retired or added moves this number DELIBERATELY, with its row.
        expect(CASES.length).toBe(19);
        expect(new Set(CASES.map((c) => c.path)).size).toBe(CASES.length);
        expect(CASES.every((c) => c.removes.length > 0)).toBe(true);
    });

    it('the all-true baseline is a real, duplicate-free route table', () => {
        expect(BASELINE.length).toBeGreaterThanOrEqual(60);
        expect(new Set(BASELINE).size).toBe(BASELINE.length);
    });

    it('every route the table claims to gate is really mounted when all switches are on', () => {
        // The collective presence twin: a misspelled path in ANY row fails
        // here, so no row can reach its absence assertion by misspelling.
        const gated = [...new Set(CASES.flatMap((c) => c.removes))].sort();
        expect(gated.length).toBeGreaterThan(0);
        expect(gated.filter((r) => !BASELINE.includes(r))).toEqual([]);
    });
});

describe('[#15544] §1 a false switch removes exactly its routes from the mounted table', () => {
    for (const { path, removes } of CASES) {
        it(`${path}: on → mounted, off → exactly ${removes.length} route(s) gone`, () => {
            // Presence twin FIRST — an absence assertion alone is
            // indistinguishable from a broken harness.
            const expectedGone = [...removes].sort();
            expect(expectedGone.filter((r) => !BASELINE.includes(r))).toEqual([]);

            const off = mountedRoutes(withSwitchOff(path));

            // The set difference, both directions: a gate that GROWS a route
            // is as much a defect as one that loses a route.
            expect(BASELINE.filter((r) => !off.includes(r))).toEqual(expectedGone);
            expect(off.filter((r) => !BASELINE.includes(r))).toEqual([]);
        });
    }
});

describe('[#15544] §2 the batch mounts are conjunctions — the OTHER conjunct', () => {
    it('the four bulk mounts drop when the protocol lacks the member, with every switch still true', () => {
        // Without this case, §1's four batch rows would still pass against a
        // protocol that merely lacks `createManyData` — measuring the member
        // rather than the switch, which is the defect one layer over.
        const bare = protocolWithEveryMember();
        delete bare.createManyData;
        delete bare.updateManyData;
        delete bare.deleteManyData;
        delete bare.batchData;

        const routes = mountedRoutes(ALL_TRUE, bare);

        expect(BASELINE.filter((r) => !routes.includes(r))).toEqual([
            `POST ${DATA}/batch`,
            `POST ${DATA}/createMany`,
            `POST ${DATA}/deleteMany`,
            `POST ${DATA}/updateMany`,
        ]);

        // Positive control: the CRUD doors, which read no protocol member,
        // are untouched — so the four above dropped for the member and not
        // because the server failed to register anything at all.
        expect(routes).toContain(`GET ${DATA}/:id`);
        expect(routes).toContain(`POST ${DATA}`);
    });
});
