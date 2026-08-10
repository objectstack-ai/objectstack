// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7281] `checkAuthoredRowWrite` answers the DECLARATION, not the caller's
// read scope — pinned on the REAL stack.
//
// ── Why this file exists at all ───────────────────────────────────────────
// The unit file that was supposed to cover this — `plugin-security`'s
// `row-write-widener-composition.test.ts` — cannot see the behaviour under
// test. Its `makeEngine()` fake implements `find` as a direct row filter with
// NO middleware chain, so the re-read inside `checkAuthoredRowWrite` is never
// scoped by `plugin-sharing`'s read filter. The producer's verdict on a
// `private`-OWD object depends on precisely that scoping, so the double was
// looser than the producer on the one axis the verdict turns on, and the file
// was green over behaviour the real stack did not have (#7281, and the
// maintainer's 2026-08-10 ruling: "fix the unit test half — independently and
// first"). This file is the real-stack pin that ruling names: real `bootStack`,
// real `SecurityPlugin`, real `SharingServicePlugin`, real ObjectQL engine,
// real middleware chain — the harness idiom of `bulk-widener-probe.dogfood.test.ts`.
//
// ── The mechanism ─────────────────────────────────────────────────────────
// `checkAuthoredRowWrite` resolves "does an app-authored widener admit this
// row" by re-reading the row behind `{id} AND layer0(tenant) AND layer1(authored)`.
// That `findOne` re-enters the middleware chain. Under the CALLER's own context
// it therefore also picks up `plugin-sharing`'s READ filter, which on a
// `private` OWD scopes to owner-match OR shares — so a cross-owner row is
// invisible, `findOne` answers null, and the verdict is `abstain` for a row the
// declaration names. The by-id widener was structurally dead on `private`, the
// posture #5493's widener surface was built for. The ruled fix resolves that
// probe read under an ELEVATED scope, leaving `{id} AND layer0 AND layer1` as
// the whole of the predicate — the tenant wall included, since it lives in the
// `where` and not in the read scope.
//
// ── The discriminator, isolated ───────────────────────────────────────────
// TWO objects, identical in every respect except the OWD; the SAME widener
// text, the SAME principal, the SAME cross-owner row shape. Whatever separates
// their verdicts is the OWD and nothing else.
//
//   `wscope_note`   sharingModel 'public_read'  -> buildReadFilter returns null
//   `wscope_secret` sharingModel 'private'      -> buildReadFilter scopes to owner
//
// ── What the no-leak cases are for ────────────────────────────────────────
// An elevated read inside a permission check is exactly the shape that has to
// be PROVEN not to widen anything. The maintainer's ruling states the safety
// argument ("No leak either way: the final write gate still enforces"); the
// `[no-leak N]` cases below are that argument measured rather than assumed —
// a row the declaration does not admit, a principal holding no widener at all,
// the caller's own read scope after the probe has run, and the end-to-end write
// on both postures.
//
// ── which cases MOVE, and which are green on both sides by design ─────────
// Exactly two assertions change with #7281: `[B private]` and the verdict
// assertion opening `[E2E private]` (both measured `abstain` against the
// pre-#7281 producer, both `admit` after). EVERY other case here — the two
// controls and all six `[no-leak N]` cases — is green on BOTH sides, and that
// invariance IS the safety claim rather than a gap in coverage: an elevated
// read inside a permission check is only safe if nothing else moves. They are
// reverse-verified by mutating what they guard, not by reverting the fix.
//
// ⚠️ READ THIS BEFORE TRUSTING A GREEN RUN ⚠️
// `[E2E private]` pins that the by-id WRITE is still refused on `private` even
// once the verdict says `admit`, and that the refusal comes from the security
// by-id write PRE-IMAGE gate (`security-plugin.ts`, step 2.7) — which performs
// its OWN `findOne` under `opCtx.context` and is blind to the same cross-owner
// row for the same reason the probe used to be — BEFORE the sharing middleware
// is reached at all. The ruling moved the PROBE's scope and deliberately left
// the write decision with that gate, so #7281 fixes the VERDICT and its
// end-to-end consequence on `private` is nil. That is stated here, in the file,
// and not only in a PR body, because a reader who assumes otherwise will
// mis-read every case below. Whether that gate should also stop conflating
// "cannot read" with "cannot write" is a separate contract question and is NOT
// settled by this ruling.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineStack, definePermissionSet } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { resolveAuthzContext } from '@objectstack/core';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

// ── the two objects under probe ────────────────────────────────────────────

