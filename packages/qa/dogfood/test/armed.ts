// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8074] `assertArmed` — a fixture proves the control it measures is ENGAGED
// before it measures anything.
//
// ── the defect class ──────────────────────────────────────────────────────
//
// Three independent instances landed in one shift, each with a DIFFERENT
// mechanism, and the common factor is not "someone wrote a careless test" —
// it is that a PLATFORM DEFAULT turned the assertion into a tautology while
// the harness kept reporting success:
//
//   #8023  the harness booted with no organization, so the principal never
//          held `org_member`, so the positions-gated wildcard write floor
//          never applied. The first fixture PASSED against the very build
//          whose defect the card had already reproduced over HTTP.
//   #8049  `passwordHistoryCount` defaults to 0 (off), so no history is
//          recorded, so "a reused password is refused" had nothing to reject
//          against and would have certified a control never exercised.
//   #7809  the package tsconfig excludes the test layer, so a type-level pin
//          was never evaluated by anything the author ran.
//
// None was caught by reading the test. All three were caught by a developer
// deliberately trying to make their own assertion fail.
//
// ── what this module does, stated narrowly ────────────────────────────────
//
// It makes the silent precondition an EXPLICIT, MACHINE-CHECKED declaration
// read off the live booted stack: the fixture names the control it is about
// to measure and the default that would disarm it, and the harness refuses to
// proceed unless the control is observably engaged.
//
// ⛔ It reaches instances 1 and 2 — RUNTIME disarms, observable from inside a
// booted stack. It does NOT reach instance 3, and is deliberately built so it
// cannot read as though it does. That gap is reasoned, not overlooked:
//
//   - #7809's assertion was evaluated by `tsc`, not by vitest, and what
//     disarmed it lived in `tsconfig.json`. No runtime probe against a booted
//     stack can observe an assertion that the runtime never sees.
//   - the coverage half of that question is already owned repo-wide by
//     `scripts/check-type-check-coverage.mjs` (its TEST_DEBT ledger lifts a
//     package's test-layer exclusion, compiles it, and ratchets the count);
//     rebuilding a package-local copy here would be duplicate machinery, not
//     new coverage.
//   - the remaining SIGNAL hole in that gate — `PINS_CHECKED` recognising
//     only `@ts-expect-error`, so an assignability-const pin in a hidden test
//     layer is invisible to the mechanism whose job is to notice phantom pins
//     — is filed as #8113 and is not this module's to close.
//   - measured for this package rather than assumed: `@objectstack/dogfood`
//     appears in neither the DEBT nor the TEST_DEBT ledger, its tsconfig
//     `include` is `["src/**/*", "test/**/*"]` with no test-shaped `exclude`,
//     and it declares the `typecheck` script the turbo graph runs. Instance
//     3's mechanism is absent from the surface this module covers.
//
// ── three design decisions, each load-bearing ─────────────────────────────
//
// 1. CALL IT FROM `beforeAll`, NOT FROM AN `it()`.
//    A disarmed fixture must produce ZERO green cells. The hand-rolled
//    `[integrity]` idiom this module generalises (`owd-public-read-write-
//    write-floor`, `authored-row-write-scope`, `bulk-widener-probe`) is an
//    ordinary case, so a disarm reddens ONE cell and every sibling assertion
//    still prints green — and #8023's harm was precisely a green cell in a
//    124-cell matrix re-drive. Throwing from `beforeAll` fails the file.
//
// 2. AN UNREADABLE PROBE COUNTS AS DISARMED.
//    A probe whose read throws returns "not proven armed", never "fine". The
//    opposite default reproduces the defect class one level up: a guard that
//    passes when it cannot see is a guard that passes.
//
// 3. AN EMPTY DECLARATION IS REFUSED, AND SO IS A PROBE THAT CANNOT FAIL.
//    `assertArmed([])` throws; `principalArmed` with nothing to require and
//    `seededArmed` with an empty `where` throw at construction. An
//    "assert the control is armed" helper that is itself vacuous is this
//    card's own defect wearing the fix's clothes, so the vacuous spellings
//    are unavailable rather than discouraged.
//
// Every probe below is shown to fire IN BOTH DIRECTIONS against real boots in
// `armed.dogfood.test.ts` — including live reproductions of #8023's org-less
// disarm and #8049's `passwordHistoryCount: 0` disarm. A guard for vacuous
// assertions that was never shown to fail would be the joke it exists to stop.

import { resolveAuthzContext } from '@objectstack/core';
import type { VerifyStack } from '@objectstack/verify';

/** The system read context every probe uses — probes observe, never mutate. */
const SYS = { isSystem: true } as const;

/** One probe's reading of the live stack. */
export interface ArmingVerdict {
  /** `true` only when the control was OBSERVED engaged. Never a default. */
  readonly armed: boolean;
  /**
   * What was actually read, in the words the failure message needs. This is
   * the half that turns "something is off" into "the org bind never happened",
   * so it is required rather than optional.
   */
  readonly observed: string;
}

