// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Maintainer ruling 2026-08-24 (verbatim: 「同意 第一步(创业阶段,Salesforce
 * 式)」) — step 1: LOCK THE BASE, CLONE TO CUSTOMIZE.
 *
 * A Studio/API save targeting a package-declared permission set is refused at
 * the server with a message that names the sanctioned path (clone it), so no
 * silent overlay row is ever minted again.
 *
 * ## The harness models the hole, not the happy path
 *
 * The protocol double here has the `OS_METADATA_WRITABLE=permission` operator
 * hatch OPEN — its `saveMetaItem` does NOT refuse an artifact-backed name. That
 * is deliberate and it is the whole point: with the hatch closed the producer's
 * own ADR-0005 tier gate already answers 403 `NOT_OVERRIDABLE`, so a suite
 * written against a refusing double would score green on a door that is still
 * wide open in exactly the deployment the field report came from. The hatch is
 * documented, reachable, and is the one path that mints a fresh overlay of a
 * packaged set today.
 *
 * ## The pins, and why each one is not optional
 *
 *  1. the refusal fires AND its MESSAGE names the clone path — the ruling's
 *     point is that the admin learns what to do instead, so asserting only the
 *     rejection would pass on a bare "no";
 *  2. ⭐ an ordinary org-owned set is STILL accepted. The control: an
 *     implementation that refuses everything satisfies pin 1 perfectly;
 *  3. the clone path works end to end — org-owned row, no upgrade linkage —
 *     and the package-declared base is untouched by it;
 *  5. fail-closed on ambiguity: a provenance read that cannot ANSWER refuses,
 *     never accepts;
 *  6. ⭐ what the clone ACTION SENDS (#11703) — pin 3 drives the door with a
 *     hand-written payload, so it could not see that the ACTION ITSELF listed
 *     only two of the row's six definition facets. Pin 6 reads the payload out
 *     of the action definition, so editing that params list is what moves it.
 *
 * (Pin 4 — the detection reading for overlays that already exist — lives in its
 * own suite at the bottom of this file, because it reads rather than writes.)
 *
 * ## ⭐ The fail-open this must not inherit (#11518)
 *
 * `buildExistingByName`'s UNSCOPED page cap (`limit: names.length`,
 * `seed-name-lookup.ts`) truncates as soon as one name can carry more than one
 * row, and a truncated page reads as "absent". Asking THAT oracle "is this set
 * package-declared?" would turn a truncation into "not package-declared" — and
 * the save this ruling exists to refuse would be accepted. A silent fork
 * produced by the code written to stop silent forks.
 *
 * So the provenance question is decided from the engine's SchemaRegistry — the
 * same source `readDeclared` / `permission-set-overlay-discard.ts` already use,
 * an in-memory array with no page, no cap and no `$in`. Two controls prove the
 * immunity structurally rather than asserting it:
 *
 *  - CONTROL A builds the exact multi-row shape #11518 truncates on, in a
 *    double whose `find` HONOURS `limit` (the projection suite's double ignores
 *    it, so the trap cannot even be expressed there), shows the truncation is
 *    live, and pins that the refusal still fires;
 *  - CONTROL B makes every NAME-KEYED page read over `sys_permission_set` fail
 *    outright — the most extreme form of "this read did not answer" — while
 *    by-id reads keep working so the middleware still reaches the question.
 *    The verdict is unchanged, which is only possible if the question was never
 *    asked of that table. That is a structural proof, not an assertion.
 */

import { describe, it, expect } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import {
  createPermissionSetWriteThrough,
  permissionSetRowFields,
  registerPermissionSetProjection,
} from './permission-set-projection.js';

// ─────────────────────────────────────────────────────────────────────────────
// Doubles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory ql over `sys_permission_set` + `sys_metadata`.
 *
 * ⚠️ `find` HONOURS `limit`. The sibling double in
 * `permission-set-projection.test.ts` does not, which is why #11518's
 * truncation cannot be reproduced there at all — a page cap that the double
 * ignores is a page cap that no test in that file can ever measure.
 */
