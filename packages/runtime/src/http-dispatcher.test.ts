
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';
import { ObjectKernel } from '@objectstack/core';
import { ApiErrorSchema } from '@objectstack/spec/api';

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
            const context = { request: {}, executionContext: { userId: 'u1' } };
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
            const context = { request: {}, executionContext: { userId: 'u1' } };
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

            const context = { request: {}, executionContext: { userId: 'u1' } };
            const body = { label: 'Fallback' };
            const path = '/objects/my_obj';

            const result = await dispatcher.handleMetadata(path, context, 'PUT', body);

            expect(result.handled).toBe(true);
            expect(mockMetaSvc.saveItem).toHaveBeenCalledWith('objects', 'my_obj', body);
            expect(result.response?.body?.data).toEqual({ success: true, fromMetaSvc: true });
        });

        it('should return error if save fails', async () => {
            mockProtocol.saveMetaItem.mockRejectedValue(new Error('Save failed'));

            const context = { request: {}, executionContext: { userId: 'u1' } };
            const body = {};
            const path = '/objects/bad_obj';

            const result = await dispatcher.handleMetadata(path, context, 'PUT', body);

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(400);
            expect(result.response?.body?.error?.message).toBe('Save failed');
        });

        it('preserves the 422 status + structured spec-validation issues on save', async () => {
            // protocol.saveMetaItem throws a spec-validation error carrying the
            // field-anchored issues; the dispatcher must pass them through (not
            // flatten to a single 400 message) so the Studio can point at fields.
            const err: any = new Error('[invalid_metadata] object/bad failed spec validation: fields.amount.type: Required');
            err.code = 'INVALID_METADATA';
            err.status = 422;
            err.issues = [
                { path: 'fields.amount.type', message: 'Required', code: 'invalid_type' },
                { path: 'label', message: 'Required', code: 'invalid_type' },
            ];
            mockProtocol.saveMetaItem.mockRejectedValue(err);

            const result = await dispatcher.handleMetadata('/objects/bad', { request: {}, executionContext: { userId: 'u1' } } as any, 'PUT', {});

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(422); // NOT the old hardcoded 400
            const error = result.response?.body?.error;
            // [#3842] The spec-validation code is the `error.code`; the
            // field-anchored issues stay in `details`, which is what they are.
            expect(error?.code).toBe('INVALID_METADATA');
            expect(error?.details?.issues).toEqual(err.issues);
            expect(error?.details?.issues[0].path).toBe('fields.amount.type');
        });

        it('should handle READ operations via ObjectQL registry', async () => {
             mockObjectQL.registry.getObject.mockReturnValue({ name: 'my_obj', fields: {} });
             
             const context = { request: {}, executionContext: { userId: 'u1' } };
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
                resume: vi.fn().mockResolvedValue({ success: true, output: {}, durationMs: 7 }),
                // Sync per IAutomationService — `ScreenSpec | null`, not a promise.
                getSuspendedScreen: vi.fn().mockReturnValue({ nodeId: 'collect', fields: [] }),
                getActionDescriptors: vi.fn().mockReturnValue([
                    { type: 'decision', name: 'Decision', category: 'logic', paradigms: ['flow'], source: 'builtin' },
                    { type: 'http_request', name: 'HTTP Request', category: 'io', paradigms: ['flow', 'approval'], source: 'builtin' },
                    { type: 'send_sms', name: 'Send SMS', category: 'io', paradigms: ['flow'], source: 'plugin' },
                ]),
                getConnectorDescriptors: vi.fn().mockReturnValue([
                    { name: 'rest', label: 'REST', type: 'api', actions: [{ key: 'request', label: 'Request' }] },
                    { name: 'slack', label: 'Slack', type: 'api', actions: [{ key: 'chat.postMessage', label: 'Post Message' }] },
                    { name: 'pg', label: 'Postgres', type: 'database', actions: [] },
                ]),
                getFlowRuntimeStates: vi.fn().mockReturnValue([
                    { name: 'flow_a', enabled: true, bound: true },
                    { name: 'flow_b', enabled: false, bound: false },
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

        it('should return per-flow runtime enable/bound state via GET /_status', async () => {
            const result = await dispatcher.handleAutomation('_status', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.flows).toEqual([
                { name: 'flow_a', enabled: true, bound: true },
                { name: 'flow_b', enabled: false, bound: false },
            ]);
            // `_status` must NOT be treated as a flow name (getFlow catch-all).
            expect(mockAutomationService.getFlow).not.toHaveBeenCalledWith('_status');
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

        // ── screen-flow runtime (ADR-0019 durable pause, #3528) ──────────
        it('should resume a paused run via POST /:name/runs/:runId/resume', async () => {
            const result = await dispatcher.handleAutomation(
                'flow_a/runs/run_1/resume', 'POST', { inputs: { new_assignee: 'ada' } }, { request: {} },
            );
            expect(result.handled).toBe(true);
            expect(mockAutomationService.resume).toHaveBeenCalledWith('run_1', {
                variables: { new_assignee: 'ada' },
            });
            expect(result.response?.body?.data?.success).toBe(true);
        });

        it('should accept `variables` as an alias for `inputs` on resume', async () => {
            await dispatcher.handleAutomation(
                'flow_a/runs/run_1/resume', 'POST', { variables: { note: 'hi' } }, { request: {} },
            );
            expect(mockAutomationService.resume).toHaveBeenCalledWith('run_1', {
                variables: { note: 'hi' },
            });
        });

        it('should forward approval-style output + branchLabel on resume', async () => {
            await dispatcher.handleAutomation(
                'flow_a/runs/run_1/resume', 'POST',
                { output: { comment: 'ok' }, branchLabel: 'approve' }, { request: {} },
            );
            expect(mockAutomationService.resume).toHaveBeenCalledWith('run_1', {
                output: { comment: 'ok' },
                branchLabel: 'approve',
            });
        });

        it('should resume with an empty signal when the body carries no input', async () => {
            await dispatcher.handleAutomation('flow_a/runs/run_1/resume', 'POST', undefined, { request: {} });
            expect(mockAutomationService.resume).toHaveBeenCalledWith('run_1', {});
        });

        it('should surface the next screen when a resumed run pauses again', async () => {
            mockAutomationService.resume.mockResolvedValue({
                success: true, status: 'paused', runId: 'run_1',
                screen: { nodeId: 'step2', title: 'Confirm', fields: [] },
            });
            const result = await dispatcher.handleAutomation(
                'flow_a/runs/run_1/resume', 'POST', { inputs: {} }, { request: {} },
            );
            expect(result.response?.body?.data?.status).toBe('paused');
            expect(result.response?.body?.data?.screen?.nodeId).toBe('step2');
        });

        // #3801: a run parked on a service-gated node (an `approval` pause,
        // resumable only through ApprovalService) comes back `forbidden` from
        // the engine. That is an AUTHORIZATION answer and must read as one —
        // a 200 carrying `success: false` reads as "your resume ran and the
        // flow failed", which is the opposite of what happened.
        it('should answer 403 when the engine refuses the resume as service-gated', async () => {
            mockAutomationService.resume.mockResolvedValue({
                success: false, code: 'PERMISSION_DENIED',
                error: "Run 'run_1' is paused at an 'approval' node, which only its owning service may resume",
            });
            const result = await dispatcher.handleAutomation(
                'flow_a/runs/run_1/resume', 'POST', { branchLabel: 'approve' }, { request: {} },
            );
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(403);
            expect(result.response?.body?.error?.message ?? result.response?.body?.message)
                .toMatch(/only its owning service may resume/);
        });

        // A run that resumed and then FAILED is not an authorization answer —
        // it keeps the ordinary success-envelope shape.
        it('should not 403 an ordinary failed resume', async () => {
            mockAutomationService.resume.mockResolvedValue({ success: false, error: 'node blew up' });
            const result = await dispatcher.handleAutomation(
                'flow_a/runs/run_1/resume', 'POST', { inputs: {} }, { request: {} },
            );
            expect(result.response?.status).not.toBe(403);
            expect(result.response?.body?.data?.success).toBe(false);
        });

        // #3853 follow-up: the reserved-name rule lives in the ENGINE, at the one
        // place a signal reaches the variable map — the route only maps its
        // verdict onto a status. (Guarding one body field at a time here is what
        // let `output` reopen the hole `inputs` had just closed.)
        it('should answer 400 when the engine rejects the signal as engine-internal', async () => {
            mockAutomationService.resume.mockResolvedValue({
                success: false, code: 'INVALID_SIGNAL',
                error: "Resume signal may not set engine-internal variables (signoffs.$mapItemDone) — " +
                    "names starting with '$' (or containing '.$') are reserved by the flow engine",
            });
            const result = await dispatcher.handleAutomation(
                'flow_a/runs/run_1/resume', 'POST',
                { output: { $mapItemDone: true } }, { request: {} },
            );
            expect(result.response?.status).toBe(400);
            expect(result.response?.body?.error?.message).toMatch(/reserved by the flow engine/);
        });

        // Both body fields reach the engine verbatim — it, not the route, decides.
        it('should forward `output` and `inputs` unfiltered for the engine to judge', async () => {
            await dispatcher.handleAutomation(
                'flow_a/runs/run_1/resume', 'POST',
                { inputs: { new_assignee: 'ada', 'collect.note': 'hi', price$: 3 }, output: { decision: 'ok' } },
                { request: {} },
            );
            expect(mockAutomationService.resume).toHaveBeenCalledWith('run_1', {
                variables: { new_assignee: 'ada', 'collect.note': 'hi', price$: 3 },
                output: { decision: 'ok' },
            });
        });

        it('should return 501 when the automation service cannot resume', async () => {
            delete mockAutomationService.resume;
            const result = await dispatcher.handleAutomation(
                'flow_a/runs/run_1/resume', 'POST', { inputs: {} }, { request: {} },
            );
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(501);
        });

        it('should get the pending screen via GET /:name/runs/:runId/screen', async () => {
            const result = await dispatcher.handleAutomation('flow_a/runs/run_1/screen', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(mockAutomationService.getSuspendedScreen).toHaveBeenCalledWith('run_1');
            expect(result.response?.body?.data?.screen?.nodeId).toBe('collect');
            // `screen` must NOT be swallowed by the getRun route below it.
            expect(mockAutomationService.getRun).not.toHaveBeenCalled();
        });

        it('should return 404 when the run is not awaiting a screen', async () => {
            mockAutomationService.getSuspendedScreen.mockReturnValue(null);
            const result = await dispatcher.handleAutomation('flow_a/runs/run_1/screen', 'GET', {}, { request: {} });
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
            const result = await dispatcher.handleAutomation('actions', 'GET', {}, { request: {} }, { paradigm: 'approval' });
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

                const result = await dispatcher.handleAnalytics('query', 'POST', { cube: 't1', measures: ['count'] }, { request: {} });
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(mockAnalytics.query).toHaveBeenCalled();
            });

            // [#2852] The execution context must reach the analytics service so
            // it scopes each object by its per-object read filter (tenant + RLS).
            // Previously it was dropped and the query ran UNSCOPED.
            it('threads the execution context into analytics.query and generateSql (RLS scoping)', async () => {
                const mockAnalytics = {
                    query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
                    generateSql: vi.fn().mockResolvedValue({ sql: 'SELECT 1', params: [] }),
                };
                (kernel as any).getService = vi.fn().mockImplementation((name: string) =>
                    name === 'analytics' ? mockAnalytics : null,
                );
                const ec = { userId: 'u1', positions: [], permissions: [], tenantId: 'org-1' };

                // [#3878] The ORIGINAL body must be forwarded (no parse-output
                // substitution): a parsed body would carry the schema's
                // `timezone: 'UTC'` default and override org-timezone resolution.
                const body = { cube: 'leads', measures: ['count'] };
                await dispatcher.handleAnalytics('query', 'POST', body, { request: {}, executionContext: ec } as any);
                expect(mockAnalytics.query).toHaveBeenCalledWith(body, ec);
                expect(mockAnalytics.query.mock.calls[0][0]).toBe(body);

                await dispatcher.handleAnalytics('sql', 'POST', body, { request: {}, executionContext: ec } as any);
                expect(mockAnalytics.generateSql).toHaveBeenCalledWith(body, ec);
            });

            it('should handle POST /analytics/sql with async service', async () => {
                const mockAnalytics = {
                    generateSql: vi.fn().mockResolvedValue({ sql: 'SELECT * FROM t' }),
                };
                (kernel as any).getService = vi.fn().mockResolvedValue(mockAnalytics);

                const result = await dispatcher.handleAnalytics('sql', 'POST', { cube: 'test', measures: ['count'] }, { request: {} });
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

            // [#3584] GET /analytics/meta?cube=<name> — the optional single-cube
            // filter the client's analytics.meta(cube) sends. The cube name must
            // reach AnalyticsService.getMeta(cubeName?); absent/empty stays a
            // full listing (getMeta called with undefined).
            it('threads the ?cube= filter into getMeta, full dispatch path included', async () => {
                const mockAnalytics = {
                    getMeta: vi.fn().mockResolvedValue([{ name: 'leads' }]),
                };
                (kernel as any).getService = vi.fn().mockResolvedValue(mockAnalytics);

                const viaDispatch = await dispatcher.dispatch('GET', '/analytics/meta', undefined, { cube: 'leads' }, { request: {} });
                expect(viaDispatch.handled).toBe(true);
                expect(mockAnalytics.getMeta).toHaveBeenCalledWith('leads');

                mockAnalytics.getMeta.mockClear();
                await dispatcher.handleAnalytics('meta', 'GET', undefined, { request: {} }, { cube: '' });
                expect(mockAnalytics.getMeta).toHaveBeenCalledWith(undefined);
            });

            it('should return unhandled when analytics service is not registered', async () => {
                (kernel as any).getService = vi.fn().mockResolvedValue(null);
                (kernel as any).services = new Map();

                const result = await dispatcher.handleAnalytics('query', 'POST', {}, { request: {} });
                expect(result.handled).toBe(false);
            });

            // [#4000] ADR-0076 D12 conclusion 3 binds consumers: only
            // `handlerReady: true` is a real capability. The dispatcher gated
            // on presence alone, so anything occupying the slot got called and
            // its fabricated rows went back as a 200 — the shape #3891 retired
            // one layer up, kept alive in dev by plugin-dev's analytics stub
            // (retired with this change). A stub slot is an empty slot.
            it('returns unhandled when the analytics slot holds a self-declared stub, without calling it', async () => {
                const stub = {
                    _dev: true,
                    query: vi.fn().mockResolvedValue({ rows: [], fields: [] }),
                    getMeta: vi.fn().mockResolvedValue([]),
                    generateSql: vi.fn().mockResolvedValue({ sql: '', params: [] }),
                };
                (kernel as any).getService = vi.fn().mockResolvedValue(stub);

                for (const [sub, method] of [['query', 'POST'], ['meta', 'GET'], ['sql', 'POST']] as const) {
                    const result = await dispatcher.handleAnalytics(sub, method, { cube: 'leads', measures: ['count'] }, { request: {} });
                    expect(result.handled, `${method} /analytics/${sub}`).toBe(false);
                }
                expect(stub.query).not.toHaveBeenCalled();
                expect(stub.getMeta).not.toHaveBeenCalled();
                expect(stub.generateSql).not.toHaveBeenCalled();
            });

            // The same gate read through the standard descriptor, and its other
            // half: `degraded` means "working, but partial" — `handlerReady`
            // defaults to true there, so it keeps serving. Only a self-confessed
            // non-handler is treated as an empty slot.
            it('honours __serviceInfo: stub 404s, degraded still serves', async () => {
                const make = (info: Record<string, unknown>) => ({
                    __serviceInfo: info,
                    query: vi.fn().mockResolvedValue({ rows: [], fields: [] }),
                });

                const stub = make({ status: 'stub', message: 'dev fake' });
                (kernel as any).getService = vi.fn().mockResolvedValue(stub);
                expect((await dispatcher.handleAnalytics('query', 'POST', { cube: 'leads', measures: ['count'] }, { request: {} })).handled).toBe(false);
                expect(stub.query).not.toHaveBeenCalled();

                const degraded = make({ status: 'degraded' });
                (kernel as any).getService = vi.fn().mockResolvedValue(degraded);
                expect((await dispatcher.handleAnalytics('query', 'POST', { cube: 'leads', measures: ['count'] }, { request: {} })).handled).toBe(true);
                expect(degraded.query).toHaveBeenCalled();
            });

            it('should return unhandled for unknown analytics sub-path', async () => {
                const mockAnalytics = { query: vi.fn() };
                (kernel as any).getService = vi.fn().mockResolvedValue(mockAnalytics);

                const result = await dispatcher.handleAnalytics('unknown', 'POST', {}, { request: {} });
                expect(result.handled).toBe(false);
            });

            // [#3878] Entry validation: a malformed body raises the duck-typed
            // VALIDATION_FAILED shape BEFORE the service runs — previously it
            // reached the engine, inferred a column-less cube, and died as an
            // SQL syntax error (or had its off-contract filter silently
            // dropped). The domain throws through (same contract as service
            // errors, see 'should propagate analytics query error'); the HTTP
            // bridge maps the shape to a 400 envelope — pinned end-to-end in
            // `dispatcher-validation-error.real.test.ts`.
            describe('AnalyticsQuery body validation (#3878)', () => {
                const service = () => {
                    const mockAnalytics = {
                        query: vi.fn().mockResolvedValue({ rows: [] }),
                        generateSql: vi.fn().mockResolvedValue({ sql: 'SELECT 1', params: [] }),
                    };
                    (kernel as any).getService = vi.fn().mockResolvedValue(mockAnalytics);
                    return mockAnalytics;
                };

                it('rejects the retired {cube, query:{...}} envelope with the tombstone prescription', async () => {
                    const mockAnalytics = service();
                    await expect(dispatcher.dispatch(
                        'POST', '/analytics/query', { cube: 'x', query: { measures: ['count'] } }, {}, { request: {} },
                    )).rejects.toMatchObject({
                        name: 'ValidationError',
                        code: 'VALIDATION_FAILED',
                        message: expect.stringContaining('top level'),
                    });
                    expect(mockAnalytics.query).not.toHaveBeenCalled();
                });

                it('rejects a `filters` key, pointing at the contract field `where`', async () => {
                    const mockAnalytics = service();
                    await expect(dispatcher.dispatch(
                        'POST', '/analytics/query',
                        { cube: 'x', measures: ['count'], filters: [{ member: 'status', operator: 'equals', values: ['active'] }] },
                        {}, { request: {} },
                    )).rejects.toMatchObject({
                        code: 'VALIDATION_FAILED',
                        message: expect.stringContaining('`where`'),
                    });
                    expect(mockAnalytics.query).not.toHaveBeenCalled();
                });

                it('rejects a body with no measures, naming the missing field', async () => {
                    const mockAnalytics = service();
                    await expect(dispatcher.dispatch(
                        'POST', '/analytics/query', { cube: 'x' }, {}, { request: {} },
                    )).rejects.toMatchObject({
                        code: 'VALIDATION_FAILED',
                        fields: expect.arrayContaining([expect.objectContaining({ field: 'measures' })]),
                    });
                    expect(mockAnalytics.query).not.toHaveBeenCalled();
                });

                it('validates /analytics/sql with the same contract', async () => {
                    const mockAnalytics = service();
                    await expect(dispatcher.dispatch(
                        'POST', '/analytics/sql', { cube: 'x', query: {} }, {}, { request: {} },
                    )).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
                    expect(mockAnalytics.generateSql).not.toHaveBeenCalled();
                });

                it('a valid bare body still reaches the service untouched', async () => {
                    const mockAnalytics = service();
                    const body = { cube: 'x', measures: ['count'], where: { status: 'active' } };
                    const result: any = await dispatcher.dispatch(
                        'POST', '/analytics/query', body, {}, { request: {} },
                    );
                    expect(result.response?.status).toBe(200);
                    expect(mockAnalytics.query.mock.calls[0][0]).toBe(body);
                });
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

        // ADR-0090 D5/D9: the /api/v1/security/suggested-bindings surface,
        // dispatched to the `security` service registered by plugin-security.
        describe('handleSecurity (ADR-0090 D5/D9 suggested audience bindings)', () => {
            const secKernel = (service: any) =>
                ({ context: { getService: (name: string) => (name === 'security' ? service : null) } } as any);
            const ctx = (userId?: string) =>
                ({ request: {}, executionContext: userId ? { userId } : undefined } as any);
            const makeService = () => ({
                listAudienceBindingSuggestions: vi.fn().mockResolvedValue({ suggestions: [{ id: 's1', status: 'pending' }], synced: { created: 1 } }),
                confirmAudienceBindingSuggestion: vi.fn().mockResolvedValue({ suggestion: { id: 's1', status: 'confirmed' }, bindingCreated: true }),
                dismissAudienceBindingSuggestion: vi.fn().mockResolvedValue({ suggestion: { id: 's1', status: 'dismissed' } }),
            });

            it('GET /suggested-bindings lists via the service with status/packageId filters', async () => {
                const service = makeService();
                const d = new HttpDispatcher(secKernel(service));
                const result = await d.handleSecurity('/suggested-bindings', 'GET', undefined, { status: 'pending', packageId: 'com.example.crm' }, ctx('u1'));
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(result.response?.body?.data?.suggestions).toHaveLength(1);
                expect(service.listAudienceBindingSuggestions).toHaveBeenCalledWith({ userId: 'u1' }, { status: 'pending', packageId: 'com.example.crm' });
            });

            it('POST /suggested-bindings/:id/confirm passes the caller execution context', async () => {
                const service = makeService();
                const d = new HttpDispatcher(secKernel(service));
                const result = await d.handleSecurity('/suggested-bindings/s1/confirm', 'POST', undefined, {}, ctx('u1'));
                expect(result.handled).toBe(true);
                expect(result.response?.body?.data?.bindingCreated).toBe(true);
                expect(service.confirmAudienceBindingSuggestion).toHaveBeenCalledWith({ userId: 'u1' }, 's1');
            });

            it('POST /suggested-bindings/:id/dismiss dismisses via the service', async () => {
                const service = makeService();
                const d = new HttpDispatcher(secKernel(service));
                const result = await d.handleSecurity('/suggested-bindings/s1/dismiss', 'POST', undefined, {}, ctx('u1'));
                expect(result.handled).toBe(true);
                expect(result.response?.body?.data?.suggestion?.status).toBe('dismissed');
            });

            it('maps typed service errors onto their HTTP status (403/404/409)', async () => {
                const service = makeService();
                service.confirmAudienceBindingSuggestion = vi.fn().mockRejectedValue(
                    Object.assign(new Error('[Security] Access denied: tenant admin required'), { statusCode: 403 }),
                );
                const d = new HttpDispatcher(secKernel(service));
                const result = await d.handleSecurity('/suggested-bindings/s1/confirm', 'POST', undefined, {}, ctx('u1'));
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(403);
            });

            it('401s an anonymous request without touching the service', async () => {
                const service = makeService();
                // NOTE: no options — requireAuth defaults false, yet the admin
                // surface still denies anonymous (the gate is UNCONDITIONAL,
                // hardcoded requireAuth:true into shouldDenyAnonymous — #2567).
                const d = new HttpDispatcher(secKernel(service));
                const result = await d.handleSecurity('/suggested-bindings', 'GET', undefined, {}, ctx());
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(401);
                // Shared anonymous-deny body shape (locks the seam migration).
                // [#3842] `ANONYMOUS_DENY_CODE` reaches `error.code` now — it was
                // parked in `details` while the status occupied the field.
                expect(result.response?.body?.error?.code).toBe('UNAUTHENTICATED');
                expect(service.listAudienceBindingSuggestions).not.toHaveBeenCalled();
            });

            it('503s when the security service is missing (plugin-security not loaded)', async () => {
                const d = new HttpDispatcher(secKernel(null));
                const result = await d.handleSecurity('/suggested-bindings', 'GET', undefined, {}, ctx('u1'));
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(503);
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

                const result = await dispatcher.handleMetadata('/objects/my_obj', { request: {}, executionContext: { userId: 'u1' } } as any, 'PUT', { label: 'Test' });
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

                const result = await dispatcher.handleMetadata('/objects/my_obj', { request: {}, executionContext: { userId: 'u1' } } as any, 'GET');
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

            const result = await dispatcher.handleAnalytics('query', 'POST', { cube: 't', measures: ['count'] }, { request: {} });
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

            const result = await dispatcher.handleAnalytics('query', 'POST', { cube: 't', measures: ['count'] }, { request: {} });
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

            const result = await dispatcher.handleMetadata('/objects/my_obj', { request: {}, executionContext: { userId: 'u1' } } as any, 'PUT', { label: 'Test' });
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

            const result = await dispatcher.handleAnalytics('query', 'POST', { cube: 't', measures: ['count'] }, { request: {} });
            expect(result.handled).toBe(true);
            expect(syncAnalytics.query).toHaveBeenCalled();
        });

        it('should fall through when getServiceAsync throws', async () => {
            (kernel as any).getServiceAsync = vi.fn().mockRejectedValue(new Error('not found'));
            const syncAnalytics = {
                query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
            };
            (kernel as any).services = new Map([['analytics', syncAnalytics]]);

            const result = await dispatcher.handleAnalytics('query', 'POST', { cube: 't', measures: ['count'] }, { request: {} });
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
                dispatcher.handleAnalytics('query', 'POST', { cube: 't', measures: ['count'] }, { request: {} })
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

        it('PATCH /packages/:id edits the manifest via protocol.updatePackage', async () => {
            const updatePackage = vi.fn().mockResolvedValue({
                package: { manifest: { id: 'com.acme.crm', name: 'Acme CRM v2', version: '1.2.0' } },
                message: 'Updated package: com.acme.crm',
            });
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ updatePackage });
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });

            const result = await dispatcher.handlePackages(
                '/com.acme.crm',
                'PATCH',
                { name: '  Acme CRM v2 ', version: '1.2.0' },
                {},
                { request: {} },
            );
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            // name is trimmed; only sent fields are in the patch.
            expect(updatePackage).toHaveBeenCalledWith({
                packageId: 'com.acme.crm',
                patch: { name: 'Acme CRM v2', version: '1.2.0' },
            });
            expect(result.response?.body?.data?.manifest?.name).toBe('Acme CRM v2');
        });

        it('PATCH /packages/:id accepts a { manifest } wrapper too', async () => {
            const updatePackage = vi.fn().mockResolvedValue({ package: { manifest: { id: 'a.b' } } });
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ updatePackage });
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });

            await dispatcher.handlePackages('/a.b', 'PATCH', { manifest: { description: 'hi' } }, {}, { request: {} });
            expect(updatePackage).toHaveBeenCalledWith({ packageId: 'a.b', patch: { description: 'hi' } });
        });

        it('POST /packages creates a new package (201) after checking the id is free', async () => {
            const installPackage = vi
                .fn()
                .mockReturnValue({ manifest: { id: 'com.acme.new', name: 'New', version: '0.1.0' } });
            const mockRegistry = {
                getPackage: vi.fn().mockReturnValue(undefined),
                installPackage,
                getAllPackages: vi.fn().mockReturnValue([]),
            };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'objectql') return Promise.resolve({ registry: mockRegistry });
                return null; // no protocol service → fall back to registry.installPackage
            });

            const result = await dispatcher.handlePackages(
                '',
                'POST',
                { manifest: { id: 'com.acme.new', name: 'New', version: '0.1.0', type: 'app' } },
                {},
                { request: {} },
            );
            expect(result.response?.status).toBe(201);
            expect(mockRegistry.getPackage).toHaveBeenCalledWith('com.acme.new');
            expect(installPackage).toHaveBeenCalled();
        });

        it('POST /packages rejects a duplicate id with 409 instead of silently overwriting', async () => {
            const installPackage = vi.fn();
            const mockRegistry = {
                getPackage: vi.fn().mockReturnValue({ manifest: { id: 'com.acme.crm', name: 'Existing' } }),
                installPackage,
                getAllPackages: vi.fn().mockReturnValue([]),
            };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'objectql') return Promise.resolve({ registry: mockRegistry });
                return null;
            });

            const result = await dispatcher.handlePackages(
                '',
                'POST',
                { manifest: { id: 'com.acme.crm', name: 'Clobber', version: '9.9.9' } },
                {},
                { request: {} },
            );
            expect(result.response?.status).toBe(409);
            // The existing manifest must NOT be overwritten.
            expect(installPackage).not.toHaveBeenCalled();
        });

        it('POST /packages?overwrite=true allows intentional overwrite of an existing id', async () => {
            const installPackage = vi
                .fn()
                .mockReturnValue({ manifest: { id: 'com.acme.crm', name: 'Upgraded', version: '2.0.0' } });
            const mockRegistry = {
                getPackage: vi.fn().mockReturnValue({ manifest: { id: 'com.acme.crm' } }),
                installPackage,
                getAllPackages: vi.fn().mockReturnValue([]),
            };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'objectql') return Promise.resolve({ registry: mockRegistry });
                return null;
            });

            const result = await dispatcher.handlePackages(
                '',
                'POST',
                { manifest: { id: 'com.acme.crm', name: 'Upgraded', version: '2.0.0' } },
                { overwrite: 'true' },
                { request: {} },
            );
            expect(result.response?.status).toBe(201);
            expect(installPackage).toHaveBeenCalled();
        });

        it('POST /packages rejects a missing id with 400', async () => {
            const mockRegistry = {
                getPackage: vi.fn(),
                installPackage: vi.fn(),
                getAllPackages: vi.fn().mockReturnValue([]),
            };
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'objectql') return Promise.resolve({ registry: mockRegistry });
                return null;
            });

            const result = await dispatcher.handlePackages(
                '',
                'POST',
                { manifest: { name: 'No Id' } },
                {},
                { request: {} },
            );
            expect(result.response?.status).toBe(400);
            expect(mockRegistry.installPackage).not.toHaveBeenCalled();
        });

        it('PATCH /packages/:id rejects an empty patch with 400', async () => {
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });
            const result = await dispatcher.handlePackages('/a.b', 'PATCH', {}, {}, { request: {} });
            expect(result.response?.status).toBe(400);
        });

        it('PATCH /packages/:id rejects a non-semantic version with 400', async () => {
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });
            const result = await dispatcher.handlePackages('/a.b', 'PATCH', { version: '1.2' }, {}, { request: {} });
            expect(result.response?.status).toBe(400);
        });

        it('PATCH /packages/:id falls back to the registry and 404s an unknown package', async () => {
            const updatePackageManifest = vi.fn().mockReturnValue(undefined);
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                // No protocol service → fallback path.
                if (name === 'objectql')
                    return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]), updatePackageManifest } });
                return null;
            });
            const result = await dispatcher.handlePackages('/nope', 'PATCH', { name: 'x' }, {}, { request: {} });
            expect(updatePackageManifest).toHaveBeenCalledWith('nope', { name: 'x' });
            expect(result.response?.status).toBe(404);
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

        it('POST /packages/:id/publish-drafts announces metadata:reloaded so boot-cached consumers re-sync', async () => {
            // #2560 follow-up: a flow published while the server runs must bind its
            // trigger WITHOUT a restart. The publish path fires 'metadata:reloaded'
            // — the same signal a dev artifact reload fires — so the automation
            // service re-syncs the just-published flow from the protocol.
            const publishPackageDrafts = vi.fn().mockResolvedValue({
                success: true, publishedCount: 1, failedCount: 0,
                published: [{ type: 'flow', name: 'ticket_closed', version: '1' }], failed: [],
            });
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ publishPackageDrafts });
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });
            const trigger = vi.fn().mockResolvedValue(undefined);
            (kernel as any).context.trigger = trigger;

            const result = await dispatcher.handlePackages('/com.example.ops/publish-drafts', 'POST', {}, {}, { request: {} });

            expect(result.response?.status).toBe(200);
            expect(trigger).toHaveBeenCalledWith(
                'metadata:reloaded',
                expect.objectContaining({ changed: expect.arrayContaining(['flow/ticket_closed']) }),
            );
        });

        it('POST /packages/:id/publish-drafts does NOT announce when nothing was published', async () => {
            const publishPackageDrafts = vi.fn().mockResolvedValue({
                success: false, publishedCount: 0, failedCount: 0, published: [], failed: [],
            });
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ publishPackageDrafts });
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });
            const trigger = vi.fn().mockResolvedValue(undefined);
            (kernel as any).context.trigger = trigger;

            await dispatcher.handlePackages('/app.empty/publish-drafts', 'POST', {}, {}, { request: {} });
            expect(trigger).not.toHaveBeenCalled();
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

        // ── ADR-0067: commit history & rollback routes ──────────────────
        it('GET /packages/:id/commits routes to protocol.listCommits', async () => {
            const listCommits = vi.fn().mockResolvedValue([
                { id: 'cmt_2', operation: 'apply', itemCount: 1, items: [], createdAt: '2026-06-24T00:00:02.000Z' },
                { id: 'cmt_1', operation: 'apply', itemCount: 2, items: [], createdAt: '2026-06-24T00:00:01.000Z' },
            ]);
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ listCommits });
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });

            const result = await dispatcher.handlePackages('/app.edu/commits', 'GET', {}, {}, { request: {} });

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(listCommits).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'app.edu' }));
            expect((result.response as any)?.body?.data?.commits).toHaveLength(2);
        });

        it('POST /packages/:id/commits/:commitId/revert routes to protocol.revertCommit', async () => {
            const revertCommit = vi.fn().mockResolvedValue({ success: true, revertedCount: 1, failedCount: 0, reverted: [], failed: [] });
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ revertCommit });
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });

            const result = await dispatcher.handlePackages('/app.edu/commits/cmt_1/revert', 'POST', { actor: 'ai:claude' }, {}, { request: {} });

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(revertCommit).toHaveBeenCalledWith(expect.objectContaining({ commitId: 'cmt_1', actor: 'ai:claude' }));
        });

        it('POST /packages/:id/rollback routes to protocol.rollbackToPackageCommit', async () => {
            const rollbackToPackageCommit = vi.fn().mockResolvedValue({ success: true, revertedCommits: ['c2', 'c3'], failed: [] });
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ rollbackToPackageCommit });
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });

            const result = await dispatcher.handlePackages('/app.edu/rollback', 'POST', { commitId: 'c1' }, {}, { request: {} });

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(rollbackToPackageCommit).toHaveBeenCalledWith(expect.objectContaining({ commitId: 'c1' }));
        });

        it('POST /packages/:id/rollback returns 400 without a commitId', async () => {
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ rollbackToPackageCommit: vi.fn() });
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });

            const result = await dispatcher.handlePackages('/app.edu/rollback', 'POST', {}, {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(400);
        });

        it('GET /packages/:id/commits returns 501 when protocol lacks listCommits', async () => {
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({});
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });
            const result = await dispatcher.handlePackages('/app.edu/commits', 'GET', {}, {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(501);
        });

        // Integration: publishing a `seed` draft must LOAD its rows. This
        // exercises applyPublishedSeeds end-to-end against the REAL
        // SeedLoaderService (only the engine/metadata are mocked), so it pins
        // the read-back shape (protocol.getMetaItem returns a WRAPPER whose body
        // is under `.item`), the renamed `seeds` request field, and the loader
        // invocation — the exact chain that silently loaded 0 rows on staging.
        it('POST /packages/:id/publish-drafts applies published `seed` rows', async () => {
            const records = [
                { name: 'Apollo', status: 'active', budget_amount: 120000 },
                { name: 'Gemini', status: 'planned', budget_amount: 45000 },
            ];
            const publishPackageDrafts = vi.fn().mockResolvedValue({
                success: true, publishedCount: 1, failedCount: 0,
                published: [{ type: 'seed', name: 'project_seed', version: 'h' }], failed: [],
            });
            // protocol.getMetaItem returns the WRAPPER shape (body under `.item`).
            const getMetaItem = vi.fn().mockResolvedValue({
                type: 'seed', name: 'project_seed', lock: null, editable: true,
                item: { object: 'project', externalId: 'name', mode: 'upsert', records },
            });
            // Mirror the real engine's array-form insert (bulk path): an
            // array in → an array of created records out — framework#2678.
            const insert = vi.fn().mockImplementation(async (_obj: string, rec: any) => (
                Array.isArray(rec) ? rec.map((r) => ({ id: `id_${r.name}` })) : { id: `id_${rec.name}` }
            ));
            const find = vi.fn().mockResolvedValue([]); // no existing rows → all insert
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ publishPackageDrafts, getMetaItem });
                if (name === 'objectql') return Promise.resolve({ insert, find, update: vi.fn(), registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                if (name === 'metadata') return Promise.resolve({ getObject: vi.fn().mockResolvedValue({ name: 'project', fields: { name: { type: 'text' }, status: { type: 'select' }, budget_amount: { type: 'currency' } } }) });
                return null;
            });

            const result = await dispatcher.handlePackages('/com.workspace/publish-drafts', 'POST', {}, {}, { request: {} });

            expect(result.response?.status).toBe(200);
            const seedApplied = (result.response as any)?.body?.data?.seedApplied;
            expect(seedApplied?.success).toBe(true);
            expect(seedApplied?.inserted).toBe(2);
            // rows actually went to the engine — batched into one bulk
            // insert() call rather than one per record (framework#2678).
            expect(insert).toHaveBeenCalledTimes(1);
            expect(insert).toHaveBeenCalledWith(
                'project',
                [expect.objectContaining({ name: 'Apollo' }), expect.objectContaining({ name: 'Gemini' })],
                expect.anything(),
            );
        });

        // ADR-0045: "Publish" = live AND visible. A materialized (additive)
        // build leaves its app at hidden:true; publish-drafts must flip it so
        // one publish verb serves both the draft and the materialize regimes.
        it('POST /packages/:id/publish-drafts unhides the package\'s hidden app', async () => {
            const publishPackageDrafts = vi.fn().mockResolvedValue({
                success: true, publishedCount: 0, failedCount: 0, published: [], failed: [], seedApplied: { success: true },
            });
            const getMetaItems = vi.fn().mockResolvedValue([
                { name: 'production_management', label: '生产管理', hidden: true, navigation: [] },
                { name: 'already_visible', hidden: false, navigation: [] },
            ]);
            const saveMetaItem = vi.fn().mockResolvedValue({ ok: true });
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ publishPackageDrafts, getMetaItems, saveMetaItem });
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });

            const result = await dispatcher.handlePackages('/app.production_management/publish-drafts', 'POST', {}, {}, { request: {} });

            expect(result.response?.status).toBe(200);
            expect(getMetaItems).toHaveBeenCalledWith(expect.objectContaining({ type: 'app', packageId: 'app.production_management' }));
            // Only the hidden app is re-saved, with hidden:false and everything else intact.
            expect(saveMetaItem).toHaveBeenCalledTimes(1);
            expect(saveMetaItem).toHaveBeenCalledWith(expect.objectContaining({
                type: 'app',
                name: 'production_management',
                item: expect.objectContaining({ hidden: false, label: '生产管理' }),
                packageId: 'app.production_management',
            }));
            expect((result.response as any)?.body?.data?.unhiddenApps).toEqual(['production_management']);
        });

        it('POST /packages/:id/publish-drafts reports (not throws) when the visibility flip fails', async () => {
            const publishPackageDrafts = vi.fn().mockResolvedValue({
                success: true, publishedCount: 1, failedCount: 0, published: [], failed: [], seedApplied: { success: true },
            });
            const getMetaItems = vi.fn().mockRejectedValue(new Error('meta backend down'));
            const saveMetaItem = vi.fn();
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'protocol') return Promise.resolve({ publishPackageDrafts, getMetaItems, saveMetaItem });
                if (name === 'objectql') return Promise.resolve({ registry: { getAllPackages: vi.fn().mockReturnValue([]) } });
                return null;
            });

            const result = await dispatcher.handlePackages('/app.edu/publish-drafts', 'POST', {}, {}, { request: {} });

            // The draft publish itself succeeded — the flip failure is surfaced, not fatal.
            expect(result.response?.status).toBe(200);
            expect((result.response as any)?.body?.data?.unhideError).toBe('meta backend down');
            expect(saveMetaItem).not.toHaveBeenCalled();
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
            const mockRegistry = {
                installPackage: vi.fn(),
                getPackage: vi.fn().mockReturnValue(undefined),
                getAllPackages: vi.fn().mockReturnValue([]),
            };
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
                getPackage: vi.fn().mockReturnValue(undefined),
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

            const result = await dispatcher.handleMetadata('_drafts', { request: {}, executionContext: { userId: 'u1' } } as any, 'GET', undefined, {
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

            const result = await dispatcher.handleMetadata('_drafts', { request: {}, executionContext: { userId: 'u1' } } as any, 'GET', undefined, {});
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

            await dispatcher.handleMetadata('_drafts', { request: {}, executionContext: { userId: 'u1' } } as any, 'GET', undefined, {});
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

            const result = await dispatcher.handleMetadata('/object/account/published', { request: {}, executionContext: { userId: 'u1' } } as any, 'GET');
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

            const result = await dispatcher.handleMetadata('/object/nonexistent/published', { request: {}, executionContext: { userId: 'u1' } } as any, 'GET');
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

            const result = await dispatcher.handleMetadata('/object/account/published', { request: {}, executionContext: { userId: 'u1' } } as any, 'GET');
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
                // The nested shape every producer writes and #3778 converged
                // on. This used to be flat `o.account.label` keys — a dialect
                // no bundle has ever carried.
                getTranslations: vi.fn().mockReturnValue({
                    objects: { account: { label: '客户', fields: { name: { label: '名称' } } } },
                }),
                // Declared optional on `II18nService` and implemented by NO
                // shipped provider — the tests below that assert it is called
                // cover the dispatcher's handling of a provider that supplies
                // it, not a path any current stack takes. See #3833.
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
            // Descriptors, not bare codes — the shape `GetLocalesResponseSchema`
            // declares and both surfaces now emit (#3859 follow-up).
            expect(result.response?.body?.data?.locales.map((l: any) => l.code)).toEqual(['en', 'zh-CN', 'ja']);
            expect(mockI18nService.getLocales).toHaveBeenCalled();
        });

        it('should get translations via GET /translations/:locale', async () => {
            const result = await dispatcher.handleI18n('/translations/zh-CN', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.locale).toBe('zh-CN');
            expect(result.response?.body?.data?.translations).toEqual({
                objects: { account: { label: '客户', fields: { name: { label: '名称' } } } },
            });
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

        /**
         * The dispatcher's error body is the SHAPE the autonomously-mounted
         * i18n/storage services were aligned to in #3675 — nested `error`, with
         * the `success` flag — and, as of #3842, the CONTRACT as well.
         *
         * #3687 pinned the one deviating field here rather than moving it, with
         * the instruction that the pin be DELETED once the dispatcher was fixed
         * rather than updated. That is what happened: the assertion is now that
         * `ApiErrorSchema` parses, spelled against the schema imported from
         * `packages/spec` so it tracks the contract if the contract moves. The
         * exhaustive per-branch version lives in
         * `error-envelope.conformance.test.ts`; this one keeps the guard at the
         * scene of the original pin.
         */
        it('emits an ApiErrorSchema-conformant error body (#3842, was the #3675 pin)', async () => {
            const result = await dispatcher.handleI18n('/translations', 'GET', {}, { request: {} });
            const body = result.response?.body as { success?: boolean; error?: unknown };

            expect(body.success).toBe(false);
            expect(typeof body.error).toBe('object');

            const parsed = ApiErrorSchema.safeParse(body.error);
            expect(parsed.error?.issues ?? []).toEqual([]);
            expect(parsed.success).toBe(true);
            // The status is on `httpStatus`; `code` is the semantic string it
            // used to displace — derived here, since this branch has no code of
            // its own to carry.
            expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR', httpStatus: 400 });
        });

        /**
         * This is the path EVERY provider takes, not an edge case:
         * `getFieldLabels` is optional on `II18nService` and nothing implements
         * it — not `memory-i18n`, not `file-i18n-adapter` — so the dedicated-
         * method branch above is dead in production and this derivation always
         * runs.
         *
         * Its predecessor fed flat `o.contact.fields.first_name` keys and
         * asserted labels came back. That dialect was retired by #3778 (no
         * producer ever wrote it), so the test passed on data that cannot
         * occur while the real path — scanning for an `o.` prefix in a bundle
         * whose top-level keys are `objects`/`apps`/`messages` — returned `{}`
         * for every caller. Feeding the shape real bundles actually have is
         * the whole point of the test (#3833).
         */
        it('derives labels from the NESTED bundle shape every producer writes (#3833)', async () => {
            delete mockI18nService.getFieldLabels;
            mockI18nService.getTranslations.mockReturnValue({
                objects: {
                    contact: {
                        label: 'Contact',
                        fields: {
                            first_name: { label: 'First Name' },
                            email: { label: 'Email', help: 'Primary address' },
                            status: { label: 'Status', options: { open: 'Open' } },
                            // No label — partial translation is the normal
                            // state, and a blank entry would overwrite the
                            // caller's source label with an empty string.
                            phone: { help: 'Mobile preferred' },
                        },
                    },
                },
                messages: { save: 'Save' },
            });

            const result = await dispatcher.handleI18n('/labels/contact/en', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            // Entries are objects carrying help/options, per
            // `GetFieldLabelsResponseSchema` — not the bare strings both
            // surfaces used to emit against it (#3847).
            expect(result.response?.body?.data?.labels).toEqual({
                first_name: { label: 'First Name' },
                email: { label: 'Email', help: 'Primary address' },
                status: { label: 'Status', options: { open: 'Open' } },
            });
        });

        it('returns {} for an object the locale does not translate, without throwing', async () => {
            delete mockI18nService.getFieldLabels;
            mockI18nService.getTranslations.mockReturnValue({
                objects: { contact: { fields: { email: { label: 'Email' } } } },
            });

            const result = await dispatcher.handleI18n('/labels/account/en', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.labels).toEqual({});
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
            expect(result.response?.body?.data?.locales.map((l: any) => l.code)).toEqual(['en', 'zh-CN', 'ja']);
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
            expect(result.response?.body?.data?.locales.map((l: any) => l.code)).toEqual(['en', 'fr']);
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
    // Honest capabilities — ADR-0076 D12 (#2462)
    // ═══════════════════════════════════════════════════════════════

    describe('discovery honest capabilities (D12)', () => {
        it('never advertises a /realtime route and reports a registered realtime service as degraded', async () => {
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'realtime') return { publish: vi.fn(), subscribe: vi.fn() };
                return null;
            });

            const info = await dispatcher.getDiscoveryInfo('/api/v1');

            // No HTTP/WS surface exists — a discovery-advertised route would 404.
            expect(info.routes.realtime).toBeUndefined();
            expect(info.features.websockets).toBe(false);
            expect(info.services.realtime.enabled).toBe(true);
            expect(info.services.realtime.status).toBe('degraded');
            expect(info.services.realtime.handlerReady).toBe(false);
            // …and a /realtime request indeed has no handler
            const result = await dispatcher.dispatch('POST', '/realtime/subscribe', {}, {}, { request: {} });
            expect(result.response?.status).toBe(404);
        });

        it('reports realtime as unavailable when no service is registered', async () => {
            (kernel as any).getService = vi.fn().mockResolvedValue(null);
            (kernel as any).services = new Map();

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.routes.realtime).toBeUndefined();
            expect(info.services.realtime.enabled).toBe(false);
            expect(info.services.realtime.status).toBe('unavailable');
        });

        it('reports a _dev-marked stub service as stub, never available', async () => {
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'ai') return { _dev: true, chat: vi.fn() };
                return null;
            });

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.services.ai.enabled).toBe(true);
            expect(info.services.ai.status).toBe('stub');
            expect(info.services.ai.handlerReady).toBe(false);
            expect(info.services.ai.message).toContain('stub');
        });

        it('reports a __serviceInfo-marked fallback with its declared status and message', async () => {
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'analytics') return {
                    __serviceInfo: { status: 'degraded', handlerReady: true, message: 'Lightweight fallback' },
                    query: vi.fn(),
                };
                return null;
            });

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.services.analytics.enabled).toBe(true);
            expect(info.services.analytics.status).toBe('degraded');
            expect(info.services.analytics.handlerReady).toBe(true);
            expect(info.services.analytics.message).toBe('Lightweight fallback');
            // Route stays advertised — the fallback genuinely serves it.
            expect(info.routes.analytics).toBe('/api/v1/analytics');
        });

        // [#4000] The other half of the same marker: a stub occupying the
        // analytics slot must not have its route advertised, because the
        // dispatcher now answers it with the empty-slot 404. Reporting the
        // service itself stays maximally informative — `stub` /
        // `handlerReady: false` says more than `unavailable` would.
        it('stops advertising the analytics route for a stub, while still reporting it as a stub', async () => {
            (kernel as any).getService = vi.fn().mockImplementation((name: string) =>
                name === 'analytics' ? { _dev: true, query: vi.fn() } : null,
            );

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.routes.analytics).toBeUndefined();
            expect(info.features.analytics).toBe(false);
            expect(info.services.analytics.enabled).toBe(true);
            expect(info.services.analytics.status).toBe('stub');
            expect(info.services.analytics.handlerReady).toBe(false);
            // …and the advertisement matches what the route actually does:
            // `handled: false`, which the caller answers with the 404.
            const result = await dispatcher.dispatch('POST', '/analytics/query', { cube: 'leads', measures: ['count'] }, {}, { request: {} });
            expect(result.handled).toBe(false);
        });

        it('keeps reporting unmarked services as available', async () => {
            (kernel as any).getService = vi.fn().mockImplementation((name: string) => {
                if (name === 'workflow') return { getConfig: vi.fn() };
                return null;
            });

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.services.workflow.enabled).toBe(true);
            expect(info.services.workflow.status).toBe('available');
            expect(info.services.workflow.handlerReady).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // [#4058] handlerReady across the REST of the service domains
    //
    // #4000 executed ADR-0076 D12 conclusion 3 for `analytics` alone; the other
    // domains kept gating on "is the slot occupied", so a self-declared stub in
    // any of them was still called like a real implementation. These pin the
    // class-wide rule and, just as importantly, its limit: `degraded` — an
    // implementation that really serves with reduced capability — is NOT
    // affected. A single predicate decides both (`service-serveable.ts`), so the
    // route/feature advertisement and the handler cannot disagree.
    // ═══════════════════════════════════════════════════════════════

    describe('handlerReady gating across service domains (D12 / #4058)', () => {
        /** A fake that fabricates: every method answers, none does the work. */
        const stubbed = (methods: Record<string, any>) => ({
            __serviceInfo: { status: 'stub', message: 'dev fake' },
            ...methods,
        });
        /** A fake that really does the work in memory — `handlerReady` defaults true. */
        const degraded = (methods: Record<string, any>) => ({
            __serviceInfo: { status: 'degraded', message: 'in-memory' },
            ...methods,
        });

        const serveOnly = (name: string, svc: unknown) => {
            (kernel as any).getService = vi.fn().mockImplementation((n: string) => (n === name ? svc : null));
            (kernel as any).services = new Map([[name, svc]]);
        };

        // The sharpest case in the class: `execute` reported `{ success: true }`
        // for a flow that never ran, and the domain served it as a 200 — a
        // caller (or an agent) read "flow executed" off nothing happening.
        it('/automation — a stub slot is an empty slot, and is never called', async () => {
            const stub = stubbed({
                execute: vi.fn().mockResolvedValue({ success: true, output: undefined, durationMs: 0 }),
                trigger: vi.fn().mockResolvedValue({ success: true }),
                listFlows: vi.fn().mockResolvedValue([]),
                registerFlow: vi.fn(),
            });
            serveOnly('automation', stub);

            for (const [path, method] of [['', 'GET'], ['', 'POST'], ['trigger/x', 'POST'], ['x/trigger', 'POST']] as const) {
                const result = await dispatcher.handleAutomation(path, method, { name: 'x' }, { request: {} });
                expect(result.handled, `${method} /automation/${path}`).toBe(false);
            }
            expect(stub.execute).not.toHaveBeenCalled();
            expect(stub.trigger).not.toHaveBeenCalled();
            expect(stub.listFlows).not.toHaveBeenCalled();
            expect(stub.registerFlow).not.toHaveBeenCalled();
        });

        it('/automation — a degraded engine keeps serving', async () => {
            const svc = degraded({ listFlows: vi.fn().mockResolvedValue(['flow_a']) });
            serveOnly('automation', svc);

            const result = await dispatcher.handleAutomation('', 'GET', {}, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.body?.data?.flows).toEqual(['flow_a']);
        });

        // Storage answers 501 for an empty slot rather than `handled: false`, so
        // "same answer as an empty slot" means the same 501 here.
        it('/storage — a stub slot answers the not-configured 501 without being called', async () => {
            const stub = stubbed({ upload: vi.fn(), download: vi.fn() });
            serveOnly('file-storage', stub);

            const result = await dispatcher.handleStorage('upload', 'POST', { name: 'f.txt' }, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(501);
            expect(stub.upload).not.toHaveBeenCalled();
        });

        // The half that protects plugin-dev's in-memory file store: it really
        // stores and really reads back, so it declares `degraded` and serves.
        it('/storage — a degraded in-memory store keeps serving', async () => {
            const svc = degraded({ upload: vi.fn().mockResolvedValue({ key: 'f.txt' }) });
            serveOnly('file-storage', svc);

            const result = await dispatcher.handleStorage('upload', 'POST', { name: 'f.txt' }, { request: {} });
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(svc.upload).toHaveBeenCalled();
        });

        it('/i18n — a stub slot answers the not-available 501; a degraded provider serves', async () => {
            const stub = stubbed({ getLocales: vi.fn().mockReturnValue(['xx']) });
            serveOnly('i18n', stub);
            const stubResult = await dispatcher.handleI18n('/locales', 'GET', {}, { request: {} });
            expect(stubResult.response?.status).toBe(501);
            expect(stub.getLocales).not.toHaveBeenCalled();

            const svc = degraded({
                getLocales: vi.fn().mockReturnValue(['en']),
                getDefaultLocale: vi.fn().mockReturnValue('en'),
            });
            serveOnly('i18n', svc);
            const okResult = await dispatcher.handleI18n('/locales', 'GET', {}, { request: {} });
            expect(okResult.response?.status).toBe(200);
            expect(svc.getLocales).toHaveBeenCalled();
        });

        // The inbox surface was already protected by accident — the `listInbox`
        // duck-type kept `send`-only fakes out. Now it is protected on purpose,
        // so a stub that grows a `listInbox` stays out too.
        it('/notifications — a stub slot is an empty slot even when it implements listInbox', async () => {
            const stub = stubbed({
                listInbox: vi.fn().mockResolvedValue({ messages: [] }),
                send: vi.fn().mockResolvedValue({ success: true, messageId: 'x' }),
            });
            serveOnly('notification', stub);

            const result = await dispatcher.handleNotification('', 'GET', undefined, {}, {
                request: {}, executionContext: { userId: 'usr_1' },
            } as any);
            expect(result.handled).toBe(false);
            expect(stub.listInbox).not.toHaveBeenCalled();
        });

        // Being truthy, a stub used to fall through to the `!routes` 503 — which
        // reads as a fault AND loses the empty-list courtesy the console's
        // per-navigation `GET /ai/agents` poll depends on. Treating it as an
        // empty slot restores both.
        it('/ai — a stub slot 404s per route and keeps the /ai/agents empty list', async () => {
            const stub = stubbed({ chat: vi.fn(), listModels: vi.fn() });
            serveOnly('ai', stub);

            const chat = await dispatcher.handleAI('/ai/chat', 'POST', { messages: [] }, {}, { request: {} });
            expect(chat.handled).toBe(true);
            expect(chat.response?.status).toBe(404);
            expect(stub.chat).not.toHaveBeenCalled();

            const agents = await dispatcher.handleAI('/ai/agents', 'GET', undefined, {}, { request: {} });
            expect(agents.handled).toBe(true);
            expect(agents.response?.status).toBe(200);
            expect(agents.response?.body).toEqual({ agents: [] });
        });

        // Discovery must say exactly what the domains do — one predicate feeds
        // both. `services.*` deliberately stays presence-gated: a registered
        // stub self-reporting `status: 'stub'` says strictly more than
        // `unavailable` / "install a plugin" would.
        it('stops advertising routes/features for stub slots, while still reporting them as stubs', async () => {
            const stubs: Record<string, unknown> = {
                'file-storage': stubbed({ upload: vi.fn() }),
                automation:     stubbed({ execute: vi.fn() }),
                notification:   stubbed({ send: vi.fn() }),
                ai:             stubbed({ chat: vi.fn() }),
                i18n:           stubbed({ getLocales: vi.fn().mockReturnValue([]) }),
            };
            (kernel as any).getService = vi.fn().mockImplementation((n: string) => stubs[n] ?? null);
            (kernel as any).services = new Map(Object.entries(stubs));

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            for (const key of ['storage', 'automation', 'notifications', 'ai', 'i18n'] as const) {
                expect(info.routes[key], `routes.${key}`).toBeUndefined();
            }
            for (const key of ['files', 'ai', 'notifications', 'i18n'] as const) {
                expect(info.features[key], `features.${key}`).toBe(false);
            }
            for (const key of ['file-storage', 'automation', 'notification', 'ai', 'i18n'] as const) {
                expect(info.services[key].enabled, `services.${key}.enabled`).toBe(true);
                expect(info.services[key].status, `services.${key}.status`).toBe('stub');
                expect(info.services[key].handlerReady, `services.${key}.handlerReady`).toBe(false);
                expect(info.services[key].route, `services.${key}.route`).toBeUndefined();
            }
        });

        it('keeps advertising routes/features for degraded slots that really serve', async () => {
            const degradeds: Record<string, unknown> = {
                'file-storage': degraded({ upload: vi.fn() }),
                automation:     degraded({ listFlows: vi.fn() }),
                notification:   degraded({ listInbox: vi.fn() }),
                ai:             degraded({ chat: vi.fn() }),
                i18n:           degraded({ getLocales: vi.fn().mockReturnValue(['en']), getDefaultLocale: vi.fn().mockReturnValue('en') }),
            };
            (kernel as any).getService = vi.fn().mockImplementation((n: string) => degradeds[n] ?? null);
            (kernel as any).services = new Map(Object.entries(degradeds));

            const info = await dispatcher.getDiscoveryInfo('/api/v1');
            expect(info.routes.storage).toBe('/api/v1/storage');
            expect(info.routes.automation).toBe('/api/v1/automation');
            expect(info.routes.notifications).toBe('/api/v1/notifications');
            expect(info.routes.ai).toBe('/api/v1/ai');
            expect(info.routes.i18n).toBe('/api/v1/i18n');
            expect(info.features.files).toBe(true);
            expect(info.features.i18n).toBe(true);
            expect(info.services['file-storage'].status).toBe('degraded');
            expect(info.services['file-storage'].handlerReady).toBe(true);
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
            expect(localesResult.response?.body?.data?.locales.map((l: any) => l.code)).toEqual(['en', 'de']);

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
            const context = { request: {}, executionContext: { userId: 'u1' } };
            const result = await minimalDispatcher.handleMetadata('', context, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(result.response?.body?.data?.types).toContain('object');
        });

        it('GET /meta/types should return default types with minimal kernel', async () => {
            const context = { request: {}, executionContext: { userId: 'u1' } };
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

            const context = { request: {}, executionContext: { userId: 'u1' } };
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

            const context = { request: {}, executionContext: { userId: 'u1' } };
            const result = await minimalDispatcher.handleMetadata('/objects/account', context, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(mockRegistry.registry.getObject).toHaveBeenCalledWith('account');
        });

        it('GET /meta/:type/:name/published should return 404 when metadata service is unavailable', async () => {
            const context = { request: {}, executionContext: { userId: 'u1' } };
            const result = await minimalDispatcher.handleMetadata('/object/my_obj/published', context, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(404);
        });

        it('PUT /meta/:type/:name should return 501 when protocol is unavailable', async () => {
            const context = { request: {}, executionContext: { userId: 'u1' } };
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

            const context = { request: {}, executionContext: { userId: 'u1' } };
            const result = await minimalDispatcher.handleMetadata('/types', context, 'GET');
            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(200);
            expect(mockProtocolLocal.getMetaTypes).toHaveBeenCalled();
            expect(result.response?.body?.data?.types).toContain('custom_type');
        });
    });

    // NOTE (ADR-0006 Phase 5): the `resolveEnvironmentContext` suite that
    // lived here moved with the behavior — environment resolution is owned
    // by the host's KernelResolver now. Equivalent coverage:
    //   cloud packages/objectos-runtime/src/kernel-resolver.test.ts


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
            // [#3842] Was `details.type` — the only site using that spelling,
            // parked there because `error.code` held the status. `details` keeps
            // the two genuine context fields.
            expect(result.body.error.code).toBe('PROJECT_MEMBERSHIP_REQUIRED');
            expect(result.body.error.details).toEqual({
                environmentId: 'proj-private',
                userId: 'user-1',
            });
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


describe('HttpDispatcher — ADR-0066 D4 action requiredPermissions gate', () => {
  // `type: 'script'` (with a handler `target`) is what this fixture needs: the
  // gate is type-agnostic, but since #3915 the route dispatches on the declared
  // type, and a `type: 'api'` action never reaches `executeAction` at all — it
  // dispatches on `target`, at another endpoint. The permitted cases below
  // assert the handler DID run, so the declaration has to be a dispatchable one.
  const gated = { name: 'issue_and_sign', label: 'Issue', type: 'script', target: 'issueAndSign', requiredPermissions: ['manage_platform_settings'] };
  const make = (actionDef: any, execCtx: any) => {
    const executeAction = vi.fn().mockResolvedValue({ ran: true });
    const schemaOf = (name: string) => ({ name, actions: actionDef ? [actionDef] : [] });
    const ql: any = {
      executeAction,
      getSchema: schemaOf,
      // getObjectQLService only returns a service when `svc.registry` is truthy.
      registry: { getObject: schemaOf },
      find: vi.fn().mockResolvedValue([]),
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const kernel: any = { context: { getService: (n: string) => (n === 'objectql' ? ql : null) } };
    const dispatcher = new HttpDispatcher(kernel);
    const ctx: any = { request: {}, environmentId: 'platform', executionContext: execCtx };
    return { dispatcher, executeAction, ctx };
  };

  it('rejects (403) when the caller lacks the action capability', async () => {
    const { dispatcher, executeAction, ctx } = make(gated, { userId: 'u1', systemPermissions: [] });
    const res = await dispatcher.handleActions('/sys_license/issue_and_sign', 'POST', {}, ctx);
    expect(res.response.status).toBe(403);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('allows when the caller holds the capability', async () => {
    const { dispatcher, executeAction, ctx } = make(gated, { userId: 'u1', systemPermissions: ['manage_platform_settings'] });
    const res = await dispatcher.handleActions('/sys_license/issue_and_sign', 'POST', {}, ctx);
    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(res.response.status).not.toBe(403);
  });

  it('bypasses the gate for a system context', async () => {
    const { dispatcher, executeAction, ctx } = make(gated, { isSystem: true });
    await dispatcher.handleActions('/sys_license/issue_and_sign', 'POST', {}, ctx);
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it('does not gate an action without requiredPermissions', async () => {
    const { dispatcher, executeAction, ctx } = make({ name: 'mark_done', label: 'Mark', type: 'script', execute: 'true' }, { userId: 'u1', systemPermissions: [] });
    await dispatcher.handleActions('/task/mark_done', 'POST', {}, ctx);
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it('denies an unauthenticated caller for a gated action', async () => {
    const { dispatcher, executeAction, ctx } = make(gated, undefined);
    const res = await dispatcher.handleActions('/sys_license/issue_and_sign', 'POST', {}, ctx);
    expect(res.response.status).toBe(403);
    expect(executeAction).not.toHaveBeenCalled();
  });
});

describe('HttpDispatcher — action body ctx.user identity (#2701)', () => {
  // The action body sandbox must see the SESSION operator (id + business
  // roles), resolved from the request's ExecutionContext — the same envelope
  // `dispatch()` populates and that the MCP / record-change paths already read.
  // Pre-#2701 the fallback chain read `_context.user` / `_context.userId`
  // (fields HttpProtocolContext never carries) and hard-fell to `system`, so
  // every action ran blind to who invoked it.
  const captureCtx = (execCtx: any) => {
    const executeAction = vi.fn(async () => ({ ok: true }));
    const schemaOf = (name: string) => ({
      name,
      actions: [{ name: 'convert', label: 'Convert', type: 'script', execute: 'true' }],
    });
    const ql: any = {
      executeAction,
      getSchema: schemaOf,
      registry: { getObject: schemaOf },
      find: vi.fn().mockResolvedValue([]),
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const kernel: any = { context: { getService: (n: string) => (n === 'objectql' ? ql : null) } };
    const dispatcher = new HttpDispatcher(kernel);
    const ctx: any = { request: {}, environmentId: 'platform', executionContext: execCtx };
    return { dispatcher, executeAction, ctx };
  };

  const actionUser = (executeAction: any) => executeAction.mock.calls[0]?.[2]?.user;
  const actionSession = (executeAction: any) => executeAction.mock.calls[0]?.[2]?.session;

  it('forwards the session user id + business roles to the action body (not `system`)', async () => {
    const { dispatcher, executeAction, ctx } = captureCtx({
      userId: 'user_42',
      positions: ['sales_rep', 'org_member'],
      permissions: ['convert_lead'],
      email: 'rep@acme.test',
      tenantId: 'org_acme',
    });
    await dispatcher.handleActions('/lead/convert', 'POST', {}, ctx);
    const user = actionUser(executeAction);
    expect(user.id).toBe('user_42');
    expect(user.roles).toEqual(['sales_rep', 'org_member']);
    expect(user.positions).toEqual(['sales_rep', 'org_member']);
    expect(user.permissions).toEqual(['convert_lead']);
    expect(user.email).toBe('rep@acme.test');
    // #3280 made `organizationId` the blessed name; the `tenantId` alias was
    // removed in v11 (#3290) and must no longer be emitted on ctx.user.
    expect(user.organizationId).toBe('org_acme');
    expect(user.tenantId).toBeUndefined();
  });

  it('exposes ctx.session.organizationId and no longer emits the removed tenantId alias to the action body (#3290)', async () => {
    const { dispatcher, executeAction, ctx } = captureCtx({
      userId: 'user_42',
      positions: ['sales_rep'],
      tenantId: 'org_acme',
    });
    await dispatcher.handleActions('/lead/convert', 'POST', {}, ctx);
    const session = actionSession(executeAction);
    expect(session).toBeDefined();
    expect(session.userId).toBe('user_42');
    expect(session.organizationId).toBe('org_acme');
    expect(session.tenantId).toBeUndefined();
  });

  it('falls back to a `system` principal only when the request is anonymous', async () => {
    const { dispatcher, executeAction, ctx } = captureCtx(undefined);
    await dispatcher.handleActions('/lead/convert', 'POST', {}, ctx);
    const user = actionUser(executeAction);
    expect(user.id).toBe('system');
    expect(user.roles).toEqual([]);
    expect(user.positions).toEqual([]);
    // No resolved caller → no session (parity with the hook surface).
    expect(actionSession(executeAction)).toBeUndefined();
  });

  it('sources identity from executionContext, ignoring a stray `_context.user` (regression guard)', async () => {
    // HttpProtocolContext carries no `user`/`userId`; a caller must not be able
    // to spoof identity by stuffing one on. The resolved session is the one source.
    const { dispatcher, executeAction, ctx } = captureCtx({ userId: 'ec_user', positions: ['viewer'] });
    (ctx as any).user = { id: 'spoofed' };
    (ctx as any).userId = 'spoofed_2';
    await dispatcher.handleActions('/lead/convert', 'POST', {}, ctx);
    expect(actionUser(executeAction).id).toBe('ec_user');
  });

  it('resolves the session end-to-end: dispatch(/actions/…) threads the authenticated principal into ctx.user', async () => {
    // Full pipeline: an api-key request → dispatch() → resolveExecutionContext →
    // handleActions. This is the path registerActionRoutes now takes (it calls
    // `dispatch('POST', '/actions/…')`) — the identity resolution that was
    // bypassed pre-#2701, when the action route called handleActions directly.
    const rows: any[] = [];
    const executeAction = vi.fn(async () => ({ ok: true }));
    const schemaOf = (name: string) => ({ name, actions: [{ name: 'convert', label: 'C', type: 'script', execute: 'true' }] });
    const ql: any = {
      executeAction,
      getSchema: schemaOf,
      registry: { getObject: schemaOf },
      insert: async (_o: string, data: any) => { const id = `key_${rows.length + 1}`; rows.push({ id, ...data }); return { id }; },
      find: async (obj: string, opts: any) => {
        const where = opts?.where ?? {};
        if (obj !== 'sys_api_key') return [];
        return rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
      },
      update: async () => ({}), delete: async () => ({}),
    };
    const kernel: any = {
      getService: (n: string) => (n === 'objectql' ? ql : undefined),
      getServiceAsync: async (n: string) => (n === 'objectql' ? ql : undefined),
      context: { getService: (n: string) => (n === 'objectql' ? ql : undefined) },
    };
    const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });

    // Mint an api key bound to `user_9`, then invoke an action authenticated by it.
    const mint = await dispatcher.handleKeys('POST', { name: 'agent' }, {
      request: { headers: {} }, executionContext: { userId: 'user_9', positions: [], permissions: [] },
    } as any);
    const raw = mint.response.body.data.key;

    await dispatcher.dispatch('POST', '/actions/lead/convert', {}, {}, {
      request: { headers: { 'x-api-key': raw } },
    } as any);

    const user = executeAction.mock.calls[0]?.[2]?.user;
    expect(user?.id).toBe('user_9'); // was `system` before the fix — the route bypassed dispatch()
  });
});

describe('HttpDispatcher — MCP action bridge (list_actions / run_action)', () => {
  // A `todo_task` object with declarative actions, mirroring examples/app-todo:
  //  - complete_task: script bound to the `completeTask` handler (row-context)
  //  - issue_license: script gated behind a capability (ADR-0066 D4)
  //  - defer_task: modal (UI-only, no headless dispatch)
  const completeAction = {
    name: 'complete_task',
    label: 'Mark Complete',
    objectName: 'todo_task',
    type: 'script',
    target: 'completeTask', // handler key differs from the declarative name
    locations: ['record_header', 'list_item'],
    ai: { exposed: true, description: 'Mark a todo task as complete.' },
  };
  const gatedAction = {
    name: 'issue_license',
    label: 'Issue',
    objectName: 'todo_task',
    type: 'script',
    target: 'issueLicense',
    requiredPermissions: ['manage_platform_settings'],
    ai: { exposed: true, description: 'Issue a license for the current tenant.' },
  };
  const modalAction = {
    name: 'defer_task',
    label: 'Defer',
    objectName: 'todo_task',
    type: 'modal',
    target: 'defer_modal',
  };
  // Invokable script the author did NOT expose to AI (`ai.exposed` absent) —
  // must be invisible + fail-closed on the MCP surface (#2849).
  const unexposedAction = {
    name: 'internal_cleanup',
    label: 'Internal Cleanup',
    objectName: 'todo_task',
    type: 'script',
    target: 'internalCleanup',
  };
  const todoObject = {
    name: 'todo_task',
    label: 'Task',
    fields: { subject: { type: 'text', label: 'Subject' }, status: { type: 'select', label: 'Status' } },
    actions: [completeAction, gatedAction, modalAction, unexposedAction],
  };
  // A system object carrying an action — must be hidden + fail-closed.
  const sysObject = {
    name: 'sys_api_key',
    label: 'API Key',
    actions: [{ name: 'rotate', type: 'script', target: 'rotate', objectName: 'sys_api_key' }],
  };

  const makeBridge = (execCtx: any) => {
    const store: Record<string, any> = { t1: { id: 't1', subject: 'A', status: 'open' } };
    const executeAction = vi.fn(async (obj: string, key: string, ctx: any) => {
      if (key === 'completeTask') {
        const id = ctx?.record?.id ?? ctx?.params?.recordId;
        if (store[id]) store[id].status = 'completed';
        return { updated: id };
      }
      if (key === 'issueLicense') return { issued: true };
      throw new Error(`Action '${key}' on object '${obj}' not found`);
    });
    const ql: any = {
      executeAction,
      registry: { getObject: (n: string) => (n === 'todo_task' ? todoObject : null) },
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      find: vi.fn(async (_o: string, opts: any) => {
        const id = opts?.where?.id;
        return id && store[id] ? [store[id]] : [];
      }),
    };
    const metadata: any = {
      listObjects: vi.fn(async () => [todoObject, sysObject]),
      getObject: vi.fn(async (n: string) =>
        n === 'todo_task' ? todoObject : n === 'sys_api_key' ? sysObject : undefined,
      ),
    };
    const kernel: any = {
      context: {
        getService: (n: string) => (n === 'objectql' ? ql : n === 'metadata' ? metadata : null),
      },
    };
    const dispatcher = new HttpDispatcher(kernel);
    const ctx: any = { request: {}, environmentId: 'platform', executionContext: execCtx };
    const bridge = (dispatcher as any).buildMcpBridge(ctx);
    return { bridge, executeAction, store };
  };

  it('list_actions returns only AI-exposed, invokable, permitted, non-system actions', async () => {
    const { bridge } = makeBridge({ userId: 'u1', systemPermissions: [] });
    const names = (await bridge.listActions()).map((a: any) => a.name);
    expect(names).toContain('complete_task'); // script + exposed + permitted
    expect(names).not.toContain('issue_license'); // gated, caller lacks the capability
    expect(names).not.toContain('defer_task'); // modal = UI-only, no headless path
    expect(names).not.toContain('internal_cleanup'); // ai.exposed absent → hidden (#2849)
    expect(names).not.toContain('rotate'); // sys_api_key → hidden fail-closed
  });

  // [#2849 / ADR-0011] The AI-exposure gate is the real agent-facing boundary:
  // action bodies run TRUSTED (context-less engine, RLS/FLS-bypassing), so an
  // action the author never opted into the AI surface must be uninvokable —
  // fail-closed, never reaching the handler.
  it('run_action refuses an action the author did not expose to AI (ai.exposed absent)', async () => {
    const { bridge, executeAction } = makeBridge({ userId: 'u1', systemPermissions: [] });
    await expect(bridge.runAction('internal_cleanup', { recordId: 't1' })).rejects.toThrow(/not exposed to AI/i);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('run_action refuses an unexposed action even for an AGENT holding every capability', async () => {
    const { bridge, executeAction } = makeBridge({
      userId: 'u1', principalKind: 'agent', onBehalfOf: { userId: 'u1' },
      systemPermissions: ['manage_platform_settings'],
    });
    await expect(bridge.runAction('internal_cleanup', { recordId: 't1' })).rejects.toThrow(/not exposed to AI/i);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('list_actions surfaces record-context + summary metadata', async () => {
    const { bridge } = makeBridge({ userId: 'u1', systemPermissions: [] });
    const complete = (await bridge.listActions()).find((a: any) => a.name === 'complete_task');
    expect(complete).toMatchObject({ objectName: 'todo_task', type: 'script', requiresRecord: true });
    expect(complete.description).toMatch(/complete/i);
  });

  it('list_actions reveals a gated action once the caller holds the capability', async () => {
    const { bridge } = makeBridge({ userId: 'u1', systemPermissions: ['manage_platform_settings'] });
    const names = (await bridge.listActions()).map((a: any) => a.name);
    expect(names).toContain('issue_license');
  });

  it('run_action dispatches a script action via executeAction using its target handler key', async () => {
    const { bridge, executeAction, store } = makeBridge({ userId: 'u1', systemPermissions: [] });
    const res = await bridge.runAction('complete_task', { recordId: 't1' });
    expect(res.ok).toBe(true);
    expect(executeAction).toHaveBeenCalledWith(
      'todo_task',
      'completeTask', // the action's target, NOT its declarative name
      expect.objectContaining({
        record: expect.objectContaining({ id: 't1' }),
        params: expect.objectContaining({ recordId: 't1', objectName: 'todo_task' }),
      }),
    );
    expect(store.t1.status).toBe('completed'); // the handler actually ran
  });

  it('run_action enforces the ADR-0066 D4 capability gate (throws, never dispatches)', async () => {
    const { bridge, executeAction } = makeBridge({ userId: 'u1', systemPermissions: [] });
    await expect(bridge.runAction('issue_license', {})).rejects.toThrow(/requires capability/i);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('run_action allows a gated action for a holder of the capability', async () => {
    const { bridge, executeAction } = makeBridge({ userId: 'u1', systemPermissions: ['manage_platform_settings'] });
    const res = await bridge.runAction('issue_license', {});
    expect(res.ok).toBe(true);
    expect(executeAction).toHaveBeenCalledWith('todo_task', 'issueLicense', expect.anything());
  });

  // [ADR-0090 D10 #2] An MCP agent acting on behalf of a user carries the user's
  // action capabilities (delegated by the `actions:execute` scope — the producer
  // populates `systemPermissions` accordingly). The action gate is identity-
  // agnostic, so a gated action the user can run is invokable by the agent; an
  // agent whose scope did not delegate the capability is denied.
  it('run_action allows a gated action for an AGENT that inherited the delegating user\'s capability', async () => {
    const { bridge, executeAction } = makeBridge({
      userId: 'u1', principalKind: 'agent', onBehalfOf: { userId: 'u1' },
      systemPermissions: ['manage_platform_settings'],
    });
    const res = await bridge.runAction('issue_license', {});
    expect(res.ok).toBe(true);
    expect(executeAction).toHaveBeenCalledWith('todo_task', 'issueLicense', expect.anything());
  });

  it('run_action denies a gated action for an AGENT that did NOT inherit the capability (no actions:execute)', async () => {
    const { bridge, executeAction } = makeBridge({
      userId: 'u1', principalKind: 'agent', onBehalfOf: { userId: 'u1' },
      systemPermissions: [],
    });
    await expect(bridge.runAction('issue_license', {})).rejects.toThrow(/requires capability/i);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('run_action blocks system-object actions fail-closed (even for a system context)', async () => {
    const { bridge, executeAction } = makeBridge({ isSystem: true });
    await expect(bridge.runAction('rotate', { objectName: 'sys_api_key' })).rejects.toThrow(/system object/i);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('run_action rejects an unknown action name', async () => {
    const { bridge } = makeBridge({ userId: 'u1', systemPermissions: [] });
    await expect(bridge.runAction('nope', {})).rejects.toThrow(/not found/i);
  });

  it('run_action refuses a UI-only (modal) action', async () => {
    const { bridge } = makeBridge({ userId: 'u1', systemPermissions: [] });
    await expect(bridge.runAction('defer_task', { recordId: 't1' })).rejects.toThrow(/cannot be invoked/i);
  });

  // ── flow dispatch (type:'flow' → automation flow runner) ──
  const flowAction = {
    name: 'escalate_ticket',
    label: 'Escalate',
    objectName: 'todo_task',
    type: 'flow',
    target: 'escalation_flow',
    locations: ['record_header'],
    ai: { exposed: true, description: 'Escalate a ticket to the on-call team.' },
  };
  const makeFlowBridge = (execCtx: any, automation: any) => {
    const flowObject = { ...{ name: 'todo_task', label: 'Task', fields: {} }, actions: [flowAction] };
    const ql: any = {
      executeAction: vi.fn(),
      registry: { getObject: () => flowObject },
      find: vi.fn(async () => []),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const metadata: any = {
      listObjects: vi.fn(async () => [flowObject]),
      getObject: vi.fn(async () => flowObject),
    };
    const kernel: any = {
      context: {
        getService: (n: string) =>
          n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : n === 'automation' ? automation : null,
      },
    };
    const dispatcher = new HttpDispatcher(kernel);
    const ctx: any = { request: {}, environmentId: 'platform', executionContext: execCtx };
    return { bridge: (dispatcher as any).buildMcpBridge(ctx), ql };
  };

  it('list_actions includes a flow action only when an automation service is present', async () => {
    const withAuto = makeFlowBridge({ userId: 'u1', systemPermissions: [] }, { execute: vi.fn() });
    expect((await withAuto.bridge.listActions()).map((a: any) => a.name)).toContain('escalate_ticket');
    const noAuto = makeFlowBridge({ userId: 'u1', systemPermissions: [] }, null);
    expect((await noAuto.bridge.listActions()).map((a: any) => a.name)).not.toContain('escalate_ticket');
  });

  it('run_action dispatches a flow action through the automation flow runner', async () => {
    const execute = vi.fn(async () => ({ success: true, output: { escalated: true } }));
    const { bridge, ql } = makeFlowBridge({ userId: 'u1', systemPermissions: [] }, { execute });
    const res = await bridge.runAction('escalate_ticket', { recordId: 't1', params: { reason: 'sla' } });
    expect(res.ok).toBe(true);
    expect(ql.executeAction).not.toHaveBeenCalled(); // flow path, not executeAction
    // A proper AutomationContext (not the former `triggerData` envelope the
    // engine never read): record + object + explicit params (winning on clash).
    expect(execute).toHaveBeenCalledWith(
      'escalation_flow',
      expect.objectContaining({
        record: expect.objectContaining({ id: 't1' }),
        object: 'todo_task',
        params: expect.objectContaining({ reason: 'sla' }),
      }),
    );
  });

  // [#2849 / ADR-0049] The caller's identity must reach the flow engine so a
  // `runAs:'user'` flow enforces RLS as the invoker instead of falling into the
  // user-less UNSCOPED (fail-open) path.
  it('run_action forwards the caller identity (userId/positions/tenantId) into the flow context', async () => {
    const execute = vi.fn(async () => ({ success: true }));
    const { bridge } = makeFlowBridge(
      { userId: 'u1', positions: ['support_rep'], tenantId: 'org_1', systemPermissions: [] },
      { execute },
    );
    await bridge.runAction('escalate_ticket', { recordId: 't1' });
    expect(execute).toHaveBeenCalledWith(
      'escalation_flow',
      expect.objectContaining({ userId: 'u1', positions: ['support_rep'], tenantId: 'org_1' }),
    );
  });

  it('run_action surfaces a flow failure as an error', async () => {
    const execute = vi.fn(async () => ({ success: false, error: 'boom' }));
    const { bridge } = makeFlowBridge({ userId: 'u1', systemPermissions: [] }, { execute });
    await expect(bridge.runAction('escalate_ticket', {})).rejects.toThrow(/boom/i);
  });

  // ── standalone authored `action` rows (#3010) ──
  // Studio-authored standalone `action` metadata items execute since #2608
  // (`resyncAuthoredActions` registers their body under the declarative name),
  // but the bridge used to read declarations only from `object.actions`, so
  // they were invisible to list_actions and unresolvable by run_action.
  const standaloneScoped = {
    name: 'archive_task',
    label: 'Archive',
    objectName: 'todo_task',
    type: 'script',
    body: { language: 'js', source: 'ctx.record.archived = true;' },
    locations: ['record_header'],
    params: [{ name: 'reason', type: 'text', required: true }],
    ai: { exposed: true, description: 'Archive a completed todo task.' },
  };
  const standaloneGlobal = {
    name: 'nightly_cleanup',
    label: 'Nightly Cleanup',
    type: 'script',
    body: { language: 'js', source: 'return 1;' },
    ai: { exposed: true, description: 'Purge stale drafts.' },
  };
  const standaloneUnexposed = {
    name: 'raw_reindex',
    objectName: 'todo_task',
    type: 'script',
    body: { language: 'js', source: 'return 1;' },
  };
  const standaloneOnSysObject = {
    name: 'rotate_all',
    objectName: 'sys_api_key',
    type: 'script',
    body: { language: 'js', source: 'return 1;' },
    ai: { exposed: true },
  };
  // Same key as the embedded `complete_task` declaration — the embedded one wins.
  const standaloneShadowing = {
    name: 'complete_task',
    objectName: 'todo_task',
    type: 'script',
    body: { language: 'js', source: 'return 1;' },
    ai: { exposed: true, description: 'SHADOW — must not surface.' },
  };

  const makeStandaloneBridge = (execCtx: any, standaloneRows: any[]) => {
    const executeAction = vi.fn(async (obj: string, key: string) => {
      if (obj === 'todo_task' && key === 'archive_task') return { archived: true };
      if (obj === 'global' && key === 'nightly_cleanup') return { purged: 3 };
      if (key === 'completeTask') return { updated: true };
      throw new Error(`Action '${key}' on object '${obj}' not found`);
    });
    const ql: any = {
      executeAction,
      registry: { getObject: (n: string) => (n === 'todo_task' ? todoObject : null) },
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
      find: vi.fn(async () => []),
    };
    const metadata: any = {
      listObjects: vi.fn(async () => [todoObject, sysObject]),
      getObject: vi.fn(async (n: string) => (n === 'todo_task' ? todoObject : undefined)),
      loadMany: vi.fn(async (type: string) => (type === 'action' ? standaloneRows : [])),
    };
    const kernel: any = {
      context: { getService: (n: string) => (n === 'objectql' ? ql : n === 'metadata' ? metadata : null) },
    };
    const dispatcher = new HttpDispatcher(kernel);
    const ctx: any = { request: {}, environmentId: 'platform', executionContext: execCtx };
    return { bridge: (dispatcher as any).buildMcpBridge(ctx), executeAction, metadata };
  };

  it('list_actions surfaces standalone authored rows — object-scoped and global — under the engine-key object name', async () => {
    const { bridge } = makeStandaloneBridge({ userId: 'u1', systemPermissions: [] }, [
      standaloneScoped, standaloneGlobal, standaloneUnexposed, standaloneOnSysObject,
    ]);
    const actions = await bridge.listActions();
    const archive = actions.find((a: any) => a.name === 'archive_task');
    expect(archive).toMatchObject({ objectName: 'todo_task', type: 'script' });
    expect(archive.params).toEqual([expect.objectContaining({ name: 'reason', required: true })]);
    expect(actions.find((a: any) => a.name === 'nightly_cleanup')).toMatchObject({ objectName: 'global' });
    const names = actions.map((a: any) => a.name);
    expect(names).not.toContain('raw_reindex'); // ai.exposed absent → hidden (#2849)
    expect(names).not.toContain('rotate_all'); // sys_* owner → hidden fail-closed
  });

  it('list_actions dedupes a standalone row that shadows an object-embedded declaration (embedded wins)', async () => {
    const { bridge } = makeStandaloneBridge({ userId: 'u1', systemPermissions: [] }, [standaloneShadowing]);
    const matches = (await bridge.listActions()).filter((a: any) => a.name === 'complete_task');
    expect(matches).toHaveLength(1);
    expect(matches[0].description).not.toMatch(/SHADOW/);
  });

  it('run_action dispatches a standalone body action under its declarative name key', async () => {
    const { bridge, executeAction } = makeStandaloneBridge({ userId: 'u1', systemPermissions: [] }, [standaloneScoped]);
    const res = await bridge.runAction('archive_task', { params: { reason: 'done' } });
    expect(res.ok).toBe(true);
    expect(executeAction).toHaveBeenCalledWith(
      'todo_task',
      'archive_task', // body-based → registered under the declarative name, not a target
      expect.objectContaining({ params: expect.objectContaining({ reason: 'done' }) }),
    );
  });

  it('run_action dispatches a standalone GLOBAL action under the global wildcard key', async () => {
    const { bridge, executeAction } = makeStandaloneBridge({ userId: 'u1', systemPermissions: [] }, [standaloneGlobal]);
    const res = await bridge.runAction('nightly_cleanup', {});
    expect(res.ok).toBe(true);
    expect(executeAction).toHaveBeenCalledWith('global', 'nightly_cleanup', expect.anything());
  });

  it('run_action refuses an unexposed standalone row and never dispatches', async () => {
    const { bridge, executeAction } = makeStandaloneBridge({ userId: 'u1', systemPermissions: [] }, [standaloneUnexposed]);
    await expect(bridge.runAction('raw_reindex', {})).rejects.toThrow(/not exposed to AI/i);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('run_action blocks a standalone row owned by a system object', async () => {
    const { bridge, executeAction } = makeStandaloneBridge({ userId: 'u1', systemPermissions: [] }, [standaloneOnSysObject]);
    await expect(bridge.runAction('rotate_all', {})).rejects.toThrow(/system object/i);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('the bridge tolerates a metadata service without loadMany (standalone source absent)', async () => {
    const { bridge } = makeBridge({ userId: 'u1', systemPermissions: [] }); // makeBridge's metadata mock has no loadMany
    const names = (await bridge.listActions()).map((a: any) => a.name);
    expect(names).toContain('complete_task');
  });
});
