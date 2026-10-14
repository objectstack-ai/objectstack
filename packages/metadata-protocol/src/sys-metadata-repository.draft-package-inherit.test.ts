// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11087] Draft-save package inheritance.
 *
 * A `state='draft'` save is a pending change OVER the published row, and every
 * package-scoped consumer (`listDrafts({ packageId })`, the console's
 * pending-changes surfaces, `publishPackageDrafts`) keys drafts by
 * `package_id`. A caller that names no base — the console's plain
 * `PUT …?mode=draft` — used to stamp NULL even when the overlaid active row is
 * package-bound, producing an "orphan draft" no package view counts and no
 * per-package publish can promote. Measured live on a cloud tenant
 * (cloud#1593): `GET /meta/_drafts` listed the draft, `?packageId=` listed
 * nothing, and the build surface's pending-changes bar stayed dark over a
 * publishable change.
 *
 * Pinned here:
 *  1. inheritance — a package-less draft save over a bound active row adopts
 *     the active row's binding, and the scoped listDrafts counts it;
 *  2. an EXPLICIT packageId is never overridden (ADR-0048: callers state
 *     their scope);
 *  3. a brand-new item drafted first (no active row) keeps package-less
 *     semantics;
 *  4. orphan adoption — a pre-fix NULL-package draft for the same
 *     (org, type, name) is UPDATED and adopted, never forked into a second
 *     draft row.
 */

import { describe, it, expect } from 'vitest';
// The engine-double contract gate: a fake looser than ObjectQL's own verb
// dispatch is how #4434 shipped a dead route with its suite green.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, ConflictError } from '@objectstack/metadata-core';
import { resolveThrownHttpError } from '@objectstack/types';
import { SysMetadataRepository } from './sys-metadata-repository.js';

interface Row {
  [k: string]: unknown;
}

function makeFakeEngine(seed: Row[] = []) {
  let nextId = 1;
  const rows: Row[] = seed.map((r) => ({ id: `seed_${nextId++}`, ...r }));
  const history: Row[] = [];

  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (k === '$or') {
        const branches = v as Array<Record<string, unknown>>;
        if (!branches.some((b) => matches(row, b))) return false;
        continue;
      }
      if (k.startsWith('$')) {
        // Refuse combinators this double does not implement — a silent
        // field-name read is how a fake matcher lies (WHERE-matcher gate).
        throw new Error(`fake matcher: unimplemented combinator ${k}`);
      }
      const rv = row[k] ?? null;
      if ((v ?? null) !== rv) return false;
    }
    return true;
  };

  const tableOf = (name: string): Row[] => (name === 'sys_metadata' ? rows : history);

  return {
    rows,
    history,
    async findOne(table: string, q: { where: Record<string, unknown> }) {
      assertEngineFindOnePredicate(table, q);
      return tableOf(table).find((r) => matches(r, q.where)) ?? null;
    },
    async find(table: string, q: { where: Record<string, unknown> }) {
      return tableOf(table).filter((r) => matches(r, q.where));
    },
    async insert(table: string, data: Row) {
      const row = { id: `row_${nextId++}`, ...data };
      tableOf(table).push(row);
      return row;
    },
    async update(table: string, data: Row, opts: { where: Record<string, unknown> }) {
      assertEngineUpdateDispatch(data, opts);
      const row = tableOf(table).find((r) => matches(r, opts.where));
      if (row) Object.assign(row, data);
      return row;
    },
    async delete(_table: string, opts: { where?: Record<string, unknown> }) {
      assertEngineDeleteDispatch(opts);
      /* not exercised here */
    },
  };
}

const REF = { org: 'system', type: 'view' as const, name: 'k9qk_member.member_list' };

function makeRepo(engine: ReturnType<typeof makeFakeEngine>) {
  return new SysMetadataRepository({
    engine: engine as never,
    orgLabel: 'env',
  } as never);
}

