// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28802, ADR-0146 D2 / D8, #28390 ruling A] An email template locale the
// base does not ship, added under the base template's name: the pair's own
// addition is served and sent on the base's address; a dependent package's
// stays under its own package. Over the real showcase composition and its
// HTTP doors.
//
// ## The rig
//
// The showcase ships `showcase_task_done_email` in `en-US` only. Since PR
// #28777 the write gate judges an email template by `(name, locale)`, so a
// `fr-FR` under that name is admitted as an addition, both from the base's
// `.custom` pair (no `overrides`) and from a Studio-made package
// `com.example.showcaseaddon` that declares the showcase as a dependency (its
// `en-US` at the same name is still refused).
//
// ## What each describe pins (member-grain coexistence, #28779 option A)
//
//   - the dependent's `fr-FR`: served by the read naming the dependent and
//     the list scoped to it; the read naming the base and the package-less
//     read answer 404 for it (they used to fall to the registry's
//     cross-package tier and serve it stamped with the dependent), and the
//     base's lists and the executing list leave it out, so a `fr-FR` send
//     renders the base's `en-US`;
//   - the pair's `fr-FR`: served on the base's address — the by-name reads,
//     the env-wide list, the list scoped to the base and the executing list —
//     stamped with the pair's own id, so `renderTemplate` in `fr-FR` renders
//     it (it used to be read by name but never listed, so never sent). The
//     list scoped to the pair is unchanged. With a dependent's `fr-FR` beside
//     it, the base's address still serves the pair's.
//
// Controls: the base's own `en-US` reads as the base's on every read, and the
// pair's declared override of `en-US` reads as the override.

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
const PAIR_SUBJECT = 'Pair FR: {{title}}';
const OVERRIDE_SUBJECT = 'Override: {{title}}';
/** The refusal's code — the save door answers it beside a string `error`, an enveloped door inside `error`. */
const codeOf = (json: any): unknown => json?.code ?? json?.error?.code;

interface Served {
    status: number;
    subject?: unknown;
    locale?: unknown;
    _packageId?: unknown;
}

