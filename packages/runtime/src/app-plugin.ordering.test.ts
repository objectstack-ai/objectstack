// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AppPlugin ordering contract (ADR-0116 — the #4131 close of #4085).
 *
 * #4085's structural cause: AppPlugin resolves `manifest` + `objectql`
 * synchronously in init() but declared nothing, so its correctness depended
 * entirely on which slot the caller `use()`d it into. These tests boot REAL
 * kernels in the failure composition — AppPlugin registered BEFORE the
 * engine — and prove the declared contract makes slot position irrelevant:
 * the kernel hoists the engine (optionalDependencies), and a composition
 * with no manifest provider at all fails as a NAMED error, not a bare
 * "Service 'manifest' not found" from inside init.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { AppPlugin } from './app-plugin';

describe('AppPlugin ordering contract (#4085 / #4131)', () => {
    it('boots when use()d BEFORE the engine — the exact #4085 composition', async () => {
        const kernel = new LiteKernel({ logger: { level: 'error' } });
        kernel.use(new AppPlugin({ id: 'com.test.misordered', objects: [] })); // wrong slot, on purpose
        kernel.use(new ObjectQLPlugin({}));

        await kernel.bootstrap();

        // The engine was hoisted ahead, so init() found a live `manifest`
        // service and the app registered instead of crashing Phase 1.
        const ql = kernel.getService<{ registry: { getPackage(id: string): unknown } }>('objectql');
        expect(ql.registry.getPackage('com.test.misordered')).toBeTruthy();

        await kernel.shutdown();
    });

    it('an empty-env AppPlugin still boots on a bare kernel with no engine at all', async () => {
        const kernel = new LiteKernel({ logger: { level: 'error' } });
        kernel.use(new AppPlugin({})); // no app payload → empty no-op plugin
        await expect(kernel.bootstrap()).resolves.toBeUndefined();
        await kernel.shutdown();
    });

    it('a non-empty AppPlugin with no manifest provider fails NAMED, before init side effects', async () => {
        const kernel = new LiteKernel({ logger: { level: 'error' } });
        kernel.use(new AppPlugin({ id: 'com.test.orphan', objects: [] }));
        await expect(kernel.bootstrap()).rejects.toThrow(
            /requires service 'manifest' at init/,
        );
    });
});
