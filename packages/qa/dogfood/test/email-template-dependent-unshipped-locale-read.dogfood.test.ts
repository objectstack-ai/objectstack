// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28779, ADR-0146 D2 / D8, #28390] SHAPE PIN — documents what the reads
// serve TODAY when a dependent package (not the base's `.custom` pair) ships
// an email template under a base template's name at a locale the base does
// not ship. Over the real showcase composition and its HTTP doors.
//
// ⛔ This file records a measured shape; it does not assert the shape is
// right. Whether a dependent's member may be served on the base's address is
// open (#28779 hand-back, evidence on #28390). When that is decided, the
// cases marked SHAPE below move with the ruling — that is their purpose.
//
// ## The rig
//
// The showcase ships `showcase_task_done_email` in `en-US` only. A Studio-made
// package `com.example.showcaseaddon` declares the showcase as a dependency
// and publishes the same name at `fr-FR`. Since PR #28777 the write gate
// judges an email template by `(name, locale)`, so this is admitted as an
// addition (the dependent's `en-US` at the same name is still refused).
//
// ## What reads today (measured on main 8f294e04)
//
//   - the read naming the dependent serves its `fr-FR`, stamped with its own
//     package id — as expected;
//   - SHAPE: the read naming the BASE (`?package=<base>&member=fr-FR`) and the
//     package-less read (`?member=fr-FR`) also serve the dependent's body,
//     stamped `_packageId: <dependent>`, `_provenance: 'org'`. The address
//     finds no row of the base, its pair or no package at `fr-FR`, and the
//     registry's by-name read falls to its cross-package tier
//     (`SchemaRegistry.getItem`, ADR-0048 §3.3 first composite match);
//   - SHAPE: the env-wide list, the list scoped to the base and the executing
//     list (`getMetaItemsForExecution`) leave the `fr-FR` out — the env-wide
//     narrowing keeps a name one code package ships to that package's items,
//     at NAME grain — so a send in `fr-FR` renders the base's `en-US`.
//
// So the by-name reads and the lists disagree about the base's `fr-FR`, and
// the body no read stamps as the base's is still answered for the base's
// address. Controls: the base's own `en-US` reads as the base's on every
// read, and the pair's declared override of `en-US` reads as the override.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';
const DEPENDENT = 'com.example.showcaseaddon';
/** The template the showcase ships, in `en-US` only. */
const NAME = 'showcase_task_done_email';
const SHIPPED_SUBJECT = '✅ Task done: {{title}}';
const DEPENDENT_SUBJECT = 'Add-on FR: {{title}}';
const OVERRIDE_SUBJECT = 'Override: {{title}}';
/** The refusal's code — the save door answers it beside a string `error`, an enveloped door inside `error`. */
const codeOf = (json: any): unknown => json?.code ?? json?.error?.code;

interface Served {
    status: number;
    subject?: unknown;
    locale?: unknown;
    _packageId?: unknown;
}

