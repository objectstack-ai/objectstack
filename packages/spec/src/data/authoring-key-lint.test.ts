// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tests for the unknown-authoring-key CORE (#3786): the comparator and the
 * curated guidance tables. The stack walker that applies them across every
 * metadata collection is tested in `kernel/metadata-authoring-lint.test.ts`.
 *
 * The guidance tables are held to the #4045 / #4040 non-rotting discipline — a
 * `to` that names a key the schema no longer declares is advice pointing into a
 * void, which is worse than no advice.
 */

import { describe, it, expect } from 'vitest';

import {
  lintAuthoredRecordKeys,
  formatUnknownAuthoringKey,
  FIELD_KEY_GUIDANCE,
  OBJECT_KEY_GUIDANCE,
  type UnknownAuthoringKeyFinding,
} from './authoring-key-lint';
import { ObjectSchema } from './object.zod';
import { FieldSchema } from './field.zod';

const shapeKeys = (s: unknown) => Object.keys((s as { shape: Record<string, unknown> }).shape);

function runComparator(
  record: Record<string, unknown>,
  declared: readonly string[],
  guidance: Readonly<Record<string, { to?: string; why?: string }>> = {},
): UnknownAuthoringKeyFinding[] {
  const out: UnknownAuthoringKeyFinding[] = [];
  lintAuthoredRecordKeys(record, new Set(declared), guidance, 'field', 'p', out);
  return out;
}

describe('lintAuthoredRecordKeys (#3786)', () => {
  it('is silent when every key is declared', () => {
    expect(runComparator({ a: 1, b: 2 }, ['a', 'b', 'c'])).toEqual([]);
  });

  it('reports an undeclared key with an edit-distance suggestion for a typo', () => {
    const [f] = runComparator({ requred: true }, ['required', 'label']);
    expect(f).toMatchObject({ path: 'p.requred', key: 'requred', suggestion: 'required' });
  });

  it('a retirement suppresses the edit-distance fallback', () => {
    // `pii` is 3 edits from `min` — "did you mean min?" reads as advice while
    // being nonsense. A `why` with no `to` must yield guidance and NO suggestion.
    const [f] = runComparator({ pii: true }, ['min', 'max'], FIELD_KEY_GUIDANCE);
    expect(f.guidance).toBeTruthy();
    expect(f.suggestion).toBeUndefined();
  });

  it('a rename wins over edit distance', () => {
    const [f] = runComparator({ capabilities: {} }, ['enable', 'label'], OBJECT_KEY_GUIDANCE);
    expect(f.suggestion).toBe('enable');
  });

  it('skips the underscore-prefixed packaging channel', () => {
    expect(runComparator({ _packageId: 'p', _lock: true, _provenance: 'x' }, ['label'])).toEqual([]);
  });

  it('formats guidance over suggestion over bare', () => {
    const base = { path: 'p.k', surface: 'field', key: 'k' } as UnknownAuthoringKeyFinding;
    expect(formatUnknownAuthoringKey({ ...base, guidance: 'gone.' })).toContain('gone.');
    expect(formatUnknownAuthoringKey({ ...base, suggestion: 's' })).toContain("did you mean 's'");
    expect(formatUnknownAuthoringKey(base)).toMatch(/dropped at load\.$/);
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
