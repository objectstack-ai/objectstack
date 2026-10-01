// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21120] The stored-metadata-body FAMILY enumeration pin.
 *
 * A stored metadata body (`sys_metadata` / `sys_metadata_history`'s `metadata`
 * column — a datasource body's credential material included) is a write-only
 * secret: every surface that can SERVE, COPY or EVALUATE it must either project
 * it through the one shared redaction seam
 * (`@objectstack/spec/kernel`'s `redactStoredMetadataBody` family) or refuse.
 * This pin is the family's enumeration: it fails when a NEW surface appears
 * uncovered, instead of letting it join the family silently.
 *
 * Two mechanical teeth, plus the cross-package ledger the per-package pins hold:
 *
 *  1. **The object set is the family boundary.** The two tables, and only those,
 *     carry a stored body — pinned here so a third object silently gaining a
 *     `metadata` body column, or the set drifting, fails.
 *  2. **The generic data door's exposed verbs are all covered.** Each stored-
 *     body object's declared `enable.apiMethods` must be a verb this pin knows is
 *     covered (read → the redaction seam; a write verb is refused outright, as
 *     these tables admit none). A new verb added to either object fails here
 *     until it is classified as seam-covered or refused.
 *
 * The non-data-door surfaces each carry their own per-package pin, named in
 * {@link FAMILY_SURFACES} so the whole family is enumerated in one place:
 *  - audit / activity copy → `@objectstack/plugin-audit`
 *    (`stored-metadata-body-migration.test.ts`, and `audit-writers.test.ts`);
 *  - analytics members → `@objectstack/service-analytics`
 *    (`stored-metadata-body-refusal.test.ts`);
 *  - realtime `data.record.*` events → `@objectstack/objectql`
 *    (`engine-realtime-stored-metadata-body.test.ts`);
 *  - the generic data door reads / groupBy / filter+sort → this package
 *    (`protocol.data-door-stored-metadata-redaction.test.ts`, and the behaviour
 *    asserted below).
 */

import { describe, expect, it } from 'vitest';
import { SysMetadataObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import {
  isStoredMetadataBodyObject,
  STORED_METADATA_BODY_OBJECTS,
  STORED_METADATA_BODY_COLUMN,
} from '@objectstack/spec/kernel';
import {
  redactStoredMetadataRow,
  storedMetadataBodyGroupingRefusal,
  storedMetadataBodyPredicateRefusal,
} from './metadata-redaction.js';

/** The generic data-door verbs this family's seam covers, and how. */
const COVERED_DATA_DOOR_METHODS: Record<string, string> = {
  get: 'getData → redactStoredMetadataRow (the row body is projected through the shared redactor)',
  list: 'findData → redactStoredMetadataRows, plus the groupBy / filter / sort refusals on the body column',
};

/** The whole family, one surface per row — each either goes through the seam or refuses. */
const FAMILY_SURFACES = [
  { surface: 'data door: get / list reads', disposition: 'seam', pin: 'this package' },
  { surface: 'data door: groupBy on the body column', disposition: 'refuses', pin: 'this package' },
  { surface: 'data door: filter / sort on the body column', disposition: 'refuses', pin: 'this package' },
  { surface: 'audit / activity copy at write time', disposition: 'seam', pin: '@objectstack/plugin-audit' },
  { surface: 'analytics members on the body column', disposition: 'refuses', pin: '@objectstack/service-analytics' },
  { surface: 'realtime data.record.* event body', disposition: 'seam', pin: '@objectstack/objectql' },
] as const;

/** A stored datasource body as it sits in the `metadata` column: serialized JSON with credential material. */
const CREDENTIAL = 'pin-stored-cred-7f3a';
const storedDatasourceRow = (object = 'sys_metadata') => ({
  id: 'x',
  type: 'datasource',
  [STORED_METADATA_BODY_COLUMN]: JSON.stringify({
    name: 'ds',
    driver: 'turso',
    config: { url: 'libsql://db.turso.io', encryptionKey: CREDENTIAL },
  }),
  __object: object,
});

describe('[#21120] stored-metadata-body family — the object set is the boundary', () => {
  it('names exactly the two body tables, and the predicate agrees', () => {
    expect([...STORED_METADATA_BODY_OBJECTS].sort()).toEqual(['sys_metadata', 'sys_metadata_history']);
    for (const name of STORED_METADATA_BODY_OBJECTS) expect(isStoredMetadataBodyObject(name)).toBe(true);
    expect(isStoredMetadataBodyObject('sys_metadata_audit')).toBe(false);
    expect(isStoredMetadataBodyObject('sys_metadata_commit')).toBe(false);
  });

  it('every object in the set actually declares a `metadata` column (the body it protects)', () => {
    const defs: Record<string, any> = {
      sys_metadata: SysMetadataObject,
      sys_metadata_history: SysMetadataHistoryObject,
    };
    for (const name of STORED_METADATA_BODY_OBJECTS) {
      const def = defs[name];
      expect(def, `the pin knows the definition of ${name}`).toBeDefined();
      expect(
        def.fields?.[STORED_METADATA_BODY_COLUMN],
        `${name} must declare the '${STORED_METADATA_BODY_COLUMN}' column this family redacts`,
      ).toBeDefined();
    }
  });
});

describe('[#21120] stored-metadata-body family — the data door exposes only covered verbs', () => {
  it('every declared apiMethod on a stored-body object is a covered read verb (no silent new surface)', () => {
    const objects: Array<[string, any]> = [
      ['sys_metadata', SysMetadataObject],
      ['sys_metadata_history', SysMetadataHistoryObject],
    ];
    for (const [name, def] of objects) {
      const methods: string[] = def.enable?.apiMethods ?? [];
      for (const method of methods) {
        expect(
          COVERED_DATA_DOOR_METHODS[method],
          `generic data-door verb '${method}' on ${name} is not classified by the family pin — ` +
            `route it through the shared redaction seam or refuse it, then add it to ` +
            `COVERED_DATA_DOOR_METHODS. A new serve surface must not join the family silently.`,
        ).toBeTruthy();
      }
      // These tables admit no write verb — a write would be a new accept surface.
      for (const write of ['create', 'update', 'delete']) {
        expect(methods, `${name} must not expose the '${write}' verb`).not.toContain(write);
      }
    }
  });

  it('enumerates every family surface with a disposition (seam | refuses) and an owning pin', () => {
    for (const s of FAMILY_SURFACES) {
      expect(['seam', 'refuses']).toContain(s.disposition);
      expect(s.pin.length).toBeGreaterThan(0);
    }
    // One row per the three local data-door surfaces + three cross-package ones.
    expect(FAMILY_SURFACES).toHaveLength(6);
  });
});

describe('[#21120] stored-metadata-body family — the local surfaces behave', () => {
  it('data-door read: the body is projected, credential withheld', () => {
    for (const name of STORED_METADATA_BODY_OBJECTS) {
      const served = redactStoredMetadataRow(name, storedDatasourceRow(name));
      expect(JSON.stringify(served)).not.toContain(CREDENTIAL);
    }
  });

  it('data-door groupBy on the body column refuses (INVALID_FIELD / 400)', () => {
    const err = storedMetadataBodyGroupingRefusal('sys_metadata', ['metadata']) as any;
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INVALID_FIELD');
    expect(err.status).toBe(400);
    expect(err.field).toBe(STORED_METADATA_BODY_COLUMN);
    // A scalar grouping is untouched.
    expect(storedMetadataBodyGroupingRefusal('sys_metadata', ['type'])).toBeUndefined();
  });

  it('data-door filter and sort on the body column refuse (INVALID_FIELD / 400)', () => {
    const filterErr = storedMetadataBodyPredicateRefusal('sys_metadata', {
      filterFields: ['metadata'],
    }) as any;
    expect(filterErr?.code).toBe('INVALID_FIELD');
    expect(filterErr?.status).toBe(400);
    expect(filterErr?.param).toBe('filter');

    const sortErr = storedMetadataBodyPredicateRefusal('sys_metadata_history', {
      sortFields: ['metadata'],
    }) as any;
    expect(sortErr?.param).toBe('sort');

    // Scalar filter / sort, and an object outside the set, are untouched.
    expect(storedMetadataBodyPredicateRefusal('sys_metadata', { filterFields: ['type'], sortFields: ['name'] }))
      .toBeUndefined();
    expect(storedMetadataBodyPredicateRefusal('showcase_task', { filterFields: ['metadata'] })).toBeUndefined();
  });
});
