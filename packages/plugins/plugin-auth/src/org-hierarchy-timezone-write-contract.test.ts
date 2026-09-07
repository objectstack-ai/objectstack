// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write contract for `sys_business_unit.timezone` and
 * `sys_organization.timezone` (#14238 — maintainer ruling 2026-09-02, option A,
 * verbatim 「同意」).
 *
 * The ruling's own precondition was that the two columns are not shipped
 * unvalidated: 「if #14168 lands first, both columns declare
 * `valueDomain: 'iana_time_zone'`; if not, the engine seat sequences this card
 * behind it rather than shipping an unvalidated text column」. A declaration
 * that nothing runs is the shape ADR-0078 keeps out, so this file does not
 * assert that the key is DECLARED (platform-objects'
 * `org-hierarchy-timezone.test.ts` does that) — it drives the evaluator that
 * reads it, `validateRecord`, over the two real object definitions.
 *
 * ## Why the pin spans two packages
 *
 * For `sys_organization` the column is reachable only through three edits that
 * only work together, each invisible from where the others live:
 *
 *  1. the column declares the domain (platform-objects) — without it a write
 *     of `Mars/Olympus` is stored;
 *  2. objectql's record validator reads the key (#15161) — without it the
 *     declaration constrains nothing;
 *  3. plugin-auth's identity write guard (ADR-0092 D2) admits `timezone` on
 *     `sys_organization` — without it the guard STRIPS the key on every
 *     user-context write and the root default is a value nobody can set.
 *
 * plugin-auth is the one package that already depends on both
 * `@objectstack/platform-objects` (the columns) and `@objectstack/objectql`
 * (the evaluator), and it owns the guard — so the three are held here at once.
 * `sys_business_unit` is `managedBy: 'platform'`: the guard never judges it,
 * which is why it has no whitelist entry, and this file says so out loud
 * rather than leaving the asymmetry to be read as an omission.
 */

import { describe, it, expect } from 'vitest';
import { SysBusinessUnit, SysOrganization } from '@objectstack/platform-objects/identity';
import { validateRecord } from '@objectstack/objectql';
import {
  registerIdentityWriteGuard,
  registerManagedUpdateWhitelist,
} from './identity-write-guard.js';
import {
  managedExtensionEditableFields,
  managedExtensionFields,
} from './managed-extension-fields.js';

type Mode = 'insert' | 'update';

/**
 * The minimal legal INSERT payload per object, so an insert-mode refusal below
 * is the timezone's and not a `required` refusal on some other column.
 */
const INSERT_BASE: Record<string, Record<string, unknown>> = {
  sys_business_unit: { name: 'EMEA Sales', kind: 'division' },
  sys_organization: { name: 'Acme' },
};

const OBJECTS = [
  ['sys_business_unit', SysBusinessUnit],
  ['sys_organization', SysOrganization],
] as const;

/** Run the record validator over a payload; returns the thrown error, or null. */
function refusal(schema: unknown, data: Record<string, unknown>, mode: Mode): any {
  try {
    validateRecord(schema as never, data, mode);
    return null;
  } catch (e) {
    return e;
  }
}

/** A payload carrying `timezone`, legal for `mode` on `object` apart from that value. */
function payload(object: string, mode: Mode, timezone: unknown): Record<string, unknown> {
  return mode === 'insert' ? { ...INSERT_BASE[object], timezone } : { timezone };
}

describe.each(OBJECTS)('%s.timezone — a non-member is refused on the write path (ADR-0114 `value_domain`)', (object, schema) => {
  it('the base payloads are legal on their own (control — a refusal below is the timezone\'s)', () => {
    expect(refusal(schema, INSERT_BASE[object], 'insert')).toBeNull();
    expect(refusal(schema, {}, 'update')).toBeNull();
  });

  it.each([
    ['a shape-valid zone that does not exist', 'Mars/Olympus'],
    ['a plausible city that is not a tzdb zone', 'Europe/Munich'],
    ['an offset spelling, not an identifier', 'UTC+8'],
    ['a display name, not an identifier', 'China Standard Time'],
  ])('refuses %s on insert and on update', (_why, value) => {
    for (const mode of ['insert', 'update'] as const) {
      const err = refusal(schema, payload(object, mode, value), mode);
      expect(err, `${value} was accepted on ${object} ${mode}`).toBeTruthy();
      // ADR-0112 envelope. `status` is not carried on the error object: the
      // REST boundary derives it, and `mapDataError` in `@objectstack/rest`
      // keys the 400 on EXACTLY the two discriminators asserted here
      // (`error.code === 'VALIDATION_FAILED' || error.name === 'ValidationError'`),
      // so pinning both is what pins the status.
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.name).toBe('ValidationError');
      // The per-field half — the ADR-0114 catalog member, with the constraint
      // a client acts on. `constraint.valueDomain` names the domain rather than
      // an options list: the domain has no enumeration to hand back.
      expect(err.fields).toEqual([
        expect.objectContaining({
          field: 'timezone',
          code: 'value_domain',
          constraint: { valueDomain: 'iana_time_zone' },
        }),
      ]);
    }
  });

  it('the refusal is the domain\'s, not the length bound\'s', () => {
    // `maxLength: 64` is a different check in the same validator. Every
    // non-member above is far shorter than the bound, and this one is the
    // shortest of all — so the refusal comes from membership, not from length
    // happening to catch the same inputs.
    const shortNonMember = 'Mars/Olympus';
    expect(shortNonMember.length).toBeLessThan((schema.fields as any).timezone.maxLength);
    expect(refusal(schema, payload(object, 'update', shortNonMember), 'update')).toBeTruthy();
  });
});

