import { describe, it, expect, vi } from 'vitest';
// `QueryBuilder` / `FilterBuilder` are named only by the `describe` blocks below;
// the suites build them through `createQuery` / `createFilter`, so importing the
// classes themselves left two unused bindings (TS6133) the moment this file
// entered a tsc program (#5449).
import { WELL_KNOWN_CAPABILITY_KEYS } from '@objectstack/spec/api';
import { ObjectStackClient, createQuery, createFilter } from './index';
import type { QueryOptions, QueryOptionsV2 } from './index';

/** Helper: create a client with mocked fetch that returns the given response body */
function createMockClient(body: any, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        json: async () => body,
        headers: new Headers()
    });
    const client = new ObjectStackClient({
        baseUrl: 'http://localhost:3000',
        fetch: fetchMock
    });
    return { client, fetchMock };
}

describe('ObjectStackClient', () => {
    it('should initialize with correct configuration', () => {
        const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000' });
        expect(client).toBeDefined();
    });

    it('should normalize base URL', () => {
        const client: any = new ObjectStackClient({ baseUrl: 'http://localhost:3000/' });
        expect(client.baseUrl).toBe('http://localhost:3000');
    });

    it('should make discovery request on connect', async () => {
        // [#5787] This double is shaped on the REAL `/discovery` body, measured
        // off `ObjectStackProtocolImplementation.getDiscovery()`
        // (`packages/metadata-protocol/src/protocol.ts`) — not invented.
        //
        // It used to spell two shapes no producer has ever emitted:
        //
        //   capabilities: ['metadata', 'data', 'ui'],   // an array
        //   endpoints: {}                               // retired in #4828
        //
        // `endpoints` was the dispatcher-only verbatim copy of `routes`, removed
        // under ADR-0049; the producer emits `routes` (`ApiRoutesSchema`, and
        // REQUIRED by `DiscoverySchema`). `capabilities` was a string array in
        // some pre-history and is now a CLOSED object over the one vocabulary,
        // each entry a `CapabilityDescriptor` (#5672 ruling A).
        //
        // Both were inert — the assertion below only counts the fetch — which is
        // exactly why they survived two retirements. The harm is authoring-time:
        // a test double is the most-copied artifact there is, and this one
        // taught a producer shape that never existed (#5674's 25 siblings in
        // `packages/rest` were the same defect). `discovery-double-retired-key.test.ts`
        // beside this file pins both keys so the next copy cannot reintroduce them.
        //
        // The capability map is BUILT from `WELL_KNOWN_CAPABILITY_KEYS` rather
        // than hand-listed: that constant is the vocabulary's single source of
        // truth precisely so no consumer becomes a fourth dialect of it, and a
        // hand-written key list here would silently fall behind the day the
        // vocabulary grows.
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                version: '1.0',
                name: 'ObjectStack API',
                environment: 'development',
                routes: { data: '/api/v1/data', metadata: '/api/v1/meta' },
                locale: { default: 'en', supported: ['en'], timezone: 'UTC' },
                services: {},
                capabilities: Object.fromEntries(
                    WELL_KNOWN_CAPABILITY_KEYS.map((key) => [key, { enabled: false }]),
                ),
            })
        });

        const client = new ObjectStackClient({
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock
        });

        await client.connect();
        // connect() tries .well-known first, which succeeds with our mock
        expect(fetchMock).toHaveBeenCalled();
    });

    it('should get metadata types', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ 
                types: ['object', 'plugin', 'view']
            })
        });

        const client = new ObjectStackClient({ 
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock
        });

        const result = await client.meta.getTypes();
        expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/v1/meta', expect.any(Object));
        expect(result.types).toEqual(['object', 'plugin', 'view']);
    });

    it('should get metadata items by type', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ 
                type: 'object',
                items: [{ name: 'customer' }, { name: 'order' }]
            })
        });

        const client = new ObjectStackClient({ 
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock
        });

        const result = await client.meta.getItems('object');
        expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/v1/meta/object', expect.any(Object));
        expect(result.type).toBe('object');
        expect(result.items).toHaveLength(2);
    });

    it('should get metadata item by type and name', async () => {
        // The server's body is the spec-declared `GetMetaItemResponseSchema`
        // envelope — `{ type, name, item }`, with the metadata document under
        // `item`. This double used to serve the bare document, which is what
        // the route's DEFAULT (cached) path really answered while its
        // non-cached path answered the envelope; #5563 converged the route on
        // the declared shape, so the double speaks it too.
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                type: 'object',
                name: 'customer',
                item: { name: 'customer', label: 'Customer', fields: [] },
            })
        });

        const client = new ObjectStackClient({
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock
        });

        const result = await client.meta.getItem('object', 'customer');
        expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/v1/meta/object/customer', expect.any(Object));
        // #5545: `meta.getItem` now declares `Promise< GetMetaItemResponse >`,
        // matching the `getItems` beside it. These are TYPED field reads, not a
        // `toMatchObject` shape probe over an `unknown` payload — `result.type`
        // and `result.name` compile only while the annotation is there, so
        // removing it turns these two lines red (TS18046) instead of silently
        // weakening the assertion. No cast: the `as any` this test carried
        // (#5449) existed solely because the surface was untyped.
        expect(result.type).toBe('object');
        expect(result.name).toBe('customer');
        // Load-bearing: the document lives under `item`, not spread at the top
        // level. A regression to the bare shape fails HERE, not on a missing key.
        // `item` is `unknown` in the spec schema (the envelope is typed, the
        // document it carries is not), so the document's own keys stay a
        // structural assertion — that is the schema's shape, not a gap.
        expect(result.item).toMatchObject({ name: 'customer', label: 'Customer' });
    });

    it('meta.saveItem surfaces the ADR-0008 OCC carriers the save response declares (#5545)', async () => {
        // The real `PUT /api/v1/meta/:type/:name` body, as
        // `SaveMetaItemResponseSchema` has declared it since #5745: `version`
        // is the `If-Match` token the optimistic-concurrency chain runs on,
        // and it is reachable from the SDK without a cast only because
        // `saveItem` names that type.
        const { client } = createMockClient({
            success: true,
            version: 'sha256:' + 'a'.repeat(64),
            seq: 7,
            state: 'active',
        });
        const saved = await client.meta.saveItem('object', 'customer', { name: 'customer' });
        expect(saved.success).toBe(true);
        expect(saved.version).toBe('sha256:' + 'a'.repeat(64));
        expect(saved.seq).toBe(7);
        expect(saved.state).toBe('active');
    });

    it('meta.getView speaks the path-param dialect both surfaces accept (#3611)', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { type: 'list' } });
        await client.meta.getView('customer');
        // NOT the ?type= query dialect — REST mounts only /ui/view/:object/:type,
        // so the query form 404s wherever REST is the serving surface.
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/ui/view/customer/list',
        );
        await client.meta.getView('customer', 'form');
        expect(String(fetchMock.mock.calls[1][0])).toBe(
            'http://localhost:3000/api/v1/ui/view/customer/form',
        );
    });

    it('meta.getDiagnostics pins GET /meta/diagnostics with its query params', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { items: [] } });
        await client.meta.getDiagnostics();
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/diagnostics',
        );
        await client.meta.getDiagnostics({ type: 'object', severity: 'warning', packageId: 'com.example.crm' });
        expect(String(fetchMock.mock.calls[1][0])).toBe(
            'http://localhost:3000/api/v1/meta/diagnostics?type=object&severity=warning&package=com.example.crm',
        );
    });

    it('meta.getReferences pins GET /meta/:type/:name/references', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { references: [] } });
        await client.meta.getReferences('object', 'customer');
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/object/customer/references',
        );
    });

    it('meta.getBookTree pins GET /meta/book/:name/tree', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { tree: [] } });
        await client.meta.getBookTree('handbook', { packageId: 'com.example.docs' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/book/handbook/tree?package=com.example.docs',
        );
    });

    it('meta.getAudit pins GET /meta/:type/:name/audit', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { events: [] } });
        await client.meta.getAudit('object', 'customer', { limit: 20 });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/object/customer/audit?limit=20',
        );
    });

    it('meta.publishItem pins POST /meta/:type/:name/publish and passes message', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { published: true } });
        await client.meta.publishItem('object', 'customer', { message: 'go live' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/meta/object/customer/publish');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ message: 'go live' });
    });

    it('meta.rollbackItem pins POST /meta/:type/:name/rollback with toVersion', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { restored: true } });
        await client.meta.rollbackItem('object', 'customer', 3);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/meta/object/customer/rollback');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ toVersion: 3 });
    });

    it('meta.diffItem pins GET /meta/:type/:name/diff with from/to', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { changes: [] } });
        await client.meta.diffItem('object', 'customer', { from: 2, to: 5 });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/object/customer/diff?from=2&to=5',
        );
    });

    it('meta.getItem/saveItem pass compound names through unencoded (reaches /meta/:type/:section/:name)', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { name: 'views/all_leads' } });
        await client.meta.getItem('object', 'views/all_leads');
        // The slash must survive: %2F would collapse the request onto the
        // 3-segment /meta/:type/:name route and miss the compound handler.
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/object/views/all_leads',
        );
        await client.meta.saveItem('object', 'views/all_leads', { label: 'All leads' });
        expect(String(fetchMock.mock.calls[1][0])).toBe(
            'http://localhost:3000/api/v1/meta/object/views/all_leads',
        );
        expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
    });
});

