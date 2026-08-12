// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8119] The SINGLE-record sharing gates on a FEDERATED object, measured on a
 * REAL boot — the measurement the card asked for, and the one refusal it
 * authorised.
 *
 * ## Why this file had to boot something
 *
 * #8119 was filed as a **code-path reading**, and said so: unlike #7858, whose
 * body carried booted-stack filter output, nobody had run a federated
 * single-record write. Its central premise — what a driver does with a
 * nonexistent column in the SELECT LIST (as opposed to #7858's measured
 * comparison-position degradation) — was explicitly unverified and expected to
 * be dialect-dependent. The card offered two possibilities: the driver raises
 * and `writeGateFailClosed` denies, or the value comes back absent and
 * `matchesOwnerScope` returns false.
 *
 * Measured here, on SQLite, it is **neither cleanly** — the projection itself is
 * discarded:
 *
 * ```
 *   find(measure_ext_nostamp, { where:{id:'c1'}, fields:['id','name'] })
 *     -> keys [id, name]                                   projection HONOURED
 *   find(measure_ext_nostamp, { where:{id:'c1'}, fields:['id','owner_id'] })
 *     -> keys [id, created_at, updated_at, name, email, region, lifetime_value]
 *        hasOwnProperty('owner_id') === false              projection DISCARDED
 *   NO throw.
 * ```
 *
 * So the second branch is what runs, and it runs SILENTLY: `writeGateFailClosed`
 * is never reached, nothing is logged, and both gates deny. The consequence the
 * card could not know: the refusal is **not depth-dependent**. `matchesOwnerScope`
 * short-circuits on `owner == null` BEFORE it consults `__writeScope`, so even an
 * `org`-scope caller is refused; only the `modifyAllRecords` bypass reaches
 * `allow`, and it does so without reading a share row at all.
 *
 * ## What this file changes, and what it deliberately does not
 *
 * `assertSharingEnforced` — and ONLY it. Pre-fix, an admin's `grant()` on such an
 * object minted a real `sys_record_share` row (measured; the row is reproduced in
 * the case below). That row is inert BY CONSTRUCTION: no verdict can consult it.
 * Refusing it is the ADR-0078 silently-inert trap ADR-0111 D7 already closes for
 * public and owner-less objects, applied to the one case `hasOwnerField` answers
 * YES about a column that is not there.
 *
 * ⛔ `checkEdit` / `checkDelete` are pinned UNCHANGED. They refuse today, which is
 * fail-closed and safe; widening them to `abstain` hands the row to another
 * authority and can turn a refusal into an allow. That is a decision recorded on
 * #8119, not a rider on this guard.
 *
 * ## Why the fixture is not the shipped federated object
 *
 * Both shipped showcase federated objects carry the ADR-0090 D1 grandfather stamp
 * (`public_read_write`), which `effectiveSharingModel` collapses to `public` — so
 * they return at a gate ABOVE the phantom-anchor line and cannot exercise it at
 * all. A fixture built on them would pass against the broken build. The object
 * registered here leaves `sharingModel` unset and therefore takes the
 * secure-default `private` OWD — what an app author gets by declaring nothing.
 * The stamped object is kept as the no-change control instead.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { resolveAuthzContext } from '@objectstack/core';