function makeQl(declared: any[] | null = null) {
  const permRows: any[] = [];
  const metaRows: any[] = [];
  const tableFor = (object: string): any[] | null =>
    object === 'sys_permission_set' ? permRows : object === 'sys_metadata' ? metaRows : null;
  const matches = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      // Refuse combinators rather than reading `$and`/`$or` as a column name
      // (check:where-matcher / #8494): no path under test issues one, and a
      // matcher that treated a combinator as a field would answer the wrong
      // rows while this suite stayed green.
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported combinator ${k}`);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inList = (v as any).$in;
        if (Array.isArray(inList)) return inList.includes(r[k]);
        throw new Error(`fake driver: unsupported operator ${Object.keys(v).join(',')}`);
      }
      return v === null ? (r[k] ?? null) === null : r[k] === v;
    });
  /** Set to fail exactly the NAME-KEYED page reads — CONTROL B. */
  let nameKeyedFindThrows = false;
  const ql: any = {
    permRows,
    metaRows,
    /**
     * Break precisely the read #11518 is about: a name-keyed page over
     * `sys_permission_set`. Reads by `id` (target resolution) keep working, so
     * the middleware still reaches the provenance question — which is the only
     * way to observe what that question answers when the paged table is
     * unavailable.
     */
    breakNameKeyedFind() { nameKeyedFindThrows = true; },
    async find(object: string, q: any) {
      if (
        nameKeyedFindThrows
        && object === 'sys_permission_set'
        && q?.where && Object.prototype.hasOwnProperty.call(q.where, 'name')
      ) {
        throw new Error('fake driver: name-keyed page read unavailable');
      }
      const rows = tableFor(object);
      if (!rows) return [];
      const hit = rows.filter((r) => matches(r, q?.where));
      // The cap a real driver applies — and the one #11518 turns into a false
      // "absent". Modelled, not ignored.
      return typeof q?.limit === 'number' ? hit.slice(0, q.limit) : hit;
    },
    async findOne(object: string, q: any) {
      const rows = tableFor(object);
      return rows?.find((r) => matches(r, q?.where)) ?? null;
    },
    async insert(object: string, data: any) {
      const rows = tableFor(object);
      if (!rows) return null;
      rows.push({ ...data });
      return { id: data.id };
    },
    // Routed through the PRODUCER's own dispatch predicates
    // (check:engine-double-contract / #4434, #5480): a double looser than
    // `ObjectQL.update` / `ObjectQL.delete` converts a green suite into no
    // suite at all on precisely the paths a double was introduced for.
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = tableFor(object) ?? [];
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r: any) => r.id === dispatch.id)
        : rows.filter((r: any) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const rows = tableFor(object) ?? [];
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r: any) => r.id === dispatch.id)
        : rows.filter((r: any) => matches(r, options?.where));
      for (const r of targets) rows.splice(rows.indexOf(r), 1);
      return targets.length > 0;
    },
  };
  if (declared !== null) {
    ql.registry = { listItems: (type: string) => (type === 'permission' ? declared : []) };
  }
  return ql;
}

/**
 * Metadata protocol double with the operator hatch OPEN.
 *
 * ⛔ `saveMetaItem` deliberately models NO ADR-0005 tier gate. That gate is
 * what `OS_METADATA_WRITABLE=permission` switches off, and this suite exists to
 * pin the door that stays open when it is off. `declared` still feeds the
 * layered read's `code` layer, because that is a READ and the hatch does not
 * change it.
 */
function makeHatchOpenProtocol(ql: any, declared: Record<string, any> = {}) {
  let projector: ((evt: any) => Promise<void>) | null = null;
  const overlayFor = (name: string) =>
    ql.metaRows.find(
      (r: any) => r.type === 'permission' && r.name === name
        && r.state === 'active' && (r.organization_id ?? null) === null,
    );
  const protocol: any = {
    saves: [] as any[],
    deletes: [] as any[],
    registerMutationProjector(_type: string, fn: (evt: any) => Promise<void>) { projector = fn; },
    async saveMetaItem(req: { type: string; name: string; item: any; actor?: string }) {
      // The REAL `PermissionSetSchema`, exactly as `saveMetaItem` runs it
      // (`resolveOverlaySchema`), same `[invalid_metadata]` 422 envelope. Only
      // the ADR-0005 TIER gate is absent here — that is the hatch. Without the
      // schema the double would accept any object and this suite could stay
      // green while every real write failed (#4001 / #4669).
      const parsed = PermissionSetSchema.safeParse(req.item);
      if (!parsed.success) {
        const summary = parsed.error.issues
          .map((i: any) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ');
        const err: any = new Error(`[invalid_metadata] permission/${req.name} failed spec validation: ${summary}`);
        err.code = 'INVALID_METADATA';
        err.status = 422;
        throw err;
      }
      const existing = overlayFor(req.name);
      if (existing) existing.metadata = JSON.stringify(req.item);
      else {
        ql.metaRows.push({
          id: `meta_${req.name}`, type: 'permission', name: req.name, state: 'active',
          organization_id: null, metadata: JSON.stringify(req.item),
        });
      }
      protocol.saves.push({ ...req });
      if (projector) await projector({ type: 'permission', name: req.name, state: 'active', organizationId: null });
      return { success: true };
    },
    async deleteMetaItem(req: { type: string; name: string }) {
      const i = ql.metaRows.findIndex(
        (r: any) => r.type === 'permission' && r.name === req.name && (r.organization_id ?? null) === null,
      );
      if (i >= 0) ql.metaRows.splice(i, 1);
      protocol.deletes.push({ ...req });
      if (projector) await projector({ type: 'permission', name: req.name, state: 'deleted', organizationId: null });
      return { success: true };
    },
    async getMetaItemLayered(req: { type: string; name: string }) {
      const code = declared[req.name] ?? null;
      const o = overlayFor(req.name);
      const overlay = o ? JSON.parse(o.metadata) : null;
      return {
        type: 'permission', name: req.name, code, overlay,
        overlayScope: overlay ? 'env' : null, effective: overlay ?? code,
      };
    },
  };
  return protocol;
}

const makeMiddleware = (ql: any, protocol: any) =>
  createPermissionSetWriteThrough({ ql, getProtocol: () => protocol });

/** Drive one middleware call; reports whether the driver leg would have run. */
async function run(mw: any, opCtx: any): Promise<boolean> {
  let nextCalled = false;
  await mw(opCtx, async () => { nextCalled = true; });
  return nextCalled;
}

const userCtx = { userId: 'usr_admin' };

/** A shipped artifact: a body as the SchemaRegistry stamps it (ADR-0010). */
const packagedSet = (over: Record<string, any> = {}) => ({
  name: 'ehr_quality_inspector',
  label: 'Quality Inspector',
  objects: { obj_a: { allowRead: true }, obj_b: { allowRead: true } },
  systemPermissions: ['pkg.baseline'],
  _packageId: 'com.example.ehr',
  ...over,
});

/** An env-authored definition — the same body shape, with no package behind it. */
const orgSet = (over: Record<string, any> = {}) => ({
  name: 'org_support_agent',
  label: 'Support Agent',
  objects: { ticket: { allowRead: true } },
  systemPermissions: ['support.use'],
  ...over,
});

/** The row the package door materializes for a shipped artifact. */
const packagedRow = (over: Record<string, any> = {}) => ({
  id: 'ps_pkg',
  name: 'ehr_quality_inspector',
  managed_by: 'package',
  package_id: 'com.example.ehr',
  active: true,
  ...permissionSetRowFields(packagedSet()),
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// PIN 1 — the silent fork path closes at the server, and the refusal TEACHES
// ─────────────────────────────────────────────────────────────────────────────

describe('pin 1 — a save targeting a package-declared set is refused, and the message names the clone path', () => {
  it('UPDATE through the data door is refused with the clone remedy, and mints NO overlay row', async () => {
    const ql = makeQl([packagedSet()]);
    const protocol = makeHatchOpenProtocol(ql, { ehr_quality_inspector: packagedSet() });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push(packagedRow());
    const mw = makeMiddleware(ql, protocol);

    // Rejection-class assertion is the ENVELOPE (`code` + `status`), never a
    // bare toThrow: an unfixed door throws nothing at all here, and a stub that
    // threw for some other reason would read identical to a real refusal.
    const rejection = await run(mw, {
      object: 'sys_permission_set', operation: 'update', context: userCtx,
      data: { id: 'ps_pkg', system_permissions: '["customized"]' },
    }).then(() => null, (e: any) => e);

    expect(rejection, 'the save must be refused, not accepted').not.toBeNull();
    expect(rejection).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    // ⭐ The ruling's whole point: the admin has to learn what to do instead.
    expect(String(rejection.message)).toMatch(/clone/i);
    expect(String(rejection.message)).toContain('ehr_quality_inspector');
    expect(String(rejection.message)).toContain('com.example.ehr');

    // Refused, not "refused after writing".
    expect(ql.metaRows.length, 'no silent overlay row was minted').toBe(0);
    expect(protocol.saves.length, 'the metadata write never even ran').toBe(0);
    expect(
      JSON.parse(ql.permRows[0].system_permissions),
      'the record still projects the shipped declaration',
    ).toEqual(['pkg.baseline']);
  });

  it('INSERT of a name a package already declares is refused the same way (the other overlay-minting door)', async () => {
    // Reachable whenever a declaration ships but its record was never
    // materialized: the duplicate-name probe finds no row, so the insert would
    // otherwise walk straight into `saveMetaItem` on a packaged name and mint
    // a fresh overlay of it.
    const ql = makeQl([packagedSet()]);
    const protocol = makeHatchOpenProtocol(ql, { ehr_quality_inspector: packagedSet() });
    registerPermissionSetProjection(protocol, { ql });
    const mw = makeMiddleware(ql, protocol);

    const rejection = await run(mw, {
      object: 'sys_permission_set', operation: 'insert', context: userCtx,
      data: { name: 'ehr_quality_inspector', label: 'Mine', object_permissions: '{}' },
    }).then(() => null, (e: any) => e);

    expect(rejection).not.toBeNull();
    expect(rejection).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(String(rejection.message)).toMatch(/clone/i);
    expect(ql.metaRows.length).toBe(0);
    expect(ql.permRows.length).toBe(0);
  });

  it('a pure row-state patch (activate/deactivate) is NOT a save of the definition and still passes through', async () => {
    // Over-denial guard inside pin 1's own subject: the lifecycle actions send
    // `{ active }` and nothing else. Switching a packaged set off is not a
    // customization of it (#4669), so the lock must not swallow the column
    // write — a lock that refuses the on/off switch has broken the surface it
    // was supposed to protect.
    const ql = makeQl([packagedSet()]);
    const protocol = makeHatchOpenProtocol(ql, { ehr_quality_inspector: packagedSet() });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push(packagedRow());
    const mw = makeMiddleware(ql, protocol);

    const nextCalled = await run(mw, {
      object: 'sys_permission_set', operation: 'update', context: userCtx,
      data: { id: 'ps_pkg', active: false },
    });
    expect(nextCalled, 'the driver performs the column write with its ordinary semantics').toBe(true);
    expect(ql.metaRows.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⭐ PIN 2 — THE CONTROL. Not optional: pin 1 alone scores green on a door
// that refuses everything.
// ─────────────────────────────────────────────────────────────────────────────

describe('pin 2 (control) — an ordinary org-owned permission set is STILL accepted', () => {
  it('UPDATE of an env-authored set lands in the metadata store and projects onto the record', async () => {
    const ql = makeQl([packagedSet()]); // a package IS installed — just not this name
    const protocol = makeHatchOpenProtocol(ql, { ehr_quality_inspector: packagedSet() });
    registerPermissionSetProjection(protocol, { ql });
    await protocol.saveMetaItem({ type: 'permission', name: 'org_support_agent', item: orgSet() });
    const row = ql.permRows.find((r: any) => r.name === 'org_support_agent');
    expect(row, 'precondition: the env-authored row exists').toBeTruthy();
    const savesBefore = protocol.saves.length;
    const mw = makeMiddleware(ql, protocol);

    const opCtx: any = {
      object: 'sys_permission_set', operation: 'update', context: userCtx,
      data: { id: row.id, system_permissions: '["support.use","support.escalate"]' },
    };
    const nextCalled = await run(mw, opCtx);

    expect(nextCalled, 'the driver write is skipped — the record is projector-owned').toBe(false);
    expect(protocol.saves.length, 'the definition write LANDED').toBe(savesBefore + 1);
    expect(JSON.parse(ql.permRows.find((r: any) => r.name === 'org_support_agent').system_permissions))
      .toEqual(['support.use', 'support.escalate']);
    expect(opCtx.result?.id).toBe(row.id);
  });

  it('INSERT of a brand-new env-authored set is accepted and lands org-owned', async () => {
    const ql = makeQl([packagedSet()]);
    const protocol = makeHatchOpenProtocol(ql, { ehr_quality_inspector: packagedSet() });
    registerPermissionSetProjection(protocol, { ql });
    const mw = makeMiddleware(ql, protocol);

    const opCtx: any = {
      object: 'sys_permission_set', operation: 'insert', context: userCtx,
      data: {
        name: 'org_support_agent', label: 'Support Agent',
        object_permissions: JSON.stringify({ ticket: { allowRead: true } }),
      },
    };
    await run(mw, opCtx);

    expect(protocol.saves.length).toBe(1);
    const created = ql.permRows.find((r: any) => r.name === 'org_support_agent');
    expect(created?.managed_by).toBe('admin');
    expect(created?.package_id ?? null).toBeNull();
  });

  it('a `managed_by:package` row with NO artifact behind it keeps editing in place (the ADR-0094 D5-R surviving tier)', async () => {
    // The boundary the lock must NOT cross. This row was materialized by the
    // ADR-0086 P2 publish path from a definition that lives only in
    // `sys_metadata` (authored + published through the METADATA door, ADR-0070)
    // — no code artifact backs the name, so an edit of it is a direct edit of
    // the one stored definition and forks nothing. The ruling's subject is the
    // package-DECLARED set; a `managed_by` column is measurably not that fact
    // (`permission-set-projection.ts` header), and locking on it would take
    // the surviving `allowRuntimeCreate` tier down with it.
    const ql = makeQl([]); // registry present, nothing declared
    const protocol = makeHatchOpenProtocol(ql, {}); // no artifact for the name
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({
      id: 'ps_mat', name: 'crm_rep', managed_by: 'package', package_id: 'com.example.crm',
      system_permissions: '["materialized.baseline"]',
    });
    const mw = makeMiddleware(ql, protocol);

    const nextCalled = await run(mw, {
      object: 'sys_permission_set', operation: 'update', context: userCtx,
      data: { id: 'ps_mat', system_permissions: '["customized"]' },
    });
    expect(nextCalled).toBe(false);
    expect(JSON.parse(ql.metaRows[0].metadata).systemPermissions).toEqual(['customized']);
    expect(ql.permRows[0].managed_by, 'the package still owns the row').toBe('package');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PIN 3 — clone-to-customize is the sanctioned path, and it works
// ─────────────────────────────────────────────────────────────────────────────

describe('pin 3 — the clone path yields an org-owned set with no upgrade linkage, base untouched', () => {
  it('cloning a package-declared set produces an admin-owned row and leaves the base byte-identical', async () => {
    const ql = makeQl([packagedSet()]);
    const protocol = makeHatchOpenProtocol(ql, { ehr_quality_inspector: packagedSet() });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push(packagedRow());
    const baseBefore = JSON.stringify(ql.permRows[0]);
    const mw = makeMiddleware(ql, protocol);

    // Exactly what the `clone_permission_set` action POSTs: a NEW machine name
    // plus the base's facets, at /api/v1/data/sys_permission_set.
    const opCtx: any = {
      object: 'sys_permission_set', operation: 'insert', context: userCtx,
      data: {
        name: 'ehr_quality_inspector_local',
        label: 'Quality Inspector (local)',
        active: true,
        object_permissions: ql.permRows[0].object_permissions,
        field_permissions: ql.permRows[0].field_permissions,
      },
    };
    await run(mw, opCtx);

    const clone = ql.permRows.find((r: any) => r.name === 'ehr_quality_inspector_local');
    expect(clone, 'the clone exists').toBeTruthy();
    expect(clone.managed_by, "this org's row").toBe('admin');
    expect(clone.package_id ?? null, 'NO upgrade linkage — upgrades keep flowing to the base').toBeNull();
    expect(JSON.parse(clone.object_permissions), 'the grants came across').toEqual(packagedSet().objects);

    const base = ql.permRows.find((r: any) => r.id === 'ps_pkg');
    expect(JSON.stringify(base), 'the package-declared base is unchanged by the clone').toBe(baseBefore);
    expect(
      ql.metaRows.some((r: any) => r.name === 'ehr_quality_inspector'),
      'cloning mints no overlay of the base',
    ).toBe(false);
  });

  it('the clone is an ordinary set: editing IT is accepted', async () => {
    // Without this the "sanctioned path" could be a dead end — a clone that
    // exists and then refuses every edit satisfies nothing the ruling asked for.
    const ql = makeQl([packagedSet()]);
    const protocol = makeHatchOpenProtocol(ql, { ehr_quality_inspector: packagedSet() });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push(packagedRow());
    const mw = makeMiddleware(ql, protocol);
    await run(mw, {
      object: 'sys_permission_set', operation: 'insert', context: userCtx,
      data: { name: 'ehr_quality_inspector_local', label: 'Local', object_permissions: '{}' },
    });
    const clone = ql.permRows.find((r: any) => r.name === 'ehr_quality_inspector_local');

    const nextCalled = await run(mw, {
      object: 'sys_permission_set', operation: 'update', context: userCtx,
      data: { id: clone.id, system_permissions: '["local.only"]' },
    });
    expect(nextCalled).toBe(false);
    expect(JSON.parse(ql.permRows.find((r: any) => r.id === clone.id).system_permissions)).toEqual(['local.only']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PIN 6 — what the CLONE ACTION SENDS: every copied facet, by identity (#11703)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pin 3 above drives the data door with a HAND-WRITTEN clone payload. That is
 * precisely why it stayed green while this defect was live: it pins what the
 * SERVER does with a payload, never what the ACTION DEFINITION chooses to put
 * in one. `clone_permission_set` listed two of the row's six definition facets
 * on its `params`, so cloning a set carrying system permissions, row-level
 * security or tab permissions produced a clone with NONE of them — no error, a
 * success toast, and the loss discoverable only by diffing the two records
 * (#11703). Fail-closed (fewer grants), and therefore quiet.
 *
 * It matters more since the ruling one commit above this one: the save door now
 * refuses an in-place edit of a package-declared set AND its refusal names the
 * clone path, so this action is the platform's own recommended remedy.
 *
 * So this suite reads the payload OUT OF THE ACTION instead of restating it.
 * {@link clonePayload} is the clone dialog in miniature — the admin types the
 * two inline params, every `defaultFromRow` param is seeded from the source row
 * as objectui's `ActionParamDialog` seeds it, and `bodyExtra` rides along — so
 * editing the params list is what moves this suite. That is the whole point:
 * the class reopens the next time someone edits that list, unless a test is
 * reading the list rather than a copy of it.
 *
 * ⭐ IDENTITIES, NOT COUNTS. "Five facets came across" holds constant while two
 * of them swap, and asserting a facet is merely PRESENT passes on the empty
 * default (`[]` / `{}`) that IS the bug. Every facet below is asserted against
 * a NAMED, NON-EMPTY expected value.
 */

/** The shipped `clone_permission_set` action — read, never restated. */
const cloneAction = (): any => {
  const action = (SysPermissionSet.actions ?? []).find((a: any) => a.name === 'clone_permission_set');
  if (!action) throw new Error('clone_permission_set is missing from SysPermissionSet.actions');
  return action;
};

/**
 * The body the clone dialog POSTs to `/api/v1/data/sys_permission_set`,
 * assembled from the ACTION DEFINITION the way the dialog assembles it: a
 * `defaultFromRow` param is seeded from the source row under its resolved field
 * name and submitted verbatim when the admin does not touch it; an inline param
 * carries what the admin typed; `bodyExtra` is merged in.
 */
function clonePayload(row: any, typed: Record<string, any>): Record<string, any> {
  const action = cloneAction();
  const body: Record<string, any> = { ...(action.bodyExtra ?? {}) };
  for (const p of action.params ?? []) {
    const key = p.field ?? p.name;
    if (p.defaultFromRow) {
      if (row[key] !== undefined) body[key] = row[key];
    } else if (key in typed) {
      body[key] = typed[key];
    }
  }
  return body;
}

/**
 * The base an admin clones: EVERY definition facet populated, so no assertion
 * below can be satisfied by the empty default the defect produced.
 *
 * ⚠️ The card's repro sketch named `member_default` as "a set whose
 * `system_permissions` is non-empty". Measured on this tree that is not so —
 * the platform `member_default` carries a large `rowLevelSecurity` and NO
 * system permissions, and `showcase_member_default` carries neither (the D7
 * lint hard-blocks system permissions on an everyone-suggested set). The defect
 * is real either way; the example was not. A fixture carrying all six facets at
 * once is the shape that actually measures all three of the added ones, which a
 * single real set would not.
 */
const richSet = (over: Record<string, any> = {}) => ({
  name: 'ops_console',
  label: 'Ops Console',
  description: 'Runs the operations console.',
  objects: {
    showcase_task: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
    showcase_project: { allowRead: true },
  },
  fields: { 'showcase_project.budget': { readable: true, editable: false } },
  // The three facets #11703 dropped, each non-empty and each named below.
  systemPermissions: ['setup.access', 'ops.export_data'],
  rowLevelSecurity: [
    {
      name: 'ops_own_rows',
      label: 'Own Tasks Only',
      description: 'Operators only select tasks assigned to them.',
      object: 'showcase_task',
      operation: 'select' as const,
      using: 'assignee == current_user.email',
      positions: ['ops'],
      enabled: true,
    },
  ],
  tabPermissions: { app_ops: 'default_on' as const, app_admin: 'hidden' as const },
  // The RULED exclusion's positive control — see the last test.
  adminScope: {
    businessUnit: 'field_ops',
    includeSubtree: true,
    manageAssignments: true,
    manageBindings: false,
    authorEnvironmentSets: false,
    assignablePermissionSets: ['ops_console'],
  },
  ...over,
});

/**
 * The row the package door materializes for {@link richSet}.
 *
 * The return annotation is load-bearing, not decoration: without it tsc infers
 * the object-literal type and DROPS the index signature that
 * `permissionSetRowFields()` spreads in, so reading `.admin_scope` off the
 * result — which the exclusion control below does directly, rather than through
 * the `any[]` of `ql.permRows` — is a TS2339. It costs no precision: every
 * facet column arrives through that spread already typed `any`.
 */
const richRow = (over: Record<string, any> = {}): Record<string, any> => ({
  id: 'ps_rich',
  name: 'ops_console',
  managed_by: 'package',
  package_id: 'com.example.ops',
  active: true,
  ...permissionSetRowFields(richSet()),
  ...over,
});

describe('pin 6 — the clone action SENDS every facet it copies, and says what it deliberately does not (#11703)', () => {
  it('declares a defaultFromRow param for every copied facet — the identities, not a count', () => {
    const carried = (cloneAction().params ?? [])
      .filter((p: any) => p.defaultFromRow)
      .map((p: any) => p.field ?? p.name)
      .sort();

    // ⭐ A COUNT here (`toHaveLength(6)`) would hold while `system_permissions`
    // was swapped for something else. The set is spelled out.
    expect(carried, 'the params list is what the dialog sends — these are the facets it carries').toEqual([
      'description',
      'field_permissions',
      'object_permissions',
      'row_level_security',
      'system_permissions',
      'tab_permissions',
    ]);
    // `admin_scope` is the sixth definition column and is RULED out — pinned in
    // its own test below so a future reader sees a decision, not an oversight.
    expect(carried, 'admin_scope is excluded by ruling, not by accident').not.toContain('admin_scope');
  });

  it('cloning a fully-populated set carries all five copied facets end to end, by name', async () => {
    const ql = makeQl([richSet()]);
    const protocol = makeHatchOpenProtocol(ql, { ops_console: richSet() });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push(richRow());
    const mw = makeMiddleware(ql, protocol);

    // The payload comes from the ACTION, not from this test.
    const payload = clonePayload(ql.permRows[0], {
      label: 'Ops Console (local)',
      name: 'ops_console_local',
    });
    await run(mw, {
      object: 'sys_permission_set', operation: 'insert', context: userCtx, data: payload,
    });

    // (a) the DEFINITION that will be enforced — what `saveMetaItem` stored.
    const body = protocol.saves.find((s: any) => s.name === 'ops_console_local')?.item;
    expect(body, 'the clone was authored into the metadata store').toBeTruthy();
    expect(body.name).toBe('ops_console_local');
    expect(body.label, 'the admin-typed display name, not the base label').toBe('Ops Console (local)');
    expect(body.description).toBe(richSet().description);
    expect(body.objects, 'object permissions').toEqual(richSet().objects);
    expect(body.fields, 'field permissions').toEqual(richSet().fields);
    // ⭐ The three #11703 dropped. `[]` / `{}` here is the defect itself.
    expect(body.systemPermissions, 'system permissions — [] here IS the #11703 silent drop').toEqual(
      ['setup.access', 'ops.export_data'],
    );
    expect(
      (body.rowLevelSecurity ?? []).map((p: any) => p.name),
      'row-level security policies, by policy name',
    ).toEqual(['ops_own_rows']);
    expect(body.rowLevelSecurity, 'the RLS policy arrived whole, not as a name-only husk').toEqual(
      richSet().rowLevelSecurity,
    );
    expect(body.tabPermissions, 'tab permissions, per tab').toEqual({
      app_ops: 'default_on', app_admin: 'hidden',
    });

    // (b) the ROW the admin actually diffs the two records through.
    const clone = ql.permRows.find((r: any) => r.name === 'ops_console_local');
    expect(clone, 'the clone record exists').toBeTruthy();
    expect(clone.managed_by, "this org's row").toBe('admin');
    expect(clone.package_id ?? null, 'no upgrade linkage').toBeNull();
    expect(JSON.parse(clone.system_permissions)).toEqual(['setup.access', 'ops.export_data']);
    expect(JSON.parse(clone.row_level_security).map((p: any) => p.name)).toEqual(['ops_own_rows']);
    expect(JSON.parse(clone.tab_permissions)).toEqual({ app_ops: 'default_on', app_admin: 'hidden' });

    // The base is untouched by all of this (pin 3's invariant, re-checked on
    // the richer shape — a payload that now carries five facets is a payload
    // with five more chances to write to the wrong row).
    const base = ql.permRows.find((r: any) => r.id === 'ps_rich');
    expect(JSON.parse(base.system_permissions), 'the package-declared base still declares its own').toEqual(
      ['setup.access', 'ops.export_data'],
    );
    expect(base.name).toBe('ops_console');
  });

  it('CONTROL — admin_scope is deliberately NOT carried (ADR-0090 D12), and the dialog says so', async () => {
    // ⭐ POSITIVE CONTROL FIRST. Without it "the clone has no admin_scope" is
    // satisfied by a base that never had one, and this test would pin nothing.
    const baseRow = richRow();
    expect(baseRow.admin_scope, 'the base carries a delegated-admin scope to lose').toBeTruthy();
    expect(JSON.parse(baseRow.admin_scope).businessUnit).toBe('field_ops');

    // It is not on the wire…
    const payload = clonePayload(baseRow, { label: 'Ops Console (local)', name: 'ops_console_local' });
    expect(Object.keys(payload), 'the clone dialog never sends admin_scope').not.toContain('admin_scope');

    // …and it is not on the clone.
    const ql = makeQl([richSet()]);
    const protocol = makeHatchOpenProtocol(ql, { ops_console: richSet() });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push(baseRow);
    const mw = makeMiddleware(ql, protocol);
    await run(mw, {
      object: 'sys_permission_set', operation: 'insert', context: userCtx, data: payload,
    });

    const body = protocol.saves.find((s: any) => s.name === 'ops_console_local')?.item;
    expect(body, 'the clone was authored').toBeTruthy();
    expect(body.adminScope, 'a delegated-admin authority is a privilege decision, never a field copy').toBeUndefined();
    const clone = ql.permRows.find((r: any) => r.name === 'ops_console_local');
    expect(clone.admin_scope ?? null, 'and the column stays empty on the clone').toBeNull();

    // ⭐ The exclusion has to READ as a decision to the admin standing in the
    // dialog — otherwise it is the same silent drop #11703 reports, merely
    // ruled. The dialog's own explanatory line carries it.
    const description = String(cloneAction().description ?? '');
    expect(description, 'the clone dialog states the exclusion').toMatch(/delegated-admin scope/i);
    expect(description, 'and states that it is not copied').toMatch(/not copied/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PIN 5 — fail-closed on ambiguity
// ─────────────────────────────────────────────────────────────────────────────

describe('pin 5 — provenance that cannot be DETERMINED refuses the save', () => {
  it('a SchemaRegistry that throws is not the answer "not package-declared"', async () => {
    const ql = makeQl([]);
    ql.registry = { listItems: () => { throw new Error('registry unavailable'); } };
    // The layered read cannot answer either — so nothing on this kernel can
    // say whether the name is packaged, and accepting would be a guess.
    const protocol = makeHatchOpenProtocol(ql, {});
    protocol.getMetaItemLayered = async () => { throw new Error('metadata store unavailable'); };
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({ id: 'ps_x', name: 'unknown_provenance', managed_by: 'admin', system_permissions: '[]' });
    const mw = makeMiddleware(ql, protocol);

    const rejection = await run(mw, {
      object: 'sys_permission_set', operation: 'update', context: userCtx,
      data: { id: 'ps_x', system_permissions: '["whatever"]' },
    }).then(() => null, (e: any) => e);

    expect(rejection, 'an unanswerable provenance read must refuse, never accept').not.toBeNull();
    expect(rejection).toMatchObject({ status: 403 });
    expect(ql.metaRows.length, 'nothing was written on the way to the refusal').toBe(0);
  });

  it('a SchemaRegistry that answers with a non-list is the same ambiguity', async () => {
    const ql = makeQl([]);
    ql.registry = { listItems: () => undefined as any };
    const protocol = makeHatchOpenProtocol(ql, {});
    protocol.getMetaItemLayered = async () => { throw new Error('metadata store unavailable'); };
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push({ id: 'ps_x', name: 'unknown_provenance', managed_by: 'admin', system_permissions: '[]' });
    const mw = makeMiddleware(ql, protocol);

    const rejection = await run(mw, {
      object: 'sys_permission_set', operation: 'update', context: userCtx,
      data: { id: 'ps_x', system_permissions: '["whatever"]' },
    }).then(() => null, (e: any) => e);

    expect(rejection).not.toBeNull();
    expect(rejection).toMatchObject({ status: 403 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⭐ CONTROLS — the provenance read cannot inherit #11518's fail-open
// ─────────────────────────────────────────────────────────────────────────────

describe('control A — #11518 shape: a name carrying MORE THAN ONE row still refuses', () => {
  it('positive control: this double truncates exactly the way #11518 describes', async () => {
    // Harness-level and stable: it pins the DOUBLE, so it holds before and
    // after the fix, and it is what makes the next test meaningful. Without
    // it, "the refusal still fires" could be green simply because the trap was
    // never armed. (The sibling double in `permission-set-projection.test.ts`
    // ignores `limit` entirely — there, this control cannot even be written.)
    const ql = makeQl([packagedSet()]);
    ql.permRows.push(packagedRow());
    ql.permRows.push(packagedRow({ id: 'ps_pkg_residue', organization_id: null }));

    const names = ['ehr_quality_inspector'];
    const capped = await ql.find('sys_permission_set', {
      where: { name: { $in: names } },
      limit: names.length, // ← the UNSCOPED cap live on main at seed-name-lookup.ts
    });
    expect(ql.permRows.filter((r: any) => r.name === 'ehr_quality_inspector')).toHaveLength(2);
    expect(capped, 'the page is truncated — half the rows for this name are invisible').toHaveLength(1);
  });

  it('the refusal fires on a name that carries two rows', async () => {
    const ql = makeQl([packagedSet()]);
    const protocol = makeHatchOpenProtocol(ql, { ehr_quality_inspector: packagedSet() });
    registerPermissionSetProjection(protocol, { ql });
    ql.permRows.push(packagedRow());
    ql.permRows.push(packagedRow({ id: 'ps_pkg_residue' }));
    const mw = makeMiddleware(ql, protocol);

    const rejection = await run(mw, {
      object: 'sys_permission_set', operation: 'update', context: userCtx,
      data: { id: 'ps_pkg', system_permissions: '["customized"]' },
    }).then(() => null, (e: any) => e);

    expect(rejection, 'a truncating name-keyed oracle would have read "absent" here and ACCEPTED').not.toBeNull();
    expect(rejection).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(ql.metaRows.length).toBe(0);
  });
});

describe('control B — the provenance read is not a name-keyed table read at all', () => {
  it('every NAME-KEYED page read fails, and the verdict is STILL "package-declared"', async () => {
    // The structural proof of immunity. #11518 is a defect of a name-keyed
    // page read over `sys_permission_set`; here every such read is made to
    // fail outright — the most extreme form of "this read did not answer" —
    // while the by-id target resolution keeps working so the middleware still
    // reaches the provenance question. The verdict is unchanged, which is
    // only possible if the question was never asked of that table.
    //
    // If the provenance question is ever re-routed through
    // `buildExistingByName` (or any other name-keyed page), this test goes RED
    // instead of silently inheriting the fail-open.
    const ql = makeQl([packagedSet()]);
    const protocol = makeHatchOpenProtocol(ql, { ehr_quality_inspector: packagedSet() });
    ql.permRows.push(packagedRow());
    // Positive control for the break itself: without this, "the read failed"
    // could quietly be "the read was never armed".
    ql.breakNameKeyedFind();
    await expect(
      ql.find('sys_permission_set', { where: { name: 'ehr_quality_inspector' }, limit: 1 }),
    ).rejects.toThrow(/name-keyed page read unavailable/);
    expect(
      await ql.find('sys_permission_set', { where: { id: 'ps_pkg' }, limit: 1 }),
      'by-id reads still work, so the middleware reaches the provenance question',
    ).toHaveLength(1);

    const mw = makeMiddleware(ql, protocol);
    const rejection = await run(mw, {
      object: 'sys_permission_set', operation: 'update', context: userCtx,
      data: { id: 'ps_pkg', system_permissions: '["customized"]' },
    }).then(() => null, (e: any) => e);

    expect(rejection, 'a failed name-keyed read must never soften the verdict to "not packaged"').not.toBeNull();
    expect(rejection).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(ql.metaRows.length).toBe(0);
  });
});