describe('Reports namespace (#3587 gap closure)', () => {
    it('reports.list pins GET /reports with filters and unwraps {data}', async () => {
        const { client, fetchMock } = createMockClient({ data: [{ id: 'r1' }] });
        const rows = await client.reports.list({ object: 'lead', ownerId: 'u1' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/reports?object=lead&ownerId=u1',
        );
        expect(rows).toEqual([{ id: 'r1' }]);
    });

    it('reports.save pins POST /reports', async () => {
        const { client, fetchMock } = createMockClient({ id: 'r1' });
        await client.reports.save({ name: 'Pipeline', object: 'lead' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/reports');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ name: 'Pipeline', object: 'lead' });
    });

    it('reports.get / delete pin /reports/:id and delete tolerates 204', async () => {
        const { client, fetchMock } = createMockClient({ id: 'r1' });
        await client.reports.get('r1');
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:3000/api/v1/reports/r1');

        const del = createMockClient(undefined, 204);
        // A 204 has no JSON body — the method must not try to parse one.
        del.fetchMock.mockResolvedValue({ ok: true, status: 204, statusText: 'No Content', json: async () => { throw new Error('no body'); }, headers: new Headers() });
        const out = await del.client.reports.delete('r1');
        expect(String(del.fetchMock.mock.calls[0][0])).toBe('http://localhost:3000/api/v1/reports/r1');
        expect(del.fetchMock.mock.calls[0][1].method).toBe('DELETE');
        expect(out).toEqual({ deleted: true });
    });

    it('reports.run pins POST /reports/:id/run', async () => {
        const { client, fetchMock } = createMockClient({ rows: [] });
        await client.reports.run('r1');
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/reports/r1/run');
        expect(init.method).toBe('POST');
    });

    it('reports.schedule pins POST /reports/:id/schedule with the schedule body', async () => {
        const { client, fetchMock } = createMockClient({ id: 's1' });
        await client.reports.schedule('r1', { recipients: ['a@example.com'], cronExpression: '0 8 * * 1' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/reports/r1/schedule');
        expect(JSON.parse(init.body)).toEqual({ recipients: ['a@example.com'], cronExpression: '0 8 * * 1' });
    });

    it('reports.listSchedules / unschedule pin the schedule routes', async () => {
        const { client, fetchMock } = createMockClient({ data: [{ id: 's1' }] });
        const rows = await client.reports.listSchedules('r1');
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:3000/api/v1/reports/r1/schedules');
        expect(rows).toEqual([{ id: 's1' }]);

        const del = createMockClient(undefined, 204);
        del.fetchMock.mockResolvedValue({ ok: true, status: 204, statusText: 'No Content', json: async () => { throw new Error('no body'); }, headers: new Headers() });
        const out = await del.client.reports.unschedule('s1');
        expect(String(del.fetchMock.mock.calls[0][0])).toBe('http://localhost:3000/api/v1/reports/schedules/s1');
        expect(del.fetchMock.mock.calls[0][1].method).toBe('DELETE');
        expect(out).toEqual({ deleted: true });
    });
});

describe('Approvals lifecycle & thread routes (#3587 gap closure)', () => {
    it.each([
        ['recall', 'recall'],
        ['revise', 'revise'],
        ['resubmit', 'resubmit'],
        ['remind', 'remind'],
        ['requestInfo', 'request-info'],
    ] as const)('approvals.%s pins POST /approvals/requests/:id/%s', async (method, segment) => {
        const { client, fetchMock } = createMockClient({ success: true, data: { status: 'ok' } });
        await (client.approvals as any)[method]('req-1', { comment: 'hi' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe(`http://localhost:3000/api/v1/approvals/requests/req-1/${segment}`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body).comment).toBe('hi');
    });

    it('approvals.comment pins the comment route and carries attachments', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { status: 'ok' } });
        await client.approvals.comment('req-1', { comment: 'note', attachments: ['f1'] });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/approvals/requests/req-1/comment');
        expect(JSON.parse(init.body)).toEqual({ comment: 'note', attachments: ['f1'] });
    });
});

describe('Record shares namespace (#3587 gap closure)', () => {
    it('shares.list pins GET /data/:object/:id/shares and unwraps {data}', async () => {
        const { client, fetchMock } = createMockClient({ data: [{ id: 'sh1' }] });
        const rows = await client.shares.list('lead', 'rec1');
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/data/lead/rec1/shares',
        );
        expect(rows).toEqual([{ id: 'sh1' }]);
    });

    it('shares.grant pins POST /data/:object/:id/shares with the grant body', async () => {
        const { client, fetchMock } = createMockClient({ id: 'sh1' });
        await client.shares.grant('lead', 'rec1', { recipientType: 'user', recipientId: 'u1', accessLevel: 'read' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/data/lead/rec1/shares');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ recipientType: 'user', recipientId: 'u1', accessLevel: 'read' });
    });

    it('shares.revoke pins DELETE /data/:object/:id/shares/:shareId and tolerates 204', async () => {
        const del = createMockClient(undefined, 204);
        del.fetchMock.mockResolvedValue({ ok: true, status: 204, statusText: 'No Content', json: async () => { throw new Error('no body'); }, headers: new Headers() });
        const out = await del.client.shares.revoke('lead', 'rec1', 'sh1');
        expect(String(del.fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/data/lead/rec1/shares/sh1',
        );
        expect(del.fetchMock.mock.calls[0][1].method).toBe('DELETE');
        expect(out).toEqual({ deleted: true });
    });
});

describe('Sharing rules namespace (#3587 gap closure)', () => {
    it('shares.rules.list pins GET /sharing/rules with filters', async () => {
        const { client, fetchMock } = createMockClient({ data: [{ name: 'team_leads' }] });
        const rows = await client.shares.rules.list({ object: 'lead', activeOnly: true });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/sharing/rules?object=lead&activeOnly=true',
        );
        expect(rows).toEqual([{ name: 'team_leads' }]);
    });

    it('shares.rules.save pins POST /sharing/rules', async () => {
        const { client, fetchMock } = createMockClient({ name: 'team_leads' });
        await client.shares.rules.save({ name: 'team_leads', object: 'lead', accessLevel: 'read' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/sharing/rules');
        expect(init.method).toBe('POST');
    });

    it('shares.rules.get / delete / evaluate pin the :idOrName routes', async () => {
        const { client, fetchMock } = createMockClient({ name: 'team_leads' });
        await client.shares.rules.get('team_leads');
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:3000/api/v1/sharing/rules/team_leads');
        await client.shares.rules.evaluate('team_leads');
        expect(String(fetchMock.mock.calls[1][0])).toBe('http://localhost:3000/api/v1/sharing/rules/team_leads/evaluate');
        expect(fetchMock.mock.calls[1][1].method).toBe('POST');

        const del = createMockClient(undefined, 204);
        del.fetchMock.mockResolvedValue({ ok: true, status: 204, statusText: 'No Content', json: async () => { throw new Error('no body'); }, headers: new Headers() });
        const out = await del.client.shares.rules.delete('team_leads');
        expect(String(del.fetchMock.mock.calls[0][0])).toBe('http://localhost:3000/api/v1/sharing/rules/team_leads');
        expect(out).toEqual({ deleted: true });
    });
});

describe('Security explain & global search (#3587 gap closure)', () => {
    it('security.explain pins POST /security/explain with the request body', async () => {
        const { client, fetchMock } = createMockClient({ allowed: true });
        await client.security.explain({ object: 'lead', operation: 'update', userId: 'u1', recordId: 'r1' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/security/explain');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ object: 'lead', operation: 'update', userId: 'u1', recordId: 'r1' });
    });

    it('security.explain accepts the recordIds batch spelling and forwards it verbatim (#8480)', async () => {
        // [#8480] Typed-client completion of #8326's batch spelling. The
        // client does NOT validate the cap or the recordId/recordIds
        // mutual exclusion — that stays the server's job
        // (`ExplainRequestSchema`); this pins that the body goes over the
        // wire exactly as given, unmodified, whether or not it would pass
        // server-side validation.
        const { client, fetchMock } = createMockClient({ allowed: true });
        await client.security.explain({ object: 'lead', operation: 'read', recordIds: ['r1', 'r2'] });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/security/explain');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ object: 'lead', operation: 'read', recordIds: ['r1', 'r2'] });
    });

    it('search pins GET /search with q/objects/limit/perObject', async () => {
        const { client, fetchMock } = createMockClient({ results: [] });
        await client.search('acme', { objects: ['lead', 'account'], limit: 20, perObject: 5 });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/search?q=acme&objects=lead%2Caccount&limit=20&perObject=5',
        );
    });
});

describe('Data actions, email, dataset query, external datasources (#3587 gap closure)', () => {
    it('data.clone pins POST /data/:object/:id/clone and nests overrides', async () => {
        const { client, fetchMock } = createMockClient({ id: 'new1' });
        await client.data.clone('lead', 'rec1', { name: 'Copy of Acme' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/data/lead/rec1/clone');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ overrides: { name: 'Copy of Acme' } });
    });

    it('data.export pins GET /data/:object/export and returns the raw Response', async () => {
        const { client, fetchMock } = createMockClient({});
        const res = await client.data.export('lead', { format: 'xlsx', limit: 100, filter: { status: 'open' }, orderby: 'name:asc', header: false });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/data/lead/export?format=xlsx&limit=100&filter=%7B%22status%22%3A%22open%22%7D&orderby=name%3Aasc&header=false',
        );
        // A file stream, not a JSON envelope — the raw Response comes back.
        expect(typeof (res as any).json).toBe('function');
    });

    it('email.send pins POST /email/send', async () => {
        const { client, fetchMock } = createMockClient({ status: 'sent', id: 'm1' });
        await client.email.send({ to: 'a@example.com', subject: 'Hello', text: 'hi' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/email/send');
        expect(init.method).toBe('POST');
    });

    it('analytics.queryDataset pins POST /analytics/dataset/query', async () => {
        const { client, fetchMock } = createMockClient({ rows: [] });
        await client.analytics.queryDataset({ datasetName: 'sales', selection: { measures: ['amount_sum'] } });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/analytics/dataset/query');
        expect(JSON.parse(init.body)).toEqual({ datasetName: 'sales', selection: { measures: ['amount_sum'] } });
    });

    it('datasources.external.* pin the five federation-admin routes', async () => {
        const { client, fetchMock } = createMockClient({ tables: [] });
        await client.datasources.external.listTables('pg_main', { schema: 'public' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/datasources/pg_main/external/tables?schema=public',
        );
        await client.datasources.external.draft('pg_main', 'customers');
        expect(String(fetchMock.mock.calls[1][0])).toBe(
            'http://localhost:3000/api/v1/datasources/pg_main/external/tables/customers/draft',
        );
        await client.datasources.external.import('pg_main', 'customers', { namespace: 'crm' });
        expect(String(fetchMock.mock.calls[2][0])).toBe(
            'http://localhost:3000/api/v1/datasources/pg_main/external/tables/customers/import',
        );
        await client.datasources.external.refreshCatalog('pg_main');
        expect(String(fetchMock.mock.calls[3][0])).toBe(
            'http://localhost:3000/api/v1/datasources/pg_main/external/refresh-catalog',
        );
        await client.datasources.external.validate('pg_main');
        expect(String(fetchMock.mock.calls[4][0])).toBe(
            'http://localhost:3000/api/v1/datasources/pg_main/external/validate',
        );
        for (let i = 1; i <= 4; i++) expect(fetchMock.mock.calls[i][1].method).toBe('POST');
    });

    // [#6633] The three probe cases from the issue. Case A is the pin test
    // above (unconnected ⇒ the `/api/v1` convention, byte-identical to the
    // pre-#6633 hardcode). B and C cover the discovery-following half.
    it('[#6633] discovery WITHOUT packages/datasources keys leaves the convention untouched (case B)', async () => {
        const { client, fetchMock } = createMockClient({ tables: [] });
        // A server rebased to /backend/api/v9 that does not advertise the two
        // direct-mount keys — exactly what a pre-#6633 rest surface answers.
        (client as any)['discoveryInfo'] = {
            routes: { data: '/backend/api/v9/data', metadata: '/backend/api/v9/meta', ui: '/backend/api/v9/ui' },
        };
        await client.packages.list();
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:3000/api/v1/packages');
        await client.datasources.external.listTables('pg_main');
        expect(String(fetchMock.mock.calls[1][0])).toBe(
            'http://localhost:3000/api/v1/datasources/pg_main/external/tables',
        );
    });

    it('[#6633] BOTH packages.* and all five external.* follow advertised rebased routes (case C)', async () => {
        const { client, fetchMock } = createMockClient({ tables: [] });
        (client as any)['discoveryInfo'] = {
            routes: {
                data: '/backend/api/v9/data',
                metadata: '/backend/api/v9/meta',
                packages: '/backend/api/v9/packages',
                datasources: '/backend/api/v9/datasources',
            },
        };

        // packages.* — the mechanism that already existed, kept following.
        await client.packages.list();
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:3000/backend/api/v9/packages');

        // external.* — the half that ignored discovery entirely before #6633.
        // All five in ONE case so a half-fix (some methods still hard-coded)
        // cannot stay green.
        const base = 'http://localhost:3000/backend/api/v9/datasources/pg_main/external';
        await client.datasources.external.listTables('pg_main', { schema: 'public' });
        expect(String(fetchMock.mock.calls[1][0])).toBe(`${base}/tables?schema=public`);
        await client.datasources.external.draft('pg_main', 'customers');
        expect(String(fetchMock.mock.calls[2][0])).toBe(`${base}/tables/customers/draft`);
        await client.datasources.external.import('pg_main', 'customers');
        expect(String(fetchMock.mock.calls[3][0])).toBe(`${base}/tables/customers/import`);
        await client.datasources.external.refreshCatalog('pg_main');
        expect(String(fetchMock.mock.calls[4][0])).toBe(`${base}/refresh-catalog`);
        await client.datasources.external.validate('pg_main');
        expect(String(fetchMock.mock.calls[5][0])).toBe(`${base}/validate`);
    });

    // [#6714] Face 1: `email.send` joins `getRoute()`. Case A is the pin test
    // above ('email.send pins POST /email/send') — unconnected ⇒ the
    // `/api/v1/email/send` convention, byte-identical to the pre-#6714
    // hardcode. B and C cover the discovery-following half.
    it('[#6714] discovery WITHOUT an email key leaves the convention untouched (case B)', async () => {
        const { client, fetchMock } = createMockClient({ status: 'sent' });
        // A server rebased to /backend/api/v9 that does not advertise the
        // email key — exactly what a pre-#6714 rest surface answers.
        (client as any)['discoveryInfo'] = {
            routes: { data: '/backend/api/v9/data', metadata: '/backend/api/v9/meta' },
        };
        await client.email.send({ to: 'a@example.com', subject: 'Hello', text: 'hi' });
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:3000/api/v1/email/send');
    });

    it('[#6714] email.send follows the advertised rebased routes.email (case C)', async () => {
        const { client, fetchMock } = createMockClient({ status: 'sent' });
        (client as any)['discoveryInfo'] = {
            routes: {
                data: '/backend/api/v9/data',
                metadata: '/backend/api/v9/meta',
                email: '/backend/api/v9/email',
            },
        };
        await client.email.send({ to: 'a@example.com', subject: 'Hello', text: 'hi' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/backend/api/v9/email/send');
        expect(init.method).toBe('POST');
    });
});

describe('Approvals namespace (ADR-0019)', () => {
    it('should list approval requests with filters', async () => {
        const { client, fetchMock } = createMockClient({
            data: [{ id: 'req-1', status: 'pending', object_name: 'order', record_id: 'rec-1', process_name: 'flow:approve' }]
        });
        const result = await client.approvals.listRequests({ status: 'pending', approverId: 'user-1' });
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('req-1');
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/approvals/requests');
        expect(url).toContain('status=pending');
        expect(url).toContain('approverId=user-1');
    });

    it('should join array status filters', async () => {
        const { client, fetchMock } = createMockClient({ data: [] });
        await client.approvals.listRequests({ status: ['approved', 'rejected'] });
        const url = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
        expect(url).toContain('status=approved,rejected');
    });

    it('should get a single approval request', async () => {
        const { client, fetchMock } = createMockClient({
            id: 'req-1', status: 'pending', object_name: 'order', record_id: 'rec-1', process_name: 'flow:approve'
        });
        const result = await client.approvals.getRequest('req-1');
        expect(result.id).toBe('req-1');
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/approvals/requests/req-1');
    });

    it('should record an approve decision', async () => {
        const { client, fetchMock } = createMockClient({
            request: { id: 'req-1', status: 'approved' }, finalized: true, decision: 'approve', resumed: true
        });
        const result = await client.approvals.approve('req-1', { actorId: 'user-1', comment: 'Looks good' });
        expect(result.finalized).toBe(true);
        expect(result.decision).toBe('approve');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/approvals/requests/req-1/approve');
        expect(opts.method).toBe('POST');
        const body = JSON.parse(opts.body);
        expect(body.actorId).toBe('user-1');
        expect(body.comment).toBe('Looks good');
    });

    it('should record a reject decision', async () => {
        const { client, fetchMock } = createMockClient({
            request: { id: 'req-1', status: 'rejected' }, finalized: true, decision: 'reject'
        });
        const result = await client.approvals.reject('req-1', { comment: 'Missing fields' });
        expect(result.decision).toBe('reject');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/approvals/requests/req-1/reject');
        expect(opts.method).toBe('POST');
    });

    it('should list the action audit trail', async () => {
        const { client, fetchMock } = createMockClient({
            data: [{ id: 'act-1', request_id: 'req-1', action: 'approve', actor_id: 'user-1' }]
        });
        const result = await client.approvals.listActions('req-1');
        expect(result).toHaveLength(1);
        expect(result[0].action).toBe('approve');
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/approvals/requests/req-1/actions');
    });
});

describe('Auth enhancements', () => {
    it('should register a new user', async () => {
        const { client, fetchMock } = createMockClient({
            data: { token: 'new-token', user: { email: 'test@example.com' } }
        });
        const result = await client.auth.register({
            email: 'test@example.com',
            password: 'secret123',
            name: 'Test User'
        });
        expect(result.data.token).toBe('new-token');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/auth/sign-up/email'); // Updated to better-auth endpoint
        expect(opts.method).toBe('POST');
        // Token should be auto-set
        expect((client as any).token).toBe('new-token');
    });

    it('should refresh token', async () => {
        const { client, fetchMock } = createMockClient({
            data: { token: 'refreshed-token' }
        });
        const result = await client.auth.refreshToken('old-refresh-token');
        expect(result.data.token).toBe('refreshed-token');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/auth/get-session'); // Updated: better-auth uses get-session for refresh
        expect(opts.method).toBe('GET'); // Updated: GET instead of POST
        // Token should be auto-set
        expect((client as any).token).toBe('refreshed-token');
    });

    it('signInWithProvider defaults callbackURL to the current page (base-path-correct)', async () => {
        const assign = vi.fn();
        vi.stubGlobal('window', {
            location: { href: 'https://app.example.com/_console/login', assign },
        });
        try {
            const { client, fetchMock } = createMockClient({ url: 'https://accounts.google.com/o/oauth2/auth' });
            await client.auth.signInWithProvider('google');
            const [, opts] = fetchMock.mock.calls[0];
            // The SDK can't know the app's mount path, so it returns the user to
            // where they started rather than a hard-coded root '/login'.
            expect(JSON.parse(opts.body).callbackURL).toBe('https://app.example.com/_console/login');
            expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('signInWithProvider honours an explicit callbackURL', async () => {
        const assign = vi.fn();
        vi.stubGlobal('window', {
            location: { href: 'https://app.example.com/_console/login', assign },
        });
        try {
            const { client, fetchMock } = createMockClient({ url: 'https://accounts.google.com/o/oauth2/auth' });
            await client.auth.signInWithProvider('google', { callbackURL: 'https://app.example.com/_console/home' });
            const [, opts] = fetchMock.mock.calls[0];
            expect(JSON.parse(opts.body).callbackURL).toBe('https://app.example.com/_console/home');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('Notifications namespace', () => {
    it('should list notifications with filters', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { notifications: [], unreadCount: 0 }
        });
        await client.notifications.list({ read: false, limit: 10 });
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/notifications');
        expect(url).toContain('read=false');
        expect(url).toContain('limit=10');
    });

    it('[#6361] never puts a `cursor` on the query string — the SDK producer is gone', async () => {
        // The retired half of #6361 asserted where it was PRODUCED. `cursor` was
        // never a server-read filter; what made it harmful rather than inert is
        // that this method appended it, so a caller paginating by the published
        // contract re-read the first window forever with no error.
        //
        // The type surface is the enforced channel — `list({ cursor })` is a
        // TS2353 excess-property error, verified by reverse-verification and
        // unavailable to a runtime assertion. This pins the RUNTIME half, which
        // tsc cannot reach: an untyped caller (plain JS, a `Record` spread, a
        // hand-built options object) must not smuggle the parameter through.
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { notifications: [], unreadCount: 0 }
        });
        const untypedOptions = { read: false, limit: 10, cursor: 'n_42' } as unknown as { read?: boolean; limit?: number };
        await client.notifications.list(untypedOptions);
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('limit=10');
        expect(url).not.toContain('cursor');
        expect(url).not.toContain('n_42');
    });

    it('should mark notifications as read', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { success: true, readCount: 2 }
        });
        const result = await client.notifications.markRead(['n1', 'n2']);
        expect(result.readCount).toBe(2);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.ids).toEqual(['n1', 'n2']);
    });

    it('should mark all notifications as read', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { success: true, readCount: 5 }
        });
        const result = await client.notifications.markAllRead();
        expect(result.readCount).toBe(5);
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/notifications/read/all');
        expect(opts.method).toBe('POST');
    });
});

describe('AI namespace (#3718)', () => {
    /**
     * READ THIS BEFORE ADDING A TEST HERE.
     *
     * This block used to hold four passing tests for `ai.nlq`, `ai.suggest`
     * and `ai.insights`. Every one of them mocked `fetch` and asserted the URL
     * the client BUILT — never that anything answered it. All three endpoints
     * were mounted by nothing, in any repo, for the whole life of those tests
     * (#3584, #3611, #3636, #3702 are the same shape).
     *
     * So the assertions below are deliberately the *narrow* half — verb, path,
     * and the body decisions this SDK makes on the caller's behalf. The claim
     * that these paths RESOLVE is not made here and cannot be: the AI service
     * is a Cloud/EE package in the `cloud` repo. It is made where the routes
     * are, by `packages/service-ai/src/ai-route-ledger.conformance.test.ts`,
     * which reads `buildAIRoutes()` and drives this very namespace against it.
     */
    it('chat forces stream:false — the endpoint streams by default', async () => {
        const { client, fetchMock } = createMockClient({ content: 'hello', model: 'gpt-4o-mini' });
        const result = await client.ai.chat({ messages: [{ role: 'user', content: 'hi' }] });
        expect(result.content).toBe('hello');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('http://localhost:3000/api/v1/ai/chat');
        expect(opts.method).toBe('POST');
        // Without this the "JSON" method would come back as an SSE stream and
        // `res.json()` would throw on the first frame.
        expect(JSON.parse(opts.body).stream).toBe(false);
    });

    it('complete posts the prompt', async () => {
        const { client, fetchMock } = createMockClient({ content: '42' });
        const result = await client.ai.complete({ prompt: 'answer:' });
        expect(result.content).toBe('42');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('http://localhost:3000/api/v1/ai/complete');
        expect(JSON.parse(opts.body)).toEqual({ prompt: 'answer:' });
    });

    it('models reads the picker allowlist', async () => {
        const { client, fetchMock } = createMockClient({
            models: [{ id: 'gpt-4o-mini', label: 'GPT-4o mini', default: true }],
            defaultModel: 'gpt-4o-mini',
        });
        const result = await client.ai.models();
        expect(result.defaultModel).toBe('gpt-4o-mini');
        expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/ai/models');
    });

    it('conversations CRUD targets the six mounted routes', async () => {
        const conv = { id: 'c1', messages: [], createdAt: 'now', updatedAt: 'now' };

        const created = createMockClient(conv);
        await created.client.ai.conversations.create({ title: 'Q3' });
        expect(created.fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/ai/conversations');
        expect(created.fetchMock.mock.calls[0][1].method).toBe('POST');

        const listed = createMockClient({ conversations: [conv] });
        const list = await listed.client.ai.conversations.list({ limit: 10 });
        expect(list).toHaveLength(1);
        expect(listed.fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/ai/conversations?limit=10');

        const got = createMockClient(conv);
        await got.client.ai.conversations.get('c 1');
        expect(got.fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/ai/conversations/c%201');

        const patched = createMockClient(conv);
        await patched.client.ai.conversations.update('c1', { title: 'Renamed' });
        expect(patched.fetchMock.mock.calls[0][1].method).toBe('PATCH');

        const messaged = createMockClient(conv);
        await messaged.client.ai.conversations.addMessage('c1', { role: 'user', content: 'hi' });
        expect(messaged.fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/ai/conversations/c1/messages');
    });

    it('conversations.delete reports the 204 the route returns', async () => {
        // DELETE answers 204 with no body; unwrapping it would throw in json().
        const { client, fetchMock } = createMockClient(undefined, 204);
        expect(await client.ai.conversations.delete('c1')).toEqual({ deleted: true });
        expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    });

    it('chatStream parses the UI Message Stream frames, ignoring [DONE] and `g:` lines', async () => {
        const sse = [
            'data: {"type":"start"}\n\n',
            'data: {"type":"text-delta","id":"0","delta":"Hel"}\n\n',
            'g:{"text":"thinking"}\n',                       // legacy Data Stream line, single \n
            'data: {"type":"text-delta","id":"0","delta":"lo"}\n\n',
            'data: {"type":"finish","finishReason":"stop"}\n\ndata: [DONE]\n\n',
        ];
        const encoder = new TextEncoder();
        let i = 0;
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/event-stream' }),
            // Chunk boundaries deliberately fall mid-frame in the last entry.
            body: { getReader: () => ({
                read: async () => (i < sse.length
                    ? { done: false, value: encoder.encode(sse[i++]) }
                    : { done: true, value: undefined }),
            }) },
        });
        const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock });

        const frames: any[] = [];
        for await (const frame of await client.ai.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
            frames.push(frame);
        }

        expect(frames.map((f) => f.type)).toEqual(['start', 'text-delta', 'text-delta', 'finish']);
        expect(frames.filter((f) => f.type === 'text-delta').map((f) => f.delta).join('')).toBe('Hello');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('http://localhost:3000/api/v1/ai/chat');
        expect(JSON.parse(opts.body).stream).toBe(true);
        expect(opts.headers.Accept).toBe('text/event-stream');
    });

    it('chatStream fails loudly when the runtime exposes no response body', async () => {
        // The request still goes out — the failure is on the first read, which
        // is where a fetch polyfill without `Response.body` reveals itself.
        const { client, fetchMock } = createMockClient({});
        const stream = await client.ai.chatStream({ messages: [{ role: 'user', content: 'hi' }] });
        expect(fetchMock).toHaveBeenCalledOnce();
        await expect((async () => { for await (const _frame of stream) { /* drain */ } })())
            .rejects.toThrow(/no body/i);
    });
});

describe('i18n namespace', () => {
    it('should get available locales', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { locales: ['en', 'zh-CN', 'ja'], default: 'en' }
        });
        const result = await client.i18n.getLocales();
        expect(result.locales).toContain('en');
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/i18n/locales');
    });

    it('i18n.getTranslations speaks the path-param dialect every surface mounts (#3636)', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { locale: 'zh-CN', translations: { hello: '你好' } }
        });
        const result = await client.i18n.getTranslations('zh-CN');
        expect(result.locale).toBe('zh-CN');
        // NOT `/translations?locale=zh-CN` — no server mounts a bare
        // /translations, so the old query dialect 404'd everywhere.
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/i18n/translations/zh-CN',
        );
    });

    it('i18n.getTranslations sends no filter query — the server reads none (#3676)', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { locale: 'zh-CN', translations: { hello: '你好' } }
        });
        // This used to accept `{ namespace, keys }` and append them as query
        // params. Neither serving surface ever read them (the dispatcher takes
        // parts[1]/query.locale, service-i18n takes params.locale), so the
        // filter was inert and the caller got the full bundle either way. The
        // predecessor of this test asserted the query string was BUILT, which
        // pinned the phantom in place rather than the behaviour.
        await (client.i18n.getTranslations as (l: string, o?: unknown) => Promise<unknown>)(
            'zh-CN', { namespace: 'common', keys: ['a', 'b'] },
        );
        const url = String(fetchMock.mock.calls[0][0]);
        expect(url).toBe('http://localhost:3000/api/v1/i18n/translations/zh-CN');
        expect(url).not.toContain('?');
    });

    it('i18n.getFieldLabels puts both object and locale on the path (#3636)', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { object: 'customer', labels: { name: '名前' } }
        });
        const result = await client.i18n.getFieldLabels('customer', 'ja');
        expect(result.object).toBe('customer');
        // NOT `/labels/customer?locale=ja` — the mount is /labels/:object/:locale.
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/i18n/labels/customer/ja',
        );
    });
});

