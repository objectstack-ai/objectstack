/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9050 step 2 — every refusal this file can raise carries the token a
 * render-time diagnostic has to NAME, as data rather than as prose to scrape.
 *
 * ## Why a subject field and not a regular expression over `message`
 *
 * The ruling's step 2 asks the four render-time callers for a state that names
 * the operator. The eleven messages deliberately do not share an idiom — the
 * file's own docblocks argue at length that `$regex`/`$not` ("this layer has no
 * target for your operator"), the comparand arms ("the spec's predicate rejects
 * this value") and the retired aliases ("write this instead") must each say a
 * different thing. Recovering a token from them by pattern would be a twelfth
 * dialect, and it would fail silently the next time one of those paragraphs is
 * reworded. So the subject travels on the error.
 *
 * ## Why ELEVEN rows and why they are enumerated here
 *
 * Eleven is the count step 1 measured, and this file is where a twelfth arm
 * gets noticed: a new `throw new FilterOperatorError(...)` that forgets its
 * subject renders "the  condition cannot be applied" at a user. The last case
 * reads the SOURCE and fails when the number of throw sites and the number of
 * rows below disagree, so the enumeration cannot quietly fall behind the file.
 *
 * ⚠️ UPDATED. It did: objectui#9164 added the empty-operator-map refusal
 * (`{ a: {} }`), and that case went red until its row was added below. Like
 * the two comparand arms it names no operator, so `field` is its subject.
 * objectui#11094 added the `$empty` flag refusal (a flag that is not a
 * boolean) the same way; it names its operator, so `$empty` is its subject.
 *
 * ⚠️ Each input is driven through `toFilterNodeSafely` — the RENDER-time entry,
 * not `convertFiltersToAST` directly — because the question is what a renderer
 * gets, and two of the eleven live on the view-rule arm that only the array
 * branch reaches.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FilterOperatorError,
  filterRefusalSubject,
  toFilterNodeSafely,
} from '../filter-converter.js';

/** The file under test, resolved from THIS file rather than from `process.cwd()`. */
const CONVERTER_SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'filter-converter.ts');

/**
 * One row per throw site, in source order. `subject` is what the render-time
 * state has to be able to say; `operator` is `undefined` on exactly the arms
 * where the author wrote no operator — the two that judge a comparand in the
 * implicit-equality position, and the empty operator map (objectui#9164).
 */
const REFUSALS: Array<{
  site: string;
  input: unknown;
  operator: string | undefined;
  field: string | undefined;
  subject: string;
}> = [
  { site: 'combinator value is not an array', input: { $and: 'nope' }, operator: '$and', field: undefined, subject: '$and' },
  { site: 'combinator member is not an object', input: { $and: ['nope'] }, operator: '$and', field: undefined, subject: '$and' },
  { site: '$icontains comparand', input: { name: { $icontains: '' } }, operator: '$icontains', field: 'name', subject: '$icontains' },
  { site: 'empty operator map with no other condition', input: { a: {} }, operator: undefined, field: 'a', subject: 'a' },
  { site: '$not combinator', input: { $not: { a: 1 } }, operator: '$not', field: undefined, subject: '$not' },
  { site: 'bare array equality comparand', input: { tags: ['a', 'b'] }, operator: undefined, field: 'tags', subject: 'tags' },
  { site: 'exotic comparand', input: { created: /abc/ }, operator: undefined, field: 'created', subject: 'created' },
  { site: '$regex operator', input: { name: { $regex: 'a.c' } }, operator: '$regex', field: 'name', subject: '$regex' },
  { site: '$empty flag is not a boolean', input: { a: { $empty: 'yes' } }, operator: '$empty', field: 'a', subject: '$empty' },
  { site: 'retired lowercase alias', input: { name: { $startswith: 'x' } }, operator: '$startswith', field: 'name', subject: '$startswith' },
  { site: 'unknown operator', input: { name: { $bogus: 1 } }, operator: '$bogus', field: 'name', subject: '$bogus' },
  { site: 'view rule: array on a single-value operator', input: [{ field: 'tags', operator: 'equals', value: ['a'] }], operator: 'equals', field: 'tags', subject: 'equals' },
  { site: 'view rule: icontains comparand', input: [{ field: 'name', operator: 'icontains', value: '' }], operator: 'icontains', field: 'name', subject: 'icontains' },
];

describe('objectui#9050 — a filter refusal names its own subject', () => {
  it.each(REFUSALS)('$site', ({ input, operator, field, subject }) => {
    const result = toFilterNodeSafely(input);
    // Narrowed first: `ok: false` is the only branch that HAS a refusal, which
    // is the property that stops a caller reading a node that was never built.
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable — asserted above');

    expect(result.refusal).toBeInstanceOf(FilterOperatorError);
    // The envelope `classifyLoadError` reads, unchanged by this card.
    expect(result.refusal.code).toBe('INVALID_FILTER');
    expect(result.refusal.httpStatus).toBe(400);

    expect(result.refusal.operator).toBe(operator);
    expect(result.refusal.field).toBe(field);
    expect(filterRefusalSubject(result.refusal)).toBe(subject);
  });

  it('accepts the shapes it does not refuse, and says so with `ok: true`', () => {
    // The other direction, so a "fix" that refused everything would fail here.
    const object = toFilterNodeSafely({ status: 'active', age: { $gte: 18 } });
    expect(object).toEqual({ ok: true, node: ['and', ['status', '=', 'active'], ['age', '>=', 18]] });

    const rules = toFilterNodeSafely([{ field: 'status', operator: 'equals', value: 'open' }]);
    expect(rules).toEqual({ ok: true, node: [['status', 'equals', 'open']] });

    // Absent stays absent — `ok: true` with no node, NOT a refusal.
    expect(toFilterNodeSafely(undefined)).toEqual({ ok: true, node: undefined });
    expect(toFilterNodeSafely({})).toEqual({ ok: true, node: undefined });
  });

  it('rethrows anything that is not a FilterOperatorError', () => {
    // A defect in the lowering is not a statement about the author's filter,
    // and swallowing it into "your filter is malformed" would send them to edit
    // a filter that is fine. A throwing getter is the cheapest way to raise
    // something that is NOT this file's own refusal from inside the walk —
    // `Object.entries` invokes it.
    const exploding = { get tags(): unknown { throw new TypeError('boom'); } };
    expect(() => toFilterNodeSafely(exploding)).toThrow(TypeError);
    // And it is the ORIGINAL error, not one re-wrapped as a filter refusal.
    expect(() => toFilterNodeSafely(exploding)).not.toThrow(FilterOperatorError);
  });

  it('enumerates every throw site in the converter', () => {
    const source = readFileSync(CONVERTER_SOURCE, 'utf8');
    const sites = source.match(/throw new FilterOperatorError\(/g) ?? [];
    // Reading the source rather than trusting a number in prose: a twelfth arm
    // added without a row above renders an empty subject at a user, and this is
    // the only assertion that can see it.
    expect(sites).toHaveLength(REFUSALS.length);
  });
});
