// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';

import { assembleMetadataProtocol } from './plugin.js';
import { NOTIFICATION_PREFERENCE_TABLE } from './migrations/notification-preference-identity-index.js';

/**
 * `ensureNotificationPreferenceIdentityIndex` is ARMED from the one assembly
 * both protocol mounts share, inside the `runPlatformMigrations`-gated
 * `kernel:ready` handler beside the `sys_setting` tightening — and only there.
 * The migration itself is pinned in its own file; this pins the wiring, over a
 * recording seam (the claim is about which statements the hook issues).
 */
describe('armed from assembleMetadataProtocol, under runPlatformMigrations only', () => {
    /** The assembly over a recording seam; returns the statements each kernel:ready handler issued. */
    async function readyStatements(runPlatformMigrations: boolean): Promise<string[]> {
        const statements: string[] = [];
        const execute = async (sql: string) => {
            statements.push(String(sql));
            return [];
        };
        const driver = { execute, raw: execute, config: { client: 'better-sqlite3' } };
        const ql = { registerApp: () => {}, driver, getDriver: () => driver, getDriverForObject: () => driver };
        const hooks: Array<() => unknown> = [];
        const ctx = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            registerService: vi.fn(),
            getService: vi.fn(() => undefined),
            getServices: () => new Map(),
            hook: (name: string, handler: () => unknown) => {
                if (name === 'kernel:ready') hooks.push(handler);
            },
        } as any;
        assembleMetadataProtocol(ctx, ql, undefined, { runPlatformMigrations });
        for (const handler of hooks) await handler();
        return statements;
    }

    it('asks about sys_notification_preference at kernel:ready when the platform migrations are armed', async () => {
        const statements = await readyStatements(true);
        expect(statements.some((sql) => sql.includes(NOTIFICATION_PREFERENCE_TABLE))).toBe(true);
    });

    it('issues nothing against it when they are not (a per-project kernel)', async () => {
        const statements = await readyStatements(false);
        expect(statements.filter((sql) => sql.includes(NOTIFICATION_PREFERENCE_TABLE))).toEqual([]);
    });
});