/** A named precondition, read off the live stack. */
export interface ArmingProbe {
  /** The control this arms, named the way its card names it. */
  readonly control: string;
  /**
   * The DEFAULT that would disarm it — the sentence the next author needs in
   * order to fix the fixture, not merely to know it is broken.
   */
  readonly disarmedBy: string;
  read(): Promise<ArmingVerdict>;
}

function render(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function reason(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/**
 * Assert every named control is engaged against the live stack, or refuse to
 * let the fixture measure anything.
 *
 * Call from `beforeAll` — see decision 1 in this file's header.
 */
export async function assertArmed(probes: readonly ArmingProbe[]): Promise<void> {
  if (!Array.isArray(probes) || probes.length === 0) {
    throw new Error(
      'assertArmed(): the arming declaration is EMPTY, which asserts nothing. An empty ' +
        'declaration would certify every fixture that forgot to write one — the exact defect ' +
        'class this helper exists to close (#8074). Name at least one control, or do not call ' +
        'assertArmed at all and say in the fixture header why no precondition applies.',
    );
  }

  const disarmed: string[] = [];
  for (const probe of probes) {
    let verdict: ArmingVerdict;
    try {
      verdict = await probe.read();
    } catch (err) {
      // Decision 2: unreadable is DISARMED, never "fine".
      verdict = { armed: false, observed: `the arming probe itself threw — ${reason(err)}` };
    }
    if (verdict.armed !== true) {
      disarmed.push(
        `  • control:     ${probe.control}\n` +
          `    observed:    ${verdict.observed}\n` +
          `    disarmed by: ${probe.disarmedBy}`,
      );
    }
  }

  if (disarmed.length > 0) {
    throw new Error(
      `[#8074] this fixture is DISARMED: ${disarmed.length} of ${probes.length} control(s) it ` +
        'measures are not engaged on the booted stack, so its assertions would pass without ' +
        'testing anything.\n\n' +
        `${disarmed.join('\n\n')}\n\n` +
        'Nothing below this point is evidence. Arm the control (or drop the assertions that ' +
        'depend on it) — do not weaken the declaration.',
    );
  }
}

/**
 * The general probe: observe some live value, judge it, and say what was seen.
 *
 * `armed` must return a REAL boolean; any other return counts as disarmed,
 * because the safe direction for an ambiguous reading is "not proven armed".
 */
export function armedWhen<T>(spec: {
  control: string;
  disarmedBy: string;
  observe: () => T | Promise<T>;
  armed: (observed: T) => boolean;
  describe?: (observed: T) => string;
}): ArmingProbe {
  return {
    control: spec.control,
    disarmedBy: spec.disarmedBy,
    async read(): Promise<ArmingVerdict> {
      const observed = await spec.observe();
      return {
        armed: spec.armed(observed) === true,
        observed: spec.describe ? spec.describe(observed) : render(observed),
      };
    },
  };
}

/**
 * Resolve the authorization context for a bearer token the SAME way the REST
 * entry point does — never a hand-built principal, which would arm the probe
 * with the fixture's own assumption instead of the runtime's answer.
 *
 * Exported because three fixtures hand-roll this dance today.
 */
export async function resolveAuthzFor(stack: VerifyStack, token: string): Promise<{
  userId?: string;
  positions: string[];
  permissions: string[];
}> {
  const ql = await stack.kernel.getServiceAsync<any>('objectql');
  const authService = await stack.kernel.getServiceAsync<any>('auth');
  let api: any = authService?.api;
  if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
  const headers = new Headers({ authorization: `Bearer ${token}` });
  const ctx = await resolveAuthzContext({
    ql,
    headers,
    getSession: async (h: any) => api?.getSession?.({ headers: h }),
  });
  return {
    userId: ctx?.userId,
    positions: Array.isArray(ctx?.positions) ? [...ctx.positions] : [],
    permissions: Array.isArray(ctx?.permissions) ? [...ctx.permissions] : [],
  };
}

/**
 * A principal is inside the domain the policy under test is gated to.
 *
 * This is #8023's precondition. The wildcard row-level write floor is gated to
 * `positions: ['org_member']`, which a principal holds only through a
 * `sys_member` row; an org-less boot hands a fresh sign-up `['everyone']`, the
 * floor never applies, and a real 403 defect records as a passing cell.
 */
export function principalArmed(spec: {
  stack: VerifyStack;
  /** A bearer token — resolved through the real request path. */
  token: string;
  /** Who this is, for the failure message (e.g. `'bob (edit:true persona)'`). */
  who: string;
  /** Positions the principal must hold for the control to apply. */
  positions?: readonly string[];
  /** Permission sets the principal must hold for the control to apply. */
  permissions?: readonly string[];
  control: string;
  disarmedBy: string;
}): ArmingProbe {
  const wantPositions = spec.positions ?? [];
  const wantPermissions = spec.permissions ?? [];
  if (wantPositions.length === 0 && wantPermissions.length === 0) {
    // Decision 3: a probe with nothing to require can never report disarmed.
    throw new Error(
      `principalArmed(${spec.who}): no positions and no permissions required, so this probe ` +
        'can never fail. Name what the control is gated to, or use `armedWhen` for a fact this ' +
        'shape cannot express.',
    );
  }
  return {
    control: spec.control,
    disarmedBy: spec.disarmedBy,
    async read(): Promise<ArmingVerdict> {
      const ctx = await resolveAuthzFor(spec.stack, spec.token);
      const missingPositions = wantPositions.filter((p) => !ctx.positions.includes(p));
      const missingPermissions = wantPermissions.filter((p) => !ctx.permissions.includes(p));
      const armed = missingPositions.length === 0 && missingPermissions.length === 0;
      const seen =
        `${spec.who} resolved as userId=${render(ctx.userId)} ` +
        `positions=${render(ctx.positions)} permissions=${render(ctx.permissions)}`;
      if (armed) return { armed: true, observed: seen };
      const missing = [
        missingPositions.length ? `missing positions ${render(missingPositions)}` : '',
        missingPermissions.length ? `missing permissions ${render(missingPermissions)}` : '',
      ]
        .filter(Boolean)
        .join('; ');
      return { armed: false, observed: `${missing} — ${seen}` };
    },
  };
}

/**
 * A settings-backed auth control is switched ON in the live manager.
 *
 * This is #8049's precondition, and the same shape covers every fixture that
 * arms policy through `applyConfigPatch` (`two-factor-lockout`,
 * `oidc-authorize-env-gate`, `bearer-lane-password-change`): all three patch
 * and then TRUST the patch, so a key that is renamed, clamped or dropped would
 * silently return them to the vacuous state their headers warn about.
 *
 * A missing `auth` service or an unreadable config is DISARMED regardless of
 * the predicate — otherwise a predicate like `(v) => v === undefined` would
 * read "the service is gone" as armed.
 */
export function authSettingArmed(spec: {
  stack: VerifyStack;
  /** Key on the auth manager's effective options, e.g. `passwordHistoryCount`. */
  setting: string;
  armed: (value: unknown) => boolean;
  control: string;
  disarmedBy: string;
  describe?: (value: unknown) => string;
}): ArmingProbe {
  return {
    control: spec.control,
    disarmedBy: spec.disarmedBy,
    async read(): Promise<ArmingVerdict> {
      const auth = await spec.stack.kernel.getServiceAsync<any>('auth');
      const config = auth?.config;
      if (!config || typeof config !== 'object') {
        return {
          armed: false,
          observed: auth
            ? "the 'auth' service exposes no readable config, so no setting can be proven armed"
            : "no 'auth' service resolved on this stack",
        };
      }
      const value = config[spec.setting];
      return {
        armed: spec.armed(value) === true,
        observed: `auth config ${spec.setting}=${
          spec.describe ? spec.describe(value) : render(value)
        }`,
      };
    },
  };
}

/**
 * The row a control is carried by actually seeded.
 *
 * A permission set, policy or position that failed to seed disarms everything
 * downstream of it just as thoroughly as a wrong default: the fixture binds a
 * set that does not exist, the principal holds nothing, and every refusal it
 * then measures comes from somewhere else.
 */
export function seededArmed(spec: {
  stack: VerifyStack;
  object: string;
  /** Non-empty by construction: `{}` matches any row and proves nothing. */
  where: Record<string, unknown>;
  control: string;
  disarmedBy: string;
  /** Optional extra verdict on the row that was found. */
  armed?: (row: any) => boolean;
}): ArmingProbe {
  if (!spec.where || Object.keys(spec.where).length === 0) {
    // Decision 3: an empty `where` matches the first row of the table.
    throw new Error(
      `seededArmed(${spec.object}): an empty \`where\` matches any row, so this probe would be ` +
        'armed by the table being non-empty. Name the row the control is carried by.',
    );
  }
  return {
    control: spec.control,
    disarmedBy: spec.disarmedBy,
    async read(): Promise<ArmingVerdict> {
      const ql = await spec.stack.kernel.getServiceAsync<any>('objectql');
      const row = await ql?.findOne?.(spec.object, { where: spec.where, context: { ...SYS } });
      if (!row) {
        return {
          armed: false,
          observed: `no ${spec.object} row matches ${render(spec.where)} — it never seeded`,
        };
      }
      const extra = spec.armed ? spec.armed(row) === true : true;
      return {
        armed: extra,
        observed: extra
          ? `${spec.object} row ${render(spec.where)} is seeded (id=${render(row.id)})`
          : `${spec.object} row ${render(spec.where)} exists but fails its own arming predicate`,
      };
    },
  };
}