describe.each(OBJECTS)('%s.timezone — members are admitted, and `UTC` above all', (object, schema) => {
  it.each([
    // ⭐ The single most valuable case in the round: `UTC` is the fallback the
    // contract names for a wholly unset chain, and `Intl.supportedValuesOf`
    // OMITS it — a column judged against that enumeration would refuse the
    // platform's own default. The shared predicate is the `Intl.DateTimeFormat`
    // probe; this proves the column inherits the probe, not the list.
    ['the contract\'s own fallback', 'UTC'],
    ['the Etc/ spelling of the same zone', 'Etc/UTC'],
    ['a canonical zone', 'Asia/Shanghai'],
    ['a zone the enumeration spells differently (Asia/Calcutta)', 'Asia/Kolkata'],
    // 32 characters — the longest identifier in the tzdb, a backward link the
    // enumeration omits; admitted by the probe and inside the 64 bound.
    ['the longest tzdb identifier, a link the enumeration omits', 'America/Argentina/ComodRivadavia'],
  ])('accepts %s on insert and on update', (_why, value) => {
    expect(refusal(schema, payload(object, 'insert', value), 'insert')).toBeNull();
    expect(refusal(schema, payload(object, 'update', value), 'update')).toBeNull();
  });

  it.each([
    ['absent', {}],
    ['null', { timezone: null }],
  ])('leaves %s alone — an unset column is how inheritance (and the UTC root) applies', (_why, data) => {
    // Nullable is the ruling's word. On the unit, unset means "inherit"; on the
    // organization, unset means UTC. A domain check that also enforced
    // presence would make both states unreachable, and CLEARING a zone (back
    // to inheriting) has to stay a legal update.
    expect(refusal(schema, { ...INSERT_BASE[object], ...data }, 'insert')).toBeNull();
    expect(refusal(schema, data as Record<string, unknown>, 'update')).toBeNull();
  });
});

describe('sys_organization.timezone — the identity write guard admits it, and the column still judges it', () => {
  /** Fake engine capturing hook registrations (same shape the real engine builds). */
  function makeEngine(object: string, managedBy: string) {
    const handlers: Record<string, Array<(ctx: any) => Promise<void>>> = {};
    return {
      handlers,
      getSchema: () => ({ name: object, managedBy }),
      registerHook: (event: string, handler: (ctx: any) => Promise<void>) => {
        (handlers[event] ??= []).push(handler);
      },
    };
  }

  const USER_SESSION = { userId: 'usr_1', positions: [] };

  function guardedOrganizationUpdate(data: Record<string, unknown>) {
    const engine = makeEngine('sys_organization', 'better-auth');
    // The whitelist the plugin registers at `kernel:ready` is this map's row —
    // registered here from the SAME constant, so the pin reads what ships.
    registerManagedUpdateWhitelist('sys_organization', managedExtensionEditableFields('sys_organization'));
    registerIdentityWriteGuard(engine as any, { packageId: 'test.org-hierarchy-timezone-write-contract' });
    return engine.handlers.beforeUpdate[0]({
      object: 'sys_organization',
      session: USER_SESSION,
      input: { id: 'org_1', data },
    });
  }

  it('is a declared extension field AND generically editable (ADR-0105 D7 / ADR-0092 D2)', () => {
    expect(managedExtensionFields('sys_organization')).toContain('timezone');
    expect(managedExtensionEditableFields('sys_organization')).toContain('timezone');
  });

  it('a user-context edit of the root default passes the guard un-stripped and is then admitted by the column', async () => {
    const data: Record<string, unknown> = { id: 'org_1', timezone: 'Asia/Shanghai' };
    await guardedOrganizationUpdate(data);
    expect(data, 'the guard must not strip a whitelisted column').toEqual({ id: 'org_1', timezone: 'Asia/Shanghai' });
    expect(refusal(SysOrganization, data, 'update')).toBeNull();
  });

  it('a non-member clears the guard and is then refused by the column — the two layers answer different questions', async () => {
    // The guard asks "may this caller write this COLUMN" and says yes; the
    // domain check is the only thing between an administrator's typo and a
    // stored root default no reader could ever resolve.
    const data: Record<string, unknown> = { id: 'org_1', timezone: 'Mars/Olympus' };
    await guardedOrganizationUpdate(data);
    expect(data, 'the guard must not strip a whitelisted column').toEqual({ id: 'org_1', timezone: 'Mars/Olympus' });
    expect(refusal(SysOrganization, data, 'update')).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('the guard really ran: a protocol field in the same payload is stripped (control)', async () => {
    // Without this, the two pins above would also pass against a guard that
    // never registered. `slug` is better-auth's own column, never whitelisted.
    const data: Record<string, unknown> = { id: 'org_1', slug: 'acme-2', timezone: 'UTC' };
    await guardedOrganizationUpdate(data);
    expect(data).toEqual({ id: 'org_1', timezone: 'UTC' });
  });

  it('sys_business_unit is managedBy platform — the guard never judges it, so it needs no whitelist entry', () => {
    // Not an omission: the D2 guard reads `managedBy` from the schema registry
    // and only judges `'better-auth'`. A reader copying the organization's
    // registration onto the unit would be adding a whitelist to a table the
    // guard never consults.
    expect(SysBusinessUnit.managedBy).toBe('platform');
    expect(SysOrganization.managedBy).toBe('better-auth');
    expect(managedExtensionFields('sys_business_unit').size).toBe(0);
  });
});