describe('[#28779] SHAPE: what the reads serve for a dependent\'s email template locale the base does not ship (showcase)', () => {
    let stack: VerifyStack | undefined;
    let token: string;
    let shipped: Record<string, unknown>;

    const call = async (method: string, path: string, body?: unknown) => {
        const res = await stack!.apiAs(token, method, path, body);
        return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
    };
    /** `GET /meta/email_template/:name` at one member, with or without `?package=` — the served document, trimmed. */
    const byName = async (member: string, pkg?: string): Promise<Served> => {
        const read = await call('GET', `/meta/email_template/${NAME}?member=${member}${pkg ? `&package=${pkg}` : ''}`);
        if (read.status !== 200) return { status: read.status };
        const doc = read.json?.data ?? read.json?.item ?? read.json;
        const item = (doc?.item ?? doc) as Record<string, unknown>;
        return { status: read.status, subject: item.subject, locale: item.locale, _packageId: item._packageId };
    };
    /** The template's rows on `GET /meta/email_template[?package=]`, as `[locale, _packageId, subject]`. */
    const listed = async (pkg?: string) => {
        const list = await call('GET', `/meta/email_template${pkg ? `?package=${pkg}` : ''}`);
        expect(list.status).toBe(200);
        const items: any[] = Array.isArray(list.json) ? list.json : (list.json?.items ?? list.json?.data?.items ?? list.json?.data ?? []);
        return items.filter((i) => i?.name === NAME).map((i) => [i.locale, i._packageId, i.subject]);
    };
    /** The executing list the email template loader reads (`protocol.getMetaItemsForExecution`). */
    const executing = async () => {
        const protocol: any = await stack!.kernel.getServiceAsync('protocol');
        const out = await protocol.getMetaItemsForExecution({ type: 'email_template' });
        return ((out?.items ?? []) as any[]).filter((i) => i?.name === NAME).map((i) => [i.locale, i._packageId, i.subject]);
    };
    /** What a send in `locale` renders: `IEmailService.renderTemplate`, the resolver `sendTemplate` uses. */
    const rendered = async (locale: string) => {
        const email: any = await stack!.kernel.getServiceAsync('email');
        return (await email.renderTemplate({ template: NAME, locale, data: { title: 'T' } }))?.subject;
    };
    const body = (locale: string, subject: string, extra: Record<string, unknown> = {}) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(shipped)) if (!k.startsWith('_')) out[k] = v;
        return { ...out, locale, subject, ...extra };
    };
    const saveInto = (pkg: string, b: Record<string, unknown>) =>
        call('PUT', `/meta/email_template/${NAME}?mode=draft&package=${pkg}`, b);
    const publishFrom = (pkg: string, member: string) =>
        call('POST', `/meta/email_template/${NAME}/publish?package=${pkg}&member=${member}`, {});

    const BASE_EN = { status: 200, subject: SHIPPED_SUBJECT, locale: 'en-US', _packageId: BASE };
    const DEPENDENT_FR = { status: 200, subject: DEPENDENT_SUBJECT, locale: 'fr-FR', _packageId: DEPENDENT };

    beforeAll(async () => {
        stack = await bootShowcase();
        token = await stack.signIn();
        const read = await call('GET', `/meta/email_template/${NAME}?member=en-US`);
        expect(read.status).toBe(200);
        const doc = read.json?.data ?? read.json?.item ?? read.json;
        shipped = doc?.item ?? doc;
    }, 180_000);

    afterAll(async () => {
        await stack?.stop();
    });

    it('baseline: nothing answers `fr-FR`, and the base\'s `en-US` reads as the base\'s', async () => {
        expect(await byName('fr-FR', BASE)).toEqual({ status: 404 });
        expect(await byName('fr-FR')).toEqual({ status: 404 });
        expect(await byName('en-US', BASE)).toEqual(BASE_EN);
        expect(await byName('en-US')).toEqual(BASE_EN);
        expect(await rendered('fr-FR')).toBe('✅ Task done: T');
    });

    it('the dependent publishes `fr-FR` under the base\'s name, admitted as an addition; its `en-US` is refused', async () => {
        const created = await call('POST', '/packages', {
            manifest: {
                id: DEPENDENT, name: 'Showcase add-on', version: '0.1.0', type: 'app', namespace: 'scaddon',
                dependencies: { [BASE]: '*' },
            },
        });
        expect(created.status, JSON.stringify(created.json)).toBe(201);

        const saved = await saveInto(DEPENDENT, body('fr-FR', DEPENDENT_SUBJECT));
        expect(saved.status, JSON.stringify(saved.json)).toBe(200);
        const published = await publishFrom(DEPENDENT, 'fr-FR');
        expect(published.status, JSON.stringify(published.json)).toBe(200);

        // Control: the member the base ships is still a same-name collision.
        const refused = await saveInto(DEPENDENT, body('en-US', 'Add-on EN: {{title}}'));
        expect(refused.status, JSON.stringify(refused.json)).toBe(403);
        expect(codeOf(refused.json)).toBe('NOT_OVERRIDABLE');
    });

    it('the read naming the dependent serves its `fr-FR` under its own package id', async () => {
        expect(await byName('fr-FR', DEPENDENT)).toEqual(DEPENDENT_FR);
        expect(await listed(DEPENDENT)).toEqual([['fr-FR', DEPENDENT, DEPENDENT_SUBJECT]]);
    });

    it('SHAPE: the read naming the base and the package-less read serve the dependent\'s `fr-FR` body (stamped with the dependent)', async () => {
        expect(await byName('fr-FR', BASE)).toEqual(DEPENDENT_FR);
        expect(await byName('fr-FR')).toEqual(DEPENDENT_FR);
        // Control: the base's own member is untouched on every read.
        expect(await byName('en-US', BASE)).toEqual(BASE_EN);
        expect(await byName('en-US')).toEqual(BASE_EN);
    });

    it('SHAPE: the env-wide, base-scoped and executing lists leave `fr-FR` out, so a `fr-FR` send renders the base\'s `en-US`', async () => {
        expect(await listed()).toEqual([['en-US', BASE, SHIPPED_SUBJECT]]);
        expect(await listed(BASE)).toEqual([['en-US', BASE, SHIPPED_SUBJECT]]);
        expect(await executing()).toEqual([['en-US', BASE, SHIPPED_SUBJECT]]);
        expect(await rendered('fr-FR')).toBe('✅ Task done: T');
    });

    it('control: the pair\'s declared override of `en-US` reads as the override; the dependent\'s `fr-FR` reads as before', async () => {
        const ensured = await call('POST', `/packages/${BASE}/ensure-customization`);
        expect([200, 201], JSON.stringify(ensured.json)).toContain(ensured.status);
        const saved = await saveInto(PAIR, body('en-US', OVERRIDE_SUBJECT, { overrides: { package: BASE, basedOn: '0.1.0' } }));
        expect(saved.status, JSON.stringify(saved.json)).toBe(200);
        const published = await publishFrom(PAIR, 'en-US');
        expect(published.status, JSON.stringify(published.json)).toBe(200);

        const OVERRIDE_EN = { status: 200, subject: OVERRIDE_SUBJECT, locale: 'en-US', _packageId: BASE };
        expect(await byName('en-US', BASE)).toEqual(OVERRIDE_EN);
        expect(await byName('en-US')).toEqual(OVERRIDE_EN);
        expect(await listed()).toEqual([['en-US', BASE, OVERRIDE_SUBJECT]]);
        expect(await rendered('en-US')).toBe('Override: T');

        expect(await byName('fr-FR', BASE)).toEqual(DEPENDENT_FR);
        expect(await byName('fr-FR')).toEqual(DEPENDENT_FR);
        expect(await rendered('fr-FR')).toBe('Override: T');
    });
});
