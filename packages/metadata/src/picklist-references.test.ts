// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `unreferencedResidualPicklists` — the one residual-picklist judgement the
 * engine's `manifest` service throws and `os validate` / `os build` report.
 *
 * Pinned here on the judgement itself: which residual lists it refuses (none a
 * body field, a body's `objectExtensions` field, a body's nested `plugins[]`
 * field or a residual object's field names), what it reads as a body, and the
 * shape that serves both doors — one plural sentence for the engine, one
 * wording per list, located, for the doors. The doors' own pins are
 * objectql's `registration-refusal-one-spelling.test.ts` and the CLI's
 * `picklist-references.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { collectManifestPicklistReferences, unreferencedResidualPicklists, type ResidualPicklistInput } from './picklist-references.js';

const OWNER = 'com.example.release';
const pickedField = (picklist: string) => ({ status: { type: 'select', label: 'Status', picklist } });

/** A residual with these top-level picklists (at `picklists[i]`) and objects. */
const residual = (lists: string[], objects: unknown[] = [], ownerId: string | undefined = OWNER): ResidualPicklistInput => ({
  ownerId,
  items: [
    ...lists.map((name, index) => ({ field: 'picklists', index, type: 'picklist', item: { name, label: name, options: [] } })),
    ...objects.map((item, index) => ({ field: 'objects', index, type: 'object', item })),
  ],
});

describe('unreferencedResidualPicklists — which residual lists are refused', () => {
  it('refuses a residual list nothing names, located at its top-level index', () => {
    const judged = unreferencedResidualPicklists(residual(['used', 'unused']), [{ objects: [{ name: 'a', fields: pickedField('used') }] }]);
    expect(judged?.owner).toBe(OWNER);
    expect(judged?.picklists.map(({ name, field, index }) => ({ name, field, index })))
      .toEqual([{ name: 'unused', field: 'picklists', index: 1 }]);
  });

  it.each([
    ['a body object\'s field (array spelling)', [{ objects: [{ name: 'a', fields: pickedField('l') }] }], []],
    ['a body object\'s field (name-keyed spelling, fields as an array)', [{ objects: { a: { fields: [{ name: 'status', picklist: 'l' }] } } }], []],
    ['a body `objectExtensions` field', [{ objectExtensions: [{ extend: 'a', fields: pickedField('l') }] }], []],
    ['a body\'s nested `plugins[]` object field', [{ plugins: [{ name: 'p', objects: [{ name: 'a', fields: pickedField('l') }] }] }], []],
    ['a residual object\'s field', [], [{ name: 'n', fields: pickedField('l') }]],
  ])('CONTROL: a list named by %s is not refused', (_label, bodies, objects) => {
    expect(unreferencedResidualPicklists(residual(['l'], objects), bodies)).toBeUndefined();
  });

  it('a body `picklistExtensions` entry names nothing: the list it extends is still refused', () => {
    expect(unreferencedResidualPicklists(residual(['l']), [{ picklistExtensions: [{ extend: 'l', options: [] }] }])?.picklists)
      .toHaveLength(1);
  });

  it('CONTROL: no residual (a stack without `packages[]`) and a residual with no picklist refuse nothing', () => {
    expect(unreferencedResidualPicklists(undefined, [])).toBeUndefined();
    expect(unreferencedResidualPicklists(residual([], [{ name: 'n', fields: {} }]), [])).toBeUndefined();
  });

  it('"named" is the walk the engine registers by — `collectManifestPicklistReferences`', () => {
    const bodies = [{ objects: [{ name: 'a', fields: pickedField('x') }], plugins: [{ objects: [{ name: 'b', fields: pickedField('y') }] }] }];
    expect(collectManifestPicklistReferences(bodies[0], undefined).map((r) => r.picklist)).toEqual(['x', 'y']);
    expect(unreferencedResidualPicklists(residual(['x', 'y', 'z']), bodies)?.picklists.map((p) => p.name)).toEqual(['z']);
  });
});

describe('unreferencedResidualPicklists — the words, for both doors', () => {
  it('one list: the engine\'s sentence is the list\'s own judgement and prescription', () => {
    const judged = unreferencedResidualPicklists(residual(['solo']), [])!;
    const [only] = judged.picklists;
    expect(only.wording).toEqual(judged.wording);
    expect(judged.wording.text).toBe(`${judged.wording.judgement} ${judged.wording.prescription}`);
    expect(judged.wording.judgement).toMatch(
      new RegExp(`^Picklist 'solo' is declared on the top level of stack '${OWNER.replace(/\./g, '\\.')}', and no package body declares it and no object field the engine registers names it `),
    );
    expect(judged.wording.prescription).toMatch(/^Declare it inside the `packages\[\]` entry of the package whose objects use it;/);
  });

  it('several lists: one plural sentence for the engine, and each list its own singular words for the doors', () => {
    const judged = unreferencedResidualPicklists(residual(['one', 'two']), [])!;
    expect(judged.wording.judgement).toMatch(/^Picklists 'one', 'two' are declared on the top level of stack .*declares them and no object field the engine registers names them /);
    expect(judged.picklists.map((p) => p.wording.judgement.split(' is declared')[0])).toEqual(["Picklist 'one'", "Picklist 'two'"]);
  });

  it('a stack with no id is named as `<none>`', () => {
    expect(unreferencedResidualPicklists(residual(['solo'], [], undefined), [])?.owner).toBe('<none>');
  });
});
