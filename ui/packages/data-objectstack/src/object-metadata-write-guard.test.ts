// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8676 — the object-metadata write invariant, pinned at the DOOR.
 *
 * The companion halves, each pinning something this file cannot:
 *
 *  - `object-metadata-write-guard.derivation.test.ts` DERIVES the relationship
 *    and choice type sets from the installed `@objectstack/spec` and asserts
 *    they equal the arrays the guard keeps, so neither list can go stale
 *    silently.
 *  - `metadata-client.objectWriteGuard.test.ts` pins the DOOR: that
 *    `MetadataClient.save` reaches this function, and that a refused body issues
 *    NO REQUEST. A guard nothing calls is the defect objectui#8676 is about, so
 *    "the function refuses" and "the door calls it" are pinned apart on purpose.
 *  - `scripts/check-object-metadata-write-doors.mjs` answers COVERAGE — whether
 *    every door reaches it at all.
 *
 * ⚠ What every negative case below is measured against: a LIT CONTROL that runs
 * the same call with a usable target and observes it return. An assertion never
 * observed to pass on the accepting side would be satisfied by a guard that
 * refuses everything, which is the caricature this invariant must not become.
 */

import { describe, expect, it } from 'vitest';
import {
  assertObjectMetadataWritable,
  CHOICE_TYPES_REQUIRING_OPTIONS,
  OBJECT_METADATA_TYPE,
  RELATIONSHIP_TYPES_REQUIRING_REFERENCE,
} from './object-metadata-write-guard';

const objectWith = (fields: unknown) => ({ name: 'account', label: 'Account', fields });