describe('QueryBuilder enhancements', () => {
    it('should add expand for nested relation loading', () => {
        const q = createQuery('order')
            .select('id', 'total')
            .expand('customer', { fields: ['name', 'email'] } as any)
            .expand('items')
            .build();
        expect(q.expand).toBeDefined();
        expect((q.expand as any).customer).toEqual({ fields: ['name', 'email'] });
        expect((q.expand as any).items).toEqual({});
    });

    it('should add full-text search', () => {
        const q = createQuery('customer')
            .search('alice', { fields: ['name', 'email'], fuzzy: true })
            .build();
        expect((q as any).search).toEqual({
            query: 'alice',
            fields: ['name', 'email'],
            fuzzy: true
        });
    });

    it('cursor()/distinct() are gone with query.cursor/query.distinct (#4286)', () => {
        // Both methods minted keys no executor ever read — cursor re-served
        // page 1 forever; distinct only degraded the REST count. The spec
        // tombstones reject the keys; the builder no longer produces them.
        const q: any = createQuery('customer');
        expect(q.cursor).toBeUndefined();
        expect(q.distinct).toBeUndefined();
    });
});

describe('FilterBuilder enhancements', () => {
    it('should add between filter', () => {
        const f = createFilter<{ age: number }>()
            .between('age', 18, 65)
            .build();
        // between generates: ['and', [field, '>=', min], [field, '<=', max]]
        expect(f[0]).toBe('and');
        expect(f[1]).toEqual(['age', '>=', 18]);
        expect(f[2]).toEqual(['age', '<=', 65]);
    });

    // [#7536] These three used to build a `like` tuple by gluing wildcards onto
    // the caller's value (`['name', 'like', '%alice%']`), which was wrong in two
    // directions at once. While the wire folded `like` onto `$contains` — which
    // LIKE-ESCAPES its comparand — the glued `%` came back as a literal percent
    // sign, so `.contains('name','alice')` searched for the text `%alice%` and
    // matched only rows containing percent signs. And once `like` reaches the
    // driver as a real pattern, the glue becomes the OTHER bug: a `%` or `_`
    // inside the caller's own value would silently become a wildcard. Naming the
    // operator that means what the method says removes both.
    it('should add contains filter as the literal-text operator', () => {
        const f = createFilter<{ name: string }>()
            .contains('name', 'alice')
            .build();
        expect(f).toEqual(['name', 'contains', 'alice']);
    });

    it('should not let the caller\'s own wildcards leak into a contains filter', () => {
        // The regression this shape prevents: `50%` is TEXT here, not a pattern.
        const f = createFilter<{ name: string }>()
            .contains('name', '50%')
            .build();
        expect(f).toEqual(['name', 'contains', '50%']);
    });

    it('should add startsWith filter', () => {
        const f = createFilter<{ name: string }>()
            .startsWith('name', 'A')
            .build();
        expect(f).toEqual(['name', 'starts_with', 'A']);
    });

    it('should add endsWith filter', () => {
        const f = createFilter<{ email: string }>()
            .endsWith('email', '.com')
            .build();
        expect(f).toEqual(['email', 'ends_with', '.com']);
    });

    it('should pass a like() pattern through UNCHANGED — the wildcards are the caller\'s', () => {
        // The one method that always meant "pattern", and the one the wire
        // lowering broke: `%Industries` matched nothing before #7536.
        const f = createFilter<{ name: string }>()
            .like('name', '%Industries')
            .build();
        expect(f).toEqual(['name', 'like', '%Industries']);
    });

    it('should add ilike filter for a case-insensitive pattern', () => {
        const f = createFilter<{ name: string }>()
            .ilike('name', '%industries')
            .build();
        expect(f).toEqual(['name', 'ilike', '%industries']);
    });

    it('should add exists filter', () => {
        const f = createFilter<{ phone: string }>()
            .exists('phone')
            .build();
        expect(f).toEqual(['phone', 'is_not_null', null]);
    });
});

