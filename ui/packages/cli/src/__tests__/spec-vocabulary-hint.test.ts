/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `findSpecVocabularyFormFields` (#3090) — the detector behind `objectui
 * validate`'s directed hint. Its precision is the point: the same `field` key
 * means three different things across the platform (spec string reference /
 * runtime metadata object / absent), and flagging the wrong one would make
 * the CLI teach agents the wrong lesson.
 */

import { describe, it, expect } from 'vitest';
import { findSpecVocabularyFormFields } from '../utils/spec-vocabulary-hint.js';

describe('findSpecVocabularyFormFields', () => {
  it('finds a spec-shaped entry inside a nested standalone form, with its path', () => {
    const schema = {
      type: 'page',
      children: [
        { type: 'text', content: 'hi' },
        {
          type: 'form',
          fields: [
            { name: 'subject', type: 'input' },
            { field: 'owner', required: true },
          ],
        },
      ],
    };
    expect(findSpecVocabularyFormFields(schema)).toEqual([
      { path: 'children[1].fields[1]', field: 'owner' },
    ]);
  });

  it('reports a mixed-vocabulary entry with its runtime name', () => {
    const schema = {
      type: 'form',
      fields: [{ name: 'subject', field: 'subject_line', type: 'input' }],
    };
    expect(findSpecVocabularyFormFields(schema)).toEqual([
      { path: 'fields[0]', field: 'subject_line', mixedName: 'subject' },
    ]);
  });

  it('does NOT flag section fields — the object-form path accepts the spec shape', () => {
    const schema = {
      type: 'object-form',
      objectName: 'case',
      sections: [{ name: 's1', fields: [{ field: 'owner', required: true }] }],
    };
    expect(findSpecVocabularyFormFields(schema)).toEqual([]);
  });

  it('does NOT flag the runtime metadata-object `field` slot (the pun)', () => {
    const schema = {
      type: 'form',
      fields: [{ name: 'amount', type: 'input', field: { type: 'currency', scale: 2 } }],
    };
    expect(findSpecVocabularyFormFields(schema)).toEqual([]);
  });

  it('handles primitives, nulls and arrays without faulting', () => {
    expect(findSpecVocabularyFormFields(null)).toEqual([]);
    expect(findSpecVocabularyFormFields('form')).toEqual([]);
    expect(findSpecVocabularyFormFields([{ type: 'form', fields: [{ field: 'x' }] }])).toEqual([
      { path: '[0].fields[0]', field: 'x' },
    ]);
  });
});