/** The message a refused call throws; a call that does not throw fails the test. */
function messageOf(call: () => void): string {
  try {
    call();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected the guard to refuse this body');
}

/**
 * Code an author cannot act on (objectui#11785): a door's class or function
 * name, a package name, or a tracker id. The rationale for each rule stays in
 * the module's docblock, out of the runtime string.
 */
const NAMES_CODE = /MetadataClient|MetadataService|importObjectDraft|@objectstack|objectstack#|objectui#|#\d+/;

describe('assertObjectMetadataWritable — the four states of an unusable target', () => {
  // The four states the contract distinguishes, each measured against
  // `ObjectSchema` by the derivation pin. The guard must refuse all four,
  // because all four reach the server as the same 422.
  const unusable: Array<[string, unknown]> = [
    ['absent', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace only', '   '],
  ];

  for (const [label, reference] of unusable) {
    it(`refuses a lookup whose reference is ${label}`, () => {
      const body = objectWith({
        title: { type: 'text', label: 'Title' },
        owner: reference === undefined
          ? { type: 'lookup', label: 'Owner' }
          : { type: 'lookup', label: 'Owner', reference },
      });
      expect(() => assertObjectMetadataWritable('object', body, 'TEST')).toThrow(/`owner`/);
    });
  }

  it('CONTROL — a usable target is written, so the guard is not simply always refusing', () => {
    const body = objectWith({
      title: { type: 'text', label: 'Title' },
      owner: { type: 'lookup', label: 'Owner', reference: 'account' },
    });
    expect(() => assertObjectMetadataWritable('object', body, 'TEST')).not.toThrow();
  });

  it('names WHICH of the four states it saw, so the message is actionable on screen', () => {
    const absent = objectWith({ owner: { type: 'lookup', label: 'Owner' } });
    const blank = objectWith({ owner: { type: 'lookup', label: 'Owner', reference: '   ' } });
    expect(() => assertObjectMetadataWritable('object', absent, 'TEST'))
      .toThrow(/no `reference` key at all/);
    expect(() => assertObjectMetadataWritable('object', blank, 'TEST'))
      .toThrow(/whitespace-only `reference`/);
  });

  it('reads the same at every door and names no code (objectui#11785)', () => {
    const body = objectWith({ owner: { type: 'lookup', label: 'Owner' } });
    const at = (door: string) => messageOf(() => assertObjectMetadataWritable('object', body, door));
    expect(at('MetadataClient.save')).toBe(at('importObjectDraft'));
    expect(at('MetadataClient.save')).not.toMatch(NAMES_CODE);
  });
});

describe('assertObjectMetadataWritable — every relationship type, and only those', () => {
  it('covers each member of the derived set rather than `lookup` alone', () => {
    // The set is not spelled here: this reads whatever the guard declares, so a
    // type added to it is covered by this pin the moment it is added.
    expect(RELATIONSHIP_TYPES_REQUIRING_REFERENCE.length).toBeGreaterThan(0);
    for (const type of RELATIONSHIP_TYPES_REQUIRING_REFERENCE) {
      const body = objectWith({ rel: { type, label: 'R' } });
      expect(() => assertObjectMetadataWritable('object', body, 'TEST')).toThrow(/`rel`/);
      const ok = objectWith({ rel: { type, label: 'R', reference: 'account' } });
      expect(() => assertObjectMetadataWritable('object', ok, 'TEST')).not.toThrow();
    }
  });

  it('says nothing about a NON-relationship field with no reference', () => {
    // ⛔ The counter-case to a guard that drifted into revalidating the document:
    // a `text` field has no target and must sail straight through.
    const body = objectWith({ title: { type: 'text', label: 'Title' } });
    expect(() => assertObjectMetadataWritable('object', body, 'TEST')).not.toThrow();
  });
});

describe('assertObjectMetadataWritable — both `fields` shapes a writer can hand the door', () => {
  it('reads the ARRAY shape, which one whole designer surface PUTs verbatim', () => {
    const body = objectWith([
      { name: 'title', type: 'text', label: 'Title' },
      { name: 'owner', type: 'lookup', label: 'Owner' },
    ]);
    expect(() => assertObjectMetadataWritable('object', body, 'TEST')).toThrow(/`owner`/);
  });

  it('CONTROL — the same array with a usable target passes', () => {
    const body = objectWith([
      { name: 'title', type: 'text', label: 'Title' },
      { name: 'owner', type: 'lookup', label: 'Owner', reference: 'account' },
    ]);
    expect(() => assertObjectMetadataWritable('object', body, 'TEST')).not.toThrow();
  });

  it('names an array entry by its POSITION when it carries no name', () => {
    const body = objectWith([{ type: 'lookup', label: 'Owner' }]);
    expect(() => assertObjectMetadataWritable('object', body, 'TEST')).toThrow(/\[0\]/);
  });
});

describe('assertObjectMetadataWritable — everything it deliberately does not judge', () => {
  it('is a no-op for every metadata type other than `object`', () => {
    // This door serves `view`, `app`, `flow`, `hook`, `permission` and
    // `dashboard` writes too. A `lookup`-shaped key inside one of those is not
    // this invariant's business, and refusing it would be the door overreaching.
    const body = objectWith({ owner: { type: 'lookup', label: 'Owner' } });
    for (const type of ['view', 'app', 'flow', 'permission', 'hook', 'dashboard']) {
      expect(() => assertObjectMetadataWritable(type, body, 'TEST')).not.toThrow();
    }
    // ...and the constant naming the one type it does judge is the same one.
    expect(() => assertObjectMetadataWritable(OBJECT_METADATA_TYPE, body, 'TEST')).toThrow();
  });

  it('is a no-op for a body that carries no readable `fields`', () => {
    for (const body of [undefined, null, 'not an object', 42, {}, { fields: null }, { fields: 7 }]) {
      expect(() => assertObjectMetadataWritable('object', body, 'TEST')).not.toThrow();
    }
  });

  it('⛔ does NOT strip the offending field and report success', () => {
    // objectstack#4001's silent-drop shape, ruled out for this family twice.
    // The body must come back unchanged; the only outcome is a throw.
    const fields = { owner: { type: 'lookup', label: 'Owner' } };
    const body = objectWith(fields);
    expect(() => assertObjectMetadataWritable('object', body, 'TEST')).toThrow();
    expect(body.fields).toBe(fields);
    expect(Object.keys(fields)).toEqual(['owner']);
  });
});

describe('assertObjectMetadataWritable — a choice field needs an option source (objectui#11253)', () => {
  // The ruling's predicate (objectstack#20827, ruling A): "a `select` / `radio`
  // with neither `options` nor `picklist`". An empty list is no source — the
  // derivation pin measures that against the contract's own completeness rule.
  const noSource: Array<[string, Record<string, unknown>]> = [
    ['`options` absent', {}],
    ['`options: []`', { options: [] }],
    ['`options: null`', { options: null }],
  ];

  for (const type of CHOICE_TYPES_REQUIRING_OPTIONS) {
    for (const [label, extra] of noSource) {
      it(`refuses a \`${type}\` with ${label}, naming the field`, () => {
        const body = objectWith({
          title: { type: 'text', label: 'Title' },
          stage: { type, label: 'Stage', ...extra },
        });
        expect(() => assertObjectMetadataWritable('object', body, 'TEST')).toThrow(/`stage`/);
        expect(() => assertObjectMetadataWritable('object', body, 'TEST')).toThrow(/with no options/);
      });
    }

    it(`CONTROL — a \`${type}\` with one option passes`, () => {
      const body = objectWith({ stage: { type, label: 'Stage', options: [{ label: 'Open', value: 'open' }] } });
      expect(() => assertObjectMetadataWritable('object', body, 'TEST')).not.toThrow();
    });

    it(`a \`${type}\` that names a shared \`picklist\` passes, with or without an empty list`, () => {
      // ⛔ Never refuse a field that carries `picklist`: that is the other half
      // of the ruling's "neither", and the server judges the name it carries.
      const bare = objectWith({ stage: { type, label: 'Stage', picklist: 'deal_stage' } });
      const withEmpty = objectWith({ stage: { type, label: 'Stage', picklist: 'deal_stage', options: [] } });
      expect(() => assertObjectMetadataWritable('object', bare, 'TEST')).not.toThrow();
      expect(() => assertObjectMetadataWritable('object', withEmpty, 'TEST')).not.toThrow();
    });
  }

  it('covers each member of the derived set and says which state it saw', () => {
    expect(CHOICE_TYPES_REQUIRING_OPTIONS.length).toBeGreaterThan(0);
    const absent = objectWith({ stage: { type: 'select', label: 'Stage' } });
    const empty = objectWith({ stage: { type: 'select', label: 'Stage', options: [] } });
    expect(() => assertObjectMetadataWritable('object', absent, 'TEST')).toThrow(/no `options` key and no `picklist`/);
    expect(() => assertObjectMetadataWritable('object', empty, 'TEST')).toThrow(/an empty `options` list and no `picklist`/);
  });

  it('reads the ARRAY `fields` shape the Studio data page PUTs', () => {
    const body = objectWith([
      { name: 'title', type: 'text', label: 'Title' },
      { name: 'field_2', type: 'select', label: 'New field' },
    ]);
    expect(() => assertObjectMetadataWritable('object', body, 'TEST')).toThrow(/`field_2`/);
  });

  it('reads the same at every door and names no code (objectui#11785)', () => {
    const body = objectWith({ stage: { type: 'radio', label: 'Stage' } });
    const at = (door: string) => messageOf(() => assertObjectMetadataWritable('object', body, door));
    expect(at('MetadataClient.save')).toBe(at('MetadataService'));
    expect(at('MetadataClient.save')).not.toMatch(NAMES_CODE);
  });

  it('says nothing about the multi-choice types the ruling does not name', () => {
    // ⛔ The counter-case to a guard that drifted past its ruling: the door
    // refuses `select` / `radio` only. `multiselect` / `tags` are free-form
    // without options, and ADR-0078 grades `checkboxes` a warning.
    for (const type of ['multiselect', 'checkboxes', 'tags']) {
      const body = objectWith({ stage: { type, label: 'Stage' } });
      expect(() => assertObjectMetadataWritable('object', body, 'TEST')).not.toThrow();
    }
  });

  it('is a no-op for every metadata type other than `object`', () => {
    const body = objectWith({ stage: { type: 'select', label: 'Stage' } });
    for (const type of ['view', 'app', 'flow', 'permission', 'hook', 'dashboard']) {
      expect(() => assertObjectMetadataWritable(type, body, 'TEST')).not.toThrow();
    }
    expect(() => assertObjectMetadataWritable(OBJECT_METADATA_TYPE, body, 'TEST')).toThrow();
  });
});
