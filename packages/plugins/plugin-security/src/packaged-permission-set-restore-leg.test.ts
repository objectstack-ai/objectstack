// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE RESTORE LEG — the fourth write point of `createPermissionSetWriteThrough`
 * under the 2026-08-24 "lock the base, clone to customize" ruling: guarded
 * since #12020, with the refusal on the DURABILITY channel, plus the
 * reachability fence.
 *
 * The lock (`packaged-permission-set-lock.ts`) refuses a save that targets a
 * package-declared permission set. The `insert` and `update` legs of
 * `permission-set-projection.ts` THROW it; this leg cannot — it runs after
 * the engine has already un-trashed the row, so a throw would misreport a
 * completed engine operation and half-apply a multi-row restore. It consults
 * the SAME lock before its one guarded write (the `saveMetaItem` mint),
 * refuses the mint, and reports on the durability channel (#4632) through the
 * #9754 error→warn chain. The un-trash stands: with no overlay minted, boot
 * reconciliation re-projects the DECLARED body onto the record, so the
 * environment converges to the package truth rather than to a fork. The full
 * argument — why not refuse BEFORE the un-trash (no trashed-row read exists;
 * a pre-pass would go green in doubles and resolve nothing on a real engine),
 * why not compensate (this middleware's own delete leg guarantees the record
 * survives, so a re-trash through the data door cannot happen, and a failed
 * compensation makes the refusal a lie) — lives at the leg itself.
 *
 * ## What this file pins, and what it deliberately does not
 *
 * It pins six facts, in the order they answer the question:
 *
 *  1. ⭐ CONTROL — the harness reaches the LOCK, and the lock is what answers.
 *     An `update` on an artifact-backed name is refused with `NOT_OVERRIDABLE`
 *     / 403 AND the lock's own message (it names the clone path). The code
 *     alone would not identify the gate: ADR-0005's tier gate inside
 *     `saveMetaItem` answers with the same code for the same row, and its
 *     message instead says the type "has not opted into per-org overlay
 *     writes". Without this leg, case 2 below could pass for the wrong reason
 *     — a probe answered by a gate that is not the one under test.
 *
 *  2. THE LOCK AT THE RESTORE LEG — the same fixture, the same set, through
 *     `restore`: the engine un-trash runs (the leg stays a post-pass), the
 *     mint is refused BEFORE the metadata write, no overlay lands, and the
 *     refusal is REPORTED on the durability channel with the lock's own error
 *     — never thrown.
 *
 *     This case is the INVERSION #11725's MEASURED RESIDUAL demanded of the
 *     follow-up (#12020): it used to pin the re-authoring of a packaged body
 *     through this leg with no lock consulted. The deliberate red for the
 *     inversion is recorded on #12020's PR: with the leg's lock consultation
 *     removed, this case fails on `saves.length` — so it does not pass with
 *     the lock absent.
 *
 *  2b. NON-PACKAGED CONTROL — an org-owned set through the same leg is
 *     re-authored exactly as before the lock arrived. The ruling's scope is
 *     "packaged sets cannot be re-authored via restore" and nothing else;
 *     this case is the evidence the extension did not grow past it.
 *
 *  2c. FAIL-CLOSED — provenance that cannot be answered refuses the mint
 *     too, reported with the lock's `unknown` error. Accepting on a failed
 *     read would reopen the hatch-open gap on every transient — the lock's
 *     three-verdict contract (see its header) applies at every door it
 *     guards, this one included.
 *
 *  3. THE FENCE — why the trashed-packaged-row scenario stays remote: the write-through's
 *     `delete` leg cannot put a package-declared set into a restorable state.
 *     An artifact-backed definition tombstones its overlay (an ADR-0005 RESET)
 *     and the record re-projects to the shipped body; the driver delete never
 *     runs, so there is no trashed row for a `restore` to act on.
 *
 *  4. THE BLIND SPOT in the gate that WOULD pre-empt it. `security-plugin.ts`'s
 *     `assertPackageManagedWriteGate` runs OUTSIDE this middleware and admits
 *     `restore` into its package-row refusal — but it keys on the `managed_by`
 *     COLUMN, and the lock's own header records that column as measurably the
 *     wrong fact. On the `provenance_skip` shape (`permission-set-drift.ts`) a
 *     genuinely package-declared set carries `managed_by` other than
 *     `'package'`, so the outer gate does not fire and the unlocked leg is
 *     what the row reaches. Pinned through the exported classifier, which is
 *     the fact the lock reads.
 *
 * ⛔ NOT re-pinned here, on purpose (Prime Directive #8 — one spelling):
 *  - that `restore` is not an engine middleware dispatch verb. That is
 *    `packages/objectql/src/engine-middleware-operation-vocabulary.test.ts`
 *    (#7809), which welds the 7-member union to `engine.ts` source AND drives
 *    a real engine through every public method. A second copy here would be a
 *    claim about this file rather than about the engine.
 *  - that `restore` never derives as an API operation. That is
 *    `packages/spec/src/data/api-derivation.test.ts` against
 *    `API_METHOD_DERIVATION.restore.flag`, permanently `false` since
 *    `enable.trash` was retired (#2377 / ADR-0049); a real recycle bin is
 *    parked at #3146.
 *
 * Those two are what make this leg unreachable TODAY. The day either goes
 * red — #3146 landing a real recycle bin is the expected way — the lock
 * pinned by case 2 is what stands between a trashed packaged row and a
 * silent fork, and this file is the proof it was already in place.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { createPermissionSetWriteThrough } from './permission-set-projection.js';
import { classifyPackagedPermissionSet } from './packaged-permission-set-lock.js';

/** The package-declared body every case in this file turns on. */
const declaredBody = () => ({
  name: 'crm_rep',
  label: 'CRM Representative',
  objects: { crm_lead: { allowRead: true } },
  fields: {},
  systemPermissions: ['pkg.baseline'],
  rowLevelSecurity: [],
  tabPermissions: {},
  _packageId: 'com.example.crm',
});

/**
 * A `sys_permission_set` row projected from that declaration.
 *
 * `managed_by` is a parameter because the two gates in play read DIFFERENT
 * facts about the same row: the outer two-doors gate reads this column, the
 * lock reads the artifact registry. Case 4 is about exactly that difference.
 */
const packagedRow = (managedBy: string) => ({
  id: 'ps_pkg',
  name: 'crm_rep',
  label: 'CRM Representative',
  managed_by: managedBy,
  package_id: 'com.example.crm',
  object_permissions: JSON.stringify({ crm_lead: { allowRead: true } }),
  field_permissions: JSON.stringify({}),
  system_permissions: JSON.stringify(['pkg.baseline']),
  row_level_security: JSON.stringify([]),
  tab_permissions: JSON.stringify({}),
});

/**
 * Minimal engine double over `sys_permission_set` + the env overlay store.
 *
 * `registry.listItems('permission')` is the source the lock reads — an
 * in-memory array, which is the whole reason the lock uses it (no page, no
 * cap). Seeding it IS seeding "this name is package-declared".
 */
function makeQl(rows: any[], declared: any[]) {
  const permRows = [...rows];
  const overlays: any[] = [];
  return {
    permRows,
    overlays,
    /** True once the DRIVER delete actually ran (i.e. the row was removed). */
    driverDeleted: false,
    registry: { listItems: (type: string) => (type === 'permission' ? declared : []) },
    async find(object: string, q: any) {
      if (object !== 'sys_permission_set') return [];
      const where = q?.where ?? {};
      // REFUSES what it does not implement, rather than quietly matching
      // nothing: a double that answered `[]` for an operator it never learned
      // would report "no such row", and every case here would still pass while
      // measuring the double instead of the middleware.
      return permRows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
          if (v && typeof v === 'object') throw new Error(`fake engine: unsupported operand for ${k}`);
          return r[k] === v;
        }),
      );
    },
    async findOne(object: string, q: any) {
      assertEngineFindOnePredicate(object, q);
      return (await this.find(object, q))[0] ?? null;
    },
    // Opens with the PRODUCER's own dispatch predicate, never a hand-mirrored
    // guard: a fixture that drifts to a call shape `ObjectQL` would refuse must
    // fail loudly here rather than collect a green the real engine would not
    // have given. `tryUpdate` in the subject SWALLOWS a throw, so a double
    // looser than the engine would be invisible twice over.
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const targets = dispatch.kind === 'by-id'
        ? permRows.filter((r) => r.id === dispatch.id)
        : await this.find(object, options);
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async insert(_object: string, data: any) {
      permRows.push({ ...data });
      return { id: data.id };
    },
  };
}

/**
 * Metadata protocol double.
 *
 * `tierGate: 'open'` models the documented `OS_METADATA_WRITABLE=permission`
 * operator hatch — the deployment shape this whole family of cards came from,
 * where the producer's own ADR-0005 refusal is switched off and the write-door
 * lock is the ONLY thing left. `tierGate: 'closed'` is the default posture.
 *
 * The real `PermissionSetSchema` runs on every accepted save, exactly as
 * `saveMetaItem` runs it, so a body this double accepts is a body production
 * would accept too.
 */
function makeProtocol(ql: any, declaredNames: string[], tierGate: 'open' | 'closed') {
  const codeFor = (name: string) =>
    declaredNames.includes(name) ? declaredBody() : null;
  return {
    saves: [] as any[],
    deletes: [] as any[],
    async saveMetaItem(req: { type: string; name: string; item: any }) {
      if (tierGate === 'closed' && declaredNames.includes(req.name)) {
        const err: any = new Error(
          `[not_overridable] Metadata item 'permission/${req.name}' is provided by a code package `
          + 'and the type has not opted into per-org overlay writes (allowOrgOverride=false).',
        );
        err.code = 'NOT_OVERRIDABLE';
        err.status = 403;
        throw err;
      }
      const parsed = PermissionSetSchema.safeParse(req.item);
      if (!parsed.success) {
        const err: any = new Error(
          `[invalid_metadata] permission/${req.name} failed spec validation: `
          + parsed.error.issues.map((i: any) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; '),
        );
        err.code = 'INVALID_METADATA';
        err.status = 422;
        throw err;
      }
      ql.overlays.push({ name: req.name, item: req.item });
      this.saves.push({ ...req });
      return { success: true };
    },
    async deleteMetaItem(req: { type: string; name: string }) {
      const i = ql.overlays.findIndex((o: any) => o.name === req.name);
      if (i >= 0) ql.overlays.splice(i, 1);
      this.deletes.push({ ...req });
      // Artifact-backed: the overlay is tombstoned and the definition RESETS
      // to the shipped body — the record is never removed. `reset: true` is
      // the real protocol's own answer for this case.
      return { success: true, reset: declaredNames.includes(req.name) };
    },
    async getMetaItemLayered(req: { type: string; name: string }) {
      const code = codeFor(req.name);
      const overlay = ql.overlays.find((o: any) => o.name === req.name)?.item ?? null;
      return {
        type: 'permission',
        name: req.name,
        code,
        overlay,
        overlayScope: overlay ? 'env' : null,
        effective: overlay ?? code,
      };
    },
  };
}

/** Run the middleware, reporting whether the engine's own write (`next`) ran. */
async function run(mw: any, opCtx: any): Promise<boolean> {
  let nextCalled = false;
  await mw(opCtx, async () => { nextCalled = true; });
  return nextCalled;
}

const userCtx = { userId: 'usr_admin' };

describe('[#11725] the restore leg of the permission-set write-through', () => {
  it('CONTROL: an UPDATE on the same set is refused by the #11702 LOCK — named by its message, not just its code', async () => {
    // The gate identification this whole file rests on. `NOT_OVERRIDABLE`/403
    // alone does NOT name a gate: ADR-0005's tier gate answers with the same
    // envelope for the same row. The lock is distinguished by its MESSAGE,
    // which teaches the sanctioned path — and by `saves.length === 0`, which
    // says the refusal happened BEFORE the metadata write rather than inside
    // it. Both halves are asserted, because either alone is ambiguous.
    const ql = makeQl([packagedRow('package')], [declaredBody()]);
    // Hatch OPEN: the producer's tier gate is switched off, so anything that
    // refuses here can only be the write-door lock.
    const protocol = makeProtocol(ql, ['crm_rep'], 'open');
    const mw = createPermissionSetWriteThrough({ ql, getProtocol: () => protocol });

    let caught: any;
    try {
      await run(mw, {
        object: 'sys_permission_set',
        operation: 'update',
        data: { id: 'ps_pkg', label: 'hijacked' },
        context: userCtx,
      });
    } catch (e) { caught = e; }

    expect(caught, 'the update was refused').toBeDefined();
    expect(caught).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(caught.name).toBe('PackagedPermissionSetLockedError');
    // The wording IS the contract here (it is what separates this refusal from
    // the tier gate's), so it is asserted on top of the envelope, never instead.
    expect(caught.message).toContain("is declared by package 'com.example.crm'");
    expect(caught.message).toContain('clone');
    expect(protocol.saves.length, 'refused BEFORE the metadata write').toBe(0);
    expect(ql.overlays.length, 'no overlay of a packaged set was minted').toBe(0);
  });

  it('LOCK AT THE RESTORE LEG: the same set through RESTORE keeps the engine un-trash but the re-author is REFUSED — reported on the durability channel, never thrown', async () => {
    // ⭐ The INVERSION of #11725's MEASURED RESIDUAL, demanded by that case's
    // own comment and delivered by #12020. It used to assert: no refusal, one
    // save, the packaged body in the overlay store. Now the lock is consulted
    // before the leg's one guarded write, and every half inverts.
    //
    // Identical fixture to the CONTROL above — same ql, same registry, same
    // protocol posture, same row. The ONLY difference is the operation, so the
    // difference in outcome is attributable to the leg and nothing else. The
    // hatch is OPEN, so anything that refuses can only be the write-door lock.
    const ql = makeQl([packagedRow('package')], [declaredBody()]);
    const protocol = makeProtocol(ql, ['crm_rep'], 'open');
    const errors: any[] = [];
    const mw = createPermissionSetWriteThrough({
      ql,
      getProtocol: () => protocol,
      logger: { error: (m: string, e?: Error) => errors.push({ m, e }), info: () => {}, warn: () => {} },
    });

    const nextCalled = await run(mw, {
      object: 'sys_permission_set',
      operation: 'restore',
      options: { where: { id: 'ps_pkg' } },
      context: userCtx,
    });

    // The engine operation is NOT misreported: the leg stays a post-pass and
    // the caller of a completed restore hears success, not a throw.
    expect(nextCalled, 'the engine un-trash runs first — the leg is a post-pass').toBe(true);

    // The refusal is LOUD, and it is the LOCK's — same gate identification as
    // the CONTROL: the error names the package and teaches the clone path,
    // which ADR-0005's tier gate (the only other 403 on this row) does not.
    expect(errors.length, 'the refusal reached the durability channel').toBe(1);
    expect(errors[0].e).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(errors[0].e.name).toBe('PackagedPermissionSetLockedError');
    expect(errors[0].e.message).toContain("is declared by package 'com.example.crm'");
    expect(errors[0].e.message).toContain('clone');
    // The leg's own report is the REFUSAL wording, not the failed-write one
    // (#5240 — one condition, one wording): it says the skip was deliberate.
    expect(errors[0].m).toContain('deliberately NOT re-authored');
    expect(errors[0].m).toContain('clone');

    // And the mint never happened: refused BEFORE the metadata write, so no
    // overlay of a package-declared set exists to win over upgrades.
    expect(protocol.saves.length, 'refused BEFORE the metadata write').toBe(0);
    expect(ql.overlays, 'no overlay of a packaged set was minted').toEqual([]);
  });

  it('NON-PACKAGED CONTROL: an org-owned set through RESTORE is re-authored exactly as before — the lock changes nothing for it', async () => {
    // The ruled scope is "packaged sets cannot be re-authored via restore"
    // and NOTHING else — this case is the evidence the extension did not grow
    // past it. Same registry as above (crm_rep IS declared), so the classifier
    // is answering `org` for THIS name, not `org` for everything.
    const orgRow = {
      id: 'ps_org',
      name: 'my_own_set',
      label: 'My Own Set',
      managed_by: 'user',
      object_permissions: JSON.stringify({ crm_lead: { allowRead: true } }),
      field_permissions: JSON.stringify({}),
      system_permissions: JSON.stringify([]),
      row_level_security: JSON.stringify([]),
      tab_permissions: JSON.stringify({}),
    };
    const ql = makeQl([orgRow], [declaredBody()]);
    const protocol = makeProtocol(ql, ['crm_rep'], 'open');
    const errors: any[] = [];
    const mw = createPermissionSetWriteThrough({
      ql,
      getProtocol: () => protocol,
      logger: { error: (m: string, e?: Error) => errors.push({ m, e }), info: () => {}, warn: () => {} },
    });

    const nextCalled = await run(mw, {
      object: 'sys_permission_set',
      operation: 'restore',
      options: { where: { id: 'ps_org' } },
      context: userCtx,
    });

    expect(nextCalled, 'the engine un-trash runs').toBe(true);
    expect(errors, 'nothing was refused, nothing was reported').toEqual([]);
    expect(protocol.saves.length, 'the org-owned body IS re-authored, as always').toBe(1);
    expect(protocol.saves[0].name).toBe('my_own_set');
    expect(ql.overlays.map((o: any) => o.name)).toEqual(['my_own_set']);
  });

  it('FAIL-CLOSED: provenance that cannot be answered refuses the re-author too — reported with the lock\'s unknown error, never guessed', async () => {
    // Both artifact sources are broken: the registry read throws and the
    // layered probe fails. The lock's three-verdict contract (its header says
    // why accepting on `unknown` is the one guess a write door must not make)
    // applies at this door exactly as at insert/update — except the refusal
    // is reported, not thrown, like every refusal on this leg.
    const ql = makeQl([packagedRow('package')], [declaredBody()]);
    (ql as any).registry = { listItems: () => { throw new Error('registry offline'); } };
    const protocol = makeProtocol(ql, ['crm_rep'], 'open');
    (protocol as any).getMetaItemLayered = async () => { throw new Error('metadata layer unreadable'); };
    const errors: any[] = [];
    const mw = createPermissionSetWriteThrough({
      ql,
      getProtocol: () => protocol,
      logger: { error: (m: string, e?: Error) => errors.push({ m, e }), info: () => {}, warn: () => {} },
    });

    const nextCalled = await run(mw, {
      object: 'sys_permission_set',
      operation: 'restore',
      options: { where: { id: 'ps_pkg' } },
      context: userCtx,
    });

    expect(nextCalled, 'the engine un-trash runs').toBe(true);
    expect(errors.length, 'the fail-closed refusal reached the durability channel').toBe(1);
    expect(errors[0].e).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(errors[0].e.name).toBe('PackagedPermissionSetProvenanceUnknownError');
    expect(protocol.saves.length, 'no mint on a guess').toBe(0);
    expect(ql.overlays).toEqual([]);
  });

  it('FENCE: DELETE cannot produce a restorable row — the packaged definition RESETS and the driver delete never runs', async () => {
    // Why a trashed packaged row cannot arise through this door: there is
    // nothing to restore. The write-through owns the delete, tombstones the
    // overlay, and returns WITHOUT calling `next()` — so the engine never
    // removes (or trashes) the record.
    const ql = makeQl([packagedRow('package')], [declaredBody()]);
    const protocol = makeProtocol(ql, ['crm_rep'], 'open');
    const mw = createPermissionSetWriteThrough({ ql, getProtocol: () => protocol });

    const nextCalled = await run(mw, {
      object: 'sys_permission_set',
      operation: 'delete',
      options: { where: { id: 'ps_pkg' } },
      context: userCtx,
    });

    expect(nextCalled, 'the driver delete is never reached').toBe(false);
    expect(protocol.deletes.length, 'the overlay tombstone IS the delete').toBe(1);
    expect(protocol.deletes[0]).toMatchObject({ type: 'permission', name: 'crm_rep' });
    expect(ql.permRows.length, 'the record survives — a packaged set cannot be removed').toBe(1);
    expect(ql.permRows[0].name).toBe('crm_rep');
  });

  it('BLIND SPOT: the outer two-doors gate keys on `managed_by`, which the lock records as the WRONG fact', async () => {
    // `assertPackageManagedWriteGate` (security-plugin.ts) admits `restore`
    // into its package-row refusal and would therefore pre-empt this leg — but
    // only for rows whose `managed_by` column reads `'package'`. The
    // `provenance_skip` shape is a genuinely package-declared set whose column
    // does not, and on that row the outer gate returns without refusing while
    // the lock's own fact says `packaged`. That disagreement is the reason
    // "the outer gate already covers it" is not an answer.
    const declared = [declaredBody()];
    const provenanceSkipRow = packagedRow('user'); // the drift-report shape
    const ql = makeQl([provenanceSkipRow], declared);

    // The lock's fact, read from the artifact registry the lock actually uses.
    expect(classifyPackagedPermissionSet('crm_rep', ql)).toEqual({
      status: 'packaged',
      packageId: 'com.example.crm',
    });
    // The outer gate's fact, on the very same row.
    expect(provenanceSkipRow.managed_by, 'the column the outer gate reads').not.toBe('package');

    // Control: the classifier is not simply answering `packaged` for
    // everything — a name the registry does not declare comes back `org`,
    // which is what makes the assertion above evidence of anything.
    expect(classifyPackagedPermissionSet('my_own_set', ql)).toEqual({ status: 'org' });
  });
});
