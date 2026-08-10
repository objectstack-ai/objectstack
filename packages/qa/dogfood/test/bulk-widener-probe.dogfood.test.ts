// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#6736] PROBE — app-authored RLS wideners on the BULK write path.
//
// ⚠️ This file PINS TODAY'S BEHAVIOUR, and today's behaviour is
// defective-by-declaration. It is NOT a fix and must never be read as one.
// The maintainer's 2026-08-08 ruling on #5493 (Q2 = A1) deliberately deferred
// the only shape that could cover this path — a filter-shaped authored-only
// write `FilterCondition` OR-composed into `buildWriteFilter` — with a stated
// reason: no measured pull. #6736's own acceptance section names the missing
// first step: "An end-to-end probe first (the mechanism above is a code read)."
// This file IS that probe. Its job is to produce the numbers a future pricing
// decision can rest on, and to fail loudly the day the behaviour changes in
// either direction.
//
// ── The claim under test ──────────────────────────────────────────────────
// The bulk write path (`update({multi})` / `delete({multi})`) ANDs
// `SharingService.buildWriteFilter` into the query AST
// (`plugin-sharing/src/sharing-plugin.ts`, the `// Bulk (multi) write` branch).
// An app-authored RLS write-widener lives one layer away — `plugin-security`
// ANDs `computeRlsFilter`'s answer into the SAME `ast.where`
// (`plugin-security/src/security-plugin.ts`, step 3 "RLS filter injection").
// Applicable RLS policies OR-combine, so the widener widens WITHIN the RLS
// layer and is then INTERSECTED with sharing's owner-match. It therefore
// cannot widen the row set at all on this path — and, unlike the by-id half
// (#5493, which refuses loudly with FORBIDDEN), nothing says so: no error, no
// 403, no envelope field, no log on that branch. The statement silently
// touches FEWER rows than the declaration admits.
//
// ── Why the fixture is shaped this way ────────────────────────────────────
// The object is `public_read` (OWD `read`) rather than `private`, deliberately:
//   • `buildReadFilter` returns null for a non-`private` model, so READS are
//     open and cannot confound the measurement. A `private` object would hide
//     the cross-owner rows from the caller entirely, and a bulk write that
//     touched nothing would be explained by read scoping rather than by the
//     write composition — the probe would measure the wrong thing.
//   • `buildWriteFilter` returns the owner-match for BOTH `private` and `read`
//     (only a fully `public` object is write-open — see its doc comment). So on
//     this object the sharing WRITE filter is the ONLY narrowing agent, which
//     is exactly the composition under test, isolated.
//
// ── The discrimination controls ───────────────────────────────────────────
// A bulk count of "1 out of 3" proves nothing on its own: an inert widener
// (never parsed, never applicable) and a fixture that accidentally grants
// ownership would each produce a confident-looking number. Two controls split
// those apart, and both must hold for the headline count to mean anything:
//   C1 the SAME principal, SAME row, SAME widener via the BY-ID path SUCCEEDS
//      (post-#5493 / PR #6909). An inert widener would 403 here.
//   C2 a row the widener does NOT admit is still REFUSED by-id, with the
//      ADR-0112 envelope. A fixture that leaked ownership or disabled the gate
//      would let this through.
// Together: the declaration is live, it is genuinely a widener, its boundary
// is real — and the bulk path still ignores it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineStack, definePermissionSet } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { resolveAuthzContext } from '@objectstack/core';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

// ── the app under probe ────────────────────────────────────────────────────

const OBJECT = 'probe_note';

/**
 * Read-open, write-owned (`public_read` ⇒ effective OWD `read`), with the
 * `owner_id` anchor record sharing enforces on. See the header for why this
 * posture, and not `private`, is what isolates the composition under test.
 */
const ProbeNote = ObjectSchema.create({
  name: OBJECT,
  label: 'Probe Note',
  pluralLabel: 'Probe Notes',
  sharingModel: 'public_read',
  fields: {
    title: Field.text({ label: 'Title', required: true, maxLength: 160 }),
    body: Field.text({ label: 'Body', maxLength: 2000 }),
    stage: Field.text({ label: 'Stage', maxLength: 40 }),
    owner_id: Field.lookup('sys_user', { label: 'Owner' }),
  },
});

