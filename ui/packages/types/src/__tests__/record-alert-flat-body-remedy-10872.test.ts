/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:alert`'s flat `body` is refused with a remedy the block honours
 * (objectui#10872, batch 3).
 *
 * ## The defect these pin
 *
 * `record:alert`'s message TEXT is `properties.body`, a member of its spec row
 * (`ComponentPropsMap['record:alert']`). A `body` written flat on the node was
 * refused by `BaseSchema`'s objectui#6771 alias refusal, whose message sends the
 * author to `children`. This block renders no child list, and its arm refuses
 * `children` by name (objectui#9256), so an author who followed the message
 * moved the text to a key the validator refuses next and nothing renders.
 *
 * ## What moves, and what does not
 *
 * Only the prescription. The arm restates `body` with an alias refusal naming
 * `properties.body`; the accept set is the one `BaseSchema` gave it, so a flat
 * `body` is still refused with `invalid_type` at `body` on both faces, and
 * `properties.body` still parses. Every row below reads both faces: the
 * tolerant one, and its derived strict twin, which `objectui validate` runs.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  RecordAlertBlockSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

type Issue = { code: string; path: PropertyKey[]; message: string; errors?: Issue[][] };
type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };

const FACES: ReadonlyArray<readonly [string, (document: unknown) => Result]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];

const issueAt = (result: Result, path: string): Issue | undefined =>
  (result.error?.issues as unknown as Issue[] | undefined)?.find((i) => i.path.join('.') === path);

/**
 * Every issue in a result, with the union branches' own issues unfolded and each
 * path made absolute. A block nested in a `page` is judged inside the
 * `children` union (`SchemaNode | SchemaNode[]`), so its refusal arrives inside
 * `invalid_union` issues' `errors`, not as a top-level issue.
 */
const allIssues = (issues: Issue[] | undefined, prefix: PropertyKey[] = []): Issue[] =>
  (issues ?? []).flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    return [{ ...issue, path }, ...(issue.errors ?? []).flatMap((branch) => allIssues(branch, path))];
  });

/** The lead the alias-refusal helper composes: the spec's `strictObject({ aliases })` sentence. */
const REMEDY_LEAD = 'Did you mean `body` → `properties.body`?';

describe('objectui#10872 batch 3 — a flat `body` on `record:alert` names `properties.body`', () => {
  it.each(FACES)('%s face: refused BY NAME at `body`, pointing at `properties.body`, not at `children`', (_face, judge) => {
    const result = judge({ type: 'record:alert', body: 'Verify your email' });
    expect(result.success).toBe(false);
    const issue = issueAt(result, 'body');
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.message).toContain(REMEDY_LEAD);
    // The objectui#6771 prescription, which this block cannot honour, is gone.
    expect(issue?.message).not.toContain('Did you mean `body` → `children`?');
  });

  it.each(FACES)('%s face: the refusal is about the KEY, not its value — every value is refused', (_face, judge) => {
    for (const body of ['text', { en: 'Verify', 'zh-CN': 'Verify' }, 42, null, [], [{ type: 'text', content: 'x' }]]) {
      const result = judge({ type: 'record:alert', body });
      expect(issueAt(result, 'body')?.message, JSON.stringify(body)).toContain(REMEDY_LEAD);
    }
    // Beside a bag that already carries the text, the flat twin is still refused.
    const both = judge({ type: 'record:alert', body: 'flat', properties: { body: 'bag' } });
    expect(issueAt(both, 'body')?.message).toContain(REMEDY_LEAD);
  });

  it.each(FACES)('%s face: the refusal reaches a `record:alert` nested in a page, at its own path', (_face, judge) => {
    const result = judge({ type: 'page', children: [{ type: 'record:alert', body: 'Verify your email' }] });
    expect(result.success).toBe(false);
    const nested = allIssues(result.error?.issues as unknown as Issue[]).filter((i) => i.path.join('.') === 'children.0.body');
    expect(nested.map((i) => i.code)).toContain('invalid_type');
    expect(nested.some((i) => i.message.includes(REMEDY_LEAD))).toBe(true);
    expect(nested.some((i) => i.message.includes('Did you mean `body` → `children`?'))).toBe(false);
  });

  it('ONE string feeds both author-facing channels: the issue message IS the `.describe()` metadata', () => {
    const result = safeValidateSchema({ type: 'record:alert', body: 'x' }) as Result;
    const shape = (RecordAlertBlockSchema as unknown as { shape: Record<string, { description?: string }> }).shape;
    expect(shape.body?.description).toBe(issueAt(result, 'body')?.message);
  });
});

describe('objectui#10872 batch 3 — what the remedy sends the author to is accepted', () => {
  it.each(FACES)('%s face: `properties.body` parses — a string and an inline translation map', (_face, judge) => {
    expect(judge({ type: 'record:alert', properties: { severity: 'warning', body: 'Verify your email' } }).success).toBe(true);
    expect(judge({ type: 'record:alert', properties: { body: { en: 'Verify', 'zh-CN': 'Verify' } } }).success).toBe(true);
    expect(
      judge({ type: 'page', children: [{ type: 'record:alert', properties: { title: 'Heads up', body: 'Verify' } }] }).success,
    ).toBe(true);
  });

  it.each(FACES)('%s face: CONTROL — the bag is still judged by the spec row, so a bad `properties.body` is refused there', (_face, judge) => {
    const result = judge({ type: 'record:alert', properties: { body: 7 } });
    expect(result.success).toBe(false);
    expect(issueAt(result, 'properties.body')).toBeDefined();
  });
});

describe('objectui#10872 batch 3 — the neighbouring refusals are unchanged', () => {
  it.each(FACES)('%s face: a flat `children` on `record:alert` is still objectui#9256\'s no-child-list refusal', (_face, judge) => {
    const issue = issueAt(judge({ type: 'record:alert', children: [{ type: 'text', content: 'x' }] }), 'children');
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.message).toContain('`record:alert` renders no child list');
  });

  // The control arm was `page:card` until objectui#10872 batch 6 moved that block's child list to
  // `properties.children` and gave its `body` a refusal naming the bag member. `card` reads the
  // node-level `children`, so the objectui#6771 remedy is still the right one there.
  it.each(FACES)('%s face: CONTROL arm — `card`, which renders the node-level `children`, keeps the objectui#6771 remedy', (_face, judge) => {
    const issue = issueAt(judge({ type: 'card', body: 'x' }), 'body');
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.message).toContain('Did you mean `body` → `children`?');
    expect(issue?.message).not.toContain('properties.body');
  });
});
