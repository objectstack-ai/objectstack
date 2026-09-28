// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16582] `organizations.invite` declares `role?` optional, so the shorter
 * call it advertises must actually work: omitting `role` sends `'member'`.
 *
 * ## The defect
 *
 * better-auth 1.7.2's body schema for `POST /organization/invite-member` makes
 * `role` REQUIRED. The SDK declared it optional and forwarded the caller's
 * object verbatim, so the documented-looking minimal call —
 * `invite({ email, organizationId })` — was refused with
 * `400 [body.role] Invalid input` (`VALIDATION_ERROR`) before it reached any
 * ObjectStack code. Its sibling `invitations.resend` has always substituted
 * `'member'` over the SAME vendor endpoint, which is exactly why the gap stayed
 * invisible: one member of the family papered over the vendor's requirement and
 * the other did not.
 *
 * ## Why this file boots the real server rather than asserting on a double
 *
 * The claim under test is "the vendor accepts what the SDK now sends". Only
 * better-auth's own zod body schema can settle that — a hand-written stand-in
 * would let this suite certify the SDK against a requirement this file
 * invented, and a status-only mock would have been green before the fix and
 * green after it. So the arrangement is the card's probe with only the socket
 * stood in for: a real `AuthManager` (better-auth 1.7.2, organization plugin,
 * `teams: { enabled: true }` — its defaults) over a real `ObjectQL` on a real
 * `SqliteWasmDriver`, and an `ObjectStackClient` whose `fetch` hands the
 * `Request` straight to `AuthManager.handleRequest`.
 *
 * Cases ① – ③ are RED on the defect: ① and ③ throw
 * `[body.role] Invalid input`, and ② throws for the same reason before it can
 * observe the role it sent. That is what makes them a pin on the DEFECT.
 *
 * ## Case ④ is a different mechanism and neither half can do the other's job
 *
 * The drive proves the vendor accepts the body; it cannot see a body that
 * carries MORE than it should. The SDK serialises the caller's object straight
 * into the request, so a later "helpful" translation layer could add or rename
 * members without changing a type and without changing a status. ④ therefore
 * holds the request bytes to FULL-STRING equality — never `toContain`, which a
 * body carrying extra members would satisfy.
 *
 * It is also the guard that the default is applied by SUBSTITUTION rather than
 * by ordering. The tempting other spelling, `{ role: 'member', ...req }`, agrees
 * with the shipped one on every status cases ① – ③ can observe, and differs in
 * exactly two places ④ can: it re-orders the body, and — because a spread
 * copies an explicitly-`undefined` member over the default while `??` does not
 * — it puts a caller's `role: undefined` back on the wire as no `role` at all,
 * restoring the 400 for the caller who wrote `invite({ email, role: maybe })`.
 * ④c is that case.
 *
 * ## ⑤ pins the shape of the fix, not just its effect
 *
 * The other self-consistent repair — declaring `role` REQUIRED — is a
 * narrowing of a published request type. It was weighed and rejected on this
 * card: it restates the vendor's requirement at a real cost to every existing
 * caller, while the default costs no type change at all. ⑤ is a compile-time
 * assertion that `role` is still optional, so that route cannot be taken later
 * by accident.
 *
 * ⑥ pins WHERE the first scenario's one-time cost is paid (next section).
 *
 * ## [#20327] Why one throwaway scenario runs at MODULE SCOPE
 *
 * The first scenario in a worker pays a one-time cost no later one sees:
 * better-auth's lazily imported module graph, sql.js's WASM compile, and the
 * first-use costs of the sync and the sign-up. The phases are measured in
 * `auth-login-register-envelope.test.ts`, which carries the same arrangement
 * and the same fix. Here, idle on 4 vCPU at `c74de10a9`, that cost put ① at
 * 968 ms against 310-336 ms for ② and ③, which run the same `arrange()`.
 * On the `Test Core` shard where a sibling suite went red (PR #20325's run),
 * ① took 2849 ms here against 497-820 ms for the later cases that run
 * `arrange()`. Under twenty-four CPU-bound busy loops on this box, the load
 * that reproduces that red, ① timed out at vitest's 5000 ms `testTimeout` in
 * every run.
 *
 * So the cost is now paid by a module-scope `await`, during COLLECTION, which
 * no vitest clock covers: `@vitest/runner@4.1.11` wraps hooks and test bodies
 * in `withTimeout(...)` and awaits the file import bare. This is the repo's
 * convention: "clocked windows measure behaviour, never loading" (AGENTS.md,
 * Build & Test; `check:test-source-alias`). The warm-up is the file's own
 * `arrange()`, so no list of loads can drift from what the cases really pay.
 * It needs the posture the `beforeAll` sets for the cases, so it holds that
 * posture for itself and puts back what it found, even when it throws.
 *
 * ⛔ It shares nothing a case asserts on. Every case still builds a fresh
 * engine, a fresh `AuthManager`, a fresh owner and a fresh organization. Its
 * engine stays open, as every case's does (`arrange()` hands none back), so
 * no case runs in a state no case ran in before: every case but the first
 * already ran after an earlier scenario. What it leaves warm is
 * process-level: the module registry, sql.js's compiled WASM and the JIT.
 *
 * ⛔ Do not move it into a hook, and do not answer a recurrence by raising a
 * timeout: vitest clocks a hook exactly as it clocks a test body, and a wider
 * window only moves the cliff to a heavier shard.
 */

import { describe, it, expect, expectTypeOf, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AuthManager } from '@objectstack/plugin-auth';
import * as identityObjects from '@objectstack/platform-objects/identity';
import { ObjectStackClient } from './index';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'S3cure!Passw0rd-16582';

/**
 * The identity objects this arrangement stands up, read out of
 * `@objectstack/platform-objects/identity` BY SHAPE rather than transcribed:
 * plugin-auth's own list is package-private, and a hand-copied one here would
 * be a second declaration of the same set, drifting the day the plugin
 * registers one more. Same derivation as `auth-rotated-session-token.test.ts`.
 */
const IDENTITY_OBJECTS = Object.values(
  identityObjects as unknown as Record<string, unknown>,
).filter(
  (o): o is Record<string, unknown> =>
    !!o &&
    typeof o === 'object' &&
    typeof (o as { name?: unknown }).name === 'string' &&
    typeof (o as { fields?: unknown }).fields === 'object',
);

/**
 * `beforeCreateOrganization` refuses to mint an organization unless a
 * multi-organization posture is standing, and this suite needs one to invite
 * INTO. Set for the whole file and restored after, so a sibling suite in the
 * same worker is never handed a posture it did not ask for.
 */
const PRIOR_POSTURE = process.env.OS_TENANCY_POSTURE;

/** Put back the posture this file found: after the warm-up, and after the file. */
const restorePosture = (): void => {
  if (PRIOR_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = PRIOR_POSTURE;
};

beforeAll(() => {
  process.env.OS_TENANCY_POSTURE = 'isolated';
});

afterAll(restorePosture);

let seq = 0;
const nextEmail = (tag: string) => `os16582-${tag}-${++seq}-${Date.now()}@example.com`;

interface Rig {
  client: ObjectStackClient;
  organizationId: string;
}

/**
 * A signed-in organization owner and the organization they own — every layer
 * below the SDK is the real one.
 */
async function arrange(): Promise<Rig> {
  const engine = new ObjectQL();
  engine.registerDriver(new SqliteWasmDriver({ filename: ':memory:' }) as never, true);
  await engine.init();
  for (const object of IDENTITY_OBJECTS) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();

  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
  } as never);

  const client = new ObjectStackClient({
    baseUrl: ORIGIN,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      manager.handleRequest(new Request(String(input), init)),
  });

  await client.auth.register({
    email: nextEmail('owner'),
    password: PASSWORD,
    name: 'Org Owner',
  });

  const organization = await client.organizations.create({
    name: 'Invite Default Org',
    slug: `os16582-${seq}-${Date.now()}`,
  });
  const organizationId = (organization as unknown as { id: string }).id;
  expect(organizationId, 'no organization was minted — the premise of this suite is gone').toBeTruthy();
  await client.organizations.setActive(organizationId);

  return { client, organizationId };
}

