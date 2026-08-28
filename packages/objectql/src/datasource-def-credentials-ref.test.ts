// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12758 — runtime half of the datasource-definition credentials-reference
 * contract. The compile-time half is in
 * `datasource-def-credentials-ref.pin.ts` (it has to be: this file is excluded
 * from every tsc program the `typecheck` script runs, so a `@ts-expect-error`
 * written here would never be evaluated).
 *
 * ⛔ NOTHING HERE IS PHRASED AS "the reference is no longer dropped". Measured
 * on the pre-change tree, the reference was never dropped: `registerDatasourceDef`
 * stored the caller's `external` object whole, by reference, and the manifest
 * install path spread the def straight through. A test claiming otherwise would
 * pin something that was never true. What IS new — and what this file covers —
 * is that the value is now READABLE, through an accessor that did not exist:
 * the engine had no reader onto its datasource index at all, only the private
 * write gate.
 *
 * Why it matters: a datasource declared IN CODE never reaches `sys_metadata`,
 * so the cross-producer `sys_secret` reference union cannot see the handle it
 * holds and has to be handed the list by its host. This accessor is what lets
 * the engine answer instead of the caller remembering.
 */

import { describe, expect, it } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { ExternalWriteForbiddenError } from '@objectstack/spec/shared';
import { ObjectQL } from './engine';

const REF = 'sys_secret:sec_credref_12758';

