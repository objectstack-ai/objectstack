// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8074] The arming guard is SHOWN TO FIRE — in both directions, on real boots.
//
// This file exists because of what it guards. `assertArmed` is a mechanism for
// catching assertions that cannot fail; a version of it that could not itself
// fail would be the defect wearing the fix's clothes, and it would be invisible
// in exactly the same way (green, quiet, reported as tested).
//
// So every probe is measured twice, and the disarmed halves are not synthetic:
//
//   principalArmed    DISARMED on an org-LESS boot — a live reproduction of
//                     #8023, where a fresh sign-up holds `['everyone']` and the
//                     `org_member`-gated write floor never applies
//                     ARMED on `bootStack(..., { orgContext: true })`
//   authSettingArmed  DISARMED on the default auth config — a live reproduction
//                     of #8049, where `passwordHistoryCount` is 0/undefined and
//                     the reuse control has nothing to reject against
//                     ARMED after the `applyConfigPatch` the fixture uses
//   seededArmed       DISARMED on a permission set that does not exist
//                     ARMED on `member_default`, which does
//   armedWhen         DISARMED / ARMED on both sides of its own predicate
//
// The `member_default` case is not decoration: it is the control that proves
// the seeded-row probe CAN find something, so its negative reading is a real
// negative rather than a probe that never matches anything.
//
// Two positive controls guard the "it throws" cases from the cheapest possible
// fake — an `assertArmed` that always threw would satisfy every rejection
// assertion here, so an all-armed declaration is asserted to RESOLVE.
//
// Boots two stacks, uses custom boot options and mutates auth config, so it
// stays out of `SHARED_SHOWCASE` (see `vitest.config.ts`).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import {
  assertArmed,
  armedWhen,
  authSettingArmed,
  principalArmed,
  resolveAuthzFor,
  seededArmed,
  type ArmingProbe,
} from './armed.js';

/** The control #8023's fixture measures, named the way that card names it. */
const WRITE_FLOOR = 'the wildcard row-level write floor (`owner_only_writes`)';
const WRITE_FLOOR_DISARM =
  'an org-less boot: no organization ⇒ no `sys_member` row ⇒ the principal never holds ' +
  '`org_member` ⇒ the positions-gated floor never applies. Boot with `orgContext: true`.';

/** The control #8049's fixture measures. */
const REUSE_CONTROL = "ADR-0069 D1's password-reuse rejection";
const REUSE_DISARM =
  '`passwordHistoryCount` defaults to 0 (off): no history is recorded, so a reuse assertion ' +
  'has nothing to reject against. Arm it through `applyConfigPatch`.';

