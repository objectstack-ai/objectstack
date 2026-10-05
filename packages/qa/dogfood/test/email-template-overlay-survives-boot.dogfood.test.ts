// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21785] An email template edited through the METADATA door keeps the
// admin's wording in the row the mailer sends from, across a cold boot on one
// database file — over the real showcase composition.
//
// ## What was broken
//
// `PUT /api/v1/meta/email_template/:name` (the Studio editor's door) stores an
// overlay, and the live projector writes its wording into `sys_email_template`
// at once. On the next boot the declared-template sweep re-projected the
// PACKAGE wording over that row, while `GET /meta` kept serving the admin's —
// the metadata the admin sees and the row the mailer sends diverged silently.
// Measured on `origin/main` before the fix, through this file's own steps: the
// row read `✅ Task done: {{title}}` after the restart.
//
// ## Why `orgContext: true`
//
// It is the shape the defect lives in. A real deployment bootstraps the
// Default Organization (`autoDefaultOrganization` is plugin-auth's default),
// so the admin's save lands as an ORG-SCOPED overlay, which boot hydration
// leaves out of the registry the sweep used to read. The harness default is an
// org-less admin, whose save lands env-wide — and that shape kept the admin's
// wording before the fix as well (measured), so a pin booted that way would
// pass against the defect. The first case asserts the overlay really is
// org-scoped, so this file cannot drift into the vacuous shape unnoticed.
//
// ## What each case pins
//
//   - the metadata-door edit is org-scoped and projected at once (preconditions);
//   - after a cold boot the sending row, `GET /meta` and a real `sendTemplate`
//     all carry the admin's wording;
//   - control: a data-door edit (`customized: true`) still survives the next
//     cold boot — seed-not-clobber is unchanged, and the overlay projection does
//     not override a row the admin edited directly.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
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
const PACKAGE_SUBJECT = '✅ Task done: {{title}}';
const ADMIN_SUBJECT = 'Done (reworded by the admin): {{title}}';
const DATA_DOOR_SUBJECT = 'Done (edited on the record): {{title}}';

/** What reached the wire — `sendTemplate` returns a delivery result, not the rendered message. */
const sent: Array<{ subject?: string }> = [];
const emailPlugin = () => new EmailServicePlugin({
    transport: { async send(message: { subject?: string }) { sent.push({ subject: message.subject }); return { messageId: `captured-${sent.length}` }; } } as never,
    defaultFrom: { address: 'no-reply@example.test', name: 'Overlay Fixture' },
});

const boot = (databaseFile: string) =>
    bootStack(showcaseStack, { databaseFile, orgContext: true, extraPlugins: [emailPlugin()] });

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
    /** The sending rows for the template — what `sendTemplate` resolves from. */
    const sendingRows = async () => {
        const ql: any = await stack!.kernel.getServiceAsync('objectql');
        return ql.find('sys_email_template', { where: { name: NAME }, context: SYS });
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
    }, 180_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('precondition: the metadata-door edit lands org-scoped and is projected into the sending row at once', async () => {
        const [seeded] = await sendingRows();
        expect({ subject: seeded?.subject, managed_by: seeded?.managed_by, customized: seeded?.customized })
            .toEqual({ subject: PACKAGE_SUBJECT, managed_by: 'package', customized: false });

        const served = await call('GET', `/meta/email_template/${NAME}`);
        expect(served.status).toBe(200);
        const doc = served.json?.data ?? served.json?.item ?? served.json;
        const body: Record<string, unknown> = {};
        for (const [k, v] of Object.entries((doc?.item ?? doc) as Record<string, unknown>)) {
            if (!k.startsWith('_')) body[k] = v;
        }
        const put = await call('PUT', `/meta/email_template/${NAME}`, { ...body, subject: ADMIN_SUBJECT });
        expect(put.status, JSON.stringify(put.json)).toBe(200);
        expect(put.json?.projectionApplied).toEqual({ success: true });

        // ⛔ Without this the restart below proves nothing: an env-wide overlay
        // survived the restart before the fix too.
        const ql: any = await stack!.kernel.getServiceAsync('objectql');
        const stored = await ql.find('sys_metadata', { where: { type: 'email_template', name: NAME }, context: SYS });
        expect(stored).toHaveLength(1);
        expect(stored[0].organization_id, 'the overlay is org-scoped').toEqual(expect.any(String));

        expect((await sendingRows()).map((r: any) => r.subject)).toEqual([ADMIN_SUBJECT]);
    });

    it('after a cold boot the sending row, the metadata door and the rendered mail all carry the admin\'s wording', async () => {
        await restart();

        const rows = await sendingRows();
        expect(rows.map((r: any) => ({ subject: r.subject, customized: r.customized })))
            .toEqual([{ subject: ADMIN_SUBJECT, customized: false }]);
        expect(await metaSubject()).toEqual({ status: 200, subject: ADMIN_SUBJECT });

        const email: any = await stack!.kernel.getServiceAsync('email');
        const result = await email.sendTemplate({
            to: 'someone@example.com',
            template: NAME,
            data: { title: 'Ship it', project: 'Apollo' },
        });
        expect(result.status, `sendTemplate failed: ${result.error ?? ''}`).not.toBe('failed');
        expect(sent.at(-1)?.subject).toBe('Done (reworded by the admin): Ship it');
    }, 180_000);

    it('control: a data-door edit is stamped customized and survives the next cold boot', async () => {
        const [row] = await sendingRows();
        const patched = await call('PATCH', `/data/sys_email_template/${row.id}`, { subject: DATA_DOOR_SUBJECT });
        expect(patched.status, JSON.stringify(patched.json)).toBe(200);
        const [edited] = await sendingRows();
        expect({ subject: edited.subject, customized: edited.customized })
            .toEqual({ subject: DATA_DOOR_SUBJECT, customized: true });

        await restart();

        expect((await sendingRows()).map((r: any) => ({ subject: r.subject, customized: r.customized })))
            .toEqual([{ subject: DATA_DOOR_SUBJECT, customized: true }]);
    }, 180_000);
});
