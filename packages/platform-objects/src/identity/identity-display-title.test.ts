// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record title of the ten identity objects that declared a `titleFormat`
 * and no title pointer (#20059).
 *
 * ADR-0079 resolves a record's title as `nameField ?? displayNameField ??
 * derivation`, and an explicit `nameField` takes precedence over the
 * render-only `titleFormat`. The registry's materialization seam runs
 * `provisionPrimary(…, { synthesize: false })` over every base layer, and on
 * these objects that designate-only pass derived `id` (the first
 * title-eligible field) and stamped `nameField: 'id'`. A `/meta` read serves
 * that stamp as if the author had declared it, so a renderer honouring
 * ADR-0079's order drew the raw record id as the record page's H1.
 *
 * The `titleFormat` describe prescribes the migration: a single-field title
 * moves to `nameField`, a composite becomes a text formula designated as
 * `nameField`. This file asserts, per object:
 *
 *  1. the pointer the designate-only pass leaves on the SERVED body is the
 *     declared one (`display_title`, or `user_id` for the single-field
 *     `sys_scim_subject`), never `id`, with the `displayNameField` mirror;
 *  2. `display_title` is a text formula, so it is title-eligible and has no
 *     stored column;
 *  3. the formula, evaluated the way the engine's read path evaluates it,
 *     renders the text the `titleFormat` renders for a stored row, and that
 *     text is not the row's id;
 *  4. where a source column is nullable (`sys_member.role`), a row without it
 *     is titled by the remaining column instead of failing to evaluate.
 *
 * The engine's read path (`applyFormulaPlan`, `@objectstack/objectql`) calls
 * `ExpressionEngine.evaluate(expression, { now, …, record })` on the row the
 * driver returned, and writes `null` when the result is not `ok`. That is the
 * call below. A formula runs on the STORED row, before `$expand`, so a
 * `titleFormat` placeholder naming a lookup renders the stored id in both —
 * except where the formula reads ONE hop through the lookup
 * (`record.user_id.name`, ADR-0079 addendum 2026-10-18). There the read path
 * evaluates it over a copy of the row whose lookup carries the related row,
 * and the console renders the `titleFormat` placeholder by that related row's
 * display name; the case's `row` is that copy (`sys_business_unit_member`).
 * The engine-level proof of the hop is
 * `plugin-security/src/business-unit-member-title.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ExpressionEngine } from '@objectstack/formula';
import { isTitleEligible, provisionPrimary, resolveDisplayField } from '@objectstack/spec/data';
import { SysAccount } from './sys-account.object.js';
import { SysBusinessUnitMember } from './sys-business-unit-member.object.js';
import { SysInvitation } from './sys-invitation.object.js';
import { SysMember } from './sys-member.object.js';
import { SysScimGroup } from './sys-scim-group.object.js';
import { SysScimGroupMember } from './sys-scim-group-member.object.js';
import { SysScimProjectionGrant } from './sys-scim-projection-grant.object.js';
import { SysScimSubject } from './sys-scim-subject.object.js';
import { SysScimUser } from './sys-scim-user.object.js';
import { SysTeamMember } from './sys-team-member.object.js';
import { SysTwoFactor } from './sys-two-factor.object.js';
import { SysVerification } from './sys-verification.object.js';

/**
 * The `titleFormat` template each object declared before the ruling of record
 * on #29007 (6574393684, letter B) retired it: an object definition that
 * declares one is refused at the metadata save gate and by `os validate`, so
 * the object no longer carries it. Kept here as the reference text the title
 * has to reproduce — the text the template drew — not as a title resolver.
 */
const RETIRED_TITLE_TEMPLATES: Readonly<Record<string, string>> = {
  sys_account: '{provider_id} - {account_id}',
  sys_business_unit_member: '{user_id} in {business_unit_id}',
  sys_invitation: 'Invitation for {email}',
  sys_member: '{user_id} ({role})',
  sys_scim_group_member: '{scim_user_id} in {group_id}',
  sys_scim_projection_grant: '{role} → {user_id}',
  sys_scim_subject: '{user_id}',
  sys_team_member: '{user_id} in {team_id}',
  sys_two_factor: 'Two-factor for {user_id}',
  sys_verification: 'Verification',
};

type Row = Record<string, unknown>;
type Schema = { name: string; nameField?: string; displayNameField?: string; titleFormat?: unknown; fields: Record<string, any> };

