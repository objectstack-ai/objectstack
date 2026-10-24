/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The host feed slots of `record:activity` (`items`) and `record:history`
 * (`entries`), and the `loading` flag paired with each, are refused BY NAME
 * when a document writes them on the node (objectui#11321, item 2).
 *
 * ## The defect these pin
 *
 * Both renderers take a feed a host already owns, on the node or in
 * `properties`: a TSX composition hands `record:activity` its `items`, and the
 * record page's synthesizer hands `record:history` its `entries`. Neither key
 * is authorable metadata. Before this card, an author who copied `items` from
 * that composition into a JSON page met no reason: written on the node it
 * passed the tolerant face (`safeValidateSchema`) unjudged, because the node
 * base keeps an undeclared key, and the strict authoring face refused it only
 * as an unnamed `unrecognized_keys`. Triage's direction: the refusal names
 * them as host feed slots, with the prescription; no silent refusal.
 *
 * ## What is pinned
 *
 *   1. On the node, each of the four keys is refused by both faces, at its own
 *      path, with `invalid_type`. The message's first sentence names the key
 *      as a host feed slot of that block, and it carries the prescription: a
 *      host supplies it in code (TSX composition), and an author omits it.
 *      ONE string feeds the issue message and the `.describe()` metadata.
 *   2. Every value is refused, an array included: the refusal is about the
 *      key, not a value domain.
 *   3. `@objectstack/spec`'s page component refuses the same node too, so
 *      the acceptance result stays a refusal everywhere it was one.
 *   4. In `properties` the keys meet the spec row, which the arm takes by
 *      reference: both faces refuse them there with the row's OWN message,
 *      byte for byte. This file does not restate the row. Where the row names
 *      the key (`record:history`'s `entries` / `loading`) both faces carry that
 *      text; where it does not (`record:activity`'s), the message is the row's
 *      generic one, and the spec is where that changes.
 *   5. CONTROL: an unrelated unknown key on the same node stays what every
 *      undeclared key is: unjudged by the tolerant face, refused by the strict
 *      face only as an unnamed `unrecognized_keys`. Without it, a face that
 *      refused every key by some message would pass 1 as well.
 */

import { describe, expect, it } from 'vitest';
import {
  PageComponentSchema,
  RecordActivityProps as SpecRecordActivityProps,
  RecordHistoryProps as SpecRecordHistoryProps,
} from '@objectstack/spec/ui';
import {
  AnyComponentSchema,
  RecordActivityBlockSchema,
  RecordHistoryBlockSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[]; errors?: Issue[][] };
type Parse = { success: boolean; error?: { issues: ReadonlyArray<unknown> } };
type Judge = (document: unknown) => Parse;
type Arm = { shape: Record<string, { description?: string }> };

const FACES: ReadonlyArray<readonly [string, Judge]> = [
  ['tolerant', (document) => safeValidateSchema(document) as Parse],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document) as Parse],
];

/** Every issue, union branches unfolded and paths made absolute. */
const allIssues = (issues: ReadonlyArray<Issue> | undefined, prefix: PropertyKey[] = []): Issue[] =>
  (issues ?? []).flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    return [{ ...issue, path }, ...(issue.errors ?? []).flatMap((branch) => allIssues(branch, path))];
  });
const issuesOf = (result: Parse): Issue[] => allIssues(result.error?.issues as ReadonlyArray<Issue> | undefined);
const at = (result: Parse, path: string): Issue | undefined =>
  issuesOf(result).find((issue) => issue.path.map(String).join('.') === path);

/** One row per refused key: the block, the key, a value a host would pass, and the block's spec row. */
const SLOTS = [
  ['record:activity', 'items', [{ id: 'a1', type: 'comment', body: 'Called the customer' }], RecordActivityBlockSchema, SpecRecordActivityProps],
  ['record:activity', 'loading', true, RecordActivityBlockSchema, SpecRecordActivityProps],
  ['record:history', 'entries', [{ id: 'h1', action: 'updated', created_at: '2026-10-01T00:00:00Z' }], RecordHistoryBlockSchema, SpecRecordHistoryProps],
  ['record:history', 'loading', true, RecordHistoryBlockSchema, SpecRecordHistoryProps],
] as const;

const CASES = SLOTS.map(
  ([type, key, value, arm, row]) => [`${type}.${key}`, type, key, value as unknown, arm as unknown as Arm, row as unknown as { safeParse: Judge }] as const,
);

