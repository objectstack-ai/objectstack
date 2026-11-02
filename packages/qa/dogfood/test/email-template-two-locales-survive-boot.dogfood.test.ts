// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22877] Two locales of one email template, each saved through the METADATA
// door, both keep the admin's wording across a cold boot on one database file
// — over the real showcase composition and a real SQLite store.
//
// ## What was broken
//
// `email_template` is identified by `(name, locale)`: rows sharing a name form
// an i18n bundle. The overlay store kept ONE `sys_metadata` row per
// `(type, name)`, so `PUT /meta/email_template/:name` in `en-US` and then in
// `zh-CN` left one row — the second save had updated the first locale's row in
// place. Both locales read back until the next boot, when `en-US` mailed the
// package wording again. Measured on the showcase before the fix.
//
// ## What changed (ruling A)
//
// `sys_metadata.bundle_member` carries the member, taken from the body; the
// overlay unique index carries it too, so the two saves are two rows. A
// by-name read with no member answers the canonical member (`en-US`).
//
// ## What each case pins
//
//   - two locales saved through the metadata door are two rows (the canonical
//     member's NULL and `zh-CN`), and each sends its own wording at once;
//   - after a cold boot each locale still sends its own wording, and the
//     by-name read serves the canonical member's;
//   - CONTROL: a locale nobody saved keeps the package wording, and a
//     single-locale re-save is still one row per member;
//   - [#22877 stage 2] the by-name member selector: `?member=zh-CN` reads
//     that locale's wording, `DELETE ?member=zh-CN` resets that locale alone
//     and, after a cold boot, each locale serves the expected wording; a
//     misspelled or misplaced selector is a located 400.
//
// [#28576] ADR-0146 D11 closed the package-less write onto a packaged item, so
// both locales are saved into the showcase's `.custom` pair: `en-US`, the
// member the base ships, declares the override; `zh-CN`, which the base does
// not ship, is the pair's own member and declares none (#28746), listed and
// sent on the base's address (#28828). The reset names the pair too.

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

/** The template the showcase package declares (`com.example.showcase`), in `en-US`. */
const NAME = 'showcase_task_done_email';
const BASE = 'com.example.showcase';
const PACKAGE_SUBJECT = '✅ Task done: {{title}}';
const ADMIN_EN = 'Done (admin, English): {{title}}';
const ADMIN_ZH = '已完成（管理员中文）：{{title}}';

/** What reached the wire — `sendTemplate` returns a delivery result, not the rendered message. */
const sent: Array<{ subject?: string }> = [];
const emailPlugin = () => new EmailServicePlugin({
    transport: { async send(message: { subject?: string }) { sent.push({ subject: message.subject }); return { messageId: `captured-${sent.length}` }; } } as never,
    defaultFrom: { address: 'no-reply@example.test', name: 'Locale Fixture' },
});

const boot = (databaseFile: string) =>
    bootShowcase({ databaseFile, orgContext: true, extraPlugins: [emailPlugin()] });

