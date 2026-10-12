// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22877] The overlay repository keys a bundled type's rows by MEMBER.
 *
 * `email_template` declares its identity as `(name, locale)`
 * (`ITEM_KEY_DISCRIMINATORS`). The repository used to resolve every write by
 * `(org, type, name, package_id)`, so the second locale's save found the first
 * locale's row and updated it in place: one row per template, the first
 * locale's wording lost at the next boot. Ruled A: the member is a key column,
 * taken from the body; a by-name read, delete, publish, history or revert with
 * no member addresses the CANONICAL member.
 *
 * Pinned here, on the repository alone:
 *  1. two locales are two rows, each re-save updates its own row;
 *  2. a read, a delete, a history, a promotion with no member addresses the
 *     canonical member; a named member addresses that one;
 *  3. the lineage counter stays per `(org, type, name)` — the history table's
 *     declared unique key — so a version names one snapshot, and a revert to
 *     another member's version is refused;
 *  4. CONTROL: a type whose identity is `name` alone writes and reads exactly
 *     as before — no member column in any row payload or `where`.
 */

import { describe, it, expect } from 'vitest';
// The engine-double contract gate: a fake looser than ObjectQL's own verb
// dispatch is how #4434 shipped a dead route with its suite green.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SysMetadataRepository } from './sys-metadata-repository.js';

interface Row {
  [k: string]: unknown;
}

function makeFakeEngine() {
  let nextId = 1;
  const rows: Row[] = [];
  const history: Row[] = [];
  const wheres: Array<Record<string, unknown>> = [];
  const payloads: Row[] = [];

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
    wheres,
    payloads,
    async findOne(table: string, q: { where: Record<string, unknown> }) {
      assertEngineFindOnePredicate(table, q);
      if (table === 'sys_metadata') wheres.push(q.where);
      return tableOf(table).find((r) => matches(r, q.where)) ?? null;
    },
    async find(table: string, q: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata') wheres.push(q.where);
      return tableOf(table).filter((r) => matches(r, q.where));
    },
    async insert(table: string, data: Row) {
      if (table === 'sys_metadata') payloads.push({ ...data });
      const row = { id: `row_${nextId++}`, ...data };
      tableOf(table).push(row);
      return row;
    },
    async update(table: string, data: Row, opts: { where: Record<string, unknown> }) {
      assertEngineUpdateDispatch(data, opts);
      if (table === 'sys_metadata') payloads.push({ ...data });
      const row = tableOf(table).find((r) => matches(r, opts.where));
      if (row) Object.assign(row, data);
      return row;
    },
    async delete(table: string, opts: { where?: Record<string, unknown> }) {
      assertEngineDeleteDispatch(opts);
      const t = tableOf(table);
      const i = t.findIndex((r) => matches(r, opts.where ?? {}));
      if (i >= 0) t.splice(i, 1);
      return { deleted: i >= 0 ? 1 : 0 };
    },
  };
}

const TEMPLATE = { org: 'env', type: 'email_template' as const, name: 'acme.welcome' };
const body = (locale: string | undefined, subject: string): Record<string, unknown> => ({
  name: 'acme.welcome',
  ...(locale ? { locale } : {}),
  subject,
  bodyHtml: `<p>${subject}</p>`,
});

function makeRepo(engine: ReturnType<typeof makeFakeEngine>) {
  return new SysMetadataRepository({ engine: engine as never, organizationId: null, orgLabel: 'env' } as never);
}

/** Last-write-wins, the way the save door's unpinned save resolves its parent. */
async function save(repo: SysMetadataRepository, spec: Record<string, unknown>, state: 'active' | 'draft' = 'active') {
  const locale = typeof spec.locale === 'string' ? spec.locale : undefined;
  const head = (await repo.headAt(TEMPLATE, { state, member: locale })).head?.hash ?? null;
  return repo.put(TEMPLATE, spec, { parentVersion: head, actor: 'admin', state });
}

