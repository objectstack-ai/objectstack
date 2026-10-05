// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from './object.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { ObjectStackDefinitionSchema } from '../stack.zod';

// ---------------------------------------------------------------------------
// [#21182 — ruling A on objectstack-ai/hotcrm#1199] An object declares which
// of its fields is the record's picture: `imageField`, a sibling of
// `nameField`, naming a field of the SAME object whose type is `image` or
// `avatar`. Anything else is refused at the object door, which every
// authoring door parses through — so a bad pointer never reaches a reader,
// and no reader needs a tolerance for one.
//
// The pins bear weight in both directions: the two accepted types (and the
// key's absence) parse clean, and each refused shape is ONE located issue at
// `imageField`. The refusals are asserted by code and path, plus the named
// subjects an author greps for — the field it names and the two accepted
// types — never by the prose around them.
// ---------------------------------------------------------------------------

const account = (imageField: string | undefined, extra: Record<string, unknown> = {}) => ({
  name: 'crm_account',
  nameField: 'name',
  fields: {
    name: { type: 'text', label: 'Name' },
    logo: { type: 'image', label: 'Logo' },
    portrait: { type: 'avatar', label: 'Portrait' },
    website: { type: 'text', label: 'Website' },
    contract: { type: 'file', label: 'Contract' },
    ...extra,
  },
  ...(imageField === undefined ? {} : { imageField }),
});

/** The one issue a refused object must carry, located at `imageField`. */
function refusedAt(input: unknown) {
  const parsed = ObjectSchema.safeParse(input);
  expect(parsed.success, 'the declaration must NOT parse clean').toBe(false);
  if (parsed.success) throw new Error('unreachable');
  expect(parsed.error.issues).toHaveLength(1);
  const [issue] = parsed.error.issues;
  expect(issue.code).toBe('custom');
  expect(issue.path).toEqual(['imageField']);
  return issue;
}

describe('`imageField` names a declared `image` or `avatar` field of the same object', () => {
  it('accepts an `image` field (control)', () => {
    const parsed = ObjectSchema.safeParse(account('logo'));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.imageField).toBe('logo');
  });

  it('accepts an `avatar` field (control)', () => {
    const parsed = ObjectSchema.safeParse(account('portrait'));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.imageField).toBe('portrait');
  });

  it('is optional — an object that declares no picture parses clean (control)', () => {
    const parsed = ObjectSchema.safeParse(account(undefined));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.imageField).toBeUndefined();
  });

  it('refuses a name the object does not declare', () => {
    const issue = refusedAt(account('company_logo'));
    expect(issue.message).toContain('`company_logo`');
    expect(issue.message).toContain('`image`');
    expect(issue.message).toContain('`avatar`');
  });

  it('refuses a `text` field — a URL column is not a declared picture', () => {
    const issue = refusedAt(account('website'));
    expect(issue.message).toContain('`website`');
    expect(issue.message).toContain('`text`');
    expect(issue.message).toContain('`image`');
    expect(issue.message).toContain('`avatar`');
  });

  it('refuses a `file` field — the nearest neighbour type is still not a picture', () => {
    const issue = refusedAt(account('contract'));
    expect(issue.message).toContain('`file`');
  });

  it('does not resolve a JS prototype name as a declared field', () => {
    // `fields` is a plain record, so a lookup that walked the prototype chain
    // would read `toString` as present. The pointer must name an OWN key.
    refusedAt(account('toString'));
  });

  it('the authoring factory throws the same refusal, and accepts the same pointer', () => {
    expect(() => ObjectSchema.create({
      name: 'crm_account',
      fields: {
        name: { type: 'text', label: 'Name' },
        website: { type: 'text', label: 'Website' },
      },
      imageField: 'website',
    })).toThrow(/imageField/);

    const created = ObjectSchema.create({
      name: 'crm_account',
      fields: {
        name: { type: 'text', label: 'Name' },
        logo: { type: 'image', label: 'Logo' },
      },
      imageField: 'logo',
    });
    expect(created.imageField).toBe('logo');
  });

  it('the metadata save door resolves `object` to the schema that refuses it', () => {
    // `saveMetaItem` validates an `object` item against
    // `getMetadataTypeSchema('object')`; the refusal must ride that schema,
    // located at the same path the Studio form keys on.
    const schema = getMetadataTypeSchema('object');
    expect(schema).toBeDefined();
    const bad = schema!.safeParse(account('website'));
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(bad.error.issues.map((i) => [i.code, i.path])).toEqual([['custom', ['imageField']]]);
    expect(schema!.safeParse(account('logo')).success).toBe(true);
  });

  it('the stack door refuses it inside `objects`, located at the object', () => {
    const manifest = {
      id: 'com.example.imagefield',
      name: 'image-field-test',
      version: '1.0.0',
      type: 'app' as const,
      namespace: 'crm',
    };
    const bad = ObjectStackDefinitionSchema.safeParse({ manifest, objects: [account('company_logo')] });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(bad.error.issues.map((i) => [i.code, i.path])).toEqual([['custom', ['objects', 0, 'imageField']]]);

    const good = ObjectStackDefinitionSchema.safeParse({ manifest, objects: [account('logo')] });
    expect(good.success, good.success ? '' : JSON.stringify(good.error.issues)).toBe(true);
  });
});