/**
 * The text a `titleFormat`-first renderer draws for a fully populated row:
 * each `{field}` placeholder substituted with the row's value. It is the
 * reference the formula has to reproduce, not a second title resolver. The
 * parsed schema carries `titleFormat` as a `{ dialect: 'template', source }`
 * envelope. A placeholder whose value is a related row (an expanded lookup) is
 * drawn by that row's own title, as the console draws one: a person's `name`,
 * else their `email`; a SCIM user's `user_name`; a SCIM group's
 * `display_name` (each its object's `nameField`, pinned below).
 */
function renderTitleFormat(titleFormat: unknown, row: Row): string {
  const source = typeof titleFormat === 'string' ? titleFormat : (titleFormat as { source?: unknown })?.source;
  if (typeof source !== 'string') throw new Error(`titleFormat carries no template source: ${JSON.stringify(titleFormat)}`);
  const shown = (value: unknown): string => {
    if (value && typeof value === 'object') {
      const related = value as { name?: unknown; email?: unknown; user_name?: unknown; display_name?: unknown };
      if (typeof related.name === 'string' && related.name.trim()) return related.name;
      return String(related.email ?? related.user_name ?? related.display_name ?? '');
    }
    return String(value ?? '');
  };
  return source.replace(/\{\{?\s*([a-zA-Z0-9_.]+)\s*\}?\}/g, (_m, key: string) => shown(row[key]));
}

/** `display_title` evaluated as the read path evaluates a formula field. */
function evaluateDisplayTitle(schema: Schema, row: Row): unknown {
  const field = schema.fields.display_title;
  const expression = typeof field.expression === 'string' ? { dialect: 'cel' as const, source: field.expression } : field.expression;
  const r = ExpressionEngine.evaluate(expression, { now: new Date(), record: row });
  return r.ok ? r.value : null;
}

/** The pointer the registry's designate-only pass leaves on the served body. */
function servedPointers(schema: Schema): { nameField?: string; displayNameField?: string } {
  const served = provisionPrimary(schema as any, { synthesize: false }) as Schema;
  return { nameField: served.nameField, displayNameField: served.displayNameField };
}

interface Case {
  schema: Schema;
  /**
   * A stored row as the driver returns it: every column present, ids as
   * stored; where the formula reads a hop, the copy the read path evaluates it
   * over, the lookup carrying the related row.
   */
  row: Row;
  /** The title the `titleFormat` renders for `row`. */
  title: string;
}

/**
 * [#30454] The related rows a one-hop read preloads, as the formula sees them:
 * a person, a provisioned SCIM user and a SCIM group.
 */
const ADA = { id: 'usr_Ab12', name: 'Ada Lovelace', email: 'ada@example.com' };
const SCIM_ADA = { id: 'scu_Qx90', user_name: 'ada.lovelace@idp.example' };
const SCIM_OPS = { id: 'scg_ops', display_name: 'Operations' };

const FORMULA_CASES: Case[] = [
  {
    schema: SysAccount as unknown as Schema,
    row: { id: 'acc_7Hq2', provider_id: 'github', account_id: '5812039', user_id: 'usr_Ab12' },
    title: 'github - 5812039',
  },
  {
    schema: SysBusinessUnitMember as unknown as Schema,
    // The formula reads one hop through both lookups, so the row it is
    // evaluated against carries the related rows the read path preloads.
    row: {
      id: 'bum_9Kz1',
      user_id: { id: 'usr_Ab12', name: 'Ada Lovelace', email: 'ada@example.com' },
      business_unit_id: { id: 'bu_emea', name: 'EMEA Sales' },
    },
    title: 'Ada Lovelace in EMEA Sales',
  },
  {
    schema: SysInvitation as unknown as Schema,
    row: { id: 'inv_3Pw8', email: 'ada@example.com', role: 'member', organization_id: null },
    title: 'Invitation for ada@example.com',
  },
  {
    schema: SysMember as unknown as Schema,
    // [#30454] Reads one hop through `user_id`: the row carries the user.
    row: { id: 'mem_5Tr4', user_id: ADA, role: 'admin', organization_id: null },
    title: 'Ada Lovelace (admin)',
  },
  {
    schema: SysScimGroupMember as unknown as Schema,
    // [#30454] Reads one hop through both lookups: the provisioned user's
    // `user_name` and the group's `display_name`, each its object's title.
    row: { id: 'sgm_2Lc6', scim_user_id: SCIM_ADA, group_id: SCIM_OPS },
    title: 'ada.lovelace@idp.example in Operations',
  },
  {
    schema: SysScimProjectionGrant as unknown as Schema,
    // [#30454] Reads one hop through `user_id`: the row carries the user.
    row: { id: 'spg_8Vn3', role: 'billing_admin', user_id: ADA },
    title: 'billing_admin → Ada Lovelace',
  },
  {
    schema: SysTeamMember as unknown as Schema,
    row: { id: 'tmm_4Ds7', user_id: 'usr_Ab12', team_id: 'team_core' },
    title: 'usr_Ab12 in team_core',
  },
  {
    schema: SysTwoFactor as unknown as Schema,
    // [#30454] Reads one hop through `user_id`: the row carries the user.
    row: { id: 'tfa_6Gm5', user_id: ADA },
    title: 'Two-factor for Ada Lovelace',
  },
  {
    schema: SysVerification as unknown as Schema,
    row: { id: 'ver_1Jb9', identifier: 'ada@example.com', value: 'tok_redacted' },
    // [#21197] A fixed label: both columns this row carries are `internal`.
    title: 'Verification',
  },
];

