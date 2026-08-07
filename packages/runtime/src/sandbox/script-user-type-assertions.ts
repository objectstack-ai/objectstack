// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Compile-level pins for `ScriptContext.user` / {@link ScriptUser} (#5521).
 *
 * ## Why a plain src module and not a test
 *
 * `packages/runtime/tsconfig.json` EXCLUDES every `.test.ts` and `.spec.ts`
 * file, and the package's `typecheck` script is a bare `tsc --noEmit` over that
 * config (the exclusion glob is not spelled here because it cannot be: its
 * leading wildcard pair would close this comment) — so a
 * `@ts-expect-error` written in a runtime test file is compiled by NOTHING and
 * evaluates never. Deleting such a directive leaves every gate just as green,
 * which is the definition of a phantom check; `check:type-check-coverage`'s
 * PINS_CHECKED invariant fails on one, and its PHANTOM_PIN_DEBT ledger is
 * closed to new entries. The same reasoning put
 * `packages/spec/src/ui/app.nav-type-assertions.ts` in src, and this file
 * follows it.
 *
 * The file is referenced by no tsup entry (`entry: ['src/index.ts']`) and
 * re-exported by no barrel, so it adds nothing to any build. Everything is
 * `export`ed because the repo compiles with `noUnusedLocals`.
 *
 * ## What is pinned, and in which direction
 *
 * The runtime VALUE has been right and pin-tested since #5372 —
 * `../action-ctx-user-shape.test.ts` asserts the three dispatch paths key for
 * key and value for value. That pin cannot see the case this file exists for:
 * a FOURTH dispatch face hand-rolling a fifth user shape, which is what
 * `user?: unknown` used to permit in silence and is the mechanism by which
 * #5372's three disagreeing shapes survived several versions — there was no
 * declaration to violate.
 *
 * So the assertions come in two families, and BOTH matter:
 *
 *  - POSITIVE — each of the two REAL producer shapes still assigns. These are
 *    the over-narrowing guard: collapse the union to `ActorUser` and the hook
 *    arm's assertions go red, which is the whole reason this is a union.
 *  - NEGATIVE (`@ts-expect-error`) — shapes that must NOT assign. If the type
 *    ever widens back toward `unknown`, the now-unused suppressions become the
 *    compile error. This is the half that catches "accepts too much", and it is
 *    the half the seam was missing entirely.
 */

import type { HookContext } from '@objectstack/spec/data';
import type { EvalUser } from '@objectstack/spec/identity';

import type { ActorUser } from '../security/actor-user.js';
import type { ScriptContext, ScriptUser } from './script-runner.js';

/* ────────────────────────────────────────────────────────────────────────────
 * POSITIVE — the two real producers, and the third real VALUE.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The ACTION arm, exactly as `buildActorUser()` emits it (`../security/actor-user.ts`):
 * the `EvalUser` identity core, the two transport aliases, and the two separate
 * authority channels. Post-#6011 there is no `roles` alias — `positions` is the
 * one spelling, and adding `roles` back here would fail the excess-property
 * check, which is a bonus pin on that retirement.
 */
export const actionProducerShape: ScriptUser = {
  id: 'usr_admin',
  userId: 'usr_admin',
  name: 'Ada Lovelace',
  displayName: 'Ada Lovelace',
  email: 'ada@objectos.ai',
  positions: ['platform_admin'],
  isPlatformAdmin: true,
  organizationId: 'org_1',
  permissions: ['admin_full_access'],
  systemPermissions: ['manage_metadata'],
};

/** The same shape arriving under its own name, not as a literal. */
export const actionProducerNamed = (u: ActorUser): ScriptUser => u;

/**
 * The HOOK arm, exactly as ObjectQL's `buildUser()` emits it
 * (`packages/objectql/src/engine.ts`) for a fully-populated execution context.
 * Note what is absent and must STAY absent-legal: `positions`, `permissions`,
 * `systemPermissions`, `userId`, `displayName`.
 */
export const hookProducerShape: ScriptUser = {
  id: 'usr_admin',
  email: 'ada@objectos.ai',
  organizationId: 'org_1',
};

/**
 * `buildUser()`'s minimum: an execution context with a `userId` and nothing
 * else. This is the assertion that goes red first if anyone collapses the union
 * to `ActorUser`.
 */
export const hookProducerMinimal: ScriptUser = { id: 'usr_admin' };

/** The same shape arriving under its declared spec name. */
export const hookProducerNamed = (u: HookContext['user']): ScriptUser => u;

/**
 * `undefined` is a REAL value on this seam, not merely the optionality of the
 * key: ObjectQL's `ScopedRepo.execute()` — the second `executeAction` call site
 * — passes an action context carrying neither `user` nor `session`, so both
 * arms of `body-runner.ts:340` resolve to `undefined`.
 */
