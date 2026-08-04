// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4001 批 19 — `ui/app.zod.ts`'s last strip site, measured.
 *
 * The file has ONE site left: `BaseNavItemSchema`. The ledger carried it as
 * `verify` — held pending a check, not scheduled work — with this instruction:
 *
 *   > `BaseNavItemSchema` — the base the strict discriminated-union members
 *   > extend. Closing a base that is `.extend()`ed is the #4001 trap that bit
 *   > `view` (finding 16); confirm the members' strictness is not already
 *   > covering it before touching.
 *
 * ## The check came back NEGATIVE, and the premise was wrong twice over
 *
 * 1. **The members do not `.extend()` the base — they spread `...Base.shape`.**
 *    That is a materially different mechanism. `.extend()` produces a clone
 *    that INHERITS the base's unknown-key posture, which is exactly what made
 *    finding 16 dangerous on `view` (closing two authoring schemas silently
 *    closed the Studio round-trip overlay and turned a shape the platform
 *    itself writes into a 422). A `...shape` spread copies the per-key schemas
 *    into a FRESH `z.object`, and posture is a property of that new object, not
 *    of the record of keys it was built from. So the base's posture is not
 *    inherited by anything, in either direction.
 *
 * 2. **The members' own strictness already covers every key the base
 *    contributes.** All nine branches apply their own `.strict()` with a
 *    curated `navItemUnknownKeyError`, so there is no surface the base's
 *    posture could protect that is not already protected.
 *
 * Together those make closing this site a guaranteed no-op — and #4583 is
 * explicit that a no-op closure is not neutral: *"a precisely-validated dead
 * slot is the more convincing lie"*. The base is also module-private and is
 * never parsed; `.strict()` is a property of a PARSE.
 *
 * So 批 19 changes no posture. This file is what makes that a VERDICT rather
 * than an omission — the third place it is recorded, beside the schema comment
 * and the `ui/` ledger row. If a future member is ever written as
 * `BaseNavItemSchema.extend({...})` WITHOUT its own `.strict()`, the last test
 * here is the one that should start failing.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  ObjectNavItemSchema,
  DashboardNavItemSchema,
  PageNavItemSchema,
  UrlNavItemSchema,
  ReportNavItemSchema,
  ActionNavItemSchema,
  ComponentNavItemSchema,
  GroupNavItemSchema,
  AppSchema,
} from './app.zod';

/**
 * Every key `BaseNavItemSchema` contributes, with a legal value.
 *
 * Transcribed deliberately: the point of the positive control is to prove the
 * spread DELIVERS these to each member, so reading them back off the member's
 * own shape would assert nothing.
 */
const BASE_KEYS = {
  id: 'nav_probe',
  label: 'Probe',
  icon: 'circle',
  order: 3,
  badge: 'New',
  badgeVariant: 'secondary',
  visible: "'admin' in current_user.positions",
  requiredPermissions: ['read_probe'],
  requiresObject: 'sys_app',
  requiresService: 'tenant',
} as const;

/** The eight exported branches, each with the payload its own `type` requires. */
const MEMBERS: Array<[string, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, Record<string, unknown>]> = [
  ['object', ObjectNavItemSchema, { type: 'object', objectName: 'crm_lead' }],
  ['dashboard', DashboardNavItemSchema, { type: 'dashboard', dashboardName: 'sales' }],
  ['page', PageNavItemSchema, { type: 'page', pageName: 'home' }],
  ['url', UrlNavItemSchema, { type: 'url', url: 'https://example.com' }],
  ['report', ReportNavItemSchema, { type: 'report', reportName: 'pipeline' }],
  ['action', ActionNavItemSchema, { type: 'action', actionDef: { actionName: 'run_it' } }],
  ['component', ComponentNavItemSchema, { type: 'component', componentRef: 'metadata:resource' }],
  ['group', GroupNavItemSchema, { type: 'group' }],
];

