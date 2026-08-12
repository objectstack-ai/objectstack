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
// ADR-0056 D10 — the authz-conformance matrix rows this file is the cited proof
// for; `authz-conformance.test.ts` asserts the pairing is mutual (#7976). One
// per SURFACE, each with its own anonymous-401 cases below. It deliberately does
// NOT claim `anonymous-deny`: the REST `/data` cases here are the cross-surface
// contrast, and that row's cited proof is showcase-anonymous-deny.dogfood.test.ts.
// authz-row: anonymous-deny-meta
// authz-row: anonymous-deny-actions
// authz-row: anonymous-deny-automation
// authz-row: anonymous-deny-packages
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
import {
  ANONYMOUS_DENY_BODY,
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
  ANONYMOUS_DENY_STATUS,
} from '@objectstack/core';
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

// ── #5632 — the TWO declared anonymous-401 envelopes, as executable rules ───
//
// `ANONYMOUS_DENY_BODY`'s docstring in `@objectstack/core` used to call itself
// "the single 401 body shape every seam returns". It never was: it is the REST
// seam's shape, and the five dispatcher-mounted domains answer their own
// wrapper. #5632 narrowed that docstring; the declarations here are the
// executable half of the same statement, so the narrowed comment cannot rot
// back into a lie without CI saying so.
//
// ── Division of labour with the #5631 slice at the bottom of this file ─────
//
// That case reads EACH FAMILY in its own declared shape and pins the code and
// message the two share, spelled as string literals. Two things it cannot fail
// on, by construction:
//   1. a body that satisfies NEITHER declared envelope yet still survives —
//      `toMatchObject` ignores unknown keys, so a re-nested or hybrid third
//      dialect can pass it as long as the matched subset is still in there;
//   2. drift between the literals spelled in this file and the constants
//      `@objectstack/core` actually exports — the literals would just go stale.
//
// The cases added below close exactly those two and nothing else: every
// anonymous 401 body is classified into EXACTLY ONE of the two declared
// families by mutually exclusive predicates, that family is checked against a
// declared seam→owner map, and only then are the code and message read —
// through THAT family's own reader — and compared to the exported constants.
// Deliberately NO `??` chain across the families: a tolerant cross-family read
// is the very shape #5632 exists to keep out of this codebase.

type DenyFamily = 'rest-flat' | 'dispatcher-wrapper';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The REST seam's envelope — `@objectstack/rest` `enforceAuth` writing
 * `ANONYMOUS_DENY_BODY` verbatim. The machine code IS the top-level `error`
 * value; there is no wrapper around it and no `success` flag.
 */
const isRestFlatDeny = (body: unknown): boolean =>
  isRecord(body)
  && typeof body.error === 'string'
  && typeof body.message === 'string'
  && !('success' in body);

/**
 * The dispatcher's envelope — what `deps.error(msg, status, { code })` writes
 * in `domains/{ai,meta,security,actions,automation}.ts`. The code lives one
 * level down under `error.code` and the status is restated in the body.
 */
const isDispatcherWrapperDeny = (body: unknown): boolean => {
  if (!isRecord(body) || body.success !== false || 'message' in body) return false;
  const err = body.error;
  return isRecord(err)
    && typeof err.code === 'string'
    && typeof err.message === 'string'
    && typeof err.httpStatus === 'number';
};

// The closed world. The two predicates are mutually exclusive where it counts:
// `error` is a STRING in one and an OBJECT in the other, and each rejects the
// other's discriminating key. Anything else on the wire matches neither.
const DENY_ENVELOPES: Record<DenyFamily, (body: unknown) => boolean> = {
  'rest-flat': isRestFlatDeny,
  'dispatcher-wrapper': isDispatcherWrapperDeny,
};

/**
 * Every declared envelope a body satisfies. The contract is EXACTLY ONE entry:
 * an empty result means a third dialect reached the wire, two entries would
 * mean the declarations stopped being mutually exclusive, and the wrong single
 * entry means that seam changed family.
 */