describe('[#20059] identity objects resolve a real record title under ADR-0079 order', () => {
  describe.each(FORMULA_CASES.map((c) => [c.schema.name, c] as const))('%s', (_name, c) => {
    it('serves `display_title` as the title pointer, not the stamped `id`', () => {
      expect(servedPointers(c.schema)).toEqual({ nameField: 'display_title', displayNameField: 'display_title' });
      expect(resolveDisplayField(c.schema as any)).toBe('display_title');
    });

    it('declares `display_title` as a text formula (title-eligible, no stored column)', () => {
      const field = c.schema.fields.display_title;
      expect(field?.type).toBe('formula');
      expect(field?.returnType).toBe('text');
      expect(isTitleEligible(field)).toBe(true);
    });

    it('renders the `titleFormat` text for a stored row, never the id', () => {
      const title = evaluateDisplayTitle(c.schema, c.row);
      expect(title).toBe(c.title);
      expect(title).toBe(renderTitleFormat(RETIRED_TITLE_TEMPLATES[c.schema.name], c.row));
      expect(title).not.toBe(c.row.id);
      expect(String(title)).not.toContain(String(c.row.id));
    });
  });

  it('[#21197] sys_verification: neither the title nor the highlights name an internal column', () => {
    // The read path evaluates formulas BEFORE it omits `internal` fields, so a
    // title built from one re-serves it through `display_title`.
    const schema = SysVerification as unknown as Schema & { highlightFields?: string[] };
    const internal = Object.entries(schema.fields)
      .filter(([, def]) => (def as { internal?: unknown }).internal === true)
      .map(([name]) => name)
      .sort();
    expect(internal).toEqual(['identifier', 'value']);
    const row = { id: 'ver_7Rk2', identifier: 'credential-shaped-identifier', value: 'credential-shaped-value' };
    const title = String(evaluateDisplayTitle(schema, row));
    for (const name of internal) expect(title).not.toContain(String(row[name as 'identifier' | 'value']));
    for (const name of internal) expect(renderTitleFormat(RETIRED_TITLE_TEMPLATES[schema.name], row)).not.toContain(String(row[name as 'identifier' | 'value']));
    for (const name of internal) expect(schema.highlightFields ?? []).not.toContain(name);
  });

  it('sys_member: a row without a role is titled by its user alone', () => {
    const row = { id: 'mem_5Tr5', user_id: ADA, role: null, organization_id: null };
    expect(evaluateDisplayTitle(SysMember as unknown as Schema, row)).toBe('Ada Lovelace');
  });

  it('sys_scim_subject: the single-field title points at `user_id` directly', () => {
    const schema = SysScimSubject as unknown as Schema;
    expect(servedPointers(schema)).toEqual({ nameField: 'user_id', displayNameField: 'user_id' });
    expect(schema.fields.display_title).toBeUndefined();
    const row = { id: 'scs_0Wy2', user_id: 'usr_Ab12', revision: 3 };
    expect(row[resolveDisplayField(schema as any) as 'user_id']).toBe(renderTitleFormat(RETIRED_TITLE_TEMPLATES[schema.name], row));
  });
});