describe('SysMetadataRepository draft-save package inheritance (#11087)', () => {
  it('a package-less draft save over a bound active row inherits the binding, and scoped listDrafts counts it', async () => {
    const engine = makeFakeEngine();
    const repo = makeRepo(engine);
    await repo.put(REF, { label: 'Member' }, { parentVersion: null, actor: 't', packageId: 'app.k9qk' });
    const active = engine.rows.find((r) => r.state === 'active')!;
    expect(active.package_id).toBe('app.k9qk');

    await repo.put(REF, { label: 'Member', description: 'edited' }, { parentVersion: null, actor: 't', state: 'draft' as const });
    const draft = engine.rows.find((r) => r.state === 'draft')!;
    expect(draft.package_id).toBe('app.k9qk');

    const scoped = await repo.listDrafts({ packageId: 'app.k9qk' });
    expect(scoped.map((d) => d.name)).toEqual(['k9qk_member.member_list']);
  });

  it('an explicit packageId on the draft save is never overridden by inheritance', async () => {
    const engine = makeFakeEngine();
    const repo = makeRepo(engine);
    await repo.put(REF, { label: 'Member' }, { parentVersion: null, actor: 't', packageId: 'app.k9qk' });
    await repo.put(REF, { label: 'Member v2' }, { parentVersion: null, actor: 't', state: 'draft' as const, packageId: 'app.other' });
    const draft = engine.rows.find((r) => r.state === 'draft')!;
    expect(draft.package_id).toBe('app.other');
  });

  it('a brand-new item drafted first keeps package-less semantics (nothing to inherit)', async () => {
    const engine = makeFakeEngine();
    const repo = makeRepo(engine);
    await repo.put(REF, { label: 'Member' }, { parentVersion: null, actor: 't', state: 'draft' as const });
    const draft = engine.rows.find((r) => r.state === 'draft')!;
    expect(draft.package_id ?? null).toBeNull();
  });

  it('adopts a pre-fix orphan draft (NULL package) instead of forking a second draft row', async () => {
    const engine = makeFakeEngine([
      {
        type: REF.type, name: REF.name, state: 'active',
        package_id: 'app.k9qk', metadata: '{"label":"Member"}', checksum: 'sha-active', version: 1,
      },
      {
        type: REF.type, name: REF.name, state: 'draft',
        package_id: null, metadata: '{"label":"Member","description":"orphan"}', checksum: 'sha-orphan', version: 2,
      },
    ]);
    const repo = makeRepo(engine);
    await repo.put(
      REF,
      { label: 'Member', description: 'orphan edited' },
      { parentVersion: 'sha-orphan', actor: 't', state: 'draft' as const },
    );
    const drafts = engine.rows.filter((r) => r.state === 'draft');
    expect(drafts).toHaveLength(1); // updated in place, never forked
    expect(drafts[0].package_id).toBe('app.k9qk'); // adopted into the package
  });
});

/**
 * [#22128] `headAt` is the parent a write at one address must name: the row
 * `put` upserts there and locks against, from the same resolution. `get` at
 * the key the caller named is not — a package-less draft is stored in the
 * package of the active row, so `get` at the unbound key reads no draft while
 * `put` judges the inherited one.
 */
describe('SysMetadataRepository.headAt — the row put locks against (#22128)', () => {
  const seededActive = (pkg: string | null) => ({
    type: REF.type, name: REF.name, state: 'active',
    package_id: pkg, metadata: '{"label":"Member"}', checksum: 'sha-active', version: 1,
  });

  it('a package-less draft address resolves the INHERITED draft, and put accepts its version as the parent', async () => {
    const engine = makeFakeEngine([seededActive('app.k9qk')]);
    const repo = makeRepo(engine);
    const first = await repo.put(REF, { label: 'draft 1' }, { parentVersion: null, actor: 't', state: 'draft' as const });

    const { head, packageId } = await repo.headAt(REF, { state: 'draft', packageId: null });
    expect(head?.hash).toBe(first.version);
    // The binding the put writes under: the inherited package.
    expect(packageId).toBe('app.k9qk');
    // The key the caller named holds no draft: that read is not the parent.
    expect(await repo.get(REF, { state: 'draft', packageId: null })).toBeNull();

    await expect(repo.put(REF, { label: 'from null' }, { parentVersion: null, actor: 't', state: 'draft' as const }))
      .rejects.toBeInstanceOf(ConflictError);
    const second = await repo.put(REF, { label: 'draft 2' }, { parentVersion: head!.hash, actor: 't', state: 'draft' as const });
    expect((await repo.headAt(REF, { state: 'draft' })).head?.hash).toBe(second.version);
    expect(engine.rows.filter((r) => r.state === 'draft').map((r) => r.package_id)).toEqual(['app.k9qk']);
  });

  it('resolves a pre-fix orphan draft (NULL package) as the head the adopting put judges', async () => {
    const engine = makeFakeEngine([
      seededActive('app.k9qk'),
      {
        type: REF.type, name: REF.name, state: 'draft',
        package_id: null, metadata: '{"label":"orphan"}', checksum: 'sha-orphan', version: 2,
      },
    ]);
    const repo = makeRepo(engine);
    const adopted = await repo.headAt(REF, { state: 'draft', packageId: null });
    expect(adopted.head?.hash).toBe('sha-orphan');
    // The orphan is updated INTO the package: the put's binding is the inherited one.
    expect(adopted.packageId).toBe('app.k9qk');
  });

  it('an explicit package is its own address: never another package\'s row', async () => {
    const engine = makeFakeEngine([seededActive('app.k9qk')]);
    const repo = makeRepo(engine);
    await repo.put(REF, { label: 'draft' }, { parentVersion: null, actor: 't', state: 'draft' as const });

    expect(await repo.headAt(REF, { state: 'draft', packageId: 'app.other' })).toEqual({ head: null, packageId: 'app.other' });
    expect((await repo.headAt(REF, { state: 'draft', packageId: 'app.k9qk' })).head?.hash).toBeDefined();
  });

  it('an active address inherits nothing: the unbound key is the head, as put writes it', async () => {
    const engine = makeFakeEngine([seededActive('app.k9qk')]);
    const repo = makeRepo(engine);
    expect(await repo.headAt(REF, { state: 'active' })).toEqual({ head: null, packageId: null });
    expect((await repo.headAt(REF, { state: 'active', packageId: 'app.k9qk' })).head?.hash).toBe('sha-active');
  });

  it('a brand-new item drafted first: no head, and the package-less binding (nothing to inherit)', async () => {
    const repo = makeRepo(makeFakeEngine());
    expect(await repo.headAt(REF, { state: 'draft' })).toEqual({ head: null, packageId: null });
  });
});