describe('objectui#11321 — a host feed slot written on the node is refused by name', () => {
  it('the population is the four keys the two renderers take from a host', () => {
    expect(CASES.map(([label]) => label)).toEqual([
      'record:activity.items',
      'record:activity.loading',
      'record:history.entries',
      'record:history.loading',
    ]);
  });

  it.each(CASES)('%s — both faces refuse it at its own path with `invalid_type`', (_label, type, key, value) => {
    for (const [face, judge] of FACES) {
      const result = judge({ type, [key]: value });
      expect(result.success, `${face} face accepted it`).toBe(false);
      expect(at(result, key)?.code, face).toBe('invalid_type');
    }
  });

  it.each(CASES)('%s — the message names the key as the block\'s host feed slot, and prescribes the host channel', (_label, type, key, value) => {
    for (const [face, judge] of FACES) {
      const message = at(judge({ type, [key]: value }), key)?.message ?? '';
      expect(message.startsWith(`\`${key}\` is a HOST FEED SLOT on \`${type}\`, not authorable metadata (objectui#11321)`), face).toBe(true);
      expect(message, face).toContain('A host supplies it in code');
      expect(message, face).toContain('(TSX composition)');
      expect(message, face).toContain('Omit it: ');
    }
  });

  it.each(CASES)('%s — ONE string feeds both author-facing channels: the issue message IS the `.describe()` metadata', (_label, type, key, value, arm) => {
    const message = at(safeValidateSchema({ type, [key]: value }) as Parse, key)?.message;
    // Both sides absent would compare equal: the refusal must exist first.
    expect(message, 'no issue at the key — the refusal is not installed').toBeDefined();
    expect(arm.shape[key]?.description).toBe(message);
  });

  it.each(CASES)('%s — the refusal is about the KEY, not a value domain: every value is refused', (_label, type, key) => {
    for (const value of [[], [{}], {}, 'feed', 1, false, true, null]) {
      expect(at(safeValidateSchema({ type, [key]: value }) as Parse, key), JSON.stringify(value)).toBeDefined();
    }
  });

  it.each(CASES)('%s — the refusal reaches a node nested in another block, at the nested path', (_label, type, key, value) => {
    const page = {
      type: 'page:tabs',
      properties: { items: [{ label: 'Feed', children: [{ type, [key]: value }] }] },
    };
    expect(AnyComponentSchema.safeParse({ type: 'page:tabs', properties: { items: [{ label: 'Feed', children: [{ type }] }] } }).success).toBe(true);
    const nested = issuesOf(AnyComponentSchema.safeParse(page) as Parse).find((issue) => issue.path[issue.path.length - 1] === key);
    expect(nested?.code).toBe('invalid_type');
    expect(nested?.path.map(String)).toEqual(['properties', 'items', '0', 'children', '0', key]);
  });

  it.each(CASES)('%s — `@objectstack/spec`\'s page component refuses the node too', (_label, type, key, value) => {
    const result = PageComponentSchema.safeParse({ type, [key]: value }) as Parse;
    expect(result.success).toBe(false);
    expect(issuesOf(result).some((issue) => issue.code === 'unrecognized_keys' && issue.keys?.includes(key))).toBe(true);
  });

  it.each(CASES)('%s — in `properties` both faces carry the spec row\'s own refusal, unrestated', (_label, type, key, value, _arm, row) => {
    const rowIssue = issuesOf(row.safeParse({ [key]: value })).find((issue) => issue.code === 'unrecognized_keys');
    expect(rowIssue?.keys).toEqual([key]);
    for (const [face, judge] of FACES) {
      const issue = at(judge({ type, properties: { [key]: value } }), 'properties');
      expect(issue?.code, face).toBe('unrecognized_keys');
      expect(issue?.keys, face).toEqual([key]);
      expect(issue?.message, face).toBe(rowIssue?.message);
    }
  });

  it.each(CASES)('%s — the block without the key passes both faces', (_label, type) => {
    for (const [face, judge] of FACES) {
      expect(judge({ type, properties: { limit: 10 } }).success, face).toBe(true);
    }
  });
});

describe('objectui#11321 — CONTROL: an unrelated unknown key keeps the undeclared-key treatment', () => {
  it.each(['record:activity', 'record:history'])('%s — unjudged by the tolerant face, an unnamed `unrecognized_keys` on the strict face', (type) => {
    const document = { type, inventedKey11321: [] };
    expect((safeValidateSchema(document) as Parse).success).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(document) as Parse;
    const issue = issuesOf(strict).find((i) => i.code === 'unrecognized_keys');
    expect(issue?.keys).toEqual(['inventedKey11321']);
    expect(issue?.message).not.toContain('HOST FEED SLOT');
  });
});
