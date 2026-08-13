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
    // `validation` left this list with the kind (#4509, ADR-0088) — rules are
    // authored inside an object's `validations:`, never created standalone.
    for (const t of ['dashboard', 'action', 'page', 'view', 'flow', 'hook', 'dataset', 'object']) {
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
      'app', 'seed', 'job', 'datasource', 'doc', 'book',
      'permission', 'position', 'agent', 'tool', 'skill', 'email_template',
      // [#7893] `field` is code-only by declaration as of 2026-08-12
      // (`allowRuntimeCreate: false` + `allowOrgOverride: false`, ADR-0049
      // remove side): a standalone `field` write minted a row no read path
      // ever composed into its parent object, so there is no runtime create
      // surface for a create seed to seed. A pre-filled "New Field" form whose
      // save can only 403 is the UI half of the same false compliance. Fields
      // are authored inside their object — `object` has the create seed, and
      // its `fields: {}` is where a new field goes. Same category as
      // `capability` / `api`, not deferred work.
      'field',
      // [#5961] `capability` is code-only by declaration
      // (`allowRuntimeCreate: false` + `allowOrgOverride: false`, ADR-0066 D1):
      // there is no runtime create surface for a create seed to seed. It is on
      // this list for `job`/`agent`'s reason, not as deferred work.
      'capability',
      // [#5488] `api` joined them on 2026-08-09 (maintainer ruling
      // 2026-08-07T16:59Z). It HAD a seed (#5271) and lost it with the runtime
      // create door: `PUT /api/v1/meta/api/:name` now 403s `NOT_CREATABLE`
      // before validation, so a minimal create literal has no create to serve.
      // Endpoints are authored as stack artifacts and shipped via
      // `publishPackage`. Same category as `capability`, not deferred work.
      'api',
    ]);
    const seeded = new Set(listMetadataCreateSeedTypes());
    const missing = listMetadataTypeSchemaTypes().filter((t) => !seeded.has(t) && !KNOWN_UNSEEDED.has(t));
    // eslint-disable-next-line no-console
    if (missing.length) console.log(`[create-seeds] schema'd types still needing a seed: ${missing.join(', ')}`);
    expect(missing, `unaccounted schema'd types without a seed: ${missing.join(', ')}`).toEqual([]);
  });
});
