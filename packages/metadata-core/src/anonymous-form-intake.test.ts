// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SharingConfigSchema } from '@objectstack/spec/ui';
import {
    anonymousFormIntakeCandidates,
    anonymousFormIntakePosture,
    anonymousFormIntakeSlug,
    anonymousFormIntakeSlugs,
    anonymousFormIntakeUnavailability,
    anonymousFormIntakeUnavailableMessage,
    anonymousFormIntakeUnavailableRemedy,
    anonymousFormObjectName,
    anonymousFormSharingPath,
    publicFormSlug,
} from './anonymous-form-intake.js';

const OPEN = { enabled: true, allowAnonymous: true, publicLink: '/forms/contact-us' };

describe('anonymousFormIntakeSlug — which sharing opens a form to anonymous intake', () => {
    it('both switches on and a publicLink: open, slug normalised', () => {
        expect(anonymousFormIntakeSlug(OPEN)).toBe('contact-us');
        expect(anonymousFormIntakeSlug({ ...OPEN, publicLink: 'forms/contact-us' })).toBe('contact-us');
        expect(anonymousFormIntakeSlug({ ...OPEN, publicLink: 'contact-us' })).toBe('contact-us');
    });

    it.each<[string, Record<string, unknown>]>([
        ['enabled: false', { ...OPEN, enabled: false }],
        ['enabled absent', { allowAnonymous: true, publicLink: '/forms/contact-us' }],
        ['allowAnonymous: false', { ...OPEN, allowAnonymous: false }],
        ['allowAnonymous absent', { enabled: true, publicLink: '/forms/contact-us' }],
        ['publicLink absent', { enabled: true, allowAnonymous: true }],
        ['publicLink empty', { ...OPEN, publicLink: '' }],
        ['a truthy non-boolean switch', { ...OPEN, enabled: 'true' }],
    ])('%s: closed', (_label, sharing) => {
        expect(anonymousFormIntakeSlug(sharing)).toBeNull();
    });

    it('a raw body and its parse get the same answer (the schema defaults `enabled` to false)', () => {
        for (const raw of [OPEN, { allowAnonymous: true, publicLink: '/forms/contact-us' }, { ...OPEN, enabled: false }]) {
            expect(anonymousFormIntakeSlug(SharingConfigSchema.parse(raw))).toBe(anonymousFormIntakeSlug(raw));
        }
    });

    it('not an object: closed', () => {
        expect(anonymousFormIntakeSlug(undefined)).toBeNull();
        expect(anonymousFormIntakeSlug(null)).toBeNull();
        expect(anonymousFormIntakeSlug('x')).toBeNull();
    });
});

describe('anonymousFormIntakeCandidates / anonymousFormIntakeSlugs — the three form shapes of a view', () => {
    const view = (sharing: Record<string, unknown>) => ({
        name: 'inquiry.contact',
        object: 'inquiry',
        form: { data: { object: 'inquiry' }, sharing: { ...sharing, publicLink: '/forms/nested' } },
        formViews: {
            a: { sharing: { ...sharing, publicLink: '/forms/a' } },
            b: { sharing: { ...OPEN, enabled: false, publicLink: '/forms/b' } },
        },
        viewKind: 'form',
        config: { sharing: { ...sharing, publicLink: 'forms/flat' } },
    });

    it('scans the nested form, every formViews entry and the flattened config, open ones only', () => {
        const c = anonymousFormIntakeCandidates(view(OPEN));
        expect(c.map((x) => [x.key, x.slug])).toEqual([
            [undefined, 'nested'],
            ['a', 'a'],
            ['inquiry.contact', 'flat'],
        ]);
        expect(anonymousFormIntakeSlugs(view(OPEN))).toEqual(['a', 'flat', 'nested']);
    });

    it('withdrawn through either switch: no candidate on any shape', () => {
        expect(anonymousFormIntakeSlugs(view({ ...OPEN, enabled: false }))).toEqual([]);
        expect(anonymousFormIntakeSlugs(view({ ...OPEN, allowAnonymous: false }))).toEqual([]);
    });

    it('de-duplicates and sorts slugs; tolerates non-object input', () => {
        expect(anonymousFormIntakeSlugs({ formViews: { x: { sharing: OPEN }, y: { sharing: { ...OPEN, publicLink: 'contact-us' } } } }))
            .toEqual(['contact-us']);
        expect(anonymousFormIntakeSlugs(null)).toEqual([]);
        expect(anonymousFormIntakeSlugs({ formViews: { x: null } })).toEqual([]);
        expect(publicFormSlug('//forms/x')).toBe('x');
    });
});