describe('[#8074] assertArmed: the guard against assertions that cannot fail', () => {
  /** The org-LESS stack — #8023's and #8049's disarmed shapes, booted for real. */
  let orgless: VerifyStack;
  /** The org-BOUND stack — the same probe, armed. */
  let orgbound: VerifyStack;

  let orglessMember: string;
  let orgboundMember: string;

  beforeAll(async () => {
    orgless = await bootStack(showcaseStack, {});
    orgbound = await bootStack(showcaseStack, { orgContext: true });

    // The first user is the seeded dev admin; a fresh sign-up is the plain
    // member #8023's fixture measures.
    await orgless.signIn();
    await orgbound.signIn();
    orglessMember = await orgless.signUp('armed-orgless@verify.test');
    orgboundMember = await orgbound.signUp('armed-orgbound@verify.test');
  }, 300_000);

  afterAll(async () => {
    await orgless?.stop?.();
    await orgbound?.stop?.();
  });

  // ── the fixture's own integrity ───────────────────────────────────────────
  //
  // Every reading below is worthless if the two stacks are not actually the two
  // shapes they are named for, so that is asserted before anything is measured.

  it('[integrity] the two stacks really are the org-less and org-bound shapes', async () => {
    const less = await resolveAuthzFor(orgless, orglessMember);
    const bound = await resolveAuthzFor(orgbound, orgboundMember);
    expect(less.userId, 'the org-less member resolved as a real principal').toBeTruthy();
    expect(bound.userId, 'the org-bound member resolved as a real principal').toBeTruthy();
    expect(less.positions, 'org-less: a fresh sign-up holds only the everyone anchor')
      .not.toContain('org_member');
    expect(bound.positions, 'org-bound: the membership reconciler bound the sign-up')
      .toContain('org_member');
  });

  // ── principalArmed — instance 1, both directions ──────────────────────────

  describe('principalArmed reproduces #8023 and reports it', () => {
    const probeOn = (stack: VerifyStack, token: string): ArmingProbe =>
      principalArmed({
        stack,
        token,
        who: 'the plain member',
        positions: ['org_member'],
        control: WRITE_FLOOR,
        disarmedBy: WRITE_FLOOR_DISARM,
      });

    it('reports DISARMED on an org-less boot, and names what it saw', async () => {
      const verdict = await probeOn(orgless, orglessMember).read();
      expect(verdict.armed, 'org-less: the floor is outside this principal’s domain').toBe(false);
      expect(verdict.observed).toContain('missing positions');
      expect(verdict.observed).toContain('org_member');
    });

    it('reports ARMED on `orgContext: true` — the same probe, the other direction', async () => {
      const verdict = await probeOn(orgbound, orgboundMember).read();
      expect(verdict.armed, 'org-bound: the principal is inside the floor’s domain').toBe(true);
      expect(verdict.observed).toContain('org_member');
    });

    it('assertArmed REJECTS the disarmed stack, naming the control and the default', async () => {
      await expect(assertArmed([probeOn(orgless, orglessMember)])).rejects.toThrow(
        /this fixture is DISARMED/,
      );
      const err = await assertArmed([probeOn(orgless, orglessMember)]).catch((e: Error) => e);
      expect(String(err)).toContain(WRITE_FLOOR);
      // The remedy, not just the symptom — the sentence the next author needs.
      expect(String(err)).toContain('orgContext: true');
    });

    it('[positive control] assertArmed RESOLVES on the armed stack', async () => {
      // Without this, every rejection assertion above would be satisfied by an
      // `assertArmed` that simply always threw.
      await expect(assertArmed([probeOn(orgbound, orgboundMember)])).resolves.toBeUndefined();
    });

    it('a principal that resolves to nothing is DISARMED, not skipped', async () => {
      const verdict = await principalArmed({
        stack: orgbound,
        token: 'not-a-token-8074',
        who: 'a bogus credential',
        positions: ['org_member'],
        control: WRITE_FLOOR,
        disarmedBy: WRITE_FLOOR_DISARM,
      }).read();
      expect(verdict.armed).toBe(false);
      expect(verdict.observed).toContain('missing positions');
    });
  });

  // ── authSettingArmed — instance 2, both directions ────────────────────────

  describe('authSettingArmed reproduces #8049 and reports it', () => {
    const probe = (stack: VerifyStack): ArmingProbe =>
      authSettingArmed({
        stack,
        setting: 'passwordHistoryCount',
        armed: (v) => Number(v) >= 1,
        control: REUSE_CONTROL,
        disarmedBy: REUSE_DISARM,
      });

    it('reads DISARMED by default and ARMED after the patch the fixture uses', async () => {
      // Read the default FIRST, then arm, then restore — so this case is
      // atomic and cannot depend on the order vitest runs the file in.
      const before = await probe(orgless).read();
      expect(before.armed, 'the platform default leaves the reuse control off').toBe(false);
      expect(before.observed).toContain('passwordHistoryCount=');

      const auth = await orgless.kernel.getServiceAsync<any>('auth');
      try {
        auth.applyConfigPatch({ passwordHistoryCount: 3 });
        const after = await probe(orgless).read();
        expect(after.armed, 'the same seam the settings service writes arms it').toBe(true);
        expect(after.observed).toContain('passwordHistoryCount=3');
        await expect(assertArmed([probe(orgless)])).resolves.toBeUndefined();
      } finally {
        auth.applyConfigPatch({ passwordHistoryCount: undefined });
      }

      const restored = await probe(orgless).read();
      expect(restored.armed, 'and the restore really disarmed it again').toBe(false);
    });

    it('assertArmed REJECTS the default config, naming the 0 default', async () => {
      const err = await assertArmed([probe(orgless)]).catch((e: Error) => e);
      expect(String(err)).toContain(REUSE_CONTROL);
      expect(String(err)).toContain('defaults to 0');
    });

    it('a stack with no readable auth config is DISARMED whatever the predicate says', async () => {
      // A predicate that would call `undefined` armed must not be able to turn
      // "the service is gone" into a pass.
      const verdict = await authSettingArmed({
        stack: { kernel: { getServiceAsync: async () => undefined } } as unknown as VerifyStack,
        setting: 'passwordHistoryCount',
        armed: (v) => v === undefined,
        control: REUSE_CONTROL,
        disarmedBy: REUSE_DISARM,
      }).read();
      expect(verdict.armed).toBe(false);
      expect(verdict.observed).toContain("no 'auth' service resolved");
    });
  });

  // ── seededArmed — the row a control rides on ──────────────────────────────

  describe('seededArmed', () => {
    it('[control] finds a set that really seeded — so its negative reading is a real negative', async () => {
      const verdict = await seededArmed({
        stack: orgless,
        object: 'sys_permission_set',
        where: { name: 'member_default' },
        control: 'the platform baseline permission set',
        disarmedBy: 'a permission set that failed to seed grants the principal nothing',
      }).read();
      expect(verdict.armed).toBe(true);
      expect(verdict.observed).toContain('is seeded');
    });

    it('reports DISARMED for a set that does not exist', async () => {
      const verdict = await seededArmed({
        stack: orgless,
        object: 'sys_permission_set',
        where: { name: 'no_such_set_8074' },
        control: 'an app-declared permission set',
        disarmedBy: 'a set that failed to seed grants the principal nothing',
      }).read();
      expect(verdict.armed).toBe(false);
      expect(verdict.observed).toContain('never seeded');
    });

    it('reports DISARMED when the row exists but fails its own predicate', async () => {
      const verdict = await seededArmed({
        stack: orgless,
        object: 'sys_permission_set',
        where: { name: 'member_default' },
        armed: () => false,
        control: 'a seeded row that must also carry something',
        disarmedBy: 'the row seeded but not the part the control rides on',
      }).read();
      expect(verdict.armed).toBe(false);
      expect(verdict.observed).toContain('fails its own arming predicate');
    });
  });

  // ── armedWhen — the general probe, both directions ────────────────────────

  describe('armedWhen', () => {
    const generic = (armed: (v: number) => boolean) =>
      armedWhen<number>({
        control: 'a generic control',
        disarmedBy: 'a generic default',
        observe: () => 7,
        armed,
        describe: (v) => `observed ${v}`,
      });

    it('is ARMED when its predicate holds and DISARMED when it does not', async () => {
      expect((await generic((v) => v === 7).read()).armed).toBe(true);
      expect((await generic((v) => v === 8).read()).armed).toBe(false);
    });

    it('treats a non-boolean predicate result as DISARMED', async () => {
      // "not proven armed" is the safe direction for an ambiguous reading.
      const sloppy = armedWhen<number>({
        control: 'a control judged by a truthy non-boolean',
        disarmedBy: 'a predicate that does not return a real boolean',
        observe: () => 7,
        armed: ((v: number) => v) as unknown as (v: number) => boolean,
      });
      expect((await sloppy.read()).armed).toBe(false);
    });
  });

  // ── the guard's own vacuity refusals ──────────────────────────────────────

  describe('the guard refuses its own vacuous spellings', () => {
    it('assertArmed([]) throws — an empty declaration would certify everything', async () => {
      await expect(assertArmed([])).rejects.toThrow(/arming declaration is EMPTY/);
    });

    it('principalArmed with nothing required throws at CONSTRUCTION', () => {
      expect(() =>
        principalArmed({
          stack: orgless,
          token: orglessMember,
          who: 'nobody in particular',
          control: WRITE_FLOOR,
          disarmedBy: WRITE_FLOOR_DISARM,
        }),
      ).toThrow(/can never fail/);
    });

    it('seededArmed with an empty `where` throws at CONSTRUCTION', () => {
      expect(() =>
        seededArmed({
          stack: orgless,
          object: 'sys_permission_set',
          where: {},
          control: 'anything',
          disarmedBy: 'anything',
        }),
      ).toThrow(/matches any row/);
    });

    it('a probe whose read THROWS counts as disarmed, never as fine', async () => {
      const broken: ArmingProbe = {
        control: 'a control whose probe cannot read the stack',
        disarmedBy: 'an unreadable precondition',
        read: async () => {
          throw new Error('the service went away');
        },
      };
      const err = await assertArmed([broken]).catch((e: Error) => e);
      expect(String(err)).toContain('the arming probe itself threw');
      expect(String(err)).toContain('the service went away');
    });

    it('names EVERY disarmed control, not just the first', async () => {
      const err = await assertArmed([
        principalArmed({
          stack: orgless,
          token: orglessMember,
          who: 'the plain member',
          positions: ['org_member'],
          control: WRITE_FLOOR,
          disarmedBy: WRITE_FLOOR_DISARM,
        }),
        authSettingArmed({
          stack: orgless,
          setting: 'passwordHistoryCount',
          armed: (v) => Number(v) >= 1,
          control: REUSE_CONTROL,
          disarmedBy: REUSE_DISARM,
        }),
      ]).catch((e: Error) => e);
      expect(String(err)).toContain(WRITE_FLOOR);
      expect(String(err)).toContain(REUSE_CONTROL);
      expect(String(err)).toContain('2 of 2 control(s)');
    });

    it('[positive control] a fully armed multi-probe declaration RESOLVES', async () => {
      // The counterweight to every rejection case above.
      await expect(
        assertArmed([
          principalArmed({
            stack: orgbound,
            token: orgboundMember,
            who: 'the org-bound member',
            positions: ['org_member'],
            control: WRITE_FLOOR,
            disarmedBy: WRITE_FLOOR_DISARM,
          }),
          seededArmed({
            stack: orgbound,
            object: 'sys_permission_set',
            where: { name: 'member_default' },
            control: 'the platform baseline permission set',
            disarmedBy: 'a set that failed to seed grants the principal nothing',
          }),
        ]),
      ).resolves.toBeUndefined();
    });
  });
});
