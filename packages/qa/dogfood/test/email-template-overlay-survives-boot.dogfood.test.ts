// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21785] An email template edited through the METADATA door keeps the
// admin's wording in the mail it sends, across a cold boot on one database
// file — over the real showcase composition.
//
// ## What was broken
//
// `PUT /api/v1/meta/email_template/:name` (the Studio editor's door) stores an
// overlay, and the live projector wrote its wording into `sys_email_template`
// at once. On the next boot the declared-template sweep re-projected the
// PACKAGE wording over that row, while `GET /meta` kept serving the admin's —
// the metadata the admin sees and the row the mailer sent from diverged
// silently. Measured on `origin/main` before that fix, through this file's
// own steps: the row read `✅ Task done: {{title}}` after the restart.
//
// ## What changed under it (ADR-0131 D6/D10, ruling C on §6 Q1)
//
// The row is gone from the send path. The mailer reads the template from the
// registry — the protocol's layered list, the same item `GET /meta` serves —
// at every send, so there is no second copy left to diverge, nothing to
// project and nothing to re-project at boot. The pins below hold the same
// outcome #21785 asked for, through the read that replaced the row, and add
// what the replacement owes: the save is live on the very next send, and the
// boot writes no `sys_email_template` row.
//
// ## Why `orgContext: true`
//
// It is the deployment shape. A real deployment bootstraps the Default
// Organization (`autoDefaultOrganization` is plugin-auth's default), and
// before the per-organization overlay axis retired an org-active admin's save
// landed ORG-SCOPED. [ADR-0131 D6] The metadata door now carries no
// organization, so even this admin's save lands ENVIRONMENT-WIDE, and the
// first case pins that it does.
//
// ## What each case pins
//
//   - the metadata-door edit is environment-wide and sends at once, with no
//     restart, and no `sys_email_template` row exists (the boot seeds none);
//   - after a cold boot `GET /meta` and a real `sendTemplate` both carry the
//     admin's wording;
//   - control: the organization DATA door is closed (ADR-0131 D6, ruling C on
//     §6 Q1) — an edit and a create through `/data/sys_email_template` are
//     refused 403 `PERMISSION_DENIED`, nothing is written, and the
//     metadata-door wording still sends after the next cold boot.
//
// [#28576] ADR-0146 D11 closed the package-less write onto a packaged item, so
// the admin's edit goes into the showcase's `.custom` pair, declaring the
// template it overrides. The pair's row is the one stored row, still
// environment-wide, and it is what the mailer reads.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { declaredOverride, ensurePair, inPair } from './customization-pair.js';
import { EmailServicePlugin } from '@objectstack/plugin-email';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Package-relative refs resolve against the cwd — see the sibling cold-boot files. */
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));
const SYS = { isSystem: true, positions: [], permissions: [] };

/** The one template the showcase package declares (`com.example.showcase`). */
const NAME = 'showcase_task_done_email';
const BASE = 'com.example.showcase';
const PACKAGE_SUBJECT = '✅ Task done: {{title}}';
const ADMIN_SUBJECT = 'Done (reworded by the admin): {{title}}';

/** What reached the wire — `sendTemplate` returns a delivery result, not the rendered message. */
const sent: Array<{ subject?: string }> = [];
const emailPlugin = () => new EmailServicePlugin({
    transport: { async send(message: { subject?: string }) { sent.push({ subject: message.subject }); return { messageId: `captured-${sent.length}` }; } } as never,
    defaultFrom: { address: 'no-reply@example.test', name: 'Overlay Fixture' },
});

const boot = (databaseFile: string) =>
    bootShowcase({ databaseFile, orgContext: true, extraPlugins: [emailPlugin()] });