describe('[#22877] two locales of one email template survive a cold boot (showcase)', () => {
    let prevCwd: string;
    let dir: string;
    let dbFile: string;
    let stack: VerifyStack | undefined;
    let token: string;

    const call = async (method: string, path: string, body?: unknown) => {
        const res = await stack!.apiAs(token, method, path, body);
        return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
    };
    /** A real send in one locale; the subject is read off the wire. */
    const sendSubject = async (locale: string) => {
        const email: any = await stack!.kernel.getServiceAsync('email');
        const result = await email.sendTemplate({
            to: 'someone@example.com',
            template: NAME,
            locale,
            data: { title: 'Ship it', project: 'Apollo' },
        });
        expect(result.status, `sendTemplate(${locale}) failed: ${result.error ?? ''}`).not.toBe('failed');
        return sent.at(-1)?.subject;
    };
    /** `GET /meta/email_template/:name` — the served document, unwrapped, `_`-decorations dropped. */
    const metaBody = async (query = ''): Promise<{ status: number; body: Record<string, unknown> }> => {
        const read = await call('GET', `/meta/email_template/${NAME}${query}`);
        const doc = read.json?.data ?? read.json?.item ?? read.json;
        const body: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(((doc?.item ?? doc) ?? {}) as Record<string, unknown>)) {
            if (!k.startsWith('_')) body[k] = v;
        }
        return { status: read.status, body };
    };
    /** The overlay rows of the template, as the store holds them. */
    const overlayRows = async () => {
        const ql: any = await stack!.kernel.getServiceAsync('objectql');
        const rows: any[] = await ql.find('sys_metadata', {
            where: { type: 'email_template', name: NAME, state: 'active' },
            context: SYS,
        });
        return rows
            .map((r) => ({ member: r.bundle_member ?? null, subject: JSON.parse(String(r.metadata)).subject }))
            .sort((a, b) => String(a.member).localeCompare(String(b.member)));
    };
    /** A save of one locale into the pair: the shipped `en-US` declares the override, another locale is the pair's own member. */
    const saveLocale = (served: Record<string, unknown>, locale: string, subject: string) => {
        const { overrides: _declared, ...doc }: Record<string, unknown> = { ...served, locale, subject };
        return call('PUT', inPair(`/meta/email_template/${NAME}`, BASE),
            locale === 'en-US' ? declaredOverride(doc, BASE, '0.1.0') : doc);
    };
    const restart = async () => {
        await stack!.stop();
        stack = await boot(dbFile);
        token = await stack.signIn();
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-22877-'));
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

    it('two locales saved through the metadata door are two rows, and each sends its own wording at once', async () => {
        const served = await metaBody();
        expect(served.status).toBe(200);
        expect(served.body.subject).toBe(PACKAGE_SUBJECT);

        const en = await saveLocale(served.body, 'en-US', ADMIN_EN);
        expect(en.status, JSON.stringify(en.json)).toBe(200);
        const zh = await saveLocale(served.body, 'zh-CN', ADMIN_ZH);
        expect(zh.status, JSON.stringify(zh.json)).toBe(200);

        expect(await overlayRows()).toEqual([
            { member: null, subject: ADMIN_EN },
            { member: 'zh-CN', subject: ADMIN_ZH },
        ]);
        expect(await sendSubject('en-US')).toBe('Done (admin, English): Ship it');
        expect(await sendSubject('zh-CN')).toBe('已完成（管理员中文）：Ship it');
    });

    it('after a cold boot each locale still sends its own wording, and the by-name read serves the canonical member', async () => {
        await restart();

        expect(await sendSubject('en-US')).toBe('Done (admin, English): Ship it');
        expect(await sendSubject('zh-CN')).toBe('已完成（管理员中文）：Ship it');
        const served = await metaBody();
        expect(served).toMatchObject({ status: 200, body: { subject: ADMIN_EN } });
        expect(await overlayRows()).toHaveLength(2);
    }, 180_000);

    it('control: a locale nobody saved keeps the package ladder, and a re-save of one locale is still one row per member', async () => {
        // `ja-JP` is not in the bundle: the ladder falls to `en-US`, the admin's.
        expect(await sendSubject('ja-JP')).toBe('Done (admin, English): Ship it');

        const served = await metaBody();
        const again = await saveLocale(served.body, 'zh-CN', ADMIN_ZH.replace('：', '（二）：'));
        expect(again.status, JSON.stringify(again.json)).toBe(200);
        expect((await overlayRows()).map((r) => r.member)).toEqual([null, 'zh-CN']);

        await restart();
        expect(await sendSubject('en-US')).toBe('Done (admin, English): Ship it');
        expect(await sendSubject('zh-CN')).toBe('已完成（管理员中文）（二）：Ship it');
    }, 180_000);

    it('[stage 2] one locale is read and reset by name with the member selector, and each locale serves its wording after a cold boot', async () => {
        // State from the cases above: `en-US` and `zh-CN` both customized.
        expect(await metaBody('?member=zh-CN')).toMatchObject({ status: 200, body: { subject: ADMIN_ZH.replace('：', '（二）：') } });
        expect(await metaBody('?member=en-US')).toMatchObject({ status: 200, body: { subject: ADMIN_EN } });

        const reset = await call('DELETE', inPair(`/meta/email_template/${NAME}?member=zh-CN`, BASE));
        expect(reset.status, JSON.stringify(reset.json)).toBe(200);
        expect(reset.json).toMatchObject({ success: true, reset: true });
        expect(await overlayRows()).toEqual([{ member: null, subject: ADMIN_EN }]);
        // The package ships `en-US` only, so `zh-CN` now falls to the floor —
        // the admin's English, untouched by the reset.
        expect(await sendSubject('zh-CN')).toBe('Done (admin, English): Ship it');

        await restart();
        expect(await sendSubject('en-US')).toBe('Done (admin, English): Ship it');
        expect(await sendSubject('zh-CN')).toBe('Done (admin, English): Ship it');
        expect(await metaBody()).toMatchObject({ status: 200, body: { subject: ADMIN_EN } });
        // Nothing stores or ships `zh-CN` now: the read answers it as absent.
        expect((await metaBody('?member=zh-CN')).status).toBe(404);

        // A located 400 for a misspelled selector, and for one on a type with no members.
        const misspelled = await call('GET', `/meta/email_template/${NAME}?memeber=zh-CN`);
        expect(misspelled.status).toBe(400);
        expect(misspelled.json?.error?.code).toBe('VALIDATION_ERROR');
        const noMembers = await call('DELETE', `/meta/view/${NAME}?member=zh-CN`);
        expect(noMembers.status, JSON.stringify(noMembers.json)).toBe(400);
        expect(JSON.stringify(noMembers.json)).toContain('selector names a bundle member');
    }, 180_000);
});