import {
  platformProvisionsStorage,
  resolveInjectedColumnProvenance,
  unprovisionedInjectedColumns,
} from '@objectstack/metadata-core';
import type { IObjectQLEngine, ISharingService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { ServiceObject } from '@objectstack/spec/data';

/** An UNSTAMPED federated object over the showcase's real external SQLite DB. */
const FEDERATED = 'measure_ext_nostamp';
/** The shipped, GRANDFATHERED federated object — the no-change control. */
const STAMPED = 'showcase_ext_customer';
/** A LOCAL private object — the control whose `owner_id` is real. */
const LOCAL = 'showcase_private_note';
/** A row that really exists in the remote `customers` table (fixture seed). */
const REMOTE_ID = 'c1';

const SYS = { isSystem: true } as ExecutionContext;

/**
 * The runtime-registration slice of the engine. `IObjectQLEngine` does not
 * declare `registry`, and this is the same narrow structural widening
 * `storage-growth.dogfood.test.ts` uses for the identical need — not an erasure.
 */
interface RegistrarEngine {
  registry: { registerObject(schema: Record<string, unknown>): unknown };
  syncObjectSchema(name: string): Promise<void>;
}

/** Build the write context the sharing gates read, naming the seam it crosses. */
function writeCtx(userId: string, scope: string): ExecutionContext {
  // `__writeScope` is stamped onto the context by plugin-security's middleware
  // and is deliberately NOT a field of `ExecutionContext` (publishing it would
  // make a middleware seam authorable). Naming the bypass beats `as any`.
  return { userId, __writeScope: scope } as unknown as ExecutionContext;
}

function keysOfFirst(rows: unknown): string[] {
  const first = Array.isArray(rows) ? rows[0] : undefined;
  return first && typeof first === 'object' ? Object.keys(first as object) : [];
}

describe('[#8119] federated phantom anchor: single-record gates + share posture', () => {
  let stack: VerifyStack;
  let ql: IObjectQLEngine;
  let sharing: ISharingService;
  let adminCtx: ExecutionContext;
  let adminId: string;
  let adminToken: string;
  let localNoteId: string;

  beforeAll(async () => {
    // Provision the "remote" database (the showcase's own fixture provisioner),
    // then boot the real app.
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootStack(showcaseStack, { multiTenant: 'posture-only' });
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    sharing = stack.kernel.getService<ISharingService>('sharing');

    // Registered against the LIVE registry, so `applySystemFields` injects the
    // anchors exactly as it would for an authored object — nothing here builds a
    // schema by hand.
    const registrar = ql as unknown as RegistrarEngine;
    registrar.registry.registerObject({
      name: FEDERATED,
      label: 'Unstamped federated customer',
      datasource: 'showcase_external',
      external: { remoteName: 'customers' },
      fields: {
        name: { type: 'text', label: 'Name' },
        email: { type: 'text', label: 'Email' },
        region: { type: 'text', label: 'Region' },
      },
    });
    await registrar.syncObjectSchema(FEDERATED);

    adminToken = await stack.signIn();
    adminCtx = await resolveAuthzContext({
      ql,
      headers: new Headers({ authorization: `Bearer ${adminToken}` }),
      getSession: async (h: unknown) => {
        const authService = await stack.kernel.getServiceAsync<{
          api?: { getSession?(a: { headers: unknown }): Promise<unknown> };
          getApi?(): Promise<{ getSession?(a: { headers: unknown }): Promise<unknown> }>;
        }>('auth');
        const api = authService?.api ?? (await authService?.getApi?.());
        return api?.getSession?.({ headers: h });
      },
    } as never) as ExecutionContext;
    adminId = String(adminCtx.userId);
    expect(adminId, 'a real signed-in admin principal').toBeTruthy();

    // A LOCAL private record for the live-share control, created through the
    // REAL HTTP path as the admin. Deliberately not a system-context `insert`:
    // the management gate's record-visibility probe runs under the CALLER's
    // context (so ownership scoping and object CRUD both apply to it), and a
    // row seeded around that path is invisible to the very caller that must
    // manage it — which is a property of the seeding, not of sharing.
    const created = await stack.apiAs(adminToken, 'POST', `/data/${LOCAL}`, {
      title: '#8119 control note', body: 'live share control',
    });
    expect(created.status, 'admin creates the control note').toBeLessThan(300);
    const createdBody = await created.json() as Record<string, unknown>;
    localNoteId = String(
      createdBody?.id
      ?? (createdBody?.record as Record<string, unknown> | undefined)?.id
      ?? (createdBody?.data as Record<string, unknown> | undefined)?.id
      ?? '',
    );
    expect(localNoteId, 'control note created').toBeTruthy();
    // The owner anchor is auto-stamped to the creating user (ADR-0056).
    const seeded = await ql.find(LOCAL, {
      where: { id: localNoteId }, fields: ['id', 'owner_id'], limit: 1, context: SYS,
    });
    expect((seeded as Array<Record<string, unknown>>)[0]?.owner_id).toBe(adminId);
  }, 180_000);

  afterAll(async () => { await stack?.stop?.(); });

  describe('PREMISE — the state of the tree this fix was written against', () => {
    it('the registry injects a phantom `owner_id` into the unstamped federated object', () => {
      const schema = ql.getSchema(FEDERATED) as ServiceObject | undefined;
      expect(schema?.external, `${FEDERATED} must be federated`).toBeTruthy();
      // No grandfather stamp ⇒ the secure-default `private` OWD (ADR-0090 D1),
      // which is what makes the phantom-anchor line reachable at all.
      expect((schema as { sharingModel?: unknown } | undefined)?.sharingModel).toBeUndefined();
      expect(Object.keys((schema as { fields: Record<string, unknown> }).fields)).toContain('owner_id');
    });

    it('the platform provisions no storage for it, so the anchor is unprovisioned', () => {
      const federated = ql.getSchema(FEDERATED);
      const local = ql.getSchema(LOCAL);
      expect(platformProvisionsStorage(federated)).toBe(false);
      expect(platformProvisionsStorage(local)).toBe(true);
      expect(unprovisionedInjectedColumns(federated)).toContain('owner_id');
      // CONTROL: the local object's anchors are real columns.
      expect(unprovisionedInjectedColumns(local)).toEqual([]);
    });

    it('#7865 marker agreement: the anchor reads `injected-unprovisioned`', () => {
      // Recorded because #8115 landed the marker 38 minutes after #7858 shipped
      // this plugin's hand-rolled `hasPhantomOwnerAnchor`. Direction B has
      // consumers converge on the marker AS THEY ARE TOUCHED; this case is the
      // evidence that converging would be behaviour-preserving here, so the
      // decision not to rewrite the shared helper in this card is a measured one
      // rather than an assumption. The local control declares its own `owner_id`
      // (see `private-note.object.ts`), which is why it reads `author`.
      expect(resolveInjectedColumnProvenance(ql.getSchema(FEDERATED), 'owner_id'))
        .toBe('injected-unprovisioned');
      expect(resolveInjectedColumnProvenance(ql.getSchema(LOCAL), 'owner_id')).toBe('author');
    });
  });

  describe('PHASE 1 — what the driver really does with the phantom column', () => {
    it('a projection naming only REAL columns is honoured', async () => {
      const rows = await ql.find(FEDERATED, {
        where: { id: REMOTE_ID }, fields: ['id', 'name'], limit: 1, context: SYS,
      });
      expect(keysOfFirst(rows)).toEqual(['id', 'name']);
    });

    it('a projection naming the PHANTOM column is DISCARDED — and does not throw', async () => {
      // The card's unverified premise, answered. This is the whole reason the
      // refusal below is silent: no error ever reaches `writeGateFailClosed`.
      const rows = await ql.find(FEDERATED, {
        where: { id: REMOTE_ID }, fields: ['id', 'owner_id'], limit: 1, context: SYS,
      });
      const keys = keysOfFirst(rows);
      expect(keys.length, 'the whole row comes back, not the 2-column projection')
        .toBeGreaterThan(2);
      expect(keys).toContain('name');
      expect(keys).not.toContain('owner_id');
      // …and the value the ownership fast-path reads is therefore absent.
      const first = (rows as Array<Record<string, unknown>>)[0];
      expect(Object.prototype.hasOwnProperty.call(first, 'owner_id')).toBe(false);
    });

    it('the record itself is perfectly readable — it is only the anchor that is not', async () => {
      // Anti-vacuity for the case above: "no owner_id" must not be "no row".
      const rows = await ql.find(FEDERATED, { where: { id: REMOTE_ID }, limit: 1, context: SYS });
      expect(Array.isArray(rows) && rows.length).toBe(1);
    });
  });

  describe('PHASE 1 — the gates refuse (measured, and pinned UNCHANGED)', () => {
    it.each(['own', 'unit', 'unit_and_below', 'org'])(
      'checkEdit denies at __writeScope=%s',
      async (scope) => {
        expect(await sharing.checkEdit(FEDERATED, REMOTE_ID, writeCtx('usr_measure_member', scope)))
          .toBe('deny');
      },
    );

    it.each(['own', 'org'])('checkDelete denies at __writeScope=%s', async (scope) => {
      expect(await sharing.checkDelete(FEDERATED, REMOTE_ID, writeCtx('usr_measure_member', scope)))
        .toBe('deny');
    });

    it('ANTI-VACUITY: the same gates ALLOW on a local record the caller owns', async () => {
      // Without this the block above would read identically if the gates denied
      // everything — the fixture-that-cannot-fail shape.
      const ctx = writeCtx(adminId, 'own');
      expect(await sharing.checkEdit(LOCAL, localNoteId, ctx)).toBe('allow');
      expect(await sharing.checkDelete(LOCAL, localNoteId, ctx)).toBe('allow');
      expect(await sharing.checkEdit(LOCAL, localNoteId, writeCtx('usr_not_the_owner', 'own')))
        .toBe('deny');
    });

    it('the `modifyAllRecords` bypass is the ONLY route to allow on the federated object', async () => {
      // A real platform admin — the bypass answers before ownership is consulted,
      // which is why the refusal above is not "sharing is broken here".
      expect(await sharing.checkEdit(FEDERATED, REMOTE_ID, adminCtx)).toBe('allow');
    });
  });

  describe('PHASE 2 — no share row may be minted on a phantom anchor', () => {
    it('grant() refuses, and persists nothing', async () => {
      // Pre-fix this RESOLVED with a real row:
      //   { id: 'shr_…', object_name: 'measure_ext_nostamp', record_id: 'c1',
      //     recipient_id: '<admin>', access_level: 'edit', source: 'manual' }
      // …which no verdict above can ever consult.
      await expect(
        sharing.grant(
          { object: FEDERATED, recordId: REMOTE_ID, recipientId: adminId, accessLevel: 'edit' },
          adminCtx,
        ),
      ).rejects.toThrow(/SHARING_NOT_ENABLED/);

      const rows = await ql.find('sys_record_share', {
        where: { object_name: FEDERATED }, context: SYS,
      });
      expect(Array.isArray(rows) ? rows.length : -1, 'no inert row persisted').toBe(0);
    });

    it('over real HTTP the envelope is code SHARING_NOT_ENABLED + status 422', async () => {
      // The ADR-0112 envelope, asserted where both halves are real: the status is
      // produced by the REST layer's code→status map, not by the service.
      const res = await stack.apiAs(
        adminToken, 'POST', `/data/${FEDERATED}/${REMOTE_ID}/shares`,
        { recipientId: adminId, accessLevel: 'edit' },
      );
      expect(res.status).toBe(422);
      const body = await res.json() as { code?: string; error?: string };
      expect(body.code).toBe('SHARING_NOT_ENABLED');
      // The operator-facing half: "no owner_id field" would be false here and
      // would send them to add a column the platform already injected.
      expect(body.error).toMatch(/federated/);
    });

    it('CONTROL: a LOCAL private record is NOT refused by the posture guard', async () => {
      // The contrast that gives the 422 above its meaning: on the SAME route,
      // with the same admin, a local private object gets PAST
      // `assertSharingEnforced` — the guard this card changes — and is judged by
      // the next gate instead.
      //
      // What that next gate answers here is a property of THIS BOOT, not of
      // sharing: the management pre-flight's record-visibility probe runs under
      // the caller's own context, and under the isolated posture this stack boots
      // with, the admin resolves no active organization while the seeded row
      // carries `organization_id: null` — so Layer 0 walls the row away from its
      // own creator and the pre-flight answers 404. The assertion is therefore
      // written against the thing under test: NOT 422, and NOT
      // SHARING_NOT_ENABLED. Anything else would be pinning an unrelated tenancy
      // artefact as if it were this card's behaviour.
      //
      // The positive half — a grant on a local object mints a row the gates then
      // read back as `allow` — is proven deterministically in
      // `plugin-sharing/src/federated-phantom-owner-scoping.test.ts`, where no
      // tenancy layer sits between the grant and the verdict.
      const res = await stack.apiAs(
        adminToken, 'POST', `/data/${LOCAL}/${localNoteId}/shares`,
        { recipientId: 'usr_grantee_8119', accessLevel: 'edit' },
      );
      expect(res.status).not.toBe(422);
      expect((await res.json() as { code?: string }).code).not.toBe('SHARING_NOT_ENABLED');
    });

    it('CONTROL: the grandfathered shipped object still refuses as PUBLIC, unchanged', async () => {
      // It is federated AND phantom-anchored, but `public_read_write` is judged
      // first. A new branch inserted above the public check would silently
      // re-attribute this shipped object's refusal.
      await expect(
        sharing.grant(
          { object: STAMPED, recordId: REMOTE_ID, recipientId: adminId, accessLevel: 'edit' },
          adminCtx,
        ),
      ).rejects.toThrow(/SHARING_NOT_ENABLED: '.*' is not under record-sharing enforcement/);
    });
  });
});
