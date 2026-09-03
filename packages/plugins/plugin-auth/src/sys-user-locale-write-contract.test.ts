// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write contract for `sys_user.locale`, end to end — maintainer ruling
 * 2026-09-03, option B, adopted 「同意」 (quoted verbatim and untranslated).
 *
 * The ruling opened a security boundary and stated a safety property in the
 * same breath: a user may now set their own notification language, and "a
 * malformed value is refused loudly by the column's BCP-47 shape check … and
 * never dead-letters a notification". A ruling's stated safety property that no
 * code enforces is the thing this file exists to catch — so it does not assert
 * that the rule is DECLARED, it drives the evaluator that runs it.
 *
 * ## Why the pin spans two packages
 *
 * The opening is not one edit, it is three that only work together, and each
 * one is invisible from where the others live:
 *
 *  1. `SYS_USER_PROFILE_EDIT_FIELDS` admits `locale` (plugin-auth) — without
 *     it the identity write guard strips the key and, on a locale-only PATCH,
 *     throws;
 *  2. `sys_user.locale` no longer declares `readonly` (platform-objects) —
 *     `stripReadonlyFields` runs on the update path BEFORE the validator, so a
 *     readonly column's value never reaches either the row or the rule. A
 *     whitelist entry alone would have been a silent no-op;
 *  3. the column declares `locale_bcp47_shape` (platform-objects) and
 *     objectql's rule validator enforces it.
 *
 * Nothing in either package sees all three. A test in plugin-auth that stopped
 * at the whitelist would be green over a column the engine still strips; a test
 * in platform-objects that stopped at the declaration would be green over a
 * rule nothing runs. This file holds all three at once, which is why it lives
 * here — plugin-auth is the one package that already depends on
 * `@objectstack/platform-objects` (the column) and `@objectstack/objectql`
 * (the evaluator).
 */

import { describe, it, expect } from 'vitest';
import { SysUser, SYS_USER_LOCALE_TAG_PATTERN } from '@objectstack/platform-objects/identity';
import { evaluateValidationRules } from '@objectstack/objectql';
import {
  registerIdentityWriteGuard,
  registerManagedUpdateWhitelist,
} from './identity-write-guard.js';
import { SYS_USER_PROFILE_EDIT_FIELDS } from './sys-user-writable-fields.js';

/** The column definition as the object actually declares it. */
const localeField = (SysUser as any).fields?.locale;

/** Every rule the object declares on `locale`. */
const localeRules = ((SysUser as any).validations ?? []).filter(
  (r: any) => r?.field === 'locale',
);

/** Run the object's rules over a payload; returns the thrown error, or null. */
function refusal(data: Record<string, unknown>, mode: 'insert' | 'update'): any {
  try {
    evaluateValidationRules(SysUser as any, data, mode, { previous: mode === 'update' ? {} : undefined });
    return null;
  } catch (e) {
    return e;
  }
}

describe('sys_user.locale — the column is writable at all (2026-09-03 ruling)', () => {
  it('declares no `readonly`, so a caller-supplied value survives to the validator', () => {
    expect(localeField, 'sys_user.locale is missing from the object').toBeTruthy();
    // ⚠️ Not cosmetic and not a UI hint here: `stripReadonlyFields` deletes a
    // caller-supplied value for any field carrying `readonly` before
    // `evaluateValidationRules` ever runs, so a `readonly` column is one the
    // whitelist below can admit and the engine will still silently drop.
    expect(localeField.readonly ?? false).toBe(false);
  });

  it('is on the identity write guard whitelist, and reaching the row needs BOTH', () => {
    expect(SYS_USER_PROFILE_EDIT_FIELDS.has('locale')).toBe(true);
  });
});

