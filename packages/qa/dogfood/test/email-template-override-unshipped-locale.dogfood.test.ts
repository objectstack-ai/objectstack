// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28746, ADR-0146 D2] A declared override of an email template locale the
// base does not ship is refused at the save door and at the per-item publish,
// over the real showcase composition and its HTTP doors.
//
// ## What was broken
//
// An email template is one item per `(name, locale)` (the bundle identity,
// `ITEM_KEY_DISCRIMINATORS`). The override write gate asked which closure
// packages ship the NAME, across every locale, so "the base ships this item"
// held for any locale. The showcase ships `showcase_task_done_email` in `en-US`
// only, yet its pair `com.example.showcase.custom` could save and publish an
// `fr-FR` body declaring `overrides: { package: 'com.example.showcase' }`, and
// the `fr-FR` "override" was served — an addition dressed as an override, with
// no base member for drift or "Restore package original" to compare against.
//
// ## What each case pins
//
//   - the save door refuses the `fr-FR` declaration `403 NOT_OVERRIDABLE`, and
//     nothing is stored or served for `fr-FR`;
//   - the per-item publish (`?member=fr-FR`) refuses a draft of that shape
//     stored before the gate, and still serves nothing for `fr-FR`;
//   - CONTROL: `en-US` (the member the base ships) declared from the pair is
//     saved, published and served;
//   - CONTROL: `fr-FR` WITHOUT `overrides` is the pair's own new member, saved,
//     published and served.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';
/** The template the showcase ships, in `en-US` only. */
const NAME = 'showcase_task_done_email';
const DECLARATION = { package: BASE, basedOn: '0.1.0' } as const;
/** The refusal's code — the save door answers it beside a string `error`, an enveloped door inside `error`. */
const codeOf = (json: any): unknown => json?.code ?? json?.error?.code;

describe('[#28746] a declared override of an email template locale the base does not ship (showcase)', () => {
    let stack: VerifyStack | undefined;
    let token: string;
    let shipped: Record<string, unknown>;

    const call = async (method: string, path: string, body?: unknown) => {
        const res = await stack!.apiAs(token, method, path, body);
        return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
    };
    /** `GET /meta/email_template/:name` at one member — the served document, unwrapped. */
    const served = async (member: string) => {
        const read = await call('GET', `/meta/email_template/${NAME}?member=${member}`);
        const doc = read.json?.data ?? read.json?.item ?? read.json;
        return { status: read.status, item: (doc?.item ?? doc) as Record<string, any> };
    };
    /** The pair's rows of the template, as the store holds them. */
    const pairRows = async () => {
        const ql: any = await stack!.kernel.getServiceAsync('objectql');
        const rows: any[] = await ql.find('sys_metadata', {
            where: { type: 'email_template', name: NAME, package_id: PAIR },
            context: { isSystem: true, positions: [], permissions: [] },
        });
        return rows.map((r) => [r.bundle_member ?? null, r.state]).sort((a, b) => String(a).localeCompare(String(b)));
    };
    const saveDraft = (body: Record<string, unknown>) =>
        call('PUT', `/meta/email_template/${NAME}?mode=draft&package=${PAIR}`, body);
    const publish = (member: string) =>
        call('POST', `/meta/email_template/${NAME}/publish?package=${PAIR}&member=${member}`, {});
    const body = (locale: string, subject: string, extra: Record<string, unknown> = {}) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(shipped)) if (!k.startsWith('_')) out[k] = v;
        return { ...out, locale, subject, ...extra };
    };

    beforeAll(async () => {
        stack = await bootShowcase();
        token = await stack.signIn();
        const read = await served('en-US');
        expect(read.status).toBe(200);
        shipped = read.item;
        const ensured = await call('POST', `/packages/${BASE}/ensure-customization`);
        expect([200, 201], JSON.stringify(ensured.json)).toContain(ensured.status);
    }, 180_000);

    afterAll(async () => {
        await stack?.stop();
    });

    it('the save door refuses an `fr-FR` override declared from the pair, and nothing is served for `fr-FR`', async () => {
        const saved = await saveDraft(body('fr-FR', 'Tâche terminée : {{title}}', { overrides: { ...DECLARATION } }));
        expect(saved.status, JSON.stringify(saved.json)).toBe(403);
        expect(codeOf(saved.json)).toBe('NOT_OVERRIDABLE');
        expect(await pairRows()).toEqual([]);
        expect((await served('fr-FR')).status).toBe(404);
    });

    it('the per-item publish refuses an `fr-FR` override draft stored before the gate, and nothing is served for `fr-FR`', async () => {
        // Lay the draft down as one stored before the gate: the same door with
        // the gate's verdict held at `not_concerned` for that one write.
        const protocol: any = await stack!.kernel.getServiceAsync('protocol');
        protocol.overrideWriteVerdict = () => ({ verdict: 'not_concerned' });
        try {
            const saved = await saveDraft(body('fr-FR', 'Tâche terminée : {{title}}', { overrides: { ...DECLARATION } }));
            expect(saved.status, JSON.stringify(saved.json)).toBe(200);
        } finally {
            delete protocol.overrideWriteVerdict;
        }
        expect(await pairRows()).toEqual([['fr-FR', 'draft']]);

        const published = await publish('fr-FR');
        expect(published.status, JSON.stringify(published.json)).toBe(403);
        expect(codeOf(published.json)).toBe('NOT_OVERRIDABLE');
        expect(await pairRows()).toEqual([['fr-FR', 'draft']]);
        expect((await served('fr-FR')).status).toBe(404);
    });

    it('control: the pair declares an override of `en-US`, the member the base ships, and it is served', async () => {
        const saved = await saveDraft(body('en-US', 'Override: {{title}}', { overrides: { ...DECLARATION } }));
        expect(saved.status, JSON.stringify(saved.json)).toBe(200);
        const published = await publish('en-US');
        expect(published.status, JSON.stringify(published.json)).toBe(200);
        expect(await served('en-US')).toMatchObject({ status: 200, item: { subject: 'Override: {{title}}' } });
    });

    it('control: `fr-FR` without `overrides` is the pair\'s own new member, and it is served', async () => {
        // The draft save replaces the refused draft above with the addition.
        const saved = await saveDraft(body('fr-FR', 'Ajout : {{title}}'));
        expect(saved.status, JSON.stringify(saved.json)).toBe(200);
        const published = await publish('fr-FR');
        expect(published.status, JSON.stringify(published.json)).toBe(200);
        expect(await served('fr-FR')).toMatchObject({ status: 200, item: { subject: 'Ajout : {{title}}' } });
    });
});
