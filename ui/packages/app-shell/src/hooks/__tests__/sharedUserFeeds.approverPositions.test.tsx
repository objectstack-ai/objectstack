/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5424 site 2 — role-addressed approvals reached the server as NO
 * identity at all.
 *
 * ## What was wrong
 *
 * `approverIdentities()` built the `approverId` query from `user.roles`. The
 * protocol-17 session face does not emit a `roles` key: framework ADR-0090 D3
 * renamed it to `positions` with no deprecation window, measured on a live
 * 17.1.0 server in objectui#5389 (`hasOwnProperty(user, 'roles')` answers
 * `false`; the payload carries `role`, `positions` and `isPlatformAdmin`). So
 * `u?.roles ?? []` was ALWAYS the empty array and the loop that appends
 * `role:<name>` never ran once.
 *
 * The consequence is silent and total for one whole class of approval: an
 * approval addressed to a POSITION rather than to a person (`pending_approvers`
 * holding `role:manager`) matched none of the identities sent, so it never
 * counted — gone from the bell badge, from the bell's Approvals tab, and from
 * Home's To-do card, with no error and no empty-state copy to notice. The
 * framework's own `customSession` docblock names this consumer by name.
 *
 * ## Why these pins are shaped this way
 *
 * The defect is an ALWAYS-EMPTY collection, so a pin that merely asserts "the
 * code reads `positions`" is worthless — it would be green against the broken
 * code too, which also read a key and also produced a request. Every case here
 * therefore asserts on the `role:`-prefixed identities that actually reach the
 * wire, i.e. what the server gets to match `pending_approvers` against. That is
 * the quantity that was empty.
 *
 * ## Reverse verification (direction predicted BEFORE running, measured in this PR)
 *
 * Restore the read to `u?.roles ?? []`, rebuild nothing (this suite resolves the
 * hook from source), and:
 *   - "sends a `role:` identity for every position" goes RED, and RED IN THE
 *     SHAPE THE CARD DESCRIBES: the role-identity list is `[]`, not a list with
 *     the wrong contents — received `[]`, expected `['role:manager',
 *     'role:platform_admin']`;
 *   - "still sends the person-addressed identities" stays GREEN — id and email
 *     never depended on the retired key, which is what makes the case above
 *     evidence about positions specifically rather than about the request
 *     existing at all;
 *   - the negative-control cases stay GREEN both ways — they carry neither key,
 *     so they cannot distinguish them; they are here to catch `role:undefined`,
 *     not to catch the rename.
 *
 * MEASURED: all three above held, the first one verbatim — `expected [] to
 * deeply equal [ 'role:manager', 'role:platform_admin' ]`. One case went red
 * that the prediction did NOT name: "does not resurrect the retired `roles` key
 * as a fallback". That is correct and welcome — restoring the old read is
 * exactly what makes the ghost key legible again, so the anti-alias pin is
 * load-bearing rather than decorative — but it was an unforeseen direction, and
 * is recorded here rather than quietly folded into the prediction.
 *
 * The fixture user is the exact payload objectui#5424 measured off the running
 * server, so a green here is a claim about a real session and not about a shape
 * invented to suit the fix.
 *
 * ## objectui#11455 — the spelling the server stores
 *
 * The identities above were `role:<p>`. The server stores a slot routed to a
 * position as `position:<p>`; `role:` is the framework ADR-0090 D3 deprecated
 * spelling, kept only for 15.x-era slots, and an approve that names it on a
 * `position:<p>` slot is refused. The builder now sends `position:<p>` and no
 * `role:` entry at all, so the pins read both halves off the wire: the
 * position-addressed subset is exactly the session's positions, and the
 * `role:`-prefixed subset is empty. The person-addressed case stays the
 * control: id and email are not positions and must not move.
 *
 * Reverse verification (predicted before running; the measured run is quoted
 * in the PR, not here): restore the `role:` prefix and the first case goes RED
 * — the position-addressed subset reads `[]` — while the person-addressed
 * control stays GREEN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

/** The signed-in session under test; swapped per case. */
let userFixture: Record<string, unknown> | null = null;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: userFixture }),
}));

/** Nothing here reads the adapter; stubbed so the module graph stays cheap. */
vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ find: async () => ({ data: [] }), getClient: () => undefined }),
}));

vi.mock('../../utils/authToken', () => ({ bearerAuthHeaders: () => ({}) }));

import { useSharedPendingApprovalsCount, __resetSharedUserFeeds, __markFirstPainted } from '../sharedUserFeeds';

/** Every approvals request this case issued, as parsed URLs. */
let requested: URL[] = [];

/**
 * The identities the server was actually given, in order. Reading them back off
 * the REQUEST rather than off the builder is deliberate: the builder is module
 * private, and what the card is about is what reaches the endpoint.
 */
