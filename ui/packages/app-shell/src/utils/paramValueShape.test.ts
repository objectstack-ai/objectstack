/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * paramValueShape — the value-shape parity net for action params (#2714).
 *
 * ADR-0059 routes every param through the shared form field-widget renderer, so
 * each param emits its widget's own value shape on confirm. This is the drift
 * guard (mirroring `paramToField.test.ts`'s style) pinning that contract:
 *   1. Coverage — every `FORM_FIELD_TYPES` widget key has a declared shape, so a
 *      new widget can't land without someone stating what a param of that type
 *      POSTs (the whole "a widget swap silently changed the shape" failure mode).
 *   2. Contracts — the shapes endpoints rely on are pinned by value
 *      (`number`→number, `boolean`→boolean, `date`→string, `select`→string,
 *      `select+multiple`→string[], `lookup`→id(s), `file`→fileId(s)).
 *
 * The `file`/`image` → fileId serialization itself is owned by #2698/#2710
 * (`serializeParamValues`); this net asserts the post-serialize endpoint shape
 * and the general contract for the non-upload types.
 */
import { describe, it, expect } from 'vitest';
import { FORM_FIELD_TYPES } from '@object-ui/fields';
import type { ActionParamDef } from '@object-ui/core';
import {
  PARAM_VALUE_SHAPES,
  expectedParamShape,
  resolveShapeSpec,
  classifyValueShape,
  type ValueShapeTag,
} from './paramValueShape';

const p = (over: Partial<ActionParamDef>): ActionParamDef => ({
  name: 'x',
  label: 'X',
  type: 'text',
  ...over,
});

describe('emitted value-shape contract — FORM_FIELD_TYPES coverage (drift guard)', () => {
  it('declares a shape for every form field type — none left undeclared', () => {
    // If this fails: a widget type was added to `fieldWidgetMap` (and so to
    // `FORM_FIELD_TYPES`) without declaring the value shape a param of that type
    // emits. Add an entry to PARAM_VALUE_SHAPES stating what the dialog POSTs —
    // do not delete this assertion.
    const undeclared = FORM_FIELD_TYPES.filter((t) => !(t in PARAM_VALUE_SHAPES));
    expect(undeclared).toEqual([]);
  });

  it('has no stale contract entries pointing at removed widget types', () => {
    const formTypes = new Set(FORM_FIELD_TYPES);
    const stale = Object.keys(PARAM_VALUE_SHAPES).filter((t) => !formTypes.has(t));
    expect(stale).toEqual([]);
  });

  it('resolves every declared type to a concrete shape (never throws / undefined)', () => {
    const VALID: ValueShapeTag[] = [
      'none', 'string', 'number', 'boolean', 'object',
      'string[]', 'number[]', 'boolean[]', 'object[]',
    ];
    for (const type of FORM_FIELD_TYPES) {
      const single = resolveShapeSpec(PARAM_VALUE_SHAPES[type], false);
      const multi = resolveShapeSpec(PARAM_VALUE_SHAPES[type], true);
      expect(VALID).toContain(single);
      expect(VALID).toContain(multi);
    }
  });
});

describe('expectedParamShape — pinned endpoint contracts', () => {
  // The shapes an action runner / endpoint input contract relies on. Pinned by
  // value so a widget swap that changes what a param POSTs fails here.
  const cases: Array<[string, Partial<ActionParamDef>, ValueShapeTag]> = [
    // Scalars endpoints depend on being their real JS type
    ['number → number (not a string)', { type: 'number' }, 'number'],
    ['currency → number', { type: 'currency' }, 'number'],
    ['percent → number', { type: 'percent' }, 'number'],
    ['boolean → boolean', { type: 'boolean' }, 'boolean'],
    ['date → string', { type: 'date' }, 'string'],
    ['datetime → string', { type: 'datetime' }, 'string'],
    ['time → string', { type: 'time' }, 'string'],
    ['text → string', { type: 'text' }, 'string'],
    ['color → string', { type: 'color' }, 'string'],
    ['code → string', { type: 'code' }, 'string'],
    // objectui#11448: `json` resolves to the JSON editor and posts the PARSED
    // value; it used to resolve to the code editor and post the text.
    ['json → object (the parsed value, not the text)', { type: 'json' }, 'object'],

    // Selection
    ['select → string', { type: 'select' }, 'string'],
    ['select + multiple → string[] (#2709)', { type: 'select', multiple: true }, 'string[]'],
    ['radio → string', { type: 'radio' }, 'string'],
    ['multiselect → string[]', { type: 'multiselect' }, 'string[]'],
    ['checkboxes → string[]', { type: 'checkboxes' }, 'string[]'],
    ['tags → string[]', { type: 'tags' }, 'string[]'],

    // Record pickers → id(s)
    ['lookup (with referenceTo) → string id', { type: 'lookup', referenceTo: 'space_users' }, 'string'],
    ['lookup + multiple → string[] ids', { type: 'lookup', referenceTo: 'space_users', multiple: true }, 'string[]'],
    ['user → string id', { type: 'user' }, 'string'],
    ['user + multiple → string[] ids', { type: 'user', multiple: true }, 'string[]'],

    // Uploads → fileId(s) AFTER serializeParamValues (#2698/#2710)
    ['file → fileId string', { type: 'file' }, 'string'],
    ['file + multiple → fileId string[]', { type: 'file', multiple: true }, 'string[]'],
    ['image → fileId string', { type: 'image' }, 'string'],

    // Structured objects
    ['object → object', { type: 'object' }, 'object'],
    ['address → object', { type: 'address' }, 'object'],
    ['grid → object[]', { type: 'grid' }, 'object[]'],
  ];

  it.each(cases)('%s', (_label, over, expected) => {
    expect(expectedParamShape(p(over))).toBe(expected);
  });

  it('a lookup param WITHOUT referenceTo posts a plain string (text fallback, matches the dialog)', () => {
    // paramToField degrades a targetless lookup/reference to a text input — the
    // picker cannot query without a target object — so it POSTs a bare string.
    expect(expectedParamShape(p({ type: 'lookup' }))).toBe('string');
    expect(expectedParamShape(p({ type: 'reference' }))).toBe('string');
  });

  it('legacy param spellings resolve to their canonical shape', () => {
    expect(expectedParamShape(p({ type: 'checkbox' }))).toBe('boolean');
    expect(expectedParamShape(p({ type: 'datetime-local' }))).toBe('string');
    expect(expectedParamShape(p({ type: 'autonumber' }))).toBe('none'); // computed
  });

  it('an unknown param type falls back to a plain string (text widget)', () => {
    expect(expectedParamShape(p({ type: 'no-such-type' }))).toBe('string');
  });

  it('computed / read-only widget types emit nothing (none)', () => {
    for (const type of ['formula', 'summary', 'auto_number', 'vector']) {
      expect(resolveShapeSpec(PARAM_VALUE_SHAPES[type], false)).toBe('none');
    }
  });
});

describe('resolveShapeSpec — multiple promotion', () => {
  it('promotes a scalar|array spec to base[] only when multiple', () => {
    const spec = PARAM_VALUE_SHAPES.select;
    expect(resolveShapeSpec(spec, false)).toBe('string');
    expect(resolveShapeSpec(spec, true)).toBe('string[]');
  });

  it('keeps an inherently-array spec as base[] regardless of multiple', () => {
    const spec = PARAM_VALUE_SHAPES.tags;
    expect(resolveShapeSpec(spec, false)).toBe('string[]');
    expect(resolveShapeSpec(spec, true)).toBe('string[]');
  });

  it('keeps a plain scalar spec as base regardless of multiple', () => {
    const spec = PARAM_VALUE_SHAPES.number;
    expect(resolveShapeSpec(spec, false)).toBe('number');
    expect(resolveShapeSpec(spec, true)).toBe('number');
  });

  it('computed specs resolve to none regardless of multiple', () => {
    expect(resolveShapeSpec(PARAM_VALUE_SHAPES.formula, true)).toBe('none');
  });
});

describe('classifyValueShape — runtime classifier (backs the render proofs)', () => {
  it('classifies scalars by their JS type', () => {
    expect(classifyValueShape('hi')).toBe('string');
    expect(classifyValueShape(42)).toBe('number');
    expect(classifyValueShape(true)).toBe('boolean');
    expect(classifyValueShape({ latitude: 1, longitude: 2 })).toBe('object');
  });

  it('treats null / undefined as none (no value emitted)', () => {
    expect(classifyValueShape(null)).toBe('none');
    expect(classifyValueShape(undefined)).toBe('none');
  });

  it('tags a non-empty array by its first element base', () => {
    expect(classifyValueShape(['a', 'b'])).toBe('string[]');
    expect(classifyValueShape([1, 2])).toBe('number[]');
    expect(classifyValueShape([{ id: 1 }])).toBe('object[]');
  });

  it('degrades an empty array to the generic array tag (base unknowable)', () => {
    expect(classifyValueShape([])).toBe('array');
  });
});

describe('contract ↔ realistic value agreement', () => {
  // A representative emitted value per endpoint-relied param, classified back to
  // the declared contract. Documents "what a type:'X' param POSTs looks like"
  // and pins that the classifier and the resolver share one vocabulary.
  const samples: Array<[Partial<ActionParamDef>, unknown]> = [
    [{ type: 'number' }, 42],
    [{ type: 'boolean' }, true],
    [{ type: 'date' }, '2026-07-20'],
    // A zoned ISO instant — the real emitted form since objectstack#5061. Note
    // this row DOCUMENTS the sample; it cannot guard the change, because the
    // zone-less string it replaced classifies to the same `'string'` tag. The
    // guard lives in `ActionParamDialog.test.tsx`, which runs the sample past
    // the platform's own `validateActionParams`.
    [{ type: 'datetime' }, '2026-07-20T06:30:00.000Z'],
    [{ type: 'select' }, 'prod'],
    [{ type: 'select', multiple: true }, ['prod', 'stage']],
    [{ type: 'multiselect' }, ['a', 'b']],
    [{ type: 'lookup', referenceTo: 'space_users' }, 'usr_123'],
    [{ type: 'lookup', referenceTo: 'space_users', multiple: true }, ['usr_1', 'usr_2']],
    [{ type: 'file' }, 'file_abc'], // post-serialize fileId
    [{ type: 'file', multiple: true }, ['file_1', 'file_2']],
    [{ type: 'object' }, { key: 'v' }],
    [{ type: 'grid' }, [{ id: '1' }, { id: '2' }]],
  ];

  it.each(samples)('%o classifies to its declared shape', (over, sample) => {
    expect(classifyValueShape(sample)).toBe(expectedParamShape(p(over)));
  });
});
