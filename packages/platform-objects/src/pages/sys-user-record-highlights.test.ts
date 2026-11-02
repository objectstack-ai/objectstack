// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user record page's highlight chips do not show better-auth's legacy
 * `role` scalar (#28105, ruling D1).
 *
 * The chip strip promoted `role` as "Platform Role", but the scalar is not the
 * platform role: ObjectStack never writes it, and when the better-auth admin
 * plugin is on it reads `user` for every user, the seeded platform admin
 * included. The details grid keeps hiding it, so the record page does not
 * present it anywhere; the field stays declared (see
 * `identity/sys-user-list-columns.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { SysUserDetailPage } from './sys-user.page.js';

type Rec = Record<string, unknown>;

/** Every component node of the page, nested tab children included. */
function nodes(): Rec[] {
  const out: Rec[] = [];
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const n of list as Rec[]) {
      out.push(n);
      walk(n.children);
      const items = (n.properties as Rec | undefined)?.items;
      if (Array.isArray(items)) for (const it of items as Rec[]) walk(it.children);
    }
  };
  for (const r of SysUserDetailPage.regions ?? []) walk((r as Rec).components);
  return out;
}

const fieldsOf = (n: Rec): unknown[] => ((n.properties as Rec | undefined)?.fields as unknown[]) ?? [];

describe('sys_user_detail — highlight chips (#28105)', () => {
  it('pins the header chip strip: email, phone, verification', () => {
    const header = nodes().filter((n) => n.type === 'record:highlights')[0]!;
    expect(fieldsOf(header)).toEqual(['email', 'phone_number', 'email_verified']);
  });

  it('no record:highlights node on the page carries role', () => {
    const strips = nodes().filter((n) => n.type === 'record:highlights');
    expect(strips.length).toBeGreaterThan(0);
    for (const s of strips) expect(fieldsOf(s)).not.toContain('role');
  });

  it('no record:details section draws role either', () => {
    const details = nodes().filter((n) => n.type === 'record:details');
    expect(details.length).toBeGreaterThan(0);
    for (const d of details) {
      const props = d.properties as Rec;
      const shown = ((props.sections as { fields: string[] }[]) ?? []).flatMap((s) => s.fields);
      expect(shown).not.toContain('role');
      expect(props.hideFields).toContain('role');
    }
  });
});
