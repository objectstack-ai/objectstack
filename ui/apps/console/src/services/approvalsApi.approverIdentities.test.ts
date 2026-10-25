/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5424 site 3 — "My Pending" kept the person, lost every position.
 *
 * ## What was wrong
 *
 * `buildApproverIdentities()` derived `role:<name>` identities from
 * `user.roles`, which the protocol-17 session face does not emit: framework
 * ADR-0090 D3 renamed it to `positions` with no deprecation window, measured on
 * a live 17.1.0 server in objectui#5389. Unlike site 2 (`sharedUserFeeds`,
 * which read nothing else and so emitted no role identity at all), this builder
 * also splits the scalar `user.role` — so it did not die, it DEGRADED, and that
 * is worse to notice: on the measured payload it yielded `role:user`, an
 * identity that looks like it works, while every business position name
 * (`manager`, `finance_approver`, …) — the names an approval is actually
 * addressed to — was silently dropped.
 *
 * The old declaration described the two shapes as "multi-role shape (some auth
 * providers)" versus better-auth's scalar. That is no longer the distinction
 * that matters: BOTH are emitted, by the same server, in the same payload, and
 * they carry different things.
 *
 * ## Why these pins are shaped this way
 *
 * A pin that merely asserts "positions are read" would be green against the
 * broken code too, which also produced identities (`role:user`) and also
 * returned a non-empty list. So the cases below assert on the POSITION-derived
 * identities specifically, separated from the scalar-derived one — that is the
 * population that was empty.
 *
 * ## Reverse verification (direction predicted BEFORE running, measured in this PR)
 *
 * Restore `...(user.roles || [])`:
 *   - "derives an identity from every position" goes RED with the
 *     position-derived list empty — received `['role:user']`, expected it to
 *     contain `role:manager` and `role:finance_approver`;
 *   - "keeps the scalar `role` as a second source" stays GREEN — it never
 *     depended on the retired key, which is what makes the case above evidence
 *     about positions rather than about the builder working at all;
 *   - the de-duplication and negative-control cases stay GREEN both ways.
 *
 * MEASURED: the first two held, the first one verbatim — `expected
 * [ 'role:user' ] to deeply equal [ 'role:manager', 'role:finance_approver',
 * 'role:user' ]`, which is the card's description of this site ("yields
 * `role:user` and loses every business position name") reproduced exactly.
 *
 * The de-duplication prediction was WRONG: that case goes RED too (`expected
 * [ 'role:user' ] to deeply equal [ 'role:user', 'role:manager' ]`). Its
 * fixture supplies `manager` only through `positions`, so the retired read
 * drops it and the overlap it means to exercise never forms — it measures the
 * rename as well as the de-duplication. Left as it is, and recorded rather than
 * re-predicted: it is a real assertion about the fixed behaviour, it simply is
 * not the independent control the prediction claimed. "Does not resurrect the
 * retired `roles` key as a fallback" also goes red, for the same reason as its
 * `sharedUserFeeds` twin — the ablation is what makes the ghost key legible.
 * The genuinely independent controls are the two scalar-`role` cases and the
 * negative controls, and those did stay green.
 *
 * ## objectui#11455 — a position is spelled `position:<p>`
 *
 * The position-derived identities above were `role:<p>`. The server stores a
 * slot routed to a position as `position:<p>`; `role:` is the framework
 * ADR-0090 D3 deprecated spelling, kept only for 15.x-era slots, and an approve
 * that names it on a `position:<p>` slot is refused. This builder also picks
 * the `actor_id` a decision names, so the position arm now emits
 * `position:<p>` and no `role:<p>`. The scalar `user.role` arm keeps `role:<r>`:
 * the server's session payload says the better-auth scalar is not a source of
 * `positions[]`, so it is not a position and is not renamed. The scalar cases
 * are therefore the control — they must not move.
 *
 * Reverse verification (predicted before running; the measured run is quoted
 * in the PR, not here): restore the `role:` prefix on the position arm and the
 * first case goes RED — the position-addressed subset reads `[]` — while the
 * scalar-`role` controls stay GREEN.
 */
import { describe, it, expect } from 'vitest';

import { buildApproverIdentities } from './approvalsApi';

/**
 * The measured protocol-17 payload (objectui#5424), with a business position
 * added: the scalar `role` is `'user'`, and the names that matter live only in
 * `positions`.
 */
const PROTOCOL_17_USER = {
  id: 'u_1',
  email: 'admin@example.com',
  role: 'user',
  positions: ['manager', 'finance_approver'],
};