// ==========================================
// Automation Client Tests
// ==========================================

describe('ObjectStackClient.automation', () => {
    it('should list flows', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { flows: ['flow_a', 'flow_b'], total: 2, hasMore: false },
        });

        const result = await client.automation.list();
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation',
            expect.any(Object),
        );
        expect(result.flows).toEqual(['flow_a', 'flow_b']);
    });

    it('should get a flow by name', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { name: 'my_flow', label: 'My Flow' },
        });

        const result = await client.automation.get('my_flow');
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation/my_flow',
            expect.any(Object),
        );
        expect(result.name).toBe('my_flow');
    });

    it('should create a flow', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { name: 'new_flow' },
        });

        await client.automation.create('new_flow', { label: 'New' });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('should update a flow', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { name: 'my_flow', label: 'Updated' },
        });

        await client.automation.update('my_flow', { label: 'Updated' });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation/my_flow',
            expect.objectContaining({ method: 'PUT' }),
        );
    });

    it('should delete a flow', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { name: 'old_flow', deleted: true },
        });

        const result = await client.automation.delete('old_flow');
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation/old_flow',
            expect.objectContaining({ method: 'DELETE' }),
        );
        expect(result.deleted).toBe(true);
    });

    it('should toggle a flow', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { name: 'my_flow', enabled: false },
        });

        const result = await client.automation.toggle('my_flow', false);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation/my_flow/toggle',
            expect.objectContaining({ method: 'POST' }),
        );
        expect(result.enabled).toBe(false);
    });

    it('should list runs for a flow', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { runs: [{ id: 'run_1' }], hasMore: false },
        });

        const result = await client.automation.runs.list('my_flow');
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation/my_flow/runs',
            expect.any(Object),
        );
        expect(result.runs).toHaveLength(1);
    });

    it('should list runs with pagination options', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { runs: [], hasMore: false },
        });

        await client.automation.runs.list('my_flow', { limit: 5, cursor: 'abc' });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation/my_flow/runs?limit=5&cursor=abc',
            expect.any(Object),
        );
    });

    it('should get a single run', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { id: 'run_1', status: 'completed' },
        });

        const result = await client.automation.runs.get('my_flow', 'run_1');
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation/my_flow/runs/run_1',
            expect.any(Object),
        );
        expect(result.id).toBe('run_1');
    });

    it('should still support legacy trigger', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { result: 'ok' } });

        await client.automation.trigger('my_flow', { key: 'val' });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation/trigger/my_flow',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    // ── screen-flow runtime (ADR-0019 durable pause, #3528) ──────────────

    it('should resume a paused run with the collected screen input', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { success: true, output: {}, durationMs: 12 },
        });

        const result = await client.automation.resume('my_flow', 'run_1', {
            inputs: { new_assignee: 'ada@example.com' },
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation/my_flow/runs/run_1/resume',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ inputs: { new_assignee: 'ada@example.com' } }),
            }),
        );
        expect(result.success).toBe(true);
    });

    it('should resume with an approval branch label and node output', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { success: true } });

        await client.automation.resume('my_flow', 'run_1', {
            output: { comment: 'looks good' },
            branchLabel: 'approve',
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation/my_flow/runs/run_1/resume',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ output: { comment: 'looks good' }, branchLabel: 'approve' }),
            }),
        );
    });

    it('should post an empty signal when resuming with no input', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { success: true } });

        await client.automation.resume('my flow', 'run 1');
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation/my%20flow/runs/run%201/resume',
            expect.objectContaining({ method: 'POST', body: '{}' }),
        );
    });

    it('should return the next screen when a multi-step wizard pauses again', async () => {
        const { client } = createMockClient({
            success: true,
            data: {
                success: true,
                status: 'paused',
                runId: 'run_1',
                screen: { nodeId: 'step2', title: 'Opportunity', fields: [] },
            },
        });

        const result = await client.automation.resume('my_flow', 'run_1', { inputs: { account_id: 'a1' } });
        expect(result.status).toBe('paused');
        expect(result.screen.nodeId).toBe('step2');
    });

    // [#8684] BREAKING: a run that resumed and then FAILED used to resolve with
    // `{ success: false, error }` under HTTP 200 — the double envelope #3962
    // ruled out for `/actions` — so a caller that did not open the inner
    // envelope read a failed run as a successful one. The route now answers 400
    // `FLOW_FAILED`, and this SDK's `fetch` layer throws on every non-2xx before
    // any unwrapping, so the call REJECTS. That is the whole SDK-side change:
    // no new code, a changed contract, and this is the pin for it.
    //
    // Asserting the classification (`code` + `httpStatus`) and the author's
    // message location, not merely that it throws: an SDK that rejected with a
    // bare `Error` would satisfy `.rejects.toThrow()` while losing everything a
    // caller branches on.
    it('should reject with FLOW_FAILED when a resumed run fails', async () => {
        const { client } = createMockClient({
            success: false,
            error: {
                code: 'FLOW_FAILED',
                message: "Node 'create_opportunity' failed: Amount must be greater than zero",
                httpStatus: 400,
                details: {
                    errorMessage: 'We could not create the opportunity — check the amount and try again.',
                    summary: { nodes: [{ nodeId: 'create_opportunity', status: 'failure' }] },
                },
            },
        }, 400);

        const err: any = await client.automation
            .resume('my_flow', 'run_1', { inputs: { amount: 0 } })
            .then(() => { throw new Error('expected the failed resume to reject'); }, (e) => e);

        expect(err.code).toBe('FLOW_FAILED');
        expect(err.httpStatus).toBe(400);
        expect(err.message).toMatch(/Node 'create_opportunity' failed/);
        // The flow author's own text keeps its one documented location — the
        // ADR-0112 envelope has no `data`, and the console reads it from here.
        expect(err.details?.errorMessage)
            .toBe('We could not create the opportunity — check the amount and try again.');
        expect(err.details?.summary?.nodes?.[0]?.status).toBe('failure');
    });

    // [#8684] The stale-suspension half: nothing ran, the pause is gone for
    // good, so it rejects as a 404 rather than as a business rejection.
    it('should reject with 404 when the suspension is stale', async () => {
        const { client } = createMockClient({
            success: false,
            error: {
                code: 'NOT_FOUND',
                message: "Suspended node 'collect' no longer exists in flow 'my_flow'",
                httpStatus: 404,
            },
        }, 404);

        const err: any = await client.automation
            .resume('my_flow', 'run_1', { inputs: {} })
            .then(() => { throw new Error('expected the stale resume to reject'); }, (e) => e);

        expect(err.httpStatus).toBe(404);
        expect(err.code).not.toBe('FLOW_FAILED');
        expect(err.message).toMatch(/no longer exists in flow/);
    });

    // [#9378] BREAKING, and the wide half of the same flip: DISPATCHING a flow.
    // `client.automation.trigger()` (legacy route) and `.execute()` used to
    // resolve with `{ success: false, error }` under HTTP 200 for a run that
    // ran and failed — every app dispatches flows through this door, so a
    // caller that never opened the inner envelope read every failed run as a
    // successful one. The route answers 400 `FLOW_FAILED` now and this SDK's
    // fetch layer throws on non-2xx before any unwrapping, so both surfaces
    // REJECT. No SDK code changed; the contract did, and these are its pins.
    //
    // Both spellings are pinned, not one: `trigger()` reads `res.json()` while
    // `execute()` reads `unwrapResponse()`, so a regression in either unwrap
    // path would be invisible from the other's test.
    const failedRunBody = {
        success: false,
        error: {
            code: 'FLOW_FAILED',
            message: "Node 'create_opportunity' failed: Amount must be greater than zero",
            httpStatus: 400,
            details: {
                errorMessage: 'We could not create the opportunity — check the amount and try again.',
                summary: { nodes: [{ nodeId: 'create_opportunity', status: 'failure' }] },
            },
        },
    };

    it('should reject with FLOW_FAILED when a triggered flow runs and fails (legacy trigger)', async () => {
        const { client } = createMockClient(failedRunBody, 400);

        const err: any = await client.automation
            .trigger('my_flow', { amount: 0 })
            .then(() => { throw new Error('expected the failed trigger to reject'); }, (e) => e);

        // The classification, not merely that it threw: an SDK rejecting with a
        // bare `Error` would satisfy `.rejects.toThrow()` while losing
        // everything a caller branches on.
        expect(err.code).toBe('FLOW_FAILED');
        expect(err.httpStatus).toBe(400);
        expect(err.message).toMatch(/Node 'create_opportunity' failed/);
        // The flow author's own text keeps its one documented location — the
        // ADR-0112 envelope has no `data`, and the console reads it from here.
        expect(err.details?.errorMessage)
            .toBe('We could not create the opportunity — check the amount and try again.');
    });

    it('should reject with FLOW_FAILED when execute() dispatches a flow that fails', async () => {
        const { client } = createMockClient(failedRunBody, 400);

        const err: any = await client.automation
            .execute('my_flow', { params: { amount: 0 } })
            .then(() => { throw new Error('expected the failed execute to reject'); }, (e) => e);

        expect(err.code).toBe('FLOW_FAILED');
        expect(err.httpStatus).toBe(400);
        expect(err.details?.summary?.nodes?.[0]?.status).toBe('failure');
    });

    it('should reject with 404 when the triggered flow does not exist', async () => {
        const { client } = createMockClient({
            success: false,
            error: { code: 'RESOURCE_NOT_FOUND', message: "Flow 'no_such_flow' not found", httpStatus: 404 },
        }, 404);

        const err: any = await client.automation
            .execute('no_such_flow', {})
            .then(() => { throw new Error('expected the unknown flow to reject'); }, (e) => e);

        expect(err.httpStatus).toBe(404);
        expect(err.code).not.toBe('FLOW_FAILED');
        expect(err.message).toContain('no_such_flow');
    });

    // [#9415] The ruling's remaining two rows, mirrored on the SDK because the
    // SDK is where the distinction is consumed. Both are NEVER-DISPATCHED
    // refusals: nothing ran, nothing was written, and a caller that retries a
    // 422 is retrying an authoring defect. `err.code` is what a caller branches
    // on — a pin asserting only that the promise rejected would stay green if
    // both refusals collapsed onto one status, which is the whole thing the two
    // new union members exist to prevent.
    //
    // Both spellings are pinned again for the reason the FLOW_FAILED pins give:
    // `trigger()` reads `res.json()` while `execute()` reads `unwrapResponse()`,
    // so a regression in either unwrap path is invisible from the other's test.
    it('should reject with 409 FLOW_DISABLED when the flow is switched off (legacy trigger)', async () => {
        const { client } = createMockClient({
            success: false,
            error: { code: 'FLOW_DISABLED', message: "Flow 'welcome_flow' is disabled", httpStatus: 409 },
        }, 409);

        const err: any = await client.automation
            .trigger('welcome_flow', {})
            .then(() => { throw new Error('expected the disabled flow to reject'); }, (e) => e);

        expect(err.code).toBe('FLOW_DISABLED');
        expect(err.httpStatus).toBe(409);
        expect(err.message).toContain('is disabled');
        // Not a failed RUN: the operator's remedy is to enable the flow, and
        // FLOW_FAILED would send them to look at a run that never existed.
        expect(err.code).not.toBe('FLOW_FAILED');
    });

    it('should reject with 422 FLOW_NO_START_NODE when the definition cannot run', async () => {
        const { client } = createMockClient({
            success: false,
            error: { code: 'FLOW_NO_START_NODE', message: 'Flow has no start node', httpStatus: 422 },
        }, 422);

        const err: any = await client.automation
            .execute('startless_flow', {})
            .then(() => { throw new Error('expected the startless flow to reject'); }, (e) => e);

        expect(err.code).toBe('FLOW_NO_START_NODE');
        expect(err.httpStatus).toBe(422);
        expect(err.message).toContain('no start node');
        expect(err.code).not.toBe('FLOW_FAILED');
    });

    it('should keep the two never-dispatched refusals distinguishable from each other', async () => {
        // One member per condition is the point of the #9415 widening; a caller
        // deciding "retry after enabling" vs "fix the definition" reads exactly
        // this difference.
        const disabled: any = await createMockClient({
            success: false,
            error: { code: 'FLOW_DISABLED', message: 'x', httpStatus: 409 },
        }, 409).client.automation.execute('f', {}).then(() => null, (e) => e);
        const startless: any = await createMockClient({
            success: false,
            error: { code: 'FLOW_NO_START_NODE', message: 'x', httpStatus: 422 },
        }, 422).client.automation.execute('f', {}).then(() => null, (e) => e);

        expect(disabled.code).not.toBe(startless.code);
        expect(disabled.httpStatus).not.toBe(startless.httpStatus);
    });

    it('should still resolve when a triggered flow succeeds', async () => {
        // The other half of the contract: a successful dispatch is untouched,
        // including the paused screen-flow shape the runner drives.
        const { client } = createMockClient({
            success: true,
            data: { success: true, status: 'paused', runId: 'run_1', screen: { nodeId: 'collect', fields: [] } },
        }, 200);

        const result: any = await client.automation.execute('my_flow', {});
        expect(result.status).toBe('paused');
        expect(result.runId).toBe('run_1');
    });

    it('should fetch the screen a paused run awaits', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { runId: 'run_1', screen: { nodeId: 'collect', fields: [] } },
        });

        const result = await client.automation.getScreen('my_flow', 'run_1');
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/automation/my_flow/runs/run_1/screen',
            expect.any(Object),
        );
        expect(result.screen.nodeId).toBe('collect');
    });

    // ==========================================
    // capabilities getter
    // ==========================================

    it('should return undefined capabilities before connect', () => {
        const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000' });
        expect(client.capabilities).toBeUndefined();
    });

    it('should expose capabilities after connect', async () => {
        const caps = {
            comments: true,
            automation: false,
            cron: false,
            search: true,
            export: false,
            chunkedUpload: false,
        };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                version: 'v1',
                apiName: 'ObjectStack API',
                capabilities: caps,
            }),
        });

        const client = new ObjectStackClient({
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        await client.connect();
        expect(client.capabilities).toBeDefined();
        expect(client.capabilities!.comments).toBe(true);
        expect(client.capabilities!.automation).toBe(false);
        expect(client.capabilities!.search).toBe(true);
    });

    it('should expose the transactionalBatch capability (hierarchical → flat) for declarative negotiation (#3298)', async () => {
        // A real backend serves the hierarchical shape `{ key: { enabled } }`.
        // The client normalizes it to a flat boolean so callers can decide at
        // connect time whether to send an atomic batch or fall back to
        // non-atomic simulation — instead of runtime-probing POST /batch.
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                version: 'v1',
                apiName: 'ObjectStack API',
                capabilities: {
                    comments: { enabled: false },
                    transactionalBatch: { enabled: true },
                },
            }),
        });

        const client = new ObjectStackClient({
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
        });

        await client.connect();
        expect(client.capabilities!.transactionalBatch).toBe(true);
    });
});

