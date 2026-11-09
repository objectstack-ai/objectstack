// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D8 rows R7, R8, R10, R20; epic #31527 child S3] The automation
// stored references gain the package that holds the item they name, and a
// dispatch key gains its flow's package — backfilled at `kernel:bootstrapped`
// on a real boot of the showcase, across restarts of one database file.
//
// ## What only a boot can measure
//
// The package suites pin the row rules and the key grammar on a real SQL
// engine and a real registry. What they cannot pin is the ORDER on a real
// boot (seat condition 1): a dispatch claim made during the boot — here by a
// probe plugin that starts after the automation service and claims without
// waiting — answers only once the boot's re-key has copied the in-retention
// bare-shape row to the scoped key, so it reads the window as claimed. With
// the ledger not held, the probe's claim lands first and mints the window a
// second time (the ablation reading is in the PR body).
//
//  - R10: a bare-shape key of a showcase flow, inside retention, gains its
//    `schedule:com.example.showcase:FLOW:WINDOW` copy with the same
//    `dispatched_at`; the bare row stays (the Reaper owns deletion); a key of a
//    flow nothing declares, and a key outside retention, are not copied;
//  - R8, R7, R20: a paused run, an open approval request and a legacy email
//    template row written with no package name the showcase package (a run, a
//    request) and the email service's baseline (a built-in template's name);
//  - a further boot writes no row.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

/** Infrastructure rows, not tenant data: written and read the way the platform's passes do. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));

const SHOWCASE = 'com.example.showcase';
const EMAIL = 'com.objectstack.service.email';
/** A scheduled showcase flow, and a time-relative one. */
const SCHEDULED = 'showcase_scheduled_digest';
const TIME_RELATIVE = 'showcase_task_due_reminder';
/** A showcase flow a paused run and an approval request name. */
const PAUSED_FLOW = 'showcase_task_follow_up';
const APPROVAL_FLOW = 'showcase_budget_approval';
/** A built-in template only the email service's baseline holds. */
const BUILTIN_TEMPLATE = 'auth.magic_link';
/** A name no package declares. */
const NOBODY = 'qa_s3_nothing_declares_this';

const DAY = 24 * 60 * 60 * 1000;
const yesterday = new Date(Date.now() - DAY).toISOString();
const longAgo = new Date(Date.now() - 40 * DAY).toISOString();
const WINDOW = '2026-11-08T06:00:00.000Z';
const OLD_WINDOW = '2026-09-01T06:00:00.000Z';

const BARE = `schedule:${SCHEDULED}:${WINDOW}`;
const SCOPED = `schedule:${SHOWCASE}:${SCHEDULED}:${WINDOW}`;
const BARE_TR = `time-relative:${TIME_RELATIVE}:2026-11-08:offset1:task_1`;
const SCOPED_TR = `time-relative:${SHOWCASE}:${TIME_RELATIVE}:2026-11-08:offset1:task_1`;
const BARE_NOBODY = `schedule:${NOBODY}:${WINDOW}`;
const BARE_OLD = `schedule:${SCHEDULED}:${OLD_WINDOW}`;

interface Engine {
    find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
    insert(object: string, data: unknown, options?: unknown): Promise<Record<string, unknown>>;
    update(object: string, data: unknown, options?: unknown): Promise<unknown>;
}

interface AutomationLedger {
    claim(key: string): Promise<boolean>;
    readDispatch(key: string): Promise<unknown | null>;
}

/**
 * Starts after the automation service and, in its own `start()`, claims the
 * scoped key and reads the time-relative one WITHOUT waiting — a trigger
 * firing during the boot. The answers are read after the boot.
 */
class FirstClaimProbe {
    name = 'com.objectstack.qa.s3-first-claim-probe';
    type = 'standard' as const;
    version = '1.0.0';
    dependencies = ['com.objectstack.service-automation'];
    claim?: Promise<boolean>;
    read?: Promise<unknown | null>;
    async init(): Promise<void> {}
    async start(ctx: { getService<T>(name: string): T }): Promise<void> {
        const automation = ctx.getService<AutomationLedger>('automation');
        this.claim = automation.claim(SCOPED);
        this.read = automation.readDispatch(SCOPED_TR);
    }
}

