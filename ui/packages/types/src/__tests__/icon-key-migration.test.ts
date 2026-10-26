/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `ui:icon`'s glyph key is `icon` — the contract half (objectui#5631).
 *
 * Two things are pinned here, and they are different in kind:
 *
 *  1. **The published mirror accepts the ruled shape and refuses the legacy
 *     one.** This is the half that blocked the 2026-08-22 ruling from landing
 *     at the renderer: `IconSchema` REQUIRED `name`, so an author writing the
 *     ruled `{ type:'icon', icon:'check' }` was refused by the very contract
 *     that was supposed to declare it. The measurement is asserted rather than
 *     described, in both directions, so a silent revert to `name` fails here.
 *  2. **The conversion for stored metadata does what it claims**, including
 *     the two cases it deliberately refuses to guess at.
 */

import { describe, it, expect } from 'vitest';

import { IconSchema } from '../zod/layout.zod.js';
import { migrateIconNodeKeys } from '../icon-key-migration.js';

/** The `code`/`path` of each issue, which is what the shape question is about. */
function issues(result: ReturnType<typeof IconSchema.safeParse>) {
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
        message: issue.message,
      }));
}

describe('IconSchema — `icon` is the glyph key (objectui#5631)', () => {
  it('ACCEPTS the ruled shape', () => {
    expect(IconSchema.safeParse({ type: 'icon', icon: 'check' }).success).toBe(true);
  });

  it('ACCEPTS `name` alongside `icon` — it is the identity key, not a rival', () => {
    // The whole point of the ruling: `name` stops being special-cased on this
    // node and goes back to being the identity every node may carry.
    const parsed = IconSchema.safeParse({ type: 'icon', id: 'save_icon', icon: 'save', name: 'save_icon' });
    expect(parsed.success).toBe(true);
  });

  it('REFUSES the legacy `name`-as-glyph shape, at `icon`', () => {
    const result = IconSchema.safeParse({ type: 'icon', name: 'check' });
    expect(result.success).toBe(false);
    // Refused for the ABSENCE OF `icon` — not accepted-and-warned, and not
    // refused somewhere unrelated. ⛔ No `icon ?? name` read exists.
    expect(issues(result).map((i) => i.path)).toEqual(['icon']);
  });

  it('says WHAT TO DO in the refusal, not just `expected string`', () => {
    const [issue] = issues(IconSchema.safeParse({ type: 'icon', name: 'check' }));
    // Zod's default here is `Invalid input: expected string, received
    // undefined`, which is true and useless to an author whose stored metadata
    // just stopped validating.
    expect(issue?.message).toContain('`icon`');
    expect(issue?.message).toContain('`name`');
    expect(issue?.message).toContain('objectui#5631');
    expect(issue?.message).toContain('migrateIconNodeKeys');
  });

  it('leaves a genuine type error with zod’s own precise message', () => {
    // The custom message is scoped to the ABSENT case. A node writing
    // `icon: 42` has not failed to migrate — it has a type error, and telling
    // it about a rename would be a wrong diagnosis.
    const [issue] = issues(IconSchema.safeParse({ type: 'icon', icon: 42 }));
    expect(issue?.path).toBe('icon');
    expect(issue?.message).toContain('expected string');
    expect(issue?.message).not.toContain('objectui#5631');
  });

  it('is REQUIRED, exactly as `name` was — this is a rename, not a loosening', () => {
    expect(IconSchema.safeParse({ type: 'icon' }).success).toBe(false);
  });
});

describe('migrateIconNodeKeys — the conversion for stored metadata', () => {
  it('lifts `name` to `icon` and removes the old key', () => {
    const { document, converted, warnings } = migrateIconNodeKeys({ type: 'icon', name: 'check' });

    expect(document).toEqual({ type: 'icon', icon: 'check' });
    expect(converted).toBe(1);
    expect(warnings).toEqual([]);
    // Removed, not left beside `icon`: leaving it preserves the exact
    // ambiguity the migration exists to end.
    expect('name' in (document as object)).toBe(false);
  });

  it('produces documents the migrated contract ACCEPTS', () => {
    // The conversion and the contract are two halves of one change; this is
    // the assertion that they actually meet.
    const before = { type: 'icon', name: 'check' };
    expect(IconSchema.safeParse(before).success).toBe(false);
    expect(IconSchema.safeParse(migrateIconNodeKeys(before).document).success).toBe(true);
  });

  it('walks arbitrarily nested documents, not just a `children` chain', () => {
    const { document, converted } = migrateIconNodeKeys({
      type: 'page',
      regions: {
        header: { toolbar: [{ type: 'ui:icon', name: 'save' }] },
        main: [{ type: 'card', children: [{ type: 'icon', name: 'star', size: 16 }] }],
      },
    });

    expect(converted).toBe(2);
    expect(document).toEqual({
      type: 'page',
      regions: {
        header: { toolbar: [{ type: 'ui:icon', icon: 'save' }] },
        main: [{ type: 'card', children: [{ type: 'icon', icon: 'star', size: 16 }] }],
      },
    });
  });

  it('returns the SAME reference when nothing changed, so a caller can skip a write', () => {
    const already = { type: 'icon', icon: 'check' };
    const result = migrateIconNodeKeys(already);
    expect(result.document).toBe(already);
    expect(result.converted).toBe(0);
  });

  it('REFUSES to guess when a node declares both keys, and says so', () => {
    const both = { type: 'icon', id: 'save_icon', icon: 'save', name: 'save_icon' };
    const { document, converted, warnings } = migrateIconNodeKeys(both);

    // Overwriting `icon` from `name` here would replace a working glyph with
    // an identity string — the silent data loss the report exists to prevent.
    expect(document).toBe(both);
    expect(converted).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.reason).toBe('both-keys');
    expect(warnings[0]?.id).toBe('save_icon');
  });

  it('REFUSES to guess when a node names no glyph at all, and says so', () => {
    const { converted, warnings } = migrateIconNodeKeys({
      type: 'card',
      children: [{ type: 'icon', id: 'empty_icon' }],
    });

    expect(converted).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.reason).toBe('no-glyph-key');
    // The path is how a caller finds the node in a document of any size.
    expect(warnings[0]?.path).toBe('children.0');
  });

  it('reports every unconvertible node rather than stopping at the first', () => {
    const { converted, warnings } = migrateIconNodeKeys({
      children: [
        { type: 'icon', name: 'check' },
        { type: 'icon', icon: 'save', name: 'save_icon' },
        { type: 'icon' },
      ],
    });

    expect(converted).toBe(1);
    expect(warnings.map((w) => w.reason)).toEqual(['both-keys', 'no-glyph-key']);
  });

  it('leaves non-icon nodes alone, including their `name`', () => {
    const form = { type: 'form', children: [{ type: 'input', name: 'email' }] };
    const { document, converted } = migrateIconNodeKeys(form);

    // `name` on a field IS the field name. A converter that swept every `name`
    // would corrupt every form in storage.
    expect(document).toBe(form);
    expect(converted).toBe(0);
  });

  it('treats an empty-string `name` as no glyph, not as a glyph called ""', () => {
    const { converted, warnings } = migrateIconNodeKeys({ type: 'icon', name: '' });

    expect(converted).toBe(0);
    expect(warnings[0]?.reason).toBe('no-glyph-key');
  });
});
