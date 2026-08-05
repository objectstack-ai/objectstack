// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #2567 — anonymous posture must be UNIFORM across HTTP surfaces, not just the
// REST `/data` routes proven by showcase-anonymous-deny.dogfood.test.ts. Before
// this fix, on a `requireAuth` deployment `/data/*` denied anonymous callers
// while sibling surfaces reached ObjectQL without the gate:
//   - the metadata endpoints (`/meta`)
//   - the raw-hono standard `/data` routes (order-dependent shadowing) — that
//     surface has since been deleted outright (#4073), which removes the entry
//     point rather than gating it
//   - the DISPATCHER-mounted execution surfaces `/actions/*` and `/automation/*`
//     (#5519, gated by PR #5569 — see the block below)
//
// This proof boots the real showcase HTTP stack ON THE PLATFORM DEFAULT (the
// verify harness passes no `requireAuth` override, so the flipped secure default
// is what a fresh production deployment gets) and asserts every surface denies
// an anonymous caller with 401 while an authenticated member is unaffected.
//
// ── Why `/actions` and `/automation` are here (#5570) ────────────────────────
//
// `authz-conformance.matrix.ts` names THIS FILE as the proof artifact for the
// "#2567 anonymous posture is uniform across surfaces" claim. #5519 then found
// the claim false on exactly two surfaces this file did not drive: anonymous
// callers could POST a `script` action (whose body runs `isSystem: true`
// elevated) and could trigger, list, or DEREGISTER automation flows. The
// artifact was silent throughout — a declared ≠ proven gap living in the test
// layer. PR #5569 built the gate in `packages/runtime`; #5570 is the evidence
// half, so the proof file once again covers everything the matrix row claims
// it covers.
//
// The value this boot adds OVER #5569's own runtime integration test
// (`dispatcher-plugin.anonymous-gate.integration.test.ts`) is precisely the
// comparison that test documented it could NOT make: it boots a LiteKernel that
// mounts no `/data` and no `/meta`, so it had no second surface to contrast
// against. Here all four surfaces are served by ONE process — and by TWO
// different registration paths (`@objectstack/rest` owns `/data` + `/meta`;
// `dispatcher-plugin.ts` mounts `/actions` + `/automation` straight onto the
// host server) — which is the divergence #5519 was about in the first place.