// [#21476] Whether an open form can take an anonymous submission on this
// posture — the one predicate both anonymous doors, the admin read and the
// runtime authoring gate's advisory read.
describe('anonymousFormIntakeUnavailability — the intake-availability predicate', () => {
    /** The object as a served document carries it: the registry injects `organization_id`. */
    const served = (extra: Record<string, unknown> = {}) => ({
        name: 'inquiry',
        fields: { organization_id: { type: 'lookup', reference: 'sys_organization' }, email: { type: 'text' } },
        ...extra,
    });
    /** The same object as a stored or pending body carries it: declared fields only. */
    const raw = (extra: Record<string, unknown> = {}) => ({ name: 'inquiry', fields: { email: { type: 'text' } }, ...extra });

    it.each(['isolated', 'group'] as const)("'%s': a walled object is unavailable, naming the object, the posture and the column", (posture) => {
        expect(anonymousFormIntakeUnavailability('inquiry', posture, () => served()))
            .toEqual({ object: 'inquiry', posture, tenantField: 'organization_id' });
    });

    it('judges the EFFECTIVE schema: a stored body with no declared organization_id is walled all the same', () => {
        expect(anonymousFormIntakeUnavailability('inquiry', 'isolated', () => raw()))
            .toEqual({ object: 'inquiry', posture: 'isolated', tenantField: 'organization_id' });
    });

    it('a declared tenancy.tenantField the object really has is the column named', () => {
        const schema = served({ tenancy: { tenantField: 'company_id' }, fields: { company_id: { type: 'text' } } });
        expect(anonymousFormIntakeUnavailability('inquiry', 'isolated', () => schema)?.tenantField).toBe('company_id');
    });

    it.each<[string, unknown]>([
        ['tenancy: { enabled: false } (ADR-0066)', served({ tenancy: { enabled: false } })],
        ['an object the universe does not hold', undefined],
        ['an object with no fields record and no wall', { name: 'inquiry', systemFields: false }],
    ])('CONTROL, walled posture — %s: available', (_label, schema) => {
        expect(anonymousFormIntakeUnavailability('inquiry', 'isolated', () => schema)).toBeNull();
    });

    it.each<[string, 'single' | undefined]>([
        ["the 'single' posture", 'single'],
        ['no tenancy service (no posture)', undefined],
    ])('CONTROL — %s: available, and the object is never read', (_label, posture) => {
        let reads = 0;
        expect(anonymousFormIntakeUnavailability('inquiry', posture, () => { reads += 1; return served(); })).toBeNull();
        expect(reads).toBe(0);
    });

    it('an asynchronous reader gets a promise when a wall is in force, and null without reading otherwise', async () => {
        const walled = anonymousFormIntakeUnavailability('inquiry', 'group', async () => served());
        expect(walled).toBeInstanceOf(Promise);
        expect(await walled).toEqual({ object: 'inquiry', posture: 'group', tenantField: 'organization_id' });
        expect(anonymousFormIntakeUnavailability('inquiry', 'single', async () => served())).toBeNull();
    });
});

describe('anonymousFormIntakePosture — the posture IN FORCE, as the tenancy service reports it', () => {
    it('reads `posture`, never `requestedPosture`: a degraded walled request is single', () => {
        expect(anonymousFormIntakePosture({ posture: 'single', requestedPosture: 'isolated' })).toBe('single');
        expect(anonymousFormIntakePosture({ posture: 'group' })).toBe('group');
        expect(anonymousFormIntakePosture({ posture: 'multi' })).toBe('isolated');
    });

    it('no service, or no recognisable posture: undefined', () => {
        for (const tenancy of [undefined, null, {}, { posture: 'walled' }, 'isolated']) {
            expect(anonymousFormIntakePosture(tenancy)).toBeUndefined();
        }
    });
});

describe('where the reason is located, and the reason itself', () => {
    it('anonymousFormSharingPath: form.sharing, formViews.KEY.sharing, config.sharing', () => {
        const view = {
            name: 'inquiry.contact',
            form: { sharing: { ...OPEN, publicLink: '/forms/nested' } },
            formViews: { contact: { sharing: { ...OPEN, publicLink: '/forms/a' } } },
            viewKind: 'form',
            config: { sharing: { ...OPEN, publicLink: '/forms/flat' } },
        };
        expect(anonymousFormIntakeCandidates(view).map((c) => anonymousFormSharingPath(view, c)))
            .toEqual(['form.sharing', 'formViews.contact.sharing', 'config.sharing']);
    });

    it('anonymousFormObjectName: the form\'s own data.object first, then the view\'s', () => {
        const view = { object: 'v_obj', list: { data: { object: 'list_obj' } } };
        expect(anonymousFormObjectName(view, { data: { object: 'form_obj' } })).toBe('form_obj');
        expect(anonymousFormObjectName(view, {})).toBe('list_obj');
        expect(anonymousFormObjectName({ object: 'v_obj' }, {})).toBe('v_obj');
        expect(anonymousFormObjectName(undefined, undefined)).toBeUndefined();
    });

    it('the message names the slug, the object, the column and the posture, and ends with the remedy', () => {
        const u = { object: 'inquiry', posture: 'isolated' as const, tenantField: 'organization_id' };
        const message = anonymousFormIntakeUnavailableMessage('contact-us', u);
        for (const named of ["'/forms/contact-us'", "'inquiry'", "'organization_id'", "'isolated'"]) {
            expect(message).toContain(named);
        }
        expect(anonymousFormIntakeUnavailableRemedy(u)).toContain('tenancy: { enabled: false }');
        expect(message.endsWith(` ${anonymousFormIntakeUnavailableRemedy(u)}`)).toBe(true);
    });
});
