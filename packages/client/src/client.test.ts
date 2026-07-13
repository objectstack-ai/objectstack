import { describe, it, expect, vi } from 'vitest';
import { ObjectStackClient, QueryBuilder, FilterBuilder, createQuery, createFilter } from './index';

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
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ 
                name: 'customer',
                fields: []
            })
        });

        const client = new ObjectStackClient({ 
            baseUrl: 'http://localhost:3000',
            fetch: fetchMock
        });

        const result = await client.meta.getItem('object', 'customer');
        expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/v1/meta/object/customer', expect.any(Object));
        expect(result.name).toBe('customer');
    });
});

describe('Permissions namespace', () => {
    it('should check permission with all params', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { allowed: true, reason: 'owner' }
        });
        const result = await client.permissions.check({
            object: 'customer',
            action: 'read',
            recordId: '123',
            field: 'email'
        });
        expect(result).toEqual({ allowed: true, reason: 'owner' });
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/permissions/check');
        expect(url).toContain('object=customer');
        expect(url).toContain('action=read');
        expect(url).toContain('recordId=123');
        expect(url).toContain('field=email');
    });

    it('should check permission without optional params', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { allowed: false }
        });
        const result = await client.permissions.check({
            object: 'order',
            action: 'delete'
        });
        expect(result).toEqual({ allowed: false });
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).not.toContain('recordId');
        expect(url).not.toContain('field=');
    });

    it('should get object permissions', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { object: 'customer', permissions: { read: true, create: true } }
        });
        const result = await client.permissions.getObjectPermissions('customer');
        expect(result.object).toBe('customer');
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/permissions/objects/customer');
    });

    it('should get effective permissions', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { roles: ['admin'], permissions: [] }
        });
        const result = await client.permissions.getEffectivePermissions();
        expect(result.roles).toEqual(['admin']);
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/permissions/effective');
    });
});

describe('Realtime namespace', () => {
    it('should connect to realtime', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { connectionId: 'conn-1', transport: 'websocket' }
        });
        const result = await client.realtime.connect({ transport: 'websocket' as any });
        expect(result.connectionId).toBe('conn-1');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/realtime/connect');
        expect(opts.method).toBe('POST');
    });

    it('should disconnect from realtime', async () => {
        const { client, fetchMock } = createMockClient({ success: true });
        await client.realtime.disconnect();
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/realtime/disconnect');
        expect(opts.method).toBe('POST');
    });

    it('should subscribe to a channel', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { subscriptionId: 'sub-1' }
        });
        const result = await client.realtime.subscribe({
            channel: 'customer.changes',
            events: ['create', 'update']
        });
        expect(result.subscriptionId).toBe('sub-1');
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.channel).toBe('customer.changes');
        expect(body.events).toEqual(['create', 'update']);
    });

    it('should unsubscribe from a channel', async () => {
        const { client, fetchMock } = createMockClient({ success: true });
        await client.realtime.unsubscribe('sub-1');
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.subscriptionId).toBe('sub-1');
    });

    it('should set presence', async () => {
        const { client, fetchMock } = createMockClient({ success: true });
        await client.realtime.setPresence('room-1', { status: 'online' } as any);
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/realtime/presence');
        expect(opts.method).toBe('PUT');
        const body = JSON.parse(opts.body);
        expect(body.channel).toBe('room-1');
        expect(body.state.status).toBe('online');
    });

    it('should get presence for a channel', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { channel: 'room-1', members: [] }
        });
        const result = await client.realtime.getPresence('room-1');
        expect(result.channel).toBe('room-1');
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/realtime/presence/room-1');
    });
});

describe('Workflow namespace', () => {
    it('should get workflow config', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { object: 'order', states: ['draft', 'submitted'] }
        });
        const result = await client.workflow.getConfig('order');
        expect(result.object).toBe('order');
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/workflow/order/config');
    });

    it('should get workflow state', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { state: 'draft', transitions: ['submit'] }
        });
        const result = await client.workflow.getState('order', 'rec-1');
        expect(result.state).toBe('draft');
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/workflow/order/rec-1/state');
    });

    it('should execute workflow transition', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { success: true, newState: 'submitted' }
        });
        const result = await client.workflow.transition({
            object: 'order',
            recordId: 'rec-1',
            transition: 'submit',
            comment: 'Ready for review'
        });
        expect(result.newState).toBe('submitted');
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.transition).toBe('submit');
        expect(body.comment).toBe('Ready for review');
    });

    // ADR-0019: approve/reject left the workflow namespace — they now live on
    // `client.approvals` (approval is a flow node, not a workflow step).
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

