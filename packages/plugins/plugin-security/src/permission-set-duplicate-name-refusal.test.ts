// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19307] THE DUPLICATE-NAME REFUSAL on `sys_permission_set` — its ADR-0112
 * envelope, and the ORDER it stands in relative to the packaged-set lock.
 *
 * Two halves of one defect, both measured live on `examples/app-showcase`
 * before the fix (seeded admin, cookie session):
 *
 *  1. the refusal was a bare `Error` carrying `.status = 409` and NO `.code`,
 *     so the flat `{ error, code }` responder — which invents nothing for a
 *     producer that declared nothing — put prose on the wire:
 *     `409 {"error":"[Security] permission set 'showcase_manager' already
 *     exists","object":"sys_permission_set"}`. ADR-0112's 2026-08-17 amendment
 *     (#9232) closed `error.code` at the flat door too, so a 409 with no code
 *     is that contract unhonoured, and a dialog that must branch on the
 *     refusal is pushed to string-matching;
 *
 *  2. ⭐ it ran BEFORE `assertPermissionSetNotPackageDeclared`. A
 *     package-declared set HAS a projected row, so its name is duplicate and
 *     locked at once — and the admin who opens the Clone dialog on a packaged
 *     set and types the base set's own name (the single most likely thing to
 *     type) got the duplicate refusal and never reached `NOT_OVERRIDABLE`,
 *     the refusal that explains the actual situation and names the remedy.
 *
 * ## What each case is for
 *
 *  1. CONTROL — the ordinary (non-packaged) duplicate still refuses, and the
 *     refusal now carries the closed member. Asserting the ENVELOPE (`code` +
 *     `status`), never a bare "it threw": the unfixed producer threw too.
 *  2. ⭐ THE ORDERING — same middleware, same duplicate row, but the name is
 *     package-declared: the answer is the lock's `NOT_OVERRIDABLE` / 403
 *     carrying the lock's OWN message. The code alone would not identify the
 *     gate — ADR-0005's tier gate inside `saveMetaItem` answers 403
 *     `NOT_OVERRIDABLE` for the same row — so the message and `saves.length`
 *     are what prove the LOCK answered, ahead of any metadata write.
 *  3. NEGATIVE CONTROL — the reorder did not make every duplicate answer
 *     `NOT_OVERRIDABLE`: case 1's refusal is asserted to be NOT that code.
 *     (Stated as its own case because that is the regression the ordering
 *     change could plausibly introduce.)
 *  4. HAPPY PATH — a free name on an org-verdict kernel still lands. Running
 *     the lock first must not cost a create.
 *  5. FAIL-CLOSED, DECLARED — an ordinary duplicate attempted while NO
 *     artifact source can answer takes the lock's `unknown` refusal (403)
 *     instead of the 409. That case MOVED with the reorder; it is pinned so
 *     the behaviour is declared rather than incidental. Both answers are
 *     refusals and neither writes.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { createPermissionSetWriteThrough } from './permission-set-projection.js';
import {
  PERMISSION_SET_NAME_CONFLICT_CODE,
  PERMISSION_SET_NAME_CONFLICT_STATUS,
} from './errors.js';

/** The package-declared body case 2 turns on. */
const declaredBody = () => ({
  name: 'showcase_manager',
  label: 'Showcase Manager',
  objects: { showcase_task: { allowRead: true } },
  fields: {},
  systemPermissions: ['showcase.manage'],
  rowLevelSecurity: [],
  tabPermissions: {},
  _packageId: 'com.example.showcase',
});

/** A `sys_permission_set` row that already holds `name`. */
const rowFor = (name: string, over: Record<string, any> = {}) => ({
  id: `ps_${name}`,
  name,
  label: name,
  managed_by: 'admin',
  object_permissions: JSON.stringify({}),
  field_permissions: JSON.stringify({}),
  system_permissions: JSON.stringify([]),
  row_level_security: JSON.stringify([]),
  tab_permissions: JSON.stringify({}),
  ...over,
});