describe('#4001 批 19 — the `verify` check on `BaseNavItemSchema`', () => {
  describe('POSITIVE control — the spread really does deliver the base keys', () => {
    it.each(MEMBERS)('the `%s` branch accepts every key the base contributes', (_name, schema, payload) => {
      const r = schema.safeParse({ ...BASE_KEYS, ...payload });
      expect(r.success, JSON.stringify((r.error as { issues?: unknown })?.issues ?? '')).toBe(true);
    });
  });

  describe('NEGATIVE control — the members\' own strictness already covers that surface', () => {
    it.each(MEMBERS)('the `%s` branch rejects an undeclared key, with the curated nav error', (_name, schema, payload) => {
      const r = schema.safeParse({ ...BASE_KEYS, ...payload, notANavKey: 1 });
      expect(r.success).toBe(false);
      const issues = JSON.stringify((r.error as { issues?: unknown })?.issues ?? []);
      expect(issues).toContain('notANavKey');
      // The curation is the members', not the base's — more evidence that the
      // base's posture has no job here.
      expect(issues).toContain('navigation item');
    });
  });

  it('the base contributes a key that is NOT declared by any member individually — so the spread is load-bearing', () => {
    // `requiresService` exists only on the base. If the spread were not
    // delivering it, the positive control above would pass vacuously on
    // members that happened to declare the same key themselves.
    const r = DashboardNavItemSchema.safeParse({
      id: 'nav_x', label: 'X', type: 'dashboard', dashboardName: 'd', requiresService: 'tenant',
    });
    expect(r.success).toBe(true);
  });

  it('reaches the same verdict through the real door — `AppSchema.navigation`, not just standalone members', () => {
    // `.strict()` is a property of a PARSE, so the door is asserted rather
    // than inferred. `navigation` is a `discriminatedUnion` on `type`, so the
    // rejection lands on the branch actually written.
    const app = { name: 'probe_app', label: 'Probe' };
    expect(AppSchema.safeParse({
      ...app,
      navigation: [{ ...BASE_KEYS, type: 'dashboard', dashboardName: 'd' }],
    }).success).toBe(true);

    const r = AppSchema.safeParse({
      ...app,
      navigation: [{ ...BASE_KEYS, type: 'dashboard', dashboardName: 'd', notANavKey: 1 }],
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify((r.error as { issues?: unknown })?.issues ?? [])).toContain('notANavKey');
  });

  it('THE MECHANISM — a `...shape` spread does not carry the source object\'s posture, in either direction', () => {
    // This is the whole of 批 19's finding, isolated from `app.zod.ts` so it
    // cannot be read as an accident of that file. Finding 16's trap is real,
    // and it is a property of `.extend()`, NOT of `.shape`.
    const openBase = z.object({ a: z.string() });
    const strictBase = z.object({ a: z.string() }).strict();

    // `.extend()` INHERITS — this is the finding-16 mechanism.
    expect(strictBase.extend({ b: z.string().optional() }).safeParse({ a: 'x', zzz: 1 }).success).toBe(false);
    expect(openBase.extend({ b: z.string().optional() }).safeParse({ a: 'x', zzz: 1 }).success).toBe(true);

    // `...shape` does NOT — the new object's posture is its own, whatever the
    // source's was. Both directions, because "closing the base closes the
    // members" and "closing the base is a no-op" are opposite claims and only
    // one of them can be true.
    expect(z.object({ ...strictBase.shape, b: z.string().optional() }).safeParse({ a: 'x', zzz: 1 }).success).toBe(true);
    expect(z.object({ ...openBase.shape, b: z.string().optional() }).strict().safeParse({ a: 'x', zzz: 1 }).success).toBe(false);
  });

  it('every member applies its OWN `.strict()` — the invariant that makes the base\'s posture irrelevant', () => {
    // The guard for the future. If someone adds a tenth branch as
    // `BaseNavItemSchema.extend({...})` without `.strict()`, or drops a
    // `.strict()` from an existing one, the base stops being a no-op and this
    // batch's verdict has to be re-taken. That is what this asserts — not the
    // spelling in the source, but the behaviour the spelling is there for.
    for (const [name, schema, payload] of MEMBERS) {
      expect(
        schema.safeParse({ ...BASE_KEYS, ...payload, aKeyNoBranchDeclares: 1 }).success,
        `the \`${name}\` branch stopped rejecting unknown keys — re-take the 批 19 verdict`,
      ).toBe(false);
    }
  });
});