describe('automation references and dispatch keys name the package that holds them (SQL driver, one database file)', () => {
    let stack: VerifyStack | undefined;
    let prevCwd: string;
    let dir: string;
    let dbFile: string;
    let probe: FirstClaimProbe;
    let probeClaim: boolean | undefined;
    let probeRead: unknown;
    let oldCreatedAt: unknown;

    const engine = async () => (await stack!.kernel.getServiceAsync('objectql')) as unknown as Engine;
    const rowsOf = async (object: string, where: Record<string, unknown>) => (await engine()).find(object, { where, context: SYSTEM_CTX });
    const dispatchIds = async () => (await rowsOf('sys_flow_dispatch', {})).map((r) => String(r.id)).sort();

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-31684-'));
        dbFile = join(dir, 'showcase.db');
        stack = await bootShowcase({ databaseFile: dbFile });

        // Rows as a release before this change leaves them: bare keys, no package.
        const ql = await engine();
        const claim = (id: string, at: string, extra: Record<string, unknown> = {}) =>
            ql.insert('sys_flow_dispatch', { id, dispatched_at: at, created_at: at, ...extra }, { context: SYSTEM_CTX });
        await claim(BARE, yesterday, { outcome: 'succeeded', settled_at: yesterday });
        await claim(BARE_TR, yesterday);
        await claim(BARE_NOBODY, yesterday);
        await claim(BARE_OLD, longAgo);
        // The insert stamps `created_at`; the Reaper ages the ledger by it, so backdate it.
        await ql.update('sys_flow_dispatch', { id: BARE_OLD, created_at: longAgo }, { context: SYSTEM_CTX });
        oldCreatedAt = (await rowsOf('sys_flow_dispatch', { id: BARE_OLD }))[0]?.created_at;

        const org = (await rowsOf('sys_organization', {}))[0];
        const inOrg = { ...SYSTEM_CTX, tenantId: org?.id };
        await ql.insert('sys_automation_run', {
            id: 'qa_s3_paused_run', flow_name: PAUSED_FLOW, status: 'paused', started_at: yesterday, created_at: yesterday,
        }, { context: inOrg });
        await ql.insert('sys_approval_request', {
            id: 'qa_s3_open_request', process_name: `flow:${APPROVAL_FLOW}`, object_name: 'showcase_project', record_id: 'p_1',
            status: 'pending', organization_id: org?.id,
        }, { context: inOrg });
        await ql.insert('sys_email_template', {
            id: 'qa_s3_legacy_template', name: BUILTIN_TEMPLATE, label: 'Magic link', subject: 'Sign in', body_html: '<p>x</p>',
            locale: 'en-US', category: 'auth', active: true, organization_id: org?.id,
        }, { context: inOrg });

        await stack.stop();
        probe = new FirstClaimProbe();
        stack = await bootShowcase({ databaseFile: dbFile, extraPlugins: [probe] });
        probeClaim = await probe.claim;
        probeRead = await probe.read;
    }, 480_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('R10: a claim made during the boot answers after the re-key — the window is already claimed (seat condition 1)', () => {
        expect(probe.claim, 'the probe ran in the boot').toBeDefined();
        expect(probeClaim).toBe(false);
        expect(probeRead).not.toBeNull();
    });

    it('R10: an in-retention bare key of a showcase flow gains its scoped copy; the bare row stays', async () => {
        const [bare] = await rowsOf('sys_flow_dispatch', { id: BARE });
        const [scoped] = await rowsOf('sys_flow_dispatch', { id: SCOPED });
        expect(bare).toBeDefined();
        expect(scoped).toBeDefined();
        expect(scoped.dispatched_at).toEqual(bare.dispatched_at);
        expect(scoped.outcome).toBe('succeeded');
        expect(await rowsOf('sys_flow_dispatch', { id: SCOPED_TR })).toHaveLength(1);
    });

    it('R10: a key of a flow nothing declares, and a key outside retention, are not copied', async () => {
        expect(Date.parse(String(oldCreatedAt)), 'the old key is outside retention').toBeLessThan(Date.now() - 31 * DAY);
        const ids = await dispatchIds();
        expect(ids).toContain(BARE_NOBODY);
        expect(ids).toContain(BARE_OLD);
        expect(ids.filter((id) => id.includes(NOBODY))).toEqual([BARE_NOBODY]);
        expect(ids).not.toContain(`schedule:${SHOWCASE}:${SCHEDULED}:${OLD_WINDOW}`);
    });

    it('R8, R7, R20: a paused run, an open request and a legacy template name the package that holds their item', async () => {
        expect((await rowsOf('sys_automation_run', { id: 'qa_s3_paused_run' }))[0]?.flow_package).toBe(SHOWCASE);
        expect((await rowsOf('sys_approval_request', { id: 'qa_s3_open_request' }))[0]?.process_package).toBe(SHOWCASE);
        expect((await rowsOf('sys_email_template', { id: 'qa_s3_legacy_template' }))[0]?.package_id).toBe(EMAIL);
    });

    it('a further boot writes no dispatch row and moves no bound row', async () => {
        const before = await dispatchIds();
        const run = (await rowsOf('sys_automation_run', { id: 'qa_s3_paused_run' }))[0];
        await stack?.stop();
        stack = await bootShowcase({ databaseFile: dbFile });
        expect(await dispatchIds()).toEqual(before);
        const after = (await rowsOf('sys_automation_run', { id: 'qa_s3_paused_run' }))[0];
        expect(after.flow_package).toBe(SHOWCASE);
        expect(after.updated_at).toEqual(run.updated_at);
    }, 240_000);
});