// ==========================================
// QueryOptionsV2 (Canonical Query Syntax) Tests
// ==========================================

/**
 * `data.find()` transport parameters — ONE expectation table, BOTH copies.
 *
 * `find` is implemented twice: `ObjectStackClient.data.find` and
 * `ScopedProjectClient.data.find`. They are two faces of ONE wire contract
 * (the scoped one differs only in the URL prefix) and were byte-identical
 * copies of the same normalization — including the same defect. Every row
 * below is therefore driven through BOTH and compared against the SAME
 * expected query string, so a future edit that lands on only one of them goes
 * red here instead of shipping a fork.
 *
 * The expectations are EXACT full query strings, not `toContain` substrings:
 * the defect this suite was written for (#6322) was a param that never
 * appeared at all, and a substring assertion on the params that DID appear
 * stays green through exactly that.
 *
 * Seeded from the measurements in #6322.
 */
describe('data.find() — canonical/legacy transport parameters (both copies)', () => {
    /** The query string a call put on the wire (`''` when it sent none). */
    function queryOf(url: string): string {
        const q = url.indexOf('?');
        return q === -1 ? '' : url.slice(q + 1);
    }

    /** Drive the SAME options through both `find` implementations. */
    async function driveBoth(options: QueryOptions | QueryOptionsV2): Promise<{ direct: string; scoped: string }> {
        const body = { success: true, data: { object: 'task', records: [], total: 0 } };

        const a = createMockClient(body);
        await a.client.data.find('task', options);
        const direct = queryOf(a.fetchMock.mock.calls[0][0] as string);

        const b = createMockClient(body);
        await b.client.project('env-1').data.find('task', options);
        const scoped = queryOf(b.fetchMock.mock.calls[0][0] as string);

        return { direct, scoped };
    }

    interface TransportRow {
        options: QueryOptions | QueryOptionsV2;
        /** The exact query string both copies must emit. */
        wire: string;
    }

    /**
     * A key declared on `QueryOptionsV2` and on NO legacy `QueryOptions`
     * spelling — recomputed here from the two exported interfaces rather than
     * restated, so it tracks them.
     */
    type CanonicalOnlyKey = Exclude<keyof QueryOptionsV2, keyof QueryOptions>;

    /**
     * ONE ROW PER CANONICAL-ONLY KEY, DRIVEN ALONE. This is the shape of the
     * #6322 defect: `find('task', { limit: 20 })` — a canonical key as the
     * ONLY key — was not recognised as canonical vocabulary, fell to the
     * legacy branch, which reads no `limit`, and reached the server with an
     * EMPTY query string. HTTP 200, server default page size, no warning.
     * Its pagination twin `{ offset: 5 }` worked, because `offset` happened to
     * be in the hand-written sniff list and `limit` did not.
     *
     * `Record<CanonicalOnlyKey, …>` is the anti-rot device: a new key added to
     * `QueryOptionsV2` makes this object a COMPILE error until someone states
     * what that key puts on the wire — which is the question the old
     * hand-maintained sniff list let two keys (`limit`, `expand`) slip past.
     */
    const SINGLE_CANONICAL_KEY: Record<CanonicalOnlyKey, TransportRow> = {
        where: { options: { where: { contact_id: 'c1' } }, wire: 'contact_id=c1' },
        fields: { options: { fields: ['id', 'amount'] }, wire: 'select=id%2Camount' },
        orderBy: { options: { orderBy: ['-created_at'] }, wire: 'sort=-created_at' },
        limit: { options: { limit: 20 }, wire: 'top=20' },
        offset: { options: { offset: 5 }, wire: 'skip=5' },
        expand: { options: { expand: ['contact'] }, wire: 'expand=contact' },
    };

    /** The five paired keys, canonical spelling. */
    const CANONICAL_FULL: QueryOptionsV2 = {
        where: { contact_id: 'c1' },
        fields: ['id', 'amount'],
        orderBy: ['-created_at'],
        limit: 20,
        offset: 5,
    };

    /** The same query, legacy spelling. Must reach the wire byte-identically. */
    const LEGACY_FULL: QueryOptions = {
        filter: { contact_id: 'c1' },
        select: ['id', 'amount'],
        sort: ['-created_at'],
        top: 20,
        skip: 5,
    };

    const ROWS: Record<string, TransportRow> = {
        'canonical: where + fields + orderBy + limit + offset': {
            options: CANONICAL_FULL,
            wire: 'top=20&skip=5&sort=-created_at&select=id%2Camount&contact_id=c1',
        },
        'legacy: filter + select + sort + top + skip': {
            options: LEGACY_FULL,
            wire: 'top=20&skip=5&sort=-created_at&select=id%2Camount&contact_id=c1',
        },
        ...Object.fromEntries(
            Object.entries(SINGLE_CANONICAL_KEY).map(([key, row]) => [`canonical single key: { ${key} }`, row]),
        ),
        // The legacy twins of the two pagination keys — pinned alongside so a
        // change that fixes one vocabulary by breaking the other goes red.
        'legacy single key: { top }': { options: { top: 20 }, wire: 'top=20' },
        'legacy single key: { skip }': { options: { skip: 5 }, wire: 'skip=5' },

        // ── #6485: ZERO IS A VALUE, NOT AN ABSENCE ──────────────────────────
        //
        // The two pagination params were emitted on TRUTHINESS
        // (`if (normalizedOptions.top)`) while the canonical branch ten lines
        // above already normalized them on PRESENCE (`if (v2.limit != null)`).
        // So `0` survived the normalizer and was then discarded by the
        // emitter, in both copies.
        //
        // `limit: 0` is the half that changes the answer, and the direction is
        // measured, not assumed. Through the REST list route
        // (`ObjectStackProtocolImplementation.findData`) `top=0` is neither
        // rejected nor ignored: it folds to `limit: 0` and reaches the engine,
        // and `SqlDriver.find` — the driver behind the default file-backed
        // SQLite datasource — applies pagination on presence
        // (`if (query.limit !== undefined) b.limit(query.limit)`), so the
        // statement carries `LIMIT 0` and answers with zero rows. Dropping the
        // param instead did NOT mean "the server's default page": this route
        // has no default page size, so an absent `top` returns the ENTIRE
        // match set. `find('task', { limit: 0 })` therefore answered with every
        // record when it asked for none — HTTP 200, no warning.
        //
        // `offset: 0` / `skip: 0` are the consistency half: `skip=0` is already
        // the server's default, so sending it or omitting it means the same
        // thing. They are pinned here because the emitter must not have two
        // rules for one pair, not because the wire meaning changed.
        'canonical zero: { limit: 0 }': { options: { limit: 0 }, wire: 'top=0' },
        'canonical zero: { offset: 0 }': { options: { offset: 0 }, wire: 'skip=0' },
        'legacy zero: { top: 0 }': { options: { top: 0 }, wire: 'top=0' },
        'legacy zero: { skip: 0 }': { options: { skip: 0 }, wire: 'skip=0' },
        'canonical zero pair: { limit: 0, offset: 0 }': {
            options: { limit: 0, offset: 0 },
            wire: 'top=0&skip=0',
        },
        'canonical: where + limit': {
            options: { where: { contact_id: 'c1' }, limit: 20 },
            wire: 'top=20&contact_id=c1',
        },
        'canonical: where + expand': {
            options: { where: { contact_id: 'c1' }, expand: ['contact'] },
            wire: 'contact_id=c1&expand=contact',
        },
        // `expand` reaches the wire as `expand=<comma-separated relation
        // names>` — the one spelling `HttpFindQueryParamsSchema` declares for
        // the GET list route and the protocol normalizer splits on commas.
        'canonical: expand as a name array': {
            options: { expand: ['contact', 'owner'] },
            wire: 'expand=contact%2Cowner',
        },
        // The `Record` form contributes its KEYS — the same relation names the
        // server derives from the comma list.
        'canonical: expand as a relation map': {
            options: { expand: { contact: {}, owner: {} } },
            wire: 'expand=contact%2Cowner',
        },
        'no options at all': { options: {}, wire: '' },
    };

    for (const [name, row] of Object.entries(ROWS)) {
        it(`${name} → \`${row.wire}\` on both copies`, async () => {
            const { direct, scoped } = await driveBoth(row.options);
            expect(direct).toBe(row.wire);
            expect(scoped).toBe(row.wire);
        });
    }

    it('canonical and legacy spellings of one query are byte-identical on the wire', async () => {
        const canonical = await driveBoth(CANONICAL_FULL);
        const legacy = await driveBoth(LEGACY_FULL);
        expect(canonical.direct).toBe(legacy.direct);
        expect(canonical.scoped).toBe(legacy.scoped);
    });

    /**
     * [#6485] `{ limit: 0 }` and `{}` are DIFFERENT REQUESTS, and the wire has
     * to be able to tell them apart.
     *
     * The table rows above pin each spelling's exact query string. This asserts
     * the property those rows exist for: the two bags must not collapse onto
     * one wire. Stated as an inequality rather than as two more literals
     * because the defect was precisely a collapse — `top` absent in both cases,
     * so the caller who asked for no records and the caller who asked for
     * everything sent byte-identical requests and got byte-identical answers.
     *
     * Both copies, one property: a fix landing on only one of them leaves the
     * other's pair equal and this goes red.
     */
    it('`{ limit: 0 }` is distinguishable from `{}` on the wire, on both copies', async () => {
        const zero = await driveBoth({ limit: 0 });
        const absent = await driveBoth({});

        expect(zero.direct).not.toBe(absent.direct);
        expect(zero.scoped).not.toBe(absent.scoped);
    });

    /**
     * A nested per-relation query inside `expand` has no spelling on a GET, so
     * it is REFUSED rather than trimmed away — trimming would send a wider
     * read than the caller asked for and say nothing.
     *
     * This is a client-side pre-flight guard, not an HTTP rejection, so there
     * is no ADR-0112 `code`/`status` envelope to assert. The two independent
     * bits asserted instead: the message names the offending relation AND the
     * nested keys it could not carry, and NO request was issued — so a
     * "refusal" that fired after the read had already gone out, or one that
     * resolved instead of throwing, both go red.
     */
    it('refuses a nested per-relation expand on both copies, before any request', async () => {
        const nested: QueryOptionsV2 = { expand: { contact: { fields: ['name'] } } };

        const a = createMockClient({ success: true, data: { object: 'task', records: [] } });
        await expect(a.client.data.find('task', nested)).rejects.toThrow(
            /expand\['contact'\] carries a nested query \(fields\)/,
        );
        expect(a.fetchMock).not.toHaveBeenCalled();

        const b = createMockClient({ success: true, data: { object: 'task', records: [] } });
        await expect(b.client.project('env-1').data.find('task', nested)).rejects.toThrow(
            /expand\['contact'\] carries a nested query \(fields\)/,
        );
        expect(b.fetchMock).not.toHaveBeenCalled();
    });
});