export const absentUser: ScriptUser = undefined;

/** Both faces assembled at the real seam, so the field's own type is pinned too. */
export const actionSeamContext: ScriptContext = {
  input: { amount: 100 },
  user: actionProducerShape,
  session: { userId: 'usr_admin', organizationId: 'org_1', positions: ['platform_admin'] },
};

export const hookSeamContext: ScriptContext = {
  input: { id: 'rec_1' },
  user: hookProducerShape,
  session: { userId: 'usr_admin', organizationId: 'org_1' },
  event: 'beforeInsert',
  object: 'crm_case',
};

/** A body-less / system dispatch: the seam carries no caller at all. */
export const anonymousSeamContext: ScriptContext = { input: {} };

/**
 * The practical payoff, and the same one the sibling `ScriptSession` states:
 * `id` is declared on BOTH arms, so a consumer reading only the shared key needs no
 * discrimination. It is `string | undefined` because the hook arm's `id` is
 * optional — narrower than `unknown` by exactly the useful amount.
 */
export const sharedIdIsReadable = (ctx: ScriptContext): string | undefined => ctx.user?.id;

/* ────────────────────────────────────────────────────────────────────────────
 * NEGATIVE — must NOT assign. An unused suppression here IS the failure.
 * ──────────────────────────────────────────────────────────────────────────── */

/** A fourth dispatch face inventing its own vocabulary — the #5372 mechanism. */
// @ts-expect-error - an arbitrary shape is not a producer shape (#5521)
export const inventedShape: ScriptUser = { currentUser: 'usr_admin', tenant: 'org_1' };

/** A declared key carrying the wrong type. */
// @ts-expect-error - `id` is a string on both arms (#5521)
export const wrongIdType: ScriptUser = { id: 42 };

/** The caller is an object on every path, never a bare identifier. */
// @ts-expect-error - a user id string is not a user (#5521)
export const primitiveUser: ScriptUser = 'usr_admin';

/**
 * Action-SHAPED but incomplete — the failure mode #5372 actually shipped, where
 * a dispatcher hand-rolled a partial envelope. Rejected because it satisfies
 * neither arm: `ActorUser` requires the aliases and both authority channels,
 * and this shares no key with the hook shortcut, so the weak-type check refuses
 * it there ("no properties in common").
 */
// @ts-expect-error - a partial ActorUser is not an ActorUser (#5521)
export const partialActionShape: ScriptUser = { userId: 'usr_admin', positions: ['platform_admin'] };

/**
 * ⚠️ The limit of this union, pinned as a POSITIVE because it is what actually
 * compiles — stated here rather than left for the next reader to discover.
 *
 * A partial action envelope that happens to carry a hook-arm key assigns, via
 * the hook arm. Two ordinary TypeScript rules combine to allow it: the hook arm
 * is a WEAK type (every key optional), so one matching key is enough to satisfy
 * it; and excess-property checking on a union rejects only keys present in NO
 * member, so `positions` — real on the `ActorUser` arm — is not excess here.
 *
 * A union of two undiscriminated producer shapes cannot do better, and neither
 * can the sibling `ScriptSession`, whose `ActionSession` arm is all-optional
 * for the same reason. What the declaration buys is not a proof of
 * well-formedness; it is that a shape sharing NOTHING with either producer
 * ({@link inventedShape}) is now refused where `unknown` accepted it silently.
 * Closing the remaining gap would need a discriminant on the seam — the body
 * kind, which this interface deliberately does not carry (see `ScriptSession`).
 */
export const partialShapeBorrowingHookArm: ScriptUser = {
  id: 'usr_admin',
  positions: ['platform_admin'],
};

/**
 * The spec's `EvalUser` (ADR-0068 D1) — the issue's option 1, refused on
 * MEASUREMENT rather than taste. It is a SUPERSET of what the hook side
 * delivers (`buildUser()` emits no `positions`) and a SUBSET of what the action
 * side delivers, so it describes neither producer. `ActorUser extends EvalUser`
 * keeps the ADR-0068 contract on the path that actually has it.
 */
// @ts-expect-error - EvalUser is not a producer shape on this seam (#5521)
export const bareEvalUser = (u: EvalUser): ScriptUser => u;

/**
 * The union did not collapse to `ActorUser`: `positions` is unreadable without
 * discriminating the body kind, because the hook arm has no such key. This is
 * the over-narrowing guard stated from the READ side — if someone later
 * declares `user?: ActorUser`, this suppression goes unused and fails.
 */
export const positionsNeedDiscrimination = (ctx: ScriptContext): unknown =>
  // @ts-expect-error - `positions` exists on the action arm only (#5521)
  ctx.user?.positions;