/** Just the position-addressed subset — the spelling the server stores. */
const positionIdentities = (user: Parameters<typeof buildApproverIdentities>[0]) =>
  buildApproverIdentities(user).filter((i) => i.startsWith('position:'));

/** Just the `role:` subset — after objectui#11455, the better-auth scalar only. */
const roleIdentities = (user: Parameters<typeof buildApproverIdentities>[0]) =>
  buildApproverIdentities(user).filter((i) => i.startsWith('role:'));

describe('objectui#5424 — `buildApproverIdentities` reads `positions`, the published spelling', () => {
  it('derives a `position:` identity from every position, not just the scalar role', () => {
    // The pin. Before objectui#5424 the position-derived list was empty — the
    // scalar survived and both business positions were gone.
    expect(positionIdentities(PROTOCOL_17_USER)).toEqual([
      'position:manager',
      'position:finance_approver',
    ]);
    // objectui#11455: no position is ALSO named under the deprecated `role:`
    // spelling. The one `role:` entry left is the scalar's own.
    expect(roleIdentities(PROTOCOL_17_USER)).toEqual(['role:user']);
    // The whole list, in order: person, positions, then the scalar's split.
    expect(buildApproverIdentities(PROTOCOL_17_USER)).toEqual([
      'u_1',
      'admin@example.com',
      'position:manager',
      'position:finance_approver',
      'role:user',
    ]);
  });

  it('keeps the scalar `role` as a second source — protocol 17 still emits it', () => {
    // Control: green before and after. `role` is a separate key that the
    // measured payload carries alongside `positions`; objectui#5424 is about
    // the retired one, and objectui#11455 renames positions only — the scalar
    // is not a position (plugin-auth's `customSession`), so this must not move.
    expect(roleIdentities({ id: 'u_1', role: 'auditor' })).toEqual(['role:auditor']);
    expect(positionIdentities({ id: 'u_1', role: 'auditor' })).toEqual([]);
  });

  it('still splits a comma-separated scalar role', () => {
    // better-auth's multi-value scalar shape, unchanged.
    expect(roleIdentities({ id: 'u_1', role: 'auditor, approver' })).toEqual([
      'role:auditor',
      'role:approver',
    ]);
  });

  it('does not resurrect the retired `roles` key as a fallback', () => {
    // `packages/auth/src/types.ts` forbids pairing the two spellings in so many
    // words. A session that still carries the old key must not be able to
    // smuggle position names in through it — that is how a retired spelling
    // becomes a second de-facto contract.
    const identities = buildApproverIdentities({
      id: 'u_1',
      roles: ['ghost_position'],
    } as unknown as Parameters<typeof buildApproverIdentities>[0]);

    expect(identities).toEqual(['u_1']);
  });

  it('still sends the person-addressed identities', () => {
    // Control for the first case: id and email never came from the retired key.
    // Deliberately blind to the `position:` and `role:` subsets: this case must
    // be green on the broken read and on the old spelling too, or it is not a
    // control.
    expect(
      buildApproverIdentities(PROTOCOL_17_USER).filter(
        (i) => !i.startsWith('position:') && !i.startsWith('role:'),
      ),
    ).toEqual(['u_1', 'admin@example.com']);
  });

  it('de-duplicates a repeated position', () => {
    expect(positionIdentities({ id: 'u_1', positions: ['manager', 'manager'] })).toEqual([
      'position:manager',
    ]);
  });

  it('names a position that repeats the scalar role under each source\'s own spelling', () => {
    // The measured objectui#5424 payload's `positions` contained the scalar's
    // value (`user`). The two sources mean different things — a held position
    // and the better-auth role scalar — so each keeps its own spelling; the
    // position is never folded into a `role:` entry.
    expect(
      buildApproverIdentities({ id: 'u_1', role: 'user', positions: ['user', 'manager'] }),
    ).toEqual(['u_1', 'position:user', 'position:manager', 'role:user']);
  });

  it('negative control: a user with neither `positions` nor `role` yields no position or role identity', () => {
    // Must not throw, and must not manufacture `role:undefined` — an identity
    // that matches nothing but would be sent on every request.
    const identities = buildApproverIdentities({ id: 'u_1', email: 'a@b.c' });

    expect(identities).toEqual(['u_1', 'a@b.c']);
    expect(identities.some((i) => i.includes('undefined'))).toBe(false);
  });

  it('negative control: no session at all yields no identities', () => {
    expect(buildApproverIdentities(null)).toEqual([]);
    expect(buildApproverIdentities(undefined)).toEqual([]);
  });
});
