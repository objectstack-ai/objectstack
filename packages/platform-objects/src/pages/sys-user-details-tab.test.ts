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
import { PageSchema, RecordRelatedListProps } from '@objectstack/spec/ui';
import { SysUserDetailPage } from './sys-user.page.js';

type Rec = Record<string, unknown>;

/** The details body: its sections and hidden fields. */
const HIDE_FIELDS = [
  'id',
  'email',
  'phone_number',
  'email_verified',
  'two_factor_enabled',
  'role',
];
const SECTIONS = [
  {
    label: { en: 'Identity', 'zh-CN': '身份', 'ja-JP': 'アイデンティティ', 'es-ES': 'Identidad', 'zh-Hant': '身分', ar: 'الهوية', fr: 'Identité', 'pt-BR': 'Identidade', ru: 'Идентификация', de: 'Identität', ko: 'ID 정보' },
    // #27859: a saved Locale is shown; the renderer draws only authored sections.
    fields: ['name', 'image', 'locale'],
  },
  {
    // The reporting line: who this person reports to (see the describe below).
    label: { en: 'Reporting Line', 'zh-CN': '汇报关系', 'ja-JP': 'レポートライン', 'es-ES': 'Línea de reporte', 'zh-Hant': '匯報關係', ar: 'التسلسل الإداري', fr: 'Ligne hiérarchique', 'pt-BR': 'Linha de reporte', ru: 'Подчинённость', de: 'Berichtslinie', ko: '보고 라인' },
    fields: ['manager_id'],
  },
  {
    // #27859: a banned user reads as banned, with the reason, not as active.
    label: { en: 'Account Status', 'zh-CN': '账号状态', 'ja-JP': 'アカウントの状態', 'es-ES': 'Estado de la cuenta', 'zh-Hant': '帳號狀態', ar: 'حالة الحساب', fr: 'État du compte', 'pt-BR': 'Status da conta', ru: 'Статус учётной записи', de: 'Kontostatus', ko: '계정 상태' },
    fields: ['banned', 'ban_reason', 'ban_expires'],
  },
  {
    label: { en: 'Audit', 'zh-CN': '审计', 'ja-JP': '監査', 'es-ES': 'Auditoría', 'zh-Hant': '稽核', ar: 'التدقيق', fr: 'Audit', 'pt-BR': 'Auditoria', ru: 'Аудит', de: 'Audit', ko: '감사' },
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

  it('carries the `record:details` as the FIRST child of the FIRST tab item, sections and hidden fields intact', () => {
    const first = items[0]!;
    expect((first.label as Rec).en).toBe('Details');
    const children = first.children as Rec[];
    // The details grid, then the Direct Reports list (pinned below).
    expect(children.map((c) => c.type)).toEqual(['record:details', 'record:related_list']);
    const props = children[0]!.properties as Rec;
    expect(props.hideFields).toEqual(HIDE_FIELDS);
    expect(props.sections).toEqual(SECTIONS);
  });

  it('shows locale and the ban state, and hides none of them (#27859)', () => {
    const props = (items[0]!.children as Rec[])[0]!.properties as Rec;
    const shown = (props.sections as { fields: string[] }[]).flatMap((s) => s.fields);
    for (const f of ['locale', 'banned', 'ban_reason', 'ban_expires']) {
      expect(shown, f).toContain(f);
      expect(props.hideFields, f).not.toContain(f);
    }
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

/**
 * The reporting line is read back on the record: who this person reports to,
 * and who reports to them.
 *
 * `sys_user.manager_id` is `readonly` (ADR-0092 D4) and written only by the
 * admin endpoint behind Set Manager / Remove Manager, and the renderer draws
 * only the sections a page names. Before, no section named it and no list
 * showed its reverse, so an admin who had set a manager could not see it
 * anywhere in Setup. Decision batch #127 item 1: the manager is this explicit
 * link alone; a business unit's head is not read here.
 */
describe('sys_user_detail — the reporting line is shown in the Details tab', () => {
  const parsed = PageSchema.parse(SysUserDetailPage);
  const strip = (parsed.regions![0]!.components as Rec[]).find((c) => c.type === 'page:tabs') as Rec;
  const details = ((strip.properties as Rec).items as Rec[])[0]!;
  const children = details.children as Rec[];

  it('a Details section names `manager_id`, and nothing hides it', () => {
    const props = children.find((c) => c.type === 'record:details')!.properties as Rec;
    const sections = props.sections as { label: Rec; fields: string[] }[];
    const holding = sections.filter((s) => s.fields.includes('manager_id'));
    expect(holding.map((s) => s.label.en)).toEqual(['Reporting Line']);
    expect(props.hideFields).not.toContain('manager_id');
  });

  it('the Direct Reports list reads `sys_user` rows whose `manager_id` is this record\'s id', () => {
    const lists = children.filter((c) => c.type === 'record:related_list');
    expect(lists).toHaveLength(1);
    const props = lists[0]!.properties as Rec;
    expect((props.title as Rec).en).toBe('Direct Reports');
    expect(props.objectName).toBe('sys_user');
    expect(props.relationshipField).toBe('manager_id');
    // The parent value the relationship field is matched against is the
    // record's id: nothing is authored, and the props contract's default is
    // `id` (the page envelope serves `properties` verbatim, so the default is
    // read through the block's own schema).
    expect(props).not.toHaveProperty('relationshipValueField');
    const contract = RecordRelatedListProps.safeParse(props);
    expect(contract.success, JSON.stringify(contract.error?.issues ?? [])).toBe(true);
    expect(contract.data!.relationshipValueField).toBe('id');
    // No authored filter narrows it, and no `add` picker: the link is the
    // admin endpoint's to write, never a related-list insert.
    expect(props.filter).toBeUndefined();
    expect(props.add).toBeUndefined();
  });

  it('both labels carry the same locales as the tab they sit in', () => {
    const tabLocales = Object.keys(details.label as Rec).sort();
    const props = children.find((c) => c.type === 'record:details')!.properties as Rec;
    const section = (props.sections as { label: Rec; fields: string[] }[]).find((s) => s.fields.includes('manager_id'))!;
    const list = children.find((c) => c.type === 'record:related_list')!.properties as Rec;
    expect(Object.keys(section.label).sort()).toEqual(tabLocales);
    expect(Object.keys(list.title as Rec).sort()).toEqual(tabLocales);
  });
});