function sentIdentities(): string[] {
  const last = requested[requested.length - 1];
  if (!last) return [];
  return (last.searchParams.get('approverId') ?? '').split(',').filter(Boolean);
}

/** Just the position-addressed subset — the population that was always empty. */
function sentPositionIdentities(): string[] {
  return sentIdentities().filter((i) => i.startsWith('position:'));
}

/**
 * Anything spelled with the ADR-0090 D3 deprecated `role:` prefix. The builder
 * reads no role scalar, so for it this must always be empty (objectui#11455).
 */
function sentRoleIdentities(): string[] {
  return sentIdentities().filter((i) => i.startsWith('role:'));
}

const mount = async () => {
  const rendered = renderHook(() => useSharedPendingApprovalsCount());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return rendered;
};

beforeEach(() => {
  requested = [];
  userFixture = null;
  // Module-scoped feeds outlive any one render tree, so cases would otherwise
  // inherit each other's key, rows and in-flight state.
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      requested.push(new URL(url, 'http://localhost'));
      return Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetSharedUserFeeds();
  // objectui#12980 — these cases start past the console's first paint.
  __markFirstPainted();
});

describe('objectui#5424 — approver identities come from `positions`, the published spelling', () => {
  it('sends a `position:` identity for every position the session carries, and no `role:` one', async () => {
    // The measured protocol-17 payload, verbatim (objectui#5424): a
    // permission-set-derived platform admin on a single-tenant 17.1.0 server.
    // Note `role` is the scalar `'user'` — which is precisely why falling back
    // to it cannot substitute for reading `positions`.
    userFixture = {
      id: 'u_1',
      email: 'admin@example.com',
      role: 'user',
      positions: ['manager', 'platform_admin'],
      isPlatformAdmin: true,
    };

    await mount();

    // The quantity the defect zeroed out. On the broken read this is `[]`.
    expect(sentPositionIdentities()).toEqual(['position:manager', 'position:platform_admin']);
    // objectui#11455: the stored spelling only — no deprecated `role:` twin,
    // and the `role: 'user'` scalar is not read here at all.
    expect(sentRoleIdentities()).toEqual([]);
    // …and this is the whole `approverId` the server receives, in order.
    expect(sentIdentities()).toEqual([
      'u_1',
      'admin@example.com',
      'position:manager',
      'position:platform_admin',
    ]);
  });

  it('still sends the person-addressed identities alongside them', async () => {
    // The control for the case above: these two never came from the retired
    // key, so they are green before and after. Without this, a green on the
    // first case could not be told apart from "the request grew an extra
    // field" — with it, the first case is evidence about positions.
    userFixture = { id: 'u_1', email: 'admin@example.com', positions: ['manager'] };

    await mount();

    // Deliberately blind to the position-addressed subset under BOTH prefixes:
    // this case must be green on the broken read and on the `role:` spelling
    // too, or it is not a control.
    expect(
      sentIdentities().filter((i) => !i.startsWith('position:') && !i.startsWith('role:')),
    ).toEqual([
      'u_1',
      'admin@example.com',
    ]);
  });

  it('does not resurrect the retired `roles` key as a fallback', async () => {
    // `packages/auth/src/types.ts` forbids pairing the two spellings in so many
    // words ("do not pair it with `positions` as a fallback"), and ADR-0090 D3
    // is what it is quoting. A session that still carried the old key — an
    // impersonation fixture, a stale mock, a hand-built preview user — must not
    // be able to smuggle position names in through it, because that is how the
    // retired spelling becomes a second de-facto contract.
    userFixture = { id: 'u_1', email: 'a@b.c', roles: ['ghost_position'] };

    await mount();

    expect(sentPositionIdentities()).toEqual([]);
    expect(sentRoleIdentities()).toEqual([]);
    expect(sentIdentities()).toEqual(['u_1', 'a@b.c']);
  });

  it('negative control: a user with neither `positions` nor `role` is handled, not crashed', async () => {
    // Must not throw, and must not manufacture `role:undefined` — an identity
    // that matches nothing but would be sent to the server on every poll.
    userFixture = { id: 'u_1', email: 'a@b.c' };

    await expect(mount()).resolves.toBeDefined();

    expect(sentIdentities()).toEqual(['u_1', 'a@b.c']);
    expect(sentIdentities().some((i) => i.includes('undefined'))).toBe(false);
  });

  it('negative control: a session with no id at all asks nothing and answers 0', async () => {
    // `user?.id` is the sign-in gate. No id ⇒ no key ⇒ no request — the feed
    // must stay silent rather than poll with a positions-only identity list.
    userFixture = { positions: ['manager'] };

    const { result } = await mount();

    expect(requested).toEqual([]);
    expect(result.current).toBe(0);
  });
});