/**
 * Minimal engine double.
 *
 * `registry.listItems('permission')` is the artifact source the lock reads, so
 * seeding it IS seeding "this name is package-declared". It REFUSES query
 * shapes it does not implement rather than answering `[]`, which would report
 * "no such row" and let every case pass while measuring the double — and it
 * holds the caller's `limit` and opens `update` with the producer's own
 * dispatch predicate, so a fake looser than `ObjectQL` cannot collect a green
 * the real engine would not have given.
 */
function makeQl(rows: any[], declared: any[]) {
  const permRows = [...rows];
  return {
    permRows,
    registry: { listItems: (type: string) => (type === 'permission' ? declared : []) },
    async find(object: string, q: any) {
      if (object !== 'sys_permission_set') return [];
      const where = q?.where ?? {};
      const matched = permRows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
          if (v && typeof v === 'object') throw new Error(`fake engine: unsupported operand for ${k}`);
          return r[k] === v;
        }),
      );
      // The caller's bound, applied AFTER the filter and by PRESENCE — the
      // duplicate pre-check asks for `limit: 1`, and a limit-blind double
      // would be answering a different question than the engine does.
      return typeof q?.limit === 'number' ? matched.slice(0, q.limit) : matched;
    },
    async findOne(object: string, q: any) {
      assertEngineFindOnePredicate(object, q);
      return (await this.find(object, q))[0] ?? null;
    },
    async insert(_object: string, data: any) {
      permRows.push({ ...data });
      return { id: data.id };
    },
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const targets = dispatch.kind === 'by-id'
        ? permRows.filter((r) => r.id === dispatch.id)
        : await this.find(object, options);
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
  };
}

/**
 * Metadata protocol double. The real `PermissionSetSchema` runs on every
 * accepted save, exactly as `saveMetaItem` does.
 *
 * `layeredThrows` models a metadata layer that cannot answer — case 5's
 * `unknown` verdict, which is a READ failure and not an empty answer.
 */
function makeProtocol(ql: any, declaredNames: string[], opts: { layeredThrows?: boolean } = {}) {
  return {
    saves: [] as any[],
    projected: [] as string[],
    registerMutationProjector(_type: string, _fn: any) { /* not exercised here */ },
    async saveMetaItem(req: { type: string; name: string; item: any }) {
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
      this.saves.push({ ...req });
      ql.permRows.push(rowFor(req.name));
      return { success: true };
    },
    async deleteMetaItem() { return { success: true }; },
    async getMetaItemLayered(req: { type: string; name: string }) {
      if (opts.layeredThrows) throw new Error('metadata store unreachable');
      const code = declaredNames.includes(req.name) ? declaredBody() : null;
      return { type: 'permission', name: req.name, code, overlay: null, overlayScope: null, effective: code };
    },
  };
}

/** Run the middleware, reporting whether the engine's own write (`next`) ran. */
async function run(mw: any, opCtx: any): Promise<boolean> {
  let nextCalled = false;
  await mw(opCtx, async () => { nextCalled = true; });
  return nextCalled;
}

const insertCtx = (name: string) => ({
  object: 'sys_permission_set',
  operation: 'insert',
  context: { userId: 'usr_admin' },
  data: { name, label: 'Clone of the base' },
});

/** The thrown value, or a loud failure — `rejects` alone reads a bare throw as a pass. */
async function refusalOf(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected the insert to be REFUSED; it was accepted');
}