const OPEN = 'wscope_note';    // OWD public_read — reads are open
const CLOSED = 'wscope_secret'; // OWD private     — reads are owner-scoped

const commonFields = () => ({
  title: Field.text({ label: 'Title', required: true, maxLength: 160 }),
  body: Field.text({ label: 'Body', maxLength: 2000 }),
  stage: Field.text({ label: 'Stage', maxLength: 40 }),
  owner_id: Field.lookup('sys_user', { label: 'Owner' }),
});

/** Read-open. `buildReadFilter` returns null for a non-`private` model. */
const OpenNote = ObjectSchema.create({
  name: OPEN,
  label: 'Widener Scope Note',
  pluralLabel: 'Widener Scope Notes',
  sharingModel: 'public_read',
  fields: commonFields(),
});

/**
 * Read-closed — the posture #5493's widener surface was built for, and the ONLY
 * difference from `OpenNote`. Ordinary tenant business object (no
 * `access.default: 'private'`), so the ADR-0066 ① superuser short-circuit is
 * withheld and the app policy is really the thing being asked.
 */
const SecretNote = ObjectSchema.create({
  name: CLOSED,
  label: 'Widener Scope Secret',
  pluralLabel: 'Widener Scope Secrets',
  sharingModel: 'private',
  fields: commonFields(),
});

/**
 * The app's declaration, in the author's own words: "any holder of this set may
 * UPDATE a note in stage `open`" — said about the ROW, never about its owner,
 * and said identically about both objects. App-authored (neither policy is the
 * platform ownership floor `owner_only_writes`), which is the provenance
 * `checkAuthoredRowWrite` filters on.
 */
const WidenerSet = definePermissionSet({
  name: 'wscope_widener',
  label: 'Widener Scope — app-authored update widener',
  objects: {
    [OPEN]: { allowRead: true, allowCreate: true, allowEdit: true },
    [CLOSED]: { allowRead: true, allowCreate: true, allowEdit: true },
  },
  rowLevelSecurity: [
    { name: 'wscope_open_stage_updates_note', object: OPEN, operation: 'update', using: "stage == 'open'" },
    { name: 'wscope_open_stage_updates_secret', object: CLOSED, operation: 'update', using: "stage == 'open'" },
  ],
});

/**
 * The no-widener control principal's set: byte-identical object CRUD, and NO
 * row-level declaration at all. It exists so `[no-leak 2]` varies exactly one
 * thing — the declaration — rather than varying CRUD rights and calling the
 * difference a widener.
 */
const PlainSet = definePermissionSet({
  name: 'wscope_plain',
  label: 'Widener Scope — same CRUD, no declaration',
  objects: {
    [OPEN]: { allowRead: true, allowCreate: true, allowEdit: true },
    [CLOSED]: { allowRead: true, allowCreate: true, allowEdit: true },
  },
});

const probeApp = defineStack({
  manifest: {
    id: 'com.example.authoredrowwritescope',
    namespace: 'wscope',
    version: '0.0.1',
    type: 'app',
    name: 'Authored Row-Write Scope Probe',
    engines: { protocol: '^17' },
  },
  objects: [OpenNote, SecretNote],
  permissions: [WidenerSet, PlainSet],
});

const SYS = { isSystem: true } as const;

interface Row { id: string; title: string; stage: string; owner_id: string; body?: string }

/** Row ids, per object — same shapes on both so the postures stay comparable. */
const ids = (object: string) => ({
  mine: `${object}_bob_open`,
  theirsAdmitted: `${object}_alice_open`,
  theirsOutside: `${object}_alice_closed`,
});