// [#20327] The first scenario's one-time cost, paid during COLLECTION, which
// no vitest clock covers (header, last section). It holds the posture the
// `beforeAll` above sets for the cases, and `.finally` puts back what it
// found. ⛔ It stays at module scope, and `⑥` below pins that.
process.env.OS_TENANCY_POSTURE = 'isolated';
await arrange().finally(restorePosture);

// ─────────────────────────────────────────────────────────────────────────
// ① the card's call, against the real vendor schema
// ─────────────────────────────────────────────────────────────────────────

describe('#16582 organizations.invite defaults role to member', () => {
  it('① the two-argument form is accepted and lands a pending member invitation', async () => {
    const { client, organizationId } = await arrange();

    const invitation = await client.organizations.invite({
      email: nextEmail('invitee'),
      organizationId,
    });

    // Before the fix this line was never reached: the call threw
    // `[body.role] Invalid input` at 400.
    expect(invitation.status).toBe('pending');
    expect(invitation.role).toBe('member');
    expect(invitation.organizationId).toBe(organizationId);
  });

  // ───────────────────────────────────────────────────────────────────────
  // ② a role the caller DID name is never overwritten
  // ───────────────────────────────────────────────────────────────────────

  it('② an explicit role survives — the default substitutes, it does not clobber', async () => {
    const { client, organizationId } = await arrange();

    const invitation = await client.organizations.invite({
      email: nextEmail('admin-invitee'),
      role: 'admin',
      organizationId,
    });

    expect(invitation.role).toBe('admin');
    expect(invitation.status).toBe('pending');
  });

  // ───────────────────────────────────────────────────────────────────────
  // ③ the asymmetry the card is about is gone
  // ───────────────────────────────────────────────────────────────────────

  it('③ invite and its sibling resend agree on the shorter call', async () => {
    const { client, organizationId } = await arrange();

    const invited = await client.organizations.invite({
      email: nextEmail('family-invite'),
      organizationId,
    });
    const resent = await client.organizations.invitations.resend({
      email: nextEmail('family-resend'),
      organizationId,
    });

    // One family, one behaviour — this is the equality the card asked for.
    expect(invited.role).toBe(resent.role);
    expect(invited.role).toBe('member');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ④ the request BYTES — a mechanism the drive above structurally cannot see
// ─────────────────────────────────────────────────────────────────────────

describe('#16582 the bytes organizations.invite puts on the wire', () => {
  const INVITE_URL = `${ORIGIN}/api/v1/auth/organization/invite-member`;

  /** The 200 the route answers; identical before and after this card. */
  const PENDING = JSON.stringify({
    organizationId: 'org_probe',
    email: 'probe@example.com',
    role: 'member',
    teamId: null,
    status: 'pending',
    expiresAt: '2026-09-12T00:16:41.261Z',
    createdAt: '2026-09-10T00:16:41.261Z',
    inviterId: 'usr_probe',
    id: 'inv_probe',
  });

  function capturing() {
    const fetchMock = vi.fn(
      async () =>
        new Response(PENDING, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const client = new ObjectStackClient({ baseUrl: ORIGIN, fetch: fetchMock as never });
    return { client, fetchMock };
  }

  function soleBody(fetchMock: ReturnType<typeof capturing>['fetchMock']): string {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(INVITE_URL);
    return String(init.body);
  }

  it('④a omitting role sends exactly the caller object plus role: "member"', async () => {
    const { client, fetchMock } = capturing();

    await client.organizations.invite({ email: 'probe@example.com', organizationId: 'org_probe' });

    // FULL-STRING equality: a body carrying an extra member, a renamed one, or
    // a second `role` fails here even though the vendor would still answer 200.
    expect(soleBody(fetchMock)).toBe(
      JSON.stringify({ email: 'probe@example.com', organizationId: 'org_probe', role: 'member' }),
    );
  });

  it('④b naming role sends that role, once', async () => {
    const { client, fetchMock } = capturing();

    await client.organizations.invite({
      email: 'probe@example.com',
      role: 'admin',
      organizationId: 'org_probe',
    });

    expect(soleBody(fetchMock)).toBe(
      JSON.stringify({ email: 'probe@example.com', role: 'admin', organizationId: 'org_probe' }),
    );
  });

  it('④c an explicitly-undefined role is the same call as omitting it', async () => {
    const { client, fetchMock } = capturing();

    // What `invite({ email, role: maybeRole })` compiles to when the variable
    // is empty — indistinguishable from omission to the caller, and it must be
    // indistinguishable on the wire too.
    await client.organizations.invite({
      email: 'probe@example.com',
      role: undefined,
      organizationId: 'org_probe',
    });

    expect(soleBody(fetchMock)).toBe(
      JSON.stringify({ email: 'probe@example.com', role: 'member', organizationId: 'org_probe' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ⑤ the pin on the SHAPE of the fix — compile-time, never invoked
// ─────────────────────────────────────────────────────────────────────────

declare const typedClient: ObjectStackClient;

/** The declared request type of the method this card repairs. */
type InviteRequest = Parameters<ObjectStackClient['organizations']['invite']>[0];

/**
 * Compiled by `packages/client/tsconfig.test.json` (which includes `src/**` and
 * is reached by `package.json`'s `typecheck` script through
 * `check:test-typecheck`), never invoked — every statement is an assertion tsc
 * evaluates, and none of them may perform a request. Same arrangement as
 * `oauth-applications-register-request-members.test.ts`'s pins.
 *
 * This is the guard against the route that was weighed and REJECTED on this
 * card: declaring `role` required. Doing that makes the first statement red
 * (the two-argument literal stops satisfying the parameter) and the
 * `Exclude<…, undefined>` inequality red as well, so the narrowing cannot land
 * quietly under a green suite.
 */
export async function inviteRoleStaysOptional16582(): Promise<void> {
  // The call the card is about must remain expressible.
  await typedClient.organizations.invite({ email: 'e@example.com', organizationId: 'o' });
  // …and so must the bare one.
  await typedClient.organizations.invite({ email: 'e@example.com' });

  // `role` is optional: dropping `undefined` from it changes the type, which is
  // only true while `undefined` is in it.
  expectTypeOf<InviteRequest['role']>().not.toEqualTypeOf<
    Exclude<InviteRequest['role'], undefined>
  >();
}

// ─────────────────────────────────────────────────────────────────────────
// ⑥ the cold start stays outside every clocked window
// ─────────────────────────────────────────────────────────────────────────

describe('#16582 ⑥ the cold start stays outside every clocked window', () => {
  it('pays the first scenario at module scope, and no hook carries it', () => {
    // [#20327] Read off this file's own text, so "do not move it into a
    // hook" is an assertion rather than a sentence nobody reads.
    const code = readFileSync(fileURLToPath(import.meta.url), 'utf8');

    // Exactly one warm-up call, and it opens its own line at column 0. So it
    // sits in no function body, which is what "paid during collection"
    // reduces to. Comment lines start with `//` or ` *` and cannot match.
    expect(code.match(/^await arrange\(\)\.finally\(restorePosture\);$/gm) ?? []).toHaveLength(1);

    // ⛔ No `before*` hook may come back to carry it: vitest clocks a hook
    // with `hookTimeout` exactly as it clocks a test body with `testTimeout`.
    // This file's one hook is the posture `beforeAll`, which loads nothing.
    // Each hook is read up to the next column-0 `});`, so a hook indented
    // inside a `describe` reads on to that block's close and cannot hide a
    // scenario from this.
    const hooks = [...code.matchAll(/^\s*before(?:All|Each)\s*\(([\s\S]*?)^\}\);$/gm)].map(
      (m) => m[1],
    );
    expect(hooks).toHaveLength(1);
    for (const body of hooks) expect(body).not.toMatch(/\barrange\(/);
  });
});
