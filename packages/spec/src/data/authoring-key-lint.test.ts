// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tests for the unknown-authoring-key lint (#3786).
 *
 * Two jobs: prove the rule actually fires on the drifts that motivated it, and
 * hold the guidance tables to the same non-rotting discipline the #4045 / #4040
 * ledgers use — a `to` that names a key the schema no longer declares is advice
 * pointing into a void, which is worse than no advice.
 */

import { describe, it, expect } from 'vitest';

import {
  lintUnknownAuthoringKeys,
  formatUnknownAuthoringKey,
  FIELD_KEY_GUIDANCE,
  OBJECT_KEY_GUIDANCE,
} from './authoring-key-lint';
import { ObjectSchema } from './object.zod';
import { FieldSchema } from './field.zod';

const shapeKeys = (s: unknown) => Object.keys((s as { shape: Record<string, unknown> }).shape);

/** A minimal well-formed stack with one object and one field. */
const stackWith = (obj: Record<string, unknown>, field: Record<string, unknown>) => ({
  objects: [
    { name: 'crm_case', label: 'Case', fields: { owner: { label: 'Owner', type: 'text', ...field } }, ...obj },
  ],
});

describe('lintUnknownAuthoringKeys (#3786)', () => {
  it('is silent on a clean stack', () => {
    expect(lintUnknownAuthoringKeys(stackWith({}, {}))).toEqual([]);
  });

  it('reports a field key the schema does not declare', () => {
    const [finding, ...rest] = lintUnknownAuthoringKeys(stackWith({}, { pii: true }));
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      path: 'objects.crm_case.fields.owner.pii',
      surface: 'field',
      key: 'pii',
    });
    // A retired key gets a prescription, not a "did you mean" into a void.
    expect(finding.guidance).toBeTruthy();
    expect(finding.suggestion).toBeUndefined();
  });

  it('reports an object key the schema does not declare, with the rename', () => {
    const [finding] = lintUnknownAuthoringKeys(stackWith({ capabilities: { trackHistory: true } }, {}));
    expect(finding).toMatchObject({
      path: 'objects.crm_case.capabilities',
      surface: 'object',
      key: 'capabilities',
      suggestion: 'enable',
    });
  });

  /**
   * The exact set #4120 found rendering in `object.form.ts` while saving
   * nothing. If the lint had existed, each of these would have been one warning
   * rather than releases of a dead toggle.
   */
  const FORM_DRIFT_KEYS = [
    'indexed', 'immutable', 'filterable', 'placeholder', 'validation', 'errorMessage',
    'audit', 'pii', 'encrypted', 'startingNumber',
    'referenceFilter', 'cascadeDelete', 'formula', 'displayFormat', 'summaryType', 'summaryField',
  ] as const;

  it.each(FORM_DRIFT_KEYS)('catches the #4120 drift key %s and says something actionable', (key) => {
    const [finding, ...rest] = lintUnknownAuthoringKeys(stackWith({}, { [key]: 'x' }));
    expect(finding, `${key} should be reported`).toBeDefined();
    expect(rest).toEqual([]);
    expect(finding.key).toBe(key);
    // Either a rename target or a retirement reason — never a bare "unknown".
    expect(
      finding.suggestion ?? finding.guidance,
      `${key} needs a rename target or a retirement reason`,
    ).toBeTruthy();
    expect(formatUnknownAuthoringKey(finding)).toContain(key);
  });

  it('falls back to edit distance for a plain typo', () => {
    const [finding] = lintUnknownAuthoringKeys(stackWith({}, { requred: true }));
    expect(finding.suggestion).toBe('required');
  });

  it('ignores the underscore-prefixed packaging channel', () => {
    const findings = lintUnknownAuthoringKeys(
      stackWith({ _packageId: 'p', _lock: true }, { _provenance: 'x' }),
    );
    expect(findings).toEqual([]);
  });

  it('reports every offending key, across objects and fields', () => {
    const findings = lintUnknownAuthoringKeys({
      objects: [
        { name: 'a', label: 'A', capabilities: {}, fields: { x: { type: 'text', pii: true } } },
        { name: 'b', label: 'B', fields: { y: { type: 'text', indexed: true } } },
      ],
    });
    expect(findings.map((f) => f.path).sort()).toEqual([
      'objects.a.capabilities',
      'objects.a.fields.x.pii',
      'objects.b.fields.y.indexed',
    ]);
  });

  it('survives malformed input rather than throwing', () => {
    // The lint runs before the parse, so it is handed whatever the author wrote.
    for (const junk of [undefined, null, 42, 'x', {}, { objects: 'nope' }, { objects: [null, 7] }]) {
      expect(() => lintUnknownAuthoringKeys(junk)).not.toThrow();
    }
    expect(lintUnknownAuthoringKeys({ objects: [{ name: 'a', fields: 'nope' }] })).toEqual([]);
  });
});

describe('the guidance tables do not rot', () => {
  it('every FIELD_KEY_GUIDANCE `to` names a key FieldSchema really declares', () => {
    const declared = new Set(shapeKeys(FieldSchema));
    for (const [key, hint] of Object.entries(FIELD_KEY_GUIDANCE)) {
      if (hint.to) expect(declared, `FIELD_KEY_GUIDANCE.${key} → '${hint.to}'`).toContain(hint.to);
    }
  });

  it('every OBJECT_KEY_GUIDANCE `to` names a key ObjectSchema really declares', () => {
    const declared = new Set(shapeKeys(ObjectSchema));
    for (const [key, hint] of Object.entries(OBJECT_KEY_GUIDANCE)) {
      if (hint.to) expect(declared, `OBJECT_KEY_GUIDANCE.${key} → '${hint.to}'`).toContain(hint.to);
    }
  });

  it('no guidance entry names a key the schema now declares itself', () => {
    // If a "retired" key came back, its entry is actively wrong — the lint would
    // be telling an author to delete something the schema accepts.
    const fieldDeclared = new Set(shapeKeys(FieldSchema));
    for (const key of Object.keys(FIELD_KEY_GUIDANCE)) {
      expect(fieldDeclared, `FIELD_KEY_GUIDANCE has an entry for the LIVE key '${key}'`).not.toContain(key);
    }
    const objectDeclared = new Set(shapeKeys(ObjectSchema));
    for (const key of Object.keys(OBJECT_KEY_GUIDANCE)) {
      expect(objectDeclared, `OBJECT_KEY_GUIDANCE has an entry for the LIVE key '${key}'`).not.toContain(key);
    }
  });

  it('every entry carries either a rename target or a reason, and the tables are not empty', () => {
    expect(Object.keys(FIELD_KEY_GUIDANCE).length).toBeGreaterThan(0);
    expect(Object.keys(OBJECT_KEY_GUIDANCE).length).toBeGreaterThan(0);
    for (const [table, name] of [
      [FIELD_KEY_GUIDANCE, 'FIELD_KEY_GUIDANCE'],
      [OBJECT_KEY_GUIDANCE, 'OBJECT_KEY_GUIDANCE'],
    ] as const) {
      for (const [key, hint] of Object.entries(table)) {
        expect(hint.to ?? hint.why, `${name}.${key} needs a 'to' or a 'why'`).toBeTruthy();
        if (hint.why) expect(hint.why.length, `${name}.${key} reason too short`).toBeGreaterThan(30);
      }
    }
  });
});