/** One booted showcase and the reads both describes ask. */
function showcaseRig() {
    const rig = {
        stack: undefined as VerifyStack | undefined,
        token: '',
        shipped: {} as Record<string, unknown>,
    };
    const call = async (method: string, path: string, body?: unknown) => {
        const res = await rig.stack!.apiAs(rig.token, method, path, body);
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
    /** `GET /meta/email_template/:name/layers` at one member — the subjects of `code`, `overlay` and `effective`, or the status. */
    const layers = async (member: string, pkg?: string) => {
        const read = await call('GET', `/meta/email_template/${NAME}/layers?member=${member}${pkg ? `&package=${pkg}` : ''}`);
        if (read.status !== 200) return { status: read.status };
        const doc = read.json?.data ?? read.json;
        const subject = (layer: any) => (layer === null || layer === undefined ? null : layer.subject);
        return { status: 200, code: subject(doc?.code), overlay: subject(doc?.overlay), effective: subject(doc?.effective) };
    };
    const rowsOf = (items: any[]) => items
        .filter((i) => i?.name === NAME)
        .map((i) => [i.locale, i._packageId, i.subject])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    /** The template's rows on `GET /meta/email_template[?package=]`, as `[locale, _packageId, subject]`, by locale. */
    const listed = async (pkg?: string) => {
        const list = await call('GET', `/meta/email_template${pkg ? `?package=${pkg}` : ''}`);
        expect(list.status).toBe(200);
        return rowsOf(Array.isArray(list.json) ? list.json : (list.json?.items ?? list.json?.data?.items ?? list.json?.data ?? []));
    };
    /** The executing list the email template loader reads (`protocol.getMetaItemsForExecution`). */
    const executing = async () => {
        const protocol: any = await rig.stack!.kernel.getServiceAsync('protocol');
        const out = await protocol.getMetaItemsForExecution({ type: 'email_template' });
        return rowsOf(out?.items ?? []);
    };
    /** What a send in `locale` renders: `IEmailService.renderTemplate`, the resolver `sendTemplate` uses. */
    const rendered = async (locale: string) => {
        const email: any = await rig.stack!.kernel.getServiceAsync('email');
        return (await email.renderTemplate({ template: NAME, locale, data: { title: 'T' } }))?.subject;
    };
    const body = (locale: string, subject: string, extra: Record<string, unknown> = {}) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rig.shipped)) if (!k.startsWith('_')) out[k] = v;
        return { ...out, locale, subject, ...extra };
    };
    const saveInto = (pkg: string, b: Record<string, unknown>) =>
        call('PUT', `/meta/email_template/${NAME}?mode=draft&package=${pkg}`, b);
    const publishFrom = (pkg: string, member: string) =>
        call('POST', `/meta/email_template/${NAME}/publish?package=${pkg}&member=${member}`, {});
    /** Saves and publishes one member into `pkg`, both answering 200. */
    const publishInto = async (pkg: string, b: Record<string, unknown>) => {
        const saved = await saveInto(pkg, b);
        expect(saved.status, JSON.stringify(saved.json)).toBe(200);
        const published = await publishFrom(pkg, String(b.locale));
        expect(published.status, JSON.stringify(published.json)).toBe(200);
    };
    const createDependent = async () => {
        const created = await call('POST', '/packages', {
            manifest: {
                id: DEPENDENT, name: 'Showcase add-on', version: '0.1.0', type: 'app', namespace: 'scaddon',
                dependencies: { [BASE]: '*' },
            },
        });
        expect(created.status, JSON.stringify(created.json)).toBe(201);
    };
    const ensurePair = async () => {
        const ensured = await call('POST', `/packages/${BASE}/ensure-customization`);
        expect([200, 201], JSON.stringify(ensured.json)).toContain(ensured.status);
    };
    const boot = async () => {
        rig.stack = await bootShowcase();
        rig.token = await rig.stack.signIn();
        const read = await call('GET', `/meta/email_template/${NAME}?member=en-US`);
        expect(read.status).toBe(200);
        const doc = read.json?.data ?? read.json?.item ?? read.json;
        rig.shipped = doc?.item ?? doc;
    };
    return { rig, boot, byName, layers, listed, executing, rendered, body, saveInto, publishInto, createDependent, ensurePair };
}

const BASE_EN = { status: 200, subject: SHIPPED_SUBJECT, locale: 'en-US', _packageId: BASE };
const DEPENDENT_FR = { status: 200, subject: DEPENDENT_SUBJECT, locale: 'fr-FR', _packageId: DEPENDENT };
const PAIR_FR = { status: 200, subject: PAIR_SUBJECT, locale: 'fr-FR', _packageId: PAIR };
const BASE_EN_ROW = ['en-US', BASE, SHIPPED_SUBJECT];
const PAIR_FR_ROW = ['fr-FR', PAIR, PAIR_SUBJECT];