import { describe, it, expect, beforeAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { getSharedShowcase } from './shared-showcase.js';

const OBJ = '/data/showcase_private_note';

// `showcase_mark_done` is a `type: 'script'` action declared on `showcase_task`
// whose body performs an `api.write` update — the exact action #5519 measured
// answering 200 to an anonymous caller. The record id is deliberately a
// non-existent one: the gate is the FIRST statement of `handleActionsRequest`,
// so an anonymous request is refused before any object, action or record is
// resolved. Needing a real record to get a 401 would mean the gate had moved
// behind the lookups.
const ACTION = '/actions/showcase_task/showcase_mark_done/anon-probe-id';
// A real showcase flow declaration, so the deregister case names something that
// genuinely exists in the app's metadata.
const FLOW = 'showcase_reassign_wizard';

describe('showcase: anonymous posture is uniform across surfaces (#2567)', () => {
  let stack: VerifyStack;
  let memberToken: string;

  beforeAll(async () => {
    stack = await getSharedShowcase(); // platform default (deny anonymous)
    await stack.signIn();
    memberToken = await stack.signUp('surfaces-member@verify.test');
  }, 60_000);

  /** An HTTP call carrying no credential of any kind. */
  const anon = (method: string, path: string, body?: unknown) =>
    stack.api(path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });

  // ── /meta ──────────────────────────────────────────────────────────────
  it('anonymous GET /meta is denied (401)', async () => {
    const r = await stack.api('/meta', { method: 'GET' });
    expect(r.status, 'anonymous metadata read must be 401').toBe(401);
  });

  it('an authenticated member is NOT denied on /meta (deny targets anonymity)', async () => {
    const r = await stack.apiAs(memberToken, 'GET', '/meta');
    expect(r.status, 'authenticated metadata read must clear the auth gate').not.toBe(401);
  });

  // ── /data (surface-level; served by @objectstack/rest, its sole owner) ──
  it('anonymous READ of the data surface is denied (401)', async () => {
    const r = await stack.api(OBJ, { method: 'GET' });
    expect(r.status, 'anonymous data read must be 401').toBe(401);
  });

  it('an authenticated member is allowed on the data surface', async () => {
    const r = await stack.apiAs(memberToken, 'GET', OBJ);
    expect(r.status).toBe(200);
  });

  // ── /actions (dispatcher-mounted; runtime domains/actions.ts) — #5519 ───
  it('anonymous POST of a script action is denied (401)', async () => {
    const r = await anon('POST', ACTION, { params: {} });
    expect(r.status, 'anonymous action dispatch must be 401').toBe(401);
  });

  it('an authenticated member is NOT denied on the action surface', async () => {
    // Whatever the action surface answers a MEMBER — 200, a 400 from the param
    // contract, a 403 from `requiredPermissions` — it is an answer about
    // authorization, not about anonymity. The assertion is deliberately the
    // same `.not.toBe(401)` the /meta contrast uses: this file's subject is the
    // anonymous posture, and pinning the member's exact status here would make
    // it fail for reasons that belong to other proofs.
    const r = await stack.apiAs(memberToken, 'POST', ACTION, { params: {} });
    expect(r.status, 'an authenticated caller must clear the auth gate').not.toBe(401);
  });

  // ── /automation (dispatcher-mounted; runtime domains/automation.ts) ─────
  //
  // The gate is DOMAIN-WIDE and sits ahead of the `isServiceServeable` probe on
  // purpose: this stack installs no `@objectstack/service-automation`, so the
  // domain's own answer here is 501. If the gate ran after the probe, anonymous
  // and authenticated callers would both get 501 and the 401/501 difference
  // would fingerprint whether a deployment mounts automation at all. The
  // authenticated 501 case below is what gives these three cases their teeth:
  // in this one process, the same route answers 401 to anonymous and 501 to a
  // member, so the 401 can only be the gate's answer.
  it('anonymous POST /automation/:name/trigger is denied (401)', async () => {
    const r = await anon('POST', `/automation/${FLOW}/trigger`, { recordId: 'anon-probe-id' });
    expect(r.status, 'anonymous flow trigger must be 401').toBe(401);
  });

  it('anonymous GET /automation is denied (401) — the flow inventory stays private', async () => {
    const r = await anon('GET', '/automation');
    expect(r.status, 'anonymous flow listing must be 401').toBe(401);
  });

  it('anonymous DELETE /automation/:name is denied (401) — the destructive one', async () => {
    const r = await anon('DELETE', `/automation/${FLOW}`);
    expect(r.status, 'anonymous flow deregistration must be 401').toBe(401);
  });

  it('an authenticated caller reaches the domain, which answers 501 — not 401', async () => {
    const r = await stack.apiAs(memberToken, 'GET', '/automation');
    expect(r.status, 'authenticated flow listing must clear the auth gate').not.toBe(401);
    // The domain's OWN answer on a stack with no automation service. Asserting
    // it (rather than only `.not.toBe(401)`) is what proves the anonymous 401
    // above is produced by the gate and not by the domain: drop the gate and
    // the anonymous cases collapse onto THIS status.
    expect(r.status, 'no @objectstack/service-automation is installed on this boot').toBe(501);
  });

  // ── one code, one message — two wrappers ───────────────────────────────
  it('every denied surface answers the SAME code and message (the wrappers differ)', async () => {
    const rest = await Promise.all([
      anon('GET', '/meta').then((r) => r.json()),
      anon('GET', OBJ).then((r) => r.json()),
    ]);
    const dispatcher = await Promise.all([
      anon('POST', ACTION, { params: {} }).then((r) => r.json()),
      anon('POST', `/automation/${FLOW}/trigger`, {}).then((r) => r.json()),
      anon('GET', '/automation').then((r) => r.json()),
      anon('DELETE', `/automation/${FLOW}`).then((r) => r.json()),
    ]);

    // Each family is read in ITS OWN declared shape — no `??` chain across the
    // two, because a tolerant reader here would hide the day one of them
    // changes. `@objectstack/rest` returns the flat `ANONYMOUS_DENY_BODY`
    // (`{ error: <CODE>, message }`); the dispatcher returns its standard
    // wrapper (`{ success: false, error: { code, message, httpStatus } }`).
    for (const body of rest) {
      expect(body).toEqual({
        error: 'UNAUTHENTICATED',
        message: 'Authentication is required to access this endpoint.',
      });
    }
    for (const body of dispatcher) {
      expect(body).toMatchObject({
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required to access this endpoint.',
          httpStatus: 401,
        },
      });
    }

    // What is genuinely uniform — and what #2567 claims — is the SEMANTICS: one
    // status, one code, one message, whichever surface you knock on. The two
    // wrappers are a known, pre-existing platform-wide split (ADR-0112's
    // amendment records `@objectstack/rest`'s flat envelope and the dispatcher's
    // wrapped one as the two live shapes). Pinned here so that split cannot
    // quietly widen into two different DENIALS.
    const codes = new Set([
      ...rest.map((b: any) => b.error),
      ...dispatcher.map((b: any) => b.error.code),
    ]);
    const messages = new Set([
      ...rest.map((b: any) => b.message),
      ...dispatcher.map((b: any) => b.error.message),
    ]);
    expect([...codes]).toEqual(['UNAUTHENTICATED']);
    expect([...messages]).toEqual(['Authentication is required to access this endpoint.']);
  });
});
