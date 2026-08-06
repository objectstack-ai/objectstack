import { describe, it, expect, vi } from 'vitest';
// `QueryBuilder` / `FilterBuilder` are named only by the `describe` blocks below;
// the suites build them through `createQuery` / `createFilter`, so importing the
// classes themselves left two unused bindings (TS6133) the moment this file
// entered a tsc program (#5449).
import { ObjectStackClient, createQuery, createFilter } from './index';

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
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ 
                version: 'v1', 
                apiName: 'ObjectStack',
                capabilities: ['metadata', 'data', 'ui'],
                endpoints: {}
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

    it('should add contains filter', () => {
        const f = createFilter<{ name: string }>()
            .contains('name', 'alice')
            .build();
        expect(f).toEqual(['name', 'like', '%alice%']);
    });

    it('should add startsWith filter', () => {
        const f = createFilter<{ name: string }>()
            .startsWith('name', 'A')
            .build();
        expect(f).toEqual(['name', 'like', 'A%']);
    });

    it('should add endsWith filter', () => {
        const f = createFilter<{ email: string }>()
            .endsWith('email', '.com')
            .build();
        expect(f).toEqual(['email', 'like', '%.com']);
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

describe('QueryOptionsV2 — canonical find()', () => {
    it('should accept canonical field names (where, fields, orderBy, limit, offset)', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { object: 'account', records: [], total: 0 }
        });

        await client.data.find('account', {
            where: { status: 'active' },
            fields: ['name', 'email'],
            orderBy: ['-created_at'],
            limit: 10,
            offset: 5,
        });

        const url = fetchMock.mock.calls[0][0] as string;
        // V2 canonical options are normalized to HTTP transport params
        expect(url).toContain('top=10');
        expect(url).toContain('skip=5');
        expect(url).toContain('select=name%2Cemail');
        expect(url).toContain('sort=-created_at');
        // where → filter as JSON
        expect(url).toContain('status=active');
    });

    it('should still accept legacy field names (filter, select, sort, top, skip)', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { object: 'account', records: [], total: 0 }
        });

        await client.data.find('account', {
            filter: { industry: 'Tech' },
            select: ['name'],
            sort: ['-revenue'],
            top: 20,
            skip: 0,
        });

        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('top=20');
        expect(url).toContain('select=name');
        expect(url).toContain('sort=-revenue');
        expect(url).toContain('industry=Tech');
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
