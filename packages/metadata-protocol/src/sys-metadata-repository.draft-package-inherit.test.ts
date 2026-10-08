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
    organizationId: null,
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

  it('an ORG-scoped save inherits from the env-wide active row — the ADR-0005 overlay reach (#11087 layer 1b)', async () => {
    // The console's session carries an active org, so its draft lands in the
    // org scope while the active base row is env-wide. A same-org-only
    // inheritance lookup finds nothing there (measured live), so the reach
    // must mirror listDrafts' $or contract.
    const engine = makeFakeEngine([
      {
        type: REF.type, name: REF.name, organization_id: null, state: 'active',
        package_id: 'app.k9qk', metadata: '{"label":"Member"}', checksum: 'sha-active', version: 1,
      },
    ]);
    const repo = new SysMetadataRepository({
      engine: engine as never,
      organizationId: 'org_1',
      orgLabel: 'org_1',
    } as never);
    await repo.put(REF, { label: 'Member v2' }, { parentVersion: null, actor: 't', state: 'draft' as const });
    const draft = engine.rows.find((r) => r.state === 'draft')!;
    expect(draft.organization_id).toBe('org_1'); // org-scoped save, unchanged
    expect(draft.package_id).toBe('app.k9qk'); // inherited across scopes
  });

  it('adopts a pre-fix orphan draft (NULL package) instead of forking a second draft row', async () => {
    const engine = makeFakeEngine([
      {
        type: REF.type, name: REF.name, organization_id: null, state: 'active',
        package_id: 'app.k9qk', metadata: '{"label":"Member"}', checksum: 'sha-active', version: 1,
      },
      {
        type: REF.type, name: REF.name, organization_id: null, state: 'draft',
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
    type: REF.type, name: REF.name, organization_id: null, state: 'active',
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
        type: REF.type, name: REF.name, organization_id: null, state: 'draft',
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

  it('an org-scoped draft address resolves across the ADR-0005 reach, as the inheriting put does', async () => {
    const engine = makeFakeEngine([seededActive('app.k9qk')]);
    const repo = new SysMetadataRepository({
      engine: engine as never,
      organizationId: 'org_1',
      orgLabel: 'org_1',
    } as never);
    const first = await repo.put(REF, { label: 'org draft' }, { parentVersion: null, actor: 't', state: 'draft' as const });
    expect((await repo.headAt(REF, { state: 'draft' })).head?.hash).toBe(first.version);
  });

  it('a brand-new item drafted first: no head, and the package-less binding (nothing to inherit)', async () => {
    const repo = makeRepo(makeFakeEngine());
    expect(await repo.headAt(REF, { state: 'draft' })).toEqual({ head: null, packageId: null });
  });
});