describe('[#28802] a dependent\'s email template locale the base does not ship stays under the dependent (showcase)', () => {
    const r = showcaseRig();

    beforeAll(async () => { await r.boot(); }, 180_000);
    afterAll(async () => { await r.rig.stack?.stop(); });

    it('baseline: nothing answers `fr-FR`, and the base\'s `en-US` reads as the base\'s', async () => {
        expect(await r.byName('fr-FR', BASE)).toEqual({ status: 404 });
        expect(await r.byName('fr-FR')).toEqual({ status: 404 });
        expect(await r.byName('en-US', BASE)).toEqual(BASE_EN);
        expect(await r.byName('en-US')).toEqual(BASE_EN);
        expect(await r.rendered('fr-FR')).toBe('✅ Task done: T');
    });

    it('the dependent publishes `fr-FR` under the base\'s name, admitted as an addition; its `en-US` is refused', async () => {
        await r.createDependent();
        await r.publishInto(DEPENDENT, r.body('fr-FR', DEPENDENT_SUBJECT));

        // Control: the member the base ships is still a same-name collision.
        const refused = await r.saveInto(DEPENDENT, r.body('en-US', 'Add-on EN: {{title}}'));
        expect(refused.status, JSON.stringify(refused.json)).toBe(403);
        expect(codeOf(refused.json)).toBe('NOT_OVERRIDABLE');
    });

    it('the read naming the dependent serves its `fr-FR` under its own package id', async () => {
        expect(await r.byName('fr-FR', DEPENDENT)).toEqual(DEPENDENT_FR);
        expect(await r.listed(DEPENDENT)).toEqual([['fr-FR', DEPENDENT, DEPENDENT_SUBJECT]]);
    });

    it('the read naming the base and the package-less read do not serve the dependent\'s `fr-FR`', async () => {
        expect(await r.byName('fr-FR', BASE)).toEqual({ status: 404 });
        expect(await r.byName('fr-FR')).toEqual({ status: 404 });
        // Control: the base's own member is untouched on every read.
        expect(await r.byName('en-US', BASE)).toEqual(BASE_EN);
        expect(await r.byName('en-US')).toEqual(BASE_EN);
    });

    it('[#28830] the layered read naming the base or no package stays 404 for the dependent\'s `fr-FR`; naming the dependent it answers', async () => {
        expect(await r.layers('fr-FR', BASE)).toEqual({ status: 404 });
        expect(await r.layers('fr-FR')).toEqual({ status: 404 });
        expect(await r.layers('fr-FR', DEPENDENT))
            .toEqual({ status: 200, code: null, overlay: DEPENDENT_SUBJECT, effective: DEPENDENT_SUBJECT });
        // Control: the base's own member.
        expect(await r.layers('en-US', BASE))
            .toEqual({ status: 200, code: SHIPPED_SUBJECT, overlay: null, effective: SHIPPED_SUBJECT });
    });

    it('the env-wide, base-scoped and executing lists leave the dependent\'s `fr-FR` out, so a `fr-FR` send renders the base\'s `en-US`', async () => {
        expect(await r.listed()).toEqual([BASE_EN_ROW]);
        expect(await r.listed(BASE)).toEqual([BASE_EN_ROW]);
        expect(await r.executing()).toEqual([BASE_EN_ROW]);
        expect(await r.rendered('fr-FR')).toBe('✅ Task done: T');
    });

    it('control: the pair\'s declared override of `en-US` reads as the override; the dependent\'s `fr-FR` stays off the base\'s address', async () => {
        await r.ensurePair();
        await r.publishInto(PAIR, r.body('en-US', OVERRIDE_SUBJECT, { overrides: { package: BASE, basedOn: '0.1.0' } }));

        const OVERRIDE_EN = { status: 200, subject: OVERRIDE_SUBJECT, locale: 'en-US', _packageId: BASE };
        expect(await r.byName('en-US', BASE)).toEqual(OVERRIDE_EN);
        expect(await r.byName('en-US')).toEqual(OVERRIDE_EN);
        expect(await r.listed()).toEqual([['en-US', BASE, OVERRIDE_SUBJECT]]);
        expect(await r.rendered('en-US')).toBe('Override: T');
        expect(await r.layers('en-US', BASE))
            .toEqual({ status: 200, code: SHIPPED_SUBJECT, overlay: OVERRIDE_SUBJECT, effective: OVERRIDE_SUBJECT });
        expect(await r.layers('fr-FR', BASE)).toEqual({ status: 404 });

        expect(await r.byName('fr-FR', BASE)).toEqual({ status: 404 });
        expect(await r.byName('fr-FR')).toEqual({ status: 404 });
        expect(await r.byName('fr-FR', DEPENDENT)).toEqual(DEPENDENT_FR);
        expect(await r.rendered('fr-FR')).toBe('Override: T');
    });
});