describe('sys_user.locale — malformed tags are refused loudly, never stored', () => {
  it('declares exactly one shape rule, and it carries the shared BCP-47 pattern', () => {
    expect(localeRules.map((r: any) => r.name)).toEqual(['locale_bcp47_shape']);
    const [rule] = localeRules;
    expect(rule.type).toBe('format');
    expect(rule.regex).toBe(SYS_USER_LOCALE_TAG_PATTERN);
    // `severity: 'warning' | 'info'` would log the violation and COMMIT the
    // write — the evaluator only collects `error` into the thrown envelope. A
    // rule that refuses nothing is how "declared" drifts from "enforced".
    expect(rule.severity ?? 'error').toBe('error');
    // The rule must run on both write shapes: an insert-only rule leaves every
    // profile edit unchecked, which is the shape a user actually performs.
    expect([...(rule.events ?? ['insert', 'update'])].sort()).toEqual(['insert', 'update']);
  });

  it.each([
    ['a language name rather than a tag', 'Chinese (Simplified)'],
    ['an underscore separator (POSIX, not BCP-47)', 'zh_CN'],
    ['a leading separator', '-CN'],
    ['a subtag over eight characters', 'zh-Hansumlaut'],
    ['a digit-led primary subtag', '1zh'],
    ['whitespace inside the tag', 'zh CN'],
    ['the hotcrm dead-letter shape', 'undefined'],
    ['a path traversal probe', '../../etc/passwd'],
  ])('refuses %s on insert and on update', (_why, value) => {
    for (const mode of ['insert', 'update'] as const) {
      const err = refusal({ locale: value }, mode);
      expect(err, `${value} was accepted on ${mode}`).toBeTruthy();
      // ADR-0112 envelope. `status` is not carried on the error object: the
      // REST boundary derives it, and `mapDataError` in `@objectstack/rest`
      // keys the 400 on EXACTLY the two discriminators asserted here
      // (`error.code === 'VALIDATION_FAILED' || error.name ===
      // 'ValidationError'`), so pinning both is what pins the status.
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.name).toBe('ValidationError');
      // The per-field half — what a form focuses and what a client acts on.
      expect(err.fields).toEqual([
        expect.objectContaining({ field: 'locale', code: 'invalid_format' }),
      ]);
      // The wording is part of the contract here: it is the only place a user
      // is told what a legal value looks like.
      expect(err.fields[0].message).toMatch(/BCP-47/);
    }
  });

  it.each([
    ['a bare language', 'zh'],
    ['language-region', 'zh-CN'],
    ['language-script-region', 'zh-Hans-CN'],
    ['a UN M.49 region', 'es-419'],
    ['the deployment-default spelling', 'en-US'],
    ['a three-letter language', 'yue-HK'],
  ])('accepts %s', (_why, value) => {
    expect(refusal({ locale: value }, 'insert')).toBeNull();
    expect(refusal({ locale: value }, 'update')).toBeNull();
  });

  it.each([
    ['absent', {}],
    ['null', { locale: null }],
    ['empty string', { locale: '' }],
  ])('leaves %s alone — an unset column is how the deployment default applies', (_why, data) => {
    // The ruling keeps the deployment default as the fallback for an unset
    // column, so CLEARING the field has to remain legal. A shape rule that
    // also enforced presence would take that away and turn "use the server
    // default" into an unreachable state.
    expect(refusal(data as Record<string, unknown>, 'insert')).toBeNull();
    expect(refusal(data as Record<string, unknown>, 'update')).toBeNull();
  });

  it('the rule that refuses is the one the column declares — not the length bound', () => {
    // `maxLength: 35` is enforced by `validateRecord`, a different check in a
    // different module. A 35-character malformed value proves the refusal
    // above comes from the shape rule rather than from the length bound
    // happening to catch the same inputs.
    const malformedButShort = 'not a tag';
    expect(malformedButShort.length).toBeLessThan(localeField.maxLength);
    expect(refusal({ locale: malformedButShort }, 'update')).toBeTruthy();
  });
});

describe('sys_user.locale — the guard and the shape check compose', () => {
  /** Fake engine capturing hook registrations (same shape the real engine builds). */
  function makeEngine() {
    const handlers: Record<string, Array<(ctx: any) => Promise<void>>> = {};
    return {
      handlers,
      getSchema: () => ({ name: 'sys_user', managedBy: 'better-auth' }),
      registerHook: (event: string, handler: (ctx: any) => Promise<void>) => {
        (handlers[event] ??= []).push(handler);
      },
    };
  }

  const USER_SESSION = { userId: 'usr_1', positions: [] };

  function guardedUpdate(data: Record<string, unknown>) {
    const engine = makeEngine();
    registerManagedUpdateWhitelist('sys_user', SYS_USER_PROFILE_EDIT_FIELDS);
    registerIdentityWriteGuard(engine as any, { packageId: 'test.locale-write-contract' });
    return engine.handlers.beforeUpdate[0]({
      object: 'sys_user',
      session: USER_SESSION,
      input: { id: 'u1', data },
    });
  }

  it('a well-formed self-service locale edit passes the guard AND the shape check', async () => {
    const data: Record<string, unknown> = { id: 'u1', locale: 'ja-JP' };
    await guardedUpdate(data);
    expect(data).toEqual({ id: 'u1', locale: 'ja-JP' });
    expect(refusal(data, 'update')).toBeNull();
  });

  it('a malformed locale clears the guard and is then refused by the column', async () => {
    // The two layers answer different questions and the order matters: the
    // guard asks "may this caller write this COLUMN" and says yes, so the
    // shape check is the only thing between a user's typo and a stored value
    // that would silently fall back to the deployment default forever.
    const data: Record<string, unknown> = { id: 'u1', locale: 'Japanese' };
    await guardedUpdate(data);
    expect(data, 'the guard must not strip a whitelisted column').toEqual({ id: 'u1', locale: 'Japanese' });
    expect(refusal(data, 'update')).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
