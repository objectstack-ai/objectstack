// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { checkApiExposure } from './api-exposure.js';

describe('checkApiExposure (#1889)', () => {
  it('falls open when the definition is unresolvable', () => {
    expect(checkApiExposure(undefined, 'get').allowed).toBe(true);
    expect(checkApiExposure(null, 'create').allowed).toBe(true);
  });

  it('allows by default (apiEnabled defaults true, no whitelist)', () => {
    expect(checkApiExposure({}, 'query').allowed).toBe(true);
    expect(checkApiExposure({ apiEnabled: true }, 'delete').allowed).toBe(true);
  });

  it('hides the object (404) when apiEnabled is false', () => {
    const d = checkApiExposure({ apiEnabled: false }, 'get');
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(404);
  });

  describe('apiMethods whitelist', () => {
    it('allows a whitelisted operation', () => {
      // query maps to ApiMethod 'list'
      expect(checkApiExposure({ apiMethods: ['list', 'get'] }, 'query').allowed).toBe(true);
      expect(checkApiExposure({ apiMethods: ['list', 'get'] }, 'get').allowed).toBe(true);
    });

    it('blocks a non-whitelisted operation (405)', () => {
      const d = checkApiExposure({ apiMethods: ['list', 'get'] }, 'create');
      expect(d.allowed).toBe(false);
      expect(d.status).toBe(405);
      expect(d.reason).toContain('create');
    });

    it('maps delete/update/create/find correctly', () => {
      const ro = { apiMethods: ['list', 'get'] };
      expect(checkApiExposure(ro, 'delete').allowed).toBe(false);
      expect(checkApiExposure(ro, 'update').allowed).toBe(false);
      expect(checkApiExposure(ro, 'find').allowed).toBe(true); // find → list
    });

    it('gates aggregate as a list-class read', () => {
      // An object whose whitelist excludes `list` must not leak row
      // statistics through GROUP BY either.
      expect(checkApiExposure({ apiMethods: ['list'] }, 'aggregate').allowed).toBe(true);
      const d = checkApiExposure({ apiMethods: ['get'] }, 'aggregate');
      expect(d.allowed).toBe(false);
      expect(d.status).toBe(405);
    });

    it('an empty whitelist is deny-all (405) — flipped by #3391', () => {
      // Previously treated as "no restriction" (fail-open); the documented
      // three-state contract makes `[]` mean "expose nothing".
      const d = checkApiExposure({ apiMethods: [] }, 'create');
      expect(d.allowed).toBe(false);
      expect(d.status).toBe(405);
      // every operation is closed
      expect(checkApiExposure({ apiMethods: [] }, 'query').allowed).toBe(false);
      expect(checkApiExposure({ apiMethods: [] }, 'get').allowed).toBe(false);
    });

    it('does not gate actions with no ApiMethod mapping', () => {
      expect(checkApiExposure({ apiMethods: ['list'] }, 'somethingCustom').allowed).toBe(true);
    });

    it('surfaces the effective operation set on a 405 denial', () => {
      const d = checkApiExposure({ apiMethods: ['get', 'list'] }, 'create');
      expect(d.allowed).toBe(false);
      expect(d.allowedOperations).toContain('get');
      expect(d.allowedOperations).toContain('list');
      // list-class derived reads are exposed too
      expect(d.allowedOperations).toContain('aggregate');
      expect(d.allowedOperations).toContain('export');
      expect(d.allowedOperations).not.toContain('create');
    });
  });

  describe('nested enable shape (getObject) — regression for #3391', () => {
    // meta.getObject() returns the whole schema with the exposure flags under
    // `.enable`. The previous flat-only reader ignored them → a dead gate.
    it('reads apiEnabled from the nested enable block (404)', () => {
      const d = checkApiExposure({ name: 'x', enable: { apiEnabled: false } } as any, 'get');
      expect(d.allowed).toBe(false);
      expect(d.status).toBe(404);
    });

    it('reads apiMethods from the nested enable block (405)', () => {
      const def = { name: 'x', enable: { apiMethods: ['list', 'get'] } } as any;
      expect(checkApiExposure(def, 'query').allowed).toBe(true);
      const d = checkApiExposure(def, 'create');
      expect(d.allowed).toBe(false);
      expect(d.status).toBe(405);
    });

    it('nested empty whitelist is deny-all', () => {
      const def = { name: 'x', enable: { apiMethods: [], apiEnabled: true } } as any;
      expect(checkApiExposure(def, 'get').allowed).toBe(false);
      expect(checkApiExposure(def, 'query').allowed).toBe(false);
    });
  });

  describe('derivation-backed operations (#3391)', () => {
    it('import derives from create/update (writeMode-precise)', () => {
      const createOnly = { apiMethods: ['create'] };
      expect(checkApiExposure(createOnly, 'import', { writeMode: 'insert' }).allowed).toBe(true);
      expect(checkApiExposure(createOnly, 'import', { writeMode: 'update' }).allowed).toBe(false);
    });

    it('bulk requires the bulk primitive AND the child op', () => {
      const bulkCreate = { apiMethods: ['create', 'bulk'] };
      expect(checkApiExposure(bulkCreate, 'batch', { bulkChild: 'create' }).allowed).toBe(true);
      const createOnly = { apiMethods: ['create'] };
      expect(checkApiExposure(createOnly, 'batch', { bulkChild: 'create' }).allowed).toBe(false);
    });
  });
});