describe('QueryBuilder — offset() alias', () => {
    it('should set offset via .offset() method', () => {
        const q = createQuery('task')
            .limit(10)
            .offset(20)
            .build();
        expect(q.limit).toBe(10);
        expect(q.offset).toBe(20);
    });

    it('should set offset via deprecated .skip() method', () => {
        const q = createQuery('task')
            .limit(10)
            .skip(30)
            .build();
        expect(q.offset).toBe(30);
    });
});

// ----------------------------------------------------------------------
// ScopedProjectClient — project-scoped sub-client (Phase 2)
// ----------------------------------------------------------------------

describe('ScopedProjectClient', () => {
    it('prefixes meta.getTypes with /projects/:id', async () => {
        const { client, fetchMock } = createMockClient({ types: ['object'] });
        const scoped = client.project('proj-123');
        await scoped.meta.getTypes();
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/environments/proj-123/meta',
            expect.any(Object),
        );
    });

    it('prefixes data.find with /projects/:id', async () => {
        const { client, fetchMock } = createMockClient({ records: [] });
        const scoped = client.project('proj-123');
        await scoped.data.find('task', { top: 5 });
        const url = (fetchMock.mock.calls[0] as any[])[0] as string;
        expect(url.startsWith('http://localhost:3000/api/v1/environments/proj-123/data/task')).toBe(true);
        expect(url).toContain('top=5');
    });

    it('prefixes data.get / data.create / data.update / data.delete', async () => {
        const { client, fetchMock } = createMockClient({ id: 't1' });
        const scoped = client.project('proj-xyz');

        await scoped.data.get('task', 't1');
        expect(fetchMock).toHaveBeenLastCalledWith(
            'http://localhost:3000/api/v1/environments/proj-xyz/data/task/t1',
            expect.any(Object),
        );

        await scoped.data.create('task', { title: 'hi' });
        expect(fetchMock).toHaveBeenLastCalledWith(
            'http://localhost:3000/api/v1/environments/proj-xyz/data/task',
            expect.objectContaining({ method: 'POST' }),
        );

        await scoped.data.update('task', 't1', { title: 'ok' });
        expect(fetchMock).toHaveBeenLastCalledWith(
            'http://localhost:3000/api/v1/environments/proj-xyz/data/task/t1',
            expect.objectContaining({ method: 'PATCH' }),
        );

        await scoped.data.delete('task', 't1');
        expect(fetchMock).toHaveBeenLastCalledWith(
            'http://localhost:3000/api/v1/environments/proj-xyz/data/task/t1',
            expect.objectContaining({ method: 'DELETE' }),
        );
    });

    it('url-encodes the environmentId', async () => {
        const { client, fetchMock } = createMockClient({ types: [] });
        const scoped = client.project('proj with space');
        await scoped.meta.getTypes();
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/environments/proj%20with%20space/meta',
            expect.any(Object),
        );
    });

    it('throws when environmentId is missing', () => {
        const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000' });
        // No `@ts-expect-error` here, and that is the finding of #5449 rather than
        // an omission. `project(environmentId: string)` accepts `''` — it is a
        // perfectly good `string` — so the directive that sat on this line
        // suppressed nothing and reported TS2578 ("unused") the first time a tsc
        // program read the file. Its own comment said what the test actually
        // proves: the empty id is rejected at RUNTIME, by the guard below.
        expect(() => client.project('')).toThrow(/environmentId is required/);
    });

    it('exposes environmentId via getProjectId()', () => {
        const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000' });
        const scoped = client.project('00000000-0000-0000-0000-000000000001');
        expect(scoped.getProjectId()).toBe('00000000-0000-0000-0000-000000000001');
    });

    // [#6714 face 3] The scoped prefix derives from the advertised
    // `routes.data` base (the `scoping` block carries posture only — no path
    // — so `routes.data` is the one derivable source). Case A = the pin tests
    // above: unconnected ⇒ byte-identical `/api/v1/environments/...`. B and C
    // below cover the derivation half.
    it('[#6714] scoped prefix follows the advertised base of routes.data (case C) — every namespace', async () => {
        const { client, fetchMock } = createMockClient({ ok: true, types: [] });
        (client as any)['discoveryInfo'] = {
            routes: { data: '/backend/api/v9/data', metadata: '/backend/api/v9/meta' },
        };
        const scoped = client.project('proj-123');
        const base = 'http://localhost:3000/backend/api/v9/environments/proj-123';

        // All namespaces build off ONE scope() — drive one method from each so
        // a half-fix (some namespaces re-hardcoding the prefix) cannot stay
        // green.
        await scoped.meta.getTypes();
        expect(String(fetchMock.mock.calls[0][0])).toBe(`${base}/meta`);
        await scoped.data.get('task', 't1');
        expect(String(fetchMock.mock.calls[1][0])).toBe(`${base}/data/task/t1`);
        await scoped.packages.list();
        expect(String(fetchMock.mock.calls[2][0])).toBe(`${base}/packages`);
        await scoped.automation.getFlow('flow-1');
        expect(String(fetchMock.mock.calls[3][0])).toBe(`${base}/automation/flow-1`);
        await scoped.data.batchTransaction([{ operation: 'create', object: 'task', data: {} } as any]);
        expect(String(fetchMock.mock.calls[4][0])).toBe(`${base}/batch`);
    });

    it('[#6714] a custom dataPrefix makes the base underivable — the convention holds, byte-identical (case B)', async () => {
        const { client, fetchMock } = createMockClient({ types: [] });
        // routes.data does not end with the conventional `/data`, so the base
        // cannot be derived honestly; the client must NOT guess (contract-first
        // — no lenient re-parsing) and falls back to the convention,
        // byte-identical to the pre-#6714 behavior.
        (client as any)['discoveryInfo'] = {
            routes: { data: '/backend/api/v9/records', metadata: '/backend/api/v9/meta' },
        };
        await client.project('proj-123').meta.getTypes();
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/environments/proj-123/meta',
        );
    });

    it('[#6714] a scoped discovery response strips its OWN /environments/{id} segment before re-scoping', async () => {
        const { client, fetchMock } = createMockClient({ types: [] });
        // Discovery answered from the environment-scoped mount: routes.data is
        // `{base}/environments/{served-id}/data` and scoping says so. The
        // derived base must be the UNSCOPED one, so a scoped client for a
        // DIFFERENT environment does not stack two scope segments.
        (client as any)['discoveryInfo'] = {
            routes: {
                data: '/backend/api/v9/environments/env-served/data',
                metadata: '/backend/api/v9/environments/env-served/meta',
            },
            scoping: { enabled: true, resolution: 'auto', scoped: true, environmentId: 'env-served' },
        };
        await client.project('proj-other').meta.getTypes();
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/backend/api/v9/environments/proj-other/meta',
        );
    });

    it('[#6714] a scoped response whose environmentId the host never resolved still strips ONE scope segment', async () => {
        const { client, fetchMock } = createMockClient({ types: [] });
        // `rest-server.ts` advertises `scoping.environmentId` as
        // `req.params?.environmentId` — a host that did not populate the route
        // param answers `scoped: true` with NO id, and `routes.data` keeps the
        // literal `:environmentId`. Stripping on the strength of `scoped` alone
        // is sound (a scoped base ends with that segment by construction) and
        // is what keeps `scope()` from stacking two scope segments.
        (client as any)['discoveryInfo'] = {
            routes: {
                data: '/backend/api/v9/environments/:environmentId/data',
                metadata: '/backend/api/v9/environments/:environmentId/meta',
            },
            scoping: { enabled: true, resolution: 'auto', scoped: true },
        };
        await client.project('proj-other').meta.getTypes();
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/backend/api/v9/environments/proj-other/meta',
        );
    });

    it('[#6714] scoped:true with no recognisable scope segment DECLINES — convention, never a doubled prefix', async () => {
        const { client, fetchMock } = createMockClient({ types: [] });
        // A base the derivation does not understand: `scoped` claims the
        // response came off the scoped mount, but `routes.data` carries no
        // `/environments/{seg}` to remove. Returning it unchanged would build
        // `…/tenants/t1/environments/proj-other/meta` — a URL neither mount
        // serves, i.e. strictly worse than the hardcode. Decline instead.
        (client as any)['discoveryInfo'] = {
            routes: { data: '/backend/api/v9/tenants/t1/data' },
            scoping: { enabled: true, resolution: 'auto', scoped: true },
        };
        await client.project('proj-other').meta.getTypes();
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/environments/proj-other/meta',
        );
    });

    it('prefixes the screen-flow automation.resume / getScreen calls', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { success: true } });
        const scoped = client.project('proj-123');

        await scoped.automation.resume('my_flow', 'run_1', { inputs: { note: 'ok' } });
        expect(fetchMock).toHaveBeenLastCalledWith(
            'http://localhost:3000/api/v1/environments/proj-123/automation/my_flow/runs/run_1/resume',
            expect.objectContaining({ method: 'POST', body: JSON.stringify({ inputs: { note: 'ok' } }) }),
        );

        await scoped.automation.getScreen('my_flow', 'run_1');
        expect(fetchMock).toHaveBeenLastCalledWith(
            'http://localhost:3000/api/v1/environments/proj-123/automation/my_flow/runs/run_1/screen',
            expect.any(Object),
        );
    });
});

