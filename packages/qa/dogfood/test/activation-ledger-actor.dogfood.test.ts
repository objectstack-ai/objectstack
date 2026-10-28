// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0126 §4] An administrator who switches a packaged artifact off is named
// on the record of it: the activation-ledger row (`created_by` / `updated_by`)
// and the audit row the write produces (`user_id` / `actor`).
//
// ## The measurement this file turns around
//
// Stock showcase, fresh database, signed in as the dev admin. Switching off a
// packaged action (`POST /api/v1/actions/_activation/:object/:action`), a
// declared position (`POST /api/v1/security/_activation/position/:name`) and a
// packaged flow (`POST /api/v1/automation/:name/toggle`) answered 200 and wrote
// the row — and all four actor fields read null. The doors wrote through the
// activation store's constant system context, which names nobody, so neither
// the engine's audit stamps nor the audit plugin had a user to record. The same
// request window's own sign-in rows did carry the admin's id.
//
// What only a boot can measure: the stamp lands through the REAL engine (the
// unit suites pin the context each door hands down, not what the engine does
// with it) and the audit row is the REAL audit plugin's, reading the same
// session. The showcase boot composes no audit plugin of its own, so this file
// adds `AuditPlugin`, as `objectstack serve` composes it.
//
// The flow door reaches the ledger through the automation service, not the
// engine: `IAutomationService.toggleFlow`'s `caller` carries the admin's id
// across that seam, so its case is the one that proves the id survives it.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { bootShowcase } from './showcase-boot.js';

const LEDGER = 'sys_metadata_activation';
const AUDIT = 'sys_audit_log';
/** Infrastructure rows, not tenant data — read the way the store reads them. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/** A real showcase action, shipped by the showcase package. */
const ACTION = 'showcase_mark_done';
const ACTION_OBJECT = 'showcase_task';
/** A position the showcase declares and nobody needs switched on during this file. */
const POSITION = 'auditor';
/** A packaged showcase flow that no other flow calls as a subflow, so the §7.3 guard never refuses it. */
const FLOW = 'showcase_scheduled_digest';

interface Engine {
    find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
}

describe('the activation ledger names the administrator who switched an item', () => {
    let stack: VerifyStack;
    let token: string;
    let adminId: string;
    let ql: Engine;

    beforeAll(async () => {
        stack = await bootShowcase({ extraPlugins: [new AuditPlugin()] });
        token = await stack.signIn();
        ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as Engine;
        const me: any = await (await stack.apiAs(token, 'GET', '/auth/get-session')).json();
        adminId = String(me?.user?.id ?? '');
    }, 120_000);

    afterAll(async () => {
        await stack?.stop();
    });

    const rowOf = async (type: string, name: string) => {
        const rows = await ql.find(LEDGER, { where: { metadata_type: type, name }, context: SYSTEM_CTX });
        expect(rows, `${LEDGER} rows for ${type} '${name}'`).toHaveLength(1);
        return rows[0];
    };

    /** The audit rows the ledger writes of ONE row produced, oldest first. */
    const auditRowsOf = async (recordId: unknown, count: number) => {
        let rows: Array<Record<string, unknown>> = [];
        await vi.waitFor(async () => {
            rows = await ql.find(AUDIT, {
                where: { object_name: LEDGER, record_id: String(recordId) },
                context: SYSTEM_CTX,
            });
            expect(rows.length, `audit rows for ${LEDGER} ${String(recordId)}`).toBeGreaterThanOrEqual(count);
        }, { timeout: 5_000 });
        return [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    };

    it('anti-vacuity: the signed-in admin has an id to be named by', () => {
        expect(adminId, 'get-session named no user — every assertion below would compare against nothing').toBeTruthy();
    });

    for (const door of [
        { label: 'a packaged action', type: 'action', name: ACTION, path: `/actions/_activation/${ACTION_OBJECT}/${ACTION}` },
        { label: 'a declared position', type: 'position', name: POSITION, path: `/security/_activation/position/${POSITION}` },
        { label: 'a packaged flow', type: 'flow', name: FLOW, path: `/automation/${FLOW}/toggle` },
    ] as const) {
        it(`${door.label}: switching it OFF names the admin on the row and on its audit row`, async () => {
            const res = await stack.apiAs(token, 'POST', door.path, { enabled: false });
            expect(res.status, `switch off answered ${res.status}: ${await res.clone().text()}`).toBe(200);

            const row = await rowOf(door.type, door.name);
            expect(row.active === false || row.active === 0).toBe(true);
            expect(row.created_by).toBe(adminId);
            expect(row.updated_by).toBe(adminId);

            const [created] = await auditRowsOf(row.id, 1);
            expect(created.action).toBe('create');
            expect(created.user_id).toBe(adminId);
            expect(created.actor).toBe(adminId);
        }, 30_000);

        it(`${door.label}: switching it back ON updates the row, and the update is the admin's too`, async () => {
            const res = await stack.apiAs(token, 'POST', door.path, { enabled: true });
            expect(res.status, `switch on answered ${res.status}: ${await res.clone().text()}`).toBe(200);

            const row = await rowOf(door.type, door.name);
            expect(row.active === true || row.active === 1).toBe(true);
            expect(row.updated_by).toBe(adminId);

            const audits = await auditRowsOf(row.id, 2);
            const updated = audits.find((a) => a.action === 'update');
            expect(updated, `no update audit row: ${JSON.stringify(audits)}`).toBeDefined();
            expect(updated!.user_id).toBe(adminId);
            expect(updated!.actor).toBe(adminId);
        }, 30_000);
    }
});
