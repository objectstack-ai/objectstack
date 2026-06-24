// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  getMetadataCreateSeed,
  listMetadataCreateSeedTypes,
} from './metadata-create-seeds';
import {
  getMetadataTypeSchema,
  listMetadataTypeSchemaTypes,
} from './metadata-type-schemas';

/**
 * THE canonical guard for the "designer create shape ≠ spec required" family:
 * every authoritative minimal create seed MUST validate against its type's
 * spec schema. If a schema tightens a requirement (e.g. action's `body`,
 * dashboard's old `layout`), the matching seed fails here — right next to the
 * schema — instead of 422-ing only when a user clicks Save in Studio.
 */
describe('metadata create seeds validate against their spec schemas', () => {
  for (const type of listMetadataCreateSeedTypes()) {
    it(`${type}: minimal create seed is spec-valid`, () => {
      const schema = getMetadataTypeSchema(type);
      expect(schema, `no schema registered for seeded type '${type}'`).toBeDefined();
      const seed = getMetadataCreateSeed(type);
      const result = schema!.safeParse(seed);
      expect(
        result.success,
        result.success ? '' : `seed for '${type}' rejected: ${JSON.stringify(result.error.issues)}`,
      ).toBe(true);
    });
  }

  it('sanity: seeds the core Studio-designer types', () => {
    const seeded = new Set(listMetadataCreateSeedTypes());
    for (const t of ['dashboard', 'action', 'page', 'view', 'flow', 'validation', 'hook', 'dataset', 'object']) {
      expect(seeded.has(t), `core type '${t}' has no create seed`).toBe(true);
    }
  });

  it('getMetadataCreateSeed returns a fresh clone (callers may mutate)', () => {
    const a = getMetadataCreateSeed('dashboard') as { widgets: unknown[] };
    const b = getMetadataCreateSeed('dashboard') as { widgets: unknown[] };
    expect(a).not.toBe(b);
    a.widgets.push({});
    expect((getMetadataCreateSeed('dashboard') as { widgets: unknown[] }).widgets).toHaveLength(0);
  });

  it('surfaces schema-backed authorable types still missing a seed (no silent cap)', () => {
    // Types that have a runtime-editable schema but no create seed yet. Canvas-
    // create types (report builds its dataset on the canvas) and code-only /
    // identity types legitimately have no static minimal create literal.
    const KNOWN_UNSEEDED = new Set([
      'report',        // canvas-create: dataset/measures picked interactively
      'app', 'field', 'seed', 'job', 'datasource', 'translation', 'doc', 'book',
      'permission', 'profile', 'role', 'agent', 'tool', 'skill', 'email_template',
    ]);
    const seeded = new Set(listMetadataCreateSeedTypes());
    const missing = listMetadataTypeSchemaTypes().filter((t) => !seeded.has(t) && !KNOWN_UNSEEDED.has(t));
    // eslint-disable-next-line no-console
    if (missing.length) console.log(`[create-seeds] schema'd types still needing a seed: ${missing.join(', ')}`);
    expect(missing, `unaccounted schema'd types without a seed: ${missing.join(', ')}`).toEqual([]);
  });
});
