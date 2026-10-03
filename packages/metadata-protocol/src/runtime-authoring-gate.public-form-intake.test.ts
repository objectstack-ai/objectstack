// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21476 — the gate-local advisory for an open public form this deployment's
 * posture cannot take anonymous intake for.
 *
 * Both anonymous form doors withhold such a form, and the administrator's read
 * of the view states why (`@objectstack/rest`). This is the publish half: the
 * author who saves or publishes the form is told on the 2xx, as ONE `warning`
 * advisory located at the form's `sharing` and carrying the admin read's
 * reason — the same `@objectstack/metadata-core` export, so the same bytes.
 *
 * Harness: none. `evaluateRuntimeAuthoringGate` is pure — the posture in force
 * and the object universe arrive as arguments. The end-to-end rows through
 * `saveMetaItem` / `publishMetaItem` and a real `tenancy` service are in
 * `protocol.runtime-authoring-gate.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
    anonymousFormIntakeUnavailableMessage,
    anonymousFormIntakeUnavailableRemedy,
} from '@objectstack/metadata-core';

import {
    evaluateRuntimeAuthoringGate,
    PUBLIC_FORM_INTAKE_UNAVAILABLE,
} from './runtime-authoring-gate.js';

const SLUG = 'contact-us';
const SHARING = { enabled: true, allowAnonymous: true, publicLink: `/forms/${SLUG}` };

/** The object as the gate's live universe carries it: the registry injected `organization_id`. */
const inquiry = (extra: Record<string, unknown> = {}) => ({
    name: 'showcase_inquiry',
    label: 'Inquiry',
    fields: {
        organization_id: { type: 'lookup', reference: 'sys_organization' },
        name: { type: 'text', label: 'Name' },
        email: { type: 'email', label: 'Email' },
    },
    ...extra,
});

/** The showcase's contact form: a container whose public form is `formViews.contact`. */
const contactContainer = (sharing: Record<string, unknown> = SHARING) => ({
    list: { type: 'grid', data: { provider: 'object', object: 'showcase_inquiry' }, columns: [{ field: 'name' }] },
    formViews: {
        contact: {
            type: 'simple',
            data: { provider: 'object', object: 'showcase_inquiry' },
            sections: [{ name: 'about', fields: [{ field: 'name' }, { field: 'email' }] }],
            sharing,
        },
    },
});

const judge = (over: Partial<Parameters<typeof evaluateRuntimeAuthoringGate>[0]> = {}) =>
    evaluateRuntimeAuthoringGate({
        type: 'view',
        name: 'showcase_inquiry',
        state: 'active',
        body: contactContainer(),
        objects: [inquiry()],
        tenancyPostureInForce: 'isolated',
        ...over,
    });

const intakeAdvisories = (verdict: ReturnType<typeof evaluateRuntimeAuthoringGate>) =>
    verdict.advisories.filter((a) => a.rule === PUBLIC_FORM_INTAKE_UNAVAILABLE);

describe('#21476 — public-form intake advisory (pure gate)', () => {
    for (const posture of ['isolated', 'group'] as const) {
        it(`'${posture}', walled object: exactly one warning, at the form's sharing, with the admin read's reason`, () => {
            const verdict = judge({ tenancyPostureInForce: posture });
            expect(verdict.error).toBeNull();
            expect(verdict.advisories).toHaveLength(1);
            const facts = { object: 'showcase_inquiry', posture, tenantField: 'organization_id' };
            expect(verdict.advisories[0]).toEqual({
                severity: 'warning',
                rule: PUBLIC_FORM_INTAKE_UNAVAILABLE,
                where: `view "showcase_inquiry" · public form "/forms/${SLUG}"`,
                path: 'views[0].formViews.contact.sharing',
                message: anonymousFormIntakeUnavailableMessage(SLUG, facts),
                hint: anonymousFormIntakeUnavailableRemedy(facts),
            });
        });
    }

    it('locates each form shape at its own sharing: nested form, flattened form item', () => {
        const nested = { form: { data: { object: 'showcase_inquiry' }, sharing: SHARING } };
        expect(intakeAdvisories(judge({ body: nested })).map((a) => a.path)).toEqual(['views[0].form.sharing']);
        const flat = { name: 'showcase_inquiry.contact', viewKind: 'form', object: 'showcase_inquiry', config: { sharing: SHARING } };
        expect(intakeAdvisories(judge({ name: 'showcase_inquiry.contact', body: flat })).map((a) => a.path))
            .toEqual(['views[0].config.sharing']);
    });

    it('a pending object in the same batch is judged by its EFFECTIVE schema (no declared organization_id)', () => {
        const pendingRaw = { name: 'showcase_inquiry', fields: { name: { type: 'text' } } };
        const verdict = judge({ objects: [], pending: { objects: [pendingRaw], permissions: [], books: [], datasets: [] } });
        expect(intakeAdvisories(verdict)).toHaveLength(1);
    });

    it.each<[string, Partial<Parameters<typeof evaluateRuntimeAuthoringGate>[0]>]>([
        ['an object declared tenancy: { enabled: false }', { objects: [inquiry({ tenancy: { enabled: false } })] }],
        ["the 'single' posture (a degraded walled request reads single in force)", { tenancyPostureInForce: 'single' }],
        ['no tenancy service (no posture in force)', { tenancyPostureInForce: undefined }],
        ['a form withdrawn from anonymous intake', { body: contactContainer({ ...SHARING, allowAnonymous: false }) }],
        ['a draft save (drafts are never gated, #4463 D1)', { state: 'draft' }],
        ['a non-view write', { type: 'page', body: { name: 'landing', kind: 'html', source: '<div />' } }],
    ])('CONTROL — %s: no advisory', (_label, over) => {
        const verdict = judge(over);
        expect(verdict.error).toBeNull();
        expect(intakeAdvisories(verdict)).toEqual([]);
    });

    it('the requested posture does not move it: orgWallEnforced true with single in force raises nothing', () => {
        expect(intakeAdvisories(judge({ orgWallEnforced: true, tenancyPostureInForce: 'single' }))).toEqual([]);
    });

    it('a refused view write discloses the rule among the rules that ran', () => {
        // A flattened list overlay sorting by a field the object does not have:
        // refused by the shared sort rule, so the verdict carries `rulesRun`.
        const verdict = judge({
            name: 'showcase_inquiry.custom',
            body: {
                name: 'showcase_inquiry.custom', object: 'showcase_inquiry', viewKind: 'list', type: 'grid',
                columns: ['name'], sort: [{ field: 'amout', order: 'desc' }],
            },
        });
        const err = verdict.error as { code?: string; status?: number; rulesRun?: string[] } | null;
        expect([err?.code, err?.status]).toEqual(['INVALID_METADATA', 422]);
        expect(err?.rulesRun).toContain(PUBLIC_FORM_INTAKE_UNAVAILABLE);
    });
});
