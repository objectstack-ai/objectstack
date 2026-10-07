// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SharingConfigSchema } from './sharing.zod';
import {
  anonymousFormIntakeCandidates,
  anonymousFormIntakeSlug,
  anonymousFormIntakeSlugs,
  publicFormSlug,
} from './anonymous-form-intake';
import * as uiEntry from './index';

// The candidates half of the anonymous-intake rule, as the spec declares it.
// `@objectstack/metadata-core` re-exports these exact bindings to the server's
// doors (pinned there by identity), so what this file pins is what the doors
// serve and what a console importing `@objectstack/spec/ui` reads.

const OPEN = { enabled: true, allowAnonymous: true, publicLink: '/forms/contact-us' };

describe('the /ui entry exports the candidates half', () => {
  it.each([
    'publicFormSlug',
    'anonymousFormIntakeSlug',
    'anonymousFormIntakeCandidates',
    'anonymousFormIntakeSlugs',
  ] as const)('%s is the module function', (name) => {
    expect(typeof uiEntry[name]).toBe('function');
  });

  it('the same bindings, not copies', () => {
    expect(uiEntry.publicFormSlug).toBe(publicFormSlug);
    expect(uiEntry.anonymousFormIntakeSlug).toBe(anonymousFormIntakeSlug);
    expect(uiEntry.anonymousFormIntakeCandidates).toBe(anonymousFormIntakeCandidates);
    expect(uiEntry.anonymousFormIntakeSlugs).toBe(anonymousFormIntakeSlugs);
  });
});

describe('anonymousFormIntakeSlug: which sharing opens a form to anonymous intake', () => {
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

  it('publicFormSlug: `/forms/x`, `forms/x`, `x` and extra leading slashes are one slug', () => {
    expect(['/forms/x', 'forms/x', 'x', '//forms/x'].map(publicFormSlug)).toEqual(['x', 'x', 'x', 'x']);
  });
});

describe('anonymousFormIntakeCandidates / anonymousFormIntakeSlugs: each of the three shapes alone', () => {
  // One row per shape a view carries a form in; each is judged open and then
  // withdrawn through either switch.
  const SHAPES: Array<[string, (sharing: Record<string, unknown>) => Record<string, unknown>, string | undefined]> = [
    ['the nested form', (sharing) => ({ name: 'inquiry.default', form: { sharing } }), undefined],
    ['a formViews entry', (sharing) => ({ name: 'inquiry', formViews: { contact: { sharing } } }), 'contact'],
    [
      "a viewKind: 'form' item's config",
      (sharing) => ({ name: 'inquiry.contact', object: 'inquiry', viewKind: 'form', config: { sharing } }),
      'inquiry.contact',
    ],
  ];

  it.each(SHAPES)('%s: open', (_label, build, key) => {
    const view = build(OPEN);
    const c = anonymousFormIntakeCandidates(view);
    expect(c).toHaveLength(1);
    expect(c[0].key).toBe(key);
    expect('key' in c[0]).toBe(key !== undefined);
    expect(c[0].slug).toBe('contact-us');
    expect(c[0].form.sharing).toBe(OPEN);
    expect(anonymousFormIntakeSlugs(view)).toEqual(['contact-us']);
  });

  it.each(SHAPES)('%s: withdrawn through either switch, or with no link', (_label, build) => {
    for (const sharing of [{ ...OPEN, enabled: false }, { ...OPEN, allowAnonymous: false }, { enabled: true, allowAnonymous: true }]) {
      expect(anonymousFormIntakeCandidates(build(sharing))).toEqual([]);
      expect(anonymousFormIntakeSlugs(build(sharing))).toEqual([]);
    }
  });

  it("a config without viewKind: 'form' is not a form", () => {
    expect(anonymousFormIntakeCandidates({ name: 'inquiry.grid', viewKind: 'list', config: { sharing: OPEN } })).toEqual([]);
    expect(anonymousFormIntakeCandidates({ name: 'inquiry.grid', config: { sharing: OPEN } })).toEqual([]);
  });
});

describe('anonymousFormIntakeCandidates / anonymousFormIntakeSlugs: all three shapes in one body', () => {
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

  it('scans the nested form, every formViews entry and the flattened config, in that order, open ones only', () => {
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
    expect(anonymousFormIntakeSlugs('view')).toEqual([]);
    expect(anonymousFormIntakeSlugs({ formViews: { x: null } })).toEqual([]);
  });
});