describe('[#30454] identity join objects are titled by the names their lookups point at, never stored ids', () => {
  // Each title reads its lookups ONE hop (ADR-0079 addendum 2026-10-18), as
  // `sys_business_unit_member` does; a person by the same handle rule (their
  // `name`, else their `email`). The engine reads each hop under the reader's
  // own authority; a hop it cannot serve (a related row the reader may not
  // read, or one that no longer exists) reaches the formula as the stored id
  // with no related row, which the formula answers with no title. The
  // engine-level proof of that read is
  // `plugin-security/src/business-unit-member-title.test.ts`.
  const GRACE = { id: 'usr_Cd34', name: '  ', email: 'grace@example.com' };

  /** Every `record.…` path the title formula reads. */
  function reads(schema: Schema): string[] {
    const expression = schema.fields.display_title?.expression;
    const source = String(typeof expression === 'string' ? expression : expression?.source);
    return [...new Set([...source.matchAll(/record\.([A-Za-z_][A-Za-z0-9_.]*)/g)].map((m) => m[1]))].sort();
  }

  interface HopCase {
    schema: Schema;
    /** Every path the formula may read: each lookup through its hop only. */
    reads: string[];
    /** A row whose person has a blank name, and the title it reads. */
    blankName: { row: Row; title: string };
    /** Rows each leaving one lookup (or every lookup) unresolved: the stored id, no related row. */
    unresolved: Row[];
  }

  const HOP_CASES: HopCase[] = [
    {
      schema: SysMember as unknown as Schema,
      reads: ['role', 'user_id.email', 'user_id.name'],
      blankName: { row: { id: 'mem_7Uv1', user_id: GRACE, role: 'member' }, title: 'grace@example.com (member)' },
      unresolved: [
        { id: 'mem_7Uv1', user_id: 'usr_Ab12', role: 'admin' },
        { id: 'mem_7Uv1', user_id: 'usr_Ab12', role: null },
      ],
    },
    {
      schema: SysTwoFactor as unknown as Schema,
      reads: ['user_id.email', 'user_id.name'],
      blankName: { row: { id: 'tfa_8Wx2', user_id: GRACE }, title: 'Two-factor for grace@example.com' },
      unresolved: [{ id: 'tfa_8Wx2', user_id: 'usr_Ab12' }],
    },
    {
      schema: SysScimProjectionGrant as unknown as Schema,
      reads: ['role', 'user_id.email', 'user_id.name'],
      blankName: { row: { id: 'spg_9Yz3', role: 'billing_admin', user_id: GRACE }, title: 'billing_admin → grace@example.com' },
      unresolved: [{ id: 'spg_9Yz3', role: 'billing_admin', user_id: 'usr_Ab12' }],
    },
  ];

  describe.each(HOP_CASES.map((c) => [c.schema.name, c] as const))('%s', (_name, c) => {
    it('reads its lookups only through the hop', () => {
      expect(reads(c.schema)).toEqual(c.reads);
    });

    it('a person whose name is blank is titled by their email', () => {
      expect(evaluateDisplayTitle(c.schema, c.blankName.row)).toBe(c.blankName.title);
    });

    it('a lookup that carries no related row leaves no title, never an id', () => {
      for (const row of c.unresolved) expect(evaluateDisplayTitle(c.schema, row)).toBeNull();
    });
  });

  describe('sys_scim_group_member', () => {
    const schema = SysScimGroupMember as unknown as Schema;

    it('reads each lookup only through the hop, to the title of the object it points at', () => {
      expect(reads(schema)).toEqual(['group_id.display_name', 'scim_user_id.user_name']);
      // The field each hop names is its target's own title pointer, and a
      // required stored text column (so no second hop and no null guard).
      for (const [lookup, target, title] of [
        ['scim_user_id', SysScimUser, 'user_name'],
        ['group_id', SysScimGroup, 'display_name'],
      ] as const) {
        const t = target as unknown as Schema;
        expect(schema.fields[lookup]?.reference).toBe(t.name);
        expect(resolveDisplayField(t as any)).toBe(title);
        expect(t.fields[title]).toMatchObject({ type: 'text', required: true });
      }
    });

    it('a lookup that carries no related row leaves no title, never an id', () => {
      expect(evaluateDisplayTitle(schema, { id: 'sgm_3Md7', scim_user_id: 'scu_Qx90', group_id: 'scg_ops' })).toBeNull();
      expect(evaluateDisplayTitle(schema, { id: 'sgm_3Md7', scim_user_id: SCIM_ADA, group_id: 'scg_ops' })).toBeNull();
      expect(evaluateDisplayTitle(schema, { id: 'sgm_3Md7', scim_user_id: 'scu_Qx90', group_id: SCIM_OPS })).toBeNull();
    });
  });
});
