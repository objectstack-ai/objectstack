
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';
import { ObjectKernel } from '@objectstack/core';

describe('HttpDispatcher', () => {
    let kernel: ObjectKernel;
    let dispatcher: HttpDispatcher;
    let mockProtocol: any;
    let mockObjectQL: any;

    beforeEach(() => {
        // Mock Kernel
        mockProtocol = {
            saveMetaItem: vi.fn().mockResolvedValue({ success: true, message: 'Saved' }),
            getMetaItem: vi.fn().mockResolvedValue({ success: true, item: { foo: 'bar' } }),
            findData: vi.fn().mockResolvedValue({ object: 'test', records: [], total: 0 }),
            getData: vi.fn().mockResolvedValue({ object: 'test', id: '1', record: {} }),
        };

        mockObjectQL = {
            insert: vi.fn().mockResolvedValue({ id: 'new_1' }),
            find: vi.fn().mockResolvedValue([]),
            update: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue({}),
            getObjects: vi.fn().mockReturnValue({}),
            registry: {
                getObject: vi.fn().mockReturnValue({ name: 'test_obj' }),
                getRegisteredTypes: vi.fn().mockReturnValue([]),
                getAllPackages: vi.fn().mockReturnValue([]),
            },
        };

        kernel = {
            context: {
                getService: (name: string) => {
                    if (name === 'protocol') return mockProtocol;
                    if (name === 'objectql') return mockObjectQL;
                    return null;
                }
            }
        } as any;

        dispatcher = new HttpDispatcher(kernel);
    });

    describe('handleMetadata', () => {
        it('should handle PUT /metadata/:type/:name by calling protocol.saveMetaItem', async () => {
            const context = { request: {} };
            const body = { label: 'New Label' };
            const path = '/objects/my_obj';

            const result = await dispatcher.handleMetadata(path, context, 'PUT', body);

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(mockProtocol.saveMetaItem).toHaveBeenCalledWith({
                type: 'objects',
                name: 'my_obj',
                item: body
            });
            expect(result.response?.body).toEqual({
                success: true,
                data: { success: true, message: 'Saved' },
                meta: undefined
            });
        });

        it('should handle PUT with compound name (3+ path segments)', async () => {
            const context = { request: {} };
            const body = { density: 'compact' };
            // /metadata/lead/views/all_leads → type='lead', name='views/all_leads'
            const path = '/lead/views/all_leads';

            const result = await dispatcher.handleMetadata(path, context, 'PUT', body);

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(mockProtocol.saveMetaItem).toHaveBeenCalledWith({
                type: 'lead',
                name: 'views/all_leads',
                item: body,
            });
        });

        it('should fallback to MetadataService when protocol is missing saveMetaItem', async () => {
             // Mock protocol without saveMetaItem, but MetadataService with saveItem
            const mockMetaSvc = {
                saveItem: vi.fn().mockResolvedValue({ success: true, fromMetaSvc: true }),
            };
            (kernel as any).context.getService = (name: string) => {
                if (name === 'protocol') return {};
                if (name === 'metadata') return mockMetaSvc;
                if (name === 'objectql') return mockObjectQL;
                return null;
            };

            const context = { request: {} };
            const body = { label: 'Fallback' };
            const path = '/objects/my_obj';

            const result = await dispatcher.handleMetadata(path, context, 'PUT', body);

            expect(result.handled).toBe(true);
            expect(mockMetaSvc.saveItem).toHaveBeenCalledWith('objects', 'my_obj', body);
            expect(result.response?.body?.data).toEqual({ success: true, fromMetaSvc: true });
        });

        it('should return error if save fails', async () => {
            mockProtocol.saveMetaItem.mockRejectedValue(new Error('Save failed'));

            const context = { request: {} };
            const body = {};
            const path = '/objects/bad_obj';

            const result = await dispatcher.handleMetadata(path, context, 'PUT', body);

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(400);
            expect(result.response?.body?.error?.message).toBe('Save failed');
        });
        
        it('should handle READ operations via ObjectQL registry', async () => {
             mockObjectQL.registry.getObject.mockReturnValue({ name: 'my_obj', fields: {} });
             
             const context = { request: {} };
             const result = await dispatcher.handleMetadata('/objects/my_obj', context, 'GET');
             
             expect(result.handled).toBe(true);
             expect(mockObjectQL.registry.getObject).toHaveBeenCalledWith('my_obj');
        });
    });

    describe('handleAutomation', () => {
        let mockAutomationService: any;

        beforeEach(() => {
            mockAutomationService = {
                listFlows: vi.fn().mockResolvedValue(['flow_a', 'flow_b']),
                getFlow: vi.fn().mockResolvedValue({ name: 'flow_a', label: 'Flow A' }),
                registerFlow: vi.fn(),
                unregisterFlow: vi.fn(),
                execute: vi.fn().mockResolvedValue({ success: true, output: {} }),
                toggleFlow: vi.fn().mockResolvedValue(undefined),
                listRuns: vi.fn().mockResolvedValue([{ id: 'run_1', status: 'completed' }]),
                getRun: vi.fn().mockResolvedValue({ id: 'run_1', status: 'completed' }),
                trigger: vi.fn().mockResolvedValue({ success: true }),
                getActionDescriptors: vi.fn().mockReturnValue([
                    { type: 'decision', name: 'Decision', category: 'logic', paradigms: ['flow'], source: 'builtin' },
                    { type: 'http_request', name: 'HTTP Request', category: 'io', paradigms: ['flow', 'workflow_rule'], source: 'builtin' },
                    { type: 'send_sms', name: 'Send SMS', category: 'io', paradigms: ['flow'], source: 'plugin' },
                ]),
                getConnectorDescriptors: vi.fn().mockReturnValue([
                    { name: 'rest', label: 'REST', type: 'api', actions: [{ key: 'request', label: 'Request' }] },
                    { name: 'slack', label: 'Slack', type: 'api', actions: [{ key: 'chat.postMessage', label: 'Post Message' }] },
                    { name: 'pg', label: 'Postgres', type: 'database', actions: [] },
                ]),
            };

            // Set up kernel services to include automation
            (kernel as any).services = new Map([
                ['automation', mockAutomationService],
            ]);
        });

        it('should list flows via GET /', async () => {
            const result = await dispatcher.handleAutomation('', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.flows).toEqual(['flow_a', 'flow_b']);
        });

        it('should get a flow via GET /:name', async () => {
            const result = await dispatcher.handleAutomation('flow_a', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.name).toBe('flow_a');
        });

        it('should return 404 for non-existent flow via GET /:name', async () => {
            mockAutomationService.getFlow.mockResolvedValue(null);
            const result = await dispatcher.handleAutomation('missing', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(404);
        });

        it('should create a flow via POST /', async () => {
            const body = { name: 'new_flow', label: 'New Flow' };
            const result = await dispatcher.handleAutomation('', 'POST', body, { request: {} });
            expect(result.handled).toBe(true);
            expect(mockAutomationService.registerFlow).toHaveBeenCalledWith('new_flow', body);
        });

        it('should update a flow via PUT /:name', async () => {
            const body = { definition: { label: 'Updated' } };
            const result = await dispatcher.handleAutomation('flow_a', 'PUT', body, { request: {} });
            expect(result.handled).toBe(true);
            expect(mockAutomationService.registerFlow).toHaveBeenCalledWith('flow_a', { label: 'Updated' });
        });

        it('should delete a flow via DELETE /:name', async () => {
            const result = await dispatcher.handleAutomation('flow_a', 'DELETE', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(mockAutomationService.unregisterFlow).toHaveBeenCalledWith('flow_a');
            expect(result.response?.body?.data?.deleted).toBe(true);
        });

        it('should trigger a flow via POST /:name/trigger', async () => {
            const result = await dispatcher.handleAutomation('flow_a/trigger', 'POST', { key: 'val' }, { request: {} });
            expect(result.handled).toBe(true);
            expect(mockAutomationService.execute).toHaveBeenCalledWith('flow_a', expect.objectContaining({
                params: expect.objectContaining({ key: 'val' }),
                event: 'manual',
            }));
        });

        it('should toggle a flow via POST /:name/toggle', async () => {
            const result = await dispatcher.handleAutomation('flow_a/toggle', 'POST', { enabled: false }, { request: {} });
            expect(result.handled).toBe(true);
            expect(mockAutomationService.toggleFlow).toHaveBeenCalledWith('flow_a', false);
        });

        it('should list runs via GET /:name/runs', async () => {
            const result = await dispatcher.handleAutomation('flow_a/runs', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.runs).toHaveLength(1);
        });

        it('should get a run via GET /:name/runs/:runId', async () => {
            const result = await dispatcher.handleAutomation('flow_a/runs/run_1', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.id).toBe('run_1');
        });

        it('should return 404 for non-existent run', async () => {
            mockAutomationService.getRun.mockResolvedValue(null);
            const result = await dispatcher.handleAutomation('flow_a/runs/missing', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(404);
        });

        it('should handle legacy trigger path POST /trigger/:name', async () => {
            const result = await dispatcher.handleAutomation('trigger/flow_a', 'POST', { data: 1 }, { request: {} });
            expect(result.handled).toBe(true);
            expect(mockAutomationService.trigger).toHaveBeenCalledWith('flow_a', { data: 1 }, { request: {} });
        });

        // ── GET /actions — action descriptor registry (ADR-0018) ──────────
        it('should list action descriptors via GET /actions', async () => {
            const result = await dispatcher.handleAutomation('actions', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(mockAutomationService.getActionDescriptors).toHaveBeenCalled();
            expect(result.response?.body?.data?.total).toBe(3);
            expect(result.response?.body?.data?.actions.map((a: any) => a.type)).toEqual(
                ['decision', 'http_request', 'send_sms'],
            );
        });

        it('must NOT let GET /actions be shadowed by the /:name flow lookup', async () => {
            const result = await dispatcher.handleAutomation('actions', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            // The actions registry is returned, NOT a getFlow('actions') result.
            expect(mockAutomationService.getFlow).not.toHaveBeenCalled();
            expect(result.response?.body?.data?.actions).toBeDefined();
        });

        it('should filter GET /actions by ?source', async () => {
            const result = await dispatcher.handleAutomation('actions', 'GET', {}, { request: {} }, { source: 'plugin' });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.total).toBe(1);
            expect(result.response?.body?.data?.actions[0].type).toBe('send_sms');
        });

        it('should filter GET /actions by ?paradigm', async () => {
            const result = await dispatcher.handleAutomation('actions', 'GET', {}, { request: {} }, { paradigm: 'workflow_rule' });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.total).toBe(1);
            expect(result.response?.body?.data?.actions[0].type).toBe('http_request');
        });

        it('should return an empty registry when the service lacks getActionDescriptors', async () => {
            delete mockAutomationService.getActionDescriptors;
            const result = await dispatcher.handleAutomation('actions', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.actions).toEqual([]);
            expect(result.response?.body?.data?.total).toBe(0);
        });

        // ── GET /connectors — connector descriptor registry (ADR-0022) ────
        it('should list connector descriptors via GET /connectors', async () => {
            const result = await dispatcher.handleAutomation('connectors', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(mockAutomationService.getConnectorDescriptors).toHaveBeenCalled();
            expect(result.response?.body?.data?.total).toBe(3);
            expect(result.response?.body?.data?.connectors.map((c: any) => c.name)).toEqual(
                ['rest', 'slack', 'pg'],
            );
        });

        it('must NOT let GET /connectors be shadowed by the /:name flow lookup', async () => {
            const result = await dispatcher.handleAutomation('connectors', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            // The connector registry is returned, NOT a getFlow('connectors') result.
            expect(mockAutomationService.getFlow).not.toHaveBeenCalled();
            expect(result.response?.body?.data?.connectors).toBeDefined();
        });

        it('should filter GET /connectors by ?type', async () => {
            const result = await dispatcher.handleAutomation('connectors', 'GET', {}, { request: {} }, { type: 'database' });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.total).toBe(1);
            expect(result.response?.body?.data?.connectors[0].name).toBe('pg');
        });

        it('should return an empty registry when the service lacks getConnectorDescriptors', async () => {
            delete mockAutomationService.getConnectorDescriptors;
            const result = await dispatcher.handleAutomation('connectors', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.connectors).toEqual([]);
            expect(result.response?.body?.data?.total).toBe(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // Async Service Resolution Tests
    // Covers: getService awaits Promise-based (async factory) services
    // ═══════════════════════════════════════════════════════════════

    describe('Async service resolution (Promise-based injection)', () => {

        describe('handleAnalytics with async service', () => {
            it('should resolve analytics service from Promise (async factory)', async () => {
                const mockAnalytics = {
                    query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }], total: 1 }),
                    getMeta: vi.fn().mockResolvedValue({ tables: ['t1'] }),
                    generateSql: vi.fn().mockResolvedValue({ sql: 'SELECT 1' }),
                };
                // Inject as Promise (simulates async factory registration)
                (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                    if (name === 'analytics') return Promise.resolve(mockAnalytics);
                    return null;
                });

                const result = await dispatcher.handleAnalytics('query', 'POST', { sql: 'SELECT 1' }, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(mockAnalytics.query).toHaveBeenCalled();
            });

            it('should handle POST /analytics/sql with async service', async () => {
                const mockAnalytics = {
                    generateSql: vi.fn().mockResolvedValue({ sql: 'SELECT * FROM t' }),
                };
                (kernel as any).getService = vi.fn().mockResolvedValue(mockAnalytics);

                const result = await dispatcher.handleAnalytics('sql', 'POST', { object: 'test' }, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(mockAnalytics.generateSql).toHaveBeenCalled();
            });

            it('should handle GET /analytics/meta with async service', async () => {
                const mockAnalytics = {
                    getMeta: vi.fn().mockResolvedValue({ tables: ['users', 'orders'] }),
                };
                (kernel as any).getService = vi.fn().mockResolvedValue(mockAnalytics);

                const result = await dispatcher.handleAnalytics('meta', 'GET', {}, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(result.response?.body?.data?.tables).toEqual(['users', 'orders']);
            });

            it('should return unhandled when analytics service is not registered', async () => {
                (kernel as any).getService = vi.fn().mockResolvedValue(null);
                (kernel as any).services = new Map();

                const result = await dispatcher.handleAnalytics('query', 'POST', {}, { request: {} });
                expect(result.handled).toBe(false);
            });

            it('should return unhandled for unknown analytics sub-path', async () => {
                const mockAnalytics = { query: vi.fn() };
                (kernel as any).getService = vi.fn().mockResolvedValue(mockAnalytics);

                const result = await dispatcher.handleAnalytics('unknown', 'POST', {}, { request: {} });
                expect(result.handled).toBe(false);
            });
        });

        // ADR-0030: the /api/v1/notifications surface, resolved from the
        // `notification` core service slot (the messaging service) and scoped to
        // the authenticated user from the execution context.
        describe('handleNotification (ADR-0030 inbox surface)', () => {
            const notifKernel = (service: any) =>
                ({ context: { getService: (name: string) => (name === 'notification' ? service : null) } } as any);
            const ctx = (userId?: string) =>
                ({ request: {}, executionContext: userId ? { userId } : undefined } as any);

            it('GET /notifications lists the inbox for the authed user (with read/limit filters)', async () => {
                const service = {
                    listInbox: vi.fn().mockResolvedValue({ notifications: [{ id: 'n1', read: false }], unreadCount: 1 }),
                };
                const d = new HttpDispatcher(notifKernel(service));
                const result = await d.handleNotification('', 'GET', undefined, { read: 'false', limit: '10' }, ctx('u1'));
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(result.response?.body?.data?.unreadCount).toBe(1);
                expect(service.listInbox).toHaveBeenCalledWith('u1', { read: false, type: undefined, limit: 10 });
            });

            it('POST /read marks the posted ids read', async () => {
                const service = {
                    listInbox: vi.fn(),
                    markRead: vi.fn().mockResolvedValue({ success: true, readCount: 2 }),
                };
                const d = new HttpDispatcher(notifKernel(service));
                const result = await d.handleNotification('/read', 'POST', { ids: ['n1', 'n2'] }, {}, ctx('u1'));
                expect(result.handled).toBe(true);
                expect(result.response?.body?.data?.readCount).toBe(2);
                expect(service.markRead).toHaveBeenCalledWith('u1', ['n1', 'n2']);
            });

            it('POST /read/all marks all read for the user', async () => {
                const service = {
                    listInbox: vi.fn(),
                    markAllRead: vi.fn().mockResolvedValue({ success: true, readCount: 5 }),
                };
                const d = new HttpDispatcher(notifKernel(service));
                const result = await d.handleNotification('/read/all', 'POST', undefined, {}, ctx('u1'));
                expect(result.handled).toBe(true);
                expect(result.response?.body?.data?.readCount).toBe(5);
                expect(service.markAllRead).toHaveBeenCalledWith('u1');
            });

            it('returns 401 for an anonymous request and never touches the service', async () => {
                const service = { listInbox: vi.fn() };
                const d = new HttpDispatcher(notifKernel(service));
                const result = await d.handleNotification('', 'GET', undefined, {}, ctx());
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(401);
                expect(service.listInbox).not.toHaveBeenCalled();
            });

            it('is unhandled (→ 404) when no notification service is registered', async () => {
                const d = new HttpDispatcher(notifKernel(null));
                const result = await d.handleNotification('', 'GET', undefined, {}, ctx('u1'));
                expect(result.handled).toBe(false);
            });
        });

        describe('handleAuth with async service', () => {
            it('should resolve auth service from Promise', async () => {
                const mockAuth = {
                    handler: vi.fn().mockResolvedValue({ user: { id: '1' } }),
                };
                (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                    if (name === 'auth') return Promise.resolve(mockAuth);
                    return null;
                });

                const result = await dispatcher.handleAuth('', 'POST', {}, { request: {}, response: {} });
                expect(result.handled).toBe(true);
                expect(mockAuth.handler).toHaveBeenCalled();
            });

            it('should fallback to mock auth when async auth service has no handler', async () => {
                (kernel as any).getService = vi.fn().mockResolvedValue({});

                const result = await dispatcher.handleAuth('/login', 'POST', { email: 'test@example.com' }, { request: {} });
                expect(result.handled).toBe(true);
                // Falls through to mock auth fallback (sign-in behavior)
                expect(result.response?.status).toBe(200);
                expect(result.response?.body?.user).toBeDefined();
            });

            it('should return unhandled when auth service not registered and no legacy match', async () => {
                (kernel as any).getService = vi.fn().mockResolvedValue(null);
                (kernel as any).services = new Map();

                const result = await dispatcher.handleAuth('/profile', 'GET', {}, { request: {} });
                expect(result.handled).toBe(false);
            });
        });

        describe('handleAuth mock fallback (MSW/test mode)', () => {
            beforeEach(() => {
                // No auth service — simulates MSW/mock mode
                (kernel as any).getService = vi.fn().mockResolvedValue(null);
                (kernel as any).services = new Map();
            });

            it('should mock sign-up/email endpoint', async () => {
                const result = await dispatcher.handleAuth('/sign-up/email', 'POST', { email: 'test@example.com', name: 'Test' }, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(result.response?.body.user).toBeDefined();
                expect(result.response?.body.user.email).toBe('test@example.com');
                expect(result.response?.body.session).toBeDefined();
            });

            it('should mock sign-in/email endpoint', async () => {
                const result = await dispatcher.handleAuth('/sign-in/email', 'POST', { email: 'test@example.com' }, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(result.response?.body.user).toBeDefined();
                expect(result.response?.body.session).toBeDefined();
            });

            it('should mock get-session endpoint', async () => {
                const result = await dispatcher.handleAuth('/get-session', 'GET', {}, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(result.response?.body).toEqual({ session: null, user: null });
            });

            it('should mock sign-out endpoint', async () => {
                const result = await dispatcher.handleAuth('/sign-out', 'POST', {}, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(result.response?.body).toEqual({ success: true });
            });

            it('should mock login fallback when no auth service registered', async () => {
                const result = await dispatcher.handleAuth('/login', 'POST', { email: 'test@example.com' }, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(result.response?.body.user).toBeDefined();
                expect(result.response?.body.session).toBeDefined();
            });

            it('should return unhandled for unknown auth path in mock mode', async () => {
                const result = await dispatcher.handleAuth('/unknown', 'GET', {}, { request: {} });
                expect(result.handled).toBe(false);
            });
        });

        describe('handleStorage with async service', () => {
            it('should resolve storage service from Promise', async () => {
                const mockStorage = {
                    upload: vi.fn().mockResolvedValue({ id: 'file_1', url: '/files/1' }),
                };
                (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                    if (name === 'file-storage') return Promise.resolve(mockStorage);
                    return null;
                });

                const result = await dispatcher.handleStorage('/upload', 'POST', { name: 'test.txt' }, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(mockStorage.upload).toHaveBeenCalled();
            });

            it('should return 501 when storage service is not registered (async null)', async () => {
                (kernel as any).getService = vi.fn().mockResolvedValue(null);
                (kernel as any).services = new Map();

                const result = await dispatcher.handleStorage('/upload', 'POST', {}, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(501);
                expect(result.response?.body?.error?.message).toBe('File storage not configured');
            });

            it('should handle GET /storage/file/:id with async service', async () => {
                const mockStorage = {
                    download: vi.fn().mockResolvedValue({ data: 'content', mimeType: 'text/plain' }),
                };
                (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                    if (name === 'file-storage') return Promise.resolve(mockStorage);
                    return null;
                });

                const result = await dispatcher.handleStorage('/file/abc123', 'GET', null, { request: {} });
                expect(result.handled).toBe(true);
                expect(mockStorage.download).toHaveBeenCalledWith('abc123', { request: {} });
            });

            it('should return 400 when upload has no file', async () => {
                const mockStorage = { upload: vi.fn() };
                (kernel as any).getService = vi.fn().mockResolvedValue(mockStorage);

                const result = await dispatcher.handleStorage('/upload', 'POST', null, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(400);
                expect(result.response?.body?.error?.message).toBe('No file provided');
            });
        });

        describe('handleAutomation with async service', () => {
            it('should resolve automation service from Promise (async factory)', async () => {
                const mockAuto = {
                    listFlows: vi.fn().mockResolvedValue(['f1']),
                };
                (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                    if (name === 'automation') return Promise.resolve(mockAuto);
                    return null;
                });

                const result = await dispatcher.handleAutomation('', 'GET', {}, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.body?.data?.flows).toEqual(['f1']);
            });

            it('should return unhandled when automation service not registered', async () => {
                (kernel as any).getService = vi.fn().mockResolvedValue(null);
                (kernel as any).services = new Map();

                const result = await dispatcher.handleAutomation('', 'GET', {}, { request: {} });
                expect(result.handled).toBe(false);
            });
        });

        describe('handleMetadata with async protocol service', () => {
            it('should resolve protocol service from async getService', async () => {
                const asyncProtocol = {
                    saveMetaItem: vi.fn().mockResolvedValue({ success: true }),
                };
                (kernel as any).context.getService = vi.fn().mockImplementation((name: string) => {
                    if (name === 'protocol') return Promise.resolve(asyncProtocol);
                    return null;
                });

                const result = await dispatcher.handleMetadata('/objects/my_obj', { request: {} }, 'PUT', { label: 'Test' });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(asyncProtocol.saveMetaItem).toHaveBeenCalled();
            });

            it('should fallback to ObjectQL registry when async protocol returns null', async () => {
                (kernel as any).context.getService = vi.fn().mockImplementation((name: string) => {
                    if (name === 'objectql') return mockObjectQL;
                    return null;
                });
                mockObjectQL.registry.getObject.mockReturnValue({ name: 'my_obj', fields: {} });

                const result = await dispatcher.handleMetadata('/objects/my_obj', { request: {} }, 'GET');
                expect(result.handled).toBe(true);
                expect(mockObjectQL.registry.getObject).toHaveBeenCalledWith('my_obj');
            });
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // Synchronous service resolution (backward compatibility)
    // ═══════════════════════════════════════════════════════════════

    describe('Synchronous service resolution (backward compat)', () => {
        it('should work with synchronous service from services Map', async () => {
            const syncAnalytics = {
                query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
            };
            (kernel as any).services = new Map([['analytics', syncAnalytics]]);

            const result = await dispatcher.handleAnalytics('query', 'POST', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(syncAnalytics.query).toHaveBeenCalled();
        });

        it('should work with synchronous getService returning service directly', async () => {
            const syncAuto = {
                listFlows: vi.fn().mockResolvedValue(['flow_x']),
            };
            (kernel as any).getService = vi.fn().mockReturnValue(syncAuto);

            const result = await dispatcher.handleAutomation('', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.flows).toEqual(['flow_x']);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // getServiceAsync preferred path
    // ═══════════════════════════════════════════════════════════════

    describe('getServiceAsync preferred path', () => {
        it('should prefer getServiceAsync over getService for analytics', async () => {
            const asyncAnalytics = {
                query: vi.fn().mockResolvedValue({ rows: [1], total: 1 }),
            };
            (kernel as any).getServiceAsync = vi.fn().mockResolvedValue(asyncAnalytics);
            (kernel as any).getService = vi.fn().mockImplementation(() => {
                throw new Error("Service 'analytics' is async - use await");
            });

            const result = await dispatcher.handleAnalytics('query', 'POST', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(asyncAnalytics.query).toHaveBeenCalled();
            expect((kernel as any).getServiceAsync).toHaveBeenCalledWith('analytics');
        });

        it('should prefer getServiceAsync over getService for auth', async () => {
            const asyncAuth = {
                handler: vi.fn().mockResolvedValue({ user: { id: '1' } }),
            };
            (kernel as any).getServiceAsync = vi.fn().mockResolvedValue(asyncAuth);
            (kernel as any).getService = vi.fn().mockImplementation(() => {
                throw new Error("Service 'auth' is async - use await");
            });

            const result = await dispatcher.handleAuth('', 'POST', {}, { request: {}, response: {} });
            expect(result.handled).toBe(true);
            expect(asyncAuth.handler).toHaveBeenCalled();
            expect((kernel as any).getServiceAsync).toHaveBeenCalledWith('auth');
        });

        it('should prefer getServiceAsync over getService for automation', async () => {
            const asyncAuto = {
                listFlows: vi.fn().mockResolvedValue(['flow_async']),
            };
            (kernel as any).getServiceAsync = vi.fn().mockResolvedValue(asyncAuto);

            const result = await dispatcher.handleAutomation('', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.flows).toEqual(['flow_async']);
            expect((kernel as any).getServiceAsync).toHaveBeenCalledWith('automation');
        });

        it('should prefer getServiceAsync over getService for file-storage', async () => {
            const asyncStorage = {
                upload: vi.fn().mockResolvedValue({ id: 'file_1', url: '/files/1' }),
            };
            (kernel as any).getServiceAsync = vi.fn().mockResolvedValue(asyncStorage);

            const result = await dispatcher.handleStorage('/upload', 'POST', { name: 'test.txt' }, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect((kernel as any).getServiceAsync).toHaveBeenCalledWith('file-storage');
        });

        it('should resolve protocol service via getServiceAsync for handleMetadata', async () => {
            const asyncProtocol = {
                saveMetaItem: vi.fn().mockResolvedValue({ success: true }),
            };
            (kernel as any).getServiceAsync = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve(asyncProtocol);
                return Promise.resolve(null);
            });
            // Remove context.getService to ensure getServiceAsync is used
            (kernel as any).context = {};

            const result = await dispatcher.handleMetadata('/objects/my_obj', { request: {} }, 'PUT', { label: 'Test' });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(asyncProtocol.saveMetaItem).toHaveBeenCalled();
            expect((kernel as any).getServiceAsync).toHaveBeenCalledWith('protocol');
        });

        it('should fall through when getServiceAsync returns null', async () => {
            (kernel as any).getServiceAsync = vi.fn().mockResolvedValue(null);
            const syncAnalytics = {
                query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
            };
            (kernel as any).services = new Map([['analytics', syncAnalytics]]);

            const result = await dispatcher.handleAnalytics('query', 'POST', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(syncAnalytics.query).toHaveBeenCalled();
        });

        it('should fall through when getServiceAsync throws', async () => {
            (kernel as any).getServiceAsync = vi.fn().mockRejectedValue(new Error('not found'));
            const syncAnalytics = {
                query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
            };
            (kernel as any).services = new Map([['analytics', syncAnalytics]]);

            const result = await dispatcher.handleAnalytics('query', 'POST', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(syncAnalytics.query).toHaveBeenCalled();
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // handleData — expand/populate parameter flow
    // ═══════════════════════════════════════════════════════════════

    describe('handleData', () => {
        it('should pass expand and select to protocol for GET /data/:object/:id', async () => {
            mockProtocol.getData.mockResolvedValue({ object: 'order_item', id: 'oi_1', record: { id: 'oi_1' } });

            const result = await dispatcher.handleData(
                '/order_item/oi_1', 'GET', {},
                { expand: 'order,product', select: 'name,total' },
                { request: {} }
            );

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(mockProtocol.getData).toHaveBeenCalledWith(
                { object: 'order_item', id: 'oi_1', expand: 'order,product', select: 'name,total' }
            );
        });

        it('should NOT pass non-allowlisted params for GET /data/:object/:id', async () => {
            mockProtocol.getData.mockResolvedValue({ object: 'task', id: 't1', record: {} });

            await dispatcher.handleData(
                '/task/t1', 'GET', {},
                { expand: 'assignee', malicious: 'drop_table', filter: 'hack' },
                { request: {} }
            );

            // Only expand is passed; malicious and filter are dropped
            expect(mockProtocol.getData).toHaveBeenCalledWith(
                { object: 'task', id: 't1', expand: 'assignee' }
            );
        });

        it('should pass full query (with expand/populate) for GET /data/:object list', async () => {
            mockProtocol.findData.mockResolvedValue({ object: 'task', records: [], total: 0 });

            const query = { populate: 'assignee,project', top: '10', skip: '0' };
            const result = await dispatcher.handleData(
                '/task', 'GET', {},
                query,
                { request: {} }
            );

            expect(result.handled).toBe(true);
            // top → limit and skip → offset are normalized by the dispatcher
            expect(mockProtocol.findData).toHaveBeenCalledWith(
                { object: 'task', query: { populate: 'assignee,project', limit: '10', offset: '0' } }
            );
        });

        it('should pass expand in query for GET /data/:object list', async () => {
            mockProtocol.findData.mockResolvedValue({ object: 'order', records: [], total: 0 });

            const query = { expand: 'customer,products' };
            await dispatcher.handleData('/order', 'GET', {}, query, { request: {} });

            expect(mockProtocol.findData).toHaveBeenCalledWith(
                { object: 'order', query: { expand: 'customer,products' } }
            );
        });

        it('should return error if object name is missing', async () => {
            const result = await dispatcher.handleData('/', 'GET', {}, {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(400);
        });

        it('should handle POST /data/:object/query with body containing expand', async () => {
            mockProtocol.findData.mockResolvedValue({ object: 'task', records: [] });

            await dispatcher.handleData(
                '/task/query', 'POST',
                { filter: { status: 'active' }, populate: ['assignee'] },
                {},
                { request: {} }
            );

            expect(mockProtocol.findData).toHaveBeenCalledWith(
                { object: 'task', query: { filter: { status: 'active' }, populate: ['assignee'] } }
            );
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // Error handling for service method failures
    // ═══════════════════════════════════════════════════════════════

    describe('Service method error handling', () => {
        it('should propagate analytics query error', async () => {
            const badAnalytics = {
                query: vi.fn().mockRejectedValue(new Error('Query timeout')),
            };
            (kernel as any).getService = vi.fn().mockResolvedValue(badAnalytics);

            await expect(
                dispatcher.handleAnalytics('query', 'POST', {}, { request: {} })
            ).rejects.toThrow('Query timeout');
        });

        it('should propagate storage upload error', async () => {
            const badStorage = {
                upload: vi.fn().mockRejectedValue(new Error('Disk full')),
            };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'file-storage') return Promise.resolve(badStorage);
                return null;
            });

            await expect(
                dispatcher.handleStorage('/upload', 'POST', { data: 'file' }, { request: {} })
            ).rejects.toThrow('Disk full');
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // Package Publish / Revert Endpoints
    // ═══════════════════════════════════════════════════════════════

    describe('Package publish/revert endpoints', () => {
        it('should handle POST /packages/:id/publish via metadata service', async () => {
            const mockMetadata = {
                publishPackage: vi.fn().mockResolvedValue({
                    success: true,
                    packageId: 'com.acme.crm',
                    version: 2,
                    publishedAt: '2025-06-01T00:00:00Z',
                    itemsPublished: 3,
                }),
            };
            const mockRegistry = {
                getAllPackages: vi.fn().mockReturnValue([]),
                enablePackage: vi.fn(),
                disablePackage: vi.fn(),
            };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'metadata') return Promise.resolve(mockMetadata);
                if (name === 'objectql') return Promise.resolve({ registry: mockRegistry });
                return null;
            });

            const result = await dispatcher.handlePackages('/com.acme.crm/publish', 'POST', { publishedBy: 'admin' }, {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(mockMetadata.publishPackage).toHaveBeenCalledWith('com.acme.crm', { publishedBy: 'admin' });
        });

        it('should handle POST /packages/:id/revert via metadata service', async () => {
            const mockMetadata = {
                revertPackage: vi.fn().mockResolvedValue(undefined),
            };
            const mockRegistry = {
                getAllPackages: vi.fn().mockReturnValue([]),
                enablePackage: vi.fn(),
                disablePackage: vi.fn(),
            };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'metadata') return Promise.resolve(mockMetadata);
                if (name === 'objectql') return Promise.resolve({ registry: mockRegistry });
                return null;
            });

            const result = await dispatcher.handlePackages('/com.acme.crm/revert', 'POST', {}, {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(mockMetadata.revertPackage).toHaveBeenCalledWith('com.acme.crm');
        });

        it('should return 503 for publish when metadata service unavailable', async () => {
            const mockRegistry = {
                getAllPackages: vi.fn().mockReturnValue([]),
            };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'metadata') return Promise.resolve(null);
                if (name === 'objectql') return Promise.resolve({ registry: mockRegistry });
                return null;
            });

            const result = await dispatcher.handlePackages('/crm/publish', 'POST', {}, {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(503);
        });

        it('POST /packages/:id/publish-drafts routes to protocol.publishPackageDrafts', async () => {
            const publishPackageDrafts = vi.fn().mockResolvedValue({
                success: true, publishedCount: 3, failedCount: 0, published: [], failed: [],
            });
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ publishPackageDrafts });
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });

            const result = await dispatcher.handlePackages('/app.edu/publish-drafts', 'POST', {}, {}, { request: {} });

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(publishPackageDrafts).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'app.edu' }));
            expect((result.response as any)?.body?.data?.publishedCount).toBe(3);
        });

        it('POST /packages/:id/publish-drafts returns 501 when protocol lacks the method', async () => {
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({});
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });

            const result = await dispatcher.handlePackages('/app.edu/publish-drafts', 'POST', {}, {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(501);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // Package install — POST /packages routes through protocol.installPackage
    // (ADR-0033 consolidation: registry + sys_packages in one primitive)
    // ═══════════════════════════════════════════════════════════════

    describe('POST /packages install', () => {
        it('routes through protocol.installPackage and returns the unwrapped package', async () => {
            const installPackage = vi.fn().mockResolvedValue({
                package: { manifest: { id: 'app.demo' }, status: 'installed' },
                message: 'Installed package: app.demo',
            });
            const mockRegistry = { installPackage: vi.fn(), getAllPackages: vi.fn().mockReturnValue([]) };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ installPackage });
                if (name === 'objectql') return Promise.resolve({ registry: mockRegistry });
                return null;
            });

            const manifest = { id: 'app.demo', name: 'Demo', version: '1.0.0', type: 'application' };
            const result = await dispatcher.handlePackages('', 'POST', { manifest, settings: { a: 1 } }, {}, { request: {} });

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(201);
            expect(installPackage).toHaveBeenCalledWith({ manifest, settings: { a: 1 } });
            expect(mockRegistry.installPackage).not.toHaveBeenCalled(); // primitive owns the write
            expect((result.response as any)?.body?.data?.manifest?.id).toBe('app.demo');
        });

        it('falls back to registry.installPackage when the protocol lacks the method', async () => {
            const mockRegistry = {
                installPackage: vi.fn().mockReturnValue({ manifest: { id: 'app.fb' }, status: 'installed' }),
                getAllPackages: vi.fn().mockReturnValue([]),
            };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({}); // no installPackage
                if (name === 'objectql') return Promise.resolve({ registry: mockRegistry });
                return null;
            });

            const manifest = { id: 'app.fb', name: 'FB', version: '1.0.0', type: 'application' };
            const result = await dispatcher.handlePackages('', 'POST', { manifest }, {}, { request: {} });

            expect(result.response?.status).toBe(201);
            expect(mockRegistry.installPackage).toHaveBeenCalledWith(manifest, undefined);
            expect((result.response as any)?.body?.data?.manifest?.id).toBe('app.fb');
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // GET /metadata/_drafts — ADR-0033 pending-changes list
    // ═══════════════════════════════════════════════════════════════

    describe('GET /metadata/_drafts', () => {
        it('routes to protocol.listDrafts with packageId + type and returns drafts', async () => {
            const listDrafts = vi.fn().mockResolvedValue({
                drafts: [{ type: 'object', name: 'course', packageId: 'app.edu', updatedAt: 't1', updatedBy: 'ai' }],
            });
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ listDrafts });
                return null;
            });

            const result = await dispatcher.handleMetadata('_drafts', { request: {} }, 'GET', undefined, {
                packageId: 'app.edu',
                type: 'object',
            });

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(listDrafts).toHaveBeenCalledWith(
                expect.objectContaining({ packageId: 'app.edu', type: 'object' }),
            );
            expect((result.response as any)?.body?.data?.drafts?.[0]?.name).toBe('course');
        });

        it('returns 501 when the protocol does not implement listDrafts', async () => {
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({});
                return null;
            });

            const result = await dispatcher.handleMetadata('_drafts', { request: {} }, 'GET', undefined, {});
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(501);
        });

        it('is not mistaken for a metadata type (does not hit getMetaItems)', async () => {
            const getMetaItems = vi.fn().mockResolvedValue({ items: [] });
            const listDrafts = vi.fn().mockResolvedValue({ drafts: [] });
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ getMetaItems, listDrafts });
                return null;
            });

            await dispatcher.handleMetadata('_drafts', { request: {} }, 'GET', undefined, {});
            expect(listDrafts).toHaveBeenCalledTimes(1);
            expect(getMetaItems).not.toHaveBeenCalled();
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // Metadata getPublished Endpoint
    // ═══════════════════════════════════════════════════════════════

    describe('Metadata getPublished endpoint', () => {
        it('should handle GET /metadata/:type/:name/published via metadata service', async () => {
            const mockMetadata = {
                getPublished: vi.fn().mockResolvedValue({ name: 'account', label: 'Account' }),
            };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'metadata') return Promise.resolve(mockMetadata);
                return null;
            });

            const result = await dispatcher.handleMetadata('/object/account/published', { request: {} }, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data).toEqual({ name: 'account', label: 'Account' });
            expect(mockMetadata.getPublished).toHaveBeenCalledWith('object', 'account');
        });

        it('should return 404 when published item not found', async () => {
            const mockMetadata = {
                getPublished: vi.fn().mockResolvedValue(undefined),
            };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'metadata') return Promise.resolve(mockMetadata);
                return null;
            });

            const result = await dispatcher.handleMetadata('/object/nonexistent/published', { request: {} }, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(404);
        });

        it('should fallback to resolveService for getPublished when metadata service unavailable', async () => {
            const metaSvc = {
                getPublished: vi.fn().mockResolvedValue({ name: 'account', fields: ['name'] }),
            };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'metadata') return Promise.resolve(metaSvc);
                if (name === 'objectql') return Promise.resolve(mockObjectQL);
                return null;
            });
            (kernel as any).context = {
                getService: (name: string) => {
                    if (name === 'metadata') return metaSvc;
                    if (name === 'objectql') return mockObjectQL;
                    return null;
                }
            };

            const result = await dispatcher.handleMetadata('/object/account/published', { request: {} }, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(metaSvc.getPublished).toHaveBeenCalledWith('object', 'account');
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // handleI18n — i18n route dispatching
    // ═══════════════════════════════════════════════════════════════

    describe('handleI18n', () => {
        let mockI18nService: any;

        beforeEach(() => {
            mockI18nService = {
                getLocales: vi.fn().mockReturnValue(['en', 'zh-CN', 'ja']),
                getTranslations: vi.fn().mockReturnValue({ 'o.account.label': '客户', 'o.account.fields.name': '名称' }),
                getFieldLabels: vi.fn().mockReturnValue({ name: '名称', industry: '行业' }),
            };

            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'i18n') return mockI18nService;
                return null;
            });
        });

        it('should list locales via GET /locales', async () => {
            const result = await dispatcher.handleI18n('/locales', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.locales).toEqual(['en', 'zh-CN', 'ja']);
            expect(mockI18nService.getLocales).toHaveBeenCalled();
        });

        it('should get translations via GET /translations/:locale', async () => {
            const result = await dispatcher.handleI18n('/translations/zh-CN', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.locale).toBe('zh-CN');
            expect(result.response?.body?.data?.translations).toEqual({ 'o.account.label': '客户', 'o.account.fields.name': '名称' });
            expect(mockI18nService.getTranslations).toHaveBeenCalledWith('zh-CN');
        });

        it('should get translations via GET /translations?locale=zh-CN (query param)', async () => {
            const result = await dispatcher.handleI18n('/translations', 'GET', { locale: 'zh-CN' }, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.locale).toBe('zh-CN');
            expect(mockI18nService.getTranslations).toHaveBeenCalledWith('zh-CN');
        });

        it('should return 400 when translations requested without locale', async () => {
            const result = await dispatcher.handleI18n('/translations', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(400);
            expect(result.response?.body?.error?.message).toBe('Missing locale parameter');
        });

        it('should get field labels via GET /labels/:object/:locale', async () => {
            const result = await dispatcher.handleI18n('/labels/account/zh-CN', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.object).toBe('account');
            expect(result.response?.body?.data?.locale).toBe('zh-CN');
            expect(result.response?.body?.data?.labels).toEqual({ name: '名称', industry: '行业' });
            expect(mockI18nService.getFieldLabels).toHaveBeenCalledWith('account', 'zh-CN');
        });

        it('should get field labels via GET /labels/:object?locale=zh-CN (query param)', async () => {
            const result = await dispatcher.handleI18n('/labels/account', 'GET', { locale: 'zh-CN' }, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.object).toBe('account');
            expect(mockI18nService.getFieldLabels).toHaveBeenCalledWith('account', 'zh-CN');
        });

        it('should return 400 when labels requested without locale', async () => {
            const result = await dispatcher.handleI18n('/labels/account', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(400);
            expect(result.response?.body?.error?.message).toBe('Missing locale parameter');
        });

        it('should fallback to deriving labels from translations when getFieldLabels is missing', async () => {
            delete mockI18nService.getFieldLabels;
            mockI18nService.getTranslations.mockReturnValue({
                'o.contact.fields.first_name': 'First Name',
                'o.contact.fields.email': 'Email',
                'o.contact.label': 'Contact',
            });

            const result = await dispatcher.handleI18n('/labels/contact/en', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.labels).toEqual({
                first_name: 'First Name',
                email: 'Email',
            });
        });

        it('should return 501 when i18n service is not available', async () => {
            (kernel as any).getService = vi.fn().mockResolvedValue(null);
            (kernel as any).services = new Map();

            const result = await dispatcher.handleI18n('/locales', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(501);
        });

        it('should return unhandled for non-GET methods', async () => {
            const result = await dispatcher.handleI18n('/locales', 'POST', {}, { request: {} });
            expect(result.handled).toBe(false);
        });

        it('should dispatch /i18n routes via dispatch()', async () => {
            const result = await dispatcher.dispatch('GET', '/i18n/locales', undefined, {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.locales).toEqual(['en', 'zh-CN', 'ja']);
        });

        it('should resolve locale via fallback (zh → zh-CN) for translations', async () => {
            // Override mock to be locale-aware: only 'zh-CN' has data, 'zh' returns empty
            mockI18nService.getTranslations = vi.fn().mockImplementation((locale: string) => {
                if (locale === 'zh-CN') return { 'o.task.label': '任务' };
                return {};
            });

            const result = await dispatcher.handleI18n('/translations/zh', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            const data = result.response?.body?.data;
            expect(data.locale).toBe('zh-CN');
            expect(data.requestedLocale).toBe('zh');
            expect(data.translations).toEqual({ 'o.task.label': '任务' });
        });

        it('should resolve locale via case-insensitive fallback (ZH-CN → zh-CN) for translations', async () => {
            // Override mock to be locale-aware: 'ZH-CN' returns empty, 'zh-CN' has data
            mockI18nService.getTranslations = vi.fn().mockImplementation((locale: string) => {
                if (locale === 'zh-CN') return { 'o.task.label': '任务' };
                return {};
            });

            const result = await dispatcher.handleI18n('/translations/ZH-CN', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            const data = result.response?.body?.data;
            expect(data.locale).toBe('zh-CN');
            expect(data.translations).toEqual({ 'o.task.label': '任务' });
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // Discovery ↔ Handler i18n consistency
    // ═══════════════════════════════════════════════════════════════

    describe('discovery-handler i18n consistency', () => {
        it('should report i18n as available in discovery when service is registered', async () => {
            const mockI18nService = {
                getLocales: vi.fn().mockReturnValue(['en', 'zh-CN', 'ja']),
                getTranslations: vi.fn().mockReturnValue({}),
                getDefaultLocale: vi.fn().mockReturnValue('en'),
            };

            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'i18n') return mockI18nService;
                return null;
            });

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.services.i18n.enabled).toBe(true);
            expect(info.services.i18n.status).toBe('available');
            expect(info.routes.i18n).toBe('/api/v1/i18n');
            expect(info.features.i18n).toBe(true);
        });

        it('should report i18n as unavailable in discovery when service is not registered', async () => {
            (kernel as any).getService = vi.fn().mockResolvedValue(null);
            (kernel as any).services = new Map();

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.services.i18n.enabled).toBe(false);
            expect(info.services.i18n.status).toBe('unavailable');
            expect(info.routes.i18n).toBeUndefined();
            expect(info.features.i18n).toBe(false);
        });

        it('should detect i18n via getServiceAsync (async factory) in discovery', async () => {
            const mockI18nService = {
                getLocales: vi.fn().mockReturnValue(['en', 'fr']),
                getTranslations: vi.fn().mockReturnValue({}),
                getDefaultLocale: vi.fn().mockReturnValue('fr'),
            };

            // Service NOT in sync map, only accessible via async factory
            (kernel as any).services = new Map();
            (kernel as any).getServiceAsync = vi.fn().mockImplementation(async (name: string) => {
                if (name === 'i18n') return mockI18nService;
                return null;
            });

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.services.i18n.enabled).toBe(true);
            expect(info.services.i18n.status).toBe('available');

            // Handler should also find it
            const result = await dispatcher.handleI18n('/locales', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.locales).toEqual(['en', 'fr']);
        });

        it('should populate locale from actual i18n service', async () => {
            const mockI18nService = {
                getLocales: vi.fn().mockReturnValue(['en', 'zh-CN', 'ja']),
                getTranslations: vi.fn().mockReturnValue({}),
                getDefaultLocale: vi.fn().mockReturnValue('zh-CN'),
            };

            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'i18n') return mockI18nService;
                return null;
            });

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.locale.default).toBe('zh-CN');
            expect(info.locale.supported).toEqual(['en', 'zh-CN', 'ja']);
        });

        it('should use default locale when i18n service is not available', async () => {
            (kernel as any).getService = vi.fn().mockResolvedValue(null);
            (kernel as any).services = new Map();

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.locale.default).toBe('en');
            expect(info.locale.supported).toEqual(['en']);
            expect(info.locale.timezone).toBe('UTC');
        });

        it('should ensure discovery and dispatch are consistent for root path', async () => {
            const mockI18nService = {
                getLocales: vi.fn().mockReturnValue(['en']),
                getTranslations: vi.fn().mockReturnValue({}),
                getDefaultLocale: vi.fn().mockReturnValue('en'),
            };

            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'i18n') return mockI18nService;
                return null;
            });

            // Dispatch to root should return the same discovery data
            const result = await dispatcher.dispatch('GET', '', undefined, {}, { request: {} });
            expect(result.handled).toBe(true);
            const data = result.response?.body?.data;
            expect(data.services.i18n.enabled).toBe(true);
            expect(data.locale.default).toBe('en');
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // i18n across server/dev/mock environments
    // ═══════════════════════════════════════════════════════════════

    describe('i18n environment consistency', () => {
        it('should work with dev stub i18n service (in-memory translations)', async () => {
            // Simulate dev plugin i18n stub — Map-backed, all sync
            const translations = new Map<string, Record<string, unknown>>();
            let defaultLocale = 'en';
            const devI18nStub = {
                t: (key: string, locale: string) => {
                    const t = translations.get(locale);
                    return (t?.[key] as string) ?? key;
                },
                getTranslations: (locale: string) => translations.get(locale) ?? {},
                loadTranslations: (locale: string, data: Record<string, unknown>) => {
                    translations.set(locale, { ...translations.get(locale), ...data });
                },
                getLocales: () => [...translations.keys()],
                getDefaultLocale: () => defaultLocale,
                setDefaultLocale: (locale: string) => { defaultLocale = locale; },
            };

            // Load data like AppPlugin would
            devI18nStub.loadTranslations('en', { 'o.task.label': 'Task' });
            devI18nStub.loadTranslations('zh-CN', { 'o.task.label': '任务' });

            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'i18n') return devI18nStub;
                return null;
            });

            // Discovery should reflect loaded locales
            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.services.i18n.enabled).toBe(true);
            expect(info.locale.supported).toEqual(['en', 'zh-CN']);

            // Handler should serve translations
            const result = await dispatcher.handleI18n('/translations/zh-CN', 'GET', {}, { request: {} });
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.translations['o.task.label']).toBe('任务');
        });

        it('should handle MSW catch-all dispatch pattern for i18n', async () => {
            // MSW routes all requests through dispatcher.dispatch()
            const mockI18nService = {
                getLocales: vi.fn().mockReturnValue(['en', 'de']),
                getTranslations: vi.fn().mockReturnValue({ 'o.account.label': 'Konto' }),
                getDefaultLocale: vi.fn().mockReturnValue('de'),
            };

            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'i18n') return mockI18nService;
                return null;
            });

            // MSW-style dispatch: full path stripped to relative
            const localesResult = await dispatcher.dispatch('GET', '/i18n/locales', undefined, {}, { request: {} });
            expect(localesResult.handled).toBe(true);
            expect(localesResult.response?.body?.data?.locales).toEqual(['en', 'de']);

            const translationsResult = await dispatcher.dispatch('GET', '/i18n/translations/de', undefined, {}, { request: {} });
            expect(translationsResult.handled).toBe(true);
            expect(translationsResult.response?.body?.data?.translations['o.account.label']).toBe('Konto');

            // Discovery and handler agree
            const discovery = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(discovery.services.i18n.enabled).toBe(true);
            expect(discovery.locale.default).toBe('de');
        });

        it('should return 501 consistently when i18n is unavailable in both discovery and handler', async () => {
            (kernel as any).getService = vi.fn().mockResolvedValue(null);
            (kernel as any).services = new Map();

            // Discovery: unavailable
            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.services.i18n.enabled).toBe(false);
            expect(info.services.i18n.status).toBe('unavailable');

            // Handler: 501
            const result = await dispatcher.handleI18n('/locales', 'GET', {}, { request: {} });
            expect(result.response?.status).toBe(501);

            // Dispatch: also 501
            const dispatchResult = await dispatcher.dispatch('GET', '/i18n/locales', undefined, {}, { request: {} });
            expect(dispatchResult.response?.status).toBe(501);
        });

        it('should handle context-based service resolution (mock kernel)', async () => {
            // Simulate a kernel that only provides i18n through context.getService
            const mockI18n = {
                getLocales: vi.fn().mockReturnValue(['en']),
                getTranslations: vi.fn().mockReturnValue({}),
                getDefaultLocale: vi.fn().mockReturnValue('en'),
            };

            (kernel as any).services = new Map();
            (kernel as any).getService = undefined;
            (kernel as any).getServiceAsync = undefined;
            (kernel as any).context = {
                getService: vi.fn().mockImplementation((name: string) => {
                    if (name === 'i18n') return mockI18n;
                    return null;
                }),
            };

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.services.i18n.enabled).toBe(true);

            const result = await dispatcher.handleI18n('/locales', 'GET', {}, { request: {} });
            expect(result.response?.status).toBe(200);
        });
    });

    describe('handleMetadata with minimal kernel (serverless/lightweight)', () => {
        let minimalKernel: any;
        let minimalDispatcher: HttpDispatcher;

        beforeEach(() => {
            // Minimal kernel — simulates a lightweight/serverless setup
            // where only the protocol service and/or ObjectQL registry are available.
            minimalKernel = {
                context: {
                    getService: vi.fn().mockReturnValue(null),
                },
            };
            minimalDispatcher = new HttpDispatcher(minimalKernel);
        });

        it('GET /meta should return default types with minimal kernel', async () => {
            const context = { request: {} };
            const result = await minimalDispatcher.handleMetadata('', context, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.types).toContain('object');
        });

        it('GET /meta/types should return default types with minimal kernel', async () => {
            const context = { request: {} };
            const result = await minimalDispatcher.handleMetadata('/types', context, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.types).toContain('object');
        });

        it('GET /meta/objects should use ObjectQL registry', async () => {
            const mockRegistry = {
                getAllObjects: vi.fn().mockReturnValue([{ name: 'account' }]),
                getObject: vi.fn(),
            };
            minimalKernel.context.getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'objectql') return { registry: mockRegistry };
                return null;
            });

            const context = { request: {} };
            const result = await minimalDispatcher.handleMetadata('/objects', context, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(mockRegistry.getAllObjects).toHaveBeenCalled();
        });

        it('GET /meta/objects/:name should use ObjectQL registry', async () => {
            const mockRegistry = {
                registry: {
                    getObject: vi.fn().mockReturnValue({ name: 'account', fields: {} }),
                },
            };
            minimalKernel.context.getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'objectql') return mockRegistry;
                return null;
            });

            const context = { request: {} };
            const result = await minimalDispatcher.handleMetadata('/objects/account', context, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(mockRegistry.registry.getObject).toHaveBeenCalledWith('account');
        });

        it('GET /meta/:type/:name/published should return 404 when metadata service is unavailable', async () => {
            const context = { request: {} };
            const result = await minimalDispatcher.handleMetadata('/object/my_obj/published', context, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(404);
        });

        it('PUT /meta/:type/:name should return 501 when protocol is unavailable', async () => {
            const context = { request: {} };
            const body = { label: 'Test' };
            const result = await minimalDispatcher.handleMetadata('/objects/my_obj', context, 'PUT', body);
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(501);
        });

        it('should use protocol service with minimal kernel', async () => {
            const mockProtocolLocal = {
                getMetaTypes: vi.fn().mockResolvedValue({ types: ['custom_type'] }),
            };
            minimalKernel.context.getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return mockProtocolLocal;
                return null;
            });

            const context = { request: {} };
            const result = await minimalDispatcher.handleMetadata('/types', context, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(mockProtocolLocal.getMetaTypes).toHaveBeenCalled();
            expect(result.response?.body?.data?.types).toContain('custom_type');
        });
    });

    // ------------------------------------------------------------------
    // Phase 2 — URL-param project resolution
    // ------------------------------------------------------------------
    describe('resolveEnvironmentContext — URL-param environmentId', () => {
        let envDispatcher: HttpDispatcher;
        let envRegistry: any;

        beforeEach(() => {
            envRegistry = {
                resolveByHostname: vi.fn().mockResolvedValue(null),
                resolveById: vi.fn(),
            };
            envDispatcher = new HttpDispatcher(kernel, envRegistry);
        });

        it('resolves environmentId from /projects/:id/... path before hostname / header', async () => {
            envRegistry.resolveById = vi.fn().mockResolvedValue({ name: 'driver-for-proj-123' });

            const context: any = { request: { headers: { host: 'anyhost' } } };
            // Access the private resolver through a public entry point: handleData
            // triggers resolveEnvironmentContext with the given path.
            await (envDispatcher as any).resolveEnvironmentContext(
                context,
                '/api/v1/environments/proj-123/data/task',
            );

            expect(envRegistry.resolveById).toHaveBeenCalledWith('proj-123');
            expect(context.environmentId).toBe('proj-123');
            expect(context.dataDriver).toEqual({ name: 'driver-for-proj-123' });
            // Hostname path should NOT have been tried.
            expect(envRegistry.resolveByHostname).not.toHaveBeenCalled();
        });

        it('does not treat /cloud/environments/:id as a scoping prefix', async () => {
            envRegistry.resolveById = vi.fn().mockResolvedValue({ name: 'wrong' });

            const context: any = { request: { headers: {} } };
            await (envDispatcher as any).resolveEnvironmentContext(
                context,
                '/api/v1/cloud/environments/proj-123',
            );

            // /cloud is explicitly skipped.
            expect(envRegistry.resolveById).not.toHaveBeenCalled();
            expect(context.environmentId).toBeUndefined();
        });

        it('falls through to header resolution when URL-param project is unknown', async () => {
            envRegistry.resolveById = vi.fn()
                .mockResolvedValueOnce(null) // URL-param lookup fails
                .mockResolvedValueOnce({ name: 'header-driver' }); // header lookup succeeds

            const context: any = {
                request: { headers: { 'x-environment-id': 'proj-header' } },
            };
            await (envDispatcher as any).resolveEnvironmentContext(
                context,
                '/api/v1/environments/proj-unknown/data/task',
            );

            expect(envRegistry.resolveById).toHaveBeenNthCalledWith(1, 'proj-unknown');
            expect(envRegistry.resolveById).toHaveBeenNthCalledWith(2, 'proj-header');
            expect(context.environmentId).toBe('proj-header');
        });
    });

    describe('enforceProjectMembership (RBAC)', () => {
        const SYSTEM_ENVIRONMENT_ID = '00000000-0000-0000-0000-000000000001';
        const PLATFORM_ORG_ID = '00000000-0000-0000-0000-000000000000';

        function buildDispatcher(opts: {
            memberRows?: any[];
            userId?: string;
            orgId?: string;
            enforce?: boolean;
        }) {
            const memberQL = {
                ...mockObjectQL,
                find: vi.fn().mockImplementation(async (name: string) => {
                    if (name === 'sys_environment_member') return opts.memberRows ?? [];
                    return [];
                }),
            };
            const authService = {
                api: {
                    getSession: vi.fn().mockResolvedValue(
                        opts.userId
                            ? {
                                user: { id: opts.userId },
                                session: { activeOrganizationId: opts.orgId },
                            }
                            : null,
                    ),
                },
            };
            const k: any = {
                context: {
                    getService: (name: string) => {
                        if (name === 'protocol') return mockProtocol;
                        if (name === 'objectql') return memberQL;
                        if (name === 'auth') return authService;
                        return null;
                    },
                },
            };
            return {
                dispatcher: new HttpDispatcher(k, undefined, {
                    enforceProjectMembership: opts.enforce ?? true,
                }),
                memberQL,
            };
        }

        it('returns 403 when user is not a member of the scoped project', async () => {
            const { dispatcher: d, memberQL } = buildDispatcher({
                memberRows: [],
                userId: 'user-1',
                orgId: 'org-tenant',
            });
            const ctx: any = { request: { headers: {} }, environmentId: 'proj-private' };
            const result = await (d as any).enforceProjectMembership(
                ctx,
                '/api/v1/environments/proj-private/data/task',
            );
            expect(result).not.toBeNull();
            expect(result.status).toBe(403);
            expect(result.body.error.details.type).toBe('PROJECT_MEMBERSHIP_REQUIRED');
            expect(memberQL.find).toHaveBeenCalledWith('sys_environment_member', expect.objectContaining({
                where: { environment_id: 'proj-private', user_id: 'user-1' },
            }));
        });

        it('bypasses the check for the system project', async () => {
            const { dispatcher: d, memberQL } = buildDispatcher({
                memberRows: [],
                userId: 'user-1',
                orgId: 'org-tenant',
            });
            const ctx: any = { request: { headers: {} }, environmentId: SYSTEM_ENVIRONMENT_ID };
            const result = await (d as any).enforceProjectMembership(
                ctx,
                `/api/v1/environments/${SYSTEM_ENVIRONMENT_ID}/meta`,
            );
            expect(result).toBeNull();
            expect(memberQL.find).not.toHaveBeenCalled();
        });

        it('bypasses the check for platform-org members', async () => {
            const { dispatcher: d, memberQL } = buildDispatcher({
                memberRows: [],
                userId: 'staff-1',
                orgId: PLATFORM_ORG_ID,
            });
            const ctx: any = { request: { headers: {} }, environmentId: 'proj-any' };
            const result = await (d as any).enforceProjectMembership(
                ctx,
                '/api/v1/environments/proj-any/data/task',
            );
            expect(result).toBeNull();
            expect(memberQL.find).not.toHaveBeenCalled();
        });

        it('caches positive results so repeat calls skip the DB lookup', async () => {
            const { dispatcher: d, memberQL } = buildDispatcher({
                memberRows: [{ id: 'm1', role: 'admin' }],
                userId: 'user-1',
                orgId: 'org-tenant',
            });
            const ctx: any = { request: { headers: {} }, environmentId: 'proj-a' };

            const r1 = await (d as any).enforceProjectMembership(
                ctx,
                '/api/v1/environments/proj-a/data/task',
            );
            expect(r1).toBeNull();
            expect(memberQL.find).toHaveBeenCalledTimes(1);

            const r2 = await (d as any).enforceProjectMembership(
                ctx,
                '/api/v1/environments/proj-a/data/task',
            );
            expect(r2).toBeNull();
            expect(memberQL.find).toHaveBeenCalledTimes(1);
        });

        it('is a no-op when enforcement is disabled', async () => {
            const { dispatcher: d, memberQL } = buildDispatcher({
                memberRows: [],
                userId: 'user-1',
                orgId: 'org-tenant',
                enforce: false,
            });
            const ctx: any = { request: { headers: {} }, environmentId: 'proj-any' };
            const result = await (d as any).enforceProjectMembership(
                ctx,
                '/api/v1/environments/proj-any/data/task',
            );
            expect(result).toBeNull();
            expect(memberQL.find).not.toHaveBeenCalled();
        });
    });
});