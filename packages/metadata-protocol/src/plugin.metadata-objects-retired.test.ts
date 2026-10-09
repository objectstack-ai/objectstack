// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';

import { assembleMetadataProtocol } from './plugin.js';

/**
 * ADR-0131 D13 — `sys_view_definition` retired as inert: no framework writer or
 * reader of its rows ever existed (runtime-authored views are `view` items in
 * `sys_metadata`). These pins hold the protocol assembly — the one seam both
 * mounts share — to that, from the two places it used to carry the table:
 *
 *  1. the `com.objectstack.metadata-objects` registration provisions exactly
 *     the four metadata-storage objects;
 *  2. the `kernel:ready` repair hook issues no statement against the retired
 *     table (#5839's active-row index migration rode that hook).
 *
 * The SQL seam is a recording double on purpose: the claim is about which
 * statements the hook ISSUES, not about what a database answers. Each
 * migration that does run here answers its own refusal into a `warn`, which
 * the hook swallows by design; nothing below depends on that path.
 */
function assemble(options: { runPlatformMigrations?: boolean } = {}) {
    const registeredApps: Array<{ id: string; objects: Array<{ name: string }> }> = [];
    const hooks = new Map<string, Array<() => unknown>>();
    const statements: string[] = [];
    const execute = async (sql: string) => {
        statements.push(String(sql));
        return [];
    };
    const ql = {
        registerApp: (app: any) => registeredApps.push(app),
        driver: { execute, raw: execute, config: { client: 'better-sqlite3' } },
        getDriver: () => ({ execute, raw: execute, config: { client: 'better-sqlite3' } }),
    };
    const ctx = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: vi.fn(() => undefined),
        getServices: () => new Map(),
        hook: (name: string, handler: () => unknown) => {
            hooks.set(name, [...(hooks.get(name) ?? []), handler]);
        },
    } as any;

    assembleMetadataProtocol(ctx, ql, undefined, options);
    return { registeredApps, hooks, statements };
}

describe('the protocol assembly carries no sys_view_definition (ADR-0131 D13)', () => {
    it('registers exactly the four metadata-storage objects', () => {
        const { registeredApps } = assemble();
        const app = registeredApps.find((a) => a.id === 'com.objectstack.metadata-objects');
        expect(app, 'the metadata-objects registration must still happen on an unscoped kernel').toBeDefined();
        const names = app!.objects.map((o) => o.name);
        expect(names).not.toContain('sys_view_definition');
        expect([...names].sort()).toEqual([
            'sys_metadata',
            'sys_metadata_audit',
            'sys_metadata_commit',
            'sys_metadata_history',
        ]);
    });

    it('arms a kernel:ready repair hook that issues no statement against the retired table', async () => {
        const { hooks, statements } = assemble({ runPlatformMigrations: true });
        const ready = hooks.get('kernel:ready') ?? [];
        // Two handlers: the gated platform-table repairs, and the ungated
        // migration-plan registration. Anti-vacuity: the gated one must be here
        // and must reach the seam, or "no statement names the table" is true of
        // a hook that never ran.
        expect(ready.length).toBe(2);
        for (const handler of ready) await handler();
        expect(statements.length).toBeGreaterThan(0);
        expect(statements.filter((sql) => sql.includes('sys_view_definition'))).toEqual([]);
        expect(statements.filter((sql) => sql.includes('idx_sys_view_def'))).toEqual([]);
    });
});
