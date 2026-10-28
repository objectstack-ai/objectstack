// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22568 — the user page's details body is the FIRST tab item of the strip
 * the page authors.
 *
 * The page's own strip replaces the synthesized one the Details tab lives in,
 * so a details body authored anywhere else never rendered: the page's Identity
 * and Audit sections never showed, and the admin-internal columns it hides
 * (`ban_reason`, `ban_expires`, …) were never hidden by it. The page carries
 * its `record:details` inside the strip it authors. (It was a slotted page
 * whose `tabs` slot held that strip until the slot retired, objectstack#27053;
 * it is now a `kind: 'full'` page that authors the same strip.)
 *
 * Read from the shipped page metadata, through the spec's own page contract,
 * so the pin fails if the page stops parsing and if the details body moves
 * out of the first tab or loses a section or a hidden field.
 */

import { describe, expect, it } from 'vitest';
import { PageSchema } from '@objectstack/spec/ui';
import { SysUserDetailPage } from './sys-user.page.js';

type Rec = Record<string, unknown>;

/** The details body as the page authored it before the move — sections and hidden fields unchanged. */
const HIDE_FIELDS = [
  'id',
  'banned',
  'ban_reason',
  'ban_expires',
  'email',
  'phone_number',
  'email_verified',
  'two_factor_enabled',
  'role',
];
const SECTIONS = [
  {
    label: { en: 'Identity', 'zh-CN': '身份', 'ja-JP': 'アイデンティティ', 'es-ES': 'Identidad' },
    fields: ['name', 'image'],
  },
  {
    label: { en: 'Audit', 'zh-CN': '审计', 'ja-JP': '監査', 'es-ES': 'Auditoría' },
    fields: ['created_at', 'updated_at'],
  },
];

describe('sys_user_detail — the details body lives in the first tab', () => {
  const components = SysUserDetailPage.regions![0]!.components as Rec[];
  const tabs = components.find((c) => c.type === 'page:tabs') as Rec;
  const items = (tabs.properties as Rec).items as Rec[];

  it('parses through PageSchema', () => {
    const parsed = PageSchema.safeParse(SysUserDetailPage);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it('is a full page that authors its own strip, with no slot map', () => {
    expect(SysUserDetailPage.kind).toBe('full');
    expect(SysUserDetailPage).not.toHaveProperty('slots');
    expect(tabs.type).toBe('page:tabs');
  });

  it('carries the `record:details` as the only child of the FIRST tab item, sections and hidden fields intact', () => {
    const first = items[0]!;
    expect((first.label as Rec).en).toBe('Details');
    const children = first.children as Rec[];
    expect(children.map((c) => c.type)).toEqual(['record:details']);
    const props = children[0]!.properties as Rec;
    expect(props.hideFields).toEqual(HIDE_FIELDS);
    expect(props.sections).toEqual(SECTIONS);
  });

  it('is the one `record:details` on the page — no second copy anywhere in its body', () => {
    const found: unknown[] = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      if ((n as Rec).type === 'record:details') found.push(n);
      Object.values(n as Rec).forEach(walk);
    };
    walk(components);
    expect(found).toHaveLength(1);
  });
});