// ==========================================
// Locale propagation (issue #1319)
// ==========================================

describe('ObjectStackClient locale → Accept-Language', () => {
    /** Pull the headers object from the most recent fetch call. */
    function lastHeaders(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
        const call = fetchMock.mock.calls.at(-1);
        return (call?.[1]?.headers ?? {}) as Record<string, string>;
    }

    it('sends no Accept-Language when no locale is configured', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: {} });
        await client.meta.getItem('object', 'customer');
        expect(lastHeaders(fetchMock)['Accept-Language']).toBeUndefined();
    });

    it('sends the configured locale as Accept-Language', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: {} }), headers: new Headers(),
        });
        const client = new ObjectStackClient({
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock,
            locale: 'zh-CN',
        });
        await client.meta.getItem('object', 'customer');
        expect(lastHeaders(fetchMock)['Accept-Language']).toBe('zh-CN');
    });

    it('setLocale() updates the header on subsequent requests', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: {} });
        await client.meta.getItem('object', 'customer');
        expect(lastHeaders(fetchMock)['Accept-Language']).toBeUndefined();

        client.setLocale('zh-CN');
        await client.meta.getItem('object', 'customer');
        expect(lastHeaders(fetchMock)['Accept-Language']).toBe('zh-CN');
        expect(client.getLocale()).toBe('zh-CN');

        client.setLocale(undefined);
        await client.meta.getItem('object', 'customer');
        expect(lastHeaders(fetchMock)['Accept-Language']).toBeUndefined();
    });
});