const declaredFamiliesOf = (body: unknown): DenyFamily[] =>
  (Object.keys(DENY_ENVELOPES) as DenyFamily[]).filter((family) => DENY_ENVELOPES[family](body));

/** Read code + message with the family's OWN reader. Never a cross-family `??`. */
const readDenial = (family: DenyFamily, body: unknown): { code: unknown; message: unknown } => {
  if (!isRecord(body)) return { code: undefined, message: undefined };
  if (family === 'rest-flat') return { code: body.error, message: body.message };
  const err: Record<string, unknown> = isRecord(body.error) ? body.error : {};
  return { code: err.code, message: err.message };
};

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

  // ── #7867 — what the member's answer actually IS, now that it is asserted ──
  //
  // ⚠️ These two cases exist because the one ABOVE cannot fail for them, by
  // design: its `.not.toBe(401)` is deliberately about anonymity and tolerates
  // any non-401. For as long as this fixture has existed that tolerance let a
  // real defect ride through this required 3-shard gate, 23/23 green, while
  // printing a stack trace on every run:
  //
  //   ERROR Update operation failed … Hook 'showcase_audit_task_completion'
  //   could not evaluate its condition (type: Unknown variable: previous) …
  //     at unevaluableConditionError (packages/objectql/src/hook-wrappers.ts)
  //     at _ObjectQL.triggerHooks (packages/objectql/src/engine.ts)
  //   ERROR [BodyRunner] sandboxed action threw …
  //
  // `ACTION` targets a deliberately NON-EXISTENT record id — the anonymous
  // cases need that, since the 401 floor must land before any lookup — so the
  // member's request is a by-id write against a ghost id. `ObjectQL.update()`
  // had no not-found gate on that path, so the write ran on and died on
  // whichever stage complained first: a `HookConditionError` 400 here, a
  // required-field 400 on an unhooked object. The 400 class varied with the
  // object's declarations; the missing 404 was the constant (#7867, from
  // #5571's reproduction).
  //
  // Asserted on the CODE and the STATUS, never on "it threw": the pre-fix
  // behaviour also produced an error response, so "it failed" cannot tell the
  // two apart — and 404-vs-400 is exactly what a client's retry and cache
  // policy read.
  //
  // ⛔ The case above is left as it was. Narrowing IT to 404 would make this
  // file's anonymity proof fail for reasons belonging to another proof, which
  // is what its own comment warns against.
  it('[#7867] a member hitting the action with a NONEXISTENT record id gets 404 RECORD_NOT_FOUND', async () => {
    const r = await stack.apiAs(memberToken, 'POST', ACTION, { params: {} });

    expect(r.status, 'a ghost record id must answer 404, not a 400 from further down the pipeline').toBe(404);
    const body = (await r.json()) as Record<string, unknown>;
    const err = (isRecord(body.error) ? body.error : {}) as Record<string, unknown>;
    expect(err.code).toBe('RECORD_NOT_FOUND');
    // The dispatcher's wrapper echoes the status it served; both are asserted so
    // a body that says 404 while the response says 400 cannot pass either.
    expect(err.httpStatus).toBe(404);
    // …and specifically NOT the shape this fixture used to tolerate in silence.
    expect(String(err.message ?? '')).not.toMatch(/not bound for this operation/);
    expect(String(err.message ?? '')).not.toMatch(/HookConditionError/);
  });

  it('[#7867] …the SAME answer the REST data surface gives for that same id', async () => {
    // The comparison that made #7867 measurable in the first place: one id, one
    // object, one process, one second — and two surfaces that disagreed
    // (`/actions` → 400, `/data` → 404). Both are asserted here, so they cannot
    // drift apart again without this gate saying so.
    const ghostId = ACTION.slice(ACTION.lastIndexOf('/') + 1);
    const rest = await stack.apiAs(memberToken, 'PATCH', `/data/showcase_task/${ghostId}`, { done: true });

    expect(rest.status).toBe(404);
    const body = (await rest.json()) as Record<string, unknown>;
    // `@objectstack/rest` answers the flat envelope; the dispatcher-mounted
    // `/actions` answers its own wrapper. Different shells, one code — each read
    // in its own shape, with no `??` chain across the two (#5632's rule, which
    // this file already enforces for the 401 bodies).
    expect(body.code).toBe('RECORD_NOT_FOUND');
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

  // ── /packages (dispatcher-mounted; runtime domains/packages.ts) — #7033/#7023 ─
  //
  // The LAST routed domain to join the baseline. Like /automation, the gate is
  // DOMAIN-WIDE and sits ahead of the ObjectQL registry probe, so the 401 an
  // anonymous caller gets cannot be confused with the 503 "Package service not
  // available" the domain answers when no registry is present. The `:id` is a
  // deliberately non-existent package: the floor is the FIRST statement of
  // `handlePackagesRequest`, so an anonymous request is refused before any
  // package is looked up. These four were all measured answering 200 to a
  // guest-principal caller before the fix — two of them DESTRUCTIVE.
  it('anonymous GET /packages is denied (401) — the id enumeration face stays private', async () => {
    const r = await anon('GET', '/packages');
    expect(r.status, 'anonymous package listing must be 401').toBe(401);
  });

  it('anonymous GET /packages/:id/export is denied (401)', async () => {
    const r = await anon('GET', '/packages/anon-probe-pkg/export');
    expect(r.status, 'anonymous package export must be 401').toBe(401);
  });

  it('anonymous POST /packages/:id/discard-drafts is denied (401) — the destructive one', async () => {
    const r = await anon('POST', '/packages/anon-probe-pkg/discard-drafts', {});
    expect(r.status, 'anonymous draft discard must be 401').toBe(401);
  });

  it('anonymous POST /packages/:id/publish-drafts is denied (401) — the #7023 route', async () => {
    const r = await anon('POST', '/packages/anon-probe-pkg/publish-drafts', {});
    expect(r.status, 'anonymous draft publish must be 401').toBe(401);
  });

  it('an authenticated member reaches the packages domain — not 401 (the deny targets anonymity)', async () => {
    // Teeth for the anonymous cases above: the same route, with a session,
    // clears the auth floor. A plain member holds neither `studio.access` nor
    // `setup.access`, so the ADR-0106 D4 read gate then answers 403 — which is
    // exactly NOT 401, and proves the anonymous 401s are the floor's answer, not
    // the capability gate's (drop the floor and the anonymous cases collapse
    // onto the member's 403).
    const r = await stack.apiAs(memberToken, 'GET', '/packages');
    expect(r.status, 'authenticated package listing must clear the auth floor').not.toBe(401);
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
      anon('GET', '/packages').then((r) => r.json()),
      anon('POST', '/packages/anon-probe-pkg/discard-drafts', {}).then((r) => r.json()),
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

  // ── #5632: every 401 body is IN, and only in, one declared envelope ──────
  //
  // The ownership map. `owner` names the producer, so a failure reads as "this
  // seam changed family" rather than "some assertion moved".
  //
  // Coverage, stated as measured rather than as assumed: five dispatcher
  // domains hold an anonymous gate (ai / meta / security / actions /
  // automation) and only the last two are drivable on THIS boot — probed on
  // the same shared showcase stack these cases use:
  //   - `GET /ai/status` answers 501 `NOT_IMPLEMENTED` (no
  //     `@objectstack/service-ai` ships in the open framework, and that
  //     domain's gate sits BEHIND its route match, so it never runs here);
  //   - `GET /security/permissions` answers 404 (the showcase registration
  //     path mounts no `/security`);
  //   - `/meta` on this stack is served by `@objectstack/rest`, so it exercises
  //     the flat family, not the dispatcher's meta domain.
  // The wrapper family is therefore represented by actions + automation. Adding
  // a row is the whole change needed the day another domain becomes reachable.
  const DENIED_SEAMS: Array<{
    seam: string;
    owner: string;
    family: DenyFamily;
    call: () => Promise<Response>;
  }> = [
    { seam: 'GET /meta', owner: '@objectstack/rest enforceAuth', family: 'rest-flat', call: () => anon('GET', '/meta') },
    { seam: `GET ${OBJ}`, owner: '@objectstack/rest enforceAuth', family: 'rest-flat', call: () => anon('GET', OBJ) },
    { seam: 'POST /actions/:object/:action/:id', owner: 'runtime domains/actions.ts', family: 'dispatcher-wrapper', call: () => anon('POST', ACTION, { params: {} }) },
    { seam: 'POST /automation/:name/trigger', owner: 'runtime domains/automation.ts', family: 'dispatcher-wrapper', call: () => anon('POST', `/automation/${FLOW}/trigger`, {}) },
    { seam: 'GET /automation', owner: 'runtime domains/automation.ts', family: 'dispatcher-wrapper', call: () => anon('GET', '/automation') },
    { seam: 'DELETE /automation/:name', owner: 'runtime domains/automation.ts', family: 'dispatcher-wrapper', call: () => anon('DELETE', `/automation/${FLOW}`) },
  ];

  it.each(DENIED_SEAMS)(
    'anonymous $seam denies in exactly one declared envelope — $family, the one $owner writes (#5632)',
    async ({ seam, family, call }) => {
      const res = await call();
      expect(res.status, `${seam}: anonymous must be denied with the shared status`).toBe(ANONYMOUS_DENY_STATUS);

      const body = await res.json();

      // ∈ the two declared shapes, and in ONLY one of them. No match at all =
      // a third dialect reached the wire; the other family = this seam swapped
      // wrappers. Both are red, and the message carries the body that did it.
      expect(
        declaredFamiliesOf(body),
        `${seam}: body must satisfy the ${family} envelope and no other — got ${JSON.stringify(body)}`,
      ).toEqual([family]);

      // Only now the values, read through THAT family's own reader and compared
      // to the exported constants themselves — so this pin follows the constants
      // if they ever move, instead of quietly disagreeing with them.
      const { code, message } = readDenial(family, body);
      expect(code, `${seam}: machine code must be ANONYMOUS_DENY_CODE`).toBe(ANONYMOUS_DENY_CODE);
      expect(message, `${seam}: message must be ANONYMOUS_DENY_MESSAGE`).toBe(ANONYMOUS_DENY_MESSAGE);
    },
  );

  it('`ANONYMOUS_DENY_BODY` is the REST seam body, and NOT the dispatcher one (#5632)', async () => {
    const flat = await anon('GET', '/meta').then((r) => r.json());
    const wrapped = await anon('GET', '/automation').then((r) => r.json());

    // The narrowed docstring's positive claim, on the wire: the exported
    // constant IS what the REST seam writes, whole.
    expect(flat, 'the REST seam must write ANONYMOUS_DENY_BODY verbatim').toEqual(ANONYMOUS_DENY_BODY);

    // ...and its negative half, which is the part that was missing. If the
    // envelope-convergence line (#3843 family) ever lands and the dispatcher
    // adopts the flat body, THIS is the case that goes red and says the comment
    // above `ANONYMOUS_DENY_BODY` is due for a rewrite — the constant would
    // have become platform-wide, which is exactly what it must not claim today.
    expect(wrapped, 'a dispatcher seam must NOT be writing the REST constant').not.toEqual(ANONYMOUS_DENY_BODY);
    expect(declaredFamiliesOf(wrapped)).toEqual(['dispatcher-wrapper']);
  });
});
