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
 * `titleFormat` placeholder naming a lookup renders the stored id in both.
 */

import { describe, it, expect } from 'vitest';
import { ExpressionEngine } from '@objectstack/formula';
import { isTitleEligible, provisionPrimary, resolveDisplayField } from '@objectstack/spec/data';
import { SysAccount } from './sys-account.object.js';
import { SysBusinessUnitMember } from './sys-business-unit-member.object.js';
import { SysInvitation } from './sys-invitation.object.js';
import { SysMember } from './sys-member.object.js';
import { SysScimGroupMember } from './sys-scim-group-member.object.js';
import { SysScimProjectionGrant } from './sys-scim-projection-grant.object.js';
import { SysScimSubject } from './sys-scim-subject.object.js';
import { SysTeamMember } from './sys-team-member.object.js';
import { SysTwoFactor } from './sys-two-factor.object.js';
import { SysVerification } from './sys-verification.object.js';

type Row = Record<string, unknown>;
type Schema = { name: string; nameField?: string; displayNameField?: string; titleFormat?: unknown; fields: Record<string, any> };

/**
 * The text a `titleFormat`-first renderer draws for a fully populated row:
 * each `{field}` placeholder substituted with the row's value. It is the
 * reference the formula has to reproduce, not a second title resolver. The
 * parsed schema carries `titleFormat` as a `{ dialect: 'template', source }`
 * envelope.
 */
function renderTitleFormat(titleFormat: unknown, row: Row): string {
  const source = typeof titleFormat === 'string' ? titleFormat : (titleFormat as { source?: unknown })?.source;
  if (typeof source !== 'string') throw new Error(`titleFormat carries no template source: ${JSON.stringify(titleFormat)}`);
  return source.replace(/\{\{?\s*([a-zA-Z0-9_.]+)\s*\}?\}/g, (_m, key: string) => String(row[key] ?? ''));
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
  /** A stored row as the driver returns it: every column present, ids as stored. */
  row: Row;
  /** The title the `titleFormat` renders for `row`. */
  title: string;
}

const FORMULA_CASES: Case[] = [
  {
    schema: SysAccount as unknown as Schema,
    row: { id: 'acc_7Hq2', provider_id: 'github', account_id: '5812039', user_id: 'usr_Ab12' },
    title: 'github - 5812039',
  },
  {
    schema: SysBusinessUnitMember as unknown as Schema,
    row: { id: 'bum_9Kz1', user_id: 'usr_Ab12', business_unit_id: 'bu_emea' },
    title: 'usr_Ab12 in bu_emea',
  },
  {
    schema: SysInvitation as unknown as Schema,
    row: { id: 'inv_3Pw8', email: 'ada@example.com', role: 'member', organization_id: null },
    title: 'Invitation for ada@example.com',
  },
  {
    schema: SysMember as unknown as Schema,
    row: { id: 'mem_5Tr4', user_id: 'usr_Ab12', role: 'admin', organization_id: null },
    title: 'usr_Ab12 (admin)',
  },
  {
    schema: SysScimGroupMember as unknown as Schema,
    row: { id: 'sgm_2Lc6', scim_user_id: 'scu_Qx90', group_id: 'scg_ops' },
    title: 'scu_Qx90 in scg_ops',
  },
  {
    schema: SysScimProjectionGrant as unknown as Schema,
    row: { id: 'spg_8Vn3', role: 'billing_admin', user_id: 'usr_Ab12' },
    title: 'billing_admin → usr_Ab12',
  },
  {
    schema: SysTeamMember as unknown as Schema,
    row: { id: 'tmm_4Ds7', user_id: 'usr_Ab12', team_id: 'team_core' },
    title: 'usr_Ab12 in team_core',
  },
  {
    schema: SysTwoFactor as unknown as Schema,
    row: { id: 'tfa_6Gm5', user_id: 'usr_Ab12' },
    title: 'Two-factor for usr_Ab12',
  },
  {
    schema: SysVerification as unknown as Schema,
    row: { id: 'ver_1Jb9', identifier: 'ada@example.com', value: 'tok_redacted' },
    title: 'Verification for ada@example.com',
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
      expect(title).toBe(renderTitleFormat(c.schema.titleFormat, c.row));
      expect(title).not.toBe(c.row.id);
      expect(String(title)).not.toContain(String(c.row.id));
    });
  });

  it('sys_member: a row without a role is titled by its user alone', () => {
    const row = { id: 'mem_5Tr5', user_id: 'usr_Cd34', role: null, organization_id: null };
    expect(evaluateDisplayTitle(SysMember as unknown as Schema, row)).toBe('usr_Cd34');
  });

  it('sys_scim_subject: the single-field title points at `user_id` directly', () => {
    const schema = SysScimSubject as unknown as Schema;
    expect(servedPointers(schema)).toEqual({ nameField: 'user_id', displayNameField: 'user_id' });
    expect(schema.fields.display_title).toBeUndefined();
    const row = { id: 'scs_0Wy2', user_id: 'usr_Ab12', revision: 3 };
    expect(row[resolveDisplayField(schema as any) as 'user_id']).toBe(renderTitleFormat(schema.titleFormat, row));
  });
});