describe('[#7281] checkAuthoredRowWrite answers the declaration, not the caller read scope', () => {
  let stack: VerifyStack;
  let ql: any;
  let security: any;
  let sharing: any;
  let bobToken: string;
  let carolToken: string;
  let bobId: string;
  let aliceId: string;
  let carolId: string;
  let bobCtx: any;
  let carolCtx: any;

  /** The SAME authz context the REST entry point builds — never a hand-rolled principal. */
  const authzFor = async (token: string) => {
    const authService: any = await stack.kernel.getServiceAsync('auth');
    let api: any = authService?.api;
    if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
    const headers = new Headers({ authorization: `Bearer ${token}` });
    return resolveAuthzContext({
      ql,
      headers,
      getSession: async (h: any) => api?.getSession?.({ headers: h }),
    });
  };

  const seed = async (object: string, row: Row) =>
    ql.insert(object, { ...row }, { context: { ...SYS } });

  const rowById = async (object: string, id: string): Promise<Row | null> =>
    (await ql.findOne(object, { where: { id }, context: { ...SYS } })) as Row | null;

  beforeAll(async () => {
    stack = await bootStack(probeApp, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, WidenerSet as any, PlainSet as any],
        fallbackPermissionSet: 'member_default',
      }),
    });
    await stack.signIn();                                     // dev admin seed
    bobToken = await stack.signUp('wscope-bob@verify.test');   // holds the widener
    carolToken = await stack.signUp('wscope-carol@verify.test'); // same CRUD, no widener
    await stack.signUp('wscope-alice@verify.test');            // row owner only

    ql = await stack.kernel.getServiceAsync('objectql');
    security = await stack.kernel.getServiceAsync('security');
    sharing = await stack.kernel.getServiceAsync('sharing');

    const uid = async (email: string) =>
      (await ql.findOne('sys_user', { where: { email }, context: { ...SYS } }))?.id;
    bobId = await uid('wscope-bob@verify.test');
    carolId = await uid('wscope-carol@verify.test');
    aliceId = await uid('wscope-alice@verify.test');
    expect(bobId).toBeTruthy();
    expect(carolId).toBeTruthy();
    expect(aliceId).toBeTruthy();

    const bindSet = async (userId: string, name: string) => {
      const setRow = await ql.findOne('sys_permission_set', { where: { name }, context: { ...SYS } });
      expect(setRow?.id, `the app-declared set '${name}' is seeded`).toBeTruthy();
      await ql.insert('sys_user_permission_set',
        { user_id: userId, permission_set_id: setRow.id }, { context: { ...SYS } });
    };
    await bindSet(bobId, 'wscope_widener');
    await bindSet(carolId, 'wscope_plain');

    for (const object of [OPEN, CLOSED]) {
      const id = ids(object);
      await seed(object, { id: id.mine, title: 'bob open', stage: 'open', owner_id: bobId, body: 'seed' });
      await seed(object, { id: id.theirsAdmitted, title: 'alice open', stage: 'open', owner_id: aliceId, body: 'seed' });
      await seed(object, { id: id.theirsOutside, title: 'alice closed', stage: 'closed', owner_id: aliceId, body: 'seed' });
    }

    bobCtx = await authzFor(bobToken);
    carolCtx = await authzFor(carolToken);
  }, 180_000);

  afterAll(async () => { await stack?.stop(); });

  // ── integrity ─────────────────────────────────────────────────────────────
  //
  // Every number below is worthless if the fixture quietly handed Bob
  // ownership, the widener never reached the resolver, or the two objects
  // differ by more than their OWD. Assert all three BEFORE measuring.

  it('[integrity] the principals, the declaration, and the ONE difference between the two objects', async () => {
    expect(bobCtx?.userId, 'the resolved principal is Bob').toBe(bobId);
    expect(bobCtx?.permissions, 'the app-authored set resolved onto the context')
      .toContain('wscope_widener');
    expect(bobCtx?.isSystem, 'the probe never runs as system').toBeFalsy();
    expect(carolCtx?.userId).toBe(carolId);
    expect(carolCtx?.permissions).toContain('wscope_plain');
    expect(carolCtx?.permissions, 'the control principal holds NO widener').not.toContain('wscope_widener');

    for (const object of [OPEN, CLOSED]) {
      const id = ids(object);
      expect((await rowById(object, id.mine))?.owner_id, `${object}: Bob owns exactly the one row`).toBe(bobId);
      expect((await rowById(object, id.theirsAdmitted))?.owner_id).toBe(aliceId);
      expect((await rowById(object, id.theirsOutside))?.owner_id).toBe(aliceId);
    }

    // The discriminator, named rather than inferred: the sharing READ filter is
    // the only thing that differs between the two objects for this caller.
    expect(
      await sharing.buildReadFilter(OPEN, bobCtx),
      'public_read: reads are open, so nothing scopes the probe re-read',
    ).toBeNull();
    expect(
      await sharing.buildReadFilter(CLOSED, bobCtx),
      'private: reads are owner-scoped, which is what removed the verdict',
    ).toMatchObject({ owner_id: bobId });

    // And it really bites on reads: Bob cannot see Alice's row on `private`.
    const seen = await ql.find(CLOSED, { where: {}, context: bobCtx });
    expect(seen.map((r: Row) => r.id).sort(), 'Bob reads only his own row on the private object')
      .toEqual([ids(CLOSED).mine]);
  });

  // ── the measurement ───────────────────────────────────────────────────────

  it('[A public_read] the declaration admits the cross-owner row → admit', async () => {
    await expect(
      security.checkAuthoredRowWrite(OPEN, ids(OPEN).theirsAdmitted, 'update', bobCtx),
    ).resolves.toBe('admit');
  });

  it('⭐ [B private] the SAME declaration, the SAME row shape, the SAME principal → admit', async () => {
    // THE pin. Against the pre-#7281 producer this case is RED, measuring
    // `abstain`: the probe re-read ran under Bob's own context, the sharing
    // read filter scoped it to `owner_id = bob`, and the row the declaration
    // names by predicate was invisible to the question asked about it.
    await expect(
      security.checkAuthoredRowWrite(CLOSED, ids(CLOSED).theirsAdmitted, 'update', bobCtx),
    ).resolves.toBe('admit');
  });

  it('[control] on that same private object, Bob\'s OWN admitted row → admit (the declaration is live either way)', async () => {
    // Rules out "the widener is inert / mis-parsed on this object". If this
    // were `abstain` too, case B would be measuring a broken declaration
    // rather than the read scope.
    await expect(
      security.checkAuthoredRowWrite(CLOSED, ids(CLOSED).mine, 'update', bobCtx),
    ).resolves.toBe('admit');
  });

  // ── no-leak: the elevated read must widen NOTHING ─────────────────────────

  it('[no-leak 1] a row the declaration does NOT admit stays `abstain` — on BOTH postures', async () => {
    // The elevated read must not turn "invisible" into "permitted". `stage`
    // is 'closed', so layer1 does not match and no read scope is involved in
    // the answer at all.
    for (const object of [OPEN, CLOSED]) {
      await expect(
        security.checkAuthoredRowWrite(object, ids(object).theirsOutside, 'update', bobCtx),
        `${object}: outside the declaration`,
      ).resolves.toBe('abstain');
    }
  });

  it('[no-leak 2] a principal with the SAME CRUD and NO declaration gains nothing — every row, both postures', async () => {
    for (const object of [OPEN, CLOSED]) {
      const id = ids(object);
      for (const target of [id.mine, id.theirsAdmitted, id.theirsOutside]) {
        await expect(
          security.checkAuthoredRowWrite(object, target, 'update', carolCtx),
          `${object}/${target}: no authored policy can admit anything`,
        ).resolves.toBe('abstain');
      }
    }
  });

  it('[no-leak 3] the verdict is the whole answer — no row data crosses the boundary', async () => {
    const verdict = await security.checkAuthoredRowWrite(
      CLOSED, ids(CLOSED).theirsAdmitted, 'update', bobCtx,
    );
    expect(typeof verdict, 'a string from the closed vocabulary, never a row').toBe('string');
    expect(['admit', 'abstain']).toContain(verdict);
  });

  it('[no-leak 4] the elevation is confined to the probe: the caller context and the caller read scope are unchanged', async () => {
    const before = JSON.parse(JSON.stringify(bobCtx));
    await security.checkAuthoredRowWrite(CLOSED, ids(CLOSED).theirsAdmitted, 'update', bobCtx);
    await security.checkAuthoredRowWrite(OPEN, ids(OPEN).theirsAdmitted, 'update', bobCtx);

    expect(JSON.parse(JSON.stringify(bobCtx)), 'the caller context is not mutated by the probe')
      .toEqual(before);
    expect((bobCtx as any).isSystem, 'no elevation is stamped onto the caller').toBeFalsy();

    // The caller's own read scope after the probe has run is what it was before.
    const seen = await ql.find(CLOSED, { where: {}, context: bobCtx });
    expect(seen.map((r: Row) => r.id).sort(), 'still only his own row').toEqual([ids(CLOSED).mine]);
    expect(
      await ql.findOne(CLOSED, { where: { id: ids(CLOSED).theirsAdmitted }, context: bobCtx }),
      'the row the verdict admits is STILL invisible to the caller as a read',
    ).toBeFalsy();
  });

  it('[no-leak 5] a row outside the declaration is still REFUSED end-to-end, on both postures (ADR-0112 envelope)', async () => {
    for (const object of [OPEN, CLOSED]) {
      const target = ids(object).theirsOutside;
      const res = await stack.apiAs(bobToken, 'PATCH', `/data/${object}/${target}`, { body: 'should-not-land' });
      expect(res.status, `${object}: a row outside the declaration must be refused`).toBeGreaterThanOrEqual(400);
      const envelope: any = await res.json().catch(() => ({}));
      expect(
        JSON.stringify(envelope),
        `${object}: the refusal carries a real error envelope, not a bare throw`,
      ).toMatch(/FORBIDDEN|PERMISSION_DENIED/);
      expect((await rowById(object, target))?.body, `${object}: the row is untouched`).toBe('seed');
    }
  });

  it('[E2E public_read] the widener is LIVE end-to-end where the caller can read the row', async () => {
    // The posture on which #5493's by-id deferral actually functions, and the
    // control that makes `[E2E private]` below mean something: an identical
    // declaration on a read-open object lands the write. Sharing still refuses
    // on its own terms; the deferral consults the verdict and stands down.
    const target = ids(OPEN).theirsAdmitted;
    await expect(sharing.checkEdit(OPEN, target, bobCtx)).resolves.toBe('deny');
    await expect(security.checkAuthoredRowWrite(OPEN, target, 'update', bobCtx)).resolves.toBe('admit');

    const res = await stack.apiAs(bobToken, 'PATCH', `/data/${OPEN}/${target}`, { body: 'e2e-open' });
    expect(res.status, await res.text().catch(() => '')).toBeLessThan(300);
    expect((await rowById(OPEN, target))?.body).toBe('e2e-open');

    // restore, so ordering between cases cannot smuggle a result
    await ql.update(OPEN, { body: 'seed' }, { where: { id: target }, context: { ...SYS } });
  });

  it('⚠️ [E2E private] the verdict now admits — and the WRITE is still refused, by the pre-image gate', async () => {
    // ── READ THIS BEFORE CHANGING THIS CASE ────────────────────────────────
    // This is NOT the widener being ignored, and it is NOT #7281 unfixed. The
    // maintainer's ruling moved the PROBE's read scope and left the write
    // decision with the pre-image gate. That gate — `security-plugin.ts`
    // step 2.7 — resolves the write with its OWN `findOne` under `opCtx.context`,
    // the caller's context, which on a `private` OWD is scoped by the sharing
    // READ filter for exactly the reason the probe used to be. So it refuses,
    // and it refuses FIRST: the 403 below carries the row-level gate's sentence
    // and `PERMISSION_DENIED`, not the sharing middleware's `FORBIDDEN`, which
    // means the deferral this verdict feeds is never even reached on this
    // posture. Measured, both before and after #7281.
    //
    // Two consequences, stated so nobody has to re-derive them:
    //   • the verdict fix is real and pinned by case [B private] above — the
    //     contract question "does the declaration admit this row" is answered
    //     correctly now, and no consumer is misled by an `abstain` that only
    //     described the caller's eyesight;
    //   • whether a by-id write should LAND on `private` for a row the caller
    //     cannot read is a separate contract question about the pre-image
    //     gate's read scope ("may you write what you cannot read"), and it is
    //     NOT settled by #7281's ruling. This case pins the answer as it
    //     stands today so that changing it is a deliberate act with a red test
    //     to justify, rather than a silent side effect.
    const target = ids(CLOSED).theirsAdmitted;
    await expect(security.checkAuthoredRowWrite(CLOSED, target, 'update', bobCtx)).resolves.toBe('admit');

    const res = await stack.apiAs(bobToken, 'PATCH', `/data/${CLOSED}/${target}`, { body: 'e2e-secret' });
    expect(res.status, 'still refused — the pre-image gate reads as the caller').toBe(403);
    const envelope: any = await res.json().catch(() => ({}));
    expect(envelope?.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
    expect(
      String(envelope?.error ?? ''),
      'the row-level gate refused, NOT the sharing middleware (that shape would be `FORBIDDEN: insufficient privileges`)',
    ).toContain(`not permitted to update this '${CLOSED}' record (row-level security)`);
    expect((await rowById(CLOSED, target))?.body, 'the row is untouched').toBe('seed');
  });

  it('[no-leak 6] the no-declaration principal is still REFUSED end-to-end on the row the WIDENER admits', async () => {
    for (const object of [OPEN, CLOSED]) {
      const target = ids(object).theirsAdmitted;
      const before = (await rowById(object, target))?.body;
      const res = await stack.apiAs(carolToken, 'PATCH', `/data/${object}/${target}`, { body: 'carol-should-not-land' });
      expect(res.status, `${object}: Carol declares nothing and must be refused`).toBeGreaterThanOrEqual(400);
      const envelope: any = await res.json().catch(() => ({}));
      expect(JSON.stringify(envelope)).toMatch(/FORBIDDEN|PERMISSION_DENIED/);
      expect((await rowById(object, target))?.body, `${object}: the row is untouched`).toBe(before);
    }
  });
});
