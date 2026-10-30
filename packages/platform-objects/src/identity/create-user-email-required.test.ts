// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user.create_user` — the dialog marks Email required exactly when phone
 * sign-in is off (#27857).
 *
 * The endpoint requires an email or a phone number, and the dialog offers a
 * phone field only where `features.phoneNumber` is on. With one optional Email
 * param, the dialog drew no required mark, and an empty submit came back as a
 * server refusal. Two params back the one field: a required one gated on phone
 * sign-in being off, and an optional one behind the `phoneNumber` feature. The
 * dialog collects and submits only the visible params, so exactly one is shown
 * and submitted for any value of the flag.
 */

import { describe, expect, it } from 'vitest';
import { SysUser } from './index.js';

type Param = { field?: string; name?: string; required?: boolean; visible?: unknown };

const params = (): Param[] =>
  ((SysUser.actions ?? []).find((a) => a.name === 'create_user')?.params ?? []) as Param[];

const source = (v: unknown): string =>
  typeof v === 'string' ? v : String((v as { source?: unknown } | undefined)?.source ?? '');

/** Evaluate the two gate shapes this action uses against a `features` map. */
const shown = (p: Param, phoneNumber: boolean | undefined): boolean => {
  const s = source(p.visible);
  if (s === '') return true;
  if (s === 'features.phoneNumber != true') return phoneNumber !== true;
  if (s === 'features.phoneNumber == true') return phoneNumber === true;
  throw new Error(`unexpected email gate: ${s}`);
};

describe('create_user — Email is required when phone sign-in is off (#27857)', () => {
  const email = () => params().filter((p) => p.field === 'email');

  it('declares two Email params, the required one first', () => {
    expect(email().map((p) => [p.required === true, source(p.visible)])).toEqual([
      [true, 'features.phoneNumber != true'],
      [false, 'features.phoneNumber == true'],
    ]);
  });

  for (const flag of [false, true, undefined]) {
    it(`phone sign-in ${String(flag)}: exactly one Email param is shown, required iff phone is off`, () => {
      const visible = email().filter((p) => shown(p, flag));
      expect(visible).toHaveLength(1);
      expect(visible[0]!.required === true).toBe(flag !== true);
    });
  }
});
