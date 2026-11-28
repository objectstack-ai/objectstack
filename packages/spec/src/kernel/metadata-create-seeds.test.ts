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
      'permission', 'position', 'agent', 'tool', 'skill', 'ai_context', 'email_template',
      // [#7893] `field` is code-only by declaration as of 2026-08-12
      // (`allowRuntimeCreate: false` + `allowEnvironmentOverlay: false`, ADR-0049
      // remove side): a standalone `field` write minted a row no read path
      // ever composed into its parent object, so there is no runtime create
      // surface for a create seed to seed. A pre-filled "New Field" form whose
      // save can only 403 is the UI half of the same false compliance. Fields
      // are authored inside their object — `object` has the create seed, and
      // its `fields: {}` is where a new field goes. Same category as
      // `capability` / `api`, not deferred work.
      'field',
      // [#5961, #35157] `capability` is runtime-creatable (an unmanaged copy
      // carries its app's capabilities) but has no Studio designer: it is
      // created by the install copy or a `/meta` save, never from a blank form.
      // It sits here with `permission` and `position`, not as deferred work.
      'capability',
      // [#5488] `api` joined them on 2026-08-09 (maintainer ruling
      // 2026-08-07T16:59Z). It HAD a seed (#5271) and lost it with the runtime
      // create door: `PUT /api/v1/meta/api/:name` now 403s `NOT_CREATABLE`
      // before validation, so a minimal create literal has no create to serve.
      // Endpoints are authored as stack artifacts and shipped via
      // `publishPackage`. Same category as `capability`, not deferred work.
      'api',
      // `picklist` is package-owned (`allowRuntimeCreate: false`): there is no
      // runtime create surface to seed. Same category as `api`.
      'picklist',
      // [ADR-0131 D6] `sharing_rule` is code-only (regime C): an organization
      // authors its own rules through the sharing door, not `/meta`. Same
      // category as `api`.
      'sharing_rule',
      // [ADR-0142 D1/D5] `queue` and `assignment_rule` are code-only (regime C,
      // `allowRuntimeCreate: false`): an organization staffs its own queues as
      // `sys_queue` rows in Setup, and assignment rules are declared only
      // (merge question 11). Same category as `sharing_rule`.
      'queue',
      'assignment_rule',
      // [ADR-0159 card ②] `form` is runtime-creatable (a `/meta/form` save) but
      // Studio has no form designer for it yet: the console keeps reading forms
      // from `view` until card ③ (#37087), which brings the designer and its
      // seed. Deferred work, named here so it is not a silent gap.
      'form',
      // [ADR-0161 K4, K5] `knowledge_source` is runtime-creatable, and its
      // create seed is deferred work with a name: it lands with the Studio
      // form (row 5 of #37000). The type's object binding and its content list
      // sit inside `source`, and K5 makes `content` non-empty, so a seed that
      // passes the schema carries a placeholder object AND a placeholder field
      // there. The Studio create flow takes placeholder identity out only at
      // the top level (objectui#12810), so it would save both into a new
      // source. Until the form builds `source` from the author's input, a
      // source is created by a `/meta` or MCP save, or shipped in a package.
      'knowledge_source',
    ]);
    const seeded = new Set(listMetadataCreateSeedTypes());
    const missing = listMetadataTypeSchemaTypes().filter((t) => !seeded.has(t) && !KNOWN_UNSEEDED.has(t));
    // eslint-disable-next-line no-console
    if (missing.length) console.log(`[create-seeds] schema'd types still needing a seed: ${missing.join(', ')}`);
    expect(missing, `unaccounted schema'd types without a seed: ${missing.join(', ')}`).toEqual([]);
  });
});