const activeRows = (engine: ReturnType<typeof makeFakeEngine>) =>
  engine.rows.filter((r) => r.type === 'email_template' && r.state === 'active');

describe('SysMetadataRepository — a bundled type is keyed by member (#22877)', () => {
  it('two locales of one template are two rows; each re-save updates its own row', async () => {
    const engine = makeFakeEngine();
    const repo = makeRepo(engine);

    await save(repo, body('en-US', 'EN 1'));
    await save(repo, body('zh-CN', 'ZH 1'));
    expect(activeRows(engine)).toHaveLength(2);

    await save(repo, body('en-US', 'EN 2'));
    await save(repo, body('zh-CN', 'ZH 2'));
    const rows = activeRows(engine);
    expect(rows).toHaveLength(2);
    // NULL is the canonical member; the other member carries its value.
    const byMember = Object.fromEntries(rows.map((r) => [String(r.bundle_member), JSON.parse(String(r.metadata)).subject]));
    expect(byMember).toEqual({ null: 'EN 2', 'zh-CN': 'ZH 2' });
  });

  it('a body that declares no locale is the canonical member, the same row as en-US', async () => {
    const engine = makeFakeEngine();
    const repo = makeRepo(engine);
    await save(repo, body(undefined, 'no locale'));
    await save(repo, body('en-US', 'EN'));
    const rows = activeRows(engine);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bundle_member).toBeNull();
    expect(JSON.parse(String(rows[0]!.metadata)).subject).toBe('EN');
  });

  it('a read with no member answers the canonical member; a named member answers its own', async () => {
    const engine = makeFakeEngine();
    const repo = makeRepo(engine);
    await save(repo, body('zh-CN', 'ZH'));
    // Only a non-canonical member stored: a bare read finds no canonical row.
    expect(await repo.get(TEMPLATE)).toBeNull();
    await save(repo, body('en-US', 'EN'));

    expect((await repo.get(TEMPLATE))?.body.subject).toBe('EN');
    expect((await repo.get(TEMPLATE, { member: 'en-US' }))?.body.subject).toBe('EN');
    expect((await repo.get(TEMPLATE, { member: 'zh-CN' }))?.body.subject).toBe('ZH');
    expect(await repo.get(TEMPLATE, { member: 'ja-JP' })).toBeNull();
  });

  it('a delete with no member removes the canonical member only; a named member removes its own', async () => {
    const engine = makeFakeEngine();
    const repo = makeRepo(engine);
    await save(repo, body('en-US', 'EN'));
    await save(repo, body('zh-CN', 'ZH'));

    const en = await repo.get(TEMPLATE);
    await repo.delete(TEMPLATE, { parentVersion: en!.hash, actor: 'admin' });
    expect(activeRows(engine).map((r) => r.bundle_member)).toEqual(['zh-CN']);

    const zh = await repo.get(TEMPLATE, { member: 'zh-CN' });
    await repo.delete(TEMPLATE, { parentVersion: zh!.hash, actor: 'admin', member: 'zh-CN' });
    expect(activeRows(engine)).toEqual([]);
  });

  it('history yields one member\'s lineage — its delete tombstone included — on a counter shared by the bundle', async () => {
    const engine = makeFakeEngine();
    const repo = makeRepo(engine);
    await save(repo, body('en-US', 'EN 1')); // v1
    await save(repo, body('zh-CN', 'ZH 1')); // v2
    await save(repo, body('en-US', 'EN 2')); // v3
    const zh = await repo.get(TEMPLATE, { member: 'zh-CN' });
    await repo.delete(TEMPLATE, { parentVersion: zh!.hash, actor: 'admin', member: 'zh-CN' }); // v4 tombstone

    const canonical: Array<{ op: string; version?: number }> = [];
    for await (const ev of repo.history(TEMPLATE)) canonical.push({ op: ev.op, version: ev.version });
    expect(canonical).toEqual([{ op: 'create', version: 1 }, { op: 'update', version: 3 }]);

    const zhEvents: Array<{ op: string; version?: number }> = [];
    for await (const ev of repo.history(TEMPLATE, { member: 'zh-CN' })) zhEvents.push({ op: ev.op, version: ev.version });
    expect(zhEvents).toEqual([{ op: 'create', version: 2 }, { op: 'delete', version: 4 }]);

    // One counter for the bundle: every version names exactly one snapshot.
    const versions = engine.history.map((h) => h.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('a revert restores within its member, and refuses another member\'s version', async () => {
    const engine = makeFakeEngine();
    const repo = makeRepo(engine);
    await save(repo, body('en-US', 'EN 1')); // v1
    await save(repo, body('zh-CN', 'ZH 1')); // v2
    await save(repo, body('zh-CN', 'ZH 2')); // v3

    // v2 is the zh-CN member's: not the canonical member's version.
    await expect(repo.restoreVersion(TEMPLATE, 2, { actor: 'admin' })).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
      status: 404,
    });
    expect((await repo.get(TEMPLATE))?.body.subject).toBe('EN 1');

    await repo.restoreVersion(TEMPLATE, 2, { actor: 'admin', member: 'zh-CN' });
    expect((await repo.get(TEMPLATE, { member: 'zh-CN' }))?.body.subject).toBe('ZH 1');
    // Restored IN PLACE: still one row per member.
    expect(activeRows(engine)).toHaveLength(2);
    expect((await repo.get(TEMPLATE))?.body.subject).toBe('EN 1');
  });

  it('a member\'s draft is promoted onto that member\'s active row, and drained under it', async () => {
    const engine = makeFakeEngine();
    const repo = makeRepo(engine);
    await save(repo, body('en-US', 'EN'));
    await save(repo, body('zh-CN', 'ZH'));
    await save(repo, body('zh-CN', 'ZH draft'), 'draft');
    await save(repo, body('en-US', 'EN draft'), 'draft');

    await repo.promoteDraft(TEMPLATE, { actor: 'admin', member: 'zh-CN' });
    expect((await repo.get(TEMPLATE, { member: 'zh-CN' }))?.body.subject).toBe('ZH draft');
    expect((await repo.get(TEMPLATE))?.body.subject).toBe('EN');
    const drafts = engine.rows.filter((r) => r.state === 'draft');
    expect(drafts.map((r) => r.bundle_member)).toEqual([null]);

    // No member: the canonical member's draft.
    await repo.promoteDraft(TEMPLATE, { actor: 'admin' });
    expect((await repo.get(TEMPLATE))?.body.subject).toBe('EN draft');
    expect(engine.rows.filter((r) => r.state === 'draft')).toEqual([]);
    expect(activeRows(engine)).toHaveLength(2);
  });

  it('CONTROL: a type whose identity is name alone never sees the member column', async () => {
    const engine = makeFakeEngine();
    const repo = makeRepo(engine);
    const VIEW = { org: 'env', type: 'view' as const, name: 'lead.list' };
    // A body carrying a `locale` key: only a declared discriminator keys a type.
    await repo.put(VIEW, { name: 'lead.list', label: 'One', locale: 'zh-CN' }, { parentVersion: null, actor: 'admin' });
    const head = (await repo.headAt(VIEW, { state: 'active', member: 'zh-CN' })).head;
    await repo.put(VIEW, { name: 'lead.list', label: 'Two', locale: 'ja-JP' }, { parentVersion: head!.hash, actor: 'admin' });
    await repo.get(VIEW, { member: 'zh-CN' });
    await repo.delete(VIEW, { parentVersion: (await repo.get(VIEW))!.hash, actor: 'admin', member: 'ja-JP' });

    expect(engine.payloads.length).toBeGreaterThan(0);
    for (const payload of engine.payloads) expect(payload).not.toHaveProperty('bundle_member');
    for (const where of engine.wheres) expect(where).not.toHaveProperty('bundle_member');
    expect(engine.rows).toEqual([]);
  });
});
