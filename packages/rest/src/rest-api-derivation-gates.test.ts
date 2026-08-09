// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3391 — the REST per-object exposure gate consumes the spec's single
// derivation source of truth (`resolveEffectiveApiMethods` /
// `isApiOperationAllowed`). This suite pins the gate DECISION
// (`apiAccessDenialFromEnable`) against the derivation contract: reverse-derived
// import/export, writeMode-precise import, deny-all, bulk∧child, and the
// legacy-strip semantics (#3543). Route-level plumbing (createMany/batch,
// import two-stage, export projection) is covered by rest.test.ts,
// rest-batch-endpoint.test.ts, and export-integration.test.ts.

import { describe, it, expect } from 'vitest';
import { apiAccessDenialFromEnable } from './rest-server';

/** True when the gate allows the operation (no denial object). */
function allowed(enable: any, op: string, opts?: any): boolean {
  return apiAccessDenialFromEnable(enable, 'obj', op, opts) === null;
}
/** The denial (status/body) or null. */
function denial(enable: any, op: string, opts?: any) {
  return apiAccessDenialFromEnable(enable, 'obj', op, opts);
}

describe('REST gate — three-state (#3391)', () => {
  it('no enable / unrestricted → everything allowed', () => {
    expect(allowed(undefined, 'create')).toBe(true);
    expect(allowed({}, 'delete')).toBe(true);
    expect(allowed({ apiEnabled: true }, 'export')).toBe(true);
  });

  it('apiEnabled:false → 404', () => {
    const d = denial({ apiEnabled: false }, 'get');
    expect(d?.status).toBe(404);
    expect(d?.body.code).toBe('OBJECT_API_DISABLED');
  });

  it('empty whitelist [] → deny-all 405', () => {
    const d = denial({ apiMethods: [] }, 'get');
    expect(d?.status).toBe(405);
    expect(d?.body.allowed).toEqual([]);
    expect(allowed({ apiMethods: [] }, 'list')).toBe(false);
  });
});

describe('REST gate — reverse-derived import/export (#3391)', () => {
  // The sys_business_unit shape: a plain CRUD whitelist with NO explicit
  // import/export must still admit import (⊆ create∨update) and export (⊆ list).
  const crud = { apiMethods: ['get', 'list', 'create', 'update', 'delete'] };

  it('CRUD whitelist admits import (reverse-derived from create/update)', () => {
    expect(allowed(crud, 'import')).toBe(true);
    expect(allowed(crud, 'import', { writeMode: 'insert' })).toBe(true);
    expect(allowed(crud, 'import', { writeMode: 'update' })).toBe(true);
    expect(allowed(crud, 'import', { writeMode: 'upsert' })).toBe(true);
  });

  it('CRUD whitelist admits export (reverse-derived from list)', () => {
    expect(allowed(crud, 'export')).toBe(true);
  });

  it("['get','list'] admits export but not import", () => {
    const ro = { apiMethods: ['get', 'list'] };
    expect(allowed(ro, 'export')).toBe(true);
    const d = denial(ro, 'import');
    expect(d?.status).toBe(405);
    // 405 body carries the effective set (list-derived reads), never `import`.
    expect(d?.body.allowed).toContain('export');
    expect(d?.body.allowed).not.toContain('import');
  });
});

describe('REST gate — import writeMode precision (#3391)', () => {
  it("['create'] admits insert-mode import, rejects update-mode", () => {
    const createOnly = { apiMethods: ['get', 'list', 'create'] };
    expect(allowed(createOnly, 'import', { writeMode: 'insert' })).toBe(true);
    expect(allowed(createOnly, 'import', { writeMode: 'update' })).toBe(false);
    // upsert needs create ∧ update → rejected
    expect(allowed(createOnly, 'import', { writeMode: 'upsert' })).toBe(false);
  });

  it("['update'] admits update-mode import, rejects insert-mode", () => {
    const updateOnly = { apiMethods: ['get', 'list', 'update'] };
    expect(allowed(updateOnly, 'import', { writeMode: 'update' })).toBe(true);
    expect(allowed(updateOnly, 'import', { writeMode: 'insert' })).toBe(false);
  });

  it('upsert-mode import needs both create and update', () => {
    expect(allowed({ apiMethods: ['create', 'update'] }, 'import', { writeMode: 'upsert' })).toBe(true);
    expect(allowed({ apiMethods: ['create'] }, 'import', { writeMode: 'upsert' })).toBe(false);
  });
});