describe('[#21785] a metadata-door email template edit survives a cold boot (showcase)', () => {
    let prevCwd: string;
    let dir: string;
    let dbFile: string;
    let stack: VerifyStack | undefined;
    let token: string;

    const call = async (method: string, path: string, body?: unknown) => {
        const res = await stack!.apiAs(token, method, path, body);
        return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
    };
    /** Every `sys_email_template` row — the table the mailer no longer reads or writes. */
    const templateRows = async () => {
        const ql: any = await stack!.kernel.getServiceAsync('objectql');
        return ql.find('sys_email_template', { context: SYS });
    };
    /** A real send of the template; the subject is read off the wire. */
    const sendSubject = async () => {
        const email: any = await stack!.kernel.getServiceAsync('email');
        const result = await email.sendTemplate({
            to: 'someone@example.com',
            template: NAME,
            data: { title: 'Ship it', project: 'Apollo' },
        });
        expect(result.status, `sendTemplate failed: ${result.error ?? ''}`).not.toBe('failed');
        return sent.at(-1)?.subject;
    };
    /** `GET /meta/email_template/:name` — the served document, unwrapped from its envelope. */
    const metaSubject = async () => {
        const read = await call('GET', `/meta/email_template/${NAME}`);
        const doc = read.json?.data ?? read.json?.item ?? read.json;
        return { status: read.status, subject: (doc?.item ?? doc)?.subject };
    };
    const restart = async () => {
        await stack!.stop();
        stack = await boot(dbFile);
        token = await stack.signIn();
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-21785-'));
        dbFile = join(dir, 'showcase.db');
        stack = await boot(dbFile);
        token = await stack.signIn();
        await ensurePair(stack, token, BASE);
    }, 180_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('an org-active admin\'s metadata-door edit lands environment-wide and sends at once, with no row behind it', async () => {
        // The boot seeded no row: the built-ins and the showcase's declaration
        // resolve from the registry.
        expect(await templateRows()).toEqual([]);
        expect(await sendSubject()).toBe('✅ Task done: Ship it');

        const served = await call('GET', `/meta/email_template/${NAME}`);
        expect(served.status).toBe(200);
        const doc = served.json?.data ?? served.json?.item ?? served.json;
        const body: Record<string, unknown> = {};
        for (const [k, v] of Object.entries((doc?.item ?? doc) as Record<string, unknown>)) {
            if (!k.startsWith('_')) body[k] = v;
        }
        expect(body.subject).toBe(PACKAGE_SUBJECT);
        const put = await call('PUT', inPair(`/meta/email_template/${NAME}`, BASE), declaredOverride({ ...body, subject: ADMIN_SUBJECT }, BASE, '0.1.0'));
        expect(put.status, JSON.stringify(put.json)).toBe(200);

        // [ADR-0131 D6] The door names no organization, whatever the admin's.
        const ql: any = await stack!.kernel.getServiceAsync('objectql');
        const stored = await ql.find('sys_metadata', { where: { type: 'email_template', name: NAME }, context: SYS });
        expect(stored).toHaveLength(1);
        expect(stored[0].organization_id ?? null, 'the overlay is environment-wide').toBeNull();

        // Live: the very next send, no restart, no projection.
        expect(await sendSubject()).toBe('Done (reworded by the admin): Ship it');
        expect(await templateRows()).toEqual([]);
    });

    it('after a cold boot the metadata door and the rendered mail both carry the admin\'s wording', async () => {
        await restart();

        expect(await metaSubject()).toEqual({ status: 200, subject: ADMIN_SUBJECT });
        expect(await sendSubject()).toBe('Done (reworded by the admin): Ship it');
        expect(await templateRows()).toEqual([]);
    }, 180_000);

    it('control: the organization data door is closed — an edit and a create are refused, and the metadata-door wording still sends after the next cold boot', async () => {
        const closedDoor = /^PERMISSION_DENIED: sys_email_template is closed to organization writes/;
        // A row an earlier release left in the table — the legacy population
        // the v18 migration ceremony promotes. Written in system context, the
        // one context the door lets through.
        const ql: any = await stack!.kernel.getServiceAsync('objectql');
        await ql.insert('sys_email_template', {
            id: 'etpl_legacy', name: NAME, label: 'Task done', category: 'custom', locale: 'en-US',
            subject: 'Legacy row wording', body_html: '<p>legacy</p>', active: true,
            managed_by: 'package', customized: true,
        }, { context: SYS });
        const patched = await call('PATCH', '/data/sys_email_template/etpl_legacy', { subject: 'Edited on the record' });
        expect(patched.status, JSON.stringify(patched.json)).toBe(403);
        expect(patched.json?.code).toBe('PERMISSION_DENIED');
        expect(String(patched.json?.error)).toMatch(closedDoor);

        const created = await call('POST', '/data/sys_email_template', {
            name: 'org_owned_template', label: 'Org owned', category: 'custom', locale: 'en-US',
            subject: 'Org owned', body_html: '<p>Org owned</p>', active: true,
        });
        expect(created.status, JSON.stringify(created.json)).toBe(403);
        expect(created.json?.code).toBe('PERMISSION_DENIED');
        expect(String(created.json?.error)).toMatch(closedDoor);

        expect(await ql.find('sys_email_template', { where: { name: 'org_owned_template' }, context: SYS })).toEqual([]);
        // The legacy row keeps its bytes, and it is not what sends.
        const legacy = () => templateRows().then((rows: any[]) => rows.map((r) => ({ id: r.id, subject: r.subject, customized: r.customized })));
        expect(await legacy()).toEqual([{ id: 'etpl_legacy', subject: 'Legacy row wording', customized: true }]);
        expect(await sendSubject()).toBe('Done (reworded by the admin): Ship it');

        await restart();

        expect(await legacy()).toEqual([{ id: 'etpl_legacy', subject: 'Legacy row wording', customized: true }]);
        expect(await sendSubject()).toBe('Done (reworded by the admin): Ship it');
    }, 180_000);
});