/**
 * The app's declaration, in the author's own words: "any holder of this set may
 * UPDATE a note in stage `open`, and DELETE a note in stage `stale`" — said
 * about the ROW, never about its owner. Both policies are APP-AUTHORED (neither
 * is the platform ownership floor `owner_only_writes` / `owner_only_deletes`),
 * which is the provenance `checkAuthoredRowWrite` filters on.
 *
 * Not `isDefault` — it carries `allowDelete`, an anchor-forbidden bit
 * (ADR-0090 D5) — so it is bound directly to the probe members below, exactly
 * as `owner-anchor-and-bulk-writes.dogfood.test.ts` binds its delete grant.
 */
const ProbeWidenerSet = definePermissionSet({
  name: 'probe_widener',
  label: 'Probe — app-authored write wideners',
  objects: {
    [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  rowLevelSecurity: [
    {
      name: 'probe_open_stage_updates',
      object: OBJECT,
      operation: 'update',
      using: "stage == 'open'",
    },
    {
      name: 'probe_stale_stage_deletes',
      object: OBJECT,
      operation: 'delete',
      using: "stage == 'stale'",
    },
  ],
});

const probeApp = defineStack({
  manifest: {
    id: 'com.example.bulkwidenerprobe',
    namespace: 'probe',
    version: '0.0.1',
    type: 'app',
    name: 'Bulk Widener Probe',
    engines: { protocol: '^17' },
  },
  objects: [ProbeNote],
  permissions: [ProbeWidenerSet],
});

const SYS = { isSystem: true } as const;

interface Row { id: string; title: string; stage: string; owner_id: string; body?: string }

describe('[#6736 PROBE] app-authored RLS wideners on the bulk write path', () => {
  let stack: VerifyStack;
  let ql: any;
  let security: any;
  let sharing: any;
  let bobToken: string;
  let bobId: string;
  let aliceId: string;
  let bobCtx: any;

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

  const seed = async (row: Row) =>
    ql.insert(OBJECT, { ...row }, { context: { ...SYS } });

  const rowsBySystem = async (where: Record<string, unknown> = {}): Promise<Row[]> =>
    (await ql.find(OBJECT, { where, context: { ...SYS } })) as Row[];

  const rowById = async (id: string): Promise<Row | null> =>
    (await ql.findOne(OBJECT, { where: { id }, context: { ...SYS } })) as Row | null;

  beforeAll(async () => {
    stack = await bootStack(probeApp, {
      // The app's own set must be resolvable alongside the platform seeds; the
      // fallback stays the platform `member_default` so nothing about this
      // fixture's baseline differs from an ordinary deployment's.
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, ProbeWidenerSet as any],
        fallbackPermissionSet: 'member_default',
      }),
    });
    await stack.signIn();                                   // seed dev admin (platform admin)
    bobToken = await stack.signUp('probe-bob@verify.test');  // plain member
    await stack.signUp('probe-alice@verify.test');           // plain member (row owner only)

    ql = await stack.kernel.getServiceAsync('objectql');
    security = await stack.kernel.getServiceAsync('security');
    sharing = await stack.kernel.getServiceAsync('sharing');

    const uid = async (email: string) =>
      (await ql.findOne('sys_user', { where: { email }, context: { ...SYS } }))?.id;
    bobId = await uid('probe-bob@verify.test');
    aliceId = await uid('probe-alice@verify.test');
    expect(bobId).toBeTruthy();
    expect(aliceId).toBeTruthy();

    const setRow = await ql.findOne('sys_permission_set', {
      where: { name: 'probe_widener' }, context: { ...SYS },
    });
    expect(setRow?.id, 'the app-declared widener set is seeded').toBeTruthy();
    await ql.insert('sys_user_permission_set',
      { user_id: bobId, permission_set_id: setRow.id }, { context: { ...SYS } });

    // UPDATE fixture: three rows the declaration admits (`stage: 'open'`), one
    // of them Bob's; one row it does not admit, to bound the widener.
    await seed({ id: 'n_bob_open',     title: 'bob open',     stage: 'open',   owner_id: bobId,   body: 'seed' });
    await seed({ id: 'n_alice_open_1', title: 'alice open 1', stage: 'open',   owner_id: aliceId, body: 'seed' });
    await seed({ id: 'n_alice_open_2', title: 'alice open 2', stage: 'open',   owner_id: aliceId, body: 'seed' });
    await seed({ id: 'n_alice_closed', title: 'alice closed', stage: 'closed', owner_id: aliceId, body: 'seed' });

    // DELETE fixture, same shape on the delete widener's own stage.
    await seed({ id: 'd_bob_stale',     title: 'bob stale',     stage: 'stale', owner_id: bobId });
    await seed({ id: 'd_alice_stale_1', title: 'alice stale 1', stage: 'stale', owner_id: aliceId });
    await seed({ id: 'd_alice_stale_2', title: 'alice stale 2', stage: 'stale', owner_id: aliceId });

    bobCtx = await authzFor(bobToken);
  }, 180_000);

  afterAll(async () => { await stack?.stop(); });

  // ── probe integrity ──────────────────────────────────────────────────────
  //
  // Everything below is worthless if the fixture quietly handed Bob ownership
  // or the widener never reached the resolver. Assert both BEFORE measuring.

  it('[integrity] Bob holds the app-authored set and owns exactly ONE row of each fixture', async () => {
    expect(bobCtx?.userId, 'the resolved principal is Bob').toBe(bobId);
    expect(bobCtx?.permissions, 'the app-authored set resolved onto the context')
      .toContain('probe_widener');
    expect(bobCtx?.isSystem, 'the probe never runs as system').toBeFalsy();

    const open = await rowsBySystem({ stage: 'open' });
    const stale = await rowsBySystem({ stage: 'stale' });
    expect(open.map((r) => r.id).sort()).toEqual(['n_alice_open_1', 'n_alice_open_2', 'n_bob_open']);
    expect(stale.map((r) => r.id).sort()).toEqual(['d_alice_stale_1', 'd_alice_stale_2', 'd_bob_stale']);
    expect(open.filter((r) => r.owner_id === bobId).map((r) => r.id)).toEqual(['n_bob_open']);
    expect(stale.filter((r) => r.owner_id === bobId).map((r) => r.id)).toEqual(['d_bob_stale']);
  });

  // ── C1 / C2 — the discrimination controls ────────────────────────────────

  it('[C1] the widener is LIVE: by-id, Bob updates a row he does not own but the declaration admits', async () => {
    // Sharing refuses on its own terms; the middleware consults the authored
    // verdict and defers (#5493 step 2 / PR #6909). If the widener were inert
    // — unparsed, inapplicable, wrong object — this would be a 403 and every
    // number below would be meaningless.
    await expect(
      sharing.checkEdit(OBJECT, 'n_alice_open_1', bobCtx),
    ).resolves.toBe('deny');
    await expect(
      security.checkAuthoredRowWrite(OBJECT, 'n_alice_open_1', 'update', bobCtx),
    ).resolves.toBe('admit');

    const res = await stack.apiAs(bobToken, 'PATCH', `/data/${OBJECT}/n_alice_open_1`, { body: 'by-id-widened' });
    expect(res.status, await res.text().catch(() => '')).toBeLessThan(300);
    expect((await rowById('n_alice_open_1'))?.body).toBe('by-id-widened');

    // put it back so the bulk measurement starts from a clean field
    await ql.update(OBJECT, { body: 'seed' }, { where: { id: 'n_alice_open_1' }, context: { ...SYS } });
  });

  it('[C2] the widener has a BOUNDARY: by-id, a row it does NOT admit is still refused (ADR-0112 envelope)', async () => {
    await expect(
      security.checkAuthoredRowWrite(OBJECT, 'n_alice_closed', 'update', bobCtx),
    ).resolves.toBe('abstain');

    const res = await stack.apiAs(bobToken, 'PATCH', `/data/${OBJECT}/n_alice_closed`, { body: 'should-not-land' });
    expect(res.status, 'a row outside the declaration must be refused').toBeGreaterThanOrEqual(400);
    const envelope: any = await res.json().catch(() => ({}));
    expect(
      JSON.stringify(envelope),
      'the refusal carries a real error envelope, not a bare throw',
    ).toMatch(/FORBIDDEN|PERMISSION_DENIED/);
    expect((await rowById('n_alice_closed'))?.body, 'the row is untouched').toBe('seed');
  });

  // ── the measurement ──────────────────────────────────────────────────────

  it('[MEASURE update({multi})] the declaration admits 3 rows; the bulk statement touches 1, silently', async () => {
    const declaredAdmitted: string[] = [];
    for (const id of ['n_bob_open', 'n_alice_open_1', 'n_alice_open_2', 'n_alice_closed']) {
      const verdict = await security.checkAuthoredRowWrite(OBJECT, id, 'update', bobCtx);
      const owned = (await rowById(id))?.owner_id === bobId;
      if (verdict === 'admit' || owned) declaredAdmitted.push(id);
    }

    // The exact narrowing predicate, named rather than inferred.
    const writeFilter = await sharing.buildWriteFilter(OBJECT, bobCtx, 'update');

    let threw: unknown = null;
    let affected: unknown = null;
    try {
      affected = await ql.update(
        OBJECT, { body: 'bulk-widened' },
        { where: { stage: 'open' }, multi: true, context: bobCtx },
      );
    } catch (e) { threw = e; }

    const touched = (await rowsBySystem({ stage: 'open' }))
      .filter((r) => r.body === 'bulk-widened').map((r) => r.id).sort();

    // eslint-disable-next-line no-console
    console.log('[#6736 PROBE update]', JSON.stringify({
      declaredAdmitted, writeFilter, affected, touched,
      threw: threw ? String((threw as Error).message ?? threw) : null,
    }, null, 2));

    expect(declaredAdmitted.sort()).toEqual(['n_alice_open_1', 'n_alice_open_2', 'n_bob_open']);
    expect(threw, 'the narrowing is SILENT — no error, no 403').toBeNull();
    expect(touched, 'ONLY the caller-owned row is touched').toEqual(['n_bob_open']);
    expect(affected, 'the affected-row count is the ONLY signal, and it names no authority').toBe(1);
  });

  it('[MEASURE delete({multi})] same reading on the delete path — 3 admitted, 1 removed, silently', async () => {
    const declaredAdmitted: string[] = [];
    for (const id of ['d_bob_stale', 'd_alice_stale_1', 'd_alice_stale_2']) {
      const verdict = await security.checkAuthoredRowWrite(OBJECT, id, 'delete', bobCtx);
      const owned = (await rowById(id))?.owner_id === bobId;
      if (verdict === 'admit' || owned) declaredAdmitted.push(id);
    }
    const deleteFilter = await sharing.buildWriteFilter(OBJECT, bobCtx, 'delete');

    let threw: unknown = null;
    let affected: unknown = null;
    try {
      affected = await ql.delete(OBJECT, { where: { stage: 'stale' }, multi: true, context: bobCtx });
    } catch (e) { threw = e; }

    const survivors = (await rowsBySystem({ stage: 'stale' })).map((r) => r.id).sort();

    // eslint-disable-next-line no-console
    console.log('[#6736 PROBE delete]', JSON.stringify({
      declaredAdmitted, deleteFilter, affected, survivors,
      threw: threw ? String((threw as Error).message ?? threw) : null,
    }, null, 2));

    expect(declaredAdmitted.sort()).toEqual(['d_alice_stale_1', 'd_alice_stale_2', 'd_bob_stale']);
    expect(threw, 'the narrowing is SILENT on delete too').toBeNull();
    expect(survivors, "the two rows the declaration admits survive").toEqual(['d_alice_stale_1', 'd_alice_stale_2']);
    expect(affected, 'again, only a count').toBe(1);
  });
});