describe('[#28802] the pair\'s own email template locale the base does not ship is served and sent on the base\'s address (showcase)', () => {
    const r = showcaseRig();

    beforeAll(async () => { await r.boot(); }, 180_000);
    afterAll(async () => { await r.rig.stack?.stop(); });

    it('the pair publishes `fr-FR` without `overrides`, admitted as its own member', async () => {
        await r.ensurePair();
        await r.publishInto(PAIR, r.body('fr-FR', PAIR_SUBJECT));
        expect(await r.byName('fr-FR', PAIR)).toEqual(PAIR_FR);
        expect(await r.listed(PAIR)).toEqual([PAIR_FR_ROW]);
    });

    it('the by-name reads naming the base and naming no package serve the pair\'s `fr-FR`; the base\'s `en-US` is untouched', async () => {
        expect(await r.byName('fr-FR', BASE)).toEqual(PAIR_FR);
        expect(await r.byName('fr-FR')).toEqual(PAIR_FR);
        expect(await r.byName('en-US', BASE)).toEqual(BASE_EN);
        expect(await r.byName('en-US')).toEqual(BASE_EN);
    });

    it('[#28830] the layered read naming the base or no package answers the pair\'s `fr-FR` layer, as the other reads serve it', async () => {
        const PAIR_LAYERS = { status: 200, code: null, overlay: PAIR_SUBJECT, effective: PAIR_SUBJECT };
        expect(await r.layers('fr-FR', BASE)).toEqual(PAIR_LAYERS);
        expect(await r.layers('fr-FR')).toEqual(PAIR_LAYERS);
        // Unchanged: the pair's own address, and the base's member.
        expect(await r.layers('fr-FR', PAIR)).toEqual(PAIR_LAYERS);
        expect(await r.layers('en-US', BASE))
            .toEqual({ status: 200, code: SHIPPED_SUBJECT, overlay: null, effective: SHIPPED_SUBJECT });
    });

    it('the env-wide, base-scoped and executing lists carry the pair\'s `fr-FR` beside the base\'s `en-US`, so a `fr-FR` send renders it', async () => {
        expect(await r.listed()).toEqual([BASE_EN_ROW, PAIR_FR_ROW]);
        expect(await r.listed(BASE)).toEqual([BASE_EN_ROW, PAIR_FR_ROW]);
        expect(await r.executing()).toEqual([BASE_EN_ROW, PAIR_FR_ROW]);
        expect(await r.rendered('fr-FR')).toBe('Pair FR: T');
        expect(await r.rendered('en-US')).toBe('✅ Task done: T');
        // The list scoped to the pair is unchanged.
        expect(await r.listed(PAIR)).toEqual([PAIR_FR_ROW]);
    });

    it('a dependent\'s `fr-FR` beside it stays under the dependent; the base\'s address keeps serving the pair\'s', async () => {
        await r.createDependent();
        await r.publishInto(DEPENDENT, r.body('fr-FR', DEPENDENT_SUBJECT));

        expect(await r.byName('fr-FR', DEPENDENT)).toEqual(DEPENDENT_FR);
        expect(await r.byName('fr-FR', BASE)).toEqual(PAIR_FR);
        expect(await r.byName('fr-FR')).toEqual(PAIR_FR);
        expect(await r.layers('fr-FR', BASE))
            .toEqual({ status: 200, code: null, overlay: PAIR_SUBJECT, effective: PAIR_SUBJECT });
        expect(await r.listed()).toEqual([BASE_EN_ROW, PAIR_FR_ROW]);
        expect(await r.listed(BASE)).toEqual([BASE_EN_ROW, PAIR_FR_ROW]);
        expect(await r.executing()).toEqual([BASE_EN_ROW, PAIR_FR_ROW]);
        expect(await r.rendered('fr-FR')).toBe('Pair FR: T');
    });
});
