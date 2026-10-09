// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0091 D1/D2] The user page's "Permission Sets" list shows each
 * assignment's validity window.
 *
 * The resolver drops a `sys_user_permission_set` row outside its half-open
 * `[valid_from, valid_until)` window at every evaluation, so the two bounds
 * decide whether a listed grant confers anything. A list showing only the set
 * would present an expired or not-yet-active assignment as a live grant.
 *
 * Read from the shipped page metadata, through the spec's own contract for the
 * block, so the pin fails if the columns go and if the block stops being one
 * the contract accepts.
 */

import { describe, expect, it } from 'vitest';
import { RecordRelatedListProps } from '@objectstack/spec/ui';
import { SysUserDetailPage } from './sys-user.page.js';

type Node = { type?: unknown; properties?: Record<string, unknown> } & Record<string, unknown>;

function relatedListsOf(root: unknown, objectName: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const node = n as Node;
    if (node.type === 'record:related_list' && node.properties?.objectName === objectName) found.push(node.properties);
    Object.values(node).forEach(walk);
  };
  walk(root);
  return found;
}

describe('sys_user page — the permission-set assignments list', () => {
  const lists = relatedListsOf(SysUserDetailPage, 'sys_user_permission_set');

  it('is one related list, and the block contract accepts it', () => {
    expect(lists).toHaveLength(1);
    const parsed = RecordRelatedListProps.safeParse(lists[0]);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it('lists valid_from and valid_until beside the set', () => {
    const columns = lists[0]?.columns as unknown[];
    expect(columns).toEqual(expect.arrayContaining(['permission_set_id', 'valid_from', 'valid_until']));
  });
});
