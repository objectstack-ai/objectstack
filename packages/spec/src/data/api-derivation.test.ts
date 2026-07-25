// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  resolveEffectiveApiMethods,
  isApiOperationAllowed,
  effectiveOperationsArray,
  DATA_ACTION_TO_API_OPERATION,
  API_PRIMITIVES,
  LEGACY_API_METHODS,
} from './api-derivation';

describe('api-derivation (#3391)', () => {
  describe('three-state mode', () => {
    it('undefined apiMethods → unrestricted', () => {
      const eff = resolveEffectiveApiMethods({});
      expect(eff.mode).toBe('unrestricted');
      expect(isApiOperationAllowed(eff, 'create')).toBe(true);
      expect(isApiOperationAllowed(eff, 'delete')).toBe(true);
      expect(isApiOperationAllowed(eff, 'export')).toBe(true);
    });

    it('undefined enable block → unrestricted', () => {
      const eff = resolveEffectiveApiMethods(undefined);
      expect(eff.mode).toBe('unrestricted');
      expect(isApiOperationAllowed(eff, 'bulk')).toBe(true);
    });

    it('empty array → deny-all (flipped semantics, #3391)', () => {
      const eff = resolveEffectiveApiMethods({ apiMethods: [] });
      expect(eff.mode).toBe('deny-all');
      for (const p of API_PRIMITIVES) expect(isApiOperationAllowed(eff, p)).toBe(false);
      expect(isApiOperationAllowed(eff, 'import')).toBe(false);
      expect(isApiOperationAllowed(eff, 'export')).toBe(false);
      expect(effectiveOperationsArray(eff)).toEqual([]);
    });

    it('subset → restricted', () => {
      const eff = resolveEffectiveApiMethods({ apiMethods: ['get', 'list'] });
      expect(eff.mode).toBe('restricted');
      expect(isApiOperationAllowed(eff, 'get')).toBe(true);
      expect(isApiOperationAllowed(eff, 'list')).toBe(true);
      expect(isApiOperationAllowed(eff, 'create')).toBe(false);
      expect(isApiOperationAllowed(eff, 'delete')).toBe(false);
    });
  });

  describe('primitive gating', () => {
    it('grants only the declared primitives', () => {
      const eff = resolveEffectiveApiMethods({ apiMethods: ['get', 'list', 'update'] });
      expect(isApiOperationAllowed(eff, 'get')).toBe(true);
      expect(isApiOperationAllowed(eff, 'update')).toBe(true);
      expect(isApiOperationAllowed(eff, 'create')).toBe(false);
      expect(isApiOperationAllowed(eff, 'bulk')).toBe(false);
    });
  });

  describe('derivation table — each legacy verb', () => {
    it('upsert = create ∧ update', () => {
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['create', 'update'] }), 'upsert')).toBe(true);
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['create'] }), 'upsert')).toBe(false);
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['update'] }), 'upsert')).toBe(false);
    });

    it('export = list (this phase, userExportAllowed defaults true)', () => {
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['list'] }), 'export')).toBe(true);
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['get'] }), 'export')).toBe(false);
    });

    it('export gated off when userExportAllowed=false', () => {
      const eff = resolveEffectiveApiMethods({ apiMethods: ['list'] }, { userExportAllowed: false });
      expect(isApiOperationAllowed(eff, 'export')).toBe(false);
      // list itself is unaffected
      expect(isApiOperationAllowed(eff, 'list')).toBe(true);
    });

    it('aggregate = list', () => {
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['list'] }), 'aggregate')).toBe(true);
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['get'] }), 'aggregate')).toBe(false);
    });

    it('search = list ∧ searchable !== false', () => {
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['list'] }), 'search')).toBe(true);
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['list'], searchable: false }), 'search')).toBe(false);
      // default (searchable undefined) counts as enabled
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['list'], searchable: true }), 'search')).toBe(true);
    });

    it('history = get ∧ trackHistory === true', () => {
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['get'], trackHistory: true }), 'history')).toBe(true);
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['get'] }), 'history')).toBe(false);
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['get'], trackHistory: false }), 'history')).toBe(false);
    });

    it('restore/purge never derive (trash flag retired, #2377)', () => {
      const eff = resolveEffectiveApiMethods({ apiMethods: ['get', 'list', 'create', 'update', 'delete'] });
      expect(isApiOperationAllowed(eff, 'restore')).toBe(false);
      expect(isApiOperationAllowed(eff, 'purge')).toBe(false);
      // even fully-unrestricted objects do not expose restore/purge
      const open = resolveEffectiveApiMethods({});
      expect(isApiOperationAllowed(open, 'restore')).toBe(false);
      expect(isApiOperationAllowed(open, 'purge')).toBe(false);
    });
  });

  describe('import — coarse vs writeMode-precise', () => {
    it('coarse: any of create/update grants import', () => {
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['create'] }), 'import')).toBe(true);
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['update'] }), 'import')).toBe(true);
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['list'] }), 'import')).toBe(false);
    });

    it('writeMode=insert needs create', () => {
      const create = resolveEffectiveApiMethods({ apiMethods: ['create'] });
      const update = resolveEffectiveApiMethods({ apiMethods: ['update'] });
      expect(isApiOperationAllowed(create, 'import', { writeMode: 'insert' })).toBe(true);
      expect(isApiOperationAllowed(update, 'import', { writeMode: 'insert' })).toBe(false);
    });

    it('writeMode=update needs update', () => {
      const create = resolveEffectiveApiMethods({ apiMethods: ['create'] });
      const update = resolveEffectiveApiMethods({ apiMethods: ['update'] });
      expect(isApiOperationAllowed(create, 'import', { writeMode: 'update' })).toBe(false);
      expect(isApiOperationAllowed(update, 'import', { writeMode: 'update' })).toBe(true);
    });

    it('writeMode=upsert needs create ∧ update', () => {
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['create', 'update'] }), 'import', { writeMode: 'upsert' })).toBe(true);
      expect(isApiOperationAllowed(resolveEffectiveApiMethods({ apiMethods: ['create'] }), 'import', { writeMode: 'upsert' })).toBe(false);
    });
  });

  describe('explicit legacy wins (deprecated compatibility)', () => {
    it('honors a standalone explicit import even without create/update', () => {
      const eff = resolveEffectiveApiMethods({ apiMethods: ['import'] });
      expect(isApiOperationAllowed(eff, 'import')).toBe(true);
      // even precise writeMode checks pass when explicitly declared
      expect(isApiOperationAllowed(eff, 'import', { writeMode: 'update' })).toBe(true);
    });

    it('honors a standalone explicit export even without list', () => {
      const eff = resolveEffectiveApiMethods({ apiMethods: ['export'] });
      expect(isApiOperationAllowed(eff, 'export')).toBe(true);
    });
  });

  describe('bulk ∧ child', () => {
    it('requires the bulk primitive AND the child op', () => {
      const withBulk = resolveEffectiveApiMethods({ apiMethods: ['create', 'bulk'] });
      const noBulk = resolveEffectiveApiMethods({ apiMethods: ['create'] });
      expect(isApiOperationAllowed(withBulk, 'bulk', { bulkChild: 'create' })).toBe(true);
      // has bulk but not create → child fails
      const bulkOnly = resolveEffectiveApiMethods({ apiMethods: ['bulk'] });
      expect(isApiOperationAllowed(bulkOnly, 'bulk', { bulkChild: 'create' })).toBe(false);
      // has create but not bulk → bulk primitive missing
      expect(isApiOperationAllowed(noBulk, 'bulk', { bulkChild: 'create' })).toBe(false);
    });

    it('bulk child upsert needs bulk ∧ create ∧ update', () => {
      const full = resolveEffectiveApiMethods({ apiMethods: ['create', 'update', 'bulk'] });
      expect(isApiOperationAllowed(full, 'bulk', { bulkChild: 'upsert' })).toBe(true);
      const partial = resolveEffectiveApiMethods({ apiMethods: ['create', 'bulk'] });
      expect(isApiOperationAllowed(partial, 'bulk', { bulkChild: 'upsert' })).toBe(false);
    });
  });

  describe('action alias table', () => {
    it('maps runtime action vocabulary to canonical operations', () => {
      expect(DATA_ACTION_TO_API_OPERATION.query).toBe('list');
      expect(DATA_ACTION_TO_API_OPERATION.find).toBe('list');
      expect(DATA_ACTION_TO_API_OPERATION.batch).toBe('bulk');
      expect(DATA_ACTION_TO_API_OPERATION.get).toBe('get');
    });
  });

  describe('unknown/custom operations', () => {
    it('are not gated by apiMethods (pass through)', () => {
      const eff = resolveEffectiveApiMethods({ apiMethods: ['list'] });
      expect(isApiOperationAllowed(eff, 'somethingCustom')).toBe(true);
    });
  });

  describe('effectiveOperationsArray — deterministic enum order', () => {
    it('serializes in ApiMethod declaration order', () => {
      const eff = resolveEffectiveApiMethods({ apiMethods: ['list', 'create'] });
      const arr = effectiveOperationsArray(eff);
      // enum order: get, list, create, update, delete, upsert, bulk, aggregate, ...
      // for ['list','create']: list, create present; derived: aggregate, search (list), import, export, upsert? (needs update) no
      expect(arr).toContain('list');
      expect(arr).toContain('create');
      expect(arr).toContain('aggregate');
      expect(arr).toContain('import');
      expect(arr).toContain('export');
      expect(arr).not.toContain('update');
      expect(arr).not.toContain('upsert');
      expect(arr).not.toContain('restore');
      // deterministic order: list precedes create in the enum
      expect(arr.indexOf('list')).toBeLessThan(arr.indexOf('create'));
    });

    it('unrestricted exposes all primitives + derivable legacy (minus restore/purge)', () => {
      const arr = effectiveOperationsArray(resolveEffectiveApiMethods({ searchable: true, trackHistory: true }));
      for (const p of API_PRIMITIVES) expect(arr).toContain(p);
      expect(arr).toContain('upsert');
      expect(arr).toContain('aggregate');
      expect(arr).toContain('search');
      expect(arr).toContain('history');
      expect(arr).toContain('import');
      expect(arr).toContain('export');
      expect(arr).not.toContain('restore');
      expect(arr).not.toContain('purge');
    });
  });

  it('legacy list and primitive list are disjoint and cover the enum', () => {
    const overlap = LEGACY_API_METHODS.filter((m) => (API_PRIMITIVES as readonly string[]).includes(m));
    expect(overlap).toEqual([]);
  });
});
