// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import * as specUi from '@objectstack/spec/ui';
import { SharingConfigSchema } from '@objectstack/spec/ui';
import {
    anonymousFormIntakeCandidates,
    anonymousFormIntakePosture,
    anonymousFormIntakeSlug,
    anonymousFormIntakeSlugs,
    anonymousFormIntakeUnavailability,
    anonymousFormIntakeUnavailableMessage,
    anonymousFormIntakeUnavailableRemedy,
    anonymousFormIntakeWithdrawnIn,
    anonymousFormObjectName,
    anonymousFormSharingPath,
    publicFormSlug,
} from './anonymous-form-intake.js';
import * as intakeModule from './anonymous-form-intake.js';
import * as metadataCore from './index.js';

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

describe('anonymousFormIntakeWithdrawnIn — an explicit withdrawal of the same row\'s form at any layer closes it', () => {
    const view = (sharing: unknown, name = 'contact') => ({
        name, object: 'inquiry', viewKind: 'form', config: { sharing },
    });
    const openView = view(OPEN);
    const [candidate] = anonymousFormIntakeCandidates(openView);

    it('the same row, the link kept with a switch explicitly false: withdrawn', () => {
        expect(anonymousFormIntakeWithdrawnIn([view({ ...OPEN, allowAnonymous: false })], openView, candidate)).toBe(true);
        expect(anonymousFormIntakeWithdrawnIn([view({ ...OPEN, enabled: false })], openView, candidate)).toBe(true);
    });

    it('only an explicit false withdraws: an absent switch is not a withdrawal', () => {
        // publicLink + enabled:true, allowAnonymous absent: not a withdrawal.
        expect(anonymousFormIntakeWithdrawnIn(
            [view({ enabled: true, publicLink: '/forms/contact-us' })], openView, candidate,
        )).toBe(false);
        expect(anonymousFormIntakeWithdrawnIn(
            [view({ allowAnonymous: true, publicLink: '/forms/contact-us' })], openView, candidate,
        )).toBe(false);
    });

    it('two different rows sharing a slug do not close each other', () => {
        const other = view({ ...OPEN, enabled: false }, 'legacy_contact');
        expect(anonymousFormIntakeWithdrawnIn([openView, other], openView, candidate)).toBe(false);
        const [otherOpen] = anonymousFormIntakeCandidates(view(OPEN, 'legacy_contact'));
        expect(anonymousFormIntakeWithdrawnIn(
            [view({ ...OPEN, enabled: false }), view(OPEN, 'legacy_contact')], view(OPEN, 'legacy_contact'), otherOpen,
        )).toBe(false);
    });

    // Known limit (fails closed): the package a body is bound to is not
    // compared, so a withdrawal of a name closes that name in every package.
    describe('the package is not compared: a withdrawal of a name closes it in every package', () => {
        const bound = (body: Record<string, unknown>, pkg: string) => ({ ...body, _packageId: pkg });
        const withdrawn = view({ ...OPEN, enabled: false });

        it('another package\'s withdrawal of the same name closes this package\'s form too', () => {
            const openA = bound(openView, 'pkg_a');
            const [c] = anonymousFormIntakeCandidates(openA);
            expect(anonymousFormIntakeWithdrawnIn([bound(withdrawn, 'pkg_b')], openA, c)).toBe(true);
            // Another package's OPEN body of the name withdraws nothing.
            expect(anonymousFormIntakeWithdrawnIn([bound(openView, 'pkg_b')], openA, c)).toBe(false);
        });

        it('the same package\'s withdrawal of the same name closes it', () => {
            const openA = bound(openView, 'pkg_a');
            const [c] = anonymousFormIntakeCandidates(openA);
            expect(anonymousFormIntakeWithdrawnIn([bound(withdrawn, 'pkg_a')], openA, c)).toBe(true);
            // Beside another package's open body of that name: still closed.
            expect(anonymousFormIntakeWithdrawnIn([bound(openView, 'pkg_b'), bound(withdrawn, 'pkg_a')], openA, c))
                .toBe(true);
        });

        it('a body bound to no package stands in for every package\'s row of the name, on either side', () => {
            const openA = bound(openView, 'pkg_a');
            const [c] = anonymousFormIntakeCandidates(openA);
            expect(anonymousFormIntakeWithdrawnIn([withdrawn], openA, c)).toBe(true);
            expect(anonymousFormIntakeWithdrawnIn([bound(withdrawn, 'pkg_b')], openView, candidate)).toBe(true);
            expect(anonymousFormIntakeWithdrawnIn([withdrawn], openView, candidate)).toBe(true);
        });
    });

    it('not a withdrawal: no body of the row, no sharing, the link cleared', () => {
        expect(anonymousFormIntakeWithdrawnIn([openView], openView, candidate)).toBe(false);
        expect(anonymousFormIntakeWithdrawnIn([], openView, candidate)).toBe(false);
        expect(anonymousFormIntakeWithdrawnIn([view(undefined)], openView, candidate)).toBe(false);
        expect(anonymousFormIntakeWithdrawnIn([view({ enabled: false, allowAnonymous: false })], openView, candidate)).toBe(false);
        expect(anonymousFormIntakeWithdrawnIn([view({ ...OPEN, enabled: false, publicLink: '' })], openView, candidate)).toBe(false);
    });

    it('a schema-parsed sharing with no public link is not a withdrawal, as its raw body is not', () => {
        for (const raw of [{ password: 'secret' }, { allowedDomains: ['example.com'] }, { enabled: true }]) {
            const parsed = SharingConfigSchema.parse(raw);
            expect(parsed.enabled === true && parsed.allowAnonymous === true).toBe(false);
            expect(anonymousFormIntakeWithdrawnIn([view(parsed)], openView, candidate)).toBe(false);
            expect(anonymousFormIntakeWithdrawnIn([view(raw)], openView, candidate)).toBe(false);
        }
    });

    it('a schema-parsed `false` that keeps the link IS a withdrawal (a package artifact fails closed)', () => {
        // A package artifact is served as parsed, and the schema defaults
        // `enabled` to false: a shipped sharing that keeps its link and never
        // switches `enabled` on carries an explicit `false` once parsed. That is
        // a withdrawal. Its raw body, with the switch absent, is not one.
        const raw = { allowAnonymous: true, publicLink: '/forms/contact-us' };
        const parsed = SharingConfigSchema.parse(raw);
        expect(parsed.enabled).toBe(false);
        expect(anonymousFormIntakeWithdrawnIn([view(parsed)], openView, candidate)).toBe(true);
        expect(anonymousFormIntakeWithdrawnIn([view(raw)], openView, candidate)).toBe(false);
    });

    it('the same slot with a new slug (case-only included) is the same form: closed', () => {
        const withdrawn = [view({ ...OPEN, enabled: false })];
        for (const link of ['/forms/contact-us-2', '/forms/Contact-Us']) {
            const moved = view({ ...OPEN, publicLink: link });
            const [c] = anonymousFormIntakeCandidates(moved);
            expect(anonymousFormIntakeWithdrawnIn(withdrawn, moved, c)).toBe(true);
        }
    });

    describe('a container row: identity survives a key rename, form.name, a slot move and an expansion rename', () => {
        const LINK_A = { ...OPEN, publicLink: '/forms/a' };
        const LINK_B = { ...OPEN, publicLink: '/forms/b' };
        const row = (body: Record<string, unknown>) => ({ name: 'inquiry', object: 'inquiry', ...body });
        // Env-wide: formViews.a withdrawn, formViews.b open.
        const envRow = row({ formViews: { a: { sharing: { ...LINK_A, enabled: false } }, b: { sharing: LINK_B } } });
        const closedIn = (overlay: Record<string, unknown>) =>
            anonymousFormIntakeCandidates(overlay)
                .filter((c) => anonymousFormIntakeWithdrawnIn([envRow], overlay, c))
                .map((c) => c.slug);

        it('a key rename keeps the slug: closed', () => {
            expect(closedIn(row({ formViews: { a2: { sharing: LINK_A }, b: { sharing: LINK_B } } }))).toEqual(['a']);
        });
        it('a slot move to the nested form, with a form.name: closed', () => {
            expect(closedIn(row({ form: { name: 'renamed', sharing: LINK_A }, formViews: { b: { sharing: LINK_B } } })))
                .toEqual(['a']);
        });
        it('a listViews entry that collides with the key (an expansion rename): closed', () => {
            expect(closedIn(row({ listViews: { a: { type: 'grid' } }, formViews: { a: { sharing: LINK_A } } })))
                .toEqual(['a']);
        });
        it('the sibling form (another slot and another slug) stays independent', () => {
            expect(closedIn(row({ formViews: { a: { sharing: { ...LINK_A, enabled: false } }, b: { sharing: LINK_B } } })))
                .toEqual([]);
        });
    });
});

// The candidates half is declared in `@objectstack/spec/ui` and re-exported by
// this package. "One copy" is checkable only as IDENTITY: a wrapper or a copy
// answers the same today and drifts tomorrow, while the same binding cannot.
describe('the candidates half is the spec binding itself, re-exported (one copy, not a copy)', () => {
    const NAMES = [
        'publicFormSlug',
        'anonymousFormIntakeSlug',
        'anonymousFormIntakeCandidates',
        'anonymousFormIntakeSlugs',
    ] as const;

    it.each(NAMES)('%s: this module and the package barrel export the @objectstack/spec/ui function', (name) => {
        expect(typeof specUi[name]).toBe('function');
        expect(intakeModule[name]).toBe(specUi[name]);
        expect(metadataCore[name]).toBe(specUi[name]);
    });
});
