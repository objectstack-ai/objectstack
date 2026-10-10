// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The lifecycle-verb → row-level-security operation mapping, declared once.
//
// The by-id write pre-image gate (step 2.7) used to spell this mapping inline.
// It now reads `rlsOperationForVerb`, and so does `security/explain`, so the
// door's behaviour must be byte-identical to the inline expression it
// replaced, for every operation either reader can hand it. The parity of
// explain and the door per verb lives in `explain-write-verdict-inputs.test.ts`.

import { describe, it, expect } from 'vitest';
import { LIFECYCLE_VERB_RLS_OPERATION, rlsOperationForVerb } from './lifecycle-verb-rls-operation.js';

/** Step 2.7's inline mapping, verbatim, as it stood before it read the helper. */
const inlineBefore = (operation: string): string =>
  operation === 'purge' ? 'delete'
  : operation === 'transfer' || operation === 'restore' ? 'update'
  : operation;

/**
 * Every operation either reader can hand the helper: the engine's middleware
 * vocabulary, the three lifecycle verbs, explain's `export` (its data operation
 * is `find`, but the helper must not care), an unknown custom verb, and the
 * names an object literal inherits — a lookup that read them off the prototype
 * would answer a function, not the verb.
 */
const OPERATIONS = [
  'find', 'findOne', 'count', 'aggregate', 'insert', 'update', 'delete',
  'transfer', 'restore', 'purge',
  'export', 'custom_read',
  'constructor', 'toString', 'hasOwnProperty', '__proto__',
];

describe('rlsOperationForVerb', () => {
  it.each(OPERATIONS)("'%s' maps exactly as step 2.7's inline expression did", (operation) => {
    expect(rlsOperationForVerb(operation)).toBe(inlineBefore(operation));
  });

  it('declares the three lifecycle verbs, and nothing else', () => {
    expect({ ...LIFECYCLE_VERB_RLS_OPERATION }).toEqual({ transfer: 'update', restore: 'update', purge: 'delete' });
    expect(Object.isFrozen(LIFECYCLE_VERB_RLS_OPERATION)).toBe(true);
  });
});
