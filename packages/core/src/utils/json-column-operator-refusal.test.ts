// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21007] The JSON-column refusal's operator set and words, moved here from
 * `driver-sql` so the engine's per-aggregation `filter` refuses with them too.
 *
 * Two pins:
 *
 * - **The set** — the 22 spellings `driver-sql`'s module-private
 *   `JSON_COLUMN_INCOMPATIBLE_OPERATORS` held, member for member, and
 *   [#21009] the five text operators that joined them since.
 * - **The words** — the SHA-256 of each text: the withheld message (one text
 *   for every operator), and the diagnostic for an operator, for `$between`,
 *   and for the bare equality spelling, on a column named `members`. A hash
 *   rather than a second literal copy, so this file is not a third place the
 *   sentence lives; the length beside each hash says how far a failure moved
 *   it. The hashes were captured from `driver-sql`'s built
 *   `jsonColumnOperatorError` at the commit before the move (`8f784959c`), and
 *   [#21067] re-captured from this builder when the words were rewritten.
 *
 * [#21067] And what the words must SAY, whatever they are: the message reaches
 * the REST caller WHOLE — run through the envelope's own bound
 * (`truncateClientMessage`, `@objectstack/types`; the 500 itself is
 * module-private there, so the function that applies it is what is imported)
 * it comes back unchanged — and it carries the remedy and the "withheld"
 * sentence. It names no face's storage or wrong answer, since three faces
 * print it.
 *
 * A deliberate change of wording updates the hashes in the PR that makes it —
 * and then reaches every face alike, which is the point of the move.
 *
 * [#21236] The second class of JSON column, a single-value file-class field
 * inside the ADR-0104 window, has its own reason and repair (the media-column
 * move), pinned the same three ways at the foot of this file. The first
 * class's words are the control: its hashes above did not move, and the
 * default class is the first class, byte for byte.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { truncateClientMessage } from '@objectstack/types';
import {
  JSON_COLUMN_INCOMPATIBLE_OPERATORS,
  jsonColumnOperatorRefusalText,
  type JsonColumnFieldClass,
} from './json-column-operator-refusal.js';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('[#21007] JSON_COLUMN_INCOMPATIBLE_OPERATORS', () => {
  it('holds exactly the spellings driver-sql refused before the move, and the text family [#21009] added', () => {
    expect([...JSON_COLUMN_INCOMPATIBLE_OPERATORS].sort()).toEqual([
      '!=', '$between', '$endsWith', '$eq', '$gt', '$gte', '$icontains', '$ilike', '$in', '$like',
      '$lt', '$lte', '$ne', '$nin', '$startsWith',
      '<', '<=', '<>', '=', '==', '>', '>=',
      'between', 'in', 'nin', 'not_in', 'notin',
    ]);
  });

  it('[#21009] holds every text operator except the membership pair', () => {
    for (const op of ['$startsWith', '$endsWith', '$icontains', '$like', '$ilike']) {
      expect(JSON_COLUMN_INCOMPATIBLE_OPERATORS.has(op), op).toBe(true);
    }
  });

  it('leaves out the membership pair and the null predicates', () => {
    for (const op of ['$contains', '$notContains', '$null', '$exists', '$empty']) {
      expect(JSON_COLUMN_INCOMPATIBLE_OPERATORS.has(op), op).toBe(false);
    }
  });
});

describe('[#21067] jsonColumnOperatorRefusalText — the words, by hash', () => {
  const MESSAGE = { sha: 'f0a54a98fb30ae8e201c7be5e9f0d1715649fd34303e176abea131981dfd36f7', length: 486 };

  it.each([
    ['an operator', '$in', false, { sha: 'da62717ac99e4e7470c977fd13ec7e36c32bcecb5c7d45b95d5ba09ded5d81cd', length: 406 }],
    ['$between', '$between', false, { sha: '4ff8d528fb53e31a73b8a190424fa7e2446bd0bd64ac984bf1f70e4ebe1e83d0', length: 416 }],
    ['the bare equality spelling', '=', true, { sha: '35e2fd3a5e287ac76ef3fb09922d537935283b930143035b69a07267a762cb5c', length: 418 }],
  ] as const)('%s', (_name, op, bare, diagnostic) => {
    const text = jsonColumnOperatorRefusalText('members', op, bare);
    expect({ sha: sha256(text.message), length: text.message.length }).toEqual(MESSAGE);
    expect({ sha: sha256(text.diagnostic), length: text.diagnostic.length }).toEqual(diagnostic);
  });

  it('[#21009] a text operator reads the very message the equality family reads, and its diagnostic names it', () => {
    for (const op of ['$startsWith', '$endsWith', '$icontains', '$like', '$ilike']) {
      const text = jsonColumnOperatorRefusalText('members', op, false);
      expect({ sha: sha256(text.message), length: text.message.length }, op).toEqual(MESSAGE);
      expect(text.diagnostic, op).toContain(`Operator "${op}" on field "members" WAS NOT APPLIED`);
    }
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

describe('[#21067] jsonColumnOperatorRefusalText — whole on the wire, and true on every face', () => {
  /** Every spelling that gets this refusal: each member of the set, and the bare one. */
  const SPELLINGS: ReadonlyArray<readonly [op: string, bare: boolean]> = [
    ...[...JSON_COLUMN_INCOMPATIBLE_OPERATORS].map((op) => [op, false] as const),
    ['=', true],
  ];

  it('the message passes the REST envelope\'s bound unchanged, for every refused spelling', () => {
    for (const [op, bare] of SPELLINGS) {
      const { message } = jsonColumnOperatorRefusalText('members', op, bare);
      // The bound's own function: a message at or past it comes back cut to 499
      // characters plus an ellipsis, so equality here means every word arrives.
      expect(truncateClientMessage(message), op).toBe(message);
    }
  });

  it('inside the bound: the remedy for one member, for any-of and for no value, then where the field and the operator went', () => {
    const { message } = jsonColumnOperatorRefusalText('members', '$in', false);
    expect(message.startsWith('A constraint in this filter WAS NOT APPLIED: ')).toBe(true);
    expect(message).toContain(
      'Use "$contains" for membership ({ "FIELD": { "$contains": "a" } }), or an $or of "$contains" for any-of ' +
        '({ "$or": [{ "FIELD": { "$contains": "a" } }, { "FIELD": { "$contains": "b" } }] }).',
    );
    // A `null` comparand (`{ f: null }`, `$eq: null`, `$ne: null`) is refused too, and asks
    // about presence, which `$contains` cannot spell: the presence operators are named.
    expect(message).toContain('For no value, use "$null" or "$empty".');
    expect(message.endsWith(
      'The field and the operator are withheld from the message; the full diagnostic is in the server log.',
    )).toBe(true);
  });

  it('names the rule, not a face: the field declaration, never a storage form or one backend\'s wrong answer', () => {
    for (const [op, bare] of SPELLINGS) {
      const { message, diagnostic } = jsonColumnOperatorRefusalText('members', op, bare);
      for (const text of [message, diagnostic]) {
        expect(text, op).toContain('a scalar comparison or text operator');
        expect(text, op).toContain('at a multi-value or JSON field, which it cannot test for one member.');
        expect(text, op).toContain('For no value, use "$null" or "$empty".');
        expect(text, op).not.toMatch(/this driver|JSON TEXT|serializ|matched nothing|asked to exclude/);
      }
      // The diagnostic names the operator in the reason too — the bare spelling's as `=`.
      expect(diagnostic, op).toContain(`it aims "${op}", a scalar comparison or text operator, at`);
    }
  });

  it('the diagnostic is the message with the names put back: same reason, same remedy with the field in it', () => {
    const { message, diagnostic } = jsonColumnOperatorRefusalText('members', '$nin', false);
    const reason = message.slice(message.indexOf(': ') + 2, message.indexOf(' Use "$contains"'));
    expect(diagnostic.startsWith('Operator "$nin" on field "members" WAS NOT APPLIED: ')).toBe(true);
    expect(diagnostic).toContain(reason.replace('a scalar comparison or text operator at', '"$nin", a scalar comparison or text operator, at'));
    expect(diagnostic.endsWith(
      '{ "$or": [{ "members": { "$contains": "a" } }, { "members": { "$contains": "b" } }] }). For no value, use "$null" or "$empty".',
    )).toBe(true);
    // An author-marked refusal puts this text on the wire (driver-sql's #8220
    // arm): for a field name of an ordinary length it is whole there too.
    expect(truncateClientMessage(diagnostic)).toBe(diagnostic);
  });
});

describe('[#21236] jsonColumnOperatorRefusalText — a single-value file-class field inside the ADR-0104 window', () => {
  const MEDIA: JsonColumnFieldClass = 'single-value-media';
  /** Every spelling that gets this refusal: each member of the set, and the bare one. */
  const SPELLINGS: ReadonlyArray<readonly [op: string, bare: boolean]> = [
    ...[...JSON_COLUMN_INCOMPATIBLE_OPERATORS].map((op) => [op, false] as const),
    ['=', true],
  ];
  /** The move, as the migration entry `filter-text-operator-declared-type-refused` words it. */
  const MOVE =
    'Such a field is not a membership question: it answers these operators again once this deployment ' +
    'finishes the media-column move (the column step of `objectstack migrate files-to-references --apply`).';

  it('the words, by hash: one message for every operator, and a diagnostic per spelling', () => {
    const MESSAGE = { sha: 'd76a61be45a1f2200179f7282e4cbe50685ad32f65124f55fc79eb7a2876fd22', length: 485 };
    for (const [op, bare, diagnostic] of [
      ['$startsWith', false, { sha: '9ee94859d50fc05f124ee2c1620c20d140c9572d2eb680bab3a45205a0b66de6', length: 418 }],
      ['$eq', false, { sha: '8e976c33c09a3c91ba135179caf47497ad1fbe7d1b8bc8c29ae5363512af83d8', length: 402 }],
      ['=', true, { sha: '40f4606c544acab304594079b6a8c9ded6fabfb7b2a9e037932e96aa0ca5e988', length: 414 }],
    ] as const) {
      const text = jsonColumnOperatorRefusalText('attachment', op, bare, MEDIA);
      expect({ sha: sha256(text.message), length: text.message.length }, op).toEqual(MESSAGE);
      expect({ sha: sha256(text.diagnostic), length: text.diagnostic.length }, op).toEqual(diagnostic);
    }
  });

  it('prescribes the media-column move and the presence spellings, and never $contains', () => {
    for (const [op, bare] of SPELLINGS) {
      const { message, diagnostic } = jsonColumnOperatorRefusalText('attachment', op, bare, MEDIA);
      for (const text of [message, diagnostic]) {
        expect(text, op).toContain('at a single-value file-class field still stored as JSON.');
        expect(text, op).toContain(MOVE);
        expect(text, op).toContain('For no value, use "$null" or "$empty".');
        expect(text, op).not.toContain('$contains');
        expect(text, op).not.toContain('which it cannot test for one member');
      }
      expect(message.startsWith('A constraint in this filter WAS NOT APPLIED: ')).toBe(true);
      expect(message.endsWith(
        'The field and the operator are withheld from the message; the full diagnostic is in the server log.',
      )).toBe(true);
      expect(message, op).not.toContain('attachment');
      expect(diagnostic, op).toContain(`it aims "${op}", a scalar comparison or text operator, at`);
    }
  });

  it('the message passes the REST envelope\'s bound unchanged, for every refused spelling', () => {
    for (const [op, bare] of SPELLINGS) {
      const { message } = jsonColumnOperatorRefusalText('attachment', op, bare, MEDIA);
      expect(truncateClientMessage(message), op).toBe(message);
    }
  });

  it('the diagnostic is whole on the wire for a 91-character field name, the bound the module docblock states', () => {
    const name = 'f'.repeat(91);
    for (const [op, bare] of SPELLINGS) {
      const { diagnostic } = jsonColumnOperatorRefusalText(name, op, bare, MEDIA);
      expect(truncateClientMessage(diagnostic), op).toBe(diagnostic);
    }
    const past = jsonColumnOperatorRefusalText(`${name}f`, '$startsWith', false, MEDIA).diagnostic;
    expect(truncateClientMessage(past)).not.toBe(past);
  });

  it('the control: the default class IS the multi-value class, and its words are not the media class\'s', () => {
    for (const [op, bare] of SPELLINGS) {
      const byDefault = jsonColumnOperatorRefusalText('members', op, bare);
      const named = jsonColumnOperatorRefusalText('members', op, bare, 'multi-value-or-json');
      expect(named, op).toEqual(byDefault);
      expect(byDefault.message, op).toContain('{ "FIELD": { "$contains": "a" } }');
      expect(jsonColumnOperatorRefusalText('members', op, bare, MEDIA).message, op).not.toBe(byDefault.message);
    }
  });
});
