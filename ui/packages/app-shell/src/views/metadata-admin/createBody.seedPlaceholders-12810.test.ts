// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12810 — the enumeration pin over every spec create seed.
 *
 * The spec's create-seed module says each seed carries placeholder identity
 * (`name` / `label` / object binding) and that "a create flow overrides those
 * from user input". For EVERY entry `listMetadataCreateSeedTypes()` lists, this
 * file asserts that each placeholder identity the seed carries is either
 * overridden from user input by `buildCreateModeBody` (the author's value, or
 * none — never the seed's) or refused at save (`unsetSeedPlaceholders`, for a
 * key the type requires; an empty `name` has the save path's own refusal).
 *
 * `PLACEHOLDERS` below is the per-type status listing. A seed added later, or
 * a seed that gains a placeholder, turns the first test red until it is
 * listed here, and the rest then judge it. A placeholder nested where
 * `buildCreateModeBody` cannot take it out (it only drops top-level keys)
 * turns the second test red.
 *
 * The placeholder values are read from the spec (`getMetadataCreateSeed`),
 * never restated. `required` is read from the type's spec schema as JSON
 * schema, the shape the live `/meta/types` entry serves.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  getMetadataCreateSeed,
  getMetadataTypeSchema,
  listMetadataCreateSeedTypes,
} from '@objectstack/spec/kernel';
import {
  buildCreateModeBody,
  seedPlaceholderKeys,
  specSeedPlaceholderObjects,
  unsetSeedPlaceholders,
} from './createBody';
import { registerBuiltinAnchors } from './anchors';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { resolveResourceConfig } from './registry';

/**
 * Per seed type: its placeholder identity keys, and what happens to each when
 * the author leaves it unset — `refused` (the save is refused at the client),
 * `name` (the save path's empty-name refusal), `omitted` (not required by the
 * type: saved without it), or `built` (the type's `createBuildBody` builds the
 * body from the draft alone; the seed is not read).
 */
const PLACEHOLDERS: Record<string, Record<string, 'refused' | 'name' | 'omitted' | 'built'>> = {
  action: { name: 'name', label: 'refused' },
  agent: { name: 'name', label: 'refused' },
  dashboard: { name: 'name', label: 'refused' },
  dataset: { name: 'name', label: 'refused', object: 'refused' },
  email_template: { name: 'name', label: 'refused' },
  flow: { name: 'name', label: 'refused' },
  hook: { name: 'name', label: 'omitted', object: 'refused' },
  mapping: { name: 'name', label: 'omitted', targetObject: 'refused' },
  object: { name: 'name', label: 'omitted' },
  page: { name: 'name', label: 'refused', object: 'omitted' },
  permission: { name: 'name', label: 'omitted' },
  skill: { name: 'name', label: 'refused' },
  tool: { name: 'name', label: 'refused' },
  translation: { name: 'name', label: 'omitted' },
  view: { name: 'built', object: 'built', label: 'built' },
};

const seedOf = (type: string) => getMetadataCreateSeed(type) as Record<string, unknown>;

function requiredOf(type: string): string[] {
  const json = z.toJSONSchema(getMetadataTypeSchema(type) as z.ZodType, {
    io: 'input',
    unrepresentable: 'any',
  }) as { required?: string[] };
  return json.required ?? [];
}

/** Every path in `value` whose leaf is one of the spec's placeholder objects. */
function placeholderObjectPaths(value: unknown, path: string[] = []): string[] {
  const objects = specSeedPlaceholderObjects();
  if (typeof value === 'string') {
    // A qualified name built from the placeholder (`<placeholder>.new_view`).
    const head = value.split('.')[0]!;
    return objects.has(value) || objects.has(head) ? [path.join('.')] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => placeholderObjectPaths(v, [...path, String(i)]));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => placeholderObjectPaths(v, [...path, k]));
  }
  return [];
}

/** The draft a create form starts from, as the page builds it. */
function pristineDraft(type: string): Record<string, unknown> {
  const config = resolveResourceConfig(type);
  return { ...(config.createDefaults ?? {}), [config.identityField ?? 'name']: '' };
}

