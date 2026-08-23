
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { HttpDispatcher } from './http-dispatcher';
import { ObjectKernel } from '@objectstack/core';

// [#10993] `version` on both the root ("") and `/discovery` payloads is no
// longer the literal '1.0.0' — it is `@objectstack/runtime`'s own resolved
// package version (no `OS_RUNTIME_VERSION` stamp injected below), read the
// same way the production code does so this assertion can never silently
// drift from what `resolveRuntimeVersion()` actually returns.
const RUNTIME_PACKAGE_VERSION = (
    createRequire(import.meta.url)('../package.json') as { version: string }
).version;

describe('HttpDispatcher Root Handling', () => {
    let kernel: ObjectKernel;
    let dispatcher: HttpDispatcher;

    beforeEach(() => {
        // No build stamp injected — these assertions exercise the package-
        // version FALLBACK path of resolveRuntimeVersion() (#10993).
        delete process.env.OS_RUNTIME_VERSION;

        // Mock minimal Kernel structure
        kernel = {
            services: {},
            context: {
                getService: vi.fn(),
            }
        } as any;

        dispatcher = new HttpDispatcher(kernel);
    });

    it('should handled GET request to root path ("") correctly', async () => {
        const context = { request: {} };
        const method = 'GET';
        // MSW passes empty string when stripping base URL
        const path = ''; 
        const body = undefined;
        const query = {};

        const result = await dispatcher.dispatch(method, path, body, query, context);

        expect(result.handled).toBe(true);
        expect(result.response).toBeDefined();
        expect(result.response?.status).toBe(200);
        
        const data = result.response?.body?.data;
        expect(data).toBeDefined();
        // getDiscoveryInfo returns 'name' not 'apiName'
        expect(data.name).toBe('ObjectOS');
        expect(data.version).toBe(RUNTIME_PACKAGE_VERSION);
        expect(data.routes).toBeDefined();
        // Since we passed empty prefix in dispatch code (hardcoded), routes should be relative
        expect(data.routes.metadata).toBe('/meta');
    });

    it('should handle GET /discovery (protocol-standard route)', async () => {
        const context = { request: {} };
        const result = await dispatcher.dispatch('GET', '/discovery', undefined, {}, context);

        expect(result.handled).toBe(true);
        expect(result.response).toBeDefined();
        expect(result.response?.status).toBe(200);
        
        const data = result.response?.body?.data;
        expect(data).toBeDefined();
        expect(data.name).toBe('ObjectOS');
        expect(data.version).toBe(RUNTIME_PACKAGE_VERSION);
        expect(data.routes).toBeDefined();
    });

    it('should return semantic 404 for POST request to root path ("")', async () => {
        const context = { request: {} };
        const method = 'POST';
        const path = '';
        
        const result = await dispatcher.dispatch(method, path, {}, {}, context);

        // The dispatcher now returns a typed 404 (ROUTE_NOT_FOUND) instead of { handled: false }
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(404);
        // [#3842] `ROUTE_NOT_FOUND` moved from `error.type` into `error.code`.
        expect(result.response?.body?.error?.code).toBe('ROUTE_NOT_FOUND');
    });
});