/**
 * [#23297, ADR-0048] The inheritance reads EVERY active row of the address,
 * never the first one the store returns.
 *
 * Bound to two packages, a package-less draft has no single package to go
 * into: `put` refuses it `409 RESOURCE_CONFLICT` with the `?package=` remedy
 * (the refusal the direct save and the delete answer since #23165) and writes
 * nothing, and `headAt` names the package-unbound draft key, never a package
 * picked by storage order. Bound to one package, with a package-less active
 * row beside it, the draft inherits the package in either storage order.
 */
describe('[#23297] SysMetadataRepository draft inheritance reads every active row', () => {
  const activeRow = (pkg: string | null, checksum: string) => ({
    type: REF.type, name: REF.name, state: 'active',
    package_id: pkg, metadata: '{"label":"Member"}', checksum, version: 1,
  });

  for (const order of [['app.k9qk', 'app.other'], ['app.other', 'app.k9qk']] as const) {
    it(`two packages (${order.join(' stored before ')}): put refuses 409 RESOURCE_CONFLICT and writes nothing`, async () => {
      const engine = makeFakeEngine(order.map((pkg, i) => activeRow(pkg, `sha-${i}`)));
      const repo = makeRepo(engine);
      const rowsBefore = engine.rows.length;

      const err = await repo
        .put(REF, { label: 'Member', description: 'pending' }, { parentVersion: null, actor: 't', state: 'draft' as const })
        .then(() => null, (e: unknown) => e as Error & { code?: string; status?: number });

      expect(err).not.toBeNull();
      const envelope = resolveThrownHttpError(err);
      expect(envelope.status).toBe(409);
      expect(envelope.code).toBe('RESOURCE_CONFLICT');
      expect(err!.message).toContain("'app.k9qk', 'app.other'");
      expect(err!.message).toContain('?package=');
      expect(engine.rows).toHaveLength(rowsBefore);
      expect(engine.history).toHaveLength(0);
    });

    it(`two packages (${order.join(' stored before ')}): headAt names the package-unbound draft key, no package`, async () => {
      const engine = makeFakeEngine(order.map((pkg, i) => activeRow(pkg, `sha-${i}`)));
      const repo = makeRepo(engine);
      expect(await repo.headAt(REF, { state: 'draft', packageId: null })).toEqual({ head: null, packageId: null });
    });
  }

  it('two packages: a draft naming one of them is its own address and saves', async () => {
    const engine = makeFakeEngine([activeRow('app.k9qk', 'sha-0'), activeRow('app.other', 'sha-1')]);
    const repo = makeRepo(engine);
    await repo.put(REF, { label: 'pending' }, { parentVersion: null, actor: 't', state: 'draft' as const, packageId: 'app.other' });
    expect(engine.rows.filter((r) => r.state === 'draft').map((r) => r.package_id)).toEqual(['app.other']);
  });

  for (const residueFirst of [true, false]) {
    it(`one package and a package-less active row (${residueFirst ? 'package-less stored first' : 'package stored first'}): the draft inherits the package`, async () => {
      const rows = residueFirst
        ? [activeRow(null, 'sha-residue'), activeRow('app.k9qk', 'sha-active')]
        : [activeRow('app.k9qk', 'sha-active'), activeRow(null, 'sha-residue')];
      const engine = makeFakeEngine(rows);
      const repo = makeRepo(engine);
      await repo.put(REF, { label: 'pending' }, { parentVersion: null, actor: 't', state: 'draft' as const });
      expect(engine.rows.filter((r) => r.state === 'draft').map((r) => r.package_id)).toEqual(['app.k9qk']);
      expect((await repo.headAt(REF, { state: 'draft', packageId: null })).packageId).toBe('app.k9qk');
    });
  }
});