beforeAll(() => {
  registerDefaultMetadataSchemas();
  registerBuiltinAnchors();
});

describe('every spec create seed: placeholder identity is overridden or refused (objectui#12810)', () => {
  it('the spec placeholder object is read from the seeds, and every seed type is listed with its placeholders', () => {
    expect(specSeedPlaceholderObjects().size).toBe(1);
    const types = listMetadataCreateSeedTypes();
    expect(types.length).toBeGreaterThan(0);
    const listed = Object.fromEntries(types.map((type) => [type, seedPlaceholderKeys(seedOf(type)).sort()]));
    const expected = Object.fromEntries(
      Object.entries(PLACEHOLDERS).map(([type, keys]) => [type, Object.keys(keys).sort()]),
    );
    expect(listed).toEqual(expected);
  });

  it('a placeholder object sits only where the create flow takes it out', () => {
    for (const type of listMetadataCreateSeedTypes()) {
      const seed = seedOf(type);
      const config = resolveResourceConfig(type);
      const topLevel = new Set(seedPlaceholderKeys(seed));
      for (const path of placeholderObjectPaths(seed)) {
        const handled = !!config.createBuildBody || topLevel.has(path);
        expect({ type, path, handled }).toEqual({ type, path, handled: true });
      }
    }
  });

  it.each(Object.keys(PLACEHOLDERS))(
    '%s: an author who sets nothing gets no seed placeholder in the body, and a required one is refused',
    (type) => {
      const seed = seedOf(type);
      const config = resolveResourceConfig(type);
      const identityField = config.identityField ?? 'name';
      const draft = pristineDraft(type);
      const body = buildCreateModeBody(config, draft, seed);

      // No placeholder value survives, anywhere in the body.
      expect(placeholderObjectPaths(body)).toEqual([]);
      for (const key of Object.keys(PLACEHOLDERS[type]!)) {
        if (typeof seed[key] === 'string' && seed[key] !== '') {
          expect({ type, key, value: body[key] }).not.toEqual({ type, key, value: seed[key] });
        }
      }

      const refused = unsetSeedPlaceholders(config, body, seed, requiredOf(type), identityField);
      for (const [key, fate] of Object.entries(PLACEHOLDERS[type]!)) {
        if (fate === 'refused') expect(refused).toContain(key);
        else expect(refused).not.toContain(key);
        if (fate === 'name') expect(body[key]).toBe('');
        if (fate === 'omitted') expect(body).not.toHaveProperty(key);
      }
    },
  );

  it.each(Object.keys(PLACEHOLDERS))(
    '%s (control): the author\'s values are carried, nothing is refused, and the seed\'s structural defaults are kept',
    (type) => {
      const seed = seedOf(type);
      const config = resolveResourceConfig(type);
      const identityField = config.identityField ?? 'name';
      const authored: Record<string, unknown> = { ...pristineDraft(type) };
      for (const key of Object.keys(PLACEHOLDERS[type]!)) {
        authored[key] = key === 'label' ? 'Probe Item' : key === 'name' ? 'probe_item' : 'crm_account';
      }
      const body = buildCreateModeBody(config, authored, seed);
      expect(unsetSeedPlaceholders(config, body, seed, requiredOf(type), identityField)).toEqual([]);
      expect(placeholderObjectPaths(body)).toEqual([]);
      if (config.createBuildBody) return;
      for (const key of Object.keys(PLACEHOLDERS[type]!)) expect(body[key]).toBe(authored[key]);
      // Every non-placeholder seed default the draft does not set is kept.
      for (const [key, value] of Object.entries(seed)) {
        if (key in PLACEHOLDERS[type]! || key in authored) continue;
        expect({ type, key, value: body[key] }).toEqual({ type, key, value });
      }
    },
  );

  it('dataset: the seed\'s `count` measure is kept while its placeholder binding is not', () => {
    const seed = seedOf('dataset');
    const body = buildCreateModeBody(resolveResourceConfig('dataset'), { name: 'probe_ds', label: 'Probe Ds' }, seed);
    expect(body.measures).toEqual(seed.measures);
    expect(body.dimensions).toEqual(seed.dimensions);
    expect(body).not.toHaveProperty('object');
  });
});
