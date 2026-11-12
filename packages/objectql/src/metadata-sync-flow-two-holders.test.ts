/**
 * [#32521; epic #31527 red line 2] `ObjectQLPlugin.loadMetadataFromService`
 * syncs `flow` from the metadata service's own plural read
 * (`MetadataManager.loadMany('flow')`), and `flow` is stored per
 * `(package, name)` (ADR-0150). Driven here over a real `MetadataManager` over
 * a real `DatabaseLoader` over `sys_metadata` rows into a real
 * `SchemaRegistry`.
 *
 * With two packages' rows of one flow name the read now hands on both, each
 * stamped with its row's package, so the sync registers each package's flow in
 * its own slot and the cold boot's bare-name seal reports the name held twice
 * (warned once, naming both). BEFORE (measured at main 34890e0e7, same
 * fixtures): the read handed on the row saved last alone, so only that
 * package's flow was registered, a read naming the other package answered it,
 * and the seal saw one holder. A name one package holds is unchanged (CONTROL).
 */
import { describe, it, expect, vi } from 'vitest';
import '@objectstack/metadata';
import { MetadataManager, DatabaseLoader } from '@objectstack/metadata';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectQLPlugin } from './plugin.js';
import { SchemaRegistry, sealBareNameHoldersAtColdBoot } from './registry.js';
import type { ObjectQL } from './engine.js';

/**
 * A `sys_metadata`-shaped READ-ONLY engine over a fixed row array:
 * `DatabaseLoader`'s read paths call `find` / `findOne` / `count` and nothing
 * else. The WHERE matcher refuses what it does not implement.
 */
const readEngine = (rows: Array<Record<string, unknown>>) => {
  const matches = (r: Record<string, unknown>, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`readEngine: unsupported WHERE combinator '${k}'`);
      if (v !== null && typeof v === 'object') throw new Error(`readEngine: unsupported WHERE operator on '${k}'`);
      return r[k] === v;
    });
  return {
    async find(_table: string, q: any) {
      const hits = rows.filter((r) => matches(r, q?.where ?? {}));
      return typeof q?.limit === 'number' ? hits.slice(0, q.limit) : hits;
    },
    async findOne(table: string, q: any) {
      assertEngineFindOnePredicate(table, q);
      return rows.find((r) => matches(r, q?.where ?? {})) ?? null;
    },
    async count(_table: string, q: any) {
      return rows.filter((r) => matches(r, q?.where ?? {})).length;
    },
  };
};

const ALPHA = 'com.alpha.app';
const BETA = 'com.beta.app';

/** `notify`'s row held for `pkg` (none: a package-less row) at `version`; `stamped` also names the package in the body. */
const flowRow = (pkg: string | undefined, version: number, stamped = false) => ({
  id: `flow_notify_${pkg ?? 'env'}`, type: 'flow', name: 'notify', state: 'active', version,
  source: 'database', package_id: pkg ?? null,
  metadata: JSON.stringify({
    name: 'notify', label: pkg ?? 'env', type: 'autolaunched', nodes: [], edges: [],
    ...(stamped && pkg ? { _packageId: pkg } : {}),
  }),
});

/** The sync over `rows`, then the cold boot's seal: what the registry holds and answers. */
async function syncOver(rows: Array<Record<string, unknown>>) {
  const manager = new MetadataManager({});
  manager.registerLoader(new DatabaseLoader({ engine: readEngine(rows) as any, trackHistory: false, cache: { enabled: false } } as any) as any);
  const registry = new SchemaRegistry();
  const plugin = new ObjectQLPlugin({ ql: { registry, bindHooks: vi.fn() } as unknown as ObjectQL });
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  await (plugin as any).loadMetadataFromService(manager, { logger, getService: vi.fn(), hook: vi.fn() });
  const label = (item: unknown) => (item as { label?: string } | undefined)?.label;
  const answers = {
    bare: label(registry.getItem('flow', 'notify')),
    alpha: label(registry.getItem('flow', 'notify', ALPHA)),
    beta: label(registry.getItem('flow', 'notify', BETA)),
    listed: (registry.listItems('flow') as Array<{ _packageId?: string; label?: string }>).map((item) => `${item._packageId ?? '-'}:${item.label}`),
  };
  const warn = vi.fn();
  const sealed = sealBareNameHoldersAtColdBoot(registry, 'warn', { warn })
    .map((c) => `${c.type}/${c.name}: ${c.existingHolder.kind === 'package' ? c.existingHolder.packageId : c.existingHolder.kind} then ${c.incomingPackageId}`);
  return { ...answers, sealed, warned: warn.mock.calls.length, syncFailed: logger.debug.mock.calls.length };
}

describe('[#32521] objectql\'s flow sync over the metadata service\'s own plural read', () => {
  for (const stamped of [false, true]) {
    it(`two packages' rows of the name (${stamped ? 'stamped in the body too' : 'bound by the column only'}): each package's flow is registered in its own slot and the seal warns the name held twice (BEFORE: BETA's alone, no warning)`, async () => {
      const synced = await syncOver([flowRow(ALPHA, 1, stamped), flowRow(BETA, 2, stamped)]);
      expect(synced.listed).toEqual([`${ALPHA}:${ALPHA}`, `${BETA}:${BETA}`]);
      expect(synced.alpha).toBe(ALPHA);
      expect(synced.beta).toBe(BETA);
      // The registry's own bare lookup answers the first holder registered (BEFORE: BETA, the only one):
      // a declared move (PR row 11c), not a refusal, because no production reader asks it with two
      // holders; the bare readers that do reach the name refuse it (objectql's resolver, the bare doors).
      expect(synced.bare).toBe(ALPHA);
      expect(synced.sealed).toEqual([`flow/notify: ${ALPHA} then ${BETA}`]);
      expect(synced.warned).toBe(1);
      expect(synced.syncFailed).toBe(0);
    });
  }

  it('two packages\' rows and a package-less row saved last: the package-less flow still answers every read, and both packages\' flows are registered beside it (BEFORE: the package-less flow alone)', async () => {
    const synced = await syncOver([flowRow(ALPHA, 1), flowRow(BETA, 2), flowRow(undefined, 3)]);
    expect([synced.bare, synced.alpha, synced.beta]).toEqual(['env', 'env', 'env']);
    expect(synced.listed).toEqual([`${ALPHA}:${ALPHA}`, `${BETA}:${BETA}`, '-:env']);
    expect(synced.sealed).toEqual([`flow/notify: ${ALPHA} then ${BETA}`]);
  });

  it('CONTROL — one package\'s row and a package-less row saved after it (its customization): the package-less flow alone, no warning, as before', async () => {
    const synced = await syncOver([flowRow(ALPHA, 1), flowRow(undefined, 2)]);
    expect([synced.bare, synced.alpha, synced.beta]).toEqual(['env', 'env', 'env']);
    expect(synced.listed).toEqual(['-:env']);
    expect(synced.sealed).toEqual([]);
    expect(synced.warned).toBe(0);
  });

  it('CONTROL — one package\'s row: its flow alone, no warning, as before', async () => {
    const synced = await syncOver([flowRow(ALPHA, 1)]);
    expect(synced.listed).toEqual([`${ALPHA}:${ALPHA}`]);
    expect([synced.bare, synced.alpha]).toEqual([ALPHA, ALPHA]);
    expect(synced.sealed).toEqual([]);
  });
});
