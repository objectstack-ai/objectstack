// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21007] The JSON-column refusal's operator set and words, moved here from
 * `driver-sql` so the engine's per-aggregation `filter` refuses with them too.
 *
 * Two pins, both against what `driver-sql` answered BEFORE the move:
 *
 * - **The set** — the 22 spellings `driver-sql`'s module-private
 *   `JSON_COLUMN_INCOMPATIBLE_OPERATORS` held, member for member.
 * - **The words** — the SHA-256 of each text, captured from `driver-sql`'s
 *   built `jsonColumnOperatorError` at the commit before the move (`8f784959c`)
 *   through a real `SqlDriver` over SQLite: the withheld message (one text for
 *   every operator), and the diagnostic for an operator, for `$between`, and
 *   for the bare equality spelling, on a column named `members`. A hash rather
 *   than a second literal copy, so this file is not a third place the sentence
 *   lives; the length beside each hash says how far a failure moved it.
 *
 * A deliberate change of wording updates the hashes in the PR that makes it —
 * and then reaches `where` and the per-aggregation `filter` alike, which is the
 * point of the move.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { JSON_COLUMN_INCOMPATIBLE_OPERATORS, jsonColumnOperatorRefusalText } from './json-column-operator-refusal.js';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('[#21007] JSON_COLUMN_INCOMPATIBLE_OPERATORS', () => {
  it('holds exactly the spellings driver-sql refused before the move', () => {
    expect([...JSON_COLUMN_INCOMPATIBLE_OPERATORS].sort()).toEqual([
      '!=', '$between', '$eq', '$gt', '$gte', '$in', '$lt', '$lte', '$ne', '$nin',
      '<', '<=', '<>', '=', '==', '>', '>=',
      'between', 'in', 'nin', 'not_in', 'notin',
    ]);
  });

  it('leaves out the membership spelling, the rest of the text family and the null predicates', () => {
    for (const op of ['$contains', '$notContains', '$startsWith', '$endsWith', '$icontains', '$null', '$exists', '$empty']) {
      expect(JSON_COLUMN_INCOMPATIBLE_OPERATORS.has(op), op).toBe(false);
    }
  });
});

describe('[#21007] jsonColumnOperatorRefusalText — byte for byte what driver-sql printed before the move', () => {
  const MESSAGE = { sha: 'c6103dd665625ab3a779822fecbe650bd7f67fc6ea38d17d5fd57cf6ae9193ff', length: 748 };

  it.each([
    ['an operator', '$in', false, { sha: '358d5aae39170ab3da198beb39368a3f3476dd057dbd5da5f4295cf244eab67e', length: 648 }],
    ['$between', '$between', false, { sha: '505c094ac5212ac121cdeb4803787ba036f46177450d542fbccf60a9386924fe', length: 658 }],
    ['the bare equality spelling', '=', true, { sha: '92bb1728ca012c4cde6deb05be3cb0320e113c8c5ac250ecad5b091f3bb87094', length: 660 }],
  ] as const)('%s', (_name, op, bare, diagnostic) => {
    const text = jsonColumnOperatorRefusalText('members', op, bare);
    expect({ sha: sha256(text.message), length: text.message.length }).toEqual(MESSAGE);
    expect({ sha: sha256(text.diagnostic), length: text.diagnostic.length }).toEqual(diagnostic);
  });

  it('the message names neither the field nor the operator, and prescribes $contains and an $or of it', () => {
    const { message, diagnostic } = jsonColumnOperatorRefusalText('secret_col', '$nin', false);
    expect(message).not.toContain('secret_col');
    expect(message).not.toContain('"$nin"');
    expect(message).toContain('WAS NOT APPLIED');
    expect(message).toContain('{ "FIELD": { "$contains": "a" } }');
    expect(message).toContain('{ "$or": [{ "FIELD": { "$contains": "a" } }');
    expect(diagnostic).toContain('Operator "$nin" on field "secret_col"');
    expect(diagnostic).toContain('{ "secret_col": { "$contains": "a" } }');
  });
});