function makeDriver(name: string): IDataDriver {
  const store = new Map<string, Record<string, unknown>>();
  return {
    name,
    version: '1.0.0',
    async connect() {},
    async disconnect() {},
    async find() { return []; },
    async findOne() { return null; },
    async count() { return 0; },
    async create(object: string, data: Record<string, unknown>) {
      const id = (data.id as string) ?? String(store.size + 1);
      const row = { ...data, id };
      store.set(`${object}:${id}`, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const row = { ...(store.get(`${object}:${id}`) ?? {}), ...data, id };
      store.set(`${object}:${id}`, row);
      return row;
    },
    async delete(object: string, id: string) { return store.delete(`${object}:${id}`); },
    async syncSchema() {},
    async dropTable() {},
  } as unknown as IDataDriver;
}

/** The one definition, as every route below declares it. */
const DEF = {
  name: 'warehouse',
  schemaMode: 'external',
  external: { allowWrites: true, credentialsRef: REF },
} as const;

describe('datasource definitions retain external.credentialsRef and are readable (#12758)', () => {
  describe('entry route 1 — the direct registerDatasourceDef call', () => {
    it('lists the definition back with its credentials reference', () => {
      const engine = new ObjectQL();
      // No cast. If the parameter is ever re-narrowed this line stops compiling
      // in the pin file; here it is the runtime read-back that is under test.
      engine.registerDatasourceDef({ ...DEF, external: { ...DEF.external } });

      const listed = engine.listDatasourceDefs();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        name: 'warehouse',
        schemaMode: 'external',
        external: { allowWrites: true, credentialsRef: REF },
      });
    });
  });

  describe('entry route 2 — the package-manifest install path (registerApp)', () => {
    // The widest blast radius of the narrowing: a code-declared datasource
    // reaches the engine here and nowhere else. Manifests may spell
    // `datasources` as an array OR as a name-keyed map, and the two take
    // different branches, so both are pinned.
    it('retains the reference through the ARRAY spelling', () => {
      const engine = new ObjectQL();
      engine.registerApp({
        id: 'wh_pkg_array',
        name: 'Warehouse',
        datasources: [{ ...DEF, external: { ...DEF.external } }],
      });

      expect(engine.listDatasourceDefs()).toEqual([
        { name: 'warehouse', schemaMode: 'external', external: { allowWrites: true, credentialsRef: REF } },
      ]);
    });

    it('retains the reference through the NAME-KEYED MAP spelling', () => {
      const engine = new ObjectQL();
      engine.registerApp({
        id: 'wh_pkg_map',
        name: 'Warehouse',
        datasources: { warehouse: { schemaMode: 'external', external: { allowWrites: true, credentialsRef: REF } } },
      });

      expect(engine.listDatasourceDefs()).toEqual([
        { name: 'warehouse', schemaMode: 'external', external: { allowWrites: true, credentialsRef: REF } },
      ]);
    });
  });

  describe('the accessor is unfiltered, which is the whole point of it', () => {
    it('lists a MANAGED datasource that carries only a credentials reference (#8153)', () => {
      // `credentialsRef` is valid in every schemaMode. A reader that filtered
      // by schema mode would hide a live handle from a credentials sweep, and
      // under-reporting is the direction that deletes live credentials.
      const engine = new ObjectQL();
      engine.registerDatasourceDef({ name: 'billing', external: { credentialsRef: 'secret:billing/password' } });

      expect(engine.listDatasourceDefs()).toEqual([
        { name: 'billing', external: { credentialsRef: 'secret:billing/password' } },
      ]);
    });

    it('lists definitions that carry no reference at all, rather than dropping them', () => {
      const engine = new ObjectQL();
      engine.registerDatasourceDef({ name: 'plain', schemaMode: 'external', external: { allowWrites: false } });
      engine.registerDatasourceDef({ name: 'bare' });

      const names = engine.listDatasourceDefs().map((d) => d.name).sort();
      expect(names).toEqual(['bare', 'plain']);
    });

    it('answers an empty list on an engine that was told about no datasources', () => {
      // The control for every case above: the accessor reads a real index, and
      // an empty answer here is what makes a non-empty one elsewhere a reading.
      expect(new ObjectQL().listDatasourceDefs()).toEqual([]);
    });
  });

  describe('the accessor hands out a copy, never the write gate\'s own input', () => {
    it('mutating the returned external block does not change what the engine holds', () => {
      const engine = new ObjectQL();
      engine.registerDatasourceDef({ ...DEF, external: { ...DEF.external } });

      const first = engine.listDatasourceDefs()[0];
      first.external!.credentialsRef = 'sys_secret:tampered';
      first.external!.allowWrites = false;

      expect(engine.listDatasourceDefs()[0].external).toEqual({ allowWrites: true, credentialsRef: REF });
    });
  });

  describe('the write gate is unmoved by the widening', () => {
    function makeGatedEngine(allowWrites: boolean, objWritable: boolean) {
      const engine = new ObjectQL();
      engine.registerDriver(makeDriver('default'), true);
      engine.registerDriver(makeDriver('warehouse'));
      // Carries a credentialsRef in every case — the widened key must be inert
      // to Gate 3, which reads schemaMode + allowWrites and nothing else.
      engine.registerDatasourceDef({
        name: 'warehouse',
        schemaMode: 'external',
        external: { allowWrites, credentialsRef: REF },
      });
      engine.registerApp({
        id: 'wh_gate_pkg',
        name: 'Warehouse',
        objects: [{
          name: 'wh_order',
          datasource: 'warehouse',
          external: { remoteName: 'fact_orders', writable: objWritable },
          fields: { order_id: { type: 'text' } },
        }],
      });
      return engine;
    }

    it('still refuses a write without the double opt-in, with the ADR-0112 envelope intact', async () => {
      const engine = makeGatedEngine(false, true);
      // The envelope, not merely "it threw": a driver throwing a bare Error
      // would satisfy `toThrow()` and tell us nothing about the gate.
      const err = await engine.insert('wh_order', { order_id: 'o1' }).then(
        () => { throw new Error('insert resolved — the write gate did not fire'); },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ExternalWriteForbiddenError);
      expect(err).toMatchObject({
        code: (new ExternalWriteForbiddenError()).code,
        status: (new ExternalWriteForbiddenError()).status,
      });
      expect((err as Error).message).toContain("datasource 'warehouse' is external");
    });

    it('still allows a write when both halves opt in, credentials reference present', async () => {
      const engine = makeGatedEngine(true, true);
      await expect(engine.insert('wh_order', { order_id: 'o1' })).resolves.toBeDefined();
    });
  });
});
