/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34901 — the reader of `_withheldFields`, the served object's
 * note of the fields a disabled package withholds from it.
 */
import { describe, it, expect } from 'vitest';
import {
  NO_WITHHELD_FIELDS,
  readWithheldFieldNames,
  refersToWithheldField,
  withheldFieldNamesOfFieldMap,
} from '../withheld-fields';

const marked = () => ({
  name: 'crm_expense',
  fields: { name: { type: 'text' } },
  _withheldFields: { crm_project: { packageId: 'com.example.projects' } },
});

describe('readWithheldFieldNames (objectstack#34901)', () => {
  it('reads the marked names', () => {
    expect([...readWithheldFieldNames(marked())]).toEqual(['crm_project']);
  });

  it('answers the one shared empty set for a definition without the marker, and for non-objects', () => {
    expect(readWithheldFieldNames({ name: 'x', fields: {} })).toBe(NO_WITHHELD_FIELDS);
    expect(readWithheldFieldNames(null)).toBe(NO_WITHHELD_FIELDS);
    expect(readWithheldFieldNames({ name: 'x', _withheldFields: ['crm_project'] })).toBe(NO_WITHHELD_FIELDS);
  });

  it('never withholds a name the definition declares, in either field-map shape', () => {
    const declaredMap = { ...marked(), fields: { crm_project: { type: 'text' } } };
    expect(readWithheldFieldNames(declaredMap)).toBe(NO_WITHHELD_FIELDS);
    const declaredList = { ...marked(), fields: [{ name: 'crm_project', type: 'text' }] };
    expect(readWithheldFieldNames(declaredList)).toBe(NO_WITHHELD_FIELDS);
  });

  it('is answered again beside the field map it was read with', () => {
    const def = marked();
    expect(withheldFieldNamesOfFieldMap(def.fields)).toBe(NO_WITHHELD_FIELDS);
    readWithheldFieldNames(def);
    expect([...withheldFieldNamesOfFieldMap(def.fields)]).toEqual(['crm_project']);
    expect(withheldFieldNamesOfFieldMap({ name: { type: 'text' } }), 'another map knows nothing of it').toBe(NO_WITHHELD_FIELDS);
  });
});

describe('refersToWithheldField (objectstack#34901)', () => {
  const withheld = new Set(['crm_project']);
  it('matches the field and a dotted path that starts at it', () => {
    expect(refersToWithheldField('crm_project', withheld)).toBe(true);
    expect(refersToWithheldField('crm_project.name', withheld)).toBe(true);
  });
  it('does not match another field, a non-string, or anything against the empty set', () => {
    expect(refersToWithheldField('crm_projects', withheld)).toBe(false);
    expect(refersToWithheldField(undefined, withheld)).toBe(false);
    expect(refersToWithheldField('crm_project', NO_WITHHELD_FIELDS)).toBe(false);
  });
});