describe('REST gate — legacy values ignored, strip semantics (#3543)', () => {
  it("a whitelist of ONLY ['import'] resolves to deny-all (legacy is not authorable)", () => {
    const e = { apiMethods: ['import'] };
    expect(allowed(e, 'import')).toBe(false);
    expect(allowed(e, 'import', { writeMode: 'insert' })).toBe(false);
    expect(allowed(e, 'import', { writeMode: 'update' })).toBe(false);
    // the gate reports the closed surface, not the raw whitelist
    const d = denial(e, 'import');
    expect(d?.status).toBe(405);
    expect(d?.body.allowed).toEqual([]);
  });
});

describe('REST gate — bulk ∧ child (#3391)', () => {
  it("['create'] (no bulk) → createMany child gate rejects", () => {
    expect(allowed({ apiMethods: ['create'] }, 'bulk', { bulkChild: 'create' })).toBe(false);
  });

  it("['create','bulk'] → createMany child gate admits", () => {
    expect(allowed({ apiMethods: ['create', 'bulk'] }, 'bulk', { bulkChild: 'create' })).toBe(true);
  });

  it("['bulk'] (no create) → createMany child gate rejects (child op missing)", () => {
    const d = denial({ apiMethods: ['bulk'] }, 'bulk', { bulkChild: 'create' });
    expect(d?.status).toBe(405);
  });

  it('batch upsert child needs bulk ∧ create ∧ update', () => {
    expect(allowed({ apiMethods: ['bulk', 'create', 'update'] }, 'bulk', { bulkChild: 'upsert' })).toBe(true);
    expect(allowed({ apiMethods: ['bulk', 'create'] }, 'bulk', { bulkChild: 'upsert' })).toBe(false);
  });
});

describe('REST gate — action alias normalization (#3391)', () => {
  it('runtime action names map onto canonical operations', () => {
    const ro = { apiMethods: ['get', 'list'] };
    expect(allowed(ro, 'query')).toBe(true); // query → list
    expect(allowed(ro, 'find')).toBe(true);  // find → list
    // [#6259] Was `allowed(ro, 'batch', …)` — the third alias this table
    // claimed to normalize, and the only one no producer ever sends. Every
    // `enforceApiAccess` call site passes a canonical literal, and the
    // cross-object `POST /batch` route (rest-server.ts, `registerBatchEndpoints`)
    // gates on `'bulk'` — the URL spells `batch`, the operation never does.
    // Re-spelled to `'bulk'`, which is the assertion this line always meant:
    // an object granting only get/list does not get the bulk surface.
    expect(allowed(ro, 'bulk', { bulkChild: 'create' })).toBe(false);
  });

  // [#6259] The REST half of the absence pin. Stated as the fork it is:
  // `batch` is not DENIED, it is unrecognized — and an unrecognized action is
  // ungated by `apiMethods` (custom actions never were). That is precisely why
  // a producer-less row could not be dismissed as harmless: while it existed,
  // this word silently bought a real bulk∧child verdict.
  it('`batch` is no longer normalized — it is an unknown, ungated action', () => {
    const ro = { apiMethods: ['get', 'list'] };
    expect(allowed(ro, 'batch', { bulkChild: 'create' })).toBe(true);
    // The canonical spelling the /batch route actually sends stays gated.
    expect(denial(ro, 'bulk', { bulkChild: 'create' })?.status).toBe(405);
  });
});
