/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list view twin refuses the five spec tombstones that aged out at 18.2
 * (objectstack#25767, ADR-0087 one major on).
 *
 * `zod/objectql.zod.ts`'s `ListViewSchema` is `BaseSchema` (`.passthrough()`)
 * extended with the spec list view's members by reference. Through spec 18.1
 * that projection carried `striped`, `bordered`, `virtualScroll` (retired by
 * objectstack#7176) and `responsive`, `performance` (the #3896 audit
 * close-out) as `retiredKey()` tombstones, so the twin refused each at the
 * key's own path. At 18.2 the tombstones aged out of the spec's shape: the
 * spec refuses each as an UNKNOWN key at the view's root, naming the protocol
 * upgrade guide, and the projection carries nothing under the name — so
 * without an arm of its own the twin would KEEP an authored `striped: true`
 * in silence. The arms are the console's own refusals
 * (`agedOutSpecKeyRefusal`, `zod/tombstone.zod.ts`).
 *
 * Each key is pinned on three faces, with the spec's own verdict as control:
 *
 *   - the flat twin (`ListViewSchema`): `invalid_type` at the key's path, the
 *     message naming the key, the spec's guide sentence and the age-out;
 *   - the page `list-view` node (`ListViewBlockSchema`), whose `properties`
 *     bag reads the twin's shape: refused in the bag and, through the row's
 *     own retirement, written flat — `responsive` excepted, which is a node-
 *     level key of the spec's page component and keeps that meaning flat;
 *   - the TypeScript face: `ListViewSchema` is derived from the twin
 *     (`ListViewInferred = z.input<…>`), so each key is `?: undefined` there and
 *     an authored value is a compile error. There is no hand-kept `?: never`
 *     member to keep in step, as with the twin's `body` / `children`.
 *
 * The control: the spec's `ListViewSchema` refuses each key as an unknown one.
 * If the spec ever re-admits a key, the twin's refusal would be hiding a live
 * member, and the control goes red first.
 */

import { describe, it, expect } from 'vitest';
import { RETIRED_KEY_UPGRADE_GUIDE_SENTENCE } from '@objectstack/spec/shared';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import { ListViewSchema as OuiListViewSchema, ListViewBlockSchema } from '../zod/objectql.zod.js';
import type { ListViewSchema } from '../objectql';

const AGED_OUT_LIST_VIEW_KEYS = ['striped', 'bordered', 'virtualScroll', 'responsive', 'performance'] as const;

const TWIN_LEGAL = { type: 'list-view', objectName: 'contact' };
const BLOCK_LEGAL = { type: 'list-view', properties: { data: { provider: 'object', object: 'contact' } } };
const SPEC_LEGAL = { columns: ['name'] };

type Issue = { code: string; path: PropertyKey[]; message: string };

const issueAt = (issues: readonly Issue[], path: string) => issues.find((i) => i.path.join('.') === path);

const expectAgedOutIssue = (issue: Issue | undefined, key: string) => {
  expect(issue, `no issue at '${key}' — the value is kept in silence`).toBeTruthy();
  expect(issue!.code).toBe('invalid_type');
  expect(issue!.message).toContain(`Unrecognized key(s) on this list view: \`${key}\``);
  expect(issue!.message).toContain(RETIRED_KEY_UPGRADE_GUIDE_SENTENCE);
  expect(issue!.message).toContain('objectstack#25767');
};

describe('list view: the five spec tombstones that aged out at 18.2 are the twin\'s own refusals (objectstack#25767)', () => {
  it('accept legs: a list view without them parses on every face', () => {
    expect(OuiListViewSchema.safeParse(TWIN_LEGAL).success).toBe(true);
    expect(ListViewBlockSchema.safeParse(BLOCK_LEGAL).success).toBe(true);
    expect(SpecListViewSchema.safeParse(SPEC_LEGAL).success).toBe(true);
  });

  it.each(AGED_OUT_LIST_VIEW_KEYS)('`%s`: the spec refuses it as an unknown key (the control)', (key) => {
    const r = SpecListViewSchema.safeParse({ ...SPEC_LEGAL, [key]: true });
    expect(r.success, `the spec accepts '${key}' again — the twin's refusal would hide a live member`).toBe(false);
    const issues = r.success ? [] : (r.error.issues as readonly Issue[]);
    expect(issueAt(issues, key), `the spec refuses '${key}' at its own path — a tombstone came back`).toBeUndefined();
    const root = issues.filter((i) => i.path.length === 0).map((i) => i.message).join('\n');
    expect(root).toMatch(new RegExp(`Unrecognized key\\(s\\)[^\\n]*\`${key}\``));
    expect(root).toContain('https://objectstack.ai/docs/protocol-upgrade');
  });

  it.each(AGED_OUT_LIST_VIEW_KEYS)('`%s`: the flat twin refuses it by name', (key) => {
    expect(Object.keys(OuiListViewSchema.shape), `'${key}' is no longer declared`).toContain(key);
    const r = OuiListViewSchema.safeParse({ ...TWIN_LEGAL, [key]: true });
    expect(r.success, `the twin keeps '${key}'`).toBe(false);
    expectAgedOutIssue(r.success ? undefined : issueAt(r.error.issues as readonly Issue[], key), key);
  });

  it.each(AGED_OUT_LIST_VIEW_KEYS)('`%s`: a page `list-view` node refuses it in its `properties` bag', (key) => {
    const r = ListViewBlockSchema.safeParse({ ...BLOCK_LEGAL, properties: { ...BLOCK_LEGAL.properties, [key]: true } });
    expect(r.success, `the bag keeps '${key}'`).toBe(false);
    expectAgedOutIssue(r.success ? undefined : issueAt(r.error.issues as readonly Issue[], `properties.${key}`), key);
  });

  it.each(AGED_OUT_LIST_VIEW_KEYS.filter((k) => k !== 'responsive'))(
    '`%s`: a page `list-view` node refuses it written flat, with the row\'s own retirement',
    (key) => {
      const r = ListViewBlockSchema.safeParse({ ...BLOCK_LEGAL, [key]: true });
      expect(r.success, `the node keeps a flat '${key}'`).toBe(false);
      expectAgedOutIssue(r.success ? undefined : issueAt(r.error.issues as readonly Issue[], key), key);
    },
  );

  it('the TypeScript face: each key is `?: undefined`, so an authored value is a compile error', () => {
    const ok: ListViewSchema = { type: 'list-view', objectName: 'contact' };
    // @ts-expect-error — `striped` aged out of the spec (objectstack#25767); the twin's arm types it `undefined`.
    const striped: ListViewSchema = { type: 'list-view', objectName: 'contact', striped: true };
    // @ts-expect-error — `bordered`, the same.
    const bordered: ListViewSchema = { type: 'list-view', objectName: 'contact', bordered: true };
    // @ts-expect-error — `virtualScroll`, the same.
    const virtualScroll: ListViewSchema = { type: 'list-view', objectName: 'contact', virtualScroll: true };
    // @ts-expect-error — `responsive`, the same.
    const responsive: ListViewSchema = { type: 'list-view', objectName: 'contact', responsive: { breakpoint: 'md' } };
    // @ts-expect-error — `performance`, the same.
    const performance: ListViewSchema = { type: 'list-view', objectName: 'contact', performance: { lazyLoad: true } };
    // The compile-time verdict and the parse verdict agree.
    for (const authored of [striped, bordered, virtualScroll, responsive, performance]) {
      expect(OuiListViewSchema.safeParse(authored).success).toBe(false);
    }
    expect(OuiListViewSchema.safeParse(ok).success).toBe(true);
  });
});