describe('Views namespace', () => {
    it('should list views for an object', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { views: [{ id: 'v1', name: 'Default' }] }
        });
        const result = await client.views.list('customer', 'list');
        expect(result.views).toHaveLength(1);
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/ui/views/customer');
        expect(url).toContain('type=list');
    });

    it('should list views without type filter', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { views: [] }
        });
        await client.views.list('order');
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/ui/views/order');
        expect(url).not.toContain('type=');
    });

    it('should get a specific view', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { id: 'v1', name: 'Default', type: 'list' }
        });
        const result = await client.views.get('customer', 'v1');
        expect(result.id).toBe('v1');
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/ui/views/customer/v1');
    });

    it('should create a view', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { id: 'v2', name: 'Custom View' }
        });
        const result = await client.views.create('customer', { name: 'Custom View' } as any);
        expect(result.id).toBe('v2');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/ui/views/customer');
        expect(opts.method).toBe('POST');
    });

    it('should update a view', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { id: 'v1', name: 'Updated View' }
        });
        const result = await client.views.update('customer', 'v1', { name: 'Updated View' } as any);
        expect(result.name).toBe('Updated View');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/ui/views/customer/v1');
        expect(opts.method).toBe('PUT');
    });

    it('should delete a view', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { deleted: true }
        });
        const result = await client.views.delete('customer', 'v1');
        expect(result.deleted).toBe(true);
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/ui/views/customer/v1');
        expect(opts.method).toBe('DELETE');
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
    it('should register a device', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { deviceId: 'dev-1', registered: true }
        });
        const result = await client.notifications.registerDevice({
            token: 'push-token',
            platform: 'web',
            deviceId: 'dev-1'
        });
        expect(result.deviceId).toBe('dev-1');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/notifications/devices');
        expect(opts.method).toBe('POST');
    });

    it('should unregister a device', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { success: true }
        });
        await client.notifications.unregisterDevice('dev-1');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/notifications/devices/dev-1');
        expect(opts.method).toBe('DELETE');
    });

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

describe('AI namespace', () => {
    it('should execute natural language query', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { query: { object: 'customer', where: {} }, confidence: 0.95 }
        });
        const result = await client.ai.nlq({ query: 'find all active customers' });
        expect(result.confidence).toBe(0.95);
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/ai/nlq');
        expect(opts.method).toBe('POST');
    });

    it('should not expose chat method (use Vercel AI SDK useChat directly)', () => {
        const { client } = createMockClient({ success: true, data: {} });
        // ai.chat was removed — consumers should use @ai-sdk/react useChat() directly
        expect(client.ai).not.toHaveProperty('chat');
    });

    it('should get AI suggestions', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { suggestions: ['Alice Corp', 'Alpha Inc'] }
        });
        const result = await client.ai.suggest({
            object: 'customer',
            field: 'name',
            partial: 'Al'
        });
        expect(result.suggestions).toHaveLength(2);
    });

    it('should get AI insights', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { type: 'summary', insights: [] }
        });
        const result = await client.ai.insights({
            object: 'order',
            type: 'summary'
        });
        expect(result.type).toBe('summary');
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toContain('/api/v1/ai/insights');
        expect(opts.method).toBe('POST');
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

    it('should get translations', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { locale: 'zh-CN', translations: { hello: '你好' } }
        });
        const result = await client.i18n.getTranslations('zh-CN', { namespace: 'common' });
        expect(result.locale).toBe('zh-CN');
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/i18n/translations');
        expect(url).toContain('locale=zh-CN');
        expect(url).toContain('namespace=common');
    });

    it('should get field labels', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { object: 'customer', labels: { name: '名前' } }
        });
        const result = await client.i18n.getFieldLabels('customer', 'ja');
        expect(result.object).toBe('customer');
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/api/v1/i18n/labels/customer');
        expect(url).toContain('locale=ja');
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

    it('should set cursor for keyset pagination', () => {
        const q = createQuery('customer')
            .cursor({ id: 'last-seen-id', created_at: '2024-01-01' })
            .build();
        expect((q as any).cursor).toEqual({
            id: 'last-seen-id',
            created_at: '2024-01-01'
        });
    });

    it('should enable distinct', () => {
        const q = createQuery('customer')
            .select('status')
            .distinct()
            .build();
        expect((q as any).distinct).toBe(true);
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

    // ==========================================
    // capabilities getter
    // ==========================================

    it('should return undefined capabilities before connect', () => {
        const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000' });
        expect(client.capabilities).toBeUndefined();
    });

    it('should expose capabilities after connect', async () => {
        const caps = {
            feed: true,
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
        expect(client.capabilities!.feed).toBe(true);
        expect(client.capabilities!.automation).toBe(false);
        expect(client.capabilities!.search).toBe(true);
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
        // @ts-expect-error — empty string rejected at runtime
        expect(() => client.project('')).toThrow(/environmentId is required/);
    });

    it('exposes environmentId via getProjectId()', () => {
        const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000' });
        const scoped = client.project('00000000-0000-0000-0000-000000000001');
        expect(scoped.getProjectId()).toBe('00000000-0000-0000-0000-000000000001');
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