describe('Import-job namespace', () => {
    it('createImportJob POSTs the payload to /data/:object/import/jobs', async () => {
        const { client, fetchMock } = createMockClient({ jobId: 'imp_x', object: 'task', status: 'pending', total: 3, createdAt: '2026-07-01T00:00:00Z' });
        const res = await client.data.createImportJob('task', { format: 'json', rows: [{ id: 'a' }] } as any);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://localhost:3000/api/v1/data/task/import/jobs');
        expect(init.method).toBe('POST');
        expect(res).toMatchObject({ jobId: 'imp_x', status: 'pending', total: 3 });
    });

    it('getImportJobProgress GETs /data/import/jobs/:jobId', async () => {
        const { client, fetchMock } = createMockClient({ jobId: 'imp_x', object: 'task', status: 'running', percentComplete: 40 });
        const res = await client.data.getImportJobProgress('imp_x');
        expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/data/import/jobs/imp_x');
        expect(res.percentComplete).toBe(40);
    });

    it('getImportJobResults GETs the /results sub-route', async () => {
        const { client, fetchMock } = createMockClient({ jobId: 'imp_x', status: 'succeeded', results: [{ row: 1, ok: true, action: 'created' }], resultsTruncated: false });
        const res = await client.data.getImportJobResults('imp_x');
        expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/data/import/jobs/imp_x/results');
        expect(res.results).toHaveLength(1);
        expect(res.resultsTruncated).toBe(false);
    });

    it('listImportJobs builds the query string and unwraps the jobs array', async () => {
        const { client, fetchMock } = createMockClient({ jobs: [{ jobId: 'imp_x', object: 'task', status: 'succeeded' }] });
        const jobs = await client.data.listImportJobs({ object: 'task', status: 'succeeded', limit: 10, offset: 5 });
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url.startsWith('http://localhost:3000/api/v1/data/import/jobs?')).toBe(true);
        expect(url).toContain('object=task');
        expect(url).toContain('status=succeeded');
        expect(url).toContain('limit=10');
        expect(url).toContain('offset=5');
        expect(jobs).toHaveLength(1);
        expect(jobs[0].jobId).toBe('imp_x');
    });

    it('cancelImportJob POSTs the /cancel sub-route', async () => {
        const { client, fetchMock } = createMockClient({ success: true });
        const res = await client.data.cancelImportJob('imp_x');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://localhost:3000/api/v1/data/import/jobs/imp_x/cancel');
        expect(init.method).toBe('POST');
        expect(res.success).toBe(true);
    });

    it('undoImportJob POSTs the /undo sub-route', async () => {
        const { client, fetchMock } = createMockClient({ success: true, jobId: 'imp_x', object: 'task', deleted: 3, restored: 2, failed: 0 });
        const res = await client.data.undoImportJob('imp_x');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('http://localhost:3000/api/v1/data/import/jobs/imp_x/undo');
        expect(init.method).toBe('POST');
        expect(res.success).toBe(true);
        expect(res.deleted).toBe(3);
        expect(res.restored).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// HTTP error shaping — `.message` is shown to end users verbatim (console
// error toast), so it must carry only the server's human-readable message:
// no `[ObjectStack]` branding, no `CODE:` prefix. Codes stay programmatic.
// ---------------------------------------------------------------------------
describe('HTTP error shaping', () => {
    it('surfaces the server error message verbatim, with code/status attached programmatically', async () => {
        const businessMsg = '制作基地被「项目主计划批次」引用(3 条),删除被阻断,请先解除引用';
        const { client } = createMockClient({ error: businessMsg, code: 'SOME_CODE' }, 400);
        let caught: any;
        try {
            await client.data.delete('pm_base', 'rec_1');
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeDefined();
        expect(caught.message).toBe(businessMsg);
        expect(caught.message).not.toMatch(/\[ObjectStack\]|SOME_CODE/);
        expect(caught.code).toBe('SOME_CODE');
        expect(caught.httpStatus).toBe(400);
    });

    it('falls back to statusText when the body has no message', async () => {
        const { client } = createMockClient({}, 500);
        let caught: any;
        try {
            await client.data.delete('pm_base', 'rec_1');
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeDefined();
        expect(caught.message).toBe('Error');
        expect(caught.httpStatus).toBe(500);
    });
});

// ---------------------------------------------------------------------------
// #3918 follow-up — one error shape across both server envelopes.
//
// `@objectstack/rest` answers flat (`{ error, code, fields }`); the runtime
// dispatcher answers wrapped (`{ success, error: { message, code, details } }`)
// where `error.code` is the HTTP STATUS and the semantic code lives in
// `details.code`. Reading the wrapped `error.code` straight through handed
// callers the number 400 where the flat form handed them 'VALIDATION_FAILED',
// so the branch our own docs teach never matched on a dispatcher-served
// surface. These pin the normalisation that makes `err.code` / `err.fields`
// mean the same thing whichever surface answered.
// ---------------------------------------------------------------------------
describe('HTTP error shaping — envelope normalisation', () => {
    const FIELDS = [
        { field: 'email', code: 'invalid_email', message: 'email must be a valid email address' },
    ];

    /** What @objectstack/rest's `mapDataError` puts on the wire. */
    const FLAT = { error: 'Validation failed', code: 'VALIDATION_FAILED', fields: FIELDS };

    /**
     * What the runtime dispatcher put on the wire between #3918 and #3842: the
     * HTTP status in `code`, the real code parked in `details`. Kept as a
     * fixture to PIN the #4007 retirement — the SDK deliberately no longer
     * digs this shape's parking spot (one release train; ADR-0112 renamed the
     * code values, so a dug-out code matches no current branch anyway).
     */
    const WRAPPED_LEGACY = {
        success: false,
        error: {
            message: 'Validation failed',
            code: 400,
            details: { code: 'VALIDATION_FAILED', fields: FIELDS },
        },
    };

    /** What the runtime dispatcher puts on the wire since #3842. */
    const WRAPPED = {
        success: false,
        error: {
            code: 'VALIDATION_FAILED',
            message: 'Validation failed',
            httpStatus: 400,
            details: { fields: FIELDS },
        },
    };

    it('exposes the SEMANTIC code from the flat envelope', async () => {
        const { client } = createMockClient(FLAT, 400);
        const caught: any = await client.data.delete('pm_base', 'rec_1').catch((e) => e);

        expect(caught.code).toBe('VALIDATION_FAILED');
        expect(caught.httpStatus).toBe(400);
    });

    it('exposes the SEMANTIC code from the wrapped envelope, not the HTTP status', async () => {
        // The regression this guards: `caught.code` used to be the number 400.
        const { client } = createMockClient(WRAPPED, 400);
        const caught: any = await client.data.delete('pm_base', 'rec_1').catch((e) => e);

        expect(caught.code).toBe('VALIDATION_FAILED');
        expect(caught.code).not.toBe(400);
        // The status is still available — it just isn't `code`.
        expect(caught.httpStatus).toBe(400);
    });

    it('no longer digs the pre-#3842 parking spot (#4007: retired pairing)', async () => {
        // #3842 cured this at the producer; #4007 retired the client-side dig.
        // SDK and server ship as a changesets fixed group, and ADR-0112
        // batches 1–2 renamed the code VALUES — a code dug out of an old
        // server's `details.code` would not match any branch written against
        // the current catalog, so the read protected nothing.
        const { client } = createMockClient(WRAPPED_LEGACY, 400);
        const caught: any = await client.data.delete('pm_base', 'rec_1').catch((e) => e);

        expect(caught.code).toBeUndefined();
        // Everything else about the legacy shape still normalises: `fields`
        // lives at `error.details.fields` in the CURRENT wrapped envelope too,
        // and the message/status reads are shape-independent.
        expect(caught.fields).toEqual(FIELDS);
        expect(caught.httpStatus).toBe(400);
        expect(caught.message).toBe('Validation failed');
    });

    it('reports the same code from both live envelopes for the same failure', async () => {
        // The asymmetry #3636 → #3675 → #3689 → #3842 has been closing: which
        // surface answered must stop being observable to the caller.
        const codes = await Promise.all(
            [FLAT, WRAPPED].map((body) =>
                createMockClient(body, 400).client.data
                    .delete('pm_base', 'rec_1')
                    .catch((e: any) => e.code),
            ),
        );

        expect(codes).toEqual(['VALIDATION_FAILED', 'VALIDATION_FAILED']);
    });

    it('exposes `fields[]` at the same place for BOTH envelopes', async () => {
        const flat: any = await createMockClient(FLAT, 400).client.data
            .delete('pm_base', 'rec_1').catch((e) => e);
        const wrapped: any = await createMockClient(WRAPPED, 400).client.data
            .delete('pm_base', 'rec_1').catch((e) => e);

        expect(flat.fields).toEqual(FIELDS);
        expect(wrapped.fields).toEqual(FIELDS);
    });

    it('leaves `fields` unset when the server sent none', async () => {
        // Callers branch on presence; an empty array would be a lie about a
        // failure that had nothing to do with per-field validation.
        const { client } = createMockClient({ error: 'nope', code: 'PERMISSION_DENIED' }, 403);
        const caught: any = await client.data.delete('pm_base', 'rec_1').catch((e) => e);

        expect(caught.fields).toBeUndefined();
        expect(caught.code).toBe('PERMISSION_DENIED');
    });

    it('reads `category` / `retryable` from inside `error`, where the contract declares them (#4006)', async () => {
        // These two used to be read from the body TOP level, where no envelope
        // ever put them — `err.category` / `err.retryable` were `undefined`
        // against every conformant server (ADR-0112 D9b).
        const { client } = createMockClient(
            {
                success: false,
                error: {
                    code: 'SERVICE_UNAVAILABLE',
                    message: 'engine still booting',
                    httpStatus: 503,
                    category: 'availability',
                    retryable: true,
                },
            },
            503,
        );
        const caught: any = await client.data.delete('pm_base', 'rec_1').catch((e) => e);

        expect(caught.category).toBe('availability');
        expect(caught.retryable).toBe(true);
    });

    it('leaves `category` / `retryable` unset when the server sent neither', async () => {
        const { client } = createMockClient(FLAT, 400);
        const caught: any = await client.data.delete('pm_base', 'rec_1').catch((e) => e);

        expect(caught.category).toBeUndefined();
        expect(caught.retryable).toBeUndefined();
    });

    it('never reports a numeric code, even with no details to fall back on', async () => {
        // A pre-#3918 dispatcher body: wrapped, but no `details` at all.
        const { client } = createMockClient(
            { success: false, error: { message: 'boom', code: 500 } },
            500,
        );
        const caught: any = await client.data.delete('pm_base', 'rec_1').catch((e) => e);

        expect(caught.code).toBeUndefined();
        expect(caught.message).toBe('boom');
        expect(caught.httpStatus).toBe(500);
    });

    it('keeps `details` = the whole body for the flat envelope (unchanged)', async () => {
        const { client } = createMockClient(FLAT, 400);
        const caught: any = await client.data.delete('pm_base', 'rec_1').catch((e) => e);

        expect(caught.details).toEqual(FLAT);
    });

    it('points `details` at the structured object for the wrapped envelope', async () => {
        const { client } = createMockClient(WRAPPED, 400);
        const caught: any = await client.data.delete('pm_base', 'rec_1').catch((e) => e);

        // Post-#3842 the code is no longer duplicated in here — it is the
        // `error.code` the caller branches on, and `details` is context only.
        expect(caught.details).toEqual({ fields: FIELDS });
    });

    it('still honours a top-level `details` when the server sends one', async () => {
        const body = { message: 'bad', code: 'X', details: { limit: 1000 } };
        const { client } = createMockClient(body, 400);
        const caught: any = await client.data.delete('pm_base', 'rec_1').catch((e) => e);

        expect(caught.details).toEqual({ limit: 1000 });
    });
});

describe('packages.install', () => {
    const MANIFEST = { id: 'com.acme.crm', name: 'Acme CRM', version: '1.0.0', type: 'app' };

    it('POSTs the manifest and omits `overwrite` unless requested', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { package: { manifest: MANIFEST } } });
        await client.packages.install(MANIFEST, { enableOnInstall: true });

        expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/v1/packages', expect.any(Object));
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.manifest).toEqual(MANIFEST);
        expect(body.enableOnInstall).toBe(true);
        // Duplicate-id guard semantics: never send `overwrite` implicitly —
        // the server must keep 409ing on an existing id by default.
        expect('overwrite' in body).toBe(false);
    });

    it('passes `overwrite: true` through for intentional upgrade / re-install', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { package: { manifest: MANIFEST } } });
        await client.packages.install(MANIFEST, { overwrite: true });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.overwrite).toBe(true);
    });
});

// ==========================================
// Atomic cross-object batch (#1604 / ADR-0034 item 4)
// ==========================================

describe('data.batchTransaction', () => {
    const OPS = [
        { object: 'project', action: 'create' as const, data: { name: 'Apollo' } },
        { object: 'task', action: 'create' as const, data: { title: 'Kickoff', project: { $ref: 0 } } },
    ];

    it('POSTs { operations, atomic: true } to the root /batch route', async () => {
        const { client, fetchMock } = createMockClient({ results: [{ id: 'p1' }, { id: 't1' }] });
        const res = await client.data.batchTransaction(OPS);

        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/batch',
            expect.objectContaining({ method: 'POST' }),
        );
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.operations).toHaveLength(2);
        // Always atomic — the SDK never exposes a non-atomic variant; the
        // server 400s on `atomic: false` (BATCH_NOT_ATOMIC).
        expect(body.atomic).toBe(true);
        expect(res.results).toEqual([{ id: 'p1' }, { id: 't1' }]);
    });

    it('serializes intra-batch { $ref } parent references verbatim', async () => {
        const { client, fetchMock } = createMockClient({ results: [] });
        await client.data.batchTransaction(OPS);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.operations[1].data.project).toEqual({ $ref: 0 });
    });

    it('unwraps both the bare and the enveloped response shape', async () => {
        // Bare `{ results }` (what the endpoint sends today)
        const bare = createMockClient({ results: [{ id: 'a' }] });
        expect((await bare.client.data.batchTransaction(OPS)).results).toEqual([{ id: 'a' }]);

        // `{ success, data }` envelope (BaseResponse-wrapped variant)
        const wrapped = createMockClient({ success: true, data: { results: [{ id: 'b' }] } });
        expect((await wrapped.client.data.batchTransaction(OPS)).results).toEqual([{ id: 'b' }]);
    });

    it('derives the batch route from a discovery-overridden data route', async () => {
        const { client, fetchMock } = createMockClient({ results: [] });
        (client as any)['discoveryInfo'] = { routes: { data: '/custom/v9/data' } };
        await client.data.batchTransaction(OPS);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/custom/v9/batch',
            expect.any(Object),
        );
    });

    it('surfaces server rejections with code/status attached (BATCH_UNRESOLVED_REF)', async () => {
        const { client } = createMockClient(
            { error: "Unresolved $ref 5 on field 'project'", code: 'BATCH_UNRESOLVED_REF' },
            400,
        );
        let caught: any;
        try {
            await client.data.batchTransaction(OPS);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeDefined();
        expect(caught.code).toBe('BATCH_UNRESOLVED_REF');
        expect(caught.httpStatus).toBe(400);
    });

    it('is mirrored on the environment-scoped client', async () => {
        const { client, fetchMock } = createMockClient({ results: [] });
        await client.project('proj-1').data.batchTransaction(OPS);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/environments/proj-1/batch',
            expect.objectContaining({ method: 'POST' }),
        );
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.atomic).toBe(true);
    });
});

// [#3584] The analytics surface speaks the DISPATCHER dialect. The previous
// shapes (`GET /analytics/meta/:cube`, `POST /analytics/explain`) were served
// by nothing — not the dispatcher, not @objectstack/rest — and 404ed against
// every deployment. These pin the reconciled URLs so they cannot drift back.
describe('Analytics namespace (#3584 dispatcher alignment)', () => {
    it('meta() lists all cubes via GET /analytics/meta', async () => {
        const { client, fetchMock } = createMockClient({ data: [] });
        await client.analytics.meta();
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/analytics/meta',
            expect.anything(),
        );
    });

    it('meta(cube) filters with ?cube=, URL-encoded', async () => {
        const { client, fetchMock } = createMockClient({ data: [] });
        await client.analytics.meta('sales leads');
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/analytics/meta?cube=sales%20leads',
            expect.anything(),
        );
    });

    it('explain() dry-runs via POST /analytics/sql', async () => {
        const { client, fetchMock } = createMockClient({ data: { sql: 'SELECT 1', params: [] } });
        await client.analytics.explain({ cube: 'leads' });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3000/api/v1/analytics/sql',
            expect.objectContaining({ method: 'POST', body: JSON.stringify({ cube: 'leads' }) }),
        );
    });
});
