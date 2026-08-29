// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0006 D2, SDK half — the control-plane namespace is `client.environments`,
 * its declared unwrap keys are `environments` / `environment`, and there is NO
 * alias for either old spelling.
 *
 * ## Why this file exists at all
 *
 * The rename is one half of a cross-repo coordinated change: the cloud control
 * plane renames the response FIELD keys (`projects` → `environments`,
 * `project` → `environment`) and this SDK renames the METHOD namespace plus the
 * shapes it declares. Neither half ships alone — shipping this one alone is
 * ADR-0006 D3, permanently declined.
 *
 * The load-bearing half of that decision is the ABSENCE of a compatibility
 * layer, and absence is exactly what no ordinary test observes: every assertion
 * about `client.environments` stays green if someone later adds a `projects`
 * getter beside it, or a `res.project ?? res.environment` hedge in a consumer.
 * ADR-0006 D3 declined that mapping layer with reasons, so it needs a pin that
 * fails when one appears, not merely one that passes while none does.
 *
 * ## What each pin is really asserting
 *
 * - The RUNTIME pins drive the client with a recording `fetch` answering the
 *   post-rename envelope the producer half emits, and read the keys back. They
 *   are the half that would catch a mapping layer rewriting keys in transit:
 *   `unwrapResponse` is a passthrough today, and these say so out loud.
 * - The TYPE pins are `@ts-expect-error` reads of the RETIRED key spellings.
 *   They are compiled — `packages/client`'s `tsconfig.test.json` includes
 *   `src/**` and `package.json`'s `typecheck` script names it — so they are
 *   real checks rather than the phantom class AGENTS.md warns about. Each one
 *   goes red the moment a declared shape grows the old key back.
 *
 * Producer half: `objectstack-ai/cloud` — `packages/service-cloud/src/routes/
 * environment-crud.ts` and `environment-lifecycle.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackClient } from './index';

type EnvironmentsNamespace = ObjectStackClient['environments'];
type ListShape = Awaited<ReturnType<EnvironmentsNamespace['list']>>;
type GetShape = Awaited<ReturnType<EnvironmentsNamespace['get']>>;
type CreateShape = Awaited<ReturnType<EnvironmentsNamespace['create']>>;
type UpdateShape = Awaited<ReturnType<EnvironmentsNamespace['update']>>;
type ActivateShape = Awaited<ReturnType<EnvironmentsNamespace['activate']>>;
type RetryShape = Awaited<ReturnType<EnvironmentsNamespace['retryProvisioning']>>;
type HostnameShape = Awaited<ReturnType<EnvironmentsNamespace['updateHostname']>>;
type VisibilityShape = Awaited<ReturnType<EnvironmentsNamespace['updateVisibility']>>;

/**
 * The list envelope: the row array is `environments`, and `total` is unchanged
 * by the rename (it was never part of it).
 */
export function listEnvelopeCarriesTheWireKeys(): void {
    const shape = {} as ListShape;
    void shape.environments;
    void shape.total;
    // @ts-expect-error ADR-0006 D2 renamed the list row key to `environments`; no `projects` alias exists
    void shape.projects;
}

/**
 * Every single-row envelope: the key is `environment`. One `@ts-expect-error`
 * per method rather than one for the family, so a shape that regressed on its
 * own is named by the failure rather than hidden behind a sibling's.
 */
export function singleRowEnvelopesCarryTheWireKey(): void {
    const get = {} as GetShape;
    void get.environment;
    void get.database;
    void get.credential;
    void get.membership;
    // @ts-expect-error the detail envelope's row key is `environment`
    void get.project;

    const created = {} as CreateShape;
    void created.environment;
    // @ts-expect-error create answers `environment` — and has never answered `project` at all
    void created.project;

    const updated = {} as UpdateShape;
    void updated.environment;
    // @ts-expect-error PATCH answers `environment`
    void updated.project;

    const activated = {} as ActivateShape;
    void activated.environment;
    void activated.sessionUpdated;
    // @ts-expect-error activate answers `environment` beside `sessionUpdated`
    void activated.project;

    const retried = {} as RetryShape;
    void retried.environment;
    // @ts-expect-error retry answers `environment`
    void retried.project;

    const renamedHost = {} as HostnameShape;
    void renamedHost.environment;
    // @ts-expect-error change-hostname answers `environment`
    void renamedHost.project;

    const revisibled = {} as VisibilityShape;
    void revisibled.environment;
    // @ts-expect-error change-visibility answers `environment`
    void revisibled.project;
}

/**
 * `create` declares no `database` key. It never had one on the wire: the
 * producer's `POST /cloud/environments` builds its body key by key and forwards
 * `environment` / `warnings` / `durationMs` (plus a conditional
 * `hostnameAssignment`) and nothing else. The old declaration promised a
 * NON-optional `database`, so `res.database.driver` typechecked and threw at
 * runtime — the failure direction a declared shape is supposed to prevent.
 */
export function createDeclaresNoDatabaseBlock(): void {
    const created = {} as CreateShape;
    // @ts-expect-error `POST /cloud/environments` does not answer a `database` block; `get` is the method that does
    void created.database;
}

/** Helper: a client whose `fetch` answers one canned BaseResponse envelope. */
function clientAnswering(data: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ success: true, data }),
        headers: new Headers(),
    });
    const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock });
    return { client, fetchMock };
}

describe('[ADR-0006 D2] client.environments — the control-plane namespace after the rename', () => {
    it('exposes `environments`, and exposes NO `projects` alias beside it', () => {
        const { client } = clientAnswering({});

        expect(typeof client.environments).toBe('object');
        expect(typeof client.environments.list).toBe('function');
        expect(typeof client.environments.packages.install).toBe('function');

        // The declined-mapping-layer pin. `in` rather than a truthiness check:
        // a getter returning `undefined` would still be a re-exported namespace,
        // and this must fail on the SHAPE, not on the value.
        expect('projects' in client).toBe(false);
        expect((client as unknown as Record<string, unknown>).projects).toBeUndefined();
    });

    it('relays the list envelope untouched — `environments` + `total`', async () => {
        const { client, fetchMock } = clientAnswering({
            environments: [{ id: 'env_1', display_name: 'Staging' }],
            total: 1,
        });

        const res = await client.environments.list({ organization_id: 'org_1' });

        expect(res.total).toBe(1);
        expect(res.environments).toHaveLength(1);
        expect(res.environments[0].id).toBe('env_1');
        // No key rewriting on the way through — the SDK is a passthrough, and a
        // mapping layer added later would have to break one of these two.
        expect(Object.keys(res).sort()).toEqual(['environments', 'total']);
        expect(fetchMock.mock.calls[0][0]).toBe(
            'http://localhost:3000/api/v1/cloud/environments?organizationId=org_1',
        );
    });

    it('relays the detail envelope untouched — `environment` beside its joined blocks', async () => {
        const { client } = clientAnswering({
            environment: { id: 'env_1', display_name: 'Staging' },
            database: { driver: 'turso', database_url: 'libsql://x' },
            credential: { id: 'cred_1' },
            membership: { role: 'owner' },
        });

        const res = await client.environments.get('env_1');

        expect(res.environment.id).toBe('env_1');
        expect(res.database.driver).toBe('turso');
        expect(res.membership.role).toBe('owner');
        expect('project' in res).toBe(false);
    });

    it('relays the create envelope — `environment`, the key this route has always sent', async () => {
        const { client, fetchMock } = clientAnswering({
            environment: { id: 'env_new', display_name: 'Dev' },
            warnings: [],
            durationMs: 1234,
        });

        const res = await client.environments.create({
            organization_id: 'org_1',
            display_name: 'Dev',
        });

        expect(res.environment.id).toBe('env_new');
        expect('project' in res).toBe(false);
        expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/cloud/environments');
        expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    });

    it('relays the activate envelope — `environment` beside `sessionUpdated`', async () => {
        const { client } = clientAnswering({
            environment: { id: 'env_1' },
            sessionUpdated: true,
        });

        const res = await client.environments.activate('env_1');

        expect(res.environment.id).toBe('env_1');
        expect(res.sessionUpdated).toBe(true);
        expect('project' in res).toBe(false);
    });

    it('keeps the environment-scoped `packages` block reachable under the new namespace', async () => {
        const { client, fetchMock } = clientAnswering({ packages: [], total: 0 });

        const res = await client.environments.packages.list('env_1');

        expect(res.total).toBe(0);
        expect(fetchMock.mock.calls[0][0]).toBe(
            'http://localhost:3000/api/v1/cloud/environments/env_1/packages',
        );
    });

    it('anti-vacuity: the type pins above are exported functions that really name the shapes', () => {
        // They are compile-time only, so nothing calls them at runtime. This
        // asserts they are not dead text: each is a real binding in this module.
        expect(typeof listEnvelopeCarriesTheWireKeys).toBe('function');
        expect(typeof singleRowEnvelopesCarryTheWireKey).toBe('function');
        expect(typeof createDeclaresNoDatabaseBlock).toBe('function');
    });
});