describe('[#19307] duplicate-name refusal on sys_permission_set', () => {
  it('1. CONTROL — an ORDINARY duplicate is refused with the closed member on the envelope', async () => {
    const ql = makeQl([rowFor('org_owned_set')], []);
    const protocol = makeProtocol(ql, []);
    const mw = createPermissionSetWriteThrough({ ql, getProtocol: () => protocol });

    const err = await refusalOf(() => run(mw, insertCtx('org_owned_set')));

    // The envelope, not the throw: `status` AND the machine-readable `code`,
    // which is what the flat door puts on the wire (#9232).
    expect(err.code).toBe(PERMISSION_SET_NAME_CONFLICT_CODE);
    expect(err.code).toBe('UNIQUE_VIOLATION');
    expect(err.status).toBe(PERMISSION_SET_NAME_CONFLICT_STATUS);
    expect(err.status).toBe(409);
    // Both spellings: the two transports read different property names.
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe('PermissionSetNameConflictError');
    expect(err.message).toContain("permission set 'org_owned_set' already exists");
    // Refused BEFORE the write, on both stores.
    expect(protocol.saves.length).toBe(0);
    expect(ql.permRows.length).toBe(1);
  });

  it('2. ⭐ ORDERING — a duplicate that is ALSO package-declared answers the LOCK, not the conflict', async () => {
    // The Clone-dialog case: the base set is declared by a package AND has its
    // projected row, so both refusals are true at once.
    const ql = makeQl([rowFor('showcase_manager', { managed_by: 'package', package_id: 'com.example.showcase' })],
      [declaredBody()]);
    const protocol = makeProtocol(ql, ['showcase_manager']);
    const mw = createPermissionSetWriteThrough({ ql, getProtocol: () => protocol });

    const err = await refusalOf(() => run(mw, insertCtx('showcase_manager')));

    expect(err.code).toBe('NOT_OVERRIDABLE');
    expect(err.status).toBe(403);
    expect(err.statusCode).toBe(403);
    // ⭐ The LOCK answered, not ADR-0005's tier gate inside `saveMetaItem`
    // (same code, different message) and not the duplicate check: the lock's
    // message is the only one that names the clone path.
    expect(err.name).toBe('PackagedPermissionSetLockedError');
    expect(err.message).toContain("declared by package 'com.example.showcase'");
    expect(err.message).toContain('clone');
    expect(err.message).not.toContain('already exists');
    // Nothing was written, and the metadata door was never reached.
    expect(protocol.saves.length).toBe(0);
  });

  it('3. NEGATIVE CONTROL — the reorder did NOT turn ordinary duplicates into NOT_OVERRIDABLE', async () => {
    const ql = makeQl([rowFor('org_owned_set')], [declaredBody()]); // a packaged set exists, under ANOTHER name
    const protocol = makeProtocol(ql, ['showcase_manager']);
    const mw = createPermissionSetWriteThrough({ ql, getProtocol: () => protocol });

    const err = await refusalOf(() => run(mw, insertCtx('org_owned_set')));

    expect(err.code).not.toBe('NOT_OVERRIDABLE');
    expect(err.code).toBe('UNIQUE_VIOLATION');
    expect(err.status).toBe(409);
  });

  it('4. HAPPY PATH — a free name still lands with the lock consulted first', async () => {
    const ql = makeQl([rowFor('org_owned_set')], [declaredBody()]);
    const protocol = makeProtocol(ql, ['showcase_manager']);
    const mw = createPermissionSetWriteThrough({ ql, getProtocol: () => protocol });

    const nextCalled = await run(mw, insertCtx('my_new_set'));

    expect(nextCalled).toBe(false); // projector-owned record; no driver write
    expect(protocol.saves.map((s) => s.name)).toEqual(['my_new_set']);
  });

  it('5. FAIL-CLOSED, DECLARED — a duplicate whose provenance cannot be resolved takes the lock refusal', async () => {
    // No registry AND a layered read that throws ⇒ no source answered.
    const ql: any = makeQl([rowFor('org_owned_set')], []);
    delete ql.registry;
    const protocol = makeProtocol(ql, [], { layeredThrows: true });
    const mw = createPermissionSetWriteThrough({ ql, getProtocol: () => protocol });

    const err = await refusalOf(() => run(mw, insertCtx('org_owned_set')));

    expect(err.code).toBe('NOT_OVERRIDABLE');
    expect(err.status).toBe(403);
    expect(err.name).toBe('PackagedPermissionSetProvenanceUnknownError');
    expect(protocol.saves.length).toBe(0);
  });
});
