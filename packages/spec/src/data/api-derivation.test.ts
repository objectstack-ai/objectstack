// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  resolveEffectiveApiMethods,
  isApiOperationAllowed,
  effectiveOperationsArray,
  DATA_ACTION_TO_API_OPERATION,
  API_PRIMITIVES,
} from './api-derivation';
import { ApiMethod, API_OPERATION_ORDER, LEGACY_API_METHODS } from './object.zod';

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

  describe('legacy values are ignored — strip semantics (#3543)', () => {
    it('a whitelist of ONLY legacy values resolves to deny-all', () => {
      const eff = resolveEffectiveApiMethods({ apiMethods: ['import'] });
      expect(eff.mode).toBe('deny-all');
      expect(isApiOperationAllowed(eff, 'import')).toBe(false);
      expect(isApiOperationAllowed(eff, 'import', { writeMode: 'update' })).toBe(false);
      expect(effectiveOperationsArray(eff)).toEqual([]);
    });

    it('legacy values mixed into a primitive whitelist change nothing (already derived)', () => {
      const withLegacy = resolveEffectiveApiMethods({ apiMethods: ['list', 'export'] });
      const primitivesOnly = resolveEffectiveApiMethods({ apiMethods: ['list'] });
      expect(withLegacy.mode).toBe('restricted');
      expect(effectiveOperationsArray(withLegacy)).toEqual(effectiveOperationsArray(primitivesOnly));
      expect(isApiOperationAllowed(withLegacy, 'export')).toBe(true); // derived from list
    });

    it('a legacy value NOT derivable from the declared primitives stays denied', () => {
      // pre-#3543 "explicit wins" honored this; now the derivation table is the
      // only adjudicator: export needs list, and get does not grant it.
      const eff = resolveEffectiveApiMethods({ apiMethods: ['get', 'export'] });
      expect(isApiOperationAllowed(eff, 'export')).toBe(false);
      expect(isApiOperationAllowed(eff, 'get')).toBe(true);
    });
  });

  describe('present-but-unreadable policy fails CLOSED (#3545)', () => {
    it('a non-array apiMethods resolves to deny-all, not unrestricted', () => {
      const eff = resolveEffectiveApiMethods({ apiMethods: 'get,list' as unknown as string[] });
      expect(eff.mode).toBe('deny-all');
      expect(isApiOperationAllowed(eff, 'get')).toBe(false);
      expect(effectiveOperationsArray(eff)).toEqual([]);
    });

    it('null stays unrestricted (absent policy, not unreadable policy)', () => {
      const eff = resolveEffectiveApiMethods({ apiMethods: null });
      expect(eff.mode).toBe('unrestricted');
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
      expect(DATA_ACTION_TO_API_OPERATION.get).toBe('get');
      // The canonical bulk spelling — the one every REST caller actually sends,
      // including the cross-object `POST /batch` route.
      expect(DATA_ACTION_TO_API_OPERATION.bulk).toBe('bulk');
    });

    // [#6259] `batch: 'bulk'` was a producer-less row: `callData` has had no
    // `batch` arm since #5856, and REST gates `/batch` on the literal `'bulk'`.
    // Two pins, because the finding had two halves — the row AND the prose
    // that told readers `batch` was a live runtime action.
    it('has no `batch` row — a lookup is undefined, not an alias for `bulk`', () => {
      expect(DATA_ACTION_TO_API_OPERATION.batch).toBeUndefined();
      expect(Object.keys(DATA_ACTION_TO_API_OPERATION)).not.toContain('batch');
      // Absence is not a denial: an unmapped action falls to the consumers'
      // `?? action` pass-through and is judged as itself, exactly like any
      // other unrecognized/custom action.
      const eff = resolveEffectiveApiMethods({ apiMethods: ['list'] });
      expect(isApiOperationAllowed(eff, 'batch')).toBe(true);
      // …while the real bulk surface stays gated on the `bulk` primitive.
      expect(isApiOperationAllowed(eff, 'bulk')).toBe(false);
    });

    it('its TSDoc no longer describes `batch` as part of the live vocabulary', () => {
      const source = fs.readFileSync(
        path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'api-derivation.ts'),
        'utf8',
      );
      const doc = source.match(
        /\/\*\*(?:[^*]|\*(?!\/))*?\*\/\s*export const DATA_ACTION_TO_API_OPERATION\b/,
      );
      expect(doc, 'DATA_ACTION_TO_API_OPERATION lost its TSDoc block').toBeTruthy();
      // The block has two halves and only the first is a claim about today:
      // the vocabulary description, then a `[#6259]` note recording what was
      // removed and why. The note is EXPECTED to say `batch`; the description
      // saying it is the drift this issue is about ("runtime `callData`
      // actions (`query`/`find`→`list`, `batch`→`bulk`)").
      const [description, history] = doc![0].split('[#6259]');
      expect(history, 'the `[#6259]` removal note vanished from the TSDoc').toBeTruthy();
      expect(description).not.toMatch(/batch/);
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

  it('legacy list and primitive list are disjoint', () => {
    const overlap = LEGACY_API_METHODS.filter((m) => (API_PRIMITIVES as readonly string[]).includes(m));
    expect(overlap).toEqual([]);
  });

  describe('vocabulary split (#3543)', () => {
    it('the authored enum is exactly the six primitives', () => {
      expect(ApiMethod.options).toEqual([...API_PRIMITIVES]);
    });

    it('the effective vocabulary is primitives ∪ legacy in the stable wire order', () => {
      expect([...API_OPERATION_ORDER].sort()).toEqual(
        [...API_PRIMITIVES, ...LEGACY_API_METHODS].sort(),
      );
      // wire order is the pre-#3543 enum declaration order, byte-stable
      expect(API_OPERATION_ORDER).toEqual([
        'get', 'list', 'create', 'update', 'delete', 'upsert', 'bulk',
        'aggregate', 'history', 'search', 'restore', 'purge', 'import', 'export',
      ]);
    });
  });
});
